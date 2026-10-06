import type { ProjectMemberFull } from "../../api/types";

export function getProjectMemberManagementPermissions({
  ownerEmail,
  currentEmail,
  currentMember,
}: {
  ownerEmail: string;
  currentEmail: string | null;
  currentMember: ProjectMemberFull | null;
}) {
  const isOwner = currentEmail === ownerEmail;
  const isActiveLinkedMember =
    currentEmail !== null &&
    currentMember !== null &&
    !currentMember.deleted &&
    currentMember.linkedEmail === currentEmail;
  const canManage = isOwner || isActiveLinkedMember;

  return {
    isOwner,
    canManage,
    canAdd: canManage,
    canEdit(member: ProjectMemberFull): boolean {
      return (
        !member.deleted &&
        (isOwner ||
          (isActiveLinkedMember &&
            (member.id === currentMember?.id || member.linkedEmail === undefined)))
      );
    },
    canUnlink(member: ProjectMemberFull): boolean {
      return isOwner && member.linkedEmail !== undefined && member.linkedEmail !== ownerEmail;
    },
    canDelete(member: ProjectMemberFull, balance: number): boolean {
      return isOwner && member.linkedEmail !== ownerEmail && balance === 0;
    },
  };
}
