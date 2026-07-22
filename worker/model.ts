import { resolver, type DescribeRouteOptions, type GenerateSpecOptions } from "hono-openapi";
import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import { ICON_NAME_VALUES } from "../shared/icon-names";
import { MAX_EMAIL_LENGTH } from "./email";
import { ABSOLUTE_LIST_LIMIT, ABSOLUTE_TEXT_LIMIT } from "./limits";
import {
  MoneyByMemberId,
  ProjectMember,
  ProjectMemberConfig,
  ProjectMemberConfigPatch,
  ProjectMemberFull,
  RecordDescription,
  TransferBatch,
  WritableRecordDescription,
} from "./project";

type OpenApiResponses = NonNullable<DescribeRouteOptions["responses"]>;
type OpenApiResponse = OpenApiResponses[string];

const JsonMediaType = "application/json";
const TextMediaType = "text/plain";

const exampleProjectId = "8d46d6c6-b970-4b2b-8d3e-47f57058f951";
const exampleCategoryId = "4a6cc79a-51da-4e94-9d62-45ba3d853b1c";
const exampleGroceriesCategoryId = "e92ad75b-4513-40e7-8d98-eaf102dcf8b0";
const exampleCreatedAt = 1_767_225_600_000;
const exampleUpdatedAt = 1_767_312_000_000;
const exampleSessionExpiresAt = 1_767_312_000;

const exampleMemberConfig = {
  size: 2,
  paymentMethod: "venmo: mika@example.com",
};
const exampleMember = {
  id: 1,
  name: "Mika",
  deleted: false,
  linkedEmail: "mika@example.com",
};
const exampleSecondMember = {
  id: 2,
  name: "Ren",
  deleted: false,
  linkedEmail: "ren@example.com",
};
const exampleMemberFull = { ...exampleMember, config: exampleMemberConfig };
const exampleSecondMemberFull = { ...exampleSecondMember, config: {} };
const exampleAcl = {
  type: "restricted",
  emails: ["mika@example.com", "ren@example.com"],
};
const exampleExpenseDescription = {
  type: "expense",
  name: "Ramen dinner",
  paid: { "1": 12_400 },
  liability: { "1": 6_200, "2": 6_200 },
  categoryId: exampleCategoryId,
};
const exampleTransferDescription = {
  type: "transfer",
  from: 2,
  to: 1,
  amount: 6_200,
};
const exampleMultiTransferDescription = {
  type: "transfer",
  src: 2,
  dests: [
    { id: 1, amount: 3_100 },
    { id: 3, amount: 3_100 },
  ],
};
const exampleTransferBatch = {
  src: 2,
  dests: [{ id: 1, amount: 6_200 }],
};
const examplePromiseDescription = {
  type: "promise",
  debtorMemberId: 2,
  creditorMemberId: 1,
  amount: 3_100,
  reason: "Museum tickets",
};
const exampleRevertDescription = { type: "revert", id: 1 };
const exampleRecords = [
  {
    id: 1,
    authorMemberId: 1,
    delta: { "1": -6_200, "2": 6_200 },
    description: exampleExpenseDescription,
    createdAt: exampleCreatedAt,
  },
  {
    id: 2,
    authorMemberId: 2,
    delta: { "1": 6_200, "2": -6_200 },
    description: exampleTransferDescription,
    createdAt: exampleCreatedAt + 1_200_000,
    updatedAt: exampleCreatedAt + 1_800_000,
    updatedByMemberId: 1,
  },
  {
    id: 3,
    authorMemberId: 1,
    delta: { "1": -3_100, "2": 3_100 },
    description: examplePromiseDescription,
    createdAt: exampleCreatedAt + 2_400_000,
  },
  {
    id: 4,
    authorMemberId: 1,
    delta: { "1": 6_200, "2": -6_200 },
    description: exampleRevertDescription,
    createdAt: exampleCreatedAt + 3_600_000,
  },
];
const exampleProjectCreated = {
  id: exampleProjectId,
  name: "Japan trip",
  owner: "mika@example.com",
  acl: exampleAcl,
  members: [exampleMember, exampleSecondMember],
};
const exampleProject = {
  ...exampleProjectCreated,
  members: [exampleMemberFull, exampleSecondMemberFull],
  records: exampleRecords,
  balance: { "1": 3_100, "2": -3_100 },
  updatedAt: exampleUpdatedAt,
};
const exampleCategory = {
  id: exampleCategoryId,
  name: "Dining",
  normalizedName: "dining",
  description: "Restaurants, cafes, and prepared meals.",
  icon: "restaurant",
  documentText: "Dining: restaurants, cafes, and prepared meals.",
  vectorId: "category:dining",
  createdAt: exampleCreatedAt,
  updatedAt: exampleUpdatedAt,
};
const exampleGroceriesCategory = {
  id: exampleGroceriesCategoryId,
  name: "Groceries",
  normalizedName: "groceries",
  description: "Food and household supplies bought from stores.",
  icon: "grocery",
  documentText: "Groceries: food and household supplies bought from stores.",
  vectorId: "category:groceries",
  createdAt: exampleCreatedAt,
  updatedAt: exampleUpdatedAt,
};
const exampleError = {
  error: "invalid_request",
  reason: "The request body did not match the documented schema.",
};

