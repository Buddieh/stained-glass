# Stained Glass Generator

Turn a photo or your own artwork into a 3D-printable stained glass panel, preview it in 3D,
and download a multi-color 3MF (or STLs). Runs entirely in the browser; images are never uploaded.

Live: https://buddieh.com/stained-glass/

## How it works

1. The cropped image is resampled so one pixel = 0.15-0.4 mm.
2. Colors are reduced with k-means in CIELAB, cleaned with a majority filter, and split into
   connected pieces; pieces under the minimum area merge into their neighbour.
3. Piece outlines are traced along pixel edges, simplified, and inset by half the lead line
   width with [Manifold](https://github.com/elalish/manifold) (WASM). Slivers too thin to print are dropped.
4. Lead lines (came) = panel outline minus all glass, so glass and came share exact edges.
5. Glass is extruded to the glass thickness, came to the came height, both from z = 0.
   z = 0 is the bed side and the front of the panel, so the model is mirrored by default.
6. Export: core-spec 3MF with one part per color plus the came; zipped STLs; SVG of the design.

## Printing

- Translucent PETG, 0.4 mm nozzle, 0.2 mm layers; glass 0.6 mm = 3 layers.
- One filament per part. Several glass colors in one print need an AMS (or similar).
  Without one: one glass color + black lead lines with a filament change at the top of the glass layers.

## Develop

```sh
npm install
npm run dev            # http://localhost:5173/stained-glass/
npm run test:pipeline  # headless pipeline check, writes test-output/
npm run build          # static site in dist/
```

Deployed by `.github/workflows/deploy.yml` to GitHub Pages (Settings → Pages → Source: GitHub Actions).
