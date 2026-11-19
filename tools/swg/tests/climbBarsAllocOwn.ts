// Climbing II, phase 3's own frames (maker A), measured on the real Rapier with no collection between, each frame a function of
// its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson). `BAR_PART` picks what is
// measured: 'swing' (the start), a body on a bar 2.2 m over open ground, the swing's step (`BarSwing.step`, one of the physics'
// steps a frame, W held then nothing) and the figure's place for it (`placeFigure`, a table of the clip's own shape); 'clips',
// the bar's hand-over to a rig (`driveBarClips`) on a stand-in rig that only counts its calls, the clip's time moving every frame;
// 'fly', the flight off a bar; 'shimmy' (the fix round's), the hands moved along a long bar by A and D in turn. Prints one line of JSON. Run twelve at once by `climbBarsAlloc.test.ts`.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { RAPIER } from '../../../src/core/physics.ts';
import { TestBody, ground, makePhysics } from './grappleBody.ts';
import { LedgeIn } from '../../../src/player/ledge.ts';
import { BAR_FLY, BAR_SWING, type BarWorld } from '../../../src/player/barSwing.ts';
import { BAR_JOINTS, BarFlightTable, BarSwingTable } from '../../../src/anim/barClips.ts';
import { driveBarClips } from '../../../src/player/hangClips.ts';
import { resetClimbTune } from '../../../src/anim/climbTune.ts';

const PART = process.env.BAR_PART === 'clips' ? 'clips' : process.env.BAR_PART === 'fly' ? 'fly' : process.env.BAR_PART === 'shimmy' ? 'shimmy' : process.env.BAR_PART === 'settle' ? 'settle' : 'swing';
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
  casts: number;
  clean: boolean;
}
async function measure(fn: (n: number) => void, window: number, casts: () => number): Promise<Meas> {
  fn(2000);
  let best: Meas = { bytes: Number.POSITIVE_INFINITY, frames: window, casts: 0, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    fn(240);
    // (The fix round's: wall time for the optimising compiler, on a thread of its own, as ledgeAllocOwn.ts waits.)
    await new Promise<void>((r) => setTimeout(r, 25));
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const c0 = casts();
    const y0 = young();
    fn(window);
    const y1 = young();
    await turn();
    await turn();
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, frames: window, casts: casts() - c0, clean: true };
  }
  return best;
}

/** A table of the clip's own shape: the hands still at (0, 2.05, 0), the hips swung from 41 degrees behind to 84 ahead, 1.03 m under them. */
function shapeTable(): BarSwingTable {
  const times = BarSwingTable.times();
  const nj = BAR_JOINTS.length;
  const S = new Float64Array(times.length * nj * 3);
  for (let i = 0; i < times.length; i++) {
    const u = Math.max(0, Math.min(1, (times[i] - 0.833) / (1.7 - 0.833)));
    const a = ((-40.6 + u * 124.4) * Math.PI) / 180;
    const k = i * nj * 3;
    S[k] = 0;
    S[k + 1] = 2.05 - 1.03 * Math.cos(a);
    S[k + 2] = 1.03 * Math.sin(a);
    for (let j = 1; j < nj; j++) {
      S[k + j * 3] = j < 3 ? 0.25 : -0.25;
      S[k + j * 3 + 1] = 2.05;
      S[k + j * 3 + 2] = 0;
    }
  }
  return BarSwingTable.build(S)!;
}

