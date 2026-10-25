// The ground's marks through the real field (src/world/volumetrics/airField.ts, airForces.ts, airDents.ts; the
// volumetrics design's §2.7 and §9 Tests), with a stand-in renderer that records what each draw of the dents and the
// carried offsets was handed at that moment -- never a copy of their arithmetic in the test's own words (a review
// broke the pit's gather, the source's spending, a path's share, the give and the fade's tick count with every test
// green, because the tests summed the depths themselves). Held here:
//
//   - a scour pit under a hovering jet, through `gatherDents`, the slots and `buildBatch` on the 10 Hz tick and the
//     fade's own uniform: what is gathered and what is laid are the same at 60, 144 and 240 frames a second, what is
//     laid is what was gathered times the ground's give (sand one, mud two and a half), each tick lays its own share
//     and no more, and the field's depth replayed in float32 from the draws is alike at every rate;
//   - a speeder's rut along a path: each stamp its share, the whole laid the whole gathered;
//   - a footprint on mud fading at mud's heals over the field's own fades, alike at every rate and the closed form's;
//   - the fade's lines in the shader and the field, held to `dentFade`;
//   - a blast's crater by its radius, only near the ground (none from a ship destroyed overhead);
//   - the ground's uniforms: the dent square and texel after the square moves, each art dial nought while its own
//     effect is off, and the session's record (`bindGround`) written by the field the world took and by no other --
//     two fields made, the first thrown away, the second's values are what the variant reads;
//   - the window's move reaching the offsets pass as its pending scroll;
//   - the targets float32 (the offsets RGBA32F, the dents R32F), and each let go to a texel while its switch is off;
//   - a footprint owned by the dents on one frame and a frame that keeps no marks the next: pressed, never dropped;
//   - the in-play warm compiling nothing for targets let go while it waited.
//
// Plain type stripping; synthetic numbers only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { AirField, newAirFrameInput, type AirWorld } from '../../../src/world/volumetrics/airField.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { dentFade } from '../../../src/world/volumetrics/airMath.ts';
import { groundAirMaterial, makeAirGroundUniforms } from '../../../src/world/volumetrics/airGround.ts';
import { makeGroundTileUniforms } from '../../../src/world/terrainTextures.ts';
import type { GroundSample, GroundSampler } from '../../../src/world/volumetrics/airRaster.ts';
import { newVolTune, type VolTune } from '../../../src/world/volumetrics/volSettings.ts';
import type { FootStep } from '../../../src/audio/footsteps.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** One draw the stand-in saw: the material's name, the target it went to, and what the dents' and the offsets' draws were handed. */
interface Rec {
  name: string;
  target: unknown;
  stamps?: { u: number; v: number; depth: number; kind: number }[];
  fade?: number;
  fadeFloor?: number;
  sandShift?: [number, number];
  /** A fill's value, as it was handed at that draw, and (a two-output fill) its second texture's. */
  value?: [number, number, number, number];
  shapeValue?: [number, number, number, number];
}

