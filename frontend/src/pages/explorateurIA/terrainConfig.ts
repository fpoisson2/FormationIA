import { TILE_KIND, type TileKind } from "./types";

type TerrainThemeConfig = {
  label: string;
  base: TileKind;
};

export const TERRAIN_THEMES = {
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

export type TerrainThemeId = keyof typeof TERRAIN_THEMES;

export function isTerrainThemeId(value: unknown): value is TerrainThemeId {
  return typeof value === "string" && value in TERRAIN_THEMES;
}

export const TERRAIN_THEME_ORDER: TerrainThemeId[] = [
  "sand",
  "grass",
  "dirt",
  "dirtGray",
  "snow",
];

export type { TerrainThemeConfig };
