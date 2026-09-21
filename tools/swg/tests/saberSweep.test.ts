// Where a lightsaber lands between two frames, checked without a browser: how many casts cover the
// ground a blade crossed, where each of them goes, that one swing still takes one bite out of one
// body however many of them touch it, and that a blade merely resting against somebody takes its
// tenth four times a second and no more.
//
// The once-per-swing rule is driven through `PathMemory.step`, which is the very loop the game runs
// (`src/combat/sweep.ts`'s `BladePath` is that loop with a rapier query handed to it in place of
// the counter below), so a loop that handed a fresh ledger to each sub-step fails here rather than
// passing a test that had written the rule out for itself.
import assert from 'node:assert/strict';
import {
  BRUSH_SLOTS,
  BrushClock,
  PathMemory,
  SABER_HIT,
  bodyTeleported,
  brushDamage,
  distanceBetween,
  pathTravel,
  saberHitReport,
  startsFresh,
  stepEnds,
  subSteps,
  tuneSaberHit,
  type HitLedger,
  type Vec3Like,
} from '../../../src/combat/saberHit.ts';
import { segmentDistanceSq } from '../../../src/core/fx/bladeGlowMath.ts';
import type { Hittable } from '../../../src/combat/kit.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const v = (x: number, y: number, z: number): Vec3Like => ({ x, y, z });
/** A stand-in for something that can be hurt: the ledgers only ever compare it by identity. */
const body = (name: string): Hittable => ({ name } as unknown as Hittable);
const T = SABER_HIT;

// --- how many casts cover the ground the blade crossed

ok(subSteps(0) === 1, 'a blade that has not moved is cast once, where it is');
ok(subSteps(-1) === 1, 'and so is one whose travel makes no sense');
ok(subSteps(T.stepLength) === 1, `${T.stepLength} m of travel is one cast: that is what a step is`);
ok(subSteps(T.stepLength + 0.01) === 2, 'a hair further is two');
ok(subSteps(T.stepLength * 4) === 4, 'four steps of travel is four casts');
ok(subSteps(2) === T.maxSteps, `a tip that crosses two metres in a frame is cast ${T.maxSteps} times, not ${Math.ceil(2 / T.stepLength)}`);
ok(subSteps(40) === T.maxSteps && subSteps(1e9) === T.maxSteps, 'and nothing is ever cast forty times: past the cap the steps stretch');
let rises = true;
for (let d = 0; d < 2; d += 0.05) if (subSteps(d + 0.05) < subSteps(d)) rises = false;
ok(rises, 'the count never falls as the blade travels further');

// --- which end the travel is measured from

const a0 = v(0, 1, 0);
const b0 = v(0, 1, 1.3);
ok(Math.abs(pathTravel(a0, a0, b0, v(1, 1, 1.3)) - 1) < 1e-9, 'a swing about the hand is measured at the tip');
ok(Math.abs(pathTravel(a0, v(0, 1, 1), b0, v(0, 1, 2.3)) - 1) < 1e-9, 'a thrust moves both ends and is measured all the same');
ok(Math.abs(pathTravel(a0, v(0, 1, 2), b0, b0) - 2) < 1e-9, 'the hilt is taken when it is the faster end: a thrust is the move that goes straight through somebody');

// --- when the path means nothing

ok(startsFresh(0, -1), 'a clock that went back (a travel resets the world\'s) starts the path fresh');
ok(startsFresh(0, T.gap + 0.01), 'so does a frame nobody drew: a hidden tab, a loading screen');
ok(!startsFresh(0.5, 0.016), 'an ordinary frame of an ordinary swing sweeps its path');
ok(startsFresh(T.jump + 0.1, 0.016), `a blade carried ${T.jump} m in a frame was not swung there: it was lit, caught or carried`);
ok(startsFresh(Number.NaN, 0.016), 'and a travel that is not a number is never swept across');

// --- and the case the blade's own rules cannot see: the body put somewhere

