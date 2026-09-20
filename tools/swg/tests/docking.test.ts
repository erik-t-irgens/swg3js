// Docking at a station: the corridors a lane's points are chained into, the course through one, the
// pose at the dock, who holds a lane, and the drive that flies it.
//
// Every lane here is synthetic and made of round numbers. Each case says which shape of real hull it
// stands for -- a hull whose lanes each run out in one corridor, a hull that keeps two corridors under
// one letter with their numbers interleaved, a hull that files one dock's corridors under the letters
// of the two beside it, a lane that is a bare dock, a long hull whose lanes are all at one end, and a
// dock that faces back out the way the ship came in -- and nothing is copied from the client's files.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Docking } from '../../../src/space/docking.ts';
import {
  DOCK_FACE,
  DOCK_TUNE,
  LaneClaims,
  approachRun,
  chainWays,
  dockPose,
  exitRun,
  flownBy,
  laneCruise,
  laneDrive,
  lanesOf,
  newLaneDrive,
  quatFromForwardUp,
  reached,
  settleEase,
  turn,
  type DockLaneLike,
  type LaneRun,
  type LaneStepLike,
} from '../../../src/space/dockingMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const v = (x: number, y: number, z: number) => ({ x, y, z });

/** A turn about Y by `deg`, as the pack keeps one: [w, x, y, z]. */
const yaw = (deg: number): number[] => {
  const h = (deg * Math.PI) / 360;
  return [Math.cos(h), 0, Math.sin(h), 0];
};

/** A lane point as a pack writes it: its place, its turn, and the nose of that turn. */
function point(n: number, at: [number, number, number], q: number[], dock?: [number, number, number]): LaneStepLike {
  const f = turn({ w: q[0], x: q[1], y: q[2], z: q[3] }, v(0, 0, 1), v(0, 0, 0));
  return {
    n,
    at,
    q,
    forward: [f.x, f.y, f.z],
    fromDock: dock ? Math.hypot(at[0] - dock[0], at[1] - dock[1], at[2] - dock[2]) : null,
  };
}

const run: LaneRun = { lane: '', points: [], out: false, blocked: false };

// --- 1: one lane, one corridor ---------------------------------------------------------------------
// Stands for the hulls whose every lane runs out in a single corridor numbered from the dock.
{
  const dock: [number, number, number] = [50, 0, 0];
  const west = yaw(-90); // its nose is -X: the way a ship parks, and here also the way it flies in.
  const lane: DockLaneLike = {
    lane: 'a',
    dock: { at: dock, q: west, forward: [-1, 0, 0] },
    dockRadius: 25,
    approach: [point(1, [100, 0, 0], west, dock), point(2, [200, 0, 0], west, dock), point(3, [350, 0, 0], west, dock)],
    exit: [point(1, [100, 0, -40], west, dock), point(2, [200, 0, -120], west, dock)],
  };
  const ways = chainWays(v(dock[0], dock[1], dock[2]), lane.approach);
  ok(ways.length === 1 && ways[0].points.length === 3, `1: one corridor holding all three points (${ways.length} corridors)`);
  ok(ways[0].points[0].x === 100 && ways[0].points[2].x === 350, '1: ordered from the dock outward');

  const plans = lanesOf([lane]);
  ok(plans.length === 1 && plans[0].radius === 25, '1: the lane keeps the hull\'s own dock radius');
  // A ship out at the end of the corridor flies the whole of it, the dock last.
  approachRun(plans[0], v(400, 0, 0), run);
  ok(run.points.length === 4 && run.points[0].x === 350 && run.points[3].x === 50, `1: the course runs from the far end to the dock (${run.points.map((p) => p.x).join(' → ')})`);
  // A ship already alongside joins at the point nearest it rather than flying out to the end first.
  approachRun(plans[0], v(120, 0, 0), run);
  ok(run.points.length === 2 && run.points[0].x === 100, `1: a ship alongside joins the corridor where it stands (${run.points.length} points)`);
  exitRun(plans[0], run);
  ok(run.out && run.points.length === 2 && run.points[1].z === -120, '1: the way out runs from the dock outward');
}

