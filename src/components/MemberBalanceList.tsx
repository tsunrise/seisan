import { Stack, Typography } from "@mui/material";

import type * as api from "../api";
import { Amount } from "./Amount";

export function MemberBalanceList({
  project,
  currentMember,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
}) {
  return (
    <Stack component="section" spacing={1}>
      {project.members.map((member) => (
        <Stack
          key={member.id}
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between", gap: 1.5 }}
        >
          <Typography>
            {member.name}
            {member.id === currentMember?.id ? " (You)" : ""}
          </Typography>
          <Amount amount={project.balance[String(member.id)] ?? 0} />
        </Stack>
      ))}
    </Stack>
  );
}
