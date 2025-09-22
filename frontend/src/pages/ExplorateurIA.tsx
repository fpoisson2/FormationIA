import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import mapPackAtlas from "../assets/kenney_map-pack/Spritesheet/mapPack_spritesheet.png";
import mapPackAtlasDescription from "../assets/kenney_map-pack/Spritesheet/mapPack_enriched.xml?raw";
import { useActivityCompletion } from "../hooks/useActivityCompletion";
import type { ActivityProps } from "../config/activities";
import {
  CLARTE_QUESTIONS,
  CREATION_POOL,
  DECISIONS,
  DILEMMAS,
  type CreationSpec,
} from "./explorateurIA/worlds/world1";

// ---
// "Explorateur IA" — Frontend React (module web auto-portant)
// Style: mini jeu top-down façon Game Boy/Pokémon pour naviguer entre 4 quartiers.
// Aucune saisie de texte par l'étudiant — seulement clics, touches de direction, drag-and-drop.
// Technologies: React + Tailwind CSS (prévu), aucune dépendance externe requise.
// Export JSON + impression PDF via window.print().
// ---

type QuarterId = "clarte" | "creation" | "decision" | "ethique" | "mairie";

type Progress = {
  clarte: { done: boolean; score: number };
  creation: { done: boolean; spec?: CreationSpec };
  decision: { done: boolean; choicePath?: string[] };
  ethique: { done: boolean; score: number };
  visited: QuarterId[];
};

const BASE_TILE_SIZE = 32;
const TILE_GAP = 0;

