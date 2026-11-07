// The race drawer's second wave: a raced hull over a carved figure eight (DESIGN.md §2.8). The real `RaceDrive` and the real
// `Vehicle` over a real Rapier world in node, on a flat world whose ground carries the course through the pole grid
// (`CourseGrid`, the real-elevation world's path), at 20, 60 and 144 frames a second:
// - round the lower road through the underpass with no hit, the tracker on the lower pass, and so under a bridge standing
//   on the upper road: one path crossing itself has both legs at the crossing, and the lower leg never reads the upper's deck;
// - thrown off a 12 m crest toward the deck's height, never taken for the upper pass, never handed its deck, and under
//   `deck: 'drawn'` the very arc it flies with no deck at all;
// - with no bridge, the upper road's gap glided at speed (the drive's own bridge) and dropped into at a crawl;
// - with a bridge stood as a still collider flush with the deck, over it at a crawl and at speed with no hit and no dip
//   under the firm hold, the far ray reading the bridge ahead (`deckRay`), a node put in before the crossing included;
// - with `deck: 'drawn'`, over the gap at every speed with no bridge at all, and a crossing inside the deck's band of the
//   lower road still passed under;
// - the tracker staying on the upper pass while it climbs to the crossing;
// - all of it again with a layout centre a kilometre off nought, the drive's own carry into the raw frame;
// - and with no course (no store, or an empty one) a ride's every frame the same, so the drive is today's.
//
// Run: node tools/swg/tests/courseRide.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics, RAPIER } from '../../../src/core/physics.ts';
import { CHUNK_SIZE, Terrain, chunkHeightfield } from '../../../src/world/terrain.ts';
import { Vehicle, specFor, type DriveInput } from '../../../src/vehicles/vehicle.ts';
import { attachRace, type RaceGround } from '../../../src/vehicles/raceDrive.ts';
import { RACE_TUNE } from '../../../src/vehicles/raceTune.ts';
import { thrustA, thrustFor } from '../../../src/vehicles/raceMath.ts';
import { COURSE_TUNE } from '../../../src/race/courseTune.ts';
import { CourseCarve, CourseGrid, type CarveTrack } from '../../../src/swg/terrain/courseCarve.ts';
import { CourseTracker, trackAsk } from '../../../src/race/courseTrack.ts';
import type { PlanetDef } from '../../../src/data/planets.ts';
import { figureEight, node, track } from './carveFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const planet = { id: 'test', seed: 1, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 0, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null, props: { treeDensity: 0, rockDensity: 0, treeStyle: 'none', canopy: 0, trunk: 0, rock: 0, treeScale: 1 } } as unknown as PlanetDef;
const BOUNDS = { min: [-3, 0, -6], max: [3, 2.5, 6] };
const BOX: [number, number, number] = [7, 3, 15];
const DECK = 8;
/** A crawl (m/s): the drive's speed held there each frame. */
const CRAWL = 4;

/**
 * A figure eight whose roads are wide enough for a pod (16 m), the upper diagonal at `DECK`, the lower diagonal 24 m wide so
 * its slot (and the upper road's gap over it) is 28 m along the upper road, twice a pod's length.
 */
const eight = (hi = DECK): CarveTrack => {
  const t = figureEight('eight', hi, {}, 16);
  const ns = t.course!.paths[0].nodes;
  ns[4] = { ...ns[4], w: 24 };
  ns[5] = { ...ns[5], w: 24 };
  return t;
};
/** The same with a crest on the lower road before the underpass (raw (35, 35), `top` m up, back to 0 at (15, 15)). */
const crested = (top = 3.5): CarveTrack => {
  const t = eight();
  const ns = t.course!.paths[0].nodes;
  // Lower diagonal: node 4 (raw (90, 90)) to node 5 (raw (-90, -90)); a crest put in between.
  ns.splice(5, 0, node(35, 35, top, { w: 24, c: 'straight' }), node(15, 15, 0, { w: 24, c: 'straight' }));
  return t;
};
/** The upper diagonal with a node put in `before` m ahead of the crossing (raw, along it toward node 1), so the deck lies on the next edge. */
const nodeBefore = (before: number): CarveTrack => {
  const t = eight();
  const ns = t.course!.paths[0].nodes;
  const s = before / Math.SQRT2;
  ns.splice(2, 0, node(-s, s, DECK, { w: 16, c: 'straight' }));
  return t;
};
/** A track moved by (`dx`, `dz`) in the raw frame (the drive's own store, carried with a layout centre of that). */
const shifted = (t: CarveTrack, dx: number, dz: number): CarveTrack => ({ ...t, course: { ...t.course!, paths: t.course!.paths.map((p) => ({ ...p, nodes: p.nodes.map((n) => ({ ...n, x: n.x + dx, z: n.z + dz })) })) } });
/** The upper diagonal climbing to the crossing: 2 m at raw (-90, 90) to 14 m at (90, -90), the deck 8 m over the crossing. */
const climbing = (): CarveTrack => {
  const t = eight();
  const ns = t.course!.paths[0].nodes;
  ns[1] = { ...ns[1], y: 2 };
  ns[2] = { ...ns[2], y: 14 };
  return t;
};

