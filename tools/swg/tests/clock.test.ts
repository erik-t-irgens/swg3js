// The clock everyone shares, checked without a browser: the offset a few round trips give, what
// happens to it when the round trips lie or arrive late, what the day does when the shared time
// arrives a long way off, what it does with a small drift (it hurries or dawdles, never stands
// still and never runs backwards), what the console's fast day and the console's weather clock do
// to sharing, that the weather's own reading of the clock walks rather than steps, and that two
// machines whose own wall clocks are five minutes apart walk the same weather schedule once they
// share one.
//
// With no server configured every one of these paths must be exactly what was there before, so the
// first block checks the day against its old formula step for step.
import assert from 'node:assert/strict';
import { CLOCK_LIMITS, CLOCK_TUNE, SharedClock, dayTune, sharedClock, sharedNote } from '../../../src/world/sharedClock.ts';
import { DayCycle, phaseFor } from '../../../src/world/daycycle.ts';
import { STEP_SECONDS, climateFor, consoleClock, scheduledLevel, seedOf } from '../../../src/world/weatherSchedule.ts';
import { PLANETS } from '../../../src/data/planets.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
/** A step in days, the short way round the clock face. */
const shortWay = (d: number) => d - Math.floor(d + 0.5);

/** A day with no planet behind it, at a known phase. */
function freshDay(phase = 0): DayCycle {
  const d = new DayCycle(0, 1);
  d.phase = phase;
  return d;
}

// A clock a server could really be keeping: the sanity band refuses anything else, so every block
// below counts from a real moment rather than from a small round number.
const EPOCH = 1_700_000_000_000;

// --- no server: nothing changed ---
{
  let wall = EPOCH;
  sharedClock.wall = () => wall;
  sharedClock.none();
  const day = freshDay();
  let mirror = 0.36;
  const dt = 1 / 60;
  for (let i = 0; i < 600; i++) {
    wall += dt * 1000;
    day.update(dt, false);
    mirror = (mirror + dt / 720) % 1;
  }
  ok(near(day.time, mirror, 1e-12), 'with no server the day is the old formula to the last bit');
  const held = day.time;
  day.update(0, false);
  ok(day.time === held, 'a zero step moves nothing when there is no server');
  for (let i = 0; i < 60; i++) {
    wall += dt * 1000;
    day.update(dt, true);
    mirror = (mirror + (dt / 720) * 90) % 1;
  }
  ok(near(day.time, mirror, 1e-12), 'the fast-forward key still runs the day ninety times over');
  // Frames away change nothing either: with nobody to follow there is nothing to be put right to.
  wall += 120_000;
  const before = day.time;
  day.update(dt, false);
  ok(near(day.time, (before + dt / 720) % 1, 1e-12), 'and a tab that was hidden simply carries on from where it was');
  ok(sharedNote() === '', 'and nothing is said in the display about a clock nobody is sharing');
  ok(sharedClock.timeOfDay(720, 0) === null, 'there is no shared time of day to be had');
  ok(sharedClock.now() === wall, 'the shared clock is the wall clock exactly');
  ok(sharedClock.walkSeconds() === wall / 1000, "and so is the weather's reading of it");
}

// --- the offset from round trips ---
{
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  // This machine's clock is five minutes behind the server's, and the greeting did not say so.
  const truth = 300_000;
  c.hail(wall);
  for (let i = 0; i < CLOCK_TUNE.samples; i++) {
    const sent = c.beginPing();
    wall += 80; // an 80 ms round trip, half of it each way
    c.pong(sent, sent + truth + 40);
    wall += 10;
  }
  ok(c.report().aimMs === truth, 'a round trip whose legs are the same length gives the offset exactly');
  ok(c.where === 'shared', 'and the clock says it is shared');
  ok(near(c.now() - wall, truth, 1), 'the shared time is this machine plus the offset');
}

