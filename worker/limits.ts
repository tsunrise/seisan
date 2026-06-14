import { z } from "zod";

import { normalizeEmail } from "./email";

export const LIMITS_STORE_NAME = "limits";
export const ABSOLUTE_TEXT_LIMIT = 10_000;
export const ABSOLUTE_LIST_LIMIT = 10_000;

const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonNegativeSafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const ProjectsLimits = z
  .object({
    maxLinkedProjects: positiveSafeIntegerSchema,
    maxOwnedProjects: positiveSafeIntegerSchema,
    maxMembersPerProject: positiveSafeIntegerSchema,
    maxProjectNameLength: positiveSafeIntegerSchema.max(ABSOLUTE_TEXT_LIMIT),
    maxMemberNameLength: positiveSafeIntegerSchema.max(ABSOLUTE_TEXT_LIMIT),
    maxAclEmails: nonNegativeSafeIntegerSchema.max(ABSOLUTE_LIST_LIMIT),
  })
  .strict();
export type ProjectsLimits = z.infer<typeof ProjectsLimits>;

export const RecordsLimits = z
  .object({
    defaultPageSize: positiveSafeIntegerSchema,
    maxPageSize: positiveSafeIntegerSchema,
    maxRecordsPerOwnedProject: nonNegativeSafeIntegerSchema,
    maxExpenseNameLength: positiveSafeIntegerSchema.max(ABSOLUTE_TEXT_LIMIT),
  })
  .strict()
  .superRefine((limits, context) => {
    if (limits.defaultPageSize > limits.maxPageSize) {
      context.addIssue({
        code: "custom",
        message: "Default page size must not exceed max page size.",
        path: ["defaultPageSize"],
      });
    }
  });
export type RecordsLimits = z.infer<typeof RecordsLimits>;

export const MoneyLimits = z
  .object({
    maxAmountCents: positiveSafeIntegerSchema,
    maxBalanceCents: positiveSafeIntegerSchema,
  })
  .strict();
export type MoneyLimits = z.infer<typeof MoneyLimits>;

export const ProductLimits = z
  .object({
    projects: ProjectsLimits,
    records: RecordsLimits,
    money: MoneyLimits,
  })
  .strict();
export type ProductLimits = z.infer<typeof ProductLimits>;

export const LimitsDocument = ProductLimits.partial().strict();
export type LimitsDocument = z.infer<typeof LimitsDocument>;

export type LimitsTarget = { type: "default" } | { type: "user"; email: string };

type LimitsFeature = keyof ProductLimits;
type MoneyMapForLimits = Record<string, number>;

const featureSchemas = {
  projects: ProjectsLimits,
  records: RecordsLimits,
  money: MoneyLimits,
} as const;

export const BUILTIN_DEFAULT_LIMITS: ProductLimits = {
  projects: {
    maxLinkedProjects: 1000,
    maxOwnedProjects: 50,
    maxMembersPerProject: 1000,
    maxProjectNameLength: 120,
    maxMemberNameLength: 100,
    maxAclEmails: 100,
  },
  records: {
    defaultPageSize: 50,
    maxPageSize: 1024,
    maxRecordsPerOwnedProject: 100000,
    maxExpenseNameLength: 200,
  },
  money: {
    maxAmountCents: 100_000_000,
    maxBalanceCents: 100_000_000,
  },
};

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

  async load(email?: string | null): Promise<ProductLimits> {
    const normalizedEmail = email ? normalizeEmail(email) : null;
    const [defaultRaw, userRaw] = await Promise.all([
      this.read(LimitsKvStore.defaultKey(), "default"),
      normalizedEmail
        ? this.read(LimitsKvStore.userKey(normalizedEmail), `user:${normalizedEmail}`)
        : Promise.resolve(null),
    ]);

    const defaultDocument = this.parseDocument(defaultRaw, "default");
    const userDocument =
      userRaw === null ? {} : this.parseDocument(userRaw, `user:${normalizedEmail}`);

    return {
      projects:
        userDocument.projects ?? defaultDocument.projects ?? BUILTIN_DEFAULT_LIMITS.projects,
      records: userDocument.records ?? defaultDocument.records ?? BUILTIN_DEFAULT_LIMITS.records,
      money: userDocument.money ?? defaultDocument.money ?? BUILTIN_DEFAULT_LIMITS.money,
    };
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

  private parseDocument(value: string | null, scope: string): LimitsDocument {
    if (value === null) {
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      console.error("invalid limit JSON", { scope, error });
      return {};
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error("invalid limit document", { scope });
      return {};
    }

    const input = parsed as Record<string, unknown>;
    const document: LimitsDocument = {};
    for (const feature of Object.keys(input)) {
      if (!this.isFeature(feature)) {
        console.error("unknown limit feature", { scope, feature });
        continue;
      }

      const parsedFeature = featureSchemas[feature].safeParse(input[feature]);
      if (!parsedFeature.success) {
        console.error("invalid limit feature", {
          scope,
          feature,
          issues: parsedFeature.error.issues,
        });
        continue;
      }
      this.setFeature(document, feature, parsedFeature.data);
    }

    return document;
  }

  private isFeature(feature: string): feature is LimitsFeature {
    return Object.prototype.hasOwnProperty.call(featureSchemas, feature);
  }

  private setFeature(
    document: LimitsDocument,
    feature: LimitsFeature,
    value: ProductLimits[LimitsFeature],
  ): void {
    if (feature === "projects") {
      document.projects = value as ProjectsLimits;
    } else if (feature === "records") {
      document.records = value as RecordsLimits;
    } else {
      document.money = value as MoneyLimits;
    }
  }
}

