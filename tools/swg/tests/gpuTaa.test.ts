// The GPU port's pass 1, wave 6: the edge smoothing (`src/core/gpu/taa/`), held in node as far as node reaches. Node builds no
// WGSL and draws nothing, so the pictures are a browser's (the wave's prover); here:
//  1. the jitter: sixteen Halton(2, 3) offsets about a pixel's centre; `jitterBegin` nudges the camera by `setViewOffset` so a
//     pixel's centre shows what the camera unnudged shows at the centre plus the offset (the upscaled resolve's assumption, in
//     WebGPU's rows from the top), its projection and inverse three's own `updateProjectionMatrix`'s to the bit (worked out by
//     hand, with WebGL's and WebGPU's coordinates and reversed depth), and `jitterEnd` puts the projection back to the bit; a
//     frame that threw is put back at the next begin; the motion frame reads the projection unnudged;
//  2. the motion buffer's blue: the surface's view distance now less last frame's, read off a perspective clip's w (the source);
//  3. the resolves' graphs build over the pass's own records, every number they read by reference, five pictures each, carried
//     through no output of three's, and every picture read by `load` or by a sample at level 0 (no derivative in a branch);
//  4. the pass over a stand-in renderer: the two history targets taken in turn, the one drawn last frame read, the colour copied
//     into the chain's buffer, only the mode drawing at the picture's size, a cut or a new mode taking the new frame whole;
//  5. `PostFX` on WebGPU over a stand-in runtime: under the upscaled smoothing the scene, its products and every pass before the
//     smoothing at its share and the rest at the canvas's, the walk handing the smoothing a buffer of the scene's and taking one of
//     the canvas's from it; Full and Off at the canvas's size, one pair of buffers; the share's dial and the mode resize it; the
//     frame's context and a setting's resize at the scene's size; the readers' size the canvas's where no chain stands (the
//     wave's fixer);
//  6. the dials: each sets through `tuneTaa` as `__debug.gpu({ taa })` does, held to its bounds;
//  7. nothing allocated in a frame (the jitter's begin and end, the pass's prepare and render, the chain's walk), in twelve fresh
//     processes (`--alloc`), the least of three clean windows (`testing.md`).
//
// Run: node tools/swg/tests/gpuTaa.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { JITTER, JITTER_LENGTH, JITTER_OFFSETS, jitterBegin, jitterEnd, radicalInverse, resetJitterForTests, unjitteredProjection } from '../../../src/core/gpu/taa/taaJitter.ts';
import { SMOOTHING, TAA_DIALS, TAA_TUNE, tuneTaa } from '../../../src/core/gpu/taa/taaTune.ts';
import { TAA_NUMBERS, taauGraph, traaGraph, type TaaInputs } from '../../../src/core/gpu/taa/taaGraphs.ts';
import { GpuTaaPass, TAA_STATS, taaPassNow } from '../../../src/core/gpu/taa/taaPass.ts';
import { MOTION, markMotionTarget, motionFrame, motionMatrices, resetMotionForTests } from '../../../src/core/gpu/motion.ts';
import { SCENE_SIZE, sceneSizeFor, sceneSizeNow } from '../../../src/core/gpu/taa/taaSize.ts';
import { passAtSceneSize, walkChainGpu } from '../../../src/core/fx/chainWalkGpu.ts';
import { FX_DEFAULTS, FX_KNOBS, FX_PASSES, fxPassDef, type FxPassId, type FxSettings } from '../../../src/core/fxRegistry.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};
const text = (p: string): string => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n?/g, '\n');

// ---------------------------------------------------------------- stand-ins shared by the sections and the child

/** A renderer that records what is drawn where: enough of three's for `PostFX`, its timer and the pass. */
function standInRenderer(w: number, h: number): Any {
  const log: string[] = [];
  let target: THREE.RenderTarget | null = null;
  return {
    log,
    w,
    h,
    reversedDepthBuffer: true,
    getDrawingBufferSize(v: THREE.Vector2) {
      return v.set(this.w, this.h);
    },
    getContext() {
      return { getExtension: () => null, getError: () => 0, NO_ERROR: 0 };
    },
    getRenderTarget() {
      return target;
    },
    setRenderTarget(t: THREE.RenderTarget | null) {
      target = t;
    },
    render(mesh: THREE.Object3D) {
      if (log.length < 64) log.push(`draw ${mesh.name} into ${target ? target.textures[0].name : 'canvas'}`);
    },
    copyTextureToTexture(src: THREE.Texture, dst: THREE.Texture) {
      if (log.length < 64) log.push(`copy ${src.name} to ${dst.name}`);
    },
    compileAsync: () => Promise.resolve(),
    info: { programs: [], render: { calls: 0, triangles: 0 } },
    capabilities: { reversedDepthBuffer: true },
  };
}

