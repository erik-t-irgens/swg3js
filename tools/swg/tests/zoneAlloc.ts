// The zones' asks make nothing (Map-maker II's eighth wave): a list of every kind of zone -- circles, rectangles, rings and
// outlines, a hundred and twenty in all -- asked through its kept ask (`zoneAtAsk` with a circle, `smallestAtAsk` with a
// point) at a point wandering over them, a million asks in a window with no collection, the cleanest of three windows kept.
// Not a test itself: `zoneShape.test.ts` runs it in a dozen processes of its own (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { ZoneAsk, ZoneList, smallestAtAsk, zoneAtAsk } from '../../../src/world/zoneShape.ts';

const L = new ZoneList();
for (let i = 0; i < 30; i++) {
  L.addCircle(i * 40 - 600, (i % 5) * 30, 12 + (i % 3) * 4, i);
  L.addRect(i * 40 - 610, 200 + (i % 4) * 10, i * 40 - 590, 230 + (i % 4) * 10, 100 + i);
  L.addRing(i * 40 - 600, -200, 6, 18, 200 + i);
  const pts = new Float64Array(12);
  const cx = i * 40 - 600;
  const cz = -400;
  pts.set([cx - 15, cz - 15, cx + 15, cz - 15, cx + 15, cz - 5, cx - 5, cz - 5, cx - 5, cz + 15, cx - 15, cz + 15]);
  L.addPoly(pts, 300 + i);
}

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

const q = new ZoneAsk();
const st = new Float64Array(4);
/** One ask, as a ghost's frame makes it (compiled as itself, as a frame is; the loop round it is kept out of the optimizer). */
function ask(): void {
  st[0] += 0.37;
  q.x = Math.sin(st[0] * 0.013) * 620;
  q.z = Math.cos(st[0] * 0.007) * 450;
  q.r = 6;
  if (zoneAtAsk(L, q) >= 0) st[1]++;
  if (smallestAtAsk(L, q) >= 0) st[2]++;
}
function asks(n: number): void {
  for (let i = 0; i < n; i++) ask();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(asks);
} catch {
  // Without the flag the loop is left to the compiler.
}

const N = 1_000_000;
asks(200_000);
let best = { made: Infinity, scavenges: Infinity };
for (let attempt = 0; attempt < 3; attempt++) {
  asks(50_000);
  (globalThis as unknown as { gc: (o?: { type: string }) => void }).gc({ type: 'minor' });
  await settle();
  scavenges = 0;
  const before = young();
  asks(N);
  const made = young() - before;
  await settle();
  if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
  if (best.scavenges === 0 && best.made <= 0) break;
}
watch.disconnect();
console.log(JSON.stringify({ asks: N, made: best.made, scavenges: best.scavenges, touched: st[1], held: st[2], zones: L.count }));
