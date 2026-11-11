import type { ImageLike, RGB } from './types';

// ---------- color space ----------

function srgbToLinear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
const fLab = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fLabInv = (t: number) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L: number, a: number, b: number): RGB {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = fLabInv(fx) * 0.95047, Y = fLabInv(fy), Z = fLabInv(fz) * 1.08883;
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return { r: linearToSrgb(R), g: linearToSrgb(G), b: linearToSrgb(B) };
}

export function rgbHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Deterministic PRNG so the same image + settings always give the same design.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- smoothing ----------

/** Separable box blur on an interleaved 3-channel float image, `passes` times (≈ gaussian). */
function blur3(src: Float32Array, w: number, h: number, radius: number, passes: number): Float32Array {
  if (radius <= 0 || passes <= 0) return src;
  let a = src.slice();
  let b = new Float32Array(a.length);
  const win = 2 * radius + 1;
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) acc += a[(y * w + Math.min(w - 1, Math.max(0, k))) * 3 + c];
        for (let x = 0; x < w; x++) {
          b[(y * w + x) * 3 + c] = acc / win;
          const out = Math.max(0, x - radius), inn = Math.min(w - 1, x + radius + 1);
          acc += a[(y * w + inn) * 3 + c] - a[(y * w + out) * 3 + c];
        }
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) acc += b[(Math.min(h - 1, Math.max(0, k)) * w + x) * 3 + c];
        for (let y = 0; y < h; y++) {
          a[(y * w + x) * 3 + c] = acc / win;
          const out = Math.max(0, y - radius), inn = Math.min(h - 1, y + radius + 1);
          acc += b[(inn * w + x) * 3 + c] - b[(out * w + x) * 3 + c];
        }
      }
    }
  }
  return a;
}

// ---------- quantization ----------

export interface Quantized {
  labels: Uint16Array; // cluster index per pixel
  palette: RGB[];
  paletteLab: [number, number, number][];
}

export function quantize(img: ImageLike, k: number, blurRadius = 1): Quantized {
  const { width: w, height: h, data } = img;
  const n = w * h;
  let lab: Float32Array = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Treat transparent pixels as white so PNGs with alpha behave predictably.
    const a = data[i * 4 + 3] / 255;
    const r = data[i * 4] * a + 255 * (1 - a);
    const g = data[i * 4 + 1] * a + 255 * (1 - a);
    const bb = data[i * 4 + 2] * a + 255 * (1 - a);
    const [L, A, B] = rgbToLab(r, g, bb);
    lab[i * 3] = L; lab[i * 3 + 1] = A; lab[i * 3 + 2] = B;
  }
  lab = blur3(lab, w, h, blurRadius, 2);

  const rand = mulberry32(1234567);
  const sampleN = Math.min(n, 30000);
  const sample = new Uint32Array(sampleN);
  for (let i = 0; i < sampleN; i++) sample[i] = sampleN === n ? i : Math.floor(rand() * n);

  const dist2 = (i: number, c: number[]) => {
    const d0 = lab[i * 3] - c[0], d1 = lab[i * 3 + 1] - c[1], d2 = lab[i * 3 + 2] - c[2];
    return d0 * d0 + d1 * d1 + d2 * d2;
  };

  // k-means++ init
  const centers: number[][] = [];
  const first = sample[Math.floor(rand() * sampleN)];
  centers.push([lab[first * 3], lab[first * 3 + 1], lab[first * 3 + 2]]);
  const dmin = new Float64Array(sampleN).fill(Infinity);
  while (centers.length < k) {
    let total = 0;
    const c = centers[centers.length - 1];
    for (let s = 0; s < sampleN; s++) {
      dmin[s] = Math.min(dmin[s], dist2(sample[s], c));
      total += dmin[s];
    }
    if (total === 0) break; // fewer distinct colors than k
    let r = rand() * total, pick = 0;
    for (let s = 0; s < sampleN; s++) { r -= dmin[s]; if (r <= 0) { pick = s; break; } }
    const i = sample[pick];
    centers.push([lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]]);
  }

  // Lloyd iterations on the sample
  const K = centers.length;
  const assign = new Uint16Array(sampleN);
  for (let iter = 0; iter < 20; iter++) {
    const sums = new Float64Array(K * 3), counts = new Uint32Array(K);
    let moved = 0;
    for (let s = 0; s < sampleN; s++) {
      const i = sample[s];
      let best = 0, bd = Infinity;
      for (let c = 0; c < K; c++) { const d = dist2(i, centers[c]); if (d < bd) { bd = d; best = c; } }
      if (assign[s] !== best) moved++;
      assign[s] = best;
      counts[best]++;
      sums[best * 3] += lab[i * 3]; sums[best * 3 + 1] += lab[i * 3 + 1]; sums[best * 3 + 2] += lab[i * 3 + 2];
    }
    for (let c = 0; c < K; c++) if (counts[c]) centers[c] = [sums[c * 3] / counts[c], sums[c * 3 + 1] / counts[c], sums[c * 3 + 2] / counts[c]];
    if (iter > 0 && moved < sampleN * 0.001) break;
  }

  const labels = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0, bd = Infinity;
    for (let c = 0; c < K; c++) { const d = dist2(i, centers[c]); if (d < bd) { bd = d; best = c; } }
    labels[i] = best;
  }
  return {
    labels,
    paletteLab: centers as [number, number, number][],
    palette: centers.map(([L, a, b]) => labToRgb(L, a, b)),
  };
}

