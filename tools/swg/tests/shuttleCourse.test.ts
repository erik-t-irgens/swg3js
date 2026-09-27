// The shuttle's own pilot (src/world/shuttleCourse.ts): the course it plans between a take-off's cut and
// a landing's join, and the hand that flies it.
//
// What is held to: the plane's shortest paths end where they were asked to, to half a metre and half a
// degree, over a thousand poses drawn at random, and two poses close together facing apart take three
// turns; a course is sampled no further apart than its step, starts where the hull was let go and ends
// at the join, and comes in down the join's own line. Flown through a copy of flyShip's own integration
// (its lines read out of vehicle.ts, so a change there fails here) at the rig hull's own handling
// (`RIG_HULL_TUNE`, which the garage is read to write over a rig hull's spec), over every pair of rigged
// pads on the converted worlds, the pilot meets every join on ground that is flat about each pad, to 5 m
// across its line, 8 m up and 10 degrees of heading; it goes over a 500 m ridge rising at 40 degrees a
// kilometre short of a join and never into it; the two pads that stand nearest each other are flown
// a course many times longer than the line between them; and over the last half minute before every
// join it settles rather than sways, which the hand that read the error alone is flown beside it to
// fail. Out of the sky it climbs on its heading at its angle with its wings level, rolls them level
// when it is taken over banked, and climbs more steeply over ground that rises faster; in space it turns its nose onto a point behind it with no roll at all,
// and a ship coming at it bends its way. A step makes nothing: read in the code,
// measured as what twenty thousand of them leave behind, and as what short stretches of them allocate.
// A start already on the landing's own line is one straight run in; and from where every crossing down
// onto a rigged pad comes out, the course is within 15% of the straight line, turns no more than 90
// degrees planned or flown and meets its join, where the old way out of a crossing down flew a circle.
// The real ground is flown by hand (`shuttleCourseTerrain.ts`).
//
// Run: node --expose-gc tools/swg/tests/shuttleCourse.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import * as THREE from 'three';
import { SWAY, flyCourse, quantile, rigArrivals, rigPairs, type Flight, type RigPair } from './courseFixtures.ts';
import { lookRotation } from '../../../src/space/hyperspaceMath.ts';
import { RIG_HULL_TUNE } from '../../../src/vehicles/rigHull.ts';
import type { PadRef } from '../../../src/world/rideRoute.ts';
import { RIDE_PILOT, ShuttlePilot, dubins, planClimb, planCourse, planRadius, type RideState } from '../../../src/world/shuttleCourse.ts';
import { RIDE_TUNE } from '../../../src/world/shuttleRide.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = 180 / Math.PI;

