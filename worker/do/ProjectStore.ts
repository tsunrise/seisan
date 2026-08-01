import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { createSettlementPlan } from "../../shared/settlement";
import { normalizeEmail, normalizedEmailSchema } from "../email";
import {
  PROJECTS_REGISTRY_NAME,
  PROJECT_SUMMARY_SYNC_DELAY_MS,
  MoneyByMemberIdUtils,
  ProjectNameUtils,
  ProjectId,
  ProjectEmailsUtils,
  ProjectMemberConfig,
  ProjectMemberConfigPatch,
  MoneyByMemberId,
  TransferBatch,
  WritableRecordDescription,
  type ProjectAcl,
  type ProjectAclType,
  type ProjectJoin,
  type ProjectMember,
  type ProjectMemberFull,
  type ProjectMemberPatch,
  type ProjectRecord,
  type ProjectSummary,
  type RecordDescription,
  type TransferDescription,
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

const SettlementPlanCache = z.object({
  latestRecordId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  transfers: z.array(TransferBatch).max(ABSOLUTE_LIST_LIMIT),
});
type SettlementPlanCache = z.infer<typeof SettlementPlanCache>;

const MemberConfigTarget = z
  .object({
    callerEmail: normalizedEmailSchema,
    memberId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
type MemberConfigTarget = z.infer<typeof MemberConfigTarget>;
const MemberConfigPutInput = MemberConfigTarget.extend({
  config: ProjectMemberConfig,
  nowMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
type MemberConfigPutInput = z.infer<typeof MemberConfigPutInput>;
const MemberConfigPatchInput = MemberConfigTarget.extend({
  patch: ProjectMemberConfigPatch,
  nowMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
type MemberConfigPatchInput = z.infer<typeof MemberConfigPatchInput>;

interface MemberRow extends Record<string, SqlStorageValue> {
  id: number;
  name: string;
  normalized_name: string;
  linked_email: string | null;
  config: string;
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
  created_at: number;
  updated_at: number | null;
  updated_by_member_id: number | null;
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
const SETTLEMENT_PLAN_CACHE_KEY = "settlementPlanCache";
const OWNER_LIMITS_POLICY_TTL_SECONDS = 10;

type ProjectStoreError =
  | "uninitialized"
  | "forbidden"
  | "invalid_input"
  | "invalid_record"
  | "not_found"
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

    this.ctx.storage.kv.delete(SETTLEMENT_PLAN_CACHE_KEY);
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
    description: WritableRecordDescription;
    settle?: boolean;
    nowMs: number;
  }): Promise<
    | { ok: true; id: number }
    | {
        ok: false;
        error:
          | "uninitialized"
          | "forbidden"
          | "invalid_record"
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

    const prepared = this.prepareWritableRecord(input, policy);
    if (!prepared.ok) {
      return prepared;
    }
    const { description, delta } = prepared;

    if (input.settle && description.type !== "transfer") {
      return { ok: false, error: "invalid_record" };
    }
    if (
      input.settle &&
      description.type === "transfer" &&
      ProjectStore.transferSource(description) !== authorMember.id
    ) {
      return { ok: false, error: "forbidden" };
    }

    if (!policy.allowsAdditionalOwnedProjectRecord(this.countRecords())) {
      return { ok: false, error: "record_limit_exceeded" };
    }

    if (!this.canApplyBalanceDelta(delta, policy)) {
      return { ok: false, error: "money_limit_exceeded" };
    }

    const settlementCachePatch =
      input.settle && description.type === "transfer"
        ? this.createSettlementCachePatch(description)
        : null;
    const id = this.getNextRecordId(metadata.meta);
    this.ctx.storage.sql
      .exec(
        `INSERT INTO records
        (id, author_member_id, description_type, description_json, delta_json, created_at,
         updated_at, updated_by_member_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
        id,
        authorMember.id,
        description.type,
        JSON.stringify(description),
        JSON.stringify(delta),
        input.nowMs,
      )
      .toArray();
    this.applyBalanceDelta(delta);
    this.saveProjectMetadata({
      ...metadata.meta,
      next_record_id: id + 1,
      updated_at: input.nowMs,
    });

    if (settlementCachePatch) {
      try {
        this.writeSettlementPlanCache({
          latestRecordId: id,
          transfers: settlementCachePatch,
        });
      } catch (error) {
        // Settlement cache advancement is best-effort. The record ID mismatch makes a failed
        // patch a normal cache miss on the next settlement read.
        console.error("failed to advance settlement plan cache", error);
      }
    }

    this.queueProjectSummarySync();
    return { ok: true, id };
  }

  getRecord(input: {
    publicId?: string;
    callerEmail?: string | null;
    recordId: number;
  }):
    | { ok: true; record: ProjectRecord }
    | { ok: false; error: "uninitialized" | "forbidden" | "not_found" } {
    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }
    this.persistPublicIdIfMissing(metadata.meta, input.publicId);

    const row = this.getRecordRow(input.recordId);
    return row ? { ok: true, record: recordFromRow(row) } : { ok: false, error: "not_found" };
  }

  async putRecord(input: {
    callerEmail: string;
    recordId: number;
    delta: Record<string, number>;
    description: WritableRecordDescription;
    nowMs: number;
  }): Promise<
    | { ok: true; record: ProjectRecord }
    | {
        ok: false;
        error:
          | "uninitialized"
          | "forbidden"
          | "not_found"
          | "invalid_record"
          | "record_type_mismatch"
          | "record_limit_exceeded"
          | "money_limit_exceeded"
          | "nonzero_balance";
      }
  > {
    const policy = await this.loadOwnerLimitsPolicy();
    const result = this.putRecordSync(input, policy);
    if (result.ok) {
      this.queueProjectSummarySync();
    }
    return result;
  }

  async deleteRecord(input: { callerEmail: string; recordId: number; nowMs: number }): Promise<
    | { ok: true }
    | {
        ok: false;
        error:
          | "uninitialized"
          | "forbidden"
          | "not_found"
          | "invalid_record"
          | "money_limit_exceeded"
          | "nonzero_balance";
      }
  > {
    const policy = await this.loadOwnerLimitsPolicy();
    const result = this.deleteRecordSync(input, policy);
    if (result.ok) {
      this.queueProjectSummarySync();
    }
    return result;
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
        members: ProjectMemberFull[];
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
      .exec<RecordRow>(
        `SELECT
            id,
            author_member_id,
            description_type,
            description_json,
            delta_json,
            created_at,
            updated_at,
            updated_by_member_id
         FROM records
         WHERE id < ?
         ORDER BY id DESC
         LIMIT ?`,
        offset,
        limit,
      )
      .toArray()
      .map(recordFromRow);

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
      members: this.getFullMembersForResponse({ includePrivateFields: metadata.email !== null }),
      records,
      balance,
      updatedAt: meta.updated_at,
    };
  }

  settle(input: {
    callerEmail?: string | null;
  }):
    | { ok: true; transfers: TransferBatch[] }
    | { ok: false; error: "uninitialized" | "forbidden" | "invalid_balance" } {
    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }

    const latestRecordId = this.getMaxRecordId();
    const cached = this.readSettlementPlanCache();
    if (cached?.latestRecordId === latestRecordId) {
      return { ok: true, transfers: cached.transfers };
    }

    const balance = Object.fromEntries(
      this.ctx.storage.sql
        .exec<BalanceRow>("SELECT member_id, amount_cents FROM balances ORDER BY member_id")
        .toArray()
        .map((row) => [String(row.member_id), row.amount_cents]),
    );
    const transfers = createSettlementPlan(balance);
    if (!transfers) {
      return { ok: false, error: "invalid_balance" };
    }

    this.writeSettlementPlanCache({ latestRecordId, transfers });
    return { ok: true, transfers };
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
    if (!metadata.isOwner && (!metadata.email || !this.getActiveLinkedMember(metadata.email))) {
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

    if ("email" in input.patch) {
      if (input.patch.email !== "") {
        return { ok: false, error: "invalid_input" };
      }

      // unlink a member

      const ownerAccess = this.getOwnerAccess(input.callerEmail);
      if (!ownerAccess.ok) {
        return ownerAccess;
      }
      const member = this.getMember(input.memberId);
      if (!member) {
        return { ok: false, error: "not_found" };
      }
      if (member.deleted_at !== null) {
        return { ok: false, error: "already_deleted" };
      }
      if (member.linked_email === ownerAccess.meta.owner_email) {
        return { ok: false, error: "forbidden" };
      }
      this.ctx.storage.sql.exec(
        "UPDATE members SET linked_email = NULL, updated_at = ? WHERE id = ?",
        input.nowMs,
        member.id,
      );
      this.queueProjectSummarySync();
      return {
        ok: true,
        member: memberForResponse({ ...member, linked_email: null }, { includeLinkedEmails: true }),
        ...(member.linked_email ? { removedLinkedEmail: member.linked_email } : {}),
      };
    }

    const access = this.getMemberWriteAccess(input.callerEmail, input.memberId);
    if (!access.ok) {
      return access;
    }
    const name = ProjectNameUtils.normalizeMember(input.patch.name);
    const normalizedName = ProjectStore.normalizeMemberNameForUnique(name);
    if (!policy?.allowsMemberName(name)) {
      return { ok: false, error: "member_limit_exceeded" };
    }
    if (this.hasActiveMemberName(name, access.member.id)) {
      return { ok: false, error: "invalid_input" };
    }
    this.ctx.storage.sql.exec(
      "UPDATE members SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?",
      name,
      normalizedName,
      input.nowMs,
      access.member.id,
    );
    this.queueProjectSummarySync();
    return {
      ok: true,
      member: memberForResponse(
        { ...access.member, name, normalized_name: normalizedName },
        { includeLinkedEmails: true },
      ),
    };
  }

  getMemberConfig(
    input: MemberConfigTarget,
  ):
    | { ok: true; config: ProjectMemberConfig }
    | { ok: false; error: "uninitialized" | "forbidden" | "invalid_input" | "not_found" } {
    const parsed = MemberConfigTarget.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    const metadata = this.getProjectMetadata(parsed.data.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }

    const member = this.getMember(parsed.data.memberId);
    if (!member) {
      return { ok: false, error: "not_found" };
    }
    return { ok: true, config: memberConfigFromRow(member) };
  }

  putMemberConfig(input: MemberConfigPutInput):
    | { ok: true; config: ProjectMemberConfig }
    | {
        ok: false;
        error: "uninitialized" | "forbidden" | "invalid_input" | "not_found" | "already_deleted";
      } {
    const parsed = MemberConfigPutInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    const access = this.getMemberWriteAccess(parsed.data.callerEmail, parsed.data.memberId);
    if (!access.ok) {
      return access;
    }

    this.writeMemberConfig(access.member.id, parsed.data.config, parsed.data.nowMs);
    return { ok: true, config: parsed.data.config };
  }

  patchMemberConfig(input: MemberConfigPatchInput):
    | { ok: true; config: ProjectMemberConfig }
    | {
        ok: false;
        error: "uninitialized" | "forbidden" | "invalid_input" | "not_found" | "already_deleted";
      } {
    const parsed = MemberConfigPatchInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    const access = this.getMemberWriteAccess(parsed.data.callerEmail, parsed.data.memberId);
    if (!access.ok) {
      return access;
    }

    const current = memberConfigFromRow(access.member);
    if (Object.keys(parsed.data.patch).length === 0) {
      return { ok: true, config: current };
    }

    const next: ProjectMemberConfig = { ...current };
    if ("size" in parsed.data.patch) {
      if (parsed.data.patch.size === null) {
        delete next.size;
      } else if (parsed.data.patch.size !== undefined) {
        next.size = parsed.data.patch.size;
      }
    }
    if ("paymentMethod" in parsed.data.patch) {
      if (parsed.data.patch.paymentMethod === null) {
        delete next.paymentMethod;
      } else if (parsed.data.patch.paymentMethod !== undefined) {
        next.paymentMethod = parsed.data.patch.paymentMethod;
      }
    }

    const nextConfig = ProjectMemberConfig.safeParse(next);
    if (!nextConfig.success) {
      return { ok: false, error: "invalid_input" };
    }
    if (JSON.stringify(nextConfig.data) === JSON.stringify(current)) {
      return { ok: true, config: current };
    }

    this.writeMemberConfig(access.member.id, nextConfig.data, parsed.data.nowMs);
    return { ok: true, config: nextConfig.data };
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

  private readSettlementPlanCache(): SettlementPlanCache | null {
    const raw = this.ctx.storage.kv.get<string>(SETTLEMENT_PLAN_CACHE_KEY);
    if (typeof raw !== "string") {
      return null;
    }

    try {
      const parsed = SettlementPlanCache.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private writeSettlementPlanCache(cache: SettlementPlanCache): void {
    const parsed = SettlementPlanCache.safeParse(cache);
    if (!parsed.success) {
      throw new Error("invalid settlement plan cache");
    }
    this.ctx.storage.kv.put(SETTLEMENT_PLAN_CACHE_KEY, JSON.stringify(parsed.data));
  }

  private createSettlementCachePatch(description: TransferDescription): TransferBatch[] | null {
    const cached = this.readSettlementPlanCache();
    if (!cached || cached.latestRecordId !== this.getMaxRecordId()) {
      return null;
    }

    const submitted = ProjectStore.transferBatch(description);
    const matchingIndex = cached.transfers.findIndex((transfer) =>
      ProjectStore.transferBatchesEqual(transfer, submitted),
    );
    if (matchingIndex === -1) {
      return null;
    }

    return cached.transfers.filter((_, index) => index !== matchingIndex);
  }

  private static transferSource(description: TransferDescription): number {
    return "from" in description ? description.from : description.src;
  }

  private static transferBatch(description: TransferDescription): TransferBatch {
    return "from" in description
      ? { src: description.from, dests: [{ id: description.to, amount: description.amount }] }
      : description;
  }

  private static transferBatchesEqual(left: TransferBatch, right: TransferBatch): boolean {
    if (left.src !== right.src || left.dests.length !== right.dests.length) {
      return false;
    }

    const rightByDestination = new Map(
      right.dests.map((destination) => [destination.id, destination.amount]),
    );
    return left.dests.every(
      (destination) => rightByDestination.get(destination.id) === destination.amount,
    );
  }

  /**
   * Replaces a live record, applies its normalized net balance delta, updates audit metadata, and
   * invalidates the settlement cache when balances change.
   *
   * The helper is atomic because every authoritative read and SQL/KV write is synchronous and every
   * SQL cursor is consumed immediately, allowing Cloudflare to submit the sequence as one implicit
   * transaction.
   */
  private putRecordSync(
    input: {
      callerEmail: string;
      recordId: number;
      delta: Record<string, number>;
      description: WritableRecordDescription;
      nowMs: number;
    },
    policy: LimitsPolicy,
  ):
    | { ok: true; record: ProjectRecord }
    | {
        ok: false;
        error:
          | "uninitialized"
          | "forbidden"
          | "not_found"
          | "invalid_record"
          | "record_type_mismatch"
          | "record_limit_exceeded"
          | "money_limit_exceeded"
          | "nonzero_balance";
      } {
    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }
    if (!metadata.email) {
      return { ok: false, error: "forbidden" };
    }

    const editorMember = this.getActiveLinkedMember(metadata.email);
    if (!editorMember) {
      return { ok: false, error: "forbidden" };
    }

    const stored = this.getLiveRecordRow(input.recordId);
    if (!stored) {
      return { ok: false, error: "not_found" };
    }

    const prepared = this.prepareWritableRecord(input, policy);
    if (!prepared.ok) {
      return prepared;
    }
    if (prepared.description.type !== stored.description_type) {
      return { ok: false, error: "record_type_mismatch" };
    }

    const storedDelta = ProjectStore.parseStoredMoneyMap(stored.delta_json);
    if (!storedDelta) {
      return { ok: false, error: "invalid_record" };
    }
    const netDelta = ProjectStore.subtractMoneyMaps(prepared.delta, storedDelta);
    if (!netDelta) {
      return { ok: false, error: "invalid_record" };
    }
    const deletedMemberError = this.getDeletedMemberBalanceError(netDelta);
    if (deletedMemberError) {
      return { ok: false, error: deletedMemberError };
    }
    if (!this.canApplyBalanceDelta(netDelta, policy)) {
      return { ok: false, error: "money_limit_exceeded" };
    }

    // Cloudflare submits this synchronous read/write tail as one implicit transaction. Keep every
    // storage operation through saveProjectMetadata free of asynchronous boundaries.
    this.ctx.storage.sql
      .exec(
        `UPDATE records
       SET description_type = ?, description_json = ?, delta_json = ?,
           updated_at = ?, updated_by_member_id = ?
       WHERE id = ? AND description_type != 'deleted'`,
        prepared.description.type,
        JSON.stringify(prepared.description),
        JSON.stringify(prepared.delta),
        input.nowMs,
        editorMember.id,
        input.recordId,
      )
      .toArray();
    this.applyBalanceDelta(netDelta);
    if (MoneyByMemberIdUtils.entries(netDelta).length > 0) {
      this.ctx.storage.kv.delete(SETTLEMENT_PLAN_CACHE_KEY);
    }
    this.saveProjectMetadata({ ...metadata.meta, updated_at: input.nowMs });

    return {
      ok: true,
      record: {
        id: stored.id,
        authorMemberId: stored.author_member_id,
        delta: prepared.delta,
        description: prepared.description,
        createdAt: stored.created_at,
        updatedAt: input.nowMs,
        updatedByMemberId: editorMember.id,
      },
    };
  }

  /**
   * Tombstones a live record, reverses its stored balance delta, updates project metadata, and
   * invalidates the settlement cache when balances change.
   *
   * The helper is atomic because every authoritative read and SQL/KV write is synchronous and every
   * SQL cursor is consumed immediately, allowing Cloudflare to submit the sequence as one implicit
   * transaction.
   */
  private deleteRecordSync(
    input: { callerEmail: string; recordId: number; nowMs: number },
    policy: LimitsPolicy,
  ):
    | { ok: true }
    | {
        ok: false;
        error:
          | "uninitialized"
          | "forbidden"
          | "not_found"
          | "invalid_record"
          | "money_limit_exceeded"
          | "nonzero_balance";
      } {
    const metadata = this.getProjectMetadata(input.callerEmail);
    if (!metadata.ok) {
      return metadata;
    }
    if (!metadata.email) {
      return { ok: false, error: "forbidden" };
    }
    const deletingMember = this.getActiveLinkedMember(metadata.email);
    if (!deletingMember) {
      return { ok: false, error: "forbidden" };
    }

    const stored = this.getLiveRecordRow(input.recordId);
    if (!stored) {
      return { ok: false, error: "not_found" };
    }
    const storedDelta = ProjectStore.parseStoredMoneyMap(stored.delta_json);
    if (!storedDelta) {
      return { ok: false, error: "invalid_record" };
    }
    const inverseDelta = ProjectStore.subtractMoneyMaps({}, storedDelta);
    if (!inverseDelta) {
      return { ok: false, error: "invalid_record" };
    }
    const deletedMemberError = this.getDeletedMemberBalanceError(inverseDelta);
    if (deletedMemberError) {
      return { ok: false, error: deletedMemberError };
    }
    if (!this.canApplyBalanceDelta(inverseDelta, policy)) {
      return { ok: false, error: "money_limit_exceeded" };
    }

    // As above, this mutation tail stays synchronous so the tombstone and balances cannot commit
    // independently.
    this.ctx.storage.sql
      .exec(
        `UPDATE records
       SET description_type = 'deleted', description_json = '{}', delta_json = '{}',
           updated_at = ?, updated_by_member_id = ?
       WHERE id = ? AND description_type != 'deleted'`,
        input.nowMs,
        deletingMember.id,
        input.recordId,
      )
      .toArray();
    this.applyBalanceDelta(inverseDelta);
    if (MoneyByMemberIdUtils.entries(storedDelta).length > 0) {
      this.ctx.storage.kv.delete(SETTLEMENT_PLAN_CACHE_KEY);
    }
    this.saveProjectMetadata({ ...metadata.meta, updated_at: input.nowMs });
    return { ok: true };
  }

  /**
   * Normalizes and validates a client-supplied writable record. It derives the authoritative delta
   * from the normalized description and verifies that it matches the submitted delta, sums to
   * zero, satisfies owner limits, and only references active project members.
   */
  private prepareWritableRecord(
    input: { delta: Record<string, number>; description: WritableRecordDescription },
    policy: LimitsPolicy,
  ):
    | { ok: true; description: WritableRecordDescription; delta: MoneyByMemberId }
    | {
        ok: false;
        error: "invalid_record" | "record_limit_exceeded" | "money_limit_exceeded";
      } {
    const parsedDescription = WritableRecordDescription.safeParse(input.description);
    const parsedDelta = MoneyByMemberId.safeParse(input.delta);
    if (!parsedDescription.success || !parsedDelta.success) {
      return { ok: false, error: "invalid_record" };
    }
    const description = ProjectStore.normalizeRecordDescription(parsedDescription.data);
    const delta = parsedDelta.data;

    const limitExceededError = this.getDescriptionLimitExceededError(description, policy);
    if (limitExceededError) {
      return { ok: false, error: limitExceededError };
    }
    if (!policy.allowsMoneyMap(delta)) {
      return { ok: false, error: "money_limit_exceeded" };
    }

    const resolvedDelta = ProjectStore.deriveDescriptionDelta(description);
    if (
      !resolvedDelta ||
      ProjectStore.hasOversizedMoneyMap(resolvedDelta) ||
      !MoneyByMemberIdUtils.equals(delta, resolvedDelta) ||
      MoneyByMemberIdUtils.sum(resolvedDelta) !== 0 ||
      !this.referencesOnlyActiveMembers(description, resolvedDelta)
    ) {
      return { ok: false, error: "invalid_record" };
    }
    return { ok: true, description, delta: resolvedDelta };
  }

  /**
   * Collects every member referenced by the description or derived delta and verifies that each is
   * an active project member.
   */
  private referencesOnlyActiveMembers(
    description: WritableRecordDescription,
    delta: MoneyByMemberId,
  ): boolean {
    const referencedMemberIds = new Set(
      MoneyByMemberIdUtils.members(delta).map((memberId) => Number(memberId)),
    );
    if (description.type === "expense") {
      for (const memberId of MoneyByMemberIdUtils.members(description.paid)) {
        referencedMemberIds.add(Number(memberId));
      }
      for (const memberId of MoneyByMemberIdUtils.members(description.liability)) {
        referencedMemberIds.add(Number(memberId));
      }
    } else if (description.type === "transfer") {
      if ("from" in description) {
        referencedMemberIds.add(description.from);
        referencedMemberIds.add(description.to);
      } else {
        referencedMemberIds.add(description.src);
        for (const destination of description.dests) {
          referencedMemberIds.add(destination.id);
        }
      }
    } else {
      referencedMemberIds.add(description.debtorMemberId);
      referencedMemberIds.add(description.creditorMemberId);
    }

    const activeMemberIds = this.getActiveMemberIds();
    return [...referencedMemberIds].every((memberId) => activeMemberIds.has(memberId));
  }

  private getLiveRecordRow(recordId: number): RecordRow | null {
    return (
      this.ctx.storage.sql
        .exec<RecordRow>(
          `SELECT id, author_member_id, description_type, description_json, delta_json,
                  created_at, updated_at, updated_by_member_id
           FROM records
           WHERE id = ? AND description_type != 'deleted'`,
          recordId,
        )
        .toArray()[0] ?? null
    );
  }

  private getRecordRow(recordId: number): RecordRow | null {
    return (
      this.ctx.storage.sql
        .exec<RecordRow>(
          `SELECT id, author_member_id, description_type, description_json, delta_json,
                  created_at, updated_at, updated_by_member_id
           FROM records
           WHERE id = ?`,
          recordId,
        )
        .toArray()[0] ?? null
    );
  }

  private getDeletedMemberBalanceError(
    delta: MoneyByMemberId,
  ): "invalid_record" | "nonzero_balance" | null {
    for (const [memberId, amount] of MoneyByMemberIdUtils.entries(delta)) {
      const member = this.getMember(Number(memberId));
      if (!member) {
        return "invalid_record";
      }
      if (member.deleted_at === null) {
        continue;
      }
      const currentBalance =
        this.ctx.storage.sql
          .exec<BalanceRow>(
            "SELECT amount_cents FROM balances WHERE member_id = ?",
            Number(memberId),
          )
          .toArray()[0]?.amount_cents ?? 0;
      if (currentBalance + amount !== 0) {
        return "nonzero_balance";
      }
    }
    return null;
  }

  private static parseStoredMoneyMap(raw: string): MoneyByMemberId | null {
    try {
      const parsed = MoneyByMemberId.safeParse(JSON.parse(raw) as unknown);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Computes the normalized money map `a - b`, removing zero-valued entries and returning null if
   * any intermediate sum exceeds JavaScript's safe-integer range.
   */
  private static subtractMoneyMaps(a: MoneyByMemberId, b: MoneyByMemberId): MoneyByMemberId | null {
    const result: MoneyByMemberId = {};
    for (const [memberId, amount] of MoneyByMemberIdUtils.entries(a)) {
      if (!ProjectStore.addSafeMoneyAmount(result, memberId, amount)) {
        return null;
      }
    }
    for (const [memberId, amount] of MoneyByMemberIdUtils.entries(b)) {
      if (!ProjectStore.addSafeMoneyAmount(result, memberId, -amount)) {
        return null;
      }
    }
    return result;
  }

  private static addSafeMoneyAmount(
    map: MoneyByMemberId,
    memberId: string,
    amount: number,
  ): boolean {
    const next = (map[memberId] ?? 0) + amount;
    if (!Number.isSafeInteger(next)) {
      return false;
    }
    if (next === 0) {
      delete map[memberId];
    } else {
      map[memberId] = next;
    }
    return true;
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
    description: WritableRecordDescription,
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
      const amounts =
        "from" in description
          ? [description.amount]
          : description.dests.map((destination) => destination.amount);
      return amounts.every((amount) => policy.allowsMoneyAmount(amount))
        ? null
        : "money_limit_exceeded";
    }
    if (description.reason !== undefined && !policy.allowsExpenseName(description.reason)) {
      return "record_limit_exceeded";
    }
    return policy.allowsMoneyAmount(description.amount) ? null : "money_limit_exceeded";
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

  /** Check whether `callerEmail` has write access to `memberId`. */
  private getMemberWriteAccess(
    callerEmail: string,
    memberId: number,
  ):
    | { ok: true; member: MemberRow }
    | { ok: false; error: "uninitialized" | "forbidden" | "not_found" | "already_deleted" } {
    const metadata = this.getProjectMetadata(callerEmail);
    if (!metadata.ok) {
      return metadata;
    }

    const member = this.getMember(memberId);
    if (!member) {
      return { ok: false, error: "not_found" };
    }
    if (member.deleted_at !== null) {
      return { ok: false, error: "already_deleted" };
    }
    if (metadata.isOwner || member.linked_email === metadata.email) {
      return { ok: true, member };
    }
    if (
      member.linked_email !== null ||
      !metadata.email ||
      !this.getActiveLinkedMember(metadata.email)
    ) {
      return { ok: false, error: "forbidden" };
    }
    return { ok: true, member };
  }

  private writeMemberConfig(memberId: number, config: ProjectMemberConfig, nowMs: number): void {
    this.ctx.storage.sql.exec(
      "UPDATE members SET config = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(config),
      nowMs,
      memberId,
    );
  }

  private getMember(memberId: number): MemberRow | null {
    return (
      this.ctx.storage.sql
        .exec<MemberRow>(
          `SELECT id, name, normalized_name, linked_email, config, deleted_at, created_at, updated_at
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
          `SELECT id, name, normalized_name, linked_email, config, deleted_at, created_at, updated_at
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
          `SELECT id, name, normalized_name, linked_email, config, deleted_at, created_at, updated_at
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
        `SELECT id, name, normalized_name, linked_email, config, deleted_at, created_at, updated_at
         FROM members
         ORDER BY id`,
      )
      .toArray()
      .map((member) => memberForResponse(member, options));
  }

  private getFullMembersForResponse(options: {
    includePrivateFields: boolean;
  }): ProjectMemberFull[] {
    return this.ctx.storage.sql
      .exec<MemberRow>(
        `SELECT id, name, normalized_name, linked_email, config, deleted_at, created_at, updated_at
         FROM members
         ORDER BY id`,
      )
      .toArray()
      .map((member) => memberFullForResponse(member, options));
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
        (id, name, normalized_name, linked_email, config, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, '{}', NULL, ?, ?)`,
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
      this.ctx.storage.sql
        .exec(
          `INSERT INTO balances (member_id, amount_cents)
         VALUES (?, ?)
         ON CONFLICT(member_id) DO UPDATE SET amount_cents = amount_cents + excluded.amount_cents`,
          Number(memberId),
          amount,
        )
        .toArray();
      this.ctx.storage.sql
        .exec("DELETE FROM balances WHERE member_id = ? AND amount_cents = 0", Number(memberId))
        .toArray();
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
        `SELECT id, name, normalized_name, linked_email, config, deleted_at, created_at, updated_at
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
      recordCount: this.countRecords(),
      members,
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
    description: WritableRecordDescription,
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
      if ("from" in description) {
        if (description.from === description.to || description.amount <= 0) {
          return null;
        }
        return MoneyByMemberIdUtils.normalize({
          [String(description.from)]: -description.amount,
          [String(description.to)]: description.amount,
        });
      }

      if (description.dests.length === 0 || description.dests.length > ABSOLUTE_LIST_LIMIT) {
        return null;
      }
      const delta: MoneyByMemberId = {};
      const seenDestinationIds = new Set<number>();
      let total = 0;
      for (const destination of description.dests) {
        if (
          destination.id === description.src ||
          seenDestinationIds.has(destination.id) ||
          !Number.isSafeInteger(destination.amount) ||
          destination.amount <= 0
        ) {
          return null;
        }
        seenDestinationIds.add(destination.id);
        total += destination.amount;
        if (!Number.isSafeInteger(total)) {
          return null;
        }
        MoneyByMemberIdUtils.add(delta, destination.id, destination.amount);
      }
      MoneyByMemberIdUtils.add(delta, description.src, -total);
      return MoneyByMemberIdUtils.normalize(delta);
    }

    if (description.debtorMemberId === description.creditorMemberId || description.amount <= 0) {
      return null;
    }
    return MoneyByMemberIdUtils.normalize({
      [String(description.debtorMemberId)]: description.amount,
      [String(description.creditorMemberId)]: -description.amount,
    });
  }

  private static normalizeRecordDescription(
    description: WritableRecordDescription,
  ): WritableRecordDescription {
    if (description.type === "promise") {
      const { reason, ...promise } = description;
      const normalizedReason = reason?.trim();
      return normalizedReason ? { ...promise, reason: normalizedReason } : promise;
    }

    if (description.type !== "expense") {
      return description;
    }

    return {
      ...description,
      paid: MoneyByMemberIdUtils.normalize(description.paid),
      liability: MoneyByMemberIdUtils.normalize(description.liability),
    };
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

function memberFullForResponse(
  member: MemberRow,
  options: { includePrivateFields: boolean },
): ProjectMemberFull {
  return {
    ...memberForResponse(member, { includeLinkedEmails: options.includePrivateFields }),
    ...(options.includePrivateFields ? { config: memberConfigFromRow(member) } : {}),
  };
}

function memberConfigFromRow(member: MemberRow): ProjectMemberConfig {
  try {
    const parsed = ProjectMemberConfig.safeParse(JSON.parse(member.config));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function recordFromRow(row: RecordRow): ProjectRecord {
  if (row.description_type === "deleted") {
    return {
      id: row.id,
      authorMemberId: row.author_member_id,
      delta: {},
      description: { type: "deleted" },
      createdAt: row.created_at,
      ...(row.updated_at !== null && row.updated_by_member_id !== null
        ? { updatedAt: row.updated_at, updatedByMemberId: row.updated_by_member_id }
        : {}),
    };
  }
  return {
    id: row.id,
    authorMemberId: row.author_member_id,
    delta: JSON.parse(row.delta_json) as MoneyByMemberId,
    description: JSON.parse(row.description_json) as RecordDescription,
    createdAt: row.created_at,
    ...(row.updated_at !== null && row.updated_by_member_id !== null
      ? { updatedAt: row.updated_at, updatedByMemberId: row.updated_by_member_id }
      : {}),
  };
}
