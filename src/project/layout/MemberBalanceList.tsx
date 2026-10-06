import { Stack } from "@mui/material";

import type * as api from "../../api";
import { Amount } from "../../components/Amount";
import { MemberPaymentMethod } from "../../components/MemberPaymentMethod";
import { MemberNameWithRepresentation } from "../../components/MemberNameWithRepresentation";
import { activeMembers, memberBalance } from "../../domain";

export function MemberBalanceList({
  project,
  currentMember,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
}) {
  return (
    <Stack component="section" spacing={0}>
      {activeMembers(project.members).map((member) => (
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
            <MemberNameWithRepresentation
              member={member}
              nameSx={{
                minWidth: 0,
                fontWeight: member.id === currentMember?.id ? 900 : 400,
                overflowWrap: "anywhere",
                textDecoration: member.id === currentMember?.id ? "underline" : "none",
                textUnderlineOffset: "4px",
              }}
            />
            <MemberPaymentMethod member={member} prefix="" />
          </Stack>
          <Amount amount={memberBalance(project.balance, member.id)} />
        </Stack>
      ))}
    </Stack>
  );
}
