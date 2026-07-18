import { describe, expect, it } from "vitest";

import { deriveDelta, recordDetailTitle, recordTitle } from "../src/domain";
import { recordActorMemberId } from "../src/project/recordActor";
import type { ProjectMember, ProjectRecord } from "../src/projectTypes";
import { formatRelativeTime } from "../src/relativeTime";

const transferMembers: ProjectMember[] = [
  { id: 1, name: "Alice", deleted: false },
  { id: 2, name: "Bob", deleted: false },
  { id: 3, name: "Carol", deleted: false },
];

function localTime(
  year: number,
  monthIndex: number,
  day: number,
  hour = 12,
  minute = 0,
  second = 0,
): number {
  return new Date(year, monthIndex, day, hour, minute, second).getTime();
}

describe("formatRelativeTime", () => {
  it("uses elapsed time within the same local calendar day", () => {
    const now = localTime(2026, 5, 30, 12, 0);

    expect(formatRelativeTime(localTime(2026, 5, 30, 11, 59, 57), now)).toBe("just now");
    expect(formatRelativeTime(localTime(2026, 5, 30, 11, 59, 30), now)).toBe("30 seconds ago");
    expect(formatRelativeTime(localTime(2026, 5, 30, 11, 30), now)).toBe("30 minutes ago");
    expect(formatRelativeTime(localTime(2026, 5, 30, 9, 0), now)).toBe("3 hours ago");
  });

  it("uses local calendar days instead of elapsed 24-hour periods", () => {
    const now = localTime(2026, 5, 30, 10, 0);

    expect(formatRelativeTime(localTime(2026, 5, 1, 23, 30), now)).toBe("29 days ago");
    expect(formatRelativeTime(localTime(2026, 5, 2, 0, 30), now)).toBe("28 days ago");
  });

  it("treats yesterday as a day ago even when less than 24 hours elapsed", () => {
    const now = localTime(2026, 6, 1, 0, 5);

    expect(formatRelativeTime(localTime(2026, 5, 30, 23, 55), now)).toBe("1 day ago");
  });

  it("uses calendar month and year units for older timestamps", () => {
    const now = localTime(2026, 6, 1, 12, 0);

    expect(formatRelativeTime(localTime(2026, 5, 2), now)).toBe("29 days ago");
    expect(formatRelativeTime(localTime(2026, 5, 1), now)).toBe("1 month ago");
    expect(formatRelativeTime(localTime(2026, 4, 1), now)).toBe("2 months ago");
    expect(formatRelativeTime(localTime(2025, 5, 30), now)).toBe("1 year ago");
  });
});

describe("multi-recipient transfer helpers", () => {
  it("derives the aggregate delta and selects the source as the actor", () => {
    const description = {
      type: "transfer" as const,
      src: 1,
      dests: [
        { id: 2, amount: 300 },
        { id: 3, amount: 200 },
      ],
    };
    const record: ProjectRecord = {
      id: 1,
      authorMemberId: 3,
      delta: { "1": -500, "2": 300, "3": 200 },
      description,
      createdAt: 0,
    };

    expect(deriveDelta(description)).toEqual({ "1": -500, "2": 300, "3": 200 });
    expect(recordActorMemberId(record)).toBe(1);
  });

  it("renders one or multiple destinations without legacy-only fields", () => {
    const multiRecord: ProjectRecord = {
      id: 1,
      authorMemberId: 1,
      delta: { "1": -500, "2": 300, "3": 200 },
      description: {
        type: "transfer",
        src: 1,
        dests: [
          { id: 2, amount: 300 },
          { id: 3, amount: 200 },
        ],
      },
      createdAt: 0,
    };
    const singleRecord: ProjectRecord = {
      ...multiRecord,
      delta: { "1": -300, "2": 300 },
      description: { type: "transfer", src: 1, dests: [{ id: 2, amount: 300 }] },
    };

    expect(recordTitle(multiRecord, transferMembers)).toBe("Transferred Bob and Carol $5.00");
    expect(recordDetailTitle(multiRecord, transferMembers)).toBe(
      "Alice transferred Bob $3.00 and Carol $2.00",
    );
    expect(recordTitle(singleRecord, transferMembers)).toBe("Transferred Bob $3.00");
    expect(recordDetailTitle(singleRecord, transferMembers)).toBe("Alice transferred Bob $3.00");
  });
});
