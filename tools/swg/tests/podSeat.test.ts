// A pod racer's seat (src/vehicles/podSeat.ts): which rule places the pilot's pelvis, the owner's own
// table, the seat hung under the cockpit's joint so the pilot rides the pod's own clips, a nudge from
// the console that goes through that joint in the vehicle's frame, the clips' change-over that never
// flips inside its band, the garage's whole seat path (`seatPod`, over a plain object standing in for
// the vehicle, in the order it has to run), what a pod is, another player's pod picture stepped by the
// speed its rider's game reads, and the converter keeping the game's own `player` point under `body`
// through the very functions `convertSat` and the gallery call (with `status` asking for the gallery
// again over a pack whose pods have none). Plain node over three and the pure converter modules; the
// checks on the real archives and on the converted pods skip without them.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { POD_COCKPIT_JOINT, POD_GAIT, POD_SEAT, boneNamed, boneOver, hangPodSeat, isPod, nudgeSeat, placeIn, podGait, podRuns, podSeatRule, podSpeed, seatInVehicle, seatPod, stepPodGait, stepPodPicture, type PodSeatRule, type Vec3 } from '../../../src/vehicles/podSeat.ts';
import { findHardpoint } from '../../../src/vehicles/shipAssembly.ts';
import { gallerySatOptions, podSeatStatus, skeletalModelEntry } from '../gallery.mjs';
import { hardpointsKept, keptHardpoints, skinData } from '../skeletal.mjs';
import { buildGlb } from '../glb.mjs';
import { readGlb } from '../glbclips.mjs';
import { MATERIAL_FORMAT } from '../surface.mjs';
import { LOD_FORMAT } from '../lodlevels.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e;
const nearV = (a: { x: number; y: number; z: number }, b: ArrayLike<number>, e = 1e-6) => near(a.x, b[0], e) && near(a.y, b[1], e) && near(a.z, b[2], e);
const f2 = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z].map((n) => n.toFixed(2)).join(', ');

// ---------------------------------------------------------------------------------------------
// 1. The rule order: the owner's row, the game's point, the cockpit joint, the guess -- and the
// guess is never worked out when anything above it answers.
{
  let guessed = 0;
  const guess = (): Vec3 => {
    guessed++;
    return [0, 9, 9];
  };
  const hp: Vec3 = [0.01, 1.73, -8];
  const joint: Vec3 = [-0.1, 1.7, -7.5];
  const row = podSeatRule('fg_8t8_podracer', { hardpoint: hp, joint, guess });
  ok(row.rule === 'table' && row.pelvis.join() === POD_SEAT.fg_8t8_podracer.join(), "a pod with a row in the owner's table sits there, over the game's own point");
  const game = podSeatRule('pod_racer_two', { hardpoint: hp, joint, guess });
  ok(game.rule === 'hardpoint' && game.pelvis.join() === hp.join(), "with no row, the game's own player point");
  const bone = podSeatRule('pod_racer_two', { hardpoint: null, joint, guess });
  ok(bone.rule === 'joint' && bone.pelvis.join() === joint.join(), 'with no player point (a gallery converted before it was kept), the cockpit joint');
  ok(guessed === 0, 'and the mesh is not even guessed at while any of those answers');
  const last = podSeatRule('pod_racer_two', { hardpoint: null, joint: null, guess });
  ok(last.rule === 'guess' && last.pelvis.join() === '0,9,9' && guessed === 1, 'with none of them (a pod with no skeleton), the guess');
  ok(podSeatRule('constructor', { hardpoint: null, joint: null, guess }).rule === 'guess', "a garage id that is one of the language's own names is not a row");
  row.pelvis[1] = 99;
  ok(POD_SEAT.fg_8t8_podracer[1] !== 99, 'and the pelvis handed back is a copy, never the table row');
}

// ---------------------------------------------------------------------------------------------
// 2. Every row is the owner's paste: the seat `__debug.seat` reported and the riding clip's root,
// added (2026-10-04). pod_racer_one has none: its numbers were read while the seat did not follow.
{
  const pastes: Record<string, { seat: Vec3; clipRoot: Vec3 }> = {
    fg_8t8_podracer: { seat: [0, -0.28, -0.06], clipRoot: [0, 2.66, 3.01] },
    pod_racer_ipg_longtail: { seat: [0, 3.13, -7.58], clipRoot: [0, 1.1, -0.03] },
  };
  const rows = Object.keys(POD_SEAT);
  ok(rows.length === Object.keys(pastes).length && rows.every((id) => id in pastes), `the table holds exactly the pods the owner sent back (${rows.join(', ')})`);
  for (const [id, p] of Object.entries(pastes)) {
    const want = p.seat.map((n, k) => n + p.clipRoot[k]);
    ok(POD_SEAT[id].every((n, k) => near(n, want[k], 1e-9)), `${id}: its row is seat + clip root (${POD_SEAT[id].join(', ')})`);
  }
  ok(!('pod_racer_one' in POD_SEAT) && !('pod_racer_light_bending' in POD_SEAT), 'pod_racer_one (and the light-bending pod on its pose) has no row: the game seats it until it is nudged again');
}

// ---------------------------------------------------------------------------------------------
// A vehicle standing somewhere in the world, turned, with a pod's model framed under it and two bones.
const X = new THREE.Vector3(1, 0, 0);
function rig(bodyTurn: THREE.Quaternion) {
  const group = new THREE.Group();
  group.position.set(12, 3, -40);
  group.rotation.set(0, 0.7, 0);
  const model = new THREE.Group();
  model.position.set(0, -0.48, 4.05);
  group.add(model);
  const root = new THREE.Bone();
  root.name = 'root';
  root.position.set(0, 2.8, 0);
  model.add(root);
  const body = new THREE.Bone();
  body.name = POD_COCKPIT_JOINT;
  body.position.set(-0.84, 0.31, -12);
  body.quaternion.copy(bodyTurn);
  root.add(body);
  const scene = new THREE.Scene();
  scene.add(group);
  scene.updateMatrixWorld(true);
  return { scene, group, model, root, body };
}
const worldOf = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false);
  return o.getWorldPosition(new THREE.Vector3());
};

