import { Box, CircularProgress } from "@mui/material";
import { Navigate } from "react-router";

import type * as api from "../api";
import { JoinPanel } from "./join/JoinPanel";
import { JoinPromptPanel } from "./join/JoinPromptPanel";
import { DesktopPlaceholder } from "./layout/DesktopPlaceholder";
import { projectPaths, type ProjectPanel } from "./paths";
import { EditRecordPanel } from "./records/EditRecordPanel";
import { NewRecordPanel } from "./records/NewRecordPanel";
import { RecordDetail } from "./records/RecordDetail";
import { ProjectAccessSettings } from "./settings/ProjectAccessSettings";
import { ProjectMembersSettings } from "./settings/ProjectMembersSettings";
import { ProjectNameSettings } from "./settings/ProjectNameSettings";
import { ProjectProfileSettings } from "./settings/ProjectProfileSettings";
import { ProjectSettings } from "./settings/ProjectSettings";
import { SettlementPanel } from "./settlement/SettlementPanel";

/** Content of the right-hand panel (or the whole mobile screen) for the active project route. */
export function ProjectSidePanel({
  panel,
  project,
  currentEmail,
  currentMember,
  userLoading,
  categories,
  record,
  recordLoading,
  onReload,
}: {
  panel: ProjectPanel;
  project: api.Project;
  currentEmail: string | null;
  currentMember: api.ProjectMemberFull | null;
  userLoading: boolean;
  categories: api.Category[];
  record: api.ProjectRecord | null;
  recordLoading: boolean;
  onReload: () => void;
}) {
  const joinPrompt = <JoinPromptPanel project={project} currentEmail={currentEmail} />;

  switch (panel) {
    case "timeline":
      return currentMember ? (
        <DesktopPlaceholder project={project} currentMember={currentMember} />
      ) : (
        joinPrompt
      );
    case "join":
      return (
        <JoinPanel
          project={project}
          currentEmail={currentEmail}
          currentMember={currentMember}
          onReload={onReload}
        />
      );
    case "newRecord":
      return (
        <NewRecordPanel
          project={project}
          currentMember={currentMember}
          categories={categories}
          onPosted={onReload}
        />
      );
    case "settle":
      return currentMember ? (
        <SettlementPanel project={project} currentMember={currentMember} onPosted={onReload} />
      ) : (
        joinPrompt
      );
    case "recordDetail":
      if (record) {
        return <RecordDetail project={project} record={record} currentMember={currentMember} />;
      }
      return recordLoading ? <PanelSpinner /> : null;
    case "editRecord":
      if (record) {
        return (
          <EditRecordPanel
            project={project}
            currentMember={currentMember}
            record={record}
            categories={categories}
            onChanged={onReload}
          />
        );
      }
      return recordLoading ? <PanelSpinner /> : null;
    case "settings":
      return (
        <ProjectSettings
          key={`${project.id}:${project.acl.type}`}
          project={project}
          currentEmail={currentEmail}
          currentMember={currentMember}
          onReload={onReload}
        />
      );
    case "settingsProfile":
      return currentMember ? (
        <ProjectProfileSettings
          key={`${project.id}:${currentMember.id}:${JSON.stringify(currentMember.config ?? {})}`}
          project={project}
          currentMember={currentMember}
          onReload={onReload}
        />
      ) : (
        joinPrompt
      );
    case "settingsName":
      if (userLoading) {
        return <PanelSpinner />;
      }
      return currentEmail === project.owner ? (
        <ProjectNameSettings
          key={`${project.id}:${project.name}`}
          project={project}
          onReload={onReload}
        />
      ) : (
        <Navigate to={projectPaths.settings(project.id)} replace />
      );
    case "settingsMembers":
      return (
        <ProjectMembersSettings
          project={project}
          currentEmail={currentEmail}
          currentMember={currentMember}
          onReload={onReload}
        />
      );
    case "settingsAccess":
      return (
        <ProjectAccessSettings
          key={`${project.id}:${project.acl.type}`}
          project={project}
          currentEmail={currentEmail}
          onReload={onReload}
        />
      );
  }
}

function PanelSpinner() {
  return (
    <Box sx={{ display: "grid", minHeight: 240, placeItems: "center" }}>
      <CircularProgress />
    </Box>
  );
}
