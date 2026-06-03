import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Button, Paper, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { panelFrameSx } from "./styles";

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
            sx={{ alignSelf: "flex-start", px: 0 }}
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
            sx={{ alignSelf: "flex-start", px: 0 }}
          >
            {title}
          </Button>
        )}
        {children}
      </Stack>
    </Paper>
  );
}
