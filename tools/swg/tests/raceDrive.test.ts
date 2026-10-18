// The race drive (src/vehicles/raceDrive.ts) driving the game's own Vehicle over real Rapier worlds.
//
// Everything a pod, or a bike in racing mode, does that the arithmetic alone cannot show: that a vehicle with a drive
// switched off steps exactly as one with none; that the ceiling holds downhill and with the knob at its most; that no
// body ever passes the physics engine's 399; that a wall glanced is a scrape and met at 45 degrees a crash, at 20 and
// 60 fps, and never wedges the hull or reaches the rider's jolt; that a step up is struck over, a cliff face crashed
// into, a hill climbed and a crevasse glided; that the hull wears to its floor and no further; that the one ray ahead
// takes a ramp and refuses a trunk or a deck; that a bike switches its modes cleanly; the routing by the kind a vehicle
// is spawned as; the hand-over and the pause; the living hold; the plan on the physics' own fixed steps; the two hulls;
// and a terrain face off a course both ways. Nothing is game data: boxes of the game's sizes, invented ground, round
// numbers. The ground the drive reads is the same function the world is built from.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FIXED_DT, Group, Physics, RAPIER, groups } from '../../../src/core/physics.ts';
import { BODY_SPEED_CAP, Vehicle, specFor, type DriveInput, type VehicleSpec } from '../../../src/vehicles/vehicle.ts';
import { RACE_CLOCK, RaceDrive, attachRace, holdsLiving, raceFling, type RaceGround } from '../../../src/vehicles/raceDrive.ts';
import { boostFor, boostOf, fallDisplacement, speedOf, thrustA, thrustCapOf, thrustFor } from '../../../src/vehicles/raceMath.ts';
import { RACE_BASE, RACE_TUNE, readRaceHatch, tuneRace } from '../../../src/vehicles/raceTune.ts';
import { raceBoxFor, raceRoute, raceSpecFor } from '../../../src/vehicles/vehicleKinds.ts';
import { ENGINE_TUNE, mendEngines, tuneEngines } from '../../../src/vehicles/drivetrain.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const r2 = (n: number) => Number(n.toFixed(2));
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ONLY = process.env.RACE_ONLY ? new Set(process.env.RACE_ONLY.split(',').map(Number)) : null;
async function section(n: number, name: string, fn: () => Promise<void> | void): Promise<void> {
  if (ONLY && !ONLY.has(n)) return;
  console.log(`--- ${n}: ${name}`);
  await fn();
}

const TUNE0 = JSON.parse(JSON.stringify(RACE_TUNE)) as typeof RACE_TUNE;
const restore = () => {
  Object.assign(RACE_TUNE, JSON.parse(JSON.stringify(TUNE0)));
  tuneRace({});
  RACE_CLOCK.live = true;
};

// --- the harness -----------------------------------------------------------------------------------------------------
type G = (x: number, z: number) => number;
const FLAT: G = () => 0;
/** What the drive reads of the ground: the function itself where "built", and at the far grid's lattice. */
function readerOf(g: G): RaceGround {
  return { near: (x, z) => g(x, z), far: (i, j) => g(i * 16, j * 16), farStep: 16, farX: () => 0, farZ: () => 0, water: () => -Infinity };
}
type Kind = 'pod' | 'bike';
const BOUNDS: Record<Kind, VehicleSpec['bounds']> = {
  pod: { min: [-3, 0, -6], max: [3, 2.5, 6] },
  bike: { min: [-0.45, 0, -2.05], max: [0.45, 1.16, 2.05] },
};
const BOXES: Record<Kind, [number, number, number]> = { pod: [7, 3, 15], bike: [1, 1.3, 3.6] };
/** Every speed the body was ever given, in every run: nothing may pass the engine's cap. */
let bodyMost = 0;

interface Run {
  physics: Physics;
  v: Vehicle;
  race: RaceDrive | null;
  g: G;
  input: DriveInput;
  hits: { kind: string; t: number; loss: number; drop: number; raced: boolean; justHit: number }[];
  t: number;
}

function heightfield(physics: Physics, g: G, x0: number, z0: number, size: number, sub: number): void {
  const step = size / sub;
  const heights = new Float32Array((sub + 1) * (sub + 1));
  for (let xi = 0; xi <= sub; xi++) for (let zi = 0; zi <= sub; zi++) heights[xi * (sub + 1) + zi] = g(x0 + xi * step, z0 + zi * step);
  physics.createHeightfield(x0, z0, size, sub, heights);
}

interface SetupOpts {
  kind: Kind;
  g?: G;
  field?: { x0: number; z0: number; size: number; sub: number } | null;
  x?: number;
  z?: number;
  y?: number;
  heading?: number;
  levels?: 'max' | 'stock';
  drive?: boolean;
  mesh?: boolean;
  box?: boolean;
  /** A bike's mode to start in: racing unless the test says traversal (a bike spawns in traversal in the game). */
  mode?: 'racing' | 'traversal';
  world?: (physics: Physics) => void;
  /** The model's bounds and its race box, where a test hands its own (a spawn's, as `raceSpecFor` gives them). */
  bounds?: VehicleSpec['bounds'];
  raceBox?: [number, number, number];
  /** No physics step after the hull is made, as at a spawn: its first update comes before any step. */
  noStep?: boolean;
  /** What the ground reader answers, where a test hands its own (one the cache cannot answer everywhere). */
  reader?: RaceGround;
}

async function setup(o: SetupOpts): Promise<Run> {
  const physics = await Physics.create();
  const g = o.g ?? FLAT;
  if (o.field) heightfield(physics, g, o.field.x0, o.field.z0, o.field.size, o.field.sub);
  o.world?.(physics);
  const bounds = o.bounds ?? BOUNDS[o.kind];
  const spec = specFor(o.kind === 'pod' ? 'podracer' : 'speederbike', o.kind, o.kind, bounds);
  if (o.box !== false) {
    spec.hull = 'box';
    spec.raceBox = o.raceBox ?? BOXES[o.kind];
  }
  const model = new THREE.Group();
  if (o.mesh) {
    const b = bounds;
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
    m.position.y = (b.max[1] - b.min[1]) / 2;
    model.add(m);
  }
  const x = o.x ?? 0;
  const z = o.z ?? 0;
  const v = new Vehicle(spec, model, physics, new THREE.Scene(), x, o.y ?? g(x, z) + spec.hover + 0.2, z, o.heading ?? 0);
  if (!o.noStep) physics.stepOnce();
  const race = o.drive === false ? null : attachRace(v, o.kind, { ground: o.reader ?? readerOf(g) });
  if (race) race.setLevels(o.levels ?? 'max', v);
  if (race?.modes && o.mode !== 'traversal') race.setMode(v, 'racing');
  const input: DriveInput = { throttle: 0, steer: 0, heading: null, boost: false, hop: false, up: false, down: false, vertical: 0 };
  return { physics, v, race, g, input, hits: [], t: 0 };
}

/** Frames of play at a frame rate, through the real accumulator: the hull's update, then the physics. `each` returning true stops. */
function drive(r: Run, fps: number, seconds: number, each?: (r: Run) => boolean | void): void {
  const dt = 1 / fps;
  const end = r.t + seconds;
  while (r.t < end - 1e-9 && !r.v.destroyed) {
    const lastAt = r.race?.lastHit.at ?? 0;
    r.v.update(dt, r.physics, r.input, r.g);
    r.physics.step(dt);
    r.t += dt;
    const lv = r.v.body.linvel();
    bodyMost = Math.max(bodyMost, Math.hypot(lv.x, lv.y, lv.z));
    if (r.v.justHit > 0 || (r.race && r.race.lastHit.at !== lastAt)) {
      r.hits.push({ kind: r.race?.lastHit.at !== lastAt ? (r.race?.lastHit.kind ?? '') : 'springs', t: r.t, loss: r.race?.lastHit.loss ?? 0, drop: r.race?.lastHit.drop ?? 0, raced: r.v.raceDriven, justHit: r.v.justHit });
    }
    if (each?.(r)) break;
  }
}

/** The drive given the hull at a speed along its heading, boosting as needed to hold it: adopted, then its parts set. */
function launch(r: Run, speed: number, fps: number): void {
  const race = r.race!;
  const h = r.v.heading;
  r.v.body.setLinvel({ x: Math.sin(h) * speed, y: 0, z: Math.cos(h) * speed }, true);
  r.input.throttle = 1;
  r.input.boost = false;
  drive(r, fps, 1 / fps);
  const hd = race.handling;
  const A = thrustA(hd.t75);
  const cap = thrustCapOf(A, RACE_TUNE.thrustCap);
  const plain = speedOf(cap, hd.V, A);
  race.T = speed <= plain ? thrustFor(speed, hd.V, A) : cap;
  race.over = 0;
  race.p = 0;
  if (speed > plain + 1e-6) {
    race.B = boostFor(Math.min(hd.BT * 0.999, speed - plain), hd.BT, RACE_TUNE.boostHalf);
    race.boosting = true;
    race.charge = 1;
    r.input.boost = true;
  } else {
    race.B = 0;
    race.boosting = false;
  }
  race.heat = 100;
  race.h = speed;
  r.v.body.setLinvel({ x: Math.sin(h) * speed, y: 0, z: Math.cos(h) * speed }, true);
  // The velocity was written past the drive's own command: the next step's hit test must not read the difference.
  (race as unknown as { cmdValid: boolean }).cmdValid = false;
  // And what the rest of the game reads of the hull, as the next step would write it.
  r.v.speed = speed;
  r.hits.length = 0;
}

const horiz = (v: Vehicle) => {
  const l = v.body.linvel();
  return Math.hypot(l.x, l.z);
};

/** A fixed wall: a cuboid `thick` across, `height` tall and `length` long, its middle on the ground at (x, base, z), along `angle` (rad) from +z. */
function wall(physics: Physics, x: number, base: number, z: number, angle: number, length = 1000, height = 40, thick = 2): void {
  physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(thick / 2, height / 2, length / 2)
      .setTranslation(x, base + height / 2, z)
      .setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) })
      .setCollisionGroups(groups(Group.exterior, Group.all)),
  );
}

