import AddIcon from "@mui/icons-material/Add";
import BlockIcon from "@mui/icons-material/Block";
import PeopleIcon from "@mui/icons-material/People";
import SecurityIcon from "@mui/icons-material/Security";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";

import * as api from "../api";
import { BrandLink } from "../components/BrandLink";
import { InlineAlert } from "../components/InlineAlert";
import { paperFrameSx } from "../components/styles";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useLoadable } from "../hooks/useLoadable";
import { AdminBlockedEmailsPage } from "./AdminBlockedEmailsPage";
import { AdminLimitsPage, AdminUserLimitsRoute } from "./AdminLimitsPage";
import { AdminProjectsPage } from "./AdminProjectsPage";
import { AdminUsersPage } from "./AdminUsersPage";

const sections = [
  { label: "Projects", path: "/admin/projects", icon: <AddIcon fontSize="small" /> },
  { label: "Users", path: "/admin/users", icon: <PeopleIcon fontSize="small" /> },
  { label: "Limits", path: "/admin/limit", icon: <SecurityIcon fontSize="small" /> },
  {
    label: "Blocked emails",
    path: "/admin/blocked-emails",
    icon: <BlockIcon fontSize="small" />,
  },
] as const;

type AdminSection = (typeof sections)[number];

/** Admin shell: verifies admin access, then renders section navigation and the admin routes. */
export default function AdminApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentSection =
    sections.find(
      (section) =>
        location.pathname === section.path || location.pathname.startsWith(`${section.path}/`),
    ) ?? sections[0];
  const identity = useLoadable(api.adminWhoami, "Could not verify admin access.");
  useDocumentTitle("Admin - Seisan");

  return (
    <Box component="main" sx={{ minHeight: "100svh", px: { xs: 2, md: 3 }, py: 3 }}>
      <Stack spacing={3} sx={{ width: "min(1180px, 100%)", mx: "auto" }}>
        <Stack
          component="header"
          direction={{ xs: "column", sm: "row" }}
          sx={{
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
            gap: 2,
          }}
        >
          <Box>
            <BrandLink sx={{ mb: 1 }} />
            <Typography variant="h1">Admin</Typography>
          </Box>
          {identity.status === "ready" ? (
            <Chip
              label={identity.data.local ? "Local admin" : (identity.data.email ?? "Admin")}
              sx={{ alignSelf: { xs: "start", sm: "center" } }}
            />
          ) : null}
        </Stack>

        {identity.status === "loading" ? <CircularProgress size={24} /> : null}
        {identity.status === "error" ? <InlineAlert>{identity.error}</InlineAlert> : null}

        {identity.status === "ready" ? (
          <>
            <FormControl sx={{ display: { xs: "block", md: "none" } }}>
              <InputLabel id="admin-section-label">Section</InputLabel>
              <Select
                labelId="admin-section-label"
                label="Section"
                value={currentSection.path}
                onChange={(event) => navigate(event.target.value)}
                fullWidth
              >
                {sections.map((section) => (
                  <MenuItem key={section.path} value={section.path}>
                    {section.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "220px minmax(0, 1fr)" },
                gap: 2,
              }}
            >
              <AdminNav currentSection={currentSection} />

              <Routes>
                <Route index element={<Navigate to="projects" replace />} />
                <Route path="projects" element={<AdminProjectsPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="limit" element={<AdminLimitsPage target="default" />} />
                <Route path="limit/:email" element={<AdminUserLimitsRoute />} />
                <Route path="blocked-emails" element={<AdminBlockedEmailsPage />} />
                <Route path="*" element={<Navigate to="/admin/projects" replace />} />
              </Routes>
            </Box>
          </>
        ) : null}
      </Stack>
    </Box>
  );
}

function AdminNav({ currentSection }: { currentSection: AdminSection }) {
  return (
    <Paper
      square
      component="nav"
      sx={{ ...paperFrameSx, display: { xs: "none", md: "block" }, alignSelf: "start", p: 1 }}
    >
      <Stack spacing={0.5}>
        {sections.map((section) => (
          <Button
            key={section.path}
            component={Link}
            to={section.path}
            startIcon={section.icon}
            variant={currentSection.path === section.path ? "contained" : "text"}
            sx={{ justifyContent: "flex-start" }}
          >
            {section.label}
          </Button>
        ))}
      </Stack>
    </Paper>
  );
}
