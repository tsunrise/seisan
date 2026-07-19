import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "../worker/crypto";
import {
  ABSOLUTE_LIST_LIMIT,
  BUILTIN_DEFAULT_LIMITS,
  LIMITS_STORE_NAME,
  LimitsKvStore,
} from "../worker/limits";
import { PROJECTS_REGISTRY_NAME } from "../worker/project";
import {
  authHeaders,
  cleanupWorkerTestState,
  createMember,
  createProject,
  dispatch,
  getProjectSummaryAlarm,
  getProject,
  getProjectStoreStub,
  jsonBody,
  limitsDocument,
  listProjectsFromRegistry,
  makeEnv,
  projectRefCacheKey,
  putPublishedCategories,
  putDefaultLimits,
  putUserLimits,
  runProjectSummaryAlarm,
  serializeProjectRefCacheValue,
  testCategory,
  type ProjectResponse,
  type ProjectSummaryResponse,
} from "./workerTestHelpers";

function countResponseStatuses(responses: Response[]): Partial<Record<number, number>> {
  const counts: Partial<Record<number, number>> = {};
  for (const response of responses) {
    counts[response.status] = (counts[response.status] ?? 0) + 1;
  }
  return counts;
}

function appendRecordBody(name = "Lunch") {
  return {
    delta: {},
    description: {
      type: "expense" as const,
      name,
      paid: { "1": 100 },
      liability: { "1": 100 },
    },
  };
}

function promiseRecordBody({
  debtorMemberId = 1,
  creditorMemberId = 2,
  amount = 100,
  reason,
  delta,
}: {
  debtorMemberId?: number;
  creditorMemberId?: number;
  amount?: number;
  reason?: string;
  delta?: Record<string, number>;
} = {}) {
  return {
    delta:
      delta ??
      ({
        [String(debtorMemberId)]: amount,
        [String(creditorMemberId)]: -amount,
      } as Record<string, number>),
    description: {
      type: "promise" as const,
      debtorMemberId,
      creditorMemberId,
      amount,
      ...(reason !== undefined ? { reason } : {}),
    },
  };
}

function multiTransferRecordBody(
  src: number,
  dests: Array<{ id: number; amount: number }>,
  delta: Record<string, number> = Object.fromEntries([
    [String(src), -dests.reduce((total, destination) => total + destination.amount, 0)],
    ...dests.map((destination) => [String(destination.id), destination.amount] as const),
  ]),
) {
  return {
    delta,
    description: { type: "transfer" as const, src, dests },
  };
}

function stubRateLimit(success: boolean): { binding: RateLimit; limit: ReturnType<typeof vi.fn> } {
  const limit = vi.fn(async () => ({ success }));
  return { binding: { limit } as RateLimit, limit };
}

