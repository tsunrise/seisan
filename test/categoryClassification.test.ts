import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CATEGORY_CONFIG_KEY,
  CategoriesDocument,
  type CategoriesDocument as CategoriesDocumentValue,
} from "../worker/category";
import { CATEGORY_CLASSIFIER_MODEL } from "../worker/category/clef";
import { upsertCategoryInDocument } from "../worker/category/document";
import { sha256Hex } from "../worker/crypto";
import type { IconName } from "../shared/icon-names";
import {
  adminDispatch,
  authHeaders,
  cleanupWorkerTestState,
  dispatch,
  jsonBody,
  makeEnv,
} from "./workerTestHelpers";

describe("category classification", () => {
  afterEach(cleanupWorkerTestState);

  it("manages categories through admin endpoints and classifies through the authenticated API", async () => {
    const aiRun = vi.fn(async () => clefAnswer({ Restaurant: 0.91, Others: 0.09 }));
    const classificationRateLimit = stubRateLimit(true);
    const { env: testEnv } = makeEnv({
      AI: fakeAi(aiRun),
      CATEGORY_CLASSIFICATION_ACCOUNT_RATE_LIMITER: classificationRateLimit.binding,
    });

    const emptyList = await dispatch("/categories", testEnv);
    expect(emptyList.status).toBe(500);
    expect(await emptyList.json()).toEqual({ error: "internal_server_error" });

    const emptyAdminAlias = await adminDispatch("/categories", testEnv);
    expect(emptyAdminAlias.status).toBe(200);
    expect(await emptyAdminAlias.json()).toEqual({ categories: [] });

    const addResponse = await adminDispatch(
      "/categories",
      testEnv,
      jsonBody("POST", {
        name: " Restaurant ",
        description: " Places that sell prepared meals ",
        icon: "restaurant",
      }),
    );
    expect(addResponse.status).toBe(201);
    const addBody = (await addResponse.json()) as CategoryWriteResponse;
    expect(addBody).toEqual({
      category: {
        id: expect.stringMatching(UUID_PATTERN),
        name: "Restaurant",
        normalizedName: "restaurant",
        description: "Places that sell prepared meals",
        icon: "restaurant",
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    });
    expect(aiRun).not.toHaveBeenCalled();

    const duplicate = await adminDispatch(
      "/categories",
      testEnv,
      jsonBody("POST", {
        name: "restaurant",
        description: "Duplicate normalized name",
      }),
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "category_exists" });

    await expect(
      waitForPublishedCategories(testEnv, (document) =>
        Boolean(document?.categories.some((category) => category.id === addBody.category.id)),
      ),
    ).resolves.toEqual({ version: 2, categories: [addBody.category] });

    const publishedGet = vi.spyOn(testEnv.PUBLISHED_GLOBAL_CONFIG, "get");
    const listResponse = await dispatch("/categories", testEnv);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      categories: [{ id: addBody.category.id, name: "Restaurant", icon: "restaurant" }],
    });
    expect(publishedGet).toHaveBeenCalledWith(CATEGORY_CONFIG_KEY, { cacheTtl: 300 });

    const adminListAlias = await adminDispatch("/categories", testEnv);
    expect(adminListAlias.status).toBe(200);
    await expect(adminListAlias.json()).resolves.toMatchObject({
      categories: [{ id: addBody.category.id, name: "Restaurant", icon: "restaurant" }],
    });

    const classifyResponse = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: " Taco  Bell " }, await authHeaders()),
    );
    expect(classifyResponse.status).toBe(200);
    await expect(classifyResponse.json()).resolves.toEqual({
      category: addBody.category,
      score: 0.91,
      othersScore: 0.09,
      candidates: [{ category: addBody.category, score: 0.91 }],
    });
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(aiRun).toHaveBeenCalledWith(CATEGORY_CLASSIFIER_MODEL, {
      model: "clef-flash",
      state: "Taco Bell",
      questions: {
        category: {
          type: "choice",
          instructions: expect.any(String),
          criteria: {
            Restaurant: "Places that sell prepared meals",
            Others: expect.any(String),
          },
        },
      },
    });
    expect(classificationRateLimit.limit).toHaveBeenCalledWith({
      key: `category-classification:account:${await sha256Hex("owner@example.com")}`,
    });
  });

  it("ranks every published category, applies topK, and reports the Others probability", async () => {
    const aiRun = vi.fn(async () =>
      clefAnswer({ Grocery: 0.2, Restaurant: 0.55, Travel: 0.05, Others: 0.2 }),
    );
    const { env: testEnv } = makeEnv({ AI: fakeAi(aiRun) });
    for (const name of ["Restaurant", "Grocery", "Travel", "Utilities"]) {
      const created = await adminDispatch("/categories", testEnv, jsonBody("POST", { name }));
      expect(created.status).toBe(201);
    }
    await waitForPublishedCategories(testEnv, (document) => document?.categories.length === 4);

    const response = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: "Lunch", topK: 2 }, await authHeaders()),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as ClassifyResponse;
    expect(body).toMatchObject({
      category: { name: "Restaurant" },
      score: 0.55,
      othersScore: 0.2,
    });
    expect(body.candidates.map(({ category, score }) => [category.name, score])).toEqual([
      ["Restaurant", 0.55],
      ["Grocery", 0.2],
    ]);
    expect(aiRun).toHaveBeenCalledWith(
      CATEGORY_CLASSIFIER_MODEL,
      expect.objectContaining({
        questions: {
          category: expect.objectContaining({
            // An empty description is sent as null rather than repeating the name.
            criteria: {
              Grocery: null,
              Restaurant: null,
              Travel: null,
              Utilities: null,
              Others: expect.any(String),
            },
          }),
        },
      }),
    );

    const allCandidates = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: "Lunch", topK: 20 }, await authHeaders()),
    );
    const allBody = (await allCandidates.json()) as ClassifyResponse;
    expect(allBody.candidates.map(({ category, score }) => [category.name, score])).toEqual([
      ["Restaurant", 0.55],
      ["Grocery", 0.2],
      ["Travel", 0.05],
      ["Utilities", 0],
    ]);
  });

  it("rate limits classification by normalized account before paid classification work", async () => {
    const classificationRateLimit = stubRateLimit(false);
    const aiRun = vi.fn(async () => clefAnswer({}));
    const { env: testEnv } = makeEnv({
      AI: fakeAi(aiRun),
      CATEGORY_CLASSIFICATION_ACCOUNT_RATE_LIMITER: classificationRateLimit.binding,
    });

    const response = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: "Coffee" }, await authHeaders("Owner@Example.COM")),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited", reason: "account" });
    expect(classificationRateLimit.limit).toHaveBeenCalledWith({
      key: `category-classification:account:${await sha256Hex("owner@example.com")}`,
    });
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("updates categories in place and stops offering deleted categories to the model", async () => {
    const aiRun = vi.fn(async () => clefAnswer({ Grocery: 0.7, Others: 0.3 }));
    const { env: testEnv } = makeEnv({ AI: fakeAi(aiRun) });

    const restaurant = (await (
      await adminDispatch(
        "/categories",
        testEnv,
        jsonBody("POST", { name: "Restaurant", icon: "restaurant" }),
      )
    ).json()) as CategoryWriteResponse;
    const grocery = (await (
      await adminDispatch("/categories", testEnv, jsonBody("POST", { name: "Grocery" }))
    ).json()) as CategoryWriteResponse;

    const updateResponse = await adminDispatch(
      `/categories/${restaurant.category.id}`,
      testEnv,
      jsonBody("PUT", {
        name: "Dining",
        description: "Restaurants, cafes, bars, and takeout",
      }),
    );
    expect(updateResponse.status).toBe(200);
    const updateBody = (await updateResponse.json()) as CategoryWriteResponse;
    expect(updateBody).toEqual({
      category: {
        id: restaurant.category.id,
        createdAt: restaurant.category.createdAt,
        updatedAt: expect.any(Number),
        name: "Dining",
        normalizedName: "dining",
        description: "Restaurants, cafes, bars, and takeout",
        icon: "restaurant",
      },
    });
    expect(grocery.category.icon).toBe("expense");

    const duplicateUpdate = await adminDispatch(
      `/categories/${restaurant.category.id}`,
      testEnv,
      jsonBody("PUT", { name: "Grocery" }),
    );
    expect(duplicateUpdate.status).toBe(409);

    const deleteResponse = await adminDispatch(`/categories/${restaurant.category.id}`, testEnv, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(204);
    await expect(
      waitForPublishedCategories(testEnv, (document) =>
        Boolean(
          document?.categories.length === 1 && document.categories[0]?.id === grocery.category.id,
        ),
      ),
    ).resolves.toMatchObject({
      categories: [{ id: grocery.category.id, name: "Grocery" }],
    });

    const classifyAfterDelete = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: "Pizza" }, await authHeaders()),
    );
    expect(classifyAfterDelete.status).toBe(200);
    await expect(classifyAfterDelete.json()).resolves.toMatchObject({
      category: { id: grocery.category.id },
      score: 0.7,
      othersScore: 0.3,
    });
    expect(aiRun).toHaveBeenCalledWith(
      CATEGORY_CLASSIFIER_MODEL,
      expect.objectContaining({
        questions: {
          category: expect.objectContaining({
            criteria: { Grocery: null, Others: expect.any(String) },
          }),
        },
      }),
    );

    const updateDeleted = await adminDispatch(
      `/categories/${restaurant.category.id}`,
      testEnv,
      jsonBody("PUT", { name: "Dining" }),
    );
    expect(updateDeleted.status).toBe(404);

    const deleteAgain = await adminDispatch(`/categories/${restaurant.category.id}`, testEnv, {
      method: "DELETE",
    });
    expect(deleteAgain.status).toBe(404);
  });

  it("returns 500 when clef-flash fails or returns an unexpected answer", async () => {
    const aiRun = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("Workers AI unavailable"))
      .mockResolvedValueOnce({ answers: { category: { type: "score", score: 1 } } })
      .mockResolvedValueOnce(clefAnswer({ Restaurant: 1.5 }));
    const { env: testEnv } = makeEnv({ AI: fakeAi(aiRun) });
    await adminDispatch("/categories", testEnv, jsonBody("POST", { name: "Restaurant" }));
    await waitForPublishedCategories(testEnv, (document) => document?.categories.length === 1);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await dispatch(
        "/categories/classify",
        testEnv,
        jsonBody("POST", { name: "Coffee" }, await authHeaders()),
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "internal_server_error" });
    }
    expect(aiRun).toHaveBeenCalledTimes(3);
  });

  it("validates requests, auth, reserved names, and hard category KV failures", async () => {
    const { env: testEnv } = makeEnv({ AI: fakeAi(vi.fn(async () => clefAnswer({}))) });

    const unauthenticated = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: "Coffee" }),
    );
    expect(unauthenticated.status).toBe(401);

    const malformed = await adminDispatch("/categories", testEnv, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);

    const missingName = await adminDispatch(
      "/categories",
      testEnv,
      jsonBody("POST", { description: "Missing name" }),
    );
    expect(missingName.status).toBe(400);

    const invalidIcon = await adminDispatch(
      "/categories",
      testEnv,
      jsonBody("POST", { name: "Invalid icon", icon: "not-an-icon" }),
    );
    expect(invalidIcon.status).toBe(400);

    const reservedName = await adminDispatch(
      "/categories",
      testEnv,
      jsonBody("POST", { name: " OTHERS " }),
    );
    expect(reservedName.status).toBe(400);

    const travel = (await (
      await adminDispatch("/categories", testEnv, jsonBody("POST", { name: "Travel" }))
    ).json()) as CategoryWriteResponse;
    const renameToReserved = await adminDispatch(
      `/categories/${travel.category.id}`,
      testEnv,
      jsonBody("PUT", { name: "others" }),
    );
    expect(renameToReserved.status).toBe(400);

    const badId = await adminDispatch("/categories/not-a-category-id", testEnv, {
      method: "DELETE",
    });
    expect(badId.status).toBe(400);

    const badTopK = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: "Coffee", topK: 0 }, await authHeaders()),
    );
    expect(badTopK.status).toBe(400);

    const missingKvGet = vi.fn(async () => null);
    const { env: missingKvEnv } = makeEnv({
      PUBLISHED_GLOBAL_CONFIG: { get: missingKvGet } as unknown as KVNamespace,
    });
    const missingKv = await dispatch(
      "/categories/classify",
      missingKvEnv,
      jsonBody("POST", { name: "Coffee" }, await authHeaders()),
    );
    expect(missingKv.status).toBe(500);
    expect(missingKvGet).toHaveBeenCalled();

    const kvGet = vi.fn(async () => {
      throw new Error("KV unavailable");
    });
    const { env: failingKvEnv } = makeEnv({
      PUBLISHED_GLOBAL_CONFIG: { get: kvGet } as unknown as KVNamespace,
    });
    const failingKv = await dispatch(
      "/categories/classify",
      failingKvEnv,
      jsonBody("POST", { name: "Coffee" }, await authHeaders()),
    );
    expect(failingKv.status).toBe(500);
    expect(kvGet).toHaveBeenCalled();

    const invalidKvGet = vi.fn(async () => "{");
    const { env: invalidKvEnv } = makeEnv({
      PUBLISHED_GLOBAL_CONFIG: { get: invalidKvGet } as unknown as KVNamespace,
    });
    const invalidKv = await dispatch(
      "/categories/classify",
      invalidKvEnv,
      jsonBody("POST", { name: "Coffee" }, await authHeaders()),
    );
    expect(invalidKv.status).toBe(500);
    expect(invalidKvGet).toHaveBeenCalled();
  });

  it("mutates category documents in GlobalConfig and publishes them to KV", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.GLOBAL_CONFIG.getByName(`global-config-${crypto.randomUUID()}`);

    await expect(stub.listCategories()).resolves.toEqual({
      ok: true,
      document: { version: 2, categories: [] },
    });

    const restaurant = await stub.upsertCategory({
      name: " Restaurant ",
      description: " Prepared meals ",
      nowMs: 1_000,
    });
    expect(restaurant).toMatchObject({
      ok: true,
      category: {
        name: "Restaurant",
        normalizedName: "restaurant",
        description: "Prepared meals",
        icon: "expense",
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    });
    if (!restaurant.ok) {
      throw new Error("expected category create");
    }

    await expect(
      stub.upsertCategory({ name: "restaurant", description: "Duplicate", nowMs: 1_001 }),
    ).resolves.toEqual({ ok: false, error: "category_exists" });

    const updatedRestaurant = await stub.upsertCategory({
      id: restaurant.category.id,
      name: "Dining",
      description: "Restaurants and takeout",
      nowMs: 1_002,
    });
    expect(updatedRestaurant).toMatchObject({
      ok: true,
      category: {
        id: restaurant.category.id,
        createdAt: 1_000,
        updatedAt: 1_002,
        name: "Dining",
        icon: "expense",
      },
    });

    await expect(stub.deleteCategory(restaurant.category.id)).resolves.toEqual({
      ok: true,
      document: { version: 2, categories: [] },
    });
    await expect(stub.deleteCategory(restaurant.category.id)).resolves.toEqual({
      ok: false,
      error: "not_found",
    });
    await expect(
      waitForPublishedCategories(testEnv, (document) => document?.categories.length === 0),
    ).resolves.toEqual({ version: 2, categories: [] });
  });

  it("upgrades legacy version-1 category documents and drops their index fields", () => {
    const parsed = CategoriesDocument.safeParse(LEGACY_V1_DOCUMENT);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("expected legacy category document to parse");
    }
    expect(parsed.data).toEqual({
      version: 2,
      categories: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          name: "Restaurant",
          normalizedName: "restaurant",
          description: "Prepared meals",
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
    });

    expect(
      upsertCategoryInDocument(parsed.data, {
        id: parsed.data.categories[0]?.id,
        name: "Dining",
        nowMs: 2_000,
      }),
    ).toMatchObject({ ok: true, category: { name: "Dining", icon: "expense" } });

    expect(
      CategoriesDocument.safeParse({
        ...LEGACY_V1_DOCUMENT,
        categories: [{ ...LEGACY_V1_DOCUMENT.categories[0], unexpected: true }],
      }).success,
    ).toBe(false);
  });

  it("rewrites a stored version-1 document as version 2 on the next GlobalConfig mutation", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.GLOBAL_CONFIG.getByName(`global-config-${crypto.randomUUID()}`);
    await stub.listCategories();
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO global_config (key, value) VALUES (?, ?)`,
        CATEGORY_CONFIG_KEY,
        JSON.stringify(LEGACY_V1_DOCUMENT),
      );
    });

    await expect(stub.listCategories()).resolves.toMatchObject({
      ok: true,
      document: { version: 2, categories: [{ name: "Restaurant" }] },
    });
    await expect(stub.upsertCategory({ name: "Grocery", nowMs: 2_000 })).resolves.toMatchObject({
      ok: true,
    });

    await runInDurableObject(stub, async (_instance, state) => {
      const raw = state.storage.sql
        .exec<{
          value: string;
        }>("SELECT value FROM global_config WHERE key = ?", CATEGORY_CONFIG_KEY)
        .one().value;
      const stored = JSON.parse(raw) as Record<string, unknown>;
      expect(stored).toMatchObject({
        version: 2,
        categories: [{ name: "Grocery" }, { name: "Restaurant" }],
      });
      expect(stored).not.toHaveProperty("vectorNamespace");
      expect(JSON.stringify(stored)).not.toContain("vectorId");
    });
  });

  it("serves a still-published version-1 KV document without its index fields", async () => {
    const aiRun = vi.fn(async () => clefAnswer({ Restaurant: 0.8, Others: 0.2 }));
    const { env: testEnv } = makeEnv({ AI: fakeAi(aiRun) });
    await testEnv.PUBLISHED_GLOBAL_CONFIG.put(
      CATEGORY_CONFIG_KEY,
      JSON.stringify(LEGACY_V1_DOCUMENT),
    );

    const listResponse = await dispatch("/categories", testEnv);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as { categories: Array<Record<string, unknown>> };
    expect(listed.categories).toHaveLength(1);
    expect(listed.categories[0]).not.toHaveProperty("vectorId");
    expect(listed.categories[0]).not.toHaveProperty("documentText");

    const classifyResponse = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: "Lunch" }, await authHeaders()),
    );
    expect(classifyResponse.status).toBe(200);
    await expect(classifyResponse.json()).resolves.toMatchObject({
      category: { name: "Restaurant" },
      score: 0.8,
    });
  });

  it("applies concurrent category mutations through GlobalConfig", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.GLOBAL_CONFIG.getByName(`global-config-${crypto.randomUUID()}`);
    const names = ["Restaurant", "Grocery", "Travel", "Utilities"];

    const results = await Promise.all(
      names.map((name, index) => stub.upsertCategory({ name, nowMs: 2_000 + index })),
    );
    expect(results.every((result) => result.ok)).toBe(true);

    const listed = await stub.listCategories();
    expect(listed).toMatchObject({
      ok: true,
      document: {
        categories: names
          .map((name) => ({ name }))
          .sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase())),
      },
    });
    await expect(
      waitForPublishedCategories(
        testEnv,
        (document) => document?.categories.length === names.length,
      ),
    ).resolves.toMatchObject({
      categories: names
        .map((name) => ({ name }))
        .sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase())),
    });
  });

  it("republishes the latest GlobalConfig value when KV writes finish out of order", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.GLOBAL_CONFIG.getByName(`global-config-${crypto.randomUUID()}`);
    const originalPut = testEnv.PUBLISHED_GLOBAL_CONFIG.put.bind(testEnv.PUBLISHED_GLOBAL_CONFIG);
    const firstPutStarted = deferred();
    const releaseFirstPut = deferred();
    const secondPutFinished = deferred();
    const repairPutFinished = deferred();
    let controlledPutCount = 0;

    vi.spyOn(testEnv.PUBLISHED_GLOBAL_CONFIG, "put").mockImplementation(
      async (key, value, options) => {
        const document: CategoriesDocumentValue | null =
          typeof value === "string" ? (JSON.parse(value) as CategoriesDocumentValue) : null;
        const isControlledWrite =
          document?.categories.some((category) => category.name.startsWith("Publication ")) ??
          false;
        if (!isControlledWrite) {
          return originalPut(key, value, options);
        }

        controlledPutCount += 1;
        const putNumber = controlledPutCount;
        if (putNumber === 1) {
          firstPutStarted.resolve();
          await releaseFirstPut.promise;
        }

        await originalPut(key, value, options);
        if (putNumber === 2) {
          secondPutFinished.resolve();
        } else if (putNumber === 3) {
          repairPutFinished.resolve();
        }
      },
    );

    try {
      await expect(
        stub.upsertCategory({ name: "Publication First", nowMs: 4_000 }),
      ).resolves.toMatchObject({ ok: true });
      await firstPutStarted.promise;

      await expect(
        stub.upsertCategory({ name: "Publication Second", nowMs: 4_001 }),
      ).resolves.toMatchObject({ ok: true });
      await secondPutFinished.promise;

      releaseFirstPut.resolve();
      await repairPutFinished.promise;

      await expect(readPublishedCategories(testEnv)).resolves.toMatchObject({
        categories: [{ name: "Publication First" }, { name: "Publication Second" }],
      });
      expect(controlledPutCount).toBe(3);
    } finally {
      releaseFirstPut.resolve();
    }
  });

  it("reports malformed GlobalConfig values and does not fail writes on async KV publish failure", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.GLOBAL_CONFIG.getByName(`global-config-${crypto.randomUUID()}`);
    await stub.listCategories();

    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(1);
      state.storage.sql.exec(
        `INSERT INTO global_config (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        CATEGORY_CONFIG_KEY,
        "{",
      );
    });
    await expect(stub.listCategories()).resolves.toEqual({
      ok: false,
      error: "invalid_value",
    });

    const cleanStub = testEnv.GLOBAL_CONFIG.getByName(`global-config-${crypto.randomUUID()}`);
    const putSpy = vi
      .spyOn(testEnv.PUBLISHED_GLOBAL_CONFIG, "put")
      .mockRejectedValueOnce(new Error("KV unavailable"));
    await expect(
      cleanStub.upsertCategory({ name: "Restaurant", nowMs: 3_000 }),
    ).resolves.toMatchObject({
      ok: true,
      category: { name: "Restaurant" },
    });
    expect(putSpy).toHaveBeenCalled();

    await runInDurableObject(cleanStub, async (_instance, state) => {
      const raw = state.storage.sql
        .exec<{
          value: string;
        }>("SELECT value FROM global_config WHERE key = ?", CATEGORY_CONFIG_KEY)
        .one().value;
      expect(JSON.parse(raw)).toMatchObject({
        categories: [{ name: "Restaurant" }],
      });
    });
  });
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const LEGACY_V1_DOCUMENT = {
  version: 1,
  vectorNamespace: "categories-00000000-0000-4000-8000-000000000001",
  categories: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      name: "Restaurant",
      normalizedName: "restaurant",
      description: "Prepared meals",
      documentText: "title: Restaurant | text: Prepared meals",
      vectorId: "category:00000000-0000-4000-8000-000000000010",
      createdAt: 1_000,
      updatedAt: 1_000,
    },
  ],
};