// =============================================================================================================
await section(1, 'day one', async () => {
  // Two worlds the same: one hull with a drive attached and the pass switched off (or its drive the springs), one with
  // none. The same course and keys: every place and velocity equal by Object.is.
  const hills: G = (x, z) => 3 * Math.sin(x / 23) * Math.cos(z / 31) + 1.5 * Math.sin(x / 9 + z / 13);
  for (const kind of ['pod', 'bike'] as const) {
    for (const [what, set] of [
      ['the pass switched off', () => tuneRace({ on: false })],
      ["the drive 'springs'", () => tuneRace({ drive: 'springs' })],
    ] as const) {
      set();
      const field = { x0: -256, z0: -256, size: 512, sub: 256 };
      const a = await setup({ kind, g: hills, field, drive: true });
      const b = await setup({ kind, g: hills, field, drive: false });
      let same = true;
      let where = '';
      for (let i = 0; i < 600 && same; i++) {
        for (const run of [a, b]) {
          run.input.throttle = 1;
          run.input.heading = Math.sin(i / 90) * 1.2;
          run.input.boost = i > 300;
          run.v.update(1 / 60, run.physics, run.input, hills);
          run.physics.step(1 / 60);
        }
        const pa = a.v.body.translation();
        const pb = b.v.body.translation();
        const va = a.v.body.linvel();
        const vb = b.v.body.linvel();
        if (![pa.x, pa.y, pa.z, va.x, va.y, va.z].every((n, k) => Object.is(n, [pb.x, pb.y, pb.z, vb.x, vb.y, vb.z][k]))) {
          same = false;
          where = `step ${i}`;
        }
      }
      ok(same && !a.v.raceDriven && !a.race!.active, `1: a ${kind} with a drive attached and ${what} steps as one with none, 600 steps by Object.is${where ? ` (parted at ${where})` : ''}`);
      restore();
    }
  }
  // The race box itself: a bike in traversal (its own hull and its race box beside it, disabled) against one built with
  // no race box and no drive at all, from its very first update, which comes before any step as at a spawn. A box laid
  // on the body adds its mass however it is made, so the body is weighed again from what is enabled; weighed at the next
  // step instead, that first update read the body at twice its mass.
  for (const kind of ['bike', 'pod'] as const) {
    const field = { x0: -256, z0: -256, size: 512, sub: 256 };
    // The bike with its drive in traversal, as it spawns; the pod, which races at once, with the box and no drive.
    const a = await setup({ kind, g: hills, field, mesh: true, mode: 'traversal', noStep: true, drive: kind === 'bike' });
    const b = await setup({ kind, g: hills, field, mesh: true, box: false, drive: false, noStep: true });
    const ia = a.v.body.principalInertia();
    const ib = b.v.body.principalInertia();
    const weighed = Object.is(a.v.body.mass(), b.v.body.mass()) && Object.is(ia.x, ib.x) && Object.is(ia.y, ib.y) && Object.is(ia.z, ib.z);
    let same = true;
    let where = '';
    for (let i = 0; i < 600 && same; i++) {
      for (const run of [a, b]) {
        run.input.throttle = 1;
        run.input.heading = Math.sin(i / 90) * 1.2;
        run.v.update(1 / 60, run.physics, run.input, hills);
        run.physics.step(1 / 60);
      }
      const pa = a.v.body.translation();
      const pb = b.v.body.translation();
      const va = a.v.body.linvel();
      const vb = b.v.body.linvel();
      if (![pa.x, pa.y, pa.z, va.x, va.y, va.z].every((n, k) => Object.is(n, [pb.x, pb.y, pb.z, vb.x, vb.y, vb.z][k]))) {
        same = false;
        where = `step ${i}`;
      }
    }
    ok(weighed && same && !a.v.raceBoxCollider!.isEnabled(), `1: a ${kind}${kind === 'bike' ? ' in traversal' : ''} with its race box beside its hull weighs and steps as one built with none, from its first update before any step, 600 steps by Object.is (mass ${r2(a.v.body.mass())}${where ? `; parted at ${where}` : ''})`);
  }
  ok(readRaceHatch(() => '0') && RACE_TUNE.on === false, "1: readRaceHatch with '0' gives the switch off");
  restore();
});

await section(2, 'the ceiling', async () => {
  for (const [kind, ceiling] of [
    ['pod', 600 / 3.6],
    ['bike', 350 / 3.6],
  ] as const) {
    const r = await setup({ kind, z: -3000 });
    r.input.throttle = 1;
    drive(r, 60, 20);
    const plain = r.race!.h;
    let most = 0;
    let reachedAt = Infinity;
    const t0 = r.t;
    r.input.boost = true;
    drive(r, 60, 6, (run) => {
      most = Math.max(most, run.race!.h, horiz(run.v));
      if (reachedAt === Infinity && run.race!.h >= ceiling - 0.3) reachedAt = run.t - t0;
    });
    ok(reachedAt <= 4 && most <= ceiling + 1e-3, `2: a full ${kind}: ${r2(plain)} m/s plain after 20 s; with the boost ${r2(ceiling - 0.3)} reached in ${r2(reachedAt)} s and never past ${r2(ceiling)} (most ${r2(most)})`);
  }
  {
    const r = await setup({ kind: 'pod', z: -3000, levels: 'stock' });
    r.input.throttle = 1;
    let most = 0;
    drive(r, 60, 20);
    r.input.boost = true;
    drive(r, 60, 8, (run) => {
      most = Math.max(most, run.race!.h);
    });
    ok(most <= r.race!.boostTop() + 1e-3, `2: a stock pod never passes its own reachable top with the boost (${r2(most)} against ${r2(r.race!.boostTop())})`);
  }
  // Downhill on a 25-degree ramp, the ceiling holds; with the knob at its most, a boosting pod never passes 380 m/s and its body never 399.
  const ramp: G = (_x, z) => -Math.tan((25 * Math.PI) / 180) * z;
  for (const [knob, top] of [
    [600, 600 / 3.6],
    [1368, 380],
  ] as const) {
    tuneRace({ ceiling: knob });
    const r = await setup({ kind: 'pod', g: ramp, z: 0 });
    launch(r, r.race!.handling.cap * 0.95, 60);
    let most = 0;
    let body = 0;
    drive(r, 60, 6, (run) => {
      most = Math.max(most, run.race!.h, horiz(run.v));
      const l = run.v.body.linvel();
      body = Math.max(body, Math.hypot(l.x, l.y, l.z));
    });
    ok(most <= top + 1e-3 && body <= BODY_SPEED_CAP + 1e-3 && !r.v.destroyed, `2: down a 25-degree ramp with the ceiling at ${knob} km/h the horizontal speed never passes ${r2(top)} (most ${r2(most)}) and the body never ${BODY_SPEED_CAP} (most ${r2(body)})`);
    restore();
  }
});

await section(3, 'the body cap', async () => {
  const r = await setup({ kind: 'pod', y: 1000, z: -2000 });
  launch(r, 166, 60);
  drive(r, 60, 16);
  ok(!r.v.destroyed && r.v.pos.y < 20, `3: a fall from a kilometre at full speed lands (${r2(r.v.pos.y)} m) whole`);
  ok(bodyMost <= BODY_SPEED_CAP + 1e-3, `3: and no body in any test so far has passed ${BODY_SPEED_CAP} m/s (most ${r2(bodyMost)})`);
});

await section(4, 'walls', async () => {
  for (const fps of [20, 60]) {
    for (const [kind, speed] of [
      ['pod', 166],
      ['bike', 97],
    ] as const) {
      // Head on.
      {
        const r = await setup({ kind, z: 0, world: (ph) => wall(ph, 0, -5, 150, Math.PI / 2, 400, 60) });
        launch(r, speed, fps);
        drive(r, fps, 2);
        ok(r.v.destroyed && r.race!.lastHit.kind === 'crash', `4: a ${kind} at ${speed} m/s meets a wall head on at ${fps} fps: a crash`);
      }
      for (const deg of [3, 10, 30, 45]) {
        const a = (deg * Math.PI) / 180;
        // The wall's line through (0, 150) at `deg` to the travel, along (-sin a, cos a); its far side is where (cos a, sin a) points.
        const n0x = Math.cos(a);
        const n0z = Math.sin(a);
        const r = await setup({ kind, z: 0, world: (ph) => wall(ph, -0, -5, 150, -a, 2000, 60) });
        launch(r, speed, fps);
        let crossed = false;
        let first = Infinity;
        let backOver = false;
        let jolted = false;
        drive(r, fps, 3, (run) => {
          const p = run.v.body.translation();
          const side = (p.x - 0) * n0x + (p.z - 150) * n0z;
          if (side < 0 && first === Infinity && run.hits.length) first = run.t;
          // The wall's middle plane: the hull's middle never ends a step beyond it.
          if (Math.abs(p.z - 150) < 900 && side > 0 && run.hits.length) crossed = true;
          if (first !== Infinity && run.t - first <= 2 && run.race!.h >= speed / 2) backOver = true;
          if (run.v.justHit > 0 && !run.v.destroyed && !run.v.raceDriven) jolted = true;
          // A pilot turns along the wall once it is met.
          if (run.hits.length) run.input.heading = -a;
        });
        const kinds = r.hits.map((h) => h.kind);
        if (deg === 45) {
          ok(r.v.destroyed, `4: a ${kind} at ${speed} m/s at 45 degrees to a wall at ${fps} fps: a crash (${kinds.join(',') || 'nothing'})`);
          continue;
        }
        ok(!r.v.destroyed && kinds.includes('scrape'), `4: a ${kind} at ${speed} m/s at ${deg} degrees to a wall at ${fps} fps: a scrape (${kinds.join(',')}; loss ${r2(r.hits[0]?.loss ?? 0)}, drop ${r2(r.hits[0]?.drop ?? 0)})`);
        ok(!crossed, `4: and the hull never ends a step on the wall's far side`);
        ok(backOver, `4: and is never wedged (its speed back over half within 2 s)`);
        ok(!jolted, "4: and the rider's jolt is never reached (every hit lands while the drive has the hull)");
      }
    }
  }
  // A 30-degree glance on a 20-degree descent at the plain top, the speed past V: forward at what the glance left, and no hit read after.
  {
    const slope: G = (_x, z) => -Math.tan((20 * Math.PI) / 180) * z;
    const a = (30 * Math.PI) / 180;
    // Started on the slope at its ride and already going down it, and given about three seconds on it before the wall,
    // 450 m on, for the slope's push to carry it past V. (Started high over it at rest, as the first ride's test was, the
    // loose hold flies it off the slope's top at the world's gravity, as off any crest, and it never gets the push.)
    const r = await setup({ kind: 'pod', g: slope, z: -300, y: slope(0, -300) + RACE_BASE.podracer.ride + 0.1, world: (ph) => wall(ph, 0, slope(0, 150) - 200, 150, -a, 1000, 400) });
    launch(r, 150, 60);
    const down = -150 * Math.tan((20 * Math.PI) / 180);
    r.race!.vy = down;
    r.v.body.setLinvel({ x: 0, y: down, z: 150 }, true);
    (r.race as unknown as { cmdValid: boolean }).cmdValid = false;
    // As a hull taken over on its way down: the loose hold's look behind begins with the vertical speed it has.
    (r.race as unknown as { pastN: number }).pastN = 0;
    r.input.boost = false;
    r.race!.boosting = false;
    let entry = 0;
    let after = 0;
    let hitAt = -1;
    let laterHits = 0;
    let steps = 0;
    let seen = 0;
    drive(r, 60, 4, (run) => {
      steps++;
      const scraped = run.hits.length > seen && run.hits[run.hits.length - 1].kind === 'scrape';
      if (hitAt < 0 && scraped) {
        hitAt = steps;
        after = run.race!.h;
        run.input.heading = -a;
      } else if (hitAt < 0) entry = run.race!.h;
      else if (steps <= hitAt + Math.round(RACE_TUNE.scrapeHold * 60) && run.hits.length > seen) laterHits++;
      seen = run.hits.length;
    });
    const V = r.race!.handling.V;
    ok(hitAt > 0 && entry > V && after > 0.75 * entry && r.race!.h > 0 && !r.v.destroyed, `4: a 30-degree glance on a 20-degree descent at ${r2(entry)} m/s (past V ${r2(V)}) leaves the pod going forward at ${r2(after)} m/s`);
    ok(laterHits === 0, `4: and no hit is read on the steps after it (${r.hits.map((h) => `${h.kind}@${r2(h.t)} ${r2(h.loss)}/${r2(h.drop)}`).join(', ')})`);
  }
});

