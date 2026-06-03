import { Alert } from "@mui/material";
import type { ReactNode } from "react";

export function InlineAlert({ children }: { children: ReactNode }) {
  return (
    <Alert severity="error" variant="outlined" sx={{ borderWidth: 2 }}>
      {children}
    </Alert>
  );
}
