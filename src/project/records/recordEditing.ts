import type { ProjectMember, ProjectRecord, WritableRecordDescription } from "../../api/types";
import {
  formatRelativeTime,
  memberName,
  transferDestinations,
  transferSourceMemberId,
} from "../../domain";

export function writableRecordDescription(record: ProjectRecord): WritableRecordDescription | null {
  return record.description.type === "revert" || record.description.type === "deleted"
    ? null
    : record.description;
}

export function recordReferencesDeletedMember(
  record: ProjectRecord,
  members: ProjectMember[],
): boolean {
  const deletedMemberIds = new Set(
    members.filter((member) => member.deleted).map((member) => member.id),
  );
  if (deletedMemberIds.size === 0) {
    return false;
  }

  const referencedMemberIds = new Set(Object.keys(record.delta).map(Number));
  const description = record.description;
  if (description.type === "expense") {
    for (const memberId of [
      ...Object.keys(description.paid),
      ...Object.keys(description.liability),
    ]) {
      referencedMemberIds.add(Number(memberId));
    }
  } else if (description.type === "transfer") {
    referencedMemberIds.add(transferSourceMemberId(description));
    for (const destination of transferDestinations(description)) {
      referencedMemberIds.add(destination.id);
    }
  } else if (description.type === "promise") {
    referencedMemberIds.add(description.debtorMemberId);
    referencedMemberIds.add(description.creditorMemberId);
  }

  return [...referencedMemberIds].some((memberId) => deletedMemberIds.has(memberId));
}

export function recordEditMetadata(
  record: ProjectRecord,
  members: ProjectMember[],
  now = Date.now(),
): string | null {
  if (
    record.description.type === "deleted" ||
    record.updatedAt === undefined ||
    record.updatedByMemberId === undefined
  ) {
    return null;
  }
  return `Edited ${formatRelativeTime(record.updatedAt, now)} by ${memberName(
    members,
    record.updatedByMemberId,
  )}`;
}

export function deletedRecordMessage(record: ProjectRecord, members: ProjectMember[]): string {
  if (record.description.type !== "deleted" || record.updatedByMemberId === undefined) {
    return "Post Deleted";
  }
  return record.updatedByMemberId === record.authorMemberId
    ? "Post Deleted by Author"
    : `Post Deleted by ${memberName(members, record.updatedByMemberId)}`;
}
