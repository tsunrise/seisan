import { DurableObject } from "cloudflare:workers";

import {
  PROJECTS_PER_USER_LIMIT,
  type ProjectMember,
  type ProjectSummary,
  type WithSyncTime,
  normalizedEmailSchema,
  projectIdSchema,
  projectRegistryCacheKey,
  serializeProjectRegistryCacheValue,
} from "../project";
import { backfill, runSqlMigrations, type SqlMigration } from "./migrations";

interface ProjectRow extends Record<string, SqlStorageValue> {
  id: string;
  do_id: string;
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
  project_updated_at: number;
  summary_synced_at: number;
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
  members: ProjectSummarySyncMember[];
}

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
  ];

  private readonly bindings: Env;
  private projectSummaryBackfill: Promise<void> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.bindings = env;
    state.blockConcurrencyWhile(() => runSqlMigrations(state, ProjectsRegistry.migrations));
  }

  registerProject(input: {
    id: string;
    doId: string;
    ownerEmail: string;
    nowMs: number;
  }):
    | { ok: true }
    | { ok: false; error: "already_exists" | "invalid_input" | "project_limit_exceeded" } {
    const projectId = projectIdSchema.safeParse(input.id);
    const ownerEmail = normalizedEmailSchema.safeParse(input.ownerEmail);
    if (!projectId.success || !ownerEmail.success || !durableObjectIdRegex.test(input.doId)) {
      return { ok: false, error: "invalid_input" };
    }

    const existing = this.ctx.storage.sql
      .exec<ProjectRow>("SELECT id FROM projects WHERE id = ?", projectId.data)
      .toArray()[0];
    if (existing) {
      return { ok: false, error: "already_exists" };
    }
    if (this.countProjectsForEmail(ownerEmail.data) >= PROJECTS_PER_USER_LIMIT) {
      return { ok: false, error: "project_limit_exceeded" };
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO projects (id, do_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        projectId.data,
        input.doId,
        input.nowMs,
        input.nowMs,
      );
      this.insertProjectMember({
        projectId: projectId.data,
        email: ownerEmail.data,
        nowMs: input.nowMs,
      });
    });
    this.scheduleProjectCacheWrite({
      id: projectId.data,
      doId: input.doId,
    });

    return { ok: true };
  }

  addProjectMember(input: {
    id: string;
    email: string;
    nowMs: number;
  }):
    | { ok: true; alreadyMember: boolean }
    | { ok: false; error: "invalid_input" | "not_found" | "project_limit_exceeded" } {
    const projectId = projectIdSchema.safeParse(input.id);
    const email = normalizedEmailSchema.safeParse(input.email);
    if (!projectId.success || !email.success) {
      return { ok: false, error: "invalid_input" };
    }

    if (!this.hasProject(projectId.data)) {
      return { ok: false, error: "not_found" };
    }
    const alreadyMember = this.hasProjectMember(projectId.data, email.data);
    if (!alreadyMember && this.countProjectsForEmail(email.data) >= PROJECTS_PER_USER_LIMIT) {
      return { ok: false, error: "project_limit_exceeded" };
    }

    this.insertProjectMember({
      projectId: projectId.data,
      email: email.data,
      nowMs: input.nowMs,
    });
    return { ok: true, alreadyMember };
  }

  removeProjectMember(input: {
    id: string;
    email: string;
  }): { ok: true } | { ok: false; error: "invalid_input" } {
    const projectId = projectIdSchema.safeParse(input.id);
    const email = normalizedEmailSchema.safeParse(input.email);
    if (!projectId.success || !email.success) {
      return { ok: false, error: "invalid_input" };
    }

    this.ctx.storage.sql.exec(
      "DELETE FROM project_members WHERE email = ? AND project_id = ?",
      email.data,
      projectId.data,
    );
    return { ok: true };
  }

  syncProjectSummary(
    input: ProjectSummarySyncInput,
  ): { ok: true } | { ok: false; error: "invalid_input" | "not_found" } {
    const projectId = projectIdSchema.safeParse(input.id);
    const ownerEmail = normalizedEmailSchema.safeParse(input.owner);
    if (!projectId.success || !ownerEmail.success) {
      return { ok: false, error: "invalid_input" };
    }
    if (!this.hasProject(projectId.data)) {
      return { ok: false, error: "not_found" };
    }

    const members = new Map<string, ProjectSummarySyncMember>();
    for (const member of input.members) {
      const parsedEmail = normalizedEmailSchema.safeParse(member.email);
      if (!parsedEmail.success) {
        return { ok: false, error: "invalid_input" };
      }
      members.set(parsedEmail.data, {
        email: parsedEmail.data,
        member: member.member,
        balance: member.balance,
      });
    }
    if (!members.has(ownerEmail.data)) {
      return { ok: false, error: "invalid_input" };
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO project_summaries
          (project_id, name, owner_email, updated_at, summary_synced_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
          name = excluded.name,
          owner_email = excluded.owner_email,
          updated_at = excluded.updated_at,
          summary_synced_at = excluded.summary_synced_at`,
        projectId.data,
        input.name,
        ownerEmail.data,
        input.updatedAt,
        input.lastSyncAt,
      );

      const memberEmails = [...members.keys()];
      if (memberEmails.length > 0) {
        const placeholders = memberEmails.map(() => "?").join(", ");
        this.ctx.storage.sql.exec(
          `DELETE FROM project_members
           WHERE project_id = ? AND email NOT IN (${placeholders})`,
          projectId.data,
          ...memberEmails,
        );
      } else {
        this.ctx.storage.sql.exec(
          "DELETE FROM project_members WHERE project_id = ?",
          projectId.data,
        );
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
          projectId.data,
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
    const projectId = projectIdSchema.safeParse(id);
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
    const callerEmail = normalizedEmailSchema.safeParse(input.callerEmail);
    if (!callerEmail.success) {
      return { ok: false, error: "invalid_input" };
    }

    await this.runProjectSummaryBackfill();

    const projects = this.ctx.storage.sql
      .exec<ProjectSummaryRow>(
        `SELECT
          projects.id,
          project_summaries.name,
          project_summaries.owner_email,
          project_members.member_json,
          project_members.balance_cents,
          project_summaries.updated_at AS project_updated_at,
          project_summaries.summary_synced_at
         FROM project_members
         JOIN projects ON projects.id = project_members.project_id
         JOIN project_summaries ON project_summaries.project_id = projects.id
         WHERE project_members.email = ?
         ORDER BY project_summaries.updated_at DESC`,
        callerEmail.data,
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

  private async runProjectSummaryBackfill(): Promise<void> {
    if (!this.projectSummaryBackfill) {
      // TODO: remove this after backfill 20260607-project-summary is fully done.
      this.projectSummaryBackfill = backfill(this.ctx, "20260607-project-summary", async () => {
        await this.backfillMissingProjectSummaries();
        return null;
      }).finally(() => {
        this.projectSummaryBackfill = null;
      });
    }

    await this.projectSummaryBackfill;
  }

  private async backfillMissingProjectSummaries(): Promise<void> {
    const projects = this.ctx.storage.sql
      .exec<ProjectRow>(
        `SELECT projects.id, projects.do_id, projects.created_at, projects.updated_at
         FROM projects
         LEFT JOIN project_summaries ON project_summaries.project_id = projects.id
         WHERE project_summaries.project_id IS NULL
         ORDER BY projects.created_at`,
      )
      .toArray();

    for (const project of projects) {
      const projectStore = this.bindings.PROJECT_STORE.get(
        this.bindings.PROJECT_STORE.idFromString(project.do_id),
      );
      try {
        const synced = await projectStore.sendSummaryToRegistry({ publicId: project.id });
        if (!synced.ok) {
          console.error("failed to backfill project summary", {
            projectId: project.id,
            error: synced.error,
          });
        }
      } catch (error) {
        console.error("failed to backfill project summary", {
          projectId: project.id,
          error,
        });
      }
    }
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

    const key = projectRegistryCacheKey(project.id);
    const cachedValue = await this.bindings.PROJECT_REGISTRY_CACHE.get(key);
    if (cachedValue === null) {
      await this.writeProjectCache({ id: project.id, doId: project.do_id });
    }
  }

  private async writeProjectCache(project: { id: string; doId: string }): Promise<void> {
    await this.bindings.PROJECT_REGISTRY_CACHE.put(
      projectRegistryCacheKey(project.id),
      serializeProjectRegistryCacheValue({ doId: project.doId }),
    );
  }
}

function parseProjectMember(value: string | null): ProjectMember | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as ProjectMember;
  } catch {
    return null;
  }
}
