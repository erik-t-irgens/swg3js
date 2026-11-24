// Tatooine's second sun round the first (the GPU port's pass 2, wave 6, maker K; the owner's ask of 23 November): the pair's
// angle and distance dials (`src/sky/stars.ts`' `PAIR_TUNE`, the `sky` helper's "Tatooine's second sun"), on the game's own code:
//   1. at angle 0 the pair is the base's (1b2a6c6) to the bit, read out of git, at every distance and caster;
//   2. at 90 it stands beside the caster on the side the sun's own path runs toward, at 180 above it, at -90 the mirror of 90,
//      always the distance dial's degrees from the caster along the sky; the frame copy in `airRun.ts` is held by airRun.test;
//   3. the dials move through `tuneSky`, held to their ranges, and a move by hand is counted (`PAIR_MOVES`);
//   4. a loading screen's word (`pairDialsFrom`): an applied system's pair sets the dials, a screen with none puts back what is
//      untouched, never what he moved;
//   5. under an applied system (the viewer's Tatoo draft) the pair stands by the system's own numbers to the bit (against the
//      base's `skyMotion.ts`) until the dials are moved by hand; the system's word handed to the dials and moved back to the very
//      same numbers stands it where the system put it (the dial and the system's Line angle agree: one less 90 than the other);
//      moved to 90 it stands ahead along the sun's path there too, and the distance is the dial's at every moment.
//
// Run: node tools/swg/tests/pairAngle.test.ts
import assert from 'node:assert/strict';
import { atBase } from './atBase.ts';
import { PAIR_MOVES, PAIR_TUNE, pairDialsFrom, pairDirectionIn } from '../../../src/sky/stars.ts';
import { SKY_TUNE_RANGE, tuneSky, skyDialSet } from '../../../src/sky/skyDials.ts';
import { DayCycle } from '../../../src/world/daycycle.ts';
import { draftSystem } from '../../../src/sky/system/drafts.js';
import { skyMotionFor } from '../../../src/sky/system/skyMotion.ts';
import { sharedClock } from '../../../src/world/sharedClock.ts';

let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const DEG = Math.PI / 180;
const BASE = '1b2a6c6';
type V = { x: number; y: number; z: number };
const v = (): V => ({ x: 0, y: 0, z: 0 });
const dot = (a: V, b: V): number => a.x * b.x + a.y * b.y + a.z * b.z;
const apartDeg = (a: V, b: V): number => {
  const c = dot(a, b);
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c) / DEG;
};
const unit = (x: number, y: number, z: number): V => {
  const l = Math.sqrt(x * x + y * y + z * z);
  return { x: x / l, y: y / l, z: z / l };
};
const CASTERS: V[] = [unit(0.3, 0.5, -0.81), unit(-0.9, 0.05, 0.43), unit(0.1, 0.92, 0.37), unit(0, 1, 0), unit(0.5, -0.2, -0.84), unit(0.7, 0.3, 0.2)];

// ---------------------------------------------------------------- 1. angle 0 is the base's to the bit
{
  const base = await atBase<{ PAIR_TUNE: { belowDeg: number }; pairDirectionIn: typeof pairDirectionIn }>('src/sky/stars.ts', BASE);
  ok(!!base, `the base's stars.ts read out of git at ${BASE}`);
  let n = 0;
  let same = 0;
  const a = v();
  const b = v();
  PAIR_TUNE.angleDeg = 0;
  for (const below of [0, 0.7, 1.5, 4, 12]) {
    PAIR_TUNE.belowDeg = below;
    base!.PAIR_TUNE.belowDeg = below;
    for (const c of CASTERS) {
      pairDirectionIn(c.x, c.y, c.z, a);
      base!.pairDirectionIn(c.x, c.y, c.z, b);
      n++;
      if (Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z)) same++;
    }
  }
  // And over a whole day of the day's own path, as the frame hands it.
  const day = new DayCycle(0.6, 70 * DEG);
  day.swg = true;
  PAIR_TUNE.belowDeg = 1.5;
  base!.PAIR_TUNE.belowDeg = 1.5;
  for (let i = 0; i < 2000; i++) {
    day.time = i / 2000;
    day.update(0, false);
    pairDirectionIn(day.sunDir.x, day.sunDir.y, day.sunDir.z, a);
    base!.pairDirectionIn(day.sunDir.x, day.sunDir.y, day.sunDir.z, b);
    n++;
    if (Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z)) same++;
  }
  ok(same === n, `at angle 0 the second sun is the base's to the bit: ${same} of ${n} directions (five distances, six casters, a whole day of SWG's path)`);
}

