import { Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

import type * as api from "../api";
import { memberSize } from "../domain";

export function MemberNameWithRepresentation({
  member,
  fallback = "Unknown member",
  nameSx,
}: {
  member: api.ProjectMemberFull | null | undefined;
  fallback?: string;
  nameSx?: SxProps<Theme>;
}) {
  const representedPeople = member ? memberSize(member) : 1;
  const additionalPeople = representedPeople - 1;

  return (
    <Stack component="span" direction="row" sx={{ alignItems: "center", gap: 0.55, minWidth: 0 }}>
      <Typography component="span" sx={nameSx}>
        {member?.name ?? fallback}
      </Typography>
      {additionalPeople > 0 ? (
        <Typography
          component="span"
          aria-label={`Represents ${additionalPeople} additional ${additionalPeople === 1 ? "person" : "people"}`}
          title={`Represents ${representedPeople} people`}
          sx={{
            color: "text.secondary",
            flex: "0 0 auto",
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 750,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          +{additionalPeople}
        </Typography>
      ) : null}
    </Stack>
  );
}
