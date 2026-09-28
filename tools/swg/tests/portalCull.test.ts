// What moves on its own, routed by the room it stands in (src/world/portalCull.ts), checked without a
// browser over a made-up building of two rooms and a door: the doorway rule (a body whose sphere reaches a
// portal counts in the room beyond, outdoors included, and a body outside reaching a door counts in the room
// behind it); what each pass draws (the shadows and the world take what stands outdoors, the world from
// inside only what the exits' rectangle shows, a building's pass only what stands in its rooms, and never
// what stands in another building's drawn beside it); the frame's hiding of what no seen room holds; what no
// view pass drew kept hidden through the effects, its lit blade put back for them; the light guard (a root
// with a light under it is never touched); `restoreFrame` putting back exactly each root's own value, an
// owner's hidden one included; a body whose room was followed some way back (`at[4]`, a runner or a thrown
// corpse) counted in every room it can have reached, through a chain of portals; how each body's rooms were
// seen as the creatures' manager reads them a frame late (`levelOf`: the routing's own answer, doorways
// included, left to the frustum outdoors, and forgotten once more than a step old) and the tiers it gives a
// body in an unseen room or one room past a seen one (`lodTier`); and nothing allocated by a frame of it (run
// with node --expose-gc for that one).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import * as THREE from 'three';
import { ActorRoutes, ROOM_LEVEL, ROUTE_KIND, ROUTE_PASS } from '../../../src/world/portalCull.ts';
import { exitFrustum, PORTAL_CULL, PortalVisibility, type PortalCullTune, type VisBuilding } from '../../../src/world/portalVis.ts';
import { LOD_TUNE, lodTier, type LodInput } from '../../../src/world/mobiles/lod.ts';
import type { Portal } from '../../../src/world/assetPack.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

interface Def {
  id: string;
  bounds: { min: number[]; max: number[] };
  cells: { index: number; name: string; bounds: { min: number[]; max: number[] }; portals?: { geometry: number; target: number; passable: boolean }[] }[];
  portals: { v: number[][]; i: number[] }[];
}

function quad(x0: number, x1: number, y0: number, y1: number, z: number): { v: number[][]; i: number[] } {
  return { v: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], i: [0, 1, 2, 0, 2, 3] };
}

// Two rooms along z: the front (z -5 to 0) and the back (z 0 to 5), a doorway between them at z 0 and the
// door to the world at z 5, each two metres wide and 2.2 high.
const boxDef: Def = {
  id: 'test_two_rooms',
  bounds: { min: [-5, 0, -5], max: [5, 3, 5] },
  cells: [
    { index: 0, name: 'r0', bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, portals: [{ geometry: 1, target: 2, passable: true }] },
    { index: 1, name: 'front', bounds: { min: [-5, 0, -5], max: [5, 3, 0] }, portals: [{ geometry: 0, target: 2, passable: true }] },
    { index: 2, name: 'back', bounds: { min: [-5, 0, 0], max: [5, 3, 5] }, portals: [{ geometry: 0, target: 1, passable: true }, { geometry: 1, target: 0, passable: true }] },
  ],
  portals: [quad(-1, 1, 0, 2.2, 0), quad(-1, 1, 0, 2.2, 5)],
};

/** The portals as the game's own pack loader makes them. */
function portalsOf(def: Def): Portal[] {
  const portals: Portal[] = def.portals.map((poly) => {
    const verts = poly.v.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
    const indices = poly.i.slice();
    const normal = new THREE.Vector3().subVectors(verts[1], verts[0]).cross(new THREE.Vector3().subVectors(verts[2], verts[0])).normalize();
    return { verts, indices, normal, d: normal.dot(verts[0]), links: [], passable: true };
  });
  for (const c of def.cells) for (const l of c.portals ?? []) portals[l.geometry]?.links.push({ from: c.index, to: l.target });
  return portals;
}

