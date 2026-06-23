import type * as api from "../api";

export function recordActorMemberId(record: api.ProjectRecord): number {
  if (record.description.type === "transfer") {
    return record.description.from;
  }
  if (record.description.type === "promise") {
    return record.description.debtorMemberId;
  }
  if (record.description.type === "expense") {
    const [payerId] = Object.keys(record.description.paid);
    return payerId === undefined ? record.authorMemberId : Number(payerId);
  }
  return record.authorMemberId;
}
