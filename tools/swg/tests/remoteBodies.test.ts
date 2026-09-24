// The other players as things you can hit (src/net/remoteBodies.ts).
//
// The whole difficulty is that a peer has to be findable by everything that hurts and by nothing
// that pushes, while their place comes off the wire ten times a second and teleports between
// messages. That is not a claim anyone can make by reading the physics engine's documentation, so
// most of this file drives a real physics world and measures it: what a bolt's ray finds, what a
// blade's sweep finds, what a ship's set-down probe finds, what the ground under a speeder finds,
// whether a character controller walks past, and whether a resting dynamic body is disturbed when a
// peer sweeps straight through it. The contrast case -- the same collider made solid -- is measured
// beside each one, so a change in the engine cannot quietly turn the answers round.
//
// Everything here is synthetic: round numbers, a capsule and a box, no game data of any kind. The
// three numbers that are the player's own (a capsule of 0.45 and 0.35, standing 0.80 over the feet)
// are named in the module under test and are checked against the player's source rather than
// copied, so the two cannot drift apart without this failing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Group, Physics, RAPIER, groups } from '../../../src/core/physics.ts';
import { PEER_BODY_TUNE, RemoteBodies, measureBox, peerBodies, peerBodyKnob } from '../../../src/net/remoteBodies.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** A peer as the peers hand one over: a group with a place and a turn, and nothing else that matters here. */
function peer(id: number, x: number, y: number, z: number, opts: { shown?: boolean; ship?: THREE.Object3D | null; shipBox?: ReturnType<typeof measureBox>; down?: boolean; name?: string } = {}): any {
  const group = new THREE.Object3D();
  group.position.set(x, y, z);
  return {
    id,
    name: opts.name ?? `peer ${id}`,
    shown: opts.shown ?? true,
    group,
    rig: null,
    ship: opts.ship ?? null,
    shipBox: opts.shipBox ?? null,
    hp: 100,
    maxHp: 100,
    down: opts.down ?? false,
    saber: false,
    saberColor: 0x3aa0ff,
  };
}

// --- 1: the collision bit --------------------------------------------------------------------------
// A bit of its own, inside `all`, and not one of the three that were there before it.
{
  ok(Group.peer === 0x0008, '1: the peer bit is a bit of its own (0x0008)');
  ok((Group.peer & Group.terrain) === 0 && (Group.peer & Group.exterior) === 0 && (Group.peer & Group.interior) === 0, '1: and it overlaps none of the groups that were there before it');
  ok((Group.all & Group.peer) === Group.peer, "1: `all` still means all, so nothing that asked for everything has to be told about it");
  // The roof grid writes its own groups out as a number so it loads without the engine; the weather
  // test pins that against Group. This pins the shape that test reads, which the new bit sits inside.
  ok(/export const Group = \{[^}]*\bpeer: 0x0008[^}]*\ball: 0xffff/.test(src('../../../src/core/physics.ts')), '1: and it is written in the one line every other reader of Group parses');
}

