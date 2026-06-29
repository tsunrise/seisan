import { Hono } from "hono";
import { z } from "zod";

import { ApiKeyId, ApiKeyLabel, SampleApiKey, type ApiKeyMetadata } from "../apiKey";
import {
  type EnvWithIdentity,
  getRequiredIdentity,
  parseJson,
  requireSameOriginWhenPresent,
  requireSessionAuth,
} from "../auth";
import { sha256Hex } from "../crypto";
import type { UserAPIKeysStore } from "../do/UserAPIKeysStore";
import { normalizeEmail } from "../email";
import { ErrorResponse } from "../error";
import { LimitsKvStore } from "../limits";

const CreateApiKey = z
  .object({
    label: ApiKeyLabel,
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const apiKeysApp = new Hono<EnvWithIdentity>();

apiKeysApp.get("/api-keys", requireSameOriginWhenPresent, requireSessionAuth, async (context) => {
  const email = normalizeEmail(getRequiredIdentity(context).email);
  const result = await (
    await getUserAPIKeysStore(context.env, email)
  ).listKeys({
    email,
  });
  if (!result.ok) {
    return ErrorResponse.invalidRequest();
  }

  return context.json({ keys: result.keys });
});

apiKeysApp.post("/api-keys", requireSameOriginWhenPresent, requireSessionAuth, async (context) => {
  const parsed = await parseJson(context, CreateApiKey);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.data.expiresAt <= nowSeconds) {
    return ErrorResponse.invalidRequest();
  }

  const email = normalizeEmail(getRequiredIdentity(context).email);
  const productLimits = await new LimitsKvStore(context.env.CONFIGS).load(email);
  const store = await getUserAPIKeysStore(context.env, email);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const apiKey = SampleApiKey();
    const result = await store.createKey({
      email,
      keyId: apiKey.id,
      hash: await sha256Hex(apiKey.value),
      label: parsed.data.label,
      createdAt: nowSeconds,
      expiresAt: parsed.data.expiresAt,
      limits: productLimits,
    });
    if (result.ok) {
      return context.json({ apiKey: apiKey.value, key: result.key }, 201);
    }
    if (result.error !== "already_exists") {
      return mapApiKeyStoreError(result.error);
    }
  }

  return ErrorResponse.internalServerError();
});

apiKeysApp.delete(
  "/api-keys/:id",
  requireSameOriginWhenPresent,
  requireSessionAuth,
  async (context) => {
    const parsedId = ApiKeyId.safeParse(context.req.param("id"));
    if (!parsedId.success) {
      return ErrorResponse.notFound();
    }

    const email = normalizeEmail(getRequiredIdentity(context).email);
    const result = await (
      await getUserAPIKeysStore(context.env, email)
    ).revokeKey({
      email,
      keyId: parsedId.data,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (!result.ok) {
      return mapApiKeyStoreError(result.error);
    }

    return context.body(null, 204);
  },
);

async function getUserAPIKeysStore(
  env: Env,
  email: string,
): Promise<DurableObjectStub<UserAPIKeysStore>> {
  return env.USER_API_KEYS_STORE.getByName(await sha256Hex(normalizeEmail(email)));
}

function mapApiKeyStoreError(error: string): Response {
  switch (error) {
    case "invalid_input":
      return ErrorResponse.invalidRequest();
    case "not_found":
      return ErrorResponse.notFound();
    case "api_key_limit_exceeded":
      return ErrorResponse.conflict("api_key_limit_exceeded");
    case "kv_write_failed":
      return ErrorResponse.internalServerError();
    default:
      return ErrorResponse.internalServerError();
  }
}

export type ApiKeyListResponse = { keys: ApiKeyMetadata[] };
