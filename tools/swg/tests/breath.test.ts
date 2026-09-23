// Breath: how a lungful is spent under water, how it comes back in air, what running out of it
// costs and when each of the two lines falls due. Pure arithmetic, so this test runs exactly what
// the game runs.
//
// **Every number in this file is invented**, and so is every number it checks. You could not go
// under water in Star Wars Galaxies at all -- not swim under, not dive, not drown -- so there is no
// table, no column and no default anywhere in the archives for any of this, and nothing here is
// pinning the client's behaviour. What is pinned is the *rules*: the air goes at a second a second
// and comes back faster than that, the first blow falls a tick of airless time after the air does,
// one long frame pays once rather than for everything it covered, a duck under a wave says nothing,
// and a record put back is silent.
//
// And one rule that is counted rather than reasoned about, because reasoning about it got it wrong:
// **how many lines a whole swim says**. A swim is two lines however it is swum -- one dive or one
// dive with forty bobs in it -- and the cases under "how many lines a swim really says" count them
// across whole minutes of swimming. The first cut of this file checked each end of a *dive* and
// never counted across two, which is exactly how a rule that said forty lines in twenty seconds
// passed eighty-three checks.
//
// The frame lengths are 1/64 and 1/32 of a second rather than a sixtieth wherever a count is
// checked: both are exact in binary, so "thirty seconds of air at a sixty-fourth a frame" really is
// zero and not a ten-trillionth, and a blow either side of a frame boundary cannot be an artefact of
// the test's own arithmetic. One case runs at a sixtieth deliberately, to show that nothing depends
// on the frames dividing anything.
import assert from 'node:assert/strict';
import {
  BREATH,
  breathReport,
  maxBreath,
  newBreath,
  resetBreath,
  stepBreath,
  tuneBreath,
  type Breath,
} from '../../../src/player/breathMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const close = (a: number, b: number, msg: string, eps = 1e-9) => ok(Math.abs(a - b) <= eps, `${msg} (${a} ~ ${b})`);

/** The knobs as the file declares them, so one case cannot leak its tuning into the next. */
const DEFAULTS = { ...BREATH };
const reset = (): void => {
  Object.assign(BREATH, DEFAULTS);
};

/** The numbers the file ships with, named once so a case that depends on one says which. */
const AIR = DEFAULTS.seconds;
const BITE = DEFAULTS.damage;

interface Run {
  /** Damage taken over the run. */
  total: number;
  /** How many drowning blows landed. */
  blows: number;
  /** How many times "you are holding your breath" fell due. */
  starts: number;
  /** How many times "you can breathe again" did. */
  ends: number;
  /** The simulated seconds the run covered. */
  seconds: number;
}

/**
 * Step `seconds` of play at `dt` a frame with the head under (or not) and report what it came to.
 * The one rule the shared result object imposes is that it is read before the next call, which is
 * what this does and what the game does.
 */
function run(b: Breath, seconds: number, dt: number, under: boolean): Run {
  const out: Run = { total: 0, blows: 0, starts: 0, ends: 0, seconds: 0 };
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) {
    const r = stepBreath(b, dt, under);
    if (r.started) out.starts++;
    if (r.ended) out.ends++;
    if (r.damage > 0) {
      out.total += r.damage;
      out.blows++;
    }
    out.seconds += dt;
  }
  return out;
}

// --- holding one ---------------------------------------------------------------------------------

{
  reset();
  const b = newBreath();
  close(b.left, AIR, 'a fresh pair of lungs is full');
  ok(!b.under && !b.said, 'and is in air, with nothing said');
  close(maxBreath(), AIR, 'a full lungful is what the file declares');
}

{
  // The plainest thing in the file: air goes at a second a second.
  reset();
  const b = newBreath();
  const r = run(b, 10, 1 / 64, true);
  close(b.left, AIR - 10, 'ten seconds under costs ten seconds of air');
  close(r.total, 0, 'and nothing at all in health');
  ok(b.under, 'the record knows the head is under');
}

{
  // The first line, and the duck that says nothing. `sayAfter` exists for exactly this: a step into
  // a lake and out again ought not to say two lines.
  reset();
  const b = newBreath();
  const dip = run(b, BREATH.sayAfter - 0.25, 1 / 64, true);
  ok(dip.starts === 0, 'a duck under shorter than the file\'s own patience says nothing');
  const up = run(b, 1, 1 / 64, false);
  ok(up.ends === 0, 'and nothing says the head came back up, because nothing said it went under');
}