ok(!bodyTeleported(0.2, 0.016), 'a stride between two frames is a stride');
ok(!bodyTeleported(14 * 0.05, 0.05), 'and so is a sprint on a slow frame');
ok(bodyTeleported(2, 0.016), 'a lift that puts the player just through a doorway is not: 2 m in a frame is nobody walking');
ok(bodyTeleported(2, 0), 'nor is any move at all in no time');
ok(bodyTeleported(0.2, -1), 'and a clock that went back is a world that changed under the body');

// --- where each cast goes

const outA = v(0, 0, 0);
const outB = v(0, 0, 0);
// A quarter turn about the hand in one frame: the hilt stands still, the tip swings from straight
// ahead to straight out to the side, which is 1.84 m of tip in a frame -- an ordinary swing at a run.
const wasA = v(0, 1.2, 0);
const wasB = v(0, 1.2, 1.3);
const nowA = v(0, 1.2, 0);
const nowB = v(1.3, 1.2, 0);
stepEnds(wasA, nowA, wasB, nowB, 4, 4, outA, outB);
ok(outB.x === nowB.x && outB.z === nowB.z && outA.x === nowA.x, 'the last cast is exactly where the blade is now, which is the one cast the game always made');
stepEnds(wasA, nowA, wasB, nowB, 1, 1, outA, outB);
ok(outB.x === nowB.x, 'and a single cast is that same one, so a blade that did not move behaves as it always did');
stepEnds(wasA, nowA, wasB, nowB, 2, 4, outA, outB);
ok(Math.abs(outB.x - 0.65) < 1e-9 && Math.abs(outB.z - 0.65) < 1e-9, 'the casts in between are spread evenly along the path');
stepEnds(wasA, nowA, wasB, nowB, 0, 4, outA, outB);
ok(outB.x === wasB.x, 'step 0 is where the blade was, and is never cast again: last frame already did');

// --- a body straddling the path between two frames

/** The nearest a point comes to the blade on cast k of n. */
const nearestOn = (k: number, n: number, p: Vec3Like): number => {
  stepEnds(wasA, nowA, wasB, nowB, k, n, outA, outB);
  return Math.sqrt(segmentDistanceSq(p, outA, outB));
};
// A thin body standing halfway round that quarter turn, 0.9 m out from the hand: the blade was
// never near it at either end of the frame, and passed straight through where it stands.
const straddler = v(0.636, 1.2, 0.636);
const thin = 0.12;
ok(nearestOn(1, 1, straddler) > thin + 0.16, 'cast at its two ends alone, the swing steps clean over a thin body standing in the middle of it');
let found = false;
const steps = subSteps(pathTravel(wasA, nowA, wasB, nowB));
for (let k = 1; k <= steps; k++) if (nearestOn(k, steps, straddler) <= thin + 0.16) found = true;
ok(found, `stepped along the path in ${steps}, the same swing finds it`);

// The worst a body can do is stand halfway between two casts. At every travel the path is still
// swept across, that gap is smaller than a fighter's own girth plus the blade's, so nothing the
// game stands up can hide in it -- which is what the cap and the step length are chosen for.
const FIGHTER = 0.35;
let gapOk = true;
let worst = 0;
for (let travel = 0.05; travel <= T.jump + 1e-9; travel += 0.05) {
  const half = travel / (2 * subSteps(travel));
  if (half > worst) worst = half;
  if (half > FIGHTER + 0.16) gapOk = false;
}
ok(gapOk, `the widest gap between two casts is ${worst.toFixed(3)} m, inside a body's ${FIGHTER} m and the blade's 0.16`);

// --- the loop itself, driven: one swing, one bite

/**
 * A stand-in for the rapier cast, following the same rule `strikeSweep` does: it touches everything
 * in `reach` of the segment, hurts each once per the ledger it was handed, and writes down which
 * ledger that was. Nothing here mimics the once-per-swing rule -- the ledger is asked, exactly as
 * the game asks it, so the rule under test lives where the game keeps it.
 */
