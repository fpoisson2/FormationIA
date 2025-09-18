const envApiBase = import.meta.env.VITE_API_BASE_URL?.trim();
const sanitizedEnvBase = (() => {
  if (!envApiBase) {
    return undefined;
  }
  const trimmed = envApiBase.replace(/\/$/, "");
  if (/^https?:\/\/[^/]+$/.test(trimmed)) {
    return `${trimmed}/api`;
  }
  if (trimmed === "" || trimmed === "/") {
    return "/api";
  }
  return trimmed;
})();
const isLocalHost =
  typeof window !== "undefined" && window.location.origin.startsWith("http://localhost");
const fallbackApiBase = isLocalHost ? "http://localhost:8001/api" : "/api";

export const API_BASE_URL = sanitizedEnvBase ?? fallbackApiBase;
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
