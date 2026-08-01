import { z } from "zod";

import type {
  MoneyByMemberId as SharedMoneyByMemberId,
  TransferBatch as SharedTransferBatch,
  TransferDestination as SharedTransferDestination,
} from "../shared/settlement";
import { CategoryId } from "./category/schema";
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

export const Cents = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
  .meta({ description: "Signed integer-cent amount." });
export type Cents = z.infer<typeof Cents>;

export const MemberId = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .meta({ description: "Project-local member ID.", examples: [1] });
export type MemberId = z.infer<typeof MemberId>;

export type MemberName = string;
export type ProjectName = string;

const memberIdKeyRegex = /^[1-9]\d*$/u;

function normalizeMoneyByMemberId(input: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [memberId, amount] of Object.entries(input)) {
    if (amount === 0) {
      continue;
    }
    const normalizedMemberId = String(Number(memberId));
    const nextAmount = (result[normalizedMemberId] ?? 0) + amount;
    if (nextAmount === 0) {
      delete result[normalizedMemberId];
    } else {
      result[normalizedMemberId] = nextAmount;
    }
  }
  return result;
}

function makeMoneyByMemberId(options: { nonNegative: boolean }) {
  const value = options.nonNegative ? Cents.min(0) : Cents;
  return z
    .record(z.string().regex(memberIdKeyRegex), value)
    .superRefine((input, context) => {
      const memberIds = Object.keys(input);
      if (memberIds.length > ABSOLUTE_LIST_LIMIT) {
        context.addIssue({ code: "custom", message: "Money map has too many entries." });
      }

      const seen = new Set<string>();
      for (const memberId of memberIds) {
        const numericMemberId = Number(memberId);
        if (!Number.isSafeInteger(numericMemberId) || numericMemberId <= 0) {
          context.addIssue({
            code: "custom",
            message: "Invalid member ID key.",
            path: [memberId],
          });
          continue;
        }

        const normalizedMemberId = String(numericMemberId);
        if (seen.has(normalizedMemberId)) {
          context.addIssue({
            code: "custom",
            message: "Duplicate member ID after normalization.",
            path: [memberId],
          });
        }
        seen.add(normalizedMemberId);
      }
    })
    .overwrite(normalizeMoneyByMemberId);
}

export const MoneyByMemberId = makeMoneyByMemberId({ nonNegative: false }).meta({
  description: "Signed integer-cent amounts keyed by project-local member ID.",
  examples: [{ "1": -6_200, "2": 6_200 }],
});
export type MoneyByMemberId = SharedMoneyByMemberId;

export const NonNegativeMoneyByMemberId = makeMoneyByMemberId({ nonNegative: true }).meta({
  description: "Non-negative integer-cent amounts keyed by project-local member ID.",
  examples: [{ "1": 6_200, "2": 6_200 }],
});
export type NonNegativeMoneyByMemberId = z.infer<typeof NonNegativeMoneyByMemberId>;

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
    return normalizeMoneyByMemberId(input);
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

export const ExpenseDescription = z
  .object({
    type: z.literal("expense").meta({ description: "Expense record discriminator." }),
    name: z
      .string()
      .trim()
      .min(1)
      .max(ABSOLUTE_TEXT_LIMIT)
      .meta({ description: "Short description of the expense.", examples: ["Ramen dinner"] }),
    paid: NonNegativeMoneyByMemberId,
    liability: NonNegativeMoneyByMemberId,
    categoryId: CategoryId.optional().meta({
      description: "Classified spending category, when known.",
      examples: ["4a6cc79a-51da-4e94-9d62-45ba3d853b1c"],
    }),
  })
  .strict()
  .superRefine((description, context) => {
    const totalPaid = MoneyByMemberIdUtils.sum(description.paid);
    const totalLiability = MoneyByMemberIdUtils.sum(description.liability);
    if (totalPaid <= 0) {
      context.addIssue({
        code: "custom",
        message: "Expense total must be positive.",
        path: ["paid"],
      });
    }
    if (totalPaid !== totalLiability) {
      context.addIssue({
        code: "custom",
        message: "Paid total must equal liability total.",
        path: ["liability"],
      });
    }
  })
  .meta({
    description: "A shared expense and its payment/liability split.",
    examples: [
      {
        type: "expense",
        name: "Ramen dinner",
        paid: { "1": 12_400 },
        liability: { "1": 6_200, "2": 6_200 },
        categoryId: "4a6cc79a-51da-4e94-9d62-45ba3d853b1c",
      },
    ],
  });
export type ExpenseDescription = z.infer<typeof ExpenseDescription>;

const PositiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const TransferDestination = z
  .object({
    id: PositiveSafeInteger.meta({
      description: "Member ID receiving this portion of the transfer.",
      examples: [1],
    }),
    amount: PositiveSafeInteger.meta({
      description: "Amount sent to this member in integer cents.",
      examples: [6_200],
    }),
  })
  .strict()
  .meta({ description: "One recipient and amount in a multi-recipient transfer." });
export type TransferDestination = SharedTransferDestination;

export const TransferBatch = z
  .object({
    src: PositiveSafeInteger.meta({
      description: "Member ID sending the money.",
      examples: [2],
    }),
    dests: z
      .array(TransferDestination)
      .min(1)
      .max(ABSOLUTE_LIST_LIMIT)
      .meta({ description: "Unique recipients and their positive cent-denominated amounts." }),
  })
  .strict()
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
  })
  .meta({
    description: "A grouped transfer from one member to one or more recipients.",
    examples: [{ src: 2, dests: [{ id: 1, amount: 6_200 }] }],
  });
