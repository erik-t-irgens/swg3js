// What the relay keeps of the vehicle a player is on (server/vehicleWire.mjs): the fields it passes
// on, the landed flag, the hull a passenger says they are standing in, and everything else dropped.
// Then the browser's own half of the same thing (src/net/aboardMath.ts): the rule that a state
// carries one or the other, the guard over a hull sent by a far end on another build, and the maths
// that put a passenger where the hull they are in has got to. Synthetic messages only; the poses are
// round numbers and the third of them is checked against three's own composition, which is the
// transform a clamped ship and its rider are already placed by.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cleanAboard, cleanRide, cleanVehicle, quat } from '../../../server/vehicleWire.mjs';
import { easeInHull, peerAboard, placeInHull, rideFields } from '../../../src/net/aboardMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const veh = (extra: Record<string, unknown> = {}) => ({ id: 'a_ship', p: [1, 2, 3], q: [0, 0, 0, 1], role: 'ride', ...extra });

// --- 1: what is kept ------------------------------------------------------------------------------
{
  const clean = cleanVehicle(veh());
  ok(!!clean && JSON.stringify(clean) === JSON.stringify({ id: 'a_ship', p: [1, 2, 3], q: [0, 0, 0, 1], role: 'ride' }), `1: the place, the turn and the role are kept (${JSON.stringify(clean)})`);
  ok(cleanVehicle(veh({ pose: 'a_pose', w: 1 }))?.pose === 'a_pose', '1: the riding pose is kept');
  ok(cleanVehicle(veh({ w: 1 }))?.w === 1 && cleanVehicle(veh({ w: 0 }))?.w === 0, '1: the wings are kept, open or closed');
  ok(cleanVehicle(veh({ role: 'pilot' }))?.role === 'pilot' && cleanVehicle(veh({ role: 'aboard' }))?.role === 'aboard', '1: piloting and aboard are kept');
  ok(cleanVehicle(veh({ role: 'captain' }))?.role === 'ride', '1: a role nobody knows is a rider');
}

// --- 2: landed ------------------------------------------------------------------------------------
{
  ok(cleanVehicle(veh({ landed: 1 }))?.landed === 1, '2: a ship set down says so');
  ok(cleanVehicle(veh({ landed: 0 }))?.landed === 0, '2: one that has lifted off says so too');
  ok(cleanVehicle(veh())?.landed === undefined, '2: a client that sends nothing about landing has none kept (an older build)');
  ok(cleanVehicle(veh({ landed: 'yes' }))?.landed === undefined, '2: landing is 0 or 1, never a word');
  ok(cleanVehicle(veh({ landed: 2 }))?.landed === undefined, '2: nor any other number');
}

// --- 3: what is dropped ---------------------------------------------------------------------------
{
  ok(cleanVehicle(null) === undefined && cleanVehicle(undefined) === undefined && cleanVehicle([1, 2]) === undefined, '3: nothing, and a list, are not a vehicle');
  ok(cleanVehicle(veh({ id: 5 })) === undefined && cleanVehicle(veh({ id: '' })) === undefined, '3: a vehicle with no id is dropped');
  ok(cleanVehicle(veh({ id: 'x'.repeat(49) })) === undefined, '3: an over-long id is dropped');
  ok(cleanVehicle(veh({ id: '<script>' })) === undefined, '3: an id that is not a name is dropped');
  ok(cleanVehicle(veh({ p: [1, 2] })) === undefined && cleanVehicle(veh({ p: [1, 2, Number.NaN] })) === undefined, '3: a place that is not three numbers is dropped');
  ok(cleanVehicle(veh({ q: [0, 0, 1] })) === undefined && cleanVehicle(veh({ q: 'flat' })) === undefined, '3: a turn that is not four numbers is dropped');
  const long = cleanVehicle(veh({ pose: 'p'.repeat(80) }));
  ok(long?.pose?.length === 48, '3: an over-long pose is cut to length');
  ok(cleanVehicle(veh({ pose: '' }))?.pose === '', '3: an empty pose is passed on as it is (the vehicle\'s own default)');
  ok(cleanVehicle(veh({ pose: 7 }))?.pose === undefined, '3: a pose that is not words is dropped');
  const junk = cleanVehicle(veh({ dock: { to: 3 }, weapons: 'all' })) as Record<string, unknown>;
  ok(Object.keys(junk).join() === 'id,p,q,role', `3: fields nobody knows are dropped (${Object.keys(junk).join()})`);
}

// --- 4: the turn checker the relay shares ---------------------------------------------------------
{
  ok(JSON.stringify(quat([0, 0, 0, 1])) === JSON.stringify([0, 0, 0, 1]), '4: four numbers are a turn');
  ok(quat([0, 0, 1]) === null && quat('x') === null && quat([0, 0, 0, 'a']) === null, '4: anything else is not');
}

