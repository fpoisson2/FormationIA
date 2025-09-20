#!/usr/bin/env python3
"""Générer une carte focalisée sur la bordure d'une île."""

from __future__ import annotations

import argparse
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

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
DIRECTION_ORDER = ("north", "east", "south", "west")

BORDER_CANONICAL: Sequence[Tuple[Tuple[str, ...], Tuple[str, int]]] = (
    (("north",), ("mapTile_002.png", 0)),
    (("south",), ("mapTile_032.png", 0)),
    (("east",), ("mapTile_018.png", 0)),
    (("west",), ("mapTile_016.png", 0)),
    (("north", "west"), ("mapTile_001.png", 0)),
    (("north", "east"), ("mapTile_003.png", 0)),
    (("south", "west"), ("mapTile_031.png", 0)),
    (("south", "east"), ("mapTile_033.png", 0)),
)

CLIFF_CANONICAL: Sequence[Tuple[Tuple[str, ...], Tuple[str, int]]] = (
    (("north",), ("mapTile_067.png", 0)),
    (("south",), ("mapTile_097.png", 0)),
    (("east",), ("mapTile_083.png", 0)),
    (("west",), ("mapTile_081.png", 0)),
    (("north", "west"), ("mapTile_066.png", 0)),
    (("north", "east"), ("mapTile_068.png", 0)),
    (("south", "west"), ("mapTile_096.png", 0)),
    (("south", "east"), ("mapTile_098.png", 0)),
)

DEFAULT_BORDER = ("mapTile_002.png", 0)
DEFAULT_CLIFF = ("mapTile_097.png", 0)


@dataclass(frozen=True)
class OrientationTile:
    name: str
    rotation: int


def normalize_dirs(directions: Iterable[str]) -> Tuple[str, ...]:
    return tuple(sorted(directions, key=DIRECTION_ORDER.index))


def build_orientation_map(
    canonical: Sequence[Tuple[Tuple[str, ...], Tuple[str, int]]]
) -> Dict[Tuple[str, ...], OrientationTile]:
    mapping: Dict[Tuple[str, ...], OrientationTile] = {}
    for dirs, (tile_name, rotation) in canonical:
        mapping[normalize_dirs(dirs)] = OrientationTile(tile_name, rotation)
    return mapping
BORDER_MAP = build_orientation_map(BORDER_CANONICAL)
CLIFF_MAP = build_orientation_map(CLIFF_CANONICAL)


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


def compute_border_mask(inside: List[List[bool]]) -> List[List[bool]]:
    height = len(inside)
    width = len(inside[0]) if inside else 0
    border = [[False] * width for _ in range(height)]
    for y in range(height):
        for x in range(width):
            if not inside[y][x]:
                continue
            for dx, dy in CARDINAL_OFFSETS.values():
                nx, ny = x + dx, y + dy
                if nx < 0 or nx >= width or ny < 0 or ny >= height or not inside[ny][nx]:
                    border[y][x] = True
                    break
    return border


def classify_layers(
    inside: List[List[bool]],
    distances: List[List[float]],
    border: List[List[bool]],
) -> Tuple[List[List[bool]], List[List[bool]]]:
    height = len(inside)
    width = len(inside[0]) if inside else 0
    threshold = 0.68
    best_core: List[List[bool]] | None = None
    best_cliff: List[List[bool]] | None = None

    for _ in range(6):
        core_candidate = [
            [inside[y][x] and distances[y][x] <= threshold for x in range(width)]
            for y in range(height)
        ]
        core = [[False] * width for _ in range(height)]
        cliff = [[False] * width for _ in range(height)]
        core_count = 0
        cliff_count = 0
        for y in range(height):
            for x in range(width):
                if not inside[y][x] or border[y][x]:
                    continue
                if core_candidate[y][x]:
                    core[y][x] = True
                    core_count += 1
                    continue
                has_border_neighbor = False
                for dx, dy in CARDINAL_OFFSETS.values():
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height and border[ny][nx]:
                        has_border_neighbor = True
                        break
                if has_border_neighbor:
                    cliff[y][x] = True
                    cliff_count += 1
                else:
                    core[y][x] = True
                    core_count += 1
        if best_core is None:
            best_core = core
            best_cliff = cliff
        if core_count > 0 and cliff_count > 0:
            return core, cliff
        threshold += 0.05

    assert best_core is not None and best_cliff is not None
    # Garantir au moins une tuile de falaise
    if not any(value for row in best_cliff for value in row):
        for y in range(height):
            for x in range(width):
                if inside[y][x] and not border[y][x]:
                    best_cliff[y][x] = True
                    break
            if any(best_cliff[y]):
                break
    return best_core, best_cliff


def directions_towards(
    x: int,
    y: int,
    predicate,
    width: int,
    height: int,
) -> Tuple[str, ...]:
    dirs = []
    for name, (dx, dy) in CARDINAL_OFFSETS.items():
        nx, ny = x + dx, y + dy
        if predicate(nx, ny):
            dirs.append(name)
    return normalize_dirs(dirs)


def choose_tile(
    directions: Tuple[str, ...],
    orientation_map: Dict[Tuple[str, ...], OrientationTile],
    fallback: Tuple[str, int],
) -> OrientationTile:
    if directions in orientation_map:
        return orientation_map[directions]
    if len(directions) >= 1:
        reduced = (directions[0],)
        if reduced in orientation_map:
            return orientation_map[reduced]
    return OrientationTile(*fallback)


def iter_positions(mask: List[List[bool]]) -> Iterable[Tuple[int, int]]:
    for y, row in enumerate(mask):
        for x, value in enumerate(row):
            if value:
                yield x, y


def build_image(
    width: int,
    height: int,
    inside: List[List[bool]],
    border: List[List[bool]],
    core: List[List[bool]],
    cliff: List[List[bool]],
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

    for x, y in iter_positions(cliff):
        dirs = directions_towards(
            x,
            y,
            lambda nx, ny: 0 <= nx < width
            and 0 <= ny < height
            and border[ny][nx],
            width,
            height,
        )
        if not dirs:
            dirs = directions_towards(
                x,
                y,
                lambda nx, ny: nx < 0
                or nx >= width
                or ny < 0
                or ny >= height
                or not inside[ny][nx],
                width,
                height,
            )
        tile = choose_tile(dirs, CLIFF_MAP, DEFAULT_CLIFF)
        image = loader.get(tile.name, tile.rotation)
        canvas.paste(image, (x * tile_size, y * tile_size), image)

    for x, y in iter_positions(border):
        dirs = directions_towards(
            x,
            y,
            lambda nx, ny: nx < 0
            or nx >= width
            or ny < 0
            or ny >= height
            or not inside[ny][nx],
            width,
            height,
        )
        tile = choose_tile(dirs, BORDER_MAP, DEFAULT_BORDER)
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
    inside_mask, distances = generate_inside_mask(width, height, rng)

    if not any(value for row in inside_mask for value in row):
        raise SystemExit("Impossible de générer une île avec ces dimensions.")

    border_mask = compute_border_mask(inside_mask)
    core_mask, cliff_mask = classify_layers(inside_mask, distances, border_mask)

    loader = TileLoader(ASSET_DIR)
    image = build_image(
        width,
        height,
        inside_mask,
        border_mask,
        core_mask,
        cliff_mask,
        loader,
    )

    output = args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    print(f"Carte sauvegardée dans {output}")


if __name__ == "__main__":
    main()
