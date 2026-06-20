import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BUILTIN_DEFAULT_LIMITS } from "../worker/limits";
import {
  REGISTRY_LIST_CACHE_NAME,
  authHeaders,
  cleanupWorkerTestState,
  createMember,
  createProject,
  dispatch,
  getProject,
  getProjectStoreStub,
  getProjectSummaryAlarm,
  getRegistryListCacheResponse,
  jsonBody,
  listProjectsFromRegistry,
  makeEnv,
  registryListCacheRequest,
  runProjectSummaryAlarm,
  type ProjectSummaryResponse,
} from "./workerTestHelpers";

describe("registry routes", () => {
  afterEach(cleanupWorkerTestState);

  it("does not block project registration when registry-owned cache writes fail", async () => {
    const projectId = crypto.randomUUID();
    const cachePut = vi.fn(() => Promise.reject(new Error("kv unavailable")));
    const failingCache = {
      put: cachePut,
    } as unknown as KVNamespace;
    const { env: testEnv } = makeEnv();
    const registry = testEnv.PROJECTS_REGISTRY.getByName(`projects-${projectId}`);

    const registered = await runInDurableObject(registry, async (instance) => {
      const registryInstance = instance as unknown as {
        bindings: Env;
        registerProject: typeof registry.registerProject;
      };
      registryInstance.bindings = {
        ...testEnv,
        PROJECT_REGISTRY_CACHE: failingCache,
      };
      return registryInstance.registerProject({
        id: projectId,
        doId: testEnv.PROJECT_STORE.newUniqueId().toString(),
        ownerEmail: "owner@example.com",
        limits: BUILTIN_DEFAULT_LIMITS,
        nowMs: Date.now(),
      });
    });

    expect(registered).toEqual({ ok: true });
    for (let attempt = 0; attempt < 20 && cachePut.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(cachePut).toHaveBeenCalledOnce();
  });

  it("persists project names, lists linked projects, and allows owner rename", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, {
      name: "Road Trip",
      ownerMemberName: "Alice",
    });

    expect(project).toMatchObject({
      name: "Road Trip",
      owner: "owner@example.com",
      members: [{ id: 1, name: "Alice", linkedEmail: "owner@example.com" }],
    });

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    const listed = await dispatch("/registry", testEnv, {
      headers: await authHeaders("owner@example.com"),
    });
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as ProjectSummaryResponse;
    expect(listedBody.projects).toContainEqual(
      expect.objectContaining({
        id: project.id,
        name: "Road Trip",
        owner: "owner@example.com",
        member: expect.objectContaining({
          id: 1,
          name: "Alice",
          linkedEmail: "owner@example.com",
        }),
        balance: 0,
        lastSyncAt: expect.any(Number),
      }),
    );

    const outsiderList = await dispatch("/registry", testEnv, {
      headers: await authHeaders("outsider@example.com"),
    });
    expect(outsiderList.status).toBe(200);
    expect(await outsiderList.json()).toEqual({ projects: [] });

    const outsiderRename = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody("PATCH", { name: "Beach Trip" }, await authHeaders("outsider@example.com")),
    );
    expect(outsiderRename.status).toBe(403);

    const ownerRename = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody("PATCH", { name: "Beach Trip" }, await authHeaders("owner@example.com")),
    );
    expect(ownerRename.status).toBe(200);
    expect(await ownerRename.json()).toEqual({ name: "Beach Trip" });

    const renamed = await getProject(testEnv, project.id);
    expect(renamed.name).toBe("Beach Trip");
  });

  it("caches the registry-backed projects response for one minute", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `response-cache-${crypto.randomUUID()}@example.com`;
    const project = await createProject(testEnv, {
      owner,
      name: "Response Cache",
      ownerMemberName: "Alice",
    });
    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);

    const firstList = await dispatch("/registry", testEnv, {
      headers: await authHeaders(owner),
    });
    expect(firstList.status).toBe(200);
    expect(((await firstList.json()) as ProjectSummaryResponse).projects).toContainEqual(
      expect.objectContaining({
        id: project.id,
        name: "Response Cache",
        member: expect.objectContaining({ id: 1, name: "Alice" }),
        balance: 0,
        lastSyncAt: expect.any(Number),
      }),
    );

    const cached = await getRegistryListCacheResponse(owner);
    expect(cached).toBeDefined();
    expect(cached?.headers.get("Cache-Control")).toBe("s-maxage=10");

    const cachedList = await dispatch(
      "/registry",
      {
        ...testEnv,
        PROJECTS_REGISTRY: {
          getByName: () => {
            throw new Error("PROJECTS_REGISTRY should not be touched on projects cache hit");
          },
        } as unknown as Env["PROJECTS_REGISTRY"],
      } as Env,
      {
        headers: await authHeaders(owner),
      },
    );
    expect(cachedList.status).toBe(200);
    if (!cached) {
      throw new Error("Expected projects list response to be cached");
    }
    expect(await cachedList.json()).toEqual(await cached.clone().json());
  });

  it("serves projects from registry summaries on cache miss without activating project stores", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `registry-summary-${crypto.randomUUID()}@example.com`;
    const project = await createProject(testEnv, {
      owner,
      name: "Registry Summary",
      ownerMemberName: "Alice",
    });
    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await (await caches.open(REGISTRY_LIST_CACHE_NAME)).delete(registryListCacheRequest(owner));

    const response = await dispatch(
      "/registry",
      {
        ...testEnv,
        PROJECT_STORE: {
          get: () => {
            throw new Error("PROJECT_STORE should not be touched when listing projects");
          },
        } as unknown as Env["PROJECT_STORE"],
      } as Env,
      {
        headers: await authHeaders(owner),
      },
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as ProjectSummaryResponse).projects).toContainEqual(
      expect.objectContaining({
        id: project.id,
        name: "Registry Summary",
        balance: 0,
      }),
    );
  });

  it("batches project summary updates behind a single durable object alarm", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `summary-batch-${crypto.randomUUID()}@example.com`;
    const project = await createProject(testEnv, {
      owner,
      name: "Summary Batch",
      ownerMemberName: "Alice",
    });
    const firstAlarm = await getProjectSummaryAlarm(testEnv, project.id);
    expect(firstAlarm).toEqual(expect.any(Number));
    const stub = await getProjectStoreStub(testEnv, project.id);

    const bob = await createMember(testEnv, project.id, "Bob", owner);

    const expense = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -1000, "2": 1000 },
          description: {
            type: "expense",
            name: "Snacks",
            paid: { "1": 1000 },
            liability: { [String(bob.id)]: 1000 },
          },
        },
        await authHeaders(owner),
      ),
    );
    expect(expense.status).toBe(201);

    const nextAlarm = await getProjectSummaryAlarm(testEnv, project.id);
    expect(nextAlarm).toBe(firstAlarm);

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const projects = await listProjectsFromRegistry(testEnv, owner);
    expect(projects).toContainEqual(
      expect.objectContaining({
        id: project.id,
        name: "Summary Batch",
        balance: -1000,
        member: expect.objectContaining({ id: 1, name: "Alice" }),
        lastSyncAt: expect.any(Number),
      }),
    );
  });

  it("does not refresh project summaries on project reads", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `summary-read-${crypto.randomUUID()}@example.com`;
    const project = await createProject(testEnv, {
      owner,
      name: "Read Only Summary",
      ownerMemberName: "Alice",
    });
    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    expect(await getProjectSummaryAlarm(testEnv, project.id)).toBeNull();

    const summaryBefore = (await listProjectsFromRegistry(testEnv, owner)).find(
      (summary) => summary.id === project.id,
    );
    expect(summaryBefore?.lastSyncAt).toEqual(expect.any(Number));

    const read = await getProject(testEnv, project.id, owner);
    expect(read.id).toBe(project.id);
    expect(await getProjectSummaryAlarm(testEnv, project.id)).toBeNull();

    const summaryAfter = (await listProjectsFromRegistry(testEnv, owner)).find(
      (summary) => summary.id === project.id,
    );
    expect(summaryAfter?.lastSyncAt).toBe(summaryBefore?.lastSyncAt);
  });

  it("syncs joined and unlinked members into registry project summaries", async () => {
    const { env: testEnv } = makeEnv();
    const memberEmail = `summary-member-${crypto.randomUUID()}@example.com`;
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");

    const bobJoin = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders(memberEmail)),
    );
    expect(bobJoin.status).toBe(201);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await expect(listProjectsFromRegistry(testEnv, memberEmail)).resolves.toContainEqual(
      expect.objectContaining({
        id: project.id,
        member: expect.objectContaining({ id: bob.id, name: "Bob", linkedEmail: memberEmail }),
      }),
    );

    const bobLeave = await dispatch(`/project/${project.id}/leave`, testEnv, {
      method: "POST",
      headers: await authHeaders(memberEmail),
    });
    expect(bobLeave.status).toBe(204);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await expect(listProjectsFromRegistry(testEnv, memberEmail)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );
  });
});
