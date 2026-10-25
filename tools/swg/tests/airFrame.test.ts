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
import { HALF_NORMAL, liftPeakIn, newLiftPeak } from '../../../src/world/volumetrics/airMath.ts';
import type { AirHull } from '../../../src/world/volumetrics/airEngines.ts';

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
  /** The target it went to (wave 2b's two-texture pair is told by its `textures`). */
  target: unknown;
  splatCount?: number;
  splatA?: number[];
  splatB?: number[];
  shift?: [number, number];
  dustShift?: [number, number];
  velShift?: [number, number];
  dustCount?: number;
  dustBatch?: number[];
  /** The dust pass's splats' shapes as handed over (μ₀, σ₀, w₀, nought), four a splat. */
  shapeBatch?: number[];
  /** The offsets pass's numbers: the frame and the lift's (`uSandP`), each phase's restart and seconds (`uSandQ`). */
  sandP?: [number, number, number, number];
  sandQ?: [number, number, number, number];
  /** A fill's values: the colour and density, and (the dust's two-output fill) the shape. */
  value?: [number, number, number, number];
  shapeValue?: [number, number, number, number];
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
    const d: Draw = { way, name, object, target };
    const v4 = (x: unknown): [number, number, number, number] => {
      const v = x as THREE.Vector4;
      return [v.x, v.y, v.z, v.w];
    };
    if (name === 'air.splat') {
      d.splatCount = u.uSplatCount.value as number;
      d.splatA = Array.from((u.uSplatA.value as Float32Array).subarray(0, d.splatCount * 4));
      d.splatB = Array.from((u.uSplatB.value as Float32Array).subarray(0, d.splatCount * 4));
      d.shift = v2(u.uShift as { value: THREE.Vector2 });
    } else if (name === 'air.dust') {
      d.dustShift = v2(u.uDustShift as { value: THREE.Vector2 });
      d.velShift = v2(u.uVelShift as { value: THREE.Vector2 });
      d.dustCount = u.uDustCount.value as number;
      d.dustBatch = Array.from((u.uDustBatch.value as Float32Array).subarray(0, d.dustCount * 4));
      d.shapeBatch = Array.from((u.uDustShapeBatch.value as Float32Array).subarray(0, d.dustCount * 4));
    } else if (name === 'air.offsets') {
      d.sandP = v4(u.uSandP.value);
      d.sandQ = v4(u.uSandQ.value);
    } else if (name === 'air.jacobi') d.shift = v2(u.uShift as { value: THREE.Vector2 });
    else if (name === 'air.fill') d.value = v4(u.uValue.value);
    else if (name === 'air.fillDust') {
      d.value = v4(u.uValue.value);
      d.shapeValue = v4(u.uShapeValue.value);
    }
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
  const counts = r.field.forces.takeCounts({ engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0, fronts: 0, droppedFronts: 0 });
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

// --- wave 2b: the dust and its shape, one draw into a two-texture pair, both draw ways ---
{
  const r = rig();
  settle(r);
  const pairOf = (t: unknown): number => ((t as { textures?: unknown[] } | null)?.textures?.length ?? 0);
  const plain = r.frame(1 / 60);
  const mode = AIR_DRAW.mode;
  AIR_DRAW.mode = 'direct';
  let direct: Draw[] = [];
  try {
    direct = r.frame(1 / 60);
  } finally {
    AIR_DRAW.mode = mode;
  }
  for (const [way, list] of [
    ['render', plain],
    ['direct', direct],
  ] as const) {
    const dust = named(list, 'air.dust');
    ok(dust.length === 1 && dust[0].way === way && pairOf(dust[0].target) === 2, `drawn the ${way === 'render' ? 'plain' : 'direct'} way, the dust pass draws once a frame into a target of two textures (the colour and density, the shape it carries)`);
  }
  // A jump fills every field: the dust's pair with both its outputs, the light with an optical depth of nought.
  r.inp.storm = 0.5;
  r.frame(1 / 60);
  r.inp.camX += 2000;
  const jump = r.frame(1 / 60);
  const fills = named(jump, 'air.fillDust');
  const inflow = r.field.inflow.value;
  ok(fills.length === 2 && fills.every((d) => pairOf(d.target) === 2) && fills.every((d) => near(d.value![3], inflow.x, 1e-6) && near(d.shapeValue![1], inflow.x * inflow.y * inflow.y, 1e-4) && d.shapeValue![0] === 0 && d.shapeValue![2] === 0), `a jump fills both of the dust's pairs through both outputs: the storm's dust at its weight (${inflow.x.toFixed(3)}) and its half-normal's shape standing on the ground (σ ${inflow.y.toFixed(2)} m)`);
  const lightTarget = (r.field as unknown as { lightTarget: unknown }).lightTarget;
  const lightFill = named(jump, 'air.fill').filter((d) => d.target === lightTarget);
  ok(lightFill.length === 1 && lightFill[0].value!.every((x) => x === 0), 'and the light with an optical depth of nought (a transmittance of one), never the first wave\'s one');
  r.inp.storm = 0;
}

