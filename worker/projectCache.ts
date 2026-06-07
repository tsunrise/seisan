import type { AppContext } from "./auth";
import { PROJECTS_LIST_CACHE_TTL_SECONDS, type ProjectSummary, type WithSyncTime } from "./project";

const PROJECTS_LIST_CACHE_NAME = "seisan-projects";
const PROJECTS_LIST_CACHE_HOST = "cache.seisan.waga.me";
const PROJECTS_LIST_CACHE_EXPIRES_AT_HEADER = "X-Seisan-Cache-Expires-At";

export interface ProjectsListCacheBody {
  projects: Array<WithSyncTime<ProjectSummary>>;
}

export type ProjectsListCachePatch =
  | { type: "upsert"; project: ProjectSummary; lastSyncAt: number }
  | { type: "remove"; projectId: string };

function projectsListCacheKey(email: string): Request {
  return new Request(`https://${PROJECTS_LIST_CACHE_HOST}/projects/${encodeURIComponent(email)}`);
}

function parseProjectsListCacheBody(body: string): ProjectsListCacheBody | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { projects?: unknown }).projects)
    ) {
      return null;
    }
    return parsed as ProjectsListCacheBody;
  } catch {
    return null;
  }
}

function cacheHeaders(expiresAtMs: number): HeadersInit {
  const remainingSeconds = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
  return {
    "Content-Type": "application/json",
    "Cache-Control": `s-maxage=${remainingSeconds}`,
    Expires: new Date(expiresAtMs).toUTCString(),
    [PROJECTS_LIST_CACHE_EXPIRES_AT_HEADER]: String(expiresAtMs),
  };
}

function readCacheExpiresAt(response: Response): number | null {
  const raw = response.headers.get(PROJECTS_LIST_CACHE_EXPIRES_AT_HEADER);
  if (!raw) {
    return null;
  }
  const expiresAtMs = Number(raw);
  return Number.isSafeInteger(expiresAtMs) ? expiresAtMs : null;
}

export async function getCachedProjectsList(email: string): Promise<Response | null> {
  try {
    const cache = await caches.open(PROJECTS_LIST_CACHE_NAME);
    const cached = await cache.match(projectsListCacheKey(email));
    if (!cached) {
      return null;
    }
    const expiresAtMs = readCacheExpiresAt(cached);
    if (expiresAtMs === null) {
      await cache.delete(projectsListCacheKey(email));
      return null;
    }
    if (expiresAtMs <= Date.now()) {
      await cache.delete(projectsListCacheKey(email));
      return null;
    }
    const headers = new Headers(cached.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.delete(PROJECTS_LIST_CACHE_EXPIRES_AT_HEADER);
    return new Response(cached.body, { status: cached.status, headers });
  } catch (error) {
    console.error("failed to read projects list cache", error);
    return null;
  }
}

export function cacheProjectsList(
  context: AppContext,
  email: string,
  body: ProjectsListCacheBody,
): void {
  const cacheWrite = (async () => {
    const cache = await caches.open(PROJECTS_LIST_CACHE_NAME);
    const expiresAtMs = Date.now() + PROJECTS_LIST_CACHE_TTL_SECONDS * 1000;
    await cache.put(
      projectsListCacheKey(email),
      new Response(JSON.stringify(body), {
        headers: cacheHeaders(expiresAtMs),
      }),
    );
  })().catch((error: unknown) => {
    console.error("failed to write projects list cache", { email, error });
  });
  context.executionCtx.waitUntil(cacheWrite);
}

export function patchProjectsListCache(
  context: AppContext,
  input: { email: string; patch: ProjectsListCachePatch },
): void {
  const cachePatch = (async () => {
    const cache = await caches.open(PROJECTS_LIST_CACHE_NAME);
    const key = projectsListCacheKey(input.email);
    const cached = await cache.match(key);
    if (!cached) {
      return;
    }

    const expiresAtMs = readCacheExpiresAt(cached);
    if (expiresAtMs === null) {
      await cache.delete(key);
      return;
    }
    if (expiresAtMs <= Date.now()) {
      await cache.delete(key);
      return;
    }

    const cachedBody = parseProjectsListCacheBody(await cached.text());
    if (!cachedBody) {
      return;
    }

    const patch = input.patch;
    let projects: Array<WithSyncTime<ProjectSummary>>;
    if (patch.type === "remove") {
      projects = cachedBody.projects.filter((project) => project.id !== patch.projectId);
      if (projects.length === cachedBody.projects.length) {
        return;
      }
    } else {
      let patched = false;
      projects = cachedBody.projects.map((project) => {
        if (project.id !== patch.project.id) {
          return project;
        }
        patched = true;
        return {
          ...patch.project,
          lastSyncAt: patch.lastSyncAt,
        };
      });
      if (!patched) {
        projects.push({ ...patch.project, lastSyncAt: patch.lastSyncAt });
      }
      projects.sort((left, right) => right.updatedAt - left.updatedAt);
    }

    await cache.put(
      key,
      new Response(JSON.stringify({ projects }), {
        headers: cacheHeaders(expiresAtMs),
      }),
    );
  })().catch((error: unknown) => {
    console.error("failed to patch projects list cache", {
      email: input.email,
      patch: input.patch,
      error,
    });
  });
  context.executionCtx.waitUntil(cachePatch);
}
