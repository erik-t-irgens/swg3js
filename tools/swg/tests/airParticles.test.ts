// What the air carries besides dust (the volumetrics' fourth wave, the design's §2.16 and the owner's Q6, Q7 and Q14):
// the kick-up pool (`airParticles.ts`), its spawn records (`airSpawn.ts`), the sources that write them (`airForces.ts`)
// and the arithmetic the programs hold to (`airParticleMath.ts`), driven through the real `AirField.update` with a
// stand-in renderer that records what the pool's update was handed at each draw. Held here:
//
//   - a colour packed into one float and back within a step of its own, exact in a float32;
//   - a source's count is its rate times the frame's dt with the fraction carried, the same over two seconds at 60, 144
//     and 240 frames a second, through the field's own frame;
//   - a position kept relative to the window's corner drifts its own speed eight kilometres out at every frame rate,
//     where one kept in the world's frame stalls (the reason the pool keeps the corner);
//   - a fine streak is drawn along its own motion, as long as its speed over its trail, held between its least and most
//     (the programs' own lines run as script against the mirror);
//   - no streak without a source past its threshold: a jet too weak on sand throws puffs and no streak, no record at all
//     with no source, and the wind picks streaks up only in a storm;
//   - water throws water (Q6): a jet over water throws spray and never a leaf, a puff, a streak or a grain, and a machine
//     skimming water throws the game's own trail's look (Q14), counted by the metres it travels;
//   - the records reach the update sorted by kind with their counts cumulative, the corner taken off, each kind's ring
//     head moved on by what it starts and wrapping;
//   - the pool steps and shows every frame the field runs and is hidden on any other, never hidden while the field ran;
//   - no detail of the pool disposes a material;
//   - the window's scroll and the corner's moves the field hands the update, carried by the program's own rule through a
//     ride eight kilometres out, leave a particle's world place where its own motion took it at 60, 144 and 240 frames;
//   - every switch flipped on the field (the particles, each kind, the dust) does what it says, end to end;
//   - a blast's burst and a Force front's particles by their ground: water throws spray alone (Q6);
//   - the program's own rules run as script (`glslRun.ts`): the record loop, the wind's thresholds, a leaf's rest, the
//     kills, the orographic lift over its fixed span at every detail (and taken a cell apart, the control), the pull, a
//     puff corner's height;
//   - the pools' memory by preset, the design's table and the settings' own sum.
//
// Plain type stripping; synthetic numbers only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AirField, newAirFrameInput, type AirWorld } from '../../../src/world/volumetrics/airField.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import type { GroundSample, GroundSampler } from '../../../src/world/volumetrics/airRaster.ts';
import { newVolTune, VOL_PRESET_NAMES, VOL_PRESETS, VOL_RANGES, volMemoryMB, type VolTune } from '../../../src/world/volumetrics/volSettings.ts';
import { CLASS_INDEX, KICK_KIND, KICK_LOOK, newOwed, OwedTable, packColour, recordOf, SPAWN_MOST, SpawnTable, unpackColour, WHITE_PACKED } from '../../../src/world/volumetrics/airSpawn.ts';
import { driftOver, leafRestIn, oroLiftAt, pickThreshold, pullShare, streakLength, type LeafRest } from '../../../src/world/volumetrics/airParticleMath.ts';
import { KICK_COUNTS, KICK_WIDTH, KickPool, kickBytes, kickRows, newKickLight } from '../../../src/world/volumetrics/airParticles.ts';
import { rainBytes } from '../../../src/world/volumetrics/airRain.ts';
import { KICK_DRAW_FRAGMENT, KICK_DRAW_VERTEX, KICK_LIFT_GLSL, KICK_ORO_GLSL, KICK_STREAK_GLSL, KICK_UPDATE_FRAGMENT, RING_VERTEX } from '../../../src/world/volumetrics/airParticleShaders.ts';
import { glslFunctions, glslFunctionText } from './glslRun.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const here = dirname(fileURLToPath(import.meta.url));
const source = (p: string): string => readFileSync(join(here, '..', '..', '..', 'src', p), 'utf8').replace(/\r\n/g, '\n');

// --- the colour in one float ---
{
  const out: [number, number, number] = [0, 0, 0];
  let worst = 0;
  for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.9], [0.003, 0.04, 0.6], [0.8, 0.31, 0.07]]) {
    const p = packColour(c[0], c[1], c[2]);
    unpackColour(p, out);
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(Math.pow(out[i], 1 / 2.2) - Math.pow(c[i], 1 / 2.2)));
    if (Math.fround(p) !== p) worst = 1;
  }
  ok(worst <= 0.5 / 255 + 1e-9 && WHITE_PACKED === packColour(1, 1, 1) && WHITE_PACKED < 16777216, `a colour packed into one float comes back within half a step of its own, and is exact in a float32 (worst ${worst.toFixed(5)})`);
  // The program unpacks in a float32: p + 0.5 rounds to the next even number from 2^23 up, which took white to 2^24 and
  // drew every drop of spray black (the smoke check); floor(p + 0.25) is the number itself for every packed colour.
  let exact = true;
  for (const p of [WHITE_PACKED, WHITE_PACKED - 2, 8388609, 8388608, 12345677, 1, 0]) if (Math.floor(Math.fround(Math.fround(p) + 0.25)) !== p) exact = false;
  ok(exact && Math.trunc(Math.fround(WHITE_PACKED + 0.5)) === 16777216 && /int i = int\(floor\(p \+ 0\.25\)\);/.test(KICK_DRAW_VERTEX), "the program's unpack, run in a float32, is the packed number itself for white and every odd colour past 2^23 (where p + 0.5 is not: white came back 2^24, black)");
}

// --- a source's count, the fraction carried ---
{
  const counted = (fps: number): number => {
    const t = new OwedTable(8);
    const q = newOwed();
    let sum = 0;
    for (let i = 0; i < fps * 2; i++) {
      q.key = 7;
      q.kind = KICK_KIND.streak;
      q.amount = 37.3 / fps;
      t.owe(q);
      sum += q.n;
    }
    return sum;
  };
  const a = counted(60);
  const b = counted(144);
  const c = counted(240);
  ok(Math.abs(a - 74.6) <= 1 && Math.abs(b - 74.6) <= 1 && Math.abs(c - 74.6) <= 1, `37.3 a second over two seconds of frames is 74 or 75 at 60, 144 and 240 frames a second (${a}, ${b}, ${c}): the fraction is carried`);
  const t = new OwedTable(2);
  const q = newOwed();
  for (const key of [1, 2, 3]) {
    q.key = key;
    q.kind = 0;
    q.amount = 0.6;
    t.owe(q);
  }
  q.key = 1;
  q.amount = 0.6;
  t.owe(q);
  ok(q.n === 0, 'a fixed table: the source seen longest ago gives its place up past its size and its fraction starts again');
}

