// Climbing II, Smoothness II, item 2 after the round's review: the transitions smooth2Rig did not reach, measured as it measures
// the grab and the hop: the rig's own pose (the mixer's, in the rig root's frame, before the limbs) frame by frame while a
// one-off plays and as it hands over, on the human male (tools/swg/tests/climbFigure.ts's figure: the pack's ledge, wall and
// crouched-walk clips fitted to him), driven by the game's own hand-overs (`driveHangClips`; the wall's clip lines as the
// player's `animateWall` has them; the let-go's `driveDropClip`, the player's call, which the harness's frame makes with the
// figure's rig) through the grapple's harness on the real Rapier, at 30, 60, 144 and 240 frames a second:
//  - a climb up onto the top, into the crouch (its own `blendStand`), and on in the crouch;
//  - a running jump caught on a lip;
//  - a fall caught on a lip;
//  - a let-go: the drop's clip through the fall and the landing, handed to the loop that follows;
//  - a wall climb's start, its climb to the top and its top-out, and on.
// A jump is a frame moving any bone more than `poseJump` times what the clips playing move it on their own and what a
// crossfade between the two weightiest must cover over `transitionBlend`; a freeze, the pose standing still over more than a
// frame while a clip playing moves. Off the climb the player's own locomotion plays the species' clips, which the figure has
// not got: the crouched walk stands in for the crouch, the idle and the fall's loop (`mx_falling_idle` where fitted), so the
// measure holds the one-offs' hand-overs and not those stand-ins' own blends. Under 'before' each is reported beside it.
//
// Run: node tools/swg/tests/smooth2Trans.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CLIMB_TUNE, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { resetMoveTune } from '../../../src/anim/moveTune.ts';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { ledgeClipName } from '../../../src/anim/ledgeClips.ts';
import { WALL_CLIP_NAMES, wallClipName } from '../../../src/anim/wallClips.ts';
import { driveHangClips } from '../../../src/player/hangClips.ts';
import { LEDGE_HANG } from '../../../src/player/ledge.ts';
import { figure, figureScale, type Figure } from './climbFigure.ts';
import { bodyAt, jump, runUntil, standPiece, tap } from './climbCourseBody.ts';
import { box, ground, makePhysics, TestBody } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const piece = (id: string) => climbCourse({ pieces: [id] }).pieces[0];
const OWN_FLOOR = 0.05;

// ---- the measure (smooth2Rig's, on the climbing figure) -------------------------------------------------------------------------
const twin = figure();
const twinMixer = new THREE.AnimationMixer(twin.root);
const twinActs = new Map<THREE.AnimationClip, THREE.AnimationAction>();
function poseOf(root: THREE.Object3D, bones: THREE.Bone[], out: Float64Array): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3();
  for (let i = 0; i < bones.length; i++) {
    bones[i].getWorldPosition(v).applyMatrix4(inv);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
}
function poseAlone(clip: THREE.AnimationClip, t: number, out: Float64Array): void {
  let a = twinActs.get(clip);
  if (!a) {
    a = twinMixer.clipAction(clip);
    a.play();
    twinActs.set(clip, a);
  }
  for (const x of twinActs.values()) x.setEffectiveWeight(x === a ? 1 : 0);
  a.time = Math.max(0, Math.min(clip.duration, t));
  twinMixer.update(0);
  poseOf(twin.root, twin.bones, out);
}
const most = (u: Float64Array, w: Float64Array) => {
  let m = 0;
  for (let i = 0; i < u.length; i += 3) m = Math.max(m, Math.hypot(u[i] - w[i], u[i + 1] - w[i + 1], u[i + 2] - w[i + 2]));
  return m;
};
const P0 = new Float64Array(twin.bones.length * 3);
const P1 = new Float64Array(twin.bones.length * 3);
function ownMove(clip: THREE.AnimationClip, t0: number, t1: number, loops: boolean): number {
  if (loops && t1 < t0) {
    poseAlone(clip, t0, P0);
    poseAlone(clip, clip.duration, P1);
    const one = most(P0, P1);
    poseAlone(clip, 0, P0);
    poseAlone(clip, t1, P1);
    return one + most(P0, P1);
  }
  poseAlone(clip, t0, P0);
  poseAlone(clip, t1, P1);
  return most(P0, P1);
}
function apart(a: THREE.AnimationClip, ta: number, b: THREE.AnimationClip, tb: number): number {
  poseAlone(a, ta, P0);
  poseAlone(b, tb, P1);
  return most(P0, P1);
}
type Rig = Figure['rig'];
function playing(rig: Rig): { clip: THREE.AnimationClip; time: number; loops: boolean; action: THREE.AnimationAction }[] {
  const m = rig.mixer as unknown as { _actions: THREE.AnimationAction[]; _nActiveActions: number };
  const out: { clip: THREE.AnimationClip; time: number; loops: boolean; action: THREE.AnimationAction }[] = [];
  for (let i = 0; i < m._nActiveActions; i++) {
    const a = m._actions[i];
    if (a.getEffectiveWeight() > 1e-6) out.push({ clip: a.getClip(), time: a.time, loops: a.loop === THREE.LoopRepeat, action: a });
  }
  return out;
}

