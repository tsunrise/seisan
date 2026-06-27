import { z } from "zod";

import { normalizeEmail } from "./email";

export const LIMITS_STORE_NAME = "limits";
export const ABSOLUTE_TEXT_LIMIT = 10_000;
export const ABSOLUTE_LIST_LIMIT = 10_000;

const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonNegativeSafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const LEGACY_RECORD_POST_BLOCK_LIMIT_KEY = "automated.block.projects.no_post";

export const Limits = z
  .object({
    "projects.maxLinkedProjects": positiveSafeIntegerSchema,
    "projects.maxOwnedProjects": positiveSafeIntegerSchema,
    "projects.maxMembersPerProject": positiveSafeIntegerSchema,
    "projects.maxProjectNameLength": positiveSafeIntegerSchema.max(ABSOLUTE_TEXT_LIMIT),
    "projects.maxMemberNameLength": positiveSafeIntegerSchema.max(ABSOLUTE_TEXT_LIMIT),
    "projects.maxAclEmails": nonNegativeSafeIntegerSchema.max(ABSOLUTE_LIST_LIMIT),
    "records.allow_post": z.boolean(),
    "records.defaultPageSize": positiveSafeIntegerSchema,
    "records.maxPageSize": positiveSafeIntegerSchema,
    "records.maxRecordsPerOwnedProject": nonNegativeSafeIntegerSchema,
    "records.maxExpenseNameLength": positiveSafeIntegerSchema.max(ABSOLUTE_TEXT_LIMIT),
    "money.maxAmountCents": positiveSafeIntegerSchema,
    "money.maxBalanceCents": positiveSafeIntegerSchema,
  })
  .strict()
  .superRefine((limits, context) => {
    validateFlatRecordsPageSize(limits, context);
  });
export type Limits = z.infer<typeof Limits>;

export const LimitsDocument = z
  .object({
    ...Limits.shape,
  })
  .partial()
  .strict()
  .superRefine((limits, context) => {
    validateFlatRecordsPageSize(limits, context);
  });
export type LimitsDocument = Partial<Limits>;

export type LimitValueType = "integer" | "boolean";
export interface LimitDefinition {
  name: keyof Limits;
  type: LimitValueType;
}

export const LIMIT_DEFINITIONS = [
  { name: "projects.maxLinkedProjects", type: "integer" },
  { name: "projects.maxOwnedProjects", type: "integer" },
  { name: "projects.maxMembersPerProject", type: "integer" },
  { name: "projects.maxProjectNameLength", type: "integer" },
  { name: "projects.maxMemberNameLength", type: "integer" },
  { name: "projects.maxAclEmails", type: "integer" },
  { name: "records.allow_post", type: "boolean" },
  { name: "records.defaultPageSize", type: "integer" },
  { name: "records.maxPageSize", type: "integer" },
  { name: "records.maxRecordsPerOwnedProject", type: "integer" },
  { name: "records.maxExpenseNameLength", type: "integer" },
  { name: "money.maxAmountCents", type: "integer" },
  { name: "money.maxBalanceCents", type: "integer" },
] satisfies readonly LimitDefinition[];

export type LimitsTarget = { type: "default" } | { type: "user"; email: string };

type MoneyMapForLimits = Record<string, number>;

export const BUILTIN_DEFAULT_LIMITS: Limits = {
  "projects.maxLinkedProjects": 1000,
  "projects.maxOwnedProjects": 50,
  "projects.maxMembersPerProject": 1000,
  "projects.maxProjectNameLength": 120,
  "projects.maxMemberNameLength": 100,
  "projects.maxAclEmails": 100,
  "records.allow_post": true,
  "records.defaultPageSize": 50,
  "records.maxPageSize": 1024,
  "records.maxRecordsPerOwnedProject": 100000,
  "records.maxExpenseNameLength": 200,
  "money.maxAmountCents": 100_000_000,
  "money.maxBalanceCents": 100_000_000,
};

export type LimitsResolutionResult =
  | { ok: true; limits: Limits }
  | { ok: false; issues: z.ZodIssue[] };

