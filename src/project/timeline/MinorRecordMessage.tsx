import { Box, Paper, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type * as api from "../../api";
import { formatRelativeTime, memberName } from "../../domain";
import { ledgerColors } from "../../theme";
import { projectPaths } from "../paths";
import { deletedRecordMessage } from "../records/recordEditing";
import { timelineLayout } from "./timelineLayout";
import { timelineRowLinkSx } from "./timelineRowSx";

/** Compact history event for legacy reverts and deleted-post tombstones. */
export function MinorRecordMessage({
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
  if (record.description.type !== "revert" && record.description.type !== "deleted") {
    return null;
  }

  const metadataText = formatRelativeTime(record.createdAt);
  const message =
    record.description.type === "revert"
      ? `${memberName(project.members, record.authorMemberId)} reverted record #${record.description.id}`
      : deletedRecordMessage(record, project.members);

  return (
    <TimelineSystemEventShell selected={selected}>
      <Paper
        component={Link}
        to={projectPaths.record(project.id, record.id)}
        onClick={() => onOpen?.(record.id)}
        aria-label={`Open record #${record.id}`}
        square
        sx={{
          ...timelineRowLinkSx(selected, 2),
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
            {message}
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
