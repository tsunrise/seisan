import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

import * as api from "../api";
import { Amount } from "../components/Amount";
import { InlineAlert } from "../components/InlineAlert";
import { PanelFrame } from "../components/PanelFrame";
import { panelFrameSx } from "../components/styles";
import { parseEmailList } from "../utils";

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
  const [manage, setManage] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [visibility, setVisibility] = useState<api.ProjectAcl["type"]>(project.acl.type);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [newAllowedEmail, setNewAllowedEmail] = useState("");
  const [editingMember, setEditingMember] = useState<api.ProjectMember | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isOwner = currentEmail === project.owner;
  const activeMembers = project.members.filter((member) => !member.deleted);
  const allowedEmails = project.acl.type === "restricted" ? project.acl.emails : [];
  const canEditAllowedEmails = isOwner && visibility === "restricted" && !savingVisibility;
  const canManageMembers = isOwner || currentMember !== null;

  async function updateVisibility(nextVisibility: api.ProjectAcl["type"]) {
    if (nextVisibility === visibility || savingVisibility) {
      return;
    }
    setVisibility(nextVisibility);
    setSavingVisibility(true);
    setError(null);
    try {
      await api.setAclType(project.id, nextVisibility);
      onReload();
    } catch {
      setVisibility(project.acl.type);
      setError("Could not update project visibility.");
    } finally {
      setSavingVisibility(false);
    }
  }

  async function addAllowedEmails() {
    const nextEmails = parseEmailList(newAllowedEmail).filter(
      (email) => !allowedEmails.includes(email),
    );
    if (nextEmails.length === 0) {
      setNewAllowedEmail("");
      return;
    }
    setError(null);
    try {
      await api.appendAclEmails(project.id, nextEmails);
      setNewAllowedEmail("");
      onReload();
    } catch {
      setError("Could not add allowed email.");
    }
  }

  async function removeAllowedEmail(email: string) {
    setError(null);
    try {
      await api.removeAclEmails(project.id, [email]);
      onReload();
    } catch {
      setError("Could not remove that allowed email.");
    }
  }

  async function addMember() {
    if (!newMemberName.trim()) {
      return;
    }
    setError(null);
    try {
      await api.createMember(project.id, newMemberName);
      setNewMemberName("");
      onReload();
    } catch {
      setError("Could not add that member.");
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
    setError(null);
    try {
      await api.patchMember(project.id, editingMember.id, { name: editingName.trim() });
      setEditingMember(null);
      setEditingName("");
      onReload();
    } catch {
      setError("Could not rename that member.");
    }
  }

  async function deleteMember(member: api.ProjectMember) {
    setError(null);
    try {
      await api.deleteMember(project.id, member.id);
      onReload();
    } catch {
      setError("Only zero-balance members can be deleted.");
    }
  }

  return (
    <PanelFrame title="Project info" backTo={`/project/${project.id}`}>
      <Stack spacing={2}>
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
            <Stack spacing={1.5}>
              <Typography variant="h2">Allowed emails</Typography>
              {savingVisibility ? (
                <Typography color="text.secondary">Updating visibility...</Typography>
              ) : null}
              <Stack spacing={1}>
                {allowedEmails.length === 0 ? (
                  <Typography color="text.secondary">No extra emails are allowed yet.</Typography>
                ) : null}
                {allowedEmails.map((email) => (
                  <Stack
                    key={email}
                    direction="row"
                    sx={{
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1.25,
                      minHeight: 44,
                      borderBottom: 1,
                      borderColor: "divider",
                      pb: 1,
                    }}
                  >
                    <Typography noWrap>{email}</Typography>
                    {isOwner ? (
                      <IconButton
                        color="error"
                        disabled={!canEditAllowedEmails}
                        aria-label={`Remove ${email}`}
                        onClick={() => void removeAllowedEmail(email)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    ) : null}
                  </Stack>
                ))}
              </Stack>
              {isOwner ? (
                <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 1.25 }}>
                  <TextField
                    type="email"
                    label="Allowed email"
                    disabled={!canEditAllowedEmails}
                    value={newAllowedEmail}
                    onChange={(event) => setNewAllowedEmail(event.target.value)}
                    placeholder="name@example.com"
                    sx={{ flex: 1 }}
                  />
                  <Button
                    variant="outlined"
                    disabled={!canEditAllowedEmails}
                    startIcon={<AddIcon />}
                    onClick={() => void addAllowedEmails()}
                  >
                    Add
                  </Button>
                </Stack>
              ) : null}
            </Stack>
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
            const canEditMember = isOwner || isCurrentMember;
            const canDeleteMember = isOwner && balance === 0;
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
                <Typography
                  noWrap
                  sx={{
                    minWidth: 0,
                    flex: "1 1 auto",
                    fontWeight: isCurrentMember ? 900 : 400,
                    textDecoration: isCurrentMember ? "underline" : "none",
                    textUnderlineOffset: "4px",
                  }}
                >
                  {member.name}
                </Typography>
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
        {error ? <InlineAlert>{error}</InlineAlert> : null}
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
    </PanelFrame>
  );
}