{
  reset();
  const b = newBreath();
  const under = run(b, 10, 1 / 64, true);
  ok(under.starts === 1, 'a real dive says it exactly once');
  const more = run(b, 10, 1 / 64, true);
  ok(more.starts === 0, 'and not again while it lasts');
  const up = run(b, BREATH.sayAfter + 0.5, 1 / 64, false);
  ok(up.ends === 1, 'the head really coming up says so exactly once');
  const dry = run(b, 5, 1 / 64, false);
  ok(dry.ends === 0, 'and not again while it stays up');
}

{
  // The patience holds at **both** ends, which is the whole of the fix: the second line waits as
  // long out of the water as the first waited in it. A mouthful at the surface is not the end of a
  // dive, and a dive is not over until the head has really been up.
  reset();
  const b = newBreath();
  run(b, 5, 1 / 64, true);
  const bob = run(b, BREATH.sayAfter - 0.25, 1 / 64, false);
  ok(bob.ends === 0, 'a bob at the surface shorter than the patience says nothing');
  const back = run(b, 1 / 64, 1 / 64, true);
  ok(back.starts === 0, 'and going back under says nothing either, because the dive never ended');
  const out = run(b, BREATH.sayAfter + 0.25, 1 / 64, false);
  ok(out.ends === 1, 'staying up past the patience ends it, once');
}

{
  // Where the line falls, to the frame: the moment the air spent reaches `sayAfter`.
  reset();
  BREATH.sayAfter = 1.5;
  const b = newBreath();
  const before = run(b, 1.5 - 1 / 64, 1 / 64, true);
  ok(before.starts === 0, 'a frame before the patience runs out, nothing is said');
  const r = stepBreath(b, 1 / 64, true);
  ok(r.started, 'and on the frame it does, the line falls');
  reset();
}

// --- running out of one --------------------------------------------------------------------------

{
  // The whole point of the file. The air runs out on the frame it runs out on, and the first blow
  // falls one tick of airless time after that.
  reset();
  const b = newBreath();
  const to = run(b, AIR - 1 / 64, 1 / 64, true);
  close(b.left, 1 / 64, 'a frame from the end of the air');
  ok(to.blows === 0, 'and not a blow landed yet');
  const out = stepBreath(b, 1 / 64, true);
  close(b.left, 0, 'the air is gone');
  close(out.damage, 0, 'and the frame it goes on costs nothing by itself');
  const almost = run(b, 1 - 1 / 64, 1 / 64, true);
  ok(almost.blows === 0, 'nor does the rest of the second');
  const r = stepBreath(b, 1 / 64, true);
  close(r.damage, BITE, 'and the first blow falls a whole tick of airless time after the air did');
}

{
  // And one a tick after that, for as long as the head stays under.
  reset();
  const b = newBreath();
  const r = run(b, AIR + 10, 1 / 64, true);
  ok(r.blows === 10, `ten seconds past the air is ${r.blows} blows, one a second`);
  close(r.total, 10 * BITE, 'which is what it costs');
  ok(r.starts === 1, 'and the line was said once in all of it');
}

{
  // The numbers in force, read as the owner will read them: how long a dive can be survived. It is
  // not a rule, it is what the six numbers come to, and it is here so that moving one of them shows
  // up as a changed sentence rather than as a surprise in the water.
  //
  // It is the number with **nothing lessening the blow**, which is the honest way to quote it: the
  // blow goes through `Player.takeDamage`, which scales by `damageTaken`, and a Jedi holding Force
  // Protect has that at 0.34, so the same dive is about sixty-seven seconds for them. This file
  // knows nothing of either -- it hands over a number and the player's own damage path decides what
  // it costs -- which is why the arithmetic here is the unprotected one.
  reset();
  const b = newBreath();
  let hp = 100;
  let died = -1;
  const dt = 1 / 32;
  for (let i = 0; i < Math.round(60 / dt) && died < 0; i++) {
    const r = stepBreath(b, dt, true);
    hp -= r.damage;
    if (hp <= 0) died = (i + 1) * dt;
  }
  close(died, AIR + 13, 'a player of a hundred health who dives and never comes up is dead 43 seconds later, with nothing lessening the blow');
  // The game swims, and rises, at 2.475 m a second, so thirteen seconds of drowning is thirty
  // metres of climbing. That is the sentence the number is chosen for.
  ok((died - AIR) * 2.475 > 25, 'which leaves a climb of thirty metres to make between the last of the air and the end');
}

