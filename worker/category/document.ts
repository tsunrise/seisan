import {
  CategoriesDocument,
  CategoryDescription,
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
  return {
    version: 1,
    vectorNamespace: `categories-${crypto.randomUUID()}`,
    categories: [],
  };
}

export function normalizeCategoriesDocument(
  document: CategoriesDocumentValue,
): CategoriesDocumentValue | null {
  const parsed = CategoriesDocument.safeParse(document);
  return parsed.success ? withSortedCategories(parsed.data) : null;
}

/** Validates a full replacement and identifies vectors no longer referenced by it. */
export function setCategoriesDocument(
  currentDocument: CategoriesDocumentValue,
  nextDocument: CategoriesDocumentValue,
): Result<{ document: CategoriesDocumentValue; removedVectorIds: string[] }, "invalid_input"> {
  const document = normalizeCategoriesDocument(nextDocument);
  if (!document) {
    return { ok: false, error: "invalid_input" };
  }

  return {
    ok: true,
    document,
    removedVectorIds: removedVectorIds(currentDocument, document),
  };
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
      nowMs: input.nowMs,
      createdAt: existing?.createdAt,
      vectorId: existing?.vectorId,
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

/** Removes a category and returns its stable vector ID for best-effort cleanup. */
export function deleteCategoryFromDocument(
  document: CategoriesDocumentValue,
  id: string,
): Result<{ document: CategoriesDocumentValue; vectorId: string }, "invalid_input" | "not_found"> {
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
    vectorId: category.vectorId,
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
  nowMs: number;
  createdAt?: number;
  vectorId?: string;
}): CategoryValue {
  const name = CategoryName.parse(input.name);
  const description = CategoryDescription.parse(input.description);
  const id = CategoryId.parse(input.id);
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    description,
    documentText: `title: ${name} | text: ${description || name}`,
    vectorId: input.vectorId ?? `category:${id}`,
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

function removedVectorIds(
  previous: CategoriesDocumentValue,
  next: CategoriesDocumentValue,
): string[] {
  const nextVectorIds = new Set(next.categories.map((category) => category.vectorId));
  return previous.categories
    .map((category) => category.vectorId)
    .filter((vectorId) => !nextVectorIds.has(vectorId));
}

function withSortedCategories(document: CategoriesDocumentValue): CategoriesDocumentValue {
  return {
    ...document,
    categories: [...document.categories].sort((left, right) =>
      left.normalizedName.localeCompare(right.normalizedName),
    ),
  };
}