export function resolveLimits(
  defaultDocument: LimitsDocument = {},
  userDocument: LimitsDocument = {},
): LimitsResolutionResult {
  const parsed = Limits.safeParse({
    ...BUILTIN_DEFAULT_LIMITS,
    ...defaultDocument,
    ...userDocument,
  });
  return parsed.success
    ? { ok: true, limits: parsed.data }
    : { ok: false, issues: parsed.error.issues };
}

export function parseStoredLimitsDocument(value: unknown): LimitsDocument | null {
  const document = LimitsDocument.safeParse(stripLegacyStoredLimitKeys(value));
  return document.success ? document.data : null;
}

function stripLegacyStoredLimitKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const document = value as Record<string, unknown>;
  if (!(LEGACY_RECORD_POST_BLOCK_LIMIT_KEY in document)) {
    return value;
  }

  const withoutLegacy = { ...document };
  delete withoutLegacy[LEGACY_RECORD_POST_BLOCK_LIMIT_KEY];
  return withoutLegacy;
}

export class LimitsKvStore {
  static readonly CACHE_TTL_SECONDS = 5 * 60;
  static readonly DEFAULT_KEY = "limits:default";
  static readonly USER_KEY_PREFIX = "limits:user:";

  private readonly kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  static defaultKey(): string {
    return LimitsKvStore.DEFAULT_KEY;
  }

  static userKey(email: string): string {
    return `${LimitsKvStore.USER_KEY_PREFIX}${normalizeEmail(email)}`;
  }

  static keyForTarget(target: LimitsTarget): string {
    return target.type === "default"
      ? LimitsKvStore.defaultKey()
      : LimitsKvStore.userKey(target.email);
  }

  async load(email?: string | null): Promise<Limits> {
    const normalizedEmail = email ? normalizeEmail(email) : null;
    const [defaultRaw, userRaw] = await Promise.all([
      this.read(LimitsKvStore.defaultKey(), "default"),
      normalizedEmail
        ? this.read(LimitsKvStore.userKey(normalizedEmail), `user:${normalizedEmail}`)
        : Promise.resolve(null),
    ]);

    const defaultDocument = this.parseDocument(defaultRaw, "default") ?? {};
    const userDocument =
      userRaw === null ? {} : (this.parseDocument(userRaw, `user:${normalizedEmail}`) ?? {});

    return this.resolveWithFallback(defaultDocument, userDocument, normalizedEmail);
  }

  async put(target: LimitsTarget, document: LimitsDocument): Promise<void> {
    const parsedDocument = LimitsDocument.parse(document);
    await this.kv.put(LimitsKvStore.keyForTarget(target), JSON.stringify(parsedDocument));
  }

  private async read(key: string, scope: string): Promise<string | null> {
    try {
      return await this.kv.get(key, { cacheTtl: LimitsKvStore.CACHE_TTL_SECONDS });
    } catch (error) {
      console.error("failed to read limit from KV", { scope, error });
      return null;
    }
  }

  private parseDocument(value: string | null, scope: string): LimitsDocument | null {
    if (value === null) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      console.error("invalid limit JSON", { scope, error });
      return null;
    }

    const document = parseStoredLimitsDocument(parsed);
    if (document === null) {
      const strictDocument = LimitsDocument.safeParse(parsed);
      const issues = strictDocument.success ? [] : strictDocument.error.issues;
      console.error("invalid limit document", { scope, issues });
      return null;
    }
    return document;
  }

  private resolveWithFallback(
    defaultDocument: LimitsDocument,
    userDocument: LimitsDocument,
    normalizedEmail: string | null,
  ): Limits {
    const resolved = resolveLimits(defaultDocument, userDocument);
    if (resolved.ok) {
      return resolved.limits;
    }
    console.error("invalid effective user limits", {
      scope: normalizedEmail ? `user:${normalizedEmail}` : "default",
      issues: resolved.issues,
    });

    const withoutUser = resolveLimits(defaultDocument);
    if (withoutUser.ok) {
      return withoutUser.limits;
    }
    console.error("invalid effective default limits", { issues: withoutUser.issues });
    return BUILTIN_DEFAULT_LIMITS;
  }
}

export class LimitsPolicy {
  private readonly limits: Limits;

  constructor(limits: Limits) {
    this.limits = limits;
  }

