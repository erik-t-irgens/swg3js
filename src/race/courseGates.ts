// The gates and the grid a drawn course places for you (the race drawer, `A:\swg3js\racedrawer\DESIGN.md` §2.9), and how
// they follow the road when it changes.
//
// **Where**: a circuit's start and finish (gate 0) at the main line's node 0; a sprint's gate 0 `gridAhead` along from its
// node 0 and its last gate at its end; between, a gate every `gateEvery` of arclength and one at the apex of every turn
// sharper than `gateTurn` over `gateTurnSpan`, never two nearer than `gateMin` along the road (the start and the end first,
// the apexes next, the spacing last). **Each gate** stands on the spine at its anchor, `gateLift` over the road's surface (a
// gate's place is a hull's middle), facing along the road and rolled by the road's bank about its own forward axis (worked in
// the game's frame and carried into the file's, so `turnHeading`, which the put-back reads, is the road's heading whatever
// the bank), as wide as the road there (held to the gates' limits) unless its width is its own (`ow`), as tall as the pod
// gate where pods race it, else the bike gate. Under a deck (the race drawer's second wave hands one) a gate is held so its
// window's top stands under it. **The grid** (a body's place) stands on the road facing along it: a circuit's `gridBack`
// back along the closing edge before gate 0, a sprint's at its node 0.
//
// **Anchored to an edge and a share of it**, never to a distance from node 0 (§2.9): an apex gate stays on its apex when an
// earlier stretch is lengthened. An insert or a delete of a node remaps the anchors of the edges it splits or merges by
// arclength and renumbers every later edge's (`remapAnchors`, over the maps `insertMap` and `deleteMap`).
//
// Pure: no page, no three. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

import { TRACK_LIMITS, courseSpines, pathEdges, type TrackDef, type TrackGate, type TrackPlace } from './trackFile.ts';
import { nearestOn, spineAt, spineNear, spinePoint, type Spine, type SpinePoint } from './coursePath.ts';
import { TRACK_TUNE } from './trackTune.ts';
import { COURSE_TUNE } from './courseTune.ts';

/** The numbers gates are placed by (the tune's, `gateRules`). */
export interface GateRules {
  gateEvery: number;
  gateTurn: number;
  gateTurnSpan: number;
  gateMin: number;
  gateLift: number;
  gridBack: number;
  gridAhead: number;
  podHeight: number;
  bikeHeight: number;
}

/** The rules as the tunes stand now. */
export function gateRules(): GateRules {
  const c = COURSE_TUNE;
  return { gateEvery: c.gateEvery, gateTurn: c.gateTurn, gateTurnSpan: c.gateTurnSpan, gateMin: c.gateMin, gateLift: c.gateLift, gridBack: c.gridBack, gridAhead: c.gridAhead, podHeight: TRACK_TUNE.podGateHeight, bikeHeight: TRACK_TUNE.bikeGateHeight };
}

/**
 * Where a deck of a path stands over a point of its road, or -Infinity for none: the second wave's carve answers it (a road
 * over a crossing's gap); with none handed every gate stands as tall as its kind's.
 */
export type DeckAt = (path: string, e: number, t: number) => number;

/** A share rounded as written: a millionth (an edge of four kilometres is then placed to four millimetres). */
export function roundShare(t: number): number {
  return Math.round(Math.max(0, Math.min(1, t)) * 1e6) / 1e6 + 0;
}

// Plus nought: a negative nought written is read back a positive one, and the track read would differ from the one written.
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * A place's turn in the file's (raw) frame from the road's tangent there in that frame and its bank's tan: the heading in the
 * game's frame (which mirrors x, so the game's tangent is `(-tx, tz)` and the heading `atan2(-tx, tz)`), then a roll of the
 * bank about the place's own forward axis, the driver's right (its -X: the models stand mirrored) going up for a bank above
 * nought, carried into the file's `[w, x, y, z]` as `fromGame` carries a turn: `[w, x, -y, -z]`.
 */
