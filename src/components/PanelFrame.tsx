import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Button, Paper, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { panelFrameSx } from "./styles";
import { ledgerColors } from "../theme";

const backButtonSx = {
  alignSelf: "flex-start",
  color: ledgerColors.ink,
  fontSize: 18,
  fontWeight: 760,
  minHeight: 36,
  px: 0,
} as const;

/** Standard side panel: the title doubles as a back action to `backTo`, or `onBack` when given. */
export function PanelFrame({
  title,
  backTo,
  onBack,
  children,
}: {
  title: string;
  backTo: string;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <Paper component="section" square sx={{ ...panelFrameSx, minHeight: 360 }}>
      <Stack spacing={2.25}>
        {onBack ? (
          <Button
            type="button"
            variant="text"
            color="inherit"
            startIcon={<ArrowBackIcon />}
            onClick={onBack}
            sx={backButtonSx}
          >
            {title}
          </Button>
        ) : (
          <Button
            component={Link}
            to={backTo}
            variant="text"
            color="inherit"
            startIcon={<ArrowBackIcon />}
            sx={backButtonSx}
          >
            {title}
          </Button>
        )}
        {children}
      </Stack>
    </Paper>
  );
}
