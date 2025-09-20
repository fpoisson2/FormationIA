#!/usr/bin/env python3
"""Assembler automatiquement une île respectant les consignes de construction.

Le script génère une carte rectangulaire (`size` × `height`) à partir des
subtextures décrites dans ``mapPack_enriched.xml``. Il applique
successionnellement :

1. un fond aquatique,
2. une île d’un matériau unique choisi aléatoirement (ou via `--material`),
3. un contour de bordures ou de falaises (`--edge-style`),
4. un trajet continu jalonné de chiffres (`--numbers`),
5. des arbres ou objets décoratifs (`--objects`).

Le script n’est **pas** exécuté automatiquement ; lancez-le manuellement
après avoir installé Pillow si vous souhaitez générer un rendu.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
import random
import re
import sys
from typing import Dict, Iterable, Iterator, List, Tuple
import xml.etree.ElementTree as ET

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - dépend de l'environnement d'exécution
    raise SystemExit(
        "Pillow doit être installé pour exécuter ce script (pip install Pillow)."
    ) from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
XML_PATH = (
    REPO_ROOT
    / "frontend"
    / "src"
    / "assets"
    / "kenney_map-pack"
    / "Spritesheet"
    / "mapPack_enriched.xml"
)
PNG_DIR = REPO_ROOT / "frontend" / "src" / "assets" / "kenney_map-pack" / "PNG"
DEFAULT_OUTPUT = REPO_ROOT / "generated_map.png"
DEFAULT_BACKGROUND = "mapTile_187.png"  # eau

DEFAULT_MATERIAL_SUBTYPES = (
    "sand",
    "grass",
    "dirt",
    "dirt_gray",
    "dirt_brown",
    "ice",
)

EDGE_STYLES = ("auto", "bordure", "falaise")


CARDINALS = ("north", "east", "south", "west")
OPPOSITE = {"north": "south", "south": "north", "east": "west", "west": "east"}
DIAGONAL_LOOKUP: Dict[Tuple[str, str], Tuple[str, ...]] = {
    tuple(sorted(("north", "east"))): ("northeast",),
    tuple(sorted(("north", "west"))): ("northwest",),
    tuple(sorted(("south", "east"))): ("southeast",),
    tuple(sorted(("south", "west"))): ("southwest",),
}


@dataclass(frozen=True)
class Texture:
    """Représente une tuile issue du XML enrichi."""

    name: str
    width: int
    height: int
    category: str
    type: str | None
    subtype: str | None
    connections: Tuple[str, ...]
    walkable: bool
    overlay: bool
    description: str | None


def parse_connections(raw: str | None) -> Tuple[str, ...]:
    """Transforme la chaîne de directions en tuple trié."""

    if not raw:
        return tuple()
    parts = [part.strip() for part in raw.split(",") if part.strip()]
    return tuple(sorted(parts))


def load_textures() -> Dict[str, Texture]:
    """Charge toutes les sous-textures décrites par le XML enrichi."""

    if not XML_PATH.exists():
        raise FileNotFoundError(f"Fichier XML introuvable : {XML_PATH}")

    tree = ET.parse(XML_PATH)
    root = tree.getroot()
    textures: Dict[str, Texture] = {}

    for node in root.findall("SubTexture"):
        name = node.get("name")
        if not name:
            continue

        width = int(node.get("width", "0"))
        height = int(node.get("height", "0"))
        category = node.get("category", "")
        tex_type = node.get("type")
        subtype = node.get("subtype")
        connections = parse_connections(node.get("connections"))
        walkable = node.get("walkable", "false").lower() == "true"
        overlay = node.get("overlay", "false").lower() == "true"
        description = node.get("desc")

        textures[name] = Texture(
            name=name,
            width=width,
            height=height,
            category=category,
            type=tex_type,
            subtype=subtype,
            connections=connections,
            walkable=walkable,
            overlay=overlay,
            description=description,
        )

    return textures


def build_path_index(textures: Dict[str, Texture], style: str) -> Dict[Tuple[str, ...], str]:
    """Retourne une correspondance entre connexions et nom de tuile de chemin."""

    index: Dict[Tuple[str, ...], list[str]] = {}

    for texture in textures.values():
        if texture.category != "path":
            continue

        is_bubble = texture.type == "bulle_verte"

        if style == "standard" and is_bubble:
            continue
        if style == "bulle_verte" and not is_bubble:
            continue

        if not texture.connections:
            continue

        index.setdefault(texture.connections, []).append(texture.name)

    return {key: sorted(names)[0] for key, names in index.items()}


def collect_material_tiles(textures: Dict[str, Texture]) -> Dict[str, Texture]:
    """Retourne les matériaux pleins indexés par leur sous-type."""

    materials: Dict[str, Texture] = {}
    for texture in textures.values():
        if texture.category != "terrain":
            continue
        type_tokens = (texture.type or "").split()
        if "material" not in type_tokens:
            continue
        if not texture.subtype:
            continue
        materials[texture.subtype] = texture
    return materials


def collect_edge_tiles(
    textures: Dict[str, Texture],
    include_bordure: bool,
    include_falaise: bool,
) -> Dict[str | None, Dict[Tuple[str, ...], str]]:
    """Indexe les tuiles de bordure/falaise par sous-type et orientation."""

    result: Dict[str | None, Dict[Tuple[str, ...], str]] = {}
    for texture in textures.values():
        if texture.category != "terrain":
            continue
        if not texture.connections or not texture.subtype:
            continue

        type_tokens = (texture.type or "").split()
        if include_falaise and "falaise" in type_tokens:
            result.setdefault(texture.subtype, {})[texture.connections] = texture.name
        elif include_bordure and (
            "bordure" in type_tokens
            or ("coin_interieur" in type_tokens and "falaise" not in type_tokens)
        ):
            result.setdefault(texture.subtype, {})[texture.connections] = texture.name

    return result


NUMBER_PATTERN = re.compile(r"(\d+)")


def collect_number_tiles(textures: Dict[str, Texture]) -> List[str]:
    """Classe les chiffres marchables par ordre croissant."""

    numbers: List[tuple[int, str]] = []
    for texture in textures.values():
        if texture.subtype != "number" or not texture.walkable:
            continue
        if texture.description:
            match = NUMBER_PATTERN.search(texture.description)
        else:
            match = NUMBER_PATTERN.search(texture.name)
        if not match:
            continue
        value = int(match.group(1))
        numbers.append((value, texture.name))

    numbers.sort(key=lambda item: item[0])
    return [name for _, name in numbers]


def collect_object_tiles(textures: Dict[str, Texture]) -> List[str]:
    """Recense les objets décoratifs superposables (arbres, rochers, etc.)."""

    objects: List[str] = []
    for texture in textures.values():
        if texture.category != "object":
            continue
        if not texture.overlay or texture.walkable:
            continue
        objects.append(texture.name)
    return sorted(objects)


class TileLibrary:
    """Charge et met en cache les images PNG individuelles."""

    def __init__(self, directory: Path) -> None:
        self._directory = directory
        self._cache: Dict[str, Image.Image] = {}

    def get(self, name: str) -> Image.Image:
        if name not in self._cache:
            path = self._directory / name
            if not path.exists():
                raise FileNotFoundError(f"Fichier PNG introuvable : {path}")
            with Image.open(path) as image:
                self._cache[name] = image.copy()
        return self._cache[name]


def determine_neighbors(x: int, y: int, path_cells: set[tuple[int, int]]) -> Tuple[str, ...]:
    """Calcule la liste triée des directions de sortie depuis une case chemin."""

    neighbors = []
    if (x, y - 1) in path_cells:
        neighbors.append("north")
    if (x + 1, y) in path_cells:
        neighbors.append("east")
    if (x, y + 1) in path_cells:
        neighbors.append("south")
    if (x - 1, y) in path_cells:
        neighbors.append("west")

    if not neighbors:
        # Cas dégénéré (ex. carte 1×1) : on force un visuel en croix.
        return tuple(CARDINALS)

    return tuple(sorted(neighbors))


def pick_material_subtype(
    materials: Dict[str, Texture],
    requested: str | None,
    rng: random.Random,
) -> str:
    """Choisit le matériau de l'île (optionnellement imposé)."""

    available = sorted(materials)
    if not available:
        raise SystemExit("Aucun matériau plein n'est disponible dans le XML.")

    if requested:
        if requested not in materials:
            raise SystemExit(
                "Sous-type de matériau inconnu. Choisissez parmi : "
                + ", ".join(available)
            )
        return requested

    # Favorise les sous-types courants définis en tête.
    for subtype in DEFAULT_MATERIAL_SUBTYPES:
        if subtype in materials:
            return subtype

    return rng.choice(available)


