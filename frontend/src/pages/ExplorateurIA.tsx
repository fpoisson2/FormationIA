import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import mapPackAtlas from "../assets/kenney_map-pack/Spritesheet/mapPack_spritesheet.png";
import mapPackAtlasDescription from "../assets/kenney_map-pack/Spritesheet/mapPack_spritesheet_described.xml?raw";
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

const TILE = 32;
const TILE_GAP = 2;
const CELL_SIZE = TILE + TILE_GAP;

const BACKGROUND_THEME_URL = "/explorateur_theme.wav";

function dataUri(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const SPR_TILE_GRASS = dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
  <rect width='16' height='16' fill='#46a049'/>
  <rect x='0' y='8' width='16' height='1' fill='#3d8f43'/>
  <rect x='8' y='0' width='1' height='16' fill='#3d8f43'/>
  <rect x='2' y='2' width='2' height='2' fill='#67c16a'/>
  <rect x='10' y='5' width='2' height='2' fill='#67c16a'/>
  <rect x='6' y='11' width='2' height='2' fill='#67c16a'/>
</svg>`);
const SPR_TILE_PATH = dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
  <rect width='16' height='16' fill='#caa56a'/>
  <rect x='0' y='7' width='16' height='2' fill='#b18959'/>
  <rect x='7' y='0' width='2' height='16' fill='#b18959'/>
</svg>`);
const SPR_TILE_WATER = dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
  <rect width='16' height='16' fill='#4fc3f7'/>
  <rect x='0' y='7' width='16' height='2' fill='#29b6f6'/>
  <rect x='2' y='3' width='12' height='1' fill='#81d4fa'/>
  <rect x='4' y='11' width='8' height='1' fill='#81d4fa'/>
</svg>`);

function houseSvg(roof: string, wall = "#f4f4f5") {
  return dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
    <rect x='3' y='7' width='10' height='7' fill='${wall}' stroke='#9aa0a6' stroke-width='1'/>
    <polygon points='8,3 2,8 14,8' fill='${roof}' stroke='#5b5b5b' stroke-width='1'/>
    <rect x='7' y='10' width='2' height='4' fill='#8d6e63'/>
    <rect x='4' y='9' width='2' height='2' fill='#90caf9'/>
    <rect x='10' y='9' width='2' height='2' fill='#90caf9'/>
  </svg>`);
}

const SPR_HOUSE_GREEN = houseSvg("#06d6a0");
const SPR_HOUSE_BLUE = houseSvg("#118ab2");
const SPR_HOUSE_RED = houseSvg("#ef476f");
const SPR_HOUSE_PURP = houseSvg("#8338ec");
const SPR_TOWN_HALL = dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
  <rect x='2' y='8' width='12' height='6' fill='#ffe08a' stroke='#bfa15c' stroke-width='1'/>
  <rect x='6' y='9' width='4' height='5' fill='#d7ccc8'/>
  <polygon points='8,3 1,8 15,8' fill='#f4c430' stroke='#bfa15c' stroke-width='1'/>
  <rect x='4' y='9' width='2' height='2' fill='#fff3c4'/>
  <rect x='10' y='9' width='2' height='2' fill='#fff3c4'/>
</svg>`);

const SPR_PLAYER = dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
  <rect width='16' height='16' fill='none'/>
  <rect x='6' y='2' width='4' height='3' fill='#f9d7b6'/>
  <rect x='5' y='5' width='6' height='1' fill='#3e2723'/>
  <rect x='5' y='6' width='6' height='5' fill='#1976d2'/>
  <rect x='6' y='11' width='4' height='3' fill='#263238'/>
  <rect x='6' y='14' width='2' height='2' fill='#424242'/>
  <rect x='8' y='14' width='2' height='2' fill='#424242'/>
</svg>`);

const SPR_TILE_PLAZA = dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
  <rect width='16' height='16' fill='#d4c4a1'/>
  <rect x='0' y='7' width='16' height='2' fill='#c0b091'/>
  <rect x='7' y='0' width='2' height='16' fill='#c0b091'/>
  <rect x='2' y='2' width='4' height='4' fill='#e5d4af'/>
  <rect x='10' y='10' width='4' height='4' fill='#e5d4af'/>
