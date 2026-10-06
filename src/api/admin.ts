import { pageParams, requestEmpty, requestJson, withQuery } from "./client";
import { ApiError } from "./errors";
import type {
  AdminBlockedEmailTestResult,
  AdminIdentity,
  AdminLimitDefinition,
  AdminOwnerSummary,
  AdminPage,
  AdminProject,
  AdminProjectSort,
  BlockedEmailsDocument,
  Limits,
  LimitsDocument,
} from "./types";

export async function adminWhoami(): Promise<AdminIdentity> {
  const response = await fetch("/api/admin/whoami", {
    method: "GET",
    headers: new Headers({ Accept: "application/json" }),
    credentials: "same-origin",
    redirect: "manual",
  } as RequestInit & { credentials: "same-origin"; redirect: "manual" });
  if (String(response.type) === "opaqueredirect" || isRedirectResponse(response)) {
    return redirectToAdminAccessLogin();
  }

  if (response.status !== 200) {
    throw new ApiError(response.status, await response.text());
  }
  return (await response.json()) as AdminIdentity;
}

// Limits

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

// Blocked emails

export async function getAdminBlockedEmails(): Promise<BlockedEmailsDocument> {
  return requestJson("/api/admin/blocked_emails");
}

export async function putAdminBlockedEmails(document: BlockedEmailsDocument): Promise<void> {
  await requestEmpty("/api/admin/blocked_emails", {
    method: "PUT",
    body: document,
    expectedStatus: 204,
  });
}

export async function testAdminBlockedEmail(email: string): Promise<AdminBlockedEmailTestResult> {
  return requestJson("/api/admin/blocked_emails/test", {
    method: "POST",
    body: { email },
  });
}

// Registry listings

export async function listAdminProjects(
  input: {
    limit?: number;
    offset?: number;
    ownerEmail?: string;
    sort?: AdminProjectSort;
  } = {},
): Promise<{ projects: AdminProject[]; page: AdminPage }> {
  const params = pageParams(input);
  if (input.ownerEmail) {
    params.set("ownerEmail", input.ownerEmail);
  }
  if (input.sort) {
    params.set("sort", input.sort);
  }
  return requestJson(withQuery("/api/admin/projects", params));
}

export async function listAdminUsers(
  input: { limit?: number; offset?: number } = {},
): Promise<{ users: AdminOwnerSummary[]; page: AdminPage }> {
  return requestJson(withQuery("/api/admin/users", pageParams(input)));
}

function redirectToAdminAccessLogin(): Promise<never> {
  const location = browserLocation();
  const loginUrl = new URL("/api/admin/login", location.href);
  loginUrl.searchParams.set("returnTo", currentBrowserPath());
  location.assign(`${loginUrl.pathname}${loginUrl.search}`);
  return new Promise<never>(() => {});
}

function currentBrowserPath(): string {
  const location = browserLocation();
  return `${location.pathname}${location.search}${location.hash}`;
}

function isRedirectResponse(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

function browserLocation(): {
  href: string;
  pathname: string;
  search: string;
  hash: string;
  assign(url: string): void;
} {
  return (
    globalThis as typeof globalThis & {
      location: {
        href: string;
        pathname: string;
        search: string;
        hash: string;
        assign(url: string): void;
      };
    }
  ).location;
}