def generate_island(
    width: int,
    height: int,
    rng: random.Random,
    target_ratio: tuple[float, float] = (0.25, 0.4),
) -> set[tuple[int, int]]:
    """Crée une forme organique connectée pour l'île."""

    if width < 3 or height < 3:
        raise SystemExit("La carte doit mesurer au moins 3×3 pour accueillir une île.")

    min_cells = int(width * height * target_ratio[0])
    max_cells = int(width * height * target_ratio[1])
    target_size = max(4, rng.randint(min_cells, max(max_cells, min_cells + 1)))
    target_size = min(target_size, width * height - 1)

    center = (width // 2, height // 2)
    island: set[tuple[int, int]] = {center}
    frontier: set[tuple[int, int]] = set()

    def neighbors(cell: tuple[int, int]) -> Iterator[tuple[int, int]]:
        x, y = cell
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 1 <= nx < width - 1 and 1 <= ny < height - 1:
                yield nx, ny

    frontier.update(neighbors(center))

    attempts = 0
    while len(island) < target_size and attempts < width * height * 10:
        if not frontier:
            # Recharge la frontière autour de l'île courante.
            for cell in list(island):
                frontier.update(neighbors(cell))
            frontier.difference_update(island)
            if not frontier:
                break

        candidate = rng.choice(tuple(frontier))
        frontier.remove(candidate)

        # Bias vers le centre pour éviter les formes trop étalées.
        weight = 1.0 - (
            abs(candidate[0] - center[0]) / max(1, width)
            + abs(candidate[1] - center[1]) / max(1, height)
        )
        if rng.random() < max(0.15, weight):
            island.add(candidate)
            frontier.update(neighbors(candidate))
            frontier.difference_update(island)
        attempts += 1

    return island


def build_neighbor_map(cells: set[tuple[int, int]]) -> Dict[tuple[int, int], list[tuple[int, int]]]:
    """Construit les voisins cardinal des cellules données."""

    neighbor_map: Dict[tuple[int, int], list[tuple[int, int]]] = {}
    for (x, y) in cells:
        adjacents: list[tuple[int, int]] = []
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            candidate = (x + dx, y + dy)
            if candidate in cells:
                adjacents.append(candidate)
        neighbor_map[(x, y)] = adjacents
    return neighbor_map


def carve_path(
    island_cells: set[tuple[int, int]],
    desired_length: int,
    rng: random.Random,
) -> List[tuple[int, int]]:
    """Recherche un chemin simple de longueur donnée sur l'île."""

    neighbor_map = build_neighbor_map(island_cells)
    cells = [cell for cell, neighbors in neighbor_map.items() if neighbors]
    if not cells:
        return []

    length = min(desired_length, len(cells))
    min_length = 1

    for current_length in range(length, min_length - 1, -1):
        for _ in range(200):
            start = rng.choice(cells)
            stack: List[tuple[tuple[int, int], list[tuple[int, int]]]] = [
                (start, rng.sample(neighbor_map[start], len(neighbor_map[start])))
            ]
            path = [start]
            visited = {start}

            while stack:
                if len(path) >= current_length:
                    return path

                node, options = stack[-1]
                while options and options[-1] in visited:
                    options.pop()

                if not options:
                    stack.pop()
                    if stack:
                        path.pop()
                    continue

                nxt = options.pop()
                visited.add(nxt)
                path.append(nxt)
                stack[-1] = (node, options)
                stack.append(
                    (
                        nxt,
                        rng.sample(
                            neighbor_map[nxt], len(neighbor_map[nxt])
                        ),
                    )
                )

        # Réduit légèrement la cible si la topologie est trop contraignante.
    # Aucun chemin trouvé : on renvoie un chemin minimal basé sur les cellules disponibles.
    return [cells[0]]


def distribute_indices(total: int, count: int) -> List[int]:
    """Retourne des indices répartis uniformément sur une séquence."""

    if count <= 0:
        return []
    if count == 1 or total == 1:
        return [0]
    step = (total - 1) / (count - 1)
    return [round(i * step) for i in range(count)]


def choose_edge_tile(
    subtype: str,
    orientation: Tuple[str, ...],
    preferred_style: str,
    bordure_tiles: Dict[str | None, Dict[Tuple[str, ...], str]],
    falaise_tiles: Dict[str | None, Dict[Tuple[str, ...], str]],
) -> str | None:
    """Sélectionne la tuile de contour appropriée avec repli."""

    lookup_order: List[Dict[str | None, Dict[Tuple[str, ...], str]]] = []
    if preferred_style == "falaise":
        lookup_order = [falaise_tiles, bordure_tiles]
    elif preferred_style == "bordure":
        lookup_order = [bordure_tiles, falaise_tiles]
    else:  # auto
        lookup_order = [falaise_tiles, bordure_tiles]

    for index in lookup_order:
        by_subtype = index.get(subtype) or {}
        if orientation in by_subtype:
            return by_subtype[orientation]

    return None


def _orient_from_directions(directions: set[str]) -> Tuple[str, ...] | None:
    """Déduit l'orientation d'une tuile à partir des côtés touchant l'île."""

    if not directions:
        return None

    opposite_dirs = {OPPOSITE[direction] for direction in directions}
    if len(opposite_dirs) == 1:
        return (next(iter(opposite_dirs)),)

    diag_key = tuple(sorted(opposite_dirs))
    if diag_key in DIAGONAL_LOOKUP:
        return DIAGONAL_LOOKUP[diag_key]

    # Cas dégénérés : privilégie une direction déterministe pour éviter les trous.
    return (sorted(opposite_dirs)[0],)


def compute_island_edges(
    island: set[tuple[int, int]],
    subtype: str,
    preferred_style: str,
    bordure_tiles: Dict[str | None, Dict[Tuple[str, ...], str]],
    falaise_tiles: Dict[str | None, Dict[Tuple[str, ...], str]],
    width: int,
    height: int,
) -> List[tuple[str, tuple[int, int]]]:
    """Calcule les tuiles de contour à superposer sur l'eau autour de l'île."""

    water_adjacency: Dict[tuple[int, int], set[str]] = defaultdict(set)

    for (x, y) in island:
        cardinal_neighbors = {
            "north": (x, y - 1),
            "east": (x + 1, y),
            "south": (x, y + 1),
            "west": (x - 1, y),
        }

        for direction, (nx, ny) in cardinal_neighbors.items():
            if not (0 <= nx < width and 0 <= ny < height):
                continue
            if (nx, ny) in island:
                continue
            water_adjacency[(nx, ny)].add(OPPOSITE[direction])

        diagonal_specs = (
            ("north", "east", (x + 1, y - 1), ("south", "west")),
            ("north", "west", (x - 1, y - 1), ("south", "east")),
            ("south", "east", (x + 1, y + 1), ("north", "west")),
            ("south", "west", (x - 1, y + 1), ("north", "east")),
        )

        for dir_a, dir_b, (dx, dy), contributions in diagonal_specs:
            if not (0 <= dx < width and 0 <= dy < height):
                continue
            if cardinal_neighbors[dir_a] in island or cardinal_neighbors[dir_b] in island:
                continue
            water_adjacency[(dx, dy)].update(contributions)

    overlays: List[tuple[str, tuple[int, int]]] = []
    for coord, touching in water_adjacency.items():
        orientation = _orient_from_directions(touching)
        if not orientation:
            continue

        tile = choose_edge_tile(
            subtype,
            orientation,
            preferred_style,
            bordure_tiles,
            falaise_tiles,
        )
        if tile:
            overlays.append((tile, coord))

    return overlays


def assemble_map(
    width: int,
    height: int,
    textures: Dict[str, Texture],
    path_style: str,
    background_tile: str,
    output_path: Path,
    material_subtype: str | None,
    edge_style: str,
    numbers_requested: int | None,
    object_count: int | None,
    seed: int | None,
) -> None:
    """Compose une île respectant les étapes de construction demandées."""

    if width <= 0 or height <= 0:
        raise ValueError("La taille doit être strictement positive.")

    if background_tile not in textures:
        raise KeyError(f"Tuile d'arrière-plan inconnue : {background_tile}")

    background = textures[background_tile]
    if background.width <= 0 or background.height <= 0:
        raise ValueError(
            f"Dimensions invalides pour {background_tile} : {background.width}×{background.height}"
        )

    if background.width != background.height:
        raise ValueError("Les tuiles doivent être carrées pour cet assembleur.")

    rng = random.Random(seed)

    materials = collect_material_tiles(textures)
    chosen_material = pick_material_subtype(materials, material_subtype, rng)
    material_tile = materials[chosen_material]

    bordure_tiles = collect_edge_tiles(textures, include_bordure=True, include_falaise=False)
    falaise_tiles = collect_edge_tiles(textures, include_bordure=False, include_falaise=True)

    island_cells = generate_island(width, height, rng)

    tile_size = background.width
    path_index = build_path_index(textures, path_style)
    library = TileLibrary(PNG_DIR)

    canvas = Image.new("RGBA", (width * tile_size, height * tile_size))

    background_image = library.get(background_tile)
    for y in range(height):
        for x in range(width):
            canvas.paste(background_image, (x * tile_size, y * tile_size))

    # Remplit l'île avec le matériau choisi.
    material_image = library.get(material_tile.name)
    for (x, y) in island_cells:
        canvas.paste(material_image, (x * tile_size, y * tile_size))

    # Ajoute le contour (falaise ou bordure).
    edge_overlays = compute_island_edges(
        island_cells,
        chosen_material,
        edge_style,
        bordure_tiles,
        falaise_tiles,
        width,
        height,
    )
    for tile_name, (x, y) in edge_overlays:
        tile_image = library.get(tile_name)
        canvas.paste(tile_image, (x * tile_size, y * tile_size), tile_image)

    # Génère un trajet continu à l'intérieur de l'île.
    if numbers_requested is None:
        numbers_requested = max(4, (width + height) // 2)

    numbers_available = collect_number_tiles(textures)
    if not numbers_available:
        raise SystemExit("Aucun chiffre marchable n'a été trouvé dans le XML.")

    desired_length = min(len(island_cells), max(numbers_requested, (width + height) // 2))
    path_cells_list = carve_path(island_cells, desired_length, rng)
    path_cells = set(path_cells_list)

    for (x, y) in path_cells_list:
        neighbors = determine_neighbors(x, y, path_cells)
        try:
            tile_name = path_index[neighbors]
        except KeyError as exc:  # pragma: no cover - dépend de la complétude du XML
            raise SystemExit(
                "Aucune tuile de chemin ne correspond aux connexions "
                f"{neighbors}. Vérifiez le XML ou ajustez le style."
            ) from exc

        tile_image = library.get(tile_name)
        canvas.paste(tile_image, (x * tile_size, y * tile_size), tile_image)

    # Positionne les chiffres le long du trajet.
    digit_positions: List[tuple[int, int]] = []
    indices = distribute_indices(len(path_cells_list), min(numbers_requested, len(numbers_available)))
    for index in indices:
        if 0 <= index < len(path_cells_list):
            digit_positions.append(path_cells_list[index])

    for position, tile_name in zip(digit_positions, numbers_available):
        x, y = position
        tile_image = library.get(tile_name)
        canvas.paste(tile_image, (x * tile_size, y * tile_size), tile_image)

    # Ajoute des arbres ou objets décoratifs.
    decorative_tiles = collect_object_tiles(textures)
    if not decorative_tiles:
        raise SystemExit("Aucun objet décoratif disponible pour agrémenter l'île.")

    if object_count is None:
        object_count = max(1, len(island_cells) // 12)

    available_slots = [cell for cell in island_cells if cell not in path_cells]
    rng.shuffle(available_slots)
    placed = 0
    for cell in available_slots:
        if placed >= object_count:
            break
        tile_name = rng.choice(decorative_tiles)
        tile_image = library.get(tile_name)
        x, y = cell
        canvas.paste(tile_image, (x * tile_size, y * tile_size), tile_image)
        placed += 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)

    print(
        "Carte générée : "
        f"{output_path} ({width}×{height} tuiles, taille finale {canvas.width}×{canvas.height}px)"
    )


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Construit une carte PNG procédurale à partir du tileset enrichi."
    )
    parser.add_argument(
        "size",
        type=int,
        help="Largeur de la carte en nombre de tuiles. Utilisée aussi comme hauteur si --height n'est pas défini.",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=None,
        help="Hauteur de la carte en tuiles (défaut : identique à size).",
    )
    parser.add_argument(
        "--path-style",
        choices=("standard", "bulle_verte"),
        default="standard",
        help="Sélectionne l'ensemble de tuiles de chemin à utiliser.",
    )
    parser.add_argument(
        "--background",
        default=DEFAULT_BACKGROUND,
        help="Tuile de fond (par défaut : eau profonde).",
    )
    parser.add_argument(
        "--material",
        default=None,
        help="Sous-type de matériau pour l'île (ex. grass, sand). Choix aléatoire si absent.",
    )
    parser.add_argument(
        "--edge-style",
        choices=EDGE_STYLES,
        default="auto",
        help="Type de contour à appliquer (falaise, bordure ou auto).",
    )
    parser.add_argument(
        "--numbers",
        type=int,
        default=None,
        help="Nombre de chiffres à placer le long du trajet.",
    )
    parser.add_argument(
        "--objects",
        type=int,
        default=None,
        help="Nombre d'arbres/objets décoratifs à déposer sur l'île.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Graine aléatoire pour reproduire la génération.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Chemin du fichier PNG généré (défaut : {DEFAULT_OUTPUT}).",
    )
    return parser.parse_args(list(argv) if argv is not None else None)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    width = args.size
    height = args.height if args.height is not None else args.size

    textures = load_textures()
    assemble_map(
        width=width,
        height=height,
        textures=textures,
        path_style=args.path_style,
        background_tile=args.background,
        output_path=args.output,
        material_subtype=args.material,
        edge_style=args.edge_style,
        numbers_requested=args.numbers,
        object_count=args.objects,
        seed=args.seed,
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
