/**
 * Trace region outlines along pixel edges ("crack following").
 *
 * Every pixel side that separates two regions becomes a directed edge, oriented so the
 * region lies consistently on one side. Edges are then chained into closed loops. Because
 * the winding number of a point depends only on the set of edges, not on how they are
 * chained at ambiguous corners, the loops are correct under a NonZero fill rule, holes
 * included. Neighbouring regions share exactly the same edges (with opposite direction).
 *
 * Returned coordinates are in pixel-corner units with y pointing down.
 */
export function traceRegions(ids: Int32Array, w: number, h: number, count: number): number[][][] {
  // Per region: map from start-vertex key -> list of end-vertex keys.
  const edges: Map<number, number[]>[] = Array.from({ length: count }, () => new Map());
  const W1 = w + 1;
  const key = (x: number, y: number) => y * W1 + x;
  const push = (r: number, a: number, b: number) => {
    const m = edges[r];
    const l = m.get(a);
    if (l) l.push(b); else m.set(a, [b]);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = ids[y * w + x];
      if (y === 0 || ids[(y - 1) * w + x] !== r) push(r, key(x + 1, y), key(x, y)); // top
      if (x === 0 || ids[y * w + x - 1] !== r) push(r, key(x, y), key(x, y + 1)); // left
      if (y === h - 1 || ids[(y + 1) * w + x] !== r) push(r, key(x, y + 1), key(x + 1, y + 1)); // bottom
      if (x === w - 1 || ids[y * w + x + 1] !== r) push(r, key(x + 1, y + 1), key(x + 1, y)); // right
    }
  }

  const out: number[][][] = [];
  for (let r = 0; r < count; r++) {
    const m = edges[r];
    const loops: number[][] = [];
    for (const [startKey, list] of m) {
      while (list.length) {
        const loop: number[] = [];
        let cur = startKey;
        let next = list.pop()!;
        // walk until we return to start
        for (let guard = 0; guard < 1e8; guard++) {
          loop.push(cur % W1, Math.floor(cur / W1));
          cur = next;
          if (cur === startKey) break;
          const l = m.get(cur);
          if (!l || !l.length) break; // should not happen for closed boundaries
          next = l.pop()!;
        }
        const simplified = dropCollinear(loop);
        if (simplified.length >= 6) loops.push(simplified);
      }
    }
    out.push(loops);
  }
  return out;
}

/** Remove points that lie on a straight run (flat array x0,y0,x1,y1,...). */
function dropCollinear(flat: number[]): number[] {
  const n = flat.length / 2;
  if (n < 3) return flat;
  const res: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n, q = (i + 1) % n;
    const ax = flat[i * 2] - flat[p * 2], ay = flat[i * 2 + 1] - flat[p * 2 + 1];
    const bx = flat[q * 2] - flat[i * 2], by = flat[q * 2 + 1] - flat[i * 2 + 1];
    if (ax * by - ay * bx !== 0) res.push(flat[i * 2], flat[i * 2 + 1]);
  }
  return res;
}
