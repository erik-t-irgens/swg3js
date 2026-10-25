// The moving air's rules as plain arithmetic (src/world/volumetrics/airMath.ts) and the queues of its force API
// (airForces.ts, airEngines.ts), held to the handoff's demos and to the game's own numbers: the engine's reach, free jet
// and impact at three exit speeds; the spread's bite; the downwash of a level ship hovering at 5, 10 and 15 m, its
// exhaust the hull's own -Z as the plumes have it, lifting dust and none at 40 m/s forward; the slab weights; a splat
// never under a cell; the queues' own rules (a blast on a frame with no step lands whole on the next; an engine's push a
// second the same at 60, 144 and 240 frames; four four-engine hulls and a grenade fit with the grenade whole and the
// drops counted), driven here by hand on the forces alone, and through the field's own frame in `airFrame.test.ts`,
// which is what holds the field to them; the inflow; the dust's settling after 20 s the same at 60, 144 and 240 frames; the swirl per metre; the
// lift threshold; the slope gate; the wind the weather builds for the water; wave 2b's blowing sand (its two
// phases restarted with their overshoot at 30 to 240 frames a second, the carry in float32 bounded by u × cycle and alike
// at every rate where half floats drift by the rate, the strength read off the phases continuous where the older phase
// alone jumps); and the Force's fronts through the real `AirForces` (each kind's radius over its time, the dust laid and
// the shove given alike at 30, 60, 144 and 240 frames, a repulse's middle clear, a pull's first dust at its reach, a
// push's band its own width at High and the texel's at Low, the ninth dropped, `dropOwed` and `clear` letting go).
//
// Plain type stripping; synthetic numbers only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  airFrameNumbersIn,
  blastGrains,
  downwashExit,
  dustDecay,
  dustDecayFrame,
  dustHeight,
  exitSpeed,
  FRONT_KIND,
  frontRadiusIn,
  frontTime,
  HALF_NORMAL,
  lightStep,
  newFrontAt,
  newSandPhase,
  newAirFrameNumbers,
  engineReach,
  engineSpeed,
  fixedSteps,
  impactSpeed,
  inflowDust,
  inflowVelocity,
  jetRadiusAt,
  jetSpeedAt,
  liftThreshold,
  nozzleRadius,
  sheddingCount,
  slabWeight,
  slopeGate,
  sandLift,
  sandPhaseIn,
  sandStrength,
  splatRadius,
  spreadBite,
  stormSheetFactor,
  stormWeight,
  swirlAt,
  windVector,
} from '../../../src/world/volumetrics/airMath.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { AirForces, SPLAT_BATCH } from '../../../src/world/volumetrics/airForces.ts';
import { aboveFloor, downwashBase, kindExit, pushEngines, type AirHull } from '../../../src/world/volumetrics/airEngines.ts';
import { lightElevation, lightSunAcross } from '../../../src/world/volumetrics/airLight.ts';
import { AirRaster, type GroundSample } from '../../../src/world/volumetrics/airRaster.ts';
import { newWindow, placeWindow } from '../../../src/world/volumetrics/fluidWindow.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string): string => readFileSync(join(here, '..', '..', '..', 'src', p), 'utf8');

// --- the engine, against the demo's own formulas (land.html:1437-1484) ---
for (const exit of [20, 60, 140]) {
  const reach = 1.2 + 0.32 * exit;
  const vEff = Math.min(exit, 40 * 0.92);
  const r0 = 0.3 + 0.012 * exit;
  ok(near(engineReach(exit), reach) && near(engineSpeed(exit), vEff) && near(nozzleRadius(exit), r0), `exit ${exit}: reach ${reach.toFixed(2)} m, speed ${vEff.toFixed(1)} m/s, nozzle ${r0.toFixed(2)} m as the demo has them`);
  let jet = true;
  for (const d of [0, 1, 5, 12]) {
    if (!near(jetSpeedAt(vEff, d, reach), vEff / (1 + d / (0.3 * reach))) || !near(jetRadiusAt(r0, d), r0 + 0.16 * d)) jet = false;
  }
  ok(jet, `exit ${exit}: the free jet slows as vEff / (1 + d / 0.3 reach) and widens 0.16 a metre`);
  ok(near(impactSpeed(vEff, 3, reach, -0.5), (vEff / (1 + 3 / (0.3 * reach))) * Math.sqrt(0.5)) && impactSpeed(vEff, 3, reach, 0.1) === 0, `exit ${exit}: the impact as the demo has it, and none for a jet pointed up`);
}
ok(near(spreadBite(0.5, 0), 0.35) && near(spreadBite(3.9, 12), 0) && near(spreadBite(1.0, 12), (1 - 0.5 / 3.4) * (0.35 + 1)), 'the spread bites under a low nozzle, by height and speed, as the demo has it');

