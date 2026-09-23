// What a flow does to whoever stands in it: the water values as a pack carries them, the share of a
// life one blow takes, and the three numbers that decide where "in it" begins and ends. Pure
// arithmetic and a lenient reader, so this test runs exactly what the game runs.
//
// **Every number in this file is invented for the test.** The client's own water values are not
// written down here, in `src/world/lavaHarmMath.ts`, or anywhere else in this repository: they live
// in the archives, the water command reads them into a planet's `water.json`, and the game applies
// whatever that block says. So the fixture below deliberately carries values that are nobody's --
// a quarter of a life every two seconds -- and the checks are about the *rules*, which are ours.
// A pack that carries no block at all is checked here too: nothing burns, which is exactly what
// every planet on disk does today.
import assert from 'node:assert/strict';
import {
  LAVA_HARM,
  applyLavaHarm,
  inLava,
  lavaHarmPackSource,
  lavaHarmReport,
  lavaHarmRow,
  lavaImmuneTemplates,
  lavaTickDamage,
  readLavaHarmRows,
  resetLavaHarm,
  rideOverLava,
  stillInLava,
  tuneLavaHarm,
} from '../../../src/world/lavaHarmMath.ts';
import { readWaterPack } from '../../../src/world/waterLook.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const close = (a: number, b: number, msg: string, eps = 1e-9) => ok(Math.abs(a - b) <= eps, `${msg} (${a} ~ ${b})`);

/** A pack as the water command writes one, with only the parts this file reads. */
const pack = (harm: unknown): unknown => ({ version: 1, planet: 'test', shaders: {}, notes: [], harm });
/**
 * A block of the shape the water command writes, with **invented** values: a quarter of a life every
 * two seconds. Nothing here is the client's, and nothing downstream may assume otherwise -- the
 * whole point of reading the numbers out of the pack is that this file does not know them.
 */
const MADE_UP = {
  source: 'client',
  types: [
    { type: 0, damage: false, kills: false, interval: 2, share: 0 },
    { type: 1, damage: true, kills: true, interval: 2, share: 0.25 },
  ],
  immune: ['object/mobile/vehicle/a_vehicle.iff', 'object/mobile/vehicle/another_vehicle.iff'],
};

// --- the rule a blow is worked out with --------------------------------------------------------

// Of the **maximum**, never of what is left: a row that gives a share says in the same breath
// whether this water kills, and a share of what is left never gets there.
close(lavaTickDamage(0.25, 100), 25, 'a quarter of a whole life of 100');
close(lavaTickDamage(0.25, 200), 50, 'and against a life of 200: the share is a share, not a number of points');
{
  let hp = 100;
  let blows = 0;
  while (hp > 0 && blows < 99) {
    hp -= lavaTickDamage(0.25, 100);
    blows++;
  }
  ok(blows === 4, `a quarter of a whole life kills in ${blows} blows, whatever is left at the time`);
}
{
  // The reading the design rejected, kept here as the reason: a share of what is left never lands.
  let hp = 100;
  for (let i = 0; i < 200; i++) hp -= hp * 0.25;
  ok(hp > 0, `taken off what is left instead, a body still has ${hp.toExponential(1)} after 200 blows and can never die`);
}
close(lavaTickDamage(-1, 100), 0, 'a share below nothing takes nothing');
close(lavaTickDamage(4, 100), 100, 'a share over the whole takes the whole and no more');
close(lavaTickDamage(Number.NaN, 100), 0, 'a share that is not a number takes nothing');
close(lavaTickDamage(0.25, 0), 0, 'a life of nothing loses nothing');
close(lavaTickDamage(0.25, Number.NaN), 0, 'a life that is not a number loses nothing');

// --- the two lines, and which is which ----------------------------------------------------------

