import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import {
  type AppContext,
  type EnvWithIdentity,
  getRequiredIdentity,
  optionalAuth,
  parseJson,
  requireAuth,
  requireSameOriginWhenPresent,
} from "../auth";
import { sha256Hex } from "../crypto";
import type { ProjectStore } from "../do/ProjectStore";
import { normalizeEmail, normalizedEmailSchema } from "../email";
import { ErrorResponse } from "../error";
import { ABSOLUTE_LIST_LIMIT, ABSOLUTE_TEXT_LIMIT, LimitsKvStore, LimitsPolicy } from "../limits";
import {
  errorResponses,
  OpenApiParameters,
  OpenApiRequests,
  OpenApiResponses,
  OpenApiSecurity,
} from "../model";
import {
  PROJECTS_REGISTRY_NAME,
  MoneyByMemberIdUtils,
  ProjectEmailsUtils,
  ProjectId,
  ProjectNameUtils,
} from "../project";

const PROJECT_REGISTRY_CACHE_TTL_SECONDS = 60;
const memberIdParamRegex = /^[1-9]\d*$/u;

const Cents = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const MemberId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const MemberName = z
  .string()
  .transform(ProjectNameUtils.normalizeMember)
  .pipe(z.string().min(1).max(ABSOLUTE_TEXT_LIMIT));

const ProjectName = z
  .string()
  .transform(ProjectNameUtils.normalizeProject)
  .pipe(z.string().min(1).max(ABSOLUTE_TEXT_LIMIT));

function makeMoneyMapSchema(options: { nonNegative: boolean }) {
  const valueSchema = options.nonNegative ? Cents.min(0) : Cents;
  function isMemberIdKey(memberId: string): boolean {
    if (!memberIdParamRegex.test(memberId)) {
      return false;
    }
    const numericMemberId = Number(memberId);
    return Number.isSafeInteger(numericMemberId) && numericMemberId > 0;
  }

  return z
    .record(z.string(), valueSchema)
    .superRefine((input, context) => {
      const memberIds = Object.keys(input);
      if (memberIds.length > ABSOLUTE_LIST_LIMIT) {
        context.addIssue({
          code: "custom",
          message: "Money map has too many entries.",
        });
      }

      const seen = new Set<string>();
      for (const memberId of memberIds) {
        if (!isMemberIdKey(memberId)) {
          context.addIssue({
            code: "custom",
            message: "Invalid member ID key.",
            path: [memberId],
          });
          continue;
        }

        const normalizedMemberId = String(Number(memberId));
        if (seen.has(normalizedMemberId)) {
          context.addIssue({
            code: "custom",
            message: "Duplicate member ID after normalization.",
            path: [memberId],
          });
        }
        seen.add(normalizedMemberId);
      }
    })
    .transform((input) => MoneyByMemberIdUtils.normalize(input));
}

const MoneyMap = makeMoneyMapSchema({ nonNegative: false });
const NonNegativeMoneyMap = makeMoneyMapSchema({ nonNegative: true });

const ExpenseDescription = z
  .object({
    type: z.literal("expense"),
    name: z.string().trim().min(1).max(ABSOLUTE_TEXT_LIMIT),
    paid: NonNegativeMoneyMap,
    liability: NonNegativeMoneyMap,
  })
  .superRefine((description, context) => {
    const totalPaid = MoneyByMemberIdUtils.sum(description.paid);
    const totalLiability = MoneyByMemberIdUtils.sum(description.liability);
    if (totalPaid <= 0) {
      context.addIssue({
        code: "custom",
        message: "Expense total must be positive.",
        path: ["paid"],
      });
    }
    if (totalPaid !== totalLiability) {
      context.addIssue({
        code: "custom",
        message: "Paid total must equal liability total.",
        path: ["liability"],
      });
    }
  });

const TransferDescription = z
  .object({
    type: z.literal("transfer"),
    from: MemberId,
    to: MemberId,
    amount: Cents.positive(),
  })
  .superRefine((description, context) => {
    if (description.from === description.to) {
      context.addIssue({
        code: "custom",
        message: "Transfer endpoints must differ.",
        path: ["to"],
      });
    }
  });

