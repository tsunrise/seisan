import { useEffect, useState } from "react";

import * as api from "../api";
import type { Loadable } from "../types";

export function useProjects(enabled: boolean): Loadable<api.ProjectSummary[]> {
  const [state, setState] = useState<Loadable<api.ProjectSummary[]>>({
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
      .catch(() => {
        if (active) {
          setState({ status: "error", data: null, error: "Could not load projects." });
        }
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
}
