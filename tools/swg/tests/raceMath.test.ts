// The race drive's arithmetic (src/vehicles/raceMath.ts) and its numbers (src/vehicles/raceTune.ts), pure.
//
// What each shape does at the numbers the game ships, at the three frame rates the game is played at, and the rules
// that hold whatever the numbers are: the curve reaches three-quarters of its top when the table says, the boost is
// half on at its half-time and gone soon after it is let go, the travel lags the nose by its own time constant at any
// frame rate, the turn comes on and unwinds at its rates, the upgrades resolve to the stock table to the bit at level
// nought, a speed shared out again sums to itself, the two measures split a scrape from a crash at the angles the
// design names, the ground ahead is read once a lattice point, the bridge fills a pit narrower than its window to the
// lower rim and invents nothing, the strike's kick and the climbing judge read the ground the way they should, the
// fall planned over the physics' fixed steps lands on the parabola, and the slope's push is the share it says. The
// bridge over real pits, flown by the drive itself, is `raceDrive.test.ts`'s.
//
// Nothing here is game data: every number is the tune's own or invented for the test.
import assert from 'node:assert/strict';
import {
  BASE_KEYS,
  BAND,
  FALL,
  HIT_CRASH,
  HIT_NONE,
  HIT_SCRAPE,
  LatticeRing,
  RISE,
  SPEED_KEYS,
  VERTICAL_KEYS,
  boostFor,
  boostOf,
  bridgeClose,
  bridgedBetweenOf,
  climbAllowed,
  climbVerdict,
  closedAt,
  closedBetween,
  copyBase,
  faceVerdict,
  fallDisplacement,
  hitVerdict,
  lagBlend,
  levelsAt,
  lineFrom,
  lineRateOf,
  newBase,
  newLineWalk,
  newSweptPath,
  newLooseStep,
  planFall,
  resolveRace,
  scaleSpeeds,
  shareSpeed,
  slopePush,
  speedOf,
  stepLooseOf,
  stepVertical,
  stepYawRate,
  strikeKick,
  thrustA,
  thrustCapOf,
  thrustFor,
  underAheadOf,
  walkLine,
  wrap,
  yawWanted,
  type LineReader,
  type RaceBase,
  type SpeedParts,
} from '../../../src/vehicles/raceMath.ts';
import { BIKE_SCALE, CEILING_LEAST, CEILING_MOST, RACE_BASE, RACE_BIKE_OWN, RACE_BIKE_SIZES, RACE_TUNE, RACE_UPGRADES, baseFor, readRaceHatch, tuneRace } from '../../../src/vehicles/raceTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const r2 = (n: number) => Number(n.toFixed(2));
const RATES = [20, 60, 144] as const;
const TUNE0 = JSON.parse(JSON.stringify(RACE_TUNE)) as typeof RACE_TUNE;
/** The tune back as it ships, after a check that moved it. */
const restore = () => {
  Object.assign(RACE_TUNE, JSON.parse(JSON.stringify(TUNE0)));
};

const POD = RACE_BASE.podracer;
const BIKE = RACE_BASE.speederbike;
const resolved = (base: RaceBase, level: number): RaceBase => resolveRace(base, levelsAt(level), 1, RACE_UPGRADES, newBase());
const KINDS: [string, RaceBase][] = [
  ['stock pod', resolved(POD, 0)],
  ['full pod', resolved(POD, 5)],
  ['stock bike', resolved(BIKE, 0)],
  ['full bike', resolved(BIKE, 5)],
];

// --- 1: the curve ---------------------------------------------------------------------------------------------------
{
  for (const [name, h] of KINDS) {
    const A = thrustA(h.t75);
    const cap = thrustCapOf(A, RACE_TUNE.thrustCap);
    for (const fps of RATES) {
      const dt = 1 / fps;
      // Full throttle from rest, as the drive climbs it: a thrust a second; the crossing of 75% of V read between the
      // two frames either side of it. (That the drive holds its thrust under the cap, and that the speed then settles at
      // the plain top, is the drive's own and is held through it: raceDrive.test.ts, section 19.)
      let T = 0;
      let t = 0;
      let at = Infinity;
      for (let i = 0; i < 60 * fps && at === Infinity; i++) {
        const before = speedOf(T, h.V, A);
        T = Math.min(cap, T + dt);
        const after = speedOf(T, h.V, A);
        if (after >= 0.75 * h.V) at = t + (dt * (0.75 * h.V - before)) / (after - before);
        t += dt;
      }
      ok(near(at, h.t75, 0.01 * h.t75), `1: a ${name}'s curve reaches 75% of V in t75 (${at.toFixed(4)} s against ${h.t75.toFixed(4)}) at ${fps} Hz`);
    }
    ok(near(speedOf(cap, h.V, A), RACE_TUNE.thrustCap * h.V, 1e-9), `1: and at the thrust's cap a ${name}'s curve gives thrustCap of V (${speedOf(cap, h.V, A).toFixed(2)} m/s)`);
    let worst = 0;
    for (const T of [0, 0.01, 0.3, 1, 5, cap]) worst = Math.max(worst, Math.abs(thrustFor(speedOf(T, h.V, A), h.V, A) - T));
    ok(worst < 1e-9, `1: thrustFor(speedOf(T)) round-trips on a ${name} (worst ${worst.toExponential(1)})`);
  }
  // A speed shared out again, after something took some of it, or after the top fell under it.
  const full = resolved(POD, 5);
  const A = thrustA(full.t75);
  const cap = thrustCapOf(A, RACE_TUNE.thrustCap);
  const reverseT = -thrustFor(-full.reverseTop, full.V, A);
  const lowered = { ...full, V: 100 };
  const cases: [string, number, number, number, RaceBase][] = [
    ['the speed left at V', full.V, 0, 0, full],
    ["past V (a 30-degree glance's 136.5 m/s off a 157.8 m/s descent)", 136.5, 20, 0, full],
    ['with a downhill push', 125, 15, 0, full],
    ['with an uphill push', 75, -6, 0, full],
    ['with a boost running', 150, 0, 2, full],
    ['with a part out (V lowered under the speed)', 130, 0, 0, lowered],
  ];
  const parts: SpeedParts = { T: 0, B: 0, p: 0, over: 0 };
  for (const [name, v, p, B, h] of cases) {
    shareSpeed(v, p, B, h, RACE_TUNE.thrustCap, RACE_TUNE.boostHalf, parts);
    const Ah = thrustA(h.t75);
    const capH = thrustCapOf(Ah, RACE_TUNE.thrustCap);
    const sum = speedOf(parts.T, h.V, Ah) + boostOf(parts.B, h.BT, RACE_TUNE.boostHalf) + parts.p + parts.over;
    ok(Number.isFinite(parts.T) && parts.T >= -reverseT && parts.T <= capH + 1e-12 && parts.T >= 0, `1: shareSpeed ${name}: T finite, within its range and never reverse (${parts.T.toFixed(4)})`);
    ok(Math.abs(sum - v) < 1e-9, `1: and the four parts sum to the speed left (${sum.toFixed(9)} against ${v})`);
  }
  // (What the curve cannot hold easing down at the brake is the drive's own: raceDrive.test.ts, section 19.)
  void cap;
}

