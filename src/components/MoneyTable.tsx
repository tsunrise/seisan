import { Stack, Typography } from "@mui/material";

import type * as api from "../api";
import { memberName } from "../domain";
import { Amount } from "./Amount";

export function MoneyTable({
  title,
  project,
  map,
  muted = false,
}: {
  title: string;
  project: api.Project;
  map: api.MoneyByMemberId;
  muted?: boolean;
}) {
  const entries = Object.entries(map);
  if (entries.length === 0) {
    return null;
  }

  return (
    <Stack component="section" spacing={1} sx={{ mt: 2 }}>
      <Typography variant="h3">{title}</Typography>
      {entries.map(([memberId, amount]) => (
        <Stack
          key={memberId}
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between" }}
        >
          <Typography>{memberName(project.members, Number(memberId))}</Typography>
          <Amount amount={amount} muted={muted} />
        </Stack>
      ))}
    </Stack>
  );
}
