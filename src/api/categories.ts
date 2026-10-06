import { requestJson } from "./client";
import type { Category, CategoryClassification } from "./types";

export async function listCategories(): Promise<Category[]> {
  const response = await requestJson<{ categories: Category[] }>("/api/categories");
  return response.categories;
}

export async function classifyCategory(
  input: {
    name: string;
    topK?: number;
  },
  options: { signal?: AbortSignal } = {},
): Promise<CategoryClassification> {
  return requestJson("/api/categories/classify", {
    method: "POST",
    body: input,
    signal: options.signal,
  });
}