/** The figure's clips this frame as the player's frame puts them on: the hang's, the wall's, or the body's own states. */
function drive(b: TestBody, F: Figure, dt: number, hung: boolean, walled: boolean): void {
  const L = b.ledge;
  const W = b.wall;
  const rig = F.rig;
  // (A frame begun hanging is the hang's whole, its let-go included: the player's hangFrame runs nimateHang.)
  if (L.holding || hung) {
    driveHangClips(rig, L, dt, F.hang);
    return;
  }
  if (W.holding || W.startClip || walled) {
    // (The player's `animateWall`, its clip lines: climbFigure's `drawWall` to the line.)
    if (W.startClip) rig.play(ledgeClipName(W.startClip), { from: W.startFrom, fadeIn: W.startFade, hold: false });
    if (W.rigState) {
      if (W.rigState === 'wallStill') rig.prefer('wallStill', wallClipName(W.rigClip));
      else if (W.rigState === 'wallLeft' || W.rigState === 'wallRight') rig.prefer(W.rigState, WALL_CLIP_NAMES[W.rigClip] ?? wallClipName(W.rigClip));
      F.wallRate.rate = W.rate;
      F.wallRate.fade = CLIMB_TUNE.ease;
      rig.nearestNext = CLIMB_TUNE.transitions === 'blend';
      rig.setState(W.rigState as never, 0, null, F.wallRate);
      rig.nearestNext = false;
    } else rig.setState(W.stood ? 'idle' : 'air', 0, null, F.hang.hangFade);
    rig.update(dt);
    return;
  }
  // Off the climb: the player's own states (the stand-ins named above).
  rig.setState((b.grounded ? 'crouch' : 'air') as never, 0, null, F.hang.hangFade);
  rig.update(dt);
}

