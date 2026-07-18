import { DurableObject } from "cloudflare:workers";

import { ProjectId, type ProjectMember, type ProjectSummary, type WithSyncTime } from "../project";
import { LimitsPolicy, type Limits } from "../limits";
import { backfill, runSqlMigrations, type SqlMigration } from "./migrations";

interface ProjectRow extends Record<string, SqlStorageValue> {
  id: string;
  do_id: string;
  owner_email: string | null;
  created_at: number;
  updated_at: number;
}

interface ProjectMemberRow extends Record<string, SqlStorageValue> {
  id: string;
  do_id: string;
  name: string | null;
  owner_email: string | null;
  member_json: string | null;
  balance_cents: number | null;
  project_updated_at: number | null;
  summary_synced_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ProjectSummaryRow extends Record<string, SqlStorageValue> {
  id: string;
  name: string;
  owner_email: string;
  member_json: string;
  balance_cents: number | null;
  record_count: number;
  project_updated_at: number;
  summary_synced_at: number;
}

interface AdminProjectRow extends Record<string, SqlStorageValue> {
  id: string;
  name: string;
  owner_email: string;
  record_count: number;
  member_count: number;
  project_updated_at: number;
  summary_synced_at: number;
}

interface AdminOwnerRow extends Record<string, SqlStorageValue> {
  owner_email: string;
  project_count: number;
  record_count: number;
  updated_at: number;
}

interface CountRow extends Record<string, SqlStorageValue> {
  count: number;
}

export interface ProjectSummarySyncMember {
  email: string;
  member: ProjectMember;
  balance: number | null;
}

export interface ProjectSummarySyncInput {
  id: string;
  name: string;
  owner: string;
  updatedAt: number;
  lastSyncAt: number;
  recordCount: number;
  members: ProjectSummarySyncMember[];
}

// TODO(schema-source): move registry admin result shapes to canonical schemas shared with the
// frontend API client instead of maintaining parallel interfaces.
export interface AdminPage {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

export interface AdminProject {
  id: string;
  name: string;
  owner: string;
  recordCount: number;
  memberCount: number;
  updatedAt: number;
  lastSyncAt: number;
}

export interface AdminOwnerSummary {
  owner: string;
  projectCount: number;
  recordCount: number;
  updatedAt: number;
}

export type AdminProjectSort = "records_desc" | "updated_desc" | "updated_asc";

const durableObjectIdRegex = /^[0-9a-f]{64}$/u;
const PROJECT_CACHE_REPAIR_AFTER_MS = 10 * 60 * 1000;

export class ProjectsRegistry extends DurableObject<Env> {
  static readonly migrations: SqlMigration[] = [
    [
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        do_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ],
    [
      `CREATE TABLE IF NOT EXISTS project_members (
        email TEXT NOT NULL,
        project_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (email, project_id)
      )`,
      `CREATE INDEX IF NOT EXISTS project_members_email_updated_idx
        ON project_members(email, updated_at DESC)`,
    ],
    [
      `CREATE TABLE IF NOT EXISTS project_summaries (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        summary_synced_at INTEGER NOT NULL
      )`,
      `ALTER TABLE project_members ADD COLUMN member_json TEXT`,
      `ALTER TABLE project_members ADD COLUMN balance_cents INTEGER`,
      `CREATE INDEX IF NOT EXISTS project_summaries_updated_idx
        ON project_summaries(updated_at DESC)`,
    ],
    [
      `ALTER TABLE projects ADD COLUMN owner_email TEXT`,
      `UPDATE projects
       SET owner_email = (
        SELECT owner_email
        FROM project_summaries
        WHERE project_summaries.project_id = projects.id
       )
       WHERE owner_email IS NULL`,
      `CREATE INDEX IF NOT EXISTS projects_owner_email_idx ON projects(owner_email)`,
    ],
    [
      `ALTER TABLE project_summaries ADD COLUMN record_count INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS project_summaries_record_count_idx
        ON project_summaries(record_count DESC, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS project_summaries_owner_record_count_idx
        ON project_summaries(owner_email, record_count DESC, updated_at DESC)`,
    ],
    [
      `CREATE INDEX IF NOT EXISTS project_summaries_updated_record_count_idx
        ON project_summaries(updated_at DESC, record_count DESC)`,
      `CREATE INDEX IF NOT EXISTS project_summaries_owner_updated_idx
        ON project_summaries(owner_email, updated_at DESC, record_count DESC)`,
    ],
  ];

