// Everybody else's blades, checked without a browser: what a weapon in a hand reaches to, what a
// swing by anybody who is not the player is worth and how that tuning may be moved, and -- the one
// that matters -- that a fighter's swing cannot be mistaken for the player's in the readout.
//
// That last is not a nicety. The player's blades and everybody else's are swept at two different
// simulated seconds of the same drawn frame (the loop sweeps the player, then the world's clock
// moves, then the fighters), and `SABER_HIT_STATS` is one shared record whose per-frame counters
// zero themselves whenever the second changes. A fighter writing into it straight would wipe the
// player's own figures every single frame and add its cuts to the player's swing, so the whole of
// `__debug.saber()` -- the wave's only instrument -- would read as nonsense. The borrow below is
// what stops it, and this drives the real `PathMemory` loop the game runs rather than a mirror.
import assert from 'node:assert/strict';
import { PathMemory, SABER_HIT_STATS, saberHitReport, saberSwingStart, type HitLedger, type Vec3Like } from '../../../src/combat/saberHit.ts';
import {
  BLADE_SWING,
  BLADE_SWING_STATS,
  bladeSwingReport,
  borrowSwingFigures,
  noteBladeLookup,
  noteBladeSwept,
  noteBladeSwing,
  noteTimerBlow,
  returnSwingFigures,
  tuneBladeSwing,
  weaponFarPoint,
} from '../../../src/world/mobiles/arms.ts';
import type { Hittable } from '../../../src/combat/kit.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const v = (x: number, y: number, z: number): Vec3Like => ({ x, y, z });
/** A stand-in for something that can be hurt: the ledger only ever compares it by identity. */
const body = (name: string): Hittable => ({ name }) as unknown as Hittable;
/** A ledger of the kind a swing keeps: one bite per body per swing. */
const ledger = (): HitLedger => {
  const seen = new Set<Hittable>();
  return { has: (c) => seen.has(c), add: (c) => void seen.add(c) };
};

// --- the far end of a weapon held in the hand -------------------------------------------------
//
// A lightsaber's blade file says how long the blade is; a sword's says nothing at all, so the
// model's own longest extent answers, and the manifest's corners come swapped from some packs.

{
  const blade = weaponFarPoint({ min: [-0.03, -0.6, -0.03], max: [0.03, 0.6, 0.03] }, 1);
  ok(blade.axis === 1 && Math.abs(blade.distance - 0.6) < 1e-9, 'a blade reaches up its own longest axis');
  const swapped = weaponFarPoint({ min: [0.03, 0.6, 0.03], max: [-0.03, -0.6, -0.03] }, 1);
  ok(swapped.axis === 1 && Math.abs(Math.abs(swapped.distance) - 0.6) < 1e-9, 'corners the wrong way round still name the longest axis and the same reach');
  ok(weaponFarPoint({ min: [0, 0, -0.1], max: [0, 0, 1.4] }, 1).axis === 2, 'a shaft modelled down Z is read down Z');
  ok(Math.abs(weaponFarPoint({ min: [0, 0, -0.1], max: [0, 0, 1.4] }, 1).distance - 1.4) < 1e-9, 'and it reaches the far end of itself, not the near one');
  const none = weaponFarPoint(null, 0.7);
  ok(none.axis === 1 && none.distance === 0.7, 'with no bounds at all a weapon reaches its own length, up the model');
  ok(weaponFarPoint({ min: [0, 0], max: [1, 1] } as unknown as { min: number[]; max: number[] }, 0.4).distance === 0.4, 'and bounds that are short of three numbers are no bounds');
}

// --- the tuning -------------------------------------------------------------------------------

{
  ok(BLADE_SWING.window > 0, 'a swing has a window to be live for');
  ok(BLADE_SWING.fighterSaber === 32 && BLADE_SWING.fighterMelee === 18 && BLADE_SWING.fighterPush === 4, 'and the damages and the shove are exactly the ones the timer dealt before');
  ok(BLADE_SWING.timerReach === 2.8, 'and so is the reach the fallback blow still uses');

  tuneBladeSwing({ window: 0.2, fighterSaber: 40 });
  ok(BLADE_SWING.window === 0.2 && BLADE_SWING.fighterSaber === 40, 'the knob moves what it is given');
  ok(BLADE_SWING.fighterMelee === 18, 'and nothing it was not');
  tuneBladeSwing({ window: -5, fighterPush: -1, timerReach: -2 });
  ok(BLADE_SWING.window === 0 && BLADE_SWING.fighterPush === 0 && BLADE_SWING.timerReach === 0, 'nothing here goes negative: a window of nought is a swing that lands nothing, which is legible');
  tuneBladeSwing({ meleeSpark: 0xffd0a0 + 0.5 });
  ok(BLADE_SWING.meleeSpark === 0xffd0a0, 'a colour stays a whole number');
  tuneBladeSwing({ meleeSpark: 0xffffff * 2 });
  ok(BLADE_SWING.meleeSpark === 0xffffff, 'and inside a byte apiece');
  tuneBladeSwing({ window: Number.NaN });
  ok(BLADE_SWING.window === 0, 'and a number that is not one is ignored rather than written');
  // The baked numbers back, so everything below reads the shipped tuning.
  tuneBladeSwing({ window: 0.32, fighterSaber: 32, fighterMelee: 18, fighterPush: 4, timerReach: 2.8, meleeSpark: 0xffd0a0 });
  ok(BLADE_SWING.window === 0.32 && BLADE_SWING.fighterSaber === 32 && BLADE_SWING.meleeSpark === 0xffd0a0, 'and the baked numbers go back');
  ok(bladeSwingReport().tune.window === BLADE_SWING.window, 'the readout carries the tuning that is in force');
}

