import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

import type * as api from "../api";
import { Amount } from "../components/Amount";
import { memberName } from "../domain";

export function TransferTotals({
  project,
  sourceId,
  total,
}: {
  project: api.Project;
  sourceId: number;
  total: number;
}) {
  const newBalance = (project.balance[String(sourceId)] ?? 0) - total;
  return (
    <Stack component="section" spacing={0.25}>
      <SummaryRow label="Total amount sent">
        <Amount amount={total} colorMode="plain" />
      </SummaryRow>
      <SummaryRow label={`New balance for ${memberName(project.members, sourceId)}`}>
        <Amount amount={newBalance} />
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
