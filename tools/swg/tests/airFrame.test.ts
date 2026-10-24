// The moving air's own frame (src/world/volumetrics/airField.ts), driven through the real `AirField.update` with a
// stand-in renderer that records every draw and what the drawn material's uniforms held at that moment: what the
// field's loop does, never a loop the test writes in its own words (a review broke the field's step clock, its
// consuming of the one-shots and its dust's scroll with every arithmetic test green). Held here:
//
//   - a blast queued on a frame that takes no step is still owed, not drawn, and is drawn whole and spent on the next
//     frame that steps;
//   - a standing engine's push summed over ten seconds of the field's own steps is the same at 60, 144 and 240 frames;
//   - a moved window's pending scroll reaches the dust pass and the solver's first pass as moveX / cells, a whole
//     number of every field's texels, and the light pass's at its next draw;
//   - the volume's `dustLive`: true only on a frame whose dust was carried, false with the moving air or the dust
//     turned off with the master on, in a storm too;
//   - what a frame that steps nothing owes is dropped, never held for a step minutes on;
//   - the tune's reach, solid height and wind share reach the programs at the next step;
//   - with the stages drawn directly, the obstacles are still a render call of their own (three uploads a mesh's
//     boxes only then);
//   - a running engine over water, lava or mud lifts nothing and keeps nothing airborne;
//   - a draw that throws stops the air and says why, and never throws out of the frame.
//
// Plain type stripping; synthetic numbers only.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AirField, newAirFrameInput, type AirWorld } from '../../../src/world/volumetrics/airField.ts';
import { AIR_DRAW } from '../../../src/world/volumetrics/airDraw.ts';
import { AIR_TUNE, tuneAir } from '../../../src/world/volumetrics/airTune.ts';
import type { GroundSample, GroundSampler } from '../../../src/world/volumetrics/airRaster.ts';
import type { SolidBox } from '../../../src/world/layoutStream.ts';
import { newVolTune, type VolTune } from '../../../src/world/volumetrics/volSettings.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** One draw the stand-in renderer saw: which way, which material, and the uniforms that matter at that moment. */
interface Draw {
  way: 'render' | 'direct';
  name: string;
  object: THREE.Object3D;
  splatCount?: number;
  splatB?: number[];
  shift?: [number, number];
  dustShift?: [number, number];
  velShift?: [number, number];
  dustCount?: number;
}

/** A renderer that draws nothing and records everything; `throwOn` names a material whose draw throws. */
function standIn(): { renderer: THREE.WebGLRenderer; draws: Draw[]; throwOn: { name: string | null } } {
  const draws: Draw[] = [];
  const throwOn = { name: null as string | null };
  let target: unknown = null;
  const gl = { getExtension: (): object => ({}), RED: 6403, RG: 33319, IMPLEMENTATION_COLOR_READ_FORMAT: 35739, getParameter: (): number => 6408 };
  const v2 = (u: { value: THREE.Vector2 } | undefined): [number, number] | undefined => (u ? [u.value.x, u.value.y] : undefined);
  const record = (way: 'render' | 'direct', material: THREE.Material, object: THREE.Object3D): void => {
    const name = material.name;
    if (throwOn.name === name) throw new Error(`a stand-in draw of ${name} failed`);
    const u = (material as THREE.ShaderMaterial).uniforms ?? {};
    const d: Draw = { way, name, object };
    if (name === 'air.splat') {
      d.splatCount = u.uSplatCount.value as number;
      d.splatB = Array.from((u.uSplatB.value as Float32Array).subarray(0, d.splatCount * 4));
      d.shift = v2(u.uShift as { value: THREE.Vector2 });
    } else if (name === 'air.dust') {
      d.dustShift = v2(u.uDustShift as { value: THREE.Vector2 });
      d.velShift = v2(u.uVelShift as { value: THREE.Vector2 });
      d.dustCount = u.uDustCount.value as number;
    } else if (name === 'air.jacobi') d.shift = v2(u.uShift as { value: THREE.Vector2 });
    draws.push(d);
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
    render(obj: THREE.Object3D, cam: THREE.Camera): void {
      // Three calls a scene's own hook at the end of a render call: the drawer's direct way runs its step there.
      if ((obj as THREE.Scene).isScene) {
        (obj as THREE.Scene).onAfterRender(renderer as unknown as THREE.WebGLRenderer, obj as THREE.Scene, cam, null as never, null as never, null as never);
        return;
      }
      record('render', (obj as THREE.Mesh).material as THREE.Material, obj);
    },
    renderBufferDirect(_cam: THREE.Camera, _scene: THREE.Scene, _geo: THREE.BufferGeometry, material: THREE.Material, object: THREE.Object3D): void {
      record('direct', material, object);
    },
    compile: (): void => undefined,
    info: { programs: [] as unknown[] },
    properties: { get: (): object => ({}) },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, draws, throwOn };
}

