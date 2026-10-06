import type { MoneyByMemberId, ProjectMember, ProjectMemberFull } from "../../api/types";
import {
  allocateEqualByMemberSize,
  allocateRatio,
  findMember,
  formatCentsInput,
  memberSize,
  parseCents,
} from "../../domain";
import type { SplitMode } from "../../types";

export interface ExpensePayerDraft {
  key: number;
  memberId: number | null;
  amount: string;
}

export function expensePayerDrafts(paid: MoneyByMemberId): ExpensePayerDraft[] {
  return Object.entries(paid).map(([memberId, amount], index) => ({
    key: index,
    memberId: Number(memberId),
    amount: formatCentsInput(amount),
  }));
}

export function parseExpensePayers(drafts: ExpensePayerDraft[]): MoneyByMemberId | null {
  const paid: MoneyByMemberId = {};
  const seen = new Set<number>();
  for (const draft of drafts) {
    const amount = parseCents(draft.amount);
    if (draft.memberId === null || seen.has(draft.memberId) || amount === null || amount <= 0) {
      return null;
    }
    seen.add(draft.memberId);
    paid[String(draft.memberId)] = amount;
  }
  return drafts.length > 0 ? paid : null;
}

export function previewExpensePayers(drafts: ExpensePayerDraft[]): MoneyByMemberId {
  const paid: MoneyByMemberId = {};
  const seen = new Set<number>();
  for (const draft of drafts) {
    const amount = parseCents(draft.amount);
    if (draft.memberId === null || seen.has(draft.memberId) || amount === null || amount <= 0) {
      continue;
    }
    seen.add(draft.memberId);
    paid[String(draft.memberId)] = amount;
  }
  return paid;
}

export function availablePayerMembers(
  members: ProjectMember[],
  drafts: ExpensePayerDraft[],
  draftKey: number,
): ProjectMember[] {
  const selectedByOtherRows = new Set(
    drafts
      .filter((draft) => draft.key !== draftKey)
      .flatMap((draft) => (draft.memberId === null ? [] : [draft.memberId])),
  );
  return members.filter((member) => !member.deleted && !selectedByOtherRows.has(member.id));
}

/** Editable custom-split inputs prefilled from a stored liability map. */
export function customAmountInputs(liability: MoneyByMemberId): Record<number, string> {
  return Object.fromEntries(
    Object.entries(liability).map(([memberId, amount]) => [
      Number(memberId),
      formatCentsInput(amount),
    ]),
  );
}

/**
 * Splits the paid total across the selected members. Equal splits weight members by represented
 * size; ratio inputs default to that same size; custom inputs are taken as entered and may not sum
 * to the total, which the composer validates on submit.
 */
export function expenseLiability({
  total,
  splitMode,
  members,
  selectedIds,
  ratios,
  customAmounts,
}: {
  total: number;
  splitMode: SplitMode;
  members: ProjectMemberFull[];
  selectedIds: number[];
  ratios: Record<number, string>;
  customAmounts: Record<number, string>;
}): MoneyByMemberId {
  if (total <= 0) {
    return {};
  }
  if (splitMode === "equal") {
    return allocateEqualByMemberSize(total, members, selectedIds);
  }
  if (splitMode === "ratio") {
    return allocateRatio(
      total,
      selectedIds.map((memberId) => {
        const member = findMember(members, memberId);
        return { memberId, ratio: Number(ratios[memberId] || (member ? memberSize(member) : 1)) };
      }),
    );
  }
  const custom: MoneyByMemberId = {};
  for (const memberId of selectedIds) {
    const parsed = parseCents(customAmounts[memberId] ?? "");
    if (parsed !== null) {
      custom[String(memberId)] = parsed;
    }
  }
  return custom;
}
