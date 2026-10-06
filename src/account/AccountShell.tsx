import AccountCircleOutlinedIcon from "@mui/icons-material/AccountCircleOutlined";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import { Box, Button, IconButton, Skeleton, Stack, Typography } from "@mui/material";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import * as api from "../api";
import { BrandLink } from "../components/BrandLink";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ledgerColors } from "../theme";
import type { AccountBackTarget, AccountLinkState } from "./navigation";

const sidebarWidth = 248;

/**
 * Account chrome: a fixed navigation rail on wide screens and a sticky header with tabs below
 * that. The back action pops to the page that linked here, or falls back to `/projects`.
 */
export function AccountShell({
  email,
  backTarget,
  navigationState,
  children,
}: {
  email: string;
  backTarget: AccountBackTarget | null;
  navigationState: AccountLinkState | undefined;
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const backLabel = backTarget?.label ?? "Projects";

  function goBack() {
    if (backTarget) {
      navigate(-1);
      return;
    }

    navigate("/projects");
  }

  function confirmLogout() {
    setLoggingOut(true);
    void api.logout().finally(() => navigate("/login"));
  }

  return (
    <Box sx={{ minHeight: "100svh", bgcolor: ledgerColors.paperBg }}>
      <Box
        component="aside"
        sx={{
          display: { xs: "none", lg: "flex" },
          flexDirection: "column",
          position: "fixed",
          inset: 0,
          right: "auto",
          width: sidebarWidth,
          borderRight: `1px solid ${ledgerColors.line}`,
          bgcolor: ledgerColors.paper,
          px: 2.25,
          py: 2.5,
          zIndex: 10,
        }}
      >
        <BrandLink sx={{ mb: 2.5 }} />
        <Button
          onClick={goBack}
          aria-label={`Back to ${backLabel}`}
          variant="text"
          startIcon={<ArrowBackOutlinedIcon />}
          sx={{ justifyContent: "flex-start", width: "100%", mb: 2, px: 1.25 }}
        >
          <Typography component="span" noWrap title={backLabel} sx={{ minWidth: 0 }}>
            {backLabel}
          </Typography>
        </Button>
        <Stack component="nav" aria-label="Account" spacing={0.5}>
          <AccountNavLink
            to="/account"
            label="Home"
            icon={<HomeOutlinedIcon fontSize="small" />}
            active={location.pathname === "/account"}
            navigationState={navigationState}
          />
          <AccountNavLink
            to="/account/api-keys"
            label="API keys"
            icon={<KeyOutlinedIcon fontSize="small" />}
            active={location.pathname.startsWith("/account/api-keys")}
            navigationState={navigationState}
          />
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            gap: 1,
            borderTop: `1px solid ${ledgerColors.line}`,
            pt: 2,
          }}
        >
          <AccountCircleOutlinedIcon color="action" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 800 }}>Account</Typography>
            <Typography color="text.secondary" noWrap sx={{ fontSize: 12.5 }} title={email}>
              {email}
            </Typography>
          </Box>
          <LogoutButton onClick={() => setConfirmingLogout(true)} />
        </Stack>
      </Box>

      <Box
        component="header"
        sx={{
          display: { xs: "block", lg: "none" },
          position: "sticky",
          top: 0,
          zIndex: 10,
          borderBottom: `1px solid ${ledgerColors.line}`,
          bgcolor: ledgerColors.paper,
        }}
      >
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between", px: 2, py: 1.5 }}
        >
          <BrandLink size="compact" sx={{ flexShrink: 0 }} />
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ minWidth: 0, maxWidth: { xs: "calc(100% - 116px)", sm: "none" } }}
          >
            <Button
              onClick={goBack}
              aria-label={`Back to ${backLabel}`}
              variant="outlined"
              startIcon={<ArrowBackOutlinedIcon fontSize="small" />}
              sx={{
                flexShrink: 1,
                minWidth: 0,
                maxWidth: { xs: "min(52vw, 220px)", sm: "min(42vw, 260px)" },
                minHeight: 36,
                px: { xs: 1.25, sm: 1.75 },
              }}
            >
              <Typography component="span" noWrap title={backLabel} sx={{ minWidth: 0 }}>
                {backLabel}
              </Typography>
            </Button>
            <LogoutButton onClick={() => setConfirmingLogout(true)} />
          </Stack>
        </Stack>
        <Stack component="nav" aria-label="Account" direction="row" sx={{ px: 1.25 }}>
          <MobileNavLink
            to="/account"
            label="Home"
            active={location.pathname === "/account"}
            navigationState={navigationState}
          />
          <MobileNavLink
            to="/account/api-keys"
            label="API keys"
            active={location.pathname.startsWith("/account/api-keys")}
            navigationState={navigationState}
          />
        </Stack>
      </Box>

      <Box
        component="main"
        id="account-content"
        sx={{
          ml: { xs: 0, lg: `${sidebarWidth}px` },
          minHeight: "100svh",
          px: { xs: 2, sm: 3.5, lg: 6 },
          py: { xs: 3.5, md: 5.5, lg: 7 },
        }}
      >
        <Box sx={{ width: "min(980px, 100%)", mx: "auto" }}>{children}</Box>
      </Box>

      <ConfirmDialog
        open={confirmingLogout}
        title="Log out?"
        description="This will end your current session. You’ll need to sign in again to access your account."
        confirmLabel={loggingOut ? "Logging out…" : "Log out"}
        busy={loggingOut}
        maxWidth="xs"
        onConfirm={confirmLogout}
        onClose={() => setConfirmingLogout(false)}
      />
    </Box>
  );
}

