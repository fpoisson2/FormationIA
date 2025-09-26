import {
  isCompositeStepDefinition,
  type StepDefinition,
} from "../../../../modules/step-sequence";

import {
  DEFAULT_CLARTE_QUIZ_CONFIG,
  DEFAULT_CREATION_BUILDER_CONFIG,
  DEFAULT_DECISION_PATH_CONFIG,
  DEFAULT_ETHICS_DILEMMAS_CONFIG,
} from "../../modules";
import {
  DEFAULT_EXPLORATEUR_QUARTERS,
  deriveQuarterData,
} from "../../config";
import { isQuarterId, type QuarterId } from "../../types";

export type QuarterSteps = Record<QuarterId, StepDefinition[]>;

const DEFAULT_QUARTER_ORDER = deriveQuarterData(
  DEFAULT_EXPLORATEUR_QUARTERS
).quarterOrder;

function cloneConfig<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("Unable to clone step configuration", error);
    }
    return value;
  }
}

function cloneStep(step: StepDefinition): StepDefinition {
  if (typeof isCompositeStepDefinition === "function" && isCompositeStepDefinition(step)) {
    return {
      ...step,
      composite: cloneConfig(step.composite),
    };
  }
  return {
    ...step,
    config: step.config == null ? step.config : cloneConfig(step.config),
    composite: step.composite ?? null,
  };
}

const CLARTE_STEPS: StepDefinition[] = [
  {
    id: "clarte:intro",
    component: "rich-content",
    config: {
      title: "Bienvenue au quartier Clarté",
      body: "Explorez ce qui rend une consigne précise et actionnable avant de tester vos choix.",
      sidebar: {
        type: "tips",
        title: "Checklist clarté",
        tips: [
          "Préciser le résultat attendu",
          "Indiquer le format et la longueur",
          "Contextualiser pour le public cible",
        ],
      },
    },
  },
  {
    id: "clarte:video",
    component: "video",
    config: {
      sources: [
        {
          type: "mp4",
          url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
        },
      ],
      expectedDuration: 45,
      autoAdvanceOnEnd: false,
      poster:
        "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=800&q=80",
    },
  },
  {
    id: "clarte:quiz",
    component: "custom",
    config: DEFAULT_CLARTE_QUIZ_CONFIG,
  },
];

const CREATION_STEPS: StepDefinition[] = [
  {
    id: "creation:intro",
    component: "rich-content",
    config: {
      title: "Quartier Création",
      body: "Assemblez une consigne sur-mesure en combinant action, média, style et thème.",
      sidebar: {
        type: "checklist",
        title: "Étapes",
        items: [
          { id: "select-action", label: "Sélectionner un verbe d'action", checked: false },
          { id: "select-media", label: "Choisir un média adapté", checked: false },
          { id: "select-style", label: "Définir le ton et le style", checked: false },
          { id: "select-theme", label: "Associer un thème", checked: false },
        ],
      },
    },
  },
  {
    id: "creation:builder",
    component: "custom",
    config: DEFAULT_CREATION_BUILDER_CONFIG,
  },
  {
    id: "creation:reflection",
    component: "form",
    config: {
      submitLabel: "Enregistrer ma synthèse",
      fields: [
        {
          id: "audience",
          type: "textarea_with_counter",
          label: "Décrivez le public cible",
          minWords: 10,
          maxWords: 80,
        },
        {
          id: "outcome",
          type: "bulleted_list",
          label: "Quels livrables attendez-vous ?",
          minBullets: 2,
          maxBullets: 4,
          maxWordsPerBullet: 12,
        },
      ],
    },
  },
];

const DECISION_STEPS: StepDefinition[] = [
  {
    id: "decision:intro",
    component: "rich-content",
    config: {
      title: "Quartier Décision",
      body: "Expérimentez différentes stratégies et observez leurs compromis pour mener votre projet.",
    },
  },
  {
    id: "decision:path",
    component: "custom",
    config: DEFAULT_DECISION_PATH_CONFIG,
  },
];

