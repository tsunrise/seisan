import type * as api from "../../api";
import { pad2 } from "../../domain";

export type ExpiryChoice = "30" | "90" | "365" | "custom";
export type KeyStatus = "Active" | "Expired" | "Revoked";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function keyStatus(key: api.ApiKeyMetadata): KeyStatus {
  if (key.revokedAt !== null) return "Revoked";
  if (key.expiresAt <= Math.floor(Date.now() / 1000)) return "Expired";
  return "Active";
}

export function shortKeyId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function formatKeyDate(timestampSeconds: number): string {
  return dateFormatter.format(new Date(timestampSeconds * 1000));
}

/** Expiration in Unix seconds, or null when a custom date is missing or not in the future. */
export function expiryTimestamp(choice: ExpiryChoice, customDate: string): number | null {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (choice !== "custom") return nowSeconds + Number(choice) * 86_400;
  if (!customDate) return null;
  const timestamp = Math.floor(new Date(`${customDate}T23:59:59`).getTime() / 1000);
  return Number.isSafeInteger(timestamp) && timestamp > nowSeconds ? timestamp : null;
}

export function tomorrowDateInput(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return `${tomorrow.getFullYear()}-${pad2(tomorrow.getMonth() + 1)}-${pad2(tomorrow.getDate())}`;
}
