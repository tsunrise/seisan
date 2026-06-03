import { useEffect, useState } from "react";

import * as api from "../api";
import type { Loadable } from "../types";

export function useProject(projectId: string, reloadKey: number): Loadable<api.Project> {
  const [state, setState] = useState<Loadable<api.Project>>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    api
      .getProject(projectId, { limit: 100 })
      .then((project) => {
        if (active) {
          setState({ status: "ready", data: project, error: null });
        }
      })
      .catch(() => {
        if (active) {
          setState({ status: "error", data: null, error: "Could not load project." });
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, reloadKey]);

  return state;
}
