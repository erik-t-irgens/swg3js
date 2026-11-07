// The race drawer's third wave: race walls (`src/race/raceWalls.ts`, the drive's own `subStep`, `wallHit`, `clipRays`,
// `clipWalk`, `capWalk` and `aheadAt`'s clip in `src/vehicles/raceDrive.ts`, the run's hand-over in `src/race/raceRun.ts`).
// The reader and its limits; an arc's samples on its circle; the real drive (a real Vehicle on a real physics world) against a
// straight wall and an arc: a glancing touch a scrape that keeps the speed along the wall, a square hit a crash, a hull over a
// wall's top and one under a raised wall passing, a leaning wall met where its slanted face is and passed under where it is
// not, a hull from either side stopped, the same wall at 20, 60 and 144 frames a second stopping it at the same place; who
// meets a wall ('run', 'racing', 'off', the hand-over); a cliff beyond a wall moving the hull's height not at all; the steep
// cap; and the day one: the drive with no walls and the cap at 90 is 6e97c21's to the bit, and a track with no walls reads,
// hashes and writes as at 6e97c21. Then `raceAllocOwn.ts walls` in twelve processes at once.
//
// Run: node tools/swg/tests/raceWalls.test.ts
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { Physics } from '../../../src/core/physics.ts';
import { Vehicle, specFor, type DriveInput, type VehicleSpec } from '../../../src/vehicles/vehicle.ts';
import { RaceDrive, WALL_GAP, type RaceGround } from '../../../src/vehicles/raceDrive.ts';
import { RACE_BASE, RACE_TUNE, tuneRace } from '../../../src/vehicles/raceTune.ts';
import { COURSE_TUNE } from '../../../src/race/courseTune.ts';
import { buildWallSet, edgeMiddle, edgeSamples, radiusThrough, readWalls, wallCross, wallRay, WALL_CHUNK, type RaceWall } from '../../../src/race/raceWalls.ts';
import { readTrack, readTrackFile, trackFileText, trackHash, WALLS_IN_SPACE, type TrackDef } from '../../../src/race/trackFile.ts';
import { handRun, letGoRun, type RaceRun } from '../../../src/race/raceRun.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../../..');
const SRC = resolve(REPO, 'src');
/** The commit this wave started from (W2's carve, also main). */
const PRE_WAVE = '6e97c21';
type G = (x: number, z: number) => number;
const fnv32 = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};
const show = (rel: string): string | null => {
  try {
    return execFileSync('git', ['show', `${PRE_WAVE}:${rel}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
};
/** Files of `PRE_WAVE` loaded from a scratch folder, their other relative imports pointed at today's tree; null where git cannot answer. */
async function preWave<T>(files: Record<string, string>, entry: string): Promise<T | null> {
  const texts: Record<string, string> = {};
  for (const [name, rel] of Object.entries(files)) {
    const t = show(rel);
    if (!t) return null;
    texts[name] = t;
  }
  const dir = mkdtempSync(join(tmpdir(), 'racewalls-prewave-'));
  try {
    const ours = new Set(Object.keys(files).map((n) => `./${n}.ts`));
    for (const [name, text] of Object.entries(texts)) {
      const at = resolve(REPO, files[name], '..');
      let t = text.replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => (ours.has(p) ? `from '${p}'` : `from '${pathToFileURL(resolve(at, p)).href}'`));
      t = t.replace(/from 'three'/g, `from '${import.meta.resolve('three')}'`);
      writeFileSync(join(dir, `${name}.ts`), t);
    }
    return (await import(pathToFileURL(join(dir, `${entry}.ts`)).href)) as T;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ================================================================ 1. the reader and the file

const L = { reach: 100000, height: 20000 };
const wall = (o: Partial<RaceWall> = {}): RaceWall => ({ name: 'W', high: 4, lean: 0, points: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 40 }], ...o });
{
  const unknown: string[] = [];
  const w = readWalls([{ ...wall(), extra: 1, points: [{ x: 0, y: 1, z: 0, r: 30, q: 2 }, { x: 0, y: 1, z: 40 }] }], unknown, 't.walls', L.reach, L.height);
  ok(typeof w !== 'string' && w[0].points[0].r === 30 && unknown.join() === 't.walls[0].extra,t.walls[0].points[0].q', `1: a wall reads with its arc, and the fields this build does not read are named (${unknown.join(', ')})`);
  const refused: [unknown, RegExp][] = [
    [[wall({ points: [{ x: 0, y: 0, z: 0 }] })], /2 to 200 points/],
    [[wall({ lean: 61 })], /lean is 60/],
    [[wall({ high: 0.2 })], /high is 0\.5 to 50/],
    [[wall({ high: 51 })], /high is 0\.5 to 50/],
    [[wall({ name: '' })], /name/],
    [[wall({ points: [{ x: 0, y: 0, z: 0, r: 19.9 }, { x: 0, y: 0, z: 40 }] })], /at least half its chord \(20\.00 m\)/],
    [[wall({ points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 40, r: 30 }] })], /names no edge/],
    [[wall({ points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0.2 }] })], /0\.5 to 4000 m long/],
    [new Array(65).fill(wall()), /at most 64/],
  ];
  for (const [v, why] of refused) {
    const r = readWalls(v, [], 't.walls', L.reach, L.height);
    ok(typeof r === 'string' && why.test(r), `1: refused in words: ${r}`);
  }
  const at20 = readWalls([wall({ points: [{ x: 0, y: 0, z: 0, r: -20 }, { x: 0, y: 0, z: 40 }] })], [], 't.walls', L.reach, L.height);
  ok(typeof at20 !== 'string', "1: a radius of exactly half the chord (a half circle) reads, either way");
}
const baseTrack = { id: 'tt', name: 'TEST walls', kind: 'circuit', laps: 2, for: ['podracer'], clear: 4, grid: { x: 0, y: 1, z: -20, q: [1, 0, 0, 0] }, gates: [{ x: 0, y: 2, z: 0, q: [1, 0, 0, 0], w: 24, h: 12 }, { x: 0, y: 2, z: 300, q: [1, 0, 0, 0], w: 24, h: 12 }] };
const fileOf = (tracks: unknown[]) => JSON.stringify({ version: 1, world: 'dantooine', frame: 'raw', tracks });
{
  const read = readTrackFile(fileOf([{ ...baseTrack, walls: [wall({ points: [{ x: 10, y: 1.5, z: 0, r: 40 }, { x: 10, y: 2, z: 60 }, { x: 14, y: 2, z: 120 }] })] }]), 'dantooine', 'ground');
  const t = read.tracks[0];
  ok(read.problem === null && t?.walls?.length === 1, '1: a track carries its walls');
  const text = trackFileText('dantooine', 'raw', read.tracks);
  const again = readTrackFile(text, 'dantooine', 'ground');
  ok(trackFileText('dantooine', 'raw', again.tracks) === text && JSON.stringify(again.tracks) === JSON.stringify(read.tracks), '1: written and read again, byte for byte');
  ok(/"walls": \[\n {8}\{ "name": "W", "high": 4, "lean": 0, "points": \[\n {12}\{ "x": 10, "y": 1\.5, "z": 0, "r": 40 \},\n/.test(text), '1: the walls are written after the gates, a wall a line and a point a line');
  const plain = readTrack({ ...baseTrack }) as TrackDef;
  const withNone = readTrack({ ...baseTrack, walls: [] }) as TrackDef;
  ok(!('walls' in withNone) && trackHash(withNone) === trackHash(plain), '1: an empty walls list is none: the track hashes as one that never had walls');
  ok(trackHash(t) !== trackHash(plain) && trackHash(t).includes('"walls"'), "1: a wall is in its track's hash, behind its word");
  ok(readTrack({ ...baseTrack, walls: [wall()] }, [], 2, 'space') === WALLS_IN_SPACE, `1: a space zone's track refuses walls (${WALLS_IN_SPACE})`);
}

// ================================================================ 2. arcs

{
  let worst = 0;
  let bulgeRight = true;
  let inverse = 0;
  const g = { x: 0, z: 0 };
  for (let k = 0; k < 40; k++) {
    const ax = Math.sin(k * 1.3) * 300;
    const az = Math.cos(k * 0.7) * 300;
    const bx = ax + 20 + 90 * Math.abs(Math.sin(k));
    const bz = az + 60 * Math.cos(k * 2.1);
    const c = Math.hypot(bx - ax, bz - az);
    const r = (k & 1 ? 1 : -1) * (c / 2 + 2 + k * 3);
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    edgeSamples(ax, 3, az, bx, 7, bz, r, 2, false, xs, ys, zs);
    // The centre: from the chord's middle, against the bulge, by sqrt(R² - a²).
    const R = Math.abs(r);
    const a = c / 2;
    const s = r > 0 ? 1 : -1;
    const rx = (-(bz - az) / c) * s;
    const rz = ((bx - ax) / c) * s;
    const off = Math.sqrt(R * R - a * a);
    const cx = (ax + bx) / 2 - rx * off;
    const cz = (az + bz) / 2 - rz * off;
    for (let i = 0; i < xs.length; i++) worst = Math.max(worst, Math.abs(Math.hypot(xs[i] - cx, zs[i] - cz) - R));
    edgeMiddle(ax, az, bx, bz, r, g);
    // The middle stands to the chord's right in the game's frame (`-dz`, `dx`) for a positive radius.
    const side = (g.x - (ax + bx) / 2) * (-(bz - az) / c) + (g.z - (az + bz) / 2) * ((bx - ax) / c);
    if (Math.sign(side) !== s) bulgeRight = false;
    const back = radiusThrough(ax, az, bx, bz, g.x, g.z);
    inverse = Math.max(inverse, Math.abs((back ?? 0) - r));
    if (!(xs[0] === ax && zs[0] === az && xs[xs.length - 1] === bx && zs[zs.length - 1] === bz && ys[0] === 3 && ys[ys.length - 1] === 7)) worst = Infinity;
  }
  ok(worst < 1e-3, `2: every sample of forty arcs on its circle within a millimetre (worst ${worst.toExponential(2)} m), the ends exactly the points`);
  ok(bulgeRight, "2: a positive radius bulges to the edge's right as seen in the game, a negative one to its left");
  ok(inverse < 1e-6, `2: the radius through an arc's own middle is its radius again (worst ${inverse.toExponential(2)})`);
  ok(radiusThrough(0, 0, 0, 40, 0.05, 20) === undefined, '2: a middle dragged within a tenth of a metre of its chord is a straight edge');
}
{
  // The bucket index (the review round): one arced edge 3.9 km long, cut every 2 m; a box crossing it at its middle and a
  // ray toward it test only the runs about them, and find the crossing where it is.
  const R = 1600;
  const sag = R - Math.sqrt(R * R - 1500 * 1500);
  const long = buildWallSet([{ track: 'tt', walls: [wall({ high: 4, points: [{ x: 0, y: 0, z: 0, r: R }, { x: 0, y: 0, z: 3000 }] })] }], (x, z, out) => {
    out.x = x;
    out.z = z;
  }, 2)!;
  const q = wallCross();
  Object.assign(q, { ax: -sag + 20, az: 1500, bx: -sag - 20, bz: 1500, lowA: 0.5, lowB: 0.5, hh: 2.5, s: 0, c: 1, s2: 0, c2: 1, x0: -3, x1: 3, z0: -6, z1: 6 });
  long.nearX = q.ax;
  long.nearZ = q.az;
  long.nearR = 60;
  long.near();
  const met = long.crossBox(q);
  ok(long.n > 1500 && met && Math.abs(q.t - 17 / 40) < 0.01 && long.tested <= 8 * 4 * WALL_CHUNK, `2: a box crossing a wall of ${long.n} segments tests ${long.tested} of them (its runs of ${WALL_CHUNK} about it) and meets it at ${q.t.toFixed(4)} of its move (17/40)`);
  const r = wallRay();
  Object.assign(r, { ox: -sag + 20, oz: 1500, dx: -1, dz: 0, most: 100, lo: 0.5, hi: 3 });
  long.clipAhead(r);
  ok(Math.abs(r.d - 20) < 0.05, `2: and a ray toward it is clipped there (${r.d.toFixed(3)} m)`);
}

// ================================================================ 3. the real drive against walls

interface RideOpts {
  fps: number;
  walls?: RaceWall[] | null;
  /** Who is handed the walls: the drive itself (a run's), the world's deps (`racing`), or nobody. */
  via?: 'drive' | 'deps';
  mode?: 'run' | 'racing' | 'off';
  ground?: G;
  x?: number;
  z?: number;
  heading?: number;
  speed: number;
  seconds: number;
  each?: (race: RaceDrive, v: Vehicle) => void;
  /** The input moved before each step (the stick's heading). */
  steer?: (input: DriveInput, race: RaceDrive, v: Vehicle) => void;
}
const flat: G = () => 0;
const BOUNDS = { min: [-3, 0, -6], max: [3, 2.5, 6] } as VehicleSpec['bounds'];
/** A pod on a real physics world over `ground`, started at `speed` along `heading`, held at it by the throttle. Walls in the game's frame (`place` the identity). */
async function ride(o: RideOpts): Promise<{ race: RaceDrive; v: Vehicle }> {
  const ground = o.ground ?? flat;
  const physics = await Physics.create();
  const spec = specFor('podracer', 'pod', 'pod', BOUNDS);
  spec.hull = 'box';
  spec.raceBox = [7, 3, 15];
  const h0 = o.heading ?? 0;
  const v = new Vehicle(spec, new THREE.Group(), physics, new THREE.Scene(), o.x ?? 0, ground(o.x ?? 0, o.z ?? 0) + spec.hover + 0.2, o.z ?? 0, h0);
  v.body.setLinvel({ x: Math.sin(h0) * o.speed, y: 0, z: Math.cos(h0) * o.speed }, true);
  physics.stepOnce();
  const reader: RaceGround = { near: (x, z) => ground(x, z), far: (i, j) => ground(i * 16, j * 16), farStep: 16, farX: () => 0, farZ: () => 0, water: () => -Infinity };
  const set = o.walls ? buildWallSet([{ track: 'tt', walls: o.walls }], (x, z, out) => {
    out.x = x;
    out.z = z;
  }, COURSE_TUNE.arcStep) : null;
  const deps = { all: o.via === 'deps' ? set : null };
  const race = new RaceDrive('pod', { ground: reader, walls: deps });
  v.race = race;
  let seed = 7;
  race.rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  race.setLevels('max', v);
  if (o.via !== 'deps') race.walls = set;
  COURSE_TUNE.walls = o.mode ?? 'run';
  const input: DriveInput = { throttle: 0.6, steer: 0, heading: h0, boost: false, hop: false, up: false, down: false, vertical: 0 };
  const dt = 1 / o.fps;
  try {
    for (let i = 0; i < o.seconds * o.fps && !v.destroyed && v.hp > 0; i++) {
      o.steer?.(input, race, v);
      v.update(dt, physics, input, ground);
      physics.step(dt);
      o.each?.(race, v);
    }
  } finally {
    COURSE_TUNE.walls = 'run';
  }
  return { race, v };
}
/** The box's eight points' least signed distance to a straight line (from `a` to `b`, its right positive) now. */
function boxSide(race: RaceDrive, v: Vehicle, ax: number, az: number, bx: number, bz: number): number {
  const s = Math.sin(race.heading);
  const c = Math.cos(race.heading);
  const l = Math.hypot(bx - ax, bz - az);
  const nx = -(bz - az) / l;
  const nz = (bx - ax) / l;
  let least = Infinity;
  for (const lx of [-3, 0, 3]) {
    for (const lz of [-6, 0, 6]) {
      const px = v.pos.x + lx * c + lz * s;
      const pz = v.pos.z - lx * s + lz * c;
      least = Math.min(least, (px - ax) * nx + (pz - az) * nz);
    }
  }
  return least;
}

const RATES = [144, 60, 20] as const;
{
  // A square hit: a wall straight across the way at z 60, a pod at 80 m/s straight at it.
  const across = wall({ high: 4, points: [{ x: 30, y: -1, z: 60 }, { x: -30, y: -1, z: 60 }] });
  const places: number[] = [];
  const kinds: string[] = [];
  for (const fps of RATES) {
    let past = -Infinity;
    const { race, v } = await ride({ fps, walls: [across], speed: 80, seconds: 2, each: (r, vv) => (past = Math.max(past, vv.pos.z)) });
    places.push(race.lastWallZ);
    kinds.push(`${race.lastWallKind}/${race.lastHit.kind}`);
    ok(race.lastWallKind === 'crash' && race.lastHit.kind === 'crash' && (v.destroyed || v.hp <= 0), `3: at ${fps} fps a pod at 80 m/s square into a wall crashes (${race.lastWallKind}, hull ${v.hp})`);
    // (Within 0.1 m: the pod's own yaw settles a few hundredths of a degree differently at each rate, which turns its box's corners.)
    ok(Math.abs(race.lastWallZ - (60 - 6 - WALL_GAP)) < 0.1, `3: at ${fps} fps it is stopped where its nose meets the wall, less the gap (${race.lastWallZ.toFixed(3)} m, the wall at 60, its nose 6 m ahead of its middle)`);
  }
  ok(Math.max(...places) - Math.min(...places) < RACE_BASE.podracer.sweepStep, `3: the same wall at 144, 60 and 20 fps stops it at the same place within a sweep step (${places.map((p) => p.toFixed(3)).join(', ')}) and scores the same (${kinds.join(', ')})`);
  // Judged inside the plan's sub-steps: at 20 fps and 150 m/s a plan carries 7.5 m in two sub-steps (a sweep step is 4 m),
  // and a lip 1.5 m high (one the strike sweep pops a hull over) a third of a metre behind the wall is never read under
  // the hull: a wall met cuts its sub-step at the stop before the ground is read (tested once a frame, or after the
  // sweep, the sweep struck the lip and lifted the hull onto it). Three starting places, so the crossing falls in either
  // sub-step. A crash held to a scrape (`offCourse` 'stop'), so the plan runs on and its height is what it left.
  tuneRace({ offCourse: 'stop' });
  try {
    const behind: G = (_x, z) => (z >= 60.3 ? 1.5 : 0);
    let most = -Infinity;
    let met = 0;
    for (const z of [0, 2.5, 5]) {
      const { race } = await ride({ fps: 20, walls: [across], ground: behind, z, speed: 150, seconds: 1, each: (r) => r.lastWallKind && (most = Math.max(most, r.low)) });
      if (race.lastWallKind) met++;
    }
    const low = (await ride({ fps: 20, speed: 60, seconds: 0.5 })).race.low;
    ok(met === 3 && most < low + 0.3, `3: at 20 fps the plan stops at the wall: a lip right behind it never lifts the hull (its lowest point at most ${most.toFixed(2)} m, ${low.toFixed(2)} on the flat)`);
  } finally {
    tuneRace({ offCourse: 'crash' });
  }
  // From the other side: the same wall, the pod coming back along -z.
  const { race } = await ride({ fps: 60, walls: [across], z: 130, heading: Math.PI, speed: 80, seconds: 2 });
  ok(race.lastWallKind === 'crash' && Math.abs(race.lastWallZ - (60 + 6 + WALL_GAP)) < 0.02, `3: from its other side it is met the same, stopped at ${race.lastWallZ.toFixed(3)} m (two-sided)`);
}
{
  // A glancing touch: a wall closing on the pod's left at six degrees.
  const ax = 12;
  const az = 0;
  const bx = -12;
  const bz = 230;
  const glance = wall({ high: 4, points: [{ x: ax, y: -1, z: az }, { x: bx, y: -1, z: bz }] });
  const angle = Math.atan2(ax - bx, bz - az);
  for (const fps of RATES) {
    let least = Infinity;
    let before = NaN;
    let after = NaN;
    let hitAt = -1;
    let last = 0;
    const { race, v } = await ride({
      fps,
      walls: [glance],
      speed: 80,
      seconds: 2.2,
      each: (r, vv) => {
        least = Math.min(least, boxSide(r, vv, ax, az, bx, bz));
        if (r.lastWallAt !== last && hitAt < 0) {
          hitAt = r.lastWallAt;
          after = r.h;
        } else if (hitAt < 0) before = r.h;
        last = r.lastWallAt;
      },
    });
    ok(race.lastHit.kind === 'wall' && !v.destroyed && v.hp > 0, `3: at ${fps} fps a glancing touch at ${((angle * 180) / Math.PI).toFixed(1)}° is a scrape (${race.lastHit.kind}), and the pod goes on`);
    ok(Math.abs(after / before - Math.cos(angle)) < 0.01, `3: at ${fps} fps the speed along the wall is kept (${before.toFixed(2)} to ${after.toFixed(2)} m/s, the cosine ${Math.cos(angle).toFixed(4)})`);
    ok(least > -0.02, `3: at ${fps} fps no point of its box ever stands past the wall (the least ${least.toFixed(3)} m on its own side)`);
  }
}
// The hull's lowest point on flat ground, for the walls over and under it.
const low0 = (await ride({ fps: 60, speed: 60, seconds: 0.5 })).race.low;
{
  // Over the top: a wall whose top stands half a metre under the hull's lowest point; under: one raised over its top.
  const under = wall({ high: 1, points: [{ x: 30, y: low0 - 1.5, z: 60 }, { x: -30, y: low0 - 1.5, z: 60 }] });
  const over = wall({ high: 4, points: [{ x: 30, y: low0 + 3, z: 60 }, { x: -30, y: low0 + 3, z: 60 }] });
  for (const [w, what] of [[under, 'over a wall whose top stands under it'], [over, 'under a wall raised over its top']] as const) {
    let past = -Infinity;
    const { race } = await ride({ fps: 60, walls: [w], speed: 60, seconds: 2, each: (_r, vv) => (past = Math.max(past, vv.pos.z)) });
    ok(race.lastWallKind === '' && past > 100, `3: a pod passes ${what} (its lowest point ${low0.toFixed(2)} m; ${past.toFixed(0)} m along)`);
  }
}
{
  // A leaning wall along the way at x 10, leaning 60° over the pod (its right as drawn, the way +z, is -x): at its top its
  // face stands 10 - 4·tan 60 = 3.07 m out. Straight along at x 0 the pod's side (3 m) passes under it; drifting toward it
  // it is met where the slanted face is, not where its foot is.
  const lean = (deg: number) => wall({ high: 4, lean: deg, points: [{ x: 10, y: -0.5, z: -50 }, { x: 10, y: -0.5, z: 900 }] });
  const faceAt = (deg: number) => 10 - Math.min(4, low0 + 2.5 + 0.5) * Math.tan((deg * Math.PI) / 180);
  {
    const { race } = await ride({ fps: 60, walls: [lean(60)], speed: 60, seconds: 2 });
    ok(race.lastWallKind === '' && faceAt(60) > 3, `3: straight along under a wall leaning 60° over it (its face ${faceAt(60).toFixed(2)} m out at the pod's top) the pod passes`);
  }
  for (const deg of [60, 0]) {
    let first = NaN;
    let hd = NaN;
    // (Started 3 m over, so every point of its turned box starts clear of the face it drifts into.)
    const { race } = await ride({ fps: 60, walls: [lean(deg)], x: -3, heading: 0.12, speed: 60, seconds: 2, each: (r) => r.lastWallKind && Number.isNaN(first) && ((first = r.lastWallX), (hd = r.heading)) });
    // The pod's front left corner where it was first stopped: its middle plus 3 m across and 6 m along at its heading.
    const side = first + 3 * Math.cos(hd) + 6 * Math.sin(hd);
    ok(race.lastWallKind !== '' && Math.abs(side - faceAt(deg)) < 0.6, `3: drifting into a wall leaning ${deg}°, it is met where its slanted face is (${side.toFixed(2)} m, the face ${faceAt(deg).toFixed(2)} m)`);
  }
}
{
  // An arc across the way: met as a straight wall is, and stopped on its own side.
  const arc = wall({ high: 4, points: [{ x: 40, y: -1, z: 70, r: 60 }, { x: -40, y: -1, z: 70 }] });
  const { race } = await ride({ fps: 60, walls: [arc], speed: 80, seconds: 2 });
  ok(race.lastWallKind === 'crash' && race.lastWallZ < 70 - 6, `3: an arced wall across the way is met and the pod stopped on its own side (${race.lastWallZ.toFixed(2)} m)`);
}

// ---------------------------------------------------------------- 3b. the review round: the turn, the slide, the pose, the sweep
// (Crashes held to scrapes, `offCourse` 'stop', so the hull lives on against the wall and every frame of it is judged.)
tuneRace({ offCourse: 'stop' });
try {
  // A wall along the way at x 10; the pod drifts into it at 0.15 rad, then is steered hard into it (the stick's heading
  // 0.7): the turn is judged against the wall, so its nose never swings through, at any rate.
  const along = wall({ high: 4, points: [{ x: 10, y: -1, z: -50 }, { x: 10, y: -1, z: 400 }] });
  for (const fps of RATES) {
    let least = Infinity;
    let hit = false;
    const { race } = await ride({
      fps,
      walls: [along],
      heading: 0.15,
      speed: 60,
      seconds: 2.5,
      steer: (input, r) => {
        if (r.lastWallKind) hit = true;
        if (hit) input.heading = 0.7;
      },
      each: (r, vv) => (least = Math.min(least, boxSide(r, vv, 10, -50, 10, 400))),
    });
    ok(hit && race.heading < 0.5 && least > -0.02, `3b: at ${fps} fps a pod steered into a wall after a scrape never swings a point of its box through it (the least ${least.toFixed(3)} m on its own side, its heading held at ${race.heading.toFixed(3)} rad)`);
  }
  // Sliding along that wall into one across its end at z (the hit's nose plus 1.2 m): from three places along the way, so
  // the first touch falls early and late in a plan; the slide for the rest of a plan is judged too, so neither wall is passed.
  const th = 0.15;
  for (const fps of RATES) {
    let least = Infinity;
    for (const x0 of [0, -0.2, -0.4]) {
      const sHit = (10 - WALL_GAP - x0 - (3 * Math.cos(th) + 6 * Math.sin(th))) / Math.sin(th);
      const zB = sHit * Math.cos(th) + 6 * Math.cos(th) + 3 * Math.sin(th) + 1.2;
      const end = wall({ high: 4, points: [{ x: 10.5, y: -1, z: zB }, { x: -60, y: -1, z: zB }] });
      await ride({
        fps,
        walls: [along, end],
        x: x0,
        heading: th,
        speed: 60,
        seconds: 1.6,
        each: (r, vv) => (least = Math.min(least, boxSide(r, vv, 10, -50, 10, 400), boxSide(r, vv, 10.5, zB, -60, zB))),
      });
    }
    ok(least > -0.02, `3b: at ${fps} fps a pod sliding along one wall into another across its end passes neither (the least ${least.toFixed(3)} m on its own side, over three places)`);
  }
  // The pose's reads stop at the wall: a 30 m cliff just past the wall the pod grinds along (at 0.03 rad) neither rolls nor
  // lifts it, against the same run with no cliff; and under the firm hold square into a wall, it neither pitches nor lifts.
  const past: G = (x) => (x > 10.02 ? 30 : 0);
  const highest = async (fps: number, g: G, o: Partial<RideOpts> = {}) => {
    let most = -Infinity;
    await ride({ fps, walls: [along], ground: g, x: 5, heading: 0.03, speed: 60, seconds: 2, each: (r, vv) => vv.pos.x > 6 && (most = Math.max(most, r.low)), ...o });
    return most;
  };
  for (const fps of RATES) {
    const cliffed = await highest(fps, past);
    const plain = await highest(fps, flat);
    ok(Number.isFinite(plain) && Math.abs(cliffed - plain) < 0.02, `3b: at ${fps} fps a cliff just past the wall the pod grinds along lifts it not at all (its lowest point at most ${cliffed.toFixed(3)} m, ${plain.toFixed(3)} with no cliff)`);
  }
  tuneRace({ hold: 'firm' });
  try {
    // (Wide: held square into it, the pod's travel takes the slide's direction and runs it sideways along the wall.)
    const across = wall({ high: 4, points: [{ x: 400, y: -1, z: 60 }, { x: -400, y: -1, z: 60 }] });
    const beyond: G = (_x, z) => (z > 60.02 ? 30 : 0);
    for (const fps of RATES) {
      const at = async (g: G) => {
        let most = -Infinity;
        await ride({ fps, walls: [across], ground: g, speed: 40, seconds: 2.5, each: (r) => r.lastWallKind && (most = Math.max(most, r.low)) });
        return most;
      };
      const cliffed = await at(beyond);
      const plain = await at(flat);
      ok(Number.isFinite(plain) && Math.abs(cliffed - plain) < 0.02, `3b: at ${fps} fps under the firm hold, held square against a wall with a cliff just past it, the pod is pitched and lifted not at all (${cliffed.toFixed(3)} against ${plain.toFixed(3)} m)`);
    }
  } finally {
    tuneRace({ hold: 'loose' });
  }
  // The strike sweep of the sub-step a wall is met in reads the ground along the way the hull came, never the travel the
  // wall turned: a block 8 m high on the hull's right, short of every read the hull makes on its way (its right side's line,
  // 0.9 m clear, past the pose's side read) and of everywhere its slide along the wall can reach (0.3 m clear of its rear
  // right corner where it stops), is never struck. 150 m/s at 25° into a wall at x 12 (its plan 7.5 m at 20 fps), from three
  // places along the way so the wall is met early and late in a plan.
  const t25 = (25 * Math.PI) / 180;
  const tn = Math.tan(t25);
  const into = wall({ high: 6, points: [{ x: 12, y: -1, z: -60 }, { x: 12, y: -1, z: 400 }] });
  const hcz = ((12 - WALL_GAP - (3 * Math.cos(t25) + 6 * Math.sin(t25))) / Math.sin(t25)) * Math.cos(t25);
  // The rear right corner's offset from the middle at 25°: x -3 cos - 6 sin, z 3 sin - 6 cos.
  const rrx = -3 * Math.cos(t25) - 6 * Math.sin(t25);
  const rrz = 3 * Math.sin(t25) - 6 * Math.cos(t25);
  const block: G = (x, z) => (x < (z - rrz) * tn + rrx - 0.9 && x < hcz * tn + rrx - 0.3 && z > -40 ? 8 : 0);
  for (const fps of RATES) {
    let worst = 0;
    for (const back of [0, 2.5, 5]) {
      const run = async (g: G) => {
        let most = -Infinity;
        const { race, v } = await ride({ fps, walls: [into], ground: g, x: -back * Math.sin(t25), z: -back * Math.cos(t25), heading: t25, speed: 150, seconds: 0.4, each: (r) => (most = Math.max(most, r.low)) });
        return { most, x: v.pos.x, z: v.pos.z, kind: race.lastHit.kind };
      };
      const a = await run(block);
      const b = await run(flat);
      worst = Math.max(worst, Math.abs(a.most - b.most), Math.abs(a.x - b.x), Math.abs(a.z - b.z), a.kind === b.kind ? 0 : Infinity);
    }
    ok(worst < 1e-6, `3b: at ${fps} fps the sweep of the sub-step a wall turned reads the ground the hull came over: a block beside its path changes nothing (worst ${worst.toExponential(2)})`);
  }
} finally {
  tuneRace({ offCourse: 'crash' });
}

// ================================================================ 4. who meets a wall

{
  const across = wall({ high: 4, points: [{ x: 30, y: -1, z: 60 }, { x: -30, y: -1, z: 60 }] });
  const met = async (o: Partial<RideOpts>) => (await ride({ fps: 60, walls: [across], speed: 60, seconds: 2, ...o })).race.lastWallKind !== '';
  ok(await met({ via: 'drive', mode: 'run' }), "4: 'run': a hull handed its run's walls meets them");
  ok(!(await met({ via: 'deps', mode: 'run' })), "4: 'run': a hull in no run passes the world's walls");
  ok(await met({ via: 'deps', mode: 'racing' }), "4: 'racing': any race-driven hull meets every track's walls on the world");
  ok(!(await met({ via: 'drive', mode: 'off' })), "4: 'off': nobody meets them");
  // The run's hand-over: its watch and its walls together, at the start and at a put-back's fresh spawn, and let go together.
  const set = buildWallSet([{ track: 'tt', walls: [across] }], (x, z, out) => {
    out.x = x;
    out.z = z;
  }, 2);
  const run = { walls: set, cross() {} } as unknown as RaceRun;
  const a = new RaceDrive('pod', { ground: null });
  handRun(run, a);
  ok(a.walls === set && a.watch === run, '4: handRun hands the hull its run and its walls');
  letGoRun(a);
  ok(a.walls === null && a.watch === null, '4: letGoRun takes both back');
  const b = new RaceDrive('pod', { ground: null });
  handRun(run, b);
  ok(b.walls === set, "4: a put-back's fresh spawn is handed them again");
  // The game's own hand-overs, pinned as text (every behaviour above makes its own).
  const main = readFileSync(resolve(SRC, 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/run\.walls = this\.raceWallsOf\(\[t\]\);\n\s*handRun\(run, race\);/.test(main), "4: the run's start makes its walls and hands them with its watch (main.ts)");
  ok(/if \(v\.race\) handRun\(run, v\.race\);/.test(main), "4: a put-back hands the fresh hull the run and its walls (main.ts)");
  ok((main.match(/letGoRun\(/g) ?? []).length === 4 && !/\.watch = (run|null)/.test(main), '4: a wreck, the finish, an end and a clear let both go, and nothing sets a watch alone (main.ts)');
  ok(/RACE_CLOCK\.live = simulate;\n[^\n]*\n\s*this\.syncRaceWalls\(\);/.test(main), "4: the world's 'racing' walls are synced before the hulls step (main.ts)");
}

// ================================================================ 5. the look-ahead stops at a wall; the steep cap

{
  // Flat to z 100, a cliff 30 m high beyond; a wall straight across at z 95.
  const cliff: G = (_x, z) => (z >= 100 ? 30 : 0);
  const across = wall({ high: 4, points: [{ x: 60, y: -1, z: 95 }, { x: -60, y: -1, z: 95 }] });
  const lineBefore = async (walls: RaceWall[] | null) => {
    let most = -Infinity;
    await ride({ fps: 60, walls, ground: cliff, speed: 60, seconds: 1.6, each: (r, vv) => vv.pos.z > 20 && vv.pos.z < 82 && (most = Math.max(most, r.line, vv.pos.y - 3)) });
    return most;
  };
  const withWall = await lineBefore([across]);
  const without = await lineBefore(null);
  ok(withWall < 0.5, `5: a cliff 30 m high beyond a wall the pod meets moves its line and its height not at all before it (the most ${withWall.toFixed(2)} m)`);
  ok(without > 5, `5: and with the wall gone the cliff lifts it as it always did (the most ${without.toFixed(2)} m)`);
  // The steep cap: a vertical cliff and a 5° ramp, the cap at 30° and at 90°.
  const ramp: G = (_x, z) => (z >= 100 ? (z - 100) * Math.tan((5 * Math.PI) / 180) : 0);
  const lift = async (g: G, cap: number) => {
    tuneRace({ aheadSteepCap: cap });
    let most = -Infinity;
    try {
      await ride({ fps: 60, ground: g, speed: 60, seconds: 1.6, each: (r, vv) => vv.pos.z > 20 && vv.pos.z < 82 && (most = Math.max(most, r.line)) });
    } finally {
      tuneRace({ aheadSteepCap: 90 });
    }
    return most;
  };
  const cliff30 = await lift(cliff, 30);
  const cliff90 = await lift(cliff, 90);
  const ramp30 = await lift(ramp, 30);
  const ramp90 = await lift(ramp, 90);
  ok(cliff30 < 0.5 && cliff90 > 5, `5: the steep cap at 30° leaves a vertical cliff out of the look-ahead (${cliff30.toFixed(2)} m), at 90° changes nothing (${cliff90.toFixed(2)} m)`);
  ok(Math.abs(ramp30 - ramp90) < 1e-9, `5: a 5° rise is under the cap and lifts the line alike (${ramp30.toFixed(3)} and ${ramp90.toFixed(3)} m)`);
  ok(RACE_TUNE.aheadSteepCap === 90, '5: the cap ships at 90 (off)');
}

// ================================================================ 6. day one: the drive and the track file as at 6e97c21

{
  // The drive with no walls handed to it and the cap at 90: 6e97c21's step to the bit, over a course with a crest, a
  // kicker, a crevasse and a hollow, both kinds and levels, at 144, 60 and 20 fps.
  type Old = { RaceDrive: typeof RaceDrive };
  const Old = await preWave<Old>({ raceMath: 'src/vehicles/raceMath.ts', raceTune: 'src/vehicles/raceTune.ts', raceDrive: 'src/vehicles/raceDrive.ts' }, 'raceDrive');
  if (Old) ok(Old.RaceDrive !== RaceDrive, `6: the drive as it stood at ${PRE_WAVE} is read out of git and loaded beside today's`);
  else note(`6: git could not hand over the drive at ${PRE_WAVE}: today's is held to that drive's trace hash alone`);
  const course: G = (x, z) => 2 * Math.sin(x / 37) + 3 * Math.sin(z / 91) + (z > 400 && z < 420 ? 4 : 0) + (z > 1500 && z < 1540 ? -12 : 0) + (z > 2000 ? Math.max(0, 6 - Math.abs(z - 2100) / 10) : 0);
  const run = async (Drive: typeof RaceDrive, kind: 'pod' | 'bike', fps: number): Promise<number[]> => {
    const physics = await Physics.create();
    const bounds: VehicleSpec['bounds'] = kind === 'pod' ? BOUNDS : { min: [-0.45, 0, -2.05], max: [0.45, 1.16, 2.05] };
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
    race.setLevels('max', v);
    if (race.modes) race.setMode(v, 'racing');
    const input: DriveInput = { throttle: 1, steer: 0, heading: 0, boost: false, hop: false, up: false, down: false, vertical: 0 };
    const out: number[] = [];
    const dt = 1 / fps;
    for (let i = 0; i < 10 * fps; i++) {
      input.heading = Math.sin(i / (fps * 2)) * 0.3;
      input.boost = i > 4 * fps;
      v.update(dt, physics, input, course);
      physics.step(dt);
      const t = v.body.translation();
      const l = v.body.linvel();
      out.push(t.x, t.y, t.z, l.x, l.y, l.z, race.h, race.vy, race.low, race.line, v.hp, v.destroyed ? 1 : 0);
    }
    return out;
  };
  const all: number[] = [];
  const said: string[] = [];
  let agrees = true;
  for (const kind of ['pod', 'bike'] as const) {
    for (const fps of RATES) {
      const now = await run(RaceDrive, kind, fps);
      all.push(...now);
      if (Old) {
        const before = await run(Old.RaceDrive, kind, fps);
        let differ = 0;
        for (let i = 0; i < now.length; i++) if (!Object.is(now[i], before[i])) differ++;
        if (differ || now.length !== before.length) agrees = false;
        said.push(`${kind} ${fps} fps ${differ} of ${now.length} differ`);
      }
    }
  }
  const print = fnv32(all.map((x) => (Object.is(x, -0) ? '-0' : String(x))).join(','));
  /** That trace's FNV-1a, measured once from 6e97c21's drive beside today's (equal by `Object.is`), so it holds where git cannot answer. */
  const RECORDED = '3362eea2';
  if (Old) ok(agrees, `6: the drive with no walls and the cap at 90 drives exactly as ${PRE_WAVE}'s, by Object.is (${said.join('; ')})`);
  ok(print === RECORDED, `6: and its trace is the one written down here (${print}, written ${RECORDED})`);
}
{
  // The track file with no walls: read, hashed and written as at 6e97c21, over fixtures and every plain track of the owner's
  // files (a track of his carrying walls or a course is named apart, never held: the files are his).
  type OldFile = { readTrackFile: typeof readTrackFile; trackFileText: typeof trackFileText; trackHash: typeof trackHash };
  const Old = await preWave<OldFile>({ trackFile: 'src/race/trackFile.ts' }, 'trackFile');
  const course = { v: 1, feather: 'easeInOut', crossing: 'wall', margin: 2, level: 1, grass: 'clear', wallOut: 0.5, wallHigh: 8, paths: [{ id: 'main', nodes: [{ x: 0, y: 1, z: 0, w: 24, b: 0, sh: 8, c: 'smooth' }, { x: 100, y: 2, z: 50, w: 24, b: 5, sh: 8, c: 'straight' }, { x: 0, y: 3, z: 200, w: 24, b: 0, sh: 8, c: 'smooth' }] }] };
  const fixtures = [fileOf([baseTrack]), fileOf([baseTrack, { ...baseTrack, id: 'tu', kind: 'sprint', laps: 1, course: { ...course }, note: 'a note' }])];
  const texts: string[] = [];
  let same = true;
  const off: string[] = [];
  for (const text of fixtures) {
    const now = readTrackFile(text, 'dantooine', 'ground');
    const outNow = trackFileText('dantooine', 'raw', now.tracks);
    texts.push(JSON.stringify(now), outNow, now.tracks.map((t) => trackHash(t)).join('|'));
    if (Old) {
      const was = Old.readTrackFile(text, 'dantooine', 'ground');
      if (JSON.stringify(was) !== JSON.stringify(now)) (same = false), off.push('read');
      if (Old.trackFileText('dantooine', 'raw', was.tracks) !== outNow) (same = false), off.push('written');
      if (was.tracks.map((t) => Old.trackHash(t)).join('|') !== now.tracks.map((t) => trackHash(t)).join('|')) (same = false), off.push('hashed');
    }
  }
  if (Old) ok(same, `6: a track with no walls reads, hashes and writes as at ${PRE_WAVE}${off.length ? ` -- ${off.join(', ')}` : ''}`);
  else note(`6: git could not hand over the track file at ${PRE_WAVE}: held to the recorded hash alone`);
  /** Measured once with 6e97c21's track file answering the same, so it holds where git cannot answer. */
  const FILE_RECORDED = 'c4abc7f6';
  ok(fnv32(texts.join('\n')) === FILE_RECORDED, `6: and what it gave is the one written down here (${fnv32(texts.join('\n'))}, written ${FILE_RECORDED})`);
  const dir = resolve(REPO, 'public/tracks');
  if (!existsSync(dir)) note('6: public/tracks is not there: no file of the owner\'s to hold');
  else
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const world = name.replace(/\.json$/, '');
      const text = readFileSync(join(dir, name), 'utf8');
      const now = readTrackFile(text, world, 'ground');
      const plain = now.tracks.filter((t) => !t.walls && !t.course);
      const drawn = now.tracks.filter((t) => t.walls || t.course).map((t) => `${t.id}${t.walls ? ' (walls)' : ''}${t.course ? ' (a course)' : ''}`);
      if (drawn.length) note(`6: ${name}: the owner's ${drawn.join(', ')} named apart, never held`);
      if (!Old || !plain.length) continue;
      const was = Old.readTrackFile(text, world, 'ground').tracks.filter((t) => plain.some((p) => p.id === t.id));
      ok(JSON.stringify(was) === JSON.stringify(plain) && was.map((t) => Old.trackHash(t)).join('|') === plain.map((t) => trackHash(t)).join('|') && Old.trackFileText(world, 'raw', was) === trackFileText(world, 'raw', plain), `6: ${name}: its ${plain.length} plain track${plain.length === 1 ? '' : 's'} read, hash and write as at ${PRE_WAVE}`);
    }
}

// ================================================================ 7. the step makes nothing: twelve processes at once

// (`RACE_WALLS_NO_ALLOC=1` leaves this out: the mutation runner's.)
if (process.env.RACE_WALLS_NO_ALLOC !== '1') {
  const file = fileURLToPath(new URL('./raceAllocOwn.ts', import.meta.url));
  interface Out {
    frames: number;
    made: number;
    scavenges: number;
    planned: number;
    walls: boolean;
    wallsMet: number;
    wallsTouched: number;
    wallsHard: number;
    skipped?: string;
  }
  type Kind = 'far' | 'met' | 'touch';
  const one = (kind: Kind) =>
    new Promise<Out>((res, rej) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'walls'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RACE_ALLOC_WALLS_FAR: kind === 'far' ? '1' : '0', RACE_ALLOC_WALLS_TOUCH: kind === 'touch' ? '1' : '0' } });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        const line = out.trim().split('\n').pop() ?? '';
        if (code !== 0) return rej(new Error(`the walls measure exited ${code}: ${err.trim().split('\n').find((l) => /Error/.test(l)) ?? line}`));
        try {
          res(JSON.parse(line));
        } catch {
          rej(new Error(`the walls measure printed nothing that reads: ${line || '(nothing)'}`));
        }
      });
    });
  const KINDS: Kind[] = ['far', 'met', 'touch'];
  const all = await Promise.all(Array.from({ length: 12 }, (_, i) => one(KINDS[i % 3])));
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    const kind = KINDS[i % 3];
    const who = `walls measure (${kind === 'far' ? 'set, never met' : kind === 'met' ? 'met along the way' : 'touched only'}), process ${i + 1} of 12`;
    if (a.skipped) {
      note(`${who} skipped: ${a.skipped}`);
      continue;
    }
    // Set and never met, and met only by touches (the drive's verdict saying nothing: the walls' own path, the slide and
    // the speed's share, every turn judged): the plain step's own line, a byte a step, and nothing a touch. Met along the
    // way: a scrape it scores goes on through the drive's scrape path (the hull's hurt, the struck side, a part's damage),
    // which hands its numbers across calls as a scrape off the ground always has, so 128 bytes a scrape and still none a
    // touch (the review round: 128 a touch hid what the touch itself made, about four bytes in the speed's share).
    const line = kind === 'met' ? a.frames + 128 * a.wallsHard : a.frames;
    const met = kind === 'far' ? a.wallsMet <= 1 : kind === 'met' ? a.wallsMet > 1000 && a.wallsHard > 0 : a.wallsTouched > 1000 && a.wallsHard <= 1;
    ok(a.walls && a.planned > 0 && met && a.scavenges === 0 && a.made < line, `${who}: ${Math.max(0, a.made)} bytes over ${a.frames} steps (${(Math.max(0, a.made) / a.frames).toFixed(2)} a step, no collection; ${a.wallsTouched} touches, ${a.wallsHard} scrapes or crashes)`);
  }
}

console.log(`\nraceWalls: ${checks} checks passed`);
