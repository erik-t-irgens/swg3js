// The fitter (src/anim/fit.ts): a pack clip put on a target skeleton. Run on a source skeleton and target skeletons
// made here, each target joint with a rest rotation of its own so that nothing passes by its frames happening to be
// the world's; then, where the converted packs are on disk, on every species' own body with the committed pack.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { fitClip, planFit, poseAt, skeletonKey, type FittedClip, type Quat, type TargetSkeleton } from '../../../src/anim/fit.ts';
import { ALIGN_GROUP, ALIGN_SHIPPED, SOURCE_CHILD, SOURCE_TO_JOINT, aligns } from '../../../src/anim/mixamoMap.ts';
import { toThreeClip } from '../../../src/anim/mixamoPack.ts';
import { decodeMxa, readPackIndex } from '../../../src/anim/mxaFile.ts';
import { DEG, at3, at4, glbSkeleton, makeClip, qangle, qaxis, qconj, qmul, qrot, repoRoot, sourceBones, speciesBodies, targetSkeleton } from './animFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const bones = sourceBones();
const OLD = { torso: true, feet: true, clavicles: true };
const jointAt = (t: TargetSkeleton, name: string) => t.joints.findIndex((j) => j.name === name);
const boneAt = (name: string) => bones.findIndex((b) => b.name === name);
const rest = makeClip(bones, 3, 0.1, () => [0, 0, 0, 1]);
/** A loop from its start: anchored where its own first frame has its hips. */
const still = { trimStart: 0, loop: true };
/** A one-off from its start: anchored with its hips level over their rest place. */
const once = { trimStart: 0, loop: false };
const TAU = 2 * Math.PI;

// ---- the map ---------------------------------------------------------------------------------------------------------
{
  ok(Object.keys(SOURCE_TO_JOINT).length === 34 && new Set(Object.values(SOURCE_TO_JOINT)).size === 34, 'the map drives 34 of the game\'s joints, each from one bone');
  ok(['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'].every((b) => ALIGN_GROUP[b] === 'torso') && ALIGN_GROUP.LeftShoulder === 'clavicles' && ALIGN_GROUP.RightFoot === 'feet' && ALIGN_GROUP.LeftToeBase === 'feet' && ['LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandIndex1', 'RightUpLeg', 'RightLeg'].every((b) => ALIGN_GROUP[b] === 'limbs'), 'the hips, spine, neck and head are the torso, the shoulders the clavicles, the feet and toes the feet, and the arms, hands, fingers, thighs and shins the limbs');
  ok(aligns('LeftArm', ALIGN_SHIPPED) && aligns('RightLeg', ALIGN_SHIPPED) && !aligns('Hips', ALIGN_SHIPPED) && !aligns('Spine1', ALIGN_SHIPPED) && !aligns('LeftFoot', ALIGN_SHIPPED) && !aligns('RightShoulder', ALIGN_SHIPPED) && aligns('Hips', OLD), 'as shipped only the limbs have their rests lined up; the console can line the others up too');
  ok(Object.entries(SOURCE_CHILD).every(([b, c]) => SOURCE_TO_JOINT[b] !== undefined && SOURCE_TO_JOINT[c] !== undefined), 'every line a rest is taken along runs between two bones the map drives');
}

