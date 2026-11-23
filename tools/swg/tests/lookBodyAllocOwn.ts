// The look bodies' frame makes nothing (the GPU port's pass 2, wave 5, maker L): a real `LookBodies` (`src/sky/bodies/lookBody.ts`)
// made by a stand-in renderer that draws nothing, over four looks every layer of which the frame steps: Naboo with its clouds'
// own motion, storms and lightning and its scattered air (a ground sky's card of SWG's, its record moved as the bodies' frame
// moves it), a ringed and belted desert world (a space planet, its sphere moved), a gas giant's banded depth (an extra body of an
// applied system, at a motion's direction), and a moon inside its gas (a space planet); the star wheeling, the cards rising and
// setting, the bodies drawn into their pictures on the cadence and when their light moves (`draw`), over a window with no
// collection, the least of three clean windows kept. Not a test itself: `lookBodyAlloc.test.ts` runs it in twelve processes
// (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { LookBodies, LOOK_BODY_IN } = await import('../../../src/sky/bodies/lookBody.ts');
const { BodyCardState } = await import('../../../src/sky/bodies/skyBody.ts');
const { AIR } = await import('../../../src/sky/air/airApi.ts');

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

// The viewer's own presets, each with a layer of the proof's turned on: storms and the clouds' own motion on a living world with
// its air scattered, a moon's surface inside the red veil's gas.
const { presetLook } = await import('../../../src/sky/look/generate.js');
const storm = presetLook('w3-naboo') as Any;
storm.layers.clouds.storm = { on: process.env.LB_NOSTORM !== '1', rate: 2, bright: 3, spread: 0.07, colour: '#d8e0ff' };
storm.layers.clouds.motion = { on: process.env.LB_NOMOTION !== '1', drift: 8, churn: 0.3, swirl: 0.25 };
if (process.env.LB_NOAIR === '1') storm.air = { ...storm.air, mode: 'painted' };
const gas = presetLook('v-veil-red') as Any;
gas.layers.surface.on = true;
const looks: Record<string, Any> = { 'proof:naboo-storms': storm, 'generated:w-geonosis': presetLook('w-geonosis'), 'generated:yavin-prime': presetLook('yavin-prime'), 'proof:gas-moon': gas };
// A renderer that draws nothing: the bakes, the compiles and the frame's draws ask it.
const stand: Any = {
  getRenderTarget: () => null,
  setRenderTarget() {},
  render() {},
  clear() {},
  compileAsync: async () => {},
  readRenderTargetPixelsAsync: async () => new Uint8Array(4),
  getClearColor: (c: THREE.Color) => c,
  getClearAlpha: () => 1,
  setClearColor() {},
  getDrawingBufferSize: (v: THREE.Vector2) => v.set(1920, 1080),
};
const sky = new THREE.Group();
const zone = new THREE.Group();
// a card of SWG's as the sky hangs it and the bodies' frame reads it (its record)
const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
disc.position.set(0, 2000, -2800);
disc.scale.setScalar(400);
sky.add(disc);
const st = new BodyCardState(new THREE.Texture(), { pic: new THREE.Texture(), t: new THREE.Texture(), ms: new THREE.Texture(), e: new THREE.Texture() } as Any);
disc.userData.swgBodyCard = st;
const card: Any = { disc, glow: null, file: 'cels_naboo.dds', map: new THREE.Texture(), air: { kind: 'world', world: 'naboo' }, slot: 'celestial' };
const planet = (x: number, y: number, z: number, r: number) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial());
  m.position.set(x, y, z);
  zone.add(m);
  return m;
};
const ringed = planet(-1600, 300, -2000, 500);
const gassy = planet(1200, 900, -2100, 160);
const motion: Any = {
  dir: new Float64Array([0, 0.5, -0.8, 0.3, 0.6, -0.7]),
  light: new Float64Array([1, 0, 0, 0.7, 0.1, 0.7]),
  spinTurn: new Float64Array([0.1, 0.2]),
  items: [
    { drawn: true, sizeDeg: 8, spinDeg: 0 },
    { drawn: true, sizeDeg: 24, spinDeg: 1200 },
  ],
  T: 0.5,
};
const plans: Any[] = [
  { place: 'rori:celestial:cels_naboo', id: 'proof:naboo-storms', look: looks['proof:naboo-storms'], record: null, where: 'sky', card, item: -1, group: sky, order: -5, halfRad: 0.07, fovDeg: 60 },
  { place: 'space_tatooine:planet_tatooine', id: 'generated:w-geonosis', look: looks['generated:w-geonosis'], record: null, where: 'space', mesh: ringed, radius: 500, item: -1, group: zone, order: -4, halfRad: 0.2, fovDeg: 60 },
  { place: 'yavin4:system:Yavin Prime', id: 'generated:yavin-prime', look: looks['generated:yavin-prime'], record: null, where: 'sky', card: null, item: 1, group: sky, order: -5, halfRad: 0.2, fovDeg: 60 },
  { place: 'space_tatooine:planet_tatooine_moon', id: 'proof:gas-moon', look: looks['proof:gas-moon'], record: null, where: 'space', mesh: gassy, radius: 160, item: -1, group: zone, order: -4, halfRad: 0.07, fovDeg: 60 },
];
LOOK_BODY_IN.screenH = 1440;
// (a bisect's knobs: LB_PLANS a comma list of the plans to make, LB_NODRAW=1 the frame alone)
const only = process.env.LB_PLANS ? process.env.LB_PLANS.split(',').map(Number) : null;
const noDraw = process.env.LB_NODRAW === '1';
const set = await LookBodies.make(stand, only ? plans.filter((_, i) => only.includes(i)) : plans, 2);
const I = LOOK_BODY_IN;
const step = new Float64Array(2);

/** One frame: the star round its circle, the card rising and setting with its record, the planets moved, the frame and the draws. */
function frame(): void {
  step[0] += 1;
  const a = step[0] * 0.002;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const sun = AIR.frame.sunDir;
  sun.x = s;
  sun.y = c * 0.6;
  sun.z = -c * 0.8;
  I.sunX = sun.x;
  I.sunY = sun.y;
  I.sunZ = sun.z;
  I.lightR = 2.1;
  I.lightG = 2;
  I.lightB = 1.9;
  I.dt = 1 / 60;
  // the card as the bodies' frame leaves it: up most of the time, its place and size moving a little
  st.shown = ((step[0] >> 8) & 7) !== 0;
  st.dir.x = 0.1 * s;
  st.dir.y = 0.6;
  st.dir.z = -0.79;
  st.right.x = 1;
  st.up.y = 1;
  st.card.y = 0.07 + 0.001 * c;
  st.card.w = 1;
  ringed.position.x = -1600 + 20 * s;
  motion.light[0] = c;
  motion.light[2] = s;
  motion.spinTurn[1] = (step[0] * 0.0001) % 1;
  set.frame(motion);
  if (!noDraw) set.draw();
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
const r = set.report() as Any;
const bodies = r.bodies as Any[];
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, bodies: bodies.length, drawn: bodies.map((b) => b.drawn), storms: bodies.filter((b) => b.moving).length, air: bodies.map((b) => b.air) }));
process.exit(0);
