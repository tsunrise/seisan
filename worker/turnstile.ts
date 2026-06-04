import type { AppContext } from "./auth";

const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileSiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

export async function verifyTurnstileToken(
  context: AppContext,
  token: string | undefined,
): Promise<boolean> {
  if (!token) {
    return false;
  }

  const body: {
    secret: string;
    response: string;
    remoteip?: string;
    idempotency_key: string;
  } = {
    secret: context.env.TURNSTILE_SECRET_KEY,
    response: token,
    idempotency_key: crypto.randomUUID(),
  };

  const remoteIp = context.req.header("CF-Connecting-IP");
  if (remoteIp) {
    body.remoteip = remoteIp;
  }

  try {
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return false;
    }

    const result = (await response.json()) as TurnstileSiteverifyResponse;
    return result.success === true;
  } catch (error) {
    console.error("failed to verify turnstile token", error);
    return false;
  }
}
