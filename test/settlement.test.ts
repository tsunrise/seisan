import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { SettlementPlanUtils, type MoneyByMemberId, type TransferBatch } from "../worker/project";
import {
  authHeaders,
  cleanupWorkerTestState,
  createMember,
  createProject,
  dispatch,
  getProjectStoreStub,
  jsonBody,
  makeEnv,
} from "./workerTestHelpers";

interface SettlementPlanResponse {
  transfers: TransferBatch[];
}

function requirePlan(balance: MoneyByMemberId): TransferBatch[] {
  const plan = SettlementPlanUtils.create(balance);
  expect(plan).not.toBeNull();
  if (!plan) {
    throw new Error("expected a valid settlement plan");
  }
  return plan;
}

function assertSettlementProperties(balance: MoneyByMemberId, plan: TransferBatch[]): void {
  const initialBalances = new Map(
    Object.entries(balance).map(([memberId, amount]) => [Number(memberId), amount]),
  );
  const remainingBalances = new Map(initialBalances);
  const sourceIds = plan.map((batch) => batch.src);
  const positiveTotal = [...initialBalances.values()]
    .filter((amount) => amount > 0)
    .reduce((total, amount) => total + BigInt(amount), 0n);
  let transferredTotal = 0n;
  let legCount = 0;

  expect(sourceIds).toEqual([...sourceIds].sort((left, right) => left - right));
  expect(new Set(sourceIds).size).toBe(sourceIds.length);

  for (const batch of plan) {
    expect(initialBalances.get(batch.src)).toBeGreaterThan(0);
    expect(batch.dests.length).toBeGreaterThan(0);
    const destinationIds = batch.dests.map((destination) => destination.id);
    expect(destinationIds).toEqual([...destinationIds].sort((left, right) => left - right));
    expect(new Set(destinationIds).size).toBe(destinationIds.length);

    for (const destination of batch.dests) {
      expect(destination.id).not.toBe(batch.src);
      expect(initialBalances.get(destination.id)).toBeLessThan(0);
      expect(Number.isSafeInteger(destination.amount)).toBe(true);
      expect(destination.amount).toBeGreaterThan(0);

      remainingBalances.set(
        batch.src,
        (remainingBalances.get(batch.src) ?? 0) - destination.amount,
      );
      remainingBalances.set(
        destination.id,
        (remainingBalances.get(destination.id) ?? 0) + destination.amount,
      );
      transferredTotal += BigInt(destination.amount);
      legCount += 1;
    }
  }

  expect([...remainingBalances.values()].every((amount) => amount === 0)).toBe(true);
  expect(transferredTotal).toBe(positiveTotal);
  const nonZeroMemberCount = [...initialBalances.values()].filter((amount) => amount !== 0).length;
  expect(legCount).toBeLessThanOrEqual(Math.max(0, nonZeroMemberCount - 1));
}

function promiseRecordBody(creditorMemberId: number, amount: number) {
  return {
    delta: { "1": amount, [String(creditorMemberId)]: -amount },
    description: {
      type: "promise" as const,
      debtorMemberId: 1,
      creditorMemberId,
      amount,
    },
  };
}

function noOpRecordBody(name: string) {
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

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  integer(min: number, max: number): number {
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return min + (this.state % (max - min + 1));
  }
}

function randomBalancedLedger(seed: number): MoneyByMemberId {
  const random = new SeededRandom(seed);
  const memberCount = random.integer(2, 128);
  const memberIds = Array.from({ length: memberCount }, (_, index) => index * 3 + 1);
  const balance = Object.fromEntries(memberIds.map((memberId) => [String(memberId), 0]));
  const transactionCount = random.integer(1, memberCount * 4);

  for (let index = 0; index < transactionCount; index += 1) {
    const senderIndex = random.integer(0, memberIds.length - 1);
    let recipientIndex = random.integer(0, memberIds.length - 2);
    if (recipientIndex >= senderIndex) {
      recipientIndex += 1;
    }
    const senderId = String(memberIds[senderIndex]);
    const recipientId = String(memberIds[recipientIndex]);
    const amount = random.integer(1, 10_000_000);
    balance[senderId] += amount;
    balance[recipientId] -= amount;
  }

  return balance;
}