/** Numbers drawn the same way every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    s ^= s >>> 12;
    return (s >>> 0) / 0x100000000;
  };
}

// ---------------------------------------------------------------- the plane's shortest paths

{
  const r = rng(7);
  const bare = { ...RIDE_PILOT, departStraight: 0, finalLen: 0 };
  let worstM = 0;
  let worstDeg = 0;
  let shorter = 0;
  const words = new Map<string, number>();
  for (let i = 0; i < 1000; i++) {
    const R = 100 + r() * 500;
    const from: RideState = { x: (r() - 0.5) * 8000, y: 0, z: (r() - 0.5) * 8000, heading: (r() - 0.5) * 2 * Math.PI, speed: 100 };
    const to: RideState = { x: from.x + (r() - 0.5) * 4 * R, y: 0, z: from.z + (r() - 0.5) * 4 * R, heading: (r() - 0.5) * 2 * Math.PI, speed: 100 };
    const c = planCourse(from, to, R, bare);
    const n = c.n - 1;
    worstM = Math.max(worstM, Math.hypot(c.xs[n] - to.x, c.zs[n] - to.z));
    worstDeg = Math.max(worstDeg, Math.abs(wrap(c.hs[n] - to.heading)) * DEG);
    if (c.total < Math.hypot(to.x - from.x, to.z - from.z) - 1e-6) shorter++;
    words.set(c.word, (words.get(c.word) ?? 0) + 1);
  }
  ok(worstM < 0.5 && worstDeg < 0.5, `over a thousand poses drawn at random, the shortest path ends where it was asked to (${worstM.toExponential(1)} m and ${worstDeg.toExponential(1)} degrees at the worst)`);
  ok(shorter === 0, 'and no path is shorter than the straight line between its ends');
  ok(words.size >= 5, `all but a word or two of the six are chosen somewhere among them (${[...words].map(([w, k]) => `${w} ${k}`).join(', ')})`);
  // Close together and facing apart: two turns and a straight cannot do it, three turns can.
  const close = dubins(0, 0, 0, 50, 0, Math.PI, 300);
  ok(!!close && (close.word === 'LRL' || close.word === 'RLR'), `two poses 50 m apart facing opposite ways take three turns (${close?.word})`);
  ok(dubins(Number.NaN, 0, 0, 1, 1, 0, 100) === null, 'and a pose that is not a number has no path');
}

// ---------------------------------------------------------------- a course

{
  const from: RideState = { x: 120, y: 60, z: -40, heading: 0.4, speed: 110, ground: 20 };
  const join: RideState = { x: 3200, y: 140, z: 1900, heading: 2.2, speed: 90, descent: 0.4, ground: 13 };
  const c = planCourse(from, join, planRadius(150, RIG_HULL_TUNE.turnRate), RIDE_PILOT);
  let gap = 0;
  let rising = true;
  for (let i = 1; i < c.n; i++) {
    gap = Math.max(gap, Math.hypot(c.xs[i] - c.xs[i - 1], c.zs[i] - c.zs[i - 1]));
    if (!(c.ss[i] > c.ss[i - 1])) rising = false;
  }
  ok(gap <= RIDE_PILOT.step + 1e-6 && rising, `a course is sampled no more than ${RIDE_PILOT.step} m apart (${f2(gap)} at the most), always going on`);
  ok(Math.hypot(c.xs[0] - from.x, c.zs[0] - from.z) < 1e-9 && Math.hypot(c.xs[c.n - 1] - join.x, c.zs[c.n - 1] - join.z) < 0.5, 'it starts where the hull was let go and ends at the join');
  let offLine = 0;
  let offHeading = 0;
  for (let i = c.finalFrom; i < c.n; i++) {
    const rx = c.xs[i] - join.x;
    const rz = c.zs[i] - join.z;
    offLine = Math.max(offLine, Math.abs(rx * Math.cos(join.heading) - rz * Math.sin(join.heading)));
    offHeading = Math.max(offHeading, Math.abs(wrap(c.hs[i] - join.heading)));
  }
  ok(c.total - c.ss[c.finalFrom] > RIDE_PILOT.finalLen - 1 && offLine < 0.5 && offHeading < 1e-3, `and it comes in down the join's own line for its last ${RIDE_PILOT.finalLen} m (${f2(offLine)} m off it at the most)`);
  let offOut = 0;
  for (let i = 0; i < Math.ceil(RIDE_PILOT.departStraight / RIDE_PILOT.step); i++) offOut = Math.max(offOut, Math.abs((c.xs[i] - from.x) * Math.cos(from.heading) - (c.zs[i] - from.z) * Math.sin(from.heading)));
  ok(offOut < 1e-9, 'having gone straight on the way it was let go for the first of it');
  ok(c.seedGround === 20 && c.cutY === 60, 'ground not yet read counts as the higher of the two pads until some is');
  ok(Math.abs(planRadius(150, 0.6) - 375) < 1e-9, `the turns are planned at ${f1(planRadius(150, 0.6))} m at cruise with the rig hull's own turn`);
}

// ---------------------------------------------------------------- the flight model the flights are copies of

{
  // Every flight below, and the passenger's in `shuttleRide.test.ts`, flies a copy of flyShip's own speed
  // and turn integration (`flyCourse` in courseFixtures.ts, `FakeHull.step`), because node cannot load
  // vehicle.ts; and the copies read the rig hull's handling straight out of `RIG_HULL_TUNE`, which the
  // garage writes over a rig hull's spec. The lines the copies stand on are read here out of vehicle.ts
  // and garage.ts: one of them changed there fails this, and the copies must change with it.
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const vehicle = read('../../../src/vehicles/vehicle.ts');
  const garage = read('../../../src/vehicles/garage.ts');
  const flight = [
    // An autopilot's asked-for speed, eased at the engines' own rates within the top speed.
    'this.cruise = this.cruise < want ? Math.min(want, this.cruise + s.accel * dt) : Math.max(want, this.cruise - s.brake * dt);',
    // The stick held where the drive puts it, and the rates it asks for about the hull's own axes.
    'stick.set(THREE.MathUtils.clamp(drive.stickX, -1, 1), THREE.MathUtils.clamp(drive.stickY ?? 0, -1, 1));',
    'const wantYaw = -stick.x * rate * 1.5;',
    'const wantPitch = stick.y * rate * 1.5',
    'const wantRoll = (drive?.steer ?? 0) * rate * 1.6;',
    // Those rates eased in over the hull's inertia, the roll twice as quickly.
    'const ease = Math.min(1, dt / Math.max(0.05, s.inertia ?? 0.5));',
    'const easeRoll = Math.min(1, (2 * dt) / Math.max(0.05, s.inertia ?? 0.5));',
    'spin.y += (wantYaw - spin.y) * ease;',
    'spin.x += (wantPitch - spin.x) * ease;',
    'spin.z += (wantRoll - spin.z) * easeRoll;',
    // And the hull moved along its nose, +Z, at its cruise.
    'fwd.set(0, 0, 1).applyQuaternion(a);',
    'tmp.copy(fwd).multiplyScalar(this.cruise);',
  ];
  const lost = flight.filter((l) => !vehicle.includes(l));
  ok(lost.length === 0, `the flight model the course's flights copy is still vehicle.ts's own, line for line (${lost.length ? `changed there: ${lost.join(' | ')}; change flyCourse and FakeHull.step with it` : `${flight.length} lines`})`);
  const turns = ['AXIS_Y, yawDelta', 'AXIS_X, pitchDelta', 'AXIS_Z, rollDelta'].map((axis) => vehicle.indexOf(`a.multiply(qTmp.setFromAxisAngle(${axis}))`));
  ok(turns.every((i) => i >= 0) && turns[0] < turns[1] && turns[1] < turns[2], `and it turns the hull by yaw, then pitch, then roll, as the copies do (${turns.join(', ')})`);
  const spec = ['maxSpeed', 'boostSpeed', 'accel', 'brake', 'turnRate', 'inertia'].filter((k) => !garage.includes(`spec.${k} = RIG_HULL_TUNE.${k};`));
  ok(spec.length === 0, `and a rig hull's handling is RIG_HULL_TUNE's, which the copies read (${spec.length ? `not written by the garage: ${spec.join(', ')}` : 'all six written by the garage'})`);
}

// ---------------------------------------------------------------- every pair of rigged pads, on flat ground

{
  const pairs = rigPairs();
  if (!pairs.length) note('no converted world carries rigged shuttle pads, so the pairs are not flown: npm run swg -- travel @SWG assets-private --retail-only');
  else {
    // Flat about each pad: every point stands at the height of the pad it is nearer to.
    const flatAbout = (p: RigPair) => (x: number, z: number) => (Math.hypot(x - p.from.x, z - p.from.z) < Math.hypot(x - p.to.x, z - p.to.z) ? p.from.y : p.to.y);
    const flights = pairs.map((p) => ({ p, f: flyCourse(p, flatAbout(p)) }));
    const missed = flights.filter(({ f }) => !f.joined || Math.abs(f.error.across) > 5 || Math.abs(f.error.up) > 8 || f.error.heading > 10);
    const q = (k: 'across' | 'up' | 'heading') => flights.map(({ f }) => Math.abs(f.error[k]));
    ok(
      missed.length === 0,
      `every one of ${pairs.length} pairs of rigged pads meets its join on flat ground within 5 m across, 8 m up and 10 degrees (the worst ${f2(quantile(q('across'), 1))} m, ${f2(quantile(q('up'), 1))} m and ${f2(quantile(q('heading'), 1))}°)${missed.length ? `; missed: ${missed.slice(0, 5).map(({ p, f }) => `${p.label} ${f1(f.error.across)}/${f1(f.error.up)}/${f1(f.error.heading)}`).join('; ')}` : ''}`,
    );
    note(`flown in ${f1(quantile(flights.map(({ f }) => f.seconds), 0.5))} s at the median and ${f1(quantile(flights.map(({ f }) => f.seconds), 1))} s at the most, ${flights.filter(({ f }) => f.goArounds).length} flown round again, never more than ${f1(quantile(flights.map(({ f }) => f.offCourse), 1))} m off the course`);
    const nearest = flights.reduce((a, b) => (b.f.straight < a.f.straight ? b : a));
    ok(nearest.f.course > 10 * nearest.f.straight, `the two pads nearest each other (${nearest.p.label}, ${f1(nearest.f.straight)} m from cut to join) are flown a course more than ten times as long (${f1(nearest.f.course)} m)`);

    // It settles rather than sways. Over the last 30 s before each join the stick changes sides a
    // handful of times at the most on either axis, the hull goes from climbing to sinking or back a few
    // times at the most, and it never dives past the steepest the pilot may ask for by more than a
    // couple of degrees. The hand that read the error alone (`errorLead` 0) is flown the same way beside
    // it and must fail the same bounds, or they would not be measuring the sway at all: through the rig
    // hull's 1.2 s of lag it swung about its line and its height every four seconds, the stick changing
    // sides every two, and dived past a drop in the height law by up to eight degrees too steep.
    const sway = (fs: { f: Flight }[]) => ({
      x: fs.map(({ f }) => f.flipsX),
      y: fs.map(({ f }) => f.flipsY),
      turns: fs.map(({ f }) => f.heightTurns),
      dive: fs.map(({ f }) => f.diveOver),
    });
    const BOUND = { flips: 8, flipsP90: 4, turns: 5, dive: 2 };
    const within = (s: ReturnType<typeof sway>) =>
      quantile(s.x, 1) <= BOUND.flips && quantile(s.y, 1) <= BOUND.flips && quantile(s.x, 0.9) <= BOUND.flipsP90 && quantile(s.y, 0.9) <= BOUND.flipsP90 && quantile(s.turns, 1) <= BOUND.turns && quantile(s.dive, 1) <= BOUND.dive;
    const said = (s: ReturnType<typeof sway>) =>
      `stick sides changed ${f1(quantile(s.x, 0.9))}/${f1(quantile(s.x, 1))} across and ${f1(quantile(s.y, 0.9))}/${f1(quantile(s.y, 1))} up (p90/most), climb turned ${f1(quantile(s.turns, 1))} times at most, dived ${f1(quantile(s.dive, 1))}° past the steepest allowed`;
    const now = sway(flights);
    ok(within(now), `over the last ${SWAY.window} s before its join no flight sways: ${said(now)} (bounds: ${BOUND.flips} sides, ${BOUND.flipsP90} at p90, ${BOUND.turns} turns, ${BOUND.dive}°)`);
    const lead = RIDE_PILOT.errorLead;
    RIDE_PILOT.errorLead = 0;
    let old: ReturnType<typeof sway>;
    try {
      old = sway(pairs.map((p) => ({ p, f: flyCourse(p, flatAbout(p)) })));
    } finally {
      RIDE_PILOT.errorLead = lead;
    }
    ok(!within(old), `while the hand that read the error alone fails the same bounds: ${said(old)}`);
  }
}

// ---------------------------------------------------------------- over a ridge

{
  // A wall of ground across the whole way, 500 m high with faces at 40 degrees, whose far foot is a
  // kilometre short of the join: it is gone over, and never into.
  const slope = Math.tan((40 * Math.PI) / 180);
  const rise = 7300;
  const top = rise + 500 / slope;
  const fall = top + 600;
  const foot = fall + 500 / slope;
  const ridge = (_x: number, z: number) => (z < rise || z > foot ? 0 : z < top ? (z - rise) * slope : z < fall ? 500 : (foot - z) * slope);
  const pad = (z: number): PadRef => ({ pack: 'test', key: 'k', index: 0, port: 'p', clock: 'c', times: { land: 20, lift: 20 }, x: 0, y: 0, z, yaw: 0, cell: 0, building: 'b', rig: 'r', mood: '', collector: null });
  const joinZ = foot + 1000;
  const p: RigPair = {
    pack: 'test',
    from: pad(-500),
    to: pad(joinZ + 500),
    label: 'over a ridge',
    cut: { pos: new THREE.Vector3(0, 60, 0), quat: new THREE.Quaternion(), speed: 100 },
    join: { x: 0, y: 127, z: joinZ, heading: 0, speed: 91, descent: 0.5, ground: 0 },
  };
  const f = flyCourse(p, ridge, { padNear: 0 });
  ok(f.under === 0 && f.minClear > 0, `a 500 m ridge at 40 degrees on the way is gone over and never into (${f1(f.minClear)} m clear at the least)`);
  ok(f.joined && Math.abs(f.error.up) < 250 && Math.abs(f.error.across) < 5, `and the join a kilometre past its foot is still met (${f1(f.error.up)} m up, ${f1(f.error.across)} m across)`);
}

// ---------------------------------------------------------------- straight in, from a crossing down

{
  // A start on the landing's own line and facing down it is flown straight in on the glide from where it
  // is, whatever the distance: a course of one straight, all of it the final one, no turn at all.
  const join: RideState = { x: 500, y: 140, z: 800, heading: 0.9, speed: 91, descent: 0.52, ground: 13 };
  const back = 700;
  const from: RideState = { x: join.x - Math.sin(0.9) * back, y: join.y + back * Math.tan((6 * Math.PI) / 180), z: join.z - Math.cos(0.9) * back, heading: 0.9, speed: 150 };
  const c = planCourse(from, join, planRadius(150, RIG_HULL_TUNE.turnRate), RIDE_PILOT);
  let turn = 0;
  for (let i = 1; i < c.n; i++) turn += Math.abs(wrap(c.hs[i] - c.hs[i - 1]));
  ok(c.word === 'S' && c.finalFrom === 0 && Math.abs(c.total - back) < 1e-6 && turn < 1e-9, `a start on the landing's own line, ${back} m out, is one straight run in with no turn (${c.word}, ${f1(c.total)} m), where a gate ${RIDE_PILOT.finalLen} m out would stand behind it`);
  ok(Math.abs(c.xs[0] - from.x) < 1e-9 && Math.abs(c.xs[c.n - 1] - join.x) < 1e-9 && Math.abs(c.zs[c.n - 1] - join.z) < 1e-9 && Math.abs(c.glide - (6 * Math.PI) / 180) < 1e-9, `from where it starts to the join, on the glide it starts on (${f2((c.glide * 180) / Math.PI)}°)`);
  // Off the line, or facing across it, it is the ordinary course of turns.
  const off = planCourse({ ...from, x: from.x + Math.cos(0.9) * (RIDE_PILOT.straightIn.across + 5), z: from.z - Math.sin(0.9) * (RIDE_PILOT.straightIn.across + 5) }, join, planRadius(150, RIG_HULL_TUNE.turnRate), RIDE_PILOT);
  const across = planCourse({ ...from, heading: 0.9 + ((RIDE_PILOT.straightIn.heading + 2) * Math.PI) / 180 }, join, planRadius(150, RIG_HULL_TUNE.turnRate), RIDE_PILOT);
  ok(off.word !== 'S' && off.glide === 0 && across.word !== 'S', `and a start ${RIDE_PILOT.straightIn.across + 5} m off it, or turned ${RIDE_PILOT.straightIn.heading + 2}° across it, is planned the ordinary way (${off.word}, ${across.word})`);
}

{
  // Every rigged pad a ticket can land on, with every landing a hull can bring to it, from where the
  // crossing down onto it comes out, as the ride works that out -- at the usual reach, and at the least
  // the reach is ever let fall to: flown in by the pilot through flyShip's own integration on ground flat
  // about the pad, each is one straight run in, no longer than 15% over the straight line, turning no more
  // than 90 degrees in all as planned or as flown, never diving steeper than its glide and two, and meeting
  // its join within the pilot's own tolerance. The old way out of a crossing down (700 m over the pad, a
  // kilometre and a half back along the way in from the pad) is flown the same way beside it and must fail:
  // it dived and flew a whole circle before running in.
  const tol = RIDE_PILOT.joinTol;
  for (const reach of [RIDE_TUNE.downReach, RIDE_TUNE.downReachMin]) {
    const arrivals = rigArrivals(undefined, reach);
    if (!arrivals.length) {
      note('no converted world carries rigged shuttle pads, so the crossings down are not flown: npm run swg -- travel @SWG assets-private --retail-only');
      break;
    }
    const flights = arrivals.map((p) => ({ p, f: flyCourse(p, () => p.to.y, { startGround: undefined }) }));
    const bad = flights.filter(({ p, f }) => !(f.joined && Math.abs(f.error.across) <= tol.across && Math.abs(f.error.up) <= tol.up && f.error.heading <= tol.heading) || f.course > 1.15 * f.straight || f.courseTurn > 90 || f.flownTurn > 90 || f.steepest > p.glide + 2);
    const most = (k: (x: (typeof flights)[number]) => number) => f1(quantile(flights.map(k), 1));
    ok(
      bad.length === 0,
      `every one of ${flights.length} crossings down (${reach} m out) runs straight in and meets its join: course at most ${most(({ f }) => f.course / f.straight)}x the straight line, turned at most ${most(({ f }) => f.courseTurn)}° planned and ${most(({ f }) => f.flownTurn)}° flown, dived at most ${most(({ f }) => f.steepest)}°, at the join ${most(({ f }) => Math.abs(f.error.across))} m across, ${most(({ f }) => Math.abs(f.error.up))} m up and ${most(({ f }) => f.error.heading)}°${bad.length ? `; not: ${bad.slice(0, 4).map(({ p, f }) => `${p.label} ${f.word} ${f1(f.course)}/${f1(f.straight)} m, ${f1(f.courseTurn)}°, ${f.joined ? `${f1(f.error.up)} m up` : 'never joined'}`).join('; ')}` : ''}`,
    );
  }
  const old = rigArrivals().map((p) => {
    // As it was: `downReach` back from the pad (not the join) along the way in, 700 m over the pad, facing the join.
    const dx = Math.sin(p.join.heading);
    const dz = Math.cos(p.join.heading);
    const at = new THREE.Vector3(p.to.x - dx * RIDE_TUNE.downReach, p.to.y + 700, p.to.z - dz * RIDE_TUNE.downReach);
    const q = lookRotation([p.join.x - at.x, p.join.y - at.y, p.join.z - at.z]);
    return flyCourse({ ...p, cut: { pos: at, quat: new THREE.Quaternion(q[0], q[1], q[2], q[3]), speed: p.cut.speed } }, () => p.to.y, { startGround: undefined });
  });
  if (old.length) ok(old.some((f) => f.courseTurn > 270 && f.course > 2 * f.straight), `while the old way out of a crossing down flies a circle into some pads (turned up to ${f1(quantile(old.map((f) => f.courseTurn), 1))}°, up to ${f1(quantile(old.map((f) => f.course / f.straight), 1))}x the straight line)`);
}

// ---------------------------------------------------------------- a step makes nothing

{
  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
  const bodyOf = (src: string, name: string, method: boolean): string | null => {
    let open: number;
    if (method) {
      const at = new RegExp(`\\n  (?:private )?${name}\\([^\\n]*\\{\\n`).exec(src);
      if (!at) return null;
      open = at.index + at[0].length - 2;
    } else {
      const at = new RegExp(`\\n(?:export )?function ${name}\\(`).exec(src);
      if (!at) return null;
      let i = at.index + at[0].length;
      for (let depth = 1; depth > 0 && i < src.length; i++) depth += src[i] === '(' ? 1 : src[i] === ')' ? -1 : 0;
      open = src.indexOf('{', i);
    }
    let end = open + 1;
    for (let depth = 1; depth > 0 && end < src.length; end++) depth += src[end] === '{' ? 1 : src[end] === '}' ? -1 : 0;
    return src.slice(open, end);
  };
  const course = read('../../../src/world/shuttleCourse.ts');
  const pilot = read('../../../src/space/pilot.ts');
  const frame: [string, string, boolean][] = [
    ...['step', 'readGround', 'heightAt', 'noteObstacle', 'noteShip', 'climbOver', 'steer', 'resetHand', 'climbStep', 'toward', 'along', 'noteShipInSpace', 'spaceStep', 'coast'].map((n) => [course, n, true] as [string, string, boolean]),
    [course, 'indexAt', false],
    ...['pushApart', 'unit', 'steerToward', 'skillStick', 'toLocal', 'toWorld', 'rotate'].map((n) => [pilot, n, false] as [string, string, boolean]),
  ];
  const makers: [RegExp, string][] = [
    [/\bnew\b/, 'a constructor call'],
    [/=>/, 'an arrow function'],
    [/\.\.\./, 'a spread'],
    [/=\s*\{/, 'an object literal'],
    [/=\s*\[/, 'an array literal'],
    [/return\s*[{[]/, 'a literal returned'],
    [/[(,]\s*[{[]/, 'a literal passed'],
    [/\.(map|filter|slice|concat|split|join|reduce|sort|from|clone|keys|values|entries)\s*\(/, 'a method that makes an array or a copy'],
    [/`/, 'a template literal'],
  ];
  const missing = frame.filter(([src, n, m]) => !bodyOf(src, n, m)).map(([, n]) => n);
  ok(missing.length === 0, `every function a step of the pilot runs is found to be read (${frame.length}; missing: ${missing.join(', ') || 'none'})`);
  for (const [pattern, what] of makers) {
    const hit = frame.map(([src, n, m]) => ({ n, b: bodyOf(src, n, m) ?? '' })).find(({ b }) => pattern.test(b));
    ok(!hit, `none of them makes ${what}${hit ? ` (in ${hit.n})` : ''}`);
  }

  const g = (globalThis as { gc?: () => void }).gc;
  if (!g) note('what twenty thousand steps allocate is not measured: run with node --expose-gc');
  else {
    const from: RideState = { x: 0, y: 60, z: 0, heading: 0.3, speed: 150, ground: 0 };
    const join: RideState = { x: 4000, y: 120, z: 5000, heading: -1.2, speed: 90, descent: 0.4, ground: 0 };
    const pilot = new ShuttlePilot();
    pilot.setCourse(planCourse(from, join, planRadius(150, RIG_HULL_TUNE.turnRate), RIDE_PILOT), 150);
    const pos = new THREE.Vector3(0, 60, 0);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);
    const ship = new THREE.Vector3(30, 70, 200);
    const shipVel = new THREE.Vector3(0, 0, -120);
    const selfVel = new THREE.Vector3(0, 0, 150);
    const ground = (x: number, z: number) => 10 * Math.sin(x * 0.001) + 5 * Math.cos(z * 0.002);
    function run(n: number): void {
      for (let i = 0; i < n; i++) {
        pilot.noteShip(ship, shipVel, 20, pos, selfVel, 22);
        pilot.noteObstacle(80, i / 30);
        pilot.step(1 / 30, i / 30, pos, turn, 150, ground);
      }
    }
    // Warmed until the engine has compiled it for good: before that, every number the interpreter
    // works out is a box of its own, and what is measured is the engine and not the pilot.
    run(60000);
    // What twenty thousand steps leave behind once collected: nothing kept a step grows.
    g();
    const before = process.memoryUsage().heapUsed;
    run(20000);
    g();
    const kept = process.memoryUsage().heapUsed - before;
    ok(kept < 64 * 1024, `twenty thousand steps of the pilot, each weighing a ship and an obstacle, leave the heap less than 64 KB bigger (${kept} bytes)`);
    // And what a step makes at all, read off the young generation straight after a stretch with no
    // collection between. A scavenge inside a stretch reads low rather than high, and whether one falls
    // there turns on how big the young generation happens to be (a stretch of thousands of steps that
    // write out the report is megabytes, which a small one scavenges half way through), so the stretches
    // are short -- a couple of hundred steps, well inside the smallest young generation even with the
    // report written every step -- and the most any of several read is taken. The engine boxes numbers
    // of its own as they cross into calls it did not inline -- the NPC pilots' own stick arithmetic that
    // every ship's brain runs does, measured at 70 to 100 bytes a call -- which comes to a few hundred
    // bytes a step and is not ours to count; the limit is the ride's own (`shuttleRide.test.ts`), and a
    // stretch that also writes out the report is here to show the reading can fail.
    const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
    const STRETCH = 200;
    const perStep = (work: (n: number) => void): number => {
      let most = -Infinity;
      for (let round = 0; round < 8; round++) {
        g();
        const start = young();
        work(STRETCH);
        most = Math.max(most, (young() - start) / STRETCH);
      }
      return most;
    };
    const sink = { junk: '' };
    function runJunk(n: number): void {
      for (let i = 0; i < n; i++) {
        pilot.step(1 / 30, i / 30, pos, turn, 150, ground);
        sink.junk = JSON.stringify(pilot.report());
      }
    }
    runJunk(20000);
    const step = perStep(run);
    const junk = perStep(runJunk);
    const LIMIT = 1024;
    ok(step < LIMIT, `a step makes next to nothing of its own (${f1(step)} bytes, under ${LIMIT})`);
    ok(junk > LIMIT, `while a step that also wrote out the report would show (${f1(junk)} bytes)`);
    // The climb and the flight in space, the same way.
    const climb = planClimb(from, 0.3, 1250, 20);
    const far = { x: 8000, y: 500, z: -3000 };
    // A step of one or the other, turn about: each is a step of the pilot on its own.
    function runSpace(n: number): void {
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) pilot.climbStep(1 / 30, i / 30, pos, turn, 150, climb, 150, ground);
        else {
          pilot.toward(pos, far);
          pilot.noteShipInSpace(ship, shipVel, 20, pos, selfVel, 22);
          pilot.spaceStep(1 / 30, i / 30, turn, 150, 300);
        }
      }
    }
    runSpace(60000);
    const space = perStep(runSpace);
    ok(space < LIMIT, `a step of the climb or of a flight in space makes next to nothing of its own (${f1(space)} bytes, under ${LIMIT})`);
  }
}

// ---------------------------------------------------------------- out of the sky and through space

/**
 * A hull flown by the hand alone, as flyShip flies one (the turn rates eased toward the stick's over the
 * rig hull's inertia, the roll twice as fast, straight on along the nose at its cruise), with nothing
 * about the ground: what the climb and a flight in space are flown through here.
 */
