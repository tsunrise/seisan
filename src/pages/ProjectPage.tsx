import AddIcon from "@mui/icons-material/Add";
import { Box, Button, CircularProgress, useMediaQuery, useTheme } from "@mui/material";
import { useReducer } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { useCurrentUser } from "../hooks/useCurrentUser";
import { useProject } from "../hooks/useProject";
import { DesktopPlaceholder } from "../project/DesktopPlaceholder";
import { JoinPanel } from "../project/JoinPanel";
import { JoinPromptPanel } from "../project/JoinPromptPanel";
import { NewRecordPanel } from "../project/NewRecordPanel";
import { ProjectHeader } from "../project/ProjectHeader";
import { ProjectRail } from "../project/ProjectRail";
import { ProjectSettings } from "../project/ProjectSettings";
import { RecordDetail } from "../project/RecordDetail";
import { RecordTimeline } from "../project/RecordTimeline";
import type { ProjectPanel } from "../types";
import { findLinkedMember } from "../domain";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ledgerColors } from "../theme";
import { loginPath } from "../utils";
import { NotFoundPage } from "./NotFoundPage";

export function ProjectPage({ panel }: { panel: ProjectPanel }) {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const projectId = params.projectId ?? "";
  const recordId = params.recordId ? Number(params.recordId) : null;
  const user = useCurrentUser({ required: false });
  const [reloadKey, reload] = useReducer((value: number) => value + 1, 0);
  const project = useProject(projectId, reloadKey);
  const currentEmail = user.status === "ready" ? (user.data?.email ?? null) : null;
  const timelineIsVisibleOnDesktop = useMediaQuery(theme.breakpoints.up("md"));
  useDocumentTitle(project.status === "ready" ? `${project.data.name} - Seisan` : "Seisan");

  if (project.status === "loading") {
    return (
      <Box component="main" sx={{ minHeight: "100svh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (project.status === "error") {
    return <NotFoundPage />;
  }

  const currentMember = findLinkedMember(project.data.members, currentEmail);
  const selectedRecord =
    recordId === null
      ? null
      : (project.data.records.find((record) => record.id === recordId) ?? null);
  const showPanel = panel !== "timeline";
  const timelineIsVisible = panel === "timeline" || timelineIsVisibleOnDesktop;

  return (
    <Box
      component="main"
      sx={{
        display: { xs: "block", md: "grid" },
        gridTemplateColumns: {
          md: "minmax(0, 520px) minmax(300px, 400px)",
          lg: "minmax(180px, 260px) minmax(0, 520px) minmax(300px, 400px)",
          xl: "minmax(220px, 300px) minmax(0, 680px) minmax(320px, 460px)",
        },
        gap: { md: 2.25, lg: 3 },
        justifyContent: { md: "center" },
        minHeight: "100svh",
        px: { xs: 0, md: 3 },
        pt: 0,
        pb: 0,
      }}
    >
      <Box sx={{ display: { xs: "none", md: "none", lg: "block" } }}>
        <ProjectRail project={project.data} currentMember={currentMember} />
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
          onSettings={() => navigate(`/project/${projectId}/settings`)}
        />
        <RecordTimeline
          project={project.data}
          currentMember={currentMember}
          hasMoreRecords={project.data.hasMoreRecords}
          loadingOlderRecords={project.data.loadingOlderRecords}
          onLoadOlderRecords={project.data.loadOlderRecords}
          isActive={timelineIsVisible}
          scrollToLatestKey={reloadKey}
          restoreScrollKey={panel === "timeline" ? location.key : ""}
        />
        <Box
          sx={{
            position: "fixed",
            right: 16,
            bottom: 16,
            left: 16,
            zIndex: 8,
            display: { xs: "block", md: "none" },
          }}
        >
          {currentMember ? (
            <Button
              component={Link}
              to={`/project/${projectId}/records/new`}
              variant="contained"
              startIcon={<AddIcon />}
              fullWidth
              sx={{ minHeight: 56 }}
            >
              Post record
            </Button>
          ) : currentEmail ? (
            <Button
              component={Link}
              to={`/project/${projectId}/join`}
              variant="contained"
              fullWidth
              sx={{ minHeight: 56 }}
            >
              Join to post
            </Button>
          ) : (
            <Button
              component={Link}
              to={loginPath(location)}
              variant="contained"
              fullWidth
              sx={{ minHeight: 56 }}
            >
              Join to post
            </Button>
          )}
        </Box>
      </Box>
      <Box
        component="aside"
        sx={{
          alignSelf: "start",
          position: { xs: "static", md: "sticky" },
          top: { md: 24 },
          minHeight: { xs: showPanel ? "100svh" : "auto", md: "auto" },
          display: { xs: showPanel ? "block" : "none", md: "block" },
          p: { xs: showPanel ? 2.25 : 0, md: 0 },
        }}
      >
        {panel === "join" ? (
          <JoinPanel
            project={project.data}
            currentEmail={currentEmail}
            currentMember={currentMember}
            onReload={reload}
          />
        ) : null}
        {panel === "newRecord" ? (
          <NewRecordPanel project={project.data} currentMember={currentMember} onPosted={reload} />
        ) : null}
        {panel === "recordDetail" && selectedRecord ? (
          <RecordDetail
            project={project.data}
            record={selectedRecord}
            canPost={Boolean(currentMember)}
            onPosted={reload}
          />
        ) : null}
        {panel === "settings" ? (
          <ProjectSettings
            key={`${project.data.id}:${project.data.acl.type}`}
            project={project.data}
            currentEmail={currentEmail}
            currentMember={currentMember}
            onReload={reload}
          />
        ) : null}
        {panel === "timeline" ? (
          currentMember ? (
            <DesktopPlaceholder project={project.data} currentMember={currentMember} />
          ) : (
            <JoinPromptPanel project={project.data} currentEmail={currentEmail} />
          )
        ) : null}
      </Box>
    </Box>
  );
}