// --- 2: two corridors under one letter -------------------------------------------------------------
// Stands for the hull that keeps two whole corridors under one lane letter, their numbers interleaved
// between them, so the numbers cannot be read as an order and the points are chained by geometry.
{
  const dock: [number, number, number] = [0, 0, 0];
  const east = yaw(90);
  const a: [number, number, number][] = [[-60, 0, 0], [-160, 0, 0], [-300, 0, 0]];
  const b: [number, number, number][] = [[-60, 0, 80], [-160, 0, 80], [-300, 0, 80]];
  const approach = [point(2, a[0], east, dock), point(1, b[0], east, dock), point(4, a[1], east, dock), point(3, b[1], east, dock), point(6, a[2], east, dock), point(5, b[2], east, dock)];
  const ways = chainWays(v(0, 0, 0), approach);
  ok(ways.length === 2, `2: the lane's points chain into two corridors (${ways.length})`);
  ok(ways.every((w) => w.points.length === 3), '2: three points in each');
  ok(ways.every((w) => w.points.every((p) => p.z === w.points[0].z)), '2: and no corridor crosses into the other');
  ok(ways.every((w) => Math.abs(w.points[0].x) < Math.abs(w.points[2].x)), '2: each ordered from the dock outward');
  // The course picks the corridor the ship is already beside.
  const plan = lanesOf([{ lane: 'a', dock: { at: dock, q: east, forward: [1, 0, 0] }, dockRadius: 20, approach, exit: [] }])[0];
  approachRun(plan, v(-320, 0, 80), run);
  ok(run.points.length === 4 && run.points.every((p, i) => i === 3 || p.z === 80), '2: the course keeps to the corridor the ship stands beside');
  // A stray point left in the wrong lane (one hull does that) is not flown on its own.
  const stray = chainWays(v(0, 0, 0), [...approach, point(9, [-300, 0, -400], east, dock)]);
  ok(stray.length === 2, `2: a single stray point is dropped where the lane has real corridors (${stray.length})`);
}

// --- 3: a bare dock --------------------------------------------------------------------------------
// Stands for the lane that carries a dock and a dock radius and no approach or exit points at all.
{
  const east = yaw(90);
  const full: DockLaneLike = {
    lane: 'a',
    dock: { at: [0, 0, 0], q: east, forward: [1, 0, 0] },
    dockRadius: 20,
    approach: [point(1, [-100, 0, 0], east, [0, 0, 0]), point(2, [-250, 0, 0], east, [0, 0, 0])],
    exit: [point(1, [-100, 0, 60], east, [0, 0, 0])],
  };
  const bare: DockLaneLike = { lane: 'b', dock: { at: [0, 0, 120], q: east, forward: [1, 0, 0] }, dockRadius: 20, approach: [], exit: [] };
  const plans = lanesOf([full, bare]);
  const b = plans[1];
  ok(b.bare && b.in.length === 1 && b.in[0].guessed, '3: a bare dock is approached along a corridor made up for it');
  ok(near(Math.hypot(b.in[0].points[0].x - 0, b.in[0].points[0].z - 120), DOCK_TUNE.standOff, 1e-3), `3: from the stand-off distance (${Math.hypot(b.in[0].points[0].x, b.in[0].points[0].z - 120).toFixed(1)} m)`);
  ok(b.in[0].points[0].x < -1, '3: and from the same side its neighbours are approached from');
  ok(b.out[0].guessed && b.out[0].points[0].z > 120, '3: its way out follows its neighbours\' too');
  // With no neighbour to borrow from, the dock hardpoint is the last resort and the corridor says it was guessed.
  const alone = lanesOf([bare])[0];
  ok(alone.in[0].guessed && near(alone.in[0].points[0].x, -DOCK_TUNE.standOff, 1e-3), `3: with no neighbours the dock's own turn is the last resort (${alone.in[0].points[0].x.toFixed(1)})`);
  // A lane with no dock is dropped: there is nowhere to put a ship.
  ok(lanesOf([{ lane: 'c', dock: null, dockRadius: null, approach: [], exit: [] }]).length === 0, '3: a lane with no dock is dropped');
}

// --- 4: which way a parked ship faces --------------------------------------------------------------
// A dock's own turn is the way a ship parks, never the way in: on the hulls the game shipped the two
// stand between 9 and 100 degrees apart (a dock in a row of bays faces along the row while its lane
// comes in from the side), so the game's turn is kept. The first case here, a dock that faces back
// out the way the ship flew in, is a shape no shipped hull has once each corridor is back on its own
// dock -- one corridor filed under a neighbour's letter did stand 138 degrees from that letter's dock,
// and §10 is that shape -- but the rule is kept so that an approach can never end with the ship
// flipping end for end on the spot.
{
  const dock: [number, number, number] = [0, 0, 0];
  const backwards = yaw(180); // its nose is -Z, while the corridor is flown from -Z toward the dock.
  const lane: DockLaneLike = {
    lane: 'a',
    dock: { at: dock, q: backwards, forward: [0, 0, -1] },
    dockRadius: 30,
    approach: [point(1, [0, 0, -80], backwards, dock), point(2, [0, 0, -200], backwards, dock)],
    exit: [],
  };
  const plan = lanesOf([lane])[0];
  approachRun(plan, v(0, 0, -260), run);
  const pos = v(0, 0, 0);
  const q = { x: 0, y: 0, z: 0, w: 1 };
  DOCK_FACE.rule = 'auto';
  dockPose(plan, run, pos, q);
  let nose = turn(q, v(0, 0, 1), v(0, 0, 0));
  ok(near(nose.z, 1, 1e-6), `4: a dock that faces back out leaves the parked ship facing the way it flew in (${nose.z.toFixed(3)})`);
  DOCK_FACE.rule = 'hardpoint';
  dockPose(plan, run, pos, q);
  nose = turn(q, v(0, 0, 1), v(0, 0, 0));
  ok(near(nose.z, -1, 1e-6), '4: and the game\'s own turn can be had back');
  // A dock whose forward agrees with the lane keeps the game's turn under the same rule.
  DOCK_FACE.rule = 'auto';
  const along = lanesOf([{ ...lane, dock: { at: dock, q: yaw(0), forward: [0, 0, 1] } }])[0];
  approachRun(along, v(0, 0, -260), run);
  dockPose(along, run, pos, q);
  nose = turn(q, v(0, 0, 1), v(0, 0, 0));
  ok(near(nose.z, 1, 1e-6) && near(pos.z, 0), '4: a dock that faces the way in keeps its own turn');
  ok(near(pos.x, 0) && near(pos.y, 0), '4: and the ship rests at the dock point itself');
  // A row of bays: the dock stands square across its lane, and the ship parks along the row.
  const across = lanesOf([{ ...lane, dock: { at: dock, q: yaw(90), forward: [1, 0, 0] } }])[0];
  approachRun(across, v(0, 0, -260), run);
  dockPose(across, run, pos, q);
  nose = turn(q, v(0, 0, 1), v(0, 0, 0));
  ok(near(nose.x, 1, 1e-6), `4: a dock square across its lane still parks the ship the way the hull's designers drew it (${nose.x.toFixed(3)})`);
}

