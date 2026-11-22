// The rings drawn or left out by distance, the same in every direction (the owner's report of 21 November: on Naboo at
// Kaadara, some 150 m up with the far settings near their tops and Finer levels on, the ground just in front was missing
// looking south, half of it looking east and west, and looking north the far ground answered the Terrain distance
// backwards; on Mustafar the same). Held here from world positions alone, never from the selection's own lattice or order:
// an eye over flat ground, a camera looking north, south, east and west in turn, and ground points ahead at known distances
// and bearings; a point the camera's own frustum holds (three's planes, not the game's), past the standing chunks and inside
// the reach, must stand under exactly one drawn patch, in every direction alike. 8a7de51's selection held 32,768 patches and
// dropped whatever its walk came to last, the walk going by rows of roots from south to north: past its room it lost the
// nearest ground looking south and the farthest looking north. Held besides: the owner's own view (45 degrees on a screen
// of 3,840 by 1,431, his Morph share of 0.6, a view radius of 9) drawn whole; what a room too small on purpose leaves out
// is the farthest ground, cut at one distance on every bearing of every view (a square cut would reach a diagonal 41% past
// an axis), nothing nearer; and the room the game makes holds every patch the offered settings and the horizon dials'
// ends select all round, nothing culled. 8a7de51's own selection is loaded out of git and shown failing each.
//
// Run: node tools/swg/tests/horizonDirections.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as TODAY from '../../../src/world/horizon/horizonMath.ts';
import { testHole, testPyramid } from './horizonFixtures.ts';
import { loadOldMany } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

type M = typeof TODAY;
const BEFORE = '8a7de51';
const shift = { x: 1, z: 0 };
// Flat ground at nought, so the four directions stand alike by construction (the pyramid bounds it a few metres round).
const pyr = testPyramid(24000, shift, () => 0);
const hole = new TODAY.HoleGrid();
const RADIUS = 6;
const saved = { ...TODAY.HORIZON_TUNE };
// The ground is a square of 64 m chunks to the game (`LEAF` is the chunk's side the hole is counted in, not the rings' lattice).
const CHUNK = 64;

/** The selection's ask as the field fills it (`HorizonField.update`'s first lines), by the module's own rules. */
function askFor(m: M, eye: THREE.Vector3, side: number, bakeStep: number, radius = RADIUS): TODAY.RingAsk {
  const rules = m.newReachRules();
  rules.fogDensity = 0;
  rules.side = side;
  rules.bakeStep = bakeStep;
  m.reachRules(m.HORIZON_TUNE, radius, true, rules);
  const pcx = Math.floor(eye.x / CHUNK);
  const pcz = Math.floor(eye.z / CHUNK);
  return {
    ex: eye.x, ey: eye.y, ez: eye.z, reach: rules.inForce, lod0: rules.lod0, levels: rules.levels, morph: m.HORIZON_TUNE.morph, edgeBand: m.HORIZON_TUNE.edgeBand, drop: m.HORIZON_TUNE.drop,
    shiftX: shift.x, shiftZ: shift.z, cx0: pcx - radius - 1, cx1: pcx + radius + 1, cz0: pcz - radius - 1, cz1: pcz + radius + 1,
    finest: rules.finest, r1: rules.r1, r2: rules.r2, pad: rules.finest < 0 ? m.HORIZON_TUNE.shapePad : 0,
  };
}

/** The four compass directions in the game's frame: north is +z (the raw frame's too), east -x (the raw frame's x runs the other way). */
const DIRS = [['north', 0, 1], ['south', 0, -1], ['east', -1, 0], ['west', 1, 0]] as const;
const EYE = { x: 37.5, z: -21.25 };

interface View {
  fov: number;
  aspect: number;
  up: number;
  pitch: number;
  radius?: number;
}