await section(5, 'strikes', async () => {
  const step: G = (_x, z) => (z > 400 ? 3 : 0);
  const r = await setup({ kind: 'pod', g: step, z: 0 });
  launch(r, 166, 60);
  const hp0 = r.v.hp;
  let lifted = Infinity;
  drive(r, 60, 3, (run) => {
    if (lifted === Infinity && run.v.pos.z > 410 && run.v.pos.y > 3) lifted = run.v.pos.z;
  });
  ok(!r.v.destroyed && hp0 - r.v.hp <= r.race!.handling.strikeMost + 1e-9, `5: a 3 m step at full speed costs at most strikeMost (${r2(hp0 - r.v.hp)} hp; ${r.hits.map((h) => h.kind).join(',') || 'not even a strike'}) and never destroys`);
  ok(lifted < 440, `5: and the hull is over it at once (${r2(lifted - 400)} m past its foot)`);
});

await section(6, 'climbing', async () => {
  const face = (deg: number, height: number): G => (_x, z) => (z > 600 ? Math.min(height, (z - 600) * Math.tan((deg * Math.PI) / 180)) : 0);
  // At full speed a face too steep and too tall to clear is a wall and a crash. The first ride's case, a 60-degree face
  // 20 m high, under the firm hold, which holds the tail its nose-up pitch drops 3 to 4 m onto the face; the loose hold
  // holds the hull's flat underside and leaves the pitch out (`planStart`), which clears that face over its top, so its
  // case is an 80-degree face as tall, which no rise the hull has can clear. And the face rule's own promise, under
  // either hold: a face is met or flown over, never passed through.
  for (const [hold, deg] of [
    ['firm', 60],
    ['loose', 80],
    ['loose', 60],
  ] as const) {
    tuneRace({ hold });
    const r = await setup({ kind: 'pod', g: face(deg, 20), z: 0, field: { x0: -512, z0: 0, size: 1024, sub: 512 } });
    launch(r, 166, 60);
    let through = 0;
    drive(r, 60, 4, (run) => {
      const p = run.v.body.translation();
      if (!run.v.destroyed) through = Math.max(through, face(deg, 20)(p.x, p.z) - run.race!.low);
    });
    if (hold === 'loose' && deg === 60) ok(r.v.destroyed || through <= 0.05, `6: a 60-degree face 20 m high at full speed under the loose hold is ${r.v.destroyed ? 'a crash' : `cleared over its top, the hull never under it (at most ${r2(Math.max(0, through))} m)`} (${r.hits.map((h) => h.kind).join(',') || 'nothing met'})`);
    else ok(r.v.destroyed, `6: a ${deg}-degree face 20 m high at full speed is a crash under the ${hold} hold (${r.hits.map((h) => h.kind).join(',')})`);
  }
  tuneRace({ hold: 'loose' });
  {
    // At 30 m/s the hull rises up to riseMax (75 m/s), faster than a 60-degree face climbs under it (30 tan 60 = 52
    // m/s), so the same face is ridden up; a face the hull cannot out-climb at that speed (80 degrees: 170 m/s) stops it.
    for (const deg of [60, 80]) {
      const r = await setup({ kind: 'pod', g: face(deg, 20), z: 400, field: { x0: -512, z0: 0, size: 1024, sub: 512 } });
      launch(r, 30, 60);
      let fastest = 0;
      let met = false;
      drive(r, 60, 10, (run) => {
        // Held about 30 m/s, as a pilot easing in would, and let go of once a face is met.
        met ||= run.hits.some((h) => h.kind === 'face');
        run.input.throttle = !met && run.race!.h < 30 ? 1 : 0;
        run.input.boost = false;
        fastest = Math.max(fastest, run.race!.h);
      });
      const at = r.v.pos.z;
      const kinds = r.hits.map((h) => h.kind).join(',');
      if (deg === 60) {
        ok(!r.v.destroyed && at > 620 && r.v.pos.y > 18, `6: the same face at ${r2(fastest)} m/s is ridden up (on top at ${r2(r.v.pos.y)} m; ${kinds || 'nothing struck'})`);
        continue;
      }
      ok(!r.v.destroyed && r.hits.some((h) => h.kind === 'face'), `6: an 80-degree face 20 m high at ${r2(fastest)} m/s is a scrape (${kinds})`);
      ok(at < 600 + 2 && r.race!.h < 5, `6: that stops the pod at it with no wedge (its middle ${r2(600 - at)} m short of the foot, ${r2(r.race!.h)} m/s)`);
    }
  }
  {
    const r = await setup({ kind: 'pod', g: face(30, 60), z: 0, field: { x0: -512, z0: 0, size: 1024, sub: 512 } });
    launch(r, 166, 60);
    let top = 0;
    drive(r, 60, 6, (run) => {
      top = Math.max(top, run.v.pos.y);
    });
    ok(!r.v.destroyed && top > 60, `6: a 30-degree hill 60 m high at full speed is climbed (over its top at ${r2(top)} m; ${r.hits.map((h) => h.kind).join(',') || 'nothing'})`);
  }
});

await section(7, 'a pit', async () => {
  // A crevasse 50 m across the way and 10 m deep, steep-walled, in a heightfield as the world's own ground is.
  const pit: G = (_x, z) => (z > 600 && z < 650 ? -10 : 0);
  const field = { x0: -512, z0: 0, size: 1024, sub: 1024 };
  for (const fps of [20, 60, 120, 144]) {
    const r = await setup({ kind: 'pod', g: pit, z: 200, field });
    launch(r, 166, fps);
    let lowest = Infinity;
    drive(r, fps, 4, (run) => {
      if (run.v.pos.z > 590 && run.v.pos.z < 670) lowest = Math.min(lowest, run.v.pos.y);
    });
    const strikes = r.hits.filter((h) => h.kind === 'strike' || h.kind === 'crash' || h.kind === 'face').length;
    ok(!r.v.destroyed && strikes === 0 && r.v.pos.z > 700, `7: a 50 x 10 m crevasse glided at full speed at ${fps} fps with no strike (lowest ${r2(lowest)} m over it; ${r.hits.map((h) => `${h.kind}@${r2(h.t)} ${r2(h.loss)}`).join(', ') || 'nothing met'})`);
  }
  // The reason the bridge is: a deeper crevasse, 80 m across and 25 m deep, glided with it and, with it off, dived into
  // and crashed against at every rate under the firm hold, which pulls a hull down into a pit as soon as its line drops.
  // (Over the 50 x 10 m one a pod with the bridge off now only dips under its ride and is thrown up past it by the far
  // rim, since a hull under its line no longer takes the line's fall ahead.) The loose hold with the bridge off carries
  // over it on its momentum, falling a metre or two under its ride on the way at the world's gravity, where the bridge
  // glides it level.
  const deep: G = (_x, z) => (z > 600 && z < 680 ? -25 : 0);
  const MET = (hits: Run['hits']) => hits.filter((h) => h.kind === 'strike' || h.kind === 'crash' || h.kind === 'face');
  for (const fps of [144, 60, 20]) {
    const on = await setup({ kind: 'pod', g: deep, z: 200, field });
    launch(on, 166, fps);
    let onLowest = Infinity;
    drive(on, fps, 4, (run) => {
      if (run.v.pos.z > 590 && run.v.pos.z < 700) onLowest = Math.min(onLowest, run.v.pos.y);
    });
    tuneRace({ bridge: 'off' });
    const loose = await setup({ kind: 'pod', g: deep, z: 200, field });
    launch(loose, 166, fps);
    let looseLowest = Infinity;
    drive(loose, fps, 4, (run) => {
      if (run.v.pos.z > 590 && run.v.pos.z < 700) looseLowest = Math.min(looseLowest, run.v.pos.y);
    });
    tuneRace({ hold: 'firm' });
    const r = await setup({ kind: 'pod', g: deep, z: 200, field });
    launch(r, 166, fps);
    let lowest = Infinity;
    drive(r, fps, 4, (run) => {
      if (run.v.pos.z > 590 && run.v.pos.z < 700) lowest = Math.min(lowest, run.race!.low);
    });
    restore();
    ok(!on.v.destroyed && MET(on.hits).length === 0 && r.v.destroyed && r.race!.lastHit.kind === 'crash' && lowest < 0, `7: an 80 x 25 m crevasse is glided at full speed at ${fps} fps, and with the bridge off dived into under the firm hold (its lowest point to ${r2(lowest)} m) and crashed against: the reason the bridge is (glided: ${MET(on.hits).map((h) => h.kind).join(',') || 'nothing met'}; dived: ${r.hits.map((h) => h.kind).join(',') || 'nothing met'})`);
    ok(!loose.v.destroyed && looseLowest < onLowest - 0.5 && looseLowest > -25, `7: and under the loose hold with the bridge off it is carried over on its momentum, the hull falling to ${r2(looseLowest)} m on the way where the bridge held it at ${r2(onLowest)} (its own height, the nose's tipping into the pit left out) (${MET(loose.hits).map((h) => h.kind).join(',') || 'nothing met'})`);
  }
});

