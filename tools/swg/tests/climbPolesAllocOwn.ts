// Climbing II, phase 5's own frames, measured with no collection between, each frame a function of its own reading kept fields,
// called from a loop kept out of the optimizer (wave 2a's lesson). `POLE_PART` picks what is measured:
//  - 'climb' (maker A's, from his scratch measure): a body on a pole, the climb's step (`PoleClimb.step`, a physics step every third
//    frame, as at 144 a second) and the figure's place (`placeFigure`) with W and S in turn and A held now and then, the room asked
//    of a stand-in world that answers "nothing met" making nothing; and (maker B) the slide down begun and stopped in turn;
//  - 'fly' (maker B): the jump off's flight held in the air, its step a physics step every third frame (the capsule swept against a
//    stand-in world that meets nothing, another pole searched for, the bars and the ledges asked through a stand-in catcher that
//    takes nothing), the figure led to the frame's time; its clock and fall put back now and then from the loop, so it never ends;
//  - 'clips' (maker B): the pole's hand-over to a rig (`drivePoleClips`) on a stand-in rig that only counts its calls, the clip's
//    time moving every frame, a let-go's frame now and then;
//  - 'limbs' (maker B, maker A's ask): a figure of the game's own rig on the course's pole (tools/swg/tests/climbFigure.ts), its hands
//    and feet put on the pole every frame (`limbsFor`, maker A's foot solve `placeFeetAt` among them, `LimbPlace.place`, `restore`)
//    while the climb's step moves the hands up and down it.
// Prints one line of JSON. Run twelve at once by `climbPolesAlloc.test.ts`.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';

const PART = process.env.POLE_PART === 'fly' ? 'fly' : process.env.POLE_PART === 'clips' ? 'clips' : process.env.POLE_PART === 'limbs' ? 'limbs' : 'climb';
const { TestBody, box, ground, makePhysics } = await import('./grappleBody.ts');
const { LedgeIn } = await import('../../../src/player/ledge.ts');
const { RopeTable, ROPE_JOINTS } = await import('../../../src/anim/ropeClips.ts');
const { resetClimbTune, tuneClimb } = await import('../../../src/anim/climbTune.ts');
const { POLE_FLY, POLE_ON } = await import('../../../src/player/poleClimb.ts');
const { drivePoleClips } = await import('../../../src/player/hangClips.ts');

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

/** A world that answers "nothing met" making nothing (the engine's own wrappers are the engine's cost, as the bars' measure keeps them apart). */
class OpenWorld {
  asks = 0;
  casts = 0;
  searches = 0;
  intersectionWithShape(): null {
    this.asks++;
    return null;
  }
  intersectionsWithShape(): void {
    this.searches++;
  }
  castShape(): null {
    this.casts++;
    return null;
  }
}
/** A catcher that takes nothing (the bars' and the ledges' own grabs are theirs, measured by their own suites). */
class NoCatch {
  bars = 0;
  lips = 0;
  bar(): boolean {
    this.bars++;
    return false;
  }
  lip(): boolean {
    this.lips++;
    return false;
  }
  top(): boolean {
    return false;
  }
}

/** A body on a pole on the real Rapier (grabbed with E, the harness's own frames), its pole and world. */
async function onPole() {
  const p = await makePhysics();
  ground(p, 0);
  box(p, [-0.04, 0, -0.04], [0.04, 40, 0.04], false);
  p.stepOnce();
  (p as unknown as { acc: number }).acc = 0;
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(0, 0, 0.6);
  b.forward.set(0, 0, -1);
  b.right.set(1, 0, 0);
  b.run(60, 0.3);
  b.key('KeyE', true);
  b.frame(1 / 60);
  b.key('KeyE', false);
  b.run(60, 1);
  return b;
}
function shapeTable() {
  const times = RopeTable.times(0, 2.4);
  const nj = ROPE_JOINTS.length;
  const S = new Float64Array(times.length * nj * 3);
  for (let i = 0; i < times.length; i++) for (let j = 0; j < nj; j++) S[(i * nj + j) * 3 + 1] = 1 + j * 0.1;
  const T = RopeTable.build(S, times, 2.4)!;
  T.rise = 0.49;
  return T;
}

