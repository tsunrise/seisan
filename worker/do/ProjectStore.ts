import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { normalizeEmail, normalizedEmailSchema } from "../email";
import {
  PROJECTS_REGISTRY_NAME,
  PROJECT_SUMMARY_SYNC_DELAY_MS,
  MoneyByMemberIdUtils,
  ProjectNameUtils,
  ProjectId,
  ProjectEmailsUtils,
  type ProjectAcl,
  type ProjectAclType,
  type ProjectJoin,
  type ProjectMember,
  type ProjectMemberPatch,
  type ProjectRecord,
  type ProjectSummary,
  type RecordDescription,
  type MoneyByMemberId,
} from "../project";
import {
  ABSOLUTE_LIST_LIMIT,
  BUILTIN_DEFAULT_LIMITS,
  LimitsKvStore,
  LimitsPolicy,
} from "../limits";
import { LazyRefresh } from "../utils/auto_update";
import { runSqlMigrations } from "./migrations";
import type { ProjectSummarySyncInput } from "./ProjectsRegistry";
import { projectStoreMigrations } from "./migrations/ProjectStore.migration";

const ProjectMetadata = z.object({
  public_id: ProjectId.nullable(),
  name: z.string().min(1),
  owner_email: normalizedEmailSchema,
  acl_type: z.enum(["public", "restricted"]),
  acl_allowed_list: z
    .array(normalizedEmailSchema)
    .max(ABSOLUTE_LIST_LIMIT)
    .transform(ProjectEmailsUtils.uniqueSorted),
  next_record_id: z.number().int().positive(),
  next_member_id: z.number().int().positive(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
});
type ProjectMetadata = z.infer<typeof ProjectMetadata>;

interface MemberRow extends Record<string, SqlStorageValue> {
  id: number;
  name: string;
  normalized_name: string;
  linked_email: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

interface RecordRow extends Record<string, SqlStorageValue> {
  id: number;
  author_member_id: number;
  description_type: string;
  description_json: string;
  delta_json: string;
  reverts_record_id: number | null;
  created_at: number;
}

interface RecordResponseRow extends RecordRow {
  reverted_record_id: number | null;
  reverted_author_member_id: number | null;
  reverted_created_at: number | null;
}

interface BalanceRow extends Record<string, SqlStorageValue> {
  member_id: number;
  amount_cents: number;
}

interface ActiveMemberIdRow extends Record<string, SqlStorageValue> {
  id: number;
}

interface ActiveLinkedMemberRow extends Record<string, SqlStorageValue> {
  id: number;
}

const INITIALIZED_KEY = "initialized";
const PROJECT_METADATA_KEY = "projectMetadata";
const OWNER_LIMITS_POLICY_TTL_SECONDS = 10;

type ProjectStoreError =
  | "uninitialized"
  | "forbidden"
  | "invalid_input"
  | "invalid_record"
  | "not_found"
  | "already_reverted"
  | "already_linked"
  | "already_deleted"
  | "nonzero_balance"
  | "project_limit_exceeded"
  | "member_limit_exceeded"
  | "record_limit_exceeded"
  | "acl_limit_exceeded"
  | "money_limit_exceeded";

export class ProjectStore extends DurableObject<Env> {
  static readonly migrations = projectStoreMigrations;

  private initialized = false;
  private readonly bindings: Env;
  private projectMetadata: ProjectMetadata | null = null;
  private ownerLimitsPolicy: LazyRefresh<LimitsPolicy> | null = null;
  private ownerLimitsPolicyEmail: string | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.bindings = env;
    state.blockConcurrencyWhile(async () => {
      await runSqlMigrations(state, ProjectStore.migrations);
      this.initialized = (await state.storage.get<boolean>(INITIALIZED_KEY)) === true;
      if (this.initialized) {
        this.projectMetadata = this.readProjectMetadata();
        if (!this.projectMetadata) {
          this.initialized = false;
        }
      }
    });
  }

  async initialize(input: {
    publicId: string;
    name: string;
    acl: ProjectAcl;
    ownerEmail: string;
    ownerMemberName?: string;
    nowMs: number;
  }): Promise<
    | { ok: true; members: ProjectMember[] }
    | {
        ok: false;
        error:
          | "already_initialized"
          | "invalid_input"
          | "project_limit_exceeded"
          | "member_limit_exceeded"
          | "acl_limit_exceeded";
      }
  > {
    if (this.initialized) {
      return { ok: false, error: "already_initialized" };
    }

    const parsedPublicId = ProjectId.safeParse(input.publicId);
    const parsedOwnerEmail = normalizeProjectEmail(input.ownerEmail);
    if (!parsedPublicId.success || !parsedOwnerEmail) {
      return { ok: false, error: "invalid_input" };
    }

    const policy = new LimitsPolicy(
      await new LimitsKvStore(this.bindings.CONFIGS).load(parsedOwnerEmail),
    );
    if (this.initialized) {
      return { ok: false, error: "already_initialized" };
    }

    const acl =
      input.acl.type === "restricted"
        ? { type: "restricted" as const, emails: ProjectEmailsUtils.uniqueSorted(input.acl.emails) }
        : input.acl;
    const name = ProjectNameUtils.normalizeProject(input.name);
    const ownerMemberName = ProjectNameUtils.normalizeMember(
      input.ownerMemberName ??
        ProjectStore.defaultMemberNameForEmail(input.ownerEmail, policy.maxMemberNameLength()),
    );
    if (!policy.allowsProjectName(name)) {
      return { ok: false, error: "project_limit_exceeded" };
    }
    if (!policy.allowsMemberName(ownerMemberName)) {
      return { ok: false, error: "member_limit_exceeded" };
    }
    if (acl.type === "restricted" && !policy.allowsAclEmailCount(acl.emails.length)) {
      return { ok: false, error: "acl_limit_exceeded" };
    }

    const metadata: ProjectMetadata = {
      public_id: parsedPublicId.data,
      name,
      owner_email: parsedOwnerEmail,
      acl_type: acl.type,
      acl_allowed_list: acl.type === "restricted" ? acl.emails : [],
      next_record_id: 1,
      next_member_id: 2,
      created_at: input.nowMs,
      updated_at: input.nowMs,
    };

    const members = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM balances");
      this.ctx.storage.sql.exec("DELETE FROM records");
      this.ctx.storage.sql.exec("DELETE FROM members");

      this.insertMember({
        id: 1,
        name: ownerMemberName,
        linkedEmail: parsedOwnerEmail,
        nowMs: input.nowMs,
      });
      return this.getMembersForResponse({ includeLinkedEmails: true });
    });

    this.saveProjectMetadata(metadata);
    this.ctx.storage.kv.put(INITIALIZED_KEY, true);
    this.initialized = true;
    this.queueProjectSummarySync();
    return {
      ok: true,
      members,
    };
  }

  async postRecord(input: {
    callerEmail: string;
    delta: Record<string, number>;
    description: RecordDescription;
    nowMs: number;
  }): Promise<
    | { ok: true; id: number }
    | {
        ok: false;
        error:
          | "uninitialized"
          | "forbidden"
          | "invalid_record"
          | "not_found"
          | "already_reverted"
          | "record_limit_exceeded"
          | "money_limit_exceeded";
      }
  > {
    const policy = await this.loadOwnerLimitsPolicy();

    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }
    if (!metadata.email) {
      return { ok: false, error: "forbidden" };
    }

    const authorMember = this.getActiveLinkedMember(metadata.email);
    if (!authorMember) {
      return { ok: false, error: "forbidden" };
    }

    let description: RecordDescription;
    let delta: MoneyByMemberId;
    try {
      if (ProjectStore.hasOversizedRecordMoneyMap(input.delta, input.description)) {
        return { ok: false, error: "invalid_record" };
      }
      description = ProjectStore.normalizeRecordDescription(input.description);
      delta = MoneyByMemberIdUtils.normalize(input.delta);
    } catch {
      return { ok: false, error: "invalid_record" };
    }

    const limitExceededError = this.getDescriptionLimitExceededError(description, policy);
    if (limitExceededError) {
      return { ok: false, error: limitExceededError };
    }
    if (!policy.allowsMoneyMap(delta)) {
      return { ok: false, error: "money_limit_exceeded" };
    }
    if (!policy.allowsAdditionalOwnedProjectRecord(this.countRecords())) {
      return { ok: false, error: "record_limit_exceeded" };
    }

    const resolvedDelta = this.resolveDelta(description);
    if (!resolvedDelta.ok) {
      return resolvedDelta;
    }
    if (ProjectStore.hasOversizedMoneyMap(resolvedDelta.delta)) {
      return { ok: false, error: "invalid_record" };
    }

    if (
      !MoneyByMemberIdUtils.equals(delta, resolvedDelta.delta) ||
      MoneyByMemberIdUtils.sum(resolvedDelta.delta) !== 0
    ) {
      return { ok: false, error: "invalid_record" };
    }

    // Require every member referenced by either the description or delta to be active.
    const referencedMemberIds = new Set<number>();
    for (const memberId of MoneyByMemberIdUtils.members(resolvedDelta.delta)) {
      referencedMemberIds.add(Number(memberId));
    }
    if (description.type === "expense") {
      for (const memberId of MoneyByMemberIdUtils.members(description.paid)) {
        referencedMemberIds.add(Number(memberId));
      }
      for (const memberId of MoneyByMemberIdUtils.members(description.liability)) {
        referencedMemberIds.add(Number(memberId));
      }
    }
    if (description.type === "transfer") {
      referencedMemberIds.add(description.from);
      referencedMemberIds.add(description.to);
    }
    if (referencedMemberIds.size > 0) {
      const activeMemberIds = this.getActiveMemberIds();
      for (const memberId of referencedMemberIds) {
        if (!activeMemberIds.has(memberId)) {
          return { ok: false, error: "invalid_record" };
        }
      }
    }

    if (!this.canApplyBalanceDelta(resolvedDelta.delta, policy)) {
      return { ok: false, error: "money_limit_exceeded" };
    }

    const id = this.getNextRecordId(metadata.meta);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO records
          (id, author_member_id, description_type, description_json, delta_json, reverts_record_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        authorMember.id,
        description.type,
        JSON.stringify(description),
        JSON.stringify(resolvedDelta.delta),
        description.type === "revert" ? description.id : null,
        input.nowMs,
      );

      this.applyBalanceDelta(resolvedDelta.delta);
    });
    this.saveProjectMetadata({
      ...metadata.meta,
      next_record_id: id + 1,
      updated_at: input.nowMs,
    });

    this.queueProjectSummarySync();
    return { ok: true, id };
  }

  // Return the biggest `limit` ids smaller than offset
  getRecords(input: {
    publicId?: string;
    callerEmail?: string | null;
    limit: number;
    offset: number;
  }):
    | {
        ok: true;
        name: string;
        owner: string;
        acl: ProjectAcl;
        members: ProjectMember[];
        records: ProjectRecord[];
        balance: Record<string, number>;
        updatedAt: number;
      }
    | { ok: false; error: "uninitialized" | "forbidden" } {
    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }
    const meta = this.persistPublicIdIfMissing(metadata.meta, input.publicId);

    const limit = input.limit;
    const offset = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.floor(input.offset)));
    const records = this.ctx.storage.sql
      .exec<RecordResponseRow>(
        `SELECT
            record.id,
            record.author_member_id,
            record.description_type,
            record.description_json,
            record.delta_json,
            record.reverts_record_id,
            record.created_at,
            reverter.id AS reverted_record_id,
            reverter.author_member_id AS reverted_author_member_id,
            reverter.created_at AS reverted_created_at
         FROM records AS record
         LEFT JOIN records AS reverter ON reverter.reverts_record_id = record.id
         WHERE record.id < ?
         ORDER BY record.id DESC
         LIMIT ?`,
        offset,
        limit,
      )
      .toArray()
      .map(recordFromResponseRow);

    const balance = Object.fromEntries(
      this.ctx.storage.sql
        .exec<BalanceRow>("SELECT member_id, amount_cents FROM balances ORDER BY member_id")
        .toArray()
        .map((row) => [String(row.member_id), row.amount_cents]),
    );

    return {
      ok: true,
      name: meta.name,
      owner: meta.owner_email,
      acl: this.getAcl(meta),
      members: this.getMembersForResponse({ includeLinkedEmails: metadata.email !== null }),
      records,
      balance,
      updatedAt: meta.updated_at,
    };
  }

  getProjectBalance(input: {
    callerEmail: string;
    publicId: string;
  }): { ok: true; project: ProjectSummary } | { ok: false; error: "uninitialized" | "forbidden" } {
    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }
    const meta = this.persistPublicIdIfMissing(metadata.meta, input.publicId);
    if (!metadata.email) {
      return { ok: false, error: "forbidden" };
    }

    const requesterMember = this.getLinkedMember(metadata.email);
    if (!metadata.isOwner && !requesterMember) {
      return { ok: false, error: "forbidden" };
    }

    const balance = requesterMember
      ? (this.ctx.storage.sql
          .exec<BalanceRow>(
            "SELECT amount_cents FROM balances WHERE member_id = ?",
            requesterMember.id,
          )
          .toArray()[0]?.amount_cents ?? 0)
      : null;

    return {
      ok: true,
      project: {
        id: input.publicId,
        name: meta.name,
        owner: meta.owner_email,
        member: requesterMember
          ? memberForResponse(requesterMember, { includeLinkedEmails: true })
          : null,
        balance,
        updatedAt: meta.updated_at,
      },
    };
  }

  async renameProject(input: {
    callerEmail: string;
    name: string;
    nowMs: number;
  }): Promise<
    | { ok: true; name: string }
    | { ok: false; error: "uninitialized" | "forbidden" | "project_limit_exceeded" }
  > {
    const policy = await this.loadOwnerLimitsPolicy();

    const ownerAccess = this.getOwnerAccess(input.callerEmail);
    if (!ownerAccess.ok) {
      return ownerAccess;
    }

    const name = ProjectNameUtils.normalizeProject(input.name);
    if (!policy.allowsProjectName(name)) {
      return { ok: false, error: "project_limit_exceeded" };
    }

    this.saveProjectMetadata({
      ...ownerAccess.meta,
      name,
      updated_at: input.nowMs,
    });
    this.queueProjectSummarySync();
    return { ok: true, name };
  }

  async createMember(input: {
    callerEmail: string;
    name: string;
    nowMs: number;
  }): Promise<{ ok: true; member: ProjectMember } | { ok: false; error: ProjectStoreError }> {
    const policy = await this.loadOwnerLimitsPolicy();

    // initialization checked in `getProjectMetadata`
    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }
    if (!metadata.isOwner) {
      return { ok: false, error: "forbidden" };
    }

    const name = ProjectNameUtils.normalizeMember(input.name);
    if (!policy.allowsMemberName(name)) {
      return { ok: false, error: "member_limit_exceeded" };
    }
    if (this.hasActiveMemberName(name)) {
      return { ok: false, error: "invalid_input" };
    }
    if (!policy.allowsAdditionalMember(this.countActiveMembers())) {
      return { ok: false, error: "member_limit_exceeded" };
    }

    const member = this.createNextMember({
      name,
      linkedEmail: null,
      nowMs: input.nowMs,
    });
    if (!member) {
      return { ok: false, error: "uninitialized" };
    }
    this.queueProjectSummarySync();
    return { ok: true, member: memberForResponse(member, { includeLinkedEmails: true }) };
  }

  async joinProject(input: {
    callerEmail: string;
    join: ProjectJoin;
    nowMs: number;
  }): Promise<{ ok: true; member: ProjectMember } | { ok: false; error: ProjectStoreError }> {
    const policy = await this.loadOwnerLimitsPolicy();

    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }
    if (!metadata.email) {
      return { ok: false, error: "forbidden" };
    }

    if (this.getLinkedMember(metadata.email)) {
      return { ok: false, error: "already_linked" };
    }

    if ("memberId" in input.join) {
      // claim unlinked member
      const member = this.getMember(input.join.memberId);
      if (!member || member.deleted_at !== null) {
        return { ok: false, error: "not_found" };
      }
      if (member.linked_email !== null) {
        return { ok: false, error: "already_linked" };
      }
      this.ctx.storage.sql.exec(
        "UPDATE members SET linked_email = ?, updated_at = ? WHERE id = ?",
        metadata.email,
        input.nowMs,
        member.id,
      );
      this.queueProjectSummarySync();
      return {
        ok: true,
        member: memberForResponse(
          { ...member, linked_email: metadata.email },
          { includeLinkedEmails: true },
        ),
      };
    }

    // create new member
    const name = ProjectNameUtils.normalizeMember(input.join.name);
    if (!policy.allowsMemberName(name)) {
      return { ok: false, error: "member_limit_exceeded" };
    }
    if (this.hasActiveMemberName(name)) {
      return { ok: false, error: "invalid_input" };
    }
    if (!policy.allowsAdditionalMember(this.countActiveMembers())) {
      return { ok: false, error: "member_limit_exceeded" };
    }

    const member = this.createNextMember({
      name,
      linkedEmail: metadata.email,
      nowMs: input.nowMs,
    });
    if (!member) {
      return { ok: false, error: "uninitialized" };
    }
    this.queueProjectSummarySync();
    return { ok: true, member: memberForResponse(member, { includeLinkedEmails: true }) };
  }

  leaveProject(input: {
    callerEmail: string;
    nowMs: number;
  }): { ok: true; removedLinkedEmail: string } | { ok: false; error: ProjectStoreError } {
    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }
    if (!metadata.email) {
      return { ok: false, error: "forbidden" };
    }
    if (metadata.isOwner) {
      return { ok: false, error: "forbidden" };
    }

    const member = this.getLinkedMember(metadata.email);
    if (!member) {
      return { ok: false, error: "forbidden" };
    }

    this.ctx.storage.sql.exec(
      "UPDATE members SET linked_email = NULL, updated_at = ? WHERE id = ?",
      input.nowMs,
      member.id,
    );
    this.queueProjectSummarySync();
    return { ok: true, removedLinkedEmail: metadata.email };
  }

  async patchMember(input: {
    callerEmail: string;
    memberId: number;
    patch: ProjectMemberPatch;
    nowMs: number;
  }): Promise<
    | { ok: true; member: ProjectMember; removedLinkedEmail?: string }
    | { ok: false; error: ProjectStoreError }
  > {
    const policy = "name" in input.patch ? await this.loadOwnerLimitsPolicy() : null;

    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }

    const member = this.getMember(input.memberId);
    if (!member) {
      return { ok: false, error: "not_found" };
    }
    if (member.deleted_at !== null) {
      return { ok: false, error: "already_deleted" };
    }

    const requesterOwnsMember = member.linked_email === metadata.email;
    if (!metadata.isOwner && !requesterOwnsMember) {
      return { ok: false, error: "forbidden" };
    }

    let nextMember = member;
    if ("name" in input.patch) {
      const name = ProjectNameUtils.normalizeMember(input.patch.name);
      const normalizedName = ProjectStore.normalizeMemberNameForUnique(name);
      if (!policy?.allowsMemberName(name)) {
        return { ok: false, error: "member_limit_exceeded" };
      }
      if (this.hasActiveMemberName(name, member.id)) {
        return { ok: false, error: "invalid_input" };
      }
      this.ctx.storage.sql.exec(
        "UPDATE members SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?",
        name,
        normalizedName,
        input.nowMs,
        member.id,
      );
      nextMember = { ...nextMember, name, normalized_name: normalizedName };
    }

    let removedLinkedEmail: string | undefined;
    if ("email" in input.patch) {
      if (input.patch.email !== "") {
        return { ok: false, error: "invalid_input" };
      }
      if (member.linked_email === metadata.meta.owner_email) {
        return { ok: false, error: "forbidden" };
      }
      this.ctx.storage.sql.exec(
        "UPDATE members SET linked_email = NULL, updated_at = ? WHERE id = ?",
        input.nowMs,
        member.id,
      );
      removedLinkedEmail = member.linked_email ?? undefined;
      nextMember = { ...nextMember, linked_email: null };
    }

    this.queueProjectSummarySync();
    return {
      ok: true,
      member: memberForResponse(nextMember, { includeLinkedEmails: true }),
      ...(removedLinkedEmail ? { removedLinkedEmail } : {}),
    };
  }

  deleteMember(input: {
    callerEmail: string;
    memberId: number;
    nowMs: number;
  }): { ok: true; removedLinkedEmail?: string } | { ok: false; error: ProjectStoreError } {
    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }
    if (!metadata.isOwner) {
      return { ok: false, error: "forbidden" };
    }

    const member = this.getMember(input.memberId);
    if (!member) {
      return { ok: false, error: "not_found" };
    }
    if (member.deleted_at !== null) {
      return { ok: false, error: "already_deleted" };
    }
    if (member.linked_email === metadata.meta.owner_email) {
      return { ok: false, error: "forbidden" };
    }

    const balance = this.ctx.storage.sql
      .exec<BalanceRow>("SELECT amount_cents FROM balances WHERE member_id = ?", member.id)
      .toArray()[0];
    if (balance && balance.amount_cents !== 0) {
      return { ok: false, error: "nonzero_balance" };
    }

    this.ctx.storage.sql.exec(
      "UPDATE members SET linked_email = NULL, deleted_at = ?, updated_at = ? WHERE id = ?",
      input.nowMs,
      input.nowMs,
      member.id,
    );
    this.queueProjectSummarySync();
    return {
      ok: true,
      ...(member.linked_email ? { removedLinkedEmail: member.linked_email } : {}),
    };
  }

  unlinkMemberEmail(input: {
    callerEmail: string;
    email: string;
    nowMs: number;
  }): { ok: true; removedLinkedEmail: string } | { ok: false; error: ProjectStoreError } {
    const ownerAccess = this.getOwnerAccess(input.callerEmail);
    if (!ownerAccess.ok) {
      return ownerAccess;
    }

    const email = normalizeProjectEmail(input.email);
    if (!email) {
      return { ok: false, error: "invalid_input" };
    }
    if (email === ownerAccess.meta.owner_email) {
      return { ok: false, error: "forbidden" };
    }

    const member = this.getLinkedMember(email);
    if (!member) {
      return { ok: false, error: "not_found" };
    }

    this.ctx.storage.sql.exec(
      "UPDATE members SET linked_email = NULL, updated_at = ? WHERE id = ?",
      input.nowMs,
      member.id,
    );
    this.queueProjectSummarySync();
    return { ok: true, removedLinkedEmail: email };
  }

  async appendEmailsToAcl(input: {
    callerEmail: string;
    emails: string[];
  }): Promise<{ ok: true } | { ok: false; error: ProjectStoreError }> {
    const policy = await this.loadOwnerLimitsPolicy();

    const ownerAccess = this.getOwnerAccess(input.callerEmail);
    if (!ownerAccess.ok) {
      return ownerAccess;
    }

    if (input.emails.length === 0) {
      return { ok: false, error: "invalid_input" };
    }
    const emails = ProjectEmailsUtils.uniqueSorted(input.emails);

    if (!policy.allowsAclEmailCount(this.countAclEmailsAfterAppend(ownerAccess.meta, emails))) {
      return { ok: false, error: "acl_limit_exceeded" };
    }

    this.saveProjectMetadata({
      ...ownerAccess.meta,
      acl_allowed_list: ProjectEmailsUtils.uniqueSorted([
        ...ownerAccess.meta.acl_allowed_list,
        ...emails,
      ]),
      updated_at: Date.now(),
    });
    this.queueProjectSummarySync();
    return { ok: true };
  }

  removeEmailsFromAcl(input: {
    callerEmail: string;
    emails: string[];
  }): { ok: true } | { ok: false; error: "uninitialized" | "forbidden" | "invalid_input" } {
    const ownerAccess = this.getOwnerAccess(input.callerEmail);
    if (!ownerAccess.ok) {
      return ownerAccess;
    }

    if (input.emails.length === 0) {
      return { ok: false, error: "invalid_input" };
    }
    const emails = ProjectEmailsUtils.uniqueSorted(input.emails);

    const removedEmails = new Set(emails);
    this.saveProjectMetadata({
      ...ownerAccess.meta,
      acl_allowed_list: ownerAccess.meta.acl_allowed_list.filter(
        (email) => !removedEmails.has(email),
      ),
      updated_at: Date.now(),
    });
    this.queueProjectSummarySync();
    return { ok: true };
  }

  setAclType(input: {
    callerEmail: string;
    type: ProjectAclType;
  }): { ok: true } | { ok: false; error: "uninitialized" | "forbidden" | "invalid_input" } {
    const ownerAccess = this.getOwnerAccess(input.callerEmail);
    if (!ownerAccess.ok) {
      return ownerAccess;
    }

    if (input.type !== "public" && input.type !== "restricted") {
      return { ok: false, error: "invalid_input" };
    }

    this.saveProjectMetadata({
      ...ownerAccess.meta,
      acl_type: input.type,
      updated_at: Date.now(),
    });
    this.queueProjectSummarySync();
    return { ok: true };
  }

  async alarm(): Promise<void> {
    const synced = await this.sendSummaryToRegistry();
    if (!synced.ok) {
      console.error("failed to sync project summary", { error: synced.error });
    }
  }

  async sendSummaryToRegistry(input: { publicId?: string } = {}): Promise<
    | { ok: true }
    | {
        ok: false;
        error: "uninitialized" | "missing_public_id" | "invalid_input" | "not_found";
      }
  > {
    if (!this.initialized) {
      return { ok: false, error: "uninitialized" };
    }

    const meta = this.getMeta();
    if (!meta) {
      this.initialized = false;
      return { ok: false, error: "uninitialized" };
    }
    let nextMeta = meta;
    if (input.publicId) {
      const parsed = ProjectId.safeParse(input.publicId);
      if (!parsed.success) {
        return { ok: false, error: "invalid_input" };
      }
      nextMeta = this.persistPublicIdIfMissing(nextMeta, parsed.data);
    }

    const summary = this.buildProjectSummarySync(nextMeta, Date.now());
    if (!summary) {
      return { ok: false, error: "missing_public_id" };
    }

    const synced =
      await this.bindings.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME).syncProjectSummary(
        summary,
      );
    if (!synced.ok) {
      return synced;
    }
    return { ok: true };
  }

  private readProjectMetadata(): ProjectMetadata | null {
    const raw = this.ctx.storage.kv.get<string>(PROJECT_METADATA_KEY);
    if (typeof raw !== "string") {
      return null;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return null;
    }

    const parsed = ProjectMetadata.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  }

  private saveProjectMetadata(metadata: ProjectMetadata): ProjectMetadata {
    const parsed = ProjectMetadata.safeParse(metadata);
    if (!parsed.success) {
      throw new Error("invalid project metadata");
    }

    this.ctx.storage.kv.put(PROJECT_METADATA_KEY, JSON.stringify(parsed.data));
    this.projectMetadata = parsed.data;
    return parsed.data;
  }

  private async loadOwnerLimitsPolicy(): Promise<LimitsPolicy> {
    const ownerEmail = this.getMeta()?.owner_email;
    if (!ownerEmail) {
      return new LimitsPolicy(BUILTIN_DEFAULT_LIMITS);
    }

    if (!this.ownerLimitsPolicy || this.ownerLimitsPolicyEmail !== ownerEmail) {
      const limits = new LimitsKvStore(this.bindings.CONFIGS);
      this.ownerLimitsPolicyEmail = ownerEmail;
      this.ownerLimitsPolicy = new LazyRefresh(
        async () => new LimitsPolicy(await limits.load(ownerEmail)),
        OWNER_LIMITS_POLICY_TTL_SECONDS,
        this.ctx,
      );
    }

    return this.ownerLimitsPolicy.value();
  }

  private getDescriptionLimitExceededError(
    description: RecordDescription,
    policy: LimitsPolicy,
  ): "record_limit_exceeded" | "money_limit_exceeded" | null {
    if (description.type === "expense") {
      if (!policy.allowsExpenseName(description.name)) {
        return "record_limit_exceeded";
      }
      if (
        !policy.allowsMoneyMap(description.paid) ||
        !policy.allowsMoneyMap(description.liability)
      ) {
        return "money_limit_exceeded";
      }
      return null;
    }
    if (description.type === "transfer") {
      return policy.allowsMoneyAmount(description.amount) ? null : "money_limit_exceeded";
    }
    return null;
  }

  private getProjectMetadata(
    callerEmail: string | null | undefined,
  ):
    | { ok: true; email: string | null; isOwner: boolean; meta: ProjectMetadata }
    | { ok: false; error: "uninitialized" | "forbidden" } {
    if (!this.initialized) {
      return { ok: false, error: "uninitialized" };
    }

    const meta = this.getMeta();
    if (!meta) {
      this.initialized = false;
      return { ok: false, error: "uninitialized" };
    }

    const email = callerEmail ? normalizeEmail(callerEmail) : null;
    const isOwner = email === meta.owner_email;
    if (!this.isAuthorized(email, isOwner, meta)) {
      return { ok: false, error: "forbidden" };
    }
    return { ok: true, email, isOwner, meta };
  }

  private getOwnerAccess(
    callerEmail: string,
  ):
    | { ok: true; email: string; meta: ProjectMetadata }
    | { ok: false; error: "uninitialized" | "forbidden" } {
    if (!this.initialized) {
      return { ok: false, error: "uninitialized" };
    }

    const meta = this.getMeta();
    if (!meta) {
      this.initialized = false;
      return { ok: false, error: "uninitialized" };
    }

    const email = normalizeEmail(callerEmail);
    if (email !== meta.owner_email) {
      return { ok: false, error: "forbidden" };
    }
    return { ok: true, email, meta };
  }

  private getMeta(): ProjectMetadata | null {
    return this.projectMetadata;
  }

  private getAcl(meta: ProjectMetadata): ProjectAcl {
    if (meta.acl_type === "public") {
      return { type: "public" };
    }

    return { type: "restricted", emails: meta.acl_allowed_list };
  }

  private isAuthorized(email: string | null, isOwner: boolean, meta: ProjectMetadata): boolean {
    if (meta.acl_type === "public" || isOwner) {
      return true;
    }
    if (!email) {
      return false;
    }
    if (this.hasActiveLinkedMember(email)) {
      return true;
    }

    return meta.acl_allowed_list.includes(email);
  }

  private getMember(memberId: number): MemberRow | null {
    return (
      this.ctx.storage.sql
        .exec<MemberRow>(
          `SELECT id, name, normalized_name, linked_email, deleted_at, created_at, updated_at
           FROM members
           WHERE id = ?`,
          memberId,
        )
        .toArray()[0] ?? null
    );
  }

  private getLinkedMember(email: string): MemberRow | null {
    return (
      this.ctx.storage.sql
        .exec<MemberRow>(
          `SELECT id, name, normalized_name, linked_email, deleted_at, created_at, updated_at
           FROM members
           WHERE linked_email = ?`,
          email,
        )
        .toArray()[0] ?? null
    );
  }

  private getActiveLinkedMember(email: string): MemberRow | null {
    return (
      this.ctx.storage.sql
        .exec<MemberRow>(
          `SELECT id, name, normalized_name, linked_email, deleted_at, created_at, updated_at
           FROM members
           WHERE linked_email = ? AND deleted_at IS NULL`,
          email,
        )
        .toArray()[0] ?? null
    );
  }

  private hasActiveLinkedMember(email: string): boolean {
    return (
      this.ctx.storage.sql
        .exec<ActiveLinkedMemberRow>(
          `SELECT id
           FROM members
           WHERE linked_email = ? AND deleted_at IS NULL
           LIMIT 1`,
          email,
        )
        .toArray()[0] !== undefined
    );
  }

  private getActiveMemberIds(): Set<number> {
    return new Set(
      this.ctx.storage.sql
        .exec<ActiveMemberIdRow>("SELECT id FROM members WHERE deleted_at IS NULL")
        .toArray()
        .map((row) => row.id),
    );
  }

  private getMembersForResponse(options: { includeLinkedEmails: boolean }): ProjectMember[] {
    return this.ctx.storage.sql
      .exec<MemberRow>(
        `SELECT id, name, normalized_name, linked_email, deleted_at, created_at, updated_at
         FROM members
         ORDER BY id`,
      )
      .toArray()
      .map((member) => memberForResponse(member, options));
  }

  private hasActiveMemberName(name: string, exceptMemberId?: number): boolean {
    const normalizedName = ProjectStore.normalizeMemberNameForUnique(name);
    const rows =
      exceptMemberId === undefined
        ? this.ctx.storage.sql
            .exec<MemberRow>(
              "SELECT id FROM members WHERE normalized_name = ? AND deleted_at IS NULL",
              normalizedName,
            )
            .toArray()
        : this.ctx.storage.sql
            .exec<MemberRow>(
              "SELECT id FROM members WHERE normalized_name = ? AND deleted_at IS NULL AND id != ?",
              normalizedName,
              exceptMemberId,
            )
            .toArray();
    return rows[0] !== undefined;
  }

  private countActiveMembers(): number {
    return (
      this.ctx.storage.sql
        .exec<
          { count: number } & Record<string, SqlStorageValue>
        >("SELECT COUNT(*) AS count FROM members WHERE deleted_at IS NULL")
        .toArray()[0]?.count ?? 0
    );
  }

  private countRecords(): number {
    return (
      this.ctx.storage.sql
        .exec<
          { count: number } & Record<string, SqlStorageValue>
        >("SELECT COUNT(*) AS count FROM records")
        .toArray()[0]?.count ?? 0
    );
  }

  private countAclEmailsAfterAppend(meta: ProjectMetadata, emails: string[]): number {
    const allEmails = new Set(meta.acl_allowed_list);
    for (const email of emails) {
      allEmails.add(email);
    }
    return allEmails.size;
  }

  private getNextRecordId(meta: ProjectMetadata): number {
    return Math.max(meta.next_record_id, this.getMaxRecordId() + 1);
  }

  private getNextMemberId(meta: ProjectMetadata): number {
    return Math.max(meta.next_member_id, this.getMaxMemberId() + 1);
  }

  private getMaxRecordId(): number {
    return (
      this.ctx.storage.sql
        .exec<
          { max_id: number | null } & Record<string, SqlStorageValue>
        >("SELECT MAX(id) AS max_id FROM records")
        .toArray()[0]?.max_id ?? 0
    );
  }

  private getMaxMemberId(): number {
    return (
      this.ctx.storage.sql
        .exec<
          { max_id: number | null } & Record<string, SqlStorageValue>
        >("SELECT MAX(id) AS max_id FROM members")
        .toArray()[0]?.max_id ?? 0
    );
  }

  private createNextMember(input: {
    name: string;
    linkedEmail: string | null;
    nowMs: number;
  }): MemberRow | null {
    const meta = this.getMeta();
    if (!meta) {
      return null;
    }

    const id = this.getNextMemberId(meta);
    const member = this.ctx.storage.transactionSync(() => {
      this.insertMember({
        id,
        name: input.name,
        linkedEmail: input.linkedEmail,
        nowMs: input.nowMs,
      });
      return this.getMember(id) as MemberRow;
    });
    this.saveProjectMetadata({
      ...meta,
      next_member_id: id + 1,
      updated_at: input.nowMs,
    });
    return member;
  }

  private insertMember(input: {
    id: number;
    name: string;
    linkedEmail: string | null;
    nowMs: number;
  }): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO members
        (id, name, normalized_name, linked_email, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      input.id,
      input.name,
      ProjectStore.normalizeMemberNameForUnique(input.name),
      input.linkedEmail,
      input.nowMs,
      input.nowMs,
    );
  }

  private applyBalanceDelta(delta: MoneyByMemberId): void {
    for (const [memberId, amount] of MoneyByMemberIdUtils.entries(delta)) {
      this.ctx.storage.sql.exec(
        `INSERT INTO balances (member_id, amount_cents)
         VALUES (?, ?)
         ON CONFLICT(member_id) DO UPDATE SET amount_cents = amount_cents + excluded.amount_cents`,
        Number(memberId),
        amount,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM balances WHERE member_id = ? AND amount_cents = 0",
        Number(memberId),
      );
    }
  }

  private canApplyBalanceDelta(delta: MoneyByMemberId, policy: LimitsPolicy): boolean {
    for (const [memberId, amount] of MoneyByMemberIdUtils.entries(delta)) {
      const currentBalance =
        this.ctx.storage.sql
          .exec<BalanceRow>(
            "SELECT amount_cents FROM balances WHERE member_id = ?",
            Number(memberId),
          )
          .toArray()[0]?.amount_cents ?? 0;
      const nextBalance = currentBalance + amount;
      if (!policy.allowsBalanceAmount(nextBalance)) {
        return false;
      }
    }
    return true;
  }

  private persistPublicIdIfMissing(
    meta: ProjectMetadata,
    publicId: string | undefined,
  ): ProjectMetadata {
    if (meta.public_id || !publicId) {
      return meta;
    }
    const parsed = ProjectId.safeParse(publicId);
    if (!parsed.success) {
      return meta;
    }
    return this.saveProjectMetadata({ ...meta, public_id: parsed.data });
  }

  private queueProjectSummarySync(): void {
    const queue = this.setAlarmIfNotAlready().catch((error: unknown) => {
      console.error("failed to queue project summary sync", { error });
    });
    this.ctx.waitUntil(queue);
  }

  private async setAlarmIfNotAlready(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) !== null) {
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + PROJECT_SUMMARY_SYNC_DELAY_MS);
  }

  private buildProjectSummarySync(
    meta: ProjectMetadata,
    lastSyncAt: number,
  ): ProjectSummarySyncInput | null {
    if (!meta.public_id) {
      return null;
    }

    const members = this.ctx.storage.sql
      .exec<MemberRow>(
        `SELECT id, name, normalized_name, linked_email, deleted_at, created_at, updated_at
         FROM members
         WHERE linked_email IS NOT NULL
         ORDER BY id`,
      )
      .toArray()
      .map((member) => ({
        email: member.linked_email as string,
        member: memberForResponse(member, { includeLinkedEmails: true }),
        balance:
          this.ctx.storage.sql
            .exec<BalanceRow>("SELECT amount_cents FROM balances WHERE member_id = ?", member.id)
            .toArray()[0]?.amount_cents ?? 0,
      }));

    return {
      id: meta.public_id,
      name: meta.name,
      owner: meta.owner_email,
      updatedAt: meta.updated_at,
      lastSyncAt,
      recordCount: Math.max(meta.next_record_id - 1, 0),
      members,
    };
  }

  private resolveDelta(
    description: RecordDescription,
  ):
    | { ok: true; delta: MoneyByMemberId }
    | { ok: false; error: "invalid_record" | "not_found" | "already_reverted" } {
    if (description.type !== "revert") {
      const delta = ProjectStore.deriveDescriptionDelta(description);
      if (!delta) {
        return { ok: false, error: "invalid_record" };
      }
      return { ok: true, delta };
    }

    const target = this.ctx.storage.sql
      .exec<RecordRow>(
        "SELECT id, description_type, delta_json FROM records WHERE id = ?",
        description.id,
      )
      .toArray()[0];
    if (!target) {
      return { ok: false, error: "not_found" };
    }
    if (target.description_type === "revert") {
      return { ok: false, error: "invalid_record" };
    }

    const existingRevert = this.ctx.storage.sql
      .exec<RecordRow>("SELECT id FROM records WHERE reverts_record_id = ?", description.id)
      .toArray()[0];
    if (existingRevert) {
      return { ok: false, error: "already_reverted" };
    }

    return {
      ok: true,
      delta: MoneyByMemberIdUtils.negate(JSON.parse(target.delta_json) as MoneyByMemberId),
    };
  }

  private static defaultMemberNameForEmail(email: string, maxLength: number): string {
    const localPart = normalizeEmail(email).split("@")[0] ?? "";
    return ProjectNameUtils.normalizeMember(localPart || "Member").slice(0, maxLength);
  }

  private static normalizeMemberNameForUnique(name: string): string {
    return ProjectNameUtils.normalizeMember(name).toLowerCase();
  }

  private static deriveDescriptionDelta(
    description: RecordDescription,
    revertTargetDelta?: MoneyByMemberId,
  ): MoneyByMemberId | null {
    if (description.type === "expense") {
      const delta: MoneyByMemberId = {};
      for (const [memberId, amount] of MoneyByMemberIdUtils.entries(description.liability)) {
        MoneyByMemberIdUtils.add(delta, memberId, amount);
      }
      for (const [memberId, amount] of MoneyByMemberIdUtils.entries(description.paid)) {
        MoneyByMemberIdUtils.add(delta, memberId, -amount);
      }
      return delta;
    }

    if (description.type === "transfer") {
      return MoneyByMemberIdUtils.normalize({
        [String(description.from)]: -description.amount,
        [String(description.to)]: description.amount,
      });
    }

    if (!revertTargetDelta) {
      return null;
    }
    return MoneyByMemberIdUtils.negate(revertTargetDelta);
  }

  private static normalizeRecordDescription(description: RecordDescription): RecordDescription {
    if (description.type !== "expense") {
      return description;
    }

    return {
      ...description,
      paid: MoneyByMemberIdUtils.normalize(description.paid),
      liability: MoneyByMemberIdUtils.normalize(description.liability),
    };
  }

  private static hasOversizedRecordMoneyMap(
    delta: Record<string, number>,
    description: RecordDescription,
  ): boolean {
    if (ProjectStore.hasOversizedMoneyMap(delta)) {
      return true;
    }
    return (
      description.type === "expense" &&
      (ProjectStore.hasOversizedMoneyMap(description.paid) ||
        ProjectStore.hasOversizedMoneyMap(description.liability))
    );
  }

  private static hasOversizedMoneyMap(map: unknown): boolean {
    return (
      typeof map === "object" &&
      map !== null &&
      !Array.isArray(map) &&
      Object.keys(map).length > ABSOLUTE_LIST_LIMIT
    );
  }
}