const PromiseDescription = z
  .object({
    type: z.literal("promise"),
    debtorMemberId: MemberId,
    creditorMemberId: MemberId,
    amount: Cents.positive(),
    reason: z.string().trim().min(1).max(ABSOLUTE_TEXT_LIMIT).optional(),
  })
  .superRefine((description, context) => {
    if (description.debtorMemberId === description.creditorMemberId) {
      context.addIssue({
        code: "custom",
        message: "Promise endpoints must differ.",
        path: ["creditorMemberId"],
      });
    }
  });

const RevertDescription = z.object({
  type: z.literal("revert"),
  id: z.number().int().positive(),
});

const RecordDescription = z.discriminatedUnion("type", [
  ExpenseDescription,
  TransferDescription,
  PromiseDescription,
  RevertDescription,
]);

const ProjectAcl = z.discriminatedUnion("type", [
  z.object({ type: z.literal("public") }),
  z.object({
    type: z.literal("restricted"),
    emails: z
      .array(normalizedEmailSchema)
      .max(ABSOLUTE_LIST_LIMIT)
      .transform(ProjectEmailsUtils.uniqueSorted),
  }),
]);

interface ProjectRef {
  doId: string;
}

type ProjectRefCacheRead =
  | { status: "hit"; projectReference: ProjectRef }
  | { status: "miss" }
  | { status: "unavailable" };

type AppendRecordRateLimitReason = "account" | "project";

type AppendRecordRateLimitResult =
  | { ok: true }
  | { ok: false; reason: AppendRecordRateLimitReason };

export const projectApp = new Hono<EnvWithIdentity>();

const ProjectCreate = z.object({
  name: ProjectName,
  acl: ProjectAcl,
  ownerMemberName: MemberName.optional(),
});

projectApp.put(
  "/project",
  describeRoute({
    tags: ["Projects"],
    summary: "Create a project.",
    security: OpenApiSecurity.SessionCookie,
    requestBody: OpenApiRequests.ProjectCreate,
    responses: {
      201: OpenApiResponses.ProjectCreated,
      ...errorResponses(400, 401, 403, 409, 500),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    const parsed = await parseJson(context, ProjectCreate);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    const owner = normalizeEmail(getRequiredIdentity(context).email);
    const productLimits = await new LimitsKvStore(context.env.CONFIGS).load(owner);
    const policy = new LimitsPolicy(productLimits);
    if (!policy.allowsProjectName(parsed.data.name)) {
      return ErrorResponse.conflict("project_limit_exceeded");
    }
    if (
      parsed.data.ownerMemberName !== undefined &&
      !policy.allowsMemberName(parsed.data.ownerMemberName)
    ) {
      return ErrorResponse.conflict("member_limit_exceeded");
    }
    if (
      parsed.data.acl.type === "restricted" &&
      !policy.allowsAclEmailCount(parsed.data.acl.emails.length)
    ) {
      return ErrorResponse.conflict("acl_limit_exceeded");
    }

    const projectId = crypto.randomUUID();
    const projectDoId = context.env.PROJECT_STORE.newUniqueId();
    const projectDoIdString = projectDoId.toString();
    const nowMs = Date.now();
    const registry = context.env.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME);
    const registered = await registry.registerProject({
      id: projectId,
      doId: projectDoIdString,
      ownerEmail: owner,
      limits: productLimits,
      nowMs,
    });
    if (!registered.ok) {
      return registered.error === "project_limit_exceeded"
        ? ErrorResponse.conflict("project_limit_exceeded")
        : ErrorResponse.internalServerError();
    }

    const project = context.env.PROJECT_STORE.get(projectDoId);
    const created = await project.initialize({
      publicId: projectId,
      name: parsed.data.name,
      acl: parsed.data.acl,
      ownerEmail: owner,
      ownerMemberName: parsed.data.ownerMemberName,
      nowMs,
    });
    if (!created.ok) {
      return mapProjectStoreError(created.error);
    }

    return context.json(
      {
        id: projectId,
        name: parsed.data.name,
        owner,
        acl: parsed.data.acl,
        members: created.members,
      },
      201,
    );
  },
);

projectApp.get(
  "/project/:id",
  describeRoute({
    tags: ["Projects"],
    summary: "Get project details and a page of records.",
    security: OpenApiSecurity.OptionalSessionCookie,
    parameters: [
      OpenApiParameters.ProjectId,
      OpenApiParameters.RecordLimit,
      OpenApiParameters.RecordOffset,
    ],
    responses: {
      200: OpenApiResponses.Project,
      ...errorResponses(400, 403, 404, 409),
    },
  }),
  optionalAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const identity = context.get("identity");
    const callerEmail = identity ? normalizeEmail(identity.email) : null;
    const productLimits = await new LimitsKvStore(context.env.CONFIGS).load(callerEmail);
    const policy = new LimitsPolicy(productLimits);
    const limit = ProjectRouteParams.parseRecordLimit(context.req.query("limit"), policy);
    const offset = ProjectRouteParams.parseRecordOffset(context.req.query("offset"));
    if (limit === "exceeded") {
      return ErrorResponse.conflict("record_limit_exceeded");
    }
    if (limit === null || offset === null) {
      return ErrorResponse.invalidRequest();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }
    const result = await projectLookup.store.getRecords({
      publicId: projectLookup.projectId,
      callerEmail,
      limit,
      offset,
    });
    if (!result.ok) {
      return mapProjectStoreError(result.error);
    }

    return context.json({
      id: projectLookup.projectId,
      name: result.name,
      owner: result.owner,
      acl: result.acl,
      members: result.members,
      records: result.records,
      balance: result.balance,
      updatedAt: result.updatedAt,
    });
  },
);

