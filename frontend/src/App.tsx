import { Navigate, Route, Routes } from "react-router-dom";

import ActivitySelector from "./pages/ActivitySelector";
import { ACTIVITY_DEFINITIONS, buildActivityElement } from "./config/activities";
import { ActivityAccessGuard } from "./components/ActivityAccessGuard";
import { AdminGuard } from "./pages/admin/AdminGuard";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminLocalUsersPage } from "./pages/admin/AdminLocalUsersPage";
import { LoginPage } from "./pages/LoginPage";
import { AdminLtiUsersPage } from "./pages/admin/AdminLtiUsersPage";
import { AdminPlatformsPage } from "./pages/admin/AdminPlatformsPage";
import { AdminActivityTrackingPage } from "./pages/admin/AdminActivityTrackingPage";

function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/activites" replace />} />
      <Route
        path="/activites"
        element={
          <ActivityAccessGuard>
            <ActivitySelector />
          </ActivityAccessGuard>
        }
      />
      <Route path="/connexion" element={<LoginPage />} />
      <Route element={<AdminGuard />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="platforms" replace />} />
          <Route path="platforms" element={<AdminPlatformsPage />} />
          <Route path="lti-users" element={<AdminLtiUsersPage />} />
          <Route path="local-users" element={<AdminLocalUsersPage />} />
          <Route path="activity-tracking" element={<AdminActivityTrackingPage />} />
        </Route>
      </Route>
      {ACTIVITY_DEFINITIONS.map((definition) => (
        <Route
          key={definition.id}
          path={definition.path}
          element={<ActivityAccessGuard>{buildActivityElement(definition)}</ActivityAccessGuard>}
        />
      ))}
      <Route path="*" element={<Navigate to="/activites" replace />} />
    </Routes>
  );
}

export default App;
