import { Box, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { Link } from "react-router";

import { ledgerColors } from "../theme";

export function BrandLink({
  size = "default",
  to = "/",
  ariaLabel = "Go to Seisan home",
  sx,
}: {
  size?: "default" | "compact";
  to?: string;
  ariaLabel?: string;
  sx?: SxProps<Theme>;
}) {
  const compact = size === "compact";

  return (
    <Stack
      component={Link}
      to={to}
      direction="row"
      aria-label={ariaLabel}
      sx={{
        alignItems: "center",
        color: ledgerColors.ink,
        gap: compact ? 0.5 : 0.75,
        textDecoration: "none",
        ...sx,
      }}
    >
      <Box
        component="img"
        src="/seisan-logo.svg"
        alt=""
        aria-hidden="true"
        sx={{ display: "block", height: compact ? 20 : 28, width: compact ? 20 : 28 }}
      />
      <Typography
        sx={{
          color: "text.secondary",
          fontSize: compact ? 11 : 13,
          fontWeight: 900,
          letterSpacing: compact ? "0.07em" : "0.08em",
          lineHeight: 1,
        }}
      >
        SEISAN
      </Typography>
    </Stack>
  );
}
