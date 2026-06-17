import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type * as api from "../api";
import { panelFrameSx } from "../components/styles";
import { RecordCard, RevertRecordMessage } from "./RecordCard";
import {
  clearTimelineScroll,
  keepElementAboveMobileAction,
  LOAD_EARLIER_ROOT_MARGIN_PX,
  MOBILE_BOTTOM_SCROLL_SPACE,
  readTimelineScroll,
  saveTimelineScroll,
  scrollElementToTimelineEnd,
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
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
  hasMoreRecords?: boolean;
  loadingOlderRecords?: boolean;
  onLoadOlderRecords?: () => Promise<void>;
  isActive?: boolean;
  scrollToLatestKey?: number;
  restoreScrollKey?: string;
}) {
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const lastRecordRef = useRef<HTMLDivElement | null>(null);
  const initialScrollDoneRef = useRef(false);
  const preservingScrollRef = useRef(false);
  const restoreStateRef = useRef<TimelineScrollRestore | null>(readTimelineScroll(project.id));
  const records = useMemo(
    () => [...project.records].sort((left, right) => left.id - right.id),
    [project.records],
  );

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
      component="section"
      sx={{
        display: "grid",
        gap: { xs: 2.5, md: 3 },
        px: { xs: 2, md: 3 },
        pt: { xs: 2.75, md: 3.5 },
        pb: { xs: MOBILE_BOTTOM_SCROLL_SPACE, md: 3.5 },
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
              py: 1,
            }}
          >
            <CircularProgress size={16} />
            <Typography variant="body2">Loading earlier records</Typography>
          </Stack>
        ) : null}
      </Box>
      {records.map((record, index) => (
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
          ref={index === records.length - 1 ? lastRecordRef : undefined}
          sx={{ scrollMarginBottom: { xs: MOBILE_BOTTOM_SCROLL_SPACE, md: 28 } }}
        >
          {record.description.type === "revert" ? (
            <RevertRecordMessage project={project} record={record} onOpen={saveCurrentScroll} />
          ) : (
            <RecordCard
              project={project}
              record={record}
              currentMember={currentMember}
              onOpen={saveCurrentScroll}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}
