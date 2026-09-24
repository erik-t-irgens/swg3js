// The ground fighters' skill tiers (src/world/groundSkill.ts), which are the ground equivalent of
// `PILOT_SKILL` in `src/space/pilot.ts` and are invented from end to end.
//
// Five things are pinned here, and the last two are measurements rather than assertions.
//
// **The ladder really is a ladder.** Every field moves the same way for the whole five tiers, and
// the direction each one moves in is written down here rather than in the table, so a number typed
// into the table backwards fails on this line instead of in the owner's evening. There is no tier
// that is better at one thing and worse at another, which is a deliberate simplicity.
//
// **The bottom two tiers are the game as it stands.** `strafe` is nought there on purpose: facing
// and movement are one number for every body in this game today, so tiers 1 and 2 are the fighter
// the owner already knows and the split is something the top three earn. If that ever stops being
// true, this is the line that says so.
//
// **The knob writes the rows in place.** A body holds its own tier's object from the moment it is
// made, so a knob that replaced a row would reach nothing already standing; the same identity is
// checked before and after, and a bad value is checked not to empty a field.
//
// **What a tier's rate of fire really is.** Not arithmetic about the table: `fireStep` is driven at
// a sixtieth of a second for thirty seconds per tier and the shots are counted, so the burst, the
// gap and the rest are measured together the way a body will meet them.
//
// **And what a tier's scatter really is.** Twenty thousand shots a tier through `aimScatter`, with
// the mean and the worst miss measured against the cone the tier names -- which is how the even
// spread over the disc is checked, since a scatter drawn straight would land near the middle far
// too often and a tier's cone would quietly mean something narrower than its number.
//
// Synthetic throughout: every number below is either written in this file, read out of the module
// under test, or read as text out of `src/world/npcs.ts`. Nothing comes from the game's archives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GROUND_SKILL,
  GROUND_TIERS,
  GROUND_TUNE,
  aimScatter,
  coverDue,
  fireReset,
  fireStep,
  skillOfGroundTier,
  strafeShare,
  thinkEvery,
  tuneGroundSkill,
  willFire,
  type AimScatter,
  type FireClock,
  type GroundSkill,
} from '../../../src/world/groundSkill.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const DEG = Math.PI / 180;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

// --- 1: the table is a ladder -------------------------------------------------------------------
//
// Which way each field moves as a body gets better. 'up' is better at the top, 'down' is better at
// the bottom, and every one of them is strict from tier to tier except where a row deliberately
// repeats (a burst of two shots at tiers 2 and 3, of three at tiers 4 and 5), which is 'flat-ok'.

type Way = 'up' | 'down' | 'up-ok' | 'down-ok';
const LADDER: Record<keyof GroundSkill, Way> = {
  reaction: 'down',
  scatterDeg: 'down',
  aimConeDeg: 'down',
  lead: 'up',
  burst: 'up-ok',
  burstGap: 'down',
  burstRest: 'down',
  strafe: 'up-ok',
  coverEvery: 'down',
  coverWalk: 'up',
  hardCost: 'up',
};

ok(Object.keys(GROUND_SKILL).length === GROUND_TIERS, `the table holds exactly the ${GROUND_TIERS} tiers and no sixth`);

for (const key of Object.keys(LADDER) as (keyof GroundSkill)[]) {
  const way = LADDER[key];
  let good = true;
  for (let t = 2; t <= GROUND_TIERS; t++) {
    const a = GROUND_SKILL[t - 1][key];
    const b = GROUND_SKILL[t][key];
    if (!Number.isFinite(a) || !Number.isFinite(b)) good = false;
    else if (way === 'up') good &&= b > a;
    else if (way === 'down') good &&= b < a;
    else if (way === 'up-ok') good &&= b >= a;
    else good &&= b <= a;
  }
  const span = `${GROUND_SKILL[1][key]} to ${GROUND_SKILL[GROUND_TIERS][key]}`;
  ok(good, `${key} runs the right way the whole ladder (${span})`);
}

