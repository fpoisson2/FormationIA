#!/usr/bin/env python3
"""Générer une carte focalisée sur la bordure d'une île."""

from __future__ import annotations

import argparse
import math
import random
from collections import deque
from dataclasses import dataclass
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

CARDINAL_OFFSETS = {
    "north": (0, -1),
    "east": (1, 0),
    "south": (0, 1),
    "west": (-1, 0),
}

EDGE_TILE = "mapTile_002.png"
CORNER_TILE = "mapTile_003.png"
INTERIOR_CORNER_TILE = "mapTile_019.png"

ROTATION_BY_DIRECTION = {
    "north": 0,
    "east": 90,
    "south": 180,
    "west": 270,
    "northeast": 0,
    "southeast": 90,
    "southwest": 180,
    "northwest": 270,
}


@dataclass(frozen=True)
class OrientationTile:
    name: str
    rotation: int


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


def mask_to_island(inside: List[List[bool]]) -> set[tuple[int, int]]:
    island: set[tuple[int, int]] = set()
    for y, row in enumerate(inside):
        for x, value in enumerate(row):
            if value:
                island.add((x, y))
    return island


def find_outside_water(
    island: set[tuple[int, int]], width: int, height: int
) -> set[tuple[int, int]]:
    outside: set[tuple[int, int]] = set()
    visited: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()

    def enqueue(candidate: tuple[int, int]) -> None:
        if candidate in island or candidate in visited:
            return
        visited.add(candidate)
        outside.add(candidate)
        queue.append(candidate)

    for x in range(width):
        enqueue((x, 0))
        enqueue((x, height - 1))
    for y in range(height):
        enqueue((0, y))
        enqueue((width - 1, y))

    while queue:
        cx, cy = queue.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < width and 0 <= ny < height:
                enqueue((nx, ny))

    return outside


def classify_edge_cell(
    cell: tuple[int, int],
    island: set[tuple[int, int]],
    is_outside: bool,
) -> tuple[Tuple[str, ...], str] | None:
    x, y = cell
    north = (x, y - 1) in island
    south = (x, y + 1) in island
    east = (x + 1, y) in island
    west = (x - 1, y) in island
    northeast = (x + 1, y - 1) in island
    northwest = (x - 1, y - 1) in island
    southeast = (x + 1, y + 1) in island
    southwest = (x - 1, y + 1) in island

    if not (
        north
        or south
        or east
        or west
        or northeast
        or northwest
        or southeast
        or southwest
    ):
        return None

    if north and west and not south and not east:
        return (("southeast",), "exterior" if is_outside else "interior")
    if north and east and not south and not west:
        return (("southwest",), "exterior" if is_outside else "interior")
    if south and west and not north and not east:
        return (("northeast",), "exterior" if is_outside else "interior")
    if south and east and not north and not west:
        return (("northwest",), "exterior" if is_outside else "interior")

    if south:
        return (("north",), "exterior")
    if north:
        return (("south",), "exterior")
    if east:
        return (("west",), "exterior")
    if west:
        return (("east",), "exterior")

    if southwest:
        return (("northeast",), "exterior")
    if southeast:
        return (("northwest",), "exterior")
    if northwest:
        return (("southeast",), "exterior")
    if northeast:
        return (("southwest",), "exterior")

    return None


def compute_border_orientations(
    inside: List[List[bool]],
) -> Dict[tuple[int, int], tuple[Tuple[str, ...], str]]:
    height = len(inside)
    width = len(inside[0]) if inside else 0
    island = mask_to_island(inside)
    outside_water = find_outside_water(island, width, height)

    orientation_to_delta: Dict[str, tuple[int, int]] = {
        "north": (0, 1),
        "south": (0, -1),
        "east": (-1, 0),
        "west": (1, 0),
        "northeast": (-1, 1),
        "northwest": (1, 1),
        "southeast": (-1, -1),
        "southwest": (1, -1),
    }

    def priority(orientation: Tuple[str, ...], orientation_type: str) -> tuple[int, int]:
        direction = orientation[0] if orientation else ""
        is_diagonal = direction in {
            "northeast",
            "northwest",
            "southeast",
            "southwest",
        }
        diagonal_rank = 0 if is_diagonal else 1
        interior_rank = 0 if orientation_type == "interior" else 1
        return (diagonal_rank, interior_rank)

    candidates: set[tuple[int, int]] = set()
    for (x, y) in island:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in island:
                    candidates.add((nx, ny))

    by_island_cell: Dict[tuple[int, int], tuple[Tuple[str, ...], str]] = {}
    priorities: Dict[tuple[int, int], tuple[int, int]] = {}

    for (x, y) in sorted(candidates, key=lambda item: (item[1], item[0])):
        is_outside = (x, y) in outside_water
        classification = classify_edge_cell((x, y), island, is_outside)
        if not classification:
            continue
        orientation, orientation_type = classification
        if not orientation:
            continue
        direction = orientation[0]
        delta = orientation_to_delta.get(direction)
        if delta is None:
            continue
        target = (x + delta[0], y + delta[1])
        if target not in island:
            continue
        current_priority = priority(orientation, orientation_type)
        previous_priority = priorities.get(target)
        if previous_priority is not None and previous_priority <= current_priority:
            continue
        priorities[target] = current_priority
        by_island_cell[target] = (orientation, orientation_type)

    return by_island_cell


def select_border_tile(
    orientation: Tuple[str, ...], orientation_type: str
) -> OrientationTile:
    if not orientation:
        return OrientationTile(EDGE_TILE, 0)

    direction = orientation[0]
    rotation = ROTATION_BY_DIRECTION.get(direction, 0)

    if direction in {"north", "east", "south", "west"}:
        base = EDGE_TILE
    else:
        base = INTERIOR_CORNER_TILE if orientation_type == "interior" else CORNER_TILE

    return OrientationTile(base, rotation)


def compute_border_tiles(inside: List[List[bool]]) -> Dict[tuple[int, int], OrientationTile]:
    orientation_map = compute_border_orientations(inside)
    return {
        position: select_border_tile(orientation, orientation_type)
        for position, (orientation, orientation_type) in orientation_map.items()
    }


def build_image(
    width: int,
    height: int,
    inside: List[List[bool]],
    border_tiles: Dict[tuple[int, int], OrientationTile],
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

    for (x, y), tile in border_tiles.items():
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

    border_tiles = compute_border_tiles(inside_mask)

    loader = TileLoader(ASSET_DIR)
    image = build_image(
        width,
        height,
        inside_mask,
        border_tiles,
        loader,
    )

    output = args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    print(f"Carte sauvegardée dans {output}")


if __name__ == "__main__":
    main()