await section(8, 'wear', async () => {
  const a = (30 * Math.PI) / 180;
  const r = await setup({
    kind: 'pod',
    z: 0,
    world: (ph) => {
      wall(ph, 0, -5, 150, -a, 400, 60);
      wall(ph, 4000, -5, 150, -a, 400, 60);
    },
  });
  const all: string[] = [];
  /** The hull put at a place facing +z, as a respawn would: the drive starts its marks afresh there. */
  const placeAt = (x: number, y: number, z: number) => {
    r.v.body.setTranslation({ x, y, z }, true);
    r.v.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    r.race!.heading = 0;
    r.race!.u.x = 0;
    r.race!.u.z = 1;
    r.input.heading = null;
  };
  // Two glances at 30 degrees at full speed, each its own run at its own wall.
  for (const x of [0, 4000]) {
    placeAt(x, 1.2, 0);
    launch(r, 166, 60);
    drive(r, 60, 1.6, (run) => {
      if (run.hits.length) run.input.heading = -a;
    });
    all.push(...r.hits.map((h) => h.kind));
  }
  // Two landings at the fall's most: lifted 300 m and let fall, twice. The height rule takes a landing as the rise it
  // asks the moment the hull is under its line, a jolt and not a strike unless the ground is met. (At the world's gravity,
  // the loose hold's, a hull reaches the fall's most 140 m down and lands some six seconds after it is let go.)
  let landings = 0;
  let fastestFall = 0;
  for (let i = 0; i < 2; i++) {
    placeAt(8000 + i * 4000, 300, 0);
    launch(r, 166, 60);
    let falling = false;
    drive(r, 60, 8, (run) => {
      fastestFall = Math.min(fastestFall, run.race!.vy);
      if (run.race!.vy < -0.9 * RACE_BASE.podracer.fallMax) falling = true;
      else if (falling && run.race!.vy >= 0) {
        landings++;
        falling = false;
      }
    });
    all.push(...r.hits.map((h) => h.kind));
  }
  const glances = all.filter((k) => k === 'scrape').length;
  const strikes = all.filter((k) => k === 'strike').length;
  ok(glances >= 2 && landings === 2 && fastestFall <= -0.99 * RACE_BASE.podracer.fallMax, `8: ${glances} glance scrapes and 2 landings at ${r2(-fastestFall)} m/s (${strikes} strikes)`);
  ok(!r.v.destroyed && r.v.hp >= RACE_TUNE.wearFloor, `8: leave the hull at ${r2(r.v.hp)} hp, at or above its floor of ${RACE_TUNE.wearFloor}, never destroyed`);
  {
    // The floor itself: a hull worn by glance after glance stops at it.
    const w = await setup({ kind: 'pod', z: 0, world: (ph) => wall(ph, 0, -5, 150, -a, 4000, 60) });
    launch(w, 166, 60);
    let least = Infinity;
    // Thirty glances where twelve once did: the engines take two-thirds of every scrape now, the hull the rest.
    for (let i = 0; i < 30 && !w.v.destroyed; i++) {
      // The engines mended between glances: a side burnt out by them pulls the pod into the very wall it glances,
      // which crashes it (the pull doing its job, `drivetrain.ts`), and what is measured here is the hull's floor.
      mendEngines(w.race!.engines);
      w.race!.heading = 0;
      w.race!.u.x = 0;
      w.race!.u.z = 1;
      const p = w.v.body.translation();
      w.v.body.setTranslation({ x: p.x, y: p.y, z: p.z - 200 * Math.cos(a) }, true);
      w.v.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      launch(w, 166, 60);
      drive(w, 60, 1.6, (run) => {
        least = Math.min(least, run.v.hp);
      });
    }
    ok(!w.v.destroyed && least >= RACE_TUNE.wearFloor && w.v.hp <= RACE_TUNE.wearFloor + 15, `8: and glance after glance wears it down to its floor and no further (${r2(w.v.hp)} hp, least ${r2(least)})`);
  }
  const c = await setup({ kind: 'pod', z: 0, world: (ph) => wall(ph, 0, -5, 120, Math.PI / 2, 400, 60) });
  launch(c, 166, 60);
  let racedAtCrash = false;
  let speedAtCrash = 0;
  drive(c, 60, 2, (run) => {
    if (run.v.destroyed) {
      racedAtCrash = run.v.raceDriven;
      speedAtCrash = run.v.body.linvel().z;
    }
  });
  const main = src('../../../src/main.ts');
  ok(c.v.destroyed && racedAtCrash, `8: a crash destroys it, with the drive still holding the hull (moving ${r2(speedAtCrash)} m/s as it is wrecked)`);
  const lv = c.v.body.linvel();
  const thrown = raceFling(c.v, new THREE.Vector3(lv.x, lv.y, lv.z)).length();
  ok(thrown <= RACE_TUNE.flingMost + 1e-9, `8: and its rider is thrown at ${r2(thrown)} m/s, no more than flingMost (${RACE_TUNE.flingMost})`);
  ok(/raceFling\(v, tmp2\.set\(lv\.x, lv\.y, lv\.z\)\);\s*\n\s*player\.fling\(tmp, tmp2\);/.test(main), '8: (main.ts: the game throws its rider through raceFling, the cap standing before the fling)');
  // Wrecked from outside between its steps (a flow's tick, a bolt, a blast: the world takes its hull after the vehicles
  // have stepped), at 150 m/s: on its next update the hull stays the drive's until the game takes it away, so its rider
  // is thrown no harder than flingMost. Handed back to the springs on that update instead, it threw them at its speed.
  {
    const r = await setup({ kind: 'pod', z: -2000 });
    launch(r, 150, 60);
    drive(r, 60, 0.3);
    r.v.hp = 0;
    r.v.update(1 / 60, r.physics, r.input, r.g);
    const l = r.v.body.linvel();
    const vel = new THREE.Vector3(l.x, l.y, l.z);
    const raw = vel.length();
    const out = raceFling(r.v, vel).length();
    ok(r.v.raceDriven && raw > 100 && out <= RACE_TUNE.flingMost + 1e-9, `8: a pod wrecked from outside at speed is still the drive's on its next update, and its rider is thrown at ${r2(out)} m/s of its ${r2(raw)}`);
    // The control: a hull nobody's drive held is thrown with its own speed, so the cap is the drive's holding and nothing else.
    const n = await setup({ kind: 'pod', z: -2000, drive: false });
    n.v.body.setLinvel({ x: 0, y: 0, z: 60 }, true);
    n.v.hp = 0;
    ok(raceFling(n.v, new THREE.Vector3(0, 0, 60)).length() === 60, '8: (and a hull no drive held keeps its own speed in the throw)');
  }
});

await section(9, 'the far ray', async () => {
  // Bodiless cylinders 20 m tall beside and across the course, a deck 12 m over the ground across it, and a 2 m ramp.
  const r = await setup({
    kind: 'pod',
    z: 0,
    world: (ph) => {
      // Beside the course all the way; across it from 420 m on, past where the run stops.
      for (let i = 0; i < 20; i++) {
        for (const x of [-12, 0, 12]) {
          if (x === 0 && i < 6) continue;
          ph.world.createCollider(RAPIER.ColliderDesc.cylinder(10, 0.25).setTranslation(x, 10, 300 + i * 20).setCollisionGroups(groups(Group.exterior, Group.all)));
        }
      }
      ph.world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 6).setTranslation(0, 12, 260).setCollisionGroups(groups(Group.exterior, Group.all)));
    },
  });
  launch(r, 125, 60);
  let worst = 0;
  let farRayTaken = false;
  drive(r, 60, 2.8, (run) => {
    worst = Math.max(worst, run.race!.line);
    if (run.race!.rayTaken) farRayTaken = true;
  });
  ok(worst <= RACE_TUNE.rayAccept + 1e-9 && !r.v.destroyed, `9: the line never rises for the trunks or the deck by more than rayAccept (most ${r2(worst)} m over the ground)`);
  note(`9: the far ray was ${farRayTaken ? '' : 'never '}taken among them`);
  const ramp = await setup({
    kind: 'pod',
    z: 0,
    world: (ph) => ph.world.createCollider(RAPIER.ColliderDesc.cuboid(20, 1, 30).setTranslation(0, 1, 200).setCollisionGroups(groups(Group.exterior, Group.all))),
  });
  launch(ramp, 125, 60);
  let took = false;
  let lifted = 0;
  // (Twice the first ride's 0.8 s, at half its speed: the ramp is as far off in metres.)
  drive(ramp, 60, 1.6, (run) => {
    if (run.race!.rayTaken) took = true;
    if (run.v.pos.z < 165) lifted = Math.max(lifted, run.race!.line);
  });
  ok(took && lifted > 0.5, `9: a ramp 2 m high ahead is taken by the far ray and lifts the line before the hull is on it (${r2(lifted)} m)`);
});

await section(10, 'modes', async () => {
  const r = await setup({ kind: 'bike', z: -1000, mode: 'traversal' });
  const race = r.race!;
  const kept = JSON.parse(JSON.stringify(r.v.spec)) as VehicleSpec;
  const keptRef = { ...r.v.spec };
  ok(race.mode === 'traversal' && !race.active, '10: a bike spawns in traversal');
  ok(race.setMode(r.v, 'racing') === '' && race.mode === 'racing', '10: up at any speed');
  r.input.throttle = 1;
  drive(r, 60, 3);
  const fast = race.h;
  const said = race.setMode(r.v, 'traversal');
  ok(said === 'slow down to leave racing mode' && race.mode === 'racing' && race.active, `10: down at ${r2(fast)} m/s is refused in words ("${said}") and changes nothing`);
  r.input.throttle = -1;
  drive(r, 60, 20, (run) => run.race!.h < 15);
  r.input.throttle = 0;
  const hitsBefore = r.hits.length;
  ok(race.setMode(r.v, 'traversal') === '' && race.mode === 'traversal' && !race.active, `10: under the traversal top (${r2(race.h)} m/s) it goes down`);
  const sameSpec = (Object.keys(keptRef) as (keyof VehicleSpec)[]).every((k) => Object.is(r.v.spec[k], keptRef[k]));
  ok(sameSpec && r.v.spec.maxSpeed === kept.maxSpeed && r.v.spec.boostSpeed === kept.boostSpeed, '10: and the spec is the kept spec, field for field by Object.is');
  drive(r, 60, 0.5);
  ok(r.hits.length === hitsBefore, '10: the next steps register no hit');
  // Up and down at speed, over and over: never a hit.
  r.input.throttle = 1;
  let flips = 0;
  drive(r, 60, 6, (run) => {
    if (Math.round(run.t * 60) % 30 === 0) {
      const want = run.race!.mode === 'racing' ? 'traversal' : 'racing';
      if (run.race!.setMode(run.v, want) === '') flips++;
      run.input.throttle = run.race!.mode === 'racing' ? -1 : 1;
    }
  });
  ok(flips >= 4 && r.hits.length === hitsBefore, `10: up and down at speed (${flips} switches) never registers a hit`);
});

