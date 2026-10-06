import { useCallback } from "react";

import * as api from "../api";
import type { Loadable, User } from "../types";
import { useLoadable } from "./useLoadable";

/**
 * Loads the signed-in user. When `required` is false, an unauthenticated visitor resolves to
 * `null` instead of an error.
 */
export function useCurrentUser({ required }: { required: boolean }): Loadable<User | null> {
  const load = useCallback(
    () =>
      api.whoami().catch((error: unknown) => {
        if (!required && error instanceof api.ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }),
    [required],
  );
  return useLoadable<User | null>(load);
}
