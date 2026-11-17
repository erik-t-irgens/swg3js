// Wave 4 of the animations, item B: the hands and feet placed on a climbed face, and the hands braced, frame by frame while
// the body moves, on a skeleton the game draws (the converted human male's where the packs are here, else the tests' own)
// posed by the very clips the pack fits for it (`MixamoPack.clipsFor`), through the very limbs' solve the player hands them
// to (src/player/limbPlace.ts), on the real Rapier through the grapple's harness:
//  - the wall clips played as the player plays them (`Player.animateWall`: the clip the climb says at its rate, a change of
//    clip crossfaded over `climb.ease`), the figure drawn as `Player.applyWallRoot` draws it (its offset, and leant into
//    the face about its left), and the limbs put back before the mixer runs again (`restore`, the rig's own hook);
//  - up an upright face and a 70-degree one, down and sideways, at 30, 60 and 144 frames a second: every frame a hand is
//    wholly placed its grip point stands its palm off the face within a centimetre, every wholly placed foot its ball its
//    `BALL_OFF` off the face within a centimetre; every elbow and knee stays on its clip's own side of the line from its
//    root joint to its end and no limb is stretched past its length;
//  - braced, running past a wall at the left shoulder with the run clip: the left hand's grip on its target within a
//    centimetre once wholly in, its palm turned flat against the face (its normal within 10 degrees), its elbow on the
//    clip's side; under `brace.rule` 'before' the arms are the clip's to the bit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { TestBody, box, ground, makePhysics, type Physics } from './grappleBody.ts';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { PALM_OFF, WALL_IDS, WALL_PLANT, wallClipName } from '../../../src/anim/wallClips.ts';
import { WALL_ON, wallRateOf } from '../../../src/player/wallClimb.ts';
import { PeerWall } from '../../../src/player/peerWall.ts';
import { PeerHangIn } from '../../../src/player/peerHang.ts';
import { BALL_OFF, LimbPlace } from '../../../src/player/limbPlace.ts';
import { BraceIn, HandBrace } from '../../../src/player/brace.ts';
import { CLIMB_TUNE, resetClimbTune, climbTwoBefore } from '../../../src/anim/climbTune.ts';
import { Group, RAPIER, groups } from '../../../src/core/physics.ts';
import { glbSkeleton, speciesBodies, targetSkeleton } from './animFixtures.ts';
import { REPO } from './oldModules.ts';
import { wedge } from './wallScenes.ts';

// Climbing II, phase 2: these scenes hold today's climbing (a lip grabbed by moving at it, a wall climbed by W pressed
// into it, the hang's keys as they were): every phase 2 switch at its 'before' setting, here and after every reset (the new
// controls are climbControls.test.ts's).
climbTwoBefore();

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const n3 = (v: number) => v.toFixed(3);
const FPS = [30, 60, 144] as const;
const ALL = groups(Group.all, Group.all);

