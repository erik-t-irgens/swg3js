// A space zone's frame on WebGPU makes nothing (the GPU port's pass 2, wave 3, maker B): the real `Nebulae.update` with the
// switch at WebGPU (each nebula's middle less the eye into its table, the mist's sort on its clock and its sheets put back
// relative after it, the strikes on their clock and each drawn bolt handed its ends less the eye) and the real
// `DistantSet.frame` (the systems that ride with the camera moved with it through a stand-in of the particles' own `move`), a
// ship flying through a striking nebula far from the world's middle, over a window with no collection, the least of three
// clean windows kept. Not a test itself: `spaceGpuAlloc.test.ts` runs it in twelve fresh processes
// (`node --expose-gc --allow-natives-syntax`).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { GPU } from '../../../src/core/gpuSwitch.ts';
import { Nebulae, type NebulaShip } from '../../../src/space/nebulae.ts';
import { NEBULA_TUNE } from '../../../src/space/nebulaMath.ts';
import { DistantSet } from '../../../src/space/distant.ts';
import type { Nebula, NebulaColour } from '../../../src/space/spaceData.ts';
import { distantEntry } from '../space.mjs';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));

const row = (name: string, at: [number, number, number], radius: number, extra: Partial<Nebula> = {}): Nebula => ({
  name, at, radius, density: 1, facingShare: 0.5,
  facing: { colour: [0.6, 1, 0.8, 0.8] as NebulaColour, ramp: [0.2, 0.4, 0.6, 1] as NebulaColour },
  oriented: { colour: [0.5, 1, 1, 1] as NebulaColour, ramp: [0.5, 1, 1, 1] as NebulaColour },
  jitter: 0, shader: 'mist', shaderIndex: 1, sound: { ambient: null, volume: 0 }, lightning: null, unused: {}, ...extra,
});
// Strikes every quarter second or so, so bolts are drawn and handed their ends all through the window.
const stormy = { appearance: 'x', every: 4, maxSeconds: 1.5, damage: [40, 120] as [number, number], colour: [0.5, 1, 0.6, 0.2] as NebulaColour, ramp: [0.5, 1, 0.9, 0.3] as NebulaColour, sounds: { strike: null, loop: null }, hit: { client: null, server: null } };
// What to step (for bisecting a reading): 'all' (the default), 'nebulae' or 'distant' alone, 'webgl' (the nebulae with the
// switch at WebGL, the frame as it was before this wave), or 'storm' (the nebulae on WebGPU with strikes four times a second:
// the strike path is WebGL's own and reads about 27 B a frame on either switch, measured before this wave's lines and beside
// them, so it is left out of the measure and noted). Outside 'storm' nothing strikes, and one bolt is held drawn all through
// the window, so its ends are handed over every frame.
const part = process.env.SPACE_ALLOC_PART ?? 'all';
const rows: Nebula[] = [
  row('storm', [-5871.25, 210.5, 6030.75], 1800, { lightning: part === 'storm' ? stormy : null }),
  row('mist', [-7420.5, -300.25, 8110.5], 2200),
  row('glow', [-1200.75, 800.5, 9300.25], 2600, { shader: 'glow' }),
];
const look = { shader: '', effect: null, blend: 'alpha' as const, texture: 'm.png', shell: { shader: '', effect: null, texture: 'm.png' } };
const pack: Any = {
  version: 3, zone: 'z', planet: null, title: 'z', stations: [], scenery: [], planets: [], arrival: null, hyperspace: null, nebulae: rows,
  nebulaLook: { glow: { ...look, blend: 'add' as const, texture: 'g.png' }, mist: look },
  // The zone's lightning look, so its bolts are made, struck or not.
  lightning: { source: '', flipbook: { shader: '', frames: 4, frameStart: 0, frameEnd: 3, uvSize: 0.5, perColumn: 2, fps: 10, visible: true }, texture: 'l.png', waveforms: [], value: 0, start: null, end: null, trailingBytes: 0 },
  fields: [], lanes: {}, dockEffects: {},
};
const clock = new Float64Array([1_700_000_000_000]);
const ships: NebulaShip[] = [];
const deps: Any = { place: () => null, remove: () => {}, flash: () => {}, ships: () => ships, strike: () => true, playerShip: () => null, damageEnabled: () => true, now: () => clock[0], texture: async () => new THREE.Texture() };
GPU.webgpu = true;
const nebulae = (await Nebulae.build(deps, pack, (f) => f, async () => true, () => true)) as Nebulae;
// Strike near the eye always (the reach test then never skips the storm), drawn when a bolt is free.
NEBULA_TUNE.strikeReach = 1e9;
NEBULA_TUNE.drawWithin = 1e9;

