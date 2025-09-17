import { useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import Layout from "./components/Layout";
import StepOne from "./pages/StepOne";
import StepTwo from "./pages/StepTwo";
import StepThree from "./pages/StepThree";
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
  const location = useLocation();

  const stepIndex = useMemo(() => {
    if (location.pathname.startsWith("/etape-1")) return 1;
    if (location.pathname.startsWith("/etape-2")) return 2;
    if (location.pathname.startsWith("/etape-3")) return 3;
    return 1;
  }, [location.pathname]);

  const [sourceText, setSourceText] = useState(DEFAULT_TEXT);
  const [configA, setConfigA] = useState<ModelConfig>(DEFAULT_CONFIG_A);
  const [configB, setConfigB] = useState<ModelConfig>(DEFAULT_CONFIG_B);
  const [summaryA, setSummaryA] = useState("");
  const [summaryB, setSummaryB] = useState("");
  const [flashcardsA, setFlashcardsA] = useState<Flashcard[]>([]);
  const [flashcardsB, setFlashcardsB] = useState<Flashcard[]>([]);

  return (
    <Layout currentStep={stepIndex}>
      <Routes>
        <Route
          path="/"
          element={<Navigate to="/etape-1" replace />}
        />
        <Route
          path="/etape-1"
          element={
            <StepOne
              sourceText={sourceText}
              onSourceTextChange={setSourceText}
            />
          }
        />
        <Route
          path="/etape-2"
          element={
            <StepTwo
              sourceText={sourceText}
              configA={configA}
              configB={configB}
              setConfigA={setConfigA}
              setConfigB={setConfigB}
              summaryA={summaryA}
              summaryB={summaryB}
              setSummaryA={setSummaryA}
              setSummaryB={setSummaryB}
            />
          }
        />
        <Route
          path="/etape-3"
          element={
            <StepThree
              sourceText={sourceText}
              summaryA={summaryA}
              summaryB={summaryB}
              flashcardsA={flashcardsA}
              flashcardsB={flashcardsB}
              setFlashcardsA={setFlashcardsA}
              setFlashcardsB={setFlashcardsB}
              configA={configA}
              configB={configB}
            />
          }
        />
        <Route path="*" element={<Navigate to="/etape-1" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
