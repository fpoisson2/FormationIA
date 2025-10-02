import type { StepDefinition } from "../../modules/step-sequence";

import {
  cloneStepConfig,
  cloneStepDefinition,
  ensureStepHasQuarterPrefix,
  sanitizeSteps,
} from "./configUtils";
import {
  DEFAULT_EXPLORATEUR_QUARTERS,
  type ExplorateurIAInventoryConfig,
  type ExplorateurIAQuarterConfig,
} from "./config";
import { normalizeQuarterId, type QuarterId } from "./types";
import {
  WORLD1_QUARTER_STEPS,
  type QuarterSteps,
} from "./worlds/world1/steps";

type QuarterDesignerStepMap = Record<QuarterId, StepDefinition[]>;

const DEFAULT_QUARTER_MAP = new Map(
  DEFAULT_EXPLORATEUR_QUARTERS.map((quarter) => [quarter.id, quarter])
);

export function cloneQuarter(
  quarter: ExplorateurIAQuarterConfig
): ExplorateurIAQuarterConfig {
  return {
    id: quarter.id,
    label: quarter.label,
    color: quarter.color,
    buildingNumber:
      quarter.buildingNumber === undefined
        ? undefined
        : quarter.buildingNumber === null
        ? null
        : Number(quarter.buildingNumber),
    isGoal: Boolean(quarter.isGoal),
    inventory: quarter.inventory
      ? {
          title: quarter.inventory.title,
          description: quarter.inventory.description,
          hint: quarter.inventory.hint,
          icon: quarter.inventory.icon,
        }
      : null,
  } satisfies ExplorateurIAQuarterConfig;
}

export function getDefaultInventory(
  quarterId: QuarterId
): ExplorateurIAInventoryConfig | null {
  const defaults = DEFAULT_QUARTER_MAP.get(quarterId);
  if (!defaults || !defaults.inventory) {
    return null;
  }
  return {
    title: defaults.inventory.title,
    description: defaults.inventory.description,
    hint: defaults.inventory.hint,
    icon: defaults.inventory.icon,
  } satisfies ExplorateurIAInventoryConfig;
}

const FALLBACK_CUSTOM_COLOR_PALETTE = [
  "#f97316",
  "#0ea5e9",
  "#22c55e",
  "#a855f7",
  "#ec4899",
];

export function createNewQuarterTemplate(
  existing: readonly ExplorateurIAQuarterConfig[]
): ExplorateurIAQuarterConfig {
  const usedIds = new Set(existing.map((quarter) => quarter.id));
  const nonGoalCount = existing.filter((quarter) => !quarter.isGoal).length;
  const baseLabel = `Nouveau quartier ${nonGoalCount + 1}`;
  const normalized =
    normalizeQuarterId(baseLabel) ??
    (`quartier-${nonGoalCount + 1}` as QuarterId);

  const palette = existing
    .filter((quarter) => !quarter.isGoal)
    .map((quarter) => quarter.color)
    .filter((color) => typeof color === "string" && color.trim().length > 0);
  const colorPalette = palette.length ? palette : FALLBACK_CUSTOM_COLOR_PALETTE;
  const nextColor = colorPalette[
    nonGoalCount % colorPalette.length
  ] as string;

  let candidateId = normalized;
  let suffix = 2;
  while (usedIds.has(candidateId)) {
    candidateId = `${normalized}-${suffix}` as QuarterId;
    suffix += 1;
  }

  return {
    id: candidateId,
    label: baseLabel,
    color: nextColor,
    buildingNumber: nonGoalCount + 1,
    isGoal: false,
    inventory: getDefaultInventory(candidateId),
  } satisfies ExplorateurIAQuarterConfig;
}

export function ensureDesignerStepId(
  quarterId: QuarterId,
  step: StepDefinition,
  index: number
): StepDefinition {
  const id =
    typeof step.id === "string" && step.id.trim().length > 0
      ? ensureStepHasQuarterPrefix(step.id, quarterId)
      : `${quarterId}:designer:${index + 1}`;
  const component =
    typeof step.component === "string" && step.component.trim().length > 0
      ? step.component
      : "custom";
  if (step.composite != null) {
    return {
      id,
      component,
      config:
        step.config == null ? step.config : cloneStepConfig(step.config),
      composite: cloneStepConfig(step.composite),
    } satisfies StepDefinition;
  }
  const config =
    step.config == null ? step.config : cloneStepConfig(step.config);
  return { id, component, config, composite: null } satisfies StepDefinition;
}

