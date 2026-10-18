// The race drive over the worlds' own ground (src/vehicles/raceDrive.ts), when packs are converted.
//
// Straight kilometre stretches of a world's real terrain, chosen by research2's rule written in here (random places
// within 4 km of the layout's middle and random headings, dry, every 32 m sample within a grade of the last: gentle
// 8%, rolling 15%, hilly 35%, uncurated anything), each built as the game builds its ground (every 64 m chunk the
// stretch passes within 80 m of, through the game's own chunk heightfield), and the game's own Vehicle driven straight
// along it by its race drive, which reads the ground ahead as the world hands it over (built blocks only). Stepped
// through the real accumulator at 144, 120, 60 and 20 fps.
//
// `npm run test:race` runs two worlds (Tatooine's gentle and Corellia's rolling stretches, four of each, a full pod and
// a full bike) and holds the bounds; `npm run test:race-ground` runs every converted world, both kinds, stock and
// full, gentle, rolling and hilly with the bridge on and off and `offCourse` both ways, and prints the uncurated lines
// for information. A world whose pack is not converted is passed over. A false dive and a false flight are research5
// §4.3's, over its own reference pits (the raw ground along the line closed at `max(L, 0.6 × bridgeTime × speed)`, the metres `0.15 × speed`
// closed at the first ride's speeds), so they are
// the same measure with the bridge on and off: a hull high over such a pit is gliding, which is printed apart.
//
// The hold (`RACE_TUNE.hold`): every run is the loose hold, the owner's after his first ride, and the firm one (the
// first ride's) is run beside it as its control -- in `test:race` at 60 fps, under `test:race-ground` at 144, 60 and 20
// -- with what the owner's words can be held to, measured off the body and the raw ground alone, never off the drive's
// own idea of itself: how often the hull leaves the ground off a crest (a jump: its lowest point climbing past its ride
// and its band over the raw ground under it, where no reference pit is), the share of the distance it is off the ground,
// how often it is pulled down harder than the world's gravity while the ground under it does not ask for that (its
// vertical speed falling faster than 23 m/s² over a tenth of a second, unless it is on the ground and the ground there
// curves down at least as hard at its speed), and the hardest it is ever pulled down.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { FIXED_DT, Physics } from '../../../src/core/physics.ts';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { CHUNK_SIZE, Terrain, chunkHeightfield } from '../../../src/world/terrain.ts';
import { Vehicle, specFor, type DriveInput } from '../../../src/vehicles/vehicle.ts';
import { attachRace, type RaceGround } from '../../../src/vehicles/raceDrive.ts';
import { bridgeClose, closedAt } from '../../../src/vehicles/raceMath.ts';
import { RACE_TUNE, tuneRace } from '../../../src/vehicles/raceTune.ts';
import type { PlanetDef } from '../../../src/data/planets.ts';

