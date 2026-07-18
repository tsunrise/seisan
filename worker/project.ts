import { z } from "zod";

import { normalizeEmail } from "./email";
import { ABSOLUTE_LIST_LIMIT } from "./limits";

export const PROJECTS_REGISTRY_NAME = "projects";
export const PROJECT_SUMMARY_SYNC_DELAY_MS = 10_000;
// TODO: Give user an option to archive a record (e.g. delete DO but save the records in KV).

const projectIdRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const ProjectId = z
  .string()
  .regex(projectIdRegex)
  .transform((id) => id.toLowerCase());
export type ProjectId = z.infer<typeof ProjectId>;

export type Cents = number;
export type MemberId = number;
export type MemberName = string;
export type ProjectName = string;
export type MoneyByMemberId = Record<string, number>;

export class ProjectNameUtils {
  static normalizeMember(name: string): string {
    return name.trim().replace(/\s+/gu, " ");
  }

  static normalizeProject(name: string): string {
    return name.trim().replace(/\s+/gu, " ");
  }
}

export class ProjectEmailsUtils {
  static uniqueSorted(emails: string[]): string[] {
    return [...new Set(emails.map(normalizeEmail))].sort();
  }
}

export class MoneyByMemberIdUtils {
  static normalize(input: MoneyByMemberId): MoneyByMemberId {
    const result: MoneyByMemberId = {};
    for (const [memberId, amount] of Object.entries(input)) {
      this.add(result, memberId, amount);
    }
    return result;
  }

  static add(map: MoneyByMemberId, memberId: string | number, amount: number): MoneyByMemberId {
    if (amount === 0) {
      return map;
    }

    const normalizedMemberId = String(Number(memberId));
    const nextAmount = (map[normalizedMemberId] ?? 0) + amount;
    if (nextAmount === 0) {
      delete map[normalizedMemberId];
      return map;
    }

    map[normalizedMemberId] = nextAmount;
    return map;
  }

  static negate(input: MoneyByMemberId): MoneyByMemberId {
    const result: MoneyByMemberId = {};
    for (const [memberId, amount] of this.entries(input)) {
      this.add(result, memberId, -amount);
    }
    return result;
  }

  static equals(left: MoneyByMemberId, right: MoneyByMemberId): boolean {
    const leftEntries = this.entries(left);
    const rightEntries = this.entries(right);
    if (leftEntries.length !== rightEntries.length) {
      return false;
    }
    return leftEntries.every(([memberId, amount], index) => {
      const [rightMemberId, rightAmount] = rightEntries[index];
      return memberId === rightMemberId && amount === rightAmount;
    });
  }

  static sum(input: MoneyByMemberId): number {
    return this.values(input).reduce((total, amount) => total + amount, 0);
  }

  static members(input: MoneyByMemberId): string[] {
    return this.entries(input).map(([memberId]) => memberId);
  }

  private static values(input: MoneyByMemberId): number[] {
    return this.entries(input).map(([, amount]) => amount);
  }

  static entries(input: MoneyByMemberId): Array<[string, number]> {
    return Object.entries(this.normalize(input)).sort(
      ([left], [right]) => Number(left) - Number(right),
    );
  }
}

export type ExpenseDescription = {
  type: "expense";
  name: string;
  paid: MoneyByMemberId;
  liability: MoneyByMemberId;
  categoryId?: string;
};

const PositiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const TransferDestination = z.object({
  id: PositiveSafeInteger,
  amount: PositiveSafeInteger,
});
export type TransferDestination = z.infer<typeof TransferDestination>;

export const TransferBatch = z
  .object({
    src: PositiveSafeInteger,
    dests: z.array(TransferDestination).min(1).max(ABSOLUTE_LIST_LIMIT),
  })
  .superRefine((transfer, context) => {
    const seen = new Set<MemberId>();
    let total = 0;
    for (const [index, destination] of transfer.dests.entries()) {
      if (destination.id === transfer.src) {
        context.addIssue({
          code: "custom",
          message: "Transfer endpoints must differ.",
          path: ["dests", index, "id"],
        });
      }
      if (seen.has(destination.id)) {
        context.addIssue({
          code: "custom",
          message: "Transfer destinations must be unique.",
          path: ["dests", index, "id"],
        });
      }
      seen.add(destination.id);
      total += destination.amount;
      if (!Number.isSafeInteger(total)) {
        context.addIssue({
          code: "custom",
          message: "Transfer total must be a safe integer.",
          path: ["dests"],
        });
        break;
      }
    }
  });
export type TransferBatch = z.infer<typeof TransferBatch>;

export type LegacyTransferDescription = {
  type: "transfer";
  from: MemberId;
  to: MemberId;
  amount: Cents;
};

export type TransferDescription =
  | LegacyTransferDescription
  | ({ type: "transfer" } & TransferBatch);

export class SettlementPlanUtils {
  static create(balance: MoneyByMemberId): TransferBatch[] | null {
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
    const destinationsBySender = new Map<MemberId, TransferDestination[]>();
    const addTransfer = (src: MemberId, id: MemberId, amount: Cents): void => {
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
    const matchedRecipientIds = new Set<MemberId>();
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
}

interface SettlementParty {
  id: MemberId;
  amount: Cents;
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

export type PromiseDescription = {
  type: "promise";
  debtorMemberId: MemberId;
  creditorMemberId: MemberId;
  amount: Cents;
  reason?: string;
};

export type RevertDescription = {
  type: "revert";
  id: number;
};

export type RecordDescription =
  | ExpenseDescription
  | TransferDescription
  | PromiseDescription
  | RevertDescription;

export type ProjectAcl = { type: "public" } | { type: "restricted"; emails: string[] };
export type ProjectAclType = ProjectAcl["type"];

export type ProjectMemberPatch = { name: MemberName } | { email: "" };
export type ProjectJoin = { memberId: MemberId } | { name: MemberName };

export interface ProjectMember {
  id: number;
  name: string;
  deleted: boolean;
  linkedEmail?: string;
}

export interface ProjectRecord {
  id: number;
  authorMemberId: number;
  delta: MoneyByMemberId;
  description: RecordDescription;
  createdAt: number;
  reverted?: {
    recordId: number;
    authorMemberId: number;
    createdAt: number;
  };
}

export interface ProjectSummary {
  id: string;
  name: string;
  owner: string;
  member: ProjectMember | null;
  balance: number | null;
  updatedAt: number;
}

export type WithSyncTime<T> = T & { lastSyncAt: number };
