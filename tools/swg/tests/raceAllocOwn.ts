// The race drive's own code and the race view over whole frames, in a node process of its own, the engine's answers
// kept: `raceDrive.test.ts` (18) runs this and reads the one line of JSON it prints. Not a test itself.
//
// Why a process of its own, and why stand-ins for the body and the physics: Rapier's own wrapper makes an object for
// every vector it hands back (`translation()`, `linvel()`), which the springs pay today as much as the drive does, so
// what is measured here is the drive's own arithmetic between those calls: the speed's parts, the turn and the pose,
// the plan on the fixed steps, the walk ahead and its lattice ring, the climbing judge, the bridge's row and ring, the
// sub-steps and the strike sweep. The stand-in body moves by its own velocity over the fixed steps, as Rapier's would.
//
// Run: node --expose-gc --allow-natives-syntax tools/swg/tests/raceAllocOwn.ts
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { RaceDrive, type RaceGround } from '../../../src/vehicles/raceDrive.ts';
import { newRaceView, newRaceViewOut, steerRaceView, frameRaceView, type RaceViewInput } from '../../../src/vehicles/raceView.ts';
import { RACE_TUNE } from '../../../src/vehicles/raceTune.ts';
import type { DriveInput, Vehicle } from '../../../src/vehicles/vehicle.ts';
import type { Physics } from '../../../src/core/physics.ts';

const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc;
if (!gc) {
  console.log(JSON.stringify({ skipped: 'run with node --expose-gc' }));
  process.exit(0);
}

const FIXED = 1 / 60;
// Rolling ground with a crevasse every kilometre, so the plan rises, settles, falls and bridges. Its heights are whole
// metres, which the engine hands back without making a number: the world's own readers (the terrain, the water) are
// the world's, and what is measured is what the drive makes between their answers.
const ground = (x: number, z: number): number => {
  const m = ((z % 1000) + 1000) % 1000;
  const pit = m > 600 && m < 640 ? -8 : 0;
  return (Math.round(2 * Math.sin(x / 41) + 3 * Math.sin(z / 97)) + pit) | 0;
};
const reader: RaceGround = { near: ground, far: (i, j) => ground(i * 16, j * 16), farStep: 16, farX: () => 0, farZ: () => 0, water: () => -Infinity };

// The stand-in body: kept answers, moved by its own velocity over the fixed steps the stand-in physics takes.
const t = { x: 0, y: 3, z: 0 };
const lv = { x: 0, y: 0, z: 0 };
const av = { x: 0, y: 0, z: 0 };
const rot = { x: 0, y: 0, z: 0, w: 1 };
let gravity = 1;
let damping = 0.12;
const body = {
  isValid: () => true,
  gravityScale: () => gravity,
  setGravityScale: (g: number) => {
    gravity = g;
  },
  linearDamping: () => damping,
  setLinearDamping: (d: number) => {
    damping = d;
  },
  translation: () => t,
  linvel: () => lv,
  angvel: () => av,
  setTranslation: (p: { x: number; y: number; z: number }) => {
    t.x = p.x;
    t.y = p.y;
    t.z = p.z;
  },
  setRotation: (q: { x: number; y: number; z: number; w: number }) => {
    rot.x = q.x;
    rot.y = q.y;
    rot.z = q.z;
    rot.w = q.w;
  },
  setLinvel: (v: { x: number; y: number; z: number }) => {
    lv.x = v.x;
    lv.y = v.y;
    lv.z = v.z;
  },
  setAngvel: (_v: { x: number; y: number; z: number }) => {},
};
const group = new THREE.Group();
const vehicle = {
  body,
  pos: new THREE.Vector3(0, 3, 0),
  group,
  heading: 0,
  spec: { bounds: { min: [-3, 0, -6], max: [3, 2.5, 6] }, raceBox: [7, 3, 15], maxSpeed: 85, boostSpeed: 125, ship: false },
  quaternion: (out: THREE.Quaternion) => out.set(rot.x, rot.y, rot.z, rot.w),
  setRaceHull: () => {},
  handBack: () => {},
  inRoom: false,
  held: false,
  holding: false,
  ghosted: false,
  destroyed: false,
  disposed: false,
  drift: false,
  speed: 0,
  steer: 0,
  boosting: false,
  meter: 0,
  overheated: 0,
  groundedPoints: 4,
  onWater: false,
  upsideDown: false,
  flipped: false,
  lean: 0,
  justHit: 0,
  hp: 100,
  raceHurt: (_a: number, _f: number) => {},
  raceWreck: () => {},
} as unknown as Vehicle;

