import type { MoneyByMemberId, ProjectMember, ProjectMemberFull } from "../api/types";
import { allocateRatio } from "./money";

export function memberName(members: ProjectMember[], memberId: number): string {
  return members.find((member) => member.id === memberId)?.name ?? `#${memberId}`;
}

export function findMember<T extends ProjectMember>(members: T[], memberId: number): T | undefined {
  return members.find((member) => member.id === memberId);
}

export function activeMembers<T extends ProjectMember>(members: T[]): T[] {
  return members.filter((member) => !member.deleted);
}

export function findLinkedMember(
  members: ProjectMemberFull[],
  email: string | null,
): ProjectMemberFull | null {
  if (!email) {
    return null;
  }
  return members.find((member) => member.linkedEmail === email && !member.deleted) ?? null;
}

export function memberBalance(balance: MoneyByMemberId, memberId: number): number {
  return balance[String(memberId)] ?? 0;
}

/** Number of people a member represents; missing or invalid sizes count as one person. */
export function memberSize(member: ProjectMemberFull): number {
  const size = member.config?.size;
  return size && Number.isSafeInteger(size) && size > 0 ? size : 1;
}

export function allocateEqualByMemberSize(
  total: number,
  members: ProjectMemberFull[],
  selectedMemberIds: number[],
): MoneyByMemberId {
  const selected = new Set(selectedMemberIds);
  return allocateRatio(
    total,
    members
      .filter((member) => selected.has(member.id))
      .map((member) => ({ memberId: member.id, ratio: memberSize(member) })),
  );
}