  private readonly bindings: Env;
  private projectSummaryRecordCountBackfill: Promise<void> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.bindings = env;
    state.blockConcurrencyWhile(() => runSqlMigrations(state, ProjectsRegistry.migrations));
  }

  registerProject(input: {
    id: string;
    doId: string;
    ownerEmail: string;
    limits: Limits;
    nowMs: number;
  }):
    | { ok: true }
    | { ok: false; error: "already_exists" | "invalid_input" | "project_limit_exceeded" } {
    if (!durableObjectIdRegex.test(input.doId)) {
      return { ok: false, error: "invalid_input" };
    }

    const existing = this.ctx.storage.sql
      .exec<ProjectRow>("SELECT id FROM projects WHERE id = ?", input.id)
      .toArray()[0];
    if (existing) {
      return { ok: false, error: "already_exists" };
    }
    const policy = new LimitsPolicy(input.limits);
    if (
      !policy.allowsAdditionalLinkedProject(this.countProjectsForEmail(input.ownerEmail)) ||
      !policy.allowsAdditionalOwnedProject(this.countOwnedProjectsForEmail(input.ownerEmail))
    ) {
      return { ok: false, error: "project_limit_exceeded" };
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO projects (id, do_id, owner_email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        input.id,
        input.doId,
        input.ownerEmail,
        input.nowMs,
        input.nowMs,
      );
      this.insertProjectMember({
        projectId: input.id,
        email: input.ownerEmail,
        nowMs: input.nowMs,
      });
    });
    this.scheduleProjectCacheWrite({
      id: input.id,
      doId: input.doId,
    });

    return { ok: true };
  }

  addProjectMember(input: {
    id: string;
    email: string;
    limits: Limits;
    nowMs: number;
  }):
    | { ok: true; alreadyMember: boolean }
    | { ok: false; error: "invalid_input" | "not_found" | "project_limit_exceeded" } {
    if (!this.hasProject(input.id)) {
      return { ok: false, error: "not_found" };
    }
    const alreadyMember = this.hasProjectMember(input.id, input.email);
    const policy = new LimitsPolicy(input.limits);
    if (
      !alreadyMember &&
      !policy.allowsAdditionalLinkedProject(this.countProjectsForEmail(input.email))
    ) {
      return { ok: false, error: "project_limit_exceeded" };
    }

    this.insertProjectMember({
      projectId: input.id,
      email: input.email,
      nowMs: input.nowMs,
    });
    return { ok: true, alreadyMember };
  }

  removeProjectMember(input: {
    id: string;
    email: string;
  }): { ok: true } | { ok: false; error: "invalid_input" } {
    this.ctx.storage.sql.exec(
      "DELETE FROM project_members WHERE email = ? AND project_id = ?",
      input.email,
      input.id,
    );
    return { ok: true };
  }

