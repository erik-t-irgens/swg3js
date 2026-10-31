// The AI handoff's steps 1 to 3 (its fourth section; `src/world/aiLedger.ts`), against the game's own code.
//
// 1. **The wall tests.** A real physics world with a building in it -- an outer shell of trimesh walls (the exterior
//    group, as the streamer builds a cell 0 primitive) with a doorway, and an inner wall (the interior group) splitting
//    it into two rooms with a doorway of its own -- and `wallBetween`, `Physics.segmentBlocked`'s `full` and the ledger's
//    own line asked the real questions: two in different rooms with a wall between, one just inside a door and one
//    outside beside the jamb, two in one room. And the shells' shape is measured rather than assumed: a ray that starts
//    within a trimesh wall's thickness meets its far face where it crosses it, where a solid box answers nought at once.
// 2. **Aim at the player's real posture.** `playerMiddle`, which `PlayerTarget.halfHeight` returns, is the middle of the
//    capsule the player wears; a peer's body (`RemoteBodies`) wears the low capsule and is aimed at its middle while
//    the state they send says they are low. A real crate is then asked whether it hides the two aim points, the ruler
//    is asked over it with step 2 off, and the cover search is asked where a crouched player's shots come from
//    (`shotHeightOf`): not from the hip step 2 aims at.
// 3. **Route every move.** The standoff's try order, which the fighters and the people share (`StandoffTries`, run here
//    through `GroundTactics.stepStandoff`): the slide's lean laid on its point before the route, the point refused when
//    it fails, the slide the other way tried and kept, the ring with no slide after that. The rule for the feet and the
//    gun, which they share too (`legsFor`), run over a tiered slide walking a real room's floor plan after plan. The
//    check itself (`walkGoalFits`) on a real room floor and a real baked grid, legs across a footprint and a solid
//    block and one the body's own width decides, and the cover search's `standsOn`.
//
// What only the game hands over -- the fighters' and the mobiles' own wiring, which node cannot load -- is pinned as text
// at the end, each pin naming the line it holds.
//
// Synthetic throughout: every wall, floor and grid below is written in this file. Nothing comes from the game's archives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Group, Physics, RAPIER, TRIMESH_FLAGS, groups } from '../../../src/core/physics.ts';
import {
  AI_FIX,
  AI_LEDGER,
  LEDGER_TUNE,
  LEDGER_WORLD,
  OLD_PLAYER_MIDDLE,
  PLAYER_SHOT_FROM,
  acrossShell,
  newPushWatch,
  noteFight,
  noteLanded,
  noteShot,
  playerMiddle,
  resetLedger,
  seesLine,
  shotHeightOf,
  stepPush,
  wallNear,
  type LedgerRow,
} from '../../../src/world/aiLedger.ts';
import { DoorLegs, doorwayNav, wallBetween, sameRoom } from '../../../src/world/nav/doorway.ts';
import { NavAgent } from '../../../src/world/nav/navAgent.ts';
import { walkGoalFits } from '../../../src/world/nav/goalFits.ts';
import { outdoorNav } from '../../../src/world/nav/outdoorNav.ts';
import { LEGS, legsFor } from '../../../src/world/groundMove.ts';
import { decodeGrid, type OutdoorHeader } from '../../../src/world/nav/outdoorGrid.ts';
import { CLEARANCE_MAX, COARSE, NAV_GRID_VERSION, SLOPE_CLIMB_DEGREES, packGrid } from '../navgrid.mjs';
import { GroundTactics } from '../../../src/world/mobiles/tactics.ts';
import { GROUND_STEP } from '../../../src/world/groundStep.ts';
import { wrapAngle } from '../../../src/world/fighterStance.ts';
import { CoverSearch, type Blocker, type CoverAsk, type CoverDeps } from '../../../src/world/cover.ts';
import { PEER_BODY_TUNE, RemoteBodies, peerLow } from '../../../src/net/remoteBodies.ts';
import type { Building, CellState } from '../../../src/world/layoutStream.ts';
import type { CellDef, PortalDef } from '../../../src/world/nav/navRooms.ts';
import { PLAYER_KEY, type Living } from '../../../src/combat/kit.ts';

await Physics.create();

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---- the building ---------------------------------------------------------------------------------------------------
//
// Ten metres square at the origin, walls 0.3 m thick and 3 m high. The shell: a south wall with a 2 m doorway at
// x 4..6, and the north, west and east walls whole. Inside, a wall along z = 5 splits it into room 1 (z 0..5) and room
// 2 (z 5..10), with a 2 m doorway of its own at x 7..9. Every wall is a trimesh slab, as the streamer builds one.

/** A box as a trimesh: eight corners, twelve triangles, in the given collision group. No orientation, so no inside. */
function slab(physics: Physics, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, member: number): RAPIER.Collider {
  const v = new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
  const i = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]);
  return physics.world.createCollider(RAPIER.ColliderDesc.trimesh(v, i, TRIMESH_FLAGS).setCollisionGroups(groups(member, Group.all)));
}

const physics = Physics.local();
const EXT = Group.exterior;
const INT = Group.interior;
const T = 0.15;
slab(physics, 0, 4, 0, 3, -T, T, EXT); // the south wall, west of the doorway
slab(physics, 6, 10, 0, 3, -T, T, EXT); // ... and east of it
slab(physics, 0, 10, 0, 3, 10 - T, 10 + T, EXT); // north
slab(physics, -T, T, 0, 3, 0, 10, EXT); // west
slab(physics, 10 - T, 10 + T, 0, 3, 0, 10, EXT); // east
slab(physics, 0, 7, 0, 3, 5 - 0.1, 5 + 0.1, INT); // the inner wall, west of its doorway
slab(physics, 9, 10, 0, 3, 5 - 0.1, 5 + 0.1, INT); // ... and east of it
physics.stepOnce();

const house = { template: 'drawn' } as unknown as Building;
const room1: CellState = { building: house, cell: 1 };
const room2: CellState = { building: house, cell: 2 };
const other: CellState = { building: { template: 'other' } as unknown as Building, cell: 1 };

/** `wallBetween` between two middles a metre up, the body's own filter its own room's. */
const apart = (here: CellState | null, ax: number, az: number, there: CellState | null | undefined, bx: number, bz: number, probe: Physics | null = physics): boolean =>
  wallBetween(probe, here, there, here !== null, ax, 1, az, bx, 1, bz);

