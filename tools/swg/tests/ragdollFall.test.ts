// A corpse dropped in a real physics world (src/combat/ragdoll.ts, and the contact filter in
// src/core/physics.ts that decides what its pieces are allowed to meet).
//
// Nothing here is mirrored maths where a measurement would do: the engine is real, the skeletons
// are built out of round numbers in this file, and each claim is made by dropping something and
// watching it. Three things are being pinned.
//
// The fall: a body killed on a ledge has to accelerate as it falls. At the damping this used to
// carry it reached a tenth of its terminal speed in half a second and stayed there, which reads as
// sinking rather than dropping, so the old number is set again beside the new one and the two falls
// are measured against each other.
//
// The turn: a piece now carries its capsule's own angular inertia -- small about its long axis,
// several times larger across it -- instead of the one ball every piece used to turn as. The
// formula is checked against a ball (where a capsule with no cylinder in it must agree), and then
// what the engine really put on the body is read back and compared with it.
//
// And the rule: the engine runs the contact hooks only on a step that is given an event queue as
// well, which is why every piece once collided with every other and the bodies shivered for ever.
// That fact is measured here rather than believed, and so is every branch of the filter: a piece
// meets the ground, passes through anything that moves on its own, passes through the pieces of
// another corpse whatever the switch says, passes through the piece a joint holds it to, and meets
// the rest of its own body only while `RAGDOLL.selfCollide` is on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Group, Physics, RAGDOLL_RULES, RAPIER, groups } from '../../../src/core/physics.ts';
import { RAGDOLL, Ragdoll, capsuleInertia, jointTorque, pieceInertia, segmentDistance } from '../../../src/combat/ragdoll.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
/** Within a share of the larger of the two: the engine works in single precision and keeps inertia as one over its root. */
const close = (a: number, b: number, share = 0.02) => Math.abs(a - b) <= share * Math.max(Math.abs(a), Math.abs(b), 1e-9);

const DT = 1 / 60;
const GRAVITY = 20;

/** One bone, at an offset from whatever it is hung on. */
function bone(name: string, x: number, y: number, z: number): THREE.Bone {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  return b;
}

/**
 * A limb on its own: a holder with one bone and one child of it, which is exactly one capsule and
 * no joints at all, so what the engine put on that one body can be read without any doubt about
 * which piece it belongs to.
 */
function limb(length: number, atY: number): THREE.Object3D {
  const root = new THREE.Object3D();
  const a = bone('limb', 0, 0, 0);
  a.add(bone('limb_end', 0, -length, 0));
  root.add(a);
  root.position.set(0, atY, 0);
  root.updateMatrixWorld(true);
  return root;
}

/** A person-shaped skeleton of round numbers: about 1.8 m from the soles to the crown, arms out from the chest. */
function figure(atY: number, atX = 0): THREE.Object3D {
  const root = new THREE.Object3D();
  const pelvis = bone('pelvis', 0, 1, 0);
  const spine = bone('spine', 0, 0.25, 0);
  const chest = bone('chest', 0, 0.2, 0);
  const neck = bone('neck', 0, 0.17, 0);
  const head = bone('head', 0, 0.1, 0);
  head.add(bone('crown', 0, 0.23, 0));
  neck.add(head);
  chest.add(neck);
  for (const side of [1, -1]) {
    const upper = bone(`upperarm${side}`, 0.18 * side, 0, 0);
    const fore = bone(`forearm${side}`, 0.27 * side, 0, 0);
    fore.add(bone(`hand${side}`, 0.25 * side, 0, 0));
    upper.add(fore);
    chest.add(upper);
    const thigh = bone(`thigh${side}`, 0.1 * side, -0.05, 0);
    const shin = bone(`shin${side}`, 0, -0.43, 0);
    const foot = bone(`foot${side}`, 0, -0.44, 0);
    foot.add(bone(`toe${side}`, 0, -0.02, 0.12));
    shin.add(foot);
    thigh.add(shin);
    pelvis.add(thigh);
  }
  spine.add(chest);
  pelvis.add(spine);
  root.add(pelvis);
  root.position.set(atX, atY, 0);
  root.updateMatrixWorld(true);
  return root;
}

/** A floor with no body of its own, which is what a room's and a building's colliders are. */
function floorIn(w: Physics): void {
  w.world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0).setFriction(1));
}

