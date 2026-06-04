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
    }
  | {
      type: "transfer";
      from: number;
      to: number;
      amount: number;
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
}

export interface Project {
  id: string;
  name: string;
  owner: string;
  acl: ProjectAcl;
  members: ProjectMember[];
  records: ProjectRecord[];
  balance: MoneyByMemberId;
}

export interface ProjectSummary {
  id: string;
  name: string;
  owner: string;
  member: ProjectMember | null;
  balance: number | null;
  updatedAt: number;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function whoami(): Promise<{ email: string }> {
  return requestJson("/api/whoami");
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

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await requestJson<{ projects: ProjectSummary[] }>("/api/projects");
  return response.projects;
}

export async function createProject(input: {
  name: string;
  ownerMemberName?: string;
  acl: ProjectAcl;
}): Promise<Project> {
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

async function requestJson<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    expectedStatus?: number;
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
    credentials: "same-origin",
  });
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    throw new ApiError(response.status, await response.text());
  }
  return response;
}
