import { z } from "zod";

import { OTHERS_CATEGORY_NAME, type Category } from "./schema";
import type { Result } from "../result";

export const CATEGORY_CLASSIFIER_MODEL = "@cf/cloudflare/clef-flash";

const CATEGORY_QUESTION_ID = "category";
const CATEGORY_QUESTION_INSTRUCTIONS =
  "Which spending category best fits this expense from a shared group ledger? The state is the short name someone typed when posting the expense.";
const OTHERS_OPTION_DESCRIPTION =
  "The expense does not clearly belong to any other listed category.";

export interface ClefCategoryCandidate {
  category: Category;
  score: number;
}

/** The subset of a clef-flash response that category classification reads. */
const ClefCategoryResponse = z.object({
  answers: z.object({
    [CATEGORY_QUESTION_ID]: z.object({
      type: z.literal("choice"),
      probabilities: z.record(z.string(), z.number().min(0).max(1)),
    }),
  }),
});

/** Category-specific adapter around the clef-flash decision model on Workers AI. */
export class ClefCategoryClassifier {
  private readonly ai: Ai;

  constructor(ai: Ai) {
    this.ai = ai;
  }

  /**
   * Builds the exact model request. Category names are the option IDs, and "Others" competes as an
   * explicit option so the model can say that nothing fits.
   */
  private static request(
    categories: readonly Pick<Category, "name" | "description">[],
    name: string,
  ): Record<string, unknown> {
    const criteria: Record<string, string | null> = {};
    for (const category of categories) {
      criteria[category.name] = category.description || null;
    }
    criteria[OTHERS_CATEGORY_NAME] = OTHERS_OPTION_DESCRIPTION;

    return {
      model: "clef-flash",
      state: name,
      questions: {
        [CATEGORY_QUESTION_ID]: {
          type: "choice",
          instructions: CATEGORY_QUESTION_INSTRUCTIONS,
          criteria,
        },
      },
    };
  }

  /** Returns categories ranked by probability plus the probability that none of them fits. */
  private static rank(
    categories: readonly Category[],
    response: unknown,
  ): { candidates: ClefCategoryCandidate[]; othersScore: number } | null {
    const parsed = ClefCategoryResponse.safeParse(response);
    if (!parsed.success) {
      return null;
    }

    const { probabilities } = parsed.data.answers[CATEGORY_QUESTION_ID];
    return {
      candidates: categories
        .map((category) => ({ category, score: probabilities[category.name] ?? 0 }))
        .sort((left, right) => right.score - left.score),
      othersScore: probabilities[OTHERS_CATEGORY_NAME] ?? 0,
    };
  }

  async classify(
    categories: readonly Category[],
    name: string,
    topK: number,
  ): Promise<
    Result<{ candidates: ClefCategoryCandidate[]; othersScore: number }, "classification_failed">
  > {
    let response: unknown;
    try {
      response = await this.ai.run(
        CATEGORY_CLASSIFIER_MODEL,
        ClefCategoryClassifier.request(categories, name),
      );
    } catch (error) {
      console.error("failed to classify category", { error });
      return { ok: false, error: "classification_failed" };
    }

    const ranked = ClefCategoryClassifier.rank(categories, response);
    if (!ranked) {
      console.error("invalid category classification response");
      return { ok: false, error: "classification_failed" };
    }

    return {
      ok: true,
      candidates: ranked.candidates.slice(0, topK),
      othersScore: ranked.othersScore,
    };
  }
}