  syncProjectSummary(
    input: ProjectSummarySyncInput,
  ): { ok: true } | { ok: false; error: "invalid_input" | "not_found" } {
    if (!this.hasProject(input.id)) {
      return { ok: false, error: "not_found" };
    }
    if (!Number.isSafeInteger(input.recordCount) || input.recordCount < 0) {
      return { ok: false, error: "invalid_input" };
    }

    const members = new Map<string, ProjectSummarySyncMember>();
    for (const member of input.members) {
      members.set(member.email, {
        email: member.email,
        member: member.member,
        balance: member.balance,
      });
    }
    if (!members.has(input.owner)) {
      return { ok: false, error: "invalid_input" };
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO project_summaries
          (project_id, name, owner_email, updated_at, summary_synced_at, record_count)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
          name = excluded.name,
          owner_email = excluded.owner_email,
          updated_at = excluded.updated_at,
          summary_synced_at = excluded.summary_synced_at,
          record_count = excluded.record_count`,
        input.id,
        input.name,
        input.owner,
        input.updatedAt,
        input.lastSyncAt,
        input.recordCount,
      );
      this.ctx.storage.sql.exec(
        "UPDATE projects SET owner_email = ? WHERE id = ?",
        input.owner,
        input.id,
      );

      const memberEmails = [...members.keys()];
      if (memberEmails.length > 0) {
        const placeholders = memberEmails.map(() => "?").join(", ");
        this.ctx.storage.sql.exec(
          `DELETE FROM project_members
           WHERE project_id = ? AND email NOT IN (${placeholders})`,
          input.id,
          ...memberEmails,
        );
      } else {
        this.ctx.storage.sql.exec("DELETE FROM project_members WHERE project_id = ?", input.id);
      }

      for (const member of members.values()) {
        this.ctx.storage.sql.exec(
          `INSERT INTO project_members
            (email, project_id, created_at, updated_at, member_json, balance_cents)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(email, project_id) DO UPDATE SET
            updated_at = excluded.updated_at,
            member_json = excluded.member_json,
            balance_cents = excluded.balance_cents`,
          member.email,
          input.id,
          input.lastSyncAt,
          input.updatedAt,
          JSON.stringify(member.member),
          member.balance,
        );
      }
    });

    return { ok: true };
  }

  async lookupProject(
    id: string,
  ): Promise<{ ok: true; doId: string } | { ok: false; error: "not_found" }> {
    const projectId = ProjectId.safeParse(id);
    if (!projectId.success) {
      return { ok: false, error: "not_found" };
    }

    const project = this.ctx.storage.sql
      .exec<ProjectRow>(
        "SELECT id, do_id, created_at, updated_at FROM projects WHERE id = ?",
        projectId.data,
      )
      .toArray()[0];
    if (!project) {
      return { ok: false, error: "not_found" };
    }

    this.scheduleProjectCacheRepair(project);

    return { ok: true, doId: project.do_id };
  }

  async listProjects(input: {
    callerEmail: string;
  }): Promise<
    | { ok: true; projects: Array<WithSyncTime<ProjectSummary>> }
    | { ok: false; error: "invalid_input" }
  > {
    const projects = this.ctx.storage.sql
      .exec<ProjectSummaryRow>(
        `SELECT
          projects.id,
          project_summaries.name,
          project_summaries.owner_email,
          project_members.member_json,
          project_members.balance_cents,
          project_summaries.record_count,
          project_summaries.updated_at AS project_updated_at,
          project_summaries.summary_synced_at
         FROM project_members
         JOIN projects ON projects.id = project_members.project_id
         JOIN project_summaries ON project_summaries.project_id = projects.id
         WHERE project_members.email = ?
         ORDER BY project_summaries.updated_at DESC`,
        input.callerEmail,
      )
      .toArray()
      .map((project) => ({
        id: project.id,
        name: project.name,
        owner: project.owner_email,
        member: parseProjectMember(project.member_json),
        balance: project.balance_cents,
        updatedAt: project.project_updated_at,
        lastSyncAt: project.summary_synced_at,
      }));

    return { ok: true, projects };
  }

  async adminListProjects(input: {
    limit: number;
    offset: number;
    ownerEmail?: string;
    sort: AdminProjectSort;
  }): Promise<
    { ok: true; projects: AdminProject[]; page: AdminPage } | { ok: false; error: "invalid_input" }
  > {
    if (!isValidPageInput(input.limit, input.offset)) {
      return { ok: false, error: "invalid_input" };
    }
    const orderClause = adminProjectOrderClause(input.sort);
    if (!orderClause) {
      return { ok: false, error: "invalid_input" };
    }

    await this.runProjectSummaryRecordCountBackfill();

    const total = this.countProjects(input.ownerEmail);
    const projects = (
      input.ownerEmail
        ? this.ctx.storage.sql.exec<AdminProjectRow>(
            `SELECT
              projects.id,
              project_summaries.name,
              project_summaries.owner_email,
              project_summaries.record_count,
              (
                SELECT COUNT(*)
                FROM project_members
                WHERE project_members.project_id = projects.id
              ) AS member_count,
              project_summaries.updated_at AS project_updated_at,
              project_summaries.summary_synced_at
             FROM projects
             JOIN project_summaries ON project_summaries.project_id = projects.id
             WHERE project_summaries.owner_email = ?
             ORDER BY ${orderClause}
             LIMIT ? OFFSET ?`,
            input.ownerEmail,
            input.limit,
            input.offset,
          )
        : this.ctx.storage.sql.exec<AdminProjectRow>(
            `SELECT
              projects.id,
              project_summaries.name,
              project_summaries.owner_email,
              project_summaries.record_count,
              (
                SELECT COUNT(*)
                FROM project_members
                WHERE project_members.project_id = projects.id
              ) AS member_count,
              project_summaries.updated_at AS project_updated_at,
              project_summaries.summary_synced_at
             FROM projects
             JOIN project_summaries ON project_summaries.project_id = projects.id
             ORDER BY ${orderClause}
             LIMIT ? OFFSET ?`,
            input.limit,
            input.offset,
          )
    ).toArray();

    return {
      ok: true,
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        owner: project.owner_email,
        recordCount: project.record_count,
        memberCount: project.member_count,
        updatedAt: project.project_updated_at,
        lastSyncAt: project.summary_synced_at,
      })),
      page: {
        limit: input.limit,
        offset: input.offset,
        total,
        hasMore: input.offset + projects.length < total,
      },
    };
  }

  async adminListOwners(input: {
    limit: number;
    offset: number;
  }): Promise<
    | { ok: true; users: AdminOwnerSummary[]; page: AdminPage }
    | { ok: false; error: "invalid_input" }
  > {
    if (!isValidPageInput(input.limit, input.offset)) {
      return { ok: false, error: "invalid_input" };
    }

    await this.runProjectSummaryRecordCountBackfill();

    const total =
      this.ctx.storage.sql
        .exec<CountRow>("SELECT COUNT(DISTINCT owner_email) AS count FROM project_summaries")
        .toArray()[0]?.count ?? 0;
    const users = this.ctx.storage.sql
      .exec<AdminOwnerRow>(
        `SELECT
          owner_email,
          COUNT(*) AS project_count,
          COALESCE(SUM(record_count), 0) AS record_count,
          MAX(updated_at) AS updated_at
         FROM project_summaries
         GROUP BY owner_email
         ORDER BY project_count DESC, record_count DESC, owner_email ASC
         LIMIT ? OFFSET ?`,
        input.limit,
        input.offset,
      )
      .toArray()
      .map((user) => ({
        owner: user.owner_email,
        projectCount: user.project_count,
        recordCount: user.record_count,
        updatedAt: user.updated_at,
      }));

    return {
      ok: true,
      users,
      page: {
        limit: input.limit,
        offset: input.offset,
        total,
        hasMore: input.offset + users.length < total,
      },
    };
  }

  private async runProjectSummaryRecordCountBackfill(): Promise<void> {
    if (!this.projectSummaryRecordCountBackfill) {
      // TODO: remove this after backfill 20260620-project-summary-record-count is fully done.
      this.projectSummaryRecordCountBackfill = backfill(
        this.ctx,
        "20260620-project-summary-record-count",
        async () => {
          await this.touchProjectStoresForSummaryBackfill();
          return null;
        },
      ).finally(() => {
        this.projectSummaryRecordCountBackfill = null;
      });
    }

    await this.projectSummaryRecordCountBackfill;
  }

  private async touchProjectStoresForSummaryBackfill(): Promise<void> {
    const projects = this.ctx.storage.sql
      .exec<ProjectRow>(
        `SELECT id, do_id, created_at, updated_at
         FROM projects
         ORDER BY created_at`,
      )
      .toArray();

    for (const project of projects) {
      const projectStore = this.bindings.PROJECT_STORE.get(
        this.bindings.PROJECT_STORE.idFromString(project.do_id),
      );
      try {
        const synced = await projectStore.sendSummaryToRegistry({ publicId: project.id });
        if (!synced.ok) {
          console.error("failed to backfill project summary record count", {
            projectId: project.id,
            error: synced.error,
          });
        }
      } catch (error) {
        console.error("failed to backfill project summary record count", {
          projectId: project.id,
          error,
        });
      }
    }
  }

  private countProjects(ownerEmail: string | undefined): number {
    return (
      (ownerEmail
        ? this.ctx.storage.sql.exec<CountRow>(
            "SELECT COUNT(*) AS count FROM project_summaries WHERE owner_email = ?",
            ownerEmail,
          )
        : this.ctx.storage.sql.exec<CountRow>("SELECT COUNT(*) AS count FROM project_summaries")
      ).toArray()[0]?.count ?? 0
    );
  }

  private hasProject(projectId: string): boolean {
    return (
      this.ctx.storage.sql
        .exec<ProjectRow>("SELECT id FROM projects WHERE id = ?", projectId)
        .toArray()[0] !== undefined
    );
  }

  private hasProjectMember(projectId: string, email: string): boolean {
    return (
      this.ctx.storage.sql
        .exec<ProjectMemberRow>(
          "SELECT project_id AS id FROM project_members WHERE email = ? AND project_id = ?",
          email,
          projectId,
        )
        .toArray()[0] !== undefined
    );
  }

  private countProjectsForEmail(email: string): number {
    return (
      this.ctx.storage.sql
        .exec<
          { count: number } & Record<string, SqlStorageValue>
        >("SELECT COUNT(*) AS count FROM project_members WHERE email = ?", email)
        .toArray()[0]?.count ?? 0
    );
  }

  private countOwnedProjectsForEmail(email: string): number {
    return (
      this.ctx.storage.sql
        .exec<
          { count: number } & Record<string, SqlStorageValue>
        >("SELECT COUNT(*) AS count FROM projects WHERE owner_email = ?", email)
        .toArray()[0]?.count ?? 0
    );
  }

  private insertProjectMember(input: { projectId: string; email: string; nowMs: number }): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO project_members (email, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email, project_id) DO UPDATE SET updated_at = excluded.updated_at`,
      input.email,
      input.projectId,
      input.nowMs,
      input.nowMs,
    );
  }