// ---------------------------------------------------------------- 2. beside, above, behind
{
  const q = v();
  let worstDist = 0;
  for (const angle of [90, 180, -90, 45, -135]) {
    PAIR_TUNE.angleDeg = angle;
    for (const below of [1.5, 6]) {
      PAIR_TUNE.belowDeg = below;
      for (const c of CASTERS) {
        pairDirectionIn(c.x, c.y, c.z, q);
        worstDist = Math.max(worstDist, Math.abs(apartDeg(c, q) - below), Math.abs(Math.sqrt(dot(q, q)) - 1));
      }
    }
  }
  ok(worstDist < 1e-9, `at every angle the second stands the distance dial's degrees from the caster along the sky, a unit direction (worst ${worstDist.toExponential(2)})`);
  // Above: the caster's elevation plus the distance on its own azimuth (while that stays under the zenith).
  PAIR_TUNE.angleDeg = 180;
  PAIR_TUNE.belowDeg = 3;
  const c = unit(0.3, 0.5, -0.81);
  pairDirectionIn(c.x, c.y, c.z, q);
  ok(Math.abs(Math.asin(q.y) / DEG - (Math.asin(c.y) / DEG + 3)) < 1e-9 && Math.abs(Math.atan2(q.x, q.z) - Math.atan2(c.x, c.z)) < 1e-9, 'at 180 it stands straight above the caster');
  // Beside: on the caster's own height near enough (the sky's curve lowers it a hair) and on the side SWG's path runs toward,
  // through a whole day: where the caster stands a moment later is nearer the second than where it stands now.
  const day = new DayCycle(0.6, 70 * DEG);
  day.swg = true;
  const now = v();
  const next = v();
  let toward = 0;
  let tried = 0;
  let worstHeight = 0;
  for (const angle of [90, -90]) {
    PAIR_TUNE.angleDeg = angle;
    PAIR_TUNE.belowDeg = 1.5;
    for (let i = 0; i < 400; i++) {
      day.time = 0.27 + (0.46 * i) / 400;
      day.update(0, false);
      now.x = day.sunDir.x;
      now.y = day.sunDir.y;
      now.z = day.sunDir.z;
      pairDirectionIn(now.x, now.y, now.z, q);
      day.time += 0.0005;
      day.update(0, false);
      next.x = day.sunDir.x;
      next.y = day.sunDir.y;
      next.z = day.sunDir.z;
      tried++;
      const closer = apartDeg(next, q) < apartDeg(now, q);
      if (closer === (angle === 90)) toward++;
      worstHeight = Math.max(worstHeight, Math.abs(Math.asin(q.y) - Math.asin(now.y)) / DEG);
    }
  }
  ok(toward === tried, `at 90 the caster goes toward the second all day (ahead on its path), at -90 away from it (${toward} of ${tried} moments)`);
  // The curve's own lowering: about half the distance squared times the tangent of the height (1.5 degrees at SWG's 67.5: 0.05).
  const curve = ((1.5 * DEG) ** 2 / 2) * Math.tan(70 * DEG) / DEG;
  ok(worstHeight < curve * 1.05, `and beside it stands at the caster's own height but for the sky's curve (worst ${worstHeight.toFixed(4)} degrees, the curve's ${curve.toFixed(4)})`);
  PAIR_TUNE.angleDeg = 0;
  PAIR_TUNE.belowDeg = 1.5;
}

// ---------------------------------------------------------------- 3. the dials
{
  // Asked first, before any dial moves: the set reads what the game shipped the first time it is asked.
  const shipped = skyDialSet().shipped;
  ok(shipped.get('pair.angleDeg') === 0 && shipped.get('pair.belowDeg') === 1.5, 'shipped at 0 and 1.5: the decision of 18 November, nothing moved');
  const before = PAIR_MOVES.n;
  ok(tuneSky({ pair: { angleDeg: 90 } }).length === 0 && PAIR_TUNE.angleDeg === 90 && PAIR_MOVES.n === before + 1, 'the angle dial moves through tuneSky, and the move is counted');
  ok(tuneSky({ pair: { angleDeg: 400, belowDeg: 99 } }).length === 2 && PAIR_TUNE.angleDeg === 180 && PAIR_TUNE.belowDeg === SKY_TUNE_RANGE.pair.belowDeg[1], 'both held to their ranges and say so');
  tuneSky({ pair: { angleDeg: 0, belowDeg: 1.5 } });
  const group = skyDialSet().groups.find((g) => g.title === "Tatooine's second sun")!;
  const labels = group.dials.map((d) => ('label' in d ? d.label : ''));
  ok(labels.includes('Distance from the first') && labels.includes('Angle round the first'), `the sky helper's "Tatooine's second sun" holds both (${labels.join(', ')})`);
}

// ---------------------------------------------------------------- 4. a loading screen's word
{
  pairDialsFrom({ angleDeg: 0, distanceDeg: 2.06 });
  ok(PAIR_TUNE.angleDeg === 0 && PAIR_TUNE.belowDeg === 2.06, "an applied system's pair sets the dials at its screen");
  pairDialsFrom(null);
  ok(PAIR_TUNE.angleDeg === 0 && PAIR_TUNE.belowDeg === 1.5, 'a screen with none puts them back where they stood');
  pairDialsFrom({ angleDeg: 30, distanceDeg: 3 });
  tuneSky({ pair: { angleDeg: 120 } });
  pairDialsFrom(null);
  ok(PAIR_TUNE.angleDeg === 120 && PAIR_TUNE.belowDeg === 1.5, 'a dial he moved since stays where he put it; the untouched one goes back');
  tuneSky({ pair: { angleDeg: 0, belowDeg: 1.5 } });
}