// --- the downwash, read from a stand-in hull through the real pushEngines ---
const ground = (): AirRaster => {
  const r = new AirRaster();
  r.resize(128);
  r.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]);
  r.familyColour = new Uint8Array([0, 0, 0, 0, 200, 170, 120, 255]);
  return r;
};
const flat = { sample: (_x: number, _z: number, out: GroundSample) => ((out.h = 0), (out.family = 1), (out.medium = 1), true) };
function forcesAt(): AirForces {
  const f = new AirForces();
  f.active = true;
  const w = newWindow();
  placeWindow(w, 0, 0, AIR_TUNE.window.size, 128, AIR_TUNE.window.jump);
  const r = ground();
  r.fillAll(flat, w.ox, w.oz, w.cell);
  f.window = w;
  f.raster = r;
  return f;
}
/** A level ship hovering with its underside `h` m over the ground, its two engines aft; its body throws if anybody asks it for its velocity. */
function ship(h: number, speed: number): AirHull {
  const group = new THREE.Group();
  group.position.set(0, h + 1.5, 0);
  const engines = [-1, 1].map((x) => {
    const o = new THREE.Object3D();
    o.position.set(x, 0, -4);
    group.add(o);
    return { object: o, size: 1, seed: 0 };
  });
  group.updateMatrixWorld(true);
  const hull = {
    engines,
    engineHeat: 1,
    group,
    spec: { ship: true, kind: 'ship', bounds: { min: [-3, -1.5, -5], max: [3, 1.5, 5] } },
    airborne: true,
    powered: true,
    landed: false,
    speed,
    pos: group.position,
    altitude: 0,
    body: {
      linvel(): never {
        throw new Error('the air read a body for its velocity');
      },
    },
  };
  return hull as unknown as AirHull;
}
/** The sources' frame walk the field runs every frame before the dust's batch (wave 2b's): the engines' dust worked out. */
function walk(f: AirForces, dt = 1 / 60): void {
  f.frameDt = dt;
  f.frameSources();
}
for (const h of [5, 10, 15]) {
  const f = forcesAt();
  pushEngines([ship(h, 0)], f);
  walk(f);
  const dust = f.buildDustBatch(1 / 60);
  const splats = f.buildStepBatch(1 / 60);
  let downward = false;
  for (let i = 0; i < f.engineCount; i++) if (f.engines[i * 10 + 4] < -0.99) downward = true;
  ok(downward && dust > 0 && splats > 0, `a level ship hovering at ${h} m blows down under itself: dust lifted (${dust}) and the air shoved (${splats} splats)`);
  // Its own engines leave along its -Z, the plumes' own direction: level, they reach no ground at that height.
  const aft = ship(h, 0);
  (aft as unknown as { airborne: boolean }).airborne = false;
  const g = forcesAt();
  pushEngines([aft], g);
  ok(g.engineCount === 2 && g.engines[5] < -0.99 && Math.abs(g.engines[4]) < 1e-6, `its own two engines exhaust along the hull's -Z (${h} m)`);
}
{
  // A ship lifted from rest with Space and left there is never `airborne` (cruising past 4 m/s, or having flown): it
  // rides its springs above its band's floor, which is what says it holds itself up (the first browser smoke's X-wing,
  // 15 m over sand and stirring nothing). Resting at its floor, landed, or with its engines cut, it blows nothing down.
  const springs = (alt: number, landed = false, powered = true): AirHull => {
    const h = ship(alt, 0) as unknown as { airborne: boolean; altitude: number; landed: boolean; powered: boolean; spec: Record<string, unknown> };
    h.airborne = false;
    h.altitude = 1 + alt;
    h.landed = landed;
    h.powered = powered;
    h.spec = { ...h.spec, fly: { floor: 1, ceiling: 260, climb: 4 } };
    return h as unknown as AirHull;
  };
  const down = (h: AirHull): boolean => {
    const f = forcesAt();
    pushEngines([h], f);
    for (let i = 0; i < f.engineCount; i++) if (f.engines[i * 10 + 4] < -0.99) return true;
    return false;
  };
  ok(down(springs(8)) && aboveFloor(springs(8)), 'a ship stopped in the air on its springs, 8 m over its floor, blows down under itself');
  ok(!down(springs(0)) && !down(springs(8, true)) && !down(springs(8, false, false)), 'and none resting at its floor, landed, or with its engines cut');
  const flyer = (alt: number): AirHull => {
    const h = springs(alt) as unknown as { spec: Record<string, unknown> };
    h.spec = { ...h.spec, ship: false, kind: 'flyer' };
    return h as unknown as AirHull;
  };
  ok(downwashBase(flyer(6)) === AIR_TUNE.engine.downwashFlyer && downwashBase(flyer(0)) === 0, 'a flyer blows down above its floor and not at it');
}
{
  const f = forcesAt();
  pushEngines([ship(10, 40)], f);
  walk(f);
  ok(f.buildDustBatch(1 / 60) === 0, 'none at 40 m/s forward: the downwash fades out in flight and level engines reach no ground');
  ok(downwashExit(AIR_TUNE.engine.downwashShip, 0) === AIR_TUNE.engine.downwashShip && downwashExit(AIR_TUNE.engine.downwashShip, 40) === 0, 'the downwash: whole hovering, none past its fade');
}
ok(src('vehicles/enginePlumes.ts').includes('const dx = -g[8];') && ['a[3] = -g[8];', 'a[4] = -g[9];', 'a[5] = -g[10];'].every((l) => src('world/volumetrics/airEngines.ts').includes(l)), "the air's exhaust is the plumes' own: the group's -Z");