ok(GROUND_SKILL[1].strafe === 0 && GROUND_SKILL[2].strafe === 0, 'the bottom two tiers never strafe at all, which is every body in this game today');
ok(GROUND_SKILL[3].strafe > 0, 'and the split is something tier 3 and up earn');

// --- 2: the picker --------------------------------------------------------------------------------

ok(skillOfGroundTier(3) === GROUND_SKILL[3], 'a tier hands back its own row, not a copy: a body holds it and a knob reaches the body');
ok(skillOfGroundTier(0) === GROUND_SKILL[1] && skillOfGroundTier(99) === GROUND_SKILL[GROUND_TIERS], 'a tier outside the ladder is clamped rather than refused');
ok(skillOfGroundTier(2.4) === GROUND_SKILL[2] && skillOfGroundTier(2.6) === GROUND_SKILL[3], 'and a fractional tier rounds');
ok(skillOfGroundTier(Number.NaN) === GROUND_SKILL[1], 'a tier that is not a number is the bottom of the ladder and never undefined');

// --- 3: where today's fighter sits ----------------------------------------------------------------
//
// The table is only worth anything if the middle of it is recognisably the body the owner already
// has. `FIGHTER_TUNE` is read as text rather than imported, the way `fighterPosture.test.ts` reads
// `player.ts`, because importing `npcs.ts` would drag three and the whole world in with it.

const npcSrc = readFileSync(join(root, 'src', 'world', 'npcs.ts'), 'utf8');
const numberIn = (field: string): number => {
  const m = new RegExp(`\\n  ${field}: (-?[0-9.]+),`).exec(npcSrc);
  assert.ok(m, `FIGHTER_TUNE.${field} is still written as a plain number in npcs.ts`);
  return Number(m[1]);
};
const todayThink = numberIn('think');
const todaySpread = numberIn('aimSpread');
const todayCone = numberIn('aimCone');
const todayEvery = numberIn('gunEvery');

const spans = (v: number, pick: (s: GroundSkill) => number): boolean => {
  const lo = Math.min(...Object.values(GROUND_SKILL).map(pick));
  const hi = Math.max(...Object.values(GROUND_SKILL).map(pick));
  return v >= lo && v <= hi;
};
ok(spans(todayThink, (s) => s.reaction), `today's flat think (${todayThink}s) is inside the ladder's own span of reactions`);
ok(spans(todaySpread / DEG, (s) => s.scatterDeg), `today's flat scatter (${(todaySpread / DEG).toFixed(2)} degrees) is inside the ladder's span`);
ok(spans(todayCone / DEG, (s) => s.aimConeDeg), `today's flat cone (${(todayCone / DEG).toFixed(1)} degrees) is inside the ladder's span`);
ok(GROUND_SKILL[3].aimConeDeg === Number((todayCone / DEG).toFixed(1)), 'and tier 3 is that cone exactly, so the middle of the ladder is the body that already exists');

// --- 4: the cone, the jitter and the strafe band ---------------------------------------------------

{
  const s = skillOfGroundTier(3);
  ok(willFire(s, 0) && willFire(s, s.aimConeDeg * DEG * 0.99), 'a body fires inside its cone');
  ok(!willFire(s, s.aimConeDeg * DEG * 1.01), 'and holds its fire outside it');
  ok(willFire(s, -s.aimConeDeg * DEG * 0.5), 'either side of its nose');
  ok(!willFire(skillOfGroundTier(5), skillOfGroundTier(5).aimConeDeg * DEG + 0.01) && willFire(skillOfGroundTier(1), skillOfGroundTier(5).aimConeDeg * DEG + 0.01), 'and a wild tier-1 body lets fly at an angle a tier-5 one would wait out');

  ok(thinkEvery(s, 0.5) === s.reaction, 'a thought at the middle of the draw is exactly the tier\'s reaction');
  ok(thinkEvery(s, 0) === s.reaction * (1 - GROUND_TUNE.jitter) && thinkEvery(s, 1) === s.reaction * (1 + GROUND_TUNE.jitter), 'and the draw spreads it either way by the jitter and no further');
  ok(thinkEvery(s, Number.NaN) === s.reaction, 'a draw that is not a number is the middle rather than a body that never thinks again');

  const t5 = skillOfGroundTier(5);
  ok(strafeShare(t5, true, 10) === t5.strafe, 'a top-tier body puts its whole share sideways at a workable range');
  ok(strafeShare(t5, false, 10) === 0, 'with nothing to keep its gun on it does not strafe');
  ok(strafeShare(t5, true, GROUND_TUNE.strafeFrom - 0.01) === 0, 'nor nose to nose, where there is nowhere to slide to');
  ok(strafeShare(t5, true, GROUND_TUNE.strafeTo + 0.01) === 0, 'nor at a range where a slide would read as a wobble');
  ok(strafeShare(skillOfGroundTier(1), true, 10) === 0, 'and a tier-1 body never strafes at any range');

  ok(coverDue(s, s.coverEvery) && !coverDue(s, s.coverEvery - 0.01), 'a body looks for cover once its tier\'s own clock has run');
  ok(skillOfGroundTier(1).coverEvery > skillOfGroundTier(5).coverEvery * 4, 'and a tier-1 body looks several times less often than a tier-5 one');
}