// ---------------------------------------------------------------------------------------------
// 3. The seat under a joint turned 90 degrees about X: it stands at the pelvis, turned as the vehicle
// is, and a nudge of (0, 1, 0) raises it a metre in the vehicle's frame. The old nudge (the seat's own
// position.y) goes along the joint's own axis, which is the vehicle's forward here.
{
  const { group, body } = rig(new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2));
  const pelvis: Vec3 = [0.01, 1.52, -8];
  const seat = new THREE.Object3D();
  const bind = hangPodSeat(seat, body, group, pelvis);
  ok(!!bind && seat.parent === body, 'the seat is hung under the cockpit joint, its bind handed back');
  ok(nearV(group.worldToLocal(worldOf(seat)), pelvis), `it stands at the pelvis in the vehicle's frame (${f2(group.worldToLocal(worldOf(seat)))})`);
  const seatQ = seat.getWorldQuaternion(new THREE.Quaternion());
  const groupQ = group.getWorldQuaternion(new THREE.Quaternion());
  ok(seatQ.angleTo(groupQ) < 1e-6, "and is turned as the vehicle is, the joint's own quarter turn taken off");
  ok(nearV(seatInVehicle(seat, bind, new THREE.Vector3()), pelvis), 'seatInVehicle reads the pelvis back through the bind');
  nudgeSeat(seat, bind, 0, 1, 0);
  const want: Vec3 = [pelvis[0], pelvis[1] + 1, pelvis[2]];
  ok(nearV(group.worldToLocal(worldOf(seat)), want), `a nudge of (0, 1, 0) raises it exactly a metre in the vehicle's frame (${f2(group.worldToLocal(worldOf(seat)))})`);
  ok(nearV(seatInVehicle(seat, bind, new THREE.Vector3()), want), 'and seatInVehicle reads the nudged place');
  nudgeSeat(seat, bind, 0.2, 0, -0.3);
  ok(nearV(group.worldToLocal(worldOf(seat)), [want[0] + 0.2, want[1], want[2] - 0.3]), 'a nudge across and along goes across and along');
  // The control: the nudge the console made before, on the seat's own position.
  const old = new THREE.Object3D();
  hangPodSeat(old, body, group, pelvis);
  old.position.y += 1;
  const off = group.worldToLocal(worldOf(old)).distanceTo(new THREE.Vector3(...want));
  ok(off > 0.9, `the old nudge on the seat's own position lands ${off.toFixed(2)} m off where it was asked to go`);
  // No joint: the seat stays on the vehicle at the pelvis, and the nudge is its own position's.
  const flat = new THREE.Object3D();
  ok(hangPodSeat(flat, null, group, pelvis) === null && flat.parent === group && nearV(flat.position, pelvis), 'a pod with no joint keeps its seat on the vehicle, at the pelvis, with no bind');
  nudgeSeat(flat, null, 0, 0.5, 0);
  ok(nearV(flat.position, [pelvis[0], pelvis[1] + 0.5, pelvis[2]]), "and a nudge there moves it in the vehicle's frame as it always did");
}

// ---------------------------------------------------------------------------------------------
// 4. Riding the clips: a mixer with an idle and a run, the run lifting `body` 4 m. Posed at the
// idle's first frame the seat is at the pelvis; once the run has faded in it has risen 4 m with the
// bone; a seat left on the vehicle (the old way) has not.
{
  const { group, model, root } = rig(new THREE.Quaternion());
  const restBody = new THREE.Vector3(-0.84, 0.31, -12);
  const idleAt = restBody.clone().add(new THREE.Vector3(0, -2.6, 0));
  const runAt = idleAt.clone().add(new THREE.Vector3(0, 4, 0));
  const track = (at: THREE.Vector3) => new THREE.VectorKeyframeTrack(`${POD_COCKPIT_JOINT}.position`, [0, 1], [at.x, at.y, at.z, at.x, at.y, at.z]);
  const idle = new THREE.AnimationClip('idle', 1, [track(idleAt)]);
  const run = new THREE.AnimationClip('run', 1, [track(runAt)]);
  const gait = podGait(model, [run, idle], { run: 8 });
  ok(!!gait && gait.current === gait.idle && !gait.running, 'the gait starts in the idle');
  const body = boneNamed(model, POD_COCKPIT_JOINT)!;
  ok(!!body && body.position.distanceTo(idleAt) < 1e-6 && root.position.y === 2.8, "the idle's first frame is posed before anything is measured");
  const pelvis: Vec3 = [0.01, 1.73, -8];
  const seat = new THREE.Object3D();
  const bind = hangPodSeat(seat, body, group, pelvis);
  ok(nearV(group.worldToLocal(worldOf(seat)), pelvis), 'posed in the idle, the seat stands at the pelvis');
  const fixed = new THREE.Object3D();
  hangPodSeat(fixed, null, group, pelvis);
  const bodyAt0 = group.worldToLocal(worldOf(body));
  for (let i = 0; i < 60; i++) stepPodGait(gait!, 1 / 30, 12);
  ok(gait!.current === gait!.run && gait!.running, 'at 12 m/s the run plays');
  const rose = group.worldToLocal(worldOf(body)).y - bodyAt0.y;
  ok(near(rose, 4, 0.02), `the cockpit joint has risen ${rose.toFixed(2)} m`);
  const seatNow = group.worldToLocal(worldOf(seat));
  ok(near(seatNow.y - pelvis[1], rose, 1e-6) && near(seatNow.x, pelvis[0]) && near(seatNow.z, pelvis[2]), `and the seat with it, ${(seatNow.y - pelvis[1]).toFixed(2)} m, not an inch off the joint's own rise`);
  ok(nearV(seatInVehicle(seat, bind, new THREE.Vector3()), pelvis), "while seatInVehicle still reads it as the idle's first frame stands it");
  ok(nearV(group.worldToLocal(worldOf(fixed)), pelvis), 'a seat left on the vehicle, as every pod had it before, stays where the idle left it and the cockpit goes up without the pilot');
  for (let i = 0; i < 60; i++) stepPodGait(gait!, 1 / 30, 0);
  ok(gait!.current === gait!.idle && near(group.worldToLocal(worldOf(seat)).y, pelvis[1], 0.02), 'stopped, the idle comes back and the seat sinks with the cockpit');
  ok(podGait(new THREE.Group(), []) === null, 'a pod with no clips (Balta\'s, Anakin\'s, the IPG) has no gait');
}

