// Climbing II, Smoothness III, item 4b (`climb.ladderCycle` 'cycle'), on the game's own rig (tools/swg/tests/climbFigure.ts's
// figure, the game's own hang hand-over `driveHangClips` and the ledge's own limbs), driven frame by frame through the grapple's
// harness on the real Rapier and the course's ladders (a braced one at 1 m and at 0.75 m, a free one at 1 m), up five rungs with
// W held and down again with S held, at 30, 60, 144 and 240 frames a second:
//  - rung by rung, the hands alternating (one reaches, then the other, never the same twice);
//  - every landing within 2 cm of its rung: the reaching hand, wholly placed between two rungs, on its place on the lip (the
//    lip's grip line, the course's own lip) and the drawn hand on it;
//  - no hand teleports: frame by frame each drawn hand moves in the world no more than `poseJump` times what the clip's own hand
//    moves at its own rate (its fastest over the clip, measured on a figure of its own) and the body's own travel that frame;
//  - no freeze: while the key is held the cycle's phase never stands still more than a frame between the first rung and the last;
//  - the cycle's phase driven by distance at a pace within `ladderStretch` of the clip's own rate.
//
// Run: node tools/swg/tests/smooth3Ladder.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { figure, figureScale, drawHang, FIGURE_CLIPS, HAVE_BODY, type Figure } from './climbFigure.ts';

const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { CLIMB_TUNE, resetClimbTune } = await import('../../../src/anim/climbTune.ts');
const { resetMoveTune } = await import('../../../src/anim/moveTune.ts');
const { WALL_CLIPS, WALL_CLIP_NAMES } = await import('../../../src/anim/wallClips.ts');
const { LEDGE_HANG, LEDGE_MOVE } = await import('../../../src/player/ledge.ts');
const { bodyAt, nearestLip, runUntil, standPiece, tap } = await import('./climbCourseBody.ts');
type TestBody = import('./grappleBody.ts').TestBody;
type Stood = import('./climbCourseBody.ts').Stood;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const RUNGS = 5;
const piece = (id: string) => climbCourse({ extras: true, pieces: [id] }).pieces[0];
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
const nameOf = (s: Stood, b: TestBody) => (b.ledge.holding ? nearestLip(s, b.ledge.lip.ex, b.ledge.lip.ey, b.ledge.lip.ez).name : '-');
const G = new THREE.Vector3();

if (!HAVE_BODY) note('no converted human male here: the figure is the tests\' own skeleton');

/** The fastest either hand's grip moves when the clip plays alone at its own rate on a figure of its own, m/s. */
function ownHandSpeed(clipId: string): number {
  const F = figure();
  const name = WALL_CLIP_NAMES[clipId];
  const clip = FIGURE_CLIPS.find((c) => c.name === name);
  assert.ok(clip, `the pack fits ${name}`);
  const mixer = F.rig.mixer as THREE.AnimationMixer;
  mixer.stopAllAction();
  const a = mixer.clipAction(clip!);
  a.play();
  a.setEffectiveWeight(1);
  const h = 1 / 240;
  const prev = [new THREE.Vector3(), new THREE.Vector3()];
  let best = 0;
  for (let t = 0; t <= clip!.duration + 1e-9; t += h) {
    a.time = t;
    mixer.update(0);
    F.group.updateMatrixWorld(true);
    for (let s = 0; s < 2; s++) {
      const g = F.lp.gripNow(F.rig as never, s, null, G);
      if (!g) continue;
      if (t > 0) best = Math.max(best, prev[s].distanceTo(g) / h);
      prev[s].copy(g);
    }
  }
  return best;
}
const OWN = { up: ownHandSpeed(WALL_CLIPS.up), down: ownHandSpeed(WALL_CLIPS.down) };
note(`the wall clips' own fastest hand: up ${OWN.up.toFixed(2)} m/s, down ${OWN.down.toFixed(2)} m/s`);

interface Climb {
  seen: string[];
  reaches: number[];
  landWorst: number;
  landOnLip: number;
  landings: number;
  jump: number;
  where: string;
  freeze: number;
  rateLo: number;
  rateHi: number;
}

