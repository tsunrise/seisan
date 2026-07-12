import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { type AppContext, type EnvWithIdentity, getRequiredIdentity, requireAuth } from "../auth";
import { normalizeEmail } from "../email";
import { ErrorResponse } from "../error";
import { errorResponses, OpenApiResponses, OpenApiSecurity } from "../model";
import { PROJECTS_REGISTRY_NAME, type ProjectSummary, type WithSyncTime } from "../project";

const REGISTRY_LIST_CACHE_TTL_SECONDS = 10;
const REGISTRY_LIST_CACHE_NAME = "seisan-registry";
const REGISTRY_LIST_CACHE_HOST = "cache.seisan.waga.me";

interface RegistryListCacheBody {
  projects: Array<WithSyncTime<ProjectSummary>>;
}

export const registryApp = new Hono<EnvWithIdentity>();

registryApp.get(
  "/registry",
  describeRoute({
    tags: ["Registry"],
    summary: "List projects visible to the authenticated caller",
    description:
      "Lists projects linked to the authenticated account, including its project-local member and current cent-denominated balance.",
    security: OpenApiSecurity.ApiKeyBearer,
    responses: {
      200: OpenApiResponses.Registry,
      ...errorResponses(400, 401),
    },
  }),
  requireAuth,
  async (context) => {
    const identity = getRequiredIdentity(context);
    const email = normalizeEmail(identity.email);
    const cached = await RegistryListCache.read(email);
    if (cached) {
      return cached;
    }

    const registry = context.env.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME);
    const listed = await registry.listProjects({ callerEmail: email });
    if (!listed.ok) {
      return ErrorResponse.invalidRequest();
    }
    const body = { projects: listed.projects };
    RegistryListCache.write(context, email, body);
    return new Response(JSON.stringify(body), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  },
);

class RegistryListCache {
  static async read(email: string): Promise<Response | null> {
    try {
      const cache = await caches.open(REGISTRY_LIST_CACHE_NAME);
      const cached = await cache.match(this.key(email));
      if (!cached) {
        return null;
      }

      const headers = new Headers(cached.headers);
      headers.set("Cache-Control", "private, no-store");
      return new Response(cached.body, { status: cached.status, headers });
    } catch (error) {
      console.error("failed to read registry list cache", error);
      return null;
    }
  }

  static write(context: AppContext, email: string, body: RegistryListCacheBody): void {
    const cacheWrite = (async () => {
      const cache = await caches.open(REGISTRY_LIST_CACHE_NAME);
      await cache.put(
        this.key(email),
        new Response(JSON.stringify(body), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `s-maxage=${REGISTRY_LIST_CACHE_TTL_SECONDS}`,
          },
        }),
      );
    })().catch((error: unknown) => {
      console.error("failed to write registry list cache", { email, error });
    });
    context.executionCtx.waitUntil(cacheWrite);
  }

  private static key(email: string): Request {
    return new Request(`https://${REGISTRY_LIST_CACHE_HOST}/registry/${encodeURIComponent(email)}`);
  }
}