{
  // A frame longer than the tick pays **once**. This is where drowning parts company with a burn,
  // which pays out a total it was promised: drowning charges for being somewhere, so a stall, a
  // hidden tab or a console step must not charge for every second it skipped over.
  reset();
  const b = newBreath();
  const r = run(b, 100, 100, true);
  close(b.left, 0, 'one frame of a hundred seconds empties the lungs');
  ok(r.blows === 1, `and lands ${r.blows} blow, not the seventy that billing the airless part by the second would`);
  close(r.total, BITE, 'so it costs one blow');
  const after = run(b, 1, 1 / 64, true);
  ok(after.blows === 1, 'and the second lands a tick later, from a clock that was put down rather than wound back');
}

{
  // And nothing depends on the frames dividing anything: the same dive at a sixtieth of a second.
  reset();
  const b = newBreath();
  const r = run(b, AIR + 5.5, 1 / 60, true);
  ok(r.blows === 5, `a dive five and a half seconds past the air lands ${r.blows} blows at a sixtieth of a second`);
  ok(b.left === 0, 'with the lungs empty');
}

// --- getting it back -----------------------------------------------------------------------------

{
  reset();
  const b = newBreath();
  run(b, AIR, 1 / 64, true);
  close(b.left, 0, 'lungs emptied');
  const r = run(b, BREATH.recoverSeconds, 1 / 64, false);
  close(b.left, AIR, 'and full again after exactly the seconds the file asks for');
  ok(r.ends === 1, 'saying so once');
  close(r.total, 0, 'and costing nothing');
}

{
  reset();
  const b = newBreath();
  run(b, AIR, 1 / 64, true);
  run(b, 60, 1 / 64, false);
  close(b.left, AIR, 'a minute in air does not fill the lungs past full');
}

{
  // Air comes back faster than it goes, which is the whole difference between a resource and a
  // timer: a moment at the surface is a real reprieve, and a run of quick dives still gets harder.
  reset();
  ok(BREATH.recoverSeconds < BREATH.seconds, 'the lungs fill faster than they empty');
  const b = newBreath();
  run(b, 10, 1 / 64, true);
  run(b, 1, 1 / 64, false);
  close(b.left, AIR - 10 + AIR / BREATH.recoverSeconds, 'one second at the surface is worth five under');
}

{
  // The drowning clock is dropped at the surface, not kept. Kept, a breath taken and let go would
  // land a blow the instant the head went back down, so bobbing up for air would cost more than
  // staying under -- which is the thing this whole rule exists to prevent.
  reset();
  const b = newBreath();
  run(b, AIR + 0.9, 1 / 64, true);
  const up = run(b, 1 / 64, 1 / 64, false);
  close(up.total, 0, 'a frame at the surface costs nothing');
  const down = run(b, 0.5, 1 / 64, true);
  close(down.total, 0, 'and going straight back under does not land the blow the old clock was nine tenths of the way to');
}

{
  // The same thing said as a player would meet it: a swimmer out of air who breaks the surface every
  // second takes nothing at all, which is what "not drowning" means.
  reset();
  const b = newBreath();
  run(b, AIR, 1 / 64, true);
  let paid = 0;
  for (let i = 0; i < 20; i++) {
    paid += run(b, 0.75, 1 / 64, true).total;
    paid += run(b, 0.25, 1 / 64, false).total;
  }
  close(paid, 0, 'twenty bobs at the surface, three quarters of a second under each, cost nothing');
  ok(b.left > 5, `and leave the swimmer better off than they started (${b.left.toFixed(1)} seconds of air in hand)`);
  const stay = run(b, b.left + 2, 1 / 64, true);
  ok(stay.blows > 0, 'while staying down until the air is gone costs what it always did');
}

// --- how many lines a swim really says -------------------------------------------------------------
//
// These three are the cases nothing counted before, and the ones that matter: the message line holds
// eight lines for eight seconds, merges only a *repeat of the same words* within two seconds, and is
// where everything else the game says has to fit. Two lines alternating are two different sets of
// words, so nothing merges them and they fill the line. A swim must cost two lines however it is
// swum, and these count them across whole minutes rather than across one dive.

{
  // The swim that broke it: down for twelve seconds, then twenty bobs for a mouthful. Timed off the
  // air spent and ended on the frame the head broke the surface, this said about forty lines in
  // twenty seconds; timed off seconds under this dive, with the same patience at both ends, it says
  // one -- and the second falls only when the swimmer really climbs out.
  reset();
  const b = newBreath();
  let starts = 0;
  let ends = 0;
  const tally = (r: Run): void => {
    starts += r.starts;
    ends += r.ends;
  };
  tally(run(b, 12, 1 / 64, true));
  for (let i = 0; i < 20; i++) {
    tally(run(b, 0.75, 1 / 64, true));
    tally(run(b, 0.25, 1 / 64, false));
  }
  ok(starts === 1, `twelve seconds down and twenty bobs is ${starts} line, not one a bob`);
  ok(ends === 0, `and ${ends} lines say the swimmer came up, because they have not`);
  tally(run(b, BREATH.sayAfter + 0.5, 1 / 64, false));
  ok(starts === 1 && ends === 1, `climbing out says the other one: ${starts} and ${ends} for the whole swim`);
}

