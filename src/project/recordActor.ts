import { transferSourceMemberId } from "../domain";
import type { ProjectRecord } from "../projectTypes";

export function recordActorMemberId(record: ProjectRecord): number {
  if (record.description.type === "transfer") {
    return transferSourceMemberId(record.description);
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
