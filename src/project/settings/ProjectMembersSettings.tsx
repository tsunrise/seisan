import { Button, Stack, Typography } from "@mui/material";
import { useState } from "react";

import * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PanelFrame } from "../../components/PanelFrame";
import { activeMembers, memberBalance } from "../../domain";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import { projectPaths } from "../paths";
import { AddMemberForm } from "./AddMemberForm";
import { EditMemberDialog } from "./EditMemberDialog";
import { getProjectMemberManagementPermissions } from "./memberManagementPermissions";
import { MemberSettingsRow } from "./MemberSettingsRow";
import { useMemberEditor, useNewMemberForm } from "./useMemberSettings";

/**
 * The single administrative surface for members. Owners and active linked members can enter
 * manage mode to add placeholders and edit eligible members; only owners unlink or delete.
 */
export function ProjectMembersSettings({
  project,
  currentEmail,
  currentMember,
  onReload,
}: {
  project: api.Project;
  currentEmail: string | null;
  currentMember: api.ProjectMemberFull | null;
  onReload: () => void;
}) {
  const { showError, showSuccess } = useAppSnackbar();
  const [manage, setManage] = useState(false);
  const [memberToUnlink, setMemberToUnlink] = useState<api.ProjectMemberFull | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const editor = useMemberEditor(project.id, onReload);
  const newMember = useNewMemberForm(project.id, onReload);
  const permissions = getProjectMemberManagementPermissions({
    ownerEmail: project.owner,
    currentEmail,
    currentMember,
  });
  const members = activeMembers(project.members);

  async function deleteMember(member: api.ProjectMemberFull) {
    try {
      await api.deleteMember(project.id, member.id);
      onReload();
      showSuccess("Member deleted.");
    } catch (error) {
      showError(getApiErrorMessage(error));
    }
  }

  async function unlinkMemberEmail() {
    if (!memberToUnlink?.linkedEmail || memberToUnlink.linkedEmail === project.owner || unlinking) {
      return;
    }
    setUnlinking(true);
    try {
      await api.unlinkMemberEmail(project.id, memberToUnlink.linkedEmail);
      setMemberToUnlink(null);
      onReload();
      showSuccess("Email unlinked.");
    } catch (error) {
      setMemberToUnlink(null);
      showError(getApiErrorMessage(error));
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <PanelFrame title="Members" backTo={projectPaths.settings(project.id)}>
      <Stack spacing={2.25}>
        {permissions.canManage ? (
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography color="text.secondary" sx={{ fontSize: 14 }}>
              {members.length} active {members.length === 1 ? "member" : "members"}
            </Typography>
            <Button
              variant="text"
              onClick={() => setManage((value) => !value)}
              sx={{ minHeight: 32, p: 0 }}
            >
              {manage ? "Done" : "Manage"}
            </Button>
          </Stack>
        ) : null}
        <Stack spacing={1.25}>
          {members.map((member) => {
            const balance = memberBalance(project.balance, member.id);
            return (
              <MemberSettingsRow
                key={member.id}
                member={member}
                balance={balance}
                isCurrentMember={member.id === currentMember?.id}
                isOwnerMember={member.linkedEmail === project.owner}
                showEmail={Boolean(currentEmail)}
                manage={manage}
                viewerIsOwner={permissions.isOwner}
                canEdit={permissions.canEdit(member)}
                canUnlink={permissions.canUnlink(member)}
                canDelete={permissions.canDelete(member, balance)}
                onEdit={() => editor.open(member)}
                onUnlink={() => setMemberToUnlink(member)}
                onDelete={() => void deleteMember(member)}
              />
            );
          })}
        </Stack>
        {manage && permissions.canAdd ? <AddMemberForm form={newMember} /> : null}
      </Stack>
      <EditMemberDialog editor={editor} isSelf={editor.member?.id === currentMember?.id} />
      <ConfirmDialog
        open={memberToUnlink !== null}
        title="Unlink member email?"
        description={
          memberToUnlink?.linkedEmail
            ? `${memberToUnlink.linkedEmail} will no longer be linked to ${memberToUnlink.name}. Existing records stay unchanged.`
            : "This email will be unlinked from the member. Existing records stay unchanged."
        }
        confirmLabel="Unlink email"
        confirmColor="warning"
        busy={unlinking}
        onConfirm={() => void unlinkMemberEmail()}
        onClose={() => setMemberToUnlink(null)}
      />
    </PanelFrame>
  );
}
