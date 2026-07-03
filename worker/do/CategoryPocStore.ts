import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import {
  CategoryPocDocumentText,
  CategoryPocId,
  CategoryPocName,
  CategoryPocDescription,
  CategoryPocVectorId,
  CategoryPocVectorNamespace,
  createCategoryPocVectorNamespace,
  normalizeCategoryPocName,
  type CategoryPocCandidate,
  type CategoryPocCategory,
} from "../categoryPoc";
import { runSqlMigrations, type SqlMigration } from "./migrations";

const VECTOR_NAMESPACE_KEY = "vectorNamespace";
const NonNegativeSafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const MatchScore = z.number().refine(Number.isFinite);

const AddCategoryInput = z
  .object({
    id: CategoryPocId,
    name: CategoryPocName,
    description: CategoryPocDescription,
    documentText: CategoryPocDocumentText,
    vectorId: CategoryPocVectorId,
    nowMs: NonNegativeSafeInteger,
  })
  .strict();

const RemoveCategoryInput = z
  .object({
    id: CategoryPocId,
  })
  .strict();

const ResolveMatchesInput = z
  .object({
    matches: z.array(
      z
        .object({
          vectorId: CategoryPocVectorId,
          score: MatchScore,
        })
        .strict(),
    ),
  })
  .strict();

interface CategoryRow extends Record<string, SqlStorageValue> {
  id: string;
  normalized_name: string;
  name: string;
  description: string;
  document_text: string;
  vector_id: string;
  created_at: number;
  updated_at: number;
}

export class CategoryPocStore extends DurableObject<Env> {
  private vectorNamespacePromise: Promise<string> | null = null;

  static readonly migrations: SqlMigration[] = [
    [
      `CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        normalized_name TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        document_text TEXT NOT NULL,
        vector_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS categories_vector_id_idx
       ON categories(vector_id)`,
    ],
  ];

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    state.blockConcurrencyWhile(async () => {
      await runSqlMigrations(state, CategoryPocStore.migrations);
      this.vectorNamespacePromise = this.loadOrCreateVectorNamespace();
      await this.vectorNamespacePromise;
    });
  }

  getVectorNamespace(): Promise<string> {
    this.vectorNamespacePromise ??= this.loadOrCreateVectorNamespace();
    return this.vectorNamespacePromise;
  }

  listCategories(): CategoryPocCategory[] {
    return this.ctx.storage.sql
      .exec<CategoryRow>(
        `SELECT id, normalized_name, name, description, document_text, vector_id, created_at, updated_at
         FROM categories
         ORDER BY normalized_name ASC`,
      )
      .toArray()
      .map(rowToCategory);
  }

  addCategory(
    input: unknown,
  ):
    | { ok: true; category: CategoryPocCategory }
    | { ok: false; error: "invalid_input" | "already_exists" } {
    const parsed = AddCategoryInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    const normalizedName = normalizeCategoryPocName(parsed.data.name);
    const existing = this.ctx.storage.sql
      .exec<{ id: string }>(
        `SELECT id
         FROM categories
         WHERE normalized_name = ?`,
        normalizedName,
      )
      .toArray()[0];
    if (existing) {
      return { ok: false, error: "already_exists" };
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO categories (
        id,
        normalized_name,
        name,
        description,
        document_text,
        vector_id,
        created_at,
        updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      parsed.data.id,
      normalizedName,
      parsed.data.name,
      parsed.data.description,
      parsed.data.documentText,
      parsed.data.vectorId,
      parsed.data.nowMs,
      parsed.data.nowMs,
    );

    return {
      ok: true,
      category: {
        id: parsed.data.id,
        normalizedName,
        name: parsed.data.name,
        description: parsed.data.description,
        documentText: parsed.data.documentText,
        vectorId: parsed.data.vectorId,
        createdAt: parsed.data.nowMs,
        updatedAt: parsed.data.nowMs,
      },
    };
  }

  removeCategory(
    input: unknown,
  ): { ok: true; vectorId: string } | { ok: false; error: "invalid_input" | "not_found" } {
    const parsed = RemoveCategoryInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    const row =
      this.ctx.storage.sql
        .exec<{ vector_id: string }>(
          `SELECT vector_id
           FROM categories
           WHERE id = ?`,
          parsed.data.id,
        )
        .toArray()[0] ?? null;
    if (!row) {
      return { ok: false, error: "not_found" };
    }

    this.ctx.storage.sql.exec("DELETE FROM categories WHERE id = ?", parsed.data.id);
    return { ok: true, vectorId: row.vector_id };
  }

  resolveMatches(
    input: unknown,
  ): { ok: true; candidates: CategoryPocCandidate[] } | { ok: false; error: "invalid_input" } {
    const parsed = ResolveMatchesInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    const candidates: CategoryPocCandidate[] = [];
    for (const match of parsed.data.matches) {
      const row =
        this.ctx.storage.sql
          .exec<CategoryRow>(
            `SELECT id, normalized_name, name, description, document_text, vector_id, created_at, updated_at
             FROM categories
             WHERE vector_id = ?`,
            match.vectorId,
          )
          .toArray()[0] ?? null;
      if (row) {
        candidates.push({ category: rowToCategory(row), score: match.score });
      }
    }

    return { ok: true, candidates };
  }

  private async loadOrCreateVectorNamespace(): Promise<string> {
    return this.ctx.storage.transaction(async (transaction) => {
      const existing = await transaction.get<string>(VECTOR_NAMESPACE_KEY);
      const parsed = CategoryPocVectorNamespace.safeParse(existing);
      if (parsed.success) {
        return parsed.data;
      }

      const namespace = createCategoryPocVectorNamespace();
      await transaction.put(VECTOR_NAMESPACE_KEY, namespace);
      return namespace;
    });
  }
}

function rowToCategory(row: CategoryRow): CategoryPocCategory {
  return {
    id: row.id,
    normalizedName: row.normalized_name,
    name: row.name,
    description: row.description,
    documentText: row.document_text,
    vectorId: row.vector_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
