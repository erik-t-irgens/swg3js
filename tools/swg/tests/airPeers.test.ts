// What stirs the air that no hull of this world is (the volumetrics' sixth wave, the design's §2.12 and §14): another
// player's ride, from where this screen draws it (`nearRides.ts`, the walk `RemotePlayers.nearRides` runs), and a stood
// shuttle's engines while a flame its clip lights is in its window (`RigFx.jetsInto`). Held here: the walk writes each
// shown ride's place, its reckoned velocity (the one its game sent while the picture is reckoned, else the glide's), its
// turn, its kind, its flags, its box and its key into the kept arrays, and leaves out a peer on foot, hidden (in a jump,
// on another world), a picture not in yet, a ride clamped onto another ship and one past the reach; it allocates
// nothing; through the real `pushEngines` a driven ride's engine stands at the rear of its box along its tail at its
// kind's exit by how hard it is reckoned to run, a parked, set-down, riderless or creature ride stirs nothing, and a ship
// of theirs holding itself up blows down under it; a shuttle's jets are its flames' windows, straight down at its exit.
//
// The shuttle's rigs name neighbours without an extension, so this suite registers the off-proof's loader over today's
// tree alone (`airLoader.mjs`). The allocation check runs in a node process of its own with `--expose-gc`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { REPO } from './airTrees.ts';
import { newNearRides, nearRidesIn, rideKindOf, RIDE_FLAG, RIDE_KIND, type RiderOf, type RideOf } from '../../../src/net/nearRides.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { AirForces } from '../../../src/world/volumetrics/airForces.ts';
import { downwashBase, newShuttleJets, pushEngines } from '../../../src/world/volumetrics/airEngines.ts';
import { AirRaster, type GroundSample } from '../../../src/world/volumetrics/airRaster.ts';
import { newWindow, placeWindow } from '../../../src/world/volumetrics/fluidWindow.ts';
import { specFor } from '../../../src/vehicles/vehicle.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-4): boolean => Math.abs(a - b) < eps;

/** The floors a hull of ours of each flying kind flies from, out of the vehicle's own spec (`specFor`), as `RemotePlayers` reads them. */
const SHIP_FLOOR = specFor('ship', 'x', 'x', { min: [-4, 0, -6], max: [4, 4, 6] }).fly!.floor;
const FLYER_FLOOR = specFor('flyer', 'x', 'x', { min: [-1, 0, -2], max: [1, 1, 2] }).fly!.floor;

/**
 * The picture's own box as the garage frames a machine (`Garage.frameModel`): centred across and along, its underside at
 * its origin, the place a peer sends -- whatever the pack's own bounds are centred on.
 */
const framedBox = (b: { min: number[]; max: number[] }): { half: number[]; mid: number[] } => {
  const half = [0, 1, 2].map((k) => Math.abs(b.max[k] - b.min[k]) / 2);
  return { half, mid: [0, half[1], 0] };
};

/**
 * A peer's ride as `RemotePlayers` keeps it: a picture at `p` (its underside, as a framed machine stands) turned `yaw`
 * about straight up, its kind, its pack's bounds and the picture's own box (framed off those bounds unless given).
 */
function rider(o: { x?: number; y?: number; z?: number; yaw?: number; kind?: number; role?: string; landed?: boolean; reckoned?: boolean; vel?: [number, number, number]; sent?: [number, number, number]; dock?: unknown; shown?: boolean; picture?: boolean; bounds?: { min: number[]; max: number[] } | null; box?: { half: number[]; mid: number[] } | null; floor?: number; onFoot?: boolean }): RiderOf {
  const obj = new THREE.Object3D();
  obj.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw ?? 0);
  const kind = o.kind ?? RIDE_KIND.speeder;
  const bounds = o.bounds === null ? null : (o.bounds ?? { min: [-1, -0.6, -2.5], max: [1, 0.6, 2.5] });
  const vehicle: RideOf = {
    obj: o.picture === false ? null : obj,
    dock: o.dock ?? null,
    role: o.role ?? 'ride',
    landed: o.landed ?? false,
    reckoned: o.reckoned ?? false,
    sentVel: new THREE.Vector3(...(o.sent ?? [0, 0, 0])),
    vel: new THREE.Vector3(...(o.vel ?? [0, 0, 0])),
    airKind: kind,
    airFloor: o.floor ?? (kind === RIDE_KIND.ship ? SHIP_FLOOR : kind === RIDE_KIND.flyer ? FLYER_FLOOR : 0),
    size: bounds ? { bounds } : null,
    box: o.box !== undefined ? o.box : bounds ? framedBox(bounds) : null,
  };
  return { group: { visible: o.shown ?? true }, vehicle: o.onFoot ? null : vehicle };
}

