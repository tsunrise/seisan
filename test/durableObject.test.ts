import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { backfill } from "../worker/do/migrations";
import { PROJECTS_REGISTRY_NAME } from "../worker/project";
import {
  cleanupWorkerTestState,
  createProject,
  makeEnv,
  parseProjectRefCacheValue,
  projectRefCacheKey,
} from "./workerTestHelpers";

describe("durable objects", () => {
  afterEach(cleanupWorkerTestState);

  it("runs durable object backfills only once per unique marker", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.PROJECT_STORE.getByName(`backfill-${crypto.randomUUID()}`);

    await runInDurableObject(stub, async (_instance, state) => {
      let calls = 0;
      await backfill(state, "backfill-a", async () => {
        calls += 1;
        return null;
      });
      await backfill(state, "backfill-a", async () => {
        calls += 1;
        return null;
      });
      expect(calls).toBe(1);
      await expect(state.storage.get<string>("dbBackfillState")).resolves.toBe("backfill-a");

      await backfill(state, "backfill-b", async () => {
        calls += 1;
        return null;
      });
      expect(calls).toBe(2);
      await expect(state.storage.get<string>("dbBackfillState")).resolves.toBe("backfill-b");
    });
  });

  it("runs migrations for project durable objects", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const cacheValue = await testEnv.PROJECT_REGISTRY_CACHE.get(projectRefCacheKey(project.id));
    const cachedProject = parseProjectRefCacheValue(cacheValue ?? "");
    expect(cachedProject?.doId).toMatch(/^[0-9a-f]{64}$/u);

    await runInDurableObject(
      testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME),
      async (_instance, state) => {
        await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(4);
      },
    );
    await runInDurableObject(testEnv.LIMITS_STORE.getByName("limits"), async (_instance, state) => {
      await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(1);
    });
    await runInDurableObject(
      testEnv.PROJECT_STORE.get(testEnv.PROJECT_STORE.idFromString(cachedProject?.doId ?? "")),
      async (_instance, state) => {
        await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(2);
        await expect(state.storage.get<boolean>("initialized")).resolves.toBe(true);
      },
    );
  });
});
