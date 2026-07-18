import AddIcon from "@mui/icons-material/Add";
import BalanceOutlinedIcon from "@mui/icons-material/BalanceOutlined";
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
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { Link } from "react-router";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { AllowedEmailList } from "../components/AllowedEmailList";
import { Amount } from "../components/Amount";
import { PanelFrame } from "../components/PanelFrame";
import { panelFrameSx } from "../components/styles";
import { useAppSnackbar } from "../hooks/useAppSnackbar";

const memberActionButtonSx = {
  border: 0,
  bgcolor: "transparent",
  "&:hover": {
    bgcolor: "action.hover",
  },
  "&.Mui-disabled": {
    border: 0,
    bgcolor: "transparent",
  },
};

export function ProjectSettings({
  project,
  currentEmail,
  currentMember,
  onReload,
}: {
  project: api.Project;
  currentEmail: string | null;
  currentMember: api.ProjectMember | null;
  onReload: () => void;
}) {
  const { showError, showSuccess } = useAppSnackbar();
  const [manage, setManage] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [visibility, setVisibility] = useState<api.ProjectAcl["type"]>(project.acl.type);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [editingMember, setEditingMember] = useState<api.ProjectMember | null>(null);
  const [editingName, setEditingName] = useState("");
  const [memberToKick, setMemberToKick] = useState<api.ProjectMember | null>(null);
  const [kickingMember, setKickingMember] = useState(false);
  const [confirmingLeaveProject, setConfirmingLeaveProject] = useState(false);
  const [leavingProject, setLeavingProject] = useState(false);
  const isOwner = currentEmail === project.owner;
  const activeMembers = project.members.filter((member) => !member.deleted);
  const allowedEmails = project.acl.type === "restricted" ? project.acl.emails : [];
  const canEditAllowedEmails = isOwner && visibility === "restricted" && !savingVisibility;
  const canManageMembers = isOwner || currentMember !== null;
  const canLeaveProject = !isOwner && currentMember !== null;

  async function updateVisibility(nextVisibility: api.ProjectAcl["type"]) {
    if (nextVisibility === visibility || savingVisibility) {
      return;
    }
    setVisibility(nextVisibility);
    setSavingVisibility(true);
    try {
      await api.setAclType(project.id, nextVisibility);
      onReload();
      showSuccess("Project visibility updated.");
    } catch (error) {
      setVisibility(project.acl.type);
      showError(getApiErrorMessage(error));
    } finally {
      setSavingVisibility(false);
    }
  }

  async function updateAllowedEmails(nextEmails: string[]) {
    const emailsToAdd = nextEmails.filter((email) => !allowedEmails.includes(email));
    const emailsToRemove = allowedEmails.filter((email) => !nextEmails.includes(email));
    if (emailsToAdd.length === 0 && emailsToRemove.length === 0) {
      return;
    }
    try {
      if (emailsToAdd.length > 0) {
        await api.appendAclEmails(project.id, emailsToAdd);
      }
      if (emailsToRemove.length > 0) {
        await api.removeAclEmails(project.id, emailsToRemove);
      }
      onReload();
      showSuccess("Allowed emails updated.");
    } catch (error) {
      showError(getApiErrorMessage(error));
      throw error;
    }
  }

  async function addMember() {
    if (!newMemberName.trim()) {
      return;
    }
    try {
      await api.createMember(project.id, newMemberName);
      setNewMemberName("");
      onReload();
      showSuccess("Member added.");
    } catch (error) {
      showError(getApiErrorMessage(error));
    }
  }

  function openEditMember(member: api.ProjectMember) {
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

  async function deleteMember(member: api.ProjectMember) {
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

  async function leaveProject() {
    if (!canLeaveProject || leavingProject) {
      return;
    }
    setLeavingProject(true);
    try {
      await api.leaveProject(project.id);
      setConfirmingLeaveProject(false);
      onReload();
      showSuccess("Left project.");
    } catch (error) {
      setConfirmingLeaveProject(false);
      showError(getApiErrorMessage(error));
    } finally {
      setLeavingProject(false);
    }
  }

  return (
    <PanelFrame title="Project info" backTo={`/project/${project.id}`}>
      <Stack spacing={2}>
        {currentMember ? (
          <Button
            component={Link}
            to={`/project/${project.id}/settle`}
            variant="outlined"
            startIcon={<BalanceOutlinedIcon />}
            fullWidth
          >
            View settlement plan
          </Button>
        ) : null}
        <TextField
          select
          label="Visibility"
          disabled={!isOwner || savingVisibility}
          value={visibility}
          onChange={(event) => void updateVisibility(event.target.value as api.ProjectAcl["type"])}
        >
          <MenuItem value="public">Public</MenuItem>
          <MenuItem value="restricted">Restricted</MenuItem>
        </TextField>
        {visibility === "restricted" ? (
          <Paper component="section" square sx={panelFrameSx}>
            <AllowedEmailList
              emails={allowedEmails}
              description="Joined members always have access."
              disabled={!canEditAllowedEmails}
              editable={isOwner}
              emptyMessage={savingVisibility ? "Updating visibility..." : undefined}
              onListChange={updateAllowedEmails}
            />
          </Paper>
        ) : null}
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}
        >
          <Typography variant="h2">Members</Typography>
          {canManageMembers ? (
            <Button variant="text" onClick={() => setManage((value) => !value)}>
              {manage ? "Done" : "Manage"}
            </Button>
          ) : null}
        </Stack>
        <Stack spacing={1}>
          {activeMembers.map((member) => {
            const balance = project.balance[String(member.id)] ?? 0;
            const isCurrentMember = member.id === currentMember?.id;
            const isOwnerMember = member.linkedEmail === project.owner;
            const canEditMember = isOwner || isCurrentMember;
            const canDeleteMember = isOwner && balance === 0;
            const canKickMemberEmail =
              isOwner && member.linkedEmail !== undefined && member.linkedEmail !== project.owner;
            return (
              <Stack
                key={member.id}
                direction="row"
                sx={{
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1.25,
                  minHeight: 44,
                }}
              >
                <Stack sx={{ minWidth: 0, flex: "1 1 auto" }}>
                  <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, minWidth: 0 }}>
                    <Typography
                      sx={{
                        minWidth: 0,
                        fontWeight: isCurrentMember ? 900 : 400,
                        overflowWrap: "anywhere",
                        textDecoration: isCurrentMember ? "underline" : "none",
                        textUnderlineOffset: "4px",
                      }}
                    >
                      {member.name}
                    </Typography>
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
                    <Typography
                      variant="body2"
                      sx={{ color: "text.secondary", overflowWrap: "anywhere" }}
                    >
                      {member.linkedEmail ?? "Not yet joined"}
                    </Typography>
                  ) : null}
                </Stack>
                <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, flex: "0 0 auto" }}>
                  <Amount amount={balance} />
                  {manage ? (
                    <>
                      <IconButton
                        aria-label={`Edit ${member.name}`}
                        disabled={!canEditMember}
                        onClick={() => openEditMember(member)}
                        sx={memberActionButtonSx}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      {isOwner ? (
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
                      ) : null}
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
        {canLeaveProject ? (
          <Button
            variant="outlined"
            color="error"
            disabled={leavingProject}
            onClick={() => setConfirmingLeaveProject(true)}
          >
            Leave project
          </Button>
        ) : null}
        {manage && isOwner ? (
          <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 1.25 }}>
            <TextField
              label="New member"
              value={newMemberName}
              onChange={(event) => setNewMemberName(event.target.value)}
              sx={{ flex: 1 }}
            />
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => void addMember()}>
              New
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
      <Dialog
        open={confirmingLeaveProject}
        onClose={() => {
          if (!leavingProject) {
            setConfirmingLeaveProject(false);
          }
        }}
        fullWidth
      >
        <DialogTitle>Leave project?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will unlink your email from your member profile. Existing records stay unchanged.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={leavingProject} onClick={() => setConfirmingLeaveProject(false)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={leavingProject}
            onClick={() => void leaveProject()}
          >
            Leave project
          </Button>
        </DialogActions>
      </Dialog>
    </PanelFrame>
  );
}