// --- the kind of a garage def ---
ok(rideKindOf({ kind: 'speeder', source: 'creature' }) === RIDE_KIND.none, 'a creature ridden stirs nothing');
ok(rideKindOf({ kind: 'ship', source: 'ship' }) === RIDE_KIND.ship && rideKindOf({ kind: 'speeder', source: 'ship' }) === RIDE_KIND.ship, "a ship by its kind or its pack takes a ship's thrust");
ok(rideKindOf({ kind: 'podracer', source: 'gallery' }) === RIDE_KIND.pod && rideKindOf({ kind: 'flyer', source: 'gallery' }) === RIDE_KIND.flyer && rideKindOf({ kind: 'speeder', source: 'gallery' }) === RIDE_KIND.speeder && rideKindOf({ kind: 'walker', source: 'gallery' }) === RIDE_KIND.speeder, "a pod, a flyer, and anything else of the gallery a speeder's, as a hull of ours of the same kind takes (`kindExit`)");

// --- the walk ---
{
  const out = newNearRides(4);
  // Ride 1's picture box as measured off its drawn meshes: its middle off the place across, up and along, its underside a
  // little under it (a wing hung lower than the hull).
  const measured = { mid: [0.2, 1.1, -0.3], half: [3, 1.2, 6] };
  const peers = new Map<number, RiderOf>([
    [1, rider({ x: 10, y: 2, z: -5, yaw: Math.PI / 2, kind: RIDE_KIND.pod, reckoned: true, sent: [30, 0, 1], vel: [99, 99, 99], bounds: { min: [3, 1, 6], max: [-3, -1, -6] }, box: measured })],
    [2, rider({ x: 20, z: 0, onFoot: true })],
    [3, rider({ x: 20, z: 0, shown: false })],
    [4, rider({ x: 20, z: 0, picture: false })],
    [5, rider({ x: 20, z: 0, dock: { to: 7 } })],
    [6, rider({ x: 500, z: 0 })],
    [7, rider({ x: -30, z: 40, role: 'aboard', landed: true, vel: [1, 2, 3], bounds: null })],
    // A picture whose box is not measured yet: a framed machine read off the pack's lengths, its corners held swapped.
    [8, rider({ x: 25, z: 5, kind: RIDE_KIND.ship, bounds: { min: [3, 1, 6], max: [-3, -1, -6] }, box: null })],
  ]);
  out.atX = 0;
  out.atZ = 0;
  out.reach = 200;
  const n = nearRidesIn(peers, out);
  ok(n === 3 && out.n === 3, `three of eight are near rides shown here (${n}): none on foot, hidden, not in yet, clamped onto a ship or past the reach`);
  const p1 = peers.get(1)!.vehicle!.obj!;
  ok(out.x[0] === 10 && out.y[0] === 2 && out.z[0] === -5 && out.vx[0] === 30 && out.vy[0] === 0 && out.vz[0] === 1, 'a reckoned picture hands the velocity its game sent, never the glide');
  ok(out.qx[0] === p1.quaternion.x && out.qy[0] === p1.quaternion.y && out.qw[0] === p1.quaternion.w && out.kind[0] === RIDE_KIND.pod && out.flags[0] === RIDE_FLAG.driven && out.key[0] === p1.id && out.floor[0] === 0, 'its turn, its kind, driven (seated), no floor (a pod does not fly), and its picture as its key');
  const c = new THREE.Vector3(...measured.mid).applyQuaternion(p1.quaternion);
  ok(near(out.low[0], 1.1 - 1.2, 1e-12) && out.half[0] === 6 && near(out.cx[0], c.x, 1e-12) && near(out.cy[0], c.y, 1e-12) && near(out.cz[0], c.z, 1e-12), `its underside over the place (${out.low[0].toFixed(2)} m), half its length and its middle turned by its turn, off the picture's own box in the picture's own frame -- never the pack's bounds`);
  ok(out.vx[1] === 1 && out.vy[1] === 2 && out.vz[1] === 3 && out.flags[1] === RIDE_FLAG.landed && out.low[1] === 0 && out.half[1] === 1 && out.cy[1] === 0, 'a glided picture hands the glide; merely aboard is not driven; set down is landed; no box at all reads as a small one standing on the place');
  ok(out.low[2] === 0 && out.half[2] === 6 && out.cy[2] === 1 && out.cx[2] === 0 && out.cz[2] === 0 && out.floor[2] === SHIP_FLOOR, `a box not measured yet is a framed machine's off the pack's lengths (its underside the place, its middle half its height up, the corners taken either way round), and a ship's floor its spec's (${SHIP_FLOOR} m)`);
  const few = newNearRides(1);
  few.atX = 0;
  few.atZ = 0;
  few.reach = 1000;
  ok(nearRidesIn(peers, few) === 1, 'no more than the arrays hold');
  out.atX = 1000;
  ok(nearRidesIn(peers, out) === 0 && out.n === 0, 'and nothing far from where it is asked about');
}

