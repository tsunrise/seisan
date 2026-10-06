interface ParsedApiErrorBody {
  code: string;
  reason: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly reason: string | null;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    const parsed = parseApiErrorBody(responseBody);
    super(parsed?.code ?? (responseBody || `Request failed with status ${status}`));
    this.name = "ApiError";
    this.status = status;
    this.code = parsed?.code ?? null;
    this.reason = parsed?.reason ?? null;
    this.responseBody = responseBody;
  }
}

function parseApiErrorBody(responseBody: string): ParsedApiErrorBody | null {
  if (!responseBody) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return null;
  }

  if (!isObjectRecord(parsed) || typeof parsed.error !== "string" || parsed.error.length === 0) {
    return null;
  }

  return {
    code: parsed.error,
    reason: typeof parsed.reason === "string" && parsed.reason.length > 0 ? parsed.reason : null,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
