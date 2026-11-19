// The rope chain round, maker A: the chains' frame (`RopeChains.frame`, src/player/ropeChain.ts) measured with no collection between,
// each frame a function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson), at 144 frames
// a second (most frames no step, some one: both kinds measured). `CHAIN_PART` picks what is measured: 'free', a rope nobody holds
// swinging and settling, its ground read every step; 'held', a rope a swing holds (the swing scripted on the steps, the drawn hands
// handed in), its pin moving along the chain as the hands climb and come back; 'near', a rope lying on a floor a stand-in world
// answers making nothing (the near box met, every point's step met by a ray and the lying points' every substep). Prints one line of
// JSON. Run twelve at once by `climbRopeChainAlloc.test.ts`.
//
// Maker B adds the drawing (item 3) and another player on a rope (item 4): 'drawHeld' and 'drawNear' are 'held' and 'near' with each
// frame's strip laid as the player lays it (`drawChained`: the curve through the chain's points, the near rope's lying knots lifted,
// and the strip turned to a moving camera); 'peer' is a rope a peer hangs on, their hands climbing and swinging, through the real
// watcher of other players' ropes (`RemoteRopes`: moved, their hang handed to the chains by `hungInto`, the chain stepped and its
// strip laid, their ropes laid, their own line hidden), its two imports served from stubs as remoteRopes.test serves them.
import v8 from 'node:v8';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { PerformanceObserver } from 'node:perf_hooks';
import * as THREE from 'three';
import { FIXED_DT } from '../../../src/core/physics.ts';
import { resetClimbTune } from '../../../src/anim/climbTune.ts';
import { HangingRope, SWING_REC } from '../../../src/player/hangingRope.ts';
import { RopeChains, type ChainAsk, type ChainWorld } from '../../../src/player/ropeChain.ts';
import { RopeCurve } from '../../../src/player/ropeCurve.ts';
import { ChainRibbon, drawChained } from '../../../src/player/ropeChainDraw.ts';

const PARTS = ['free', 'held', 'near', 'drawHeld', 'drawNear', 'peer'];
const ASKED = process.env.CHAIN_PART ?? 'free';
const WHOLE = PARTS.includes(ASKED) ? ASKED : 'free';
/** The chain's own part ('free', 'held' or 'near'), and whether the strip is laid each frame, and a peer hangs on it. */
const PART = WHOLE === 'drawHeld' || WHOLE === 'peer' ? 'held' : WHOLE === 'drawNear' ? 'near' : WHOLE;
const DRAW = WHOLE === 'drawHeld' || WHOLE === 'drawNear' || WHOLE === 'peer';
const PEER = WHOLE === 'peer';
resetClimbTune();
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

interface Meas {
  bytes: number;
  frames: number;
  clean: boolean;
}
async function measure(fn: (n: number) => void, window: number): Promise<Meas> {
  fn(4000);
  let best: Meas = { bytes: Number.POSITIVE_INFINITY, frames: window, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    fn(240);
    // (Wall time for the optimising compiler, on a thread of its own, as ledgeAllocOwn.ts waits.)
    await new Promise<void>((r) => setTimeout(r, 25));
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const y0 = young();
    fn(window);
    const y1 = young();
    await turn();
    await turn();
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, frames: window, clean: true };
  }
  return best;
}

/** A kept answer of the engine's shape (`castRayAndGetNormal`'s: the time of impact and the met surface's normal). */
class Hit {
  timeOfImpact = 0.5;
  readonly normal = { x: 0, y: 1, z: 0 };
}
/** A world that makes nothing: a floor at y 0 under everything (the near box always met; a ray met where it crosses the floor). */
class FloorWorld {
  asks = 0;
  hits = 0;
  readonly hit = new Hit();
  readonly floor = {};
  intersectionWithShape(): unknown {
    this.asks++;
    return this.floor;
  }
  castRayAndGetNormal(ray: { origin: { y: number }; dir: { y: number } }, maxToi: number): Hit | null {
    this.asks++;
    const oy = ray.origin.y;
    const dy = ray.dir.y;
    if (dy >= 0 || oy <= 0) return null;
    const t = -oy / dy;
    if (t > maxToi) return null;
    this.hits++;
    this.hit.timeOfImpact = t;
    return this.hit;
  }
}