// ---- rest in, rest out -------------------------------------------------------------------------------------------------
{
  const t = targetSkeleton();
  const plan = planFit(bones, t, ALIGN_SHIPPED);
  const r = plan.report;
  ok(r.mapped === 24 && r.mapped === t.joints.filter((j) => Object.values(SOURCE_TO_JOINT).includes(j.name)).length && r.missing.length === 0 && r.rest.join() === 'face_root,lUlna,hold_l,rUlna', `on a skeleton with a root, a spine, arms with an ulna and legs it drives ${r.mapped} joints and leaves the ulnas, the face and the hold point at rest (${r.rest.join(', ')})`);
  ok(Math.abs(r.facing) < 1e-6 && r.toes > 0.99, 'two figures that face the same way need no turning, and their toes agree');
  const fitted = fitClip(plan, rest, still);
  const pose = poseAt(plan, t.base, fitted, 1);
  // The torso and the feet come out exactly at rest; the limbs take the source's rest directions.
  const torso = ['root', 'spine1', 'spine2', 'spine3', 'neck', 'Head', 'lClav', 'rClav', 'lAnkle', 'rAnkle', 'lToe', 'rToe'];
  let worst = 0;
  for (const name of torso) worst = Math.max(worst, qangle(at4(pose.q, jointAt(t, name)), at4(plan.restWorldQ, jointAt(t, name))));
  ok(worst < 1e-4, `the source at rest leaves the hips, the spine, the neck, the head, the clavicles and the feet at their own rest (worst ${worst.toExponential(1)} degrees)`);
  ok(r.hipsTilt < 1e-6 && r.spineTilt < 1e-6, 'and the report says so: the standing rest turns neither the hips nor the spine');
  const root = jointAt(t, 'root');
  ok(Math.hypot(pose.p[root * 3] - plan.restWorldP[root * 3], pose.p[root * 3 + 1] - plan.restWorldP[root * 3 + 1], pose.p[root * 3 + 2] - plan.restWorldP[root * 3 + 2]) < 1e-6, 'the root stands where it rests');
  // A limb takes the source's direction: the target's arm, which rests forty degrees below level, comes out level.
  const arm = at3(pose.p, jointAt(t, 'lForeArm')).map((v, i) => v - pose.p[jointAt(t, 'lArm') * 3 + i]);
  const src = bones[boneAt('LeftForeArm')].rest.map((v, i) => v - bones[boneAt('LeftArm')].rest[i]);
  const cos = (arm[0] * src[0] + arm[1] * src[1] + arm[2] * src[2]) / (Math.hypot(...arm) * Math.hypot(...src));
  ok(cos > 1 - 1e-9, 'a limb is lined up with the source\'s: the arm that rests forty degrees below level comes out level, as the source\'s rests');
  // An unmapped joint between two driven ones keeps its rest under its parent; the driven joint beyond it still lands.
  const ulna = fitted.joints.includes('lUlna');
  const wrist = at3(pose.p, jointAt(t, 'lWrist')).map((v, i) => v - pose.p[jointAt(t, 'lForeArm') * 3 + i]);
  const wcos = (wrist[0] * src[0] + wrist[1] * src[1] + wrist[2] * src[2]) / (Math.hypot(...wrist) * Math.hypot(...src));
  ok(!ulna && wcos > 1 - 1e-9, 'the ulna has no track of its own and rides its forearm, so the wrist beyond it lies on the forearm\'s line');
  // And under a forearm that moves: the elbow bent 50 degrees, the hand and the finger rigid on it (each bone's turn is
  // its own from rest, in the world, so the three carry the same one). The wrist is written under the ulna, so its
  // turn in the world is the bend only if the fit took the ulna to ride the forearm: every hand in every clip.
  const bend = qaxis(0.2, 1, 0.3, 50 * DEG);
  const elbow = makeClip(bones, 2, 0.1, (b) => (/^Left(ForeArm|Hand|HandIndex1)$/.test(b) ? bend : [0, 0, 0, 1]));
  const bent = poseAt(plan, t.base, fitClip(plan, elbow, still), 1);
  const wj = jointAt(t, 'lWrist'), ij = jointAt(t, 'lIndex01'), uj = jointAt(t, 'lUlna'), fj = jointAt(t, 'lForeArm');
  ok(qangle(qmul(at4(bent.q, wj), qconj(at4(pose.q, wj))), bend) < 1e-3 && qangle(qmul(at4(bent.q, uj), qconj(at4(pose.q, uj))), bend) < 1e-3, 'bend the elbow and the ulna rides the forearm through the bend, and the wrist beyond it turns in the world by the bend and nothing else');
  const off = (p: Float64Array, a: number, b: number) => [p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]];
  const want = qrot(bend, off(pose.p, ij, fj));
  const got = off(bent.p, ij, fj);
  ok(Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]) < 1e-6, 'and the finger\'s first joint stands where the bend carries it from the elbow: the whole hand goes round with the forearm');
  // A target whose limbs already rest as the source's do comes out at rest whole.
  const tpose = targetSkeleton({ arms: 0 });
  const p2 = planFit(bones, tpose, ALIGN_SHIPPED);
  const f2 = fitClip(p2, rest, still);
  let w2 = 0;
  f2.joints.forEach((name, i) => {
    // The target's legs rest a little off the source's line, so they are lined up, and the ankle under a shin that
    // moved keeps its place in the world by turning under it.
    if (/Thigh|Shin|Ankle/.test(name)) return;
    w2 = Math.max(w2, qangle(at4(f2.rotations[i], 1), tpose.joints[jointAt(tpose, name)].restQ));
  });
  ok(w2 < 1e-3, `rest in gives rest out: on a target whose arms rest as the source's do, every driven joint above the legs, and the toes, keeps its own rest rotation under its parent (worst ${w2.toExponential(1)} degrees)`);
  ok(f2.rootJoint === 'root' && Math.hypot(f2.rootPosition[3] - tpose.joints[0].restP[0], f2.rootPosition[4] - tpose.joints[0].restP[1], f2.rootPosition[5] - tpose.joints[0].restP[2]) < 1e-6, 'and the root\'s track holds its rest place');
}

// ---- a limb's last joint ------------------------------------------------------------------------------------------------
{
  // The game's fingers end at their second joint, so that joint has no next one to be lined up along.
  const fb = sourceBones({ fingers: true });
  const t = targetSkeleton({ fingers: true });
  const plan = planFit(fb, t, ALIGN_SHIPPED);
  ok(plan.report.mapped === 26 && plan.report.missing.length === 0, 'a skeleton whose index fingers have their second joint is driven there too (26 joints)');
  const stand = fitClip(plan, makeClip(fb, 2, 0.1, () => [0, 0, 0, 1]), still);
  const restOf = (name: string) => t.joints[jointAt(t, name)].restQ;
  const local = (f: FittedClip, name: string) => at4(f.rotations[f.joints.indexOf(name)], 1);
  ok(qangle(local(stand, 'lIndex02'), restOf('lIndex02')) < 1e-3 && qangle(local(stand, 'rIndex02'), restOf('rIndex02')) < 1e-3, 'with the source at rest a finger\'s end keeps its own rest under its first joint: it takes that joint\'s alignment, having no line of its own');
  // The control: its first joint is lined up (the target's arm rests forty degrees below level), so a tip left
  // unaligned under it would stand bent by that much.
  const pose = poseAt(plan, t.base, stand, 1);
  const turn = (name: string) => qmul(at4(pose.q, jointAt(t, name)), qconj(at4(plan.restWorldQ, jointAt(t, name))));
  ok(qangle(turn('lIndex01'), [0, 0, 0, 1]) > 30 && qangle(turn('lIndex02'), turn('lIndex01')) < 1e-3, `the first joint is turned ${qangle(turn('lIndex01'), [0, 0, 0, 1]).toFixed(0)} degrees from its own rest by the line-up, and the tip goes with it`);
  const curl = qaxis(0, 0.2, 1, 35 * DEG);
  const curled = fitClip(plan, makeClip(fb, 2, 0.1, (b) => (b === 'LeftHandIndex2' ? curl : [0, 0, 0, 1])), still);
  ok(Math.abs(qangle(local(curled, 'lIndex02'), restOf('lIndex02')) - 35) < 1e-3 && qangle(local(curled, 'rIndex02'), restOf('rIndex02')) < 1e-3, 'curled 35 degrees on the source it is curled 35 degrees under its first joint, and nothing is added at a fingertip');
}

