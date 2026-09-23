// Standing in a flow: how far it draws a body down, how fast it does it, how much of the walk that
// costs, and the one thing it must never touch -- how fast the flow kills. Pure arithmetic, so this
// test runs exactly what the game runs.
//
// **Every number in this file, and in the file it tests, is ours.** The client's terrain water values
// say what lava takes off whatever stands in it and how often; they are read out of the archives into
// a planet's pack and applied by `src/world/lavaHarmMath.ts`, and not one of them is written down
// here or there. They say nothing at all about a body sinking into a flow, because in the game these
// numbers are for you could not stand in one. So the checks below are about *rules*.
//
// The verdict "this body is in a flow" is deliberately not this module's: the game draws it with the
// harm's own `inLava`, band and all, so the sink begins on exactly the line the burn begins on. That
// seam is checked here too, on the real `inLava`, because it is the one that would be silent if it
// broke -- the body would sink a centimetre before or after it started burning and nothing would say.
import assert from 'node:assert/strict';
import {
  LAVA_SINK,
  lavaPace,
  lavaSinkReport,
  newLavaSink,
  resetLavaSink,
  sinkTarget,
  stepLavaSink,
  tuneLavaSink,
  waistHeight,
  type LavaSink,
} from '../../../src/player/lavaSinkMath.ts';
import { LAVA_HARM, inLava, lavaTickDamage, newLavaHold, resetLavaHold, stepLavaHold, type LavaHold } from '../../../src/world/lavaHarmMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const close = (a: number, b: number, msg: string, eps = 1e-9) => ok(Math.abs(a - b) <= eps, `${msg} (${a} ~ ${b})`);

/** The numbers as the file ships them, so a block that moves one of them puts them all back after. */
const SHIPPED = { ...LAVA_SINK };
const putBack = () => tuneLavaSink(SHIPPED);

/** The standing eye height the game's postures give, repeated here so the cap can be checked at both. */
const STANDING_EYE = 1.5;
const PRONE_EYE = 0.45;

// --- where the waist is ---------------------------------------------------------------------------

close(waistHeight(), 0.91, 'the waist stands 0.91 m off the ground, which is about where a belt sits', 1e-12);
close(waistHeight(2, 0.5), 1, 'and of any other height it is handed');
close(waistHeight(0), 0, 'a body of no height has no waist');
close(waistHeight(-1), 0, 'nor one of a negative height');
close(waistHeight(1.75, 0), 0, 'a share of nothing is no waist either, which is a real answer: nothing sinks');
close(waistHeight(Number.NaN), 0, 'and a height that is not a number is not a height');

// --- how far it wants to go -----------------------------------------------------------------------

{
  const waist = waistHeight();
  close(sinkTarget(0), waist, 'a body standing exactly at the surface wants to sink its whole waist');
  close(sinkTarget(0.15), waist - 0.15, 'and one already fifteen centimetres in wants the rest of it: the lava got that far by itself');
  close(sinkTarget(waist), 0, 'a body standing in a flow exactly waist deep wants nothing more');
  close(sinkTarget(waist + 2), 0, 'and one two metres deeper than that wants nothing either, rather than being pushed back up');
  close(sinkTarget(-1), waist + 1, 'a metre over a flow it asks for the whole way down; whether it may is the caller\'s verdict, not this sum');
  close(sinkTarget(Number.NaN), waist, 'a depth that is not a number is read as the surface rather than throwing the sum away');
}
{
  // The second cap, and the one posture it is for.
  const waist = waistHeight();
  close(sinkTarget(0, STANDING_EYE), waist, 'standing, the eyes are higher than the waist, so the eye cap never binds');
  close(sinkTarget(0, 1.05), waist, 'crouched they still are');
  close(sinkTarget(0, PRONE_EYE), PRONE_EYE, 'lying down they are not: the sink stops at the eyes, so a flow can never close over a prone body\'s head');
  close(sinkTarget(0.2, PRONE_EYE), PRONE_EYE - 0.2, 'and what the body is already standing in still counts against it');
  close(sinkTarget(PRONE_EYE + 0.1, PRONE_EYE), 0, 'a prone body already deeper than its own eyes asks for nothing, which is the same refusal the waist makes');
}

