export const ErrorResponse = {
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  invalidRequest: () => Response.json({ error: "invalid_request" }, { status: 400 }),
  notFound: () => Response.json({ error: "not_found" }, { status: 404 }),
  forbidden: () => Response.json({ error: "forbidden" }, { status: 403 }),
  emailNotSupported: (reason?: string) =>
    Response.json({ error: "email_not_supported", ...(reason ? { reason } : {}) }, { status: 403 }),
  postingBlocked: () => Response.json({ error: "posting_blocked" }, { status: 403 }),
  conflict: (error = "conflict") => Response.json({ error }, { status: 409 }),
  rateLimited: (reason: "account" | "project" | "ip") =>
    Response.json({ error: "rate_limited", reason }, { status: 429 }),
  internalServerError: () => Response.json({ error: "internal_server_error" }, { status: 500 }),
  serviceUnavailable: () => Response.json({ error: "internal_server_error" }, { status: 503 }),
};
