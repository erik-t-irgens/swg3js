// The gravity boots: the turn that brings a face under the feet upright, the room cut out of whatever is
// stood on, the frame that carries it, the ease as a walker goes round a curve, and the let-go on a jump.
// Synthetic shapes only (a ball of triangles, a slab): no pack is read and nothing here names anything of
// the game's. The ball stands in for an asteroid, the slab for a station's hull or a wreck.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics, RAPIER, TRIMESH_FLAGS } from '../../../src/core/physics.ts';
import { JUMP_APEX, SURFACE_ROOM, SurfaceRoom, isSurfaceRoom, probeSurface, roomFrame, roomTurn, swingTo, turnAbout } from '../../../src/vehicles/surfaceRoom.ts';
import { SPACE_LANDING, poseInFrame, heldPose, surfacePose, surfaceUp } from '../../../src/vehicles/landing.ts';
import { JKA, UNIT } from '../../../src/player/jkaMove.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const D = THREE.MathUtils.degToRad;

/** A ball of triangles, the shape an asteroid stands in as: radius r, about the origin of its own frame. */
function ball(r: number, rows = 16, cols = 24): { vertices: Float32Array; indices: Uint32Array } {
  const v: number[] = [];
  const i: number[] = [];
  for (let a = 0; a <= rows; a++) {
    const phi = (a / rows) * Math.PI;
    for (let b = 0; b <= cols; b++) {
      const th = (b / cols) * Math.PI * 2;
      v.push(r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
    }
  }
  const at = (a: number, b: number) => a * (cols + 1) + b;
  for (let a = 0; a < rows; a++) {
    for (let b = 0; b < cols; b++) {
      i.push(at(a, b), at(a + 1, b), at(a, b + 1));
      i.push(at(a, b + 1), at(a + 1, b), at(a + 1, b + 1));
    }
  }
  return { vertices: new Float32Array(v), indices: new Uint32Array(i) };
}

/** A walker the room can step: where they stand in the room, how they move, whether their feet are down. */
function walker(x = 0, y = 0, z = 0) {
  return { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), grounded: true };
}

/** A stand-in for the hull a room is named by: the room never reads anything of it. */
const anyShip = { spec: { label: 'a ship' } } as unknown as import('../../../src/vehicles/vehicle.ts').Vehicle;

// --- 1: the turn that brings a face upright --------------------------------------------------------
{
  const q = new THREE.Quaternion();
  const from = new THREE.Vector3(1, 0, 0);
  const to = new THREE.Vector3(0, 1, 0);
  const angle = swingTo(from, to, Math.PI, q);
  ok(near(angle, Math.PI / 2, 1e-6), `1: a face a quarter turn over brings the room a quarter turn (${THREE.MathUtils.radToDeg(angle).toFixed(1)}°)`);
  const turned = from.clone().applyQuaternion(q);
  ok(turned.distanceTo(to) < 1e-6, '1: and the face ends upright');
  // Taken no further than the step allows: a walk round a curve eases, it never snaps.
  const step = swingTo(from, to, D(5), q);
  ok(near(step, D(5), 1e-6), `1: a step of five degrees turns five (${THREE.MathUtils.radToDeg(step).toFixed(2)}°)`);
  const part = from.clone().applyQuaternion(q);
  ok(near(part.angleTo(from), D(5), 1e-6) && part.angleTo(to) < from.angleTo(to), '1: part way round, and the right way');
  // No twist of its own: what lies square to both is left exactly where it was, so a walker keeps their facing.
  const axis = new THREE.Vector3().crossVectors(from, to).normalize();
  ok(axis.clone().applyQuaternion(q).distanceTo(axis) < 1e-6, '1: nothing square to the turn moves, so the facing is kept');
  ok(swingTo(to, to, D(90), q) === 0 && q.angleTo(new THREE.Quaternion()) === 0, '1: a face already upright turns nothing');
  ok(swingTo(new THREE.Vector3(), to, 1, q) === 0, '1: no face, no turn');
}

// --- 2: turning about a point ----------------------------------------------------------------------
{
  const pivot = new THREE.Vector3(3, 1, -2);
  const m = new THREE.Matrix4().makeTranslation(10, 0, 0);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), D(30));
  const before = pivot.clone().applyMatrix4(new THREE.Matrix4().copy(m).invert());
  turnAbout(q, pivot, m);
  const after = pivot.clone().applyMatrix4(new THREE.Matrix4().copy(m).invert());
  ok(before.distanceTo(after) < 1e-6, '2: the point turned about keeps whatever stood there (the walker never moves)');
  const far = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
  ok(near(far.distanceTo(pivot), new THREE.Vector3(10, 0, 0).distanceTo(pivot), 1e-6), '2: and everything else keeps its distance from it');
}

