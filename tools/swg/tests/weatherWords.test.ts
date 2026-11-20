// The weather in a word or two (src/ui/weatherWords.ts), from what the weather's mix falls (the tally and its reading in
// src/world/weatherSchedule.ts, which `Weather` keeps and reads every frame): the owner's table of 19 November 2026,
// mapped onto what the game really holds, the change of word at a crossfade's half-way mark, and nothing made by a frame
// that asks.
//
// The rows here are the converted worlds' own, as the converter names them (`cameraEffectKind` and
// `cameraEffectStrength` in tools/swg/sky.mjs): rain at 0.35, 0.6 and 1, dust at 0.6, 0.7 and 1, snow at 0.7 and 1, fog,
// leaves, smoke and lightning at 0.7. Nothing is read from the game's files: the numbers are the converter's own rules.
//
// Run: node tools/swg/tests/weatherWords.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WEATHER_SETTING_OFF, WEATHER_WORDS, WEATHER_WORD_TUNE, tuneWeatherWords, weatherLineWord, weatherWord } from '../../../src/ui/weatherWords.ts';
import { FALL_STRENGTHS, addFall, clearFalls, createFallTally, readFalls, strengthSlot, type FallReading, type WeatherKind } from '../../../src/world/weatherSchedule.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A reading as the weather keeps one: the level, the heaviest kind, the tally read into the same record, and why the weather is not running (null while it is). */
type Reading = FallReading & { level: number; kind: WeatherKind | 'clear'; reason: string | null };
const tally = createFallTally();
// Begun as fractions, as the weather's own state is, so each field is a double from its first write.
const reading: Reading = { level: 0.5, kind: 'clear', fallShare: 0.5, fallStrength: 0.5, rainShare: 0.5, lightningShare: 0.5, reason: null };

/**
 * The weather's own way to its reading, for a mix of rows: each `[kind, strength, weight]` added as `Weather.want` adds
 * it, the heaviest kind the one with the most weight (as `want` keeps it), and the tally read as `copyState` reads it.
 */
function mix(level: number, rows: readonly (readonly [WeatherKind, number, number])[]): Reading {
  clearFalls(tally);
  let heaviest = 0;
  let kind: WeatherKind | 'clear' = 'clear';
  for (const [k, s, w] of rows) {
    tally.weight = w;
    addFall(tally, { kind: k, strength: s });
    if (w > heaviest) {
      heaviest = w;
      kind = k;
    }
  }
  reading.level = level;
  reading.kind = kind;
  readFalls(tally, kind, reading);
  return reading;
}
const word = (level: number, rows: readonly (readonly [WeatherKind, number, number])[]) => weatherWord(mix(level, rows));
/** In the twelve child processes (--alloc), only the measure runs: the checks first would set the code's type feedback. */
const ALLOC = process.argv.includes('--alloc');

