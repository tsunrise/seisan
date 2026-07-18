import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import { Box, Stack, Typography } from "@mui/material";

import type * as api from "../api";
import { formatCents, memberName } from "../domain";
import { ledgerColors } from "../theme";

export interface SettlementPayment {
  memberId: number;
  amount: number;
}

export function SettlementPaymentList({
  project,
  payments,
  title,
  direction = "outgoing",
}: {
  project: api.Project;
  payments: SettlementPayment[];
  title: string;
  direction?: "incoming" | "outgoing";
}) {
  const incoming = direction === "incoming";

  return (
    <Stack component="section" spacing={1} aria-label={title}>
      <Typography variant="h3">{title}</Typography>
      <Box>
        {payments.map((payment) => (
          <Stack
            key={payment.memberId}
            direction="row"
            sx={{
              alignItems: "center",
              gap: 1.25,
              justifyContent: "space-between",
              minHeight: 72,
              py: 1.25,
            }}
          >
            <Stack direction="row" sx={{ alignItems: "center", gap: 1.25, minWidth: 0 }}>
              <Box
                sx={{
                  alignItems: "center",
                  bgcolor: incoming ? ledgerColors.paperSoft : ledgerColors.blueSoft,
                  border: `1px solid ${incoming ? ledgerColors.green : ledgerColors.line}`,
                  borderRadius: "50%",
                  color: incoming ? ledgerColors.green : ledgerColors.blue,
                  display: "flex",
                  flex: "0 0 auto",
                  height: 38,
                  justifyContent: "center",
                  width: 38,
                }}
              >
                {incoming ? (
                  <ArrowBackRoundedIcon fontSize="small" />
                ) : (
                  <ArrowForwardRoundedIcon fontSize="small" />
                )}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    color: "text.secondary",
                    fontSize: 11,
                    fontWeight: 850,
                    letterSpacing: "0.07em",
                    lineHeight: 1.2,
                    textTransform: "uppercase",
                  }}
                >
                  {incoming ? "Receive from" : "Transfer to"}
                </Typography>
                <Typography noWrap sx={{ fontSize: 17, fontWeight: 760, mt: 0.2 }}>
                  {memberName(project.members, payment.memberId)}
                </Typography>
              </Box>
            </Stack>
            <Typography
              sx={{
                flex: "0 0 auto",
                fontSize: { xs: 20, sm: 22 },
                fontVariantNumeric: "tabular-nums",
                fontWeight: 820,
                letterSpacing: "-0.025em",
                ...(incoming ? { color: ledgerColors.green } : {}),
              }}
            >
              {formatCents(payment.amount)}
            </Typography>
          </Stack>
        ))}
      </Box>
    </Stack>
  );
}
