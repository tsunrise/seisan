import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import * as api from "../../api";
import {
  automaticCategoryId,
  automaticClassificationDelayMs,
  ClassificationCache,
  classificationKey,
  OTHERS_CATEGORY_ID,
  selectionAfterClassification,
  selectionAfterClassificationFailure,
  type CategorySelection,
} from "../../domain/categories";

const CLASSIFICATION_DEBOUNCE_MS = 500;
const CLASSIFICATION_MIN_INTERVAL_MS = 1_500;
const CLASSIFICATION_TIMEOUT_MS = 5_000;
const CLASSIFICATION_TOP_K = 20;
// Matches the published category KV cache window, after which category edits become visible.
const CLASSIFICATION_CACHE_TTL_MS = 5 * 60 * 1_000;
const CLASSIFICATION_CACHE_MAX_ENTRIES = 200;

// Shared by every composer in the tab. clef-flash is deterministic, so retyping or revisiting an
// expense name never needs another paid classification while the category list is unchanged.
const classificationCache = new ClassificationCache<api.CategoryClassification>({
  maxEntries: CLASSIFICATION_CACHE_MAX_ENTRIES,
  ttlMs: CLASSIFICATION_CACHE_TTL_MS,
});

export type ClassificationFallbackReason = "low-score" | "error" | "timeout" | null;
export type ClassificationStatus = "empty" | "waiting" | "running" | "ready" | "fallback";

export interface ExpenseCategoryClassificationState extends CategorySelection {
  input: string;
  status: ClassificationStatus;
  candidates: api.CategoryCandidate[];
  fallbackReason: ClassificationFallbackReason;
}

interface ClassificationResolution {
  input: string;
  selectedCategoryId: string;
  stale: boolean;
}

type ClassificationOutcome =
  | { ok: true; classification: api.CategoryClassification }
  | { ok: false; reason: "error" | "timeout" };

const defaultSelection: CategorySelection = {
  source: "automatic",
  categoryId: OTHERS_CATEGORY_ID,
};

/**
 * Classifies the expense name while the user types, spending as few paid requests as possible:
 *
 * - Results are cached per normalized name, so repeated text resolves without a request.
 * - Automatic requests wait for a quiet input, keep a minimum interval between starts, and never
 *   overlap; text typed while a request runs is classified after that request settles.
 * - A superseded request is not aborted. Its cost is already paid, so its result is cached in
 *   case the user returns to that text, but it is only applied while it matches the input.
 * - Blur and submission (`ensureClassification`) skip the waiting so posting is never delayed.
 */
