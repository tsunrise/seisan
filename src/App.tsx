import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";

import { GroupExpenseCalculatorPage } from "./calculator/GroupExpenseCalculatorPage";
import { AppSnackbarProvider } from "./components/AppSnackbar";
import { CreateProjectPage } from "./pages/CreateProjectPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { projectPanelRoutes } from "./project/paths";
import { ProjectPage } from "./project/ProjectPage";

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

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
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
            <Lazy>
              <ApiDocsPage />
            </Lazy>
          }
        />
        <Route path="/account/api-docs" element={<Navigate to="/api-docs" replace />} />
        <Route
          path="/admin/*"
          element={
            <Lazy>
              <AdminApp />
            </Lazy>
          }
        />
        <Route
          path="/account/*"
          element={
            <Lazy>
              <AccountApp />
            </Lazy>
          }
        />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<CreateProjectPage />} />
        {projectPanelRoutes.map(({ path, panel }) => (
          <Route key={path} path={path} element={<ProjectPage panel={panel} />} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppSnackbarProvider>
  );
}