{
  // And the same swim on empty lungs, which is where the air-spent rule was furthest wrong: every
  // dip past the last of the air said the line afresh whatever the patience was set to.
  reset();
  const b = newBreath();
  const first = run(b, AIR, 1 / 64, true);
  // The air ran out in that first dive, which is a line and the right one.
  let starts = first.starts;
  let ends = first.ends;
  for (let i = 0; i < 30; i++) {
    const down = run(b, 1.2, 1 / 64, true);
    const up = run(b, 0.05, 1 / 64, false);
    starts += down.starts + up.starts;
    ends += down.ends + up.ends;
  }
  ok(starts === 1, `thirty bobs on empty lungs is ${starts} line in all, not two a bob`);
  ok(ends === 0, 'and says nothing about coming up, thirty times');
}

{
  // The line does fall again on a *second* dive, which is what makes it worth saying at all. The
  // patience runs from the moment the head goes back under, not from what the lungs hold.
  reset();
  const b = newBreath();
  const first = run(b, 5, 1 / 64, true);
  const out = run(b, 3, 1 / 64, false);
  ok(first.starts === 1 && out.ends === 1, 'one dive, two lines');
  const shallow = run(b, BREATH.sayAfter - 0.25, 1 / 64, true);
  ok(shallow.starts === 0, 'the next dive waits its own patience, however full the lungs are');
  const rest = run(b, 0.5, 1 / 64, true);
  ok(rest.starts === 1, 'and says its own line when it has lasted');
}

{
  // The one thing the patience must never delay: going under with nothing left to breathe. Here the
  // recovery is turned down so far that a surfacing long enough to end the dive still buys no air,
  // which is the only way to reach a fresh dive on empty lungs.
  reset();
  BREATH.recoverSeconds = 1e6;
  const b = newBreath();
  run(b, AIR, 1 / 64, true);
  const out = run(b, BREATH.sayAfter + 0.25, 1 / 64, false);
  ok(out.ends === 1, 'the swimmer surfaces, on lungs the knob will not refill');
  const again = stepBreath(b, 1 / 64, true);
  ok(again.started, 'and going back under with no air says so on the first frame, patience or no patience');
  reset();
}

// --- ending one the other way --------------------------------------------------------------------

{
  // Put back rather than surfaced: a death, a travel, a respawn. It is silent by construction,
  // because `said` and `under` go back with everything else. In the game the two calls are
  // `Player.startRagdoll` and `Player.reset`; what is pinned here is the rule they rely on.
  reset();
  const b = newBreath();
  const dive = run(b, 12, 1 / 64, true);
  ok(dive.starts === 1, 'a dive under way, with its line said');
  resetBreath(b);
  close(b.left, AIR, 'the body dies, or travels, and the fresh one has full lungs');
  const after = run(b, 5, 1 / 64, false);
  ok(after.ends === 0, 'and nothing tells it that it can breathe again: it never held its breath');
  close(after.total, 0, 'nor costs it anything');
  const next = run(b, 5, 1 / 64, true);
  ok(next.starts === 1, 'and the next dive says its own first line');
}

{
  // The switch. Off, the lungs are full at the next step whatever was happening, in silence, and
  // nothing can ever be spent -- which is the shape the lava's and the fire's switches have.
  reset();
  const b = newBreath();
  run(b, AIR + 3, 1 / 64, true);
  BREATH.on = false;
  const off = run(b, 10, 1 / 64, true);
  close(b.left, AIR, 'the switch off fills the lungs where they stand');
  close(off.total, 0, 'nothing drowns while it is off');
  ok(off.starts === 0 && off.ends === 0, 'and nothing is said about it');
  ok(!b.under, 'and the display is told there is nothing to show');
  reset();
  const back = run(b, AIR + 1, 1 / 64, true);
  ok(back.blows === 1, 'back on, a dive costs what it always did');
}

// --- the knobs -------------------------------------------------------------------------------------