/** The frame's state: fields, so nothing crosses a call. */
class Run {
  readonly C = new RopeChains();
  readonly r = new HangingRope('measured', 0, 10, 0, 8);
  acc = 0.5;
  k = 0;
  frames = 0;
  constructor() {
    this.acc = 0;
  }
}
const st = new Run();
const world = new FloorWorld();
const C = st.C;
if (PART === 'near') {
  // A rope 12 m long from 10 m up: its last 2 m lie on the floor; the near box always met, so every step's rays are cast.
  st.r.own = 12;
  C.world = world as unknown as ChainWorld;
  C.ray = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: -1, z: 0 } } as unknown as RopeChains['ray'];
  C.box = { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } as unknown as RopeChains['box'];
}
// The ground read every step (a kept answer: the floor's own height).
C.ground = { at: (q: ChainAsk) => ((q.h = PART === 'near' ? -1 : 0), true) };
st.r.th = 0.4;
st.r.lay();
C.steps = 0;
C.frame([st.r]);

// Maker B: the strip, its curve and a camera moving about the rope (each frame turns the strip a little).
const curve = new RopeCurve();
const strip = new ChainRibbon();
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
camera.position.set(5, 6, 0);

/** Maker B, 'peer': the watcher of other players' ropes, served its two imports from stubs; a peer figure and its four joints. */
interface PeerSide {
  ropes: { tick(dt: number): void; peerMoved(v: never): void; hungInto(p: RopeChains['peers']): void; draw(cam: THREE.PerspectiveCamera, h: number, now: number): void };
  view: unknown;
  joints: THREE.Object3D[];
  scene: THREE.Scene;
}
let side: PeerSide | null = null;
if (PEER) {
  const portalSrc = readFileSync(new URL('../../../src/world/portalRender.ts', import.meta.url), 'utf8');
  const ACTOR_LAYER = Number(/export const ACTOR_LAYER = (\d+);/.exec(portalSrc)?.[1]);
  const stub = `export const ACTOR_LAYER = ${ACTOR_LAYER}; export function markActor(o) { o.traverse((x) => x.layers.enable(${ACTOR_LAYER})); }`;
  const peersStub = 'export const listeners = []; export function watchPeers(w) { listeners.push(w); return () => {}; }';
  const hook = `export async function resolve(s, c, next) {
  if (s.endsWith('/portalRender.ts') || s.endsWith('/portalRender')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true };
  if (s.endsWith('/remotePlayers.ts') || s.endsWith('/remotePlayers')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(peersStub)}), shortCircuit: true };
  return next(s, c);
}`;
  register('data:text/javascript,' + encodeURIComponent(hook));
  const { RemoteRopes } = await import('../../../src/net/remoteRopes.ts');
  const { newPeerRope, readPeerRope } = await import('../../../src/net/peerRope.ts');
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const root = new THREE.Group();
  group.add(root);
  const names = ['lWrist', 'lIndex01', 'rWrist', 'rIndex01'];
  const joints = names.map(() => new THREE.Group());
  for (const j of joints) root.add(j);
  const rig = { root, boneFor: () => joints[0], aimArm: () => {}, boneNamed: (n: string) => joints[names.indexOf(n)] ?? null };
  const view = { id: 9, shown: true, down: false, group, rig, rope: newPeerRope() };
  readPeerRope([1, 0, st.r.ax, st.r.ay, st.r.az, st.r.ax, st.r.ay, st.r.az], undefined, 0, view.rope);
  const ropes = new RemoteRopes();
  ropes.peerAdded(view as never);
  side = { ropes: ropes as unknown as PeerSide['ropes'], view, joints, scene };
}

/** The scripted swing at step `k` into `rec` from `o` (its angle, speed, the hands' way down, the stretch, its plane): numbers only into the kept array. */
function swingSlot(rec: Float64Array, o: number, k: number): void {
  const t = k * FIXED_DT;
  rec[o] = 0.6 * Math.sin(1.3 * t);
  rec[o + 1] = 0.78 * Math.cos(1.3 * t);
  rec[o + 2] = 2 + Math.abs(Math.sin(0.2 * t)) * 3;
  rec[o + 3] = 0.05;
  rec[o + 4] = 0;
  rec[o + 5] = 1;
}