function standIn(): { renderer: THREE.WebGLRenderer; draws: Rec[]; bound: unknown[]; compiledFor: unknown[] } {
  const draws: Rec[] = [];
  const bound: unknown[] = [];
  const compiledFor: unknown[] = [];
  let target: unknown = null;
  const gl = { getExtension: (): object => ({}), RED: 6403, RG: 33319, IMPLEMENTATION_COLOR_READ_FORMAT: 35739, getParameter: (): number => 6408 };
  const record = (material: THREE.Material, object: THREE.Object3D): void => {
    const name = material.name;
    const u = (material as THREE.ShaderMaterial).uniforms ?? {};
    const d: Rec = { name, target };
    if (name === 'air.dentStamp') {
      const g = (object as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
      const A = g.getAttribute('aStampA').array as Float32Array;
      const B = g.getAttribute('aStampB').array as Float32Array;
      d.stamps = [];
      for (let i = 0; i < g.instanceCount; i++) d.stamps.push({ u: A[i * 4], v: A[i * 4 + 1], depth: B[i * 4 + 2], kind: B[i * 4 + 3] });
    } else if (name === 'air.dentFade') {
      const p = u.uFadeP.value as THREE.Vector2;
      d.fade = p.x;
      d.fadeFloor = p.y;
    } else if (name === 'air.offsets') {
      const s = u.uSandShift.value as THREE.Vector2;
      d.sandShift = [s.x, s.y];
    } else if (name === 'air.fill') {
      const v = u.uValue.value as THREE.Vector4;
      d.value = [v.x, v.y, v.z, v.w];
    } else if (name === 'air.fillDust') {
      const v = u.uValue.value as THREE.Vector4;
      const s = u.uShapeValue.value as THREE.Vector4;
      d.value = [v.x, v.y, v.z, v.w];
      d.shapeValue = [s.x, s.y, s.z, s.w];
    }
    draws.push(d);
  };
  const renderer = {
    autoClear: true,
    getContext: () => gl,
    getRenderTarget: (): unknown => target,
    setRenderTarget: (t: unknown): void => {
      target = t;
      bound.push(t);
    },
    getClearAlpha: (): number => 1,
    getClearColor: (c: THREE.Color): THREE.Color => c.setRGB(0, 0, 0),
    setClearColor: (): void => undefined,
    clear: (): void => undefined,
    render(obj: THREE.Object3D, cam: THREE.Camera): void {
      if ((obj as THREE.Scene).isScene) {
        (obj as THREE.Scene).onAfterRender(renderer as unknown as THREE.WebGLRenderer, obj as THREE.Scene, cam, null as never, null as never, null as never);
        return;
      }
      record((obj as THREE.Mesh).material as THREE.Material, obj);
    },
    renderBufferDirect(_cam: THREE.Camera, _scene: THREE.Scene, _geo: THREE.BufferGeometry, material: THREE.Material, object: THREE.Object3D): void {
      record(material, object);
    },
    compile: (): void => {
      compiledFor.push(target);
    },
    info: { programs: [] as unknown[] },
    properties: { get: (): object => ({}) },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, draws, bound, compiledFor };
}

/** Flat ground at nought: sand to the west (family 1, gives one, heals one), mud to the north-east (family 2, gives 2.6, heals 0.2), water to the south-east. */
const ground: GroundSampler = {
  sample(x: number, z: number, out: GroundSample): boolean {
    out.h = 0;
    out.family = x < 0 ? 1 : 2;
    out.medium = x >= 0 && z < 0 ? 2 : 1;
    return true;
  },
};
const SAND = { gives: (85 / 255) * 3, heals: 1 };
const MUD = { gives: (221 / 255) * 3, heals: 51 / 255 };

interface Rig {
  field: AirField;
  tune: VolTune;
  draws: Rec[];
  bound: unknown[];
  compiledFor: unknown[];
  inp: ReturnType<typeof newAirFrameInput>;
  frame(dt: number): Rec[];
  /** What `gatherDents` handed each source's slot (its depth), summed since the rig was made. */
  gathered: { depth: number };
}

function rig(world: Partial<AirWorld> = {}): Rig {
  const { renderer, draws, bound, compiledFor } = standIn();
  const tune = newVolTune();
  tune.on = true;
  tune.sand = true;
  tune.prints = true;
  tune.artPrints = 1;
  const field = new AirField(renderer, tune, { ground, boxes: null, hulls: [], ...world });
  field.raster.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 85, 255, 89, 51, 221, 0]);
  field.raster.familyColour = new Uint8Array([0, 0, 0, 0, 204, 168, 117, 255, 120, 90, 60, 255]);
  const gathered = { depth: 0 };
  const dents = field.dents!;
  const real = dents.gatherArgs;
  // The real method, run as it is; the test only adds up the depth each call hands the slot.
  dents.gatherArgs = function (this: typeof dents): void {
    const q = this.gq;
    if (Number.isFinite(q[4]) && q[4] > 0) gathered.depth += q[4];
    real.call(this);
  };
  const inp = newAirFrameInput();
  inp.reading = true;
  inp.ground = true;
  inp.windHeading = 0.4;
  inp.windSpeed = 1;
  inp.sunY = 0.8;
  inp.sunZ = 0.6;
  const frame = (dt: number): Rec[] => {
    const from = draws.length;
    inp.dt = dt;
    inp.time += dt;
    field.update(inp);
    return draws.slice(from);
  };
  return { field, tune, draws, bound, compiledFor, inp, frame, gathered };
}