// `World.lavaAt` hands back metres under the flow's surface, negative above it, and -Infinity where
// the water over the point is not lava at all. Both readers must refuse that value outright.
ok(!inLava(-Infinity) && !rideOverLava(-Infinity), 'no flow over the point: neither a body nor a ride is in one, whatever the reach is');
ok(!inLava(-Infinity, true) && !rideOverLava(-Infinity, true), 'and one already burning is no exception: a band in metres cannot reach a column with no flow over it at all');
ok(!inLava(Number.NaN) && !rideOverLava(Number.NaN), 'a depth that is not a number is not a flow either');
ok(inLava(0.5) && !inLava(0.05), 'a body is in the flow half a metre under and not five centimetres under');
ok(inLava(LAVA_HARM.margin) && !inLava(LAVA_HARM.margin - 1e-9), 'the margin itself is in, and a hair above it is out');
ok(!inLava(-2), 'a body two metres over a flow is not in it');
ok(rideOverLava(-2) && rideOverLava(0.5), 'a ride two metres over a flow, and one in it, are both over it');
ok(!rideOverLava(-(LAVA_HARM.rideReach + 0.01)), 'a ride further over it than the reach is not');
ok(rideOverLava(-1, false, 0) === false && rideOverLava(0, false, 0) === true, 'with no reach at all a ride has to be at the surface, which is what a hover machine never is');
ok(rideOverLava(-1, false, -5) === false, 'a reach that is not a positive number is no reach');

// The band: you go in at the line and come out only `hold` metres the other side of it.
ok(inLava(LAVA_HARM.margin - LAVA_HARM.hold, true), 'a body already in stays in a whole band above the line');
ok(!inLava(LAVA_HARM.margin - LAVA_HARM.hold - 1e-9, true), 'and is out a hair past it');
ok(!inLava(LAVA_HARM.margin - LAVA_HARM.hold, false), 'while a body that was out needs the line itself: the band only ever holds something in');
ok(rideOverLava(-(LAVA_HARM.rideReach + LAVA_HARM.hold), true) && !rideOverLava(-(LAVA_HARM.rideReach + LAVA_HARM.hold + 1e-9), true), 'the same band widens a ride\'s reach, and no further');
ok(inLava(LAVA_HARM.margin - 1, true, LAVA_HARM.margin, 0) === false, 'with no band at all there is no hysteresis, which is what the next block is about');

// The linger: a verdict that has gone false is held for a moment before it is believed.
ok(stillInLava(true, 999) === true, 'a verdict that is true is true, whatever the gap says');
ok(stillInLava(false, 0) === true && stillInLava(false, LAVA_HARM.linger - 1e-9) === true, 'a gap shorter than the linger is not believed');
ok(stillInLava(false, LAVA_HARM.linger) === false, 'and one as long as it is');
ok(stillInLava(false, Infinity) === false, 'a verdict that has never been true is not held');
ok(stillInLava(false, 0.1, 0) === false, 'with no linger a verdict goes false the step it does');
{
  let gap = 0;
  let steps = 0;
  while (stillInLava(false, gap) && steps < 1000) {
    gap += 0.25;
    steps++;
  }
  ok(gap >= LAVA_HARM.linger && gap < LAVA_HARM.linger + 0.25, `a pilot who has really left is believed after ${gap} s, which is the linger and not a step more`);
}

// --- the tick itself, in miniature ----------------------------------------------------------------

