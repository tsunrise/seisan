import { useEffect, useState } from "react";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import type { Loadable } from "../types";

export function useProjects(
  enabled: boolean,
): Loadable<Array<api.WithSyncTime<api.ProjectSummary>>> {
  const [state, setState] = useState<Loadable<Array<api.WithSyncTime<api.ProjectSummary>>>>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;
    api
      .listProjects()
      .then((projects) => {
        if (active) {
          setState({ status: "ready", data: projects, error: null });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: getApiErrorMessage(error),
            errorCode: error instanceof api.ApiError ? error.code : null,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
}
