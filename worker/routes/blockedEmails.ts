import { Hono } from "hono";
import { z } from "zod";

import { type AppContext, type EnvWithIdentity, parseJson } from "../auth";
import { BlockedEmailsDocument } from "../blockedEmails";
import { normalizedEmailSchema } from "../email";
import { ErrorResponse } from "../error";
import { GLOBAL_CONFIG_STORE_NAME } from "../globalConfig";

const BlockedEmailTestBody = z.object({ email: normalizedEmailSchema }).strict();

export const adminBlockedEmailsApp = new Hono<EnvWithIdentity>();

adminBlockedEmailsApp.get("/", async (context) => {
  const result = await globalConfig(context).getBlockedEmails();
  if (!result.ok) {
    return ErrorResponse.internalServerError();
  }
  return context.json(result.document);
});

adminBlockedEmailsApp.put("/", async (context) => {
  const parsed = await parseJson(context, BlockedEmailsDocument);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const result = await globalConfig(context).setBlockedEmails(parsed.data);
  if (!result.ok) {
    return result.error === "invalid_input"
      ? ErrorResponse.invalidRequest()
      : ErrorResponse.internalServerError();
  }
  return new Response(null, { status: 204 });
});

adminBlockedEmailsApp.post("/test", async (context) => {
  const parsed = await parseJson(context, BlockedEmailTestBody);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const result = await globalConfig(context).testBlockedEmail(parsed.data.email);
  if (!result.ok) {
    return result.error === "invalid_input"
      ? ErrorResponse.invalidRequest()
      : ErrorResponse.internalServerError();
  }
  return context.json({
    email: result.email,
    blocked: result.blocked,
    matchedPattern: result.matchedPattern,
    ...(result.reason ? { reason: result.reason } : {}),
  });
});

function globalConfig(context: AppContext) {
  return context.env.GLOBAL_CONFIG.getByName(GLOBAL_CONFIG_STORE_NAME);
}