// --- wave 2b: the Force's fronts through the field's own frame ---
{
  const r = rig();
  settle(r);
  // A push on a frame of 1/240 s that takes no step: its dust that frame, its first shoves at the next step.
  r.field.force(-40, 0, -20, 1, 0, 1, 1, 16);
  const quiet = r.frame(1 / 240);
  const dust = named(quiet, 'air.dust')[0];
  ok(named(quiet, 'air.splat').length === 0 && !!dust && (dust.dustCount ?? 0) > 0, `a push made on a frame of 1/240 s that takes no step lays its first dust that frame (${dust?.dustCount} splats)`);
  const next = named(r.frame(1 / 60), 'air.splat');
  ok(next.length === 1 && (next[0].splatCount ?? 0) > 0, `and its first shoves at the next step (${next[0]?.splatCount})`);
}
{
  // The fronts after the one-shots and before the engines, in the step's batch and the frame's dust batch.
  const r = rig();
  settle(r);
  const win = r.field.win;
  const blastAt = [-60, 50];
  const frontAt = [-40, -30];
  const engineAt = [-80, -70];
  r.field.testEngine = { x: engineAt[0], y: 1.5, z: engineAt[1], dx: 0, dy: -1, dz: 0, exit: 40 };
  r.frame(1 / 60);
  r.field.blast(blastAt[0], 0, blastAt[1], 7, 14, 0);
  r.field.force(frontAt[0], 0, frontAt[1], 1, 0, 1, 1, 16);
  const list = r.frame(1 / 60);
  const kindOf = (u: number, v: number): number => {
    const x = win.ox + u * win.size;
    const z = win.oz + v * win.size;
    const d = (p: number[]): number => Math.hypot(x - p[0], z - p[1]);
    return d(blastAt) < 12 ? 0 : d(frontAt) < 20 ? 1 : d(engineAt) < 10 ? 2 : -1;
  };
  const ordered = (kinds: number[]): boolean => kinds.every((k, i) => k >= 0 && (i === 0 || k >= kinds[i - 1])) && [0, 1, 2].every((k) => kinds.includes(k));
  const splat = named(list, 'air.splat')[0];
  const steps: number[] = [];
  for (let i = 0; i < (splat?.splatCount ?? 0); i++) steps.push(kindOf(splat.splatA![i * 4], splat.splatA![i * 4 + 1]));
  const dustDraw = named(list, 'air.dust')[0];
  const dusts: number[] = [];
  for (let i = 0; i < (dustDraw?.dustCount ?? 0); i++) dusts.push(kindOf(dustDraw.dustBatch![i * 4], dustDraw.dustBatch![i * 4 + 1]));
  ok(ordered(steps), `the step's batch: the blast's shoves, then the front's, then the engine's (${steps.join('')})`);
  ok(ordered(dusts), `the frame's dust: the blast's, then the front's band, then the engine's (${dusts.join('')})`);
}
{
  // With the dust off and the blowing sand on, a push every second: each made and let go, none dropped as a ninth, the
  // frame walk run every frame (as first written the fronts aged only in the dust's batch and never freed).
  const r = rig();
  settle(r);
  r.tune.dust = false;
  r.tune.sand = true;
  r.inp.ground = true;
  let most = 0;
  for (let s = 0; s < 12; s++) {
    r.field.force(-40, 0, -20, 1, 0, 1, 1, 16);
    for (let i = 0; i < 60; i++) {
      r.frame(1 / 60);
      most = Math.max(most, r.field.forces.frontCount);
    }
  }
  const counts = r.field.forces.takeCounts({ engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0, fronts: 0, droppedFronts: 0 });
  ok(counts.fronts === 12 && counts.droppedFronts === 0 && most === 1 && r.field.forces.frontCount === 0, `with the dust off and the sand on, twelve pushes a second apart: all made (${counts.fronts}), none dropped, at most ${most} alive at once, all let go`);
  r.tune.dust = true;
  // A frame stepping nothing lets the fronts go.
  r.field.force(-40, 0, -20, 1, 0, 1, 1, 16);
  r.inp.reading = false;
  r.inp.ground = false;
  r.frame(1 / 60);
  ok(r.field.forces.frontCount === 0, 'a frame stepping nothing (nothing reading the air) lets every front go');
}

