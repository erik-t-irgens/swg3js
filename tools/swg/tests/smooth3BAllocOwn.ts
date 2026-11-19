// Climbing II, Smoothness III's own frames (maker B), measured on the real Rapier with no collection between, each frame a
// function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson). `S3B_PART` picks
// what is measured: 'ladder', a braced ladder climbed up and down rung after rung with the key held (item 4b's cycle); 'free',
// a free hang's hop up a rung and its drop down again (item 4's free hop and maker A's drop); 'body', a walk under a low beam
// the duck goes under and on under a slab it lies down under (items 3 and 3b). `S3B_MODE` 'before' puts this round's maker B
// switches at their other setting for the comparison (and for 'free', the same moves braced, off a wall). Prints one line of
// JSON. Run twelve at once by `smooth3BAlloc.test.ts`.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { LedgeIn, LEDGE_HANG, LEDGE_MOVE, type LedgeWorld } from '../../../src/player/ledge.ts';
import { Stamina } from '../../../src/anim/locoClass.ts';
import { resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { resetMoveTune, tuneMove } from '../../../src/anim/moveTune.ts';

const PART = process.env.S3B_PART === 'free' ? 'free' : process.env.S3B_PART === 'body' ? 'body' : process.env.S3B_PART === 'hang' ? 'hang' : 'ladder';
const BEFORE = process.env.S3B_MODE === 'before';
resetClimbTune();
resetMoveTune();
if (BEFORE && PART === 'ladder') tuneClimb({ ladderCycle: 'rung' });
if (BEFORE && PART === 'body') tuneMove({ proneMin: 'today', duckClip: 'one' });
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

const p = await makePhysics();
ground(p, 0);
if (PART === 'ladder') {
  // A wall 9 m tall, rungs 0.3 m out of it every metre from 2.4 m (the course's braced ladder).
  box(p, [-8, 0, 2], [8, 9, 3]);
  for (let k = 0; k < 6; k++) box(p, [-2, 2.2 + k, 1.7], [2, 2.4 + k, 2]);
} else if (PART === 'free') {
  // Two rungs 1.25 m apart (past a ladder's reach, a hop), each a beam with nothing behind it ('before': a wall behind both).
  if (BEFORE) box(p, [-8, 0, 2], [8, 7, 3]);
  box(p, [-8, 2.2, 1.7], [8, 2.4, 2]);
  box(p, [-8, 3.45, 1.7], [8, 3.65, 2]);
} else {
  // A beam 1.35 m over the floor (the duck goes under it), then a slab 0.6 m over it 3 m on (lain under, an opening).
  box(p, [-3, 1.35, 3], [3, 1.6, 3.3], false);
  box(p, [-3, 0.6, 6], [3, 0.9, 12], false);
}
p.stepOnce();
const world = p.world as unknown as LedgeWorld;

/** The frame's state: fields, so nothing crosses a call. */
class Run {
  b = new TestBody(p);
  li = new LedgeIn();
  stam = new Stamina(100);
  w = false;
  s = false;
  jump = false;
}
const st = new Run();
st.b.jka.forceLevel = 0;
st.li.scale = 1;
st.li.filter = st.b.filter;
st.li.pool = 100;
function hangFrame(): void {
  const s = st;
  const li = s.li;
  li.dt = 1 / 60;
  s.stam.value = 100;
  s.stam.tired = false;
  li.leftHeld = false;
  li.rightHeld = false;
  li.forwardHeld = s.w;
  li.backHeld = s.s;
  li.jumpPressed = s.jump;
  li.forwardPressed = false;
  li.crouchPressed = false;
  li.crouchHeld = false;
  li.viewYaw = s.b.ledge.heading;
  li.heading = s.b.ledge.heading;
  s.b.ledge.step(world, s.b, li, s.stam);
}
function hangs(n: number): void {
  for (let k = 0; k < n; k++) hangFrame();
}
function walkFrame(): void {
  st.b.frame(1 / 60);
}
function walks(n: number): void {
  for (let k = 0; k < n; k++) walkFrame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(hangs)');
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(walks)');

interface Part {
  bytes: number;
  frames: number;
  clean: boolean;
}
const meas: Part = { bytes: 0, frames: 0, clean: true };
let dirty = 0;
let made = 0;
let marks = 0;
/** `n` frames of `run` measured: no collection inside, the young generation's growth summed. */
async function measure(run: (n: number) => void, n: number): Promise<void> {
  // (The phase 3 fix round's: wall time for the optimising compiler, on a thread of its own, as ledgeAllocOwn.ts waits.)
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
  if (scavenges !== s0) {
    dirty++;
    return;
  }
  meas.bytes += y1 - y0;
  meas.frames += n;
}
/** The 'hang' part's state (`S3B_KIND`), said in the answer. */
let kindSaid = '';
const b = st.b;
let hanging = false;
if (PART === 'ladder' || PART === 'free') {
  b.place(0, 0, 0.9);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.run(60, 0.3);
  b.key('KeyE', true);
  b.key('Space', true);
  b.frame(1 / 60);
  b.key('Space', false);
  for (let i = 0; i < 240 && b.ledge.phase !== LEDGE_HANG; i++) b.frame(1 / 60);
  b.key('KeyE', false);
  hanging = b.ledge.phase === LEDGE_HANG;
}
const untilHang = (most: number) => {
  for (let i = 0; i < most && b.ledge.phase !== LEDGE_HANG; i++) hangFrame();
};

if (PART === 'ladder') {
  // Up four rungs and down four with the key held, measured in windows of 30 frames (the rungs' starts and ends among them,
  // the cycle's and the rung's alike: the comparison is the whole climb's frames).
  const climbOnce = async (up: boolean, measured: boolean) => {
    untilHang(240);
    st.w = up;
    st.s = !up;
    for (let w = 0; w < 10; w++) {
      if (measured) await measure(hangs, 30);
      else hangs(30);
    }
    st.w = false;
    st.s = false;
    hangs(60);
  };
  for (let k = 0; k < 6; k++) await climbOnce(k % 2 === 0, false);
  for (let k = 0; k < 8; k++) {
    await climbOnce(k % 2 === 0, true);
    made++;
  }
  marks = (b.ledge as unknown as { move: { cycle: boolean } }).move.cycle ? 1 : 0;
} else if (PART === 'free') {
  // A hop up and a drop down by the cue and Space, the frames inside each move measured (its start and end events).
  const once = async (up: boolean, measured: boolean) => {
    untilHang(240);
    st.w = up;
    st.s = !up;
    for (let i = 0; i < 120 && b.ledge.cue < 0.99; i++) hangFrame();
    st.jump = true;
    hangFrame();
    st.jump = false;
    st.w = false;
    st.s = false;
    if (b.ledge.phase !== LEDGE_MOVE) return;
    made++;
    if ((b.ledge as unknown as { move: { upper: boolean } }).move.upper) marks++;
    hangs(2);
    const m = b.ledge.move;
    const n = Math.floor((m.T - m.time) * 60) - 4;
    if (n < 20) return;
    if (measured) await measure(hangs, n);
    else hangs(n);
  };
  for (let k = 0; k < 30; k++) await once(k % 2 === 0, false);
  made = 0;
  marks = 0;
  for (let k = 0; k < 30; k++) await once(k % 2 === 0, true);
} else if (PART === 'hang') {
  // The review's: the hang's own hand-over of its clips to the rig (`driveHangClips`, the game's), in the states this round names
  // a clip in every frame of: a ladder's cycle put at its phase, a free hop's arms over the free legs put at the move's clock, an
  // arc's one-off put at its clock. Handed to a rig of the test's whose every method is a real call (kept out of the optimizer,
  // as the real rig's big methods are never built into the caller) and does nothing that makes anything: what the frame makes
  // is the hand-over's own (a clip's name made anew, a number handed across a call), which the real rig's own posing, two
  // kilobytes a frame here and moving with the clip played, would drown.
  const { driveHangClips } = await import('../../../src/player/hangClips.ts');
  /** The rig `driveHangClips` names, standing in: each method notes the name it was handed and counts (no number worked out:
   * code kept out of the optimizer makes every number it works out). */
  class StandRig {
    upperAt = 0.5;
    overrideSeekAt = 0.5;
    overrideRateAt = 0.5;
    timeAt = 0.5;
    last = '';
    calls = 0;
    setState(s: string, _a: number, upper: string | null, _f: unknown): void {
      this.last = upper ?? s;
      this.calls++;
    }
    blendOut(_t: number): void {
      this.calls++;
    }
    play(name: string, _o: unknown): number {
      this.last = name;
      return 1;
    }
    stopOverride(_t: number): void {
      this.calls++;
    }
    holdOverride(name: string, _l: number): void {
      this.last = name;
    }
    prefer(_s: string, name: string): void {
      this.last = name;
    }
    setTimeNow(name: string): void {
      this.last = name;
      this.calls++;
    }
    upperSeek(name: string): void {
      this.last = name;
      this.calls++;
    }
    overrideSeekNow(name: string): void {
      this.last = name;
      this.calls++;
    }
    overrideRateNow(): void {
      this.calls++;
    }
    update(_dt: number): void {
      this.calls++;
    }
  }
  for (const m of ['setState', 'blendOut', 'play', 'stopOverride', 'holdOverride', 'prefer', 'setTimeNow', 'upperSeek', 'overrideSeekNow', 'overrideRateNow', 'update']) {
    const fn = (StandRig.prototype as unknown as Record<string, unknown>)[m];
    // eslint-disable-next-line no-eval
    eval('(fn) => %NeverOptimizeFunction(fn)')(fn);
  }
  const F = { rig: new StandRig(), hang: { posePlaying: '', hangFade: { fade: 0.2 }, ladderRate: { rate: 1, fade: 0.2 } } };
  /** The ledge's fields `driveHangClips` reads, one class (so every state is the same shape, as the ledge is). */
  class HangL {
    blendNow = false;
    ended = false;
    stood = false;
    blendStand = false;
    startClip = '';
    startFrom = 0.5;
    startFade = 0.1;
    holding = true;
    poseClip = '';
    poseAt = 0.5;
    poseFadeNow(): number {
      return 0.1;
    }
    dropHold = false;
    dropId = '';
    rigState = 'hangBraced';
    rigClip = 'braced_hang_idle';
    rigUpper = '';
    rigRate = Number.NaN;
    rigSeek = Number.NaN;
    upperSeek = Number.NaN;
    moveSeek = Number.NaN;
    moveClip = '';
    moveRate = Number.NaN;
  }
  // One state a process (`S3B_KIND`): the ladder's cycle, the free hop's arms and an arc's move, each held to the plain hang's
  // hand-over ('plain', the 'before' processes), which names its loop's clip and nothing else.
  const kind = process.env.S3B_KIND ?? (BEFORE ? 'plain' : 'cycle');
  const L = new HangL();
  if (kind === 'cycle') {
    L.rigState = 'wallUp';
    L.rigClip = 'climbing_up_wall';
    L.rigSeek = 0.4;
    L.rigRate = 0;
  } else if (kind === 'arms') {
    L.rigState = 'hangFree';
    L.rigClip = 'free_hang_hanging_idle';
    L.rigUpper = 'braced_hang_hop_up';
    L.upperSeek = 0.5;
  } else if (kind === 'arc') {
    L.moveSeek = 0.2;
    L.moveClip = 'braced_hang_hop_right';
    L.moveRate = 0.7;
  }  const drive = (): void => {
    driveHangClips(F.rig, L as never, 1 / 60, F.hang);
    // (The seeks moved on a little each frame, as a move's clock does: the ladder's phase round its cycle, the others on.)
    L.rigSeek = L.rigSeek === L.rigSeek ? (L.rigSeek + 0.01) % 1 : L.rigSeek;
    L.upperSeek = L.upperSeek === L.upperSeek ? L.upperSeek + 1e-5 : L.upperSeek;
    L.moveSeek = L.moveSeek === L.moveSeek ? L.moveSeek + 1e-5 : L.moveSeek;
  };
  const drives = (n: number): void => {
    for (let k = 0; k < n; k++) drive();
  };
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(drives)');
  drives(8000);
  for (let w = 0; w < 24; w++) {
    await measure(drives, 300);
    made++;
  }
  kindSaid = kind;
  marks = kind === 'cycle' || kind === 'arms' || kind === 'arc' ? 1 : 0;
  hanging = true;
} else {
  // Walking on under the beam and the slab, back and forth, in windows of 30 frames.
  const once = async (forward: boolean, measured: boolean) => {
    b.place(0, 0, forward ? 0.5 : 11);
    b.forward.set(0, 0, forward ? 1 : -1);
    b.right.set(forward ? -1 : 1, 0, 0);
    b.heading = forward ? 0 : Math.PI;
    b.key('KeyW', true);
    for (let w = 0; w < 12; w++) {
      if (measured) await measure(walks, 30);
      else walks(30);
      if (b.prone) marks++;
    }
    b.key('KeyW', false);
    walks(30);
    made++;
  };
  for (let k = 0; k < 4; k++) await once(k % 2 === 0, false);
  made = 0;
  marks = 0;
  for (let k = 0; k < 8; k++) await once(k % 2 === 0, true);
  hanging = true;
}
meas.clean = dirty <= Math.max(4, meas.frames / 120) && meas.frames > 0;
console.log(JSON.stringify({ part: PART, before: BEFORE, hanging, made, marks, dirty, meas, kind: kindSaid }));
