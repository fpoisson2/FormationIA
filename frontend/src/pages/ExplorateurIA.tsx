import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type CSSProperties,
  type ChangeEvent,
} from "react";

import mapPackAtlas from "../assets/kenney_map-pack/Spritesheet/mapPack_spritesheet.png";
import mapPackAtlasDescription from "../assets/kenney_map-pack/Spritesheet/mapPack_enriched.xml?raw";
import { useAdminAuth } from "../providers/AdminAuthProvider";
import {
  StepSequenceRenderer,
  type StepSequenceRenderWrapperProps,
} from "../modules/step-sequence/StepSequenceRenderer";
import {
  StepSequenceContext,
  type StepComponentProps,
  type StepDefinition,
  type StepSequenceActivityContextBridge,
  isCompositeStepDefinition,
} from "../modules/step-sequence/types";
import { createExplorateurExport } from "./explorateurIA/export";
import { classNames } from "./explorateurIA/utils";
import {
  cloneQuarterStepMap,
  cloneStepConfig,
  cloneStepDefinition,
  ensureStepHasQuarterPrefix,
  sanitizeSteps,
} from "./explorateurIA/configUtils";
import {
  cloneQuarter,
  createDefaultQuarterDesignerSteps,
  createDefaultQuarterDesignerStepMap,
  createNewQuarterTemplate,
  createSequenceStepFromTemplate,
  extractQuarterStepsFromDesignerMap,
  getDesignerStepMeta,
  isQuarterDesignerMetaType,
  resolveDesignerStepType,
  sanitizeQuarterDesignerSteps,
  syncDesignerStepWithQuarter,
  type QuarterDesignerStepLibraryEntry,
  type QuarterDesignerStepMap,
  QUARTER_DESIGNER_STEP_LIBRARY,
} from "./explorateurIA/designerUtils";
import {
  createDefaultExplorateurIAConfig,
  DEFAULT_EXPERIENCE_MODE,
  DEFAULT_TERRAIN_THEME_ID,
  isTerrainThemeId,
  sanitizeExperienceMode,
  sanitizeExplorateurIAConfig,
  sanitizeTerrainConfig,
  WORLD_SEED,
} from "./explorateurIA/worldConfig";
import type {
  ExplorateurExperienceMode,
  ExplorateurIAConfig,
  ExplorateurIATerrainConfig,
  TerrainThemeId,
} from "./explorateurIA/worldConfig";
export {
  createDefaultExplorateurIAConfig,
  sanitizeExplorateurIAConfig,
  sanitizeExperienceMode,
  sanitizeTerrainConfig,
  DEFAULT_EXPERIENCE_MODE,
  DEFAULT_TERRAIN_THEME_ID,
  WORLD_SEED,
  isTerrainThemeId,
} from "./explorateurIA/worldConfig";
export type {
  ExplorateurExperienceMode,
  ExplorateurIAConfig,
  ExplorateurIATerrainConfig,
  TerrainThemeId,
} from "./explorateurIA/worldConfig";
import {
  createInitialProgress,
  updateClarteProgress,
  updateCreationProgress,
  updateDecisionProgress,
  updateEthicsProgress,
  updateGenericQuarterProgress,
  updateMairieProgress,
  type ExplorateurProgress,
  type QuarterPayloadMap,
} from "./explorateurIA/progress";
import "./explorateurIA/modules";
import {
  WORLD1_QUARTER_STEPS,
  expandQuarterSteps,
  flattenQuarterSteps,
  getQuarterFromStepId,
  type QuarterSteps,
} from "./explorateurIA/worlds/world1/steps";
import {
  DEFAULT_QUARTER_IDS,
  normalizeQuarterId,
  type QuarterId,
} from "./explorateurIA/types";
import {
  DEFAULT_DERIVED_QUARTERS,
  DEFAULT_EXPLORATEUR_QUARTERS,
  cloneDerivedQuarterData,
  deriveQuarterData,
  sanitizeQuarterConfigs,
  type DerivedQuarterData,
  type ExplorateurIAInventoryConfig,
  type ExplorateurIAInventoryDefinition,
  type ExplorateurIAQuarterConfig,
  type RewardStage,
} from "./explorateurIA/config";
import {
  createChiptuneTheme,
  type ChiptuneTheme,
} from "./explorateurIA/audio/chiptuneTheme";
import {
  createArrivalEffect,
  type ArrivalEffect,
} from "./explorateurIA/audio/arrivalEffect";
import { Modal } from "./explorateurIA/Modal";

// ---
// "Explorateur IA" — Frontend React (module web auto-portant)
// Style: mini jeu top-down façon Game Boy/Pokémon pour naviguer entre 4 quartiers.
// Aucune saisie de texte par l'étudiant — seulement clics, touches de direction, drag-and-drop.
// Technologies: React + Tailwind CSS (prévu), aucune dépendance externe requise.
// Export JSON + impression PDF via window.print().
// ---

type InventoryDefinition = ExplorateurIAInventoryDefinition;

type InventoryEntry = InventoryDefinition & { obtained: boolean };

const KNOWN_QUARTER_IDS = new Set<QuarterId>(
  Array.from(DEFAULT_QUARTER_IDS) as QuarterId[]
);

let currentDerivedData: DerivedQuarterData = cloneDerivedQuarterData(
  DEFAULT_DERIVED_QUARTERS
);

let PROGRESSION_SEQUENCE: RewardStage[] = [];
let PROGRESSION_WITH_GOAL: QuarterId[] = [];
let BUILDING_DISPLAY_ORDER: QuarterId[] = [];
let BUILDING_META: Record<
  QuarterId,
  { label: string; color: string; number?: number }
> = {} as Record<QuarterId, { label: string; color: string; number?: number }>;
let INVENTORY_ITEMS: InventoryDefinition[] = [];
let currentWorldMode: ExplorateurExperienceMode = DEFAULT_EXPERIENCE_MODE;
let currentUiExperienceMode: ExplorateurExperienceMode = DEFAULT_EXPERIENCE_MODE;

function updateDerivedQuarterCaches(data: DerivedQuarterData) {
  currentDerivedData = cloneDerivedQuarterData(data);
  PROGRESSION_SEQUENCE = [...currentDerivedData.progressionSequence];
  const goal = currentDerivedData.goalIds[0];
  PROGRESSION_WITH_GOAL =
    goal === undefined
      ? [...PROGRESSION_SEQUENCE]
      : [...PROGRESSION_SEQUENCE, goal];
  BUILDING_DISPLAY_ORDER = [...currentDerivedData.buildingDisplayOrder];
  BUILDING_META = Object.entries(currentDerivedData.buildingMeta).reduce(
    (acc, [id, meta]) => {
      acc[id as QuarterId] = {
        label: meta.label,
        color: meta.color,
        ...(meta.number === undefined ? {} : { number: meta.number }),
      };
      return acc;
    },
    {} as Record<QuarterId, { label: string; color: string; number?: number }>
  );
  INVENTORY_ITEMS = currentDerivedData.inventoryItems.map((item) => ({
    ...item,
  }));
}

updateDerivedQuarterCaches(DEFAULT_DERIVED_QUARTERS);

function applyDerivedQuarterData(next: DerivedQuarterData) {
  updateDerivedQuarterCaches(next);
  rebuildLandmarkAssignments();
  rebuildBuildings();
  rebuildBuildingLookup();
  rebuildPathGates();
  rebuildGateLookup();
}

const MANUAL_ADVANCE_COMPONENTS = new Set<string>(["rich-content", "video"]);

const BASE_TILE_SIZE = 32;
const TILE_GAP = 0;
const MIN_TILE_SIZE = 12;
const MOBILE_VERTICAL_PADDING = 0;
const DESKTOP_TILE_MAX_SIZE = BASE_TILE_SIZE * 4;
const ADMIN_ROLES = ["admin", "superadmin", "administrator"] as const;
const MUSIC_PREFERENCE_STORAGE_KEY = "explorateur-ia:music-enabled";
const NON_TYPABLE_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "date",
  "datetime-local",
  "file",
  "hidden",
  "image",
  "month",
  "radio",
  "range",
  "reset",
  "submit",
  "time",
  "week",
]);
type TileScaleMode = "contain" | "cover";

type AtlasCategory = "" | "terrain" | "path" | "object" | "character" | "ui";

type AtlasEntry = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description?: string;
  category: AtlasCategory;
  subtype?: string;
  tags: string[];
  connections: string[];
  walkable: boolean;
  overlay: boolean;
  transparent: boolean;
};

function getStoredMusicPreference(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const stored = window.localStorage.getItem(
      MUSIC_PREFERENCE_STORAGE_KEY
    );
    if (stored === null) {
      return true;
    }
    const normalized = stored.trim().toLowerCase();
    if (["off", "false", "0"].includes(normalized)) {
      return false;
    }
    if (["on", "true", "1"].includes(normalized)) {
      return true;
    }
    return true;
  } catch (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("Explorateur IA: unable to read music preference", error);
    }
    return true;
  }
}

function persistMusicPreference(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      MUSIC_PREFERENCE_STORAGE_KEY,
      enabled ? "on" : "off"
    );
  } catch (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("Explorateur IA: unable to store music preference", error);
    }
  }
}

function isTextualInputTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  let element: HTMLElement | null = target;
  while (element) {
    if (element.isContentEditable) {
      return true;
    }
    if (element instanceof HTMLInputElement) {
      const type = element.type?.toLowerCase() ?? "text";
      if (!NON_TYPABLE_INPUT_TYPES.has(type)) {
        return true;
      }
    } else if (
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      return true;
    } else {
      const role = element.getAttribute("role");
      if (
        role &&
        ["textbox", "searchbox", "combobox", "spinbutton"].includes(
          role.toLowerCase()
        )
      ) {
        return true;
      }
    }
    element = element.parentElement;
  }
  return false;
}

function parseBooleanAttribute(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parseListAttribute(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[;,]/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function parseTokenAttribute(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function parseAtlasDescription(xml: string): Map<string, AtlasEntry> {
  const entries = new Map<string, AtlasEntry>();

  const createEntry = (attributes: Record<string, string>): AtlasEntry | null => {
    const name = attributes.name;
    if (!name) {
      return null;
    }
    const category = (attributes.category ?? "") as AtlasCategory;
    const tags = parseTokenAttribute(attributes.type);
    const connections = parseListAttribute(attributes.connections);
    const description = attributes.description ?? attributes.desc;
    const width = Number(attributes.width ?? 0);
    const height = Number(attributes.height ?? 0);
    const overlay = parseBooleanAttribute(attributes.overlay);
    const transparent = parseBooleanAttribute(
      attributes.transparent_bg ?? attributes.transparent
    );

    return {
      name,
      x: Number(attributes.x ?? 0),
      y: Number(attributes.y ?? 0),
      width: Number.isNaN(width) ? 0 : width,
      height: Number.isNaN(height) ? 0 : height,
      description,
      category,
      subtype: attributes.subtype,
      tags,
      connections,
      walkable: parseBooleanAttribute(attributes.walkable),
      overlay,
      transparent,
    };
  };

  const parseWithDom = () => {
    if (typeof DOMParser === "undefined") {
      return false;
    }
    try {
      const parser = new DOMParser();
      const xmlDocument = parser.parseFromString(xml, "application/xml");
      if (xmlDocument.getElementsByTagName("parsererror").length > 0) {
        return false;
      }
      const nodes = Array.from(xmlDocument.getElementsByTagName("SubTexture"));
      for (const node of nodes) {
        const attrs: Record<string, string> = {};
        for (const attribute of Array.from(node.attributes)) {
          attrs[attribute.name] = attribute.value;
        }
        const entry = createEntry(attrs);
        if (entry) {
          entries.set(entry.name, entry);
        }
      }
      return entries.size > 0;
    } catch (error) {
      console.warn("[ExplorateurIA] Échec du parsing XML via DOMParser", error);
      return false;
    }
  };

  const parseWithRegexFallback = () => {
    const textureRegex = /<SubTexture\s+([^>]+?)\s*\/>/g;
    let match: RegExpExecArray | null;
    while ((match = textureRegex.exec(xml)) !== null) {
      const rawAttributes = match[1];
      const attributeRegex = /(\w+)="([^"]*)"/g;
      const attributes: Record<string, string> = {};
      let attributeMatch: RegExpExecArray | null;
      while ((attributeMatch = attributeRegex.exec(rawAttributes)) !== null) {
        attributes[attributeMatch[1]] = attributeMatch[2];
      }
      const entry = createEntry(attributes);
      if (entry) {
        entries.set(entry.name, entry);
      }
    }
  };

  if (!parseWithDom()) {
    parseWithRegexFallback();
  }

  return entries;
}

const DEFAULT_TILE_SIZE = 64;

const MAP_PACK_ATLAS = parseAtlasDescription(mapPackAtlasDescription);

const TILE_CONNECTION_CACHE = new Map<string, string[]>();

const NUMBER_TILE_PATTERN = /(\d+)/;

type NumberTile = { value: number; coord: TileCoord };

function atlas(name: string): TileCoord {
  const entry = MAP_PACK_ATLAS.get(name);
  if (!entry) {
    console.warn(`[ExplorateurIA] Tuile manquante dans l'atlas: ${name}`);
    return [0, 0, DEFAULT_TILE_SIZE, DEFAULT_TILE_SIZE];
  }
  return [
    entry.x,
    entry.y,
    entry.width || DEFAULT_TILE_SIZE,
    entry.height || DEFAULT_TILE_SIZE,
  ];
}

function collectWalkableNumberTiles(): NumberTile[] {
  const numbers: NumberTile[] = [];
  for (const entry of MAP_PACK_ATLAS.values()) {
    if (entry.subtype !== "number" || !entry.walkable) {
      continue;
    }
    const target = entry.description ?? entry.name;
    const match = target ? target.match(NUMBER_TILE_PATTERN) : null;
    if (!match) {
      continue;
    }
    const value = Number.parseInt(match[1] ?? "", 10);
    if (Number.isNaN(value) || value >= 10) {
      continue;
    }
    numbers.push({ value, coord: atlas(entry.name) });
  }
  numbers.sort((a, b) => a.value - b.value);
  return numbers;
}

const NUMBER_TILES = collectWalkableNumberTiles();
const NUMBER_TILE_MAP = new Map<number, TileCoord>(
  NUMBER_TILES.map(({ value, coord }) => [value, coord])
);

const FALLBACK_NUMBER_TILE_NAMES: Record<number, string | undefined> = {
  5: "mapTile_135.png",
};

function getNumberTileCoord(value: number): TileCoord | null {
  const coord = NUMBER_TILE_MAP.get(value);
  if (coord) {
    return coord;
  }
  const fallback = FALLBACK_NUMBER_TILE_NAMES[value];
  if (fallback) {
    return atlas(fallback);
  }
  return null;
}

const DEFAULT_PLAYER_FRAMES = [atlas("mapTile_136.png")];

const EDGE_DIRECTIONS = [
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
] as const;

type EdgeDirection = (typeof EDGE_DIRECTIONS)[number];

type EdgeVariantType = "interior" | "exterior";

type SandEdgeVariant = {
  exterior: TileCoord;
  interior?: TileCoord;
};

type SandTiles = {
  center: TileCoord;
  edges: Record<EdgeDirection, SandEdgeVariant>;
};

const EDGE_DIRECTION_SET = new Set<EdgeDirection>(EDGE_DIRECTIONS);

type EdgeOrientation = readonly string[];

export type IslandEdgePlacement = {
  orientation: EdgeOrientation;
  variant: EdgeVariantType;
  touchesOutside: boolean;
};

const FALLBACK_SAND_TILES: SandTiles = {
  center: atlas("mapTile_017.png"),
  edges: {
    north: { exterior: atlas("mapTile_002.png") },
    south: { exterior: atlas("mapTile_047.png") },
    east: { exterior: atlas("mapTile_018.png") },
    west: { exterior: atlas("mapTile_016.png") },
    northeast: {
      exterior: atlas("mapTile_003.png"),
      interior: atlas("mapTile_019.png"),
    },
    northwest: {
      exterior: atlas("mapTile_001.png"),
      interior: atlas("mapTile_020.png"),
    },
    southeast: {
      exterior: atlas("mapTile_033.png"),
      interior: atlas("mapTile_004.png"),
    },
    southwest: {
      exterior: atlas("mapTile_046.png"),
      interior: atlas("mapTile_005.png"),
    },
  },
};

function deriveSandTilesFromAtlas(subtype = "sand"): SandTiles {
  const sandEntries = Array.from(MAP_PACK_ATLAS.values()).filter(
    (entry) => entry.category === "terrain" && entry.subtype === subtype
  );

  const exteriorPriorities = new Map<EdgeDirection, number>();

  const derived: SandTiles = {
    center: [...FALLBACK_SAND_TILES.center] as TileCoord,
    edges: EDGE_DIRECTIONS.reduce((acc, direction) => {
      const fallback = FALLBACK_SAND_TILES.edges[direction];
      exteriorPriorities.set(direction, -1);
      acc[direction] = {
        exterior: [...fallback.exterior] as TileCoord,
        ...(fallback.interior
          ? { interior: [...fallback.interior] as TileCoord }
          : {}),
      };
      return acc;
    }, {} as Record<EdgeDirection, SandEdgeVariant>),
  };

  for (const entry of sandEntries) {
    if (entry.tags.includes("material")) {
      derived.center = atlas(entry.name);
      continue;
    }

    if (!entry.connections.length) {
      continue;
    }

    const orientationKey = [...entry.connections].sort().join("+");
    if (!EDGE_DIRECTION_SET.has(orientationKey as EdgeDirection)) {
      continue;
    }

    const direction = orientationKey as EdgeDirection;
    const bucket = derived.edges[direction];
    if (!bucket) {
      continue;
    }

    const isInterior = entry.tags.includes("coin_interieur");
    const isEdgeCandidate =
      isInterior || entry.tags.includes("bordure") || entry.tags.includes("falaise");
    if (!isEdgeCandidate) {
      continue;
    }

    if (isInterior) {
      bucket.interior = atlas(entry.name);
    } else {
      const priority = entry.tags.includes("bordure")
        ? 2
        : entry.tags.includes("falaise")
        ? 1
        : 0;
      const currentPriority = exteriorPriorities.get(direction) ?? -1;
      if (priority >= currentPriority) {
        bucket.exterior = atlas(entry.name);
        exteriorPriorities.set(direction, priority);
      }
    }
  }

  return derived;
}

// Fonctions utilitaires pour rechercher les tuiles par métadonnées
function getTilesByCategory(category: AtlasCategory, subtype?: string): AtlasEntry[] {
  const results: AtlasEntry[] = [];
  for (const entry of MAP_PACK_ATLAS.values()) {
    if (entry.category !== category) {
      continue;
    }
    if (subtype && entry.subtype !== subtype) {
      continue;
    }
    if (entry.overlay && entry.transparent === false) {
      continue;
    }
    if (category === "object" && subtype === "tree") {
      const description = entry.description?.toLowerCase() ?? "";
      if (description.includes("neige") || description.includes("mort")) {
        continue;
      }
    }
    results.push(entry);
  }
  return results;
}

function getRandomTileByCategory(
  category: AtlasCategory,
  subtype?: string,
  seed?: number
): TileCoord | null {
  const candidates = getTilesByCategory(category, subtype);
  if (candidates.length === 0) return null;

  // Utiliser une seed déterministe au lieu de Math.random()
  const index = seed !== undefined
    ? seed % candidates.length
    : Math.floor(Math.random() * candidates.length);

  const randomEntry = candidates[index];
  return atlas(randomEntry.name);
}

const TILE_KIND = {
  GRASS: 0,
  PATH: 1,
  WATER: 2,
  SAND: 3,
  TREE: 4,
  FLOWER: 5,
  FIELD: 6,
  DIRT: 7,
  DIRT_GRAY: 8,
  SNOW: 9,
} as const;

type TileKind = (typeof TILE_KIND)[keyof typeof TILE_KIND];

type TerrainObjectDefinition = {
  compatibleTerrains: readonly TileKind[];
  atlasCategory: AtlasCategory;
  atlasSubtype?: string;
  atlasChoices?: readonly string[];
  weight: number;
  fallback: TileCoord;
};

const TERRAIN_OBJECT_CATALOG = {
  oakTree: {
    compatibleTerrains: [
      TILE_KIND.GRASS,
      TILE_KIND.DIRT,
      TILE_KIND.DIRT_GRAY,
    ] as const,
    atlasCategory: "object",
    atlasSubtype: "tree",
    weight: 3,
    fallback: atlas("mapTile_115.png"),
  },
  pineTree: {
    compatibleTerrains: [
      TILE_KIND.GRASS,
      TILE_KIND.DIRT,
      TILE_KIND.DIRT_GRAY,
    ] as const,
    atlasCategory: "object",
    atlasSubtype: "tree",
    weight: 2,
    fallback: atlas("mapTile_040.png"),
  },
  snowyTree: {
    compatibleTerrains: [TILE_KIND.SNOW] as const,
    atlasCategory: "object",
    atlasSubtype: "tree",
    atlasChoices: ["mapTile_109.png", "mapTile_110.png"] as const,
    weight: 4,
    fallback: atlas("mapTile_109.png"),
  },
  deadTree: {
    compatibleTerrains: [TILE_KIND.DIRT, TILE_KIND.DIRT_GRAY] as const,
    atlasCategory: "object",
    atlasSubtype: "tree",
    weight: 1,
    fallback: atlas("mapTile_120.png"),
  },
  cactusPlant: {
    compatibleTerrains: [TILE_KIND.SAND] as const,
    atlasCategory: "object",
    atlasSubtype: "plant",
    weight: 3,
    fallback: atlas("mapTile_035.png"),
  },
  flowerShrub: {
    compatibleTerrains: [TILE_KIND.GRASS, TILE_KIND.FIELD] as const,
    atlasCategory: "object",
    atlasSubtype: "flower",
    weight: 2,
    fallback: atlas("mapTile_054.png"),
  },
  mushroomPatch: {
    compatibleTerrains: [TILE_KIND.GRASS, TILE_KIND.FIELD, TILE_KIND.SNOW] as const,
    atlasCategory: "object",
    atlasSubtype: "flower_whitebg",
    weight: 1,
    fallback: atlas("mapTile_104.png"),
  },
  smallRock: {
    compatibleTerrains: [
      TILE_KIND.GRASS,
      TILE_KIND.DIRT,
      TILE_KIND.DIRT_GRAY,
      TILE_KIND.SAND,
      TILE_KIND.SNOW,
    ] as const,
    atlasCategory: "object",
    atlasSubtype: "rock",
    weight: 1,
    fallback: atlas("mapTile_039.png"),
  },
  igloo: {
    compatibleTerrains: [TILE_KIND.SNOW] as const,
    atlasCategory: "object",
    atlasSubtype: "building",
    atlasChoices: ["mapTile_095.png"] as const,
    weight: 1,
    fallback: atlas("mapTile_095.png"),
  },
  snowman: {
    compatibleTerrains: [TILE_KIND.SNOW] as const,
    atlasCategory: "character",
    atlasSubtype: "npc",
    atlasChoices: ["mapTile_094.png"] as const,
    weight: 1,
    fallback: atlas("mapTile_094.png"),
  },
} as const satisfies Record<string, TerrainObjectDefinition>;

type TerrainObjectId = keyof typeof TERRAIN_OBJECT_CATALOG;

type TerrainObjectPlacement = {
  id: TerrainObjectId;
  seed: number;
};

type TerrainObjectPoolEntry = {
  id: TerrainObjectId;
  weight?: number;
};

type TerrainObjectPool = {
  density: number;
  objects: readonly TerrainObjectPoolEntry[];
};

const TERRAIN_OBJECT_POOLS = {
  [TILE_KIND.GRASS]: {
    density: 0.35,
    objects: [
      { id: "oakTree", weight: 3 },
      { id: "pineTree", weight: 2 },
      { id: "flowerShrub", weight: 2 },
      { id: "mushroomPatch" },
      { id: "smallRock" },
    ],
  },
  [TILE_KIND.DIRT]: {
    density: 0.3,
    objects: [
      { id: "deadTree", weight: 2 },
      { id: "oakTree" },
      { id: "smallRock", weight: 2 },
      { id: "mushroomPatch" },
    ],
  },
  [TILE_KIND.DIRT_GRAY]: {
    density: 0.28,
    objects: [
      { id: "deadTree", weight: 2 },
      { id: "pineTree" },
      { id: "smallRock", weight: 3 },
    ],
  },
  [TILE_KIND.SAND]: {
    density: 0.22,
    objects: [
      { id: "cactusPlant", weight: 3 },
      { id: "smallRock", weight: 2 },
    ],
  },
  [TILE_KIND.SNOW]: {
    density: 0.34,
    objects: [
      { id: "snowyTree", weight: 4 },
      { id: "snowman", weight: 2 },
      { id: "igloo", weight: 1 },
    ],
  },
  [TILE_KIND.FIELD]: {
    density: 0.18,
    objects: [
      { id: "flowerShrub", weight: 2 },
      { id: "mushroomPatch" },
    ],
  },
} as const satisfies Partial<Record<TileKind, TerrainObjectPool>>;

const LOWER_TERRAIN_TYPES = new Set<TileKind>([
  TILE_KIND.WATER,
  TILE_KIND.SAND,
  TILE_KIND.FIELD,
]);

type TerrainThemeConfig = {
  label: string;
  base: TileKind;
};

const TERRAIN_THEMES = {
  sand: {
    label: "Sable",
    base: TILE_KIND.SAND,
  },
  grass: {
    label: "Gazon",
    base: TILE_KIND.GRASS,
  },
  dirt: {
    label: "Terre",
    base: TILE_KIND.DIRT,
  },
  dirtGray: {
    label: "Terre grise",
    base: TILE_KIND.DIRT_GRAY,
  },
  snow: {
    label: "Neige",
    base: TILE_KIND.SNOW,
  },
} as const satisfies Record<string, TerrainThemeConfig>;

const TERRAIN_THEME_ORDER: TerrainThemeId[] = [
  "sand",
  "grass",
  "dirt",
  "dirtGray",
  "snow",
];

const DIAGONAL_CONNECTIONS = new Set<string>([
  "northeast",
  "northwest",
  "southeast",
  "southwest",
]);

const GRASS_VARIANT_SELECTION_ORDER: GrassVariantKey[] = [
  "northwest",
  "northeast",
  "north",
  "west",
  "east",
  "southwest",
  "southeast",
  "south",
  "center",
];

function isLowerTerrainKind(kind: TileKind | null | undefined): boolean {
  return kind !== null && kind !== undefined && LOWER_TERRAIN_TYPES.has(kind);
}

function chooseTerrainObject(
  tileKind: TileKind,
  rng: () => number
): TerrainObjectPlacement | null {
  const pool = TERRAIN_OBJECT_POOLS[tileKind];
  if (!pool) {
    return null;
  }

  const density = Math.max(0, Math.min(1, pool.density));
  if (density <= 0 || rng() >= density) {
    return null;
  }

  const candidates = pool.objects
    .map((entry) => {
      const definition = TERRAIN_OBJECT_CATALOG[entry.id];
      if (!definition) {
        return null;
      }
      if (!definition.compatibleTerrains.includes(tileKind)) {
        return null;
      }
      const weight = definition.weight * (entry.weight ?? 1);
      if (weight <= 0) {
        return null;
      }
      return { id: entry.id, weight };
    })
    .filter(
      (candidate): candidate is { id: TerrainObjectId; weight: number } =>
        candidate !== null
    );

  if (candidates.length === 0) {
    return null;
  }

  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  let selection = rng() * totalWeight;
  for (const candidate of candidates) {
    selection -= candidate.weight;
    if (selection <= 0) {
      return {
        id: candidate.id,
        seed: Math.floor(rng() * 0x100000000),
      };
    }
  }

  const fallbackCandidate = candidates[candidates.length - 1];
  return {
    id: fallbackCandidate.id,
    seed: Math.floor(rng() * 0x100000000),
  };
}

// Types pour la superposition de tuiles
type TerrainTile = {
  base: TileKind;
  overlay?: TileKind;
  cliffConnections?: string[];
  edge?: IslandEdgePlacement;
  object?: TerrainObjectPlacement;
};

function tileHasLowerTerrain(tile: TerrainTile | undefined | null): boolean {
  if (!tile) return false;
  if (tile.overlay !== undefined && isLowerTerrainKind(tile.overlay)) {
    return true;
  }
  return isLowerTerrainKind(tile.base);
}

function populateTerrainObjects(
  tiles: TerrainTile[][],
  rng: () => number
) {
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;

  const hasLower = (tx: number, ty: number) =>
    tileHasLowerTerrain(tiles[ty]?.[tx] ?? null);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[y]?.[x];
      if (!tile) {
        continue;
      }
      if (tile.base === TILE_KIND.WATER || tile.overlay === TILE_KIND.PATH) {
        tile.object = undefined;
        continue;
      }
      if (!tileHasLowerTerrain(tile)) {
        const cliffConnections = computeCliffConnections(x, y, hasLower);
        if (cliffConnections.size > 0) {
          tile.object = undefined;
          continue;
        }
      }
      const placement = chooseTerrainObject(tile.base, rng);
      tile.object = placement ?? undefined;
    }
  }
}

