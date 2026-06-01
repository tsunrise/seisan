import { DurableObject } from "cloudflare:workers";

import {
  PROJECT_RECORD_MAX_LIMIT,
  defaultMemberNameForEmail,
  deriveDescriptionDelta,
  memberNameSchema,
  moneyMapSchema,
  moneyMapsEqual,
  negateMoneyMap,
  normalizeEmail,
  normalizeMemberNameForUnique,
  normalizedEmailSchema,
  projectAclEmailsSchema,
  type ProjectAclType,
  projectAclSchema,
  projectAclTypeSchema,
  projectJoinSchema,
  projectMemberCreateSchema,
  projectMemberPatchSchema,
  recordDescriptionSchema,
  sumMoneyMap,
  type MoneyByMemberId,
  type ProjectAcl,
  type ProjectJoinInput,
  type ProjectMember,
  type ProjectMemberPatch,
  type ProjectRecord,
  type RecordDescription,
} from "../project";
import { runSqlMigrations, type SqlMigration } from "./migrations";

interface ProjectMetaRow extends Record<string, SqlStorageValue> {
  owner_email: string;
  acl_type: "public" | "restricted";
  next_record_id: number;
  next_member_id: number;
}

interface AclAllowedListRow extends Record<string, SqlStorageValue> {
  email: string;
}

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

interface BalanceRow extends Record<string, SqlStorageValue> {
  member_id: number;
  amount_cents: number;
}

const INITIALIZED_KEY = "initialized";

type ProjectStoreError =
  | "uninitialized"
  | "forbidden"
  | "invalid_input"
  | "invalid_record"
  | "not_found"
  | "already_reverted"
  | "already_linked"
  | "already_deleted"
  | "nonzero_balance";

export class ProjectStore extends DurableObject<Env> {
  static readonly migrations: SqlMigration[] = [
    [
      `CREATE TABLE IF NOT EXISTS project_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner_email TEXT NOT NULL,
        acl_type TEXT NOT NULL CHECK (acl_type IN ('public', 'restricted')),
        next_record_id INTEGER NOT NULL,
        next_member_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS acl_allowed_list (
        email TEXT PRIMARY KEY
      )`,
      `CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        linked_email TEXT UNIQUE,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS members_active_normalized_name_idx
        ON members(normalized_name)
        WHERE deleted_at IS NULL`,
      `CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY,
        author_member_id INTEGER NOT NULL,
        description_type TEXT NOT NULL,
        description_json TEXT NOT NULL,
        delta_json TEXT NOT NULL,
        reverts_record_id INTEGER UNIQUE,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS balances (
        member_id INTEGER PRIMARY KEY,
        amount_cents INTEGER NOT NULL
      )`,
    ],
  ];

