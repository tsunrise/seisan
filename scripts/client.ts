import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_API_BASE_URL = "https://dev.seisan.waga.me";
export const SESSION_COOKIE_NAME = "__Host-seisan_session";

export interface SessionStore {
  load(): Promise<string | null>;
  save(sessionCookie: string): Promise<void>;
  clear(): Promise<void>;
}

export interface SeisanClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  sessionStore?: SessionStore;
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

export class SeisanClient {
  readonly baseUrl: string;

  private readonly fetchFn: typeof fetch;
  private readonly sessionStore: SessionStore;

  constructor(options: SeisanClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_API_BASE_URL);
    this.fetchFn = options.fetchFn ?? fetch;
    this.sessionStore = options.sessionStore ?? createDefaultSessionStore(this.baseUrl);
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

  async requestLoginCode(email: string): Promise<void> {
    await this.requestJson("POST", "/api/login/attempt", {
      auth: false,
      body: { email },
      expectedStatus: 202,
    });
  }

  async verifyLoginCode(email: string, code: string): Promise<void> {
    const response = await this.request("POST", "/api/login/verify", {
      auth: false,
      body: { email, code },
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

    const response = await this.fetchFn(new URL(path, this.baseUrl), {
      method,
      headers,
      body,
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
}

interface RequestOptions {
  auth: boolean;
  accept?: string;
  body?: unknown;
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

function sessionFilePath(account: string): string {
  const accountHash = createHash("sha256").update(account).digest("hex").slice(0, 16);
  const configRoot =
    process.env.XDG_CONFIG_HOME ??
    (platform() === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : join(homedir(), ".config"));
  return join(configRoot, "seisan", `session-${accountHash}`);
}
