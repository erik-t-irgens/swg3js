// What being on fire does to the player: how a burn is taken, how it is spent, and when each of the
// two lines falls due. Pure arithmetic, so this test runs exactly what the game runs.
//
// **Every number in this file is invented for the test**, and so is every number it checks: the
// client had a fire state and a chime for it and nothing whatever about what it cost you or how
// often, because that was its server's and did not ship. What is checked here is therefore the
// *rules* -- the greater of two burns wins, a burn costs exactly what was asked for however the
// frames fall, and each line is said exactly once -- and not any particular fire.
import assert from 'node:assert/strict';
import {
  PLAYER_BURN,
  burnReport,
  clearBurn,
  newPlayerBurn,
  stepBurn,
  takeBurn,
  tunePlayerBurn,
  type PlayerBurn,
} from '../../../src/combat/burnMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const close = (a: number, b: number, msg: string, eps = 1e-9) => ok(Math.abs(a - b) <= eps, `${msg} (${a} ~ ${b})`);

/** The knobs as the file declares them, so one case cannot leak its tuning into the next. */
const DEFAULTS = { on: PLAYER_BURN.on, tick: PLAYER_BURN.tick, cap: PLAYER_BURN.cap };
const reset = (): void => {
  PLAYER_BURN.on = DEFAULTS.on;
  PLAYER_BURN.tick = DEFAULTS.tick;
  PLAYER_BURN.cap = DEFAULTS.cap;
};

/**
 * Run a burn out at `dt` a frame and report what it came to. The one rule the shared result object
 * imposes is that it is read before the next call, which is what this does and what the game does.
 */
function burnOut(b: PlayerBurn, dt: number, limit = 100000): { total: number; blows: number; starts: number; ends: number; frames: number } {
  let total = 0;
  let blows = 0;
  let starts = 0;
  let ends = 0;
  let frames = 0;
  while (b.left > 0 && frames < limit) {
    const r = stepBurn(b, dt);
    if (r.started) starts++;
    if (r.ended) ends++;
    if (r.damage > 0) {
      total += r.damage;
      blows++;
    }
    frames++;
  }
  return { total, blows, starts, ends, frames };
}

// --- taking one ---------------------------------------------------------------------------------

{
  reset();
  const b = newPlayerBurn();
  ok(!(b.left > 0), 'a fresh record is not burning');
  ok(takeBurn(b, 8, 3), 'a burn of 8 a second for 3 seconds is taken');
  close(burnOut(b, 1 / 60).total, 24, 'and is worth 8 x 3 when it is spent');
}

{
  // The rule every other body already uses: the greater of dps x seconds wins, so a weak burn never
  // cuts a strong one short and two burns never stack into something neither striker asked for.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 8, 3);
  ok(!takeBurn(b, 2, 3), 'a weaker burn is refused outright');
  ok(!takeBurn(b, 40, 0.5), 'so is a fiercer one that comes to less in total (40 x 0.5 is under 8 x 3)');
  close(burnReport(b).toCome, 24, 'and after both refusals the fire still owes what it always did');
  ok(takeBurn(b, 4, 10), 'a gentler one that comes to more replaces it');
  close(burnOut(b, 1 / 60).total, 40, 'and costs its own 4 x 10: nothing is added to anything');
}

{
  // Equal wins, which is what makes standing in the same fire refresh it rather than letting it run
  // out under you.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 8, 3);
  stepBurn(b, 1.5);
  ok(takeBurn(b, 8, 3), 'the same burn again, half spent, is taken afresh');
  close(b.left, 3, 'and is full again');
}

{
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 8, 3);
  const at = stepBurn(b, 0.9).damage;
  close(at, 0, 'no blow has landed nine tenths of the way to the first tick');
  takeBurn(b, 8, 3);
  close(b.clock, 0.9, 'and renewing the burn does not wind the tick clock back');
  const r = stepBurn(b, 0.2);
  close(r.damage, 8, 'so the blow still lands on time');
}

{
  // The other half of that rule, which nothing in the game reaches today because every burn in it is
  // the same 8 a second: the seconds the clock holds were gathered under the *old* fire and are owed
  // at the old fire's rate. Left as they were, a fierce burn replacing a gentle one would charge its
  // own rate for them.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 1, 3);
  close(stepBurn(b, 0.9).damage, 0, 'nine tenths of a second of a gentle fire lands no blow');
  takeBurn(b, 100, 3);
  const run = burnOut(b, 1 / 60);
  close(run.total, 300.9, 'a fierce burn over it costs its own 300 and nine tenths of a second of the old one');
  ok(run.total < 390, 'and not the 390 that billing the old seconds at the new rate would come to');
}