  private scheduleProjectCacheWrite(project: { id: string; doId: string }): void {
    const write = this.writeProjectCache(project).catch((error: unknown) => {
      console.error("failed to write project registry cache", { projectId: project.id, error });
    });
    this.ctx.waitUntil(write);
  }

  private scheduleProjectCacheRepair(project: ProjectRow): void {
    const repair = this.repairProjectCacheIfOld(project).catch((error: unknown) => {
      console.error("failed to repair project registry cache", { projectId: project.id, error });
    });
    this.ctx.waitUntil(repair);
  }

  private async repairProjectCacheIfOld(project: ProjectRow): Promise<void> {
    if (Date.now() - project.created_at < PROJECT_CACHE_REPAIR_AFTER_MS) {
      return;
    }

    const key = ProjectsRegistry.projectRefCacheKey(project.id);
    const cachedValue = await this.bindings.PROJECT_REGISTRY_CACHE.get(key);
    if (cachedValue === null) {
      await this.writeProjectCache({ id: project.id, doId: project.do_id });
    }
  }

  private async writeProjectCache(project: { id: string; doId: string }): Promise<void> {
    await this.bindings.PROJECT_REGISTRY_CACHE.put(
      ProjectsRegistry.projectRefCacheKey(project.id),
      ProjectsRegistry.serializeProjectRef({ doId: project.doId }),
    );
  }

  private static projectRefCacheKey(projectId: string): string {
    return `project:${projectId}`;
  }

  private static serializeProjectRef(project: { doId: string }): string {
    return JSON.stringify({ doId: project.doId });
  }
}

function isValidPageInput(limit: number, offset: number): boolean {
  return (
    Number.isSafeInteger(limit) &&
    limit >= 1 &&
    limit <= 100 &&
    Number.isSafeInteger(offset) &&
    offset >= 0
  );
}

function adminProjectOrderClause(sort: AdminProjectSort): string | null {
  switch (sort) {
    case "records_desc":
      return "project_summaries.record_count DESC, project_summaries.updated_at DESC, projects.id ASC";
    case "updated_desc":
      return "project_summaries.updated_at DESC, project_summaries.record_count DESC, projects.id ASC";
    case "updated_asc":
      return "project_summaries.updated_at ASC, project_summaries.record_count DESC, projects.id ASC";
    default:
      return null;
  }
}

function parseProjectMember(value: string | null): ProjectMember | null {
  if (!value) {
    return null;
  }
  try {
    const member = JSON.parse(value) as ProjectMember & { config?: unknown };
    delete member.config;
    return member;
  } catch {
    return null;
  }
}
