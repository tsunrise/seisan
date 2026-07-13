import AccountCircleOutlinedIcon from "@mui/icons-material/AccountCircleOutlined";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import { Box, Button, IconButton, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";

import * as api from "../api";
import { BrandLink } from "../components/BrandLink";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { ledgerColors } from "../theme";
import { loginPath } from "../utils";
import { AccountHome } from "./AccountHome";
import { ApiKeysPage } from "./ApiKeysPage";

const sidebarWidth = 248;

export default function AccountApp() {
  const location = useLocation();
  const user = useCurrentUser({ required: true });

  if (user.status === "loading") {
    return <AccountLoading />;
  }
  if (user.status === "error" || !user.data) {
    return <Navigate to={loginPath(location)} replace />;
  }

  return (
    <AccountShell email={user.data.email}>
      <Routes>
        <Route
          index
          element={
            <AccountHome
              email={user.data.email}
              sessionExpiresAt={user.data.sessionExpiresAt ?? null}
            />
          }
        />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="*" element={<Navigate to="/account" replace />} />
      </Routes>
    </AccountShell>
  );
}

function AccountShell({ email, children }: { email: string; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  function logout() {
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
          component={Link}
          to="/projects"
          variant="text"
          startIcon={<ArrowBackOutlinedIcon />}
          sx={{ justifyContent: "flex-start", mb: 2, px: 1.25 }}
        >
          Projects
        </Button>
        <Stack component="nav" aria-label="Account" spacing={0.5}>
          <AccountNavLink
            to="/account"
            label="Home"
            icon={<HomeOutlinedIcon fontSize="small" />}
            active={location.pathname === "/account"}
          />
          <AccountNavLink
            to="/account/api-keys"
            label="API keys"
            icon={<KeyOutlinedIcon fontSize="small" />}
            active={location.pathname.startsWith("/account/api-keys")}
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
          <IconButton aria-label="Log out" onClick={logout} size="small">
            <LogoutOutlinedIcon fontSize="small" />
          </IconButton>
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
          <BrandLink size="compact" />
          <Stack direction="row" spacing={0.75}>
            <IconButton
              component={Link}
              to="/projects"
              aria-label="Projects"
              size="small"
              sx={{ display: { xs: "inline-flex", sm: "none" } }}
            >
              <ArrowBackOutlinedIcon fontSize="small" />
            </IconButton>
            <Button
              component={Link}
              to="/projects"
              variant="outlined"
              startIcon={<ArrowBackOutlinedIcon fontSize="small" />}
              sx={{ display: { xs: "none", sm: "inline-flex" }, minHeight: 36 }}
            >
              Projects
            </Button>
            <IconButton aria-label="Log out" onClick={logout} size="small">
              <LogoutOutlinedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>
        <Stack component="nav" aria-label="Account" direction="row" sx={{ px: 1.25 }}>
          <MobileNavLink to="/account" label="Home" active={location.pathname === "/account"} />
          <MobileNavLink
            to="/account/api-keys"
            label="API keys"
            active={location.pathname.startsWith("/account/api-keys")}
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
    </Box>
  );
}

function AccountNavLink({
  to,
  label,
  icon,
  active,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Stack
      component={Link}
      to={to}
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

function MobileNavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Box
      component={Link}
      to={to}
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

function AccountLoading() {
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