// The stand-in physics' own clock, in a record: a number kept in a module's own variable is a number made at every write.
const clock = { acc: 0.5, steps: 0 };
clock.acc = 0;
const physics = {
  get steps() {
    return clock.steps;
  },
  stepsAhead(dt: number): number {
    let a = clock.acc + dt;
    let n = 0;
    while (a >= FIXED && n < 4) {
      a -= FIXED;
      n++;
    }
    return n;
  },
  step(dt: number): void {
    clock.acc += dt;
    let n = 0;
    while (clock.acc >= FIXED && n < 4) {
      t.x += lv.x * FIXED;
      t.y += lv.y * FIXED;
      t.z += lv.z * FIXED;
      clock.acc -= FIXED;
      n++;
      clock.steps++;
    }
    if (n === 4) clock.acc = 0;
  },
  topSurface: () => null,
} as unknown as Physics;

const race = new RaceDrive('pod', { ground: reader });
race.setLevels('max', vehicle);
const drive: DriveInput = { throttle: 1, steer: 0, heading: 0.5, boost: true, hop: false, up: false, down: false, vertical: 0, slide: false, lean: 0, pitch: 0, repair: false };
// Frame times that cross the fixed steps every way: 144, 75 and 40 fps in turn. Kept as the engine's own numbers (the
// list holds something that is not a number too, so the engine keeps each as made), as a game's frame hands its own on.
const DTS: unknown[] = [1 / 144, 1 / 75, 1 / 40, 'not a number'];
let k = 0;
const counts = { planned: 0 };
/** The engines' damage, fires and repair in the run (`RACE_ALLOC_ENGINES=0` leaves them whole, to compare). */
const ENGINES_AT_WORK = process.env.RACE_ALLOC_ENGINES !== '0';
function frame(): void {
  const dt = DTS[k++ % 3] as number;
  // A gentle weave: the target off the nose and back.
  drive.heading = race.heading + Math.sin(k / 400) * 0.2;
  drive.slide = (k & 1023) < 100;
  drive.lean = (k & 2047) < 300 ? 1 : 0;
  // The engines at work (src/vehicles/drivetrain.ts): a part worn past the pull now and then, another set burning, and
  // the repair held for a while, so the fires burn, the pull reaches the stick, the top's share moves and the repair
  // mends. A part burning out, a repair begun or ended moves the top, which shares the speed out again and rewrites the
  // spec: events, a few a minute, with a few numbers each, and not steps; the steps between them make nothing.
  if (ENGINES_AT_WORK && (k & 8191) === 1) {
    race.engines.parts[4].d = 0.7;
    race.engines.parts[1].fire = 0.001;
  }
  drive.repair = ENGINES_AT_WORK && (k & 8191) > 7700;
  race.step(vehicle, dt, drive, ground, null, null, physics);
  if (race.planned > 0) counts.planned++;
  physics.step(dt);
  // Back to the start now and then, so the run never leaves the numbers it began in (a teleport the drive starts afresh from).
  if (t.z > 50_000) {
    t.z = 0;
    t.x = 0;
  }
}

const view = newRaceView();
const out = newRaceViewOut();
const vin: RaceViewInput = { heading: 0.5, mouseDX: 0.5, k: 0.0025, keys: false, alt: false, orbitYaw: Math.PI, speed: 200.5, ceiling: 333.3, seatY: 1.5, dt: 0.5 };
let vk = 0;
function viewFrame(): void {
  vk++;
  vin.heading = Math.sin(vk / 300);
  vin.mouseDX = ((vk * 7) % 13) - 6;
  vin.keys = (vk & 511) < 40;
  vin.alt = (vk & 1023) < 30;
  vin.orbitYaw = vin.heading + Math.PI;
  vin.speed = 150 + 150 * Math.sin(vk / 900);
  vin.seatY = 1 + Math.sin(vk / 50);
  steerRaceView(view, vin, RACE_TUNE, out);
  vin.dt = DTS[vk % 3] as number;
  frameRaceView(view, vin, RACE_TUNE, out);
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
function frames(step: () => void, n: number): void {
  for (let i = 0; i < n; i++) step();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler.
}
async function measure(step: () => void, n: number): Promise<{ made: number; scavenges: number }> {
  frames(step, 50_000);
  let best = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    gc!();
    await settle();
    frames(step, 20_000);
    gc!({ type: 'minor' });
    await settle();
    scavenges = 0;
    const before = young();
    frames(step, n);
    const made = young() - before;
    await settle();
    if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
    if (best.scavenges === 0 && best.made <= 0) break;
  }
  return best;
}

