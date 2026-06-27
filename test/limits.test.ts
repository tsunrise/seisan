import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import {
  BUILTIN_DEFAULT_LIMITS,
  LIMITS_STORE_NAME,
  LimitsDocument,
  LimitsKvStore,
  LimitsPolicy,
  resolveLimits,
} from "../worker/limits";
import {
  cleanupWorkerTestState,
  limitsDocument,
  makeEnv,
  putDefaultLimits,
  putUserLimits,
} from "./workerTestHelpers";

describe("limits", () => {
  afterEach(cleanupWorkerTestState);

  it("accepts flat partial documents and rejects unknown leaves", () => {
    expect(
      LimitsDocument.safeParse({
        "projects.maxOwnedProjects": 10,
        "money.maxAmountCents": 10_000,
      }).success,
    ).toBe(true);

    expect(
      LimitsDocument.safeParse({
        "projects.maxOwnedProjects": 10,
        "projects.unknownLimit": 1,
      }).success,
    ).toBe(false);
  });

  it("validates records page size ordering when both fields are present", () => {
    expect(
      LimitsDocument.safeParse({
        "records.defaultPageSize": 20,
        "records.maxPageSize": 10,
      }).success,
    ).toBe(false);

    expect(
      LimitsDocument.safeParse({
        "records.maxPageSize": 10,
      }).success,
    ).toBe(true);
  });

  it("resolves built-in defaults, global overrides, then user overrides by leaf", () => {
    const resolved = resolveLimits(
      {
        "projects.maxOwnedProjects": 75,
        "money.maxAmountCents": 10_000,
      },
      {
        "projects.maxOwnedProjects": 10,
      },
    );

    expect(resolved).toEqual({
      ok: true,
      limits: {
        ...BUILTIN_DEFAULT_LIMITS,
        "projects.maxOwnedProjects": 10,
        "money.maxAmountCents": 10_000,
      },
    });
  });

  it("supports boolean record posting limits", () => {
    expect(
      LimitsDocument.safeParse({
        "records.allow_post": true,
      }).success,
    ).toBe(true);
    expect(
      LimitsDocument.safeParse({
        "records.allow_post": false,
      }).success,
    ).toBe(true);
    expect(
      LimitsDocument.safeParse({
        "records.allow_post": "false",
      }).success,
    ).toBe(false);
    expect(
      LimitsDocument.safeParse({
        "automated.block.projects.no_post": null,
      }).success,
    ).toBe(false);

    const defaultResolved = resolveLimits();
    expect(defaultResolved).toMatchObject({
      ok: true,
      limits: { "records.allow_post": true },
    });

    const blockedResolved = resolveLimits(
      {},
      {
        "records.allow_post": false,
      },
    );
    expect(blockedResolved).toMatchObject({
      ok: true,
      limits: { "records.allow_post": false },
    });
    if (!blockedResolved.ok) {
      throw new Error("expected resolved limits");
    }
    const policy = new LimitsPolicy(blockedResolved.limits);
    expect(policy.allowsRecordPost()).toBe(false);
  });

  it("rejects invalid effective resolved limits", () => {
    expect(resolveLimits({ "records.maxPageSize": 1 }).ok).toBe(false);
  });

  it("falls back from invalid effective KV limits by ignoring user overrides first", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `kv-limit-${crypto.randomUUID()}@example.com`;
    await putDefaultLimits(
      testEnv,
      limitsDocument({
        "records.defaultPageSize": 1,
        "records.maxPageSize": 1,
      }),
    );
    await putUserLimits(
      testEnv,
      owner,
      limitsDocument({
        "records.defaultPageSize": 2,
      }),
    );

    const withInvalidUser = await new LimitsKvStore(testEnv.CONFIGS).load(owner);
    expect(withInvalidUser).toMatchObject({
      "records.defaultPageSize": 1,
      "records.maxPageSize": 1,
    });

    await putDefaultLimits(
      testEnv,
      limitsDocument({
        "records.maxPageSize": 1,
      }),
    );
    const withInvalidDefault = await new LimitsKvStore(testEnv.CONFIGS).load();
    expect(withInvalidDefault).toEqual(BUILTIN_DEFAULT_LIMITS);
  });

  it("ignores legacy automated no-post keys in stored limit documents", async () => {
    const { env: testEnv } = makeEnv();
    const email = `legacy-automated-block-${crypto.randomUUID()}@example.com`;
    const legacyLimits = {
      "automated.block.projects.no_post": 10_000,
      "money.maxAmountCents": 42,
    };

    await testEnv.CONFIGS.put(LimitsKvStore.userKey(email), JSON.stringify(legacyLimits));
    const withLegacyKv = await new LimitsKvStore(testEnv.CONFIGS).load(email);
    expect(withLegacyKv).toMatchObject({
      "records.allow_post": true,
      "money.maxAmountCents": 42,
    });

    const store = testEnv.LIMITS_STORE.getByName(LIMITS_STORE_NAME);
    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO limits (limit_key, limit_json, updated_at)
         VALUES (?, ?, ?)`,
        `user:${email}`,
        JSON.stringify({
          "automated.block.projects.no_post": 20_000,
          "records.allow_post": false,
        }),
        1_000,
      );
    });

    await expect(
      store.getLimits({
        type: "user",
        email,
      }),
    ).resolves.toEqual({
      ok: true,
      limits: { "records.allow_post": false },
      updatedAt: 1_000,
    });
  });
});
