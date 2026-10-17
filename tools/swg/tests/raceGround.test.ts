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
// §4.3's, over its own reference pits (the raw ground along the line closed at `max(L, 0.15 × speed)`), so they are
// the same measure with the bridge on and off: a hull high over such a pit is gliding, which is printed apart.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { Physics } from '../../../src/core/physics.ts';
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
}

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
 * line closed at `max(L, 0.15 × speed)`, a pit wherever the closing stands more than half a metre over the raw ground.
 */
function refPits(t: Terrain, st: Stretch, length: number, speed: number): RefPits {
  const n = Math.round((LEN + 300 - REF_FROM) / STEP) + 1;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = REF_FROM + i * STEP;
    raw[i] = floorOf(t, st.x0 + Math.sin(st.a) * d, st.z0 + Math.cos(st.a) * d);
  }
  const nw = Math.max(1, Math.round(Math.max(length, 0.15 * speed) / STEP) + 1);
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
  const run: Run = { km: 0, under: 0, walls: 0, climbs: 0, crashes: 0, strikes: 0, strikeHull: 0, jolts: 0, falseDives: 0, airborne: 0, falseFlight: 0, glide: 0, rideDips: 0, frames: 0 };
  const dt = 1 / fps;
  const vyBack: number[] = [];
  const keep = Math.max(1, Math.round(0.1 * fps));
  const L = Math.abs(BOUNDS[kind].max[2] - BOUNDS[kind].min[2]);
  const ref = refPits(t, st, L, race.boostTop());
  let lastAt = race.lastHit.at;
  let diving = false;
  let dipping = false;
  let hp = v.hp;
  for (let time = 0; !v.destroyed; time += dt) {
    const along = (v.pos.x - st.x0) * Math.sin(st.a) + (v.pos.z - st.z0) * Math.cos(st.a);
    if (along > LEN || time > 20) break;
    v.update(dt, physics, input, groundAt, waterAt);
    physics.step(dt);
    run.frames++;
    // Where the body stands now, after the step: where the plan the drive has just made leaves its lowest point.
    const p = v.body.translation();
    const now = (p.x - st.x0) * Math.sin(st.a) + (p.z - st.z0) * Math.cos(st.a);
    const gHere = floorOf(t, p.x, p.z);
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
      if (Math.abs(race.vy - old) > 40) {
        run.jolts++;
        vyBack.length = 0;
      }
    }
    // Research5 §4.3's two measures, over its own reference pits (the raw ground closed at max(L, 0.15 × speed), the
    // same with the bridge on and off): a false dive is the hull's lowest point more than half a metre under the
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
  }
  if (v.destroyed && race.lastHit.kind === 'crash') run.crashes = Math.max(run.crashes, 1);
  run.km = Math.max(1e-3, Math.hypot(v.pos.x - st.x0, v.pos.z - st.z0) / 1000);
  return run;
}

interface Sum extends Run {
  runs: number;
}
const sum = (rs: Run[]): Sum => {
  const s: Sum = { runs: rs.length, km: 0, under: 0, walls: 0, climbs: 0, crashes: 0, strikes: 0, strikeHull: 0, jolts: 0, falseDives: 0, airborne: 0, falseFlight: 0, glide: 0, rideDips: 0, frames: 0 };
  for (const r of rs) for (const k of Object.keys(s) as (keyof Sum)[]) if (k !== 'runs') (s[k] as number) += r[k as keyof Run];
  return s;
};
const line = (label: string, s: Sum) =>
  `${label}: ${r2(s.km)} km, walls ${r2(s.walls / s.km)}/km, climbing walls ${r2(s.climbs / s.km)}/km, crashes ${r2(s.crashes / s.km)}/km, strikes ${r2(s.strikes / s.km)}/km, strike hull ${r2(s.strikeHull / s.km)} hp/km, jolts ${r2(s.jolts / s.km)}/km, false dives ${r2(s.falseDives / s.km)}/km (dips under the ride ${r2(s.rideDips / s.km)}/km), airborne ${r2((100 * s.airborne) / Math.max(1, s.frames))}%, false flight ${r2((100 * s.falseFlight) / Math.max(1, s.frames))}%, glide ${r2((100 * s.glide) / Math.max(1, s.frames))}%, under the ground ${s.under} frames`;

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
const byClass: Record<string, Record<number, Run[]>> = {};
const offBridge: Record<string, Run[]> = {};
let any = false;
for (const { world, cls, want } of plan) {
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
      for (const fps of FPS) {
        const runs: Run[] = [];
        for (const st of stretches) runs.push(await drive(t, st, kind, level, fps));
        (byClass[key][fps] ??= []).push(...runs);
        console.log(line(`${world} ${cls} ${kind} ${level} ${fps} fps (${runs.length} stretches)`, sum(runs)));
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
    // which is what the bridge is for, and is printed apart.
    ok(ffOn - ffOff <= 0.5, `${key}: time high over open ground with the bridge within half a point of without (${r2(ffOn)}% against ${r2(ffOff)}%)`);
    if (cls === 'gentle' && level === 'max') ok((100 * all.airborne) / Math.max(1, all.frames) < 5, `${key}: airborne under 5% of the way at full speed on gentle ground (${r2((100 * all.airborne) / Math.max(1, all.frames))}%)`);
    void kind;
  }
}
console.log(`\nraceGround: ${checks} checks passed`);
if (missed.length) {
  console.log(`raceGround: ${missed.length} bounds missed:\n${missed.map((m) => `  ${m}`).join('\n')}`);
  process.exitCode = 1;
}
