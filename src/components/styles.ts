import type { SxProps, Theme } from "@mui/material/styles";

import { ledgerColors } from "../theme";

export const paperFrameSx: SxProps<Theme> = {
  border: `1px solid ${ledgerColors.line}`,
  borderRadius: 1,
  bgcolor: "background.paper",
  boxShadow: "none",
};

export const panelFrameSx: SxProps<Theme> = {
  ...paperFrameSx,
  p: { xs: 2.5, md: 3 },
};

export const pageCenterSx: SxProps<Theme> = {
  minHeight: "100svh",
  display: "grid",
  placeItems: "center",
  p: 3,
};
