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
watch.disconnect();
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, patches: st[1] / (st[0] || 1) }));
