import { describe, expect, it } from "vitest";

import {
  allocateEqualByMemberSize,
  allocateRatio,
  deriveDelta,
  isMultiRecipientTransfer,
  memberSize,
  recordDetailTitle,
  recordTitle,
} from "../src/domain";
import { recordActorMemberId } from "../src/project/timeline/recordActor";
import type { ProjectMember, ProjectMemberFull, ProjectRecord } from "../src/api/types";
import { formatRelativeTime } from "../src/domain/time";

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

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  integer(min: number, max: number): number {
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return min + (this.state % (max - min + 1));
  }

  shuffle<T>(values: T[]): T[] {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const otherIndex = this.integer(0, index);
      [shuffled[index], shuffled[otherIndex]] = [shuffled[otherIndex], shuffled[index]];
    }
    return shuffled;
  }
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
    expect(isMultiRecipientTransfer(description)).toBe(true);
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

    expect(recordTitle(multiRecord, transferMembers)).toBe("Transferred $5.00 in total");
    expect(recordDetailTitle(multiRecord, transferMembers)).toBe(
      "Alice transferred Bob $3.00 and Carol $2.00",
    );
    expect(recordTitle(singleRecord, transferMembers)).toBe("Transferred Bob $3.00");
    expect(recordDetailTitle(singleRecord, transferMembers)).toBe("Alice transferred Bob $3.00");
    expect(
      isMultiRecipientTransfer({
        type: "transfer",
        src: 1,
        dests: [{ id: 2, amount: 300 }],
      }),
    ).toBe(false);
  });
});

describe("ratio allocation", () => {
  it("comprehensively apportions exact, weighted, decimal, and sub-cent splits", () => {
    const cases = [
      {
        total: 12,
        ratios: [
          { memberId: 1, ratio: 1 },
          { memberId: 2, ratio: 1 },
          { memberId: 3, ratio: 1 },
        ],
        expected: { "1": 4, "2": 4, "3": 4 },
      },
      {
        total: 11,
        ratios: [
          { memberId: 1, ratio: 1 },
          { memberId: 2, ratio: 2 },
          { memberId: 3, ratio: 3 },
        ],
        expected: { "1": 2, "2": 4, "3": 5 },
      },
      {
        total: 101,
        ratios: [
          { memberId: 1, ratio: 0.1 },
          { memberId: 2, ratio: 0.2 },
          { memberId: 3, ratio: 0.7 },
        ],
        expected: { "1": 10, "2": 20, "3": 71 },
      },
      {
        total: 2,
        ratios: [
          { memberId: 3, ratio: 1 },
          { memberId: 1, ratio: 1 },
          { memberId: 2, ratio: 1 },
        ],
        expected: { "1": 1, "2": 1 },
      },
    ];

    for (const { total, ratios, expected } of cases) {
      expect(allocateRatio(total, ratios)).toEqual(expected);
    }
  });

  it("regresses the production split without assigning every leftover cent to the last member", () => {
    const members: ProjectMemberFull[] = Array.from({ length: 9 }, (_, index) => ({
      id: index + 1,
      name: `Member ${index + 1}`,
      deleted: false,
      ...(index === 7 ? { config: { size: 3 } } : {}),
    }));

    expect(
      allocateEqualByMemberSize(
        779,
        members,
        members.map((member) => member.id),
      ),
    ).toEqual({
      "1": 71,
      "2": 71,
      "3": 71,
      "4": 71,
      "5": 71,
      "6": 71,
      "7": 71,
      "8": 212,
      "9": 70,
    });
  });

  it("preserves allocation invariants across 1,000 seeded randomized splits", () => {
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const random = new SeededRandom(seed);
      const memberCount = random.integer(1, 32);
      const total = random.integer(1, 1_000_000);
      const ratios = Array.from({ length: memberCount }, (_, index) => ({
        memberId: index * 3 + 1,
        ratio: random.integer(1, 10_000),
      }));
      const snapshot = structuredClone(ratios);
      const allocation = allocateRatio(total, ratios);
      const totalRatio = ratios.reduce((sum, ratio) => sum + ratio.ratio, 0);

      expect(Object.values(allocation).reduce((sum, amount) => sum + amount, 0)).toBe(total);
      expect(allocateRatio(total, random.shuffle(ratios))).toEqual(allocation);
      expect(
        allocateRatio(
          total,
          ratios.map((ratio) => ({ ...ratio, ratio: ratio.ratio * 7 })),
        ),
      ).toEqual(allocation);
      expect(ratios).toEqual(snapshot);

      for (const { memberId, ratio } of ratios) {
        const amount = allocation[String(memberId)] ?? 0;
        const idealAmount = (total * ratio) / totalRatio;
        expect(Number.isSafeInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThanOrEqual(Math.floor(idealAmount));
        expect(amount).toBeLessThanOrEqual(Math.ceil(idealAmount));
      }
    }
  });

  it("handles adversarial invalid, duplicate, and extreme inputs", () => {
    expect(
      allocateRatio(7, [
        { memberId: 1, ratio: 0 },
        { memberId: 2, ratio: -1 },
        { memberId: 3, ratio: Number.NaN },
        { memberId: 4, ratio: Number.POSITIVE_INFINITY },
        { memberId: 5, ratio: 2 },
        { memberId: 0, ratio: 1 },
        { memberId: 1.5, ratio: 1 },
        { memberId: Number.MAX_SAFE_INTEGER + 1, ratio: 1 },
      ]),
    ).toEqual({ "5": 7 });

    expect(
      allocateRatio(10, [
        { memberId: 1, ratio: 1 },
        { memberId: 2, ratio: 1 },
        { memberId: 1, ratio: 1 },
      ]),
    ).toEqual({ "1": 7, "2": 3 });

    expect(
      allocateRatio(Number.MAX_SAFE_INTEGER, [
        { memberId: 2, ratio: Number.MAX_VALUE },
        { memberId: 1, ratio: Number.MAX_VALUE },
      ]),
    ).toEqual({
      "1": 4_503_599_627_370_496,
      "2": 4_503_599_627_370_495,
    });
    expect(
      allocateRatio(Number.MAX_SAFE_INTEGER, [
        { memberId: 1, ratio: Number.MIN_VALUE },
        { memberId: 2, ratio: Number.MAX_VALUE },
      ]),
    ).toEqual({ "2": Number.MAX_SAFE_INTEGER });

    expect(allocateRatio(0, [{ memberId: 1, ratio: 1 }])).toEqual({});
    expect(allocateRatio(-1, [{ memberId: 1, ratio: 1 }])).toEqual({});
    expect(allocateRatio(1.5, [{ memberId: 1, ratio: 1 }])).toEqual({});
    expect(allocateRatio(Number.MAX_SAFE_INTEGER + 1, [{ memberId: 1, ratio: 1 }])).toEqual({});
  });
});

describe("member-size split defaults", () => {
  const members: ProjectMemberFull[] = [
    { id: 1, name: "Alice", deleted: false, config: {} },
    { id: 2, name: "Family", deleted: false, config: { size: 2 } },
    { id: 3, name: "Carol", deleted: false },
  ];

  it("weights equal splits by the people represented by selected members", () => {
    expect(allocateEqualByMemberSize(1000, members, [1, 2])).toEqual({
      "1": 333,
      "2": 667,
    });
    expect(allocateEqualByMemberSize(1000, members, [2])).toEqual({ "2": 1000 });
  });

  it("uses one as the ratio default when size metadata is absent", () => {
    expect(memberSize(members[0])).toBe(1);
    expect(memberSize(members[1])).toBe(2);
    expect(memberSize(members[2])).toBe(1);
  });
});