await section(11, 'the routing', async () => {
  const podDef = { id: 'test_pod', kind: 'podracer' as const, source: 'gallery', clipSpeeds: { run: 10 } };
  const bikeDef = { id: 'test_bike', kind: 'speederbike' as const, source: 'gallery' };
  const hoverDef = { id: 'test_hover', kind: 'flyer' as const, source: 'gallery' };
  const pod = RACE_BASE.podracer.box;
  const bike = RACE_BASE.speederbike.box;
  const big = { min: [-5, 0, -5.5], max: [5, 3.5, 5.5] };
  const oneSeat = { min: [-0.45, 0, -2], max: [0.45, 1.2, 2] };
  const skiff = { min: [-2, 0, -4.5], max: [2, 3, 4.5] };
  {
    const route = raceRoute(podDef, 'speederbike');
    const box = raceBoxFor(route, big, pod, bike);
    ok(route.drive === 'bike' && route.modes && route.seat === 'pod' && route.clips === 'pod', '11: a pod-shaped def spawned as a bike: the bike drive and its modes, the pod seat and clips');
    ok(!!box && box.every((n, i) => n <= pod[i] + 1e-9) && box[0] < 10, `11: its race box is its own cut to the pod box (${box?.join(' x ')})`);
    // Built as the garage builds it: the spec's hull and box and the drive all from the spawn's one answer (`raceSpecFor`).
    const spawn = raceSpecFor(podDef, 'speederbike', big);
    const r = await setup({ kind: spawn.drive!, bounds: big as VehicleSpec['bounds'], raceBox: spawn.raceBox, mode: 'traversal' });
    ok(spawn.drive === 'bike' && r.race!.modes && r.race!.mode === 'traversal' && !r.race!.active && !r.v.raceBoxCollider!.isEnabled(), "11: and that pod-shaped def spawned as a bike starts in traversal on today's hull");
    r.race!.setMode(r.v, 'racing');
    drive(r, 60, 1 / 60);
    const boxNow = r.v.raceBoxCollider!;
    const half = boxNow.halfExtents();
    ok(r.race!.active && boxNow.isEnabled() && [half.x * 2, half.y * 2, half.z * 2].every((n, i) => Math.abs(n - spawn.raceBox![i]) < 1e-6), `11: and racing collides as its own box cut to the pod's (${[half.x * 2, half.y * 2, half.z * 2].map((n) => r2(n)).join(' x ')})`);
  }
  {
    const route = raceRoute(bikeDef, 'podracer');
    const box = raceBoxFor(route, oneSeat, pod, bike);
    ok(route.drive === 'pod' && !route.modes && box!.every((n, i) => n === pod[i]), '11: a bike-shaped def spawned as a pod races as a pod on the shared pod box');
    const r = await setup({ kind: 'pod' });
    ok(r.race!.setMode(r.v, 'traversal') === 'a pod has no modes' && r.race!.mode === 'racing', '11: and refuses U');
  }
  {
    const own = raceRoute(hoverDef, 'flyer');
    ok(own.drive === null && raceBoxFor(own, skiff, pod, bike) === null, '11: a hover car at its own kind has no drive and no race box');
    const asBike = raceRoute(hoverDef, 'speederbike');
    ok(asBike.drive === 'bike' && asBike.modes, '11: and spawned as a bike has both modes');
  }
  {
    const route = raceRoute(bikeDef, 'speederbike');
    ok(raceBoxFor(route, oneSeat, pod, bike)!.every((n, i) => n === bike[i]), '11: a one-seat bike races on the shared bike box');
    const sk = raceBoxFor(route, skiff, pod, bike)!;
    ok(sk[0] === 4 && sk[1] === 3 && sk[2] === 9, `11: a 9 m skiff on its own (${sk.join(' x ')})`);
  }
});

await section(12, 'the hand-over', async () => {
  const r = await setup({ kind: 'pod', z: -2000 });
  launch(r, 150, 60);
  drive(r, 60, 0.2);
  const hp = r.v.hp;
  const speeds: number[] = [];
  tuneRace({ on: false });
  drive(r, 60, 8, (run) => {
    speeds.push(horiz(run.v));
  });
  // Down at the springs' own ease while it is over their tops, the throttle still held; under them, theirs to drive.
  let rising = 0;
  let downAt = -1;
  const top = r.v.spec.boostSpeed;
  for (let i = 1; i < speeds.length; i++) {
    if (speeds[i - 1] > top && speeds[i] > speeds[i - 1] + 1e-6) rising++;
    if (downAt < 0 && speeds[i] <= top) downAt = i;
  }
  ok(!r.race!.active && r.v.hp === hp && r.hits.length === 0, `12: the pass switched off at 150 m/s hands the hull back with its hull unchanged (${r2(hp)} hp) and no hit read`);
  ok(rising === 0 && downAt > 0 && Math.max(...speeds.slice(downAt)) <= top + 1, `12: and brings it down at the springs' own ease, never rising (${r2(speeds[0])} m/s to their top of ${top} in ${r2(downAt / 60)} s)`);
  ok(!r.v.raceBoxCollider!.isEnabled(), "12: on today's hull");
  restore();
});

await section(13, 'the pause', async () => {
  const r = await setup({ kind: 'pod', z: -2000 });
  launch(r, 150, 60);
  drive(r, 60, 0.2);
  const p0 = r.v.body.translation();
  const speed0 = r.race!.h;
  RACE_CLOCK.live = false;
  let moved = 0;
  drive(r, 60, 5, (run) => {
    const p = run.v.body.translation();
    moved = Math.max(moved, Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z));
  });
  RACE_CLOCK.live = true;
  const hitsBefore = r.hits.length;
  drive(r, 60, 2 / 60);
  ok(moved < 0.001, `13: for 5 s with play stood still the hull holds its place to a millimetre (${(moved * 1000).toFixed(3)} mm)`);
  ok(Math.abs(horiz(r.v) - speed0) < 2 && r.hits.length === hitsBefore, `13: its speed is back on the first live step (${r2(horiz(r.v))} against ${r2(speed0)} m/s) and no hit is registered`);
  // Nobody driving it at all (a rider who got off): it brakes.
  const n2 = await setup({ kind: 'pod', z: -2000 });
  launch(n2, n2.race!.plainTop(), 60);
  const start = n2.v.pos.z;
  let under = Infinity;
  const dt = 1 / 60;
  for (let t = 0; t < 6; t += dt) {
    n2.v.update(dt, n2.physics, null, FLAT);
    n2.physics.step(dt);
    if (under === Infinity && n2.race!.h < 1.5) under = t;
  }
  const went = n2.v.pos.z - start;
  ok(under <= 5 && went <= 500, `13: a pod at its plain top with nobody driving it is under walking pace in ${r2(under)} s and ${r2(went)} m`);
});

await section(14, 'the living hold', async () => {
  const world = src('../../../src/world/world.ts');
  const hooks = world.match(/this\.streamHold \|\| this\.livingHold \|\| this\.sceneOnly \|\| !this\.simulating/g) ?? [];
  ok(hooks.length === 3, `14: world.ts's three held hooks read livingHold beside streamHold (${hooks.length})`);
  const r = await setup({ kind: 'pod', z: -2000 });
  ok(!holdsLiving(r.v), '14: a hull the drive does not hold holds nothing');
  launch(r, 30, 60);
  ok(!holdsLiving(r.v), `14: racing at 30 m/s (under livingAbove ${RACE_TUNE.livingAbove}) holds nothing`);
  launch(r, 120, 60);
  ok(holdsLiving(r.v), '14: racing at 120 m/s holds the living');
  RACE_TUNE.holdLiving = 'never';
  ok(!holdsLiving(r.v), "14: holdLiving 'never' holds nothing");
  RACE_TUNE.holdLiving = 'always';
  launch(r, 30, 60);
  ok(holdsLiving(r.v), "14: holdLiving 'always' holds at any speed");
  ok(!holdsLiving(null), '14: and nothing ridden holds nothing');
  restore();
});

await section(15, "the physics' clock", async () => {
  const physics = await Physics.create();
  let s = 7;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let agree = 0;
  for (let i = 0; i < 10_000; i++) {
    const dt = 1 / 240 + rand() * (1 / 15 - 1 / 240);
    const ahead = physics.stepsAhead(dt);
    const before = physics.steps;
    physics.step(dt);
    if (physics.steps - before === ahead) agree++;
  }
  ok(agree === 10_000, `15: stepsAhead(dt) equals the steps step(dt) then takes over 10,000 random frame times (${agree})`);
  for (const fps of [144, 120, 60, 20]) {
    const r = await setup({ kind: 'pod', y: 50, z: -2000 });
    // Still, so the fall starts from rest (the spawn's own step under gravity would hand the drive a third of a m/s down).
    r.v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const y0 = r.v.body.translation().y;
    const steps0 = r.physics.steps;
    let worst = 0;
    drive(r, fps, 1.5, (run) => {
      const k = run.physics.steps - steps0;
      const want = y0 + fallDisplacement(0, k * FIXED_DT, run.race!.fallNow(), run.race!.handling.fallMax);
      if (want > 15) worst = Math.max(worst, Math.abs(run.v.body.translation().y - want));
    });
    ok(worst < 0.001, `15: a race-driven hull falling from 50 m at ${fps} fps ends on the parabola of the steps taken (worst ${(worst * 1000).toFixed(3)} mm)`);
  }
  for (const fps of [144, 120, 75, 60, 40, 20]) {
    for (const extra of [false, true]) {
      const r = await setup({ kind: 'pod', z: -1500 });
      launch(r, 166, fps);
      const race = r.race!;
      let covered = 0;
      let frames = 0;
      const z0 = r.v.body.translation().z;
      const mark0 = race.sweptTo;
      let threw = false;
      let tiled = true;
      drive(r, fps, 2, (run) => {
        frames++;
        if (extra && !threw && frames === Math.round(fps)) {
          run.physics.stepOnce();
          threw = true;
        }
        void covered;
        // The mark after a plan is where its travel ends.
        if (race.planned > 0 && Math.abs(race.sweptTo - (race.odo + race.planTravel)) > 1e-6) tiled = false;
      });
      // Everything the body went over was swept once: the mark has moved by the body's whole travel (its last plan's
      // travel is swept already and the body has gone over it already, as the physics stepped after it).
      covered = race.sweptTo - mark0;
      const travel = r.v.body.translation().z - z0;
      ok(tiled && Math.abs(covered - travel) < 0.01, `15: at 166 m/s for 2 s at ${fps} fps${extra ? ', with one stepOnce thrown in,' : ''} the strike sweep covered ${r2(covered)} m of the body's ${r2(travel)} m, no gap and no repeat`);
    }
  }
});