// ---------------------------------------------------------------------------------------------
// The owner's table, row by row, at what the game holds.
if (!ALLOC) {
  ok(word(0, []) === 'Clear', 'level 0, nothing falling: Clear');
  ok(word(1, []) === 'Cloudy' && word(2, []) === 'Cloudy', 'levels 1 and 2, nothing falling: Cloudy');
  ok(word(3, []) === 'Overcast' && word(4, []) === 'Overcast', 'levels 3 and 4, nothing falling: Overcast');
  ok(word(2, [['rain', 0.35, 1]]) === 'Sprinkle', 'very light rain: Sprinkle');
  ok(word(3, [['rain', 0.6, 1]]) === 'Rain', 'light rain: Rain');
  ok(word(4, [['rain', 1, 1]]) === 'Downpour', 'heavy rain: Downpour');
  ok(word(4, [['rain', 1, 0.6], ['lightning', 0.7, 0.4]]) === 'Storm' && word(0, [['lightning', 0.7, 0.6], ['rain', 0.6, 0.4]]) === 'Storm', 'rain with lightning, whichever is the heavier: Storm');
  ok(word(0, [['lightning', 0.7, 1]]) === 'Lightning', 'lightning without rain (Mustafar\'s at level 0): Lightning');
  ok(word(1, [['dust', 0.6, 1]]) === 'Dusty', 'light dust: Dusty');
  ok(word(2, [['dust', 0.7, 1]]) === 'Blowing Dust', 'plain dust: Blowing Dust');
  ok(word(3, [['dust', 1, 1]]) === 'Dust Storm', 'heavy dust: Dust Storm');
  ok(word(0, [['dust', 0.35, 1]]) === 'Dusty', 'and a very light dust, which only a forced slot could give, reads as light');
  ok(word(0, [['snow', 0.7, 1]]) === 'Snow', "Life Day's snow: Snow");
  ok(word(0, [['snow', 1, 1]]) === 'Blizzard', 'the snow storm: Blizzard');
  ok(word(0, [['fog', 0.6, 1]]) === 'Misty' && word(4, [['fog', 1, 1]]) === 'Foggy', 'a light fog is Misty and a heavy one Foggy, whatever the level');
  ok(word(1, [['fog', 0.7, 1]]) === 'Misty' && word(3, [['fog', 0.7, 1]]) === 'Foggy', `and the plain fog, the only one the game holds, by the level (the guess): Misty under ${WEATHER_WORD_TUNE.foggyLevel}, Foggy from it`);
  ok(word(0, [['leaves', 0.7, 1]]) === 'Windy', 'leaves blowing: Windy');
  ok(word(2, [['smoke', 0.7, 1]]) === 'Smoky', 'smoke or ash: Smoky');
  ok(word(3, [['other', 0.7, 1]]) === 'Overcast' && word(0, [['other', 0.7, 1]]) === 'Clear', 'an effect of no kind the reader knows says the level\'s own word');
  ok(word(0, [['dust', 0.7, 1]]) === 'Blowing Dust', "a fall wins over the level's word: Mustafar's level 0 in a hot area says what is drawn there");
}

// ---------------------------------------------------------------------------------------------
// The crossfades: the word changes at the half-way mark, as the schedule's level does.
if (!ALLOC) {
  // Clear at level 0 into very light rain at level 1 (Naboo's 1 to 2 is the same with Cloudy), the level walking with the share.
  const into = (t: number) => word(t, [['rain', 0.35, t]]);
  ok(into(0.49) === 'Clear' && into(0.5) === 'Sprinkle' && into(0.51) === 'Sprinkle', `clear into very light rain says Sprinkle from half way, not before (${into(0.49)}, ${into(0.5)})`);
  // Light rain into heavy (every rain world's 3 to 4): the strength carrying the most of the rain decides.
  const heavier = (t: number) => word(3 + t, [['rain', 0.6, 1 - t], ['rain', 1, t]]);
  ok(heavier(0.4) === 'Rain' && heavier(0.49) === 'Rain' && heavier(0.5) === 'Downpour' && heavier(0.6) === 'Downpour', `light into heavy rain says Downpour from half way, not at a mean's crossing (${heavier(0.49)}, ${heavier(0.5)})`);
  // Endor's desert, light dust straight into heavy: never a passing Blowing Dust between.
  let words = new Set<string>();
  for (let t = 0; t <= 1.0001; t += 0.01) words.add(word(2 + t, [['dust', 0.6, 1 - t], ['dust', 1, t]]));
  ok([...words].join(',') === 'Dusty,Dust Storm', `light dust straight into heavy (Endor's desert) goes Dusty then Dust Storm, nothing between (${[...words].join(', ')})`);
  // Tatooine's 1 to 2 to 3: light, plain, heavy dust, each at its half way.
  words = new Set<string>();
  const order: string[] = [];
  for (let l = 1; l <= 3.0001; l += 0.01) {
    const t = l - Math.floor(l);
    const lo = Math.floor(l);
    const s = [0, 0.6, 0.7, 1][lo];
    const s2 = [0, 0.6, 0.7, 1][Math.min(3, lo + 1)];
    const w = word(l, t > 0 ? [['dust', s, 1 - t], ['dust', s2, t]] : [['dust', s, 1]]);
    if (order[order.length - 1] !== w) order.push(w);
  }
  ok(order.join(',') === 'Dusty,Blowing Dust,Dust Storm', `Tatooine's levels 1 to 3 walk Dusty, Blowing Dust, Dust Storm (${order.join(', ')})`);
  // Walking out of a rain area into a dry one at level 2: the family crossfade, four rows at once.
  const area = (f: number) => word(2, [['rain', 0.35, (1 - f) * 0.5], ['rain', 0.35, (1 - f) * 0.5]]);
  ok(area(0.4) === 'Sprinkle' && area(0.6) === 'Cloudy', 'and walking out of a rain area into a dry one, the rain goes at the fade\'s half way too');
  ok(FALL_STRENGTHS.every((s, i) => strengthSlot(s) === i), "the converter's four strengths sort into their own four places");
}

