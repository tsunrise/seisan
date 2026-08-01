export type MoneyByMemberId = Record<string, number>;

export interface TransferDestination {
  id: number;
  amount: number;
}

export interface TransferBatch {
  src: number;
  dests: TransferDestination[];
}

interface SettlementParty {
  id: number;
  amount: number;
}

export function createSettlementPlan(balance: MoneyByMemberId): TransferBatch[] | null {
  // Positive balances owe money; negative balances are owed money.
  const senders: SettlementParty[] = [];
  const recipients: SettlementParty[] = [];
  const seenMemberIds = new Set<number>();
  let totalSent = 0n;
  let totalReceived = 0n;

  for (const [rawMemberId, amount] of Object.entries(balance)) {
    const memberId = Number(rawMemberId);
    if (
      !Number.isSafeInteger(memberId) ||
      memberId <= 0 ||
      seenMemberIds.has(memberId) ||
      !Number.isSafeInteger(amount)
    ) {
      return null;
    }
    seenMemberIds.add(memberId);

    if (amount > 0) {
      senders.push({ id: memberId, amount });
      totalSent += BigInt(amount);
    } else if (amount < 0) {
      recipients.push({ id: memberId, amount: -amount });
      totalReceived += BigInt(-amount);
    }
  }

  // BigInt totals avoid losing the zero-sum invariant when many safe integers are added.
  if (totalSent !== totalReceived) {
    return null;
  }

  // Accumulate payment legs by sender so the final plan uses the TransferBatch wire shape.
  const destinationsBySender = new Map<number, TransferDestination[]>();
  const addTransfer = (src: number, id: number, amount: number): void => {
    const destinations = destinationsBySender.get(src) ?? [];
    destinations.push({ id, amount });
    destinationsBySender.set(src, destinations);
  };

  // Settle equal balances first: one payment removes two participants and often reduces the plan.
  const recipientsByAmount = new Map<number, SettlementParty[]>();
  for (const recipient of recipients) {
    const matches = recipientsByAmount.get(recipient.amount) ?? [];
    matches.push(recipient);
    recipientsByAmount.set(recipient.amount, matches);
  }
  for (const matches of recipientsByAmount.values()) {
    matches.sort((left, right) => right.id - left.id);
  }

  const remainingSenders: SettlementParty[] = [];
  const matchedRecipientIds = new Set<number>();
  for (const sender of [...senders].sort(compareSettlementParties)) {
    const exactMatches = recipientsByAmount.get(sender.amount);
    const recipient = exactMatches?.pop();
    if (!recipient) {
      remainingSenders.push(sender);
      continue;
    }
    matchedRecipientIds.add(recipient.id);
    addTransfer(sender.id, recipient.id, sender.amount);
  }

  // Greedily match the largest remaining sender and recipient. Each payment clears at least one
  // outstanding balance, while heap ordering keeps the process efficient and deterministic.
  const senderHeap = new SettlementPartyMaxHeap(remainingSenders);
  const recipientHeap = new SettlementPartyMaxHeap(
    recipients.filter((recipient) => !matchedRecipientIds.has(recipient.id)),
  );
  while (senderHeap.size > 0 && recipientHeap.size > 0) {
    const sender = senderHeap.pop();
    const recipient = recipientHeap.pop();
    if (!sender || !recipient) {
      return null;
    }

    const amount = Math.min(sender.amount, recipient.amount);
    addTransfer(sender.id, recipient.id, amount);
    sender.amount -= amount;
    recipient.amount -= amount;
    if (sender.amount > 0) {
      senderHeap.push(sender);
    }
    if (recipient.amount > 0) {
      recipientHeap.push(recipient);
    }
  }

  if (senderHeap.size > 0 || recipientHeap.size > 0) {
    return null;
  }

  // Canonical ordering makes uncached and recomputed responses byte-for-byte stable.
  return [...destinationsBySender.entries()]
    .sort(([left], [right]) => left - right)
    .map(([src, dests]) => ({
      src,
      dests: dests.sort((left, right) => left.id - right.id),
    }));
}

function compareSettlementParties(left: SettlementParty, right: SettlementParty): number {
  return right.amount - left.amount || left.id - right.id;
}

class SettlementPartyMaxHeap {
  private readonly values: SettlementParty[] = [];

  constructor(values: SettlementParty[]) {
    for (const value of values) {
      this.push(value);
    }
  }

  get size(): number {
    return this.values.length;
  }

  // https://en.wikipedia.org/wiki/Binary_heap

  push(value: SettlementParty): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (compareSettlementParties(this.values[parentIndex], value) <= 0) {
        break;
      }
      this.values[index] = this.values[parentIndex];
      index = parentIndex;
    }
    this.values[index] = value;
  }

  pop(): SettlementParty | null {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last) {
      return first ?? null;
    }
    if (this.values.length === 0) {
      return first;
    }

    let index = 0;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      if (leftIndex >= this.values.length) {
        break;
      }
      let nextIndex = leftIndex;
      if (
        rightIndex < this.values.length &&
        compareSettlementParties(this.values[rightIndex], this.values[leftIndex]) < 0
      ) {
        nextIndex = rightIndex;
      }
      if (compareSettlementParties(this.values[nextIndex], last) >= 0) {
        break;
      }
      this.values[index] = this.values[nextIndex];
      index = nextIndex;
    }
    this.values[index] = last;
    return first;
  }
}
