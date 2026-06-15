import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { expect, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "../worker/constants";
import { signSessionToken } from "../worker/crypto";
import { BUILTIN_DEFAULT_LIMITS, LimitsKvStore, type LimitsDocument } from "../worker/limits";
import worker, { type ProjectStore } from "../worker/index";
import { PROJECTS_REGISTRY_NAME, type ProjectMember } from "../worker/project";

export const AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
export const LOGIN_EMAIL_FROM = "login@example.com";
export const REGISTRY_LIST_CACHE_NAME = "seisan-registry";
export const REGISTRY_LIST_CACHE_HOST = "cache.seisan.waga.me";
const PROJECT_STORE_METADATA_TOUCH_BACKFILL_NAME = "20260615-project-store-metadata-touch";

export interface TestEnv {
  env: Env;
}

export interface ProjectResponse {
  id: string;
  name: string;
  owner: string;
  acl: { type: "public" } | { type: "restricted"; emails: string[] };
  members: ProjectMember[];
  records: unknown[];
  balance: Record<string, number>;
}

export interface ProjectSummaryResponse {
  projects: Array<{
    id: string;
    name: string;
    owner: string;
    member: ProjectMember | null;
    balance: number | null;
    updatedAt: number;
    lastSyncAt: number;
  }>;
}

export interface ProjectRefCacheValue {
  doId: string;
}

export function projectRefCacheKey(projectId: string): string {
  return `project:${projectId}`;
}

export function serializeProjectRefCacheValue(value: ProjectRefCacheValue): string {
  return JSON.stringify({ doId: value.doId });
}

export function parseProjectRefCacheValue(value: string): ProjectRefCacheValue | null {
  try {
    const parsed = JSON.parse(value) as Partial<ProjectRefCacheValue>;
    if (typeof parsed.doId !== "string" || !/^[0-9a-f]{64}$/u.test(parsed.doId)) {
      return null;
    }
    return { doId: parsed.doId };
  } catch {
    return null;
  }
}

export function makeEnv(overrides: Partial<Env> = {}): TestEnv {
  return {
    env: {
      ...env,
      AUTH_SECRET,
      LOGIN_EMAIL_FROM,
      SEND_EMAIL: { send: vi.fn() } as unknown as SendEmail,
      ...overrides,
    } as Env,
  };
}

export async function cleanupWorkerTestState(): Promise<void> {
  vi.restoreAllMocks();
  await env.CONFIGS.delete(LimitsKvStore.defaultKey());
}

export async function dispatch(
  path: string,
  testEnv: Env,
  init: RequestInit = {},
): Promise<Response> {
  const apiPath = path.startsWith("/api/") ? path : `/api${path}`;
  return dispatchUrl(`https://seisan.test${apiPath}`, testEnv, init);
}

export async function dispatchUrl(
  url: string,
  testEnv: Env,
  init: RequestInit = {},
): Promise<Response> {
  const request = new Request(url, init);
  const context = createExecutionContext();
  const response = await worker.fetch(
    request as Request<unknown, IncomingRequestCfProperties>,
    testEnv,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

export async function adminDispatch(
  path: string,
  testEnv: Env,
  init: RequestInit = {},
  origin = "http://localhost",
): Promise<Response> {
  return dispatchUrl(`${origin}/api/admin${path}`, testEnv, init);
}

export async function authHeaders(email = "owner@example.com"): Promise<HeadersInit> {
  const { token } = await signSessionToken(email, AUTH_SECRET);
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

export function jsonBody(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  headers?: HeadersInit,
): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  };
}

export function limitsDocument(overrides: {
  projects?: Partial<typeof BUILTIN_DEFAULT_LIMITS.projects>;
  records?: Partial<typeof BUILTIN_DEFAULT_LIMITS.records>;
  money?: Partial<typeof BUILTIN_DEFAULT_LIMITS.money>;
}): LimitsDocument {
  return {
    ...(overrides.projects
      ? { projects: { ...BUILTIN_DEFAULT_LIMITS.projects, ...overrides.projects } }
      : {}),
    ...(overrides.records
      ? { records: { ...BUILTIN_DEFAULT_LIMITS.records, ...overrides.records } }
      : {}),
    ...(overrides.money ? { money: { ...BUILTIN_DEFAULT_LIMITS.money, ...overrides.money } } : {}),
  };
}

export async function putDefaultLimits(testEnv: Env, limits: LimitsDocument): Promise<void> {
  await testEnv.CONFIGS.put(LimitsKvStore.defaultKey(), JSON.stringify(limits));
}

export async function putUserLimits(
  testEnv: Env,
  email: string,
  limits: LimitsDocument,
): Promise<void> {
  await testEnv.CONFIGS.put(LimitsKvStore.userKey(email), JSON.stringify(limits));
}

export async function createProject(
  testEnv: Env,
  input: {
    acl?: { type: "public" } | { type: "restricted"; emails: string[] };
    owner?: string;
    ownerMemberName?: string;
    name?: string;
  } = {},
): Promise<ProjectResponse> {
  const response = await dispatch(
    "/project",
    testEnv,
    jsonBody(
      "PUT",
      {
        name: input.name ?? "Day Trip",
        acl: input.acl ?? { type: "public" },
        ownerMemberName: input.ownerMemberName,
      },
      await authHeaders(input.owner ?? "owner@example.com"),
    ),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as ProjectResponse;
  await waitForProjectCache(testEnv, body.id);
  await markProjectStoreMetadataTouchBackfillDone(testEnv);
  return body;
}

export async function getProject(
  testEnv: Env,
  projectId: string,
  email = "owner@example.com",
): Promise<ProjectResponse> {
  const response = await dispatch(`/project/${projectId}`, testEnv, {
    headers: await authHeaders(email),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ProjectResponse;
}

export async function createMember(
  testEnv: Env,
  projectId: string,
  name: string,
  email = "owner@example.com",
): Promise<ProjectMember> {
  const response = await dispatch(
    `/project/${projectId}/members`,
    testEnv,
    jsonBody("POST", { name }, await authHeaders(email)),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { member: ProjectMember }).member;
}

export async function waitForProjectCache(testEnv: Env, projectId: string) {
  const cacheKey = projectRefCacheKey(projectId);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const cacheValue = await testEnv.PROJECT_REGISTRY_CACHE.get(cacheKey);
    const cachedProject = parseProjectRefCacheValue(cacheValue ?? "");
    if (cachedProject) {
      return cachedProject;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for project registry cache for ${projectId}`);
}

export async function waitForProjectCacheMissRepair(testEnv: Env, projectId: string) {
  const cacheKey = projectRefCacheKey(projectId);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const cacheValue = await testEnv.PROJECT_REGISTRY_CACHE.get(cacheKey);
    if (parseProjectRefCacheValue(cacheValue ?? "")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for project registry cache repair for ${projectId}`);
}

export async function getRegistryListCacheResponse(email: string): Promise<Response | undefined> {
  const cache = await caches.open(REGISTRY_LIST_CACHE_NAME);
  return cache.match(registryListCacheRequest(email));
}

export function registryListCacheRequest(email: string): Request {
  return new Request(`https://${REGISTRY_LIST_CACHE_HOST}/registry/${encodeURIComponent(email)}`);
}

export async function getProjectStoreStub(
  testEnv: Env,
  projectId: string,
): Promise<DurableObjectStub<ProjectStore>> {
  const cachedProject = await waitForProjectCache(testEnv, projectId);
  return testEnv.PROJECT_STORE.get(testEnv.PROJECT_STORE.idFromString(cachedProject.doId));
}

export async function getProjectSummaryAlarm(
  testEnv: Env,
  projectId: string,
): Promise<number | null> {
  const stub = await getProjectStoreStub(testEnv, projectId);
  return runInDurableObject(stub, async (_instance, state) => state.storage.getAlarm());
}

export async function runProjectSummaryAlarm(testEnv: Env, projectId: string): Promise<boolean> {
  const stub = await getProjectStoreStub(testEnv, projectId);
  const alarm = await runInDurableObject(stub, async (_instance, state) =>
    state.storage.getAlarm(),
  );
  if (alarm === null) {
    throw new Error(
      `Expected project summary alarm to be configured for ${projectId} after waitOnExecutionContext`,
    );
  }
  return runDurableObjectAlarm(stub);
}

export async function listProjectsFromRegistry(
  testEnv: Env,
  email: string,
): Promise<ProjectSummaryResponse["projects"]> {
  await markProjectStoreMetadataTouchBackfillDone(testEnv);
  const listed = await testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME).listProjects({
    callerEmail: email,
  });
  if (!listed.ok) {
    throw new Error(`Registry list failed: ${listed.error}`);
  }
  return listed.projects;
}

async function markProjectStoreMetadataTouchBackfillDone(testEnv: Env): Promise<void> {
  await runInDurableObject(
    testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME),
    async (_instance, state) => {
      await state.storage.put("dbBackfillState", PROJECT_STORE_METADATA_TOUCH_BACKFILL_NAME);
    },
  );
}
