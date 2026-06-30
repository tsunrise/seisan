import { Box } from "@mui/material";
import type { ReactNode } from "react";

import { ledgerColors } from "../theme";

export function RecordSentenceRow({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: { xs: "grid", sm: "flex" },
        gridTemplateColumns: "1fr",
        alignItems: { xs: "stretch", sm: "center" },
        flexWrap: "wrap",
        gap: { xs: 1, sm: 1.25 },
        p: { xs: 1.25, sm: 1.5 },
        border: `1px solid ${ledgerColors.line}`,
        borderRadius: 1,
        bgcolor: ledgerColors.paperSoft,
      }}
    >
      {children}
    </Box>
  );
}

export function RecordSentenceField({
  children,
  grow = false,
  minWidth = 136,
}: {
  children: ReactNode;
  grow?: boolean;
  minWidth?: number;
}) {
  return (
    <Box
      sx={{
        flex: grow ? "1 1 220px" : `0 1 ${minWidth}px`,
        minWidth: { xs: 0, sm: minWidth },
        width: { xs: "100%", sm: "auto" },
        "& .MuiFormControl-root": {
          width: "100%",
        },
      }}
    >
      {children}
    </Box>
  );
}
