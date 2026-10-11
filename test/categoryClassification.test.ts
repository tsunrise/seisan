import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CATEGORY_CONFIG_KEY,
  type CategoriesDocument as CategoriesDocumentValue,
} from "../worker/category";
import { CATEGORY_CLASSIFIER_MODEL } from "../worker/category/clef";
import { sha256Hex } from "../worker/crypto";
import { GLOBAL_CONFIG_STORE_NAME } from "../worker/globalConfig";
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

  it("manages categories through admin endpoints and classifies through the browser session route", async () => {
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
      classifyBody({ name: " Taco  Bell " }, await authHeaders()),
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
      classifyBody({ name: "Lunch", topK: 2 }, await authHeaders()),
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
      classifyBody({ name: "Lunch", topK: 20 }, await authHeaders()),
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
      classifyBody({ name: "Coffee" }, await authHeaders("Owner@Example.COM")),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited", reason: "account" });
    expect(classificationRateLimit.limit).toHaveBeenCalledWith({
      key: `category-classification:account:${await sha256Hex("owner@example.com")}`,
    });
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("rate limits classification by client IP before the account limit and paid work", async () => {
    const ipRateLimit = stubRateLimit(false);
    const accountRateLimit = stubRateLimit(true);
    const aiRun = vi.fn(async () => clefAnswer({}));
    const { env: testEnv } = makeEnv({
      AI: fakeAi(aiRun),
      CATEGORY_CLASSIFICATION_IP_RATE_LIMITER: ipRateLimit.binding,
      CATEGORY_CLASSIFICATION_ACCOUNT_RATE_LIMITER: accountRateLimit.binding,
    });

    const response = await dispatch(
      "/categories/classify",
      testEnv,
      classifyBody(
        { name: "Coffee" },
        {
          ...(await authHeaders()),
          "CF-Connecting-IP": "203.0.113.7",
        },
      ),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited", reason: "ip" });
    expect(ipRateLimit.limit).toHaveBeenCalledWith({
      key: `category-classification:ip:${await sha256Hex("203.0.113.7")}`,
    });
    expect(accountRateLimit.limit).not.toHaveBeenCalled();
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("groups IPv6 clients by /64 and falls back to the full address otherwise", async () => {
    const ipRateLimit = stubRateLimit(true);
    const { env: testEnv } = makeEnv({
      AI: fakeAi(vi.fn(async () => clefAnswer({}))),
      CATEGORY_CLASSIFICATION_IP_RATE_LIMITER: ipRateLimit.binding,
    });
    const keyFor = async (clientIp?: string) => {
      ipRateLimit.limit.mockClear();
      await dispatch(
        "/categories/classify",
        testEnv,
        classifyBody(
          { name: "Coffee" },
          { ...(await authHeaders()), ...(clientIp ? { "CF-Connecting-IP": clientIp } : {}) },
        ),
      );
      return (ipRateLimit.limit.mock.calls[0] as [{ key: string }] | undefined)?.[0].key;
    };
    const ipKey = async (source: string) => `category-classification:ip:${await sha256Hex(source)}`;

    const prefix = await ipKey("2001:db8:abcd:12::/64");
    await expect(keyFor("2001:db8:abcd:12::1")).resolves.toBe(prefix);
    await expect(keyFor("2001:0DB8:ABCD:0012:ffff:1:2:3")).resolves.toBe(prefix);
    await expect(keyFor("2001:db8:abcd:13::1")).resolves.toBe(await ipKey("2001:db8:abcd:13::/64"));
    await expect(keyFor("::1")).resolves.toBe(await ipKey("0:0:0:0::/64"));
    await expect(keyFor("::ffff:192.0.2.1")).resolves.toBe(await ipKey("::ffff:192.0.2.1"));
    await expect(keyFor("2001:db8::1::2")).resolves.toBe(await ipKey("2001:db8::1::2"));
    await expect(keyFor()).resolves.toBe(await ipKey("unknown"));
  });

  it("accepts only same-origin browser sessions before paid classification work", async () => {
    const classificationRateLimit = stubRateLimit(true);
    const aiRun = vi.fn(async () => clefAnswer({}));
    const { env: testEnv } = makeEnv({
      AI: fakeAi(aiRun),
      CATEGORY_CLASSIFICATION_ACCOUNT_RATE_LIMITER: classificationRateLimit.binding,
    });

    const withoutOrigin = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody("POST", { name: "Coffee" }, await authHeaders()),
    );
    expect(withoutOrigin.status).toBe(403);
    expect(await withoutOrigin.json()).toEqual({ error: "forbidden" });

    const crossOrigin = await dispatch(
      "/categories/classify",
      testEnv,
      jsonBody(
        "POST",
        { name: "Coffee" },
        {
          ...(await authHeaders()),
          Origin: "https://attacker.example",
        },
      ),
    );
    expect(crossOrigin.status).toBe(403);

    const created = await dispatch(
      "/api-keys",
      testEnv,
      jsonBody(
        "POST",
        { label: "CLI", expiresAt: Math.floor(Date.now() / 1000) + 86_400 },
        await authHeaders(),
      ),
    );
    expect(created.status).toBe(201);
    const { apiKey } = (await created.json()) as { apiKey: string };
    const apiKeyHeaders = { Authorization: `Bearer ${apiKey}` };
    const whoami = await dispatch("/whoami", testEnv, { headers: apiKeyHeaders });
    expect(whoami.status).toBe(200);

    const withApiKey = await dispatch(
      "/categories/classify",
      testEnv,
      classifyBody({ name: "Coffee" }, apiKeyHeaders),
    );
    expect(withApiKey.status).toBe(401);
    expect(await withApiKey.json()).toEqual({ error: "unauthorized" });

    expect(classificationRateLimit.limit).not.toHaveBeenCalled();
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
      classifyBody({ name: "Pizza" }, await authHeaders()),
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
        classifyBody({ name: "Coffee" }, await authHeaders()),
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
      classifyBody({ name: "Coffee" }),
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
      classifyBody({ name: "Coffee", topK: 0 }, await authHeaders()),
    );
    expect(badTopK.status).toBe(400);

    const missingKvGet = vi.fn(async () => null);
    const { env: missingKvEnv } = makeEnv({
      PUBLISHED_GLOBAL_CONFIG: { get: missingKvGet } as unknown as KVNamespace,
    });
    const missingKv = await dispatch(
      "/categories/classify",
      missingKvEnv,
      classifyBody({ name: "Coffee" }, await authHeaders()),
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
      classifyBody({ name: "Coffee" }, await authHeaders()),
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
      classifyBody({ name: "Coffee" }, await authHeaders()),
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

  it("fixes a stored category document the current schema rejects and republishes it", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.GLOBAL_CONFIG.getByName(GLOBAL_CONFIG_STORE_NAME);

    const missing = await adminDispatch("/categories/fix", testEnv, jsonBody("POST", {}));
    expect(missing.status).toBe(404);
    const invalidBody = await adminDispatch(
      "/categories/fix",
      testEnv,
      jsonBody("POST", { dryRun: "yes" }),
    );
    expect(invalidBody.status).toBe(400);

    const restaurantId = crypto.randomUUID();
    const petsId = crypto.randomUUID();
    const duplicateId = crypto.randomUUID();
    const legacyDocument = {
      version: 1,
      vectorNamespace: "categories-legacy",
      categories: [
        {
          id: restaurantId,
          name: "Restaurant",
          normalizedName: "restaurant",
          description: "Prepared meals",
          icon: "restaurant",
          createdAt: 1_000,
          updatedAt: 1_001,
          documentText: "title: Restaurant | text: Prepared meals",
          vectorId: "vector-restaurant",
        },
        {
          id: petsId,
          name: "Pets",
          normalizedName: "pets",
          description: "",
          icon: "retired-icon",
          createdAt: 1_000,
          updatedAt: 1_000,
          documentText: "title: Pets",
          vectorId: "vector-pets",
        },
        { id: "not-a-uuid", name: "Broken", normalizedName: "broken", description: "" },
        {
          id: duplicateId,
          name: "restaurant",
          normalizedName: "restaurant",
          description: "",
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
    };
    await stub.listCategories();
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO global_config (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        CATEGORY_CONFIG_KEY,
        JSON.stringify(legacyDocument),
      );
    });
    expect((await adminDispatch("/categories", testEnv)).status).toBe(500);

    const expectedFix = {
      categories: [
        {
          id: petsId,
          name: "Pets",
          normalizedName: "pets",
          description: "",
          createdAt: 1_000,
          updatedAt: 1_000,
        },
        {
          id: restaurantId,
          name: "Restaurant",
          normalizedName: "restaurant",
          description: "Prepared meals",
          icon: "restaurant",
          createdAt: 1_000,
          updatedAt: 1_001,
        },
      ],
      removed: [
        { id: "not-a-uuid", name: "Broken" },
        { id: duplicateId, name: "restaurant" },
      ],
      changed: true,
    };

    const dryRun = await adminDispatch(
      "/categories/fix",
      testEnv,
      jsonBody("POST", { dryRun: true }),
    );
    expect(dryRun.status).toBe(200);
    expect(await dryRun.json()).toEqual(expectedFix);
    await expect(stub.listCategories()).resolves.toEqual({ ok: false, error: "invalid_value" });

    const fixed = await adminDispatch("/categories/fix", testEnv, jsonBody("POST", {}));
    expect(fixed.status).toBe(200);
    expect(await fixed.json()).toEqual(expectedFix);
    await expect(stub.listCategories()).resolves.toEqual({
      ok: true,
      document: { version: 2, categories: expectedFix.categories },
    });
    await expect(
      waitForPublishedCategories(testEnv, (document) => document?.categories.length === 2),
    ).resolves.toEqual({ version: 2, categories: expectedFix.categories });

    const publicList = await dispatch("/categories", testEnv);
    expect(publicList.status).toBe(200);
    expect(await publicList.json()).toEqual({ categories: expectedFix.categories });

    const rerun = await adminDispatch("/categories/fix", testEnv, jsonBody("POST", {}));
    expect(await rerun.json()).toEqual({
      categories: expectedFix.categories,
      removed: [],
      changed: false,
    });
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

const TEST_ORIGIN = "https://seisan.test";

/** Builds a same-origin browser classification request, which the route requires. */
function classifyBody(body: unknown, headers?: HeadersInit): RequestInit {
  return jsonBody("POST", body, { Origin: TEST_ORIGIN, ...(headers ?? {}) });
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