// ---- 1: the wall tests ------------------------------------------------------------------------------------------------
{
  // The shells' shape, measured: a trimesh has no inside, a solid has.
  const r = new RAPIER.Ray({ x: 2, y: 1, z: 0 }, { x: 0, y: 0, z: -1 });
  const inWall = physics.world.castRay(r, 5, true, undefined, groups(Group.all, Group.all));
  ok(!!inWall && near(inWall.timeOfImpact, T, 1e-4), `a ray that starts within a trimesh wall's thickness meets its far face where it crosses it (${inWall?.timeOfImpact.toFixed(3)} m), never at nought: the shells need no split at the doorway's plane`);
  const solid = Physics.local();
  solid.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 1.5, T).setTranslation(2, 1.5, 0));
  solid.stepOnce();
  const inBox = solid.world.castRay(r, 5, true);
  ok(!!inBox && inBox.timeOfImpact === 0, '... where the same wall as a solid box answers nought at once, which is the case a split would have been for');

  ok(acrossShell(room1, null) && acrossShell(null, room1) && acrossShell(room1, other), 'in a building and out, or in two buildings, is across a shell');
  ok(!acrossShell(room1, room2) && !acrossShell(null, null) && !acrossShell(room1, undefined), '... two in one building, two outside, and anything nobody follows are not');
  ok(sameRoom(room1, { building: house, cell: 1 }) && !sameRoom(room1, room2) && sameRoom(null, null) && !sameRoom(room1, null), 'a room is its building and its cell, and open ground is one room');

  // Two in different rooms of one building, the inner wall between: apart.
  ok(apart(room1, 5, 2.5, room2, 5, 7.5), 'two bodies in different rooms of one building, an inner wall between them: a wall between (step 1 compares rooms, not buildings)');
  ok(!apart(room1, 8, 2.5, room2, 8, 7.5), '... the same two either side of the doorway between the rooms: no wall, the blow lands');
  ok(!apart(room1, 2, 2, room1, 3, 3), 'both in one room, nothing between: no wall');
  // One just inside the front door, one outside beside the jamb: the line crosses the shell's own wall.
  ok(apart(room1, 3.6, 0.6, null, 1.6, -1.2), 'one just inside a door and one outside beside the jamb: a wall between, the jamb itself (the shell is tested across it)');
  ok(!apart(room1, 5, 0.6, null, 5, -1.2), '... one inside and one outside, straight through the doorway: no wall');
  ok(apart(null, -2, 2.5, null, 12, 2.5), 'two outside with the building between them: a wall between (step 1 asks the physics of every pair)');
  ok(!apart(room1, 5, 2.5, undefined, 5, 7.5), '... and anything nobody follows is never apart, as before');
  ok(apart(room1, 5, 2.5, room2, 5, 7.5, null) && !apart(room1, 5, 2.5, room1, 5, 4, null), 'with no physics to ask, apart exactly when the rooms differ');

  // `full` on the physics' own line: a caster inside leaves the shells out unless the line is across one.
  const from = { x: 3.6, y: 1, z: 0.6 };
  const to = { x: 1.6, y: 1, z: -1.2 };
  ok(!physics.segmentBlocked(from, to, true) && physics.segmentBlocked(from, to, true, false, true), '`segmentBlocked` from inside: the jamb is no wall with the shells left out, and is one with `full`');
  ok(physics.segmentBlocked(from, to, false), '... and from outside it always was');

  // Step 1 off is the rule it replaced: the jamb, two outside, and two in one building are never apart.
  AI_FIX.walls = false;
  try {
    ok(!apart(room1, 3.6, 0.6, null, 1.6, -1.2), 'with step 1 off, the body inside struck through the jamb (the old filter left the shell out)');
    ok(!apart(room1, 5, 2.5, room2, 5, 7.5) && !apart(null, -2, 2.5, null, 12, 2.5), '... and two in one building, or two outside, were never asked');
  } finally {
    AI_FIX.walls = true;
  }

  // A shut door in the front doorway: the doorway test of who can reach whom does not see it (the door is opening for a
  // body that near), and the line of fire, which asks with `walls`, does.
  const leaf = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(5, 1.25, 0));
  const leafCollider = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1.25, 0.05), leaf);
  physics.markWall(leafCollider, true);
  physics.stepOnce();
  ok(!apart(room1, 5, 0.6, null, 5, -1.2), 'a shut door is no wall to the doorway test, which never saw doors (it is opening for whoever is that near)');
  ok(!seesLine(physics, room1, null, 5, 1, 0.6, 5, 1, -1.2), "... and is one to the ledger's line, which asks as a gunner's line of fire does");
  physics.markWall(leafCollider, false);
  physics.world.removeRigidBody(leaf);
  physics.stepOnce();
  ok(seesLine(physics, room1, null, 5, 1, 0.6, 5, 1, -1.2), '... the door taken away, the line through the doorway is clear');
}

// ---- 1b: the ledger's own probes ----------------------------------------------------------------------------------
{
  const reach = 0.35 + LEDGER_TUNE.brush;
  ok(wallNear(physics, 2, 0, 4.55, reach, true), 'a body 0.35 m off the inner wall indoors is brushing it');
  ok(!wallNear(physics, 2, 0, 2.5, reach, true), '... one in the middle of the room is not');
  ok(wallNear(physics, 2, 0, -0.5, reach, false) && !wallNear(physics, 2, 0, -0.5, reach, true), "... and the shell is a wall to a body outside, never to one inside, whose rays leave the shells out as everything of a body's indoors does");

  LEDGER_WORLD.physics = physics;
  const cells = new Map<number, CellState | null>();
  LEDGER_WORLD.cellOf = (t: Living) => cells.get(t.key);
  const body = (key: number, x: number, z: number, cell: CellState | null, row: typeof AI_LEDGER.fighters | null): Living => {
    cells.set(key, cell);
    return { key, pos: new THREE.Vector3(x, 0, z), halfHeight: 0.9, side: 'fighter', aggression: 'aggressive', dead: false, label: 'drawn', radiusToward: () => 0.35, damage() {}, ...(row ? { ledgerRow: row } : {}) } as unknown as Living;
  };
  resetLedger(0);
  const striker = body(10, 5, 2.5, room1, AI_LEDGER.fighters);
  noteLanded(striker, body(11, 5, 7.5, room2, null));
  noteLanded(striker, body(12, 8, 4, room1, null));
  ok(AI_LEDGER.fighters.hits === 2 && AI_LEDGER.fighters.unseen === 1, 'a blow landed through the inner wall is unseen; one landed across the room is not');
  noteLanded(body(13, 5, 2.5, room1, null), body(14, 5, 7.5, room2, null));
  ok(AI_LEDGER.fighters.hits === 2 && AI_LEDGER.people.hits === 0, '... and a blow from something that keeps no row (the player, another player) is not counted at all');

  // A shot at the player, measured to the middle of the capsule the player really wears whatever step 2 says: from
  // room 1 at the player in room 2, hidden by the inner wall; across the doorway between the rooms, not.
  resetLedger(0);
  const gunner = body(15, 2, 2.5, room1, AI_LEDGER.fighters) as Living & { ledgerRow: typeof AI_LEDGER.fighters };
  const me = { ...body(PLAYER_KEY, 2, 7.5, room2, null), capsule: { colliderOffsetY: 0.5 } } as unknown as Living;
  cells.set(PLAYER_KEY, room2);
  noteShot(gunner, me, 2, 1.3, 2.5);
  noteShot(gunner, body(16, 2, 7.5, room2, null), 2, 1.3, 2.5);
  ok(AI_LEDGER.fighters.shots === 2 && AI_LEDGER.player.shotsAt === 1 && AI_LEDGER.player.hidden === 1, 'a shot at the player through the inner wall is counted on the shooter, at the player, and as hidden; one at anybody else only on the shooter');
  me.pos.set(8, 0, 7.5);
  noteShot(gunner, me, 8, 1.3, 2.5);
  ok(AI_LEDGER.player.shotsAt === 2 && AI_LEDGER.player.hidden === 1, '... and one across the doorway between the rooms is not hidden');
  resetLedger(0);

  // A fight's frames, counted: every second in it, and of those the seconds brushing, pushing and fighting through a wall.
  const r: LedgerRow = { fighting: 0, brushing: 0, pushing: 0, wallFight: 0, hits: 0, unseen: 0, shots: 0, refused: 0 };
  noteFight(r, 0.5, true, false, true);
  noteFight(r, 0.25, false, true, false);
  ok(near(r.fighting, 0.75) && near(r.brushing, 0.5) && near(r.pushing, 0.25) && near(r.wallFight, 0.5), "a fight's frames go on its row: every second in it, and the seconds brushing, pushing and through a wall each as it was true");

  // A person's pushing, over a window: the body moves only on the physics' whole sixtieths and is read before the frame's
  // step (`Mobile.update`, then the world's physics), so it is the same at sixty frames a second and at a hundred and
  // forty-four, free or held still against something.
  const pushed = (fps: number, free: boolean): number => {
    const row: LedgerRow = { fighting: 0, brushing: 0, pushing: 0, wallFight: 0, hits: 0, unseen: 0, shots: 0, refused: 0 };
    const w = newPushWatch();
    const STEP = 1 / 60;
    const speed = 2;
    let x = 0;
    let acc = 0;
    for (let f = 0; f < fps * 3; f++) {
      stepPush(w, row, 1 / fps, speed, x, 0);
      acc += 1 / fps;
      while (acc >= STEP - 1e-12) {
        acc -= STEP;
        if (free) x += speed * STEP;
      }
    }
    return row.pushing;
  };
  const free60 = pushed(60, true);
  const free144 = pushed(144, true);
  const held60 = pushed(60, false);
  const held144 = pushed(144, false);
  ok(free60 === 0 && free144 === 0, `a person walking freely is never pushing, at sixty frames a second or a hundred and forty-four (${free60}, ${free144}): the window spans the frames between the physics' steps`);
  ok(held60 > 2.5 && held144 > 2.5 && Math.abs(held60 - held144) <= LEDGER_TUNE.pushWindow, `... and one held still against something is pushing for the whole of it at either rate (${held60.toFixed(2)} s, ${held144.toFixed(2)} s of 3)`);
}