// ---------------------------------------------------------------------------------------------
// 5. The change-over has a band: from the idle, nothing under `run` starts the run; from the run,
// nothing over `idle` stops it. A speed that wanders about inside the band never flips the cockpit.
{
  const { run, idle } = POD_GAIT;
  ok(idle < run, `the band is the right way round (idle under ${idle}, run over ${run} m/s)`);
  ok(!podRuns((idle + run) / 2, false) && podRuns((idle + run) / 2, true), 'a speed inside the band keeps whichever clip was playing');
  ok(podRuns(run + 0.01, false) && !podRuns(idle - 0.01, true), 'and past either edge it changes over');
  const { model } = rig(new THREE.Quaternion());
  const clip = (name: string, y: number) => new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack(`${POD_COCKPIT_JOINT}.position`, [0, 1], [0, y, 0, 0, y, 0])]);
  const g = podGait(model, [clip('idle', 0), clip('run', 4)])!;
  let flips = 0;
  let was = g.current;
  const wander = (i: number) => idle + 0.02 + (run - idle - 0.04) * (0.5 + 0.5 * Math.sin(i * 0.37));
  for (let i = 0; i < 300; i++) {
    stepPodGait(g, 1 / 60, wander(i));
    if (g.current !== was) flips++;
    was = g.current;
  }
  ok(flips === 0 && g.current === g.idle, `a pod hovering between ${idle} and ${run} m/s from a stop stays in its idle (${flips} flips)`);
  stepPodGait(g, 1 / 60, run + 1);
  was = g.current;
  for (let i = 0; i < 300; i++) {
    stepPodGait(g, 1 / 60, wander(i));
    if (g.current !== was) flips++;
    was = g.current;
  }
  ok(flips === 0 && g.current === g.run, `and once running it stays in its run however the speed wanders inside the band (${flips} flips)`);
  // The rule every pod had before: one speed, 0.4 m/s. The same wander flips it, which is the 4 m bob the band is for.
  let oldFlips = 0;
  let oldRunning = false;
  for (let i = 0; i < 300; i++) {
    const r = wander(i) >= 0.4;
    if (r !== oldRunning) oldFlips++;
    oldRunning = r;
  }
  ok(oldFlips > 10, `the old single threshold flips ${oldFlips} times over the same wander`);
}

// ---------------------------------------------------------------------------------------------
// 6. The nodes the garage reads the rule from: the bone a hardpoint rides, a bone by name, and a place in the vehicle's frame.
{
  const { group, model, body } = rig(new THREE.Quaternion());
  const hp = new THREE.Object3D();
  hp.position.set(0.11, 0.02, -0.52);
  body.add(hp);
  ok(boneOver(hp) === body && boneOver(body) === body && boneOver(model) === null && boneOver(null) === null, 'boneOver finds the joint a hardpoint rides, the joint itself, or nothing');
  ok(boneNamed(model, 'body') === body && boneNamed(model, 'nothing') === null, 'boneNamed finds the cockpit joint');
  const at = placeIn(group, hp)!;
  ok(nearV(new THREE.Vector3(...at), [-0.84 + 0.11, -0.48 + 2.8 + 0.31 + 0.02, 4.05 - 12 - 0.52]), `placeIn reads a node's place in the vehicle's frame (${at.map((n) => n.toFixed(2)).join(', ')})`);
  ok(placeIn(group, null) === null, 'and nothing for no node');
}

