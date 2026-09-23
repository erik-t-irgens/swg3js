// Ships on the ground: where a hull's foot sits, the floor fitted under it, the pose it comes to rest
// in, the ease onto that pose, and a hold in a frame that moves. Synthetic hulls and floors only; no
// pack is read, and the hull shapes stand in for the kinds the game has rather than naming any.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LANDING, SHIP_GROUND, catchDistance, fitFloor, floorUnder, heldPose, landingFoot, landingLiquid, landingLiquidNote, planeTilt, planeUp, planeY, restPose, settleEase, withFilter, type FloorPlane } from '../../../src/vehicles/landing.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const D = THREE.MathUtils.degToRad;
const plane: FloorPlane = { a: 0, b: 0, c: 0 };
const pos = new THREE.Vector3();
const turn = new THREE.Quaternion();
const v = new THREE.Vector3();

/** Samples of a floor y = a·x + b·z + c, five of them as the game takes them: the foot and four round it. */
function samples(a: number, b: number, c: number, x = 0, z = 0, r = 4): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const [dx, dz] of [[0, 0], [0, r], [0, -r], [r, 0], [-r, 0]] as const) {
    out.push(new THREE.Vector3(x + dx, a * (x + dx) + b * (z + dz) + c, z + dz));
  }
  return out;
}

// --- 1: the foot ----------------------------------------------------------------------------------
{
  const bounds = { min: [-3, -1.23, -6], max: [3, 1.4, 6] };
  // A point a little under the hull (a fighter's) is kept as it is: the ship rests on it.
  const shallow = landingFoot(new THREE.Vector3(0, -1.5, 0.2), bounds, new THREE.Vector3());
  ok(near(shallow.y, -1.5) && near(shallow.z, 0.2), `1: a point 0.27 m under the hull is kept (${shallow.y})`);
  // A point metres under the hull would leave the ship standing on nothing: it is clamped to the gap.
  const deep = landingFoot(new THREE.Vector3(0.5, -16.75, 1), { min: [-8, -14.2, -10], max: [8, 5, 10] }, new THREE.Vector3());
  ok(near(deep.y, -14.2 - LANDING.gap) && near(deep.x, 0.5), `1: a point 2.55 m under the hull is clamped to the gap (${deep.y})`);
  // No point at all: the middle of the underside, with the same gap.
  const none = landingFoot(null, bounds, new THREE.Vector3());
  ok(near(none.y, -1.23 - LANDING.gap) && near(none.x, 0) && near(none.z, 0), `1: a hull with no point rests on its underside (${none.y})`);
  // A box whose corners are stored the other way round (a pack converted before the BOX fix) reads the same.
  const swapped = landingFoot(null, { min: [3, 1.4, 6], max: [-3, -1.23, -6] }, new THREE.Vector3());
  ok(near(swapped.y, -1.23 - LANDING.gap), `1: the underside is the lower corner whichever way the box is stored (${swapped.y})`);
  ok(LANDING.gap <= 0.3, '1: a landed ship stands no more than 0.3 m off the ground');
  // A point over the lowest thing hung under the hull would hold the ship with that part in the ground:
  // the runtime's box is the assembled ship's, re-based so its underside is zero.
  const high = landingFoot(new THREE.Vector3(0, 0.8, 0), { min: [-3, 0, -6], max: [3, 4, 6] }, new THREE.Vector3());
  ok(near(high.y, 0), `1: a point over the hull's underside is brought back down to it (${high.y})`);
  const based = landingFoot(new THREE.Vector3(0, -0.12, 0), { min: [-3, 0, -6], max: [3, 4, 6] }, new THREE.Vector3());
  ok(near(based.y, -0.12), '1: a point just under a re-based hull is kept as it is');
}