/** A camera at the eye looking along a direction, reversed depth as the game's, and three's own frustum of it (the reference). */
function cameraFor(v: View, dx: number, dz: number): { cam: THREE.PerspectiveCamera; three: THREE.Frustum } {
  const cam = new THREE.PerspectiveCamera(v.fov, v.aspect, 0.05, 40000);
  Object.defineProperty(cam, 'reversedDepth', { value: true });
  cam.updateProjectionMatrix();
  cam.position.set(EYE.x, v.up, EYE.z);
  // Three's cameras look down -z: a yaw of atan2(-dx, -dz) turns that onto (dx, dz).
  cam.rotation.set(v.pitch, Math.atan2(-dx, -dz), 0, 'YXZ');
  cam.updateMatrixWorld();
  const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const three = new THREE.Frustum().setFromProjectionMatrix(pv, cam.coordinateSystem, true);
  return { cam, three };
}

/** Inside every plane of three's frustum by a metre (a point on a plane's edge is no evidence either way). */
function holds(f: THREE.Frustum, p: THREE.Vector3): boolean {
  for (const pl of f.planes) if (pl.distanceToPoint(p) < 1) return false;
  return true;
}

/** How many drawn patches stand over a game point (each patch a square of eight quads from its corner, by its level). */
function under(sel: TODAY.RingSelector, x: number, z: number): number {
  let n = 0;
  const p = sel.patches;
  for (let k = 0; k < sel.patchCount; k++) {
    const L = p[k * 4 + 2];
    const size = 64 * 2 ** L;
    const x0 = p[k * 4];
    const z0 = p[k * 4 + 1];
    if (x >= x0 && x < x0 + size && z >= z0 && z < z0 + size) n++;
  }
  return n;
}

/** One selection of a view along a direction, the hole the view radius stands round the eye. */
function selectView(m: M, sel: TODAY.RingSelector, v: View, dx: number, dz: number, side: number, bakeStep: number): { three: THREE.Frustum; ask: TODAY.RingAsk } {
  const { cam, three } = cameraFor(v, dx, dz);
  const ask = askFor(m, cam.position, side, bakeStep, v.radius ?? RADIUS);
  testHole(hole, Math.floor(EYE.x / CHUNK), Math.floor(EYE.z / CHUNK), v.radius ?? RADIUS);
  const f = new THREE.Frustum();
  m.cameraFrustum(cam, new THREE.Matrix4(), f);
  sel.select(f, ask, pyr, hole);
  return { three, ask };
}

/**
 * One view along each direction: the distances straight ahead whose ground point the reference says must be drawn, and
 * which of them are not (none, or one patch over another). Answers per direction the distances missed and the overflow.
 */
function look(m: M, sel: TODAY.RingSelector, v: View, side: number, bakeStep: number, distances: number[]): { missed: Record<string, number[]>; tested: number; overflow: number; patches: number } {
  const missed: Record<string, number[]> = {};
  let tested = 0;
  let overflow = 0;
  let patches = 0;
  for (const [name, dx, dz] of DIRS) {
    const { three, ask } = selectView(m, sel, v, dx, dz, side, bakeStep);
    overflow = Math.max(overflow, sel.overflow);
    patches = Math.max(patches, sel.patchCount + sel.overflow);
    missed[name] = [];
    for (const d of distances) {
      if (d > ask.reach * 0.95) continue;
      const p = new THREE.Vector3(EYE.x + dx * d, 0, EYE.z + dz * d);
      if (!holds(three, p)) continue;
      tested++;
      if (under(sel, p.x, p.z) !== 1) missed[name].push(d);
    }
  }
  return { missed, tested, overflow, patches };
}

/** The Graphics page's tops (the window of 2,048 at its 1.55 km, a 4 m bake) and a Terrain distance. */
function tops(m: M, reach: number, morph = saved.morph): void {
  m.HORIZON_TUNE.shape = true;
  m.HORIZON_TUNE.shapeReach = 1550;
  m.HORIZON_TUNE.reach = reach;
  m.HORIZON_TUNE.morph = morph;
}

// Ground points straight ahead from just past the standing chunks to the reach: a view radius of 6 stands its chunks to 427 m
// of the eye along an axis, the owner's 9 to 618 m (the rings' ground begins there; the points nearest it are the ones his
// south view lost).
const NEAR_TO_FAR: number[] = [];
for (let d = 500; d <= 16000; d += d < 3000 ? 50 : 250) NEAR_TO_FAR.push(d);
const HIS_NEAR_TO_FAR = NEAR_TO_FAR.filter((d) => d >= 650);

