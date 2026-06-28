import { resolver, type DescribeRouteOptions, type GenerateSpecOptions } from "hono-openapi";
import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import { SESSION_COOKIE_NAME } from "./constants";
import { ABSOLUTE_LIST_LIMIT, ABSOLUTE_TEXT_LIMIT } from "./limits";

type OpenApiResponses = NonNullable<DescribeRouteOptions["responses"]>;
type OpenApiResponse = OpenApiResponses[string];

const JsonMediaType = "application/json";
const TextMediaType = "text/plain";

const SafeInteger = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const PositiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const NonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Email = z.email();
const MemberName = z.string().min(1).max(ABSOLUTE_TEXT_LIMIT);
const ProjectName = z.string().min(1).max(ABSOLUTE_TEXT_LIMIT);
const MoneyByMemberId = z.record(z.string().regex(/^[1-9]\d*$/u), SafeInteger);
const NonNegativeMoneyByMemberId = z.record(z.string().regex(/^[1-9]\d*$/u), SafeInteger.min(0));

const ProjectAcl = z.discriminatedUnion("type", [
  z.object({ type: z.literal("public") }).strict(),
  z.object({ type: z.literal("restricted"), emails: z.array(Email).max(ABSOLUTE_LIST_LIMIT) }),
]);

const ProjectMember = z
  .object({
    id: PositiveSafeInteger,
    name: z.string(),
    deleted: z.boolean(),
    linkedEmail: Email.optional(),
  })
  .strict();

const ExpenseDescription = z
  .object({
    type: z.literal("expense"),
    name: z.string(),
    paid: NonNegativeMoneyByMemberId,
    liability: NonNegativeMoneyByMemberId,
  })
  .strict();

const TransferDescription = z
  .object({
    type: z.literal("transfer"),
    from: PositiveSafeInteger,
    to: PositiveSafeInteger,
    amount: PositiveSafeInteger,
  })
  .strict();

const PromiseDescription = z
  .object({
    type: z.literal("promise"),
    debtorMemberId: PositiveSafeInteger,
    creditorMemberId: PositiveSafeInteger,
    amount: PositiveSafeInteger,
    reason: z.string().optional(),
  })
  .strict();

const RevertDescription = z.object({ type: z.literal("revert"), id: PositiveSafeInteger }).strict();

const RecordDescription = z.discriminatedUnion("type", [
  ExpenseDescription,
  TransferDescription,
  PromiseDescription,
  RevertDescription,
]);

const ProjectRecord = z
  .object({
    id: PositiveSafeInteger,
    authorMemberId: PositiveSafeInteger,
    delta: MoneyByMemberId,
    description: RecordDescription,
    createdAt: NonNegativeSafeInteger,
    reverted: z
      .object({
        recordId: PositiveSafeInteger,
        authorMemberId: PositiveSafeInteger,
        createdAt: NonNegativeSafeInteger,
      })
      .strict()
      .optional(),
  })
  .strict();

const ProjectSummary = z
  .object({
    id: z.string(),
    name: z.string(),
    owner: Email,
    member: ProjectMember.nullable(),
    balance: SafeInteger.nullable(),
    updatedAt: NonNegativeSafeInteger,
  })
  .strict();

const ProjectSummaryWithSyncTime = ProjectSummary.extend({
  lastSyncAt: NonNegativeSafeInteger,
}).strict();

const ProjectCreated = z
  .object({
    id: z.string(),
    name: z.string(),
    owner: Email,
    acl: ProjectAcl,
    members: z.array(ProjectMember),
  })
  .strict();

const Project = ProjectCreated.extend({
  records: z.array(ProjectRecord),
  balance: MoneyByMemberId,
  updatedAt: NonNegativeSafeInteger,
}).strict();

