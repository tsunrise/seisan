import * as api from "../api";
import type { Loadable } from "../types";
import { useLoadable } from "./useLoadable";

export function useProjects(
  enabled: boolean,
): Loadable<Array<api.WithSyncTime<api.ProjectSummary>>> {
  return useLoadable(enabled ? api.listProjects : null);
}
