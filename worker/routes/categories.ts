import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import {
  type AppContext,
  type EnvWithIdentity,
  parseJson,
  requireAuth,
  requireSameOriginWhenPresent,
} from "../auth";
import {
  CATEGORY_CONFIG_KEY,
  CategoryClassifier,
  CategoryClassificationName,
  CategoryClassificationTopK,
  CategoryDescription,
  CategoryIconName,
  CategoryId,
  CategoryName,
} from "../category";
import { ErrorResponse } from "../error";
import { PublishedGlobalConfigKvStore } from "../globalConfig";
import { errorResponses, OpenApiRequests, OpenApiResponses, OpenApiSecurity } from "../model";
import type { ErrorResultOf } from "../result";

const DEFAULT_CLASSIFY_TOP_K = 5;

const CategoryWriteBody = z
  .object({
    name: CategoryName,
    description: CategoryDescription.optional().default(""),
    icon: CategoryIconName.optional(),
  })
  .strict();

const ClassifyCategoryBody = z
  .object({
    name: CategoryClassificationName,
    topK: CategoryClassificationTopK.optional().default(DEFAULT_CLASSIFY_TOP_K),
  })
  .strict();

export const categoryApp = new Hono<EnvWithIdentity>();
export const adminCategoryApp = new Hono<EnvWithIdentity>();

categoryApp.get(
  "/categories",
  describeRoute({
    tags: ["Categories"],
    summary: "List configured spending categories",
    description:
      "Returns the currently published category definitions used by Seisan's expense classifier.",
    responses: {
      200: OpenApiResponses.CategoryList,
      ...errorResponses(500),
    },
  }),
  listPublishedCategories,
);

categoryApp.post(
  "/categories/classify",
  describeRoute({
    tags: ["Categories"],
    summary: "Classify a post name into configured spending categories",
    description:
      "Ranks published spending categories for the supplied expense text and returns the strongest match plus candidate scores.",
    security: OpenApiSecurity.ApiKeyBearer,
    requestBody: OpenApiRequests.CategoryClassify,
    responses: {
      200: OpenApiResponses.CategoryClassification,
      ...errorResponses(400, 401, 404, 500),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    const parsed = await parseJson(context, ClassifyCategoryBody);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    const result = await new CategoryClassifier(context.env, context.executionCtx).classify(
      parsed.data.name,
      { topK: parsed.data.topK },
    );
    if (!result.ok) {
      return mapClassificationError(result);
    }

    return context.json({
      category: result.category,
      score: result.score,
      candidates: result.candidates,
    });
  },
);

adminCategoryApp.get("/", listCategoriesForUpdate);

async function listPublishedCategories(context: AppContext): Promise<Response> {
  const result = await new PublishedGlobalConfigKvStore(
    context.env.PUBLISHED_GLOBAL_CONFIG,
  ).getValue(CATEGORY_CONFIG_KEY);
  if (!result.ok) {
    return ErrorResponse.internalServerError();
  }
  return context.json({ categories: result.value.categories });
}

async function listCategoriesForUpdate(context: AppContext): Promise<Response> {
  const result = await new CategoryClassifier(
    context.env,
    context.executionCtx,
  ).getCategoriesForUpdate();
  if (!result.ok) {
    return mapGetCategoriesForUpdateError(result);
  }
  return context.json({ categories: result.document.categories });
}

adminCategoryApp.post("/", async (context) => {
  const parsed = await parseJson(context, CategoryWriteBody);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const result = await new CategoryClassifier(context.env, context.executionCtx).upsertCategory({
    name: parsed.data.name,
    description: parsed.data.description,
    icon: parsed.data.icon,
  });
  if (!result.ok) {
    return mapUpsertError(result);
  }

  return context.json(
    { category: result.category, vectorizeMutation: result.vectorizeMutation },
    201,
  );
});

adminCategoryApp.put("/:id", async (context) => {
  const id = CategoryId.safeParse(context.req.param("id"));
  if (!id.success) {
    return ErrorResponse.invalidRequest();
  }

  const parsed = await parseJson(context, CategoryWriteBody);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const result = await new CategoryClassifier(context.env, context.executionCtx).upsertCategory({
    id: id.data,
    name: parsed.data.name,
    description: parsed.data.description,
    icon: parsed.data.icon,
  });
  if (!result.ok) {
    return mapUpsertError(result);
  }

  return context.json({
    category: result.category,
    vectorizeMutation: result.vectorizeMutation,
  });
});

adminCategoryApp.delete("/:id", async (context) => {
  const id = CategoryId.safeParse(context.req.param("id"));
  if (!id.success) {
    return ErrorResponse.invalidRequest();
  }

  const result = await new CategoryClassifier(context.env, context.executionCtx).deleteCategory(
    id.data,
  );
  if (!result.ok) {
    return mapDeleteError(result);
  }

  return new Response(null, { status: 204 });
});

function mapGetCategoriesForUpdateError(
  result: ErrorResultOf<CategoryClassifier["getCategoriesForUpdate"]>,
) {
  switch (result.error) {
    case "config_read_failed":
      return ErrorResponse.internalServerError();
  }
}

function mapUpsertError(result: ErrorResultOf<CategoryClassifier["upsertCategory"]>) {
  switch (result.error) {
    case "invalid_request":
      return ErrorResponse.invalidRequest();
    case "not_found":
      return ErrorResponse.notFound();
    case "category_exists":
      return ErrorResponse.conflict("category_exists");
    case "embedding_failed":
    case "vectorize_failed":
    case "config_read_failed":
      return ErrorResponse.internalServerError();
  }
}

function mapDeleteError(result: ErrorResultOf<CategoryClassifier["deleteCategory"]>) {
  switch (result.error) {
    case "invalid_request":
      return ErrorResponse.invalidRequest();
    case "not_found":
      return ErrorResponse.notFound();
    case "vectorize_failed":
    case "config_read_failed":
      return ErrorResponse.internalServerError();
  }
}

function mapClassificationError(result: ErrorResultOf<CategoryClassifier["classify"]>) {
  switch (result.error) {
    case "invalid_request":
      return ErrorResponse.invalidRequest();
    case "not_found":
      return ErrorResponse.notFound();
    case "config_read_failed":
    case "embedding_failed":
    case "vectorize_failed":
      return ErrorResponse.internalServerError();
  }
}