// --- what it costs the walk -------------------------------------------------------------------------

{
  const waist = waistHeight();
  close(lavaPace(0), 1, 'nothing up the body, nothing off the walk');
  close(lavaPace(-1), 1, 'and a body over the flow walks whole');
  close(lavaPace(waist), 0.35, 'at the waist the walk is down to a little over a third');
  close(lavaPace(waist * 2), 0.35, 'and no lower past it: the legs are the whole of what the lava holds');
  close(lavaPace(waist / 2), 0.675, 'half way up is half the loss: a straight line, so there is nothing to be surprised by');
  close(lavaPace(waist / 4), 0.8375, 'and a quarter of the way up a quarter of it');
  ok(lavaPace(waist) > 0, 'and it is never nothing, which is what "walkable out of" means in arithmetic');
  close(lavaPace(waist) * 5.5, 1.925, 'against the game\'s own 5.5 m/s run that is a wade of 1.93 m/s, a shade under its 2.0 m/s walk');
  close(lavaPace(Number.NaN), 1, 'an immersion that is not a number costs nothing');
  close(lavaPace(waist, 0), 1, 'and a body with no waist is held by nothing, whatever it is standing in');
}

// --- a step at a time -------------------------------------------------------------------------------

const DT = 0.25; // quarter-second steps: 0.25 sums exactly in binary, so a count of them is not a float accident

/** Steps a body standing at a fixed depth, in or out, and says where the sink got to. */
const run = (s: LavaSink, steps: number, depth: number, held: boolean, eyeOver = STANDING_EYE): number => {
  for (let i = 0; i < steps; i++) stepLavaSink(s, DT, depth, held, eyeOver);
  return s.sink;
};

