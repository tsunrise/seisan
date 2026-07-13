import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ApiKeyStore,
  isValidApiKey,
  MissingApiKeyError,
  SeisanClient,
  UnauthorizedError,
} from "./client.ts";

const STORED_API_KEY = "seisan_v1_aaaaaaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OVERRIDE_API_KEY = "seisan_v1_cccccccccccccccc_dddddddddddddddddddddddddddddddd";

class MemoryApiKeyStore implements ApiKeyStore {
  clearCalls = 0;
  loadCalls = 0;
  value: string | null;

  constructor(value: string | null = null) {
    this.value = value;
  }

  async load(): Promise<string | null> {
    this.loadCalls += 1;
    return this.value;
  }

  async save(apiKey: string): Promise<void> {
    this.value = apiKey;
  }

  async clear(): Promise<void> {
    this.clearCalls += 1;
    this.value = null;
  }
}

test("authenticated requests use a saved API key as a bearer credential", async () => {
  const store = new MemoryApiKeyStore(STORED_API_KEY);
  let authorization: string | null = null;
  const client = new SeisanClient({
    apiKeyStore: store,
    fetchFn: mockFetch((_input, init) => {
      authorization = new Headers(init?.headers).get("Authorization");
      return Response.json({ email: "cli@example.com" });
    }),
  });

  assert.deepEqual(await client.whoami(), { email: "cli@example.com" });
  assert.equal(authorization, `Bearer ${STORED_API_KEY}`);
});

test("an API key override takes precedence over the saved key", async () => {
  const store = new MemoryApiKeyStore(STORED_API_KEY);
  let authorization: string | null = null;
  const client = new SeisanClient({
    apiKey: OVERRIDE_API_KEY,
    apiKeyStore: store,
    fetchFn: mockFetch((_input, init) => {
      authorization = new Headers(init?.headers).get("Authorization");
      return Response.json({ email: "cli@example.com" });
    }),
  });

  await client.whoami();

  assert.equal(authorization, `Bearer ${OVERRIDE_API_KEY}`);
  assert.equal(store.loadCalls, 0);
});

test("a missing API key fails before making a request", async () => {
  let fetchCalls = 0;
  const client = new SeisanClient({
    apiKeyStore: new MemoryApiKeyStore(),
    fetchFn: mockFetch(() => {
      fetchCalls += 1;
      return Response.json({ email: "unexpected@example.com" });
    }),
  });

  await assert.rejects(client.whoami(), MissingApiKeyError);
  assert.equal(fetchCalls, 0);
});

test("a rejected saved key is cleared", async () => {
  const store = new MemoryApiKeyStore(STORED_API_KEY);
  const client = new SeisanClient({
    apiKeyStore: store,
    fetchFn: mockFetch(() => new Response(null, { status: 401 })),
  });

  await assert.rejects(client.whoami(), UnauthorizedError);
  assert.equal(store.value, null);
  assert.equal(store.clearCalls, 1);
});

test("a rejected override does not clear the saved key", async () => {
  const store = new MemoryApiKeyStore(STORED_API_KEY);
  const client = new SeisanClient({
    apiKey: OVERRIDE_API_KEY,
    apiKeyStore: store,
    fetchFn: mockFetch(() => new Response(null, { status: 401 })),
  });

  await assert.rejects(client.whoami(), UnauthorizedError);
  assert.equal(store.value, STORED_API_KEY);
  assert.equal(store.clearCalls, 0);
});

test("logout only clears the saved API key", async () => {
  const store = new MemoryApiKeyStore(STORED_API_KEY);
  let fetchCalls = 0;
  const client = new SeisanClient({
    apiKeyStore: store,
    fetchFn: mockFetch(() => {
      fetchCalls += 1;
      return new Response(null, { status: 204 });
    }),
  });

  await client.logout();

  assert.equal(store.value, null);
  assert.equal(fetchCalls, 0);
});

test("API key validation matches the public key format", () => {
  assert.equal(isValidApiKey(STORED_API_KEY), true);
  assert.equal(isValidApiKey("seisan_v1_invalid"), false);
});

function mockFetch(
  implementation: (input: URL | RequestInfo, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return implementation as typeof fetch;
}