// --- the spawn table ---
{
  const s = new SpawnTable();
  const a = s.arg;
  a.fill(0);
  a[3] = 3;
  a[12] = KICK_KIND.puff;
  s.on[KICK_KIND.puff] = false;
  ok(!s.addArgs() && s.count === 0, 'a record of a kind switched off is not taken');
  s.on[KICK_KIND.puff] = true;
  for (let i = 0; i < SPAWN_MOST + 3; i++) s.addArgs();
  ok(s.count === SPAWN_MOST && s.seen.dropped === 3 && s.asked[KICK_KIND.puff] === SPAWN_MOST * 3, `the frame takes ${SPAWN_MOST} records and counts the rest dropped`);
  ok(recordOf(4, [3, 8, 2, 5], 0, 2) === 1 && recordOf(9, [3, 8], 0, 2) === -1 && recordOf(0, [3, 8, 2, 5], 2, 4) === 2, "a slot takes the first record whose cumulative end is past its place in the ring, and none past the last (the program's loop)");
}

// --- window-relative steps ---
{
  const rel = [60, 144, 240].map((fps) => driftOver(50, 0.05, 10, fps));
  const abs = driftOver(8000, 0.05, 10, 240);
  ok(rel.every((d) => Math.abs(d - 0.5) < 0.005), `a drift of 5 cm a second kept relative to the window's corner goes its own 0.5 m in ten seconds, within a hundredth, at 60, 144 and 240 frames a second (${rel.map((d) => d.toFixed(4)).join(', ')}: a float32's own rounding of a step a fifth of a millimetre long)`);
  ok(abs < 0.1, `where kept in the world's frame eight kilometres out it stalls at 240 (${abs.toFixed(4)} m): the reason the pool keeps the corner`);
}

// --- a streak along its own motion ---
{
  const S = { x: 0.08, y: 0.25, z: 3, w: 0.025 };
  const fns = glslFunctions(KICK_STREAK_GLSL, ['airStreakLength'], { uStreakD: S });
  let same = true;
  for (const v of [0, 0.5, 3, 3.2, 12, 40, 80]) if (Math.abs(fns.airStreakLength(v) - streakLength(v, S.x, S.y, S.z)) > 1e-12) same = false;
  ok(same && streakLength(10, 0.08, 0.25, 3) === 0.8 && streakLength(1, 0.08, 0.25, 3) === 0.25 && streakLength(100, 0.08, 0.25, 3) === 3, "a streak is as long as its speed over its trail, held between its least and most: the program's own line, run, is the mirror's");
  const v = KICK_DRAW_VERTEX;
  ok(/vec3 dir = sp > 1e-4 \? vel \/ sp : vec3\(0\.0, 1\.0, 0\.0\);/.test(v) && v.includes('float len = min(airStreakLength(sp), most);') && v.includes('vec4 tail = viewMatrix * (world - vec4(dir * len, 0.0));') && v.includes('vec4 p = mix(tail, mvPosition, corner.y + 0.5);'), 'and drawn from its head back along its own velocity, vertical as much as across, never taller on the screen than the clamp');
  ok(v.includes('float wid = max(uStreakD.w, uDrawE.w * pixel);'), 'never under the least pixels wide');
}

// --- the field, driven ---

/**
 * What the kick-up's update was handed at one draw: each kind's [first row, rows, head, starts] and [records' first, end,
 * on, pickup share], the records, the corner's height, the window's moves owed (metres), the window's corner and the dt.
 */
interface KickDraw {
  kind: number[][];
  on: number[][];
  recA: number[];
  recD: number[];
  corner: number;
  shift: [number, number, number];
  win: [number, number];
  dt: number;
}

function standIn(): { renderer: THREE.WebGLRenderer; kicks: KickDraw[]; names: string[] } {
  const kicks: KickDraw[] = [];
  const names: string[] = [];
  let target: unknown = null;
  const gl = { getExtension: (): object => ({}), RED: 6403, RG: 33319, IMPLEMENTATION_COLOR_READ_FORMAT: 35739, getParameter: (): number => 6408 };
  const record = (material: THREE.Material): void => {
    names.push(material.name);
    if (material.name !== 'air.kick') return;
    const u = (material as THREE.ShaderMaterial).uniforms;
    const v4 = (list: THREE.Vector4[]): number[][] => list.map((q) => [q.x, q.y, q.z, q.w]);
    const on = v4(u.uKindOn.value as THREE.Vector4[]);
    const n = on[3][1];
    const ks = u.uKickShift.value as THREE.Vector4;
    const wv = u.uWindow.value as THREE.Vector4;
    const kp = u.uKickP.value as THREE.Vector4;
    kicks.push({ kind: v4(u.uKind.value as THREE.Vector4[]), on, recA: Array.from((u.uRecA.value as Float32Array).subarray(0, n * 4)), recD: Array.from((u.uRecD.value as Float32Array).subarray(0, n * 4)), corner: kp.z, shift: [ks.x, ks.y, ks.z], win: [wv.x, wv.y], dt: kp.x });
  };
  const renderer = {
    autoClear: true,
    getContext: () => gl,
    getRenderTarget: (): unknown => target,
    setRenderTarget: (t: unknown): void => {
      target = t;
    },
    getClearAlpha: (): number => 1,
    getClearColor: (c: THREE.Color): THREE.Color => c.setRGB(0, 0, 0),
    setClearColor: (): void => undefined,
    clear: (): void => undefined,
    getDrawingBufferSize: (v: THREE.Vector2): THREE.Vector2 => v.set(1920, 1080),
    render(obj: THREE.Object3D, cam: THREE.Camera): void {
      if ((obj as THREE.Scene).isScene) {
        (obj as THREE.Scene).onAfterRender(renderer as unknown as THREE.WebGLRenderer, obj as THREE.Scene, cam, null as never, null as never, null as never);
        return;
      }
      record((obj as THREE.Mesh).material as THREE.Material);
    },
    renderBufferDirect(_cam: THREE.Camera, _scene: THREE.Scene, _geo: THREE.BufferGeometry, material: THREE.Material): void {
      record(material);
    },
    compile: (): void => undefined,
    info: { programs: [] as unknown[] },
    properties: { get: (): object => ({}) },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, kicks, names };
}

/** Flat ground: sand west of x 0, grass from 0 to 60, water past 60 (its surface the ground). */
const ground: GroundSampler = {
  sample(x: number, _z: number, out: GroundSample): boolean {
    out.h = 0;
    out.family = x < 0 ? 1 : 3;
    out.medium = x >= 60 ? 2 : 1;
    out.tint = -1;
    return true;
  },
};

interface Rig {
  field: AirField;
  tune: VolTune;
  kicks: KickDraw[];
  names: string[];
  inp: ReturnType<typeof newAirFrameInput>;
  grains: { n: number };
  frame(dt: number): KickDraw[];
}

