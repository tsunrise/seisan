import type { IconName } from "../shared/icon-names";

export type ProjectAcl = { type: "public" } | { type: "restricted"; emails: string[] };
export type MoneyByMemberId = Record<string, number>;

export interface ProjectMember {
  id: number;
  name: string;
  deleted: boolean;
  linkedEmail?: string;
}

export type RecordDescription =
  | {
      type: "expense";
      name: string;
      paid: MoneyByMemberId;
      liability: MoneyByMemberId;
      categoryId?: string;
    }
  | {
      type: "transfer";
      from: number;
      to: number;
      amount: number;
    }
  | {
      type: "promise";
      debtorMemberId: number;
      creditorMemberId: number;
      amount: number;
      reason?: string;
    }
  | {
      type: "revert";
      id: number;
    };

export interface ProjectRecord {
  id: number;
  authorMemberId: number;
  delta: MoneyByMemberId;
  description: RecordDescription;
  createdAt: number;
  reverted?: {
    recordId: number;
    authorMemberId: number;
    createdAt: number;
  };
}

export interface ProjectCreated {
  id: string;
  name: string;
  owner: string;
  acl: ProjectAcl;
  members: ProjectMember[];
}

export interface Project extends ProjectCreated {
  records: ProjectRecord[];
  balance: MoneyByMemberId;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  owner: string;
  member: ProjectMember | null;
  balance: number | null;
  updatedAt: number;
}

export type WithSyncTime<T> = T & { lastSyncAt: number };

