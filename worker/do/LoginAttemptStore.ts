import { DurableObject } from "cloudflare:workers";

import { LOGIN_RESEND_COOLDOWN_MS, MAX_LOGIN_VERIFY_FAILURES } from "../constants";
import { timingSafeEqual } from "../crypto";
import { runSqlMigrations, type SqlMigration } from "./migrations";

interface AttemptRow extends Record<string, SqlStorageValue> {
  email_hash: string;
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
  ];

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    state.blockConcurrencyWhile(() => runSqlMigrations(state, LoginAttemptStore.migrations));
  }

  createAttempt(input: {
    emailHash: string;
    email: string;
    codeHash: string;
    nowMs: number;
    expiresAtMs: number;
  }): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const existing = this.ctx.storage.sql
      .exec<AttemptRow>("SELECT * FROM login_attempts WHERE email_hash = ?", input.emailHash)
      .toArray()[0];

    if (existing && existing.expires_at > input.nowMs) {
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
        (email_hash, email, code_hash, expires_at, created_at, last_sent_at, failed_attempts)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      input.emailHash,
      input.email,
      input.codeHash,
      input.expiresAtMs,
      input.nowMs,
      input.nowMs,
    );

    return { ok: true };
  }

  async verifyAttempt(input: {
    emailHash: string;
    codeHash: string;
    nowMs: number;
  }): Promise<{ ok: boolean }> {
    const existing = this.ctx.storage.sql
      .exec<AttemptRow>("SELECT * FROM login_attempts WHERE email_hash = ?", input.emailHash)
      .toArray()[0];

    if (!existing) {
      return { ok: false };
    }

    if (existing.expires_at <= input.nowMs) {
      this.ctx.storage.sql.exec("DELETE FROM login_attempts WHERE email_hash = ?", input.emailHash);
      return { ok: false };
    }

    if (!(await timingSafeEqual(existing.code_hash, input.codeHash))) {
      const failedAttempts = existing.failed_attempts + 1;
      if (failedAttempts >= MAX_LOGIN_VERIFY_FAILURES) {
        this.ctx.storage.sql.exec(
          "DELETE FROM login_attempts WHERE email_hash = ?",
          input.emailHash,
        );
      } else {
        this.ctx.storage.sql.exec(
          "UPDATE login_attempts SET failed_attempts = ? WHERE email_hash = ?",
          failedAttempts,
          input.emailHash,
        );
      }
      return { ok: false };
    }

    this.ctx.storage.sql.exec("DELETE FROM login_attempts WHERE email_hash = ?", input.emailHash);
    return { ok: true };
  }
}
