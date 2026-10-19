// The room deferral (src/world/roomDefer.ts, the routes' `F_NOROOM` in src/world/portalCull.ts, the renderer's own
// guard in src/world/portalRender.ts), checked without a browser over the portal culling test's made-up building of two
// rooms and a door: a body whose rooms programs are still being built off the frame is never shown in a building's pass
// and is in the world pass as before, and its record says it counts in a room so its job is made urgent; one whose
// sphere reaches more rooms than the routes take is flagged `F_NOROOM` rather than skipped (a skipped record is drawn in
// every building's pass), while a room-ready one keeps the wide skip; a lit one stays skipped and is counted; with the
// routes off for the frame the renderer hides every pending root around each rooms pass and puts it back; the deferred
// work itself, through the real program queue, is tied to the life of what it compiles (an owner gone while it waits
// compiles nothing and is never ready; work a world's unload lets go stays not ready and is asked for again, urgent or
// not, by the next body that wants it; a promote moves it ahead of scenery pushed before it); and no light is hung
// under a mobile's or a fighter's root anywhere in the code, which the lit case leans on. The game's own hand-overs of
// all this are pinned as text in programWiring.test.ts.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { ActorRoutes, ROUTE_KIND, ROUTE_PASS, ROUTE_TUNE } from '../../../src/world/portalCull.ts';
import { PORTAL_CULL, PortalVisibility, type PortalCullTune, type VisBuilding } from '../../../src/world/portalVis.ts';
import { PortalRenderer } from '../../../src/world/portalRender.ts';
import { ROOM_DEFER, ROOM_DEFER_STATS, deferRooms, roomJob, type RoomCompile, type RoomQueue } from '../../../src/world/roomDefer.ts';
import { ProgramQueue } from '../../../src/core/programQueue.ts';
import type { Portal } from '../../../src/world/assetPack.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

function quad(x0: number, x1: number, y0: number, y1: number, z: number): { v: number[][]; i: number[] } {
  return { v: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], i: [0, 1, 2, 0, 2, 3] };
}

interface Def {
  id: string;
  bounds: { min: number[]; max: number[] };
  cells: { index: number; name: string; bounds: { min: number[]; max: number[] }; portals: { geometry: number; target: number; passable: boolean }[] }[];
  portals: { v: number[][]; i: number[] }[];
}

/** Two rooms along z and a door to the world at z 5, as the portal culling test builds them. */
const boxDef: Def = {
  id: 'test_defer_two_rooms',
  bounds: { min: [-5, 0, -5], max: [5, 3, 5] },
  cells: [
    { index: 0, name: 'r0', bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, portals: [{ geometry: 1, target: 2, passable: true }] },
    { index: 1, name: 'front', bounds: { min: [-5, 0, -5], max: [5, 3, 0] }, portals: [{ geometry: 0, target: 2, passable: true }] },
    { index: 2, name: 'back', bounds: { min: [-5, 0, 0], max: [5, 3, 5] }, portals: [{ geometry: 0, target: 1, passable: true }, { geometry: 1, target: 0, passable: true }] },
  ],
  portals: [quad(-1, 1, 0, 2.2, 0), quad(-1, 1, 0, 2.2, 5)],
};

function portalsOf(def: Def): Portal[] {
  const portals: Portal[] = def.portals.map((poly) => {
    const verts = poly.v.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
    const normal = new THREE.Vector3().subVectors(verts[1], verts[0]).cross(new THREE.Vector3().subVectors(verts[2], verts[0])).normalize();
    return { verts, indices: poly.i.slice(), normal, d: normal.dot(verts[0]), links: [], passable: true };
  });
  for (const c of def.cells) for (const l of c.portals) portals[l.geometry]?.links.push({ from: c.index, to: l.target });
  return portals;
}

const matrix = new THREE.Matrix4();
const b: VisBuilding & { interior: THREE.Mesh[]; interiorCell: number[] } = { model: { portals: portalsOf(boxDef), def: boxDef }, matrix, inverse: matrix.clone().invert(), x: 0, z: 0, radius: 5, interior: [], interiorCell: [] };