/** Flat ground at nought: sand to the west, water to the south-east, mud to the north-east (family 2 sheds no dust). */
const ground: GroundSampler = {
  sample(x: number, z: number, out: GroundSample): boolean {
    out.h = 0;
    out.family = x < 0 ? 1 : 2;
    out.medium = x >= 0 && z < 0 ? 2 : 1;
    return true;
  },
};

interface Rig {
  field: AirField;
  tune: VolTune;
  draws: Draw[];
  throwOn: { name: string | null };
  inp: ReturnType<typeof newAirFrameInput>;
  frame(dt: number): Draw[];
}

function rig(world: Partial<AirWorld> = {}): Rig {
  const { renderer, draws, throwOn } = standIn();
  const tune = newVolTune();
  tune.on = true;
  const field = new AirField(renderer, tune, { ground, boxes: null, hulls: [], ...world });
  // Sand gives all its dust; mud (family 2) moves and gives but sheds none.
  field.raster.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 85, 255, 89, 51, 221, 0]);
  field.raster.familyColour = new Uint8Array([0, 0, 0, 0, 204, 168, 117, 255, 120, 90, 60, 255]);
  const inp = newAirFrameInput();
  inp.reading = true;
  inp.windHeading = 0.4;
  inp.windSpeed = 3;
  inp.sunY = 0.8;
  inp.sunZ = 0.6;
  const frame = (dt: number): Draw[] => {
    const from = draws.length;
    inp.dt = dt;
    inp.time += dt;
    field.update(inp);
    return draws.slice(from);
  };
  return { field, tune, draws, throwOn, inp, frame };
}

/** Frames of a sixtieth until every cell of the raster is known and the step clock holds no remainder. */
function settle(r: Rig): void {
  for (let i = 0; i < 400 && (r.field.raster.unknown > 0 || i < 4); i++) r.frame(1 / 60);
  r.frame(1 / 60);
}

const named = (list: Draw[], name: string): Draw[] => list.filter((d) => d.name === name);
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

// --- a blast owed across a frame that takes no step ---
{
  const r = rig();
  settle(r);
  ok(r.field.raster.unknown === 0 && r.field.stepping && r.field.dustLive, 'the field, settled: every cell known, stepping, its dust carried');
  r.field.blast(-5, 0, 5, AIR_TUNE.blast.radiusRef, AIR_TUNE.blast.pushRef, 0);
  const quiet = r.frame(1 / 240);
  ok(r.field.forces.oneCount === AIR_TUNE.blast.shoves && named(quiet, 'air.splat').length === 0, `a thermal detonator on a frame of 1/240 s that takes no step: its ${AIR_TUNE.blast.shoves} shoves still owed and nothing drawn of them`);
  const next = r.frame(1 / 60);
  const splats = named(next, 'air.splat');
  ok(splats.length === 1 && splats[0].splatCount === AIR_TUNE.blast.shoves, `the next frame steps once and its splat pass is handed all ${splats[0]?.splatCount} shoves`);
  let whole = true;
  const b = splats[0]?.splatB ?? [];
  for (let i = 0; i < AIR_TUNE.blast.shoves; i++) if (!near(Math.hypot(b[i * 4], b[i * 4 + 1]), AIR_TUNE.blast.shove, 1e-3)) whole = false;
  ok(whole, "each whole, at the blast's full shove and not a step's share");
  ok(r.field.forces.oneCount === 0, 'and once drawn, owed no more');
  const after = r.frame(1 / 60);
  ok(named(after, 'air.splat').every((d) => d.splatCount === 0), 'the step after draws none of them again');
}

