import { useMemo, type CSSProperties } from "react";

import mapPackAtlas from "../../assets/kenney_map-pack/Spritesheet/mapPack_spritesheet.png";
import mapPackAtlasDescription from "../../assets/kenney_map-pack/Spritesheet/mapPack_enriched.xml?raw";

export type TileCoord = [number, number] | [number, number, number, number];

interface AtlasEntry {
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

const DEFAULT_TILE_SIZE = 64;

function parseAtlasDescription(xml: string): Map<string, AtlasEntry> {
  const entries = new Map<string, AtlasEntry>();
  const subTextureRegex = /<SubTexture\s+([^>]+?)\s*\/>/g;
  let match: RegExpExecArray | null;

  while ((match = subTextureRegex.exec(xml)) !== null) {
    const attributeSource = match[1];
    const attributeRegex = /(\w+)="([^"]*)"/g;
    const attributes: Record<string, string> = {};

    let attributeMatch: RegExpExecArray | null;
    while ((attributeMatch = attributeRegex.exec(attributeSource)) !== null) {
      attributes[attributeMatch[1]] = attributeMatch[2];
    }

    const name = attributes.name;
    if (!name) {
      continue;
    }

    const x = Number.parseInt(attributes.x ?? "", 10);
    const y = Number.parseInt(attributes.y ?? "", 10);
    const width = Number.parseInt(attributes.width ?? "", 10);
    const height = Number.parseInt(attributes.height ?? "", 10);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    entries.set(name, {
      name,
      x,
      y,
      width: Number.isFinite(width) ? width : DEFAULT_TILE_SIZE,
      height: Number.isFinite(height) ? height : DEFAULT_TILE_SIZE,
    });
  }

  return entries;
}

const ATLAS_ENTRIES = parseAtlasDescription(mapPackAtlasDescription);

export function atlas(name: string): TileCoord {
  const entry = ATLAS_ENTRIES.get(name);
  if (!entry) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[clarity] Tuile manquante dans l'atlas: ${name}`);
    }
    return [0, 0, DEFAULT_TILE_SIZE, DEFAULT_TILE_SIZE];
  }
  return [
    entry.x,
    entry.y,
    entry.width ?? DEFAULT_TILE_SIZE,
    entry.height ?? DEFAULT_TILE_SIZE,
  ];
}

export interface SpriteFromAtlasProps {
  coord: TileCoord;
  scale: number;
  className?: string;
  style?: CSSProperties;
}

export function SpriteFromAtlas({
  coord,
  scale,
  className,
  style,
}: SpriteFromAtlasProps): JSX.Element | null {
  const [x, y, rawWidth, rawHeight] = coord;
  const width = rawWidth ?? DEFAULT_TILE_SIZE;
  const height = rawHeight ?? DEFAULT_TILE_SIZE;

  if (scale <= 0 || width <= 0 || height <= 0) {
    return null;
  }

  const zoomX = scale / width;
  const zoomY = scale / height;

  return (
    <div
      className={className}
      style={{
        width: scale,
        height: scale,
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          width,
          height,
          backgroundImage: `url(${mapPackAtlas})`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: `${-x}px ${-y}px`,
          imageRendering: "pixelated",
          transform: `scale(${zoomX}, ${zoomY})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}

export function useAtlasCoord(name: string): TileCoord {
  return useMemo(() => atlas(name), [name]);
}

export { DEFAULT_TILE_SIZE };
