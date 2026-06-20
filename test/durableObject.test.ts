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
const PROJECT_METADATA_BACKFILL_NAME = "20260615-project-metadata-kv";

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
    await runInDurableObject(
      testEnv.PROJECT_STORE.get(testEnv.PROJECT_STORE.idFromString(cachedProject?.doId ?? "")),
      async (_instance, state) => {
        await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(2);
        await expect(state.storage.get<boolean>("initialized")).resolves.toBe(true);
      },
    );
  });

  it("stores project metadata in DO KV and does not require legacy SQL metadata rows", async () => {
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

      state.storage.sql.exec("DELETE FROM acl_allowed_list");
      state.storage.sql.exec("DELETE FROM project_meta");
    });

    await expect(getProject(testEnv, project.id)).resolves.toMatchObject({
      id: project.id,
      name: "KV Metadata",
      acl: { type: "restricted", emails: ["friend@example.com"] },
    });
  });

  // TODO: remove this after backfill 20260615-project-metadata-kv is fully done.
  it("backfills legacy ProjectStore SQL metadata into DO KV", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, {
      acl: { type: "restricted", emails: ["member@example.com"] },
      name: "Before Legacy Backfill",
    });
    const stub = await getProjectStoreStub(testEnv, project.id);

    await runInDurableObject(stub, async (instance, state) => {
      state.storage.sql.exec(
        `INSERT OR REPLACE INTO project_meta
          (id, public_id, name, owner_email, acl_type, next_record_id, next_member_id, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        project.id,
        "Legacy Backfill",
        "owner@example.com",
        "restricted",
        7,
        5,
        1_000,
        2_000,
      );
      state.storage.sql.exec("DELETE FROM acl_allowed_list");
      state.storage.sql.exec(
        "INSERT INTO acl_allowed_list (email) VALUES (?)",
        "legacy@example.com",
      );
      await state.storage.delete(PROJECT_METADATA_KEY);
      await state.storage.delete("dbBackfillState");
      (instance as unknown as { projectMetadata: unknown }).projectMetadata = null;
    });

    await expect(stub.ensureMetadataBackfilled({ publicId: project.id })).resolves.toEqual({
      ok: true,
    });

    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get<string>("dbBackfillState")).resolves.toBe(
        PROJECT_METADATA_BACKFILL_NAME,
      );
      const raw = await state.storage.get<string>(PROJECT_METADATA_KEY);
      expect(JSON.parse(raw ?? "")).toMatchObject({
        public_id: project.id,
        name: "Legacy Backfill",
        owner_email: "owner@example.com",
        acl_type: "restricted",
        acl_allowed_list: ["legacy@example.com"],
        next_record_id: 7,
        next_member_id: 5,
        created_at: 1_000,
        updated_at: 2_000,
      });
    });

    await expect(getProject(testEnv, project.id, "legacy@example.com")).resolves.toMatchObject({
      name: "Legacy Backfill",
      acl: { type: "restricted", emails: ["legacy@example.com"] },
    });
  });
});