function createTerrainObjectSeed(
  seed: number,
  themeId?: TerrainThemeId
): number {
  if (!themeId) {
    return seed >>> 0;
  }
  let hash = seed >>> 0;
  for (let index = 0; index < themeId.length; index++) {
    hash = Math.imul(hash ^ themeId.charCodeAt(index), 0x45d9f3b);
    hash >>>= 0;
  }
  return hash >>> 0;
}

function repopulateTerrainObjects(
  tiles: TerrainTile[][],
  seed: number,
  themeId?: TerrainThemeId
) {
  const adjustedSeed = createTerrainObjectSeed(seed, themeId);
  const rng = createRng(adjustedSeed);
  populateTerrainObjects(tiles, rng);
}

function applyTerrainThemeToWorld(
  tiles: TerrainTile[][],
  theme: TerrainThemeConfig
) {
  for (const row of tiles) {
    for (const tile of row) {
      if (!tile) {
        continue;
      }
      if (tile.base === TILE_KIND.WATER) {
        continue;
      }
      tile.base = theme.base;
      if (tile.overlay && tile.overlay !== TILE_KIND.PATH) {
        delete tile.overlay;
      }
      if (tile.object) {
        tile.object = undefined;
      }
      tile.edge = undefined;
      tile.cliffConnections = undefined;
    }
  }
}

function recomputeWorldMetadata(worldTiles: TerrainTile[][]) {
  const height = worldTiles.length;
  const width = worldTiles[0]?.length ?? 0;

  const hasLower = (tx: number, ty: number) =>
    tileHasLowerTerrain(worldTiles[ty]?.[tx] ?? null);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const connections = Array.from(computeCliffConnections(x, y, hasLower));
      const tile = worldTiles[y]?.[x];
      if (!tile) {
        continue;
      }
      const hasConnections = connections.length > 0;
      if (hasConnections && !tileHasLowerTerrain(tile) && tile.object) {
        tile.object = undefined;
      }
      tile.cliffConnections = hasConnections ? connections : undefined;
    }
  }

  const islandCells = new Set<CoordKey>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = worldTiles[y]?.[x];
      if (!tile) {
        continue;
      }
      if (tile.base !== TILE_KIND.WATER) {
        islandCells.add(coordKey(x, y));
      }
      tile.edge = undefined;
    }
  }

  const placements = computeIslandEdgePlacements(
    islandCells,
    width,
    height
  );

  for (const [key, placement] of placements.entries()) {
    const [px, py] = coordFromKey(key as CoordKey);
    const tile = worldTiles[py]?.[px];
    if (tile) {
      tile.edge = placement;
    }
  }
}

function computeCliffConnections(
  x: number,
  y: number,
  hasLower: (x: number, y: number) => boolean
): Set<string> {
  const connections = new Set<string>();

  const northLower = hasLower(x, y - 1);
  const southLower = hasLower(x, y + 1);
  const eastLower = hasLower(x + 1, y);
  const westLower = hasLower(x - 1, y);

  const northeastLower = hasLower(x + 1, y - 1) || (northLower && eastLower);
  const northwestLower = hasLower(x - 1, y - 1) || (northLower && westLower);
  const southeastLower = hasLower(x + 1, y + 1) || (southLower && eastLower);
  const southwestLower = hasLower(x - 1, y + 1) || (southLower && westLower);

  if (northLower) connections.add("north");
  if (southLower) connections.add("south");
  if (eastLower) connections.add("east");
  if (westLower) connections.add("west");
  if (northeastLower) connections.add("northeast");
  if (northwestLower) connections.add("northwest");
  if (southeastLower) connections.add("southeast");
  if (southwestLower) connections.add("southwest");

  return connections;
}

const HIGHLIGHT_TILES = new Set<TileKind>([TILE_KIND.PATH]);

type TilesetMode = "builtin" | "atlas";

type TileCoord = [number, number] | [number, number, number, number];

const GRASS_VARIANT_KEYS = [
  "center",
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
] as const;

type GrassVariantKey = (typeof GRASS_VARIANT_KEYS)[number];
type GrassDirection = Exclude<GrassVariantKey, "center">;

type GrassTiles = { center: TileCoord } & Partial<Record<GrassDirection, TileCoord>>;

type PartialSandEdgeVariant = Partial<Record<"exterior" | "interior", TileCoord>>;

type PartialSandTiles = {
  center?: TileCoord;
  edges?: Partial<Record<EdgeDirection, PartialSandEdgeVariant>>;
};

type Tileset = {
  mode: TilesetMode;
  url?: string;
  size: number;
  map: {
    grass: GrassTiles;
    path: TileCoord;
    farmland: TileCoord;
    sand: SandTiles;
    water: {
      deep: TileCoord;
      shore: TileCoord;
    };
    details: {
      tree: TileCoord;
      flower: TileCoord;
    };
    houses: {
      clarte: TileCoord;
      creation: TileCoord;
      decision: TileCoord;
      ethique: TileCoord;
      townHall: TileCoord;
    };
    player: TileCoord[];
  };
};

const DERIVED_SAND_TILES = deriveSandTilesFromAtlas();

const BUILTIN_GROUND_VARIANTS = {
  grass: deriveSandTilesFromAtlas("grass"),
  dirt: deriveSandTilesFromAtlas("dirt_brown"),
  dirtGray: deriveSandTilesFromAtlas("dirt_gray"),
  snow: deriveSandTilesFromAtlas("ice"),
} as const satisfies Record<string, SandTiles>;

function cloneSandTiles(source: SandTiles): SandTiles {
  const clonedEdges = EDGE_DIRECTIONS.reduce((acc, direction) => {
    const variant = source.edges[direction];
    acc[direction] = {
      exterior: [...variant.exterior] as TileCoord,
      ...(variant.interior
        ? { interior: [...variant.interior] as TileCoord }
        : {}),
    };
    return acc;
  }, {} as Record<EdgeDirection, SandEdgeVariant>);

  return {
    center: [...source.center] as TileCoord,
    edges: clonedEdges,
  };
}

const DEFAULT_ATLAS: Tileset = {
  mode: "atlas",
  url: mapPackAtlas,
  size: DEFAULT_TILE_SIZE,
  map: {
    grass: {
      center: atlas("mapTile_022.png"),
      northwest: atlas("mapTile_006.png"),
      north: atlas("mapTile_007.png"),
      northeast: atlas("mapTile_008.png"),
      west: atlas("mapTile_021.png"),
      east: atlas("mapTile_023.png"),
    },
    path: atlas("mapTile_128.png"),
    farmland: atlas("mapTile_087.png"),
    sand: cloneSandTiles(DERIVED_SAND_TILES),
    water: {
      deep: atlas("mapTile_188.png"),
      shore: atlas("mapTile_171.png"),
    },
    details: {
      tree: atlas("mapTile_115.png"),
      flower: atlas("mapTile_054.png"),
    },
    houses: {
      clarte: atlas("mapTile_114.png"), // panneau d'avertissement
      creation: atlas("mapTile_050.png"), // tente colorée
      decision: atlas("mapTile_099.png"), // tour de château
      ethique: atlas("mapTile_095.png"), // igloo
      townHall: atlas("mapTile_100.png"), // château principal
    },
    player: DEFAULT_PLAYER_FRAMES.map((frame) => [...frame] as TileCoord),
  },
};

const OPEN_WORLD_CHARACTER_SPRITES: Partial<Record<QuarterId, TileCoord>> = Object.freeze({
  clarte: atlas("mapTile_137.png"),
  creation: atlas("mapTile_153.png"),
  decision: atlas("mapTile_154.png"),
  ethique: atlas("mapTile_170.png"),
  mairie: atlas("mapTile_136.png"),
});

function cloneTileset(source: Tileset): Tileset {
  return {
    ...source,
    map: {
      grass: (() => {
        const grassClone: GrassTiles = {
          center: [...source.map.grass.center] as TileCoord,
        };
        for (const key of GRASS_VARIANT_KEYS) {
          if (key === "center") continue;
          const direction = key as GrassDirection;
          const coord = source.map.grass[direction];
          if (coord) {
            grassClone[direction] = [...coord] as TileCoord;
          }
        }
        return grassClone;
      })(),
      path: [...source.map.path] as TileCoord,
      farmland: [...source.map.farmland] as TileCoord,
      sand: cloneSandTiles(source.map.sand),
      water: {
        deep: [...source.map.water.deep] as TileCoord,
        shore: [...source.map.water.shore] as TileCoord,
      },
      details: {
        tree: [...source.map.details.tree] as TileCoord,
        flower: [...source.map.details.flower] as TileCoord,
      },
      houses: {
        clarte: [...source.map.houses.clarte] as TileCoord,
        creation: [...source.map.houses.creation] as TileCoord,
        decision: [...source.map.houses.decision] as TileCoord,
        ethique: [...source.map.houses.ethique] as TileCoord,
        townHall: [...source.map.houses.townHall] as TileCoord,
      },
      player: source.map.player.map((frame) => [...frame] as TileCoord),
    },
  };
}

function normalizeCoord(
  coord: TileCoord | undefined,
  fallback: TileCoord
): TileCoord {
  const source = Array.isArray(coord) ? coord : fallback;
  const x = typeof source[0] === "number" ? source[0] : fallback[0];
  const y = typeof source[1] === "number" ? source[1] : fallback[1];
  const width =
    typeof source[2] === "number"
      ? source[2]
      : typeof fallback[2] === "number"
      ? fallback[2]
      : DEFAULT_TILE_SIZE;
  const height =
    typeof source[3] === "number"
      ? source[3]
      : typeof fallback[3] === "number"
      ? fallback[3]
      : DEFAULT_TILE_SIZE;
  return [x, y, width, height] as TileCoord;
}

function mergeGrassTiles(
  partial: Partial<GrassTiles> | undefined,
  base: GrassTiles
): GrassTiles {
  const mergedCenter = normalizeCoord(partial?.center as TileCoord | undefined, base.center);
  const merged: GrassTiles = { center: mergedCenter };

  for (const key of GRASS_VARIANT_KEYS) {
    if (key === "center") continue;
    const direction = key as GrassDirection;
    const partialCoord = partial?.[direction] as TileCoord | undefined;
    if (partialCoord) {
      merged[direction] = normalizeCoord(
        partialCoord,
        base[direction] ?? mergedCenter
      );
    } else if (base[direction]) {
      merged[direction] = [...base[direction]!] as TileCoord;
    }
  }

  return merged;
}

function mergeSandTiles(partial: PartialSandTiles | undefined, base: SandTiles): SandTiles {
  const mergedCenter = normalizeCoord(partial?.center as TileCoord | undefined, base.center);

  const mergedEdges = EDGE_DIRECTIONS.reduce((acc, direction) => {
    const baseVariant = base.edges[direction];
    const partialVariant = partial?.edges?.[direction];

    const exterior = normalizeCoord(
      partialVariant?.exterior as TileCoord | undefined,
      baseVariant.exterior
    );

    const mergedVariant: SandEdgeVariant = { exterior };

    if (partialVariant?.interior) {
      mergedVariant.interior = normalizeCoord(
        partialVariant.interior as TileCoord,
        baseVariant.interior ?? exterior
      );
    } else if (baseVariant.interior) {
      mergedVariant.interior = [...baseVariant.interior] as TileCoord;
    }

    acc[direction] = mergedVariant;
    return acc;
  }, {} as Record<EdgeDirection, SandEdgeVariant>);

  return {
    center: mergedCenter,
    edges: mergedEdges,
  };
}

function mergeWithDefault(partial?: Partial<Tileset>): Tileset {
  const base = cloneTileset(DEFAULT_ATLAS);
  if (!partial || typeof partial !== "object") {
    return base;
  }
  const map = (partial.map ?? {}) as Partial<Tileset["map"]>;
  return {
    mode: partial.mode ?? base.mode,
    url: partial.url ?? base.url,
    size: partial.size ?? base.size,
    map: {
      grass: mergeGrassTiles(map.grass as Partial<GrassTiles> | undefined, base.map.grass),
      path: normalizeCoord(map.path as TileCoord | undefined, base.map.path),
      farmland: normalizeCoord(
        map.farmland as TileCoord | undefined,
        base.map.farmland
      ),
      sand: mergeSandTiles(map.sand as PartialSandTiles | undefined, base.map.sand),
      water: {
        deep: normalizeCoord(
          map.water?.deep as TileCoord | undefined,
          base.map.water.deep
        ),
        shore: normalizeCoord(
          map.water?.shore as TileCoord | undefined,
          base.map.water.shore
        ),
      },
      details: {
        tree: normalizeCoord(
          map.details?.tree as TileCoord | undefined,
          base.map.details.tree
        ),
        flower: normalizeCoord(
          map.details?.flower as TileCoord | undefined,
          base.map.details.flower
        ),
      },
      houses: {
        clarte: normalizeCoord(
          map.houses?.clarte as TileCoord | undefined,
          base.map.houses.clarte
        ),
        creation: normalizeCoord(
          map.houses?.creation as TileCoord | undefined,
          base.map.houses.creation
        ),
        decision: normalizeCoord(
          map.houses?.decision as TileCoord | undefined,
          base.map.houses.decision
        ),
        ethique: normalizeCoord(
          map.houses?.ethique as TileCoord | undefined,
          base.map.houses.ethique
        ),
        townHall: normalizeCoord(
          map.houses?.townHall as TileCoord | undefined,
          base.map.houses.townHall
        ),
      },
      player:
        Array.isArray(map.player) && map.player.length > 0
          ? map.player.map((frame, index) =>
              normalizeCoord(
                frame as TileCoord | undefined,
                base.map.player[index % base.map.player.length]
              )
            )
          : base.map.player.map((frame) => [...frame] as TileCoord),
    },
  };
}

function useTileset(): [Tileset, (t: Tileset) => void] {
  const [ts, setTs] = useState<Tileset>(() => {
    // Force l'utilisation du bon atlas par défaut
    return cloneTileset(DEFAULT_ATLAS);
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "explorateur.tileset",
      JSON.stringify(ts)
    );
  }, [ts]);

  return [ts, setTs];
}