const ProjectRename = z.object({
  name: ProjectName,
});

projectApp.patch(
  "/project/:id",
  describeRoute({
    tags: ["Projects"],
    summary: "Rename a project.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId],
    requestBody: OpenApiRequests.ProjectRename,
    responses: {
      200: OpenApiResponses.ProjectName,
      ...errorResponses(400, 401, 403, 404, 409),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const parsed = await parseJson(context, ProjectRename);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }

    const result = await projectLookup.store.renameProject({
      callerEmail: getRequiredIdentity(context).email,
      name: parsed.data.name,
      nowMs: Date.now(),
    });
    if (!result.ok) {
      return mapProjectStoreError(result.error);
    }
    return context.json({ name: result.name });
  },
);

const ProjectAclEmails = z.object({
  emails: z
    .array(normalizedEmailSchema)
    .min(1)
    .max(ABSOLUTE_LIST_LIMIT)
    .transform(ProjectEmailsUtils.uniqueSorted),
});

projectApp.post(
  "/project/:id/acl/emails",
  describeRoute({
    tags: ["Project ACL"],
    summary: "Add emails to a restricted project ACL.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId],
    requestBody: OpenApiRequests.ProjectAclEmails,
    responses: {
      204: OpenApiResponses.NoContent,
      ...errorResponses(400, 401, 403, 404, 409),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }
    const parsed = await parseJson(context, ProjectAclEmails);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    return mapAclAdminResult(
      await projectLookup.store.appendEmailsToAcl({
        callerEmail: getRequiredIdentity(context).email,
        emails: parsed.data.emails,
      }),
    );
  },
);

projectApp.delete(
  "/project/:id/acl/emails",
  describeRoute({
    tags: ["Project ACL"],
    summary: "Remove emails from a restricted project ACL.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId],
    requestBody: OpenApiRequests.ProjectAclEmails,
    responses: {
      204: OpenApiResponses.NoContent,
      ...errorResponses(400, 401, 403, 404, 409),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }
    const parsed = await parseJson(context, ProjectAclEmails);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    return mapAclAdminResult(
      await projectLookup.store.removeEmailsFromAcl({
        callerEmail: getRequiredIdentity(context).email,
        emails: parsed.data.emails,
      }),
    );
  },
);

const ProjectAclTypeUpdate = z.object({
  type: z.enum(["public", "restricted"]),
});

projectApp.put(
  "/project/:id/acl/type",
  describeRoute({
    tags: ["Project ACL"],
    summary: "Set a project's ACL type.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId],
    requestBody: OpenApiRequests.ProjectAclType,
    responses: {
      204: OpenApiResponses.NoContent,
      ...errorResponses(400, 401, 403, 404, 409),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }
    const parsed = await parseJson(context, ProjectAclTypeUpdate);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    return mapAclAdminResult(
      await projectLookup.store.setAclType({
        callerEmail: getRequiredIdentity(context).email,
        type: parsed.data.type,
      }),
    );
  },
);

const ProjectMemberCreate = z.object({
  name: MemberName,
});

projectApp.post(
  "/project/:id/members",
  describeRoute({
    tags: ["Project Members"],
    summary: "Create a project member.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId],
    requestBody: OpenApiRequests.ProjectMemberCreate,
    responses: {
      201: OpenApiResponses.Member,
      ...errorResponses(400, 401, 403, 404, 409),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }
    const parsed = await parseJson(context, ProjectMemberCreate);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    const result = await projectLookup.store.createMember({
      callerEmail: getRequiredIdentity(context).email,
      name: parsed.data.name,
      nowMs: Date.now(),
    });
    if (!result.ok) {
      return mapProjectStoreError(result.error);
    }
    return context.json({ member: result.member }, 201);
  },
);

const ProjectJoin = z.union([
  z.object({ memberId: MemberId }).strict().describe("claim unlinked member"),
  z.object({ name: MemberName }).strict().describe("create a new member"),
]);

projectApp.post(
  "/project/:id/join",
  describeRoute({
    tags: ["Project Members"],
    summary: "Join a project as an existing or new member.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId],
    requestBody: OpenApiRequests.ProjectJoin,
    responses: {
      201: OpenApiResponses.Member,
      ...errorResponses(400, 401, 403, 404, 409, 500),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const parsed = await parseJson(context, ProjectJoin);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }

    const callerEmail = normalizeEmail(getRequiredIdentity(context).email);
    const productLimits = await new LimitsKvStore(context.env.CONFIGS).load(callerEmail);
    const registry = context.env.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME);
    const reserved = await registry.addProjectMember({
      id: projectLookup.projectId,
      email: callerEmail,
      limits: productLimits,
      nowMs: Date.now(),
    });
    if (!reserved.ok) {
      return reserved.error === "project_limit_exceeded"
        ? ErrorResponse.conflict("project_limit_exceeded")
        : ErrorResponse.internalServerError();
    }

    const result = await projectLookup.store.joinProject({
      callerEmail,
      join: parsed.data,
      nowMs: Date.now(),
    });
    if (!result.ok) {
      if (!reserved.alreadyMember) {
        await registry.removeProjectMember({
          id: projectLookup.projectId,
          email: callerEmail,
        });
      }
      return mapProjectStoreError(result.error);
    }
    return context.json({ member: result.member }, 201);
  },
);

projectApp.post(
  "/project/:id/leave",
  describeRoute({
    tags: ["Project Members"],
    summary: "Leave a project and unlink the current account from its member.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId],
    responses: {
      204: OpenApiResponses.NoContent,
      ...errorResponses(401, 403, 404, 409, 500),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }

    const result = await projectLookup.store.leaveProject({
      callerEmail: getRequiredIdentity(context).email,
      nowMs: Date.now(),
    });
    if (!result.ok) {
      return mapProjectStoreError(result.error);
    }

    const removed = await context.env.PROJECTS_REGISTRY.getByName(
      PROJECTS_REGISTRY_NAME,
    ).removeProjectMember({
      id: projectLookup.projectId,
      email: result.removedLinkedEmail,
    });
    if (!removed.ok) {
      return ErrorResponse.internalServerError();
    }

    return context.body(null, 204);
  },
);

const ProjectMemberEmailUnlink = z.object({
  email: normalizedEmailSchema,
});

projectApp.delete(
  "/project/:id/member-links",
  describeRoute({
    tags: ["Project Members"],
    summary: "Unlink an email from a project member.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId],
    requestBody: OpenApiRequests.ProjectMemberEmailUnlink,
    responses: {
      204: OpenApiResponses.NoContent,
      ...errorResponses(400, 401, 403, 404, 409, 500),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const parsed = await parseJson(context, ProjectMemberEmailUnlink);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }

    const result = await projectLookup.store.unlinkMemberEmail({
      callerEmail: getRequiredIdentity(context).email,
      email: parsed.data.email,
      nowMs: Date.now(),
    });
    if (!result.ok) {
      return mapProjectStoreError(result.error);
    }

    const removed = await context.env.PROJECTS_REGISTRY.getByName(
      PROJECTS_REGISTRY_NAME,
    ).removeProjectMember({
      id: projectLookup.projectId,
      email: result.removedLinkedEmail,
    });
    if (!removed.ok) {
      return ErrorResponse.internalServerError();
    }

    return context.body(null, 204);
  },
);

const ProjectMemberPatch = z.union([
  z.object({ name: MemberName }).strict(),
  z.object({ email: z.literal("") }).strict(),
]);

projectApp.patch(
  "/project/:id/members/:memberId",
  describeRoute({
    tags: ["Project Members"],
    summary: "Patch a project member.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId, OpenApiParameters.MemberId],
    requestBody: OpenApiRequests.ProjectMemberPatch,
    responses: {
      200: OpenApiResponses.Member,
      ...errorResponses(400, 401, 403, 404, 409, 500),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const memberId = ProjectRouteParams.parseMemberId(context.req.param("memberId"));
    if (memberId === null) {
      return ErrorResponse.notFound();
    }

    const parsed = await parseJson(context, ProjectMemberPatch);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }

    const result = await projectLookup.store.patchMember({
      callerEmail: getRequiredIdentity(context).email,
      memberId,
      patch: parsed.data,
      nowMs: Date.now(),
    });
    if (!result.ok) {
      return mapProjectStoreError(result.error);
    }
    if (result.removedLinkedEmail) {
      const removed = await context.env.PROJECTS_REGISTRY.getByName(
        PROJECTS_REGISTRY_NAME,
      ).removeProjectMember({
        id: projectLookup.projectId,
        email: result.removedLinkedEmail,
      });
      if (!removed.ok) {
        return ErrorResponse.internalServerError();
      }
    }
    return context.json({ member: result.member });
  },
);

projectApp.delete(
  "/project/:id/members/:memberId",
  describeRoute({
    tags: ["Project Members"],
    summary: "Soft-delete a project member.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId, OpenApiParameters.MemberId],
    responses: {
      204: OpenApiResponses.NoContent,
      ...errorResponses(401, 403, 404, 409, 500),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const memberId = ProjectRouteParams.parseMemberId(context.req.param("memberId"));
    if (memberId === null) {
      return ErrorResponse.notFound();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }
    const result = await projectLookup.store.deleteMember({
      callerEmail: getRequiredIdentity(context).email,
      memberId,
      nowMs: Date.now(),
    });
    if (!result.ok) {
      return mapProjectStoreError(result.error);
    }
    if (result.removedLinkedEmail) {
      const removed = await context.env.PROJECTS_REGISTRY.getByName(
        PROJECTS_REGISTRY_NAME,
      ).removeProjectMember({
        id: projectLookup.projectId,
        email: result.removedLinkedEmail,
      });
      if (!removed.ok) {
        return ErrorResponse.internalServerError();
      }
    }
    return context.body(null, 204);
  },
);

const ProjectAppendRecord = z.object({
  delta: MoneyMap,
  description: RecordDescription,
});

projectApp.post(
  "/project/:id",
  describeRoute({
    tags: ["Project Records"],
    summary: "Append a record to a project.",
    security: OpenApiSecurity.SessionCookie,
    parameters: [OpenApiParameters.ProjectId],
    requestBody: OpenApiRequests.ProjectAppendRecord,
    responses: {
      201: OpenApiResponses.RecordCreated,
      ...errorResponses(400, 401, 403, 404, 409, 429),
    },
  }),
  requireSameOriginWhenPresent,
  requireAuth,
  async (context) => {
    if (!isValidProjectId(context.req.param("id"))) {
      return ErrorResponse.notFound();
    }

    const parsed = await parseJson(context, ProjectAppendRecord);
    if (!parsed.ok) {
      return ErrorResponse.invalidRequest();
    }

    const projectLookup = await getProjectStore(context, context.req.param("id"));
    if (!projectLookup) {
      return ErrorResponse.notFound();
    }

    const callerEmail = normalizeEmail(getRequiredIdentity(context).email);
    const rateLimiter = new AppendRecordRateLimiter(context.env);
    const productLimits = await new LimitsKvStore(context.env.CONFIGS).load(callerEmail);
    if (!new LimitsPolicy(productLimits).allowsRecordPost()) {
      return ErrorResponse.postingBlocked();
    }

    const accountRateLimit = await rateLimiter.limitAccount(callerEmail);
    if (!accountRateLimit.ok) {
      return ErrorResponse.rateLimited("account");
    }

    const projectRateLimit = await rateLimiter.limitProject(projectLookup.projectId);
    if (!projectRateLimit.ok) {
      return ErrorResponse.rateLimited("project");
    }

    const result = await projectLookup.store.postRecord({
      callerEmail,
      delta: parsed.data.delta,
      description: parsed.data.description,
      nowMs: Date.now(),
    });
    if (!result.ok) {
      return mapProjectStoreError(result.error);
    }

    return context.json({ id: result.id }, 201);
  },
);

async function getProjectStore(
  context: AppContext,
  rawProjectId: string,
): Promise<{
  projectId: string;
  store: DurableObjectStub<ProjectStore>;
} | null> {
  const parsedProjectId = ProjectId.safeParse(rawProjectId);
  if (!parsedProjectId.success) {
    return null;
  }

  const projectId = parsedProjectId.data;
  let projectReference = await new ProjectRefFetcher(context.env).fetch(projectId);
  if (!projectReference) {
    return null;
  }

  try {
    return {
      projectId,
      store: context.env.PROJECT_STORE.get(
        context.env.PROJECT_STORE.idFromString(projectReference.doId),
      ),
    };
  } catch {
    // Fall back to the registry if a stale cache value no longer parses as a Durable Object ID.
  }

  const registry = context.env.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME);
  const lookup = await registry.lookupProject(projectId);
  if (!lookup.ok) {
    return null;
  }

  projectReference = { doId: lookup.doId };
  try {
    return {
      projectId,
      store: context.env.PROJECT_STORE.get(
        context.env.PROJECT_STORE.idFromString(projectReference.doId),
      ),
    };
  } catch {
    return null;
  }
}

class AppendRecordRateLimiter {
  private static readonly accountKeyPrefix = "append-record:account:";
  private static readonly projectKeyPrefix = "append-record:project:";

  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async limitAccount(accountEmail: string): Promise<AppendRecordRateLimitResult> {
    const accountLimit = await this.env.APPEND_RECORD_ACCOUNT_RATE_LIMITER.limit({
      key: await AppendRecordRateLimiter.accountKey(accountEmail),
    });
    if (!accountLimit.success) {
      return { ok: false, reason: "account" };
    }

    return { ok: true };
  }

  async limitProject(projectId: string): Promise<AppendRecordRateLimitResult> {
    const projectLimit = await this.env.APPEND_RECORD_PROJECT_RATE_LIMITER.limit({
      key: AppendRecordRateLimiter.projectKey(projectId),
    });
    if (!projectLimit.success) {
      return { ok: false, reason: "project" };
    }

    return { ok: true };
  }

  private static async accountKey(email: string): Promise<string> {
    return `${AppendRecordRateLimiter.accountKeyPrefix}${await sha256Hex(normalizeEmail(email))}`;
  }

  private static projectKey(projectId: string): string {
    return `${AppendRecordRateLimiter.projectKeyPrefix}${projectId}`;
  }
}

class ProjectRefFetcher {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async fetch(projectId: string): Promise<ProjectRef | null> {
    const cached = await this.readCache(projectId);
    if (cached.status === "hit") {
      return cached.projectReference;
    }
    if (cached.status === "miss") {
      return null;
    }

    const registry = this.env.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME);
    const lookup = await registry.lookupProject(projectId);
    return lookup.ok ? { doId: lookup.doId } : null;
  }

  private async readCache(projectId: string): Promise<ProjectRefCacheRead> {
    try {
      const cached = await this.env.PROJECT_REGISTRY_CACHE.get(
        ProjectRefFetcher.cacheKey(projectId),
        {
          cacheTtl: PROJECT_REGISTRY_CACHE_TTL_SECONDS,
        },
      );
      if (cached === null) {
        return { status: "miss" };
      }

      const projectReference = ProjectRefFetcher.parseCacheValue(cached);
      return projectReference ? { status: "hit", projectReference } : { status: "unavailable" };
    } catch (error) {
      console.error("failed to read project registry cache", { projectId, error });
      return { status: "unavailable" };
    }
  }

  private static cacheKey(projectId: string): string {
    return `project:${projectId}`;
  }

  private static parseCacheValue(value: string): ProjectRef | null {
    try {
      const parsed = JSON.parse(value) as Partial<ProjectRef>;
      if (typeof parsed.doId !== "string" || !/^[0-9a-f]{64}$/u.test(parsed.doId)) {
        return null;
      }

      return { doId: parsed.doId };
    } catch {
      return null;
    }
  }
}

class ProjectRouteParams {
  static parseRecordLimit(
    rawLimit: string | undefined,
    policy: LimitsPolicy,
  ): number | "exceeded" | null {
    if (rawLimit === undefined || rawLimit === "") {
      return policy.defaultRecordPageSize();
    }
    if (!/^\d+$/u.test(rawLimit)) {
      return null;
    }

    const limit = Number(rawLimit);
    return policy.allowsPageLimit(limit) ? limit : "exceeded";
  }

  static parseRecordOffset(rawOffset: string | undefined): number | null {
    if (rawOffset === undefined || rawOffset === "") {
      return Number.MAX_SAFE_INTEGER;
    }
    if (!/^\d+$/u.test(rawOffset)) {
      return null;
    }

    const offset = Number(rawOffset);
    if (!Number.isSafeInteger(offset) || offset < 1) {
      return null;
    }
    return offset;
  }

  static parseMemberId(rawMemberId: string): number | null {
    if (!memberIdParamRegex.test(rawMemberId)) {
      return null;
    }
    const memberId = Number(rawMemberId);
    return Number.isSafeInteger(memberId) && memberId > 0 ? memberId : null;
  }
}

function isValidProjectId(rawProjectId: string): boolean {
  return ProjectId.safeParse(rawProjectId).success;
}

function mapAclAdminResult(result: { ok: true } | { ok: false; error: string }): Response {
  if (result.ok) {
    return new Response(null, { status: 204 });
  }
  return mapProjectStoreError(result.error);
}

function mapProjectStoreError(error: string): Response {
  if (error === "uninitialized" || error === "not_found") {
    return ErrorResponse.notFound();
  }
  if (error === "forbidden") {
    return ErrorResponse.forbidden();
  }
  if (
    error === "already_linked" ||
    error === "already_deleted" ||
    error === "nonzero_balance" ||
    error === "project_limit_exceeded" ||
    error === "member_limit_exceeded" ||
    error === "record_limit_exceeded" ||
    error === "acl_limit_exceeded" ||
    error === "money_limit_exceeded"
  ) {
    return ErrorResponse.conflict(error);
  }
  return ErrorResponse.invalidRequest();
}