// --- the frame's code writes these rules out where it uses them (no number crosses a call): held to them here ---
{
  // The jet, along its axis and at the ground, read off the batch.
  const f = forcesAt();
  const exit = 60;
  f.engine(0, 0.6, 0, 1, 0, 0, exit, 0, 0);
  const n = f.buildStepBatch(1 / 60);
  const reach = engineReach(exit);
  const vEff = engineSpeed(exit);
  let jet = n >= 16;
  for (let i = 1; i <= 8; i++) {
    const d = (reach * i) / 8;
    const want = jetSpeedAt(vEff, d, reach) * AIR_TUNE.engine.jetPush / 60;
    const got = f.splatB[(i - 1) * 4];
    const r = Math.sqrt(1 / f.splatA[(i - 1) * 4 + 2]) * f.window!.size;
    if (Math.abs(got - want) > 1e-4 || Math.abs(r - Math.max(jetRadiusAt(nozzleRadius(exit), d), f.window!.cell)) > 1e-3) jet = false;
  }
  ok(jet, "the batch's free jet is jetSpeedAt and jetRadiusAt, sample by sample");
  const g = forcesAt();
  g.engine(0, 4, 0, 0, -1, 0, exit, 0, 0);
  g.buildStepBatch(1 / 60);
  const imp = impactSpeed(vEff, 4, reach, -1) * AIR_TUNE.engine.impactPush / 60;
  const vx = g.splatB[0];
  const vz = g.splatB[1];
  ok(Math.abs(Math.sqrt(vx * vx + vz * vz) - imp) < 1e-4, "and its impact's shove is impactSpeed's, at the ground 4 m under a jet pointed down");
  const h = forcesAt();
  h.engine(0, 1.2, 0, 0, 0, 1, exit, 0, 12);
  h.buildStepBatch(1 / 60);
  const bite = spreadBite(1.2, 12) * AIR_TUNE.engine.spreadPush / 60;
  const sx = h.splatB[8 * 4];
  const sz = h.splatB[8 * 4 + 1];
  // The first of the ring stands square to the jet (+X of a jet heading +Z), where the slant's bias is nought.
  ok(Math.abs(Math.sqrt(sx * sx + sz * sz) - bite) < 1e-4, "and a low nozzle's spread is spreadBite's");
}
{
  // The frame's own numbers against the helpers they write out.
  const r = newAirFrameNumbers();
  let same = true;
  let s = 7;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
  for (let i = 0; i < 2000; i++) {
    r.dt = rnd() * 0.1;
    r.cell = 0.8 + rnd() * 3;
    r.windHeading = rnd() * 7;
    r.windSpeed = rnd() * 15;
    r.storm = rnd() * 1.2 - 0.1;
    r.sunX = rnd() - 0.5;
    r.sunY = rnd() * 1.4 - 0.2;
    r.sunZ = rnd() - 0.5;
    r.lightSteps = 12 + Math.floor(rnd() * 30);
    airFrameNumbersIn(r);
    const w = windVector(r.windHeading, r.windSpeed, { x: 0, z: 0 });
    const across = lightSunAcross(r.sunX, r.sunZ, { x: 0, z: 0 });
    const checks2 = [
      [r.windX, w.x],
      [r.windZ, w.z],
      // From wave 2b the storm's inflow is laid at its weight, H(storm) / H₀, and stands as its half-normal.
      [r.inflowDust, inflowDust(r.storm > 0 ? r.storm : 0) * stormWeight(r.storm > 0 ? r.storm : 0)],
      [r.dustHeight, dustHeight(r.storm > 0 ? r.storm : 0)],
      [r.stormWeight, stormWeight(r.storm > 0 ? r.storm : 0)],
      [r.stormSigma, HALF_NORMAL * dustHeight(r.storm > 0 ? r.storm : 0)],
      [r.sunElevation, Math.max(0.05, lightElevation(r.sunY))],
      [r.decay, dustDecayFrame(r.dt, AIR_TUNE.dust.settle)],
      [r.swirl, swirlAt(r.cell)],
      [r.sunAcrossX, across.x],
      [r.sunAcrossZ, across.z],
      [r.lightStep, lightStep(lightElevation(r.sunY), r.lightSteps)],
    ];
    for (const [a, b] of checks2) if (Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(b))) same = false;
  }
  ok(same, "the frame's own numbers are the helpers', to the last place, over 2000 random frames");
}
{
  // pushEngines' exits and downwash against the helpers.
  const f = forcesAt();
  const hull = ship(8, 10);
  pushEngines([hull], f);
  const exit = exitSpeed(kindExit('ship', true), 1);
  const down = downwashExit(downwashBase(hull), 10);
  // The table is single precision.
  ok(Math.abs(f.engines[6] - exit) < 1e-5 && Math.abs(f.engines[2 * 10 + 6] - down) < 1e-5, "pushEngines hands over exitSpeed(kindExit) for each engine and downwashExit(downwashBase) under the hull");
}

