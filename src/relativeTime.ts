export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const current = new Date(now);
  const elapsedCalendarDays = calendarDayDifference(date, current);
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (elapsedCalendarDays > 0) {
    if (elapsedCalendarDays < 30) {
      return formatElapsedUnit(elapsedCalendarDays, "day");
    }

    const elapsedCalendarMonths = calendarMonthDifference(date, current);
    if (elapsedCalendarMonths < 1) {
      return formatElapsedUnit(elapsedCalendarDays, "day");
    }
    if (elapsedCalendarMonths < 12) {
      return formatElapsedUnit(elapsedCalendarMonths, "month");
    }

    const elapsedCalendarYears = Math.floor(elapsedCalendarMonths / 12);
    return formatElapsedUnit(elapsedCalendarYears, "year");
  }

  if (elapsedSeconds < 5) {
    return "just now";
  }
  if (elapsedSeconds < 60) {
    return formatElapsedUnit(elapsedSeconds, "second");
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return formatElapsedUnit(elapsedMinutes, "minute");
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return formatElapsedUnit(elapsedHours, "hour");
}

function formatElapsedUnit(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

function calendarDayDifference(earlier: Date, later: Date): number {
  return calendarDayOrdinal(later) - calendarDayOrdinal(earlier);
}

function calendarDayOrdinal(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function calendarMonthDifference(earlier: Date, later: Date): number {
  let months =
    (later.getFullYear() - earlier.getFullYear()) * 12 + later.getMonth() - earlier.getMonth();
  if (later.getDate() < earlier.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}
