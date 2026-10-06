import { pageParams, requestEmpty, requestJson, withQuery } from "./client";
import type {
  MoneyByMemberId,
  Project,
  ProjectAcl,
  ProjectCreated,
  ProjectMember,
  ProjectMemberConfig,
  ProjectRecord,
  ProjectSummary,
  TransferBatch,
  WithSyncTime,
  WritableRecordDescription,
} from "./types";

export async function listProjects(): Promise<Array<WithSyncTime<ProjectSummary>>> {
  const response = await requestJson<{ projects: Array<WithSyncTime<ProjectSummary>> }>(
    "/api/registry",
  );
  return response.projects;
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
  return requestJson(withQuery(`/api/project/${projectId}`, pageParams(input)));
}

export async function renameProject(projectId: string, name: string): Promise<{ name: string }> {
  return requestJson(`/api/project/${projectId}`, {
    method: "PATCH",
    body: { name },
  });
}

export async function getSettlementPlan(
  projectId: string,
): Promise<{ transfers: TransferBatch[] }> {
  return requestJson(`/api/project/${projectId}/settle`);
}

// Records

export async function appendRecord(
  projectId: string,
  input: { delta: MoneyByMemberId; description: WritableRecordDescription; settle?: boolean },
): Promise<{ id: number }> {
  return requestJson(`/api/project/${projectId}/record`, {
    method: "POST",
    body: input,
    expectedStatus: 201,
  });
}

export async function getRecord(projectId: string, recordId: number): Promise<ProjectRecord> {
  return requestJson(`/api/project/${projectId}/record/${recordId}`);
}

export async function putRecord(
  projectId: string,
  recordId: number,
  input: { delta: MoneyByMemberId; description: WritableRecordDescription },
): Promise<ProjectRecord> {
  return requestJson(`/api/project/${projectId}/record/${recordId}`, {
    method: "PUT",
    body: input,
  });
}

export async function deleteRecord(projectId: string, recordId: number): Promise<void> {
  await requestEmpty(`/api/project/${projectId}/record/${recordId}`, {
    method: "DELETE",
    expectedStatus: 204,
  });
}

// Membership

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

export async function putMemberConfig(
  projectId: string,
  memberId: number,
  config: ProjectMemberConfig,
): Promise<ProjectMemberConfig> {
  return requestJson(`/api/project/${projectId}/members/${memberId}/config`, {
    method: "PUT",
    body: config,
  });
}

export async function patchMemberConfig(
  projectId: string,
  memberId: number,
  patch: { size?: number | null; paymentMethod?: string | null },
): Promise<ProjectMemberConfig> {
  return requestJson(`/api/project/${projectId}/members/${memberId}/config`, {
    method: "PATCH",
    body: patch,
  });
}

// Access control

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