const W = 1920;
const H = 1080;
const camera = new THREE.PerspectiveCamera(60, W / H, 0.05, 9000);
function lookFrom(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
  camera.position.set(x, y, z);
  camera.lookAt(tx, ty, tz);
  camera.updateMatrixWorld(true);
}
const tune: PortalCullTune = { ...PORTAL_CULL, on: true, mode: 'rooms' };
const vis = new PortalVisibility(tune);

function root(light = false): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry()));
  if (light) g.add(new THREE.PointLight());
  return g;
}

function place(r: ActorRoutes, x: number, y: number, z: number, radius: number): void {
  r.at[0] = x;
  r.at[1] = y;
  r.at[2] = z;
  r.at[3] = radius;
  r.at[4] = 0;
}

// ---- 1. Not room-ready: never in a building's pass, in the world pass as before, and its job made urgent. ----
{
  const routes = new ActorRoutes();
  const inFront = root();
  const atDoor = root();
  const outside = root();
  const readyFront = root();
  lookFrom(0, 1.6, -4, 0, 1.6, 10);
  vis.compute(camera, b, 1, [], 0, W, H);
  routes.begin(vis, true);
  place(routes, 0, 1, -3, 0.5);
  const wantsRooms = routes.add(ROUTE_KIND.mobile, inFront, null, b, 1, false);
  place(routes, 0, 1, 4.8, 0.5);
  routes.add(ROUTE_KIND.fighter, atDoor, null, b, 2, false);
  place(routes, 30, 1, 60, 0.5);
  const outsideWants = routes.add(ROUTE_KIND.mobile, outside, null, null, 0, false);
  place(routes, 0, 1, -3.5, 0.5);
  const readyWants = routes.add(ROUTE_KIND.mobile, readyFront, null, b, 1, true);
  ok(wantsRooms, 'a body not room-ready standing in a room says so, so its rooms job is made urgent');
  ok(!outsideWants, 'one out in the open, far from any door, does not');
  ok(!readyWants, 'and a room-ready one never does');
  ok(routes.stats.notReady === 3, 'the records not room-ready are counted');
  routes.hideFrame();
  routes.route(ROUTE_PASS.building, b, null);
  ok(!inFront.visible && !atDoor.visible && readyFront.visible, 'in the building\'s pass the bodies not room-ready are left out and the room-ready one is drawn');
  routes.route(ROUTE_PASS.world, null, null);
  ok(atDoor.visible && outside.visible && !inFront.visible, 'in the world pass what stands outdoors is drawn as before, ready or not (the one at the door counts outdoors too)');
  routes.route(ROUTE_PASS.shadows, null, null);
  ok(atDoor.visible && outside.visible, 'and in the shadow pass');
  routes.endPasses();
  routes.restoreFrame();
  ok(inFront.visible && atDoor.visible && outside.visible && readyFront.visible, 'and every root is put back after the frame');
}

// ---- 2. Wide: a record reaching more rooms than the routes take. ----
{
  // One room a record may count in: any doorway makes it wide.
  const routes = new ActorRoutes(1);
  ok(ROUTE_TUNE.maxRooms > 1, 'the routes take more than one room by default (the narrow cap is this test\'s own)');
  const notReady = root();
  const ready = root();
  lookFrom(0, 1.6, -4, 0, 1.6, 10);
  vis.compute(camera, b, 1, [], 0, W, H);
  routes.begin(vis, true);
  place(routes, 0, 1, -0.3, 0.5);
  const wants = routes.add(ROUTE_KIND.mobile, notReady, null, b, 1, false);
  place(routes, 0, 1, -0.3, 0.5);
  routes.add(ROUTE_KIND.mobile, ready, null, b, 1, true);
  ok(!routes.skippedAt(0), 'a record not room-ready that reaches more rooms than the routes take is not skipped');
  ok(routes.skippedAt(1), 'a room-ready one keeps the wide skip, as before');
  ok(routes.stats.deferredWide === 1, 'the wide record not room-ready is counted (deferredWide)');
  ok(wants, 'and says it counts in a room, so its job is made urgent');
  routes.hideFrame();
  routes.route(ROUTE_PASS.building, b, null);
  ok(!notReady.visible, 'it is never shown in a building\'s pass');
  ok(ready.visible, 'where the skipped room-ready one is drawn in every building\'s pass as it always was');
  routes.endPasses();
  routes.restoreFrame();
  ok(notReady.visible && ready.visible, 'and both are put back after the frame');
}

