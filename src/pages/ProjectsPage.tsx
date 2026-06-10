import AddIcon from "@mui/icons-material/Add";
import LogoutIcon from "@mui/icons-material/Logout";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Fab,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Link, Navigate, useLocation, useNavigate } from "react-router";

import * as api from "../api";
import { Amount } from "../components/Amount";
import { BrandLink } from "../components/BrandLink";
import { InlineAlert } from "../components/InlineAlert";
import { paperFrameSx } from "../components/styles";
import { formatRelativeTime } from "../domain";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useProjects } from "../hooks/useProjects";
import { loginPath } from "../utils";

export function ProjectsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useCurrentUser({ required: true });
  const projects = useProjects(user.status === "ready");
  useDocumentTitle("Seisan");

  if (user.status === "error") {
    return <Navigate to={loginPath(location)} replace />;
  }

  return (
    <Box component="main" sx={{ minHeight: "100svh", p: 3 }}>
      <Stack
        component="header"
        direction={{ xs: "column", sm: "row" }}
        sx={{
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
          gap: { xs: 1.5, sm: 2 },
          width: "min(860px, 100%)",
          mx: "auto",
          mb: 3.5,
        }}
      >
        <Box>
          <BrandLink sx={{ mb: 1 }} />
          <Typography variant="h1" sx={{ whiteSpace: "nowrap" }}>
            Projects
          </Typography>
        </Box>
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            justifyContent: { xs: "space-between", sm: "flex-end" },
            gap: 1.5,
            minWidth: 0,
          }}
        >
          {user.status === "ready" && user.data ? (
            <Chip
              label={user.data.email}
              sx={{
                maxWidth: { xs: "calc(100% - 58px)", sm: 220 },
              }}
            />
          ) : null}
          <IconButton
            aria-label="Log out"
            onClick={() => void api.logout().finally(() => navigate("/login"))}
          >
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>

      <Stack spacing={1.5} sx={{ position: "relative", width: "min(860px, 100%)", mx: "auto" }}>
        {projects.status === "loading" ? <CircularProgress size={24} /> : null}
        {projects.status === "error" ? <InlineAlert>{projects.error}</InlineAlert> : null}
        {projects.status === "ready" && projects.data.length === 0 ? (
          <Paper
            square
            sx={{ ...paperFrameSx, width: "min(520px, 100%)", mx: "auto", mt: 7, p: 3.5 }}
          >
            <Stack spacing={2}>
              <Typography variant="h2">No projects yet</Typography>
              <Typography color="text.secondary">
                Create the first shared book when the group starts spending.
              </Typography>
              <Button
                component={Link}
                to="/projects/new"
                variant="contained"
                startIcon={<AddIcon />}
              >
                Create project
              </Button>
            </Stack>
          </Paper>
        ) : null}
        {projects.status === "ready" && projects.data.length > 0 ? (
          <>
            {projects.data.map((project) => (
              <ProjectListRow key={project.id} project={project} />
            ))}
            <Fab
              component={Link}
              to="/projects/new"
              color="primary"
              aria-label="Create project"
              sx={{ position: "fixed", right: 24, bottom: 24 }}
            >
              <AddIcon />
            </Fab>
          </>
        ) : null}
      </Stack>
    </Box>
  );
}

function ProjectListRow({ project }: { project: api.WithSyncTime<api.ProjectSummary> }) {
  return (
    <Paper
      component={Link}
      to={`/project/${project.id}`}
      square
      sx={{
        ...paperFrameSx,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        p: 2.25,
        color: "inherit",
        textDecoration: "none",
        "&:hover": {
          borderColor: "primary.main",
        },
      }}
    >
      <Box>
        <Typography variant="h2">{project.name}</Typography>
        <Typography color="text.secondary">{project.member?.name ?? "Owner"}</Typography>
      </Box>
      <Box sx={{ textAlign: "right" }}>
        <Amount amount={project.balance} />
        <Typography color="text.secondary" sx={{ fontSize: 13 }}>
          {formatRelativeTime(project.lastSyncAt)}
        </Typography>
      </Box>
    </Paper>
  );
}