const VIEWS: View[] = [];
for (const fov of [60, 80, 100]) for (const aspect of [16 / 9, 21 / 9]) for (const up of [2, 150]) for (const pitch of [-0.05, -0.3]) VIEWS.push({ fov, aspect, up, pitch });

/** Every view at the tops (16 km and 8 km) with the room the game makes: what each direction missed, summed. */
function atTops(m: M): { tested: number; missed: Record<string, number>; nearSouth: number; farNorth: number; overflowViews: number; most: number; cap: number } {
  const sel = new m.RingSelector();
  const missed: Record<string, number> = { north: 0, south: 0, east: 0, west: 0 };
  let tested = 0;
  let nearSouth = 0;
  let farNorth = 0;
  let overflowViews = 0;
  let most = 0;
  for (const reach of [16000, 8000]) {
    tops(m, reach);
    for (const v of VIEWS) {
      const r = look(m, sel, v, 2048, 4, NEAR_TO_FAR);
      tested += r.tested;
      if (r.overflow > 0) overflowViews++;
      most = Math.max(most, r.patches);
      for (const k of Object.keys(missed)) missed[k] += r.missed[k].length;
      nearSouth += r.missed.south.filter((d) => d <= 1500).length;
      farNorth += r.missed.north.filter((d) => d >= 6000).length;
    }
  }
  Object.assign(m.HORIZON_TUNE, saved);
  return { tested, missed, nearSouth, farNorth, overflowViews, most, cap: sel.patchCap };
}

/** The owner's own view of 21 November: 45 degrees on 3,840 by 1,431, 150 m and 316 m up, the far settings at their tops, his Morph share of 0.6, a view radius of 9. */
function hisView(m: M): { tested: number; missed: Record<string, number[]>; overflow: number; patches: number } {
  tops(m, 16000, 0.6);
  const sel = new m.RingSelector();
  const out = { tested: 0, missed: { north: [], south: [], east: [], west: [] } as Record<string, number[]>, overflow: 0, patches: 0 };
  for (const up of [150, 316]) {
    const r = look(m, sel, { fov: 45, aspect: 3840 / 1431, up, pitch: -0.12, radius: 9 }, 2048, 4, HIS_NEAR_TO_FAR);
    out.tested += r.tested;
    out.overflow = Math.max(out.overflow, r.overflow);
    out.patches = Math.max(out.patches, r.patches);
    for (const k of Object.keys(out.missed)) out.missed[k].push(...r.missed[k]);
  }
  Object.assign(m.HORIZON_TUNE, saved);
  return out;
}

/**
 * A room too small on purpose (about half of what each view selects): on every bearing of every view (the view's own axis
 * and up to 45 degrees either side, so a camera facing north reads north-east and north-west too), the first distance left
 * out, and how many points past it were drawn all the same (the loss not the farthest).
 */
function smallRoom(m: M): { first: number[]; firstByView: Record<string, number[]>; holesBehind: number; overflowViews: number } {
  tops(m, 16000);
  const v: View = { fov: 80, aspect: 16 / 9, up: 150, pitch: -0.2 };
  const dist: number[] = [];
  for (let d = 950; d <= 15000; d += 50) dist.push(d);
  const first: number[] = [];
  const firstByView: Record<string, number[]> = {};
  let holesBehind = 0;
  let overflowViews = 0;
  for (const [name, dx, dz] of DIRS) {
    const whole = new m.RingSelector(1 << 20, 65536);
    selectView(m, whole, v, dx, dz, 2048, 4);
    const sel = new m.RingSelector(Math.round(whole.patchCount * 0.55), 8192);
    const { three, ask } = selectView(m, sel, v, dx, dz, 2048, 4);
    if (sel.overflow > 0) overflowViews++;
    firstByView[name] = [];
    for (const deg of [-45, -30, -15, 0, 15, 30, 45]) {
      const t = (deg * Math.PI) / 180;
      // The view's axis turned by the bearing about the up axis.
      const bx = dx * Math.cos(t) - dz * Math.sin(t);
      const bz = dx * Math.sin(t) + dz * Math.cos(t);
      let firstOut = Infinity;
      for (const d of dist) {
        if (d > ask.reach * 0.95) continue;
        const p = new THREE.Vector3(EYE.x + bx * d, 0, EYE.z + bz * d);
        if (!holds(three, p)) continue;
        const drawn = under(sel, p.x, p.z) === 1;
        if (!drawn && firstOut === Infinity) firstOut = d;
        else if (drawn && firstOut < Infinity) holesBehind++;
      }
      first.push(firstOut);
      firstByView[name].push(firstOut);
    }
  }
  Object.assign(m.HORIZON_TUNE, saved);
  return { first, firstByView, holesBehind, overflowViews };
}