/** A scene target of the chain's kind with a motion buffer beside its colour, and its depth. */
function sceneTargetOf(w: number, h: number): THREE.RenderTarget {
  const depth = new THREE.DepthTexture(w, h, THREE.FloatType);
  depth.format = THREE.DepthStencilFormat;
  const t = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 0, depthTexture: depth, count: 2 });
  markMotionTarget(t);
  return t;
}

const settingsWith = (smoothing: number): FxSettings => ({ ...FX_DEFAULTS, smoothing });

// ---------------------------------------------------------------- 7 (child). what a frame allocates, in a process of its own
if (process.argv.includes('--alloc')) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const least = async (step: () => void, n: number): Promise<number> => {
    let best = Number.POSITIVE_INFINITY;
    for (let w = 0; w < 3; w++) {
      for (let tries = 0; tries < 6; tries++) {
        for (let i = 0; i < 2000; i++) step();
        gc({ type: 'minor' });
        await turn();
        await turn();
        const c0 = collections;
        const b = young();
        for (let i = 0; i < n; i++) step();
        const a = young();
        await turn();
        await turn();
        if (collections === c0) {
          best = Math.min(best, (a - b) / n);
          break;
        }
      }
    }
    return best;
  };
  resetMotionForTests();
  MOTION.applied = true;
  resetJitterForTests();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 20000);
  camera.position.set(4000, 12, -3000);
  camera.updateMatrixWorld();
  const res: Record<string, number> = {};
  // The jitter round the frame's draws, with the motion frame read inside it.
  res.jitter = await least(() => {
    jitterBegin(camera, 1120, 630);
    motionFrame(camera);
    jitterEnd();
  }, 20000);
  // The pass's prepare and render over a stand-in renderer, both modes.
  const r = standInRenderer(1600, 900);
  const scene = sceneTargetOf(1120, 630);
  const pass = new GpuTaaPass(r, scene, settingsWith(SMOOTHING.upscaled));
  pass.setSize(1600, 900, settingsWith(SMOOTHING.upscaled));
  const input = new THREE.RenderTarget(1120, 630, { type: THREE.HalfFloatType });
  const output = new THREE.RenderTarget(1600, 900, { type: THREE.HalfFloatType });
  const ctx: Any = { renderer: r, near: 0.05, far: 20000, cameraCut: false };
  res.passUp = await least(() => {
    pass.prepare(ctx);
    pass.render(ctx, input as Any, output as Any);
  }, 20000);
  pass.setSize(1600, 900, settingsWith(SMOOTHING.full));
  res.passFull = await least(() => {
    pass.prepare(ctx);
    pass.render(ctx, output as Any, output as Any);
  }, 20000);
  console.log(JSON.stringify(res));
  process.exit(0);
}