await section(16, 'the two hulls', async () => {
  const r = await setup({ kind: 'bike', z: -1000, mesh: true, mode: 'traversal' });
  const v = r.v;
  const box = v.raceBoxCollider!;
  const own: RAPIER.Collider[] = [];
  for (let i = 0; i < v.body.numColliders(); i++) if (v.body.collider(i).handle !== box.handle) own.push(v.body.collider(i));
  const mass = v.body.mass();
  const inertia = v.body.principalInertia();
  const frictions = own.map((c) => [c.friction(), c.frictionCombineRule()]);
  for (let i = 0; i < 10; i++) {
    v.setRaceHull(true);
    v.setRaceHull(false);
  }
  r.physics.stepOnce();
  const i2 = v.body.principalInertia();
  ok(Math.abs(v.body.mass() - mass) < 1e-9 && Math.abs(i2.x - inertia.x) < 1e-6 && Math.abs(i2.y - inertia.y) < 1e-6 && Math.abs(i2.z - inertia.z) < 1e-6, `16: the bike's mass (${r2(mass)}) and inertia the same before and after ten swaps`);
  const p = v.body.translation();
  const which = () => {
    const ray = new RAPIER.Ray({ x: p.x + 5, y: p.y + 0.6, z: p.z }, { x: -1, y: 0, z: 0 });
    const hit = r.physics.world.castRay(ray, 10, true);
    const shape = new RAPIER.Capsule(0.5, 0.35);
    const touched = r.physics.world.intersectionWithShape({ x: p.x + 0.6, y: p.y + 0.8, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, shape);
    return { ray: hit?.collider.handle ?? -1, capsule: touched?.handle ?? -1 };
  };
  const ownHandles = new Set(own.map((c) => c.handle));
  const t = which();
  ok(ownHandles.has(t.ray) && ownHandles.has(t.capsule), "16: in traversal a ray and a figure's capsule meet today's triangles and never the race box");
  v.setRaceHull(true);
  r.physics.stepOnce();
  const t2 = which();
  ok(t2.ray === box.handle && t2.capsule === box.handle, '16: racing, the box and never the triangles');
  ok(box.friction() === RACE_TUNE.wallFriction && box.frictionCombineRule() === RAPIER.CoefficientCombineRule.Min, "16: a racing bike's friction against a wall is nought under Min");
  v.setRaceHull(false);
  ok(own.every((c, i) => c.friction() === frictions[i][0] && c.frictionCombineRule() === frictions[i][1]), `16: and today's hull keeps its own (${frictions[0][0]} under ${frictions[0][1] === RAPIER.CoefficientCombineRule.Average ? 'Average' : frictions[0][1]}), neither ever rewritten`);
  // A swap at full speed reads no hit; the pass switched off live brings back today's hull.
  r.race!.setMode(v, 'racing');
  launch(r, 97, 60);
  drive(r, 60, 0.5);
  ok(r.hits.length === 0 && box.isEnabled(), '16: racing at 97 m/s on the box with no hit read');
  tuneRace({ on: false });
  drive(r, 60, 0.2);
  ok(!box.isEnabled() && own.every((c) => c.isEnabled()) && r.hits.length === 0, "16: the pass switched off live brings back today's hull, with no hit read");
  restore();
});

await section(17, 'off a course', async () => {
  // A face 20 m high at full speed, too steep and too tall for either hold to clear (section 6): 60 degrees under the
  // firm hold, 80 under the loose, which clears a 60-degree one over its top.
  const faceOf = (deg: number): G => (_x, z) => (z > 600 ? Math.min(20, (z - 600) * Math.tan((deg * Math.PI) / 180)) : 0);
  const field = { x0: -512, z0: 0, size: 1024, sub: 512 };
  for (const hold of ['loose', 'firm'] as const) {
    const deg = hold === 'firm' ? 60 : 80;
    const face = faceOf(deg);
    for (const rule of ['crash', 'stop'] as const) {
      tuneRace({ offCourse: rule, hold });
      const r = await setup({ kind: 'pod', g: face, z: 0, field });
      launch(r, 166, 60);
      // The speed and place the step that met the face left, and the pilot letting go once it has. (The climbing judge
      // may cut the speed a little first, a few metres out: at half the first ride's speed a plan judges half as much
      // of the face, so the first cut can come before the cut that is the face; the step read is the face's.)
      let after = -1;
      let at = 0;
      drive(r, 60, 4, (run) => {
        if (after < 0 && run.hits.some((h) => h.kind !== 'climb')) {
          after = run.race!.h;
          at = run.v.pos.z;
          run.input.throttle = 0;
          run.input.boost = false;
        }
      });
      // Where it is stopped: against the face rather than over it, its middle no more than 2 m past the foot of a
      // 60-degree face (the first ride's bound), or of an 80-degree one no further in than the face is long. (At half
      // the first ride's speed the climbing judge's first cut, a scrape under 'stop', comes a few metres out and slows
      // the pod first, and the firm hold met the 60-degree face itself 2.6 m past its foot: the bound is held at the
      // face's top edge less half the pod's 12 m, its nose short of the top.)
      const most = 600 + 20 / Math.tan((deg * Math.PI) / 180) - (deg === 60 ? 6 : 0);
      if (rule === 'crash') ok(r.v.destroyed, `17: a ${deg}-degree face 20 m high met at full speed off a course is a crash with offCourse 'crash', ${hold} (${r.hits.map((h) => h.kind).join(',')})`);
      else ok(!r.v.destroyed && r.v.hp >= RACE_TUNE.wearFloor && after >= 0 && after < 5 && at < most, `17: and with 'stop' stops the pod at it, ${hold} (${r2(after)} m/s, its middle ${r2(at - 600)} m past the foot, at most ${r2(most - 600)}, hull ${r2(r.v.hp)}, ${r.hits.map((h) => h.kind).join(',')}), nothing destroyed and nobody thrown`);
    }
  }
  tuneRace({ hold: 'loose' });
  for (const rule of ['crash', 'stop'] as const) {
    tuneRace({ offCourse: rule });
    const r = await setup({ kind: 'pod', z: 0, world: (ph) => ph.world.createCollider(RAPIER.ColliderDesc.cuboid(10, 10, 10).setTranslation(0, 10, 300).setCollisionGroups(groups(Group.exterior, Group.all))) });
    launch(r, 166, 60);
    drive(r, 60, 2);
    ok(r.v.destroyed, `17: a box stood on the way is a crash with offCourse '${rule}'`);
  }
  restore();
});

await section(19, "the speed's parts, through the drive", async () => {
  // W held on flat ground until the thrust has had time to reach its cap (a second of thrust a second: 13 s on a full
  // curve, 39 on a stock one): the speed settles at the reachable plain top (thrustCap of V) and never creeps on toward V.
  for (const kind of ['pod', 'bike'] as const) {
    for (const levels of ['max', 'stock'] as const) {
      const r = await setup({ kind, levels, z: -3000 });
      r.input.throttle = 1;
      const h = r.race!.handling;
      const cap = thrustCapOf(thrustA(h.t75), RACE_TUNE.thrustCap);
      drive(r, 60, cap + 5);
      ok(Math.abs(r.race!.h - r.race!.plainTop()) < 1e-6 && r.race!.T <= cap + 1e-12 && r.race!.plainTop() < h.V - 1, `19: a ${levels === 'max' ? 'full' : 'stock'} ${kind} with W held ${r2(cap + 5)} s settles at its plain top ${r2(r.race!.h)} m/s (thrustCap of V ${r2(h.V)}), its thrust at the cap`);
    }
  }
  // The boost let go of after 3 s: under a tenth of what it gave within half a second, at every frame rate.
  for (const fps of [144, 60, 20]) {
    const r = await setup({ kind: 'pod', z: -3000 });
    r.input.throttle = 1;
    drive(r, fps, 6);
    r.input.boost = true;
    let engagedAt = -1;
    drive(r, fps, 6, (run) => {
      if (engagedAt < 0 && run.race!.boosting) engagedAt = run.t;
      return engagedAt >= 0 && run.t - engagedAt >= 3 - 1e-9;
    });
    const h = r.race!.handling;
    const on = boostOf(r.race!.B, h.BT, RACE_TUNE.boostHalf);
    r.input.boost = false;
    drive(r, fps, 0.5);
    const left = boostOf(r.race!.B, h.BT, RACE_TUNE.boostHalf);
    ok(engagedAt >= 0 && on > 0.5 * h.BT && left < 0.1 * on && !r.race!.boosting, `19: at ${fps} fps the boost after 3 s gives ${r2(on)} m/s and half a second after letting go ${r2(left)} (under a tenth)`);
  }
  // What the curve cannot hold eases down at the brake: a full pod at its plain top made stock at once (its top falls
  // under its speed) carries the difference as `over`, which halves in brake ln 2.
  for (const fps of [144, 60, 20]) {
    const dt = 1 / fps;
    const r = await setup({ kind: 'pod', z: -3000 });
    r.input.throttle = 1;
    drive(r, fps, 20);
    r.race!.setLevels('stock', r.v);
    const over0 = r.race!.over;
    const brake = r.race!.handling.brake;
    let t = 0;
    let half = Infinity;
    let prev = over0;
    drive(r, fps, 3, (run) => {
      t += dt;
      const o = run.race!.over;
      if (half === Infinity && o <= over0 / 2) half = t - (dt * (over0 / 2 - o)) / (prev - o);
      prev = o;
      return half !== Infinity;
    });
    ok(over0 > 30 && Math.abs(half - brake * Math.LN2) <= 0.02 * brake, `19: at ${fps} fps the ${r2(over0)} m/s the stock curve cannot hold halves in ${r2(half)} s (brake ln 2 ${r2(brake * Math.LN2)})`);
  }
});

await section(20, 'the handling, through the drive', async () => {
  /** The angle between the travel and the nose (degrees). */
  const drift = (race: RaceDrive) => (Math.acos(Math.max(-1, Math.min(1, race.u.x * Math.sin(race.heading) + race.u.z * Math.cos(race.heading)))) * 180) / Math.PI;
  /** The body's roll as it is written (degrees, YXZ). */
  const roll = (v: Vehicle) => {
    const q = v.body.rotation();
    return (new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), 'YXZ').z * 180) / Math.PI;
  };
  // A full pod at 125 m/s turned hard for a second: its travel lags its nose, and Space's slide lags it four times as long.
  const turned = async (slide: boolean) => {
    const r = await setup({ kind: 'pod', z: -3000 });
    launch(r, 125, 60);
    r.input.steer = 1;
    r.input.slide = slide;
    let most = 0;
    let rolled = 0;
    drive(r, 60, 1, (run) => {
      most = Math.max(most, drift(run.race!));
      rolled = Math.max(rolled, Math.abs(roll(run.v)));
    });
    return { most, rolled, bank: Math.abs(r.race!.bank) };
  };
  const plain = await turned(false);
  const slid = await turned(true);
  ok(plain.most > 3, `20: a full pod turned hard at 125 m/s drifts wide, its travel up to ${r2(plain.most)} degrees off its nose`);
  ok(slid.most > 1.8 * plain.most, `20: and sliding on Space, up to ${r2(slid.most)} degrees`);
  ok(plain.bank > 20 && plain.rolled > 20, `20: and it banks into the turn (${r2(plain.bank)} degrees), the body written rolled ${r2(plain.rolled)}`);
  // Leaned on V at speed and going straight: the body rolls well over onto its side.
  {
    const r = await setup({ kind: 'pod', z: -3000 });
    launch(r, 100, 60);
    r.input.lean = 1;
    drive(r, 60, 1);
    ok(Math.abs(r.race!.lean) > 0.9 && Math.abs(roll(r.v)) > 40, `20: leaned at speed the pod rolls ${r2(roll(r.v))} degrees onto its side`);
  }
  // The heat: held boosting past its seconds the engines overheat, the boost is refused until they are back to readyAt,
  // and then charges again. The overheat also sets a part burning (W2), which refuses the boost on its own until the fire
  // is out: that part is mended the moment it catches, so what is measured here is the heat's lock alone.
  {
    const r = await setup({ kind: 'pod', z: -3000 });
    r.input.throttle = 1;
    drive(r, 60, 6);
    r.input.boost = true;
    let lockedAt = -1;
    let boostedLocked = false;
    let freeAt = -1;
    let note = '';
    let burning = -1;
    drive(r, 60, 20, (run) => {
      const race = run.race!;
      note ||= race.takeNote();
      if (lockedAt < 0 && race.locked) {
        lockedAt = run.t;
        burning = race.engines.parts.filter((p) => p.fire > 0).length;
        mendEngines(race.engines);
      }
      if (race.locked && (race.boosting || race.charge > 0)) boostedLocked = true;
      if (lockedAt >= 0 && freeAt < 0 && !race.locked) freeAt = run.t;
      return freeAt >= 0 && run.t - freeAt > 1.5;
    });
    const h = r.race!.handling;
    const cool = (RACE_TUNE.readyAt / 100) * h.coolSeconds;
    ok(lockedAt > 0 && note === 'engines overheated', `20: held boosting the engines overheat after ${r2(lockedAt - 6)} s and say so ("${note}")`);
    ok(burning === 1, `20: and the overheat sets exactly one part burning (${burning})`);
    ok(!boostedLocked && freeAt > 0 && Math.abs(freeAt - lockedAt - cool) < 0.1 && (r.race!.boosting || r.race!.charge > 0), `20: the boost is refused for ${r2(freeAt - lockedAt)} s (back to readyAt, ${r2(cool)} s) and then charges again`);
  }
});