const ETHIQUE_STEPS: StepDefinition[] = [
  {
    id: "ethique:intro",
    component: "rich-content",
    config: {
      title: "Quartier Éthique",
      body: "Chaque scénario illustre une dérive potentielle. Sélectionnez la réponse qui protège au mieux les usagers.",
    },
  },
  {
    id: "ethique:dilemmas",
    component: "custom",
    config: DEFAULT_ETHICS_DILEMMAS_CONFIG,
  },
  {
    id: "ethique:commitment",
    component: "form",
    config: {
      submitLabel: "Formuler mon engagement",
      allowEmpty: false,
      fields: [
        {
          id: "guardrail",
          type: "two_bullets",
          label: "Quelles pratiques mettrez-vous en place pour limiter les biais ?",
          maxWordsPerBullet: 16,
        },
      ],
    },
  },
];

const MAIRIE_STEPS: StepDefinition[] = [
  {
    id: "mairie:intro",
    component: "rich-content",
    config: {
      title: "Mairie — Synthèse",
      body: "Rassemblez vos apprentissages et préparez l'export de votre badge Explorateur IA.",
    },
  },
  {
    id: "mairie:feedback",
    component: "form",
    config: {
      submitLabel: "Valider mon bilan",
      allowEmpty: false,
      fields: [
        {
          id: "takeaway",
          type: "textarea_with_counter",
          label: "Quelle pratique garderez-vous en priorité ?",
          minWords: 12,
          maxWords: 120,
        },
        {
          id: "confidence",
          type: "reference_line",
          label: "Niveau de confiance actuel (0-100%)",
        },
      ],
    },
  },
];

export const WORLD1_QUARTER_STEPS: QuarterSteps = {
  clarte: CLARTE_STEPS.map(cloneStep),
  creation: CREATION_STEPS.map(cloneStep),
  decision: DECISION_STEPS.map(cloneStep),
  ethique: ETHIQUE_STEPS.map(cloneStep),
  mairie: MAIRIE_STEPS.map(cloneStep),
};

export function flattenQuarterSteps(
  map: QuarterSteps,
  quarterOrder: QuarterId[] = DEFAULT_QUARTER_ORDER
): StepDefinition[] {
  const result: StepDefinition[] = [];
  for (const quarter of quarterOrder) {
    const steps = map[quarter] ?? [];
    for (const step of steps) {
      result.push(cloneStep(step));
    }
  }
  return result;
}

export function getQuarterFromStepId(stepId: string): QuarterId | null {
  if (!stepId) {
    return null;
  }
  const [prefix] = stepId.split(":");
  return isQuarterId(prefix) ? prefix : null;
}

export function expandQuarterSteps(
  stepSequence: StepDefinition[] | undefined,
  fallback: QuarterSteps = WORLD1_QUARTER_STEPS,
  quarterOrder: QuarterId[] = DEFAULT_QUARTER_ORDER
): QuarterSteps {
  const result: Partial<QuarterSteps> = {};

  const overridesByQuarter = new Map<QuarterId, Map<string, StepDefinition>>();
  if (Array.isArray(stepSequence)) {
    for (const definition of stepSequence) {
      const quarter = getQuarterFromStepId(definition.id);
      if (!quarter) {
        continue;
      }
      const overrides = overridesByQuarter.get(quarter) ?? new Map();
      overrides.set(definition.id, cloneStep(definition));
      overridesByQuarter.set(quarter, overrides);
    }
  }

  for (const quarter of quarterOrder) {
    const baseSteps = fallback[quarter] ?? [];
    const overrides = overridesByQuarter.get(quarter);
    const merged: StepDefinition[] = baseSteps.map((step) =>
      overrides?.get(step.id) ?? cloneStep(step)
    );

    if (overrides) {
      for (const [id, definition] of overrides) {
        if (!merged.some((step) => step.id === id)) {
          merged.push(cloneStep(definition));
        }
      }
    }

    result[quarter] = merged;
  }

  return result as QuarterSteps;
}
