import { DurableObject } from "cloudflare:workers";

import { normalizeEmail } from "../email";
import { LimitsKvStore, LimitsDocument, type LimitsTarget } from "../limits";
import { runSqlMigrations, type SqlMigration } from "./migrations";

interface LimitsRow extends Record<string, SqlStorageValue> {
  limit_key: string;
  limit_json: string;
  updated_at: number;
}

export class LimitsStore extends DurableObject<Env> {
  static readonly migrations: SqlMigration[] = [
    [
      `CREATE TABLE IF NOT EXISTS limits (
        limit_key TEXT PRIMARY KEY,
        limit_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ],
  ];

  private readonly bindings: Env;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.bindings = env;
    state.blockConcurrencyWhile(() => runSqlMigrations(state, LimitsStore.migrations));
  }

  getLimits(
    target: LimitsTarget,
  ):
    | { ok: true; limits: LimitsDocument | null; updatedAt: number | null }
    | { ok: false; error: "invalid_input" } {
    const row =
      this.ctx.storage.sql
        .exec<LimitsRow>(
          `SELECT limit_key, limit_json, updated_at
           FROM limits
           WHERE limit_key = ?`,
          LimitsStore.storageKeyForTarget(target),
        )
        .toArray()[0] ?? null;
    if (!row) {
      return { ok: true, limits: null, updatedAt: null };
    }

    const limits = LimitsStore.parseStoredLimits(row.limit_json);
    if (!limits) {
      return { ok: false, error: "invalid_input" };
    }

    return { ok: true, limits, updatedAt: row.updated_at };
  }

  async putLimits(input: {
    target: LimitsTarget;
    limits: LimitsDocument;
    nowMs: number;
  }): Promise<
    { ok: true; updatedAt: number } | { ok: false; error: "invalid_input" | "kv_write_failed" }
  > {
    const parsedLimits = LimitsDocument.safeParse(input.limits);
    if (!parsedLimits.success || !Number.isSafeInteger(input.nowMs)) {
      return { ok: false, error: "invalid_input" };
    }

    const limitsJson = LimitsStore.serializeDocument(parsedLimits.data);
    this.ctx.storage.sql.exec(
      `INSERT INTO limits (limit_key, limit_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(limit_key) DO UPDATE SET
        limit_json = excluded.limit_json,
        updated_at = excluded.updated_at`,
      LimitsStore.storageKeyForTarget(input.target),
      limitsJson,
      input.nowMs,
    );

    try {
      await new LimitsKvStore(this.bindings.CONFIGS).put(input.target, parsedLimits.data);
    } catch (error) {
      console.error("failed to publish limit to KV", {
        target: LimitsStore.storageKeyForTarget(input.target),
        error,
      });
      return { ok: false, error: "kv_write_failed" };
    }

    return { ok: true, updatedAt: input.nowMs };
  }

  private static storageKeyForTarget(target: LimitsTarget): string {
    return target.type === "default" ? "default" : `user:${normalizeEmail(target.email)}`;
  }

  private static serializeDocument(document: LimitsDocument): string {
    return JSON.stringify(document);
  }

  private static parseStoredLimits(value: string): LimitsDocument | null {
    try {
      const parsed = JSON.parse(value);
      const limits = LimitsDocument.safeParse(parsed);
      return limits.success ? limits.data : null;
    } catch {
      return null;
    }
  }
}