export function createPlaceholderQuarterSteps(
  quarter: ExplorateurIAQuarterConfig
): StepDefinition[] {
  const baseId = quarter.id;
  const intro: StepDefinition = {
    id: `${baseId}:introduction`,
    component: "rich-content",
    config: {
      title: `${quarter.label || "Quartier"} — Introduction`,
      body:
        "Décrivez le contexte ou les objectifs de ce quartier dans cet encart.",
    },
  };
  const synthesis: StepDefinition = {
    id: `${baseId}:synthese`,
    component: "form",
    config: {
      submitLabel: "Enregistrer",
      allowEmpty: false,
      fields: [
        {
          id: `${baseId}-objectif`,
          type: "textarea_with_counter",
          label: "Quels apprentissages retenir ?",
          minWords: 10,
          maxWords: 80,
        },
      ],
    },
  };
  return [intro, synthesis];
}

export function createBasicsDesignerStep(
  quarter: ExplorateurIAQuarterConfig
): StepDefinition {
  const baseId = quarter.id;
  return {
    id: `${baseId}:designer:basics`,
    component: "custom",
    config: {
      type: "explorateur-quarter-basics",
      quarterId: baseId,
      label: quarter.label,
      color: quarter.color,
      buildingNumber: quarter.buildingNumber ?? null,
      isGoal: Boolean(quarter.isGoal),
    },
  } satisfies StepDefinition;
}

export function createInventoryDesignerStep(
  quarter: ExplorateurIAQuarterConfig
): StepDefinition {
  const baseId = quarter.id;
  return {
    id: `${baseId}:designer:inventory`,
    component: "custom",
    config: {
      type: "explorateur-quarter-inventory",
      quarterId: baseId,
      enabled: Boolean(quarter.inventory) && !quarter.isGoal,
      title: quarter.inventory?.title ?? "",
      description: quarter.inventory?.description ?? "",
      hint: quarter.inventory?.hint ?? "",
      icon: quarter.inventory?.icon ?? "🎁",
    },
  } satisfies StepDefinition;
}

export function createDefaultQuarterDesignerSteps(
  quarter: ExplorateurIAQuarterConfig,
  quarterSteps: StepDefinition[] = []
): StepDefinition[] {
  const designerSteps: StepDefinition[] = [createBasicsDesignerStep(quarter)];

  const effectiveQuarterSteps = (
    quarterSteps.length > 0 ? quarterSteps : createPlaceholderQuarterSteps(quarter)
  ).map((step) => ({
    ...cloneStepDefinition(step),
    id: ensureStepHasQuarterPrefix(step.id, quarter.id),
  }));

  for (const step of effectiveQuarterSteps) {
    designerSteps.push(step);
  }

  if (!quarter.isGoal) {
    designerSteps.push(createInventoryDesignerStep(quarter));
  }

  return designerSteps;
}

export function createDefaultQuarterDesignerStepMap(
  quarters: ExplorateurIAQuarterConfig[],
  quarterSteps: QuarterSteps
): QuarterDesignerStepMap {
  const map: Partial<QuarterSteps> = {};
  for (const quarter of quarters) {
    const sequence = quarterSteps[quarter.id] ?? [];
    map[quarter.id] = createDefaultQuarterDesignerSteps(
      quarter,
      sequence
    ).map((step, index) => ensureDesignerStepId(quarter.id, step, index));
  }
  return map as QuarterDesignerStepMap;
}

export function extractQuarterStepsFromDesignerMap(
  designerMap: QuarterSteps,
  quarters: ExplorateurIAQuarterConfig[]
): QuarterSteps {
  const result: Partial<QuarterSteps> = {};
  for (const quarter of quarters) {
    const steps = designerMap[quarter.id] ?? [];
    const actual = steps
      .filter((step) => !isQuarterDesignerMetaType(resolveDesignerStepType(step)))
      .map((step) => ensureQuarterSequenceStep(step, quarter.id));
    result[quarter.id] = actual.map(cloneStepDefinition);
  }
  return result as QuarterSteps;
}