// --- 5: the turn a pose is built from --------------------------------------------------------------
{
  const q = { x: 0, y: 0, z: 0, w: 1 };
  quatFromForwardUp(v(1, 0, 0), v(0, 1, 0), q);
  const nose = turn(q, v(0, 0, 1), v(0, 0, 0));
  const up = turn(q, v(0, 1, 0), v(0, 0, 0));
  ok(near(nose.x, 1, 1e-6) && near(up.y, 1, 1e-6), '5: the nose lands on the direction asked for, the up kept');
  quatFromForwardUp(v(0, 1, 0), v(0, 1, 0), q);
  const straight = turn(q, v(0, 0, 1), v(0, 0, 0));
  ok(near(Math.hypot(straight.x, straight.y, straight.z), 1, 1e-6) && near(straight.y, 1, 1e-6), '5: a nose in line with the up still gives a turn, not a zero');
}

// --- 6: the claims -----------------------------------------------------------------------------
{
  const claims = new LaneClaims();
  const key = LaneClaims.key('station', 'a');
  ok(claims.claim(key, 'one'), '6: the first ship to ask for a lane is granted it');
  ok(!claims.claim(key, 'two'), '6: the second is refused');
  ok(claims.claim(key, 'one'), '6: asking again for what you hold is granted');
  ok(!claims.free(key, 'two') && claims.free(key, 'one'), '6: and the lane reads as taken by whoever holds it');
  claims.release('one');
  ok(claims.claim(key, 'two') && claims.count === 1, '6: released, the next ship gets it');
  claims.clear();
  ok(claims.count === 0 && claims.holder(key) === null, '6: a zone left gives every lane back');
}

// --- 7: the cruise and the arrival -----------------------------------------------------------------
{
  ok(laneCruise(1000, false) === DOCK_TUNE.laneSpeed, '7: far out, the lane is flown at its own speed');
  ok(laneCruise(1000, true) === DOCK_TUNE.dockSpeed, '7: the leg that ends at the dock is never flown faster than the dock speed');
  ok(laneCruise(10, false) < laneCruise(100, false), '7: and the cruise eases down as the point comes up');
  ok(laneCruise(0, true) === 0, '7: at the dock it asks for nothing');
  ok(reached(DOCK_TUNE.arrive - 1, false, 30) && !reached(DOCK_TUNE.arrive + 1, false, 30), '7: a lane point counts as reached inside the arrival distance');
  ok(reached(29, true, 30) && !reached(31, true, 30), '7: the dock itself counts by the hull\'s own dock radius');
  ok(near(settleEase(0), 0) && near(settleEase(1), 1) && settleEase(0.5) > 0.4 && settleEase(0.5) < 0.6, '7: the settle is still at both ends');
}

