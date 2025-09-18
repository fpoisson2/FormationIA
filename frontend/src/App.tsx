import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import ActivitySelector from "./pages/ActivitySelector";
import PromptDojo from "./pages/PromptDojo";
import ClarityPath from "./pages/ClarityPath";
import ClarteDabord from "./pages/ClarteDabord";
import WorkshopRoutes from "./pages/WorkshopRoutes";
import type { ModelConfig } from "./config";
import { MODEL_OPTIONS } from "./config";

export interface Flashcard {
  question: string;
  reponse: string;
}

const DEFAULT_TEXT = `L'automatisation est particulièrement utile pour structurer des notes de cours, créer des rappels et générer des résumés ciblés. Les étudiantes et étudiants qui savent dialoguer avec l'IA peuvent obtenir des analyses précises, du survol rapide jusqu'à des synthèses détaillées. Comprendre comment ajuster les paramètres du modèle aide à mieux contrôler la production, à gagner du temps et à repérer les limites de l'outil.`;

const DEFAULT_CONFIG_A: ModelConfig = {
  model: MODEL_OPTIONS[0].value,
  verbosity: "medium",
  thinking: "minimal",
};

const DEFAULT_CONFIG_B: ModelConfig = {
  model: MODEL_OPTIONS[1].value,
  verbosity: "high",
  thinking: "high",
};

function App(): JSX.Element {
  const [sourceText, setSourceText] = useState(DEFAULT_TEXT);
  const [configA, setConfigA] = useState<ModelConfig>(DEFAULT_CONFIG_A);
  const [configB, setConfigB] = useState<ModelConfig>(DEFAULT_CONFIG_B);
  const [summaryA, setSummaryA] = useState("");
  const [summaryB, setSummaryB] = useState("");
  const [flashcardsA, setFlashcardsA] = useState<Flashcard[]>([]);
  const [flashcardsB, setFlashcardsB] = useState<Flashcard[]>([]);

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/activites" replace />} />
      <Route path="/activites" element={<ActivitySelector />} />
      <Route path="/prompt-dojo" element={<PromptDojo />} />
      <Route path="/parcours-clarte" element={<ClarityPath />} />
      <Route path="/clarte-dabord" element={<ClarteDabord />} />
      <Route
        path="/atelier/*"
        element={
          <WorkshopRoutes
            sourceText={sourceText}
            setSourceText={setSourceText}
            configA={configA}
            configB={configB}
            setConfigA={setConfigA}
            setConfigB={setConfigB}
            summaryA={summaryA}
            summaryB={summaryB}
            setSummaryA={setSummaryA}
            setSummaryB={setSummaryB}
            flashcardsA={flashcardsA}
            flashcardsB={flashcardsB}
            setFlashcardsA={setFlashcardsA}
            setFlashcardsB={setFlashcardsB}
          />
        }
      />
      <Route path="*" element={<Navigate to="/activites" replace />} />
    </Routes>
  );
}

export default App;
