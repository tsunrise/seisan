import type {
  MoneyByMemberId,
  ProjectMember,
  ProjectMemberFull,
  ProjectRecord,
  RecordDescription,
} from "./projectTypes";

export { formatRelativeTime } from "./relativeTime";

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

export function formatRecordTimestamp(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const current = new Date(now);

  if (
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate()
  ) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  const monthDay = `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
  if (date.getFullYear() === current.getFullYear()) {
    return monthDay;
  }

  return `${date.getFullYear()}/${monthDay}`;
}

export function formatRecordTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatRecordDetailTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
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

export function activeMembers<T extends ProjectMember>(members: T[]): T[] {
  return members.filter((member) => !member.deleted);
}

export function findLinkedMember(
  members: ProjectMemberFull[],
  email: string | null,
): ProjectMemberFull | null {
  if (!email) {
    return null;
  }
  return members.find((member) => member.linkedEmail === email && !member.deleted) ?? null;
}

export function memberSize(member: ProjectMemberFull): number {
  const size = member.config?.size;
  return size && Number.isSafeInteger(size) && size > 0 ? size : 1;
}

export function allocateEqualByMemberSize(
  total: number,
  members: ProjectMemberFull[],
  selectedMemberIds: number[],
): MoneyByMemberId {
  const selected = new Set(selectedMemberIds);
  return allocateRatio(
    total,
    members
      .filter((member) => selected.has(member.id))
      .map((member) => ({ memberId: member.id, ratio: memberSize(member) })),
  );
}

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

function formatMemberList(members: ProjectMember[], memberIds: number[]): string {
  if (memberIds.length === 0) {
    return "Someone";
  }
  if (memberIds.length === 1) {
    return memberName(members, memberIds[0]);
  }
  if (memberIds.length === 2) {
    return `${memberName(members, memberIds[0])} and ${memberName(members, memberIds[1])}`;
  }
  return `${memberIds
    .slice(0, -1)
    .map((memberId) => memberName(members, memberId))
    .join(", ")}, and ${memberName(members, memberIds[memberIds.length - 1])}`;
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

type TransferRecordDescription = Extract<RecordDescription, { type: "transfer" }>;

export function transferSourceMemberId(description: TransferRecordDescription): number {
  return "from" in description ? description.from : description.src;
}

export function isMultiRecipientTransfer(description: TransferRecordDescription): boolean {
  return "dests" in description && description.dests.length > 1;
}

function transferDestinations(
  description: TransferRecordDescription,
): Array<{ id: number; amount: number }> {
  return "from" in description
    ? [{ id: description.to, amount: description.amount }]
    : description.dests;
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
  if (!Number.isSafeInteger(total) || total <= 0) {
    return {};
  }

  const parsedRatios = ratios.flatMap(({ memberId, ratio }) => {
    const parsed = parsePositiveDecimalRatio(ratio);
    return Number.isSafeInteger(memberId) && memberId > 0 && parsed
      ? [{ memberId, ...parsed }]
      : [];
  });
  if (parsedRatios.length === 0) {
    return {};
  }

  const commonExponent = parsedRatios.reduce(
    (lowest, ratio) => Math.min(lowest, ratio.exponent),
    parsedRatios[0].exponent,
  );
  const weightsByMemberId = new Map<number, bigint>();
  for (const ratio of parsedRatios) {
    const weight = ratio.coefficient * 10n ** BigInt(ratio.exponent - commonExponent);
    weightsByMemberId.set(ratio.memberId, (weightsByMemberId.get(ratio.memberId) ?? 0n) + weight);
  }

  const weights = [...weightsByMemberId]
    .map(([memberId, weight]) => ({ memberId, weight }))
    .sort((left, right) => left.memberId - right.memberId);
  const totalWeight = weights.reduce((sum, ratio) => sum + ratio.weight, 0n);
  const totalAsBigInt = BigInt(total);
  const shares = weights.map(({ memberId, weight }) => {
    const numerator = totalAsBigInt * weight;
    return {
      memberId,
      amount: Number(numerator / totalWeight),
      remainder: numerator % totalWeight,
    };
  });

  const assigned = shares.reduce((sum, share) => sum + share.amount, 0);
  const remaining = total - assigned;
  const remainderOrder = [...shares].sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    return left.memberId - right.memberId;
  });
  for (let index = 0; index < remaining; index += 1) {
    remainderOrder[index].amount += 1;
  }

  const allocation: MoneyByMemberId = {};
  for (const share of shares) {
    allocation[String(share.memberId)] = share.amount;
  }
  return normalizeMoneyMap(allocation);
}

function parsePositiveDecimalRatio(
  ratio: number,
): { coefficient: bigint; exponent: number } | null {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return null;
  }

  const [mantissa, scientificExponent = "0"] = ratio.toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    exponent: Number(scientificExponent) - fraction.length,
  };
}

function promiseTitle(
  description: Extract<RecordDescription, { type: "promise" }>,
  members: ProjectMember[],
): string {
  const title = `${memberName(members, description.debtorMemberId)} should pay ${memberName(
    members,
    description.creditorMemberId,
  )} ${formatCents(description.amount)}`;
  return description.reason ? `${title} for ${description.reason}` : title;
}

function promiseCardTitle(
  description: Extract<RecordDescription, { type: "promise" }>,
  members: ProjectMember[],
): string {
  const title = `Should pay ${memberName(members, description.creditorMemberId)} ${formatCents(
    description.amount,
  )}`;
  return description.reason ? `${title} for ${description.reason}` : title;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
