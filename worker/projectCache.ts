import type { AppContext } from "./auth";
import { PROJECTS_LIST_CACHE_TTL_SECONDS, type ProjectSummary, type WithSyncTime } from "./project";

const PROJECTS_LIST_CACHE_NAME = "seisan-projects";
const PROJECTS_LIST_CACHE_HOST = "cache.seisan.waga.me";

export interface ProjectsListCacheBody {
  projects: Array<WithSyncTime<ProjectSummary>>;
}

function projectsListCacheKey(email: string): Request {
  return new Request(`https://${PROJECTS_LIST_CACHE_HOST}/projects/${encodeURIComponent(email)}`);
}

export async function getCachedProjectsList(email: string): Promise<Response | null> {
  try {
    const cache = await caches.open(PROJECTS_LIST_CACHE_NAME);
    const cached = await cache.match(projectsListCacheKey(email));
    if (!cached) {
      return null;
    }

    const headers = new Headers(cached.headers);
    headers.set("Cache-Control", "private, no-store");
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
    await cache.put(
      projectsListCacheKey(email),
      new Response(JSON.stringify(body), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `s-maxage=${PROJECTS_LIST_CACHE_TTL_SECONDS}`,
        },
      }),
    );
  })().catch((error: unknown) => {
    console.error("failed to write projects list cache", { email, error });
  });
  context.executionCtx.waitUntil(cacheWrite);
}