function settle(r: Rig): void {
  for (let i = 0; i < 400 && (r.field.raster.unknown > 0 || i < 4); i++) r.frame(1 / 60);
  r.frame(1 / 60);
}

const named = (list: Rec[], name: string): Rec[] => list.filter((d) => d.name === name);
/** The stamps a draw laid, less the copies across a wrap line (whose uv lies outside the field's own square). */
const ownStamps = (d: Rec): { u: number; v: number; depth: number; kind: number }[] => (d.stamps ?? []).filter((s) => s.u >= 0 && s.u < 1 && s.v >= 0 && s.v < 1);
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));

/**
 * A run of `seconds` at `fps` with the engine the test stands (moved by `move` each frame if given): the depth gathered,
 * the depth laid (copies aside) on each tick, the fades handed, and the field's depth at the source replayed in float32
 * from the draws -- each frame's stamps added, then its fade multiplied, the GPU's own order -- at the ground's heals.
 */
function runSource(fps: number, seconds: number, engine: { x: number; y: number; z: number; dx: number; dy: number; dz: number; exit: number }, heals: number, move?: (e: { x: number }, dt: number) => void) {
  const r = rig();
  settle(r);
  const gatheredBefore = r.gathered.depth;
  r.field.testEngine = { ...engine };
  const perTick: number[] = [];
  let laid = 0;
  let fades = 0;
  let fadeSum = 0;
  let depth = 0;
  for (let i = 0; i < fps * seconds; i++) {
    if (move) move(r.field.testEngine!, 1 / fps);
    const drawn = r.frame(1 / fps);
    let here = 0;
    for (const d of named(drawn, 'air.dentStamp')) for (const s of ownStamps(d)) here += s.depth;
    if (here > 0) perTick.push(here);
    laid += here;
    depth = Math.fround(depth + Math.fround(here));
    for (const d of named(drawn, 'air.dentFade')) {
      fades++;
      fadeSum += d.fade!;
      depth = Math.fround(depth * Math.fround(Math.exp(-d.fade! * Math.max(heals, d.fadeFloor!))));
    }
  }
  return { gathered: r.gathered.depth - gatheredBefore, laid, perTick, fades, fadeSum, depth, field: r.field };
}

// --- a scour pit under a hovering jet, the real chain at three rates ---
{
  const fpss = [60, 144, 240];
  for (const [where, at, g] of [
    ['sand', { x: -20, z: -20 }, SAND],
    ['mud', { x: 20, z: 20 }, MUD],
  ] as const) {
    const runs = fpss.map((fps) => runSource(fps, 20, { x: at.x, y: 3, z: at.z, dx: 0, dy: -1, dz: 0, exit: 40 }, g.heals));
    const [a, b, c] = runs;
    ok(a.gathered > 0 && rel(b.gathered, a.gathered) < 0.01 && rel(c.gathered, a.gathered) < 0.01, `a jet hovering 3 m over ${where}: what gatherDents hands its slot over 20 s is the same at ${fpss.join(', ')} frames a second (${runs.map((x) => x.gathered.toFixed(5)).join(', ')} m)`);
    // Laid on the tick: the last tick's gathering may still be in the slot, so the laid is within one tick of it.
    const oneTick = a.gathered / 200;
    ok(runs.every((x) => Math.abs(x.laid - g.gives * x.gathered) <= g.gives * oneTick * 1.5), `and what buildBatch lays is what was gathered times the ground's give (${g.gives.toFixed(2)}): ${runs.map((x) => (x.laid / x.gathered).toFixed(4)).join(', ')}`);
    const steady = runs.every((x) => {
      const t = x.perTick;
      const early = t.slice(10, 30).reduce((s, v) => s + v, 0) / 20;
      const late = t.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
      return t.length > 150 && rel(late, early) < 0.05;
    });
    ok(steady, 'each tick lays its own share and no more: as much in the last second as in the second (a source never spent would lay all it ever gathered every tick)');
    ok(runs.every((x) => Math.abs(x.fades - 200) <= 1) && runs.every((x) => rel(x.fadeSum, (0.1 * x.fades) / AIR_TUNE.prints.fade) < 1e-9), `the fade drawn once a tick (${runs.map((x) => x.fades).join(', ')} over 20 s), handed 0.1 · ticks / fade each time`);
    ok(rel(b.depth, a.depth) < 0.01 && rel(c.depth, a.depth) < 0.01 && a.depth > 0, `the pit's depth replayed in float32 from the draws: ${runs.map((x) => x.depth.toFixed(5)).join(', ')} m, alike at every rate`);
  }
}