// ---------------------------------------------------------------- 1. the jitter
{
  ok(JITTER_LENGTH === 16 && JITTER_OFFSETS.length === 32, 'sixteen offsets, x and y');
  const seen = new Set<string>();
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < JITTER_LENGTH; i++) {
    const x = JITTER_OFFSETS[i * 2];
    const y = JITTER_OFFSETS[i * 2 + 1];
    ok(x > -0.5 && x < 0.5 && y > -0.5 && y < 0.5, `offset ${i} lies inside the pixel about its centre (${x.toFixed(4)}, ${y.toFixed(4)})`);
    ok(x === radicalInverse(i + 1, 2) - 0.5 && y === radicalInverse(i + 1, 3) - 0.5, `offset ${i} is Halton(2, 3)'s element ${i + 1}`);
    seen.add(`${x},${y}`);
    sx += x;
    sy += y;
  }
  ok(seen.size === JITTER_LENGTH, 'no two offsets alike');
  ok(Math.abs(sx / JITTER_LENGTH) < 0.04 && Math.abs(sy / JITTER_LENGTH) < 0.04, `the offsets average near the centre (${(sx / 16).toFixed(4)}, ${(sy / 16).toFixed(4)})`);
  ok(radicalInverse(1, 2) === 0.5 && radicalInverse(2, 2) === 0.25 && radicalInverse(3, 3) === 1 / 9, 'the radical inverse');

  resetJitterForTests();
  for (const [reversed, system] of [[false, THREE.WebGLCoordinateSystem], [true, THREE.WebGLCoordinateSystem], [false, THREE.WebGPUCoordinateSystem]] as const) {
    const cam = new THREE.PerspectiveCamera(70, 1600 / 900, 0.05, 9000);
    (cam as Any)._reversedDepth = reversed;
    cam.coordinateSystem = system;
    cam.updateProjectionMatrix();
    cam.position.set(1200, 30, -800);
    cam.rotation.set(0.1, 0.7, 0);
    cam.updateMatrixWorld();
    const P0 = cam.projectionMatrix.clone();
    const PI0 = cam.projectionMatrixInverse.clone();
    const W = 1120;
    const H = 630;
    for (let f = 0; f < JITTER_LENGTH + 3; f++) {
      const i = JITTER.index;
      jitterBegin(cam, W, H);
      const jx = JITTER_OFFSETS[i * 2];
      const jy = JITTER_OFFSETS[i * 2 + 1];
      ok(JITTER.on && JITTER.x === jx && JITTER.y === jy && JITTER.width === W && JITTER.height === H, `frame ${f}: nudged by offset ${i}`);
      ok(unjitteredProjection(cam).equals(P0), `frame ${f}: the projection unnudged is the game's own while nudged`);
      // A view-space point the unnudged camera shows at pixel (px, py) from the top-left: the nudged camera shows it at (px - jx,
      // py - jy), so the pixel whose centre is at m + 0.5 shows what lies at m + 0.5 + the offset.
      const p = new THREE.Vector4(3.1, -1.7, -42, 1);
      const a = p.clone().applyMatrix4(P0);
      const b = p.clone().applyMatrix4(cam.projectionMatrix);
      const pxA = ((a.x / a.w) * 0.5 + 0.5) * W;
      const pyA = (0.5 - (a.y / a.w) * 0.5) * H;
      const pxB = ((b.x / b.w) * 0.5 + 0.5) * W;
      const pyB = (0.5 - (b.y / b.w) * 0.5) * H;
      ok(Math.abs(pxB - (pxA - jx)) < 1e-6 && Math.abs(pyB - (pyA - jy)) < 1e-6, `frame ${f}${reversed ? ', reversed depth' : ''}: the nudged camera shows the point the offset up and left (${(pxB - pxA).toFixed(6)}, ${(pyB - pyA).toFixed(6)} against ${(-jx).toFixed(6)}, ${(-jy).toFixed(6)})`);
      ok(Math.abs(b.z / b.w - a.z / a.w) < 1e-9 && Math.abs(b.w - a.w) < 1e-9, `frame ${f}: its depth is unmoved`);
      // The nudge is worked out by hand (`nudgedProjection`, so nothing is boxed): three's own `setViewOffset` and
      // `updateProjectionMatrix` on a twin camera give the very same projection and inverse, to the bit.
      const twin = new THREE.PerspectiveCamera(cam.fov, cam.aspect, cam.near, cam.far);
      (twin as Any)._reversedDepth = reversed;
      twin.coordinateSystem = system;
      twin.setViewOffset(W, H, jx, jy, W, H);
      ok(cam.projectionMatrix.equals(twin.projectionMatrix) && cam.projectionMatrixInverse.equals(twin.projectionMatrixInverse), `frame ${f}${reversed ? ', reversed depth' : ''}${system === THREE.WebGPUCoordinateSystem ? ', WebGPU coordinates' : ''}: the nudged projection and its inverse are three's own updateProjectionMatrix's, to the bit`);
      // The motion frame inside the nudge reads the game's projection.
      resetMotionForTests();
      motionFrame(cam);
      const m = { pNow: new THREE.Matrix4(), dPrev: new THREE.Matrix4() };
      motionMatrices(m);
      ok(m.pNow.equals(P0), `frame ${f}: the motion frame works with the projection unnudged`);
      jitterEnd();
      ok(!JITTER.on && JITTER.index === (i + 1) % JITTER_LENGTH, `frame ${f}: the cycle moved on`);
      ok(cam.projectionMatrix.equals(P0) && cam.projectionMatrixInverse.equals(PI0), `frame ${f}: the projection put back to the bit`);
      ok(unjitteredProjection(cam) === cam.projectionMatrix, `frame ${f}: unnudged, the camera's own projection is read`);
    }
    // A frame that threw while nudged: the next begin puts it back first, so what it keeps is the game's own.
    const stale = JITTER.stale;
    jitterBegin(cam, W, H);
    jitterBegin(cam, W, H);
    ok(JITTER.stale === stale + 1 && unjitteredProjection(cam).equals(P0), 'a camera still nudged at a begin is put back first and the game\'s projection kept');
    jitterEnd();
    jitterEnd();
    ok(cam.projectionMatrix.equals(P0) && !JITTER.on, 'and put back, a second end doing nothing');
  }
}

