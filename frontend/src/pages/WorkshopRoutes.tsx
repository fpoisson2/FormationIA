import { Dispatch, SetStateAction, useMemo } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import Layout from "../components/Layout";
import type { Flashcard } from "../types/flashcards";
import type { ModelConfig } from "../config";
import StepOne from "./StepOne";
import StepThree from "./StepThree";
import StepTwo from "./StepTwo";

interface WorkshopRoutesProps {
  sourceText: string;
  setSourceText: Dispatch<SetStateAction<string>>;
  configA: ModelConfig;
  configB: ModelConfig;
  setConfigA: Dispatch<SetStateAction<ModelConfig>>;
  setConfigB: Dispatch<SetStateAction<ModelConfig>>;
  summaryA: string;
  summaryB: string;
  setSummaryA: Dispatch<SetStateAction<string>>;
  setSummaryB: Dispatch<SetStateAction<string>>;
  flashcardsA: Flashcard[];
  flashcardsB: Flashcard[];
  setFlashcardsA: Dispatch<SetStateAction<Flashcard[]>>;
  setFlashcardsB: Dispatch<SetStateAction<Flashcard[]>>;
}

function WorkshopRoutes({
  sourceText,
  setSourceText,
  configA,
  configB,
  setConfigA,
  setConfigB,
  summaryA,
  summaryB,
  setSummaryA,
  setSummaryB,
  flashcardsA,
  flashcardsB,
  setFlashcardsA,
  setFlashcardsB,
}: WorkshopRoutesProps): JSX.Element {
  const location = useLocation();

  const stepIndex = useMemo(() => {
    if (location.pathname.includes("etape-1")) return 1;
    if (location.pathname.includes("etape-2")) return 2;
    if (location.pathname.includes("etape-3")) return 3;
    return 1;
  }, [location.pathname]);

  return (
    <Layout currentStep={stepIndex}>
      <Routes>
        <Route index element={<Navigate to="etape-1" replace />} />
        <Route
          path="etape-1"
          element={
            <StepOne
              sourceText={sourceText}
              onSourceTextChange={setSourceText}
            />
          }
        />
        <Route
          path="etape-2"
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
          path="etape-3"
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
        <Route path="*" element={<Navigate to="etape-1" replace />} />
      </Routes>
    </Layout>
  );
}

export default WorkshopRoutes;
