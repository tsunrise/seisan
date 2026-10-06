// Project routes. `ProjectPage` renders every panel route; on mobile the panel replaces the
// timeline, and on wider layouts it fills the right-hand column.

export type ProjectPanel =
  | "timeline"
  | "join"
  | "newRecord"
  | "editRecord"
  | "settle"
  | "recordDetail"
  | "settings"
  | "settingsName"
  | "settingsProfile"
  | "settingsMembers"
  | "settingsAccess";

export const projectPanelRoutes: ReadonlyArray<{ path: string; panel: ProjectPanel }> = [
  { path: "/project/:projectId", panel: "timeline" },
  { path: "/project/:projectId/join", panel: "join" },
  { path: "/project/:projectId/records/new", panel: "newRecord" },
  { path: "/project/:projectId/settle", panel: "settle" },
  { path: "/project/:projectId/records/:recordId", panel: "recordDetail" },
  { path: "/project/:projectId/records/:recordId/edit", panel: "editRecord" },
  { path: "/project/:projectId/settings", panel: "settings" },
  { path: "/project/:projectId/settings/profile", panel: "settingsProfile" },
  { path: "/project/:projectId/settings/name", panel: "settingsName" },
  { path: "/project/:projectId/settings/members", panel: "settingsMembers" },
  { path: "/project/:projectId/settings/access", panel: "settingsAccess" },
];

export const projectPaths = {
  timeline: (projectId: string) => `/project/${projectId}`,
  join: (projectId: string) => `/project/${projectId}/join`,
  newRecord: (projectId: string, search = "") =>
    `/project/${projectId}/records/new${search ? `?${search}` : ""}`,
  settle: (projectId: string) => `/project/${projectId}/settle`,
  record: (projectId: string, recordId: number) => `/project/${projectId}/records/${recordId}`,
  editRecord: (projectId: string, recordId: number) =>
    `/project/${projectId}/records/${recordId}/edit`,
  settings: (projectId: string) => `/project/${projectId}/settings`,
  settingsProfile: (projectId: string) => `/project/${projectId}/settings/profile`,
  settingsName: (projectId: string) => `/project/${projectId}/settings/name`,
  settingsMembers: (projectId: string) => `/project/${projectId}/settings/members`,
  settingsAccess: (projectId: string) => `/project/${projectId}/settings/access`,
};
