import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import {
  BLOCKED_EMAILS_CONFIG_KEY,
  BlockedEmailsDocument,
  BlockedEmailsDocumentCodec,
  MAX_BLOCKED_EMAIL_PATTERNS,
  MAX_BLOCKED_EMAIL_PATTERN_LENGTH,
  MAX_BLOCKED_EMAIL_REASON_LENGTH,
  testBlockedEmail,
} from "../worker/blockedEmails";
import { cleanupWorkerTestState, makeEnv } from "./workerTestHelpers";

describe("blocked email configuration", () => {
  afterEach(cleanupWorkerTestState);

  it("validates and normalizes versioned regex documents", () => {
    expect(
      BlockedEmailsDocument.parse({
        version: 1,
        patterns: [
          {
            pattern: "  @example\\.com$  ",
            reason: "  Please use your organization email.  ",
          },
          { pattern: "^specific@example\\.com$", reason: "   " },
        ],
      }),
    ).toEqual({
      version: 1,
      patterns: [
        {
          pattern: "@example\\.com$",
          reason: "Please use your organization email.",
        },
        { pattern: "^specific@example\\.com$" },
      ],
    });

    expect(BlockedEmailsDocument.safeParse({ version: 2, patterns: [] }).success).toBe(false);
    expect(
      BlockedEmailsDocument.safeParse({ version: 1, patterns: ["@example\\.com$"] }).success,
    ).toBe(false);
    expect(
      BlockedEmailsDocument.safeParse({ version: 1, patterns: [{ pattern: "[" }] }).success,
    ).toBe(false);
    expect(
      BlockedEmailsDocument.safeParse({
        version: 1,
        patterns: [{ pattern: "example", unexpected: true }],
      }).success,
    ).toBe(false);
    expect(
      BlockedEmailsDocument.safeParse({
        version: 1,
        patterns: [{ pattern: "first\nsecond" }],
      }).success,
    ).toBe(false);
    expect(
      BlockedEmailsDocument.safeParse({
        version: 1,
        patterns: [{ pattern: "a".repeat(MAX_BLOCKED_EMAIL_PATTERN_LENGTH + 1) }],
      }).success,
    ).toBe(false);
    expect(
      BlockedEmailsDocument.safeParse({
        version: 1,
        patterns: [{ pattern: "example", reason: "first\nsecond" }],
      }).success,
    ).toBe(false);
    expect(
      BlockedEmailsDocument.safeParse({
        version: 1,
        patterns: [{ pattern: "example", reason: "a".repeat(MAX_BLOCKED_EMAIL_REASON_LENGTH + 1) }],
      }).success,
    ).toBe(false);
    expect(
      BlockedEmailsDocument.safeParse({
        version: 1,
        patterns: Array.from({ length: MAX_BLOCKED_EMAIL_PATTERNS + 1 }, (_, index) => ({
          pattern: String(index),
        })),
      }).success,
    ).toBe(false);
  });

  it("matches normalized emails in pattern order with fixed case-insensitive Unicode flags", () => {
    const document = BlockedEmailsDocument.parse({
      version: 1,
      patterns: [
        { pattern: "EXAMPLE", reason: "First matching rule." },
        { pattern: "^specific@example\\.com$", reason: "Later matching rule." },
      ],
    });

    expect(testBlockedEmail(document, " Specific@Example.com ")).toEqual({
      email: "specific@example.com",
      blocked: true,
      matchedPattern: "EXAMPLE",
      reason: "First matching rule.",
    });
    expect(testBlockedEmail(document, "person@elsewhere.test")).toEqual({
      email: "person@elsewhere.test",
      blocked: false,
      matchedPattern: null,
    });

    const anchored = BlockedEmailsDocument.parse({
      version: 1,
      patterns: [{ pattern: "^specific@example\\.com$" }],
    });
    expect(testBlockedEmail(anchored, "specific@example.com")).toEqual({
      email: "specific@example.com",
      blocked: true,
      matchedPattern: "^specific@example\\.com$",
    });
    expect(testBlockedEmail(anchored, "prefix-specific@example.com").blocked).toBe(false);
  });

  it("stores blocked email documents in GlobalConfig and publishes them to KV", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.GLOBAL_CONFIG.getByName(`global-config-${crypto.randomUUID()}`);

    await expect(stub.getBlockedEmails()).resolves.toEqual({
      ok: true,
      document: { version: 1, patterns: [] },
    });

    const document = BlockedEmailsDocument.parse({
      version: 1,
      patterns: [{ pattern: "@example\\.com$", reason: "Use a supported domain." }],
    });
    await expect(stub.setBlockedEmails(document)).resolves.toEqual({ ok: true, document });
    await expect(stub.testBlockedEmail("USER@EXAMPLE.COM")).resolves.toEqual({
      ok: true,
      email: "user@example.com",
      blocked: true,
      matchedPattern: "@example\\.com$",
      reason: "Use a supported domain.",
    });

    await expect(waitForPublishedBlockedEmails(testEnv)).resolves.toEqual(document);
  });

  it("reports malformed stored blocked email documents", async () => {
    const { env: testEnv } = makeEnv();
    const stub = testEnv.GLOBAL_CONFIG.getByName(`global-config-${crypto.randomUUID()}`);

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO global_config (key, value)
         VALUES (?, ?)`,
        BLOCKED_EMAILS_CONFIG_KEY,
        "{",
      );
    });

    await expect(stub.getBlockedEmails()).resolves.toEqual({
      ok: false,
      error: "invalid_value",
    });
    await expect(stub.testBlockedEmail("user@example.com")).resolves.toEqual({
      ok: false,
      error: "invalid_value",
    });
  });

  it("uses the same codec for stored and published values", () => {
    const document = BlockedEmailsDocument.parse({
      version: 1,
      patterns: [{ pattern: " @example\\.com$ ", reason: "  Use another address.  " }],
    });
    const serialized = BlockedEmailsDocumentCodec.serialize(document);
    expect(BlockedEmailsDocumentCodec.parseStored(serialized)).toEqual(document);
    expect(BlockedEmailsDocumentCodec.parseStored("{")).toBeNull();
    expect(
      BlockedEmailsDocumentCodec.parseStored(
        JSON.stringify({ version: 1, patterns: ["@example\\.com$"] }),
      ),
    ).toBeNull();
  });
});

async function waitForPublishedBlockedEmails(testEnv: Env): Promise<unknown> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const raw = await testEnv.PUBLISHED_GLOBAL_CONFIG.get(BLOCKED_EMAILS_CONFIG_KEY);
    if (raw !== null) {
      return JSON.parse(raw);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}
