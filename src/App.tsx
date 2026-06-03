import { Navigate, Route, Routes } from "react-router";

import { CreateProjectPage } from "./pages/CreateProjectPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/projects/new" element={<CreateProjectPage />} />
      <Route path="/project/:projectId" element={<ProjectPage panel="timeline" />} />
      <Route path="/project/:projectId/records/new" element={<ProjectPage panel="newRecord" />} />
      <Route
        path="/project/:projectId/records/:recordId"
        element={<ProjectPage panel="recordDetail" />}
      />
      <Route path="/project/:projectId/settings" element={<ProjectPage panel="settings" />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