interface CategoryWriteResponse {
  category: {
    id: string;
    name: string;
    normalizedName: string;
    description: string;
    icon?: IconName;
    createdAt: number;
    updatedAt: number;
  };
}

interface ClassifyResponse {
  category: CategoryWriteResponse["category"];
  score: number;
  othersScore: number;
  candidates: Array<{ category: CategoryWriteResponse["category"]; score: number }>;
}

async function readPublishedCategories(testEnv: Env): Promise<unknown> {
  const raw = await testEnv.PUBLISHED_GLOBAL_CONFIG.get(CATEGORY_CONFIG_KEY);
  return raw === null ? null : JSON.parse(raw);
}

async function waitForPublishedCategories(
  testEnv: Env,
  predicate: (document: CategoriesDocumentValue | null) => boolean,
): Promise<CategoriesDocumentValue | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const document = (await readPublishedCategories(testEnv)) as CategoriesDocumentValue | null;
    if (predicate(document)) {
      return document;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return (await readPublishedCategories(testEnv)) as CategoriesDocumentValue | null;
}

/** Shapes a clef-flash choice answer for the category question. */
function clefAnswer(probabilities: Record<string, number>): unknown {
  return {
    model: "clef-flash",
    answers: {
      category: {
        type: "choice",
        choice: Object.keys(probabilities)[0] ?? "Others",
        probabilities,
        confidence: 0.9,
      },
    },
    usage: { input_tokens: 100, output_tokens: 0 },
  };
}

function fakeAi(run: (model: string, input: unknown) => Promise<unknown>): Ai {
  return { run } as unknown as Ai;
}

function stubRateLimit(success: boolean): { binding: RateLimit; limit: ReturnType<typeof vi.fn> } {
  const limit = vi.fn(async () => ({ success }));
  return { binding: { limit } as RateLimit, limit };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