function handFlight(pilot: ShuttlePilot, pos: THREE.Vector3, turn: THREE.Quaternion, seconds: number, each: (t: number, cruise: number) => void): { rolled: number; cruise: number } {
  const dt = 1 / 30;
  const spin = new THREE.Vector3();
  const by = new THREE.Quaternion();
  const d = pilot.drive;
  let cruise = 150;
  let rolled = 0;
  for (let t = 0; t < seconds; t += dt) {
    each(t, cruise);
    const rate = RIG_HULL_TUNE.turnRate;
    const ease = Math.min(1, dt / RIG_HULL_TUNE.inertia);
    spin.y += (-d.stickX * rate * 1.5 - spin.y) * ease;
    spin.x += (d.stickY * rate * 1.5 - spin.x) * ease;
    spin.z += (d.steer * rate * 1.6 - spin.z) * Math.min(1, (2 * dt) / RIG_HULL_TUNE.inertia);
    turn.multiply(by.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin.y * dt));
    turn.multiply(by.setFromAxisAngle(new THREE.Vector3(1, 0, 0), spin.x * dt));
    turn.multiply(by.setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin.z * dt));
    turn.normalize();
    rolled = Math.max(rolled, Math.abs(d.steer));
    cruise = cruise < d.cruise ? Math.min(d.cruise, cruise + RIG_HULL_TUNE.accel * dt) : Math.max(d.cruise, cruise - RIG_HULL_TUNE.brake * dt);
    pos.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(turn), cruise * dt);
  }
  return { rolled, cruise };
}