// --- 2: the capsule and the middle are the player's own ---------------------------------------------
{
  const player = src('../../../src/player/player.ts');
  const half = Number(/const STAND_HALF_HEIGHT = ([\d.]+);/.exec(player)?.[1]);
  const radius = Number(/const CAPSULE_RADIUS = ([\d.]+);/.exec(player)?.[1]);
  ok(near(PEER_BODY_TUNE.halfHeight, half) && near(PEER_BODY_TUNE.radius, radius), `2: a peer is shot at on the shape you are shot at on (${half} and ${radius})`);
  // The middle of the figure -- where a nameplate hangs and a blow's burst is placed -- is the
  // player's own too. It is read out of the player's entry on the one list of the living, so the
  // two cannot drift apart without this failing.
  const world = src('../../../src/world/world.ts');
  const mine = /class PlayerTarget implements Living \{[\s\S]*?readonly halfHeight = ([\d.]+);/.exec(world)?.[1];
  ok(mine !== undefined && near(PEER_BODY_TUNE.hitHeight, Number(mine)), `2: and their middle is where yours is (${mine})`);
  const reach = /class PlayerTarget implements Living \{[\s\S]*?radiusToward\(\): number \{\s*return ([\d.]+);/.exec(world)?.[1];
  ok(reach !== undefined && near(PEER_BODY_TUNE.radius, Number(reach)), `2: and a brain reaches for them at the same radius it reaches for you (${reach})`);
  // The blade colour a peer is drawn with before their own browser says: the game's own default,
  // written as a number where the peers are rather than read out of the player at load time.
  const peers = src('../../../src/net/remotePlayers.ts');
  const wire = /const DEFAULT_PEER_SABER = (0x[0-9a-f]+);/.exec(peers)?.[1];
  const game = /export const DEFAULT_SABER_COLOR = '#([0-9a-f]+)';/.exec(player)?.[1];
  ok(!!wire && !!game && Number(wire) === Number(`0x${game}`), `2: and an unlit peer's blade is the game's own default colour (${wire} against #${game})`);
  ok(!/^import .*DEFAULT_SABER_COLOR/m.test(peers), '2: taken as a number, so the peers pull nothing of the player in at load time');
}

// --- 3: the character controller and the ground are told to pass over a peer ------------------------
{
  const player = src('../../../src/player/player.ts');
  const moves = player.match(/computeColliderMovement\([\s\S]*?\);/g) ?? [];
  ok(moves.length >= 2 && moves.every((m) => m.includes('this.walkPast')), `3: every step the player takes walks past a corpse and a peer (${moves.length} call sites)`);
  ok(/walkPast = \(c: RAPIER\.Collider\): boolean => !this\.physics\.isRagdoll\(c\.handle\) && !this\.physics\.isPeer\(c\.handle\)/.test(player), '3: and the predicate is one kept arrow, not one made on every step');
  const physics = src('../../../src/core/physics.ts');
  ok(physics.includes('castRay(ray, maxDist, true, undefined, filterGroups, undefined, exclude, this.notPeerOrCorpse)'), '3: the one ray in the game that filters nothing at all calls neither a peer nor a corpse the ground');
}

// --- 4: the world finds them ------------------------------------------------------------------------
{
  const world = src('../../../src/world/world.ts');
  ok(/hittableAt\(handle: number\)[^}]*this\.peers\(\)\.byCollider\.get\(handle\)/s.test(world), '4: a collider that is a peer names them, like a creature or a hull');
  ok(/targets\(fresh = false\)[\s\S]*for \(const p of peers\.living\) this\.livingList\.push\(p\)/.test(world), '4: and they are on the one list of the living, so the powers and the brains find them by walking it');
  ok(/pv !== at\.peers/.test(world), '4: with the same version counter every other manager uses, so a steady frame builds nothing');
}

// --- 5: a body is made when they are first drawn, and not before -------------------------------------
const physics = await Physics.create();
const bodies = new RemoteBodies().bind(physics);
{
  ok(peerBodies() instanceof RemoteBodies, '5: there is one set of peer bodies for the page');
  const unheard = peer(1, 0, 0, 0, { shown: false });
  bodies.peerAdded(unheard);
  bodies.peerMoved(unheard);
  ok(bodies.living.length === 0 && bodies.byCollider.size === 0, '5: a peer nobody has heard from yet has no body standing at the origin');
  const at = peer(1, 10, 0, 0);
  at.group.position.set(10, 0, 0);
  bodies.peerAdded(at);
  bodies.peerMoved(at);
  ok(bodies.byCollider.size === 1, '5: one drawn where they stand has one');
  // And not on the one list of the living, because nothing is listening for a blow: see section 12.
  ok(bodies.living.length === 0, '5: which a bolt and a blade find without the brains picking a fight with it');
  const was = bodies.version;
  bodies.peerMoved(at);
  bodies.peerMoved(at);
  ok(bodies.version === was && bodies.byCollider.size === 1, '5: and a steady frame makes nothing and bumps nothing');
}

// --- 6: what the engine does and does not find --------------------------------------------------
{
  // One peer standing at x = 10, and a dynamic box resting out of every line of fire, at z = 6, for
  // the peer to be swept through at the end.
  const boxBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(10.9, 0.5, 6));
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4), boxBody);
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  physics.step(1 / 60);

  const handle = [...bodies.byCollider.keys()][0];
  const collider = physics.world.getCollider(handle);
  ok(collider.isSensor(), '6: a peer collider is a sensor, so it is never in the solver at all');
  ok(collider.collisionGroups() === groups(Group.peer, 0), '6: in the peer group, colliding with nothing');
  ok(collider.collisionGroups() !== 0, "6: and not ghosted, so the bolts' own predicate lets it through");

  // A bolt's ray: no interaction groups at all, and the predicate bolts.ts actually uses.
  const ray = new RAPIER.Ray({ x: 8, y: 0.8, z: 0 }, { x: 1, y: 0, z: 0 });
  const bolt = physics.world.castRayAndGetNormal(ray, 4, true, undefined, undefined, undefined, undefined, (c) => c.collisionGroups() !== 0);
  ok(bolt?.collider.handle === handle, '6: a bolt finds them');

  // A blade's sweep: intersectionsWithShape, again with no groups.
  let swept = false;
  physics.world.intersectionsWithShape({ x: 10, y: 0.8, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(0.3, 0.5), (c) => {
    if (c.handle === handle) swept = true;
    return true;
  });
  ok(swept, '6: a blade finds them');

  // Everything that passes an interaction group misses them: the character controller's own filter,
  // the filter it uses inside a building, a ship's set-down probe, the weather's roof grid.
  const filters: [string, number][] = [
    ['the character controller outside', groups(Group.all, Group.all)],
    ['the character controller inside a building', groups(Group.all, Group.all & ~(Group.terrain | Group.exterior))],
    ["the weather's roof grid", groups(Group.all, Group.all & ~Group.interior)],
  ];
  const seen = filters.filter(([, f]) => physics.world.castRay(ray, 4, true, undefined, f)?.collider.handle === handle);
  ok(seen.length === 0, `6: and every query that passes a group misses them (${filters.map(([n]) => n).join('; ')})`);

  // The ground under a speeder: a ray straight down with no groups and no predicate of its own.
  const overhead = physics.groundDistance(10, 3, 0, 5);
  ok(overhead !== null && near(overhead, 3, 0.02), `6: the ground under a peer is the ground, not the peer (${overhead?.toFixed(3)} m down)`);

  // A character controller walking into them, with the player's own filter and predicate. A solid
  // wall stands at x = 16 as the control, so "it walked past the peer" is not "it never moved".
  const wall = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 3, 5).setTranslation(16, 1, 0));
  const walk = (predicate?: (c: RAPIER.Collider) => boolean): number => {
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(7, 0.85, 0));
    const col = physics.world.createCollider(RAPIER.ColliderDesc.capsule(PEER_BODY_TUNE.halfHeight, PEER_BODY_TUNE.radius), body);
    const ctrl = physics.world.createCharacterController(0.04);
    let x = 7;
    let y = 0.85;
    for (let i = 0; i < 120; i++) {
      ctrl.computeColliderMovement(col, { x: 0.1, y: -0.05, z: 0 }, undefined, groups(Group.all, Group.all), predicate);
      const mv = ctrl.computedMovement();
      x += mv.x;
      y += mv.y;
      body.setNextKinematicTranslation({ x, y, z: 0 });
      physics.step(1 / 60);
    }
    physics.world.removeRigidBody(body);
    physics.world.removeCharacterController(ctrl);
    return x;
  };
  const walked = walk((c) => !physics.isPeer(c.handle));
  ok(walked > 14, `6: you walk straight through another player and on to the wall behind them (x = ${walked.toFixed(2)})`);
  const noPredicate = walk(undefined);
  ok(noPredicate > 14, `6: on the groups alone as well, which is what the character controller really passes (x = ${noPredicate.toFixed(2)})`);
  // And the second line is a real one: a sensor the groups did let through would stop the
  // controller dead, which is why the predicate is there as well as the groups.
  collider.setCollisionGroups(groups(Group.peer, Group.all));
  const wouldStop = walk(undefined);
  const stillPast = walk((c) => !physics.isPeer(c.handle));
  collider.setCollisionGroups(groups(Group.peer, 0));
  ok(wouldStop < 11 && stillPast > 14, `6: a peer the groups let through would stop you, and the predicate still does not (${wouldStop.toFixed(2)} against ${stillPast.toFixed(2)})`);
  physics.world.removeCollider(wall, false);

  // And the dynamic box is never touched by a peer moving straight through it, which is what being
  // a sensor buys: made solid, the same move would carry it away.
  const restingAt = boxBody.translation().x;
  for (let i = 0; i <= 20; i++) {
    bodies.peerMoved(peer(1, 9 + i * 0.15, 0, 6));
    physics.step(1 / 60);
  }
  for (let i = 0; i < 60; i++) physics.step(1 / 60);
  const after = boxBody.translation().x;
  ok(near(after, restingAt, 0.02), `6: a peer sweeping through a loose body does not shove it (${restingAt.toFixed(3)} to ${after.toFixed(3)})`);
}

