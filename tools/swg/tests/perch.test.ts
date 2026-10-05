// People stood on something raised (src/world/mobiles/perch.ts): an Ewok on its tree village, a Gondula
// on a lake hut, a sniper on a bridge. The rules on their own, then the streamer's answer to "is anything
// that could be under this point still to come" (`floorAt` in placedTiers.ts) over regions of fakes, then
// the same rules over a real physics world -- a body held in the air at its row's height, the probe that
// cannot see a collider until the world has stepped once, the landing, the safety net -- and last the
// game's own wiring, read off the files that cannot be loaded here.
//
// The fault it pins: outdoors the people were handed no height, and the manager's own lookup outdoors
// is the terrain alone, so everybody the data put on something stood on the ground under it. And the
// ways a perch could still drop somebody through a floor that was on its way: a wait that ran out behind
// a loading screen, a streamer that called a point built because a tier was out of the player's reach,
// a floor whose collision went while somebody stood on it. Every number checked is ours; nothing is read
// from the game.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Group, Physics, RAPIER, groups } from '../../../src/core/physics.ts';
import { holdAir } from '../../../src/world/mobiles/airless.ts';
import {
  isPerched,
  keepsSpot,
  landTop,
  newPerchState,
  PERCH_TUNE,
  perchesAgain,
  perchNear,
  perchSpawn,
  perchStep,
  perchSurface,
  perchTimedOut,
  resetPerchState,
  standHeight,
  tunePerch,
  type PerchTune,
} from '../../../src/world/mobiles/perch.ts';
import { floorAt, footprintOf, REGION, regionIndex, tiltSin, type FloorAsk, type FloorObject, type FloorRegion } from '../../../src/world/placedTiers.ts';

let passed = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const T: PerchTune = { ...PERCH_TUNE };

// ---------------------------------------------------------------------------------------------
// Who is perched, and where a body handed a height out of doors is stood.
{
  ok(!isPerched(10.1, 10, false, false, false, T), 'a tenth of a metre over the terrain is standing on it, not perched');
  ok(isPerched(15, 10, false, false, false, T), 'five metres over it is perched');
  ok(standHeight(4, 10) === 10 && !isPerched(standHeight(4, 10), 10, false, false, false, T), 'a row under the terrain is stood on the terrain, and is not perched');
  ok(standHeight(31, 10) === 31, 'a row over it keeps its own height');
  ok(!isPerched(15, 10, true, false, false, T), 'indoors is never perched: a room\'s floor is found and held another way');
  ok(!isPerched(15, 10, false, true, false, T), 'a flyer is never perched: it hovers');
  ok(!isPerched(15, 10, false, false, true, T), 'a swimmer is never perched: it floats');

  const dry = -Infinity;
  const raised = perchSpawn(31, 10, dry, T);
  ok(raised.y === 31 && raised.perch, 'a row 21 m over the ground is stood at its own height and perched there');
  const under = perchSpawn(4, 10, dry, T);
  ok(under.y === 10 && !under.perch, 'a row under the ground is stood on it and is not perched');
  ok(!perchSpawn(10.1, 10, dry, T).perch, 'a row a step over the ground is stood on the ground');
  const wet = perchSpawn(12, 10, 13, T);
  ok(wet.y === 12 && !wet.perch, 'a row under the water\'s surface is a swimmer and floats rather than perching');
  const unknown = perchSpawn(31, null, dry, T);
  ok(unknown.y === 31 && unknown.perch, 'with the ground unknown (far off, nothing held there, never made on the spot) the row\'s height is kept and the body is held, to be decided once it is near');
  ok(!perchSpawn(12, null, 13, T).perch, 'but one under the water there still floats');

  ok(perchesAgain(15, 10, T) && !perchesAgain(10.1, 10, T), 'a body well over the ground is perched again where it stands, one a step over it is not');
  ok(!perchesAgain(15, null, T), 'and over ground nobody holds, nothing is done on a guess');
}