{
  // A breath that costs nothing to run out of: the clock still runs and the row still empties, but
  // no blow lands. It is the half-way setting between the switch and the game.
  reset();
  BREATH.damage = 0;
  const b = newBreath();
  const r = run(b, AIR + 20, 1 / 64, true);
  close(r.total, 0, 'with the blow set to nothing, drowning costs nothing');
  close(b.left, 0, 'though the air still runs out');
  reset();
}

{
  reset();
  const b = newBreath();
  run(b, 5, 1 / 64, true);
  close(b.left, AIR - 5, 'twenty-five seconds of air in hand');
  BREATH.seconds = 10;
  stepBreath(b, 1 / 64, true);
  ok(b.left <= 10, `a maximum lowered under a fuller lungful is honoured at once (${b.left})`);
  reset();
}

{
  reset();
  BREATH.recoverSeconds = 0;
  const b = newBreath();
  run(b, AIR, 1 / 64, true);
  stepBreath(b, 1 / 64, false);
  close(b.left, AIR, 'a recovery of no time at all is instant, which is a real answer and not a division by nothing');
  reset();
}

{
  reset();
  const b = newBreath();
  run(b, 5, 1 / 64, true);
  const before = b.left;
  const r = stepBreath(b, Number.NaN, true);
  close(b.left, before, 'a frame of no time at all spends nothing');
  close(r.damage, 0, 'and costs nothing');
  stepBreath(b, -1, true);
  close(b.left, before, 'and neither does a frame that runs backwards');
  stepBreath(b, 0, true);
  close(b.left, before, 'nor one of exactly nothing');
}

{
  reset();
  tuneBreath({ seconds: 12 });
  close(BREATH.seconds, 12, 'the lungful is written');
  tuneBreath({ seconds: Number.NaN });
  close(BREATH.seconds, 12, 'a lungful that is not a number is ignored');
  tuneBreath({ seconds: -1 });
  close(BREATH.seconds, 12, 'and so is one below nothing');
  tuneBreath({ seconds: 0 });
  close(BREATH.seconds, 12, 'and so is a lungful of no seconds at all, which would be a bar with no length and a blow on the first frame under');
  tuneBreath({ tick: 0 });
  close(BREATH.tick, DEFAULTS.tick, 'a tick of nothing is ignored rather than divided by');
  tuneBreath({ damage: 0 });
  close(BREATH.damage, 0, 'a blow of nothing is taken: it is a real answer');
  tuneBreath({ sayAfter: 0 });
  close(BREATH.sayAfter, 0, 'and so is a line said the instant the head goes under');
  tuneBreath({ on: false });
  ok(BREATH.on === false, 'the switch takes a boolean');
  tuneBreath(undefined);
  ok(BREATH.on === false, 'nothing written by nothing');
  reset();
}

{
  reset();
  BREATH.sayAfter = 0;
  const b = newBreath();
  const r = stepBreath(b, 1 / 64, true);
  ok(r.started, 'with the patience at nothing the line falls on the first frame under');
  reset();
}

{
  // The line is said at the latest when the air is gone, whatever the patience is set to -- because
  // at that point it is not a warning, it is a fact.
  reset();
  BREATH.sayAfter = 1e6;
  const b = newBreath();
  const r = run(b, AIR, 1 / 64, true);
  ok(r.starts === 1, 'a patience longer than the whole lungful still says the line, once, as the air runs out');
  reset();
}

// --- the report ------------------------------------------------------------------------------------

{
  reset();
  const b = newBreath();
  let rep = breathReport(b);
  ok(rep.on && !rep.under && !rep.drowning, 'the report of a body in air says so');
  close(rep.share, 1, 'with a full bar');
  ok(rep.nextBlow === null, 'and no blow coming');
  run(b, 10, 1 / 64, true);
  rep = breathReport(b);
  ok(rep.under && !rep.drowning, 'ten seconds down, under and not yet drowning');
  close(rep.since, 10, 'and the console can see how long this dive has lasted, which is what both lines are timed off');
  close(rep.share, (AIR - 10) / AIR, 'the bar is two thirds full');
  close(rep.nextBlow ?? -1, AIR - 10, 'and the first blow is as far off as the air is');
  run(b, AIR - 10 + 0.25, 1 / 64, true);
  rep = breathReport(b);
  ok(rep.drowning, 'past the air, drowning');
  close(rep.share, 0, 'with an empty bar');
  close(rep.nextBlow ?? -1, 0.75, 'and the next blow three quarters of a second off');
  ok(rep.seconds === BREATH.seconds && rep.tick === BREATH.tick && rep.damage === BREATH.damage, 'and the numbers in force are what it reports');
}

console.log(`\n${passed} checks passed.`);
