// Climbing II, Smoothness II, item 7 (`climb.camera` 'eased'; the owner: "my camera can snap around and jump quickly in some
// movements while climbing or shimmying around corners"): the follow the chase camera is handed while a climb holds the body
// (src/player/climbCam.ts, `ClimbCamFollow`), and the orbit's wall pull-in let out eased (`ThirdPersonCamera.blockOut`), with
// the game's own camera (src/core/camera.ts) placed frame by frame from it:
//  - the follow alone: the critically damped step is exact over a frame, so a target moved at the same moments ends the same
//    at 30, 60, 144 and 240 frames a second;
//  - through the game's own climbing (the grapple's harness on the real Rapier, the course's pieces): round an outer and an
//    inner corner, a bend, a curve, a hop sideways (its leave and its landing) and a climb up onto the top, the camera's place
//    each frame never moves more than `camJump` times what it moved the frame before (a spike is a snap; a still camera is
//    allowed a start of `START` m/s), at every rate; and the same drives followed raw (the body's own place, 'before') do snap,
//    so the measure tells them apart;
//  - a wall's pull-in at once and its letting out eased over `camOut`; nought, the orbit as it always was;
//  - the game's hand-overs (the frame steps the follow and hands the camera its letting-out before the orbit is placed) as text.
//
// Run: node tools/swg/tests/smooth2Cam.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ClimbCamFollow } from '../../../src/player/climbCam.ts';
import { ThirdPersonCamera } from '../../../src/core/camera.ts';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { CLIMB_TUNE, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { resetMoveTune } from '../../../src/anim/moveTune.ts';
import { LEDGE_HANG } from '../../../src/player/ledge.ts';
import type { TestBody } from './grappleBody.ts';
import { bodyAt, runUntil, shimmy, standPiece, tap } from './climbCourseBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const RATES = [30, 60, 144, 240] as const;
const piece = (id: string) => climbCourse({ pieces: [id] }).pieces[0];
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
/** A still camera may start moving at this pace in a frame without that being a snap, m/s (the measure's floor). */
const START = 0.5;
/**
 * A snap: one frame of the camera taking more than this share of a change in the body's own velocity (the largest over the
 * follow's own settle, four of its time constants). Followed raw the camera takes all of it in a frame (1); eased, a share over the follow's own frames. A
 * measure, no number of feel.
 */
const SNAP_SHARE = 0.5;
const input = { locked: false, mouseDX: 0, mouseDY: 0, wheel: 0 } as never;

resetClimbTune();
resetMoveTune();
ok(CLIMB_TUNE.camera === 'eased', 'the round ships the climbing camera eased');

// ---- 1. the follow alone: the same at every rate ----------------------------------------------------------------------------
{
  const ends: number[] = [];
  for (const fps of RATES) {
    const F = new ClimbCamFollow();
    const dt = 1 / fps;
    let x = 0;
    F.step(0, 0, 0, dt, true, CLIMB_TUNE.camEase, 0, 0, 0);
    // The target jumps a metre at a sixth of a second and back at a third (moments every rate's frames end on).
    const n = Math.round(0.5 * fps);
    for (let k = 1; k <= n; k++) {
      const t = k * dt;
      const tx = t > 1 / 6 + 1e-9 && t <= 1 / 3 + 1e-9 ? 1 : 0;
      F.step(tx, 0, 0, dt, true, CLIMB_TUNE.camEase, 0, 0, 0);
      x = F.x;
    }
    ends.push(x);
  }
  // (The target is held over each frame: a jump between two frames' ends is taken at the later end, so the rates differ by
  // where inside a frame it fell; at these moments every rate's frame ends on it.)
  const spread = Math.max(...ends) - Math.min(...ends);
  ok(spread < 1e-9, `the follow is the spring's exact answer over each frame: the same place at every rate (${ends.map((v) => v.toFixed(9)).join(', ')})`);
  const F = new ClimbCamFollow();
  ok(!F.step(1, 2, 3, 1 / 60, false, 0.12, 0, 0, 0) && !F.on, 'nothing climbing and nothing to catch: the follow is off and the body is followed');
  F.step(0, 0, 0, 1 / 60, true, 0.12, 0, 0, 0);
  let k = 0;
  while (F.step(0, 0, 0, 1 / 60, false, 0.12, 0, 0, 0) && k < 1000) k++;
  ok(!F.on && k < 5, `a climb let go of with the follow on the body: handed back at once (${k} frames)`);
  F.reset();
  F.step(0, 0, 0, 1 / 60, true, 0.12, 0, 0, 0);
  k = 0;
  while (F.step(2, 0, 0, 1 / 60, false, 0.12, 0, 0, 0) && k < 1000) k++;
  ok(!F.on && k > 10 && k < 120, `a climb let go of with the body two metres off: followed until caught, then handed back (${k} frames)`);
}

// ---- 2. the camera through the game's climbing --------------------------------------------------------------------------------
/** The camera's place each frame from a followed point (the orbit at a fixed yaw, pitch and distance, nothing in the way). */
function cameraOf(cam: ThirdPersonCamera, p: THREE.Vector3, dt: number): THREE.Vector3 {
  cam.update(input, p, null, dt);
  return cam.camera.position;
}
interface Drive {
  name: string;
  run: (b: TestBody, s: Awaited<ReturnType<typeof standPiece>>, w: ReturnType<typeof bodyAt>['w'], fps: number) => void;
  piece: string;
  start: string;
}
const DRIVES: Drive[] = [
  { name: 'round an outer corner', piece: 'corner-outer-90', start: 'stand', run: (b, s, w, fps) => shimmy(s, b, w, 'KeyD', fps) },
  { name: 'round an inner corner', piece: 'corner-inner-90', start: 'stand', run: (b, s, w, fps) => shimmy(s, b, w, 'KeyD', fps) },
  { name: 'round a bend of 60', piece: 'bend-outer-60', start: 'stand', run: (b, s, w, fps) => shimmy(s, b, w, 'KeyD', fps) },
  { name: 'along a curve', piece: 'curve-outer-3m', start: 'stand', run: (b, s, w, fps) => shimmy(s, b, w, 'KeyD', fps) },
  {
    name: 'a hop sideways',
    piece: 'gap-side-1.5',
    start: 'onA',
    run: (b, s, w, fps) => {
      shimmy(s, b, w, 'KeyD', fps);
      b.key('KeyD', true);
      tap(b, 'Space', fps);
      b.key('KeyD', false);
      let left = false;
      runUntil(b, fps, 3, () => {
        if (!hangs(b)) left = true;
        return left && hangs(b);
      });
      runUntil(b, fps, 0.5, () => false);
    },
  },
  {
    name: 'a climb up onto the top',
    piece: 'lip-braced-2.4',
    start: 'stand',
    run: (b, _s, _w, fps) => {
      b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
      b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
      tap(b, 'KeyW', fps);
      runUntil(b, fps, 3, () => !b.ledge.holding);
      runUntil(b, fps, 1, () => false);
    },
  },
];
for (const d of DRIVES) {
  const s = await standPiece(piece(d.piece));
  for (const fps of RATES) {
    let worstEased = 0;
    let worstRaw = 0;
    let shareEased = 0;
    let shareRaw = 0;
    for (const eased of [true, false]) {
      resetClimbTune();
      const { b, w } = bodyAt(s, d.start, fps);
      b.key('KeyE', true);
      tap(b, 'Space', fps);
      runUntil(b, fps, 2.5, () => hangs(b));
      b.key('KeyE', false);
      runUntil(b, fps, 0.4, () => false);
      const dt = 1 / fps;
      const F = new ClimbCamFollow();
      const cam = new ThirdPersonCamera(16 / 9);
      cam.yaw = b.heading + Math.PI;
      cam.pitch = 0.3;
      const p = new THREE.Vector3();
      const last = new THREE.Vector3();
      let moved = -1;
      let worst = 0;
      let share = 0;
      let lastOk = false;
      // After the round's review: the share of a change in the body's own velocity (its step over the last few frames) the
      // camera takes in one frame. A smooth start from rest moves 1, 3, 5... in its first frames, so the frame-to-frame ratio
      // reads 3 for a start with no snap in it at all (the hop at 30 frames a second read 2.99 in node and 3.14 in the
      // browser); a snap is the camera taking the body's change in a frame, which the share tells apart at every rate.
      const camV = new THREE.Vector3();
      const camVWas = new THREE.Vector3();
      const bodyV = new THREE.Vector3();
      const bodyVWas = new THREE.Vector3();
      const bodyLast = new THREE.Vector3();
      // (The body's changes over the follow's own settle, four of its time constants: the camera still easing out of a change the body made a few frames back is the follow, never a snap.)
      const dBody: number[] = new Array(Math.max(4, Math.ceil(4 * CLIMB_TUNE.camEase * fps))).fill(0);
      let vOk = 0;
      const frame = () => {
        const climbing = b.ledge.holding || b.wall.holding;
        if (eased && F.step(b.pos.x, b.pos.y, b.pos.z, dt, climbing, CLIMB_TUNE.camEase, 0, 0, 0)) p.set(F.x, F.y, F.z);
        else p.set(b.pos.x, b.pos.y, b.pos.z);
        const c = cameraOf(cam, p, dt);
        if (lastOk) {
          const m = c.distanceTo(last);
          if (moved >= 0) worst = Math.max(worst, m / Math.max(moved, START * dt));
          moved = m;
          camV.subVectors(c, last);
          bodyV.set(b.pos.x - bodyLast.x, b.pos.y - bodyLast.y, b.pos.z - bodyLast.z);
          if (vOk > 0) {
            dBody.shift();
            dBody.push(bodyV.distanceTo(bodyVWas));
            const bodyStep = Math.max(...dBody);
            const camStep = camV.distanceTo(camVWas);
            if (bodyStep > START * dt) share = Math.max(share, camStep / bodyStep);
          }
          camVWas.copy(camV);
          bodyVWas.copy(bodyV);
          vOk++;
        }
        bodyLast.set(b.pos.x, b.pos.y, b.pos.z);
        last.copy(c);
        lastOk = true;
      };
      frame();
      const hold = b.frame.bind(b);
      b.frame = (t: number) => {
        hold(t);
        frame();
      };
      d.run(b, s, w, fps);
      b.frame = hold;
      if (eased) {
        worstEased = worst;
        shareEased = share;
      } else {
        worstRaw = worst;
        shareRaw = share;
      }
      b.physics.world.removeRigidBody(b.body);
    }
    ok(worstEased <= CLIMB_TUNE.camJump, `${d.name} @${fps}: the eased camera never snaps (its worst frame ${worstEased.toFixed(2)} times the one before, under ${CLIMB_TUNE.camJump})`);
    // The raw follow ('before') is the measure's own control: where it snaps (past `camJump`), the eased one must not.
    if (worstRaw > CLIMB_TUNE.camJump) ok(worstEased < worstRaw, `${d.name} @${fps}: ... where the body followed raw snaps (${worstRaw.toFixed(2)})`);
    else console.log(`note ${d.name} @${fps}: followed raw it does not snap either (${worstRaw.toFixed(2)})`);
    ok(shareEased <= SNAP_SHARE && (shareRaw === 0 || shareRaw > SNAP_SHARE), `${d.name} @${fps}: no frame takes more than ${SNAP_SHARE} of a change in the body's velocity (eased ${shareEased.toFixed(2)}, followed raw ${shareRaw.toFixed(2)})`);
  }
}

// ---- 3. a wall's pull-in at once, its letting out eased ----------------------------------------------------------------------
{
  for (const out of [CLIMB_TUNE.camOut, 0]) {
    const cam = new ThirdPersonCamera(16 / 9);
    cam.blockOut = out;
    cam.pitch = 0.3;
    const target = new THREE.Vector3(0, 0, 0);
    let blocked = true;
    const blocker = () => (blocked ? 1.2 : null);
    const dists: number[] = [];
    const fps = 60;
    for (let k = 0; k < 120; k++) {
      if (k === 30) blocked = false;
      cam.update(input, target, blocker, 1 / fps);
      dists.push(cam.orbitDistance);
    }
    const inAt = dists[1];
    const back = dists[31];
    const full = dists[119];
    if (out > 0) {
      ok(inAt <= 0.86, `camOut ${out}: pulled in at once by the wall (${inAt.toFixed(2)} m)`);
      ok(back < full * 0.5 && Math.abs(dists[30 + Math.round(out * fps)] - (cam.distance - (cam.distance - inAt) * Math.exp(-1))) < 0.1 && full > 6, `... and let out eased (${back.toFixed(2)} m a frame after the wall is gone, ${dists[30 + Math.round(out * fps)].toFixed(2)} after ${out} s, ${full.toFixed(2)} in the end)`);
    } else ok(inAt <= 0.86 && dists[30] > 6, `blockOut nought: in at once and out at once, the orbit as it always was (${dists[30].toFixed(2)} m the frame the wall is gone)`);
  }
}

// ---- 4. the game's hand-overs --------------------------------------------------------------------------------------------------
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const player = readFileSync(new URL('../../../src/player/player.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const step = main.indexOf('player.stepClimbCam(dt);\n      this.cam.blockOut = player.climbCamOut;');
  const orbit = main.indexOf('this.cam.update(input, player.followAt, blocked, dt, eyes, player.grapple.camScaleNow, player.eyeHeight);');
  ok(step > 0 && orbit > step && orbit - step < 400, 'the frame steps the follow and hands the camera its letting out just before the orbit is placed');
  ok(player.includes('if (this.camFollow.on && this.camStepped === this.frameNo) return this.followEased.set(this.camFollow.x, this.camFollow.y, this.camFollow.z);') && player.includes('    this.frameNo++;') && player.includes("const climbing = CLIMB_TUNE.camera === 'eased' && this.climbHolds;"), 'the chase follows the eased point only on a frame it was stepped, and only while a climb holds the body or after until caught');
  ok(player.includes('    this.camFollow.reset();\n    this.camLastOk = false;'), 'a body stood somewhere fresh starts the follow afresh');
}
resetClimbTune();
console.log(`smooth2Cam: ${checks} checks passed`);
