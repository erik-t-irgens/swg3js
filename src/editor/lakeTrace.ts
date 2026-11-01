// A lake's outline traced at a level (Map-maker II, DESIGN.md §2.7, its fifth wave): the ground under the level flooded from
// a seed at the ground's own 2 m, the flooded ground's boundary walked (marching squares, each crossing put between its two
// samples where the ground meets the level), and the walk simplified (Douglas-Peucker) to at most `most` points within
// `tolerance` metres, the tolerance doubled until it fits (the client's own lake outlines run to about 50 points).
//
// Only the seed's own flood is walked: another hollow under the level that the flood never reaches is not this lake, and
// a sample of it beside the flood's edge is read as dry ground. A flood that reaches the square of `reach` metres round
// the seed spilled: the level is higher than the basin's rim, and the trace says so rather than flooding a valley.
//
// Pure: heights in through `heightAt`, numbers out. Rule for this file (node runs it with type stripping): every import with
// its `.ts` extension, no enum, no namespace, no constructor parameter properties. The dev server's alone: reached only
// through the editor's own dynamic import.

/** What a trace is asked: its seed and level (the game's frame), the ground's step, how far it may flood and how far to simplify. */
export interface TraceAsk {
  x: number;
  z: number;
  /** The level: the ground under it is flooded. */
  h: number;
  /** Metres between samples (the ground's own 2 m). */
  step: number;
  /** The most metres the flood reaches from the seed either way before it is said to spill. */
  reach: number;
  /** The most points the outline keeps. */
  most: number;
  /** Metres an outline point may stand off the walked boundary when simplified (the first try; doubled until it fits). */
  tolerance: number;
}

/** What a trace came to. */
export interface TraceResult {
  /** The outline in the game's frame, `[x, z]` a point, or none. */
  points: [number, number][];
  /** Square metres inside the outline. */
  area: number;
  /** Samples flooded, and how many points the walk had before it was simplified. */
  cells: number;
  walked: number;
  /** The tolerance the outline was simplified at. */
  tolerance: number;
  /** Why there is no outline, or null. */
  why: string | null;
}

/** The area of a closed outline (shoelace), its sign dropped. */
export function outlineArea(pts: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2;
}

/** How far a point stands off the segment a..b. */
function offSegment(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a[0] + t * dx - p[0];
  const z = a[1] + t * dz - p[1];
  return Math.sqrt(x * x + z * z);
}

