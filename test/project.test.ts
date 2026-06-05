import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "../worker/constants";
import { signSessionToken } from "../worker/crypto";
import worker from "../worker/index";
import {
  PROJECTS_REGISTRY_NAME,
  parseProjectRegistryCacheValue,
  projectRegistryCacheKey,
  serializeProjectRegistryCacheValue,
  type ProjectMember,
} from "../worker/project";

const AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
const LOGIN_EMAIL_FROM = "login@example.com";

interface TestEnv {
  env: Env;
}

interface ProjectResponse {
  id: string;
  name: string;
  owner: string;
  acl: { type: "public" } | { type: "restricted"; emails: string[] };
  members: ProjectMember[];
  records: unknown[];
  balance: Record<string, number>;
}

interface ProjectSummaryResponse {
  projects: Array<{
    id: string;
    name: string;
    owner: string;
    member: ProjectMember | null;
    balance: number | null;
    updatedAt: number;
  }>;
}

function makeEnv(overrides: Partial<Env> = {}): TestEnv {
  return {
    env: {
      ...env,
      AUTH_SECRET,
      LOGIN_EMAIL_FROM,
      ALLOWED_LOGIN_EMAILS:
        "owner@example.com,member@example.com,outsider@example.com,carol@example.com",
      SEND_EMAIL: { send: vi.fn() } as unknown as SendEmail,
      ...overrides,
    } as Env,
  };
}