</svg>`);

function houseRoofTile(color: string, side: "left" | "right") {
  const darker = side === "left" ? "#4c1d95" : "#5b21b6";
  const lighter = side === "left" ? "#a855f7" : "#c084fc";
  const polygon =
    side === "left"
      ? "0,12 8,2 8,16 0,16"
      : "8,2 16,12 16,16 8,16";
  const edgeX = side === "left" ? 7 : 8;
  return dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
    <rect width='16' height='16' fill='${color}'/>
    <polygon points='${polygon}' fill='${lighter}'/>
    <rect x='${edgeX}' y='2' width='1' height='14' fill='${darker}'/>
    <rect x='0' y='12' width='16' height='1' fill='${darker}'/>
  </svg>`);
}

function houseWallTile(side: "left" | "right") {
  const offset = side === "left" ? 0 : 8;
  const windowX = side === "left" ? 2 : 10;
  const edgeX = side === "left" ? 0 : 15;
  const shadowX = side === "left" ? 1 : 14;
  return dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
    <rect width='16' height='16' fill='#f1ede4'/>
    <rect x='${edgeX}' y='0' width='1' height='16' fill='#bda48c'/>
    <rect x='${shadowX}' y='0' width='1' height='16' fill='#d7c2aa'/>
    <rect x='${windowX}' y='6' width='4' height='4' fill='#90caf9'/>
    <rect x='${windowX}' y='10' width='4' height='1' fill='#64b5f6'/>
    <rect x='${windowX + 1}' y='11' width='2' height='1' fill='#bbdefb'/>
    <rect x='${offset + 2}' y='13' width='4' height='3' fill='#795548'/>
    <rect x='${offset + 2}' y='14' width='4' height='1' fill='#5d4037'/>
  </svg>`);
}

const SPR_TILE_ROOF_LEFT = houseRoofTile("#6d28d9", "left");
const SPR_TILE_ROOF_RIGHT = houseRoofTile("#7c3aed", "right");
const SPR_TILE_WALL_LEFT = houseWallTile("left");
const SPR_TILE_WALL_RIGHT = houseWallTile("right");

const SPR_TILE_TREE = dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
  <rect width='16' height='16' fill='#46a049'/>
  <circle cx='8' cy='6' r='5' fill='#2f855a'/>
  <circle cx='5' cy='8' r='3' fill='#38a169'/>
  <circle cx='11' cy='8' r='3' fill='#38a169'/>
  <rect x='7' y='9' width='2' height='5' fill='#6d4c41'/>
  <rect x='6' y='10' width='4' height='1' fill='#8d6e63'/>
</svg>`);

const SPR_TILE_FLOWER = dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
  <rect width='16' height='16' fill='#5dbb63'/>
  <circle cx='5' cy='5' r='2' fill='#fcd34d'/>
  <circle cx='11' cy='5' r='2' fill='#f472b6'/>
  <circle cx='5' cy='11' r='2' fill='#60a5fa'/>
  <circle cx='11' cy='11' r='2' fill='#f97316'/>
  <rect x='7' y='7' width='2' height='2' fill='#f9fafb'/>
</svg>`);

const SPR_TILE_FIELD = dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
  <rect width='16' height='16' fill='#d19a66'/>
  <rect x='0' y='3' width='16' height='2' fill='#b07846'/>
  <rect x='0' y='8' width='16' height='2' fill='#b07846'/>
  <rect x='0' y='13' width='16' height='2' fill='#b07846'/>
  <rect x='4' y='0' width='2' height='16' fill='#e0b989'/>
  <rect x='9' y='0' width='2' height='16' fill='#e0b989'/>
</svg>`);

const SPR_TILE_SAND = dataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' shape-rendering='crispEdges'>
  <rect width='16' height='16' fill='#f0e4c3'/>
  <rect x='0' y='6' width='16' height='1' fill='#e2d3aa'/>
  <rect x='0' y='12' width='16' height='1' fill='#e2d3aa'/>
  <rect x='3' y='3' width='2' height='2' fill='#fff3d6'/>
  <rect x='11' y='9' width='2' height='2' fill='#fff3d6'/>