// --- 5: the trigger, measured -----------------------------------------------------------------------
//
// Thirty seconds a tier at a sixtieth of a second, with the body always able to shoot, so the burst,
// the gap and the rest are met the way a body meets them rather than reasoned about.

const DT = 1 / 60;
const SECONDS = 30;
const clock: FireClock = { wait: 0, shots: 0 };
const rates: number[] = [];
console.log('\n  tier | burst | gap  | rest | shots/s | longest quiet');
console.log('  -----+-------+------+------+---------+--------------');
for (let tier = 1; tier <= GROUND_TIERS; tier++) {
  const s = skillOfGroundTier(tier);
  fireReset(clock, 0);
  let shots = 0;
  let quiet = 0;
  let worstQuiet = 0;
  for (let i = 0; i < SECONDS / DT; i++) {
    if (fireStep(clock, s, DT)) {
      shots++;
      if (quiet > worstQuiet) worstQuiet = quiet;
      quiet = 0;
    } else {
      quiet += DT;
    }
  }
  const rate = shots / SECONDS;
  rates.push(rate);
  console.log(`   ${tier}   |   ${s.burst}   | ${s.burstGap.toFixed(2)} | ${s.burstRest.toFixed(2)} |  ${rate.toFixed(2)}   |   ${worstQuiet.toFixed(2)}s`);
  const want = s.burst / (s.burstGap * (s.burst - 1) + s.burstRest);
  ok(Math.abs(rate - want) < 0.12, `tier ${tier} fires ${rate.toFixed(2)} shots a second, which is the burst and the rest it names (${want.toFixed(2)})`);
  ok(worstQuiet >= s.burstRest - DT * 2, `and really does stop firing for ${s.burstRest}s between bursts, which is what today's fighter never does`);
}
for (let t = 1; t < GROUND_TIERS; t++) ok(rates[t] > rates[t - 1], `a tier-${t + 1} body fires faster than a tier-${t} one`);
ok(rates[0] < 0.6, `a tier-1 body is down to ${rates[0].toFixed(2)} shots a second, against the flat ${(1 / (todayEvery + 0.15)).toFixed(2)} every fighter fires today`);

{
  fireReset(clock, 1.5);
  let fired = false;
  for (let i = 0; i < 1.4 / DT; i++) fired ||= fireStep(clock, skillOfGroundTier(5), DT);
  ok(!fired, 'a trigger reset with a wait on it holds its fire for that long: a slow body is slow on the trigger as well as slow to think');
  ok(clock.shots === 0, 'and its burst really did start again from nothing');
}

// --- 6: the scatter, measured -------------------------------------------------------------------------
//
// An even spread over the cone's own disc, which is the whole reason the magnitude is a square root.
// Drawn straight instead, the mean miss would be half the cone rather than two thirds of it.