let out: Record<string, unknown> = {};
if (PART === 'climb' || PART === 'fly') {
  const b = await onPole();
  const held = b.pole.holding;
  const T = shapeTable();
  const open = new OpenWorld();
  const catcher = new NoCatch();
  class Run {
    li = new LedgeIn();
    up = true;
    n = 0;
    slides = 0;
    flights = 0;
    flyFrames = 0;
  }
  const st = new Run();
  st.li.scale = 1;
  st.li.filter = b.filter;
  st.li.pool = 100;
  st.li.viewYaw = 0.5;
  const P = b.pole;
  P.catcher = catcher;
  P.swimLine = Number.NEGATIVE_INFINITY;
  const y0 = b.pos.y;
  if (PART === 'fly') {
    // Jumped off once (Space on the pole); the flight then held in the air by the loop (below).
    tuneClimb({ polePush: 3, poleJumpUp: 0.5 });
    st.li.jumpPressed = true;
    P.steps = 1;
    P.behind = 0.004;
    st.li.dt = 1 / 144;
    P.step(open as never, b, st.li);
    st.li.jumpPressed = false;
  }
  function frame(): void {
    const s = st;
    const li = s.li;
    li.dt = 1 / 144;
    s.n++;
    if (PART === 'climb') {
      if (P.s < 2) s.up = true;
      else if (P.s > 30) s.up = false;
      li.forwardHeld = s.up;
      li.backHeld = !s.up;
      li.leftHeld = (s.n & 1024) !== 0;
      // (Maker B: the slide down begun now and then, and stopped with W, so its frames are in the window too.)
      li.crouchPressed = (s.n & 2047) === 1500 && P.s > 10;
      li.forwardPressed = (s.n & 2047) === 1900;
      if (li.crouchPressed) s.slides++;
    } else {
      // (The flight's clock and its fall put back now and then, and the body lifted back up: the flight never ends.)
      if ((s.n & 63) === 0) {
        P.flyT = 0;
        P.vy = 4;
        b.pos.y = y0;
      }
      if (P.phase === POLE_FLY) s.flyFrames++;
    }
    P.steps = s.n % 3 === 0 ? 1 : 0;
    P.behind = 0.004;
    P.step(open as never, b, li);
    P.placeFigure(T, 1, b.pos);
  }
  function run(n: number): void {
    for (let k = 0; k < n; k++) frame();
  }
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(run)');
  const meas = await measure(run, 100000);
  out = { part: PART, held, holding: P.holding, flying: P.phase === POLE_FLY, onPole: P.phase === POLE_ON, slides: st.slides, flyFrames: st.flyFrames, asks: open.asks, casts: open.casts, searches: open.searches, bars: catcher.bars, lips: catcher.lips, meas };
} else if (PART === 'clips') {
  /** A rig that only counts its calls (the pole's hand-over is measured, never the rig's own mixer). */
  class StandRig {
    calls = 0;
    overrideSeekAt = 0.5;
    overrideRateAt = 0.5;
    timeAt = 0.5;
    prefer(_s: string, _c: string | null): void {
      this.calls++;
    }
    setState(_s: string, _sp: number, _u: string | null, _o: unknown): void {
      this.calls++;
    }
    setTimeNow(_c: string): void {
      this.calls++;
    }
    update(_dt: number): void {
      this.calls++;
    }
  }
  for (const m of ['prefer', 'setState', 'setTimeNow', 'update']) {
    const fn = (StandRig.prototype as unknown as Record<string, unknown>)[m];
    // eslint-disable-next-line no-eval
    eval('(fn) => %NeverOptimizeFunction(fn)')(fn);
  }
  const rig = new StandRig();
  const hang = { posePlaying: '', hangFade: { fade: 0.2 }, ladderRate: { rate: 1, fade: 0.2 } };
  /** The pole's fields `drivePoleClips` reads, one class (as the climb is). */
  class PoleS {
    ended = false;
    onPole = true;
    loopT = 0.5;
  }
  const P = new PoleS();
  P.loopT = 0.25;
  let k = 0;
  const drive = (): void => {
    k = (k + 1) % 800;
    P.onPole = k < 700;
    P.ended = k === 700;
    P.loopT = k < 600 ? (P.loopT > 2.3 ? 0 : P.loopT + 0.016) : Number.NaN;
    drivePoleClips(rig as never, P as never, 1 / 60, hang as never);
  };
  const drives = (n: number): void => {
    for (let i = 0; i < n; i++) drive();
  };
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(drives)');
  const meas = await measure(drives, 100000);
  out = { part: PART, calls: rig.calls, meas };
} else {
  const { figure, figureScale } = await import('./climbFigure.ts');
  const b = await onPole();
  const F = figure();
  b.ledgeScale = figureScale(F);
  const open = new OpenWorld();
  const T = shapeTable();
  class Run {
    li = new LedgeIn();
    up = true;
    n = 0;
    q = new Float64Array(4);
    hands = 0;
    feet = 0;
  }
  const st = new Run();
  st.li.scale = 1;
  st.li.filter = b.filter;
  st.li.pool = 100;
  const P = b.pole;
  P.catcher = new NoCatch();
  P.swimLine = Number.NEGATIVE_INFINITY;
  const lp = F.lp;
  function frame(): void {
    const s = st;
    const li = s.li;
    li.dt = 1 / 144;
    s.n++;
    if (P.s < 2) s.up = true;
    else if (P.s > 30) s.up = false;
    li.forwardHeld = s.up;
    li.backHeld = !s.up;
    P.steps = s.n % 3 === 0 ? 1 : 0;
    P.behind = 0.004;
    P.step(open as never, b, li);
    P.placeFigure(T, 1, b.pos);
    // The figure lined up on the body as the player's `placeVisual` stands it (the rig's own posing left out: its mixer is the
    // rig's), through the objects' own fields and a kept array (no number crosses a call), then the pole's limbs.
    const h = P.heading;
    const c = Math.cos(h);
    const sn = Math.sin(h);
    const G = F.group.position;
    G.x = b.pos.x;
    G.y = b.pos.y;
    G.z = b.pos.z;
    const Q = s.q;
    Q[0] = 0;
    Q[1] = Math.sin(h / 2);
    Q[2] = 0;
    Q[3] = Math.cos(h / 2);
    F.group.quaternion.fromArray(Q, 0);
    const R = F.root.position;
    R.x = P.offX * c - P.offZ * sn;
    R.y = P.offY;
    R.z = P.offX * sn + P.offZ * c;
    Q[1] = 0;
    Q[3] = 1;
    F.root.quaternion.fromArray(Q, 0);
    F.group.updateMatrixWorld(true);
    P.limbsFor(lp, F.rig as never, null);
    if (lp.handW[0] > 0) s.hands++;
    if (lp.footTW[0] > 0) s.feet++;
    lp.place(F.rig as never, null, null);
    lp.restore();
  }
  function run(n: number): void {
    for (let k = 0; k < n; k++) frame();
  }
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(run)');
  const meas = await measure(run, 100000);
  out = { part: PART, holding: P.holding, hands: st.hands, feet: st.feet, meas };
}
console.log(JSON.stringify(out));