describe("settlement edge and adversarial cases", () => {
  afterEach(cleanupWorkerTestState);

  it("handles empty, zero, one-cent, and maximum-safe balances", () => {
    expect(SettlementPlanUtils.create({})).toEqual([]);
    expect(SettlementPlanUtils.create({ "1": 0, "2": -0 })).toEqual([]);
    expect(SettlementPlanUtils.create({ "1": 1, "2": -1 })).toEqual([
      { src: 1, dests: [{ id: 2, amount: 1 }] },
    ]);
    expect(
      SettlementPlanUtils.create({
        "1": Number.MAX_SAFE_INTEGER,
        "2": -Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual([{ src: 1, dests: [{ id: 2, amount: Number.MAX_SAFE_INTEGER }] }]);
  });

  it("settles one-to-many and many-to-one balances", () => {
    const oneToMany = { "1": 1_000, "2": -400, "3": -600 };
    const oneToManyPlan = requirePlan(oneToMany);
    expect(oneToManyPlan).toEqual([
      {
        src: 1,
        dests: [
          { id: 2, amount: 400 },
          { id: 3, amount: 600 },
        ],
      },
    ]);
    assertSettlementProperties(oneToMany, oneToManyPlan);

    const manyToOne = { "1": 400, "2": 600, "3": -1_000 };
    const manyToOnePlan = requirePlan(manyToOne);
    expect(manyToOnePlan).toEqual([
      { src: 1, dests: [{ id: 3, amount: 400 }] },
      { src: 2, dests: [{ id: 3, amount: 600 }] },
    ]);
    assertSettlementProperties(manyToOne, manyToOnePlan);
  });

  it("takes exact matches before greedy matches in an adversarial case", () => {
    const balance = { "1": 800, "2": 500, "3": -500, "4": -400, "5": -400 };
    const plan = requirePlan(balance);
    expect(plan).toEqual([
      {
        src: 1,
        dests: [
          { id: 4, amount: 400 },
          { id: 5, amount: 400 },
        ],
      },
      { src: 2, dests: [{ id: 3, amount: 500 }] },
    ]);
    expect(plan.flatMap((batch) => batch.dests)).toHaveLength(3);
    assertSettlementProperties(balance, plan);
  });

  it("breaks equal-amount ties by member ID", () => {
    expect(SettlementPlanUtils.create({ "9": -500, "7": 500, "4": -500, "2": 500 })).toEqual([
      { src: 2, dests: [{ id: 4, amount: 500 }] },
      { src: 7, dests: [{ id: 9, amount: 500 }] },
    ]);
  });

  it("reorders heap remainders without mutating input and emits canonical batches", () => {
    const balance = { "9": 700, "2": 900, "12": -800, "4": -800 };
    const snapshot = structuredClone(balance);
    const plan = requirePlan(balance);
    expect(plan).toEqual([
      {
        src: 2,
        dests: [
          { id: 4, amount: 800 },
          { id: 12, amount: 100 },
        ],
      },
      { src: 9, dests: [{ id: 12, amount: 700 }] },
    ]);
    expect(balance).toEqual(snapshot);
    assertSettlementProperties(balance, plan);
  });

  it("uses exact arithmetic when aggregate balances exceed Number.MAX_SAFE_INTEGER", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const balance = { "1": max, "2": max, "3": max, "4": -max, "5": -max, "6": -max };
    const plan = requirePlan(balance);
    expect(plan).toEqual([
      { src: 1, dests: [{ id: 4, amount: max }] },
      { src: 2, dests: [{ id: 5, amount: max }] },
      { src: 3, dests: [{ id: 6, amount: max }] },
    ]);
    assertSettlementProperties(balance, plan);
  });

  it("rejects malformed, unsafe, and non-zero-sum balance maps", () => {
    const invalidBalances: MoneyByMemberId[] = [
      { "1": 1 },
      { "0": 1, "1": -1 },
      { "-1": 1, "2": -1 },
      { "1.5": 1, "2": -1 },
      { "1": 0.5, "2": -0.5 },
      { "1": Number.NaN, "2": 0 },
      { "1": Number.POSITIVE_INFINITY, "2": Number.NEGATIVE_INFINITY },
      { "1": Number.MAX_SAFE_INTEGER + 1, "2": -(Number.MAX_SAFE_INTEGER + 1) },
      { "1": 1, "01": -1 },
    ];

    for (const balance of invalidBalances) {
      expect(SettlementPlanUtils.create(balance)).toBeNull();
    }
  });

  it("serves a valid exact-first plan through the project endpoint", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    await createMember(testEnv, project.id, "Bob");
    await createMember(testEnv, project.id, "Carol");
    await createMember(testEnv, project.id, "Dana");
    await createMember(testEnv, project.id, "Eli");
    const balance = { "1": 800, "2": 500, "3": -500, "4": -400, "5": -400 };

    const posted = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody(
        "POST",
        {
          delta: balance,
          description: {
            type: "expense",
            name: "Trip",
            paid: { "3": 500, "4": 400, "5": 400 },
            liability: { "1": 800, "2": 500 },
          },
        },
        await authHeaders(),
      ),
    );
    expect(posted.status).toBe(201);

    const response = await dispatch(`/project/${project.id}/settle`, testEnv);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SettlementPlanResponse;
    assertSettlementProperties(balance, body.transfers);
    expect(body.transfers.flatMap((batch) => batch.dests)).toHaveLength(3);
  });

  it("uses the KV cache until a new record or revert changes the latest record ID", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv, { ownerMemberName: "Alice" });
    const bob = await createMember(testEnv, project.id, "Bob");
    const promise = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody("POST", promiseRecordBody(bob.id, 500), await authHeaders()),
    );
    expect(promise.status).toBe(201);

    const expectedPlan = {
      transfers: [{ src: 1, dests: [{ id: bob.id, amount: 500 }] }],
    };
    expect(await (await dispatch(`/project/${project.id}/settle`, testEnv)).json()).toEqual(
      expectedPlan,
    );

    const stub = await getProjectStoreStub(testEnv, project.id);
    await runInDurableObject(stub, async (_instance, state) => {
      const raw = await state.storage.get<string>("settlementPlanCache");
      expect(JSON.parse(raw ?? "")).toEqual({ latestRecordId: 1, ...expectedPlan });
      await state.storage.put(
        "settlementPlanCache",
        JSON.stringify({
          latestRecordId: 1,
          transfers: [{ src: 999, dests: [{ id: 998, amount: 1 }] }],
        }),
      );
    });

    expect(await (await dispatch(`/project/${project.id}/settle`, testEnv)).json()).toEqual({
      transfers: [{ src: 999, dests: [{ id: 998, amount: 1 }] }],
    });

    const noOpRecord = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody("POST", noOpRecordBody("No-op"), await authHeaders()),
    );
    expect(await noOpRecord.json()).toEqual({ id: 2 });
    expect(await (await dispatch(`/project/${project.id}/settle`, testEnv)).json()).toEqual(
      expectedPlan,
    );

    const reverted = await dispatch(
      `/project/${project.id}`,
      testEnv,
      jsonBody("POST", { delta: {}, description: { type: "revert", id: 2 } }, await authHeaders()),
    );
    expect(await reverted.json()).toEqual({ id: 3 });
    await dispatch(`/project/${project.id}/settle`, testEnv);

    await runInDurableObject(stub, async (_instance, state) => {
      const raw = await state.storage.get<string>("settlementPlanCache");
      expect(JSON.parse(raw ?? "")).toEqual({ latestRecordId: 3, ...expectedPlan });
      await state.storage.put("settlementPlanCache", "not-json");
    });
    expect(await (await dispatch(`/project/${project.id}/settle`, testEnv)).json()).toEqual(
      expectedPlan,
    );
  });

  it("caches an empty plan at record ID zero and enforces project read access", async () => {
    const { env: testEnv } = makeEnv();
    const publicProject = await createProject(testEnv);
    const publicResponse = await dispatch(`/project/${publicProject.id}/settle`, testEnv);
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toEqual({ transfers: [] });

    const publicStub = await getProjectStoreStub(testEnv, publicProject.id);
    await runInDurableObject(publicStub, async (_instance, state) => {
      const raw = await state.storage.get<string>("settlementPlanCache");
      expect(JSON.parse(raw ?? "")).toEqual({ latestRecordId: 0, transfers: [] });
    });

    const restrictedProject = await createProject(testEnv, {
      acl: { type: "restricted", emails: ["reader@example.com"] },
    });
    expect((await dispatch(`/project/${restrictedProject.id}/settle`, testEnv)).status).toBe(403);
    expect(
      (
        await dispatch(`/project/${restrictedProject.id}/settle`, testEnv, {
          headers: await authHeaders("reader@example.com"),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await dispatch(`/project/${restrictedProject.id}/settle`, testEnv, {
          headers: await authHeaders("outsider@example.com"),
        })
      ).status,
    ).toBe(403);
  });

  it("returns an internal error for an unbalanced stored balance invariant", async () => {
    const { env: testEnv } = makeEnv();
    const project = await createProject(testEnv);
    const stub = await getProjectStoreStub(testEnv, project.id);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("INSERT INTO balances (member_id, amount_cents) VALUES (1, 1)");
    });

    const response = await dispatch(`/project/${project.id}/settle`, testEnv);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_server_error" });
  });
});