// `World.stepHazards` in the small: the state it keeps and the rules it applies, so that what the
// three numbers are *for* is checked rather than asserted. A body resting at the very line the
// verdict is drawn at -- which is where a walker at the lip of a flow rests, since the flat polygon
// and the ground generated under it all but coincide there -- wobbles a couple of centimetres either
// side of it as the step alternates.
const DT = 0.25; // quarter-second steps: 0.25 sums exactly in binary, so the blow count is not a float accident
const runTick = (depthAt: (step: number) => number, steps: number, hold: number, linger: number): { lines: number; blows: number } => {
  let clock = 0;
  let gap = Infinity;
  let was = false;
  let said: 'no' | 'in' = 'no';
  let lines = 0;
  let blows = 0;
  for (let i = 0; i < steps; i++) {
    const raw = inLava(depthAt(i), was, LAVA_HARM.margin, hold);
    gap = raw ? 0 : gap + DT;
    const burning = stillInLava(raw, gap, linger);
    was = burning;
    const now: 'no' | 'in' = burning ? 'in' : 'no';
    if (now !== said) {
      lines++;
      said = now;
    }
    if (!burning) {
      clock = 0;
      continue;
    }
    // A blow is only ever charged for a step whose own verdict was true.
    if (!raw) continue;
    clock += DT;
    if (clock < LAVA_HARM.interval) continue;
    clock = 0;
    blows++;
  }
  return { lines, blows };
};
// 41 steps, so the body is in the flow for 40 of them: at the default one-second interval that is
// ten blows if nothing interrupts the clock.
const atTheLine = (i: number): number => LAVA_HARM.margin + (i % 2 ? 0.02 : -0.02);
{
  const bare = runTick(atTheLine, 41, 0, 0);
  ok(bare.lines === 40, `with neither the band nor the linger, a body resting at the line says two contradictory things ${bare.lines} times in 41 steps -- one message-line write per frame, for ever`);
  ok(bare.blows === 0, 'and is burnt exactly nothing, because the clock is put back to nothing on every step the verdict comes out false');
}
{
  const band = runTick(atTheLine, 41, LAVA_HARM.hold, 0);
  ok(band.lines === 1, 'the band alone settles it: one line, said once');
  ok(band.blows === 10, `and the body burns at its proper rate (${band.blows} blows in 41 quarter-second steps at a one-second interval)`);
}
{
  const linger = runTick(atTheLine, 41, 0, LAVA_HARM.linger);
  ok(linger.lines === 1, 'the linger alone also settles the line');
  ok(linger.blows === 5, `but the body burns at half rate (${linger.blows}), since only the steps that really are in the flow are charged -- which is why the band is there as well`);
}
{
  const ours = runTick(atTheLine, 41, LAVA_HARM.hold, LAVA_HARM.linger);
  ok(ours.lines === 1 && ours.blows === 10, 'with both, as the game has them: one line and the full rate');
}
{
  // The other shape of flicker, which no band in metres can reach: a hull drifting across the edge
  // of a flow polygon reads a depth one step and "there is no flow over this column" the next.
  const overTheEdge = (i: number): number => (i % 2 ? 0.5 : -Infinity);
  const bare = runTick(overTheEdge, 41, LAVA_HARM.hold, 0);
  ok(bare.lines === 40, `the band cannot help here: still ${bare.lines} lines, because -Infinity is not a distance`);
  const ours = runTick(overTheEdge, 41, LAVA_HARM.hold, LAVA_HARM.linger);
  ok(ours.lines === 1, 'the linger is what covers it: one line');
  ok(ours.blows === 5, `and half rate (${ours.blows}), which is honest -- half those steps the thing really was not over a flow`);
}
{
  // And the one thing the linger must not do: burn somebody who has walked out.
  const inThenOut = (i: number): number => (i < 8 ? 0.5 : -5);
  const ours = runTick(inThenOut, 41, LAVA_HARM.hold, LAVA_HARM.linger);
  ok(ours.blows === 2, `a body in the flow for eight quarter-second steps and then out takes ${ours.blows} blows and no more: the clock stops with the feet`);
  ok(ours.lines === 2, 'and the line is said twice, once each way');
}

// --- reading the pack ---------------------------------------------------------------------------