// ---------------------------------------------------------------------------------------------
// What the probe's hit is taken for, the landing, and the spot kept.
{
  ok(perchSurface(null, 10, T) === null, 'nothing found is nothing');
  ok(perchSurface(8, 10, T) === null, 'a surface two metres under the terrain is something buried, not what it stands on');
  ok(perchSurface(9.8, 10, T) === 9.8, 'one within `lift` under it is a floor sunk a little, and stood on');
  ok(perchSurface(31, 10, T) === 31, 'one over it is stood on');
  ok(perchSurface(8, null, T) === 8, 'and with the ground unknown the hit is kept');

  ok(keepsSpot('near', 11, 10, T), 'a person stepping about its spot who lands a metre over the terrain keeps to it');
  ok(!keepsSpot('near', 10.1, 10, T), 'one landing on a step a tenth of a metre up does not');
  ok(!keepsSpot('still', 11, 10, T) && !keepsSpot(null, 11, 10, T), 'nor does a body whose post is not `near`');
  ok(!keepsSpot('near', 11, null, T), 'nor one over ground nobody knows');
  ok(!keepsSpot('near', 11, 10, { ...T, stillOnTop: false }), 'and none with the switch off');

  ok(near(landTop(10, 0.85), 10.9, 1e-9), "set down, the body's middle is its feet over the surface and a hair, as `liftToGround` sets one down");
}

// ---------------------------------------------------------------------------------------------
// What becomes of a perched body, frame by frame.
{
  const dt = 1 / 60;
  const s = newPerchState();
  ok(perchStep(s, 10, true, 'coming', dt, T) === 'land', 'a surface found under its feet sets it down at once');
  ok(perchStep(newPerchState(), 10, false, 'coming', dt, T) === 'land', 'wherever it is, near the player or not');

  const far = newPerchState();
  let farFell = false;
  for (let i = 0; i < 60 * T.wait * 4; i++) if (perchStep(far, null, false, 'built', dt, T) !== 'hold') farFell = true;
  ok(!farFell && far.waited === 0, `beyond ${T.countWithin} m neither the wait nor the release ever lets go, however long`);
  ok(!perchNear(T.countWithin + 1, 0, T) && perchNear(T.countWithin - 1, 0, T) && perchNear(100, 100, T), 'and near is a distance on the ground from the player, within countWithin');

  ok(perchStep(newPerchState(), null, true, 'built', dt, T) === 'fall', 'near the player, nothing under it and nothing coming: let down at once');
  const wait = newPerchState();
  let frames = 0;
  let what: string = 'hold';
  while (what === 'hold' && frames < 60 * T.wait * 2) {
    what = perchStep(wait, null, true, 'coming', dt, T);
    frames++;
  }
  ok(what === 'fall' && near(frames * dt, T.wait, 2 * dt), `near the player with its floor still coming it waits ${T.wait} s and no longer (${(frames * dt).toFixed(2)} s)`);
  ok(perchTimedOut(wait, T) && !perchTimedOut(newPerchState(), T), 'and the fall says it was the wait that ran out');
  resetPerchState(wait);
  ok(wait.waited === 0 && wait.built === 'coming' && wait.asked === Infinity, 'a perch begun again starts its clock afresh, and asks the streamer on its first near frame');

  // The streamer says the player is too far off for it to want what is under the body: nothing to wait for
  // and nothing to give up on. At the menu's least object reach a small object's tier loads only within
  // 128 m, under the perch's own 150.
  const unwanted = newPerchState();
  let unwantedFell = false;
  for (let i = 0; i < 60 * T.wait * 4; i++) if (perchStep(unwanted, null, true, 'far', dt, T) !== 'hold') unwantedFell = true;
  ok(!unwantedFell && unwanted.waited === 0, 'near the player but over something the streamer will not make solid yet, it is held with no clock running');

  // Behind a loading screen the tiers take as long as they take: a slow arrival must not give up on the
  // floor of everybody perched near it before it has loaded.
  const screen = newPerchState();
  let screenFell = false;
  for (let i = 0; i < 60 * T.wait * 3; i++) if (perchStep(screen, null, true, 'coming', dt, T, true) !== 'hold') screenFell = true;
  ok(!screenFell && screen.waited === 0, `behind a loading screen for ${T.wait * 3} s with its floor still coming, it is still held and its clock has not moved`);
  ok(perchStep(screen, null, true, 'built', dt, T, true) === 'fall', 'though one the streamer says nothing is coming under is let down even then');
  let after = 0;
  let afterWhat: string = 'hold';
  while (afterWhat === 'hold' && after < 60 * T.wait * 2) {
    afterWhat = perchStep(screen, null, true, 'coming', dt, T, false);
    after++;
  }
  ok(afterWhat === 'fall' && near(after * dt, T.wait, 2 * dt), 'and once the screen lifts the safety net counts from nought');
}

