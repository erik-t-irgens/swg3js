// A shuttle's clips flown as paths (src/world/rigPath.ts): where a take-off lets go of a hull, where a
// landing takes one back, and the blends either side.
//
// The cut and the join are worked out from the clips at run time, so what is pinned here is the rules
// rather than the numbers: on clips made up here with a known shape (a vertical rise, a climb out nose
// first and a leap no body could fly; a first frame at ninety kilometres a second, a hard braking and a
// glide) the cut must be the last clean frame before the leap and the join the first after the braking,
// never before it. Then, when this install has converted the game's own rigs, the answers for the
// three branches are held to the windows the design measured, with their heights and speeds, the nose
// along the path over the ground, and the struts and door already in the sky pose at both hand-overs,
// under either reading of how hard a physical stretch may accelerate.
//
// Run: node tools/swg/tests/rigPath.test.ts

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { FLYING, flyingRig, loadGlb, madeUpPieces, madeUpRig, packRigs, ROOT_REST, type Skeleton } from './rigFixtures.ts';
import { RIG_HULL_TUNE, RigHull, assembleRigModel, hullJointOf, landingMood } from '../../../src/vehicles/rigHull.ts';
import {
  RIG_PATH_TUNE,
  alignShare,
  inSight,
  landingJoin,
  landingTarget,
  makeLandingTarget,
  noseOntoPath,
  onPad,
  pathPose,
  pathVelocity,
  poseRigAction,
  rigPathOf,
  settleOnto,
  settleSeconds,
  takeoffCut,
  turnOnPad,
  vehicleAt,
  vehicleFromJoint,
  type Pad,
  type RigActions,
  type RigMoment,
} from '../../../src/world/rigPath.ts';
import { settleEase } from '../../../src/vehicles/landing.ts';
import type { RigClips, RigPose } from '../../../src/world/travelTerminal.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}
const f2 = (n: number) => n.toFixed(2);

/** A mixer on a clone of a skeleton, as the clock rig poses one. */
function clockOf(skeleton: Skeleton, clips: RigClips): { joints: THREE.Object3D; state: RigActions } {
  const joints = skeleton.scene.clone(true);
  const mixer = new THREE.AnimationMixer(joints);
  const actions: RigActions['actions'] = {};
  for (const role of ['land', 'lift', 'ground', 'sky'] as const) {
    const clip = clips[role] ? skeleton.animations.find((a) => a.name === clips[role]) : undefined;
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    actions[role] = a;
  }
  return { joints, state: { mixer, actions, current: null } };
}

/** A one-joint rig whose only clip is `clip`: what the cut and join rules are tried on. */
function oneJoint(clip: THREE.AnimationClip) {
  const scene = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'hull';
  scene.add(bone);
  const assembled = assembleRigModel({ scene, animations: [clip] }, [], 'hull');
  return rigPathOf(clip, assembled.chain);
}

/** Position and turn keys every tenth of a second from a function of time. */
function keyed(name: string, from: number, to: number, at: (t: number) => { p: THREE.Vector3; q: THREE.Quaternion }, extra: { t: number; p: THREE.Vector3; q: THREE.Quaternion }[] = []): THREE.AnimationClip {
  const times: number[] = [];
  const pos: number[] = [];
  const quat: number[] = [];
  const add = (t: number, p: THREE.Vector3, q: THREE.Quaternion) => {
    times.push(t);
    pos.push(p.x, p.y, p.z);
    quat.push(q.x, q.y, q.z, q.w);
  };
  const steps = Math.round((to - from) * 10);
  for (let i = 0; i <= steps; i++) {
    const t = from + i / 10;
    const k = at(t);
    add(Number(t.toFixed(4)), k.p, k.q);
  }
  for (const e of extra) add(e.t, e.p, e.q);
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b]);
  const T = order.map((i) => times[i]);
  const Pv = order.flatMap((i) => pos.slice(i * 3, i * 3 + 3));
  const Qv = order.flatMap((i) => quat.slice(i * 4, i * 4 + 4));
  return new THREE.AnimationClip(name, -1, [new THREE.VectorKeyframeTrack('hull.position', T, Pv), new THREE.QuaternionKeyframeTrack('hull.quaternion', T, Qv)]);
}

const level = new THREE.Quaternion();
const pitched = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-deg));

