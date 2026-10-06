import { useCallback, useEffect, useRef } from "react";

import type * as api from "../../api";
import {
  clearTimelineScroll,
  keepElementAboveMobileAction,
  LOAD_EARLIER_ROOT_MARGIN_PX,
  observeTimelineStickyTop,
  readTimelineScroll,
  saveTimelineScroll,
  scrollElementToTimelineEnd,
  topSentinelIsInLoadZone,
  type TimelineScrollRestore,
} from "./timelineScroll";

/**
 * Timeline scroll behavior, kept out of rendering components:
 *
 * - keeps the sticky day labels below the project header;
 * - restores the saved scroll anchor when returning from a record, loading older pages first when
 *   the anchor is not loaded yet;
 * - otherwise scrolls to the latest record on first load and after `scrollToLatestKey` changes;
 * - loads older records when the top sentinel nears the viewport, preserving the visible position.
 *
 * `records` must be sorted oldest to newest. Attach the returned refs to the timeline root, the
 * top sentinel, and the last record row, and call `saveCurrentScroll` before opening a record.
 */
export function useTimelineScroll({
  projectId,
  records,
  hasMoreRecords,
  loadingOlderRecords,
  onLoadOlderRecords,
  isActive,
  scrollToLatestKey,
  restoreScrollKey,
}: {
  projectId: string;
  records: api.ProjectRecord[];
  hasMoreRecords: boolean;
  loadingOlderRecords: boolean;
  onLoadOlderRecords?: () => Promise<void>;
  isActive: boolean;
  scrollToLatestKey: number;
  restoreScrollKey: string;
}) {
  const timelineRef = useRef<HTMLElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const lastRecordRef = useRef<HTMLDivElement | null>(null);
  const initialScrollDoneRef = useRef(false);
  const preservingScrollRef = useRef(false);
  const restoreStateRef = useRef<TimelineScrollRestore | null>(readTimelineScroll(projectId));

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

    const restoreState = readTimelineScroll(projectId);
    restoreStateRef.current = restoreState;
    if (restoreState) {
      initialScrollDoneRef.current = false;
    }
  }, [isActive, projectId, restoreScrollKey]);

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
        const anchor = recordRowElement(restoreState.anchorRecordId);
        if (anchor) {
          const topDelta = anchor.getBoundingClientRect().top - restoreState.anchorTop;
          window.scrollTo(0, window.scrollY + topDelta);
          keepElementAboveMobileAction(anchor);
        } else {
          window.scrollTo(0, restoreState.scrollY);
        }
        clearTimelineScroll(projectId);
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
    projectId,
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
  }, [isActive, projectId, scrollToLatestKey]);

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
      const anchor = recordRowElement(recordId);
      const oldestRecordId = records[0]?.id;
      if (oldestRecordId === undefined) {
        return;
      }

      saveTimelineScroll(projectId, {
        scrollY: window.scrollY,
        anchorRecordId: recordId,
        anchorTop: anchor?.getBoundingClientRect().top ?? 0,
        oldestRecordId,
        savedAt: Date.now(),
      });
    },
    [projectId, records],
  );

  return { timelineRef, topSentinelRef, lastRecordRef, saveCurrentScroll };
}

function recordRowElement(recordId: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-record-id="${recordId}"]`);
}
