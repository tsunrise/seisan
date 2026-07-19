import type { ProjectMemberConfig } from "./projectTypes";

export interface MemberConfigDraft {
  paymentMethod: string;
  representsMultiplePeople: boolean;
  size: string;
}

export function representedGroupCopy(isSelf: boolean): {
  checkboxLabel: string;
  sizeLabel: string;
  helperText: string;
} {
  return isSelf
    ? {
        checkboxLabel: "I represent multiple people",
        sizeLabel: "Number of people represented",
        helperText:
          "Include yourself in this total. The people you represent should not join this project independently.",
      }
    : {
        checkboxLabel: "This member represents multiple people",
        sizeLabel: "Number of people this member represents",
        helperText:
          "Include this member in the total. The people this member represents should not join this project independently.",
      };
}

export function memberConfigDraft(config: ProjectMemberConfig = {}): MemberConfigDraft {
  const size = config.size ?? 1;
  return {
    paymentMethod: config.paymentMethod ?? "",
    representsMultiplePeople: size > 1,
    size: String(size > 1 ? size : 2),
  };
}

export function memberConfigFromDraft(
  draft: MemberConfigDraft,
  options: { includePaymentMethod?: boolean } = {},
): ProjectMemberConfig | null {
  const config: ProjectMemberConfig = {};
  if (options.includePaymentMethod !== false) {
    const paymentMethod = draft.paymentMethod.trim();
    if (paymentMethod.length > 10_000) {
      return null;
    }
    if (paymentMethod) {
      config.paymentMethod = paymentMethod;
    }
  }

  if (draft.representsMultiplePeople) {
    const size = Number(draft.size);
    if (!Number.isSafeInteger(size) || size < 2) {
      return null;
    }
    config.size = size;
  }

  return config;
}

export function memberConfigDraftIsValid(
  draft: MemberConfigDraft,
  options: { includePaymentMethod?: boolean } = {},
): boolean {
  return memberConfigFromDraft(draft, options) !== null;
}
