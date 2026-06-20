import { afterEach, describe, expect, it } from "vitest";

import {
  BUILTIN_DEFAULT_LIMITS,
  LimitsDocument,
  LimitsKvStore,
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
});