const out: AimScatter = { yaw: 0, pitch: 0 };
/** A plain repeatable generator, so the numbers below are the same on every machine. */
let seed = 0x9e3779b9;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};
console.log('\n  tier | cone  | mean miss | worst miss | inner half');
console.log('  -----+-------+-----------+------------+-----------');
const means: number[] = [];
for (let tier = 1; tier <= GROUND_TIERS; tier++) {
  const s = skillOfGroundTier(tier);
  let sum = 0;
  let worst = 0;
  let inner = 0;
  const shots = 20000;
  for (let i = 0; i < shots; i++) {
    aimScatter(s, rnd(), rnd(), out);
    const m = Math.hypot(out.yaw, out.pitch) / DEG;
    sum += m;
    if (m > worst) worst = m;
    if (m <= s.scatterDeg / 2) inner++;
  }
  const mean = sum / shots;
  means.push(mean);
  console.log(`   ${tier}   | ${s.scatterDeg.toFixed(1)}° |   ${mean.toFixed(2)}°   |   ${worst.toFixed(2)}°    |    ${((inner / shots) * 100).toFixed(1)}%`);
  ok(worst <= s.scatterDeg + 1e-9, `tier ${tier}'s worst shot is inside the cone it names (${worst.toFixed(2)}° of ${s.scatterDeg}°)`);
  ok(Math.abs(mean - (2 / 3) * s.scatterDeg) < 0.05 * s.scatterDeg, `and its mean miss is two thirds of it (${mean.toFixed(2)}°), which is what an even spread over the disc gives`);
  ok(Math.abs(inner / shots - 0.25) < 0.02, 'with a quarter of the shots inside the inner half of the cone, not half of them');
}
for (let t = 1; t < GROUND_TIERS; t++) ok(means[t] < means[t - 1], `a tier-${t + 1} body shoots straighter than a tier-${t} one`);

{
  aimScatter(skillOfGroundTier(3), 0, 0, out);
  ok(out.yaw === 0 && out.pitch === 0, 'a draw of nought is a shot dead on the aim rather than a NaN');
  aimScatter(skillOfGroundTier(3), Number.NaN, Number.NaN, out);
  ok(Number.isFinite(out.yaw) && Number.isFinite(out.pitch), 'and a draw that is not a number can never put a NaN on a bolt');
}

// --- 7: the knob --------------------------------------------------------------------------------------

{
  const row = GROUND_SKILL[1];
  const was = row.strafe;
  const back = tuneGroundSkill({ 1: { strafe: 0.4 } });
  ok(back === GROUND_SKILL && GROUND_SKILL[1] === row, 'the knob writes the row in place, so a body already standing sees the change');
  ok(row.strafe === 0.4, 'and the change is really there');
  tuneGroundSkill({ 1: { strafe: 5 } });
  ok(row.strafe === 1, 'a share past one is capped rather than taken: a body cannot move more sideways than it moves');
  tuneGroundSkill({ 1: { strafe: -3 } });
  ok(row.strafe === 0, 'and below nought it is floored');
  tuneGroundSkill({ 1: { burst: 0 } });
  ok(row.burst === 1, 'a burst of no shots is floored at one: a body that never fires is a bug and not a tier');
  tuneGroundSkill({ 1: { reaction: Number.NaN, scatterDeg: 'wide' as unknown as number } });
  ok(Number.isFinite(row.reaction) && Number.isFinite(row.scatterDeg), 'anything that is not a finite number is left alone, so a typo in the console cannot empty a row');
  tuneGroundSkill({ 9: { strafe: 1 }, 0: { strafe: 1 } });
  ok(true, 'a tier that is not on the ladder is passed over rather than thrown');
  tuneGroundSkill({ tune: { strafeTo: 44 } });
  ok(GROUND_TUNE.strafeTo === 44, 'and the two numbers beside the table move in the same call');
  tuneGroundSkill({ tune: { strafeTo: 30 }, 1: { strafe: was, burst: 1, reaction: 1.0, scatterDeg: 6 } });
  ok(GROUND_SKILL[1].strafe === was && GROUND_TUNE.strafeTo === 30, 'and back again, so the rest of this run measures the shipped table');
  ok(tuneGroundSkill() === GROUND_SKILL && tuneGroundSkill(null) === GROUND_SKILL, 'asked for nothing, the knob is a read');
}

console.log(`\n${checks} checks passed`);