// --- the slabs, the splat ---
ok(slabWeight(1.5, 1.5, 1) === 1 && near(slabWeight(1.5, 2.5, 1), Math.exp(-1)) && slabWeight(1.5, 4, 1) === 0, 'a slab is reached by exp(-((centre - y) / reach)^2), nothing under 0.02');
ok(splatRadius(0.2, 1.5) === 1.5 && splatRadius(4, 1.5) === 4, 'a splat is never under one cell');

// --- the queues (the forces alone; the field's own loop is airFrame.test.ts's) ---
{
  const f = forcesAt();
  const clock = { steps: 0, acc: 0 };
  f.blast(10, 0, 10, 7, 14, 0);
  ok(f.oneCount === AIR_TUNE.blast.shoves, `a thermal detonator queues its ${AIR_TUNE.blast.shoves} shoves`);
  fixedSteps(clock.acc, 1 / 240, 60, 3, clock);
  ok(clock.steps === 0 && f.oneCount === AIR_TUNE.blast.shoves, 'a frame that takes no step leaves them owed');
  fixedSteps(clock.acc, 1 / 60, 60, 3, clock);
  const n = f.buildStepBatch(1 / 60);
  ok(clock.steps === 1 && n >= AIR_TUNE.blast.shoves, 'the next frame steps and the batch holds every shove');
  let whole = true;
  for (let i = 0; i < AIR_TUNE.blast.shoves; i++) {
    const vx = f.splatB[i * 4];
    const vz = f.splatB[i * 4 + 1];
    if (!(Math.abs(Math.sqrt(vx * vx + vz * vz) - AIR_TUNE.blast.shove) < 1e-3)) whole = false;
  }
  ok(whole, 'whole: each at its full shove, not a step\'s share');
  f.consumeOneShots();
  ok(f.oneCount === 0 && f.buildStepBatch(1 / 60) === 0, 'and once drawn, owed no more');
}
{
  // An engine's push a second, at three frame rates, the solver at 60 a second.
  const pushOver = (fps: number): number => {
    const f = forcesAt();
    const clock = { steps: 0, acc: 0 };
    let sum = 0;
    for (let frame = 0; frame < fps * 10; frame++) {
      f.beginFrame();
      f.engine(0, 0.6, 0, 0, 0, 1, 40, 0, 0);
      fixedSteps(clock.acc, 1 / fps, 60, 3, clock);
      for (let s = 0; s < clock.steps; s++) {
        const n = f.buildStepBatch(1 / 60);
        for (let i = 0; i < n; i++) sum += f.splatB[i * 4 + 1];
      }
    }
    return sum;
  };
  const a = pushOver(60);
  const b = pushOver(144);
  const c = pushOver(240);
  ok(a > 0 && Math.abs(b - a) / a < 0.002 && Math.abs(c - a) / a < 0.002, `an engine's push over ten seconds is the same at 60, 144 and 240 frames a second (${a.toFixed(1)}, ${b.toFixed(1)}, ${c.toFixed(1)})`);
}
{
  const f = forcesAt();
  f.blast(-30, 0, -30, 7, 14, 0);
  for (let h = 0; h < 4; h++) for (let e = 0; e < 4; e++) f.engine(h * 8 - 12, 0.6, e * 2, 1, 0, 0, 60, 0, 0);
  const n = f.buildStepBatch(1 / 60);
  let grenade = true;
  for (let i = 0; i < AIR_TUNE.blast.shoves; i++) {
    const u = f.splatA[i * 4];
    const x = f.window!.ox + u * f.window!.size;
    if (Math.abs(x - -30) > 5) grenade = false;
  }
  const counts = { engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0, fronts: 0, droppedFronts: 0 };
  f.takeCounts(counts);
  ok(n <= SPLAT_BATCH && grenade && counts.droppedSplats > 0, `four four-engine hulls and a grenade: the batch holds ${n} of ${SPLAT_BATCH}, the grenade whole and first, and ${counts.droppedSplats} dropped and counted`);
}

// --- the inflow ---
{
  const w = windVector(0.7, 9, { x: 0, z: 0 });
  const v = inflowVelocity(w.x, w.z, AIR_TUNE.slabs.windShare, { x: 0, z: 0 });
  ok(near(v.x, w.x * 0.72) && near(v.z, w.z * 0.72), 'out of the window the air is the wind times the slab\'s share (0.72 for slab 0)');
  ok(near(inflowDust(0.5), 0.5 * AIR_TUNE.dust.stormInflow) && inflowDust(0) === 0, "out of the window the dust is the storm's, nought without one (smoke is the third wave's)");
}

