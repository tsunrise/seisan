import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import {
  type AppContext,
  type EnvWithIdentity,
  getRequiredIdentity,
  parseJson,
  requireSameOrigin,
  requireSessionAuth,
} from "../auth";
import {
  CATEGORY_CONFIG_KEY,
  CategoryClassifier,
  CategoryClassificationName,
  CategoryClassificationTopK,
  CategoryDescription,
  CategoryIconName,
  CategoryId,
  CategoryName,
} from "../category";
import { sha256Hex } from "../crypto";
import { normalizeEmail } from "../email";
import { ErrorResponse } from "../error";
import { PublishedGlobalConfigKvStore } from "../globalConfig";
import { errorResponses, OpenApiResponses } from "../model";
import type { ErrorResultOf, Result } from "../result";

const DEFAULT_CLASSIFY_TOP_K = 5;

// TODO(schema-source): move category write and classification request schemas into the category
// domain and reuse them here and in worker/model.ts.
const CategoryWriteBody = z
  .object({
    name: CategoryName,
    description: CategoryDescription.optional().default(""),
    icon: CategoryIconName.optional(),
  })
  .strict();

const ClassifyCategoryBody = z
  .object({
    name: CategoryClassificationName,
    topK: CategoryClassificationTopK.optional().default(DEFAULT_CLASSIFY_TOP_K),
  })
  .strict();

export const categoryApp = new Hono<EnvWithIdentity>();
export const adminCategoryApp = new Hono<EnvWithIdentity>();

categoryApp.get(
  "/categories",
  describeRoute({
    tags: ["Categories"],
    summary: "List configured spending categories",
    description:
      "Returns the currently published category definitions used by Seisan's expense classifier.",
    responses: {
      200: OpenApiResponses.CategoryList,
      ...errorResponses(500),
    },
  }),
  listPublishedCategories,
);

// Browser-only: Cloudflare Precursor enforces a verified human session for this path at the edge,
// so the route is session-only, rejects requests without a same-origin Origin, and stays out of
// public OpenAPI.
categoryApp.post("/categories/classify", requireSameOrigin, requireSessionAuth, async (context) => {
  const parsed = await parseJson(context, ClassifyCategoryBody);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const rateLimit = await new CategoryClassificationRateLimiter(context.env).limit({
    accountEmail: getRequiredIdentity(context).email,
    clientIp: context.req.header("CF-Connecting-IP"),
  });
  if (!rateLimit.ok) {
    return ErrorResponse.rateLimited(rateLimit.error);
  }

  const result = await new CategoryClassifier(context.env).classify(parsed.data.name, {
    topK: parsed.data.topK,
  });
  if (!result.ok) {
    return mapClassificationError(result);
  }

  return context.json({
    category: result.category,
    score: result.score,
    othersScore: result.othersScore,
    candidates: result.candidates,
  });
});

class CategoryClassificationRateLimiter {
  private static readonly accountKeyPrefix = "category-classification:account:";
  private static readonly ipKeyPrefix = "category-classification:ip:";
  // Requests without CF-Connecting-IP (only possible off Cloudflare, such as local tests) share
  // one bucket instead of skipping the IP limit.
  private static readonly unknownIp = "unknown";

  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /** Applies the per-IP limit first, then the per-account limit, before any paid work. */
  async limit(input: {
    accountEmail: string;
    clientIp: string | undefined;
  }): Promise<Result<void, "ip" | "account">> {
    const ipLimit = await this.env.CATEGORY_CLASSIFICATION_IP_RATE_LIMITER.limit({
      key: await CategoryClassificationRateLimiter.ipKey(input.clientIp),
    });
    if (!ipLimit.success) {
      return { ok: false, error: "ip" };
    }

    const accountLimit = await this.env.CATEGORY_CLASSIFICATION_ACCOUNT_RATE_LIMITER.limit({
      key: `${CategoryClassificationRateLimiter.accountKeyPrefix}${await sha256Hex(
        normalizeEmail(input.accountEmail),
      )}`,
    });
    if (!accountLimit.success) {
      return { ok: false, error: "account" };
    }

    return { ok: true };
  }

  private static async ipKey(clientIp: string | undefined): Promise<string> {
    const ip = clientIp?.trim().toLowerCase() || CategoryClassificationRateLimiter.unknownIp;
    const source = CategoryClassificationRateLimiter.ipv6Prefix64(ip) ?? ip;
    return `${CategoryClassificationRateLimiter.ipKeyPrefix}${await sha256Hex(source)}`;
  }