// ---- the pelvis ---------------------------------------------------------------------------------------------------------
{
  // The game's root-to-spine line leans 33 degrees forward where the source's stands upright.
  const t = targetSkeleton({ lean: 33 });
  const shipped = planFit(bones, t, ALIGN_SHIPPED).report;
  const old = planFit(bones, t, OLD).report;
  ok(shipped.hipsTilt < 1e-6, 'a target whose hip-to-spine line leans 33 degrees keeps its hips upright: the standing rest turns them by nothing');
  ok(Math.abs(old.hipsTilt - 33) < 0.5, `and the old rule, which lined every bone up with its next joint, tips them ${old.hipsTilt.toFixed(1)} degrees: the control`);
  ok(planFit(bones, targetSkeleton({ lean: 10 }), OLD).report.hipsTilt < planFit(bones, targetSkeleton({ lean: 20 }), OLD).report.hipsTilt, 'by more the more the line leans');
  // Which way: the old rule tips the hips' top back, as the brief saw it (the pelvis tilted back, the belly pulled in).
  const plan = planFit(bones, t, OLD);
  const fitted = fitClip(plan, rest, still);
  const pose = poseAt(plan, t.base, fitted, 0);
  const root = jointAt(t, 'root');
  const turn = qmul(at4(pose.q, root), qconj(at4(plan.restWorldQ, root)));
  const up = qrot(turn, [0, 1, 0]);
  ok(up[2] < -0.4 && Math.abs(up[0]) < 1e-6, `backwards: what was up on the hips points ${Math.round(Math.atan2(-up[2], up[1]) / DEG)} degrees back`);
  // Each group is its own switch.
  const feetPlan = planFit(bones, t, { torso: false, feet: true, clavicles: false });
  const feetPose = poseAt(feetPlan, t.base, fitClip(feetPlan, rest, still), 0);
  const ankle = jointAt(t, 'lAnkle'), clav = jointAt(t, 'lClav');
  ok(feetPlan.report.hipsTilt < 1e-6 && qangle(at4(feetPose.q, ankle), at4(feetPlan.restWorldQ, ankle)) > 1 && qangle(at4(feetPose.q, clav), at4(feetPlan.restWorldQ, clav)) < 1e-4, 'each group is a switch of its own: lining the feet up alone turns the ankles and leaves the hips and the clavicles alone');
  const clavPlan = planFit(bones, t, { torso: false, feet: false, clavicles: true });
  const clavPose = poseAt(clavPlan, t.base, fitClip(clavPlan, rest, still), 0);
  ok(clavPlan.report.hipsTilt < 1e-6 && qangle(at4(clavPose.q, clav), at4(clavPlan.restWorldQ, clav)) > 1 && qangle(at4(clavPose.q, ankle), at4(clavPlan.restWorldQ, ankle)) < 1e-4, 'and the clavicles alone turn the clavicles and leave the hips and the ankles');
  ok(Math.abs(shipped.feet.left) < 0.03 && Math.abs(shipped.feet.right) < 0.03, `as shipped the standing rest leaves each ankle within three centimetres of where it rests (${(shipped.feet.left * 100).toFixed(1)} and ${(shipped.feet.right * 100).toFixed(1)} cm)`);
}

// ---- a turn is carried over ----------------------------------------------------------------------------------------------
{
  const t = targetSkeleton();
  const plan = planFit(bones, t, ALIGN_SHIPPED);
  // The source bows its hips 30 degrees forward (about its left-right axis), everything riding them.
  const bow = qaxis(1, 0, 0, 30 * DEG);
  const clip = makeClip(bones, 2, 0.1, () => bow);
  const pose = poseAt(plan, t.base, fitClip(plan, clip, still), 1);
  let worst = 0;
  for (const name of ['root', 'spine2', 'Head', 'lAnkle']) {
    const j = jointAt(t, name);
    worst = Math.max(worst, qangle(qmul(at4(pose.q, j), qconj(at4(plan.restWorldQ, j))), bow));
  }
  ok(worst < 1e-3, 'a bone\'s turn away from its rest is the joint\'s turn away from its own, in the world: a 30 degree bow is a 30 degree bow');
  // One bone alone: only its joint and what hangs from it move.
  const nod = makeClip(bones, 2, 0.1, (b) => (b === 'Head' ? qaxis(1, 0, 0, 20 * DEG) : [0, 0, 0, 1]));
  const p2 = poseAt(plan, t.base, fitClip(plan, nod, still), 1);
  ok(qangle(at4(p2.q, jointAt(t, 'neck')), at4(plan.restWorldQ, jointAt(t, 'neck'))) < 1e-4 && Math.abs(qangle(at4(p2.q, jointAt(t, 'Head')), at4(plan.restWorldQ, jointAt(t, 'Head'))) - 20) < 1e-3 && Math.abs(qangle(at4(p2.q, jointAt(t, 'face_root')), at4(plan.restWorldQ, jointAt(t, 'face_root'))) - 20) < 1e-3, 'a nod turns the head and the face that hangs from it, and nothing below');
}

