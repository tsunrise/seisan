import { requestEmpty, requestJson } from "./client";
import type { ApiKeyMetadata, CreatedApiKey } from "./types";

export async function listApiKeys(): Promise<ApiKeyMetadata[]> {
  const response = await requestJson<{ keys: ApiKeyMetadata[] }>("/api/api-keys");
  return response.keys;
}

export async function createApiKey(input: {
  label: string;
  expiresAt: number;
}): Promise<CreatedApiKey> {
  return requestJson("/api/api-keys", {
    method: "POST",
    body: input,
    expectedStatus: 201,
  });
}

export async function revokeApiKey(id: string): Promise<void> {
  await requestEmpty(`/api/api-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    expectedStatus: 204,
  });
}
