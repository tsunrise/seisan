import AccountCircleOutlinedIcon from "@mui/icons-material/AccountCircleOutlined";
import BalanceOutlinedIcon from "@mui/icons-material/BalanceOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import LaunchIcon from "@mui/icons-material/Launch";
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined";
import { Box, Button, Stack } from "@mui/material";
import { useState } from "react";

import * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PanelFrame } from "../../components/PanelFrame";
import { activeMembers } from "../../domain";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import { REPORT_ISSUE_URL } from "../../sourceRepository";
import { ledgerColors } from "../../theme";
import { projectPaths } from "../paths";
import { SettingsRow } from "./SettingsRow";

/** Project info menu linking to the profile, name, settlement, members, and access pages. */
export function ProjectSettings({
  project,
  currentEmail,
  currentMember,
  onReload,
}: {
  project: api.Project;
  currentEmail: string | null;
  currentMember: api.ProjectMemberFull | null;
  onReload: () => void;
}) {
  const { showError, showSuccess } = useAppSnackbar();
  const [confirmingLeaveProject, setConfirmingLeaveProject] = useState(false);
  const [leavingProject, setLeavingProject] = useState(false);
  const isOwner = currentEmail === project.owner;
  const canLeaveProject = !isOwner && currentMember !== null;
  const memberCount = activeMembers(project.members).length;
  const profileDetails = currentMember
    ? [
        currentMember.config?.paymentMethod || "Add a transfer method",
        currentMember.config?.size && currentMember.config.size > 1
          ? `Represents ${currentMember.config.size} people`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Join this project to create your profile";

  async function leaveProject() {
    if (!canLeaveProject || leavingProject) {
      return;
    }
    setLeavingProject(true);
    try {
      await api.leaveProject(project.id);
      setConfirmingLeaveProject(false);
      onReload();
      showSuccess("Left project.");
    } catch (error) {
      setConfirmingLeaveProject(false);
      showError(getApiErrorMessage(error));
    } finally {
      setLeavingProject(false);
    }
  }

  return (
    <PanelFrame title="Project info" backTo={projectPaths.timeline(project.id)}>
      <Stack spacing={2}>
        {currentMember ? (
          <SettingsRow
            to={projectPaths.settingsProfile(project.id)}
            icon={<AccountCircleOutlinedIcon />}
            title={currentMember.name}
            description={profileDetails}
            large
          />
        ) : null}
        <Box
          component="nav"
          aria-label="Project settings"
          sx={{ borderBlock: `1px solid ${ledgerColors.line}` }}
        >
          <SettingsRow
            to={isOwner ? projectPaths.settingsName(project.id) : undefined}
            icon={<EditOutlinedIcon />}
            title="Project name"
            description={project.name}
          />
          {currentMember ? (
            <SettingsRow
              to={projectPaths.settle(project.id)}
              icon={<BalanceOutlinedIcon />}
              title="Settlement plan"
              description="Review the transfers that clear current balances."
              trailing={<LaunchIcon fontSize="small" />}
            />
          ) : null}
          <SettingsRow
            to={projectPaths.settingsMembers(project.id)}
            icon={<GroupOutlinedIcon />}
            title="Members"
            description={`${memberCount} ${memberCount === 1 ? "member" : "members"}`}
          />
          <SettingsRow
            to={projectPaths.settingsAccess(project.id)}
            icon={<SecurityOutlinedIcon />}
            title="Access control"
            description={project.acl.type === "public" ? "Public project" : "Restricted project"}
          />
        </Box>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
          {canLeaveProject ? (
            <Button
              variant="text"
              color="error"
              disabled={leavingProject}
              onClick={() => setConfirmingLeaveProject(true)}
              sx={{ px: 0.5 }}
            >
              Leave project
            </Button>
          ) : null}
          <Button
            variant="text"
            href={REPORT_ISSUE_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Opens a public GitHub issue. Do not include private project details."
            endIcon={<LaunchIcon fontSize="small" />}
            sx={{ color: "text.secondary", ml: "auto", px: 0.5 }}
          >
            Report an issue
          </Button>
        </Stack>
      </Stack>
      <ConfirmDialog
        open={confirmingLeaveProject}
        title="Leave project?"
        description="This will unlink your email from your member profile. Existing records stay unchanged."
        confirmLabel="Leave project"
        busy={leavingProject}
        onConfirm={() => void leaveProject()}
        onClose={() => setConfirmingLeaveProject(false)}
      />
    </PanelFrame>
  );
}
