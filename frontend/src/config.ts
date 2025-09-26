const envApiBase = import.meta.env.VITE_API_BASE_URL?.trim();

// Simplification : utiliser directement l'URL fournie ou le fallback
export const API_BASE_URL = envApiBase || "http://localhost:8001/api";
export const API_AUTH_KEY = import.meta.env.VITE_API_AUTH_KEY ?? "";

export const MODEL_OPTIONS = [
  {
    value: "gpt-5-nano",
    label: "Profil rapide",
    helper: "Priorise la réactivité et des réponses synthétiques, idéal pour une première lecture."
  },
  {
    value: "gpt-5-mini",
    label: "Profil expert",
    helper: "Explore davantage de nuances et de justification, parfait pour une analyse approfondie."
  },
  {
    value: "gpt-5",
    label: "Profil intégral",
    helper: "Mobilise toute la profondeur analytique du modèle pour des scénarios exigeants et complexes."
  }
];

export const VERBOSITY_OPTIONS = [
  { value: "low", label: "Succinct" },
  { value: "medium", label: "Équilibré" },
  { value: "high", label: "Détaillé" }
];

export const THINKING_OPTIONS = [
  { value: "minimal", label: "Minimal" },
  { value: "medium", label: "Standard" },
  { value: "high", label: "Analytique" }
];

export type ModelChoice = (typeof MODEL_OPTIONS)[number]["value"];
export type VerbosityChoice = (typeof VERBOSITY_OPTIONS)[number]["value"];
export type ThinkingChoice = (typeof THINKING_OPTIONS)[number]["value"];

export interface ModelConfig {
  model: ModelChoice;
  verbosity: VerbosityChoice;
  thinking: ThinkingChoice;
}