{
  const s = newLavaSink();
  const r = stepLavaSink(s, DT, 0.5, true, STANDING_EYE);
  close(r.sink, LAVA_SINK.sinkRate * DT, 'one step in a flow sinks one step\'s worth and not the whole way: the owner asked for a slow sink');
  ok(s.in === true, 'and the body is remembered as being in it, which is what the hysteresis needs next step');
  close(r.immersion, 0.5 + r.sink, 'how far the flow stands up the body is what it was standing in plus what it has been drawn down');
  ok(r.pace < 1 && r.pace > LAVA_SINK.slowest, 'and the walk is already a little slower, but nowhere near the floor');
}
{
  // From the lip of a flow (the harm's own margin under) to the waist: the number to compare against
  // how long the flow takes to kill, which is the one thing this must not outlive.
  const s = newLavaSink();
  let t = 0;
  while (s.sink < sinkTarget(LAVA_HARM.margin, STANDING_EYE) - 1e-9 && t < 60) {
    stepLavaSink(s, DT, LAVA_HARM.margin, true, STANDING_EYE);
    t += DT;
  }
  close(s.sink, waistHeight() - LAVA_HARM.margin, 'from the lip it comes to rest with the flow exactly at the waist');
  ok(t >= 2.5 && t <= 2.75, `and takes ${t} s to get there, which is inside the three a flow takes to kill: the sink is something that happens to you rather than something that is interrupted`);
  close(lavaPace(s.immersion), LAVA_SINK.slowest, 'and by then the walk is down to its floor');
}
{
  // Deep enough already: nothing moves, because the lava is past the waist without any help.
  const s = newLavaSink();
  run(s, 40, 1.4, true);
  close(s.sink, 0, 'a body standing in a flow deeper than its waist is never drawn down at all');
  close(lavaPace(s.immersion), LAVA_SINK.slowest, 'and is held at the floor of the walk the whole time, which is the same answer from the other direction');
}
{
  // And out again: four times as fast, which is the owner's "comes back out over a moment".
  const s = newLavaSink();
  run(s, 40, 0.15, true);
  const sunk = s.sink;
  ok(sunk > 0.7, `a body held for ten seconds is drawn ${sunk.toFixed(2)} m down`);
  let t = 0;
  while (s.sink > 0 && t < 60) {
    stepLavaSink(s, DT, -Infinity, false, STANDING_EYE);
    t += DT;
  }
  close(s.sink, 0, 'and out of the flow it comes all the way back');
  ok(t <= 1, `in ${t} s, not the two and a half it went down in`);
  close(lavaPace(s.immersion), 1, 'and walks whole again');
  ok(s.in === false, 'and is no longer remembered as being in one');
}
{
  // The one direction that must **not** take the fast rate: still in a flow, but the bed has dropped
  // away, so the lava has risen up the body by itself and the sink has to give way to it.
  const s = newLavaSink();
  run(s, 40, 0.15, true);
  const before = s.sink;
  stepLavaSink(s, DT, 0.55, true, STANDING_EYE);
  close(before - s.sink, LAVA_SINK.sinkRate * DT, 'a step into a deeper part eases at the going rate, not at the pulling-free one: the figure is not yanked upward every time the bed drops');
  ok(LAVA_SINK.riseRate > LAVA_SINK.sinkRate, 'which is a rule worth having only because the two rates really do differ');
}
{
  // Walking out with the sink still in the body: it goes on holding you until it has come out, which
  // is what makes climbing out of a flow a pull rather than a step.
  const s = newLavaSink();
  run(s, 40, 0.15, true);
  const r = stepLavaSink(s, DT, -Infinity, false, STANDING_EYE);
  ok(r.pace < 1, `out of the flow but still drawn ${r.sink.toFixed(2)} m down, the walk is still only ${r.pace.toFixed(2)} of itself`);
  close(r.immersion, r.sink, 'and what is holding it is the sink alone: there is no surface over dry ground to measure against');
}
{
  // The four states that are not standing in anything (riding, noclipping, adrift, in a hull's rooms)
  // reach this with the verdict false and a depth of -Infinity, and it has to be a rise and not a hold.
  const s = newLavaSink();
  run(s, 40, 0.15, true);
  stepLavaSink(s, 1, -Infinity, false, STANDING_EYE);
  ok(s.sink < 0.1, 'a body that mounts, noclips or steps aboard a ship half-way into a flow rises out of it wherever it has gone');
}
{
  const s = newLavaSink();
  run(s, 40, 0.15, true);
  const held = s.sink;
  stepLavaSink(s, 0, 0.15, true, STANDING_EYE);
  close(s.sink, held, 'a step of no time at all moves nothing');
  stepLavaSink(s, Number.NaN, 0.15, true, STANDING_EYE);
  close(s.sink, held, 'and neither does a step that is not a number');
  stepLavaSink(s, DT, Number.NaN, true, STANDING_EYE);
  ok(s.in === false, 'a depth that is not a number is not a flow, whatever the caller\'s verdict said');
}
{
  // The switch, mid-sink: back there and then, because a switch whose whole job is "make the game
  // exactly what it was" cannot take three quarters of a second to be believed.
  const s = newLavaSink();
  run(s, 40, 0.15, true);
  ok(s.sink > 0.7, 'a body well into a flow');
  tuneLavaSink({ on: false });
  const r = stepLavaSink(s, DT, 0.15, true, STANDING_EYE);
  close(r.sink, 0, 'with the switch off is drawn where it really stands, at once');
  close(r.pace, 1, 'and walks at its own speed');
  ok(s.in === false && s.immersion === 0, 'and the record is put back whole rather than half');
  run(s, 40, 0.15, true);
  close(s.sink, 0, 'and goes on being drawn there for as long as the switch is off');
  putBack();
}
{
  const s = newLavaSink();
  run(s, 20, 0.15, true);
  resetLavaSink(s);
  ok(s.sink === 0 && s.in === false && s.immersion === 0, 'a body stood up whole somewhere (a death, a respawn, an arrival) is stood up on its feet');
}

// --- the seam with the burn ---------------------------------------------------------------------------

