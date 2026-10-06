import { describe, expect, it } from "vitest";

import {
  availablePayerMembers,
  expensePayerDrafts,
  parseExpensePayers,
} from "../src/project/composer/expenseForm";
import {
  deletedRecordMessage,
  recordEditMetadata,
  recordReferencesDeletedMember,
  writableRecordDescription,
} from "../src/project/records/recordEditing";
import { transferDraftFromDescription } from "../src/project/composer/transferForm";
import type { ProjectMember, ProjectRecord } from "../src/api/types";

const members: ProjectMember[] = [
  { id: 1, name: "Alice", deleted: false },
  { id: 2, name: "Bob", deleted: false },
  { id: 3, name: "Carol", deleted: true },
];

describe("record editing helpers", () => {
  it("keeps deleted and revert descriptions out of writable editing", () => {
    expect(writableRecordDescription(record({ type: "deleted" }))).toBeNull();
    expect(writableRecordDescription(record({ type: "revert", id: 1 }))).toBeNull();
    expect(
      writableRecordDescription(
        record({
          type: "promise",
          debtorMemberId: 1,
          creditorMemberId: 2,
          amount: 100,
        }),
      ),
    ).toMatchObject({ type: "promise" });
  });

  it("detects deleted members across description and delta references", () => {
    expect(
      recordReferencesDeletedMember(
        record({ type: "transfer", from: 1, to: 3, amount: 100 }),
        members,
      ),
    ).toBe(true);
    expect(
      recordReferencesDeletedMember(
        record({
          type: "expense",
          name: "Dinner",
          paid: { "1": 100 },
          liability: { "2": 100 },
        }),
        members,
      ),
    ).toBe(false);
    expect(
      recordReferencesDeletedMember({ ...record({ type: "deleted" }), delta: { "3": 1 } }, members),
    ).toBe(true);
  });

  it("formats edited and deleted audit copy", () => {
    expect(
      recordEditMetadata(
        {
          ...record({
            type: "promise",
            debtorMemberId: 1,
            creditorMemberId: 2,
            amount: 100,
          }),
          updatedAt: 60_000,
          updatedByMemberId: 2,
        },
        members,
        120_000,
      ),
    ).toBe("Edited 1 minute ago by Bob");
    expect(
      deletedRecordMessage(
        { ...record({ type: "deleted" }), updatedAt: 100, updatedByMemberId: 1 },
        members,
      ),
    ).toBe("Post Deleted by Author");
    expect(
      deletedRecordMessage(
        { ...record({ type: "deleted" }), updatedAt: 100, updatedByMemberId: 2 },
        members,
      ),
    ).toBe("Post Deleted by Bob");
    expect(deletedRecordMessage(record({ type: "deleted" }), members)).toBe("Post Deleted");
  });

  it("round-trips multi-payer expense drafts and excludes duplicate payer choices", () => {
    const drafts = expensePayerDrafts({ "1": 1_250, "2": 750 });
    expect(drafts).toEqual([
      { key: 0, memberId: 1, amount: "12.50" },
      { key: 1, memberId: 2, amount: "7.50" },
    ]);
    expect(parseExpensePayers(drafts)).toEqual({ "1": 1_250, "2": 750 });
    expect(availablePayerMembers(members, drafts, 0).map((member) => member.id)).toEqual([1]);
    expect(parseExpensePayers([...drafts, { key: 2, memberId: 2, amount: "1.00" }])).toBeNull();
  });

  it("normalizes legacy and multi-recipient transfers into editable drafts", () => {
    expect(
      transferDraftFromDescription({ type: "transfer", from: 1, to: 2, amount: 1_250 }),
    ).toEqual({
      sourceId: 1,
      destinations: [{ key: 0, memberId: 2, amount: "12.50" }],
    });
    expect(
      transferDraftFromDescription({
        type: "transfer",
        src: 2,
        dests: [
          { id: 1, amount: 500 },
          { id: 3, amount: 750 },
        ],
      }),
    ).toEqual({
      sourceId: 2,
      destinations: [
        { key: 0, memberId: 1, amount: "5.00" },
        { key: 1, memberId: 3, amount: "7.50" },
      ],
    });
  });
});

function record(description: ProjectRecord["description"]): ProjectRecord {
  return {
    id: 1,
    authorMemberId: 1,
    delta: {},
    description,
    createdAt: 0,
  };
}
