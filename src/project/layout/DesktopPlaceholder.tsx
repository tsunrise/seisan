import AddIcon from "@mui/icons-material/Add";
import { Button, Paper, Stack, Typography } from "@mui/material";
import { Link } from "react-router";

import type * as api from "../../api";
import { panelFrameSx } from "../../components/styles";
import { projectPaths } from "../paths";

export function DesktopPlaceholder({
  project,
  currentMember,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
}) {
  return (
    <Paper square sx={panelFrameSx}>
      <Stack spacing={1.5}>
        <Typography variant="h2">{currentMember ? "Ready to post" : "Project details"}</Typography>
        <Typography color="text.secondary">
          {currentMember
            ? "Select a record or create a new one."
            : `${project.name} is visible as a public ledger.`}
        </Typography>
        {currentMember ? (
          <Button
            component={Link}
            to={projectPaths.newRecord(project.id)}
            variant="contained"
            startIcon={<AddIcon />}
          >
            Post record
          </Button>
        ) : null}
      </Stack>
    </Paper>
  );
}