// ---------------------------------------------------------------------------------------------
// The words are kept strings, the cut points are live, and the reader is the weather's own.
if (!ALLOC) {
  const all = new Set(Object.values(WEATHER_WORDS));
  ok(all.size === 17, `seventeen words, every row of the table (${all.size})`);
  const a = word(4, [['rain', 1, 1]]);
  const b = word(4, [['rain', 1, 1]]);
  ok(a === WEATHER_WORDS.downpour && Object.is(a, b), 'the same word is the same kept string every time');
  ok(![...all].some((w) => /weather|:/i.test(w)), 'and none of them says "Weather:"');
  const was = WEATHER_WORD_TUNE.foggyLevel;
  tuneWeatherWords({ foggyLevel: 1 });
  ok(word(1, [['fog', 0.7, 1]]) === 'Foggy', 'a cut point moved live is taken at once');
  tuneWeatherWords({ foggyLevel: was, notACut: 3 } as never);
  ok(WEATHER_WORD_TUNE.foggyLevel === was && !('notACut' in WEATHER_WORD_TUNE), 'and put back; a name that is not a cut point is not taken');
  const weather = readFileSync(new URL('../../../src/world/weather.ts', import.meta.url), 'utf8');
  ok(/this\.falls\.weight = w;\s+addFall\(this\.falls, c\);/.test(weather) && /readFalls\(this\.falls, this\.kind, s\);/.test(weather) && (weather.match(/clearFalls\(this\.falls\);/g) ?? []).length === 2, "the weather tallies every effect it plays with the same rule, and reads it into its state every frame");
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const now = /private weatherWordNow\(\): string \{([\s\S]*?)\n  \}/.exec(main)?.[1] ?? '';
  ok(/planet\.space \|\| planet\.instances\) return '';/.test(now) && /return weatherLineWord\(this\.world\.weather\.state\);/.test(now) && !/reason/.test(now), 'the game says the line\'s word from the weather\'s own state through the line\'s own rule, and nothing in space or a dungeon');
  ok(/s\.reason = this\.reason \?\? \(!this\.hasWeatherData \? 'no weather data' : !this\.settings\.weather \? 'setting off' : null\);/.test(weather) && WEATHER_SETTING_OFF === 'setting off', "and the weather says 'setting off' in the very words the rule asks for");
}

// ---------------------------------------------------------------------------------------------
// The line's word from the weather's own state: why the weather is not running decides first.
if (!ALLOC) {
  // The Weather setting switched off at level 4 in heavy rain: the falls stop at once and the level walks down at a third
  // of a level a second, so for about ten seconds the level alone said Overcast and then Cloudy (the wave's review).
  const off = (level: number) => {
    mix(level, []);
    reading.reason = WEATHER_SETTING_OFF;
    return weatherLineWord(reading);
  };
  const walk = [3.66, 2.65, 1.84, 0.63, 0.3, 0].map(off);
  ok(walk.every((w) => w === 'Clear'), `with the Weather setting off the line says Clear at once, however far the level has still to walk down (${walk.join(', ')})`);
  mix(1.84, []);
  reading.reason = null;
  ok(weatherLineWord(reading) === 'Cloudy' && weatherLineWord(reading) === weatherWord(reading), 'while the weather runs the line says the table\'s own word');
  const none = ['space', 'gallery', 'no sky', 'no weather data'].map((why) => {
    mix(3, [['rain', 1, 1]]);
    reading.reason = why;
    return weatherLineWord(reading);
  });
  ok(none.every((w) => w === ''), `and nothing at all where the weather does not run for a reason of the world's (${JSON.stringify(none)})`);
  reading.reason = null;
}