{
  // Four of nine round trips come back crooked (the answer sat in a queue on the way home, so the
  // offset they suggest is far out). The median throws them away.
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  const truth = -12_345;
  const lies = [0, 3, 5, 8];
  c.hail(wall);
  for (let i = 0; i < 9; i++) {
    const sent = c.beginPing();
    const rtt = 60;
    wall += rtt;
    const skew = lies.includes(i) ? (i % 2 ? 9000 : -7000) : 0;
    c.pong(sent, sent + truth + rtt / 2 + skew);
    wall += 10_000;
  }
  ok(c.report().aimMs === truth, 'the median of nine round trips ignores four crooked ones');
  ok(c.report().samples === CLOCK_TUNE.samples, 'and it keeps no more samples than it said it would');
}

// --- round trips that must not be believed ---
{
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  c.hail(wall);
  const settled = c.report().aimMs;
  // An answer that came home long after it was sent: a compile, a trimesh build, a streamed tier.
  // Half its delay would go straight into the offset, so it is thrown away whole.
  const slow = c.beginPing();
  wall += CLOCK_TUNE.maxRttMs + 1000;
  c.pong(slow, wall);
  ok(c.report().aimMs === settled, 'a round trip slower than the clock will believe does not move the estimate');
  ok(c.report().refused === 1, 'and it is counted rather than passed over in silence');
  // An answer to a question two questions old.
  const stale = c.beginPing();
  wall += 20;
  c.beginPing();
  wall += 20;
  c.pong(stale, wall + 900_000);
  ok(c.report().aimMs === settled, 'nor does an answer to a question that is not the one outstanding');
  // A server clock that cannot be true.
  const sent = c.beginPing();
  wall += 40;
  c.pong(sent, 0);
  ok(c.report().aimMs === settled, 'nor one carrying a clock from before the game existed');
  ok(c.report().refused === 3, 'all three counted');
  // And a good one still is.
  const good = c.beginPing();
  wall += 40;
  c.pong(good, wall - 20 + 4000);
  ok(c.report().aimMs !== settled, 'while an ordinary round trip is believed as before');
}

{
  // Told there is no server -- put down on purpose, or an old relay -- an answer still on its way
  // in must not bring one back and hand the whole offset over with it.
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  c.hail(wall + 600_000);
  const sent = c.beginPing();
  wall += 40;
  c.none();
  c.pong(sent, wall - 20 + 600_000);
  ok(c.where === 'off' && c.offsetMs() === 0, 'a late answer cannot bring back a server that was put down');
  c.hail(wall + 600_000);
  ok(c.where === 'shared', 'while a greeting may open sharing again, because that is the server speaking');
}

// --- a clock that cannot be true ---
{
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  c.hail(0);
  ok(c.where === 'off' && c.now() === wall, 'a server that greets with nothing for a clock is not believed');
  c.hail(CLOCK_LIMITS.latestMs + 1);
  ok(c.where === 'off', 'nor one a century out');
  c.hail(wall + 1000);
  ok(c.where === 'shared', 'a clock that could be a clock is');
}

// --- the offset itself is eased, and snapped when it is far ---
{
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  c.hail(wall + 1000);
  ok(c.offsetMs() === 1000, 'the first word from the server is taken as it stands');
  // A later estimate a few hundred milliseconds off is walked to, not jumped to.
  for (let i = 0; i < CLOCK_TUNE.samples; i++) {
    const sent = c.beginPing();
    wall += 40;
    c.pong(sent, sent + 1500 + 20);
    wall += 1000;
  }
  const aim = c.report().aimMs;
  ok(aim > 1000 && aim <= 1500, 'the estimate has moved toward the new offset');
  const before = c.offsetMs();
  wall += 1000;
  const moved = c.offsetMs() - before;
  ok(moved > 0 && moved <= CLOCK_TUNE.easeMsPerSecond + 1e-6, 'and the offset in force walks there no faster than its own rate');
  wall += 60_000;
  ok(c.offsetMs() === aim, 'given long enough it arrives, and does not overshoot');
}