// ---------------------------------------------------------------- 2. the motion buffer's blue
{
  const m = text('src/core/gpu/motion.ts');
  ok(/function surfaceMotion\(cur: Any, prev: Any\): Any \{\n\s+const ok = cur\.w\.greaterThan\(1e-6\)\.and\(prev\.w\.greaterThan\(1e-6\)\);\n\s+return vec4\(ndcLess\(cur, prev\), select\(ok, cur\.w\.sub\(prev\.w\), float\(0\)\), 0\);/.test(m), "motion.ts: a surface's blue is its clip w now less last frame's (the view distance's change), nought behind the camera");
  ok(m.includes('return surfaceMotion(n.pNow.mul(vec4(pv, 1)), n.dPrev.mul(vec4(moved, 1)));'), "motion.ts: every surface that writes its own motion writes it so (the sky's blue stays nought)");
  ok(m.includes('P_NOW.copy(unjitteredProjection(camera));'), "motion.ts: the frame's projection is the game's own while the camera is nudged");
  // A perspective clip's w is the view distance: so the blue is the distance's change.
  const cam = new THREE.PerspectiveCamera(60, 1.5, 0.05, 9000);
  const v = new THREE.Vector4(2, 1, -37.5, 1).applyMatrix4(cam.projectionMatrix);
  ok(Math.abs(v.w - 37.5) < 1e-9, "a perspective clip's w is the view distance (three's projection)");
}

// ---------------------------------------------------------------- 3. the graphs
const fb = (): THREE.Texture => {
  const t = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.needsUpdate = true;
  return t;
};
{
  const scene = sceneTargetOf(64, 36);
  const u: TaaInputs = {
    input: { value: null },
    history: { value: null },
    aux: { value: null },
    depth: scene.depthTexture as THREE.Texture,
    motion: scene.textures[1],
    reversed: true,
    p0: new THREE.Vector4(0.05, 9000.5, 0.05, 0.8),
    p1: new THREE.Vector4(0.05, 0.1, 128.5, 0.5),
    size: new THREE.Vector4(1.5, 1.5, 1.5, 1.5),
    jitter: new THREE.Vector2(0.25, 0.25),
  };
  for (const [name, g] of [
    ['full', traaGraph(u)],
    ['upscaled', taauGraph({ ...u, reversed: false })],
  ] as const) {
    ok(g.material.name === `fx.gpu.taa.${name}`, `the ${name} resolve is named for the census`);
    ok((g.material as Any).swgRawOut === true && g.material.toneMapped === false && g.material.depthTest === false, `the ${name} resolve is carried through no output of three's and tests no depth`);
    ok((g.material.fragmentNode as Any)?.isOutputStructNode === true, `the ${name} resolve writes two outputs (the colour, and the distance beside it)`);
    ok(g.parts.uniforms.p0.value === u.p0 && g.parts.uniforms.p1.value === u.p1 && g.parts.uniforms.size.value === u.size && g.parts.uniforms.jitter.value === u.jitter, `the ${name} resolve reads the pass's four vectors by reference`);
    ok(g.textures === 5 && Object.keys(g.parts.textures).length === 5, `the ${name} resolve binds five pictures`);
    ok(g.parts.textures.depth.value === u.depth && g.parts.textures.motion.value === u.motion, `the ${name} resolve reads this chain's depth and motion buffer`);
    for (const k of ['input', 'history', 'aux']) ok(g.parts.textures[k].isLiveTexture === true && g.parts.textures[k].source === (u as Any)[k], `the ${name} resolve's ${k} is the pass's record, rebound as it draws`);
    ok(g.mesh.frustumCulled === false && g.mesh.userData.gpuChain === true, `the ${name} resolve is drawn on the chain's triangle`);
  }
  const src = text('src/core/gpu/taa/taaGraphs.ts');
  const samples = src.match(/\.sample\([^)]*\)(\.level\(0\))?/g) ?? [];
  ok(samples.length >= 3 && samples.every((s) => s.endsWith('.level(0)')), `every sample in the resolves is at level 0 (${samples.length}): no derivative is taken in a branch`);
  ok(!/positionWorld|cameraPosition|modelWorldMatrix/.test(src), 'the resolves read no place measured from the world\'s middle');
  ok(TAA_NUMBERS.farKept < 65504, "the far kept fits a half float's range");
}

