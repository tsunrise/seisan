import { Avatar, Box, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type * as api from "../../api";
import type { IconName } from "../../../shared/icon-names";
import { Amount } from "../../components/Amount";
import { MemberNameWithRepresentation } from "../../components/MemberNameWithRepresentation";
import { NamedIcon } from "../../components/NamedIcon";
import { resolveRecordCategory } from "../../domain/categories";
import {
  findMember,
  formatRelativeTime,
  isMultiRecipientTransfer,
  recordTitle,
} from "../../domain";
import { ledgerColors } from "../../theme";
import { projectPaths } from "../paths";
import { recordEditMetadata } from "../records/recordEditing";
import { recordActorMemberId } from "./recordActor";
import { timelineLayout } from "./timelineLayout";
import { timelineRowLinkSx } from "./timelineRowSx";

/**
 * Full timeline row for a live record. The marker shows the category or record-type icon and is
 * emphasized when the record's actor is the viewer. The viewer's own balance change is shown on
 * the right; rows without one use the compact height.
 */
export function RecordCard({
  project,
  record,
  currentMember,
  categories,
  selected = false,
  onOpen,
}: {
  project: api.Project;
  record: api.ProjectRecord;
  currentMember: api.ProjectMember | null;
  categories: api.Category[];
  selected?: boolean;
  onOpen?: (recordId: number) => void;
}) {
  const actorMemberId = recordActorMemberId(record);
  const actor = findMember(project.members, actorMemberId);
  const author = findMember(project.members, record.authorMemberId);
  const subjectIsCurrentMember = actor?.id === currentMember?.id;
  const viewerDelta = currentMember ? (record.delta[String(currentMember.id)] ?? 0) : null;
  const hasViewerAmount = viewerDelta !== null && viewerDelta !== 0;
  const compact = !hasViewerAmount;
  const relativeTime = formatRelativeTime(record.createdAt);
  const createdMetadataText =
    record.authorMemberId === actorMemberId
      ? relativeTime
      : `${relativeTime}, posted by ${author?.name ?? "Unknown member"}`;
  const editMetadata = recordEditMetadata(record, project.members);
  const metadataText = editMetadata
    ? `${createdMetadataText} · ${editMetadata}`
    : createdMetadataText;
  const expenseCategory =
    record.description.type === "expense"
      ? resolveRecordCategory(categories, record.description.categoryId)
      : null;

  return (
    <TimelineRecordShell
      marker={
        <NamedIcon
          name={recordMarkerIcon(record, expenseCategory?.icon)}
          sx={{ fontSize: { xs: 19, md: 20 } }}
        />
      }
      markerActive={subjectIsCurrentMember || selected}
      compact={compact}
    >
      <Paper
        component={Link}
        to={projectPaths.record(project.id, record.id)}
        onClick={() => onOpen?.(record.id)}
        aria-label={`Open record #${record.id}`}
        square
        sx={{
          ...timelineRowLinkSx(selected, 3),
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto" },
          columnGap: 2,
          rowGap: 0.75,
          minHeight: compact
            ? timelineLayout.recordCompactMinHeight
            : timelineLayout.recordMinHeight,
          px: timelineLayout.recordPaddingX,
          py: timelineLayout.recordPaddingY,
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
            <MemberNameWithRepresentation
              member={actor}
              nameSx={{
                minWidth: 0,
                color: "text.secondary",
                fontSize: 15,
                fontWeight: 500,
                overflowWrap: "anywhere",
              }}
            />
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
            }}
          >
            {recordTitle(record, project.members)}
          </Typography>
          {expenseCategory ? (
            <Typography
              sx={{
                color: "text.secondary",
                fontSize: 13,
                fontWeight: 600,
                overflowWrap: "anywhere",
              }}
            >
              {expenseCategory.name}
            </Typography>
          ) : null}
          <Typography
            sx={{
              color: "text.secondary",
              fontSize: 13,
              fontWeight: 500,
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {metadataText}
          </Typography>
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
          {hasViewerAmount ? <Amount amount={viewerDelta} /> : null}
        </Stack>
      </Paper>
    </TimelineRecordShell>
  );
}

/** Expenses use their category icon; transfers and promises use fixed record-type icons. */
function recordMarkerIcon(
  record: api.ProjectRecord,
  categoryIcon: IconName | undefined,
): IconName | undefined {
  if (record.description.type === "expense") {
    return categoryIcon;
  }
  if (record.description.type === "transfer") {
    return isMultiRecipientTransfer(record.description) ? "transfer-multiple" : "transfer";
  }
  return "promise";
}

function TimelineRecordShell({
  marker,
  markerActive,
  compact,
  children,
}: {
  marker: ReactNode;
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
