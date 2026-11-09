// The landmarks' frame makes nothing (the horizon pass's wave 5b): a world of 400 big rocks over a 16 km square, the size rule
// on and the index built over the real streamer, and each frame the world's own calls made -- the eye, the reach in force and
// the step written into the index's kept record and its `step` -- while the eye walks, turns about and climbs, the reach moves
// between the far tiles' 3.3 km and the rings' 12 km, `k` steps now and then, and a tier is shown or let go every 64 frames
// (the streamer's own counter moved), over a window of frames with no collection, the cleanest of three kept. Not a test
// itself: `landmarkAlloc.test.ts` runs it in twelve processes at once (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { makeStreamer, type SnapshotObject } from './streamHarness.ts';
import { LandmarkIndex } from '../../../src/world/landmarks.ts';
import { LANDMARK_TUNE } from '../../../src/world/landmarkMath.ts';

const rocks: SnapshotObject[] = [];
for (let i = 0; i < 400; i++) {
  const x = ((i * 7919) % 16000) - 8000;
  const z = ((i * 104729) % 16000) - 8000;
  rocks.push({ template: 'object/rock', model: 'rock', x: -x, y: 0, z, q: [1, 0, 0, 0], radius: 40 });
}
LANDMARK_TUNE.on = true;
const h = await makeStreamer(rocks);
await h.settle({ x: 0, z: 0 }, 20);
const lm = new LandmarkIndex(h.stream as never);
await lm.build();
const s = h.s as { tierEpoch: number };

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => {
  await tick();
  await tick();
};

// The eye's path, made before the window: a walk round a 6 km loop, climbing to 1.5 km and down.
const POSES = 1024;
const px = new Float64Array(POSES);
const py = new Float64Array(POSES);
const pz = new Float64Array(POSES);
const pr = new Float64Array(POSES);
for (let p = 0; p < POSES; p++) {
  const t = (p / POSES) * Math.PI * 2;
  px[p] = Math.cos(t) * 3000;
  pz[p] = Math.sin(t) * 3000;
  py[p] = 2 + (Math.sin(t * 3) * 0.5 + 0.5) * 1500;
  pr[p] = 3328 + (Math.sin(t * 5) * 0.5 + 0.5) * 8700;
}
const st = new Float64Array(4);
st[2] = 0.5;
/** One frame of the landmarks, as the world makes it (compiled as itself; the loop round it is kept out of the optimizer). */
function frame(): void {
  st[0] += 1;
  const f = st[0] | 0;
  const p = f & (POSES - 1);
  const a = lm.ask;
  a.eyeX = px[p];
  a.eyeY = py[p];
  a.eyeZ = pz[p];
  a.reach = pr[p];
  a.dt = 1 / 60;
  if ((f & 63) === 0) s.tierEpoch++;
  if ((f & 1023) === 0) LANDMARK_TUNE.k = LANDMARK_TUNE.k === 400 ? 420 : 400;
  lm.step();
}
function frames(n: number): void {
  for (let i = 0; i < n; i++) frame();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler.
}
const N = 60_000;
frames(4000);
let best = { made: Infinity, scavenges: Infinity };
for (let attempt = 0; attempt < 3; attempt++) {
  frames(1000);
  (globalThis as unknown as { gc: (o?: { type: string }) => void }).gc({ type: 'minor' });
  await settle();
  scavenges = 0;
  const before = young();
  const sweeps = lm.stats.sweeps;
  frames(N);
  const made = young() - before;
  await settle();
  if (lm.stats.sweeps - sweeps < 1000) throw new Error(`only ${lm.stats.sweeps - sweeps} sweeps in the window`);
  if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
  if (best.scavenges === 0 && best.made <= 0) break;
}
const r = lm.report();
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, members: r.members, sweeps: lm.stats.sweeps, repacks: lm.stats.repacks }));
process.exit(0);