// ---- 3. Lit: never hidden from a pass, ready or not, and counted. ----
{
  const routes = new ActorRoutes();
  const lit = root(true);
  lookFrom(0, 1.6, -4, 0, 1.6, 10);
  vis.compute(camera, b, 1, [], 0, W, H);
  routes.begin(vis, true);
  place(routes, 0, 1, -3, 0.5);
  const wants = routes.add(ROUTE_KIND.mobile, lit, null, b, 1, false);
  ok(routes.skippedAt(0) && routes.stats.deferredLit === 1, 'a record not room-ready with a light under it stays skipped, and is counted (deferredLit)');
  ok(!wants, 'and asks for nothing: it is drawn in every pass (hiding a light would change the light count)');
  routes.hideFrame();
  routes.route(ROUTE_PASS.building, b, null);
  ok(lit.visible, 'so it is drawn in the building\'s pass: the one case the guard leaves, which no body ever is');
  routes.endPasses();
  routes.restoreFrame();
}

// ---- 4. With the routes off for the frame the renderer hides the pending roots around each rooms pass. ----
{
  const hiddenAt: number[] = [];
  const pending = [root(), root()];
  const stub = {
    autoClear: true,
    info: { render: { calls: 0, triangles: 0 } },
    shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false },
    state: { buffers: { stencil: { setClear: () => undefined } } },
    renderBufferDirect: () => undefined,
    clear: () => undefined,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(W, H),
    compile: () => new Set(),
    render: (scene: THREE.Object3D) => {
      if ((scene as THREE.Scene).name === 'the rooms passes') hiddenAt.push(pending.filter((p) => !p.visible).length);
    },
  };
  const portals = new PortalRenderer(stub as unknown as THREE.WebGLRenderer);
  portals.roomPending[0] = pending[0];
  portals.roomPending[1] = pending[1];
  portals.roomPendingCount = 2;
  lookFrom(0, 1.6, -3, 0, 1.6, 10);
  portals.render(new THREE.Scene(), camera, b as never, [b as never]);
  ok(hiddenAt.length === 1 && hiddenAt[0] === 2, 'with the routes off, both pending roots are hidden in the rooms pass');
  ok(pending.every((p) => p.visible), 'and put back after it');
  portals.roomPendingCount = 0;
  hiddenAt.length = 0;
  portals.render(new THREE.Scene(), camera, b as never, [b as never]);
  ok(hiddenAt[0] === 0, 'with nobody pending, nobody is hidden');
}

// ---- 5. The handle and the switch. ----
{
  const job = roomJob();
  ok(job.ready === true && job.gone === false, 'a fresh handle is ready until something is deferred under it, and its owner is there');
  job.promote();
  job.resume();
  ok(job.ready === true, 'asked to go ahead or to ask again with nothing deferred, it does nothing');
  ok(ROOM_DEFER.on === true, 'the deferral ships on (`roomDefer` is the comparing switch)');
}

