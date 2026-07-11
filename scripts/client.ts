import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_API_BASE_URL = "http://localhost:5173";
export const DEV_API_BASE_URL = "https://dev.seisan.waga.me";
export const PRODUCTION_API_BASE_URL = "https://seisan.waga.me";
export const SESSION_COOKIE_NAME = "__Host-seisan_session";

export type ApiTargetEnv = "local" | "dev" | "production";

export interface SessionStore {
  load(): Promise<string | null>;
  save(sessionCookie: string): Promise<void>;
  clear(): Promise<void>;
}

export interface CloudflareAccessTokenProvider {
  load(appUrl: string): Promise<string>;
}

export interface SeisanClientOptions {
  targetEnv?: ApiTargetEnv;
  fetchFn?: typeof fetch;
  sessionStore?: SessionStore;
  cloudflareAccessTokenProvider?: CloudflareAccessTokenProvider;
}

export interface Category {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  documentText: string;
  vectorId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CategoryCandidate {
  category: Category;
  score: number;
}

export interface CategoryWriteInput {
  name: string;
  description?: string;
}

export interface CategoryWriteResponse {
  category: Category;
  vectorizeMutation: Record<string, unknown>;
}

export interface CategoryListResponse {
  categories: Category[];
}

export interface CategoryClassifyInput {
  name: string;
  topK?: number;
}

export interface CategoryClassifyResponse {
  category: Category;
  score: number;
  candidates: CategoryCandidate[];
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

export class MissingSessionError extends Error {
  constructor() {
    super("No saved session was found.");
    this.name = "MissingSessionError";
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("The saved session is missing, expired, or revoked.");
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

  private readonly fetchFn: typeof fetch;
  private readonly sessionStore: SessionStore;
  private readonly cloudflareAccessTokenProvider: CloudflareAccessTokenProvider;
  private readonly cloudflareAccessRequired: boolean;

  constructor(options: SeisanClientOptions = {}) {
    const targetEnv = options.targetEnv ?? "local";
    this.baseUrl = normalizeBaseUrl(apiBaseUrlForEnv(targetEnv));
    this.fetchFn = options.fetchFn ?? fetch;
    this.sessionStore = options.sessionStore ?? createDefaultSessionStore(this.baseUrl);
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
    try {
      await this.request("POST", "/api/logout", { auth: true, expectedStatus: 204 });
    } catch (error) {
      if (!(error instanceof MissingSessionError) && !(error instanceof UnauthorizedError)) {
        throw error;
      }
    } finally {
      await this.sessionStore.clear();
    }
  }

  async requestLoginCode(email: string): Promise<{ id?: string }> {
    return this.requestJson<{ id?: string }>("POST", "/api/login/attempt", {
      auth: false,
      body: { email },
      expectedStatus: 202,
    });
  }

  async verifyLoginCode(id: string, email: string, code: string): Promise<void> {
    const response = await this.request("POST", "/api/login/verify", {
      auth: false,
      body: { id, email, code },
      expectedStatus: 200,
    });
    const sessionCookie = extractSessionCookie(response.headers);
    if (!sessionCookie) {
      throw new Error("Login succeeded but the response did not include a session cookie.");
    }
    await this.sessionStore.save(sessionCookie);
  }

  async clearSession(): Promise<void> {
    await this.sessionStore.clear();
  }

  async categoryList(): Promise<CategoryListResponse> {
    return this.requestJson<CategoryListResponse>("GET", "/api/categories", {
      auth: true,
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

  async categoryRemove(id: string): Promise<void> {
    await this.request("DELETE", `/api/admin/categories/${encodeURIComponent(id)}`, {
      auth: false,
      cloudflareAccess: true,
      expectedStatus: 204,
    });
  }

  async classifyCategory(input: CategoryClassifyInput): Promise<CategoryClassifyResponse> {
    return this.requestJson<CategoryClassifyResponse>("POST", "/api/categories/classify", {
      auth: true,
      body: input,
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
      const sessionCookie = await this.sessionStore.load();
      if (!sessionCookie) {
        throw new MissingSessionError();
      }
      headers.set("Cookie", sessionCookie);
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
      await this.sessionStore.clear();
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

export function createDefaultSessionStore(baseUrl: string): SessionStore {
  const account = normalizeBaseUrl(baseUrl);
  if (platform() === "darwin") {
    return new KeychainSessionStore(account, new FileSessionStore(account));
  }
  return new FileSessionStore(account);
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

class KeychainSessionStore implements SessionStore {
  private readonly service = "seisan-cli-session";
  private readonly account: string;
  private readonly fallback: SessionStore;

  constructor(account: string, fallback: SessionStore) {
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

  async save(sessionCookie: string): Promise<void> {
    try {
      await this.deleteKeychainItem().catch(() => undefined);
      await execFileAsync("security", [
        "add-generic-password",
        "-s",
        this.service,
        "-a",
        this.account,
        "-w",
        sessionCookie,
        "-U",
      ]);
      await this.fallback.clear();
    } catch {
      await this.fallback.save(sessionCookie);
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

class FileSessionStore implements SessionStore {
  private readonly path: string;

  constructor(account: string) {
    this.path = sessionFilePath(account);
  }

  async load(): Promise<string | null> {
    try {
      return (await readFile(this.path, "utf8")).trim() || null;
    } catch {
      return null;
    }
  }

  async save(sessionCookie: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, sessionCookie, { encoding: "utf8", mode: 0o600 });
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

function extractSessionCookie(headers: Headers): string | null {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) {
    return null;
  }

  const sessionCookie = setCookie
    .split(/,(?=\s*[^;,]+=)/u)
    .find((cookie) => cookie.trimStart().startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!sessionCookie) {
    return null;
  }

  return sessionCookie.split(";", 1)[0].trim();
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

function sessionFilePath(account: string): string {
  const accountHash = createHash("sha256").update(account).digest("hex").slice(0, 16);
  const configRoot =
    process.env.XDG_CONFIG_HOME ??
    (platform() === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : join(homedir(), ".config"));
  return join(configRoot, "seisan", `session-${accountHash}`);
}