// --- through the real engine walk ---
const flat = { sample: (_x: number, _z: number, out: GroundSample) => ((out.h = 0), (out.family = 1), (out.medium = 1), true) };
function forcesAt(): AirForces {
  const f = new AirForces();
  f.active = true;
  const w = newWindow();
  placeWindow(w, 0, 0, AIR_TUNE.window.size, 128, AIR_TUNE.window.jump);
  const r = new AirRaster();
  r.resize(128);
  r.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]);
  r.familyColour = new Uint8Array([0, 0, 0, 0, 200, 170, 120, 255]);
  r.fillAll(flat, w.ox, w.oz, w.cell);
  f.window = w;
  f.raster = r;
  return f;
}
const ridesOf = (...list: RiderOf[]) => {
  const out = newNearRides(8);
  out.atX = 0;
  out.atZ = 0;
  out.reach = 200;
  nearRidesIn(list, out);
  return out;
};
{
  // A speeder of theirs driven along +X at 20 m/s (its nose turned to +X), its underside -- the place it is drawn at, as
  // a framed machine stands -- on the ground, its box 1.2 m tall.
  const P = AIR_TUNE.peers;
  const f = forcesAt();
  pushEngines([], f, ridesOf(rider({ x: 5, y: 0, z: 3, yaw: Math.PI / 2, reckoned: true, sent: [20, 0, 0] })), null);
  const e = f.engines;
  const back = 2.5 * P.rear;
  ok(f.engineCount === 1 && f.counts.peers === 1, "a driven speeder of theirs is one engine of this frame's table, counted among the peers");
  ok(near(e[0], 5 - back) && near(e[1], 0.6) && near(e[2], 3) && near(e[3], -1) && near(e[4], 0) && near(e[5], 0), `at the rear of its box along its tail (${back} m back), half its box's height up, its exhaust leaving along its -Z`);
  ok(near(e[6], P.speeder * 1) && e[7] === 20 && e[8] === 0, `at a speeder's exit run all out (${P.speeder} m/s, from ${P.fullAt} m/s) and the speed its game sent`);
  const g = forcesAt();
  pushEngines([], g, ridesOf(rider({ x: 0, y: 0, z: 0, vel: [P.fullAt / 2, 0, 0], yaw: Math.PI / 2 })), null);
  ok(near(g.engines[6], P.speeder * (P.idle + (1 - P.idle) * 0.5)), 'at half that speed, reckoned to run half way between its crawl and all out');
  // A pod's and a flyer's own exits, all out.
  const pod = forcesAt();
  pushEngines([], pod, ridesOf(rider({ kind: RIDE_KIND.pod, vel: [P.fullAt, 0, 0], yaw: Math.PI / 2 })), null);
  const flyerAft = forcesAt();
  pushEngines([], flyerAft, ridesOf(rider({ kind: RIDE_KIND.flyer, vel: [P.fullAt, 0, 0], yaw: Math.PI / 2 })), null);
  ok(pod.engineCount === 1 && near(pod.engines[6], P.pod) && flyerAft.engineCount === 1 && near(flyerAft.engines[6], P.flyer) && P.pod !== P.flyer, `a pod of theirs at a pod's exit (${P.pod} m/s), a flyer on the ground at a flyer's (${P.flyer} m/s), aft and nothing down`);
  const none = (r: RiderOf): boolean => {
    const h = forcesAt();
    pushEngines([], h, ridesOf(r), null);
    return h.engineCount === 0 && h.counts.peers === 0;
  };
  ok(none(rider({ vel: [0.5, 0, 0] })), 'parked (slower than `runFrom`) it blows nothing aft');
  ok(none(rider({ vel: [20, 0, 0], landed: true })) && none(rider({ vel: [20, 0, 0], role: 'aboard' })), 'set down, or with nobody at its controls, nothing');
  ok(none(rider({ vel: [20, 0, 0], kind: RIDE_KIND.none })), 'a creature ridden, nothing');
  // A ship of theirs stopped in the air, its underside 8 m over the ground, its pack's box centred on its own origin (2 m
  // under and over it, as a hull's mesh is): it blows down from the picture's underside, 8 m, never from 2 m under it.
  const centred = { min: [-4, -2, -6], max: [4, 2, 6] };
  const ship = forcesAt();
  pushEngines([], ship, ridesOf(rider({ x: 3, y: 8, z: -2, kind: RIDE_KIND.ship, bounds: centred })), null);
  ok(ship.engineCount === 1 && near(ship.engines[0], 3) && near(ship.engines[1], 8) && near(ship.engines[2], -2) && near(ship.engines[4], -1) && near(ship.engines[6], AIR_TUNE.engine.downwashShip), "a ship of theirs holding itself up blows down from the middle of its underside, where the picture stands, at a hull of ours' downwash, and nothing aft while it stands");
  // One whose pack box reaches deep under its origin (4.7 m), hovering 4 m up: up, as a hull of ours there is.
  const deep = forcesAt();
  pushEngines([], deep, ridesOf(rider({ y: 4, kind: RIDE_KIND.ship, bounds: { min: [-5, -4.71, -5], max: [5, 4.71, 5] } })), null);
  ok(deep.engineCount === 1 && near(deep.engines[1], 4) && near(deep.engines[6], AIR_TUNE.engine.downwashShip), 'one whose pack box reaches 4.7 m under its origin, hovering 4 m up, blows down from 4 m: its own frame, never the pack\'s');
  ok(none(rider({ y: SHIP_FLOOR, kind: RIDE_KIND.ship, bounds: centred })), `resting on its springs at its kind's floor (${SHIP_FLOOR} m, as a hull of ours rests), nothing`);
  const higher = forcesAt();
  pushEngines([], higher, ridesOf(rider({ y: SHIP_FLOOR + P.hover + 0.05, kind: RIDE_KIND.ship, bounds: centred })), null);
  ok(higher.engineCount === 1 && near(higher.engines[4], -1), 'and a little over it, it holds itself up, as a hull of ours above its floor does');
  // A flyer of theirs hovering 3 m up blows down at a flyer's downwash; resting on its floor it blows nothing down.
  const flyer = forcesAt();
  pushEngines([], flyer, ridesOf(rider({ y: 3, kind: RIDE_KIND.flyer })), null);
  ok(flyer.engineCount === 1 && near(flyer.engines[1], 3) && near(flyer.engines[4], -1) && near(flyer.engines[6], AIR_TUNE.engine.downwashFlyer) && AIR_TUNE.engine.downwashFlyer !== AIR_TUNE.engine.downwashShip, `a flyer of theirs hovering 3 m up blows down at a flyer's downwash (${AIR_TUNE.engine.downwashFlyer} m/s), not a ship's`);
  ok(none(rider({ y: FLYER_FLOOR, kind: RIDE_KIND.flyer })), `resting on its floor (${FLYER_FLOOR} m), nothing`);
  const fast = forcesAt();
  pushEngines([], fast, ridesOf(rider({ y: 10, kind: RIDE_KIND.ship, vel: [AIR_TUNE.engine.downwashFade + 5, 0, 0], yaw: Math.PI / 2, bounds: centred })), null);
  let down = false;
  for (let i = 0; i < fast.engineCount; i++) if (fast.engines[i * 10 + 4] < -0.99) down = true;
  ok(fast.engineCount === 1 && !down, 'and in forward flight its downwash is gone, its engines aft');
  const off = forcesAt();
  off.fromEngines = false;
  pushEngines([], off, ridesOf(rider({ vel: [20, 0, 0] })), null);
  ok(off.engineCount === 0, 'with the engines off (`volFromEngines`), nothing of theirs either');
  const far = forcesAt();
  pushEngines([], far, ridesOf(rider({ x: 180, vel: [20, 0, 0] })), null);
  ok(far.engineCount === 0 && far.counts.offWindow === 1, "a ride past the window's reach is counted off it and stirs nothing");
}