// ---------------------------------------------------------------- 4. the pass over a stand-in renderer
{
  const r = standInRenderer(1600, 900);
  const scene = sceneTargetOf(1120, 630);
  const pass = new GpuTaaPass(r, scene, settingsWith(SMOOTHING.upscaled));
  const ctx: Any = { renderer: r, near: 0.05, far: 9000, cameraCut: false };
  pass.setSize(1600, 900, settingsWith(SMOOTHING.upscaled));
  const rep = pass.report() as Any;
  ok(rep.mode === 'upscaled' && rep.motionBuffer === true && rep.picture[0] === 1600 && rep.picture[1] === 900, 'the upscaled history is the picture\'s size');
  const items = pass.materials();
  ok(items.length === 2 && items.every((it) => it.into && it.where === 'target' && it.object), 'both resolves are warmed, each into a history target of its own kind');
  const full = (pass as Any).full;
  const up = (pass as Any).up;
  ok(full.rt[0].width === 1 && full.rt[1].width === 1 && up.rt[0].width === 1600 && up.rt[1].height === 900, 'only the mode drawing holds targets the picture\'s size; the other\'s stand at a pixel');
  ok(full.rt[0].textures[1].format === THREE.RedFormat && up.rt[0].textures[1].format === THREE.RGFormat && full.rt[0].textures.length === 2, "the full history keeps a distance beside its colour, the upscaled one a distance and a lock");
  const input = new THREE.RenderTarget(1120, 630, { type: THREE.HalfFloatType });
  input.texture.name = 'fx.lowA';
  const output = new THREE.RenderTarget(1600, 900, { type: THREE.HalfFloatType });
  output.texture.name = 'fx.a';
  const inputs = (pass as Any).inputs as TaaInputs;
  pass.prepare(ctx);
  ok(inputs.p1.w === 1, 'the first resolve takes the new frame whole');
  r.log.length = 0;
  pass.render(ctx, input as Any, output as Any);
  ok(r.log[0] === 'draw fx.gpu.taa.upscaled into fx.gpu.taa.upscaled.1.color' && r.log[1] === 'copy fx.gpu.taa.upscaled.1.color to fx.a', `it resolves into the target not read and copies the colour into the chain's buffer (${r.log.join('; ')})`);
  ok(inputs.history.value === up.rt[0].textures[0] && inputs.aux.value === up.rt[0].textures[1] && inputs.input.value === input.texture, 'reading the other target\'s colour and distance, and this frame\'s picture');
  ok(inputs.size.x === 1120 && inputs.size.y === 630 && inputs.size.z === 1600 && inputs.size.w === 900, "the scene's size and the picture's handed to the graph");
  pass.prepare(ctx);
  ok(inputs.p1.w === 0, 'the next resolve gathers');
  r.log.length = 0;
  pass.render(ctx, input as Any, output as Any);
  ok(r.log[0] === 'draw fx.gpu.taa.upscaled into fx.gpu.taa.upscaled.0.color' && inputs.history.value === up.rt[1].textures[0], 'and the two targets are taken in turn');
  ctx.cameraCut = true;
  pass.prepare(ctx);
  ok(inputs.p1.w === 1, 'a cut takes the new frame whole');
  ctx.cameraCut = false;
  TAA_TUNE.reactive = 0.65;
  pass.prepare(ctx);
  ok(inputs.p0.z === TAA_TUNE.currentUp && inputs.p0.w === 0.65 && inputs.p1.x === TAA_TUNE.depth && inputs.p1.y === TAA_TUNE.edge && inputs.p1.z === TAA_TUNE.maxMotion, 'the dials reach the graph at the next frame');
  TAA_TUNE.reactive = 0.8;
  pass.setSize(1600, 900, settingsWith(SMOOTHING.full));
  pass.prepare(ctx);
  ok(inputs.p1.w === 1 && inputs.p0.z === TAA_TUNE.current, 'a new mode starts over, with its own share of the new frame');
  ok(full.rt[0].width === 1600 && up.rt[0].width === 1, 'and holds its own targets at the picture\'s size, the other mode\'s at a pixel');
  pass.setSize(1600, 900, settingsWith(SMOOTHING.off));
  ok(!pass.enabled(ctx) && pass.reason(ctx) === 'Smoothing is Off on the Graphics page' && full.rt[0].width === 1, 'Off draws nothing and holds nothing');
  const noMotion = new THREE.RenderTarget(8, 8, { type: THREE.HalfFloatType, depthBuffer: true, depthTexture: new THREE.DepthTexture(8, 8) });
  const p2 = new GpuTaaPass(r, noMotion, settingsWith(SMOOTHING.full));
  ok(!p2.enabled(ctx) && !p2.canDraw() && /no motion buffer/.test(p2.reason(ctx) ?? ''), 'with no motion buffer the pass never draws, and says why');
  // Wave 6's fixer: whether a chain stands is the newest pass not let go of; a newer one let go of (a chain the Effects switch
  // made and threw away) leaves the older standing, and with every pass let go of none stands.
  ok(taaPassNow() === p2, 'the newest pass made is the one the console reads');
  p2.dispose();
  ok(taaPassNow() === pass, 'a newer pass let go of leaves the older one standing');
  pass.dispose();
  ok(taaPassNow() === null, 'with every pass let go of, no chain stands');
}