{
  // The climb out of the sky: on along the heading it was let go on, nose up at its angle, wings level;
  // and steeper where the ground ahead rises faster than that.
  const from: RideState = { x: 0, y: 190, z: 0, heading: 1.1, speed: 150 };
  const out = { heading: 0, pitch: 0, toY: 0, run: 0 };
  const climb = planClimb(from, 1.1, 1250, 20, out);
  ok(climb === out && Math.abs(climb.pitch - (20 * Math.PI) / 180) < 1e-12 && Math.abs(climb.run - 1060 / Math.tan((20 * Math.PI) / 180)) < 1e-9 && climb.toY === 1250, `a climb is planned at its angle to its height, written into what it is handed (${f1(climb.run)} m over the ground)`);
  // The ground flat, or rising at 30 degrees -- faster than the climb -- from 600 m ahead on.
  const along = (x: number, z: number) => x * Math.sin(1.1) + z * Math.cos(1.1);
  for (const [what, ground] of [['flat ground', () => 0], ['ground rising at 30 degrees ahead', (x: number, z: number) => Math.max(0, along(x, z) - 600) * Math.tan(Math.PI / 6)]] as const) {
    const pilot = new ShuttlePilot();
    pilot.resetHand();
    const pos = new THREE.Vector3(from.x, from.y, from.z);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1);
    let gamma = 0;
    let steepest = 0;
    let heading = 0;
    let lowest = Infinity;
    const flown = handFlight(pilot, pos, turn, 40, (t, cruise) => {
      pilot.climbStep(1 / 30, t, pos, turn, cruise, climb, 150, ground);
      const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
      gamma = Math.asin(nose.y) * DEG;
      steepest = Math.max(steepest, gamma);
      heading = Math.atan2(nose.x, nose.z);
      lowest = Math.min(lowest, pos.y - ground(pos.x, pos.z));
    });
    if (what === 'flat ground') ok(Math.abs(gamma - 20) < 1.5 && steepest < 21.5 && Math.abs(wrap(heading - 1.1)) * DEG < 1.5 && flown.rolled < 0.05, `over ${what} it climbs at ${f1(gamma)} degrees on its heading (${f1(Math.abs(wrap(heading - 1.1)) * DEG)} degrees off), wings level`);
    else ok(steepest > 25 && lowest > RIDE_PILOT.floor * 0.5, `over ${what} it climbs more steeply (up to ${f1(steepest)} degrees) and keeps over it (${f1(lowest)} m clear at the lowest)`);
  }
  // Taken over banked, as a take-off's cut can leave a hull: the climb rolls its wings back to level
  // (measured as how far its right wing stands out of the level) and keeps them there.
  const pilot = new ShuttlePilot();
  pilot.resetHand();
  const pos = new THREE.Vector3(from.x, from.y, from.z);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (20 * Math.PI) / 180));
  const bank = () => Math.abs(Math.asin(THREE.MathUtils.clamp(new THREE.Vector3(1, 0, 0).applyQuaternion(turn).y, -1, 1))) * DEG;
  const banked = bank();
  let firstSteer = 0;
  let levelBy = Infinity;
  let worstAfter = 0;
  handFlight(pilot, pos, turn, 20, (t, cruise) => {
    pilot.climbStep(1 / 30, t, pos, turn, cruise, climb, 150, () => 0);
    if (t === 0) firstSteer = pilot.drive.steer;
    const b = bank();
    if (b < 2 && levelBy === Infinity) levelBy = t;
    if (t > 8) worstAfter = Math.max(worstAfter, b);
  });
  ok(Math.abs(banked - 20) < 1e-6 && firstSteer !== 0 && levelBy < 8 && worstAfter < 2, `taken over banked ${f1(banked)} degrees, the climb rolls its wings level (under 2 degrees by ${f1(levelBy)} s, at most ${f1(worstAfter)} after 8 s)`);
}