// --- a stood shuttle's jets ---
{
  const f = forcesAt();
  const jets = newShuttleJets(4);
  jets.n = 2;
  jets.x[0] = 4;
  jets.y[0] = 6;
  jets.z[0] = -2;
  jets.key[0] = 640;
  jets.x[1] = -4;
  jets.y[1] = 6;
  jets.z[1] = -2;
  jets.key[1] = 641;
  pushEngines([], f, null, jets);
  const E = AIR_TUNE.engine;
  ok(f.engineCount === 2 && f.counts.shuttles === 2 && f.engines[0] === 4 && f.engines[1] === 6 && near(f.engines[4], -1) && near(f.engines[6], Math.min(E.exitShuttle, E.exitCap)) && f.engineKeys[0] === 640, "a shuttle's lit engines are engines straight down from their joints at its exit, each under its own key, counted among the shuttles");
  // The shuttle a passenger rides is a hull of this world on its travel rig: its rig's flames are its jets (above), and its
  // hull blows no downwash of its own on top of them, so the passenger's own pad is stirred once, as everybody else's is.
  const hullOf = (rig: unknown): Record<string, unknown> => {
    const group = new THREE.Group();
    group.position.set(0, 12, 0);
    group.updateMatrixWorld(true);
    return { engines: [], engineHeat: 0, group, spec: { kind: 'ship', ship: true, fly: { climb: 6, ceiling: 1500, floor: SHIP_FLOOR }, bounds: { min: [-4, 0, -6], max: [4, 4, 6] } }, airborne: true, powered: true, landed: false, speed: 0, pos: group.position, altitude: 12, rig };
  };
  const plainHull = forcesAt();
  pushEngines([hullOf(null)] as never, plainHull, null, null);
  const rigHull = forcesAt();
  pushEngines([hullOf({ hull: 'root' })] as never, rigHull, null, jets);
  ok(plainHull.engineCount === 1 && near(plainHull.engines[4], -1) && rigHull.engineCount === 2 && rigHull.counts.shuttles === 2 && rigHull.engines[4] === -1 && rigHull.engines[14] === -1 && downwashBase(hullOf({ hull: 'root' }) as never) === 0, "a ship hovering 12 m up blows down; the same on its travel rig blows only its rig's two jets");
}

