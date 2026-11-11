import type { ManifoldToplevel } from 'manifold-3d';
import type { DesignResult, ImageLike, Params } from './types';
import { buildRegions, modeFilter, quantize } from './segment';
import { traceRegions } from './trace';
import { buildGeometry } from './geometry';

/**
 * Full pipeline. `img` must already be cropped and resampled so that one pixel equals
 * params.mmPerPx millimetres.
 */
export function runPipeline(wasm: ManifoldToplevel, img: ImageLike, params: Params, onStage?: (s: string) => void): DesignResult {
  const t: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (name: string) => { const now = performance.now(); t[name] = Math.round(now - t0); t0 = now; };
  const { width: w, height: h } = img;

  onStage?.('Reducing colors');
  const q = quantize(img, params.colors, 1);
  lap('quantize');

  onStage?.('Cleaning up regions');
  const labels = modeFilter(q.labels, w, h, q.palette.length, 2);
  const minPx = params.minPieceMm2 / (params.mmPerPx * params.mmPerPx);
  const regions = buildRegions(labels, w, h, minPx);
  lap('regions');

  onStage?.('Tracing outlines');
  const loops = traceRegions(regions.ids, w, h, regions.count);
  lap('trace');

  onStage?.('Building 3D bodies');
  const { parts, pieceCount } = buildGeometry(
    wasm,
    loops.map((l, i) => ({ loops: l, cluster: regions.cluster[i] })),
    q.palette,
    w, h, params,
  );
  lap('geometry');

  return { widthMm: w * params.mmPerPx, heightMm: h * params.mmPerPx, parts, pieceCount, timings: t };
}
