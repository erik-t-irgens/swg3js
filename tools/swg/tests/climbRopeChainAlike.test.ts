// The rope chain round's fixer (the review's two finds): a held rope's chain alike at every frame rate, and a chain that holds
// still while play stands still.
//  - The held session (phase 4's: run off the edge, E at the rope, a still hang, a climb, a pumped swing, let alone, D, a climb
//    down, pumped again, Space letting go, tools/swg/tests/climbRopeChainBody.ts) through the game's own movement and climbing on
//    real Rapier at 30, 144 and 240 frames a second. Every frame the swing took steps, the chain's pin stands at the swing's grip
//    after its last step to the bit (each of the chain's steps is pinned on that very step of the swing's: its record,
//    `HangingRope.swingRec`). And each session's own frames replayed, step by step, into chains of their own that take the very
//    same steps grouped into frames of one, two and four (as 60, 30 and 15 frames a second would group them; a frame never mixes
//    steps the swing took with steps it did not, as no frame of the game's does): every one is the session's own chain to the bit
//    at every frame's end. So a still hang, a climb, a pumped swing and a let-go are alike at 30 and 240 frames a second within
//    nought, for one swing; the sessions at 30 and 240 themselves differ by the gameplay's own run (the run-up's movement is
//    stepped by the frame, so the grab, and from it the whole swing, falls elsewhere), which is printed, not held.
//  - Play stood still (a panel, the map, the menu: the frame loop steps the physics and draws the ropes, and runs no update): the
//    chain is laid at the very points the last frame laid, at 144 frames a second, a free rope and a held one alike.
//
// Run: node tools/swg/tests/climbRopeChainAlike.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetClimbTune } from '../../../src/anim/climbTune.ts';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { RopeChains, ROPE_FREE_GIVE } from '../../../src/player/ropeChain.ts';
import { HangingRope, SWING_REC } from '../../../src/player/hangingRope.ts';
import { SLAB_LIFT, bodyAt, standPiece } from './climbCourseBody.ts';
import { chainSession } from './climbRopeChainBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// The chain lets its give back on a step no swing records exactly as a free rope lets its own back.
{
  const rope = readFileSync(new URL('../../../src/player/hangingRope.ts', import.meta.url), 'utf8');
  ok(ROPE_FREE_GIVE === 0.9 && /this\.e \*= 0\.9;/.test(rope), `the chain lets its give back by ${ROPE_FREE_GIVE} a step, a free rope's own (src/player/hangingRope.ts's \`stepFree\`)`);
}

/** One frame of a session as the chains were handed it: its steps, the swing's record, the hands held at its end. */
type Frame = { n: number; rec: number; st: Float64Array; held: boolean };
/** A step of a session: the swing's (its record's states before and after it) or not, and whether the rope is held after it. */
type Step = { recd: boolean; from: Float64Array | null; to: Float64Array | null; heldAfter: boolean };

const sessions = new Map<number, { frames: Frame[]; kept: Map<number, Float64Array>; ax: number; ay: number; az: number; own: number; e0: number; pinMiss: number; pinFrames: number; grips: Map<number, number[]> }>();
for (const fps of [30, 144, 240]) {
  resetClimbTune();
  const frames: Frame[] = [];
  const kept = new Map<number, Float64Array>();
  const grips = new Map<number, number[]>();
  let total = 0;
  let pinMiss = 0;
  let pinFrames = 0;
  let pending: Frame | null = null;
  let ax = 0;
  let ay = 0;
  let az = 0;
  let own = 0;
  let e0 = Number.NaN;
  await chainSession(
    'held',
    fps,
    (b, r) => {
      const f = pending!;
      pending = null;
      const c = r.chain!;
      total += f.n;
      if (f.n > 0) {
        const p = new Float64Array(3 * c.n);
        for (let i = 0; i < c.n; i++) {
          p[3 * i] = c.px[i];
          p[3 * i + 1] = c.py[i];
          p[3 * i + 2] = c.pz[i];
        }
        kept.set(total, p);
      }
      if (f.rec >= 1 && f.n > 0 && r.held) {
        // The pin at the swing's grip after its last step (the swing wrote it into the rope as it ended the frame), to the bit.
        pinFrames++;
        const g = r.gripS + r.e;
        const s = Math.sin(r.th);
        if (!(c.pinOn && c.pinX === r.ax + g * s * r.fx && c.pinY === r.ay - g * Math.cos(r.th) && c.pinZ === r.az + g * s * r.fz && c.pinS === g)) pinMiss++;
        grips.set(total, [r.ax + g * s * r.fx, r.ay - g * Math.cos(r.th), r.az + g * s * r.fz]);
      }
    },
    null,
    (b, r) => {
      const C = (b as unknown as { ropeChains: RopeChains }).ropeChains;
      if (e0 !== e0) {
        ax = r.ax;
        ay = r.ay;
        az = r.az;
        own = r.own;
        e0 = r.e;
      }
      pending = { n: C.steps, rec: r.swingSteps, st: new Float64Array(r.swingRec), held: r.held };
      frames.push(pending);
    },
  );
  sessions.set(fps, { frames, kept, ax, ay, az, own, e0, pinMiss, pinFrames, grips });
  ok(pinFrames > 100 && pinMiss === 0, `${fps} fps, the held session: every frame the swing stepped, the chain's pin stands at the swing's grip after its last step to the bit (${pinFrames} frames, ${pinMiss} missed)`);
}

