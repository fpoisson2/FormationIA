#!/usr/bin/env python3
"""Embed enriched XML metadata into individual PNG tiles.

This script reads ``mapPack_enriched.xml`` and injects the annotated
attributes (type, subtype, category, connections, etc.) into the
corresponding PNG files as textual metadata chunks.  It preserves any
existing textual fields and updates or adds the new ones derived from the
XML description.

The script is intentionally not executed automatically; run it manually
once Pillow is available in the environment.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

try:
    from PIL import Image, PngImagePlugin
except ImportError as exc:  # pragma: no cover - module availability depends on runtime
    raise SystemExit(
        "Pillow doit être installé pour exécuter ce script (pip install Pillow)."
    ) from exc

REPO_ROOT = Path(__file__).resolve().parents[1]
XML_PATH = REPO_ROOT / "frontend" / "src" / "assets" / "kenney_map-pack" / "Spritesheet" / "mapPack_enriched.xml"
PNG_DIR = REPO_ROOT / "frontend" / "src" / "assets" / "kenney_map-pack" / "PNG"
DEFAULT_OUTPUT_DIR = PNG_DIR.parent / "PNG_with_metadata"

IGNORED_XML_KEYS = {"x", "y", "width", "height"}


def collect_metadata() -> dict[str, dict[str, str]]:
    """Parse the enriched XML and return per-texture metadata."""
    if not XML_PATH.exists():
        raise FileNotFoundError(f"Fichier XML introuvable: {XML_PATH}")

    tree = ET.parse(XML_PATH)
    root = tree.getroot()
    textures = {}
    for subtexture in root.findall("SubTexture"):
        name = subtexture.get("name")
        if not name:
            continue
        metadata = {
            key: value
            for key, value in subtexture.attrib.items()
            if key not in IGNORED_XML_KEYS and value is not None
        }
        textures[name] = metadata
    return textures


def merge_png_metadata(image: Image.Image, new_meta: dict[str, str]) -> PngImagePlugin.PngInfo:
    """Combine existing textual metadata with the new XML-derived values."""
    png_info = PngImagePlugin.PngInfo()

    existing_text = {
        key: (value.decode("utf-8") if isinstance(value, bytes) else str(value))
        for key, value in image.info.items()
        if isinstance(key, str)
    }

    for key, value in existing_text.items():
        if key not in new_meta:
            png_info.add_text(key, value)

    for key, value in new_meta.items():
        png_info.add_text(key, value)

    return png_info


def update_png(
    name: str, metadata: dict[str, str], output_dir: Path, dry_run: bool = False
) -> None:
    """Update a single PNG file with the provided metadata."""
    png_path = PNG_DIR / name
    if not png_path.exists():
        print(f"[WARN] Fichier PNG manquant: {name}")
        return

    if dry_run:
        target_path = output_dir / name
        print(f"[DRY-RUN] {target_path} ← {json.dumps(metadata, ensure_ascii=False)}")
        return

    with Image.open(png_path) as image:
        png_info = merge_png_metadata(image, metadata)
        output_dir.mkdir(parents=True, exist_ok=True)
        target_path = output_dir / name
        image.save(target_path, pnginfo=png_info)
        print(f"[OK] Métadonnées injectées dans {target_path}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ajoute les métadonnées du XML aux PNG individuels.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Affiche les métadonnées qui seraient écrites sans modifier les fichiers.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Nombre maximum de fichiers PNG à traiter (pour tests).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Dossier de sortie pour les PNG enrichis (défaut : {DEFAULT_OUTPUT_DIR}).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    textures = collect_metadata()
    output_dir = args.output_dir

    if output_dir.resolve() == PNG_DIR.resolve():
        raise SystemExit(
            "Le dossier de sortie doit être distinct du dossier source des PNG."
        )

    processed = 0
    for name, metadata in textures.items():
        update_png(name, metadata, output_dir=output_dir, dry_run=args.dry_run)
        processed += 1
        if args.limit is not None and processed >= args.limit:
            break

    print(f"Traitement terminé ({processed} fichiers).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