await section(21, "a rope's pull, told", async () => {
  // A racing pod at 125 m/s pulled sideways at 20 m/s by a rope between two steps: the pull told to its hit test
  // (`Vehicle.pulled`), so nothing is read and the hull loses nothing.
  const r = await setup({ kind: 'pod', z: -3000 });
  launch(r, 125, 60);
  drive(r, 60, 0.2);
  const hp = r.v.hp;
  const at = r.race!.lastHit.at;
  const m = r.v.body.mass();
  const p = r.v.body.translation();
  r.v.pulled({ x: m * 20, y: 0, z: 0 }, { x: p.x, y: p.y, z: p.z });
  drive(r, 60, 0.2);
  ok(r.race!.lastHit.at === at && r.v.hp === hp && !r.v.destroyed, `21: a racing pod pulled sideways at 20 m/s by a rope reads no hit (hull ${r2(r.v.hp)})`);
  // The control: the same change of speed put on the body untold is read as a scrape, so the test can see one.
  const c = await setup({ kind: 'pod', z: -3000 });
  launch(c, 125, 60);
  drive(c, 60, 0.2);
  const l = c.v.body.linvel();
  c.v.body.setLinvel({ x: l.x + 20, y: l.y, z: l.z }, true);
  drive(c, 60, 0.2);
  ok(c.race!.lastHit.kind === 'scrape', `21: (and the same change put on the body untold reads as a ${c.race!.lastHit.kind || 'nothing'})`);
});

await section(22, 'the bridge over invented pits', async () => {
  const D2R = Math.PI / 180;
  const Z0 = 600;
  /** A pit across the way from Z0, `w` m wide at its rims, `d` deep, its walls `deg` steep (a trough where they meet first). */
  const pitOf = (w: number, d: number, deg: number): G => {
    const k = deg >= 90 ? Infinity : Math.tan(deg * D2R);
    return (_x, z) => (z <= Z0 || z >= Z0 + w ? 0 : -Math.min(d, k * Math.min(z - Z0, Z0 + w - z)));
  };
  const field = { x0: -512, z0: 0, size: 1024, sub: 512 };
  const MET = new Set(['strike', 'face', 'crash', 'climb']);
  interface Flight {
    met: string[];
    destroyed: boolean;
    low: number;
    lift: number;
    track: number[];
  }
  /** One flight over a pit, the drive's whole vertical model on the real accumulator. */
  const fly = async (kind: Kind, levels: 'max' | 'stock', speed: number, g: G, w: number, fps: number, reader?: RaceGround, track = false): Promise<Flight> => {
    const r = await setup({ kind, levels, g, z: 200, field, reader });
    launch(r, speed, fps);
    const ride = r.race!.handling.ride;
    let low = Infinity;
    let lift = 0;
    const out: number[] = [];
    drive(r, fps, (Z0 + w + 120 - 200) / speed, (run) => {
      const z = run.v.pos.z;
      // The hull's own height over the rims (its box's underside, where it rides level): the pose's lowest point dips
      // as the nose tips toward the pit (the attitude reads the ground as it is, §5.8) and the hull rises to keep it at
      // its ride, which is not a dive; a dive takes the hull itself down.
      if (z > Z0 && z < Z0 + w) low = Math.min(low, run.v.pos.y - ride);
      lift = Math.max(lift, run.race!.bridgeLift);
      if (track) {
        const p = run.v.body.translation();
        const lv = run.v.body.linvel();
        out.push(p.x, p.y, p.z, lv.x, lv.y, lv.z);
      }
    });
    return { met: r.hits.filter((h) => MET.has(h.kind)).map((h) => h.kind), destroyed: r.v.destroyed, low, lift, track: out };
  };
  // Every pit narrower than the span glided, at the speed each kind and level races at: no strike, no wall, and the
  // hull never more than half a metre under its ride over the rims.
  // The bridge spans half a second of travel at the halved speeds, the metres a quarter of a second spanned at the first ride's.
  const full = 600 / 3.6;
  const cases: [string, Kind, 'max' | 'stock', number, number[]][] = [
    ['a full pod', 'pod', 'max', full, [10, 35, 50, 80]],
    ['a stock pod', 'pod', 'stock', 99, [10, 20, 35, 45]],
    ['a full bike', 'bike', 'max', 350 / 3.6, [10, 20, 35, 44]],
    ['a stock bike', 'bike', 'stock', 57.5, [10, 20]],
  ];
  for (const [name, kind, levels, speed, widths] of cases) {
    const span = RACE_TUNE.bridgeTime * speed;
    for (const fps of [144, 60, 20]) {
      let worst = Infinity;
      const bad: string[] = [];
      for (const w of widths) {
        for (const d of [3, 10, 25]) {
          for (const deg of [70, 30]) {
            const f = await fly(kind, levels, speed, pitOf(w, d, deg), w, fps);
            worst = Math.min(worst, f.low);
            if (f.met.length || f.destroyed || f.low < -0.5) bad.push(`${w}x${d}@${deg}: ${f.met.join(',') || 'none met'}${f.destroyed ? ', destroyed' : ''}, low ${r2(f.low)}`);
          }
        }
      }
      ok(!bad.length, `22: ${name} at ${r2(speed)} m/s (span ${r2(span)} m) glides every pit ${widths.join(', ')} m wide, 3, 10 and 25 m deep, walls of 70 and 30 degrees, at ${fps} fps: nothing met, the hull at worst ${r2(worst)} m off its ride${bad.length ? ` -- ${bad.join('; ')}` : ''}`);
    }
  }
  // The regression rows the first design crashed on: steep-walled crevasses at a full pod's top.
  for (const fps of [144, 60, 20]) {
    const bad: string[] = [];
    for (const [w, d] of [
      [35, 25],
      [50, 10],
      [50, 25],
      [80, 10],
    ]) {
      const f = await fly('pod', 'max', full, pitOf(w, d, 90), w, fps);
      if (f.met.length || f.destroyed || f.low < -0.5) bad.push(`${w}x${d}: ${f.met.join(',') || 'none met'}${f.destroyed ? ', destroyed' : ''}, low ${r2(f.low)}`);
    }
    ok(!bad.length, `22: and the 35 x 25, 50 x 10, 50 x 25 and 80 x 10 m crevasses at ${fps} fps${bad.length ? ` -- ${bad.join('; ')}` : ''}`);
  }
  // A cliff-walled crevasse wider than the span is a crash at every rate, as a cliff is: 120 x 25 m at a full pod's top
  // under the firm hold, which drags it down into it. The loose hold carries over it on its momentum (the owner's): one
  // 100 m across, past the span, it falls 2 m over and rises over the far rim in time; one 160 m across it has fallen 7
  // m over and meets the wall. (120 m is on the edge for it, cleared at some frame rates and met at others.)
  for (const fps of [144, 60, 20]) {
    tuneRace({ hold: 'firm' });
    const f = await fly('pod', 'max', full, pitOf(120, 25, 90), 120, fps);
    tuneRace({ hold: 'loose' });
    const carried = await fly('pod', 'max', full, pitOf(100, 25, 90), 100, fps);
    const wide = await fly('pod', 'max', full, pitOf(160, 25, 90), 160, fps);
    ok(f.destroyed && f.met.includes('crash'), `22: a 120 x 25 m crevasse at a full pod's top is a crash at ${fps} fps under the firm hold (${f.met.join(',')})`);
    ok(!carried.destroyed && !carried.met.length && wide.destroyed && wide.met.includes('crash'), `22: and under the loose hold one 100 x 25 m is carried over (${carried.met.join(',') || 'nothing met'}, the hull at worst ${r2(carried.low)} m off its ride over it), where one 160 x 25 m is a crash (${wide.met.join(',')})`);
  }
  // A pit wider than the span (120 m at its rims, 10 m deep on 30-degree walls, at a stock pod's 99 m/s, span 49.5 m)
  // is followed as it is with the bridge off.
  for (const fps of [144, 60, 20]) {
    const g = pitOf(120, 10, 30);
    const on = await fly('pod', 'stock', 99, g, 120, fps, undefined, true);
    tuneRace({ bridge: 'off' });
    const off = await fly('pod', 'stock', 99, g, 120, fps, undefined, true);
    restore();
    let parted = -1;
    for (let i = 0; i < Math.min(on.track.length, off.track.length) && parted < 0; i++) if (!Object.is(on.track[i], off.track[i])) parted = Math.floor(i / 6);
    ok(on.track.length === off.track.length && parted < 0 && on.lift === 0, `22: a pit wider than the span is followed exactly as with the bridge off at ${fps} fps (${on.track.length / 6} frames by Object.is${parted >= 0 ? `; parted at frame ${parted}` : ''}, lift ${r2(on.lift)})`);
  }
  // Nothing bridged where the far side cannot be seen: the cache answers nothing past the pit's middle.
  {
    const g = pitOf(50, 10, 70);
    const blind: RaceGround = { near: (x, z) => (z > Z0 + 25 ? null : g(x, z)), far: (i, j) => (j * 16 > Z0 + 25 ? null : g(i * 16, j * 16)), farStep: 16, farX: () => 0, farZ: () => 0, water: () => -Infinity };
    const f = await fly('pod', 'max', full, g, 50, 60, blind);
    ok(f.lift === 0, `22: with the far side unseen nothing is bridged (most lift ${r2(f.lift)} m; the hull ${f.low < -0.5 ? `dives to ${r2(f.low)} m off its ride` : 'holds'})`);
  }
});