{
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  c.hail(wall);
  // Five round trips agreeing that the offset is half a minute out. One would not be believed --
  // the median holds it back -- but once they agree the correction is made at once rather than
  // walked to over ten minutes.
  for (let i = 0; i < 5; i++) {
    const sent = c.beginPing();
    wall += 40;
    c.pong(sent, sent + 30_000 + 20);
  }
  ok(c.report().aimMs === 30_000, 'round trips that agree move the estimate the whole way');
  ok(c.offsetMs() === 30_000, 'an offset out by more than the snap is put right at once, not walked to for ten minutes');
}

// --- the server goes away ---
{
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  c.hail(wall + 4000);
  c.lost();
  ok(c.where === 'adrift' && c.shared, 'a dropped connection leaves the clock adrift, still shared');
  const a = c.now();
  wall += 5000;
  ok(c.now() - a === 5000, 'and it carries on at its own rate with what it last knew');
  ok(c.now() - wall === 4000, 'keeping the offset rather than jumping back to this machine');
  c.none();
  ok(c.where === 'off' && c.now() === wall, 'told there is no server at all, it is the wall clock again');
}

{
  // A correction still being eased when the line drops finishes by itself rather than being cut
  // short: the easing is a pure function of the wall clock, so nothing has to come and finish it,
  // and finishing it here would be one more step in the weather's schedule.
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  c.hail(wall);
  for (let i = 0; i < CLOCK_TUNE.samples; i++) {
    const sent = c.beginPing();
    wall += 40;
    c.pong(sent, sent + 500 + 20);
    wall += 100;
  }
  const aim = c.report().aimMs;
  const before = c.offsetMs();
  ok(before < aim, 'the offset is still on its way to the estimate');
  c.lost();
  ok(c.offsetMs() === before, 'and the line dropping does not move it by a millisecond');
  wall += 60_000;
  ok(c.offsetMs() === aim, 'it simply finishes the walk on its own');
}

// --- the weather's reading walks where the day's steps ---
{
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  c.hail(wall + 5000);
  ok(c.nowSeconds() * 1000 === wall + 5000, 'a greeting moves the clock the day reads at once');
  ok(near(c.walkSeconds() * 1000, wall, 1e-6), "and leaves the weather's reading where it was");
  let last = c.walkSeconds();
  let back = false;
  for (let i = 0; i < 30; i++) {
    wall += 1000;
    const w = c.walkSeconds();
    if (w < last) back = true;
    last = w;
  }
  ok(!back, "the weather's clock is never seen to run backwards");
  ok(near(c.walkSeconds() * 1000, wall + 5000, 1), 'and it catches the shared clock up within the half-minute');
  // Put down on purpose, the whole offset comes off the day's clock at once; the weather walks it
  // off the other way just the same.
  c.none();
  ok(near(c.walkSeconds() * 1000, wall + 5000, 1), 'a connection put down does not step the weather either');
  wall += 30_000;
  ok(near(c.walkSeconds() * 1000, wall, 1), 'and the weather comes back to this machine on its own');
}

{
  // A correction too big to walk off in a reasonable while is taken at once instead: two players'
  // weather agreeing matters more than one player's wind turning in a frame.
  const c = new SharedClock();
  let wall = EPOCH;
  c.wall = () => wall;
  c.hail(wall + CLOCK_TUNE.weatherEaseMaxMs * 10);
  ok(c.walkSeconds() === c.nowSeconds(), 'a step too big to walk off is taken by the weather at once');
  ok(c.report().weatherLagMs === 0, 'and nothing is left over');
}