// --- 7: a blow goes nowhere but out ------------------------------------------------------------------
{
  const it = [...bodies.byCollider.values()][0] as any;
  const blows: { id: number; what: string; amount: number }[] = [];
  ok(it.hp === 100, '7: a peer starts at their full health, whatever anybody here does to them');
  it.damage(30, undefined, 0, null);
  ok(it.hp === 100 && it.dead === false, '7: with nothing listening a blow takes nothing off and throws nothing');
  bodies.onBlow = (b) => blows.push({ id: b.id, what: b.what, amount: b.amount });
  it.damage(30, new THREE.Vector3(1, 2, 3), 5, null);
  ok(blows.length === 1 && blows[0].id === 1 && blows[0].what === 'body' && blows[0].amount === 30, '7: a blow struck here is handed on once, named for the peer and what was struck');
  ok(it.hp === 100, '7: and still nothing is taken off: the player who was shot is the only one who does that');
  bodies.setHealth(1, 42, 100);
  ok(it.hp === 42, '7: their health moves only when their own browser has said so');
  it.dead = true;
  it.damage(30, undefined, 0, null);
  ok(blows.length === 1, '7: a peer who is down refuses a blow, as every body in this game does on its first line');
  it.dead = false;
  // A blow struck at the moment the peer goes: the body is down and out of every lookup, and the
  // thing that was holding it hands its blow on to nobody rather than throwing inside a frame.
  const ghost = [...bodies.byCollider.values()][0] as any;
  bodies.peerRemoved(1);
  const before = blows.length;
  ghost.damage(7, undefined, 0, null);
  ok(blows.length === before + 1 && blows[blows.length - 1].id === 1, '7: a blow already in flight when they left is handed on and throws nothing');
  bodies.peerAdded(peer(1, 10, 0, 0));
  bodies.peerMoved(peer(1, 10, 0, 0));
  bodies.onBlow = null;
}

