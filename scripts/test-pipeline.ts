// Headless check of the full pipeline on a synthetic image: runs in Node, writes outputs
// to test-output/, and verifies every body is a closed, consistently oriented mesh.
import Module from 'manifold-3d';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { runPipeline } from '../src/pipeline/run';
import { DEFAULT_PARAMS } from '../src/pipeline/types';
import { build3mf } from '../src/export/threemf';
import { stlZip } from '../src/export/stl';
import { buildSvg } from '../src/export/svg';

function syntheticImage(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const cx = x - w / 2, cy = y - h / 2, r = Math.hypot(cx, cy);
    const ang = Math.atan2(cy, cx);
    let c = [40, 70, 160]; // blue sky
    if (r < h * 0.38) c = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 8) % 2 ? [200, 40, 40] : [230, 180, 40];
    if (r < h * 0.14) c = [40, 150, 70];
    // noise like a photo
    const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 * 18;
    data[i] = c[0] + n; data[i + 1] = c[1] + n; data[i + 2] = c[2] + n; data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

const wasm = await Module();
wasm.setup();
const params = { ...DEFAULT_PARAMS, colors: 4 };
const w = Math.round(params.widthMm / params.mmPerPx), h = w;
const img = syntheticImage(w, h);
const res = runPipeline(wasm, img, params, (s) => console.log('·', s));
console.log('timings ms', res.timings, 'pieces', res.pieceCount, 'size', res.widthMm, res.heightMm);

let ok = true;
for (const p of res.parts) {
  // closed-mesh check: every directed edge has exactly one opposite edge
  const edges = new Map<string, number>();
  const I = p.indices;
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = I[t + k], b = I[t + ((k + 1) % 3)];
    const key = `${a},${b}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  let bad = 0;
  for (const [key, n] of edges) { const [a, b] = key.split(','); if (n !== 1 || edges.get(`${b},${a}`) !== 1) bad++; }
  let zmax = 0; for (let k = 2; k < p.positions.length; k += 3) zmax = Math.max(zmax, p.positions[k]);
  console.log(`${p.name.padEnd(24)} ${p.color} tris=${I.length / 3} vol=${p.volumeMm3.toFixed(0)}mm3 zmax=${zmax.toFixed(2)} badEdges=${bad}`);
  if (bad || !I.length) ok = false;
}

mkdirSync('test-output', { recursive: true });
writeFileSync('test-output/panel.3mf', build3mf(res.parts));
writeFileSync('test-output/panel-stl.zip', stlZip(res.parts, 'test'));
writeFileSync('test-output/panel.svg', buildSvg(res.parts, res.widthMm, res.heightMm));
console.log(ok ? 'PASS: all bodies closed' : 'FAIL: open meshes');
process.exit(ok ? 0 : 1);
