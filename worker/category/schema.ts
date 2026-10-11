import { z } from "zod";

import { ICON_NAME_VALUES } from "../../shared/icon-names";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CATEGORY_NAME_MAX_LENGTH = 120;
const CATEGORY_DESCRIPTION_MAX_LENGTH = 1_000;
const CATEGORY_CLASSIFICATION_NAME_MAX_LENGTH = 200;
const CATEGORY_CLASSIFICATION_TOP_K_MAX = 20;
/** clef-flash accepts at most 255 choice options, and one is reserved for "Others". */
export const CATEGORY_MAX_COUNT = 254;

/** Display name of the built-in fallback; also the classifier's "none of these" option. */
export const OTHERS_CATEGORY_NAME = "Others";

export const CategoryId = z
  .string()
  .regex(UUID_PATTERN)
  .overwrite((id) => id.toLowerCase());
export type CategoryId = z.infer<typeof CategoryId>;

export const CategoryName = z
  .string()
  .transform(normalizeCategoryText)
  .pipe(
    z
      .string()
      .min(1)
      .max(CATEGORY_NAME_MAX_LENGTH)
      .refine((name) => name.toLowerCase() !== OTHERS_CATEGORY_NAME.toLowerCase(), {
        message: "Others is the reserved fallback category.",
      }),
  );
export type CategoryName = z.infer<typeof CategoryName>;

export const CategoryDescription = z
  .string()
  .transform(normalizeCategoryText)
  .pipe(z.string().max(CATEGORY_DESCRIPTION_MAX_LENGTH));
export type CategoryDescription = z.infer<typeof CategoryDescription>;

export const CategoryIconName = z.enum(ICON_NAME_VALUES);
export type CategoryIconName = z.infer<typeof CategoryIconName>;

export const CategoryClassificationName = z
  .string()
  .transform(normalizeCategoryText)
  .pipe(z.string().min(1).max(CATEGORY_CLASSIFICATION_NAME_MAX_LENGTH));
export type CategoryClassificationName = z.infer<typeof CategoryClassificationName>;

export const CategoryClassificationTopK = z
  .number()
  .int()
  .min(1)
  .max(CATEGORY_CLASSIFICATION_TOP_K_MAX);
export type CategoryClassificationTopK = z.infer<typeof CategoryClassificationTopK>;

const NonNegativeSafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Persisted category record, including its derived lookup field. */
export const Category = z
  .object({
    id: CategoryId,
    name: CategoryName,
    normalizedName: z.string().min(1).max(CATEGORY_NAME_MAX_LENGTH),
    description: CategoryDescription,
    icon: CategoryIconName.optional(),
    createdAt: NonNegativeSafeInteger,
    updatedAt: NonNegativeSafeInteger,
  })
  .strict();
export type Category = z.infer<typeof Category>;

/** Complete versioned category snapshot published as one value under the `categories` key. */
export const CategoriesDocument = z
  .object({
    version: z.literal(2),
    categories: z.array(Category).max(CATEGORY_MAX_COUNT),
  })
  .strict()
  .superRefine((document, context) => {
    validateUniqueCategoryField(
      document.categories.map((category) => category.id),
      context,
      "Duplicate category ID.",
    );
    validateUniqueCategoryField(
      document.categories.map((category) => category.normalizedName),
      context,
      "Duplicate normalized category name.",
    );
  });
export type CategoriesDocument = z.infer<typeof CategoriesDocument>;

function normalizeCategoryText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function validateUniqueCategoryField(
  values: string[],
  context: z.RefinementCtx,
  message: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      context.addIssue({ code: "custom", message });
      return;
    }
    seen.add(value);
  }
}