/** The one body in a world of one piece. */
function onlyBody(w: Physics): RAPIER.RigidBody {
  const found: RAPIER.RigidBody[] = [];
  w.world.forEachRigidBody((b) => found.push(b));
  assert.equal(found.length, 1, 'the limb worlds hold exactly one body');
  return found[0];
}

const centre = new THREE.Vector3();

// The engine, started once; every section below stands a world of its own on top of it.
const physics = await Physics.create();
ok(near(physics.world.gravity.y, -GRAVITY, 1e-9), `0: the game pulls everything down at ${GRAVITY} m/s², which is what the falls below are measured against`);

// --- 1: the numbers and where the switch really lives -------------------------------------------
{
  ok(near(RAGDOLL.linearDamping, 0.05, 1e-9), `1: a corpse's own linear damping is all but nothing (${RAGDOLL.linearDamping})`);
  ok(RAGDOLL.inertiaBlend === 0, '1: and a piece turns as its own capsule does, not as a ball');
  ok(RAGDOLL.selfCollide === false, '1: a body does not meet its own pieces until the owner has looked at it');
  // The knob is on the tuning object the console already hands its numbers to; the rule it moves
  // lives with the contact filter that reads it, and the two are one value and not two.
  RAGDOLL.selfCollide = true;
  ok(RAGDOLL_RULES.selfCollide === true, '1: turning it on through the tuning object turns on the rule the filter reads');
  RAGDOLL_RULES.selfCollide = false;
  ok(RAGDOLL.selfCollide === false, '1: and the tuning object reads that rule rather than keeping a second copy of it');
  // Which is what `__debug.ragdoll({ selfCollide: true })` does: it assigns onto the object.
  Object.assign(RAGDOLL, { selfCollide: true });
  ok(RAGDOLL_RULES.selfCollide === true, '1: so the console hook needs nothing of its own to reach it');
  Object.assign(RAGDOLL, { selfCollide: false });
}

// --- 2: a body killed on a ledge accelerates as it falls -----------------------------------------
{
  /** Drop one piece for `seconds` with nothing under it, and answer with how fast it was going at the end. */
  const fall = (damping: number, seconds: number): number => {
    const was = RAGDOLL.linearDamping;
    RAGDOLL.linearDamping = damping;
    const w = Physics.local(GRAVITY);
    const rd = new Ragdoll(w, limb(0.5, 40));
    RAGDOLL.linearDamping = was;
    let last = rd.centre(centre).y;
    let speed = 0;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      w.step(DT);
      rd.update(DT);
      const y = rd.centre(centre).y;
      speed = (last - y) / DT;
      last = y;
    }
    rd.dispose();
    return speed;
  };
  const free = GRAVITY * 0.5;
  const now = fall(RAGDOLL.linearDamping, 0.5);
  const before = fall(2, 0.5);
  ok(now > free * 0.95, `2: half a second down, a corpse is falling at very nearly the speed a stone would (${now.toFixed(2)} of ${free.toFixed(2)} m/s)`);
  ok(before < free * 0.7, `2: where the damping it used to carry had it levelling off at a fraction of that (${before.toFixed(2)} m/s)`);
  ok(now > before * 1.4, '2: which is the difference between dropping off a ledge and sinking off one');
  // And the old number's fall really was levelling off rather than merely being behind: another
  // half-second of it adds almost nothing, while the new one goes on gathering speed.
  const longNow = fall(RAGDOLL.linearDamping, 1);
  const longBefore = fall(2, 1);
  ok(longNow > now * 1.8, `2: a second down it is going twice as fast again (${longNow.toFixed(2)} m/s)`);
  ok(longBefore < before * 1.4, `2: and the old one had all but stopped gathering any (${longBefore.toFixed(2)} m/s)`);
}

