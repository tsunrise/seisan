import CheckOutlinedIcon from "@mui/icons-material/CheckOutlined";
import { Box, Stack, Typography } from "@mui/material";

import { ledgerColors } from "../../theme";

/** Completion state for a settled project, or for a settled member while others still owe. */
export function SettlementComplete({ scope }: { scope: "member" | "project" }) {
  const projectIsSettled = scope === "project";

  return (
    <Stack
      role="status"
      sx={{ alignItems: "center", justifyContent: "center", minHeight: 230, px: 2, py: 4 }}
    >
      <Box
        sx={{
          alignItems: "center",
          bgcolor: ledgerColors.paperSoft,
          border: `1px solid ${ledgerColors.line}`,
          borderRadius: "50%",
          color: "success.main",
          display: "flex",
          height: 72,
          justifyContent: "center",
          mb: 2.25,
          width: 72,
        }}
      >
        <CheckOutlinedIcon sx={{ fontSize: 40 }} />
      </Box>
      <Typography variant="h2" sx={{ mb: 0.75, textAlign: "center" }}>
        {projectIsSettled ? "Everyone is settled" : "You're settled"}
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 280, textAlign: "center" }}>
        {projectIsSettled
          ? "All balances are clear. No transfers are needed."
          : "Your balance is clear. No transfers are needed from you."}
      </Typography>
    </Stack>
  );
}