// --- a speeder's rut along a path: each stamp its share ---
{
  const runs = [60, 144, 240].map((fps) =>
    runSource(fps, 3, { x: -50, y: 0.6, z: -30, dx: 1, dy: 0, dz: 0, exit: 28 }, SAND.heals, (e, dt) => {
      e.x += 12 * dt;
    }),
  );
  ok(runs.every((x) => x.perTick.length > 20), 'a jet skimming the sand at 12 m/s lays a rut on the tick');
  const oneTick = runs[0].gathered / 30;
  ok(runs.every((x) => Math.abs(x.laid - SAND.gives * x.gathered) <= oneTick * 1.5), `laid at two stamps a tick along its path (1.2 m a tick, stamps 0.85 m apart), the whole is the whole gathered: ${runs.map((x) => (x.laid / x.gathered).toFixed(4)).join(', ')}`);
  ok(rel(runs[1].gathered, runs[0].gathered) < 0.01 && rel(runs[2].gathered, runs[0].gathered) < 0.01, `and gathered alike at 60, 144 and 240 frames a second (${runs.map((x) => x.gathered.toFixed(5)).join(', ')} m)`);
}

// --- a footprint on mud fading at mud's heals, over the field's own fades ---
{
  const step = (o: Partial<FootStep> = {}): FootStep => ({ key: 9, kind: 'player', label: 'you', surface: 'mud', from: 'terrain', x: 10, y: 0, z: 10, heading: 0.3, scale: 1, inside: false, deck: null, ground: null, ...o }) as FootStep;
  const fade = (fps: number): { first: number; depth: number; ticks: number } => {
    const r = rig();
    settle(r);
    ok(r.field.dentStep(step()), `at ${fps} frames a second a step on mud is the dents'`);
    let first = 0;
    let depth = 0;
    let ticks = 0;
    for (let i = 0; i < fps * 20; i++) {
      const drawn = r.frame(1 / fps);
      for (const d of named(drawn, 'air.dentStamp')) for (const s of ownStamps(d)) if (s.kind > 0.5) {
        first = s.depth;
        depth = Math.fround(depth + s.depth);
      }
      for (const d of named(drawn, 'air.dentFade')) {
        ticks++;
        depth = Math.fround(depth * Math.fround(Math.exp(-d.fade! * Math.max(MUD.heals, d.fadeFloor!))));
      }
    }
    return { first, depth, ticks };
  };
  const runs = [60, 144, 240].map(fade);
  const d0 = AIR_TUNE.prints.footDepth * MUD.gives;
  const closed = d0 * Math.pow(dentFade(1, MUD.heals), 200);
  ok(runs.every((x) => Math.abs(x.first - Math.fround(d0)) < 1e-9), `the print is pressed at a person's depth times mud's give (${d0.toFixed(4)} m)`);
  ok(runs.every((x) => Math.abs(x.ticks - 200) <= 1 && rel(x.depth, closed) < 0.01), `and after 20 s of the field's own fades it is ${runs.map((x) => x.depth.toFixed(5)).join(', ')} m at 60, 144 and 240 frames a second: the closed form's ${closed.toFixed(5)} m, alike at every rate`);
}

// --- the fade's lines, held to dentFade ---
{
  const shaders = src('world/volumetrics/airShaders.ts');
  const dents = src('world/volumetrics/airDents.ts');
  ok(shaders.includes('float f = exp(-uFadeP.x * max(heals, uFadeP.y));') && shaders.includes('if (land > 0.5) heals = texture(uResponse, l).g;') && shaders.includes('float heals = 1.0;'), "the fade shader multiplies each texel by exp(-rate · max(heals, floor)), its heals the response's green (a cell not known, or a liquid, at one)");
  ok(dents.includes('this.fadeP.x = (0.1 * ticks) / (fade > 0.1 ? fade : 0.1);') && dents.includes('private readonly fadeP = new THREE.Vector2(0.004, 0.02);'), "and the field hands it 0.1 · ticks / fade and the floor of 0.02, dentFade's own arithmetic");
  ok(Math.abs(dentFade(3, 0.01) - Math.exp(-((0.1 * 3) / AIR_TUNE.prints.fade) * 0.02)) < 1e-15, 'which takes heals under the floor at the floor');
}