interface Measure {
  jump: number;
  freeze: number;
  frames: number;
  where: string;
  seen: string;
}
/** Measures the figure frame by frame over whatever `script` drives, from the first frame a one-off plays. */
function measured(b: TestBody, F: Figure, fps: number, script: () => void): Measure {
  const dt = 1 / fps;
  const now = new Float64Array(F.bones.length * 3);
  const was = new Float64Array(F.bones.length * 3);
  const times = new Map<THREE.AnimationAction, number>();
  let have = false;
  let still = 0;
  let spreadWas = 0;
  const m: Measure = { jump: 0, freeze: 0, frames: 0, where: '', seen: '' };
  const seen = new Set<string>();
  const hold = b.frame.bind(b);
  b.frame = (t: number) => {
    const hung = b.ledge.holding;
    const walled = b.wall.holding && !hung;
    hold(t);
    drive(b, F, dt, hung, walled);
    poseOf(F.root, F.bones, now);
    const act = playing(F.rig);
    let own = OWN_FLOOR * dt;
    for (const x of act) {
      const t0 = times.get(x.action);
      if (t0 !== undefined) own = Math.max(own, ownMove(x.clip, t0, x.time, x.loops));
    }
    times.clear();
    for (const x of act) times.set(x.action, x.time);
    for (const x of act) if (!x.loops) seen.add(x.clip.name);
    const by = act.slice().sort((p, q) => q.action.getEffectiveWeight() - p.action.getEffectiveWeight());
    const spreadNow = by.length > 1 ? (apart(by[0].clip, by[0].time, by[1].clip, by[1].time) * dt) / Math.max(dt, CLIMB_TUNE.transitionBlend) : 0;
    if (have) {
      // (A crossfade's last frame: the clip it fades from ends this frame and is no longer playing, so the last frame's pair
      // counts as well.)
      const spread = Math.max(spreadNow, spreadWas);
      const moved = most(now, was);
      const r = moved / (own + spread);
      if (r > m.jump) {
        m.jump = r;
        m.where = `${(moved * 100).toFixed(2)} cm, ${act.map((x) => x.clip.name + '@' + x.time.toFixed(2) + 'x' + x.action.getEffectiveWeight().toFixed(2)).join(' ')}`;
      }
      if (moved < 1e-6 && own > OWN_FLOOR * dt * 2) still++;
      else still = 0;
      m.freeze = Math.max(m.freeze, still);
      m.frames++;
    }
    was.set(now);
    spreadWas = spreadNow;
    have = true;
  };
  script();
  b.frame = hold;
  m.seen = [...seen].join(' ');
  return m;
}

/** A figure for a body: the stand-ins for the species' own loops off the climb, and the drop's rig handed to the harness. */
function figureFor(b: TestBody): Figure {
  const F = figure();
  b.ledgeScale = figureScale(F);
  F.rig.prefer('crouch' as never, 'mx_crouched_walking');
  F.rig.prefer('idle' as never, 'mx_crouched_walking');
  // (The fall's loop a clip of its own, or a change of state would be no change of clip: a free hang's idle stands in.)
  F.rig.prefer('air' as never, F.rig.has('mx_falling_idle') ? 'mx_falling_idle' : 'mx_free_hang_hanging_idle');
  b.dropRig = F.rig;
  return F;
}
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;

