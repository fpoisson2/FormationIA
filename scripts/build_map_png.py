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
from collections import deque
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


@dataclass(frozen=True)
class EdgePlacement:
    """Décrit l'application d'une tuile de bordure sur l'île."""

    tile: str
    position: tuple[int, int]
    touches_outside: bool


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
) -> Dict[str | None, Dict[Tuple[str, ...], Dict[str, str]]]:
    """Indexe les tuiles de bordure/falaise par sous-type et orientation."""

    result: Dict[str | None, Dict[Tuple[str, ...], Dict[str, str]]] = {}
    for texture in textures.values():
        if texture.category != "terrain":
            continue
        if not texture.connections or not texture.subtype:
            continue

        type_tokens = (texture.type or "").split()
        is_falaise = "falaise" in type_tokens
        is_interior = "coin_interieur" in type_tokens

        if is_falaise and not include_falaise:
            continue
        if not is_falaise and not (
            include_bordure
            and ("bordure" in type_tokens or is_interior)
        ):
            continue

        orientation = texture.connections
        bucket = result.setdefault(texture.subtype, {}).setdefault(orientation, {})
        bucket["interior" if is_interior else "exterior"] = texture.name

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

    def is_too_close(candidate: tuple[int, int], current_path: List[tuple[int, int]]) -> bool:
        """Vérifie qu'une case ne longe pas un segment déjà visité."""

        if not current_path:
            return False

        allowed: set[tuple[int, int]] = {current_path[-1]}
        if len(current_path) >= 2:
            allowed.add(current_path[-2])

        cx, cy = candidate
        for px, py in current_path:
            if (px, py) in allowed:
                continue
            if abs(cx - px) + abs(cy - py) == 1:
                return True
        return False

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
                nxt: tuple[int, int] | None = None
                while options:
                    candidate = options.pop()
                    if candidate in visited or is_too_close(candidate, path):
                        continue
                    nxt = candidate
                    break

                if nxt is None:
                    stack.pop()
                    if stack:
                        path.pop()
                    continue

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


def find_outside_water(
    island: set[tuple[int, int]], width: int, height: int
) -> set[tuple[int, int]]:
    """Repère toutes les cases d'eau reliées au bord de la carte."""

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


def fill_small_lakes(
    island: set[tuple[int, int]],
    width: int,
    height: int,
    min_span: int = 3,
) -> None:
    """Bouche les nappes d'eau internes dont l'envergure est trop faible."""

    if min_span <= 1:
        return

    outside = find_outside_water(island, width, height)
    visited: set[tuple[int, int]] = set(outside)

    for x in range(1, width - 1):
        for y in range(1, height - 1):
            cell = (x, y)
            if cell in island or cell in visited:
                continue

            component: set[tuple[int, int]] = {cell}
            queue: deque[tuple[int, int]] = deque([cell])
            visited.add(cell)

            min_x = max_x = x
            min_y = max_y = y

            while queue:
                cx, cy = queue.popleft()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if not (0 <= nx < width and 0 <= ny < height):
                        continue

                    candidate = (nx, ny)
                    if candidate in island or candidate in visited:
                        continue

                    visited.add(candidate)
                    queue.append(candidate)
                    component.add(candidate)

                    if nx < min_x:
                        min_x = nx
                    elif nx > max_x:
                        max_x = nx
                    if ny < min_y:
                        min_y = ny
                    elif ny > max_y:
                        max_y = ny

            span_x = max_x - min_x + 1
            span_y = max_y - min_y + 1
            if span_x < min_span or span_y < min_span:
                island.update(component)


def classify_edge_cell(
    cell: tuple[int, int],
    island: set[tuple[int, int]],
    is_outside: bool,
) -> tuple[Tuple[str, ...], str] | None:
    """Détermine la tuile de contour à utiliser pour une case d'eau donnée."""

    x, y = cell
    north = (x, y - 1) in island
    south = (x, y + 1) in island
    east = (x + 1, y) in island
    west = (x - 1, y) in island
    northeast = (x + 1, y - 1) in island
    northwest = (x - 1, y - 1) in island
    southeast = (x + 1, y + 1) in island
    southwest = (x - 1, y + 1) in island

    if not (north or south or east or west or northeast or northwest or southeast or southwest):
        return None

    # Coins intérieurs : la case touche l'île sur deux axes adjacents.
    if north and west and not south and not east:
        return (("southeast",), "exterior" if is_outside else "interior")
    if north and east and not south and not west:
        return (("southwest",), "exterior" if is_outside else "interior")
    if south and west and not north and not east:
        return (("northeast",), "exterior" if is_outside else "interior")
    if south and east and not north and not west:
        return (("northwest",), "exterior" if is_outside else "interior")

    # Bords droits (cases adjacentes sur un seul axe cardinal).
    if south:
        return (("north",), "exterior")
    if north:
        return (("south",), "exterior")
    if east:
        return (("west",), "exterior")
    if west:
        return (("east",), "exterior")

    # Coins extérieurs (uniquement la diagonale touche l'île).
    if southwest:
        return (("northeast",), "exterior")
    if southeast:
        return (("northwest",), "exterior")
    if northwest:
        return (("southeast",), "exterior")
    if northeast:
        return (("southwest",), "exterior")

    return None