// --- a blast's crater: by its radius, near the ground only ---
{
  const crater = (y: number, radius: number): number => {
    const r = rig();
    settle(r);
    r.field.blast(-20, y, -20, radius, AIR_TUNE.blast.pushRef, 0);
    let depth = 0;
    for (const d of named(r.frame(1 / 60), 'air.dentStamp')) for (const s of ownStamps(d)) if (s.kind < 0.5) depth = Math.max(depth, s.depth);
    return depth;
  };
  const P = AIR_TUNE.prints;
  const at7 = crater(0, 7);
  const at14 = crater(0, 14);
  ok(Math.abs(at7 - Math.fround(P.craterDepth * 7 * SAND.gives)) < 1e-6 && Math.abs(at14 - 2 * at7) < 1e-6, `a thermal detonator on sand presses a crater ${at7.toFixed(3)} m deep, and one of twice the radius twice as deep`);
  const reach = P.craterReach * 7;
  const half = crater(reach / 2, 7);
  ok(Math.abs(half - at7 / 2) < 1e-6, `one gone off half its reach over the ground (${(reach / 2).toFixed(2)} m), half as deep`);
  ok(crater(reach + 0.01, 7) === 0 && crater(40, 12) === 0, 'and one past its reach -- a ship destroyed 40 m overhead -- presses nothing into the sand below');
}

// --- the ground's uniforms: the square, the art, the session's record ---
{
  const r = rig();
  settle(r);
  const g = r.field.ground;
  const sq = r.field.dents!.square;
  r.inp.camX += 7.3;
  r.inp.camZ -= 3.1;
  r.frame(1 / 60);
  ok(sq.placed && g.uAirDentP.value.x === sq.k0x * sq.t && g.uAirDentP.value.y === sq.k0z * sq.t && g.uAirDentP.value.z === sq.size && g.uAirDentP.value.w === AIR_TUNE.prints.squareEdge, `after the square moves the ground is told its corner (${g.uAirDentP.value.x}, ${g.uAirDentP.value.y}), its size and its edge band`);
  ok(g.uAirDentQ.value.x === 1 / sq.n && g.uAirDentQ.value.y === sq.t && r.field.dents!.target!.width === sq.n, 'and a texel in its uv and in metres, of the target the dents are drawn into');
  const ground = src('world/volumetrics/airGround.ts');
  ok(ground.includes('vec2 gAirDuv = gAirD / uAirDentP.z;'), "the ground reads the dents at the world point over the square's size, with repeat wrapping: the stamp's own fract(x / size), toroidal, wherever the square stands");
  ok(ground.includes('vec2 gAirD = gAirW;'), 'a print is read where it was pressed: the blowing sand of wave 2b never drags it (the second wave read it at the offset)');
  const art = g.uAirArt.value;
  ok(art.x === r.tune.artSand && art.y === r.tune.artPrints && art.z === 0 && art.w === 1, `the art as the frame leaves it: the sand's and the prints' dials, and no shade with nothing drawn by the volume (${art.toArray().join(', ')})`);
  r.tune.sand = false;
  r.frame(1 / 60);
  ok(art.x === 0 && art.y === r.tune.artPrints, "the blowing sand off: the sand's dial is nought, the prints' as it was");
  r.tune.sand = true;
  r.inp.ground = false;
  r.frame(1 / 60);
  ok(art.y === 0, "the ground off the variant (the dents not kept): the prints' dial is nought");
  r.inp.ground = true;
  r.frame(1 / 60);
  r.field.volumeDrew = true;
  r.frame(1 / 60);
  ok(art.z === r.tune.artShade && art.z > 0, "the volume drew the dust last frame with the light pass on: the shade's dial is the setting's");
  r.tune.light = false;
  r.field.volumeDrew = true;
  r.frame(1 / 60);
  ok(art.z === 0, "the light pass off: the shade's dial is nought");
  r.tune.light = true;
}
{
  // Two fields in a session, as the in-play warm makes them: the first made and thrown away (a travel during its warm),
  // the second taken by the world. The variant is the session's, compiled over the world's record.
  const shared = makeAirGroundUniforms();
  const u = makeGroundTileUniforms();
  const variant = groundAirMaterial(u, shared, null);
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, { value: unknown }> };
  variant.onBeforeCompile(shader as never, null as never);
  const a = rig();
  settle(a);
  const b = rig();
  a.field.dispose();
  b.field.bindGround(shared);
  settle(b);
  const read = shader.uniforms.uAirArt.value as THREE.Vector4;
  ok(shader.uniforms.uAirArt === shared.uAirArt && read.w === 1 && read.x === b.tune.artSand && read.y === b.tune.artPrints, `the variant reads the record the world hands the field it took: art (${read.toArray().join(', ')}), standing`);
  ok(shader.uniforms.uAirDents.value === b.field.dents!.target!.texture && shader.uniforms.uAirOffsets.value === b.field.ground.uAirOffsets.value && shader.uniforms.uAirLayers.value === b.field.ground.uAirLayers.value && shader.uniforms.uAirLight.value === b.field.light.value, "and the taken field's own dents, offsets, layers and light, never the thrown-away one's");
  // A field that is not the world's writes nothing the variant reads: a third, made and stepped and let go.
  const c = rig();
  settle(c);
  c.field.releaseTargets();
  c.field.dispose();
  ok(read.w === 1 && shader.uniforms.uAirDents.value === b.field.dents!.target!.texture, 'a field never taken, stepped and disposed, leaves the variant reading the taken one');
  // Another taken: the record is the new one's at once, and the one let go writes nothing it reads from then on.
  b.field.bindGround(null);
  c.field.bindGround(shared);
  ok(read.w === 0 && shader.uniforms.uAirDents.value === null, "the record follows the field taken last at once (this one let go of its targets: nothing standing)");
  b.frame(1 / 60);
  ok(b.field.ground.uAirArt.value.w === 1 && read.w === 0 && shader.uniforms.uAirDents.value === null, 'and the field let go goes on stepping its own record, which the variant no longer reads');
  variant.dispose();
  for (const t of [u.uGround.value, u.uGroundBump.value, u.uGroundMask.value, u.uGroundClouds.value]) t.dispose();
}

