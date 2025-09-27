import { STEP_COMPONENT_REGISTRY } from "./registry";
import type { StepSequenceModuleMetadata } from "./types";

export interface StepSequenceModuleConfig {
  key: string;
  enabled?: boolean;
  title?: string | null;
  description?: string | null;
  coverImage?: string | null;
}

export interface StepSequenceModuleLibraryEntry {
  key: string;
  title: string;
  description: string;
  coverImage: string;
  enabled: boolean;
  metadata: StepSequenceModuleMetadata;
}

type ModulePreset = {
  title: string;
  description: string;
  emoji: string;
  gradient: [string, string];
};

const STEP_SEQUENCE_MODULE_LABELS: Record<string, string> = {
  "rich-content": "Contenu riche",
  form: "Formulaire guidé",
  "simulation-chat": "Simulation de chat",
  video: "Vidéo interactive",
  "prompt-evaluation": "Évaluation de prompt",
  "ai-comparison": "Comparaison IA",
  "info-cards": "Cartes d'information",
  "clarity-map": "Carte de clarté",
  "clarity-prompt": "Brief de clarté",
  composite: "Étape composite",
  "explorateur-world": "Explorateur IA",
  "workshop-context": "Atelier · Contexte",
  "workshop-comparison": "Atelier · Comparaison",
  "workshop-synthesis": "Atelier · Synthèse",
};

export const HIDDEN_STEP_SEQUENCE_MODULE_PREFIXES = ["workshop-"];

