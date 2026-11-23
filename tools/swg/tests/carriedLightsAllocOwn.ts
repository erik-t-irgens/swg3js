// The effects' pool makes nothing a frame (the sky and light fix round, maker L): a real `Effects` over carried lights, its
// frame as the game's is on WebGPU (the player's lit blade held as it moves, a fighter's blade held, a shot now and then, a
// ship's room light uncarried now and then, the frame's end), over a window with no collection, the least of three clean
// windows kept. Not a test itself: `carriedLights.test.ts` runs it in twelve fresh processes (`node --expose-gc
// --allow-natives-syntax`).
import v8 from 'node:v8';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';

const portalSrc = readFileSync(new URL('../../../src/world/portalRender.ts', import.meta.url), 'utf8');
const ACTOR_LAYER = Number(/export const ACTOR_LAYER = (\d+);/.exec(portalSrc)?.[1]);
const stub = `export const ACTOR_LAYER = ${ACTOR_LAYER}; export function markActor(o) { o.traverse((x) => x.layers.enable(${ACTOR_LAYER})); }`;
const hook = `export async function resolve(s, c, next) {
  if (s.endsWith('/portalRender.ts') || s.endsWith('/portalRender')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true };
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));
const { Effects } = await import('../../../src/combat/effects.ts');

class Flagged extends THREE.PointLight {
  carried = 1;
}

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

const fx = new Effects(new THREE.Scene(), () => new Flagged(0xffffff, 0, 1));
const blade = { pos: new THREE.Vector3(0.5, 1.6, 0.5), intensity: 2.2, distance: 6 };
const fighter = { pos: new THREE.Vector3(4.5, 1.2, -3.5), intensity: 2, distance: 5 };
const shot = new THREE.Vector3(2.5, 1.5, 1.5);
const DT = 1 / 60;
const st = new Int32Array(2);
let held = 0;

/** One frame: the blade moved and held, the fighter's held, a shot every seventh frame, a room light every eleventh, the end. */
function frame(): void {
  const f = st[0] + 1;
  st[0] = f;
  const a = (f & 255) * 0.0245;
  blade.pos.x = Math.sin(a) * 0.5;
  blade.pos.z = Math.cos(a) * 0.5;
  fx.hold(blade, 0x66c8ff);
  if (f % 7 === 0) fx.flash(shot, 0xff8a50, 6, 4, 0.08);
  fx.hold(fighter, 0xff3030);
  if (f % 11 === 0) fx.flash(shot, 0xffffff, 3, 8, 0.08, false);
  st[1] = fx.heldNow;
  fx.update(DT);
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
held = st[1];
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
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, held }));
process.exit(0);