interface Rig {
  t: Terrain;
  store: CourseCarve | null;
  /** The drive's own course and layout centre, where it is handed one apart from the ground's (an off-centre world). */
  drive?: { carve: CourseCarve; cx: number; cz: number };
}
function rig(tr: CarveTrack | null, empty = false): Rig {
  const t = new Terrain(planet);
  let store: CourseCarve | null = null;
  if (tr || empty) {
    store = new CourseCarve();
    store.set(tr ? [tr] : []);
    const g = new CourseGrid(store);
    g.all();
    g.step(Infinity, 0, 0, () => 0);
    t.courseGrid = g;
  }
  return { t, store };
}
/**
 * A world whose layout centre is (`cx`, `cz`): the ground carries the course about nought (a plain `Terrain`'s pole grid reads
 * the raw frame as (-x, z)), and the drive is handed the same course moved by the centre in the raw frame, with that centre,
 * so its raw place `cx - x, z + cz` lands on the very road the ground carries. A drive that dropped the centre would track
 * nothing there.
 */
function rigOffCentre(tr: CarveTrack, cx: number, cz: number): Rig {
  const r = rig(tr);
  const carve = new CourseCarve();
  carve.set([shifted(tr, cx, cz)]);
  r.drive = { carve, cx, cz };
  return r;
}

interface Frame {
  x: number;
  z: number;
  y: number;
  low: number;
  edge: number;
  deckRay: boolean;
  /** The lowest ground the plan's walk ahead read within 5 m of the crossing this frame (Infinity where it read none there). */
  walkLow: number;
  /** The tracked pass's deck under the hull (-Infinity for none, or tracked nowhere). */
  deck: number;
}
interface Ride {
  frames: Frame[];
  hits: string[];
  destroyed: boolean;
  speed: number;
}

/**
 * A pod raced from (`x`, `z`) of the game's frame along heading `a` for `len` metres: `crawl` holds it at `CRAWL`, else it
 * starts at its boost top. `bridge` stands a still box flush with the deck over the crossing.
 */
