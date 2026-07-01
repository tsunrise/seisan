import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "../src/relativeTime";

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
