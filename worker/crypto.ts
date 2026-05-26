import { JWT_ISSUER, SESSION_TTL_SECONDS } from "./constants";

export interface SessionPayload {
  sub: string;
  email: string;
  jti: string;
  iat: number;
  exp: number;
  iss: typeof JWT_ISSUER;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function textToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

async function hmacSha256(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

export async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

export function generateLoginCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

export function hashLoginCode(email: string, code: string, secret: string): Promise<string> {
  return sha256Hex(`${email}:${code}:${secret}`);
}

export async function signSessionToken(
  email: string,
  secret: string,
  nowMs = Date.now(),
): Promise<{ token: string; payload: SessionPayload }> {
  const nowSeconds = Math.floor(nowMs / 1000);
  const payload: SessionPayload = {
    sub: email,
    email,
    jti: crypto.randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
    iss: JWT_ISSUER,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${textToBase64Url(JSON.stringify(header))}.${textToBase64Url(
    JSON.stringify(payload),
  )}`;
  const signature = bytesToBase64Url(await hmacSha256(signingInput, secret));
  return { token: `${signingInput}.${signature}`, payload };
}

export async function verifySessionToken(
  token: string,
  secret: string,
  options: { nowMs?: number; expirationGraceSeconds?: number; ignoreExpiration?: boolean } = {},
): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const expectedSignature = bytesToBase64Url(
    await hmacSha256(`${encodedHeader}.${encodedPayload}`, secret),
  );
  if (!(await timingSafeEqual(encodedSignature, expectedSignature))) {
    return null;
  }

  const headerBytes = base64UrlToBytes(encodedHeader);
  const payloadBytes = base64UrlToBytes(encodedPayload);
  if (!headerBytes || !payloadBytes) {
    return null;
  }

  let header: { alg?: string; typ?: string };
  let payload: Partial<SessionPayload>;
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes)) as { alg?: string; typ?: string };
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<SessionPayload>;
  } catch {
    return null;
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") {
    return null;
  }
  if (
    payload.iss !== JWT_ISSUER ||
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    payload.sub !== payload.email ||
    typeof payload.jti !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (!options.ignoreExpiration) {
    const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
    const grace = options.expirationGraceSeconds ?? 0;
    if (payload.exp + grace < nowSeconds) {
      return null;
    }
  }

  return payload as SessionPayload;
}