ok(readLavaHarmRows(undefined).length === 0, 'no pack at all: no rows');
ok(readLavaHarmRows(null).length === 0, 'null: no rows');
ok(readLavaHarmRows({}).length === 0, 'a pack with no harm block: no rows');
ok(readLavaHarmRows(pack(null)).length === 0, 'a harm block that is not an object: no rows');
ok(readLavaHarmRows(pack({ types: 'nonsense' })).length === 0, 'rows that are not an array: no rows');
ok(readLavaHarmRows(pack({ types: [1, 'two', null] })).length === 0, 'rows that are not objects are dropped one by one');
{
  const rows = readLavaHarmRows(pack(MADE_UP));
  ok(rows.length === 2, 'a block of two rows reads as two');
  const lava = lavaHarmRow(rows)!;
  ok(lava.type === 1 && lava.damage && lava.kills, 'water type 1 is the lava row, it hurts, and it kills');
  close(lava.share, 0.25, 'and the share is whatever the block said');
  close(lava.interval, 2, 'and so is the interval');
  ok(lavaHarmPackSource(pack(MADE_UP)) === 'client', 'the block says whose the numbers are, which is the converter\'s word and not this file\'s');
  ok(lavaHarmPackSource(pack({ types: [] })) === null, 'a block that says nothing about where it came from says null');
}
{
  // The row's own place in the list is its water type when it does not carry one: the tables' rows
  // are in water-type order and that order is the join (an inference, stated as one).
  const rows = readLavaHarmRows(pack({ types: [{ damage: false }, { damage: true, kills: true, share: 0.25 }] }));
  ok(rows[0].type === 0 && rows[1].type === 1, 'a row with no type of its own takes its place in the list');
  ok(lavaHarmRow(rows)!.share === 0.25, 'and the lava row is still found by it');
}
{
  // The one shape mistake that would otherwise look like a bug in the game rather than in a file.
  const pct = readLavaHarmRows(pack({ types: [{ type: 1, damage: true, percent: 25 }] }));
  close(pct[0].share, 0.25, 'a share written as a percentage under `percent` is read as one');
  const loud = readLavaHarmRows(pack({ types: [{ type: 1, damage: true, share: 25 }] }));
  close(loud[0].share, 0.25, 'and a `share` of 25 is read as 25% rather than as 25 whole lives a blow');
  const over = readLavaHarmRows(pack({ types: [{ type: 1, damage: true, share: 5 }] }));
  close(over[0].share, 0.05, 'a share of 5 likewise');
  const neg = readLavaHarmRows(pack({ types: [{ type: 1, damage: true, share: -2 }] }));
  close(neg[0].share, 0, 'a share below nothing is nothing');
}
{
  const alt = readLavaHarmRows(pack({ rows: [{ type: 1, damage: true, kills: true, share: 0.25, intervalSeconds: 3 }] }));
  ok(alt.length === 1 && alt[0].interval === 3, 'the rows may be `rows` and the interval `intervalSeconds`: the reader takes either');
}
{
  const renumbered = readLavaHarmRows(pack({ types: [{ type: 7, damage: true, kills: true, share: 0.5, interval: 2 }] }));
  ok(lavaHarmRow(renumbered)!.type === 7, 'with no type 1 in the block, the first row that hurts at all is the lava row');
  ok(lavaHarmRow(readLavaHarmRows(pack({ types: [{ type: 0, damage: false }] }))) === null, 'a block in which nothing hurts has no lava row');
}

// --- the immunity list, which package C joins ----------------------------------------------------

{
  const list = lavaImmuneTemplates(pack(MADE_UP));
  ok(list.length === 2, 'the immunity list reads as a list');
  ok(list[0] === MADE_UP.immune[0], 'and each row comes back exactly as the pack spelled it: reducing a name to a key is the immunity\'s own business, not this file\'s');
  // The shape the water command really writes: a row per template, with the shared_ sibling beside it.
  const rows = lavaImmuneTemplates(pack({ immune: [{ template: 'object/mobile/vehicle/a_vehicle.iff', shared: 'object/mobile/vehicle/shared_a_vehicle.iff' }] }));
  ok(rows.length === 1 && rows[0] === 'object/mobile/vehicle/a_vehicle.iff', 'a row that names its template reads as that template, not as its shared_ sibling');
  ok(lavaImmuneTemplates(pack({ immune: [{ shared: 'object/x/shared_b.iff' }] }))[0] === 'object/x/shared_b.iff', 'a row with only the sibling still names something rather than nothing');
  ok(lavaImmuneTemplates(pack({ immune: { templates: ['object/mobile/vehicle/shared_a_vehicle.iff'] } })).length === 1, 'an `immune` written as an object with `templates` reads the same');
  ok(lavaImmuneTemplates(pack({ immune: [1, null, {}, '   ', 'ok.iff'] })).length === 1, 'rows that name nothing are dropped one by one');
  ok(lavaImmuneTemplates(pack({})).length === 0 && lavaImmuneTemplates({}).length === 0 && lavaImmuneTemplates(null).length === 0, 'no list, no block and no pack: nothing, and never a throw');
  ok(lavaImmuneTemplates(pack({ immune: 'nonsense' })).length === 0, 'a list that is not a list is not a list');
}