// --- 2: the boost ---------------------------------------------------------------------------------------------------
{
  const h = resolved(POD, 5);
  for (const fps of RATES) {
    const dt = 1 / fps;
    let B = 0;
    let t = 0;
    let halfAt = Infinity;
    while (t < 3 - 1e-9) {
      const before = boostOf(B, h.BT, RACE_TUNE.boostHalf);
      B += dt;
      const after = boostOf(B, h.BT, RACE_TUNE.boostHalf);
      if (halfAt === Infinity && after >= h.BT / 2) halfAt = t + (dt * (h.BT / 2 - before)) / (after - before);
      t += dt;
    }
    ok(near(halfAt, RACE_TUNE.boostHalf, 0.01 * RACE_TUNE.boostHalf), `2: the boost's curve is half on at boostHalf (${halfAt.toFixed(4)} s) at ${fps} Hz`);
    // (The boost let go of, and gone within half a second, is the drive's own: raceDrive.test.ts, section 19.)
  }
  ok(Math.abs(boostFor(boostOf(1.7, 75, 0.25), 75, 0.25) - 1.7) < 1e-9, '2: boostFor inverts boostOf');
}

// --- 3: the lag -----------------------------------------------------------------------------------------------------
{
  for (const fps of RATES) {
    const dt = 1 / fps;
    const tau = POD.tau;
    // A small angle between the travel and the nose decays as e^(-t/tau): read where it falls to 1/e.
    const a0 = 0.01;
    const u = { x: Math.sin(a0), z: Math.cos(a0) };
    let t = 0;
    let at = Infinity;
    let unit = true;
    for (let i = 0; i < 10 * fps && at === Infinity; i++) {
      const before = Math.atan2(u.x, u.z);
      lagBlend(u, 0, 1, tau, dt);
      unit &&= Math.abs(Math.hypot(u.x, u.z) - 1) < 1e-12;
      const after = Math.atan2(u.x, u.z);
      if (after <= a0 / Math.E) at = t + (dt * Math.log(before / (a0 / Math.E))) / Math.log(before / after);
      t += dt;
    }
    ok(near(at, tau, 0.02 * tau), `3: the travel lags the nose by tau (${at.toFixed(4)} s against ${tau}) at ${fps} Hz`);
    ok(unit, `3: and the blend leaves the travel a unit direction, so the speed it carries is unchanged, at ${fps} Hz`);
  }
}

// --- 4: the yaw rate ------------------------------------------------------------------------------------------------
{
  const h = resolved(POD, 0);
  for (const fps of RATES) {
    const dt = 1 / fps;
    const want = yawWanted(-1, h.maxTurn, RACE_TUNE.deadBand);
    let w = 0;
    let t = 0;
    while (w < want - 1e-9) {
      w = stepYawRate(w, want, h.turnResponse, RACE_TUNE.reverseFactor, false, dt);
      t += dt;
    }
    ok(near(t, h.maxTurn / h.turnResponse, dt + 1e-9), `4: full rate in maxTurn/turnResponse (${t.toFixed(3)} s against ${(h.maxTurn / h.turnResponse).toFixed(3)}) at ${fps} Hz`);
    let back = 0;
    while (w > 0) {
      w = stepYawRate(w, -want, h.turnResponse, RACE_TUNE.reverseFactor, false, dt);
      back += dt;
    }
    ok(near(back, h.maxTurn / h.turnResponse / RACE_TUNE.reverseFactor, dt + 1e-9), `4: and it unwinds reverseFactor times quicker (${back.toFixed(3)} s) at ${fps} Hz`);
  }
  ok(stepYawRate(80, -95, 280, 4, true, 1 / 60) === Math.min(95, 280 / 60) * -1, '4: a stick that changes sides snaps the rate to nought before it builds the other way');
  ok(yawWanted(0.03, 95, RACE_TUNE.deadBand) === 0 && yawWanted(1, 95, 0.04) === -95 && yawWanted(-1, 95, 0.04) === 95, '4: inside the dead band nothing; a full stick right is the whole rate toward a falling heading');
}