// ---------------------------------------------------------------------------------------------
// 7. The garage's whole seat path, `seatPod`, run over a plain object standing in for the vehicle
// (a Vehicle satisfies the same shape), on a pod whose idle sinks `body` 2.6 m under its rest place
// and whose run lifts it 4 m from there. The order is what is under test: posed in the idle first,
// then measured, then hung with its bind taken in that pose, then the glow's update chained.
interface Stand {
  readonly seat: THREE.Object3D;
  readonly group: THREE.Object3D;
  speed: number;
  onUpdate: ((dt: number, self: Stand, drive: null) => void) | null;
  seatBind: THREE.Matrix4 | null;
  seatPelvis: boolean;
  seatFollows: boolean;
  seatRule: PodSeatRule | null;
}
const IDLE_SINK = -2.6;
const RUN_RISE = 4;
function animatedPod(withPoint: boolean) {
  const r = rig(new THREE.Quaternion());
  const hp = new THREE.Object3D();
  // As GLTFLoader leaves a converted hardpoint: the colon stripped from the name, the original kept.
  hp.name = 'hpplayer';
  hp.userData.name = 'hp:player';
  hp.position.set(0.11, 0.02, -0.52);
  if (withPoint) r.body.add(hp);
  const idleAt = r.body.position.clone().add(new THREE.Vector3(0, IDLE_SINK, 0));
  const runAt = idleAt.clone().add(new THREE.Vector3(0, RUN_RISE, 0));
  const track = (at: THREE.Vector3) => new THREE.VectorKeyframeTrack(`${POD_COCKPIT_JOINT}.position`, [0, 1], [at.x, at.y, at.z, at.x, at.y, at.z]);
  const clips = [new THREE.AnimationClip('idle', 1, [track(idleAt)]), new THREE.AnimationClip('run', 1, [track(runAt)])];
  // Where the point and the joint stand in the vehicle's frame at rest, and so where they stand in the idle.
  const sink = (p: Vec3 | null): Vec3 => [p![0], p![1] + IDLE_SINK, p![2]];
  const restHp = withPoint ? placeIn(r.group, hp)! : null;
  const restBody = placeIn(r.group, r.body)!;
  return { ...r, hp, clips, restHp, idleHp: restHp ? sink(restHp) : null, restBody, idleBody: sink(restBody) };
}
function stand(group: THREE.Object3D, glow: (() => void) | null): Stand {
  const seat = new THREE.Object3D();
  // A vehicle's seat starts on its group, as Vehicle's constructor puts it.
  group.add(seat);
  return { seat, group, speed: 0, onUpdate: glow ? () => glow() : null, seatBind: null, seatPelvis: false, seatFollows: false, seatRule: null };
}
const placeOf = (s: Stand) => s.group.worldToLocal(worldOf(s.seat));
const never = (): Vec3 => {
  throw new Error('the mesh was guessed at');
};
{
  const pod = animatedPod(true);
  let glowCalls = 0;
  const v = stand(pod.group, () => glowCalls++);
  const glow = v.onUpdate;
  const done = seatPod(v, { id: 'pod_racer_two', model: pod.model, clips: pod.clips, speeds: { run: 8 }, find: findHardpoint, guess: never });
  ok(done.rule === 'hardpoint' && v.seatRule === 'hardpoint', "a pod with no row and the game's own player point is seated on it");
  ok(v.seatPelvis === true, 'the seat names the pelvis, so the riding clip\'s root comes off');
  ok(v.seatFollows === true && !!v.seatBind && v.seat.parent === pod.body && done.joint === pod.body, 'it is hung under the joint the point rides, with its bind kept, and follows the skeleton');
  ok(nearV(new THREE.Vector3(...done.pelvis), pod.idleHp!, 1e-6) && !nearV(new THREE.Vector3(...done.pelvis), pod.restHp!, 0.5), `the pelvis is the point as the idle's first frame stands it (${done.pelvis.map((n) => n.toFixed(2)).join(', ')}), not as the rest pose has it`);
  ok(nearV(placeOf(v), pod.idleHp!, 1e-6), 'and the seat stands there in the idle');
  const read = seatInVehicle(v.seat, v.seatBind, new THREE.Vector3());
  ok(nearV(read, placeOf(v).toArray(), 1e-6),`what __debug.seat reads and pastes (${f2(read)}) is where the seat really stands, because the bind was taken in the idle`);
  ok(v.onUpdate !== glow && !!done.gait, 'the update is a new one that carries the clips');
  v.speed = 12;
  for (let i = 0; i < 60; i++) v.onUpdate!(1 / 30, v, null);
  ok(glowCalls === 60, `and the update it had before (the engine glow's) still runs every frame (${glowCalls} of 60)`);
  const rose = placeOf(v).y - pod.idleHp![1];
  ok(done.gait!.running && near(rose, RUN_RISE, 0.02), `at 12 m/s the run plays and the pilot has risen ${rose.toFixed(2)} m with the cockpit`);
  v.speed = 0;
  for (let i = 0; i < 60; i++) v.onUpdate!(1 / 30, v, null);
  ok(!done.gait!.running && nearV(placeOf(v), pod.idleHp!, 0.02), 'stopped, the idle comes back and the pilot sinks with it');
  v.speed = -12;
  for (let i = 0; i < 60; i++) v.onUpdate!(1 / 30, v, null);
  ok(done.gait!.running, 'backing up is speed too (the update reads it unsigned)');
}
{
  // The owner's row wins over the game's point, and is placed in the idle as well.
  const pod = animatedPod(true);
  const v = stand(pod.group, null);
  const done = seatPod(v, { id: 'pod_racer_ipg_longtail', model: pod.model, clips: pod.clips, find: findHardpoint, guess: never });
  ok(done.rule === 'table' && nearV(placeOf(v), POD_SEAT.pod_racer_ipg_longtail, 1e-6) && v.seatFollows, "a pod with a row sits at the owner's place, under the joint");
  ok(typeof v.onUpdate === 'function', 'a pod with clips and no update of its own still gets the clips stepped');
}
{
  // Today's pack: no player point, so the cockpit joint's own origin, as the idle stands it.
  const pod = animatedPod(false);
  const v = stand(pod.group, null);
  const done = seatPod(v, { id: 'pod_racer_two', model: pod.model, clips: pod.clips, find: findHardpoint, guess: never });
  ok(done.rule === 'joint' && done.joint === pod.body && nearV(placeOf(v), pod.idleBody, 1e-6), `with no player point, the ${POD_COCKPIT_JOINT} joint's origin in the idle (${f2(placeOf(v))})`);
}
{
  // The seat rides whichever joint carries the point, which on every retail pod is the cockpit's own.
  const pod = animatedPod(false);
  pod.root.add(pod.hp);
  const v = stand(pod.group, null);
  const done = seatPod(v, { id: 'pod_racer_two', model: pod.model, clips: pod.clips, find: findHardpoint, guess: never });
  ok(done.rule === 'hardpoint' && v.seat.parent === pod.root && done.joint === pod.root, 'a point on another joint carries the seat on that joint');
}
{
  // A pod with a skeleton and no clips (Balta's, Anakin's, the IPG): the seat rides the joint, the update is left alone.
  const pod = animatedPod(true);
  const glow = () => {};
  const v = stand(pod.group, glow);
  const before = v.onUpdate;
  const done = seatPod(v, { id: 'pod_racer_balta_podracer', model: pod.model, clips: [], find: findHardpoint, guess: never });
  ok(done.rule === 'hardpoint' && v.seatFollows && done.gait === null && v.onUpdate === before, 'a pod with no clips rides its joint and keeps its own update untouched');
  ok(nearV(placeOf(v), pod.restHp!, 1e-6), 'and nothing poses it, so the point is where the rest pose has it');
}
{
  // A static pod with no skeleton at all: the seat stays on the vehicle at the guess.
  const group = new THREE.Group();
  group.position.set(-5, 1, 9);
  const model = new THREE.Group();
  group.add(model);
  new THREE.Scene().add(group);
  const v = stand(group, null);
  const done = seatPod(v, { id: 'pod_racer_nobody', model, clips: [], find: findHardpoint, guess: () => [0, 1.5, -3] });
  ok(done.rule === 'guess' && v.seat.parent === group && nearV(v.seat.position, [0, 1.5, -3]) && v.seatBind === null && !v.seatFollows && v.seatPelvis && done.joint === null, 'a pod with no joint keeps its seat on the vehicle at the guess, still naming the pelvis');
}

