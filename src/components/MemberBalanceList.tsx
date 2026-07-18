import { Stack, Typography } from "@mui/material";

import type * as api from "../api";
import { Amount } from "./Amount";
import { MemberPaymentMethod } from "./MemberPaymentMethod";

export function MemberBalanceList({
  project,
  currentMember,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
}) {
  const activeMembers = project.members.filter((member) => !member.deleted);

  return (
    <Stack component="section" spacing={0}>
      {activeMembers.map((member) => (
        <Stack
          key={member.id}
          direction="row"
          sx={{
            alignItems: "center",
            gap: 1.5,
            justifyContent: "space-between",
            minHeight: 32,
            minWidth: 0,
            py: 0.25,
          }}
        >
          <Stack sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                minWidth: 0,
                fontWeight: member.id === currentMember?.id ? 900 : 400,
                overflowWrap: "anywhere",
                textDecoration: member.id === currentMember?.id ? "underline" : "none",
                textUnderlineOffset: "4px",
              }}
            >
              {member.name}
            </Typography>
            <MemberPaymentMethod member={member} prefix="" />
          </Stack>
          <Amount amount={project.balance[String(member.id)] ?? 0} />
        </Stack>
      ))}
    </Stack>
  );
}