// --- two machines five minutes apart walk the same weather ---
{
  const server = { ms: EPOCH };
  const a = new SharedClock();
  const b = new SharedClock();
  let wallA = server.ms - 150_000;
  let wallB = server.ms + 150_000;
  a.wall = () => wallA;
  b.wall = () => wallB;
  const seed = seedOf('naboo');
  const weights = climateFor('naboo', 5);
  const stepA0 = Math.floor(a.nowSeconds() / STEP_SECONDS);
  const stepB0 = Math.floor(b.nowSeconds() / STEP_SECONDS);
  ok(stepA0 !== stepB0, 'on their own wall clocks the two machines are in different weather steps');
  a.hail(server.ms);
  b.hail(server.ms);
  // Five minutes is past what the weather will walk off, so both are on the server's clock at once.
  const la = scheduledLevel(seed, weights, a.walkSeconds());
  const lb = scheduledLevel(seed, weights, b.walkSeconds());
  ok(la.step === lb.step, "sharing the server's clock puts them in the same weather step");
  ok(la.level === lb.level, 'and so at the same weather level');
  // Five minutes of play later, still the same step and still the same level.
  wallA += 300_000;
  wallB += 300_000;
  const la2 = scheduledLevel(seed, weights, a.walkSeconds());
  const lb2 = scheduledLevel(seed, weights, b.walkSeconds());
  ok(la2.step === lb2.step && la2.level === lb2.level, 'and they stay together as the schedule walks on');
}

// --- the console's weather clock takes the weather out of sharing ---
{
  const shared = 1_000_000;
  ok(consoleClock(shared, 0, 0, 1, 0) === shared, 'untouched, the schedule walks on the shared clock');
  ok(consoleClock(shared, 0, 0, 1, 600) === shared + 600, 'a skip ahead is the shared clock and the skip');
  // Scaled from the console: two machines sharing one clock no longer agree, which is the point of
  // the held note.
  const heldA = consoleClock(shared, 500_000, shared, 4, 0);
  const heldB = consoleClock(shared + 60, 500_000, shared + 60, 4, 0);
  ok(heldA === 500_000 && heldB === 500_000, "scaled, it walks from the console's own base");
  ok(consoleClock(shared + 60, 500_000, shared, 4, 0) === 500_240, 'and runs at the scale it was given');
}

// --- the day: put right where nothing was drawn, walked where it was ---
{
  let wall = EPOCH;
  sharedClock.wall = () => wall;
  sharedClock.none();
  sharedClock.hail(wall);
  const day = freshDay(0);
  const target = () => sharedClock.timeOfDay(day.dayLengthSeconds, day.phase) as number;
  ok(!near(day.time, target(), 0.05), 'the day starts a long way from the shared one');
  day.update(0, false);
  ok(day.time === target(), 'a step with no time in it sets the day outright: the sky is right before the loading screen lifts');

  // A small drift: the day hurries, never faster than its allowance, and lands on the shared time.
  const drift = dayTune.snapAt * 0.5;
  const dt = 1 / 60;
  const d2 = freshDay(0);
  d2.update(0, false);
  d2.time = d2.time - drift; // behind the shared clock
  d2.release(); // a hand-set time holds the day; this is the test setting the scene, not a player
  let last = d2.time;
  let maxStep = 0;
  let wentBack = false;
  for (let i = 0; i < 600; i++) {
    wall += dt * 1000;
    d2.update(dt, false);
    const moved = shortWay(d2.time - last);
    if (moved < -1e-12) wentBack = true;
    maxStep = Math.max(maxStep, moved);
    last = d2.time;
  }
  ok(!wentBack, 'catching up, the sun never runs backwards');
  ok(maxStep <= (dt / 720) * dayTune.easeMax + 1e-12, 'and never faster than its allowance');
  ok(near(d2.time, target(), 1e-9), 'and it lands on the shared time');

  // Ahead of the shared clock: the sun dawdles, and still never runs backwards -- and never stands
  // completely still either, which is what a frozen sun would look like from the ground.
  const d3 = freshDay(0);
  d3.update(0, false);
  d3.time = d3.time + drift;
  d3.release();
  last = d3.time;
  wentBack = false;
  let minStep = 1;
  for (let i = 0; i < 900; i++) {
    wall += dt * 1000;
    d3.update(dt, false);
    const moved = shortWay(d3.time - last);
    if (moved < -1e-12) wentBack = true;
    minStep = Math.min(minStep, moved);
    last = d3.time;
  }
  ok(!wentBack, 'running ahead, the sun slows rather than winding back');
  ok(minStep >= (dt / 720) * dayTune.minRate - 1e-12, 'and dawdles rather than standing still');
  ok(near(d3.time, target(), 1e-9), 'and it comes back onto the shared time');
}