// --- an engine's push a second, through the field's own clock ---
{
  const pushOver = (fps: number): { sum: number; steps: number } => {
    const r = rig();
    settle(r);
    r.field.testEngine = { x: -10, y: 0.6, z: 0, dx: 0, dy: 0, dz: 1, exit: 40 };
    let sum = 0;
    let steps = 0;
    for (let i = 0; i < fps * 10; i++) {
      for (const d of named(r.frame(1 / fps), 'air.splat')) {
        steps++;
        const s = d.splatB ?? [];
        for (let k = 0; k < (d.splatCount ?? 0); k++) sum += s[k * 4 + 1];
      }
    }
    return { sum, steps };
  };
  const a = pushOver(60);
  const b = pushOver(144);
  const c = pushOver(240);
  const off = (x: number): number => Math.abs(x - a.sum) / a.sum;
  ok(a.sum > 0 && off(b.sum) < 0.002 && off(c.sum) < 0.002, `an engine's push over ten seconds of the field's own steps is the same at 60, 144 and 240 frames a second (${a.sum.toFixed(1)}, ${b.sum.toFixed(1)}, ${c.sum.toFixed(1)}; ${a.steps}, ${b.steps}, ${c.steps} steps)`);
}

// --- a moved window's scroll, carried by the field ---
{
  const r = rig();
  settle(r);
  const w = r.field.win;
  const cells = w.cells;
  const dustTexels = cells * r.tune.dustDetail;
  const lightTexels = cells * r.tune.lightDetail;
  r.inp.camX += 3 * w.cell + 0.2;
  r.inp.camZ -= 2 * w.cell;
  const moved = r.frame(1 / 240);
  ok(w.moveX === 3 && w.moveZ === -2, 'a camera move of three cells east and two south moves the window 3 and -2 cells');
  const dust = named(moved, 'air.dust')[0];
  const sx = 3 / cells;
  const sz = -2 / cells;
  ok(!!dust && named(moved, 'air.splat').length === 0 && near(dust.dustShift![0], sx) && near(dust.dustShift![1], sz), `on that frame (no step) the dust pass carries its own scroll, (${dust?.dustShift?.map((v) => v.toFixed(5)).join(', ')}): the move over the cells`);
  ok(near(dust.velShift![0], sx) && near(dust.velShift![1], sz), "and reads the air at the air's pending scroll, which no step has carried yet");
  ok(near(dust.dustShift![0] * dustTexels, 3 * r.tune.dustDetail, 1e-9) && near(dust.dustShift![1] * dustTexels, -2 * r.tune.dustDetail, 1e-9), `a whole number of the dust's texels: ${dust.dustShift![0] * dustTexels} and ${dust.dustShift![1] * dustTexels} of ${dustTexels}`);
  const ls = r.field.lightShift.value;
  ok(named(moved, 'air.light').length === 0 && near(ls.x, sx) && near(ls.y, sz) && near(ls.x * lightTexels, 3 * r.tune.lightDetail, 1e-9), `the light, not drawn on a frame with no step, owes the move to the volume: (${ls.x.toFixed(5)}, ${ls.y.toFixed(5)}), whole texels of its own`);
  const stepped = r.frame(1 / 60);
  const splat = named(stepped, 'air.splat')[0];
  const jacobi = named(stepped, 'air.jacobi')[0];
  ok(!!splat && near(splat.shift![0], sx) && near(splat.shift![1], sz) && near(jacobi.shift![0], sx), "the next frame's step carries the air's pending scroll in its first pass, the splat, and the pressure's first Jacobi");
  const dust2 = named(stepped, 'air.dust')[0];
  ok(near(dust2.velShift![0], 0) && near(dust2.dustShift![0], 0), 'after which the dust reads the air with nothing pending, and owes nothing of its own');
  ok(named(stepped, 'air.light').length === 1 && r.field.lightShift.value.x === 0 && r.field.lightShift.value.y === 0, 'and the light, drawn again after the step, owes nothing');
}