// ---------------------------------------------------------------- a path is the clip

{
  // The made-up rig's own clips, sampled as a path, against a mixer posing the same joint at random moments.
  const skeleton = madeUpRig();
  const clips: RigClips = { land: 'land', lift: 'take_off', ground: 'loop_ground' };
  const assembled = assembleRigModel({ scene: skeleton.scene.clone(true), animations: skeleton.animations }, madeUpPieces(), 'hold', clips);
  const clock = clockOf(skeleton, clips);
  const hold = clock.joints.getObjectByName('hold')!;
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const mp = new THREE.Vector3();
  const mq = new THREE.Quaternion();
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let worstP = 0;
  let worstQ = 0;
  for (const role of ['land', 'lift'] as const) {
    const clip = skeleton.animations.find((a) => a.name === clips[role])!;
    const path = rigPathOf(clip, assembled.chain);
    ok(rigPathOf(clip, assembled.chain) === path, `${role}: a clip's path is made once and kept`);
    for (let i = 0; i < 200; i++) {
      const t = random() * clip.duration;
      pathPose(path, t, p, q);
      poseRigAction(clock.state, role, t);
      clock.joints.updateMatrixWorld(true);
      hold.matrixWorld.decompose(mp, mq, new THREE.Vector3());
      // Measured against how far out the joint is: the mixer's own values are single precision, a
      // sixteenth of a millimetre at the made-up landing's 900 m.
      worstP = Math.max(worstP, p.distanceTo(mp) / Math.max(1, mp.length()));
      worstQ = Math.max(worstQ, q.angleTo(mq));
    }
  }
  ok(worstP < 1e-6 && worstQ < 1e-5, `a path's joint stands where a mixer poses it at any moment, between its samples as on them, to the mixer's own precision (${worstP.toExponential(1)} of its distance out, ${worstQ.toExponential(1)} rad)`);
}

// ---------------------------------------------------------------- the take-off's cut

{
  // Up the first three seconds with the nose level (the path ninety degrees off the nose), then out
  // along a 15-degree climb nose first, speeding up at 10 m/s² from 10 m/s, then a leap of 200 m in a
  // tenth of a second at ten seconds.
  const climb = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(15)), Math.cos(THREE.MathUtils.degToRad(15)));
  const at = (t: number) => {
    if (t <= 3) return { p: new THREE.Vector3(0, 10 * t, 0), q: level };
    const s = t - 3;
    return { p: new THREE.Vector3(0, 30, 0).addScaledVector(climb, 10 * s + 5 * s * s), q: pitched(15) };
  };
  const end = at(10).p;
  const clip = keyed('up', 0, 10, at, [{ t: 10.1, p: end.clone().addScaledVector(climb, 200), q: pitched(15) }]);
  const path = oneJoint(clip);
  const cut = takeoffCut(path, RIG_HULL_TUNE.boostSpeed);
  ok(!!cut && cut.t < 10 && cut.t > 9.4, `the cut is the last clean frame before the leap (${cut ? f2(cut.t) : 'none'} s, the leap at 10 s)`);
  ok(!!cut && cut.height >= RIG_PATH_TUNE.cutHeight && cut.speed >= RIG_PATH_TUNE.cutSpeedMin && cut.speed <= RIG_HULL_TUNE.boostSpeed && cut.noseOff <= RIG_PATH_TUNE.cutNose, `and high enough, fast enough, no faster than the boost and nose on its path (${cut ? `${f2(cut.height)} m, ${f2(cut.speed)} m/s, ${f2(cut.noseOff)}°` : ''})`);
  // Every frame after it up to the leap is refused for a reason: none is a later clean frame.
  const later = takeoffCut(path, RIG_HULL_TUNE.boostSpeed, { ...RIG_PATH_TUNE, cutAccel: Infinity, cutTurn: Infinity });
  ok(!!later && !!cut && later.t >= cut.t && later.t < 10, 'loosening the lurch and the spin can only move it later, and never past the leap');
  // A climb out at 43 m/s, 21 degrees up, once with a first frame ten kilometres a second off it and once without.
  const out = (t: number) => ({ p: new THREE.Vector3(0, 30 + 15 * t, 1000 + 40 * t), q: level });
  const fromStart = keyed('cinematic', 0.1, 3, out, [{ t: 0, p: new THREE.Vector3(0, 0, 0), q: level }]);
  const noLeap = keyed('clean', 0, 3, out);
  ok(takeoffCut(oneJoint(fromStart), RIG_HULL_TUNE.boostSpeed) === null, 'a clip cinematic from its first frame has no cut');
  ok(!!takeoffCut(oneJoint(noLeap), RIG_HULL_TUNE.boostSpeed), 'while the same clip without its first leap has one');
}

