import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Button } from "@mui/material";
import { Link } from "react-router";

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Button
      component={Link}
      to={to}
      variant="text"
      color="inherit"
      startIcon={<ArrowBackIcon />}
      sx={{ mb: 2.25, px: 0, fontWeight: 900 }}
    >
      {label}
    </Button>
  );
}
