import { z } from "zod";

export const PROJECTS_REGISTRY_NAME = "projects";
export const PROJECT_REGISTRY_CACHE_TTL_SECONDS = 60;
export const PROJECTS_LIST_CACHE_TTL_SECONDS = 10;
export const PROJECT_SUMMARY_SYNC_DELAY_MS = 10_000;
// TODO: Give user an option to archive a record (e.g. delete DO but save the records in KV).
export const PROJECTS_PER_USER_LIMIT = 50;
export const PROJECT_RECORD_DEFAULT_LIMIT = 50;
export const PROJECT_RECORD_MAX_LIMIT = 1024;
export const MAX_MONEY_CENTS = 100_000_000;
export const MAX_BALANCE_CENTS = 100_000_000;

const projectIdRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const memberIdKeyRegex = /^[1-9]\d*$/u;

const centsSchema = z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS);

export const normalizedEmailSchema = z.email().transform((email) => normalizeEmail(email));

export const projectIdSchema = z
  .string()
  .regex(projectIdRegex)
  .transform((id) => id.toLowerCase());

export const memberIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const memberNameSchema = z
  .string()
  .transform(normalizeMemberName)
  .pipe(z.string().min(1).max(100));

export const projectNameSchema = z
  .string()
  .transform(normalizeProjectName)
  .pipe(z.string().min(1).max(120));

export type MoneyByMemberId = Record<string, number>;

function makeMoneyMapSchema(options: { nonNegative: boolean }) {
  const valueSchema = options.nonNegative ? centsSchema.min(0) : centsSchema;

  return z
    .record(z.string(), valueSchema)
    .superRefine((input, context) => {
      const seen = new Set<string>();
      for (const memberId of Object.keys(input)) {
        if (!isMemberIdKey(memberId)) {
          context.addIssue({
            code: "custom",
            message: "Invalid member ID key.",
            path: [memberId],
          });
          continue;
        }

        const normalizedMemberId = String(Number(memberId));
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
    .transform((input) => normalizeMoneyMap(input));
}

export const moneyMapSchema = makeMoneyMapSchema({ nonNegative: false });
export const nonNegativeMoneyMapSchema = makeMoneyMapSchema({ nonNegative: true });

const expenseDescriptionSchema = z
  .object({
    type: z.literal("expense"),
    name: z.string().trim().min(1).max(200),
    paid: nonNegativeMoneyMapSchema,
    liability: nonNegativeMoneyMapSchema,
  })
  .superRefine((description, context) => {
    const totalPaid = sumMoneyMap(description.paid);
    const totalLiability = sumMoneyMap(description.liability);
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
  });

const transferDescriptionSchema = z
  .object({
    type: z.literal("transfer"),
    from: memberIdSchema,
    to: memberIdSchema,
    amount: centsSchema.positive(),
  })
  .superRefine((description, context) => {
    if (description.from === description.to) {
      context.addIssue({
        code: "custom",
        message: "Transfer endpoints must differ.",
        path: ["to"],
      });
    }
  });

const revertDescriptionSchema = z.object({
  type: z.literal("revert"),
  id: z.number().int().positive(),
});

export const recordDescriptionSchema = z.discriminatedUnion("type", [
  expenseDescriptionSchema,
  transferDescriptionSchema,
  revertDescriptionSchema,
]);

export const projectAclSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("public") }),
  z.object({
    type: z.literal("restricted"),
    emails: z.array(normalizedEmailSchema).max(100).transform(uniqueSortedEmails),
  }),
]);

export const projectCreateSchema = z.object({
  name: projectNameSchema,
  acl: projectAclSchema,
  ownerMemberName: memberNameSchema.optional(),
});

export const projectRenameSchema = z.object({
  name: projectNameSchema,
});

export const projectAppendRecordSchema = z.object({
  delta: moneyMapSchema,
  description: recordDescriptionSchema,
});

export const projectAclEmailsSchema = z.object({
  emails: z.array(normalizedEmailSchema).min(1).max(100).transform(uniqueSortedEmails),
});

export const projectAclTypeSchema = z.object({
  type: z.enum(["public", "restricted"]),
});

export const projectMemberCreateSchema = z.object({
  name: memberNameSchema,
});

export const projectMemberPatchSchema = z.union([
  z.object({ name: memberNameSchema }).strict(),
  z.object({ email: z.literal("") }).strict(),
]);

export const projectMemberEmailUnlinkSchema = z.object({
  email: normalizedEmailSchema,
});

export const projectJoinSchema = z.union([
  z.object({ memberId: memberIdSchema }).strict().describe("claim unlinked member"),
  z.object({ name: memberNameSchema }).strict().describe("create a new member"),
]);

export type ProjectAcl = z.infer<typeof projectAclSchema>;
export type ProjectAclType = ProjectAcl["type"];
export type RecordDescription = z.infer<typeof recordDescriptionSchema>;
export type ProjectJoinInput = z.infer<typeof projectJoinSchema>;
export type ProjectMemberPatch = z.infer<typeof projectMemberPatchSchema>;