// ---------------------------------------------------------------- the landing's join

{
  // A first frame 3 km out (ninety kilometres a second), then 540 m/s braking at 160 m/s² from 3 s to
  // 6 s, then a 60 m/s glide 10 degrees down along its nose to the pad at 12 s.
  const down = new THREE.Vector3(0, -Math.sin(THREE.MathUtils.degToRad(10)), Math.cos(THREE.MathUtils.degToRad(10)));
  const glideAt = (t: number) => new THREE.Vector3().addScaledVector(down, -60 * (12 - t));
  const brakeAt = (t: number) => {
    const s = 6 - t;
    return glideAt(6).addScaledVector(down, -(60 * s + 80 * s * s));
  };
  const at = (t: number) => ({ p: t >= 6 ? glideAt(t) : t >= 3 ? brakeAt(t) : brakeAt(3).addScaledVector(down, -540 * (3 - t)), q: pitched(-10) });
  const clip = keyed('down', 0.1, 12, at, [{ t: 0, p: at(0.1).p.addScaledVector(down, -9000), q: pitched(-10) }]);
  const path = oneJoint(clip);
  const join = landingJoin(path, RIG_HULL_TUNE.maxSpeed);
  ok(!!join && join.t >= 6 && join.t < 6.5, `the join is the earliest frame after the braking a pilot at a steady speed could meet (${join ? f2(join.t) : 'none'} s, the braking ends at 6 s)`);
  // No frame from the join to the end is cinematic, and the frame before the join is refused.
  let cinematicAfter = false;
  let lastCinematic = -1;
  for (let i = 0; i < path.frames; i++) if (isCinematic(path, i)) lastCinematic = i;
  if (join) for (let i = join.frame; i < path.frames; i++) if (isCinematic(path, i)) cinematicAfter = true;
  ok(!!join && !cinematicAfter && join.frame > lastCinematic, `and never before a cinematic one: the last is at ${f2(path.times[Math.max(0, lastCinematic)])} s, and nothing after the join is`);
  ok(!!join && join.height >= RIG_PATH_TUNE.joinHeight && join.speed <= RIG_HULL_TUNE.maxSpeed && Math.abs(join.climb + 10) < 0.5, `high enough, no faster than cruise, gliding 10 degrees down (${join ? `${f2(join.height)} m, ${f2(join.speed)} m/s, ${f2(join.climb)}°` : ''})`);
}

{
  // A clean glide that any pilot could meet, then a leap of two kilometres in a tenth of a second, then
  // the final glide onto the pad: every frame of the first glide passes every other rule, so only the
  // scan stopping at the leap keeps the join out of it. A join there would hand the hull a clip that
  // still leaps kilometres after it.
  const down = new THREE.Vector3(0, -Math.sin(THREE.MathUtils.degToRad(10)), Math.cos(THREE.MathUtils.degToRad(10)));
  const finalAt = (t: number) => new THREE.Vector3().addScaledVector(down, -60 * (12 - t));
  const at = (t: number) => ({ p: t >= 4.1 ? finalAt(t) : finalAt(4.1).addScaledVector(down, -2000 - 60 * (4.1 - t)), q: pitched(-10) });
  const path = oneJoint(keyed('twice', 0, 12, at));
  const join = landingJoin(path, RIG_HULL_TUNE.maxSpeed);
  ok(!!join && join.t > 4.1 && join.t < 4.6, `a clean glide before a leap is never joined: the join is after the leap, in the final glide (${join ? f2(join.t) : 'none'} s, the leap at 4 s)`);
  // With nothing counted cinematic, the scan runs on past the leap and the earliest clean frame is in
  // the first glide: which is the proof that those frames pass every other rule.
  const blind = landingJoin(path, RIG_HULL_TUNE.maxSpeed, { ...RIG_PATH_TUNE, cinematicSpeed: Infinity, cinematicAccel: Infinity });
  ok(!!blind && blind.t < 3.5, `though every frame of the first glide passes every other rule (with nothing cinematic it would join at ${blind ? f2(blind.t) : 'none'} s)`);
}

