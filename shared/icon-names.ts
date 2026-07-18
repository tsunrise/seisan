export const ICON_NAME_VALUES = [
  "expense",
  "transfer",
  "transfer-multiple",
  "promise",
  "restaurant",
  "grocery",
  "fuel",
  "vehicle",
  "parking",
  "transit",
  "home",
  "household",
  "home-repair",
  "utilities",
  "connectivity",
  "medical",
  "pet",
  "shopping",
  "entertainment",
  "travel",
  "lodging",
  "cruise",
  "finance",
  "personal-care",
  "education",
  "insurance",
  "subscription",
  "beach",
] as const;

export type IconName = (typeof ICON_NAME_VALUES)[number];

export const ICON_NAMES: ReadonlySet<IconName> = new Set(ICON_NAME_VALUES);

export function isIconName(value: unknown): value is IconName {
  return typeof value === "string" && ICON_NAMES.has(value as IconName);
}