// --- the window's move reaches the offsets pass ---
{
  const r = rig();
  settle(r);
  const w = r.field.win;
  r.inp.camX += 4 * w.cell + 0.3;
  r.inp.camZ -= 2 * w.cell;
  const moved = named(r.frame(1 / 240), 'air.offsets');
  ok(moved.length === 1 && Math.abs(moved[0].sandShift![0] - 4 / w.cells) < 1e-12 && Math.abs(moved[0].sandShift![1] + 2 / w.cells) < 1e-12, `a window moved four cells east and two south hands the offsets pass its pending scroll, (${moved[0]?.sandShift?.map((v) => v.toFixed(5)).join(', ')}): the move over the cells`);
  const next = named(r.frame(1 / 240), 'air.offsets');
  ok(next.length === 1 && next[0].sandShift![0] === 0 && next[0].sandShift![1] === 0, 'and the pass after owes nothing');
  ok(src('world/volumetrics/airShaders.ts').includes('vec2 back = l - u * uDt / uWindow.z + uSandShift;') && src('world/volumetrics/airShaders.ts').includes('vec4 o = offsetsAt(back) - vec4(u, u) * uDt;'), 'which the pass reads upstream of the texel, both phases carried by the air: the shader\'s own line (wave 2b\'s; the sand in the air, the third wave\'s, read from the same place)');
}

