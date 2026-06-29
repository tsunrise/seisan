import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import {
  ApiKeyHash,
  ApiKeyId,
  ApiKeyLabel,
  type ApiKeyMetadata,
  ApiKeyVerificationKvStore,
} from "../apiKey";
import { normalizedEmailSchema } from "../email";
import { runSqlMigrations, type SqlMigration } from "./migrations";

interface ApiKeyRow extends Record<string, SqlStorageValue> {
  id: string;
  email: string;
  hash: string;
  label: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  published_at: number | null;
}

const NonNegativeSafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const ListApiKeysInput = z
  .object({
    email: normalizedEmailSchema,
  })
  .strict();

const CreateApiKeyInput = z
  .object({
    email: normalizedEmailSchema,
    keyId: ApiKeyId,
    hash: ApiKeyHash,
    label: ApiKeyLabel,
    createdAt: NonNegativeSafeInteger,
    expiresAt: NonNegativeSafeInteger,
  })
  .strict();

const RevokeApiKeyInput = z
  .object({
    email: normalizedEmailSchema,
    keyId: ApiKeyId,
    nowSeconds: NonNegativeSafeInteger,
  })
  .strict();

export class UserAPIKeysStore extends DurableObject<Env> {
  static readonly migrations: SqlMigration[] = [
    [
      `CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        hash TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        published_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS api_keys_email_created_at
       ON api_keys (email, created_at)`,
    ],
  ];

  private readonly bindings: Env;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.bindings = env;
    state.blockConcurrencyWhile(() => runSqlMigrations(state, UserAPIKeysStore.migrations));
  }

  listKeys(
    input: unknown,
  ): { ok: true; keys: ApiKeyMetadata[] } | { ok: false; error: "invalid_input" } {
    const parsed = ListApiKeysInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    const rows = this.ctx.storage.sql
      .exec<ApiKeyRow>(
        `SELECT id, email, hash, label, created_at, expires_at, revoked_at, published_at
         FROM api_keys
         WHERE email = ? AND published_at IS NOT NULL
         ORDER BY created_at DESC, id DESC`,
        parsed.data.email,
      )
      .toArray();

    return { ok: true, keys: rows.map(rowToMetadata) };
  }

  async createKey(
    input: unknown,
  ): Promise<
    | { ok: true; key: ApiKeyMetadata }
    | { ok: false; error: "already_exists" | "invalid_input" | "kv_write_failed" }
  > {
    const parsed = CreateApiKeyInput.safeParse(input);
    if (!parsed.success || parsed.data.expiresAt <= parsed.data.createdAt) {
      return { ok: false, error: "invalid_input" };
    }

    const existing = this.readKey(parsed.data.keyId);
    if (existing) {
      return { ok: false, error: "already_exists" };
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO api_keys (id, email, hash, label, created_at, expires_at, revoked_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
      parsed.data.keyId,
      parsed.data.email,
      parsed.data.hash,
      parsed.data.label,
      parsed.data.createdAt,
      parsed.data.expiresAt,
    );

    const published = await new ApiKeyVerificationKvStore(
      this.bindings.API_KEY_VERIFICATION,
    ).publish({
      id: parsed.data.keyId,
      projection: {
        v: 1,
        email: parsed.data.email,
        hash: parsed.data.hash,
        expiresAt: parsed.data.expiresAt,
        revokedAt: null,
      },
      nowSeconds: parsed.data.createdAt,
    });
    if (!published.ok) {
      this.ctx.storage.sql.exec("DELETE FROM api_keys WHERE id = ?", parsed.data.keyId);
      return { ok: false, error: published.error };
    }

    this.ctx.storage.sql.exec(
      "UPDATE api_keys SET published_at = ? WHERE id = ?",
      parsed.data.createdAt,
      parsed.data.keyId,
    );

    const row = this.readKey(parsed.data.keyId);
    if (!row) {
      return { ok: false, error: "invalid_input" };
    }
    return { ok: true, key: rowToMetadata(row) };
  }

  async revokeKey(
    input: unknown,
  ): Promise<
    | { ok: true; key: ApiKeyMetadata }
    | { ok: false; error: "invalid_input" | "not_found" | "kv_write_failed" }
  > {
    const parsed = RevokeApiKeyInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    const row = this.readKey(parsed.data.keyId);
    if (!row || row.email !== parsed.data.email || row.published_at === null) {
      return { ok: false, error: "not_found" };
    }

    const revokedAt = row.revoked_at ?? parsed.data.nowSeconds;
    this.ctx.storage.sql.exec(
      "UPDATE api_keys SET revoked_at = ? WHERE id = ?",
      revokedAt,
      parsed.data.keyId,
    );

    const published = await new ApiKeyVerificationKvStore(
      this.bindings.API_KEY_VERIFICATION,
    ).publish({
      id: parsed.data.keyId,
      projection: {
        v: 1,
        email: row.email,
        hash: row.hash,
        expiresAt: row.expires_at,
        revokedAt,
      },
      nowSeconds: parsed.data.nowSeconds,
    });
    if (!published.ok) {
      return { ok: false, error: published.error };
    }

    return {
      ok: true,
      key: rowToMetadata({
        ...row,
        revoked_at: revokedAt,
      }),
    };
  }

  private readKey(id: string): ApiKeyRow | null {
    return (
      this.ctx.storage.sql
        .exec<ApiKeyRow>(
          `SELECT id, email, hash, label, created_at, expires_at, revoked_at, published_at
           FROM api_keys
           WHERE id = ?`,
          id,
        )
        .toArray()[0] ?? null
    );
  }
}

function rowToMetadata(row: ApiKeyRow): ApiKeyMetadata {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}
