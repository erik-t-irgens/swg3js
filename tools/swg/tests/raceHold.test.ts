// How the race drive holds a hull to its line (src/vehicles/raceDrive.ts, `RACE_TUNE.hold`): the owner's loose hold
// after his first ride against the first ride's firm one, through the real `RaceDrive` over the stand-in body and
// physics of `raceStandIn.ts`, at 144, 60 and 20 fps.
//
// The owner rode the first wave and found the hull held to the ground so hard that he was "pulled down and back up very
// unrealistically" over bumps and crevasses. Under the loose hold the hull leaves a crest with the upward speed the rise
// gave it and comes down at the world's own gravity, landing where a thrown thing would; it carries over a hollow on its
// momentum instead of following the ground down and back up; on flat and gently rolling ground it rides its set height
// with no bobbing, and a long descent holds it close; nothing goes under the ground, a bank onto water leaves it
// skimming at its ride, and a fall from height is a landing, never a wreck. A rise ahead is climbed as the firm hold
// climbs it, with nothing met; a descent's foot is ridden, never sunk into; a kerb, a bump or a pit's far rim is ridden
// over, never a launch; and a descent entered over a crest is jumped first and then held close. Each check has a
// control that shows it can see the fault: the firm hold fails the jump and the carry, a hull held by far less than
// gravity floats off the rolling ground and the descent, a drive blind to a step goes under it, a hull that cannot rise
// fast meets the ramps, a hold fed the ground's fall from behind sinks into the feet, and one that takes a step's rise
// up at once is thrown off it.
//
// And day one: the firm hold is the first ride's rule exactly, at the halved speeds. The drive as it stood before this
// wave (its three files read whole out of git at the commit the wave started from) and today's with `hold: 'firm'` and
// the first ride's numbers laid back on drive the same course to the bit, both kinds, stock and full, at three frame
// rates; today's is held to a hash of that drive's trace written here, so the check stands where git cannot answer; and
// every number the wave moved is held to half or twice the first ride's, as the owner asked.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { Physics } from '../../../src/core/physics.ts';
import { Vehicle, specFor, type DriveInput, type VehicleSpec } from '../../../src/vehicles/vehicle.ts';
import { RaceDrive, type RaceGround } from '../../../src/vehicles/raceDrive.ts';
import { BIKE_SCALE, CEILING_LEAST, CEILING_OWNER, RACE_BASE, RACE_TUNE, rebuildBikeBase, tuneRace } from '../../../src/vehicles/raceTune.ts';
import { ENGINE_TUNE } from '../../../src/vehicles/drivetrain.ts';
import type { RaceBase } from '../../../src/vehicles/raceMath.ts';
import { standInRun, type StandInRun } from './raceStandIn.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const r2 = (n: number) => Number(n.toFixed(2));
const r3 = (n: number) => Number(n.toFixed(3));
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../../..');
const SRC = resolve(REPO, 'src');
const RATES = [144, 60, 20] as const;
const FIXED = 1 / 60;
type G = (x: number, z: number) => number;

const TUNE0 = JSON.parse(JSON.stringify(RACE_TUNE)) as typeof RACE_TUNE;
const POD0 = JSON.parse(JSON.stringify(RACE_BASE.podracer)) as RaceBase;
const ENGINE0 = { ...ENGINE_TUNE };
const restore = () => {
  Object.assign(RACE_TUNE, JSON.parse(JSON.stringify(TUNE0)));
  Object.assign(RACE_BASE.podracer, JSON.parse(JSON.stringify(POD0)));
  rebuildBikeBase();
  Object.assign(ENGINE_TUNE, ENGINE0);
  tuneRace({});
};

/** A run over the test's ground at the plain top of its kind and levels, held there by the throttle. */
function runOver(kind: 'pod' | 'bike', levels: 'max' | 'stock', ground: G, water: G | null = null): StandInRun {
  const probe = standInRun(kind, levels, 0);
  const speed = probe.race.plainTop();
  return standInRun(kind, levels, speed, { ground, water }, kind === 'pod' ? 1.2 : 0.65);
}

/** Where the body stands now and how fast it climbs. */
const bodyY = (run: StandInRun) => run.vehicle.body.translation().y;
const bodyZ = (run: StandInRun) => run.vehicle.body.translation().z;

// =============================================================================================================
// 1: a crest is jumped, and lands where gravity puts it
// =============================================================================================================
// A kicker: flat, then a ramp rising 10% over 60 m to 6 m, then the ground gone back to nought at its lip. Past the lip
// the hull is twice its band over its line, so from there on nothing but the hold's fall has it.
const LIP = 600;
const kicker: G = (_x, z) => (z <= LIP - 60 ? 0 : z <= LIP ? (z - (LIP - 60)) * 0.1 : 0);

interface Flight {
  /** Whether the hull left the lip rising, its vertical speed then, and the worst its body stood off the parabola of the world's gravity from there (m). */
  rising: boolean;
  vy0: number;
  worst: number;
  /** The time it took to come back down into its band, against what the parabola says (s), and how late a plan may see it (s). */
  took: number;
  wanted: number;
  seen: number;
  /** How far past the lip it came back into its band (m), and how far its underside then stood off its body's height (m: nought when it came down level). */
  landedAt: number;
  level: number;
  /** How much sooner that tilt has it meet its band (s). */
  tilt: number;
}

/**
 * The kicker flown at a full plain top. The nose is held level in the air (`airNose` 0) for the flight, so the hull's
 * lowest point is a fixed offset from its body all the way and its band is met where the body's parabola says: the
 * nose tipping over in the air is the attitude's, not the hold's.
 */