// --- the frame figures ------------------------------------------------------------------------

{
  noteBladeSwept(10, 3, 3, 0.9, 0, 1);
  noteBladeSwept(10, 1, 1, 0.1, 1, 0);
  const f = bladeSwingReport().frame;
  ok(f.blades === 2 && f.casts === 4, 'two blades swept in one frame are two blades and their casts added');
  ok(f.steps === 3 && Math.abs(f.travel - 0.9) < 1e-9, 'the sub-steps and the travel are the worst of them, not the sum');
  ok(f.fresh === 1 && f.hits === 1, 'and the fresh paths and the bodies cut are counted');
  noteBladeSwept(10.016, 1, 1, 0.2, 0, 0);
  ok(bladeSwingReport().frame.blades === 1, 'a new simulated second starts the frame figures again');

  const before = bladeSwingReport().total;
  noteBladeSwing(false);
  noteBladeSwing(true);
  noteTimerBlow();
  const after = bladeSwingReport().total;
  ok(after.swings === before.swings + 2 && after.blind === before.blind + 1, 'a swing with nothing to find is counted apart from one that could find somebody');
  ok(after.fellBack === before.fellBack + 1, 'and so is a blow the old timer had to land instead');
  noteBladeLookup(false);
  ok(bladeSwingReport().lookup.startsWith('none'), 'with nothing wired to name a collider the readout says so in words');
  noteBladeLookup(true);
  ok(bladeSwingReport().lookup === 'wired', 'and says so when it is');
}

// --- the one that matters: a fighter's swing is not the player's -------------------------------
//
// The order below is the frame loop's own: the player is swept at `now`, the world's clock then
// moves on by a step, and the fighters are swept at `now + dt`.

{
  const now = 100;
  const dt = 1 / 60;
  const cast = (): number => 0;
  const cut = (): number => 1;

  // The player swings and cuts one body.
  saberSwingStart(7);
  const mine = new PathMemory();
  mine.mark(v(0, 1, 0), v(0, 1, 1.3), now - dt);
  // A fifth of a metre: one sub-step, so the counts below are the frame's and not the path's.
  mine.step(now, v(0.2, 1, 0), v(0.2, 1, 1.3), ledger(), cut);
  const playerFrame = saberHitReport().frame;
  const playerHits = saberHitReport().swing.hits;
  ok(playerFrame.blades === 1 && playerHits === 1, "the player's own blade is one blade in the frame, and its cut is its swing's");

  // Three fighters, at the next simulated second, each through the borrow.
  const before = bladeSwingReport().total.cuts;
  for (let i = 0; i < 3; i++) {
    const theirs = new PathMemory();
    theirs.mark(v(i, 1, 0), v(i, 1, 1), now);
    borrowSwingFigures(now + dt);
    try {
      theirs.step(now + dt, v(i + 0.2, 1, 0), v(i + 0.2, 1, 1), ledger(), i === 0 ? cut : cast);
    } finally {
      returnSwingFigures(now + dt);
    }
  }

  const stillMine = saberHitReport();
  ok(stillMine.frame.blades === 1, "three fighters swinging leave the player's frame figures alone");
  ok(stillMine.frame.at === playerFrame.at && stillMine.frame.casts === playerFrame.casts, 'the frame they were counted in and what it cost are untouched');
  ok(stillMine.swing.hits === 1, "and a fighter's cut is never counted as the player's swing");
  ok(SABER_HIT_STATS.at === now, "the shared record is left at the player's own second, so the next frame starts it again as it always did");

  const theirFrame = bladeSwingReport().frame;
  ok(Math.abs(theirFrame.at - (now + dt)) < 1e-3 && theirFrame.blades === 3, 'and the three of them are three blades in a frame of their own');
  ok(theirFrame.casts === 3 && theirFrame.hits === 1, 'with their casts and their one cut kept apart');
  ok(bladeSwingReport().total.cuts === before + 1, 'which is also what the running total counts');
}

// --- one swing, one bite, however many frames it is swept over ---------------------------------
//
// The fighters hold one ledger for the whole window rather than one per frame, exactly as the
// player's swing does; a window is several frames long, so this is the rule that keeps a swing
// held against somebody from taking its damage sixty times a second.

{
  const them = body('a body in the way');
  const held = ledger();
  let cuts = 0;
  const tryCut = (_a: Vec3Like, _b: Vec3Like, already: HitLedger): number => {
    if (already.has(them)) return 0;
    already.add(them);
    cuts++;
    return 1;
  };
  const path = new PathMemory();
  let t = 200;
  path.mark(v(0, 1, 0), v(0, 1, 1), t);
  for (let frame = 0; frame < 12; frame++) {
    t += 1 / 60;
    path.step(t, v(0.1 * frame, 1, 0), v(0.1 * frame, 1, 1), held, tryCut);
  }
  ok(cuts === 1, 'a swing swept over twelve frames still takes one bite out of one body');
}

console.log(`${checks} checks passed`);
