// Climbing II, Smoothness II, items 5 and 6, through the game's own climbing on the real Rapier (the grapple's harness), at 30,
// 60, 144 and 240 frames a second:
//  - item 5 (`climb.wallHands` 'grip'): a wall climbed to its top with the figure on the body (tools/swg/tests/climbFigure.ts:
//    the wall's own clips and limbs), every hand the climb places within 2 cm of something solid, and no hand left in the air
//    at the face's own plane (the clip's hand over the wall's top: "grab air"), against 'before';
//  - item 6 (`climb.pushOff` 'jka'): Space off a wall climb, and S with Space off a braced hang where no hop is cued, play Jedi
//    Academy's rebound back off a wall and push the body back at Jedi Academy's own wall rebound (read from
//    src/player/jkaMove.ts), facing the wall as it flies, further than the slow jump off; a free hang's push off unchanged; the
//    two sliders scale it.
//
// Run: node tools/swg/tests/smooth2Wall.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CLIMB_TUNE, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { resetMoveTune } from '../../../src/anim/moveTune.ts';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { worldToCourse } from '../../../src/anim/climbCourseBuild.ts';
import { LEDGE_JUMP_OFF, LEDGE_PUSH_OFF, ledgeClipName } from '../../../src/anim/ledgeClips.ts';
import { LEDGE_HANG } from '../../../src/player/ledge.ts';
import { JKA, UNIT } from '../../../src/player/jkaMove.ts';
import { STILL_FLAGS } from '../../../src/player/stairSense.ts';
import { PALM_OFF } from '../../../src/anim/wallClips.ts';
import { bodyAt, runUntil, standPiece, tap } from './climbCourseBody.ts';
import { drawClimb, figure, figureScale, HAVE_BODY } from './climbFigure.ts';
import type { TestBody } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const cm = (m: number) => (m * 100).toFixed(1);
const piece = (id: string) => climbCourse({ extras: true, pieces: [id] }).pieces[0];

ok(ledgeClipName(LEDGE_PUSH_OFF) === 'BOTH_FORCEWALLREBOUND_BACK' && ledgeClipName(LEDGE_JUMP_OFF) === 'mx_jump_from_wall', "the push off is Jedi Academy's rebound back off a wall, played by its own name (every other ledge clip by the pack's)");

// ---- item 5: the wall's hands on something ----------------------------------------------------------------------------------
const GV = new THREE.Vector3();
interface Hands {
  frames: number;
  placedOff: number;
  air: number;
  worstOff: number;
  top: boolean;
}
async function climbWall(id: string, fps: number, grip: boolean): Promise<Hands> {
  resetClimbTune();
  resetMoveTune();
  tuneClimb({ wallHands: grip ? 'grip' : 'before' });
  const s = await standPiece(piece(id));
  const { b } = bodyAt(s, 'stand', fps);
  const F = figure();
  b.ledgeScale = figureScale(F);
  const H: Hands = { frames: 0, placedOff: 0, air: 0, worstOff: 0, top: false };
  const world = b.physics.world;
  const hold = b.frame.bind(b);
  b.frame = (dt: number) => {
    hold(dt);
    if (drawClimb(b, F, dt) !== 'wall') return;
    H.frames++;
    const palm = PALM_OFF * b.ledgeScale;
    for (let side = 0; side < 2; side++) {
      const g = F.lp.gripNow(F.rig as never, side, null, GV);
      if (!g) continue;
      const p = world.projectPoint({ x: g.x, y: g.y, z: g.z }, true, STILL_FLAGS, b.filter);
      const off = p ? (p.isInside ? 0 : Math.hypot(g.x - p.point.x, g.y - p.point.y, g.z - p.point.z)) - palm : Infinity;
      if (F.lp.handW[side] >= 0.99) {
        if (off > 0.02) H.placedOff++;
        H.worstOff = Math.max(H.worstOff, off);
      }
      // The face's own plane where the hand stands, and nothing solid within 2 cm: a hand gripping air (the clip's own, not placed).
      const w = F.lp.wall;
      const along = (g.x - w[0]) * w[3] + (g.y - w[1]) * w[4] + (g.z - w[2]) * w[5] - palm;
      // (A hand easing onto its hold, between the clip's place and its grip, is on its way and counted by neither.)
      const w8 = F.lp.handW[side];
      if (Math.abs(along) < 0.04 && off > 0.02 && (w8 <= 0.01 || w8 >= 0.99)) H.air++;
    }
  };
  b.key('KeyE', true);
  b.key('KeyW', true);
  runUntil(b, fps, 2, () => b.wall.holding);
  b.key('KeyE', false);
  runUntil(b, fps, 14, () => !b.wall.holding && !b.ledge.holding);
  b.key('KeyW', false);
  H.top = b.grounded && worldToCourse(s.frame, s.piece, b.pos.x, b.pos.y, b.pos.z, { x: 0, y: 0, z: 0 }).y > 2;
  b.frame = hold;
  b.physics.world.removeRigidBody(b.body);
  return H;
}
if (HAVE_BODY) {
  for (const fps of RATES) {
    for (const id of ['wall-3', 'wall-6', 'wall-edge-8', 'climbwall-braced', 'climbwall-braced-small']) {
      const on = await climbWall(id, fps, true);
      const off = await climbWall(id, fps, false);
      ok(on.frames > fps, `${id} @${fps}: climbed with the figure on the wall (${on.frames} frames${on.top ? ', out onto the top' : ''})`);
      // (Up to 40 ms of one hand in a whole climb: a reaching hand passing a gap between holds while its ray is kept.)
      ok(on.air <= Math.max(2, fps * 0.04) && (off.air === 0 || on.air < off.air), `${id} @${fps}: no hand left gripping air at the face's plane (${on.air} hand-frames; 'before' ${off.air})`);
      ok(on.placedOff === 0, `${id} @${fps}: every hand the climb places within 2 cm of something solid (worst ${cm(on.worstOff)} cm; 'before' ${off.placedOff} hand-frames off, worst ${cm(off.worstOff)} cm)`);
    }
  }
} else note('no converted human male here: the wall\'s hands need his figure');