const SafeInteger = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const PositiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const NonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Email = z
  .email()
  .max(MAX_EMAIL_LENGTH)
  .meta({ description: "Normalized account email address.", examples: ["mika@example.com"] });
// TODO(schema-source): import canonical project name, money-map, and ACL schemas once the route and
// domain definitions are consolidated; these OpenAPI copies currently duplicate their constraints.
const MemberName = z
  .string()
  .min(1)
  .max(ABSOLUTE_TEXT_LIMIT)
  .meta({ description: "Display name for a project member.", examples: ["Mika"] });
const ProjectName = z
  .string()
  .min(1)
  .max(ABSOLUTE_TEXT_LIMIT)
  .meta({ description: "Human-readable project name.", examples: ["Japan trip"] });
// TODO(schema-source): import category IDs, icons, category documents, and classification schemas
// from worker/category/schema.ts instead of redefining their OpenAPI shapes here.
const CategoryId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu)
  .meta({ description: "Stable UUID for a spending category.", examples: [exampleCategoryId] });
const CategoryIconName = z.enum(ICON_NAME_VALUES).meta({
  description: "Shared icon name used by category-aware clients.",
  examples: ["restaurant"],
});

const ProjectAcl = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z
          .literal("public")
          .meta({ description: "Allow anyone with the link to read the project." }),
      })
      .strict(),
    z
      .object({
        type: z
          .literal("restricted")
          .meta({ description: "Limit project access to approved accounts." }),
        emails: z
          .array(Email)
          .max(ABSOLUTE_LIST_LIMIT)
          .meta({ description: "Accounts allowed to access the restricted project." }),
      })
      .strict(),
  ])
  .meta({ description: "Project access policy.", examples: [exampleAcl, { type: "public" }] });

// TODO(schema-source): canonicalize project record, summary, created-project, and full-project
// response schemas so OpenAPI, registry, Worker domain types, and frontend types share them.
const ProjectRecord = z
  .object({
    id: PositiveSafeInteger.meta({ description: "Project-local record ID.", examples: [1] }),
    authorMemberId: PositiveSafeInteger.meta({
      description: "Member ID that created the record.",
      examples: [1],
    }),
    delta: MoneyByMemberId,
    description: RecordDescription,
    createdAt: NonNegativeSafeInteger.meta({
      description: "Creation time as Unix milliseconds.",
      examples: [exampleCreatedAt],
    }),
    updatedAt: NonNegativeSafeInteger.optional().meta({
      description:
        "Latest edit time for a live record or deletion time for a tombstone, as Unix milliseconds.",
      examples: [exampleCreatedAt + 1_800_000],
    }),
    updatedByMemberId: PositiveSafeInteger.optional().meta({
      description: "Member ID that made the latest edit or deleted the record.",
      examples: [1],
    }),
  })
  .strict()
  .meta({
    description: "A ledger entry or deleted tombstone in a project.",
    examples: [exampleRecords[1]],
  });