// ---- facing -------------------------------------------------------------------------------------------------------------
{
  // A target that faces the other way: the source's forward bow must be a bow toward the target's own front.
  const t = targetSkeleton({ yaw: 180 });
  const plan = planFit(bones, t, ALIGN_SHIPPED);
  ok(Math.abs(Math.abs(plan.report.facing) - 180) < 1e-3 && plan.report.toes > 0.99, `a target built facing the other way is turned to by ${Math.abs(plan.report.facing).toFixed(0)} degrees, and its toes agree`);
  const bow = makeClip(bones, 2, 0.1, () => qaxis(1, 0, 0, 30 * DEG), () => [0.3, 0, 1]);
  const fitted = fitClip(plan, bow, still);
  const pose = poseAt(plan, t.base, fitted, 1);
  const root = jointAt(t, 'root');
  const up = qrot(qmul(at4(pose.q, root), qconj(at4(plan.restWorldQ, root))), [0, 1, 0]);
  ok(up[2] < -0.45, 'a bow forward is a bow toward the target\'s front, which here is -Z');
  const tq = targetSkeleton({ yaw: 90 });
  const quarter = planFit(bones, tq, ALIGN_SHIPPED);
  ok(Math.abs(quarter.report.facing - 90) < 1e-3 && quarter.report.toes > 0.99, 'and a quarter turn is a quarter turn');
  // On the quarter-turned figure, whose front is +X and whose left is -Z (a half turn cannot tell a turn from its inverse).
  const qp = poseAt(quarter, tq.base, fitClip(quarter, bow, still), 1);
  const rq = jointAt(tq, 'root');
  const upq = qrot(qmul(at4(qp.q, rq), qconj(at4(quarter.restWorldQ, rq))), [0, 1, 0]);
  ok(upq[0] > 0.45 && Math.abs(upq[2]) < 1e-6, 'there a bow forward is a bow toward +X: a bone\'s turn is turned by the facing, the right way round');
  // A lean to the side is a turn about the source's front-to-back axis, the other half of the facing's turn of a turn.
  const lean = makeClip(bones, 2, 0.1, () => qaxis(0, 0, 1, 30 * DEG));
  const lp = poseAt(quarter, tq.base, fitClip(quarter, lean, still), 1);
  const upl = qrot(qmul(at4(lp.q, rq), qconj(at4(quarter.restWorldQ, rq))), [0, 1, 0]);
  const wantLean = qrot(qaxis(0, 1, 0, 90 * DEG), qrot(qaxis(0, 0, 1, 30 * DEG), [0, 1, 0]));
  ok(upl[0] * wantLean[0] + upl[1] * wantLean[1] + upl[2] * wantLean[2] > 1 - 1e-6 && wantLean[2] > 0.45, `and a lean to the source's right is a lean to this figure's own right, which is +Z (${upl.map((v) => v.toFixed(3)).join(' ')})`);
  const armq = at3(qp.p, jointAt(tq, 'lForeArm')).map((v, i) => v - qp.p[jointAt(tq, 'lArm') * 3 + i]);
  // The source's arm lies along its left (+X), bowed with the hips; on this figure left is -Z.
  const wantArm = qrot(qaxis(0, 1, 0, 90 * DEG), qrot(qaxis(1, 0, 0, 30 * DEG), [1, 0, 0]));
  ok((armq[0] * wantArm[0] + armq[1] * wantArm[1] + armq[2] * wantArm[2]) / Math.hypot(...armq) > 1 - 1e-9, 'and its arm lies along its own left: the line a limb is lined up with is the source\'s, turned by the facing');
  // A figure whose root hangs from something turned and moved (a holder between the rig's root and the skeleton).
  const held = targetSkeleton();
  held.base = { p: [0.3, 0.2, -0.1], q: qaxis(0, 1, 0, 90 * DEG) };
  const hp = planFit(bones, held, ALIGN_SHIPPED);
  ok(Math.abs(hp.report.facing - 90) < 1e-3, 'a figure turned by what its root hangs from is faced by where its joints stand in the world');
  const stepped = fitClip(hp, makeClip(bones, 3, 1, () => [0, 0, 0, 1], (s) => [0, 0.1 * (s < 0.6 ? 1 : 0), s < 0.6 ? 0.4 * s : 0.4 * (1 - s) * 1.5]), still);
  const hpose = poseAt(hp, held.base, stepped, 1);
  const hr = jointAt(held, 'root');
  const went = [hpose.p[hr * 3] - hp.restWorldP[hr * 3], hpose.p[hr * 3 + 1] - hp.restWorldP[hr * 3 + 1], hpose.p[hr * 3 + 2] - hp.restWorldP[hr * 3 + 2]];
  ok(Math.abs(went[0] - hp.scale * 0.2) < 1e-6 && Math.abs(went[1] - hp.scale * 0.1) < 1e-6 && Math.abs(went[2]) < 1e-6, 'and its travel, written in the frame of what the root hangs from, comes out in the world toward the figure\'s own front and straight up');
}

