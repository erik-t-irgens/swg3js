// The real sky's capture makes nothing a frame (the GPU port's pass 2, wave 2, maker B): `SkyCapture.step` as the world's
// WebGPU refresh calls it, over a stand-in renderer and filter that make nothing, the sky's bodies, its skybox and a space
// zone's planets copied, the sky's group riding a moving camera and the light turning, the clock's refreshes four times a
// second (each a face a frame and the filter on a seventh, its centres walked and its copies placed and its lights copied),
// some begun by the light, an ask now and then (all at once), and the idle frames between, over a window with no collection,
// the least of three clean windows kept. Not a test itself: `skyCaptureAlloc.test.ts` runs it in twelve fresh processes
// (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { DomeCapture, type DomeFilter } from '../../../src/world/envmap.ts';
import { SkyCapture, type CaptureRenderer } from '../../../src/sky/capture/skyCapture.ts';
import { CAPTURE_TUNE } from '../../../src/sky/capture/captureTune.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

/** A filter that makes its one target at the first call and hands it back after, as three's does handed a target. */
const kept = new THREE.WebGLRenderTarget(4, 4);
const filter: DomeFilter = {
  fromCubemap: (_cube, into) => into ?? kept,
  compileCubemapShader: () => undefined,
};
/** A renderer that draws nothing and counts (in whole numbers, which make nothing whatever code runs them), its target held as three holds it. */
const counts = new Int32Array(2);
const r: CaptureRenderer = {
  autoClear: true,
  reversedDepthBuffer: true,
  coordinateSystem: THREE.WebGPUCoordinateSystem,
  getRenderTarget: () => held.target,
  getActiveCubeFace: () => held.face,
  getActiveMipmapLevel: () => held.mip,
  setRenderTarget(t: unknown, face?: number, mip?: number) {
    held.target = t;
    held.face = face ?? 0;
    held.mip = mip ?? 0;
  },
  render() {
    counts[0] += 1;
  },
  clearDepth() {
    counts[1] += 1;
  },
};
const held: { target: unknown; face: number; mip: number } = { target: null, face: 0, mip: 0 };

// A world as the game's: its scene, the sky's group riding the camera with its moon, glow and skybox, a space zone's planets
// riding it too, the world's sun and sky light.
const world = new THREE.Scene();
const group = new THREE.Group();
group.position.set(5012.25, 31.5, -1307.75);
world.add(group);
const domeMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
const domeScene = new THREE.Scene();
domeScene.add(new THREE.Mesh(new THREE.SphereGeometry(5600, 8, 4), domeMat));
domeScene.userData.swgSkyCapture = true;
const quad = (deg: number, additive: boolean): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  m.position.set(Math.cos(deg) * 3500.5, Math.sin(deg) * 3500.5, 0.5);
  m.scale.set(210.5, 210.5, 1);
  group.add(m);
  return m;
};
const moon = quad(0.7, false);
const glow = quad(0.7, true);
const box = new THREE.Group();
box.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial()));
group.add(box);
const planets = new THREE.Group();
planets.position.copy(group.position);
const planet = new THREE.Mesh(new THREE.SphereGeometry(500, 8, 4), new THREE.MeshLambertMaterial());
planet.position.set(0.5, 0.5, -2600.5);
planets.add(planet);
world.add(planets);
const sun = new THREE.DirectionalLight(0xffe0c0, 2.5);
sun.position.set(5112.5, 231.5, -1307.5);
sun.target.position.set(5012.5, 31.5, -1307.5);
const hemi = new THREE.HemisphereLight(0x8090a0, 0x403020, 0.75);
world.add(sun, sun.target, hemi);
world.updateMatrixWorld(true);

const dome = new DomeCapture(filter);
const cap = new SkyCapture(dome);
cap.attach(domeScene, group, sun, hemi, domeMat, -10, [moon, glow, box]);
cap.placePlanets(planets);
// Four refreshes a second, and a light that turns past half a degree now and then: every path of the clock runs.
CAPTURE_TUNE.every = 0.25;
const light = new THREE.Vector3(0.5, 0.5, 0.5);
const st = new Float64Array(4);
const DT = 1 / 60;

/** One frame: the camera moves (the sky's and the planets' groups with it), the light turns, the moon fades in and out, the capture's step as the world calls it. */
function frame(): void {
  st[0] += 1;
  // The light drifts a hundredth of a degree a frame (the clock comes first) and jumps a degree every 512 frames (the light).
  if ((st[0] & 511) === 0) st[1] += 0.02;
  const a = st[0] * 0.0001 + st[1];
  const c = Math.cos(a);
  const s = Math.sin(a);
  // The harness's own writes field by field (a vector's `set` hands its numbers across a call the compiler may leave out).
  light.x = c;
  light.y = s;
  light.z = 0;
  group.position.x = 5012.25 + s * 40;
  group.position.z = -1307.75 + c * 40;
  planets.position.x = group.position.x;
  planets.position.z = group.position.z;
  moon.visible = (st[0] & 64) === 0;
  // An ask now and then (a source switched, an hour moved by hand): all six faces and the filter at once.
  if ((st[0] & 1023) === 0) cap.clock.asked = true;
  cap.clock.dt = DT;
  cap.step(r, light);
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
const why = cap.clock.why as Any;
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, faces: cap.stats.faces, filters: cap.stats.filters, outright: cap.stats.outright, byClock: why.clock, byLight: why.light, renders: counts[0] }));
process.exit(0);
