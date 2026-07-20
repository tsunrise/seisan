import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

import { Amount } from "../components/Amount";

export function TransferTotals({ total }: { total: number }) {
  return (
    <Stack component="section" spacing={0.25}>
      <SummaryRow label="Total amount sent">
        <Amount amount={total} colorMode="plain" />
      </SummaryRow>
    </Stack>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack
      direction="row"
      sx={{ alignItems: "center", justifyContent: "space-between", minHeight: 32, py: 0.25 }}
    >
      <Typography sx={{ color: "text.secondary", fontWeight: 600 }}>{label}</Typography>
      {children}
    </Stack>
  );
}