// --- a rig's flames as jets, by their windows ---
{
  const SRC = join(REPO, 'src');
  register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [SRC], packageBase: join(REPO, 'package.json') } });
  const R = (await import(pathToFileURL(join(SRC, 'world', 'shuttleRigs.ts')).href)) as typeof import('../../../src/world/shuttleRigs.ts');
  const root = new THREE.Group();
  root.name = 'root';
  const joints: THREE.Object3D[] = [];
  for (let i = 1; i <= 4; i++) {
    const j = new THREE.Object3D();
    j.name = `hp_engine_${i}`;
    j.position.set(i % 2 ? 3 : -3, 4, i < 3 ? 2 : -2);
    root.add(j);
    joints.push(j);
  }
  const top = new THREE.Group();
  top.add(root);
  top.position.set(100, 0, 50);
  top.updateMatrixWorld(true);
  const rig = {
    file: 'rig',
    parts: [],
    moods: {},
    seconds: {},
    events: { start: { particles: [{ file: 'flame.json', seconds: 15 }] }, takeoff: { particles: [{ file: 'smoke.json', seconds: 5 }] }, land: { sounds: ['land.snd'] } },
    marks: {
      landing: [1, 2, 3, 4].map((i) => ({ t: 6.6, joint: `hp_engine_${i}`, event: 'start' })).concat([{ t: 13.3, joint: 'root', event: 'land' }]),
      leaving: [{ t: 0, joint: 'root', event: 'takeoff' }],
    },
  };
  const fx = new R.RigFx({}, rig as never, { land: 'landing', lift: 'leaving' }, top, false);
  const cam = new THREE.Vector3(100, 2, 80);
  const jetsAt = (role: 'land' | 'lift' | 'ground' | null, seconds: number): ReturnType<typeof newShuttleJets> => {
    fx.step(role, seconds, 1 / 60, cam);
    const out = newShuttleJets(8);
    fx.jetsInto(out);
    return out;
  };
  ok(jetsAt('land', 5).n === 0, "before its engines' mark, a landing shuttle blows nothing");
  const lit = jetsAt('land', 10);
  const w = new THREE.Vector3();
  joints[0].getWorldPosition(w);
  ok(lit.n === 4 && lit.x[0] === w.x && lit.y[0] === w.y && lit.z[0] === w.z && lit.key[0] === joints[0].id * 64, 'while its flames are lit, four jets, one at each engine joint in the world, keyed by its joint');
  ok(jetsAt('land', 21.7).n === 0, 'and none once their window has closed (6.6 s + 15)');
  ok(jetsAt('lift', 2).n === 1 && jetsAt('lift', 6).n === 0, "its take-off's smoke is a jet from its root for its five seconds");
  ok(jetsAt('ground', 3).n === 0 && jetsAt(null, 10).n === 0, 'standing on the ground, or shown nowhere, nothing');
}

