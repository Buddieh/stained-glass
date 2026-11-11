import type { MeshPart } from '../pipeline/types';

/** 2D design (unmirrored, as seen from the viewing side), in millimetres. */
export function buildSvg(parts: MeshPart[], widthMm: number, heightMm: number): string {
  const f = (v: number) => v.toFixed(3).replace(/\.?0+$/, '');
  const path = (polys: [number, number][][]) =>
    polys.map((poly) => 'M' + poly.map(([x, y]) => `${f(x)} ${f(heightMm - y)}`).join('L') + 'Z').join('');
  const layers = parts
    .slice()
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'came' ? 1 : -1))
    .map((p) => `<path id="${p.name}" fill="${p.color}" fill-rule="nonzero" d="${path(p.polygons)}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f(widthMm)}mm" height="${f(heightMm)}mm" viewBox="0 0 ${f(widthMm)} ${f(heightMm)}">
${layers}
</svg>
`;
}
