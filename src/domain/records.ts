import type {
  MoneyByMemberId,
  ProjectMember,
  ProjectRecord,
  RecordDescription,
  TransferDestination,
} from "../api/types";
import { memberName } from "./members";
import { formatCents, normalizeMoneyMap, sumMoney } from "./money";

type TransferRecordDescription = Extract<RecordDescription, { type: "transfer" }>;
type PromiseRecordDescription = Extract<RecordDescription, { type: "promise" }>;

export function recordTitle(record: ProjectRecord, members: ProjectMember[]): string {
  const description = record.description;
  if (description.type === "expense") {
    const paid = sumMoney(description.paid);
    return `Paid ${formatCents(paid)} for ${description.name}`;
  }
  if (description.type === "transfer") {
    const destinations = transferDestinations(description);
    const total = destinations.reduce((sum, destination) => sum + destination.amount, 0);
    if (destinations.length > 1) {
      return `Transferred ${formatCents(total)} in total`;
    }
    return `Transferred ${formatMemberList(
      members,
      destinations.map((destination) => destination.id),
    )} ${formatCents(total)}`;
  }
  if (description.type === "promise") {
    return promiseCardTitle(description, members);
  }
  if (description.type === "deleted") {
    return "Post deleted";
  }
  return `Reverted record #${description.id}`;
}

export function recordDetailTitle(record: ProjectRecord, members: ProjectMember[]): string {
  const description = record.description;
  if (description.type === "expense") {
    return `${formatMemberList(
      members,
      Object.keys(description.paid).map(Number),
    )} paid ${formatCents(sumMoney(description.paid))} for ${description.name}`;
  }

  if (description.type === "transfer") {
    return `${memberName(members, transferSourceMemberId(description))} transferred ${formatList(
      transferDestinations(description).map(
        (destination) =>
          `${memberName(members, destination.id)} ${formatCents(destination.amount)}`,
      ),
    )}`;
  }

  if (description.type === "promise") {
    return promiseTitle(description, members);
  }

  return recordTitle(record, members);
}

export function recordSubtitle(record: ProjectRecord, members: ProjectMember[]): string {
  return `Posted by ${memberName(members, record.authorMemberId)}`;
}

export function deriveDelta(description: RecordDescription): MoneyByMemberId {
  if (description.type === "transfer") {
    const delta: MoneyByMemberId = {};
    let total = 0;
    for (const destination of transferDestinations(description)) {
      delta[String(destination.id)] = (delta[String(destination.id)] ?? 0) + destination.amount;
      total += destination.amount;
    }
    delta[String(transferSourceMemberId(description))] = -total;
    return normalizeMoneyMap(delta);
  }
  if (description.type === "promise") {
    return normalizeMoneyMap({
      [description.debtorMemberId]: description.amount,
      [description.creditorMemberId]: -description.amount,
    });
  }
  if (description.type === "revert" || description.type === "deleted") {
    return {};
  }

  const delta: MoneyByMemberId = {};
  for (const [memberId, amount] of Object.entries(description.liability)) {
    delta[memberId] = (delta[memberId] ?? 0) + amount;
  }
  for (const [memberId, amount] of Object.entries(description.paid)) {
    delta[memberId] = (delta[memberId] ?? 0) - amount;
  }
  return normalizeMoneyMap(delta);
}

// Transfers are stored either in the legacy single-recipient shape (`from`/`to`/`amount`) or the
// multi-recipient batch shape (`src`/`dests`). These helpers read both.

export function transferSourceMemberId(description: TransferRecordDescription): number {
  return "from" in description ? description.from : description.src;
}

export function transferDestinations(
  description: TransferRecordDescription,
): TransferDestination[] {
  return "from" in description
    ? [{ id: description.to, amount: description.amount }]
    : description.dests;
}

export function isMultiRecipientTransfer(description: TransferRecordDescription): boolean {
  return "dests" in description && description.dests.length > 1;
}

function promiseTitle(description: PromiseRecordDescription, members: ProjectMember[]): string {
  const title = `${memberName(members, description.debtorMemberId)} should pay ${memberName(
    members,
    description.creditorMemberId,
  )} ${formatCents(description.amount)}`;
  return description.reason ? `${title} for ${description.reason}` : title;
}

function promiseCardTitle(description: PromiseRecordDescription, members: ProjectMember[]): string {
  const title = `Should pay ${memberName(members, description.creditorMemberId)} ${formatCents(
    description.amount,
  )}`;
  return description.reason ? `${title} for ${description.reason}` : title;
}

function formatMemberList(members: ProjectMember[], memberIds: number[]): string {
  if (memberIds.length === 0) {
    return "Someone";
  }
  return formatList(memberIds.map((memberId) => memberName(members, memberId)));
}

function formatList(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "someone";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
