import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CATEGORY_CONFIG_KEY,
  CategoriesDocument,
  type CategoriesDocument as CategoriesDocumentValue,
} from "../worker/category";
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

const TEST_VECTOR = [0.1, 0.2, 0.3];

describe("category classification", () => {
  afterEach(cleanupWorkerTestState);

  it("manages categories through admin endpoints and classifies through the authenticated API", async () => {
    const aiRun = vi.fn(async () => ({ shape: [1, TEST_VECTOR.length], data: [TEST_VECTOR] }));
    const classificationRateLimit = stubRateLimit(true);
    const upsert = vi.fn<(vectors: VectorizeVector[]) => Promise<VectorizeVectorMutation>>(
      async () => ({ ids: [], count: 1 }),
    );
    const query = vi.fn<() => Promise<VectorizeMatches>>(async () => ({ count: 0, matches: [] }));
    const { env: testEnv } = makeEnv({
      AI: fakeAi(aiRun),
      CATEGORY_INDEX: fakeVectorize({ upsert, query }),
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
    expect(addBody).toMatchObject({
      category: {
        name: "Restaurant",
        normalizedName: "restaurant",
        description: "Places that sell prepared meals",
        icon: "restaurant",
        documentText: "title: Restaurant | text: Places that sell prepared meals",
      },
      vectorizeMutation: { ids: [], count: 1 },
    });
    expect(addBody.category.id).toMatch(UUID_PATTERN);
    expect(addBody.category.vectorId).toBe(`category:${addBody.category.id}`);
    expect(aiRun).toHaveBeenCalledWith("@cf/google/embeddinggemma-300m", {
      text: ["title: Restaurant | text: Places that sell prepared meals"],
    });
    expect(upsert).toHaveBeenCalledWith([
      {
        id: addBody.category.vectorId,
        values: TEST_VECTOR,
        namespace: expect.stringMatching(CATEGORY_NAMESPACE_PATTERN),
      },
    ]);
    const [upsertedVector] = upsert.mock.calls[0]?.[0] ?? [];
    const vectorNamespace = upsertedVector?.namespace;
    expect(vectorNamespace).toMatch(CATEGORY_NAMESPACE_PATTERN);

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
    ).resolves.toMatchObject({
      version: 1,
      vectorNamespace,
      categories: [{ id: addBody.category.id, name: "Restaurant", icon: "restaurant" }],
    });

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

    query.mockResolvedValueOnce({
      count: 2,
      matches: [
        { id: addBody.category.vectorId, score: 0.91 },
        { id: "category:00000000-0000-4000-8000-000000000099", score: 0.89 },
      ],
    });
    const classifyResponse = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: "Taco Bell" }, await authHeaders()),
    );
    expect(classifyResponse.status).toBe(200);
    await expect(classifyResponse.json()).resolves.toMatchObject({
      category: { id: addBody.category.id, name: "Restaurant", icon: "restaurant" },
      score: 0.91,
      candidates: [{ category: { id: addBody.category.id }, score: 0.91 }],
    });
    expect(aiRun).toHaveBeenLastCalledWith("@cf/google/embeddinggemma-300m", {
      text: ["task: classification | query: Taco Bell"],
    });
    expect(query).toHaveBeenCalledWith(TEST_VECTOR, { topK: 5, namespace: vectorNamespace });
    expect(classificationRateLimit.limit).toHaveBeenCalledWith({
      key: `category-classification:account:${await sha256Hex("owner@example.com")}`,
    });
  });

  it("rate limits classification by normalized account before paid classification work", async () => {
    const classificationRateLimit = stubRateLimit(false);
    const aiRun = vi.fn(async () => ({ shape: [1, TEST_VECTOR.length], data: [TEST_VECTOR] }));
    const query = vi.fn<() => Promise<VectorizeMatches>>(async () => ({ count: 0, matches: [] }));
    const { env: testEnv } = makeEnv({
      AI: fakeAi(aiRun),
      CATEGORY_INDEX: fakeVectorize({ query }),
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
    expect(query).not.toHaveBeenCalled();
  });

  it("updates categories in place and removes deleted categories from published config", async () => {
    const deleteByIds = vi.fn(async () => ({ ids: [], count: 1 }));
    const query = vi.fn<() => Promise<VectorizeMatches>>(async () => ({ count: 0, matches: [] }));
    const { env: testEnv } = makeEnv({
      AI: fakeAi(vi.fn(async () => ({ shape: [1, TEST_VECTOR.length], data: [TEST_VECTOR] }))),
      CATEGORY_INDEX: fakeVectorize({
        upsert: vi.fn(async () => ({ ids: [], count: 1 })),
        deleteByIds,
        query,
      }),
    });

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
    expect(updateBody.category).toMatchObject({
      id: restaurant.category.id,
      vectorId: restaurant.category.vectorId,
      createdAt: restaurant.category.createdAt,
      name: "Dining",
      normalizedName: "dining",
      icon: "restaurant",
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
    expect(deleteByIds).toHaveBeenCalledWith([restaurant.category.vectorId]);
    await expect(
      waitForPublishedCategories(testEnv, (document) =>
        Boolean(
          document?.categories.length === 1 && document.categories[0]?.id === grocery.category.id,
        ),
      ),
    ).resolves.toMatchObject({
      categories: [{ id: grocery.category.id, name: "Grocery" }],
    });

    query.mockResolvedValueOnce({
      count: 1,
      matches: [{ id: restaurant.category.vectorId, score: 0.88 }],
    });
    const classifyDeleted = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: "Pizza" }, await authHeaders()),
    );
    expect(classifyDeleted.status).toBe(404);

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

  it("keeps category deletion retryable when Vectorize does not accept it", async () => {
    const deleteByIds = vi
      .fn<() => Promise<VectorizeVectorMutation>>()
      .mockRejectedValueOnce(new Error("Vectorize unavailable"))
      .mockResolvedValueOnce({ ids: [], count: 1 });
    const { env: testEnv } = makeEnv({
      AI: fakeAi(vi.fn(async () => ({ shape: [1, TEST_VECTOR.length], data: [TEST_VECTOR] }))),
      CATEGORY_INDEX: fakeVectorize({
        upsert: vi.fn(async () => ({ ids: [], count: 1 })),
        deleteByIds,
      }),
    });

    const restaurant = (await (
      await adminDispatch("/categories", testEnv, jsonBody("POST", { name: "Restaurant" }))
    ).json()) as CategoryWriteResponse;

    const failedDelete = await adminDispatch(`/categories/${restaurant.category.id}`, testEnv, {
      method: "DELETE",
    });
    expect(failedDelete.status).toBe(500);
    await expect(
      adminDispatch("/categories", testEnv).then((response) => response.json()),
    ).resolves.toMatchObject({ categories: [{ id: restaurant.category.id }] });

    const retriedDelete = await adminDispatch(`/categories/${restaurant.category.id}`, testEnv, {
      method: "DELETE",
    });
    expect(retriedDelete.status).toBe(204);
    expect(deleteByIds).toHaveBeenCalledTimes(2);
  });

  it("validates requests, auth, and hard category KV failures", async () => {
    const upsert = vi
      .fn()
      .mockRejectedValueOnce(new Error("vectorize unavailable"))
      .mockResolvedValueOnce({ ids: [], count: 1 });
    const { env: testEnv } = makeEnv({
      AI: fakeAi(vi.fn(async () => ({ shape: [1, TEST_VECTOR.length], data: [TEST_VECTOR] }))),
      CATEGORY_INDEX: fakeVectorize({ upsert }),
    });

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

    const failedAdd = await adminDispatch(
      "/categories",
      testEnv,
      jsonBody("POST", { name: "Transportation: Gas/Fuel" }),
    );
    expect(failedAdd.status).toBe(500);
    const publishedAfterFailedAdd = await waitForPublishedCategories(testEnv, (document) =>
      Boolean(
        document?.categories.some((category) => category.name === "Transportation: Gas/Fuel"),
      ),
    );
    if (!publishedAfterFailedAdd) {
      throw new Error("expected failed vectorize write to publish categories eventually");
    }
    expect(publishedAfterFailedAdd).toMatchObject({
      categories: [{ name: "Transportation: Gas/Fuel" }],
    });

    const retriedUpdate = await adminDispatch(
      `/categories/${publishedAfterFailedAdd.categories[0]?.id}`,
      testEnv,
      jsonBody("PUT", { name: "Transportation: Gas/Fuel" }),
    );
    expect(retriedUpdate.status).toBe(200);

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

    const emptyList = await stub.listCategories();
    expect(emptyList).toMatchObject({
      ok: true,
      document: { version: 1, categories: [] },
    });
    if (!emptyList.ok) {
      throw new Error("expected empty categories document");
    }

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
        vectorId: restaurant.category.vectorId,
        createdAt: 1_000,
        updatedAt: 1_002,
        name: "Dining",
        icon: "expense",
      },
    });

    const deleted = await stub.deleteCategory(restaurant.category.id);
    expect(deleted).toEqual({
      ok: true,
      document: {
        ...emptyList.document,
        vectorNamespace: restaurant.document.vectorNamespace,
        categories: [],
      },
      vectorId: restaurant.category.vectorId,
    });
    await expect(stub.deleteCategory(restaurant.category.id)).resolves.toEqual({
      ok: false,
      error: "not_found",
    });
    await expect(
      waitForPublishedCategories(testEnv, (document) => document?.categories.length === 0),
    ).resolves.toMatchObject({
      version: 1,
      categories: [],
    });
  });

  it("accepts and safely updates legacy version-1 category documents without icons", () => {
    const parsed = CategoriesDocument.safeParse({
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
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("expected legacy category document to parse");
    }

    expect(
      upsertCategoryInDocument(parsed.data, {
        id: parsed.data.categories[0]?.id,
        name: "Dining",
        nowMs: 2_000,
      }),
    ).toMatchObject({ ok: true, category: { name: "Dining", icon: "expense" } });
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
const CATEGORY_NAMESPACE_PATTERN =
  /^categories-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface CategoryWriteResponse {
  category: {
    id: string;
    name: string;
    normalizedName: string;
    description: string;
    icon?: IconName;
    documentText: string;
    vectorId: string;
    createdAt: number;
    updatedAt: number;
  };
  vectorizeMutation: VectorizeVectorMutation;
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

function fakeAi(
  run: (model: string, input: { text: string[] }) => Promise<AiTextEmbeddingsOutput>,
): Ai {
  return { run } as unknown as Ai;
}

function fakeVectorize(methods: Partial<VectorizeMethods> = {}): VectorizeIndex {
  return {
    describe: vi.fn(async () => ({
      id: "category-test",
      name: "category-test",
      dimensions: TEST_VECTOR.length,
      vectorsCount: 0,
      processedUpToDatetime: "",
      processedUpToMutation: "",
      config: { dimensions: TEST_VECTOR.length, metric: "cosine" },
    })),
    query: vi.fn(async () => ({ count: 0, matches: [] })),
    insert: vi.fn(async () => ({ ids: [], count: 0 })),
    upsert: vi.fn(async () => ({ ids: [], count: 0 })),
    deleteByIds: vi.fn(async () => ({ ids: [], count: 0 })),
    getByIds: vi.fn(async () => []),
    ...methods,
  } as VectorizeIndex;
}

function stubRateLimit(success: boolean): { binding: RateLimit; limit: ReturnType<typeof vi.fn> } {
  const limit = vi.fn(async () => ({ success }));
  return { binding: { limit } as RateLimit, limit };
}

type VectorizeMethods = Pick<
  VectorizeIndex,
  "describe" | "query" | "insert" | "upsert" | "deleteByIds" | "getByIds"
>;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
