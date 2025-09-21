import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import mapPackAtlas from "../assets/kenney_map-pack/Spritesheet/mapPack_spritesheet.png";
import mapPackAtlasDescription from "../assets/kenney_map-pack/Spritesheet/mapPack_enriched.xml?raw";
import { useActivityCompletion } from "../hooks/useActivityCompletion";
import type { ActivityProps } from "../config/activities";

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

const DEFAULT_PLAYER_FRAMES = [atlas("mapTile_136.png")];

const FALLBACK_SAND_TILES = {
  center: atlas("mapTile_017.png"),
  north: atlas("mapTile_002.png"),
  south: atlas("mapTile_047.png"),
  east: atlas("mapTile_018.png"),
  west: atlas("mapTile_016.png"),
  northeast: atlas("mapTile_003.png"),
  northwest: atlas("mapTile_001.png"),
  southeast: atlas("mapTile_033.png"),
  southwest: atlas("mapTile_046.png"),
} as const;

function deriveSandTilesFromAtlas() {
  const sandEntries = Array.from(MAP_PACK_ATLAS.values()).filter(
    (entry) => entry.category === "terrain" && entry.subtype === "sand"
  );

  const pick = (
    predicate: (entry: AtlasEntry) => boolean,
    fallbackKey: keyof typeof FALLBACK_SAND_TILES
  ): TileCoord => {
    const match = sandEntries.find(predicate);
    return match ? atlas(match.name) : FALLBACK_SAND_TILES[fallbackKey];
  };

  const pickByConnection = (
    connection: string,
    fallbackKey: keyof typeof FALLBACK_SAND_TILES
  ) =>
    pick(
      (entry) =>
        entry.connections.includes(connection) &&
        (entry.tags.includes("bordure") ||
          entry.tags.includes("falaise") ||
          entry.tags.includes("coin_interieur")),
      fallbackKey
    );

  return {
    center: pick((entry) => entry.tags.includes("material"), "center"),
    north: pickByConnection("north", "north"),
    south: pickByConnection("south", "south"),
    east: pickByConnection("east", "east"),
    west: pickByConnection("west", "west"),
    northeast: pickByConnection("northeast", "northeast"),
    northwest: pickByConnection("northwest", "northwest"),
    southeast: pickByConnection("southeast", "southeast"),
    southwest: pickByConnection("southwest", "southwest"),
  } as const;
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
} as const;

type TileKind = (typeof TILE_KIND)[keyof typeof TILE_KIND];

const LOWER_TERRAIN_TYPES = new Set<TileKind>([
  TILE_KIND.WATER,
  TILE_KIND.SAND,
  TILE_KIND.FIELD,
]);

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

// Types pour la superposition de tuiles
type TerrainTile = {
  base: TileKind;
  overlay?: TileKind;
  cliffConnections?: string[];
};

