import { describe, expect, it } from "vitest";

import { getProjectMemberManagementPermissions } from "../src/project/settings/memberManagementPermissions";
import type { ProjectMemberFull } from "../src/api/types";

const owner: ProjectMemberFull = {
  id: 1,
  name: "Alice",
  deleted: false,
  linkedEmail: "owner@example.com",
};
const currentMember: ProjectMemberFull = {
  id: 2,
  name: "Bob",
  deleted: false,
  linkedEmail: "bob@example.com",
};
const otherLinkedMember: ProjectMemberFull = {
  id: 3,
  name: "Carol",
  deleted: false,
  linkedEmail: "carol@example.com",
};
const unlinkedMember: ProjectMemberFull = {
  id: 4,
  name: "David",
  deleted: false,
};

describe("project member management permissions", () => {
  it("lets the owner manage all active members without requiring a linked profile", () => {
    const permissions = getProjectMemberManagementPermissions({
      ownerEmail: "owner@example.com",
      currentEmail: "owner@example.com",
      currentMember: null,
    });

    expect(permissions.canManage).toBe(true);
    expect(permissions.canAdd).toBe(true);
    expect(permissions.canEdit(owner)).toBe(true);
    expect(permissions.canEdit(otherLinkedMember)).toBe(true);
    expect(permissions.canEdit(unlinkedMember)).toBe(true);
    expect(permissions.canUnlink(owner)).toBe(false);
    expect(permissions.canUnlink(otherLinkedMember)).toBe(true);
    expect(permissions.canDelete(owner, 0)).toBe(false);
    expect(permissions.canDelete(otherLinkedMember, 0)).toBe(true);
    expect(permissions.canDelete(unlinkedMember, 1)).toBe(false);
  });

  it("lets an active linked member edit self and unlinked members only", () => {
    const permissions = getProjectMemberManagementPermissions({
      ownerEmail: "owner@example.com",
      currentEmail: "bob@example.com",
      currentMember,
    });

    expect(permissions.canManage).toBe(true);
    expect(permissions.canAdd).toBe(true);
    expect(permissions.canEdit(currentMember)).toBe(true);
    expect(permissions.canEdit(unlinkedMember)).toBe(true);
    expect(permissions.canEdit(owner)).toBe(false);
    expect(permissions.canEdit(otherLinkedMember)).toBe(false);
    expect(permissions.canUnlink(otherLinkedMember)).toBe(false);
    expect(permissions.canDelete(unlinkedMember, 0)).toBe(false);
  });

  it("keeps viewers, former members, and deleted members read-only", () => {
    for (const actor of [
      { currentEmail: "viewer@example.com", currentMember: null },
      { currentEmail: "bob@example.com", currentMember: null },
      {
        currentEmail: "bob@example.com",
        currentMember: { ...currentMember, deleted: true },
      },
    ]) {
      const permissions = getProjectMemberManagementPermissions({
        ownerEmail: "owner@example.com",
        ...actor,
      });

      expect(permissions.canManage).toBe(false);
      expect(permissions.canAdd).toBe(false);
      expect(permissions.canEdit(unlinkedMember)).toBe(false);
    }
  });
});
