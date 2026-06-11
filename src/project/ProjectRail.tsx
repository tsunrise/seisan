import PeopleIcon from "@mui/icons-material/People";
import { Button, Stack, Typography } from "@mui/material";
import { Link } from "react-router";

import type * as api from "../api";
import { BrandLink } from "../components/BrandLink";
import { MemberBalanceList } from "../components/MemberBalanceList";

export function ProjectRail({
  project,
  currentMember,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
}) {
  return (
    <Stack
      component="aside"
      spacing={2.25}
      sx={{ alignSelf: "start", position: "sticky", top: 24 }}
    >
      <BrandLink />
      <Typography variant="h2">{project.name}</Typography>
      <MemberBalanceList project={project} currentMember={currentMember} />
      <Button
        component={Link}
        to={`/project/${project.id}/settings`}
        variant="outlined"
        startIcon={<PeopleIcon />}
        fullWidth
      >
        Project info
      </Button>
    </Stack>
  );
}