/** Whether a frame of a path is one no body could fly, measured the way the rules measure one but written out apart here. */
function isCinematic(path: ReturnType<typeof rigPathOf>, i: number): boolean {
  const W = Math.max(1, Math.round(RIG_PATH_TUNE.window * path.fps));
  const vel = (k: number) => {
    const a = Math.max(0, k - 1);
    const b = Math.min(path.frames - 1, k + 1);
    return new THREE.Vector3(path.pos[b * 3] - path.pos[a * 3], path.pos[b * 3 + 1] - path.pos[a * 3 + 1], path.pos[b * 3 + 2] - path.pos[a * 3 + 2]).divideScalar(path.times[b] - path.times[a]);
  };
  const a0 = Math.max(0, i - W);
  const a1 = Math.min(path.frames - 1, i + W);
  const accel = vel(a1).sub(vel(a0)).length() / (path.times[a1] - path.times[a0]);
  return vel(i).length() > RIG_PATH_TUNE.cinematicSpeed || accel > RIG_PATH_TUNE.cinematicAccel;
}

// ---------------------------------------------------------------- the blends

{
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.1, 0.2));
  const v = new THREE.Vector3(3, 1, -2);
  const out = new THREE.Quaternion();
  noseOntoPath(q, v, 0, out);
  ok(out.angleTo(q) < 1e-6, 'with nothing of it, the nose is where the clip has it');
  noseOntoPath(q, v, 1, out);
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(out);
  ok(nose.angleTo(v) < 1e-6, `with all of it, the nose points along the path (${nose.angleTo(v).toExponential(1)} rad)`);
  let before = Infinity;
  let monotone = true;
  for (let k = 0; k <= 1.0001; k += 0.1) {
    noseOntoPath(q, v, k, out);
    const off = new THREE.Vector3(0, 0, 1).applyQuaternion(out).angleTo(v);
    if (off > before + 1e-9) monotone = false;
    before = off;
  }
  ok(monotone, 'and between, it only ever turns toward the path');
  const same = q.clone();
  noseOntoPath(same, v, 0.5, same);
  noseOntoPath(q, v, 0.5, out);
  ok(same.angleTo(out) < 1e-6, 'its answer may be written over the turn it was given');
  ok(alignShare(9, 12) === 0 && alignShare(12, 12) === 1 && alignShare(11.5, 12) > 0 && alignShare(11.5, 12) < 1, 'the nose is brought round only over the last second before the cut');
}

{
  const fromP = new THREE.Vector3(10, 4, -3);
  const fromQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.4, -0.05));
  const baseP = new THREE.Vector3(2, 1, 0);
  const baseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.1, 0));
  const nowP = new THREE.Vector3(5, -2, 7);
  const nowQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.6, 0.1));
  const outP = new THREE.Vector3();
  const outQ = new THREE.Quaternion();
  settleOnto(fromP, fromQ, baseP, baseQ, baseP, baseQ, 0, outP, outQ);
  ok(outP.distanceTo(fromP) < 1e-12 && outQ.angleTo(fromQ) < 1e-6, 'settling, at the hand-over it is where the flown hull was');
  settleOnto(fromP, fromQ, baseP, baseQ, nowP, nowQ, 1, outP, outQ);
  ok(outP.distanceTo(nowP) < 1e-12 && outQ.angleTo(nowQ) < 1e-6, 'and settled, it is the clip');
  // A clip moving on at a steady 80 m/s from its hand-over, a hull handed over 10 m off it moving just as fast.
  const V = new THREE.Vector3(0, -20, 77.46);
  const S = settleSeconds(fromP.distanceTo(baseP));
  const at = (t: number) => {
    settleOnto(fromP, fromQ, baseP, baseQ, baseP.clone().addScaledVector(V, t), baseQ, settleEase(t / S), outP, outQ);
    return outP.clone();
  };
  const h = 1e-3;
  const early = at(h).sub(at(0)).divideScalar(h);
  ok(early.distanceTo(V) < 0.05, `and it goes on at the clip's own velocity from its first instant (${early.distanceTo(V).toFixed(3)} m/s off)`);
  ok(settleSeconds(0) === RIG_PATH_TUNE.settleMin && settleSeconds(1e6) === RIG_PATH_TUNE.settleMax && settleSeconds(25) === 2.5, 'the settle takes longer the further off it arrived, between its bounds');
}