{
  // And the same the other way round, where the new fire is the gentler of the two.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 100, 0.5);
  close(stepBurn(b, 0.4).damage, 0, 'four tenths of a second of a fierce fire lands no blow either');
  takeBurn(b, 10, 10);
  close(burnOut(b, 1 / 60).total, 140, 'a long gentle burn over it costs its own 100 and the 40 the fierce one had run up');
}

{
  reset();
  const b = newPlayerBurn();
  ok(!takeBurn(b, Number.NaN, 3), 'a rate that is not a number is refused');
  ok(!takeBurn(b, 8, Number.NaN), 'so is a length that is not');
  ok(!takeBurn(b, 8, Infinity), 'and a burn that would never end');
  ok(!takeBurn(b, 0, 3), 'a rate of nothing is refused');
  ok(!takeBurn(b, 8, 0), 'and so is a length of nothing');
  ok(!(b.left > 0), 'after all of which nothing is burning at all');
}

{
  // Ours: the guard on how long one affliction may keep the player alight. It never binds on
  // anything in the game today, every burn of which is three seconds.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 1, 10000);
  ok(PLAYER_BURN.cap === 20, 'the guard stands at the 20 seconds the file declares');
  close(b.left, 20, 'and a burn longer than it is cut to it');
  clearBurn(b);
  PLAYER_BURN.cap = Infinity;
  takeBurn(b, 1, 10000);
  close(b.left, 10000, 'and with the cap at Infinity it is taken whole (the other bodies\' behaviour exactly)');
  reset();
}

// --- spending one -------------------------------------------------------------------------------

{
  // The whole point of the file: a burn costs exactly what was asked for, in blows rather than in
  // crumbs, and says one line at each end.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 8, 3);
  const run = burnOut(b, 1 / 60);
  close(run.total, 24, 'a burn of 8 a second for 3 seconds costs 24 in all');
  ok(run.blows === 3, `and lands it in ${run.blows} blows rather than one a frame`);
  ok(run.starts === 1, 'it says it has caught exactly once');
  ok(run.ends === 1, 'and that it is out exactly once');
  ok(!(b.left > 0), 'and is not burning afterwards');
}

{
  // The remainder: a burn that is not a whole number of ticks still comes to what it was asked for.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 8, 2.5);
  const run = burnOut(b, 1 / 60);
  close(run.total, 20, 'a burn of 8 for two and a half seconds costs 20');
  ok(run.blows === 3, `paid in ${run.blows}: two whole ticks and the rest at the end`);
}

{
  // A frame longer than a tick (a stall, a hidden tab, a console step) must not lose what it
  // covered. This is where a burn parts company with the lava's tick, which deliberately charges
  // once for a long frame because it is charging for *standing somewhere* rather than paying out a
  // total that was promised.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 8, 3);
  const run = burnOut(b, 2.5);
  close(run.total, 24, 'two frames of two and a half seconds still cost exactly 24');
  ok(run.frames === 2, `and take ${run.frames} frames`);
}

{
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 10, 4);
  PLAYER_BURN.tick = 2;
  const run = burnOut(b, 1 / 60);
  close(run.total, 40, 'a slower tick changes nothing about the total');
  ok(run.blows === 2, `only how it arrives: ${run.blows} blows instead of four`);
  reset();
}

{
  reset();
  const b = newPlayerBurn();
  const r = stepBurn(b, 1 / 60);
  close(r.damage, 0, 'stepping a record that is not burning costs nothing');
  ok(!r.started && !r.ended, 'and says nothing');
}

{
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 8, 3);
  stepBurn(b, 0.5);
  const r = stepBurn(b, Number.NaN);
  close(r.damage, 0, 'a frame of no time at all costs nothing');
  close(b.left, 2.5, 'and spends nothing');
}

// --- ending one the other way -------------------------------------------------------------------

{
  // Cleared rather than spent: a death, a travel, a respawn. It ends in silence by construction,
  // because `said` goes back with everything else.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 8, 3);
  ok(stepBurn(b, 0.1).started, 'the first step says you have caught');
  clearBurn(b);
  ok(!(b.left > 0), 'clearing puts the fire out');
  const r = stepBurn(b, 0.1);
  ok(!r.ended, 'and nothing says it went out: a fire taken away is not a fire that burned out');
  ok(!r.started, 'nor that it caught again');
  takeBurn(b, 8, 3);
  ok(stepBurn(b, 0.1).started, 'and the next fire says its own first line');
}