export function useExpenseCategoryClassification(input: string, initialCategoryId?: string) {
  const initialInputRef = useRef(input);
  const skipInitialClassificationRef = useRef(
    initialCategoryId !== undefined && input.trim().length > 0,
  );
  const initialSelection: CategorySelection = initialCategoryId
    ? { source: "manual", categoryId: initialCategoryId }
    : defaultSelection;
  const [state, setState] = useState<ExpenseCategoryClassificationState>(() => ({
    ...initialSelection,
    input: initialCategoryId ? input : "",
    status: initialCategoryId && input.trim() ? "ready" : "empty",
    candidates: [],
    fallbackReason: null,
  }));
  const stateRef = useRef(state);
  const selectionRef = useRef<CategorySelection>(initialSelection);
  const latestInputRef = useRef(input);
  const mountedRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  const lastInputAtRef = useRef(0);
  const lastRequestAtRef = useRef<number | null>(null);
  const scheduleAutomaticRef = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    latestInputRef.current = input;
  }, [input]);

  const commitState = useCallback(
    (
      update:
        | ExpenseCategoryClassificationState
        | ((current: ExpenseCategoryClassificationState) => ExpenseCategoryClassificationState),
    ) => {
      setState((current) => {
        const next = typeof update === "function" ? update(current) : update;
        stateRef.current = next;
        return next;
      });
    },
    [],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const isResolved = useCallback((text: string) => {
    const current = stateRef.current;
    return current.input === text && (current.status === "ready" || current.status === "fallback");
  }, []);

  /** Applies an outcome only while it still describes the latest input. */
  const applyOutcome = useCallback(
    (key: string, outcome: ClassificationOutcome) => {
      const currentInput = latestInputRef.current;
      if (classificationKey(currentInput) !== key) {
        return;
      }

      if (outcome.ok) {
        selectionRef.current = selectionAfterClassification(
          selectionRef.current,
          outcome.classification,
        );
        commitState({
          ...selectionRef.current,
          input: currentInput,
          status: "ready",
          candidates: outcome.classification.candidates,
          fallbackReason:
            automaticCategoryId(outcome.classification) === OTHERS_CATEGORY_ID ? "low-score" : null,
        });
        return;
      }

      selectionRef.current = selectionAfterClassificationFailure(selectionRef.current);
      commitState({
        ...selectionRef.current,
        input: currentInput,
        status: "fallback",
        candidates: [],
        fallbackReason: outcome.reason,
      });
    },
    [commitState],
  );

  /** Resolves a key from the cache, an identical in-flight request, or a new request. */
  const classify = useCallback(
    (key: string): Promise<void> => {
      const cached = classificationCache.get(key);
      if (cached) {
        applyOutcome(key, { ok: true, classification: cached });
        return Promise.resolve();
      }
      const inFlight = inFlightRef.current.get(key);
      if (inFlight) {
        return inFlight;
      }

      lastRequestAtRef.current = Date.now();
      if (classificationKey(latestInputRef.current) === key) {
        commitState((current) => ({ ...current, status: "running" }));
      }

      const controller = new AbortController();
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CLASSIFICATION_TIMEOUT_MS);

      const request = api
        .classifyCategory({ name: key, topK: CLASSIFICATION_TOP_K }, { signal: controller.signal })
        .then(
          (classification): ClassificationOutcome => {
            classificationCache.set(key, classification);
            return { ok: true, classification };
          },
          (): ClassificationOutcome => ({ ok: false, reason: timedOut ? "timeout" : "error" }),
        )
        .then((outcome) => {
          window.clearTimeout(timeout);
          inFlightRef.current.delete(key);
          if (!mountedRef.current) {
            return;
          }
          applyOutcome(key, outcome);
          // Text typed while this request ran waited for it; classify that text now if needed.
          scheduleAutomaticRef.current();
        });

      inFlightRef.current.set(key, request);
      return request;
    },
    [applyOutcome, commitState],
  );

  const scheduleAutomatic = useCallback(() => {
    clearTimer();
    if (!mountedRef.current) {
      return;
    }

    const currentInput = latestInputRef.current;
    const key = classificationKey(currentInput);
    if (!key || isResolved(currentInput)) {
      return;
    }
    if (classificationCache.get(key)) {
      void classify(key);
      return;
    }
    if (inFlightRef.current.size > 0) {
      // Automatic requests never overlap; the settling request schedules the next one.
      return;
    }

    const delay = automaticClassificationDelayMs({
      now: Date.now(),
      lastInputAt: lastInputAtRef.current,
      lastRequestAt: lastRequestAtRef.current,
      debounceMs: CLASSIFICATION_DEBOUNCE_MS,
      minIntervalMs: CLASSIFICATION_MIN_INTERVAL_MS,
    });
    if (delay > 0) {
      timerRef.current = window.setTimeout(() => scheduleAutomaticRef.current(), delay);
      return;
    }
    void classify(key);
  }, [classify, clearTimer, isResolved]);

  useLayoutEffect(() => {
    scheduleAutomaticRef.current = scheduleAutomatic;
  }, [scheduleAutomatic]);

  const ensureClassification = useCallback(
    async (requestInput: string): Promise<ClassificationResolution> => {
      if (!requestInput.trim()) {
        return { input: requestInput, selectedCategoryId: OTHERS_CATEGORY_ID, stale: false };
      }
      if (latestInputRef.current !== requestInput) {
        return {
          input: requestInput,
          selectedCategoryId: selectionRef.current.categoryId,
          stale: true,
        };
      }

      if (!isResolved(requestInput)) {
        // Explicit requests skip the debounce, interval, and overlap rules.
        clearTimer();
        await classify(classificationKey(requestInput));
      }
      return {
        input: requestInput,
        selectedCategoryId: selectionRef.current.categoryId,
        stale: latestInputRef.current !== requestInput,
      };
    },
    [classify, clearTimer, isResolved],
  );

  const selectCategory = useCallback(
    (categoryId: string) => {
      selectionRef.current = { source: "manual", categoryId };
      commitState((current) => ({ ...current, ...selectionRef.current }));
    },
    [commitState],
  );

  useLayoutEffect(() => {
    if (
      skipInitialClassificationRef.current &&
      input === initialInputRef.current &&
      stateRef.current.input === input
    ) {
      skipInitialClassificationRef.current = false;
      return;
    }

    clearTimer();
    lastInputAtRef.current = Date.now();

    if (!input.trim()) {
      if (selectionRef.current.source === "automatic") {
        selectionRef.current = defaultSelection;
      }
      commitState({
        ...selectionRef.current,
        input,
        status: "empty",
        candidates: [],
        fallbackReason: null,
      });
      return;
    }

    const key = classificationKey(input);
    const cached = classificationCache.get(key);
    if (cached) {
      applyOutcome(key, { ok: true, classification: cached });
      return;
    }

    commitState((current) => ({
      ...current,
      input,
      status: inFlightRef.current.has(key) ? "running" : "waiting",
      candidates: [],
      fallbackReason: null,
    }));
    scheduleAutomatic();

    return clearTimer;
  }, [applyOutcome, clearTimer, commitState, input, scheduleAutomatic]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const classificationIsCurrent =
    state.input === input && (state.status === "ready" || state.status === "fallback");

  return {
    state,
    classificationIsCurrent,
    ensureClassification,
    classifyOnBlur: () => {
      void ensureClassification(input);
    },
    selectCategory,
  };
}
