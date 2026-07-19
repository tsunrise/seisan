import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { backfill, runSqlMigrations } from "../worker/do/migrations";
import { projectStoreMigrations } from "../worker/do/migrations/ProjectStore.migration";
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

interface MemberConfigRow extends Record<string, SqlStorageValue> {
  config: string;
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
        await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(6);
        await expect(state.storage.get<boolean>("initialized")).resolves.toBe(true);
        expect(
          state.storage.sql
            .exec<MemberConfigRow>("SELECT config FROM members WHERE id = 1")
            .toArray()[0]?.config,
        ).toBe("{}");
        const recordColumns = state.storage.sql
          .exec<SqliteCatalogRow>("SELECT name, sql FROM sqlite_master WHERE name = 'records'")
          .one().sql;
        expect(recordColumns).toContain("updated_at INTEGER");
        expect(recordColumns).toContain("updated_by_member_id INTEGER");
        expect(recordColumns).not.toContain("reverts_record_id");
      },
    );
  });

  it("clears ambiguous edit audit metadata from tombstones during migration", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.PROJECT_STORE.getByName(`tombstone-migration-${crypto.randomUUID()}`);

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO records
          (id, author_member_id, description_type, description_json, delta_json, created_at,
           updated_at, updated_by_member_id)
         VALUES (1, 1, 'deleted', '{}', '{}', 100, 200, 2)`,
      );
      await state.storage.put("dbMigrationVersion", 5);

      await runSqlMigrations(state, projectStoreMigrations);

      expect(
        state.storage.sql
          .exec("SELECT updated_at, updated_by_member_id FROM records WHERE id = 1")
          .one(),
      ).toEqual({ updated_at: null, updated_by_member_id: null });
      await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(6);
    });
  });

  it("preserves expense and legacy revert rows when rebuilding the records table", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const stub = await getProjectStoreStub(testEnv, project.id);

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("DROP TABLE records").toArray();
      state.storage.sql
        .exec(
          `CREATE TABLE records (
            id INTEGER PRIMARY KEY,
            author_member_id INTEGER NOT NULL,
            description_type TEXT NOT NULL,
            description_json TEXT NOT NULL,
            delta_json TEXT NOT NULL,
            reverts_record_id INTEGER UNIQUE,
            created_at INTEGER NOT NULL
          )`,
        )
        .toArray();
      state.storage.sql
        .exec(
          `INSERT INTO records
            (id, author_member_id, description_type, description_json, delta_json,
             reverts_record_id, created_at)
           VALUES
            (1, 1, 'expense', '{"type":"expense","name":"Dinner","paid":{"1":100},"liability":{"1":100}}', '{}', NULL, 1000),
            (2, 1, 'revert', '{"type":"revert","id":1}', '{}', 1, 2000)`,
        )
        .toArray();
      await state.storage.put("dbMigrationVersion", 4);

      await runSqlMigrations(state, projectStoreMigrations);

      expect(
        state.storage.sql
          .exec(
            `SELECT id, description_type, description_json, delta_json, created_at,
                    updated_at, updated_by_member_id
             FROM records ORDER BY id`,
          )
          .toArray(),
      ).toEqual([
        {
          id: 1,
          description_type: "expense",
          description_json:
            '{"type":"expense","name":"Dinner","paid":{"1":100},"liability":{"1":100}}',
          delta_json: "{}",
          created_at: 1000,
          updated_at: null,
          updated_by_member_id: null,
        },
        {
          id: 2,
          description_type: "revert",
          description_json: '{"type":"revert","id":1}',
          delta_json: "{}",
          created_at: 2000,
          updated_at: null,
          updated_by_member_id: null,
        },
      ]);
      const recordsSql = state.storage.sql
        .exec<SqliteCatalogRow>("SELECT name, sql FROM sqlite_master WHERE name = 'records'")
        .one().sql;
      expect(recordsSql).not.toContain("reverts_record_id");
      await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(6);
    });
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
