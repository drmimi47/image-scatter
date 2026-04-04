# image-scatter

An interactive physics-based image layout tool built for the *B-side* publication. Images are organized into thematic groups, launched onto a virtual 33 × 22.75 in frame, and scatter into naturalistic piles using a rigid-body physics simulation.

## How it works

**Generate** shuffles and launches all images simultaneously. Each group lands in a unique region of the frame. **Save PNG** exports a 300 dpi image of the inner frame contents once everything has settled.

## Features

- **Physics simulation** — Matter.js rigid-body engine with zero gravity. Cards are launched from the bottom-center of the frame toward their group's target with a calculated velocity (`v₀ = distance × frictionAir`), then decelerate naturally via air resistance and come to rest in overlapping piles. Cards collide with the frame walls but pass over each other with a controlled maximum overlap (~22% of image width).
- **Color entropy scaling** — each image is downsampled to 100×100 px and its unique RGB color count is used as a proxy for visual complexity. Images with more color variety (busy, textured) render larger; simpler, flatter images render smaller. The scale range is adjustable in `generate_manifest.py` (`SCALE_MIN`, `SCALE_MAX`).
- **Weighted group placement** — groups with more images are given proportionally more space. Target centers are placed largest-group-first using a size-weighted distance score, so large piles claim territory before smaller ones fill the gaps.
- **High-DPI rendering** — the live canvas scales to `window.devicePixelRatio` for sharp display on retina screens. The PNG export renders at full 300 dpi (9600 × 6525 px for the inner frame).
- **Group number overlay** — toggle button reveals each group's folder name over its pile center for inspection.

## Project structure

```
images/          thematic subfolders — one folder = one pile
js/
  manifest.js    auto-generated: path, scale, aspectRatio per image
  main.js        scatter logic, grid placement, export
  PhysicsEngine.js  Matter.js wrapper
  CanvasManager.js  HiDPI canvas + export helpers
generate_manifest.py  run to rebuild manifest after adding/changing images
```

## Regenerating the manifest

```bash
pip install Pillow
python3 generate_manifest.py
```

Add or rename folders in `images/` freely — the script auto-discovers all subfolders.