// ---- item 6: Jedi Academy's push off ----------------------------------------------------------------------------------------
interface Off {
  vx: number;
  vy: number;
  back: number;
  clip: string;
  turned: number;
  out: number;
}
/** Off a wall climb with Space (`hang` false) or off a braced hang with S and Space; the body's flight a second and a half on. */
async function pushOff(id: string, fps: number, jka: boolean, hang: boolean, scale = 1): Promise<Off> {
  resetClimbTune();
  resetMoveTune();
  tuneClimb({ pushOff: jka ? 'jka' : 'before', pushBack: scale, pushUp: scale });
  const s = await standPiece(piece(id));
  const { b } = bodyAt(s, 'stand', fps);
  const R: Off = { vx: 0, vy: 0, back: 0, clip: '', turned: 0, out: 0 };
  let was = false;
  let nx = 0;
  let nz = 0;
  let h0 = 0;
  let x0 = 0;
  let z0 = 0;
  const holds = (x: TestBody) => (hang ? x.ledge.holding : x.wall.holding);
  b.beforeStep = (dt: number) => {
    void dt;
    if (holds(b)) {
      was = true;
      nx = hang ? b.ledge.lip.nx : b.wall.lx;
      nz = hang ? b.ledge.lip.nz : b.wall.lz;
      h0 = b.heading;
      x0 = b.pos.x;
      z0 = b.pos.z;
      return;
    }
    if (was && !R.clip) {
      R.clip = hang ? b.ledge.startClip : b.wall.startClip;
      const l = Math.hypot(nx, nz) || 1;
      R.vx = (b.vel.x * nx + b.vel.z * nz) / l;
      R.vy = b.vel.y;
    }
  };
  if (hang) {
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2.5, () => b.ledge.phase === LEDGE_HANG);
    b.key('KeyE', false);
    runUntil(b, fps, 1.2, () => false);
    b.key('KeyS', true);
    tap(b, 'Space', fps);
    b.key('KeyS', false);
  } else {
    b.key('KeyE', true);
    b.key('KeyW', true);
    runUntil(b, fps, 2, () => b.wall.holding);
    b.key('KeyE', false);
    runUntil(b, fps, 1, () => false);
    b.key('KeyW', false);
    runUntil(b, fps, 0.3, () => false);
    tap(b, 'Space', fps);
  }
  runUntil(b, fps, 1.5, () => false);
  R.back = (b.pos.x - x0) * nx + (b.pos.z - z0) * nz;
  let d = b.heading - h0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  R.turned = Math.abs((d * 180) / Math.PI);
  R.out = was ? 1 : 0;
  b.beforeStep = null;
  b.physics.world.removeRigidBody(b.body);
  return R;
}
const BACK = JKA.jumpOffWallSpeed * UNIT;
const UP = JKA.wallJumpStrength * UNIT;
for (const fps of RATES) {
  for (const [id, hang, what] of [['wall-6', false, 'Space off a wall climb'], ['lip-braced-2.4', true, 'S with Space off a braced hang']] as const) {
    const on = await pushOff(id, fps, true, hang);
    const off = await pushOff(id, fps, false, hang);
    ok(on.out === 1 && on.clip === LEDGE_PUSH_OFF && off.clip === LEDGE_JUMP_OFF, `${what} @${fps}: Jedi Academy's rebound back off the wall played (${on.clip}; 'before' ${off.clip})`);
    ok(Math.abs(on.vx - BACK) < 1e-6 && Math.abs(on.vy - UP) < 0.3, `${what} @${fps}: pushed back at Jedi Academy's own ${BACK.toFixed(2)} m/s and up at its ${UP.toFixed(2)} m/s (${on.vx.toFixed(3)}, ${on.vy.toFixed(2)} after the frame's gravity)`);
    ok(on.back > off.back + 0.5, `${what} @${fps}: a second and a half on it is further back off the face than the slow jump off (${on.back.toFixed(2)} m, 'before' ${off.back.toFixed(2)} m)`);
    ok(on.turned < 1 && off.turned > 170, `${what} @${fps}: facing the wall as it flies (turned ${on.turned.toFixed(0)} degrees; the jump off turned round, ${off.turned.toFixed(0)})`);
  }
  const twice = await pushOff('wall-6', fps, true, false, 2);
  ok(Math.abs(twice.vx - 2 * BACK) < 1e-6, `@${fps}: pushBack and pushUp scale it (at 2: ${twice.vx.toFixed(2)} m/s back)`);
  const free = await pushOff('lip-free-2.4', fps, true, true);
  ok(free.clip !== LEDGE_PUSH_OFF, `@${fps}: a free hang's S with Space is the drop with a push back as ever (${free.clip})`);
}
resetClimbTune();
resetMoveTune();
void CLIMB_TUNE;
console.log(`smooth2Wall: ${checks} checks passed`);
