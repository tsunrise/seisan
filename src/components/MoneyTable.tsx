import { Stack, Typography } from "@mui/material";

import type * as api from "../api";
import { memberName } from "../domain";
import { ledgerColors } from "../theme";
import { Amount, type AmountColorMode } from "./Amount";

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
      {entries.map(([memberId, amount]) => (
        <Stack
          key={memberId}
          direction="row"
          sx={{
            alignItems: "center",
            borderBottom: `1px solid ${ledgerColors.line}`,
            justifyContent: "space-between",
            minHeight: 38,
            py: 0.5,
            "&:last-of-type": {
              borderBottom: 0,
            },
          }}
        >
          <Typography sx={{ color: "text.secondary", fontWeight: 500 }}>
            {memberName(project.members, Number(memberId))}
          </Typography>
          <Amount amount={amount} muted={muted} colorMode={amountColorMode} />
        </Stack>
      ))}
    </Stack>
  );
}