// --- 1b: the floor source, the filter and the catch ------------------------------------------------
{
  // Outside, the terrain counts: there is no collider on the open ground until its chunk is in.
  ok(floorUnder(false, -Infinity, 12) === 12, '1b: outside, the terrain is the floor when no ray finds one');
  ok(floorUnder(false, 14, 12) === 14, '1b: outside, a surface over the terrain is the floor');
  // In a room the terrain runs under the building and is never its floor.
  ok(floorUnder(true, 20, 12) === 20, '1b: in a room the floor is the room\'s own ray');
  ok(floorUnder(true, -Infinity, 12) === -Infinity, '1b: in a room with nothing under the hull there is no floor, not the terrain');
  // The filter switch keeps each collider's memberships and writes only what it collides with.
  const packed = (member: number, filter: number) => ((member << 16) | filter) >>> 0;
  const swapped = withFilter(packed(0x0002, 0xffff), 0xfff9);
  ok(swapped === packed(0x0002, 0xfff9), `1b: switching a hull into a room keeps what each collider belongs to (${swapped.toString(16)})`);
  ok(withFilter(withFilter(packed(0x0004, 0xffff), 0xfff9), 0xffff) === packed(0x0004, 0xffff), '1b: and switching back leaves it as it was');
  // The catch: its reach standing still, and further the faster it falls, so no step goes through the floor.
  ok(catchDistance(0) === LANDING.reach && catchDistance(-5) === LANDING.reach, '1b: a hull barely moving is caught at its reach');
  ok(near(catchDistance(60), 60 * LANDING.catchLead), `1b: a fast fall is caught further out (${catchDistance(60)} m)`);
  ok(catchDistance(200) > 200 / 60, '1b: and always further than one step of that fall');
}

// --- 2: the floor fitted to the samples -----------------------------------------------------------
{
  ok(fitFloor(samples(0, 0, 12), plane) && near(plane.a, 0, 1e-9) && near(plane.b, 0, 1e-9) && near(plane.c, 12, 1e-9), '2: flat ground fits flat at its height');
  ok(near(planeTilt(plane), 0), '2: flat ground has no tilt');
  fitFloor(samples(0.2, -0.1, 5), plane);
  ok(near(plane.a, 0.2, 1e-9) && near(plane.b, -0.1, 1e-9) && near(plane.c, 5, 1e-9), '2: a slope is read back exactly');
  ok(near(planeY(plane, 10, 10), 0.2 * 10 - 0.1 * 10 + 5, 1e-9), '2: the floor answers its own height');
  planeUp(plane, v);
  ok(near(v.dot(new THREE.Vector3(1, 0.2, 0).normalize()), 0, 1e-9), '2: the normal stands square to the slope');
  ok(near(planeTilt(plane), Math.acos(1 / Math.hypot(0.2, 1, 0.1)), 1e-9), '2: the tilt is the normal off the upright');
  // One sample, or samples in a line: no slope can be read, so the floor is flat at their mean height.
  ok(fitFloor([new THREE.Vector3(0, 3, 0)], plane) && near(plane.a, 0) && near(plane.c, 3), '2: one sample is a flat floor at its height');
  const line = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 3, 4), new THREE.Vector3(0, 5, 8)];
  ok(fitFloor(line, plane) && near(plane.a, 0) && near(plane.b, 0) && near(plane.c, 3), '2: samples in a line leave no slope to read');
  ok(!fitFloor([], plane), '2: no samples, no floor');
}

