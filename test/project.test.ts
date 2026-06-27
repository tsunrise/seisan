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
  getProject,
  jsonBody,
  limitsDocument,
  listProjectsFromRegistry,
  makeEnv,
  projectRefCacheKey,
  putDefaultLimits,
  putUserLimits,
  runProjectSummaryAlarm,
  serializeProjectRefCacheValue,
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
      "/project/not-a-uuid",
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
        `/project/${project.id}`,
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
          `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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

  it("posts promise records with debtor-positive balances and optional reasons", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");

    const promiseWithReason = await dispatch(
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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

  it("enforces promise money limits and supports reverting promises", async () => {
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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

    const revert = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: { "1": -100, [String(bob.id)]: 100 },
          description: { type: "revert", id: 1 },
        },
        await authHeaders(owner),
      ),
    );
    expect(revert.status).toBe(201);
    expect(await revert.json()).toEqual({ id: 2 });

    const view = await getProject(testEnv, project.id, owner);
    const revertRecord = view.records.find(
      (record): record is { id: number; createdAt: number } =>
        typeof record === "object" &&
        record !== null &&
        "id" in record &&
        (record as { id: number }).id === 2,
    );
    expect(view).toMatchObject({ balance: {}, records: [{ id: 2 }, { id: 1 }] });
    expect(view.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 1,
          reverted: {
            recordId: 2,
            authorMemberId: 1,
            createdAt: revertRecord?.createdAt,
          },
        }),
      ]),
    );
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
      { id: 1, name: "Alice", deleted: false, linkedEmail: "owner@example.com" },
      { id: 2, name: "Bob", deleted: false },
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

  it("checks account and project rate limit keys before appending records", async () => {
    const accountRateLimit = stubRateLimit(true);
    const projectRateLimit = stubRateLimit(true);
    const { env: testEnv } = makeEnv({
      APPEND_RECORD_ACCOUNT_RATE_LIMITER: accountRateLimit.binding,
      APPEND_RECORD_PROJECT_RATE_LIMITER: projectRateLimit.binding,
    });
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });

    const response = await dispatch(
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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
      `/project/${project.id}`,
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

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await expect(listProjectsFromRegistry(testEnv, "member@example.com")).resolves.not.toEqual(
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
      { id: 1, name: "owner", deleted: false, linkedEmail: "owner@example.com" },
    ]);

    const postAfterBlockedRemoval = await dispatch(
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
      { id: 1, name: "owner", deleted: false, linkedEmail: "owner@example.com" },
      { id: 2, name: "Bob", deleted: false },
    ]);

    expect(await runProjectSummaryAlarm(testEnv, project.id)).toBe(true);
    await expect(listProjectsFromRegistry(testEnv, "member@example.com")).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );

    const postAfterKick = await dispatch(
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
    expect(postAfterKick.status).toBe(403);
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
    const records = response.records as Array<{
      id: number;
      createdAt: number;
      reverted?: { recordId: number; authorMemberId: number; createdAt: number };
    }>;
    const revertRecord = records.find((record) => record.id === 2);
    const originalRecord = records.find((record) => record.id === 1);
    expect(response).toMatchObject({ balance: {}, records: [{ id: 2 }, { id: 1 }] });
    expect(revertRecord).not.toHaveProperty("reverted");
    expect(originalRecord).toMatchObject({
      reverted: {
        recordId: 2,
        authorMemberId: 1,
        createdAt: revertRecord?.createdAt,
      },
    });
  });

  it("annotates reverted records when the reversal is outside the current page", async () => {
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

    await dispatch(
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
            liability: { "2": 1000 },
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

    const page = await dispatch(`/project/${project.id}?limit=1&offset=2`, testEnv, {
      headers: await authHeaders(),
    });
    expect(page.status).toBe(200);
    const body = (await page.json()) as ProjectResponse;
    const records = body.records as Array<{
      id: number;
      reverted?: { recordId: number; authorMemberId: number; createdAt: number };
    }>;

    expect(records).toMatchObject([
      {
        id: 1,
        reverted: {
          recordId: 3,
          authorMemberId: 1,
          createdAt: expect.any(Number) as number,
        },
      },
    ]);
  });
});
