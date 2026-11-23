// The galaxy map's opened system makes nothing a frame (the GPU port's pass 2, wave 5, maker M): three systems opened on the
// map's own pool (`galaxySystemView.ts`' `SystemDraw`, with three, a stand-in page for its labels), the Naboo system seen from
// Rori under maker S's motion (its time the ground's own, `SKY_MOTION.now.T`, moved each frame by the motion's own call) and
// the Tatoo and Yavin systems on the shared clock's real days; each frame the disc's fade and the system's frame as the map's
// draw calls them (the clockwork moved, every globe, rim, orbit and label laid, the clouds turned, the two rings placed), a
// body picked now and then outside the window. Not a test itself: `galaxySystemAlloc.test.ts` runs it in twelve processes, two
// waves of six (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';

// The page the labels are made in: a stand-in element (the labels' own fields, nothing else).
const element = () => ({ innerHTML: '', lastElementChild: { textContent: '' }, hidden: true, className: '', style: { transform: '' } });
(globalThis as unknown as { document: unknown }).document = { createElement: element };
const layer = { appendChild() {} } as unknown as HTMLElement;

const THREE = await import('three');
const { SystemDraw } = await import('../../../src/ui/galaxySystemView.ts');
const { OpenedSystem } = await import('../../../src/ui/galaxySystem.ts');
const { GALAXY_SYSTEMS, systemPlace } = await import('../../../src/data/galaxy.ts');
const { draftSystem } = await import('../../../src/sky/system/drafts.js');
const { skyMotionFor, SKY_MOTION } = await import('../../../src/sky/system/skyMotion.ts');

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

const SYSTEMS = { yavin: draftSystem('yavin'), tatoo: draftSystem('tatoo'), naboo: draftSystem('naboo') } as Record<string, unknown>;
const SKY = { sun: { size: 0.6 }, supplementalSun: { size: 0.55 }, moon: { size: 0.5 }, supplementalMoon: { size: 0.25 }, celestials: [{ size: 1, image: { file: 'sky/cels_naboo.png' } }] };
const { DayCycle } = await import('../../../src/world/daycycle.ts');
const { sharedClock } = await import('../../../src/world/sharedClock.ts');
const motion = skyMotionFor(SYSTEMS, 'rori', 'rori', SKY)!;
SKY_MOTION.now = motion;
// The ground's day following the motion as the game's does (`DayCycle.follow`, moved by `fromMotion`: maker S's own suite's way).
const wallRec = { ms: Date.UTC(2026, 10, 23, 9, 0, 0) };
sharedClock.wall = () => wallRec.ms;
sharedClock.none();
const day = new DayCycle(0, 1);
day.swg = true;
day.follow(motion);
day.update(0, false);
const ground = day as unknown as { count: number; fromMotion(m: unknown): void };

const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
const blankRim = new THREE.DataTexture(new Uint8Array(4), 1, 1);
const rimColour = { value: new THREE.Color(1, 1, 1) };
const makeRim = (p: InstanceType<typeof THREE.Texture>, light: { dir: { value: InstanceType<typeof THREE.Vector3> } }) => new THREE.ShaderMaterial({ uniforms: { uProfile: { value: p }, uLightDir: light.dir } });
const rimTex = (p: Float32Array) => new THREE.DataTexture(new Uint8Array(p.length), p.length / 4, 1);
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, 40000);
const here = new THREE.Mesh(new THREE.RingGeometry(0.84, 1, 8), new THREE.MeshBasicMaterial());
const picked = new THREE.Mesh(new THREE.RingGeometry(0.84, 1, 8), new THREE.MeshBasicMaterial());
const disc = new THREE.PointsMaterial({ transparent: true, opacity: 0.55 });

const draws: InstanceType<typeof SystemDraw>[] = [];
for (const [gid, from] of [
  ['naboo', 'rori'],
  ['tatoo', 'tatooine'],
  ['yavin', 'yavin4'],
] as const) {
  const sys = GALAXY_SYSTEMS.find((s) => s.id === gid)!;
  // (Scratch knob GS_NOHERE: opened from nowhere, so no world is marked as the player's.)
  const opened = OpenedSystem.open(sys, SYSTEMS, process.env.GS_NOHERE === '1' ? null : from);
  const d = new SystemDraw(layer, blank, blankRim, rimColour, makeRim as never, rimTex, 0.55);
  // Every body wearing a picture with clouds and a rim (the most an opening lays; rings are laid from the viewer's own module, a
  // WebGPU one, which this stand-in leaves out).
  const pics = { place: 'x', look: 'x', width: 8, height: 4, surface: new Uint8Array(8 * 4 * 4), clouds: new Uint8Array(8 * 4 * 4) };
  const wear = opened.bodies.map((b: { star: boolean }) => (b.star ? null : { pics, swg: null, rim: new Float32Array(32 * 4), rings: null, look: 'x' }));
  const at = systemPlace(sys);
  d.open(opened, new THREE.Vector3(at.x, at.y, at.z), wear);
  draws.push(d);
}
camera.position.set(0, 600, 900);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
const clock = { ms: Date.UTC(2026, 10, 23, 9, 0, 0) };
const st = new Float64Array(2);

// The bisect's knobs (scratch use only; the suite sets none): GS_ONLY_AT runs the clockwork's step alone, GS_NOMOTION leaves
// the ground's motion still.
const ONLY_AT = process.env.GS_ONLY_AT === '1';
const NO_MOTION = process.env.GS_NOMOTION === '1';
/** One frame of the map with three systems open: the clock moved (a frame of real time), the ground's motion moved, each drawn. */
function frame(): void {
  clock.ms += 16.6667;
  if (!NO_MOTION) {
    ground.count += 0.0166667 / motion.lengthSeconds;
    ground.fromMotion(motion);
  }
  for (let i = 0; i < draws.length; i++) {
    const d = draws[i];
    if (ONLY_AT) {
      const o = d.opened!;
      o.clock.T = (clock.ms - 1767225600000) / 86400000;
      o.at();
      continue;
    }
    d.now.ms = clock.ms;
    d.fadeDisc(disc);
    d.frame(camera, here, picked, 1280, 720);
  }
  st[0] = draws[0].opened!.pos[3] + draws[1].opened!.pos[4] + draws[2].opened!.light[5] + disc.opacity;
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
frames(20_000);
// A scratch bisect's knob (the suite sets none): GS_HEAPPROF names a file the sampling heap profile of one more window is written to.
if (process.env.GS_HEAPPROF) {
  const { Session } = await import('node:inspector/promises');
  const { writeFileSync } = await import('node:fs');
  const s = new Session();
  s.connect();
  await s.post('HeapProfiler.startSampling', { samplingInterval: 32 });
  frames(N);
  const { profile } = (await s.post('HeapProfiler.stopSampling')) as { profile: unknown };
  writeFileSync(process.env.GS_HEAPPROF, JSON.stringify(profile));
  s.disconnect();
}
// A body picked in each (a click's, outside the window): the picked ring follows it from here on.
if (process.env.GS_NOPICK !== '1') for (const d of draws) d.pick(1);
frames(2000);
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
console.log(
  JSON.stringify({
    frames: N,
    made: best.made,
    scavenges: best.scavenges,
    systems: draws.length,
    bodies: draws.map((d) => d.opened!.bodies.length),
    followed: draws[0].opened!.T === motion.T,
    clocked: Math.abs(draws[1].opened!.T - (clock.ms - Date.UTC(2026, 0, 1)) / 86400000) < 1e-9,
    sum: Number.isFinite(st[0]),
  }),
);
process.exit(0);