function createGradientPlaceholder(
  emoji: string,
  gradient: [string, string]
): string {
  const [start, end] = gradient;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">` +
    `<defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="${start}"/><stop offset="100%" stop-color="${end}"/>` +
    `</linearGradient></defs>` +
    `<rect width="480" height="270" rx="36" fill="url(#grad)"/>` +
    `<text x="50%" y="52%" text-anchor="middle" font-family="'Inter', 'Segoe UI', sans-serif" font-size="96" fill="white"` +
    ` dominant-baseline="middle">${emoji}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const MODULE_LIBRARY_PRESETS: Record<string, ModulePreset> = {
  "rich-content": {
    title: "Contenu riche",
    description:
      "Présente un texte guidé avec options de mise en forme, d'illustrations et de sidebar.",
    emoji: "🧭",
    gradient: ["#f97316", "#fb923c"],
  },
  form: {
    title: "Formulaire guidé",
    description:
      "Collecte des réponses structurées (texte, listes, choix) avec validations personnalisées.",
    emoji: "📝",
    gradient: ["#0ea5e9", "#38bdf8"],
  },
  "simulation-chat": {
    title: "Simulation de chat",
    description:
      "Fais dialoguer l'apprenant avec un personnage IA selon différents scénarios et étapes.",
    emoji: "💬",
    gradient: ["#a855f7", "#d946ef"],
  },
  video: {
    title: "Vidéo interactive",
    description:
      "Intègre une vidéo hébergée avec transcription, ressources complémentaires et contrôle du rythme.",
    emoji: "🎬",
    gradient: ["#ef4444", "#f97316"],
  },
  "prompt-evaluation": {
    title: "Évaluation de prompt",
    description:
      "Évalue automatiquement un prompt selon plusieurs critères avec un score détaillé.",
    emoji: "🧪",
    gradient: ["#22c55e", "#4ade80"],
  },
  "ai-comparison": {
    title: "Comparaison de modèles",
    description:
      "Compare les sorties de deux configurations IA pour analyser leurs forces et limites.",
    emoji: "⚖️",
    gradient: ["#0ea5e9", "#6366f1"],
  },
  "info-cards": {
    title: "Cartes d'information",
    description:
      "Affiche des cartes synthétiques pour présenter missions, conseils ou ressources clés.",
    emoji: "🗂️",
    gradient: ["#facc15", "#f97316"],
  },
  "clarity-map": {
    title: "Carte de clarté",
    description:
      "Cartographie un plan d'actions sur une grille 10×10 pour visualiser la progression.",
    emoji: "🗺️",
    gradient: ["#22d3ee", "#38bdf8"],
  },
  "clarity-prompt": {
    title: "Brief de clarté",
    description:
      "Guide la formulation d'une consigne claire avant de l'envoyer à l'IA.",
    emoji: "🔍",
    gradient: ["#6366f1", "#a855f7"],
  },
  composite: {
    title: "Étape composite",
    description:
      "Assemble plusieurs sous-modules dans une même étape orchestrée.",
    emoji: "🧩",
    gradient: ["#64748b", "#0ea5e9"],
  },
  "explorateur-world": {
    title: "Monde Explorateur",
    description:
      "Affiche un quartier immersif de l'Explorateur IA avec missions et interactions contextuelles.",
    emoji: "🌍",
    gradient: ["#0f766e", "#22d3ee"],
  },
};

const FALLBACK_PRESET: ModulePreset = {
  title: "Module personnalisé",
  description:
    "Ajoute ton propre module StepSequence et configure ses paramètres après import.",
  emoji: "✨",
  gradient: ["#4b5563", "#9ca3af"],
};

const trimToNull = (value: unknown): string | null | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "undefined") {
    return undefined;
  }
  return null;
};

export function getStepSequenceModuleLabel(key: string): string {
  return STEP_SEQUENCE_MODULE_LABELS[key] ?? key;
}

export function listRegisteredStepSequenceModuleKeys(): string[] {
  return Object.keys(STEP_COMPONENT_REGISTRY)
    .filter(
      (key) =>
        !HIDDEN_STEP_SEQUENCE_MODULE_PREFIXES.some((prefix) =>
          key.startsWith(prefix)
        )
    )
    .sort((a, b) => a.localeCompare(b));
}

export function sanitizeStepSequenceModuleConfig(
  value: unknown
): StepSequenceModuleConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keyRaw = record.key;
  if (typeof keyRaw !== "string" || !keyRaw.trim()) {
    return null;
  }

  const sanitized: StepSequenceModuleConfig = {
    key: keyRaw.trim(),
  };

  if (typeof record.enabled === "boolean") {
    sanitized.enabled = record.enabled;
  }

  if ("title" in record) {
    const title = trimToNull(record.title);
    if (title !== undefined) {
      sanitized.title = title;
    }
  }
  if ("description" in record) {
    const description = trimToNull(record.description);
    if (description !== undefined) {
      sanitized.description = description;
    }
  }
  if ("coverImage" in record) {
    const coverImage = trimToNull(record.coverImage);
    if (coverImage !== undefined) {
      sanitized.coverImage = coverImage;
    }
  }

  return sanitized;
}

export function sanitizeStepSequenceModuleConfigList(
  value: unknown
): StepSequenceModuleConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: StepSequenceModuleConfig[] = [];

  for (const entry of value) {
    const sanitized = sanitizeStepSequenceModuleConfig(entry);
    if (!sanitized) {
      continue;
    }
    if (seen.has(sanitized.key)) {
      continue;
    }
    seen.add(sanitized.key);
    result.push(sanitized);
  }

  return result;
}

export function getStepSequenceModuleLibraryEntry(
  key: string,
  fallbackTitle?: string,
  config?: StepSequenceModuleConfig | null
): StepSequenceModuleLibraryEntry {
  const preset = MODULE_LIBRARY_PRESETS[key] ?? FALLBACK_PRESET;
  const fallback = fallbackTitle ?? preset.title ?? `Module ${key}`;
  const description = preset.description;
  const coverImage = createGradientPlaceholder(preset.emoji, preset.gradient);

  const metadata = mergeModuleMetadata(
    {
      title: fallback,
      description,
      coverImage,
    },
    {
      title: config?.title ?? undefined,
      description: config?.description ?? undefined,
      coverImage: config?.coverImage ?? undefined,
    }
  );

  return {
    key,
    title: metadata.title ?? fallback,
    description: metadata.description ?? description,
    coverImage: metadata.coverImage ?? coverImage,
    enabled: config?.enabled !== false,
    metadata,
  };
}

export function mergeModuleMetadata(
  base: StepSequenceModuleMetadata | null | undefined,
  override: Partial<StepSequenceModuleMetadata>
): StepSequenceModuleMetadata {
  const normalizedBase = base ?? {};
  return {
    ...normalizedBase,
    ...override,
  };
}