// ---------------------------------------------------------------- 5. under an applied system
{
  sharedClock.wall = () => Date.UTC(2026, 10, 23, 18, 7, 13);
  sharedClock.none();
  const SKY = { sun: { size: 0.6 }, supplementalSun: { size: 0.55 }, moon: { size: 0.5 }, supplementalMoon: { size: 0.25 } };
  const systems: Record<string, unknown> = { tatoo: draftSystem('tatoo') };
  type M = { at(d: { count: number }): void; dir: Float64Array; casterJ: number; secondJ: number; sun: V; sun2: V; lengthSeconds: number; phase: number; pairSays: { angleDeg: number; distanceDeg: number } | null };
  const tat = skyMotionFor(systems, 'tatooine', 'tatooine', SKY) as unknown as M;
  ok(!!tat && tat.secondJ >= 0, "Tatooine under the viewer's Tatoo draft has its pair");
  ok(!!tat.pairSays && tat.pairSays.angleDeg === 0 && Math.abs(tat.pairSays.distanceDeg - (0.32 + 0.24 + 1.5)) < 1e-6, `the system says the dial's angle 0 for its Line angle -90 and ${tat.pairSays?.distanceDeg} degrees middle to middle (the discs' radii and its 1.5 between their edges)`);
  const baseMod = await atBase<{ skyMotionFor: typeof skyMotionFor }>('src/sky/system/skyMotion.ts', BASE);
  const was = baseMod!.skyMotionFor(systems, 'tatooine', 'tatooine', SKY) as unknown as M;
  const start = Math.floor(Date.UTC(2026, 10, 23) / (tat.lengthSeconds * 1000) + tat.phase);
  const rec = { count: start };
  let same = 0;
  for (let i = 0; i < 600; i++) {
    rec.count = start + i / 600;
    tat.at(rec);
    was.at(rec);
    const b = 3 * tat.secondJ;
    if (Object.is(tat.dir[b], was.dir[b]) && Object.is(tat.dir[b + 1], was.dir[b + 1]) && Object.is(tat.dir[b + 2], was.dir[b + 2])) same++;
  }
  ok(same === 600, `until the dials are moved the applied pair is the base's to the bit (${same} of 600 moments of a day)`);
  // The screen's word, then moved by hand to the very same numbers: where the system's own numbers put it.
  pairDialsFrom(tat.pairSays);
  tuneSky({ pair: { angleDeg: tat.pairSays!.angleDeg, belowDeg: tat.pairSays!.distanceDeg } });
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    rec.count = start + i / 300;
    tat.at(rec);
    was.at(rec);
    const b = 3 * tat.secondJ;
    worst = Math.max(worst, Math.abs(tat.dir[b] - was.dir[b]), Math.abs(tat.dir[b + 1] - was.dir[b + 1]), Math.abs(tat.dir[b + 2] - was.dir[b + 2]));
  }
  ok(worst < 1e-7, `the dials at the system's word stand the pair where the system's Line angle and Separation do (worst ${worst.toExponential(2)}): one direction, the dial 90 more than the Line angle`);
  // Beside, ahead along the sun's path; the distance the dial's.
  tuneSky({ pair: { angleDeg: 90, belowDeg: 4 } });
  const now = v();
  const next = v();
  const q = v();
  let toward = 0;
  let tried = 0;
  let worstDist = 0;
  for (let i = 0; i < 200; i++) {
    rec.count = start + 0.3 + (0.4 * i) / 200;
    tat.at(rec);
    now.x = tat.sun.x;
    now.y = tat.sun.y;
    now.z = tat.sun.z;
    q.x = tat.sun2.x;
    q.y = tat.sun2.y;
    q.z = tat.sun2.z;
    worstDist = Math.max(worstDist, Math.abs(apartDeg(now, q) - 4));
    rec.count += 0.0005;
    tat.at(rec);
    next.x = tat.sun.x;
    next.y = tat.sun.y;
    next.z = tat.sun.z;
    tried++;
    if (apartDeg(next, q) < apartDeg(now, q)) toward++;
  }
  ok(toward === tried, `moved to 90 under the applied system the second stands ahead on the sun's path too (${toward} of ${tried} moments)`);
  ok(worstDist < 1e-9, `and 4 degrees from the caster at every moment, as the dial says (worst ${worstDist.toExponential(2)})`);
  // A new screen: the system's own numbers again, its word on the dials.
  const again = skyMotionFor(systems, 'tatooine', 'tatooine', SKY) as unknown as M;
  pairDialsFrom(again.pairSays);
  rec.count = start + 0.5;
  again.at(rec);
  was.at(rec);
  const b = 3 * again.secondJ;
  ok(Object.is(again.dir[b], was.dir[b]) && PAIR_TUNE.angleDeg === 0 && Math.abs(PAIR_TUNE.belowDeg - 2.06) < 1e-6, 'the next screen stands it by the system again and shows its word on the dials (the file wins at a screen)');
  pairDialsFrom(null);
  tuneSky({ pair: { angleDeg: 0, belowDeg: 1.5 } });
}

console.log(`\npairAngle: ${checks} checks passed`);