// Three rooms along z: the front (z -5 to 0), a narrow hall (0 to 1.5) and the back (1.5 to 5), a doorway
// between each and the door to the world at z 5: a body can cross the hall between two follows of its room.
const hallDef: Def = {
  id: 'test_three_rooms',
  bounds: { min: [-5, 0, -5], max: [5, 3, 5] },
  cells: [
    { index: 0, name: 'r0', bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, portals: [{ geometry: 2, target: 3, passable: true }] },
    { index: 1, name: 'front', bounds: { min: [-5, 0, -5], max: [5, 3, 0] }, portals: [{ geometry: 0, target: 2, passable: true }] },
    { index: 2, name: 'hall', bounds: { min: [-5, 0, 0], max: [5, 3, 1.5] }, portals: [{ geometry: 0, target: 1, passable: true }, { geometry: 1, target: 3, passable: true }] },
    { index: 3, name: 'back', bounds: { min: [-5, 0, 1.5], max: [5, 3, 5] }, portals: [{ geometry: 1, target: 2, passable: true }, { geometry: 2, target: 0, passable: true }] },
  ],
  portals: [quad(-1, 1, 0, 2.2, 0), quad(-1, 1, 0, 2.2, 1.5), quad(-1, 1, 0, 2.2, 5)],
};

function buildingAt(x: number, z: number, def: Def = boxDef): VisBuilding {
  const matrix = new THREE.Matrix4().makeTranslation(x, 0, z);
  return { model: { portals: portalsOf(def), def }, matrix, inverse: matrix.clone().invert(), x, z, radius: 5 };
}

const W = 1920;
const H = 1080;
const camera = new THREE.PerspectiveCamera(60, W / H, 0.05, 9000);
function lookFrom(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
  camera.position.set(x, y, z);
  camera.up.set(0, 1, 0);
  camera.lookAt(tx, ty, tz);
  camera.updateMatrixWorld(true);
}

const tune: PortalCullTune = { ...PORTAL_CULL, on: true, mode: 'rooms' };
const vis = new PortalVisibility(tune);
const b = buildingAt(0, 0);
const far = buildingAt(200, 0);

/** A root with a mesh under it, as a body is; `light` hangs a point light two levels down. */
function root(light = false): THREE.Group {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(new THREE.Mesh(new THREE.BoxGeometry()));
  if (light) inner.add(new THREE.PointLight());
  g.add(inner);
  return g;
}

// The records, in the order `add` is called each frame.
const R = {
  front: root(), // in the front room, well away from the doorway
  doorway: root(), // in the front room, reaching the doorway into the back
  back: root(), // in the back room, reaching the door to the world
  out: root(), // out in the open, far off
  step: root(), // out in the open, reaching the door from outside
  lit: root(true), // out in the open, with a light under it
  hidden: root(), // in the back room, hidden by its own owner
  other: root(), // in a room of a building nobody drew
  blade: root(), // a second root: the front body's lit blade
};
R.hidden.visible = false;
const NAMES = Object.keys(R) as (keyof typeof R)[];
const routes = new ActorRoutes();

/** Each record's sphere, x, y, z and radius, as the game writes them into `at` from its bodies' places. */
const SPHERES = new Float64Array([0, 1, -3, 0.5, 0, 1, -0.3, 0.5, 0, 1, 4.8, 0.5, 30, 1, 60, 0.5, 0, 1, 5.3, 0.5, 40, 1, 40, 2, 2, 1, 2, 0.5, 200, 1, -3, 0.5]);
function sphere(i: number): void {
  const at = routes.at;
  at[0] = SPHERES[i * 4];
  at[1] = SPHERES[i * 4 + 1];
  at[2] = SPHERES[i * 4 + 2];
  at[3] = SPHERES[i * 4 + 3];
  // Followed this very step: its room is where it stands.
  at[4] = 0;
}

/** A sphere written straight in, with how far the body has gone since its room was followed. */
function place(r: ActorRoutes, x: number, y: number, z: number, radius: number, lag = 0): void {
  const at = r.at;
  at[0] = x;
  at[1] = y;
  at[2] = z;
  at[3] = radius;
  at[4] = lag;
}