describe("project routes", () => {
  afterEach(cleanupWorkerTestState);

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
      "/project/not-a-uuid/record",
      testEnv,
      jsonBody("POST", { malformed: true }, await authHeaders()),
    );
    expect(postResponse.status).toBe(404);
    expect(cacheGet).not.toHaveBeenCalled();
  });

  it("treats project-ref KV misses as terminal negative cache entries", async () => {
    const projectId = crypto.randomUUID();
    const cacheGet = vi.fn(() => Promise.resolve(null));
    const registryGetByName = vi.fn(() => {
      throw new Error("PROJECTS_REGISTRY should not be touched");
    });
    const projectStoreGet = vi.fn(() => {
      throw new Error("PROJECT_STORE should not be touched");
    });
    const { env: testEnv } = makeEnv({
      PROJECT_REGISTRY_CACHE: { get: cacheGet } as unknown as KVNamespace,
      PROJECTS_REGISTRY: { getByName: registryGetByName } as unknown as Env["PROJECTS_REGISTRY"],
      PROJECT_STORE: { get: projectStoreGet } as unknown as Env["PROJECT_STORE"],
    });

    const response = await dispatch(`/project/${projectId}`, testEnv, {
      headers: await authHeaders(),
    });

    expect(response.status).toBe(404);
    expect(cacheGet).toHaveBeenCalledWith(projectRefCacheKey(projectId), { cacheTtl: 60 });
    expect(registryGetByName).not.toHaveBeenCalled();
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

  it("does not fall back to the registry when existing projects are missing from KV", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const cacheKey = projectRefCacheKey(project.id);
    await testEnv.PROJECT_REGISTRY_CACHE.delete(cacheKey);
    const registryGetByName = vi.fn(() => {
      throw new Error("PROJECTS_REGISTRY should not be touched");
    });
    const projectStoreGet = vi.fn(() => {
      throw new Error("PROJECT_STORE should not be touched");
    });

    const response = await dispatch(
      `/project/${project.id}`,
      {
        ...testEnv,
        PROJECTS_REGISTRY: { getByName: registryGetByName } as unknown as Env["PROJECTS_REGISTRY"],
        PROJECT_STORE: { get: projectStoreGet } as unknown as Env["PROJECT_STORE"],
      } as Env,
      {
        headers: await authHeaders(),
      },
    );

    expect(response.status).toBe(404);
    expect(registryGetByName).not.toHaveBeenCalled();
    expect(projectStoreGet).not.toHaveBeenCalled();
  });

  it("maps stale cache entries pointing to uninitialized project DOs to 404", async () => {
    const { env: testEnv } = makeEnv();
    const projectId = crypto.randomUUID();
    const projectDoId = testEnv.PROJECT_STORE.newUniqueId().toString();
    await testEnv.PROJECT_REGISTRY_CACHE.put(
      projectRefCacheKey(projectId),
      serializeProjectRefCacheValue({ doId: projectDoId }),
    );

    const response = await dispatch(`/project/${projectId}`, testEnv, {
      headers: await authHeaders(),
    });

    expect(response.status).toBe(404);
  });

  it("validates project creation Origin only when the header is present", async () => {
    const { env: testEnv } = makeEnv();
    const projectCreateBody = (name: string) => ({
      name,
      acl: { type: "public" as const },
    });

    const forgedOrigin = await dispatch(
      "/project",
      testEnv,
      jsonBody("PUT", projectCreateBody("Forged Origin"), {
        ...(await authHeaders(`forged-origin-${crypto.randomUUID()}@example.com`)),
        Origin: "https://evil.example",
      }),
    );
    expect(forgedOrigin.status).toBe(403);
    expect(await forgedOrigin.json()).toEqual({ error: "forbidden" });

    const missingOrigin = await dispatch(
      "/project",
      testEnv,
      jsonBody(
        "PUT",
        projectCreateBody("Missing Origin"),
        await authHeaders(`missing-origin-${crypto.randomUUID()}@example.com`),
      ),
    );
    expect(missingOrigin.status).toBe(201);

    const sameOrigin = await dispatch(
      "/project",
      testEnv,
      jsonBody("PUT", projectCreateBody("Same Origin"), {
        ...(await authHeaders(`same-origin-${crypto.randomUUID()}@example.com`)),
        Origin: "https://seisan.test",
      }),
    );
    expect(sameOrigin.status).toBe(201);

    const textPlainJson = await dispatch("/project", testEnv, {
      method: "PUT",
      headers: {
        ...(await authHeaders(`text-plain-${crypto.randomUUID()}@example.com`)),
        "Content-Type": "text/plain",
      },
      body: JSON.stringify(projectCreateBody("Text Plain JSON")),
    });
    expect(textPlainJson.status).toBe(201);

    const forgedTextPlainJson = await dispatch("/project", testEnv, {
      method: "PUT",
      headers: {
        ...(await authHeaders(`forged-text-plain-${crypto.randomUUID()}@example.com`)),
        "Content-Type": "text/plain",
        Origin: "https://evil.waga.me",
      },
      body: JSON.stringify(projectCreateBody("Forged Text Plain JSON")),
    });
    expect(forgedTextPlainJson.status).toBe(403);
    expect(await forgedTextPlainJson.json()).toEqual({ error: "forbidden" });
  });

  it("enforces a per-user project cap before creating another project store", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `cap-${crypto.randomUUID()}@example.com`;
    const linkedProjectCapLimits = {
      ...BUILTIN_DEFAULT_LIMITS,
      "projects.maxOwnedProjects": Number.MAX_SAFE_INTEGER,
    };
    await runInDurableObject(
      testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME),
      async (instance) => {
        const registry = instance as unknown as {
          registerProject(input: {
            id: string;
            doId: string;
            ownerEmail: string;
            limits: typeof BUILTIN_DEFAULT_LIMITS;
            nowMs: number;
          }): { ok: boolean };
        };
        for (
          let index = 0;
          index < BUILTIN_DEFAULT_LIMITS["projects.maxLinkedProjects"];
          index += 1
        ) {
          const registered = registry.registerProject({
            id: crypto.randomUUID(),
            doId: testEnv.PROJECT_STORE.newUniqueId().toString(),
            ownerEmail: owner,
            limits: linkedProjectCapLimits,
            nowMs: Date.now() + index,
          });
          expect(registered.ok).toBe(true);
        }
      },
    );

    const response = await dispatch(
      "/project",
      testEnv,
      jsonBody(
        "PUT",
        {
          name: "Over Limit",
          acl: { type: "public" },
        },
        await authHeaders(owner),
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "project_limit_exceeded" });
  });

  it("enforces user limits for owned project caps", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `owned-cap-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      owner,
      limitsDocument({
        "projects.maxOwnedProjects": 1,
        "projects.maxLinkedProjects": 5,
      }),
    );

    await createProject(testEnv, { owner });
    const response = await dispatch(
      "/project",
      testEnv,
      jsonBody(
        "PUT",
        {
          name: "Second Project",
          acl: { type: "public" },
        },
        await authHeaders(owner),
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "project_limit_exceeded" });
  });

  it("returns specific limit errors for project creation field limits", async () => {
    const { env: testEnv } = makeEnv();

    const projectNameOwner = `project-name-limit-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      projectNameOwner,
      limitsDocument({
        "projects.maxProjectNameLength": 3,
      }),
    );
    const projectNameResponse = await dispatch(
      "/project",
      testEnv,
      jsonBody(
        "PUT",
        {
          name: "Long",
          acl: { type: "public" },
        },
        await authHeaders(projectNameOwner),
      ),
    );
    expect(projectNameResponse.status).toBe(409);
    expect(await projectNameResponse.json()).toEqual({ error: "project_limit_exceeded" });

    const memberNameOwner = `member-name-limit-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      memberNameOwner,
      limitsDocument({
        "projects.maxMemberNameLength": 3,
      }),
    );
    const memberNameResponse = await dispatch(
      "/project",
      testEnv,
      jsonBody(
        "PUT",
        {
          name: "Trip",
          acl: { type: "public" },
          ownerMemberName: "Long",
        },
        await authHeaders(memberNameOwner),
      ),
    );
    expect(memberNameResponse.status).toBe(409);
    expect(await memberNameResponse.json()).toEqual({ error: "member_limit_exceeded" });

    const aclOwner = `acl-limit-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      aclOwner,
      limitsDocument({
        "projects.maxAclEmails": 1,
      }),
    );
    const aclResponse = await dispatch(
      "/project",
      testEnv,
      jsonBody(
        "PUT",
        {
          name: "Trip",
          acl: { type: "restricted", emails: ["one@example.com", "two@example.com"] },
        },
        await authHeaders(aclOwner),
      ),
    );
    expect(aclResponse.status).toBe(409);
    expect(await aclResponse.json()).toEqual({ error: "acl_limit_exceeded" });
  });

  it("enforces user limits for linked project caps when joining", async () => {
    const { env: testEnv } = makeEnv();
    const memberEmail = `linked-cap-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      memberEmail,
      limitsDocument({
        "projects.maxLinkedProjects": 1,
        "projects.maxOwnedProjects": 5,
      }),
    );
    const firstProject = await createProject(testEnv, {
      owner: `first-owner-${crypto.randomUUID()}@example.com`,
    });
    const secondProject = await createProject(testEnv, {
      owner: `second-owner-${crypto.randomUUID()}@example.com`,
    });

    const firstJoin = await dispatch(
      `/project/${firstProject.id}/join`,
      testEnv,
      jsonBody("POST", { name: "Member" }, await authHeaders(memberEmail)),
    );
    expect(firstJoin.status).toBe(201);

    const secondJoin = await dispatch(
      `/project/${secondProject.id}/join`,
      testEnv,
      jsonBody("POST", { name: "Member" }, await authHeaders(memberEmail)),
    );
    expect(secondJoin.status).toBe(409);
    expect(await secondJoin.json()).toEqual({ error: "project_limit_exceeded" });
  });

  it("enforces owner limits for record caps", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `record-cap-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      owner,
      limitsDocument({
        "records.maxRecordsPerOwnedProject": 1,
      }),
    );
    const project = await createProject(testEnv, { owner });

    for (const [index, expectedStatus] of [201, 409].entries()) {
      const response = await dispatch(
        `/project/${project.id}/record`,
        testEnv,
        jsonBody(
          "POST",
          {
            delta: {},
            description: {
              type: "expense",
              name: `Record ${index + 1}`,
              paid: { "1": 100 },
              liability: { "1": 100 },
            },
          },
          await authHeaders(owner),
        ),
      );
      expect(response.status).toBe(expectedStatus);
      if (expectedStatus === 409) {
        expect(await response.json()).toEqual({ error: "record_limit_exceeded" });
      }
    }
  });

  it("enforces member caps under concurrent owner writes without server errors", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `member-concurrency-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      owner,
      limitsDocument({
        "projects.maxMembersPerProject": 5,
      }),
    );
    const project = await createProject(testEnv, { owner });
    const headers = await authHeaders(owner);

    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        dispatch(
          `/project/${project.id}/members`,
          testEnv,
          jsonBody("POST", { name: `Concurrent Member ${index}` }, headers),
        ),
      ),
    );

    const statuses = countResponseStatuses(responses);
    expect(statuses[500] ?? 0).toBe(0);
    expect(statuses[201]).toBe(4);
    expect(statuses[409]).toBe(8);
    for (const response of responses.filter((candidate) => candidate.status === 409)) {
      expect(await response.json()).toEqual({ error: "member_limit_exceeded" });
    }

    const projectAfterWrites = await getProject(testEnv, project.id, owner);
    expect(projectAfterWrites.members).toHaveLength(5);
    expect(new Set(projectAfterWrites.members.map((member) => member.id)).size).toBe(5);
  });

  it("enforces record caps under concurrent posts without server errors", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `record-concurrency-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      owner,
      limitsDocument({
        "records.maxRecordsPerOwnedProject": 5,
      }),
    );
    const project = await createProject(testEnv, { owner });
    const headers = await authHeaders(owner);

    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        dispatch(
          `/project/${project.id}/record`,
          testEnv,
          jsonBody(
            "POST",
            {
              delta: {},
              description: {
                type: "expense",
                name: `Concurrent Record ${index}`,
                paid: { "1": 100 },
                liability: { "1": 100 },
              },
            },
            headers,
          ),
        ),
      ),
    );

    const statuses = countResponseStatuses(responses);
    expect(statuses[500] ?? 0).toBe(0);
    expect(statuses[201]).toBe(5);
    expect(statuses[409]).toBe(7);
    for (const response of responses.filter((candidate) => candidate.status === 409)) {
      expect(await response.json()).toEqual({ error: "record_limit_exceeded" });
    }

    const projectAfterWrites = await getProject(testEnv, project.id, owner);
    expect(projectAfterWrites.records).toHaveLength(5);
    const recordIds = projectAfterWrites.records.map((record) => (record as { id: number }).id);
    expect(new Set(recordIds).size).toBe(5);
  });

  it("uses default and user limits for record pagination", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `pagination-${crypto.randomUUID()}@example.com`;
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
        "records.defaultPageSize": 3,
        "records.maxPageSize": 3,
      }),
    );
    const project = await createProject(testEnv, { owner });
    for (const name of ["First", "Second"]) {
      const response = await dispatch(
        `/project/${project.id}/record`,
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
          await authHeaders(owner),
        ),
      );
      expect(response.status).toBe(201);
    }

    const publicTooLarge = await dispatch(`/project/${project.id}?limit=2`, testEnv);
    expect(publicTooLarge.status).toBe(409);
    expect(await publicTooLarge.json()).toEqual({ error: "record_limit_exceeded" });

    const ownerPage = await dispatch(`/project/${project.id}?limit=3`, testEnv, {
      headers: await authHeaders(owner),
    });
    expect(ownerPage.status).toBe(200);
    expect(((await ownerPage.json()) as ProjectResponse).records).toHaveLength(2);
  });

  it("falls back to built-in limits for invalid KV limits data", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `invalid-limit-${crypto.randomUUID()}@example.com`;
    await testEnv.CONFIGS.put(
      LimitsKvStore.userKey(owner),
      JSON.stringify({ "records.maxPageSize": 0 }),
    );
    const project = await createProject(testEnv, { owner });

    const response = await dispatch(
      `/project/${project.id}?limit=${BUILTIN_DEFAULT_LIMITS["records.maxPageSize"]}`,
      testEnv,
      {
        headers: await authHeaders(owner),
      },
    );

    expect(response.status).toBe(200);
  });

  it("enforces user limits for money amount and balance caps", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `money-cap-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      owner,
      limitsDocument({
        "money.maxAmountCents": 100,
        "money.maxBalanceCents": 100,
      }),
    );
    const project = await createProject(testEnv, { owner, ownerMemberName: "Alice" });
    await createMember(testEnv, project.id, "Bob", owner);

    const oversized = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -101, "2": 101 },
          description: { type: "transfer", from: 1, to: 2, amount: 101 },
        },
        await authHeaders(owner),
      ),
    );
    expect(oversized.status).toBe(409);
    expect(await oversized.json()).toEqual({ error: "money_limit_exceeded" });

    const maxTransfer = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -100, "2": 100 },
          description: { type: "transfer", from: 1, to: 2, amount: 100 },
        },
        await authHeaders(owner),
      ),
    );
    expect(maxTransfer.status).toBe(201);

    const overflow = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -1, "2": 1 },
          description: { type: "transfer", from: 1, to: 2, amount: 1 },
        },
        await authHeaders(owner),
      ),
    );
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toEqual({ error: "money_limit_exceeded" });
  });

  it("posts multi-recipient transfers while preserving destination order", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");
    const carol = await createMember(testEnv, project.id, "Carol");
    const dests = [
      { id: carol.id, amount: 200 },
      { id: bob.id, amount: 300 },
    ];

    const posted = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", multiTransferRecordBody(1, dests), await authHeaders()),
    );
    expect(posted.status).toBe(201);
    expect(await posted.json()).toEqual({ id: 1 });

    const view = await getProject(testEnv, project.id);
    expect(view.balance).toEqual({ "1": -500, "2": 300, "3": 200 });
    expect(view.records).toMatchObject([
      {
        id: 1,
        delta: { "1": -500, "2": 300, "3": 200 },
        description: { type: "transfer", src: 1, dests },
      },
    ]);
  });

  it("rejects invalid multi-recipient transfers", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");

    const invalidBodies = [
      multiTransferRecordBody(1, [], {}),
      multiTransferRecordBody(
        1,
        [
          { id: bob.id, amount: 50 },
          { id: bob.id, amount: 50 },
        ],
        { "1": -100, "2": 100 },
      ),
      multiTransferRecordBody(1, [{ id: 1, amount: 100 }], {}),
      multiTransferRecordBody(1, [{ id: bob.id, amount: 0 }], {}),
      multiTransferRecordBody(1, [{ id: 999, amount: 100 }], { "1": -100, "999": 100 }),
      multiTransferRecordBody(1, [{ id: bob.id, amount: 100 }], { "1": -99, "2": 99 }),
    ];

    for (const body of invalidBodies) {
      const response = await dispatch(
        `/project/${project.id}/record`,
        testEnv,
        jsonBody("POST", body, await authHeaders()),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }

    const oversized = multiTransferRecordBody(
      1,
      Array.from({ length: ABSOLUTE_LIST_LIMIT + 1 }, (_, index) => ({
        id: index + 2,
        amount: 1,
      })),
      {},
    );
    const oversizedResponse = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", oversized, await authHeaders()),
    );
    expect(oversizedResponse.status).toBe(400);
    expect(await oversizedResponse.json()).toEqual({ error: "invalid_request" });
  });

  it("applies money limits to multi-recipient amounts and the aggregate source delta", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `multi-limit-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      owner,
      limitsDocument({
        "money.maxAmountCents": 100,
        "money.maxBalanceCents": 1_000,
      }),
    );
    const project = await createProject(testEnv, { owner, ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob", owner);
    const carol = await createMember(testEnv, project.id, "Carol", owner);

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        multiTransferRecordBody(1, [
          { id: bob.id, amount: 60 },
          { id: carol.id, amount: 50 },
        ]),
        await authHeaders(owner),
      ),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "money_limit_exceeded" });
  });

  it("posts promise records with debtor-positive balances and optional reasons", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");

    const promiseWithReason = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({
          debtorMemberId: 1,
          creditorMemberId: bob.id,
          amount: 1234,
          reason: "Dinner",
        }),
        await authHeaders(),
      ),
    );
    expect(promiseWithReason.status).toBe(201);
    expect(await promiseWithReason.json()).toEqual({ id: 1 });

    const firstView = await getProject(testEnv, project.id);
    expect(firstView.balance).toEqual({ "1": 1234, [String(bob.id)]: -1234 });
    expect(firstView.records).toMatchObject([
      {
        id: 1,
        delta: { "1": 1234, [String(bob.id)]: -1234 },
        description: {
          type: "promise",
          debtorMemberId: 1,
          creditorMemberId: bob.id,
          amount: 1234,
          reason: "Dinner",
        },
      },
    ]);

    const promiseWithoutReason = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({
          debtorMemberId: bob.id,
          creditorMemberId: 1,
          amount: 500,
        }),
        await authHeaders(),
      ),
    );
    expect(promiseWithoutReason.status).toBe(201);
    expect(await promiseWithoutReason.json()).toEqual({ id: 2 });

    const secondView = await getProject(testEnv, project.id);
    expect(secondView.balance).toEqual({ "1": 734, [String(bob.id)]: -734 });
    expect((secondView.records[0] as { description: Record<string, unknown> }).description).toEqual(
      {
        type: "promise",
        debtorMemberId: bob.id,
        creditorMemberId: 1,
        amount: 500,
      },
    );
  });

  it("rejects invalid promise records", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");
    const carol = await createMember(testEnv, project.id, "Carol");

    const mismatchedDelta = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({
          debtorMemberId: 1,
          creditorMemberId: bob.id,
          amount: 100,
          delta: { "1": -100, [String(bob.id)]: 100 },
        }),
        await authHeaders(),
      ),
    );
    expect(mismatchedDelta.status).toBe(400);
    expect(await mismatchedDelta.json()).toEqual({ error: "invalid_request" });

    const sameMembers = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({
          debtorMemberId: 1,
          creditorMemberId: 1,
          amount: 100,
          delta: { "1": 100 },
        }),
        await authHeaders(),
      ),
    );
    expect(sameMembers.status).toBe(400);
    expect(await sameMembers.json()).toEqual({ error: "invalid_request" });

    const blankReason = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({
          debtorMemberId: 1,
          creditorMemberId: bob.id,
          amount: 100,
          reason: "",
        }),
        await authHeaders(),
      ),
    );
    expect(blankReason.status).toBe(400);
    expect(await blankReason.json()).toEqual({ error: "invalid_request" });

    const missingMember = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({
          debtorMemberId: 1,
          creditorMemberId: 999,
          amount: 100,
        }),
        await authHeaders(),
      ),
    );
    expect(missingMember.status).toBe(400);
    expect(await missingMember.json()).toEqual({ error: "invalid_request" });

    const deleteCarol = await dispatch(`/project/${project.id}/members/${carol.id}`, testEnv, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    expect(deleteCarol.status).toBe(204);

    const deletedMember = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({
          debtorMemberId: 1,
          creditorMemberId: carol.id,
          amount: 100,
        }),
        await authHeaders(),
      ),
    );
    expect(deletedMember.status).toBe(400);
    expect(await deletedMember.json()).toEqual({ error: "invalid_request" });
  });

  it("enforces promise money limits", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `promise-limit-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      owner,
      limitsDocument({
        "money.maxAmountCents": 100,
        "money.maxBalanceCents": 100,
      }),
    );
    const project = await createProject(testEnv, { owner, ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob", owner);

    const oversized = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({
          debtorMemberId: 1,
          creditorMemberId: bob.id,
          amount: 101,
        }),
        await authHeaders(owner),
      ),
    );
    expect(oversized.status).toBe(409);
    expect(await oversized.json()).toEqual({ error: "money_limit_exceeded" });

    const maxPromise = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({
          debtorMemberId: 1,
          creditorMemberId: bob.id,
          amount: 100,
        }),
        await authHeaders(owner),
      ),
    );
    expect(maxPromise.status).toBe(201);

    const overflow = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({
          debtorMemberId: 1,
          creditorMemberId: bob.id,
          amount: 1,
        }),
        await authHeaders(owner),
      ),
    );
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toEqual({ error: "money_limit_exceeded" });

    const view = await getProject(testEnv, project.id, owner);
    expect(view).toMatchObject({ balance: { "1": 100, "2": -100 }, records: [{ id: 1 }] });
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

  it("lets linked members read restricted projects after ACL removal", async () => {
    const { env: testEnv } = makeEnv();
    const memberEmail = `linked-access-${crypto.randomUUID()}@example.com`;
    const project = await createProject(testEnv, {
      acl: { type: "restricted", emails: [memberEmail] },
      ownerMemberName: "Alice",
    });
    const bob = await createMember(testEnv, project.id, "Bob");

    const join = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders(memberEmail)),
    );
    expect(join.status).toBe(201);

    const ownerRemove = await dispatch(
      `/project/${project.id}/acl/emails`,
      testEnv,
      jsonBody("DELETE", { emails: [memberEmail] }, await authHeaders("owner@example.com")),
    );
    expect(ownerRemove.status).toBe(204);

    const linkedMemberView = await getProject(testEnv, project.id, memberEmail);
    expect(linkedMemberView.acl).toEqual({ type: "restricted", emails: [] });
    expect(linkedMemberView.members).toContainEqual({
      id: bob.id,
      name: "Bob",
      deleted: false,
      linkedEmail: memberEmail,
      config: {},
    });

    const outsider = await dispatch(`/project/${project.id}`, testEnv, {
      headers: await authHeaders("outsider@example.com"),
    });
    expect(outsider.status).toBe(403);
  });

  it("redacts linked emails for public guests but shows them to authenticated viewers", async () => {
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
        { id: 1, name: "Alice", deleted: false },
        { id: 2, name: "Bob", deleted: false },
      ],
      records: [],
      balance: {},
    });

    const authenticatedViewer = await getProject(testEnv, project.id, "outsider@example.com");
    expect(authenticatedViewer.members).toEqual([
      { id: 1, name: "Alice", deleted: false, linkedEmail: "owner@example.com", config: {} },
      { id: 2, name: "Bob", deleted: false, config: {} },
    ]);
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
      `/project/${project.id}/record`,
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
      member: {
        id: 2,
        name: "Bob",
        deleted: false,
        linkedEmail: "member@example.com",
      },
    });

    const bobView = await getProject(testEnv, project.id, "member@example.com");
    expect(bobView.balance).toEqual({ "1": -2000, "2": 2000 });
    expect(bobView.members).toEqual([
      { id: 1, name: "Alice", deleted: false, linkedEmail: "owner@example.com", config: {} },
      {
        id: 2,
        name: "Bob",
        deleted: false,
        linkedEmail: "member@example.com",
        config: {},
      },
    ]);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    const bobProjects = await dispatch("/registry", testEnv, {
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
      `/project/${project.id}/record`,
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

  it("stores an expense category ID when the category is published", async () => {
    const { env: testEnv } = makeEnv();
    const category = testCategory();
    await putPublishedCategories(testEnv, [category]);
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: {},
          description: {
            type: "expense",
            name: "Lunch",
            paid: { "1": 100 },
            liability: { "1": 100 },
            categoryId: category.id,
          },
        },
        await authHeaders(),
      ),
    );

    expect(response.status).toBe(201);
    const view = await getProject(testEnv, project.id);
    expect(view.records[0]).toMatchObject({
      description: {
        type: "expense",
        categoryId: category.id,
      },
    });
  });

  it("treats a deleted stored category as an uncategorized expense", async () => {
    const { env: testEnv } = makeEnv();
    const category = testCategory();
    await putPublishedCategories(testEnv, [category]);
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: {},
          description: {
            type: "expense",
            name: "Lunch",
            paid: { "1": 100 },
            liability: { "1": 100 },
            categoryId: category.id,
          },
        },
        await authHeaders(),
      ),
    );
    expect(response.status).toBe(201);

    await putPublishedCategories(testEnv, []);
    const view = await getProject(testEnv, project.id);
    const storedRecord = view.records[0] as { description?: unknown } | undefined;
    expect(storedRecord?.description).toEqual(
      expect.objectContaining({ type: "expense", name: "Lunch" }),
    );
    expect(storedRecord?.description).not.toHaveProperty("categoryId");
  });

  it("ignores a malformed category ID found in stored record JSON", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", appendRecordBody(), await authHeaders()),
    );
    expect(response.status).toBe(201);

    const store = await getProjectStoreStub(testEnv, project.id);
    await runInDurableObject(store, async (_instance, state) => {
      const row = state.storage.sql
        .exec<{ description_json: string }>("SELECT description_json FROM records WHERE id = 1")
        .toArray()[0];
      expect(row).toBeDefined();
      const description = JSON.parse(row?.description_json ?? "null") as Record<string, unknown>;
      description.categoryId = "not-a-category-id";
      state.storage.sql.exec(
        "UPDATE records SET description_json = ? WHERE id = 1",
        JSON.stringify(description),
      );
    });

    const view = await getProject(testEnv, project.id);
    const storedRecord = view.records[0] as { description?: unknown } | undefined;
    expect(storedRecord?.description).not.toHaveProperty("categoryId");
  });

  it("rejects unknown expense category IDs", async () => {
    const { env: testEnv } = makeEnv();
    const category = testCategory();
    await putPublishedCategories(testEnv, []);
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: {},
          description: {
            type: "expense",
            name: "Lunch",
            paid: { "1": 100 },
            liability: { "1": 100 },
            categoryId: category.id,
          },
        },
        await authHeaders(),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("hard fails expense category validation when published config KV is unavailable", async () => {
    const kvGet = vi.fn(async () => {
      throw new Error("KV unavailable");
    });
    const { env: testEnv } = makeEnv({
      PUBLISHED_GLOBAL_CONFIG: { get: kvGet } as unknown as KVNamespace,
    });
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: {},
          description: {
            type: "expense",
            name: "Lunch",
            paid: { "1": 100 },
            liability: { "1": 100 },
            categoryId: testCategory().id,
          },
        },
        await authHeaders(),
      ),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_server_error" });
    expect(kvGet).toHaveBeenCalled();
  });

  it("does not read category KV for uncategorized expenses", async () => {
    const kvGet = vi.fn(async () => {
      throw new Error("category KV should not be touched");
    });
    const { env: testEnv } = makeEnv({
      PUBLISHED_GLOBAL_CONFIG: { get: kvGet } as unknown as KVNamespace,
    });
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", appendRecordBody(), await authHeaders()),
    );

    expect(response.status).toBe(201);
    expect(kvGet).not.toHaveBeenCalled();
  });

  it("checks account and project rate limits only when appending a record", async () => {
    const accountRateLimit = stubRateLimit(true);
    const projectRateLimit = stubRateLimit(true);
    const { env: testEnv } = makeEnv({
      APPEND_RECORD_ACCOUNT_RATE_LIMITER: accountRateLimit.binding,
      APPEND_RECORD_PROJECT_RATE_LIMITER: projectRateLimit.binding,
    });
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", appendRecordBody(), await authHeaders("Owner@Example.COM")),
    );

    expect(response.status).toBe(201);
    expect(accountRateLimit.limit).toHaveBeenCalledWith({
      key: `append-record:account:${await sha256Hex("owner@example.com")}`,
    });
    expect(projectRateLimit.limit).toHaveBeenCalledWith({
      key: `append-record:project:${project.id}`,
    });

    accountRateLimit.limit.mockClear();
    projectRateLimit.limit.mockClear();
    const replaced = await dispatch(
      `/project/${project.id}/record/1`,
      testEnv,
      jsonBody("PUT", appendRecordBody("Updated"), await authHeaders()),
    );
    expect(replaced.status).toBe(200);
    expect(accountRateLimit.limit).not.toHaveBeenCalled();
    expect(projectRateLimit.limit).not.toHaveBeenCalled();

    accountRateLimit.limit.mockClear();
    projectRateLimit.limit.mockClear();
    const deleted = await dispatch(`/project/${project.id}/record/1`, testEnv, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    expect(deleted.status).toBe(204);
    expect(accountRateLimit.limit).not.toHaveBeenCalled();
    expect(projectRateLimit.limit).not.toHaveBeenCalled();
  });

  it("returns an account rate limit reason before appending a record", async () => {
    const accountRateLimit = stubRateLimit(false);
    const projectRateLimit = stubRateLimit(true);
    const { env: testEnv } = makeEnv({
      APPEND_RECORD_ACCOUNT_RATE_LIMITER: accountRateLimit.binding,
      APPEND_RECORD_PROJECT_RATE_LIMITER: projectRateLimit.binding,
    });
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", appendRecordBody(), await authHeaders()),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited", reason: "account" });
    expect(accountRateLimit.limit).toHaveBeenCalledTimes(1);
    expect(projectRateLimit.limit).not.toHaveBeenCalled();
    await expect(
      testEnv.LIMITS_STORE.getByName(LIMITS_STORE_NAME).getLimits({
        type: "user",
        email: "owner@example.com",
      }),
    ).resolves.toEqual({
      ok: true,
      limits: null,
      updatedAt: null,
    });
    await expect(
      testEnv.CONFIGS.get(LimitsKvStore.userKey("owner@example.com")),
    ).resolves.toBeNull();
    expect((await getProject(testEnv, project.id)).records).toHaveLength(0);
  });

  it("returns a posting blocked error before append rate limiting when record posting is disabled", async () => {
    const accountRateLimit = stubRateLimit(true);
    const projectRateLimit = stubRateLimit(true);
    const { env: testEnv } = makeEnv({
      APPEND_RECORD_ACCOUNT_RATE_LIMITER: accountRateLimit.binding,
      APPEND_RECORD_PROJECT_RATE_LIMITER: projectRateLimit.binding,
    });
    const owner = `active-block-${crypto.randomUUID()}@example.com`;
    const project = await createProject(testEnv, { owner, ownerMemberName: "Alice" });
    await putUserLimits(
      testEnv,
      owner,
      limitsDocument({
        "records.allow_post": false,
      }),
    );

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", appendRecordBody(), await authHeaders(owner)),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "posting_blocked" });
    expect(accountRateLimit.limit).not.toHaveBeenCalled();
    expect(projectRateLimit.limit).not.toHaveBeenCalled();
    expect((await getProject(testEnv, project.id)).records).toHaveLength(0);
  });

  it("returns a project rate limit reason before appending a record", async () => {
    const accountRateLimit = stubRateLimit(true);
    const projectRateLimit = stubRateLimit(false);
    const { env: testEnv } = makeEnv({
      APPEND_RECORD_ACCOUNT_RATE_LIMITER: accountRateLimit.binding,
      APPEND_RECORD_PROJECT_RATE_LIMITER: projectRateLimit.binding,
    });
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", appendRecordBody(), await authHeaders()),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited", reason: "project" });
    expect(accountRateLimit.limit).toHaveBeenCalledTimes(1);
    expect(projectRateLimit.limit).toHaveBeenCalledTimes(1);
    expect((await getProject(testEnv, project.id)).records).toHaveLength(0);
  });

  it("rejects oversized money inputs and cumulative balance overflow", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    await createMember(testEnv, project.id, "Bob");

    const oversized = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: {
            "1": -BUILTIN_DEFAULT_LIMITS["money.maxAmountCents"] - 1,
            "2": BUILTIN_DEFAULT_LIMITS["money.maxAmountCents"] + 1,
          },
          description: {
            type: "transfer",
            from: 1,
            to: 2,
            amount: BUILTIN_DEFAULT_LIMITS["money.maxAmountCents"] + 1,
          },
        },
        await authHeaders(),
      ),
    );
    expect(oversized.status).toBe(409);
    expect(await oversized.json()).toEqual({ error: "money_limit_exceeded" });

    const firstMaxTransfer = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: {
            "1": -BUILTIN_DEFAULT_LIMITS["money.maxAmountCents"],
            "2": BUILTIN_DEFAULT_LIMITS["money.maxAmountCents"],
          },
          description: {
            type: "transfer",
            from: 1,
            to: 2,
            amount: BUILTIN_DEFAULT_LIMITS["money.maxAmountCents"],
          },
        },
        await authHeaders(),
      ),
    );
    expect(firstMaxTransfer.status).toBe(201);

    const overflow = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -1, "2": 1 },
          description: {
            type: "transfer",
            from: 1,
            to: 2,
            amount: 1,
          },
        },
        await authHeaders(),
      ),
    );
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toEqual({ error: "money_limit_exceeded" });

    const view = await getProject(testEnv, project.id);
    expect(view.balance).toEqual({
      "1": -BUILTIN_DEFAULT_LIMITS["money.maxAmountCents"],
      "2": BUILTIN_DEFAULT_LIMITS["money.maxAmountCents"],
    });
    expect(view.records).toMatchObject([{ id: 1 }]);
  });

  it("rejects money maps that exceed the absolute entry limit", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const oversizedDelta = Object.fromEntries(
      Array.from({ length: ABSOLUTE_LIST_LIMIT + 1 }, (_, index) => [String(index + 1), 1]),
    );

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: oversizedDelta,
          description: {
            type: "transfer",
            from: 1,
            to: 2,
            amount: 1,
          },
        },
        await authHeaders(),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects many fake member references without a server error", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const liability = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [String(index + 2), 1]),
    );

    const response = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -100, ...liability },
          description: {
            type: "expense",
            name: "Fake members",
            paid: { "1": 100 },
            liability,
          },
        },
        await authHeaders(),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("paginates records with an exclusive id offset", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);

    for (const name of ["First", "Second", "Third"]) {
      const response = await dispatch(
        `/project/${project.id}/record`,
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

    const tombstone = await dispatch(`/project/${project.id}/record/2`, testEnv, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    expect(tombstone.status).toBe(204);
    const pageAcrossTombstone = await dispatch(`/project/${project.id}?limit=2`, testEnv, {
      headers: await authHeaders(),
    });
    expect(((await pageAcrossTombstone.json()) as ProjectResponse).records).toMatchObject([
      { id: 3 },
      { id: 2, description: { type: "deleted" } },
    ]);

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
      member: {
        id: 2,
        name: "Carol",
        deleted: false,
        linkedEmail: "carol@example.com",
      },
    });

    const duplicateJoin = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { name: "Carol" }, await authHeaders("member@example.com")),
    );
    expect(duplicateJoin.status).toBe(400);
  });

  it("allows active members to create and edit unlinked members", async () => {
    const { env: testEnv } = makeEnv();
    const owner = `member-manager-owner-${crypto.randomUUID()}@example.com`;
    await putUserLimits(
      testEnv,
      owner,
      limitsDocument({
        "projects.maxMemberNameLength": 12,
      }),
    );
    const project = await createProject(testEnv, { owner, ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob", owner);
    await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders("bob@example.com")),
    );

    const createCarol = await dispatch(
      `/project/${project.id}/members`,
      testEnv,
      jsonBody("POST", { name: "Carol" }, await authHeaders("bob@example.com")),
    );
    expect(createCarol.status).toBe(201);
    const carol = ((await createCarol.json()) as { member: { id: number } }).member;

    const renameCarol = await dispatch(
      `/project/${project.id}/members/${carol.id}`,
      testEnv,
      jsonBody("PATCH", { name: "Caroline" }, await authHeaders("bob@example.com")),
    );
    expect(renameCarol.status).toBe(200);

    const replaceCarolConfig = await dispatch(
      `/project/${project.id}/members/${carol.id}/config`,
      testEnv,
      jsonBody(
        "PUT",
        { size: 2, paymentMethod: "venmo: carol" },
        await authHeaders("bob@example.com"),
      ),
    );
    expect(replaceCarolConfig.status).toBe(200);

    const patchCarolConfig = await dispatch(
      `/project/${project.id}/members/${carol.id}/config`,
      testEnv,
      jsonBody("PATCH", { size: 3 }, await authHeaders("bob@example.com")),
    );
    expect(patchCarolConfig.status).toBe(200);
    expect(await patchCarolConfig.json()).toEqual({
      size: 3,
      paymentMethod: "venmo: carol",
    });

    const david = await createMember(testEnv, project.id, "David", owner);
    await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: david.id }, await authHeaders("david@example.com")),
    );
    const renameLinkedMember = await dispatch(
      `/project/${project.id}/members/${david.id}`,
      testEnv,
      jsonBody("PATCH", { name: "Dave" }, await authHeaders("bob@example.com")),
    );
    expect(renameLinkedMember.status).toBe(403);
    const configureLinkedMember = await dispatch(
      `/project/${project.id}/members/${david.id}/config`,
      testEnv,
      jsonBody("PUT", { size: 2 }, await authHeaders("bob@example.com")),
    );
    expect(configureLinkedMember.status).toBe(403);

    const renameOverOwnerLimit = await dispatch(
      `/project/${project.id}/members/${carol.id}`,
      testEnv,
      jsonBody(
        "PATCH",
        { name: "A name that exceeds the owner's limit" },
        await authHeaders("bob@example.com"),
      ),
    );
    expect(renameOverOwnerLimit.status).toBe(409);
    expect(await renameOverOwnerLimit.json()).toEqual({ error: "member_limit_exceeded" });

    const overOwnerNameLimit = await dispatch(
      `/project/${project.id}/members`,
      testEnv,
      jsonBody(
        "POST",
        { name: "A name that exceeds the owner's limit" },
        await authHeaders("bob@example.com"),
      ),
    );
    expect(overOwnerNameLimit.status).toBe(409);
    expect(await overOwnerNameLimit.json()).toEqual({ error: "member_limit_exceeded" });

    const outsiderCreate = await dispatch(
      `/project/${project.id}/members`,
      testEnv,
      jsonBody("POST", { name: "Eve" }, await authHeaders("viewer@example.com")),
    );
    expect(outsiderCreate.status).toBe(403);
    const outsiderEdit = await dispatch(
      `/project/${project.id}/members/${carol.id}`,
      testEnv,
      jsonBody("PATCH", { name: "Eve" }, await authHeaders("viewer@example.com")),
    );
    expect(outsiderEdit.status).toBe(403);

    const unlinkBob = await dispatch(
      `/project/${project.id}/member-links`,
      testEnv,
      jsonBody("DELETE", { email: "bob@example.com" }, await authHeaders(owner)),
    );
    expect(unlinkBob.status).toBe(204);
    const formerMemberEdit = await dispatch(
      `/project/${project.id}/members/${carol.id}/config`,
      testEnv,
      jsonBody("PATCH", { size: 4 }, await authHeaders("bob@example.com")),
    );
    expect(formerMemberEdit.status).toBe(403);

    const projectView = await getProject(testEnv, project.id, owner);
    expect(projectView.members.find((member) => member.id === carol.id)).toMatchObject({
      name: "Caroline",
      config: { size: 3, paymentMethod: "venmo: carol" },
    });
    expect(projectView.members.find((member) => member.id === david.id)).toMatchObject({
      name: "David",
      config: {},
    });
  });

  it("keeps linked-member self edits but reserves administrative unlinking for the owner", async () => {
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
      member: {
        id: bob.id,
        name: "Robert",
        deleted: false,
        linkedEmail: "member@example.com",
      },
    });

    const selfUnlink = await dispatch(
      `/project/${project.id}/members/${bob.id}`,
      testEnv,
      jsonBody("PATCH", { email: "" }, await authHeaders("member@example.com")),
    );
    expect(selfUnlink.status).toBe(403);

    const postAfterBlockedUnlink = await dispatch(
      `/project/${project.id}/record`,
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
    expect(postAfterBlockedUnlink.status).toBe(201);

    const ownerRename = await dispatch(
      `/project/${project.id}/members/${bob.id}`,
      testEnv,
      jsonBody("PATCH", { name: "Bobby" }, await authHeaders("owner@example.com")),
    );
    expect(ownerRename.status).toBe(200);
    expect(await ownerRename.json()).toEqual({
      member: {
        id: bob.id,
        name: "Bobby",
        deleted: false,
        linkedEmail: "member@example.com",
      },
    });

    const ownerUnlink = await dispatch(
      `/project/${project.id}/members/${bob.id}`,
      testEnv,
      jsonBody("PATCH", { email: "" }, await authHeaders("owner@example.com")),
    );
    expect(ownerUnlink.status).toBe(200);
    expect(await ownerUnlink.json()).toEqual({
      member: { id: bob.id, name: "Bobby", deleted: false },
    });

    const postAfterOwnerUnlink = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        appendRecordBody("Blocked after unlink"),
        await authHeaders("member@example.com"),
      ),
    );
    expect(postAfterOwnerUnlink.status).toBe(403);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await expect(listProjectsFromRegistry(testEnv, "member@example.com")).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );
  });

  it("keeps owner management authority independent of a linked member", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const store = await getProjectStoreStub(testEnv, project.id);
    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec("UPDATE members SET linked_email = NULL WHERE id = 1");
    });

    const created = await dispatch(
      `/project/${project.id}/members`,
      testEnv,
      jsonBody("POST", { name: "Bob" }, await authHeaders("owner@example.com")),
    );
    expect(created.status).toBe(201);
    const bob = ((await created.json()) as { member: { id: number } }).member;

    const configured = await dispatch(
      `/project/${project.id}/members/${bob.id}/config`,
      testEnv,
      jsonBody("PUT", { size: 2 }, await authHeaders("owner@example.com")),
    );
    expect(configured.status).toBe(200);
  });

  it("replaces, shallow-patches, and clears member config without publishing it", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");
    expect(bob).not.toHaveProperty("config");

    const bobJoin = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders("member@example.com")),
    );
    expect(bobJoin.status).toBe(201);
    expect(await bobJoin.json()).toEqual({
      member: {
        id: bob.id,
        name: "Bob",
        deleted: false,
        linkedEmail: "member@example.com",
      },
    });

    const selfOtherWrite = await dispatch(
      `/project/${project.id}/members/1/config`,
      testEnv,
      jsonBody("PATCH", { size: 2 }, await authHeaders("member@example.com")),
    );
    expect(selfOtherWrite.status).toBe(403);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);

    const replace = await dispatch(
      `/project/${project.id}/members/${bob.id}/config`,
      testEnv,
      jsonBody(
        "PUT",
        { size: 2, paymentMethod: "  venmo: bob@example.com  " },
        await authHeaders(),
      ),
    );
    expect(replace.status).toBe(200);
    expect(await replace.json()).toEqual({
      size: 2,
      paymentMethod: "venmo: bob@example.com",
    });

    const patchSize = await dispatch(
      `/project/${project.id}/members/${bob.id}/config`,
      testEnv,
      jsonBody("PATCH", { size: 3 }, await authHeaders("member@example.com")),
    );
    expect(patchSize.status).toBe(200);
    expect(await patchSize.json()).toEqual({
      size: 3,
      paymentMethod: "venmo: bob@example.com",
    });

    const removePaymentMethod = await dispatch(
      `/project/${project.id}/members/${bob.id}/config`,
      testEnv,
      jsonBody("PATCH", { paymentMethod: null }, await authHeaders("member@example.com")),
    );
    expect(removePaymentMethod.status).toBe(200);
    expect(await removePaymentMethod.json()).toEqual({ size: 3 });

    const emptyPatch = await dispatch(
      `/project/${project.id}/members/${bob.id}/config`,
      testEnv,
      jsonBody("PATCH", {}, await authHeaders("member@example.com")),
    );
    expect(emptyPatch.status).toBe(200);
    expect(await emptyPatch.json()).toEqual({ size: 3 });

    const authenticatedProject = await getProject(testEnv, project.id, "member@example.com");
    expect(authenticatedProject.members.find((member) => member.id === bob.id)?.config).toEqual({
      size: 3,
    });

    expect(await getProjectSummaryAlarm(testEnv, project.id)).toBeNull();
    const registryProject = (await listProjectsFromRegistry(testEnv, "member@example.com")).find(
      (listed) => listed.id === project.id,
    );
    expect(registryProject?.member).toMatchObject({ id: bob.id, name: "Bob" });
    expect(registryProject?.member).not.toHaveProperty("config");
    const rawRegistryMember = await runInDurableObject(
      testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME),
      async (_instance, state) =>
        state.storage.sql
          .exec<
            { member_json: string } & Record<string, SqlStorageValue>
          >("SELECT member_json FROM project_members WHERE email = ? AND project_id = ?", "member@example.com", project.id)
          .toArray()[0]?.member_json,
    );
    expect(JSON.parse(rawRegistryMember ?? "null")).not.toHaveProperty("config");

    const clear = await dispatch(
      `/project/${project.id}/members/${bob.id}/config`,
      testEnv,
      jsonBody("PUT", {}, await authHeaders()),
    );
    expect(clear.status).toBe(200);
    expect(await clear.json()).toEqual({});
  });

  it("validates member config at HTTP boundaries", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const bob = await createMember(testEnv, project.id, "Bob");
    const path = `/project/${project.id}/members/${bob.id}/config`;

    const invalidReplacements = [
      { size: 0 },
      { size: 1.5 },
      { size: Number.MAX_SAFE_INTEGER + 1 },
      { size: null },
      { paymentMethod: "   " },
      { paymentMethod: "x".repeat(10_001) },
      { unknown: true },
    ];
    for (const config of invalidReplacements) {
      const response = await dispatch(path, testEnv, jsonBody("PUT", config, await authHeaders()));
      expect(response.status).toBe(400);
    }

    for (const patch of [{ size: 0 }, { paymentMethod: " " }, { unknown: true }]) {
      const response = await dispatch(path, testEnv, jsonBody("PATCH", patch, await authHeaders()));
      expect(response.status).toBe(400);
    }
  });

  it("uses project read access for config reads and member-management access for writes", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");
    const path = `/project/${project.id}/members/${bob.id}/config`;

    const guestConfig = await dispatch(path, testEnv);
    expect(guestConfig.status).toBe(401);

    const guestProject = await dispatch(`/project/${project.id}`, testEnv);
    expect(guestProject.status).toBe(200);
    const guestBody = (await guestProject.json()) as ProjectResponse;
    expect(guestBody.members.every((member) => member.config === undefined)).toBe(true);

    const outsiderRead = await dispatch(path, testEnv, {
      headers: await authHeaders("outsider@example.com"),
    });
    expect(outsiderRead.status).toBe(200);
    expect(await outsiderRead.json()).toEqual({});

    const outsiderWrite = await dispatch(
      path,
      testEnv,
      jsonBody("PATCH", { size: 2 }, await authHeaders("outsider@example.com")),
    );
    expect(outsiderWrite.status).toBe(403);

    const restricted = await createProject(testEnv, {
      acl: { type: "restricted", emails: ["viewer@example.com"] },
    });
    const restrictedPath = `/project/${restricted.id}/members/1/config`;
    const allowedRead = await dispatch(restrictedPath, testEnv, {
      headers: await authHeaders("viewer@example.com"),
    });
    expect(allowedRead.status).toBe(200);

    const allowedViewerWrite = await dispatch(
      restrictedPath,
      testEnv,
      jsonBody("PATCH", { size: 2 }, await authHeaders("viewer@example.com")),
    );
    expect(allowedViewerWrite.status).toBe(403);

    const deniedRead = await dispatch(restrictedPath, testEnv, {
      headers: await authHeaders("outsider@example.com"),
    });
    expect(deniedRead.status).toBe(403);
  });

  it("isolates invalid stored member config and permits reads after soft deletion", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const bob = await createMember(testEnv, project.id, "Bob");
    const carol = await createMember(testEnv, project.id, "Carol");
    const store = await getProjectStoreStub(testEnv, project.id);

    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE members SET config = ? WHERE id = ?",
        '{"size":2,"unknown":true}',
        bob.id,
      );
      state.storage.sql.exec("UPDATE members SET config = ? WHERE id = ?", '{"size":3}', carol.id);
    });

    const projectView = await getProject(testEnv, project.id);
    expect(projectView.members.find((member) => member.id === bob.id)?.config).toEqual({});
    expect(projectView.members.find((member) => member.id === carol.id)?.config).toEqual({
      size: 3,
    });

    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec("UPDATE members SET config = ? WHERE id = ?", "not-json", bob.id);
    });
    const invalidRead = await dispatch(`/project/${project.id}/members/${bob.id}/config`, testEnv, {
      headers: await authHeaders(),
    });
    expect(invalidRead.status).toBe(200);
    expect(await invalidRead.json()).toEqual({});

    const recover = await dispatch(
      `/project/${project.id}/members/${bob.id}/config`,
      testEnv,
      jsonBody("PATCH", { paymentMethod: " zelle: 123456789 " }, await authHeaders()),
    );
    expect(recover.status).toBe(200);
    expect(await recover.json()).toEqual({ paymentMethod: "zelle: 123456789" });

    const deleteBob = await dispatch(`/project/${project.id}/members/${bob.id}`, testEnv, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    expect(deleteBob.status).toBe(204);

    const deletedRead = await dispatch(`/project/${project.id}/members/${bob.id}/config`, testEnv, {
      headers: await authHeaders(),
    });
    expect(deletedRead.status).toBe(200);
    expect(await deletedRead.json()).toEqual({ paymentMethod: "zelle: 123456789" });

    const deletedWrite = await dispatch(
      `/project/${project.id}/members/${bob.id}/config`,
      testEnv,
      jsonBody("PUT", { size: 2 }, await authHeaders()),
    );
    expect(deletedWrite.status).toBe(409);
    expect(await deletedWrite.json()).toEqual({ error: "already_deleted" });
  });

  it("forbids owner member self-removal through generic member routes", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await expect(listProjectsFromRegistry(testEnv, "owner@example.com")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );

    const ownerSelfUnlink = await dispatch(
      `/project/${project.id}/members/1`,
      testEnv,
      jsonBody("PATCH", { email: "" }, await authHeaders("owner@example.com")),
    );
    expect(ownerSelfUnlink.status).toBe(403);
    expect(await ownerSelfUnlink.json()).toEqual({ error: "forbidden" });

    const ownerSelfDelete = await dispatch(`/project/${project.id}/members/1`, testEnv, {
      method: "DELETE",
      headers: await authHeaders("owner@example.com"),
    });
    expect(ownerSelfDelete.status).toBe(403);
    expect(await ownerSelfDelete.json()).toEqual({ error: "forbidden" });

    const ownerView = await getProject(testEnv, project.id);
    expect(ownerView.members).toEqual([
      { id: 1, name: "owner", deleted: false, linkedEmail: "owner@example.com", config: {} },
    ]);

    const postAfterBlockedRemoval = await dispatch(
      `/project/${project.id}/record`,
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
        await authHeaders("owner@example.com"),
      ),
    );
    expect(postAfterBlockedRemoval.status).toBe(201);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await expect(listProjectsFromRegistry(testEnv, "owner@example.com")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );
  });

  it("lets non-owner linked members leave without changing ACL", async () => {
    const { env: testEnv } = makeEnv();
    const memberEmail = `leave-${crypto.randomUUID()}@example.com`;
    const project = await createProject(testEnv, {
      acl: { type: "restricted", emails: [memberEmail] },
    });
    const bob = await createMember(testEnv, project.id, "Bob");

    const bobJoin = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders(memberEmail)),
    );
    expect(bobJoin.status).toBe(201);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    const bobProjectsBeforeLeave = await dispatch("/registry", testEnv, {
      headers: await authHeaders(memberEmail),
    });
    expect(bobProjectsBeforeLeave.status).toBe(200);
    expect(
      ((await bobProjectsBeforeLeave.json()) as ProjectSummaryResponse).projects,
    ).toContainEqual(expect.objectContaining({ id: project.id }));

    const ownerLeave = await dispatch(`/project/${project.id}/leave`, testEnv, {
      method: "POST",
      headers: await authHeaders("owner@example.com"),
    });
    expect(ownerLeave.status).toBe(403);

    const bobLeave = await dispatch(`/project/${project.id}/leave`, testEnv, {
      method: "POST",
      headers: await authHeaders(memberEmail),
    });
    expect(bobLeave.status).toBe(204);

    const bobView = await getProject(testEnv, project.id, memberEmail);
    expect(bobView.acl).toEqual({ type: "restricted", emails: [memberEmail] });
    expect(bobView.members).toEqual([
      { id: 1, name: "owner", deleted: false, linkedEmail: "owner@example.com", config: {} },
      { id: 2, name: "Bob", deleted: false, config: {} },
    ]);

    const postAfterLeave = await dispatch(
      `/project/${project.id}/record`,
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
        await authHeaders(memberEmail),
      ),
    );
    expect(postAfterLeave.status).toBe(403);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await expect(listProjectsFromRegistry(testEnv, memberEmail)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );
  });

  it("lets the owner force-unlink another member email but not their own", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const bob = await createMember(testEnv, project.id, "Bob");
    const bobJoin = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders("member@example.com")),
    );
    expect(bobJoin.status).toBe(201);

    const nonOwnerKick = await dispatch(
      `/project/${project.id}/member-links`,
      testEnv,
      jsonBody("DELETE", { email: "member@example.com" }, await authHeaders("member@example.com")),
    );
    expect(nonOwnerKick.status).toBe(403);

    const ownerSelfKick = await dispatch(
      `/project/${project.id}/member-links`,
      testEnv,
      jsonBody("DELETE", { email: "owner@example.com" }, await authHeaders("owner@example.com")),
    );
    expect(ownerSelfKick.status).toBe(403);

    const ownerKick = await dispatch(
      `/project/${project.id}/member-links`,
      testEnv,
      jsonBody("DELETE", { email: "member@example.com" }, await authHeaders("owner@example.com")),
    );
    expect(ownerKick.status).toBe(204);

    const ownerView = await getProject(testEnv, project.id);
    expect(ownerView.members).toEqual([
      { id: 1, name: "owner", deleted: false, linkedEmail: "owner@example.com", config: {} },
      { id: 2, name: "Bob", deleted: false, config: {} },
    ]);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await expect(listProjectsFromRegistry(testEnv, "member@example.com")).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );

    const postAfterKick = await dispatch(
      `/project/${project.id}/record`,
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
    expect(postAfterKick.status).toBe(403);
  });

  it("soft-deletes only zero-balance members and preserves historical records", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const bob = await createMember(testEnv, project.id, "Bob");

    const historicalRecord = await dispatch(
      `/project/${project.id}/record`,
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
      { id: 1, name: "owner", deleted: false, linkedEmail: "owner@example.com", config: {} },
      { id: 2, name: "Bob", deleted: true, config: {} },
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
      `/project/${project.id}/record`,
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
      `/project/${project.id}/record`,
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

  it("replaces and tombstones records while keeping balances exact", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");

    const posted = await dispatch(
      `/project/${project.id}/record`,
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
    expect(posted.status).toBe(201);
    expect(await posted.json()).toEqual({ id: 1 });

    const joined = await dispatch(
      `/project/${project.id}/join`,
      testEnv,
      jsonBody("POST", { memberId: bob.id }, await authHeaders("bob@example.com")),
    );
    expect(joined.status).toBe(201);
    await putUserLimits(
      testEnv,
      "bob@example.com",
      limitsDocument({ "records.allow_post": false }),
    );

    const original = await dispatch(`/project/${project.id}/record/1`, testEnv);
    expect(original.status).toBe(200);
    const originalRecord = (await original.json()) as {
      authorMemberId: number;
      createdAt: number;
      updatedAt?: number;
    };
    expect(originalRecord).toMatchObject({ authorMemberId: 1 });
    expect(originalRecord).not.toHaveProperty("updatedAt");

    const replaced = await dispatch(
      `/project/${project.id}/record/1`,
      testEnv,
      jsonBody(
        "PUT",
        {
          delta: { "1": -3000, "2": 3000 },
          description: {
            type: "expense",
            name: "Updated tickets",
            paid: { "1": 3000 },
            liability: { "2": 3000 },
          },
        },
        await authHeaders("bob@example.com"),
      ),
    );
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({
      id: 1,
      authorMemberId: 1,
      createdAt: originalRecord.createdAt,
      updatedAt: expect.any(Number) as number,
      updatedByMemberId: bob.id,
      delta: { "1": -3000, "2": 3000 },
      description: { type: "expense", name: "Updated tickets" },
    });
    expect((await getProject(testEnv, project.id)).balance).toEqual({ "1": -3000, "2": 3000 });

    const stub = await getProjectStoreStub(testEnv, project.id);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(
        state.storage.sql
          .exec("SELECT member_id, amount_cents FROM balances ORDER BY member_id")
          .toArray(),
      ).toEqual([
        { member_id: 1, amount_cents: -3000 },
        { member_id: 2, amount_cents: 3000 },
      ]);
    });

    const deleted = await dispatch(`/project/${project.id}/record/1`, testEnv, {
      method: "DELETE",
      headers: await authHeaders("bob@example.com"),
    });
    expect(deleted.status).toBe(204);
    const projectWithTombstone = await getProject(testEnv, project.id);
    expect(projectWithTombstone.balance).toEqual({});
    expect(projectWithTombstone.records).toMatchObject([
      {
        id: 1,
        authorMemberId: 1,
        delta: {},
        description: { type: "deleted" },
        createdAt: originalRecord.createdAt,
        updatedAt: expect.any(Number) as number,
        updatedByMemberId: bob.id,
      },
    ]);
    const tombstoneRead = await dispatch(`/project/${project.id}/record/1`, testEnv);
    expect(tombstoneRead.status).toBe(200);
    expect(await tombstoneRead.json()).toMatchObject({
      id: 1,
      description: { type: "deleted" },
      delta: {},
      updatedByMemberId: bob.id,
    });
    expect(
      (
        await dispatch(`/project/${project.id}/record/1`, testEnv, {
          method: "DELETE",
          headers: await authHeaders(),
        })
      ).status,
    ).toBe(404);

    await runInDurableObject(stub, async (_instance, state) => {
      const row = state.storage.sql
        .exec<
          {
            description_type: string;
            description_json: string;
            delta_json: string;
            updated_at: number;
            updated_by_member_id: number;
          } & Record<string, SqlStorageValue>
        >(
          `SELECT description_type, description_json, delta_json, updated_at,
                  updated_by_member_id FROM records WHERE id = 1`,
        )
        .one();
      expect(row).toEqual({
        description_type: "deleted",
        description_json: "{}",
        delta_json: "{}",
        updated_at: expect.any(Number) as number,
        updated_by_member_id: bob.id,
      });
      expect(
        state.storage.sql
          .exec("SELECT member_id, amount_cents FROM balances ORDER BY member_id")
          .toArray(),
      ).toEqual([]);
    });
    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await runInDurableObject(
      testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME),
      async (_instance, state) => {
        expect(
          state.storage.sql
            .exec<
              { record_count: number } & Record<string, SqlStorageValue>
            >("SELECT record_count FROM project_summaries WHERE project_id = ?", project.id)
            .one().record_count,
        ).toBe(1);
      },
    );

    const next = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", appendRecordBody("Replacement history"), await authHeaders()),
    );
    expect(await next.json()).toEqual({ id: 2 });
    expect((await getProject(testEnv, project.id)).records).toMatchObject([
      { id: 2 },
      { id: 1, description: { type: "deleted" } },
    ]);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(state.storage.sql.exec("SELECT id FROM records ORDER BY id").toArray()).toEqual([
        { id: 1 },
        { id: 2 },
      ]);
    });
  });

  it("uses project read access for GET but requires membership for PUT", async () => {
    const { env: testEnv } = makeEnv();
    const readerEmail = "reader@example.com";
    const project = await createProject(testEnv, {
      acl: { type: "restricted", emails: [readerEmail] },
    });
    await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", appendRecordBody(), await authHeaders()),
    );

    expect((await dispatch(`/project/${project.id}/record/1`, testEnv)).status).toBe(403);
    const allowedRead = await dispatch(`/project/${project.id}/record/1`, testEnv, {
      headers: await authHeaders(readerEmail),
    });
    expect(allowedRead.status).toBe(200);

    const nonMemberPut = await dispatch(
      `/project/${project.id}/record/1`,
      testEnv,
      jsonBody("PUT", appendRecordBody("Reader edit"), await authHeaders(readerEmail)),
    );
    expect(nonMemberPut.status).toBe(403);
  });

  it("leaves record mutation storage unchanged when replacement validation fails", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");
    await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        promiseRecordBody({ creditorMemberId: bob.id, amount: 500 }),
        await authHeaders(),
      ),
    );
    expect((await dispatch(`/project/${project.id}/settle`, testEnv)).status).toBe(200);

    const stub = await getProjectStoreStub(testEnv, project.id);
    const storageSnapshot = async () =>
      runInDurableObject(stub, async (_instance, state) => ({
        record: state.storage.sql
          .exec(
            `SELECT description_type, description_json, delta_json, updated_at,
                    updated_by_member_id FROM records WHERE id = 1`,
          )
          .one(),
        balances: state.storage.sql
          .exec("SELECT member_id, amount_cents FROM balances ORDER BY member_id")
          .toArray(),
        metadata: state.storage.kv.get("projectMetadata"),
        cache: state.storage.kv.get("settlementPlanCache"),
      }));
    const before = await storageSnapshot();

    const invalidDelta = await dispatch(
      `/project/${project.id}/record/1`,
      testEnv,
      jsonBody(
        "PUT",
        promiseRecordBody({
          creditorMemberId: bob.id,
          amount: 500,
          delta: { "1": 501, "2": -500 },
        }),
        await authHeaders(),
      ),
    );
    expect(invalidDelta.status).toBe(400);

    const overLimit = await dispatch(
      `/project/${project.id}/record/1`,
      testEnv,
      jsonBody(
        "PUT",
        promiseRecordBody({
          creditorMemberId: bob.id,
          amount: BUILTIN_DEFAULT_LIMITS["money.maxAmountCents"] + 1,
        }),
        await authHeaders(),
      ),
    );
    expect(overLimit.status).toBe(409);
    expect(await overLimit.json()).toEqual({ error: "money_limit_exceeded" });

    const typeMismatch = await dispatch(
      `/project/${project.id}/record/1`,
      testEnv,
      jsonBody(
        "PUT",
        {
          delta: { "1": -500, "2": 500 },
          description: { type: "transfer", from: 1, to: 2, amount: 500 },
        },
        await authHeaders(),
      ),
    );
    expect(typeMismatch.status).toBe(409);
    expect(await typeMismatch.json()).toEqual({ error: "record_type_mismatch" });
    expect(await storageSnapshot()).toEqual(before);
  });

  it("rejects record mutations that would restore a deleted member balance", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");
    await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -100, "2": 100 },
          description: {
            type: "expense",
            name: "Shared item",
            paid: { "1": 100 },
            liability: { "2": 100 },
          },
        },
        await authHeaders(),
      ),
    );
    await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": 100, "2": -100 },
          description: { type: "transfer", from: bob.id, to: 1, amount: 100 },
        },
        await authHeaders(),
      ),
    );
    const deleteBob = await dispatch(`/project/${project.id}/members/${bob.id}`, testEnv, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    expect(deleteBob.status).toBe(204);

    const deleteRecord = await dispatch(`/project/${project.id}/record/1`, testEnv, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    expect(deleteRecord.status).toBe(409);
    expect(await deleteRecord.json()).toEqual({ error: "nonzero_balance" });

    const replaceRecord = await dispatch(
      `/project/${project.id}/record/1`,
      testEnv,
      jsonBody("PUT", appendRecordBody("Owner-only replacement"), await authHeaders()),
    );
    expect(replaceRecord.status).toBe(409);
    expect(await replaceRecord.json()).toEqual({ error: "nonzero_balance" });
    expect((await getProject(testEnv, project.id)).balance).toEqual({});
    expect((await dispatch(`/project/${project.id}/record/1`, testEnv)).status).toBe(200);
  });

  it("rejects the removed record creation route and new revert descriptions", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);

    const oldRoute = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody("POST", appendRecordBody(), await authHeaders()),
    );
    expect(oldRoute.status).toBe(404);

    const revertPost = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", { delta: {}, description: { type: "revert", id: 1 } }, await authHeaders()),
    );
    expect(revertPost.status).toBe(400);

    const created = await dispatch(
      `/project/${project.id}/record`,
      testEnv,
      jsonBody("POST", appendRecordBody(), await authHeaders()),
    );
    expect(created.status).toBe(201);

    const revertPut = await dispatch(
      `/project/${project.id}/record/1`,
      testEnv,
      jsonBody("PUT", { delta: {}, description: { type: "revert", id: 1 } }, await authHeaders()),
    );
    expect(revertPut.status).toBe(400);
  });

  it("keeps legacy revert records readable without source annotations", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const stub = await getProjectStoreStub(testEnv, project.id);

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO records
          (id, author_member_id, description_type, description_json, delta_json, created_at,
           updated_at, updated_by_member_id)
         VALUES (1, 1, 'revert', '{"type":"revert","id":99}', '{}', 1000, NULL, NULL)`,
      );
    });

    const page = await getProject(testEnv, project.id);
    expect(page.records).toMatchObject([
      { id: 1, description: { type: "revert", id: 99 }, delta: {} },
    ]);
    expect(page.records[0]).not.toHaveProperty("reverted");
    const record = await dispatch(`/project/${project.id}/record/1`, testEnv);
    expect(record.status).toBe(200);
    expect(await record.json()).toMatchObject({
      id: 1,
      description: { type: "revert", id: 99 },
    });
  });
});