// --- 8: they go, and nothing of them is left behind ---------------------------------------------------
{
  const handle = [...bodies.byCollider.keys()][0];
  const was = bodies.version;
  bodies.peerRemoved(1);
  ok(bodies.byCollider.size === 0 && bodies.living.length === 0 && bodies.version > was, '8: a peer who leaves takes their body with them');
  ok(!physics.isPeer(handle), '8: and the engine is told, so a recycled handle is not still a peer');
  // The engine hands the same handle to the next collider made: an entry left behind would answer
  // for that one, which is the bug the fighters learned about the hard way.
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 40, 0));
  const fresh = physics.world.createCollider(RAPIER.ColliderDesc.ball(1), body);
  ok(bodies.byCollider.get(fresh.handle) === undefined, '8: so whatever the engine makes next is not found as the player who left');
  physics.world.removeRigidBody(body);
}

// --- 9: a peer's hull ----------------------------------------------------------------------------------
{
  // A picture made of two boxes and a hidden room: the room is larger than the hull round it, which
  // is what a portal hull really looks like, and it must not be what the body is measured from.
  const holder = new THREE.Object3D();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 12));
  hull.position.set(0, 1, 0);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 2));
  wing.position.set(0, 1, 1);
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40));
  room.visible = false;
  holder.add(hull, wing, room);
  const box = measureBox(holder)!;
  ok(box && near(box.half[0], 5) && near(box.half[1], 1) && near(box.half[2], 6), `9: a hull's box is its drawn meshes, rooms and all left out (${box.half.map((n) => n.toFixed(1)).join(' x ')})`);
  ok(near(box.mid[1], 1), '9: with its middle where the meshes are, not where the origin is');

  // Measured again once the picture has been placed and turned: the answer is the same, because it
  // is the picture's own frame and not the world's.
  holder.position.set(300, 50, -70);
  holder.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1);
  const again = measureBox(holder)!;
  ok(near(again.half[0], box.half[0], 1e-4) && near(again.half[2], box.half[2], 1e-4) && near(again.mid[1], box.mid[1], 1e-4), '9: and it is the same box wherever the ship has flown to');

  // The body round it follows the picture and answers for the hull rather than the figure.
  const flyer = peer(2, 300, 50, -70, { ship: holder, shipBox: box });
  bodies.peerAdded(flyer);
  bodies.peerMoved(flyer);
  physics.step(1 / 60);
  ok(bodies.byCollider.size === 2, '9: a peer flying has two bodies: the figure and the hull round it');
  const blows: string[] = [];
  bodies.onBlow = (b) => blows.push(b.what);
  for (const h of bodies.byCollider.values()) (h as any).damage(1, undefined, 0, null);
  ok(blows.length === 2 && blows.includes('body') && blows.includes('ship'), '9: and a blow says which of the two it struck');
  bodies.onBlow = null;

  // A hull that is not drawn any more (they got out, or flew to another world) takes its box down.
  const walking = peer(2, 300, 50, -70);
  bodies.peerMoved(walking);
  ok(bodies.byCollider.size === 1, '9: getting out takes the hull down and leaves the figure');
}