{
  // A landing target against the vehicle's own pose worked out with none of the module's arithmetic: a
  // mixer posing the whole clip on a skeleton hung on a group standing on the turned pad, and the
  // vehicle's origin a child of the hull joint at the offset, read off the scene graph. The flyable rig's
  // nose pitches through its glide, so the offset turns as the hull comes down (its share of the
  // velocity is the turn rate times the offset) and the pad's turn and the joint's own are two turns
  // whose order matters.
  const { skeleton, pieces, clips } = flyingRig();
  const assembled = assembleRigModel({ scene: skeleton.scene.clone(true), animations: skeleton.animations }, pieces.map((p) => ({ joint: p.joint, model: p.model.clone(true) })), 'hold', clips);
  const hull = new RigHull(assembled, clips);
  hull.frame();
  const pad: Pad = { x: 400, y: 30, z: -250, yaw: 0.8 };
  const land = rigPathOf(assembled.fullClips.get('land')!, assembled.chain);
  const join = landingJoin(land, RIG_HULL_TUNE.maxSpeed)!;
  const target = landingTarget(pad, land, join, hull.offset, makeLandingTarget());
  const clock = clockOf(skeleton, clips);
  const root = new THREE.Group();
  root.position.set(pad.x, pad.y, pad.z);
  root.rotation.y = pad.yaw;
  root.add(clock.joints);
  const origin = new THREE.Object3D();
  origin.position.copy(hull.offset);
  clock.joints.getObjectByName('hold')!.add(origin);
  const vehicle = (t: number) => {
    poseRigAction(clock.state, 'land', t);
    root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    origin.matrixWorld.decompose(p, q, new THREE.Vector3());
    return { p, q };
  };
  const h = 1 / 30;
  const fd = vehicle(join.t + h).p.sub(vehicle(join.t - h).p).divideScalar(2 * h);
  // How much of that velocity is the hull turning with its offset: what a reading that left the offset
  // out, or turned it the wrong way round, would miss.
  const jointOnly = (t: number) => {
    poseRigAction(clock.state, 'land', t);
    root.updateMatrixWorld(true);
    return new THREE.Vector3().setFromMatrixPosition(clock.joints.getObjectByName('hold')!.matrixWorld);
  };
  const turning = jointOnly(join.t + h).sub(jointOnly(join.t - h)).divideScalar(2 * h).distanceTo(fd);
  ok(turning > 0.02, `the flyable rig's hull turns as it lands, so the offset moves the vehicle apart from its joint (${turning.toFixed(3)} m/s of it)`);
  ok(target.valid && target.vel.distanceTo(fd) < 1e-3, `a landing target's velocity is the vehicle's own pose differenced across its join (${target.vel.distanceTo(fd).toExponential(1)} m/s off)`);
  const there = vehicle(join.t);
  // The turn to a ten-thousandth of a radian: `angleTo` reads a dot product's last digits through an
  // arc cosine, so two turns equal to the mixer's own precision still come out a few 1e-5 apart.
  ok(target.pos.distanceTo(there.p) < 1e-4 && target.quat.angleTo(there.q) < 1e-4, `and its place and turn are the vehicle's where the clip has it there (${target.pos.distanceTo(there.p).toExponential(1)} m, ${target.quat.angleTo(there.q).toExponential(1)} rad)`);
  ok(Math.abs(target.speed - target.vel.length()) < 1e-9 && Math.abs(target.heading - Math.atan2(target.vel.x, target.vel.z)) < 1e-9 && target.climb < 0, 'with its speed, its bearing over the ground and its climb, coming down');
  ok(!landingTarget(pad, land, null, hull.offset, makeLandingTarget()).valid, 'and no target at all without a join');
  const v = new THREE.Vector3();
  pathVelocity(land, join.t, v);
  ok(v.length() > 0 && Math.abs(v.length() - join.speed) < 0.5, `a path's velocity at its join is the join's own speed (${f2(v.length())} against ${f2(join.speed)} m/s)`);
  hull.dispose();
}

