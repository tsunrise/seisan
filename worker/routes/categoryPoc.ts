import { Hono } from "hono";
import { z } from "zod";

import { type AppContext, type EnvWithIdentity, parseJson } from "../auth";
import {
  CATEGORY_POC_STORE_NAME,
  CategoryPocId,
  CategoryPocName,
  CategoryPocDescription,
  categoryPocVectorIdForCategory,
} from "../categoryPoc";
import type { CategoryPocStore } from "../do/CategoryPocStore";
import { ErrorResponse } from "../error";

const EMBEDDING_MODEL = "@cf/google/embeddinggemma-300m";
const DEFAULT_CLASSIFY_TOP_K = 5;
const MAX_CLASSIFY_TOP_K = 20;
const TRANSACTION_NAME_MAX_LENGTH = 200;

const AddCategoryBody = z
  .object({
    name: CategoryPocName,
    description: CategoryPocDescription.optional().default(""),
  })
  .strict();

const ClassifyBody = z
  .object({
    name: z
      .string()
      .transform((name) => name.trim().replace(/\s+/gu, " "))
      .pipe(z.string().min(1).max(TRANSACTION_NAME_MAX_LENGTH)),
    topK: z
      .number()
      .int()
      .min(1)
      .max(MAX_CLASSIFY_TOP_K)
      .optional()
      .default(DEFAULT_CLASSIFY_TOP_K),
  })
  .strict();

export const categoryPocApp = new Hono<EnvWithIdentity>();

categoryPocApp.get("/categories", async (context) => {
  const categories = await getStore(context).listCategories();
  return context.json({ categories });
});

categoryPocApp.post("/categories", async (context) => {
  const parsed = await parseJson(context, AddCategoryBody);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const id = crypto.randomUUID();
  const vectorId = categoryPocVectorIdForCategory(id);
  const documentText = formatCategoryDocument(parsed.data.name, parsed.data.description);
  const embedding = await embedText(context.env.AI, documentText);
  if (!embedding) {
    return ErrorResponse.internalServerError();
  }

  const store = getStore(context);
  const namespace = await store.getVectorNamespace();
  const added = await store.addCategory({
    id,
    name: parsed.data.name,
    description: parsed.data.description,
    documentText,
    vectorId,
    nowMs: Date.now(),
  });
  if (!added.ok) {
    return added.error === "already_exists"
      ? ErrorResponse.conflict("category_exists")
      : ErrorResponse.invalidRequest();
  }

  try {
    const vectorizeMutation = await context.env.CATEGORY_POC_INDEX.upsert([
      {
        id: vectorId,
        values: embedding,
        namespace,
      },
    ]);
    return context.json({ category: added.category, vectorizeMutation }, 201);
  } catch (error) {
    console.error("failed to upsert category vector", { categoryId: id, vectorId, error });
    await store.removeCategory({ id });
    return ErrorResponse.internalServerError();
  }
});

categoryPocApp.delete("/categories/:id", async (context) => {
  const id = CategoryPocId.safeParse(context.req.param("id"));
  if (!id.success) {
    return ErrorResponse.invalidRequest();
  }

  const removed = await getStore(context).removeCategory({ id: id.data });
  if (!removed.ok) {
    return removed.error === "not_found"
      ? ErrorResponse.notFound()
      : ErrorResponse.invalidRequest();
  }

  context.executionCtx.waitUntil(
    deleteCategoryVector(context.env.CATEGORY_POC_INDEX, removed.vectorId),
  );
  return new Response(null, { status: 204 });
});

categoryPocApp.post("/classify", async (context) => {
  const parsed = await parseJson(context, ClassifyBody);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const embedding = await embedText(context.env.AI, formatClassificationQuery(parsed.data.name));
  if (!embedding) {
    return ErrorResponse.internalServerError();
  }

  let matches: VectorizeMatches;
  const store = getStore(context);
  const namespace = await store.getVectorNamespace();
  try {
    matches = await context.env.CATEGORY_POC_INDEX.query(embedding, {
      topK: parsed.data.topK,
      namespace,
    });
  } catch (error) {
    console.error("failed to query category vectors", { error });
    return ErrorResponse.internalServerError();
  }

  const resolved = await store.resolveMatches({
    matches: matches.matches.map((match) => ({ vectorId: match.id, score: match.score })),
  });
  if (!resolved.ok) {
    return ErrorResponse.invalidRequest();
  }
  const [topCandidate] = resolved.candidates;
  if (!topCandidate) {
    return ErrorResponse.notFound();
  }

  return context.json({
    category: topCandidate.category,
    score: topCandidate.score,
    candidates: resolved.candidates,
  });
});

function getStore(context: AppContext): DurableObjectStub<CategoryPocStore> {
  return context.env.CATEGORY_POC_STORE.getByName(CATEGORY_POC_STORE_NAME);
}

function formatCategoryDocument(name: string, description: string): string {
  return `title: ${name} | text: ${description || name}`;
}

function formatClassificationQuery(name: string): string {
  return `task: classification | query: ${name}`;
}

async function embedText(ai: Ai, text: string): Promise<number[] | null> {
  try {
    const result = await ai.run(EMBEDDING_MODEL, { text: [text] });
    const vector = result.data[0];
    if (!vector || !vector.every(Number.isFinite)) {
      console.error("invalid category embedding response", { shape: result.shape });
      return null;
    }
    return vector;
  } catch (error) {
    console.error("failed to embed category text", { error });
    return null;
  }
}

async function deleteCategoryVector(index: VectorizeIndex, vectorId: string): Promise<void> {
  try {
    await index.deleteByIds([vectorId]);
  } catch (error) {
    console.error("failed to delete category vector", { vectorId, error });
  }
}
