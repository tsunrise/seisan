import { Stack, Typography } from "@mui/material";

import type * as api from "../api";
import { findMember } from "../domain";
import { Amount, type AmountColorMode } from "./Amount";
import { MemberNameWithRepresentation } from "./MemberNameWithRepresentation";

export function MoneyTable({
  title,
  project,
  map,
  muted = false,
  amountColorMode = "balance",
}: {
  title: string;
  project: api.Project;
  map: api.MoneyByMemberId;
  muted?: boolean;
  amountColorMode?: AmountColorMode;
}) {
  const entries = Object.entries(map);
  if (entries.length === 0) {
    return null;
  }

  return (
    <Stack component="section" spacing={0.25} sx={{ mt: 0.5 }}>
      <Typography variant="h3" sx={{ mb: 0.75 }}>
        {title}
      </Typography>
      {entries.map(([memberId, amount]) => {
        const member = findMember(project.members, Number(memberId));

        return (
          <Stack
            key={memberId}
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              minHeight: 32,
              py: 0.25,
            }}
          >
            <MemberNameWithRepresentation
              member={member}
              fallback={`#${memberId}`}
              nameSx={{ color: "text.secondary", fontWeight: 500 }}
            />
            <Amount amount={amount} muted={muted} colorMode={amountColorMode} />
          </Stack>
        );
      })}
    </Stack>
  );
}
