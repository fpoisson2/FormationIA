import { Navigate, Route, Routes } from "react-router-dom";

import ActivitySelector from "./pages/ActivitySelector";
import { ACTIVITY_DEFINITIONS } from "./config/activities";

function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/activites" replace />} />
      <Route path="/activites" element={<ActivitySelector />} />
      {ACTIVITY_DEFINITIONS.map((definition) => (
        <Route key={definition.id} path={definition.path} element={definition.element} />
      ))}
      <Route path="*" element={<Navigate to="/activites" replace />} />
    </Routes>
  );
}

export default App;