export function sanitizeQuarterDesignerSteps(
  value: unknown,
  quarters: ExplorateurIAQuarterConfig[],
  fallbackQuarterSteps: QuarterSteps
): {
  designerSteps: QuarterDesignerStepMap;
  quarterSteps: QuarterSteps;
} {
  const rawMap =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const result: Partial<QuarterSteps> = {};
  const quarterResult: Partial<QuarterSteps> = {};

  for (const quarter of quarters) {
    const rawSteps = rawMap[quarter.id];
    const fallbackDesignerSteps = createDefaultQuarterDesignerSteps(
      quarter,
      fallbackQuarterSteps[quarter.id] ?? []
    );
    const sanitized = sanitizeSteps(rawSteps, fallbackDesignerSteps);
    const normalized = (sanitized.length ? sanitized : fallbackDesignerSteps).map(
      (step, index) => ensureDesignerStepId(quarter.id, step, index)
    );

    const fallbackActualSteps = fallbackDesignerSteps
      .filter((step) => !isQuarterDesignerMetaType(resolveDesignerStepType(step)))
      .map(cloneStepDefinition);

    const synced = normalized.map((step) =>
      syncDesignerStepWithQuarter(step, quarter)
    );

    const actualSteps = synced
      .filter((step) => !isQuarterDesignerMetaType(resolveDesignerStepType(step)))
      .map((step) => ensureQuarterSequenceStep(step, quarter.id));

    quarterResult[quarter.id] = (actualSteps.length
      ? actualSteps
      : fallbackActualSteps.length
      ? fallbackActualSteps
      : createPlaceholderQuarterSteps(quarter)
    ).map(cloneStepDefinition);

    result[quarter.id] = synced.map(cloneStepDefinition);
  }

  return {
    designerSteps: result as QuarterDesignerStepMap,
    quarterSteps: quarterResult as QuarterSteps,
  };
}