// ---------------------------------------------------------------- 5. the chain's sizes and its walk on WebGPU
// `PostFX` itself does not load in node (its constructor's parameter property): the sizes are the real runtime's `inputSize`, the
// walk is `walkChainGpu` (which `PostFX`'s WebGPU branch calls), and `PostFX`'s own WebGPU lines are held as text.
interface Stand {
  id: FxPassId;
  timerLabel: string;
  rw: [string, string | null][];
  prepare(): void;
  render(ctx: unknown, input: THREE.RenderTarget, output: THREE.RenderTarget | null): boolean;
}
function standPass(id: FxPassId): Stand {
  const s: Stand = {
    id,
    timerLabel: `pass:${id}`,
    rw: [],
    prepare() {},
    render(_ctx, input, output) {
      if (s.rw.length < 32) s.rw.push([`${input.texture.name}@${input.width}`, output ? `${output.texture.name}@${output.width}` : null]);
      return true;
    },
  };
  return s;
}
const named = (name: string, w: number, h: number): THREE.RenderTarget => {
  const t = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType });
  t.texture.name = name;
  return t;
};
const timer = { begin() {}, end() {} };
let walkOnce: (() => void) | null = null;
{
  resetMotionForTests();
  MOTION.applied = true;
  const out = new THREE.Vector2();
  // The runtime's own `inputSize` is `sceneSizeFor` with the motion buffer's switch (gpuChainPasses.ts, held as text below).
  const chain = { inputSize: (w: number, h: number, s: FxSettings, o: THREE.Vector2) => sceneSizeFor(w, h, Number(s.smoothing), MOTION.applied, o) };
  ok(text('src/core/gpu/gpuChainPasses.ts').includes('return sceneSizeFor(width, height, Number(settings.smoothing), motionWanted(), out);'), 'the runtime sizes the scene by sceneSizeFor with the motion buffer wanted');
  chain.inputSize(1600, 900, settingsWith(SMOOTHING.upscaled), out);
  ok(out.x === 1120 && out.y === 630 && SCENE_SIZE.width === 1120 && SCENE_SIZE.height === 630 && SCENE_SIZE.upscaled && SCENE_SIZE.share === 0.7, `Upscaled: the scene at 0.7 of 1600 by 900 (${out.x} by ${out.y})`);
  chain.inputSize(1600, 900, settingsWith(SMOOTHING.full), out);
  ok(out.x === 1600 && out.y === 900 && !SCENE_SIZE.upscaled, 'Full: the canvas\'s size');
  chain.inputSize(1600, 900, settingsWith(SMOOTHING.off), out);
  ok(out.x === 1600 && !SCENE_SIZE.upscaled, 'Off: the canvas\'s size');
  TAA_TUNE.share = 0.5;
  chain.inputSize(1600, 900, settingsWith(SMOOTHING.upscaled), out);
  ok(out.x === 800 && out.y === 450 && SCENE_SIZE.share === 0.5, 'the share\'s dial sizes it');
  TAA_TUNE.share = 0.7;
  MOTION.applied = false;
  chain.inputSize(1600, 900, settingsWith(SMOOTHING.upscaled), out);
  ok(out.x === 1600 && !SCENE_SIZE.upscaled, 'with no motion buffer the scene is the canvas\'s size whatever Smoothing says (nothing could fill it out)');
  MOTION.applied = true;
  chain.inputSize(3, 3, settingsWith(SMOOTHING.upscaled), out);
  ok(out.x >= 1 && out.y >= 1, 'never below a pixel');
  ok(passAtSceneSize('sanitize') && passAtSceneSize('ssao') && !passAtSceneSize('taa') && !passAtSceneSize('bloom') && !passAtSceneSize('colorGrade') && !passAtSceneSize('output') && !passAtSceneSize('debugView'), 'the passes before the smoothing at the scene\'s size, the smoothing and after at the canvas\'s');

  // The walk under Upscaled: the scene's buffers, then the canvas's from the smoothing on.
  const ids: FxPassId[] = ['sanitize', 'ssao', 'taa', 'bloom', 'colorGrade', 'output'];
  const stands = ids.map(standPass);
  const st = (id: FxPassId) => stands[ids.indexOf(id)];
  const on = ids.map(() => true);
  const up = { scene: named('fx.scene', 1120, 630), lowA: named('fx.lowA', 1120, 630), lowB: named('fx.lowB', 1120, 630), bufferA: named('fx.a', 1600, 900), bufferB: named('fx.b', 1600, 900) };
  walkChainGpu(null, stands, on, ids.length - 1, up, timer, null);
  const rw = (id: FxPassId) => JSON.stringify(st(id).rw[0]);
  ok(rw('sanitize') === JSON.stringify(['fx.scene@1120', 'fx.lowA@1120']), `the sanitize reads the scene and writes a buffer of its size (${rw('sanitize')})`);
  ok(rw('ssao') === JSON.stringify(['fx.lowA@1120', 'fx.lowB@1120']), `the occlusion the other (${rw('ssao')})`);
  ok(rw('taa') === JSON.stringify(['fx.lowB@1120', 'fx.a@1600']), `the smoothing reads the scene's and writes the canvas's (${rw('taa')})`);
  ok(rw('bloom') === JSON.stringify(['fx.a@1600', 'fx.b@1600']) && rw('colorGrade') === JSON.stringify(['fx.b@1600', 'fx.a@1600']) && rw('output') === JSON.stringify(['fx.a@1600', null]), 'and the rest the canvas\'s, the last onto the canvas');
  // Full: one pair, ping-ponged as the WebGL walk does.
  const one = { scene: named('fx.scene', 1600, 900), lowA: up.bufferA, lowB: up.bufferB, bufferA: up.bufferA, bufferB: up.bufferB };
  for (const s of stands) s.rw.length = 0;
  walkChainGpu(null, stands, on, ids.length - 1, one, timer, null);
  ok(rw('sanitize') === JSON.stringify(['fx.scene@1600', 'fx.a@1600']) && rw('ssao') === JSON.stringify(['fx.a@1600', 'fx.b@1600']) && rw('taa') === JSON.stringify(['fx.b@1600', 'fx.a@1600']), `Full: one pair of buffers, ping-ponged (${rw('ssao')} then ${rw('taa')})`);
  // A pass off before the smoothing: it never writes the buffer it reads.
  on[ids.indexOf('ssao')] = false;
  for (const s of stands) s.rw.length = 0;
  walkChainGpu(null, stands, on, ids.length - 1, one, timer, null);
  ok(rw('taa') === JSON.stringify(['fx.a@1600', 'fx.b@1600']) && st('ssao').rw.length === 0, `with the occlusion off the smoothing writes the buffer it does not read (${rw('taa')})`);
  on[ids.indexOf('ssao')] = true;
  // The smoothing off under the scene's own size: the passes after it read the scene's buffer and write the canvas's.
  on[ids.indexOf('taa')] = false;
  for (const s of stands) s.rw.length = 0;
  walkChainGpu(null, stands, on, ids.length - 1, up, timer, null);
  ok(rw('bloom') === JSON.stringify(['fx.lowB@1120', 'fx.a@1600']), `with the smoothing off at its place, the next pass still takes the canvas's buffers (${rw('bloom')})`);
  on[ids.indexOf('taa')] = true;
  const labels: string[] = [];
  walkChainGpu(null, stands, on, ids.length - 1, up, timer, (l) => labels.push(l));
  ok(labels.join() === ids.map((i) => `pass:${i}`).join(), 'the error check after each pass, where asked');
  walkOnce = () => walkChainGpu(null, stands, on, ids.length - 1, up, timer, null);

  // PostFX's own WebGPU lines, as text (the WebGL lines beside them are gpuOff.test.ts's).
  const px = text('src/core/postfx.ts');
  for (const line of [
    'if (GPU.webgpu) GPU.rt!.chain.inputSize(w, h, this.settings, this.inputV);',
    'if (GPU.webgpu) this.sizePassGpu(pass);',
    'if (GPU.webgpu) product.setSize(this.inputV.x, this.inputV.y, this.settings);',
    'if (GPU.webgpu && this.settings.smoothing !== smoothing) this.setSize();',
    'if (GPU.webgpu) this.chainGpu(ctx, last, check);',
    'walkChainGpu(ctx, this.passes, this.on, last, w, this.timer, check ? this.checkAfter : null);',
    'if (passAtSceneSize(p.id)) p.setSize(this.inputV.x, this.inputV.y, this.settings);',
    'for (const p of this.productList) p.setSize(iw, ih, this.settings);',
    'this.ctx.width = iw;',
    'if (GPU.webgpu) this.disposeLowGpu();',
    // Wave 6's fixer: the frame's context at the scene's size, and a setting's resize by the scene-size rule.
    'if (GPU.webgpu) updateContext(ctx, input, this.inputV);',
    'if (GPU.webgpu) this.configureSizesGpu(ssao, water, cloudQuality, cloudAmount, air, clouds);',
    "if (s.ssaoResolution !== ssao) this.resizePassGpu('ssao');",
    'if (p) this.sizePassGpu(p);',
  ]) ok(px.includes(line), `postfx.ts: ${line}`);
  // No other reader on WebGPU puts the context back to the canvas's size: `updateContext` is called once, under its guard.
  ok(px.split('\n').filter((x) => x.includes('updateContext(ctx, input,')).length === 2, 'postfx.ts: the context is taken once a frame, at the scene\'s size on WebGPU');

  // Wave 6's fixer: the scene's size for whatever reads its pixels is the chain's while one stands, the canvas's while none does
  // (Effects off at load read a pixel, and turned off in play the last chain's size).
  {
    const canvas = (o: THREE.Vector2): THREE.Vector2 => o.set(1584, 805);
    const got = new THREE.Vector2();
    SCENE_SIZE.width = 1;
    SCENE_SIZE.height = 1;
    ok(sceneSizeNow(got, false, canvas).x === 1584 && got.y === 805, `before any chain, no chain standing: the canvas's size, never a pixel (${got.x} by ${got.y})`);
    chain.inputSize(1584, 805, settingsWith(SMOOTHING.upscaled), out);
    ok(sceneSizeNow(got, true, canvas).x === 1109 && got.y === 564, `a chain standing under Upscaled: its scene's size (${got.x} by ${got.y})`);
    ok(sceneSizeNow(got, false, canvas).x === 1584 && got.y === 805, `that chain let go of (Effects off): the canvas's, not the last chain's (${got.x} by ${got.y})`);
    const st = text('src/core/gpu/start.ts');
    ok(st.includes('return sceneSizeNow(out, taaPassNow() !== null, canvasSize);') && st.includes('const canvasSize = (out: THREE.Vector2): THREE.Vector2 => renderer.getDrawingBufferSize(out);'), "start.ts: the runtime's sceneSize asks whether a chain stands, the drawing buffer's size where none does");
  }
}
// ---------------------------------------------------------------- 6. the registry, the row and the dials
{
  const def = fxPassDef('taa');
  const at = FX_PASSES.indexOf(def);
  ok(FX_PASSES[at - 1].id === 'underwater' && FX_PASSES[at + 1].id === 'depthOfField' && at > FX_PASSES.findIndex((p) => p.id === 'ssao') && at < FX_PASSES.findIndex((p) => p.id === 'bloom'), 'the smoothing stands last of the scene\'s passes, after the occlusion and before the lens and the bloom');
  ok(def.toggles.length === 1 && def.toggles[0] === 'effects' && !def.typical && !def.canBeLast, "on with the chain (its mode, Off among them, the Smoothing row's, which the pass reads); not typical (WebGPU's alone); never last");
  const knob = FX_KNOBS.find((k) => k.key === 'smoothing')!;
  ok(knob.kind === 'select' && knob.pass === 'taa' && knob.options!.map((o) => o.label).join() === 'Off,Full,Upscaled' && knob.requires.includes('effects'), 'the Graphics page\'s Smoothing row: Off, Full, Upscaled, with Effects');
  ok(FX_DEFAULTS.smoothing === SMOOTHING.full, 'new players start on Full (High)');
  const keys = TAA_DIALS.groups.flatMap((g) => g.dials.map((d) => d.key));
  ok(TAA_DIALS.helper === 'gpu' && ['taa.share', 'taa.current', 'taa.currentUp', 'taa.reactive', 'taa.depth', 'taa.edge'].every((k) => keys.includes(k)), `the dials: the share, the new frame's two shares, the reactive one and the depth tests (${keys.join(', ')})`);
  for (const g of TAA_DIALS.groups) {
    for (const d of g.dials) {
      if (d.kind !== 'number') continue;
      const was = d.get();
      const said = d.set(d.min);
      ok(said.length === 0 && d.get() === d.min, `${d.key}: set to its slider's least through tuneTaa`);
      d.set(was);
      ok(d.get() === was && TAA_DIALS.shipped.get(d.key) === was, `${d.key}: back to what shipped`);
    }
  }
  ok(tuneTaa({ share: 3 })[0]?.includes('held to 1') && TAA_TUNE.share === 1, 'a value past its bounds is held to them, and said');
  TAA_TUNE.share = 0.7;
  ok(tuneTaa({ bogus: 1 } as Any)[0]?.includes("no number named 'bogus'"), 'a name it has not is refused');
  const menu = text('src/ui/menu.ts');
  ok(menu.includes('if (state?.hide) return \'\';'), "the menu leaves out a row the game says to hide");
  const main = text('src/main.ts');
  ok(main.includes("if (!GPU.webgpu && key === 'smoothing') return { hide: true };"), 'on WebGL the Smoothing row is hidden, the page as it was');
}