/** 3x3 majority filter: removes speckle along color boundaries. */
export function modeFilter(labels: Uint16Array, w: number, h: number, k: number, passes = 2): Uint16Array {
  let src = labels;
  const counts = new Uint16Array(k);
  for (let p = 0; p < passes; p++) {
    const dst = new Uint16Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        counts.fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            counts[src[yy * w + xx]]++;
          }
        }
        const self = src[y * w + x];
        let best = self, bc = counts[self];
        for (let c = 0; c < k; c++) if (counts[c] > bc) { bc = counts[c]; best = c; }
        dst[y * w + x] = best;
      }
    }
    src = dst;
  }
  return src;
}

// ---------- regions ----------

export interface Regions {
  /** region id per pixel, 0..count-1 */
  ids: Int32Array;
  count: number;
  /** cluster (color) index per region */
  cluster: Uint16Array;
  size: Uint32Array;
}

function components(labels: Uint16Array, w: number, h: number): Regions {
  const n = w * h;
  const ids = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const cluster: number[] = [], size: number[] = [];
  let count = 0;
  for (let start = 0; start < n; start++) {
    if (ids[start] !== -1) continue;
    const lab = labels[start];
    let sp = 0, sz = 0;
    stack[sp++] = start; ids[start] = count;
    while (sp) {
      const i = stack[--sp]; sz++;
      const x = i % w, y = (i - x) / w;
      if (x > 0 && ids[i - 1] === -1 && labels[i - 1] === lab) { ids[i - 1] = count; stack[sp++] = i - 1; }
      if (x < w - 1 && ids[i + 1] === -1 && labels[i + 1] === lab) { ids[i + 1] = count; stack[sp++] = i + 1; }
      if (y > 0 && ids[i - w] === -1 && labels[i - w] === lab) { ids[i - w] = count; stack[sp++] = i - w; }
      if (y < h - 1 && ids[i + w] === -1 && labels[i + w] === lab) { ids[i + w] = count; stack[sp++] = i + w; }
    }
    cluster.push(lab); size.push(sz); count++;
  }
  return { ids, count, cluster: Uint16Array.from(cluster), size: Uint32Array.from(size) };
}

/**
 * Connected regions of equal color, with regions smaller than minPx merged into the
 * neighbour they share the longest border with (that neighbour keeps its color).
 */
export function buildRegions(labels: Uint16Array, w: number, h: number, minPx: number): Regions {
  const base = components(labels, w, h);
  const parent = new Int32Array(base.count);
  for (let i = 0; i < base.count; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const size = Float64Array.from(base.size);

  for (let round = 0; round < 12; round++) {
    // shared border length between each small root and its neighbours
    const border = new Map<number, Map<number, number>>();
    const add = (a: number, b: number) => {
      if (size[a] >= minPx) return;
      let m = border.get(a);
      if (!m) { m = new Map(); border.set(a, m); }
      m.set(b, (m.get(b) ?? 0) + 1);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = find(base.ids[i]);
        if (x < w - 1) { const b = find(base.ids[i + 1]); if (a !== b) { add(a, b); add(b, a); } }
        if (y < h - 1) { const b = find(base.ids[i + w]); if (a !== b) { add(a, b); add(b, a); } }
      }
    }
    if (border.size === 0) break;
    // merge smallest first
    const smalls = [...border.keys()].sort((a, b) => size[a] - size[b]);
    let merged = 0;
    for (const s of smalls) {
      const rs = find(s);
      if (rs !== s || size[rs] >= minPx) continue;
      let best = -1, bl = -1;
      for (const [nb, len] of border.get(s)!) {
        const r = find(nb);
        if (r === rs) continue;
        if (len > bl || (len === bl && size[r] > size[best])) { bl = len; best = r; }
      }
      if (best < 0) continue;
      parent[rs] = best;
      size[best] += size[rs];
      merged++;
    }
    if (!merged) break;
  }

  // compact ids
  const remap = new Int32Array(base.count).fill(-1);
  const cluster: number[] = [], sizes: number[] = [];
  let count = 0;
  for (let r = 0; r < base.count; r++) {
    const root = find(r);
    if (remap[root] === -1) { remap[root] = count++; cluster.push(base.cluster[root]); sizes.push(size[root]); }
  }
  const ids = new Int32Array(w * h);
  for (let i = 0; i < ids.length; i++) ids[i] = remap[find(base.ids[i])];
  return { ids, count, cluster: Uint16Array.from(cluster), size: Uint32Array.from(sizes) };
}
