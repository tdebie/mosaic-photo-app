# Mosaic Photo App

Client-side web app for generating a printable photo mosaic.

## Features

- Upload one master image and up to 200 source images (including folder selection via `webkitdirectory`).
- Configure print size (cm), DPI, and tile size range (cm).
- Print-size presets are proportional to the master aspect ratio, with a 300 DPI max-size hint from master resolution.
- Optional overlap % introduces controlled tile overlap/jitter for a more chaotic look while preserving full coverage.
- Estimate a safe source-image downsample limit from final print resolution + tile sizing + available source count.
- Compute per-photo stats used for matching:
  - Average RGB color
  - Average saturation (HSV)
  - Average brightness/value (HSV)
- Paint inclusion/exclusion regions on the master image:
  - Include in mosaic
  - Exclude from mosaic (keep original master pixels)
- Matching modes:
  - Use all photos (balanced reuse)
  - Use best matches only (respecting match tolerance)
- Adjustment tolerance controls how much brightness/saturation/color can be nudged to improve match.
- Color-range masking tool can paint either inclusion or exclusion directly into the active mask.
- Smooth-mask tool removes small include/exclude islands up to a configured size (applied on demand).
- Boundary smoothing tool reduces staircase/jagged edges on include/exclude borders.
- Boundary-safe compositing: tiles are alpha-cut at inclusion/exclusion edges so excluded regions remain true master-photo pixels.
- Edge-aware matching: color stats for edge tiles are computed only from actually visible (non-clipped) pixels.
- Tile placement preserves source photo aspect ratio (center-crop fit) and avoids adjacent duplicate-photo placement, with penalties for nearby repeats.
- Output reporting includes used/unused source images and counts.

## Run

No build step required.

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Notes

- All processing currently happens in the browser.
- Very large print dimensions + high DPI can require substantial memory and CPU.