def choose_edge_tile(
    subtype: str,
    orientation: Tuple[str, ...],
    orientation_type: str,
    preferred_style: str,
    bordure_tiles: Dict[str | None, Dict[Tuple[str, ...], Dict[str, str]]],
    falaise_tiles: Dict[str | None, Dict[Tuple[str, ...], Dict[str, str]]],
) -> str | None:
    """Sélectionne la tuile de contour appropriée avec repli."""

    lookup_order: List[Dict[str | None, Dict[Tuple[str, ...], Dict[str, str]]]]
    if preferred_style == "falaise":
        lookup_order = [falaise_tiles, bordure_tiles]
    elif preferred_style == "bordure":
        lookup_order = [bordure_tiles, falaise_tiles]
    else:  # auto
        lookup_order = [falaise_tiles, bordure_tiles]

    fallback_key = "interior" if orientation_type == "exterior" else "exterior"

    for index in lookup_order:
        by_subtype = index.get(subtype) or {}
        options = by_subtype.get(orientation)
        if not options:
            continue
        if orientation_type in options:
            return options[orientation_type]
        if fallback_key in options:
            return options[fallback_key]
        # Dernier recours : retourner n'importe quelle variante disponible.
        for candidate in options.values():
            return candidate

    return None


def compute_island_edges(
    island: set[tuple[int, int]],
    subtype: str,
    preferred_style: str,
    bordure_tiles: Dict[str | None, Dict[Tuple[str, ...], Dict[str, str]]],
    falaise_tiles: Dict[str | None, Dict[Tuple[str, ...], Dict[str, str]]],
    width: int,
    height: int,
) -> List[EdgePlacement]:
    """Calcule les tuiles de contour à superposer sur l'île."""

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
    cardinal_offsets: Dict[str, tuple[int, int]] = {
        "north": (0, -1),
        "south": (0, 1),
        "east": (1, 0),
        "west": (-1, 0),
    }
    corner_cardinals: Dict[str, tuple[str, str]] = {
        "northeast": ("north", "east"),
        "northwest": ("north", "west"),
        "southeast": ("south", "east"),
        "southwest": ("south", "west"),
    }

    def priority(orientation: Tuple[str, ...], orientation_type: str) -> tuple[int, int]:
        direction = orientation[0] if orientation else ""
        is_diagonal = direction in {"northeast", "northwest", "southeast", "southwest"}
        # Les coins (diagonaux) priment sur les bords, et les variantes interior sur exterior.
        diagonal_rank = 0 if is_diagonal else 1
        interior_rank = 0 if orientation_type == "interior" else 1
        return (diagonal_rank, interior_rank)

    candidates: Dict[tuple[int, int], bool] = {}
    outside_water = find_outside_water(island, width, height)
    by_island_cell: Dict[tuple[int, int], tuple[Tuple[str, ...], str, bool]] = {}
    priorities: Dict[tuple[int, int], tuple[int, int]] = {}

    for (x, y) in island:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nx, ny = x + dx, y + dy
                if (nx, ny) in island:
                    continue

                if 0 <= nx < width and 0 <= ny < height:
                    is_outside = (nx, ny) in outside_water
                else:
                    is_outside = True

                previous = candidates.get((nx, ny))
                if previous is None or (not previous and is_outside):
                    candidates[(nx, ny)] = is_outside

    for (x, y), is_outside in sorted(
        candidates.items(), key=lambda item: (item[0][1], item[0][0])
    ):
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

        if orientation_type == "exterior" and direction in corner_cardinals:
            neighbors = corner_cardinals[direction]
            if all(
                (
                    target[0] + cardinal_offsets[card][0],
                    target[1] + cardinal_offsets[card][1],
                )
                in island
                for card in neighbors
            ):
                orientation_type = "interior"

        current_priority = priority(orientation, orientation_type)
        previous_priority = priorities.get(target)
        if previous_priority is not None and previous_priority <= current_priority:
            continue

        priorities[target] = current_priority
        by_island_cell[target] = (orientation, orientation_type, is_outside)

    placements: List[EdgePlacement] = []
    for (x, y) in sorted(by_island_cell, key=lambda item: (item[1], item[0])):
        orientation, orientation_type, is_outside = by_island_cell[(x, y)]
        effective_style = (
            preferred_style
            if is_outside or preferred_style == "bordure"
            else "bordure"
        )

        tile = choose_edge_tile(
            subtype,
            orientation,
            orientation_type,
            effective_style,
            bordure_tiles,
            falaise_tiles,
        )
        if tile:
            placements.append(
                EdgePlacement(tile=tile, position=(x, y), touches_outside=is_outside)
            )

    return placements


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
    fill_small_lakes(island_cells, width, height)

    edge_placements = compute_island_edges(
        island_cells,
        chosen_material,
        edge_style,
        bordure_tiles,
        falaise_tiles,
        width,
        height,
    )

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

    # Prépare les cellules de contour exposées à l'eau extérieure.
    for placement in edge_placements:
        if not placement.touches_outside:
            continue
        x, y = placement.position
        canvas.paste(background_image, (x * tile_size, y * tile_size))

    # Ajoute le contour (falaise ou bordure) avec transparence.
    for placement in edge_placements:
        tile_image = library.get(placement.tile)
        x, y = placement.position
        canvas.paste(tile_image, (x * tile_size, y * tile_size), tile_image)

    # Génère un trajet continu à l'intérieur de l'île.
    if numbers_requested is None:
        numbers_requested = max(4, (width + height) // 2)

    numbers_available = collect_number_tiles(textures)
    if not numbers_available:
        raise SystemExit("Aucun chiffre marchable n'a été trouvé dans le XML.")

    coverage_target = max(4, int(len(island_cells) * 0.6))
    desired_length = max(numbers_requested, coverage_target)
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
    max_digits = min(numbers_requested, len(numbers_available), len(path_cells_list))
    indices = distribute_indices(len(path_cells_list), max_digits)
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