// --- 5: the hull a passenger says they are standing in ---------------------------------------------
{
  const inside = (extra: Record<string, unknown> = {}) => ({ ship: 4, p: [0.5, 1, -2], h: 1.25, ...extra });
  const clean = cleanAboard(inside());
  ok(!!clean && JSON.stringify(clean) === JSON.stringify({ ship: 4, p: [0.5, 1, -2], h: 1.25 }), `5: whose hull, where in it and which way round are kept (${JSON.stringify(clean)})`);
  ok(cleanAboard(inside({ ship: 0 })) === undefined, '5: nobody is not a hull to stand in');
  ok(cleanAboard(inside({ ship: -1 })) === undefined && cleanAboard(inside({ ship: 2.5 })) === undefined, '5: nor is half a player, nor one before the first');
  ok(cleanAboard(inside({ ship: '4' }))?.ship === 4, '5: an id sent as a word is still a number');
  ok(cleanAboard(inside({ p: [1, 2] })) === undefined && cleanAboard(inside({ p: [1, Number.NaN, 3] })) === undefined, '5: a place that is not three numbers is dropped');
  ok(cleanAboard(inside({ p: 'seat' })) === undefined, '5: and a word is not a place at all');
  ok(cleanAboard(inside({ h: Number.POSITIVE_INFINITY }))?.h === 0, '5: a heading that is not a number faces straight ahead rather than dropping the whole message');
  ok(cleanAboard(null) === undefined && cleanAboard([4, 0, 0]) === undefined && cleanAboard(undefined) === undefined, '5: nothing, and a list, are not a hull to stand in');
  const junk = cleanAboard(inside({ role: 'captain', veh: { id: 'a_ship' } })) as Record<string, unknown>;
  ok(Object.keys(junk).join() === 'ship,p,h', `5: fields nobody knows are dropped (${Object.keys(junk).join()})`);
}

// --- 6: one or the other, never both ---------------------------------------------------------------
{
  const aboard = { ship: 4, p: [0, 1, 0], h: 0 };
  ok(JSON.stringify(cleanRide({ veh: veh() })) === JSON.stringify({ veh: { id: 'a_ship', p: [1, 2, 3], q: [0, 0, 0, 1], role: 'ride' } }), '6: a player on a vehicle of their own sends the vehicle');
  const inOnly = cleanRide({ in: aboard });
  ok(!!inOnly.in && inOnly.veh === undefined, '6: a player in somebody else\'s hull sends the hull they are in and no vehicle');
  const both = cleanRide({ veh: veh(), in: aboard });
  ok(!!both.in && both.veh === undefined, '6: a client that sends both is taken at its word about the hull it is in, and its own copy of that hull is dropped');
  const bad = cleanRide({ veh: veh(), in: { ship: 0, p: [0, 0, 0], h: 0 } });
  ok(!!bad.veh && bad.in === undefined, '6: a hull that is nobody\'s leaves the vehicle it was sent with alone');
  ok(JSON.stringify(cleanRide({})) === '{}' && JSON.stringify(cleanRide(null)) === '{}', '6: a state that says nothing about either is on nothing');
  const older = cleanRide({ veh: veh({ landed: 1 }) });
  ok(older.veh?.landed === 1, '6: a browser that knows nothing of standing in a hull is passed on exactly as before');
  // Who is speaking, when the caller knows: nobody stands in their own hull.
  ok(cleanAboard(aboard, 4) === undefined && cleanAboard(aboard, 5)?.ship === 4, '6: a hull that names the player sending it is refused, and anyone else\'s is not');
  const mine = cleanRide({ veh: veh(), in: aboard }, 4);
  ok(!!mine.veh && mine.in === undefined, '6: and the vehicle sent with it stands, so nobody loses their ship by claiming to be in it');
  ok(cleanRide({ in: aboard }, 0).in?.ship === 4, '6: a caller with no id to hand asks nothing about who is speaking');
}