// ---------------------------------------------------------------------------------------------
// 8. What a pod is: decided by what it is, never by the kind it is tried as from the garage panel,
// and asked the same way by the rider's own game and by another player's picture.
{
  ok(isPod({ kind: 'podracer', source: 'gallery' }), 'a pod racer from the gallery is a pod');
  ok(!isPod({ kind: 'ground', source: 'gallery' }), 'a walker is not, whatever kind it is spawned as: it keeps its own walk and seat');
  ok(!isPod({ kind: 'podracer', source: 'creature' }), 'a creature named for one keeps its saddle');
}

// ---------------------------------------------------------------------------------------------
// 9. Another player's pod picture plays its clips by the speed its rider's own game reads: the
// velocity along the nose, both level (vehicle.ts: the nose with its height taken off, dotted with
// the velocity). A slide, a fall or a bob is no speed, so the two screens play the same clip.
{
  const vehicleSpeed = (vel: THREE.Vector3, q: THREE.Quaternion) => vel.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize());
  let worst = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < 200; i++) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 1.2, rnd() * Math.PI, rnd() * 0.8, 'YXZ'));
    const vel = new THREE.Vector3(rnd() * 40, rnd() * 10, rnd() * 40);
    worst = Math.max(worst, Math.abs(podSpeed(vel, q) - vehicleSpeed(vel, q)));
  }
  ok(worst < 1e-9, `podSpeed is the speed the rider's own game reads, over 200 turns and velocities (worst ${worst.toExponential(1)})`);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9);
  const nose = new THREE.Vector3(Math.sin(0.9), 0, Math.cos(0.9));
  const side = new THREE.Vector3(Math.cos(0.9), 0, -Math.sin(0.9));
  ok(near(podSpeed(nose.clone().multiplyScalar(5), q), 5, 1e-9) && near(podSpeed(nose.clone().multiplyScalar(-5), q), -5, 1e-9), 'along the nose it is the speed, backwards the speed below nought');
  ok(near(podSpeed(side.clone().multiplyScalar(3), q), 0, 1e-9) && near(podSpeed(new THREE.Vector3(0, -7, 0), q), 0, 1e-9), 'a slide sideways or a fall is no speed at all');
  const straightUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  ok(podSpeed(new THREE.Vector3(3, 4, 5), straightUp) === 0, 'and a nose pointing straight up reads nought rather than dividing by it');

  const { model } = rig(new THREE.Quaternion());
  const clip = (name: string, y: number) => new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack(`${POD_COCKPIT_JOINT}.position`, [0, 1], [0, y, 0, 0, y, 0])]);
  const g = podGait(model, [clip('idle', 0), clip('run', 4)])!;
  const slide = side.clone().multiplyScalar(1);
  for (let i = 0; i < 60; i++) stepPodPicture(g, 1 / 30, slide, q, false);
  ok(!g.running && g.current === g.idle, `a picture sliding sideways at 1 m/s stays in its idle, as the rider's own pod does (the whole glided speed, ${slide.length().toFixed(1)} m/s, would have run it)`);
  for (let i = 0; i < 60; i++) stepPodPicture(g, 1 / 30, nose.clone(), q, false);
  ok(g.running && g.current === g.run, 'going forward at 1 m/s it runs');
  for (let i = 0; i < 60; i++) stepPodPicture(g, 1 / 30, nose.clone().multiplyScalar(20), q, true);
  ok(!g.running, 'and landed it is still, whatever the glide says');
}

