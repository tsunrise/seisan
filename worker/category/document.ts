import {
  CATEGORY_MAX_COUNT,
  CategoriesDocument,
  Category,
  CategoryDescription,
  CategoryIconName,
  CategoryId,
  CategoryName,
  type CategoriesDocument as CategoriesDocumentValue,
  type Category as CategoryValue,
} from "./schema";
import type { Result } from "../result";

export const CATEGORY_CONFIG_KEY = "categories";

export interface CategoryDocumentWriteInput {
  id?: string;
  name: string;
  description?: string;
  icon?: CategoryIconName;
  nowMs: number;
}

/** A stored category entry dropped by `repairCategoriesDocument`, identified as far as possible. */
export interface RemovedCategory {
  id: string | null;
  name: string | null;
}

/** Storage codec that validates documents and gives category arrays canonical ordering. */
export class CategoriesDocumentCodec {
  static parseStored(value: string): CategoriesDocumentValue | null {
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      return null;
    }

    const parsed = CategoriesDocument.safeParse(decoded);
    return parsed.success ? withSortedCategories(parsed.data) : null;
  }

  static serialize(document: CategoriesDocumentValue): string {
    return JSON.stringify(withSortedCategories(CategoriesDocument.parse(document)));
  }
}

export function createEmptyCategoriesDocument(): CategoriesDocumentValue {
  return { version: 2, categories: [] };
}

export function normalizeCategoriesDocument(
  document: CategoriesDocumentValue,
): CategoriesDocumentValue | null {
  const parsed = CategoriesDocument.safeParse(document);
  return parsed.success ? withSortedCategories(parsed.data) : null;
}

/**
 * Rebuilds a stored document of any shape as the current version. Each category keeps only the
 * fields the current schema defines, an unknown icon is dropped, and categories that still fail
 * validation or duplicate an earlier ID or normalized name are removed. Unparseable JSON becomes an
 * empty document.
 */
export function repairCategoriesDocument(value: string): {
  document: CategoriesDocumentValue;
  removed: RemovedCategory[];
} {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    decoded = null;
  }

  const entries: unknown[] =
    isRecord(decoded) && Array.isArray(decoded.categories) ? decoded.categories : [];
  const categories: CategoryValue[] = [];
  const removed: RemovedCategory[] = [];
  const seenIds = new Set<string>();
  const seenNormalizedNames = new Set<string>();
  for (const entry of entries) {
    const category = salvageCategory(entry);
    if (
      !category ||
      seenIds.has(category.id) ||
      seenNormalizedNames.has(category.normalizedName) ||
      categories.length >= CATEGORY_MAX_COUNT
    ) {
      removed.push(describeRemovedCategory(entry));
      continue;
    }
    seenIds.add(category.id);
    seenNormalizedNames.add(category.normalizedName);
    categories.push(category);
  }

  return { document: withSortedCategories({ version: 2, categories }), removed };
}

/** Creates or updates a category while preserving identity fields across updates. */
export function upsertCategoryInDocument(
  document: CategoriesDocumentValue,
  input: CategoryDocumentWriteInput,
): Result<
  { document: CategoriesDocumentValue; category: CategoryValue },
  "invalid_input" | "not_found" | "category_exists"
> {
  const id = input.id ?? crypto.randomUUID();
  const existing = categoryById(document, id);
  if (input.id && !existing) {
    return { ok: false, error: "not_found" };
  }

  let category: CategoryValue;
  try {
    category = buildCategory({
      id,
      name: input.name,
      description: input.description ?? "",
      icon: input.icon ?? existing?.icon ?? "expense",
      nowMs: input.nowMs,
      createdAt: existing?.createdAt,
    });
  } catch {
    return { ok: false, error: "invalid_input" };
  }

  if (hasCategoryWithNormalizedName(document, category.normalizedName, category.id)) {
    return { ok: false, error: "category_exists" };
  }

  return {
    ok: true,
    category,
    document: withSortedCategories({
      ...document,
      categories: existing
        ? document.categories.map((item) => (item.id === category.id ? category : item))
        : [...document.categories, category],
    }),
  };
}

export function deleteCategoryFromDocument(
  document: CategoriesDocumentValue,
  id: string,
): Result<{ document: CategoriesDocumentValue }, "invalid_input" | "not_found"> {
  const parsedId = CategoryId.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, error: "invalid_input" };
  }

  const category = categoryById(document, parsedId.data);
  if (!category) {
    return { ok: false, error: "not_found" };
  }

  return {
    ok: true,
    document: withSortedCategories({
      ...document,
      categories: document.categories.filter((item) => item.id !== parsedId.data),
    }),
  };
}

function buildCategory(input: {
  id: string;
  name: string;
  description: string;
  icon: CategoryIconName;
  nowMs: number;
  createdAt?: number;
}): CategoryValue {
  const name = CategoryName.parse(input.name);
  const description = CategoryDescription.parse(input.description);
  const icon = CategoryIconName.parse(input.icon);
  const id = CategoryId.parse(input.id);
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    description,
    icon,
    createdAt: input.createdAt ?? input.nowMs,
    updatedAt: input.nowMs,
  };
}

function salvageCategory(entry: unknown): CategoryValue | null {
  if (!isRecord(entry)) {
    return null;
  }
  const icon = CategoryIconName.safeParse(entry.icon);
  const parsed = Category.safeParse({
    id: entry.id,
    name: entry.name,
    normalizedName: entry.normalizedName,
    description: entry.description,
    ...(icon.success ? { icon: icon.data } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  });
  return parsed.success ? parsed.data : null;
}

function describeRemovedCategory(entry: unknown): RemovedCategory {
  return {
    id: isRecord(entry) && typeof entry.id === "string" ? entry.id : null,
    name: isRecord(entry) && typeof entry.name === "string" ? entry.name : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function categoryById(document: CategoriesDocumentValue, id: string): CategoryValue | null {
  const parsedId = CategoryId.safeParse(id);
  if (!parsedId.success) {
    return null;
  }
  return document.categories.find((category) => category.id === parsedId.data) ?? null;
}

function hasCategoryWithNormalizedName(
  document: CategoriesDocumentValue,
  normalizedName: string,
  exceptId?: string,
): boolean {
  return document.categories.some(
    (category) => category.normalizedName === normalizedName && category.id !== exceptId,
  );
}

function withSortedCategories(document: CategoriesDocumentValue): CategoriesDocumentValue {
  return {
    ...document,
    categories: [...document.categories].sort((left, right) =>
      left.normalizedName.localeCompare(right.normalizedName),
    ),
  };
}