</svg>`);

type AtlasEntry = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description?: string;
};

function parseAtlasDescription(xml: string): Map<string, AtlasEntry> {
  const entries = new Map<string, AtlasEntry>();
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
    const name = attributes.name;
    if (!name) {
      continue;
    }
    const entry: AtlasEntry = {
      name,
      x: Number(attributes.x ?? 0),
      y: Number(attributes.y ?? 0),
      width: Number(attributes.width ?? 0),
      height: Number(attributes.height ?? 0),
      description: attributes.description,
    };
    entries.set(name, entry);
  }
  return entries;
}

const DEFAULT_TILE_SIZE = 64;

const MAP_PACK_ATLAS = parseAtlasDescription(mapPackAtlasDescription);

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

const TILE_KIND = {
  GRASS: 0,
  PATH: 1,
  WATER: 2,
  PLAZA: 3,
  ROOF_LEFT: 4,
  ROOF_RIGHT: 5,
  WALL_LEFT: 6,
  WALL_RIGHT: 7,
  TREE: 8,
  FLOWER: 9,
  FIELD: 10,
  SAND: 11,
} as const;

type TileKind = (typeof TILE_KIND)[keyof typeof TILE_KIND];

const TILE_DEFINITIONS: Record<
  TileKind,
  { sprite: string; highlight?: boolean }
> = {
  [TILE_KIND.GRASS]: { sprite: SPR_TILE_GRASS },
  [TILE_KIND.PATH]: { sprite: SPR_TILE_PATH, highlight: true },
  [TILE_KIND.WATER]: { sprite: SPR_TILE_WATER },
  [TILE_KIND.PLAZA]: { sprite: SPR_TILE_PLAZA, highlight: true },
  [TILE_KIND.ROOF_LEFT]: { sprite: SPR_TILE_ROOF_LEFT },
  [TILE_KIND.ROOF_RIGHT]: { sprite: SPR_TILE_ROOF_RIGHT },
  [TILE_KIND.WALL_LEFT]: { sprite: SPR_TILE_WALL_LEFT },
  [TILE_KIND.WALL_RIGHT]: { sprite: SPR_TILE_WALL_RIGHT },
  [TILE_KIND.TREE]: { sprite: SPR_TILE_TREE },
  [TILE_KIND.FLOWER]: { sprite: SPR_TILE_FLOWER },
  [TILE_KIND.FIELD]: { sprite: SPR_TILE_FIELD },
  [TILE_KIND.SAND]: { sprite: SPR_TILE_SAND },
};

const BLOCKING_TILES = new Set<TileKind>([
  TILE_KIND.WATER,
  TILE_KIND.ROOF_LEFT,
  TILE_KIND.ROOF_RIGHT,
  TILE_KIND.WALL_LEFT,
  TILE_KIND.WALL_RIGHT,
  TILE_KIND.TREE,
  TILE_KIND.FLOWER,
  TILE_KIND.FIELD,
]);

const HIGHLIGHT_TILES = new Set<TileKind>([
  TILE_KIND.PATH,
  TILE_KIND.PLAZA,
]);

type TilesetMode = "builtin" | "atlas";

type TileCoord = [number, number] | [number, number, number, number];

type Tileset = {
  mode: TilesetMode;
  url?: string;
  size: number;
  map: {
    grass: TileCoord;
    path: TileCoord;
    plaza: TileCoord;
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

const DEFAULT_ATLAS: Tileset = {
  mode: "atlas",
  url: mapPackAtlas,
  size: DEFAULT_TILE_SIZE,
  map: {
    grass: atlas("mapTile_010.png"),
    path: atlas("mapTile_185.png"),
    plaza: atlas("mapTile_187.png"),
    farmland: atlas("mapTile_101.png"),
    sand: {
      center: atlas("mapTile_061.png"),
      north: atlas("mapTile_053.png"),
      south: atlas("mapTile_054.png"),
      east: atlas("mapTile_056.png"),
      west: atlas("mapTile_055.png"),
      northeast: atlas("mapTile_057.png"),
      northwest: atlas("mapTile_059.png"),
      southeast: atlas("mapTile_058.png"),
      southwest: atlas("mapTile_060.png"),
    },
    water: {
      deep: atlas("mapTile_004.png"),
      shore: atlas("mapTile_003.png"),
    },
    details: {
      tree: atlas("mapTile_118.png"),
      flower: atlas("mapTile_137.png"),
    },
    houses: {
      clarte: atlas("mapTile_141.png"),
      creation: atlas("mapTile_147.png"),
      decision: atlas("mapTile_145.png"),
      ethique: atlas("mapTile_134.png"),
      townHall: atlas("mapTile_146.png"),
    },
    player: [
      atlas("mapTile_177.png"),
      atlas("mapTile_178.png"),
      atlas("mapTile_179.png"),
      atlas("mapTile_180.png"),
    ],
  },
};

function cloneTileset(source: Tileset): Tileset {
  return {
    ...source,
    map: {
      grass: [...source.map.grass] as TileCoord,
      path: [...source.map.path] as TileCoord,
      plaza: [...source.map.plaza] as TileCoord,
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
      grass: normalizeCoord(map.grass as TileCoord | undefined, base.map.grass),
      path: normalizeCoord(map.path as TileCoord | undefined, base.map.path),
      plaza: normalizeCoord(map.plaza as TileCoord | undefined, base.map.plaza),
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
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem("explorateur.tileset");
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<Tileset>;
          return mergeWithDefault(parsed);
        } catch {
          // ignore invalid cache
        }
      }
    }
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
  scale = TILE,
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
  const sourceX = isRect ? rect[0] : rect[0] * ts.size;
  const sourceY = isRect ? rect[1] : rect[1] * ts.size;
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
          imageRendering: "pixelated",
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

const WORLD_WIDTH = 60;
const WORLD_HEIGHT = 44;

function generateWorld(): number[][] {
  const map = Array.from({ length: WORLD_HEIGHT }, () =>
    Array.from({ length: WORLD_WIDTH }, () => TILE_KIND.GRASS)
  );

  const fillRect = (
    startX: number,
    startY: number,
    width: number,
    height: number,
    tile: TileKind
  ) => {
    for (let y = startY; y < startY + height; y++) {
      for (let x = startX; x < startX + width; x++) {
        if (map[y]?.[x] !== undefined) {
          map[y][x] = tile;
        }
      }
    }
  };

  const outlineRect = (
    startX: number,
    startY: number,
    width: number,
    height: number,
    tile: TileKind
  ) => {
    for (let x = startX; x < startX + width; x++) {
      if (map[startY]?.[x] !== undefined) map[startY][x] = tile;
      if (map[startY + height - 1]?.[x] !== undefined)
        map[startY + height - 1][x] = tile;
    }
    for (let y = startY; y < startY + height; y++) {
      if (map[y]?.[startX] !== undefined) map[y][startX] = tile;
      if (map[y]?.[startX + width - 1] !== undefined)
        map[y][startX + width - 1] = tile;
    }
  };

  const drawHorizontal = (
    startX: number,
    endX: number,
    y: number,
    tile: TileKind = TILE_KIND.PATH
  ) => {
    for (let x = startX; x <= endX; x++) {
      if (map[y]?.[x] !== undefined) {
        map[y][x] = tile;
      }
    }
  };

  const drawVertical = (
    startY: number,
    endY: number,
    x: number,
    tile: TileKind = TILE_KIND.PATH
  ) => {
    for (let y = startY; y <= endY; y++) {
      if (map[y]?.[x] !== undefined) {
        map[y][x] = tile;
      }
    }
  };

  const plantTree = (x: number, y: number) => {
    if (map[y]?.[x] !== undefined) {
      map[y][x] = TILE_KIND.TREE;
    }
  };

  const scatterTrees = (points: Array<[number, number]>) => {
    for (const [x, y] of points) {
      plantTree(x, y);
    }
  };

  const placeHouse = (x: number, y: number) => {
    if (map[y]?.[x] !== undefined) map[y][x] = TILE_KIND.ROOF_LEFT;
    if (map[y]?.[x + 1] !== undefined) map[y][x + 1] = TILE_KIND.ROOF_RIGHT;
    if (map[y + 1]?.[x] !== undefined) map[y + 1][x] = TILE_KIND.WALL_LEFT;
    if (map[y + 1]?.[x + 1] !== undefined)
      map[y + 1][x + 1] = TILE_KIND.WALL_RIGHT;
  };

  const placeHouseWithYard = (x: number, y: number) => {
    placeHouse(x, y);
    drawHorizontal(x - 1, x + 2, y + 2);
    if (map[y + 2]?.[x - 1] !== undefined)
      map[y + 2][x - 1] = TILE_KIND.FLOWER;
    if (map[y + 2]?.[x + 2] !== undefined)
      map[y + 2][x + 2] = TILE_KIND.FLOWER;
    plantTree(x - 1, y - 1);
    plantTree(x + 2, y - 1);
  };

  const placeGarden = (startX: number, startY: number) => {
    fillRect(startX, startY, 2, 2, TILE_KIND.FLOWER);
    plantTree(startX - 1, startY);
    plantTree(startX + 2, startY + 1);
  };

  const placeNeighborhood = (originX: number, originY: number) => {
    placeHouseWithYard(originX, originY);
    placeHouseWithYard(originX + 6, originY);
    placeHouseWithYard(originX, originY + 6);
    placeHouseWithYard(originX + 6, originY + 6);
    placeGarden(originX + 1, originY + 4);
    placeGarden(originX + 7, originY + 2);
  };

  // Surround the map with water and sand beaches
  for (let x = 0; x < WORLD_WIDTH; x++) {
    map[0][x] = TILE_KIND.WATER;
    map[WORLD_HEIGHT - 1][x] = TILE_KIND.WATER;
  }
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    map[y][0] = TILE_KIND.WATER;
    map[y][WORLD_WIDTH - 1] = TILE_KIND.WATER;
  }
  for (let x = 1; x < WORLD_WIDTH - 1; x++) {
    map[1][x] = TILE_KIND.SAND;
    map[WORLD_HEIGHT - 2][x] = TILE_KIND.SAND;
  }
  for (let y = 1; y < WORLD_HEIGHT - 1; y++) {
    map[y][1] = TILE_KIND.SAND;
    map[y][WORLD_WIDTH - 2] = TILE_KIND.SAND;
  }

  // Lakes and leisure areas
  fillRect(6, 5, 12, 5, TILE_KIND.WATER);
  outlineRect(5, 4, 14, 7, TILE_KIND.SAND);
  fillRect(44, 32, 10, 5, TILE_KIND.WATER);
  outlineRect(43, 31, 12, 7, TILE_KIND.SAND);

  // Farmland
  fillRect(8, 34, 12, 6, TILE_KIND.FIELD);
  drawHorizontal(7, 21, 34);
  drawHorizontal(7, 21, 39);
  drawVertical(34, 39, 7);
  drawVertical(34, 39, 21);
  scatterTrees([
    [6, 33],
    [22, 33],
    [6, 40],
    [22, 40],
  ]);

  // Road network connecting quarters
  drawHorizontal(4, WORLD_WIDTH - 5, 22);
  drawVertical(6, WORLD_HEIGHT - 7, 30);

  drawVertical(6, 20, 18);
  drawVertical(6, 20, 42);
  drawVertical(24, 38, 18);
  drawVertical(24, 38, 42);

  drawHorizontal(6, 24, 12);
  drawHorizontal(36, WORLD_WIDTH - 6, 12);
  drawHorizontal(6, 24, 32);
  drawHorizontal(36, WORLD_WIDTH - 6, 32);

  drawHorizontal(27, 33, 18);
  drawHorizontal(27, 33, 26);
  drawVertical(19, 25, 27);
  drawVertical(19, 25, 34);

  // Plazas for each quarter and central hub
  fillRect(10, 9, 10, 7, TILE_KIND.PLAZA);
  fillRect(40, 9, 10, 7, TILE_KIND.PLAZA);
  fillRect(10, 29, 10, 7, TILE_KIND.PLAZA);
  fillRect(40, 29, 10, 7, TILE_KIND.PLAZA);
  fillRect(26, 20, 10, 6, TILE_KIND.PLAZA);

  // Neighbourhood decorations
  placeNeighborhood(7, 5);
  placeNeighborhood(41, 5);
  placeNeighborhood(7, 25);
  placeNeighborhood(41, 25);

  scatterTrees([
    [26, 18],
    [35, 18],
    [26, 27],
    [35, 27],
    [30, 15],
    [30, 28],
    [18, 21],
    [42, 21],
  ]);

  placeGarden(24, 16);
  placeGarden(36, 16);
  placeGarden(24, 28);
  placeGarden(36, 28);

  return map;
}

const world = generateWorld();
const GRID_H = world.length;
const GRID_W = world[0]?.length ?? 0;

const buildings: Array<{
  id: QuarterId;
  x: number;
  y: number;
  label: string;
  color: string;
}> = [
  { id: "mairie", x: 30, y: 22, label: "Mairie (Bilan)", color: "#ffd166" },
  { id: "clarte", x: 14, y: 12, label: "Quartier Clarté", color: "#06d6a0" },
  { id: "creation", x: 44, y: 12, label: "Quartier Création", color: "#118ab2" },
  { id: "decision", x: 14, y: 32, label: "Quartier Décision", color: "#ef476f" },
  { id: "ethique", x: 44, y: 32, label: "Quartier Éthique", color: "#8338ec" },
];

const START = { x: 30, y: 24 };

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function PlayerSprite({ ts, step }: { ts: Tileset; step: number }) {
  if (ts.mode === "atlas" && ts.url) {
    const frame = ts.map.player[step % ts.map.player.length];
    return <SpriteFromAtlas ts={ts} coord={frame} />;
  }
  return (
    <div
      className="w-full h-full rounded-sm"
      style={{
        backgroundImage: `url(${SPR_PLAYER})`,
        backgroundSize: "cover",
        imageRendering: "pixelated",
      }}
    />
  );
}

function BuildingSprite({
  id,
  ts,
}: {
  id: QuarterId;
  ts: Tileset;
}) {
  if (ts.mode === "atlas" && ts.url) {
    const coord =
      id === "mairie"
        ? ts.map.houses.townHall
        : id === "clarte"
        ? ts.map.houses.clarte
        : id === "creation"
        ? ts.map.houses.creation
        : id === "decision"
        ? ts.map.houses.decision
        : ts.map.houses.ethique;
    return <SpriteFromAtlas ts={ts} coord={coord} />;
  }

  let src = SPR_HOUSE_GREEN;
  if (id === "creation") src = SPR_HOUSE_BLUE;
  else if (id === "decision") src = SPR_HOUSE_RED;
  else if (id === "ethique") src = SPR_HOUSE_PURP;
  else if (id === "mairie") src = SPR_TOWN_HALL;
  return (
    <div
      className="w-5 h-5"
      style={{
        backgroundImage: `url(${src})`,
        backgroundSize: "cover",
        imageRendering: "pixelated",
      }}
      aria-hidden
    />
  );
}

function isWalkable(x: number, y: number) {
  if (x < 0 || y < 0 || y >= world.length || x >= world[0].length) {
    return false;
  }
  const tile = world[y][x] as TileKind;
  return !BLOCKING_TILES.has(tile);
}

function DPad({ onMove }: { onMove: (dx: number, dy: number) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 select-none">
      <div />
      <button
        onClick={() => onMove(0, -1)}
        className="px-3 py-2 rounded-xl bg-white/80 hover:bg-white shadow text-sm"
        aria-label="Haut"
      >
        ▲
      </button>
      <div />
      <button
        onClick={() => onMove(-1, 0)}
        className="px-3 py-2 rounded-xl bg-white/80 hover:bg-white shadow text-sm"
        aria-label="Gauche"
      >
        ◀
      </button>
      <div />
      <button
        onClick={() => onMove(1, 0)}
        className="px-3 py-2 rounded-xl bg-white/80 hover:bg-white shadow text-sm"
        aria-label="Droite"
      >
        ▶
      </button>
      <div />
      <button
        onClick={() => onMove(0, 1)}
        className="px-3 py-2 rounded-xl bg-white/80 hover:bg-white shadow text-sm col-start-2"
        aria-label="Bas"
      >
        ▼
      </button>
      <div />
    </div>
  );
}

function BuiltinTile({ sprite }: { sprite: string }) {
  return (
    <div
      className="rounded-sm"
      style={{
        width: TILE,
        height: TILE,
        backgroundImage: `url(${sprite})`,
        backgroundSize: "cover",
        imageRendering: "pixelated",
      }}
    />
  );
}

function tileAt(x: number, y: number): TileKind | null {
  if (y < 0 || y >= world.length) {
    return null;
  }
  const row = world[y];
  if (!row || x < 0 || x >= row.length) {
    return null;
  }
  return row[x] as TileKind;
}

function getSandTileCoord(x: number, y: number, ts: Tileset): TileCoord {
  const northWater = tileAt(x, y - 1) === TILE_KIND.WATER;
  const southWater = tileAt(x, y + 1) === TILE_KIND.WATER;
  const westWater = tileAt(x - 1, y) === TILE_KIND.WATER;
  const eastWater = tileAt(x + 1, y) === TILE_KIND.WATER;

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

function getAtlasTile(
  tileKind: TileKind,
  ts: Tileset,
  x: number,
  y: number
): TileCoord | null {
  switch (tileKind) {
    case TILE_KIND.GRASS:
      return ts.map.grass;
    case TILE_KIND.PATH:
      return ts.map.path;
    case TILE_KIND.PLAZA:
      return ts.map.plaza;
    case TILE_KIND.WATER:
      return getWaterTileCoord(x, y, ts);
    case TILE_KIND.SAND:
      return getSandTileCoord(x, y, ts);
    case TILE_KIND.FIELD:
      return ts.map.farmland;
    case TILE_KIND.TREE:
      return ts.map.details.tree;
    case TILE_KIND.FLOWER:
      return ts.map.details.flower;
    case TILE_KIND.ROOF_LEFT:
    case TILE_KIND.WALL_LEFT:
      return ts.map.details.tree;
    case TILE_KIND.ROOF_RIGHT:
    case TILE_KIND.WALL_RIGHT:
      return ts.map.details.flower;
    default:
      return ts.map.grass;
  }
}

function TileWithTs({
  kind,
  ts,
  x,
  y,
}: {
  kind: number;
  ts: Tileset;
  x: number;
  y: number;
}) {
  const tileKind = (kind as TileKind) ?? TILE_KIND.GRASS;
  const definition =
    TILE_DEFINITIONS[tileKind] ?? TILE_DEFINITIONS[TILE_KIND.GRASS];
  if (ts.mode === "atlas" && ts.url) {
    const coord = getAtlasTile(tileKind, ts, x, y);
    if (coord) {
      return <SpriteFromAtlas ts={ts} coord={coord} scale={TILE} />;
    }
  }
  return <BuiltinTile sprite={definition.sprite} />;
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
      player.x * CELL_SIZE - container.clientWidth / 2 + TILE / 2,
      0,
      maxLeft
    );
    const targetTop = clamp(
      player.y * CELL_SIZE - container.clientHeight / 2 + TILE / 2,
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
  }, [player.x, player.y]);

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
    if (!isWalkable(nx, ny)) return;
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
      <div className="grid md:grid-cols-[minmax(0,1fr)_260px] gap-6">
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
            className="mt-4 overflow-auto rounded-xl border bg-emerald-50/60 shadow-inner"
            style={{ maxHeight: "60vh" }}
          >
            <div className="inline-block p-3">
              <div
                className="grid min-w-max"
                style={{
                  gridTemplateColumns: `repeat(${GRID_W}, ${TILE}px)`,
                  gridTemplateRows: `repeat(${GRID_H}, ${TILE}px)`,
                  gap: TILE_GAP,
                }}
              >
                {world.map((row, y) =>
                  row.map((tileKind, x) => {
                    const highlight = HIGHLIGHT_TILES.has(tileKind as TileKind);
                    return (
                      <div key={`${x}-${y}`} className="relative">
                        <TileWithTs kind={tileKind} ts={tileset} x={x} y={y} />
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
                                <BuildingSprite id={building.id} ts={tileset} />
                              </button>
                            )
                        )}
                        {player.x === x && player.y === y && (
                          <div className="absolute inset-1 animate-[float_1.2s_ease-in-out_infinite]">
                            <PlayerSprite ts={tileset} step={walkStep} />
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
              className="px-3 py-1 rounded-lg bg-slate-100 border"
            >
              Entrer
            </button>
          </div>
        </div>
        <aside className="space-y-4">
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
