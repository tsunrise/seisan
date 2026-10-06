import { useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";

import { useCurrentUser } from "../hooks/useCurrentUser";
import { loginPath } from "../utils";
import { AccountHome } from "./AccountHome";
import { AccountLoading, AccountShell } from "./AccountShell";
import { ApiKeysPage } from "./apiKeys/ApiKeysPage";
import { accountBackTarget, accountLinkState } from "./navigation";

export default function AccountApp() {
  const location = useLocation();
  const user = useCurrentUser({ required: true });
  const [backTarget] = useState(() => accountBackTarget(location.state));
  const navigationState = backTarget ? accountLinkState(backTarget.label) : undefined;

  if (user.status === "loading") {
    return <AccountLoading />;
  }
  if (user.status === "error" || !user.data) {
    return <Navigate to={loginPath(location)} replace />;
  }

  return (
    <AccountShell email={user.data.email} backTarget={backTarget} navigationState={navigationState}>
      <Routes>
        <Route
          index
          element={
            <AccountHome
              email={user.data.email}
              sessionExpiresAt={user.data.sessionExpiresAt ?? null}
              navigationState={navigationState}
            />
          }
        />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="*" element={<Navigate to="/account" replace />} />
      </Routes>
    </AccountShell>
  );
}
