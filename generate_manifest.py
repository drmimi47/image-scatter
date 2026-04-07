"""
generate_manifest.py

Auto-discovers every subdirectory of images/ and analyzes each image using Pillow.
For each image:
  - Downsamples to 100x100 and counts unique RGB colors (color variety proxy)
  - Maps color count to a scaleFactor in [0.7, 1.3] (normalized across the dataset)
  - Final scale = BASE_SIZE * scaleFactor  (BASE_SIZE = 0.4)
  - Records aspect ratio from the original image dimensions

Writes js/manifest.js exporting `imageGroups`.
"""

import json
import os
import sys
from pathlib import Path

try:
    from PIL import Image, UnidentifiedImageError
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

# ── Config ────────────────────────────────────────────────────────────────────

IMAGES_ROOT = Path("images")
OUT_FILE    = Path("js/manifest.js")

# Auto-discover: every direct subdirectory of IMAGES_ROOT, sorted alphabetically.
GROUPS = sorted(p.name for p in IMAGES_ROOT.iterdir() if p.is_dir())
BASE_SIZE   = 0.4
SCALE_MIN   = 0.65  # original: 0.55 scale factor for the least complex image (fewest unique colors)
SCALE_MAX   = 1.65  # original: 1.55 scale factor for the most complex image (most unique colors)
SCALE_FLOOR = 0.40  # new feature: absolute minimum final scale — lifts outliers like near-monochrome images
THUMB_SIZE  = (100, 100)


# ── Helpers ───────────────────────────────────────────────────────────────────

def count_unique_colors(img_path: Path):
    """Open image, downsample to THUMB_SIZE, return unique RGB pixel count."""
    try:
        with Image.open(img_path) as img:
            img.load()  # force decode (needed for some HEIC wrappers)
            thumb = img.convert("RGB").resize(THUMB_SIZE, Image.LANCZOS)
            return len(set(thumb.getdata()))
    except (UnidentifiedImageError, Exception) as exc:
        print(f"  SKIP  {img_path.name}: {exc}", file=sys.stderr)
        return None


def get_aspect_ratio(img_path: Path):
    try:
        with Image.open(img_path) as img:
            w, h = img.size
            return round(w / h, 4)
    except Exception:
        return None


# ── Pass 1: collect data ───────────────────────────────────────────────────────

print("Scanning images…")

records = []  # { group, path_str, color_count, aspect_ratio }

for group in GROUPS:
    folder = IMAGES_ROOT / group
    if not folder.is_dir():
        print(f"  missing  {folder}", file=sys.stderr)
        continue

    files = sorted(folder.iterdir())
    for f in files:
        if f.suffix.lower() not in {".jpg", ".jpeg", ".png", ".gif", ".bmp",
                                     ".tiff", ".webp", ".heic", ".heif"}:
            continue

        color_count  = count_unique_colors(f)
        aspect_ratio = get_aspect_ratio(f)

        if color_count is None or aspect_ratio is None:
            continue

        # Forward-slash path relative to project root (web-safe)
        path_str = f"{IMAGES_ROOT.as_posix()}/{group}/{f.name}"

        records.append({
            "group":        group,
            "path":         path_str,
            "color_count":  color_count,
            "aspect_ratio": aspect_ratio,
        })
        print(f"  {group}/{f.name}  colors={color_count}")

if not records:
    sys.exit("No images found — nothing to write.")

# ── Pass 2: normalize color counts → scaleFactor ──────────────────────────────

counts = [r["color_count"] for r in records]
lo, hi = min(counts), max(counts)

def normalize(count):
    if hi == lo:
        return (SCALE_MIN + SCALE_MAX) / 2
    t = (count - lo) / (hi - lo)          # 0 = simplest, 1 = most complex
    return SCALE_MIN + t * (SCALE_MAX - SCALE_MIN)

for r in records:
    r["scale"] = round(max(SCALE_FLOOR, BASE_SIZE * normalize(r["color_count"])), 4)

# ── Build imageGroups dict ────────────────────────────────────────────────────

image_groups = {g: [] for g in GROUPS}

for r in records:
    image_groups[r["group"]].append({
        "path":        r["path"],
        "scale":       r["scale"],
        "aspectRatio": r["aspect_ratio"],
    })

# Remove empty groups
image_groups = {k: v for k, v in image_groups.items() if v}

# ── Write manifest.js ─────────────────────────────────────────────────────────

OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

lines = ["export const imageGroups = {"]

group_keys = list(image_groups.keys())
for gi, group in enumerate(group_keys):
    entries = image_groups[group]
    comma_after_group = "," if gi < len(group_keys) - 1 else ""

    lines.append(f'  "{group}": [')
    for ei, entry in enumerate(entries):
        comma = "," if ei < len(entries) - 1 else ""
        lines.append(
            f'    {{ path: {json.dumps(entry["path"])}, '
            f'scale: {entry["scale"]}, '
            f'aspectRatio: {entry["aspectRatio"]} }}{comma}'
        )
    lines.append(f"  ]{comma_after_group}")

lines.append("};")
lines.append("")

OUT_FILE.write_text("\n".join(lines), encoding="utf-8")
print(f"\nWrote {OUT_FILE}  ({len(records)} images across {len(image_groups)} groups)")
