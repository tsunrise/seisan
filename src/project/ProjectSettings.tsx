import AccountCircleOutlinedIcon from "@mui/icons-material/AccountCircleOutlined";
import BalanceOutlinedIcon from "@mui/icons-material/BalanceOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import LaunchIcon from "@mui/icons-material/Launch";
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined";
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router";

import type * as api from "../api";
import * as projectApi from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { PanelFrame } from "../components/PanelFrame";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { ledgerColors } from "../theme";

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
  const activeMembers = project.members.filter((member) => !member.deleted);
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
      await projectApi.leaveProject(project.id);
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
    <PanelFrame title="Project info" backTo={`/project/${project.id}`}>
      <Stack spacing={2}>
        {currentMember ? (
          <SettingsRow
            to={`/project/${project.id}/settings/profile`}
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
            to={isOwner ? `/project/${project.id}/settings/name` : undefined}
            icon={<EditOutlinedIcon />}
            title="Project name"
            description={project.name}
          />
          {currentMember ? (
            <SettingsRow
              to={`/project/${project.id}/settle`}
              icon={<BalanceOutlinedIcon />}
              title="Settlement plan"
              description="Review the transfers that clear current balances."
              trailing={<LaunchIcon fontSize="small" />}
            />
          ) : null}
          <SettingsRow
            to={`/project/${project.id}/settings/members`}
            icon={<GroupOutlinedIcon />}
            title="Members"
            description={`${activeMembers.length} ${activeMembers.length === 1 ? "member" : "members"}`}
          />
          <SettingsRow
            to={`/project/${project.id}/settings/access`}
            icon={<SecurityOutlinedIcon />}
            title="Access control"
            description={project.acl.type === "public" ? "Public project" : "Restricted project"}
          />
        </Box>
        {canLeaveProject ? (
          <Button
            variant="text"
            color="error"
            disabled={leavingProject}
            onClick={() => setConfirmingLeaveProject(true)}
            sx={{ alignSelf: "flex-start", px: 0.5 }}
          >
            Leave project
          </Button>
        ) : null}
      </Stack>
      <Dialog
        open={confirmingLeaveProject}
        onClose={() => {
          if (!leavingProject) {
            setConfirmingLeaveProject(false);
          }
        }}
        fullWidth
      >
        <DialogTitle>Leave project?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will unlink your email from your member profile. Existing records stay unchanged.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={leavingProject} onClick={() => setConfirmingLeaveProject(false)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={leavingProject}
            onClick={() => void leaveProject()}
          >
            Leave project
          </Button>
        </DialogActions>
      </Dialog>
    </PanelFrame>
  );
}

function SettingsRow({
  to,
  icon,
  title,
  description,
  trailing,
  large = false,
}: {
  to?: string;
  icon: ReactNode;
  title: string;
  description: string;
  trailing?: ReactNode;
  large?: boolean;
}) {
  const content = (
    <>
      <Stack
        sx={{
          alignItems: "center",
          bgcolor: large ? ledgerColors.blueSoft : ledgerColors.paperSoft,
          border: `1px solid ${ledgerColors.line}`,
          borderRadius: 1,
          color: large ? ledgerColors.blue : ledgerColors.ink,
          height: large ? 52 : 38,
          justifyContent: "center",
          width: large ? 52 : 38,
          "& .MuiSvgIcon-root": { fontSize: large ? 30 : 22 },
        }}
      >
        {icon}
      </Stack>
      <Stack sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: large ? 18 : 16, fontWeight: 780 }}>{title}</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 13, lineHeight: 1.35 }}>
          {description}
        </Typography>
      </Stack>
      <Box sx={{ color: "text.secondary", display: "flex", justifyContent: "flex-end" }}>
        {trailing ?? (to ? <ChevronRightIcon fontSize="small" /> : null)}
      </Box>
    </>
  );

  const rowSx = {
    display: "grid",
    gridTemplateColumns: `${large ? 52 : 38}px minmax(0, 1fr) 24px`,
    gap: 1.5,
    minHeight: large ? 88 : 68,
    px: large ? 1.5 : 1,
    py: 1.25,
    textAlign: "left",
    width: "100%",
    border: large ? `1px solid ${ledgerColors.line}` : 0,
    borderBottom: `1px solid ${ledgerColors.line}`,
    "&:last-child": { borderBottom: 0 },
  } as const;

  if (!to) {
    return <Box sx={rowSx}>{content}</Box>;
  }

  return (
    <ButtonBase
      component={Link}
      to={to}
      sx={{
        ...rowSx,
        "&:hover": { bgcolor: "rgba(24, 23, 19, 0.035)" },
        "&:focus-visible": {
          outline: `2px solid ${ledgerColors.blue}`,
          outlineOffset: 2,
        },
      }}
    >
      {content}
    </ButtonBase>
  );
}
