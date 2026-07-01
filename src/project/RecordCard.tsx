import { Avatar, Box, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type * as api from "../api";
import { Amount } from "../components/Amount";
import { formatRelativeTime, memberName, recordTitle } from "../domain";
import { ledgerColors } from "../theme";
import { initials } from "../utils";
import { timelineLayout } from "./timelineLayout";
import { recordActorMemberId } from "./recordActor";

export function RecordCard({
  project,
  record,
  currentMember,
  selected = false,
  onOpen,
}: {
  project: api.Project;
  record: api.ProjectRecord;
  currentMember: api.ProjectMember | null;
  selected?: boolean;
  onOpen?: (recordId: number) => void;
}) {
  const actorMemberId = recordActorMemberId(record);
  const actor = project.members.find((member) => member.id === actorMemberId);
  const author = project.members.find((member) => member.id === record.authorMemberId);
  const subjectIsCurrentMember = actor?.id === currentMember?.id;
  const viewerDelta = currentMember ? (record.delta[String(currentMember.id)] ?? 0) : null;
  const isReverted = record.reverted !== undefined;
  const hasViewerAmount = viewerDelta !== null && viewerDelta !== 0;
  const compact = !isReverted && !hasViewerAmount;
  const relativeTime = formatRelativeTime(record.createdAt);
  const metadataText =
    record.authorMemberId === actorMemberId
      ? relativeTime
      : `${relativeTime}, posted by ${author?.name ?? "Unknown member"}`;
  const revertedTextSx = isReverted
    ? {
        color: ledgerColors.muted,
        textDecoration: "line-through",
        textDecorationThickness: "1.5px",
      }
    : {};

  return (
    <TimelineRecordShell
      marker={initials(actor?.name ?? "?")}
      markerActive={subjectIsCurrentMember || selected}
      compact={compact}
    >
      <Paper
        component={Link}
        to={`/project/${project.id}/records/${record.id}`}
        onClick={() => onOpen?.(record.id)}
        aria-label={`Open record #${record.id}`}
        square
        sx={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto" },
          columnGap: 2,
          rowGap: 0.75,
          minHeight: compact
            ? timelineLayout.recordCompactMinHeight
            : timelineLayout.recordMinHeight,
          px: timelineLayout.recordPaddingX,
          py: timelineLayout.recordPaddingY,
          border: `1px solid ${selected ? "rgba(17, 103, 216, 0.15)" : "transparent"}`,
          borderLeft: selected ? `3px solid ${ledgerColors.blue}` : "1px solid transparent",
          bgcolor: selected ? "rgba(238, 246, 255, 0.72)" : "transparent",
          boxShadow: "none",
          color: "inherit",
          cursor: "pointer",
          textDecoration: "none",
          transition: timelineLayout.transition,
          "&::before": selected
            ? {
                content: '""',
                position: "absolute",
                top: "calc(50% - 3px)",
                right: -42,
                display: { xs: "none", md: "block" },
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                bgcolor: ledgerColors.blue,
              }
            : undefined,
          "&::after": selected
            ? {
                content: '""',
                position: "absolute",
                top: "50%",
                right: -38,
                display: { xs: "none", md: "block" },
                width: "38px",
                height: "1px",
                bgcolor: ledgerColors.blue,
              }
            : undefined,
          "&:hover": {
            bgcolor: selected ? "rgba(238, 246, 255, 0.92)" : "rgba(24, 23, 19, 0.025)",
            borderColor: selected ? "rgba(17, 103, 216, 0.22)" : "rgba(24, 23, 19, 0.04)",
          },
          "&:focus-visible": {
            outline: `2px solid ${ledgerColors.blue}`,
            outlineOffset: 3,
          },
        }}
      >
        <Stack spacing={0.65} sx={{ minWidth: 0 }}>
          <Stack
            direction="row"
            sx={{
              alignItems: "baseline",
              gap: 1.5,
              justifyContent: "space-between",
              minWidth: 0,
            }}
          >
            <Typography
              sx={{
                minWidth: 0,
                color: "text.secondary",
                fontSize: 15,
                fontWeight: 500,
                overflowWrap: "anywhere",
              }}
            >
              {actor?.name ?? "Unknown member"}
            </Typography>
            <Typography
              sx={{
                display: { xs: "block", sm: "none" },
                flexShrink: 0,
                color: "text.secondary",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              #{record.id}
            </Typography>
          </Stack>
          <Typography
            component="h2"
            sx={{
              fontSize: { xs: "1.12rem", lg: "1.25rem" },
              fontWeight: 760,
              lineHeight: 1.24,
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              ...revertedTextSx,
            }}
          >
            {recordTitle(record, project.members)}
          </Typography>
          <Typography
            sx={{
              color: "text.secondary",
              fontSize: 13,
              fontWeight: 500,
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              ...revertedTextSx,
            }}
          >
            {metadataText}
          </Typography>
          {record.reverted ? (
            <Typography
              sx={{
                color: "text.secondary",
                fontSize: 12,
                fontWeight: 600,
                overflowWrap: "anywhere",
              }}
            >
              Reverted by {memberName(project.members, record.reverted.authorMemberId)}{" "}
              {formatRelativeTime(record.reverted.createdAt)}
            </Typography>
          ) : null}
        </Stack>
        <Stack
          sx={{
            alignItems: { xs: "flex-start", sm: "flex-end" },
            justifyContent: "space-between",
            gap: 1,
            minWidth: timelineLayout.rightMetaWidth,
          }}
        >
          <Typography
            sx={{
              display: { xs: "none", sm: "block" },
              color: "text.secondary",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            #{record.id}
          </Typography>
          {hasViewerAmount ? <Amount amount={viewerDelta} muted={isReverted} /> : null}
        </Stack>
      </Paper>
    </TimelineRecordShell>
  );
}

export function RevertRecordMessage({
  project,
  record,
  selected = false,
  onOpen,
}: {
  project: api.Project;
  record: api.ProjectRecord;
  selected?: boolean;
  onOpen?: (recordId: number) => void;
}) {
  if (record.description.type !== "revert") {
    return null;
  }

  const authorName = memberName(project.members, record.authorMemberId);
  const metadataText = formatRelativeTime(record.createdAt);

  return (
    <TimelineSystemEventShell selected={selected}>
      <Paper
        component={Link}
        to={`/project/${project.id}/records/${record.id}`}
        onClick={() => onOpen?.(record.id)}
        aria-label={`Open record #${record.id}`}
        square
        sx={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr) auto",
            sm: "minmax(0, 1fr) auto auto",
          },
          alignItems: "center",
          columnGap: { xs: 1.25, sm: 1.6 },
          rowGap: 0.35,
          minHeight: timelineLayout.systemCardMinHeight,
          my: timelineLayout.systemCardMarginY,
          px: timelineLayout.recordPaddingX,
          py: 0.55,
          border: `1px solid ${selected ? "rgba(17, 103, 216, 0.15)" : "transparent"}`,
          borderLeft: selected ? `2px solid ${ledgerColors.blue}` : "1px solid transparent",
          bgcolor: selected ? "rgba(238, 246, 255, 0.72)" : "transparent",
          color: "inherit",
          boxShadow: "none",
          cursor: "pointer",
          textDecoration: "none",
          transition: timelineLayout.transition,
          "&::before": selected
            ? {
                content: '""',
                position: "absolute",
                top: "calc(50% - 3px)",
                right: -42,
                display: { xs: "none", md: "block" },
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                bgcolor: ledgerColors.blue,
              }
            : undefined,
          "&::after": selected
            ? {
                content: '""',
                position: "absolute",
                top: "50%",
                right: -38,
                display: { xs: "none", md: "block" },
                width: "38px",
                height: "1px",
                bgcolor: ledgerColors.blue,
              }
            : undefined,
          "&:hover": {
            bgcolor: selected ? "rgba(238, 246, 255, 0.92)" : "rgba(24, 23, 19, 0.025)",
            borderColor: selected ? "rgba(17, 103, 216, 0.22)" : "rgba(24, 23, 19, 0.04)",
          },
          "&:focus-visible": {
            outline: `2px solid ${ledgerColors.blue}`,
            outlineOffset: 3,
          },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="span"
            sx={{
              color: selected ? ledgerColors.ink : "text.secondary",
              fontSize: { xs: 13, md: 13.5 },
              fontWeight: 650,
              lineHeight: 1.25,
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {authorName} reverted record #{record.description.id}
          </Typography>
          <Typography
            sx={{
              display: { xs: "block", sm: "none" },
              color: "text.secondary",
              fontSize: 12,
              fontWeight: 500,
              lineHeight: 1.4,
              mt: 0.15,
            }}
          >
            {metadataText}
          </Typography>
        </Box>
        <Typography
          sx={{
            display: { xs: "none", sm: "block" },
            color: "text.secondary",
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          {metadataText}
        </Typography>
        <Typography
          sx={{
            flexShrink: 0,
            color: "text.secondary",
            fontSize: 13,
            fontWeight: 500,
            minWidth: timelineLayout.rightMetaWidth,
            textAlign: "right",
          }}
        >
          #{record.id}
        </Typography>
      </Paper>
    </TimelineSystemEventShell>
  );
}

function TimelineRecordShell({
  marker,
  markerActive,
  compact,
  children,
}: {
  marker: string;
  markerActive: boolean;
  compact: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: timelineLayout.markerColumns,
        columnGap: timelineLayout.markerGap,
        minHeight: compact ? timelineLayout.recordCompactMinHeight : timelineLayout.recordMinHeight,
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          position: "relative",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Avatar
          sx={{
            zIndex: 1,
            mt: timelineLayout.recordMarkerOffset,
            width: timelineLayout.recordMarkerSize,
            height: timelineLayout.recordMarkerSize,
            border: `1px solid ${markerActive ? "rgba(17, 103, 216, 0.22)" : ledgerColors.line}`,
            bgcolor: markerActive ? ledgerColors.blueSoft : ledgerColors.paperSoft,
            color: ledgerColors.ink,
            fontSize: { xs: 14, md: 15 },
            fontWeight: 760,
          }}
        >
          {marker}
        </Avatar>
      </Box>
      <Box sx={{ position: "relative", minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

function TimelineSystemEventShell({
  selected,
  children,
}: {
  selected: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: timelineLayout.markerColumns,
        columnGap: timelineLayout.markerGap,
        minHeight: timelineLayout.systemMinHeight,
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          position: "relative",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Box
          sx={{
            zIndex: 1,
            mt: timelineLayout.systemMarkerOffset,
            width: timelineLayout.systemMarkerSize,
            height: timelineLayout.systemMarkerSize,
            borderRadius: "50%",
            border: `1px solid ${selected ? "rgba(17, 103, 216, 0.34)" : ledgerColors.line}`,
            bgcolor: selected ? ledgerColors.blueSoft : ledgerColors.paper,
            boxShadow: `0 0 0 4px ${ledgerColors.paper}`,
          }}
        />
      </Box>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}
