// What draws from the air makes nothing a frame (the GPU port's pass 2, wave 1, maker B): Tatooine's pair worked from a caster
// that moves every frame (the night floor that stood beside it went with wave 2's eye, whose frame eyeAlloc.test.ts holds), and
// the haze pass's prepare and render over a stand-in renderer and context (its camera turning), each frame as the game makes
// them, over a window with no collection, the least of three clean windows kept. Not a test itself: `skyDrawAlloc.test.ts`
// runs it in twelve processes at once (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { PAIR_TUNE, pairDirectionOf } from '../../../src/sky/stars.ts';
import { GpuHazePass } from '../../../src/sky/air/airHaze.ts';
import { markSeeTarget } from '../../../src/sky/air/airSee.ts';
import { markMotionTarget } from '../../../src/core/gpu/motion.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

// The scene target with its layer, the pass over a stand-in renderer that draws nothing.
const depth = new THREE.DepthTexture(64, 36, THREE.FloatType);
const target = new THREE.RenderTarget(64, 36, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 0, depthTexture: depth, count: 3 });
target.texture.name = 'fx.scene';
markMotionTarget(target);
markSeeTarget(target);
const r: Any = { reversedDepthBuffer: true, setRenderTarget() {}, render() {} };
const pass = new GpuHazePass(r, target);
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
// Its world matrix's elements begun as fractions, as a turning camera's always are.
camera.matrixWorld.elements[0] = 0.5;
camera.matrixWorld.elements[2] = 0.5;
camera.matrixWorld.elements[8] = 0.5;
camera.matrixWorld.elements[10] = 0.5;
const ctx: Any = { renderer: r, near: 0.05, far: 9000.5, inside: false, space: false, tanHalfFov: new THREE.Vector2(1.1, 0.6), camera };
const input: Any = { width: 64, height: 36, texture: new THREE.Texture() };
const output: Any = { width: 64, height: 36, texture: new THREE.Texture() };

const pair = new THREE.Vector3(0.5, 0.5, 0.5);
const caster = new THREE.Vector3(0.5, 0.5, 0.5);
const st = new Float64Array(4);

/** One frame: the caster round its arc, the pair, the pass. */
function frame(): void {
  st[0] += 1;
  const a = st[0] * 0.003;
  const cy = Math.sin(a) * 0.9;
  const ch = Math.sqrt(1 - cy * cy);
  // The harness's own writes field by field (a vector's `set` hands its numbers across a call the compiler may leave out).
  caster.x = Math.cos(a * 0.7) * ch;
  caster.y = cy;
  caster.z = Math.sin(a * 0.7) * ch;
  pairDirectionOf(caster, pair);
  // The camera turned about +Y as the game's world matrix would hold it (the game's frame works it out before the chain).
  const e = camera.matrixWorld.elements;
  const c = Math.cos(a);
  const s = Math.sin(a);
  e[0] = c;
  e[2] = -s;
  e[8] = s;
  e[10] = c;
  ctx.inside = (st[0] & 255) === 0;
  pass.prepare(ctx);
  pass.render(ctx, input, output);
}
function frames(n: number): void {
  for (let i = 0; i < n; i++) frame();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler.
}
// Windows of 60,000: getHeapSpaceStatistics itself makes about 2.3 KB a read, 0.04 B a frame over this window (	esting.md).
const N = 60_000;
/** The least of three clean windows of `N` frames, after a warm of `warm`. */
async function measure(warm: number): Promise<{ made: number; scavenges: number }> {
  frames(warm);
  let best = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    frames(2000);
    for (let i = 0; i < 10; i++) await tick();
    (globalThis as unknown as { gc: (o?: { type: string }) => void }).gc({ type: 'minor' });
    // The collector's word reaches the observer a turn or two later: waited out before the count starts.
    await tick();
    await tick();
    await tick();
    scavenges = 0;
    const before = young();
    frames(N);
    const made = young() - before;
    await tick();
    if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
    if (best.scavenges === 0 && best.made <= 0) break;
  }
  return best;
}
const best = await measure(20_000);
// Pass 2, wave 6 (maker K): the pair turned beside the caster (`PAIR_TUNE.angleDeg` 90, its tangent frame's branch), set
// between the windows as the console or a slider would, then warmed and measured again in the same process.
PAIR_TUNE.angleDeg = 90;
const beside = await measure(20_000);
PAIR_TUNE.angleDeg = 0;
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, besideMade: beside.made, besideScavenges: beside.scavenges, pair: [pair.x, pair.y, pair.z].map((v) => +v.toFixed(3)) }));
process.exit(0);
