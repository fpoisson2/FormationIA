import { useState } from "react";

import { MODEL_OPTIONS, type ModelConfig } from "../config";
import type { Flashcard } from "../types/flashcards";
import WorkshopRoutes from "./WorkshopRoutes";

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

function WorkshopExperience(): JSX.Element {
  const [sourceText, setSourceText] = useState(DEFAULT_TEXT);
  const [configA, setConfigA] = useState<ModelConfig>(DEFAULT_CONFIG_A);
  const [configB, setConfigB] = useState<ModelConfig>(DEFAULT_CONFIG_B);
  const [summaryA, setSummaryA] = useState("");
  const [summaryB, setSummaryB] = useState("");
  const [flashcardsA, setFlashcardsA] = useState<Flashcard[]>([]);
  const [flashcardsB, setFlashcardsB] = useState<Flashcard[]>([]);

  return (
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
  );
}

export default WorkshopExperience;
