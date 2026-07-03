import { z } from "zod";

export const CATEGORY_POC_STORE_NAME = "category-poc-store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CATEGORY_NAMESPACE_PATTERN =
  /^category-poc-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CATEGORY_VECTOR_ID_PATTERN =
  /^category:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CATEGORY_NAME_MAX_LENGTH = 120;
const CATEGORY_DESCRIPTION_MAX_LENGTH = 1_000;
const CATEGORY_DOCUMENT_TEXT_MAX_LENGTH =
  "title: ".length +
  CATEGORY_NAME_MAX_LENGTH +
  " | text: ".length +
  CATEGORY_DESCRIPTION_MAX_LENGTH;

export const CategoryPocId = z
  .string()
  .regex(UUID_PATTERN)
  .transform((id) => id.toLowerCase());
export type CategoryPocId = z.infer<typeof CategoryPocId>;

export const CategoryPocName = z
  .string()
  .transform(normalizeCategoryPocText)
  .pipe(z.string().min(1).max(CATEGORY_NAME_MAX_LENGTH));
export type CategoryPocName = z.infer<typeof CategoryPocName>;

export const CategoryPocDescription = z
  .string()
  .transform(normalizeCategoryPocText)
  .pipe(z.string().max(CATEGORY_DESCRIPTION_MAX_LENGTH));
export type CategoryPocDescription = z.infer<typeof CategoryPocDescription>;

export const CategoryPocDocumentText = z
  .string()
  .transform(normalizeCategoryPocText)
  .pipe(z.string().min(1).max(CATEGORY_DOCUMENT_TEXT_MAX_LENGTH));
export type CategoryPocDocumentText = z.infer<typeof CategoryPocDocumentText>;

export const CategoryPocVectorId = z
  .string()
  .regex(CATEGORY_VECTOR_ID_PATTERN)
  .transform((id) => id.toLowerCase());
export type CategoryPocVectorId = z.infer<typeof CategoryPocVectorId>;

export const CategoryPocVectorNamespace = z
  .string()
  .regex(CATEGORY_NAMESPACE_PATTERN)
  .transform((namespace) => namespace.toLowerCase());
export type CategoryPocVectorNamespace = z.infer<typeof CategoryPocVectorNamespace>;

export interface CategoryPocCategory {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  documentText: string;
  vectorId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CategoryPocCandidate {
  category: CategoryPocCategory;
  score: number;
}

export function categoryPocVectorIdForCategory(id: string): string {
  return `category:${id.toLowerCase()}`;
}

export function createCategoryPocVectorNamespace(): string {
  return `category-poc-${crypto.randomUUID()}`;
}

export function normalizeCategoryPocName(name: string): string {
  return normalizeCategoryPocText(name).toLowerCase();
}

export function normalizeCategoryPocText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}