// ---- one sign down each joint's frames, whatever the clip handed in ----------------------------------------------------------
{
  const t = targetSkeleton();
  const plan = planFit(bones, t, ALIGN_SHIPPED);
  const clip = makeClip(bones, 9, 1, (b, s) => (b === 'Head' ? qaxis(0.3, 1, 0.2, 2.5 * s) : [0, 0, 0, 1]));
  // The same turns, every other frame of the head's written with the other sign.
  const head = boneAt('Head');
  for (let f = 1; f < 9; f += 2) for (let c = 0; c < 4; c++) clip.quats[(f * clip.bones + head) * 4 + c] *= -1;
  const fitted = fitClip(plan, clip, still);
  const track = fitted.rotations[fitted.joints.indexOf('Head')];
  let least = 1;
  for (let f = 1; f < 9; f++) least = Math.min(least, track[f * 4] * track[f * 4 - 4] + track[f * 4 + 1] * track[f * 4 - 3] + track[f * 4 + 2] * track[f * 4 - 2] + track[f * 4 + 3] * track[f * 4 - 1]);
  ok(least > 0.9, `a joint's frames come out with one sign, so the mixer blends neighbours the short way, whichever sign each frame came in with (least dot ${least.toFixed(3)})`);
}

// ---- the travel: scaled, turned, and stripped -----------------------------------------------------------------------------
{
  const t = targetSkeleton();
  const plan = planFit(bones, t, ALIGN_SHIPPED);
  const srcLeg = bones[0].rest[1] - bones[boneAt('LeftFoot')].rest[1];
  const tgtLeg = plan.restWorldP[jointAt(t, 'root') * 3 + 1] - plan.restWorldP[jointAt(t, 'lAnkle') * 3 + 1];
  ok(Math.abs(plan.scale - tgtLeg / srcLeg) < 1e-9 && Math.abs(plan.report.scale - plan.scale) < 1e-12, `the hips' travel is scaled by the two skeletons' leg heights, hips down to ankles (${plan.scale.toFixed(3)})`);
  const tall = planFit(bones, targetSkeleton({ height: 2 }), ALIGN_SHIPPED);
  ok(Math.abs(tall.scale / plan.scale - 2) < 1e-9, 'a figure twice as tall takes twice the travel');
  const rootPos = (f: FittedClip, i: number) => [f.rootPosition[i * 3], f.rootPosition[i * 3 + 1], f.rootPosition[i * 3 + 2]];
  const restP = t.joints[0].restP;
  // A loop that travels 2 m forward and 0.6 m to the left a cycle, swaying and bobbing as it goes.
  const loop = makeClip(bones, 31, 1, () => [0, 0, 0, 1], (s) => [0.6 * s + 0.05 * Math.sin(s * TAU), 0.04 * Math.sin(s * 2 * TAU), 2 * s + 0.02 * Math.cos(s * TAU) - 0.02]);
  const fl = fitClip(plan, loop, still);
  const first = rootPos(fl, 0), last = rootPos(fl, 30), mid = rootPos(fl, 8);
  ok(Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) < 1e-6, 'a loop that travels ends where it began: its net travel is taken out as a straight ramp');
  ok(Math.abs(mid[0] - restP[0] - plan.scale * 0.05 * Math.sin((8 / 30) * TAU)) < 1e-5 && Math.abs(mid[1] - restP[1] - plan.scale * 0.04 * Math.sin((8 / 30) * 2 * TAU)) < 1e-5, 'and keeps its sway and its bob, scaled: what is level and returns is the clip\'s own, and height is kept as authored');
  ok(fl.strays < 0.06 && fl.strays > 0.01, `it says how far its hips stray from where they began (${fl.strays.toFixed(3)} m)`);
  // A one-off that falls and then walks 1 m on, authored 9 cm to one side and 7 cm back of the source's origin from
  // its first frame to its last (as the jump's start is, feet and all): started at its trim, it begins and ends with
  // its hips level over their rest place.
  const land = makeClip(bones, 61, 2, () => [0, 0, 0, 1], (s) => [-0.09 + 0.1 * s, s < 0.5 ? 1.5 - 3 * s : 0, -0.07 + (s < 0.5 ? 0.3 * s : 0.15 + 0.85 * ((s - 0.5) / 1.5) ** 2)]);
  const ft = fitClip(plan, land, { trimStart: 0.5, loop: false });
  const at = (s: number) => rootPos(ft, Math.round(s * 30));
  const level = (p: number[]) => Math.hypot(p[0] - restP[0], p[2] - restP[2]);
  ok(level(at(0)) < 1e-6 && level(at(0.3)) < 1e-6 && level(at(0.5)) < 1e-6, 'a one-off is held level over its hips\' rest place until its trim, wherever its take happened to begin');
  ok(level(at(2)) < 1e-6, 'and ends there, whatever it travelled: no clip moves the body, and every one-off ends over the same spot');
  ok(level(at(1.2)) > 0.01 && ft.strays > 0.01 && Math.abs(ft.strays - Math.max(...Array.from({ length: 61 }, (_, f) => level(rootPos(ft, f))))) < 1e-6, `between the two it strays as its own motion has it, and says how far from that spot (${ft.strays.toFixed(3)} m)`);
  ok(Math.abs(at(0)[1] - restP[1] - plan.scale * 1.5) < 1e-5 && Math.abs(at(1)[1] - restP[1]) < 1e-5, 'while its height is its own: the fall is kept');
  const whole = fitClip(plan, land, once);
  ok(level(rootPos(whole, 0)) < 1e-6 && Math.hypot(rootPos(whole, 15)[0] - rootPos(whole, 0)[0], rootPos(whole, 15)[2] - rootPos(whole, 0)[2]) > 0.05, 'with no trim the same clip strays before that moment: the strip is anchored at the trim');
  // The same samples played round keep the place their own first frame has: a cycle's hips sway about the source's
  // origin, and that is its pose.
  const asLoop = fitClip(plan, land, still);
  ok(Math.abs(rootPos(asLoop, 0)[0] - restP[0] + plan.scale * 0.09) < 1e-6 && Math.abs(rootPos(asLoop, 0)[2] - restP[2] + plan.scale * 0.07) < 1e-6 && Math.hypot(rootPos(asLoop, 60)[0] - rootPos(asLoop, 0)[0], rootPos(asLoop, 60)[2] - rootPos(asLoop, 0)[2]) < 1e-6, 'a loop is anchored where its own first frame has its hips, and ends there');
  // Levelled.
  const high = makeClip(bones, 11, 1, () => [0, 0, 0, 1], (s) => [0, 0.33 + 0.02 * Math.sin(s * TAU), 0]);
  const lev = fitClip(plan, high, { trimStart: 0, loop: true, level: 0.33 });
  ok(Math.abs(rootPos(lev, 0)[1] - restP[1]) < 1e-6 && Math.abs(rootPos(fitClip(plan, high, still), 0)[1] - restP[1] - plan.scale * 0.33) < 1e-6, 'a clip given a level has that height taken off its hips, and one without rides where it was authored');
  // Turned with the facing.
  const tq = targetSkeleton({ yaw: 90 });
  const pq = planFit(bones, tq, ALIGN_SHIPPED);
  const fq = fitClip(pq, makeClip(bones, 3, 1, () => [0, 0, 0, 1], (s) => [0, 0, s < 0.6 ? 0.4 * s : 0.4 * (1 - s) * 1.5]), still);
  const base = tq.joints[0].restP;
  // The root's rest frame is turned too: compare in the figure's frame.
  const moved = qrot(tq.joints[0].parent < 0 ? [0, 0, 0, 1] : [0, 0, 0, 1], [fq.rootPosition[3] - base[0], fq.rootPosition[4] - base[1], fq.rootPosition[5] - base[2]]);
  ok(Math.abs(moved[0] - pq.scale * 0.2) < 1e-6 && Math.abs(moved[2]) < 1e-6, 'travel toward the source\'s front is travel toward the target\'s, which on a figure turned a quarter is +X');
}

