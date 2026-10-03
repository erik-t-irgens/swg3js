// The creator's hour: a slider over the whole day that stops the day where it is put, a play button
// that lets it run, and the captured hours kept as marks.
//
// The fix round's item, and the fault it found by reading the code: the creator opened on a captured
// hour "held, so the day does not walk off it", but a hand write only took the day off the shared
// clock -- with no server it went on running at a game hour every thirty seconds from the moment the
// place was shown. `DayCycle.paused` is what really stops it, and the one thing that must never
// happen is a pause carried out of the creator into a played world, which would stop that world's sun
// and take it off the clock everybody shares.
//
// The day and the slider's arithmetic run here; the bar and the game's wiring live in files node
// cannot load, and are read out of the source.
//
// Run: node tools/swg/tests/placeClock.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DayCycle } from '../../../src/world/daycycle.ts';
import { sharedClock } from '../../../src/world/sharedClock.ts';
import { PLACE_CLOCK_TUNE, capturedAt, clockText, hourOfTime, hourTicks, snapHour, thumbMoved, wrapHour } from '../../../src/ui/placeClock.ts';
import { hourLabel } from '../../../src/world/scenePlaces.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const EPOCH = 1_700_000_000_000;
const dt = 1 / 60;

// ---------------------------------------------------------------- the day stopped and let run

{
  let wall = EPOCH;
  sharedClock.wall = () => wall;
  sharedClock.none();
  const day = new DayCycle(0, 1);
  day.update(dt, false);

  // What the creator did before: a hand write and nothing else. The day walked off the hour.
  day.time = 18 / 24;
  for (let i = 0; i < 60 * 30; i++) {
    wall += dt * 1000;
    day.update(dt, false);
  }
  ok(near(day.time * 24, 19, 0.01), `a hand write alone does not stop the day: thirty seconds later it is an hour on (${(day.time * 24).toFixed(2)})`);

  // What it does now.
  day.paused = true;
  day.time = 18 / 24;
  for (let i = 0; i < 60 * 120; i++) {
    wall += dt * 1000;
    day.update(dt, false);
  }
  ok(day.time === 18 / 24, 'paused, two minutes of frames leave the hour exactly where it was put');
  for (let i = 0; i < 60; i++) {
    wall += dt * 1000;
    day.update(dt, true);
  }
  ok(day.time === 18 / 24, 'and not even the fast-forward key moves it');
  ok(day.daylight >= 0 && day.daylight <= 1 && Number.isFinite(day.sunDir.y), 'the sun is still worked out from it every frame');

  // A drag moves it, and it stays where it is dragged.
  day.time = 22.5 / 24;
  for (let i = 0; i < 600; i++) {
    wall += dt * 1000;
    day.update(dt, false);
  }
  ok(day.time === 22.5 / 24, 'a drag into the night stops it there, at night');

  // Play: the day's own rate from wherever it stands.
  day.paused = false;
  const from = day.time;
  for (let i = 0; i < 600; i++) {
    wall += dt * 1000;
    day.update(dt, false);
  }
  ok(near(day.time, (from + 600 * dt / day.dayLengthSeconds) % 1, 1e-9), 'let run, it goes at the day\'s own rate from where it stood');
}

{
  // With a server's clock running the day follows it -- unless the creator has it stopped.
  let wall = EPOCH;
  sharedClock.wall = () => wall;
  sharedClock.hail(wall);
  const day = new DayCycle(0, 1);
  day.update(0, false);
  const shared = sharedClock.timeOfDay(day.dayLengthSeconds, day.phase)!;
  ok(near(day.time, shared, 1e-9), 'a day with a server behind it takes the shared hour');
  day.paused = true;
  day.time = (shared + 0.4) % 1;
  for (let i = 0; i < 600; i++) {
    wall += dt * 1000;
    day.update(dt, false);
  }
  ok(near(day.time, (shared + 0.4) % 1, 1e-12), 'stopped, it follows no shared clock either: the hour picked is the hour shown');
  day.paused = false;
  day.release();
  wall += 2000;
  day.update(0, false);
  ok(near(day.time, sharedClock.timeOfDay(day.dayLengthSeconds, day.phase)!, 1e-9), 'given back, it is the shared hour again');
  sharedClock.none();
}

// ---------------------------------------------------------------- the slider's arithmetic