let checks = 0;
/** Under `test:race-ground` every bound is held and the misses listed at the end, so one run gives every world's figures. */
const missed: string[] = [];
const ok = (cond: boolean, what: string) => {
  if (!cond && ALL) {
    missed.push(what);
    console.log(`FAIL ${what}`);
    return;
  }
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const r2 = (n: number) => Number(n.toFixed(2));

const ALL = process.argv.includes('all') || process.env.RACE_GROUND === 'all';
const PACKS = process.env.SWG3JS_PACKS ?? join(import.meta.dirname, '../../../assets-private');
const LEN = 1000;
const STEP = 2;
const CLASSES: Record<string, number> = { gentle: 0.08, rolling: 0.15, hilly: 0.35, uncurated: Infinity };
const planet = { id: 'test', seed: 1, palette: { low: 0, mid: 0, high: 0, slope: 0, shore: 0 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null } as unknown as PlanetDef;

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

async function terrainOf(world: string): Promise<Terrain | null> {
  const c = centreOf(world);
  if (!c) return null;
  const dir = join(PACKS, world);
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const trn = bytes('terrain.trn');
  if (!trn) return null;
  const swg = await SwgTerrain.create(trn, [], c.x, c.z, async (file) => bytes(file));
  const t = new Terrain(planet);
  t.attachSwg(swg);
  return t;
}

interface Stretch {
  x0: number;
  z0: number;
  a: number;
  chunks: { origin: { x: number; z: number }; heights: Float32Array }[];
}

const floorOf = (t: Terrain, x: number, z: number) => {
  const g = t.heightAt(x, z);
  const w = t.waterHeightAt(x, z);
  return Number.isFinite(w) && w > g ? w : g;
};

/** research2's rule: random dry stretches near the middle whose 32 m samples stay within the class's grade. */
function findStretches(t: Terrain, seed: number, want: number, tries: number, maxGrade: number): Stretch[] {
  const r = seeded(seed);
  const out: Stretch[] = [];
  for (let i = 0; i < tries && out.length < want; i++) {
    const x0 = (r() * 2 - 1) * 4000;
    const z0 = (r() * 2 - 1) * 4000;
    const a = r() * Math.PI * 2;
    let good = true;
    let last = floorOf(t, x0, z0);
    for (let d = 32; d <= LEN + 120 && good; d += 32) {
      const x = x0 + Math.sin(a) * d;
      const z = z0 + Math.cos(a) * d;
      const h = floorOf(t, x, z);
      // Dry ground only: a course over the sea measures the water.
      if (Math.abs(h - last) / 32 > maxGrade || h > t.heightAt(x, z) + 0.01) good = false;
      last = h;
    }
    if (!good) continue;
    // Every chunk the stretch passes within 80 m of, built as the game builds it, kept for every run on it.
    const made = new Map<string, { origin: { x: number; z: number }; heights: Float32Array }>();
    for (let d = -80; d <= LEN + 200; d += 16) {
      for (const side of [-80, -40, 0, 40, 80]) {
        const x = x0 + Math.sin(a) * d + Math.cos(a) * side;
        const z = z0 + Math.cos(a) * d - Math.sin(a) * side;
        const cx = Math.floor(x / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        const key = `${cx},${cz}`;
        if (made.has(key)) continue;
        t.prepareChunk(cx, cz, true);
        const built = t.buildChunk(cx, cz);
        built.geometry.dispose();
        made.set(key, { origin: built.origin, heights: built.heights });
      }
    }
    out.push({ x0, z0, a, chunks: [...made.values()] });
  }
  return out;
}

interface Run {
  km: number;
  under: number;
  walls: number;
  climbs: number;
  crashes: number;
  strikes: number;
  strikeHull: number;
  jolts: number;
  falseDives: number;
  airborne: number;
  falseFlight: number;
  glide: number;
  rideDips: number;
  frames: number;
  /** Jumps off a crest, the distance driven and the part of it off the ground, the pulls nothing under it asked for, and the hardest pull down (m/s²). */
  jumps: number;
  dist: number;
  airDist: number;
  pulls: number;
  mostDown: number;
  /** The most the hull's lowest point stood over its own line (m): how high anything threw it, or how deep under it the ground fell away. */
  highest: number;
}

/**
 * The world's own gravity, which the loose hold falls at: a pull down past it (and a margin) is the hold's, not the
 * world's. The margin is the measure's: the body's speed is the drive's average over each plan, read at the window's
 * two ends, and a frame now and then takes a step more or less than its neighbours (four where 20 fps's frames take
 * three, two where 120's take one), which can stand the two plans' middles a step further apart than the window and
 * read a fall at gravity up to a sixth over it.
 */
const G = 20;
const PULL_MARGIN = 4;
/** The window a vertical acceleration is read over: a tenth of a second of the physics' own fixed steps, the same at every frame rate. */
const WINDOW_STEPS = Math.round(0.1 / FIXED_DT);
/** The length the ground's own curve is read over (m), a face's: the same at every frame rate. */
const CURVE_LEN = 8;
/** A jolt: the vertical speed changing by more than this in a tenth of a second (half the first ride's 40, as every speed is halved). */
const JOLT = 20;

const BOUNDS = { pod: { min: [-3, 0, -6], max: [3, 2.5, 6] }, bike: { min: [-0.45, 0, -2.05], max: [0.45, 1.16, 2.05] } } as const;
const BOXES = { pod: [7, 3, 15], bike: [1, 1.3, 3.6] } as const;

/** The reference pits along a stretch: its raw ground every 2 m from 100 m before its start, and that ground closed. */
interface RefPits {
  raw: Float64Array;
  closed: Float64Array;
}
const REF_FROM = -100;
/**
 * The pits a hull crossing at `speed` passes in a blink, as research5 §4.3 defines them for its false dives and false
 * flights, independent of the drive's own bridge (so the same with it on and off): the raw ground along the stretch's
 * line closed at `max(L, 0.6 × bridgeTime × speed)`, a pit wherever the closing stands more than half a metre over the
 * raw ground. Research5's reference was 0.15 s of travel against the bridge's 0.25 s, three-fifths of the bridge's
 * span; it is held at that share of the bridge, so it is the same metres the first ride's was now the bridge spans half
 * a second at half the speed. (Left at 0.15 s, the reference halved in metres while the bridge did not, and the time
 * the bridge spent gliding pits 25 to 83 m wide, which the reference no longer called pits, was counted against it as
 * time high over open ground, under either hold.)
 */
function refPits(t: Terrain, st: Stretch, length: number, speed: number): RefPits {
  const n = Math.round((LEN + 300 - REF_FROM) / STEP) + 1;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = REF_FROM + i * STEP;
    raw[i] = floorOf(t, st.x0 + Math.sin(st.a) * d, st.z0 + Math.cos(st.a) * d);
  }
  const nw = Math.max(1, Math.round(Math.max(length, 0.6 * RACE_TUNE.bridgeTime * speed) / STEP) + 1);
  const dil = new Float64Array(n);
  const dq = new Int32Array(n);
  const starts = bridgeClose(raw, n, nw, dil, dq);
  const closed = new Float64Array(n);
  for (let j = 0; j < n; j++) closed[j] = closedAt(dil, starts, nw, j);
  return { raw, closed };
}
/** Whether a place along the stretch is over a reference pit, and the pit's rim-closed ground there (NaN off any pit). */
const pitRim = (ref: RefPits, along: number): number => {
  const j = Math.round((along - REF_FROM) / STEP);
  if (j < 0 || j >= ref.raw.length) return Number.NaN;
  const c = ref.closed[j];
  return c - ref.raw[j] > 0.5 ? c : Number.NaN;
};

async function drive(t: Terrain, st: Stretch, kind: 'pod' | 'bike', level: 'max' | 'stock', fps: number): Promise<Run> {
  const physics = await Physics.create();
  for (const c of st.chunks) chunkHeightfield(physics, c);
  const spec = specFor(kind === 'pod' ? 'podracer' : 'speederbike', kind, kind, BOUNDS[kind]);
  spec.hull = 'box';
  spec.raceBox = [...BOXES[kind]] as [number, number, number];
  const y0 = floorOf(t, st.x0, st.z0);
  const v = new Vehicle(spec, new THREE.Group(), physics, new THREE.Scene(), st.x0, y0 + 2, st.z0, st.a);
  physics.stepOnce();
  const ground: RaceGround = {
    near: (x, z) => t.nearHeightIfCached(x, z),
    far: () => null,
    farStep: 16,
    farX: () => 0,
    farZ: () => 0,
    water: (x, z) => t.waterHeightAt(x, z),
  };
  const race = attachRace(v, kind, { ground })!;
  race.setLevels(level, v);
  if (race.modes) race.setMode(v, 'racing');
  const input: DriveInput = { throttle: 1, steer: 0, heading: st.a, boost: true, hop: false, up: false, down: false, vertical: 0 };
  const groundAt = (x: number, z: number) => t.heightAt(x, z);
  const waterAt = (x: number, z: number) => t.waterHeightAt(x, z);
  // At its full top along the stretch from the first frame, as a run's start line would have it.
  v.update(1 / fps, physics, input, groundAt, waterAt);
  physics.step(1 / fps);
  v.body.setLinvel({ x: Math.sin(st.a) * race.boostTop(), y: 0, z: Math.cos(st.a) * race.boostTop() }, true);
  race.h = race.boostTop();
  (race as unknown as { cmdValid: boolean }).cmdValid = false;
  const run: Run = { km: 0, under: 0, walls: 0, climbs: 0, crashes: 0, strikes: 0, strikeHull: 0, jolts: 0, falseDives: 0, airborne: 0, falseFlight: 0, glide: 0, rideDips: 0, frames: 0, jumps: 0, dist: 0, airDist: 0, pulls: 0, mostDown: 0, highest: 0 };
  const dt = 1 / fps;
  const vyBack: number[] = [];
  const keep = Math.max(1, Math.round(0.1 * fps));
  const L = Math.abs(BOUNDS[kind].max[2] - BOUNDS[kind].min[2]);
  const ref = refPits(t, st, L, race.boostTop());
  // The body's own vertical speed through time, for its acceleration over a fixed window.
  const vyAt: number[] = [];
  const tAt: number[] = [];
  const liftsAt: number[] = [];
  const liftsStart = race.lifts;
  let back = 0;
  let lastAt = race.lastHit.at;
  let diving = false;
  let dipping = false;
  let off = false;
  let pulling = false;
  let hp = v.hp;
  let was = 0;
  const offAt = race.handling.ride + race.handling.band;
  for (let time = 0; !v.destroyed; time += dt) {
    const along = (v.pos.x - st.x0) * Math.sin(st.a) + (v.pos.z - st.z0) * Math.cos(st.a);
    if (along > LEN || time > 40) break;
    v.update(dt, physics, input, groundAt, waterAt);
    physics.step(dt);
    run.frames++;
    // Where the body stands now, after the step: where the plan the drive has just made leaves its lowest point.
    const p = v.body.translation();
    const now = (p.x - st.x0) * Math.sin(st.a) + (p.z - st.z0) * Math.cos(st.a);
    const gHere = floorOf(t, p.x, p.z);
    const travel = Math.max(0, now - was);
    was = now;
    run.dist += travel;
    // (Not on the step that wrecked it: a crash leaves the body where its last step put it, in the face it met.)
    if (p.y < gHere - 0.05 && !v.destroyed) run.under++;
    if (race.lastHit.at !== lastAt) {
      const k = race.lastHit.kind;
      if (k === 'face') run.walls++;
      else if (k === 'climb') run.climbs++;
      else if (k === 'crash') run.crashes++;
      else if (k === 'strike') {
        run.strikes++;
        run.strikeHull += Math.max(0, hp - v.hp);
      }
      lastAt = race.lastHit.at;
    }
    hp = v.hp;
    if (v.destroyed && race.lastHit.kind === 'crash') run.crashes += 0;
    vyBack.push(race.vy);
    if (vyBack.length > keep) {
      const old = vyBack.shift()!;
      if (Math.abs(race.vy - old) > JOLT) {
        run.jolts++;
        vyBack.length = 0;
      }
    }
    // Research5 §4.3's two measures, over its own reference pits (the raw ground closed at max(L, 0.6 × bridgeTime ×
    // speed), the metres 0.15 × speed closed at the first ride's speeds, the same with the bridge on and off): a false dive is the hull's lowest point more than half a metre under the
    // rim-closed ground of a pit under its middle -- down into a pothole it is past in a blink; a false flight is its
    // lowest point more than `airborneAt` over the raw ground under its middle where no such pit is under its middle or
    // its ends -- high over open ground -- and the same over a pit is a glide, which is what the bridge is for.
    // A dive is counted once the hull is a span and its length past the stretch's start: started in a pit (a run's
    // start line drawn across one), it has no rim behind it to be bridged from, as the drive's own bridge has not. The
    // reference pits are the stretch's line's, so they answer only while the hull is on that line: a wall or a face met
    // turns its travel off it, and off it nothing is over a pit (every time high there counts against the bridge).
    const onLine = Math.abs((p.x - st.x0) * Math.cos(st.a) - (p.z - st.z0) * Math.sin(st.a)) <= 2;
    const rimMid = onLine ? pitRim(ref, now) : Number.NaN;
    const overPit = onLine && (!Number.isNaN(rimMid) || !Number.isNaN(pitRim(ref, now - L / 2)) || !Number.isNaN(pitRim(ref, now + L / 2)));
    const dive = now > race.span + L && !Number.isNaN(rimMid) && race.low < rimMid - 0.5;
    if (dive && !diving) run.falseDives++;
    diving = dive;
    // Printed beside them, for information: the hull going down more than half a metre under its ride where the drive's
    // own bridge lifts the ground by more than half a metre (a landing from a crest onto a bridged dip is one, in the one
    // sub-step at the fall's speed that meets the ground, without going into anything).
    const dip = race.bridgeLift > 0.5 && race.vy < -2 && race.low - (race.under + race.handling.ride) < -0.5;
    if (dip && !dipping) run.rideDips++;
    dipping = dip;
    if (race.airborne) run.airborne++;
    const high = race.low - gHere > race.handling.airborneAt;
    if (high && overPit) run.glide++;
    else if (high) run.falseFlight++;
    // The owner's words, off the body and the raw ground alone. Off the ground: the lowest point past its ride and its
    // band over the raw ground under its middle; a jump is leaving it where no reference pit is (over one it is a glide).
    const isOff = race.low - gHere > offAt;
    if (isOff) run.airDist += travel;
    if (isOff && !off && !overPit) run.jumps++;
    off = isOff;
    // How high anything threw it: its lowest point over its own line, the most it ever stood (printed only: the ceiling
    // on a throw is `raceHold.test.ts`'s, over a kerb, a bump and a pit's far rim. A ceiling was tried here -- a take-off
    // over its line faster than the centre line's ground rose over the half second before -- and over every world the
    // hold taking a step's rise up at once, `looseFeed` at its most, was thrown no more often by it than the hold as
    // built, which it counted thrown off ground its footprint's sides rose over: the worlds' ground, read every 2 m and
    // smooth between, has no step to fling a hull off.)
    if (race.overLine > run.highest) run.highest = race.overLine;
    // Its vertical acceleration over the last tenth of a second of the physics' own steps (the body moves only on them,
    // at the speed the drive commanded for them), from the body's own vertical speed: counted in steps, so a frame that
    // took none reads the same as one that took four.
    const vyNow = v.body.linvel().y;
    const stepsNow = physics.steps;
    const stepped = !tAt.length || stepsNow > tAt[tAt.length - 1];
    // (Judged only on a frame the physics stepped: the body's speed moves on no other. And not over a window in which the
    // ground itself lifted the hull out of it, a strike slight or hard, nor just before it: the speed it shoved the hull
    // up at, spread over the step it was shoved in, ends with that step, and that is the ground's push and not the
    // hold's pull. The drive counts every such lift, `lifts`.)
    if (stepped) {
      vyAt.push(vyNow);
      tAt.push(stepsNow);
      liftsAt.push(race.lifts);
      while (back + 1 < tAt.length && tAt[back + 1] <= stepsNow - WINDOW_STEPS) back++;
      const span = (stepsNow - tAt[back]) * FIXED_DT;
      // Pulled down: how fast its vertical speed went below nought, or further below it, over the window (a rise
      // brought to a stop is not a pull down: the owner's words are about being pulled down and back up).
      const from = vyAt[back] < 0 ? vyAt[back] : 0;
      const accel = stepsNow - tAt[back] >= WINDOW_STEPS && vyNow < from ? (vyNow - from) / span : 0;
      // (Before the first record, the count as the run began: a lift on the run's first frame, the hull stood at the
      // start line with the ground under its footprint over it, is the ground's too.)
      const struck = race.lifts !== (back > 0 ? liftsAt[back - 1] : liftsStart);
      if (!struck && -accel > run.mostDown) run.mostDown = -accel;
      // What the ground asks of a hull on it there: its own curve over a face's length, at the hull's speed (negative
      // where it falls away). A pull down harder than gravity is the ground's only while the hull is on it and the
      // ground curves down at least that hard; any other is the hold's.
      const j = Math.round((now - REF_FROM) / STEP);
      const k = Math.round(CURVE_LEN / STEP);
      const curve = onLine && j - k >= 0 && j + k < ref.raw.length ? (ref.raw[j + k] - 2 * ref.raw[j] + ref.raw[j - k]) / (CURVE_LEN * CURVE_LEN) : 0;
      const asked = curve * race.h * race.h;
      const onIt = race.low - gHere <= offAt;
      const pulled = !struck && accel < -(G + PULL_MARGIN) && !(onIt && asked <= accel + PULL_MARGIN);
      if (pulled && !pulling) run.pulls++;
      pulling = pulled;
    }
  }
  if (v.destroyed && race.lastHit.kind === 'crash') run.crashes = Math.max(run.crashes, 1);
  run.km = Math.max(1e-3, Math.hypot(v.pos.x - st.x0, v.pos.z - st.z0) / 1000);
  return run;
}

interface Sum extends Run {
  runs: number;
}
const sum = (rs: Run[]): Sum => {
  const s: Sum = { runs: rs.length, km: 0, under: 0, walls: 0, climbs: 0, crashes: 0, strikes: 0, strikeHull: 0, jolts: 0, falseDives: 0, airborne: 0, falseFlight: 0, glide: 0, rideDips: 0, frames: 0, jumps: 0, dist: 0, airDist: 0, pulls: 0, mostDown: 0, highest: 0 };
  for (const r of rs) {
    for (const k of Object.keys(s) as (keyof Sum)[]) if (k !== 'runs' && k !== 'mostDown' && k !== 'highest') (s[k] as number) += r[k as keyof Run];
    s.mostDown = Math.max(s.mostDown, r.mostDown);
    s.highest = Math.max(s.highest, r.highest);
  }
  return s;
};
/** The share of the distance off the ground, in per cent. */
const airPct = (s: Sum) => (100 * s.airDist) / Math.max(1e-9, s.dist);
const line = (label: string, s: Sum) =>
  `${label}: ${r2(s.km)} km, walls ${r2(s.walls / s.km)}/km, climbing walls ${r2(s.climbs / s.km)}/km, crashes ${r2(s.crashes / s.km)}/km, strikes ${r2(s.strikes / s.km)}/km, strike hull ${r2(s.strikeHull / s.km)} hp/km, jolts ${r2(s.jolts / s.km)}/km, false dives ${r2(s.falseDives / s.km)}/km (dips under the ride ${r2(s.rideDips / s.km)}/km), airborne ${r2((100 * s.airborne) / Math.max(1, s.frames))}%, false flight ${r2((100 * s.falseFlight) / Math.max(1, s.frames))}%, glide ${r2((100 * s.glide) / Math.max(1, s.frames))}%, under the ground ${s.under} frames; jumps ${r2(s.jumps / s.km)}/km, off the ground ${r2(airPct(s))}% of the way, pulled down unasked ${r2(s.pulls / s.km)}/km, hardest pull down ${r2(s.mostDown)} m/s², highest over its line ${r2(s.highest)} m`;

const worlds = ALL
  ? readdirSync(PACKS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(PACKS, d.name, 'terrain.trn')) && existsSync(join(PACKS, d.name, 'layout.json')))
      .map((d) => d.name)
  : ['tatooine', 'corellia'];
const plan: { world: string; cls: string; want: number }[] = ALL
  ? worlds.flatMap((world) => ['gentle', 'rolling', 'hilly', 'uncurated'].map((cls) => ({ world, cls, want: cls === 'uncurated' ? 2 : 4 })))
  : [
      { world: 'tatooine', cls: 'gentle', want: 4 },
      { world: 'corellia', cls: 'rolling', want: 4 },
    ];
const FPS = [144, 120, 60, 20];
/** The firm hold, run beside the loose as its control: at 60 fps in `test:race`, at three rates over every world. */
const FIRM_FPS = ALL ? [144, 60, 20] : [60];
const byClass: Record<string, Record<number, Run[]>> = {};
const byFirm: Record<string, Record<number, Run[]>> = {};
const offBridge: Record<string, Run[]> = {};
/** Each world's own runs of each class, kind and level, the hold in force and the firm beside it, by frame rate. */
const byWorld: { world: string; key: string; loose: Record<number, Run[]>; firm: Record<number, Run[]> }[] = [];
// `RACE_GROUND_TUNE='{"looseGrip":30}'` moves any rule of the drive for the whole run, to measure another number;
// `RACE_GROUND_WORLDS=tatooine,naboo` drives only those worlds under `all`.
if (process.env.RACE_GROUND_TUNE) note(`tuned for this run: ${tuneRace(JSON.parse(process.env.RACE_GROUND_TUNE) as Parameters<typeof tuneRace>[0]).join('; ') || process.env.RACE_GROUND_TUNE}`);
const TUNED = JSON.parse(JSON.stringify(RACE_TUNE)) as typeof RACE_TUNE;
const only = process.env.RACE_GROUND_WORLDS ? new Set(process.env.RACE_GROUND_WORLDS.split(',')) : null;
let any = false;
for (const { world, cls, want } of plan) {
  if (only && !only.has(world)) continue;
  const t = await terrainOf(world);
  if (!t) {
    note(`${world}: not converted, passed over`);
    continue;
  }
  const stretches = findStretches(t, world.length * 104729 + 3 + cls.length, want, 2500, CLASSES[cls]);
  if (!stretches.length) {
    note(`${world} ${cls}: no stretch found`);
    continue;
  }
  any = true;
  const kinds: ('pod' | 'bike')[] = ['pod', 'bike'];
  const levels: ('max' | 'stock')[] = ALL ? ['max', 'stock'] : ['max'];
  for (const kind of kinds) {
    for (const level of levels) {
      const key = `${cls} ${kind} ${level}`;
      byClass[key] ??= {};
      const mine: (typeof byWorld)[number] = { world, key, loose: {}, firm: {} };
      byWorld.push(mine);
      for (const fps of FPS) {
        const runs: Run[] = [];
        for (const st of stretches) runs.push(await drive(t, st, kind, level, fps));
        (byClass[key][fps] ??= []).push(...runs);
        mine.loose[fps] = runs;
        console.log(line(`${world} ${cls} ${kind} ${level} ${fps} fps, ${RACE_TUNE.hold} (${runs.length} stretches)`, sum(runs)));
      }
      // The firm hold beside it, the first ride's: the loose hold's control.
      if (RACE_TUNE.hold !== 'firm') {
        tuneRace({ hold: 'firm' });
        byFirm[key] ??= {};
        for (const fps of FIRM_FPS) {
          const runs: Run[] = [];
          for (const st of stretches) runs.push(await drive(t, st, kind, level, fps));
          (byFirm[key][fps] ??= []).push(...runs);
          mine.firm[fps] = runs;
          console.log(line(`${world} ${cls} ${kind} ${level} ${fps} fps, firm`, sum(runs)));
        }
        tuneRace({ hold: TUNED.hold });
      }
      // The bridge off, at 60 fps: what the bridge buys, and what it costs in time high over open ground.
      tuneRace({ bridge: 'off' });
      const off: Run[] = [];
      for (const st of stretches) off.push(await drive(t, st, kind, level, 60));
      tuneRace({ bridge: 'on' });
      (offBridge[key] ??= []).push(...off);
      console.log(line(`${world} ${cls} ${kind} ${level} 60 fps, bridge off`, sum(off)));
      if (ALL) {
        tuneRace({ offCourse: 'stop' });
        const soft: Run[] = [];
        for (const st of stretches) soft.push(await drive(t, st, kind, level, 60));
        tuneRace({ offCourse: 'crash' });
        console.log(line(`${world} ${cls} ${kind} ${level} 60 fps, offCourse stop`, sum(soft)));
      }
    }
  }
}

if (!any) note('no converted world: nothing driven');
else {
  for (const [key, rates] of Object.entries(byClass)) {
    const [cls, kind, level] = key.split(' ');
    if (cls === 'uncurated') continue;
    const all = sum(Object.values(rates).flat());
    ok(all.under === 0, `${key}: never under the ground (${all.frames} frames)`);
    if (cls === 'gentle' || !ALL) ok(all.climbs === 0 && all.crashes === 0, `${key}: no climbing wall and no crash (${line('all rates', all)})`);
    if (cls !== 'gentle') ok(all.crashes / all.km <= 0.1 && all.falseDives === 0, `${key}: crashes at most 0.1 a km and no false dive with the bridge on (${r2(all.crashes / all.km)}/km, ${all.falseDives} false dives)`);
    const at20 = sum(rates[20] ?? []);
    for (const fps of [144, 120]) {
      const s = sum(rates[fps] ?? []);
      const most = (n20: number) => (n20 / at20.km) * 1.25 + 0.1;
      const okRate = s.walls / s.km <= most(at20.walls) && s.crashes / s.km <= most(at20.crashes) && s.strikes / s.km <= most(at20.strikes);
      ok(okRate, `${key}: at ${fps} fps walls, crashes and strikes are no more than 20 fps's plus a quarter and 0.1 a km (${r2(s.walls / s.km)}, ${r2(s.crashes / s.km)}, ${r2(s.strikes / s.km)} against ${r2(at20.walls / at20.km)}, ${r2(at20.crashes / at20.km)}, ${r2(at20.strikes / at20.km)})`);
    }
    ok(all.strikeHull / all.km <= 5, `${key}: strike hull at most 5 hp a km (${r2(all.strikeHull / all.km)})`);
    const off = sum(offBridge[key] ?? []);
    const on60 = sum(rates[60] ?? []);
    const ffOn = (100 * on60.falseFlight) / Math.max(1, on60.frames);
    const ffOff = (100 * off.falseFlight) / Math.max(1, off.frames);
    // The design's half a point, over open ground in research5's sense: time high over the reference pits is a glide,
    // which is what the bridge is for, and is printed apart. The same under either hold (the reference pits stand to the
    // bridge as they did on the first ride, `refPits`).
    ok(ffOn - ffOff <= 0.5, `${key}: time high over open ground with the bridge within half a point of without (${r2(ffOn)}% against ${r2(ffOff)}%)`);
    // Restated for the loose hold, which flies off crests the firm one held down: still under 5% on gentle ground at full
    // speed, since gentle ground has next to no crest that falls away faster than gravity at the halved speeds.
    if (cls === 'gentle' && level === 'max') ok((100 * all.airborne) / Math.max(1, all.frames) < 5, `${key}: airborne under 5% of the way at full speed on gentle ground, loose as firm held it (${r2((100 * all.airborne) / Math.max(1, all.frames))}%)`);
    // The owner's words, the loose hold against the firm one beside it (FIRM_FPS). Never pulled down harder than the
    // world's gravity where the ground under it does not ask for it, and never harder than the hold's own fall or grip
    // anywhere, where the firm hold is pulled down at many times gravity; and on rolling and hilly ground off the ground
    // at least as often and as far as the firm hold.
    if (RACE_TUNE.hold !== 'firm') {
      const firm = sum(Object.values(byFirm[key] ?? {}).flat());
      const most = Math.max(RACE_TUNE.looseFall, RACE_TUNE.looseGrip) + PULL_MARGIN;
      ok(all.pulls === 0 && all.mostDown <= most, `${key}: loose, never pulled down harder than gravity where the ground does not ask it, nor harder than ${most} m/s² anywhere (${all.pulls} pulls, the hardest ${r2(all.mostDown)} m/s²; firm: ${r2(firm.pulls / Math.max(1e-9, firm.km))} a km, the hardest ${r2(firm.mostDown)})`);
      if (cls !== 'gentle' && firm.km > 0) {
        // (Off the ground as far, not off a crest as often: on hilly ground one loose flight spans what the firm hold
        // made two or three short hops of, so the loose hold can count fewer jumps a km while flying three times as far.)
        ok(airPct(all) >= airPct(firm), `${key}: loose, off the ground at least as far as the firm hold (${r2(airPct(all))}% of the way in ${r2(all.jumps / all.km)} jumps a km, against ${r2(airPct(firm))}% in ${r2(firm.jumps / firm.km)})`);
        ok(firm.pulls > 0, `${key}: (the control: the firm hold is pulled down unasked ${r2(firm.pulls / firm.km)} times a km: the measure sees the magnet)`);
      }
    }
    void kind;
  }
  // World by world: the loose hold crashes no more than the firm hold beside it on the same stretches at the same rates
  // (a rise ahead is climbed rather than struck, and a hull is wrecked only where it would have been before), and its
  // strikes come at the same rate whatever the frame rate.
  if (RACE_TUNE.hold !== 'firm') {
    for (const w of byWorld) {
      const [cls] = w.key.split(' ');
      if (cls === 'uncurated' || !Object.keys(w.firm).length) continue;
      const loose = sum(FIRM_FPS.flatMap((f) => w.loose[f] ?? []));
      const firm = sum(FIRM_FPS.flatMap((f) => w.firm[f] ?? []));
      ok(loose.crashes <= firm.crashes, `${w.world} ${w.key}: loose crashes no more than firm at ${FIRM_FPS.join(', ')} fps (${loose.crashes} against ${firm.crashes})`);
      const counts = FPS.map((f) => sum(w.loose[f] ?? []).strikes);
      // (One strike's slack: on four stretches a world, a quarter of a rate is less than one strike.)
      const at144 = sum(w.loose[144] ?? []).strikes;
      const at20 = sum(w.loose[20] ?? []).strikes;
      if (w.loose[144] && w.loose[20]) ok(at144 <= at20 * 1.25 + 1, `${w.world} ${w.key}: loose strikes at 144 fps no more than 20 fps's plus a quarter and one (${at144} against ${at20})`);
      const looseAll = sum(FPS.flatMap((f) => w.loose[f] ?? []));
      const firmAll = sum(FIRM_FPS.flatMap((f) => w.firm[f] ?? []));
      console.log(`note ${w.world} ${w.key}: loose strikes at ${FPS.join(', ')} fps ${counts.join(', ')}; firm at ${FIRM_FPS.join(', ')} ${FIRM_FPS.map((f) => sum(w.firm[f] ?? []).strikes).join(', ')}; airborne loose ${r2((100 * looseAll.airborne) / Math.max(1, looseAll.frames))}% firm ${r2((100 * firmAll.airborne) / Math.max(1, firmAll.frames))}%; highest over its line loose ${r2(looseAll.highest)} firm ${r2(firmAll.highest)} m`);
    }
  }
}
console.log(`\nraceGround: ${checks} checks passed`);
if (missed.length) {
  console.log(`raceGround: ${missed.length} bounds missed:\n${missed.map((m) => `  ${m}`).join('\n')}`);
  process.exitCode = 1;
}
