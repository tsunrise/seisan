import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adminDispatch, cleanupWorkerTestState, jsonBody, makeEnv } from "./workerTestHelpers";

const TEST_VECTOR = [0.1, 0.2, 0.3];

describe("category PoC classifier", () => {
  afterEach(cleanupWorkerTestState);

  it("adds and classifies categories through admin endpoints", async () => {
    const aiRun = vi.fn(async () => ({ shape: [1, TEST_VECTOR.length], data: [TEST_VECTOR] }));
    const upsert = vi.fn<(vectors: VectorizeVector[]) => Promise<VectorizeVectorMutation>>(
      async () => ({ ids: [], count: 1 }),
    );
    const query = vi.fn<() => Promise<VectorizeMatches>>(async () => ({ count: 0, matches: [] }));
    const { env: testEnv } = makeEnv({
      AI: fakeAi(aiRun),
      CATEGORY_POC_INDEX: fakeVectorize({ upsert, query }),
    });

    const addResponse = await adminDispatch(
      "/category-poc/categories",
      testEnv,
      jsonBody("POST", {
        name: " Restaurant ",
        description: " Places that sell prepared meals ",
      }),
    );
    expect(addResponse.status).toBe(201);
    const addBody = (await addResponse.json()) as AddCategoryResponse;
    expect(addBody).toMatchObject({
      category: {
        name: "Restaurant",
        normalizedName: "restaurant",
        description: "Places that sell prepared meals",
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

    const listResponse = await adminDispatch("/category-poc/categories", testEnv);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      categories: [{ id: addBody.category.id, name: "Restaurant" }],
    });

    query.mockResolvedValueOnce({
      count: 1,
      matches: [{ id: addBody.category.vectorId, score: 0.91 }],
    });
    const classifyResponse = await adminDispatch(
      "/category-poc/classify",
      testEnv,
      jsonBody("POST", { name: "Taco Bell" }),
    );
    expect(classifyResponse.status).toBe(200);
    await expect(classifyResponse.json()).resolves.toMatchObject({
      category: { id: addBody.category.id, name: "Restaurant" },
      score: 0.91,
      candidates: [{ category: { id: addBody.category.id }, score: 0.91 }],
    });
    expect(aiRun).toHaveBeenLastCalledWith("@cf/google/embeddinggemma-300m", {
      text: ["task: classification | query: Taco Bell"],
    });
    expect(query).toHaveBeenCalledWith(TEST_VECTOR, { topK: 5, namespace: vectorNamespace });
  });

  it("removes categories before deleting stale Vectorize IDs best-effort", async () => {
    const deleteByIds = vi.fn(async () => ({ ids: [], count: 1 }));
    const query = vi.fn<() => Promise<VectorizeMatches>>(async () => ({ count: 0, matches: [] }));
    const { env: testEnv } = makeEnv({
      AI: fakeAi(vi.fn(async () => ({ shape: [1, TEST_VECTOR.length], data: [TEST_VECTOR] }))),
      CATEGORY_POC_INDEX: fakeVectorize({
        upsert: vi.fn(async () => ({ ids: [], count: 1 })),
        deleteByIds,
        query,
      }),
    });

    const addResponse = await adminDispatch(
      "/category-poc/categories",
      testEnv,
      jsonBody("POST", { name: "Grocery" }),
    );
    const addBody = (await addResponse.json()) as AddCategoryResponse;

    const deleteResponse = await adminDispatch(
      `/category-poc/categories/${addBody.category.id}`,
      testEnv,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(204);
    expect(deleteByIds).toHaveBeenCalledWith([addBody.category.vectorId]);

    query.mockResolvedValueOnce({
      count: 1,
      matches: [{ id: addBody.category.vectorId, score: 0.88 }],
    });
    const classifyResponse = await adminDispatch(
      "/category-poc/classify",
      testEnv,
      jsonBody("POST", { name: "Whole Foods" }),
    );
    expect(classifyResponse.status).toBe(404);
  });

  it("rolls back the stored category when Vectorize upsert fails", async () => {
    const upsert = vi
      .fn()
      .mockRejectedValueOnce(new Error("vectorize unavailable"))
      .mockResolvedValueOnce({ ids: [], count: 1 });
    const { env: testEnv } = makeEnv({
      AI: fakeAi(vi.fn(async () => ({ shape: [1, TEST_VECTOR.length], data: [TEST_VECTOR] }))),
      CATEGORY_POC_INDEX: fakeVectorize({ upsert }),
    });

    const failedAdd = await adminDispatch(
      "/category-poc/categories",
      testEnv,
      jsonBody("POST", { name: "Transportation: Gas/Fuel" }),
    );
    expect(failedAdd.status).toBe(500);

    const retriedAdd = await adminDispatch(
      "/category-poc/categories",
      testEnv,
      jsonBody("POST", { name: "Transportation: Gas/Fuel" }),
    );
    expect(retriedAdd.status).toBe(201);
  });

  it("validates admin request bodies and empty classification results", async () => {
    const aiRun = vi.fn(async () => ({ shape: [1, TEST_VECTOR.length], data: [TEST_VECTOR] }));
    const query = vi.fn<() => Promise<VectorizeMatches>>(async () => ({ count: 0, matches: [] }));
    const deleteByIds = vi.fn(async () => ({ ids: [], count: 0 }));
    const { env: testEnv } = makeEnv({
      AI: fakeAi(aiRun),
      CATEGORY_POC_INDEX: fakeVectorize({ query, deleteByIds }),
    });

    const malformed = await adminDispatch("/category-poc/categories", testEnv, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);

    const missingName = await adminDispatch(
      "/category-poc/categories",
      testEnv,
      jsonBody("POST", { description: "Missing name" }),
    );
    expect(missingName.status).toBe(400);

    const badId = await adminDispatch("/category-poc/categories/not-a-category-id", testEnv, {
      method: "DELETE",
    });
    expect(badId.status).toBe(400);
    expect(deleteByIds).not.toHaveBeenCalled();

    const badTopK = await adminDispatch(
      "/category-poc/classify",
      testEnv,
      jsonBody("POST", { name: "Coffee", topK: 0 }),
    );
    expect(badTopK.status).toBe(400);

    const emptyClassify = await adminDispatch(
      "/category-poc/classify",
      testEnv,
      jsonBody("POST", { name: "Coffee", topK: 3 }),
    );
    expect(emptyClassify.status).toBe(404);
    expect(query).toHaveBeenCalledWith(TEST_VECTOR, {
      topK: 3,
      namespace: expect.stringMatching(CATEGORY_NAMESPACE_PATTERN),
    });
  });

  it("validates DO storage behavior, namespace stability, and stale match filtering", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.CATEGORY_POC_STORE.getByName(`category-poc-do-${crypto.randomUUID()}`);
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";
    const firstVectorId = `category:${firstId}`;
    const secondVectorId = `category:${secondId}`;
    const namespace = await stub.getVectorNamespace();

    expect(namespace).toMatch(CATEGORY_NAMESPACE_PATTERN);
    await expect(stub.getVectorNamespace()).resolves.toBe(namespace);

    await expect(
      stub.addCategory({
        id: firstId,
        name: "Restaurant",
        description: "Prepared meals",
        documentText: "title: Restaurant | text: Prepared meals",
        vectorId: firstVectorId,
        nowMs: 1,
      }),
    ).resolves.toMatchObject({ ok: true, category: { normalizedName: "restaurant" } });

    await expect(
      stub.addCategory({
        id: secondId,
        name: " restaurant ",
        description: "",
        documentText: "title: restaurant | text: restaurant",
        vectorId: secondVectorId,
        nowMs: 2,
      }),
    ).resolves.toEqual({ ok: false, error: "already_exists" });
    await expect(stub.listCategories()).resolves.toMatchObject([
      {
        id: firstId,
        normalizedName: "restaurant",
        name: "Restaurant",
      },
    ]);

    await expect(stub.removeCategory({ id: firstId })).resolves.toEqual({
      ok: true,
      vectorId: firstVectorId,
    });
    await expect(
      stub.resolveMatches({
        matches: [
          { vectorId: firstVectorId, score: 0.9 },
          { vectorId: secondVectorId, score: 0.8 },
        ],
      }),
    ).resolves.toEqual({ ok: true, candidates: [] });

    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get<number>("dbMigrationVersion")).resolves.toBe(1);
      await expect(state.storage.get<string>("vectorNamespace")).resolves.toBe(namespace);
    });
  });
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CATEGORY_NAMESPACE_PATTERN =
  /^category-poc-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface AddCategoryResponse {
  category: {
    id: string;
    name: string;
    normalizedName: string;
    description: string;
    documentText: string;
    vectorId: string;
  };
  vectorizeMutation: VectorizeVectorMutation;
}

function fakeAi(
  run: (model: string, input: { text: string[] }) => Promise<AiTextEmbeddingsOutput>,
): Ai {
  return { run } as unknown as Ai;
}

function fakeVectorize(methods: Partial<VectorizeMethods> = {}): VectorizeIndex {
  return {
    describe: vi.fn(async () => ({
      id: "category-poc-test",
      name: "category-poc-test",
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

type VectorizeMethods = Pick<
  VectorizeIndex,
  "describe" | "query" | "insert" | "upsert" | "deleteByIds" | "getByIds"
>;