// --- 3: a pose read back out of a frame ------------------------------------------------------------
{
  const frame = new THREE.Matrix4().compose(new THREE.Vector3(40, -12, 7), new THREE.Quaternion().setFromEuler(new THREE.Euler(D(20), D(70), D(-35))), new THREE.Vector3(1, 1, 1));
  const worldPos = new THREE.Vector3(1, 2, 3);
  const worldTurn = new THREE.Quaternion().setFromEuler(new THREE.Euler(D(5), D(-40), D(15)));
  const localPos = new THREE.Vector3();
  const localTurn = new THREE.Quaternion();
  poseInFrame(frame, worldPos, worldTurn, localPos, localTurn);
  const backPos = new THREE.Vector3();
  const backTurn = new THREE.Quaternion();
  heldPose(frame, localPos, localTurn, backPos, backTurn);
  ok(backPos.distanceTo(worldPos) < 1e-6 && near(backTurn.angleTo(worldTurn), 0, 1e-6), '3: a pose read into a frame and held there again is the pose it was');
  poseInFrame(null, worldPos, worldTurn, localPos, localTurn);
  ok(localPos.distanceTo(worldPos) < 1e-9, '3: with no frame the pose is its own');
}

// --- 4: the surface a hull sets down on ------------------------------------------------------------
{
  // Five looks along a hull's own down that found a slope: the fit reads the face's up, in the world.
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, D(90)));
  const up = new THREE.Vector3();
  // A flat face square to the hull's down, wherever the hull is pointing.
  const flat = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 4), new THREE.Vector3(0, 0, -4), new THREE.Vector3(0, 4, 0), new THREE.Vector3(0, -4, 0)];
  // The hull lies on its side (a quarter turn about its nose), so its own up is the world's -X: the face the
  // looks found stands square to that, and the fit gives it back in the world, on the side the hull is on.
  ok(surfaceUp(flat, turn, up) && up.distanceTo(new THREE.Vector3(-1, 0, 0)) < 1e-6, `4: a face under a hull on its side reads as an up in the world (${up.toArray().map((n) => n.toFixed(2)).join(', ')})`);
  ok(!surfaceUp(flat.slice(0, 2), turn, up), '4: two looks are not a face');
  // The pose: the hull stands with its up on the face and its foot on the point.
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const foot = new THREE.Vector3(0, -1.5, 0.2);
  const face = new THREE.Vector3(0, 0, 1);
  ok(surfacePose(new THREE.Vector3(5, 5, 5), face, new THREE.Vector3(1, 0, 0), foot, pos, quat), '4: a face and a nose make a pose');
  const stands = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
  ok(stands.distanceTo(face) < 1e-6, '4: the hull stands square to the face it is on');
  const footAt = foot.clone().applyQuaternion(quat).add(pos);
  ok(footAt.distanceTo(new THREE.Vector3(5, 5, 5)) < 1e-6, '4: and its foot rests on the point');
  // The nose straight into the face: any heading on it will do, and the pose is still square to it.
  ok(surfacePose(new THREE.Vector3(), face, face.clone(), foot, pos, quat) && near(new THREE.Vector3(0, 1, 0).applyQuaternion(quat).dot(face), 1, 1e-6), '4: a hull pointing straight at the face still stands on it');
  ok(SPACE_LANDING.reach > 0 && SPACE_LANDING.speed > 0, '4: the space set-down has a reach and a speed of its own');
}