function rig(world: Partial<AirWorld> = {}): Rig {
  const { renderer, kicks, names } = standIn();
  const tune = newVolTune();
  tune.on = true;
  const field = new AirField(renderer, tune, { ground, boxes: null, hulls: [], ...world });
  field.raster.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 85, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
  field.raster.familyColour = new Uint8Array([0, 0, 0, 0, 204, 168, 117, 255, 0, 0, 0, 0, 90, 140, 60, 255]);
  field.raster.familyClass = new Uint8Array([0, CLASS_INDEX.sand, 0, CLASS_INDEX.grass]);
  const grains = { n: 0 };
  field.forces.onGrains = (_x, _y, _z, count) => void (grains.n += count);
  const inp = newAirFrameInput();
  inp.reading = true;
  inp.camX = 30;
  inp.windHeading = 0.4;
  inp.windSpeed = 1;
  inp.sunY = 0.8;
  inp.sunZ = 0.6;
  const frame = (dt: number): KickDraw[] => {
    const from = kicks.length;
    inp.dt = dt;
    inp.time += dt;
    field.update(inp);
    return kicks.slice(from);
  };
  for (let i = 0; i < 400 && (field.raster.unknown > 0 || i < 4); i++) frame(1 / 60);
  frame(1 / 60);
  return { field, tune, kicks, names, inp, grains, frame };
}

/** Each kind's starts summed over `seconds` of frames at `fps`, with what the records said of the look. */
function run(r: Rig, fps: number, seconds: number): { starts: number[]; wake: number; plain: number } {
  const starts = [0, 0, 0, 0];
  let wake = 0;
  let plain = 0;
  for (let i = 0; i < Math.round(fps * seconds); i++) {
    for (const d of r.frame(1 / fps)) {
      for (let k = 0; k < 4; k++) starts[k] += d.kind[k][3];
      for (let i2 = 0; i2 < d.recD.length / 4; i2++) {
        if (d.recD[i2 * 4] !== KICK_KIND.spray) continue;
        if (d.recD[i2 * 4 + 1] === KICK_LOOK.wake) wake++;
        else plain++;
      }
    }
  }
  return { starts, wake, plain };
}

// The pool steps and shows every frame the field runs, and is hidden on any other.
{
  const r = rig();
  const k = r.field.kick;
  ok(k.stats.steps > 0 && k.stats.hiddenWhileRun === 0 && k.meshes[KICK_KIND.streak].visible && !k.meshes[KICK_KIND.leaf].visible, "the field settled, the pool stepped every frame it ran and was never hidden while it ran; the streaks (which need no picture) are shown and the leaves (no picture yet) are not");
  const before = r.kicks.length;
  r.inp.where = 'a test: indoors';
  r.frame(1 / 60);
  ok(r.kicks.length === before && k.meshes.every((m) => !m.visible) && k.stats.hiddenWhileRun === 0, 'a frame the field does not run steps nothing and hides every draw');
  r.inp.where = null;
  r.frame(1 / 60);
  ok(r.kicks.length === before + 1 && k.meshes[KICK_KIND.streak].visible, 'and the next frame it runs, it steps and shows again');
  const quiet = run(r, 60, 2);
  ok(quiet.starts.every((n) => n === 0), 'with no source at all, no record of any kind: nothing starts without a source');
  const last = r.kicks[r.kicks.length - 1];
  ok(last.on[KICK_KIND.streak][3] === 0 && last.on[KICK_KIND.spray][3] === 0 && last.on[KICK_KIND.leaf][3] === 1 && last.on[KICK_KIND.puff][3] === 1, "the wind's pickups: leaves and puffs past their threshold, never spray, and streaks only in a storm");
  r.inp.storm = 1;
  r.frame(1 / 60);
  const storm = r.kicks[r.kicks.length - 1];
  ok(storm.on[KICK_KIND.streak][3] === AIR_TUNE.particles.streakStorm, `in a storm the wind picks streaks up too (at ${AIR_TUNE.particles.streakStorm} of a leaf's tries)`);
}

// A jet on grass, on sand, on water: what it throws, counted alike at every frame rate.
{
  const grass = (fps: number) => {
    const r = rig();
    r.field.testEngine = { x: 20, y: 1.2, z: 0, dx: 0, dy: -1, dz: 0, exit: 30 };
    return run(r, fps, 2);
  };
  const g60 = grass(60);
  const g144 = grass(144);
  const g240 = grass(240);
  ok(g60.starts[KICK_KIND.leaf] > 10 && g60.starts[KICK_KIND.puff] === 0 && g60.starts[KICK_KIND.spray] === 0 && g60.starts[KICK_KIND.streak] === 0, `a jet bearing down on grass throws leaves and nothing else (${g60.starts.join(', ')} over two seconds)`);
  const leaves = [g60, g144, g240].map((g) => g.starts[KICK_KIND.leaf]);
  ok(Math.max(...leaves) - Math.min(...leaves) <= 2, `the same leaves over two seconds at 60, 144 and 240 frames a second (${leaves.join(', ')})`);

  const sand = (exit: number) => {
    const r = rig();
    r.field.testEngine = { x: -30, y: 1.2, z: 0, dx: 0, dy: -1, dz: 0, exit };
    return run(r, 60, 2);
  };
  const hard = sand(40);
  const soft = sand(4);
  ok(hard.starts[KICK_KIND.puff] > 0 && hard.starts[KICK_KIND.streak] > 0 && hard.starts[KICK_KIND.leaf] === 0 && hard.starts[KICK_KIND.spray] === 0, `a strong jet on sand throws puffs and fine streaks (${hard.starts.join(', ')})`);
  ok(soft.starts[KICK_KIND.puff] > 0 && soft.starts[KICK_KIND.streak] === 0, `a jet too weak to pass the streaks' wash (under half of ${AIR_TUNE.particles.streakWash} m/s where it lands) throws puffs and no streak (${soft.starts.join(', ')})`);

  const water = (fps: number) => {
    const r = rig();
    r.field.testEngine = { x: 90, y: 1.2, z: 0, dx: 0, dy: -1, dz: 0, exit: 30 };
    const got = run(r, fps, 2);
    return { ...got, grains: r.grains.n };
  };
  const w = water(60);
  ok(w.starts[KICK_KIND.spray] > 10 && w.starts[KICK_KIND.leaf] === 0 && w.starts[KICK_KIND.puff] === 0 && w.starts[KICK_KIND.streak] === 0 && w.grains === 0 && w.wake === 0 && w.plain > 0, `water throws water (Q6): a jet bearing down on it throws spray and never a leaf, a puff, a streak or a grain (${w.starts.join(', ')}; ${w.grains} grains)`);
  const skim = (fps: number) => {
    const r = rig();
    r.field.testEngine = { x: 90, y: 0.6, z: 0, dx: 0, dy: 0, dz: -1, exit: 30, vx: 0, vz: 15 };
    return run(r, fps, 2);
  };
  const s60 = skim(60);
  const s144 = skim(144);
  const s240 = skim(240);
  const wakes = [s60, s144, s240].map((s) => s.starts[KICK_KIND.spray]);
  ok(s60.wake > 0 && s60.plain === 0 && s60.starts[KICK_KIND.leaf] === 0 && s60.starts[KICK_KIND.puff] === 0, `a machine skimming water at 15 m/s throws the game's own trail's look behind it (Q14), every record of it a wake's (${s60.wake} records)`);
  ok(Math.max(...wakes) - Math.min(...wakes) <= 2 && wakes[0] > 0, `the wake counted by the metres travelled, the same at 60, 144 and 240 frames a second (${wakes.join(', ')})`);
}

