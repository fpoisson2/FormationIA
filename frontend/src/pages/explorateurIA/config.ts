import { isQuarterId, normalizeQuarterId, type QuarterId } from "./types";

export type RewardStage = Exclude<QuarterId, "mairie">;

export interface ExplorateurIAInventoryConfig {
  title: string;
  description: string;
  hint: string;
  icon: string;
}

export interface ExplorateurIAInventoryDefinition
  extends ExplorateurIAInventoryConfig {
  stage: RewardStage;
}

export interface ExplorateurIAQuarterConfig {
  id: QuarterId;
  label: string;
  color: string;
  buildingNumber?: number | null;
  isGoal?: boolean;
  inventory?: ExplorateurIAInventoryConfig | null;
}

function cloneInventoryConfig(
  config: ExplorateurIAInventoryConfig | null | undefined
): ExplorateurIAInventoryConfig | null {
  if (!config) {
    return null;
  }
  return {
    title: config.title,
    description: config.description,
    hint: config.hint,
    icon: config.icon,
  } satisfies ExplorateurIAInventoryConfig;
}

const DEFAULT_EXPLORATEUR_QUARTERS_BASE: readonly ExplorateurIAQuarterConfig[] = Object.freeze([
  {
    id: "clarte",
    label: "Quartier Clarté",
    color: "#06d6a0",
    buildingNumber: 1,
    isGoal: false,
    inventory: {
      title: "Boussole de clarté",
      description:
        "Une boussole calibrée pour pointer vers les consignes les plus limpides.",
      hint: "Réussissez le défi Clarté pour l'ajouter à votre sac.",
      icon: "🧭",
    },
  },
  {
    id: "creation",
    label: "Quartier Création",
    color: "#118ab2",
    buildingNumber: 2,
    isGoal: false,
    inventory: {
      title: "Palette synthétique",
      description:
        "Un set modulable pour combiner styles, médias et tonalités à la demande.",
      hint: "Terminez le défi Création pour débloquer cet outil.",
      icon: "🎨",
    },
  },
  {
    id: "decision",
    label: "Quartier Décision",
    color: "#ef476f",
    buildingNumber: 3,
    isGoal: false,
    inventory: {
      title: "Balance d'arbitrage",
      description:
        "Une balance portative qui révèle instantanément impacts et compromis.",
      hint: "Gagnez le défi Décision pour la remporter.",
      icon: "⚖️",
    },
  },
  {
    id: "ethique",
    label: "Quartier Éthique",
    color: "#8338ec",
    buildingNumber: 4,
    isGoal: false,
    inventory: {
      title: "Lanterne déontique",
      description:
        "Une lanterne qui éclaire les zones d'ombre pour garder le cap éthique.",
      hint: "Relevez le défi Éthique pour la récupérer.",
      icon: "🕯️",
    },
  },
  {
    id: "mairie",
    label: "Mairie (Bilan)",
    color: "#ffd166",
    buildingNumber: null,
    isGoal: true,
    inventory: null,
  },
]);

export const DEFAULT_EXPLORATEUR_QUARTERS: readonly ExplorateurIAQuarterConfig[] =
  DEFAULT_EXPLORATEUR_QUARTERS_BASE.map((quarter) => ({
    ...quarter,
    inventory: cloneInventoryConfig(quarter.inventory),
  }));

function sanitizeInventoryConfig(
  value: unknown,
  fallback: ExplorateurIAInventoryConfig | null
): ExplorateurIAInventoryConfig | null {
  if (!value || typeof value !== "object") {
    return cloneInventoryConfig(fallback);
  }
  const base = value as Partial<ExplorateurIAInventoryConfig>;
  const title =
    typeof base.title === "string" && base.title.trim().length > 0
      ? base.title
      : fallback?.title ?? "";
  const description =
    typeof base.description === "string" && base.description.trim().length > 0
      ? base.description
      : fallback?.description ?? "";
  const hint =
    typeof base.hint === "string" && base.hint.trim().length > 0
      ? base.hint
      : fallback?.hint ?? "";
  const icon =
    typeof base.icon === "string" && base.icon.trim().length > 0
      ? base.icon
      : fallback?.icon ?? "";

  if (!title && !description && !hint && !icon) {
    return cloneInventoryConfig(fallback);
  }

  return {
    title,
    description,
    hint,
    icon,
  } satisfies ExplorateurIAInventoryConfig;
}