// ---- fitted again in place ------------------------------------------------------------------------------------------------
{
  const t = targetSkeleton();
  const clip = makeClip(bones, 21, 1, (b, s) => (b === 'Hips' ? qaxis(1, 0, 0, 0.3 * s) : b === 'LeftArm' ? qaxis(0, 0, 1, s) : [0, 0, 0, 1]), (s) => [0, 0, s * s]);
  const plan = planFit(bones, t, ALIGN_SHIPPED);
  const fitted = fitClip(plan, clip, { trimStart: 0.4, loop: false });
  const arrays = [...fitted.rotations, fitted.rootPosition, fitted.times];
  const before = fitted.rotations.map((a) => a.slice());
  const rootBefore = fitted.rootPosition.slice();
  const again = fitClip(planFit(bones, t, OLD), clip, { trimStart: 0.4, loop: false }, fitted);
  ok(again === fitted && arrays.every((a, i) => a === [...again.rotations, again.rootPosition, again.times][i]), 'a clip fitted again into itself is the same clip and the same arrays: whatever plays them plays the new values');
  const rootTrack = fitted.joints.indexOf('root');
  ok(before[rootTrack].some((v, i) => Math.abs(v - fitted.rotations[rootTrack][i]) > 0.05), 'and the values are the new fit\'s (the hips, lined up the old way, are turned)');
  fitClip(plan, clip, { trimStart: 0.4, loop: false }, fitted);
  ok(before.every((a, i) => a.every((v, k) => Math.abs(v - fitted.rotations[i][k]) < 1e-7)), 'fitted back, they are the first fit\'s again');
  fitClip(plan, clip, { trimStart: 0.8, loop: false }, fitted);
  ok(rootBefore.some((v, i) => Math.abs(v - fitted.rootPosition[i]) > 0.01), 'a trim moved moves where the travel is held and stripped from, in place');
  // As a three.js clip the arrays are the tracks' own.
  const three = toThreeClip('mx_test', fitted);
  ok(three.name === 'mx_test' && three.tracks.length === fitted.joints.length + 1 && three.tracks.every((tr, i) => (i < fitted.joints.length ? tr.values === fitted.rotations[i] && tr.name === `${fitted.joints[i]}.quaternion` : tr.values === fitted.rootPosition && tr.name === 'root.position')), 'a fitted clip\'s three.js tracks hold the very arrays the fit writes, one rotation track a driven joint and the root\'s place');
  // And a mixer playing it shows a fit written in place at its next update, with nothing rebuilt.
  const root = new THREE.Group();
  const made = new Map<string, THREE.Bone>();
  for (const j of t.joints) {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.restP);
    b.quaternion.fromArray(j.restQ);
    made.set(j.name, b);
    (j.parent < 0 ? root : made.get(t.joints[j.parent].name)!).add(b);
  }
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(three);
  action.play();
  mixer.setTime(0.5);
  const hips = made.get('root')!;
  const shown: Quat = [hips.quaternion.x, hips.quaternion.y, hips.quaternion.z, hips.quaternion.w];
  ok(qangle(shown, at4(fitted.rotations[rootTrack], 10)) < 1e-3, 'played by three\'s own mixer, a joint shows the fitted value at that time');
  fitClip(planFit(bones, t, OLD), clip, { trimStart: 0.4, loop: false }, fitted);
  mixer.setTime(0.5);
  const now: Quat = [hips.quaternion.x, hips.quaternion.y, hips.quaternion.z, hips.quaternion.w];
  ok(qangle(now, shown) > 20 && qangle(now, at4(fitted.rotations[rootTrack], 10)) < 1e-3, 'and after a fit written in place the same action shows the new value: nothing was made again');
}

