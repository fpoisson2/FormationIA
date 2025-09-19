import { Navigate, Route, Routes } from "react-router-dom";

import ActivitySelector from "./pages/ActivitySelector";
import { ACTIVITY_DEFINITIONS } from "./config/activities";
import { AdminGuard } from "./pages/admin/AdminGuard";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminLocalUsersPage } from "./pages/admin/AdminLocalUsersPage";
import { AdminLoginPage } from "./pages/admin/AdminLoginPage";
import { AdminLtiUsersPage } from "./pages/admin/AdminLtiUsersPage";
import { AdminPlatformsPage } from "./pages/admin/AdminPlatformsPage";

function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/activites" replace />} />
      <Route path="/activites" element={<ActivitySelector />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route element={<AdminGuard />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="platforms" replace />} />
          <Route path="platforms" element={<AdminPlatformsPage />} />
          <Route path="lti-users" element={<AdminLtiUsersPage />} />
          <Route path="local-users" element={<AdminLocalUsersPage />} />
        </Route>
      </Route>
      {ACTIVITY_DEFINITIONS.map((definition) => (
        <Route key={definition.id} path={definition.path} element={definition.element} />
      ))}
      <Route path="*" element={<Navigate to="/activites" replace />} />
    </Routes>
  );
}

export default App;
