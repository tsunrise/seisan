import { afterEach, describe, expect, it } from "vitest";

import {
  AUTOMATED_BLOCK_PROJECTS_NO_POST,
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

  it("supports optional timestamp limits for automated no-post blocks", () => {
    expect(
      LimitsDocument.safeParse({
        [AUTOMATED_BLOCK_PROJECTS_NO_POST]: null,
      }).success,
    ).toBe(true);
    expect(
      LimitsDocument.safeParse({
        [AUTOMATED_BLOCK_PROJECTS_NO_POST]: 1_000,
      }).success,
    ).toBe(true);
    expect(
      LimitsDocument.safeParse({
        [AUTOMATED_BLOCK_PROJECTS_NO_POST]: -1,
      }).success,
    ).toBe(false);

    const defaultResolved = resolveLimits();
    expect(defaultResolved).toMatchObject({
      ok: true,
      limits: { [AUTOMATED_BLOCK_PROJECTS_NO_POST]: null },
    });

    const blockedResolved = resolveLimits(
      {},
      {
        [AUTOMATED_BLOCK_PROJECTS_NO_POST]: 5_000,
      },
    );
    expect(blockedResolved).toMatchObject({
      ok: true,
      limits: { [AUTOMATED_BLOCK_PROJECTS_NO_POST]: 5_000 },
    });
    if (!blockedResolved.ok) {
      throw new Error("expected resolved limits");
    }
    const policy = new LimitsPolicy(blockedResolved.limits);
    expect(policy.allowsProjectRecordPost(4_999)).toBe(false);
    expect(policy.allowsProjectRecordPost(5_000)).toBe(true);
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

  it("sets automated user blocks only when the new timestamp extends the existing block", async () => {
    const { env: testEnv } = makeEnv();
    const email = `automated-block-${crypto.randomUUID()}@example.com`;
    const store = testEnv.LIMITS_STORE.getByName(LIMITS_STORE_NAME);

    const first = await store.setAutomatedBlock({
      target: { type: "user", email },
      feature: AUTOMATED_BLOCK_PROJECTS_NO_POST,
      timestamp: 10_000,
      nowMs: 1_000,
    });
    expect(first).toEqual({ ok: true, updated: true });
    await expect(testEnv.CONFIGS.get(LimitsKvStore.userKey(email), "json")).resolves.toEqual({
      [AUTOMATED_BLOCK_PROJECTS_NO_POST]: 10_000,
    });

    const earlier = await store.setAutomatedBlock({
      target: { type: "user", email },
      feature: AUTOMATED_BLOCK_PROJECTS_NO_POST,
      timestamp: 9_000,
      nowMs: 2_000,
    });
    expect(earlier).toEqual({ ok: true, updated: false });
    await expect(store.getLimits({ type: "user", email })).resolves.toMatchObject({
      ok: true,
      limits: { [AUTOMATED_BLOCK_PROJECTS_NO_POST]: 10_000 },
      updatedAt: 1_000,
    });

    await store.putLimits({
      target: { type: "user", email },
      limits: {
        [AUTOMATED_BLOCK_PROJECTS_NO_POST]: 10_000,
        "money.maxAmountCents": 42,
      },
      nowMs: 3_000,
    });
    const later = await store.setAutomatedBlock({
      target: { type: "user", email },
      feature: AUTOMATED_BLOCK_PROJECTS_NO_POST,
      timestamp: 15_000,
      nowMs: 4_000,
    });
    expect(later).toEqual({ ok: true, updated: true });
    const expectedLimits = {
      [AUTOMATED_BLOCK_PROJECTS_NO_POST]: 15_000,
      "money.maxAmountCents": 42,
    };
    await expect(store.getLimits({ type: "user", email })).resolves.toMatchObject({
      ok: true,
      limits: expectedLimits,
      updatedAt: 4_000,
    });
    await expect(testEnv.CONFIGS.get(LimitsKvStore.userKey(email), "json")).resolves.toEqual(
      expectedLimits,
    );
  });
});