// --- 8: the drive, and a fake hull flown down a lane ------------------------------------------------
{
  const drive = newLaneDrive();
  // A point off the ship's right: flyShip's sense is that a positive stick swings the nose that way.
  laneDrive(v(0, 0, 0), { x: 0, y: 0, z: 0, w: 1 }, v(-100, 0, 100), 50, drive);
  ok(drive.stickX > 0 && drive.cruise === 50, `8: a point to the right puts the stick right (${drive.stickX.toFixed(2)})`);
  laneDrive(v(0, 0, 0), { x: 0, y: 0, z: 0, w: 1 }, v(0, -100, 100), 50, drive);
  ok(drive.stickY > 0, `8: a point below pushes the nose down (${drive.stickY.toFixed(2)})`);
  laneDrive(v(0, 0, 0), { x: 0, y: 0, z: 0, w: 1 }, v(0, 0, 0), 10, drive);
  ok(drive.stickX === 0 && drive.stickY === 0, '8: a point underfoot leaves the stick in the middle');
  ok(drive.throttle === 0 && !drive.boost && drive.heading === null, '8: the autopilot never touches the throttle, the boost or the heading');

  // A fake hull: it turns its nose toward the stick at a fixed rate and flies along it at the cruise.
  // Crude next to the game's flight model, which is the point -- what is under test is the course, the
  // cruise and when a point counts as reached, not how a hull turns.
  const dock: [number, number, number] = [0, 0, 0];
  const west = yaw(-90);
  const lane = lanesOf([
    {
      lane: 'a',
      dock: { at: dock, q: west, forward: [-1, 0, 0] },
      dockRadius: 25,
      approach: [point(1, [80, 0, 0], west, dock), point(2, [240, 0, 60], west, dock), point(3, [420, 0, 140], west, dock)],
      exit: [],
    },
  ])[0];
  approachRun(lane, v(470, 0, 170), run);
  ok(run.points.length === 4, '8: the course starts at the far point and ends at the dock');
  const pos = v(470, 0, 170);
  const q = { x: 0, y: 0, z: 0, w: 1 };
  let index = 0;
  const dt = 1 / 60;
  let seconds = 0;
  const order: number[] = [];
  const to = v(0, 0, 0);
  const nose = v(0, 0, 1);
  while (index < run.points.length && seconds < 120) {
    const p = run.points[index];
    const d = Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z);
    if (reached(d, index === run.points.length - 1, lane.radius)) {
      order.push(index);
      index++;
      continue;
    }
    laneDrive(pos, q, p, laneCruise(d, index === run.points.length - 1), drive);
    // Turn the nose toward the point at a quarter turn a second, then fly along it.
    to.x = (p.x - pos.x) / d;
    to.y = (p.y - pos.y) / d;
    to.z = (p.z - pos.z) / d;
    const k = Math.min(1, 1.6 * dt);
    nose.x += (to.x - nose.x) * k;
    nose.y += (to.y - nose.y) * k;
    nose.z += (to.z - nose.z) * k;
    const l = Math.hypot(nose.x, nose.y, nose.z) || 1;
    nose.x /= l;
    nose.y /= l;
    nose.z /= l;
    quatFromForwardUp(nose, v(0, 1, 0), q);
    pos.x += nose.x * drive.cruise * dt;
    pos.y += nose.y * drive.cruise * dt;
    pos.z += nose.z * drive.cruise * dt;
    seconds += dt;
  }
  ok(order.join(',') === '0,1,2,3', `8: the hull visits every point of the course in order (${order.join(',')})`);
  ok(seconds < 120, `8: and reaches the dock (${seconds.toFixed(1)} s)`);
  ok(Math.hypot(pos.x, pos.y, pos.z) <= lane.radius, `8: inside the dock radius (${Math.hypot(pos.x, pos.y, pos.z).toFixed(1)} m of ${lane.radius})`);
}