// ---------------------------------------------------------------------------------------------
// 10. The wiring the node test cannot load (garage.ts and remotePlayers.ts reach the browser): each
// is the one call into the functions above, pinned by its text.
const root = fileURLToPath(new URL('../../../', import.meta.url));
{
  const garage = readFileSync(join(root, 'src', 'vehicles', 'garage.ts'), 'utf8');
  const spawnAt = garage.indexOf('const pod = isPod(def);');
  ok(spawnAt > 0 && /if \(pod\) \{\s*const \{[^}]*\} = seatPod\(v, \{ id: def\.id, model, clips: animations, speeds: def\.clipSpeeds, find: findHardpoint,/.test(garage.slice(spawnAt, spawnAt + 600)), 'the garage decides a pod by isPod(def) and seats it with seatPod over the vehicle itself');
  ok(/if \(animations\.length && !pod\)/.test(garage), 'and keeps the old animation branch for everything that is not a pod');
  ok(spawnAt > garage.indexOf('if (glow) wireEngineGlow(v, glow);'), "seated after the engine glow's update is wired, so seatPod has it to chain");
  ok(/const gait = isPod\(def\) && loaded\.animations\.length \? podGait\(model, loaded\.animations, def\.clipSpeeds\) : null;/.test(garage), "another player's picture of a pod asks the same isPod and gets the same clips");
  ok(!/\bkind === 'podracer' && def\.source/.test(garage), 'and nothing decides it by the kind a vehicle is tried as');
  const peers = readFileSync(join(root, 'src', 'net', 'remotePlayers.ts'), 'utf8');
  ok(/if \(rv\.gait\) stepPodPicture\(rv\.gait, dt, rv\.vel, rv\.obj\.quaternion, rv\.landed\);/.test(peers), "the peers' frame steps a pod picture's clips by stepPodPicture, along the picture's own nose");
  ok(/rv\.gait = gait;/.test(peers), 'with the gait the picture was built with');
}

// ---------------------------------------------------------------------------------------------
// 11. The converter keeps the game's own point, through the very functions `convertSat` and the
// gallery call: the body's hardpoints kept as the options say (`keptHardpoints`), placed on their
// joints (`skinData`), listed as kept (`hardpointsKept`), written into the model's manifest entry
// (`skeletalModelEntry`), which is what `status` reads (`podSeatStatus`). First on a drawn skeleton,
// so it runs on every machine; the glue in cli.mjs that calls them is pinned by its text.
{
  ok(gallerySatOptions(true, 'idle,run').hardpoints === true && gallerySatOptions(false, 'idle,run').hardpoints === true, "the gallery keeps a skeletal model's hardpoints whether or not it walks with its clips");
  ok(gallerySatOptions(true, 'idle,run').animations === 'idle,run' && gallerySatOptions(false, 'idle,run').animations === 'none', 'and its clips only when it walks with them, as before');
  const joint = (name: string, parent: number, at: number[]) => ({ name, parent, pre: [1, 0, 0, 0], post: [1, 0, 0, 0], bindT: at, bindR: [1, 0, 0, 0] });
  const skeleton = { version: 2, joints: [joint('root', -1, [0, 2.8, 0]), joint(POD_COCKPIT_JOINT, 0, [0.84, 0.31, -12])] };
  const point = (name: string, parent: string, position: number[]) => ({ name, parent, rotation: [1, 0, 0, 0], position });
  const body = { mgn: { hardpoints: [point('player', POD_COCKPIT_JOINT, [-0.11, 0.02, -0.52]), point('engine_1', 'rght_leg', [0, -2.2, -5])] }, body: true };
  const worn = { mgn: { hardpoints: [point('player', 'root', [9, 9, 9])] }, body: false };
  ok(keptHardpoints([body, worn], [], false).length === 0, 'a model that does not ask keeps none (a character)');
  const kept = keptHardpoints([worn, body], [point('PLAYER', 'root', [8, 8, 8]), point('saddle', 'root', [0, 1, 0])], true);
  ok(kept.map((h: { name: string }) => h.name).join() === 'player,engine_1,saddle' && kept[0].parent === POD_COCKPIT_JOINT, "the body's own points first (never what is worn over it), then those handed in, the first of a name winning in any case");
  const skin = skinData(skeleton, [], { flipX: true, hardpoints: kept });
  const list = hardpointsKept(skin);
  ok(list.map((h: { name: string; joint: string }) => `${h.name}@${h.joint}`).join() === `player@${POD_COCKPIT_JOINT},saddle@root` && skin.droppedHardpoints.join() === 'engine_1', 'a point on a joint the skeleton lacks is dropped, the rest listed on their joints');
  const { json } = readGlb(buildGlb([], { flipX: true, skin, animations: skin.clips }));
  const nodes = json.nodes as { name?: string; children?: number[]; translation?: number[] }[];
  const hpIndex = nodes.findIndex((n) => n.name === 'hp:player');
  ok(hpIndex >= 0 && nodes.find((n) => (n.children ?? []).includes(hpIndex))?.name === POD_COCKPIT_JOINT && nearV({ x: nodes[hpIndex].translation![0], y: nodes[hpIndex].translation![1], z: nodes[hpIndex].translation![2] }, [0.11, 0.02, -0.52], 1e-6), 'the GLB hangs hp:player under the cockpit joint, X mirrored as the joints are');
  const info = { meshes: [{ triangles: 12 }], bounds: { min: [-2, 0, -9], max: [2, 5, 9] }, hardpoints: list, animations: ['idle', 'run'], clipSpeeds: { run: 9 }, missing: [], skipped: [] };
  const entry = skeletalModelEntry('mawhonical_pod_racer', 'appearance/mawhonical_pod_racer.sat', info, true);
  ok(entry.hardpoints.join() === 'player,saddle' && entry.skeletal === true && entry.file === 'mawhonical_pod_racer.glb' && entry.triangles === 12 && entry.clips.join() === 'idle,run' && entry.clipSpeeds.run === 9 && !('failed' in entry), "the model's entry lists the names it kept, with its clips when it walks with them");
  ok(podSeatStatus([entry]).seated === 1, 'and status counts that pod as seated');
  const still = skeletalModelEntry('pv_at_st', 'appearance/pv_at_st.sat', { ...info, meshes: [{ triangles: 0 }], missing: ['appearance/mesh/x.mgn'] }, false);
  ok(!('clips' in still) && /^no triangles \(appearance\/mesh\/x\.mgn\)$/.test(still.failed), 'one that does not walk carries no clips, and one with no triangles says why');
  ok(skeletalModelEntry('x', 'x.sat', { meshes: [{ triangles: 3 }] }, false).hardpoints.length === 0, 'and one converted keeping nothing lists nothing');

  const cli = readFileSync(join(root, 'tools', 'swg', 'cli.mjs'), 'utf8');
  const sat = cli.slice(cli.indexOf('function convertSat('), cli.indexOf('\n}\n', cli.indexOf('function convertSat(')));
  ok(/skinData\(skeleton, clips, \{ flipX: true, hardpoints: keptHardpoints\(composed, extraHardpoints, hardpoints\) \}\)/.test(sat), 'convertSat hands skinData the points keptHardpoints keeps of its composed meshes');
  ok(/if \(hardpoints\) \{\s*info\.hardpoints = hardpointsKept\(skin\);/.test(sat), 'and says it kept what hardpointsKept lists');
  const at = cli.indexOf("case 'gallery': {");
  const block = cli.slice(at, cli.indexOf("case 'jka-extract'", at));
  ok(at > 0 && /convertSat\(vfs, r\.skeletal, [^\n]*gallerySatOptions\(animated, CREATURE_CLIPS\)\)/.test(block), "the gallery's own call to convertSat takes its options from gallerySatOptions");
  ok(/const entry = skeletalModelEntry\(id, r\.skeletal, info, animated\);[\s\S]{0,120}models\.set\(id, entry\);/.test(block), 'and files the entry skeletalModelEntry makes of what it said');
}

// ---------------------------------------------------------------------------------------------
// 12. The same functions on the real archives: a pod's mesh at its finest level with geometry, as
// convertSat reads it, keeps the game's own player point on `body` and the entry lists it.
let swg = process.env.SWG ?? '';
const env = join(root, '.env');
if (!swg && existsSync(env)) {
  for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
    const m = /^\s*SWG\s*=\s*(.*?)\s*$/.exec(line);
    if (m) swg = m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!swg || !existsSync(swg)) note('no SWG install on this machine, so no real pod mesh is converted here');
else {
  const { openVfs } = await import('../tre.mjs');
  const { isRetailByName } = await import('../manifest.mjs');
  const { parseSat, parseLmg, parseMgn, parseSkeleton, mergeSkeletons, readIff } = await import('../skeletal.mjs');
  const { finestLevelWithGeometry } = await import('../lmglevel.mjs');
  const vfs = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null, log: () => {} });
  for (const sat of ['appearance/gasgano_pod_racer.sat', 'appearance/mawhonical_pod_racer.sat', 'appearance/balta_podracer.sat']) {
    if (!vfs.has(sat)) {
      note(`${sat} is not in the retail archives here`);
      continue;
    }
    // The .sat, its first skeleton, its meshes at the finest level with geometry, as convertSat reads them.
    const parsed = parseSat(readIff(vfs, sat));
    const skeleton = mergeSkeletons(parseSkeleton(readIff(vfs, parsed.skeletons[0].file), (f: string) => (vfs.has(f) ? readIff(vfs, f) : null)), []);
    const meshes = parsed.meshes.map((name: string) => {
      let file = name;
      let mgn = null;
      if (/\.lmg$/i.test(file)) ({ file, mgn } = finestLevelWithGeometry(parseLmg(readIff(vfs, file)), { has: (l: string) => vfs.has(l), load: (l: string) => parseMgn(readIff(vfs, l)) }));
      return { mgn: mgn ?? parseMgn(readIff(vfs, file)), body: true };
    });
    const kept = keptHardpoints(meshes, [], gallerySatOptions(false, 'none').hardpoints);
    const player = kept.find((h: { name: string }) => h.name.toLowerCase() === 'player');
    ok(!!player && player.parent === POD_COCKPIT_JOINT, `${sat}: its mesh carries the game's own player point on ${POD_COCKPIT_JOINT}, and the gallery keeps it`);
    const skin = skinData(skeleton, [], { flipX: true, hardpoints: kept });
    const { json } = readGlb(buildGlb([], { flipX: true, skin, animations: skin.clips }));
    const nodes = json.nodes as { name?: string; children?: number[]; translation?: number[] }[];
    const hpIndex = nodes.findIndex((n) => n.name === 'hp:player');
    const parent = nodes.findIndex((n) => (n.children ?? []).includes(hpIndex));
    ok(hpIndex >= 0 && nodes[parent]?.name === POD_COCKPIT_JOINT, `${sat}: the GLB writes hp:player under the ${nodes[parent]?.name ?? 'missing'} joint`);
    const t = nodes[hpIndex]?.translation ?? [0, 0, 0];
    ok(!!player && near(t[0], -player.position[0], 1e-5) && near(t[1], player.position[1], 1e-5) && near(t[2], player.position[2], 1e-5), `${sat}: at the game's point, X mirrored as the joints are (${t.map((n) => n.toFixed(3)).join(', ')})`);
    const entry = skeletalModelEntry(sat.replace(/^.*\/|\.sat$/g, ''), sat, { meshes: [{ triangles: 1 }], hardpoints: hardpointsKept(skin) }, false);
    ok(podSeatStatus([entry]).seated === 1, `${sat}: and its manifest entry lists player, so status is satisfied (${entry.hardpoints.length} points kept)`);
  }
}

// ---------------------------------------------------------------------------------------------
// 13. The converted pods themselves, read (never written) out of assets-private: rebuilt as bones and
// clips, framed as the garage frames a model, and seated by seatPod over a stand-in vehicle. Whatever
// rule seats it (the joint on a gallery converted before the point was kept, the point after), what
// the console reads is where the pilot really is, and on a pod with clips the pilot rises with the run.
{
  const TYPES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const pods: Record<string, string> = { gasgano_pod_racer: 'pod_racer_one', mawhonical_pod_racer: 'pod_racer_two' };
  for (const [file, id] of Object.entries(pods)) {
    const path = join(root, 'assets-private', 'gallery', `${file}.glb`);
    if (!existsSync(path)) {
      note(`no converted ${file}.glb here, so no real pod is seated`);
      continue;
    }
    const buf = readFileSync(path);
    const { json } = readGlb(buf);
    const jl = buf.readUInt32LE(12);
    const bin = 20 + jl + 8;
    const read = (ai: number) => {
      const a = json.accessors[ai];
      const bv = json.bufferViews[a.bufferView];
      const off = bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      const out = new Float32Array(a.count * TYPES[a.type]);
      for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(off + i * 4);
      return out;
    };
    // Bones for the skin's joints and plain nodes for the rest, named as GLTFLoader names them (a colon
    // taken out of the name and the original kept in userData).
    const joints = new Set<number>(json.skins?.[0]?.joints ?? []);
    const objs = (json.nodes as { name?: string; translation?: number[]; rotation?: number[] }[]).map((n, i) => {
      const o = joints.has(i) ? new THREE.Bone() : new THREE.Object3D();
      o.name = (n.name ?? '').replace(/:/g, '');
      o.userData.name = n.name ?? '';
      if (n.translation) o.position.fromArray(n.translation);
      if (n.rotation) o.quaternion.fromArray(n.rotation);
      return o;
    });
    const model = new THREE.Group();
    (json.nodes as { children?: number[] }[]).forEach((n, i) => (n.children ?? []).forEach((c) => objs[i].add(objs[c])));
    for (const i of json.scenes[json.scene ?? 0].nodes) model.add(objs[i]);
    const box = new THREE.Box3();
    for (const n of json.nodes as { mesh?: number }[]) {
      if (n.mesh === undefined) continue;
      for (const p of json.meshes[n.mesh].primitives) {
        const P = read(p.attributes.POSITION);
        for (let i = 0; i < P.length; i += 3) box.expandByPoint(new THREE.Vector3(P[i], P[i + 1], P[i + 2]));
      }
    }
    // Centred across and along on its rest box with its underside at nought, as the garage frames it.
    model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const clips = (json.animations ?? []).map((a: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }) => new THREE.AnimationClip(a.name, -1, a.channels.map((c) => {
      const s = a.samplers[c.sampler];
      const name = `${objs[c.target.node].name}.${c.target.path === 'translation' ? 'position' : c.target.path === 'rotation' ? 'quaternion' : 'scale'}`;
      const times = Array.from(read(s.input));
      const values = Array.from(read(s.output));
      return c.target.path === 'rotation' ? new THREE.QuaternionKeyframeTrack(name, times, values) : new THREE.VectorKeyframeTrack(name, times, values);
    })));
    const group = new THREE.Group();
    group.position.set(100, 5, -30);
    group.rotation.y = 1.1;
    group.add(model);
    new THREE.Scene().add(group);
    group.updateMatrixWorld(true);
    let glowCalls = 0;
    const v = stand(group, () => glowCalls++);
    const hasPoint = !!findHardpoint(model, 'player');
    const done = seatPod(v, { id, model, clips, speeds: {}, find: findHardpoint, guess: never });
    ok(done.rule === (hasPoint ? 'hardpoint' : 'joint') && v.seatFollows && v.seat.parent?.name === POD_COCKPIT_JOINT, `${id}: seated by ${done.rule === 'hardpoint' ? "the game's own player point" : `its ${POD_COCKPIT_JOINT} joint (a gallery converted before the point was kept)`}, riding ${v.seat.parent?.name}`);
    const idle = placeOf(v);
    ok(nearV(seatInVehicle(v.seat, v.seatBind, new THREE.Vector3()), idle.toArray(), 1e-4),`${id}: what the console reads and pastes is where the pilot sits in the idle (${f2(idle)})`);
    if (!done.gait) continue;
    v.speed = 30;
    for (let i = 0; i < 40; i++) v.onUpdate!(1 / 30, v, null);
    const rose = placeOf(v).y - idle.y;
    ok(rose > 3.5 && glowCalls === 40, `${id}: in its run the pilot rises ${rose.toFixed(2)} m with the cockpit, the glow's update running beside the clips`);
  }
}