const ProjectSummary = z
  .object({
    id: z.string().meta({ description: "Public project UUID.", examples: [exampleProjectId] }),
    name: z.string().meta({ description: "Project name.", examples: ["Japan trip"] }),
    owner: Email,
    member: ProjectMember.nullable().meta({
      description: "Member linked to the caller, or null before joining.",
    }),
    balance: SafeInteger.nullable().meta({
      description: "Caller's current balance in integer cents, or null before joining.",
      examples: [3_100],
    }),
    updatedAt: NonNegativeSafeInteger.meta({
      description: "Latest project change as Unix milliseconds.",
      examples: [exampleUpdatedAt],
    }),
  })
  .strict()
  .meta({ description: "Project information used in account listings." });

const ProjectSummaryWithSyncTime = ProjectSummary.extend({
  lastSyncAt: NonNegativeSafeInteger.meta({
    description: "Registry synchronization time as Unix milliseconds.",
    examples: [exampleUpdatedAt + 500],
  }),
})
  .strict()
  .meta({ description: "Project summary plus registry synchronization time." });

const ProjectCreated = z
  .object({
    id: z.string().meta({ description: "Public project UUID.", examples: [exampleProjectId] }),
    name: z.string().meta({ description: "Project name.", examples: ["Japan trip"] }),
    owner: Email,
    acl: ProjectAcl,
    members: z.array(ProjectMember).meta({ description: "Current project members." }),
  })
  .strict()
  .meta({ description: "Newly created project metadata.", examples: [exampleProjectCreated] });

const Project = ProjectCreated.extend({
  members: z
    .array(ProjectMemberFull)
    .meta({ description: "Current project members with authenticated-read metadata." }),
  records: z
    .array(ProjectRecord)
    .meta({ description: "Requested page of project ledger records, newest first." }),
  balance: MoneyByMemberId,
  updatedAt: NonNegativeSafeInteger.meta({
    description: "Latest project change as Unix milliseconds.",
    examples: [exampleUpdatedAt],
  }),
})
  .strict()
  .meta({
    description: "Complete project metadata, balances, and a page of records.",
    examples: [exampleProject],
  });

const IdentityBody = z
  .object({
    email: Email,
    sessionExpiresAt: NonNegativeSafeInteger.optional().meta({
      description: "Browser-session expiry as Unix seconds; omitted for API-key authentication.",
      examples: [exampleSessionExpiresAt],
    }),
  })
  .strict()
  .meta({
    description: "Authenticated account identity.",
    examples: [{ email: "mika@example.com" }],
  });
const OkBody = z
  .object({ ok: z.literal(true).meta({ description: "Whether the operation succeeded." }) })
  .strict();
const LoginAttemptBody = OkBody.extend({
  id: z.string().optional().meta({ description: "Login-attempt identifier, when returned." }),
}).strict();
const RegistryBody = z
  .object({
    projects: z
      .array(ProjectSummaryWithSyncTime)
      .meta({ description: "Projects visible to the authenticated caller." }),
  })
  .strict();
const ProjectNameBody = z.object({ name: ProjectName }).strict();
const MemberBody = z.object({ member: ProjectMember }).strict();
const RecordCreatedBody = z
  .object({
    id: PositiveSafeInteger.meta({
      description: "Project-local ID of the created record.",
      examples: [5],
    }),
  })
  .strict();
const SettlementPlanBody = z
  .object({
    transfers: z
      .array(TransferBatch)
      .meta({ description: "Grouped transfers that settle the current project balances." }),
  })
  .strict();
const ErrorBody = z
  .object({
    error: z
      .string()
      .meta({ description: "Stable machine-readable error code.", examples: ["invalid_request"] }),
    reason: z
      .string()
      .optional()
      .meta({ description: "Additional human-readable context, when available." }),
  })
  .strict()
  .meta({ description: "API error response.", examples: [exampleError] });
const PingBody = z
  .string()
  .meta({ description: "Worker health-check message.", examples: ["Hello World"] });