function flyKicker(kind: 'pod' | 'bike', fps: number): Flight {
  tuneRace({ airNose: 0 });
  const run = runOver(kind, 'max', kicker);
  const race = run.race;
  const dt = 1 / fps;
  const g = RACE_TUNE.looseFall;
  const b = run.vehicle.spec.bounds;
  const halfLength = Math.abs(b.max[2] - b.min[2]) / 2;
  let y0 = Number.NaN;
  let low0 = 0;
  let vy0 = 0;
  let s0 = 0;
  let worst = 0;
  let took = Number.NaN;
  let landedAt = Number.NaN;
  let wanted = Number.NaN;
  let seen = 0;
  let level = Number.NaN;
  let tilt = 0;
  for (let i = 0; i < 14 * fps && Number.isNaN(took); i++) {
    run.frame(dt);
    if (race.planned === 0) continue;
    const z = bodyZ(run);
    const over = race.overLine;
    if (Number.isNaN(y0)) {
      // The first plan wholly over its band with its whole footprint past the lip: the take-off, where nothing holds it
      // any more. (Up the ramp it may ride its band's very top, a plan in or out of it.)
      if (z > LIP + halfLength && over > race.handling.band) {
        y0 = bodyY(run);
        low0 = race.low;
        vy0 = race.vy;
        s0 = run.steps();
        // When the parabola from here brings it down to its band over the flat ground beyond (at nought). Its body's, not
        // its lowest point's: the nose is still up from the ramp as it leaves, and on its way down the hull levels with
        // the flat ground it is coming down to (its underside is its body's height then, which the landing checks).
        const drop = y0 - (race.handling.ride + race.handling.band);
        wanted = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * drop)) / g;
      }
      continue;
    }
    const t = (run.steps() - s0) * FIXED;
    if (over > race.handling.band) worst = Math.max(worst, Math.abs(bodyY(run) - (y0 + vy0 * t - 0.5 * g * t * t)));
    else {
      took = t;
      landedAt = z - LIP;
      level = Math.abs(race.low - bodyY(run));
      // A plan ends only every so many fixed steps: the band is met somewhere in the last one. And the hull still
      // levelling as it comes down meets its band the sooner by its tilt's last few centimetres, at the speed it comes down at.
      seen = race.planned * FIXED;
      tilt = level / Math.max(1, Math.abs(race.vy));
    }
  }
  restore();
  return { rising: vy0 > 0, vy0, worst, took, wanted, seen, landedAt, level, tilt };
}

for (const kind of ['pod', 'bike'] as const) {
  for (const fps of RATES) {
    const f = flyKicker(kind, fps);
    // Within the plan that saw it, less the little sooner the hull still levelling as it comes down meets its band.
    ok(f.rising && f.worst < 0.001 && f.level < 0.25 && f.took >= f.wanted - f.tilt - 1e-3 && f.took - f.wanted <= f.seen + 1e-3, `1: a ${kind} at its full plain top off a 6 m kicker at ${fps} fps leaves the lip rising at ${r2(f.vy0)} m/s, flies the parabola of the world's gravity to ${r3(f.worst * 1000)} mm, and comes back down into its band ${r2(f.landedAt)} m past the lip after ${r3(f.took)} s, where gravity puts it (${r3(f.wanted)} s, within the plan that saw it, ${r3(f.seen)} s), level (its underside ${r3(f.level)} m off its body's height)`);
  }
}
// The control: the firm hold comes down at fifteen times gravity, so the same kicker is no jump at all.
for (const fps of RATES) {
  tuneRace({ hold: 'firm' });
  const f = flyKicker('pod', fps);
  ok(f.worst > 1 && f.took < 0.5 * f.wanted, `1: (the control: the firm hold at ${fps} fps leaves the parabola by ${r2(f.worst)} m and is back in its band after ${r3(f.took)} s, ${r2(f.landedAt)} m past the lip, where gravity would have taken ${r3(f.wanted)} s: the check sees a hull snapped back)`);
}
restore();

// =============================================================================================================
// 2: a hollow is carried over
// =============================================================================================================
// A smooth hollow 20 m deep, crossed in nine-tenths of a second at the kind's full plain top (120 m for a pod, 70 for a
// bike): wider than the bridge's span either way, and flown with the bridge off besides, since the closing of a smooth
// valley fills its floor part of the way up even where it is wider than the span, and here the hold alone must decide.
// Carried, the hull's body is never lower than a body thrown off the near rim would be at the world's gravity, and it
// stays well up out of the hollow; the firm hold drags it down into it and back up.
const H0 = 600;
const HD = 20;
const hollowOf = (w: number): G => (_x, z) => (z <= H0 || z >= H0 + w ? 0 : -HD * 0.5 * (1 - Math.cos((2 * Math.PI * (z - H0)) / w)));
/** The pod's, for the course below and the ground checks: 120 m. */
const hollow = hollowOf(120);

interface Carry {
  /** The hollow's width (m), the deepest the hull's body went under where it stood at the near rim (m), and the most it went under a throw off that rim (m). */
  width: number;
  deepest: number;
  underThrow: number;
  /** Whether it got across at all in the time given. */
  crossed: boolean;
}

function carry(kind: 'pod' | 'bike', fps: number): Carry {
  tuneRace({ bridge: 'off' });
  const width = Math.round(0.9 * standInRun(kind, 'max', 0).race.plainTop());
  const run = runOver(kind, 'max', hollowOf(width));
  const race = run.race;
  const dt = 1 / fps;
  const g = RACE_TUNE.looseFall;
  let deepest = 0;
  let underThrow = 0;
  let rimY = Number.NaN;
  let rimVy = 0;
  let rimSteps = 0;
  let crossed = false;
  for (let i = 0; i < 14 * fps; i++) {
    run.frame(dt);
    const z = bodyZ(run);
    if (z > H0 + width + 50) {
      crossed = true;
      break;
    }
    if (race.planned === 0) continue;
    // The near rim: where the hull's middle passes it, its body's height and vertical speed then.
    if (Number.isNaN(rimY) && z >= H0) {
      rimY = bodyY(run);
      rimVy = race.vy;
      rimSteps = run.steps();
    }
    if (z <= H0 || z >= H0 + width) continue;
    const y = bodyY(run);
    deepest = Math.max(deepest, rimY - y);
    const t = (run.steps() - rimSteps) * FIXED;
    underThrow = Math.max(underThrow, rimY + rimVy * t - 0.5 * g * t * t - y);
  }
  restore();
  return { width, deepest, underThrow, crossed };
}

