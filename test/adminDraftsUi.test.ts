import { describe, expect, it } from "vitest";

import type { AdminLimitDefinition, Limits } from "../src/api/types";
import {
  blockedEmailDraftIsDirty,
  createBlockedEmailRuleDraft,
  MAX_BLOCKED_EMAIL_PATTERNS,
  parseBlockedEmailDraft,
} from "../src/admin/blockedEmailsDraft";
import {
  buildLimitsDocument,
  documentToLimitDraft,
  getLimitSource,
  getLimitValue,
  type AdminLimitsData,
} from "../src/admin/limitsDraft";

function rule(pattern: string, reason = "") {
  return { ...createBlockedEmailRuleDraft(), pattern, reason };
}

describe("blocked email draft", () => {
  it("drops empty rows, trims values, and omits blank reasons", () => {
    expect(
      parseBlockedEmailDraft([rule(" ^a@b\\.com$ ", "  "), rule(""), rule("x", " spam ")]),
    ).toEqual({
      ok: true,
      document: {
        version: 1,
        patterns: [{ pattern: "^a@b\\.com$" }, { pattern: "x", reason: "spam" }],
      },
    });
  });

  it("rejects reasons without patterns, invalid regexes, and multi-line reasons", () => {
    expect(parseBlockedEmailDraft([rule("", "why")])).toEqual({
      ok: false,
      error: "Rule 1 needs a regex pattern.",
    });
    expect(parseBlockedEmailDraft([rule("ok"), rule("(")])).toEqual({
      ok: false,
      error: "Rule 2 has an invalid regex pattern.",
    });
    expect(parseBlockedEmailDraft([rule("ok", "a\nb")])).toEqual({
      ok: false,
      error: "Rule 1 reason must be a single line.",
    });
  });

  it("enforces the rule limit", () => {
    const rules = Array.from({ length: MAX_BLOCKED_EMAIL_PATTERNS + 1 }, (_, index) =>
      rule(`p${index}`),
    );
    expect(parseBlockedEmailDraft(rules)).toEqual({
      ok: false,
      error: `Enter no more than ${MAX_BLOCKED_EMAIL_PATTERNS} patterns.`,
    });
  });

  it("compares drafts with the saved document by content", () => {
    const saved = {
      version: 1 as const,
      patterns: [{ pattern: "a", reason: "r" }, { pattern: "b" }],
    };
    expect(blockedEmailDraftIsDirty([rule("a", "r"), rule("b")], saved)).toBe(false);
    expect(blockedEmailDraftIsDirty([rule("a", "r")], saved)).toBe(true);
    expect(blockedEmailDraftIsDirty([rule("a", "r"), rule("b", "new")], saved)).toBe(true);
  });
});

describe("limits draft", () => {
  const schema: AdminLimitDefinition[] = [
    { name: "projects.maxOwnedProjects", type: "integer" },
    { name: "records.allow_post", type: "boolean" },
  ];
  const data: AdminLimitsData = {
    schema,
    builtIn: { "projects.maxOwnedProjects": 10, "records.allow_post": true } as Limits,
    global: { "projects.maxOwnedProjects": 20 },
    current: { "records.allow_post": false },
  };

  it("resolves user values from user overrides, then defaults, then built-in values", () => {
    const draft = documentToLimitDraft(schema, data.current);
    expect(draft).toEqual({ "records.allow_post": "false" });
    expect(getLimitSource("records.allow_post", "user", draft, data)).toBe("User");
    expect(getLimitSource("projects.maxOwnedProjects", "user", draft, data)).toBe("Default");
    expect(getLimitSource("projects.maxOwnedProjects", "default", draft, data)).toBe("Built In");
    expect(getLimitValue(schema[0], "user", draft, data)).toBe("20");
    expect(getLimitValue(schema[0], "default", draft, data)).toBe("10");
  });

  it("builds typed documents and rejects malformed values", () => {
    expect(
      buildLimitsDocument(schema, {
        "projects.maxOwnedProjects": " 5 ",
        "records.allow_post": "true",
      }),
    ).toEqual({
      ok: true,
      document: { "projects.maxOwnedProjects": 5, "records.allow_post": true },
    });
    expect(buildLimitsDocument(schema, { "projects.maxOwnedProjects": "1.5" })).toEqual({
      ok: false,
      error: "projects.maxOwnedProjects must be an integer.",
    });
    expect(buildLimitsDocument(schema, { "records.allow_post": "yes" })).toEqual({
      ok: false,
      error: "records.allow_post must be true or false.",
    });
  });
});
