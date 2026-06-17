import { Typography } from "@mui/material";

import { amountTone, formatCents } from "../domain";
import { ledgerColors } from "../theme";

export type AmountColorMode = "balance" | "plain";

export function Amount({
  amount,
  muted = false,
  colorMode = "balance",
}: {
  amount: number | null | undefined;
  muted?: boolean;
  colorMode?: AmountColorMode;
}) {
  const tone = amountTone(amount);
  const color = muted
    ? ledgerColors.muted
    : colorMode === "plain"
      ? ledgerColors.ink
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
