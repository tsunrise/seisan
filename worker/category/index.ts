import type { GlobalConfig } from "../do/GlobalConfig";
import { GLOBAL_CONFIG_STORE_NAME, PublishedGlobalConfigKvStore } from "../globalConfig";
import type { ErrorResultOf, Result } from "../result";
import { CATEGORY_CONFIG_KEY } from "./document";
import {
  CategoriesDocument,
  CategoryClassificationName,
  CategoryClassificationTopK,
  CategoryId,
  type CategoryIconName,
  type CategoriesDocument as CategoriesDocumentValue,
  type Category as CategoryValue,
} from "./schema";
import { CategoryVectorIndex, type CategoryVectorCandidate } from "./vectorIndex";

export { CATEGORY_CONFIG_KEY } from "./document";
export {
  CategoriesDocument,
  Category,
  CategoryClassificationName,
  CategoryClassificationTopK,
  CategoryDescription,
  CategoryIconName,
  CategoryId,
  CategoryName,
} from "./schema";

export type CategoryCandidate = CategoryVectorCandidate;

// TODO(schema-source): replace these category operation interfaces with canonical zod schemas used
// by routes, OpenAPI, frontend API types, and the Node client.
export interface CategoryClassification {
  category: CategoryValue;
  score: number;
  candidates: CategoryCandidate[];
}

export interface CategoryWriteInput {
  id?: string;
  name: string;
  description?: string;
  icon?: CategoryIconName;
}

export class CategoryClassifier {
  private readonly env: Env;
  private readonly vectorIndex: CategoryVectorIndex;

  constructor(env: Env, executionCtx?: Pick<ExecutionContext, "waitUntil">) {
    this.env = env;
    this.vectorIndex = new CategoryVectorIndex(env.AI, env.CATEGORY_INDEX, executionCtx);
  }

  /** Reads the strongly consistent document used by administrative workflows. */
  async getCategoriesForUpdate(): Promise<
    Result<{ document: CategoriesDocumentValue }, "config_read_failed">
  > {
    const loaded = await this.globalConfig().listCategories();
    if (!loaded.ok) {
      return { ok: false, error: "config_read_failed" };
    }
    return {
      ok: true,
      document: loaded.document,
    };
  }

  /** Replaces stored config before synchronously rebuilding its active vectors. */
  async setCategories(input: {
    document: CategoriesDocumentValue;
  }): Promise<
    Result<
      { document: CategoriesDocumentValue; vectorizeMutation: VectorizeVectorMutation },
      "invalid_request" | "embedding_failed" | "vectorize_failed" | "config_read_failed"
    >
  > {
    const parsed = CategoriesDocument.safeParse(input.document);
    if (!parsed.success) {
      return { ok: false, error: "invalid_request" };
    }

    const saved = await this.globalConfig().setCategories(parsed.data);
    if (!saved.ok) {
      return mapGlobalConfigSetError(saved);
    }

    const vectorResult = await this.vectorIndex.upsert(
      saved.document.vectorNamespace,
      saved.document.categories,
    );
    if (!vectorResult.ok) {
      return vectorResult;
    }

    this.vectorIndex.scheduleDelete(saved.removedVectorIds);
    return {
      ok: true,
      document: saved.document,
      vectorizeMutation: vectorResult.mutation,
    };
  }

  /** Persists the category first, then embeds and upserts its stable vector ID. */
  async upsertCategory(
    input: CategoryWriteInput,
  ): Promise<
    Result<
      { category: CategoryValue; vectorizeMutation: VectorizeVectorMutation },
      | "invalid_request"
      | "not_found"
      | "category_exists"
      | "embedding_failed"
      | "vectorize_failed"
      | "config_read_failed"
    >
  > {
    const saved = await this.globalConfig().upsertCategory({
      ...input,
      nowMs: Date.now(),
    });
    if (!saved.ok) {
      return mapGlobalConfigUpsertError(saved);
    }

    const vectorResult = await this.vectorIndex.upsert(saved.document.vectorNamespace, [
      saved.category,
    ]);
    if (!vectorResult.ok) {
      return vectorResult;
    }

    return {
      ok: true,
      category: saved.category,
      vectorizeMutation: vectorResult.mutation,
    };
  }

