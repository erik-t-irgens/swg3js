// Space's frame makes nothing (the GPU port's pass 2, wave 4b, maker C): a real `SpaceRims` (`src/space/spaceRims.ts`) made over
// a zone's four planets as the world hangs them (Kessel's: one with air, its tables baked, three moons; one of them standing
// somewhere and moved each frame as `placeStandingBodies` moves it), a real `SpaceVolumes` (`spaceVolumes.ts`) with Kessel's
// Maelstrom hung (its noise "baked" by a stand-in renderer that draws nothing) and the Nebulae row's rule read a frame, run with
// the star wheeling, the camera turning, the forms switched through now and then and the volumes shown and hidden, over a
// window with no collection, the least of three clean windows kept. Not a test itself: `spaceAlloc.test.ts` runs it in twelve
// processes (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { BODY_TUNE } from '../../../src/sky/bodies/bodyTier.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { SpaceRims, SPACE_RIM_IN } = await import('../../../src/space/spaceRims.ts');
const { SpaceVolumes, SPACE_VOLUME_IN, nebulaFormNow } = await import('../../../src/space/spaceVolumes.ts');

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

// Kessel's planets as `World.loadSpaceBodies` hangs them: the sky group riding the camera, each a sphere 2600 m out.
const zonePlanets = [
  { appearance: 'appearance/planet_kessel.pln', direction: [-450, -90, 190], size: 4.3622 },
  { appearance: 'appearance/planet_tatooine_moon_03.pln', direction: [-125, 15, -115], size: 1.0165 },
  { appearance: 'appearance/planet_tatooine_moon_03.pln', direction: [700, 10, 500], size: 0.2015 },
  { appearance: 'appearance/planet_tatooine_moon_03.pln', direction: [70, 290, 50], size: 0.573 },
];
const group = new THREE.Group();
const bodies: { mesh: THREE.Mesh; radius: number; index: number; distance: number }[] = [];
zonePlanets.forEach((p, index) => {
  const dir = new THREE.Vector3(-p.direction[0], p.direction[1], p.direction[2]).normalize();
  const radius = 240 * p.size;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.MeshLambertMaterial({ map: new THREE.Texture(), fog: false, depthWrite: false }));
  mesh.position.copy(dir).multiplyScalar(2600);
  group.add(mesh);
  bodies.push({ mesh, radius, index, distance: Math.hypot(p.direction[0], p.direction[1], p.direction[2]) });
});
const rims = await SpaceRims.make('space_light1', zonePlanets.map((p) => p.appearance), bodies, null);
// A renderer that draws nothing: the volumes' noise bake and the march's warm ask it, the frame never does.
const stand: Any = {
  getRenderTarget: () => null,
  setRenderTarget() {},
  render() {},
  compileAsync: async () => {},
  readRenderTargetPixelsAsync: async () => new Uint8Array(4),
};
const vols = await SpaceVolumes.make(stand, 'space_light1', zonePlanets, bodies);
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 9000);
const camPos = new THREE.Vector3(1200, 40, -800);
const st = new Float64Array(2);
const FORMS = ['tier', 'scattered', 'painted', 'none'] as const;
const I = SPACE_RIM_IN;
const V = SPACE_VOLUME_IN;
const moon = bodies[3].mesh;

/** One frame: the star round its circle, the standing moon moved, the rims' and the volumes' frames, the row's rule. */
function frame(): void {
  st[0] += 1;
  const a = st[0] * 0.001;
  const c = Math.cos(a);
  const s = Math.sin(a);
  I.sunX = s;
  I.sunY = c * 0.6;
  I.sunZ = -c * 0.8;
  I.lightR = 2.1;
  I.lightG = 2;
  I.lightB = 1.9;
  V.sunX = I.sunX;
  V.sunY = I.sunY;
  V.sunZ = I.sunZ;
  V.dt = 1 / 60;
  // A body that stands somewhere: moved and scaled each frame (`World.placeStandingBodies`).
  moon.position.x = 300 + s * 200;
  moon.scale.x = 1 + 0.2 * c;
  moon.scale.y = moon.scale.x;
  moon.scale.z = moon.scale.x;
  camera.fov = 55 + 10 * s;
  BODY_TUNE.form = FORMS[(st[0] >> 9) & 3];
  rims.frame(camera);
  const form = nebulaFormNow();
  vols.shown = form === 'volumes' && ((st[0] >> 10) & 1) === 0;
  vols.frame(camPos, (st[0] >> 11) & 3);
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
const r = rims.report() as Any;
const v = vols.report() as Any;
// The frame's planets as the gas sees them, written out in the frame, are `occluderOf`'s rule to the last bit or so.
const { occluderOf } = await import('../../../src/space/nebulaForm.ts');
vols.shown = true;
vols.frame(camPos, 2);
const h = (vols as Any).hung[0];
const occ = (vols as Any).occ as THREE.Vector4[];
let occAgree = true;
for (let k = 0; k < 4; k++) {
  const p = bodies[k];
  const d = p.mesh.position.length();
  const want = occluderOf(h.place, 4000, { x: p.mesh.position.x / d, y: p.mesh.position.y / d, z: p.mesh.position.z / d }, p.distance, (p.radius * p.mesh.scale.x) / d, { x: 0, y: 0, z: 0, w: 0 });
  if (Math.abs(want.x - occ[k].x) > 1e-6 || Math.abs(want.y - occ[k].y) > 1e-6 || Math.abs(want.z - occ[k].z) > 1e-6 || Math.abs(want.w - occ[k].w) > 1e-6) occAgree = false;
}
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, rims: r.rims.length, baked: r.rims.filter((x: Any) => /baked|memo|stored/.test(String(x.tables))).length, volumes: v.volumes.length, occAgree }));
process.exit(0);