function makeUniqueQuarterId(baseId: QuarterId, used: Set<QuarterId>): QuarterId {
  let candidate = baseId;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${baseId}-${suffix}` as QuarterId;
    suffix += 1;
  }
  return candidate;
}

function resolveQuarterId(
  candidate: Partial<ExplorateurIAQuarterConfig>,
  used: Set<QuarterId>,
  defaultsById: Map<QuarterId, ExplorateurIAQuarterConfig>
): { id: QuarterId; defaults?: ExplorateurIAQuarterConfig } | null {
  const rawId =
    typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : undefined;

  let normalizedId: QuarterId | null = null;
  if (rawId && isQuarterId(rawId)) {
    normalizedId = rawId as QuarterId;
  } else if (rawId) {
    normalizedId = normalizeQuarterId(rawId);
  }

  if (!normalizedId) {
    const label =
      typeof candidate.label === "string" && candidate.label.trim().length > 0
        ? candidate.label
        : undefined;
    normalizedId = label ? normalizeQuarterId(label) : null;
  }

  if (!normalizedId) {
    return null;
  }

  const defaults = defaultsById.get(normalizedId) ?? undefined;

  const id = makeUniqueQuarterId(normalizedId, used);
  return { id, defaults };
}

export function sanitizeQuarterConfigs(
  value: unknown,
  fallback: readonly ExplorateurIAQuarterConfig[] = DEFAULT_EXPLORATEUR_QUARTERS
): ExplorateurIAQuarterConfig[] {
  const defaultsById = new Map<QuarterId, ExplorateurIAQuarterConfig>();
  for (const quarter of fallback) {
    defaultsById.set(quarter.id, quarter);
  }

  const sanitized: ExplorateurIAQuarterConfig[] = [];
  const used = new Set<QuarterId>();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const candidate = item as Partial<ExplorateurIAQuarterConfig> & {
        id?: unknown;
        inventory?: unknown;
      };

      const resolved = resolveQuarterId(candidate, used, defaultsById);
      if (!resolved) {
        continue;
      }
      const { id, defaults } = resolved;

      const label =
        typeof candidate.label === "string" && candidate.label.trim().length > 0
          ? candidate.label
          : defaults?.label ?? id;
      const color =
        typeof candidate.color === "string" && candidate.color.trim().length > 0
          ? candidate.color
          : defaults?.color ?? "#ffffff";
      const isGoal =
        typeof candidate.isGoal === "boolean"
          ? candidate.isGoal
          : defaults?.isGoal ?? false;
      const buildingNumber = !isGoal
        ? typeof candidate.buildingNumber === "number" &&
          Number.isFinite(candidate.buildingNumber)
          ? Math.trunc(candidate.buildingNumber)
          : defaults?.buildingNumber ?? null
        : null;

      const inventory = !isGoal
        ? sanitizeInventoryConfig(candidate.inventory, defaults?.inventory ?? null)
        : null;

      sanitized.push({
        id,
        label,
        color,
        buildingNumber,
        isGoal,
        inventory,
      });
      used.add(id);
    }
  }

  for (const defaults of fallback) {
    if (used.has(defaults.id)) {
      continue;
    }
    sanitized.push({
      id: defaults.id,
      label: defaults.label,
      color: defaults.color,
      buildingNumber: defaults.buildingNumber ?? null,
      isGoal: defaults.isGoal ?? false,
      inventory: cloneInventoryConfig(defaults.inventory),
    });
    used.add(defaults.id);
  }

  return sanitized;
}

export interface DerivedQuarterData {
  quarterOrder: QuarterId[];
  progressionSequence: RewardStage[];
  goalIds: QuarterId[];
  buildingDisplayOrder: QuarterId[];
  buildingMeta: Record<QuarterId, { label: string; color: string; number?: number }>;
  inventoryItems: ExplorateurIAInventoryDefinition[];
}

function cloneBuildingMeta(
  meta: Record<QuarterId, { label: string; color: string; number?: number }>
): Record<QuarterId, { label: string; color: string; number?: number }> {
  const entries = Object.entries(meta) as Array<[
    QuarterId,
    { label: string; color: string; number?: number }
  ]>;
  return entries.reduce(
    (acc, [id, value]) => ({
      ...acc,
      [id]: {
        label: value.label,
        color: value.color,
        ...(value.number === undefined ? {} : { number: value.number }),
      },
    }),
    {} as Record<QuarterId, { label: string; color: string; number?: number }>
  );
}

export function deriveQuarterData(
  quarters: readonly ExplorateurIAQuarterConfig[]
): DerivedQuarterData {
  const quarterOrder = quarters.map((quarter) => quarter.id);
  const goalIds = quarters.filter((quarter) => quarter.isGoal).map((quarter) => quarter.id);
  const progressionSequence = quarters
    .filter((quarter) => !quarter.isGoal)
    .map((quarter) => quarter.id as RewardStage);

  const buildingDisplayOrder = [...quarters]
    .sort((a, b) => {
      const aGoal = Boolean(a.isGoal);
      const bGoal = Boolean(b.isGoal);
      if (aGoal && !bGoal) {
        return -1;
      }
      if (!aGoal && bGoal) {
        return 1;
      }
      return quarterOrder.indexOf(a.id) - quarterOrder.indexOf(b.id);
    })
    .map((quarter) => quarter.id);

  const buildingMeta = quarters.reduce(
    (acc, quarter) => {
      const number =
        typeof quarter.buildingNumber === "number" && Number.isFinite(quarter.buildingNumber)
          ? Math.trunc(quarter.buildingNumber)
          : undefined;
      acc[quarter.id] = {
        label: quarter.label,
        color: quarter.color,
        ...(number === undefined ? {} : { number }),
      };
      return acc;
    },
    {} as Record<QuarterId, { label: string; color: string; number?: number }>
  );

  const inventoryItems: ExplorateurIAInventoryDefinition[] = quarters
    .filter((quarter) => !quarter.isGoal && quarter.inventory)
    .map((quarter) => ({
      stage: quarter.id as RewardStage,
      title: quarter.inventory!.title,
      description: quarter.inventory!.description,
      hint: quarter.inventory!.hint,
      icon: quarter.inventory!.icon,
    }));

  return {
    quarterOrder,
    progressionSequence,
    goalIds,
    buildingDisplayOrder,
    buildingMeta,
    inventoryItems,
  } satisfies DerivedQuarterData;
}

export const DEFAULT_DERIVED_QUARTERS = deriveQuarterData(
  DEFAULT_EXPLORATEUR_QUARTERS
);

export function cloneDerivedQuarterData(
  data: DerivedQuarterData
): DerivedQuarterData {
  return {
    quarterOrder: [...data.quarterOrder],
    progressionSequence: [...data.progressionSequence],
    goalIds: [...data.goalIds],
    buildingDisplayOrder: [...data.buildingDisplayOrder],
    buildingMeta: cloneBuildingMeta(data.buildingMeta),
    inventoryItems: data.inventoryItems.map((item) => ({ ...item })),
  } satisfies DerivedQuarterData;
}
