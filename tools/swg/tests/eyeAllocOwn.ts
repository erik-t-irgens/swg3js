// The eye's frame on the main thread makes nothing (the GPU port's pass 2, wave 2, maker A): `eyeFrameGpu` (the eye's mode,
// three's exposure, and the buffer written where the card does not adapt) over a stand-in renderer, its inputs written field
// by field as the game's frame writes them, the light on the level ground moving every frame (the sun's height followed, so the
// buffer is written often), the modes crossed (adapting, following the sun, today's, and the wave's fixer's chain drawing on
// without its eye pass), and the drawn frame's roll of the pre-exposure (`eyeBegin`, the fixer's); and (the sky and light fix
// round) the chain's own frame of the eye pass and the demo's bloom over the same stand-in (`GpuEyePass.render`,
// `GpuMixBloomPass.prepare` and `render`, the row's strength moving and the picture's size crossing), over a window with no
// collection, the least of three clean windows kept. Not a test itself: `eyeAlloc.test.ts` runs it in twelve processes at once
// (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { EYE_IN } from '../../../src/sky/exposure/eyeRun.ts';
import { GpuEyePass, eyeBegin, eyeFrameGpu, eyeReady } from '../../../src/sky/exposure/eyeGpu.ts';
import { GpuMixBloomPass } from '../../../src/core/gpu/gpuBloomMix.ts';
import { FX_DEFAULTS } from '../../../src/core/fxRegistry.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

// The renderer's exposure begun as a fraction, as the game's is once the eye has written it; its compute stands in for three's
// dispatch (the wave's fixer: the pre-exposure's roll, once a drawn frame).
const r: Any = { toneMappingExposure: 0.5, compute() {}, setRenderTarget() {}, render() {} };
// The eye's kit made and landed (the stand-in has no asynchronous compile), so the roll is dispatched as in the game.
new GpuEyePass(r).dispose();
if (!eyeReady()) throw new Error("the eye's computes did not land over the stand-in");
const st = new Float64Array(2);
const e = EYE_IN;
// The sky and light fix round: the chain's eye pass and the demo's bloom, drawn over the stand-in on the chain's two buffers
// in turn, the Bloom strength row's share kept as a fraction as the game's is.
const eyePass = new GpuEyePass(r);
const bloom = new GpuMixBloomPass(1600, 900, 0.04);
const pictures: Any[] = [new THREE.RenderTarget(1600, 900), new THREE.RenderTarget(1600, 900)];
const ctx: Any = { renderer: r, settings: { ...FX_DEFAULTS, bloomMix: 0.04 } };

/**
 * One frame: the inputs as the game writes them (a frame's seconds, the air, the chain, whether it draws its eye pass, the row,
 * the light on the level ground), then the eye's frame, then (the wave's fixer) the drawn frame's roll of the pre-exposure.
 */
function frame(): void {
  st[0] += 1;
  const n = st[0];
  const a = n * 0.0007;
  e.dt = 0.0069 + (n % 7) * 0.0003;
  e.air = (n & 1023) !== 0;
  e.chain = (n & 511) !== 3;
  e.eye = e.chain && (n & 255) !== 7;
  e.adapt = (n & 2047) < 1024 ? 1 : 0;
  e.stops = (n & 4095) < 2048 ? 0 : 0.5;
  e.loading = (n & 8191) === 5;
  // The light on the level ground, from noon's to a moonlit night's and back over the window.
  e.level = 1.758 * Math.exp(-6 * (1 + Math.sin(a)));
  eyeFrameGpu(r);
  if (e.chain) {
    eyeBegin(r);
    // The chain's frame: the eye pass (drawing only while the card adapts) and the bloom, the row moved now and then.
    // The chain's two buffers taken in turn (the picture's own size: a resize is no steady frame).
    const pic = pictures[n & 1];
    eyePass.render(ctx, pic, null);
    ctx.settings.bloomMix = (n & 1023) < 512 ? 0.04 : 0.065;
    if (bloom.enabled(ctx)) {
      bloom.prepare(ctx);
      bloom.render(ctx, pic, null);
    }
  }
}
function frames(k: number): void {
  for (let i = 0; i < k; i++) frame();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler.
}
// Windows of 60,000: getHeapSpaceStatistics itself makes about 2.3 KB a read, 0.04 B a frame over this window (testing.md).
const N = 60_000;
frames(20_000);
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
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, exposure: Number(r.toneMappingExposure.toFixed(4)) }));
process.exit(0);