export function roadTurn(tx: number, tz: number, tb: number): [number, number, number, number] {
  const h = Math.atan2(-tx, tz);
  // A roll about +Z by phi lifts +X: the driver's right is -X, so a bank up on the right is phi = -bank.
  const phi = -Math.atan(tb);
  const sH = Math.sin(h / 2);
  const cH = Math.cos(h / 2);
  const sR = Math.sin(phi / 2);
  const cR = Math.cos(phi / 2);
  // q = heading * roll in three's order: (sH sR, cR sH, cH sR, cH cR).
  // Plus nought on each: a negative nought would be written as a nought and read back otherwise than the turn made.
  return [cH * cR + 0, sH * sR + 0, -(cR * sH) + 0, -(cH * sR) + 0];
}

/** Where along a path's spine a global arclength from node 0 falls: its edge and the share of that edge. */
export function locateAlong(sp: Spine, s: number, out: { e: number; t: number }): { e: number; t: number } {
  const n = sp.edges.length;
  if (!n) {
    out.e = 0;
    out.t = 0;
    return out;
  }
  let g = s;
  if (sp.closed && sp.length > 0) g = ((g % sp.length) + sp.length) % sp.length;
  g = Math.max(0, Math.min(sp.length, g));
  let e = n - 1;
  for (let k = 0; k < n; k++) {
    if (g < sp.start[k] + sp.edges[k].len) {
      e = k;
      break;
    }
  }
  const L = sp.edges[e].len;
  out.e = e;
  out.t = L > 0 ? Math.max(0, Math.min(1, (g - sp.start[e]) / L)) : 0;
  return out;
}

/** The global arclength from node 0 of an anchor on a spine. */
export function alongOf(sp: Spine, e: number, t: number): number {
  const ed = sp.edges[e];
  return ed ? sp.start[e] + t * ed.len : 0;
}

/** A gate placed on a spine at an anchor: on the road there, `lift` over its surface, facing along it, rolled by its bank. */
export function gateOnSpine(sp: Spine, path: string, e: number, t: number, size: { w: number | null; h: number; ow?: 1 }, lift: number, deck: number, P: SpinePoint = spinePoint()): TrackGate {
  spineAt(sp, e, t, P);
  const y = P.y + lift;
  let h = size.h;
  // Under a deck the window's top stands under it (its top is seven eighths of its height over its place).
  if (Number.isFinite(deck) && deck > y) h = Math.max(TRACK_LIMITS.heightLeast, Math.min(h, ((deck - y) * 8) / 7));
  const w = size.w !== null ? size.w : Math.min(TRACK_LIMITS.widthMost, Math.max(TRACK_LIMITS.widthLeast, r2(P.hw * 2)));
  // The place to the centimetre; the turn as worked out, a unit turn to the last bit (rounded, the reader would put it
  // back to unit length on reading, and the row read back would differ from the row written).
  const g: TrackGate = { x: r2(P.x), y: r2(y), z: r2(P.z), q: roadTurn(P.tx, P.tz, P.tb), w: r2(w), h: r2(h) };
  g.path = path;
  g.e = e;
  g.t = roundShare(t);
  if (size.ow) g.ow = 1;
  return g;
}

/** The grid placed on a spine at an anchor: on the road's surface there, facing along it (no roll: a body stands upright). */
export function gridOnSpine(sp: Spine, path: string, e: number, t: number, P: SpinePoint = spinePoint()): TrackPlace {
  spineAt(sp, e, t, P);
  const g: TrackPlace = { x: r2(P.x), y: r2(P.y), z: r2(P.z), q: roadTurn(P.tx, P.tz, 0) };
  g.path = path;
  g.e = e;
  g.t = roundShare(t);
  return g;
}

/** The height a placed gate takes on a track: the pod gate's where pods race it, else the bike gate's. */
export function gateHeightFor(t: Pick<TrackDef, 'for'>, rules: GateRules): number {
  return t.for.includes('podracer') ? rules.podHeight : rules.bikeHeight;
}

/**
 * The global arclengths of the apexes of every turn sharper than `turnDeg` over `span` metres along a spine: at each sample
 * the heading's change between `span / 2` back and `span / 2` on (wrapping on a closed spine, held at the ends of an open
 * one), each run of samples past the threshold one turn, its apex where the change is greatest.
 */