/** One frame's records, as the game collects them. */
function collect(): void {
  sphere(0);
  routes.add(ROUTE_KIND.mobile, R.front, R.blade, b, 1);
  sphere(1);
  routes.add(ROUTE_KIND.mobile, R.doorway, null, b, 1);
  sphere(2);
  routes.add(ROUTE_KIND.fighter, R.back, null, b, 2);
  sphere(3);
  routes.add(ROUTE_KIND.mobile, R.out, null, null, 0);
  sphere(4);
  routes.add(ROUTE_KIND.mobile, R.step, null, null, 0);
  sphere(5);
  routes.add(ROUTE_KIND.vehicle, R.lit, null, null, 0);
  sphere(6);
  routes.add(ROUTE_KIND.mobile, R.hidden, null, b, 2);
  sphere(7);
  routes.add(ROUTE_KIND.rig, R.other, null, far, 1);
}

const vis0 = () => NAMES.map((k) => (R[k].visible ? 1 : 0)).join('');
const before = vis0();
const seen = (only: (keyof typeof R)[]) => NAMES.map((k) => (only.includes(k) ? 1 : 0)).join('');
/** A pass's visibility as a string, the owner-hidden root always 0 and the untouched lit one always 1. */
const want = (shown: (keyof typeof R)[]) => seen([...shown, 'lit'].filter((k) => k !== 'hidden'));

// ---- 1. The doorway rule. ----
{
  lookFrom(0, 1.6, -4, 0, 1.6, 10);
  vis.compute(camera, b, 1, [], 0, W, H);
  ok(routes.begin(vis, true), 'a frame with a set worked out and the switch on collects its records');
  collect();
  ok(routes.roomsAt(0) === 1 && !routes.outdoorsAt(0), 'a body in the middle of a room counts in that room alone');
  ok(routes.roomsAt(1) === 2 && !routes.outdoorsAt(1), 'a body whose sphere reaches the doorway counts in the room beyond as well');
  ok(routes.roomsAt(2) === 2 && routes.outdoorsAt(2), 'a body reaching the door to the world counts outdoors as well');
  ok(routes.roomsAt(3) === 1 && routes.outdoorsAt(3), 'a body out in the open, far from any door, counts outdoors alone');
  ok(routes.roomsAt(4) === 2 && routes.outdoorsAt(4), 'a body outside reaching a door of a building drawn this frame counts in the room behind it');
  ok(routes.skippedAt(5) && routes.stats.unhideable === 1, 'a root with a light anywhere under it is left untouched, and counted');
  ok(routes.stats.doorway === 3, 'three records count in two rooms');
  routes.hideFrame();
  routes.restoreFrame();
}

// ---- 2. Inside the front room, facing the doorway: the back room and the world through its door are seen. ----
{
  lookFrom(0, 1.6, -4, 0, 1.6, 10);
  const res = vis.compute(camera, b, 1, [], 0, W, H);
  ok(res.worldSeen && vis.seenOf(b)?.[2] === 1, 'from the front room facing the doorway, the back room and the world are seen');
  routes.begin(vis, true);
  collect();
  routes.hideFrame();
  ok(vis0() === want(['front', 'blade', 'doorway', 'back', 'out', 'step']), `only the body in a building nobody drew is hidden for the frame (${vis0()})`);
  ok(routes.stats.hidden === 1 && routes.stats.hiddenByKind[ROUTE_KIND.rig] === 1, 'and it is counted, by kind');
  routes.route(ROUTE_PASS.shadows, null, null);
  ok(vis0() === want(['back', 'out', 'step']), `the shadow pass draws what stands outdoors, a body in a doorway to the world included (${vis0()})`);
  routes.route(ROUTE_PASS.building, b, null);
  ok(vis0() === want(['front', 'blade', 'doorway', 'back', 'step']), `the building's own pass draws what stands in its rooms and a body outside reaching its door, and a blade with its body (${vis0()})`);
  const pv = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const fr = new THREE.Frustum();
  ok(exitFrustum(res.exitRect, pv, fr), 'the exits make a rectangle narrower than the screen');
  routes.route(ROUTE_PASS.world, null, fr);
  ok(vis0() === want(['back', 'step']), `the world pass from inside draws what stands outdoors where the exits show it, not what the door hides (${vis0()})`);
  routes.route(ROUTE_PASS.world, null, null);
  ok(vis0() === want(['back', 'out', 'step']), `and with nothing to narrow by, all of what stands outdoors (${vis0()})`);
  routes.endPasses();
  ok(vis0() === want(['front', 'blade', 'doorway', 'back', 'out', 'step']) && routes.stats.undrawn === 0, `after the passes everything drawn is as the frame left it (${vis0()})`);
  routes.restoreFrame();
  ok(vis0() === before, 'and after the effects every root is back to its own value, the one its owner hid still hidden');
  ok(routes.stats.shownShadows === 3 && routes.stats.shownRooms === 5 && routes.stats.shownWorld === 5 && routes.stats.passes[0] === 1 && routes.stats.passes[2] === 1 && routes.stats.passes[1] === 2, 'the counts per pass say what each drew');
}

