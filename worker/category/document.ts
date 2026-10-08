import {
  CategoriesDocument,
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
