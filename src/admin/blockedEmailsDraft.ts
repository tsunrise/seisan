import type * as api from "../api";

export const MAX_BLOCKED_EMAIL_PATTERNS = 100;
export const MAX_BLOCKED_EMAIL_PATTERN_LENGTH = 512;
export const MAX_BLOCKED_EMAIL_REASON_LENGTH = 256;

export interface BlockedEmailRuleDraft {
  id: string;
  pattern: string;
  reason: string;
}

export function createBlockedEmailRuleDraft(rule?: api.BlockedEmailRule): BlockedEmailRuleDraft {
  return {
    id: crypto.randomUUID(),
    pattern: rule?.pattern ?? "",
    reason: rule?.reason ?? "",
  };
}

export function documentToBlockedEmailDraft(
  document: api.BlockedEmailsDocument,
): BlockedEmailRuleDraft[] {
  return document.patterns.map((rule) => createBlockedEmailRuleDraft(rule));
}

/** True when the editable rows differ from the saved document, ignoring row identity. */
export function blockedEmailDraftIsDirty(
  draft: BlockedEmailRuleDraft[],
  saved: api.BlockedEmailsDocument,
): boolean {
  return (
    JSON.stringify(draft.map(({ pattern, reason }) => ({ pattern, reason }))) !==
    JSON.stringify(
      saved.patterns.map((rule) => ({
        pattern: rule.pattern,
        reason: rule.reason ?? "",
      })),
    )
  );
}

/**
 * Validates the editable rows into a saveable document. Completely empty rows are dropped, a
 * reason requires a pattern, and whitespace-only reasons are omitted.
 */
export function parseBlockedEmailDraft(
  draft: BlockedEmailRuleDraft[],
): { ok: true; document: api.BlockedEmailsDocument } | { ok: false; error: string } {
  const patterns: api.BlockedEmailRule[] = [];
  for (const [index, rule] of draft.entries()) {
    const pattern = rule.pattern.trim();
    const reason = rule.reason.trim();
    if (!pattern && !reason) {
      continue;
    }
    if (!pattern) {
      return { ok: false, error: `Rule ${index + 1} needs a regex pattern.` };
    }
    if (pattern.length > MAX_BLOCKED_EMAIL_PATTERN_LENGTH) {
      return {
        ok: false,
        error: `Rule ${index + 1} pattern exceeds ${MAX_BLOCKED_EMAIL_PATTERN_LENGTH} characters.`,
      };
    }
    try {
      new RegExp(pattern, "iu");
    } catch {
      return { ok: false, error: `Rule ${index + 1} has an invalid regex pattern.` };
    }
    if (/[\r\n]/u.test(reason)) {
      return { ok: false, error: `Rule ${index + 1} reason must be a single line.` };
    }
    if (reason.length > MAX_BLOCKED_EMAIL_REASON_LENGTH) {
      return {
        ok: false,
        error: `Rule ${index + 1} reason exceeds ${MAX_BLOCKED_EMAIL_REASON_LENGTH} characters.`,
      };
    }
    patterns.push({ pattern, ...(reason ? { reason } : {}) });
  }

  if (patterns.length > MAX_BLOCKED_EMAIL_PATTERNS) {
    return {
      ok: false,
      error: `Enter no more than ${MAX_BLOCKED_EMAIL_PATTERNS} patterns.`,
    };
  }
  return { ok: true, document: { version: 1, patterns } };
}
