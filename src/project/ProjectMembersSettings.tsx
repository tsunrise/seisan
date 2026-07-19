import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import SecurityIcon from "@mui/icons-material/Security";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { Amount } from "../components/Amount";
import { MemberConfigFields } from "../components/MemberConfigFields";
import { MemberNameWithRepresentation } from "../components/MemberNameWithRepresentation";
import { PanelFrame } from "../components/PanelFrame";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import {
  memberConfigDraft,
  memberConfigDraftIsValid,
  memberConfigFromDraft,
} from "../memberConfig";

const memberActionButtonSx = {
  border: 0,
  bgcolor: "transparent",
  "&:hover": { bgcolor: "action.hover" },
  "&.Mui-disabled": { border: 0, bgcolor: "transparent" },
};

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
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberConfig, setNewMemberConfig] = useState(() => memberConfigDraft());
  const [addingMember, setAddingMember] = useState(false);
  const [editingMember, setEditingMember] = useState<api.ProjectMemberFull | null>(null);
  const [editingName, setEditingName] = useState("");
  const [memberToKick, setMemberToKick] = useState<api.ProjectMemberFull | null>(null);
  const [kickingMember, setKickingMember] = useState(false);
  const isOwner = currentEmail === project.owner;
  const activeMembers = project.members.filter((member) => !member.deleted);

  async function addMember() {
    const config = memberConfigFromDraft(newMemberConfig, { includePaymentMethod: false });
    if (!newMemberName.trim() || !config || addingMember) {
      return;
    }
    setAddingMember(true);
    try {
      const created = await api.createMember(project.id, newMemberName.trim());
      try {
        if (Object.keys(config).length > 0) {
          await api.putMemberConfig(project.id, created.member.id, config);
        }
      } catch (error) {
        setNewMemberName("");
        setNewMemberConfig(memberConfigDraft());
        onReload();
        showError(`Member added, but represented size was not saved. ${getApiErrorMessage(error)}`);
        return;
      }
      setNewMemberName("");
      setNewMemberConfig(memberConfigDraft());
      onReload();
      showSuccess("Member added.");
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setAddingMember(false);
    }
  }

  function openEditMember(member: api.ProjectMemberFull) {
    setEditingMember(member);
    setEditingName(member.name);
  }

  async function saveMemberName() {
    if (!editingMember || !editingName.trim()) {
      return;
    }
    try {
      await api.patchMember(project.id, editingMember.id, { name: editingName.trim() });
      setEditingMember(null);
      setEditingName("");
      onReload();
      showSuccess("Member renamed.");
    } catch (error) {
      showError(getApiErrorMessage(error));
    }
  }

  async function deleteMember(member: api.ProjectMemberFull) {
    try {
      await api.deleteMember(project.id, member.id);
      onReload();
      showSuccess("Member deleted.");
    } catch (error) {
      showError(getApiErrorMessage(error));
    }
  }

  async function kickMemberEmail() {
    if (!memberToKick?.linkedEmail || memberToKick.linkedEmail === project.owner || kickingMember) {
      return;
    }
    setKickingMember(true);
    try {
      await api.unlinkMemberEmail(project.id, memberToKick.linkedEmail);
      setMemberToKick(null);
      onReload();
      showSuccess("Email unlinked.");
    } catch (error) {
      setMemberToKick(null);
      showError(getApiErrorMessage(error));
    } finally {
      setKickingMember(false);
    }
  }

  return (
    <PanelFrame title="Members" backTo={`/project/${project.id}/settings`}>
      <Stack spacing={2.25}>
        {isOwner ? (
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography color="text.secondary" sx={{ fontSize: 14 }}>
              {activeMembers.length} active {activeMembers.length === 1 ? "member" : "members"}
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
          {activeMembers.map((member) => {
            const balance = project.balance[String(member.id)] ?? 0;
            const isCurrentMember = member.id === currentMember?.id;
            const isOwnerMember = member.linkedEmail === project.owner;
            const canDeleteMember = isOwner && balance === 0;
            const canKickMemberEmail =
              isOwner && member.linkedEmail !== undefined && member.linkedEmail !== project.owner;
            return (
              <Stack
                key={member.id}
                direction="row"
                sx={{
                  alignItems: "flex-start",
                  gap: 1.25,
                  py: 0.5,
                }}
              >
                <Stack sx={{ minWidth: 0, flex: "1 1 auto", gap: 0.2 }}>
                  <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, minWidth: 0 }}>
                    <MemberNameWithRepresentation
                      member={member}
                      nameSx={{
                        fontWeight: isCurrentMember ? 850 : 600,
                        overflowWrap: "anywhere",
                      }}
                    />
                    {isOwnerMember ? (
                      <Tooltip title="Owner">
                        <SecurityIcon
                          aria-label="Owner"
                          fontSize="small"
                          sx={{ color: "text.secondary", flex: "0 0 auto" }}
                        />
                      </Tooltip>
                    ) : null}
                  </Stack>
                  {currentEmail ? (
                    <Typography color="text.secondary" sx={{ fontSize: 12.5, lineHeight: 1.3 }}>
                      {member.linkedEmail ?? "Not yet joined"}
                    </Typography>
                  ) : null}
                  {member.config?.paymentMethod ? (
                    <Typography sx={{ color: "text.secondary", fontSize: 12.5, lineHeight: 1.3 }}>
                      Transfer method: {member.config.paymentMethod}
                    </Typography>
                  ) : null}
                </Stack>
                <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, flex: "0 0 auto" }}>
                  <Amount amount={balance} />
                  {manage ? (
                    <>
                      <IconButton
                        aria-label={`Edit ${member.name}`}
                        onClick={() => openEditMember(member)}
                        sx={memberActionButtonSx}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <Tooltip title={canKickMemberEmail ? "Unlink email" : "Cannot unlink"}>
                        <span>
                          <IconButton
                            color="warning"
                            aria-label={`Unlink ${member.name}`}
                            disabled={!canKickMemberEmail}
                            onClick={() => setMemberToKick(member)}
                            sx={memberActionButtonSx}
                          >
                            <LinkOffIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <IconButton
                        color="error"
                        aria-label={`Delete ${member.name}`}
                        disabled={!canDeleteMember}
                        onClick={() => void deleteMember(member)}
                        sx={memberActionButtonSx}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </>
                  ) : null}
                </Stack>
              </Stack>
            );
          })}
        </Stack>
        {manage && isOwner ? (
          <Stack spacing={1.5}>
            <Typography variant="h3">Add member</Typography>
            <TextField
              label="Member name"
              value={newMemberName}
              onChange={(event) => setNewMemberName(event.target.value)}
              disabled={addingMember}
            />
            <MemberConfigFields
              draft={newMemberConfig}
              onChange={setNewMemberConfig}
              includePaymentMethod={false}
              disabled={addingMember}
            />
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              disabled={
                !newMemberName.trim() ||
                !memberConfigDraftIsValid(newMemberConfig, { includePaymentMethod: false }) ||
                addingMember
              }
              onClick={() => void addMember()}
            >
              {addingMember ? "Adding…" : "Add member"}
            </Button>
          </Stack>
        ) : null}
      </Stack>
      <Dialog open={editingMember !== null} onClose={() => setEditingMember(null)} fullWidth>
        <DialogTitle>Rename member</DialogTitle>
        <DialogContent>
          <TextField
            label="Member name"
            value={editingName}
            onChange={(event) => setEditingName(event.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingMember(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!editingName.trim() || editingName.trim() === editingMember?.name}
            onClick={() => void saveMemberName()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={memberToKick !== null}
        onClose={() => {
          if (!kickingMember) {
            setMemberToKick(null);
          }
        }}
        fullWidth
      >
        <DialogTitle>Unlink member email?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {memberToKick?.linkedEmail
              ? `${memberToKick.linkedEmail} will no longer be linked to ${memberToKick.name}. Existing records stay unchanged.`
              : "This email will be unlinked from the member. Existing records stay unchanged."}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={kickingMember} onClick={() => setMemberToKick(null)}>
            Cancel
          </Button>
          <Button
            color="warning"
            variant="contained"
            disabled={kickingMember}
            onClick={() => void kickMemberEmail()}
          >
            Unlink email
          </Button>
        </DialogActions>
      </Dialog>
    </PanelFrame>
  );
}
