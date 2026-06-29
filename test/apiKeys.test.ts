import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { apiKeyKvKey, type ApiKeyMetadata } from "../worker/apiKey";
import { sha256Hex } from "../worker/crypto";
import {
  authHeaders,
  cleanupWorkerTestState,
  dispatch,
  jsonBody,
  makeEnv,
} from "./workerTestHelpers";

const API_KEY_PATTERN = /^seisan_v1_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{32}$/u;

interface ApiKeyCreateResponse {
  apiKey: string;
  key: ApiKeyMetadata;
}

interface ApiKeyListResponse {
  keys: ApiKeyMetadata[];
}

interface ApiKeyProjection {
  v: 1;
  email: string;
  hash: string;
  expiresAt: number;
  revokedAt: number | null;
}

describe("API key routes", () => {
  afterEach(cleanupWorkerTestState);

  it("creates, lists, and stores verifier projections for API keys", async () => {
    const { env: testEnv } = makeEnv();
    const email = "api-owner@example.com";
    const expiresAt = Math.floor(Date.now() / 1000) + 86_400;

    const created = await createApiKey(testEnv, { email, label: "  CLI   key  ", expiresAt });

    expect(created.apiKey).toMatch(API_KEY_PATTERN);
    expect(created.apiKey).toHaveLength(59);
    expect(created.key).toMatchObject({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/u),
      label: "CLI key",
      expiresAt,
      revokedAt: null,
    });

    const projection = await testEnv.API_KEY_VERIFICATION.get<ApiKeyProjection>(
      apiKeyKvKey(created.key.id),
      { type: "json" },
    );
    expect(projection).toEqual({
      v: 1,
      email,
      hash: await sha256Hex(created.apiKey),
      expiresAt,
      revokedAt: null,
    });

    const listed = await dispatch("/api-keys", testEnv, {
      headers: await authHeaders(email),
    });
    expect(listed.status).toBe(200);
    expect((await listed.json()) as ApiKeyListResponse).toEqual({
      keys: [created.key],
    });

    await runInDurableObject(
      testEnv.USER_API_KEYS_STORE.getByName(await sha256Hex(email)),
      async (_instance, state) => {
        await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(1);
      },
    );
  });

  it("authenticates application routes with API keys without touching the source-of-truth DO", async () => {
    const { env: testEnv } = makeEnv();
    const email = "api-user@example.com";
    const { apiKey } = await createApiKey(testEnv, { email });
    const envWithoutApiKeyStore = {
      ...testEnv,
      USER_API_KEYS_STORE: {
        getByName: () => {
          throw new Error("USER_API_KEYS_STORE must not be used for verification");
        },
      } as unknown as Env["USER_API_KEYS_STORE"],
    } as Env;

    const whoami = await dispatch("/whoami", envWithoutApiKeyStore, {
      headers: apiKeyHeaders(apiKey),
    });
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toEqual({ email });

    const createdProject = await dispatch(
      "/project",
      envWithoutApiKeyStore,
      jsonBody(
        "PUT",
        {
          name: "API Project",
          acl: { type: "public" },
          ownerMemberName: "API Owner",
        },
        apiKeyHeaders(apiKey),
      ),
    );
    expect(createdProject.status).toBe(201);
    expect(await createdProject.json()).toMatchObject({
      name: "API Project",
      owner: email,
    });
  });

  it("rejects invalid bearer credentials before falling back to a valid cookie", async () => {
    const { env: testEnv } = makeEnv();
    const response = await dispatch("/whoami", testEnv, {
      headers: {
        ...(await authHeaders("cookie-user@example.com")),
        Authorization: "Bearer seisan_v1_invalid",
      },
    });

    expect(response.status).toBe(401);
  });

  it("keeps API key management cookie-only", async () => {
    const { env: testEnv } = makeEnv();
    const email = "manager@example.com";
    const { apiKey } = await createApiKey(testEnv, { email });

    const bearerOnly = await dispatch("/api-keys", testEnv, {
      headers: apiKeyHeaders(apiKey),
    });
    expect(bearerOnly.status).toBe(401);

    const cookieWithBadBearer = await dispatch("/api-keys", testEnv, {
      headers: {
        ...(await authHeaders(email)),
        Authorization: "Bearer not-an-api-key",
      },
    });
    expect(cookieWithBadBearer.status).toBe(200);
    expect(((await cookieWithBadBearer.json()) as ApiKeyListResponse).keys).toHaveLength(1);
  });

  it("revokes API keys through source-of-truth state and the verifier projection", async () => {
    const { env: testEnv } = makeEnv();
    const email = "revoke@example.com";
    const { apiKey, key } = await createApiKey(testEnv, { email });

    const revoked = await dispatch(`/api-keys/${key.id}`, testEnv, {
      method: "DELETE",
      headers: await authHeaders(email),
    });
    expect(revoked.status).toBe(204);

    const projection = await testEnv.API_KEY_VERIFICATION.get<ApiKeyProjection>(
      apiKeyKvKey(key.id),
      {
        type: "json",
      },
    );
    expect(projection).toMatchObject({
      email,
      hash: await sha256Hex(apiKey),
      expiresAt: key.expiresAt,
      revokedAt: expect.any(Number),
    });

    const whoami = await dispatch("/whoami", testEnv, {
      headers: apiKeyHeaders(apiKey),
    });
    expect(whoami.status).toBe(401);

    const listed = await dispatch("/api-keys", testEnv, {
      headers: await authHeaders(email),
    });
    expect(((await listed.json()) as ApiKeyListResponse).keys).toEqual([
      {
        ...key,
        revokedAt: projection?.revokedAt,
      },
    ]);
  });

  it("rejects expired create requests and unknown key revocations", async () => {
    const { env: testEnv } = makeEnv();
    const email = "invalid@example.com";

    const expiredCreate = await dispatch(
      "/api-keys",
      testEnv,
      jsonBody(
        "POST",
        {
          label: "Expired",
          expiresAt: Math.floor(Date.now() / 1000) - 1,
        },
        await authHeaders(email),
      ),
    );
    expect(expiredCreate.status).toBe(400);

    const unknownDelete = await dispatch("/api-keys/aaaaaaaaaaaaaaaa", testEnv, {
      method: "DELETE",
      headers: await authHeaders(email),
    });
    expect(unknownDelete.status).toBe(404);
  });
});

async function createApiKey(
  testEnv: Env,
  input: {
    email: string;
    label?: string;
    expiresAt?: number;
  },
): Promise<ApiKeyCreateResponse> {
  const response = await dispatch(
    "/api-keys",
    testEnv,
    jsonBody(
      "POST",
      {
        label: input.label ?? "CLI",
        expiresAt: input.expiresAt ?? Math.floor(Date.now() / 1000) + 86_400,
      },
      await authHeaders(input.email),
    ),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as ApiKeyCreateResponse;
}

function apiKeyHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}
