import SecurityIcon from "@mui/icons-material/Security";
import { Button, InputAdornment, MenuItem, Stack, TextField } from "@mui/material";
import { useState } from "react";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { MemberConfigFields } from "../components/MemberConfigFields";
import { PanelFrame } from "../components/PanelFrame";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { memberConfigDraft, memberConfigFromDraft } from "../memberConfig";

export function ProjectProfileSettings({
  project,
  currentMember,
  onReload,
}: {
  project: api.Project;
  currentMember: api.ProjectMemberFull;
  onReload: () => void;
}) {
  const { showError, showSuccess } = useAppSnackbar();
  const activeMembers = project.members.filter((member) => !member.deleted);
  const isOwner = currentMember.linkedEmail === project.owner;
  const [selectedMemberId, setSelectedMemberId] = useState(currentMember.id);
  const selectedMember =
    activeMembers.find((member) => member.id === selectedMemberId) ?? currentMember;
  const [name, setName] = useState(currentMember.name);
  const [draft, setDraft] = useState(() => memberConfigDraft(currentMember.config));
  const [savingProfile, setSavingProfile] = useState(false);
  const nextConfig = memberConfigFromDraft(draft);
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== selectedMember.name;
  const configChanged =
    nextConfig !== null &&
    (nextConfig.size !== selectedMember.config?.size ||
      nextConfig.paymentMethod !== selectedMember.config?.paymentMethod);
  const profileChanged = nameChanged || configChanged;

  function selectMember(memberId: number) {
    const member = activeMembers.find((candidate) => candidate.id === memberId);
    if (!member) {
      return;
    }
    setSelectedMemberId(member.id);
    setName(member.name);
    setDraft(memberConfigDraft(member.config));
  }

  async function saveProfile() {
    const config = memberConfigFromDraft(draft);
    if (!trimmedName || !config || !profileChanged || savingProfile) {
      return;
    }
    setSavingProfile(true);
    let savedName = false;
    try {
      if (nameChanged) {
        await api.patchMember(project.id, selectedMember.id, { name: trimmedName });
        savedName = true;
      }
      if (configChanged) {
        await api.putMemberConfig(project.id, selectedMember.id, config);
      }
      setName(trimmedName);
      onReload();
      showSuccess("Profile updated.");
    } catch (error) {
      if (savedName) {
        onReload();
        showError(
          `Member name updated, but the remaining profile details were not saved. ${getApiErrorMessage(error)}`,
        );
      } else {
        showError(getApiErrorMessage(error));
      }
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <PanelFrame
      title={isOwner ? "Member profile" : "Your profile"}
      backTo={`/project/${project.id}/settings`}
    >
      <Stack spacing={2}>
        {isOwner ? (
          <TextField
            select
            label="Update on behalf of"
            value={String(selectedMember.id)}
            onChange={(event) => selectMember(Number(event.target.value))}
            disabled={savingProfile}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SecurityIcon
                      aria-hidden="true"
                      sx={{ color: "text.secondary", fontSize: 19 }}
                    />
                  </InputAdornment>
                ),
              },
            }}
          >
            {activeMembers.map((member) => (
              <MenuItem key={member.id} value={String(member.id)}>
                {member.name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <TextField
          label="Member name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveProfile();
            }
          }}
          disabled={savingProfile}
          fullWidth
        />
        <MemberConfigFields draft={draft} onChange={setDraft} disabled={savingProfile} />
        <Button
          variant="contained"
          disabled={!trimmedName || !nextConfig || !profileChanged || savingProfile}
          onClick={() => void saveProfile()}
        >
          {savingProfile ? "Saving…" : "Save profile"}
        </Button>
      </Stack>
    </PanelFrame>
  );
}