// ---------------------------------------------------------------------------------------------
// Nothing made by a frame that asks, in twelve fresh processes at once (docs/lessons/testing.md).
if (ALLOC) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as unknown as { gc: (o?: unknown) => void }).gc;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  // Two kept rows as the weather keeps its effect choice, and a crossfade walking in a kept record, so the numbers
  // moving are fractions held in fields, as they are in play.
  const light = { kind: 'rain' as WeatherKind, strength: 0.6 };
  const heavy = { kind: 'rain' as WeatherKind, strength: 1 };
  const walk = { k: 0, t: 0.5 };
  reading.level = 3.5;
  reading.kind = 'rain';
  const step = () => {
    walk.k = (walk.k + 1) % 100;
    walk.t = walk.k / 100;
    clearFalls(tally);
    tally.weight = 1 - walk.t;
    addFall(tally, light);
    tally.weight = walk.t;
    addFall(tally, heavy);
    reading.level = 3 + walk.t;
    readFalls(tally, reading.kind, reading);
    // The line's own rule, as the frame asks it (`App.weatherWordNow`), which asks the table's.
    weatherLineWord(reading);
  };
  // The window `hudHide.test.ts` measures in: warmed, a minor collection, and a count of the young space over 20000
  // calls that no collection fell inside. Warmed long first, with turns between, as a game's frame is after its first
  // seconds: twelve processes at once on one machine leave the background compiler a while to land its code, and a
  // call measured before it lands is measured unbuilt.
  for (let w = 0; w < 10; w++) {
    for (let i = 0; i < 6000; i++) step();
    await turn();
  }
  // The least of three windows no collection fell inside: a call that really makes something makes it in every window,
  // while one window caught before the compiler's code landed reads high once and never again (traced: no deopt in
  // any process, the code simply not yet installed when the window opened).
  let best = Number.NaN;
  let clean = 0;
  for (let tries = 0; tries < 12 && clean < 3; tries++) {
    for (let i = 0; i < 4000; i++) step();
    gc({ type: 'minor' });
    await turn();
    await turn();
    const c0 = collections;
    const b = young();
    for (let i = 0; i < 20000; i++) step();
    const a = young();
    await turn();
    await turn();
    if (collections === c0) {
      const per = (a - b) / 20000;
      best = clean === 0 ? per : Math.min(best, per);
      clean++;
    }
  }
  console.log(JSON.stringify({ word: best }));
  process.exit(0);
}
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from({ length: 12 }, () =>
      new Promise<number | string>((res) => {
        const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        ch.stdout.on('data', (b) => (out += b));
        ch.stderr.on('data', (b) => (err += b));
        ch.on('close', () => {
          try {
            res(JSON.parse(out.trim().split('\n').pop() ?? '').word as number);
          } catch {
            res(`no answer: ${err.slice(0, 300)}`);
          }
        });
      }),
    ),
  );
  const bad = runs.filter((r) => typeof r === 'string');
  ok(bad.length === 0, `every process answered (${bad.join('; ')})`);
  const v = runs as number[];
  ok(v.every((x) => Number.isFinite(x) && x < 0.5), `a frame's tally, reading and word make nothing in 12 of 12 processes (${v.map((x) => x.toFixed(3)).join(' ')} B)`);
}

console.log(`\nweatherWords: ${checks} checks passed`);
