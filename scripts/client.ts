import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { IconName } from "../shared/icon-names";

const execFileAsync = promisify(execFile);

export const DEFAULT_API_BASE_URL = "http://localhost:5173";
export const DEV_API_BASE_URL = "https://dev.seisan.waga.me";
export const PRODUCTION_API_BASE_URL = "https://seisan.waga.me";

// TODO(schema-source): publish a canonical API-key wire schema for both the Worker and Node client
// instead of maintaining this format separately from worker/apiKey.ts.
const API_KEY_PATTERN = /^seisan_v1_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{32}$/u;

export type ApiTargetEnv = "local" | "dev" | "production";

export interface ApiKeyStore {
  load(): Promise<string | null>;
  save(apiKey: string): Promise<void>;
  clear(): Promise<void>;
}

export interface CloudflareAccessTokenProvider {
  load(appUrl: string): Promise<string>;
}

export interface SeisanClientOptions {
  targetEnv?: ApiTargetEnv;
  apiKey?: string;
  apiKeyStore?: ApiKeyStore;
  fetchFn?: typeof fetch;
  cloudflareAccessTokenProvider?: CloudflareAccessTokenProvider;
}

// TODO(schema-source): import category operation types from canonical shared schemas instead of
// duplicating worker/category, OpenAPI, and frontend declarations.
export interface Category {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  icon?: IconName;
  createdAt: number;
  updatedAt: number;
}

export interface CategoryWriteInput {
  name: string;
  description?: string;
  icon?: IconName;
}

export interface CategoryWriteResponse {
  category: Category;
}

export interface CategoryListResponse {
  categories: Category[];
}

export interface CategoryFixResponse {
  categories: Category[];
  removed: Array<{ id: string | null; name: string | null }>;
  changed: boolean;
}

export class ApiError extends Error {
  readonly response: Response;
  readonly responseBody: string;

  constructor(message: string, response: Response, responseBody: string) {
    super(message);
    this.name = "ApiError";
    this.response = response;
    this.responseBody = responseBody;
  }
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("No API key was found.");
    this.name = "MissingApiKeyError";
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("The API key is invalid, expired, or revoked.");
    this.name = "UnauthorizedError";
  }
}

export class CloudflareAccessTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareAccessTokenError";
  }
}

class CloudflaredAccessTokenProvider implements CloudflareAccessTokenProvider {
  async load(appUrl: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("cloudflared", ["access", "token", `-app=${appUrl}`]);
      const token = stdout.trim();
      if (!token) {
        throw new CloudflareAccessTokenError("cloudflared returned an empty Access token.");
      }
      return token;
    } catch (error) {
      if (error instanceof CloudflareAccessTokenError) {
        throw error;
      }
      throw new CloudflareAccessTokenError(
        `Unable to get a Cloudflare Access token for ${appUrl}. Run "cloudflared access login ${appUrl}" first. ${formatExecError(error)}`,
      );
    }
  }
}

export class SeisanClient {
  readonly baseUrl: string;

  private readonly apiKeyOverride: string | undefined;
  private readonly apiKeyStore: ApiKeyStore;
  private readonly fetchFn: typeof fetch;
  private readonly cloudflareAccessTokenProvider: CloudflareAccessTokenProvider;
  private readonly cloudflareAccessRequired: boolean;

  constructor(options: SeisanClientOptions = {}) {
    const targetEnv = options.targetEnv ?? "local";
    this.baseUrl = normalizeBaseUrl(apiBaseUrlForEnv(targetEnv));
    this.apiKeyOverride = normalizeOptionalApiKey(options.apiKey);
    this.apiKeyStore = options.apiKeyStore ?? createDefaultApiKeyStore(this.baseUrl);
    this.fetchFn = options.fetchFn ?? fetch;
    this.cloudflareAccessTokenProvider =
      options.cloudflareAccessTokenProvider ?? new CloudflaredAccessTokenProvider();
    this.cloudflareAccessRequired = targetEnv === "dev";
  }

  ping(): Promise<string> {
    return this.requestText("GET", "/api/ping", { auth: false });
  }

  async whoami(): Promise<{ email: string }> {
    return this.requestJson<{ email: string }>("GET", "/api/whoami", { auth: true });
  }

  async logout(): Promise<void> {
    await this.apiKeyStore.clear();
  }

  async saveApiKey(apiKey: string): Promise<void> {
    const normalizedApiKey = apiKey.trim();
    if (!isValidApiKey(normalizedApiKey)) {
      throw new Error("API key has an invalid format.");
    }
    await this.apiKeyStore.save(normalizedApiKey);
  }

  async categoryList(): Promise<CategoryListResponse> {
    return this.requestJson<CategoryListResponse>("GET", "/api/categories", {
      auth: false,
    });
  }

  async adminCategoryList(): Promise<CategoryListResponse> {
    return this.requestJson<CategoryListResponse>("GET", "/api/admin/categories", {
      auth: false,
      cloudflareAccess: true,
    });
  }

  async categoryAdd(input: CategoryWriteInput): Promise<CategoryWriteResponse> {
    return this.requestJson<CategoryWriteResponse>("POST", "/api/admin/categories", {
      auth: false,
      cloudflareAccess: true,
      body: input,
      expectedStatus: 201,
    });
  }

  async categoryUpdate(id: string, input: CategoryWriteInput): Promise<CategoryWriteResponse> {
    return this.requestJson<CategoryWriteResponse>(
      "PUT",
      `/api/admin/categories/${encodeURIComponent(id)}`,
      {
        auth: false,
        cloudflareAccess: true,
        body: input,
      },
    );
  }