// --- wave 2b: the blowing sand's two phases as the field hands them to the passes ---
{
  // Through the field's own frame at four rates over three cycles: the offsets pass is handed each phase's restart and
  // its seconds since (`uSandQ`) and the frame (`uSandP.x`), and the ground's record its phases, the view and one over
  // the cycle (`uAirPhase`), each held to a clock the test keeps itself from the field's start; then the offsets the
  // pass would carry at a steady air, worked out from what was handed over in float32 as the shader works them, stay
  // within the air's speed times the cycle (a phase that never restarted would grow without bound: the drift wave 2b took
  // out).
  for (const fps of [30, 60, 144, 240]) {
    const r = rig();
    r.tune.sand = true;
    r.inp.ground = true;
    settle(r);
    const cycle = AIR_TUNE.sand.cycle;
    const T = cycle > 1e-3 ? cycle : 1e-3;
    const start = (r.field as unknown as { phase: { tA: number; tB: number } }).phase;
    let a = start.tA;
    let b = start.tB;
    const u = 3;
    let oA = Math.fround(-u * a);
    let oB = Math.fround(-u * b);
    let handed = true;
    let phases = true;
    let bounded = true;
    let followsClock = true;
    let worst = 0;
    let restartsA = 0;
    let restartsB = 0;
    const dt = 1 / fps;
    for (let i = 0; i < Math.ceil(3 * cycle * fps); i++) {
      // The test's own clock: each phase on by the frame, a cycle taken off each time it passes one, as the field means it.
      let ra = 0;
      let rb = 0;
      a += dt;
      b += dt;
      while (a >= T) {
        a -= T;
        ra = 1;
      }
      while (b >= T) {
        b -= T;
        rb = 1;
      }
      restartsA += ra;
      restartsB += rb;
      const off = named(r.frame(dt), 'air.offsets');
      const q = off[0]?.sandQ;
      const p = off[0]?.sandP;
      if (off.length !== 1 || !q || !p || q[0] !== ra || q[2] !== rb || !Object.is(q[1], a) || !Object.is(q[3], b) || !Object.is(p[0], dt)) handed = false;
      const pv = r.field.ground.uAirPhase.value;
      if (!Object.is(pv.x, a) || !Object.is(pv.y, b) || pv.z !== 0 || !Object.is(pv.w, 1 / T)) phases = false;
      if (!q) continue;
      // The pass's carry at one texel under a steady air of u m/s along x, in float32: each frame back by u · dt, or
      // where its phase started again, only what it was carried since.
      const uDt = Math.fround(Math.fround(u) * Math.fround(p![0]));
      oA = q[0] > 0.5 ? Math.fround(-Math.fround(u) * Math.fround(q[1])) : Math.fround(oA - uDt);
      oB = q[2] > 0.5 ? Math.fround(-Math.fround(u) * Math.fround(q[3])) : Math.fround(oB - uDt);
      const most = u * T * (1 + 1e-5);
      if (!(Math.abs(oA) <= most && Math.abs(oB) <= most)) bounded = false;
      const err = Math.max(Math.abs(oA + u * a), Math.abs(oB + u * b));
      if (err > worst) worst = err;
      if (err > 1e-3) followsClock = false;
    }
    ok(handed && restartsA >= 2 && restartsB >= 2, `at ${fps} frames a second over three cycles, the offsets pass is handed each phase's restart exactly on the frames its clock passes a cycle (${restartsA} and ${restartsB}), its seconds since then (the overshoot on a restart) and the frame`);
    ok(phases, `and the ground's record its two phases, no sand view and one over the cycle, every frame`);
    ok(bounded && followsClock, `and the carry worked out from what the pass was handed stays within the air's speed times the cycle (${(u * T).toFixed(2)} m), standing where the phases' own seconds put it within ${(worst * 1000).toFixed(3)} mm in float32`);
  }
}