  maxMemberNameLength(): number {
    return this.limits["projects.maxMemberNameLength"];
  }

  defaultRecordPageSize(): number {
    return this.limits["records.defaultPageSize"];
  }

  /** Controls whether a user may post records. */
  allowsRecordPost(): boolean {
    return this.limits["records.allow_post"];
  }

  /** Limits project display names to `projects.maxProjectNameLength`. */
  allowsProjectName(name: string): boolean {
    return name.length <= this.limits["projects.maxProjectNameLength"];
  }

  /** Limits project member display names to `projects.maxMemberNameLength`. */
  allowsMemberName(name: string): boolean {
    return name.length <= this.limits["projects.maxMemberNameLength"];
  }

  /** Limits the number of emails in a restricted project ACL to `projects.maxAclEmails`. */
  allowsAclEmailCount(count: number): boolean {
    return count <= this.limits["projects.maxAclEmails"];
  }

  /** Limits how many projects a user can be linked to through `projects.maxLinkedProjects`. */
  allowsAdditionalLinkedProject(currentLinkedProjects: number): boolean {
    return this.allowsAdditionalCount(
      currentLinkedProjects,
      this.limits["projects.maxLinkedProjects"],
    );
  }

  /** Limits how many projects a user can own through `projects.maxOwnedProjects`. */
  allowsAdditionalOwnedProject(currentOwnedProjects: number): boolean {
    return this.allowsAdditionalCount(
      currentOwnedProjects,
      this.limits["projects.maxOwnedProjects"],
    );
  }

  /** Limits active members in one project to `projects.maxMembersPerProject`. */
  allowsAdditionalMember(currentActiveMembers: number): boolean {
    return this.allowsAdditionalCount(
      currentActiveMembers,
      this.limits["projects.maxMembersPerProject"],
    );
  }

  /** Limits explicit record page sizes to `records.maxPageSize`. */
  allowsPageLimit(limit: number): boolean {
    return Number.isSafeInteger(limit) && limit >= 1 && limit <= this.limits["records.maxPageSize"];
  }

  /** Limits record count in a project owned by the user whose limits apply to `records.maxRecordsPerOwnedProject`. */
  allowsAdditionalOwnedProjectRecord(currentRecords: number): boolean {
    return this.allowsAdditionalCount(
      currentRecords,
      this.limits["records.maxRecordsPerOwnedProject"],
    );
  }

  /** Limits expense record names to `records.maxExpenseNameLength`. */
  allowsExpenseName(name: string): boolean {
    return name.length <= this.limits["records.maxExpenseNameLength"];
  }

  /** Limits individual money deltas and expense amounts to `money.maxAmountCents`. */
  allowsMoneyAmount(amount: number): boolean {
    return Number.isSafeInteger(amount) && Math.abs(amount) <= this.limits["money.maxAmountCents"];
  }

  /** Limits every amount in a money map to `money.maxAmountCents`. */
  allowsMoneyMap(map: MoneyMapForLimits): boolean {
    return Object.values(map).every((amount) => this.allowsMoneyAmount(amount));
  }

  /** Limits resulting member balances to `money.maxBalanceCents`. */
  allowsBalanceAmount(amount: number): boolean {
    return Number.isSafeInteger(amount) && Math.abs(amount) <= this.limits["money.maxBalanceCents"];
  }

  private allowsAdditionalCount(currentCount: number, limit: number): boolean {
    return Number.isSafeInteger(currentCount) && currentCount >= 0 && currentCount < limit;
  }
}

/**
 * Validates the page-size relationship for flat limits documents.
 *
 * Partial override documents may set either page-size field alone, so the comparison only runs
 * when both leaves are present. Fully resolved limits always include both leaves and use the same
 * validation path.
 */
function validateFlatRecordsPageSize(limits: Partial<Limits>, context: z.RefinementCtx): void {
  if (
    limits["records.defaultPageSize"] !== undefined &&
    limits["records.maxPageSize"] !== undefined &&
    limits["records.defaultPageSize"] > limits["records.maxPageSize"]
  ) {
    context.addIssue({
      code: "custom",
      message: "Default page size must not exceed max page size.",
      path: ["records.defaultPageSize"],
    });
  }
}