await section(23, 'a racing hull, a hook and the grapple', async () => {
  // The grapple takes the whole of a catch on a race-driven hull, as on a flown ship: its drive's command wins over any
  // share a pull would put on it. Its turn is the drive's yaw rate about the world's up, led in frame time.
  const { VehicleSource } = await import('../../../src/player/grappleFrames.ts');
  const r = await setup({ kind: 'pod', z: -3000 });
  launch(r, 100, 60);
  r.input.steer = 1;
  drive(r, 60, 0.5);
  const vs = new VehicleSource();
  vs.use(r.v);
  const vo = { x: 0, y: 0, z: 0 };
  const wo = { x: 0, y: 0, z: 0 };
  vs.motion(vo, wo);
  ok(!vs.takesPull() && vs.turnInFrameTime(), '23: a race-driven pod takes no pull and turns in frame time');
  ok(wo.x === 0 && wo.z === 0 && Math.abs(wo.y - (r.race!.w * Math.PI) / 180) < 1e-12 && Math.abs(wo.y) > 0.5, `23: its turn is the drive's yaw rate (${r2(wo.y)} rad/s), not the body's nought`);
  const b = await setup({ kind: 'bike', z: -3000, mode: 'traversal' });
  const sb = new VehicleSource();
  sb.use(b.v);
  ok(sb.takesPull() && !sb.turnInFrameTime(), '23: a bike in traversal (on its springs) takes a pull as every hull does');
  // The hull test steps over a disabled collider (the race box while it stands aside, the hull's own while it races).
  const frames = src('../../../src/player/grappleFrames.ts');
  ok(/if \(!hc\.isValid\(\) \|\| !hc\.isEnabled\(\)\) continue;/.test(frames), '23: (grappleFrames.ts: the hull test pushes out of no disabled collider)');
});

await section(24, 'the engines, through the drive', async () => {
  // A side put out at 150 m/s: the top falls to the limp's share and the speed is shared out under it, so it eases down
  // at the brake, never in a step, and no step reads a hit.
  for (const fps of [144, 60, 20]) {
    const r = await setup({ kind: 'pod', z: -3000 });
    launch(r, 150, fps);
    r.input.boost = false;
    r.race!.boosting = false;
    drive(r, fps, 0.2);
    const plain = r.race!.plainTop();
    for (const i of [3, 4, 5]) {
      r.race!.engines.parts[i].d = 1;
      r.race!.engines.parts[i].out = true;
    }
    const hp = r.v.hp;
    let worst = 0;
    let last = r.race!.h;
    const brake = r.race!.handling.brake;
    drive(r, fps, 6, (run) => {
      worst = Math.max(worst, (last - run.race!.h) / ((Math.max(last, 1) / brake) * (1 / fps)));
      last = run.race!.h;
    });
    const limp = ENGINE_TUNE.limp * plain;
    ok(r.hits.length === 0 && r.v.hp === hp, `24: at ${fps} fps a side put out at 150 m/s reads no hit on any step (hull ${r2(r.v.hp)})`);
    ok(worst <= 1.05 && r.race!.h <= limp + 1 && r.race!.engines.limp, `24: and the pod eases down to its limp top ${r2(limp)} (now ${r2(r.race!.h)} m/s), never faster than the brake (worst ${r2(worst)} of it a step)`);
  }
  // Held boosting until the engines overheat: exactly one part burning the step they do.
  {
    const r = await setup({ kind: 'pod', z: -3000 });
    r.race!.rng = (() => {
      let s = 1;
      return () => ((s = (s * 16807) % 2147483647) / 2147483647);
    })();
    r.input.throttle = 1;
    drive(r, 60, 6);
    r.input.boost = true;
    let burningAt = -1;
    drive(r, 60, 12, (run) => {
      if (run.race!.locked && burningAt < 0) burningAt = run.race!.engines.parts.filter((p) => p.fire > 0).length;
      return burningAt >= 0;
    });
    ok(burningAt === 1, `24: held boosting, the engines overheat with exactly one part burning (${burningAt})`);
  }
  // A 10-degree graze at full speed on a wall on the left damages the left engine and only it.
  {
    const a = (10 * Math.PI) / 180;
    const r = await setup({ kind: 'pod', z: 0, world: (ph) => wall(ph, 0, -5, 150, -a, 2000, 60) });
    launch(r, 166, 60);
    drive(r, 60, 1.5, (run) => {
      if (run.hits.length) run.input.heading = -a;
      return run.hits.some((h) => h.kind === 'scrape');
    });
    const left = r.race!.engines.parts.slice(0, 3).reduce((s, p) => s + p.d, 0);
    const right = r.race!.engines.parts.slice(3).reduce((s, p) => s + p.d, 0);
    ok(r.hits.some((h) => h.kind === 'scrape') && left > 0 && right === 0, `24: a 10-degree graze at full speed on a wall to the left damages the left engine (${r2(left)}) and not the right (${r2(right)})`);
  }
  // The hull takes a third of what a scrape cost it before the engines had parts: the same first graze, run once as the
  // drive is and once with the hull's share put back to the whole, costs the hull a third as much.
  {
    const a = (10 * Math.PI) / 180;
    const graze = async (): Promise<{ lost: number; kind: string }> => {
      const r = await setup({ kind: 'pod', z: 0, world: (ph) => wall(ph, 0, -5, 150, -a, 2000, 60) });
      launch(r, 166, 60);
      const hp = r.v.hp;
      drive(r, 60, 1.5, (run) => run.hits.length > 0);
      return { lost: hp - r.v.hp, kind: r.hits[0]?.kind ?? '' };
    };
    const now = await graze();
    const share = ENGINE_TUNE.hullShare;
    tuneEngines({ hullShare: 1 });
    const whole = await graze();
    tuneEngines({ hullShare: share });
    ok(now.kind === 'scrape' && whole.kind === 'scrape' && now.lost > 0 && Math.abs(now.lost / whole.lost - share) < 1e-9, `24: a scrape costs the hull ${r2(now.lost)} hp, a third of the ${r2(whole.lost)} it cost before the engines took the rest (${(now.lost / whole.lost).toFixed(4)})`);
  }
  // A step met hard: past the strike's hurt it costs the hull and exactly one part of the engines, never more than
  // strikeMost of it; a strike under the hurt costs neither. The look-ahead is kept from seeing the step (its reader
  // answers flat ground), or the hull rises over it in time and nothing is struck at all. (A 5 m step beside the first
  // ride's three: a strike's closing is the ground's kick, which is the speed times the step's grade, less the hull's
  // own rise into it, which is not, so at half the first ride's speed a 3 m step closes at 9 m/s, under the hurt, under
  // either hold.)
  {
    let hurt = 0;
    const said: string[] = [];
    for (const height of [1, 2, 3, 5]) {
      const step: G = (_x, z) => (z > 400 ? height : 0);
      const r = await setup({ kind: 'pod', g: step, z: 0, reader: readerOf(FLAT) });
      launch(r, 166, 60);
      const hp = r.v.hp;
      drive(r, 60, 3);
      const parts = r.race!.engines.parts.filter((p) => p.d > 0);
      const lost = hp - r.v.hp;
      const kinds = r.hits.map((h) => h.kind);
      said.push(`${height} m: ${kinds.join(',') || 'nothing'}, hull ${r2(lost)}, ${parts.length} parts`);
      if (r.v.destroyed || kinds.some((k) => k !== 'strike')) continue;
      if (lost > 0) {
        hurt++;
        ok(parts.length === 1 && parts[0].d <= ENGINE_TUNE.strikeMost + 1e-12, `24: a step of ${height} m struck at full speed costs the hull ${r2(lost)} and exactly one part ${r2(parts[0]?.d ?? 0)} (at most strikeMost ${ENGINE_TUNE.strikeMost})`);
      } else ok(parts.length === 0, `24: a step of ${height} m ${kinds.length ? 'struck under the hurt' : 'ridden over with nothing struck'} costs no part`);
    }
    ok(hurt > 0, `24: (and at least one of the steps was struck hard enough to hurt: ${said.join('; ')})`);
  }
  // Scrapes on a hull already at its floor: the parts take them and the hull stays there.
  {
    const a = (20 * Math.PI) / 180;
    const r = await setup({ kind: 'pod', z: 0, world: (ph) => wall(ph, 0, -5, 150, -a, 2000, 60) });
    r.v.hp = RACE_TUNE.wearFloor;
    launch(r, 125, 60);
    drive(r, 60, 1.5, (run) => {
      if (run.hits.length) run.input.heading = -a;
    });
    const damaged = r.race!.engines.parts.some((p) => p.d > 0);
    ok(r.hits.some((h) => h.kind === 'scrape') && damaged && r.v.hp === RACE_TUNE.wearFloor && !r.v.destroyed, `24: scrapes past the hull's floor damage the engines and leave the hull at ${r2(r.v.hp)}`);
  }
  // A pod-shaped def raced as a bike has the bike's one engine of three parts.
  {
    const podDef = { id: 'test_pod', kind: 'podracer' as const, source: 'gallery', clipSpeeds: { run: 10 } };
    const big = { min: [-5, 0, -5.5], max: [5, 3.5, 5.5] };
    const spawn = raceSpecFor(podDef, 'speederbike', big);
    const r = await setup({ kind: spawn.drive!, bounds: big as VehicleSpec['bounds'], raceBox: spawn.raceBox });
    ok(r.race!.engines.sides === 1 && r.race!.engines.parts.length === 3, '24: a pod-shaped def raced as a bike has one engine of three parts');
    const p = await setup({ kind: 'pod' });
    ok(p.race!.engines.sides === 2 && p.race!.engines.parts.length === 6, '24: and raced as a pod, two of three');
  }
});

// --- nothing made a step ---------------------------------------------------------------------------------------------
await section(18, 'nothing made a step', async () => {
  // The cleanest of three processes: when the compiler builds what happens to be compiled first decides a little of what
  // it builds into what, and a process caught the other way round measures a few numbers made a step that the next does not.
  type Alone = { skipped?: string; frames: number; made: number; scavenges: number; view: { frames: number; made: number; scavenges: number }; planned: number };
  let alone: Alone | null = null;
  for (let run = 0; run < 3; run++) {
    const line = execFileSync(process.execPath, ['--expose-gc', '--allow-natives-syntax', fileURLToPath(new URL('./raceAllocOwn.ts', import.meta.url))], { encoding: 'utf8', timeout: 600_000 }).trim().split('\n').pop() ?? '{}';
    const got = JSON.parse(line) as Alone;
    const score = (a: Alone) => a.scavenges * 1e12 + a.made + a.view.scavenges * 1e12 + a.view.made;
    if (got.skipped || !alone || score(got) < score(alone)) alone = got;
    if (alone.skipped || (alone.scavenges === 0 && alone.made < alone.frames && alone.view.scavenges === 0 && alone.view.made < alone.view.frames)) break;
  }
  if (!alone) throw new Error('no measure');
  if (alone.skipped) note(`the allocation measure was skipped: ${alone.skipped}`);
  else {
    // Under a byte a step on average: what is left is a strike's few numbers, which is an event and not a step.
    ok(alone.planned > 0 && alone.scavenges === 0 && alone.made < 1 * alone.frames, `18: over ${alone.frames} steps of the drive's own code (racing, planning, sweeping, bridging, striking, the engines burning, pulling and mended) it makes ${Math.max(0, alone.made)} bytes (${(Math.max(0, alone.made) / alone.frames).toFixed(2)} a step, ${alone.scavenges} collections)`);
    ok(alone.view.scavenges === 0 && alone.view.made < 0.2 * alone.view.frames, `18: and over ${alone.view.frames} frames of the race view ${Math.max(0, alone.view.made)} bytes`);
  }
});

restore();
console.log(`\nraceDrive: ${checks} checks passed`);
