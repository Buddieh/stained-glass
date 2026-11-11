import { strToU8, zipSync } from 'fflate';
import type { MeshPart } from '../pipeline/types';

export function binaryStl(part: MeshPart): Uint8Array {
  const tris = part.indices.length / 3;
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  const header = strToU8(`stained-glass ${part.name}`.slice(0, 80));
  new Uint8Array(buf, 0, header.length).set(header);
  dv.setUint32(80, tris, true);
  const P = part.positions, I = part.indices;
  let o = 84;
  for (let t = 0; t < tris; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]) {
      dv.setFloat32(o, v, true); o += 4;
    }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

/** All parts as separate STLs sharing one origin, zipped, plus a short README. */
export function stlZip(parts: MeshPart[], readme: string): Uint8Array {
  const files: Record<string, Uint8Array> = { 'README.txt': strToU8(readme) };
  for (const p of parts) files[`${p.name}.stl`] = binaryStl(p);
  return zipSync(files, { level: 6 });
}
