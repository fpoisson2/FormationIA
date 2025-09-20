#!/usr/bin/env python3
"""Générer une carte focalisée sur la bordure d'une île."""

from __future__ import annotations

import argparse
import math
import random
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Dict, List, Tuple

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - dépend de l'environnement
    raise SystemExit("Pillow doit être installé (pip install pillow).") from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = (
    REPO_ROOT
    / "frontend"
    / "src"
    / "assets"
    / "kenney_map-pack"
    / "PNG"
)
DEFAULT_OUTPUT = REPO_ROOT / "generated_island_border.png"

WATER_TILE = "mapTile_187.png"
SAND_TILE = "mapTile_017.png"

CARDINAL_DIRECTIONS: Tuple[str, ...] = ("north", "east", "south", "west")
CARDINAL_OFFSETS = {
    "north": (0, -1),
    "east": (1, 0),
    "south": (0, 1),
    "west": (-1, 0),
}
DIAGONAL_DIRECTIONS: Tuple[str, ...] = (
    "northeast",
    "southeast",
    "southwest",
    "northwest",
)
DIAGONAL_OFFSETS = {
    "northeast": (1, -1),
    "southeast": (1, 1),
    "southwest": (-1, 1),
    "northwest": (-1, -1),
}
NEIGHBOR_OFFSETS = {**CARDINAL_OFFSETS, **DIAGONAL_OFFSETS}

@dataclass(frozen=True)
class OrientationTile:
    name: str
    rotation: int


class TileCategory(Enum):
    INTERIOR = "interior"
    BORDER = "border"
    INNER_CORNER = "inner_corner"
    CLIFF = "cliff"


@dataclass(frozen=True)
class TilePlacement:
    category: TileCategory
    orientation: str | None


BORDER_SPRITES: Dict[str, OrientationTile] = {
    "north": OrientationTile("mapTile_002.png", 0),
    "northeast": OrientationTile("mapTile_003.png", 0),
    "east": OrientationTile("mapTile_018.png", 0),
    "southeast": OrientationTile("mapTile_003.png", 90),
    "south": OrientationTile("mapTile_002.png", 180),
    "southwest": OrientationTile("mapTile_003.png", 180),
    "west": OrientationTile("mapTile_016.png", 0),
    "northwest": OrientationTile("mapTile_003.png", 270),
}

INNER_CORNER_SPRITES: Dict[str, OrientationTile] = {
    "northeast": OrientationTile("mapTile_019.png", 0),
    "northwest": OrientationTile("mapTile_020.png", 0),
    "southwest": OrientationTile("mapTile_019.png", 180),
    "southeast": OrientationTile("mapTile_020.png", 180),
}

CLIFF_SPRITES: Dict[str, OrientationTile] = {
    "north": OrientationTile("mapTile_032.png", 180),
    "east": OrientationTile("mapTile_032.png", 270),
    "south": OrientationTile("mapTile_032.png", 0),
    "west": OrientationTile("mapTile_032.png", 90),
}

TILE_LOOKUP: Dict[TileCategory, Dict[str, OrientationTile]] = {
    TileCategory.BORDER: BORDER_SPRITES,
    TileCategory.INNER_CORNER: INNER_CORNER_SPRITES,
    TileCategory.CLIFF: CLIFF_SPRITES,
}

OPPOSITE_DIRECTION = {
    "north": "south",
    "south": "north",
    "east": "west",
    "west": "east",
}

PERPENDICULAR_DIRECTIONS = {
    "north": ("east", "west"),
    "south": ("east", "west"),
    "east": ("north", "south"),
    "west": ("north", "south"),
}

INNER_CORNER_RULES = {
    "northeast": ("north", "east", "northeast"),
    "northwest": ("north", "west", "northwest"),
    "southeast": ("south", "east", "southeast"),
    "southwest": ("south", "west", "southwest"),
}

OUTER_CORNER_RULES = {
    "northeast": ("north", "east"),
    "southeast": ("south", "east"),
    "southwest": ("south", "west"),
    "northwest": ("north", "west"),
}