// --- the dust settles alike at every frame rate ---
{
  const after = (fps: number): number => {
    let d = 1;
    for (let i = 0; i < fps * 20; i++) d *= dustDecayFrame(1 / fps, AIR_TUNE.dust.settle);
    return d;
  };
  const fixed = Math.pow(dustDecay(1 / 60, AIR_TUNE.dust.settle), 1200);
  ok(Math.abs(after(60) - fixed) / fixed < 1e-9 && Math.abs(after(144) - fixed) / fixed < 1e-9 && Math.abs(after(240) - fixed) / fixed < 1e-9, `the dust after 20 s is the same at 60, 144 and 240 frames as in fixed steps (${fixed.toExponential(4)})`);
  ok(dustDecayFrame(0, 3) === 1, 'a frame of nought settles nothing');
}

// --- the swirl, the lift, the slope, the wind ---
ok(near(swirlAt(3) * 3, swirlAt(1) * 1) && near(swirlAt(1.5) * 1.5, AIR_TUNE.solver.swirl * AIR_TUNE.solver.swirlCell), 'the swirl is per metre: the same force for a unit of vorticity at 64 cells and at 192');
ok(liftThreshold(4) === 4 * 1.05 + 1.5 && liftThreshold(40) === 13, "the lift threshold: min(W · 1.05 + 1.5, 13), the demo's");
ok(slopeGate(10) === 1 && slopeGate(25) === 1 && slopeGate(40) === 0 && slopeGate(60) === 0 && slopeGate(32) > 0 && slopeGate(32) < 1, 'the slope gate: all below 25°, none past 40°');
{
  const wv = windVector(1.2, 7, { x: 0, z: 0 }, 1);
  ok(near(wv.x, Math.sin(1.2) * 7) && near(wv.z, Math.cos(1.2) * 7), "the wind's direction is (sin h, cos h), the vector the weather builds for the water");
  ok(src('world/weather.ts').includes('.set(Math.sin(this.windHeading), Math.cos(this.windHeading))'), "and weather.ts still builds the water's that way");
}

// --- the grains' counts, the storm sheets ---
// The fastest and widest machine throws 164 motes a second (today's count's own rate), 8.2 a twentieth.
ok(sheddingCount(9, 164, 0.0556, 1) === 9 && sheddingCount(8, 164, 0.05, 0.6) === 4 && sheddingCount(9, 164, 0.0556, 0.6) === 4 && sheddingCount(11, 164, 0.0667, 0.6) === 5, "a machine throws today's count on sand and, on dirt, its share of a fixed twentieth's motes in whole motes, spread over the interval");
ok(sheddingCount(8, 164, 0.05, 31 / 255) === 0 && sheddingCount(9, 164, 0.0556, 31 / 255) === 0 && sheddingCount(11, 164, 0.0667, 26 / 255) === 0 && sheddingCount(9, 164, 0.0556, 0) === 0 && sheddingCount(9, 164, 0.0556, Number.NaN) === 0, 'and none on rock, paving, mud or water, at a twentieth of a second or the longer intervals 144 and 30 frames a second make');
ok(blastGrains(7) === AIR_TUNE.grains.blast && blastGrains(14) === 2 * AIR_TUNE.grains.blast && blastGrains(Number.NaN) === 0, 'a blast throws 300 grains at a thermal detonator\'s radius, by radius over 7');
ok(stormSheetFactor(false, 1, 0.5) === 1 && stormSheetFactor(true, 0, 0.5) === 1 && stormSheetFactor(true, 0.5, 0) === 1 && stormSheetFactor(true, 0.5, 0.5) === 0.5, 'the storm sheets: 1 unless the volume drew the storm, then 1 - thin');