// ---------------------------------------------------------------------------------------------
// The knob keeps its numbers to a sense they can have.
{
  const was = { ...PERCH_TUNE };
  tunePerch({ wait: -3, down: 0, lift: Number.NaN, stillOnTop: false });
  ok(PERCH_TUNE.wait === 0 && PERCH_TUNE.down === 0.05 && PERCH_TUNE.lift === was.lift && PERCH_TUNE.stillOnTop === false, 'the console\'s knob floors what it is given and ignores what is not a number');
  Object.assign(PERCH_TUNE, was);
}

// ---------------------------------------------------------------------------------------------
// The streamer's answer (`floorAt`): asked of the objects whose footprints hold the point, over fakes laid
// out as the streamer files them -- each in the region its origin falls in, by tier.
{
  ok(near(footprintOf({ min: [-3, 0, -1], max: [1, 4, 2] }, 0), Math.hypot(3, 2), 1e-12), "a footprint turned about the vertical alone is the box's farthest corner on the ground");
  ok(near(footprintOf({ min: [-3, 0, -1], max: [1, 4, 2] }), Math.hypot(3, 4, 2), 1e-12), 'and for any turn at all, never more than the corner\'s whole distance');
  ok(footprintOf({ min: [1, 4, 2], max: [-3, 0, -1] }, 0.3) === footprintOf({ min: [-3, 0, -1], max: [1, 4, 2] }, 0.3), 'its corners taken componentwise, whichever is called min');
  ok(footprintOf(null) === 0 && footprintOf({ min: [0, 0], max: [1, 1] }) === 0, 'and with no usable box it is nothing, under nothing');
  // A model hung 2.2 km in the sky over a town (one of Tatooine's is a distant ship's controller) reached
  // over the whole town while its height was counted whatever its turn.
  const sky = { min: [-192, 2199.5, -0.5], max: [301, 2200.5, 0.5] };
  ok(footprintOf(sky, tiltSin(0, 0)) < 302 && footprintOf(sky, 1) > 2000, `a thing hung high and turned about the vertical reaches ${footprintOf(sky, 0).toFixed(0)} m over the ground, not its ${footprintOf(sky, 1).toFixed(0)} m height`);
  // The bound, tried: every corner of a random box, turned by a random quaternion, lands within the footprint on the ground.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  let worstOver = -Infinity;
  for (let k = 0; k < 4000; k++) {
    // Half of them tipped only a little, as placed rocks are; the rest any way at all.
    const tip = k % 2 === 0 ? 0.15 : 1;
    let qx = rnd() * tip;
    let qy = rnd();
    let qz = rnd() * tip;
    let qw = rnd();
    const l = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= l;
    qy /= l;
    qz /= l;
    qw /= l;
    const box = { min: [rnd() * 20, rnd() * 40, rnd() * 20], max: [rnd() * 20, rnd() * 40, rnd() * 20] };
    const f = footprintOf(box, tiltSin(qx, qz));
    for (let c = 0; c < 8; c++) {
      const vx = c & 1 ? box.max[0] : box.min[0];
      const vy = c & 2 ? box.max[1] : box.min[1];
      const vz = c & 4 ? box.max[2] : box.min[2];
      // v' = q v q*, written out.
      const ix = qw * vx + qy * vz - qz * vy;
      const iy = qw * vy + qz * vx - qx * vz;
      const iz = qw * vz + qx * vy - qy * vx;
      const iw = -qx * vx - qy * vy - qz * vz;
      const rx = ix * qw + iw * -qx + iy * -qz - iz * -qy;
      const rz = iz * qw + iw * -qz + ix * -qy - iy * -qx;
      worstOver = Math.max(worstOver, Math.hypot(rx, rz) - f);
    }
  }
  ok(worstOver <= 1e-9, `over 4,000 random boxes and turns no corner lands on the ground beyond the footprint (closest ${(-worstOver).toFixed(4)} m inside it at the worst)`);

  interface Thing extends FloorObject {
    name: string;
    collides: boolean;
    solid: boolean;
    wanted: boolean;
  }
  interface Area extends FloorRegion<Thing> {
    reach: number;
    objects: Thing[][];
  }
  const thing = (name: string, x: number, z: number, footprint: number, over: Partial<Thing> = {}): Thing => ({ name, x, z, footprint, contained: false, collides: true, solid: false, wanted: true, ...over });
  const world = (things: Thing[], stepped = true) => {
    const regions = new Map<string, Area>();
    let widest = 0;
    for (const o of things) {
      const rx = regionIndex(o.x);
      const rz = regionIndex(o.z);
      const key = `${rx},${rz}`;
      let r = regions.get(key);
      if (!r) {
        r = { cx: (rx + 0.5) * REGION, cz: (rz + 0.5) * REGION, reach: 0, objects: [[], [], []] };
        regions.set(key, r);
      }
      r.objects[2].push(o);
      if (!o.contained) {
        r.reach = Math.max(r.reach, o.footprint);
        widest = Math.max(widest, o.footprint);
      }
    }
    const asked: string[] = [];
    const ask: FloorAsk<Thing, Area> = {
      region: (rx, rz) => regions.get(`${rx},${rz}`),
      collides: (o) => o.collides,
      solid: (o) => o.solid,
      stepped: () => stepped,
      wanted: (_r, o) => {
        asked.push(o.name);
        return o.wanted;
      },
    };
    return { at: (x: number, z: number) => floorAt(x, z, widest, ask), asked };
  };

  const hut = (over: Partial<Thing> = {}) => thing('hut', 100, 100, 6, over);
  ok(world([]).at(100, 100) === 'built', 'over open ground with nothing filed anywhere near, nothing is coming');
  ok(world([hut({ solid: true })]).at(102, 101) === 'built', 'over a hut whose collision is in and stepped, nothing is coming (the probe found the truth)');
  ok(world([hut({ solid: true })], false).at(102, 101) === 'coming', 'but not before the world has stepped since it was made, since a query cannot see it yet');
  ok(world([hut()]).at(102, 101) === 'coming', 'over a hut the streamer wants and has not made solid yet, it is coming');
  ok(world([hut({ wanted: false })]).at(102, 101) === 'far', 'over a hut the player stands too far off for the streamer to want, it is far');
  ok(world([hut({ wanted: false }), thing('bridge', 103, 100, 8)]).at(102, 101) === 'coming', 'one still coming answers before one that is far');
  ok(world([hut()]).at(120, 100) === 'built', 'a point outside the hut\'s footprint is not held up by it');
  ok(world([hut({ contained: true })]).at(102, 101) === 'built', 'a thing standing in a building\'s rooms is never under somebody out of doors');
  ok(world([hut({ footprint: 0 })]).at(100, 100) === 'built', 'a thing with no box (a particle effect) is under nothing');
  ok(world([hut({ collides: false })]).at(102, 101) === 'built', 'a thing the sweep never makes solid is nothing to wait for');

  // Reaching over a region's edge: the platform's origin is in the next region along, and its footprint still holds the point.
  const edge = REGION * 2;
  ok(world([thing('platform', edge + 3, 50, 10)]).at(edge - 4, 50) === 'coming', 'a platform whose origin is in the next region still holds up a point its footprint reaches');
  // The fault the region rule had: a tier unloaded in a region the body is not standing in held it up for
  // the whole wait. Asked of objects, only what could be under the point is asked about at all.
  const w = world([hut({ solid: true }), thing('far side', 100 + REGION - 20, 100, 4, { wanted: false })]);
  ok(w.at(102, 101) === 'built' && !w.asked.includes('far side'), 'something unloaded in a region the body is not standing over is never asked about');
  // And the other way round: a platform whose tier the player is too far off to load is not "built".
  ok(world([hut({ wanted: false })]).at(100, 100) !== 'built', 'a platform out of the player\'s load range is never taken for open ground, so nobody is let down through it');

  // The whole story at the menu's least object reach, as the manager runs it: held while the hut is far,
  // its clock still; held while it comes; set down on it once it is solid and the probe finds it.
  const dt = 1 / 60;
  const s = newPerchState();
  const h = hut({ wanted: false });
  const story = world([h]);
  let held = true;
  for (let i = 0; i < 60 * T.wait * 2; i++) if (perchStep(s, null, true, story.at(102, 101), dt, T) !== 'hold') held = false;
  ok(held && s.waited === 0, 'perched over a hut the player is too far off to load: held, no clock');
  h.wanted = true;
  for (let i = 0; i < 30; i++) if (perchStep(s, null, true, story.at(102, 101), dt, T) !== 'hold') held = false;
  ok(held && s.waited > 0, 'the player comes nearer and it is on its way: still held, the safety net counting');
  h.solid = true;
  ok(perchStep(s, 31, true, story.at(102, 101), dt, T) === 'land', 'and once it is solid the probe finds it and the body lands');
}