// --- 3: a limb turns like a limb ------------------------------------------------------------------
{
  // A capsule with no cylinder in it is a ball, and a ball's inertia is the same about every axis.
  const ball = capsuleInertia(9, 0, 0.2);
  ok(close(ball.axial, 0.4 * 9 * 0.04, 1e-6) && close(ball.across, ball.axial, 1e-6), `3: a capsule with no length in it is a ball (${ball.axial.toFixed(5)} both ways)`);
  const thin = capsuleInertia(9, 0.5, 0.08);
  ok(thin.across > thin.axial * 10, `3: and a long thin one is many times harder to swing across than to spin about itself (${(thin.across / thin.axial).toFixed(1)} times)`);

  // What the engine really carries, read off the body rather than worked out again: one limb, one
  // capsule, nothing else in the world to confuse it.
  const length = 0.5;
  const radius = 0.15;
  const half = length / 2 - radius / 2;
  const mass = 4 + 10 * length;
  const want = capsuleInertia(mass, half, radius);
  const w = Physics.local(GRAVITY);
  const rd = new Ragdoll(w, limb(length, 40));
  ok(rd.size === 1, '3: a holder with one bone and a tip makes one piece and no joints');
  const body = onlyBody(w);
  ok(close(body.mass(), mass, 1e-4), `3: the piece weighs what its length says (${body.mass().toFixed(2)} kg)`);
  const pi = body.principalInertia();
  const sorted = [pi.x, pi.y, pi.z].sort((a, b) => a - b);
  ok(close(sorted[0], want.axial), `3: it spins about its own long axis as easily as the capsule really would (${sorted[0].toFixed(4)} against ${want.axial.toFixed(4)})`);
  ok(close(sorted[1], want.across) && close(sorted[2], want.across), `3: and resists being swung across it as the capsule really would (${sorted[1].toFixed(4)} and ${sorted[2].toFixed(4)} against ${want.across.toFixed(4)})`);
  ok(sorted[2] > sorted[0] * 2, `3: which is the whole point: swinging it is ${(sorted[2] / sorted[0]).toFixed(1)} times the work of spinning it`);
  rd.dispose();

  // The way back, for a body of thin pieces that shivers: the blend puts the ball back, whole.
  const blended = pieceInertia(mass, half, radius, 0.35, 1);
  const asBall = 0.4 * mass * 0.35 * 0.35;
  ok(close(blended.x, asBall) && close(blended.y, asBall) && close(blended.z, asBall), `3: the blend at 1 is the ball every piece used to turn as, on all three axes (${asBall.toFixed(4)})`);
  const middle = pieceInertia(mass, half, radius, 0.35, 0.5);
  ok(middle.y > pieceInertia(mass, half, radius, 0.35, 0).y && middle.y < blended.y, '3: and anything between is between, axis by axis');
  // Nothing is ever handed to the solver as a needle.
  const needle = pieceInertia(0.5, 0.001, 0.005, 0.35, 0);
  ok(needle.x >= RAGDOLL.minInertia && needle.y >= RAGDOLL.minInertia, `3: however thin a bone is, its piece is never freer to turn than the floor allows (${RAGDOLL.minInertia})`);
}

// --- 4: it lands, it settles, it sleeps -------------------------------------------------------------
{
  const w = Physics.local(GRAVITY);
  floorIn(w);
  const root = figure(3, 0);
  const rd = new Ragdoll(w, root, { velocity: new THREE.Vector3(1, 0, 0) });
  ok(rd.size >= 8, `4: a person-shaped skeleton comes apart into a body's worth of pieces (${rd.size})`);
  ok(!rd.still, '4: and is not asleep the moment it is made');
  let slept = 0;
  let t = 0;
  for (let i = 0; i < 12 / DT; i++) {
    w.step(DT);
    rd.update(DT);
    t += DT;
    if (rd.still && !slept) slept = t;
  }
  ok(slept > 0, `4: it comes to rest and is put to sleep (after ${slept.toFixed(1)} s)`);
  ok(slept < 9, '4: rather than twitching on the floor for the rest of the session');
  const at = rd.centre(centre);
  ok(at.y > -0.5 && at.y < 1.5, `4: lying on the floor rather than through it or standing on it (its trunk ${at.y.toFixed(2)} m up)`);
  ok(rd.status.speed < RAGDOLL.restSpeed, `4: and still (${rd.status.speed} m/s over its pieces)`);
  ok(rd.status.asleep && rd.status.parts === rd.size, '4: which is what it says of itself in the console');
  rd.dispose();
  let left = 0;
  w.world.forEachCollider((c) => {
    if (w.isRagdoll(c.handle)) left++;
  });
  ok(left === 0, '4: no piece of it is still known to the contact filter');
}