// --- the blowing sand (wave 2b): two phases of the second wave's carry, each restarted every cycle ---
/** A half float as research2 §5.1 found this machine's store does it: truncated toward nought. */
const f32h = new Float32Array(1);
const u32h = new Uint32Array(f32h.buffer);
const half = (x: number): number => {
  f32h[0] = x;
  const b = u32h[0];
  const sign = b & 0x80000000 ? -1 : 1;
  const exp = ((b >>> 23) & 0xff) - 127 + 15;
  if (exp >= 31) return sign * 65504;
  if (exp <= 0) {
    if (exp < -10) return sign * 0;
    const m = ((b & 0x7fffff) | 0x800000) >>> (14 - exp);
    return sign * m * 2 ** -24;
  }
  return sign * (1 + ((b & 0x7fffff) >>> 13) / 1024) * 2 ** (exp - 15);
};
{
  // The phases' clock: each restart keeps its overshoot, the cycles are counted, phase B stays half a cycle on.
  const T = AIR_TUNE.sand.cycle;
  for (const fps of [30, 60, 144, 240]) {
    const c = newSandPhase(T);
    c.dt = 1 / fps;
    let restarts = 0;
    let overshoot = true;
    let bounded = true;
    for (let i = 0; i < fps * 10; i++) {
      const before = c.tA;
      sandPhaseIn(c);
      if (c.restartA) {
        restarts++;
        if (!near(c.tA, before + c.dt - T, 1e-9)) overshoot = false;
      }
      if (!(c.tA >= 0 && c.tA < T && c.tB >= 0 && c.tB < T)) bounded = false;
    }
    const gap = (((c.tB - c.tA) % T) + T) % T;
    ok(overshoot && bounded && restarts === c.kA && c.kA === Math.floor(10 / T) && c.kB === Math.floor((10 + T / 2) / T) && near(gap, T / 2, 1e-6), `at ${fps} frames a second the phases restart every ${T} s with their overshoot kept, A ${c.kA} times and B ${c.kB} in 10 s, B half a cycle on throughout`);
  }
}
{
  // The carry of one texel under a steady 10 m/s, the shader's two lines: carried, and where its phase restarted, only
  // what it was carried since. In float32 (the field's store) it is the exact -u·t at every rate and bounded by u × cycle;
  // in half floats it drifts by an amount that grows with the frame rate (research-amend-ground §2.2's table).
  const T = AIR_TUNE.sand.cycle;
  const u = 10;
  const run = (fps: number, store: (x: number) => number): { worst: number; most: number } => {
    const c = newSandPhase(T);
    c.dt = 1 / fps;
    let oA = 0;
    let exact = 0;
    let worst = 0;
    let most = 0;
    for (let i = 0; i < fps * 3.5; i++) {
      sandPhaseIn(c);
      oA = store(oA - u * c.dt);
      exact = exact - u * c.dt;
      if (c.restartA) {
        oA = store(-u * c.tA);
        exact = -u * c.tA;
      }
      if (Math.abs(exact) > most) most = Math.abs(exact);
      const e = Math.abs(oA - exact);
      if (e > worst) worst = e;
    }
    return { worst: worst / most, most };
  };
  const f = [60, 144, 240].map((fps) => run(fps, Math.fround));
  const h = [60, 144, 240].map((fps) => run(fps, half));
  ok(f.every((r) => r.worst < 1e-5 && r.most <= u * T + 1e-9), `in float32 the carry is the law's to ${f.map((r) => (r.worst * 100).toFixed(5)).join(', ')}% at 60, 144 and 240 frames a second and never past u × cycle (${(u * T).toFixed(1)} m)`);
  ok(h[1].worst > 10 * f[1].worst && h[2].worst > 10 * f[2].worst && h[1].worst > 0.005 && h[2].worst > 0.005, `and stored as half floats it drifts by ${h.map((r) => (r.worst * 100).toFixed(2)).join(', ')}% (the control): which is why the pair is float32`);
}
{
  // Where it is blowing, read off the two phases: a jet carrying 10 m/s on at 1.0 s over 0.3 s and off at 4.0 s over
  // 0.3 s. `sandStrength` moves by less in a frame the more frames there are; the older phase's own |o| / t jumps at
  // every restart (the control); and in the steady carry it reads the carry.
  const T = AIR_TUNE.sand.cycle;
  const carryAt = (t: number): number => 10 * Math.min(1, Math.max(0, (t - 1) / 0.3)) * (1 - Math.min(1, Math.max(0, (t - 4) / 0.3)));
  const run = (fps: number): { step: number; older: number; steady: number } => {
    const c = newSandPhase(T);
    c.dt = 1 / fps;
    let oA = 0;
    let oB = 0;
    let last = Number.NaN;
    let lastOld = Number.NaN;
    let step = 0;
    let older = 0;
    let steady = 0;
    for (let i = 0; i < fps * 6; i++) {
      const t = (i + 1) / fps;
      sandPhaseIn(c);
      const u = carryAt(t);
      oA -= u * c.dt;
      oB -= u * c.dt;
      if (c.restartA) oA = -u * c.tA;
      if (c.restartB) oB = -u * c.tB;
      const s = sandStrength(oA, 0, oB, 0, c.tA, c.tB, T);
      const old = c.tA > c.tB ? Math.abs(oA) / c.tA : Math.abs(oB) / c.tB;
      if (Number.isFinite(last)) step = Math.max(step, Math.abs(s - last));
      if (Number.isFinite(lastOld)) older = Math.max(older, Math.abs(old - lastOld));
      last = s;
      lastOld = old;
      if (Math.abs(t - 3.5) < 0.5 / fps) steady = s;
    }
    return { step, older, steady };
  };
  const r = [60, 144, 240].map(run);
  ok(r[0].step > r[1].step && r[1].step > r[2].step && r[0].step < 0.5, `the strength is continuous: its largest change in a frame ${r.map((x) => x.step.toFixed(3)).join(', ')} m/s at 60, 144 and 240 frames, shrinking with the frame`);
  ok(r.every((x) => x.older > 1), `where the older phase's own |o| / t jumps by ${r.map((x) => x.older.toFixed(2)).join(', ')} m/s at its restarts (the control)`);
  ok(r.every((x) => Math.abs(x.steady - 10) < 0.05), `and in the steady carry it reads the carry: ${r.map((x) => x.steady.toFixed(3)).join(', ')} m/s of 10`);
}
ok(sandLift(5, 6, 7, 1) === 0 && near(sandLift(20, 6, 7, 1), 1) && sandLift(20, 6, 7, 0) === 0, 'the lift: nothing under the threshold, all past its span (the carry takes it with moves one; coverage is the pixel\'s)');
{
  const shader = readFileSync(join(here, '..', '..', '..', 'src', 'world', 'volumetrics', 'airShaders.ts'), 'utf8');
  const lines = [
    'float lift = smoothstep(uLift, uLift + uLiftSpan, length(v)) * land;',
    'vec4 o = offsetsAt(l - u * uDt / uWindow.z + uSandShift) - vec4(u, u) * uDt;',
    'if (uSandQ.x > 0.5) o.xy = -u * uSandQ.y;',
    'if (uSandQ.z > 0.5) o.zw = -u * uSandQ.w;',
  ];
  ok(lines.every((l) => shader.includes(l)) && !shader.includes('uAgeReset') && !shader.includes('resp.r * land'), "and the offsets' shader is the two phases line for line: no \"moves\" factor, no age and no heal");
}

