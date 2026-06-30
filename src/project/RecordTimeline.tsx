import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type * as api from "../api";
import { panelFrameSx } from "../components/styles";
import { ledgerColors, ledgerFonts } from "../theme";
import { RecordCard, RevertRecordMessage } from "./RecordCard";
import { groupRecordsByDay } from "./timelineGroups";
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
      <Box sx={{ display: "grid", gap: 0 }}>
        {dayGroups.map((group) => (
          <Box
            key={group.key}
            component="section"
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "40px minmax(0, 1fr)",
                md: "50px minmax(0, 1fr)",
                lg: "62px minmax(0, 1fr)",
              },
              columnGap: { xs: 0.75, md: 1.25 },
              position: "relative",
            }}
          >
            <Box sx={{ position: "relative", minWidth: 0 }}>
              <Typography
                sx={{
                  position: "sticky",
                  top: `var(${TIMELINE_STICKY_TOP_VAR}, 0px)`,
                  zIndex: 2,
                  pt: { xs: 2, md: 2.75 },
                  color: "text.secondary",
                  fontFamily: ledgerFonts.mono,
                  fontSize: { xs: 10.5, md: 11 },
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  lineHeight: 1,
                  textAlign: "center",
                  textTransform: "uppercase",
                  transform: "rotate(180deg)",
                  writingMode: "vertical-rl",
                  mx: "auto",
                  maxHeight: `calc(100svh - var(${TIMELINE_STICKY_TOP_VAR}, 0px) - 24px)`,
                  overflow: "hidden",
                  bgcolor: ledgerColors.paper,
                }}
              >
                {group.label}
              </Typography>
            </Box>
            <Box sx={{ minWidth: 0 }}>
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
                    {record.description.type === "revert" ? (
                      <RevertRecordMessage
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