interface Case {
  name: string;
  run: (fps: number) => Promise<Measure>;
}
const CASES: Case[] = [
  {
    name: 'a climb up onto the top',
    run: async (fps) => {
      const s = await standPiece(piece('lip-braced-2.4'));
      const { b } = bodyAt(s, 'stand', fps);
      const F = figureFor(b);
      b.key('KeyE', true);
      tap(b, 'Space', fps);
      runUntil(b, fps, 2.5, () => hangs(b));
      b.key('KeyE', false);
      runUntil(b, fps, 0.4, () => false);
      const m = measured(b, F, fps, () => {
        tap(b, 'KeyW', fps);
        runUntil(b, fps, 4, () => !b.ledge.holding);
        runUntil(b, fps, 0.8, () => false);
      });
      b.physics.world.removeRigidBody(b.body);
      return m;
    },
  },
  {
    name: 'a running jump caught on a lip',
    run: async (fps) => {
      // (The 2.4 m lip, which a running jump reaches with its hands: the course's run lips are reached by the wall climb.)
      const s = await standPiece(piece('lip-braced-2.4'));
      const { b } = bodyAt(s, 'run', fps);
      const F = figureFor(b);
      const m = measured(b, F, fps, () => {
        jump(b, 'run', fps);
        b.key('KeyE', false);
        b.key('KeyW', false);
        runUntil(b, fps, 1, () => false);
      });
      b.physics.world.removeRigidBody(b.body);
      return m;
    },
  },
  {
    name: 'a fall caught on a lip',
    run: async (fps) => {
      const p = await makePhysics();
      ground(p, 0);
      box(p, [-3, 0, 1], [3, 6, 2.5]);
      p.stepOnce();
      (p as unknown as { acc: number }).acc = 0;
      const b = new TestBody(p);
      b.jka.forceLevel = 0;
      b.place(0, 6 - 1.2, 0.4);
      b.forward.set(0, 0, 1);
      b.right.set(-1, 0, 0);
      b.heading = 0;
      b.vel.set(0, -2, 0);
      b.grounded = false;
      const F = figureFor(b);
      const m = measured(b, F, fps, () => {
        b.key('KeyE', true);
        runUntil(b, fps, 3, () => hangs(b));
        b.key('KeyE', false);
        runUntil(b, fps, 1, () => false);
      });
      b.physics.world.removeRigidBody(b.body);
      return m;
    },
  },
  {
    name: 'a let-go, its fall and its landing',
    run: async (fps) => {
      const s = await standPiece(piece('lip-braced-2.4'));
      const { b } = bodyAt(s, 'stand', fps);
      const F = figureFor(b);
      b.key('KeyE', true);
      tap(b, 'Space', fps);
      runUntil(b, fps, 2.5, () => hangs(b));
      b.key('KeyE', false);
      runUntil(b, fps, 0.6, () => false);
      const m = measured(b, F, fps, () => {
        tap(b, 'ControlLeft', fps);
        runUntil(b, fps, 3, () => !b.ledge.dropId && b.grounded);
        runUntil(b, fps, 0.6, () => false);
      });
      b.physics.world.removeRigidBody(b.body);
      return m;
    },
  },
  {
    name: "a wall climb's start, its top and its top-out",
    run: async (fps) => {
      const s = await standPiece(piece('wall-3'));
      const { b } = bodyAt(s, 'stand', fps);
      const F = figureFor(b);
      const m = measured(b, F, fps, () => {
        b.key('KeyE', true);
        b.key('KeyW', true);
        runUntil(b, fps, 2, () => b.wall.holding);
        b.key('KeyE', false);
        let held = false;
        runUntil(b, fps, 10, () => {
          if (b.wall.holding || b.ledge.holding) held = true;
          return held && !b.wall.holding && !b.ledge.holding && b.grounded;
        });
        b.key('KeyW', false);
        runUntil(b, fps, 0.8, () => false);
      });
      b.physics.world.removeRigidBody(b.body);
      return m;
    },
  },
];

resetClimbTune();
resetMoveTune();
ok(CLIMB_TUNE.transitions === 'blend', "the round ships its transitions blended");
for (const c of CASES) {
  for (const fps of RATES) {
    resetClimbTune();
    resetMoveTune();
    const m = await c.run(fps);
    resetClimbTune();
    resetMoveTune();
    tuneClimb({ transitions: 'before' });
    const o = await c.run(fps);
    resetClimbTune();
    ok(m.frames > fps / 2 && m.seen.length > 0, `${c.name} @${fps}: its one-offs measured (${m.frames} frames: ${m.seen})`);
    ok(m.jump <= CLIMB_TUNE.poseJump, `${c.name} @${fps}: no bone jumps: the worst frame moves ${m.jump.toFixed(2)} times the clips' own and their crossfade's (under ${CLIMB_TUNE.poseJump}; ${m.where})`);
    ok(m.freeze <= 1, `${c.name} @${fps}: no freeze: the pose never stands still over more than a frame while a clip playing moves (${m.freeze})`);
    note(`${c.name} @${fps}: under 'before' the worst frame ${o.jump.toFixed(2)} (${o.where}), the longest freeze ${o.freeze} frames`);
  }
}

console.log(`\nsmooth2Trans: ${checks} checks passed`);
