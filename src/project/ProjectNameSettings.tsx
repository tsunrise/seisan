import { Button, Stack, TextField } from "@mui/material";
import type { FormEvent } from "react";
import { useState } from "react";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { PanelFrame } from "../components/PanelFrame";
import { useAppSnackbar } from "../hooks/useAppSnackbar";

export function ProjectNameSettings({
  project,
  onReload,
}: {
  project: api.Project;
  onReload: () => void;
}) {
  const { showError, showSuccess } = useAppSnackbar();
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== project.name;

  async function saveProjectName(event: FormEvent) {
    event.preventDefault();
    if (!trimmedName || !nameChanged || saving) {
      return;
    }

    setSaving(true);
    try {
      const updatedProject = await api.renameProject(project.id, trimmedName);
      setName(updatedProject.name);
      onReload();
      showSuccess("Project name updated.");
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PanelFrame title="Project name" backTo={`/project/${project.id}/settings`}>
      <Stack component="form" spacing={2} onSubmit={(event) => void saveProjectName(event)}>
        <TextField
          label="Project name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.closest("form")?.requestSubmit();
            }
          }}
          disabled={saving}
          required
          fullWidth
        />
        <Button type="submit" variant="contained" disabled={!trimmedName || !nameChanged || saving}>
          {saving ? "Saving…" : "Save project name"}
        </Button>
      </Stack>
    </PanelFrame>
  );
}