class TileLoader:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.cache: Dict[Tuple[str, int], Image.Image] = {}

    def _load_base(self, name: str) -> Image.Image:
        key = (name, 0)
        if key not in self.cache:
            path = self.base_dir / name
            if not path.exists():
                raise FileNotFoundError(f"Tuile introuvable : {path}")
            self.cache[key] = Image.open(path).convert("RGBA")
        return self.cache[key]

    def get(self, name: str, rotation: int = 0) -> Image.Image:
        rotation %= 360
        key = (name, rotation)
        if key in self.cache:
            return self.cache[key]

        base = self._load_base(name)
        if rotation == 0:
            self.cache[key] = base
        elif rotation == 90:
            self.cache[key] = base.transpose(Image.Transpose.ROTATE_90)
        elif rotation == 180:
            self.cache[key] = base.transpose(Image.Transpose.ROTATE_180)
        elif rotation == 270:
            self.cache[key] = base.transpose(Image.Transpose.ROTATE_270)
        else:  # pragma: no cover - n'arrive pas avec rotation multiple de 90°
            raise ValueError(f"Rotation non supportée : {rotation}")
        return self.cache[key]


def prune_narrow_features(mask: List[List[bool]]) -> None:
    height = len(mask)
    width = len(mask[0]) if mask else 0
    changed = True
    while changed:
        changed = False
        to_remove: List[Tuple[int, int]] = []
        for y in range(height):
            for x in range(width):
                if not mask[y][x]:
                    continue
                inside_neighbors = 0
                outside_neighbors = 0
                for dx, dy in CARDINAL_OFFSETS.values():
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height:
                        if mask[ny][nx]:
                            inside_neighbors += 1
                        else:
                            outside_neighbors += 1
                    else:
                        outside_neighbors += 1
                if inside_neighbors <= 1 or outside_neighbors >= 3:
                    to_remove.append((x, y))
        if to_remove:
            changed = True
            for x, y in to_remove:
                mask[y][x] = False


def generate_inside_mask(
    width: int, height: int, rng: random.Random
) -> Tuple[List[List[bool]], List[List[float]]]:
    center_x = width / 2
    center_y = height / 2
    margin_x = max(3.0, width * 0.18)
    margin_y = max(3.0, height * 0.18)
    radius_x = max(2.5, (width - margin_x) / 2)
    radius_y = max(2.5, (height - margin_y) / 2)

    amplitudes = (
        rng.uniform(0.12, 0.18),
        rng.uniform(0.05, 0.12),
        rng.uniform(0.04, 0.09),
    )
    phases = (
        rng.uniform(0, math.tau),
        rng.uniform(0, math.tau),
        rng.uniform(0, math.tau),
    )

    distances: List[List[float]] = [[0.0] * width for _ in range(height)]
    mask: List[List[bool]] = [[False] * width for _ in range(height)]

    for y in range(height):
        for x in range(width):
            dx = (x + 0.5) - center_x
            dy = (y + 0.5) - center_y
            angle = math.atan2(dy, dx)
            scale = 1.0
            for amp, phase, frequency in zip(amplitudes, phases, (1, 2, 3)):
                scale += amp * math.sin(frequency * angle + phase)
            scale = max(0.65, scale)
            nx = dx / (radius_x * scale)
            ny = dy / (radius_y * scale)
            distance = math.hypot(nx, ny)
            distances[y][x] = distance
            if distance <= 1.0:
                mask[y][x] = True

    prune_narrow_features(mask)
    return mask, distances


def gather_neighbors(
    inside: List[List[bool]],
    x: int,
    y: int,
) -> Dict[str, bool]:
    height = len(inside)
    width = len(inside[0]) if height else 0
    neighbors: Dict[str, bool] = {}
    for direction, (dx, dy) in NEIGHBOR_OFFSETS.items():
        nx, ny = x + dx, y + dy
        if 0 <= nx < width and 0 <= ny < height:
            neighbors[direction] = inside[ny][nx]
        else:
            neighbors[direction] = False
    return neighbors


