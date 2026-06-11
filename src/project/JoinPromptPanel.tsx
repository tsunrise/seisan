import { Button, Paper, Stack, Typography } from "@mui/material";
import { Link, useLocation } from "react-router";

import type * as api from "../api";
import { panelFrameSx } from "../components/styles";
import { loginPath } from "../utils";
import { Add, ArrowForward } from "@mui/icons-material";

export function JoinPromptPanel({
  project,
  currentEmail,
}: {
  project: api.Project;
  currentEmail: string | null;
}) {
  const location = useLocation();

  if (!currentEmail) {
    return (
      <Paper square sx={panelFrameSx}>
        <Stack spacing={1.5}>
          <Typography variant="h2">Welcome to Seisan</Typography>
          <Typography color="text.secondary">
            Sign in to join this project and post records.
          </Typography>
          <Button
            component={Link}
            to={loginPath(location)}
            variant="contained"
            startIcon={<ArrowForward />}
          >
            Get Started
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper square sx={panelFrameSx}>
      <Stack spacing={1.5}>
        <Typography variant="h2">You are not a member yet.</Typography>
        <Typography color="text.secondary">Join this project to post new records.</Typography>
        <Button
          component={Link}
          to={`/project/${project.id}/join`}
          variant="contained"
          startIcon={<Add />}
        >
          Join Project
        </Button>
      </Stack>
    </Paper>
  );
}
