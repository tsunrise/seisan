import { requestEmpty, requestJson } from "./client";

export async function whoami(): Promise<{ email: string; sessionExpiresAt?: number }> {
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