// ---- 3. Inside the front room, facing away: nothing beyond the room is seen. ----
{
  lookFrom(0, 1.6, -1, 0, 1.6, -10);
  const res = vis.compute(camera, b, 1, [], 0, W, H);
  ok(!res.worldSeen && vis.seenOf(b)?.[2] === 2, 'from the front room facing away, the back room is only one room past a seen one and the world is unseen');
  routes.begin(vis, true);
  collect();
  routes.hideFrame();
  ok(vis0() === want(['front', 'blade', 'doorway']), `only what stands in the front room is left: the back room's, the outdoors' and the far building's are hidden for the frame (${vis0()})`);
  routes.route(ROUTE_PASS.building, b, null);
  ok(vis0() === want(['front', 'blade', 'doorway']), `the room's pass draws them (${vis0()})`);
  routes.endPasses();
  routes.restoreFrame();
  ok(vis0() === before, 'and everything is put back');
  // What the creatures' manager reads next step, a frame late (`levelOf`).
  const L = (k: keyof typeof R) => routes.levelOf(R[k]);
  ok(L('front') === ROOM_LEVEL.seen && L('doorway') === ROOM_LEVEL.seen && L('hidden') === ROOM_LEVEL.past && L('other') === ROOM_LEVEL.unseen, 'the manager reads the front room seen, the back one past it, and a building nobody flooded unseen');
  ok(L('back') === ROOM_LEVEL.unknown && L('out') === ROOM_LEVEL.unknown && L('step') === ROOM_LEVEL.unknown && L('lit') === ROOM_LEVEL.unknown, 'and leaves to the frustum what counts outdoors, from inside with no exit in sight as well, and what was left untouched');
  ok(routes.levelOf(new THREE.Group()) === ROOM_LEVEL.unknown, 'a root the frame did not route is not known');
  routes.tick();
  ok(L('front') === ROOM_LEVEL.seen && L('hidden') === ROOM_LEVEL.past, 'one step later, which is when the manager reads it, the frame just drawn still stands');
  routes.tick();
  ok(L('front') === ROOM_LEVEL.unknown && L('hidden') === ROOM_LEVEL.unknown && L('other') === ROOM_LEVEL.unknown, 'two steps with no frame drawn between (a driven tab, the steps after a travel) and nothing is known: the frustum decides again');
  routes.begin(vis, true);
  collect();
  routes.hideFrame();
  routes.restoreFrame();
  ok(L('hidden') === ROOM_LEVEL.past, 'a frame drawn again brings it back');
  routes.begin(vis, false);
  ok(L('hidden') === ROOM_LEVEL.unknown, 'and a frame that collects nothing (the switches off, no set) leaves nothing standing');
}