const reach = thin + 0.16;
const around: Hittable[] = [];
const ledgersSeen: HitLedger[] = [];
const castAt: { a: Vec3Like; b: Vec3Like }[] = [];
let bites = 0;
const where = new Map<Hittable, Vec3Like>();
const countingCast = (ca: Vec3Like, cb: Vec3Like, already: HitLedger): number => {
  ledgersSeen.push(already);
  castAt.push({ a: v(ca.x, ca.y, ca.z), b: v(cb.x, cb.y, cb.z) });
  let hits = 0;
  for (const c of around) {
    const p = where.get(c);
    if (!p || Math.sqrt(segmentDistanceSq(p, ca, cb)) > reach) continue;
    if (already.has(c)) continue;
    already.add(c);
    bites++;
    hits++;
  }
  return hits;
};
const drive = (path: PathMemory, now: number, a: Vec3Like, b: Vec3Like, already: HitLedger): number => {
  ledgersSeen.length = 0;
  castAt.length = 0;
  return path.step(now, a, b, already, countingCast);
};

// Standing a hand's breadth out from the hilt, well inside the quarter turn: every one of the
// casts along that turn passes through it, which is what makes the once-per-swing rule visible.
const victim = body('a fighter');
const path = new PathMemory();
const already = new Set<Hittable>();
// Frame one: the blade stands where it was, nobody near it. A path with nothing written down is
// cast once and only where the blade is -- it does not sweep in from nowhere.
drive(path, 0, wasA, wasB, already);
ok(castAt.length === 1 && bites === 0, 'a blade with no path yet is cast once, where it is, and sweeps in from nowhere');
around.push(victim);
where.set(victim, v(0.25, 1.2, 0.25));
// Frame two: the quarter turn. Every one of its casts passes through the body; it is bitten once.
const swept = drive(path, 0.016, nowA, nowB, already);
ok(castAt.length === T.maxSteps, `a tip that crosses ${pathTravel(wasA, nowA, wasB, nowB).toFixed(2)} m is cast ${castAt.length} times, not ${Math.ceil(pathTravel(wasA, nowA, wasB, nowB) / T.stepLength)}`);
ok(ledgersSeen.length === castAt.length && ledgersSeen.every((l) => l === already), 'every sub-step is handed the one ledger of the whole swing, not one of its own');
ok(bites === 1 && swept === 1, `one swing takes one bite out of one body, though ${castAt.length} casts touched it`);
let touchedBy = 0;
const stood = where.get(victim) as Vec3Like;
for (const c of castAt) if (Math.sqrt(segmentDistanceSq(stood, c.a, c.b)) <= reach) touchedBy++;
ok(touchedBy > 1, 'and more than one of them really did touch it, so the once-per-swing rule was what stopped the rest');
const last = castAt[castAt.length - 1];
ok(last.b.x === nowB.x && last.b.z === nowB.z, 'the last of them is where the blade is now, which is the cast the game always made');

// A blade carried further than an arm can swing is cast once, where it is: nothing is swept across
// the world between a hilt going out and coming back.
bites = 0;
const far = new Set<Hittable>();
drive(path, 0.032, v(20, 1.2, 0), v(20, 1.2, 1.3), far);
ok(castAt.length === 1, 'a blade carried across the map is cast once, where it landed');
// And a path forgotten (the body was put somewhere, the blade went out) does the same.
path.mark(wasA, wasB, 0.048);
path.reset();
drive(path, 0.064, nowA, nowB, new Set<Hittable>());
ok(castAt.length === 1, 'and so is one whose path was forgotten');

// --- the brush's clock