// --- 10: the knob and the physics world ------------------------------------------------------------------
{
  const shape = { halfHeight: PEER_BODY_TUNE.halfHeight, radius: PEER_BODY_TUNE.radius };
  // Two peers with bodies already up, so the knob is measured on bodies that have to be taken down
  // rather than on ones that are never made: it is each peer's next frame that does it, as in the game.
  const walking = peer(2, 300, 50, -70);
  const flying = peer(3, 5, 0, 5);
  bodies.peerAdded(flying);
  bodies.peerMoved(flying);
  ok(bodies.byCollider.size === 2, '10: two peers drawn have two bodies to take down');
  const off = peerBodyKnob({ on: 0 }) as any;
  bodies.peerMoved(flying);
  bodies.peerMoved(walking);
  ok(off.tune.on === 0 && bodies.byCollider.size === 0, '10: the knob turns the bodies off, for a frame with them gone to compare against');
  peerBodyKnob({ on: 1 });
  bodies.peerMoved(flying);
  bodies.peerMoved(walking);
  ok(bodies.byCollider.size === 2, '10: and puts them back');
  const report = bodies.status() as any;
  ok(report.bound === true && report.peers === 2 && report.rows.some((r: any) => r.id === 3 && r.body === true), `10: and it reports what it holds in numbers (${report.peers} peers, ${report.bodies} bodies)`);
  // A shape the engine cannot make a handle for is never asked for.
  const floored = peerBodyKnob({ radius: 0, halfHeight: -5 }) as any;
  ok(floored.tune.radius > 0 && floored.tune.halfHeight > 0, `10: a capsule of nothing is not a capsule, so the knob will not make one (${floored.tune.halfHeight} and ${floored.tune.radius})`);
  peerBodyKnob(shape);

  // A body belongs to the world it was made in: bound to another, every one of them leaves the first.
  const second = await Physics.create();
  bodies.bind(second);
  ok(bodies.byCollider.size === 0 && bodies.living.length === 0, '10: bound to another physics world, nothing of theirs is left in the one that went');
  bodies.dispose();
  ok(bodies.byCollider.size === 0, '10: and disposing takes the rest');
}

// --- 11: nothing is allocated per frame -------------------------------------------------------------------
{
  const w = await Physics.create();
  const live = new RemoteBodies().bind(w);
  const p = peer(9, 0, 0, 0);
  live.peerAdded(p);
  live.peerMoved(p);
  w.step(1 / 60);
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    for (let i = 0; i < 2000; i++) {
      p.group.position.x = i * 0.01;
      live.peerMoved(p);
    }
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 60000; i++) {
      p.group.position.x = i * 0.001;
      live.peerMoved(p);
    }
    gc();
    const grew = process.memoryUsage().heapUsed - before;
    ok(grew < 512 * 1024, `11: sixty thousand frames of moving a peer grow the heap by ${(grew / 1024).toFixed(0)} kB`);
  } else {
    ok(true, '11: run with --expose-gc to measure the heap across sixty thousand frames');
  }
  const was = live.version;
  for (let i = 0; i < 100; i++) live.peerMoved(p);
  ok(live.version === was, '11: and a hundred steady frames make no body and bump no version');
  live.dispose();
}

