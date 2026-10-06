import type * as api from "../api";

export const ADMIN_PAGE_LIMIT = 25;

export const projectSortOptions: Array<{ value: api.AdminProjectSort; label: string }> = [
  { value: "records_desc", label: "Most records" },
  { value: "updated_desc", label: "Most recently updated" },
  { value: "updated_asc", label: "Least recently updated" },
];

export function parseOffset(value: string | null): number {
  if (!value || !/^\d+$/u.test(value)) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseProjectSort(value: string | null): api.AdminProjectSort {
  if (value === "updated_desc" || value === "updated_asc") {
    return value;
  }
  return "records_desc";
}

/** Sets a pagination offset, omitting the default first page from the URL. */
export function setOffsetParam(params: URLSearchParams, offset: number): void {
  if (offset > 0) {
    params.set("offset", String(offset));
  } else {
    params.delete("offset");
  }
}