// --- 3: the pose a hull comes to rest in ----------------------------------------------------------
{
  const foot = new THREE.Vector3(0, -1.5, 0.2);
  const maxTilt = D(LANDING.tilt);
  // Flat ground: the hull stands upright on its heading with its foot on the floor.
  fitFloor(samples(0, 0, 20), plane);
  let tilt = restPose(plane, foot, 7, -3, D(90), maxTilt, pos, turn);
  ok(tilt === 0 && near(pos.y, 20 + 1.5, 1e-6) && near(pos.x, 7) && near(pos.z, -3), `3: on flat ground the foot rests on the floor (${pos.y})`);
  v.set(0, 0, 1).applyQuaternion(turn);
  ok(near(Math.atan2(v.x, v.z), D(90), 1e-6), '3: the nose keeps the heading it had');
  // A slope inside the limit: the hull leans onto it, and its foot still lands on the floor.
  fitFloor(samples(Math.tan(D(15)), 0, 0), plane);
  tilt = restPose(plane, foot, 4, 4, 0, maxTilt, pos, turn);
  ok(tilt !== null && near(tilt, D(15), 1e-6), `3: a 15° slope tilts the hull 15° (${THREE.MathUtils.radToDeg(tilt ?? 0).toFixed(2)}°)`);
  v.set(0, 1, 0).applyQuaternion(turn);
  planeUp(plane, new THREE.Vector3());
  ok(near(v.dot(planeUp(plane, new THREE.Vector3())), 1, 1e-6), '3: the hull stands square to the slope');
  v.copy(foot).applyQuaternion(turn).add(pos);
  ok(near(v.y, planeY(plane, v.x, v.z), 1e-6), '3: the foot rests on the slope, not through it');
  // Past the limit: refused, unless the caller has nowhere else to put it, where the lean is capped.
  fitFloor(samples(Math.tan(D(35)), 0, 0), plane);
  ok(restPose(plane, foot, 0, 0, 0, maxTilt, pos, turn) === null, '3: a 35° slope is too steep to set down on');
  const capped = restPose(plane, foot, 0, 0, 0, maxTilt, pos, turn, true);
  ok(capped !== null && near(capped, maxTilt, 1e-6), `3: a hull with its engines cut leans no further than the limit (${THREE.MathUtils.radToDeg(capped ?? 0).toFixed(1)}°)`);
}

// --- 4: the settle --------------------------------------------------------------------------------
{
  ok(settleEase(0) === 0 && settleEase(1) === 1, '4: the ease starts and ends where it should');
  ok(near(settleEase(0.5), 0.5) && settleEase(0.25) < 0.25 && settleEase(0.75) > 0.75, '4: it is still at both ends and quickest in the middle');
  ok(settleEase(-3) === 0 && settleEase(4) === 1, '4: it is clamped outside its own span');
  let last = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const k = settleEase(t);
    if (k < last) last = NaN;
    else last = k;
  }
  ok(!Number.isNaN(last), '4: the ease never goes backwards');
}

// --- 5: a hold in a frame that moves --------------------------------------------------------------
{
  const worldPos = new THREE.Vector3();
  const worldTurn = new THREE.Quaternion();
  const at = new THREE.Vector3(2, -1, 5);
  const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, D(30), 0));
  heldPose(null, at, facing, worldPos, worldTurn);
  ok(worldPos.distanceTo(at) < 1e-9 && near(worldTurn.angleTo(facing), 0), '5: with no frame the pose is the world pose');
  // In a frame: the same pose read through a matrix that moves and turns follows it exactly.
  const frame = new THREE.Matrix4().compose(new THREE.Vector3(100, 20, -40), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, D(90), 0)), new THREE.Vector3(1, 1, 1));
  heldPose(frame, at, facing, worldPos, worldTurn);
  const expect = at.clone().applyMatrix4(frame);
  ok(worldPos.distanceTo(expect) < 1e-6, `5: the held hull stands where the frame carries it (${worldPos.toArray().map((n) => n.toFixed(2)).join(', ')})`);
  v.set(0, 0, 1).applyQuaternion(worldTurn);
  ok(near(Math.atan2(v.x, v.z), D(120), 1e-6), '5: its turn is the frame\'s times its own');
  // The frame moves a metre: the held hull moves exactly a metre with it, with nothing left behind.
  const before = worldPos.clone();
  frame.setPosition(101, 20, -40);
  heldPose(frame, at, facing, worldPos, worldTurn);
  ok(near(worldPos.distanceTo(before), 1, 1e-6) && near(worldPos.x - before.x, 1, 1e-6), '5: a frame that moves carries the hull with it exactly');
  // A scaled frame does not stretch the hull, but it still places it where its own matrix says: the
  // turn is taken without the scale, the place through the matrix as it stands.
  frame.compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(2, 2, 2));
  heldPose(frame, at, facing, worldPos, worldTurn);
  ok(near(worldTurn.angleTo(facing), 0, 1e-6), '5: a frame with a scale leaves the hull\'s own turn alone');
  ok(worldPos.distanceTo(at.clone().multiplyScalar(2)) < 1e-6, `5: and puts it where the frame's own matrix does (${worldPos.toArray().join(', ')})`);
}