// --- 5: the upgrades, the bike and the ceiling ----------------------------------------------------------------------
{
  const stock = resolved(POD, 0);
  const deadFull = resolveRace(POD, levelsAt(5), 0, RACE_UPGRADES, newBase());
  ok(
    BASE_KEYS.every((k) => Object.is(stock[k], deadFull[k])),
    '5: level nought everywhere is the stock table, and condition nought is stock whatever the levels (by Object.is)',
  );
  ok(Object.is(stock.V, POD.V * POD.stockTop) && Object.is(stock.tau, POD.tau) && Object.is(stock.t75, POD.t75), "5: the stock table's top is the base's stock share of V, its times the base's own");
  const full = resolved(POD, 5);
  ok(Object.is(full.V, POD.V * RACE_UPGRADES.top) && Object.is(full.tau, POD.tau * RACE_UPGRADES.traction) && Object.is(full.coolSeconds, POD.coolSeconds * RACE_UPGRADES.cooling), '5: level five is the full table');
  // The owner's two ceilings, written out as the owner gave them (halved after his first ride).
  for (const [name, base, ceiling] of [
    ['pod', POD, 600 / 3.6],
    ['bike', BIKE, 350 / 3.6],
  ] as const) {
    const h = resolved(base, 5);
    const plain = RACE_TUNE.thrustCap * h.V;
    const boosted = plain + boostOf(3, h.BT, RACE_TUNE.boostHalf);
    ok(boosted >= ceiling && Math.abs(h.cap - ceiling) < 1e-9, `5: a full ${name}'s plain reachable top plus 3 s of full boost reaches its ceiling (${boosted.toFixed(2)} >= ${ceiling.toFixed(2)} m/s)`);
  }
  // The bike from the pod.
  const s = BIKE_SCALE;
  ok(
    SPEED_KEYS.every((k) => Object.is(BIKE[k], POD[k] * s)) && VERTICAL_KEYS.every((k) => Object.is(BIKE[k], POD[k] * s)),
    '5: bikeFromPod scales every speed (the vertical ones too) by 350/600',
  );
  ok(['t75', 'coast', 'brake', 'chargeTime', 'boostSeconds', 'coolSeconds', 'tau', 'maxTurn', 'turnResponse', 'bankMax', 'bankEase', 'leanMax', 'riseRate', 'bandRate', 'fall', 'climbGrade', 'stockTop'].every((k) => Object.is(BIKE[k as keyof RaceBase], POD[k as keyof RaceBase])), '5: and keeps every time, rate, angle, share and acceleration');
  ok(BIKE.ride === RACE_BIKE_SIZES.ride && BIKE.band === RACE_BIKE_SIZES.band && BIKE.box.every((n, i) => n === RACE_BIKE_SIZES.box[i]), "5: and keeps the bike's own sizes");
  RACE_TUNE.bike = 'own';
  const own = baseFor('bike', newBase());
  ok(Object.keys(RACE_BIKE_OWN).every((k) => Object.is(own[k as keyof RaceBase], RACE_BIKE_OWN[k as keyof typeof RACE_BIKE_OWN])), "5: bike: 'own' lays the bike's own set over it");
  restore();
  const one = scaleSpeeds(POD, 1, true, newBase());
  ok(BASE_KEYS.every((k) => Object.is(one[k], POD[k])), '5: scaleSpeeds at 1 hands back every value by Object.is');
  // The ceiling knob.
  ok(tuneRace({ ceiling: 1368 }).length === 0 && RACE_TUNE.ceiling === 1368, '5: a ceiling of 1368 km/h is taken with nothing said');
  const said = tuneRace({ ceiling: 1400 });
  ok(RACE_TUNE.ceiling === CEILING_MOST && said.some((w) => /physics engine/.test(w)), `5: 1400 is held at ${CEILING_MOST} with words (${said[0]})`);
  ok(tuneRace({ ceiling: 100 }).length > 0 && RACE_TUNE.ceiling === CEILING_LEAST, `5: and under ${CEILING_LEAST} held there with words`);
  RACE_TUNE.ceiling = 1368;
  RACE_TUNE.ceilingMoves = 'cap';
  const capOnly = baseFor('pod', newBase());
  ok(near(capOnly.cap, 1368 / 3.6, 1e-9) && BASE_KEYS.every((k) => k === 'cap' || Object.is(capOnly[k], POD[k])), "5: ceilingMoves 'cap': only the pod's cap moves");
  RACE_TUNE.ceilingMoves = 'all';
  const all = baseFor('pod', newBase());
  const fullAll = resolveRace(all, levelsAt(5), 1, RACE_UPGRADES, newBase());
  const reach = RACE_TUNE.thrustCap * fullAll.V + boostOf(3, fullAll.BT, RACE_TUNE.boostHalf);
  ok(reach >= 1368 / 3.6 && Object.is(all.riseMax, POD.riseMax) && Object.is(all.fallMax, POD.fallMax), `5: ceilingMoves 'all': a full pod boosting reaches the new ceiling (${reach.toFixed(1)} m/s) and riseMax and fallMax stay the pod's`);
  for (const moves of ['cap', 'all'] as const) {
    RACE_TUNE.ceilingMoves = moves;
    for (const c of [400, 600, 1368]) {
      RACE_TUNE.ceiling = c;
      ok(near(baseFor('bike', newBase()).cap, ((c * 350) / 600) / 3.6, 1e-9), `5: the bike's ceiling is the pod's times 350/600 at ${c} km/h ('${moves}')`);
    }
  }
  restore();
  // The load hatch.
  ok(readRaceHatch(() => '0') && RACE_TUNE.on === false, "5: the hatch with '0' starts the session with the switch off");
  ok(!readRaceHatch(() => null) && !readRaceHatch(() => {
    throw new Error('refused');
  }), '5: with nothing kept, or storage refused, it changes nothing');
  restore();
  void copyBase;
}