export function turnApexes(sp: Spine, span: number, turnDeg: number): number[] {
  const gs: number[] = [];
  const hd: number[] = [];
  for (let e = 0; e < sp.edges.length; e++) {
    const ed = sp.edges[e];
    for (let i = 0; i + 1 < ed.count; i++) {
      gs.push(sp.start[e] + ed.s[i]);
      hd.push(Math.atan2(ed.x[i + 1] - ed.x[i], ed.z[i + 1] - ed.z[i]));
    }
  }
  const n = gs.length;
  if (n < 2) return [];
  const headingAt = (s: number): number => {
    let g = s;
    if (sp.closed) g = ((g % sp.length) + sp.length) % sp.length;
    else g = Math.max(0, Math.min(sp.length, g));
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (gs[mid] <= g) lo = mid;
      else hi = mid - 1;
    }
    return hd[lo];
  };
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const limit = (turnDeg * Math.PI) / 180;
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) turn[i] = Math.abs(wrap(headingAt(gs[i] + span / 2) - headingAt(gs[i] - span / 2)));
  const out: number[] = [];
  let i = 0;
  // On a closed spine a run may wrap: begin at a sample under the threshold, if there is one.
  let first = 0;
  if (sp.closed) {
    while (first < n && turn[first] > limit) first++;
    if (first === n) return [];
  }
  for (let k = 0; k < n; ) {
    i = (first + k) % n;
    if (turn[i] <= limit) {
      k++;
      continue;
    }
    let best = i;
    while (k < n && turn[(first + k) % n] > limit) {
      const j = (first + k) % n;
      if (turn[j] > turn[best]) best = j;
      k++;
    }
    out.push(gs[best]);
  }
  return out;
}

/** The distance along a spine between two global arclengths: round the short way on a closed spine. */
function apart(sp: Spine, a: number, b: number): number {
  const d = Math.abs(a - b);
  return sp.closed ? Math.min(d, sp.length - d) : d;
}

/**
 * The arclengths along the main line a fresh set of gates stands at (§2.9), in the order they are raced: the start (and a
 * sprint's end) first, then the apexes, then the spacing, each kept only where none kept already stands within `gateMin`;
 * at least two, at most `TRACK_LIMITS.gates`.
 */
export function gateAlongs(sp: Spine, sprint: boolean, rules: GateRules): number[] {
  const len = sp.length;
  const start = sprint ? Math.min(rules.gridAhead, len / 2) : 0;
  const kept: number[] = [start];
  if (sprint) kept.push(len);
  const fits = (s: number) => kept.every((k) => apart(sp, k, s) >= rules.gateMin);
  for (const s of turnApexes(sp, rules.gateTurnSpan, rules.gateTurn)) if ((!sprint || (s > start && s < len)) && fits(s)) kept.push(s);
  if (rules.gateEvery > 0) {
    const end = sprint ? len : len + start;
    for (let s = start + rules.gateEvery; s < end - 1e-6; s += rules.gateEvery) {
      const g = sprint ? s : s % len;
      if (fits(g)) kept.push(g);
    }
  }
  if (kept.length < TRACK_LIMITS.gatesLeast) kept.push(sprint ? len : (start + len / 2) % len);
  // In the order raced: from the start round (a circuit) or along (a sprint).
  const ord = (s: number) => (sprint ? s : (s - start + len) % len);
  kept.sort((a, b) => ord(a) - ord(b));
  return kept.slice(0, TRACK_LIMITS.gates);
}

/**
 * A fresh set of gates and a grid for a track's drawn course, its main line's (§2.9): each anchored, so it follows the road.
 * `deckAt` (the second wave's) holds a gate under a deck. Answers them and the notes (a gate that cannot fit under a deck).
 */
export function placeGates(t: TrackDef, rules: GateRules = gateRules(), deckAt?: DeckAt): { gates: TrackGate[]; grid: TrackPlace; notes: string[] } {
  const notes: string[] = [];
  const sp = courseSpines(t)[0];
  const main = t.course!.paths[0].id;
  const sprint = t.kind === 'sprint';
  const at = { e: 0, t: 0 };
  const P = spinePoint();
  const h = gateHeightFor(t, rules);
  const gates = gateAlongs(sp, sprint, rules).map((s, i) => {
    locateAlong(sp, s, at);
    const deck = deckAt ? deckAt(main, at.e, at.t) : -Infinity;
    const g = gateOnSpine(sp, main, at.e, at.t, { w: null, h }, rules.gateLift, deck, P);
    if (Number.isFinite(deck) && deck - g.y < (TRACK_LIMITS.heightLeast * 7) / 8) notes.push(`gate ${i} under the crossing has ${Math.max(0, deck - g.y).toFixed(1)} m of clearance`);
    return g;
  });
  locateAlong(sp, sprint ? 0 : -rules.gridBack, at);
  const grid = gridOnSpine(sp, main, at.e, at.t, P);
  return { gates, grid, notes };
}

