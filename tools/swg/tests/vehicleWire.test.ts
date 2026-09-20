// What the relay keeps of the vehicle a player is on (server/vehicleWire.mjs): the fields it passes
// on, the landed flag this wave adds, and everything else dropped. Synthetic messages only.
import assert from 'node:assert/strict';
import { cleanVehicle, quat } from '../../../server/vehicleWire.mjs';

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

console.log(`\n${checks} checks passed`);