// --- the Force's fronts (wave 2b), through the real AirForces ---
{
  const F = AIR_TUNE.force;
  const fa = newFrontAt();
  const at = (kind: number, reach: number, s: number): number => {
    fa.kind = kind;
    fa.reach = reach;
    fa.age = s * frontTime(kind);
    frontRadiusIn(fa);
    return fa.r;
  };
  ok(near(at(FRONT_KIND.push, 16, 0), F.pushFrom) && near(at(FRONT_KIND.push, 16, 1), 16) && near(at(FRONT_KIND.push, 16, 0.5), F.pushFrom + (16 - F.pushFrom) * (1 - 0.5 ** F.pushEase)), "a push runs out from its start to its reach, fast then slowing");
  ok(near(at(FRONT_KIND.pull, 16, 0), 16 * F.pullFrom) && near(at(FRONT_KIND.pull, 16, 1), F.pullTo) && near(at(FRONT_KIND.pull, 16, 0.5), 16 * F.pullFrom + (F.pullTo - 16 * F.pullFrom) * 0.5 ** F.pullEase), "a pull rolls in from its reach to a body's reach short of the feet, slow at first");
  ok(near(at(FRONT_KIND.repulse, 10, 0), F.repulseFrom) && near(at(FRONT_KIND.repulse, 10, 1), 10) && near(at(FRONT_KIND.repulse, 10, 2), 10), 'a repulse opens from its start to its reach and holds there');

  /** A front made at the window's middle and run for three seconds at `fps`, the field's own order a frame; what it laid. */
  const frontRun = (fps: number, kind: 'push' | 'pull' | 'repulse', cells = 128, dustDetail = 4) => {
    const f = new AirForces();
    f.active = true;
    const w = newWindow();
    placeWindow(w, 0, 0, AIR_TUNE.window.size, cells, AIR_TUNE.window.jump);
    const r = ground();
    r.resize(cells);
    r.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]);
    r.familyColour = new Uint8Array([0, 0, 0, 0, 200, 170, 120, 255]);
    r.fillAll(flat, w.ox, w.oz, w.cell);
    f.window = w;
    f.raster = r;
    f.dustTexel = w.size / (cells * dustDetail);
    const reach = kind === 'repulse' ? 10 : 16;
    f.force(0, 0, 0, kind === 'repulse' ? 0 : 1, 0, 1, kind === 'pull' ? -1 : 1, reach);
    const clock = { steps: 0, acc: 0 };
    let shove = 0;
    let dust = 0;
    let first: { x: number; z: number; rho: number }[] | null = null;
    const splats: { x: number; z: number; rho: number; amount: number }[] = [];
    for (let frame = 0; frame < fps * 3; frame++) {
      const dt = 1 / fps;
      f.frameDt = dt;
      f.frameSources();
      fixedSteps(clock.acc, dt, 60, 3, clock);
      for (let s = 0; s < clock.steps; s++) {
        const n = f.buildStepBatch(1 / 60);
        for (let i = 0; i < n; i++) shove += Math.sqrt(f.splatB[i * 4] ** 2 + f.splatB[i * 4 + 1] ** 2);
        f.consumeOneShots();
      }
      const n = f.buildDustBatch(dt);
      const now: { x: number; z: number; rho: number }[] = [];
      for (let i = 0; i < n; i++) {
        const b = f.dustBatch;
        const rho = Math.sqrt(1 / b[i * 4 + 2]) * w.size;
        const x = w.ox + b[i * 4] * w.size;
        const z = w.oz + b[i * 4 + 1] * w.size;
        dust += b[i * 4 + 3] * Math.PI * rho * rho;
        splats.push({ x, z, rho, amount: b[i * 4 + 3] });
        if (b[i * 4 + 3] > 0) now.push({ x, z, rho });
      }
      if (!first && now.length) first = now;
    }
    const counts = { engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0, fronts: 0, droppedFronts: 0 };
    f.takeCounts(counts);
    const densityAt = (x: number, z: number): number => {
      let d = 0;
      for (const s of splats) d += s.amount * Math.exp(-((x - s.x) ** 2 + (z - s.z) ** 2) / (s.rho * s.rho));
      return d;
    };
    return { shove, dust, first: first ?? [], left: f.frontCount, counts, densityAt, cell: w.cell };
  };
  for (const kind of ['push', 'pull', 'repulse'] as const) {
    const runs = [30, 60, 144, 240].map((fps) => frontRun(fps, kind));
    const d0 = runs[3].dust;
    const s0 = runs[3].shove;
    ok(runs.every((x) => Math.abs(x.dust - d0) / d0 < 0.01 && Math.abs(x.shove - s0) / s0 < 1e-9 && x.left === 0), `a ${kind}'s dust laid (${runs.map((x) => x.dust.toFixed(2)).join(', ')} density·m²) and its shove given are alike at 30, 60, 144 and 240 frames a second, and it is let go once both its clocks have passed its time`);
  }
  {
    const rep = frontRun(60, 'repulse');
    let ring = 0;
    for (let r = 1; r <= 10; r += 0.25) for (const a of [0, 1.1, 2.3, 4.0]) ring = Math.max(ring, rep.densityAt(r * Math.cos(a), r * Math.sin(a)));
    const centre = rep.densityAt(0, 0);
    ok(centre < 0.1 * ring, `a repulse's middle is clear: ${centre.toFixed(4)} at the feet against its ring's ${ring.toFixed(4)}`);
    const pull = frontRun(60, 'pull');
    ok(pull.first.length > 0 && pull.first.every((s) => Math.abs(Math.sqrt(s.x * s.x + s.z * s.z) - 16 * AIR_TUNE.force.pullFrom) < 0.15), `a pull's first dust is laid at its reach (${pull.first.map((s) => Math.sqrt(s.x * s.x + s.z * s.z).toFixed(2)).join(', ')} m)`);
    const high = frontRun(60, 'push');
    const low = frontRun(60, 'push', 64, 3);
    const lowTexel = AIR_TUNE.window.size / (64 * 3);
    // The first frame's band has travelled a few tenths of a metre already (a push starts fast), so it is its width and a little.
    ok(high.first.length > 0 && high.first.every((s) => Math.abs(s.rho - AIR_TUNE.force.dustWidth) < 0.05) && low.first.length > 0 && low.first.every((s) => Math.abs(s.rho - Math.max(AIR_TUNE.force.dustWidth, lowTexel)) < 0.05), `a push's first band is ${high.first[0]?.rho.toFixed(2)} m wide at High (its own width over the dust's 0.375 m texel) and ${low.first[0]?.rho.toFixed(2)} m at Low (the dust's texel), never the air's cell`);
  }
  {
    // An engine's dust is still floored at the air's cell: at Low (a 3 m cell) a jet landing just under its nozzle.
    const f = new AirForces();
    f.active = true;
    const w = newWindow();
    placeWindow(w, 0, 0, AIR_TUNE.window.size, 64, AIR_TUNE.window.jump);
    const r = ground();
    r.resize(64);
    r.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]);
    r.familyColour = new Uint8Array([0, 0, 0, 0, 200, 170, 120, 255]);
    r.fillAll(flat, w.ox, w.oz, w.cell);
    f.window = w;
    f.raster = r;
    f.dustTexel = 1;
    f.engine(0, 0.3, 0, 0, -1, 0, 30, 0, 0);
    walk(f);
    const n = f.buildDustBatch(1 / 60);
    const rho = n > 0 ? Math.sqrt(1 / f.dustBatch[2]) * w.size : 0;
    ok(n > 0 && rho >= w.cell - 1e-6, `and an engine's dust at Low is still at least the air's cell (${rho.toFixed(2)} m against a ${w.cell} m cell)`);
  }
  {
    const f = forcesAt();
    for (let i = 0; i < 9; i++) f.force(0, 0, 0, 1, 0, 1, 1, 16);
    const counts = { engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0, fronts: 0, droppedFronts: 0 };
    f.takeCounts(counts);
    ok(f.frontCount === AIR_TUNE.forces.fronts && counts.droppedFronts === 1 && counts.fronts === AIR_TUNE.forces.fronts, `the ${AIR_TUNE.forces.fronts + 1}th front at once is dropped and counted`);
    f.dropOwed();
    ok(f.frontCount === 0, 'a frame stepping nothing lets every front go (dropOwed)');
    f.force(0, 0, 0, 1, 0, 1, 1, 16);
    f.clear();
    ok(f.frontCount === 0, 'and so does a jump (clear)');
    f.force(0, 0, 0, 1, 0, Number.NaN, 1, 16);
    f.force(500, 0, 500, 1, 0, 1, 1, 16);
    f.takeCounts(counts);
    ok(f.frontCount === 0 && counts.notFinite === 1 && counts.offWindow === 1, 'a front not a number or off the window does nothing and is counted');
  }
}

console.log(`\n${checks} checks passed`);