// --- 6: scrape or crash ---------------------------------------------------------------------------------------------
{
  const pod = resolved(POD, 5);
  const bike = resolved(BIKE, 5);
  const k = (h: RaceBase) => ({ hitLoss: RACE_TUNE.hitLoss, crashImpact: h.crashImpact, crashDrop: h.crashDrop, crashFrom: h.crashFrom });
  ok(hitVerdict(0, 0, 50, 0, 0, 0, k(pod)) === HIT_CRASH, '6: head on at 50 m/s, a pod crashes');
  // Through a contact with no friction: the part of the velocity into the wall taken away, the rest kept.
  const glance = (speed: number, deg: number, h: RaceBase) => {
    const a = (deg * Math.PI) / 180;
    const vx = speed * Math.sin(a);
    const vz = speed * Math.cos(a);
    return hitVerdict(vx, 0, vz, 0, 0, vz, k(h));
  };
  ok(glance(600 / 3.6, 30, pod) === HIT_SCRAPE && glance(600 / 3.6, 45, pod) === HIT_CRASH, '6: at the pod ceiling, 166.7 m/s, a 30-degree glance is a scrape and 45 a crash');
  ok(glance(350 / 3.6, 30, bike) === HIT_SCRAPE && glance(350 / 3.6, 45, bike) === HIT_CRASH, "6: and a bike's at its 97.2 m/s the same, by its own numbers");
  ok(glance(600 / 3.6, 10, pod) === HIT_SCRAPE, '6: a 10-degree graze is a scrape');
  ok(hitVerdict(0, 0, 50, 0, 0, 50 - RACE_TUNE.hitLoss + 0.5, k(pod)) === HIT_NONE, '6: under hitLoss nothing at all');
}

// --- 7: the steep face and the rise too tall to clear ---------------------------------------------------------------
{
  const h = resolved(POD, 5);
  const lip = RACE_TUNE.lipShare * h.ride;
  /** One crossed point of a face `deg` steep, `height` tall, met by a hull whose lowest point stands at nought. */
  const faceAt = (deg: number, height: number) => {
    const path = newSweptPath(4);
    const g = Math.min(height, h.faceLen * Math.tan((deg * Math.PI) / 180));
    path.g[0] = g;
    path.back[0] = 0;
    path.y[0] = 0;
    path.n = 1;
    return path;
  };
  ok(faceVerdict(faceAt(60, 20), lip, h) > h.climbGrade, '7: a 60-degree face 20 m high met at full speed is a steep wall');
  const kerb = faceAt(80, 3);
  ok(faceVerdict(kerb, lip, h) <= h.climbGrade && strikeKick(kerb, 600 / 3.6, h) > 0, '7: an 80-degree kerb 3 m high is a strike, not a wall');
  ok(faceVerdict(faceAt(30, 60), lip, h) <= h.climbGrade, '7: a 30-degree hill 60 m high is no wall (its grade over faceLen is under climbGrade)');
  const low = faceAt(80, lip * 0.9);
  const high = faceAt(80, lip * 1.2);
  // A face standing under lipMost over the hull's lowest point reads as nothing steep at all; one over it as the face.
  const steep = faceAt(80, 3);
  steep.g[0] = lip * 0.9;
  ok(faceVerdict(low, lip, h) === -Infinity && faceVerdict(high, lip, h) > 0 && faceVerdict(steep, lip, h) === -Infinity, '7: a steep face standing less than the lip over the hull is a strike, more a face judged');
  ok(climbAllowed(-2, 30, h.riseMax) === Infinity && climbAllowed(0, 30, h.riseMax) === Infinity, '7: a rise the line has already lifted the hull over asks nothing');
  // The climbing judge at three frame rates over one stretch of ground: every point judged once, the verdicts the same.
  const grounds: [string, (d: number) => number, boolean][] = [
    ['a 20 m wall', (d) => (d > 400 ? 20 : 0), true],
    ['a 30-degree hill', (d) => (d > 400 ? Math.min(60, (d - 400) * Math.tan(Math.PI / 6)) : 0), true],
    ['a 5-degree hill', (d) => (d > 400 ? Math.min(60, (d - 400) * Math.tan((5 * Math.PI) / 180)) : 0), false],
  ];
  for (const [name, ground, cuts] of grounds) {
    const verdicts: boolean[] = [];
    for (const fps of [144, 60, 20]) {
      const dt = 1 / fps;
      const speed = 150;
      const judged = new Map<number, number>();
      const out = { to: 0, allowed: Infinity, points: 0 };
      let odo = 0;
      let judgedTo = 7.5 + h.climbLen;
      let cut = false;
      const read = (at: number) => {
        const key = Math.round(at * 1000);
        judged.set(key, (judged.get(key) ?? 0) + 1);
        return ground(at);
      };
      while (odo < 380) {
        const travel = speed * dt;
        climbVerdict(read, Math.max(judgedTo, odo + 7.5), odo + 7.5, travel, h.ride, h, h.sweepStep, out);
        judgedTo = out.to;
        if (out.allowed < speed) cut = true;
        odo += travel;
      }
      // On to the face, which the judge sees coming climbLen and more ahead.
      while (odo < 420) {
        const travel = speed * dt;
        climbVerdict(read, Math.max(judgedTo, odo + 7.5), odo + 7.5, travel, h.ride, h, h.sweepStep, out);
        judgedTo = out.to;
        if (out.allowed < speed) cut = true;
        odo += travel;
      }
      let twice = 0;
      for (const n of judged.values()) if (n > 1) twice++;
      ok(twice === 0, `7: ${name}: every ground point judged once at ${fps} Hz (${judged.size} points)`);
      verdicts.push(cut);
    }
    ok(verdicts.every((v) => v === cuts), `7: ${name}: the verdict is the same at 144, 60 and 20 Hz (${cuts ? 'too tall to clear at speed' : 'clears'})`);
  }
}

