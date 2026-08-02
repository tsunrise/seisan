import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";

import { CreateProjectPage } from "./pages/CreateProjectPage";
import { AppSnackbarProvider } from "./components/AppSnackbar";
import { GroupExpenseCalculatorPage } from "./pages/GroupExpenseCalculatorPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { PrivacyPage } from "./pages/PrivacyPage";

const AdminApp = lazy(() => import("./admin/AdminApp"));
const AccountApp = lazy(() => import("./account/AccountApp"));
const ApiDocsPage = lazy(() => import("./pages/ApiDocsPage"));

function ResetIndexScroll() {
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === "/") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [location.key, location.pathname]);

  return null;
}

export default function App() {
  return (
    <AppSnackbarProvider>
      <ResetIndexScroll />
      <Routes>
        <Route path="/" element={<GroupExpenseCalculatorPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route
          path="/api-docs"
          element={
            <Suspense fallback={null}>
              <ApiDocsPage />
            </Suspense>
          }
        />
        <Route path="/account/api-docs" element={<Navigate to="/api-docs" replace />} />
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
        <Route path="/project/:projectId/settle" element={<ProjectPage panel="settle" />} />
        <Route
          path="/project/:projectId/records/:recordId"
          element={<ProjectPage panel="recordDetail" />}
        />
        <Route
          path="/project/:projectId/records/:recordId/edit"
          element={<ProjectPage panel="editRecord" />}
        />
        <Route path="/project/:projectId/settings" element={<ProjectPage panel="settings" />} />
        <Route
          path="/project/:projectId/settings/profile"
          element={<ProjectPage panel="settingsProfile" />}
        />
        <Route
          path="/project/:projectId/settings/name"
          element={<ProjectPage panel="settingsName" />}
        />
        <Route
          path="/project/:projectId/settings/members"
          element={<ProjectPage panel="settingsMembers" />}
        />
        <Route
          path="/project/:projectId/settings/access"
          element={<ProjectPage panel="settingsAccess" />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppSnackbarProvider>
  );
}
