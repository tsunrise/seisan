import type { GlobalConfig } from "../do/GlobalConfig";
import { GLOBAL_CONFIG_STORE_NAME, PublishedGlobalConfigKvStore } from "../globalConfig";
import type { ErrorResultOf, Result } from "../result";
import { ClefCategoryClassifier, type ClefCategoryCandidate } from "./clef";
import { CATEGORY_CONFIG_KEY } from "./document";
import {
  CategoryClassificationName,
  CategoryClassificationTopK,
  CategoryId,
  type CategoryIconName,
  type CategoriesDocument as CategoriesDocumentValue,
  type Category as CategoryValue,
} from "./schema";

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

export type CategoryCandidate = ClefCategoryCandidate;

// TODO(schema-source): replace these category operation interfaces with canonical zod schemas used
// by routes, OpenAPI, frontend API types, and the Node client.
export interface CategoryClassification {
  category: CategoryValue;
  score: number;
  othersScore: number;
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
  private readonly model: ClefCategoryClassifier;

  constructor(env: Env) {
    this.env = env;
    this.model = new ClefCategoryClassifier(env.AI);
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

  async upsertCategory(
    input: CategoryWriteInput,
  ): Promise<
    Result<
      { category: CategoryValue },
      "invalid_request" | "not_found" | "category_exists" | "config_read_failed"
    >
  > {
    const saved = await this.globalConfig().upsertCategory({
      ...input,
      nowMs: Date.now(),
    });
    if (!saved.ok) {
      return mapGlobalConfigUpsertError(saved);
    }
    return { ok: true, category: saved.category };
  }

  async deleteCategory(
    id: string,
  ): Promise<Result<void, "invalid_request" | "not_found" | "config_read_failed">> {
    const parsedId = CategoryId.safeParse(id);
    if (!parsedId.success) {
      return { ok: false, error: "invalid_request" };
    }

    const deleted = await this.globalConfig().deleteCategory(parsedId.data);
    if (!deleted.ok) {
      return mapGlobalConfigDeleteError(deleted);
    }
    return { ok: true };
  }

  /** Classifies against the published KV snapshot, so new categories apply once published. */
  async classify(
    name: string,
    options: { topK: number },
  ): Promise<
    Result<
      CategoryClassification,
      "invalid_request" | "not_found" | "config_read_failed" | "classification_failed"
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

    const classified = await this.model.classify(
      published.value.categories,
      parsedName.data,
      parsedTopK.data,
    );
    if (!classified.ok) {
      return classified;
    }

    const [topCandidate] = classified.candidates;
    if (!topCandidate) {
      return { ok: false, error: "not_found" };
    }

    return {
      ok: true,
      category: topCandidate.category,
      score: topCandidate.score,
      othersScore: classified.othersScore,
      candidates: classified.candidates,
    };
  }

  private globalConfig(): DurableObjectStub<GlobalConfig> {
    return this.env.GLOBAL_CONFIG.getByName(GLOBAL_CONFIG_STORE_NAME);
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
