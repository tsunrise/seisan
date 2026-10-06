import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { useMemo } from "react";

import type * as api from "../../api";
import { panelFrameSx } from "../../components/styles";
import { ledgerColors, ledgerFonts } from "../../theme";
import { MinorRecordMessage } from "./MinorRecordMessage";
import { RecordCard } from "./RecordCard";
import { groupRecordsByDay, type TimelineDayGroup } from "./timelineGroups";
import { timelineLayout } from "./timelineLayout";
import { MOBILE_BOTTOM_SCROLL_SPACE, TIMELINE_STICKY_TOP_VAR } from "./timelineScroll";
import { useTimelineScroll } from "./useTimelineScroll";

/**
 * Oldest-to-newest record timeline grouped by local day, with sticky day labels on a vertical
 * rail. Scrolling, restoration, and paging live in `useTimelineScroll`.
 */
export function RecordTimeline({
  project,
  currentMember,
  hasMoreRecords = false,
  loadingOlderRecords = false,
  onLoadOlderRecords,
  isActive = true,
  scrollToLatestKey = 0,
  restoreScrollKey = "",
  selectedRecordId = null,
  categories,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
  hasMoreRecords?: boolean;
  loadingOlderRecords?: boolean;
  onLoadOlderRecords?: () => Promise<void>;
  isActive?: boolean;
  scrollToLatestKey?: number;
  restoreScrollKey?: string;
  selectedRecordId?: number | null;
  categories: api.Category[];
}) {
  const records = useMemo(
    () => [...project.records].sort((left, right) => left.id - right.id),
    [project.records],
  );
  const dayGroups = useMemo(() => groupRecordsByDay(records), [records]);
  const lastRecordId = records.at(-1)?.id;
  const { timelineRef, topSentinelRef, lastRecordRef, saveCurrentScroll } = useTimelineScroll({
    projectId: project.id,
    records,
    hasMoreRecords,
    loadingOlderRecords,
    onLoadOlderRecords,
    isActive,
    scrollToLatestKey,
    restoreScrollKey,
  });

  if (project.records.length === 0) {
    return (
      <Paper square sx={{ ...panelFrameSx, m: 4.5, textAlign: "center" }}>
        <Stack spacing={1.5} sx={{ alignItems: "center" }}>
          <ReceiptLongIcon />
          <Typography variant="h2">No records yet</Typography>
          <Typography color="text.secondary">
            Post the first spend when someone pays for the group.
          </Typography>
        </Stack>
      </Paper>
    );
  }

  return (
    <Box
      ref={timelineRef}
      component="section"
      sx={{
        display: "grid",
        gap: 0,
        px: { xs: 1.25, sm: 2, md: 2.5 },
        pt: { xs: 1.5, md: 2 },
        pb: { xs: MOBILE_BOTTOM_SCROLL_SPACE, md: 2.5 },
      }}
    >
      <Box ref={topSentinelRef} sx={{ minHeight: 1 }}>
        {loadingOlderRecords ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              justifyContent: "center",
              color: "text.secondary",
              py: 1.5,
            }}
          >
            <CircularProgress size={16} />
            <Typography variant="body2">Loading earlier records</Typography>
          </Stack>
        ) : null}
      </Box>
      <Box
        sx={{
          position: "relative",
          display: "grid",
          gap: 0,
          "&::before": {
            content: '""',
            position: "absolute",
            top: 0,
            bottom: 0,
            left: timelineLayout.railLeft,
            width: "1px",
            bgcolor: ledgerColors.line,
            pointerEvents: "none",
            transform: "translateX(-0.5px)",
          },
        }}
      >
        {dayGroups.map((group, groupIndex) => (
          <Box
            key={group.key}
            component="section"
            sx={{
              display: "grid",
              gridTemplateColumns: timelineLayout.dateColumns,
              columnGap: timelineLayout.dateColumnGap,
              position: "relative",
            }}
          >
            <TimelineDayLabel group={group} />
            <Box sx={{ position: "relative", minWidth: 0 }}>
              {groupIndex > 0 ? <DateBoundarySeparator /> : null}
              {group.records.map((record) => {
                const selected = selectedRecordId === record.id;

                return (
                  <Box
                    key={record.id}
                    data-record-id={record.id}
                    onKeyDownCapture={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        saveCurrentScroll(record.id);
                      }
                    }}
                    onPointerDownCapture={(event) => {
                      if (event.target instanceof Element && event.target.closest("a")) {
                        saveCurrentScroll(record.id);
                      }
                    }}
                    ref={record.id === lastRecordId ? lastRecordRef : undefined}
                    sx={{
                      scrollMarginTop: `calc(var(${TIMELINE_STICKY_TOP_VAR}, 0px) + 16px)`,
                      scrollMarginBottom: { xs: MOBILE_BOTTOM_SCROLL_SPACE, md: 28 },
                    }}
                  >
                    {record.description.type === "revert" ||
                    record.description.type === "deleted" ? (
                      <MinorRecordMessage
                        project={project}
                        record={record}
                        selected={selected}
                        onOpen={saveCurrentScroll}
                      />
                    ) : (
                      <RecordCard
                        project={project}
                        record={record}
                        currentMember={currentMember}
                        categories={categories}
                        selected={selected}
                        onOpen={saveCurrentScroll}
                      />
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function TimelineDayLabel({ group }: { group: TimelineDayGroup }) {
  return (
    <Box
      sx={{
        position: "relative",
        alignSelf: "stretch",
        contain: "size",
        minHeight: 0,
        minWidth: 0,
        pointerEvents: "none",
      }}
    >
      <Box
        aria-label={group.label}
        data-timeline-day-label={group.key}
        sx={{
          position: "sticky",
          top: {
            xs: `calc(var(${TIMELINE_STICKY_TOP_VAR}, 0px) + ${timelineLayout.dateLabelStickyGapPx.xs}px)`,
            md: `calc(var(${TIMELINE_STICKY_TOP_VAR}, 0px) + ${timelineLayout.dateLabelStickyGapPx.md}px)`,
          },
          zIndex: 2,
          display: "grid",
          justifyItems: "center",
          alignContent: "center",
          rowGap: "3px",
          width: { xs: 34, md: 38, lg: 42 },
          minHeight: { xs: 30, md: 32 },
          mx: "auto",
          py: { xs: 0.375, md: 0.375 },
          color: "text.secondary",
          bgcolor: ledgerColors.paper,
          fontVariantNumeric: "tabular-nums",
          textAlign: "center",
        }}
      >
        <Typography
          component="span"
          sx={{
            color: "text.secondary",
            fontFamily: ledgerFonts.mono,
            fontSize: { xs: 9, md: 9.5 },
            fontWeight: 650,
            letterSpacing: "0.08em",
            lineHeight: 1,
            opacity: 0.86,
          }}
        >
          {group.labelParts.dateCode}
        </Typography>
        <Typography
          component="span"
          sx={{
            color: "text.secondary",
            fontFamily: ledgerFonts.mono,
            fontSize: { xs: 9, md: 9.5 },
            fontWeight: 600,
            letterSpacing: "0.06em",
            lineHeight: 1,
            opacity: 0.58,
          }}
        >
          {group.labelParts.year}
        </Typography>
      </Box>
    </Box>
  );
}

function DateBoundarySeparator() {
  return (
    <Box
      aria-hidden="true"
      data-timeline-date-separator="true"
      sx={{
        position: "absolute",
        top: 0,
        right: 0,
        left: 0,
        zIndex: 1,
        display: "grid",
        gridTemplateColumns: timelineLayout.markerColumns,
        columnGap: timelineLayout.markerGap,
        pointerEvents: "none",
      }}
    >
      <Box />
      <Box
        sx={{
          height: "1px",
          bgcolor: timelineLayout.dateBoundarySeparatorColor,
        }}
      />
    </Box>
  );
}