const FRAMES = 100_000;
if (process.argv[2] === 'reads') {
  // How many times a step asks the world's own readers (the hull's ground, the cached ground ahead) at full speed: each
  // is a call the world answers, and in the game each makes the numbers it is handed and gives back, as the springs' do.
  let reads = 0;
  const counted = (x: number, z: number): number => {
    reads++;
    return ground(x, z);
  };
  const r = race as unknown as { deps: { ground: RaceGround } };
  r.deps.ground = { near: counted, far: (i, j) => counted(i * 16, j * 16), farStep: 16, farX: () => 0, farZ: () => 0, water: () => -Infinity };
  for (const dt of [1 / 144, 1 / 60, 1 / 20]) {
    reads = 0;
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      race.step(vehicle, dt, drive, counted, null, null, physics);
      physics.step(dt);
      n++;
    }
    console.log(`${Math.round(1 / dt)} fps: ${(reads / n).toFixed(1)} reads a step, ${((reads / n) / dt).toFixed(0)} a second`);
  }
  process.exit(0);
}
if (process.argv[2] === 'method') {
  // One of the step's parts alone, over and over from the state real frames left: which part makes what.
  frames(frame, 50_000);
  const r = race as unknown as Record<string, (...a: unknown[]) => unknown>;
  const name = process.argv[3];
  const byDrive = ['turnStep', 'thrustStep', 'boostStep', 'poseBank'];
  const byVehicle = ['odometer', 'hitTest', 'command', 'plan', 'pushStep', 'poseGround'];
  const dtTagged = DTS[1] as number;
  const call = name === 'run' ? () => r.run.call(race, vehicle, dtTagged, drive, physics) : name === 'stepOnly' ? () => race.step(vehicle, dtTagged, drive, ground, null, null, physics) : name === 'stepsAhead' ? () => physics.stepsAhead(1 / 75) : byDrive.includes(name) ? () => r[name].call(race, drive) : byVehicle.includes(name) ? () => r[name].call(race, vehicle) : name === 'poseTurn' ? () => r.poseTurn.call(race) : () => r[name].call(race, vehicle, drive);
  const m = await measure(call, FRAMES);
  console.log(name, (m.made / FRAMES).toFixed(2), 'B a call', m.scavenges, 'collections');
  process.exit(0);
}
if (process.argv[2] === 'profile') {
  // Where it is made, by the sampling heap profiler: `node --expose-gc tools/swg/tests/raceAllocOwn.ts profile [view]`.
  const { Session } = await import('node:inspector/promises');
  const session = new Session();
  session.connect();
  const step = process.argv[3] === 'view' ? viewFrame : frame;
  frames(step, 50_000);
  console.log('--- warmed');
  await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  frames(step, 50_000);
  const { profile } = (await session.post('HeapProfiler.stopSampling')) as { profile: { head: SampleNode } };
  interface SampleNode {
    callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
    selfSize: number;
    children: SampleNode[];
  }
  const sites = new Map<string, number>();
  const walk = (n: SampleNode, path: string) => {
    const here = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    if (n.selfSize > 0) sites.set(`${here}  <-  ${path}`, (sites.get(`${here}  <-  ${path}`) ?? 0) + n.selfSize);
    for (const c of n.children) walk(c, here);
  };
  walk(profile.head, '');
  for (const [k, n] of [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(n / 50_000).toFixed(1)} B/frame  ${k}`);
  process.exit(0);
}
const d = await measure(frame, FRAMES);
const v = await measure(viewFrame, FRAMES);
watch.disconnect();
console.log(JSON.stringify({ frames: FRAMES, made: d.made, scavenges: d.scavenges, planned: counts.planned, view: { frames: FRAMES, made: v.made, scavenges: v.scavenges } }));