const Category = z
  .object({
    id: CategoryId,
    name: z.string().meta({ description: "Display name for the category.", examples: ["Dining"] }),
    normalizedName: z
      .string()
      .meta({ description: "Normalized name used for matching.", examples: ["dining"] }),
    description: z.string().meta({ description: "Human-readable category definition." }),
    icon: CategoryIconName.optional().meta({
      description: "Category icon name. Older category documents may omit this field.",
    }),
    documentText: z.string().meta({ description: "Text used to produce the category embedding." }),
    vectorId: z.string().meta({
      description: "Identifier of the published category vector.",
      examples: ["category:dining"],
    }),
    createdAt: NonNegativeSafeInteger.meta({
      description: "Creation time as Unix milliseconds.",
      examples: [exampleCreatedAt],
    }),
    updatedAt: NonNegativeSafeInteger.meta({
      description: "Latest update time as Unix milliseconds.",
      examples: [exampleUpdatedAt],
    }),
  })
  .strict()
  .meta({ description: "Published spending category.", examples: [exampleCategory] });

const CategoryCandidate = z
  .object({
    category: Category,
    score: z.number().meta({
      description: "Semantic similarity score; larger values are better matches.",
      examples: [0.91],
    }),
  })
  .strict()
  .meta({ description: "A ranked category match." });

const CategoryClassificationBody = z
  .object({
    category: Category.meta({ description: "Highest-scoring category." }),
    score: z
      .number()
      .meta({ description: "Similarity score for the selected category.", examples: [0.91] }),
    candidates: z
      .array(CategoryCandidate)
      .meta({ description: "Ranked category candidates considered by the classifier." }),
  })
  .strict();

const CategoryListBody = z
  .object({
    categories: z.array(Category).meta({ description: "Currently published spending categories." }),
  })
  .strict();

// TODO(schema-source): share canonical public request-body schemas with their route modules instead
// of maintaining separate runtime and OpenAPI copies.
const LoginAttemptRequest = z
  .object({
    email: Email,
    turnstileToken: z
      .string()
      .min(1)
      .max(2048)
      .optional()
      .meta({ description: "Cloudflare Turnstile response token, when required." }),
  })
  .strict();

const LoginVerifyRequest = z
  .object({
    id: z
      .string()
      .regex(/^[0-9A-Za-z]{32}$/u)
      .meta({ description: "Login-attempt identifier." }),
    email: Email,
    code: z
      .string()
      .regex(/^\d{6}$/u)
      .meta({ description: "Six-digit email verification code." }),
  })
  .strict();

const ProjectCreateRequest = z
  .object({
    name: ProjectName,
    acl: ProjectAcl,
    ownerMemberName: MemberName.optional().meta({
      description: "Optional initial member name linked to the project owner.",
    }),
  })
  .strict()
  .meta({ examples: [{ name: "Japan trip", acl: exampleAcl, ownerMemberName: "Mika" }] });

const ProjectRenameRequest = z.object({ name: ProjectName }).strict();
const ProjectAclEmailsRequest = z
  .object({
    emails: z
      .array(Email)
      .min(1)
      .max(ABSOLUTE_LIST_LIMIT)
      .meta({ description: "Accounts to add to or remove from the restricted ACL." }),
  })
  .strict();
const ProjectAclTypeRequest = z
  .object({
    type: z.enum(["public", "restricted"]).meta({ description: "New project access policy type." }),
  })
  .strict();
const ProjectMemberCreateRequest = z.object({ name: MemberName }).strict();
const ProjectMemberEmailUnlinkRequest = z.object({ email: Email }).strict();
const ProjectMemberPatchRequest = z
  .union([
    z.object({ name: MemberName }).strict(),
    z
      .object({
        email: z
          .literal("")
          .meta({ description: "Empty string unlinks the member's current account." }),
      })
      .strict(),
  ])
  .meta({
    description:
      "Rename a member under member-management permissions, or unlink its account as the project owner.",
    examples: [{ name: "Ren Ito" }, { email: "" }],
  });
