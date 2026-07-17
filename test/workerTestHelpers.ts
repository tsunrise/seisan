import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { expect, vi } from "vitest";

import type { IconName } from "../shared/icon-names";
import { CATEGORY_CONFIG_KEY, CategoriesDocument, type Category } from "../worker/category";
import { SESSION_COOKIE_NAME } from "../worker/constants";
import { signSessionToken } from "../worker/crypto";
import { GLOBAL_CONFIG_STORE_NAME } from "../worker/globalConfig";
import { LIMITS_STORE_NAME, LimitsKvStore, type LimitsDocument } from "../worker/limits";
import worker, { type ProjectStore } from "../worker/index";
import { PROJECTS_REGISTRY_NAME, type ProjectMember } from "../worker/project";

export const AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
export const LOGIN_EMAIL_FROM = "login@example.com";
export const REGISTRY_LIST_CACHE_NAME = "seisan-registry";
export const REGISTRY_LIST_CACHE_HOST = "cache.seisan.waga.me";

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

export const TEST_CATEGORY_VECTOR_NAMESPACE = "categories-00000000-0000-4000-8000-000000000001";

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
      APPEND_RECORD_ACCOUNT_RATE_LIMITER: makeAllowingRateLimit(),
      APPEND_RECORD_PROJECT_RATE_LIMITER: makeAllowingRateLimit(),
      ...overrides,
    } as Env,
  };
}

function makeAllowingRateLimit(): RateLimit {
  return {
    limit: vi.fn(async () => ({ success: true })),
  };
}

export async function cleanupWorkerTestState(): Promise<void> {
  vi.restoreAllMocks();
  await env.CONFIGS.delete(LimitsKvStore.defaultKey());
  await env.PUBLISHED_GLOBAL_CONFIG.delete(CATEGORY_CONFIG_KEY);
  await runInDurableObject(
    env.LIMITS_STORE.getByName(LIMITS_STORE_NAME),
    async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM limits");
    },
  );
  await runInDurableObject(
    env.GLOBAL_CONFIG.getByName(GLOBAL_CONFIG_STORE_NAME),
    async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM global_config");
    },
  );
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

export function limitsDocument(overrides: LimitsDocument): LimitsDocument {
  return overrides;
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

export function testCategory(
  input: {
    id?: string;
    name?: string;
    description?: string;
    icon?: IconName;
    nowMs?: number;
  } = {},
): Category {
  const id = input.id ?? "00000000-0000-4000-8000-000000000010";
  const name = normalizeCategoryText(input.name ?? "Restaurant");
  const description = normalizeCategoryText(input.description ?? "Prepared meals");
  const nowMs = input.nowMs ?? 1_000;
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    description,
    ...(input.icon ? { icon: input.icon } : {}),
    documentText: `title: ${name} | text: ${description || name}`,
    vectorId: `category:${id}`,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
}

export async function putPublishedCategories(testEnv: Env, categories: Category[]): Promise<void> {
  await testEnv.PUBLISHED_GLOBAL_CONFIG.put(
    CATEGORY_CONFIG_KEY,
    JSON.stringify(
      CategoriesDocument.parse({
        version: 1,
        vectorNamespace: TEST_CATEGORY_VECTOR_NAMESPACE,
        categories,
      }),
    ),
  );
}

function normalizeCategoryText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
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
  const listed = await testEnv.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME).listProjects({
    callerEmail: email,
  });
  if (!listed.ok) {
    throw new Error(`Registry list failed: ${listed.error}`);
  }
  return listed.projects;
}