const brush = new BrushClock();
const near = body('somebody standing in it');
let touches = 0;
for (let i = 0; i < 60; i++) {
  brush.begin(i / 60);
  if (!brush.has(near)) {
    brush.add(near);
    touches++;
  }
}
ok(touches === 4, `a blade resting against a body takes its share ${touches} times in a second, at ${T.brushEvery} s apart`);
brush.begin(1);
ok(!brush.has(near), 'and again on the next quarter second');
brush.clear();
brush.begin(1.01);
ok(!brush.has(near), 'a cleared clock remembers nobody: the blade went out, or the class changed');

// The ring is fixed, so with more bodies in the blade than slots it fails **closed**: the ones it
// cannot remember are left alone rather than taking a slot off a body it brushed this quarter
// second, which would brush that one again on the very next frame -- the one failure the clock is
// there to prevent.
const crowd: Hittable[] = [];
for (let i = 0; i < BRUSH_SLOTS + 4; i++) crowd.push(body(`body ${i}`));
const ring = new BrushClock();
ring.begin(0);
let took = 0;
for (const c of crowd) if (!ring.has(c)) {
  ring.add(c);
  took++;
}
ok(took === BRUSH_SLOTS && ring.declined === 4, `the ring is ${BRUSH_SLOTS} bodies wide and the other ${ring.declined} are left alone, not swapped in`);
let again = 0;
for (let f = 1; f <= 10; f++) {
  ring.begin(f / 60);
  for (const c of crowd) if (!ring.has(c)) {
    ring.add(c);
    again++;
  }
}
ok(again === 0, 'and on the ten frames after it nobody in the crowd is brushed a second time: the ring does not thrash');
ring.begin(0.3);
let later = 0;
for (const c of crowd) if (!ring.has(c)) {
  ring.add(c);
  later++;
}
ok(later === BRUSH_SLOTS, `past ${T.brushEvery} s every slot is free again and the blade brushes ${later} of them`);
ring.begin(-5);
ok(!ring.has(crowd[crowd.length - 1]), 'a clock that went back forgets: a travel resets the world\'s own');

// --- the brush is never fatter than the blade

ok(T.brushRadius <= 0.16, `the brush's capsule (${T.brushRadius} m) is no fatter than the blade's own 0.16: it is the query that runs unattended`);

// --- the switch, and the tuning

ok(brushDamage(100) === 100 * T.brushShare, `standing in a lit blade costs a ${T.brushShare} share of the style's damage`);
const wasShare = T.brushShare;
tuneSaberHit({ brushShare: 0 });
ok(brushDamage(100) === 0 && SABER_HIT.brushShare === 0, 'brushShare 0 takes nothing at all: the switch is real');
ok(saberHitReport().brush.on === false, 'and the readout says the brush is off');
tuneSaberHit({ brushShare: wasShare });
ok(SABER_HIT.brushShare === wasShare, 'and it comes back');

tuneSaberHit({ stepLength: 0, maxSteps: 0, brushEvery: -3, carry: 0 });
ok(SABER_HIT.stepLength > 0 && SABER_HIT.maxSteps >= 1 && SABER_HIT.brushEvery > 0 && SABER_HIT.carry > 0, 'the tuning has floors under it: no cast divides by zero and none is cast nought times');
tuneSaberHit({ maxSteps: 6.7 });
ok(SABER_HIT.maxSteps === 6, 'a cast count is a whole number of casts');
tuneSaberHit({ stepLength: 0.35, maxSteps: 4, brushEvery: 0.25, carry: 60 });
ok(SABER_HIT.stepLength === 0.35 && SABER_HIT.maxSteps === 4 && SABER_HIT.brushEvery === 0.25 && SABER_HIT.carry === 60, 'and the baked numbers go back');

ok(Math.abs(distanceBetween(v(0, 0, 0), v(3, 4, 0)) - 5) < 1e-12, 'the distance under all of it is the plain one');
const report = saberHitReport();
ok(typeof report.swing.hits === 'number' && typeof report.frame.casts === 'number' && report.tune.stepLength === SABER_HIT.stepLength, 'the readout carries this swing\'s hits, last frame\'s casts and the tuning');

console.log(`${checks} checks passed`);