// ---- 4. Outside, before the door: the world pass takes what stands outdoors, the building's what is in it. ----
{
  lookFrom(0, 1.6, 20, 0, 1.6, 0);
  const res = vis.compute(camera, null, 0, [b], 1, W, H);
  ok(res.drawnCount === 1 && vis.seenOf(b)?.[2] === 1 && vis.seenOf(b)?.[1] === 1, 'from outside facing the door, both rooms are seen through it');
  routes.begin(vis, true);
  collect();
  routes.hideFrame();
  ok(routes.levelOf(R.out) === ROOM_LEVEL.unknown && routes.levelOf(R.front) === ROOM_LEVEL.seen, 'outside, the open is left to the frustum and a room seen through the door is seen');
  routes.route(ROUTE_PASS.shadows, null, null);
  routes.route(ROUTE_PASS.world, null, null);
  ok(vis0() === want(['back', 'out', 'step']), `the world pass outside draws only what stands outdoors (${vis0()})`);
  // The building's pass is not drawn this frame (its doors were, say, off the screen): what stands only in its rooms went into no view pass.
  routes.endPasses();
  ok(vis0() === want(['back', 'out', 'step', 'blade']) && routes.stats.undrawn === 3, `what no view pass drew is kept hidden through the effects, so the motion blur never draws a mesh three did not; its blade is put back for them, since what it lights may be on the screen (${vis0()})`);
  routes.restoreFrame();
  ok(vis0() === before, 'and put back after them');
  // A frame that threw before its `restoreFrame` is put back by the next one's `begin`.
  routes.begin(vis, true);
  collect();
  routes.hideFrame();
  routes.route(ROUTE_PASS.shadows, null, null);
  routes.begin(vis, false);
  ok(vis0() === before && !routes.active, 'a frame that never put its roots back has them put back by the next, which with the switch off collects nothing');
}

// ---- 5. The light guard, again, with a light that comes later: looked at again every `lightEvery` frames. ----
{
  const late = root();
  lookFrom(0, 1.6, 20, 0, 1.6, 0);
  vis.compute(camera, null, 0, [b], 1, W, H);
  const run = () => {
    routes.begin(vis, true);
    sphere(7);
    routes.add(ROUTE_KIND.mobile, late, null, far, 1);
    routes.hideFrame();
    const hid = !late.visible;
    routes.restoreFrame();
    return hid;
  };
  ok(run(), 'a body in a room nobody can see is hidden');
  late.children[0].add(new THREE.SpotLight());
  let frames = 0;
  while (run() && frames < 1000) frames++;
  ok(frames > 0 && frames <= 121, `a light hung under it later is found within the look's own period, and from then it is never hidden (${frames} frames)`);
}

// ---- 6. The tiers the manager gives a body by its room (`lodTier`). ----
{
  const base: LodInput = { dist: 20, onScreen: true, nearScreen: true, busy: false, sizeClass: 'medium', shadows: true, playerDist: 20, animRange: 160, room: -1 };
  const t = (o: Partial<LodInput>) => lodTier({ ...base, ...o }, LOD_TUNE);
  ok(t({}).name === 'near' && t({}).castShadow && t({ room: 1 }).name === 'near', 'a body in a seen room, or one whose room is not known, is tiered by the frustum as before');
  const unseen = t({ room: 0 });
  ok(unseen.name === 'frozen' && !unseen.castShadow && unseen.animEvery === 0 && unseen.visible, 'in an unseen room it is off screen: frozen, no shadow, and still left drawn for the routing to decide');
  ok(t({ room: 0, busy: true }).name === 'hidden' && t({ room: 0, busy: true }).animEvery === 2, 'unless it is busy, which is never frozen');
  const past = t({ room: 2 });
  ok(past.name === 'hidden' && past.animEvery === 8 && !past.castShadow, 'one room past a seen one it is the hidden tier: animated every eighth frame, no shadow, never frozen');
  ok(t({ room: 0, dist: 300, playerDist: 300 }).move === false, 'and far off in an unseen room it sleeps as any frozen body does');
}