// ---------------------------------------------------------------- 7. nothing allocated in a frame, in twelve fresh processes at once
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from({ length: 12 }, () =>
      new Promise<string>((done) => {
        const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        ch.stdout.on('data', (d) => (out += d));
        ch.stderr.on('data', (d) => (err += d));
        ch.on('close', () => done(out.trim().split('\n').pop() || `no answer: ${err.slice(0, 300)}`));
      }),
    ),
  );
  const parsed = runs.map((s) => {
    try {
      return JSON.parse(s) as Record<string, number>;
    } catch {
      return null;
    }
  });
  const bad = runs.filter((_, i) => parsed[i] === null);
  ok(bad.length === 0, `every process answered (${bad.join('; ')})`);
  for (const what of ['jitter', 'passUp', 'passFull']) {
    const v = parsed.map((p) => p![what]);
    const said = v.map((x) => x.toFixed(2)).join(', ');
    ok(v.every((x) => Number.isFinite(x) && x < 0.5), `${what} allocates nothing in 12 of 12 processes (${said} B a call)`);
  }
}

// The chain's walk allocates nothing either, measured in this process (the least of six windows).
if (walkOnce) {
  const v8 = await import('node:v8');
  const walk = walkOnce;
  for (let i = 0; i < 5000; i++) walk();
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 6; k++) {
    const b = young();
    for (let i = 0; i < 20000; i++) walk();
    const a = young();
    if (a >= b) best = Math.min(best, (a - b) / 20000);
  }
  ok(best < 0.5, `the chain's walk on WebGPU allocates nothing (${best.toFixed(2)} B a frame)`);
}
console.log(`gpuTaa: ${checks} checks passed`);
