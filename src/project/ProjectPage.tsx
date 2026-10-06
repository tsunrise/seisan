import { Box, CircularProgress, useMediaQuery, useTheme } from "@mui/material";
import { useReducer } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { InlineAlert } from "../components/InlineAlert";
import { findLinkedMember } from "../domain";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useProjects } from "../hooks/useProjects";
import { NoAccessPage, NotFoundPage } from "../pages/NotFoundPage";
import { ledgerColors } from "../theme";
import { ProjectHeader } from "./layout/ProjectHeader";
import { ProjectMobileAction } from "./layout/ProjectMobileAction";
import { ProjectRail } from "./layout/ProjectRail";
import { projectPaths, type ProjectPanel } from "./paths";
import { ProjectSidePanel } from "./ProjectSidePanel";
import { RecordTimeline } from "./timeline/RecordTimeline";
import { useCategories } from "./useCategories";
import { useProject } from "./useProject";
import { useRouteRecord } from "./useRouteRecord";

/**
 * Route entry for every `/project/:projectId/*` panel. Mobile shows either the timeline or the
 * active panel; tablet adds the right panel beside the timeline; wide desktop adds the left rail.
 */
export function ProjectPage({ panel }: { panel: ProjectPanel }) {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const projectId = params.projectId ?? "";
  const recordId = params.recordId ? Number(params.recordId) : null;
  const user = useCurrentUser({ required: false });
  const categories = useCategories();
  const [reloadKey, reload] = useReducer((value: number) => value + 1, 0);
  const project = useProject(projectId, reloadKey);
  const registryEnabled = user.status === "ready" && Boolean(user.data);
  const projectSummaries = useProjects(registryEnabled);
  const currentEmail = user.status === "ready" ? (user.data?.email ?? null) : null;
  const timelineIsVisibleOnDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const panelShowsRecord = panel === "recordDetail" || panel === "editRecord";
  const routeRecord = useRouteRecord({
    project: project.status === "ready" ? project.data : null,
    recordId,
    enabled: panelShowsRecord,
  });
  useDocumentTitle(project.status === "ready" ? `${project.data.name} - Seisan` : "Seisan");

  if (project.status === "loading") {
    return (
      <Box component="main" sx={{ minHeight: "100svh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (project.status === "error") {
    if (project.errorCode === "not_found") {
      return <NotFoundPage />;
    }
    if (project.errorCode === "forbidden") {
      return <NoAccessPage />;
    }
    return (
      <Box
        component="main"
        sx={{ minHeight: "100svh", display: "grid", placeItems: "center", p: 3 }}
      >
        <Box sx={{ width: "min(480px, 100%)" }}>
          <InlineAlert>{project.error}</InlineAlert>
        </Box>
      </Box>
    );
  }
  if (routeRecord.notFound) {
    return <NotFoundPage />;
  }

  const currentMember = findLinkedMember(project.data.members, currentEmail);
  const showPanel = panel !== "timeline";
  const categoryData = categories.status === "ready" ? categories.data : [];

  return (
    <Box
      component="main"
      sx={{
        display: { xs: "block", md: "grid" },
        gridTemplateColumns: {
          md: "minmax(0, 520px) minmax(280px, 340px)",
          lg: "minmax(160px, 240px) minmax(0, 610px) minmax(280px, 360px)",
          xl: "minmax(220px, 300px) minmax(0, 680px) minmax(320px, 460px)",
        },
        gap: { md: 2.25, lg: 2 },
        justifyContent: { md: "center" },
        minHeight: "100svh",
        px: { xs: 0, md: 2, xl: 3 },
        pt: 0,
        pb: 0,
      }}
    >
      <Box sx={{ display: { xs: "none", md: "none", lg: "block" } }}>
        <ProjectRail
          project={project.data}
          currentMember={currentMember}
          currentEmail={currentEmail}
          projects={projectSummaries}
          registryEnabled={registryEnabled}
        />
      </Box>
      <Box
        component="section"
        sx={{
          minWidth: 0,
          minHeight: { xs: "100svh", md: "auto" },
          display: { xs: showPanel ? "none" : "block", md: "block" },
          borderInline: { xs: 0, md: `1px solid ${ledgerColors.line}` },
          bgcolor: "background.paper",
        }}
      >
        <ProjectHeader
          project={project.data}
          currentMember={currentMember}
          currentEmail={currentEmail}
          onSettings={() => navigate(projectPaths.settings(projectId))}
        />
        <RecordTimeline
          project={project.data}
          currentMember={currentMember}
          hasMoreRecords={project.data.hasMoreRecords}
          loadingOlderRecords={project.data.loadingOlderRecords}
          onLoadOlderRecords={project.data.loadOlderRecords}
          isActive={panel === "timeline" || timelineIsVisibleOnDesktop}
          scrollToLatestKey={reloadKey}
          restoreScrollKey={panel === "timeline" ? location.key : ""}
          selectedRecordId={panelShowsRecord ? recordId : null}
          categories={categoryData}
        />
        <ProjectMobileAction
          projectId={projectId}
          currentMember={currentMember}
          currentEmail={currentEmail}
        />
      </Box>
      <Box
        component="aside"
        sx={{
          alignSelf: "start",
          position: { xs: "static", md: "sticky" },
          top: { md: 24 },
          maxHeight: { md: "calc(100svh - 48px)" },
          minHeight: { xs: showPanel ? "100svh" : "auto", md: "auto" },
          display: { xs: showPanel ? "block" : "none", md: "block" },
          overflowY: { md: "auto" },
          p: { xs: showPanel ? 2.25 : 0, md: 0 },
          scrollbarGutter: { md: "stable" },
        }}
      >
        <ProjectSidePanel
          panel={panel}
          project={project.data}
          currentEmail={currentEmail}
          currentMember={currentMember}
          userLoading={user.status === "loading"}
          categories={categoryData}
          record={routeRecord.record}
          recordLoading={panelShowsRecord && recordId !== null && routeRecord.record === null}
          onReload={reload}
        />
      </Box>
    </Box>
  );
}