// --- 5: the hooks run at all, and only on a step that is given a queue ---------------------------------
{
  const w = Physics.local(GRAVITY);
  floorIn(w);
  const rd = new Ragdoll(w, figure(1.2, 0));
  for (let i = 0; i < 60; i++) {
    w.step(DT);
    rd.update(DT);
  }
  ok(w.hookStats.calls > 0, `5: the contact filter really runs (${w.hookStats.calls} calls)`);
  // The engine skips the hooks outright on a step with no event queue. That is the fact behind
  // every piece once colliding with every other, so it is measured rather than remembered.
  const was = w.hookStats.calls;
  for (let i = 0; i < 30; i++) w.world.step();
  ok(w.hookStats.calls === was, '5: and is silently skipped on a step that is given no queue, which is the whole reason it was ever missed');
  for (let i = 0; i < 30; i++) w.step(DT);
  ok(w.hookStats.calls > was, '5: while the step the game takes passes one and the filter runs again');
  rd.dispose();

  // And the filter asks the engine nothing at all. A call into the world from inside the step is a
  // recursive borrow, and it throws out of the filter's own callback rather than anywhere a frame
  // could catch it: the pair is then refused by the accident of the throw, nothing is counted, and
  // the exception crosses the engine on every step a corpse lies near anything that moves. So the
  // one question the filter has -- whether the other body moves on its own -- is answered before
  // the step begins, and the filter itself touches nothing but its own two maps.
  const source = readFileSync(new URL('../../../src/core/physics.ts', import.meta.url), 'utf8');
  const filter = /filterContactPair: \(c1, c2, b1, b2\) => \{([\s\S]*?)\n    \},/.exec(source)?.[1] ?? '';
  ok(filter.length > 0, '5: the contact filter is where it always was');
  ok(!/this\.world\./.test(filter), '5: and it never calls into the engine, which mid-step is a recursive borrow that throws');
}

// --- 6: what a piece is allowed to meet ------------------------------------------------------------
{
  /** A piece of a corpse standing on its own: a ball, hooked, and told which body it belongs to. */
  const piece = (w: Physics, x: number, y: number, group: number, ignore: number[] = [], fixed = false): RAPIER.Collider => {
    const desc = fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic().setLinearDamping(RAGDOLL.linearDamping);
    const body = w.world.createRigidBody(desc.setTranslation(x, y, 0));
    const col = w.world.createCollider(RAPIER.ColliderDesc.ball(0.3).setRestitution(0).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS), body);
    w.markRagdoll(col, group, ignore);
    return col;
  };
  /** Anything else that moves on its own: a loose crate, a creature, a hull, resting on the floor. */
  const loose = (w: Physics, x: number, y: number): RAPIER.Collider => {
    const body = w.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, 0));
    return w.world.createCollider(RAPIER.ColliderDesc.ball(0.3).setRestitution(0), body);
  };

  /**
   * Drop one piece from two metres onto whatever `under` puts at y = 0.3, and answer with where it
   * came to rest: on top of it (about 0.9) or through it and onto the floor (about 0.3).
   */
  const dropOnto = (selfCollide: boolean, under: (w: Physics) => void): { rest: number; self: number; dropped: number } => {
    RAGDOLL.selfCollide = selfCollide;
    const w = Physics.local(GRAVITY);
    floorIn(w);
    under(w);
    const body = w.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinearDamping(RAGDOLL.linearDamping).setTranslation(0, 2, 0));
    const col = w.world.createCollider(RAPIER.ColliderDesc.ball(0.3).setRestitution(0).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS), body);
    w.markRagdoll(col, 1, []);
    for (let i = 0; i < 4 / DT; i++) w.step(DT);
    RAGDOLL.selfCollide = false;
    return { rest: body.translation().y, self: w.hookStats.self, dropped: w.hookStats.dropped };
  };

  const ownPiece = (w: Physics) => void piece(w, 0, 0.3, 1, [], true);
  const off = dropOnto(false, ownPiece);
  ok(near(off.rest, 0.3, 0.05), `6: with the switch off a piece falls straight through its own body's other pieces, as the game has always had it (it came to rest ${off.rest.toFixed(2)} m up)`);
  ok(off.self === 0 && off.dropped > 0, `6: and every one of those pairs was dropped by the filter (${off.dropped})`);

  const on = dropOnto(true, ownPiece);
  ok(near(on.rest, 0.9, 0.06), `6: with it on the pieces of one body meet, and it lands on the one below (${on.rest.toFixed(2)} m up)`);
  ok(on.self > 0, `6: which the console counts, so the owner can see the rule is doing something (${on.self} pairs let through)`);

  // A joint holds the two together: they overlap where they are hinged, and a pair that overlaps
  // would be thrown apart on the first step, so they never meet whatever the switch says.
  const held = (() => {
    RAGDOLL.selfCollide = true;
    const w = Physics.local(GRAVITY);
    floorIn(w);
    const under = piece(w, 0, 0.3, 1, [], true);
    const body = w.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinearDamping(RAGDOLL.linearDamping).setTranslation(0, 2, 0));
    const col = w.world.createCollider(RAPIER.ColliderDesc.ball(0.3).setRestitution(0).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS), body);
    w.markRagdoll(col, 1, [under.handle]);
    for (let i = 0; i < 4 / DT; i++) w.step(DT);
    RAGDOLL.selfCollide = false;
    return { rest: body.translation().y, self: w.hookStats.self };
  })();
  ok(near(held.rest, 0.3, 0.05) && held.self === 0, `6: a piece a joint holds to another is never met, switch or no (${held.rest.toFixed(2)} m up)`);

  const otherCorpse = dropOnto(true, (w) => void piece(w, 0, 0.3, 2, [], true));
  ok(near(otherCorpse.rest, 0.3, 0.05) && otherCorpse.self === 0, `6: and two corpses never stack on one another, however the switch stands (${otherCorpse.rest.toFixed(2)} m up)`);

  const living = dropOnto(true, (w) => void loose(w, 0, 0.3));
  ok(near(living.rest, 0.3, 0.05), `6: a corpse still trips nothing that moves on its own (${living.rest.toFixed(2)} m up)`);
  ok(living.dropped > 0, '6: those pairs being dropped by the filter exactly as they were before any of this');
  // And the floor it did land on is the case that must never be dropped: a collider with no body.
  ok(RAGDOLL.selfCollide === false, '6: and the switch is left as the game ships it');
}

