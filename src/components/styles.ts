import type { SxProps, Theme } from "@mui/material/styles";

import { ledgerColors } from "../theme";

export const paperFrameSx: SxProps<Theme> = {
  border: `2px solid ${ledgerColors.ink}`,
  bgcolor: "background.paper",
  boxShadow: `5px 5px 0 ${ledgerColors.shadowInk}`,
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