export type TransferBatch = SharedTransferBatch;

export const LegacyTransferDescription = z
  .object({
    type: z.literal("transfer").meta({ description: "Transfer record discriminator." }),
    from: MemberId.meta({ description: "Member ID sending the money.", examples: [2] }),
    to: MemberId.meta({ description: "Member ID receiving the money.", examples: [1] }),
    amount: Cents.positive().meta({
      description: "Transferred amount in integer cents.",
      examples: [6_200],
    }),
  })
  .strict()
  .superRefine((description, context) => {
    if (description.from === description.to) {
      context.addIssue({
        code: "custom",
        message: "Transfer endpoints must differ.",
        path: ["to"],
      });
    }
  })
  .meta({
    description: "A payment from one project member to another.",
    examples: [{ type: "transfer", from: 2, to: 1, amount: 6_200 }],
  });
export type LegacyTransferDescription = z.infer<typeof LegacyTransferDescription>;

export const MultiTransferDescription = TransferBatch.safeExtend({
  type: z.literal("transfer").meta({ description: "Transfer record discriminator." }),
}).meta({
  description: "A payment from one project member to one or more project members.",
  examples: [
    {
      type: "transfer",
      src: 2,
      dests: [
        { id: 1, amount: 3_100 },
        { id: 3, amount: 3_100 },
      ],
    },
  ],
});
export type MultiTransferDescription = z.infer<typeof MultiTransferDescription>;

export const TransferDescription = z
  .union([LegacyTransferDescription, MultiTransferDescription])
  .meta({
    description: "A legacy single-recipient or multi-recipient transfer record.",
    examples: [
      { type: "transfer", from: 2, to: 1, amount: 6_200 },
      {
        type: "transfer",
        src: 2,
        dests: [
          { id: 1, amount: 3_100 },
          { id: 3, amount: 3_100 },
        ],
      },
    ],
  });
export type TransferDescription = z.infer<typeof TransferDescription>;

export const PromiseDescription = z
  .object({
    type: z.literal("promise").meta({ description: "Promise record discriminator." }),
    debtorMemberId: MemberId.meta({
      description: "Member ID that owes the money.",
      examples: [2],
    }),
    creditorMemberId: MemberId.meta({
      description: "Member ID that is owed the money.",
      examples: [1],
    }),
    amount: Cents.positive().meta({
      description: "Promised amount in integer cents.",
      examples: [3_100],
    }),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(ABSOLUTE_TEXT_LIMIT)
      .optional()
      .meta({ description: "Optional explanation for the promise.", examples: ["Museum tickets"] }),
  })
  .strict()
  .superRefine((description, context) => {
    if (description.debtorMemberId === description.creditorMemberId) {
      context.addIssue({
        code: "custom",
        message: "Promise endpoints must differ.",
        path: ["creditorMemberId"],
      });
    }
  })
  .meta({
    description: "A debt acknowledged between two project members.",
    examples: [
      {
        type: "promise",
        debtorMemberId: 2,
        creditorMemberId: 1,
        amount: 3_100,
        reason: "Museum tickets",
      },
    ],
  });
export type PromiseDescription = z.infer<typeof PromiseDescription>;

export const RevertDescription = z
  .object({
    type: z.literal("revert").meta({ description: "Revert record discriminator." }),
    id: PositiveSafeInteger.meta({
      description: "Record ID whose effect is reversed.",
      examples: [1],
    }),
  })
  .strict()
  .meta({
    description: "A deprecated legacy record that reverses an earlier project record.",
    deprecated: true,
    examples: [{ type: "revert", id: 1 }],
  });
export type RevertDescription = z.infer<typeof RevertDescription>;

export const DeletedDescription = z
  .object({
    type: z.literal("deleted").meta({ description: "Deleted record discriminator." }),
  })
  .strict()
  .meta({
    description: "A response-only tombstone for a deleted project record.",
    examples: [{ type: "deleted" }],
  });
export type DeletedDescription = z.infer<typeof DeletedDescription>;

export const WritableRecordDescription = z
  .union([ExpenseDescription, TransferDescription, PromiseDescription])
  .meta({
    description: "Writable details for an expense, transfer, or promise record.",
    examples: [
      {
        type: "expense",
        name: "Ramen dinner",
        paid: { "1": 12_400 },
        liability: { "1": 6_200, "2": 6_200 },
      },
      { type: "transfer", from: 2, to: 1, amount: 6_200 },
      {
        type: "promise",
        debtorMemberId: 2,
        creditorMemberId: 1,
        amount: 3_100,
        reason: "Museum tickets",
      },
    ],
  });
export type WritableRecordDescription = z.infer<typeof WritableRecordDescription>;

export const RecordDescription = z
  .union([
    ExpenseDescription,
    TransferDescription,
    PromiseDescription,
    RevertDescription,
    DeletedDescription,
  ])
  .meta({
    description:
      "Details for an expense, transfer, promise, deprecated legacy revert, or deleted record.",
  });
export type RecordDescription = z.infer<typeof RecordDescription>;

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
  updatedAt?: number;
  updatedByMemberId?: number;
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