// --- 7: which pieces are told to ignore which -------------------------------------------------------
{
  const w = Physics.local(GRAVITY);
  floorIn(w);
  const a = new Ragdoll(w, figure(2, 0));
  const b = new Ragdoll(w, figure(2, 40));
  const pieces: { group: number; ignore: number[]; handle: number }[] = [];
  w.world.forEachCollider((c) => {
    const p = w.ragdollPiece(c.handle);
    if (p) pieces.push({ ...p, handle: c.handle });
  });
  ok(pieces.length === a.size + b.size, `7: every piece of both bodies is known to the filter (${pieces.length})`);
  const groups = new Set(pieces.map((p) => p.group));
  ok(groups.size === 2, '7: two corpses are two groups, so neither can ever be taken for the other');
  const mine = new Set(pieces.filter((p) => p.group === [...groups][0]).map((p) => p.handle));
  const theirs = pieces.filter((p) => p.group !== [...groups][0]);
  ok(theirs.every((p) => p.ignore.every((h) => !mine.has(h))), '7: and neither body was told to ignore the other, because the group already answers for that');
  // Every piece but the one at the top of the skeleton hangs from another, and never meets it.
  const hung = pieces.filter((p) => p.ignore.length > 0);
  ok(hung.length >= pieces.length - 2, `7: all but the topmost piece of each body is told to ignore at least what it hangs from (${hung.length} of ${pieces.length})`);
  a.dispose();
  b.dispose();
  let left = 0;
  w.world.forEachCollider((c) => {
    if (w.isRagdoll(c.handle)) left++;
  });
  ok(left === 0, '7: and both bodies take every one of their pieces with them');
}

// --- 8: the distance two capsules are apart ----------------------------------------------------------
// The rule above rests on it: two pieces closer than their radii in the pose the body died in are
// never let to meet, and getting this wrong either welds a body solid or blows it apart.
{
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  ok(near(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0), v(1, 1, 0)), 1, 1e-9), '8: two parallel segments a metre apart are a metre apart');
  ok(near(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0.5, 1, -1), v(0.5, 1, 1)), 1, 1e-9), '8: two that cross at a height are that height apart');
  ok(near(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0)), 1, 1e-9), '8: two in a line are the gap between their ends');
  ok(near(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0, 0, 0), v(1, 0, 0)), 0, 1e-9), '8: and a segment lies exactly on itself');
  ok(near(segmentDistance(v(0, 3, 0), v(0, 3, 0), v(0, 0, 0), v(0, 0, 0)), 3, 1e-9), '8: two pieces with no length at all are the distance between their points');
  ok(near(segmentDistance(v(0, 2, 0), v(0, 2, 0), v(-5, 0, 0), v(5, 0, 0)), 2, 1e-9), '8: a point over a segment is its height over it');
  // Skew, which is the case a corner-cutting answer gets wrong: the two nearest points are inside
  // both segments and neither is an end.
  ok(near(segmentDistance(v(-1, 0, 0), v(1, 0, 0), v(0, 0.5, -1), v(0, 0.5, 1)), 0.5, 1e-9), '8: and two skew segments are the distance between the points where they pass');
}

