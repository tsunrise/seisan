import { DurableObject } from "cloudflare:workers";

import { type ProjectMember, type ProjectSummary, type WithSyncTime, ProjectId } from "../project";
import { LimitsPolicy, type ProductLimits } from "../limits";
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
  ];

  private readonly bindings: Env;
  private projectStoreMetadataTouchBackfill: Promise<void> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.bindings = env;
    state.blockConcurrencyWhile(() => runSqlMigrations(state, ProjectsRegistry.migrations));
  }

  registerProject(input: {
    id: string;
    doId: string;
    ownerEmail: string;
    limits: ProductLimits;
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
    limits: ProductLimits;
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
          (project_id, name, owner_email, updated_at, summary_synced_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
          name = excluded.name,
          owner_email = excluded.owner_email,
          updated_at = excluded.updated_at,
          summary_synced_at = excluded.summary_synced_at`,
        input.id,
        input.name,
        input.owner,
        input.updatedAt,
        input.lastSyncAt,
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
    await this.runProjectStoreMetadataTouchBackfill();

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

  private async runProjectStoreMetadataTouchBackfill(): Promise<void> {
    if (!this.projectStoreMetadataTouchBackfill) {
      // TODO: remove this after backfill 20260615-project-store-metadata-touch is fully done.
      this.projectStoreMetadataTouchBackfill = backfill(
        this.ctx,
        "20260615-project-store-metadata-touch",
        async () => {
          await this.touchProjectStoresForMetadataBackfill();
          return null;
        },
      ).finally(() => {
        this.projectStoreMetadataTouchBackfill = null;
      });
    }

    await this.projectStoreMetadataTouchBackfill;
  }

  private async touchProjectStoresForMetadataBackfill(): Promise<void> {
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
        const backfilled = await projectStore.ensureMetadataBackfilled({ publicId: project.id });
        if (!backfilled.ok) {
          console.error("failed to backfill project metadata", {
            projectId: project.id,
            error: backfilled.error,
          });
        }
      } catch (error) {
        console.error("failed to backfill project metadata", {
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