function tileHasLowerTerrain(tile: TerrainTile | undefined | null): boolean {
  if (!tile) return false;
  if (tile.overlay !== undefined && isLowerTerrainKind(tile.overlay)) {
    return true;
  }
  return isLowerTerrainKind(tile.base);
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

type Tileset = {
  mode: TilesetMode;
  url?: string;
  size: number;
  map: {
    grass: GrassTiles;
    path: TileCoord;
    farmland: TileCoord;
    sand: {
      center: TileCoord;
      north: TileCoord;
      south: TileCoord;
      east: TileCoord;
      west: TileCoord;
      northeast: TileCoord;
      northwest: TileCoord;
      southeast: TileCoord;
      southwest: TileCoord;
    };
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
    sand: { ...DERIVED_SAND_TILES },
    water: {
      deep: atlas("mapTile_188.png"),
      shore: atlas("mapTile_171.png"),
    },
    details: {
      tree: atlas("mapTile_115.png"),
      flower: atlas("mapTile_054.png"),
    },
    houses: {
      clarte: atlas("mapTile_131.png"), // chiffre 1
      creation: atlas("mapTile_132.png"), // chiffre 2
      decision: atlas("mapTile_133.png"), // chiffre 3
      ethique: atlas("mapTile_134.png"), // chiffre 4
      townHall: atlas("mapTile_145.png"), // pas de chiffre (mairie)
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
      sand: {
        center: [...source.map.sand.center] as TileCoord,
        north: [...source.map.sand.north] as TileCoord,
        south: [...source.map.sand.south] as TileCoord,
        east: [...source.map.sand.east] as TileCoord,
        west: [...source.map.sand.west] as TileCoord,
        northeast: [...source.map.sand.northeast] as TileCoord,
        northwest: [...source.map.sand.northwest] as TileCoord,
        southeast: [...source.map.sand.southeast] as TileCoord,
        southwest: [...source.map.sand.southwest] as TileCoord,
      },
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
      sand: {
        center: normalizeCoord(
          map.sand?.center as TileCoord | undefined,
          base.map.sand.center
        ),
        north: normalizeCoord(
          map.sand?.north as TileCoord | undefined,
          base.map.sand.north
        ),
        south: normalizeCoord(
          map.sand?.south as TileCoord | undefined,
          base.map.sand.south
        ),
        east: normalizeCoord(
          map.sand?.east as TileCoord | undefined,
          base.map.sand.east
        ),
        west: normalizeCoord(
          map.sand?.west as TileCoord | undefined,
          base.map.sand.west
        ),
        northeast: normalizeCoord(
          map.sand?.northeast as TileCoord | undefined,
          base.map.sand.northeast
        ),
        northwest: normalizeCoord(
          map.sand?.northwest as TileCoord | undefined,
          base.map.sand.northwest
        ),
        southeast: normalizeCoord(
          map.sand?.southeast as TileCoord | undefined,
          base.map.sand.southeast
        ),
        southwest: normalizeCoord(
          map.sand?.southwest as TileCoord | undefined,
          base.map.sand.southwest
        ),
      },
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
  height: number,
  minSpan = 3
) {
  if (minSpan <= 1) {
    return;
  }

  const outside = findOutsideWaterCells(island, width, height);
  const visited = new Set<CoordKey>(outside);

  for (let x = 1; x < width - 1; x++) {
    for (let y = 1; y < height - 1; y++) {
      const startKey = coordKey(x, y);
      if (island.has(startKey) || visited.has(startKey)) {
        continue;
      }

      const queue: Coord[] = [[x, y]];
      const component: CoordKey[] = [startKey];
      visited.add(startKey);

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }
          const key = coordKey(nx, ny);
          if (island.has(key) || visited.has(key)) {
            continue;
          }
          visited.add(key);
          queue.push([nx, ny]);
          component.push(key);

          if (nx < minX) minX = nx;
          if (nx > maxX) maxX = nx;
          if (ny < minY) minY = ny;
          if (ny > maxY) maxY = ny;
        }
      }

      const spanX = maxX - minX + 1;
      const spanY = maxY - minY + 1;
      if (spanX < minSpan || spanY < minSpan) {
        for (const key of component) {
          island.add(key);
        }
      }
    }
  }
}