def classify_land_cell(inside: List[List[bool]], x: int, y: int) -> TilePlacement:
    if not inside[y][x]:
        return TilePlacement(TileCategory.INTERIOR, None)

    neighbors = gather_neighbors(inside, x, y)

    if all(
        neighbors.get(direction, True)
        for direction in (*CARDINAL_DIRECTIONS, *DIAGONAL_DIRECTIONS)
    ):
        return TilePlacement(TileCategory.INTERIOR, None)

    for orientation in ("northeast", "northwest", "southeast", "southwest"):
        card_a, card_b, diag = INNER_CORNER_RULES[orientation]
        if neighbors[card_a] and neighbors[card_b] and not neighbors[diag]:
            return TilePlacement(TileCategory.INNER_CORNER, orientation)

    for orientation in CARDINAL_DIRECTIONS:
        if not neighbors[orientation]:
            opposite = OPPOSITE_DIRECTION[orientation]
            perpendicular = PERPENDICULAR_DIRECTIONS[orientation]
            if neighbors[opposite] and all(neighbors[p] for p in perpendicular):
                return TilePlacement(TileCategory.CLIFF, orientation)

    for orientation in ("northeast", "southeast", "southwest", "northwest"):
        card_a, card_b = OUTER_CORNER_RULES[orientation]
        if not neighbors[card_a] and not neighbors[card_b]:
            return TilePlacement(TileCategory.BORDER, orientation)

    for orientation in CARDINAL_DIRECTIONS:
        if not neighbors[orientation]:
            return TilePlacement(TileCategory.BORDER, orientation)

    for orientation in DIAGONAL_DIRECTIONS:
        if not neighbors[orientation]:
            return TilePlacement(TileCategory.BORDER, orientation)

    return TilePlacement(TileCategory.INTERIOR, None)


def compute_overlay_tiles(inside: List[List[bool]]) -> Dict[tuple[int, int], OrientationTile]:
    overlays: Dict[tuple[int, int], OrientationTile] = {}
    for y, row in enumerate(inside):
        for x, is_land in enumerate(row):
            if not is_land:
                continue
            placement = classify_land_cell(inside, x, y)
            if placement.category is TileCategory.INTERIOR:
                continue
            if placement.orientation is None:
                continue
            sprite_map = TILE_LOOKUP.get(placement.category)
            if not sprite_map:
                continue
            tile = sprite_map.get(placement.orientation)
            if tile:
                overlays[(x, y)] = tile
    return overlays


def build_image(
    width: int,
    height: int,
    inside: List[List[bool]],
    overlay_tiles: Dict[tuple[int, int], OrientationTile],
    loader: TileLoader,
) -> Image.Image:
    base_tile = loader.get(WATER_TILE)
    tile_size = base_tile.width
    canvas = Image.new("RGBA", (width * tile_size, height * tile_size))

    sand_tile = loader.get(SAND_TILE)

    for y in range(height):
        for x in range(width):
            px = x * tile_size
            py = y * tile_size
            canvas.paste(base_tile, (px, py))
            if inside[y][x]:
                canvas.paste(sand_tile, (px, py))

    for (x, y), tile in overlay_tiles.items():
        image = loader.get(tile.name, tile.rotation)
        canvas.paste(image, (x * tile_size, y * tile_size), image)

    return canvas


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Assembler une bordure d'île continue en PNG."
    )
    parser.add_argument("width", type=int, help="Largeur de la carte en tuiles.")
    parser.add_argument(
        "height",
        type=int,
        nargs="?",
        help="Hauteur de la carte en tuiles (défaut : largeur).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Graine optionnelle pour obtenir un résultat reproductible.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Chemin du fichier généré (défaut : {DEFAULT_OUTPUT}).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    width = args.width
    height = args.height or width

    if width < 8 or height < 8:
        raise SystemExit("La carte doit mesurer au moins 8×8 tuiles.")

    rng = random.Random(args.seed)
    inside_mask, _ = generate_inside_mask(width, height, rng)

    if not any(value for row in inside_mask for value in row):
        raise SystemExit("Impossible de générer une île avec ces dimensions.")

    overlay_tiles = compute_overlay_tiles(inside_mask)

    loader = TileLoader(ASSET_DIR)
    image = build_image(
        width,
        height,
        inside_mask,
        overlay_tiles,
        loader,
    )

    output = args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    print(f"Carte sauvegardée dans {output}")


if __name__ == "__main__":
    main()