// ---- a skeleton's key -----------------------------------------------------------------------------------------------------
{
  const a = skeletonKey(targetSkeleton()), b = skeletonKey(targetSkeleton()), c = skeletonKey(targetSkeleton({ lean: 32 })), d = skeletonKey(targetSkeleton({ ulna: false }));
  ok(a === b && a !== c && a !== d && c !== d, 'two skeletons of one rest pose share a key, and a joint leaning a degree otherwise, or missing, makes another');
  const far = targetSkeleton();
  far.base.p = [0, 0.5, 0];
  ok(skeletonKey(far) !== a, 'as does the place its root hangs from');
}

// ---- a skeleton with less -------------------------------------------------------------------------------------------------
{
  const noToes = targetSkeleton({ toes: false });
  const plan = planFit(bones, noToes, ALIGN_SHIPPED);
  ok(plan.report.missing.includes('lToe') && plan.report.missing.includes('rToe') && plan.report.toes === 1 && plan.driven.length === plan.report.mapped, 'a skeleton without toes is fitted without them, and says which joints it had not got');
  const none: TargetSkeleton = { joints: [{ name: 'mixamorigHips', parent: -1, restP: [0, 1, 0], restQ: [0, 0, 0, 1] }, { name: 'mixamorigSpine', parent: 0, restP: [0, 0.1, 0], restQ: [0, 0, 0, 1] }], base: { p: [0, 0, 0], q: [0, 0, 0, 1] } };
  const empty = planFit(bones, none, ALIGN_SHIPPED);
  ok(empty.driven.length === 0 && empty.root === -1 && empty.report.mapped === 0 && empty.report.missing.length === bones.filter((b) => SOURCE_TO_JOINT[b.name]).length, 'a skeleton with none of the game\'s joints (the placeholder\'s) drives nothing, and the game then hands it no clip');
  assert.throws(() => planFit(bones, { joints: [{ name: 'spine1', parent: 1, restP: [0, 0, 0], restQ: [0, 0, 0, 1] }, { name: 'root', parent: -1, restP: [0, 0, 0], restQ: [0, 0, 0, 1] }], base: none.base }, ALIGN_SHIPPED), /before its parent/, 'a skeleton listed child first is refused');
  checks++;
}