// ---- 7. Two buildings drawn from outside: each one's pass takes its own people and nobody else's. ----
{
  const b2 = buildingAt(12, 0);
  lookFrom(6, 1.6, 22, 6, 1.6, 0);
  const res = vis.compute(camera, null, 0, [b, b2], 2, W, H);
  ok(res.drawnCount === 2 && vis.seenOf(b)?.[2] === 1 && vis.seenOf(b2)?.[2] === 1, 'from outside between them, both buildings are drawn and both back rooms seen through their doors');
  const r = new ActorRoutes();
  const inA = root();
  const inB = root();
  r.begin(vis, true);
  place(r, 0, 1, 3, 0.5);
  r.add(ROUTE_KIND.mobile, inA, null, b, 2);
  place(r, 12, 1, 3, 0.5);
  r.add(ROUTE_KIND.mobile, inB, null, b2, 2);
  r.hideFrame();
  ok(inA.visible && inB.visible && r.stats.hidden === 0, 'neither is hidden for the frame: both rooms are seen');
  r.route(ROUTE_PASS.world, null, null);
  ok(!inA.visible && !inB.visible, 'the world pass takes neither: both stand indoors');
  r.route(ROUTE_PASS.building, b, null);
  ok(inA.visible && !inB.visible, "the first building's pass takes its own body and not the one in the building beside it");
  r.route(ROUTE_PASS.building, b2, null);
  ok(!inA.visible && inB.visible, "and the second building's pass the other way round");
  r.endPasses();
  ok(inA.visible && inB.visible && r.stats.undrawn === 0 && r.stats.shownRooms === 2, 'after the passes each was drawn once, in its own building');
  r.restoreFrame();
}

// ---- 8. A body whose room was followed some way back: counted in every room it can have reached since. ----
{
  const r = new ActorRoutes();
  // A runner that has gone out of the back room through the door, 1.8 m past it, before its room was followed again.
  lookFrom(0, 1.6, 20, 0, 1.6, 0);
  vis.compute(camera, null, 0, [b], 1, W, H);
  const runner = root();
  r.begin(vis, true);
  place(r, 0, 1, 6.8, 0.5, 0);
  r.add(ROUTE_KIND.fighter, runner, null, b, 2);
  ok(!r.outdoorsAt(0), 'taken where its room says, with no lag its sphere no longer reaches the door, and it would be drawn only through the doorway it has left');
  r.hideFrame();
  r.restoreFrame();
  r.begin(vis, true);
  place(r, 0, 1, 6.8, 0.5, 1.8);
  r.add(ROUTE_KIND.fighter, runner, null, b, 2);
  ok(r.outdoorsAt(0) && r.countsIn(0, b, 2), 'grown by the 1.8 m it has gone since, its sphere reaches the door it went through: it counts outdoors and in the room it left');
  r.hideFrame();
  r.route(ROUTE_PASS.world, null, null);
  ok(runner.visible, 'and the world pass draws it where it stands');
  r.endPasses();
  r.restoreFrame();

  // A corpse thrown from the front room through the doorway into the back room, where the camera is; the
  // front room is behind the camera, one room past a seen one. Its room stopped being followed when it died.
  lookFrom(0, 1.6, 4, 0, 1.6, 10);
  vis.compute(camera, b, 2, [], 0, W, H);
  ok(vis.seenOf(b)?.[2] === 1 && vis.seenOf(b)?.[1] === 2, 'from the back room facing the door, the front room behind is only one past a seen one');
  const corpse = root();
  r.begin(vis, true);
  place(r, 0, 1, 2.5, 1, 0);
  r.add(ROUTE_KIND.mobile, corpse, null, b, 1);
  r.hideFrame();
  ok(r.hiddenAt(0) && !corpse.visible, 'taken where it died, the corpse is hidden for the whole frame though it lies in the room on the screen');
  r.restoreFrame();
  r.begin(vis, true);
  place(r, 0, 1, 2.5, 1, 5);
  r.add(ROUTE_KIND.mobile, corpse, null, b, 1);
  r.hideFrame();
  ok(!r.hiddenAt(0) && r.countsIn(0, b, 2) && corpse.visible, 'grown by the 5 m it was thrown, it counts in the room it lies in and is drawn');
  r.route(ROUTE_PASS.building, b, null);
  ok(corpse.visible, "in that room's pass");
  r.endPasses();
  r.restoreFrame();

  // Two portals crossed between follows: from the front room across the narrow hall, the body now in the
  // hall and its sphere reaching the back room's doorway. A room past a room it reached is reached too.
  const h = buildingAt(40, 0, hallDef);
  lookFrom(40, 1.6, 20, 40, 1.6, 0);
  vis.compute(camera, null, 0, [h], 1, W, H);
  const walker = root();
  r.begin(vis, true);
  place(r, 40, 1, 1.2, 0.5, 1.7);
  r.add(ROUTE_KIND.mobile, walker, null, h, 1);
  ok(r.countsIn(0, h, 1) && r.countsIn(0, h, 2) && r.countsIn(0, h, 3) && !r.outdoorsAt(0), 'a body that crossed into the hall since its room was followed counts in the room it left, the hall, and the room its sphere reaches from the hall');
  r.hideFrame();
  r.restoreFrame();
  // With no lag, where it stands decides: in the front room at the hall's doorway it counts in both, and no further.
  r.begin(vis, true);
  place(r, 40, 1, -0.3, 0.5, 0);
  r.add(ROUTE_KIND.mobile, walker, null, h, 1);
  ok(r.countsIn(0, h, 1) && r.countsIn(0, h, 2) && !r.countsIn(0, h, 3), 'followed this step, a body at a doorway counts in its two rooms and no third');
  r.hideFrame();
  r.restoreFrame();
}

