import { DurableObject } from "cloudflare:workers";

import {
  normalizedEmailSchema,
  projectIdSchema,
  projectRegistryCacheKey,
  serializeProjectRegistryCacheValue,
} from "../project";
import { runSqlMigrations, type SqlMigration } from "./migrations";

interface ProjectRow extends Record<string, SqlStorageValue> {
  id: string;
  do_id: string;
  created_at: number;
  updated_at: number;
}

interface ProjectMemberRow extends Record<string, SqlStorageValue> {
  id: string;
  do_id: string;
  created_at: number;
  updated_at: number;
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
  ];

  private readonly bindings: Env;

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
  }): { ok: true } | { ok: false; error: "already_exists" | "invalid_input" } {
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
  }): { ok: true } | { ok: false; error: "invalid_input" | "not_found" } {
    const projectId = projectIdSchema.safeParse(input.id);
    const email = normalizedEmailSchema.safeParse(input.email);
    if (!projectId.success || !email.success) {
      return { ok: false, error: "invalid_input" };
    }

    if (!this.hasProject(projectId.data)) {
      return { ok: false, error: "not_found" };
    }

    this.insertProjectMember({
      projectId: projectId.data,
      email: email.data,
      nowMs: input.nowMs,
    });
    return { ok: true };
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
    | { ok: true; projects: Array<{ id: string; doId: string }> }
    | { ok: false; error: "invalid_input" }
  > {
    const callerEmail = normalizedEmailSchema.safeParse(input.callerEmail);
    if (!callerEmail.success) {
      return { ok: false, error: "invalid_input" };
    }

    const projects = this.ctx.storage.sql
      .exec<ProjectMemberRow>(
        `SELECT projects.id, projects.do_id, projects.created_at, project_members.updated_at
         FROM project_members
         JOIN projects ON projects.id = project_members.project_id
         WHERE project_members.email = ?
         ORDER BY project_members.updated_at DESC`,
        callerEmail.data,
      )
      .toArray()
      .map((project) => ({ id: project.id, doId: project.do_id }));

    return { ok: true, projects };
  }

  private hasProject(projectId: string): boolean {
    return (
      this.ctx.storage.sql
        .exec<ProjectRow>("SELECT id FROM projects WHERE id = ?", projectId)
        .toArray()[0] !== undefined
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