// ---- 2: aim at the player's real posture -------------------------------------------------------------------------
const playerSrc = src('player/player.ts');
const CAPSULE_RADIUS = Number(/const CAPSULE_RADIUS = ([\d.]+);/.exec(playerSrc)?.[1]);
const STAND_HALF = Number(/const STAND_HALF_HEIGHT = ([\d.]+);/.exec(playerSrc)?.[1]);
const LOW_HALF = Number(/const CROUCH_HALF_HEIGHT = ([\d.]+);/.exec(playerSrc)?.[1]);
/** The player's own capsule as the player writes it (`colliderOffsetY`), its numbers read out of `player.ts`. */
const capsuleOf = (low: boolean): { colliderOffsetY: number } => ({ colliderOffsetY: CAPSULE_RADIUS + (low ? LOW_HALF : STAND_HALF) });
{
  const capsule = capsuleOf(false);
  ok(near(playerMiddle(capsule), 0.8), `standing, the player is aimed at the middle of the standing capsule (${playerMiddle(capsule)} m)`);
  capsule.colliderOffsetY = capsuleOf(true).colliderOffsetY;
  ok(near(playerMiddle(capsule), 0.5), `crouched, kneeling or prone, at the middle of the low capsule all three wear (${playerMiddle(capsule)} m), read live off the capsule`);
  ok(playerMiddle(null) === OLD_PLAYER_MIDDLE, 'with no capsule handed over, the 0.9 it was');
  AI_FIX.posture = false;
  try {
    ok(playerMiddle(capsule) === OLD_PLAYER_MIDDLE, 'with step 2 off, the 0.9 it was whatever the player is doing');
  } finally {
    AI_FIX.posture = true;
  }

  // What that buys behind a crate 0.85 m high, a metre in front of the player, from a gun held at 1.3 m ten metres off,
  // the player crouched behind it and aimed at where `playerMiddle` says.
  const range = Physics.local();
  range.world.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 0.425, 0.4).setTranslation(9, 0.425, 0));
  // And a table: a top 0.7 to 0.75 m up on four thin legs, a metre in front of the player on the other side.
  range.world.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.025, 0.4).setTranslation(-9, 0.725, 0));
  for (const lx of [-9.55, -8.45]) for (const lz of [-0.35, 0.35]) range.world.createCollider(RAPIER.ColliderDesc.cuboid(0.03, 0.35, 0.03).setTranslation(lx, 0.35, lz));
  // And a kerb 0.3 m high between two bodies standing on open ground to the north.
  range.world.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 0.15, 0.4).setTranslation(0, 0.15, 9));
  range.stepOnce();
  const muzzle = { x: 0, y: 1.3, z: 0 };
  const line = (tx: number, aim: number): boolean => !range.segmentBlocked(muzzle, { x: tx, y: aim, z: 0 }, false, true);
  ok(!line(10, playerMiddle(capsule)), 'crouched behind a 0.85 m crate, the line to where the player really is (the low capsule\'s middle) is blocked: no shot');
  AI_FIX.posture = false;
  try {
    ok(line(10, playerMiddle(capsule)), '... where with step 2 off the line went over the top to 0.9 m, and the shooter stood and fired at a body it could not see');
  } finally {
    AI_FIX.posture = true;
  }
  // Whether a table should hide a body lying behind it is a rule nobody has decided, so it is printed, not held.
  console.log(`note prone behind a table, the line to the low capsule's middle is ${line(-10, playerMiddle(capsule)) ? 'open: it passes under the top, as a bolt would' : 'blocked'} (not a requirement: the rule is undecided)`);

  // The ruler over that crate: it reads the capsule the player really wears whatever step 2 says, so a shot at the
  // crouched player from over the crate is hidden with step 2 on and with it off.
  LEDGER_WORLD.physics = range;
  LEDGER_WORLD.cellOf = () => null;
  resetLedger(0);
  const gunner = { key: 40, pos: new THREE.Vector3(0, 0, 0), halfHeight: 0.9, side: 'fighter', aggression: 'aggressive', dead: false, label: 'drawn', radiusToward: () => 0.35, damage() {}, ledgerRow: AI_LEDGER.fighters } as unknown as Living & { ledgerRow: LedgerRow };
  const me = {
    key: PLAYER_KEY,
    pos: new THREE.Vector3(10, 0, 0),
    capsule,
    get halfHeight(): number {
      return playerMiddle(this.capsule);
    },
    shotHeight: PLAYER_SHOT_FROM,
    side: 'player',
    aggression: 'aggressive',
    dead: false,
    label: 'me',
    radiusToward: () => 0.35,
    damage() {},
  } as unknown as Living;
  noteShot(gunner, me, muzzle.x, muzzle.y, muzzle.z);
  ok(AI_LEDGER.player.shotsAt === 1 && AI_LEDGER.player.hidden === 1, 'the ruler: a shot at the crouched player from over the crate is hidden');
  AI_FIX.posture = false;
  try {
    noteShot(gunner, me, muzzle.x, muzzle.y, muzzle.z);
    ok(AI_LEDGER.player.shotsAt === 2 && AI_LEDGER.player.hidden === 2, '... and so with step 2 off, where the aim point is 0.9 m and over the crate: the ruler reads the capsule itself, so a "before" and an "after" are one ruler');
  } finally {
    AI_FIX.posture = true;
  }
  // A blow landed is measured from middle to middle, not feet to feet: two bodies either side of a kerb see each other.
  resetLedger(0);
  const struck = { key: 41, pos: new THREE.Vector3(0, 0, 10), halfHeight: 0.9, side: 'fighter', aggression: 'aggressive', dead: false, label: 'drawn', radiusToward: () => 0.35, damage() {} } as unknown as Living;
  const striker = { ...gunner, key: 42, pos: new THREE.Vector3(0, 0, 8) } as unknown as Living;
  noteLanded(striker, struck);
  ok(AI_LEDGER.fighters.hits === 1 && AI_LEDGER.fighters.unseen === 0, 'a blow landed across a 0.3 m kerb is seen: measured middle to middle, never feet to feet');
  resetLedger(0);

  // Where a crouched player's shots come from, for the cover search (`shotHeightOf`): the height it always read, not
  // the hip step 2 aims at. A spot 0.6 m behind that crate, the crouched player 6 m off: the standing chest clears the
  // crate toward 0.9 m and is blocked toward the hip, so judged from the hip it is a hole, which the player shoots over.
  ok(near(me.halfHeight, 0.5) && shotHeightOf(me) === PLAYER_SHOT_FROM && near(PLAYER_SHOT_FROM, 0.9), `a crouched player is aimed at 0.5 m and taken to shoot from ${PLAYER_SHOT_FROM} m`);
  ok(shotHeightOf(gunner) === gunner.halfHeight, '... and every threat that says no height of its own shoots from its aim point, as it always did');
  const rayR = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  const rangeDeps: CoverDeps = {
    blockers: () => 0,
    hit: (ax, ay, az, bx2, by, bz2) => {
      const len = Math.hypot(bx2 - ax, by - ay, bz2 - az);
      rayR.origin.x = ax;
      rayR.origin.y = ay;
      rayR.origin.z = az;
      rayR.dir.x = (bx2 - ax) / len;
      rayR.dir.y = (by - ay) / len;
      rayR.dir.z = (bz2 - az) / len;
      const h = range.world.castRay(rayR, len, true);
      return h ? h.timeOfImpact : Infinity;
    },
    floor: () => 0,
  };
  const threat = { key: PLAYER_KEY, pos: new THREE.Vector3(4, 0, 0) };
  const coverAsk: CoverAsk = { x: 10, y: 0, z: 0, tx: threat.pos.x, ty: threat.pos.y + shotHeightOf(me), tz: 0, reach: 12, hardCost: 0, indoors: false };
  ok(new CoverSearch().test(rangeDeps, coverAsk, 10, 0, 0) === 'crouch', 'judged against where a crouched player shoots from, the spot behind the crate is cover to crouch in and shoot over');
  coverAsk.ty = threat.pos.y + me.halfHeight;
  ok(new CoverSearch().test(rangeDeps, coverAsk, 10, 0, 0) === 'hard', '... where judged against the hip step 2 aims at, it read as a hole nobody could shoot out of, which the player shoots over');

  // A peer: low while the state they send says so, and aimed at the middle of the capsule they wear. Every state the
  // player's own rig names for a crouch, a kneel or lying prone is low, and no other: read off the rig's own list.
  const rig = src('player/rig.ts');
  const states = [...(/export type RigState = ([^;]+);/.exec(rig)?.[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  const lowStates = states.filter((s) => /^(crouch|kneel|prone|gunProne)/.test(s));
  ok(states.length > 20 && lowStates.length >= 10, `the rig names ${states.length} states, ${lowStates.length} of them crouched, kneeling or prone`);
  ok(lowStates.every((s) => peerLow(s)) && states.filter((s) => !lowStates.includes(s)).every((s) => !peerLow(s)), `the states a peer is low in are exactly the rig's crouched, kneeling and prone ones (${lowStates.join(', ')})`);
  ok(near(PEER_BODY_TUNE.lowHalf, LOW_HALF), `a peer's low capsule is the player's own (${LOW_HALF})`);
  const world = Physics.local();
  const bodies = new RemoteBodies().bind(world);
  const group = new THREE.Object3D();
  group.position.set(3, 0, 4);
  const view = { id: 7, name: 'p', shown: true, group, rig: null, ship: null, shipBox: null, hp: 100, maxHp: 100, down: false, low: false, saber: false, saberColor: 0 } as unknown as Parameters<RemoteBodies['peerMoved']>[0];
  bodies.peerAdded(view);
  bodies.peerMoved(view);
  const figure = bodies.byCollider.values().next().value as Living & { low: boolean };
  const collider = () => {
    for (const [h] of bodies.byCollider) return world.world.getCollider(h);
    return null;
  };
  ok(near(figure.halfHeight, 0.8) && near(collider()!.halfHeight(), PEER_BODY_TUNE.halfHeight), 'a peer standing is aimed at 0.8 m and wears the standing capsule');
  (view as unknown as { low: boolean }).low = true;
  bodies.peerMoved(view);
  world.stepOnce();
  ok(near(figure.halfHeight, 0.5) && near(collider()!.halfHeight(), PEER_BODY_TUNE.lowHalf), 'gone low, the same body wears the low capsule and is aimed at its middle (0.5 m)');
  ok(near(collider()!.translation().y, PEER_BODY_TUNE.radius + PEER_BODY_TUNE.lowHalf, 1e-4), '... the capsule set on their feet, not left floating where the standing one hung');
  ok(shotHeightOf(figure) === PLAYER_SHOT_FROM, "... and, low, still taken to shoot from the player's own height, not the hip");
  AI_FIX.posture = false;
  try {
    bodies.peerMoved(view);
    ok(figure.halfHeight === OLD_PLAYER_MIDDLE && near(collider()!.halfHeight(), PEER_BODY_TUNE.halfHeight), 'with step 2 off, a peer is the standing 1.6 m pillar aimed at 0.9 m it was');
  } finally {
    AI_FIX.posture = true;
  }
  bodies.dispose();
}

// ---- 3: route every move -------------------------------------------------------------------------------------------
{
  // The standoff, the people's own (`GroundTactics`), tier 5 so it slides and leans. The target at the origin, the body
  // out on the ring to the north-east, a fixed run of numbers for the slide's dice, and three seconds in, past the duty
  // cycle's first roll. The ring's own spread of slots is taken to nought for the section, so a body on its ring is in
  // its slot and its slide is the whole of its travel: the two ways round are then mirror images of each other.
  const spread = GROUND_STEP.ringSpread;
  GROUND_STEP.ringSpread = 0;
  const tac = new GroundTactics(1);
  tac.setTier(5, 'humanoid', false);
  const dice = (seq: number[]): (() => number) => {
    let i = 0;
    return () => seq[i++ % seq.length];
  };
  const ring = 20 * GROUND_STEP.standoff;
  const bx = ring * Math.SQRT1_2;
  const bz = ring * Math.SQRT1_2;
  const face = Math.atan2(-bx, -bz);
  // With no check (step 3 off): the slide's point as it always was, past the lean.
  const free = tac.stepStandoff(3, bx, bz, 0, 0, ring, 3, true, false, 20, 3, dice([0.9, 0]));
  const freeOff = Math.abs(wrapAngle(Math.atan2(tac.walkTo.x - bx, tac.walkTo.z - bz) - face));
  ok(free && tac.leanOnly && freeOff > tac.slideLean + 1e-3, `with no check the slide's point lies past the lean (${((freeOff * 180) / Math.PI).toFixed(0)} degrees off the gun, the lean ${((tac.slideLean * 180) / Math.PI).toFixed(0)}), which the heading was clamped back from after the route`);
  // With a check that takes everything: the same slide, its lean laid on its point before the route.
  const tac2 = new GroundTactics(1);
  tac2.setTier(5, 'humanoid', false);
  ok(tac2.stepStandoff(3, bx, bz, 0, 0, ring, 3, true, false, 20, 3, dice([0.9, 0]), () => true), 'with a check, a place on the ring is still found');
  const leanOff = Math.abs(wrapAngle(Math.atan2(tac2.walkTo.x - bx, tac2.walkTo.z - bz) - face));
  ok(near(leanOff, tac2.slideLean, 1e-9), `... its lean laid on the point itself (${((leanOff * 180) / Math.PI).toFixed(1)} degrees off the gun): the route is asked for a point the legs can walk with the gun on the target`);
  const freeSign = Math.sign(wrapAngle(Math.atan2(tac.walkTo.x - bx, tac.walkTo.z - bz) - face));
  const leanSign = Math.sign(wrapAngle(Math.atan2(tac2.walkTo.x - bx, tac2.walkTo.z - bz) - face));
  ok(freeSign !== 0 && leanSign === freeSign, '... on the side the slide was going, not the mirror of it');

  // A check that refuses the slide as chosen: the other way is tried, taken and kept.
  const tac3 = new GroundTactics(1);
  tac3.setTier(5, 'humanoid', false);
  const side = (gx: number, gz: number): number => Math.sign(-(gz - bz) * (0 - bx) + (gx - bx) * (0 - bz));
  let firstSide = 0;
  ok(tac3.stepStandoff(3, bx, bz, 0, 0, ring, 3, true, false, 20, 3, dice([0.9, 0])), 'the slide first goes one way');
  firstSide = side(tac3.walkTo.x, tac3.walkTo.z);
  const tac4 = new GroundTactics(1);
  tac4.setTier(5, 'humanoid', false);
  const refuseFirst = (gx: number, gz: number): boolean => side(gx, gz) !== firstSide;
  ok(tac4.stepStandoff(3, bx, bz, 0, 0, ring, 3, true, false, 20, 3, dice([0.9, 0]), refuseFirst) && side(tac4.walkTo.x, tac4.walkTo.z) === -firstSide, 'refused that way (a wall there), it slides the other way');
  // The next frame, every place it asks about recorded: the first is the way it kept, and the wall is never tried again.
  const asked: number[] = [];
  const recording = (gx: number, gz: number): boolean => {
    asked.push(side(gx, gz));
    return refuseFirst(gx, gz);
  };
  ok(tac4.stepStandoff(3.1, bx, bz, 0, 0, ring, 3, true, false, 20, 3, dice([0.9, 0]), recording) && side(tac4.walkTo.x, tac4.walkTo.z) === -firstSide, '... and slides that way on the next frame too');
  ok(asked.length === 1 && asked[0] === -firstSide, `... asking first about the way it kept, never the wall again (it asked about ${asked.length} place(s))`);

  // Refused every way: no place is picked, and it is counted once a refusal, not once a frame.
  const tac5 = new GroundTactics(1);
  tac5.setTier(5, 'humanoid', false);
  const row = { refused: 0 };
  tac5.ledger = row;
  let picked = 0;
  for (let f = 0; f < 30; f++) if (tac5.stepStandoff(3 + f / 60, bx, bz, 0, 0, ring, 3, true, false, 20, 3, dice([0.9, 0]), () => false)) picked++;
  ok(picked === 0, 'refused every way, no place on the ring is ever picked and walked into: the body holds its ground');
  ok(tac5.counts.refused === 1 && row.refused === 1, `... counted once for the refusal, over thirty frames of it (${tac5.counts.refused}), and on the body's own ledger row`);

  // Refused both ways round, the ring with no slide at all: a body standing out past its ring, a slide each way off the
  // line to the target and a check that takes only a place on that line, so the third try is the only one that fits.
  const tac6 = new GroundTactics(1);
  tac6.setTier(5, 'humanoid', false);
  const far = ring * 1.4;
  const fx = far * Math.SQRT1_2;
  const fz = far * Math.SQRT1_2;
  const offLine = (gx: number, gz: number): number => Math.abs((gx - fx) * (0 - fz) - (gz - fz) * (0 - fx)) / Math.hypot(fx, fz);
  const askedLine: number[] = [];
  const onLine = (gx: number, gz: number): boolean => {
    askedLine.push(offLine(gx, gz));
    return offLine(gx, gz) < 1e-6;
  };
  ok(tac6.stepStandoff(3, fx, fz, 0, 0, far, 3, true, false, 20, 3, dice([0.9, 0]), onLine), 'refused both ways round, the ring with no slide at all is tried and taken');
  ok(askedLine.length === 3 && askedLine[0] > 0.5 && askedLine[1] > 0.5 && offLine(tac6.walkTo.x, tac6.walkTo.z) < 1e-6 && Math.hypot(tac6.walkTo.x, tac6.walkTo.z) < far, `... after the slide as chosen and the slide the other way, straight in toward its ring (${askedLine.length} places asked about)`);
  GROUND_STEP.ringSpread = spread;

  // Where the feet go and whether the gun goes with them (`legsFor`, the fighters' and the people's one rule): a slide
  // the route walks straight is held to its tier's lean; one whose corner the route chose keeps the gun on what it fights
  // up to the legs' own ceiling, and past that is a move, which takes the gun.
  const lean3 = Math.asin(0.35);
  legsFor(lean3 + 0.05, 0, true, lean3, false);
  ok(near(LEGS.head, lean3) && !LEGS.gunOnFeet, 'a slide the route walks straight, a little past its lean: the feet laid on the lean, the gun where it is');
  legsFor(lean3 + 0.05, 0, true, lean3, true);
  ok(LEGS.head === lean3 + 0.05 && !LEGS.gunOnFeet, '... the same slide on a corner the route chose: walked as the route says, the gun still on what it fights');
  legsFor(GROUND_STEP.legMax + 0.05, 0, true, lean3, true);
  ok(LEGS.head === GROUND_STEP.legMax + 0.05 && LEGS.gunOnFeet, "... and past the legs' own ceiling a move, which takes the gun with it");

  // The check itself, indoors: a room's own floor, five metres by five, the body in it.
  const floor = (() => {
    const v: number[] = [];
    for (const [x, z] of [[0, 0], [5, 0], [5, 5], [0, 5]]) v.push(x, 0, z);
    return { v, t: [0, 1, 2, 0, 2, 3] };
  })();
  const cellDefs = [
    { index: 0, name: 'r0', bounds: { min: [-1, -1, -1], max: [11, 4, 11] }, portals: [{ geometry: 0, target: 1, passable: true }] },
    { index: 1, name: 'hall', bounds: { min: [0, 0, 0], max: [5, 4, 5] }, portals: [{ geometry: 0, target: 0, passable: true }], floor },
    { index: 2, name: 'bare', bounds: { min: [5, 0, 0], max: [10, 4, 5] }, portals: [], graph: {} },
  ] as unknown as CellDef[];
  const portals: PortalDef[] = [{ v: [[2, 0, 0], [3, 0, 0], [3, 2, 0], [2, 2, 0]], i: [0, 1, 2, 0, 2, 3] } as unknown as PortalDef];
  const m = new THREE.Matrix4().makeTranslation(100, 0, 100);
  const floored = { model: { def: { id: 'floored', cells: cellDefs, portals } }, template: 'floored', matrix: m, inverse: m.clone().invert() } as unknown as Building;
  const hall: CellState = { building: floored, cell: 1 };
  ok(walkGoalFits(hall, 102, 0, 102, 103, 103, 0.35), "indoors a goal on the room's floor with room for the body fits");
  ok(!walkGoalFits(hall, 102, 0, 102, 104.9, 102.5, 0.35), "... one at the room's wall, where the body would stand half in it, does not");
  ok(!walkGoalFits(hall, 102, 0, 102, 107, 102.5, 0.35), '... nor one through the wall in the next room');
  ok(walkGoalFits({ building: floored, cell: 2 }, 107, 0, 102, 108, 103, 0.35), '... and in a room whose floor the pack has not got, anything fits: nothing can say, and the goal is taken as before');

  // A tiered slide indoors, plan after plan: a hall forty metres square with its own floor, the target in its middle, a
  // tier 3 gunner on its ring sliding round it, routed by the game's own floors (`doorwayNav.corner`) and its feet and gun
  // decided by the rule the game runs (`legsFor`). A room's path always ends at its goal, so every slide in here walks a
  // corner the route chose, and the bearing to the target drifts off the lean as the body walks at a corner held between
  // two plans: the gun must stay on the target throughout, its feet within the legs' own ceiling of it.
  {
    const S = 40;
    const bigCells = [
      { index: 0, name: 'r0', bounds: { min: [-1, -1, -1], max: [S + 1, 4, S + 1] }, portals: [{ geometry: 0, target: 1, passable: true }] },
      { index: 1, name: 'hall', bounds: { min: [0, 0, 0], max: [S, 4, S] }, portals: [{ geometry: 0, target: 0, passable: true }], floor: { v: [0, 0, 0, S, 0, 0, S, 0, S, 0, 0, S], t: [0, 1, 2, 0, 2, 3] } },
    ] as unknown as CellDef[];
    const bm = new THREE.Matrix4().makeTranslation(200, 0, 200);
    const big = { model: { def: { id: 'bighall', cells: bigCells, portals } }, template: 'bighall', matrix: bm, inverse: bm.clone().invert() } as unknown as Building;
    const inHall: CellState = { building: big, cell: 1 };
    const spread2 = GROUND_STEP.ringSpread;
    GROUND_STEP.ringSpread = 0;
    const slider = new GroundTactics(1);
    slider.setTier(3, 'humanoid', false);
    const agent = new NavAgent();
    const legs = new DoorLegs();
    const tx = 220;
    const tz = 220;
    const r3 = 20 * GROUND_STEP.standoff;
    let x = tx + r3 * Math.SQRT1_2;
    let z = tz + r3 * Math.SQRT1_2;
    const fits = (gx: number, gz: number): boolean => walkGoalFits(inHall, x, 0, z, gx, gz, 0.35);
    const rolls = dice([0.9, 0]);
    let sliding = 0;
    let routedFrames = 0;
    let drifted = 0;
    let swung = 0;
    let worstOff = 0;
    const dt = 1 / 60;
    for (let f = 0; f < 240; f++) {
      const now = 3 + f * dt;
      const gap = Math.hypot(x - tx, z - tz);
      if (!slider.stepStandoff(now, x, z, tx, tz, gap, 3, true, false, 20, 2.7, rolls, fits)) continue;
      const goal = slider.walkTo;
      const corner = doorwayNav.corner(agent, legs, inHall, x, 0, z, goal.x, 0, goal.z, null, 0.35, now, false);
      const via = corner ?? goal;
      const travel = Math.atan2(via.x - x, via.z - z);
      const aim = Math.atan2(tx - x, tz - z);
      legsFor(travel, aim, slider.leanOnly, slider.slideLean, !!corner);
      if (!slider.leanOnly) continue;
      sliding++;
      if (corner) routedFrames++;
      const off = Math.abs(wrapAngle(travel - aim));
      if (corner && off > slider.slideLean + 1e-6) drifted++;
      if (LEGS.gunOnFeet) swung++;
      worstOff = Math.max(worstOff, Math.abs(wrapAngle(LEGS.head - aim)));
      x += Math.sin(LEGS.head) * 1.8 * dt;
      z += Math.cos(LEGS.head) * 1.8 * dt;
    }
    GROUND_STEP.ringSpread = spread2;
    ok(sliding > 30 && routedFrames > sliding * 0.8, `indoors a slide walks the route's corner (${routedFrames} of ${sliding} sliding frames routed)`);
    ok(drifted > 0, `... and the bearing to the target drifts past the tier's lean between two plans (${drifted} frames, worst ${((worstOff * 180) / Math.PI).toFixed(1)} degrees off against a lean of ${((slider.slideLean * 180) / Math.PI).toFixed(1)})`);
    ok(swung === 0 && worstOff <= GROUND_STEP.legMax, `... and the gun stays on the target throughout, its feet within the legs' own ceiling of it (${swung} frames it swung onto the feet)`);
  }

  // Outdoors: a baked grid, 64 m, with a building's footprint (B, x 20 to 30, z 20 to 40) and a solid block (X, x 40
  // to 52, z 8 to 16), grown by the side only (`rules` 2, the bake the game ships), so a leg keeps a wide body's own
  // width off what is not open (`legInset`).
  const nx = 32;
  const solidMask = new Uint8Array(nx * nx);
  const flags = new Uint8Array(nx * nx);
  for (let j = 0; j < nx; j++) {
    for (let i = 0; i < nx; i++) {
      if (i >= 10 && i < 15 && j >= 10 && j < 20) flags[j * nx + i] = 1;
      if (i >= 20 && i < 26 && j >= 4 && j < 8) solidMask[j * nx + i] = 1;
    }
  }
  const p = packGrid(nx, nx, solidMask, flags, 1, COARSE, undefined, CLEARANCE_MAX) as { nibbles: Uint8Array; coarse: Uint8Array; edges: Uint8Array; clear: Uint8Array; cnx: number; cnz: number };
  const header: OutdoorHeader = { version: NAV_GRID_VERSION, planet: 'drawn', cell: 2, coarse: COARSE, nx, nz: nx, cnx: p.cnx, cnz: p.cnz, x0: 0, z0: 0, fineBytes: p.nibbles.length, coarseBytes: p.coarse.length, edgeBytes: p.edges.length, clearBytes: p.clear.length, clearMax: CLEARANCE_MAX, slopeDegrees: SLOPE_CLIMB_DEGREES, rules: 2 };
  const bytes = new Uint8Array(p.nibbles.length + p.coarse.length + p.edges.length + p.clear.length);
  bytes.set(p.nibbles, 0);
  bytes.set(p.coarse, p.nibbles.length);
  bytes.set(p.edges, p.nibbles.length + p.coarse.length);
  bytes.set(p.clear, p.nibbles.length + p.coarse.length + p.edges.length);
  ok(!!decodeGrid(header, bytes) && outdoorNav.adopt('drawn', header, bytes), 'the drawn world loads as a real grid would');
  ok(walkGoalFits(null, 15, 0, 45, 18, 45, 0.35), 'outdoors a leg along open ground fits');
  ok(!walkGoalFits(null, 25, 0, 30, 25, 35, 0.35), "... one into a building's footprint does not: a place on the ring through its wall is never picked");
  ok(!walkGoalFits(null, 45, 0, 6, 51, 12, 0.35), '... nor one into something solid');
  ok(walkGoalFits(null, 41, 0, 13, 39, 17, 0.35), '... and a body standing on a cell the grid refuses (hard by a wall) needs only an open goal: its route starts from the nearest open cell');
  // The leg, not the goal: open ground to open ground with the footprint or the solid block between them.
  ok(outdoorNav.walkable(17, 30) && outdoorNav.walkable(33, 30) && !walkGoalFits(null, 17, 0, 30, 33, 30, 0.35), 'a place on the ring on open ground beyond a building is refused: the straight leg to it crosses the building, though both ends are open');
  ok(outdoorNav.walkable(38, 12) && outdoorNav.walkable(55, 12) && !walkGoalFits(null, 38, 0, 12, 55, 12, 0.35), '... and one beyond something solid the same');
  // The body's own width: a leg half a metre off the footprint's side, open along its middle. A person keeps the room the
  // bake already keeps (their 0.35 m less its 0.35 m side margin is nothing); a body a metre from middle to rim must keep
  // 0.65 m more, which the footprint's side does not leave.
  ok(walkGoalFits(null, 19.5, 0, 42, 19.5, 18, 0.35) && walkGoalFits(null, 19.5, 0, 42, 19.5, 18, 0), 'a leg half a metre off a building’s side fits a person, and a body with no width');
  ok(!walkGoalFits(null, 19.5, 0, 42, 19.5, 18, 1.0), '... and not a body a metre wide each side, which would brush the wall all the way');
  ok(outdoorNav.standable(30, 50) && !outdoorNav.standable(25, 25) && outdoorNav.standable(39, 10) && !outdoorNav.standable(45, 11), 'a cover spot is somewhere a body could stand: open ground, or beside it; never in a footprint or deep in something solid');
  // Beside it: a cell the bake blocks, at the edge of something solid with open ground next to it, is somewhere a body
  // stands half a metre off a crate's face; and a footprint's own edge cell is never one, open ground beside it or not.
  ok(!outdoorNav.walkable(41, 10) && outdoorNav.standable(41, 10), 'a cover spot on a blocked cell at the edge of something solid, beside open ground, is somewhere a body could stand');
  ok(outdoorNav.walkable(19, 30) && !outdoorNav.standable(20.5, 30), "... and one on a building's own footprint is not, open ground beside it or not");

  // The cover search asks it of a spot before it is picked (`standsOn`), and the refusal is counted.
  const world = Physics.local();
  world.world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
  world.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.375, 1).setTranslation(0, 0.375, 0));
  world.stepOnce();
  const rayC = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  let stands = true;
  const deps: CoverDeps = {
    blockers: (_x: number, _z: number, _r: number, out: Blocker[]) => {
      Object.assign(out[0], { x: 0, z: 0, radius: 1, topY: 0.75 });
      return 1;
    },
    hit: (ax, ay, az, bx2, by, bz2) => {
      const len = Math.hypot(bx2 - ax, by - ay, bz2 - az);
      rayC.origin.x = ax;
      rayC.origin.y = ay;
      rayC.origin.z = az;
      rayC.dir.x = (bx2 - ax) / len;
      rayC.dir.y = (by - ay) / len;
      rayC.dir.z = (bz2 - az) / len;
      const h = world.world.castRay(rayC, len, true);
      return h ? h.timeOfImpact : Infinity;
    },
    floor: () => 0,
    standsOn: () => stands,
  };
  const search = new CoverSearch();
  const ask: CoverAsk = { x: 0, y: 0, z: 7, tx: 0, ty: 0.9, tz: -14, reach: 12, hardCost: 0, indoors: false };
  ok(search.find(deps, ask, 1) !== null, 'the cover search finds a spot where the grid says a body could stand');
  stands = false;
  ok(search.find(deps, ask, 2) === null && search.status().ground > 0, `... and picks none, counting each refusal (${search.status().ground}), where it says no body could stand there`);
}

