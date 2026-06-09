import { Typography } from "@mui/material";

import { amountTone, formatCents } from "../domain";
import { ledgerColors } from "../theme";

export function Amount({ amount }: { amount: number | null | undefined }) {
  const tone = amountTone(amount);
  const color =
    tone === "owe" ? ledgerColors.red : tone === "owed" ? ledgerColors.green : ledgerColors.ink;

  return (
    <Typography component="span" sx={{ color, fontWeight: 800, whiteSpace: "nowrap" }}>
      {formatCents(amount ?? 0)}
    </Typography>
  );
}
