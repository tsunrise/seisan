import { DurableObject } from "cloudflare:workers";

import {
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
    nowMs: number;
  }): { ok: true } | { ok: false; error: "already_exists" | "invalid_input" } {
    const projectId = projectIdSchema.safeParse(input.id);
    if (!projectId.success || !durableObjectIdRegex.test(input.doId)) {
      return { ok: false, error: "invalid_input" };
    }

    const existing = this.ctx.storage.sql
      .exec<ProjectRow>("SELECT id FROM projects WHERE id = ?", projectId.data)
      .toArray()[0];
    if (existing) {
      return { ok: false, error: "already_exists" };
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO projects (id, do_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      projectId.data,
      input.doId,
      input.nowMs,
      input.nowMs,
    );
    this.scheduleProjectCacheWrite({
      id: projectId.data,
      doId: input.doId,
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
