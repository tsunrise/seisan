import type { MoneyByMemberId } from "../api/types";

export type AmountTone = "owe" | "owed" | "settled";

/** Formats cents as dollars, using accounting parentheses for negative amounts. */
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

/** Formats non-negative cents as an editable decimal input value, such as `12.30`. */
export function formatCentsInput(amount: number): string {
  const dollars = Math.floor(amount / 100);
  const cents = String(amount % 100).padStart(2, "0");
  return `${dollars}.${cents}`;
}

export function parseCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{0,2})?$/u.test(trimmed)) {
    return null;
  }
  const [dollars, cents = ""] = trimmed.split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
}

export function amountTone(amount: number | null | undefined): AmountTone {
  if (!amount) {
    return "settled";
  }
  return amount > 0 ? "owe" : "owed";
}

export function sumMoney(map: MoneyByMemberId): number {
  return Object.values(map).reduce((total, amount) => total + amount, 0);
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

/**
 * Splits `total` cents by decimal ratios with the largest-remainder method. Equal remainders are
 * broken by member ID so rounding never accumulates on a single member.
 */
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
