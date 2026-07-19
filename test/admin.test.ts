import * as jose from "jose";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeEmail } from "../worker/email";
import {
  BUILTIN_DEFAULT_LIMITS,
  LIMITS_STORE_NAME,
  LIMIT_DEFINITIONS,
  LimitsKvStore,
} from "../worker/limits";
import { PROJECTS_REGISTRY_NAME } from "../worker/project";
import {
  adminDispatch,
  authHeaders,
  cleanupWorkerTestState,
  createMember,
  createProject,
  dispatch,
  jsonBody,
  limitsDocument,
  makeEnv,
  runProjectSummaryAlarm,
} from "./workerTestHelpers";

describe("admin routes", () => {
  afterEach(cleanupWorkerTestState);

  it("manages default and user limits through local admin endpoints", async () => {
    const { env: testEnv } = makeEnv();
    const missingDefault = await adminDispatch("/limits/default", testEnv);
    expect(missingDefault.status).toBe(200);
    expect(await missingDefault.json()).toEqual({});

    const defaultLimits = limitsDocument({
      "projects.maxOwnedProjects": 2,
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
    const missingUser = await adminDispatch(
      `/limits/user/${encodeURIComponent(normalizedUserEmail)}`,
      testEnv,
    );
    expect(missingUser.status).toBe(200);
    expect(await missingUser.json()).toEqual({});

    const userLimits = limitsDocument({
      "money.maxAmountCents": 42,
      "records.allow_post": false,
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

  it("serves admin limit built-ins and schema metadata", async () => {
    const { env: testEnv } = makeEnv();

    const builtIn = await adminDispatch("/limits/built-in", testEnv);
    expect(builtIn.status).toBe(200);
    expect(await builtIn.json()).toEqual(BUILTIN_DEFAULT_LIMITS);

    const schema = await adminDispatch("/limits-schema", testEnv);
    expect(schema.status).toBe(200);
    const schemaBody = await schema.json();
    expect(schemaBody).toEqual(LIMIT_DEFINITIONS);
    expect(schemaBody).toContainEqual({ name: "records.allow_post", type: "boolean" });
    expect(schemaBody).not.toContainEqual(expect.objectContaining({ type: "option<timestamp>" }));
  });

  it("protects admin endpoints with Cloudflare Access outside local dev", async () => {
    const { env: testEnv } = makeEnv();

    const localWhoami = await adminDispatch("/whoami", testEnv);
    expect(localWhoami.status).toBe(200);
    expect(await localWhoami.json()).toEqual({ ok: true, email: null, local: true });

    const localLogin = await adminDispatch(
      `/login?returnTo=${encodeURIComponent("/admin/limit/test@example.com?tab=limits#row")}`,
      testEnv,
    );
    expect(localLogin.status).toBe(302);
    expect(localLogin.headers.get("Location")).toBe("/admin/limit/test@example.com?tab=limits#row");

    const unsafeLogin = await adminDispatch(
      `/login?returnTo=${encodeURIComponent("https://evil.example/admin")}`,
      testEnv,
    );
    expect(unsafeLogin.status).toBe(302);
    expect(unsafeLogin.headers.get("Location")).toBe("/admin");

    const missingToken = await adminDispatch("/whoami", testEnv, {}, "https://seisan.test");
    expect(missingToken.status).toBe(403);

    vi.spyOn(jose, "createRemoteJWKSet").mockReturnValue((async () => {
      throw new Error("jwtVerify is mocked for this test.");
    }) as unknown as ReturnType<typeof jose.createRemoteJWKSet>);
    vi.spyOn(jose, "jwtVerify").mockResolvedValue({
      payload: { email: "admin@example.com" },
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const validToken = await adminDispatch(
      "/whoami",
      testEnv,
      { headers: { "Cf-Access-Jwt-Assertion": "mock-access-jwt" } },
      "https://seisan.test",
    );

    expect(validToken.status).toBe(200);
    expect(await validToken.json()).toEqual({ ok: true, email: "admin@example.com", local: false });
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

    const invalidLeaf = await adminDispatch(
      "/limits/default",
      testEnv,
      jsonBody("PUT", { "projects.unknownLimit": 1 }),
    );
    expect(invalidLeaf.status).toBe(400);

    const invalidEffective = await adminDispatch(
      "/limits/default",
      testEnv,
      jsonBody("PUT", { "records.maxPageSize": 1 }),
    );
    expect(invalidEffective.status).toBe(400);
    await expect(testEnv.CONFIGS.get(LimitsKvStore.defaultKey())).resolves.toBeNull();
  });

  it("allows global limit updates without scanning existing user overrides", async () => {
    const { env: testEnv } = makeEnv();
    const userEmail = `limit-user-${crypto.randomUUID()}@example.com`;
    const defaultLimits = { "records.defaultPageSize": 5, "records.maxPageSize": 5 };

    const putUser = await adminDispatch(
      `/limits/user/${encodeURIComponent(userEmail)}`,
      testEnv,
      jsonBody("PUT", { "records.defaultPageSize": 10 }),
    );
    expect(putUser.status).toBe(204);

    const putDefault = await adminDispatch(
      "/limits/default",
      testEnv,
      jsonBody("PUT", defaultLimits),
    );
    expect(putDefault.status).toBe(204);
    await expect(testEnv.CONFIGS.get(LimitsKvStore.defaultKey(), "json")).resolves.toEqual(
      defaultLimits,
    );
  });

  it("treats legacy unreadable stored limit documents as empty overrides", async () => {
    const { env: testEnv } = makeEnv();
    const userEmail = `legacy-limit-${crypto.randomUUID()}@example.com`;

    await runInDurableObject(
      testEnv.LIMITS_STORE.getByName(LIMITS_STORE_NAME),
      async (_instance, state) => {
        state.storage.sql.exec(
          `INSERT INTO limits (limit_key, limit_json, updated_at)
           VALUES (?, ?, ?)`,
          "default",
          JSON.stringify({ projects: { maxOwnedProjects: 10 } }),
          1,
        );
        state.storage.sql.exec(
          `INSERT INTO limits (limit_key, limit_json, updated_at)
           VALUES (?, ?, ?)`,
          `user:${normalizeEmail(userEmail)}`,
          JSON.stringify({ money: { maxAmountCents: 10_000 } }),
          1,
        );
      },
    );

    const getDefault = await adminDispatch("/limits/default", testEnv);
    expect(getDefault.status).toBe(200);
    expect(await getDefault.json()).toEqual({});

    const getUser = await adminDispatch(`/limits/user/${encodeURIComponent(userEmail)}`, testEnv);
    expect(getUser.status).toBe(200);
    expect(await getUser.json()).toEqual({});

    const putDefault = await adminDispatch(
      "/limits/default",
      testEnv,
      jsonBody("PUT", { "records.defaultPageSize": 5, "records.maxPageSize": 5 }),
    );
    expect(putDefault.status).toBe(204);
  });

  it("lists admin projects with pagination, owner filtering, record ordering, and updated ordering", async () => {
    const { env: testEnv } = makeEnv();
    const ownerA = `admin-projects-a-${crypto.randomUUID()}@example.com`;
    const ownerB = `admin-projects-b-${crypto.randomUUID()}@example.com`;
    const projectA = await createProject(testEnv, {
      owner: ownerA,
      name: "Project A",
      ownerMemberName: "Alice",
    });
    const projectB = await createProject(testEnv, {
      owner: ownerB,
      name: "Project B",
      ownerMemberName: "Bea",
    });
    const projectC = await createProject(testEnv, {
      owner: ownerA,
      name: "Project C",
      ownerMemberName: "Cora",
    });

    await appendTransferRecords(testEnv, projectA.id, ownerA, 2);
    await appendTransferRecords(testEnv, projectB.id, ownerB, 1);
    expect(await runProjectSummaryAlarm(testEnv, projectC.id)).toBe(true);
    expect((await adminDispatch("/projects?limit=1", testEnv)).status).toBe(200);
    await setRegistrySummaryUpdatedAt(testEnv, [
      { projectId: projectA.id, updatedAt: 1000 },
      { projectId: projectB.id, updatedAt: 2000 },
      { projectId: projectC.id, updatedAt: 3000 },
    ]);

    const firstPage = await adminDispatch("/projects?limit=2&sort=records_desc", testEnv);
    expect(firstPage.status).toBe(200);
    const firstPageBody = (await firstPage.json()) as AdminProjectsResponse;
    expect(firstPageBody.projects.map((project) => project.name)).toEqual([
      "Project A",
      "Project B",
    ]);
    expect(firstPageBody.projects.map((project) => project.recordCount)).toEqual([2, 1]);
    expect(firstPageBody.projects.map((project) => project.memberCount)).toEqual([1, 1]);
    expect(firstPageBody.page).toMatchObject({ limit: 2, offset: 0, total: 3, hasMore: true });

    const newestPage = await adminDispatch("/projects?limit=2&sort=updated_desc", testEnv);
    expect(newestPage.status).toBe(200);
    const newestPageBody = (await newestPage.json()) as AdminProjectsResponse;
    expect(newestPageBody.projects.map((project) => project.name)).toEqual([
      "Project C",
      "Project B",
    ]);

    const ownerOldest = await adminDispatch(
      `/projects?ownerEmail=${encodeURIComponent(ownerA)}&sort=updated_asc`,
      testEnv,
    );
    expect(ownerOldest.status).toBe(200);
    const ownerOldestBody = (await ownerOldest.json()) as AdminProjectsResponse;
    expect(ownerOldestBody.projects.map((project) => project.name)).toEqual([
      "Project A",
      "Project C",
    ]);
    expect(ownerOldestBody.projects.map((project) => project.recordCount)).toEqual([2, 0]);
    expect(ownerOldestBody.projects.map((project) => project.memberCount)).toEqual([1, 1]);
    expect(ownerOldestBody.page).toMatchObject({
      limit: 25,
      offset: 0,
      total: 2,
      hasMore: false,
    });
  });

  it("lists admin users ordered by owned project count, then record count", async () => {
    const { env: testEnv } = makeEnv();
    const ownerA = `admin-users-a-${crypto.randomUUID()}@example.com`;
    const ownerB = `admin-users-b-${crypto.randomUUID()}@example.com`;
    const projectA1 = await createProject(testEnv, { owner: ownerA, name: "A1" });
    const projectA2 = await createProject(testEnv, { owner: ownerA, name: "A2" });
    const projectB = await createProject(testEnv, { owner: ownerB, name: "B1" });

    await appendTransferRecords(testEnv, projectA1.id, ownerA, 1);
    expect(await runProjectSummaryAlarm(testEnv, projectA2.id)).toBe(true);
    await appendTransferRecords(testEnv, projectB.id, ownerB, 3);

    const response = await adminDispatch("/users", testEnv);
    expect(response.status).toBe(200);
    const body = (await response.json()) as AdminUsersResponse;
    expect(body.users.findIndex((user) => user.owner === ownerA)).toBeLessThan(
      body.users.findIndex((user) => user.owner === ownerB),
    );
    expect(body.users).toContainEqual(
      expect.objectContaining({ owner: ownerA, projectCount: 2, recordCount: 1 }),
    );
    expect(body.users).toContainEqual(
      expect.objectContaining({ owner: ownerB, projectCount: 1, recordCount: 3 }),
    );
    expect(body.page.limit).toBe(25);
    expect(body.page.offset).toBe(0);
    expect(body.page.total).toBeGreaterThanOrEqual(2);
  });

  // TODO: remove this after backfill 20260620-project-summary-record-count is fully done.
  it("backfills registry summary record counts from project stores", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `admin-record-backfill-${crypto.randomUUID()}@example.com`;
    const project = await createProject(testEnv, { owner, name: "Backfilled Records" });
    await appendTransferRecords(testEnv, project.id, owner, 2);

    await runInDurableObject(
      testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME),
      async (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE project_summaries SET record_count = 0 WHERE project_id = ?",
          project.id,
        );
        await state.storage.delete("dbBackfillState");
      },
    );

    const response = await adminDispatch(
      `/projects?ownerEmail=${encodeURIComponent(owner)}`,
      testEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as AdminProjectsResponse;
    expect(body.projects).toContainEqual(
      expect.objectContaining({
        id: project.id,
        recordCount: 2,
      }),
    );

    await runInDurableObject(
      testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME),
      async (_instance, state) => {
        await expect(state.storage.get<string>("dbBackfillState")).resolves.toBe(
          "20260620-project-summary-record-count",
        );
      },
    );
  });
});

interface AdminProjectsResponse {
  projects: Array<{
    id: string;
    name: string;
    owner: string;
    recordCount: number;
    memberCount: number;
    updatedAt: number;
    lastSyncAt: number;
  }>;
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

interface AdminUsersResponse {
  users: Array<{
    owner: string;
    projectCount: number;
    recordCount: number;
    updatedAt: number;
  }>;
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

async function setRegistrySummaryUpdatedAt(
  testEnv: Env,
  updates: Array<{ projectId: string; updatedAt: number }>,
): Promise<void> {
  await runInDurableObject(
    testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME),
    async (_instance, state) => {
      for (const update of updates) {
        state.storage.sql.exec(
          "UPDATE project_summaries SET updated_at = ? WHERE project_id = ?",
          update.updatedAt,
          update.projectId,
        );
      }
    },
  );
}

async function appendTransferRecords(
  testEnv: Env,
  projectId: string,
  owner: string,
  count: number,
): Promise<void> {
  const member = await createMember(testEnv, projectId, `Member ${crypto.randomUUID()}`, owner);
  for (let index = 0; index < count; index += 1) {
    const response = await dispatch(
      `/project/${projectId}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -100, [String(member.id)]: 100 },
          description: { type: "transfer", from: 1, to: member.id, amount: 100 },
        },
        await authHeaders(owner),
      ),
    );
    expect(response.status).toBe(201);
  }
  expect(await runProjectSummaryAlarm(testEnv, projectId)).toBe(true);
}