// --- 9: the spring asks for the acceleration it says, about any axis ------------------------------
// The pieces stopped being balls in this wave, and the one line that turns a wanted angular
// acceleration into a torque had been written while they still were: it multiplied by one number.
// With a capsule's real inertia that number is right about no axis at all -- on the limb below it
// is more than twice the piece's own about its length -- so `RAGDOLL.maxAccel` would have been a
// cap on nothing and the damping would have been applied two and more times over. Both are
// measured here against the engine rather than argued about.
{
  const w = Physics.local(0);
  const rd = new Ragdoll(w, limb(0.9, 0));
  const body = onlyBody(w);
  body.setAngularDamping(0);
  // Turned to lie nowhere near an axis of the world, so a torque that ignored the piece's own
  // frame could not come out right by accident.
  const start = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -0.9, 0.3));
  const pi = body.principalInertia();
  const pfr = body.principalInertiaLocalFrame();
  const inertia = new THREE.Vector3(pi.x, pi.y, pi.z);
  const principal = new THREE.Quaternion(pfr.x, pfr.y, pfr.z, pfr.w);
  const parts = [inertia.x, inertia.y, inertia.z];
  const least = Math.min(...parts);
  const mean = (parts[0] + parts[1] + parts[2]) / 3;
  ok(mean > least * 2, `9: a limb's mean inertia is ${(mean / least).toFixed(2)} times its own about its length, which is the whole size of the mistake`);

  /** Put the piece back where it started, ask it for one torque, step once, and answer with the angular acceleration it really took. */
  const spin = (t: THREE.Vector3): THREE.Vector3 => {
    body.setRotation(start, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.resetTorques(true);
    body.addTorque(t, true);
    w.step(DT);
    const a = body.angvel();
    return new THREE.Vector3(a.x, a.y, a.z).divideScalar(DT);
  };

  // The axis it spins about most easily -- its own length -- as that axis lies in the world.
  const unit = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const k = parts.indexOf(least);
  const spinAxis = unit[k].clone().applyQuaternion(principal).applyQuaternion(start).normalize();
  const asked = new THREE.Vector3().copy(spinAxis).multiplyScalar(RAGDOLL.maxAccel);

  const got = spin(jointTorque(asked, start, principal, inertia, new THREE.Vector3()));
  ok(close(got.length(), RAGDOLL.maxAccel, 0.02), `9: asked for the cap about that axis, the piece takes exactly the cap (${got.length().toFixed(1)} of ${RAGDOLL.maxAccel} rad/s²)`);
  ok(got.clone().normalize().dot(spinAxis) > 0.999, '9: and about the axis it was asked for, not one the tensor bent it toward');

  // What the one scalar would have done: the same wanted acceleration times the mean of the three.
  const byScalar = spin(asked.clone().multiplyScalar(mean));
  ok(byScalar.length() > RAGDOLL.maxAccel * 2, `9: where one scalar would have flung it at ${byScalar.length().toFixed(0)} rad/s², past a cap whose whole purpose is that it cannot be`);
  ok(close(byScalar.length() / got.length(), mean / least, 0.05), '9: over by exactly the ratio between the mean of its inertias and its own about that axis');

  // Across the capsule, where the mean is under the piece's real inertia, the same scalar asks for
  // less than the cap: the number meant nothing either way.
  const big = parts.indexOf(Math.max(...parts));
  const swingAxis = unit[big].clone().applyQuaternion(principal).applyQuaternion(start).normalize();
  const swing = new THREE.Vector3().copy(swingAxis).multiplyScalar(RAGDOLL.maxAccel);
  ok(close(spin(jointTorque(swing, start, principal, inertia, new THREE.Vector3())).length(), RAGDOLL.maxAccel, 0.02), '9: swung across itself the piece takes the cap as well, which is what makes the cap a cap');
  ok(spin(swing.clone().multiplyScalar(mean)).length() < RAGDOLL.maxAccel * 0.9, '9: while the scalar asked for well under it across the same piece');

  // The damping term rides the same maths, and it is the one that does not merely look wrong: an
  // explicit -k w applied at k dt past 2 grows instead of settling, which is the shiver.
  ok(RAGDOLL.damping * DT * (mean / least) < 2, `9: damped through the piece's own inertia, the step is stable (k dt ${(RAGDOLL.damping * DT).toFixed(2)})`);
  const thin = capsuleInertia(9, 0.5, 0.08);
  const thinMean = (thin.axial + 2 * thin.across) / 3;
  ok(RAGDOLL.damping * DT * (thinMean / thin.axial) > 2, `9: where through one scalar a thin-boned skeleton was past it (${(RAGDOLL.damping * DT * (thinMean / thin.axial)).toFixed(1)})`);
  rd.dispose();
}