// --- 7: the same rule on the browser's side, over a field it does not trust -----------------------
{
  const said = { ship: 4, p: [0, 1, 2], h: 1.5 };
  const vehicle = { id: 'a_ship' };
  const inOnly = rideFields(said, undefined);
  ok(JSON.stringify(inOnly.in) === JSON.stringify(said) && inOnly.veh === undefined, '7: a peer in somebody else\'s hull is read as being in it');
  const both = rideFields(said, vehicle);
  ok(!!both.in && both.veh === undefined, '7: and a state carrying both is read as the hull, never as two hulls');
  ok(rideFields(undefined, vehicle).veh === vehicle && rideFields(undefined, vehicle).in === undefined, '7: a peer on a vehicle of their own is read as being on it');
  ok(Object.keys(rideFields(undefined, undefined)).length === 0, '7: and a peer on neither carries neither field');
  ok(rideFields(true, vehicle).veh === vehicle && rideFields({ ship: 4 }, vehicle).veh === vehicle, '7: a hull that is not one leaves the vehicle sent with it alone rather than throwing');
  ok(peerAboard({ ship: 4, p: [0, 1] }) === undefined && peerAboard({ ship: 4, p: 'seat', h: 0 }) === undefined, '7: a place that is not three numbers is not a place in a hull');
  ok(peerAboard({ ship: 4, p: [0, Number.NaN, 2], h: 0 }) === undefined && peerAboard({ ship: 0, p: [0, 0, 0], h: 0 }) === undefined, '7: nor is a place that is not numbers, and nobody is not a hull');
  ok(peerAboard({ ship: 4, p: [0, 1, 2], h: 'round' })?.h === 0, '7: a heading that is not a number faces straight ahead rather than losing where they stand');
  const kept = peerAboard({ ship: 4, p: [0, 1, 2], h: 1.5, role: 'captain' }) as Record<string, unknown>;
  ok(Object.keys(kept).join() === 'ship,p,h', `7: and nothing else is carried in (${Object.keys(kept).join()})`);
}

// --- 8: where a passenger is put, and how they get there -------------------------------------------
{
  const out = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const hullPos = new THREE.Vector3();
  const hullQ = new THREE.Quaternion();
  // A hull standing still at the origin, facing down its own nose: they stand where they say.
  placeInHull(hullPos, hullQ, { x: 0.5, y: 1, z: -2 }, 0, out, turn);
  ok(out.distanceTo(new THREE.Vector3(0.5, 1, -2)) < 1e-9 && turn.angleTo(new THREE.Quaternion()) < 1e-9, '8: in a hull that is where the world is, a passenger stands where they say they do');
  // A quarter turn to the left, ten metres out: two metres up the cabin is two metres to the west.
  hullPos.set(10, 0, 0);
  hullQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  placeInHull(hullPos, hullQ, { x: 0, y: 0, z: -2 }, 0, out, turn);
  ok(out.distanceTo(new THREE.Vector3(8, 0, 0)) < 1e-6, `8: a hull turned a quarter to the left carries the cabin round with it (${out.toArray().map((n) => n.toFixed(2)).join()})`);
  // Banked, pitched and yawed at once, against three's own composition -- the transform a clamped
  // ship and its rider are already placed by, and the one the game places its own figure with.
  const local = new THREE.Vector3(0.75, -1.25, 3.5);
  for (const [e, t] of [[[0.4, 1.1, -0.7], 0.9], [[-1.3, 2.6, 0.2], -2.8], [[0, 0, Math.PI / 2], 0.25]] as [number[], number][]) {
    hullPos.set(-4.5, 12.25, 7);
    hullQ.setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
    placeInHull(hullPos, hullQ, local, t, out, turn);
    const wantPos = local.clone().applyQuaternion(hullQ).add(hullPos);
    const wantQ = hullQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t));
    ok(out.distanceTo(wantPos) < 1e-6 && turn.angleTo(wantQ) < 1e-6, `8: a banked hull puts them exactly where it puts anything of its own (${out.distanceTo(wantPos).toExponential(1)} m out)`);
  }
  // The glide, in the hull's own frame.
  const at = { x: 0, y: 0, z: 0 };
  const target = { x: 0, y: 0, z: 4 };
  ok(easeInHull(at, target, 0.5, 0.5, 0, 0.1) === 0.5 && at.z === 0, '8: no time passing moves nobody');
  const slow = { x: 0, y: 0, z: 0 };
  easeInHull(at, target, 0, 0, 1 / 60, 0.1);
  easeInHull(slow, target, 0, 0, 1 / 60, 0.4);
  ok(at.z > slow.z && slow.z > 0, `8: a longer glide is a slower one (${at.z.toFixed(3)} m against ${slow.z.toFixed(3)} m)`);
  const instant = { x: 0, y: 0, z: 0 };
  easeInHull(instant, target, 0, 0, 1 / 60, 0);
  ok(Number.isFinite(instant.z) && Math.abs(instant.z - 4) < 1e-6, '8: a glide of no time at all is arriving, not dividing by nothing');
  for (let i = 0; i < 120; i++) easeInHull(at, target, 0, 0, 1 / 60, 0.1);
  ok(Math.abs(at.z - 4) < 1e-3, `8: and any glide arrives (${at.z.toFixed(4)} m of 4)`);
  // Facing across the half turn: the short way round, not the long way back through the cabin.
  const crossed = easeInHull({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 3.0, -3.0, 1 / 60, 0.1);
  ok(crossed > 3.0 && crossed < 3.3, `8: turning past the half turn goes the short way round (${crossed.toFixed(3)})`);
  const back = easeInHull({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, -3.0, 3.0, 1 / 60, 0.1);
  ok(back < -3.0 && back > -3.3, `8: and so does turning back across it (${back.toFixed(3)})`);
}

console.log(`\n${checks} checks passed`);
