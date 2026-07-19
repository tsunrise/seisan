import { describe, expect, it } from "vitest";

import projectStoreSource from "../worker/do/ProjectStore.ts?raw";

function privateMethodSource(name: string): string {
  const start = projectStoreSource.indexOf(`\n  private ${name}(`);
  expect(start, `${name} should remain a private synchronous helper`).toBeGreaterThanOrEqual(0);

  const nextMethod = projectStoreSource.indexOf("\n  private ", start + 1);
  expect(nextMethod, `${name} should be followed by another private helper`).toBeGreaterThan(start);
  return projectStoreSource.slice(start, nextMethod);
}

describe("ProjectStore record mutation atomicity", () => {
  it("keeps record mutation storage tails synchronous", () => {
    const helpers = [
      "putRecordSync",
      "deleteRecordSync",
      "prepareWritableRecord",
      "referencesOnlyActiveMembers",
      "getProjectMetadata",
      "isAuthorized",
      "getMember",
      "getActiveLinkedMember",
      "hasActiveLinkedMember",
      "getActiveMemberIds",
      "getLiveRecordRow",
      "getDeletedMemberBalanceError",
      "canApplyBalanceDelta",
      "applyBalanceDelta",
      "getDescriptionLimitExceededError",
      "saveProjectMetadata",
    ];

    for (const helper of helpers) {
      const source = privateMethodSource(helper);
      expect(source, `${helper} must not become async`).not.toMatch(/private\s+async\s/u);
      expect(source, `${helper} must not introduce an await boundary`).not.toMatch(/\bawait\b/u);
    }
  });

  it("immediately consumes every SQL cursor used by the synchronous tails", () => {
    const sqlHelpers = [
      "putRecordSync",
      "deleteRecordSync",
      "getMember",
      "getActiveLinkedMember",
      "hasActiveLinkedMember",
      "getActiveMemberIds",
      "getLiveRecordRow",
      "getDeletedMemberBalanceError",
      "canApplyBalanceDelta",
      "applyBalanceDelta",
    ];

    for (const helper of sqlHelpers) {
      const source = privateMethodSource(helper);
      const cursorExpressions = source.match(/this\.ctx\.storage\.sql[\s\S]*?;/gu) ?? [];
      expect(
        cursorExpressions.length,
        `${helper} should include its expected SQL cursor`,
      ).toBeGreaterThan(0);
      for (const cursor of cursorExpressions) {
        expect(cursor, `${helper} must consume its SQL cursor`).toMatch(/\.(?:toArray|one)\(\)/u);
      }
    }
  });
});