{
  // In space: the nose onto a point behind it, with yaw and pitch alone and never a roll; and a ship
  // coming straight at it bends the way it goes.
  const pilot = new ShuttlePilot();
  pilot.resetHand();
  const pos = new THREE.Vector3(0, 0, 0);
  const turn = new THREE.Quaternion();
  const at = { x: -30000, y: 8000, z: -60000 };
  let off = 180;
  const flown = handFlight(pilot, pos, turn, 30, (t, cruise) => {
    pilot.toward(pos, at);
    pilot.spaceStep(1 / 30, t, turn, cruise, 300);
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
    off = nose.angleTo(new THREE.Vector3(at.x - pos.x, at.y - pos.y, at.z - pos.z)) * DEG;
  });
  ok(off < 3 && flown.rolled === 0 && Math.abs(flown.cruise - 300) < 1, `in space it turns its nose onto a point behind it (${f1(off)} degrees off after 30 s) with no roll at all, at the space cruise`);
  const a = new ShuttlePilot();
  const b = new ShuttlePilot();
  const q = new THREE.Quaternion();
  const here = { x: 0, y: 0, z: 0 };
  a.toward(here, { x: 0, y: 0, z: 5000 });
  b.toward(here, { x: 0, y: 0, z: 5000 });
  b.noteShipInSpace({ x: 0, y: 0, z: 150 }, { x: 0, y: 0, z: -200 }, 30, here, { x: 0, y: 0, z: 300 }, 30);
  a.spaceStep(1 / 30, 0, q, 300, 300);
  b.spaceStep(1 / 30, 0, q, 300, 300);
  ok(a.drive.stickX === 0 && a.drive.stickY === 0 && (b.drive.stickX !== 0 || b.drive.stickY !== 0), 'a ship coming straight at it bends the way it goes, where nothing else would turn it');
  b.coast(120);
  ok(b.drive.stickX === 0 && b.drive.stickY === 0 && b.drive.steer === 0 && b.drive.cruise === 120 && b.drive.throttle === 0, 'let go of, the stick is in the middle and the cruise is what it is handed');
}

console.log(`\nshuttle course: ${passed} checks passed`);