async function dispatch(path: string, testEnv: Env, init: RequestInit = {}): Promise<Response> {
  const apiPath = path.startsWith("/api/") ? path : `/api${path}`;
  const request = new Request(`https://seisan.test${apiPath}`, init);
  const context = createExecutionContext();
  const response = await worker.fetch(
    request as Request<unknown, IncomingRequestCfProperties>,
    testEnv,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

async function authHeaders(email = "owner@example.com"): Promise<HeadersInit> {
  const { token } = await signSessionToken(email, AUTH_SECRET);
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

function jsonBody(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  headers?: HeadersInit,
): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  };
}

async function createProject(
  testEnv: Env,
  input: {
    acl?: { type: "public" } | { type: "restricted"; emails: string[] };
    owner?: string;
    ownerMemberName?: string;
    name?: string;
  } = {},
): Promise<ProjectResponse> {
  const response = await dispatch(
    "/project",
    testEnv,
    jsonBody(
      "PUT",
      {
        name: input.name ?? "Day Trip",
        acl: input.acl ?? { type: "public" },
        ownerMemberName: input.ownerMemberName,
      },
      await authHeaders(input.owner ?? "owner@example.com"),
    ),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as ProjectResponse;
  await waitForProjectCache(testEnv, body.id);
  return body;
}

async function getProject(
  testEnv: Env,
  projectId: string,
  email = "owner@example.com",
): Promise<ProjectResponse> {
  const response = await dispatch(`/project/${projectId}`, testEnv, {
    headers: await authHeaders(email),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ProjectResponse;
}

async function createMember(
  testEnv: Env,
  projectId: string,
  name: string,
  email = "owner@example.com",
): Promise<ProjectMember> {
  const response = await dispatch(
    `/project/${projectId}/members`,
    testEnv,
    jsonBody("POST", { name }, await authHeaders(email)),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { member: ProjectMember }).member;
}

async function waitForProjectCache(testEnv: Env, projectId: string) {
  const cacheKey = projectRegistryCacheKey(projectId);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const cacheValue = await testEnv.PROJECT_REGISTRY_CACHE.get(cacheKey);
    const cachedProject = parseProjectRegistryCacheValue(cacheValue ?? "");
    if (cachedProject) {
      return cachedProject;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for project registry cache for ${projectId}`);
}

async function waitForProjectCacheMissRepair(testEnv: Env, projectId: string) {
  const cacheKey = projectRegistryCacheKey(projectId);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const cacheValue = await testEnv.PROJECT_REGISTRY_CACHE.get(cacheKey);
    if (parseProjectRegistryCacheValue(cacheValue ?? "")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for project registry cache repair for ${projectId}`);
}

describe("project worker", () => {
  it("rejects malformed project IDs before touching lookup storage", async () => {
    const cacheGet = vi.fn(() => {
      throw new Error("PROJECT_REGISTRY_CACHE should not be touched");
    });
    const { env: testEnv } = makeEnv({
      PROJECT_REGISTRY_CACHE: { get: cacheGet } as unknown as KVNamespace,
    });

    const response = await dispatch("/project/not-a-uuid", testEnv, {
      headers: await authHeaders(),
    });

    expect(response.status).toBe(404);
    expect(cacheGet).not.toHaveBeenCalled();

    const postResponse = await dispatch(
      "/project/not-a-uuid",
      testEnv,
      jsonBody("POST", { malformed: true }, await authHeaders()),
    );
    expect(postResponse.status).toBe(404);
    expect(cacheGet).not.toHaveBeenCalled();
  });

  it("uses the registry on cache miss and does not hit ProjectStore for unknown UUIDs", async () => {
    const projectStoreGet = vi.fn(() => {
      throw new Error("PROJECT_STORE should not be touched");
    });
    const { env: testEnv } = makeEnv({
      PROJECT_STORE: { get: projectStoreGet } as unknown as Env["PROJECT_STORE"],
    });

    const response = await dispatch(`/project/${crypto.randomUUID()}`, testEnv, {
      headers: await authHeaders(),
    });

    expect(response.status).toBe(404);
    expect(projectStoreGet).not.toHaveBeenCalled();
  });

  it("uses cached project DO IDs without consulting the registry", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const registryGetByName = vi.fn(() => {
      throw new Error("PROJECTS_REGISTRY should not be touched");
    });

    const response = await dispatch(
      `/project/${project.id}`,
      {
        ...testEnv,
        PROJECTS_REGISTRY: { getByName: registryGetByName } as unknown as Env["PROJECTS_REGISTRY"],
      } as Env,
      {
        headers: await authHeaders(),
      },
    );

    expect(response.status).toBe(200);
    expect(registryGetByName).not.toHaveBeenCalled();
  });

  it("repairs missing cache for older registry rows after lookup", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const cacheKey = projectRegistryCacheKey(project.id);
    await testEnv.PROJECT_REGISTRY_CACHE.delete(cacheKey);
    await runInDurableObject(
      testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME),
      async (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE projects SET created_at = ? WHERE id = ?",
          Date.now() - 11 * 60 * 1000,
          project.id,
        );
      },
    );

    const response = await dispatch(`/project/${project.id}`, testEnv, {
      headers: await authHeaders(),
    });

    expect(response.status).toBe(200);
    await waitForProjectCacheMissRepair(testEnv, project.id);
    const cacheValue = await testEnv.PROJECT_REGISTRY_CACHE.get(cacheKey);
    expect(parseProjectRegistryCacheValue(cacheValue ?? "")?.doId).toMatch(/^[0-9a-f]{64}$/u);
  });

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
        nowMs: Date.now(),
      });
    });

    expect(registered).toEqual({ ok: true });
    for (let attempt = 0; attempt < 20 && cachePut.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(cachePut).toHaveBeenCalledOnce();
  });

  it("maps stale cache entries pointing to uninitialized project DOs to 404", async () => {
    const { env: testEnv } = makeEnv();
    const projectId = crypto.randomUUID();
    const projectDoId = testEnv.PROJECT_STORE.newUniqueId().toString();
    await testEnv.PROJECT_REGISTRY_CACHE.put(
      projectRegistryCacheKey(projectId),
      serializeProjectRegistryCacheValue({ doId: projectDoId }),
    );

    const response = await dispatch(`/project/${projectId}`, testEnv, {
      headers: await authHeaders(),
    });

    expect(response.status).toBe(404);
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

    const listed = await dispatch("/projects", testEnv, {
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
      }),
    );

    const outsiderList = await dispatch("/projects", testEnv, {
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

  it("creates restricted projects and enforces ACLs separately from members", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, {
      acl: { type: "restricted", emails: ["member@example.com"] },
      ownerMemberName: "Alice",
    });

    const guest = await dispatch(`/project/${project.id}`, testEnv);
    expect(guest.status).toBe(403);

    const outsider = await dispatch(`/project/${project.id}`, testEnv, {
      headers: await authHeaders("outsider@example.com"),
    });
    expect(outsider.status).toBe(403);

    const member = await getProject(testEnv, project.id, "member@example.com");
    expect(member).toMatchObject({
      owner: "owner@example.com",
      acl: { type: "restricted", emails: ["member@example.com"] },
      members: [{ id: 1, name: "Alice", deleted: false, linkedEmail: "owner@example.com" }],
      records: [],
      balance: {},
    });

    const owner = await getProject(testEnv, project.id, "owner@example.com");
    expect(owner.members[0]).toMatchObject({
      id: 1,
      name: "Alice",
      deleted: false,
      linkedEmail: "owner@example.com",
    });
  });

  it("allows guests to read public projects with linked email visibility", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    await createMember(testEnv, project.id, "Bob");

    const guest = await dispatch(`/project/${project.id}`, testEnv);

    expect(guest.status).toBe(200);
    const guestBody = (await guest.json()) as ProjectResponse;
    expect(guestBody).toMatchObject({
      id: project.id,
      owner: "owner@example.com",
      acl: { type: "public" },
      members: [
        { id: 1, name: "Alice", deleted: false, linkedEmail: "owner@example.com" },
        { id: 2, name: "Bob", deleted: false },
      ],
      records: [],
      balance: {},
    });
  });

  it("lets the owner manage ACL emails and type", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, {
      acl: { type: "restricted", emails: ["member@example.com"] },
    });

    const outsiderAppend = await dispatch(
      `/project/${project.id}/acl/emails`,
      testEnv,
      jsonBody(
        "POST",
        { emails: ["outsider@example.com"] },
        await authHeaders("outsider@example.com"),
      ),
    );
    expect(outsiderAppend.status).toBe(403);

    const ownerAppend = await dispatch(
      `/project/${project.id}/acl/emails`,
      testEnv,
      jsonBody(
        "POST",
        { emails: ["outsider@example.com"] },
        await authHeaders("owner@example.com"),
      ),
    );
    expect(ownerAppend.status).toBe(204);

    const outsider = await dispatch(`/project/${project.id}`, testEnv, {
      headers: await authHeaders("outsider@example.com"),
    });
    expect(outsider.status).toBe(200);

    const ownerRemove = await dispatch(
      `/project/${project.id}/acl/emails`,
      testEnv,
      jsonBody(
        "DELETE",
        { emails: ["member@example.com"] },
        await authHeaders("owner@example.com"),
      ),
    );
    expect(ownerRemove.status).toBe(204);

    const member = await dispatch(`/project/${project.id}`, testEnv, {
      headers: await authHeaders("member@example.com"),
    });
    expect(member.status).toBe(403);

    const setPublic = await dispatch(
      `/project/${project.id}/acl/type`,
      testEnv,
      jsonBody("PUT", { type: "public" }, await authHeaders("owner@example.com")),
    );
    expect(setPublic.status).toBe(204);

    const publicMember = await dispatch(`/project/${project.id}`, testEnv, {
      headers: await authHeaders("member@example.com"),
    });
    expect(publicMember.status).toBe(200);
  });

  it("supports placeholder members, member claiming, and member-keyed records", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");

    const expense = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -2000, "2": 2000 },
          description: {
            type: "expense",
            name: "Tickets",
            paid: { "1": 2000 },
            liability: { "2": 2000 },
          },
        },
        await authHeaders("owner@example.com"),
      ),
    );
    expect(expense.status).toBe(201);
    expect(await expense.json()).toEqual({ id: 1 });

    const bobJoin = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders("member@example.com")),
    );
    expect(bobJoin.status).toBe(201);
    expect(await bobJoin.json()).toEqual({
      member: { id: 2, name: "Bob", deleted: false, linkedEmail: "member@example.com" },
    });

    const bobView = await getProject(testEnv, project.id, "member@example.com");
    expect(bobView.balance).toEqual({ "1": -2000, "2": 2000 });
    expect(bobView.members).toEqual([
      { id: 1, name: "Alice", deleted: false, linkedEmail: "owner@example.com" },
      { id: 2, name: "Bob", deleted: false, linkedEmail: "member@example.com" },
    ]);

    const bobProjects = await dispatch("/projects", testEnv, {
      headers: await authHeaders("member@example.com"),
    });
    expect(bobProjects.status).toBe(200);
    expect(((await bobProjects.json()) as ProjectSummaryResponse).projects).toContainEqual(
      expect.objectContaining({
        id: project.id,
        member: expect.objectContaining({ id: 2, name: "Bob" }),
      }),
    );

    const transfer = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": 500, "2": -500 },
          description: { type: "transfer", from: 2, to: 1, amount: 500 },
        },
        await authHeaders("member@example.com"),
      ),
    );
    expect(transfer.status).toBe(201);

    const ownerView = await getProject(testEnv, project.id);
    expect(ownerView.balance).toEqual({ "1": -1500, "2": 1500 });
    expect(ownerView.records).toMatchObject([{ id: 2, authorMemberId: 2 }, { id: 1 }]);
  });

  it("paginates records with an exclusive id offset", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);

    for (const name of ["First", "Second", "Third"]) {
      const response = await dispatch(
        `/project/${project.id}`,
        testEnv,
        jsonBody(
          "POST",
          {
            delta: {},
            description: {
              type: "expense",
              name,
              paid: { "1": 100 },
              liability: { "1": 100 },
            },
          },
          await authHeaders(),
        ),
      );
      expect(response.status).toBe(201);
    }

    const newestPage = await dispatch(`/project/${project.id}?limit=2`, testEnv, {
      headers: await authHeaders(),
    });
    expect(newestPage.status).toBe(200);
    expect(((await newestPage.json()) as ProjectResponse).records).toMatchObject([
      { id: 3 },
      { id: 2 },
    ]);

    const nextPage = await dispatch(`/project/${project.id}?limit=2&offset=3`, testEnv, {
      headers: await authHeaders(),
    });
    expect(nextPage.status).toBe(200);
    expect(((await nextPage.json()) as ProjectResponse).records).toMatchObject([
      { id: 2 },
      { id: 1 },
    ]);

    const finalPage = await dispatch(`/project/${project.id}?limit=2&offset=2`, testEnv, {
      headers: await authHeaders(),
    });
    expect(finalPage.status).toBe(200);
    expect(((await finalPage.json()) as ProjectResponse).records).toMatchObject([{ id: 1 }]);

    const invalidOffset = await dispatch(`/project/${project.id}?offset=0`, testEnv, {
      headers: await authHeaders(),
    });
    expect(invalidOffset.status).toBe(400);
  });

  it("lets a new user join by creating and claiming a member", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);

    const carolJoin = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { name: "Carol" }, await authHeaders("carol@example.com")),
    );

    expect(carolJoin.status).toBe(201);
    expect(await carolJoin.json()).toEqual({
      member: { id: 2, name: "Carol", deleted: false, linkedEmail: "carol@example.com" },
    });

    const duplicateJoin = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { name: "Carol" }, await authHeaders("member@example.com")),
    );
    expect(duplicateJoin.status).toBe(400);
  });

  it("allows owner and self to rename or unlink members", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const bob = await createMember(testEnv, project.id, "Bob");
    await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders("member@example.com")),
    );

    const outsiderPatch = await dispatch(
      `/project/${project.id}/members/${bob.id}`,
      testEnv,
      jsonBody("PATCH", { name: "Robert" }, await authHeaders("carol@example.com")),
    );
    expect(outsiderPatch.status).toBe(403);

    const selfRename = await dispatch(
      `/project/${project.id}/members/${bob.id}`,
      testEnv,
      jsonBody("PATCH", { name: "Robert" }, await authHeaders("member@example.com")),
    );
    expect(selfRename.status).toBe(200);
    expect(await selfRename.json()).toEqual({
      member: { id: bob.id, name: "Robert", deleted: false, linkedEmail: "member@example.com" },
    });

    const selfUnlink = await dispatch(
      `/project/${project.id}/members/${bob.id}`,
      testEnv,
      jsonBody("PATCH", { email: "" }, await authHeaders("member@example.com")),
    );
    expect(selfUnlink.status).toBe(200);
    expect(await selfUnlink.json()).toEqual({
      member: { id: bob.id, name: "Robert", deleted: false },
    });

    const postAfterUnlink = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -100, "2": 100 },
          description: {
            type: "expense",
            name: "Snack",
            paid: { "1": 100 },
            liability: { "2": 100 },
          },
        },
        await authHeaders("member@example.com"),
      ),
    );
    expect(postAfterUnlink.status).toBe(403);

    const selfProjectsAfterUnlink = await dispatch("/projects", testEnv, {
      headers: await authHeaders("member@example.com"),
    });
    expect(selfProjectsAfterUnlink.status).toBe(200);
    expect(((await selfProjectsAfterUnlink.json()) as ProjectSummaryResponse).projects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );

    const ownerRename = await dispatch(
      `/project/${project.id}/members/${bob.id}`,
      testEnv,
      jsonBody("PATCH", { name: "Bobby" }, await authHeaders("owner@example.com")),
    );
    expect(ownerRename.status).toBe(200);
    expect(await ownerRename.json()).toEqual({
      member: { id: bob.id, name: "Bobby", deleted: false },
    });
  });

  it("lets non-owner linked members leave without changing ACL", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, {
      acl: { type: "restricted", emails: ["member@example.com"] },
    });
    const bob = await createMember(testEnv, project.id, "Bob");

    const bobJoin = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders("member@example.com")),
    );
    expect(bobJoin.status).toBe(201);

    const ownerLeave = await dispatch(`/project/${project.id}/leave`, testEnv, {
      method: "POST",
      headers: await authHeaders("owner@example.com"),
    });
    expect(ownerLeave.status).toBe(403);

    const bobLeave = await dispatch(`/project/${project.id}/leave`, testEnv, {
      method: "POST",
      headers: await authHeaders("member@example.com"),
    });
    expect(bobLeave.status).toBe(204);

    const bobView = await getProject(testEnv, project.id, "member@example.com");
    expect(bobView.acl).toEqual({ type: "restricted", emails: ["member@example.com"] });
    expect(bobView.members).toEqual([
      { id: 1, name: "owner", deleted: false, linkedEmail: "owner@example.com" },
      { id: 2, name: "Bob", deleted: false },
    ]);

    const postAfterLeave = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: {},
          description: {
            type: "expense",
            name: "Snack",
            paid: { "1": 100 },
            liability: { "1": 100 },
          },
        },
        await authHeaders("member@example.com"),
      ),
    );
    expect(postAfterLeave.status).toBe(403);

    const bobProjects = await dispatch("/projects", testEnv, {
      headers: await authHeaders("member@example.com"),
    });
    expect(bobProjects.status).toBe(200);
    expect(((await bobProjects.json()) as ProjectSummaryResponse).projects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );
  });

  it("soft-deletes only zero-balance members and preserves historical records", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const bob = await createMember(testEnv, project.id, "Bob");

    const historicalRecord = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: {},
          description: {
            type: "expense",
            name: "Bob paid himself",
            paid: { [String(bob.id)]: 100 },
            liability: { [String(bob.id)]: 100 },
          },
        },
        await authHeaders("owner@example.com"),
      ),
    );
    expect(historicalRecord.status).toBe(201);

    const nonOwnerDelete = await dispatch(`/project/${project.id}/members/${bob.id}`, testEnv, {
      method: "DELETE",
      headers: await authHeaders("member@example.com"),
    });
    expect(nonOwnerDelete.status).toBe(403);

    const ownerDelete = await dispatch(`/project/${project.id}/members/${bob.id}`, testEnv, {
      method: "DELETE",
      headers: await authHeaders("owner@example.com"),
    });
    expect(ownerDelete.status).toBe(204);

    const afterDelete = await getProject(testEnv, project.id);
    expect(afterDelete.members).toEqual([
      { id: 1, name: "owner", deleted: false, linkedEmail: "owner@example.com" },
      { id: 2, name: "Bob", deleted: true },
    ]);
    expect(afterDelete.records).toMatchObject([{ id: 1 }]);

    const claimDeleted = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders("member@example.com")),
    );
    expect(claimDeleted.status).toBe(404);

    const renameDeleted = await dispatch(
      `/project/${project.id}/members/${bob.id}`,
      testEnv,
      jsonBody("PATCH", { name: "Robert" }, await authHeaders("owner@example.com")),
    );
    expect(renameDeleted.status).toBe(409);

    const recordWithDeleted = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -100, "2": 100 },
          description: {
            type: "expense",
            name: "Invalid",
            paid: { "1": 100 },
            liability: { "2": 100 },
          },
        },
        await authHeaders("owner@example.com"),
      ),
    );
    expect(recordWithDeleted.status).toBe(400);
  });

  it("rejects deleting members with non-zero balances", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const bob = await createMember(testEnv, project.id, "Bob");

    await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -2000, "2": 2000 },
          description: {
            type: "expense",
            name: "Tickets",
            paid: { "1": 2000 },
            liability: { "2": 2000 },
          },
        },
        await authHeaders(),
      ),
    );

    const deleteBob = await dispatch(`/project/${project.id}/members/${bob.id}`, testEnv, {
      method: "DELETE",
      headers: await authHeaders(),
    });

    expect(deleteBob.status).toBe(409);
    expect(await deleteBob.json()).toEqual({ error: "nonzero_balance" });
  });

  it("supports one revert per non-revert record", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    await createMember(testEnv, project.id, "Bob");

    await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -2000, "2": 2000 },
          description: {
            type: "expense",
            name: "Tickets",
            paid: { "1": 2000 },
            liability: { "2": 2000 },
          },
        },
        await authHeaders(),
      ),
    );

    const revert = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": 2000, "2": -2000 },
          description: { type: "revert", id: 1 },
        },
        await authHeaders(),
      ),
    );
    expect(revert.status).toBe(201);
    expect(await revert.json()).toEqual({ id: 2 });

    const doubleRevert = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": 2000, "2": -2000 },
          description: { type: "revert", id: 1 },
        },
        await authHeaders(),
      ),
    );
    expect(doubleRevert.status).toBe(400);

    const revertRevert = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -2000, "2": 2000 },
          description: { type: "revert", id: 2 },
        },
        await authHeaders(),
      ),
    );
    expect(revertRevert.status).toBe(400);

    const response = await getProject(testEnv, project.id);
    expect(response).toMatchObject({ balance: {}, records: [{ id: 2 }, { id: 1 }] });
  });

  it("runs migrations for project durable objects", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const cacheValue = await testEnv.PROJECT_REGISTRY_CACHE.get(
      projectRegistryCacheKey(project.id),
    );
    const cachedProject = parseProjectRegistryCacheValue(cacheValue ?? "");
    expect(cachedProject?.doId).toMatch(/^[0-9a-f]{64}$/u);

    await runInDurableObject(
      testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME),
      async (_instance, state) => {
        await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(2);
      },
    );
    await runInDurableObject(
      testEnv.PROJECT_STORE.get(testEnv.PROJECT_STORE.idFromString(cachedProject?.doId ?? "")),
      async (_instance, state) => {
        await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(1);
        await expect(state.storage.get<boolean>("initialized")).resolves.toBe(true);
      },
    );
  });
});