const IdentityBody = z.object({ email: Email }).strict();
const OkBody = z.object({ ok: z.literal(true) }).strict();
const LoginAttemptBody = OkBody.extend({ id: z.string().optional() }).strict();
const RegistryBody = z.object({ projects: z.array(ProjectSummaryWithSyncTime) }).strict();
const ProjectNameBody = z.object({ name: z.string() }).strict();
const MemberBody = z.object({ member: ProjectMember }).strict();
const RecordCreatedBody = z.object({ id: PositiveSafeInteger }).strict();
const ErrorBody = z.object({ error: z.string(), reason: z.string().optional() }).strict();
const PingBody = z.string();

const LoginAttemptRequest = z
  .object({
    email: Email,
    turnstileToken: z.string().min(1).max(2048).optional(),
  })
  .strict();

const LoginVerifyRequest = z
  .object({
    id: z.string().regex(/^[0-9A-Za-z]{32}$/u),
    email: Email,
    code: z.string().regex(/^\d{6}$/u),
  })
  .strict();

const ProjectCreateRequest = z
  .object({
    name: ProjectName,
    acl: ProjectAcl,
    ownerMemberName: MemberName.optional(),
  })
  .strict();

const ProjectRenameRequest = z.object({ name: ProjectName }).strict();
const ProjectAclEmailsRequest = z
  .object({ emails: z.array(Email).min(1).max(ABSOLUTE_LIST_LIMIT) })
  .strict();
const ProjectAclTypeRequest = z.object({ type: z.enum(["public", "restricted"]) }).strict();
const ProjectMemberCreateRequest = z.object({ name: MemberName }).strict();
const ProjectMemberEmailUnlinkRequest = z.object({ email: Email }).strict();
const ProjectMemberPatchRequest = z.union([
  z.object({ name: MemberName }).strict(),
  z.object({ email: z.literal("") }).strict(),
]);
const ProjectJoinRequest = z.union([
  z.object({ memberId: PositiveSafeInteger }).strict(),
  z.object({ name: MemberName }).strict(),
]);
const ProjectAppendRecordRequest = z
  .object({
    delta: MoneyByMemberId,
    description: RecordDescription,
  })
  .strict();

export const OpenApiSpecOptions = {
  documentation: {
    info: {
      title: "Seisan API",
      version: "0.0.0",
      description: "Worker API for Seisan group expense projects.",
    },
    servers: [{ url: "/", description: "Current origin" }],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: SESSION_COOKIE_NAME,
        },
      },
    },
    tags: [
      { name: "System" },
      { name: "Auth" },
      { name: "Registry" },
      { name: "Projects" },
      { name: "Project ACL" },
      { name: "Project Members" },
      { name: "Project Records" },
    ],
  },
  exclude: /^\/api\/admin(?:\/|$)/u,
} satisfies Partial<GenerateSpecOptions>;

const NoSecurity = {} satisfies OpenAPIV3_1.SecurityRequirementObject;
const SessionCookieSecurity = {
  sessionCookie: [] as string[],
} satisfies OpenAPIV3_1.SecurityRequirementObject;

export const OpenApiSecurity = {
  SessionCookie: [SessionCookieSecurity],
  OptionalSessionCookie: [NoSecurity, SessionCookieSecurity],
} satisfies Record<string, OpenAPIV3_1.SecurityRequirementObject[]>;

export const OpenApiParameters = {
  ProjectId: {
    name: "id",
    in: "path",
    required: true,
    description: "Public project ID.",
    schema: { type: "string", format: "uuid" },
  },
  MemberId: {
    name: "memberId",
    in: "path",
    required: true,
    description: "Project-local member ID.",
    schema: { type: "integer", minimum: 1 },
  },
  RecordLimit: {
    name: "limit",
    in: "query",
    required: false,
    description: "Maximum number of records to return.",
    schema: { type: "integer", minimum: 1 },
  },
  RecordOffset: {
    name: "offset",
    in: "query",
    required: false,
    description: "Fetch records older than this project-local record ID.",
    schema: { type: "integer", minimum: 1 },
  },
} satisfies Record<string, OpenAPIV3_1.ParameterObject>;