// --- 5: the room cut out of a surface --------------------------------------------------------------
const main = await Physics.create();
{
  const R = 20;
  const mesh = ball(R);
  main.world.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, TRIMESH_FLAGS));
  main.world.step();
  // Looking for something to stand on: from well outside the ball, straight at it.
  const from = new THREE.Vector3(40, 0, 0);
  const hit = probeSurface(main, from, new THREE.Vector3(-1, 0, 0), 60);
  ok(!!hit && near(hit.point.x, R, 0.2), `5: a look finds the face of the ball (${hit ? hit.point.x.toFixed(2) : 'nothing'})`);
  ok(!!hit && hit.normal.dot(new THREE.Vector3(1, 0, 0)) > 0.95, '5: with the face looking out of it');
  ok(probeSurface(main, from, new THREE.Vector3(1, 0, 0), 60) === null, '5: and nothing the other way');

  // The boots take hold on the side of the ball: the room is cut there, and its up is that face's.
  const at = new THREE.Vector3(R, 0, 0);
  const room = SurfaceRoom.take(main, at, new THREE.Vector3(1, 0, 0), null, anyShip, 10);
  ok(!!room, '5: the boots take hold of the ball');
  if (!room) throw new Error('no room');
  ok(isSurfaceRoom(room), '5: and the room knows itself for a surface');
  ok(room.built.triangles > 0, `5: with the face round the spot copied into it (${room.built.triangles} triangles)`);
  // The room's own middle is where the boots took hold, and its up is the face's.
  const world = room.toWorld(new THREE.Vector3(0, 0, 0), new THREE.Vector3());
  ok(world.distanceTo(at) < 1e-6, `5: the room's middle stands where the boots took hold (${world.toArray().map((n) => n.toFixed(2)).join(', ')})`);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(roomTurn(room));
  ok(up.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6, `5: and "up" in it is the face's own (${up.toArray().map((n) => n.toFixed(2)).join(', ')})`);
  const back = room.toLocal(world, new THREE.Vector3());
  ok(back.length() < 1e-6, '5: world to room and back is where it started');
  ok(roomFrame(room) === room.frame(), '5: the frame the drawing reads is the room\'s own');
  ok(room.roomLights(new THREE.Vector3(), 3).length === 0 && room.liftHere(new THREE.Vector3()) === null, '5: a rock has no lamps and no lifts');

  // Walking round the curve: the room eases its up onto the face under the feet, and the walker stays put.
  const who = walker(5, 0, 0);
  const wasWorld = room.toWorld(who.pos, new THREE.Vector3());
  for (let i = 0; i < 200; i++) room.step(1 / 60, who);
  const nowWorld = room.toWorld(who.pos, new THREE.Vector3());
  ok(nowWorld.distanceTo(wasWorld) < 0.35, `5: the walker keeps their place in the world as the room turns under them (${nowWorld.distanceTo(wasWorld).toFixed(3)} m)`);
  const up2 = new THREE.Vector3(0, 1, 0).applyQuaternion(roomTurn(room));
  const want = nowWorld.clone().normalize();
  ok(up2.angleTo(want) < D(3), `5: and "up" has followed the curve round to the face under them (${THREE.MathUtils.radToDeg(up2.angleTo(want)).toFixed(2)}° off)`);
  ok(room.contains(who.pos), '5: the boots still hold');

  // What they leave with: their own motion in the room, turned into the world.
  const out = room.worldVelocity(new THREE.Vector3(0, 4, 0), new THREE.Vector3());
  ok(near(out.length(), 4, 1e-6) && out.dot(up2) > 3.9, '5: they leave along the room\'s own up at the speed they jumped');
  room.dispose();
  ok(room.contains(new THREE.Vector3()) === false, '5: a room given up holds nobody');
}

// --- 5b: a jump, flown with the walk's own numbers --------------------------------------------------
{
  const R = 20;
  const at = new THREE.Vector3(0, R, 0);
  const room = SurfaceRoom.take(main, at, new THREE.Vector3(0, 1, 0), null, anyShip, 10);
  ok(!!room, '5b: the boots take hold of the top of the ball');
  if (!room) throw new Error('no room');
  // Not a teleport: the jump the game actually has. Up at jumpVelocity, down at gravity, stepped at 1/60,
  // and nothing here may reach higher than the plain jump does, or only a Force Jump could shake the boots.
  ok(SURFACE_ROOM.release < JUMP_APEX, `5b: the release height stays under the plain jump's apex (${SURFACE_ROOM.release} m under ${JUMP_APEX.toFixed(3)} m)`);
  const who = walker(0, SURFACE_ROOM.lift, 0);
  who.grounded = false;
  who.vel.set(0, JKA.jumpVelocity * UNIT, 0);
  let wentUpTo = who.pos.y;
  let letGoAt = -1;
  for (let i = 0; i < 240 && room.contains(who.pos); i++) {
    who.pos.y += (who.vel.y * 1) / 60;
    who.vel.y -= (JKA.gravity * UNIT) / 60;
    wentUpTo = Math.max(wentUpTo, who.pos.y);
    room.step(1 / 60, who);
    if (!room.contains(who.pos)) letGoAt = who.pos.y;
  }
  ok(letGoAt >= 0, '5b: a plain jump lets the boots go');
  ok(letGoAt < JUMP_APEX, `5b: and it lets go on the way up, well under the apex (${letGoAt.toFixed(3)} m of ${JUMP_APEX.toFixed(3)} m)`);
  ok(wentUpTo <= JUMP_APEX + SURFACE_ROOM.lift + 1e-6, `5b: the jump flown is the walk's own, not a teleport (${wentUpTo.toFixed(3)} m)`);
  room.dispose();

  // Feet on the ground: however the face is read, a walker who is standing is never let go of.
  const still = SurfaceRoom.take(main, at, new THREE.Vector3(0, 1, 0), null, anyShip, 10);
  if (!still) throw new Error('no room');
  const standing = walker(0, SURFACE_ROOM.lift, 0);
  for (let i = 0; i < 120; i++) still.step(1 / 60, standing);
  ok(still.contains(standing.pos), '5b: standing still on the face, the boots hold');

  // The camera's own block test: the view must not walk through the thing being stood on. It is cast in the
  // room, where the patch hangs on a kinematic body, which the world's own camera test would pass through.
  const above = still.toWorld(new THREE.Vector3(0, 3, 0), new THREE.Vector3());
  const below = still.toWorld(new THREE.Vector3(0, -8, 0), new THREE.Vector3());
  const blocked = still.cameraBlock(above, below);
  ok(blocked !== null && blocked > 0 && blocked < 11, `5b: the camera is stopped by the surface under the walker (${blocked === null ? 'nothing' : blocked.toFixed(2)} m along)`);
  const across = still.toWorld(new THREE.Vector3(-3, 3, 0), new THREE.Vector3());
  ok(still.cameraBlock(above, across) === null, '5b: and is not stopped by clear space over it');
  still.dispose();
}