// That the sink cannot change how fast a flow kills is structural: `sink` is not an argument to
// `stepLavaHold`, to `inLava` or to `lavaTickDamage`, at any value it can take. What is *not*
// structural, and what was wrong here, is whether the two are in the flow on the same steps. The
// sink used to draw its own verdict with `inLava` alone while the burn drew its with `inLava` and
// then `stillInLava` over the gap, and the two really did part company -- so both halves are run
// below over one shared record and one track of depths that contains the seam that parted them.

/**
 * The seam, as the lava planet really presents it. Where no local table covers a column,
 * `World.lavaAt` falls through to the global sea's level, which on that planet is tens of metres
 * *below* the feet -- so the depth does not wobble about the line, it jumps from half a metre under
 * the surface to a large negative and back. No margin measured in metres can bridge that, which is
 * what `LAVA_HARM.linger` is for.
 */
const SEAM = -40;
/** Wading at the lip, which is where a body still has the whole of its sink in front of it. */
const FLOW = LAVA_HARM.margin;
/** The step the seam falls on, chosen while the sink is still moving so that a rise would show. */
const AT = 8;
/** A body standing in a flow; one step where the column is not the flow's; then standing in it again. */
const BRIDGED = [...Array(AT).fill(FLOW), SEAM, ...Array(20).fill(FLOW)] as number[];
/** And the same with a gap of a second and a half, which is far past the bridge and really is leaving. */
const LEFT = [...Array(AT).fill(FLOW), ...Array(6).fill(SEAM), ...Array(20).fill(FLOW)] as number[];

/**
 * One step of the world's tick and one of the sink, in the world's own order, over one shared
 * `LavaHold`. The blow rule is `World.stepHazards`'s, written out here and nowhere else in this file:
 * the line and the clock are kept through a bridged step, and a blow is only ever charged for a step
 * whose own verdict was true.
 */
const tick = (track: readonly number[], dt: number) => {
  const h: LavaHold = newLavaHold();
  const s = newLavaSink();
  let clock = 0;
  const out = { blows: 0, said: [] as boolean[], sunk: [] as number[], pace: [] as number[] };
  for (const depth of track) {
    stepLavaHold(h, dt, depth);
    const r = stepLavaSink(s, dt, h.in ? h.depth : -Infinity, h.in, STANDING_EYE);
    out.said.push(h.in);
    out.sunk.push(r.sink);
    out.pace.push(r.pace);
    if (!h.in) {
      clock = 0;
      continue;
    }
    if (!h.raw) continue;
    clock += dt;
    if (clock < LAVA_HARM.interval) continue;
    clock = 0;
    out.blows++;
  }
  return out;
};

/** What the sink used to do: its own verdict, `inLava` alone, on the column's own depth. */
const naive = (track: readonly number[], dt: number) => {
  const s = newLavaSink();
  const sunk: number[] = [];
  for (const depth of track) sunk.push(stepLavaSink(s, dt, depth, inLava(depth, s.in), STANDING_EYE).sink);
  return sunk;
};