// --- 12: who the brains may pick a fight with ----------------------------------------------------------
// A peer is always something a bolt and a blade can find. The one list of the living is different:
// nothing on this browser can ever finish a peer, so they go on it only while a blow struck here
// could reach the browser that would subtract it. Otherwise the local wildlife abandons the player
// and mobs the picture of their friend for ever, and never hurts them.
{
  const w = await Physics.create();
  const live = new RemoteBodies().bind(w);
  const them = peer(4, 20, 0, 0);
  live.peerAdded(them);
  live.peerMoved(them);
  ok(live.byCollider.size === 1 && live.living.length === 0, '12: with nothing listening for a blow a peer is solid to a bolt and is nobody to fight');
  const was = live.version;
  live.onBlow = () => {};
  live.peerMoved(them);
  ok(live.living.length === 1 && live.version > was, '12: with a blow going somewhere they join the one list of the living, and the world is told to build it again');
  // The server's damage switch, or a duel: the wiring answers for each peer, and the answer is read
  // every frame because it changes with no message of its own.
  let may = false;
  live.mayHurt = () => may;
  live.peerMoved(them);
  ok(live.living.length === 0, '12: with damage between players switched off they are nobody to fight again');
  may = true;
  live.peerMoved(them);
  ok(live.living.length === 1, '12: and a duel, or a world with it switched on, puts them back');
  ok(live.byCollider.size === 1, '12: through all of which a bolt and a blade never stopped finding them');
  // A hook that throws loses its own peer and not the frame.
  live.mayHurt = () => {
    throw new Error('the wiring broke');
  };
  live.peerMoved(them);
  ok(live.living.length === 0, '12: and a hook that throws is read as no rather than taking the frame with it');
  live.mayHurt = null;
  // The knob takes them off the list without taking the bodies down.
  peerBodyKnob({ fight: 0 });
  live.peerMoved(them);
  ok(live.living.length === 0 && live.byCollider.size === 1, '12: the knob takes every peer off the list and leaves their bodies standing');
  peerBodyKnob({ fight: 1 });
  live.peerMoved(them);
  ok(live.living.length === 1, '12: and puts them back');
  // Whichever way they leave, they leave the list too.
  live.peerRemoved(4);
  ok(live.living.length === 0 && live.byCollider.size === 0, '12: and a peer who goes takes their place on it with them');
  live.dispose();
}

// --- 13: the interface the other packages take -----------------------------------------------------------
{
  const w = await Physics.create();
  const live = new RemoteBodies().bind(w);
  const them = peer(5, 1, 0, 1);
  live.peerAdded(them);
  live.peerAdded(them);
  live.peerMoved(them);
  ok(live.byCollider.size === 1, '13: a peer announced twice has one body, not two');
  const key = live.keyOf(5);
  ok(key > 0 && live.peerOfKey(key) === 5, `13: their place in the one list of the living names them both ways (key ${key})`);
  ok(live.keyOf(999) === 0 && live.peerOfKey(999999) === 0, '13: and a key that is nobody’s is nobody’s, never the first peer in the map');
  const body = [...live.byCollider.values()][0] as any;
  ok(body.side === 'player', '13: a peer is on the player’s side, so the creatures pick on them exactly as they pick on you');
  live.setSide(5, 'hostile');
  ok(body.side === 'hostile', '13: until whoever reads the wire says otherwise');
  live.setSide(5, 'player');
  live.setHealth(5, 1e9, 100);
  ok(body.hp === 1e9 && body.maxHp === 100, '13: health is taken as their own browser sends it and never guessed at here');
  live.setHealth(5, Number.NaN, 100);
  ok(body.hp === 1e9, '13: and a number that is not a number changes nothing');
  live.dispose();

  // A picture with nothing drawn in it has no box, and no box means no body round it rather than a
  // body of nothing: a hull whose every mesh is hidden is what a peer between worlds looks like.
  const hidden = new THREE.Object3D();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  hidden.add(mesh);
  hidden.visible = false;
  ok(measureBox(hidden) === null, '13: a picture with nothing drawn in it measures to nothing at all');
  hidden.visible = true;
  mesh.visible = false;
  ok(measureBox(hidden) === null, '13: and so does one whose every mesh is hidden');
}

