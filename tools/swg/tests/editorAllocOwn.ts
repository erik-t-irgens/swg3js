// The world editor's own frame, measured for what it makes (DESIGN.md §2.0 rule 7): the pointer's events, the aim's step
// (the engine's cast, the ground's march, the water, the turned-box walk over the streamer's regions) and the hover, in
// a node process of its own with the engine's cast and the terrain stood in, as `raceAllocOwn.ts` measures the drive.
// The young generation is read with no collection in the window, the cleanest of three windows kept.
//
// Run: node --expose-gc --allow-natives-syntax tools/swg/tests/editorAllocOwn.ts
// Prints one JSON line: { frames, made, scavenges, tested, hovered }.
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { EditorAim, type AimRay, type AimRect, type AimSample, type StillHit } from '../../../src/editor/aim.ts';
import { endPointerFrame, notePointerDown, notePointerMove, notePointerUp, notePointerWheel, pointerRecord } from '../../../src/editor/pointer.ts';
import { EDITOR_TUNE } from '../../../src/editor/editorTune.ts';

const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc;
if (!gc) {
  console.log(JSON.stringify({ skipped: 'run with node --expose-gc' }));
  process.exit(0);
}

interface Thing {
  x: number;
  y: number;
  z: number;
  q: { x: number; y: number; z: number; w: number };
  template: string;
}

// Four hundred things in the regions the ray crosses, one in four a permanent row the hover may rest on.
const things: Thing[] = [];
for (let i = 0; i < 400; i++) {
  const a = i * 0.7;
  const h = Math.sin(a / 2);
  things.push({ x: Math.cos(a) * (5 + i * 0.2), y: 0, z: Math.sin(a) * (5 + i * 0.2), q: { x: 0, y: h, z: 0, w: Math.cos(a / 2) }, template: i % 4 === 0 ? `place/test-${i}` : `object/tangible/test/shared_thing_${i}.iff` });
}
const BOX = { min: [-1, 0, -1], max: [1, 2, 1] };
let castDist = 30;
const aim = new EditorAim<Thing>(
  {
    // The engine's cast stood in: it writes its answer into the kept record, as `Physics.aimHit` does.
    cast(r: AimRay, _inside: boolean, out: StillHit): boolean {
      if (castDist > r.len) return false;
      out.toi = castDist;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      out.handle = 7;
      return true;
    },
    // The terrain stood in: a rolling ground and no water.
    sample(p: AimSample): void {
      p.ground = Math.sin(p.x * 0.05) * 2 + Math.cos(p.z * 0.07) * 2;
      p.water = -Infinity;
    },
    walk(_rect: AimRect, visit: (o: Thing) => boolean): void {
      for (let i = 0; i < things.length; i++) if (!visit(things[i])) return;
    },
  },
  () => BOX,
  (o) => o.template.startsWith('place/'),
);
const pointer = pointerRecord();
const ask = { inside: false, space: process.argv.includes('nomarch'), skyReach: 40, now: 0.5 };
let k = 0;
let hovered = 0;
let tested = 0;

/** One frame of the editor's own: the pointer's events, the aim and the hover, the frame's presses spent. */
function frame(): void {
  k++;
  const t = k * 0.0001;
  // The pointer's every event every frame (a move, then a press or a release, a notch of the wheel either way), as a
  // driven Point mode makes them: the rules are what is measured, not how seldom they run.
  notePointerMove(pointer, 400 + Math.sin(t) * 100, 300 + Math.cos(t) * 80, EDITOR_TUNE.pick.dragPx);
  if ((k & 1) === 0) notePointerDown(pointer, 0, pointer.x, pointer.y);
  else notePointerUp(pointer, 0, pointer.x, pointer.y, EDITOR_TUNE.pick.dragPx);
  notePointerWheel(pointer, (k & 2) === 0 ? 1 : -1);
  ask.now = k / 60;
  castDist = k % 3 === 0 ? 1e9 : 20 + (k % 17);
  const dx = Math.cos(t);
  const dz = Math.sin(t);
  const dy = -0.3;
  const n = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const r = aim.ray;
  r.ox = 0;
  r.oy = 8;
  r.oz = 0;
  r.dx = dx / n;
  r.dy = dy / n;
  r.dz = dz / n;
  aim.step(ask, EDITOR_TUNE.aim, EDITOR_TUNE.hover);
  if (aim.hover) hovered++;
  tested += aim.boxes.tested;
  endPointerFrame(pointer);
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
function frames(n: number): void {
  for (let i = 0; i < n; i++) frame();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler.
}

const FRAMES = 50_000;
if (process.argv[2] === 'profile') {
  // Where it is made, by the sampling heap profiler: `node --expose-gc tools/swg/tests/editorAllocOwn.ts profile`.
  const { Session } = await import('node:inspector/promises');
  const session = new Session();
  session.connect();
  frames(50_000);
  await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  frames(50_000);
  interface SampleNode {
    callFrame: { functionName: string; url: string; lineNumber: number };
    selfSize: number;
    children: SampleNode[];
  }
  const { profile } = (await session.post('HeapProfiler.stopSampling')) as unknown as { profile: { head: SampleNode } };
  const sites = new Map<string, number>();
  const walk = (n: SampleNode, path: string) => {
    const here = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    if (n.selfSize > 0) sites.set(`${here}  <-  ${path}`, (sites.get(`${here}  <-  ${path}`) ?? 0) + n.selfSize);
    for (const c of n.children) walk(c, here);
  };
  walk(profile.head, '');
  for (const [key, n] of [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${(n / 50_000).toFixed(2)} B/frame  ${key}`);
  process.exit(0);
}
frames(20_000);
let best = { made: Infinity, scavenges: Infinity };
for (let attempt = 0; attempt < 3; attempt++) {
  gc();
  await settle();
  frames(10_000);
  gc({ type: 'minor' });
  await settle();
  scavenges = 0;
  const before = young();
  frames(FRAMES);
  const made = young() - before;
  await settle();
  if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
  if (best.scavenges === 0 && best.made <= 0) break;
}
watch.disconnect();
console.log(JSON.stringify({ frames: FRAMES, made: best.made, scavenges: best.scavenges, tested: Math.round(tested / k), hovered }));