// --- 9: a whole dock, flown ------------------------------------------------------------------------
// The state the game runs: a hull with one lane standing out in a zone, a fake ship flown by the
// autopilot's own drive through a stripped copy of the flight code's senses (a positive stick swings
// the nose right and pushes it down, and the hull flies along its nose at the cruise it is given).
{
  const played: string[] = [];
  let repaired = 0;
  const dockAt: [number, number, number] = [50, 0, 0];
  const west = yaw(-90);
  const lane: DockLaneLike = {
    lane: 'a',
    dock: { at: dockAt, q: west, forward: [-1, 0, 0] },
    dockRadius: 25,
    approach: [point(1, [120, 0, 0], west, dockAt), point(2, [300, 0, 40], west, dockAt), point(3, [520, 0, 90], west, dockAt)],
    exit: [point(1, [120, 0, -60], west, dockAt), point(2, [320, 0, -180], west, dockAt)],
  };
  const hull = { model: 'hull', template: 'hull', x: 2000, y: 0, z: 0, q: new THREE.Quaternion(), radius: 120, contained: false, tier: 0 };
  const world = {
    planet: { space: 'a system' },
    spaceData: {
      stations: [{ name: 'test', title: 'Test Station', model: 'hull', x: -2000, y: 0, z: 0, radius: 120 }],
      scenery: [],
      lanes: { hull: { lanes: [lane], drydocks: [], bays: [] } },
      dockEffects: { harddock: { source: '', particle: null, sound: 'a' }, release: { source: '', particle: null, sound: 'b' }, repair: { source: '', particle: null, sound: 'c' } },
    },
    placedObjects: [hull],
    dockEffect: (part: string) => {
      played.push(part);
      return true;
    },
  };
  // A fake hull: only what docking reads of a ship, with a hold that lands it where the real one does.
  const attitude = new THREE.Quaternion();
  const ship = {
    spec: { id: 'testship' },
    pos: new THREE.Vector3(2000 + 560, 0, 120),
    disposed: false,
    holding: false,
    ghosted: false,
    held: false,
    landed: false,
    combat: { repair: () => void repaired++ },
    quaternion: (out: THREE.Quaternion) => out.copy(attitude),
    hold: (frame: THREE.Matrix4 | null, p: THREE.Vector3, q: THREE.Quaternion) => {
      ship.holding = true;
      if (!frame) {
        ship.pos.copy(p);
        attitude.copy(q);
        return;
      }
      ship.pos.copy(p).applyMatrix4(frame);
      const fp = new THREE.Vector3();
      const fq = new THREE.Quaternion();
      const fs = new THREE.Vector3();
      frame.decompose(fp, fq, fs);
      attitude.copy(fq).multiply(q);
    },
    release: () => void (ship.holding = false),
    setGhost: (on: boolean) => void (ship.ghosted = on),
  };
  // The fake world and the fake ship carry only what docking reads of them, so each is cast in.
  const docking = new Docking(world as any);
  ship.landed = true;
  ok(docking.dock(ship as any) === 'lift off first' && docking.report().phase === 'idle', '9: a ship set down on something is not flown off it by the dock');
  ship.landed = false;
  const said = docking.dock(ship as any);
  ok(docking.report().phase === 'approach', `9: asking for a dock starts the approach (${said})`);
  ok((docking.report().at as string) === 'Test Station', '9: and names the station from the pack');
  ok(docking.flying(ship as any) && !docking.docked(ship as any), '9: the autopilot has the ship');

  const dt = 1 / 60;
  const nose = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const X = new THREE.Vector3(1, 0, 0);
  let seconds = 0;
  let phases = '';
  while (seconds < 90 && docking.report().phase !== 'docked') {
    const drive = docking.step(ship as any, dt, null);
    const phase = docking.report().phase as string;
    if (!phases.endsWith(phase)) phases += (phases ? ' → ' : '') + phase;
    if (drive && !ship.holding) {
      // flyShip's own senses, with no inertia: yaw about the hull's Y, pitch about its X, and on along the nose.
      attitude.multiply(spin.setFromAxisAngle(Y, -(drive.stickX ?? 0) * 1.5 * dt));
      attitude.multiply(spin.setFromAxisAngle(X, (drive.stickY ?? 0) * 1.5 * dt));
      nose.set(0, 0, 1).applyQuaternion(attitude);
      ship.pos.addScaledVector(nose, (drive.cruise ?? 0) * dt);
    }
    seconds += dt;
  }
  ok(docking.report().phase === 'docked', `9: it flies the lane and comes to rest at the dock (${phases}, ${seconds.toFixed(1)} s)`);
  ok(ship.pos.distanceTo(new THREE.Vector3(2000 + 50, 0, 0)) < 1e-6, `9: exactly at the dock point (${ship.pos.toArray().map((n) => n.toFixed(1)).join(', ')})`);
  ok(ship.holding && ship.ghosted, '9: held there, and nothing can ram it');
  ok(repaired === 1 && played.includes('harddock') && played.includes('repair'), `9: the station plays its own effects and puts the ship right once (${played.join(', ')})`);
  ok(docking.docked(ship as any) && !docking.flying(ship as any), '9: and it reads as docked, for anything that must refuse while it is');
  ok(docking.menuRow(ship as any, 'pilot', true).label === 'Launch', '9: the menu row offers the way out');

  docking.act(ship as any);
  ok(docking.report().phase === 'launch' && !ship.holding && played.includes('release'), '9: launching lets go and plays the release');
  seconds = 0;
  while (seconds < 90 && docking.report().phase !== 'idle') {
    const drive = docking.step(ship as any, dt, null);
    if (drive && !ship.holding) {
      attitude.multiply(spin.setFromAxisAngle(Y, -(drive.stickX ?? 0) * 1.5 * dt));
      attitude.multiply(spin.setFromAxisAngle(X, (drive.stickY ?? 0) * 1.5 * dt));
      nose.set(0, 0, 1).applyQuaternion(attitude);
      ship.pos.addScaledVector(nose, (drive.cruise ?? 0) * dt);
    }
    seconds += dt;
  }
  ok(docking.report().phase === 'idle' && !ship.ghosted, `9: the way out ends with the hull back in the pilot's hands (${seconds.toFixed(1)} s)`);
  ok(ship.pos.x > 2000 + 300 && ship.pos.z < -100, `9: out where the lane's own exit points lead (${ship.pos.toArray().map((n) => n.toFixed(0)).join(', ')})`);
  ok((docking.report().claims as number) === 0, '9: and the lane is given back');

  // A hand on the controls on the way in gives the ship straight back, wherever it has got to.
  const again = new Docking(world as any);
  again.dock(ship as any);
  // The first moments are the pilot's own: the hand that pressed the button, and a flight cursor left
  // wherever it was, must not break the lane off before it has begun.
  again.step(ship as any, dt, { throttle: 1, steer: 0, boost: false, hop: false, up: false, down: false });
  ok(again.report().phase === 'approach', '9: the press that started the dock does not break it off');
  for (let i = 0; i < 90; i++) again.step(ship as any, dt, null);
  ok(again.report().phase === 'approach', '9: the approach runs while the pilot keeps his hands off');
  again.step(ship as any, dt, { throttle: 1, steer: 0, boost: false, hop: false, up: false, down: false });
  ok(again.report().phase === 'idle' && !ship.ghosted, `9: and a hand on the throttle breaks it off (${again.report().note})`);
}

