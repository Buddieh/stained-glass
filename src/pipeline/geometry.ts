import type { CrossSection as CS, Manifold as MF, ManifoldToplevel } from 'manifold-3d';
import type { MeshPart, Params, RGB } from './types';
import { rgbHex } from './segment';

export interface RegionInput {
  /** loops in pixel-corner units, y down (flat x,y arrays) */
  loops: number[][];
  cluster: number;
}

/**
 * Build the printable bodies:
 *  - one pane body per color: each region inset by half the came width, slivers removed
 *  - one came body: the panel outline minus all panes (so pane and came share exact edges)
 * Panes go from z=0 to paneThickness, came from z=0 to cameHeight. z=0 is the bed side,
 * which is the side people look at, so the model is mirrored in X by default.
 */
export function buildGeometry(
  wasm: ManifoldToplevel,
  regions: RegionInput[],
  palette: RGB[],
  wPx: number,
  hPx: number,
  p: Params,
): { parts: MeshPart[]; pieceCount: number } {
  const { CrossSection } = wasm;
  const trash: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(o: T): T => { trash.push(o); return o; };

  const res = p.mmPerPx;
  const W = wPx * res, H = hPx * res;
  const halfCame = p.cameWidth / 2;
  const sliver = 0.6; // panes narrower than 2 * sliver mm are dropped (they'd print as a blob)
  const minArea = Math.max(1, p.minPieceMm2 * 0.25);

  const border = Math.max(p.borderMm, halfCame);
  const outer = keep(CrossSection.square([W, H]));
  const inner = keep(keep(CrossSection.square([W - 2 * border, H - 2 * border])).translate([border, border]));

  const perColor: CS[][] = palette.map(() => []);
  let pieceCount = 0;

  for (const reg of regions) {
    if (!reg.loops.length) continue;
    const contours = reg.loops.map((flat) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i] * res, (hPx - flat[i + 1]) * res]);
      return pts;
    });
    const cs = keep(new CrossSection(contours, 'NonZero'));
    const simp = keep(cs.simplify(p.smoothingMm));
    const inset = keep(simp.offset(-(halfCame + sliver), 'Round', 2, 24));
    if (inset.isEmpty()) continue;
    const opened = keep(inset.offset(sliver, 'Round', 2, 24));
    const clipped = keep(opened.intersect(inner));
    if (clipped.isEmpty() || clipped.area() < minArea) continue;
    pieceCount += clipped.decompose().map((d) => { d.delete(); return 1; }).length;
    perColor[reg.cluster].push(clipped);
  }

  const mirrorX = (c: CS): CS => (p.mirror ? keep(keep(c.mirror([1, 0])).translate([W, 0])) : c);

  const toPart = (m: MF, name: string, color: string, kind: MeshPart['kind'], cs: CS): MeshPart => {
    const mesh = m.getMesh();
    const positions = new Float32Array(mesh.numVert * 3);
    for (let v = 0; v < mesh.numVert; v++) {
      positions[v * 3] = mesh.vertProperties[v * mesh.numProp];
      positions[v * 3 + 1] = mesh.vertProperties[v * mesh.numProp + 1];
      positions[v * 3 + 2] = mesh.vertProperties[v * mesh.numProp + 2];
    }
    return {
      name, color, kind,
      positions,
      indices: new Uint32Array(mesh.triVerts),
      volumeMm3: m.volume(),
      polygons: cs.toPolygons().map((poly) => poly.map(([x, y]) => [x, y] as [number, number])),
    };
  };

  const parts: MeshPart[] = [];
  const allPanes: CS[] = [];
  palette.forEach((rgb, ci) => {
    if (!perColor[ci].length) return;
    const merged = keep(CrossSection.union(perColor[ci]));
    if (merged.isEmpty()) return;
    allPanes.push(merged);
    const solid = keep(mirrorX(merged).extrude(p.paneThickness));
    const hex = rgbHex(rgb);
    parts.push(toPart(solid, `glass_${String(parts.length + 1).padStart(2, '0')}_${hex.slice(1)}`, hex, 'pane', merged));
  });

  const panesUnion = keep(allPanes.length ? CrossSection.union(allPanes) : CrossSection.square([0, 0]));
  const came = keep(outer.subtract(panesUnion));
  const cameSolid = keep(mirrorX(came).extrude(p.cameHeight));
  parts.push(toPart(cameSolid, 'came_lead_lines', '#1a1a1a', 'came', came));

  for (const o of trash) {
    try { o.delete(); } catch { /* already freed */ }
  }
  return { parts, pieceCount };
}