for (const kind of ['pod', 'bike'] as const) {
  for (const fps of RATES) {
    const c = carry(kind, fps);
    ok(c.crossed && c.underThrow < 0.01 && c.deepest < HD / 4, `2: a ${kind} at its full plain top over a hollow ${c.width} m across and ${HD} m deep at ${fps} fps carries over it on its momentum: never lower than a throw off the near rim (at most ${r3(c.underThrow)} m under it) and at its deepest ${r2(c.deepest)} m down, under a quarter of the hollow's ${HD}`);
  }
}
for (const fps of RATES) {
  tuneRace({ hold: 'firm' });
  const c = carry('pod', fps);
  ok(c.underThrow > 1 && c.deepest >= HD / 4, `2: (the control: the firm hold at ${fps} fps is dragged ${r2(c.underThrow)} m under that throw and ${r2(c.deepest)} m down into the hollow: the check sees a hull pulled down into it)`);
}
restore();

// =============================================================================================================
// 3: flat and gently rolling ground ride the set height with no bobbing; a long descent holds it close
// =============================================================================================================
// Rolling: half a metre up and down every 300 m, whose curve asks a full pod at its plain top for about a third of
// gravity, so a hold that has gravity in it follows it with no jump.
const rolling: G = (_x, z) => 0.5 * Math.sin((2 * Math.PI * z) / 300);

interface Ride {
  /** The most the hull stood over and under its line once settled (m), and whether it ever left its band. */
  over: number;
  under: number;
  left: boolean;
}

function ride(kind: 'pod' | 'bike', fps: number, ground: G): Ride {
  const run = runOver(kind, 'max', ground);
  const race = run.race;
  const dt = 1 / fps;
  let over = 0;
  let under = 0;
  let left = false;
  for (let i = 0; i < 6 * fps; i++) {
    run.frame(dt);
    if (race.planned === 0 || i < fps) continue;
    over = Math.max(over, race.overLine);
    under = Math.max(under, -race.overLine);
    if (race.overLine > race.handling.band) left = true;
  }
  return { over, under, left };
}

const flatG: G = () => 0;
for (const kind of ['pod', 'bike'] as const) {
  for (const fps of RATES) {
    const f = ride(kind, fps, flatG);
    ok(!f.left && f.over < 0.01 && f.under < 0.01, `3: a ${kind} at its full plain top over flat ground at ${fps} fps rides its set height with no bobbing (at most ${r3(f.over)} m over it and ${r3(f.under)} m under)`);
    const r = ride(kind, fps, rolling);
    ok(!r.left && r.over < 0.5 && r.under < 0.5, `3: and over gently rolling ground (half a metre every 300 m) never leaves its band, at most ${r2(r.over)} m over its line and ${r2(r.under)} m under`);
  }
}
// The control: a hold far under gravity floats off the same rolling ground.
tuneRace({ looseFall: 1, looseGrip: 1 });
{
  const r = ride('pod', 60, rolling);
  ok(r.left || r.over >= 0.5, `3: (the control: held by a twentieth of gravity the pod floats ${r2(r.over)} m over its line${r.left ? ', out of its band' : ''}: the check sees a hull floating off)`);
}
restore();

// A long descent, 10 degrees for 2 km, reached by a gentle bend whose curve asks a stock pod at its plain top for half
// of gravity: the hull follows it down within its band, and the strong downhill's push adds to its speed on the way.
const R = 2000;
const TH = (10 * Math.PI) / 180;
const D0 = 400;
const D1 = D0 + R * Math.sin(TH);
const descent: G = (_x, z) => (z <= D0 ? 0 : z <= D1 ? -(R - Math.sqrt(R * R - (z - D0) * (z - D0))) : -(R - R * Math.cos(TH)) - (z - D1) * Math.tan(TH));

interface Descent {
  /** The most the hull stood over its line down the descent (m), whether it left its band, and the speed it gained from the top of the descent (m/s). */
  over: number;
  left: boolean;
  gained: number;
  /** Whether it got to the descent's foot in the time given. */
  reached: boolean;
}

function descend(fps: number): Descent {
  const run = runOver('pod', 'stock', descent);
  const race = run.race;
  const dt = 1 / fps;
  let over = 0;
  let left = false;
  let at = Number.NaN;
  let reached = false;
  for (let i = 0; i < 24 * fps; i++) {
    run.frame(dt);
    const z = bodyZ(run);
    if (z > D1 + 1200) {
      reached = true;
      break;
    }
    if (race.planned === 0 || z < D0) continue;
    if (Number.isNaN(at)) at = race.h;
    over = Math.max(over, race.overLine);
    if (race.overLine > race.handling.band) left = true;
  }
  return { over, left, gained: race.h - at, reached };
}

for (const fps of RATES) {
  const d = descend(fps);
  ok(d.reached && !d.left && d.over < 1 && d.gained > 5, `3: a stock pod over a 10-degree descent 2 km long at ${fps} fps is held close (at most ${r2(d.over)} m over its line, never out of its band) and the strong downhill adds ${r2(d.gained)} m/s on the way down`);
}
tuneRace({ looseFall: 1, looseGrip: 1 });
{
  const d = descend(60);
  ok(d.left || d.over >= 1 || d.gained <= 5, `3: (the control: held by a twentieth of gravity it stands ${r2(d.over)} m over its line and gains ${r2(d.gained)} m/s: the check sees a hull floating off a descent)`);
}
restore();

// =============================================================================================================
// 4: nothing goes under the ground; a fall from height is a landing, never a wreck; water is skimmed
// =============================================================================================================
// A cliff: the ground falls away 40 m at once.
const cliff: G = (_x, z) => (z <= 600 ? 0 : -40);
interface Under {
  /** The deepest the hull's lowest point went under the ground under its middle (m), the hits, how far it went (m). */
  under: number;
  hits: string[];
  went: number;
  /** Over a liquid: its lowest point's least height over the surface (m), its last, and whether it was on the water. */
  overWater: number;
  lastOver: number;
  skims: boolean;
}