{
  // The two halves, over the seam, from the one record.
  const r = tick(BRIDGED, DT);
  const before = r.sunk[AT - 1];
  ok(r.said[AT] === true, 'across a step where the column is not the flow\'s, the verdict is bridged and the body is still in it');
  ok(r.sunk[AT] >= before, `so the sink does not come out (${before.toFixed(3)} m, then ${r.sunk[AT].toFixed(3)} m): it goes on toward the target it had`);
  close(r.sunk[AT] - before, LAVA_SINK.sinkRate * DT, 'at the going rate, from the last depth that really was in the flow, rather than chasing a surface forty metres down');
  close(r.pace[AT], r.pace[AT - 1] - (1 - LAVA_SINK.slowest) * LAVA_SINK.sinkRate * DT / waistHeight(), 'and the hold on the walk goes on tightening across it rather than letting go');

  // And the same track under the rule the sink used to have, which is what makes the block above a
  // test rather than a restatement: it is the regression, in metres.
  const was = naive(BRIDGED, DT);
  close(was[AT] - was[AT - 1], -LAVA_SINK.riseRate * DT, 'under the old rule -- the band and no bridge -- the very same step rose at the pulling-free rate instead');
  ok(r.sunk[AT] - was[AT] > 0.3, `which over one step is ${(r.sunk[AT] - was[AT]).toFixed(2)} m of daylight between the figure and where it belongs, four times as fast up as it went down, while the burn went on burning`);
  ok(was[AT] < was[AT - 1] && was[AT + 4] > was[AT], 'and it stepped straight back down into the flow on the steps after, which is the bob the whole band was there to stop');
}
{
  // Past the bridge it really is out, and it comes back in on the line the burn comes back in on.
  const r = tick(LEFT, DT);
  ok(r.said[AT] === true, 'a quarter of a second with no flow over the column is inside the bridge');
  ok(r.said[AT + 1] === false, 'and half a second is past it, so the verdict is believed');
  ok(r.sunk[AT + 5] < r.sunk[AT], `so the sink really does come out (${r.sunk[AT].toFixed(2)} m, then ${r.sunk[AT + 5].toFixed(2)} m) once the body has left`);
  ok(r.said[AT + 6] === true, 'and standing in the flow again it is in it again');
}
{
  // The one thing that must not move. The same track twice, the sink on and then off: the verdict on
  // every step and the count of blows must be identical, and the sink must not be.
  const on = tick(BRIDGED, DT);
  tuneLavaSink({ on: false });
  const off = tick(BRIDGED, DT);
  putBack();
  ok(on.blows === off.blows, `the flow lands ${on.blows} blows over that track with the sink running and ${off.blows} with it switched off`);
  ok(on.said.every((v, i) => v === off.said[i]), `and says the same thing on every one of the ${BRIDGED.length} steps`);
  ok(on.sunk.some((v, i) => v !== off.sunk[i]), 'while the figure is drawn somewhere quite different, which is what makes that a comparison and not a tautology');
  ok(on.blows === 7, 'seven seconds of steps really in the flow at the pack\'s own one-second interval is seven blows, bridged step and all');
  close(lavaTickDamage(0.25, 100), 25, 'and a blow is still whatever the pack says it is, which this file has no opinion about');
}
{
  // And the line itself: the sink starts where the burn starts, because the verdict it is handed is
  // the burn's own rather than a second one of its own a centimetre away.
  const h = newLavaHold();
  const s = newLavaSink();
  const atMargin = LAVA_HARM.margin;
  const step = (depth: number) => {
    stepLavaHold(h, DT, depth);
    return stepLavaSink(s, DT, h.in ? h.depth : -Infinity, h.in, STANDING_EYE);
  };
  close(step(atMargin - 1e-6).sink, 0, 'a hair above the line the burn begins on, nothing sinks');
  ok(step(atMargin).sink > 0, 'and at the line itself it does');
  // The band that holds a body in: the sink keeps its hold through the same wobble the burn does.
  ok(inLava(atMargin - LAVA_HARM.hold, true), 'a body already in stays in a whole band above the line');
  const r = step(atMargin - LAVA_HARM.hold);
  ok(h.in === true && s.in === true && r.sink > 0, 'so a walker shifting their weight at the lip of a flow neither starts sinking twice nor bobs back out');
  resetLavaHold(h);
  ok(h.in === false && h.gap === Infinity && h.depth === -Infinity, 'and a body stood up somewhere fresh carries neither the band nor the bridge into it');
}

// --- the knobs ----------------------------------------------------------------------------------------

