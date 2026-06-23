import { Typography } from "@mui/material";

export function RecordFormBridge({ children }: { children: string }) {
  return (
    <Typography
      color="text.secondary"
      sx={{
        alignSelf: "center",
        fontSize: 13,
        fontWeight: 650,
        lineHeight: 1.2,
        px: { xs: 1.5, sm: 0 },
        py: { xs: 0, sm: 1.25 },
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Typography>
  );
}