// The records as the update takes them.
{
  const r = rig();
  const k = r.field.kick;
  const sp = r.field.spawns;
  const a = sp.arg;
  const put = (kind: number, n: number, x: number, y: number, z: number, look: number, spare: number): void => {
    a.fill(0);
    a[0] = x;
    a[1] = y;
    a[2] = z;
    a[3] = n;
    a[9] = 0.1;
    a[10] = 2;
    a[11] = spare;
    a[12] = kind;
    a[13] = look;
    a[15] = 4;
    sp.addArgs();
  };
  const headBefore = r.kicks[r.kicks.length - 1].kind.map((q) => q[2]);
  put(KICK_KIND.puff, 2, -20, 3, 5, 0, 0);
  put(KICK_KIND.leaf, 3, 10, 1, 2, 0, 0);
  put(KICK_KIND.spray, 4, 80, 0.5, 1, 0, 0.25);
  put(KICK_KIND.leaf, 5, 12, 1, 2, 0, 0);
  const d = r.frame(1 / 60)[0];
  const w = r.field.win;
  ok(d.kind[KICK_KIND.leaf][3] === 8 && d.kind[KICK_KIND.puff][3] === 2 && d.kind[KICK_KIND.spray][3] === 4 && d.kind[KICK_KIND.streak][3] === 0, 'four records staged in any order reach the update as each kind\'s starts: 8 leaves, 2 puffs, 4 spray');
  ok(d.on[KICK_KIND.leaf][0] === 0 && d.on[KICK_KIND.leaf][1] === 2 && d.on[KICK_KIND.puff][0] === 2 && d.on[KICK_KIND.puff][1] === 3 && d.on[KICK_KIND.spray][0] === 3 && d.on[KICK_KIND.spray][1] === 4, 'sorted by kind, each kind\'s records a run of its own');
  ok(d.recA[3] === 3 && d.recA[7] === 8 && d.recA[11] === 2 && d.recA[15] === 4, 'their counts cumulative within each kind');
  ok(Math.abs(d.recA[0] - (10 - w.ox)) < 1e-9 && Math.abs(d.recA[1] - (1 - d.corner)) < 1e-9 && Math.abs(d.recA[2] - (2 - w.oz)) < 1e-9, "a record's place taken to the window's corner and the pool's own corner height");
  ok(Math.abs(Array.from(r.field.kick.updateMaterial.uniforms.uRecC.value as Float32Array)[3 * 4 + 3] - 0.25) < 1e-6 && /if \(kind == 2 && v\.y < 0\.0 && pos\.y \+ cornerY < spare && age > 0\.1\) \{\n\s*dead = true;\n\s*landed = true;/.test(r.field.kick.updateMaterial.fragmentShader), "spray's water surface kept a world height, which the program meets with the place plus the corner's height (so a corner moved later never leaves it wrong)");
  const size = k.rows[KICK_KIND.leaf] * KICK_WIDTH;
  const next = r.frame(1 / 60)[0];
  ok(next.kind[KICK_KIND.leaf][2] === (headBefore[KICK_KIND.leaf] + 8) % size && next.kind[KICK_KIND.puff][2] === (headBefore[KICK_KIND.puff] + 2) % (k.rows[KICK_KIND.puff] * KICK_WIDTH), "each kind's ring head moved on by what it started");
  // The ring wraps: bursts that take the leaves past their last slot come round to their first.
  const h0 = next.kind[KICK_KIND.leaf][2];
  for (let i = 0; i < 5; i++) put(KICK_KIND.leaf, 400, 10, 1, 2, 0, 0);
  r.frame(1 / 60);
  put(KICK_KIND.leaf, 100, 10, 1, 2, 0, 0);
  r.frame(1 / 60);
  const after = r.frame(1 / 60)[0];
  ok(h0 + 2100 > size && after.kind[KICK_KIND.leaf][2] === (h0 + 2100) % size, `and wraps round its ${size} slots (${h0} + 2100 comes round to ${after.kind[KICK_KIND.leaf][2]})`);
  // A record that would overrun its kind's slots is not taken; the rest of the frame's are.
  put(KICK_KIND.puff, KICK_COUNTS[KICK_KIND.puff] + 1, -20, 3, 5, 0, 0);
  put(KICK_KIND.puff, 1, -20, 3, 5, 0, 0);
  const over = r.frame(1 / 60)[0];
  ok(over.kind[KICK_KIND.puff][3] === 1, 'a record that would start more than its kind has slots is left out, and the next one taken');
}

// The feet (the owner's Q17): a couple of leaves a running step on grass, spray where it wades, nothing walking or on sand.
{
  const r = rig();
  const f = r.field;
  const step = (x: number, key = 5, from: 'terrain' | 'water' = 'terrain') => ({ key, kind: 'mobile' as const, label: 'a body', surface: 'grass', from, x, y: 0, z: 0, heading: 0, scale: 1, inside: false, deck: null, ground: null });
  const after = (seconds: number): number[] => {
    const starts = [0, 0, 0, 0];
    for (let i = 0; i < Math.round(seconds * 60); i++) for (const d of r.frame(1 / 60)) for (let k = 0; k < 4; k++) starts[k] += d.kind[k][3];
    return starts;
  };
  ok(!f.kickFeet(step(10)) && f.kickFeetCounts.steps === 1, "a body's first step only marks where it was");
  after(0.25);
  ok(f.kickFeet(step(12)) && after(0.02)[KICK_KIND.leaf] === AIR_TUNE.particles.feetLeaves, `a step 2 m on a quarter second later (running) kicks ${AIR_TUNE.particles.feetLeaves} leaves off the grass`);
  after(0.5);
  ok(!f.kickFeet(step(12.6)) && after(0.02).every((n) => n === 0), 'a walking step kicks nothing');
  ok(!f.kickFeet(step(-20, 6)), 'and a body new to the sand only marks where it was');
  after(0.25);
  ok(!f.kickFeet(step(-18, 6)) && after(0.02).every((n) => n === 0), 'running on sand kicks no leaf (the dust and the prints are its own)');
  ok(!f.kickFeet(step(80, 7, 'water')), 'a body new to the water marks where it was');
  after(0.25);
  ok(f.kickFeet(step(82, 7, 'water')) && after(0.02)[KICK_KIND.spray] === AIR_TUNE.particles.feetSpray, `a running wader kicks ${AIR_TUNE.particles.feetSpray} drops of spray`);
  r.tune.fromFeet = false;
  after(0.25);
  ok(!f.kickFeet(step(14)), 'with the feet off (volFromFeet), nothing');
}

// No detail of the pool disposes a material, and the rows are the counts' over the width.
{
  const kp = new KickPool(
    { window: { value: new THREE.Vector4() }, wind: { value: new THREE.Vector2() }, height: { value: null }, obstacles: { value: null }, klass: { value: null }, colour: { value: null }, tint: { value: null }, light: { value: null }, lightShift: { value: new THREE.Vector2() }, lightHeights: { value: new THREE.Vector4() }, slabTiles: { value: [] }, slabScale: { value: new THREE.Vector4() }, slabShare: { value: new THREE.Vector4() }, atlasHalf: { value: new THREE.Vector2() }, slabMid: { value: new THREE.Vector4() }, obstacleOver: { value: 0 }, hullInverse: { value: new THREE.Matrix4() }, hullBox: { value: new THREE.Vector4() }, groundTint: { value: new THREE.Vector4() }, groundTintRef: { value: new THREE.Vector4() } },
    newKickLight(),
  );
  let disposed = 0;
  for (const m of kp.materials()) m.addEventListener('dispose', () => disposed++);
  let sized = 0;
  for (const d of [0.5, 1, 2, 1 / 64, 1]) if (kp.ensure(d)) sized++;
  const rows = kickRows(2);
  ok(sized === 5 && disposed === 0 && rows.every((n, i) => n * KICK_WIDTH === KICK_COUNTS[i] * 2), `five details made, no material disposed, and each kind's slots its count at the detail (${rows.map((n) => n * KICK_WIDTH).join(', ')} at ×2)`);
  ok(kp.meshes.every((m) => (m.geometry as THREE.InstancedBufferGeometry).instanceCount === kp.rows[kp.meshes.indexOf(m)] * KICK_WIDTH), 'each draw instances exactly its kind\'s slots, no instanced attribute');
  ok(kp.materials().length === 7 && kp.materials()[6] === kp.ringMaterial && kp.blendMaterials.every((m) => m.vertexShader === kp.cutMaterial.vertexShader && m.fragmentShader === kp.cutMaterial.fragmentShader && m.defines?.KICK_CUT === undefined) && kp.cutMaterial.defines?.KICK_CUT === '', 'two draw programs: the leaves cut (one define), the puffs, spray and streaks blended over the same text');
}

// The window's whole-cell scroll and the corner's moves carried (§2.16): what the field hands the update as the moves owed
// (`uKickShift`), taken off a slow particle by the program's own rule in float32 relative to the corner as the card keeps
// it, leaves that particle's world place where its own motion took it, eight kilometres out, at 60, 144 and 240 frames a
// second, through a ride that moves the window every few frames and the corner more than once.
{
  ok(KICK_UPDATE_FRAGMENT.includes('vec3 pos = s0.xyz - uKickShift.xyz;') && KICK_UPDATE_FRAGMENT.includes('pos += v * dt;'), "the program takes the moves owed off a particle's place (s0 - uKickShift) before it moves it");
  const ride = (fps: number): { worst: number; moves: number; corners: number; owedOnce: boolean } => {
    const r = rig();
    r.inp.camX = 8000;
    r.inp.camZ = 8000;
    for (let i = 0; i < 800 && (r.field.raster.unknown > 0 || i < 4); i++) r.frame(1 / fps);
    const v = [0.05, 0.02, -0.03];
    const start = [8010, 3, 8005];
    let p: number[] | null = null;
    let prev: KickDraw | null = null;
    let t = 0;
    let worst = 0;
    let moves = 0;
    let corners = 0;
    let owedOnce = true;
    for (let i = 0; i < Math.round(fps * 3); i++) {
      r.inp.camX += 20 / fps;
      r.inp.camZ += 6 / fps;
      r.inp.camY += 4 / fps;
      for (const d of r.frame(1 / fps)) {
        // Owed once: the moves handed over are exactly what the window's corner and the pool's corner moved since the last update.
        if (prev && (d.shift[0] !== d.win[0] - prev.win[0] || d.shift[2] !== d.win[1] - prev.win[1] || d.shift[1] !== d.corner - prev.corner)) owedOnce = false;
        prev = d;
        if (!p) {
          p = [Math.fround(start[0] - d.win[0]), Math.fround(start[1] - d.corner), Math.fround(start[2] - d.win[1])];
          continue;
        }
        if (d.shift[0] !== 0 || d.shift[2] !== 0) moves++;
        if (d.shift[1] !== 0) corners++;
        for (let c = 0; c < 3; c++) {
          p[c] = Math.fround(p[c] - Math.fround(d.shift[c]));
          p[c] = Math.fround(p[c] + Math.fround(v[c] * Math.fround(d.dt)));
        }
        t += d.dt;
        const world = [d.win[0] + p[0], d.corner + p[1], d.win[1] + p[2]];
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(world[c] - (start[c] + v[c] * t)));
      }
    }
    return { worst, moves, corners, owedOnce };
  };
  for (const fps of [60, 144, 240]) {
    const g = ride(fps);
    ok(g.worst < 0.02 && g.moves > 10 && g.corners >= 2 && g.owedOnce, `${fps} frames a second, 8 km out, the window scrolled ${g.moves} times and the corner moved ${g.corners}: a 5 cm/s particle carried by the moves owed stays where its own motion took it (worst ${(g.worst * 1000).toFixed(2)} mm off), each move owed exactly once`);
  }
}

