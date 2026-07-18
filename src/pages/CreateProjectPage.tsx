import AddIcon from "@mui/icons-material/Add";
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import type { FormEvent } from "react";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { BackLink } from "../components/BackLink";
import { MemberConfigFields } from "../components/MemberConfigFields";
import { panelFrameSx } from "../components/styles";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { memberConfigDraft, memberConfigFromDraft } from "../memberConfig";
import { loginPath } from "../utils";

export function CreateProjectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showError, showSuccess } = useAppSnackbar();
  const user = useCurrentUser({ required: true });
  const [name, setName] = useState("");
  const [ownerMemberName, setOwnerMemberName] = useState("");
  const [memberConfig, setMemberConfig] = useState(() => memberConfigDraft());
  const [creating, setCreating] = useState(false);

  if (user.status === "error") {
    return <Navigate to={loginPath(location)} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const config = memberConfigFromDraft(memberConfig);
    if (!config) {
      showError("Enter a whole number of at least 2 for the people you represent.");
      return;
    }
    if (Object.keys(config).length > 0 && !ownerMemberName.trim()) {
      showError("Enter your member name to save your transfer and group details.");
      return;
    }
    setCreating(true);
    try {
      const project = await api.createProject({
        name,
        ownerMemberName: ownerMemberName.trim() || undefined,
        acl: { type: "public" },
      });
      const ownerMember = project.members.find((member) => member.linkedEmail === project.owner);
      try {
        if (Object.keys(config).length > 0 && !ownerMember) {
          throw new Error("The created project did not return its owner member.");
        }
        if (ownerMember && Object.keys(config).length > 0) {
          await api.putMemberConfig(project.id, ownerMember.id, config);
        }
      } catch (error) {
        showError(
          `Project created, but profile details were not saved. Update them from Project info. ${getApiErrorMessage(error)}`,
        );
        navigate(`/project/${project.id}`);
        return;
      }
      showSuccess("Project created.");
      navigate(`/project/${project.id}`);
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Box component="main" sx={{ minHeight: "100svh", display: "grid", placeItems: "center", p: 3 }}>
      <Box sx={{ width: "min(560px, 100%)" }}>
        <BackLink to="/projects" label="Projects" />
        <Paper component="form" square onSubmit={submit} sx={panelFrameSx}>
          <Stack spacing={2}>
            <Typography variant="h1">New project</Typography>
            <TextField
              label="Project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <Stack spacing={1.25}>
              <Typography variant="h2">Your profile</Typography>
              <TextField
                label="Your name in project"
                value={ownerMemberName}
                onChange={(event) => setOwnerMemberName(event.target.value)}
              />
              <MemberConfigFields draft={memberConfig} onChange={setMemberConfig} />
            </Stack>
            <Button type="submit" variant="contained" startIcon={<AddIcon />} disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