// --- the volume reads only dust carried this frame ---
{
  const r = rig();
  settle(r);
  ok(r.field.dustLive, 'stepping with the air and the dust on: the dust is carried');
  r.inp.storm = 0.6;
  r.tune.air = false;
  const off = r.frame(1 / 60);
  ok(!r.field.dustLive && r.field.hasAir() && r.field.dust.value !== null && off.length === 0, 'the moving air turned off with the master on, in a storm: nothing drawn, the dust texture kept, and the field says its dust was not carried (hasAir alone would have let the volume draw it frozen)');
  r.tune.air = true;
  r.tune.dust = false;
  const noDust = r.frame(1 / 60);
  ok(!r.field.dustLive && named(noDust, 'air.dust').length === 0 && named(noDust, 'air.splat').length + named(noDust, 'air.advect').length > 0, 'the dust turned off: the air still steps, the dust is not carried, and the field says so');
  r.tune.dust = true;
  r.frame(1 / 60);
  ok(r.field.dustLive, 'and turned back on, carried again');
  r.inp.reading = false;
  r.frame(1 / 60);
  ok(!r.field.dustLive, 'with nothing reading the air, nothing is carried');
}

// --- what a frame that steps nothing owes is dropped ---
{
  const r = rig();
  settle(r);
  r.field.blast(-5, 0, 5, AIR_TUNE.blast.radiusRef, AIR_TUNE.blast.pushRef, 0);
  ok(r.field.forces.oneCount === AIR_TUNE.blast.shoves && r.field.forces.dustCount === 1, 'a blast queues its shoves and its dust');
  r.inp.reading = false;
  r.frame(1 / 60);
  ok(r.field.forces.oneCount === 0 && r.field.forces.dustCount === 0 && r.field.forces.active, 'a frame with nothing reading the air drops them (the field still on, for the grains)');
  for (let i = 0; i < 400; i++) r.field.blast(-5, 0, 5, 7, 14, 0), r.frame(1 / 60);
  const counts = r.field.forces.takeCounts({ engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0 });
  ok(counts.droppedSplats === 0 && counts.droppedDust === 0, 'and four hundred blasts with nothing reading, a frame each, never fill a queue or count a drop');
  r.inp.reading = true;
  r.field.blast(-5, 0, 5, 7, 14, 0);
  r.inp.where = 'a test: the player in a building';
  r.frame(1 / 60);
  ok(r.field.forces.oneCount === 0 && !r.field.forces.active, "a frame the air does nothing here (indoors) drops what was owed before the door, and takes nothing more");
  r.inp.where = null;
  const back = r.frame(1 / 60);
  ok(named(back, 'air.splat').length >= 1 && named(back, 'air.splat').every((d) => d.splatCount === 0), 'outdoors again, the first step lands no shove of a blast long gone');
}

