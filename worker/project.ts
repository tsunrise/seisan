import { z } from "zod";

import { normalizeEmail, normalizedEmailSchema } from "./email";
import { ABSOLUTE_LIST_LIMIT, ABSOLUTE_TEXT_LIMIT } from "./limits";

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

// TODO(schema-source): replace these project primitive aliases with canonical zod schemas shared by
// route validation and OpenAPI instead of maintaining their constraints in multiple files.
export type Cents = number;
export type MemberId = number;
export type MemberName = string;
export type ProjectName = string;
export type MoneyByMemberId = Record<string, number>;

const ProjectMemberSize = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ProjectMemberPaymentMethod = z.string().trim().min(1).max(ABSOLUTE_TEXT_LIMIT);

export const ProjectMemberConfig = z
  .object({
    size: ProjectMemberSize.optional().meta({
      description: "Number of people represented by this project member.",
      examples: [2],
    }),
    paymentMethod: ProjectMemberPaymentMethod.optional().meta({
      description: "Opaque instructions for transferring money to this project member.",
      examples: ["venmo: mika@example.com"],
    }),
  })
  .strict()
  .meta({ description: "Optional metadata for a project member." });
export type ProjectMemberConfig = z.infer<typeof ProjectMemberConfig>;

export const ProjectMemberConfigPatch = z
  .object({
    size: ProjectMemberSize.nullable()
      .optional()
      .meta({
        description: "Replacement represented group size, or null to remove it.",
        examples: [3, null],
      }),
    paymentMethod: ProjectMemberPaymentMethod.nullable()
      .optional()
      .meta({
        description: "Replacement payment instructions, or null to remove them.",
        examples: ["zelle: 123456789", null],
      }),
  })
  .strict()
  .meta({ description: "A shallow member-config patch." });
export type ProjectMemberConfigPatch = z.infer<typeof ProjectMemberConfigPatch>;

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

// TODO(schema-source): replace the record-description type declarations with canonical zod schemas
// reused by project routes and OpenAPI, then infer these types from those schemas.
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

// TODO(schema-source): canonicalize the remaining project ACL, mutation, record, and summary shapes
// so their route, OpenAPI, registry, and frontend declarations can import one source of truth.
export type ProjectAcl = { type: "public" } | { type: "restricted"; emails: string[] };
export type ProjectAclType = ProjectAcl["type"];

export type ProjectMemberPatch = { name: MemberName } | { email: "" };
export type ProjectJoin = { memberId: MemberId } | { name: MemberName };

export const ProjectMember = z
  .object({
    id: PositiveSafeInteger.meta({ description: "Project-local member ID.", examples: [1] }),
    name: z.string().meta({ description: "Member display name.", examples: ["Mika"] }),
    deleted: z
      .boolean()
      .meta({ description: "Whether the member has been soft-deleted.", examples: [false] }),
    linkedEmail: normalizedEmailSchema.optional().meta({
      description: "Account currently linked to this member, when present.",
      examples: ["mika@example.com"],
    }),
  })
  .strict()
  .meta({ description: "A person participating in a project." });
export type ProjectMember = z.infer<typeof ProjectMember>;

export const ProjectMemberFull = ProjectMember.extend({
  config: ProjectMemberConfig.optional().meta({
    description: "Member metadata, omitted from logged-out public-project responses.",
  }),
})
  .strict()
  .meta({
    description: "A project member with metadata included for authenticated full project reads.",
  });
export type ProjectMemberFull = z.infer<typeof ProjectMemberFull>;

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