export function resolveDesignerStepType(step: StepDefinition): string {
  if (step.config && typeof step.config === "object") {
    const candidate = (step.config as { type?: unknown }).type;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return step.component;
}

export function isQuarterDesignerMetaType(type: string): boolean {
  return (
    type === "explorateur-quarter-basics" ||
    type === "explorateur-quarter-inventory"
  );
}

export function ensureQuarterSequenceStep(
  step: StepDefinition,
  quarterId: QuarterId
): StepDefinition {
  const id = ensureStepHasQuarterPrefix(step.id, quarterId);
  const component =
    typeof step.component === "string" && step.component.trim().length > 0
      ? step.component
      : "custom";

  if (step.composite != null) {
    return {
      id,
      component,
      config:
        step.config == null ? step.config : cloneStepConfig(step.config),
      composite: cloneStepConfig(step.composite),
    } satisfies StepDefinition;
  }

  return {
    id,
    component,
    config:
      step.config == null ? step.config : cloneStepConfig(step.config),
    composite: null,
  } satisfies StepDefinition;
}

export function syncDesignerStepWithQuarter(
  step: StepDefinition,
  quarter: ExplorateurIAQuarterConfig
): StepDefinition {
  const type = resolveDesignerStepType(step);
  if (type === "explorateur-quarter-basics") {
    const config =
      step.config && typeof step.config === "object"
        ? (step.config as Record<string, unknown>)
        : {};
    return {
      id: ensureStepHasQuarterPrefix(step.id, quarter.id),
      component: step.component,
      config: {
        ...config,
        type,
        quarterId: quarter.id,
        label: quarter.label,
        color: quarter.color,
        buildingNumber: quarter.isGoal
          ? null
          : quarter.buildingNumber ?? null,
        isGoal: Boolean(quarter.isGoal),
      },
    } satisfies StepDefinition;
  }
  if (type === "explorateur-quarter-inventory") {
    const config =
      step.config && typeof step.config === "object"
        ? (step.config as Record<string, unknown>)
        : {};
    const enabled = Boolean(quarter.inventory) && !quarter.isGoal;
    return {
      id: ensureStepHasQuarterPrefix(step.id, quarter.id),
      component: step.component,
      config: {
        ...config,
        type,
        quarterId: quarter.id,
        enabled,
        title: enabled ? quarter.inventory?.title ?? "" : "",
        description: enabled ? quarter.inventory?.description ?? "" : "",
        hint: enabled ? quarter.inventory?.hint ?? "" : "",
        icon: enabled ? quarter.inventory?.icon ?? "🎁" : "🎁",
      },
    } satisfies StepDefinition;
  }

  return ensureQuarterSequenceStep(step, quarter.id);
}

function buildSequenceTemplateLibrary(
  map: QuarterSteps
): Map<string, StepDefinition> {
  const templates = new Map<string, StepDefinition>();
  for (const steps of Object.values(map)) {
    for (const step of steps) {
      const type = resolveDesignerStepType(step);
      if (!templates.has(type)) {
        templates.set(type, cloneStepDefinition(step));
      }
    }
  }
  return templates;
}

const SEQUENCE_TEMPLATE_BY_TYPE = buildSequenceTemplateLibrary(
  WORLD1_QUARTER_STEPS
);

export function createSequenceStepFromTemplate(
  quarter: ExplorateurIAQuarterConfig,
  type: string,
  existingSteps: StepDefinition[]
): StepDefinition {
  const template = SEQUENCE_TEMPLATE_BY_TYPE.get(type);
  const baseFragment = template?.id
    ? template.id.split(":").slice(1).join(":")
    : `${type}-${existingSteps.length + 1}`;
  const sanitizedBase =
    baseFragment && baseFragment.trim().length > 0
      ? baseFragment.trim().replace(/\s+/g, "-")
      : `${type}-step`;
  const existingIds = new Set(existingSteps.map((step) => step.id));
  let candidateId = `${quarter.id}:${sanitizedBase}`;
  let suffix = 2;
  while (existingIds.has(candidateId)) {
    candidateId = `${quarter.id}:${sanitizedBase}-${suffix}`;
    suffix += 1;
  }

  if (template) {
    const cloned = cloneStepDefinition(template);
    cloned.id = candidateId;
    return ensureQuarterSequenceStep(cloned, quarter.id);
  }

  return ensureQuarterSequenceStep(
    {
      id: candidateId,
      component: type,
      config: {},
    },
    quarter.id
  );
}

export type { QuarterDesignerStepMap };

export interface QuarterDesignerStepLibraryEntry {
  type: string;
  label: string;
  description?: string;
  icon: string;
  isMeta?: boolean;
  allowGoal?: boolean;
  create: (
    quarter: ExplorateurIAQuarterConfig,
    existingSteps: StepDefinition[]
  ) => StepDefinition | null;
}

export const QUARTER_DESIGNER_STEP_LIBRARY: QuarterDesignerStepLibraryEntry[] = [
  {
    type: "explorateur-quarter-basics",
    label: "Informations générales",
    description:
      "Nom, couleur principale, numéro de défi et statut d'objectif final.",
    icon: "🏙️",
    isMeta: true,
    create: (quarter) => createBasicsDesignerStep(quarter),
  },
  {
    type: "explorateur-quarter-inventory",
    label: "Objet d'inventaire",
    description: "Configurer la récompense associée à ce quartier.",
    icon: "🎒",
    isMeta: true,
    allowGoal: false,
    create: (quarter) => createInventoryDesignerStep(quarter),
  },
  {
    type: "rich-content",
    label: "Contenu enrichi",
    description: "Texte, médias et encadrés pédagogiques.",
    icon: "📰",
    create: (quarter, steps) =>
      createSequenceStepFromTemplate(quarter, "rich-content", steps),
  },
  {
    type: "video",
    label: "Vidéo",
    description: "Lecture vidéo avec suivi de progression.",
    icon: "🎬",
    create: (quarter, steps) =>
      createSequenceStepFromTemplate(quarter, "video", steps),
  },
  {
    type: "form",
    label: "Formulaire",
    description: "Collecte de réponses structurées ou réflexion guidée.",
    icon: "📝",
    create: (quarter, steps) =>
      createSequenceStepFromTemplate(quarter, "form", steps),
  },
];

export function getDesignerStepMeta(type: string) {
  return QUARTER_DESIGNER_STEP_LIBRARY.find((entry) => entry.type === type);
}