// --- 10: corridors filed under a neighbour's letter -------------------------------------------------
// One retail hull files a third dock's corridors under the letters of the two beside it, which left
// that dock looking like a dock with no points of its own and had a ship parked at it on a direction
// borrowed from a neighbour -- and had the letter that carried the stray corridor parking a ship one
// way down one of its two corridors and 138 degrees round from it down the other. A corridor belongs
// to the dock its innermost point is nearest, and once it is put back there every dock has a corridor
// and one attitude.
{
  const bays = yaw(90); // every dock in the row faces along the row: nose +X, square across its lanes.
  const dockA: [number, number, number] = [-40, -70, -140];
  const dockB: [number, number, number] = [0, -70, -140];
  const dockC: [number, number, number] = [60, -70, -140];
  const inA: [number, number, number][] = [[-40, -55, -60], [-40, -10, 80], [-45, 40, 270], [-50, 45, 420]];
  const inB: [number, number, number][] = [[0, -55, -60], [0, -10, 80], [0, 40, 270]];
  const inC: [number, number, number][] = [[60, -55, -60], [65, -10, 80], [70, 40, 270], [75, 45, 420]];
  const outA: [number, number, number][] = [[-40, -63, -60], [-45, -97, 10], [-60, -165, 100], [-115, -200, 255]];
  const outB: [number, number, number][] = [[0, -63, -60], [0, -97, 10], [0, -165, 100], [0, -200, 260]];
  const outC: [number, number, number][] = [[60, -63, -60], [70, -97, 10], [85, -165, 100], [125, -200, 255]];
  const steps = (list: [number, number, number][], dock: [number, number, number]) => list.map((at, i) => point(i + 1, at, bays, dock));
  // As the hull files them: a carries its own and c's, b carries its own and c's exits, c carries none.
  const laneA: DockLaneLike = { lane: 'a', dock: { at: dockA, q: bays, forward: [1, 0, 0] }, dockRadius: 20, approach: [...steps(inA, dockA), ...steps(inC, dockA)], exit: steps(outA, dockA) };
  const laneB: DockLaneLike = { lane: 'b', dock: { at: dockB, q: bays, forward: [1, 0, 0] }, dockRadius: 20, approach: steps(inB, dockB), exit: [...steps(outB, dockB), ...steps(outC, dockB)] };
  const laneC: DockLaneLike = { lane: 'c', dock: { at: dockC, q: bays, forward: [1, 0, 0] }, dockRadius: 20, approach: [], exit: [] };

  const plans = lanesOf([laneA, laneB, laneC]);
  const byLetter = Object.fromEntries(plans.map((p) => [p.lane, p]));
  ok(plans.every((p) => !p.bare), '10: no dock is left bare once the corridors are back where they belong');
  ok(plans.every((p) => p.in.length === 1 && p.out.length === 1), `10: one corridor in and one out at each dock (${plans.map((p) => `${p.lane}:${p.in.length}/${p.out.length}`).join(' ')})`);
  ok(plans.every((p) => p.in.every((w) => !w.guessed) && p.out.every((w) => !w.guessed)), '10: and not one of them is made up');
  ok(near(byLetter.c.in[0].points[0].x, 60) && near(byLetter.c.out[0].points[0].x, 60), `10: the third dock gets its own corridors back from its neighbours' letters (${byLetter.c.in[0].points[0].x}, ${byLetter.c.out[0].points[0].x})`);
  ok(near(byLetter.a.in[0].points[0].x, -40) && near(byLetter.b.in[0].points[0].x, 0), '10: and the other two keep theirs');

  // One dock, one attitude: every lane of the row parks a ship the way the hull's designers drew it.
  DOCK_FACE.rule = 'auto';
  const pos = v(0, 0, 0);
  const q = { x: 0, y: 0, z: 0, w: 1 };
  for (const p of plans) {
    const outer = p.in[0].points[p.in[0].points.length - 1];
    approachRun(p, v(outer.x + 10, outer.y + 10, outer.z + 60), run);
    ok(!run.blocked && run.points.length === p.in[0].points.length + 1, `10: lane ${p.lane} is flown from the far end of its own corridor (${run.points.length} points)`);
    dockPose(p, run, pos, q);
    const nose = turn(q, v(0, 0, 1), v(0, 0, 0));
    ok(near(nose.x, 1, 1e-3), `10: and parks the ship on the dock's own turn (lane ${p.lane}, nose x ${nose.x.toFixed(3)})`);
  }

  // What it looked like before: the stray corridor read as a second way into its neighbour's dock, and
  // flown down it a ship was parked back out the way it came.
  const alone = lanesOf([laneA])[0];
  ok(alone.in.length === 2, `10: read on its own, the letter holds two corridors (${alone.in.length})`);
  approachRun(alone, v(85, 55, 480), run);
  dockPose(alone, run, pos, q);
  const strayNose = turn(q, v(0, 0, 1), v(0, 0, 0));
  ok(strayNose.x < 0, `10: and the stray one parked a ship away from the dock's own turn (nose x ${strayNose.x.toFixed(3)})`);
}

