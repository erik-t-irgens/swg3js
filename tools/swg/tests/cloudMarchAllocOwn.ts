// The clouds' march makes nothing a frame (the GPU port's pass 3, wave 1, maker V): the pass's frame as the chain runs it
// (`enabled`, `prepare`, `render` over a stand-in renderer that draws nothing), its camera turning and moving a thousand km
// from the world's middle, the stack's feed moving its drift, and the world's storm fade and the sheets' word beside it
// (`stormFadeOf`, `cloudsMarching`); and with the switch off, the pass's `enabled` alone (the base frame's whole cost of it).
// Each the least of three clean windows of 60,000 frames. Not a test itself: `cloudMarchAlloc.test.ts` runs it in twelve
// processes (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { AIR } from '../../../src/sky/air/airApi.ts';
import { markSeeTarget } from '../../../src/sky/air/airSee.ts';
import { markMotionTarget } from '../../../src/core/gpu/motion.ts';
import { CLOUD_FACE, GpuCloudPass } from '../../../src/sky/clouds/cloudMarch.ts';
import { CLOUD_FEED, CLOUD_FLIGHT, cloudsMarching, setCloudsOn, stormFadeOf } from '../../../src/sky/clouds/cloudTune.ts';
import { GpuTaaPass } from '../../../src/core/gpu/taa/taaPass.ts';
import { CLOUD_REUSE_STATS } from '../../../src/sky/clouds/cloudResolve.ts';
import { CLOUD_LAYER_MAX, CLOUD_STACK_FLOATS, newCloudLayer, newStackFrame, packStack } from '../../../src/sky/clouds/cloudLayers.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

// The scene target with its layer; the air's tables and the map's face as the graphs' makers read them at their build.
const depth = new THREE.DepthTexture(64, 36, THREE.FloatType);
const target = new THREE.RenderTarget(64, 36, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 0, depthTexture: depth, count: 3 });
target.texture.name = 'fx.scene';
markMotionTarget(target);
markSeeTarget(target);
AIR.tables = { nodes: {}, ready: true } as Any;
AIR.frame.on = true;
CLOUD_FACE.face = { sample() {}, weights() {}, slot() {}, typeSlot() {}, frame: null, band() {} } as Any;
CLOUD_FACE.ready = () => true;
const r: Any = { reversedDepthBuffer: true, getRenderTarget: () => null, setRenderTarget() {}, render() {}, compileAsync: () => Promise.resolve(), compileComputeAsync: () => Promise.resolve(), compute() {} };
const pass = new GpuCloudPass(r, target);
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
camera.matrixWorld.elements[0] = 0.5;
camera.matrixWorld.elements[2] = 0.5;
camera.matrixWorld.elements[8] = 0.5;
camera.matrixWorld.elements[10] = 0.5;
camera.position.set(1_234_567.5, 40.5, -2_345_678.5);
// Pass 3, wave 2 (maker T): the frame's seconds and its cut, and an edge smoothing drawing (so the clouds lay their motion and
// the smoothing reads it), as the chain hands them.
const ctx: Any = { renderer: r, near: 0.05, far: 9000.5, space: false, cameraUnderwater: false, cameraSubmerged: false, frame: 0, tanHalfFov: new THREE.Vector2(1.1, 0.6), camera, dt: 0.0166, cameraCut: false };
const taa = new GpuTaaPass(r, target, { smoothing: 1 } as Any);
const input: Any = { width: 64, height: 36, texture: new THREE.Texture() };
const output: Any = { width: 64, height: 36, texture: new THREE.Texture() };

// The feed as the map's maker writes it: a packed stack of three layers, their full drift moving every frame.
const layers = [newCloudLayer('cumulus'), newCloudLayer('cirrus'), newCloudLayer('stratocumulus')];
layers[2].types = ['stratocumulus', 'cumulus'];
layers[2].shares = [0.5, 0.5];
const stack = new Float32Array(CLOUD_STACK_FLOATS);
const f = newStackFrame();
const n = packStack(layers, f, stack);
const drift = new Float64Array(CLOUD_LAYER_MAX * 4);
CLOUD_FEED.stack = stack;
CLOUD_FEED.count = n;
CLOUD_FEED.drift = drift;
CLOUD_FEED.layers = layers;
CLOUD_FEED.version = 1;
/** Pass 3, wave 2 (maker T): the middle of the first layer's band, where a ship is in flight mode. */
const inBand = (stack[0] + stack[1]) / 2 + 0.5;
const fade ={ overcast: 0.5, dust: 0.25, kept: 0.5, sheets: 0.5 };
const st = new Float64Array(4);

/** One frame: the camera turned and moved, the drift moved, the fade and the sheets' word, the pass as the chain runs it. */
function frame(): void {
  st[0] += 1;
  const a = st[0] * 0.003;
  const e = camera.matrixWorld.elements;
  const c = Math.cos(a);
  const s = Math.sin(a);
  e[0] = c;
  e[2] = -s;
  e[8] = s;
  e[10] = c;
  camera.position.x += 0.75;
  camera.position.z -= 0.25;
  drift[0] += 3.5;
  drift[1] -= 1.25;
  drift[4] += 7.5;
  ctx.frame = st[0];
  fade.kept = stormFadeOf(fade.overcast, fade.dust, 0, cloudsMarching());
  fade.sheets = cloudsMarching() ? 0 : 1;
  // Pass 3, wave 2 (maker T): a ship flown into the low layer's band and out again every 300 frames (flight mode in and out,
  // its hold run out), and a cut every 500 (the history's reset).
  const k = st[0] % 600;
  CLOUD_FLIGHT.ship = k < 300;
  camera.position.y = k < 300 ? inBand : 40.5;
  ctx.cameraCut = st[0] % 500 === 0;
  if (pass.enabled(ctx)) {
    pass.prepare(ctx);
    pass.render(ctx, input, output);
  }
  taa.prepare(ctx);
}
function frames(k: number): void {
  for (let i = 0; i < k; i++) frame();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler.
}
const N = 60_000;
/** The least of three clean windows of `N` frames, after a warm of `warm`. */
async function measure(warm: number): Promise<{ made: number; scavenges: number }> {
  frames(warm);
  let best = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    frames(2000);
    for (let i = 0; i < 10; i++) await tick();
    (globalThis as unknown as { gc: (o?: { type: string }) => void }).gc({ type: 'minor' });
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
// Off first: the base frame's share of the pass (its `enabled` answering no).
setCloudsOn(false);
const off = await measure(20_000);
// On: the build asked, its stand-in compiles answered, the noise baked a slab a frame, then the drawing frame.
setCloudsOn(true);
for (let i = 0; i < 40; i++) {
  frame();
  await tick();
}
const drew = pass.drewLast;
const on = await measure(20_000);
console.log(JSON.stringify({ frames: N, offMade: off.made, offScavenges: off.scavenges, onMade: on.made, onScavenges: on.scavenges, drew, kept: fade.kept, reuse: { ...CLOUD_REUSE_STATS } }));
process.exit(0);