/** A run over `drawn` (what the drive reads) measured against `truth` (the ground as it is), twelve seconds long, past every feature at 600 m. */
function underRun(kind: 'pod' | 'bike', fps: number, drawn: G, truth: G, water: G | null = null): Under {
  const run = standInRun(kind, 'max', standInRun(kind, 'max', 0).race.plainTop(), { ground: drawn, water }, kind === 'pod' ? 1.2 : 0.65);
  const race = run.race;
  const dt = 1 / fps;
  let under = 0;
  let overWater = Infinity;
  let lastOver = Number.NaN;
  let skims = false;
  const hits: string[] = [];
  let seen = race.lastHit.at;
  for (let i = 0; i < 12 * fps; i++) {
    run.frame(dt);
    if (race.lastHit.at !== seen) {
      hits.push(race.lastHit.kind);
      seen = race.lastHit.at;
    }
    if (race.planned === 0) continue;
    const p = run.vehicle.body.translation();
    under = Math.max(under, truth(p.x, p.z) - race.low);
    if (water) {
      const w = water(p.x, p.z);
      if (Number.isFinite(w) && w > truth(p.x, p.z)) {
        overWater = Math.min(overWater, race.low - w);
        lastOver = race.low - w;
        if (run.vehicle.onWater) skims = true;
      }
    }
  }
  return { under, hits, went: bodyZ(run), overWater, lastOver, skims };
}

for (const kind of ['pod', 'bike'] as const) {
  for (const fps of RATES) {
    let worst = 0;
    let least = Infinity;
    for (const g of [kicker, hollow, rolling, cliff]) {
      const u = underRun(kind, fps, g, g);
      worst = Math.max(worst, u.under);
      least = Math.min(least, u.went);
    }
    ok(least > 700 && worst < 0.05, `4: a ${kind} at ${fps} fps never goes under the ground over the kicker, the hollow, the rolling ground or off a 40 m cliff (at worst ${r3(worst)} m under it, every run past them all)`);
    const c = underRun(kind, fps, cliff, cliff);
    ok(!c.hits.includes('crash') && !c.hits.includes('face'), `4: and the 40 m fall off the cliff is a landing, never a wreck (${c.hits.join(', ') || 'nothing struck'})`);
  }
}
{
  // The control: a drive blind to a 3 m step (its own ground flat) goes under the true ground, and the measure says so.
  const step: G = (_x, z) => (z > 600 ? 3 : 0);
  const c = underRun('pod', 60, flatG, step);
  ok(c.under > 1, `4: (the control: a drive blind to a 3 m step goes ${r2(c.under)} m under it: the measure sees a hull under the ground)`);
}
// Off a bank 5 m down onto water 15 m deep: it lands at its ride over the water and skims on, never into it.
{
  const bed: G = (_x, z) => (z <= 600 ? 0 : -20);
  const water: G = (_x, z) => (z <= 600 ? -Infinity : -5);
  for (const kind of ['pod', 'bike'] as const) {
    for (const fps of RATES) {
      const w = underRun(kind, fps, bed, bed, water);
      const ride = kind === 'pod' ? RACE_BASE.podracer.ride : RACE_BASE.speederbike.ride;
      ok(Number.isFinite(w.overWater) && w.overWater > -0.05 && Math.abs(w.lastOver - ride) < 0.1 && w.skims, `4: a ${kind} off a bank 5 m down onto water at ${fps} fps lands on it and skims at its ride (its lowest point never more than ${r3(Math.max(0, -w.overWater))} m under the surface, ${r2(w.lastOver)} m over it at the last, on the water)`);
    }
  }
}

// =============================================================================================================
// 5: day one -- the firm hold is the first ride's drive to the bit
// =============================================================================================================
/** The commit this wave started from: the drive as it stood before the speeds were halved and the hold loosened. */
const PRE_WAVE = '5ca2f61a2ec23f8ac5deb9d0756d6baabd173d8d';
/** That drive's trace over the course below, kind, levels and frame rate in turn, as one FNV-1a over its text (measured from it, once). */
const PRE_WAVE_TRACE = '2826cf21';

const fnv32 = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

interface OldModules {
  RaceDrive: typeof RaceDrive;
  RACE_TUNE: Record<string, unknown>;
  RACE_BASE: { podracer: RaceBase; speederbike: RaceBase };
}

