// The sky's moons and planets make nothing a frame (the GPU port's pass 2, wave 4a, maker B): a real `SkyBodies` (`src/sky/
// bodies/skyBody.ts`) made from three cards as the sky makes them (Rori's Naboo, a world with air, its tables baked; its moon
// and an extra moon, airless), its frame run with the cards placed as the sky's `place` places them (the sun wheeling round the
// day's circle, the moon riding the light by night, the cards hidden under the land and shown again) and the form switched
// through every setting now and then (the tier's, Scattered, Painted, None), over a window with no collection, the least of
// three clean windows kept. Not a test itself: `bodyAlloc.test.ts` runs it in twelve processes at once (`node --expose-gc
// --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { AIR } from '../../../src/sky/air/airApi.ts';
import { bodyCardMaterial, type SkyBodyCard } from '../../../src/sky/bodies/bodyCard.ts';
import { bodyOfPicture } from '../../../src/sky/bodies/bodyAir.ts';
import { BODY_TUNE } from '../../../src/sky/bodies/bodyTier.ts';
import { turnSkyBody } from '../../../src/world/skyBodies.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Stand-in tables: the cards' graphs are built only when three compiles them, which nothing here does.
AIR.tables = { transmittanceToSpace: () => (TSL as Any).vec3(1), skyRadiance: () => (TSL as Any).vec3(0), nodes: { sunTop: (TSL as Any).vec3(1) } } as Any;
const { SkyBodies } = await import('../../../src/sky/bodies/skyBody.ts');

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

// The sky's group and three cards, made as `SwgSky`'s constructor makes them.
const group = new THREE.Group();
const card = (file: string, width: number, slot: SkyBodyCard['slot'], glow: boolean): SkyBodyCard => {
  const map = new THREE.Texture();
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bodyCardMaterial(map, 'painted'));
  disc.scale.set(width, width, 1);
  group.add(disc);
  let g: THREE.Mesh | null = null;
  if (glow) {
    g = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    g.scale.set(width * 1.4, width * 1.4, 1);
    group.add(g);
  }
  return { disc, glow: g, file, map, air: bodyOfPicture(file), slot };
};
// Pass 2, wave 4b: and a body held still (a station, turned by its roll), as `SwgSky.hangHeld` makes one.
const heldDir = new THREE.Vector3(0.55, 0.5, 0.66).normalize();
const heldCard = (): SkyBodyCard => {
  const c = card('moon_deathstar1', 1400, 'celestial', false);
  const quaternion = turnSkyBody(heldDir, new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.35));
  c.disc.position.copy(heldDir).multiplyScalar(3500);
  return { ...c, air: { kind: 'airless' }, held: { name: 'deathstar', picture: 'moon_deathstar1', light: 1.5, rollRad: 0.35, dir: heldDir, quaternion } };
};
const cards = [card('sky/cels_naboo.png', 2333, 'celestial', true), card('sky/moon_yellow.png', 1166, 'moon', false), card('sky/cels_moon_tiel.png', 600, 'moon2', true), heldCard()];
const set = await SkyBodies.make(cards);
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 10000);
const f = AIR.frame;
const st = new Float64Array(4);
const dir = new THREE.Vector3();
const fixed = new THREE.Vector3(0.3, 0.64, -0.7).normalize();
const FORMS = ['tier', 'scattered', 'painted', 'none'] as const;

/** One frame: the sun round the day's circle, the cards placed by the sky's own rule, the bodies' frame. */
function frame(): void {
  st[0] += 1;
  const a = st[0] * 0.002;
  const c = Math.cos(a);
  const s = Math.sin(a);
  f.sunDir.x = s;
  f.sunDir.y = c * 0.9238795325112867;
  f.sunDir.z = -c * 0.3826834323650898;
  // The moon rides the light by night (opposite the sun), as `SwgSky.update` places it; the extra bodies are fixed.
  dir.x = -f.sunDir.x;
  dir.y = -f.sunDir.y;
  dir.z = -f.sunDir.z;
  for (let i = 0; i < 3; i++) {
    const d = i === 1 ? dir : fixed;
    const disc = cards[i].disc;
    disc.position.x = d.x * 3500;
    disc.position.y = d.y * 3500;
    disc.position.z = d.z * 3500;
    disc.visible = d.y > -0.3;
    (disc.material as THREE.Material).opacity = d.y > 0 ? 1 : 0.5;
    if (disc.visible) turnSkyBody(d, disc.quaternion);
    const g = cards[i].glow;
    if (g) g.visible = disc.visible;
  }
  // Every setting of the form now and then (the console's switch), the tier's the rest of the time.
  BODY_TUNE.form = FORMS[(st[0] >> 9) & 3];
  set.frame(camera);
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
const r = set.report() as Any;
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, bodies: r.bodies.length, air: r.bodies.filter((b: Any) => b.air).length, baked: r.bodies.filter((b: Any) => /baked|memo|stored/.test(String(b.tables))).length }));
process.exit(0);
