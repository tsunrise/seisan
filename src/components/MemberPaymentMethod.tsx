import { Typography } from "@mui/material";

import type { ProjectMemberFull } from "../api/types";

export function MemberPaymentMethod({
  member,
  prefix = "Transfer method",
}: {
  member: ProjectMemberFull | null | undefined;
  prefix?: string;
}) {
  if (!member?.config?.paymentMethod) {
    return null;
  }

  return (
    <Typography
      color="text.secondary"
      sx={{ fontSize: 12.5, lineHeight: 1.35, overflowWrap: "anywhere" }}
    >
      {prefix ? `${prefix}: ` : null}
      {member.config.paymentMethod}
    </Typography>
  );
}
