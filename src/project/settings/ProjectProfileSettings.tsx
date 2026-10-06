import { Button, Stack, TextField } from "@mui/material";
import { useState } from "react";

import type * as api from "../../api";
import { MemberConfigFields } from "../../components/memberConfig/MemberConfigFields";
import { memberConfigDraft } from "../../components/memberConfig/memberConfigDraft";
import { PanelFrame } from "../../components/PanelFrame";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import { projectPaths } from "../paths";
import { memberProfileEdit, saveMemberProfile } from "./memberProfile";

/** The current linked member's own name, transfer method, and represented-group size. */
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
  const edit = memberProfileEdit(currentMember, name, draft);

  async function saveProfile() {
    if (!edit.canSave || savingProfile) {
      return;
    }
    setSavingProfile(true);
    const result = await saveMemberProfile(project.id, currentMember.id, edit);
    if (result.ok) {
      setName(edit.trimmedName);
      onReload();
      showSuccess("Profile updated.");
    } else {
      if (result.nameSaved) {
        onReload();
      }
      showError(result.message);
    }
    setSavingProfile(false);
  }

  return (
    <PanelFrame title="Your profile" backTo={projectPaths.settings(project.id)}>
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
          disabled={!edit.canSave || savingProfile}
          onClick={() => void saveProfile()}
        >
          {savingProfile ? "Saving…" : "Save profile"}
        </Button>
      </Stack>
    </PanelFrame>
  );
}