// --- 11: a lane on the far side of the hull ---------------------------------------------------------
// The capital ship is 1.6 km long and every one of its four lanes is at the tail. A ship off its nose
// is inside the distance the row lights up at, and the nearest lane point is 1300 m away straight down
// the hull: flown, that is the autopilot driving the ship into the thing it is docking at. The pilot is
// told to come round instead, and a ship out at the end of a corridor is let in as before.
{
  const dock: [number, number, number] = [0, 0, -800];
  const tail = yaw(180);
  const lane = lanesOf([
    {
      lane: 'a',
      dock: { at: dock, q: tail, forward: [0, 0, -1] },
      dockRadius: 40,
      approach: [point(1, [0, -30, -830], tail, dock), point(2, [0, -60, -880], tail, dock), point(3, [0, -80, -930], tail, dock)],
      exit: [point(1, [0, -30, -770], tail, dock)],
    },
  ])[0];
  approachRun(lane, v(0, 0, 700), run);
  ok(run.blocked && run.points.length === 0, '11: a ship off the far end of a long hull is given no course at all');
  approachRun(lane, v(0, -120, -1000), run);
  ok(!run.blocked && run.points.length === 4, `11: one out at the end of the corridor is flown the whole lane (${run.points.length} points)`);
  approachRun(lane, v(0, -40, -845), run);
  ok(!run.blocked, '11: and one already alongside joins where it stands');
  // On the hull's side of the dock, aiming back at the lane: every leg arrives against the way the
  // corridor is flown, which is a straight line through whatever stands between.
  approachRun(lane, v(0, 150, -650), run);
  ok(run.blocked, '11: nor is a lane entered against the way it is flown');
  // Out past the far end, though, is simply further along the same approach.
  approachRun(lane, v(0, 200, -1600), run);
  ok(!run.blocked, '11: while out beyond its far end is the same approach, further back');
}

// --- 12: what docking owns of the hull, and what it does not ----------------------------------------
// The landing sets a hold of its own down before a hull reads as landed, and the jump sets a ghost.
// Letting go of either one's would put a grounded hull's gravity back or make a jumping one solid, so
// docking takes a hull nothing else holds and gives back only the hold and the ghost it set itself.
{
  const dockAt: [number, number, number] = [50, 0, 0];
  const west = yaw(-90);
  const world = {
    planet: { space: 'a system' },
    spaceData: {
      stations: [{ name: 'test', title: 'Test Station', model: 'hull', x: -2000, y: 0, z: 0, radius: 120 }],
      scenery: [],
      lanes: {
        hull: {
          lanes: [
            {
              lane: 'a',
              dock: { at: dockAt, q: west, forward: [-1, 0, 0] },
              dockRadius: 25,
              approach: [point(1, [120, 0, 0], west, dockAt), point(2, [300, 0, 40], west, dockAt), point(3, [520, 0, 90], west, dockAt)],
              exit: [point(1, [120, 0, -60], west, dockAt)],
            },
          ],
          drydocks: [],
          bays: [],
        },
      },
      dockEffects: { harddock: { source: '', particle: null, sound: 'a' }, release: { source: '', particle: null, sound: 'b' }, repair: { source: '', particle: null, sound: 'c' } },
    },
    placedObjects: [{ model: 'hull', template: 'hull', x: 2000, y: 0, z: 0, q: new THREE.Quaternion(), radius: 120, contained: false, tier: 0 }],
    dockEffect: () => true,
  };
  let released = 0;
  let unghosted = 0;
  const ship = {
    spec: { id: 'testship' },
    pos: new THREE.Vector3(2000 + 560, 0, 120),
    disposed: false,
    holding: false,
    ghosted: false,
    held: false,
    landed: false,
    combat: { repair: () => {} },
    quaternion: (out: THREE.Quaternion) => out.identity(),
    hold: () => void (ship.holding = true),
    release: () => {
      released++;
      ship.holding = false;
    },
    setGhost: (on: boolean) => {
      if (!on) unghosted++;
      ship.ghosted = on;
    },
  };
  const d = new Docking(world as any);
  // A ship in the middle of a set-down is holding before it reads as landed: that is the case the
  // landed flag alone lets through.
  ship.holding = true;
  ok(d.dock(ship as any) === 'something else has the ship' && d.report().phase === 'idle', '12: a hull something else holds is not taken');
  ok(d.menuRow(ship as any, 'pilot', true).why !== null, '12: and the row says so before it is pressed');
  ship.holding = false;
  ship.held = true;
  ok(d.dock(ship as any) === 'the jump has the ship', '12: nor is one the jump holds');
  ship.held = false;
  ok(d.dock(ship as any) !== '' && d.report().phase === 'approach', '12: a free hull is taken');
  released = 0;
  unghosted = 0;
  d.breakOff('by hand');
  ok(released === 0 && unghosted === 0 && d.report().phase === 'idle', `12: breaking off an approach gives back nothing it never took (${released} releases, ${unghosted} un-ghosts)`);
  ok((d.report().claims as number) === 0, '12: and the lane is given back all the same');

  // On the far side of the hull the row says to come round rather than offering a lane through it.
  ship.pos.set(1400, 0, 0);
  const far = d.menuRow(ship as any, 'pilot', true);
  ok(far.why !== null && far.why.startsWith('come round'), `12: the row says to come round from the far side (${far.why})`);
  ship.pos.set(2000 + 560, 0, 120);
  ok(d.menuRow(ship as any, 'pilot', true).why === null, '12: and offers the dock from the lane\'s own side');

  // A travel is a different pack: the zone left takes its lanes and its claims with it.
  d.dock(ship as any);
  ok((d.report().claims as number) === 1, '12: a lane asked for is held');
  (world as { spaceData: unknown }).spaceData = { version: 3, stations: [], scenery: [], lanes: {}, dockEffects: {} };
  d.step(ship as any, 1 / 60, null);
  const moved = d.menuRow(ship as any, 'pilot', true);
  ok((d.report().claims as number) === 0 && d.report().phase === 'idle', '12: and a new zone under it gives everything back');
  ok(moved.why === 'nothing in this system has a dock', `12: a system with no lanes at all says so (${moved.why})`);
}