// --- frames that were away, and frames that were drawn ---
{
  let wall = EPOCH + 1_000_000;
  sharedClock.wall = () => wall;
  sharedClock.none();
  sharedClock.hail(wall);
  const dt = 1 / 60;
  const day = freshDay(0);
  const target = () => sharedClock.timeOfDay(day.dayLengthSeconds, day.phase) as number;
  day.update(0, false);
  wall += dt * 1000;
  day.update(dt, false);
  ok(near(day.time, target(), 1e-9), 'an ordinary frame keeps the day on the shared time');
  // A tab hidden for two minutes: the loop clamps its step, so the frame comes back with a
  // twentieth of a second in it and two minutes of wall clock behind it. Nobody saw the sun move.
  wall += 120_000;
  day.update(0.05, false);
  ok(near(day.time, target(), 1e-9), 'and coming back from a tab that was hidden, the sky is right on the first frame');

  // A server first heard from while the world is being drawn is the other case entirely: the sun
  // walks to it rather than jumping across the sky.
  sharedClock.none();
  const d6 = freshDay(0);
  for (let i = 0; i < 10; i++) {
    wall += dt * 1000;
    d6.update(dt, false);
  }
  const before = d6.time;
  sharedClock.hail(wall + 300_000);
  wall += dt * 1000;
  d6.update(dt, false);
  const jump = Math.abs(shortWay(d6.time - before));
  ok(jump > 0 && jump <= (dt / 720) * dayTune.catchUp + 1e-12, 'a server first heard from while playing moves the sun no faster than its allowance');
  const aim = () => sharedClock.timeOfDay(d6.dayLengthSeconds, d6.phase) as number;
  let frames = 1;
  while (frames < 60 * 60 && !near(shortWay(aim() - d6.time), 0, 1e-6)) {
    wall += dt * 1000;
    d6.update(dt, false);
    frames++;
  }
  ok(frames < 60 * 20, `and it is on the shared time again within seconds (${(frames / 60).toFixed(1)} s)`);
  sharedClock.none();
}

// --- the console takes the day out of sharing, and hands it back ---
{
  let wall = EPOCH + 500_000;
  sharedClock.wall = () => wall;
  sharedClock.none();
  sharedClock.hail(wall);
  const day = freshDay(0);
  day.update(0, false);
  const dt = 1 / 60;
  // A whole second on the key, which is a fifth of the day at ninety times over -- not the single
  // frame that no rule could tell from an ordinary one.
  for (let i = 0; i < 60; i++) {
    wall += dt * 1000;
    day.update(dt, true);
  }
  ok(day.fast && sharedNote() !== '', 'the fast day says in the display that it is not the shared one');
  const ahead = Math.abs(shortWay(day.time - (sharedClock.timeOfDay(720, 0) as number)));
  ok(ahead > dayTune.snapAt, 'and a second on the key really does leave the day far from the shared one');
  // Letting the key go hands the day back: by the shorter way round, no faster than its allowance,
  // and over in seconds rather than in one frame across the whole sky.
  let last = day.time;
  let worst = 0;
  let frames = 0;
  while (frames < 60 * 60 && !near(shortWay((sharedClock.timeOfDay(720, 0) as number) - day.time), 0, 1e-6)) {
    wall += dt * 1000;
    day.update(dt, false);
    worst = Math.max(worst, Math.abs(shortWay(day.time - last)));
    last = day.time;
    frames++;
  }
  ok(!day.fast && worst <= (dt / 720) * dayTune.catchUp + 1e-12, 'letting the key go hands the day back without ever moving the sun across the sky in one frame');
  ok(frames < 60 * 20, `and it settles onto the shared time again within seconds (${(frames / 60).toFixed(1)} s)`);
  ok(sharedNote() === '', 'with nothing left to say about it');

  // A time set by hand holds the day until it is handed back.
  day.time = 0.123;
  wall += dt * 1000;
  day.update(dt, false);
  ok(day.held && near(day.time, 0.123 + dt / 720, 1e-9), 'a time set from the console is kept, and runs on by itself');
  ok(sharedNote() !== '', 'and the display says the day is not the shared one');
  day.release();
  frames = 0;
  while (frames < 60 * 60 && !near(shortWay((sharedClock.timeOfDay(720, 0) as number) - day.time), 0, 1e-6)) {
    wall += dt * 1000;
    day.update(dt, false);
    frames++;
  }
  ok(!day.held && frames > 0 && frames < 60 * 20, `handed back, it walks to the shared time rather than jumping to it (${(frames / 60).toFixed(1)} s)`);
  ok(sharedNote() === '', 'and the display goes quiet');
  sharedClock.none();
}

