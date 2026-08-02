import AddIcon from "@mui/icons-material/Add";
import { Box, Button, CircularProgress, useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useReducer, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";

import { useCurrentUser } from "../hooks/useCurrentUser";
import { useCategories } from "../hooks/useCategories";
import { useProject } from "../hooks/useProject";
import { useProjects } from "../hooks/useProjects";
import { InlineAlert } from "../components/InlineAlert";
import { DesktopPlaceholder } from "../project/DesktopPlaceholder";
import { EditRecordPanel } from "../project/EditRecordPanel";
import { JoinPanel } from "../project/JoinPanel";
import { JoinPromptPanel } from "../project/JoinPromptPanel";
import { NewRecordPanel } from "../project/NewRecordPanel";
import { ProjectHeader } from "../project/ProjectHeader";
import { ProjectRail } from "../project/ProjectRail";
import { ProjectAccessSettings } from "../project/ProjectAccessSettings";
import { ProjectMembersSettings } from "../project/ProjectMembersSettings";
import { ProjectNameSettings } from "../project/ProjectNameSettings";
import { ProjectProfileSettings } from "../project/ProjectProfileSettings";
import { ProjectSettings } from "../project/ProjectSettings";
import { RecordDetail } from "../project/RecordDetail";
import { RecordTimeline } from "../project/RecordTimeline";
import { SettlementPanel } from "../project/SettlementPanel";
import type { ProjectPanel } from "../types";
import { findLinkedMember } from "../domain";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ledgerColors } from "../theme";
import { loginPath } from "../utils";
import { NoAccessPage, NotFoundPage } from "./NotFoundPage";

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
  const [missingRecordId, setMissingRecordId] = useState<number | null>(null);
  const loadingDetailRecordIdRef = useRef<number | null>(null);
  const project = useProject(projectId, reloadKey);
  const registryEnabled = user.status === "ready" && Boolean(user.data);
  const projectSummaries = useProjects(registryEnabled);
  const currentEmail = user.status === "ready" ? (user.data?.email ?? null) : null;
  const timelineIsVisibleOnDesktop = useMediaQuery(theme.breakpoints.up("md"));
  useDocumentTitle(project.status === "ready" ? `${project.data.name} - Seisan` : "Seisan");
  const projectData = project.status === "ready" ? project.data : null;
  const recordIdIsValid = recordId === null || (Number.isSafeInteger(recordId) && recordId >= 1);
  const selectedRecord =
    projectData && recordId !== null
      ? (projectData.records.find((record) => record.id === recordId) ?? null)
      : null;

  useEffect(() => {
    if (
      (panel !== "recordDetail" && panel !== "editRecord") ||
      recordId === null ||
      !recordIdIsValid ||
      !projectData ||
      selectedRecord
    ) {
      return;
    }

    if (loadingDetailRecordIdRef.current === recordId) {
      return;
    }

    let active = true;
    loadingDetailRecordIdRef.current = recordId;
    setMissingRecordId(null);

    void projectData
      .loadRecord(recordId)
      .then((record) => {
        if (active && !record) {
          setMissingRecordId(recordId);
        }
      })
      .catch(() => {
        if (active) {
          setMissingRecordId(recordId);
        }
      })
      .finally(() => {
        if (loadingDetailRecordIdRef.current === recordId) {
          loadingDetailRecordIdRef.current = null;
        }
      });

    return () => {
      active = false;
    };
  }, [panel, projectData, recordId, recordIdIsValid, selectedRecord]);

  if (project.status === "loading") {
    return (
      <Box component="main" sx={{ minHeight: "100svh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (project.status === "error" && project.errorCode === "not_found") {
    return <NotFoundPage />;
  }
  if (project.status === "error" && project.errorCode === "forbidden") {
    return <NoAccessPage />;
  }
  if (project.status === "error") {
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
  if (
    (panel === "recordDetail" || panel === "editRecord") &&
    recordId !== null &&
    !recordIdIsValid
  ) {
    return <NotFoundPage />;
  }
  if (
    (panel === "recordDetail" || panel === "editRecord") &&
    recordId !== null &&
    missingRecordId === recordId
  ) {
    return <NotFoundPage />;
  }

  const currentMember = findLinkedMember(project.data.members, currentEmail);
  const isOwner = currentEmail === project.data.owner;
  const showPanel = panel !== "timeline";
  const timelineIsVisible = panel === "timeline" || timelineIsVisibleOnDesktop;
  const recordPanelIsLoading =
    (panel === "recordDetail" || panel === "editRecord") &&
    recordId !== null &&
    selectedRecord === null;
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
          selectedRecordId={panel === "recordDetail" || panel === "editRecord" ? recordId : null}
          categories={categoryData}
        />
        <Box
          data-project-mobile-action=""
          sx={{
            position: "fixed",
            right: 16,
            bottom: "calc(16px + env(safe-area-inset-bottom))",
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
              Join Project
            </Button>
          ) : (
            <Button
              component={Link}
              to={loginPath(location)}
              variant="contained"
              fullWidth
              sx={{ minHeight: 56 }}
            >
              Join Project
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
          maxHeight: { md: "calc(100svh - 48px)" },
          minHeight: { xs: showPanel ? "100svh" : "auto", md: "auto" },
          display: { xs: showPanel ? "block" : "none", md: "block" },
          overflowY: { md: "auto" },
          p: { xs: showPanel ? 2.25 : 0, md: 0 },
          scrollbarGutter: { md: "stable" },
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
          <NewRecordPanel
            project={project.data}
            currentMember={currentMember}
            categories={categoryData}
            onPosted={reload}
          />
        ) : null}
        {panel === "settle" ? (
          currentMember ? (
            <SettlementPanel
              project={project.data}
              currentMember={currentMember}
              onPosted={reload}
            />
          ) : (
            <JoinPromptPanel project={project.data} currentEmail={currentEmail} />
          )
        ) : null}
        {panel === "recordDetail" && selectedRecord ? (
          <RecordDetail
            project={project.data}
            record={selectedRecord}
            currentMember={currentMember}
          />
        ) : null}
        {panel === "editRecord" && selectedRecord ? (
          <EditRecordPanel
            project={project.data}
            currentMember={currentMember}
            record={selectedRecord}
            categories={categoryData}
            onChanged={reload}
          />
        ) : null}
        {recordPanelIsLoading ? (
          <Box sx={{ display: "grid", minHeight: 240, placeItems: "center" }}>
            <CircularProgress />
          </Box>
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
        {panel === "settingsProfile" ? (
          currentMember ? (
            <ProjectProfileSettings
              key={`${project.data.id}:${currentMember.id}:${JSON.stringify(currentMember.config ?? {})}`}
              project={project.data}
              currentMember={currentMember}
              onReload={reload}
            />
          ) : (
            <JoinPromptPanel project={project.data} currentEmail={currentEmail} />
          )
        ) : null}
        {panel === "settingsName" ? (
          user.status === "loading" ? (
            <Box sx={{ display: "grid", minHeight: 240, placeItems: "center" }}>
              <CircularProgress />
            </Box>
          ) : isOwner ? (
            <ProjectNameSettings
              key={`${project.data.id}:${project.data.name}`}
              project={project.data}
              onReload={reload}
            />
          ) : (
            <Navigate to={`/project/${projectId}/settings`} replace />
          )
        ) : null}
        {panel === "settingsMembers" ? (
          <ProjectMembersSettings
            project={project.data}
            currentEmail={currentEmail}
            currentMember={currentMember}
            onReload={reload}
          />
        ) : null}
        {panel === "settingsAccess" ? (
          <ProjectAccessSettings
            key={`${project.data.id}:${project.data.acl.type}`}
            project={project.data}
            currentEmail={currentEmail}
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
