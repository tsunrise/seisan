import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type * as api from "../api";
import { panelFrameSx } from "../components/styles";
import { ledgerColors, ledgerFonts } from "../theme";
import { MinorRecordMessage, RecordCard } from "./RecordCard";
import { groupRecordsByDay } from "./timelineGroups";
import { timelineLayout } from "./timelineLayout";
import {
  clearTimelineScroll,
  keepElementAboveMobileAction,
  LOAD_EARLIER_ROOT_MARGIN_PX,
  MOBILE_BOTTOM_SCROLL_SPACE,
  observeTimelineStickyTop,
  readTimelineScroll,
  saveTimelineScroll,
  scrollElementToTimelineEnd,
  TIMELINE_STICKY_TOP_VAR,
  type TimelineScrollRestore,
  topSentinelIsInLoadZone,
} from "./timelineScroll";

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
  const timelineRef = useRef<HTMLElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const lastRecordRef = useRef<HTMLDivElement | null>(null);
  const initialScrollDoneRef = useRef(false);
  const preservingScrollRef = useRef(false);
  const restoreStateRef = useRef<TimelineScrollRestore | null>(readTimelineScroll(project.id));
  const records = useMemo(
    () => [...project.records].sort((left, right) => left.id - right.id),
    [project.records],
  );
  const dayGroups = useMemo(() => groupRecordsByDay(records), [records]);
  const lastRecordId = records.at(-1)?.id;

  useEffect(() => {
    if (!isActive || !timelineRef.current) {
      return;
    }
    return observeTimelineStickyTop(timelineRef.current);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const restoreState = readTimelineScroll(project.id);
    restoreStateRef.current = restoreState;
    if (restoreState) {
      initialScrollDoneRef.current = false;
    }
  }, [isActive, project.id, restoreScrollKey]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const restoreState = restoreStateRef.current;
    if (!restoreState || records.length === 0) {
      return;
    }

    const anchorIsLoaded = records.some((record) => record.id === restoreState.anchorRecordId);
    const oldestLoadedRecordId = records[0].id;
    if (
      (!anchorIsLoaded || oldestLoadedRecordId > restoreState.oldestRecordId) &&
      hasMoreRecords &&
      !loadingOlderRecords &&
      onLoadOlderRecords
    ) {
      void onLoadOlderRecords();
      return;
    }

    let secondFrame: number | null = null;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const anchor = document.querySelector<HTMLElement>(
          `[data-record-id="${restoreState.anchorRecordId}"]`,
        );
        if (anchor) {
          const topDelta = anchor.getBoundingClientRect().top - restoreState.anchorTop;
          window.scrollTo(0, window.scrollY + topDelta);
          keepElementAboveMobileAction(anchor);
        } else {
          window.scrollTo(0, restoreState.scrollY);
        }
        clearTimelineScroll(project.id);
        restoreStateRef.current = null;
        initialScrollDoneRef.current = true;
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        cancelAnimationFrame(secondFrame);
      }
    };
  }, [
    hasMoreRecords,
    isActive,
    loadingOlderRecords,
    onLoadOlderRecords,
    project.id,
    records,
    restoreScrollKey,
  ]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    if (restoreStateRef.current) {
      return;
    }

    initialScrollDoneRef.current = false;
    const frame = requestAnimationFrame(() => {
      scrollElementToTimelineEnd(lastRecordRef.current);
      initialScrollDoneRef.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [isActive, project.id, scrollToLatestKey]);

  const loadEarlierRecords = useCallback(async () => {
    if (
      !hasMoreRecords ||
      loadingOlderRecords ||
      !onLoadOlderRecords ||
      preservingScrollRef.current ||
      restoreStateRef.current
    ) {
      return;
    }

    const scrollingElement = document.scrollingElement ?? document.documentElement;
    const previousScrollHeight = scrollingElement.scrollHeight;
    const previousScrollTop = window.scrollY;
    preservingScrollRef.current = true;

    try {
      await onLoadOlderRecords();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const nextScrollHeight = scrollingElement.scrollHeight;
          window.scrollTo(0, previousScrollTop + (nextScrollHeight - previousScrollHeight));
          preservingScrollRef.current = false;
        });
      });
    } catch {
      preservingScrollRef.current = false;
    }
  }, [hasMoreRecords, loadingOlderRecords, onLoadOlderRecords]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const sentinel = topSentinelRef.current;
    if (!sentinel || !hasMoreRecords || !onLoadOlderRecords) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          !initialScrollDoneRef.current ||
          preservingScrollRef.current ||
          restoreStateRef.current
        ) {
          return;
        }
        if (!topSentinelIsInLoadZone(sentinel)) {
          return;
        }
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadEarlierRecords();
        }
      },
      { root: null, rootMargin: `${LOAD_EARLIER_ROOT_MARGIN_PX}px 0px 0px 0px`, threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreRecords, isActive, loadEarlierRecords, onLoadOlderRecords]);

  const saveCurrentScroll = useCallback(
    (recordId: number) => {
      const anchor = document.querySelector<HTMLElement>(`[data-record-id="${recordId}"]`);
      const oldestRecordId = records[0]?.id;
      if (oldestRecordId === undefined) {
        return;
      }

      saveTimelineScroll(project.id, {
        scrollY: window.scrollY,
        anchorRecordId: recordId,
        anchorTop: anchor?.getBoundingClientRect().top ?? 0,
        oldestRecordId,
        savedAt: Date.now(),
      });
    },
    [project.id, records],
  );

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
            <Box sx={{ position: "relative", minWidth: 0 }}>
              {groupIndex > 0 ? <DateBoundarySeparator /> : null}
              {group.records.map((record) => {
                const isLastRecord = record.id === lastRecordId;
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
                    ref={isLastRecord ? lastRecordRef : undefined}
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