// --- a day held while playing alone does not stay held for ever ---
{
  let wall = EPOCH + 700_000;
  sharedClock.wall = () => wall;
  sharedClock.none();
  const day = freshDay(0);
  const dt = 1 / 60;
  day.time = 0.42;
  day.update(dt, false);
  ok(day.held, 'a time set from the console while playing alone holds the day, as it always did');
  sharedClock.hail(wall);
  ok(!day.held, 'and a server greeting the browser afterwards is where the shared day starts');
  day.update(0, false);
  ok(near(day.time, sharedClock.timeOfDay(720, 0) as number, 1e-12), 'so the day follows it rather than silently refusing to');
  day.time = 0.9;
  day.update(dt, false);
  ok(day.held, 'a time set while a server is there still holds it');
  sharedClock.none();
  ok(!day.held, 'and the day is its own again when the server is gone, with nothing left holding it off');
}

// --- a server whose day is not this build's ---
{
  let wall = EPOCH + 900_000;
  sharedClock.wall = () => wall;
  sharedClock.none();
  const day = freshDay(0);
  ok(day.dayLengthSeconds === 720, "the day is this build's own length until a server says otherwise");
  sharedClock.hail(wall, 1_800_000);
  ok(day.dayLengthSeconds === 1800, 'a server running a longer day is believed');
  day.update(0, false);
  ok(near(day.time, sharedClock.timeOfDay(1800, 0) as number, 1e-12), 'and the day is worked out at that length');
  sharedClock.none();
  ok(day.dayLengthSeconds === 720, "with the server gone for good, this build's own length is back");
  sharedClock.hail(wall, 0.5);
  ok(day.dayLengthSeconds === 720, 'a length that cannot be true is ignored');
  sharedClock.none();
  sharedClock.hail(wall, CLOCK_LIMITS.maxDayMs * 100);
  ok(day.dayLengthSeconds === 720, 'and so is one so long the sun would never move again');
  sharedClock.none();
}

// --- where a planet sits in the shared day ---
{
  const a = phaseFor(0.3, 1.1);
  const b = phaseFor(0.3, 1.1);
  ok(a === b, 'a planet is at the same place in the day in every browser');
  ok(a >= 0 && a < 1, 'a phase is a fraction of a day');
  // The spread over the suns the game's own planets really have, rather than over two made-up
  // ones: a hash spreads no better than chance, so this is measured and not assumed.
  const suns = [...new Set(PLANETS.map((p) => `${p.sky.sunAzimuth}|${p.sky.sunElevation}`))].map((s) => s.split('|').map(Number));
  const phases = suns.map(([az, el]) => phaseFor(az, el)).sort((x, y) => x - y);
  let closest = 1 - (phases[phases.length - 1] - phases[0]);
  for (let i = 1; i < phases.length; i++) closest = Math.min(closest, phases[i] - phases[i - 1]);
  ok(suns.length > 5, `the planet list has suns enough to tell (${suns.length})`);
  ok(closest > 0.005, `and the two closest of them are a fair way apart (${(closest * 720).toFixed(1)} s of a 720 s day)`);
}

console.log(`\n${passed} checks passed`);