/** The race drive's three files as they stood at `PRE_WAVE`, read out of git and loaded from a scratch folder, their other imports pointed at the tree's (the physics, the vehicle, the engines, three); null where git cannot answer. */
async function preWaveDrive(): Promise<OldModules | null> {
  const show = (rel: string): string | null => {
    try {
      return execFileSync('git', ['show', `${PRE_WAVE}:${rel}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
    } catch {
      return null;
    }
  };
  const files = { raceMath: show('src/vehicles/raceMath.ts'), raceTune: show('src/vehicles/raceTune.ts'), raceDrive: show('src/vehicles/raceDrive.ts') };
  if (!files.raceMath || !files.raceTune || !files.raceDrive) return null;
  const dir = mkdtempSync(join(tmpdir(), 'racehold-prewave-'));
  try {
    const ours = new Set(['./raceMath.ts', './raceTune.ts', './raceDrive.ts']);
    for (const [name, text] of Object.entries(files)) {
      let t = text!.replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => (ours.has(p) ? `from '${p}'` : `from '${pathToFileURL(resolve(SRC, 'vehicles', p)).href}'`));
      t = t.replace(/from 'three'/g, `from '${import.meta.resolve('three')}'`);
      writeFileSync(join(dir, `${name}.ts`), t);
    }
    const drive = (await import(pathToFileURL(join(dir, 'raceDrive.ts')).href)) as { RaceDrive: typeof RaceDrive };
    const tune = (await import(pathToFileURL(join(dir, 'raceTune.ts')).href)) as { RACE_TUNE: Record<string, unknown>; RACE_BASE: { podracer: RaceBase; speederbike: RaceBase } };
    return { RaceDrive: drive.RaceDrive, RACE_TUNE: tune.RACE_TUNE, RACE_BASE: tune.RACE_BASE };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The first ride's numbers, written out: every one this wave moved, as it stood before (the speeds before they were
 * halved, the bridge's quarter of a second, the hit's threshold and the hull and parts a m/s). With them laid back and
 * the hold firm, today's drive must drive exactly as the old one did. Where git answers they are held to the old
 * files' own; where it does not they are all there is.
 */
const FIRST_RIDE_POD: Partial<Record<keyof RaceBase, number>> = { V: 270, BT: 75, cap: 1200 / 3.6, reverseTop: 15, turnFullAt: 10, leanFrom: 50, lookMax: 160, lookStep: 8, riseMax: 150, fallMax: 150, strikeSpark: 4, strikeHurt: 25, strikeHull: 0.5, crashImpact: 90, crashDrop: 65, crashFrom: 90 };
const FIRST_RIDE_TUNE: Record<string, number> = { reverseBelow: 3, bridgeTime: 0.25, bridgeRing: 128, hitLoss: 6, scrapeHull: 0.15 };
const FIRST_RIDE_ENGINES = { scrapePart: 0.006, strikePart: 0.004 };

/** Today's tune, base and engines laid back to the first ride's numbers, the hold firm. Today's ceiling stands at its own reference, so it scales nothing and the base's ceiling is the first ride's. */
function asFirstRide(): void {
  const t = RACE_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(FIRST_RIDE_TUNE)) t[k] = v;
  t.ceiling = TUNE0.ceiling;
  t.hold = 'firm';
  Object.assign(RACE_BASE.podracer, FIRST_RIDE_POD);
  rebuildBikeBase();
  Object.assign(ENGINE_TUNE, FIRST_RIDE_ENGINES);
  tuneRace({});
}

/** Whether the numbers written above are the old files' own: every rule of the old tune (its ceiling aside, which the base carries) and every number of its pod as today's stand once laid back. */
function sameAsOld(old: OldModules): string[] {
  const off: string[] = [];
  const t = RACE_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(old.RACE_TUNE)) {
    if (k === 'ceiling') continue;
    if (JSON.stringify(t[k]) !== JSON.stringify(v)) off.push(`RACE_TUNE.${k} ${JSON.stringify(t[k])} against ${JSON.stringify(v)}`);
  }
  for (const [k, v] of Object.entries(old.RACE_BASE.podracer)) if (JSON.stringify((RACE_BASE.podracer as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)) off.push(`podracer.${k}`);
  for (const [k, v] of Object.entries(old.RACE_BASE.speederbike)) if (JSON.stringify((RACE_BASE.speederbike as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)) off.push(`speederbike.${k}`);
  return off;
}

{
  // Every number the wave moved moved as the owner asked and no further: each speed of the first ride's halved, each
  // hull or part a m/s doubled (so a hit at the same share of the speed costs the same), the bridge's half second and
  // its ring doubled (the same metres glided), and nothing else of the first ride's touched (the old files' own, `sameAsOld`
  // below, where git answers). Today's as shipped, against the first ride's written above.
  const HALVED_POD = ['V', 'BT', 'cap', 'reverseTop', 'turnFullAt', 'leanFrom', 'lookMax', 'lookStep', 'riseMax', 'fallMax', 'strikeSpark', 'strikeHurt', 'crashImpact', 'crashDrop', 'crashFrom'] as const;
  const DOUBLED_POD = ['strikeHull'] as const;
  const HALVED_TUNE = ['reverseBelow', 'hitLoss'] as const;
  const DOUBLED_TUNE = ['bridgeTime', 'bridgeRing', 'scrapeHull'] as const;
  const off: string[] = [];
  const pod = POD0 as unknown as Record<string, number>;
  const tune = TUNE0 as unknown as Record<string, number>;
  const engines = ENGINE0 as unknown as Record<string, number>;
  for (const k of HALVED_POD) if (Math.abs(pod[k] - FIRST_RIDE_POD[k]! / 2) > 1e-9) off.push(`pod.${k} ${pod[k]} is not half of ${FIRST_RIDE_POD[k]}`);
  for (const k of DOUBLED_POD) if (Math.abs(pod[k] - FIRST_RIDE_POD[k]! * 2) > 1e-9) off.push(`pod.${k} ${pod[k]} is not twice ${FIRST_RIDE_POD[k]}`);
  for (const k of HALVED_TUNE) if (Math.abs(tune[k] - FIRST_RIDE_TUNE[k] / 2) > 1e-9) off.push(`RACE_TUNE.${k} ${tune[k]} is not half of ${FIRST_RIDE_TUNE[k]}`);
  for (const k of DOUBLED_TUNE) if (Math.abs(tune[k] - FIRST_RIDE_TUNE[k] * 2) > 1e-9) off.push(`RACE_TUNE.${k} ${tune[k]} is not twice ${FIRST_RIDE_TUNE[k]}`);
  for (const k of Object.keys(FIRST_RIDE_ENGINES) as (keyof typeof FIRST_RIDE_ENGINES)[]) if (Math.abs(engines[k] - FIRST_RIDE_ENGINES[k] * 2) > 1e-12) off.push(`ENGINE_TUNE.${k} ${engines[k]} is not twice ${FIRST_RIDE_ENGINES[k]}`);
  const listed = new Set<string>([...HALVED_POD, ...DOUBLED_POD, ...HALVED_TUNE, ...DOUBLED_TUNE, ...Object.keys(FIRST_RIDE_ENGINES)]);
  for (const k of [...Object.keys(FIRST_RIDE_POD), ...Object.keys(FIRST_RIDE_TUNE)]) if (!listed.has(k)) off.push(`${k} moved and is named neither halved nor doubled`);
  if (tune.ceiling !== 600 || Math.abs(BIKE_SCALE - 350 / 600) > 1e-12 || CEILING_OWNER !== 600 || CEILING_LEAST !== 200) off.push(`the ceilings: ${tune.ceiling}, ${BIKE_SCALE}, ${CEILING_OWNER}, ${CEILING_LEAST}`);
  ok(off.length === 0, `5: every speed the wave moved is half the first ride's (${HALVED_POD.join(', ')}; ${HALVED_TUNE.join(', ')}; the ceilings 600 and 350 km/h), every cost a m/s twice it (${DOUBLED_POD.join(', ')}, scrapeHull, ${Object.keys(FIRST_RIDE_ENGINES).join(', ')}), the bridge's span and ring twice theirs, and nothing else named${off.length ? ` -- ${off.join('; ')}` : ''}`);
}

{
  // A course with everything the height rule meets: rolling ground, a crest, a kicker, a crevasse the bridge spans and a
  // hollow it does not, in a heightfield-free stand-in (the hull never meets the ground but by the drive's own reading).
  const course: G = (x, z) => 2 * Math.sin(x / 37) + 3 * Math.sin(z / 91) + kicker(x, z - 400) + (z > 1500 && z < 1540 ? -12 : 0) + hollow(x, z - 1400);
  const Old = await preWaveDrive();
  if (Old) ok(Old.RaceDrive !== RaceDrive && typeof Old.RaceDrive === 'function', `5: the drive as it stood at the wave's start is read out of git (${PRE_WAVE.slice(0, 7)}) and loaded beside today's`);
  else note(`5: git could not hand over the drive as it stood at ${PRE_WAVE.slice(0, 7)}: today's firm hold is held to that drive's trace hash alone`);
  const realRun = async (Drive: typeof RaceDrive, kind: 'pod' | 'bike', levels: 'max' | 'stock', fps: number): Promise<number[]> => {
    const physics = await Physics.create();
    const bounds: VehicleSpec['bounds'] = kind === 'pod' ? { min: [-3, 0, -6], max: [3, 2.5, 6] } : { min: [-0.45, 0, -2.05], max: [0.45, 1.16, 2.05] };
    const spec = specFor(kind === 'pod' ? 'podracer' : 'speederbike', kind, kind, bounds);
    spec.hull = 'box';
    spec.raceBox = kind === 'pod' ? [7, 3, 15] : [1, 1.3, 3.6];
    const v = new Vehicle(spec, new THREE.Group(), physics, new THREE.Scene(), 0, course(0, 0) + spec.hover + 0.2, 0, 0);
    physics.stepOnce();
    const reader: RaceGround = { near: (x, z) => course(x, z), far: (i, j) => course(i * 16, j * 16), farStep: 16, farX: () => 0, farZ: () => 0, water: () => -Infinity };
    const race = new Drive(kind, { ground: reader });
    v.race = race;
    let seed = 7;
    race.rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    race.setLevels(levels, v);
    if (race.modes) race.setMode(v, 'racing');
    const input: DriveInput = { throttle: 1, steer: 0, heading: null, boost: false, hop: false, up: false, down: false, vertical: 0 };
    const trace: number[] = [];
    const dt = 1 / fps;
    for (let i = 0; i < 12 * fps; i++) {
      input.heading = Math.sin(i / (fps * 2)) * 0.3;
      input.boost = i > 4 * fps;
      v.update(dt, physics, input, course);
      physics.step(dt);
      const t = v.body.translation();
      const q = v.body.rotation();
      const l = v.body.linvel();
      trace.push(t.x, t.y, t.z, q.x, q.y, q.z, q.w, l.x, l.y, l.z, race.h, race.vy, race.low, race.line, v.hp, v.justHit, v.destroyed ? 1 : 0);
    }
    return trace;
  };
  const traceText = (t: number[]) => t.map((x) => (Object.is(x, -0) ? '-0' : String(x))).join(',');
  const all: number[] = [];
  let firmAgrees = true;
  const said: string[] = [];
  asFirstRide();
  if (Old) {
    const off = sameAsOld(Old);
    ok(off.length === 0, `5: the first ride's numbers written here are the old files' own, every rule and both bases${off.length ? ` -- ${off.join('; ')}` : ''}`);
  }
  for (const kind of ['pod', 'bike'] as const) {
    for (const levels of ['max', 'stock'] as const) {
      for (const fps of RATES) {
        const now = await realRun(RaceDrive, kind, levels, fps);
        all.push(...now);
        if (Old) {
          const before = await realRun(Old.RaceDrive, kind, levels, fps);
          let differ = 0;
          for (let i = 0; i < now.length; i++) if (!Object.is(now[i], before[i])) differ++;
          if (differ || now.length !== before.length) firmAgrees = false;
          said.push(`${kind} ${levels} ${fps} fps: ${now.length} numbers, ${differ} differ`);
        }
      }
    }
  }
  const print = fnv32(traceText(all));
  if (Old) ok(firmAgrees, `5: today's drive with hold 'firm' and the first ride's numbers drives the course exactly as the drive at the wave's start, by Object.is (${said.join('; ')})`);
  ok(print === PRE_WAVE_TRACE, `5: and its trace is the one written down here (${print}, written ${PRE_WAVE_TRACE})`);
  // The controls: the same course with the hold loose, and firm with its fall a hair off, part from it at once.
  const firstPod = await realRun(RaceDrive, 'pod', 'max', 60);
  tuneRace({ hold: 'loose' });
  const loose = await realRun(RaceDrive, 'pod', 'max', 60);
  tuneRace({ hold: 'firm' });
  RACE_BASE.podracer.fall = 299;
  rebuildBikeBase();
  tuneRace({});
  const nudged = await realRun(RaceDrive, 'pod', 'max', 60);
  const parts = (a: number[], b: number[]) => a.filter((n, i) => !Object.is(n, b[i])).length;
  ok(parts(loose, firstPod) > 0 && parts(nudged, firstPod) > 0, `5: (the controls: the loose hold parts from that trace in ${parts(loose, firstPod)} numbers and the firm fall a hair lighter in ${parts(nudged, firstPod)}: the comparison sees a change)`);
  restore();
}

// =============================================================================================================
// 6: a rise ahead is climbed, not struck
// =============================================================================================================
// Ramps of 30 to 44 degrees, 10 to 60 m high, at each kind's full plain top and a stock pod's: climbed with nothing met
// at all (no strike past `strikeSpark`, no cut by the climbing judge, no face, no crash) at every rate, as the firm hold
// climbs them. The loose hold rises as the firm rule rises, so the climbing judge's reckoning of what the hull can
// rise to holds. The control: a hull that rises at no more than 30 m/s (`riseMax`) meets the same ramps.
const rampOf = (deg: number, height: number): G => {
  const t = Math.tan((deg * Math.PI) / 180);
  const len = height / t;
  return (_x, z) => (z <= 600 ? 0 : z <= 600 + len ? (z - 600) * t : height);
};
const RAMPS: [number, number][] = [
  [30, 20],
  [40, 10],
  [40, 20],
  [44, 30],
  [30, 60],
];
/** What a run over `ground` met, each hit by kind and the closing or the speed lost (m/s). */
function metOver(kind: 'pod' | 'bike', levels: 'max' | 'stock', ground: G, fps: number, seconds = 10): { met: string[]; lifts: number } {
  const run = runOver(kind, levels, ground);
  const race = run.race;
  let seen = race.lastHit.at;
  const met: string[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    run.frame(1 / fps);
    if (race.lastHit.at !== seen) {
      met.push(`${race.lastHit.kind} ${r2(race.lastHit.loss)}`);
      seen = race.lastHit.at;
    }
  }
  return { met, lifts: race.lifts };
}
for (const [kind, levels] of [
  ['pod', 'max'],
  ['pod', 'stock'],
  ['bike', 'max'],
] as const) {
  const worst: string[] = [];
  for (const [deg, height] of RAMPS) for (const fps of RATES) for (const met of metOver(kind, levels, rampOf(deg, height), fps).met) worst.push(`${deg}/${height} at ${fps}: ${met}`);
  ok(worst.length === 0, `6: a ${levels === 'max' ? 'full' : 'stock'} ${kind} at its plain top climbs ramps of ${RAMPS.map(([d, h]) => `${d} degrees ${h} m`).join(', ')} at ${RATES.join(', ')} fps with nothing met${worst.length ? ` -- ${worst.join('; ')}` : ''}`);
}
{
  tuneRace({ hold: 'firm' });
  let firmMet = 0;
  for (const [deg, height] of RAMPS) for (const fps of RATES) firmMet += metOver('pod', 'max', rampOf(deg, height), fps).met.length;
  restore();
  RACE_BASE.podracer.riseMax = 30;
  rebuildBikeBase();
  tuneRace({});
  let slow = 0;
  for (const [deg, height] of RAMPS) for (const fps of RATES) if (metOver('pod', 'max', rampOf(deg, height), fps).met.length) slow++;
  restore();
  ok(firmMet === 0 && slow > RAMPS.length, `6: (the firm hold climbs them all with nothing met too; the control, rising at no more than 30 m/s, meets ${slow} of the ${RAMPS.length * RATES.length}: the check sees a hull that cannot climb)`);
}

// =============================================================================================================
// 7: the foot of a descent is ridden, not sunk into
// =============================================================================================================
// A descent of 10 or 20 degrees, entered on a gentle bend so nothing is thrown off its top, levelling out at its foot
// at once or over a bend of 50 to 150 m: the hull never meets the ground there (the strike sweep lifts it out of
// nothing), at every rate. The loose hold's rate for its rise and settle is the line's own fall as it falls now, which
// stops with the line. The control: fed instead the rate the ground under it has fallen at over the last tenth of a
// second (which the hold keeps only for what the ground gave it), a hull is still taken down at the descent's speed
// after the ground has levelled, and sinks into the foot.
const footOf = (deg: number, r: number): G => {
  const th = (deg * Math.PI) / 180;
  const t = Math.tan(th);
  const bend = 3000;
  const d1 = 300 + bend * Math.sin(th);
  const y1 = -(bend - bend * Math.cos(th));
  const z1 = d1 + 300;
  const yFoot = y1 - 300 * t;
  const zc = z1 + r * Math.sin(th);
  const yc = yFoot - (r - r * Math.cos(th));
  return (_x, z) =>
    z <= 300 ? 0 : z <= d1 ? -(bend - Math.sqrt(bend * bend - (z - 300) * (z - 300))) : z <= z1 ? y1 - (z - d1) * t : z <= zc ? yc + r - Math.sqrt(Math.max(0, r * r - (z - zc) * (z - zc))) : yc;
};
const FEET: [number, number][] = [
  [10, 0],
  [10, 50],
  [20, 0],
  [20, 100],
  [20, 150],
];
function liftsOver(kind: 'pod' | 'bike', ground: G, fps: number, pastFed: boolean): number {
  const run = runOver(kind, 'max', ground);
  // (The control's hold: its rate for the rise and the settle taken from the ground behind it, `rateFed`.)
  if (pastFed) (run.race as unknown as { looseRate: () => void }).looseRate = function (this: { looseLine: number; rateFed: number }) {
    this.looseLine = this.rateFed;
  };
  for (let i = 0; i < 14 * fps; i++) run.frame(1 / fps);
  return run.race.lifts;
}
for (const kind of ['pod', 'bike'] as const) {
  const met: string[] = [];
  for (const [deg, r] of FEET) for (const fps of RATES) {
    const n = liftsOver(kind, footOf(deg, r), fps, false);
    if (n) met.push(`${deg} degrees, foot ${r} m, ${fps} fps: ${n}`);
  }
  ok(met.length === 0, `7: a ${kind} at its full plain top down descents of 10 and 20 degrees to a foot sharp or over 50 to 150 m never meets the ground at the foot at ${RATES.join(', ')} fps${met.length ? ` -- ${met.join('; ')}` : ''}`);
}
{
  let sunk = 0;
  for (const [deg, r] of FEET) for (const fps of RATES) if (liftsOver('pod', footOf(deg, r), fps, true)) sunk++;
  ok(sunk >= FEET.length, `7: (the control: fed the rate the ground under it fell at a tenth of a second ago, the pod meets the ground at ${sunk} of the ${FEET.length * RATES.length} feet: the check sees a hull sunk into a foot)`);
}

// =============================================================================================================
// 8: a kerb, a bump or a pit's far rim is ridden over, never a launch
// =============================================================================================================
// A kerb 1 m and 3 m high, a bump 2 m high and 20 m long, and the far rim of a pit 150 m wide and 6 m deep (wider than
// the bridge, so the hull carries into it), at each kind's full plain top: once its middle is past the step, the hull
// never stands over its line by more than the step's height and the pod's band (3 m) over it. What the ground gave it it
// keeps, but a step's whole height in a moment is read over the look behind as tens of metres a second, which the hold
// takes up no faster than `looseFeed`. The control: taking it up at once (`looseFeed` 1000, the knob's most) throws the
// hull past that over the 3 m kerb, the bump and the far rim.
const STEPS: [string, G, number, number][] = [
  ['a 1 m kerb', (_x, z) => (z > 600 ? 1 : 0), 600, 1],
  ['a 3 m kerb', (_x, z) => (z > 600 ? 3 : 0), 600, 3],
  ['a 2 m bump 20 m long', (_x, z) => (z > 600 && z < 620 ? 2 : 0), 620, 2],
  ["a 150 x 6 m pit's far rim", (_x, z) => (z > 600 && z < 750 ? -6 : 0), 750, 6],
];
const STEP_BAND = RACE_BASE.podracer.band;
function overAfter(kind: 'pod' | 'bike', ground: G, at: number, fps: number): number {
  const run = runOver(kind, 'max', ground);
  const b = run.vehicle.spec.bounds;
  const half = Math.abs(b.max[2] - b.min[2]) / 2;
  let most = 0;
  for (let i = 0; i < 10 * fps; i++) {
    run.frame(1 / fps);
    if (run.race.planned && bodyZ(run) > at + half) most = Math.max(most, run.race.overLine);
  }
  return most;
}
for (const kind of ['pod', 'bike'] as const) {
  for (const [name, ground, at, height] of STEPS) {
    const most = RATES.map((fps) => overAfter(kind, ground, at, fps));
    ok(most.every((m) => m <= height + STEP_BAND), `8: a ${kind} at its full plain top over ${name} stands at most ${most.map(r2).join(', ')} m over its line once past it at ${RATES.join(', ')} fps, never more than the step and a band (${height + STEP_BAND} m)`);
  }
}
{
  tuneRace({ looseFeed: 1000 });
  const thrown: string[] = [];
  for (const [name, ground, at, height] of STEPS) {
    const most = Math.max(...RATES.map((fps) => overAfter('pod', ground, at, fps)));
    if (most > height + STEP_BAND) thrown.push(`${name} ${r2(most)} m`);
  }
  restore();
  ok(thrown.length >= 3, `8: (the control: taking a step's rise up at once throws the pod past it over ${thrown.join(', ')}: the check sees a launch)`);
}

// =============================================================================================================
// 9: a descent entered over a crest is jumped first, then held close
// =============================================================================================================
// Flat ground, then a crest of 150 m radius (and 300 m) into a long descent of 10 degrees (and 15): the curve of the
// crest asks more than gravity of a hull at speed, so it leaves the ground there and flies, never under the parabola of
// the world's gravity from where it left its band, and comes down onto the descent; from then on the strong downhill
// holds it within its band to the descent's end. (Which is what the owner's descent is under the loose hold where the
// slope begins over a crest: a jump, not a hold. A descent entered gently is test 3's, held close all the way.) The
// control: held by a twentieth of gravity, it never comes back down to the descent at all.
const crestInto = (deg: number, r: number): G => {
  const th = (deg * Math.PI) / 180;
  const d1 = 400 + r * Math.sin(th);
  const y1 = -(r - r * Math.cos(th));
  return (_x, z) => (z <= 400 ? 0 : z <= d1 ? -(r - Math.sqrt(r * r - (z - 400) * (z - 400))) : y1 - (z - d1) * Math.tan(th));
};
interface CrestRun {
  left: boolean;
  underThrow: number;
  landedAt: number;
  outAfter: boolean;
}
function overCrest(levels: 'max' | 'stock', ground: G, fps: number): CrestRun {
  tuneRace({ airNose: 0 });
  const run = runOver('pod', levels, ground);
  const race = run.race;
  const g = RACE_TUNE.looseFall;
  let y0 = Number.NaN;
  let vy0 = 0;
  let s0 = 0;
  let underThrow = 0;
  let landedAt = Number.NaN;
  let outAfter = false;
  for (let i = 0; i < 20 * fps; i++) {
    run.frame(1 / fps);
    if (race.planned === 0) continue;
    const z = bodyZ(run);
    if (z > 3000) break;
    const over = race.overLine;
    if (Number.isNaN(y0)) {
      if (z > 400 && over > race.handling.band) {
        y0 = bodyY(run);
        vy0 = race.vy;
        s0 = run.steps();
      }
      continue;
    }
    if (Number.isNaN(landedAt)) {
      const t = (run.steps() - s0) * FIXED;
      underThrow = Math.max(underThrow, y0 + vy0 * t - 0.5 * g * t * t - bodyY(run));
      if (over <= race.handling.band) landedAt = z;
      continue;
    }
    if (over > race.handling.band) outAfter = true;
  }
  restore();
  return { left: !Number.isNaN(y0), underThrow, landedAt, outAfter };
}
for (const [deg, r] of [
  [10, 150],
  [15, 300],
] as const) {
  for (const levels of ['max', 'stock'] as const) {
    for (const fps of RATES) {
      const c = overCrest(levels, crestInto(deg, r), fps);
      ok(c.left && c.underThrow < 0.01 && Number.isFinite(c.landedAt) && !c.outAfter, `9: a ${levels === 'max' ? 'full' : 'stock'} pod over a crest of ${r} m into a ${deg}-degree descent at ${fps} fps leaves the ground there, never under a throw at gravity (${r3(Math.max(0, c.underThrow))} m), comes down onto the descent ${r2(c.landedAt - 400)} m past the crest and is held within its band from there to its end`);
    }
  }
}
{
  tuneRace({ looseFall: 1, looseGrip: 1 });
  const c = overCrest('max', crestInto(10, 150), 60);
  ok(!Number.isFinite(c.landedAt) || c.outAfter, `9: (the control: held by a twentieth of gravity it ${Number.isFinite(c.landedAt) ? 'leaves its band again on the way down' : 'never comes back down to the descent'}: the check sees a hull that is not held)`);
}

restore();
console.log(`\nraceHold: ${checks} checks passed`);