// --- wave 2b: the shape each splat of dust is laid with, as the field hands it to the dust pass ---
{
  // A machine skimming sand: a stand-in hull whose engine leaves level a third of a metre over the ground, its speed set.
  const hull = (x: number, z: number, speed: number): AirHull => {
    const group = new THREE.Group();
    group.position.set(x, 0.3, z);
    const nozzle = new THREE.Object3D();
    group.add(nozzle);
    group.updateMatrixWorld(true);
    return { engines: [{ object: nozzle }], engineHeat: 1, group, spec: { kind: 'speeder', ship: false, bounds: { min: [-1, -0.3, -2], max: [1, 0.6, 2] } }, airborne: false, powered: true, landed: false, speed, pos: group.position, altitude: 0.3 } as unknown as AirHull;
  };
  const E = AIR_TUNE.engine;
  const D = AIR_TUNE.dust;
  const shapesOf = (list: Draw[]): number[][] => {
    const out: number[][] = [];
    for (const d of named(list, 'air.dust')) for (let i = 0; i < (d.dustCount ?? 0); i++) out.push(d.shapeBatch!.slice(i * 4, i * 4 + 4));
    return out;
  };
  const f32 = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  const laidAs = (shapes: number[][], mu0: number, sigma0: number, w0: number): boolean => shapes.length > 0 && shapes.every((s) => f32(s[0], mu0) && f32(s[1], sigma0) && f32(s[2], w0) && s[3] === 0);
  const was = D.lift;
  try {
    for (const lift of [1, 0.5]) {
      tuneAir({ dust: { lift } });
      // At dust.lift under one each source's own lift is moved toward the storm's rest (laid on the ground, a half-normal of H₀).
      const rest = HALF_NORMAL * D.height;
      const as = (mu: number, sigma: number, w: number): [number, number, number] => [mu * lift, sigma * lift + rest * (1 - lift), w * lift];
      for (const speed of [18, 167]) {
        const r = rig({ hulls: [hull(-20, 20, speed)] });
        settle(r);
        const shapes = shapesOf(r.frame(1 / 60));
        // The throw: the demo's grains' own, `spreadRise · (1.7 + 0.24 · speed)`, its speed held at `spreadRiseSpeed`, times the bite (whole here).
        const held = Math.min(speed, E.spreadRiseSpeed);
        let ge = 1 - (0.3 - E.spreadLow) / E.spreadSpan;
        ge = Math.max(0, Math.min(1, ge));
        const bite = Math.min(1, ge * (E.spreadBase + speed / E.spreadSpeed));
        const [mu0, sigma0, w0] = as(E.spreadAt, E.spreadSigma, E.spreadRise * (1.7 + 0.24 * held) * bite);
        ok(laidAs(shapes, mu0, sigma0, w0), `at dust.lift ${lift}, a machine skimming sand at ${speed} m/s lays every splat of its dust at μ₀ ${mu0.toFixed(3)} m, σ₀ ${sigma0.toFixed(3)} m, rising at w₀ ${w0.toFixed(3)} m/s (${shapes.length} splats)${speed > E.spreadRiseSpeed ? ', its throw held at the 30 m/s arc' : ''}`);
      }
      const F = AIR_TUNE.force;
      for (const kind of ['push', 'repulse'] as const) {
        const r = rig();
        settle(r);
        if (kind === 'push') r.field.force(-40, 0, -20, 1, 0, 1, 1, 16);
        else r.field.force(-40, 0, -20, 0, 0, 1, 1, 16);
        const shapes: number[][] = [];
        for (let i = 0; i < 20; i++) shapes.push(...shapesOf(r.frame(1 / 60)));
        const want = kind === 'push' ? as(F.dustLow, F.dustSpread, F.dustKick) : as(F.dustLow, F.repulseSpread, F.repulseKick);
        ok(laidAs(shapes, ...want), `at dust.lift ${lift}, a ${kind}'s band lays every splat of its dust at μ₀ ${want[0].toFixed(3)} m, σ₀ ${want[1].toFixed(3)} m, rising at ${want[2].toFixed(3)} m/s (${shapes.length} splats over its first third of a second)`);
      }
    }
  } finally {
    tuneAir({ dust: { lift: was } });
  }
  // A blast's lift raises the band the march looks in to the top that lift will reach, for `airborneFor` seconds.
  {
    const r = rig();
    settle(r);
    const H4 = 4 * D.height;
    const V = AIR_TUNE.volume;
    ok(r.field.bandTop === Math.min(H4, V.above), `with nothing lifted the band's top is four of H₀ (${r.field.bandTop} m)`);
    const radius = 2 * AIR_TUNE.blast.radiusRef;
    r.field.blast(-5, 0, 5, radius, AIR_TUNE.blast.pushRef, 0);
    const shapes = shapesOf(r.frame(1 / 60));
    const lp = newLiftPeak();
    let top = 0;
    for (const s of shapes) {
      lp.mu0 = s[0];
      lp.sigma0 = s[1];
      lp.w0 = s[2];
      liftPeakIn(lp);
      if (lp.top > top) top = lp.top;
    }
    r.frame(1 / 60);
    const want = Math.min(Math.max(top, H4), V.above);
    ok(shapes.length === 1 && top > H4 && Math.abs(r.field.bandTop - want) < 1e-4 && Math.abs(r.field.look.value.z - r.field.bandTop) < 1e-9, `a blast of twice a thermal detonator's radius lifts its dust to a top of ${top.toFixed(2)} m (its laid shape's own peak, liftPeakIn), and the frame after the band the march looks in stands there (${r.field.bandTop.toFixed(2)} m), in the look it reads`);
    for (let i = 0; i < Math.ceil((V.airborneFor + 0.5) * 60); i++) r.frame(1 / 60);
    ok(r.field.bandTop === Math.min(H4, V.above), `and ${V.airborneFor} s after the last lift it is four of H₀ again (${r.field.bandTop} m)`);
  }
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