// --- seeding the live numbers from a pack ---------------------------------------------------------

{
  const applied = applyLavaHarm(pack(MADE_UP), true);
  ok(applied.source === 'pack' && applied.note === null, 'a pack with the block seeds from the pack and says nothing');
  close(LAVA_HARM.share, 0.25, 'the applied share is the pack\'s');
  close(LAVA_HARM.interval, 2, 'and so is the interval');
  ok(LAVA_HARM.kills === true && LAVA_HARM.packSource === 'client', 'and it carries whose the pack said they were');
}
{
  // The whole of what a pack converted before the water command read the tables does. This is the
  // rule the project's own hard line about the archives forces, and it is also the brief's: a pack
  // already on disk must behave exactly as it does today, and today a flow burns nobody.
  const applied = applyLavaHarm(pack(undefined), true);
  ok(applied.source === 'none', 'a planet with lava and no block has nobody\'s numbers');
  close(LAVA_HARM.share, 0, 'so nothing burns at all: there are no stand-in values, because the only right ones are the client\'s and those are not in this repository');
  ok(LAVA_HARM.kills === false && LAVA_HARM.packSource === null, 'and nothing claims a pack said anything');
  ok(!!applied.note && applied.note.includes('npm run swg -- water'), 'and it says the one command that changes that');
  ok(lavaHarmReport().why !== null && lavaHarmReport().why!.includes('no harm values'), 'and the console report says in words why nothing is burning');
}
{
  const applied = applyLavaHarm(pack(undefined), false);
  ok(applied.source === 'none' && applied.note === null, 'a planet with no lava at all is not missing anything and is not asked to convert');
}
{
  // Seeded on every load, so a planet whose pack says nothing does not inherit the last planet's.
  applyLavaHarm(pack(MADE_UP), true);
  applyLavaHarm(pack(undefined), true);
  close(LAVA_HARM.share, 0, 'a planet with no block after one with a block starts from nothing, not from the last world\'s numbers');
}
{
  // A pack that says this water does no damage is taken at its word rather than being second-guessed.
  applyLavaHarm(pack({ types: [{ type: 1, damage: false, kills: false, share: 0.25, interval: 1 }] }), true);
  close(LAVA_HARM.share, 0, 'a row that says it does no damage takes nothing, whatever share it carries');
  ok(LAVA_HARM.source === 'pack', 'and it is still the pack\'s answer, not an absence of one');
}
{
  applyLavaHarm(pack({ types: [{ type: 1, damage: true, kills: true, share: 0.25, interval: 0 }] }), true);
  close(LAVA_HARM.interval, 1, 'an interval of nothing would be a blow a frame: one second stands in for it');
}
resetLavaHarm();
ok(LAVA_HARM.source === 'none' && LAVA_HARM.share === 0 && LAVA_HARM.packSource === null, 'a world left puts what a pack can say back to nothing');
{
  const margins = { margin: LAVA_HARM.margin, hold: LAVA_HARM.hold, rideReach: LAVA_HARM.rideReach, linger: LAVA_HARM.linger, on: LAVA_HARM.on };
  resetLavaHarm();
  ok(LAVA_HARM.margin === margins.margin && LAVA_HARM.hold === margins.hold && LAVA_HARM.rideReach === margins.rideReach && LAVA_HARM.linger === margins.linger && LAVA_HARM.on === margins.on, 'and leaves the margins and the switch exactly where the console put them: only what a pack can say is cleared');
}

// --- the way in: the block must survive the reader, or none of the above ever happens --------------

