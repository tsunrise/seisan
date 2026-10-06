import type * as api from "../../api";
import { pad2 } from "../../domain";

export type TimelineDayGroup = {
  key: string;
  label: string;
  labelParts: TimelineDayLabelParts;
  records: api.ProjectRecord[];
};

export type TimelineDayLabelParts = {
  dateCode: string;
  year: string;
};

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

export function recordDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatRecordDayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function formatRecordDayLabelParts(timestamp: number): TimelineDayLabelParts {
  const date = new Date(timestamp);
  return {
    dateCode: `${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`,
    year: String(date.getFullYear()),
  };
}

export function groupRecordsByDay(records: api.ProjectRecord[]): TimelineDayGroup[] {
  const groups: TimelineDayGroup[] = [];
  for (const record of records) {
    const key = recordDayKey(record.createdAt);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.key === key) {
      lastGroup.records.push(record);
    } else {
      groups.push({
        key,
        label: formatRecordDayLabel(record.createdAt),
        labelParts: formatRecordDayLabelParts(record.createdAt),
        records: [record],
      });
    }
  }
  return groups;
}