  async categoryFix(input: { dryRun: boolean }): Promise<CategoryFixResponse> {
    return this.requestJson<CategoryFixResponse>("POST", "/api/admin/categories/fix", {
      auth: false,
      cloudflareAccess: true,
      body: input,
    });
  }

  async categoryRemove(id: string): Promise<void> {
    await this.request("DELETE", `/api/admin/categories/${encodeURIComponent(id)}`, {
      auth: false,
      cloudflareAccess: true,
      expectedStatus: 204,
    });
  }

  private async requestJson<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const response = await this.request(method, path, options);
    return (await response.json()) as T;
  }

  private async requestText(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<string> {
    const response = await this.request(method, path, options);
    return response.text();
  }

  private async request(method: string, path: string, options: RequestOptions): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("Accept", options.accept ?? "application/json");

    let body: RequestInit["body"];
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    if (options.auth) {
      headers.set("Authorization", `Bearer ${await this.loadApiKey()}`);
    }

    const url = new URL(path, this.baseUrl);

    if (options.cloudflareAccess || this.cloudflareAccessRequired) {
      const accessToken = await this.loadCloudflareAccessToken(url);
      if (accessToken) {
        headers.set("cf-access-token", accessToken);
      }
    }

    const response = await this.fetchFn(url, {
      method,
      headers,
      body,
      redirect: "manual",
    });

    if (options.auth && response.status === 401) {
      if (!this.apiKeyOverride) {
        await this.apiKeyStore.clear();
      }
      throw new UnauthorizedError();
    }

    const expectedStatus = options.expectedStatus ?? 200;
    if (response.status !== expectedStatus) {
      throw new ApiError(
        `${method} ${path} failed with HTTP ${response.status}`,
        response,
        await response.text(),
      );
    }

    return response;
  }

  private async loadApiKey(): Promise<string> {
    const apiKey = this.apiKeyOverride ?? normalizeOptionalApiKey(await this.apiKeyStore.load());
    if (!apiKey) {
      throw new MissingApiKeyError();
    }
    if (!isValidApiKey(apiKey)) {
      if (!this.apiKeyOverride) {
        await this.apiKeyStore.clear();
      }
      throw new UnauthorizedError();
    }
    return apiKey;
  }

  private async loadCloudflareAccessToken(url: URL): Promise<string | null> {
    if (isLocalBaseUrl(this.baseUrl)) {
      return null;
    }
    return this.cloudflareAccessTokenProvider.load(url.toString());
  }
}

interface RequestOptions {
  auth: boolean;
  accept?: string;
  body?: unknown;
  cloudflareAccess?: boolean;
  expectedStatus?: number;
  headers?: RequestInit["headers"];
}

export function createDefaultApiKeyStore(baseUrl: string): ApiKeyStore {
  const account = normalizeBaseUrl(baseUrl);
  if (platform() === "darwin") {
    return new KeychainApiKeyStore(account, new FileApiKeyStore(account));
  }
  return new FileApiKeyStore(account);
}

export function apiBaseUrlForEnv(targetEnv: ApiTargetEnv): string {
  switch (targetEnv) {
    case "local":
      return DEFAULT_API_BASE_URL;
    case "dev":
      return DEV_API_BASE_URL;
    case "production":
      return PRODUCTION_API_BASE_URL;
  }
}

class KeychainApiKeyStore implements ApiKeyStore {
  private readonly service = "seisan-cli-api-key";
  private readonly account: string;
  private readonly fallback: ApiKeyStore;

  constructor(account: string, fallback: ApiKeyStore) {
    this.account = account;
    this.fallback = fallback;
  }

  async load(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        this.service,
        "-a",
        this.account,
        "-w",
      ]);
      return stdout.trim() || null;
    } catch {
      return this.fallback.load();
    }
  }

  async save(apiKey: string): Promise<void> {
    try {
      await this.deleteKeychainItem().catch(() => undefined);
      await execFileAsync("security", [
        "add-generic-password",
        "-s",
        this.service,
        "-a",
        this.account,
        "-w",
        apiKey,
        "-U",
      ]);
      await this.fallback.clear();
    } catch {
      await this.fallback.save(apiKey);
    }
  }

  async clear(): Promise<void> {
    await Promise.allSettled([this.deleteKeychainItem(), this.fallback.clear()]);
  }

  private async deleteKeychainItem(): Promise<void> {
    await execFileAsync("security", [
      "delete-generic-password",
      "-s",
      this.service,
      "-a",
      this.account,
    ]);
  }
}

class FileApiKeyStore implements ApiKeyStore {
  private readonly path: string;

  constructor(account: string) {
    this.path = apiKeyFilePath(account);
  }

  async load(): Promise<string | null> {
    try {
      return (await readFile(this.path, "utf8")).trim() || null;
    } catch {
      return null;
    }
  }

  async save(apiKey: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.path), 0o700);
    await writeFile(this.path, apiKey, { encoding: "utf8", mode: 0o600 });
    await chmod(this.path, 0o600);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export function isValidApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isLocalBaseUrl(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function formatExecError(error: unknown): string {
  const stderr = readStringProperty(error, "stderr")?.trim();
  if (stderr) {
    return stderr;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if (!value || typeof value !== "object" || !(property in value)) {
    return undefined;
  }
  const result = value[property as keyof typeof value];
  return typeof result === "string" ? result : undefined;
}

function normalizeOptionalApiKey(value: string | undefined | null): string | undefined {
  return value?.trim() || undefined;
}

function apiKeyFilePath(account: string): string {
  const accountHash = createHash("sha256").update(account).digest("hex").slice(0, 16);
  const configRoot =
    process.env.XDG_CONFIG_HOME ??
    (platform() === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : join(homedir(), ".config"));
  return join(configRoot, "seisan", `api-key-${accountHash}`);
}