  /**
   * One IPv6 subscriber usually controls a whole /64, so IPv6 addresses share their /64 bucket.
   * Returns null for IPv4, IPv4-embedded IPv6, and anything that does not parse.
   */
  private static ipv6Prefix64(ip: string): string | null {
    const halves = ip.split("::");
    if (!ip.includes(":") || halves.length > 2) {
      return null;
    }
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const elided = 8 - head.length - tail.length;
    if (halves.length === 1 ? elided !== 0 : elided < 1) {
      return null;
    }

    const groups = [...head, ...Array<string>(halves.length === 2 ? elided : 0).fill("0"), ...tail];
    if (!groups.every((group) => /^[0-9a-f]{1,4}$/u.test(group))) {
      return null;
    }
    return `${groups
      .slice(0, 4)
      .map((group) => Number.parseInt(group, 16).toString(16))
      .join(":")}::/64`;
  }
}

adminCategoryApp.get("/", listCategoriesForUpdate);

async function listPublishedCategories(context: AppContext): Promise<Response> {
  const result = await new PublishedGlobalConfigKvStore(
    context.env.PUBLISHED_GLOBAL_CONFIG,
  ).getValue(CATEGORY_CONFIG_KEY);
  if (!result.ok) {
    return ErrorResponse.internalServerError();
  }
  return context.json({ categories: result.value.categories });
}

async function listCategoriesForUpdate(context: AppContext): Promise<Response> {
  const result = await new CategoryClassifier(context.env).getCategoriesForUpdate();
  if (!result.ok) {
    return mapGetCategoriesForUpdateError(result);
  }
  return context.json({ categories: result.document.categories });
}

adminCategoryApp.post("/", async (context) => {
  const parsed = await parseJson(context, CategoryWriteBody);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const result = await new CategoryClassifier(context.env).upsertCategory({
    name: parsed.data.name,
    description: parsed.data.description,
    icon: parsed.data.icon,
  });
  if (!result.ok) {
    return mapUpsertError(result);
  }

  return context.json({ category: result.category }, 201);
});

adminCategoryApp.put("/:id", async (context) => {
  const id = CategoryId.safeParse(context.req.param("id"));
  if (!id.success) {
    return ErrorResponse.invalidRequest();
  }

  const parsed = await parseJson(context, CategoryWriteBody);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const result = await new CategoryClassifier(context.env).upsertCategory({
    id: id.data,
    name: parsed.data.name,
    description: parsed.data.description,
    icon: parsed.data.icon,
  });
  if (!result.ok) {
    return mapUpsertError(result);
  }

  return context.json({ category: result.category });
});

adminCategoryApp.delete("/:id", async (context) => {
  const id = CategoryId.safeParse(context.req.param("id"));
  if (!id.success) {
    return ErrorResponse.invalidRequest();
  }

  const result = await new CategoryClassifier(context.env).deleteCategory(id.data);
  if (!result.ok) {
    return mapDeleteError(result);
  }

  return new Response(null, { status: 204 });
});

function mapGetCategoriesForUpdateError(
  result: ErrorResultOf<CategoryClassifier["getCategoriesForUpdate"]>,
) {
  switch (result.error) {
    case "config_read_failed":
      return ErrorResponse.internalServerError();
  }
}

function mapUpsertError(result: ErrorResultOf<CategoryClassifier["upsertCategory"]>) {
  switch (result.error) {
    case "invalid_request":
      return ErrorResponse.invalidRequest();
    case "not_found":
      return ErrorResponse.notFound();
    case "category_exists":
      return ErrorResponse.conflict("category_exists");
    case "config_read_failed":
      return ErrorResponse.internalServerError();
  }
}

function mapDeleteError(result: ErrorResultOf<CategoryClassifier["deleteCategory"]>) {
  switch (result.error) {
    case "invalid_request":
      return ErrorResponse.invalidRequest();
    case "not_found":
      return ErrorResponse.notFound();
    case "config_read_failed":
      return ErrorResponse.internalServerError();
  }
}

function mapClassificationError(result: ErrorResultOf<CategoryClassifier["classify"]>) {
  switch (result.error) {
    case "invalid_request":
      return ErrorResponse.invalidRequest();
    case "not_found":
      return ErrorResponse.notFound();
    case "config_read_failed":
    case "classification_failed":
      return ErrorResponse.internalServerError();
  }
}
