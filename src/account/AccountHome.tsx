import ArrowForwardOutlinedIcon from "@mui/icons-material/ArrowForwardOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import { Box, Divider, Stack, Typography } from "@mui/material";
import { Link } from "react-router";

import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ledgerColors, ledgerFonts } from "../theme";
import type { AccountLinkState } from "./navigation";

const sessionExpirationFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "long",
  timeStyle: "short",
});

export function AccountHome({
  email,
  sessionExpiresAt,
  navigationState,
}: {
  email: string;
  sessionExpiresAt: number | null;
  navigationState: AccountLinkState | undefined;
}) {
  useDocumentTitle("Account - Seisan");

  return (
    <Stack spacing={{ xs: 4.5, md: 6 }}>
      <Box component="header">
        <Typography
          component="h1"
          sx={{
            fontFamily: ledgerFonts.serif,
            fontSize: { xs: "2.55rem", md: "3.35rem" },
            fontWeight: 500,
            letterSpacing: "-0.045em",
            lineHeight: 1,
          }}
        >
          Account
        </Typography>
      </Box>

      <Box component="section" aria-labelledby="account-details-title">
        <Typography id="account-details-title" variant="h2" sx={{ mb: 2 }}>
          Account details
        </Typography>
        <Box sx={{ borderBlock: `1px solid ${ledgerColors.line}` }}>
          <DetailRow label="Email" value={email} />
          <Divider />
          <DetailRow
            label="Session expires"
            value={
              sessionExpiresAt === null
                ? "Not available"
                : sessionExpirationFormatter.format(new Date(sessionExpiresAt * 1000))
            }
          />
        </Box>
      </Box>

      <Box component="section" aria-labelledby="account-destinations-title">
        <Typography id="account-destinations-title" variant="h2" sx={{ mb: 2 }}>
          Go to
        </Typography>
        <Box sx={{ borderBlock: `1px solid ${ledgerColors.line}` }}>
          <DestinationRow
            to="/projects"
            icon={<FolderOutlinedIcon />}
            title="Projects"
            description="Return to your shared books and balances."
          />
          <Divider />
          <DestinationRow
            to="/account/api-keys"
            icon={<KeyOutlinedIcon />}
            title="API keys"
            description="Create and revoke credentials for API clients."
            replace
            navigationState={navigationState}
          />
        </Box>
      </Box>
    </Stack>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "minmax(130px, 0.35fr) 1fr" },
        gap: { xs: 0.75, sm: 3 },
        px: { xs: 0.5, sm: 1 },
        py: 2.25,
      }}
    >
      <Typography color="text.secondary" sx={{ fontSize: 13, fontWeight: 750 }}>
        {label}
      </Typography>
      <Box sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{value}</Box>
    </Box>
  );
}

function DestinationRow({
  to,
  icon,
  title,
  description,
  replace = false,
  navigationState,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  replace?: boolean;
  navigationState?: AccountLinkState;
}) {
  return (
    <Stack
      component={Link}
      to={to}
      replace={replace}
      state={navigationState}
      direction="row"
      sx={{
        alignItems: "center",
        gap: 2,
        px: { xs: 0.5, sm: 1 },
        py: 2.25,
        color: "inherit",
        textDecoration: "none",
        transition: "background-color 160ms ease",
        "&:hover": { bgcolor: "rgba(24, 23, 19, 0.035)" },
        "&:focus-visible": { outline: `2px solid ${ledgerColors.blue}`, outlineOffset: 2 },
      }}
    >
      <Box sx={{ display: "grid", placeItems: "center", color: "text.secondary" }}>{icon}</Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 800 }}>{title}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.25, fontSize: 13.5 }}>
          {description}
        </Typography>
      </Box>
      <ArrowForwardOutlinedIcon color="action" fontSize="small" />
    </Stack>
  );
}