const body = speciesBodies(REPO).find((b) => b.id === 'human_male');
const target = body ? glbSkeleton(body.body) : targetSkeleton();
note(body ? "the converted human male's skeleton" : "no converted human male here: the tests' own skeleton");
const packDir = join(REPO, 'public', 'anims', 'mixamo');
const RUN = 'running';
const pack = new MixamoPack({
  enabled: () => true,
  index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
  clip: async (file: string) => {
    const b = readFileSync(join(packDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  breath: async () => {},
  also: [...WALL_IDS, RUN],
  now: () => performance.now(),
});
const info = console.info;
console.info = () => {};
const clips = await pack.clipsFor(target as never, 'walls');
console.info = info;
const clipOf = (name: string) => clips.find((c) => c.name === name) ?? null;
ok(WALL_IDS.every((id) => !!clipOf(wallClipName(id))) && !!clipOf(`mx_${RUN}`), 'the pack fits both wall clips and the run');

// ---- the figure: bones under a root under the body's group, as the game's rig holds them ----------------------------------
const group = new THREE.Group();
const root = new THREE.Group();
const inner = new THREE.Group();
inner.position.fromArray(target.base.p);
inner.quaternion.fromArray(target.base.q);
root.add(inner);
group.add(root);
const bones = new Map<string, THREE.Bone>();
const made: THREE.Bone[] = [];
target.joints.forEach((j) => {
  const b = new THREE.Bone();
  b.name = j.name;
  b.position.fromArray(j.restP);
  b.quaternion.fromArray(j.restQ);
  made.push(b);
  bones.set(j.name, b);
  (j.parent < 0 ? inner : made[j.parent]).add(b);
});
const rig = { root, boneNamed: (n: string) => bones.get(n) ?? null, limbPose: null as { restore(): void } | null };
const mixer = new THREE.AnimationMixer(root);
const AX = new THREE.Vector3(1, 0, 0);

/** The game's rig as the climb drives it: one clip at a time at the climb's rate, a change crossfaded over `climb.ease`. */
class RigEmu {
  private readonly acts = new Map<string, THREE.AnimationAction>();
  private cur = '';
  act(name: string): THREE.AnimationAction {
    let a = this.acts.get(name);
    if (!a) {
      a = mixer.clipAction(clipOf(name)!);
      a.setLoop(THREE.LoopRepeat, Infinity);
      this.acts.set(name, a);
    }
    return a;
  }
  show(name: string, rate: number): void {
    if (name !== this.cur) {
      const next = this.act(name).reset().play();
      next.setEffectiveWeight(1);
      if (this.cur) this.act(this.cur).crossFadeTo(next, CLIMB_TUNE.ease, false);
      this.cur = name;
    }
    this.act(name).timeScale = rate;
  }
  update(dt: number): void {
    // The rig's own hook first: the limbs' last placement put back before the mixer runs.
    rig.limbPose?.restore();
    mixer.update(dt);
  }
  stop(): void {
    mixer.stopAllAction();
    this.cur = '';
  }
}
const emu = new RigEmu();

/** The posed limb's middle joint's side of the line from its root to its end (a unit vector), into `out`. */
function sideOf(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const u = c.clone().sub(a).normalize();
  const ab = b.clone().sub(a);
  return out.copy(ab).addScaledVector(u, -ab.dot(u)).normalize();
}
const P = (n: string, out = new THREE.Vector3()) => bones.get(n)!.getWorldPosition(out);
const grip = (s: string) => P(`${s}Wrist`).add(P(`${s}Index01`)).multiplyScalar(0.5);
const limbs = [
  ['lArm', 'lForeArm', 'lWrist'],
  ['rArm', 'rForeArm', 'rWrist'],
  ['lThigh', 'lShin', 'lAnkle'],
  ['rThigh', 'rShin', 'rAnkle'],
] as const;
const lengths = limbs.map(([a, b, c]) => {
  root.updateMatrixWorld(true);
  return P(a).distanceTo(P(b)) + P(b).distanceTo(P(c));
});

/** A ray's distance from a point into the face along its normal (`-n`), or NaN. */
function faceDistance(p: Physics, at: THREE.Vector3, n: THREE.Vector3): number {
  // (What stands still only, as the game's own rays ask: never the body's own kinematic capsule.)
  const h = p.world.castRayAndGetNormal(new RAPIER.Ray({ x: at.x + n.x * 0.5, y: at.y + n.y * 0.5, z: at.z + n.z * 0.5 }, { x: -n.x, y: -n.y, z: -n.z }), 2, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, ALL);
  return h ? h.timeOfImpact - 0.5 : Number.NaN;
}

// ---- climbing: up, sideways and down, the hands and feet on the face ----------------------------------------------------------
for (const angle of [90, 70]) {
  for (const fps of FPS) {
    resetClimbTune();
    climbTwoBefore();
    emu.stop();
    const p = await (async () => {
      const q = await makePhysics();
      ground(q, 0);
      if (angle === 90) box(q, [-6, 0, 2], [6, 8, 3]);
      else wedge(q, angle, 8, 2, 3, -6, 6);
      q.stepOnce();
      return q;
    })();
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.place(0, 0, 1);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.run(fps, 0.3);
    const lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
    const dt = 1 / fps;
    let handFrames = 0;
    let footFrames = 0;
    let worstHand = 0;
    let worstFoot = 0;
    let backward = 0;
    let stretched = 0;
    const n = new THREE.Vector3();
    const posedSide = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const nowSide = new THREE.Vector3();
    const keysOf = (t: number) => (t < 2.5 ? 'KeyW' : t < 3.5 ? 'KeyD' : t < 4.5 ? 'KeyA' : 'KeyS');
    let held = '';
    for (let k = 0; k < Math.round(6 * fps); k++) {
      const t = k * dt;
      const want = keysOf(t);
      if (want !== held) {
        if (held) b.key(held, false);
        b.key(want, true);
        held = want;
      }
      b.frame(dt);
      const W = b.wall;
      if (W.phase !== WALL_ON) continue;
      // The rig as the player poses it, the figure as it places it.
      emu.show(wallClipName(W.rigClip), W.rate);
      emu.update(dt);
      group.position.set(b.pos.x, b.pos.y, b.pos.z);
      group.rotation.set(0, W.heading, 0);
      const c = Math.cos(W.heading);
      const s = Math.sin(W.heading);
      root.position.set(W.offX * c - W.offZ * s, W.offY, W.offX * s + W.offZ * c);
      root.quaternion.setFromAxisAngle(AX, W.lean);
      group.updateMatrixWorld(true);
      // The clip's own limbs as posed (each joint's side of its limb's line).
      limbs.forEach(([a, m, e], i) => sideOf(P(a), P(m), P(e), posedSide[i]));
      lp.filter = ALL;
      W.limbsFor(lp, rig as never, p.world as never, null);
      // Each foot's ball as the clip (and the hands' anchor) has it, before the solve: wholly placed within WALL_PLANT.near.
      n.set(W.nx, W.ny, W.nz);
      const planted = ['lToe', 'rToe'].map((toe) => faceDistance(p, P(toe), n) - BALL_OFF <= WALL_PLANT.near);
      lp.filter = ALL;
      lp.place(rig as never, p.world, null);
      group.updateMatrixWorld(true);
      n.set(W.nx, W.ny, W.nz);
      for (let side = 0; side < 2; side++) {
        if (!(lp.handW[side] >= 0.999)) continue;
        // The grip as the solve reads it (between the wrist and the index knuckle where the knuckle hangs from the wrist).
        const g = lp.gripNow(rig as never, side, null, new THREE.Vector3())!;
        const d = faceDistance(p, g, n);
        worstHand = Math.max(worstHand, Math.abs(d - PALM_OFF));
        handFrames++;
      }
      for (let f = 0; f < 2; f++) {
        // Wholly placed: the clip has it on its wall, and the placement's share is in whole.
        if (!planted[f] || W.hands < 0.999) continue;
        const d = faceDistance(p, P(f === 0 ? 'lToe' : 'rToe'), n);
        if (!(d === d)) continue;
        worstFoot = Math.max(worstFoot, Math.abs(d - BALL_OFF));
        footFrames++;
      }
      limbs.forEach(([a, m, e], i) => {
        const A = P(a);
        const M = P(m);
        const E = P(e);
        sideOf(A, M, E, nowSide);
        if (nowSide.dot(posedSide[i]) < 0.5) backward++;
        if (A.distanceTo(E) > lengths[i] + 1e-4) stretched++;
      });
    }
    if (held) b.key(held, false);
    ok(handFrames > fps && worstHand < 0.01, `${angle}°, ${fps} fps: every frame a hand is wholly placed (${handFrames}) its grip stands a palm off the face within a centimetre (worst ${(worstHand * 1000).toFixed(2)} mm), climbing up, sideways and down`);
    ok(footFrames > fps && worstFoot < 0.01, `${angle}°, ${fps} fps: every frame a foot stands on the face (${footFrames}) its ball is ${BALL_OFF} off it within a centimetre (worst ${(worstFoot * 1000).toFixed(2)} mm)`);
    ok(backward === 0 && stretched === 0, `${angle}°, ${fps} fps: no elbow or knee ever off its clip's own side of its limb, none stretched past its length`);
  }
}

// ---- bracing: running past a wall at the left shoulder ---------------------------------------------------------------------
{
  resetClimbTune();
  climbTwoBefore();
  emu.stop();
  const p = await makePhysics();
  ground(p, 0);
  // Its face at x 0.42: the capsule (0.35) against it with its skin.
  box(p, [0.42, 0, -20], [1.42, 3, 20]);
  p.stepOnce();
  for (const fps of FPS) {
    emu.stop();
    const lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
    const B = new HandBrace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
    const dt = 1 / fps;
    let z = -5;
    let frames = 0;
    let worst = 0;
    let palmWorst = 0;
    let backward = 0;
    const posed = new THREE.Vector3();
    const now = new THREE.Vector3();
    for (let k = 0; k < Math.round(1.5 * fps); k++) {
      emu.show(`mx_${RUN}`, 1);
      emu.update(dt);
      group.position.set(0, 0, z);
      group.rotation.set(0, 0, 0);
      root.position.set(0, 0, 0);
      root.quaternion.set(0, 0, 0, 1);
      group.updateMatrixWorld(true);
      sideOf(P('lArm'), P('lForeArm'), P('lWrist'), posed);
      const i = new BraceIn();
      i.dt = dt;
      i.x = 0;
      i.y = 0;
      i.z = z;
      i.heading = 0;
      i.scale = 1;
      i.filter = ALL;
      i.vz = 5;
      // The keys pushing the body into the wall as it runs along it (the controller holds it there).
      i.moveX = 1;
      i.moveZ = 0;
      i.onFeet = true;
      B.step(p.world, i, null);
      if (B.busy) {
        B.apply(lp);
        lp.filter = ALL;
        lp.place(rig as never, p.world, null);
        group.updateMatrixWorld(true);
      } else rig.limbPose?.restore();
      if (B.w[0] >= 0.999) {
        const g = grip('l');
        worst = Math.max(worst, g.distanceTo(new THREE.Vector3(B.at[0], B.at[1], B.at[2])));
        // The palm's normal (the index by the thumb off the wrist, the left hand's way) against the face's into it.
        const w = P('lWrist');
        const ix = P('lIndex01').sub(w);
        const th = P('lThumb01').sub(w);
        const palm = new THREE.Vector3().crossVectors(ix, th).normalize();
        palmWorst = Math.max(palmWorst, palm.angleTo(new THREE.Vector3(1, 0, 0)));
        sideOf(P('lArm'), P('lForeArm'), P('lWrist'), now);
        if (now.dot(posed) < 0) backward++;
        frames++;
      }
      z += 5 * dt;
    }
    ok(frames > 0.5 * fps && worst < 0.01, `${fps} fps: running past a wall at the left shoulder, every frame the left hand is wholly braced (${frames}) its grip is on its target within a centimetre (worst ${(worst * 1000).toFixed(2)} mm)`);
    ok(palmWorst < (10 * Math.PI) / 180, `${fps} fps: its palm turned flat against the face (worst ${n3((palmWorst * 180) / Math.PI)} degrees off)`);
    ok(backward === 0, `${fps} fps: its elbow never off the run clip's own side`);
  }
  // Under 'before' the arms are the clip's to the bit.
  CLIMB_TUNE.brace.rule = 'before';
  emu.stop();
  const lp = new LimbPlace(null);
  const B = new HandBrace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  emu.show(`mx_${RUN}`, 1);
  emu.update(0.1);
  group.position.set(0, 0, 0);
  group.updateMatrixWorld(true);
  const was = P('lWrist').clone();
  const i = new BraceIn();
  i.dt = 1 / 60;
  i.filter = ALL;
  i.vz = 5;
  i.moveX = 0.5;
  i.moveZ = 0.86;
  i.onFeet = true;
  B.step(p.world, i, null);
  if (B.busy) B.apply(lp);
  group.updateMatrixWorld(true);
  ok(!B.busy && P('lWrist').equals(was) && B.casts === 0, "under brace.rule 'before' nothing is felt for and the arms are the clip's to the bit");
  resetClimbTune();
  climbTwoBefore();
}
// ---- another player on a wall: their figure's hands on the face this side finds, every offset taken back off ------------------
{
  resetClimbTune();
  climbTwoBefore();
  emu.stop();
  const p = await makePhysics();
  ground(p, 0);
  box(p, [-6, 0, 2], [6, 8, 3]);
  p.stepOnce();
  const lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  const PW = new PeerWall(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), (h, r) => new RAPIER.Capsule(h, r), lp);
  const q = new PeerHangIn();
  q.state = 'wallUp';
  q.x = 0;
  q.y = 2;
  q.z = 2 - 0.37;
  q.heading = 0;
  q.scale = 1;
  q.filter = ALL;
  q.near = true;
  const n = new THREE.Vector3(0, 0, -1);
  let lifted = 0;
  let worst = 0;
  let frames = 0;
  let back = true;
  for (let k = 0; k < 120; k++) {
    q.dt = 1 / 60;
    // The remote pass: the last frame's offsets taken off before anything writes the root, the clip, the figure placed.
    PW.undo(root);
    if (root.position.lengthSq() > 1e-18) back = false;
    emu.show(wallClipName('climbing_up_wall'), wallRateOf('wallUp', 1));
    emu.update(1 / 60);
    group.position.set(q.x, q.y, q.z);
    group.rotation.set(0, q.heading, 0);
    group.updateMatrixWorld(true);
    PW.step(rig as never, p.world as never, q);
    lifted = Math.max(lifted, Math.abs(PW.wall.lifted));
    group.updateMatrixWorld(true);
    for (let side = 0; side < 2; side++) {
      if (!(lp.handW[side] >= 0.999)) continue;
      const g = lp.gripNow(rig as never, side, null, new THREE.Vector3())!;
      worst = Math.max(worst, Math.abs(faceDistance(p, g, n) - PALM_OFF));
      frames++;
    }
  }
  PW.undo(root);
  const rest = root.position.lengthSq() < 1e-18 && Math.abs(root.quaternion.w - 1) < 1e-12;
  ok(frames > 60 && worst < 0.01, `another player's figure on a wall: every frame a hand is wholly placed (${frames}) its grip is a palm off the face this side finds within a centimetre (worst ${(worst * 1000).toFixed(2)} mm)`);
  ok(lifted > 0 && back && rest, `and every offset it puts on their figure's root, the hands' anchor lift too (up to ${(lifted * 1000).toFixed(1)} mm), is taken back off before the next frame writes it`);
  resetClimbTune();
  climbTwoBefore();
}
console.log(`wallHands: ${checks} checks passed`);
