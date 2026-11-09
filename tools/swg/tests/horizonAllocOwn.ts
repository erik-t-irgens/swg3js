// The far ground's frame makes nothing (the horizon pass's first wave, DESIGN.md §3 Guards): the camera walks, turns and
// climbs to 2 km while the fog thickens and thins (the reach in force moving with it), and each frame the world's own
// calls are made -- the sky's dome copied into the ring's uniforms (`copyDome`), the fog's density into the field's
// record and the real `HorizonField.update` over a real `RingSession` (the reach rules, the camera's frustum, the
// selection, the uniforms, the uploads, the detail window's ask) -- over a window of frames with no collection, the
// cleanest of three kept. The camera's poses are cameras made before the window (each frame hands the field another,
// its matrices current), so what is measured is the field's frame and nothing of the harness's. Not a test itself:
// `horizonAlloc.test.ts` runs it in twelve processes at once (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { HORIZON_TUNE, HoleGrid, LEAF } from '../../../src/world/horizon/horizonMath.ts';
import { HorizonField, RingSession, copyDome, type DomeUniforms } from '../../../src/world/horizon/horizonField.ts';
import { windowPlace, windowTiles, type WindowPlace } from '../../../src/world/horizon/horizonDecode.ts';
import { SHAPE_BLOCK, SHAPE_SIDE, ShapeWindow, shapeSourceOf } from '../../../src/world/horizon/shapeWindow.ts';
import { TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { rolling, testCamera, testHole, testPyramid } from './horizonFixtures.ts';

const shift = { x: 1, z: 0 };
const hole = new HoleGrid();
const session = new RingSession(null);
const field = new HorizonField('alloc', { x: 0, z: 0 }, shift);
field.pyramid = testPyramid(24000, shift);
// A worker that takes the detail window's asks and answers nothing: what the frame does with one is posting it.
(field as unknown as { worker: unknown }).worker = { postMessage() {}, terminate() {} };
testHole(hole, 0, 0, 6);
HORIZON_TUNE.reach = 8000;
// The sky's dome uniforms as the sky holds them: the clock and the mix moving every frame.
const dome = {
  uGradient: { value: null },
  uGradient2: { value: null },
  uGradientMix: { value: 0.25 },
  uTime: { value: 0.5 },
  uHasGradient: { value: 1 },
  uHasGradient2: { value: 0 },
  uClear: { value: new THREE.Color(0.4, 0.5, 0.7) },
  uHorizonFog: { value: new THREE.Color(0.6, 0.6, 0.6) },
} as unknown as DomeUniforms;

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => {
  await tick();
  await tick();
};

const st = new Float64Array(4);
st[2] = 0.5;
// The camera's poses over the walk, the turn and the climb (a walk over a 2 km square, so the detail window is asked for
// again now and then), each a camera of its own with its matrices current, made before the window.
const POSES = 512;
const cams: THREE.PerspectiveCamera[] = [];
for (let p = 0; p < POSES; p++) {
  const t = p * 37;
  const x = Math.sin(t * 0.002) * 1000;
  const z = Math.cos(t * 0.0017) * 1000;
  const up = 2 + (Math.sin(t * 0.0009) * 0.5 + 0.5) * 2000;
  const cam = testCamera();
  cam.position.set(x, rolling(x, z) + up, z);
  cam.rotation.set(-0.05 - (up > 300 ? 0.4 : 0), t * 0.01, 0, 'YXZ');
  cam.updateMatrixWorld();
  cams.push(cam);
}
/** One frame of the rings, as the world makes it (compiled as itself; the loop round it is kept out of the optimizer). */
function frame(): void {
  st[0] += 1;
  const t = st[0];
  const p = (t | 0) & (POSES - 1);
  const cam = cams[p];
  // The world's copy of the sky's dome (the sky writes its own clock into it, its own cost and not measured here).
  copyDome(session.uniforms, dome);
  field.rules.fogDensity = 0.0002 + (Math.sin(t * 0.003) * 0.5 + 0.5) * 0.0006;
  field.update(session, cam, cam.position, 6, 0, 0, hole, true);
  st[1] += session.selector.patchCount;
}
function frames(n: number): void {
  for (let i = 0; i < n; i++) frame();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler.
}
void LEAF;
const N = 60_000;
frames(4000);
let best = { made: Infinity, scavenges: Infinity };
for (let attempt = 0; attempt < 3; attempt++) {
  frames(1000);
  (globalThis as unknown as { gc: (o?: { type: string }) => void }).gc({ type: 'minor' });
  await settle();
  scavenges = 0;
  const before = young();
  frames(N);
  const made = young() - before;
  await settle();
  if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
  if (best.scavenges === 0 && best.made <= 0) break;
}
// The third wave's composition window, kept round the eye: with the field holding a window that stands round where the
// camera turns and climbs, every frame works out where the window would stand and asks nothing (the steady frame of a
// player who has not walked 128 m), which must make nothing either. The stand-in worker takes an ask by putting the
// window where it was asked, as a landing does.
const S = windowTiles(HORIZON_TUNE.detailReach);
const f = field as unknown as { header: unknown; place: WindowPlace; windowAsked: number; worker: unknown };
f.header = { colour: { x0: 0, z0: 0, step: 8, nx: 4000, nz: 4000 } };
const centreRaw = { rx: -cams[0].position.x, rz: cams[0].position.z };
Object.assign(f.place, windowPlace(centreRaw.rx, centreRaw.rz, S, { x0: 0, z0: 0, step: 8, nx: 4000, nz: 4000 }));
f.windowAsked = 0;
let asks = 0;
f.worker = {
  postMessage(m: { place?: WindowPlace }) {
    asks++;
    if (m.place) Object.assign(f.place, m.place);
    f.windowAsked = 0;
  },
  terminate() {},
};
const still: THREE.PerspectiveCamera[] = [];
for (let p = 0; p < POSES; p++) {
  const cam = testCamera();
  const x = cams[0].position.x + Math.sin(p * 0.3) * 40;
  const z = cams[0].position.z + Math.cos(p * 0.21) * 40;
  cam.position.set(x, rolling(x, z) + 2 + (p % 64) * 30, z);
  cam.rotation.set(-0.05 - (p % 3) * 0.2, p * 0.05, 0, 'YXZ');
  cam.updateMatrixWorld();
  still.push(cam);
}
function stillFrame(): void {
  st[2] += 1;
  const cam = still[(st[2] | 0) & (POSES - 1)];
  copyDome(session.uniforms, dome);
  field.update(session, cam, cam.position, 6, 0, 0, hole, true);
}
function stillFrames(n: number): void {
  for (let i = 0; i < n; i++) stillFrame();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(stillFrames);
} catch {
  // Without the flag the loop is left to the compiler.
}
stillFrames(4000);
let bestStill = { made: Infinity, scavenges: Infinity };
for (let attempt = 0; attempt < 3; attempt++) {
  stillFrames(1000);
  (globalThis as unknown as { gc: (o?: { type: string }) => void }).gc({ type: 'minor' });
  await settle();
  scavenges = 0;
  const before = young();
  stillFrames(N);
  const made = young() - before;
  await settle();
  if (scavenges < bestStill.scavenges || (scavenges === bestStill.scavenges && made < bestStill.made)) bestStill = { made, scavenges };
  if (bestStill.scavenges === 0 && bestStill.made <= 0) break;
}
const meanPatches = st[1] / (st[0] || 1);
// Wave 3b: the rings' shape up close, its finer levels selected and its shape window kept round the eye. The field holds a
// window whose blocks the near ground's cache answers through the game's own source (`shapeSourceOf`) and the sampler's own
// `copyInnerHeights` (run on a stand-in of the sampler's own shape: its two maps, its block sizes), so as the camera walks
// over block edges (the still cameras' 40 m about one place) the window moves, hands its slots on and takes the new ones from
// the cache, and every 256 frames it jumps 3 km and back (a far move: the whole block at once, then the refill's whole
// uploads and block uploads through a stand-in renderer that records them), all within the frame: none of it may make
// anything either (wave 3b's review: a probe's string key and a whole upload's texture were made in the frame).
const shapeField = field as unknown as { shape: ShapeWindow | null; renderer: unknown; heights: unknown; shapeSrc: unknown; shapeWork: { blocks: number; wholes: number } };
// Wave h6a: `H6A_SIDE=2048` the window of 2,048 (the Terrain shape detail at its top, 1,550 m), `H6A_BAKE4=1` a bake of 4 m
// (the 4 m level to twice the 2 m one's range, level 0 to twice that): the widest selection the options make.
const SIDE6 = Number(process.env.H6A_SIDE) === 2048 ? 2048 : SHAPE_SIDE;
field.rules.side = SIDE6;
field.rules.bakeStep = process.env.H6A_BAKE4 === '1' ? 4 : 8;
if (SIDE6 === 2048) HORIZON_TUNE.shapeReach = 1550;
shapeField.shape = new ShapeWindow(SIDE6, 2);
const NP = 36;
const sampler = Object.create(TerrainSampler.prototype) as Record<string, unknown>;
Object.assign(sampler, { blocks: new Map(), byNumber: new Map(), numberOfPoles: NP, blockWidth: 64, poleStep: 2, lastBx: Number.NaN, lastBz: Number.NaN, lastBlock: undefined });
const blockHeights = new Float32Array(NP * NP).map((_, k) => (k % NP) * 0.25 + Math.floor(k / NP) * 0.125);
const far: THREE.PerspectiveCamera[] = [];
for (let p = 0; p < POSES; p++) {
  const s = still[p];
  if (p < POSES / 2) {
    far.push(s);
    continue;
  }
  const cam = testCamera();
  const x = s.position.x + 3000;
  const z = s.position.z;
  cam.position.set(x, rolling(x, z) + (s.position.y - rolling(s.position.x, z)), z);
  cam.rotation.copy(s.rotation);
  cam.updateMatrixWorld();
  far.push(cam);
}
// Every block either place's window can ask for, under both of the sampler's keys (the string one only the old lookup read).
for (const c of [far[0], far[POSES - 1]]) {
  const ebx = Math.floor(-c.position.x / 64);
  const ebz = Math.floor(c.position.z / 64);
  const R = (SIDE6 >> 6) + 4;
  for (let bz = ebz - R; bz <= ebz + R; bz++) {
    for (let bx = ebx - R; bx <= ebx + R; bx++) {
      const b = { heights: blockHeights };
      (sampler.blocks as Map<string, unknown>).set(`${bx},${bz}`, b);
      (sampler.byNumber as Map<number, unknown>).set((bx + 4096) * 8192 + (bz + 4096), b);
    }
  }
}
shapeField.shape.source = shapeSourceOf({ sampler: sampler as never, workerUp: false, generatePoles: () => Promise.resolve(null) });
let uploads = 0;
shapeField.renderer = {
  copyTextureToTexture() {
    uploads++;
  },
};
shapeField.heights = new THREE.DataTexture(new Float32Array(4) as never, 2, 2, THREE.RedFormat, THREE.FloatType);
shapeField.shapeSrc = new THREE.DataTexture(new Float32Array(SHAPE_BLOCK * SHAPE_BLOCK) as never, SHAPE_BLOCK, SHAPE_BLOCK, THREE.RedFormat, THREE.FloatType);
// The composition window's ask (a message posted when the eye is 128 m off its middle, which every 3 km jump is) is the
// second measure's business and makes its message by design: no worker here, so the jumps measure the shape window alone.
f.worker = null;
st[3] = 0;
function shapeFrame(): void {
  st[3] += 1;
  const cam = far[(st[3] | 0) & (POSES - 1)];
  copyDome(session.uniforms, dome);
  field.update(session, cam, cam.position, 6, 0, 0, hole, true);
  st[1] += session.selector.perFine[1];
  st6[0] += session.selector.perFine[0];
}
const st6 = new Float64Array(1);
function shapeFrames(n: number): void {
  for (let i = 0; i < n; i++) shapeFrame();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(shapeFrames);
} catch {
  // Without the flag the loop is left to the compiler.
}
st[1] = 0;
st6[0] = 0;
shapeFrames(4000);
const finePatches = st[1] / 4000;
const fourMean = st6[0] / 4000;
let bestShape = { made: Infinity, scavenges: Infinity };
for (let attempt = 0; attempt < 3; attempt++) {
  shapeFrames(1000);
  (globalThis as unknown as { gc: (o?: { type: string }) => void }).gc({ type: 'minor' });
  await settle();
  scavenges = 0;
  const before = young();
  shapeFrames(N);
  const made = young() - before;
  await settle();
  if (scavenges < bestShape.scavenges || (scavenges === bestShape.scavenges && made < bestShape.made)) bestShape = { made, scavenges };
  if (bestShape.scavenges === 0 && bestShape.made <= 0) break;
}
watch.disconnect();
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, patches: meanPatches, window: { made: bestStill.made, scavenges: bestStill.scavenges, asks }, shape: { made: bestShape.made, scavenges: bestShape.scavenges, finePatches, fourPatches: fourMean, overflow: session.selector.overflow, side: SIDE6, moves: shapeField.shape.counts.moves, cached: shapeField.shape.counts.cached, uploads, blocks: shapeField.shapeWork.blocks, wholes: shapeField.shapeWork.wholes } }));