let out: Record<string, unknown> = {};
if (PART === 'settle') {
  // The feedback round II (items 0b and 0c): W held a while and let go of in turn, so every window holds a swing pumped, a swing
  // let alone settling (`climb.barSettle` 'swings', its damping worked out each step), the free hang coming in as it settles
  // and going again as W pumps it (`climb.barHang` 'free'), and the figure's place for all of it.
  const p = await makePhysics();
  ground(p, 0);
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, 2.2, 0));
  p.stepOnce();
  const world = p.world as unknown as BarWorld;
  const T = shapeTable();
  class Run {
    b = new TestBody(p);
    li = new LedgeIn();
    n = 0;
    frees = 0;
    settles = 0;
  }
  const st = new Run();
  st.b.jka.forceLevel = 0;
  st.b.place(0, 0, 0.1);
  st.b.forward.set(0, 0, 1);
  st.b.right.set(-1, 0, 0);
  st.b.run(60, 0.3);
  st.b.key('KeyE', true);
  st.b.frame(1 / 60);
  st.b.key('KeyE', false);
  st.b.run(60, 0.5);
  st.li.scale = 1;
  st.li.filter = st.b.filter;
  st.li.pool = 100;
  function frame(): void {
    const s = st;
    const li = s.li;
    const b = s.b.bar;
    s.n = s.n === 899 ? 0 : s.n + 1;
    li.dt = 1 / 60;
    li.forwardHeld = s.n < 300;
    li.backHeld = false;
    li.leftHeld = false;
    li.rightHeld = false;
    li.jumpPressed = false;
    li.crouchPressed = false;
    b.steps = 1;
    b.behind = 0.004;
    b.step(world, s.b, li);
    b.placeFigure(T, 1, s.b.pos);
    if (b.freeStart) s.frees++;
    if (b.settling) s.settles++;
  }
  function run(n: number): void {
    for (let k = 0; k < n; k++) frame();
  }
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(run)');
  const meas = await measure(run, 90000, () => st.b.bar.casts);
  out = { part: PART, held: st.b.bar.holding, frees: st.frees, settles: st.settles, meas };
} else if (PART === 'swing') {
  const p = await makePhysics();
  ground(p, 0);
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, 2.2, 0));
  p.stepOnce();
  const world = p.world as unknown as BarWorld;
  const T = shapeTable();
  /** The frame's state: fields, so nothing crosses a call. */
  class Run {
    b = new TestBody(p);
    li = new LedgeIn();
    w = false;
  }
  const st = new Run();
  st.b.jka.forceLevel = 0;
  st.b.place(0, 0, 0.1);
  st.b.forward.set(0, 0, 1);
  st.b.right.set(-1, 0, 0);
  st.b.run(60, 0.3);
  st.b.key('KeyE', true);
  st.b.frame(1 / 60);
  st.b.key('KeyE', false);
  st.b.run(60, 0.5);
  st.li.scale = 1;
  st.li.filter = st.b.filter;
  st.li.pool = 100;
  function frame(): void {
    const s = st;
    const li = s.li;
    li.dt = 1 / 60;
    li.forwardHeld = s.w;
    li.backHeld = false;
    li.leftHeld = false;
    li.rightHeld = false;
    li.jumpPressed = false;
    li.crouchPressed = false;
    s.b.bar.steps = 1;
    s.b.bar.behind = 0.004;
    s.b.bar.step(world, s.b, li);
    s.b.bar.placeFigure(T, 1, s.b.pos);
  }
  function run(n: number): void {
    for (let k = 0; k < n; k++) frame();
  }
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(run)');
  const holding = st.b.bar.phase === BAR_SWING;
  st.w = true;
  const pumped = await measure(run, 100000, () => st.b.bar.casts);
  const amp = (st.b.bar.report() as { amplitude: number }).amplitude;
  st.w = false;
  const still = await measure(run, 100000, () => st.b.bar.casts);
  out = { part: PART, holding, held: st.b.bar.holding, amp, pumped, still };
} else if (PART === 'fly') {
  // Maker B: the flight off a bar (`climb.barFlight` 'fly'), a step of it every frame over open ground with no bar ahead, the
  // body put back at the flight's start each frame so it flies for ever: the swept capsule and the catch's box asked (two casts a
  // step, the engine's own answers none), and the flight's figure placed (a table of the clip's own shape).
  const p = await makePhysics();
  ground(p, 0);
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, 2.2, 0));
  p.stepOnce();
  // (The flight's frames are measured on a stand-in world that answers "nothing met" making nothing: the engine's own wrappers
  // make what they make per ask, the engine's cost and not the flight's, as the grapple's and the ledges' measures keep apart.)
  class OpenWorld {
    asks = 0;
    castShape(): null {
      this.asks++;
      return null;
    }
    intersectionsWithShape(): void {
      this.asks++;
    }
    intersectionWithShape(): null {
      this.asks++;
      return null;
    }
  }
  const open = new OpenWorld();
  const world = open as unknown as BarWorld;
  const F = new BarFlightTable(new Float64Array(Array.from({ length: 41 * 3 }, (_, i) => (i % 3 === 1 ? 1.9 - (Math.floor(i / 3) / 40) * 0.9 : 0))));
  class Run {
    b = new TestBody(p);
    li = new LedgeIn();
  }
  const st = new Run();
  st.b.jka.forceLevel = 0;
  st.b.place(0, 0, 0.1);
  st.b.forward.set(0, 0, 1);
  st.b.right.set(-1, 0, 0);
  st.b.run(60, 0.3);
  st.b.key('KeyE', true);
  st.b.frame(1 / 60);
  st.b.key('KeyE', false);
  st.b.run(60, 0.5);
  st.li.scale = 1;
  st.li.filter = st.b.filter;
  st.li.pool = 100;
  const B = st.b.bar;
  B.flight = F;
  // Launched once by the game's own Space, then held in the flight: the frame puts it back where it began and steps it.
  st.li.dt = 1 / 60;
  st.li.jumpPressed = true;
  B.steps = 1;
  B.behind = 0.004;
  B.step(p.world as unknown as BarWorld, st.b, st.li);
  st.li.jumpPressed = false;
  const flying = B.phase === BAR_FLY;
  function frame(): void {
    const s = st;
    const b = s.b.bar;
    b.phase = BAR_FLY;
    b.vx = 0;
    b.vy = 2;
    b.vz = 3;
    b.flyT = 0.1;
    s.b.pos.x = 0;
    s.b.pos.y = 3;
    s.b.pos.z = 30;
    b.swimLine = Number.NEGATIVE_INFINITY;
    b.steps = 1;
    b.behind = 0.004;
    b.step(world, s.b, s.li);
    b.placeFigure(null, 1, s.b.pos);
  }
  function run(n: number): void {
    for (let k = 0; k < n; k++) frame();
  }
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(run)');
  const meas = await measure(run, 100000, () => B.casts);
  out = { part: PART, flying, still: B.phase === BAR_FLY, meas };
} else if (PART === 'shimmy') {
  // The review's: a shimmy along a bar (A or D held, hand over hand), its room asked again each time the hands move on a few hand
  // widths (`BAR_OPEN_SLIP`). A body on a bar 100 m long, the side turned at each end, its asks answered by a stand-in world that
  // makes nothing (the engine's own wrappers are the engine's cost, as the flight's measure keeps them apart), so what the shimmy's
  // own frame makes shows.
  const p = await makePhysics();
  ground(p, 0);
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.035, 0.035).setTranslation(0, 2.2, 0));
  p.stepOnce();
  class OpenWorld {
    asks = 0;
    castShape(): null {
      this.asks++;
      return null;
    }
    intersectionsWithShape(): void {
      this.asks++;
    }
    intersectionWithShape(): null {
      this.asks++;
      return null;
    }
  }
  const open = new OpenWorld();
  const world = open as unknown as BarWorld;
  const T = shapeTable();
  class Run {
    b = new TestBody(p);
    li = new LedgeIn();
    right = true;
  }
  const st = new Run();
  st.b.jka.forceLevel = 0;
  st.b.place(0, 0, 0.1);
  st.b.forward.set(0, 0, 1);
  st.b.right.set(-1, 0, 0);
  st.b.run(60, 0.3);
  st.b.key('KeyE', true);
  st.b.frame(1 / 60);
  st.b.key('KeyE', false);
  st.b.run(60, 0.5);
  st.li.scale = 1;
  st.li.filter = st.b.filter;
  st.li.pool = 100;
  const B = st.b.bar;
  const len = B.bar.len;
  function frame(): void {
    const s = st;
    const li = s.li;
    const b = s.b.bar;
    // (D held moves this body's hands toward the bar's first end, A toward its far one.)
    if (b.s < 2) s.right = false;
    else if (b.s > len - 2) s.right = true;
    li.dt = 1 / 60;
    li.forwardHeld = false;
    li.backHeld = false;
    li.leftHeld = !s.right;
    li.rightHeld = s.right;
    li.jumpPressed = false;
    li.crouchPressed = false;
    b.steps = 1;
    b.behind = 0.004;
    b.step(world, s.b, li);
    b.placeFigure(T, 1, s.b.pos);
  }
  function run(n: number): void {
    for (let k = 0; k < n; k++) frame();
  }
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(run)');
  const s0 = B.s;
  const holding = B.phase === BAR_SWING;
  const meas = await measure(run, 100000, () => open.asks);
  out = { part: PART, holding, held: B.holding, asks: open.asks, along: B.s, len, meas };
} else {
  /** A rig that only counts its calls (the bar's hand-over is measured, never the rig's own mixer). */
  class StandRig {
    calls = 0;
    overrideSeekAt = 0.5;
    overrideRateAt = 0.5;
    play(_c: string, _o: unknown): number {
      this.calls++;
      return 1;
    }
    setState(_s: string, _sp: number, _u: string | null, _o: unknown): void {
      this.calls++;
    }
    blendOut(_f: number): void {
      this.calls++;
    }
    stopOverride(_f: number): void {
      this.calls++;
    }
    overrideSeekNow(_c: string): void {
      this.calls++;
    }
    update(_dt: number): void {
      this.calls++;
    }
    // (The feedback round II's free hang: the swing's clip crossfaded into the loop, and what plays now.)
    yieldOverride(_f: number): void {
      this.calls++;
    }
    overrideName: string | null = 'mx_run_and_swing';
  }
  for (const m of ['play', 'setState', 'blendOut', 'stopOverride', 'overrideSeekNow', 'update', 'yieldOverride']) {
    const fn = (StandRig.prototype as unknown as Record<string, unknown>)[m];
    // eslint-disable-next-line no-eval
    eval('(fn) => %NeverOptimizeFunction(fn)')(fn);
  }
  const rig = new StandRig();
  const hang = { posePlaying: '', hangFade: { fade: 0.2 }, ladderRate: { rate: 1, fade: 0.2 } };
  /** The bar's fields `driveBarClips` reads, one class (as the swing is). */
  class BarS {
    startClip = '';
    startFrom = 0.5;
    startFade = 0.5;
    ended = false;
    holding = true;
    onBar = true;
    landNow = false;
    poseT = 0.5;
    clipName = 'mx_run_and_swing';
    // (The feedback round II's free hang, item 0c: in and out of it in turn, its loop still or a shimmy at a rate of its own.)
    free = false;
    freeW = 0.5;
    freeStart = false;
    freeState = 'hangFree';
    freeRate = 0.5;
  }
  const B = new BarS();
  B.poseT = 1.25;
  B.freeW = 0;
  B.freeRate = 1;
  let turnN = 0;
  const drive = (): void => {
    driveBarClips(rig as never, B as never, 1 / 60, hang as never);
    B.poseT = B.poseT > 1.69 ? 0.84 : B.poseT + 0.003;
    // (Every 300 frames the free hang begins or ends; within it, the loop still, then a shimmy each way at the shift's rate.)
    turnN = turnN === 1199 ? 0 : turnN + 1;
    B.freeStart = turnN === 300;
    B.free = turnN >= 300 && turnN < 900;
    B.freeW = B.free ? (B.freeW >= 1 ? 1 : B.freeW + 0.0555) : B.freeW <= 0 ? 0 : B.freeW - 0.0555;
    if (B.freeW < 0) B.freeW = 0;
    B.freeState = turnN < 500 ? 'hangFree' : turnN < 700 ? 'shimmyFreeL' : 'shimmyFreeR';
    B.freeRate = turnN < 500 ? 1 : 2.2125;
  };
  const drives = (n: number): void => {
    for (let k = 0; k < n; k++) drive();
  };
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(drives)');
  const meas = await measure(drives, 100000, () => 0);
  out = { part: PART, calls: rig.calls, meas };
}
console.log(JSON.stringify(out));