// `World.applySwgWater` hands `applyLavaHarm` the record `readWaterPack` builds, not the file it
// parsed. That reader names the fields it keeps and builds a fresh object, so a `harm` block it did
// not carry through would be thrown away at the door and every planet would burn nothing for ever,
// however well the converter wrote it. The two files are a seam and it is pinned here, on the real
// reader, because it is silent when it breaks: nothing throws, nothing warns, the burn simply stops.
{
  const file = { version: 3, planet: 'test', shaders: {}, notes: [], harm: MADE_UP };
  const record = readWaterPack(file);
  ok(!!record, 'a water.json of the shape the water command writes parses');
  ok(record!.harm !== undefined, 'and its harm block is still on the record the world is handed');
  const applied = applyLavaHarm(record, true);
  ok(applied.source === 'pack', 'so the numbers reach the game through the real reader and not only through a fixture');
  close(applied.share, 0.25, 'with the block\'s own share');
  close(applied.interval, 2, 'and its own interval');
  ok(readWaterPack({ version: 3, planet: 'test', shaders: {}, notes: [] })!.harm === undefined, 'a pack with no block has none, which is what every planet on disk is');
  resetLavaHarm();
}

// --- the knobs ------------------------------------------------------------------------------------

{
  const before = { ...LAVA_HARM };
  tuneLavaHarm(undefined);
  ok(LAVA_HARM.share === before.share && LAVA_HARM.on === before.on, 'tuning with nothing changes nothing');
  tuneLavaHarm({ share: Number.NaN, interval: Number.NaN, margin: Number.NaN, hold: Number.NaN, rideReach: Number.NaN, linger: Number.NaN });
  ok(LAVA_HARM.share === before.share && LAVA_HARM.interval === before.interval && LAVA_HARM.margin === before.margin && LAVA_HARM.hold === before.hold && LAVA_HARM.rideReach === before.rideReach && LAVA_HARM.linger === before.linger, 'numbers that are not numbers are ignored one by one');
  tuneLavaHarm({ share: 5 });
  close(LAVA_HARM.share, 1, 'a share over the whole is held at the whole');
  tuneLavaHarm({ share: -5 });
  close(LAVA_HARM.share, 0, 'and one below nothing at nothing');
  tuneLavaHarm({ interval: 0 });
  close(LAVA_HARM.interval, before.interval, 'an interval of nothing is refused rather than taken');
  tuneLavaHarm({ rideReach: -3 });
  close(LAVA_HARM.rideReach, 0, 'a reach below nothing is no reach');
  tuneLavaHarm({ hold: -1, linger: -1 });
  ok(LAVA_HARM.hold === 0 && LAVA_HARM.linger === 0, 'and a band or a linger below nothing is none of either, which is the old behaviour exactly');
  tuneLavaHarm({ on: false });
  ok(LAVA_HARM.on === false, 'the switch is a switch');
  tuneLavaHarm({ on: 'yes' as unknown as boolean });
  ok(LAVA_HARM.on === false, 'and only a boolean writes it');
  ok(lavaHarmReport().why === 'the switch is off (lava({ on: true }))', 'and with it off the report says so rather than blaming the pack');
  tuneLavaHarm({ on: true, share: before.share, interval: before.interval, margin: before.margin, hold: before.hold, rideReach: before.rideReach, linger: before.linger });
}

// --- what the console is told ----------------------------------------------------------------------

{
  applyLavaHarm(pack(MADE_UP), true);
  const r = lavaHarmReport();
  close(r.perTickAt100, 25, 'the report says what a blow comes to against a life of 100');
  close(r.secondsToKillAt100, 8, 'and how long standing in it is survivable, at the pack\'s own interval');
  ok(r.source === 'pack' && r.on === true && r.why === null, 'and whose numbers they are, whether anything is applied at all, and nothing to explain when something is');
  ok(r.margin === LAVA_HARM.margin && r.hold === LAVA_HARM.hold && r.rideReach === LAVA_HARM.rideReach && r.linger === LAVA_HARM.linger, 'and every one of ours, so the owner can read them without opening the file');
  tuneLavaHarm({ share: 0 });
  ok(lavaHarmReport().secondsToKillAt100 === Infinity, 'a share of nothing never kills, and the report says so rather than dividing by it');
  resetLavaHarm();
}

console.log(`\n${passed} checks passed`);