// --- 13: an overshoot, and a run that never ends ----------------------------------------------------
{
  const q = { x: 0, y: 0, z: 0, w: 1 }; // nose +Z
  ok(flownBy(v(0, 0, 0), q, v(0, 0, -30), 30), '13: a point behind the nose and near is counted as flown by');
  ok(!flownBy(v(0, 0, 0), q, v(0, 0, 30), 30), '13: one ahead is not');
  ok(!flownBy(v(0, 0, 0), q, v(0, 0, -300), 300), '13: nor is one far behind, which is a lane point not yet reached');
}

// --- 14: the repair is the station's four seconds ---------------------------------------------------
// The row is dead while the station is putting the ship right, so the press behind it must be too, or
// the console's own way in would cancel the free repair the pilot came for.
{
  const dockAt: [number, number, number] = [0, 0, 0];
  const west = yaw(-90);
  const world = {
    planet: { space: 'a system' },
    spaceData: {
      stations: [],
      scenery: [],
      lanes: { hull: { lanes: [{ lane: 'a', dock: { at: dockAt, q: west, forward: [-1, 0, 0] }, dockRadius: 25, approach: [point(1, [60, 0, 0], west, dockAt)], exit: [point(1, [60, 0, -60], west, dockAt)] }], drydocks: [], bays: [] } },
      dockEffects: {},
    },
    placedObjects: [{ model: 'hull', template: 'hull', x: 0, y: 0, z: 0, q: new THREE.Quaternion(), radius: 60, contained: false, tier: 0 }],
    dockEffect: () => false,
  };
  let repaired = 0;
  const ship = {
    spec: { id: 'testship' },
    pos: new THREE.Vector3(70, 0, 0),
    disposed: false,
    holding: false,
    ghosted: false,
    held: false,
    landed: false,
    combat: { repair: () => void repaired++ },
    quaternion: (out: THREE.Quaternion) => out.identity(),
    hold: (_f: THREE.Matrix4 | null, p: THREE.Vector3) => {
      ship.holding = true;
      ship.pos.copy(p);
    },
    release: () => void (ship.holding = false),
    setGhost: (on: boolean) => void (ship.ghosted = on),
  };
  // The whole course runs along +X to the dock at the origin, so the hull is simply drawn along it at
  // whatever cruise the autopilot asks for: what is under test here is the phases, not the flying.
  const d = new Docking(world as any);
  d.dock(ship as any);
  const dt = 1 / 60;
  for (let i = 0; i < 2000 && d.report().phase !== 'repair'; i++) {
    const drive = d.step(ship as any, dt, null);
    if (drive && !ship.holding) ship.pos.x -= (drive.cruise ?? 0) * dt;
  }
  ok(d.report().phase === 'repair', `14: the ship reaches the dock and the station starts on it (${d.report().phase})`);
  const said = d.act(ship as any);
  ok(d.report().phase === 'repair' && said.startsWith('being put right'), `14: a launch during the repair is refused (${said})`);
  ok(d.launch() === 'not docked', '14: and so is one asked for straight out');
  for (let i = 0; i < 600 && d.report().phase !== 'docked'; i++) d.step(ship as any, dt, null);
  ok(d.report().phase === 'docked' && repaired === 1, '14: the repair finishes and the ship is put right once');
  ok(d.act(ship as any).startsWith('leaving by lane'), '14: then the launch is offered');

  // A run that never gets anywhere is handed back rather than circling for ever.
  const stuck = new Docking(world as any);
  ship.pos.set(70, 0, 0);
  ship.holding = false;
  stuck.dock(ship as any);
  ok(stuck.report().phase === 'approach', '14: a second dock starts');
  for (let i = 0; i < 7000 && stuck.report().phase !== 'idle'; i++) stuck.step(ship as any, dt, null);
  ok(stuck.report().phase === 'idle' && String(stuck.report().note).startsWith('gave up'), `14: a hull that never moves is given back when the run runs out of time (${stuck.report().note})`);
}

console.log(`\n${checks} checks passed`);