const ProjectJoinRequest = z
  .union([
    z
      .object({
        memberId: PositiveSafeInteger.meta({
          description: "Existing unlinked member to claim.",
          examples: [2],
        }),
      })
      .strict(),
    z.object({ name: MemberName }).strict(),
  ])
  .meta({
    description: "Claim an existing member or create a new linked member.",
    examples: [{ memberId: 2 }, { name: "Kai" }],
  });
const ProjectPutRecordRequest = z
  .object({
    delta: MoneyByMemberId,
    description: WritableRecordDescription,
  })
  .strict()
  .meta({
    examples: [
      { delta: { "1": -6_200, "2": 6_200 }, description: exampleExpenseDescription },
      { delta: { "1": 6_200, "2": -6_200 }, description: exampleTransferDescription },
      {
        delta: { "1": 3_100, "2": -6_200, "3": 3_100 },
        description: exampleMultiTransferDescription,
      },
      { delta: { "1": -3_100, "2": 3_100 }, description: examplePromiseDescription },
    ],
  });
const ProjectAppendRecordRequest = ProjectPutRecordRequest.extend({
  settle: z.boolean().optional().meta({
    description:
      "For a transfer sent by the caller's linked member, best-effort advances an already-cached settlement plan by removing the matching sender batch instead of recomputing it. This preserves plan stability but may keep a less efficient remaining plan. Any non-settlement record invalidates the cached plan normally.",
  }),
})
  .strict()
  .meta({
    examples: [
      { delta: { "1": -6_200, "2": 6_200 }, description: exampleExpenseDescription },
      { delta: { "1": 6_200, "2": -6_200 }, description: exampleTransferDescription },
      {
        delta: { "1": 3_100, "2": -6_200, "3": 3_100 },
        description: exampleMultiTransferDescription,
        settle: true,
      },
      { delta: { "1": -3_100, "2": 3_100 }, description: examplePromiseDescription },
    ],
  });
const CategoryClassifyRequest = z
  .object({
    name: z
      .string()
      .min(1)
      .max(200)
      .meta({ description: "Expense text to classify.", examples: ["Ramen dinner"] }),
    topK: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .meta({ description: "Maximum number of ranked candidates to return.", examples: [3] }),
  })
  .strict();

export const OpenApiSpecOptions = {
  documentation: {
    info: {
      title: "Seisan API",
      version: "0.1.0",
      description:
        "Seisan is a free shared-expense tracker for groups. It keeps project members, expenses, transfers, and settlements in a shared ledger so everyone can see the current balance.\n\nUse the API to build integrations for Seisan projects, members, balances, records, and spending categories. Authenticate requests with `Authorization: Bearer $SEISAN_API_KEY`.",
    },
    servers: [{ url: "/", description: "Current origin" }],
    components: {
      securitySchemes: {
        apiKeyBearer: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "seisan_v1 API key",
        },
      },
    },
    tags: [
      { name: "System", description: "Worker availability and diagnostics." },
      { name: "Auth", description: "Resolve the account represented by an API key." },
      { name: "Registry", description: "List projects visible to the authenticated account." },
      { name: "Categories", description: "Read and classify published spending categories." },
      { name: "Projects", description: "Create, read, and rename shared-expense projects." },
      { name: "Project ACL", description: "Control public or account-restricted project access." },
      {
        name: "Project Members",
        description: "Create, link, rename, leave, and delete project members.",
      },
      {
        name: "Project Records",
        description:
          "Create, read, replace, and tombstone expense, transfer, and promise records; legacy revert records remain readable.",
      },
    ],
  },
  exclude: [
    /^\/api\/admin(?:\/|$)/u,
    /^\/api\/api-keys(?:\/|$)/u,
    /^\/api\/login(?:\/|$)/u,
    /^\/api\/logout$/u,
  ],
} satisfies Partial<GenerateSpecOptions>;

const NoSecurity = {} satisfies OpenAPIV3_1.SecurityRequirementObject;
const ApiKeyBearerSecurity = {
  apiKeyBearer: [] as string[],
} satisfies OpenAPIV3_1.SecurityRequirementObject;