{
  ok(wrapHour(24) === 0 && wrapHour(-1) === 23 && wrapHour(25.5) === 1.5 && wrapHour(Number.NaN) === 0, 'an hour is always on the clock face');
  ok(clockText(6.5) === '06:30' && clockText(0) === '00:00' && clockText(23.999) === '00:00', 'the clock reads hours and minutes');
  let same = true;
  for (let h = 0; h < 24; h += 0.0137) if (clockText(h) !== hourLabel('only', 'only', h)) same = false;
  ok(same, 'and reads them exactly as the captured hours\' own labels do');
  ok(hourOfTime(0.5) === 12 && hourOfTime(0.25) === 6, "the day's time is an hour of the clock");
  ok(snapHour(6.04) === 6 && snapHour(6.05) === 6.083333, 'the thumb sits on the slider\'s own step');
  ok(snapHour(23.99) === 0, 'and the step past the last one is midnight again, not off the end');
  ok(PLACE_CLOCK_TUNE.stepMinutes === 5, 'a step is five minutes');

  // A running day writes the thumb about once a step, not once a frame.
  let writes = 0;
  let written = Number.NaN;
  let time = 0.3;
  for (let i = 0; i < 60 * 60; i++) {
    time = (time + dt / 720) % 1;
    const h = hourOfTime(time);
    if (thumbMoved(written, h)) {
      written = h;
      writes++;
    }
  }
  // A minute of a twelve-minute day is two hours, which is twenty-four steps of five minutes.
  ok(writes >= 23 && writes <= 26, `a minute of a running day writes the thumb ${writes} times, not 3600`);
  ok(thumbMoved(23.95, 0.05) === true && thumbMoved(23.99, 0.01) === false, 'the step is measured the short way round midnight');
  ok(thumbMoved(Number.NaN, 5), 'the first write always goes');

  const hours = [{ name: 'sunset', hour: 19.65 }, { name: 'morning', hour: 8.5 }, { name: 'again', hour: 8.5 }];
  ok(hourTicks(hours).join(',') === '8.5,19.65', "the owner's captured hours are marks on the slider, in the day's order, each once");
  ok(capturedAt(hours, 19.66) === 0 && capturedAt(hours, 12) === -1, 'and the clock standing on one lights it, and between them lights none');
}

// ---------------------------------------------------------------- the wiring, read out of the source

{
  const main = read('src/main.ts');
  const bar = read('src/ui/placeBar.ts');
  const day = read('src/world/daycycle.ts');

  ok(/const step = this\.paused \? 0 :/.test(day), 'the day steps nought while it is stopped');
  ok(/this\.held \|\| fast \|\| this\.paused \? null/.test(day), 'and asks no shared clock');

  // The game's files may carry either line ending, so a method's end is matched with or without the CR.
  const show = /private async showScene\(key: string\)[\s\S]*?\r?\n  \}\r?\n/.exec(main)?.[0] ?? '';
  ok(/this\.world\.day\.paused = true;\s*if \(hour !== undefined\) this\.world\.day\.time = hour \/ 24;/.test(show), 'a place opens with the day stopped on its captured hour');
  const hide = /private async hideScene\(\)[\s\S]*?\r?\n  \}\r?\n/.exec(main)?.[0] ?? '';
  ok(/this\.world\.day\.paused = false;[\s\S]*clockKnob\(\{ release: true \}\)/.test(hide), 'leaving the creator starts the day again before handing it back');
  const arrive = /private arrive\(planet: PlanetDef[\s\S]*?this\.placeNames = \[\];/.exec(main)?.[0] ?? '';
  ok(/this\.world\.day\.paused = false;/.test(arrive), 'and every played world starts with its day running, whatever was left behind');
  ok(/this\.world\.day\.paused = true;\s*this\.world\.day\.time = \(hour \/ 24\) % 1;/.test(main), 'a drag stops the day and puts it where it was dragged');
  ok(/this\.placeBar\.onPlay = \(playing\) => \{\s*this\.world\.day\.paused = !playing;/.test(main), 'play lets it run');
  ok(/this\.placeBar\.onSettle = \(\) => this\.world\.recaptureSky\(\)/.test(main), 'and a drag that has rested takes the reflections again at once');
  ok(/if \(!this\.world\.day\.paused\) this\.placeBar\.follow\(this\.world\.day\.time \* 24\)/.test(main), 'a running day moves the thumb, through the step rule');
  ok(/type="range" class="hour-range" min="0" max="24"/.test(bar), 'the slider is the whole day, midnight to midnight');
  ok(/<datalist id="place-bar-hours">/.test(bar) && /hourTicks\(/.test(bar), "with the owner's captured hours marked on it");
  ok(/PLACE_CLOCK_TUNE\.settleMs/.test(bar), 'and a drag counts as settled after a moment of its own');
}

console.log(`\n${passed} checks passed`);