function smoothIslandShape(island: Set<CoordKey>, passes = 2) {
  if (island.size === 0 || passes <= 0) {
    return;
  }

  for (let pass = 0; pass < passes; pass++) {
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
    if (toRemove.length === 0 || toRemove.length === island.size) {
      break;
    }
    for (const key of toRemove) {
      island.delete(key);
    }
  }
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

function isTooCloseToPath(candidate: CoordKey, path: CoordKey[]): boolean {
  if (path.length === 0) {
    return false;
  }

  const allowed = new Set<CoordKey>([path[path.length - 1]]);
  if (path.length >= 2) {
    allowed.add(path[path.length - 2]);
  }

  const [cx, cy] = coordFromKey(candidate);
  for (const key of path) {
    if (allowed.has(key)) {
      continue;
    }
    const [px, py] = coordFromKey(key);
    if (Math.abs(cx - px) + Math.abs(cy - py) === 1) {
      return true;
    }
  }

  return false;
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

  const length = Math.min(desiredLength, cells.length);
  const minLength = Math.max(1, Math.min(6, length));

  for (let currentLength = length; currentLength >= minLength; currentLength--) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const start = randomChoice(rng, cells);
      const visited = new Set<CoordKey>([start]);
      const path: CoordKey[] = [start];
      const stack: Array<[CoordKey, CoordKey[]]> = [[start, []]];

      const prepareOptions = (key: CoordKey) => {
        const options = [...(neighborMap.get(key) ?? [])];
        shuffleInPlace(rng, options);
        return options;
      };

      stack[0][1] = prepareOptions(start);

      while (stack.length > 0) {
        if (path.length >= currentLength) {
          return path;
        }

        const top = stack[stack.length - 1];
        const [node, options] = top;
        let nextKey: CoordKey | null = null;

        while (options.length > 0) {
          const candidate = options.pop()!;
          if (visited.has(candidate)) {
            continue;
          }
          if (isTooCloseToPath(candidate, path)) {
            continue;
          }
          nextKey = candidate;
          break;
        }

        if (!nextKey) {
          stack.pop();
          path.pop();
          continue;
        }

        visited.add(nextKey);
        path.push(nextKey);
        stack.push([nextKey, prepareOptions(nextKey)]);
      }
    }
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

type GeneratedWorld = {
  tiles: TerrainTile[][];
  path: Coord[];
  landmarks: Record<QuarterId, { x: number; y: number }>;
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

  const indices = distributeIndices(path.length, LANDMARK_ASSIGNMENT_ORDER.length);
  LANDMARK_ASSIGNMENT_ORDER.forEach((id, index) => {
    const [x, y] = path[indices[index]];
    assignments[id] = { x, y };
  });

  return assignments;
}

function generateWorld(): GeneratedWorld {
  const rng = createRng(WORLD_SEED);
  const tiles: TerrainTile[][] = Array.from({ length: WORLD_HEIGHT }, () =>
    Array.from({ length: WORLD_WIDTH }, () => ({ base: TILE_KIND.WATER } as TerrainTile))
  );

  const island = generateIslandCells(WORLD_WIDTH, WORLD_HEIGHT, rng);
  fillSmallLakesInIsland(island, WORLD_WIDTH, WORLD_HEIGHT);
  smoothIslandShape(island, 2);

  for (const key of island) {
    const [x, y] = coordFromKey(key as CoordKey);
    const row = tiles[y];
    if (!row) {
      continue;
    }
    row[x].base = TILE_KIND.SAND;
    delete row[x].overlay;
    row[x].cliffConnections = undefined;
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
  }

  const landmarks = assignLandmarksFromPath(path);

  return { tiles, path, landmarks };
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

const BUILDING_META: Record<QuarterId, { label: string; color: string }> = {
  mairie: { label: "Mairie (Bilan)", color: "#ffd166" },
  clarte: { label: "Quartier Clarté", color: "#06d6a0" },
  creation: { label: "Quartier Création", color: "#118ab2" },
  decision: { label: "Quartier Décision", color: "#ef476f" },
  ethique: { label: "Quartier Éthique", color: "#8338ec" },
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
}> = BUILDING_DISPLAY_ORDER.map((id) => {
  const landmark = generatedWorld.landmarks[id] ?? FALLBACK_LANDMARKS[id];
  const meta = BUILDING_META[id];
  return {
    id,
    x: landmark.x,
    y: landmark.y,
    label: meta.label,
    color: meta.color,
  };
});

const START = {
  x: generatedWorld.landmarks.mairie?.x ?? FALLBACK_LANDMARKS.mairie.x,
  y: generatedWorld.landmarks.mairie?.y ?? FALLBACK_LANDMARKS.mairie.y,
};

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
  id,
  ts,
  tileSize,
}: {
  id: QuarterId;
  ts: Tileset;
  tileSize: number;
}) {
  const activeTileset = ts.mode === "atlas" && ts.url ? ts : DEFAULT_ATLAS;
  const coord =
    id === "mairie"
      ? activeTileset.map.houses.townHall
      : id === "clarte"
      ? activeTileset.map.houses.clarte
      : id === "creation"
      ? activeTileset.map.houses.creation
      : id === "decision"
      ? activeTileset.map.houses.decision
      : activeTileset.map.houses.ethique;
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

function getSandTileCoord(x: number, y: number, ts: Tileset): TileCoord {
  const northWater = tileLayersAt(x, y - 1).base === TILE_KIND.WATER;
  const southWater = tileLayersAt(x, y + 1).base === TILE_KIND.WATER;
  const westWater = tileLayersAt(x - 1, y).base === TILE_KIND.WATER;
  const eastWater = tileLayersAt(x + 1, y).base === TILE_KIND.WATER;

  if (northWater && eastWater) return ts.map.sand.northeast;
  if (southWater && eastWater) return ts.map.sand.southeast;
  if (northWater && westWater) return ts.map.sand.northwest;
  if (southWater && westWater) return ts.map.sand.southwest;
  if (northWater) return ts.map.sand.north;
  if (southWater) return ts.map.sand.south;
  if (eastWater) return ts.map.sand.east;
  if (westWater) return ts.map.sand.west;
  return ts.map.sand.center;
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

  // Rendu simple : base + overlay si existe
  const baseCoord = getAtlasTile(terrain.base, activeTileset, x, y);
  const overlayCoord = terrain.overlay
    ? getAtlasTile(terrain.overlay, activeTileset, x, y)
    : null;

  return (
    <div className="relative">
      {/* Couche de base */}
      {baseCoord && (
        <SpriteFromAtlas ts={activeTileset} coord={baseCoord} scale={tileSize} />
      )}

      {/* Couche overlay par-dessus */}
      {overlayCoord && (
        <div className="absolute inset-0">
          <SpriteFromAtlas ts={activeTileset} coord={overlayCoord} scale={tileSize} />
        </div>
      )}
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

const CLARTE_QUESTIONS = [
  {
    q: "Quel est le meilleur énoncé pour obtenir un plan clair?",
    options: [
      {
        id: "A",
        text: "Écris un plan.",
        explain: "Trop vague : objectifs, sections, longueur… manquent.",
        score: 0,
      },
      {
        id: "B",
        text: "Donne un plan en 5 sections sur l'énergie solaire pour débutants, avec titres et 2 sous-points chacun.",
        explain: "Précis, contraint et adapté au public cible.",
        score: 100,
      },
      {
        id: "C",
        text: "Plan énergie solaire?",
        explain: "Formulation télégraphique, ambiguë.",
        score: 10,
      },
    ],
  },
];

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

type CreationSpec = {
  action: string | null;
  media: string | null;
  style: string | null;
  theme: string | null;
};

const CREATION_POOL = {
  action: ["créer", "rédiger", "composer"],
  media: ["affiche", "article", "capsule audio"],
  style: ["cartoon", "académique", "minimaliste"],
  theme: ["énergie", "ville intelligente", "biodiversité"],
};

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

const DECISIONS = [
  {
    prompt: "Votre équipe doit annoncer un projet. Choisissez une stratégie de communication:",
    options: [
      { id: "A", title: "A — Rapide", impact: "+ vitesse / – profondeur", next: 1 },
      { id: "B", title: "B — Équilibrée", impact: "+ clarté / – temps", next: 1 },
      { id: "C", title: "C — Personnalisée", impact: "+ pertinence / – effort", next: 1 },
    ],
  },
  {
    prompt: "Le public réagit. Ensuite?",
    options: [
      { id: "A", title: "A — FAQ automatisée", impact: "+ échelle / – nuance", next: null },
      { id: "B", title: "B — Atelier interactif", impact: "+ engagement / – logistique", next: null },
      { id: "C", title: "C — Messages ciblés", impact: "+ efficacité / – données", next: null },
    ],
  },
];

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

const DILEMMAS = [
  {
    s: "Un outil génère un résumé contenant des stéréotypes.",
    options: [
      {
        id: "ignorer",
        label: "Ignorer",
        fb: "Risque d'amplifier le biais et de diffuser une erreur.",
        score: 0,
      },
      {
        id: "corriger",
        label: "Corriger et justifier",
        fb: "Bonne pratique: signalez et corrigez les biais.",
        score: 100,
      },
      {
        id: "expliquer",
        label: "Demander des explications",
        fb: "Utile, mais sans correction le risque demeure.",
        score: 60,
      },
    ],
  },
  {
    s: "Un modèle révèle des données sensibles dans un exemple.",
    options: [
      {
        id: "ignorer",
        label: "Ignorer",
        fb: "Non-conforme à la protection des données.",
        score: 0,
      },
      {
        id: "corriger",
        label: "Supprimer et anonymiser",
        fb: "Conforme aux bonnes pratiques.",
        score: 100,
      },
      {
        id: "expliquer",
        label: "Demander justification",
        fb: "Insuffisant sans retrait immédiat.",
        score: 40,
      },
    ],
  },
];

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
  const [walkStep, setWalkStep] = useState(0);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const worldContainerRef = useRef<HTMLDivElement | null>(null);
  const firstScrollRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const completionTriggered = useRef(false);

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
                    const highlight = HIGHLIGHT_TILES.has(terrain.base);
                    return (
                      <div key={`${x}-${y}`} className="relative">
                        <TileWithTs
                          terrain={terrain}
                          ts={tileset}
                          x={x}
                          y={y}
                          tileSize={tileSize}
                        />
                        {highlight && (
                          <div className="absolute inset-0 rounded bg-amber-200/30" />
                        )}
                        {buildings.map(
                          (building) =>
                            building.x === x &&
                            building.y === y && (
                              <button
                                key={building.id}
                                onClick={() => setOpen(building.id)}
                                className="absolute inset-1 rounded-lg border-2 flex items-center justify-center shadow"
                                style={{
                                  borderColor: building.color,
                                  background: "rgba(255,255,255,0.9)",
                                }}
                                title={building.label}
                              >
                                <BuildingSprite
                                  id={building.id}
                                  ts={tileset}
                                  tileSize={tileSize}
                                />
                              </button>
                            )
                        )}
                        {player.x === x && player.y === y && (
                          <div className="absolute inset-1 animate-[float_1.2s_ease-in-out_infinite]">
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
                  <button
                    onClick={() => setOpen(building.id)}
                    className="text-left hover:underline"
                    style={{ color: building.color }}
                  >
                    {building.label}
                  </button>
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
          </div>
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