{
  // What a held shuttle and a hull flying off are both judged by.
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1e5);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const at = cam.position;
  ok(inSight(frustum, at, new THREE.Vector3(0, 0, -500), 20, 2500, 60), 'in front of the view, it is seen');
  ok(!inSight(frustum, at, new THREE.Vector3(0, 0, 500), 20, 2500, 60), 'behind it, it is not');
  ok(inSight(frustum, at, new THREE.Vector3(0, 0, 50), 20, 2500, 60), 'nearer than `near`, it is seen whichever way the view faces');
  ok(!inSight(frustum, at, new THREE.Vector3(0, 0, -3000), 20, 2500, 60), 'and past `far` it is a speck nobody sees');
}

{
  // The flyable made-up rig, which the trip's own test flies: it has a cut and a join where it should.
  const { skeleton, pieces, clips } = flyingRig();
  const assembled = assembleRigModel({ scene: skeleton.scene.clone(true), animations: skeleton.animations }, pieces, 'hold', clips);
  const hull = new RigHull(assembled, clips, { '': clips });
  const paths = hull.paths('')!;
  ok(!!paths.cut && paths.cut.t > FLYING.leap - 0.5 && paths.cut.t < FLYING.leap, `the flyable rig lets go of its hull just before its leap (${paths.cut ? f2(paths.cut.t) : 'none'} s)`);
  ok(!!paths.join && paths.join.t > FLYING.glide && paths.join.t < FLYING.glide + 0.5, `and takes it back just after its glide begins (${paths.join ? f2(paths.join.t) : 'none'} s)`);
  ok(hull.paths('') === paths, "a hull's paths for a branch are made once");
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  pathPose(paths.land, paths.land.seconds, p, q);
  ok(p.distanceTo(ROOT_REST) < 1e-6 && q.angleTo(new THREE.Quaternion()) < 1e-6, 'and its landing ends on the ground pose, level');
  // P = Pad × J × T(offset) through vehicleAt equals the parts put together by hand, and the same three
  // put together as a scene graph: a group on the pad, the joint's pose under it, the offset under that.
  hull.frame();
  const pad: Pad = { x: 10, y: 2, z: 3, yaw: 1.2 };
  const vp = new THREE.Vector3();
  const vq = new THREE.Quaternion();
  vehicleAt(pad, paths.lift, 4.2, hull.offset, vp, vq);
  pathPose(paths.lift, 4.2, p, q);
  ok(q.angleTo(new THREE.Quaternion()) > 0.05, `the flyable rig's hull joint is turned there (${f2(THREE.MathUtils.radToDeg(q.angleTo(new THREE.Quaternion())))}°), so the order of the turns shows`);
  const padGroup = new THREE.Group();
  padGroup.position.set(pad.x, pad.y, pad.z);
  padGroup.rotation.y = pad.yaw;
  const jointAt = new THREE.Object3D();
  jointAt.position.copy(p);
  jointAt.quaternion.copy(q);
  const originAt = new THREE.Object3D();
  originAt.position.copy(hull.offset);
  padGroup.add(jointAt);
  jointAt.add(originAt);
  padGroup.updateMatrixWorld(true);
  const gp = new THREE.Vector3();
  const gq = new THREE.Quaternion();
  const jp = new THREE.Vector3();
  const jq = new THREE.Quaternion();
  originAt.matrixWorld.decompose(gp, gq, new THREE.Vector3());
  jointAt.matrixWorld.decompose(jp, jq, new THREE.Vector3());
  onPad(pad, p, q);
  ok(p.distanceTo(jp) < 1e-9 && q.angleTo(jq) < 1e-6, 'a pose in the rig carried onto its pad stands where a group on the pad would hold it');
  ok(vehicleFromJoint(p, q, hull.offset, new THREE.Vector3()).distanceTo(gp) < 1e-9 && vp.distanceTo(gp) < 1e-9 && vq.angleTo(gq) < 1e-6, 'a vehicle on its pad is the joint on the pad carried by the offset, as a child of it at the offset stands');
  const v = new THREE.Vector3(3, -1, 7);
  const turned = turnOnPad(pad, v.clone());
  ok(turned.distanceTo(v.clone().transformDirection(padGroup.matrixWorld).multiplyScalar(v.length())) < 1e-9, 'and a velocity in the rig, turned onto its pad, points where the pad group turns it and keeps its length');
  ok(landingMood({ '': clips }, '') === '' && landingMood({ calm: clips, theed: clips }, 'theed') === 'calm' && landingMood({ calm: clips }, 'calm') === 'calm', 'a hull lands with the calm branch where its rig has one, and with its own where it has not');
  hull.dispose();
}