// --- 8: the walk ahead ----------------------------------------------------------------------------------------------
{
  const h = resolved(POD, 5);
  let farCalls = 0;
  const seen = new Map<string, number>();
  const ground = (x: number, z: number) => 4 * Math.sin(x / 47) + 3 * Math.cos(z / 61);
  const reader: LineReader = {
    near: () => null,
    far: (i, j) => {
      farCalls++;
      const key = `${i},${j}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (!Number.isInteger(i) || !Number.isInteger(j)) throw new Error('read off the lattice');
      return ground(i * 16, j * 16);
    },
    farStep: 16,
    farX: () => 0,
    farZ: () => 0,
  };
  const ring = new LatticeRing(RACE_TUNE.latticeRing);
  const walk = newLineWalk(64);
  const fps = 144;
  const dt = 1 / fps;
  const speed = 165;
  const dir = { x: Math.sin(0.3), z: Math.cos(0.3) };
  let x = 0;
  let z = 0;
  let first = 0;
  let steps = 0;
  let worstRing = 0;
  for (let i = 0; i < 2 * fps; i++) {
    const before = farCalls;
    walkLine(reader, ring, x, z, dir.x, dir.z, speed, { lookAhead: RACE_TUNE.lookAhead, lookMax: h.lookMax, lookStep: h.lookStep }, walk);
    if (i === 0) first = farCalls - before;
    steps++;
    x += dir.x * speed * dt;
    z += dir.z * speed * dt;
  }
  for (const n of seen.values()) worstRing = Math.max(worstRing, n);
  ok(true, `8: the far grid is read only at its lattice points (every call an integer pair: ${seen.size} points)`);
  ok(worstRing === 1, '8: each lattice point read once while it is in the ring');
  ok((farCalls - first) / Math.max(1, steps - 1) <= 1, `8: at 144 Hz at most one far lookup a step on average (${((farCalls - first) / Math.max(1, steps - 1)).toFixed(2)}; ${first} on the first step of a walk across the lattice's rows)`);
  {
    // The first step along the lattice's own rows: at most a dozen (the reach over the lattice's spacing, and the one past).
    const before = farCalls;
    walkLine(reader, new LatticeRing(RACE_TUNE.latticeRing), 0, 0, 0, 1, speed, { lookAhead: RACE_TUNE.lookAhead, lookMax: h.lookMax, lookStep: h.lookStep }, walk);
    const axis = farCalls - before;
    ok(axis <= 12, `8: and at most a dozen on the first step along the lattice (${axis})`);
  }
  // The line's rate from the one walk equals a second walk's: a walk made from where the hull will be `feedAhead` on,
  // its line read as the drive reads a line. Over ground built so that the two walks' samples fall on the same points
  // (the speed's tenth of a second is a whole number of look steps): a spike near the nose, which the line now sees and
  // the line a tenth of a second on must not, and a peak at the first walk's one sample past its end, which the line
  // on must see. Read with the spike, or without the sample past the end, the rate is metres a second out.
  {
    const past = h.lookMax + h.lookStep;
    const spike = (x: number) => 8 * Math.exp(-(((x - 16) / 3) ** 2)) + 6 * Math.exp(-(((x - past) / 2) ** 2)) + 0.002 * x;
    const near2: LineReader = { near: (px) => spike(px), far: () => null, farStep: 16, farX: () => 0, farZ: () => 0 };
    const tune = { lookAhead: RACE_TUNE.lookAhead, lookMax: h.lookMax, lookStep: h.lookStep };
    const v = (4 * h.lookStep) / RACE_TUNE.feedAhead;
    const f = v * RACE_TUNE.feedAhead;
    const w1 = newLineWalk(64);
    walkLine(near2, new LatticeRing(8), 0, 0, 1, 0, v, tune, w1);
    const under = spike(0);
    const underAhead = underAheadOf(w1, under, f, 15);
    const rate = lineRateOf(w1, under, underAhead, v, RACE_TUNE);
    const w2 = newLineWalk(64);
    walkLine(near2, new LatticeRing(8), f, 0, 1, 0, v, tune, w2);
    const lineNow = lineFrom(under, w1, 0, RACE_TUNE.lookShare);
    const second = (lineFrom(underAhead, w2, 0, RACE_TUNE.lookShare) - lineNow) / RACE_TUNE.feedAhead;
    ok(Number.isFinite(w1.past) && w1.pastD > f && Math.abs(rate - second) < 0.01, `8: the line's rate from the one walk equals a second walk's made a tenth of a second on, within a centimetre a second (${rate.toFixed(4)} against ${second.toFixed(4)} m/s)`);
  }
}

// --- 9: the bridge's closing ----------------------------------------------------------------------------------------
{
  const n = 64;
  const rowS = new Float64Array(1024);
  const dil = new Float64Array(1024);
  const deque = new Int32Array(1024);
  /** A row of samples 2 m apart over flat ground at nought with a pit `width` metres wide and `depth` deep from sample 20. */
  const pit = (width: number, depth: number, nanFrom = Infinity) => {
    for (let i = 0; i < n; i++) {
      const x = i * 2;
      rowS[i] = i >= nanFrom ? Number.NaN : x >= 40 && x < 40 + width ? -depth : 0;
    }
  };
  for (const [width, span] of [
    [10, 16],
    [30, 40],
    [50, 60],
  ] as const) {
    pit(width, 25);
    const nw = Math.round(span / 2) + 1;
    const starts = bridgeClose(rowS, n, nw, dil, deque);
    let filled = true;
    let never = true;
    for (let j = 0; j < n; j++) {
      const c = closedAt(dil, starts, nw, j);
      if (Number.isNaN(c)) continue;
      if (rowS[j] < 0 && c !== 0) filled = false;
      if (c < rowS[j]) never = false;
    }
    ok(filled, `9: a ${width} m pit under a ${span} m span fills to its rim`);
    ok(never, `9: and the closing is never below the raw ground`);
  }
  pit(50, 25);
  {
    const nw = Math.round(30 / 2) + 1;
    const starts = bridgeClose(rowS, n, nw, dil, deque);
    const mid = closedAt(dil, starts, nw, 32);
    ok(mid === -25, '9: a pit wider than the span is followed as it is (the closing at its middle is its floor)');
  }
  pit(10, 25, 26);
  {
    const nw = Math.round(16 / 2) + 1;
    const starts = bridgeClose(rowS, n, nw, dil, deque);
    const inPit = closedAt(dil, starts, nw, 22);
    ok(Number.isNaN(inPit) || inPit <= -25, '9: nothing is bridged where the far side is a sample the cache cannot answer (NaN)');
  }
  // A closing over the ring's 256 entries at the ceiling's highest span (1368 km/h for half a second, 190 m, plus a pod's length).
  {
    const N = RACE_TUNE.bridgeRing;
    const big = new Float64Array(N);
    for (let i = 0; i < N; i++) big[i] = i >= 110 && i < 150 ? -40 : Math.sin(i) * 0.2;
    const nw = Math.round((RACE_TUNE.bridgeTime * (1368 / 3.6) + 15) / 2) + 1;
    const d2 = new Float64Array(N);
    const dq = new Int32Array(N);
    const starts = bridgeClose(big, N, nw, d2, dq);
    let worst = 0;
    for (let j = 0; j < N; j++) {
      const c = closedAt(d2, starts, nw, j);
      if (Number.isNaN(c)) continue;
      // Against a closing worked out the slow way.
      let best = Infinity;
      for (let i = Math.max(0, j - nw + 1); i <= Math.min(j, N - nw); i++) {
        let hi = -Infinity;
        for (let q = i; q < i + nw; q++) hi = Math.max(hi, big[q]);
        best = Math.min(best, hi);
      }
      worst = Math.max(worst, Math.abs(c - best));
    }
    ok(starts > 0 && worst < 1e-12, `9: a closing over ${N} ring entries at the ceiling's span (${nw} samples) matches the slow one (worst ${worst})`);
    const between = closedBetween(d2, starts, nw, 130.5);
    ok(Number.isFinite(between) && near(between, (closedAt(d2, starts, nw, 130) + closedAt(d2, starts, nw, 131)) / 2, 1e-12), '9: and a place between samples reads the two either side');
    ok(Number.isNaN(closedAt(d2, starts, nw, 20)), '9: a sample whose windows would run off the row is not bridged at all');
  }
  // What the drive's `under` takes between samples (`bridgedBetweenOf`): the closing where it lifted a sample either
  // side, and nothing (the raw ground's) where it lifted neither. A valley wider than the window, its floor meeting a
  // 30-degree wall between two samples: the closing there is the samples themselves, and interpolated it stands over
  // the true ground at the wall's foot, which the drive must never take for a bridge.
  {
    const N = 64;
    const row = new Float64Array(N);
    const t30 = Math.tan(Math.PI / 6);
    // Samples 2 m apart: flat to 30 m, a 30-degree wall down to a floor at -10 (its foot at 47.3 m, between two
    // samples), the floor to 100 m, a 30-degree wall up again: the floor is far wider than a 20 m window.
    const ground = (x: number) => (x < 30 ? 0 : Math.max(-10, x < 100 ? -((x - 30) * t30) : -10 + (x - 100) * t30));
    for (let i = 0; i < N; i++) row[i] = ground(i * 2);
    const nw = Math.round(20 / 2) + 1;
    const dil = new Float64Array(N);
    const dq = new Int32Array(N);
    const starts = bridgeClose(row, N, nw, dil, dq);
    const q = { at: 0, out: 0 };
    let lifted = 0;
    for (let at = 10; at < 50; at += 0.25) {
      q.at = at;
      bridgedBetweenOf(row, dil, starts, nw, q);
      if (!Number.isNaN(q.out)) lifted++;
    }
    // (The plain closing between samples at the foot, 47.32 m, between the samples at 46 and 48: over the ground there.)
    const foot = closedBetween(dil, starts, nw, 23.66);
    ok(foot > ground(47.32) + 0.1, `9: (the closing interpolated at the near wall's foot stands ${r2(foot - ground(47.32))} m over the ground there)`);
    ok(lifted === 0, `9: a valley wider than the window is never taken for a bridge between its samples, its walls' feet included (${lifted} places)`);
    // A pit narrower than it, between the same samples: the closing, to the rim.
    pit(10, 25);
    const s2 = bridgeClose(rowS, n, nw, dil, dq);
    q.at = 22.5;
    bridgedBetweenOf(rowS, dil, s2, nw, q);
    const inside = q.out;
    q.at = 10.5;
    bridgedBetweenOf(rowS, dil, s2, nw, q);
    ok(inside === 0 && Number.isNaN(q.out), `9: and a pit narrower than it is closed to its rim between its samples (${inside}), the flat ground beside it left to the raw ground`);
  }
}

// --- 10: the strike's kick ------------------------------------------------------------------------------------------
{
  const h = resolved(POD, 5);
  const path = newSweptPath(4);
  path.n = 1;
  // A 10 m wall the hull's lowest point clips by 0.3 m, against a 0.3 m step.
  path.g[0] = 10;
  path.back[0] = 0;
  path.y[0] = 9.7;
  const clip = strikeKick(path, 600 / 3.6, h);
  path.g[0] = 0.3;
  path.y[0] = 0;
  const step = strikeKick(path, 600 / 3.6, h);
  ok(Math.abs(clip - step) < 1e-9, `10: a 0.3 m clip of a 10 m wall kicks no harder than a 0.3 m step (${clip.toFixed(2)} against ${step.toFixed(2)} m/s)`);
  path.g[0] = 40;
  path.y[0] = 0;
  ok(strikeKick(path, 600 / 3.6, h) === h.riseMax, '10: a kick is never more than riseMax');
  // A hull clipping a 20-degree descent: the ground 8 m behind stands higher, so the ground's own rise is its fall.
  path.g[0] = 0;
  path.back[0] = h.faceLen * Math.tan((20 * Math.PI) / 180);
  path.y[0] = -0.05;
  const fall = strikeKick(path, 135, h);
  ok(fall < 0 && Math.abs(fall + 135 * Math.tan((20 * Math.PI) / 180)) < 1e-9, `10: on a descent the rise is the slope's own fall (${r2(fall)} m/s), never a closing at the hull's whole sink`);
}

// --- 11: the fall over the physics' fixed steps ---------------------------------------------------------------------
{
  const h = resolved(POD, 5);
  const FIXED = 1 / 60;
  for (const n of [1, 2, 3, 4]) {
    // A fall from 50 m, planned n fixed steps at a time and commanded as the mean: where the body ends after each plan.
    let y = 50;
    let vy = 0;
    let t = 0;
    let worst = 0;
    while (t < 2.5) {
      const mean = planFall(vy, n, FIXED, h);
      y += mean * n * FIXED;
      vy = Math.max(-h.fallMax, vy - h.fall * n * FIXED);
      t += n * FIXED;
      const want = 50 + fallDisplacement(0, t, h.fall, h.fallMax);
      worst = Math.max(worst, Math.abs(y - want));
    }
    ok(worst < 0.001, `11: a fall planned over ${n} fixed step(s) ends on the parabola to a millimetre (worst ${(worst * 1000).toFixed(3)} mm)`);
  }
  // The height rule over a plan cut into sub-steps, against what the rule itself says it does.
  const tune = { ride: h.ride, riseRate: h.riseRate, riseMax: h.riseMax, band: h.band, bandRate: h.bandRate, fall: h.fall, fallMax: h.fallMax };
  const phases = new Set<number>();
  // A fall cut into sub-steps lands where the exact fall over the whole plan does (`fallDisplacement`), whatever the cut,
  // across the fall's most too: from rest and from 70 m/s down, over one to four fixed steps in one to eight sub-steps.
  {
    let worst = 0;
    for (const v0 of [0, -70]) {
      for (const n of [1, 2, 3, 4]) {
        for (const m of [1, 2, 3, 5, 8]) {
          const st = { low: 500, vy: v0 };
          const T = n * FIXED;
          for (let i = 0; i < m; i++) phases.add(stepVertical(st, 0, 0, T / m, tune));
          worst = Math.max(worst, Math.abs(st.low - (500 + fallDisplacement(v0, T, h.fall, h.fallMax))), Math.abs(st.vy - Math.max(-h.fallMax, v0 - h.fall * T)));
        }
      }
    }
    ok(worst < 1e-9, `11: a fall cut into sub-steps lands where the exact fall over the plan does, at its speed (worst ${worst.toExponential(1)})`);
  }
  // Under the line the hull rises at once: nine-tenths of a 3 m shortfall gone in under a third of a second, at two
  // sub-steps a fixed step (a full pod's), never faster than riseMax.
  {
    const st = { low: h.ride - 3, vy: 0 };
    let t = 0;
    let fastest = 0;
    while (h.ride - st.low > 0.3 && t < 2) {
      phases.add(stepVertical(st, 0, 0, FIXED / 2, tune));
      fastest = Math.max(fastest, st.vy);
      t += FIXED / 2;
    }
    ok(t < 1 / 3 && fastest <= h.riseMax, `11: under its line the hull takes nine-tenths of a 3 m shortfall in ${r2(t)} s (under a third of a second), at most ${r2(fastest)} m/s`);
  }
  // Within the band it settles onto its ride: from 2 m over it at rest, within 5 cm in half a second, and never under it
  // by more than one sub-step's travel (the rise takes over the moment it is).
  {
    const st = { low: h.ride + 2, vy: 0 };
    let t = 0;
    let under = 0;
    const steps: number[] = [];
    while (t < 0.5 - 1e-9) {
      const before = st.low;
      phases.add(stepVertical(st, 0, 0, FIXED / 2, tune));
      steps.push(Math.abs(st.low - before));
      under = Math.max(under, h.ride - st.low);
      t += FIXED / 2;
    }
    ok(Math.abs(st.low - h.ride) < 0.05 && under <= Math.max(...steps) + 1e-9, `11: within its band it settles onto its ride, ${r2(Math.abs(st.low - h.ride) * 100)} cm off after half a second, never under it by more than a sub-step's travel (${r2(under * 100)} cm)`);
  }
  ok(phases.has(RISE) && phases.has(BAND) && phases.has(FALL) && [...phases].every((p) => p === RISE || p === BAND || p === FALL), '11: and every sub-step names its phase, each of the three met');
  // The loose hold's sub-step (`stepLooseOf`): the firm rule's own rise and settle, with a floor under them -- never
  // below nought faster than the grip on the ground or gravity in the air, never below what the ground gave (`keep`)
  // faster than either -- and the cushion's own lift, beyond what the ground gave, never carrying the hull past its line.
  const loose = { ...tune, gravity: RACE_TUNE.looseFall, grip: RACE_TUNE.looseGrip };
  const looseStep = (low: number, vy: number, keep: number) => {
    const st = newLooseStep();
    st.low = low;
    st.vy = vy;
    st.keep = keep;
    st.feed = 0;
    st.ahead = 0;
    st.line = 0;
    st.rate = 0;
    return st;
  };
  {
    // Over its band, flying on what the ground gave it: the world's gravity, worked out exactly however it is cut.
    let worst = 0;
    for (const v0 of [6, 0, -30]) {
      for (const m of [1, 2, 5]) {
        const st = looseStep(500, v0, v0);
        const T = 3 * FIXED;
        st.dt = T / m;
        for (let i = 0; i < m; i++) stepLooseOf(st, loose);
        worst = Math.max(worst, Math.abs(st.low - (500 + fallDisplacement(v0, T, loose.gravity, loose.fallMax))), Math.abs(st.vy - (v0 - loose.gravity * T)));
      }
    }
    ok(worst < 1e-9, `11: loose, over its band a flight on what the ground gave, cut into sub-steps, lands where the world's gravity puts it, at its speed (worst ${worst.toExponential(1)})`);
    // And an upward speed the ground never gave (a kick, a lift the cushion overshot with) is taken back at the firm
    // fall down to what it did give, and only then at gravity.
    const st = looseStep(500, 40, 10);
    st.dt = FIXED / 2;
    const speeds: number[] = [];
    for (let i = 0; i < 24; i++) {
      stepLooseOf(st, loose);
      speeds.push(st.vy);
    }
    const firmLeg = (40 - speeds[0]) / (FIXED / 2);
    const at = speeds.findIndex((v) => v <= 10 - 1e-9);
    const gravLeg = at > 0 ? (speeds[at] - speeds[at + 1]) / (FIXED / 2) : NaN;
    ok(near(firmLeg, h.fall, 1e-6) && near(gravLeg, loose.gravity, 1e-6), `11: loose, an upward 40 m/s of which the ground gave 10 is taken back at the firm fall (${r2(firmLeg)} m/s²) to 10, then at gravity (${r2(gravLeg)} m/s²)`);
  }
  {
    // A line falling away under a hull riding on it, at ten times what the grip could follow: the hull's speed never
    // goes down below nought faster than the grip, and it settles onto its ride again once the line stops. (Its own lift
    // as it comes back up onto its line is braked faster, at the firm fall, but only ever down to nought: that is a rise
    // stopped, and nothing pulls the hull down.)
    const st = looseStep(h.ride, 0, 0);
    let worstDrop = 0;
    let line = 0;
    const dt = FIXED / 2;
    for (let i = 0; i < 240; i++) {
      const rate = i < 30 ? -10 * loose.grip * (i * dt) : 0;
      line += rate * dt;
      st.line = line;
      st.rate = rate;
      st.dt = dt;
      const before = st.vy;
      stepLooseOf(st, loose);
      worstDrop = Math.max(worstDrop, ((before < 0 ? before : 0) - st.vy) / dt);
    }
    ok(worstDrop <= loose.grip + 1e-9 && Math.abs(st.low - (line + h.ride)) < 0.05, `11: loose, a hull is never taken down below nought faster than the grip (${r2(worstDrop)} m/s², grip ${loose.grip}) and settles onto its ride once the line stops (${r2(st.low - (line + h.ride))} m off)`);
  }
  {
    // A hull a little under its line down a descent is lifted on the descent's own rate, never stopped dead.
    const st = looseStep(h.ride - 0.3, -19, 0);
    st.rate = -19;
    st.dt = FIXED;
    ok(stepLooseOf(st, loose) === RISE && near(st.vy, 0.3 * h.riseRate - 19, 1e-9), `11: loose, a hull 0.3 m under its line down a 19 m/s descent rises on the descent's rate (${r2(st.vy)} m/s), never stopped dead`);
    const firm = { low: h.ride - 0.3, vy: -19 };
    stepVertical(firm, 0, -19, FIXED, tune);
    ok(firm.vy >= 0, `11: (the control: the firm rule stops it dead under its line: ${r2(firm.vy)} m/s)`);
  }
  {
    // A line stepped up 3 m at once, as at a kerb's foot, read as a rate of 60 m/s for a tenth of a second: the firm
    // rule's rise takes the hull up at once, and the cushion's own lift is no faster than the firm fall can take back by
    // the line, so it stops at its line rather than flying past it. What the ground gave it (`keep`) it keeps: with the
    // same step given as ground it rode, it flies on past the line.
    const run = (keep: number) => {
      const st = looseStep(h.ride, 0, keep);
      let most = 0;
      let fastest = 0;
      const dt = FIXED / 2;
      for (let i = 0; i < 120; i++) {
        st.line = 3;
        st.rate = i < 12 ? 60 : 0;
        st.feed = keep;
        st.dt = dt;
        stepLooseOf(st, loose);
        most = Math.max(most, st.low - (3 + h.ride));
        fastest = Math.max(fastest, st.vy);
      }
      return { most, fastest };
    };
    const lift = run(0);
    const given = run(30);
    // (Under half a metre: the brake is judged at each sub-step's start, so the last sub-step before the line carries
    // the hull a little past it, and the firm fall takes the rest within centimetres.)
    ok(lift.most < 0.5 && lift.fastest > 20, `11: loose, a line stepped up 3 m is risen to at up to ${r2(lift.fastest)} m/s and passed by no more than ${r2(lift.most * 100)} cm`);
    ok(given.most > 10, `11: (the control: the same rise given by the ground it rode carries the hull ${r2(given.most)} m past its line, a jump)`);
  }
}

// --- 12: the slope's push -------------------------------------------------------------------------------------------
{
  const speed = 250;
  const d10 = (10 * Math.PI) / 180;
  const want = slopePush(-d10, speed, false, RACE_TUNE);
  ok(near(want / speed, 0.11, 0.005), `12: a 10-degree descent asks a push of 11% of the speed (${((100 * want) / speed).toFixed(2)}%)`);
  let p = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 90; i++) p += (want - p) * (1 - Math.exp(-dt / RACE_TUNE.slopeEase));
  ok(near(p / speed, 0.095, 0.005), `12: built over about a second and a half: ${((100 * p) / speed).toFixed(2)}% after 1.5 s (nine-tenths of what it asks)`);
  const up = slopePush(d10, speed, false, RACE_TUNE);
  ok(near(-up / speed, 0.03, 0.002), `12: a 10-degree climb takes 3% off (${((100 * -up) / speed).toFixed(2)}%)`);
  ok(slopePush(-((RACE_TUNE.slopeFloor - 0.5) * Math.PI) / 180, speed, false, RACE_TUNE) === 0 && slopePush(-d10, speed, true, RACE_TUNE) === 0, '12: nought under slopeFloor and nought in the air');
  ok(wrap(3 * Math.PI) === Math.PI || near(Math.abs(wrap(3 * Math.PI)), Math.PI, 1e-12), '12: (and the angle wrap keeps an angle within a half turn)');
}

restore();
void TUNE0;
console.log(`\nraceMath: ${checks} checks passed`);