// --- 6: the switch back to the older ride ---------------------------------------------------------
{
  ok(SHIP_GROUND.rule === 'landing', '6: ships land by default');
  SHIP_GROUND.rule = 'springs';
  ok(SHIP_GROUND.rule === 'springs', '6: the older hover-only ride can be put back live');
  SHIP_GROUND.rule = 'landing';
}

// --- 7: water under the hull -----------------------------------------------------------------------
// The one rule of wave 5's landing package: a ship is refused a put-down over water. Nothing here
// floats a hull; a refused hull goes on hovering, which is what it has always done over the sea.
{
  // The open sea: a bed twenty metres down with the surface over it. Refused, and named.
  ok(landingLiquid(-18, 0, false, false, false) === 'water', '7: the open sea is refused');
  ok(landingLiquidNote(landingLiquid(-18, 0, false, false, false)) === 'the water is no place to set down', '7: and the message line is told which');
  // A lake, whose surface is its own table's height: the same answer, whatever the height is.
  ok(landingLiquid(112.4, 115, false, false, false) === 'water', '7: a lake is refused too');
  // Dry land: the terrain answers -Infinity for a column with no water over it.
  ok(landingLiquid(40, -Infinity, false, false, false) === '', '7: dry land is landable');
  // A table standing under the floor is not water over the hull: the terrain has risen above it.
  ok(landingLiquid(6, 2, false, false, false) === '', '7: a surface below the floor is not in the way');
  // The shallows: a ford under the tune is landable, a hand's breadth more is not.
  ok(landingLiquid(0, LANDING.wet - 0.01, false, false, false) === '', `7: ${LANDING.wet} m of water or less is still landable`);
  ok(landingLiquid(0, LANDING.wet + 0.01, false, false, false) === 'water', '7: a finger deeper and it is refused');
  ok(landingLiquid(0, LANDING.wet, false, false, false) === '', '7: the line itself is landable (the compare is strict)');
  ok(LANDING.wet > LANDING.gap, '7: the line stands above the gap a landed hull keeps, so a hull is never refused where it would rest dry');
  // The flow: the same rule, different words, because a flow is water to the terrain and to nothing else.
  ok(landingLiquid(-3, 1, true, false, false) === 'lava', '7: a lava flow is refused as its own thing');
  ok(landingLiquidNote(landingLiquid(-3, 1, true, false, false)) === 'a lava flow is no place to set down', '7: and is named as one');
  ok(landingLiquidNote('') === '', '7: nothing in the way says nothing at all');
  // No floor under the surface at all: there is the water and nothing measurable to stand on.
  ok(landingLiquid(-Infinity, 0, false, false, false) === 'water', '7: water over no floor at all is refused');
  ok(landingLiquid(-Infinity, -Infinity, false, false, false) === '', '7: and no floor with no water is not this rule\'s business');
  // Engines cut: the hull has nowhere else to go and ditches, exactly as `restPose`'s clamp lets it
  // lean onto a slope it would never choose to land on.
  ok(landingLiquid(-18, 0, false, true, false) === '', '7: a hull with its engines cut ditches rather than being refused');
  ok(landingLiquid(-3, 1, true, true, false) === '', '7: and ditches into a flow as readily');
  // In a building's rooms the planet's water table is not the floor and is not water: 87 placed portal
  // buildings across the converted planets have a room floor under their planet's table, and by height
  // alone every one of them would refuse a landing in a dry hangar.
  ok(landingLiquid(-18, 0, false, false, true) === '', '7: a hull in a building\'s rooms is never refused for the table under the building');
  ok(landingLiquid(-3, 1, true, false, true) === '', '7: nor for a flow under it');
  // The knob: 0 refuses every wet spot, a large number puts the old behaviour back for every hull.
  const wasWet = LANDING.wet;
  LANDING.wet = 0;
  ok(landingLiquid(0, 0.01, false, false, false) === 'water', '7: wet 0 refuses the last inch of a beach');
  LANDING.wet = 1e6;
  ok(landingLiquid(-18, 0, false, false, false) === '', '7: a large wet puts the old set-down-on-the-bed behaviour back');
  LANDING.wet = wasWet;
  ok(landingLiquid(-18, 0, false, false, false) === 'water', '7: and the tune is live, read on every call');
}

console.log(`\n${checks} checks passed`);
