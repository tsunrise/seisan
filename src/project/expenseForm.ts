import { parseCents } from "../domain";
import type { MoneyByMemberId, ProjectMember } from "../projectTypes";

export interface ExpensePayerDraft {
  key: number;
  memberId: number | null;
  amount: string;
}

export function expensePayerDrafts(paid: MoneyByMemberId): ExpensePayerDraft[] {
  return Object.entries(paid).map(([memberId, amount], index) => ({
    key: index,
    memberId: Number(memberId),
    amount: centsInput(amount),
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

export function centsInput(amount: number): string {
  const dollars = Math.floor(amount / 100);
  const cents = String(amount % 100).padStart(2, "0");
  return `${dollars}.${cents}`;
}