/** One way up or down the ladder with the key held, the figure drawn every frame. */
function climb(s: Stood, b: TestBody, F: Figure, fps: number, key: 'KeyW' | 'KeyS'): Climb {
  const L = b.ledge;
  const dt = 1 / fps;
  const own = key === 'KeyW' ? OWN.up : OWN.down;
  const C: Climb = { seen: [nameOf(s, b)], reaches: [], landWorst: 0, landOnLip: 0, landings: 0, jump: 0, where: '', freeze: 0, rateLo: Number.POSITIVE_INFINITY, rateHi: 0 };
  const prev = [new THREE.Vector3(), new THREE.Vector3()];
  const was = new THREE.Vector3().copy(b.pos);
  let have = false;
  let lastReach = -1;
  let lastPhase = Number.NaN;
  let still = 0;
  let begun = false;
  const line = Math.hypot(CLIMB_TUNE.gripOut, CLIMB_TUNE.gripDrop) * b.ledgeScale;
  const lx = L as unknown as { cycWait: boolean; cycHand: number; move: { kind: string; cycle: boolean; reach: number; phSpan: number; T: number; t0: number }; rigSeek: number; upperSeek: number };
  const hold = b.frame.bind(b);
  b.frame = (t: number) => {
    hold(t);
    if (!L.holding) {
      have = false;
      return;
    }
    const m = lx.move;
    const moving = L.phase === LEDGE_MOVE && m.kind === 'ladder' && m.cycle;
    if (moving && m.reach >= 0 && m.reach !== lastReach) {
      C.reaches.push(m.reach);
      lastReach = m.reach;
      const span = m.T - m.t0;
      if (span > 1e-6) {
        const r = m.phSpan / span;
        C.rateLo = Math.min(C.rateLo, r);
        C.rateHi = Math.max(C.rateHi, r);
      }
      begun = true;
    }
    if (!moving) lastReach = -1;
    // The cycle's phase drawn this frame (the braced ladder's clip, the free one's arms).
    const phase = lx.rigSeek === lx.rigSeek ? lx.rigSeek : lx.upperSeek;
    if (begun && C.seen.length <= RUNGS && phase === phase) {
      if (phase === lastPhase) still++;
      else still = 0;
      C.freeze = Math.max(C.freeze, still);
    }
    lastPhase = phase;
    const travel = was.distanceTo(b.pos);
    for (let side = 0; side < 2; side++) {
      const g = F.lp.gripNow(F.rig as never, side, null, G);
      if (!g) continue;
      if (have) {
        const moved = prev[side].distanceTo(g);
        const r = moved / (own * dt + travel + 1e-4);
        if (r > C.jump) {
          C.jump = r;
          C.where = `${side ? 'right' : 'left'} hand ${(moved * 100).toFixed(2)} cm in a frame, ${moving ? `reaching ${m.reach}` : lx.cycWait ? 'between rungs' : 'hanging'}`;
        }
      }
      prev[side].copy(g);
      if (lx.cycWait && side === lx.cycHand && F.lp.handW[side] >= 0.999) {
        const tx = F.lp.hand[side * 3];
        const ty = F.lp.hand[side * 3 + 1];
        const tz = F.lp.hand[side * 3 + 2];
        C.landWorst = Math.max(C.landWorst, Math.hypot(g.x - tx, g.y - ty, g.z - tz));
        C.landOnLip = Math.max(C.landOnLip, Math.abs(nearestLip(s, tx, ty, tz).off - line));
        C.landings++;
      }
    }
    have = true;
    was.copy(b.pos);
    const n = nameOf(s, b);
    if (n !== C.seen[C.seen.length - 1] && hangs(b)) C.seen.push(n);
  };
  b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
  b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
  b.key(key, true);
  runUntil(b, fps, RUNGS * 2.5, () => C.seen.length > RUNGS || !L.holding);
  b.key(key, false);
  runUntil(b, fps, 0.6, () => false);
  b.frame = hold;
  return C;
}