async function ride(r: Rig, x: number, z: number, a: number, len: number, fps: number, crawl: boolean, bridge = false, hi = DECK): Promise<Ride> {
  const physics = await Physics.create();
  for (let cx = -5; cx <= 4; cx++)
    for (let cz = -5; cz <= 4; cz++) {
      r.t.prepareChunk(cx, cz, true);
      const built = r.t.buildChunk(cx, cz);
      built.geometry.dispose();
      chunkHeightfield(physics, { origin: built.origin, heights: built.heights });
    }
  if (bridge) {
    // Along the upper road (game frame: (90, 90) to (-90, -90)), 40 m long, 16 m wide, its top at the deck.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(8, 0.5, 20).setTranslation(0, hi - 0.5, 0).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
  }
  const spec = specFor('podracer', 'pod', 'pod', BOUNDS);
  spec.hull = 'box';
  spec.raceBox = [...BOX] as [number, number, number];
  const y0 = r.t.heightAt(x, z);
  const v = new Vehicle(spec, new THREE.Group(), physics, new THREE.Scene(), x, y0 + 2, z, a);
  physics.stepOnce();
  const ground: RaceGround = { near: (gx, gz) => r.t.heightAt(gx, gz), far: () => null, farStep: 16, farX: () => 0, farZ: () => 0, water: () => -Infinity };
  const race = attachRace(v, 'pod', { ground, course: r.drive ?? { carve: r.store, cx: 0, cz: 0 } })!;
  race.setLevels('stock', v);
  const input: DriveInput = { throttle: crawl ? 0.001 : 1, steer: 0, heading: a, boost: !crawl, hop: false, up: false, down: false, vertical: 0 };
  const groundAt = (gx: number, gz: number) => r.t.heightAt(gx, gz);
  const waterAt = () => -Infinity;
  const dt = 1 / fps;
  v.update(dt, physics, input, groundAt, waterAt);
  physics.step(dt);
  const top = crawl ? CRAWL : race.boostTop();
  v.body.setLinvel({ x: Math.sin(a) * top, y: 0, z: Math.cos(a) * top }, true);
  race.h = top;
  (race as unknown as { cmdValid: boolean }).cmdValid = false;
  const out: Ride = { frames: [], hits: [], destroyed: false, speed: 0 };
  let lastAt = race.lastHit.at;
  let dist = 0;
  let time = 0;
  const x0 = v.pos.x;
  const z0 = v.pos.z;
  while (!v.destroyed && time < 60) {
    const along = (v.pos.x - x0) * Math.sin(a) + (v.pos.z - z0) * Math.cos(a);
    if (along > len) break;
    // A crawl: the thrust held where the curve gives CRAWL (the speed is the thrust's, speedOf).
    if (crawl) race.T = thrustFor(CRAWL, race.handling.V, thrustA(race.handling.t75));
    v.update(dt, physics, input, groundAt, waterAt);
    physics.step(dt);
    time += dt;
    dist = along;
    const p = v.body.translation();
    const w = (race as unknown as { walk: { n: number; x: Float64Array; z: Float64Array; g: Float64Array } }).walk;
    let walkLow = Infinity;
    for (let i = 0; i < w.n; i++) if (Math.hypot(w.x[i], w.z[i]) < 5 && w.g[i] < walkLow) walkLow = w.g[i];
    out.frames.push({ x: p.x, z: p.z, y: p.y, low: race.low, edge: race.track.on ? race.track.edge : -1, deckRay: race.deckRay, walkLow, deck: race.track.on ? race.track.deck : -Infinity });
    if (race.lastHit.at !== lastAt) {
      if (race.lastHit.kind !== 'scrape') out.hits.push(race.lastHit.kind);
      lastAt = race.lastHit.at;
    }
  }
  out.destroyed = v.destroyed;
  out.speed = time > 0 ? dist / time : 0;
  return out;
}
/** The frames within `r` m of the crossing (the game's origin). */
const atCrossing = (rd: Ride, r: number) => rd.frames.filter((f) => Math.hypot(f.x, f.z) <= r);
const FPS = [20, 60, 144];
// The lower road (game (-90, 90) to (90, -90)) heading down-right; the upper (game (90, 90) to (-90, -90)) down-left.
const LOWER = { x: -70, z: 70, a: (3 * Math.PI) / 4 };
const UPPER = { x: 70, z: 70, a: (-3 * Math.PI) / 4 };
const LEN = 140;

