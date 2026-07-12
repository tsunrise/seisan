import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";

import { CreateProjectPage } from "./pages/CreateProjectPage";
import { AppSnackbarProvider } from "./components/AppSnackbar";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { PrivacyPage } from "./pages/PrivacyPage";

const AdminApp = lazy(() => import("./admin/AdminApp"));
const AccountApp = lazy(() => import("./account/AccountApp"));

export default function App() {
  return (
    <AppSnackbarProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={null}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route
          path="/account/*"
          element={
            <Suspense fallback={null}>
              <AccountApp />
            </Suspense>
          }
        />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<CreateProjectPage />} />
        <Route path="/project/:projectId" element={<ProjectPage panel="timeline" />} />
        <Route path="/project/:projectId/join" element={<ProjectPage panel="join" />} />
        <Route path="/project/:projectId/records/new" element={<ProjectPage panel="newRecord" />} />
        <Route
          path="/project/:projectId/records/:recordId"
          element={<ProjectPage panel="recordDetail" />}
        />
        <Route path="/project/:projectId/settings" element={<ProjectPage panel="settings" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppSnackbarProvider>
  );
}
