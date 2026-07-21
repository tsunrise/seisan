import { z } from "zod";

import { normalizeEmail } from "./email";

export const BLOCKED_EMAILS_CONFIG_KEY = "blocked_emails";
export const MAX_BLOCKED_EMAIL_PATTERNS = 100;
export const MAX_BLOCKED_EMAIL_PATTERN_LENGTH = 512;
export const MAX_BLOCKED_EMAIL_REASON_LENGTH = 256;
export const BLOCKED_EMAIL_REGEX_FLAGS = "iu";

const BlockedEmailPattern = z
  .string()
  .refine((pattern) => !/[\r\n]/u.test(pattern), {
    message: "Blocked email patterns must not contain line breaks.",
  })
  .transform((pattern) => pattern.trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(MAX_BLOCKED_EMAIL_PATTERN_LENGTH)
      .refine(isValidBlockedEmailPattern, { message: "Invalid blocked email regex pattern." }),
  );

const BlockedEmailReason = z
  .string()
  .refine((reason) => !/[\r\n]/u.test(reason), {
    message: "Blocked email reasons must not contain line breaks.",
  })
  .transform((reason) => reason.trim())
  .pipe(z.string().max(MAX_BLOCKED_EMAIL_REASON_LENGTH));

export const BlockedEmailRule = z
  .object({
    pattern: BlockedEmailPattern,
    reason: BlockedEmailReason.optional(),
  })
  .strict()
  .transform(({ pattern, reason }) => ({
    pattern,
    ...(reason ? { reason } : {}),
  }));
export type BlockedEmailRule = z.infer<typeof BlockedEmailRule>;

export const BlockedEmailsDocument = z
  .object({
    version: z.literal(1),
    patterns: z.array(BlockedEmailRule).max(MAX_BLOCKED_EMAIL_PATTERNS),
  })
  .strict();
export type BlockedEmailsDocument = z.infer<typeof BlockedEmailsDocument>;

export interface BlockedEmailTestResult {
  email: string;
  blocked: boolean;
  matchedPattern: string | null;
  reason?: string;
}

export class BlockedEmailsDocumentCodec {
  static parseStored(value: string): BlockedEmailsDocument | null {
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      return null;
    }

    const parsed = BlockedEmailsDocument.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  }

  static serialize(document: BlockedEmailsDocument): string {
    return JSON.stringify(BlockedEmailsDocument.parse(document));
  }
}

export function createEmptyBlockedEmailsDocument(): BlockedEmailsDocument {
  return { version: 1, patterns: [] };
}

export function testBlockedEmail(
  document: BlockedEmailsDocument,
  email: string,
): BlockedEmailTestResult {
  const normalizedEmail = normalizeEmail(email);
  const matchedRule =
    document.patterns.find((rule) =>
      compileBlockedEmailPattern(rule.pattern).test(normalizedEmail),
    ) ?? null;
  if (!matchedRule) {
    return {
      email: normalizedEmail,
      blocked: false,
      matchedPattern: null,
    };
  }

  return {
    email: normalizedEmail,
    blocked: true,
    matchedPattern: matchedRule.pattern,
    ...(matchedRule.reason ? { reason: matchedRule.reason } : {}),
  };
}

function isValidBlockedEmailPattern(pattern: string): boolean {
  try {
    compileBlockedEmailPattern(pattern);
    return true;
  } catch {
    return false;
  }
}

function compileBlockedEmailPattern(pattern: string): RegExp {
  return new RegExp(pattern, BLOCKED_EMAIL_REGEX_FLAGS);
}