// ---------------------------------------------------------------------------------------------
// The same rules over a real physics world, as the manager runs them.
{
  const physics = await Physics.create();
  const w = physics.world;
  /** What the perch's probe looks for: everything but the terrain (`PERCH_FILTER` in manager.ts). */
  const filter = groups(Group.all, Group.all & ~Group.terrain);
  /** The manager's own floor predicate: only what stands still. */
  const staticOnly = (c: RAPIER.Collider): boolean => {
    const body = c.parent();
    return !body || body.isFixed();
  };
  // A platform whose top is at 10, as a building's shell is filed (`exterior`), and the terrain's ground at 0.
  w.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.5, 4).setTranslation(0, 9.5, 0).setCollisionGroups(groups(Group.exterior, Group.all)));
  w.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setCollisionGroups(groups(Group.terrain, Group.all)));
  // A body like a person's: a capsule whose feet are `feet` under its middle, dynamic, its turning locked.
  const radius = 0.35;
  const half = 0.5;
  const feet = half + radius;
  const person = (x: number, footY: number) => {
    const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, landTop(footY, feet), 0).lockRotations());
    w.createCollider(RAPIER.ColliderDesc.capsule(half, radius), body);
    // Perched from the first step, as the body's constructor holds it.
    holdAir(body);
    return body;
  };
  const footOf = (b: RAPIER.RigidBody) => b.translation().y - feet;
  const probe = (b: RAPIER.RigidBody) => {
    const p = b.translation();
    return physics.topSurface(p.x, p.z, footOf(b) + T.up, T.up + T.down, filter, staticOnly);
  };
  /** `Mobile.perchLand`'s set-down, through the same `landTop`, and its gravity given back. */
  const land = (b: RAPIER.RigidBody, top: number) => {
    const p = b.translation();
    b.setTranslation({ x: p.x, y: landTop(top, feet), z: p.z }, true);
    const v = b.linvel();
    b.setLinvel({ x: v.x, y: 0, z: v.z }, true);
    b.setGravityScale(1, true);
  };

  // On the platform.
  const onTop = person(0, 10);
  const s = newPerchState();
  ok(probe(onTop) === null, 'before the world has stepped the probe sees nothing, not even the platform under its feet');
  ok(perchStep(s, probe(onTop), true, 'coming', 1 / 60, T) === 'hold', 'so the body is held where it was put, rather than let down through a platform the world cannot see yet');
  physics.stepOnce();
  holdAir(onTop);
  const top = perchSurface(probe(onTop), 0, T);
  ok(top !== null && near(top, 10, 1e-3), `after one step the probe finds the platform's top (${top?.toFixed(3)})`);
  ok(perchStep(s, top, true, 'coming', 1 / 60, T) === 'land', 'and the body lands on it');
  land(onTop, top!);
  for (let i = 0; i < 120; i++) physics.stepOnce();
  ok(near(footOf(onTop), 10, 0.1), `two seconds later its feet are on the platform (${footOf(onTop).toFixed(3)} m)`);

  // A little over the terrain with no platform: the probe's window reaches the ground, and must not land on it.
  const low = person(8, 1);
  physics.stepOnce();
  holdAir(low);
  ok(probe(low) === null, 'the probe never finds the terrain, so a ground under the window cannot land a body that should be waiting for its floor');

  // Over nothing, with its floor still coming: held for the wait, then let down onto the ground.
  const over = person(20, 10);
  const so = newPerchState();
  let what: string = 'hold';
  let held = 0;
  let lowest = Infinity;
  while (what === 'hold' && held < 60 * T.wait * 2) {
    holdAir(over);
    what = perchStep(so, probe(over), true, 'coming', 1 / 60, T);
    physics.stepOnce();
    lowest = Math.min(lowest, footOf(over));
    held++;
  }
  ok(what === 'fall' && near(held / 60, T.wait, 2 / 60), `over nothing it is held for the wait (${(held / 60).toFixed(2)} s) and then let down`);
  ok(near(lowest, 10, 0.05), `and while it was held it did not sink (its feet at ${lowest.toFixed(3)} m at the lowest)`);
  // Held that long it has gone to sleep, and the wake a gravity write carries lasts one step: let go
  // with only that, it is asleep again after it and hangs where it was. `Mobile.endPerch` wakes it outright.
  ok(over.isSleeping(), 'held still for the wait, the body has gone to sleep');
  const sleeper = person(30, 10);
  for (let i = 0; i < 240; i++) {
    holdAir(sleeper);
    physics.stepOnce();
  }
  sleeper.setGravityScale(1, true);
  for (let i = 0; i < 60; i++) physics.stepOnce();
  ok(near(footOf(sleeper), 10, 0.06), `let go with its gravity alone it hangs in the air (${footOf(sleeper).toFixed(3)} m), which is why the perch's end wakes it`);
  over.wakeUp();
  over.setGravityScale(1, true);
  for (let i = 0; i < 240; i++) physics.stepOnce();
  ok(near(footOf(over), 0, 0.1), `woken and let go, it falls to the ground at 0 (${footOf(over).toFixed(3)} m)`);

  // Landed, then its floor's collision is taken away while the world goes on (the sweep dropping it as the
  // player walks off, its tier unloading at a short reach). Two hut floors of their own, a body landed on each.
  const hutFloor = (x: number) => w.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 0.5, 1.5).setTranslation(x, 9.5, 0).setCollisionGroups(groups(Group.exterior, Group.all)));
  const floorA = hutFloor(50);
  const floorB = hutFloor(60);
  const onA = person(50, 10);
  const onB = person(60, 10);
  physics.stepOnce();
  land(onA, perchSurface(probe(onA), 0, T)!);
  land(onB, perchSurface(probe(onB), 0, T)!);
  for (let i = 0; i < 30; i++) physics.stepOnce();
  ok(near(footOf(onA), 10, 0.1) && near(footOf(onB), 10, 0.1), 'two bodies landed on two hut floors of their own');
  w.removeCollider(floorA, true);
  w.removeCollider(floorB, true);
  // B is what the manager does when told (`perchOver`): perched again where it stands, since it is well over the ground.
  ok(perchesAgain(footOf(onB), 0, T), 'a body on a floor whose collision has gone stands far enough over the ground to be perched again');
  for (let i = 0; i < 60; i++) {
    holdAir(onB);
    physics.stepOnce();
  }
  ok(footOf(onA) < 9, `left alone, the body whose floor went falls through where it stood (its feet at ${footOf(onA).toFixed(2)} m), which is the fault`);
  ok(near(footOf(onB), 10, 0.06), `perched again, it stays where it stood (${footOf(onB).toFixed(3)} m)`);
  hutFloor(60);
  holdAir(onB);
  ok(probe(onB) === null, 'its floor made again is not seen before the world has stepped');
  physics.stepOnce();
  const back = perchSurface(probe(onB), 0, T);
  ok(back !== null && near(back, 10, 1e-3) && perchStep(newPerchState(), back, false, 'far', 1 / 60, T) === 'land', 'and once it has, the probe finds it and the body lands on it again, near the player or not');
}

