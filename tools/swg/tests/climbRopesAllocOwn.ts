// Climbing II, phase 4's own frames (maker A), measured on the real Rapier with no collection between, each frame a function of
// its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson). `ROPE_PART` picks what is
// measured: 'swing' (the start), a body on a rope high over open ground, the swing's step (`RopeSwing.step`, one of the physics'
// steps a frame, A held then nothing) and the figure's place for it (`placeFigure`, tables of the clips' own shape); 'climb',
// W and S in turn up and down the rope, its room asked again each time the radius has moved on a hand's width, the asks answered
// by a stand-in that makes nothing; 'free', the ropes nobody holds swung and laid (`tickRopes`); 'clips', the rope's hand-over to
// a rig (`driveRopeClips`) on a stand-in rig that only counts its calls, the loop's and the swing's times moving every frame.
// Prints one line of JSON. Run twelve at once by `climbRopesAlloc.test.ts`.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { TestBody, ground, makePhysics } from './grappleBody.ts';
import { LedgeIn } from '../../../src/player/ledge.ts';
import { MODE_CLIMB, MODE_HANG, MODE_SWING, ROPE_FLY, ROPE_HANG as PHASE_HANG, ROPE_LAND, type RopeWorld } from '../../../src/player/ropeSwing.ts';
import { HangingRope } from '../../../src/player/hangingRope.ts';
import { ROPE_BAND_CLIPS, ROPE_BAND_FROM, ROPE_JOINTS, ROPE_LAND_FACTS, ROPE_TIMES, RopeLandTable, RopeTable, type RopeLandTables, type RopeTables } from '../../../src/anim/ropeClips.ts';
import { driveRopeClips } from '../../../src/player/hangClips.ts';
import { resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';

// (Maker B: 'land', the let-go into a landing and back: a body on a rope high in the open pumped by A, let go with Space on the
// forward swing, its flight met by a face a stand-in world answers making nothing, the landing carried onto its top, the band
// turned each time, the body hung on the rope again and the rope stilled; every step, the figure's place with tables of the
// landing clips' own shape, and the events between, in the window.)
const PART = process.env.ROPE_PART === 'clips' ? 'clips' : process.env.ROPE_PART === 'climb' ? 'climb' : process.env.ROPE_PART === 'free' ? 'free' : process.env.ROPE_PART === 'land' ? 'land' : 'swing';
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
    // (Wall time for the optimising compiler, on a thread of its own, as ledgeAllocOwn.ts waits.)
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

/** Tables of the clips' own shape: a still hang 0.71 m under the grip, a climb in place, a swing from 59 degrees behind to 19. */
function shapeTables(): RopeTables {
  const one = (t0: number, t1: number, ang: (u: number) => number, d: number): RopeTable => {
    const times = RopeTable.times(t0, t1);
    const nj = ROPE_JOINTS.length;
    const S = new Float64Array(times.length * nj * 3);
    for (let i = 0; i < times.length; i++) {
      const u = (times[i] - t0) / (t1 - t0);
      const a = ang(u);
      const k = i * nj * 3;
      S[k] = 0;
      S[k + 1] = 2 - 0.71 * Math.cos(a);
      S[k + 2] = 0.71 * Math.sin(a);
      for (let j = 1; j < 5; j++) {
        S[k + j * 3] = j < 3 ? 0.2 : -0.2;
        S[k + j * 3 + 1] = 2;
        S[k + j * 3 + 2] = 0;
      }
      S[k + 15 + 1] = 0.4;
      S[k + 18 + 1] = 0.4;
    }
    return RopeTable.build(S, times, d)!;
  };
  const climb = one(0, 2.55, () => -0.05, 2.55);
  climb.rise = 0.55;
  return {
    hang: one(0, 2.583, () => -0.07, 2.583),
    climb,
    swing: one(ROPE_TIMES.swingFrom, ROPE_TIMES.swingTo, (u) => ((-40 - 20 * Math.sin(u * Math.PI * 0.8) + 40 * Math.max(0, u - 0.4)) * Math.PI) / 180, 2.033),
  };
}

/** A world that answers "nothing met" making nothing (the engine's own wrappers are the engine's cost, as the bars' measure keeps them apart). */
class OpenWorld {
  asks = 0;
  intersectionWithShape(): null {
    this.asks++;
    return null;
  }
}

let out: Record<string, unknown> = {};
if (PART === 'swing' || PART === 'climb') {
  const p = await makePhysics();
  ground(p, 0);
  p.stepOnce();
  (p as unknown as { acc: number }).acc = 0;
  const open = new OpenWorld();
  const world = (PART === 'climb' ? open : p.world) as unknown as RopeWorld;
  const T = shapeTables();
  /** The frame's state: fields, so nothing crosses a call. */
  class Run {
    b = new TestBody(p);
    li = new LedgeIn();
    pump = false;
    up = true;
  }
  const st = new Run();
  const rope = new HangingRope('measured', 0, 40, 3, 39);
  st.b.jka.forceLevel = 0;
  st.b.place(0, 0, 2.5);
  st.b.forward.set(0, 0, 1);
  st.b.right.set(-1, 0, 0);
  st.b.rope.ropes = [rope];
  st.b.run(60, 0.3);
  st.b.key('KeyE', true);
  st.b.frame(1 / 60);
  st.b.key('KeyE', false);
  // Up the rope 20 m, clear of the ground under it: the swing's room open.
  st.b.key('KeyW', true);
  st.b.run(60, 40);
  st.b.key('KeyW', false);
  st.b.run(60, 1);
  st.li.scale = 1;
  st.li.filter = st.b.filter;
  st.li.pool = 100;
  st.li.viewYaw = 0;
  const R = st.b.rope;
  function frame(): void {
    const s = st;
    const li = s.li;
    const r = s.b.rope;
    li.dt = 1 / 60;
    li.leftHeld = s.pump;
    li.rightHeld = false;
    if (PART === 'climb') {
      // W and S in turn between 10 m and 30 m down the rope.
      if (r.s < 10) s.up = false;
      else if (r.s > 30) s.up = true;
      li.forwardHeld = s.up;
      li.backHeld = !s.up;
    } else {
      li.forwardHeld = false;
      li.backHeld = false;
    }
    li.jumpPressed = false;
    li.crouchPressed = false;
    r.steps = 1;
    r.behind = 0.004;
    r.step(world, s.b, li);
    r.placeFigure(T, 1, s.b.pos);
  }
  function run(n: number): void {
    for (let k = 0; k < n; k++) frame();
  }
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(run)');
  const holding = R.phase === PHASE_HANG;
  if (PART === 'swing') {
    st.pump = true;
    const pumped = await measure(run, 100000, () => R.casts);
    const amp = (R.report() as { amplitude: number }).amplitude;
    const modeSwing = R.mode === MODE_SWING;
    st.pump = false;
    const still = await measure(run, 100000, () => R.casts);
    out = { part: PART, holding, held: R.holding, amp, modeSwing, pumped, still };
  } else {
    const meas = await measure(run, 100000, () => open.asks);
    out = { part: PART, holding, held: R.holding, climbed: R.mode === MODE_CLIMB || R.mode === MODE_HANG, asks: open.asks, meas };
  }
} else if (PART === 'land') {
  const p = await makePhysics();
  ground(p, 0);
  p.stepOnce();
  (p as unknown as { acc: number }).acc = 0;
  /** A kept answer of the engine's shape (`castShape`'s: the time of impact, the met surface's normal, the point on it). */
  class Hit {
    time_of_impact = 0.5;
    readonly normal1 = { x: 0.5, y: 0.5, z: 0.5 };
    readonly witness1 = { x: 0.5, y: 0.5, z: 0.5 };
  }
  /**
   * A world that makes nothing: nothing met but a face across the flight at `face` (z), whose top is `lip` over the feet that
   * meet it (the probe dropped onto it finds it), the room on it open; the rope's own room asks answered "nothing met".
   */
  class LandWorld {
    asks = 0;
    face = 1e9;
    lip = 0.5;
    probe: unknown = null;
    readonly hit = new Hit();
    intersectionWithShape(): null {
      this.asks++;
      return null;
    }
    castShape(pos: { x: number; y: number; z: number }, _rot: unknown, vel: { x: number; y: number; z: number }, shape: unknown): Hit | null {
      this.asks++;
      const H = this.hit;
      if (shape === this.probe) {
        // The ball dropped from 1.4 m over the feet (the classify's `ropeLandTop` and `PROBE_OVER`): the top `lip` over them.
        H.time_of_impact = 0.5;
        H.normal1.x = 0;
        H.normal1.y = 1;
        H.normal1.z = 0;
        H.witness1.x = pos.x;
        H.witness1.y = pos.y - 1.4 + this.lip;
        H.witness1.z = pos.z;
        return H;
      }
      const front = pos.z + 0.35;
      if (vel.z <= 0 || front > this.face || front + vel.z < this.face) return null;
      H.time_of_impact = (this.face - front) / vel.z;
      H.normal1.x = 0;
      H.normal1.y = 0;
      H.normal1.z = -1;
      H.witness1.x = pos.x;
      H.witness1.y = pos.y;
      H.witness1.z = this.face;
      return H;
    }
  }
  /** Landing tables of the clips' own shape: the hips over the lower ankle, the ankle stood from the clip's own second. */
  function landTables(): RopeLandTables {
    const one = (t0: number, t1: number, stand: number, reach: number): RopeLandTable => {
      const times = RopeTable.times(t0, t1);
      const S = new Float64Array(times.length * 9);
      for (let i = 0; i < times.length; i++) {
        const u = Math.min(1, (times[i] - t0) / Math.max(1e-3, stand - t0));
        const k = i * 9;
        S[k] = 0;
        S[k + 1] = 0.9 - 0.4 * u;
        S[k + 2] = 0;
        S[k + 3] = 0.1;
        S[k + 4] = 0.1 + 0.5 * (1 - u);
        S[k + 5] = reach * (1 - u);
        S[k + 6] = -0.1;
        S[k + 7] = 0.1 + 0.6 * (1 - u);
        S[k + 8] = reach * (1 - u);
      }
      return RopeLandTable.build(S, times)!;
    };
    const land: RopeLandTable[] = [];
    for (let b = 0; b < ROPE_BAND_CLIPS.length; b++) land.push(one(ROPE_BAND_FROM[b], ROPE_LAND_FACTS.stand[b] + 0.6, ROPE_LAND_FACTS.stand[b], ROPE_LAND_FACTS.reach[b]));
    return { fly: one(ROPE_TIMES.landLevel, ROPE_TIMES.levelTouch, ROPE_TIMES.levelTouch, 0.6), land };
  }
  const world = new LandWorld();
  const T = shapeTables();
  const LT = landTables();
  /** The frame's state: fields, so nothing crosses a call. */
  class Run {
    b = new TestBody(p);
    li = new LedgeIn();
    jump = false;
  }
  const st = new Run();
  const rope = new HangingRope('measured', 0, 40, 3, 39);
  st.b.jka.forceLevel = 0;
  st.b.place(0, 0, 2.5);
  st.b.forward.set(0, 0, 1);
  st.b.right.set(-1, 0, 0);
  st.b.rope.ropes = [rope];
  st.b.run(60, 0.3);
  st.b.key('KeyE', true);
  st.b.frame(1 / 60);
  st.b.key('KeyE', false);
  st.b.key('KeyW', true);
  st.b.run(60, 40);
  st.b.key('KeyW', false);
  st.b.run(60, 1);
  st.li.scale = 1;
  st.li.filter = st.b.filter;
  st.li.pool = 100;
  st.li.viewYaw = 0;
  st.li.heading = 0;
  const R = st.b.rope;
  R.landTables = LT;
  function frame(): void {
    const s = st;
    const li = s.li;
    const r = s.b.rope;
    li.dt = 1 / 60;
    li.jumpPressed = s.jump;
    li.crouchPressed = false;
    li.use = false;
    li.forwardHeld = false;
    li.backHeld = false;
    li.rightHeld = false;
    li.leftHeld = r.onRope;
    r.steps = 1;
    r.behind = 0.004;
    r.step(world as unknown as RopeWorld, s.b, li);
    r.placeFigure(T, 1, s.b.pos);
  }
  function run(n: number): void {
    for (let k = 0; k < n; k++) frame();
  }
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(run)');
  // Pumped (A) to the let-go's angle on the forward swing, and the moment kept: every let-go after starts from it, the swing,
  // the rope and the body put back as they were (no grab, no pump: only the flight's and the landing's own frames between).
  for (let i = 0; i < 6000 && !(R.om > 0 && R.th >= 0.35); i++) frame();
  const keptR = Object.assign({}, R);
  const keptRope = Object.assign({}, rope);
  const kx = st.b.pos.x;
  const ky = st.b.pos.y;
  const kz = st.b.pos.z;
  const kvx = st.b.vel.x;
  const kvy = st.b.vel.y;
  const kvz = st.b.vel.z;
  /** The let-go kept put back, and Space on it into a face `ahead` metres on with a lip `lip` over the feet that meet it. */
  const letGo = (ahead: number, lip: number): void => {
    Object.assign(R, keptR);
    Object.assign(rope, keptRope);
    st.b.pos.set(kx, ky, kz);
    st.b.vel.set(kvx, kvy, kvz);
    world.face = kz + ahead;
    world.lip = lip;
    world.probe = (R as unknown as { probe: unknown }).probe;
    st.jump = true;
    frame();
    st.jump = false;
    world.probe = (R as unknown as { probe: unknown }).probe;
  };
  // The probe made (its first face met, before the world knows it): one let-go into a face, outside any window.
  letGo(1.6, 0.6);
  run(400);
  // (And the shapes the let-go made once, kept with the moment, or every let-go after would make them again.)
  const made = R as unknown as Record<string, unknown>;
  const kept = keptR as unknown as Record<string, unknown>;
  for (const k of ['probe', 'flyCap', 'cap']) kept[k] = made[k];
  letGo(1.6, 0.6);
  if (process.env.ROPE_DEBUG) console.log('second', R.phase, R.band, R.fT, R.plains, R.flights);
  run(400);
  /** One window: `n` frames run, its bytes, or NaN where a collection fell inside it (the wall time for the optimising compiler first). */
  const windowOf = async (n: number): Promise<number> => {
    await new Promise<void>((r) => setTimeout(r, 25));
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const y0 = young();
    run(n);
    const y1 = young();
    await turn();
    await turn();
    return scavenges === s0 ? y1 - y0 : Number.NaN;
  };
  // The measure's own bytes (the heap's statistics asked twice): a window of no frames, the least of four.
  let base = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 4; i++) {
    const w = await windowOf(0);
    if (w === w && w < base) base = w;
  }
  interface Part {
    /**
     * The bytes a frame: the cleanest long window's less the cleanest short one's, over the frames between (what a window costs
     * whatever its length, the measure's and the wake from the wait, taken off), the windows, and how many fell to a collection.
     */
    per: number;
    long: number;
    short: number;
    frames: number;
    windows: number;
    lost: number;
    phase: boolean;
  }
  const kind = async (what: 'fly' | 'land', times: number): Promise<Part> => {
    const P: Part = { per: 0, long: Number.POSITIVE_INFINITY, short: Number.POSITIVE_INFINITY, frames: 0, windows: 0, lost: 0, phase: true };
    for (let w = 0; w < times; w++) {
      let n = 0;
      if (what === 'fly') {
        // A level lip met near (0.9 m on), then the face taken away: the flight goes on, a cast a step, its figure drawn, for
        // the 3 s the flight is held at the most.
        letGo(0.9, 0.1);
        world.face = 1e9;
        run(20);
        n = 120;
      } else {
        // A waist lip 1.6 m on, the stand far in past its face and the walk in slow (the sliders' ends): a landing of seconds.
        letGo(1.6, 0.85);
        for (let i = 0; i < 200 && R.phase !== ROPE_LAND; i++) frame();
        run(20);
        n = 240;
      }
      // (Every other window half as long.)
      const half = (w & 1) === 1;
      const b = await windowOf(half ? n / 2 : n);
      P.phase &&= R.phase === (what === 'fly' ? ROPE_FLY : ROPE_LAND);
      if (b === b) {
        if (half && b < P.short) P.short = b;
        if (!half && b < P.long) P.long = b;
        P.frames = n / 2;
        P.windows++;
      } else P.lost++;
      run(what === 'fly' ? 400 : 800);
    }
    P.per = (P.long - P.short) / P.frames;
    return P;
  };
  tuneClimb({ ropeLandIn: 1.5, ropeLandWalk: 0.3 });
  // Warm: each kind's frames run hot, in turn (the optimising compiler given them, as a game's own flights and landings are).
  for (let i = 0; i < 4; i++) {
    await kind('fly', 6);
    await kind('land', 6);
  }
  const fly = await kind('fly', 16);
  const land = await kind('land', 16);
  out = { part: PART, base, flights: R.flights, landings: R.landings.slice(), fly, land };
} else if (PART === 'free') {
  const p = await makePhysics();
  ground(p, 0);
  p.stepOnce();
  class Run {
    b = new TestBody(p);
  }
  const st = new Run();
  for (let i = 0; i < 4; i++) {
    const r = new HangingRope(`free ${i}`, i * 3, 9, 0);
    r.th = 0.4 + i * 0.1;
    st.b.rope.ropes.push(r);
  }
  const R = st.b.rope;
  function frame(): void {
    const r = st.b.rope;
    // (The fixer: the free ropes are swung by `tickRopes`, once a frame at the top of the update; `tick` eases the let-go.)
    r.tickRopes(1 / 60);
    r.tick(1 / 60);
    // (Swung again whenever one has died away, so every frame steps and lays all four.)
    const list = r.ropes;
    for (let i = 0; i < list.length; i++) if (Math.abs(list[i].th) < 0.01 && Math.abs(list[i].om) < 0.01) list[i].th = 0.4;
  }
  function run(n: number): void {
    for (let k = 0; k < n; k++) frame();
  }
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(run)');
  const meas = await measure(run, 100000, () => 0);
  out = { part: PART, ropes: R.ropes.length, swinging: R.ropes.some((r) => Math.abs(r.om) > 0.01), meas };
} else {
  /** A rig that only counts its calls (the rope's hand-over is measured, never the rig's own mixer). */
  class StandRig {
    calls = 0;
    overrideSeekAt = 0.5;
    overrideRateAt = 0.5;
    timeAt = 0.5;
    overrideName: string | null = null;
    play(_c: string, _o: unknown): number {
      this.calls++;
      return 1;
    }
    prefer(_s: string, _c: string | null): void {
      this.calls++;
    }
    setState(_s: string, _sp: number, _u: string | null, _o: unknown): void {
      this.calls++;
    }
    setTimeNow(_c: string): void {
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
  }
  for (const m of ['play', 'prefer', 'setState', 'setTimeNow', 'blendOut', 'stopOverride', 'overrideSeekNow', 'update']) {
    const fn = (StandRig.prototype as unknown as Record<string, unknown>)[m];
    // eslint-disable-next-line no-eval
    eval('(fn) => %NeverOptimizeFunction(fn)')(fn);
  }
  const rig = new StandRig();
  const hang = { posePlaying: '', hangFade: { fade: 0.2 }, ladderRate: { rate: 1, fade: 0.2 } };
  /** The rope's fields `driveRopeClips` reads, one class (as the swing is). */
  class RopeS {
    startClip = false;
    ended = false;
    holding = true;
    onRope = true;
    mode = MODE_SWING;
    lastMode = MODE_SWING;
    poseT = 0.5;
    loopT = 0.5;
    swingName = 'mx_start_swinging';
    // (Maker B: the flight's and the landing's fields: flying, its clip and that clip's time, the one-frame words.)
    flying = false;
    startFly = false;
    startLand = false;
    landedNow = false;
    airClip = 'mx_swinging';
    airT = 0.5;
  }
  const R = new RopeS();
  R.poseT = 1.5;
  R.loopT = 0.25;
  R.airT = 1.05;
  let k = 0;
  const drive = (): void => {
    // Each kind in turn, a few seconds of each: the swing (its time moving), the climb (its loop's time moving), the hang, and
    // (maker B) a flight off the rope, the flight's clip's time moving.
    k = (k + 1) % 800;
    R.mode = k < 200 ? MODE_SWING : k < 400 ? MODE_CLIMB : MODE_HANG;
    R.lastMode = R.mode;
    R.onRope = k < 600;
    R.flying = k >= 600;
    driveRopeClips(rig as never, R as never, 1 / 60, hang as never);
    R.poseT = R.poseT > 2.0 ? 1.47 : R.poseT + 0.003;
    R.loopT = R.loopT > 2.5 ? 0 : R.loopT + 0.016;
    R.airT = R.airT > 1.2 ? 1.05 : R.airT + 0.002;
  };
  const drives = (n: number): void => {
    for (let i = 0; i < n; i++) drive();
  };
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(drives)');
  const meas = await measure(drives, 100000, () => 0);
  out = { part: PART, calls: rig.calls, meas };
}
console.log(JSON.stringify(out));
