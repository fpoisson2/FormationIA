from __future__ import annotations

from collections import deque
import random

from scripts.build_map_png import (
    collect_edge_tiles,
    collect_material_tiles,
    compute_island_edges,
    fill_small_lakes,
    generate_island,
    load_textures,
    pick_material_subtype,
    smooth_island_shape,
)


def test_island_generation_pipeline_produces_consistent_edges() -> None:
    """Ensure terrain generation stays stable for deterministic seeds."""

    textures = load_textures()
    materials = collect_material_tiles(textures)

    rng = random.Random(20240607)
    width, height = 14, 12

    island = generate_island(width, height, rng)
    assert island, "The island generator should always produce land cells"

    fill_small_lakes(island, width, height, min_span=3)
    smooth_island_shape(island, passes=3)

    # The generator never touches the map border to keep room for contours.
    assert all(0 < x < width - 1 and 0 < y < height - 1 for (x, y) in island)

    # The shape must stay connected after smoothing.
    start = next(iter(island))
    visited = {start}
    queue: deque[tuple[int, int]] = deque([start])
    while queue:
        cx, cy = queue.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            neighbor = (cx + dx, cy + dy)
            if neighbor in island and neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)

    assert visited == island, "Island cells should remain a single connected component"

    # No land tip should remain isolated after smoothing.
    if len(island) > 1:
        for (x, y) in island:
            neighbor_count = sum(
                (x + dx, y + dy) in island
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            assert neighbor_count >= 1, "Every land tile bordering water must keep a support cell"

    chosen_material = pick_material_subtype(materials, None, rng)
    bordure_tiles = collect_edge_tiles(textures, include_bordure=True, include_falaise=False)
    falaise_tiles = collect_edge_tiles(textures, include_bordure=False, include_falaise=True)

    edge_placements = compute_island_edges(
        island,
        chosen_material,
        "auto",
        bordure_tiles,
        falaise_tiles,
        width,
        height,
    )

    assert edge_placements, "Every generated island should receive contour placements"

    placements_by_cell = {placement.position: placement for placement in edge_placements}
    border_cells = {
        (x, y)
        for (x, y) in island
        if any((x + dx, y + dy) not in island for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    }

    assert border_cells.issubset(placements_by_cell.keys()), "Each exposed land tile needs a contour"

    for placement in edge_placements:
        assert placement.tile in textures, f"Contour tile {placement.tile} must exist in the atlas"
        if placement.touches_outside:
            x, y = placement.position
            assert any(
                not (0 <= x + dx < width and 0 <= y + dy < height)
                or (x + dx, y + dy) not in island
                for dx, dy in (
                    (1, 0),
                    (-1, 0),
                    (0, 1),
                    (0, -1),
                    (1, 1),
                    (1, -1),
                    (-1, 1),
                    (-1, -1),
                )
            ), "Placements marked as exterior must touch water or map bounds"