/** Douglas-Peucker over an open run of points (its two ends kept), into `keep`. */
function simplifyRun(pts: readonly [number, number][], i0: number, i1: number, tol: number, keep: Uint8Array): void {
  let worst = -1;
  let at = -1;
  for (let i = i0 + 1; i < i1; i++) {
    const d = offSegment(pts[i], pts[i0], pts[i1]);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (at < 0 || worst <= tol) return;
  keep[at] = 1;
  simplifyRun(pts, i0, at, tol, keep);
  simplifyRun(pts, at, i1, tol, keep);
}

/**
 * A closed outline simplified within `tol` metres (Douglas-Peucker, cut at the point farthest from the first so the loop's
 * two halves are simplified each as a run), never under three points.
 */
export function simplifyLoop(pts: readonly [number, number][], tol: number): [number, number][] {
  const n = pts.length;
  if (n <= 3) return pts.map((p) => [p[0], p[1]] as [number, number]);
  let far = 0;
  let best = -1;
  for (let i = 1; i < n; i++) {
    const dx = pts[i][0] - pts[0][0];
    const dz = pts[i][1] - pts[0][1];
    const d = dx * dx + dz * dz;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const ring = [...pts, pts[0]];
  const keep = new Uint8Array(n + 1);
  keep[0] = 1;
  keep[far] = 1;
  keep[n] = 1;
  simplifyRun(ring, 0, far, tol, keep);
  simplifyRun(ring, far, n, tol, keep);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push([pts[i][0], pts[i][1]]);
  return out.length >= 3 ? out : pts.slice(0, 3).map((p) => [p[0], p[1]] as [number, number]);
}

/**
 * The outline of the ground under `ask.h` flooded from the seed (`TraceAsk`), in the game's frame. Answers no points and
 * why where the seed stands over the level, the flood spills past `reach`, or the walk finds no closed boundary.
 */
export function traceLake(heightAt: (x: number, z: number) => number, ask: TraceAsk): TraceResult {
  const s = ask.step > 0.25 ? ask.step : 0.25;
  const none = (why: string, cells = 0): TraceResult => ({ points: [], area: 0, cells, walked: 0, tolerance: ask.tolerance, why });
  // The samples stand on the step's own lattice, the seed's nearest one in the middle of a square `reach` either way.
  const half = Math.max(2, Math.ceil(ask.reach / s));
  const n = half * 2 + 1;
  const ox = Math.round(ask.x / s) * s - half * s;
  const oz = Math.round(ask.z / s) * s - half * s;
  // Each sample's level less its ground, kept in single precision (a few hundred metres either way to well under a
  // millimetre, and half the bytes: a reach of 3 km at 2 m is nine million samples), NaN until asked.
  const v = new Float32Array(n * n).fill(Number.NaN);
  const value = (i: number, j: number): number => {
    const k = j * n + i;
    let a = v[k];
    if (a !== a) {
      const g = heightAt(ox + i * s, oz + j * s);
      v[k] = Number.isFinite(g) ? ask.h - g : -1;
      a = v[k];
    }
    return a;
  };
  if (!(value(half, half) > 0)) return none('the seed stands at or over the level: nothing under it to flood');
  // The flood, four-neighbour: every sample under the level reached from the seed.
  const wet = new Uint8Array(n * n);
  // The flood's stack grows as it needs (a whole square's worth up front was four bytes a sample more).
  const stack: number[] = [];
  let cells = 0;
  let spilled = false;
  stack.push(half * n + half);
  wet[half * n + half] = 1;
  while (stack.length > 0) {
    const k = stack.pop() as number;
    cells++;
    const j = (k / n) | 0;
    const i = k - j * n;
    if (i === 0 || j === 0 || i === n - 1 || j === n - 1) {
      spilled = true;
      continue;
    }
    for (let d = 0; d < 4; d++) {
      const ii = d === 0 ? i - 1 : d === 1 ? i + 1 : i;
      const jj = d === 2 ? j - 1 : d === 3 ? j + 1 : j;
      const kk = jj * n + ii;
      if (wet[kk] || !(value(ii, jj) > 0)) continue;
      wet[kk] = 1;
      stack.push(kk);
    }
  }
  if (spilled) return none(`the level spills past ${Math.round(half * s)} m from the seed: it is higher than the basin's rim (lower it, or move the seed)`, cells);
  // Marching squares over the flood: a sample is in where the flood reached it (its own value), out otherwise (a hollow the
  // flood never reached reads as just under the dry side, so its crossing stands at the dry sample).
  const inside = (i: number, j: number): number => (wet[j * n + i] ? v[j * n + i] : Math.min(-1e-6, v[j * n + i] === v[j * n + i] ? v[j * n + i] : -1));
  // Each crossing named by its edge (`2 k` the edge from sample k to its +x neighbour, `2 k + 1` to its +z one), placed where
  // the ground meets the level between its two samples.
  const point = new Map<number, [number, number]>();
  const edgeAt = (i: number, j: number, dir: 0 | 1): number => {
    const key = (j * n + i) * 2 + dir;
    if (!point.has(key)) {
      const a = inside(i, j);
      const b = dir === 0 ? inside(i + 1, j) : inside(i, j + 1);
      const t = a / (a - b);
      const tt = t > 0 && t < 1 ? t : 0.5;
      point.set(key, dir === 0 ? [ox + (i + tt) * s, oz + j * s] : [ox + i * s, oz + (j + tt) * s]);
    }
    return key;
  };
  // The boundary walked with the flood on one side: each segment from the edge it enters by to the edge it leaves by.
  const next = new Map<number, number>();
  const link = (a: number, b: number): void => {
    next.set(a, b);
  };
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const c00 = inside(i, j) > 0 ? 1 : 0;
      const c10 = inside(i + 1, j) > 0 ? 1 : 0;
      const c11 = inside(i + 1, j + 1) > 0 ? 1 : 0;
      const c01 = inside(i, j + 1) > 0 ? 1 : 0;
      const code = c00 | (c10 << 1) | (c11 << 2) | (c01 << 3);
      if (code === 0 || code === 15) continue;
      const S = () => edgeAt(i, j, 0);
      const E = () => edgeAt(i + 1, j, 1);
      const N = () => edgeAt(i, j + 1, 0);
      const W = () => edgeAt(i, j, 1);
      // Oriented so the flood is always on the walk's right (x east, z up the page): a loop round a lake runs one way, round
      // an island the other, and every crossing is left by exactly one segment, so each loop closes.
      switch (code) {
        case 1: link(W(), S()); break;
        case 2: link(S(), E()); break;
        case 3: link(W(), E()); break;
        case 4: link(E(), N()); break;
        case 5: {
          // A saddle: the cell's middle decides whether the two wet corners join.
          const mid = (inside(i, j) + inside(i + 1, j) + inside(i + 1, j + 1) + inside(i, j + 1)) / 4;
          if (mid > 0) {
            link(W(), N());
            link(E(), S());
          } else {
            link(W(), S());
            link(E(), N());
          }
          break;
        }
        case 6: link(S(), N()); break;
        case 7: link(W(), N()); break;
        case 8: link(N(), W()); break;
        case 9: link(N(), S()); break;
        case 10: {
          const mid = (inside(i, j) + inside(i + 1, j) + inside(i + 1, j + 1) + inside(i, j + 1)) / 4;
          if (mid > 0) {
            link(S(), W());
            link(N(), E());
          } else {
            link(S(), E());
            link(N(), W());
          }
          break;
        }
        case 11: link(N(), E()); break;
        case 12: link(E(), W()); break;
        case 13: link(E(), S()); break;
        case 14: link(S(), W()); break;
      }
    }
  }
  // Every loop walked; the longest is the lake's own shore (the rest are islands in it, which a level surface over an
  // island's ground is hidden under anyway: the ground stands higher there).
  const seen = new Set<number>();
  let longest: number[] = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let k: number | undefined = start;
    while (k !== undefined && !seen.has(k)) {
      seen.add(k);
      loop.push(k);
      k = next.get(k);
    }
    if (k === start && loop.length > longest.length) longest = loop;
  }
  if (longest.length < 3) return none('the flood found no closed shore', cells);
  const walked = longest.map((k) => point.get(k)!);
  let tol = Math.max(0.01, ask.tolerance);
  let pts = simplifyLoop(walked, tol);
  const most = Math.max(3, Math.floor(ask.most));
  for (let guard = 0; pts.length > most && guard < 40; guard++) {
    tol *= 2;
    pts = simplifyLoop(walked, tol);
  }
  return { points: pts, area: outlineArea(pts), cells, walked: walked.length, tolerance: tol, why: null };
}