function SpriteFromAtlas({
  ts,
  coord,
  scale = BASE_TILE_SIZE,
}: {
  ts: Tileset;
  coord: TileCoord;
  scale?: number;
}) {
  if (ts.mode !== "atlas" || !ts.url) {
    return null;
  }
  const rect = coord as [number, number, number?, number?];
  const isRect = rect.length >= 3;
  const baseWidth = isRect ? rect[2] ?? ts.size : ts.size;
  const baseHeight = isRect ? rect[3] ?? ts.size : ts.size;
  if (!baseWidth || !baseHeight) {
    return null;
  }
  const sourceX = rect[0];
  const sourceY = rect[1];
  const offsetX = -sourceX;
  const offsetY = -sourceY;
  const zoomX = scale / baseWidth;
  const zoomY = scale / baseHeight;
  return (
    <div
      style={{
        width: scale,
        height: scale,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: baseWidth,
          height: baseHeight,
          backgroundImage: `url(${ts.url})`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: `${offsetX}px ${offsetY}px`,
          imageRendering: "crisp-edges",
          transform: `scale(${zoomX}, ${zoomY})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}

function TerrainThemeOptions({
  selectedTheme,
  onSelectTheme,
  onRegenerate,
}: {
  selectedTheme: TerrainThemeId;
  onSelectTheme: (theme: TerrainThemeId) => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        {TERRAIN_THEME_ORDER.map((key) => {
          const theme = TERRAIN_THEMES[key];
          const isActive = selectedTheme === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectTheme(key)}
              className={classNames(
                "rounded-xl border px-3 py-2 text-left transition",
                isActive
                  ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-slate-50/80 hover:border-emerald-300 hover:bg-white"
              )}
              aria-pressed={isActive}
            >
              {theme.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onRegenerate}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"
      >
        Régénérer la forme
      </button>
      <p className="text-xs text-slate-500">
        Choisissez un style pour changer l'apparence et utilisez le bouton pour
        régénérer la forme de l'île. Le changement est visible immédiatement.
      </p>
    </div>
  );
}

function measureViewport(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: BASE_TILE_SIZE * 10, height: BASE_TILE_SIZE * 10 };
  }

  const viewport = window.visualViewport;
  if (viewport) {
    const width = viewport.width;
    const height = viewport.height - viewport.offsetTop;
    return { width, height };
  }

  return { width: window.innerWidth, height: window.innerHeight };
}

function computeTileSize(
  mode: TileScaleMode = "contain",
  maxSize = BASE_TILE_SIZE
): number {
  if (typeof window === "undefined") {
    return BASE_TILE_SIZE;
  }

  const { width, height } = measureViewport();
  if (width <= 0 || height <= 0) {
    return MIN_TILE_SIZE;
  }

  const availableHeight = Math.max(0, height - MOBILE_VERTICAL_PADDING);
  const tileForWidth = width / GRID_W;
  const tileForHeight = availableHeight / GRID_H;
  const containFit = Math.min(tileForWidth, tileForHeight);
  const coverFit = Math.max(tileForWidth, tileForHeight);
  const rawFit = mode === "cover" ? coverFit : containFit;

  if (!Number.isFinite(rawFit) || rawFit <= 0) {
    return MIN_TILE_SIZE;
  }

  const fallback = Number.isFinite(containFit) && containFit > 0
    ? Math.min(MIN_TILE_SIZE, containFit)
    : MIN_TILE_SIZE;
  const capped = Math.min(maxSize, rawFit);
  const normalized = Math.max(capped, fallback);
  const fallbackSize = Math.max(1, Math.round(fallback));

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallbackSize > 0 ? fallbackSize : MIN_TILE_SIZE;
  }

  const quantized = Math.round(normalized);

  if (!Number.isFinite(quantized) || quantized <= 0) {
    return fallbackSize > 0 ? fallbackSize : MIN_TILE_SIZE;
  }

  return quantized;
}

function useResponsiveTileSize(
  mode: TileScaleMode = "contain",
  options?: { maxSize?: number }
): number {
  const { maxSize = BASE_TILE_SIZE } = options ?? {};
  const [size, setSize] = useState(() => computeTileSize(mode, maxSize));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const recompute = () => {
      const nextSize = computeTileSize(mode, maxSize);
      setSize((current) => (current === nextSize ? current : nextSize));
    };

    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("orientationchange", recompute);

    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener("resize", recompute);
      viewport.addEventListener("scroll", recompute);
    }

    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("orientationchange", recompute);
      if (viewport) {
        viewport.removeEventListener("resize", recompute);
        viewport.removeEventListener("scroll", recompute);
      }
    };
  }, [maxSize, mode]);

  return size;
}

function computeIsMobile(breakpoint: number): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const minDimension = Math.min(window.innerWidth, window.innerHeight);
  const hasCoarsePointer = typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)").matches
    : false;

  return hasCoarsePointer || minDimension <= breakpoint;
}

function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(() => computeIsMobile(breakpoint));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)")
      : null;

    const recompute = () => {
      setIsMobile(computeIsMobile(breakpoint));
    };

    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("orientationchange", recompute);

    if (mediaQuery) {
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", recompute);
      } else if (typeof mediaQuery.addListener === "function") {
        mediaQuery.addListener(recompute);
      }
    }

    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("orientationchange", recompute);
      if (mediaQuery) {
        if (typeof mediaQuery.removeEventListener === "function") {
          mediaQuery.removeEventListener("change", recompute);
        } else if (typeof mediaQuery.removeListener === "function") {
          mediaQuery.removeListener(recompute);
        }
      }
    };
  }, [breakpoint]);

  return isMobile;
}

type Coord = [number, number];
type CoordKey = `${number},${number}`;

function coordKey(x: number, y: number): CoordKey {
  return `${x},${y}` as CoordKey;
}

function coordFromKey(key: CoordKey): Coord {
  const [x, y] = key.split(",").map(Number);
  return [x, y];
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function randomInt(rng: () => number, min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const span = high - low + 1;
  if (span <= 0) {
    return low;
  }
  const value = Math.floor(rng() * span);
  return low + value;
}

function randomChoice<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function shuffleInPlace<T>(rng: () => number, items: T[]): void {
  for (let index = items.length - 1; index > 0; index--) {
    const target = Math.floor(rng() * (index + 1));
    const tmp = items[index];
    items[index] = items[target];
    items[target] = tmp;
  }
}

function generateIslandCells(
  width: number,
  height: number,
  rng: () => number,
  targetRatio: [number, number] = [0.25, 0.4]
): Set<CoordKey> {
  if (width < 3 || height < 3) {
    throw new Error("World is too small to host an island");
  }

  const minCells = Math.floor(width * height * targetRatio[0]);
  const maxCells = Math.floor(width * height * targetRatio[1]);
  let targetSize = Math.max(
    4,
    randomInt(rng, minCells, Math.max(maxCells, minCells + 1))
  );
  targetSize = Math.min(targetSize, width * height - 1);

  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const island = new Set<CoordKey>([coordKey(centerX, centerY)]);
  const frontier = new Set<CoordKey>();

  const addNeighbors = (x: number, y: number) => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 1 && nx < width - 1 && ny >= 1 && ny < height - 1) {
        frontier.add(coordKey(nx, ny));
      }
    }
  };

  addNeighbors(centerX, centerY);

  let attempts = 0;
  while (island.size < targetSize && attempts < width * height * 10) {
    if (frontier.size === 0) {
      for (const cellKey of island) {
        const [x, y] = coordFromKey(cellKey);
        addNeighbors(x, y);
      }
      for (const cellKey of island) {
        frontier.delete(cellKey);
      }
      if (frontier.size === 0) {
        break;
      }
    }

    const candidates = Array.from(frontier);
    const candidateKey = randomChoice(rng, candidates);
    frontier.delete(candidateKey);
    const [cx, cy] = coordFromKey(candidateKey);

    const distanceWeight =
      Math.abs(cx - centerX) / Math.max(1, width) +
      Math.abs(cy - centerY) / Math.max(1, height);
    const acceptanceThreshold = Math.max(0.15, 1 - distanceWeight);

    if (rng() < acceptanceThreshold) {
      island.add(candidateKey);
      addNeighbors(cx, cy);
      for (const cellKey of island) {
        frontier.delete(cellKey);
      }
    }

    attempts += 1;
  }

  return island;
}

function findOutsideWaterCells(
  island: Set<CoordKey>,
  width: number,
  height: number
): Set<CoordKey> {
  const outside = new Set<CoordKey>();
  const visited = new Set<CoordKey>();
  const queue: Coord[] = [];

  const enqueue = (x: number, y: number) => {
    const key = coordKey(x, y);
    if (island.has(key) || visited.has(key)) {
      return;
    }
    visited.add(key);
    queue.push([x, y]);
  };

  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    outside.add(coordKey(cx, cy));
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        enqueue(nx, ny);
      }
    }
  }

  return outside;
}

function fillSmallLakesInIsland(
  island: Set<CoordKey>,
  width: number,
  height: number
) {
  const outside = findOutsideWaterCells(island, width, height);

  for (let x = 1; x < width - 1; x++) {
    for (let y = 1; y < height - 1; y++) {
      const key = coordKey(x, y);
      if (island.has(key) || outside.has(key)) {
        continue;
      }
      island.add(key);
    }
  }
}

type EdgeClassification = {
  orientation: EdgeOrientation;
  orientationType: EdgeVariantType;
  target: CoordKey;
};

function classifyEdgeCellForIsland(
  cell: Coord,
  island: Set<CoordKey>,
  isOutside: boolean
): EdgeClassification[] {
  const [x, y] = cell;
  const north = island.has(coordKey(x, y - 1));
  const south = island.has(coordKey(x, y + 1));
  const east = island.has(coordKey(x + 1, y));
  const west = island.has(coordKey(x - 1, y));
  const northeast = island.has(coordKey(x + 1, y - 1));
  const northwest = island.has(coordKey(x - 1, y - 1));
  const southeast = island.has(coordKey(x + 1, y + 1));
  const southwest = island.has(coordKey(x - 1, y + 1));

  if (
    !north &&
    !south &&
    !east &&
    !west &&
    !northeast &&
    !northwest &&
    !southeast &&
    !southwest
  ) {
    return [];
  }

  const placements: EdgeClassification[] = [];

  const addCandidate = (
    orientation: EdgeOrientation,
    orientationType: EdgeVariantType,
    targetX: number,
    targetY: number
  ) => {
    const key = coordKey(targetX, targetY);
    if (island.has(key)) {
      placements.push({ orientation, orientationType, target: key });
    }
  };

  if (south) {
    addCandidate(["north"], "exterior", x, y + 1);
  }
  if (north) {
    addCandidate(["south"], "exterior", x, y - 1);
  }
  if (east) {
    addCandidate(["west"], "exterior", x + 1, y);
  }
  if (west) {
    addCandidate(["east"], "exterior", x - 1, y);
  }

  if (north && west && !south && !east) {
    addCandidate(["southeast"], isOutside ? "exterior" : "interior", x - 1, y - 1);
  }
  if (north && east && !south && !west) {
    addCandidate(["southwest"], isOutside ? "exterior" : "interior", x + 1, y - 1);
  }
  if (south && west && !north && !east) {
    addCandidate(["northeast"], isOutside ? "exterior" : "interior", x - 1, y + 1);
  }
  if (south && east && !north && !west) {
    addCandidate(["northwest"], isOutside ? "exterior" : "interior", x + 1, y + 1);
  }

  if (southwest) {
    addCandidate(["northeast"], "exterior", x - 1, y + 1);
  }
  if (southeast) {
    addCandidate(["northwest"], "exterior", x + 1, y + 1);
  }
  if (northwest) {
    addCandidate(["southeast"], "exterior", x - 1, y - 1);
  }
  if (northeast) {
    addCandidate(["southwest"], "exterior", x + 1, y - 1);
  }

  return placements;
}

export function computeIslandEdgePlacements(
  island: Set<CoordKey>,
  width: number,
  height: number
): Map<CoordKey, IslandEdgePlacement> {
  const cardinalOffsets: Record<string, Coord> = {
    north: [0, -1],
    south: [0, 1],
    east: [1, 0],
    west: [-1, 0],
  };

  const cornerCardinals: Record<string, [string, string]> = {
    northeast: ["north", "east"],
    northwest: ["north", "west"],
    southeast: ["south", "east"],
    southwest: ["south", "west"],
  };

  const outsideWater = findOutsideWaterCells(island, width, height);
  const candidates = new Map<CoordKey, boolean>();

  for (const cellKey of island) {
    const [x, y] = coordFromKey(cellKey);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        const neighborKey = coordKey(nx, ny);
        if (island.has(neighborKey)) {
          continue;
        }
        const isOutside = outsideWater.has(neighborKey);
        const previous = candidates.get(neighborKey);
        if (previous === undefined || (!previous && isOutside)) {
          candidates.set(neighborKey, isOutside);
        }
      }
    }
  }

  const priority = (
    orientation: EdgeOrientation,
    orientationType: EdgeVariantType,
    targetKey: CoordKey
  ): [number, number] => {
    const direction = orientation[0] ?? "";
    if (direction in cornerCardinals) {
      const neighbors = cornerCardinals[direction];
      let outsideTouch = 0;
      const [tx, ty] = coordFromKey(targetKey);
      for (const card of neighbors) {
        const [ox, oy] = cardinalOffsets[card];
        const nx = tx + ox;
        const ny = ty + oy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          outsideTouch += 1;
          continue;
        }
        const neighborKey = coordKey(nx, ny);
        if (island.has(neighborKey)) {
          continue;
        }
        if (outsideWater.has(neighborKey)) {
          outsideTouch += 1;
        }
      }
      const isTrueCorner = outsideTouch === 2 || orientationType === "interior";
      const diagonalRank = isTrueCorner ? 0 : 2;
      const interiorRank = orientationType === "interior" ? 0 : 1;
      return [diagonalRank, interiorRank];
    }

    return [1, orientationType === "interior" ? 0 : 1];
  };

  const placements = new Map<CoordKey, IslandEdgePlacement>();
  const priorities = new Map<CoordKey, [number, number]>();

  for (const [candidateKey, isOutside] of Array.from(candidates.entries()).sort(
    (a, b) => {
      const [ax, ay] = coordFromKey(a[0]);
      const [bx, by] = coordFromKey(b[0]);
      return ay === by ? ax - bx : ay - by;
    }
  )) {
    const candidateCoord = coordFromKey(candidateKey);
    const classifications = classifyEdgeCellForIsland(
      candidateCoord,
      island,
      isOutside
    );

    for (const { orientation, orientationType, target } of classifications) {
      if (!orientation.length) {
        continue;
      }

      const direction = orientation[0];
      let effectiveType = orientationType;
      if (effectiveType === "exterior" && direction in cornerCardinals) {
        const neighbors = cornerCardinals[direction];
        const [tx, ty] = coordFromKey(target);
        if (
          neighbors.every((card) => {
            const [ox, oy] = cardinalOffsets[card];
            return island.has(coordKey(tx + ox, ty + oy));
          })
        ) {
          effectiveType = "interior";
        }
      }

      const placementPriority = priority(orientation, effectiveType, target);
      const previousPriority = priorities.get(target);
      if (previousPriority && previousPriority <= placementPriority) {
        continue;
      }

      priorities.set(target, placementPriority);
      placements.set(target, {
        orientation,
        variant: effectiveType,
        touchesOutside: isOutside,
      });
    }
  }

  return placements;
}

function smoothIslandShape(island: Set<CoordKey>) {
  if (island.size === 0) {
    return;
  }

  const maxIterations = Math.max(1, island.size);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const toRemove: CoordKey[] = [];
    for (const key of island) {
      const [x, y] = coordFromKey(key);
      let neighbors = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (island.has(coordKey(x + dx, y + dy))) {
          neighbors += 1;
        }
      }
      if (neighbors <= 1) {
        toRemove.push(key);
      }
    }
    if (toRemove.length === 0 || toRemove.length >= island.size) {
      break;
    }
    for (const key of toRemove) {
      island.delete(key);
    }
  }
}

function pruneNarrowSpurs(island: Set<CoordKey>, maxLength = 3) {
  if (island.size === 0 || maxLength <= 0) {
    return;
  }

  let changed = false;
  do {
    changed = false;
    const neighborMap = buildNeighborMap(island);
    const visited = new Set<CoordKey>();
    const toRemove = new Set<CoordKey>();

    for (const [key, neighbors] of neighborMap.entries()) {
      if (visited.has(key) || neighbors.length !== 1) {
        continue;
      }

      const chain: CoordKey[] = [];
      let current: CoordKey | null = key;
      let previous: CoordKey | null = null;
      let shouldRemove = false;

      while (current) {
        chain.push(current);
        visited.add(current);

        const nextNeighbors = neighborMap.get(current) ?? [];
        const degree = nextNeighbors.length;
        const candidates = nextNeighbors.filter((candidate) => candidate !== previous);

        if (chain.length > maxLength) {
          shouldRemove = false;
          break;
        }

        if (candidates.length !== 1) {
          if (chain.length <= maxLength && degree >= 2) {
            shouldRemove = true;
          }
          break;
        }

        previous = current;
        current = candidates[0] ?? null;

        if (current && chain.includes(current)) {
          shouldRemove = false;
          break;
        }
      }

      if (shouldRemove) {
        for (let index = 0; index < chain.length - 1; index++) {
          const cell = chain[index];
          if (cell) {
            toRemove.add(cell);
          }
        }
      }
    }

    if (toRemove.size > 0) {
      changed = true;
      for (const key of toRemove) {
        island.delete(key);
      }
    }
  } while (changed);
}

function buildNeighborMap(cells: Set<CoordKey>): Map<CoordKey, CoordKey[]> {
  const neighborMap = new Map<CoordKey, CoordKey[]>();
  for (const key of cells) {
    const [x, y] = coordFromKey(key);
    const neighbors: CoordKey[] = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const candidate = coordKey(x + dx, y + dy);
      if (cells.has(candidate)) {
        neighbors.push(candidate);
      }
    }
    if (neighbors.length > 0) {
      neighborMap.set(key, neighbors);
    }
  }
  return neighborMap;
}

function bfsFrom(
  start: CoordKey,
  neighborMap: Map<CoordKey, CoordKey[]>,
  rng: () => number
): {
  previous: Map<CoordKey, CoordKey | null>;
  distances: Map<CoordKey, number>;
} {
  const previous = new Map<CoordKey, CoordKey | null>();
  const distances = new Map<CoordKey, number>();
  const queue: CoordKey[] = [start];

  previous.set(start, null);
  distances.set(start, 0);

  while (queue.length > 0) {
    const node = queue.shift()!;
    const neighbors = [...(neighborMap.get(node) ?? [])];
    shuffleInPlace(rng, neighbors);
    for (const neighbor of neighbors) {
      if (previous.has(neighbor)) {
        continue;
      }
      previous.set(neighbor, node);
      distances.set(neighbor, (distances.get(node) ?? 0) + 1);
      queue.push(neighbor);
    }
  }

  return { previous, distances };
}

function reconstructPath(
  previous: Map<CoordKey, CoordKey | null>,
  goal: CoordKey
): CoordKey[] {
  const path: CoordKey[] = [];
  let current: CoordKey | null | undefined = goal;
  while (current != null) {
    path.push(current);
    current = previous.get(current) ?? null;
  }
  return path.reverse();
}

function carvePathOnIsland(
  island: Set<CoordKey>,
  desiredLength: number,
  rng: () => number
): CoordKey[] {
  const neighborMap = buildNeighborMap(island);
  const cells = Array.from(neighborMap.keys());
  if (cells.length === 0) {
    return [];
  }

  const distanceFromEdge = new Map<CoordKey, number>();
  const frontier: CoordKey[] = [];
  for (const key of cells) {
    const degree = neighborMap.get(key)?.length ?? 0;
    if (degree < 4) {
      distanceFromEdge.set(key, 0);
      frontier.push(key);
    }
  }

  for (let index = 0; index < frontier.length; index++) {
    const current = frontier[index];
    const currentDistance = distanceFromEdge.get(current) ?? 0;
    for (const neighbor of neighborMap.get(current) ?? []) {
      if (distanceFromEdge.has(neighbor)) {
        continue;
      }
      distanceFromEdge.set(neighbor, currentDistance + 1);
      frontier.push(neighbor);
    }
  }

  let maxEdgeDistance = 0;
  for (const distance of distanceFromEdge.values()) {
    if (distance > maxEdgeDistance) {
      maxEdgeDistance = distance;
    }
  }

  let candidateStarts = cells;
  if (maxEdgeDistance > 0) {
    const MIN_START_DISTANCE = 2;
    const preferredThreshold = Math.min(maxEdgeDistance, MIN_START_DISTANCE);
    const preferred = cells.filter(
      (key) => (distanceFromEdge.get(key) ?? 0) >= preferredThreshold
    );
    if (preferred.length > 0) {
      candidateStarts = preferred;
    } else {
      const farthest = cells.filter(
        (key) => (distanceFromEdge.get(key) ?? 0) === maxEdgeDistance
      );
      if (farthest.length > 0) {
        candidateStarts = farthest;
      }
    }
  }

  const maxLength = Math.min(desiredLength, cells.length);
  const minLength = Math.max(1, Math.min(6, maxLength));
  let bestPath: CoordKey[] = [];

  for (let targetLength = maxLength; targetLength >= minLength; targetLength--) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const start = randomChoice(rng, candidateStarts);
      const { previous, distances } = bfsFrom(start, neighborMap, rng);
      if (distances.size <= 1) {
        continue;
      }

      const candidates: CoordKey[] = [];
      let farthest: { key: CoordKey; distance: number } | null = null;

      for (const [key, distance] of distances) {
        if (distance === 0) {
          continue;
        }
        if (distance >= targetLength - 1) {
          candidates.push(key);
        }
        if (!farthest || distance > farthest.distance) {
          farthest = { key, distance };
        }
      }

      const goal =
        candidates.length > 0
          ? randomChoice(rng, candidates)
          : farthest?.key ?? null;
      if (!goal) {
        continue;
      }

      const path = reconstructPath(previous, goal);
      if (path.length >= targetLength) {
        return path.slice(0, targetLength);
      }
      if (path.length > bestPath.length) {
        bestPath = path;
      }
    }
  }

  if (bestPath.length > 0) {
    return bestPath;
  }

  return [cells[0]];
}

function distributeIndices(total: number, count: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (total <= 0) {
    return Array(count).fill(0);
  }
  if (count === 1 || total === 1) {
    return Array(count).fill(0);
  }
  const step = (total - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => {
    const candidate = Math.round(index * step);
    if (!Number.isFinite(candidate)) {
      return 0;
    }
    if (candidate <= 0) {
      return 0;
    }
    const max = total - 1;
    if (candidate >= max) {
      return max;
    }
    return candidate;
  });
}

const WORLD_WIDTH = 25;
const WORLD_HEIGHT = 25;
let currentWorldSeed = WORLD_SEED;

type ExperienceModeDefinition = {
  label: string;
  badge: string;
  icon: string;
  description: string;
  designerDescription: string;
  runtimeHint: string;
};

const EXPERIENCE_MODE_DEFINITIONS: Record<
  ExplorateurExperienceMode,
  ExperienceModeDefinition
> = Object.freeze({
  guided: {
    label: "Parcours guidé",
    badge: "Mode guidé",
    icon: "🧭",
    description:
      "Les quartiers se débloquent dans un ordre conseillé avec un accompagnement constant.",
    designerDescription:
      "Le monde suit un déroulé linéaire : chaque quartier propose une mission cadrée avant de passer au suivant.",
    runtimeHint:
      "Avance quartier par quartier en suivant les missions proposées pour débloquer ton inventaire.",
  },
  "open-world": {
    label: "Mode open world",
    badge: "Mode open world",
    icon: "🌍",
    description:
      "Exploration libre : l'explorateur·rice peut se déplacer sans contrainte et choisir son propre chemin.",
    designerDescription:
      "Le personnage se promène librement, rencontre d'autres personnages et débloque les objets via leurs échanges.",
    runtimeHint:
      "Mode libre : le personnage se promène pour aller parler à d'autres personnages afin d'aller récupérer les objets.",
  },
});

const EXPERIENCE_MODE_OPTIONS = Object.freeze(
  Object.entries(EXPERIENCE_MODE_DEFINITIONS) as Array<
    [ExplorateurExperienceMode, ExperienceModeDefinition]
  >
);

function getDefaultExplorateurSteps(): StepDefinition[] {
  return flattenQuarterSteps(
    WORLD1_QUARTER_STEPS,
    DEFAULT_DERIVED_QUARTERS.quarterOrder
  ).map(cloneStepDefinition);
}

const FALLBACK_LANDMARKS: Record<QuarterId, { x: number; y: number }> = {
  mairie: { x: 12, y: 12 },
  clarte: { x: 6, y: 6 },
  creation: { x: 18, y: 6 },
  decision: { x: 6, y: 18 },
  ethique: { x: 18, y: 18 },
};

const DEFAULT_LANDMARK_ASSIGNMENT_ORDER: QuarterId[] = [
  ...DEFAULT_DERIVED_QUARTERS.buildingDisplayOrder,
];

type PathMarkerPlacement = { x: number; y: number; coord: TileCoord };

type GeneratedWorld = {
  tiles: TerrainTile[][];
  path: Coord[];
  landmarks: Record<QuarterId, { x: number; y: number }>;
  markers: PathMarkerPlacement[];
};

function assignLandmarksFromPath(path: Coord[]): Record<QuarterId, { x: number; y: number }> {
  const assignments: Record<QuarterId, { x: number; y: number }> = {
    mairie: { ...FALLBACK_LANDMARKS.mairie },
    clarte: { ...FALLBACK_LANDMARKS.clarte },
    creation: { ...FALLBACK_LANDMARKS.creation },
    decision: { ...FALLBACK_LANDMARKS.decision },
    ethique: { ...FALLBACK_LANDMARKS.ethique },
  };

  const assignmentOrder =
    currentDerivedData.buildingDisplayOrder.length > 0
      ? currentDerivedData.buildingDisplayOrder
      : DEFAULT_LANDMARK_ASSIGNMENT_ORDER;

  const interiorIndices = path
    .map((_, index) => index)
    .filter((index) => index > 0 && index < path.length - 1);

  const pickFrom = (indices: number[]) => {
    const distributed = distributeIndices(indices.length, assignmentOrder.length);
    assignmentOrder.forEach((id, index) => {
      const [x, y] = path[indices[distributed[index]]];
      assignments[id] = { x, y };
    });
  };

  if (interiorIndices.length >= assignmentOrder.length) {
    pickFrom(interiorIndices);
  } else {
    pickFrom(path.map((_, index) => index));
  }

  const stageOrder: QuarterId[] = [...PROGRESSION_WITH_GOAL];
  const indexByStage = new Map<QuarterId, number>();
  const takenIndices = new Set<number>();

  for (let index = 0; index < path.length; index++) {
    const [x, y] = path[index];
    for (const stage of PROGRESSION_SEQUENCE) {
      if (indexByStage.has(stage)) {
        continue;
      }
      const assignment = assignments[stage];
      if (!assignment) {
        continue;
      }
      if (assignment.x === x && assignment.y === y) {
        indexByStage.set(stage, index);
        takenIndices.add(index);
      }
    }
  }

  if (path.length > 0) {
    const goalIds =
      currentDerivedData.goalIds.length > 0
        ? currentDerivedData.goalIds
        : (["mairie"] as QuarterId[]);
    const [goalX, goalY] = path[path.length - 1];
    for (const goalId of goalIds) {
      indexByStage.set(goalId, path.length - 1);
      assignments[goalId] = { x: goalX, y: goalY };
    }
  }

  const moveStage = (stage: QuarterId, targetIndex: number) => {
    const currentIndex = indexByStage.get(stage);
    if (currentIndex === targetIndex) {
      return;
    }
    const [x, y] = path[targetIndex];
    if (currentIndex !== undefined) {
      takenIndices.delete(currentIndex);
    }
    assignments[stage] = { x, y };
    indexByStage.set(stage, targetIndex);
    takenIndices.add(targetIndex);
  };

  const MIN_GAP = 1;
  let adjusted = false;
  do {
    adjusted = false;
    for (let index = stageOrder.length - 2; index >= 0; index--) {
      const stage = stageOrder[index];
      const nextStage = stageOrder[index + 1];
      const stageIndex = indexByStage.get(stage);
      const nextIndex = indexByStage.get(nextStage);
      if (stageIndex === undefined || nextIndex === undefined) {
        continue;
      }
      if (nextIndex - stageIndex <= MIN_GAP) {
        const previousStage = index > 0 ? stageOrder[index - 1] : undefined;
        const previousIndex = previousStage
          ? indexByStage.get(previousStage)
          : undefined;
        const minIndex = previousIndex !== undefined ? previousIndex + 1 : 0;
        const maxIndex = nextIndex - (MIN_GAP + 1);
        if (maxIndex < minIndex) {
          continue;
        }
        const start = Math.min(stageIndex - 1, maxIndex);
        for (let candidate = start; candidate >= minIndex; candidate--) {
          if (!takenIndices.has(candidate)) {
            moveStage(stage, candidate);
            adjusted = true;
            break;
          }
        }
      }
    }
  } while (adjusted);

  const MIN_TILE_DISTANCE = 3;
  const computeDistance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  const stageIndexCache = new Map<QuarterId, number>(
    stageOrder.map((stage, index) => [stage, index] as const)
  );

  const isTooCloseToOthers = (
    stage: QuarterId,
    candidate: { x: number; y: number }
  ): boolean => {
    for (const otherStage of stageOrder) {
      if (otherStage === stage) {
        continue;
      }
      const placement = assignments[otherStage];
      if (!placement) {
        continue;
      }
      if (computeDistance(candidate, placement) < MIN_TILE_DISTANCE) {
        return true;
      }
    }
    return false;
  };

  const tryRelocateStage = (stage: QuarterId): boolean => {
    if (stage === "mairie") {
      return false;
    }
    const stageOrderIndex = stageIndexCache.get(stage);
    const stageIndex = indexByStage.get(stage);
    if (stageOrderIndex === undefined || stageIndex === undefined) {
      return false;
    }

    const currentPlacement = assignments[stage];
    if (!currentPlacement) {
      return false;
    }

    if (!isTooCloseToOthers(stage, currentPlacement)) {
      return false;
    }

    const previousStage = stageOrderIndex > 0 ? stageOrder[stageOrderIndex - 1] : undefined;
    const nextStage =
      stageOrderIndex < stageOrder.length - 1 ? stageOrder[stageOrderIndex + 1] : undefined;
    const previousIndex = previousStage ? indexByStage.get(previousStage) : undefined;
    const nextIndex = nextStage ? indexByStage.get(nextStage) : undefined;
    const minIndex = previousIndex !== undefined ? previousIndex + 1 : 0;
    const maxIndex =
      nextIndex !== undefined ? nextIndex - 1 : Math.max(path.length - 1, 0);

    if (minIndex > maxIndex) {
      return false;
    }

    const candidateIndices: number[] = [];
    const maxRange = Math.max(stageIndex - minIndex, maxIndex - stageIndex);
    for (let offset = 1; offset <= maxRange; offset++) {
      const backward = stageIndex - offset;
      const forward = stageIndex + offset;
      if (backward >= minIndex) {
        candidateIndices.push(backward);
      }
      if (forward <= maxIndex) {
        candidateIndices.push(forward);
      }
    }

    for (const candidateIndex of candidateIndices) {
      if (takenIndices.has(candidateIndex)) {
        continue;
      }
      const candidateCoord = path[candidateIndex];
      if (!candidateCoord) {
        continue;
      }
      const [x, y] = candidateCoord;
      if (isTooCloseToOthers(stage, { x, y })) {
        continue;
      }
      moveStage(stage, candidateIndex);
      return true;
    }

    return false;
  };

  let spacingAdjusted = false;
  do {
    spacingAdjusted = false;
    for (const stage of stageOrder) {
      if (tryRelocateStage(stage)) {
        spacingAdjusted = true;
      }
    }
  } while (spacingAdjusted);

  return assignments;
}

const START_MARKER_COORD = atlas("mapTile_179.png");
const GOAL_MARKER_COORD = [...DEFAULT_ATLAS.map.houses.townHall] as TileCoord;
const GATE_MARKER_COORD = atlas("mapTile_044.png");
const ARRIVAL_SHIP_COORD = atlas("mapTile_059.png");
const ARRIVAL_FLIGHT_DURATION_MS = 2400;
const ARRIVAL_GLOW_DURATION_MS = 2500;
const ARRIVAL_TOTAL_DURATION_MS = ARRIVAL_GLOW_DURATION_MS + 200;

function generateWorld(
  seed: number = WORLD_SEED,
  mode: ExplorateurExperienceMode = currentWorldMode
): GeneratedWorld {
  currentWorldSeed = seed >>> 0;
  currentWorldMode = mode;
  const rng = createRng(seed);
  const tiles: TerrainTile[][] = Array.from({ length: WORLD_HEIGHT }, () =>
    Array.from({ length: WORLD_WIDTH }, () => ({ base: TILE_KIND.WATER } as TerrainTile))
  );

  const island = generateIslandCells(WORLD_WIDTH, WORLD_HEIGHT, rng);
  fillSmallLakesInIsland(island, WORLD_WIDTH, WORLD_HEIGHT);
  smoothIslandShape(island);
  pruneNarrowSpurs(island);

  for (const key of island) {
    const [x, y] = coordFromKey(key as CoordKey);
    const row = tiles[y];
    if (!row) {
      continue;
    }
    row[x].base = TILE_KIND.SAND;
    delete row[x].overlay;
    row[x].cliffConnections = undefined;
    row[x].edge = undefined;
  }

  const edgePlacements = computeIslandEdgePlacements(island, WORLD_WIDTH, WORLD_HEIGHT);
  for (const [key, placement] of edgePlacements) {
    const [x, y] = coordFromKey(key);
    const tile = tiles[y]?.[x];
    if (!tile) {
      continue;
    }
    tile.edge = {
      orientation: placement.orientation.slice() as EdgeOrientation,
      variant: placement.variant,
      touchesOutside: placement.touchesOutside,
    };
  }

  const assignmentOrder =
    currentDerivedData.buildingDisplayOrder.length > 0
      ? currentDerivedData.buildingDisplayOrder
      : DEFAULT_LANDMARK_ASSIGNMENT_ORDER;

  const desiredPathLength = Math.max(
    assignmentOrder.length,
    Math.floor(island.size * 0.45)
  );

  const pathKeys = carvePathOnIsland(island, desiredPathLength, rng);
  const path: Coord[] = pathKeys.map((key) => coordFromKey(key as CoordKey));

  const isOpenWorld = mode === "open-world";

  for (const [x, y] of path) {
    const tile = tiles[y]?.[x];
    if (!tile) {
      continue;
    }
    tile.base = TILE_KIND.SAND;
    if (isOpenWorld) {
      delete tile.overlay;
    } else {
      tile.overlay = TILE_KIND.PATH;
    }
    tile.object = undefined;
  }

  populateTerrainObjects(tiles, rng);

  const landmarks = assignLandmarksFromPath(path);
  if (path.length > 0) {
    const [goalX, goalY] = path[path.length - 1];
    landmarks.mairie = { x: goalX, y: goalY };
  }

  for (const { x, y } of Object.values(landmarks)) {
    const tile = tiles[y]?.[x];
    if (tile) {
      tile.object = undefined;
    }
  }

  const markers: PathMarkerPlacement[] = [];
  const startCoord = path[0];
  if (startCoord) {
    const [startX, startY] = startCoord;
    markers.push({ x: startX, y: startY, coord: START_MARKER_COORD });
  }

  const goalCoord = landmarks.mairie ?? FALLBACK_LANDMARKS.mairie;
  if (goalCoord) {
    const { x: goalX, y: goalY } = goalCoord;
    if (!startCoord || goalX !== startCoord[0] || goalY !== startCoord[1]) {
      markers.push({ x: goalX, y: goalY, coord: GOAL_MARKER_COORD });
    }
  }

  return { tiles, path, landmarks, markers };
}

// Générée une seule fois et mise en cache
let _worldCache: GeneratedWorld | null = null;
function getWorld(): GeneratedWorld {
  if (!_worldCache) {
    _worldCache = generateWorld();
  }
  return _worldCache;
}

const generatedWorld = getWorld();
const world = generatedWorld.tiles;
const GRID_H = world.length;
const GRID_W = world[0]?.length ?? 0;

function rebuildLandmarkAssignments() {
  const assignments = assignLandmarksFromPath(generatedWorld.path);
  const assignedIds = new Set(
    Object.keys(assignments) as QuarterId[]
  );

  const existingIds = Object.keys(
    generatedWorld.landmarks
  ) as QuarterId[];
  for (const id of existingIds) {
    if (!assignedIds.has(id)) {
      delete generatedWorld.landmarks[id];
    }
  }

  for (const id of assignedIds) {
    const coord = assignments[id];
    if (!coord) {
      continue;
    }
    generatedWorld.landmarks[id] = { x: coord.x, y: coord.y };
  }
}

const MARKER_COORD_BY_KEY = new Map<string, TileCoord>();
function updateMarkerCoordCache(markers: PathMarkerPlacement[]) {
  MARKER_COORD_BY_KEY.clear();
  for (const placement of markers) {
    MARKER_COORD_BY_KEY.set(`${placement.x}-${placement.y}`, placement.coord);
  }
}
updateMarkerCoordCache(generatedWorld.markers);

const PATH_INDEX_BY_COORD = new Map<CoordKey, number>();
function updatePathIndexCache(path: Coord[]) {
  PATH_INDEX_BY_COORD.clear();
  path.forEach(([x, y], index) => {
    PATH_INDEX_BY_COORD.set(coordKey(x, y), index);
  });
}
updatePathIndexCache(generatedWorld.path);

const buildings: Array<{
  id: QuarterId;
  x: number;
  y: number;
  label: string;
  color: string;
  number?: number;
}> = [];
function rebuildBuildings() {
  buildings.splice(0, buildings.length, ...BUILDING_DISPLAY_ORDER.map((id) => {
    const landmark =
      generatedWorld.landmarks[id] ??
      FALLBACK_LANDMARKS[id] ??
      FALLBACK_LANDMARKS.mairie;
    const meta = BUILDING_META[id];
    return {
      id,
      x: landmark?.x ?? 0,
      y: landmark?.y ?? 0,
      label: meta?.label ?? id,
      color: meta?.color ?? "#ffffff",
      number: currentUiExperienceMode === "guided" ? meta?.number : undefined,
    };
  }));
}
rebuildBuildings();

const BUILDING_BY_COORD = new Map<CoordKey, QuarterId>();
function rebuildBuildingLookup() {
  BUILDING_BY_COORD.clear();
  for (const building of buildings) {
    BUILDING_BY_COORD.set(coordKey(building.x, building.y), building.id);
  }
}
rebuildBuildingLookup();

type PathGate = {
  stage: QuarterId;
  x: number;
  y: number;
};

const PATH_GATES: PathGate[] = [];
function rebuildPathGates() {
  PATH_GATES.splice(0, PATH_GATES.length);
  if (currentWorldMode === "open-world") {
    return;
  }
  const buildingById = new Map(buildings.map((entry) => [entry.id, entry] as const));

  for (let index = 0; index < PROGRESSION_SEQUENCE.length; index++) {
    const stage = PROGRESSION_SEQUENCE[index];
    const currentBuilding = buildingById.get(stage);
    const nextStage = PROGRESSION_WITH_GOAL[index + 1];
    const nextBuilding = nextStage ? buildingById.get(nextStage) : undefined;

    if (!currentBuilding || !nextBuilding) {
      continue;
    }

    const stageIndex = PATH_INDEX_BY_COORD.get(
      coordKey(currentBuilding.x, currentBuilding.y)
    );
    const nextIndex = PATH_INDEX_BY_COORD.get(
      coordKey(nextBuilding.x, nextBuilding.y)
    );

    if (
      stageIndex === undefined ||
      nextIndex === undefined ||
      stageIndex === nextIndex
    ) {
      continue;
    }

    const step = stageIndex < nextIndex ? 1 : -1;
    let gateCoord: Coord | undefined;

    for (let pathIndex = stageIndex + step; pathIndex !== nextIndex; pathIndex += step) {
      const candidate = generatedWorld.path[pathIndex];
      if (!candidate) {
        break;
      }
      const candidateKey = coordKey(candidate[0], candidate[1]);
      if (!BUILDING_BY_COORD.has(candidateKey)) {
        gateCoord = candidate;
        break;
      }
    }

    if (!gateCoord) {
      const fallbackIndex = stageIndex + step;
      if (fallbackIndex >= 0 && fallbackIndex < generatedWorld.path.length) {
        gateCoord = generatedWorld.path[fallbackIndex];
      } else {
        gateCoord = [currentBuilding.x, currentBuilding.y];
      }
    }

    if (gateCoord) {
      let gateKey = coordKey(gateCoord[0], gateCoord[1]);
      if (BUILDING_BY_COORD.get(gateKey) === "mairie") {
        const gateIndex = PATH_INDEX_BY_COORD.get(gateKey);
        if (gateIndex !== undefined) {
          const previousIndex = gateIndex - step;
          if (previousIndex >= 0 && previousIndex < generatedWorld.path.length) {
            const previousCoord = generatedWorld.path[previousIndex];
            const previousKey = coordKey(previousCoord[0], previousCoord[1]);
            if (BUILDING_BY_COORD.get(previousKey) !== "mairie") {
              gateCoord = previousCoord;
              gateKey = previousKey;
            } else {
              gateCoord = [currentBuilding.x, currentBuilding.y];
              gateKey = coordKey(gateCoord[0], gateCoord[1]);
            }
          } else {
            gateCoord = [currentBuilding.x, currentBuilding.y];
            gateKey = coordKey(gateCoord[0], gateCoord[1]);
          }
        } else {
          gateCoord = [currentBuilding.x, currentBuilding.y];
          gateKey = coordKey(gateCoord[0], gateCoord[1]);
        }
      }

      if (BUILDING_BY_COORD.get(gateKey) === "mairie") {
        gateCoord = [currentBuilding.x, currentBuilding.y];
      }

      PATH_GATES.push({ stage, x: gateCoord[0], y: gateCoord[1] });
    }
  }
}
rebuildPathGates();

const GATE_BY_COORD = new Map<CoordKey, PathGate>();
function rebuildGateLookup() {
  GATE_BY_COORD.clear();
  for (const gate of PATH_GATES) {
    GATE_BY_COORD.set(coordKey(gate.x, gate.y), gate);
  }
}
rebuildGateLookup();

const START = { x: 0, y: 0 };
function updateStartFromWorld() {
  const firstStep = generatedWorld.path[0];
  if (firstStep) {
    START.x = firstStep[0];
    START.y = firstStep[1];
    return;
  }
  const fallback =
    generatedWorld.landmarks.mairie ?? FALLBACK_LANDMARKS.mairie;
  START.x = fallback.x;
  START.y = fallback.y;
}
updateStartFromWorld();

function randomWorldSeed(): number {
  return Math.floor(Math.random() * 1_000_000) + 1;
}

function regenerateWorldInPlace(
  seed: number = randomWorldSeed(),
  mode: ExplorateurExperienceMode = currentWorldMode
): {
  seed: number;
  start: { x: number; y: number };
} {
  const nextWorld = generateWorld(seed, mode);

  world.length = 0;
  for (const row of nextWorld.tiles) {
    world.push(row.map((tile) => ({ ...tile })));
  }
  generatedWorld.tiles = world;

  generatedWorld.path.length = 0;
  generatedWorld.path.push(...nextWorld.path);

  generatedWorld.markers.length = 0;
  generatedWorld.markers.push(...nextWorld.markers);

  const landmarkKeys = Object.keys({ ...generatedWorld.landmarks }) as QuarterId[];
  for (const key of landmarkKeys) {
    const nextLandmark = nextWorld.landmarks[key] ?? FALLBACK_LANDMARKS[key];
    generatedWorld.landmarks[key] = { x: nextLandmark.x, y: nextLandmark.y };
  }

  updateMarkerCoordCache(generatedWorld.markers);
  updatePathIndexCache(generatedWorld.path);
  rebuildBuildings();
  rebuildBuildingLookup();
  rebuildPathGates();
  rebuildGateLookup();
  updateStartFromWorld();

  if (_worldCache) {
    _worldCache.tiles = world;
    _worldCache.path = generatedWorld.path;
    _worldCache.markers = generatedWorld.markers;
    _worldCache.landmarks = generatedWorld.landmarks;
  }

  return { seed, start: { x: START.x, y: START.y } };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function PlayerSprite({
  ts,
  step,
  tileSize,
}: {
  ts: Tileset;
  step: number;
  tileSize: number;
}) {
  const hasCustomFrames =
    ts.mode === "atlas" && ts.url && ts.map.player.length > 0;
  const frames = hasCustomFrames ? ts.map.player : DEFAULT_PLAYER_FRAMES;
  const frame = frames[step % frames.length] ?? frames[0];
  const renderTileset = hasCustomFrames ? ts : DEFAULT_ATLAS;
  const sourceTileSize = renderTileset.size ?? DEFAULT_TILE_SIZE;
  const width =
    (Array.isArray(frame) && typeof frame[2] === "number"
      ? frame[2]
      : sourceTileSize) ?? sourceTileSize;
  const height =
    (Array.isArray(frame) && typeof frame[3] === "number"
      ? frame[3]
      : sourceTileSize) ?? sourceTileSize;
  if (width > 0 && height > 0) {
    return <SpriteFromAtlas ts={renderTileset} coord={frame} scale={tileSize} />;
  }
  return null;
}

function IntroArrival({ tileSize }: { tileSize: number }) {
  const glowStyle: CSSProperties = {
    background:
      "radial-gradient(circle at 50% 60%, rgba(16, 185, 129, 0.45), rgba(16, 185, 129, 0))",
    filter: "blur(0.5px)",
    animation: `alien-arrival-glow ${ARRIVAL_GLOW_DURATION_MS}ms ease-out forwards`,
    willChange: "opacity, transform",
  };

  const shipStyle: CSSProperties = {
    animation: `alien-arrival-flight ${ARRIVAL_FLIGHT_DURATION_MS}ms cubic-bezier(0.16, 0.9, 0.22, 1.08) forwards`,
    willChange: "transform, opacity",
    "--alien-arrival-unit": `${tileSize}px`,
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
      <div
        className="relative flex items-center justify-center"
        style={{ width: tileSize, height: tileSize }}
      >
        <div className="absolute inset-0 rounded-full" style={glowStyle} />
        <div className="absolute inset-0 flex items-center justify-center" style={shipStyle}>
          <SpriteFromAtlas
            ts={DEFAULT_ATLAS}
            coord={ARRIVAL_SHIP_COORD}
            scale={tileSize}
          />
        </div>
      </div>
    </div>
  );
}

function BuildingSprite({
  quarter,
  ts,
  tileSize,
}: {
  quarter: QuarterId;
  ts: Tileset;
  tileSize: number;
}) {
  const isOpenWorld = currentUiExperienceMode === "open-world";
  const numberValue = !isOpenWorld ? BUILDING_META[quarter]?.number : undefined;
  const openWorldCoord = isOpenWorld
    ? OPEN_WORLD_CHARACTER_SPRITES[quarter] ?? null
    : null;
  if (openWorldCoord) {
    return <SpriteFromAtlas ts={DEFAULT_ATLAS} coord={openWorldCoord} scale={tileSize} />;
  }
  const activeTileset = ts.mode === "atlas" && ts.url ? ts : DEFAULT_ATLAS;
  const coord =
    (typeof numberValue === "number" ? getNumberTileCoord(numberValue) : null) ??
    (quarter === "mairie"
      ? activeTileset.map.houses.townHall
      : quarter === "clarte"
      ? activeTileset.map.houses.clarte
      : quarter === "creation"
      ? activeTileset.map.houses.creation
      : quarter === "decision"
      ? activeTileset.map.houses.decision
      : activeTileset.map.houses.ethique);
  const width =
    (Array.isArray(coord) && typeof coord[2] === "number"
      ? coord[2]
      : activeTileset.size) ?? activeTileset.size;
  const height =
    (Array.isArray(coord) && typeof coord[3] === "number"
      ? coord[3]
      : activeTileset.size) ?? activeTileset.size;
  if (width > 0 && height > 0) {
    return <SpriteFromAtlas ts={activeTileset} coord={coord} scale={tileSize} />;
  }
  return null;
}

function isWalkable(x: number, y: number, fromX?: number, fromY?: number) {
  if (x < 0 || y < 0 || y >= world.length || x >= world[0].length) {
    return false;
  }
  const terrain = world[y][x];
  if (currentWorldMode === "open-world") {
    if (terrain.base === TILE_KIND.WATER || terrain.overlay === TILE_KIND.WATER) {
      return false;
    }
    if (terrain.object) {
      return false;
    }
    if (BUILDING_BY_COORD.has(coordKey(x, y))) {
      return false;
    }
    return true;
  }
  // Un chemin peut être soit en base soit en overlay
  const isPath = terrain.base === TILE_KIND.PATH || terrain.overlay === TILE_KIND.PATH;

  if (!isPath) return false;

  // Si on a les coordonnées d'origine, vérifier les connexions des deux côtés
  if (fromX !== undefined && fromY !== undefined) {
    // Déterminer la direction du mouvement
    const dx = x - fromX;
    const dy = y - fromY;

    // Obtenir les directions requises
    let sourceExitDirection = "";  // Direction de sortie de la tuile source
    let targetEntryDirection = ""; // Direction d'entrée dans la tuile cible

    if (dx === 1) {
      sourceExitDirection = "east";   // On sort vers l'est
      targetEntryDirection = "west";  // On arrive par l'ouest
    } else if (dx === -1) {
      sourceExitDirection = "west";   // On sort vers l'ouest
      targetEntryDirection = "east";  // On arrive par l'est
    } else if (dy === 1) {
      sourceExitDirection = "south";  // On sort vers le sud
      targetEntryDirection = "north"; // On arrive par le nord
    } else if (dy === -1) {
      sourceExitDirection = "north";  // On sort vers le nord
      targetEntryDirection = "south"; // On arrive par le sud
    }

    if (sourceExitDirection && targetEntryDirection) {
      // Vérifier la tuile source
      const sourcePathTileCoord = getPathTileCoord(fromX, fromY);
      const sourceTileName = getTileNameFromCoord(sourcePathTileCoord);

      // Vérifier la tuile de destination
      const targetPathTileCoord = getPathTileCoord(x, y);
      const targetTileName = getTileNameFromCoord(targetPathTileCoord);

      if (sourceTileName && targetTileName) {
        const sourceTileEntry = MAP_PACK_ATLAS.get(sourceTileName);
        const targetTileEntry = MAP_PACK_ATLAS.get(targetTileName);

        if (sourceTileEntry && targetTileEntry &&
            sourceTileEntry.connections && targetTileEntry.connections) {
          // Les deux tuiles doivent avoir les connexions appropriées
          const sourceHasExit = sourceTileEntry.connections.includes(sourceExitDirection);
          const targetHasEntry = targetTileEntry.connections.includes(targetEntryDirection);

          return sourceHasExit && targetHasEntry;
        }
      }
    }
  }

  return true; // Fallback si pas de vérification de connexion possible
}

// Fonction utilitaire pour retrouver le nom de tuile à partir de ses coordonnées
function getTileNameFromCoord(coord: TileCoord): string | null {
  for (const [tileName, entry] of MAP_PACK_ATLAS.entries()) {
    if (entry.x === coord[0] && entry.y === coord[1]) {
      return tileName;
    }
  }
  return null;
}

function MobileArrowControls({
  onMove,
  containerRef,
}: {
  onMove: (dx: number, dy: number) => void;
  containerRef?: Ref<HTMLDivElement>;
}) {
  const buttonClass =
    "flex h-10 w-10 items-center justify-center rounded-full bg-slate-900/40 text-white text-lg shadow-lg backdrop-blur-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 hover:bg-slate-900/50 active:scale-95";
  const handle = (dx: number, dy: number) => () => {
    onMove(dx, dy);
  };

  return (
    <div
      ref={containerRef}
      className="pointer-events-auto rounded-3xl bg-slate-900/25 p-2.5 shadow-lg backdrop-blur-sm"
    >
      <div className="grid grid-cols-3 gap-1.5">
        <div />
        <button
          type="button"
          aria-label="Aller vers le haut"
          onClick={handle(0, -1)}
          className={buttonClass}
        >
          ▲
        </button>
        <div />
        <button
          type="button"
          aria-label="Aller vers la gauche"
          onClick={handle(-1, 0)}
          className={buttonClass}
        >
          ◀
        </button>
        <div />
        <button
          type="button"
          aria-label="Aller vers la droite"
          onClick={handle(1, 0)}
          className={buttonClass}
        >
          ▶
        </button>
        <div />
        <button
          type="button"
          aria-label="Aller vers le bas"
          onClick={handle(0, 1)}
          className={classNames(buttonClass, "col-start-2")}
        >
          ▼
        </button>
        <div />
      </div>
    </div>
  );
}

type MobilePromptBuilding = {
  id: QuarterId;
  x: number;
  y: number;
  label: string;
  number?: number;
  color: string;
};

const MOBILE_CONTROL_GAP = 12;

function MobileControlsOverlay({
  building,
  onEnter,
  onMove,
  showQuarterNumbers,
}: {
  building: MobilePromptBuilding | null;
  onEnter: () => void;
  onMove: (dx: number, dy: number) => void;
  showQuarterNumbers: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLButtonElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [stackLayout, setStackLayout] = useState(false);

  const updateLayout = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!building || !promptRef.current || !controlsRef.current || !containerRef.current) {
      setStackLayout((previous) => (previous ? false : previous));
      return;
    }
    const promptWidth = promptRef.current.getBoundingClientRect().width;
    const controlsWidth = controlsRef.current.getBoundingClientRect().width;
    const containerWidth = containerRef.current.getBoundingClientRect().width;
    const shouldStack =
      promptWidth + controlsWidth + MOBILE_CONTROL_GAP > containerWidth;
    setStackLayout((previous) => (previous === shouldStack ? previous : shouldStack));
  }, [building]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleResize = () => updateLayout();
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    let resizeObserver: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(() => updateLayout());
      const prompt = promptRef.current;
      const controls = controlsRef.current;
      const container = containerRef.current;
      if (prompt) {
        resizeObserver.observe(prompt);
      }
      if (controls) {
        resizeObserver.observe(controls);
      }
      if (container) {
        resizeObserver.observe(container);
      }
    }
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [updateLayout, building]);

  useEffect(() => {
    updateLayout();
  }, [building, updateLayout]);

  const title =
    showQuarterNumbers && building?.number != null
      ? `Quartier ${building.number}`
      : building?.label;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4"
      style={{
        paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
        paddingLeft: "calc(16px + env(safe-area-inset-left))",
        paddingRight: "calc(16px + env(safe-area-inset-right))",
      }}
    >
      <div
        ref={containerRef}
        className={
          stackLayout
            ? "pointer-events-none flex w-full flex-col-reverse items-stretch gap-3"
            : classNames(
                "pointer-events-none flex w-full flex-row items-end gap-3",
                building ? "justify-between" : "justify-end"
              )
        }
      >
        {building && (
          <button
            ref={promptRef}
            type="button"
            onClick={onEnter}
            className="pointer-events-auto flex min-w-[150px] flex-col items-start justify-center rounded-2xl bg-white/95 px-5 py-3 text-left text-sm font-semibold text-slate-800 shadow-2xl ring-2 ring-emerald-200/80 backdrop-blur animate-[prompt-pop_260ms_ease-out]"
          >
            <span
              className="text-[11px] font-medium uppercase tracking-wide"
              style={{ color: building.color }}
            >
              {title}
            </span>
            <span className="text-lg leading-none text-slate-800">Entrer</span>
          </button>
        )}
        <MobileArrowControls onMove={onMove} containerRef={controlsRef} />
      </div>
    </div>
  );
}

function tileLayersAt(
  x: number,
  y: number
): { base: TileKind | null; overlay: TileKind | null } {
  if (y < 0 || y >= world.length) {
    return { base: null, overlay: null };
  }
  const row = world[y];
  if (!row || x < 0 || x >= row.length) {
    return { base: null, overlay: null };
  }
  const terrain = row[x];
  return {
    base: terrain.base ?? null,
    overlay: terrain.overlay ?? null,
  };
}

function tileAt(x: number, y: number): TileKind | null {
  const { base, overlay } = tileLayersAt(x, y);
  // Pour les connexions de chemins, regarder d'abord l'overlay puis la base
  return overlay ?? base;
}

function hasLowerTerrainAtWorld(x: number, y: number): boolean {
  const { base, overlay } = tileLayersAt(x, y);
  return isLowerTerrainKind(overlay) || isLowerTerrainKind(base);
}

function getConnectionsForCoord(coord: TileCoord): string[] {
  const key = coord.join(",");
  const cached = TILE_CONNECTION_CACHE.get(key);
  if (cached) {
    return cached;
  }

  const tileName = getTileNameFromCoord(coord);
  if (!tileName) {
    TILE_CONNECTION_CACHE.set(key, []);
    return [];
  }

  const entry = MAP_PACK_ATLAS.get(tileName);
  const connections = entry?.connections ?? [];

  TILE_CONNECTION_CACHE.set(key, connections);
  return connections;
}

function getGrassTileCoord(x: number, y: number, ts: Tileset): TileCoord {
  const grassTiles = ts.map.grass;
  const fallback = grassTiles.center;
  const tile = world[y]?.[x];

  const adjacency = tile?.cliffConnections?.length
    ? new Set(tile.cliffConnections)
    : computeCliffConnections(x, y, hasLowerTerrainAtWorld);

  if (adjacency.size === 0) {
    return fallback;
  }

  let bestCoord = fallback;
  let bestScore = -1;

  for (const key of GRASS_VARIANT_SELECTION_ORDER) {
    if (key === "center") continue;
    const direction = key as GrassDirection;
    const coord = grassTiles[direction];
    if (!coord) continue;

    const atlasConnections = getConnectionsForCoord(coord);
    const requiredConnections =
      atlasConnections.length > 0 ? atlasConnections : [direction];

    if (requiredConnections.every((conn) => adjacency.has(conn))) {
      const score = requiredConnections.reduce(
        (acc, conn) => acc + (DIAGONAL_CONNECTIONS.has(conn) ? 2 : 1),
        0
      );
      if (score > bestScore) {
        bestScore = score;
        bestCoord = coord;
      }
    }
  }

  return bestCoord;
}

function resolveEdgeDirection(orientation: EdgeOrientation): EdgeDirection | null {
  if (orientation.length === 0) {
    return null;
  }
  if (orientation.length === 1) {
    const direction = orientation[0] as EdgeDirection;
    return EDGE_DIRECTION_SET.has(direction) ? direction : null;
  }
  const key = [...orientation].sort().join("+") as EdgeDirection;
  return EDGE_DIRECTION_SET.has(key) ? key : null;
}

const DIAGONAL_EDGE_NAMES = new Set([
  "northeast",
  "northwest",
  "southeast",
  "southwest",
]);

function isDiagonalEdgeOrientation(orientation: EdgeOrientation): boolean {
  if (orientation.length === 0) {
    return false;
  }
  if (orientation.length === 1) {
    return DIAGONAL_EDGE_NAMES.has(orientation[0]);
  }
  if (orientation.length === 2) {
    const values = new Set(orientation);
    return (
      (values.has("north") && values.has("east")) ||
      (values.has("north") && values.has("west")) ||
      (values.has("south") && values.has("east")) ||
      (values.has("south") && values.has("west"))
    );
  }
  return false;
}

function getSandEdgeVariantCoord(
  sandTiles: SandTiles,
  orientation: EdgeOrientation,
  variant: EdgeVariantType
): TileCoord | null {
  const direction = resolveEdgeDirection(orientation);
  if (!direction) {
    return null;
  }
  const bucket = sandTiles.edges[direction];
  if (!bucket) {
    return null;
  }
  const preferred = variant === "interior" ? bucket.interior : bucket.exterior;
  return preferred ?? bucket.exterior ?? bucket.interior ?? null;
}

function getSandTileCoord(
  x: number,
  y: number,
  ts: Tileset,
  overrides?: SandTiles
): TileCoord {
  const sandTiles = overrides ?? ts.map.sand;
  const tile = world[y]?.[x];
  if (tile?.edge && !tile.edge.touchesOutside) {
    const orientation = tile.edge.orientation;
    const prefersInterior =
      tile.edge.variant !== "interior" && isDiagonalEdgeOrientation(orientation);
    const variantToUse = prefersInterior ? "interior" : tile.edge.variant;
    let oriented = getSandEdgeVariantCoord(sandTiles, orientation, variantToUse);
    if (!oriented && prefersInterior) {
      oriented = getSandEdgeVariantCoord(sandTiles, orientation, "exterior");
    }
    if (oriented) {
      return oriented;
    }
  }

  const northWater = tileLayersAt(x, y - 1).base === TILE_KIND.WATER;
  const southWater = tileLayersAt(x, y + 1).base === TILE_KIND.WATER;
  const westWater = tileLayersAt(x - 1, y).base === TILE_KIND.WATER;
  const eastWater = tileLayersAt(x + 1, y).base === TILE_KIND.WATER;

  const pickFallback = (direction: EdgeDirection): TileCoord | null => {
    const variant = sandTiles.edges[direction];
    if (!variant) {
      return null;
    }
    return variant.exterior ?? variant.interior ?? null;
  };

  if (northWater && eastWater) {
    return pickFallback("northeast") ?? ts.map.sand.center;
  }
  if (southWater && eastWater) {
    return pickFallback("southeast") ?? ts.map.sand.center;
  }
  if (northWater && westWater) {
    return pickFallback("northwest") ?? ts.map.sand.center;
  }
  if (southWater && westWater) {
    return pickFallback("southwest") ?? ts.map.sand.center;
  }
  if (northWater) {
    return pickFallback("north") ?? ts.map.sand.center;
  }
  if (southWater) {
    return pickFallback("south") ?? ts.map.sand.center;
  }
  if (eastWater) {
    return pickFallback("east") ?? ts.map.sand.center;
  }
  if (westWater) {
    return pickFallback("west") ?? ts.map.sand.center;
  }

  return sandTiles.center;
}

function getWaterTileCoord(x: number, y: number, ts: Tileset): TileCoord {
  const neighborKinds = [
    tileAt(x, y - 1),
    tileAt(x, y + 1),
    tileAt(x - 1, y),
    tileAt(x + 1, y),
    tileAt(x - 1, y - 1),
    tileAt(x + 1, y - 1),
    tileAt(x - 1, y + 1),
    tileAt(x + 1, y + 1),
  ];
  const touchesLand = neighborKinds.some(
    (neighbor) => neighbor !== null && neighbor !== TILE_KIND.WATER
  );
  return touchesLand ? ts.map.water.shore : ts.map.water.deep;
}

function getPathTileCoord(x: number, y: number): TileCoord {
  // Vérifier les connexions dans les 4 directions
  const north = tileAt(x, y - 1) === TILE_KIND.PATH;
  const south = tileAt(x, y + 1) === TILE_KIND.PATH;
  const east = tileAt(x + 1, y) === TILE_KIND.PATH;
  const west = tileAt(x - 1, y) === TILE_KIND.PATH;

  // Créer un pattern de connexions pour recherche intelligente (ordre alphabétique)
  const directionList = [];
  if (east) directionList.push("east");
  if (north) directionList.push("north");
  if (south) directionList.push("south");
  if (west) directionList.push("west");
  directionList.sort();
  const connectionString = directionList.join(",");

  // Chercher une tuile qui correspond exactement aux connexions, en priorisant les tuiles recommandées
  const availableMatches = [];
  for (const [tileName, entry] of MAP_PACK_ATLAS.entries()) {
    if (entry.category !== "path" || entry.connections.length === 0) {
      continue;
    }

    const entryConnections = [...entry.connections].sort().join(",");

    if (entryConnections === connectionString) {
      // Tuiles prioritaires spécifiées par l'utilisateur
      const priorityTiles = [
        "mapTile_126.png", "mapTile_127.png", "mapTile_128.png", "mapTile_123.png", "mapTile_124.png",
        "mapTile_121.png", "mapTile_122.png", "mapTile_138.png", "mapTile_139.png",
        "mapTile_140.png", "mapTile_141.png"
      ];

      const isPriorityTile = priorityTiles.includes(tileName);
      const priority = isPriorityTile
        ? 1
        : entry.subtype === "straight"
        ? 2
        : entry.subtype === "corner"
        ? 3
        : entry.subtype === "t_junction"
        ? 4
        : entry.subtype === "crossroads"
        ? 5
        : 6;
      availableMatches.push({ tileName, priority });
    }
  }

  // Prendre la tuile avec la priorité la plus haute (numéro le plus bas)
  if (availableMatches.length > 0) {
    availableMatches.sort((a, b) => a.priority - b.priority);
    return atlas(availableMatches[0].tileName);
  }

  // Fallback vers l'ancienne logique si pas de correspondance exacte
  const connectionCount = [north, south, east, west].filter(Boolean).length;

  if (connectionCount === 0) {
    return atlas("mapTile_126.png"); // trajet nord-sud simple à la place du croisement
  } else if (connectionCount === 1) {
    if (north) return atlas("mapTile_129.png"); // trajet fin sud
    if (south) return atlas("mapTile_146.png"); // trajet fin nord
    if (east) return atlas("mapTile_130.png"); // trajet fin ouest
    if (west) return atlas("mapTile_147.png"); // trajet fin est
  } else if (connectionCount === 2) {
    if (north && south) return atlas("mapTile_126.png"); // trajet nord-sud
    if (east && west) return atlas("mapTile_127.png"); // trajet est-ouest
    if (north && east) return atlas("mapTile_140.png"); // trajet nord-est
    if (north && west) return atlas("mapTile_141.png"); // trajet nord-ouest
    if (south && east) return atlas("mapTile_124.png"); // trajet sud-est
    if (south && west) return atlas("mapTile_158.png"); // trajet sud-ouest
  } else if (connectionCount === 3) {
    // Pour les T, préférer des connexions plus simples quand possible
    if (!north) return atlas("mapTile_127.png"); // est-ouest simple au lieu du T
    if (!south) return atlas("mapTile_127.png"); // est-ouest simple au lieu du T
    if (!east) return atlas("mapTile_126.png"); // nord-sud simple au lieu du T
    if (!west) return atlas("mapTile_126.png"); // nord-sud simple au lieu du T
  } else {
    // 4 connexions : préférer la tuile de croisement NESO standard
    return atlas("mapTile_128.png");
  }

  return atlas("mapTile_126.png"); // Default: ligne droite nord-sud
}

function getTerrainObjectSprite(
  placement: TerrainObjectPlacement,
  tileset: Tileset
): { coord: TileCoord; tileset: Tileset } | null {
  const definition = TERRAIN_OBJECT_CATALOG[placement.id];
  if (!definition) {
    return null;
  }

  const spriteTileset =
    tileset.mode === "atlas" && tileset.url ? tileset : DEFAULT_ATLAS;

  if (definition.atlasChoices && definition.atlasChoices.length > 0) {
    const index = placement.seed % definition.atlasChoices.length;
    const chosenName = definition.atlasChoices[index];
    if (chosenName) {
      const chosen = atlas(chosenName);
      if (chosen) {
        return { coord: chosen, tileset: spriteTileset };
      }
    }
  }

  const coord =
    getRandomTileByCategory(
      definition.atlasCategory,
      definition.atlasSubtype,
      placement.seed
    ) ?? definition.fallback;

  if (!coord) {
    return null;
  }

  return { coord, tileset: spriteTileset };
}

function getAtlasTile(
  tileKind: TileKind,
  ts: Tileset,
  x: number,
  y: number
): TileCoord | null {
  switch (tileKind) {
    case TILE_KIND.GRASS:
      return getGrassTileCoord(x, y, ts);
    case TILE_KIND.PATH:
      return getPathTileCoord(x, y);
    case TILE_KIND.WATER:
      return getWaterTileCoord(x, y, ts);
    case TILE_KIND.SAND:
      return getSandTileCoord(x, y, ts);
    case TILE_KIND.DIRT:
      return getSandTileCoord(x, y, ts, BUILTIN_GROUND_VARIANTS.dirt);
    case TILE_KIND.DIRT_GRAY:
      return getSandTileCoord(x, y, ts, BUILTIN_GROUND_VARIANTS.dirtGray);
    case TILE_KIND.SNOW:
      return getSandTileCoord(x, y, ts, BUILTIN_GROUND_VARIANTS.snow);
    case TILE_KIND.FIELD:
      return ts.map.farmland;
    case TILE_KIND.TREE:
      return (
        getRandomTileByCategory("object", "tree", x * 1000 + y) || ts.map.details.tree
      );
    case TILE_KIND.FLOWER:
      return (
        getRandomTileByCategory("object", "flower", x * 2000 + y) ||
        ts.map.details.flower
      );
    default:
      return ts.map.grass.center;
  }
}

function TileWithTs({
  terrain,
  ts,
  x,
  y,
  tileSize,
}: {
  terrain: TerrainTile;
  ts: Tileset;
  x: number;
  y: number;
  tileSize: number;
}) {
  const activeTileset = ts.mode === "atlas" && ts.url ? ts : DEFAULT_ATLAS;
  const baseVariantTiles =
    terrain.base === TILE_KIND.GRASS
      ? BUILTIN_GROUND_VARIANTS.grass
      : terrain.base === TILE_KIND.DIRT
      ? BUILTIN_GROUND_VARIANTS.dirt
      : terrain.base === TILE_KIND.DIRT_GRAY
      ? BUILTIN_GROUND_VARIANTS.dirtGray
      : terrain.base === TILE_KIND.SNOW
      ? BUILTIN_GROUND_VARIANTS.snow
      : null;
  const baseRenderTileset = baseVariantTiles ? DEFAULT_ATLAS : activeTileset;

  const edgePlacement = terrain.edge;
  const shouldUseWaterBase = edgePlacement?.touchesOutside ?? false;

  const baseCoord = shouldUseWaterBase
    ? getWaterTileCoord(x, y, activeTileset)
    : getAtlasTile(terrain.base, activeTileset, x, y);

  const overlayCoord = terrain.overlay
    ? getAtlasTile(terrain.overlay, activeTileset, x, y)
    : null;

  const objectSprite = terrain.object
    ? getTerrainObjectSprite(terrain.object, activeTileset)
    : null;

  const edgeOverlayCoord = edgePlacement?.touchesOutside
    ? getSandEdgeVariantCoord(
        baseVariantTiles ?? activeTileset.map.sand,
        edgePlacement.orientation,
        edgePlacement.variant
      )
    : null;

  const overlays = [
    edgeOverlayCoord ? { coord: edgeOverlayCoord, tileset: baseRenderTileset } : null,
    overlayCoord ? { coord: overlayCoord, tileset: activeTileset } : null,
    objectSprite,
  ].filter((entry): entry is { coord: TileCoord; tileset: Tileset } => Boolean(entry));

  return (
    <div className="relative">
      {baseCoord && (
        <SpriteFromAtlas ts={baseRenderTileset} coord={baseCoord} scale={tileSize} />
      )}
      {overlays.map((entry, index) => (
        <div key={index} className="absolute inset-0">
          <SpriteFromAtlas
            ts={entry.tileset}
            coord={entry.coord}
            scale={tileSize}
          />
        </div>
      ))}
    </div>
  );
}

function Fireworks({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <svg viewBox="0 0 200 200" className="w-[50vmin] h-[50vmin] opacity-90">
        {Array.from({ length: 12 }).map((_, index) => (
          <g key={index} transform={`rotate(${(index * 360) / 12} 100 100)`}>
            <circle cx="100" cy="40" r="3" fill="#ef476f">
              <animate
                attributeName="cy"
                values="100;40;100"
                dur="1.6s"
                repeatCount="indefinite"
                begin={`${index * 0.1}s`}
              />
              <animate
                attributeName="r"
                values="1;4;1"
                dur="1.6s"
                repeatCount="indefinite"
                begin={`${index * 0.1}s`}
              />
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}

function ClarteQuiz({ onDone }: { onDone: (score: number) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [score, setScore] = useState(0);

  const choose = (optionId: string) => {
    setSelected(optionId);
    const option = CLARTE_QUESTIONS[0].options.find((candidate) => candidate.id === optionId);
    if (!option) return;
    setFeedback(option.explain);
    setScore(option.score);
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <h4 className="font-semibold mb-2">Question</h4>
        <p className="mb-4">{CLARTE_QUESTIONS[0].q}</p>
        <div className="space-y-2">
          {CLARTE_QUESTIONS[0].options.map((option) => (
            <button
              key={option.id}
              onClick={() => choose(option.id)}
              className={classNames(
                "w-full text-left p-3 rounded-xl border shadow-sm",
                selected === option.id
                  ? "bg-emerald-50 border-emerald-300"
                  : "bg-white hover:bg-slate-50"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs bg-black/10 rounded px-1">{option.id}</span>
                {option.text}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4 className="font-semibold mb-2">Impact de votre choix</h4>
        <MiniAnimation strength={score} />
        <p className="mt-3 text-sm text-slate-700">
          {selected
            ? feedback
            : "Choisissez une option pour voir l'effet sur la qualité de la réponse."}
        </p>
        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm">Score:</span>
          <div className="flex-1 h-3 rounded-full bg-slate-200 overflow-hidden">
            <div style={{ width: `${score}%` }} className="h-full bg-emerald-500 transition-all" />
          </div>
          <span className="text-sm tabular-nums w-10 text-right">{score}</span>
        </div>
        <button
          disabled={selected == null}
          onClick={() => onDone(score)}
          className="mt-4 px-4 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-50"
        >
          Valider
        </button>
      </div>
    </div>
  );
}

function MiniAnimation({ strength }: { strength: number }) {
  const blocks = 12;
  return (
    <div className="grid grid-cols-6 gap-2">
      {Array.from({ length: blocks }).map((_, index) => {
        const align = strength >= (index + 1) * (100 / blocks);
        return (
          <div
            key={index}
            className={classNames(
              "h-6 rounded transition-all",
              align ? "bg-emerald-500" : "bg-emerald-200 translate-y-[2px]"
            )}
          />
        );
      })}
    </div>
  );
}

function ProgressBar({
  value,
  color,
}: {
  value: number;
  color: "emerald" | "blue" | "rose" | "violet";
}) {
  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-500",
    blue: "bg-blue-500",
    rose: "bg-rose-500",
    violet: "bg-violet-500",
  };
  return (
    <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
      <div style={{ width: `${value}%` }} className={classNames("h-full transition-all", colorMap[color])} />
    </div>
  );
}

function renderFieldValue(value: unknown): ReactNode {
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {value.map((entry, index) => (
          <li key={index} className="text-sm text-slate-700">
            {renderFieldValue(entry)}
          </li>
        ))}
      </ul>
    );
  }
  if (value && typeof value === "object") {
    return (
      <div className="space-y-2">
        {Object.entries(value as Record<string, unknown>).map(([key, entry]) => (
          <div key={key} className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {key}
            </div>
            <div className="text-sm text-slate-700">{renderFieldValue(entry)}</div>
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "string") {
    return <span>{value.trim() || "—"}</span>;
  }
  if (value === null || value === undefined) {
    return <span className="text-slate-400">—</span>;
  }
  return <span>{String(value)}</span>;
}

function StageAnswerSection({
  title,
  answer,
}: {
  title: string;
  answer?: Record<string, unknown>;
}): JSX.Element | null {
  if (!answer || Object.keys(answer).length === 0) {
    return null;
  }
  return (
    <section className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
        <div className="space-y-3">
          {Object.entries(answer).map(([fieldId, value]) => (
            <div key={fieldId} className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {fieldId}
              </div>
              <div className="text-sm text-slate-700">{renderFieldValue(value)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BadgeView({
  progress,
  onDownloadJSON,
}: {
  progress: ExplorateurProgress;
  onDownloadJSON: () => void;
}) {
  const creationScore = progress.creation.done ? 100 : 0;
  const decisionScore = progress.decision.done ? 100 : 0;
  const ethicsScore = progress.ethique.averageScore ?? 0;
  const mairieScore = progress.mairie.done ? 100 : 0;
  const total =
    progress.clarte.score +
    creationScore +
    decisionScore +
    ethicsScore +
    mairieScore;
  const percent = Math.round(total / 5);

  return (
    <div className="flex flex-col md:flex-row gap-6 items-start">
      <div className="border rounded-2xl p-5 bg-white shadow min-w-[260px]">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Carte de compétences IA
        </div>
        <div className="mt-2 text-2xl font-black">Explorateur IA</div>
        <div className="mt-3 space-y-2">
          <div className="text-sm flex items-center justify-between">
            <span>Clarté</span>
            <span className="tabular-nums">{progress.clarte.score}</span>
          </div>
          <ProgressBar value={progress.clarte.score} color="emerald" />
          <div className="text-sm flex items-center justify-between">
            <span>Création</span>
            <span className="tabular-nums">{creationScore}</span>
          </div>
          <ProgressBar value={creationScore} color="blue" />
          <div className="text-sm flex items-center justify-between">
            <span>Décision</span>
            <span className="tabular-nums">{decisionScore}</span>
          </div>
          <ProgressBar value={decisionScore} color="rose" />
          <div className="text-sm flex items-center justify-between">
            <span>Éthique</span>
            <span className="tabular-nums">{ethicsScore}</span>
          </div>
          <ProgressBar value={ethicsScore} color="violet" />
          <div className="text-sm flex items-center justify-between">
            <span>Mairie</span>
            <span className="tabular-nums">{mairieScore}</span>
          </div>
          <ProgressBar value={mairieScore} color="emerald" />
        </div>
        <div className="mt-4 p-3 rounded-xl bg-slate-50 border">
          <div className="text-sm">Indice global</div>
          <div className="text-3xl font-black">
            {percent}
            <span className="text-base font-semibold">%</span>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onDownloadJSON}
            className="px-3 py-2 rounded-xl bg-slate-800 text-white"
          >
            Télécharger JSON
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-2 rounded-xl bg-slate-100 border"
          >
            Imprimer PDF
          </button>
        </div>
      </div>
      <div className="flex-1">
        <p className="text-sm text-slate-600">
          Cette carte résume vos actions. Exportez-la pour dépôt ou portfolio.
        </p>
        <div className="mt-6 space-y-8">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
              Quartier Clarté
            </h3>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900">
              <div className="font-semibold">
                Option sélectionnée : {progress.clarte.selectedOptionId ?? "—"}
              </div>
              {progress.clarte.explanation ? (
                <p className="mt-2 text-emerald-900/80">
                  {progress.clarte.explanation}
                </p>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-700">
              Quartier Création
            </h3>
            {progress.creation.spec ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-900 space-y-1">
                <div>
                  <span className="font-semibold">Action :</span> {progress.creation.spec.action ?? "—"}
                </div>
                <div>
                  <span className="font-semibold">Media :</span> {progress.creation.spec.media ?? "—"}
                </div>
                <div>
                  <span className="font-semibold">Style :</span> {progress.creation.spec.style ?? "—"}
                </div>
                <div>
                  <span className="font-semibold">Thème :</span> {progress.creation.spec.theme ?? "—"}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Spécification en attente.</p>
            )}
            <StageAnswerSection
              title="Réflexion"
              answer={progress.creation.reflection as Record<string, unknown> | undefined}
            />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-rose-700">
              Quartier Décision
            </h3>
            {progress.decision.path && progress.decision.path.length ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-900">
                <div className="font-semibold">Trajectoire choisie</div>
                <p className="mt-1">
                  {progress.decision.path.join(" → ")}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Aucun choix enregistré pour le moment.</p>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-violet-700">
              Quartier Éthique
            </h3>
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-sm text-violet-900 space-y-2">
              <div className="font-semibold">
                Score moyen : {progress.ethique.averageScore}
              </div>
              {progress.ethique.answers.length ? (
                <ul className="space-y-1 text-violet-900/80">
                  {progress.ethique.answers.map((answer) => (
                    <li key={`${answer.dilemmaId}-${answer.optionId}`}>
                      {answer.dilemmaId} → {answer.optionId} ({answer.score})
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Aucune réponse enregistrée.</p>
              )}
            </div>
            <StageAnswerSection
              title="Engagement"
              answer={progress.ethique.commitment as Record<string, unknown> | undefined}
            />
          </section>

          <StageAnswerSection
            title="Mairie — Synthèse"
            answer={progress.mairie.reflection as Record<string, unknown> | undefined}
          />
        </div>
      </div>
    </div>
  );
}

function InventoryView({ items }: { items: InventoryEntry[] }) {
  const collected = items.reduce((total, item) => total + (item.obtained ? 1 : 0), 0);
  const total = items.length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
        <div className="text-sm font-semibold text-emerald-800">
          {collected} objet{collected > 1 ? "s" : ""} collecté{collected > 1 ? "s" : ""} sur {total}
        </div>
        <p className="mt-1 text-sm text-emerald-900/80">
          Chaque quartier réussi ajoute un objet unique à votre sac d'explorateur.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.stage}
            className={classNames(
              "rounded-2xl border p-4 shadow-sm transition",
              item.obtained
                ? "border-emerald-200 bg-white"
                : "border-dashed border-slate-300 bg-slate-50"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="text-3xl" aria-hidden="true">
                {item.icon}
              </div>
              <span
                className={classNames(
                  "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                  item.obtained
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-200 text-slate-600"
                )}
              >
                {item.obtained ? "Acquis" : "À débloquer"}
              </span>
            </div>
            <div className="mt-3">
              <div className="text-base font-semibold text-slate-800">
                {item.title}
              </div>
              <p
                className={classNames(
                  "mt-2 text-sm",
                  item.obtained ? "text-slate-600" : "text-slate-500"
                )}
              >
                {item.obtained ? item.description : item.hint}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ExplorateurIA({
  config,
  isEditMode: isEditModeProp,
  onUpdateConfig,
  onAdvance,
}: StepComponentProps): JSX.Element {
  const context = useContext(StepSequenceContext);
  const isEditMode = context?.isEditMode ?? isEditModeProp ?? false;
  const effectiveOnUpdateConfig =
    context?.onUpdateConfig ?? onUpdateConfig ?? (() => {});
  const activityContext =
    (context?.activityContext as StepSequenceActivityContextBridge | null | undefined) ??
    null;
  const safeOnAdvance =
    typeof onAdvance === "function" ? onAdvance : () => {};
  const rawCompletionId =
    typeof activityContext?.completionId === "string"
      ? activityContext.completionId
      : typeof activityContext?.activityId === "string"
      ? activityContext.activityId
      : undefined;
  const completionId =
    rawCompletionId && rawCompletionId.trim().length > 0
      ? rawCompletionId
      : "explorateur-ia";
  const navigateToActivities =
    typeof activityContext?.navigateToActivities === "function"
      ? (activityContext.navigateToActivities as () => void)
      : () => {};

  const hasStepSequenceContext = Boolean(context);
  const isStepSequenceRuntime = hasStepSequenceContext && !isEditMode;

  const sanitizedConfig = useMemo(
    () => sanitizeExplorateurIAConfig(config),
    [config]
  );

  const experienceModeMeta = useMemo(
    () => EXPERIENCE_MODE_DEFINITIONS[sanitizedConfig.experienceMode],
    [sanitizedConfig.experienceMode]
  );
  const isOpenWorldExperience =
    sanitizedConfig.experienceMode === "open-world";

  const derivedQuarterData = useMemo(
    () => deriveQuarterData(sanitizedConfig.quarters),
    [sanitizedConfig.quarters]
  );

  useEffect(() => {
    currentUiExperienceMode = sanitizedConfig.experienceMode;
    applyDerivedQuarterData(derivedQuarterData);
  }, [derivedQuarterData, sanitizedConfig.experienceMode]);

  const { status: adminStatus, user: adminUser, setEditMode } = useAdminAuth();
  const isMobile = useIsMobile();
  const tileSize = useResponsiveTileSize("cover", {
    maxSize: isMobile ? BASE_TILE_SIZE : DESKTOP_TILE_MAX_SIZE,
  });
  const cellSize = tileSize + TILE_GAP;
  const [isTerrainModalOpen, setTerrainModalOpen] = useState(false);
  const [player, setPlayer] = useState(START);
  const [open, setOpen] = useState<QuarterId | null>(null);
  const [mobilePrompt, setMobilePrompt] = useState<QuarterId | null>(null);
  const [progress, setProgress] = useState<ExplorateurProgress>(
    () => createInitialProgress()
  );
  const [quarterSteps, setQuarterSteps] = useState<QuarterSteps>(() =>
    expandQuarterSteps(
      sanitizedConfig.steps,
      WORLD1_QUARTER_STEPS,
      derivedQuarterData.quarterOrder
    )
  );
  useEffect(() => {
    setQuarterSteps(
      expandQuarterSteps(
        sanitizedConfig.steps,
        WORLD1_QUARTER_STEPS,
        derivedQuarterData.quarterOrder
      )
    );
  }, [derivedQuarterData, sanitizedConfig.steps]);
  const [celebrate, setCelebrate] = useState(false);
  const [isInventoryOpen, setInventoryOpen] = useState(false);
  const [tileset] = useTileset();
  const [worldVersion, forceWorldRefresh] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState<TerrainThemeId>(
    sanitizedConfig.terrain.themeId
  );
  useEffect(() => {
    if (sanitizedConfig.terrain.themeId !== selectedTheme) {
      setSelectedTheme(sanitizedConfig.terrain.themeId);
    }
  }, [sanitizedConfig.terrain.themeId, selectedTheme]);
  const [blockedStage, setBlockedStage] = useState<QuarterId | null>(null);
  const [walkStep, setWalkStep] = useState(0);
  const [isIntroPlaying, setIsIntroPlaying] = useState(true);
  const [hasIntroFinished, setHasIntroFinished] = useState(false);
  const [isMusicEnabled, setIsMusicEnabled] = useState(() =>
    getStoredMusicPreference()
  );
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [isMusicSupported, setIsMusicSupported] = useState(false);
  const worldContainerRef = useRef<HTMLDivElement | null>(null);
  const firstScrollRef = useRef(true);
  const audioRef = useRef<ChiptuneTheme | null>(null);
  const arrivalEffectRef = useRef<ArrivalEffect | null>(null);
  const autoWalkQueue = useRef<Coord[]>([]);
  const autoWalkTarget = useRef<Coord | null>(null);
  const lastMoveDirectionRef = useRef<Coord | null>(null);
  const [isAutoWalking, setIsAutoWalking] = useState(false);
  const cancelAutoWalk = useCallback(() => {
    autoWalkQueue.current = [];
    autoWalkTarget.current = null;
    setIsAutoWalking(false);
  }, []);
  const hasReachedAutoTarget = useCallback(() => {
    const target = autoWalkTarget.current;
    if (!target) {
      return false;
    }
    if (isOpenWorldExperience) {
      const distance =
        Math.abs(player.x - target[0]) + Math.abs(player.y - target[1]);
      return distance <= 1;
    }
    return player.x === target[0] && player.y === target[1];
  }, [isOpenWorldExperience, player.x, player.y]);

  const emitConfig = useCallback(
    (patch: Partial<ExplorateurIAConfig>) => {
      const nextQuarters = sanitizeQuarterConfigs(
        patch.quarters ?? sanitizedConfig.quarters,
        DEFAULT_EXPLORATEUR_QUARTERS
      );
      const derived = deriveQuarterData(nextQuarters);
      const expandedQuarterSteps = expandQuarterSteps(
        patch.steps ?? sanitizedConfig.steps,
        WORLD1_QUARTER_STEPS,
        derived.quarterOrder
      );
      const { designerSteps, quarterSteps } = sanitizeQuarterDesignerSteps(
        patch.quarterDesignerSteps ?? sanitizedConfig.quarterDesignerSteps,
        nextQuarters,
        expandedQuarterSteps
      );
      const nextExperienceMode = sanitizeExperienceMode(
        patch.experienceMode ?? sanitizedConfig.experienceMode
      );
      const next: ExplorateurIAConfig = {
        terrain: {
          themeId:
            patch.terrain?.themeId ?? sanitizedConfig.terrain.themeId,
          seed: patch.terrain?.seed ?? sanitizedConfig.terrain.seed,
        },
        steps: flattenQuarterSteps(quarterSteps, derived.quarterOrder),
        quarterDesignerSteps: cloneQuarterStepMap(designerSteps),
        quarters: nextQuarters,
        experienceMode: nextExperienceMode,
      };
      effectiveOnUpdateConfig(next);
    },
    [effectiveOnUpdateConfig, sanitizedConfig]
  );

  const emitQuarterConfig = useCallback(
    (quarters: ExplorateurIAQuarterConfig[]) => {
      emitConfig({ quarters });
    },
    [emitConfig]
  );

  const emitQuarterDesignerSteps = useCallback(
    (designerSteps: QuarterSteps) => {
      emitConfig({ quarterDesignerSteps: designerSteps });
    },
    [emitConfig]
  );

  const emitTerrainConfig = useCallback(
    (terrainPatch: Partial<ExplorateurIATerrainConfig>) => {
      emitConfig({
        terrain: {
          themeId:
            terrainPatch.themeId ?? sanitizedConfig.terrain.themeId,
          seed: terrainPatch.seed ?? sanitizedConfig.terrain.seed,
        },
      });
    },
    [emitConfig, sanitizedConfig.terrain.seed, sanitizedConfig.terrain.themeId]
  );

  const emitExperienceMode = useCallback(
    (mode: ExplorateurExperienceMode) => {
      emitConfig({ experienceMode: mode });
    },
    [emitConfig]
  );

  const isConfigDesignerView = isEditMode && activityContext == null;

  if (isConfigDesignerView) {
    return (
      <ExplorateurIAConfigDesigner
        config={sanitizedConfig}
        onUpdateQuarters={emitQuarterConfig}
        onUpdateQuarterDesignerSteps={emitQuarterDesignerSteps}
        onUpdateTerrain={emitTerrainConfig}
        onUpdateExperienceMode={emitExperienceMode}
        onReset={() => {
          const defaultQuarters = DEFAULT_EXPLORATEUR_QUARTERS.map((quarter) => ({
            ...quarter,
            inventory: quarter.inventory ? { ...quarter.inventory } : null,
          }));
          const derivedDefaults = deriveQuarterData(defaultQuarters);
          const defaultQuarterSteps = expandQuarterSteps(
            getDefaultExplorateurSteps(),
            WORLD1_QUARTER_STEPS,
            derivedDefaults.quarterOrder
          );
          emitConfig({
            quarters: defaultQuarters,
            quarterDesignerSteps:
              createDefaultQuarterDesignerStepMap(
                defaultQuarters,
                defaultQuarterSteps
              ),
            steps: flattenQuarterSteps(
              defaultQuarterSteps,
              derivedDefaults.quarterOrder
            ),
            terrain: {
              themeId: DEFAULT_TERRAIN_THEME_ID,
              seed: WORLD_SEED,
            },
            experienceMode: DEFAULT_EXPERIENCE_MODE,
          });
        }}
      />
    );
  }

  useEffect(() => {
    if (
      sanitizedConfig.terrain.seed === currentWorldSeed &&
      sanitizedConfig.experienceMode === currentWorldMode
    ) {
      return;
    }
    const { start } = regenerateWorldInPlace(
      sanitizedConfig.terrain.seed,
      sanitizedConfig.experienceMode
    );
    setPlayer({ x: start.x, y: start.y });
    forceWorldRefresh((value) => value + 1);
  }, [
    forceWorldRefresh,
    sanitizedConfig.experienceMode,
    sanitizedConfig.terrain.seed,
  ]);

  useEffect(() => {
    const theme = TERRAIN_THEMES[selectedTheme];
    if (!theme) {
      return;
    }
    applyTerrainThemeToWorld(world, theme);
    repopulateTerrainObjects(world, currentWorldSeed, selectedTheme);
    recomputeWorldMetadata(world);
    forceWorldRefresh((value) => value + 1);
  }, [forceWorldRefresh, selectedTheme]);

  const canToggleEditMode = useMemo(() => {
    if (adminStatus !== "authenticated") {
      return false;
    }
    const roles = (adminUser?.roles ?? []).map((role) =>
      role.toLowerCase().trim()
    );
    return roles.some((role) => ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number]));
  }, [adminStatus, adminUser?.roles]);

  const handleToggleEditMode = useCallback(() => {
    if (!canToggleEditMode) {
      return;
    }
    setEditMode(!isEditMode);
  }, [canToggleEditMode, isEditMode, setEditMode]);

  const handleOpenTerrainModal = useCallback(() => {
    if (!isEditMode) {
      return;
    }
    setTerrainModalOpen(true);
  }, [isEditMode]);

  const handleCloseTerrainModal = useCallback(() => {
    setTerrainModalOpen(false);
  }, []);

  useEffect(() => {
    if (!isEditMode) {
      setTerrainModalOpen(false);
    }
  }, [isEditMode]);

  useEffect(() => {
    const effect = createArrivalEffect();
    arrivalEffectRef.current = effect;
    return () => {
      effect.dispose();
      arrivalEffectRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isIntroPlaying || hasIntroFinished) {
      return;
    }
    const effect = arrivalEffectRef.current;
    if (effect) {
      void effect.play();
    }
    if (typeof window === "undefined") {
      setHasIntroFinished(true);
      setIsIntroPlaying(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      setHasIntroFinished(true);
      setIsIntroPlaying(false);
    }, ARRIVAL_TOTAL_DURATION_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [hasIntroFinished, isIntroPlaying]);

  const isQuarterCompleted = useCallback(
    (id: QuarterId) => {
      switch (id) {
        case "clarte":
          return progress.clarte.done;
        case "creation":
          return progress.creation.done;
        case "decision":
          return progress.decision.done;
        case "ethique":
          return progress.ethique.done;
        case "mairie":
          return progress.mairie.done;
        default:
          return Boolean(progress.extras[id]?.done);
      }
    },
    [progress]
  );

  const hasCollectedAllInventoryItems = useMemo(
    () =>
      INVENTORY_ITEMS.every((item) => isQuarterCompleted(item.stage)),
    [derivedQuarterData, isQuarterCompleted]
  );

  const activeGateKeys = useMemo(() => {
    const active = new Set<CoordKey>();
    for (const gate of PATH_GATES) {
      if (!isQuarterCompleted(gate.stage)) {
        active.add(coordKey(gate.x, gate.y));
      }
    }
    return active;
  }, [derivedQuarterData, isQuarterCompleted, worldVersion]);

  const inventoryEntries = useMemo<InventoryEntry[]>(
    () =>
      INVENTORY_ITEMS.map((item) => ({
        ...item,
        obtained: isQuarterCompleted(item.stage),
      })),
    [derivedQuarterData, isQuarterCompleted]
  );
  const inventoryCollected = inventoryEntries.reduce(
    (total, item) => total + (item.obtained ? 1 : 0),
    0
  );
  const inventoryTotal = inventoryEntries.length;
  const inventoryProgressLabel = `${inventoryCollected}/${inventoryTotal}`;

  const handleStepConfigChange = useCallback(
    (stepId: string, config: unknown) => {
      setQuarterSteps((previous) => {
        const quarter = getQuarterFromStepId(stepId);
        if (!quarter) {
          return previous;
        }
        const currentSteps = previous[quarter] ?? [];
        const nextSteps = currentSteps.map((step) =>
          step.id === stepId ? { ...step, config } : step
        );
        const next: QuarterSteps = { ...previous, [quarter]: nextSteps };
        emitConfig({
          steps: flattenQuarterSteps(next, derivedQuarterData.quarterOrder),
        });
        return next;
      });
    },
    [derivedQuarterData, emitConfig]
  );

  const handleThemeChange = useCallback(
    (themeId: TerrainThemeId) => {
      if (!isEditMode) {
        return;
      }
      if (themeId === selectedTheme) {
        return;
      }
      const theme = TERRAIN_THEMES[themeId];
      if (!theme) {
        return;
      }
      setSelectedTheme(themeId);
      emitConfig({
        terrain: { themeId },
      });
    },
    [emitConfig, isEditMode, selectedTheme]
  );

  const handleRegenerateWorld = useCallback(() => {
    if (!isEditMode) {
      return;
    }
    const { seed, start } = regenerateWorldInPlace();
    const theme = TERRAIN_THEMES[selectedTheme];
    if (theme) {
      applyTerrainThemeToWorld(world, theme);
      repopulateTerrainObjects(world, seed, selectedTheme);
    } else {
      repopulateTerrainObjects(world, seed);
    }
    recomputeWorldMetadata(world);
    setPlayer({ x: start.x, y: start.y });
    forceWorldRefresh((value) => value + 1);
    emitConfig({ terrain: { seed } });
  }, [emitConfig, forceWorldRefresh, isEditMode, selectedTheme, setPlayer]);

  const attemptPlayMusic = useCallback(() => {
    if (!isMusicEnabled || isMusicPlaying) {
      return;
    }
    const theme = audioRef.current;
    if (!theme || !theme.isSupported) {
      return;
    }
    void theme
      .start()
      .then(() => setIsMusicPlaying(true))
      .catch(() => {
        setIsMusicPlaying(false);
        // Autoplay peut être bloqué : l'utilisateur pourra utiliser le bouton.
      });
  }, [isMusicEnabled, isMusicPlaying]);

  const toggleMusic = () => {
    if (!isMusicSupported) {
      return;
    }
    setIsMusicEnabled((value) => !value);
  };

  const move = useCallback(
    (dx: number, dy: number): boolean => {
      if (isIntroPlaying) {
        return false;
      }
      let moved = false;
      setPlayer((current) => {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const gate = GATE_BY_COORD.get(coordKey(nx, ny));
        if (gate && !isQuarterCompleted(gate.stage)) {
          setBlockedStage(gate.stage);
          return current;
        }
        if (!isWalkable(nx, ny, current.x, current.y)) {
          return current;
        }
        if (isMusicEnabled) {
          attemptPlayMusic();
        }
        setWalkStep((step) => step + 1);
        lastMoveDirectionRef.current = [dx, dy];
        moved = true;
        return { x: nx, y: ny };
      });
      return moved;
    },
    [
      attemptPlayMusic,
      isIntroPlaying,
      isMusicEnabled,
      isQuarterCompleted,
    ]
  );

  type BuildingCandidate = {
    building: (typeof buildings)[number];
    distance: number;
    direction: Coord | null;
  };

  const buildingAt = useCallback(
    (x: number, y: number) => {
      const candidates: BuildingCandidate[] = [];
      for (const building of buildings) {
        const distance = Math.abs(building.x - x) + Math.abs(building.y - y);
        if (distance === 0) {
          candidates.push({ building, distance, direction: null });
          continue;
        }
        if (distance === 1 && isOpenWorldExperience) {
          candidates.push({
            building,
            distance,
            direction: [building.x - x, building.y - y],
          });
        }
      }

      if (candidates.length === 0) {
        return null;
      }

      const interactable = candidates.filter(({ building }) => {
        if (isQuarterCompleted(building.id)) {
          return false;
        }
        if (building.id === "mairie" && !hasCollectedAllInventoryItems) {
          return false;
        }
        return true;
      });

      if (interactable.length === 0) {
        return null;
      }

      const direct = interactable.find((candidate) => candidate.distance === 0);
      if (direct) {
        return direct.building;
      }

      if (isOpenWorldExperience) {
        const lastDirection = lastMoveDirectionRef.current;
        if (lastDirection) {
          const facing = interactable.find((candidate) => {
            if (!candidate.direction) {
              return false;
            }
            return (
              candidate.direction[0] === lastDirection[0] &&
              candidate.direction[1] === lastDirection[1]
            );
          });
          if (facing) {
            return facing.building;
          }
        }
      }

      const best = interactable.reduce<BuildingCandidate | null>(
        (currentBest, candidate) => {
          if (!currentBest) {
            return candidate;
          }
          if (candidate.distance < currentBest.distance) {
            return candidate;
          }
          if (candidate.distance > currentBest.distance) {
            return currentBest;
          }
          const currentBestIndex = BUILDING_DISPLAY_ORDER.indexOf(
            currentBest.building.id
          );
          const candidateIndex = BUILDING_DISPLAY_ORDER.indexOf(
            candidate.building.id
          );
          if (candidateIndex === -1) {
            return currentBest;
          }
          if (currentBestIndex === -1 || candidateIndex < currentBestIndex) {
            return candidate;
          }
          return currentBest;
        },
        null
      );

      return best?.building ?? null;
    },
    [
      hasCollectedAllInventoryItems,
      isOpenWorldExperience,
      isQuarterCompleted,
    ]
  );

  const openIfOnBuilding = useCallback(() => {
    const hit = buildingAt(player.x, player.y);
    if (!hit) {
      if (!hasCollectedAllInventoryItems) {
        const nearMairie = buildings.some((building) => {
          if (building.id !== "mairie") {
            return false;
          }
          const distance =
            Math.abs(building.x - player.x) + Math.abs(building.y - player.y);
          if (distance === 0) {
            return true;
          }
          return isOpenWorldExperience && distance === 1;
        });
        if (nearMairie) {
          setBlockedStage("mairie");
        }
      }
      setMobilePrompt(null);
      return;
    }
    setBlockedStage(null);
    if (isMobile && !isEditMode) {
      setMobilePrompt(hit.id);
      return;
    }
    setOpen(hit.id);
  }, [
    buildingAt,
    hasCollectedAllInventoryItems,
    isEditMode,
    isMobile,
    isOpenWorldExperience,
    player.x,
    player.y,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const theme = createChiptuneTheme();
    audioRef.current = theme;
    setIsMusicSupported(theme.isSupported);
    return () => {
      theme.dispose();
      audioRef.current = null;
      setIsMusicSupported(false);
      setIsMusicPlaying(false);
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const key = event.key.toLowerCase();
      const target = event.target as EventTarget | null;
      const typingTarget = isTextualInputTarget(target);
      const overlayOpen = open !== null || isTerrainModalOpen || isInventoryOpen;

      if (
        [
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
          "w",
          "a",
          "s",
          "d",
        ].includes(key)
      ) {
        if (
          typingTarget ||
          overlayOpen ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) {
          return;
        }
        const delta:
          | [number, number]
          | null = key === "arrowup" || key === "w"
          ? [0, -1]
          : key === "arrowdown" || key === "s"
          ? [0, 1]
          : key === "arrowleft" || key === "a"
          ? [-1, 0]
          : key === "arrowright" || key === "d"
          ? [1, 0]
          : null;
        if (delta) {
          event.preventDefault();
          if (isIntroPlaying) {
            return;
          }
          move(delta[0], delta[1]);
        }
        return;
      }

      if (key === "enter" || key === "e") {
        if (typingTarget || overlayOpen) {
          return;
        }
        if (isIntroPlaying) {
          event.preventDefault();
          return;
        }
        const hit = buildingAt(player.x, player.y);
        if (hit) {
          event.preventDefault();
          setOpen(hit.id);
        }
        return;
      }

      if (key === "escape") {
        if (typingTarget) {
          return;
        }
        if (open !== null) {
          event.preventDefault();
          setOpen(null);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    buildingAt,
    isIntroPlaying,
    isInventoryOpen,
    isTerrainModalOpen,
    move,
    open,
    player.x,
    player.y,
  ]);

  useEffect(() => {
    const container = worldContainerRef.current;
    if (!container) {
      return;
    }
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const targetLeft = clamp(
      player.x * cellSize - container.clientWidth / 2 + tileSize / 2,
      0,
      maxLeft
    );
    const targetTop = clamp(
      player.y * cellSize - container.clientHeight / 2 + tileSize / 2,
      0,
      maxTop
    );
    container.scrollTo({
      left: targetLeft,
      top: targetTop,
      behavior: firstScrollRef.current ? "auto" : "smooth",
    });
    if (firstScrollRef.current) {
      firstScrollRef.current = false;
    }
  }, [player.x, player.y, cellSize, tileSize]);

  const allQuartersCompleted = useMemo(
    () =>
      derivedQuarterData.quarterOrder.every((quarter) =>
        isQuarterCompleted(quarter)
      ),
    [derivedQuarterData.quarterOrder, isQuarterCompleted]
  );

  const sequenceCompletionPayload = useMemo(
    () =>
      createExplorateurExport(progress, {
        quarterOrder: derivedQuarterData.quarterOrder,
      }),
    [derivedQuarterData.quarterOrder, progress]
  );

  const handleAdvanceToDebrief = useCallback(() => {
    if (!isStepSequenceRuntime || !allQuartersCompleted) {
      return;
    }
    safeOnAdvance({
      type: "explorateur-completion",
      exportData: sequenceCompletionPayload,
    });
  }, [
    allQuartersCompleted,
    isStepSequenceRuntime,
    safeOnAdvance,
    sequenceCompletionPayload,
  ]);

  const showSequenceCompletionCta = isStepSequenceRuntime && allQuartersCompleted;

  useEffect(() => {
    if (blockedStage && isQuarterCompleted(blockedStage)) {
      setBlockedStage(null);
    }
  }, [blockedStage, isQuarterCompleted]);

  useEffect(() => {
    if (!blockedStage) {
      return;
    }
    const timeout = window.setTimeout(() => setBlockedStage(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [blockedStage]);

  useEffect(() => {
    persistMusicPreference(isMusicEnabled);
  }, [isMusicEnabled]);

  useEffect(() => {
    if (!isMusicSupported) {
      return;
    }
    const theme = audioRef.current;
    if (!theme || !theme.isSupported) {
      return;
    }
    if (isMusicEnabled) {
      if (!isMusicPlaying) {
        attemptPlayMusic();
      }
    } else if (isMusicPlaying) {
      void theme.stop().finally(() => {
        setIsMusicPlaying(false);
      });
    }
  }, [attemptPlayMusic, isMusicEnabled, isMusicPlaying, isMusicSupported]);

  const findWalkPath = useCallback(
    (fromX: number, fromY: number, toX: number, toY: number): Coord[] => {
      const startKey = coordKey(fromX, fromY);
      const goalKey = coordKey(toX, toY);
      const directions: Coord[] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];

      const attempt = (targetKey: CoordKey): Coord[] => {
        const visited = new Set<CoordKey>([startKey]);
        const previous = new Map<CoordKey, CoordKey | null>();
        previous.set(startKey, null);
        const queue: CoordKey[] = [startKey];

        while (queue.length > 0) {
          const currentKey = queue.shift()!;
          if (currentKey === targetKey) {
            const pathKeys = reconstructPath(previous, targetKey);
            return pathKeys.map((key) => coordFromKey(key));
          }
          const [cx, cy] = coordFromKey(currentKey);
          for (const [dx, dy] of directions) {
            const nx = cx + dx;
            const ny = cy + dy;
            const neighborKey = coordKey(nx, ny);
            if (visited.has(neighborKey)) {
              continue;
            }
            if (!isWalkable(nx, ny, cx, cy)) {
              continue;
            }
            const gate = GATE_BY_COORD.get(neighborKey);
            if (gate && !isQuarterCompleted(gate.stage)) {
              continue;
            }
            visited.add(neighborKey);
            previous.set(neighborKey, currentKey);
            queue.push(neighborKey);
          }
        }

        return [];
      };

      const directPath = attempt(goalKey);
      if (directPath.length > 0) {
        return directPath;
      }

      const fallbackTargets: CoordKey[] = [];
      for (const [dx, dy] of directions) {
        const nx = toX + dx;
        const ny = toY + dy;
        const neighborKey = coordKey(nx, ny);
        if (!isWalkable(nx, ny)) {
          continue;
        }
        const gate = GATE_BY_COORD.get(neighborKey);
        if (gate && !isQuarterCompleted(gate.stage)) {
          continue;
        }
        fallbackTargets.push(neighborKey);
      }

      let best: Coord[] = [];
      for (const fallbackKey of fallbackTargets) {
        const candidate = attempt(fallbackKey);
        if (candidate.length > 0 && (best.length === 0 || candidate.length < best.length)) {
          best = candidate;
        }
      }

      return best;
    },
    [isQuarterCompleted]
  );

  const handleTilePress = useCallback(
    (targetX: number, targetY: number) => {
      if (!isMobile || isIntroPlaying) {
        return;
      }
      if (targetX === player.x && targetY === player.y) {
        cancelAutoWalk();
        openIfOnBuilding();
        return;
      }

      const path = findWalkPath(player.x, player.y, targetX, targetY);
      if (path.length <= 1) {
        const dx = targetX - player.x;
        const dy = targetY - player.y;
        if (Math.abs(dx) + Math.abs(dy) === 1) {
          cancelAutoWalk();
          const didMove = move(dx, dy);
          if (!didMove && isOpenWorldExperience) {
            openIfOnBuilding();
          }
        }
        return;
      }

      autoWalkQueue.current = path.slice(1);
      autoWalkTarget.current = buildingAt(targetX, targetY)
        ? ([targetX, targetY] as Coord)
        : null;
      setIsAutoWalking(true);
    },
    [
      cancelAutoWalk,
      findWalkPath,
      buildingAt,
      isIntroPlaying,
      isMobile,
      move,
      openIfOnBuilding,
      player.x,
      player.y,
    ]
  );

  useEffect(() => {
    if (isIntroPlaying) {
      if (isAutoWalking) {
        cancelAutoWalk();
      }
      return;
    }

    if (!isMobile) {
      if (isAutoWalking) {
        cancelAutoWalk();
      }
      return;
    }

    if (!isAutoWalking) {
      if (hasReachedAutoTarget()) {
        openIfOnBuilding();
        autoWalkTarget.current = null;
      }
      return;
    }

    if (autoWalkQueue.current.length === 0) {
      setIsAutoWalking(false);
      if (hasReachedAutoTarget()) {
        openIfOnBuilding();
      }
      autoWalkTarget.current = null;
      return;
    }

    const timer = window.setTimeout(() => {
      const next = autoWalkQueue.current.shift();
      if (!next) {
        setIsAutoWalking(false);
        return;
      }
      const [nextX, nextY] = next;
      const dx = nextX - player.x;
      const dy = nextY - player.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) {
        cancelAutoWalk();
        return;
      }
      const didMove = move(dx, dy);
      if (!didMove) {
        cancelAutoWalk();
      }
    }, 160);

    return () => window.clearTimeout(timer);
  }, [
    cancelAutoWalk,
    isIntroPlaying,
    isAutoWalking,
    isMobile,
    hasReachedAutoTarget,
    move,
    openIfOnBuilding,
    player.x,
    player.y,
  ]);

  const complete = useCallback(
    (id: QuarterId, payloads: QuarterPayloadMap | undefined) => {
      setProgress((previous) => {
        const visited = previous.visited.includes(id)
          ? previous.visited
          : [...previous.visited, id];
        const next: ExplorateurProgress = {
          ...previous,
          visited,
          clarte:
            id === "clarte"
              ? updateClarteProgress(previous.clarte, payloads)
              : previous.clarte,
          creation:
            id === "creation"
              ? updateCreationProgress(previous.creation, payloads)
              : previous.creation,
          decision:
            id === "decision"
              ? updateDecisionProgress(previous.decision, payloads)
              : previous.decision,
          ethique:
            id === "ethique"
              ? updateEthicsProgress(previous.ethique, payloads)
              : previous.ethique,
          mairie:
            id === "mairie"
              ? updateMairieProgress(previous.mairie, payloads)
              : previous.mairie,
          extras: previous.extras,
        } satisfies ExplorateurProgress;

        if (!KNOWN_QUARTER_IDS.has(id)) {
          next.extras = {
            ...previous.extras,
            [id]: updateGenericQuarterProgress(previous.extras[id], payloads),
          };
        }

        return next;
      });
      setOpen(null);
      setBlockedStage(null);
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 1800);
    },
    []
  );

  const downloadJSON = () => {
    const data = createExplorateurExport(progress, {
      quarterOrder: derivedQuarterData.quarterOrder,
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `explorateur_ia_${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const renderQuarterStep = useCallback(
    ({
      step,
      stepIndex,
      stepCount,
      StepComponent,
      componentProps,
      context,
      advance,
    }: StepSequenceRenderWrapperProps) => {
      if (!open) {
        return null;
      }
      const quarter = getQuarterFromStepId(step.id) ?? open;
      const meta = BUILDING_META[quarter];
      const handleClose = () => setOpen(null);
      const handlePrevious = () => context.goToStep(stepIndex - 1);
      const handleNext = () => advance();
      const canGoBack = stepIndex > 0;
      const isLastStep = stepIndex === stepCount - 1;
      const canAdvanceManually =
        MANUAL_ADVANCE_COMPONENTS.has(step.component) || isEditMode;
      const indicatorLabel = `Étape ${stepIndex + 1} sur ${stepCount}`;
      const progressPercent = Math.round(((stepIndex + 1) / stepCount) * 100);
      const continueLabel = isLastStep ? "Terminer" : "Continuer";

      let stepTitle: string | null = null;
      const rawConfig = componentProps.config;
      if (rawConfig && typeof rawConfig === "object") {
        const maybeTitle = (rawConfig as { title?: unknown }).title;
        if (typeof maybeTitle === "string" && maybeTitle.trim().length > 0) {
          stepTitle = maybeTitle;
        }
      }

      return (
        <Modal open onClose={handleClose} title={meta?.label ?? "Quartier"}>
          <div className="space-y-6">
            <header className="space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>{meta?.label ?? "Quartier"}</span>
                <span>{indicatorLabel}</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {stepTitle ? (
                <h2 className="text-xl font-semibold text-slate-900">
                  {stepTitle}
                </h2>
              ) : null}
              {isEditMode ? (
                <nav className="flex flex-wrap gap-2 text-xs">
                  {context.steps.map((definition, index) => (
                    <button
                      key={definition.id}
                      type="button"
                      onClick={() => context.goToStep(index)}
                      className={classNames(
                        "rounded-full px-3 py-1 font-medium transition",
                        index === stepIndex
                          ? "bg-emerald-500 text-white"
                          : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                      )}
                    >
                      Étape {index + 1}
                    </button>
                  ))}
                </nav>
              ) : null}
            </header>
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm sm:p-6">
                <StepComponent {...componentProps} />
              </div>
              {quarter === "mairie" ? (
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm sm:p-6">
                  <BadgeView progress={progress} onDownloadJSON={downloadJSON} />
                </div>
              ) : null}
            </div>
            <footer className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevious}
                  disabled={!canGoBack}
                  className={classNames(
                    "rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition",
                    canGoBack
                      ? "bg-white hover:border-emerald-400 hover:text-emerald-600"
                      : "cursor-not-allowed opacity-50"
                  )}
                >
                  Étape précédente
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-400 hover:text-emerald-600"
                >
                  Fermer
                </button>
              </div>
              <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center">
                {!canAdvanceManually && !isEditMode ? (
                  <p className="text-xs text-slate-500">
                    Complétez l'étape pour continuer.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!canAdvanceManually}
                  className={classNames(
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    canAdvanceManually
                      ? "bg-emerald-500 text-white hover:bg-emerald-600"
                      : "cursor-not-allowed bg-slate-200 text-slate-500"
                  )}
                >
                  {continueLabel}
                </button>
              </div>
            </footer>
          </div>
        </Modal>
      );
    },
    [downloadJSON, isEditMode, open, progress]
  );

  const at = useMemo(
    () => buildingAt(player.x, player.y),
    [buildingAt, player.x, player.y]
  );

  const showMobileControls = !isEditMode && !open;

  const mobilePromptBuilding = useMemo(() => {
    if (!mobilePrompt) {
      return null;
    }
    return buildings.find((entry) => entry.id === mobilePrompt) ?? null;
  }, [mobilePrompt]);

  const mobilePromptLocked = useMemo(() => {
    if (!mobilePromptBuilding) {
      return false;
    }
    if (isQuarterCompleted(mobilePromptBuilding.id)) {
      return true;
    }
    if (
      mobilePromptBuilding.id === "mairie" &&
      !hasCollectedAllInventoryItems
    ) {
      return true;
    }
    const key = coordKey(mobilePromptBuilding.x, mobilePromptBuilding.y);
    return activeGateKeys.has(key);
  }, [
    activeGateKeys,
    hasCollectedAllInventoryItems,
    isQuarterCompleted,
    mobilePromptBuilding,
  ]);

  const handleMobileEnter = useCallback(() => {
    if (!mobilePromptBuilding || mobilePromptLocked || isIntroPlaying) {
      return;
    }
    setMobilePrompt(null);
    setOpen(mobilePromptBuilding.id);
  }, [isIntroPlaying, mobilePromptBuilding, mobilePromptLocked]);

  const handleOverlayMove = useCallback(
    (dx: number, dy: number) => {
      if (isIntroPlaying) {
        return;
      }
      cancelAutoWalk();
      move(dx, dy);
    },
    [cancelAutoWalk, isIntroPlaying, move]
  );

  const handleOpenInventory = useCallback(() => {
    setOpen(null);
    setInventoryOpen(true);
  }, []);

  const handleCloseInventory = useCallback(() => {
    setInventoryOpen(false);
  }, []);

  useEffect(() => {
    if (isEditMode) {
      setMobilePrompt(null);
      return;
    }
    if (open || isAutoWalking) {
      setMobilePrompt(null);
      return;
    }
    if (at) {
      setMobilePrompt(at.id);
    } else {
      setMobilePrompt(null);
    }
  }, [at, isAutoWalking, isEditMode, open]);

  return (
    <div
      className={classNames(
        "relative flex h-full min-h-[100dvh] w-full flex-1 flex-col overflow-hidden",
        !isMobile && "gap-6"
      )}
    >
      <Fireworks show={celebrate} />
      {showSequenceCompletionCta ? (
        <div className="pointer-events-none absolute bottom-4 right-4 z-40 flex max-w-xs justify-end sm:bottom-6 sm:right-6">
          <div className="pointer-events-auto rounded-2xl border border-orange-200/80 bg-white/95 p-4 shadow-xl backdrop-blur">
            <p className="text-sm font-semibold text-slate-800">
              Parcours complété !
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Consulte le bilan et valide l’activité.
            </p>
            <button
              type="button"
              onClick={handleAdvanceToDebrief}
              className="mt-3 inline-flex items-center justify-center rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
            >
              Voir le bilan final
            </button>
          </div>
        </div>
      ) : null}
      <div className="grid min-h-0 w-full flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-0">
        <div className="relative flex min-h-0 flex-1 flex-col">
          {!isMobile && (
            <div className="absolute right-3 top-3 flex items-center gap-2 rounded-full border bg-slate-100/80 px-2 py-1 text-[11px] text-slate-600 shadow-sm">
              <span className="tracking-wide uppercase">Tiny Town</span>
            </div>
          )}
          <div className="relative w-full flex-1 min-h-0">
            <div
              className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex flex-wrap items-start justify-between gap-3"
            >
              <div className="pointer-events-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={navigateToActivities}
                  className={classNames(
                    "flex items-center gap-2 rounded-full border bg-white/90 px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur",
                    isMobile ? "active:scale-95" : "hover:bg-slate-100"
                  )}
                  title="Retour aux activités"
                >
                  <span aria-hidden="true">←</span>
                  <span className="sr-only">Revenir à la liste des activités</span>
                </button>
                {isEditMode && (
                  <button
                    type="button"
                    onClick={handleOpenTerrainModal}
                    className={classNames(
                      "flex items-center gap-2 rounded-full border bg-white/90 px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur",
                      isMobile ? "active:scale-95" : "hover:bg-slate-100"
                    )}
                  >
                    <span aria-hidden="true">🗺️</span>
                    <span>Terrain</span>
                  </button>
                )}
              </div>
              <div className="pointer-events-auto flex flex-col items-end gap-2">
                <button
                  type="button"
                  onClick={handleOpenInventory}
                  className={classNames(
                    "flex items-center gap-2 rounded-full border bg-white/90 px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur",
                    isMobile ? "active:scale-95" : "hover:bg-slate-100"
                  )}
                  title="Ouvrir l’inventaire"
                  aria-label={`Ouvrir l’inventaire (${inventoryProgressLabel} objets collectés)`}
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    🎒
                  </span>
                  <span className="flex items-baseline gap-1">
                    <span>Inventaire</span>
                    <span className="text-xs font-semibold text-emerald-600">
                      {inventoryProgressLabel}
                    </span>
                  </span>
                </button>
                {isMusicSupported && (
                  <button
                    type="button"
                    onClick={toggleMusic}
                    className={classNames(
                      "mt-1 flex items-center justify-center rounded-full border bg-white/90 p-2 text-base font-semibold text-slate-700 shadow-sm backdrop-blur",
                      isMobile ? "active:scale-95" : "hover:bg-slate-100"
                    )}
                    aria-pressed={isMusicEnabled}
                    title={
                      isMusicEnabled ? "Couper la musique" : "Activer la musique"
                    }
                  >
                    <span className="sr-only">
                      {isMusicEnabled ? "Couper la musique" : "Activer la musique"}
                    </span>
                    <span aria-hidden="true">{isMusicEnabled ? "🔊" : "🔇"}</span>
                  </button>
                )}
              </div>
            </div>
            <div
              ref={worldContainerRef}
              className="relative flex h-full w-full flex-1 min-h-0 overflow-auto overscroll-contain scroll-smooth touch-manipulation"
            >
              <div
                className={classNames(
                  "grid min-w-max",
                  isMobile && "h-full w-full"
                )}
                style={{
                  gridTemplateColumns: `repeat(${GRID_W}, ${tileSize}px)`,
                  gridTemplateRows: `repeat(${GRID_H}, ${tileSize}px)`,
                  gap: TILE_GAP,
                }}
              >
                {world.map((row, y) =>
                  row.map((terrain, x) => {
                    const activeTileset =
                      tileset.mode === "atlas" && tileset.url ? tileset : DEFAULT_ATLAS;
                    const markerCoord = MARKER_COORD_BY_KEY.get(`${x}-${y}`);
                    const highlight = HIGHLIGHT_TILES.has(terrain.base);
                    const tileKey = coordKey(x, y);
                    const gate = GATE_BY_COORD.get(tileKey);
                    const gateActive = gate ? !isQuarterCompleted(gate.stage) : false;
                    const tileBlocked = activeGateKeys.has(tileKey);

                    return (
                      <div
                        key={`${x}-${y}`}
                        className="relative"
                        onClick={() => handleTilePress(x, y)}
                      >
                        <TileWithTs
                          terrain={terrain}
                          ts={tileset}
                          x={x}
                          y={y}
                          tileSize={tileSize}
                        />
                        {markerCoord && (
                          <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
                            <SpriteFromAtlas
                              ts={activeTileset}
                              coord={markerCoord}
                              scale={tileSize}
                            />
                          </div>
                        )}
                        {highlight && (
                          <div className="absolute inset-0 rounded bg-amber-200/30" />
                        )}
                        {gateActive && (
                          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                            <SpriteFromAtlas
                              ts={DEFAULT_ATLAS}
                              coord={GATE_MARKER_COORD}
                              scale={tileSize}
                            />
                          </div>
                        )}
                        {buildings.map((building) => {
                          if (building.x !== x || building.y !== y) {
                            return null;
                          }
                          const highlightTile =
                            showMobileControls &&
                            !tileBlocked &&
                            mobilePromptBuilding?.id === building.id &&
                            !mobilePromptLocked;
                          return (
                            <div key={building.id} className="absolute inset-0 z-10">
                              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                <BuildingSprite
                                  quarter={building.id}
                                  ts={tileset}
                                  tileSize={tileSize}
                                />
                              </div>
                              {highlightTile && (
                                <div
                                  className="pointer-events-none absolute z-20 rounded-lg border-2 border-emerald-300/80 animate-pulse"
                                  style={{
                                    inset: `${Math.max(tileSize * 0.1, 2)}px`,
                                    boxShadow: "0 0 12px rgba(16, 185, 129, 0.45)",
                                  }}
                                />
                              )}
                              {!isMobile && (
                                <button
                                  onClick={(event) => {
                                    if (isEditMode) {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      return;
                                    }
                                    setOpen(building.id);
                                  }}
                                  disabled={tileBlocked}
                                  className={classNames(
                                    "absolute inset-0 flex items-center justify-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70",
                                    tileBlocked && "cursor-not-allowed opacity-70"
                                  )}
                                  title={building.label}
                                >
                                  <span className="sr-only">{building.label}</span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {player.x === x && player.y === y && (
                          <>
                            {isIntroPlaying ? <IntroArrival tileSize={tileSize} /> : null}
                            {hasIntroFinished && (
                              <div className="pointer-events-none absolute inset-1 z-30 animate-[float_1.2s_ease-in-out_infinite]">
                                <div
                                  className="will-change-transform"
                                  style={{
                                    animation:
                                      "alien-arrival-player 480ms cubic-bezier(0.22, 0.92, 0.3, 1.05) both",
                                  }}
                                >
                                  <PlayerSprite
                                    ts={tileset}
                                    step={walkStep}
                                    tileSize={tileSize}
                                  />
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            {showMobileControls && (
              <MobileControlsOverlay
                building={mobilePromptLocked ? null : mobilePromptBuilding}
                onEnter={handleMobileEnter}
                onMove={handleOverlayMove}
                showQuarterNumbers={!isOpenWorldExperience}
              />
            )}
          </div>
          <style>{`
            @keyframes float {
              0%,100% { transform: translateY(0); }
              50% { transform: translateY(-2px); }
            }
            @keyframes prompt-pop {
              0% { transform: translateY(18px) scale(0.92); opacity: 0; }
              60% { transform: translateY(-6px) scale(1.04); opacity: 1; }
              100% { transform: translateY(0) scale(1); opacity: 1; }
            }
            @keyframes alien-arrival-flight {
              0% {
                transform: translate3d(
                    calc(var(--alien-arrival-unit, 32px) * -18),
                    calc(var(--alien-arrival-unit, 32px) * -15),
                    0
                  )
                  scale(0.6)
                  rotate(-18deg);
                opacity: 0;
              }
              22% {
                transform: translate3d(
                    calc(var(--alien-arrival-unit, 32px) * -11.5),
                    calc(var(--alien-arrival-unit, 32px) * -11.5),
                    0
                  )
                  scale(0.72)
                  rotate(-11deg);
                opacity: 0.85;
              }
              46% {
                transform: translate3d(
                    calc(var(--alien-arrival-unit, 32px) * -7),
                    calc(var(--alien-arrival-unit, 32px) * -9.5),
                    0
                  )
                  scale(0.82)
                  rotate(-7deg);
                opacity: 1;
              }
              68% {
                transform: translate3d(
                    calc(var(--alien-arrival-unit, 32px) * 11),
                    calc(var(--alien-arrival-unit, 32px) * -5.5),
                    0
                  )
                  scale(1.1)
                  rotate(9deg);
                opacity: 1;
              }
              82% {
                transform: translate3d(
                    calc(var(--alien-arrival-unit, 32px) * 5.8),
                    calc(var(--alien-arrival-unit, 32px) * 4.6),
                    0
                  )
                  scale(1.02)
                  rotate(4deg);
                opacity: 1;
              }
              92% {
                transform: translate3d(
                    calc(var(--alien-arrival-unit, 32px) * -2.6),
                    calc(var(--alien-arrival-unit, 32px) * 2.1),
                    0
                  )
                  scale(0.94)
                  rotate(-4deg);
                opacity: 1;
              }
              100% {
                transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
                opacity: 0;
              }
            }
            @keyframes alien-arrival-glow {
              0% { opacity: 0; transform: scale(0.6); }
              55% { opacity: 0.9; transform: scale(1.1); }
              82% { opacity: 0.55; transform: scale(1.35); }
              100% { opacity: 0; transform: scale(1.5); }
            }
            @keyframes alien-arrival-player {
              0% { transform: translateY(12px) scale(0.75); opacity: 0; }
              60% { transform: translateY(-6px) scale(1.06); opacity: 1; }
              100% { transform: translateY(0) scale(1); opacity: 1; }
            }
          `}</style>
        </div>

      </div>

      <Modal
        open={isEditMode && isTerrainModalOpen}
        onClose={handleCloseTerrainModal}
        title="Configuration du terrain"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Ajustez le type de terrain pour modifier l'apparence de la carte ou
            régénérez sa forme.
          </p>
          <TerrainThemeOptions
            selectedTheme={selectedTheme}
            onSelectTheme={handleThemeChange}
            onRegenerate={handleRegenerateWorld}
          />
        </div>
      </Modal>

      <Modal
        open={isInventoryOpen}
        onClose={handleCloseInventory}
        title="Inventaire d’explorateur"
      >
        <InventoryView items={inventoryEntries} />
      </Modal>

      {open ? (
        <StepSequenceRenderer
          key={open}
          steps={quarterSteps[open] ?? []}
          isEditMode={isEditMode}
          onComplete={(payloads) => complete(open, payloads)}
          onStepConfigChange={handleStepConfigChange}
          renderStepWrapper={renderQuarterStep}
        />
      ) : null}
    </div>
  );
}

interface ConfigDesignerProps {
  config: ExplorateurIAConfig;
  onUpdateQuarters: (quarters: ExplorateurIAQuarterConfig[]) => void;
  onUpdateQuarterDesignerSteps: (steps: QuarterSteps) => void;
  onUpdateTerrain: (patch: Partial<ExplorateurIATerrainConfig>) => void;
  onUpdateExperienceMode: (mode: ExplorateurExperienceMode) => void;
  onReset: () => void;
}

function DesignerStepStateTracker({
  context,
  pendingStepId,
  onConsumed,
}: {
  context: StepSequenceRenderWrapperProps["context"];
  pendingStepId: string | null;
  onConsumed: () => void;
}) {
  useEffect(() => {
    if (!pendingStepId) {
      return;
    }
    const targetIndex = context.steps.findIndex(
      (definition) => definition.id === pendingStepId
    );
    if (targetIndex !== -1 && targetIndex !== context.stepIndex) {
      context.goToStep(targetIndex);
    }
    onConsumed();
  }, [context, onConsumed, pendingStepId]);
  return null;
}
type QuarterDesignerStepType = QuarterDesignerStepLibraryEntry["type"];

function ExplorateurIAConfigDesigner({
  config,
  onUpdateQuarters,
  onUpdateQuarterDesignerSteps,
  onUpdateTerrain,
  onUpdateExperienceMode,
  onReset,
}: ConfigDesignerProps) {
  const nonGoalQuarterCount = useMemo(
    () => config.quarters.filter((quarter) => !quarter.isGoal).length,
    [config.quarters]
  );

  const experienceModeMeta = useMemo(
    () => EXPERIENCE_MODE_DEFINITIONS[config.experienceMode],
    [config.experienceMode]
  );

  const [expandedQuarterIds, setExpandedQuarterIds] = useState<QuarterId[]>([]);
  const [pendingStepIdByQuarter, setPendingStepIdByQuarter] = useState<
    Partial<Record<QuarterId, string | null>>
  >({});

  const toggleQuarter = useCallback((quarterId: QuarterId) => {
    setExpandedQuarterIds((current) =>
      current.includes(quarterId)
        ? current.filter((id) => id !== quarterId)
        : [...current, quarterId]
    );
  }, []);

  const handleAddQuarter = useCallback(() => {
    const nextQuarter = createNewQuarterTemplate(config.quarters);
    const nextQuarters = config.quarters.map(cloneQuarter);
    const goalIndex = nextQuarters.findIndex((quarter) => quarter.isGoal);
    if (goalIndex === -1) {
      nextQuarters.push(nextQuarter);
    } else {
      nextQuarters.splice(goalIndex, 0, nextQuarter);
    }
    onUpdateQuarters(nextQuarters);

    const designerMap = cloneQuarterStepMap(config.quarterDesignerSteps);
    designerMap[nextQuarter.id] = createDefaultQuarterDesignerSteps(
      nextQuarter
    );
    const fallbackSteps = extractQuarterStepsFromDesignerMap(
      designerMap,
      nextQuarters
    );
    const { designerSteps } = sanitizeQuarterDesignerSteps(
      designerMap,
      nextQuarters,
      fallbackSteps
    );
    onUpdateQuarterDesignerSteps(designerSteps);
    setExpandedQuarterIds((current) =>
      current.includes(nextQuarter.id)
        ? current
        : [...current, nextQuarter.id]
    );
    const firstStep = designerSteps[nextQuarter.id]?.[0]?.id ?? null;
    setPendingStepIdByQuarter((current) => ({
      ...current,
      [nextQuarter.id]: firstStep,
    }));
  }, [
    config.quarterDesignerSteps,
    config.quarters,
    setExpandedQuarterIds,
    setPendingStepIdByQuarter,
    onUpdateQuarterDesignerSteps,
    onUpdateQuarters,
  ]);

  const handleMoveQuarter = useCallback(
    (index: number, direction: -1 | 1) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= config.quarters.length) {
        return;
      }
      const nextQuarters = config.quarters.map(cloneQuarter);
      const [moved] = nextQuarters.splice(index, 1);
      nextQuarters.splice(targetIndex, 0, moved);
      onUpdateQuarters(nextQuarters);
      const fallbackSteps = extractQuarterStepsFromDesignerMap(
        config.quarterDesignerSteps,
        nextQuarters
      );
      const { designerSteps } = sanitizeQuarterDesignerSteps(
        config.quarterDesignerSteps,
        nextQuarters,
        fallbackSteps
      );
      onUpdateQuarterDesignerSteps(designerSteps);
    },
    [
      config.quarterDesignerSteps,
      config.quarters,
      onUpdateQuarterDesignerSteps,
      onUpdateQuarters,
    ]
  );

  const handleThemeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onUpdateTerrain({ themeId: event.target.value as TerrainThemeId });
    },
    [onUpdateTerrain]
  );

  const handleSeedChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const numeric = Number.parseInt(event.target.value, 10);
      if (Number.isFinite(numeric)) {
        onUpdateTerrain({ seed: numeric });
      }
    },
    [onUpdateTerrain]
  );

  const handleExperienceModeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onUpdateExperienceMode(event.target.value as ExplorateurExperienceMode);
    },
    [onUpdateExperienceMode]
  );

  const handleDesignerStepConfigChange = useCallback(
    (quarterId: QuarterId, stepId: string, nextConfig: unknown) => {
      const currentSteps = config.quarterDesignerSteps[quarterId] ?? [];
      const updatedSteps = currentSteps.map((step) =>
        step.id === stepId
          ? {
              ...step,
              config:
                nextConfig === undefined
                  ? undefined
                  : cloneStepConfig(nextConfig),
            }
          : step
      );
      const designerMap = cloneQuarterStepMap(config.quarterDesignerSteps);
      designerMap[quarterId] = updatedSteps;

      let nextQuarters = config.quarters.map(cloneQuarter);

      if (nextConfig && typeof nextConfig === "object") {
        const typed = nextConfig as Record<string, unknown> & { type?: string };
        if (typed.type === "explorateur-quarter-basics") {
          const nextIsGoal = Boolean(typed.isGoal);
          const nextLabel =
            typeof typed.label === "string" ? typed.label : undefined;
          const nextColor =
            typeof typed.color === "string" ? typed.color : undefined;
          const rawNumber = typed.buildingNumber;
          const nextNumber =
            rawNumber === null
              ? null
              : typeof rawNumber === "number" && Number.isFinite(rawNumber)
              ? Math.trunc(rawNumber)
              : undefined;

          nextQuarters = nextQuarters.map((quarter) => {
            if (quarter.id !== quarterId) {
              if (nextIsGoal) {
                return { ...quarter, isGoal: false };
              }
              return quarter;
            }
            const updated = { ...quarter };
            if (nextLabel !== undefined) {
              updated.label = nextLabel;
            }
            if (nextColor !== undefined) {
              updated.color = nextColor;
            }
            if (nextIsGoal) {
              updated.isGoal = true;
              updated.buildingNumber = null;
              updated.inventory = null;
            } else {
              updated.isGoal = false;
              if (nextNumber !== undefined) {
                updated.buildingNumber = nextNumber;
              }
            }
            return updated;
          });
        } else if (typed.type === "explorateur-quarter-inventory") {
          const enabled = Boolean(typed.enabled);
          nextQuarters = nextQuarters.map((quarter) => {
            if (quarter.id !== quarterId) {
              return quarter;
            }
            if (!enabled || quarter.isGoal) {
              return { ...quarter, inventory: null };
            }
            return {
              ...quarter,
              inventory: {
                title:
                  typeof typed.title === "string"
                    ? typed.title
                    : quarter.inventory?.title ?? "",
                description:
                  typeof typed.description === "string"
                    ? typed.description
                    : quarter.inventory?.description ?? "",
                hint:
                  typeof typed.hint === "string"
                    ? typed.hint
                    : quarter.inventory?.hint ?? "",
                icon:
                  typeof typed.icon === "string"
                    ? typed.icon
                    : quarter.inventory?.icon ?? "🎁",
              },
            } satisfies ExplorateurIAQuarterConfig;
          });
        }
      }

      onUpdateQuarters(nextQuarters);
      const fallbackSteps = extractQuarterStepsFromDesignerMap(
        designerMap,
        nextQuarters
      );
      const { designerSteps } = sanitizeQuarterDesignerSteps(
        designerMap,
        nextQuarters,
        fallbackSteps
      );
      onUpdateQuarterDesignerSteps(designerSteps);
    },
    [
      config.quarterDesignerSteps,
      config.quarters,
      onUpdateQuarterDesignerSteps,
      onUpdateQuarters,
    ]
  );

  const handleRemoveDesignerStep = useCallback(
    (quarterId: QuarterId, stepId: string) => {
      const steps = config.quarterDesignerSteps[quarterId] ?? [];
      if (steps.length <= 1) {
        return;
      }
      const target = steps.find((step) => step.id === stepId);
      if (!target) {
        return;
      }
      const type = resolveDesignerStepType(target);
      if (type === "explorateur-quarter-basics") {
        return;
      }
      const updatedSteps = steps.filter((step) => step.id !== stepId);
      const designerMap = cloneQuarterStepMap(config.quarterDesignerSteps);
      designerMap[quarterId] = updatedSteps;
      const fallbackSteps = extractQuarterStepsFromDesignerMap(
        designerMap,
        config.quarters
      );
      const { designerSteps } = sanitizeQuarterDesignerSteps(
        designerMap,
        config.quarters,
        fallbackSteps
      );
      onUpdateQuarterDesignerSteps(designerSteps);
    },
    [config.quarterDesignerSteps, config.quarters, onUpdateQuarterDesignerSteps]
  );

  const handleMoveDesignerStep = useCallback(
    (quarterId: QuarterId, index: number, direction: -1 | 1) => {
      const steps = config.quarterDesignerSteps[quarterId] ?? [];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= steps.length) {
        return;
      }
      const updatedSteps = steps.map(cloneStepDefinition);
      const [moved] = updatedSteps.splice(index, 1);
      updatedSteps.splice(targetIndex, 0, moved);
      const designerMap = cloneQuarterStepMap(config.quarterDesignerSteps);
      designerMap[quarterId] = updatedSteps;
      const fallbackSteps = extractQuarterStepsFromDesignerMap(
        designerMap,
        config.quarters
      );
      const { designerSteps } = sanitizeQuarterDesignerSteps(
        designerMap,
        config.quarters,
        fallbackSteps
      );
      onUpdateQuarterDesignerSteps(designerSteps);
    },
    [config.quarterDesignerSteps, config.quarters, onUpdateQuarterDesignerSteps]
  );

  const handleAddDesignerStep = useCallback(
    (quarter: ExplorateurIAQuarterConfig, type: QuarterDesignerStepType) => {
      const steps = config.quarterDesignerSteps[quarter.id] ?? [];
      const entry = QUARTER_DESIGNER_STEP_LIBRARY.find(
        (candidate) => candidate.type === type
      );
      if (!entry) {
        return;
      }
      if (entry.isMeta) {
        if (
          steps.some((step) => resolveDesignerStepType(step) === type) ||
          (entry.allowGoal === false && quarter.isGoal)
        ) {
          return;
        }
      }
      if (entry.allowGoal === false && quarter.isGoal) {
        return;
      }
      const created = entry.create(quarter, steps);
      if (!created) {
        return;
      }
      const existingIds = new Set(steps.map((step) => step.id));
      let candidateId = created.id;
      let suffix = 2;
      while (existingIds.has(candidateId)) {
        candidateId = `${ensureStepHasQuarterPrefix(
          created.id,
          quarter.id
        )}-${suffix}`;
        suffix += 1;
      }

      const normalizedStep = ensureDesignerStepId(
        quarter.id,
        { ...created, id: candidateId },
        steps.length
      );

      const updatedSteps = [...steps.map(cloneStepDefinition), normalizedStep];
      const designerMap = cloneQuarterStepMap(config.quarterDesignerSteps);
      designerMap[quarter.id] = updatedSteps;
      const fallbackSteps = extractQuarterStepsFromDesignerMap(
        designerMap,
        config.quarters
      );
      const { designerSteps } = sanitizeQuarterDesignerSteps(
        designerMap,
        config.quarters,
        fallbackSteps
      );
      onUpdateQuarterDesignerSteps(designerSteps);
      setPendingStepIdByQuarter((current) => ({
        ...current,
        [quarter.id]: normalizedStep.id,
      }));
    },
    [
      config.quarterDesignerSteps,
      config.quarters,
      onUpdateQuarterDesignerSteps,
      setPendingStepIdByQuarter,
    ]
  );

  const getDesignerStepOptions = useCallback(
    (quarter: ExplorateurIAQuarterConfig) => {
      const steps = config.quarterDesignerSteps[quarter.id] ?? [];
      const typeCounts = new Map<string, number>();
      for (const step of steps) {
        const type = resolveDesignerStepType(step);
        typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      }
      return QUARTER_DESIGNER_STEP_LIBRARY.map((option) => ({
        ...option,
        disabled:
          (option.allowGoal === false && quarter.isGoal) ||
          (option.isMeta && (typeCounts.get(option.type) ?? 0) > 0),
      }));
    },
    [config.quarterDesignerSteps]
  );

  const renderDesignerStep = useCallback(
    (
      quarterId: QuarterId,
      {
        step,
        stepIndex,
        stepCount,
        StepComponent,
        componentProps,
        context,
        advance,
      }: StepSequenceRenderWrapperProps
    ) => {
      const stepType = resolveDesignerStepType(step);
      const meta = getDesignerStepMeta(stepType);
      const isFirst = stepIndex === 0;
      const isLast = stepIndex === stepCount - 1;
      const indicatorLabel = `Étape ${stepIndex + 1} sur ${stepCount}`;
      const progressPercent =
        stepCount > 0 ? Math.round(((stepIndex + 1) / stepCount) * 100) : 0;
      const pendingStepId = pendingStepIdByQuarter[quarterId] ?? null;

      return (
        <div className="space-y-6">
          <DesignerStepStateTracker
            context={context}
            pendingStepId={pendingStepId}
            onConsumed={() =>
              setPendingStepIdByQuarter((current) => {
                if (current[quarterId] == null) {
                  return current;
                }
                const next = { ...current };
                next[quarterId] = null;
                return next;
              })
            }
          />
          <div className="flex flex-col gap-6 lg:flex-row">
            <aside className="w-full max-w-full lg:w-72 lg:flex-shrink-0">
              <div className="space-y-3 rounded-2xl border border-orange-200 bg-white/70 p-3 shadow-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                  Étapes
                </h3>
                <ul className="space-y-2">
                  {context.steps.map((definition, index) => {
                    const itemType = resolveDesignerStepType(definition);
                    const itemMeta = getDesignerStepMeta(itemType);
                    const isActive = index === stepIndex;
                    const canRemove =
                      context.steps.length > 1 &&
                      itemType !== "explorateur-quarter-basics";
                    return (
                      <li
                        key={definition.id}
                        className={classNames(
                          "rounded-xl border px-3 py-2 text-left text-sm transition",
                          isActive
                            ? "border-orange-300 bg-orange-50 text-orange-900"
                            : "border-orange-200 bg-white text-orange-800 hover:border-orange-300 hover:bg-orange-50"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => context.goToStep(index)}
                            className="flex flex-1 items-center gap-2 text-left font-semibold text-current focus:outline-none"
                          >
                            <span aria-hidden="true">
                              {itemMeta?.icon ?? "🧩"}
                            </span>
                            <span>{itemMeta?.label ?? definition.id}</span>
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                handleMoveDesignerStep(quarterId, index, -1)
                              }
                              disabled={index === 0}
                              className="rounded-full border border-orange-200 px-2 py-1 text-xs font-semibold text-orange-700 hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label="Monter"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleMoveDesignerStep(quarterId, index, 1)
                              }
                              disabled={index === context.steps.length - 1}
                              className="rounded-full border border-orange-200 px-2 py-1 text-xs font-semibold text-orange-700 hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label="Descendre"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveDesignerStep(
                                  quarterId,
                                  definition.id
                                )
                              }
                              disabled={!canRemove}
                              className="rounded-full border border-orange-200 px-2 py-1 text-xs font-semibold text-orange-700 hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label="Supprimer"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>
            <div className="flex-1 space-y-4">
              <header className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-orange-600">
                  <span>{meta?.label ?? "Étape"}</span>
                  <span>{indicatorLabel}</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-orange-100">
                  <div
                    className="h-full rounded-full bg-orange-400"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {meta?.description ? (
                  <p className="text-sm text-orange-700">{meta.description}</p>
                ) : null}
              </header>
              <div className="rounded-2xl border border-orange-200 bg-white/90 p-4 shadow-sm">
                <StepComponent {...componentProps} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => context.goToStep(stepIndex - 1)}
                  disabled={isFirst}
                  className="rounded-full border border-orange-200 px-4 py-2 text-sm font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Étape précédente
                </button>
                <button
                  type="button"
                  onClick={() => advance()}
                  disabled={isLast}
                  className="rounded-full border border-orange-200 px-4 py-2 text-sm font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Étape suivante
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    },
    [
      handleMoveDesignerStep,
      handleRemoveDesignerStep,
      pendingStepIdByQuarter,
      setPendingStepIdByQuarter,
    ]
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-3 rounded-3xl border border-orange-200 bg-orange-50/60 p-6 text-orange-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Configurer Explorateur IA</h1>
            <p className="text-sm text-orange-800/80">
              Ajustez les quartiers, l'ordre de progression et la numérotation des
              défis avant d'insérer l'activité dans une séquence.
            </p>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="rounded-full border border-orange-200 px-4 py-2 text-sm font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100"
          >
            Réinitialiser
          </button>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
            <dt className="text-xs font-semibold uppercase tracking-wide text-orange-600">
              Mode d'exploration
            </dt>
            <dd className="mt-2 space-y-2">
              <select
                value={config.experienceMode}
                onChange={handleExperienceModeChange}
                className="w-full rounded-lg border border-orange-200 px-3 py-2 text-sm text-orange-900 focus:border-orange-400 focus:outline-none"
              >
                {EXPERIENCE_MODE_OPTIONS.map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-orange-700">
                {experienceModeMeta.designerDescription}
              </p>
            </dd>
          </div>
          <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
            <dt className="text-xs font-semibold uppercase tracking-wide text-orange-600">
              Thème du terrain
            </dt>
            <dd className="mt-2">
              <select
                value={config.terrain.themeId}
                onChange={handleThemeChange}
                className="w-full rounded-lg border border-orange-200 px-3 py-2 text-sm text-orange-900 focus:border-orange-400 focus:outline-none"
              >
                {Object.entries(TERRAIN_THEMES).map(([themeId, theme]) => (
                  <option key={themeId} value={themeId}>
                    {theme.label}
                  </option>
                ))}
              </select>
            </dd>
          </div>
          <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
            <dt className="text-xs font-semibold uppercase tracking-wide text-orange-600">
              Graine du monde
            </dt>
            <dd className="mt-2">
              <input
                type="number"
                className="w-full rounded-lg border border-orange-200 px-3 py-2 text-sm text-orange-900 focus:border-orange-400 focus:outline-none"
                value={config.terrain.seed}
                onChange={handleSeedChange}
              />
            </dd>
          </div>
          <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
            <dt className="text-xs font-semibold uppercase tracking-wide text-orange-600">
              Nombre de défis actifs
            </dt>
            <dd className="mt-2 text-lg font-semibold text-orange-900">
              {nonGoalQuarterCount}
            </dd>
          </div>
        </dl>
      </header>
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-orange-700">
            Quartiers et défis
          </h2>
          <button
            type="button"
            onClick={handleAddQuarter}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-orange-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-orange-700 shadow-sm transition hover:border-orange-300 hover:text-orange-900 focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            <span aria-hidden="true" className="text-base leading-none">
              +
            </span>
            Ajouter un quartier
          </button>
        </div>
        <p className="text-sm text-orange-900/80">
          Ajustez l'ordre des quartiers puis ouvrez l'éditeur pour modifier leurs paramètres détaillés.
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {config.quarters.map((quarter, index) => {
            const isGoal = Boolean(quarter.isGoal);
            const quarterInventory = quarter.inventory;
            const isExpanded = expandedQuarterIds.includes(quarter.id);
            const accordionId = `${quarter.id}-designer`;
            const designerStepOptions = getDesignerStepOptions(quarter);
            const quarterDesignerSteps =
              config.quarterDesignerSteps[quarter.id] ?? [];
            return (
              <article
                key={quarter.id}
                className="space-y-4 rounded-3xl border border-orange-200/70 bg-white/90 p-5 shadow-sm transition hover:border-orange-300"
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full border border-orange-200"
                        style={{ backgroundColor: quarter.color }}
                        aria-hidden="true"
                      />
                      <h3 className="text-base font-semibold text-orange-900">
                        {quarter.label || quarter.id}
                      </h3>
                    </div>
                    <p className="text-xs text-orange-700">
                      {isGoal
                        ? "Objectif final"
                        : `Défi n°${
                            quarter.buildingNumber === null
                              ? "—"
                              : quarter.buildingNumber
                          }`}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => handleMoveQuarter(index, -1)}
                      disabled={index === 0}
                      className="rounded-full border border-orange-200 px-3 py-1 font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↑ Monter
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveQuarter(index, 1)}
                      disabled={index === config.quarters.length - 1}
                      className="rounded-full border border-orange-200 px-3 py-1 font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↓ Descendre
                    </button>
                  </div>
                </header>
                <dl className="space-y-2 text-sm text-orange-800">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="font-medium">Identifiant</dt>
                    <dd className="font-mono text-xs text-orange-600">
                      {quarter.id}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="font-medium">Inventaire</dt>
                    <dd>{quarterInventory ? quarterInventory.title : "Aucun"}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleQuarter(quarter.id)}
                    aria-expanded={isExpanded}
                    aria-controls={accordionId}
                    className="flex-1 rounded-full border border-orange-200 px-4 py-2 text-sm font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100"
                  >
                    {isExpanded ? "Replier" : "Configurer"}
                  </button>
                  {isGoal ? (
                    <span className="rounded-full border border-orange-200 px-3 py-1 text-xs font-semibold text-orange-600">
                      Objectif final
                    </span>
                  ) : null}
                </div>
                <div
                  id={accordionId}
                  className={`space-y-6 rounded-2xl border border-dashed border-orange-200 bg-orange-50/70 p-5 ${
                    isExpanded ? "" : "hidden"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-orange-600">
                    <span>ID : {quarter.id}</span>
                    {isGoal ? (
                      <span className="rounded-full border border-orange-200 px-3 py-1 text-orange-700">
                        Objectif final
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-orange-800">
                      Ajouter une étape
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {designerStepOptions.map((option) => (
                        <button
                          key={option.type}
                          type="button"
                          onClick={() => handleAddDesignerStep(quarter, option.type)}
                          disabled={option.disabled}
                          className={classNames(
                            "inline-flex items-center gap-2 rounded-full border border-orange-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition",
                            option.disabled
                              ? "cursor-not-allowed bg-orange-100 text-orange-400"
                              : "bg-white text-orange-700 hover:border-orange-300 hover:bg-orange-50"
                          )}
                        >
                          <span aria-hidden="true">{option.icon}</span>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <StepSequenceRenderer
                    key={quarter.id}
                    steps={quarterDesignerSteps}
                    isEditMode
                    onStepConfigChange={(stepId, nextConfig) =>
                      handleDesignerStepConfigChange(quarter.id, stepId, nextConfig)
                    }
                    renderStepWrapper={(props) =>
                      renderDesignerStep(quarter.id, props)
                    }
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