// The switches, end to end through the field (the owner's own on/off for every effect): the particles off steps, draws
// and stages nothing; each kind off starts none of its kind where its ground would; the dust off leaves them all.
{
  const jet = (x: number, exit = 30): Rig => {
    const r = rig();
    r.field.testEngine = { x, y: 1.2, z: 0, dx: 0, dy: -1, dz: 0, exit };
    return r;
  };
  {
    const r = jet(20);
    r.tune.particles = false;
    r.field.spawns.resetSeen();
    const before = r.kicks.length;
    const got = run(r, 60, 1);
    const seen = r.field.spawns.seen;
    ok(r.kicks.length === before && r.field.kick.meshes.every((m) => !m.visible) && seen.engines === 0 && got.starts.every((n) => n === 0) && r.field.kick.stats.hiddenWhileRun === 0, 'the particles off (volParticles): no update drawn, every draw hidden, and a jet on grass stages no record at all');
  }
  const kindOff = (x: number, exit: number, switchOff: (t: VolTune) => void): number[] => {
    const r = jet(x, exit);
    switchOff(r.tune);
    return run(r, 60, 2).starts;
  };
  const noLeaves = kindOff(20, 30, (t) => (t.leaves = false));
  ok(noLeaves.every((n) => n === 0), `the leaves off (volLeaves): a jet bearing down on grass starts none (${noLeaves.join(', ')})`);
  const noPuffs = kindOff(-30, 40, (t) => (t.puffs = false));
  ok(noPuffs[KICK_KIND.puff] === 0 && noPuffs[KICK_KIND.streak] > 0, `the puffs off (volPuffs): a strong jet on sand starts no puff and its streaks still (${noPuffs.join(', ')})`);
  const noStreaks = kindOff(-30, 40, (t) => (t.streaks = false));
  ok(noStreaks[KICK_KIND.streak] === 0 && noStreaks[KICK_KIND.puff] > 0, `the streaks off (volStreaks): no streak, its puffs still (${noStreaks.join(', ')})`);
  const noSpray = kindOff(90, 30, (t) => (t.spray = false));
  ok(noSpray.every((n) => n === 0), `the spray off (volSpray): a jet on water starts none (${noSpray.join(', ')})`);
  const noDust = kindOff(20, 30, (t) => (t.dust = false));
  ok(noDust[KICK_KIND.leaf] > 10, `with the dust off, an engine's records are still written by the sources' walk (${noDust[KICK_KIND.leaf]} leaves over two seconds)`);
}