{
  tuneLavaSink(undefined);
  ok(LAVA_SINK.sinkRate === SHIPPED.sinkRate, 'tuning with nothing changes nothing');
  tuneLavaSink({ bodyHeight: Number.NaN, waistShare: Number.NaN, sinkRate: Number.NaN, riseRate: Number.NaN, slowest: Number.NaN });
  ok(
    LAVA_SINK.bodyHeight === SHIPPED.bodyHeight && LAVA_SINK.waistShare === SHIPPED.waistShare && LAVA_SINK.sinkRate === SHIPPED.sinkRate && LAVA_SINK.riseRate === SHIPPED.riseRate && LAVA_SINK.slowest === SHIPPED.slowest,
    'numbers that are not numbers are ignored one by one',
  );
  tuneLavaSink({ bodyHeight: -2, waistShare: -1, sinkRate: -1, riseRate: -1 });
  ok(
    LAVA_SINK.bodyHeight === SHIPPED.bodyHeight && LAVA_SINK.waistShare === SHIPPED.waistShare && LAVA_SINK.sinkRate === SHIPPED.sinkRate && LAVA_SINK.riseRate === SHIPPED.riseRate,
    'and so are negative ones: a body of minus a metre and a sink that runs backwards are not answers',
  );
  tuneLavaSink({ slowest: 5 });
  close(LAVA_SINK.slowest, 1, 'a walk faster than a walk is held at a walk');
  tuneLavaSink({ slowest: -5 });
  close(LAVA_SINK.slowest, 0, 'and one slower than a stop at a stop, which is a real answer: a flow you cannot get out of');
  putBack();
  tuneLavaSink({ sinkRate: 0 });
  {
    const s = newLavaSink();
    run(s, 40, 0.15, true);
    close(s.sink, 0, 'a rate of nothing is a real answer too: the sink stands still and the body is drawn where it stands');
  }
  putBack();
  tuneLavaSink({ on: 'yes' as unknown as boolean });
  ok(LAVA_SINK.on === true, 'and only a boolean writes the switch');
  putBack();
}

// --- what the console is told ---------------------------------------------------------------------------

{
  const s = newLavaSink();
  run(s, 40, 0.15, true);
  // The two numbers the game hands in, rather than a second copy of either in the report: the harm's
  // own margin, and the game's own run speed (`RUN_SPEED` in `player.ts`).
  const r = lavaSinkReport(s, LAVA_HARM.margin, 5.5);
  ok(r.on === true && r.in === true, 'the report says whether any of it is running and whether this body is in a flow');
  close(r.sink, s.sink, 'and how far down it is drawn');
  close(r.waist, 0.91, 'and where the waist it is capped at sits', 1e-12);
  close(r.pace, 0.35, 'and what is left of the walk, which by now is its floor');
  close(r.paceSpeed, 1.925, 'in metres a second as well, so the number means something without arithmetic');
  close(lavaSinkReport(s, LAVA_HARM.margin, 2).paceSpeed, 0.7, 'against whatever run speed it is handed, so the console cannot drift from the game');
  // The one the owner is told to hold against how fast a flow kills, and the one it must not be.
  close(r.lip, LAVA_HARM.margin, 'it says which line it measured from: the lip of a flow, which is the line the burn begins on');
  close(r.secondsToWaist, 2.533333333333, 'so the whole of the sink a body walking in really does takes 2.53 s', 1e-9);
  ok(r.secondsToWaist < 3, 'which is inside the three a flow takes to kill: the sink is something that happens to you rather than something that is interrupted');
  close(r.waist / r.sinkRate, 3.033333333333, 'measured from the surface instead it would read 3.03 s -- a descent from a lip nobody stands on', 1e-9);
  close(lavaSinkReport(s).secondsToWaist, 3.033333333333, 'which is what a caller with no margin to hand is told, and is why the game hands one', 1e-9);
  ok(r.secondsBack < 1, `and how long it would take to come back out from here (${r.secondsBack.toFixed(2)} s)`);
  ok(r.bodyHeight === LAVA_SINK.bodyHeight && r.waistShare === LAVA_SINK.waistShare && r.sinkRate === LAVA_SINK.sinkRate && r.riseRate === LAVA_SINK.riseRate && r.slowest === LAVA_SINK.slowest, 'and every one of ours, so the owner can read them without opening the file');
  close(lavaSinkReport(s, 99).secondsToWaist, 0, 'a lip deeper than the waist is no descent at all rather than a negative one');
  tuneLavaSink({ sinkRate: 0 });
  ok(lavaSinkReport(s, LAVA_HARM.margin).secondsToWaist === Infinity, 'a sink that does not move never reaches the waist, and the report says so rather than dividing by nothing');
  putBack();
  resetLavaSink(s);
  close(lavaSinkReport(s, LAVA_HARM.margin).secondsBack, 0, 'and a body that is not sunk has nothing to come back from');
}

console.log(`\n${passed} checks passed`);