/**
 * Every gate and the grid that carries an anchor placed again on its path's spine (its place, its turn and, unless `ow`, its
 * width; its height held under a deck), the rest exactly as they are: what every edit of a course does in the same row, so a
 * following gate is never left off its road. An anchor on an edge a path no longer has is put at the end of its last.
 */
export function followCourse(t: TrackDef, rules: GateRules = gateRules(), deckAt?: DeckAt): TrackDef {
  if (!t.course) return t;
  const spines = courseSpines(t);
  const byId = new Map(t.course.paths.map((p, i) => [p.id, i]));
  const P = spinePoint();
  const gates = t.gates.map((g) => {
    if (g.path === undefined) return g;
    const p = byId.get(g.path);
    if (p === undefined) return g;
    const edges = pathEdges(t.course!, p, t.kind);
    const e = Math.min(g.e ?? 0, edges - 1);
    const share = (g.e ?? 0) > edges - 1 ? 1 : (g.t ?? 0);
    const deck = deckAt ? deckAt(g.path, e, share) : -Infinity;
    return gateOnSpine(spines[p], g.path, e, share, { w: g.ow ? g.w : null, h: g.h, ow: g.ow }, rules.gateLift, deck, P);
  });
  let grid = t.grid;
  if (grid.path !== undefined) {
    const p = byId.get(grid.path);
    if (p !== undefined) {
      const edges = pathEdges(t.course, p, t.kind);
      const e = Math.min(grid.e ?? 0, edges - 1);
      grid = gridOnSpine(spines[p], grid.path, e, (grid.e ?? 0) > edges - 1 ? 1 : (grid.t ?? 0), P);
    }
  }
  return { ...t, grid, gates };
}

/**
 * Place gates again (§2.9): every following gate placed again, and the spacing's gates (and the apexes') added where none
 * stands within `gateMin` along the main line, each put in after the last gate before it along the road, so the order raced
 * stays the road's. A gate moved by hand (no anchor) is measured by where it stands nearest the road, and never moved.
 */
export function gatesAgain(t: TrackDef, rules: GateRules = gateRules(), deckAt?: DeckAt): TrackDef {
  if (!t.course) return t;
  const followed = followCourse(t, rules, deckAt);
  const sp = courseSpines(followed)[0];
  const main = followed.course!.paths[0].id;
  const sprint = followed.kind === 'sprint';
  const start = sprint ? Math.min(rules.gridAhead, sp.length / 2) : 0;
  const ord = (s: number) => (sprint ? s : (s - start + sp.length) % sp.length);
  const near = spineNear();
  // Where each gate stands along the main line (one on another path, or far off the road, along nothing).
  const alongOfGate = (g: TrackGate): number => {
    if (g.path === main) return alongOf(sp, g.e ?? 0, g.t ?? 0);
    if (g.path !== undefined) return Number.NaN;
    if (!nearestOn(sp, g.x, g.z, near) || near.d > near.hw + rules.gateMin) return Number.NaN;
    return alongOf(sp, near.e, near.t);
  };
  const gates = [...followed.gates];
  const along = gates.map(alongOfGate);
  const at = { e: 0, t: 0 };
  const P = spinePoint();
  const h = gateHeightFor(followed, rules);
  for (const s of gateAlongs(sp, sprint, rules)) {
    if (gates.length >= TRACK_LIMITS.gates) break;
    if (along.some((a) => Number.isFinite(a) && apart(sp, a, s) < rules.gateMin)) continue;
    locateAlong(sp, s, at);
    const deck = deckAt ? deckAt(main, at.e, at.t) : -Infinity;
    const g = gateOnSpine(sp, main, at.e, at.t, { w: null, h }, rules.gateLift, deck, P);
    // After the last gate before it along the road (gate 0's place counts as the start).
    let after = -1;
    for (let i = 0; i < gates.length; i++) if (Number.isFinite(along[i]) && ord(along[i]) <= ord(s) && (after < 0 || ord(along[i]) >= ord(along[after]))) after = i;
    gates.splice(after + 1, 0, g);
    along.splice(after + 1, 0, s);
  }
  return { ...followed, gates };
}

