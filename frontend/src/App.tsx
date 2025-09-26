import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import ActivitySelector from "./pages/ActivitySelector";
import LandingPage from "./pages/LandingPage";
import {
  ACTIVITY_CATALOG,
  buildActivityElement,
  resolveActivityDefinition,
  type ActivityConfigEntry,
} from "./config/activities";
import { ActivityAccessGuard } from "./components/ActivityAccessGuard";
import { AdminGuard } from "./pages/admin/AdminGuard";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminLocalUsersPage } from "./pages/admin/AdminLocalUsersPage";
import { LoginPage } from "./pages/LoginPage";
import { AdminLtiUsersPage } from "./pages/admin/AdminLtiUsersPage";
import { AdminPlatformsPage } from "./pages/admin/AdminPlatformsPage";
import { AdminActivityTrackingPage } from "./pages/admin/AdminActivityTrackingPage";
import { AdminActivityGenerationPage } from "./pages/admin/AdminActivityGenerationPage";
import { activities as activitiesClient } from "./api";

function App(): JSX.Element {
  const [configEntries, setConfigEntries] = useState<ActivityConfigEntry[] | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      try {
        const response = await activitiesClient.getConfig();
        if (cancelled) {
          return;
        }
        if (Array.isArray(response.activities)) {
          setConfigEntries(response.activities as ActivityConfigEntry[]);
        } else {
          setConfigEntries([]);
        }
      } catch (error) {
        console.warn("Impossible de charger la configuration des activités", error);
        if (!cancelled) {
          setConfigEntries([]);
        }
      }
    };

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedActivities = useMemo(() => {
    const entries: ActivityConfigEntry[] = [];
    const seen = new Set<string>();

    if (configEntries && configEntries.length > 0) {
      for (const entry of configEntries) {
        if (entry && typeof entry.id === "string") {
          entries.push(entry);
          seen.add(entry.id);
        }
      }
    }

    for (const id of Object.keys(ACTIVITY_CATALOG)) {
      if (!seen.has(id)) {
        entries.push({ id } as ActivityConfigEntry);
      }
    }

    if (entries.length === 0) {
      for (const id of Object.keys(ACTIVITY_CATALOG)) {
        entries.push({ id } as ActivityConfigEntry);
      }
    }

    return entries.map((entry) => ({
      entry,
      definition: resolveActivityDefinition(entry),
    }));
  }, [configEntries]);

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
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
          <Route
            path="activity-generation"
            element={<AdminActivityGenerationPage />}
          />
          <Route path="platforms" element={<AdminPlatformsPage />} />
          <Route path="lti-users" element={<AdminLtiUsersPage />} />
          <Route path="local-users" element={<AdminLocalUsersPage />} />
          <Route
            path="activity-tracking"
            element={<AdminActivityTrackingPage />}
          />
        </Route>
      </Route>
      {resolvedActivities
        .filter(({ definition }) => definition.enabled !== false)
        .map(({ entry, definition }) => (
          <Route
            key={definition.id}
            path={definition.path}
            element={
              <ActivityAccessGuard>
                {buildActivityElement(entry)}
              </ActivityAccessGuard>
            }
          />
        ))}
      <Route path="*" element={<Navigate to="/activites" replace />} />
    </Routes>
  );
}

export default App;
