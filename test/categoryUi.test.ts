import { describe, expect, it } from "vitest";

import {
  type CategoryCandidateOption,
  type CategoryOption,
  automaticCategoryId,
  isCurrentClassification,
  orderedCategoryOptions,
  OTHERS_CATEGORY_ID,
  prefixMatchingCategories,
  resolveRecordCategory,
  selectionAfterClassification,
  selectionAfterClassificationFailure,
} from "../src/domain/categories";
import { ICON_NAME_VALUES, isIconName } from "../shared/icon-names";

describe("category UI helpers", () => {
  it("puts every unique candidate above 0.2 first and sorts the remainder with Others", () => {
    const restaurant = category("restaurant", "Restaurant", "restaurant");
    const grocery = category("grocery", "Grocery", "grocery");
    const travel = category("travel", "Travel", "travel");
    const education = category("education", "Education", "education");
    const medical = category("medical", "Medical", "medical");
    const shopping = category("shopping", "Shopping", "shopping");
    const result = orderedCategoryOptions(
      [travel, education, grocery, restaurant, medical, shopping],
      [
        candidate(travel, 0.9),
        candidate(restaurant, 0.8),
        candidate(travel, 0.7),
        candidate(grocery, 0.6),
        candidate(medical, 0.3),
        candidate(shopping, 0.2),
      ],
    );

    expect(result.suggested.map((item) => item.name)).toEqual([
      "Travel",
      "Restaurant",
      "Grocery",
      "Medical",
    ]);
    expect(result.remaining.map((item) => item.name)).toEqual(["Education", "Others", "Shopping"]);
  });

  it("sorts the full list with Others when there are no suggestions", () => {
    const result = orderedCategoryOptions(
      [category("travel", "Travel", "travel"), category("grocery", "Grocery", "grocery")],
      [],
    );

    expect(result.suggested).toEqual([]);
    expect(result.remaining.map((item) => item.name)).toEqual(["Grocery", "Others", "Travel"]);
  });

  it("fills the suggestion list to three when fewer than three candidates score above 0.2", () => {
    const travel = category("travel", "Travel", "travel");
    const grocery = category("grocery", "Grocery", "grocery");
    const restaurant = category("restaurant", "Restaurant", "restaurant");
    const education = category("education", "Education", "education");
    const result = orderedCategoryOptions(
      [education, grocery, restaurant, travel],
      [candidate(travel, 0.8), candidate(grocery, 0.2), candidate(restaurant, 0.1)],
    );

    expect(result.suggested.map((item) => item.name)).toEqual(["Travel", "Grocery", "Restaurant"]);
    expect(result.remaining.map((item) => item.name)).toEqual(["Education", "Others"]);
  });

  it("filters category inputs by a case-insensitive name prefix", () => {
    const categories = [
      category("dining", "Dining Out", "restaurant"),
      category("groceries", "Groceries", "grocery"),
      category("drinks", "Drinks", "restaurant"),
    ];

    expect(prefixMatchingCategories(categories, "  di").map((item) => item.name)).toEqual([
      "Dining Out",
    ]);
    expect(prefixMatchingCategories(categories, "DR").map((item) => item.name)).toEqual(["Drinks"]);
    expect(prefixMatchingCategories(categories, " ")).toEqual(categories);
  });

  it("uses the inclusive score threshold for automatic decisions", () => {
    const restaurant = category("restaurant", "Restaurant", "restaurant");
    expect(automaticCategoryId({ category: restaurant, score: 0.199 })).toBe(OTHERS_CATEGORY_ID);
    expect(automaticCategoryId({ category: restaurant, score: 0.2 })).toBe(restaurant.id);
  });

  it("preserves manual selections across results and failures", () => {
    const restaurant = category("restaurant", "Restaurant", "restaurant");
    const manual = { source: "manual" as const, categoryId: restaurant.id };

    expect(
      selectionAfterClassification(manual, {
        category: category("travel", "Travel", "travel"),
        score: 0.95,
      }),
    ).toEqual(manual);
    expect(selectionAfterClassificationFailure(manual)).toEqual(manual);
    expect(
      selectionAfterClassificationFailure({
        source: "automatic",
        categoryId: restaurant.id,
      }),
    ).toEqual({ source: "automatic", categoryId: OTHERS_CATEGORY_ID });
  });

  it("rejects stale request snapshots", () => {
    expect(isCurrentClassification(4, "Dinner", 4, "Dinner")).toBe(true);
    expect(isCurrentClassification(3, "Dinner", 4, "Dinner")).toBe(false);
    expect(isCurrentClassification(4, "Dinner", 4, "Dinner tonight")).toBe(false);
  });

  it("falls back for missing categories and unknown icon names", () => {
    expect(resolveRecordCategory([], undefined)).toMatchObject({
      id: OTHERS_CATEGORY_ID,
      name: "Others",
      icon: "expense",
    });
    expect(resolveRecordCategory([], "deleted-category").name).toBe("Others");
    expect(
      resolveRecordCategory([{ id: "broken", name: "" } as CategoryOption], "broken").name,
    ).toBe("Others");
    expect(isIconName("restaurant")).toBe(true);
    expect(isIconName("not-an-icon")).toBe(false);
  });

  it("recognizes the distinct icons used by the default category taxonomy", () => {
    expect(ICON_NAME_VALUES).toEqual(
      expect.arrayContaining([
        "household",
        "vehicle",
        "parking",
        "lodging",
        "cruise",
        "connectivity",
      ]),
    );
  });
});

function candidate(categoryValue: CategoryOption, score: number): CategoryCandidateOption {
  return { category: categoryValue, score };
}

function category(id: string, name: string, icon: CategoryOption["icon"]): CategoryOption {
  return {
    id,
    name,
    icon,
  };
}
