import { MenuItem, Stack, TextField } from "@mui/material";
import { useState } from "react";

import * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import { AllowedEmailList } from "./AllowedEmailList";
import { PanelFrame } from "../../components/PanelFrame";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import { projectPaths } from "../paths";

export function ProjectAccessSettings({
  project,
  currentEmail,
  onReload,
}: {
  project: api.Project;
  currentEmail: string | null;
  onReload: () => void;
}) {
  const { showError, showSuccess } = useAppSnackbar();
  const [visibility, setVisibility] = useState<api.ProjectAcl["type"]>(project.acl.type);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const isOwner = currentEmail === project.owner;
  const allowedEmails = project.acl.type === "restricted" ? project.acl.emails : [];

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

  return (
    <PanelFrame title="Access control" backTo={projectPaths.settings(project.id)}>
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
          <AllowedEmailList
            emails={allowedEmails}
            description="Joined members always have access."
            disabled={!isOwner || savingVisibility}
            editable={isOwner}
            emptyMessage={savingVisibility ? "Updating visibility..." : undefined}
            onListChange={updateAllowedEmails}
          />
        ) : null}
      </Stack>
    </PanelFrame>
  );
}