// --- float32, and each target let go while its switch is off ---
{
  const r = rig();
  settle(r);
  const pair = (r.field as unknown as { offsetsPair: THREE.WebGLRenderTarget[] }).offsetsPair;
  const dents = r.field.dents!.target!;
  ok(pair.every((t) => t.texture.type === THREE.FloatType && t.texture.format === THREE.RGBAFormat), 'the carried offsets are an RGBA32F pair (a half float stalls a drift)');
  ok(dents.texture.type === THREE.FloatType && dents.texture.format === THREE.RedFormat, 'the dents one R32F target (a half float stops a fading print dead)');
  const sand = pair[0].width;
  r.tune.sand = false;
  r.tune.prints = false;
  r.frame(1 / 60);
  ok(pair.every((t) => t.width === 1) && dents.width === 1 && sand > 1, `the sand and the prints off: both let go to a texel across (the offsets were ${sand}², the dents ${r.tune.printDetail}²)`);
  const before = r.field.ground.uAirOffsets.value;
  r.tune.sand = true;
  r.tune.prints = true;
  const back = r.frame(1 / 60);
  // From the third wave the pair is two textures (the two phases, and the sand carried in the air), so the two-output fill.
  const fills = named(back, 'air.fillDust').filter((d) => pair.includes(d.target as THREE.WebGLRenderTarget));
  ok(pair.every((t) => t.width === sand) && dents.width === r.tune.printDetail && fills.length === 2 && named(back, 'air.offsets').length === 1 && before !== null, 'and on again, made again at their sizes, the offsets filled at rest and carried that frame');
  ok(fills.every((d) => d.value!.every((x) => x === 0) && d.shapeValue!.every((x) => x === 0)), 'the offsets are filled at nought: both phases carried nothing (wave 2b\'s, where the second wave filled an age) and no sand in the air (the third wave\'s)');
  const vol = src('world/volumetrics/volSettings.ts');
  ok(/if \(t\.sand\) \{\n\s+const s = n \* t\.sandDetail;\n[^\n]*\n\s+bytes \+= s \* s \* 16 \* 2 \* 2;/.test(vol.replace(/\r\n/g, '\n')) && !vol.includes('RGBA16F pair'), "the page's memory estimate counts the offsets at sixteen bytes a texel, two textures a target (the third wave's carried sand), as they are made");
}

// --- a footprint the dents owned, and a frame that keeps no marks ---
{
  const step = (x: number): FootStep => ({ key: 4, kind: 'player', label: 'you', surface: 'sand', from: 'terrain', x, y: 0, z: -10, heading: 0, scale: 1, inside: false, deck: null, ground: null }) as FootStep;
  for (const [why, set, unset] of [
    ['the player walks into a building that frame', (r: Rig) => (r.inp.where = 'a test: indoors'), (r: Rig) => (r.inp.where = null)],
    ['the ground comes off the variant that frame', (r: Rig) => (r.inp.ground = false), (r: Rig) => (r.inp.ground = true)],
    ['nothing reads the air that frame', (r: Rig) => ((r.inp.reading = false), (r.inp.ground = false)), (r: Rig) => ((r.inp.reading = true), (r.inp.ground = true))],
  ] as const) {
    const r = rig();
    settle(r);
    const owned = r.field.dentStep(step(-10));
    set(r);
    const drawn = r.frame(1 / 60);
    const pressed = named(drawn, 'air.dentStamp').some((d) => ownStamps(d).some((s) => s.kind > 0.5 && s.depth > 0));
    unset(r);
    ok(owned && pressed && r.field.dents!.oneCount === 0, `a step the dents owned, then ${why}: pressed that frame all the same, never neither`);
  }
  const r = rig();
  settle(r);
  r.tune.prints = false;
  ok(!r.field.dentStep(step(-12)), 'and a step after the prints were switched off (between frames) is the decal\'s, though last frame kept marks');
  r.tune.prints = true;
  r.tune.air = false;
  ok(!r.field.dentStep(step(-14)), 'as is one after the moving air was');
}

// --- the in-play warm, the targets let go while it waits ---
{
  const r = rig();
  settle(r);
  const job = r.field.warmJob()!;
  r.field.releaseTargets();
  const boundBefore = r.bound.length;
  const compiledBefore = r.compiledFor.length;
  let made = 0;
  for (const o of job.objects) made += job.compile(o, true);
  ok(made === 0 && r.compiledFor.length === compiledBefore && r.bound.length === boundBefore, `the master off while the warm waited in the queue: its ${job.objects.length} objects compile nothing and bind no target let go (three would make its storage again, and nothing would free it)`);
  const fresh = r.field.warmJob()!;
  for (const o of fresh.objects) fresh.compile(o, false);
  ok(r.compiledFor.length === compiledBefore + fresh.objects.length, 'a warm made after compiles every one, for the targets made again');
}

console.log(`\n${checks} checks passed`);
