import { useEffect, useState } from "react";

import { ApiError } from "../api";
import { getApiErrorMessage } from "../api/errorMessages";
import type { Loadable } from "../types";

const LOADING = { status: "loading", data: null, error: null } as const;

/**
 * Runs `load` and exposes its result as a `Loadable`. Pass a stable function (module-level or
 * `useCallback`); a new function identity starts a new load and reports `loading` until it settles.
 * Passing `null` leaves the resource idle in the `loading` state.
 *
 * `errorMessage` replaces the default API error message when a page has its own copy.
 */
export function useLoadable<T>(
  load: (() => Promise<T>) | null,
  errorMessage?: string,
): Loadable<T> {
  const [settled, setSettled] = useState<{ load: () => Promise<T>; value: Loadable<T> } | null>(
    null,
  );

  useEffect(() => {
    if (!load) {
      return;
    }
    let active = true;
    load()
      .then((data) => {
        if (active) {
          setSettled({ load, value: { status: "ready", data, error: null } });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setSettled({ load, value: loadableError(error, errorMessage) });
        }
      });
    return () => {
      active = false;
    };
  }, [errorMessage, load]);

  return settled !== null && settled.load === load ? settled.value : LOADING;
}

export function loadableError(error: unknown, message?: string): Loadable<never> {
  return {
    status: "error",
    data: null,
    error: message ?? getApiErrorMessage(error),
    errorCode: error instanceof ApiError ? error.code : null,
  };
}