for (const id of ['ladder-1', 'ladder-0.75', 'free-ladder-1']) {
  for (const fps of RATES) {
    resetClimbTune();
    resetMoveTune();
    const s = await standPiece(piece(id));
    const { b } = bodyAt(s, 'stand', fps);
    const F = figure();
    b.ledgeScale = figureScale(F);
    // (The figure drawn every frame it holds from the grab on, the player's hang frame; climb measures over it.)
    const draw = b.frame.bind(b);
    b.frame = (t: number) => {
      draw(t);
      if (b.ledge.holding) drawHang(b, F, 1 / fps);
    };
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2.5, () => hangs(b));
    b.key('KeyE', false);
    ok(hangs(b), `${id} @${fps}: grabbed its first rung`);
    for (const key of ['KeyW', 'KeyS'] as const) {
      const C = climb(s, b, F, fps, key);
      const words = `${id} @${fps} ${key === 'KeyW' ? 'up' : 'down'}`;
      ok(C.seen.length === RUNGS + 1, `${words}: rung by rung (${C.seen.join('>')})`);
      ok(C.reaches.length >= RUNGS && C.reaches.every((r, i) => i === 0 || r !== C.reaches[i - 1]), `${words}: the hands alternate (${C.reaches.join('')})`);
      ok(C.landings > 0 && C.landWorst <= 0.02 && C.landOnLip <= 0.02, `${words}: every landing within 2 cm of its rung (the drawn hand ${(C.landWorst * 100).toFixed(2)} cm off its place, its place ${(C.landOnLip * 100).toFixed(2)} cm off the lip; ${C.landings} hand-frames)`);
      ok(C.jump <= CLIMB_TUNE.poseJump, `${words}: no hand teleports (worst ${C.jump.toFixed(2)} times the clip's own and the body's travel, under ${CLIMB_TUNE.poseJump}; ${C.where})`);
      ok(C.freeze <= 1, `${words}: no freeze while the key is held (${C.freeze} frames still at most)`);
      const T = CLIMB_TUNE.ladderStretch;
      ok(C.rateLo >= 1 - T - 1e-9 && C.rateHi <= 1 + T + 1e-9, `${words}: the cycle's pace within ${T} of the clip's own (${C.rateLo.toFixed(3)} to ${C.rateHi.toFixed(3)})`);
    }
    b.physics.world.removeRigidBody(b.body);
  }
}
// ---- item 4 (`climb.freeHops` 'on'): a free hang's hop up a rung on its own move and its drop back, at four rates --------------
// (The free ladder's rungs 1.25 m apart, past a ladder's reach: a hop. Its move is braced_hang_hop_up's arms over the free hang's
// own legs, timed by the arc; the drop is maker A's own move. Off: a free hang finds no way up at all, as before.)
for (const fps of RATES) {
  for (const freeHops of ['on', 'off'] as const) {
    resetClimbTune();
    resetMoveTune();
    const { tuneClimb } = await import('../../../src/anim/climbTune.ts');
    tuneClimb({ freeHops });
    const s = await standPiece(piece('free-ladder-1.25'));
    const { b } = bodyAt(s, 'stand', fps);
    const F = figure();
    b.ledgeScale = figureScale(F);
    const L = b.ledge;
    const lx = L as unknown as { move: { upper: boolean; arc: boolean; fly: number; F: number; kind: string; id: string } };
    let touch = Number.POSITIVE_INFINITY;
    let touchW = 0;
    let seen = false;
    let upper = false;
    let dropped = false;
    const line = Math.hypot(CLIMB_TUNE.gripOut, CLIMB_TUNE.gripDrop) * b.ledgeScale;
    const draw = b.frame.bind(b);
    b.frame = (t: number) => {
      draw(t);
      if (!L.holding) return;
      drawHang(b, F, 1 / fps);
      const m = lx.move;
      if (L.phase === LEDGE_MOVE && m.upper) upper = true;
      if (L.phase === LEDGE_MOVE && m.kind === 'hop' && /drop/.test(m.id)) dropped = true;
      if (!seen && L.phase === LEDGE_MOVE && m.upper && m.arc && m.fly >= m.F) {
        seen = true;
        for (let k = 0; k < 2; k++) {
          const g = F.lp.gripNow(F.rig as never, k, null, G);
          if (!g) continue;
          const tx = F.lp.hand[k * 3];
          const ty = F.lp.hand[k * 3 + 1];
          const tz = F.lp.hand[k * 3 + 2];
          const off = Math.max(Math.hypot(g.x - tx, g.y - ty, g.z - tz), Math.abs(nearestLip(s, tx, ty, tz).off - line));
          if (off < touch) {
            touch = off;
            touchW = F.lp.handW[k];
          }
        }
      }
    };
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2.5, () => hangs(b));
    b.key('KeyE', false);
    runUntil(b, fps, 0.6, () => false);
    b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
    b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
    b.key('KeyW', true);
    runUntil(b, fps, 2, () => L.cue >= 0.99);
    const cued = L.cue >= 0.99;
    // (Space only on a cue: with nothing cued it is the hang's own push off, which lets go.)
    if (cued) tap(b, 'Space', fps);
    b.key('KeyW', false);
    runUntil(b, fps, 4, () => hangs(b) && nameOf(s, b) !== 'R0');
    const up = nameOf(s, b);
    const words = `free-ladder-1.25 @${fps}, freeHops ${freeHops}`;
    if (freeHops === 'off') {
      ok(!cued && up === 'R0' && !upper, `${words}: a free hang finds no way up, as before (${up})`);
      b.physics.world.removeRigidBody(b.body);
      continue;
    }
    ok(cued && up === 'R1' && upper, `${words}: W cues the hop up, Space hops R0 to R1 on the free hop's own move (braced_hang_hop_up's arms over the free hang's legs; ${up})`);
    ok(seen && touch <= 0.02 && touchW >= 0.99, `${words}: the leading hand wholly placed and within 2 cm of R1 in the frame the body arrives (${(touch * 100).toFixed(2)} cm)`);
    runUntil(b, fps, 0.6, () => false);
    b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
    b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
    b.key('KeyS', true);
    runUntil(b, fps, 2, () => L.cue >= 0.99);
    tap(b, 'Space', fps);
    b.key('KeyS', false);
    runUntil(b, fps, 4, () => hangs(b) && nameOf(s, b) === 'R0');
    ok(nameOf(s, b) === 'R0' && dropped, `${words}: S and Space drop back to R0 on the drop's own move (${nameOf(s, b)})`);
    b.physics.world.removeRigidBody(b.body);
  }
}
console.log(`smooth3Ladder: ${checks} checks passed`);