{
  // The death, as the record sees it: a burn with seconds left on it, put out where the body dies,
  // and then a long gap in which nothing is stepped at all (the death card is not simulated) before
  // the body is stood up whole again. Nothing may be spent on the fresh body and nothing may be
  // said. In the game the two clears are `Player.startRagdoll` and `Player.reset`; what is pinned
  // here is the rule they rely on -- that a cleared burn cannot come back.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 8, 3);
  stepBurn(b, 0.6);
  close(b.left, 2.4, 'a burn with two and two fifths of a second still to run');
  clearBurn(b);
  const after = stepBurn(b, 1 / 60);
  close(after.damage, 0, 'the body dies and the fresh one pays nothing');
  ok(!after.started && !after.ended, 'and is told nothing about a fire it never caught');
  ok(burnReport(b).said === false, 'the record does not still believe it has announced one');
  ok(!burnReport(b).burning, 'and the burning manager is told there is nothing to draw');
}

{
  // The switch. Off, nothing can be lit and a fire already lit goes out at the next step in silence,
  // which is the same shape the lava's switch has.
  reset();
  const b = newPlayerBurn();
  takeBurn(b, 8, 3);
  stepBurn(b, 0.1);
  PLAYER_BURN.on = false;
  const r = stepBurn(b, 0.1);
  ok(!(b.left > 0), 'the switch off puts a lit fire out');
  close(r.damage, 0, 'without a last blow');
  ok(!r.ended, 'and without a word');
  ok(!takeBurn(b, 8, 3), 'and nothing can be lit while it is off');
  reset();
  ok(takeBurn(b, 8, 3), 'back on, a burn is taken again');
}

// --- the knob and the report ----------------------------------------------------------------------

{
  reset();
  tunePlayerBurn({ tick: 0.25 });
  close(PLAYER_BURN.tick, 0.25, 'the tick is written');
  tunePlayerBurn({ tick: 0 });
  close(PLAYER_BURN.tick, 0.25, 'a tick of nothing is ignored rather than dividing by it');
  tunePlayerBurn({ tick: Number.NaN });
  close(PLAYER_BURN.tick, 0.25, 'and so is one that is not a number');
  tunePlayerBurn({ cap: Infinity });
  ok(PLAYER_BURN.cap === Infinity, 'the cap takes Infinity, which is a real answer here');
  tunePlayerBurn({ on: false });
  ok(PLAYER_BURN.on === false, 'and the switch takes a boolean');
  tunePlayerBurn(undefined);
  ok(PLAYER_BURN.on === false, 'nothing written by nothing');
  reset();
}

{
  reset();
  const b = newPlayerBurn();
  let rep = burnReport(b);
  ok(!rep.burning, 'the report of a record that is not burning says so');
  close(rep.perTick, 0, 'and that a blow comes to nothing');
  takeBurn(b, 8, 3);
  rep = burnReport(b);
  ok(rep.burning, 'and of one that is, that it is');
  close(rep.perTick, 8, 'with a blow of 8');
  close(rep.toCome, 24, 'and 24 still to pay');
  stepBurn(b, 1.5);
  // A second and a half in, one blow of 8 has landed and the clock is holding half a second that is
  // owed and not yet paid. What is left to pay is therefore 16, which is the total less what was
  // paid -- and not the 12 that reading `dps x left` alone gives, which forgets the clock.
  const half = burnReport(b);
  close(half.toCome, 16, 'a second and a half in, the 16 that has not been paid is what is still owed');
  close(half.toCome + 8, 24, 'which is exactly the total less the one blow that has landed');
  clearBurn(b);
  takeBurn(b, 8, 1.2);
  stepBurn(b, 1 / 60);
  // 1.2 seconds at a tick of 1: the first blow is a whole tick and the last is the fifth of a second
  // left over. The report must say what the *next* blow will be, not a whole tick either way.
  close(burnReport(b).perTick, 8, 'with more than a tick still to come the next blow is a whole one');
  close(stepBurn(b, 1.05).damage, 8, 'a tick lands a whole blow of 8');
  close(burnReport(b).perTick, 8 * 0.2, 'and the last blow to come is the fifth of a second the burn has left, not another whole tick');
  close(burnOut(b, 1 / 60).total, 8 * 0.2, 'which is exactly what it turns out to be');
}

console.log(`\n${passed} checks passed.`);