// A blast's burst and a Force front's particles, at their own calls through the field (Q6: water throws water at every
// source that lifts dust elsewhere).
{
  const burst = (x: number, y: number): number[] => {
    const r = rig();
    r.field.blast(x, y, 0, 7, 1, 0);
    return r.frame(1 / 60)[0].kind.map((q) => q[3]);
  };
  const water = burst(90, 0.5);
  const grass = burst(20, 0.5);
  const sand = burst(-30, 0.5);
  const high = burst(20, 8);
  ok(water[KICK_KIND.spray] > 0 && water[KICK_KIND.leaf] === 0 && water[KICK_KIND.puff] === 0 && water[KICK_KIND.streak] === 0, `a blast on water throws spray and nothing else (${water.join(', ')})`);
  ok(grass[KICK_KIND.leaf] > 0 && grass[KICK_KIND.puff] === 0 && grass[KICK_KIND.spray] === 0 && grass[KICK_KIND.streak] === 0, `a blast on grass throws leaves (${grass.join(', ')})`);
  ok(sand[KICK_KIND.puff] > 0 && sand[KICK_KIND.streak] > 0 && sand[KICK_KIND.leaf] === 0 && sand[KICK_KIND.spray] === 0, `a blast on sand throws puffs and streaks (${sand.join(', ')})`);
  ok(high.every((n) => n === 0), `a blast higher over the ground than its own radius throws nothing (${high.join(', ')})`);
  const front = (x: number, dx: number, dz: number): number[] => {
    const r = rig();
    r.field.force(x, 1, 0, dx, dz, 1, 1, 12);
    return run(r, 60, 1.5).starts;
  };
  const fw = front(75, 1, 0);
  const fg = front(20, 0, 1);
  const fs = front(-30, 0, 1);
  ok(fw[KICK_KIND.spray] > 0 && fw[KICK_KIND.leaf] === 0 && fw[KICK_KIND.puff] === 0 && fw[KICK_KIND.streak] === 0, `a Force push over water throws spray along its wave and nothing else (${fw.join(', ')})`);
  ok(fg[KICK_KIND.leaf] > 0 && fg[KICK_KIND.puff] === 0 && fg[KICK_KIND.spray] === 0 && fg[KICK_KIND.streak] === 0, `over grass leaves (${fg.join(', ')})`);
  ok(fs[KICK_KIND.puff] > 0 && fs[KICK_KIND.streak] > 0 && fs[KICK_KIND.leaf] === 0 && fs[KICK_KIND.spray] === 0, `over sand puffs and streaks (${fs.join(', ')})`);
}

// The wind's streaks by the storm's own strength, half a storm half the tries.
{
  const r = rig();
  r.inp.storm = 0.5;
  r.frame(1 / 60);
  const d = r.kicks[r.kicks.length - 1];
  ok(Math.abs(d.on[KICK_KIND.streak][3] - AIR_TUNE.particles.streakStorm * 0.5) < 1e-12 && d.on[KICK_KIND.leaf][3] === 1, `half a storm, half the streaks' tries (${d.on[KICK_KIND.streak][3]} of ${AIR_TUNE.particles.streakStorm}); the leaves' tries whole`);
}

