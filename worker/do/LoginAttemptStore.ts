import { DurableObject } from "cloudflare:workers";

import { LOGIN_RESEND_COOLDOWN_MS, MAX_LOGIN_VERIFY_FAILURES } from "../constants";
import { timingSafeEqual } from "../crypto";
import { runSqlMigrations, type SqlMigration } from "./migrations";

interface AttemptRow extends Record<string, SqlStorageValue> {
  email_hash: string;
  attempt_id: string;
  email: string;
  code_hash: string;
  expires_at: number;
  last_sent_at: number;
  failed_attempts: number;
}

export class LoginAttemptStore extends DurableObject<Env> {
  static readonly migrations: SqlMigration[] = [
    [
      `CREATE TABLE IF NOT EXISTS login_attempts (
        email_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_sent_at INTEGER NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0
      )`,
    ],
    [
      "ALTER TABLE login_attempts ADD COLUMN attempt_id TEXT NOT NULL DEFAULT ''",
      "DELETE FROM login_attempts",
    ],
  ];

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    state.blockConcurrencyWhile(() => runSqlMigrations(state, LoginAttemptStore.migrations));
  }

  createAttempt(input: {
    emailHash: string;
    attemptId: string;
    email: string;
    codeHash: string;
    nowMs: number;
    expiresAtMs: number;
  }): { ok: true; id: string } | { ok: false; retryAfterSeconds?: number } {
    const existing = this.ctx.storage.sql
      .exec<AttemptRow>("SELECT * FROM login_attempts WHERE email_hash = ?", input.emailHash)
      .toArray()[0];

    if (existing && existing.expires_at > input.nowMs) {
      if (existing.failed_attempts >= MAX_LOGIN_VERIFY_FAILURES) {
        return { ok: false };
      }

      const nextAllowedAt = existing.last_sent_at + LOGIN_RESEND_COOLDOWN_MS;
      if (nextAllowedAt > input.nowMs) {
        return {
          ok: false,
          retryAfterSeconds: Math.ceil((nextAllowedAt - input.nowMs) / 1000),
        };
      }
    }

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO login_attempts
        (email_hash, attempt_id, email, code_hash, expires_at, created_at, last_sent_at, failed_attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      input.emailHash,
      input.attemptId,
      input.email,
      input.codeHash,
      input.expiresAtMs,
      input.nowMs,
      input.nowMs,
    );

    return { ok: true, id: input.attemptId };
  }

  verifyAttempt(input: { emailHash: string; attemptId: string; codeHash: string; nowMs: number }): {
    ok: boolean;
  } {
    const existing = this.ctx.storage.sql
      .exec<AttemptRow>("SELECT * FROM login_attempts WHERE email_hash = ?", input.emailHash)
      .toArray()[0];

    if (!existing) {
      return { ok: false };
    }

    if (!timingSafeEqual(existing.attempt_id, input.attemptId)) {
      return { ok: false };
    }

    if (existing.expires_at <= input.nowMs) {
      this.ctx.storage.sql.exec("DELETE FROM login_attempts WHERE email_hash = ?", input.emailHash);
      return { ok: false };
    }

    if (existing.failed_attempts >= MAX_LOGIN_VERIFY_FAILURES) {
      return { ok: false };
    }

    if (!timingSafeEqual(existing.code_hash, input.codeHash)) {
      const failedAttempts = existing.failed_attempts + 1;
      this.ctx.storage.sql.exec(
        "UPDATE login_attempts SET failed_attempts = ? WHERE email_hash = ?",
        failedAttempts,
        input.emailHash,
      );
      return { ok: false };
    }

    this.ctx.storage.sql.exec("DELETE FROM login_attempts WHERE email_hash = ?", input.emailHash);
    return { ok: true };
  }
}
