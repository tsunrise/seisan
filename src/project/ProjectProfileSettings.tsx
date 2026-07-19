import { Button, Stack, TextField } from "@mui/material";
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
  const [name, setName] = useState(currentMember.name);
  const [draft, setDraft] = useState(() => memberConfigDraft(currentMember.config));
  const [savingProfile, setSavingProfile] = useState(false);
  const nextConfig = memberConfigFromDraft(draft);
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== currentMember.name;
  const configChanged =
    nextConfig !== null &&
    (nextConfig.size !== currentMember.config?.size ||
      nextConfig.paymentMethod !== currentMember.config?.paymentMethod);
  const profileChanged = nameChanged || configChanged;

  async function saveProfile() {
    const config = memberConfigFromDraft(draft);
    if (!trimmedName || !config || !profileChanged || savingProfile) {
      return;
    }
    setSavingProfile(true);
    let savedName = false;
    try {
      if (nameChanged) {
        await api.patchMember(project.id, currentMember.id, { name: trimmedName });
        savedName = true;
      }
      if (configChanged) {
        await api.putMemberConfig(project.id, currentMember.id, config);
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
    <PanelFrame title="Your profile" backTo={`/project/${project.id}/settings`}>
      <Stack spacing={2}>
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
        <MemberConfigFields draft={draft} onChange={setDraft} isSelf disabled={savingProfile} />
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
