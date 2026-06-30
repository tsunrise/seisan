export type TimelineScrollRestore = {
  scrollY: number;
  anchorRecordId: number;
  anchorTop: number;
  oldestRecordId: number;
  savedAt: number;
};

const TIMELINE_SCROLL_RESTORE_TTL_MS = 10 * 60 * 1000;
export const LOAD_EARLIER_ROOT_MARGIN_PX = 220;
export const MOBILE_BOTTOM_SCROLL_SPACE = "calc(128px + env(safe-area-inset-bottom))";
export const TIMELINE_STICKY_TOP_VAR = "--project-timeline-sticky-top";

const MOBILE_ACTION_GAP_PX = 20;

export function topSentinelIsInLoadZone(sentinel: HTMLElement): boolean {
  const rect = sentinel.getBoundingClientRect();
  return rect.bottom >= -LOAD_EARLIER_ROOT_MARGIN_PX && rect.top <= window.innerHeight;
}

export function scrollElementToTimelineEnd(element: HTMLElement | null): void {
  if (!element) {
    return;
  }

  element.scrollIntoView({ block: "end" });
  keepElementAboveMobileAction(element);
  requestAnimationFrame(() => keepElementAboveMobileAction(element));
}

export function keepElementAboveMobileAction(element: HTMLElement): void {
  const action = document.querySelector<HTMLElement>("[data-project-mobile-action]");
  if (!action || getComputedStyle(action).display === "none") {
    return;
  }

  const actionTop = action.getBoundingClientRect().top;
  const elementBottom = element.getBoundingClientRect().bottom;
  const overlap = elementBottom - (actionTop - MOBILE_ACTION_GAP_PX);
  if (overlap > 0) {
    window.scrollTo({ top: window.scrollY + overlap, behavior: "auto" });
  }
}

export function observeTimelineStickyTop(root: HTMLElement): () => void {
  const header = document.querySelector<HTMLElement>("[data-project-header]");

  function setStickyTop() {
    const headerHeight = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
    root.style.setProperty(TIMELINE_STICKY_TOP_VAR, `${headerHeight}px`);
  }

  setStickyTop();

  if (!header || typeof ResizeObserver === "undefined") {
    return () => root.style.removeProperty(TIMELINE_STICKY_TOP_VAR);
  }

  const observer = new ResizeObserver(setStickyTop);
  observer.observe(header);

  return () => {
    observer.disconnect();
    root.style.removeProperty(TIMELINE_STICKY_TOP_VAR);
  };
}

export function readTimelineScroll(projectId: string): TimelineScrollRestore | null {
  try {
    const raw = sessionStorage.getItem(timelineScrollKey(projectId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<TimelineScrollRestore>;
    if (
      typeof parsed.scrollY !== "number" ||
      typeof parsed.anchorRecordId !== "number" ||
      typeof parsed.anchorTop !== "number" ||
      typeof parsed.oldestRecordId !== "number" ||
      typeof parsed.savedAt !== "number"
    ) {
      return null;
    }

    if (Date.now() - parsed.savedAt > TIMELINE_SCROLL_RESTORE_TTL_MS) {
      clearTimelineScroll(projectId);
      return null;
    }

    return {
      scrollY: parsed.scrollY,
      anchorRecordId: parsed.anchorRecordId,
      anchorTop: parsed.anchorTop,
      oldestRecordId: parsed.oldestRecordId,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function saveTimelineScroll(projectId: string, state: TimelineScrollRestore): void {
  try {
    sessionStorage.setItem(timelineScrollKey(projectId), JSON.stringify(state));
  } catch {
    // Ignore storage failures; the browser's default behavior still works as a fallback.
  }
}

export function clearTimelineScroll(projectId: string): void {
  try {
    sessionStorage.removeItem(timelineScrollKey(projectId));
  } catch {
    // Ignore storage failures; this is only a one-shot scroll hint.
  }
}

function timelineScrollKey(projectId: string): string {
  return `seisan:project-timeline-scroll:${projectId}`;
}