/** Every patch the offered settings and the horizon dials' ends select from any view (a frustum that passes all), against the room the game makes. */
function fullCircle(m: M): { most: number; cap: number; overflow: number; mostAt: string } {
  const sel = new m.RingSelector();
  const all = { intersectsBox: () => true } as unknown as THREE.Frustum;
  let most = 0;
  let mostAt = '';
  let overflow = 0;
  const one = (side: number, sr: number, bakeStep: number, reach: number, up: number, radius: number, dials: { morph: number; lod0: number; edgeBand: number }) => {
    Object.assign(m.HORIZON_TUNE, saved, dials, { shape: true, shapeReach: sr, reach });
    const eye = new THREE.Vector3(EYE.x, up, EYE.z);
    const ask = askFor(m, eye, side, bakeStep, radius);
    testHole(hole, Math.floor(EYE.x / CHUNK), Math.floor(EYE.z / CHUNK), radius);
    sel.select(all, ask, pyr, hole);
    const n = sel.patchCount + sel.overflow;
    if (n > most) {
      most = n;
      mostAt = `the window of ${side}, a ${bakeStep} m bake, ${reach / 1000} km, ${up} m up, a view radius of ${radius}, the morph at ${dials.morph}`;
    }
    overflow += sel.overflow;
  };
  // The Graphics page's settings at the shipped dials.
  const shipped = { morph: saved.morph, lod0: saved.lod0, edgeBand: saved.edgeBand };
  for (const [side, sr] of [[1024, 700], [2048, 1550]] as const) for (const bakeStep of [8, 4]) for (const reach of [8000, 16000]) for (const up of [2, 150, 600, 2000]) for (const radius of [3, 6, 10]) one(side, sr, bakeStep, reach, up, radius, shipped);
  // The horizon dials at their ends (Morph share 0.05 to 0.6, Level 0 range 400 to 4,000 m, Edge band 16 to 256 m), at the page's tops.
  for (const morph of [0.05, 0.6]) for (const lod0 of [400, 4000]) for (const edgeBand of [16, 256]) for (const up of [2, 150, 900]) for (const radius of [3, 9]) one(2048, 1550, 4, 16000, up, radius, { morph, lod0, edgeBand });
  Object.assign(m.HORIZON_TUNE, saved);
  return { most, cap: sel.patchCap, overflow, mostAt };
}

const fmt = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ');
const spreadOf = (xs: number[]) => (xs.every(Number.isFinite) ? Math.max(...xs) - Math.min(...xs) : Infinity);
// A cut at one distance reads alike within a patch's width where it falls and the bins' width there (the code's), sampled
// every 50 m: 250 m. A square cut at 3 km reaches a diagonal over 1,200 m further than an axis.
const ALIKE = 250;

