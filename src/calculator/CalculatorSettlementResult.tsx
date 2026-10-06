import { Alert, Box, Divider, Paper, Stack, Typography } from "@mui/material";

import { paperFrameSx } from "../components/styles";
import { formatCents } from "../domain";
import { ledgerColors, ledgerFonts } from "../theme";
import type { CalculatorDraft, CalculatorPlan } from "./groupExpenseCalculator";

/** The computed transfer plan only; marketing copy lives in the landing sections below. */
export function CalculatorSettlementResult({
  plan,
  draft,
}: {
  plan: CalculatorPlan;
  draft: CalculatorDraft;
}) {
  const names = new Map(draft.members.map((member) => [member.id, member.name]));
  const transfers = plan.transfers.flatMap((batch) =>
    batch.dests.map((destination) => ({
      src: batch.src,
      dest: destination.id,
      amount: destination.amount,
    })),
  );

  return (
    <Paper
      square
      aria-live="polite"
      sx={{
        ...paperFrameSx,
        overflow: "hidden",
        borderColor: ledgerColors.blue,
      }}
    >
      <Box sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Typography variant="h2" sx={{ fontFamily: ledgerFonts.serif }}>
          Settlement plan
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
          Total shared: {formatCents(plan.totalPaid)}
        </Typography>
        {transfers.length === 0 ? (
          <Alert severity="success" variant="outlined">
            Everyone is settled. No transfers are needed.
          </Alert>
        ) : (
          <Stack spacing={0} divider={<Divider flexItem />}>
            {transfers.map((transfer) => (
              <Box
                key={`${transfer.src}:${transfer.dest}`}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 2,
                  alignItems: "center",
                  py: 1.75,
                }}
              >
                <Typography sx={{ fontWeight: 750 }}>
                  {names.get(transfer.src) ?? `#${transfer.src}`} should pay{" "}
                  {names.get(transfer.dest) ?? `#${transfer.dest}`}
                </Typography>
                <Typography sx={{ color: ledgerColors.blueDark, fontWeight: 900 }}>
                  {formatCents(transfer.amount)}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