// ---- the wiring only the game makes, read as text ---------------------------------------------------------------------
{
  const npcs = src('world/npcs.ts');
  const mobile = src('world/mobiles/mobile.ts');
  const manager = src('world/mobiles/manager.ts');
  const world = src('world/world.ts');
  const main = src('main.ts');
  // Step 1.
  ok(npcs.includes('const full = AI_FIX.walls && !!this.cell && acrossShell(this.cell, this.cellOf ? this.cellOf(t) : undefined);') && npcs.includes('return !this.physics.segmentBlocked(LINE_FROM, LINE_TO, !!this.cell, true, full);'), "step 1: a fighter's line of fire tests the shell when its target is on the other side of it");
  ok(mobile.includes('const full = AI_FIX.walls && this.inside && acrossShell(this.navCell, ctx.cellOf ? ctx.cellOf(t) : undefined);') && mobile.includes('this.inside && !full ? INSIDE : OUTSIDE, undefined, this.body, this.deps.physics.stillOrWall'), "... and so does a person's");
  // Step 2.
  ok(/class PlayerTarget implements Living \{[\s\S]*?get halfHeight\(\): number \{\s*return playerMiddle\(this\.capsule\);/.test(world), 'step 2: the player is aimed at the middle of the capsule handed over');
  ok(main.includes('this.world.playerTarget.capsule = this.player;'), '... which is the player itself, handed over once');
  const player = src('player/player.ts');
  ok(player.includes('this.setCrouchCollider((this.crouching || this.prone || this.kneeling) && this.grounded);') && /this\.colliderOffsetY = CAPSULE_RADIUS \+ half;/.test(player), "... whose capsule is the low one crouched, kneeling and prone, and whose `colliderOffsetY` follows it");
  ok(src('net/remotePlayers.ts').includes('v.low = peerLow(r.state);'), "... and a peer's view says low off the state they sent");
  ok(/class PlayerTarget implements Living \{[\s\S]*?readonly shotHeight = PLAYER_SHOT_FROM;/.test(world) && /class PeerBody implements Living \{[\s\S]*?readonly shotHeight = PLAYER_SHOT_FROM;/.test(src('net/remoteBodies.ts')), '... and the player and a peer each say the height their shots come from, which crouching does not lower');
  ok(npcs.includes('ask.ty = t.pos.y + shotHeightOf(t);') && mobile.includes('target.pos.x, target.pos.y + shotHeightOf(target), target.pos.z, d.cover === true, this.inside);') && main.includes('me.x, me.y + shotHeightOf(this.world.playerTarget), me.z, body.tier'), '... which the cover search is asked against, by a fighter, a person and the console alike');
  // Step 3.
  ok(npcs.includes("if (moveTo && pace !== 'stand' && d && (AI_FIX.route || d.state !== 'attack')) {"), 'step 3: a fighter is routed in every state, the attack state included');
  ok(npcs.includes('const routed = via !== moveTo && AI_FIX.route;') && /legsFor\(wantHead, wantFace, this\.leanOnly, this\.slideLean, routed\);\s*wantHead = LEGS\.head;\s*if \(LEGS\.gunOnFeet\) wantFace = wantHead;/.test(npcs), "... its feet and its gun decided by the people's own rule, told whether the route chose the corner");
  ok(/const a = tries\.ask;\s*a\.x = this\.pos\.x;\s*a\.z = this\.pos\.z;\s*a\.tx = t\.pos\.x;\s*a\.tz = t\.pos\.z;\s*a\.vx = vx;\s*a\.vz = vz;\s*a\.ux = ux;\s*a\.uz = uz;\s*a\.slide = side;\s*a\.step = step;\s*a\.lean = this\.split && this\.leanOnly \? this\.slideLean : -1;\s*const ok = tries\.pick\(this\.walkTo, this\.standoffFits\);\s*if \(tries\.fresh\) this\.ledgerRow\.refused\+\+;/.test(npcs), "... its standoff point picked by the people's own try order, its lean laid before the route, and a refusal counted once");
  ok(npcs.includes('private readonly standoffFits = (gx: number, gz: number): boolean => walkGoalFits(this.cell, this.pos.x, this.pos.y, this.pos.z, gx, gz, this.radiusToward());') && npcs.includes('if (Math.random() < 0.4) tries.side = -tries.side;') && npcs.includes('strafeShare(skill, true, gap) * tries.side : 0;'), '... checked on the floor or the grid before it is picked, its way round the one the try order keeps');
  ok(mobile.includes('AI_FIX.route ? this.standoffFits : null') && mobile.includes('private readonly standoffFits = (gx: number, gz: number): boolean => walkGoalFits(this.navCell, this.pos.x, this.pos.y, this.pos.z, gx, gz, this.plan.across);'), "... and so is a person's");
  ok(mobile.includes('this.routedNow = AI_FIX.route && !!corner;') && /legsFor\(travel, aim, tac\.leanOnly, tac\.slideLean, this\.routedNow\);\s*this\.gunOnFeet = LEGS\.gunOnFeet;\s*return LEGS\.head;/.test(mobile), "... a person's feet and gun, too, by the one rule, told whether the route chose the corner");
  ok(npcs.includes('standsOn: (x, z) => !AI_FIX.route || outdoorNav.standable(x, z),') && manager.includes('standsOn: (x, z) => !AI_FIX.route || outdoorNav.standable(x, z),'), '... and a cover spot nowhere a body could stand is never picked, by a fighter or a person');
  // The ledger.
  ok(/noteLanded\(source, this\);/.test(npcs) && /noteLanded\(source, this\);/.test(mobile) && /if \(!this\.dead\) noteLanded\(source, this\);/.test(world), 'a landed blow is measured by the fighters, the people and the player alike');
  ok(main.includes('if (!this.world.playerTarget.dead) noteLanded(source, this.world.playerTarget);'), "... a bolt on the player too, which never reaches the record's own `damage`");
  ok(world.includes('LEDGER_WORLD.physics = physics;') && world.includes('LEDGER_WORLD.cellOf = this.livingCell;'), "... against the world's own physics and rooms");
  ok(npcs.includes('noteShot(this, t, tmp2.x, tmp2.y, tmp2.z);') && mobile.includes('noteShot(this, t, from.x, from.y, from.z);'), '... and every shot a fighter or a person fires is counted from its muzzle');
  // A fight's frames: what each thought found, and each frame put on the row.
  ok(
    npcs.includes('this.noteThought(d);') &&
      npcs.includes('this.ledgerBrush = fighting && wallNear(this.physics, this.pos.x, this.pos.y, this.pos.z, FIGHTER_BODY.radius + LEDGER_TUNE.brush, !!this.cell);') &&
      npcs.includes("this.ledgerWall = fighting && !!t && (d.state === 'attack' || d.state === 'cover') && !seesLine(this.physics, this.cell, this.cellOf ? this.cellOf(t) : undefined, this.pos.x, this.pos.y + this.halfHeight, this.pos.z, t.pos.x, t.pos.y + t.halfHeight, t.pos.z);") &&
      npcs.includes('noteFight(this.ledgerRow, dt, this.ledgerBrush, asked > 1e-4 && this.moved < asked * LEDGER_TUNE.pushShare, this.ledgerWall);'),
    "a fighter's thought finds its fight, a wall at its side and a wall between, and its frame puts them on its row",
  );
  ok(
    mobile.includes('this.ledgerBrush = fighting && wallNear(this.deps.physics, this.pos.x, this.pos.y, this.pos.z, this.plan.across + LEDGER_TUNE.brush, this.inside);') &&
      mobile.includes("this.ledgerWall = fighting && !!ft && (d.state === 'attack' || d.state === 'cover') && !seesLine(this.deps.physics, this.navCell, ctx.cellOf ? ctx.cellOf(ft) : undefined, this.pos.x, this.pos.y + this.halfHeight, this.pos.z, ft.pos.x, ft.pos.y + ft.halfHeight, ft.pos.z);") &&
      mobile.includes('noteFight(this.ledgerRow, dt, this.ledgerBrush, false, this.ledgerWall);') &&
      mobile.includes('stepPush(this.ledgerPush, this.ledgerRow, dt, commanded, this.pos.x, this.pos.z);') &&
      mobile.includes('clearPush(this.ledgerPush);') &&
      mobile.includes('this.noteLedger(dt, moving ? this.speed : 0);'),
    "... and a person's the same, its pushing judged over the window (`stepPush`)",
  );
}

console.log(`\n${checks} checks passed`);
