import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { backfill } from "../worker/do/migrations";
import { PROJECTS_REGISTRY_NAME } from "../worker/project";
import {
  cleanupWorkerTestState,
  createProject,
  getProject,
  getProjectStoreStub,
  makeEnv,
  parseProjectRefCacheValue,
  projectRefCacheKey,
} from "./workerTestHelpers";

const PROJECT_METADATA_KEY = "projectMetadata";

interface SqliteCatalogRow extends Record<string, SqlStorageValue> {
  name: string;
  sql: string | null;
}

describe("durable objects", () => {
  afterEach(cleanupWorkerTestState);

  it("runs a durable object backfill only once for its marker", async () => {
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
        await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(6);
      },
    );
    await runInDurableObject(testEnv.LIMITS_STORE.getByName("limits"), async (_instance, state) => {
      await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(1);
    });
    const apiKeysStore = testEnv.USER_API_KEYS_STORE.getByName("api-keys-migration");
    expect(await apiKeysStore.listKeys({ email: "owner@example.com" })).toEqual({
      ok: true,
      keys: [],
    });
    await runInDurableObject(apiKeysStore, async (_instance, state) => {
      await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(1);
    });
    await runInDurableObject(
      testEnv.PROJECT_STORE.get(testEnv.PROJECT_STORE.idFromString(cachedProject?.doId ?? "")),
      async (_instance, state) => {
        await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(3);
        await expect(state.storage.get<boolean>("initialized")).resolves.toBe(true);
      },
    );
  });

  it("stores project metadata in DO KV and drops legacy SQL metadata tables", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, {
      acl: { type: "restricted", emails: ["friend@example.com"] },
      name: "KV Metadata",
    });
    const stub = await getProjectStoreStub(testEnv, project.id);

    await runInDurableObject(stub, async (_instance, state) => {
      const raw = await state.storage.get<string>(PROJECT_METADATA_KEY);
      expect(typeof raw).toBe("string");
      expect(JSON.parse(raw ?? "")).toMatchObject({
        public_id: project.id,
        name: "KV Metadata",
        owner_email: "owner@example.com",
        acl_type: "restricted",
        acl_allowed_list: ["friend@example.com"],
        next_record_id: 1,
        next_member_id: 2,
      });

      const legacyTables = state.storage.sql
        .exec<SqliteCatalogRow>(
          `SELECT name, sql
           FROM sqlite_master
           WHERE type = 'table' AND name IN ('acl_allowed_list', 'project_meta')`,
        )
        .toArray();
      expect(legacyTables).toEqual([]);
    });

    await expect(getProject(testEnv, project.id)).resolves.toMatchObject({
      id: project.id,
      name: "KV Metadata",
      acl: { type: "restricted", emails: ["friend@example.com"] },
    });
  });
});
