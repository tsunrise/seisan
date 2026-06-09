import type { SxProps, Theme } from "@mui/material/styles";

import { ledgerColors } from "../theme";

export const paperFrameSx: SxProps<Theme> = {
  border: `1px solid ${ledgerColors.line}`,
  borderRadius: 2.5,
  bgcolor: "background.paper",
  boxShadow: `0 6px 18px ${ledgerColors.shadowInk}`,
};

export const panelFrameSx: SxProps<Theme> = {
  ...paperFrameSx,
  p: 2.75,
};

export const pageCenterSx: SxProps<Theme> = {
  minHeight: "100svh",
  display: "grid",
  placeItems: "center",
  p: 3,
};