// ---------------------------------------------------------------------------------------------
// The game's wiring, read off the files node cannot load (manager.ts and mobile.ts import without
// extensions; world.ts and layoutStream.ts carry parameter properties).
{
  const src = (f: string) => readFileSync(new URL(`../../../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const people = src('world/standingPeople.ts');
  ok(/const spot = \{ x: st\.x, z: st\.z, y: st\.y, heading: r\.heading \};/.test(people), 'the standing people hand their row\'s height over, outdoors as well as in');

  const manager = src('world/mobiles/manager.ts');
  ok(/const PERCH_FILTER = groups\(Group\.all, Group\.all & ~Group\.terrain\);/.test(manager), 'the manager\'s probe leaves the terrain out');
  ok(
    /const placed = perchSpawn\(y, groundUnder\(at\.x, at\.z, this\.deps\.terrain, this\.deps\), this\.deps\.terrain\.waterHeightAt\(at\.x, at\.z\)\);\s*y = placed\.y;\s*perch = placed\.perch;/.test(manager),
    'a height handed over outdoors is decided by `perchSpawn`, over ground read where the world holds it and never made on the spot',
  );
  // The hand-off from that decision to the body: the spawn's own literal carries it, and nothing between
  // the decision and the literal changes it.
  const decided = manager.indexOf('perch = placed.perch;');
  const literalAt = manager.indexOf('const spawn: MobileSpawn = {', decided);
  const literal = /const spawn: MobileSpawn = \{([\s\S]*?)\n {4}\};/.exec(manager.slice(literalAt))?.[1] ?? '';
  ok(decided > 0 && literalAt > decided && /\n\s*perch,\n/.test(literal), 'and the spawn the body is made from carries that decision');
  ok(!/\bperch\s*=/.test(manager.slice(decided + 'perch = placed.perch;'.length, literalAt)), 'with nothing between the decision and the spawn changing it');
  ok(/const m = new Mobile\(spawn, \{/.test(manager.slice(literalAt)), 'and that spawn is the one the body is made from');

  const loop = /if \(m\.perched\) this\.stepPerch\(m, ctx, dt\);[\s\S]*?m\.setAirless\(m\.perched \|\| \(held\.cell !== null && !\(this\.deps\.cellSolid\?\.\(held\.cell\) \?\? true\)\)\);/.test(manager);
  ok(loop, 'every frame the perch is stepped, then written into the airless hold the room\'s floor already uses');
  ok(/this\.perchPaused = this\.deps\.waiting\?\.\(\) \?\? false;/.test(manager), 'and whether the world is behind a loading screen is read once a frame');
  const step = /private stepPerch\(m: Mobile, ctx: MobileContext, dt: number\): void \{([\s\S]*?)\n {2}\}/.exec(manager)?.[1] ?? '';
  ok(/topSurface\(p\.x, p\.z, p\.y \+ T\.up, T\.up \+ T\.down, PERCH_FILTER, staticOnly\)/.test(step), 'one probe a frame, among what stands still');
  ok(/const hit = perchSurface\(found, ground, T\);/.test(step), 'what it found is taken through `perchSurface`, so something buried is nothing');
  ok(/s\.built = this\.deps\.builtAt\?\.\(p\.x, p\.z\) \?\? 'built';/.test(step) && /if \(near && s\.asked >= T\.builtEvery\)/.test(step), 'the streamer is asked only near the player, every builtEvery');
  ok(/perchStep\(s, hit, near, s\.built, dt, T, this\.perchPaused\)/.test(step), 'and the step is told whether the world is behind a screen, so the safety net waits there');
  ok(/m\.perchLand\(hit\);/.test(step) && /if \(post && keepsSpot\(post\.kind, hit, ground, T\)\) post\.kind = 'still';/.test(step), 'a body that lands is set down on what was found, and keeps its spot through `keepsSpot`');
  ok(/if \(m\.isDriven\) \{\s*m\.endPerch\('driven'\);/.test(step), 'a body another browser keeps is not perched here, and is not counted as held');
  const over = /perchOver\(x: number, z: number, footprint: number\): void \{([\s\S]*?)\n {2}\}/.exec(manager)?.[1] ?? '';
  ok(/perchesAgain\(m\.pos\.y, groundUnder\(m\.pos\.x, m\.pos\.z, this\.deps\.terrain, this\.deps\), PERCH_TUNE\)/.test(over) && /m\.startPerch\(\);/.test(over) && /m\.isDriven/.test(over), 'a floor losing its collision perches again whoever of this browser\'s own stands raised within its footprint');

  const body = src('world/mobiles/mobile.ts');
  ok(/if \(!tier\.move \|\| this\.stunned > 0 \|\| this\.downPhase \|\| this\.perched\) pace = 'stand';/.test(body), 'a perched body stands still rather than stepping off a platform nobody has built yet');
  ok(/if \(spawn\.perch && !this\.flyer\) this\.startPerch\(\);/.test(body), 'and is held from its first step, a flyer never');
  const start = /startPerch\(\): void \{([\s\S]*?)\n {2}\}/.exec(body)?.[1] ?? '';
  ok(/this\.airless = true;/.test(start) && /holdAir\(this\.body\);/.test(start), 'held the instant it is perched, before the manager has written its hold once: a body still loading returns from its update before its own hold');
  ok(/this\.body\.setTranslation\(\{ x: t\.x, y: landTop\(top, this\.plan\.feet\), z: t\.z \}, true\);/.test(body), 'it lands through `landTop`, the same set-down this test lands with');
  const end = /endPerch\(outcome: [^)]*\): void \{([\s\S]*?)\n {2}\}/.exec(body)?.[1] ?? '';
  ok(/this\.body\.wakeUp\(\);/.test(end), 'and woken outright when its perch ends, or a body asleep from the hold hangs in the air it was let go in');
  const driven = /npcSetDriven\(driven: boolean\): void \{([\s\S]*?)\n {4}\/\/ Ours again, from where it stands/.exec(body)?.[1] ?? '';
  ok(/if \(this\.perched\) this\.endPerch\('driven'\);[\s\S]*?return;/.test(driven), 'a body handed to another browser leaves its perch behind: its keeper says where it stands');
  const hands = /\/\/ Ours again, from where it stands[\s\S]*?if \(live\) \{/.exec(body)?.[0] ?? '';
  ok(/if \(perchesAgain\(this\.pos\.y, ground, PERCH_TUNE\)\) this\.startPerch\(\);\s*else if \(this\.perched\) \{\s*this\.endPerch\(null\);/.test(hands), 'and one handed back is perched only if it stands well over the ground now, and never left holding a perch that no longer applies');

  const world = src('world/world.ts');
  ok(/builtAt: \(x, z\) => this\.layoutStream\?\.builtAt\(x, z\) \?\? 'built',/.test(world), 'the world hands the manager the streamer\'s answer');
  ok(/waiting: \(\) => this\.playerWaiting\(\),/.test(world), 'and the game\'s own word on whether a loading screen is up');
  ok(/this\.layoutStream\.onFloorGone = \(x, z, footprint\) => this\.mobiles\?\.perchOver\(x, z, footprint\);/.test(world), 'and tells it when a floor\'s collision goes');

  const stream = src('world/layoutStream.ts');
  const built = /builtAt\(x: number, z: number\): FloorAnswer \{([\s\S]*?)\n {2}\}/.exec(stream)?.[1] ?? '';
  ok(/return floorAt\(x, z, this\.largestFootprint, this\.floorAsk\);/.test(built) && !/`/.test(built), 'the streamer answers through `floorAt`, making no string');
  ok(/stepped: \(\) => this\.physics\.steps > this\.collidersMadeAt,/.test(stream) && /this\.colliders\.set\(o, cols\);\s*\/\/[^\n]*\n\s*this\.collidersMadeAt = this\.physics\.steps;/.test(stream), 'nothing counts as solid until the world has stepped since the last collision was made, since a query cannot see it before');
  ok(/collides: \(o\) => !this\.huge\.has\(o\) && \(o\.radius >= COLLIDER_MIN_RADIUS \|\| !!o\.solid\),/.test(stream) && /if \(\(o\.radius < COLLIDER_MIN_RADIUS && !o\.solid\) \|\| this\.colliders\.has\(o\) \|\| this\.huge\.has\(o\)\) continue;/.test(stream), 'what it counts as ever solid is the collider sweep\'s own floor');
  ok(/wanted: \(region, o\) => boxDistance\(this\.updateX, this\.updateZ, region\.cx, region\.cz\) <= this\.rangeOf\(region, o\.tier, this\.floorRoom\) && !colliderFar\(o, this\.updateX, this\.updateZ, 1\),/.test(stream), 'and what it calls wanted is the tier loading and the sweep reaching, both from where the player stood at the last update');
  ok(/this\.updateX = px;\s*this\.updateZ = pz;/.test(stream), 'which the update keeps');
  ok(/if \(def !== undefined\) p\.footprint = def\?\.particle \? 0 : footprintOf\(def\?\.bounds, tiltSin\(p\.q\.x, p\.q\.z\)\);/.test(stream), "an object's footprint is measured from its own model's box as it is turned where it stands");
  ok((stream.match(/this\.noteFootprint\(region, (p|placed), def \?\? null\);/g) ?? []).length === 2 && (stream.match(/this\.noteFootprint\(region, p\);/g) ?? []).length === 1, "measured as the layout's objects and a thing placed in play are filed, and a filing again raises its region's reach with it");
  ok(/if \(!this\.disposed && cols\.length && !o\.contained && o\.footprint > 0\) this\.onFloorGone\?\.\(o\.x, o\.z, o\.footprint\);/.test(stream), 'a placed object losing its collision says so, but never while the streamer is being disposed of');
}

console.log(`\n${passed} checks passed`);