// ---- 5b. The deferred work, through the real queue: tied to the life of what it compiles. ----
{
  const nameOf = (o: THREE.Object3D): string => (o as unknown as { name: string }).name;
  const obj = (name: string): THREE.Object3D => ({ name }) as unknown as THREE.Object3D;
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  const q = new ProgramQueue();
  const compiled: string[] = [];
  const compile: RoomCompile = (o) => {
    compiled.push(nameOf(o));
    return { made: 1, done: true };
  };
  const queue: RoomQueue = { push: (objects, label, urgent, own) => q.push(objects, label, urgent, own), promote: (own) => q.promote(own) };
  const pumpAll = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) q.pump(false, (o) => (compiled.push(`scenery ${nameOf(o)}`), { made: 1, done: true }), () => 0);
    await tick();
  };
  const stats = { ...ROOM_DEFER_STATS };

  // Answered with its programs built: ready, and nothing left to make urgent.
  const plain = roomJob();
  deferRooms(plain, [obj('a')], 'a look (its rooms)', compile, queue);
  ok(!plain.ready && ROOM_DEFER_STATS.deferred === stats.deferred + 1, 'deferred, the handle is not ready and the deferral is counted');
  await pumpAll();
  ok(compiled.join() === 'a' && plain.ready, 'its rooms pass is compiled by its own turn, and the handle is ready once it is answered');

  // Its owner gone while it waits (a cached look trimmed, a fighter let go): nothing is compiled, and it is never ready.
  compiled.length = 0;
  const trimmed = roomJob();
  deferRooms(trimmed, [obj('b')], 'a trimmed look (its rooms)', compile, queue);
  trimmed.gone = true;
  await pumpAll();
  ok(compiled.length === 0, `a batch whose owner went while it waited compiles nothing when its turn comes (${compiled.join() || 'nothing compiled'})`);
  ok(!trimmed.ready && ROOM_DEFER_STATS.cancelled === stats.cancelled + 1, 'and is never marked ready; it is counted as cancelled');
  trimmed.promote();
  trimmed.resume();
  await pumpAll();
  ok(compiled.length === 0, 'nor does anything ask for it again');
  compiled.length = 0;
  const goneFirst = roomJob();
  goneFirst.gone = true;
  deferRooms(goneFirst, [obj('b2')], 'a look gone before it was deferred', compile, queue);
  await pumpAll();
  ok(compiled.length === 0 && ROOM_DEFER_STATS.deferred === stats.deferred + 2, 'an owner gone before its rooms were deferred defers nothing');

  // Let go unbuilt (a world unloading clears the queue): not ready, and asked for again by the next body that wants it.
  compiled.length = 0;
  const dropped = roomJob();
  deferRooms(dropped, [obj('c')], 'a look a world let go (its rooms)', compile, queue);
  q.clear();
  await tick();
  ok(compiled.length === 0 && !dropped.ready, 'the queue cleared answers the batch unbuilt, and the handle stays not ready (drawn in a rooms pass, it would build there on a live frame)');
  ok(ROOM_DEFER_STATS.dropped === stats.dropped + 1, 'counted as dropped');
  dropped.resume();
  await pumpAll();
  ok(compiled.join() === 'c' && dropped.ready, 'stood again outdoors, its rooms work is asked for again below the urgent rank, built and ready');
  compiled.length = 0;
  const droppedThenIndoors = roomJob();
  deferRooms(droppedThenIndoors, [obj('d')], 'another look a world let go (its rooms)', compile, queue);
  q.clear();
  await tick();
  void q.push([obj('tier')], 'the placed-object streamer');
  droppedThenIndoors.promote();
  await pumpAll();
  ok(compiled[0] === 'd' && compiled.includes('scenery tier') && droppedThenIndoors.ready, `wanted in a room, it is asked for again urgent and goes ahead of the scenery already waiting (${compiled.join()})`);

  // Made urgent while it still waits: it goes ahead of the scenery pushed before it.
  compiled.length = 0;
  void q.push([obj('tier2')], 'the placed-object streamer');
  const waiting = roomJob();
  deferRooms(waiting, [obj('e')], 'a look walking indoors (its rooms)', compile, queue);
  waiting.promote();
  await pumpAll();
  ok(compiled[0] === 'e' && waiting.ready, `a body counting in a room while its rooms wait has them go ahead of the scenery pushed before them (${compiled.join()})`);
  compiled.length = 0;
  void q.push([obj('tier3')], 'the placed-object streamer');
  const notPromoted = roomJob();
  deferRooms(notPromoted, [obj('f')], 'a look that stays outdoors (its rooms)', compile, queue);
  await pumpAll();
  ok(compiled[0] === 'scenery tier3', `and without that the scenery pushed first is compiled first, so the check above can fail (${compiled.join()})`);
}

// ---- 6. No light is hung under a mobile's or a fighter's root. ----
{
  const root = new URL('../../../src/', import.meta.url);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(new URL('world/mobiles/', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  files.push(new URL('world/npcs.ts', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const lightMakers = /new THREE\.(PointLight|SpotLight|DirectionalLight|HemisphereLight|AmbientLight|RectAreaLight)\b/;
  const offenders = files.filter((f) => lightMakers.test(readFileSync(f, 'utf8')));
  ok(files.length > 10, `the mobiles' folder and the fighters' file were read (${files.length} files)`);
  ok(offenders.length === 0, `nothing under src/world/mobiles/ or in src/world/npcs.ts makes a light (${offenders.join(', ') || 'none'})`);
}

console.log(`\n${checks} checks passed`);