// The program's own lines, run as script against their mirrors (node compiles no GLSL).
{
  const U = KICK_UPDATE_FRAGMENT;
  // A dead slot's record: the first of its kind's records whose cumulative count is past its place in the range.
  const ends = [3, 8, 11, 2, 9, 10, 1, 4, 6, 7, 12, 30, 5, 5, 6, 40];
  const rec = glslFunctions(glslFunctionText(U, 'kickRecordOf'), ['kickRecordOf'], { uRecA: ends.map((w) => ({ w })) });
  let same = true;
  for (const [r0, r1] of [[0, 3], [3, 6], [6, 11], [11, 16], [0, 16], [2, 2]]) for (let ring = 0; ring <= 42; ring++) if (rec.kickRecordOf(ring, r0, r1) !== recordOf(ring, ends, r0, r1)) same = false;
  ok(same, "a dead slot finds its record by the program's own loop, the mirror's for every place in every run of records (a place on a run's cumulative end takes the next record)");
  // The wind's thresholds by kind.
  const pick = glslFunctions(glslFunctionText(U, 'kickPickThreshold'), ['kickPickThreshold'], { uPick: { y: 6.5, z: 0.8 }, uLiftB: { w: 0.4 } });
  ok([0, 1, 2, 3].every((k) => Math.abs(pick.kickPickThreshold(k) - pickThreshold(k, 6.5, 0.8, 0.4)) < 1e-12) && pickThreshold(3, 6.5, 0.8, 0.4) === 6.5 * 0.4 && pickThreshold(0, 6.5, 0.8, 0.4) === 6.5 * 0.8, "the wind lifts a leaf past its share of the sand's threshold and a streak past the storm's own share (streakLift): the program's line, run, is the mirror's");
  // A leaf lying, lifted or gone.
  const rest = glslFunctions(glslFunctionText(U, 'kickLeafRest'), ['kickLeafRest'], { uPick: { y: 6.5, z: 0.8 }, uLeaf: { z: 4 } });
  let restSame = true;
  for (const spare of [1e-4, 1, 3.99, 4.9, 4.995, 5.2]) {
    for (const air of [0, 3, 5.19, 5.21, 9]) {
      for (const dt of [1 / 240, 1 / 60, 0.1]) {
        const m: LeafRest = { rest: spare, air, threshold: 6.5, liftLeaf: 0.8, leafRest: 4, dt, lifted: false, gone: false };
        leafRestIn(m);
        if (rest.kickLeafRest(spare, air, dt) !== (m.lifted ? 1 : m.gone ? 2 : 0)) restSame = false;
      }
    }
  }
  ok(U.includes('if (kind == 0 && h <= 0.02 && v.y <= 0.0) {') && U.includes('pos.y = g + 0.02 - cornerY;') && U.includes('spare = 1e-4;') && U.includes('int rest = kickLeafRest(spare, length(a0), dt);'), 'a leaf falling onto the height raster lands two centimetres over it and starts lying (its spare its seconds lying), and a lying leaf asks kickLeafRest each frame');
  ok(restSame && rest.kickLeafRest(1, 5.21, 1 / 60) === 1 && rest.kickLeafRest(4.995, 0, 1 / 60) === 2 && rest.kickLeafRest(1, 0, 1 / 60) === 0, `a leaf lies its rest (${AIR_TUNE.particles.leafRest} s) and a second's fade, and is lifted again past ${AIR_TUNE.particles.liftLeaf} of the threshold: the program's rule, run, is the mirror's`);
  // The kills: out of the window, under the ground (a leaf lies on it instead), in a wall below its top, in a hall below its height.
  const over = 0.25;
  const kill = glslFunctions(glslFunctionText(U, 'kickKilledAt'), ['kickKilledAt'], {
    uObstacleOver: over,
    wallTop: (l: { x: number }) => (l.x >= 0.4 && l.x <= 0.6 ? 5 : 0),
    texture: (_s: unknown, l: { x: number }) => ({ g: l.x >= 0.4 && l.x <= 0.6 ? 5 : l.x >= 0.7 && l.x <= 0.8 ? 8 : 0 }),
    uObstacles: null,
  });
  const at = (x: number, h: number, kind: number): boolean => kill.kickKilledAt({ x, y: 0.5 }, h, kind) as unknown as boolean;
  ok(at(-0.1, 1, 1) && at(1.2, 1, 1) && at(0.2, 1, 1) === false, 'out of the window: killed');
  ok(!at(0.2, 1, 1) && at(0.2, -0.5, 1) && !at(0.2, -0.5, 0), 'free air lives; under the ground a puff is killed and a leaf is not (it lies on it)');
  ok(at(0.5, 3, 1) && !at(0.5, 6, 1) && at(0.75, 3, 2) && !at(0.75, 9, 2), "inside a wall below its top, or a compound's hall below its height: killed; over either, alive");
  // The orographic lift over a fixed span: a 10 m wall in a 5 m/s wind, its obstacle map rasterised at every detail.
  const oroText = KICK_LIFT_GLSL + KICK_ORO_GLSL;
  const peakAt = (cells: number, span: number, most: number): number => {
    const cell = 192 / cells;
    const texel = (i: number): number => {
      const c = (Math.min(cells - 1, Math.max(0, i)) + 0.5) * cell;
      return c >= 100 && c <= 110 ? 10 : 0;
    };
    const wallTop = (l: { x: number; y: number }): number => {
      if (l.x < 0 || l.y < 0 || l.x > 1 || l.y > 1) return 0;
      const u = l.x * cells - 0.5;
      const i0 = Math.floor(u);
      const f = u - i0;
      const r = texel(i0) * (1 - f) + texel(i0 + 1) * f;
      return r > over ? r : 0;
    };
    const fn = glslFunctions(oroText, ['airOroAt'], { uLift: { x: AIR_TUNE.particles.oroK, y: span, z: most, w: 0 }, uLiftB: { x: 0, y: 0, w: 0 }, groundAt: () => 0, wallTop, vec2: (x: number, y: number) => ({ x, y }) });
    let peak = 0;
    for (let x = 94; x <= 116; x += 0.25) peak = Math.max(peak, fn.airOroAt({ x: x / 192, y: 0.5 }, 5, 0, 192));
    return peak;
  };
  const details = VOL_RANGES.volAirDetail.options;
  const fixed = details.map((n) => peakAt(n, AIR_TUNE.particles.oroSpan, 100));
  const capped = details.map((n) => peakAt(n, AIR_TUNE.particles.oroSpan, AIR_TUNE.particles.oroMax));
  const cellApart = details.map((n) => peakAt(n, (2 * 192) / n, 100));
  const want = (AIR_TUNE.particles.oroK * 5 * 10) / AIR_TUNE.particles.oroSpan;
  ok(fixed.every((p) => Math.abs(p - want) < 1e-9), `over its fixed ${AIR_TUNE.particles.oroSpan} m span a 10 m wall in a 5 m/s wind lifts the same at every detail (${details.join(', ')} cells: ${fixed.map((p) => p.toFixed(2)).join(', ')} m/s before the cap)`);
  ok(capped.every((p) => Math.abs(p - AIR_TUNE.particles.oroMax) < 1e-12), `and held to its most, ${AIR_TUNE.particles.oroMax} m/s, never past it`);
  ok(Math.max(...cellApart) / Math.min(...cellApart) > 2.9, `where taken a cell apart (the control) it is ${cellApart.map((p) => p.toFixed(1)).join(', ')} m/s: three times apart by a preset`);
  const mirror = glslFunctions(oroText, ['airOroAt'], { uLift: { x: 0.5, y: 3, z: 3, w: 0 }, uLiftB: { x: 0, y: 0, w: 0 }, groundAt: (l: { x: number }) => 0.02 * l.x * 192, wallTop: (l: { x: number }) => (l.x * 192 > 50 ? 2 : 0), vec2: (x: number, y: number) => ({ x, y }) });
  let mSame = true;
  for (const x of [10, 49, 50.5, 51.2, 80]) if (Math.abs(mirror.airOroAt({ x: x / 192, y: 0.4 }, 3, -1, 192) - oroLiftAt((px) => 0.02 * px + (px > 50 ? 2 : 0), x, 0.4 * 192, 3, -1, 3, 0.5, 3)) > 1e-9) mSame = false;
  ok(mSame, "and the program's taps are the mirror's (oroLiftAt), the ground's slope and a wall's step both");
  // The pull toward the air, alike at any frame rate.
  const pull = glslFunctions(KICK_LIFT_GLSL, ['airPull']);
  let pullSame = true;
  for (const dt of [0, 1 / 240, 1 / 60, 0.1]) for (const tau of [0, 0.35, 0.6, 1.5]) if (Math.abs(pull.airPull(dt, tau) - pullShare(dt, tau)) > 1e-12) pullSame = false;
  const left = [60, 144, 240].map((fps) => {
    let keep = 1;
    for (let i = 0; i < fps; i++) keep *= 1 - pull.airPull(1 / fps, AIR_TUNE.particles.tauLeaf);
    return keep;
  });
  ok(pullSame && left.every((k) => Math.abs(k - Math.exp(-1 / AIR_TUNE.particles.tauLeaf)) < 1e-9), `the pull toward the air, run, is the mirror's, and a second of it leaves the same share untaken at 60, 144 and 240 frames a second (${left.map((k) => k.toFixed(6)).join(', ')})`);
  // A puff's corner: its own height over its middle in the world, whatever the camera's turn and roll.
  let riseWorst = 0;
  const cam = new THREE.PerspectiveCamera();
  for (const [yaw, pitch, roll] of [[0, 0, 0], [0.7, -0.4, 0], [2.1, 0.9, 0.3], [-1.2, -1.3, -0.8], [3, 0.2, 1.4]]) {
    cam.position.set(4, 12, -3);
    cam.rotation.set(pitch, yaw, roll, 'YXZ');
    cam.updateMatrixWorld();
    const e = cam.matrixWorldInverse.elements;
    const viewMatrix = [[e[0], e[1], e[2], e[3]], [e[4], e[5], e[6], e[7]], [e[8], e[9], e[10], e[11]], [e[12], e[13], e[14], e[15]]];
    const fn = glslFunctions(glslFunctionText(KICK_DRAW_VERTEX, 'airCornerRise'), ['airCornerRise'], { viewMatrix });
    const P = new THREE.Vector3(10, 2, 7);
    for (const [ox, oy] of [[0.5, 0.5], [-0.6, 0.3], [0.2, -0.9]]) {
      const pv = P.clone().applyMatrix4(cam.matrixWorldInverse);
      pv.x += ox;
      pv.y += oy;
      const back = pv.applyMatrix4(cam.matrixWorld);
      riseWorst = Math.max(riseWorst, Math.abs(fn.airCornerRise({ x: ox, y: oy }) - (back.y - P.y)));
    }
  }
  ok(riseWorst < 1e-9 && KICK_DRAW_VERTEX.includes('rise = airCornerRise(off);') && KICK_DRAW_VERTEX.includes('vKickLocal = vec3(local.x, hOver + rise, local.z);') && KICK_DRAW_FRAGMENT.includes('a *= smoothstep(0.0, max(uFragK.z, 1e-3), vKickLocal.y);'), `a puff's corner carries its own height over the ground to its fragments (the offset turned back to the world, run against three's own matrices, worst ${riseWorst.toExponential(1)} m), so its lower edge fades by each fragment's height`);
  ok(/vKickLightSun = swgD >= 0\.0 \? \(uSwgCardFront - uSwgCardTangent\) \* \(swgD \* T\)/.test(KICK_DRAW_VERTEX) && KICK_DRAW_VERTEX.indexOf('float T = 1.0;') < KICK_DRAW_VERTEX.indexOf('#ifdef KICK_CUT\n    // The leaf cards'), "the leaves take the air's light toward the sun at their height (their sun's share times it), as the blended kinds do");
}