function normalizeProjectEmail(email: string): string | null {
  const parsed = normalizedEmailSchema.safeParse(email);
  return parsed.success ? parsed.data : null;
}

function memberForResponse(
  member: MemberRow,
  options: { includeLinkedEmails: boolean },
): ProjectMember {
  return {
    id: member.id,
    name: member.name,
    deleted: member.deleted_at !== null,
    ...(options.includeLinkedEmails && member.linked_email
      ? { linkedEmail: member.linked_email }
      : {}),
  };
}

function recordFromRow(row: RecordRow): ProjectRecord {
  return {
    id: row.id,
    authorMemberId: row.author_member_id,
    delta: JSON.parse(row.delta_json) as MoneyByMemberId,
    description: JSON.parse(row.description_json) as RecordDescription,
    createdAt: row.created_at,
  };
}

function recordFromResponseRow(row: RecordResponseRow): ProjectRecord {
  const record = recordFromRow(row);
  if (
    record.description.type === "revert" ||
    row.reverted_record_id === null ||
    row.reverted_author_member_id === null ||
    row.reverted_created_at === null
  ) {
    return record;
  }

  return {
    ...record,
    reverted: {
      recordId: row.reverted_record_id,
      authorMemberId: row.reverted_author_member_id,
      createdAt: row.reverted_created_at,
    },
  };
}
