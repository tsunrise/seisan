import * as jose from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeEmail } from "../worker/email";
import { LimitsKvStore } from "../worker/limits";
import {
  adminDispatch,
  cleanupWorkerTestState,
  jsonBody,
  limitsDocument,
  makeEnv,
} from "./workerTestHelpers";

describe("admin routes", () => {
  afterEach(cleanupWorkerTestState);

  it("manages default and user limits through local admin endpoints", async () => {
    const { env: testEnv } = makeEnv();
    const defaultLimits = limitsDocument({
      projects: { maxOwnedProjects: 2 },
    });

    const putDefault = await adminDispatch(
      "/limits/default",
      testEnv,
      jsonBody("PUT", defaultLimits),
    );
    expect(putDefault.status).toBe(204);

    const getDefault = await adminDispatch("/limits/default", testEnv);
    expect(getDefault.status).toBe(200);
    expect(await getDefault.json()).toEqual(defaultLimits);
    await expect(testEnv.CONFIGS.get(LimitsKvStore.defaultKey(), "json")).resolves.toEqual(
      defaultLimits,
    );

    const userEmail = "Admin.User@Example.com";
    const normalizedUserEmail = normalizeEmail(userEmail);
    const userLimits = limitsDocument({
      money: { maxAmountCents: 42 },
    });
    const putUser = await adminDispatch(
      `/limits/user/${encodeURIComponent(userEmail)}`,
      testEnv,
      jsonBody("PUT", userLimits),
    );
    expect(putUser.status).toBe(204);

    const getUser = await adminDispatch(
      `/limits/user/${encodeURIComponent(normalizedUserEmail)}`,
      testEnv,
    );
    expect(getUser.status).toBe(200);
    expect(await getUser.json()).toEqual(userLimits);
    await expect(
      testEnv.CONFIGS.get(LimitsKvStore.userKey(normalizedUserEmail), "json"),
    ).resolves.toEqual(userLimits);
  });

  it("protects admin endpoints with Cloudflare Access outside local dev", async () => {
    const { env: testEnv } = makeEnv();

    const missingToken = await adminDispatch("/limits/default", testEnv, {}, "https://seisan.test");
    expect(missingToken.status).toBe(403);

    vi.spyOn(jose, "createRemoteJWKSet").mockReturnValue((async () => {
      throw new Error("jwtVerify is mocked for this test.");
    }) as unknown as ReturnType<typeof jose.createRemoteJWKSet>);
    vi.spyOn(jose, "jwtVerify").mockResolvedValue({
      payload: { email: "admin@example.com" },
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const validToken = await adminDispatch(
      "/limits/default",
      testEnv,
      { headers: { "Cf-Access-Jwt-Assertion": "mock-access-jwt" } },
      "https://seisan.test",
    );

    expect(validToken.status).toBe(200);
    expect(jose.jwtVerify).toHaveBeenCalledWith(
      "mock-access-jwt",
      expect.any(Function),
      expect.objectContaining({
        audience: "test-aud",
        issuer: "https://team.test",
      }),
    );
  });

  it("rejects invalid admin limit documents without publishing KV", async () => {
    const { env: testEnv } = makeEnv();

    const response = await adminDispatch(
      "/limits/default",
      testEnv,
      jsonBody("PUT", { projects: { maxLinkedProjects: 1 } }),
    );

    expect(response.status).toBe(400);
    await expect(testEnv.CONFIGS.get(LimitsKvStore.defaultKey())).resolves.toBeNull();
  });
});
