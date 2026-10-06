import { ApiError } from "./errors";

interface RequestOptions {
  method?: string;
  body?: unknown;
  expectedStatus?: number;
  signal?: AbortSignal;
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options);
  return (await response.json()) as T;
}

export async function requestEmpty(path: string, options: RequestOptions = {}): Promise<void> {
  await request(path, options);
}

export function pageParams(input: { limit?: number; offset?: number }): URLSearchParams {
  const params = new URLSearchParams();
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  if (input.offset !== undefined) {
    params.set("offset", String(input.offset));
  }
  return params;
}

export function withQuery(path: string, params: URLSearchParams): string {
  return params.size > 0 ? `${path}?${params.toString()}` : path;
}

async function request(path: string, options: RequestOptions): Promise<Response> {
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
  } as RequestInit & { credentials: "same-origin" });
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    throw new ApiError(response.status, await response.text());
  }
  return response;
}
