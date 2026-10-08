import type { IconName } from "../../shared/icon-names";

export const OTHERS_CATEGORY_ID = "__others__";
export const CATEGORY_SCORE_THRESHOLD = 0.2;

export interface CategoryOption {
  id: string;
  name: string;
  icon?: IconName;
}

export interface CategoryCandidateOption {
  category: CategoryOption;
  score: number;
}

export interface CategoryClassificationOption {
  category: CategoryOption;
  score: number;
  /** Probability that the classifier found no configured category that fits. */
  othersScore: number;
}

export interface CategorySelection {
  source: "automatic" | "manual";
  categoryId: string;
}

export const OTHERS_CATEGORY: CategoryOption = {
  id: OTHERS_CATEGORY_ID,
  name: "Others",
  icon: "expense",
};

export function automaticCategoryId(classification: CategoryClassificationOption): string {
  return classification.score >= CATEGORY_SCORE_THRESHOLD &&
    classification.score >= classification.othersScore
    ? classification.category.id
    : OTHERS_CATEGORY_ID;
}

export function selectionAfterClassification(
  selection: CategorySelection,
  classification: CategoryClassificationOption,
): CategorySelection {
  return selection.source === "manual"
    ? selection
    : { source: "automatic", categoryId: automaticCategoryId(classification) };
}

export function selectionAfterClassificationFailure(
  selection: CategorySelection,
): CategorySelection {
  return selection.source === "manual"
    ? selection
    : { source: "automatic", categoryId: OTHERS_CATEGORY_ID };
}

export function orderedCategoryOptions(
  categories: CategoryOption[],
  candidates: CategoryCandidateOption[],
): { suggested: CategoryOption[]; remaining: CategoryOption[] } {
  const suggested: CategoryOption[] = [];
  const seen = new Set<string>();
  const uniqueCandidates: CategoryCandidateOption[] = [];

  for (const candidate of candidates) {
    if (!seen.has(candidate.category.id)) {
      seen.add(candidate.category.id);
      uniqueCandidates.push(candidate);
    }
  }

  for (const [index, candidate] of uniqueCandidates.entries()) {
    if (index < 3 || candidate.score > CATEGORY_SCORE_THRESHOLD) {
      suggested.push(candidate.category);
    }
  }

  const remaining = [...categories, OTHERS_CATEGORY]
    .filter((category) => !suggested.some((suggestion) => suggestion.id === category.id))
    .sort(compareCategoryNames);

  return { suggested, remaining };
}

export function prefixMatchingCategories(
  categories: CategoryOption[],
  input: string,
): CategoryOption[] {
  const prefix = input.trim().toLocaleLowerCase();
  return prefix
    ? categories.filter((category) => category.name.toLocaleLowerCase().startsWith(prefix))
    : categories;
}

export function resolveRecordCategory(
  categories: CategoryOption[],
  categoryId: string | undefined,
): CategoryOption {
  if (!categoryId) {
    return OTHERS_CATEGORY;
  }
  const category = categories.find((item) => item?.id === categoryId);
  return category && typeof category.name === "string" && category.name.trim()
    ? category
    : OTHERS_CATEGORY;
}

export function categoryIdForRecord(categoryId: string): string | undefined {
  return categoryId === OTHERS_CATEGORY_ID ? undefined : categoryId;
}

export function isCurrentClassification(
  requestToken: number,
  input: string,
  currentToken: number,
  currentInput: string,
): boolean {
  return requestToken === currentToken && input === currentInput;
}

function compareCategoryNames(left: CategoryOption, right: CategoryOption): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}