// --- 14: what the peers themselves promise ----------------------------------------------------------------
// Three things live in src/net/remotePlayers.ts rather than here, and each one is a bug this file
// cannot reach: they are pinned against that file's source.
{
  const peers = src('../../../src/net/remotePlayers.ts');
  // The box round a peer's hull is measured after its wings are put where they stand. Measured
  // before, a ship first seen in flight would keep its closed box for the life of the picture, and
  // on the fighters that fold their foils that is metres of hull a bolt flies straight through.
  const snap = peers.indexOf('wings.snap(rv.wingsWant)');
  const measure = peers.indexOf('rv.box = measureBox(obj)');
  const hide = peers.indexOf('obj.visible = r.group.visible');
  ok(snap > 0 && measure > snap, '14: a peer’s hull is measured with its wings where they stand, not closed');
  ok(hide > measure, '14: and while it is still drawn, so a rider on another world still has a hull to shoot at when they come back');
  ok(/rv\.wingsMoved = false;\s*\n\s*rv\.box = measureBox\(rv\.obj\)/.test(peers), '14: and again on the one frame a swing of the wings settles on');
  ok(/if \(remote\.rig === rig && remote\.down\) this\.playDeath\(remote, 0\)/.test(peers), '14: a death that arrived before their rig did is on the figure when the rig lands');
  ok(/setHealthShare\(id: number, share: number\)/.test(peers), '14: health off the wire is a share of their own maximum, and is taken as one');
  // The three calls the other packages hang everything on, each one told every watcher there is,
  // and the frame one told last of all -- after the pictures clamped onto a hull and the figures
  // standing in one have been put where they are drawn.
  for (const hook of ['peerAdded', 'peerMoved', 'peerRemoved']) {
    ok(new RegExp(`for \\(const w of watchers\\) w\\.${hook}\\?\\.\\(`).test(peers), `14: every watcher is told ${hook}, not just the first`);
  }
  const docked = peers.indexOf('if (anyDocked) this.placeDocked();');
  const aboard = peers.indexOf('if (anyAboard) this.placeAboard();');
  const moved = peers.indexOf('for (const w of watchers) w.peerMoved?.(v);');
  ok(docked > 0 && aboard > docked && moved > aboard, '14: and the frame’s word comes after both passes that move a figure, so a body never follows last frame’s pose');
  ok(/export function watchPeers\(w: PeerWatcher\): \(\) => void/.test(peers), '14: and listening hands back the way to stop, so nothing outlives what made it');
  // The one call the network side makes to put blows on the wire: without it a bolt stops on a peer
  // and nothing whatever is sent, which is the game with no server and is what a page that never
  // calls it stays.
  ok(/sendBlowsTo\(hand: \(\(blow: PeerBlow\) => void\) \| null, may: \(\(id: number\) => boolean\) \| null = null\): void \{[\s\S]{0,200}b\.onBlow = hand;[\s\S]{0,60}b\.mayHurt = may;/.test(peers), '14: and one call puts every blow struck here on the wire, with nothing of the physics in it');
  // Which state words off the wire are drawn. The set is written out in that file rather than
  // imported, because importing the rig from the network side would pull the saber, the throw, the
  // ragdoll and the movement port in behind it -- so the two lists can drift, and they did: the six
  // prone blaster carries were added to the rig and never added here, and a player lying prone with
  // a blaster was drawn standing on every other screen. Anything missing is read as `idle`, which is
  // a body standing up, so the failure is silent by construction and only a check like this one can
  // see it.
  const states = /const STATES: Set<string> = new Set\(\[([^\]]*)\]\)/.exec(peers)?.[1] ?? '';
  const drawn = new Set(states.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean));
  const rigSrc = src('../../../src/player/rig.ts');
  const union = /export type RigState = ([^;]+);/.exec(rigSrc)?.[1] ?? '';
  const all = union.split('|').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  ok(all.length > 30 && drawn.size > 0, '14: both lists are still spelled the way this check reads them');
  const missing = all.filter((s) => !drawn.has(s));
  ok(missing.length === 0, `14: every one of the rig's ${all.length} states is drawn on a peer${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
  const extra = [...drawn].filter((s) => !all.includes(s));
  ok(extra.length === 0, `14: and the peer list invents none of its own${extra.length ? ` (extra: ${extra.join(', ')})` : ''}`);
}

console.log(`\n${checks} checks passed`);