export const OpenApiRequests = {
  LoginAttempt: jsonRequest(LoginAttemptRequest),
  LoginVerify: jsonRequest(LoginVerifyRequest),
  ProjectCreate: jsonRequest(ProjectCreateRequest),
  ProjectRename: jsonRequest(ProjectRenameRequest),
  ProjectAclEmails: jsonRequest(ProjectAclEmailsRequest),
  ProjectAclType: jsonRequest(ProjectAclTypeRequest),
  ProjectMemberCreate: jsonRequest(ProjectMemberCreateRequest),
  ProjectMemberEmailUnlink: jsonRequest(ProjectMemberEmailUnlinkRequest),
  ProjectMemberPatch: jsonRequest(ProjectMemberPatchRequest),
  ProjectJoin: jsonRequest(ProjectJoinRequest),
  ProjectAppendRecord: jsonRequest(ProjectAppendRecordRequest),
} satisfies Record<string, OpenAPIV3_1.RequestBodyObject>;

export const OpenApiResponses = {
  Ping: textResponse("Plain-text health check response.", PingBody),
  Ok: jsonResponse("Successful response.", OkBody),
  LoginAttemptAccepted: jsonResponse("Login attempt accepted.", LoginAttemptBody),
  Identity: jsonResponse("Authenticated identity.", IdentityBody),
  Registry: jsonResponse("Projects visible to the authenticated caller.", RegistryBody),
  ProjectCreated: jsonResponse("Created project.", ProjectCreated),
  Project: jsonResponse("Project details and records.", Project),
  ProjectName: jsonResponse("Updated project name.", ProjectNameBody),
  Member: jsonResponse("Project member.", MemberBody),
  RecordCreated: jsonResponse("Created project record.", RecordCreatedBody),
  InvalidRequest: jsonResponse("Malformed or invalid request.", ErrorBody),
  Unauthorized: jsonResponse("Authentication is required or invalid.", ErrorBody),
  Forbidden: jsonResponse("The caller is not allowed to perform this action.", ErrorBody),
  NotFound: jsonResponse("The requested resource was not found.", ErrorBody),
  Conflict: jsonResponse(
    "The request conflicts with project state or configured limits.",
    ErrorBody,
  ),
  RateLimited: jsonResponse("The request was rate limited.", ErrorBody),
  InternalServerError: jsonResponse("Unexpected server error.", ErrorBody),
  NoContent: { description: "Successful no-content response." },
} satisfies Record<string, OpenApiResponse>;

export function errorResponses(...statuses: Array<400 | 401 | 403 | 404 | 409 | 429 | 500>) {
  const responses: OpenApiResponses = {};
  for (const status of statuses) {
    responses[status] = errorResponseByStatus(status);
  }
  return responses;
}

function errorResponseByStatus(status: 400 | 401 | 403 | 404 | 409 | 429 | 500): OpenApiResponse {
  switch (status) {
    case 400:
      return OpenApiResponses.InvalidRequest;
    case 401:
      return OpenApiResponses.Unauthorized;
    case 403:
      return OpenApiResponses.Forbidden;
    case 404:
      return OpenApiResponses.NotFound;
    case 409:
      return OpenApiResponses.Conflict;
    case 429:
      return OpenApiResponses.RateLimited;
    case 500:
      return OpenApiResponses.InternalServerError;
  }
}

function jsonRequest(schema: z.ZodType): OpenAPIV3_1.RequestBodyObject {
  return {
    required: true,
    content: {
      [JsonMediaType]: {
        schema: openApiSchema(schema),
      },
    },
  };
}

function jsonResponse(description: string, schema: z.ZodType): OpenApiResponse {
  return {
    description,
    content: {
      [JsonMediaType]: {
        schema: resolver(schema),
      },
    },
  };
}

function textResponse(description: string, schema: z.ZodType): OpenApiResponse {
  return {
    description,
    content: {
      [TextMediaType]: {
        schema: resolver(schema),
      },
    },
  };
}

function openApiSchema(schema: z.ZodType): OpenAPIV3_1.SchemaObject {
  const jsonSchema = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete jsonSchema.$schema;
  return jsonSchema as OpenAPIV3_1.SchemaObject;
}