// --- 5c: the room's world is never freed under something else that lives in it -----------------------
{
  const R = 20;
  const room = SurfaceRoom.take(main, new THREE.Vector3(0, R, 0), new THREE.Vector3(0, 1, 0), null, anyShip, 10);
  if (!room) throw new Error('no room');
  // A corpse's pieces: dying in the boots builds the ragdoll in this world, and freeing it under them would
  // have the next frame reading bodies that are gone.
  const stranger = room.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0));
  room.physics.world.createCollider(RAPIER.ColliderDesc.ball(0.3), stranger);
  room.dispose();
  ok(room.contains(new THREE.Vector3()) === false, '5c: the room is given up');
  // Freed, this throws: the world is still there, because something else was in it.
  ok(room.physics.world.bodies.len() > 0, '5c: and its world is left alone rather than freed under what is still in it');
}

// --- 6: a surface that moves -----------------------------------------------------------------------
{
  const moving = await Physics.create();
  const body = moving.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
  // A slab: a piece of hull, a metre thick, twenty across, its top at y = 0.
  const half = new THREE.Vector3(10, 0.5, 10);
  const v: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < 8; i++) v.push(i & 1 ? half.x : -half.x, i & 2 ? 0 : -1, i & 4 ? half.z : -half.z);
  const faces = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]];
  for (const f of faces) idx.push(...f);
  moving.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(v), new Uint32Array(idx), TRIMESH_FLAGS), body);
  moving.world.step();
  const room = SurfaceRoom.take(moving, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), body, anyShip, 10);
  ok(!!room, '6: the boots take hold of a slab that can move');
  if (!room) throw new Error('no room');
  const who = walker(2, 0, 1);
  const before = room.toWorld(who.pos, new THREE.Vector3());
  // The slab moves and turns: what stands on it goes with it, exactly, with nothing copied.
  body.setTranslation({ x: 100, y: 30, z: -20 }, true);
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, D(90), D(25)));
  body.setRotation({ x: turn.x, y: turn.y, z: turn.z, w: turn.w }, true);
  moving.world.step();
  room.step(1 / 60, who);
  const after = room.toWorld(who.pos, new THREE.Vector3());
  const expect = before.clone().applyQuaternion(turn).add(new THREE.Vector3(100, 30, -20));
  ok(after.distanceTo(expect) < 0.05, `6: the walker is carried by the slab exactly (${after.distanceTo(expect).toFixed(4)} m out)`);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(roomTurn(room));
  ok(up.distanceTo(new THREE.Vector3(0, 1, 0).applyQuaternion(turn)) < 0.05, '6: and "up" turns with it');
  ok(room.contains(who.pos), '6: the boots hold through all of it');
  room.dispose();
}

// --- 7: the invented numbers are all ours and all live ----------------------------------------------
{
  const keys = Object.keys(SURFACE_ROOM);
  ok(keys.includes('patch') && keys.includes('turn') && keys.includes('release'), '7: the boots\' numbers are named and set from one place');
  const was = SURFACE_ROOM.turn;
  SURFACE_ROOM.turn = 45;
  ok(SURFACE_ROOM.turn === 45, '7: and every one of them can be changed live');
  SURFACE_ROOM.turn = was;
}

console.log(`\n${checks} checks passed`);