/** A map of an anchor's edge and share from a path before an edit to the path after it. */
export type AnchorMap = (e: number, t: number) => { e: number; t: number };

/**
 * The map of a node put in on edge `k` at `u` of its arclength (`oldLen` its length before, `l1` and `l2` the two edges it
 * became): an anchor on that edge keeps its arclength from the node it leaves (on the first) or from the new node (on the
 * second); an anchor on a later edge is renumbered.
 */
export function insertMap(k: number, u: number, oldLen: number, l1: number, l2: number): AnchorMap {
  return (e, t) => {
    if (e < k) return { e, t };
    if (e > k) return { e: e + 1, t };
    const a = t * oldLen;
    const split = u * oldLen;
    if (a <= split) return { e: k, t: l1 > 0 ? Math.min(1, a / l1) : 0 };
    return { e: k + 1, t: l2 > 0 ? Math.min(1, (a - split) / l2) : 1 };
  };
}

/**
 * The map of node `k` taken out of a path of `n` nodes (`closed` or not), `lens` its edges' lengths before: the two edges
 * either side of it become one, an anchor on either keeping its share of their joined arclength; an anchor on an end edge an
 * open path loses goes to the new end; every other edge renumbered by the node it leaves.
 */
export function deleteMap(k: number, n: number, closed: boolean, lens: readonly number[]): AnchorMap {
  const newNode = (j: number) => (j < k ? j : j - 1);
  const inE = closed ? (k - 1 + n) % n : k - 1;
  const outE = closed || k < n - 1 ? k : -1;
  return (e, t) => {
    if (inE >= 0 && outE >= 0 && (e === inE || e === outE)) {
      const L = lens[inE] + lens[outE];
      const a = e === inE ? t * lens[inE] : lens[inE] + t * lens[outE];
      return { e: newNode(inE), t: L > 0 ? a / L : 0 };
    }
    // An open path's first node taken out: its edge is gone, and a gate on it stands at the new start.
    if (e === outE && inE < 0) return { e: 0, t: 0 };
    // Its last: the gate stands at the new end.
    if (e === inE && outE < 0) return { e: Math.max(0, inE - 1), t: 1 };
    return { e: newNode(e), t };
  };
}

/** Every gate's and the grid's anchor on path `path` carried through `map` (the shares rounded as written). */
export function remapAnchors(t: TrackDef, path: string, map: AnchorMap): TrackDef {
  const move = <P extends TrackPlace>(g: P): P => {
    if (g.path !== path) return g;
    const m = map(g.e ?? 0, g.t ?? 0);
    return { ...g, e: m.e, t: roundShare(m.t) };
  };
  return { ...t, grid: move(t.grid), gates: t.gates.map(move) };
}

/** Gate `i` anchored again to the road nearest it, on whichever path is nearest, its width the road's again (`ow` dropped). */
export function followGate(t: TrackDef, i: number, rules: GateRules = gateRules(), deckAt?: DeckAt): TrackDef | string {
  if (!t.course) return `${t.id} has no course to follow`;
  const g = t.gates[i];
  if (!g) return `there is no gate ${i}: the gates are 0 to ${t.gates.length - 1}`;
  const spines = courseSpines(t);
  const near = spineNear();
  let best = -1;
  let bestD = Infinity;
  let be = 0;
  let bt = 0;
  for (let p = 0; p < spines.length; p++) {
    if (!nearestOn(spines[p], g.x, g.z, near)) continue;
    if (near.d < bestD) {
      bestD = near.d;
      best = p;
      be = near.e;
      bt = near.t;
    }
  }
  if (best < 0) return 'no road to follow';
  const path = t.course.paths[best].id;
  const deck = deckAt ? deckAt(path, be, bt) : -Infinity;
  const ng = gateOnSpine(spines[best], path, be, bt, { w: null, h: g.h }, rules.gateLift, deck);
  return { ...t, gates: t.gates.map((x, k) => (k === i ? ng : x)) };
}
