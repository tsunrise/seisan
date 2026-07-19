import type { ProjectMember } from "../projectTypes";

export function prefixMatchingMembers(members: ProjectMember[], input: string): ProjectMember[] {
  const prefix = input.trim().toLocaleLowerCase();
  return prefix.length === 0
    ? members
    : members.filter((member) => member.name.toLocaleLowerCase().startsWith(prefix));
}