// The distant systems: Kessel's three black holes as the converter writes them, and Kashyyyk's asteroid standing.
const entry = (appearance: string, at: number[], turn: number[], infinite: boolean): Any =>
  distantEntry({ appearance, at, yaw: turn[0], pitch: turn[1], roll: turn[2], infinite }, `particles/${appearance}.json`, 80);
const distantPack: Any = { distant: [entry('a', [0, 0, -200], [0, -70, -25], true), entry('b', [140, 30, 20], [0, 0, 50], true), entry('c', [-200, 30, 400], [0, -90, 25], true), entry('d', [200, 50, 375], [-60, 0, 0], false)] };
// The particles' own `move`: the handle's matrix copied in place (`ParticleEffects.move`).
const moves = new Int32Array(1);
const set = (await DistantSet.build(
  {
    prepare: async () => true,
    place: (_f, m) => ({ matrix: m.clone() }),
    move: (h: Any, m) => {
      h.matrix.copy(m);
      moves[0] += 1;
    },
    resize: () => {},
    remove: () => {},
  },
  distantPack,
  { x: -6400.37, y: 120.61, z: 7000.88 },
  () => true,
)) as DistantSet;

const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 9000);
camera.position.set(-6400.37311, 120.61773, 7000.88131);
const st = new Float64Array(2);
const DT = 1 / 60;
// One bolt held drawn through the whole run (its life made long by hand), where nothing strikes; `SPACE_ALLOC_BOLT=0` none.
if (part !== 'storm' && process.env.SPACE_ALLOC_BOLT !== '0') {
  const beam = (nebulae as Any).beams[0];
  (beam.material.uniforms.uFrom.value as THREE.Vector3).set(-5871.5, 210.25, 6030.5);
  (beam.material.uniforms.uTo.value as THREE.Vector3).set(-5600.5, 400.25, 6230.5);
  beam.age = 0;
  beam.seconds = 1e12;
  beam.mesh.visible = true;
}
// 'gpu': this wave's own frame alone, as `Nebulae.update` calls it on WebGPU after the frame's sort (the table of middles, the
// sheets put back relative where the sort ran, which the clock here asks every 30th frame, each drawn bolt's ends) and the
// distant systems: the part the suite holds to nothing, since the rest of the nebulae's frame is WebGL's own and is measured
// beside it ('webgl').
const stepNebulae = part !== 'distant' && part !== 'gpu';
const stepDistant = part === 'all' || part === 'distant' || part === 'gpu';
const own = nebulae as Any;
const stepOwn = part === 'gpu';
if (part === 'webgl') GPU.webgpu = false;
/** One frame: the ship flies on through the storm, the clock moves, the nebulae and the distant systems as the world steps them. */
function frame(): void {
  st[0] += 1;
  const a = st[0] * 0.0007;
  // The harness's own writes field by field (a vector's `set` hands its numbers across a call the compiler may leave out).
  camera.position.x = -6400.37311 + Math.sin(a) * 900;
  camera.position.z = 7000.88131 + Math.cos(a) * 900;
  clock[0] += 1000 / 60;
  if (stepNebulae) nebulae.update(DT, camera);
  if (stepOwn) {
    // The frame's clock, and the sort's mark on it every 30th frame (the sort itself is WebGL's own and is not stepped here).
    own.time = st[0];
    if (st[0] % 30 === 0) own.sortTime = st[0];
    own.gpuSheetsFrame(camera.position);
    own.gpuBolts(camera.position);
  }
  if (stepDistant) set.frame(camera.position);
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
const tally = nebulae.report() as Any;
console.log(JSON.stringify({ frames: N, made: best.made, scavenges: best.scavenges, strikes: tally.lightning.strikes, drawn: tally.lightning.drawn, moves: moves[0], sheets: nebulae.sheets }));
process.exit(0);
