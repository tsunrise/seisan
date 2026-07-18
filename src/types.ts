import type * as api from "./api";

export type Loadable<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string; errorCode?: string | null };

export interface User {
  email: string;
  sessionExpiresAt?: number;
}

export type ProjectPanel =
  | "timeline"
  | "join"
  | "newRecord"
  | "settle"
  | "recordDetail"
  | "settings";

export type SplitMode = "equal" | "ratio" | "custom";

export interface ProjectChildProps {
  project: api.Project;
}