/** A session's frames as steps (a frame's steps the swing's where its record holds them all; the rope held after a frame's last step as the frame left it, after the others as its steps say). */
function stepsOf(frames: Frame[]): { steps: Step[]; heldAt: Map<number, boolean> } {
  const steps: Step[] = [];
  // (A frame of no steps moves the rope's hold alone: kept by the step count it stands after.)
  const heldAt = new Map<number, boolean>();
  for (const f of frames) {
    const recd = f.rec >= 1 && f.rec >= f.n;
    for (let i = 1; i <= f.n; i++) {
      steps.push({
        recd,
        from: recd ? f.st.slice(SWING_REC * (i - 1), SWING_REC * i) : null,
        to: recd ? f.st.slice(SWING_REC * i, SWING_REC * (i + 1)) : null,
        heldAfter: i === f.n ? f.held : recd,
      });
    }
    if (f.n === 0) heldAt.set(steps.length, f.held);
  }
  return { steps, heldAt };
}

/** The steps replayed into a chain of their own in frames of at most `K` (a frame never mixing the swing's steps with others, nor a swing's step that does not begin where the last ended); its points held to the session's at every frame's end: the largest difference, metres. */
function replay(s: ReturnType<typeof sessions.get> & object, K: number): { worst: number; compared: number; frames: number } {
  const { steps, heldAt } = stepsOf(s.frames);
  const r = new HangingRope('copy', s.ax, s.ay, s.az, s.own);
  r.e = s.e0;
  const C = new RopeChains();
  // (The session's own world and its queries: a chain made fresh beside the session's, laid on the rope's line as it was.)
  C.world = world;
  C.ray = ray;
  C.box = box;
  C.filter = filter;
  C.ground = ground;
  C.steps = 0;
  C.frame([r]);
  let worst = 0;
  let compared = 0;
  let made = 0;
  let at = 0;
  let held = false;
  const group: Step[] = [];
  const flush = () => {
    r.held = held;
    if (group.length > 0 && group[0].recd) {
      r.swingRec.set(group[0].from!, 0);
      for (let i = 0; i < group.length; i++) r.swingRec.set(group[i].to!, SWING_REC * (i + 1));
      r.swingSteps = group.length;
    } else r.swingSteps = -1;
    C.steps = group.length;
    C.frame([r]);
    at += group.length;
    made++;
    // (Compared where the session's own frames ended too: a frame of the session's split in two ends where none of the session's did.)
    const ref = s.kept.get(at);
    if (group.length > 0 && ref) {
      const c = r.chain!;
      for (let i = 0; i < c.n; i++) worst = Math.max(worst, Math.abs(c.px[i] - ref[3 * i]), Math.abs(c.py[i] - ref[3 * i + 1]), Math.abs(c.pz[i] - ref[3 * i + 2]));
      compared++;
    }
    group.length = 0;
  };
  const same = (a: Float64Array, z: Float64Array) => a.every((v, i) => v === z[i]);
  if (heldAt.has(0)) held = heldAt.get(0)!;
  for (let j = 0; j < steps.length; j++) {
    const st = steps[j];
    if (group.length > 0) {
      const last = group[group.length - 1];
      if (group.length >= K || last.recd !== st.recd || (st.recd && !same(last.to!, st.from!))) flush();
    }
    group.push(st);
    held = st.heldAfter;
    const h = heldAt.get(j + 1);
    if (h !== undefined) {
      // A frame of no steps between: a change of hold that a real frame would have ended on.
      if (h !== held) {
        flush();
        held = h;
        flush();
      }
      held = h;
    }
  }
  if (group.length > 0) flush();
  return { worst, compared, frames: made };
}

// The session's world, its queries and its ground for the copies (as the harness makes them).
const piece = climbCourse({ pieces: ['rope'] }).pieces[0];
const stood = await standPiece(piece);
const { b: wb } = bodyAt(stood, 'run', 60);
const wc = (wb as unknown as { ropeChains: RopeChains }).ropeChains;
const world = wc.world;
const ray = wc.ray;
const box = wc.box;
const filter = wc.filter;
const ground = { at: (q: { h: number }) => ((q.h = -SLAB_LIFT), true) };