const BACKGROUND_THEME_URL = "/explorateur_theme.wav";

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

  const derived: SandTiles = {
    center: [...FALLBACK_SAND_TILES.center] as TileCoord,
    edges: EDGE_DIRECTIONS.reduce((acc, direction) => {
      const fallback = FALLBACK_SAND_TILES.edges[direction];
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

    const bucket = derived.edges[orientationKey as EdgeDirection];
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
      bucket.exterior = atlas(entry.name);
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
      TILE_KIND.SNOW,
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
    weight: 4,
    fallback: atlas("mapTile_110.png"),
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
    density: 0.32,
    objects: [
      { id: "snowyTree", weight: 3 },
      { id: "pineTree", weight: 2 },
      { id: "smallRock" },
      { id: "mushroomPatch" },
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

type TerrainThemeId = keyof typeof TERRAIN_THEMES;

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
      tile.cliffConnections = connections.length > 0 ? connections : undefined;
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

function TilesetControls({
  ts,
  setTs,
}: {
  ts: Tileset;
  setTs: (t: Tileset) => void;
}) {
  const [url, setUrl] = useState(ts.url ?? mapPackAtlas);
  const [size, setSize] = useState(ts.size ?? DEFAULT_TILE_SIZE);

  const apply = (mode: TilesetMode) => {
    if (mode === "builtin") {
      setTs({ mode: "builtin", size, map: ts.map });
    } else {
      setTs({ mode: "atlas", url: url || mapPackAtlas, size, map: ts.map });
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span>Mode tileset</span>
        <div className="flex gap-1">
          <button
            className={
              ts.mode === "builtin"
                ? "px-2 py-1 rounded bg-slate-800 text-white"
                : "px-2 py-1 rounded bg-slate-100"
            }
            onClick={() => apply("builtin")}
          >
            builtin
          </button>
          <button
            className={
              ts.mode === "atlas"
                ? "px-2 py-1 rounded bg-slate-800 text-white"
                : "px-2 py-1 rounded bg-slate-100"
            }
            onClick={() => apply("atlas")}
          >
            atlas
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <label className="flex items-center gap-2">
          URL
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="/assets/tileset.png"
            className="flex-1 px-2 py-1 border rounded"
          />
        </label>
        <label className="flex items-center gap-2">
          Tile size
          <input
            type="number"
            value={size}
            onChange={(event) =>
              setSize(parseInt(event.target.value || "16", 10))
            }
            className="w-20 px-2 py-1 border rounded"
          />
        </label>
        <p className="text-slate-500">
          Dépose un atlas PNG (64×64) dans public/assets et renseigne l'URL. Pack
          recommandé: Kenney (CC0) Map Pack.
        </p>
      </div>
    </div>
  );
}

function useResponsiveTileSize(): number {
  const [size, setSize] = useState(BASE_TILE_SIZE);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const recompute = () => {
      const width = window.innerWidth;
      if (width < 480) {
        setSize(24);
      } else if (width < 768) {
        setSize(28);
      } else {
        setSize(BASE_TILE_SIZE);
      }
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  return size;
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

  const maxLength = Math.min(desiredLength, cells.length);
  const minLength = Math.max(1, Math.min(6, maxLength));
  let bestPath: CoordKey[] = [];

  for (let targetLength = maxLength; targetLength >= minLength; targetLength--) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const start = randomChoice(rng, cells);
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
  if (count === 1 || total <= 1) {
    return [0];
  }
  const step = (total - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round(index * step));
}

const WORLD_WIDTH = 25;
const WORLD_HEIGHT = 25;
const WORLD_SEED = 1247;

const FALLBACK_LANDMARKS: Record<QuarterId, { x: number; y: number }> = {
  mairie: { x: 12, y: 12 },
  clarte: { x: 6, y: 6 },
  creation: { x: 18, y: 6 },
  decision: { x: 6, y: 18 },
  ethique: { x: 18, y: 18 },
};

const LANDMARK_ASSIGNMENT_ORDER: QuarterId[] = [
  "clarte",
  "mairie",
  "creation",
  "decision",
  "ethique",
];

const PROGRESSION_SEQUENCE: QuarterId[] = [
  "clarte",
  "creation",
  "decision",
  "ethique",
];

const PROGRESSION_WITH_GOAL: QuarterId[] = [...PROGRESSION_SEQUENCE, "mairie"];

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

  if (path.length < LANDMARK_ASSIGNMENT_ORDER.length) {
    return assignments;
  }

  const interiorIndices = path
    .map((_, index) => index)
    .filter((index) => index > 0 && index < path.length - 1);

  const pickFrom = (indices: number[]) => {
    const distributed = distributeIndices(indices.length, LANDMARK_ASSIGNMENT_ORDER.length);
    LANDMARK_ASSIGNMENT_ORDER.forEach((id, index) => {
      const [x, y] = path[indices[distributed[index]]];
      assignments[id] = { x, y };
    });
  };

  if (interiorIndices.length >= LANDMARK_ASSIGNMENT_ORDER.length) {
    pickFrom(interiorIndices);
  } else {
    pickFrom(path.map((_, index) => index));
  }

  const stageOrder: QuarterId[] = [...PROGRESSION_SEQUENCE, "mairie"];
  const indexByStage = new Map<QuarterId, number>();
  const takenIndices = new Set<number>();

  for (let index = 0; index < path.length; index++) {
    const [x, y] = path[index];
    for (const stage of PROGRESSION_SEQUENCE) {
      if (indexByStage.has(stage)) {
        continue;
      }
      const assignment = assignments[stage];
      if (assignment.x === x && assignment.y === y) {
        indexByStage.set(stage, index);
        takenIndices.add(index);
      }
    }
  }

  if (path.length > 0) {
    indexByStage.set("mairie", path.length - 1);
    const [goalX, goalY] = path[path.length - 1];
    assignments.mairie = { x: goalX, y: goalY };
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

  return assignments;
}

const START_MARKER_COORD = atlas("mapTile_179.png");
const GOAL_MARKER_COORD = [...DEFAULT_ATLAS.map.houses.townHall] as TileCoord;
const GATE_MARKER_COORD = atlas("mapTile_044.png");

function generateWorld(seed: number = WORLD_SEED): GeneratedWorld {
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

  const desiredPathLength = Math.max(
    LANDMARK_ASSIGNMENT_ORDER.length,
    Math.floor(island.size * 0.45)
  );

  const pathKeys = carvePathOnIsland(island, desiredPathLength, rng);
  const path: Coord[] = pathKeys.map((key) => coordFromKey(key as CoordKey));

  for (const [x, y] of path) {
    const tile = tiles[y]?.[x];
    if (!tile) {
      continue;
    }
    tile.base = TILE_KIND.SAND;
    tile.overlay = TILE_KIND.PATH;
    tile.object = undefined;
  }

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const tile = tiles[y]?.[x];
      if (!tile) {
        continue;
      }
      if (tile.base === TILE_KIND.WATER || tile.overlay === TILE_KIND.PATH) {
        tile.object = undefined;
        continue;
      }
      const placement = chooseTerrainObject(tile.base, rng);
      tile.object = placement ?? undefined;
    }
  }

  const landmarks = assignLandmarksFromPath(path);
  if (path.length > 0) {
    const [goalX, goalY] = path[path.length - 1];
    landmarks.mairie = { x: goalX, y: goalY };
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

const BUILDING_META: Record<
  QuarterId,
  { label: string; color: string; number?: number }
> = {
  mairie: { label: "Mairie (Bilan)", color: "#ffd166" },
  clarte: { label: "Quartier Clarté", color: "#06d6a0", number: 1 },
  creation: { label: "Quartier Création", color: "#118ab2", number: 2 },
  decision: { label: "Quartier Décision", color: "#ef476f", number: 3 },
  ethique: { label: "Quartier Éthique", color: "#8338ec", number: 4 },
};

const BUILDING_DISPLAY_ORDER: QuarterId[] = [
  "mairie",
  "clarte",
  "creation",
  "decision",
  "ethique",
];

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
    const landmark = generatedWorld.landmarks[id] ?? FALLBACK_LANDMARKS[id];
    const meta = BUILDING_META[id];
    return {
      id,
      x: landmark.x,
      y: landmark.y,
      label: meta.label,
      color: meta.color,
      number: meta.number,
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

function regenerateWorldInPlace(seed: number = randomWorldSeed()): {
  seed: number;
  start: { x: number; y: number };
} {
  const nextWorld = generateWorld(seed);

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

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
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

function BuildingSprite({
  quarter,
  ts,
  tileSize,
}: {
  quarter: QuarterId;
  ts: Tileset;
  tileSize: number;
}) {
  const numberValue = BUILDING_META[quarter]?.number;
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

function DPad({ onMove }: { onMove: (dx: number, dy: number) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 select-none">
      <div />
      <button
        onClick={() => onMove(0, -1)}
        className="px-4 py-3 rounded-xl bg-white/80 hover:bg-white shadow text-base sm:text-sm"
        aria-label="Haut"
      >
        ▲
      </button>
      <div />
      <button
        onClick={() => onMove(-1, 0)}
        className="px-4 py-3 rounded-xl bg-white/80 hover:bg-white shadow text-base sm:text-sm"
        aria-label="Gauche"
      >
        ◀
      </button>
      <div />
      <button
        onClick={() => onMove(1, 0)}
        className="px-4 py-3 rounded-xl bg-white/80 hover:bg-white shadow text-base sm:text-sm"
        aria-label="Droite"
      >
        ▶
      </button>
      <div />
      <button
        onClick={() => onMove(0, 1)}
        className="px-4 py-3 rounded-xl bg-white/80 hover:bg-white shadow text-base sm:text-sm col-start-2"
        aria-label="Bas"
      >
        ▼
      </button>
      <div />
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

  const coord =
    getRandomTileByCategory(
      definition.atlasCategory,
      definition.atlasSubtype,
      placement.seed
    ) ?? definition.fallback;

  if (!coord) {
    return null;
  }

  const spriteTileset =
    tileset.mode === "atlas" && tileset.url ? tileset : DEFAULT_ATLAS;

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

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 max-w-4xl w-full rounded-2xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
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

function CreationBuilder({ onDone }: { onDone: (spec: CreationSpec) => void }) {
  const [spec, setSpec] = useState<CreationSpec>({
    action: null,
    media: null,
    style: null,
    theme: null,
  });
  const [previewKey, setPreviewKey] = useState(0);

  const ready = spec.action && spec.media && spec.style && spec.theme;

  const setField = <K extends keyof CreationSpec>(key: K, value: CreationSpec[K]) => {
    setSpec((current) => ({ ...current, [key]: value }));
  };

  const handleDrop = (slot: keyof CreationSpec, value: string) => {
    setField(slot, value);
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <h4 className="font-semibold mb-3">Assemblez votre consigne (drag-and-drop ou clic)</h4>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(CREATION_POOL).map(([slot, items]) => (
            <div key={slot} className="border rounded-xl p-3 bg-slate-50">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                {slot}
              </div>
              <div className="flex flex-wrap gap-2">
                {items.map((item) => (
                  <DraggablePill
                    key={item}
                    label={item}
                    onPick={() => setField(slot as keyof CreationSpec, item)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          {(["action", "media", "style", "theme"] as const).map((slot) => (
            <DropSlot
              key={slot}
              label={slot}
              value={spec[slot] ?? undefined}
              onSelect={(value) => handleDrop(slot, value)}
              onClear={() => setField(slot, null)}
            />
          ))}
        </div>
        <button
          disabled={!ready}
          onClick={() => ready && onDone(spec)}
          className="mt-4 px-4 py-2 rounded-xl bg-blue-600 text-white disabled:opacity-50"
        >
          Générer
        </button>
      </div>
      <div>
        <h4 className="font-semibold mb-3">Aperçu généré (démo locale)</h4>
        <div className="border rounded-2xl p-4 bg-white shadow">
          <GeneratedPreview key={previewKey} spec={spec} />
          <div className="text-xs text-slate-500 mt-3">
            Note: ici, un vrai backend IA peut remplacer cet aperçu local.
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200"
            onClick={() => setPreviewKey((count) => count + 1)}
          >
            Rafraîchir
          </button>
          <button
            className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200"
            onClick={() =>
              setSpec({ action: null, media: null, style: null, theme: null })
            }
          >
            Réinitialiser
          </button>
        </div>
      </div>
    </div>
  );
}

function DraggablePill({
  label,
  onPick,
}: {
  label: string;
  onPick: () => void;
}) {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData("text/plain", label);
  };
  return (
    <button
      draggable
      onDragStart={handleDragStart}
      onClick={onPick}
      className="px-2 py-1 rounded-full bg-white shadow border text-sm hover:bg-emerald-50"
    >
      {label}
    </button>
  );
}

function DropSlot({
  label,
  value,
  onSelect,
  onClear,
}: {
  label: string;
  value?: string;
  onSelect: (value: string) => void;
  onClear: () => void;
}) {
  const [isOver, setIsOver] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsOver(false);
    const dropped = event.dataTransfer.getData("text/plain");
    if (dropped) {
      onSelect(dropped);
    }
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      className={classNames(
        "rounded-xl p-3 border text-sm bg-white min-h-[56px]",
        isOver && "ring-2 ring-emerald-300"
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      {value ? (
        <div className="mt-1 flex items-center justify-between">
          <div className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">{value}</div>
          <button onClick={onClear} className="text-slate-500 hover:text-slate-700">
            ✕
          </button>
        </div>
      ) : (
        <div className="mt-1 text-slate-400">Glissez ou cliquez un choix…</div>
      )}
    </div>
  );
}

function GeneratedPreview({ spec }: { spec: CreationSpec }) {
  const title = [spec.action, spec.media].filter(Boolean).join(" → ") || "Préparez votre consigne";
  const subtitle = [spec.style, spec.theme].filter(Boolean).join(" • ") || "Complétez les paramètres";
  return (
    <div className="grid md:grid-cols-2 gap-4 items-center">
      <div>
        <div className="rounded-xl border p-3 bg-gradient-to-br from-slate-50 to-white">
          <h5 className="font-semibold">{title}</h5>
          <p className="text-sm text-slate-600">{subtitle}</p>
          <ul className="mt-2 text-sm list-disc pl-5 text-slate-700 space-y-1">
            <li>Contrainte: 150–200 mots, ton accessible.</li>
            <li>Structure: titre, 3 sections, conclusion.</li>
            <li>Sortie: Markdown.</li>
          </ul>
        </div>
        <p className="text-xs text-slate-500 mt-2">Texte simulé — remplaçable par une API de génération.</p>
      </div>
      <div>
        <svg viewBox="0 0 300 200" className="w-full h-auto rounded-xl border bg-white">
          <rect x="10" y="10" width="280" height="180" rx="12" fill="#F1F5F9" />
          <text x="24" y="50" fontSize="16" fontWeight={600} fill="#0F172A">
            {title || "Affiche / Article"}
          </text>
          <text x="24" y="75" fontSize="12" fill="#334155">
            {subtitle || "Style / Thème"}
          </text>
          <circle cx="250" cy="100" r="28" fill="#e2e8f0" />
          <circle cx="250" cy="100" r="22" fill="#94a3b8" />
          <g>
            <rect x="24" y="95" width="160" height="10" fill="#CBD5E1" />
            <rect x="24" y="115" width="140" height="10" fill="#E2E8F0" />
            <rect x="24" y="135" width="170" height="10" fill="#E2E8F0" />
          </g>
        </svg>
        <p className="text-xs text-slate-500 mt-2">Image simulée — remplaçable par une API d'image.</p>
      </div>
    </div>
  );
}

function DecisionPath({ onDone }: { onDone: (path: string[]) => void }) {
  const [step, setStep] = useState(0);
  const [path, setPath] = useState<string[]>([]);

  const choose = (id: string) => {
    const nextOptions = DECISIONS[step];
    if (!nextOptions) return;
    const next = nextOptions.options.find((option) => option.id === id)?.next ?? null;
    const updatedPath = [...path, id];
    setPath(updatedPath);
    if (next == null) {
      onDone(updatedPath);
    } else {
      setStep(next);
    }
  };

  const current = DECISIONS[step];

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold mb-1">Étape {step + 1}</h4>
        <p className="text-slate-700">{current.prompt}</p>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {current.options.map((option) => (
          <button
            key={option.id}
            onClick={() => choose(option.id)}
            className="text-left p-3 rounded-xl border bg-white hover:bg-slate-50"
          >
            <div className="font-semibold mb-1">{option.title}</div>
            <div className="text-sm text-slate-600">{option.impact}</div>
          </button>
        ))}
      </div>
      {path.length > 0 && (
        <div className="text-xs text-slate-500">Chemin choisi: {path.join(" → ")}</div>
      )}
    </div>
  );
}

function EthicsDilemmas({ onDone }: { onDone: (score: number) => void }) {
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);

  const answer = (score: number) => {
    const nextIndex = index + 1;
    const cumulative = total + score;
    const last = nextIndex >= DILEMMAS.length;
    setTotal(cumulative);
    if (last) {
      onDone(Math.round(cumulative / DILEMMAS.length));
    } else {
      setIndex(nextIndex);
    }
  };

  const dilemma = DILEMMAS[index];

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold">
          Situation {index + 1} / {DILEMMAS.length}
        </h4>
        <p className="text-slate-700">{dilemma.s}</p>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {dilemma.options.map((option) => (
          <button
            key={option.id}
            onClick={() => answer(option.score)}
            className="text-left p-3 rounded-xl border bg-white hover:bg-slate-50"
          >
            <div className="font-semibold mb-1">{option.label}</div>
            <div className="text-sm text-slate-600">{option.fb}</div>
          </button>
        ))}
      </div>
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

function BadgeView({
  progress,
  onDownloadJSON,
}: {
  progress: Progress;
  onDownloadJSON: () => void;
}) {
  const total =
    progress.clarte.score +
    (progress.ethique.score || 0) +
    (progress.creation.spec ? 100 : 0) +
    (progress.decision.choicePath ? 100 : 0);
  const percent = Math.round((total / 400) * 100);

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
            <span className="tabular-nums">{progress.creation.spec ? 100 : 0}</span>
          </div>
          <ProgressBar value={progress.creation.spec ? 100 : 0} color="blue" />
          <div className="text-sm flex items-center justify-between">
            <span>Décision</span>
            <span className="tabular-nums">{progress.decision.choicePath ? 100 : 0}</span>
          </div>
          <ProgressBar value={progress.decision.choicePath ? 100 : 0} color="rose" />
          <div className="text-sm flex items-center justify-between">
            <span>Éthique</span>
            <span className="tabular-nums">{progress.ethique.score}</span>
          </div>
          <ProgressBar value={progress.ethique.score} color="violet" />
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
        {progress.creation.spec && (
          <div className="mt-4 text-sm text-slate-700">
            <div className="font-semibold mb-1">Spécification de création</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>action: {progress.creation.spec.action}</li>
              <li>media: {progress.creation.spec.media}</li>
              <li>style: {progress.creation.spec.style}</li>
              <li>theme: {progress.creation.spec.theme}</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExplorateurIA({
  completionId,
  navigateToActivities,
  isEditMode = false,
}: ActivityProps) {
  const tileSize = useResponsiveTileSize();
  const cellSize = tileSize + TILE_GAP;
  const [player, setPlayer] = useState(START);
  const [open, setOpen] = useState<QuarterId | null>(null);
  const [progress, setProgress] = useState<Progress>({
    clarte: { done: false, score: 0 },
    creation: { done: false },
    decision: { done: false },
    ethique: { done: false, score: 0 },
    visited: [],
  });
  const [celebrate, setCelebrate] = useState(false);
  const [tileset, setTileset] = useTileset();
  const [worldVersion, forceWorldRefresh] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState<TerrainThemeId>("sand");
  const [blockedStage, setBlockedStage] = useState<QuarterId | null>(null);
  const [walkStep, setWalkStep] = useState(0);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const worldContainerRef = useRef<HTMLDivElement | null>(null);
  const firstScrollRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const completionTriggered = useRef(false);

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
          return (
            progress.clarte.done &&
            progress.creation.done &&
            progress.decision.done &&
            progress.ethique.done
          );
        default:
          return false;
      }
    },
    [progress]
  );

  const activeGateKeys = useMemo(() => {
    const active = new Set<CoordKey>();
    for (const gate of PATH_GATES) {
      if (!isQuarterCompleted(gate.stage)) {
        active.add(coordKey(gate.x, gate.y));
      }
    }
    return active;
  }, [isQuarterCompleted, worldVersion]);

  const handleThemeChange = useCallback(
    (themeId: TerrainThemeId) => {
      if (!isEditMode) {
        return;
      }
      const theme = TERRAIN_THEMES[themeId];
      if (!theme) {
        return;
      }
      setSelectedTheme(themeId);
      applyTerrainThemeToWorld(world, theme);
      recomputeWorldMetadata(world);
      forceWorldRefresh((value) => value + 1);
    },
    [forceWorldRefresh, isEditMode]
  );

  const handleRegenerateWorld = useCallback(() => {
    if (!isEditMode) {
      return;
    }
    const { start } = regenerateWorldInPlace();
    const theme = TERRAIN_THEMES[selectedTheme];
    if (theme) {
      applyTerrainThemeToWorld(world, theme);
    }
    recomputeWorldMetadata(world);
    setPlayer({ x: start.x, y: start.y });
    forceWorldRefresh((value) => value + 1);
  }, [forceWorldRefresh, isEditMode, selectedTheme, setPlayer]);

  const { markCompleted } = useActivityCompletion({
    activityId: completionId,
    onCompleted: () => navigateToActivities(),
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const audio = new Audio(BACKGROUND_THEME_URL);
    audio.loop = true;
    audio.volume = 0.35;
    audioRef.current = audio;
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)) {
        event.preventDefault();
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
          move(delta[0], delta[1]);
        }
      }
      if (key === "enter") {
        const hit = buildingAt(player.x, player.y);
        if (hit) setOpen(hit.id);
      }
      if (key === "escape") setOpen(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [player]);

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

  useEffect(() => {
    if (completionTriggered.current) {
      return;
    }
    if (
      progress.clarte.done &&
      progress.creation.done &&
      progress.decision.done &&
      progress.ethique.done
    ) {
      completionTriggered.current = true;
      void markCompleted({ triggerCompletionCallback: true });
    }
  }, [progress, markCompleted]);

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

  const attemptPlayMusic = () => {
    if (isMusicPlaying) {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.loop = true;
    audio.volume = 0.35;
    void audio.play().then(() => setIsMusicPlaying(true)).catch(() => {
      // Autoplay peut être bloqué : l'utilisateur pourra utiliser le bouton.
    });
  };

  const toggleMusic = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (isMusicPlaying) {
      audio.pause();
      setIsMusicPlaying(false);
    } else {
      audio.loop = true;
      audio.volume = 0.35;
      void audio.play().then(() => setIsMusicPlaying(true)).catch(() => {
        // L'utilisateur devra réessayer en cas de blocage navigateur.
      });
    }
  };

  const move = (dx: number, dy: number) => {
    const nx = player.x + dx;
    const ny = player.y + dy;
    const gate = GATE_BY_COORD.get(coordKey(nx, ny));
    if (gate && !isQuarterCompleted(gate.stage)) {
      setBlockedStage(gate.stage);
      return;
    }
    if (!isWalkable(nx, ny, player.x, player.y)) return;
    attemptPlayMusic();
    setPlayer({ x: nx, y: ny });
    setWalkStep((step) => step + 1);
  };

  const buildingAt = (x: number, y: number) => {
    return buildings.find((building) => building.x === x && building.y === y) || null;
  };

  const openIfOnBuilding = () => {
    const hit = buildingAt(player.x, player.y);
    if (hit) setOpen(hit.id);
  };

  const complete = (id: QuarterId, payload?: unknown) => {
    setProgress((previous) => {
      const visited = previous.visited.includes(id)
        ? previous.visited
        : [...previous.visited, id];
      const next: Progress = {
        ...previous,
        visited,
        clarte:
          id === "clarte"
            ? { done: true, score: typeof payload === "number" ? payload : previous.clarte.score }
            : previous.clarte,
        creation:
          id === "creation"
            ? { done: true, spec: (payload as CreationSpec) ?? previous.creation.spec }
            : previous.creation,
        decision:
          id === "decision"
            ? {
                done: true,
                choicePath: (payload as string[]) ?? previous.decision.choicePath,
              }
            : previous.decision,
        ethique:
          id === "ethique"
            ? { done: true, score: typeof payload === "number" ? payload : previous.ethique.score }
            : previous.ethique,
      };
      return next;
    });
    setOpen(null);
    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 1800);
  };

  const downloadJSON = () => {
    const data = {
      activity: "Explorateur IA",
      timestamp: new Date().toISOString(),
      progress,
    };
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

  const at = buildingAt(player.x, player.y);

  return (
    <div className="relative space-y-6">
      <Fireworks show={celebrate} />
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-2xl border bg-white p-4 shadow relative">
          <div className="absolute right-3 top-3 flex items-center gap-2 text-[11px] text-slate-600 bg-slate-100/80 px-2 py-1 rounded-full border shadow-sm">
            <span className="tracking-wide uppercase">Tiny Town</span>
            <button
              onClick={toggleMusic}
              className="rounded-full border bg-white px-2 py-[2px] text-xs font-semibold text-slate-700 hover:bg-slate-100"
              aria-pressed={isMusicPlaying}
              aria-label={
                isMusicPlaying ? "Mettre la musique en pause" : "Lancer la musique"
              }
              title={isMusicPlaying ? "Pause" : "Lecture"}
            >
              {isMusicPlaying ? "⏸" : "♫"}
            </button>
          </div>
          <div
            ref={worldContainerRef}
            className="mt-4 overflow-auto rounded-xl border bg-emerald-50/60 shadow-inner touch-pan-y max-w-full"
            style={{ maxHeight: "min(70vh, 520px)" }}
          >
            <div className="inline-block p-3">
              <div
                className="grid min-w-max"
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
                      <div key={`${x}-${y}`} className="relative">
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
                        {buildings.map(
                          (building) =>
                            building.x === x &&
                            building.y === y && (
                              <button
                                key={building.id}
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
                                  "absolute inset-0 z-10 flex items-center justify-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70",
                                  tileBlocked && "cursor-not-allowed opacity-70"
                                )}
                                title={building.label}
                              >
                                <BuildingSprite
                                  quarter={building.id}
                                  ts={tileset}
                                  tileSize={tileSize}
                                />
                              </button>
                            )
                        )}
                        {player.x === x && player.y === y && (
                          <div className="pointer-events-none absolute inset-1 z-30 animate-[float_1.2s_ease-in-out_infinite]">
                            <PlayerSprite ts={tileset} step={walkStep} tileSize={tileSize} />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          <style>{`
            @keyframes float { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-2px) } }
          `}</style>
          <div className="mt-3 flex items-center justify-between text-sm">
            <div>
              {at ? (
                <span>
                  Vous êtes devant: <span className="font-semibold">{at.label}</span>
                </span>
              ) : (
                <span>Explorez la ville et entrez dans un quartier.</span>
              )}
            </div>
            <button
              onClick={openIfOnBuilding}
              className="px-3 py-2 rounded-lg bg-slate-100 border w-full sm:w-auto"
            >
              Entrer
            </button>
          </div>
        </div>
        <aside className="space-y-4 md:sticky md:top-4">
          <div className="rounded-2xl border bg-white p-4 shadow">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Progression
            </div>
            <ul className="mt-2 text-sm space-y-2">
              {buildings.map((building) => (
                <li key={building.id} className="flex items-center justify-between gap-3">
                  {(() => {
                    const key = coordKey(building.x, building.y);
                    const tileBlocked = activeGateKeys.has(key);
                    const gate = GATE_BY_COORD.get(key);
                    const lockMessageStage = gate?.stage ?? building.id;
                    const isLocked = tileBlocked && !isQuarterCompleted(building.id);
                    return (
                      <button
                        onClick={() => {
                          if (isLocked) {
                            setBlockedStage(lockMessageStage);
                            return;
                          }
                          setOpen(building.id);
                        }}
                        disabled={isLocked}
                        className={classNames(
                          "text-left",
                          isLocked
                            ? "cursor-not-allowed opacity-60"
                            : "hover:underline"
                        )}
                        style={{ color: building.color }}
                      >
                        {building.label}
                      </button>
                    );
                  })()}
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-slate-50">
                    {building.id === "clarte" && (progress.clarte.done ? "OK" : "À faire")}
                    {building.id === "creation" && (progress.creation.done ? "OK" : "À faire")}
                    {building.id === "decision" && (progress.decision.done ? "OK" : "À faire")}
                    {building.id === "ethique" && (progress.ethique.done ? "OK" : "À faire")}
                    {building.id === "mairie" && "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Contrôles
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <DPad onMove={move} />
              <div className="text-xs text-slate-600 space-y-1">
                <p>Entrer: Ouvrir</p>
                <p>Échap: Fermer</p>
                <p>Clic: Accès direct</p>
              </div>
            </div>
            {blockedStage && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs text-rose-700">
                Terminez d'abord {BUILDING_META[blockedStage]?.label ?? "ce quartier"}.
              </div>
            )}
          </div>
          {isEditMode && (
            <div className="rounded-2xl border bg-white p-4 shadow">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Terrain
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {TERRAIN_THEME_ORDER.map((key) => {
                  const theme = TERRAIN_THEMES[key];
                  const isActive = selectedTheme === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleThemeChange(key)}
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
                onClick={handleRegenerateWorld}
                className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"
              >
                Régénérer la forme
              </button>
              <p className="mt-3 text-xs text-slate-500">
                Choisissez un style pour changer l'apparence et utilisez le bouton pour régénérer la forme de l'île. Le changement est visible immédiatement.
              </p>
            </div>
          )}
          <div className="rounded-2xl border bg-white p-4 shadow">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Tileset
            </div>
            <TilesetControls ts={tileset} setTs={setTileset} />
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Export
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={downloadJSON}
                className="px-3 py-2 rounded-xl bg-slate-800 text-white"
              >
                JSON
              </button>
              <button
                onClick={() => window.print()}
                className="px-3 py-2 rounded-xl bg-slate-100 border"
              >
                PDF
              </button>
            </div>
          </div>
        </aside>
      </div>

      <Modal
        open={open === "clarte"}
        onClose={() => setOpen(null)}
        title="Quartier Clarté"
      >
        <p className="text-sm text-slate-600 mb-4">
          Choisissez la meilleure consigne pour obtenir un plan clair. Pas de saisie:
          uniquement des options.
        </p>
        <ClarteQuiz onDone={(score) => complete("clarte", score)} />
      </Modal>

      <Modal
        open={open === "creation"}
        onClose={() => setOpen(null)}
        title="Quartier Création"
      >
        <p className="text-sm text-slate-600 mb-4">
          Assemblez une consigne en combinant des paramètres. La génération est simulée côté
          client.
        </p>
        <CreationBuilder onDone={(spec) => complete("creation", spec)} />
      </Modal>

      <Modal
        open={open === "decision"}
        onClose={() => setOpen(null)}
        title="Quartier Décision"
      >
        <p className="text-sm text-slate-600 mb-4">
          Choisissez une trajectoire. Chaque choix révèle avantages et limites.
        </p>
        <DecisionPath onDone={(path) => complete("decision", path)} />
      </Modal>

      <Modal
        open={open === "ethique"}
        onClose={() => setOpen(null)}
        title="Quartier Éthique"
      >
        <p className="text-sm text-slate-600 mb-4">
          Réagissez à des dilemmes. Retour immédiat sur les enjeux.
        </p>
        <EthicsDilemmas onDone={(score) => complete("ethique", score)} />
      </Modal>

      <Modal
        open={open === "mairie"}
        onClose={() => setOpen(null)}
        title="Mairie — Bilan visuel"
      >
        <BadgeView progress={progress} onDownloadJSON={downloadJSON} />
      </Modal>

      <footer className="text-center text-xs text-slate-500">
        Module web auto-portant — aucune saisie de texte requise. © Explorateur IA
      </footer>
    </div>
  );
}