// ---------------------------------------------------------------- the game's own rigs

{
  const packs = join(process.cwd(), 'assets-private');
  const convert = 'npm run swg -- travel @SWG assets-private --retail-only';
  const rigs = packRigs(packs, readdirSync, existsSync, join);
  // The windows the design measured over the clips, a few frames either way: the calm and Theed joins
  // sit exactly on the join's acceleration limit, so they are pinned by window and not by frame.
  const want: Record<string, { cut: [number, number]; join: [number, number] }> = {
    'shuttle/': { cut: [12.4, 12.5], join: [8.8, 9.3] },
    'transport/calm': { cut: [12.5, 13.1], join: [7.9, 8.5] },
    'transport/theed': { cut: [18.5, 19.2], join: [7.8, 8.4] },
  };
  if (!Object.keys(rigs).length) note(`no converted world's travel pack carries rigs, so the game's own clips are not checked: ${convert}`);
  const table: string[] = [];
  for (const [name, rig] of Object.entries(rigs)) {
    if (!existsSync(join(packs, rig.file)) || !rig.parts.every((p) => existsSync(join(packs, p.file)))) {
      note(`${name}: its rig's files are not converted, so its clips are not checked: ${convert}`);
      continue;
    }
    const skeleton = loadGlb(join(packs, rig.file));
    const pieces = rig.parts.map((p) => ({ joint: p.joint, model: loadGlb(join(packs, p.file)).scene as THREE.Object3D }));
    const hullJoint = hullJointOf(rig);
    for (const [mood, clips] of Object.entries(rig.moods)) {
      const label = `${name}/${mood}`;
      const assembled = assembleRigModel({ scene: skeleton.scene.clone(true), animations: skeleton.animations }, pieces.map((p) => ({ joint: p.joint, model: p.model.clone(true) })), hullJoint, clips);
      const lift = rigPathOf(assembled.fullClips.get(clips.lift)!, assembled.chain);
      const land = rigPathOf(assembled.fullClips.get(clips.land)!, assembled.chain);
      const cut = takeoffCut(lift, RIG_HULL_TUNE.boostSpeed);
      const join = landingJoin(land, RIG_HULL_TUNE.maxSpeed);
      const w = want[label];
      if (w) {
        ok(!!cut && cut.t >= w.cut[0] && cut.t <= w.cut[1], `${label}: the take-off lets go at ${cut ? f2(cut.t) : 'no moment'} s, inside ${w.cut.join(' to ')}`);
        ok(!!join && join.t >= w.join[0] && join.t <= w.join[1], `${label}: the landing takes back at ${join ? f2(join.t) : 'no moment'} s, inside ${w.join.join(' to ')}`);
      } else note(`${label}: no measured window for this branch, so only its rules are held to`);
      ok(!!cut && cut.height >= RIG_PATH_TUNE.cutHeight && cut.speed >= RIG_PATH_TUNE.cutSpeedMin && cut.speed <= RIG_HULL_TUNE.boostSpeed, `${label}: at the cut it is ${cut ? `${f2(cut.height)} m up at ${f2(cut.speed)} m/s` : 'nowhere'}, high and fast enough and no faster than the boost`);
      ok(!!join && join.height >= RIG_PATH_TUNE.joinHeight && join.speed >= RIG_PATH_TUNE.joinSpeedMin && join.speed <= RIG_HULL_TUNE.maxSpeed, `${label}: at the join it is ${join ? `${f2(join.height)} m up at ${f2(join.speed)} m/s` : 'nowhere'}, high and fast enough and no faster than cruise`);
      // The nose along the path over the ground (its pitch may stand off a glide: the calm transport comes down nose level).
      for (const [what, path, m] of [['cut', lift, cut], ['join', land, join]] as const) {
        if (!m) continue;
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const v = pathVelocity(path, m.t, new THREE.Vector3()).setY(0);
        pathPose(path, m.t, p, q);
        const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0);
        const cos = v.lengthSq() > 1e-6 && nose.lengthSq() > 1e-6 ? v.normalize().dot(nose.normalize()) : 0;
        ok(cos >= 0.9, `${label}: at the ${what} its nose points along its path over the ground (cosine ${cos.toFixed(3)})`);
      }
      // The struts and the door in the sky pose already at both hand-overs, relative to the hull joint.
      const hull = new RigHull(assembled, clips, rig.moods);
      const hullJ = assembled.joints.getObjectByName(hullJoint)!;
      // Each limb's place and turn relative to the hull joint, as a role's clip poses it at a moment. The
      // place to a millimetre; the turn to a quarter of a degree, since the transport's sky pose stands
      // 0.09 degrees off its flight's own (a constant track a hair off its rest, which the swap measures too).
      const limbsAt = (role: RigPose['role'], t: number): { p: THREE.Vector3; q: THREE.Quaternion }[] => {
        hull.pose(role, t, mood);
        assembled.model.updateMatrixWorld(true);
        const inv = hullJ.matrixWorld.clone().invert();
        const out: { p: THREE.Vector3; q: THREE.Quaternion }[] = [];
        for (const p of pieces) {
          if (p.joint === hullJoint) continue;
          const j = assembled.joints.getObjectByName(p.joint);
          if (!j) continue;
          const limb = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
          inv.clone().multiply(j.matrixWorld).decompose(limb.p, limb.q, new THREE.Vector3());
          out.push(limb);
        }
        return out;
      };
      if (clips.sky && cut && join) {
        const sky = limbsAt('sky', 0);
        const gap = (a: { p: THREE.Vector3; q: THREE.Quaternion }[]) => a.reduce((w, l, i) => ({ m: Math.max(w.m, l.p.distanceTo(sky[i].p)), deg: Math.max(w.deg, THREE.MathUtils.radToDeg(l.q.angleTo(sky[i].q))) }), { m: 0, deg: 0 });
        const atCut = gap(limbsAt('lift', cut.t));
        const atJoin = gap(limbsAt('land', join.t));
        ok(atCut.m <= 1e-3 && atJoin.m <= 1e-3 && atCut.deg < 0.25 && atJoin.deg < 0.25, `${label}: the limbs are already in the sky pose at the cut and at the join (${(atCut.m * 1000).toFixed(3)} and ${(atJoin.m * 1000).toFixed(3)} mm, ${atCut.deg.toFixed(3)}° and ${atJoin.deg.toFixed(3)}°)`);
      }
      // The same answers if a physical stretch may accelerate no harder than the lower reading of it.
      const soft = { ...RIG_PATH_TUNE, cinematicAccel: 120 };
      const cut120 = takeoffCut(lift, RIG_HULL_TUNE.boostSpeed, soft);
      const join120 = landingJoin(land, RIG_HULL_TUNE.maxSpeed, soft);
      ok(cut120?.t === cut?.t && join120?.t === join?.t, `${label}: the cut and the join are the same with a physical stretch capped at 120 m/s² as at ${RIG_PATH_TUNE.cinematicAccel}`);
      // What the hull built on this branch flies: a transport out of Theed lands as the calm one does.
      const paths = hull.paths(mood);
      ok(!!paths && paths.landMood === landingMood(rig.moods, mood) && paths.join?.t === landingJoin(rigPathOf(assembled.fullClips.get(rig.moods[paths.landMood].land)!, assembled.chain), RIG_HULL_TUNE.maxSpeed)?.t, `${label}: a hull built on it lands with the ${paths?.landMood || 'only'} branch's clip`);
      hull.dispose();
      const row = (m: RigMoment | null) => (m ? `${f2(m.t)} s, ${f2(m.speed)} m/s, ${f2(m.height)} m up, ${f2(m.out)} m out, climb ${f2(m.climb)}°, nose ${f2(m.noseOff)}° off` : 'none');
      table.push(`${label.padEnd(16)} cut ${row(cut)}`);
      table.push(`${''.padEnd(16)} join ${row(join)}`);
    }
  }
  for (const line of table) note(line);
}

console.log(`\nrig path: ${passed} checks passed`);