// ---------------------------------------------------------------------------------------------
// 14. Status: a gallery whose pods name no player point (converted before they were kept) is asked
// for again; one whose pods keep it is not. The rule itself, then `status` run over a drawn pack.
{
  const pod = (id: string, hardpoints?: string[]) => ({ id, skeletal: true, source: `appearance/${id}.sat`, file: `${id}.glb`, ...(hardpoints ? { hardpoints } : {}) });
  ok(podSeatStatus([pod('gasgano_pod_racer'), pod('balta_podracer'), { id: 'speeder_ab1' }]).pods === 2, 'the skeletal pods are counted by name, the rest left out');
  ok(podSeatStatus([pod('gasgano_pod_racer'), pod('balta_podracer')]).seated === 0, 'a gallery converted before the hardpoints were kept has no pod with a player point');
  ok(podSeatStatus([pod('gasgano_pod_racer', ['engine_1', 'player']), pod('balta_podracer', ['engine_1'])]).seated === 1, 'one that kept them counts the pods that carry it');
  ok(podSeatStatus(undefined).pods === 0 && podSeatStatus([pod('pv_at_st')]).pods === 0, 'and a gallery with no pods has nothing to ask about');

  const dir = mkdtempSync(join(tmpdir(), 'swg3js-podseat-'));
  try {
    const cli = join(root, 'tools', 'swg', 'cli.mjs');
    mkdirSync(join(dir, 'gallery'), { recursive: true });
    const galleryAsks = (models: object[]): string[] => {
      writeFileSync(join(dir, 'gallery', 'manifest.json'), JSON.stringify({ planet: 'gallery', materialFormat: MATERIAL_FORMAT, lodFormat: LOD_FORMAT, categories: { layout: models } }));
      const r = spawnSync(process.execPath, [cli, 'status', dir, '--json'], { encoding: 'utf8', maxBuffer: 16 * 1048576 });
      assert.equal(r.status, 0, `status runs over the drawn pack: ${r.stderr}`);
      const steps = (JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as { steps: { command: string; reasons: string[] }[] }).steps;
      return steps.filter((s) => s.command === 'gallery').flatMap((s) => s.reasons);
    };
    const before = galleryAsks([pod('gasgano_pod_racer'), pod('mawhonical_pod_racer')]);
    ok(before.length === 1 && /seat point/.test(before[0]), `status asks for the gallery again over pods converted without their player point ("${before[0] ?? ''}")`);
    ok(galleryAsks([pod('gasgano_pod_racer', ['player', 'engine_1']), pod('mawhonical_pod_racer', ['player'])]).length === 0, 'and not over pods that carry it');
    ok(galleryAsks([{ id: 'speeder_ab1', source: 'appearance/speeder_ab1.apt', file: 'speeder_ab1.glb' }]).length === 0, 'nor over a gallery with no skinned pods at all');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${checks} checks passed`);