// ---- 9. What the tiers read is the routing's own answer: a body drawn through a doorway is not walled up. ----
{
  // From the front room facing away: the back room is one past a seen one.
  lookFrom(0, 1.6, -1, 0, 1.6, -10);
  vis.compute(camera, b, 1, [], 0, W, H);
  const r = new ActorRoutes();
  const atDoor = root(); // in the back room, reaching the doorway into the seen front room
  const inBack = root(); // in the back room, away from both doors
  const sword = root(); // a lit blade, beside the body in the back room
  r.begin(vis, true);
  place(r, 0, 1, 0.3, 0.5);
  r.add(ROUTE_KIND.fighter, atDoor, null, b, 2);
  place(r, 2, 1, 2, 0.5);
  r.add(ROUTE_KIND.fighter, inBack, sword, b, 2);
  r.hideFrame();
  ok(!r.hiddenAt(0) && atDoor.visible && r.levelOf(atDoor) === ROOM_LEVEL.seen, "a body in a room past a seen one, reaching the seen room's doorway, is drawn, and the tiers take it as seen rather than frozen");
  ok(r.hiddenAt(1) && !inBack.visible && !sword.visible && r.levelOf(inBack) === ROOM_LEVEL.past, 'one in the middle of that room is hidden for the frame, blade and all, and the tiers take it as one room past');
  r.route(ROUTE_PASS.building, b, null);
  ok(atDoor.visible && !inBack.visible && !sword.visible, 'the room pass draws the one at the doorway only');
  r.endPasses();
  ok(!inBack.visible && sword.visible, 'after the passes the hidden body stays hidden through the effects and its blade is back, for what it lights through the doorway');
  r.restoreFrame();
  ok(inBack.visible && sword.visible && atDoor.visible, 'and after the effects both are back');
  // Only the tiers' switch on: the levels are worked out, nothing is hidden and no pass is routed.
  r.begin(vis, true);
  place(r, 2, 1, 2, 0.5);
  r.add(ROUTE_KIND.fighter, inBack, sword, b, 2);
  r.hideFrame(false);
  ok(!r.active && inBack.visible && sword.visible && r.stats.hidden === 0 && r.levelOf(inBack) === ROOM_LEVEL.past, 'with the routing off and the tiers on, the levels are read and nothing is hidden or routed');
  r.route(ROUTE_PASS.building, b, null);
  r.endPasses();
  r.restoreFrame();
  ok(inBack.visible && sword.visible, 'and nothing is touched by the passes either');
}

