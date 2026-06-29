import { z } from "zod";

import { generateRandomBase64Url, sha256Hex, timingSafeEqual } from "./crypto";
import { normalizeEmail, normalizedEmailSchema } from "./email";

export const API_KEY_PREFIX = "seisan_v1";
export const API_KEY_ID_BYTES = 12;
export const API_KEY_SECRET_BYTES = 24;
export const API_KEY_LABEL_MAX_LENGTH = 120;

const API_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/u;
const API_KEY_PATTERN = new RegExp(
  `^${API_KEY_PREFIX}_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{32})$`,
  "u",
);
const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const NonNegativeSafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const ApiKeyId = z.string().regex(API_KEY_ID_PATTERN);
export type ApiKeyId = z.infer<typeof ApiKeyId>;

export const ApiKeyHash = z.string().regex(SHA_256_HEX_PATTERN);
export type ApiKeyHash = z.infer<typeof ApiKeyHash>;

export const ApiKeyLabel = z
  .string()
  .transform((label) => label.trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(1).max(API_KEY_LABEL_MAX_LENGTH));
export type ApiKeyLabel = z.infer<typeof ApiKeyLabel>;

export const ApiKeyVerificationProjection = z
  .object({
    v: z.literal(1),
    email: normalizedEmailSchema,
    hash: ApiKeyHash,
    expiresAt: NonNegativeSafeInteger,
    revokedAt: NonNegativeSafeInteger.nullable(),
  })
  .strict();
export type ApiKeyVerificationProjection = z.infer<typeof ApiKeyVerificationProjection>;

export interface ApiKeyMetadata {
  id: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

interface ApiKeyContent {
  id: string;
  secret: string;
  value: string;
}

export function SampleApiKey(): ApiKeyContent {
  const id = generateRandomBase64Url(API_KEY_ID_BYTES);
  const secret = generateRandomBase64Url(API_KEY_SECRET_BYTES);
  return { id, secret, value: `${API_KEY_PREFIX}_${id}_${secret}` };
}

export function parseApiKey(value: string): ApiKeyContent | null {
  const match = API_KEY_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const [, id, secret] = match;
  return { id, secret, value };
}

export function apiKeyKvKey(id: string): string {
  return `v1:${id}`;
}

export class ApiKeyVerificationKvStore {
  static readonly CACHE_TTL_SECONDS = 30;
  static readonly MIN_EXPIRATION_TTL_SECONDS = 60;

  private readonly kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  async publish(input: {
    id: string;
    projection: ApiKeyVerificationProjection;
    nowSeconds: number;
  }): Promise<{ ok: true } | { ok: false; error: "invalid_input" | "kv_write_failed" }> {
    const parsedId = ApiKeyId.safeParse(input.id);
    const parsedProjection = ApiKeyVerificationProjection.safeParse(input.projection);
    if (
      !parsedId.success ||
      !parsedProjection.success ||
      !Number.isSafeInteger(input.nowSeconds) ||
      input.nowSeconds < 0
    ) {
      return { ok: false, error: "invalid_input" };
    }

    try {
      await this.kv.put(apiKeyKvKey(parsedId.data), JSON.stringify(parsedProjection.data), {
        expirationTtl: ApiKeyVerificationKvStore.expirationTtl(
          parsedProjection.data.expiresAt,
          input.nowSeconds,
        ),
      });
      return { ok: true };
    } catch (error) {
      console.error("failed to publish API key verification projection", {
        keyId: parsedId.data,
        error,
      });
      return { ok: false, error: "kv_write_failed" };
    }
  }

  async verify(
    value: string,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<{ ok: true; email: string } | { ok: false }> {
    const parsedKey = parseApiKey(value);
    if (!parsedKey || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      return { ok: false };
    }

    const projection = await this.readProjection(parsedKey.id);
    if (
      !projection ||
      projection.expiresAt <= nowSeconds ||
      projection.revokedAt !== null ||
      !timingSafeEqual(projection.hash, await sha256Hex(value))
    ) {
      return { ok: false };
    }

    return { ok: true, email: normalizeEmail(projection.email) };
  }

  private async readProjection(id: string): Promise<ApiKeyVerificationProjection | null> {
    let raw: unknown;
    try {
      raw = await this.kv.get(apiKeyKvKey(id), {
        type: "json",
        cacheTtl: ApiKeyVerificationKvStore.CACHE_TTL_SECONDS,
      });
    } catch (error) {
      console.error("failed to read API key verification projection", { keyId: id, error });
      return null;
    }

    if (raw === null) {
      return null;
    }
    const parsed = ApiKeyVerificationProjection.safeParse(raw);
    if (!parsed.success) {
      console.error("invalid API key verification projection", {
        keyId: id,
        issues: parsed.error.issues,
      });
      return null;
    }
    return parsed.data;
  }

  private static expirationTtl(expiresAt: number, nowSeconds: number): number {
    return Math.max(ApiKeyVerificationKvStore.MIN_EXPIRATION_TTL_SECONDS, expiresAt - nowSeconds);
  }
}