describe("settlement randomized properties", () => {
  it("settles 500 seeded arbitrary ledgers deterministically", () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const balance = randomBalancedLedger(seed);
      const snapshot = structuredClone(balance);
      const plan = requirePlan(balance);

      expect(SettlementPlanUtils.create(balance)).toEqual(plan);
      expect(balance).toEqual(snapshot);
      assertSettlementProperties(balance, plan);

      const memberId = Object.keys(balance)[seed % Object.keys(balance).length];
      const unbalanced = { ...balance, [memberId]: balance[memberId] + 1 };
      expect(SettlementPlanUtils.create(unbalanced)).toBeNull();
    }
  });

  it("settles 250 seeded exact-match ledgers with one leg per pair", () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      const random = new SeededRandom(seed * 97);
      const pairCount = random.integer(1, 64);
      const balance: MoneyByMemberId = {};
      for (let index = 0; index < pairCount; index += 1) {
        const amount = random.integer(1, 10_000_000);
        balance[String(index * 2 + 1)] = amount;
        balance[String(index * 2 + 2)] = -amount;
      }

      const plan = requirePlan(balance);
      assertSettlementProperties(balance, plan);
      expect(plan).toHaveLength(pairCount);
      expect(plan.every((batch) => batch.dests.length === 1)).toBe(true);
    }
  });
});