// ---- 10. The wiring no node test can run, read from the sources: the game, the world and the creatures. ----
{
  const read = (p: string) => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8');
  const main = read('main.ts');
  const collect = main.slice(main.indexOf('private collectRoutes(): void {'), main.indexOf('private readonly routeMid'));
  ok((collect.match(/at\[4\] = /g) ?? []).length === 4 && collect.includes('mobiles.cellFromOf(m)') && collect.includes('n.cellFrom') && collect.includes('w.vehicleRoomFrom(v)'), "every kind the game routes writes how far it has gone since its room was followed: the creatures' and fighters' own follow points, the ships' sample points, and nothing for a shuttle on its pad");
  ok(collect.includes("routing || cullOn('seenTiers')") && collect.includes('r.hideFrame(routing)'), "the records are collected for the creatures' tiers too, and hidden and routed only with the routing's own switch");
  const world = read('world/world.ts');
  const living = world.slice(world.indexOf('  stepLiving(dt: number'), world.indexOf('wildLife.step(dt'));
  ok(living.indexOf('actors.tick()') >= 0 && living.indexOf('actors.tick()') < living.indexOf('this.mobiles?.update('), "every step the creatures take is counted before they read how the last frame saw their rooms, so a level more than a step old is never acted on");
  const manager = read('world/mobiles/manager.ts');
  ok(manager.includes('this.deps.roomSeen(m.group)') && manager.includes('(cast && held.cast === false)'), "the manager reads each body's level by its own group, and puts a shadow on the step it is wanted rather than on the half-second");
  const mobile = read('world/mobiles/mobile.ts');
  const animate = mobile.slice(mobile.indexOf('  private animate(dt: number, tier: LodTier): void {'));
  ok(/if \(this\.posed\) \{\s*if \(every <= 0\) return;/.test(animate) && animate.includes('this.posed = true;') && (mobile.match(/this\.posed = false;/g) ?? []).length >= 2, 'a body frozen from the start is posed once all the same, on being hung and on being stood again, so it is never revealed in its rest pose');
}

// ---- 11. Nothing allocated by a frame of it. ----
{
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    const cams = [
      [0, 1.6, -4, 0, 1.6, 10],
      [0, 1.6, -1, 0, 1.6, -10],
    ].map((p) => {
      const c = new THREE.PerspectiveCamera(60, W / H, 0.05, 9000);
      c.position.set(p[0], p[1], p[2]);
      c.lookAt(p[3], p[4], p[5]);
      c.updateMatrixWorld(true);
      return c;
    });
    const fr = new THREE.Frustum();
    const pv = new THREE.Matrix4();
    // One empty list for the buildings from outside, as the renderer keeps one: a literal here would be the garbage measured.
    const NONE: VisBuilding[] = [];
    // A corpse thrown through the doorway, whose sphere grown by its lag spreads through both rooms and out of the door.
    const thrown = root();
    let levels = 0;
    const body = (i: number) => {
      const c = cams[i & 1];
      vis.compute(c, b, 1, NONE, 0, W, H);
      routes.begin(vis, true);
      collect();
      place(routes, 0, 1, 2.5, 1, 5);
      routes.add(ROUTE_KIND.mobile, thrown, null, b, 1);
      routes.hideFrame();
      routes.route(ROUTE_PASS.shadows, null, null);
      routes.route(ROUTE_PASS.building, b, null);
      pv.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
      routes.route(ROUTE_PASS.world, null, exitFrustum(vis.result.exitRect, pv, fr) ? fr : null);
      routes.endPasses();
      routes.restoreFrame();
      // The next step, as the creatures' manager takes it: a tick, and each body's level read.
      routes.tick();
      levels += routes.levelOf(R.front) + routes.levelOf(R.hidden) + routes.levelOf(thrown);
    };
    for (let i = 0; i < 200000; i++) body(i);
    let gcs = 0;
    const obs = new PerformanceObserver((list) => {
      gcs += list.getEntries().length;
    });
    obs.observe({ entryTypes: ['gc'] });
    const youngSpace = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    const settle = () => new Promise<void>((r) => setTimeout(r, 20));
    let perFrame = Infinity;
    for (let attempt = 0; attempt < 4; attempt++) {
      gc();
      await settle();
      gcs = 0;
      const b0 = youngSpace();
      for (let i = 0; i < 2000; i++) body(i);
      const b1 = youngSpace();
      await settle();
      perFrame = (b1 - b0) / 2000;
      if (gcs === 0) break;
    }
    obs.disconnect();
    ok(gcs === 0 && perFrame < 4, `a frame's records, a lagging body's spread through the portals, hiding, routing of every pass, putting back and the levels read after make no garbage (${perFrame.toFixed(2)} bytes a frame over two thousand)`);
    ok(vis0() === before && Number.isFinite(levels), 'and after all of it every root is as its owner left it');
  } else console.log('skip nothing allocated on a frame: run with node --expose-gc to measure');
}

console.log(`\n${checks} checks passed`);