export const OpenApiSecurity = {
  ApiKeyBearer: [ApiKeyBearerSecurity],
  OptionalApiKeyBearer: [NoSecurity, ApiKeyBearerSecurity],
} satisfies Record<string, OpenAPIV3_1.SecurityRequirementObject[]>;

export const OpenApiParameters = {
  ProjectId: {
    name: "id",
    in: "path",
    required: true,
    description: "Public project ID.",
    schema: { type: "string", format: "uuid", example: exampleProjectId },
  },
  MemberId: {
    name: "memberId",
    in: "path",
    required: true,
    description: "Project-local member ID.",
    schema: { type: "integer", minimum: 1, example: 2 },
  },
  RecordLimit: {
    name: "limit",
    in: "query",
    required: false,
    description: "Maximum number of project records to return in this page.",
    schema: { type: "integer", minimum: 1, example: 50 },
  },
  RecordOffset: {
    name: "offset",
    in: "query",
    required: false,
    description: "Fetch records older than this project-local record ID.",
    schema: { type: "integer", minimum: 1, example: 4 },
  },
  RecordId: {
    name: "recordId",
    in: "path",
    required: true,
    description: "Project-local record ID.",
    schema: { type: "integer", minimum: 1, example: 2 },
  },
} satisfies Record<string, OpenAPIV3_1.ParameterObject>;

export const OpenApiRequests = {
  LoginAttempt: jsonRequest(LoginAttemptRequest, { email: "mika@example.com" }),
  LoginVerify: jsonRequest(LoginVerifyRequest, {
    id: "aB3dE5gH7jK9mN2pQ4sT6vW8yZ1cF0hL",
    email: "mika@example.com",
    code: "482193",
  }),
  ProjectCreate: jsonRequest(ProjectCreateRequest, {
    name: "Japan trip",
    acl: exampleAcl,
    ownerMemberName: "Mika",
  }),
  ProjectRename: jsonRequest(ProjectRenameRequest, { name: "Japan trip 2026" }),
  ProjectAclEmails: jsonRequest(ProjectAclEmailsRequest, { emails: ["kai@example.com"] }),
  ProjectAclType: jsonRequest(ProjectAclTypeRequest, { type: "restricted" }),
  ProjectMemberCreate: jsonRequest(ProjectMemberCreateRequest, { name: "Kai" }),
  ProjectMemberConfigPut: jsonRequest(ProjectMemberConfig, exampleMemberConfig),
  ProjectMemberConfigPatch: jsonRequest(ProjectMemberConfigPatch, { size: 3 }),
  ProjectMemberEmailUnlink: jsonRequest(ProjectMemberEmailUnlinkRequest, {
    email: "ren@example.com",
  }),
  ProjectMemberPatch: jsonRequest(ProjectMemberPatchRequest, { name: "Ren Ito" }),
  ProjectJoin: jsonRequest(ProjectJoinRequest, { memberId: 2 }),
  ProjectAppendRecord: jsonRequest(ProjectAppendRecordRequest, {
    delta: { "1": -6_200, "2": 6_200 },
    description: exampleExpenseDescription,
  }),
  ProjectPutRecord: jsonRequest(ProjectPutRecordRequest, {
    delta: { "1": 6_200, "2": -6_200 },
    description: exampleTransferDescription,
  }),
  CategoryClassify: jsonRequest(CategoryClassifyRequest, { name: "Ramen dinner", topK: 3 }),
} satisfies Record<string, OpenAPIV3_1.RequestBodyObject>;