function frame(): void {
  const s = st;
  const r = s.r;
  const c = s.C;
  let a = s.acc + 1 / 144;
  let n = 0;
  while (a >= FIXED_DT && n < 4) {
    a -= FIXED_DT;
    n++;
  }
  s.acc = a;
  s.frames++;
  if (PART === 'held') {
    // (Maker B, 'peer': the body never holds it; a peer's hands climb and swing on it, and let go of it now and then.)
    r.held = !PEER && (s.frames & 1023) < 900;
    // (The fixer: the swing's record of the frame's steps, as src/player/ropeSwing.ts writes it while it holds the rope: the swing
    // before them, then after each.)
    if (r.held) {
      for (let i = 0; i <= n; i++) swingSlot(r.swingRec, SWING_REC * i, s.k + i);
      r.swingSteps = n;
    }
    s.k += n;
    const t = s.k * FIXED_DT;
    r.th = 0.6 * Math.sin(1.3 * t);
    r.om = 0.78 * Math.cos(1.3 * t);
    r.thDraw = r.th;
    // The hands climbing and coming back (the pin moving along the chain), and the rope let go of and grabbed again now and then.
    r.gripS = 2 + Math.abs(Math.sin(0.2 * t)) * 3;
    r.e = 0.05;
    const P = side;
    if (P !== null) {
      const j = P.joints;
      const gx = Math.sin(r.th) * r.gripS;
      const gy = r.ay - Math.cos(r.th) * r.gripS;
      j[0].position.set(gx + 0.03, gy + 0.06, 0);
      j[1].position.set(gx + 0.03, gy + 0.02, 0);
      j[2].position.set(gx - 0.03, gy - 0.1, 0);
      j[3].position.set(gx - 0.03, gy - 0.14, 0);
      P.scene.updateMatrixWorld(true);
      (P.view as { shown: boolean }).shown = (s.frames & 1023) < 900;
    }
    const H = c.hand;
    H[0] = 0.02;
    H[1] = 10 - r.gripS;
    H[2] = 0.01;
    H[3] = -0.02;
    H[4] = 9.8 - r.gripS;
    H[5] = 0;
    c.hands = 2;
    c.handsRope = r;
  } else if ((s.frames & 4095) === 0) {
    // Swung again now and then, so the free rope never comes quite to rest.
    r.th = 0.4;
    r.om = 0;
  }
  c.steps = n;
  c.behind = a;
  const P = side;
  if (P !== null) {
    // (Maker B: as the frame loop has it, the peers moved, their hangs handed in before the chains are stepped.)
    P.ropes.tick(1 / 144);
    P.ropes.peerMoved(P.view as never);
    P.ropes.hungInto(c.peers);
  }
  c.frame(ROPES);
  if (DRAW) {
    // (Maker B: the strip laid as the player lays it, for a camera circling the rope, and then the peers' ropes.)
    camera.position.x = 5 * Math.cos(s.frames * 0.001);
    camera.position.z = 5 * Math.sin(s.frames * 0.001);
    if (!drawChained(st.r, strip, curve, camera, 1080)) strip.hide();
    if (P !== null) P.ropes.draw(camera, 1080, 0);
  }
}
const ROPES = [st.r];
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');
const meas = await measure(run, 100000);
const c = st.r.chain!;
let lying = 0;
for (let i = 0; i < c.n; i++) if (c.touch[i]) lying++;
console.log(JSON.stringify({ part: PART, whole: WHOLE, meas, steps: c.steps, swung: c.swung, rays: c.rays, hits: world.hits, nears: c.nears, lying, live: c.live, pinOn: c.pinOn, pinWho: c.pinWho, rings: strip.rings, lifted: strip.lifted, stripShown: strip.mesh.visible, peersTaken: st.C.peers.count > 0 && st.C.peers.taken[0] === 1 }));