  /** Awaits Vectorize deletion acceptance before removing the category from config. */
  async deleteCategory(
    id: string,
  ): Promise<
    Result<void, "invalid_request" | "not_found" | "vectorize_failed" | "config_read_failed">
  > {
    const parsedId = CategoryId.safeParse(id);
    if (!parsedId.success) {
      return { ok: false, error: "invalid_request" };
    }

    const loaded = await this.globalConfig().listCategories();
    if (!loaded.ok) {
      return { ok: false, error: "config_read_failed" };
    }
    const category = loaded.document.categories.find((candidate) => candidate.id === parsedId.data);
    if (!category) {
      return { ok: false, error: "not_found" };
    }

    const vectorResult = await this.vectorIndex.delete([category.vectorId]);
    if (!vectorResult.ok) {
      return vectorResult;
    }

    const deleted = await this.globalConfig().deleteCategory(parsedId.data);
    if (!deleted.ok) {
      return mapGlobalConfigDeleteError(deleted);
    }

    return { ok: true };
  }

  /** Classifies against the published KV snapshot and ignores stale Vectorize IDs. */
  async classify(
    name: string,
    options: { topK: number },
  ): Promise<
    Result<
      CategoryClassification,
      | "invalid_request"
      | "not_found"
      | "config_read_failed"
      | "embedding_failed"
      | "vectorize_failed"
    >
  > {
    const parsedName = CategoryClassificationName.safeParse(name);
    const parsedTopK = CategoryClassificationTopK.safeParse(options.topK);
    if (!parsedName.success || !parsedTopK.success) {
      return { ok: false, error: "invalid_request" };
    }

    const published = await new PublishedGlobalConfigKvStore(
      this.env.PUBLISHED_GLOBAL_CONFIG,
    ).getValue(CATEGORY_CONFIG_KEY);
    if (!published.ok) {
      return { ok: false, error: "config_read_failed" };
    }
    if (published.value.categories.length === 0) {
      return { ok: false, error: "not_found" };
    }

    const classified = await this.vectorIndex.classify(
      published.value,
      parsedName.data,
      parsedTopK.data,
    );
    if (!classified.ok) {
      return mapVectorClassifyError(classified);
    }

    const [topCandidate] = classified.candidates;
    if (!topCandidate) {
      return { ok: false, error: "not_found" };
    }

    return {
      ok: true,
      category: topCandidate.category,
      score: topCandidate.score,
      candidates: classified.candidates,
    };
  }

  private globalConfig(): DurableObjectStub<GlobalConfig> {
    return this.env.GLOBAL_CONFIG.getByName(GLOBAL_CONFIG_STORE_NAME);
  }
}

function mapVectorClassifyError(result: ErrorResultOf<CategoryVectorIndex["classify"]>) {
  return { ok: false, error: result.error } as const;
}

function mapGlobalConfigSetError(result: ErrorResultOf<GlobalConfig["setCategories"]>) {
  switch (result.error) {
    case "invalid_input":
      return { ok: false, error: "invalid_request" } as const;
    case "invalid_value":
      return { ok: false, error: "config_read_failed" } as const;
  }
}

function mapGlobalConfigUpsertError(result: ErrorResultOf<GlobalConfig["upsertCategory"]>) {
  switch (result.error) {
    case "invalid_input":
      return { ok: false, error: "invalid_request" } as const;
    case "not_found":
      return { ok: false, error: "not_found" } as const;
    case "category_exists":
      return { ok: false, error: "category_exists" } as const;
    case "invalid_value":
      return { ok: false, error: "config_read_failed" } as const;
  }
}

function mapGlobalConfigDeleteError(result: ErrorResultOf<GlobalConfig["deleteCategory"]>) {
  switch (result.error) {
    case "invalid_input":
      return { ok: false, error: "invalid_request" } as const;
    case "not_found":
      return { ok: false, error: "not_found" } as const;
    case "invalid_value":
      return { ok: false, error: "config_read_failed" } as const;
  }
}