export class LimitsPolicy {
  private readonly limits: ProductLimits;

  constructor(limits: ProductLimits) {
    this.limits = limits;
  }

  get projects(): ProjectsLimits {
    return this.limits.projects;
  }

  get records(): RecordsLimits {
    return this.limits.records;
  }

  get money(): MoneyLimits {
    return this.limits.money;
  }

  /** Limits project display names to `projects.maxProjectNameLength`. */
  allowsProjectName(name: string): boolean {
    return name.length <= this.projects.maxProjectNameLength;
  }

  /** Limits project member display names to `projects.maxMemberNameLength`. */
  allowsMemberName(name: string): boolean {
    return name.length <= this.projects.maxMemberNameLength;
  }

  /** Limits the number of emails in a restricted project ACL to `projects.maxAclEmails`. */
  allowsAclEmailCount(count: number): boolean {
    return count <= this.projects.maxAclEmails;
  }

  /** Limits how many projects a user can be linked to through `projects.maxLinkedProjects`. */
  allowsAdditionalLinkedProject(currentLinkedProjects: number): boolean {
    return this.allowsAdditionalCount(currentLinkedProjects, this.projects.maxLinkedProjects);
  }

  /** Limits how many projects a user can own through `projects.maxOwnedProjects`. */
  allowsAdditionalOwnedProject(currentOwnedProjects: number): boolean {
    return this.allowsAdditionalCount(currentOwnedProjects, this.projects.maxOwnedProjects);
  }

  /** Limits active members in one project to `projects.maxMembersPerProject`. */
  allowsAdditionalMember(currentActiveMembers: number): boolean {
    return this.allowsAdditionalCount(currentActiveMembers, this.projects.maxMembersPerProject);
  }

  /** Limits explicit record page sizes to `records.maxPageSize`. */
  allowsPageLimit(limit: number): boolean {
    return Number.isSafeInteger(limit) && limit >= 1 && limit <= this.records.maxPageSize;
  }

  /** Limits record count in a project owned by the user whose limits apply to `records.maxRecordsPerOwnedProject`. */
  allowsAdditionalOwnedProjectRecord(currentRecords: number): boolean {
    return this.allowsAdditionalCount(currentRecords, this.records.maxRecordsPerOwnedProject);
  }

  /** Limits expense record names to `records.maxExpenseNameLength`. */
  allowsExpenseName(name: string): boolean {
    return name.length <= this.records.maxExpenseNameLength;
  }

  /** Limits individual money deltas and expense amounts to `money.maxAmountCents`. */
  allowsMoneyAmount(amount: number): boolean {
    return Number.isSafeInteger(amount) && Math.abs(amount) <= this.money.maxAmountCents;
  }

  /** Limits every amount in a money map to `money.maxAmountCents`. */
  allowsMoneyMap(map: MoneyMapForLimits): boolean {
    return Object.values(map).every((amount) => this.allowsMoneyAmount(amount));
  }

  /** Limits resulting member balances to `money.maxBalanceCents`. */
  allowsBalanceAmount(amount: number): boolean {
    return Number.isSafeInteger(amount) && Math.abs(amount) <= this.money.maxBalanceCents;
  }

  private allowsAdditionalCount(currentCount: number, limit: number): boolean {
    return Number.isSafeInteger(currentCount) && currentCount >= 0 && currentCount < limit;
  }
}