const deckWas = COURSE_TUNE.deck;
try {
  COURSE_TUNE.deck = 'bridge';
  for (const fps of FPS) {
    // The lower road through the underpass.
    const low = await ride(rig(eight()), LOWER.x, LOWER.z, LOWER.a, LEN, fps, false);
    const lc = atCrossing(low, 6);
    ok(!low.destroyed && !low.hits.length && lc.length > 0 && lc.every((f) => f.low < 3 && f.edge === 4), `${fps} fps: round the lower road through the underpass at ${low.speed.toFixed(0)} m/s with no hit, under the deck, tracked on the lower pass`);
    // The lower road under a bridge standing over the crossing (the upper leg's deck): one path crossing itself has both legs
    // at the crossing, and only the tracked leg may give a deck, so the far ray never takes the bridge for the lower road's.
    for (const crawl of [false, true]) {
      const lb = await ride(rig(eight()), LOWER.x, LOWER.z, LOWER.a, LEN, fps, crawl, true);
      const lbc = atCrossing(lb, 6);
      ok(!lb.destroyed && !lb.hits.length && lbc.length > 0 && lbc.every((f) => f.low < 3 && f.edge === 4 && f.deck === -Infinity) && !lb.frames.some((f) => f.deckRay), `${fps} fps: the lower road under the bridge standing on the upper at ${crawl ? 'a crawl' : `${lb.speed.toFixed(0)} m/s`}: no hit, under the deck, no deck read for the lower leg, the far ray never taking the bridge`);
    }
    // The upper road, no bridge: glided at speed, dropped into at a crawl.
    const fast = await ride(rig(eight()), UPPER.x, UPPER.z, UPPER.a, LEN, fps, false);
    const fc = atCrossing(fast, 8);
    ok(fc.length > 0 && fc.every((f) => f.low > DECK - 1.5) && !fast.destroyed, `${fps} fps: with no bridge the upper road's gap is glided at speed (${fast.speed.toFixed(0)} m/s, its lowest point never more than 1.5 m under the deck)`);
    ok(fast.frames.some((f) => f.walkLow < DECK - 3), `${fps} fps: and the walk ahead reads the gap as the pit it is (the slot under the deck) with the deck a bridge's`);
    const slow = await ride(rig(eight()), UPPER.x, UPPER.z, UPPER.a, LEN, fps, true);
    ok(slow.frames.some((f) => Math.hypot(f.x, f.z) < 12 && f.low < DECK - 3), `${fps} fps: and dropped into at a crawl (${slow.speed.toFixed(1)} m/s)`);
    // A bridge flush with the deck: over it at a crawl and at speed, no hit, no dip; the far ray reads it ahead.
    const bFast = await ride(rig(eight()), UPPER.x, UPPER.z, UPPER.a, LEN, fps, false, true);
    const bSlow = await ride(rig(eight()), UPPER.x, UPPER.z, UPPER.a, LEN, fps, true, true);
    const dips = (rd: Ride) => atCrossing(rd, 8).filter((f) => f.low < DECK - 0.5).length;
    ok(!bFast.hits.length && !bSlow.hits.length && dips(bFast) === 0 && dips(bSlow) === 0 && atCrossing(bSlow, 8).length > 0, `${fps} fps: with a bridge flush with the deck, over it at a crawl and at speed with no hit and no dip`);
    ok(bFast.frames.some((f) => f.deckRay), `${fps} fps: and the far ray took the bridge ahead as the deck's road`);
    // A node put in on the upper road before the crossing: the deck lies on the next edge from the hull's, and the far ray
    // still reads it (the leg is chosen by its place along the path, never by its edge).
    for (const before of [20, 40]) {
      const nb = await ride(rig(nodeBefore(before)), UPPER.x, UPPER.z, UPPER.a, LEN, fps, false, true);
      ok(!nb.hits.length && nb.frames.some((f) => f.deckRay) && atCrossing(nb, 8).every((f) => f.low >= DECK - 0.5), `${fps} fps: with a node ${before} m before the crossing on the upper road, the far ray still takes the bridge on the next edge (${nb.frames.filter((f) => f.deckRay).length} frames) and it is crossed with no hit and no dip`);
    }
  }
  COURSE_TUNE.deck = 'drawn';
  for (const fps of FPS) {
    for (const crawl of [false, true]) {
      const d = await ride(rig(eight()), UPPER.x, UPPER.z, UPPER.a, LEN, fps, crawl);
      const dc = atCrossing(d, 8);
      ok(dc.length > 0 && dc.every((f) => f.low > DECK - 0.75) && !d.hits.length, `${fps} fps, deck 'drawn': over the gap with no bridge at ${crawl ? 'a crawl' : 'speed'}, its lowest point at the deck`);
      if (!crawl) {
        // The walk ahead (the plan's look-ahead and the far ray's samples) reads the deck too, never the slot under it.
        const seen = d.frames.filter((f) => Number.isFinite(f.walkLow));
        ok(seen.length > 0 && seen.every((f) => f.walkLow > DECK - 0.75), `${fps} fps, deck 'drawn': the walk ahead reads the deck over the gap on all ${seen.length} frames it reached it`);
      }
    }
    // The lower road under it is untouched by the drawn deck.
    const low = await ride(rig(eight()), LOWER.x, LOWER.z, LOWER.a, LEN, fps, false);
    ok(!low.hits.length && atCrossing(low, 6).every((f) => f.low < 3), `${fps} fps, deck 'drawn': the lower road's hull still passes under`);
    // A crossing whose clearance is inside the deck's band of the lower road's own line (5.5 m, the band 6): the upper leg's
    // deck would be laid under a lower-road hull's footprint were it read for the lower leg. Only the tracked leg gives it.
    const LOW = 5.5;
    for (const crawl of [false, true]) {
      const ld = await ride(rig(eight(LOW)), LOWER.x, LOWER.z, LOWER.a, LEN, fps, crawl, false, LOW);
      const ldc = atCrossing(ld, 6);
      ok(LOW < COURSE_TUNE.deckBand && !ld.hits.length && ldc.length > 0 && ldc.every((f) => f.low < 3 && f.deck === -Infinity), `${fps} fps, deck 'drawn', a ${LOW} m crossing (inside the band of ${COURSE_TUNE.deckBand}): the lower road at ${crawl ? 'a crawl' : 'speed'} still passes under, never lifted onto the upper leg's deck`);
    }
    const ud = await ride(rig(eight(LOW)), UPPER.x, UPPER.z, UPPER.a, LEN, fps, true, false, LOW);
    ok(atCrossing(ud, 8).length > 0 && atCrossing(ud, 8).every((f) => f.low > LOW - 0.75) && !ud.hits.length, `${fps} fps, deck 'drawn', a ${LOW} m crossing: the upper road at a crawl rides its deck over the gap`);
  }
  // Thrown off a crest by the underpass toward the deck: a crest 12 m high on the lower road throws the hull to the deck's
  // height over the crossing, where a tracker that found the hull afresh would take the upper pass and the drawn deck (or a
  // bridge) would hold it there. Kept on its leg, its tracked deck is none and it flies the very same arc whatever the deck
  // mode: a ride under 'drawn' is the ride under 'bridge' with no bridge, frame for frame.
  {
    const RIDE_H = (await ride(rig(eight()), LOWER.x, LOWER.z, LOWER.a, 60, 60, false)).frames.at(-1)!.low;
    for (const fps of FPS) {
      COURSE_TUNE.deck = 'bridge';
      const plain = await ride(rig(crested(12)), LOWER.x, LOWER.z, LOWER.a, LEN, fps, false);
      COURSE_TUNE.deck = 'drawn';
      const drawn = await ride(rig(crested(12)), LOWER.x, LOWER.z, LOWER.a, LEN, fps, false);
      COURSE_TUNE.deck = 'bridge';
      const bridged = await ride(rig(crested(12)), LOWER.x, LOWER.z, LOWER.a, LEN, fps, false, true);
      const near = atCrossing(plain, 10);
      const thrown = near.length > 0 && near.some((f) => f.low - RIDE_H >= DECK - COURSE_TUNE.deckBand) && near.some((f) => f.low - RIDE_H > DECK / 2);
      ok(thrown, `${fps} fps: the 12 m crest throws the hull to the deck's height over the crossing (its lowest point up to ${Math.max(...near.map((f) => f.low - RIDE_H)).toFixed(1)} m over its ride there): the precondition, so a wrong leg would show`);
      const legKept = (rd: Ride) => atCrossing(rd, 10).every((f) => f.edge !== 1 && f.deck === -Infinity);
      ok(legKept(plain) && legKept(drawn) && legKept(bridged), `${fps} fps: thrown off the crest, never taken for the upper pass and never handed its deck (every frame within 10 m, both deck modes and with the bridge stood)`);
      const n = Math.min(plain.frames.length, drawn.frames.length);
      let apart = 0;
      for (let i = 0; i < n; i++) apart = Math.max(apart, Math.abs(plain.frames[i].low - drawn.frames[i].low), Math.hypot(plain.frames[i].x - drawn.frames[i].x, plain.frames[i].z - drawn.frames[i].z));
      ok(plain.frames.length === drawn.frames.length && apart < 1e-9 && !drawn.hits.length, `${fps} fps: and under 'drawn' it flies the very arc it flies with no deck at all (${n} frames, ${apart.toExponential(1)} m apart at most): never held on the deck`);
    }
  }
  // The drive's carry into the raw frame with a layout centre far from nought (every converted world's): the tracker, the
  // drawn deck and the far ray's bridge hint each read the course at `cx - x, z + cz`, and dropped the centre they would read
  // it a kilometre off and track nothing.
  {
    const CX = 1027.5;
    const CZ = -611.25;
    for (const fps of FPS) {
      COURSE_TUNE.deck = 'bridge';
      const low = await ride(rigOffCentre(eight(), CX, CZ), LOWER.x, LOWER.z, LOWER.a, LEN, fps, false);
      const lc = atCrossing(low, 6);
      ok(!low.hits.length && lc.length > 0 && lc.every((f) => f.low < 3 && f.edge === 4), `${fps} fps, a layout centre at (${CX}, ${CZ}): the lower road through the underpass, tracked on the lower pass`);
      const br = await ride(rigOffCentre(eight(), CX, CZ), UPPER.x, UPPER.z, UPPER.a, LEN, fps, false, true);
      ok(br.frames.some((f) => f.deckRay) && !br.hits.length, `${fps} fps, off-centre: the far ray takes the bridge ahead as the deck's road`);
      COURSE_TUNE.deck = 'drawn';
      const dr = await ride(rigOffCentre(eight(), CX, CZ), UPPER.x, UPPER.z, UPPER.a, LEN, fps, true);
      const dc = atCrossing(dr, 8);
      ok(dc.length > 0 && dc.every((f) => f.low > DECK - 0.75) && !dr.hits.length, `${fps} fps, off-centre, deck 'drawn': over the gap at a crawl on the drawn deck`);
    }
  }
  COURSE_TUNE.deck = 'bridge';
  // The tracker on the upper pass while it climbs to the crossing.
  for (const fps of FPS) {
    const c = await ride(rig(climbing()), UPPER.x, UPPER.z, UPPER.a, 90, fps, false, true);
    const near = c.frames.filter((f) => Math.hypot(f.x, f.z) < 30);
    ok(near.length > 0 && near.every((f) => f.edge === 1), `${fps} fps: climbing to the crossing, the tracker keeps the upper pass all the way (${near.length} frames within 30 m)`);
  }
  // The tracker alone (`courseTrack.ts`): kept on its pass by continuity where height alone would take it for another. On the
  // lower road nearing the crossing, then at the crossing with its line (its expected ground) thrown up near the deck, as off
  // a crest: found again by height and way the upper road would win; kept by its place along its path, the lower stays.
  {
    const st = new CourseCarve();
    st.set([figureEight('eight', DECK)]);
    const tr = new CourseTracker();
    const q = trackAsk();
    q.ux = -Math.SQRT1_2;
    q.uz = -Math.SQRT1_2;
    q.jump = 30;
    q.x = 20;
    q.z = 20;
    q.line = 0;
    tr.step(st, q);
    const lower = q.edge;
    q.x = 1;
    q.z = 1;
    q.line = DECK - 0.5;
    tr.step(st, q);
    ok(lower === 4 && q.on && q.edge === lower && tr.kept === 1, `the tracker keeps the lower pass at the crossing by continuity though its line stands at the deck (edge ${q.edge}, kept ${tr.kept})`);
    ok(q.deck === -Infinity, `and the lower leg has no deck there (${q.deck}): one path crossing itself, only the tracked leg's deck counts`);
    const fresh = new CourseTracker();
    const f = trackAsk();
    Object.assign(f, { x: 1, z: 1, line: DECK - 0.5, ux: q.ux, uz: q.uz, jump: 30 });
    fresh.step(st, f);
    ok(f.on && f.edge === 1 && f.deck === DECK, `and a tracker finding the hull afresh there takes the upper (edge ${f.edge}) and its deck (${f.deck}): what continuity is for`);
    // `deckHere` 30 m ahead of a lower-leg hull at the crossing, and of an upper-leg hull 30 m before it: the leg is the
    // tracked one by its place along the path, whatever point is asked.
    tr.at.x = -1;
    tr.at.z = -1;
    tr.deckHere(st, q);
    const lowerAhead = tr.at.out;
    const up = trackAsk();
    Object.assign(up, { x: -30, z: 30, line: DECK, ux: Math.SQRT1_2, uz: -Math.SQRT1_2, jump: 30 });
    const upT = new CourseTracker();
    upT.step(st, up);
    upT.at.x = 0;
    upT.at.z = 0;
    upT.deckHere(st, up);
    ok(lowerAhead === -Infinity && up.edge === 1 && upT.at.out === DECK, `asked ahead, the lower leg reads no deck (${lowerAhead}) and the upper leg 30 m short of the crossing reads its deck there (${upT.at.out})`);
  }
  // No course: the ride is the same with no store and with an empty one, frame by frame.
  for (const fps of FPS) {
    const a = await ride(rig(null), LOWER.x, LOWER.z, LOWER.a, 120, fps, false);
    const b = await ride(rig(null, true), LOWER.x, LOWER.z, LOWER.a, 120, fps, false);
    ok(a.frames.length === b.frames.length && a.frames.every((f, i) => Object.is(f.x, b.frames[i].x) && Object.is(f.y, b.frames[i].y) && Object.is(f.z, b.frames[i].z) && f.edge === -1 && b.frames[i].edge === -1), `${fps} fps: with no course, and with an empty store, a ride is the same to the bit and tracks nothing`);
  }
} finally {
  COURSE_TUNE.deck = deckWas;
}
void RACE_TUNE;
void CHUNK_SIZE;
void track;

