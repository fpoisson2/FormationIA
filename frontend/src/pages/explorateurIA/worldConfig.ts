import { cloneStepDefinition, sanitizeSteps } from "./configUtils";
import {
  DEFAULT_DERIVED_QUARTERS,
  DEFAULT_EXPLORATEUR_QUARTERS,
  deriveQuarterData,
  sanitizeQuarterConfigs,
  type ExplorateurIAQuarterConfig,
} from "./config";
import {
  createDefaultQuarterDesignerStepMap,
  sanitizeQuarterDesignerSteps,
  type QuarterDesignerStepMap,
} from "./designerUtils";
import {
  expandQuarterSteps,
  flattenQuarterSteps,
  WORLD1_QUARTER_STEPS,
  type QuarterSteps,
} from "./worlds/world1/steps";
import type { StepDefinition } from "../../modules/step-sequence/types";

export type TerrainThemeId = "sand" | "grass" | "dirt" | "dirtGray" | "snow";

const ALLOWED_TERRAIN_THEME_IDS: readonly TerrainThemeId[] = [
  "sand",
  "grass",
  "dirt",
  "dirtGray",
  "snow",
];

export function isTerrainThemeId(value: unknown): value is TerrainThemeId {
  return (
    typeof value === "string" &&
    (ALLOWED_TERRAIN_THEME_IDS as readonly string[]).includes(value)
  );
}

export const DEFAULT_TERRAIN_THEME_ID: TerrainThemeId = "sand";
export const WORLD_SEED = 1247;

export interface ExplorateurIATerrainConfig {
  themeId: TerrainThemeId;
  seed: number;
}

export type ExplorateurExperienceMode = "guided" | "open-world";

export const DEFAULT_EXPERIENCE_MODE: ExplorateurExperienceMode = "guided";

export interface ExplorateurIAConfig {
  terrain: ExplorateurIATerrainConfig;
  steps: StepDefinition[];
  quarterDesignerSteps: QuarterDesignerStepMap;
  quarters: ExplorateurIAQuarterConfig[];
  experienceMode: ExplorateurExperienceMode;
}

export function sanitizeTerrainConfig(
  value: unknown
): ExplorateurIATerrainConfig {
  if (!value || typeof value !== "object") {
    return { themeId: DEFAULT_TERRAIN_THEME_ID, seed: WORLD_SEED };
  }

  const base = value as Partial<ExplorateurIATerrainConfig> & {
    theme?: unknown;
    themeId?: unknown;
    seed?: unknown;
  };

  const rawTheme = base.themeId ?? base.theme;
  const themeId = isTerrainThemeId(rawTheme)
    ? rawTheme
    : DEFAULT_TERRAIN_THEME_ID;

  const seed =
    typeof base.seed === "number" && Number.isFinite(base.seed)
      ? Math.trunc(base.seed)
      : WORLD_SEED;

  return { themeId, seed } satisfies ExplorateurIATerrainConfig;
}

export function sanitizeExperienceMode(
  value: unknown
): ExplorateurExperienceMode {
  if (value === "open-world") {
    return "open-world";
  }
  if (value === "guided") {
    return "guided";
  }
  return DEFAULT_EXPERIENCE_MODE;
}

function getDefaultExplorateurSteps(): StepDefinition[] {
  return flattenQuarterSteps(
    WORLD1_QUARTER_STEPS,
    DEFAULT_DERIVED_QUARTERS.quarterOrder
  ).map(cloneStepDefinition);
}

export function createDefaultExplorateurIAConfig(): ExplorateurIAConfig {
  const quarters = DEFAULT_EXPLORATEUR_QUARTERS.map((quarter) => ({
    ...quarter,
    inventory: quarter.inventory ? { ...quarter.inventory } : null,
  }));
  const derived = deriveQuarterData(quarters);
  const quarterSteps = expandQuarterSteps(
    getDefaultExplorateurSteps(),
    WORLD1_QUARTER_STEPS,
    derived.quarterOrder
  );
  const designerSteps = createDefaultQuarterDesignerStepMap(
    quarters,
    quarterSteps
  );

  return {
    terrain: { themeId: DEFAULT_TERRAIN_THEME_ID, seed: WORLD_SEED },
    steps: flattenQuarterSteps(quarterSteps, derived.quarterOrder),
    quarterDesignerSteps: designerSteps,
    quarters,
    experienceMode: DEFAULT_EXPERIENCE_MODE,
  } satisfies ExplorateurIAConfig;
}

export function sanitizeExplorateurIAConfig(
  config: unknown
): ExplorateurIAConfig {
  if (!config || typeof config !== "object") {
    return createDefaultExplorateurIAConfig();
  }

  const base = config as Partial<ExplorateurIAConfig> & {
    terrain?: unknown;
    steps?: unknown;
    quarters?: unknown;
    quarterDesignerSteps?: unknown;
    experienceMode?: unknown;
  };

  const terrain = sanitizeTerrainConfig(base.terrain);
  const steps = sanitizeSteps(base.steps);
  const quarters = sanitizeQuarterConfigs(
    base.quarters,
    DEFAULT_EXPLORATEUR_QUARTERS
  );
  const experienceMode = sanitizeExperienceMode(base.experienceMode);
  const derived = deriveQuarterData(quarters);
  const expandedQuarterSteps = expandQuarterSteps(
    steps.length > 0 ? steps : getDefaultExplorateurSteps(),
    WORLD1_QUARTER_STEPS,
    derived.quarterOrder
  );
  const { designerSteps, quarterSteps } = sanitizeQuarterDesignerSteps(
    base.quarterDesignerSteps,
    quarters,
    expandedQuarterSteps
  );

  return {
    terrain,
    steps: flattenQuarterSteps(quarterSteps, derived.quarterOrder),
    quarterDesignerSteps: designerSteps,
    quarters,
    experienceMode,
  } satisfies ExplorateurIAConfig;
}

