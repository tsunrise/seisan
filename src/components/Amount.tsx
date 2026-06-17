import { Typography } from "@mui/material";

import { amountTone, formatCents } from "../domain";
import { ledgerColors } from "../theme";

export function Amount({
  amount,
  muted = false,
}: {
  amount: number | null | undefined;
  muted?: boolean;
}) {
  const tone = amountTone(amount);
  const color = muted
    ? ledgerColors.muted
    : tone === "owe"
      ? ledgerColors.red
      : tone === "owed"
        ? ledgerColors.green
        : ledgerColors.ink;

  return (
    <Typography
      component="span"
      sx={{
        color,
        fontWeight: 800,
        textDecoration: muted ? "line-through" : "none",
        whiteSpace: "nowrap",
      }}
    >
      {formatCents(amount ?? 0)}
    </Typography>
  );
}
