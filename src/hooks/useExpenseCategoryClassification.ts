import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import * as api from "../api";
import {
  CATEGORY_SCORE_THRESHOLD,
  isCurrentClassification,
  OTHERS_CATEGORY_ID,
  selectionAfterClassification,
  selectionAfterClassificationFailure,
  type CategorySelection,
} from "../categories";

const CLASSIFICATION_DEBOUNCE_MS = 400;
const CLASSIFICATION_TIMEOUT_MS = 5_000;

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

interface ActiveRequest {
  token: number;
  input: string;
  controller: AbortController;
  promise: Promise<ClassificationResolution>;
}

const initialSelection: CategorySelection = {
  source: "automatic",
  categoryId: OTHERS_CATEGORY_ID,
};

export function useExpenseCategoryClassification(input: string) {
  const [state, setState] = useState<ExpenseCategoryClassificationState>({
    ...initialSelection,
    input: "",
    status: "empty",
    candidates: [],
    fallbackReason: null,
  });
  const stateRef = useRef(state);
  const selectionRef = useRef<CategorySelection>(initialSelection);
  const latestInputRef = useRef(input);
  const requestTokenRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const activeRequestRef = useRef<ActiveRequest | null>(null);

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

  const clearDebounce = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const startClassification = useCallback(
    (requestInput: string, token: number): Promise<ClassificationResolution> => {
      const existing = activeRequestRef.current;
      if (existing?.token === token && existing.input === requestInput) {
        return existing.promise;
      }

      if (
        !isCurrentClassification(
          token,
          requestInput,
          requestTokenRef.current,
          latestInputRef.current,
        )
      ) {
        return Promise.resolve({
          input: requestInput,
          selectedCategoryId: selectionRef.current.categoryId,
          stale: true,
        });
      }

      clearDebounce();
      const controller = new AbortController();
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CLASSIFICATION_TIMEOUT_MS);

      commitState((current) => ({
        ...current,
        input: requestInput,
        status: "running",
        candidates: [],
        fallbackReason: null,
      }));

      const promise = api
        .classifyCategory({ name: requestInput, topK: 20 }, { signal: controller.signal })
        .then((classification): ClassificationResolution => {
          if (
            !isCurrentClassification(
              token,
              requestInput,
              requestTokenRef.current,
              latestInputRef.current,
            )
          ) {
            return {
              input: requestInput,
              selectedCategoryId: selectionRef.current.categoryId,
              stale: true,
            };
          }

          selectionRef.current = selectionAfterClassification(selectionRef.current, classification);
          commitState({
            ...selectionRef.current,
            input: requestInput,
            status: "ready",
            candidates: classification.candidates,
            fallbackReason: classification.score < CATEGORY_SCORE_THRESHOLD ? "low-score" : null,
          });
          return {
            input: requestInput,
            selectedCategoryId: selectionRef.current.categoryId,
            stale: false,
          };
        })
        .catch((): ClassificationResolution => {
          if (
            !isCurrentClassification(
              token,
              requestInput,
              requestTokenRef.current,
              latestInputRef.current,
            )
          ) {
            return {
              input: requestInput,
              selectedCategoryId: selectionRef.current.categoryId,
              stale: true,
            };
          }

          selectionRef.current = selectionAfterClassificationFailure(selectionRef.current);
          commitState({
            ...selectionRef.current,
            input: requestInput,
            status: "fallback",
            candidates: [],
            fallbackReason: timedOut ? "timeout" : "error",
          });
          return {
            input: requestInput,
            selectedCategoryId: selectionRef.current.categoryId,
            stale: false,
          };
        })
        .finally(() => {
          window.clearTimeout(timeout);
          if (activeRequestRef.current?.token === token) {
            activeRequestRef.current = null;
          }
        });

      activeRequestRef.current = { token, input: requestInput, controller, promise };
      return promise;
    },
    [clearDebounce, commitState],
  );

  const ensureClassification = useCallback(
    (requestInput: string): Promise<ClassificationResolution> => {
      if (!requestInput.trim()) {
        return Promise.resolve({
          input: requestInput,
          selectedCategoryId: OTHERS_CATEGORY_ID,
          stale: false,
        });
      }
      if (latestInputRef.current !== requestInput) {
        return Promise.resolve({
          input: requestInput,
          selectedCategoryId: selectionRef.current.categoryId,
          stale: true,
        });
      }

      const current = stateRef.current;
      if (
        current.input === requestInput &&
        (current.status === "ready" || current.status === "fallback")
      ) {
        return Promise.resolve({
          input: requestInput,
          selectedCategoryId: selectionRef.current.categoryId,
          stale: false,
        });
      }

      const active = activeRequestRef.current;
      if (active?.input === requestInput && active.token === requestTokenRef.current) {
        return active.promise;
      }

      clearDebounce();
      let token = requestTokenRef.current;
      if (current.input !== requestInput) {
        activeRequestRef.current?.controller.abort();
        token = requestTokenRef.current + 1;
        requestTokenRef.current = token;
        commitState((previous) => ({
          ...previous,
          input: requestInput,
          status: "waiting",
          candidates: [],
          fallbackReason: null,
        }));
      }
      return startClassification(requestInput, token);
    },
    [clearDebounce, commitState, startClassification],
  );

  const selectCategory = useCallback(
    (categoryId: string) => {
      selectionRef.current = { source: "manual", categoryId };
      commitState((current) => ({ ...current, ...selectionRef.current }));
    },
    [commitState],
  );

  useLayoutEffect(() => {
    clearDebounce();
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    const token = requestTokenRef.current + 1;
    requestTokenRef.current = token;

    if (!input.trim()) {
      if (selectionRef.current.source === "automatic") {
        selectionRef.current = initialSelection;
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

    commitState((current) => ({
      ...current,
      input,
      status: "waiting",
      candidates: [],
      fallbackReason: null,
    }));
    debounceRef.current = window.setTimeout(() => {
      void startClassification(input, token);
    }, CLASSIFICATION_DEBOUNCE_MS);

    return clearDebounce;
  }, [clearDebounce, commitState, input, startClassification]);

  useEffect(
    () => () => {
      clearDebounce();
      activeRequestRef.current?.controller.abort();
    },
    [clearDebounce],
  );

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