for (const [fps, s] of sessions) {
  for (const K of [1, 2, 4]) {
    const out = replay(s, K);
    ok(out.compared > 100 && out.worst === 0, `${fps} fps, the held session's steps replayed in frames of up to ${K}: the chain is the session's own to the bit at every frame's end (${out.compared} frames compared of ${out.frames}, the largest difference ${out.worst} m)`);
  }
}

// The sessions themselves, 30 and 144 against 240: the gameplay's own run (printed, not held).
{
  const z = sessions.get(240)!;
  for (const fps of [30, 144]) {
    const s = sessions.get(fps)!;
    let grip = 0;
    let chain = 0;
    for (const [k, p] of s.kept) {
      const q = z.kept.get(k);
      if (!q) continue;
      for (let i = 0; i < p.length; i += 3) chain = Math.max(chain, Math.hypot(p[i] - q[i], p[i + 1] - q[i + 1], p[i + 2] - q[i + 2]));
      const a = s.grips.get(k);
      const c = z.grips.get(k);
      if (a && c) grip = Math.max(grip, Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]));
    }
    console.log(`     ${fps} against 240 frames a second, the sessions themselves (the gameplay's own run: its run-up is stepped by the frame): the swing's grip at most ${(grip * 1000).toFixed(1)} mm apart at the same step, the chain's points at most ${(chain * 1000).toFixed(1)} mm`);
  }
}

// Play stood still: the frame loop steps the physics and draws the ropes, no update runs (nothing writes the chains' steps).
for (const held of [false, true]) {
  resetClimbTune();
  const fps = 144;
  const s = await standPiece(piece);
  const { b } = bodyAt(s, 'run', fps);
  b.rope.ropes = s.ropes;
  (b as unknown as { chainGroundAt: () => number }).chainGroundAt = () => -SLAB_LIFT;
  const r = s.ropes[0];
  r.th = 0.6;
  r.om = 0;
  r.thDraw = 0.6;
  r.lay();
  const C = (b as unknown as { ropeChains: RopeChains }).ropeChains;
  C.steps = 0;
  b.drawRopes();
  // A swing to watch: free from 0.6 rad, or (held) a swing of its own scripted on the steps, its record written as the swing writes it.
  let k = 0;
  const swingRec = (n: number) => {
    const at = (j: number, o: number) => {
      const t = j / 60;
      r.swingRec[o] = 0.5 * Math.sin(1.4 * t);
      r.swingRec[o + 1] = 0.7 * Math.cos(1.4 * t);
      r.swingRec[o + 2] = 3;
      r.swingRec[o + 3] = 0.05;
      r.swingRec[o + 4] = 0;
      r.swingRec[o + 5] = 1;
    };
    at(k, 0);
    for (let i = 1; i <= n; i++) at(k + i, SWING_REC * i);
    k += n;
    r.swingSteps = n;
    r.th = r.swingRec[SWING_REC * n];
    r.om = r.swingRec[SWING_REC * n + 1];
    r.gripS = 3;
    r.e = 0.05;
    r.thDraw = r.th;
    r.held = true;
    r.lay();
  };
  for (let i = 0; i < 2 * fps; i++) {
    if (held) {
      // (The harness's own frame steps the free swing and the physics; the held swing is scripted in its place.)
      const n = b.physics.stepsAhead(1 / fps);
      C.steps = n;
      swingRec(n);
      b.physics.step(1 / fps);
    } else b.frame(1 / fps);
    b.drawRopes();
  }
  const c = r.chain!;
  const was = Array.from(c.draw.subarray(0, 3 * c.drawCount));
  let moved = 0;
  let most = 0;
  for (let i = 0; i < fps; i++) {
    b.physics.step(1 / fps);
    b.drawRopes();
    let d = c.drawCount === was.length / 3 ? 0 : Infinity;
    for (let j = 0; j < was.length && d === 0; j++) d = Math.max(d, Math.abs(c.draw[j] - was[j]));
    if (d > 0) moved++;
    most = Math.max(most, d);
  }
  ok(moved === 0, `${held ? 'a held rope' : 'a free rope'} at ${fps} frames a second, play stood still a second (the physics stepped, the ropes drawn, no update): the chain is laid at the very points every frame (${moved} frames moved, at most ${(most * 1000).toFixed(3)} mm)`);
  // And the next frame that runs an update lays it at that frame's own time again.
  if (held) {
    const n = b.physics.stepsAhead(1 / fps);
    C.steps = n;
    swingRec(n);
  } else {
    b.frame(1 / fps);
    b.frame(1 / fps);
  }
  b.physics.step(1 / fps);
  b.drawRopes();
  let d = 0;
  for (let j = 0; j < was.length; j++) d = Math.max(d, Math.abs(c.draw[j] - was[j]));
  ok(d > 1e-6, `... and play going on, it moves on again (${(d * 1000).toFixed(2)} mm)`);
}

resetClimbTune();
console.log(`climbRopeChainAlike: ${checks} checks passed`);