  private initialized = false;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    state.blockConcurrencyWhile(async () => {
      await runSqlMigrations(state, ProjectStore.migrations);
      this.initialized = (await state.storage.get<boolean>(INITIALIZED_KEY)) === true;
    });
  }

  async initialize(input: {
    acl: ProjectAcl;
    ownerEmail: string;
    ownerMemberName?: string;
    nowMs: number;
  }): Promise<
    | { ok: true; members: ProjectMember[] }
    | { ok: false; error: "already_initialized" | "invalid_input" }
  > {
    if (this.initialized) {
      return { ok: false, error: "already_initialized" };
    }

    const parsedAcl = projectAclSchema.safeParse(input.acl);
    const parsedOwnerEmail = normalizeProjectEmail(input.ownerEmail);
    const parsedOwnerMemberName = memberNameSchema.safeParse(
      input.ownerMemberName ?? defaultMemberNameForEmail(input.ownerEmail),
    );
    if (!parsedAcl.success || !parsedOwnerEmail || !parsedOwnerMemberName.success) {
      return { ok: false, error: "invalid_input" };
    }

    const acl = parsedAcl.data;
    const members = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM balances");
      this.ctx.storage.sql.exec("DELETE FROM records");
      this.ctx.storage.sql.exec("DELETE FROM members");
      this.ctx.storage.sql.exec("DELETE FROM acl_allowed_list");
      this.ctx.storage.sql.exec("DELETE FROM project_meta");
      this.ctx.storage.sql.exec(
        `INSERT INTO project_meta
          (id, owner_email, acl_type, next_record_id, next_member_id, created_at, updated_at)
         VALUES (1, ?, ?, 1, 2, ?, ?)`,
        parsedOwnerEmail,
        acl.type,
        input.nowMs,
        input.nowMs,
      );

      if (acl.type === "restricted") {
        for (const email of acl.emails) {
          this.ctx.storage.sql.exec("INSERT INTO acl_allowed_list (email) VALUES (?)", email);
        }
      }

      this.insertMember({
        id: 1,
        name: parsedOwnerMemberName.data,
        linkedEmail: parsedOwnerEmail,
        nowMs: input.nowMs,
      });
      this.ctx.storage.kv.put(INITIALIZED_KEY, true);
      return this.getMembersForResponse({ requesterIsOwner: true, requesterMemberId: 1 });
    });

    this.initialized = true;
    return {
      ok: true,
      members,
    };
  }

  postRecord(input: {
    callerEmail: string;
    delta: MoneyByMemberId;
    description: RecordDescription;
    nowMs: number;
  }):
    | { ok: true; id: number }
    | {
        ok: false;
        error: "uninitialized" | "forbidden" | "invalid_record" | "not_found" | "already_reverted";
      } {
    const access = this.getProjectAccess(input.callerEmail);
    if (!access.ok) {
      return access;
    }
    if (!access.email) {
      return { ok: false, error: "forbidden" };
    }

    const authorMember = this.getActiveLinkedMember(access.email);
    if (!authorMember) {
      return { ok: false, error: "forbidden" };
    }

    const parsedDescription = recordDescriptionSchema.safeParse(input.description);
    const parsedDelta = moneyMapSchema.safeParse(input.delta);
    if (!parsedDescription.success || !parsedDelta.success) {
      return { ok: false, error: "invalid_record" };
    }

    const description = parsedDescription.data;
    const resolvedDelta = this.resolveDelta(description);
    if (!resolvedDelta.ok) {
      return resolvedDelta;
    }

    if (
      !moneyMapsEqual(parsedDelta.data, resolvedDelta.delta) ||
      sumMoneyMap(resolvedDelta.delta) !== 0
    ) {
      return { ok: false, error: "invalid_record" };
    }

    // Require every member referenced by either the description or delta to be active.
    const referencedMemberIds = new Set<number>();
    for (const memberId of Object.keys(resolvedDelta.delta)) {
      referencedMemberIds.add(Number(memberId));
    }
    if (description.type === "expense") {
      for (const memberId of Object.keys(description.paid)) {
        referencedMemberIds.add(Number(memberId));
      }
      for (const memberId of Object.keys(description.liability)) {
        referencedMemberIds.add(Number(memberId));
      }
    }
    if (description.type === "transfer") {
      referencedMemberIds.add(description.from);
      referencedMemberIds.add(description.to);
    }
    for (const memberId of referencedMemberIds) {
      const member = this.getMember(memberId);
      if (!member || member.deleted_at !== null) {
        return { ok: false, error: "invalid_record" };
      }
    }

    const id = access.meta.next_record_id;
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
    this.ctx.storage.sql.exec(
      "UPDATE project_meta SET next_record_id = ?, updated_at = ? WHERE id = 1",
      id + 1,
      input.nowMs,
    );

    return { ok: true, id };
  }

  getRecords(input: { callerEmail?: string | null; limit: number; offset: number }):
    | {
        ok: true;
        owner: string;
        acl: ProjectAcl;
        members: ProjectMember[];
        records: ProjectRecord[];
        balance: MoneyByMemberId;
      }
    | { ok: false; error: "uninitialized" | "forbidden" } {
    const access = this.getProjectAccess(input.callerEmail);
    if (!access.ok) {
      return access;
    }

    const requesterMember = access.email ? this.getLinkedMember(access.email) : null;
    const limit = Math.min(PROJECT_RECORD_MAX_LIMIT, Math.max(1, Math.floor(input.limit)));
    const offset = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.floor(input.offset)));
    const records = this.ctx.storage.sql
      .exec<RecordRow>(
        `SELECT id, author_member_id, description_type, description_json, delta_json, reverts_record_id, created_at
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
      owner: access.meta.owner_email,
      acl: this.getAcl(access.meta),
      members: this.getMembersForResponse({
        requesterIsOwner: access.isOwner,
        requesterMemberId: requesterMember?.id,
      }),
      records,
      balance,
    };
  }

  createMember(input: {
    callerEmail: string;
    name: string;
    nowMs: number;
  }): { ok: true; member: ProjectMember } | { ok: false; error: ProjectStoreError } {
    // initialization checked in `getProjectAccess`
    const access = this.getProjectAccess(input.callerEmail);
    if (!access.ok) {
      return access;
    }
    if (!access.isOwner) {
      return { ok: false, error: "forbidden" };
    }

    const parsed = projectMemberCreateSchema.safeParse({ name: input.name });
    if (!parsed.success || this.hasActiveMemberName(parsed.data.name)) {
      return { ok: false, error: "invalid_input" };
    }

    const member = this.createNextMember({
      name: parsed.data.name,
      linkedEmail: null,
      nowMs: input.nowMs,
      meta: access.meta,
    });
    return { ok: true, member: memberForResponse(member, true) };
  }

  joinProject(input: {
    callerEmail: string;
    join: ProjectJoinInput;
    nowMs: number;
  }): { ok: true; member: ProjectMember } | { ok: false; error: ProjectStoreError } {
    const access = this.getProjectAccess(input.callerEmail);
    if (!access.ok) {
      return access;
    }
    if (!access.email) {
      return { ok: false, error: "forbidden" };
    }

    const parsed = projectJoinSchema.safeParse(input.join);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }
    if (this.getLinkedMember(access.email)) {
      return { ok: false, error: "already_linked" };
    }

    if ("memberId" in parsed.data) {
      // claim unlinked member
      const member = this.getMember(parsed.data.memberId);
      if (!member || member.deleted_at !== null) {
        return { ok: false, error: "not_found" };
      }
      if (member.linked_email !== null) {
        return { ok: false, error: "already_linked" };
      }
      this.ctx.storage.sql.exec(
        "UPDATE members SET linked_email = ?, updated_at = ? WHERE id = ?",
        access.email,
        input.nowMs,
        member.id,
      );
      return {
        ok: true,
        member: memberForResponse({ ...member, linked_email: access.email }, true),
      };
    }

    // create new member
    if (this.hasActiveMemberName(parsed.data.name)) {
      return { ok: false, error: "invalid_input" };
    }

    const member = this.createNextMember({
      name: parsed.data.name,
      linkedEmail: access.email,
      nowMs: input.nowMs,
      meta: access.meta,
    });
    return { ok: true, member: memberForResponse(member, true) };
  }

  patchMember(input: {
    callerEmail: string;
    memberId: number;
    patch: ProjectMemberPatch;
    nowMs: number;
  }): { ok: true; member: ProjectMember } | { ok: false; error: ProjectStoreError } {
    const access = this.getProjectAccess(input.callerEmail);
    if (!access.ok) {
      return access;
    }

    const parsed = projectMemberPatchSchema.safeParse(input.patch);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    const member = this.getMember(input.memberId);
    if (!member) {
      return { ok: false, error: "not_found" };
    }
    if (member.deleted_at !== null) {
      return { ok: false, error: "already_deleted" };
    }

    const requesterOwnsMember = member.linked_email === access.email;
    if (!access.isOwner && !requesterOwnsMember) {
      return { ok: false, error: "forbidden" };
    }

    let nextMember = member;
    if (parsed.data.name !== undefined) {
      const normalizedName = normalizeMemberNameForUnique(parsed.data.name);
      if (this.hasActiveMemberName(parsed.data.name, member.id)) {
        return { ok: false, error: "invalid_input" };
      }
      this.ctx.storage.sql.exec(
        "UPDATE members SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?",
        parsed.data.name,
        normalizedName,
        input.nowMs,
        member.id,
      );
      nextMember = { ...nextMember, name: parsed.data.name, normalized_name: normalizedName };
    }

    if (parsed.data.email === "") {
      this.ctx.storage.sql.exec(
        "UPDATE members SET linked_email = NULL, updated_at = ? WHERE id = ?",
        input.nowMs,
        member.id,
      );
      nextMember = { ...nextMember, linked_email: null };
    }

    return {
      ok: true,
      member: memberForResponse(nextMember, access.isOwner || requesterOwnsMember),
    };
  }

  deleteMember(input: {
    callerEmail: string;
    memberId: number;
    nowMs: number;
  }): { ok: true } | { ok: false; error: ProjectStoreError } {
    const access = this.getProjectAccess(input.callerEmail);
    if (!access.ok) {
      return access;
    }
    if (!access.isOwner) {
      return { ok: false, error: "forbidden" };
    }

    const member = this.getMember(input.memberId);
    if (!member) {
      return { ok: false, error: "not_found" };
    }
    if (member.deleted_at !== null) {
      return { ok: false, error: "already_deleted" };
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
    return { ok: true };
  }

  appendEmailsToAcl(input: {
    callerEmail: string;
    emails: string[];
  }): { ok: true } | { ok: false; error: "uninitialized" | "forbidden" | "invalid_input" } {
    const ownerAccess = this.getOwnerAccess(input.callerEmail);
    if (!ownerAccess.ok) {
      return ownerAccess;
    }

    const parsed = projectAclEmailsSchema.safeParse({ emails: input.emails });
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    for (const email of parsed.data.emails) {
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO acl_allowed_list (email) VALUES (?)", email);
    }
    this.touchProject();
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

    const parsed = projectAclEmailsSchema.safeParse({ emails: input.emails });
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    for (const email of parsed.data.emails) {
      this.ctx.storage.sql.exec("DELETE FROM acl_allowed_list WHERE email = ?", email);
    }
    this.touchProject();
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

    const parsed = projectAclTypeSchema.safeParse({ type: input.type });
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }

    this.ctx.storage.sql.exec(
      "UPDATE project_meta SET acl_type = ?, updated_at = ? WHERE id = 1",
      parsed.data.type,
      Date.now(),
    );
    return { ok: true };
  }

  private getProjectAccess(
    callerEmail: string | null | undefined,
  ):
    | { ok: true; email: string | null; isOwner: boolean; meta: ProjectMetaRow }
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
    | { ok: true; email: string; meta: ProjectMetaRow }
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

  private getMeta(): ProjectMetaRow | null {
    return (
      this.ctx.storage.sql
        .exec<ProjectMetaRow>(
          "SELECT owner_email, acl_type, next_record_id, next_member_id FROM project_meta WHERE id = 1",
        )
        .toArray()[0] ?? null
    );
  }

  private getAcl(meta: ProjectMetaRow): ProjectAcl {
    if (meta.acl_type === "public") {
      return { type: "public" };
    }

    const emails = this.ctx.storage.sql
      .exec<AclAllowedListRow>("SELECT email FROM acl_allowed_list ORDER BY email")
      .toArray()
      .map((row) => row.email);
    return { type: "restricted", emails };
  }

  private isAuthorized(email: string | null, isOwner: boolean, meta: ProjectMetaRow): boolean {
    if (meta.acl_type === "public" || isOwner) {
      return true;
    }
    if (!email) {
      return false;
    }

    const allowedEmail = this.ctx.storage.sql
      .exec<AclAllowedListRow>("SELECT email FROM acl_allowed_list WHERE email = ?", email)
      .toArray()[0];
    return allowedEmail !== undefined;
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

  private getMembersForResponse(input: {
    requesterIsOwner: boolean;
    requesterMemberId?: number;
  }): ProjectMember[] {
    return this.ctx.storage.sql
      .exec<MemberRow>(
        `SELECT id, name, normalized_name, linked_email, deleted_at, created_at, updated_at
         FROM members
         ORDER BY id`,
      )
      .toArray()
      .map((member) =>
        memberForResponse(member, input.requesterIsOwner || member.id === input.requesterMemberId),
      );
  }

  private hasActiveMemberName(name: string, exceptMemberId?: number): boolean {
    const normalizedName = normalizeMemberNameForUnique(name);
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

  private createNextMember(input: {
    name: string;
    linkedEmail: string | null;
    nowMs: number;
    meta: ProjectMetaRow;
  }): MemberRow {
    const id = input.meta.next_member_id;
    this.insertMember({
      id,
      name: input.name,
      linkedEmail: input.linkedEmail,
      nowMs: input.nowMs,
    });
    this.ctx.storage.sql.exec(
      "UPDATE project_meta SET next_member_id = ?, updated_at = ? WHERE id = 1",
      id + 1,
      input.nowMs,
    );
    return this.getMember(id) as MemberRow;
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
      normalizeMemberNameForUnique(input.name),
      input.linkedEmail,
      input.nowMs,
      input.nowMs,
    );
  }

  private applyBalanceDelta(delta: MoneyByMemberId): void {
    for (const [memberId, amount] of Object.entries(delta)) {
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

  /**
   * Update `updated_at` for project metadata.
   */
  private touchProject(): void {
    this.ctx.storage.sql.exec("UPDATE project_meta SET updated_at = ? WHERE id = 1", Date.now());
  }

  private resolveDelta(
    description: RecordDescription,
  ):
    | { ok: true; delta: MoneyByMemberId }
    | { ok: false; error: "invalid_record" | "not_found" | "already_reverted" } {
    if (description.type !== "revert") {
      const delta = deriveDescriptionDelta(description);
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

    return { ok: true, delta: negateMoneyMap(JSON.parse(target.delta_json) as MoneyByMemberId) };
  }
}

function normalizeProjectEmail(email: string): string | null {
  const parsed = normalizedEmailSchema.safeParse(email);
  return parsed.success ? parsed.data : null;
}

function memberForResponse(member: MemberRow, includeEmail: boolean): ProjectMember {
  return {
    id: member.id,
    name: member.name,
    deleted: member.deleted_at !== null,
    ...(includeEmail && member.linked_email ? { linkedEmail: member.linked_email } : {}),
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
