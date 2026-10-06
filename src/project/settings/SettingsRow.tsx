import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { Box, ButtonBase, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { ledgerColors } from "../../theme";

/**
 * iOS-style settings row: leading icon, title and description, trailing chevron. Without `to` the
 * row is read-only. `large` is the profile header row.
 */
export function SettingsRow({
  to,
  icon,
  title,
  description,
  trailing,
  large = false,
}: {
  to?: string;
  icon: ReactNode;
  title: string;
  description: string;
  trailing?: ReactNode;
  large?: boolean;
}) {
  const content = (
    <>
      <Stack
        sx={{
          alignItems: "center",
          bgcolor: large ? ledgerColors.blueSoft : ledgerColors.paperSoft,
          border: `1px solid ${ledgerColors.line}`,
          borderRadius: 1,
          color: large ? ledgerColors.blue : ledgerColors.ink,
          height: large ? 52 : 38,
          justifyContent: "center",
          width: large ? 52 : 38,
          "& .MuiSvgIcon-root": { fontSize: large ? 30 : 22 },
        }}
      >
        {icon}
      </Stack>
      <Stack sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: large ? 18 : 16, fontWeight: 780 }}>{title}</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 13, lineHeight: 1.35 }}>
          {description}
        </Typography>
      </Stack>
      <Box sx={{ color: "text.secondary", display: "flex", justifyContent: "flex-end" }}>
        {trailing ?? (to ? <ChevronRightIcon fontSize="small" /> : null)}
      </Box>
    </>
  );

  const rowSx = {
    display: "grid",
    gridTemplateColumns: `${large ? 52 : 38}px minmax(0, 1fr) 24px`,
    gap: 1.5,
    minHeight: large ? 88 : 68,
    px: large ? 1.5 : 1,
    py: 1.25,
    textAlign: "left",
    width: "100%",
    border: large ? `1px solid ${ledgerColors.line}` : 0,
    borderBottom: `1px solid ${ledgerColors.line}`,
    "&:last-child": { borderBottom: 0 },
  } as const;

  if (!to) {
    return <Box sx={rowSx}>{content}</Box>;
  }

  return (
    <ButtonBase
      component={Link}
      to={to}
      sx={{
        ...rowSx,
        "&:hover": { bgcolor: "rgba(24, 23, 19, 0.035)" },
        "&:focus-visible": {
          outline: `2px solid ${ledgerColors.blue}`,
          outlineOffset: 2,
        },
      }}
    >
      {content}
    </ButtonBase>
  );
}