function AccountNavLink({
  to,
  label,
  icon,
  active,
  navigationState,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  navigationState: AccountLinkState | undefined;
}) {
  return (
    <Stack
      component={Link}
      to={to}
      replace
      state={navigationState}
      direction="row"
      aria-current={active ? "page" : undefined}
      sx={{
        alignItems: "center",
        gap: 1.25,
        minHeight: 44,
        px: 1.25,
        borderLeft: `2px solid ${active ? ledgerColors.blue : "transparent"}`,
        borderRadius: 1,
        bgcolor: active ? ledgerColors.blueSoft : "transparent",
        color: active ? ledgerColors.blueDark : ledgerColors.ink,
        fontWeight: active ? 800 : 650,
        textDecoration: "none",
        transition: "background-color 160ms ease, color 160ms ease",
        "&:hover": { bgcolor: active ? ledgerColors.blueSoft : "rgba(24, 23, 19, 0.04)" },
        "&:focus-visible": { outline: `2px solid ${ledgerColors.blue}`, outlineOffset: 2 },
      }}
    >
      {icon}
      <Typography sx={{ fontSize: 14.5, fontWeight: "inherit" }}>{label}</Typography>
    </Stack>
  );
}

function MobileNavLink({
  to,
  label,
  active,
  navigationState,
}: {
  to: string;
  label: string;
  active: boolean;
  navigationState: AccountLinkState | undefined;
}) {
  return (
    <Box
      component={Link}
      to={to}
      replace
      state={navigationState}
      aria-current={active ? "page" : undefined}
      sx={{
        position: "relative",
        minWidth: 96,
        px: 1.5,
        py: 1.2,
        color: active ? ledgerColors.ink : ledgerColors.muted,
        fontSize: 14,
        fontWeight: active ? 800 : 650,
        textAlign: "center",
        textDecoration: "none",
        "&::after": {
          content: '""',
          position: "absolute",
          right: 10,
          bottom: -1,
          left: 10,
          height: 2,
          bgcolor: active ? ledgerColors.blue : "transparent",
        },
        "&:focus-visible": { outline: `2px solid ${ledgerColors.blue}`, outlineOffset: -2 },
      }}
    >
      {label}
    </Box>
  );
}

function LogoutButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton aria-label="Log out" onClick={onClick} size="small" sx={{ flexShrink: 0 }}>
      <LogoutOutlinedIcon fontSize="small" />
    </IconButton>
  );
}

export function AccountLoading() {
  return (
    <Box sx={{ minHeight: "100svh", bgcolor: ledgerColors.paperBg }}>
      <Box
        sx={{
          display: { xs: "none", lg: "block" },
          position: "fixed",
          inset: 0,
          right: "auto",
          width: sidebarWidth,
          borderRight: `1px solid ${ledgerColors.line}`,
          bgcolor: ledgerColors.paper,
          p: 2.5,
        }}
      >
        <Skeleton width={110} height={32} />
        <Skeleton width="100%" height={46} sx={{ mt: 4 }} />
        <Skeleton width="100%" height={46} />
      </Box>
      <Box
        sx={{
          ml: { xs: 0, lg: `${sidebarWidth}px` },
          width: { xs: "auto", lg: `calc(100% - ${sidebarWidth}px)` },
          px: { xs: 2, md: 6 },
          py: { xs: 4, md: 7 },
        }}
      >
        <Box sx={{ width: "min(980px, 100%)", mx: "auto" }}>
          <Skeleton width="42%" height={66} />
          <Skeleton width="68%" height={28} />
          <Skeleton variant="rectangular" height={190} sx={{ mt: 5 }} />
        </Box>
      </Box>
    </Box>
  );
}