export const OpenApiResponses = {
  Ping: textResponse("Plain-text health check response.", PingBody, "Hello World"),
  Ok: jsonResponse("Successful response.", OkBody, { ok: true }),
  LoginAttemptAccepted: jsonResponse("Login attempt accepted.", LoginAttemptBody, {
    ok: true,
  }),
  Identity: jsonResponse("Authenticated identity.", IdentityBody, {
    email: "mika@example.com",
  }),
  Registry: jsonResponse("Projects visible to the authenticated caller.", RegistryBody, {
    projects: [
      {
        id: exampleProjectId,
        name: "Japan trip",
        owner: "mika@example.com",
        member: exampleMember,
        balance: 3_100,
        updatedAt: exampleUpdatedAt,
        lastSyncAt: exampleUpdatedAt + 500,
      },
    ],
  }),
  CategoryClassification: jsonResponse(
    "Category classification result.",
    CategoryClassificationBody,
    {
      category: exampleCategory,
      score: 0.91,
      candidates: [
        { category: exampleCategory, score: 0.91 },
        { category: exampleGroceriesCategory, score: 0.63 },
      ],
    },
  ),
  CategoryList: jsonResponse("Configured spending categories.", CategoryListBody, {
    categories: [exampleCategory, exampleGroceriesCategory],
  }),
  ProjectCreated: jsonResponse("Created project.", ProjectCreated, exampleProjectCreated),
  Project: jsonResponse("Project details and records.", Project, exampleProject),
  ProjectName: jsonResponse("Updated project name.", ProjectNameBody, {
    name: "Japan trip 2026",
  }),
  Member: jsonResponse("Project member.", MemberBody, { member: exampleMember }),
  ProjectMemberConfig: jsonResponse(
    "Project member config.",
    ProjectMemberConfig,
    exampleMemberConfig,
  ),
  RecordCreated: jsonResponse("Created project record.", RecordCreatedBody, { id: 5 }),
  ProjectRecord: jsonResponse("Project record.", ProjectRecord, exampleRecords[1]),
  SettlementPlan: jsonResponse("Current project settlement plan.", SettlementPlanBody, {
    transfers: [exampleTransferBatch],
  }),
  InvalidRequest: jsonResponse("Malformed or invalid request.", ErrorBody, exampleError),
  Unauthorized: jsonResponse("Authentication is required or invalid.", ErrorBody, {
    error: "unauthorized",
  }),
  Forbidden: jsonResponse("The caller is not allowed to perform this action.", ErrorBody, {
    error: "forbidden",
  }),
  NotFound: jsonResponse("The requested resource was not found.", ErrorBody, {
    error: "not_found",
  }),
  Conflict: jsonResponse(
    "The request conflicts with project state or configured limits.",
    ErrorBody,
    { error: "conflict", reason: "The requested change conflicts with project state." },
  ),
  RateLimited: jsonResponse("The request was rate limited.", ErrorBody, {
    error: "rate_limited",
  }),
  InternalServerError: jsonResponse("Unexpected server error.", ErrorBody, {
    error: "internal_server_error",
  }),
  ServiceUnavailable: jsonResponse("A required service is temporarily unavailable.", ErrorBody, {
    error: "internal_server_error",
  }),
  NoContent: { description: "Successful no-content response." },
} satisfies Record<string, OpenApiResponse>;

export function errorResponses(...statuses: Array<400 | 401 | 403 | 404 | 409 | 429 | 500 | 503>) {
  const responses: OpenApiResponses = {};
  for (const status of statuses) {
    responses[status] = errorResponseByStatus(status);
  }
  return responses;
}

function errorResponseByStatus(
  status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503,
): OpenApiResponse {
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
    case 503:
      return OpenApiResponses.ServiceUnavailable;
  }
}

function jsonRequest(schema: z.ZodType, example: unknown): OpenAPIV3_1.RequestBodyObject {
  return {
    required: true,
    content: {
      [JsonMediaType]: {
        schema: openApiSchema(schema),
        example,
      },
    },
  };
}

function jsonResponse(description: string, schema: z.ZodType, example: unknown): OpenApiResponse {
  return {
    description,
    content: {
      [JsonMediaType]: {
        schema: resolver(schema),
        example,
      },
    },
  };
}

function textResponse(description: string, schema: z.ZodType, example: string): OpenApiResponse {
  return {
    description,
    content: {
      [TextMediaType]: {
        schema: resolver(schema),
        example,
      },
    },
  };
}

function openApiSchema(schema: z.ZodType): OpenAPIV3_1.SchemaObject {
  const jsonSchema = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete jsonSchema.$schema;
  return jsonSchema as OpenAPIV3_1.SchemaObject;
}
