// The night sky makes nothing a frame (the GPU port's pass 2, wave 3, maker A): a real `NightSky` (its band, its stars and its
// towns over stand-in air tables and a renderer that draws nothing), its frame with the sun wheeling round the day's circle and
// the camera walking past a town, and the flare's sources from the air (`airFlareLights`) beside it, each frame as the world
// makes them (the nightSuns switch moved, and every other frame the open gate a frame in space writes, the wave's fixer's),
// over a window with no collection, the least of three clean windows kept. Not a test itself:
// `nightAlloc.test.ts` runs it in twelve processes at once (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { AIR, AIR_UNITS } from '../../../src/sky/air/airApi.ts';
import { sceneUnits } from '../../../src/sky/air/airTwin.ts';
import type { FxSkyLight } from '../../../src/core/fx/lensFlare.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

AIR_UNITS.scene = sceneUnits();
// Stand-in tables: the graphs are built only when three compiles them, which nothing here does.
AIR.tables = { transmittanceToSpace: () => (TSL as Any).vec3(1), skyRadiance: () => (TSL as Any).vec3(0) } as Any;
const { NightSky, NIGHT_IN } = await import('../../../src/sky/night/nightGpu.ts');
const { airFlareDiscs, airFlareLights, AIR_FLARE_IN, openFlareSeen } = await import('../../../src/sky/night/flareSources.ts');

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

const renderer: Any = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, compileAsync: () => Promise.resolve() };
// (the sky round's maker P, J) the night made under a system that draws a belt (the Karthakk draft with the Spine of Lok ticked),
// so its band is made with it and its frame runs in every other stretch of the applied frames below
const { draftSystem: draftOf } = await import('../../../src/sky/system/drafts.js');
const { skyMotionFor: motionFor, SKY_MOTION: MOTION_NOW } = await import('../../../src/sky/system/skyMotion.ts');
const karthakk: Any = JSON.parse(JSON.stringify(draftOf('karthakk')));
karthakk.bodies.find((b: Any) => b.id === 'spine').drawn = true;
const beltMotion = motionFor({ karthakk }, 'lok', 'lok', { sun: { size: 0.6 }, moon: { size: 0.5 }, celestials: [] })!;
beltMotion.at({ count: 1000.25 });
MOTION_NOW.now = beltMotion;
const night = new NightSky(renderer, { planet: 'tatooine', key: 'tatoo', placeOf: () => ({ x: 450, y: -23, z: 250 }) });
MOTION_NOW.now = null;
if (!night.belts) throw new Error('the night made no band for the drawn belt');
night.setCities(
  [
    { name: 'Mos Eisley', x: 3460, z: -4768, r: 456, kind: 'city' },
    { name: 'Bestine', x: -1218, z: -3688, r: 336, kind: 'city' },
    { name: 'Anchorhead', x: 102, z: -5360, r: 125, kind: 'city' },
  ],
  { x: -1376, z: -3576 },
);
await night.warm();
night.drawBake();
const f = AIR.frame;
f.level = 1e-6;
const out: FxSkyLight[] = [0, 1].map(() => ({ dir: new THREE.Vector3(0, 1, 0), color: new THREE.Color(1, 1, 1), alpha: 0, discRadius: 0, glowRadius: 0, weight: 0, star: false, skyDistance: Infinity }));
const discs = airFlareDiscs('tatooine', { size: 0.6, glowSize: 1.2 }, { size: 0.4, glowSize: 0 });
const st = new Float64Array(4);
// The fixer of pass 2, wave 6: the stars' turn about an applied system's own axis (the Tatoo draft's) in every other stretch of
// 512 frames, SWG's turn in the rest. The day's `at`, which writes the world's celestial frame, is the day's frame and is
// measured where the day runs it (`skyMotionAlloc`, through `DayCycle`); called from this harness's frame it makes some 200 B
// a call with or without the celestial frame's lines (the module graph's inlining, `testing.md`), so here it runs once and
// the frame turns the celestial frame it wrote about its pole, field by field, as each frame's `at` would.
const { draftSystem } = await import('../../../src/sky/system/drafts.js');
const { skyMotionFor, SKY_MOTION } = await import('../../../src/sky/system/skyMotion.ts');
const motion = skyMotionFor({ tatoo: draftSystem('tatoo') }, 'tatooine', 'tatooine', { sun: { size: 0.6 }, supplementalSun: { size: 0.55 }, moon: { size: 0.5 }, celestials: [] })!;
if (!motion) throw new Error('the Tatoo draft made no motion');
motion.at({ count: 1000.25 });
const cel0 = Float64Array.from(motion.celestial);
let appliedFrames = 0;

/** One frame: the sun round the day's circle, the moon opposite, the camera walking, the night and the flare's sources. */
function frame(): void {
  st[0] += 1;
  const a = st[0] * 0.002;
  // The day's circle (the client's 67.5-degree path), written field by field.
  const c = Math.cos(a);
  const s = Math.sin(a);
  f.sunDir.x = s;
  f.sunDir.y = c * 0.9238795325112867;
  f.sunDir.z = -c * 0.3826834323650898;
  f.moonDir.x = -f.sunDir.x;
  f.moonDir.y = -f.sunDir.y;
  f.moonDir.z = -f.sunDir.z;
  const night_ = f.sunDir.y < 0;
  f.lightDir.x = night_ ? f.moonDir.x : f.sunDir.x;
  f.lightDir.y = night_ ? f.moonDir.y : f.sunDir.y;
  f.lightDir.z = night_ ? f.moonDir.z : f.sunDir.z;
  // By day the night hides itself (its own early way out), by night it works its whole frame.
  f.level = night_ ? 1e-6 : 0.75;
  f.sun2Dir.x = f.sunDir.x;
  f.sun2Dir.y = f.sunDir.y - 0.02;
  f.sun2Dir.z = f.sunDir.z;
  f.sun2 = true;
  f.sunHere.r = 1.5 + 0.2 * s;
  f.moonHere.r = 2e-6;
  NIGHT_IN.camX = 4000 + 3000 * Math.sin(a * 0.3);
  NIGHT_IN.camZ = -1200 + 500 * c;
  if ((st[0] & 512) !== 0) {
    // the world's equator turned about its pole by the frame's angle (the pole kept), as the day's `at` writes it
    const C = motion.celestial;
    C[0] = c * cel0[0] + s * cel0[3];
    C[1] = c * cel0[1] + s * cel0[4];
    C[2] = c * cel0[2] + s * cel0[5];
    C[3] = c * cel0[3] - s * cel0[0];
    C[4] = c * cel0[4] - s * cel0[1];
    C[5] = c * cel0[5] - s * cel0[2];
    // (maker P, J) every other stretch under the system that draws a belt, its plane turning a little each frame
    if ((st[0] & 1024) !== 0) {
      const B = beltMotion.belts;
      B[0] = s * 0.1;
      B[2] = c * 0.1;
      SKY_MOTION.now = beltMotion;
    } else SKY_MOTION.now = motion;
    appliedFrames++;
  } else SKY_MOTION.now = null;
  night.frame();
  AIR_FLARE_IN.skyDistance = 3500 + c;
  // The wave's fixer: the nightSuns switch moved now and then, and the open gate a frame in space writes.
  AIR_FLARE_IN.nightSuns = (st[0] & 256) === 0;
  airFlareLights(out, f, discs);
  if ((st[0] & 1) === 0) openFlareSeen();
}
function frames(n: number): void {
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
const r = night.report() as Any;
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, drawn: r.drawn, towns: r.towns.count, stars: r.stars.drawn, appliedFrames }));
process.exit(0);