// The pools' memory by preset: the design's §2.16 table for its three kinds, the fine streaks' row beside it, and the
// settings' own sum (`volMemoryMB`) the very same numbers.
{
  const DESIGN_MB: Record<string, number> = { low: 0.42, medium: 0.84, high: 1.37, ultra: 2.74 };
  for (const name of VOL_PRESET_NAMES) {
    const p = VOL_PRESETS[name];
    const pd = p.volParticleDetail;
    const streakRow = kickRows(pd)[KICK_KIND.streak] * KICK_WIDTH * 16 * 3 * 2;
    const three = kickBytes(pd) - streakRow + rainBytes(p.volRainDetail);
    ok(Math.abs(three / 1e6 - DESIGN_MB[name]) < 0.006, `${name}: the leaves, puffs, spray and drops take ${(three / 1e6).toFixed(3)} MB, the design's ${DESIGN_MB[name]}, and the fine streaks ${(streakRow / 1e6).toFixed(3)} MB more`);
  }
  const t = newVolTune();
  const big = { ...t, particleDetail: 2, rainDetail: 32768 };
  const none = { ...t, particles: false, rain: false, snow: false };
  const diff = (kickBytes(2) - kickBytes(1 / 64) + rainBytes(32768) - rainBytes(128)) / (1024 * 1024);
  ok(Math.abs(volMemoryMB(big, 1600, 900) - volMemoryMB(none, 1600, 900) - diff) < 0.11, `and the settings' memory sum counts the pools as the pools are made (${diff.toFixed(2)} MB between Ultra's and none)`);
}

// The world's hand-overs, which every behaviour test above makes for itself: the class table, the feet, the pictures.
{
  const world = source('world/world.ts');
  ok(world.includes('fillClassTable(this.packId ?? \'\', families, klass);') && world.includes('air.raster.familyClass = klass;'), "the world hands the field each family's ground class with the responses (airTables)");
  const main = source('main.ts');
  ok(/const air = this\.world\.air;\n\s+if \(!air\?\.dentStep\(step\)\) footprints\.stepHook\(step\);\n\s+if \(air\) air\.kickFeet\(step\);/.test(main), "a running foot's leaves and spray are asked beside the print, never in its place");
  const field = source('world/volumetrics/airField.ts');
  ok(field.includes("if (!t.on || !t.air || !t.particles || !t.fromFeet || !this.forces.active || step.inside || step.deck !== null) return false;"), 'the feet kick nothing with the master, the air, the particles or the feet off, indoors or on a deck');
}

// --- the fifth wave: a drop of spray landing back in the water rings it, and nothing else does ---
{
  // The ring draw's own choice of slot and its place in the ripples, run as script out of its program.
  const uRingW = { x: 100, y: -40, z: 192, w: 0.375 };
  const ring = glslFunctions(['ringLanded', 'ringU', 'ringV'].map((f) => glslFunctionText(RING_VERTEX, f)).join('\n'), ['ringLanded', 'ringU', 'ringV'], { uRingW });
  const landed = (life: number, spare: number): boolean => ring.ringLanded(life, spare) as unknown as boolean;
  ok(landed(0, -1), 'a slot the update kept dead (life nought) with a spare of -1 is a drop that landed: a ring');
  ok(!landed(0.8, -160) && !landed(0.8, -210) && !landed(0.3, -1) && !landed(1.2, -0.7), "a living drop is never a ring whatever its spare: over Naboo's seas at -160 and -210 m, and even a drop whose water stands at exactly -1 m (its life is asked first)");
  ok(!landed(0, 0) && !landed(0, 12.5) && !landed(0, -0.5), 'nor a slot simply dead (all nought), nor one whose spare is any other height');
  ok(Math.abs((ring.ringU(100 + 192 * 0.25) as number) - 0.25) < 1e-12 && Math.abs((ring.ringV(-40 + 192 * 0.25) as number) - 0.75) < 1e-12, "a ring stands at the ripples' u along world X and their v against world Z (rippleCarry.test holds both to waterSim's own pokes at every detail)");
  ok(RING_VERTEX.includes('vec4 s1 = texelFetch(uS1, t, 0);') && RING_VERTEX.includes('if (!ringLanded(s1.w, s2.z) || uRingW.z <= 0.0) {') && RING_VERTEX.includes('vec2 uv = vec2(ringU(xz.x), ringV(xz.y));'), 'the ring draw asks ringLanded of each slot\'s life and spare and places it by ringU and ringV: the functions run here');
  // The update keeps a landed drop, and nothing else, for its ring: dead (o1 nought), its place kept, its spare -1.
  ok(/o0 = vec4\(0\.0\);\n\s*o1 = vec4\(0\.0\);\n\s*o2 = vec4\(0\.0\);/.test(KICK_UPDATE_FRAGMENT) && /if \(dead\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(landed && uRing\.x > 0\.5 && fin4\(vec4\(pos, age\)\)\) \{\n\s*o0 = vec4\(pos, age\);\n\s*o2 = vec4\(seed, sz, -1\.0, col\);\n\s*\}\n\s*return;\n\s*\}/.test(KICK_UPDATE_FRAGMENT), "the update keeps a drop that landed, while the field wants rings, as a dead slot (its life nought) with its place and a spare of -1, and every other dead slot all nought");
  const r = rig();
  const kp = r.field.kick;
  ok(kp.ringMaterial.uniforms.uS1 === kp.cutMaterial.uniforms.uS1 && kp.ringMaterial.uniforms.uS2 === kp.cutMaterial.uniforms.uS2 && kp.ringMaterial.uniforms.uS0 === kp.cutMaterial.uniforms.uS0, "the ring draw reads the state the update just wrote through the very objects the pool's draws read (life included), handed the new state as the pair is swapped");
}

console.log(`\n${checks} checks passed`);