// ---------------------------------------------------------------- the step on drawn courses makes nothing
// `raceAllocOwn.ts deck`, in twelve processes at once (which calls the compiler builds in turns on the load it runs under):
// the drive's own step over carved ground with a tracker stepped every plan and the deck read under the hull and ahead, both
// deck modes a stretch each, and the pole grid's own read (`CourseGrid.carveIn`, a real-elevation world's) measured apart.
// The drive's line is two bytes a step where its own run's is one: the measure's own carved-ground stand-in makes about 1.42
// bytes a step with the course switched off altogether (`RACE_ALLOC_DECK_COURSE=0`), and with it about 1.51 (the store's
// buckets keyed by a small integer since the fix round: keyed past it, the tracker's and the deck's lookups boxed their key
// at every new cell, 1.66), the rest the strikes' few numbers where the weaving hull meets a shoulder or a road's cut.
{
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const file = fileURLToPath(new URL('./raceAllocOwn.ts', import.meta.url));
  interface Deck {
    frames: number;
    made: number;
    scavenges: number;
    planned: number;
    tracked: number;
    deck: boolean;
    grid?: { frames: number; reads: number; made: number; scavenges: number };
    skipped?: string;
  }
  const one = () =>
    new Promise<Deck>((resolve, reject) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'deck'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        const line = out.trim().split('\n').pop() ?? '';
        if (code !== 0) {
          reject(new Error(`the deck measure exited ${code}: ${err.trim().split('\n').find((l) => /Error/.test(l)) ?? line}`));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`the deck measure printed nothing that reads: ${line || '(nothing)'}`));
        }
      });
    });
  const all = await Promise.all(Array.from({ length: 12 }, () => one()));
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    const who = `deck measure, process ${i + 1} of 12`;
    if (a.skipped) {
      console.log(`note ${who} skipped: ${a.skipped}`);
      continue;
    }
    ok(a.deck && a.planned > 0 && a.tracked > a.planned / 2 && a.scavenges === 0 && a.made < 2 * a.frames, `${who}: the drive's step on drawn courses (tracked on ${a.tracked} frames) makes ${Math.max(0, a.made)} bytes over ${a.frames} steps (${(Math.max(0, a.made) / a.frames).toFixed(2)} a step, no collection)`);
    const g = a.grid;
    ok(!!g && g.scavenges === 0 && g.made < 0.05 * g.frames, `${who}: the pole grid's read makes ${Math.max(0, g?.made ?? NaN)} bytes over ${g?.reads} reads`);
  }
}

console.log(`\ncourseRide: ${checks} checks passed`);
