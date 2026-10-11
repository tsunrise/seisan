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

/** Normalizes expense text the same way the classification API does before classifying it. */
export function classificationKey(input: string): string {
  return input.trim().replace(/\s+/gu, " ");
}

/**
 * Milliseconds until an automatic classification may start: the input must have been quiet for
 * `debounceMs`, and at least `minIntervalMs` must have passed since the previous request started.
 */
export function automaticClassificationDelayMs(timing: {
  now: number;
  lastInputAt: number;
  lastRequestAt: number | null;
  debounceMs: number;
  minIntervalMs: number;
}): number {
  const quietAt = timing.lastInputAt + timing.debounceMs;
  const allowedAt =
    timing.lastRequestAt === null ? timing.now : timing.lastRequestAt + timing.minIntervalMs;
  return Math.max(0, quietAt - timing.now, allowedAt - timing.now);
}

/** Bounded, expiring least-recently-used map from classification keys to results. */
export class ClassificationCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { maxEntries: number; ttlMs: number; now?: () => number }) {
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) {
      return undefined;
    }
    // Re-inserting keeps Map iteration order equal to recency order.
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    for (const oldestKey of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}

function compareCategoryNames(left: CategoryOption, right: CategoryOption): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}