export interface Category {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  icon?: IconName;
  documentText: string;
  vectorId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CategoryCandidate {
  category: Category;
  score: number;
}

export interface CategoryClassification {
  category: Category;
  score: number;
  candidates: CategoryCandidate[];
}

export interface Limits {
  "projects.maxLinkedProjects": number;
  "projects.maxOwnedProjects": number;
  "projects.maxMembersPerProject": number;
  "projects.maxProjectNameLength": number;
  "projects.maxMemberNameLength": number;
  "projects.maxAclEmails": number;
  "apikeys.max_keys": number;
  "apikeys.max_expiry": number;
  "records.allow_post": boolean;
  "records.defaultPageSize": number;
  "records.maxPageSize": number;
  "records.maxRecordsPerOwnedProject": number;
  "records.maxExpenseNameLength": number;
  "money.maxAmountCents": number;
  "money.maxBalanceCents": number;
}

export type LimitName = keyof Limits;
export type LimitValue = Limits[LimitName] | boolean;
export type LimitsDocument = Partial<Record<LimitName, LimitValue>>;

export interface AdminLimitDefinition {
  name: LimitName;
  type: "integer" | "boolean";
}

export interface AdminPage {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

export interface AdminProject {
  id: string;
  name: string;
  owner: string;
  recordCount: number;
  memberCount: number;
  updatedAt: number;
  lastSyncAt: number;
}

export type AdminProjectSort = "records_desc" | "updated_desc" | "updated_asc";

export interface AdminOwnerSummary {
  owner: string;
  projectCount: number;
  recordCount: number;
  updatedAt: number;
}

export interface ApiKeyMetadata {
  id: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface CreatedApiKey {
  apiKey: string;
  key: ApiKeyMetadata;
}

interface ParsedApiErrorBody {
  code: string;
  reason: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly reason: string | null;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    const parsed = parseApiErrorBody(responseBody);
    super(parsed?.code ?? (responseBody || `Request failed with status ${status}`));
    this.name = "ApiError";
    this.status = status;
    this.code = parsed?.code ?? null;
    this.reason = parsed?.reason ?? null;
    this.responseBody = responseBody;
  }
}

export async function whoami(): Promise<{ email: string; sessionExpiresAt?: number }> {
  return requestJson("/api/whoami");
}

export async function adminWhoami(): Promise<{
  ok: true;
  email: string | null;
  local: boolean;
}> {
  const response = await fetch("/api/admin/whoami", {
    method: "GET",
    headers: new Headers({ Accept: "application/json" }),
    credentials: "same-origin",
    redirect: "manual",
  });
  if (response.type === "opaqueredirect" || isRedirectResponse(response)) {
    return redirectToAdminAccessLogin();
  }

  if (response.status !== 200) {
    throw new ApiError(response.status, await response.text());
  }
  return (await response.json()) as { ok: true; email: string | null; local: boolean };
}

export async function getAdminDefaultLimits(): Promise<LimitsDocument> {
  return requestJson("/api/admin/limits/default");
}

export async function getAdminBuiltInLimits(): Promise<Limits> {
  return requestJson("/api/admin/limits/built-in");
}

export async function getAdminLimitSchema(): Promise<AdminLimitDefinition[]> {
  return requestJson("/api/admin/limits-schema");
}

export async function putAdminDefaultLimits(limits: LimitsDocument): Promise<void> {
  await requestEmpty("/api/admin/limits/default", {
    method: "PUT",
    body: limits,
    expectedStatus: 204,
  });
}

export async function getAdminUserLimits(email: string): Promise<LimitsDocument> {
  return requestJson(`/api/admin/limits/user/${encodeURIComponent(email)}`);
}

export async function putAdminUserLimits(email: string, limits: LimitsDocument): Promise<void> {
  await requestEmpty(`/api/admin/limits/user/${encodeURIComponent(email)}`, {
    method: "PUT",
    body: limits,
    expectedStatus: 204,
  });
}

export async function listAdminProjects(
  input: {
    limit?: number;
    offset?: number;
    ownerEmail?: string;
    sort?: AdminProjectSort;
  } = {},
): Promise<{ projects: AdminProject[]; page: AdminPage }> {
  const params = new URLSearchParams();
  appendPageParams(params, input);
  if (input.ownerEmail) {
    params.set("ownerEmail", input.ownerEmail);
  }
  if (input.sort) {
    params.set("sort", input.sort);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return requestJson(`/api/admin/projects${query}`);
}

export async function listAdminUsers(
  input: { limit?: number; offset?: number } = {},
): Promise<{ users: AdminOwnerSummary[]; page: AdminPage }> {
  const params = new URLSearchParams();
  appendPageParams(params, input);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return requestJson(`/api/admin/users${query}`);
}

export async function requestLoginCode(
  email: string,
  turnstileToken?: string,
): Promise<{ id?: string }> {
  return requestJson("/api/login/attempt", {
    method: "POST",
    body: { email, ...(turnstileToken ? { turnstileToken } : {}) },
    expectedStatus: 202,
  });
}

export async function verifyLoginCode(id: string, email: string, code: string): Promise<void> {
  await requestJson("/api/login/verify", {
    method: "POST",
    body: { id, email, code },
  });
}

export async function logout(): Promise<void> {
  await requestEmpty("/api/logout", { method: "POST", expectedStatus: 204 });
}

export async function listApiKeys(): Promise<ApiKeyMetadata[]> {
  const response = await requestJson<{ keys: ApiKeyMetadata[] }>("/api/api-keys");
  return response.keys;
}

export async function createApiKey(input: {
  label: string;
  expiresAt: number;
}): Promise<CreatedApiKey> {
  return requestJson("/api/api-keys", {
    method: "POST",
    body: input,
    expectedStatus: 201,
  });
}

export async function revokeApiKey(id: string): Promise<void> {
  await requestEmpty(`/api/api-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    expectedStatus: 204,
  });
}

export async function listProjects(): Promise<Array<WithSyncTime<ProjectSummary>>> {
  const response = await requestJson<{ projects: Array<WithSyncTime<ProjectSummary>> }>(
    "/api/registry",
  );
  return response.projects;
}

export async function classifyCategory(
  input: {
    name: string;
    topK?: number;
  },
  options: { signal?: AbortSignal } = {},
): Promise<CategoryClassification> {
  return requestJson("/api/categories/classify", {
    method: "POST",
    body: input,
    signal: options.signal,
  });
}

export async function listCategories(): Promise<Category[]> {
  const response = await requestJson<{ categories: Category[] }>("/api/categories");
  return response.categories;
}

export async function createProject(input: {
  name: string;
  ownerMemberName?: string;
  acl: ProjectAcl;
}): Promise<ProjectCreated> {
  return requestJson("/api/project", {
    method: "PUT",
    body: input,
    expectedStatus: 201,
  });
}

export async function getProject(
  projectId: string,
  input: { limit?: number; offset?: number } = {},
): Promise<Project> {
  const params = new URLSearchParams();
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  if (input.offset !== undefined) {
    params.set("offset", String(input.offset));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return requestJson(`/api/project/${projectId}${query}`);
}

export async function renameProject(projectId: string, name: string): Promise<{ name: string }> {
  return requestJson(`/api/project/${projectId}`, {
    method: "PATCH",
    body: { name },
  });
}

export async function appendRecord(
  projectId: string,
  input: { delta: MoneyByMemberId; description: RecordDescription },
): Promise<{ id: number }> {
  return requestJson(`/api/project/${projectId}`, {
    method: "POST",
    body: input,
    expectedStatus: 201,
  });
}

export async function joinProject(
  projectId: string,
  input: { memberId: number } | { name: string },
): Promise<{ member: ProjectMember }> {
  return requestJson(`/api/project/${projectId}/join`, {
    method: "POST",
    body: input,
    expectedStatus: 201,
  });
}

export async function leaveProject(projectId: string): Promise<void> {
  await requestEmpty(`/api/project/${projectId}/leave`, {
    method: "POST",
    expectedStatus: 204,
  });
}

export async function unlinkMemberEmail(projectId: string, email: string): Promise<void> {
  await requestEmpty(`/api/project/${projectId}/member-links`, {
    method: "DELETE",
    body: { email },
    expectedStatus: 204,
  });
}

export async function createMember(
  projectId: string,
  name: string,
): Promise<{ member: ProjectMember }> {
  return requestJson(`/api/project/${projectId}/members`, {
    method: "POST",
    body: { name },
    expectedStatus: 201,
  });
}

export async function patchMember(
  projectId: string,
  memberId: number,
  patch: { name: string } | { email: "" },
): Promise<{ member: ProjectMember }> {
  return requestJson(`/api/project/${projectId}/members/${memberId}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function deleteMember(projectId: string, memberId: number): Promise<void> {
  await requestEmpty(`/api/project/${projectId}/members/${memberId}`, {
    method: "DELETE",
    expectedStatus: 204,
  });
}

export async function setAclType(projectId: string, type: ProjectAcl["type"]): Promise<void> {
  await requestEmpty(`/api/project/${projectId}/acl/type`, {
    method: "PUT",
    body: { type },
    expectedStatus: 204,
  });
}

export async function appendAclEmails(projectId: string, emails: string[]): Promise<void> {
  if (emails.length === 0) {
    return;
  }
  await requestEmpty(`/api/project/${projectId}/acl/emails`, {
    method: "POST",
    body: { emails },
    expectedStatus: 204,
  });
}

export async function removeAclEmails(projectId: string, emails: string[]): Promise<void> {
  if (emails.length === 0) {
    return;
  }
  await requestEmpty(`/api/project/${projectId}/acl/emails`, {
    method: "DELETE",
    body: { emails },
    expectedStatus: 204,
  });
}

function appendPageParams(
  params: URLSearchParams,
  input: { limit?: number; offset?: number },
): void {
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  if (input.offset !== undefined) {
    params.set("offset", String(input.offset));
  }
}

function redirectToAdminAccessLogin(): Promise<never> {
  const loginUrl = new URL("/api/admin/login", window.location.href);
  loginUrl.searchParams.set("returnTo", currentBrowserPath());
  window.location.assign(`${loginUrl.pathname}${loginUrl.search}`);
  return new Promise<never>(() => {});
}

function currentBrowserPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function isRedirectResponse(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

async function requestJson<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    expectedStatus?: number;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await request(path, options);
  return (await response.json()) as T;
}

async function requestEmpty(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    expectedStatus?: number;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  await request(path, options);
}

async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    expectedStatus?: number;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const headers = new Headers({ Accept: "application/json" });
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body,
    signal: options.signal,
    credentials: "same-origin",
  });
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    throw new ApiError(response.status, await response.text());
  }
  return response;
}

function parseApiErrorBody(responseBody: string): ParsedApiErrorBody | null {
  if (!responseBody) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return null;
  }

  if (!isObjectRecord(parsed) || typeof parsed.error !== "string" || parsed.error.length === 0) {
    return null;
  }

  return {
    code: parsed.error,
    reason: typeof parsed.reason === "string" && parsed.reason.length > 0 ? parsed.reason : null,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
