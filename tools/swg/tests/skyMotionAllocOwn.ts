// Skies in motion make nothing a frame (the GPU port's pass 2, wave 5, maker S): three real `DayCycle`s following applied
// star systems (`skyMotion.ts` over the viewer's own drafts: Yavin 4 locked to its giant through its eclipse and its
// giantshine, Tatooine's pair, Rori seeing Naboo), each frame the day's count walked and the day taken from the motion, now and
// then a jump of the count, and with them the reads of the motion the bodies make (`dir`, `lit`, `cover`, the night light), over a window with no collection, the least of three clean windows kept. Not a test itself:
// `skyMotionAlloc.test.ts` runs it in twelve processes at once (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { draftSystem } from '../../../src/sky/system/drafts.js';
import { skyMotionFor } from '../../../src/sky/system/skyMotion.ts';
import { sharedClock } from '../../../src/world/sharedClock.ts';
import { DayCycle } from '../../../src/world/daycycle.ts';

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

const SKY = {
  sun: { size: 0.6 },
  supplementalSun: { size: 0.55 },
  moon: { size: 0.5 },
  supplementalMoon: { size: 0.25 },
  celestials: [{ size: 0.45, image: { file: 'sky/cels_ice_moon.png' } }, { size: 1, image: { file: 'sky/cels_naboo.png' } }],
};
// (skies of his own worlds) and the Utapau draft, standing on his Utapau world, a world of his over the sky it borrows (Lok's)
const systems = { yavin: draftSystem('yavin'), tatoo: draftSystem('tatoo'), naboo: draftSystem('naboo'), utapau: draftSystem('utapau') };
const wallRec = { ms: Date.UTC(2026, 10, 23, 9, 0, 0) };
sharedClock.wall = () => wallRec.ms;
sharedClock.none();
const days: DayCycle[] = [];
for (const [world, planet] of [
  ['yavin4', 'yavin4'],
  ['tatooine', 'tatooine'],
  ['rori', 'rori'],
  ['ours_race_map_2', 'ours_race_map_2'],
] as const) {
  const m = skyMotionFor(systems, world, planet, SKY, world.startsWith('ours_') ? 'lok' : null);
  if (!m) throw new Error(`no motion for ${world}`);
  const d = new DayCycle(0, 1);
  d.swg = true;
  d.follow(m);
  d.update(0, false);
  days.push(d);
}
const st = new Float64Array(4);

/**
 * One frame of what this wave added to the day, for each world: the day's unbroken count walked on (as `DayCycle.update`
 * leaves it: its own read of the wall clock, the base's, is not this wave's and is measured by the day's own suites), the day
 * taken from the motion (`DayCycle.fromMotion`: the system moved to the count, the sun, the night body, the light, the
 * daylight), now and then a jump of the count (a hand's write), and the bodies' numbers read as the drawing reads them.
 */
function frame(): void {
  st[0] += 1;
  const n = st[0];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    // Ten real minutes a frame: a window of 60,000 frames runs over a hundred of each world's own days.
    d.count += 600 / d.motion!.lengthSeconds;
    if ((n & 1023) === 7) d.count += 0.37;
    (d as unknown as { fromMotion(m: unknown): void }).fromMotion(d.motion);
    const m = d.motion!;
    let s = 0;
    for (let j = 0; j < m.m; j++) s += m.dir[3 * j + 1] * m.lit[j] + m.cover[j] + m.spinTurn[j];
    st[1] = s + m.moonShare + m.moonTint[0] + m.sun.x + m.sun2.y + m.nightDir.z + m.daylight + m.sunShare + m.sun2Share + d.daylight + d.sunset + d.sunDir.y + d.moonDir.x + d.lightDir.z;
  }
}function frames(n: number): void {
  for (let i = 0; i < n; i++) frame();
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
const yv = days[0].motion!;
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, worlds: days.length, items: days.map((d) => d.motion!.m), eclipse: yv.sunShare >= 0 && yv.sunShare <= 1, sum: Number.isFinite(st[1]) }));
process.exit(0);