// ---- today's selection
{
  const t = atTops(TODAY);
  ok(t.tested > 4000 && t.missed.north + t.missed.south + t.missed.east + t.missed.west === 0, `at the Graphics page's tops, fields of view to 100 degrees and a wide screen, from 2 m and 150 m, every ground point ahead the camera holds is under exactly one patch in every direction (${t.tested} points; missed ${fmt(t.missed)})`);
  ok(t.overflowViews === 0 && t.most < t.cap, `and no view overflows the room the game makes (${t.most} patches at the most, room ${t.cap})`);
  const h = hisView(TODAY);
  const hMissed = Object.values(h.missed).reduce((s, x) => s + x.length, 0);
  ok(h.tested > 300 && hMissed === 0 && h.overflow === 0, `the owner's own view (45 degrees on 3,840 by 1,431, 150 m and 316 m up, his Morph share of 0.6) is drawn whole in every direction (${h.tested} points, ${h.patches} patches at the most)`);
  const s = smallRoom(TODAY);
  ok(s.overflowViews === 4 && s.holesBehind === 0 && s.first.every((d) => Number.isFinite(d) && d > 2000), `a room too small on purpose leaves out the farthest ground and nothing nearer, on every bearing of every view (first left out by view, bearings -45 to 45 degrees: ${Object.entries(s.firstByView).map(([k, v]) => `${k} ${v.join('/')}`).join('; ')} m)`);
  ok(spreadOf(s.first) <= ALIKE, `and at one distance all round, diagonals and axes alike (${spreadOf(s.first)} m apart over 28 bearings; within ${ALIKE} m)`);
  const c = fullCircle(TODAY);
  ok(c.overflow === 0 && c.most <= c.cap, `the room the game makes holds every patch the offered settings and the horizon dials' ends select from any view at all (${c.most} at the most, all round, with ${c.mostAt}; room ${c.cap})`);
}

// ---- 8a7de51's selection, the same checks: it fails them, by direction
{
  const old = await loadOldMany(['src/world/horizon/horizonMath.ts', 'src/world/horizon/shapeWindow.ts'], ['src/world/horizon/horizonMath.ts'], BEFORE);
  if (old) {
    const m = old[0] as unknown as M;
    const t = atTops(m);
    note(`${BEFORE}: ${t.overflowViews} views overflowed its room of ${t.cap} (${t.most} patches at the most); points missed ${fmt(t.missed)}; looking south, ${t.nearSouth} within 1.5 km; looking north, ${t.farNorth} past 6 km`);
    ok(t.overflowViews > 0 && t.nearSouth > 0 && t.farNorth > 0, `${BEFORE}'s selection fails the first check: past its room it loses the near ground looking south and the far ground looking north`);
    const h = hisView(m);
    note(`${BEFORE} in the owner's view: ${h.patches} patches selected against its room; missed ${Object.entries(h.missed).map(([k, v]) => `${k} ${v.length}${v.length ? ` (${Math.min(...v)} to ${Math.max(...v)} m)` : ''}`).join(', ')}`);
    ok(h.overflow > 0 && h.missed.south.some((d) => d <= 1500), `and draws the owner's own view with the ground just ahead missing looking south, as he saw it`);
    const s = smallRoom(m);
    note(`${BEFORE} with a room too small on purpose: first left out by view ${Object.entries(s.firstByView).map(([k, v]) => `${k} ${v.join('/')}`).join('; ')} m; ${s.holesBehind} drawn past a point left out`);
    ok(spreadOf(s.first) > ALIKE || s.holesBehind > 0, `and what it leaves out goes by direction, not by distance`);
    const c = fullCircle(m);
    ok(c.most > c.cap, `and its room of ${c.cap} holds less than the offered settings select all round (${c.most})`);
  } else note(`git cannot hand ${BEFORE} over: its failures are recorded in docs/lessons/horizon.md alone`);
}

// ---- the game makes the selection's room by its default, and says a room run out once
{
  const field = readFileSync(new URL('../../../src/world/horizon/horizonField.ts', import.meta.url), 'utf8');
  ok(/readonly selector = new RingSelector\(\);/.test(field) && /patchGeometry\(this\.selector\.patchCap\)/.test(field), "horizonField.ts: the session's selection is made with the default room and the patch geometry sized to it");
  ok(/if \(s\.selector\.overflow > 0 && !this\.overflowSaid\) this\.sayOverflow\(s\.selector\);/.test(field) && /private sayOverflow\(sel: RingSelector\): void \{\s*this\.overflowSaid = true;/.test(field), 'and a room run out is said in the console once a field, the frame after it reading one flag');
}

console.log(`\nhorizonDirections: ${checks} checks passed`);