// ---- every converted species' own body, with the committed pack -------------------------------------------------------------
{
  const root = repoRoot(import.meta.url);
  const packDir = join(root, 'public', 'anims', 'mixamo');
  const species = speciesBodies(root);
  if (!species.length || !existsSync(join(packDir, 'index.json'))) note('no converted species on disk (assets-private/characters): the real bodies are not fitted here');
  else {
    const index = readPackIndex(JSON.parse(readFileSync(join(packDir, 'index.json'), 'utf8')));
    if (typeof index === 'string') throw new Error(index);
    const load = (id: string) => ({ row: index.clips.find((c) => c.id === id)!, clip: decodeMxa(readFileSync(join(packDir, `${id}.mxa`))) });
    const tread = load('treading_water');
    const landing = load('falling_to_landing');
    const float = load('floating');
    const oneOffs = ['falling_to_landing', 'hard_landing', 'jumping_down', 'jumping_up', 'falling_flat_impact'].map(load);
    const standing = makeClip(index.bones, 2, 0.1, () => [0, 0, 0, 1]);
    const TIPS = ['lThumb02', 'lIndex02', 'lRing02', 'rThumb02', 'rIndex02', 'rRing02'];
    const srcHips = at4(tread.clip.quats, 0);
    const keys = new Set<string>();
    const lines: string[] = [];
    let worstTip = 0, worstEnd = 0, worstFeet = 0;
    for (const s of species) {
      const t = glbSkeleton(s.body);
      const plan = planFit(index.bones, t, ALIGN_SHIPPED);
      const r = plan.report;
      keys.add(skeletonKey(t));
      assert.ok(r.mapped === 34 && r.missing.length === 0, `${s.id}: every one of the map's 34 joints is on its skeleton (${r.mapped}, missing ${r.missing.join(', ') || 'none'})`);
      assert.ok(Math.abs(r.facing) < 1 && r.toes > 0.98, `${s.id}: it faces as the source does (${r.facing.toFixed(2)} degrees, toes ${r.toes.toFixed(3)})`);
      assert.ok(r.hipsTilt < 1e-6 && r.spineTilt < 1e-6, `${s.id}: the standing rest leaves its hips and spine at rest`);
      assert.ok(Math.abs(r.feet.left) < 0.02 && Math.abs(r.feet.right) < 0.02, `${s.id}: the standing rest leaves each ankle within two centimetres of the ground (${(r.feet.left * 100).toFixed(1)}, ${(r.feet.right * 100).toFixed(1)} cm)`);
      // The tread's first frame: the hips carry the source's own turn there and nothing more. (The source's own hips
      // are bowed 35 degrees forward in that frame, so "upright" is not the test: "nothing added" is.)
      const fitted = fitClip(plan, tread.clip, tread.row);
      const pose = poseAt(plan, t.base, fitted, 0);
      const j = plan.root;
      const added = qangle(qmul(at4(pose.q, j), qconj(at4(plan.restWorldQ, j))), srcHips);
      assert.ok(added < 2, `${s.id}: in the tread's first frame its hips are turned from rest as the source's are, within 2 degrees (${added.toFixed(3)})`);
      const old = planFit(index.bones, t, OLD);
      const oldPose = poseAt(old, t.base, fitClip(old, tread.clip, tread.row), 0);
      const oldAdded = qangle(qmul(at4(oldPose.q, j), qconj(at4(old.restWorldQ, j))), srcHips);
      assert.ok(oldAdded > 25 && old.report.hipsTilt > 25, `${s.id}: and the old rule adds ${oldAdded.toFixed(1)} degrees to them (the control)`);
      // The landing's last frame stands: both ankles near the ground, the hips over the feet.
      const fl = fitClip(plan, landing.clip, landing.row);
      const end = poseAt(plan, t.base, fl, fl.frames - 1);
      const la = t.joints.findIndex((x) => x.name === 'lAnkle'), ra = t.joints.findIndex((x) => x.name === 'rAnkle');
      const dl = end.p[la * 3 + 1] - plan.restWorldP[la * 3 + 1], dr = end.p[ra * 3 + 1] - plan.restWorldP[ra * 3 + 1];
      assert.ok(Math.abs(dl) < 0.06 && Math.abs(dr) < 0.06, `${s.id}: the landing ends with both ankles within six centimetres of where they stand (${(dl * 100).toFixed(1)}, ${(dr * 100).toFixed(1)} cm)`);
      assert.ok(Math.hypot(fl.rootPosition[0] - fl.rootPosition[(fl.frames - 1) * 3], fl.rootPosition[2] - fl.rootPosition[(fl.frames - 1) * 3 + 2]) < 1e-6, `${s.id}: and with its hips where they began, level`);
      // Every one-off the game plays begins (at its trim) and ends with its hips level over their rest place: the
      // landings all end standing on one spot, and the jump's start, authored a tenth of a metre to one side, is
      // played over the body's own middle.
      const restRoot = t.joints[j].restP;
      const levelOff = (f: FittedClip, frame: number) => Math.hypot(f.rootPosition[frame * 3] - restRoot[0], f.rootPosition[frame * 3 + 2] - restRoot[2]);
      const stand = poseAt(plan, t.base, fitClip(plan, standing, still), 0);
      const feetX = (p: Float64Array) => (p[la * 3] + p[ra * 3]) / 2;
      for (const o of oneOffs) {
        const fo = fitClip(plan, o.clip, o.row);
        const at = Math.min(fo.frames - 1, Math.ceil((o.row.trimStart / o.row.duration) * (fo.frames - 1)));
        const off = Math.max(levelOff(fo, 0), levelOff(fo, fo.frames - 1));
        worstEnd = Math.max(worstEnd, off);
        assert.ok(!o.row.loop && off < 1e-5, `${s.id}: ${o.row.id} is held, and ends, with its hips level over their rest place (${(off * 1000).toFixed(3)} mm off)`);
        // Standing at its end (the three landings) and at its start (the jump): the feet's middle under the body's.
        if (o.row.id === 'falling_flat_impact') continue;
        const posed = poseAt(plan, t.base, fo, o.row.id === 'jumping_up' ? at : fo.frames - 1);
        const feet = Math.abs(feetX(posed.p) - feetX(stand.p));
        worstFeet = Math.max(worstFeet, feet);
        assert.ok(feet < 0.03, `${s.id}: ${o.row.id} stands with the feet's middle under the body's, as the standing rest has it (${(feet * 100).toFixed(1)} cm aside)`);
      }
      // A finger's end: with the source at rest it keeps its own rest under its first joint.
      const sf = fitClip(plan, standing, still);
      for (const name of TIPS) {
        const tip = qangle(at4(sf.rotations[sf.joints.indexOf(name)], 0), t.joints[t.joints.findIndex((x) => x.name === name)].restQ);
        worstTip = Math.max(worstTip, tip);
        assert.ok(tip < 1e-3, `${s.id}: ${name} keeps its own rest under its first joint in the standing rest (${tip.toFixed(3)} degrees off)`);
      }
      // The float rides level: its hips' mean height is their rest height.
      const ff = fitClip(plan, float.clip, float.row);
      let mean = 0;
      for (let f = 0; f < ff.frames; f++) mean += ff.rootPosition[f * 3 + 1];
      assert.ok(Math.abs(mean / ff.frames - t.joints[j].restP[1]) < 0.01, `${s.id}: the float's hips ride at their rest height on average`);
      lines.push(`${s.id}: ${t.joints.length} joints, ${r.mapped} driven, scale ${r.scale.toFixed(3)}, standing rest ankles ${(r.feet.left * 100).toFixed(1)}/${(r.feet.right * 100).toFixed(1)} cm, old rule hips ${old.report.hipsTilt.toFixed(1)} spine ${old.report.spineTilt.toFixed(1)} degrees`);
    }
    checks += 12;
    ok(true, `all ${species.length} converted species: every mapped joint present, facing as the source, hips and spine at rest in the standing rest, ankles within 2 cm of the ground, the tread's hips the source's own within 2 degrees (the old rule 25 or more off), the landing standing and the float level`);
    ok(worstEnd < 1e-5 && worstFeet < 0.03 && worstTip < 1e-3, `and on every one of them the five one-offs are anchored over the hips' rest place (worst ${(worstEnd * 1000).toFixed(3)} mm), the landings and the jump stand over the feet (worst ${(worstFeet * 100).toFixed(1)} cm aside), and the six fingertips keep their rest under their first joints (worst ${worstTip.toFixed(4)} degrees)`);
    note(`${keys.size} different skeletons among them`);
    for (const l of lines) note(l);
  }
}

console.log(`\n${checks} checks passed`);
