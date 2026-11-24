// What the clouds' model makes a frame (pass 3, wave 1, maker M): the run's own frame (`CloudRun.frame`: the level in closed
// form, the drift summed on at each step's turn, six layers packed with mixes, the bands, the rings' plan, the regions, the
// map's tune) and the map's upload of those numbers into its uniforms (`CloudMapGpu.write`), each frame as the game makes
// them, the shared clock walking a second a frame so the schedule's steps turn and the drift's steps are summed inside the
// window, the camera moving, the level followed, held and let go. Over a window with no collection, the least of three clean
// windows kept. Not a test itself: `cloudAlloc.test.ts` runs it in twelve processes (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { CLOUD_IN, CLOUD_RUN } from '../../../src/sky/clouds/cloudRun.ts';
import { CloudMapGpu } from '../../../src/sky/clouds/cloudMapGpu.ts';
import { climateFor } from '../../../src/world/weatherSchedule.ts';
import { cleanLayer } from '../../../src/sky/clouds/cloudLayers.ts';

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

const I = CLOUD_IN;
I.tau = 1_796_000_000.5;
I.dayTime = 0.3;
I.camX = 120.5;
I.camZ = -340.5;
const run = CLOUD_RUN;
run.attach({ planetId: 'naboo', packId: 'naboo', weights: climateFor('naboo', 5), groundY: 12.5, renderer: null });
run.setRegions([
  { x: 900, z: -400, r: 1500, kind: 'rain' },
  { x: -3000, z: 2000, r: 2500, kind: 'dust' },
]);
// The fixer's: a deck whose shares move with the level (its cuts and its band top worked each frame) and a layer clear at the
// lower levels (its count nought there, packed by arithmetic), as the starting decks have them.
const six = [
  { name: 'mix3', types: ['stratocumulus', 'cumulus', 'cumulonimbus'], shares: [[1, 1, 0.6, 0.3, 0.1], [1, 0.8, 0.6, 0.4, 0.2], [0, 0.1, 0.4, 0.6, 0.8]], cover: [0.6, 0.6, 0.6, 0.6, 0.6], base: 900, thickness: 9000 },
  { name: 'sheet', types: ['nimbostratus'], cover: [0, 0, 0.3, 0.7, 0.9], base: 500 },
  { name: 'mix2', types: ['cirrus', 'cirrocumulus'], shares: [2, 1], cover: [0.5, 0.5, 0.5, 0.5, 0.5], base: 8000, drift: 2.3, turn: 25 },
  { name: 'towers', types: ['cumulonimbus'], cover: [0.4, 0.4, 0.4, 0.4, 0.4], diurnal: 0.2 },
  { name: 'high heaps', types: ['cumulus'], base: 8000, cover: [0.5, 0.5, 0.5, 0.5, 0.5] },
  { name: 'veil', types: ['cirrostratus'], cover: [0.6, 0.6, 0.6, 0.6, 0.6] },
];
// Made whole as the console makes them (`cleanLayer`), then handed to the run.
run.setLayers(six.map((l) => cleanLayer(l, null)));
// The map's card side made as the game makes it (its pictures and graphs are three's objects; nothing is drawn here).
const map = new CloudMapGpu();
const st = new Float64Array(2);

/** One frame: the clock a second on, the camera along, the day on, the weather's own level now and then, the run, the upload. */
function frame(): void {
  st[0] += 1;
  I.tau += 1;
  I.dayTime = (I.dayTime + 0.00013) % 1;
  I.camX += 1.7;
  I.camZ -= 0.9;
  I.wLevel = 1.5 + Math.sin(st[0] * 0.001);
  I.wFollow = (st[0] & 1023) < 900 ? 1 : 0;
  run.frame();
  map.write(run);
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
const best = await measure(20_000);
// A level held on this machine and let go between the windows, as the console does; measured again.
run.holdLevel(3);
const held = await measure(5_000);
run.holdLevel(null);
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, heldMade: held.made, heldScavenges: held.scavenges, steps: run.drift.steps, level: Number(run.level.toFixed(3)), count: run.count }));
process.exit(0);