// --- 10: a step taken outside the loop still runs the filter ----------------------------------------
// A handful of places must advance the world at once so that a scene query can see what was just
// built or moved. `world.step()` with no queue runs no hooks, so on such a step a corpse meets
// everything -- including the pairs a joint holds together, which get one shove each out of the
// engine's own penetration recovery, and which at the linear damping this wave set keep it.
{
  const w = Physics.local(GRAVITY);
  floorIn(w);
  const rd = new Ragdoll(w, figure(1.2, 0));
  const calls = w.hookStats.calls;
  const steps = w.steps;
  w.stepOnce();
  ok(w.hookStats.calls > calls, `10: one step outside the loop, and the contact filter ran on it (${w.hookStats.calls - calls} calls)`);
  ok(w.steps === steps + 1, '10: and it counts as a step, so whatever was waiting for the world to move knows that it has');
  rd.dispose();
  const source = readFileSync(new URL('../../../src/core/physics.ts', import.meta.url), 'utf8');
  ok(/stepOnce\(\): void \{\s*if \(this\.ragdolls\.size\) this\.refreshMovers\(\);\s*this\.world\.step\(this\.events, this\.hooks\);/.test(source), '10: and it refreshes what the filter needs first, exactly as the loop does');
  // The pass the filter needs is over every body in the streamed world; the closure that walks it
  // is kept rather than made afresh on every frame anything is dead.
  ok(/private readonly noteMover = \(b: RAPIER\.RigidBody\): void =>/.test(source) && /forEachRigidBody\(this\.noteMover\)/.test(source), '10: and the walk over every body is one kept arrow, not one made per step');
}

// --- 11: a corpse is not a road -------------------------------------------------------------------
// The one ray in the game that passes no collision groups at all is the one that asks how far the
// ground is. With no groups the engine does no group test, so it finds whatever lies there --
// which is why it passes over another player's body by hand, and must pass over a corpse too.
{
  const w = Physics.local(GRAVITY);
  floorIn(w);
  const rd = new Ragdoll(w, figure(1, 0));
  for (let i = 0; i < 4 / DT; i++) {
    w.step(DT);
    rd.update(DT);
  }
  // Somewhere the body is really lying: a point where a ray that filters nothing finds something
  // well above the floor.
  let over: { x: number; z: number; top: number } | null = null;
  for (let x = -1.2; x <= 1.2 && !over; x += 0.1) {
    for (let z = -1.2; z <= 1.2; z += 0.1) {
      const top = w.topSurface(x, z, 6, 12, groups(Group.all, Group.all), () => true);
      if (top !== null && top > 0.15) {
        over = { x, z, top };
        break;
      }
    }
  }
  ok(over !== null, `11: the body really is lying somewhere on the floor (its highest piece ${over ? over.top.toFixed(2) : '?'} m up)`);
  if (over) {
    const d = w.groundDistance(over.x, 6, over.z, 12);
    ok(d !== null && near(d, 6, 0.06), `11: and straight down through it the ground is still the floor and not the corpse (${d === null ? 'nothing' : d.toFixed(2)} m, against ${(6 - over.top).toFixed(2)} if it had stopped on the body)`);
  }
  rd.dispose();
  if (over) {
    const d = w.groundDistance(over.x, 6, over.z, 12);
    ok(d !== null && near(d, 6, 0.06), '11: which is what it answered before the body fell there, and what it answers once it is gone');
  }
}

console.log(`\n${checks} checks passed`);
