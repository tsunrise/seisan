import { ledgerColors } from "../../theme";
import { timelineLayout } from "./timelineLayout";

/**
 * Shared link styling for clickable timeline rows: subtle hover, focus ring, and the selected
 * state with a blue accent border plus a connector dot/line toward the desktop detail panel.
 */
export function timelineRowLinkSx(selected: boolean, accentWidthPx: number) {
  return {
    position: "relative",
    border: `1px solid ${selected ? "rgba(17, 103, 216, 0.15)" : "transparent"}`,
    borderLeft: selected
      ? `${accentWidthPx}px solid ${ledgerColors.blue}`
      : "1px solid transparent",
    bgcolor: selected ? "rgba(238, 246, 255, 0.72)" : "transparent",
    boxShadow: "none",
    color: "inherit",
    cursor: "pointer",
    textDecoration: "none",
    transition: timelineLayout.transition,
    "&::before": selected
      ? {
          content: '""',
          position: "absolute",
          top: "calc(50% - 3px)",
          right: -42,
          display: { xs: "none", md: "block" },
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          bgcolor: ledgerColors.blue,
        }
      : undefined,
    "&::after": selected
      ? {
          content: '""',
          position: "absolute",
          top: "50%",
          right: -38,
          display: { xs: "none", md: "block" },
          width: "38px",
          height: "1px",
          bgcolor: ledgerColors.blue,
        }
      : undefined,
    "&:hover": {
      bgcolor: selected ? "rgba(238, 246, 255, 0.92)" : "rgba(24, 23, 19, 0.025)",
      borderColor: selected ? "rgba(17, 103, 216, 0.22)" : "rgba(24, 23, 19, 0.04)",
    },
    "&:focus-visible": {
      outline: `2px solid ${ledgerColors.blue}`,
      outlineOffset: 3,
    },
  } as const;
}
