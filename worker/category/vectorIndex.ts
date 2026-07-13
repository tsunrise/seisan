import {
  CategoryVectorId,
  type CategoriesDocument,
  type Category,
  type CategoryVectorNamespace,
} from "./schema";
import type { Result } from "../result";

const EMBEDDING_MODEL = "@cf/google/embeddinggemma-300m";

export interface CategoryVectorCandidate {
  category: Category;
  score: number;
}

/** Category-specific adapter around Workers AI and the Vectorize index. */
export class CategoryVectorIndex {
  private readonly ai: Ai;
  private readonly index: VectorizeIndex;
  private readonly executionCtx?: Pick<ExecutionContext, "waitUntil">;

  constructor(ai: Ai, index: VectorizeIndex, executionCtx?: Pick<ExecutionContext, "waitUntil">) {
    this.ai = ai;
    this.index = index;
    this.executionCtx = executionCtx;
  }

  async classify(
    document: CategoriesDocument,
    name: string,
    topK: number,
  ): Promise<
    Result<{ candidates: CategoryVectorCandidate[] }, "embedding_failed" | "vectorize_failed">
  > {
    const queryVector = await embedText(this.ai, `task: classification | query: ${name}`);
    if (!queryVector) {
      return { ok: false, error: "embedding_failed" };
    }

    let vectorMatches: VectorizeMatches;
    try {
      vectorMatches = await this.index.query(queryVector, {
        topK,
        namespace: document.vectorNamespace,
      });
    } catch (error) {
      console.error("failed to query category vectors", { error });
      return { ok: false, error: "vectorize_failed" };
    }

    return {
      ok: true,
      candidates: resolveMatches(
        document,
        vectorMatches.matches.map((match) => ({ vectorId: match.id, score: match.score })),
      ),
    };
  }

  /** Embeds each persisted document text and writes it into the active vector namespace. */
  async upsert(
    vectorNamespace: CategoryVectorNamespace,
    categories: readonly Category[],
  ): Promise<
    Result<{ mutation: VectorizeVectorMutation }, "embedding_failed" | "vectorize_failed">
  > {
    if (categories.length === 0) {
      return { ok: true, mutation: { ids: [], count: 0 } };
    }

    const vectors: VectorizeVector[] = [];
    for (const category of categories) {
      const embedding = await embedText(this.ai, category.documentText);
      if (!embedding) {
        return { ok: false, error: "embedding_failed" };
      }
      vectors.push({
        id: category.vectorId,
        values: embedding,
        namespace: vectorNamespace,
      });
    }

    try {
      return {
        ok: true,
        mutation: await this.index.upsert(vectors),
      };
    } catch (error) {
      console.error("failed to upsert category vectors", {
        vectorIds: vectors.map((vector) => vector.id),
        error,
      });
      return { ok: false, error: "vectorize_failed" };
    }
  }

  scheduleDelete(vectorIds: string[]): void {
    if (vectorIds.length === 0) {
      return;
    }

    const deletion = deleteVectorsBestEffort(this.index, vectorIds);
    if (this.executionCtx) {
      this.executionCtx.waitUntil(deletion);
    }
  }
}

/** Resolves only IDs present in the published snapshot, filtering stale index entries. */
function resolveMatches(
  document: CategoriesDocument,
  matches: Array<{ vectorId: string; score: number }>,
): CategoryVectorCandidate[] {
  const byVectorId = new Map(document.categories.map((category) => [category.vectorId, category]));
  const candidates: CategoryVectorCandidate[] = [];
  for (const match of matches) {
    const parsedVectorId = CategoryVectorId.safeParse(match.vectorId);
    if (!parsedVectorId.success || !Number.isFinite(match.score)) {
      continue;
    }
    const category = byVectorId.get(parsedVectorId.data);
    if (category) {
      candidates.push({ category, score: match.score });
    }
  }
  return candidates;
}

/** Workers AI returns a batch even for one input; null represents inference or shape failure. */
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

async function deleteVectorsBestEffort(index: VectorizeIndex, vectorIds: string[]): Promise<void> {
  try {
    await index.deleteByIds(vectorIds);
  } catch (error) {
    console.error("failed to delete category vectors", { vectorIds, error });
  }
}
