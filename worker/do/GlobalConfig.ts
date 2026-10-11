import { DurableObject } from "cloudflare:workers";
import type { ZodType } from "zod";

import {
  BLOCKED_EMAILS_CONFIG_KEY,
  BlockedEmailsDocument,
  createEmptyBlockedEmailsDocument,
  testBlockedEmail,
  type BlockedEmailsDocument as BlockedEmailsDocumentValue,
} from "../blockedEmails";
import {
  createEmptyCategoriesDocument,
  deleteCategoryFromDocument,
  normalizeCategoriesDocument,
  repairCategoriesDocument,
  upsertCategoryInDocument,
  CATEGORY_CONFIG_KEY,
  type CategoryDocumentWriteInput,
  type RemovedCategory,
} from "../category/document";
import { CategoriesDocument, type Category } from "../category/schema";
import {
  GlobalConfigValueCodec,
  type GlobalConfigKey,
  type GlobalConfigValue,
} from "../globalConfig";
import { normalizedEmailSchema } from "../email";
import type { Result } from "../result";
import { runSqlMigrations, type SqlMigration } from "./migrations";

interface ConfigRow extends Record<string, SqlStorageValue> {
  key: string;
  value: string;
}

export class GlobalConfig extends DurableObject<Env> {
  static readonly migrations: SqlMigration[] = [
    [
      `CREATE TABLE IF NOT EXISTS global_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  ];

  private readonly bindings: Env;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.bindings = env;
    state.blockConcurrencyWhile(() => runSqlMigrations(state, GlobalConfig.migrations));
  }

  listCategories(): Result<{ document: CategoriesDocument }, "invalid_value"> {
    return this.readCategoriesDocument();
  }

  getBlockedEmails(): Result<{ document: BlockedEmailsDocumentValue }, "invalid_value"> {
    return this.readBlockedEmailsDocument();
  }

  setBlockedEmails(
    document: BlockedEmailsDocumentValue,
  ): Result<{ document: BlockedEmailsDocumentValue }, "invalid_input" | "invalid_value"> {
    const current = this.readBlockedEmailsDocument();
    if (!current.ok) {
      return current;
    }

    const parsed = BlockedEmailsDocument.safeParse(document);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    this.writeKey(BLOCKED_EMAILS_CONFIG_KEY, parsed.data);
    return { ok: true, document: parsed.data };
  }

  testBlockedEmail(
    email: string,
  ): Result<
    { email: string; blocked: boolean; matchedPattern: string | null; reason?: string },
    "invalid_input" | "invalid_value"
  > {
    const parsedEmail = normalizedEmailSchema.safeParse(email);
    if (!parsedEmail.success) {
      return { ok: false, error: "invalid_input" };
    }

    const loaded = this.readBlockedEmailsDocument();
    if (!loaded.ok) {
      return loaded;
    }
    return { ok: true, ...testBlockedEmail(loaded.document, parsedEmail.data) };
  }

  upsertCategory(
    input: CategoryDocumentWriteInput,
  ): Result<
    { document: CategoriesDocument; category: Category },
    "invalid_input" | "not_found" | "category_exists" | "invalid_value"
  > {
    const current = this.readCategoriesDocument();
    if (!current.ok) {
      return current;
    }

    const next = upsertCategoryInDocument(current.document, input);
    if (!next.ok) {
      return next;
    }

    this.writeKey(CATEGORY_CONFIG_KEY, next.document);
    return next;
  }

  deleteCategory(
    id: string,
  ): Result<{ document: CategoriesDocument }, "invalid_input" | "not_found" | "invalid_value"> {
    const current = this.readCategoriesDocument();
    if (!current.ok) {
      return current;
    }

    const next = deleteCategoryFromDocument(current.document, id);
    if (!next.ok) {
      return next;
    }

    this.writeKey(CATEGORY_CONFIG_KEY, next.document);
    return next;
  }

  /**
   * Rewrites the stored category document in the current version, dropping categories the current
   * schema no longer accepts. A real run republishes even an unchanged document so a stale or
   * invalid published copy is replaced too.
   */
  repairCategories(options: {
    dryRun: boolean;
  }): Result<
    { document: CategoriesDocument; removed: RemovedCategory[]; changed: boolean },
    "not_found"
  > {
    const row = this.readConfigRow(CATEGORY_CONFIG_KEY);
    if (!row) {
      return { ok: false, error: "not_found" };
    }

    const { document, removed } = repairCategoriesDocument(row.value);
    const changed = GlobalConfigValueCodec.serialize(CATEGORY_CONFIG_KEY, document) !== row.value;
    if (!options.dryRun) {
      this.writeKey(CATEGORY_CONFIG_KEY, document);
    }
    return { ok: true, document, removed, changed };
  }

  private readCategoriesDocument(): Result<{ document: CategoriesDocument }, "invalid_value"> {
    try {
      const document = this.readKey(CATEGORY_CONFIG_KEY, CategoriesDocument);
      if (!document) {
        return { ok: true, document: createEmptyCategoriesDocument() };
      }

      const normalized = normalizeCategoriesDocument(document);
      if (!normalized) {
        return { ok: false, error: "invalid_value" };
      }

      return {
        ok: true,
        document: normalized,
      };
    } catch (error) {
      if (error instanceof InvalidGlobalConfigValue) {
        return { ok: false, error: "invalid_value" };
      }
      throw error;
    }
  }

  private readBlockedEmailsDocument(): Result<
    { document: BlockedEmailsDocumentValue },
    "invalid_value"
  > {
    try {
      const document = this.readKey(BLOCKED_EMAILS_CONFIG_KEY, BlockedEmailsDocument);
      return {
        ok: true,
        document: document ?? createEmptyBlockedEmailsDocument(),
      };
    } catch (error) {
      if (error instanceof InvalidGlobalConfigValue) {
        return { ok: false, error: "invalid_value" };
      }
      throw error;
    }
  }

  private readKey<T>(key: string, schema: ZodType<T>): T | null {
    const row = this.readConfigRow(key);
    if (!row) {
      return null;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(row.value);
    } catch {
      throw new InvalidGlobalConfigValue(key);
    }

    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      throw new InvalidGlobalConfigValue(key);
    }
    return parsed.data;
  }

  private writeKey<K extends GlobalConfigKey>(key: K, value: GlobalConfigValue<K>): void {
    const serialized = GlobalConfigValueCodec.serialize(key, value);
    this.putSerializedValue(key, serialized);
    this.ctx.waitUntil(this.publishLatestValue(key));
  }

  private async publishLatestValue(key: GlobalConfigKey): Promise<void> {
    try {
      let valueToPublish = this.readConfigRow(key)?.value ?? null;
      while (valueToPublish !== null) {
        await this.bindings.PUBLISHED_GLOBAL_CONFIG.put(key, valueToPublish);

        // waitUntil tasks can overlap, so repair an older write that finishes after a newer one.
        const latestValue = this.readConfigRow(key)?.value ?? null;
        if (latestValue === valueToPublish) {
          return;
        }
        valueToPublish = latestValue;
      }
    } catch (error) {
      console.error("failed to publish global config to KV", { key, error });
    }
  }

  private readConfigRow(key: string): ConfigRow | null {
    return (
      this.ctx.storage.sql
        .exec<ConfigRow>(
          `SELECT key, value
           FROM global_config
           WHERE key = ?`,
          key,
        )
        .toArray()[0] ?? null
    );
  }

  private putSerializedValue(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO global_config (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }
}

class InvalidGlobalConfigValue extends Error {
  constructor(key: string) {
    super(`Invalid global config value for key ${key}`);
  }
}
