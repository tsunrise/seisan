import type { MoneyByMemberId, ProjectMember, ProjectRecord, RecordDescription } from "./api";

export type AmountTone = "owe" | "owed" | "settled";

export function formatCents(amount: number): string {
  const absolute = Math.abs(amount);
  const dollars = Math.floor(absolute / 100);
  const cents = String(absolute % 100).padStart(2, "0");
  const formatted = `$${dollars}.${cents}`;
  if (amount < 0) {
    return `(${formatted})`;
  }
  return formatted;
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 5) {
    return "just now";
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds} seconds ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} ${elapsedHours === 1 ? "hour" : "hours"} ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} ${elapsedDays === 1 ? "day" : "days"} ago`;
}

export function amountTone(amount: number | null | undefined): AmountTone {
  if (!amount) {
    return "settled";
  }
  return amount > 0 ? "owe" : "owed";
}

export function parseCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{0,2})?$/u.test(trimmed)) {
    return null;
  }
  const [dollars, cents = ""] = trimmed.split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
}

export function memberName(members: ProjectMember[], memberId: number): string {
  return members.find((member) => member.id === memberId)?.name ?? `#${memberId}`;
}

export function activeMembers(members: ProjectMember[]): ProjectMember[] {
  return members.filter((member) => !member.deleted);
}

export function findLinkedMember(
  members: ProjectMember[],
  email: string | null,
): ProjectMember | null {
  if (!email) {
    return null;
  }
  return members.find((member) => member.linkedEmail === email && !member.deleted) ?? null;
}

export function recordTitle(record: ProjectRecord, members: ProjectMember[]): string {
  const description = record.description;
  if (description.type === "expense") {
    const paid = sumMoney(description.paid);
    return `Paid ${formatCents(paid)} for ${description.name}`;
  }
  if (description.type === "transfer") {
    return `Transferred ${memberName(members, description.to)} ${formatCents(description.amount)}`;
  }
  return `Reverted #${description.id}`;
}

export function recordSubtitle(record: ProjectRecord, members: ProjectMember[]): string {
  return `Posted by ${memberName(members, record.authorMemberId)}`;
}

export function sumMoney(map: MoneyByMemberId): number {
  return Object.values(map).reduce((total, amount) => total + amount, 0);
}

export function negateMoneyMap(map: MoneyByMemberId): MoneyByMemberId {
  return Object.fromEntries(
    Object.entries(map)
      .map(([memberId, amount]) => [memberId, -amount] as const)
      .filter(([, amount]) => amount !== 0),
  );
}

export function deriveDelta(description: RecordDescription): MoneyByMemberId {
  if (description.type === "transfer") {
    return normalizeMoneyMap({
      [description.from]: -description.amount,
      [description.to]: description.amount,
    });
  }
  if (description.type === "revert") {
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

export function normalizeMoneyMap(map: Record<string | number, number>): MoneyByMemberId {
  const normalized: MoneyByMemberId = {};
  for (const [memberId, amount] of Object.entries(map)) {
    if (amount !== 0) {
      normalized[String(Number(memberId))] = amount;
    }
  }
  return Object.fromEntries(
    Object.entries(normalized).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

export function allocateEqual(total: number, memberIds: number[]): MoneyByMemberId {
  if (memberIds.length === 0) {
    return {};
  }
  const sortedIds = [...memberIds].sort((left, right) => left - right);
  const base = Math.floor(total / sortedIds.length);
  let remainder = total - base * sortedIds.length;
  const allocation: MoneyByMemberId = {};
  for (const memberId of sortedIds) {
    allocation[String(memberId)] = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
  }
  return normalizeMoneyMap(allocation);
}

export function allocateRatio(
  total: number,
  ratios: Array<{ memberId: number; ratio: number }>,
): MoneyByMemberId {
  const activeRatios = ratios.filter((ratio) => ratio.ratio > 0);
  const totalRatio = activeRatios.reduce((sum, ratio) => sum + ratio.ratio, 0);
  if (totalRatio <= 0) {
    return {};
  }

  const sorted = [...activeRatios].sort((left, right) => left.memberId - right.memberId);
  const allocation: MoneyByMemberId = {};
  let assigned = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const ratio = sorted[index];
    const amount =
      index === sorted.length - 1
        ? total - assigned
        : Math.floor((total * ratio.ratio) / totalRatio);
    allocation[String(ratio.memberId)] = amount;
    assigned += amount;
  }
  return normalizeMoneyMap(allocation);
}