export interface ProjectRegistryCacheValue {
  doId: string;
}

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

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeMemberName(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

export function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

export function normalizeMemberNameForUnique(name: string): string {
  return normalizeMemberName(name).toLowerCase();
}

export function defaultMemberNameForEmail(email: string): string {
  const localPart = normalizeEmail(email).split("@")[0] ?? "";
  return normalizeMemberName(localPart || "Member").slice(0, 100);
}

export function uniqueSortedEmails(emails: string[]): string[] {
  return [...new Set(emails.map(normalizeEmail))].sort();
}

export function normalizeMoneyMap(input: Record<string, number>): MoneyByMemberId {
  const result: MoneyByMemberId = {};
  for (const [rawMemberId, amount] of Object.entries(input)) {
    if (amount === 0) {
      continue;
    }
    addMoney(result, String(Number(rawMemberId)), amount);
  }
  return sortMoneyMap(result);
}

export function negateMoneyMap(input: MoneyByMemberId): MoneyByMemberId {
  const result: MoneyByMemberId = {};
  for (const [memberId, amount] of Object.entries(input)) {
    addMoney(result, memberId, -amount);
  }
  return sortMoneyMap(result);
}

export function moneyMapsEqual(left: MoneyByMemberId, right: MoneyByMemberId): boolean {
  const normalizedLeft = normalizeMoneyMap(left);
  const normalizedRight = normalizeMoneyMap(right);
  const leftEntries = Object.entries(normalizedLeft);
  const rightEntries = Object.entries(normalizedRight);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([memberId, amount], index) => {
    const [rightMemberId, rightAmount] = rightEntries[index];
    return memberId === rightMemberId && amount === rightAmount;
  });
}

export function sumMoneyMap(input: MoneyByMemberId): number {
  return Object.values(input).reduce((total, amount) => total + amount, 0);
}

export function deriveDescriptionDelta(
  description: RecordDescription,
  revertTargetDelta?: MoneyByMemberId,
): MoneyByMemberId | null {
  if (description.type === "expense") {
    const delta: MoneyByMemberId = {};
    for (const [memberId, amount] of Object.entries(description.liability)) {
      addMoney(delta, memberId, amount);
    }
    for (const [memberId, amount] of Object.entries(description.paid)) {
      addMoney(delta, memberId, -amount);
    }
    return sortMoneyMap(delta);
  }

  if (description.type === "transfer") {
    return normalizeMoneyMap({
      [String(description.from)]: -description.amount,
      [String(description.to)]: description.amount,
    });
  }

  if (!revertTargetDelta) {
    return null;
  }
  return negateMoneyMap(revertTargetDelta);
}

export function parseRecordLimit(rawLimit: string | undefined): number | null {
  if (rawLimit === undefined || rawLimit === "") {
    return PROJECT_RECORD_DEFAULT_LIMIT;
  }
  if (!/^\d+$/u.test(rawLimit)) {
    return null;
  }

  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PROJECT_RECORD_MAX_LIMIT) {
    return null;
  }
  return limit;
}

export function parseRecordOffset(rawOffset: string | undefined): number | null {
  if (rawOffset === undefined || rawOffset === "") {
    return Number.MAX_SAFE_INTEGER;
  }
  if (!/^\d+$/u.test(rawOffset)) {
    return null;
  }

  const offset = Number(rawOffset);
  if (!Number.isSafeInteger(offset) || offset < 1) {
    return null;
  }
  return offset;
}

export function parseMemberIdParam(rawMemberId: string): number | null {
  if (!isMemberIdKey(rawMemberId)) {
    return null;
  }
  return Number(rawMemberId);
}

export function projectRegistryCacheKey(projectId: string): string {
  return `project:${projectId}`;
}

export function serializeProjectRegistryCacheValue(value: ProjectRegistryCacheValue): string {
  return JSON.stringify({ doId: value.doId });
}

export function parseProjectRegistryCacheValue(value: string): ProjectRegistryCacheValue | null {
  try {
    const parsed = JSON.parse(value) as Partial<ProjectRegistryCacheValue>;
    if (typeof parsed.doId !== "string" || !/^[0-9a-f]{64}$/u.test(parsed.doId)) {
      return null;
    }

    return { doId: parsed.doId };
  } catch {
    return null;
  }
}

function isMemberIdKey(memberId: string): boolean {
  if (!memberIdKeyRegex.test(memberId)) {
    return false;
  }
  const numericMemberId = Number(memberId);
  return Number.isSafeInteger(numericMemberId) && numericMemberId > 0;
}

function addMoney(map: MoneyByMemberId, memberId: string, amount: number): void {
  if (amount === 0) {
    return;
  }

  const nextAmount = (map[memberId] ?? 0) + amount;
  if (nextAmount === 0) {
    delete map[memberId];
    return;
  }
  map[memberId] = nextAmount;
}

function sortMoneyMap(input: MoneyByMemberId): MoneyByMemberId {
  return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => Number(left) - Number(right)),
  );
}