// --- the walk allocates nothing ---
const self = fileURLToPath(import.meta.url);
if (process.argv.includes('--alloc')) {
  const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc!;
  const v8 = await import('node:v8');
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
  const peers = new Map<number, RiderOf>();
  for (let i = 0; i < 6; i++) peers.set(i, rider({ x: i * 10, y: 1, z: -i * 7, yaw: i, reckoned: i % 2 === 0, sent: [10 + i, 0, 1], vel: [3, 0, 2], kind: (i % 4) + 1 }));
  peers.set(9, rider({ onFoot: true }));
  const out = newNearRides(16);
  const f = forcesAt();
  const hulls: never[] = [];
  const frame = (i: number): void => {
    out.atX = (i & 7) * 0.5;
    out.atZ = 0;
    out.reach = 200;
    nearRidesIn(peers, out);
    pushEngines(hulls, f, out, null);
  };
  for (let i = 0; i < 40000; i++) frame(i);
  let best = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    gc({ type: 'minor' });
    const before = young();
    for (let i = 0; i < 20000; i++) frame(i);
    best = Math.min(best, young() - before);
  }
  console.log(`ALLOC ${(best / 20000).toFixed(4)} ${out.n}`);
} else {
  const line = execFileSync(process.execPath, ['--expose-gc', self, '--alloc'], { encoding: 'utf8' }).split(/\r?\n/).find((l) => l.startsWith('ALLOC '));
  const [, bytes, n] = (line ?? 'ALLOC NaN 0').split(' ');
  ok(Number(n) === 6 && Number(bytes) < 0.2, `six rides walked and pushed into the forces each frame make ${bytes} B a frame (the cleanest of three, in a process of its own)`);
}

if (!process.argv.includes('--alloc')) console.log(`\n${checks} checks passed`);