// --- the tune reaches the programs at the next step ---
{
  const r = rig();
  settle(r);
  const was = { reach: AIR_TUNE.slabs.reach, windShare: AIR_TUNE.slabs.windShare, over: AIR_TUNE.obstacles.over };
  try {
    const answer = tuneAir({ slabs: { reach: 1.7, windShare: 0.6 }, obstacles: { over: 1.4 } });
    ok(answer.notes.length === 0 && !answer.rebuild, 'the reach, the wind share and a solid\'s height are moved live, no rebuild asked');
    r.frame(1 / 60);
    const mats = Object.fromEntries(r.field.materials().map((m) => [m.name, m.uniforms]));
    ok(mats['air.splat'].uReachScale.value === 1.7, 'the splat pass reaches a slab by the new reach');
    ok(mats['air.splat'].uObstacleOver.value === 1.4 && mats['air.dust'].uObstacleOver.value === 1.4 && mats['air.advect'].uObstacleOver.value === 1.4, 'the solver and the dust stop at a solid by its new height over the floor');
    ok(mats['air.dust'].uWindShare.value === 0.6 && (mats['air.splat'].uTileSlab.value as Float32Array)[2] === Math.fround(0.6), "and the dust's edge and the solver's inflow take the new share of the wind together");
  } finally {
    tuneAir({ slabs: { reach: was.reach, windShare: was.windShare }, obstacles: { over: was.over } });
  }
}

// --- the obstacles, a render call of their own when the stages are drawn directly ---
{
  const box: SolidBox = { x: -20, z: 10, hx: 4, hz: 3, cos: 1, sin: 0, top: 6, room: false };
  const boxes = {
    forEachSolidBox(_x0: number, _z0: number, _x1: number, _z1: number, rec: SolidBox, visit: (b: SolidBox) => boolean): void {
      Object.assign(rec, box);
      visit(rec);
    },
  };
  const r = rig({ boxes });
  const mode = AIR_DRAW.mode;
  AIR_DRAW.mode = 'direct';
  try {
    const first = r.frame(1 / 60);
    const obstacle = first.filter((d) => d.name === 'air.obstacles');
    ok(first.some((d) => d.way === 'direct' && d.name === 'air.splat'), 'with the direct way on, the step\'s stages are drawn inside one render call');
    ok(obstacle.length === 1 && obstacle[0].way === 'render' && (obstacle[0].object as THREE.Mesh).isMesh === true, 'but the obstacles are drawn by a render call of their own, which is when three uploads the boxes a gather wrote');
    r.inp.camX += 30;
    const moved = r.frame(1 / 60);
    ok(moved.filter((d) => d.name === 'air.obstacles').every((d) => d.way === 'render') && moved.some((d) => d.name === 'air.obstacles'), 'and again when the window moves');
  } finally {
    AIR_DRAW.mode = mode;
  }
}

// --- nothing airborne over ground that gives no dust ---
{
  const lifts = (x: number, z: number): { airborne: boolean; batch: number } => {
    const r = rig();
    settle(r);
    r.field.testEngine = { x, y: 2, z, dx: 0, dy: -1, dz: 0, exit: 40 };
    let batch = 0;
    for (let i = 0; i < 30; i++) for (const d of named(r.frame(1 / 60), 'air.dust')) batch = Math.max(batch, d.dustCount ?? 0);
    return { airborne: r.field.hasAir(), batch };
  };
  const sand = lifts(-40, 20);
  const water = lifts(40, -40);
  const mud = lifts(40, 40);
  ok(sand.airborne && sand.batch > 0, 'an engine blowing down on sand lifts dust and keeps it airborne');
  ok(!water.airborne && water.batch === 0, 'over water it lays nothing and nothing is airborne: the volume does not march empty air');
  ok(!mud.airborne && mud.batch === 0, 'nor over mud, which gives no dust');
}

// --- a draw that throws stops the air, never the frame ---
{
  const r = rig();
  settle(r);
  r.throwOn.name = 'air.vort';
  const quietError = console.error;
  console.error = (): void => undefined;
  let threw = false;
  try {
    r.frame(1 / 60);
  } catch {
    threw = true;
  } finally {
    console.error = quietError;
  }
  ok(!threw && !r.field.stepping && !r.field.dustLive && (r.field.why ?? '').includes('the step failed'), `a stage that throws, drawn the plain way, is caught: the air stops and says so ("${r.field.why}")`);
}

console.log(`\n${checks} checks passed`);
