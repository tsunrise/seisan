import type { ProjectMember } from "../../api/types";

export function prefixMatchingMembers(members: ProjectMember[], input: string): ProjectMember[] {
  const prefix = input.trim().toLocaleLowerCase();
  return prefix.length === 0
    ? members
    : members.filter((member) => member.name.toLocaleLowerCase().startsWith(prefix));
}
