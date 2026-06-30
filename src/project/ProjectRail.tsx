import { Box, CircularProgress, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { Link } from "react-router";

import type * as api from "../api";
import type { Loadable } from "../types";
import { Amount } from "../components/Amount";
import { BrandLink } from "../components/BrandLink";
import { MemberBalanceList } from "../components/MemberBalanceList";
import { formatRelativeTime } from "../domain";
import { ledgerColors, ledgerFonts } from "../theme";

type ProjectSummaryList = Array<api.WithSyncTime<api.ProjectSummary>>;
const rowHighlightBleedPx = 10;
const rowHighlightGutterPx = rowHighlightBleedPx + 2;

interface RailProjectRow {
  id: string;
  name: string;
  balance: number | null;
  time: number;
}

interface SeenProjectRows {
  activeProject: RailProjectRow;
  projects: RailProjectRow[];
}

export function ProjectRail({
  project,
  currentMember,
  projects,
  registryEnabled,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
  projects: Loadable<ProjectSummaryList>;
  registryEnabled: boolean;
}) {
  const activeFallback = currentProjectRow(project, currentMember);
  const [seenProjectsState, setSeenProjectsState] = useState<SeenProjectRows>({
    activeProject: activeFallback,
    projects: [activeFallback],
  });
  let seenProjects = seenProjectsState.projects;

  if (!sameProjectRow(seenProjectsState.activeProject, activeFallback)) {
    const nextSeenProjectsState = {
      activeProject: activeFallback,
      projects: upsertProjectRow(seenProjectsState.projects, activeFallback),
    };
    seenProjects = nextSeenProjectsState.projects;
    setSeenProjectsState(nextSeenProjectsState);
  }

  const rows =
    projects.status === "ready"
      ? mergeProjectRows(projects.data.map(summaryProjectRow), seenProjects)
      : seenProjects;

  return (
    <Box
      component="aside"
      sx={{
        alignSelf: "start",
        display: "grid",
        gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
        height: "calc(100svh - 48px)",
        minHeight: 0,
        minWidth: 0,
        position: "sticky",
        top: 24,
        "@media (max-height: 639.95px)": {
          gridTemplateRows: "minmax(0, 1fr)",
        },
      }}
    >
      <Stack
        component="section"
        spacing={2}
        aria-label="Current project"
        sx={{
          borderBottom: `1px solid ${ledgerColors.line}`,
          minHeight: 0,
          minWidth: 0,
          overflowY: "auto",
          pb: 2,
          "@media (max-height: 639.95px)": {
            borderBottom: 0,
            pb: 0,
          },
        }}
      >
        <BrandLink />
        <Typography
          variant="h2"
          sx={{
            fontSize: 20,
            fontFamily: ledgerFonts.serif,
            fontWeight: 500,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            overflowWrap: "anywhere",
          }}
        >
          {project.name}
        </Typography>
        <MemberBalanceList project={project} currentMember={currentMember} />
      </Stack>
      <Stack
        component="nav"
        spacing={0.75}
        aria-label="Projects"
        sx={{
          minHeight: 0,
          minWidth: 0,
          mx: `${-rowHighlightGutterPx}px`,
          overflowY: "auto",
          px: `${rowHighlightGutterPx}px`,
          pt: 2,
          "@media (max-height: 639.95px)": {
            display: "none",
          },
        }}
      >
        <Typography
          sx={{
            color: "text.secondary",
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: "0.08em",
            lineHeight: 1,
            textTransform: "uppercase",
          }}
        >
          Projects
        </Typography>
        <Stack spacing={0.35} sx={{ minWidth: 0 }}>
          {rows.map((row) => (
            <ProjectRailRow key={row.id} project={row} active={row.id === project.id} />
          ))}
        </Stack>
        {registryEnabled && projects.status === "loading" ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", color: "text.secondary", py: 0.75 }}
          >
            <CircularProgress size={14} />
            <Typography sx={{ fontSize: 12.5 }}>Loading projects</Typography>
          </Stack>
        ) : null}
        {registryEnabled && projects.status === "error" ? (
          <Typography color="text.secondary" sx={{ fontSize: 12.5, py: 0.75 }}>
            Projects unavailable
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

function ProjectRailRow({ project, active }: { project: RailProjectRow; active: boolean }) {
  return (
    <Box
      component={Link}
      to={`/project/${project.id}`}
      aria-current={active ? "page" : undefined}
      sx={{
        color: "inherit",
        display: "block",
        minWidth: 0,
        position: "relative",
        py: 1,
        textDecoration: "none",
        "&::before": {
          bgcolor: active ? ledgerColors.blueSoft : "transparent",
          borderRadius: 1,
          bottom: 0,
          borderLeft: active ? `2px solid ${ledgerColors.blue}` : "2px solid transparent",
          boxShadow: active ? "0 0 0 1px rgba(17, 103, 216, 0.08)" : "none",
          content: '""',
          left: -rowHighlightBleedPx,
          pointerEvents: "none",
          position: "absolute",
          right: -rowHighlightBleedPx,
          top: 0,
          transition: "background-color 120ms ease, box-shadow 120ms ease",
          zIndex: 0,
        },
        "&:hover::before": {
          bgcolor: active ? ledgerColors.blueSoft : "rgba(24, 23, 19, 0.035)",
          boxShadow: active
            ? "0 0 0 1px rgba(17, 103, 216, 0.12)"
            : "0 0 0 1px rgba(24, 23, 19, 0.04)",
        },
        "& > *": {
          position: "relative",
          zIndex: 1,
        },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", minWidth: 0 }}>
        <Typography
          sx={{
            flex: "1 1 auto",
            fontSize: 14,
            fontWeight: active ? 900 : 750,
            lineHeight: 1.25,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {project.name}
        </Typography>
        <Box sx={{ flex: "0 0 auto", fontSize: 13 }}>
          <Amount amount={project.balance} />
        </Box>
      </Stack>
      <Typography
        color="text.secondary"
        sx={{
          fontSize: 12.5,
          lineHeight: 1.35,
          mt: 0.35,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {formatRelativeTime(project.time)}
      </Typography>
    </Box>
  );
}

function summaryProjectRow(project: api.WithSyncTime<api.ProjectSummary>): RailProjectRow {
  return {
    id: project.id,
    name: project.name,
    balance: project.balance,
    time: project.lastSyncAt,
  };
}

function currentProjectRow(
  project: api.Project,
  currentMember: api.ProjectMember | null,
): RailProjectRow {
  return {
    id: project.id,
    name: project.name,
    balance: currentMember ? (project.balance[String(currentMember.id)] ?? 0) : null,
    time: project.updatedAt,
  };
}

function upsertProjectRow(
  projects: RailProjectRow[],
  nextProject: RailProjectRow,
): RailProjectRow[] {
  const existingIndex = projects.findIndex((project) => project.id === nextProject.id);
  if (existingIndex === -1) {
    return [nextProject, ...projects];
  }
  const nextProjects = [...projects];
  nextProjects[existingIndex] = nextProject;
  return nextProjects;
}

function sameProjectRow(left: RailProjectRow, right: RailProjectRow): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.balance === right.balance &&
    left.time === right.time
  );
}

function mergeProjectRows(
  registryProjects: RailProjectRow[],
  fallbackProjects: RailProjectRow[],
): RailProjectRow[] {
  let projects = registryProjects;
  for (const fallbackProject of fallbackProjects) {
    if (projects.some((project) => project.id === fallbackProject.id)) {
      continue;
    }
    projects = [...projects, fallbackProject];
  }
  return projects;
}
