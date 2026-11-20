// The weather in a word or two, for the line under the minimap (the interface rewrite's first wave): "Rain", never
// "Weather: Rain". The owner's table (19 November 2026), mapped onto what the game really holds.
//
// What the game holds: a world's weather level, 0 to 4 (three on Mustafar), walked by the shared schedule and eased
// between whole levels (`Weather.level`); and what falls at that level in the area you stand in, which is one camera
// effect a row, named by the client's own file (`cameraEffectKind` and `cameraEffectStrength` in `tools/swg/sky.mjs`).
// The kinds are rain, snow, dust, fog, leaves, lightning, smoke and other; the strengths are read off the file's name:
// "verylight" 0.35, "light" 0.6, a plain name 0.7, "heavy" 1. Converted, the worlds hold rain at 0.35, 0.6 and 1, dust
// at 0.6, 0.7 and 1, snow at 0.7 (Life Day's) and 1 (the snow storm's), and fog, leaves, smoke and lightning at 0.7
// only. The weather mixes up to four rows at once (two levels, two areas) and reports what each kind of fall adds up
// to (`WeatherState.fallShare` and the rest), so the word follows a change of level or of area at its midpoint: a fall
// is named once it has half the mix, and its strength is the one carrying the most of it (the heavier on a tie), so a
// crossfade from light rain to heavy says Downpour from its half-way mark, whichever two strengths meet.
//
// The table, and where the mapping had to guess:
//   - nothing falling: level 0 Clear, 1 and 2 Cloudy, 3 and 4 Overcast (the level rounded, so at the midpoint);
//   - rain: very light Sprinkle, light Rain, heavy Downpour; with lightning, Storm. No world holds rain and lightning
//     together, so Storm comes up only from a mix of two areas, or a place of ours that forces rain over Mustafar's
//     lightning; lightning counts as "with" once it has `withShare` of the mix (a guess);
//   - lightning without rain: Lightning (Mustafar's lightning areas at level 0);
//   - dust: light Dusty, plain Blowing Dust, heavy Dust Storm (the very light strength, which only a forced kind's
//     slot could give, reads as light);
//   - snow: Life Day's and anything lighter Snow, the storm Blizzard;
//   - fog: light Misty, thick Foggy. Every fog the game holds is the plain 0.7, so the name cannot tell light from
//     thick: here a plain fog is Misty under level 3 and Foggy from it (a guess: the level is the only other thing
//     that says how much weather there is). A file named light or heavy would decide it by itself;
//   - leaves blowing: Windy; smoke or ash: Smoky (Mustafar's lava smoke, at every level);
//   - an effect of no kind the reader knows ("other"): the level's own word, since nothing says what falls.
// A fall wins over the level's word, so Mustafar's level 0 in a hot area says Dusty, and Corellia's forests at level 0
// say Windy, which is what is drawn there; "level 0 Clear" holds wherever nothing falls at level 0.
//
// Pure: no DOM and nothing of the game's but a type, and every answer is one of the strings below, so asking every
// frame allocates nothing (`weatherWords.test.ts`).
import type { WeatherKind } from '../world/weatherSchedule.ts';

/** What the word is worked out from: the weather's own state carries all six (`WeatherState`), so it is handed over as it is. */
export interface WeatherReading {
  /** The continuous level, 0 up. */
  readonly level: number;
  /** The heaviest falling effect's kind, or 'clear' with none. */
  readonly kind: WeatherKind | 'clear';
  /** The share of the mix (0 to 1) whose rows fall that kind. */
  readonly fallShare: number;
  /** Their strength: the converter's carrying the most of the share (0.35 very light, 0.6 light, 0.7 plain, 1 heavy). */
  readonly fallStrength: number;
  /** Rain's own share and lightning's, for "rain with lightning". */
  readonly rainShare: number;
  readonly lightningShare: number;
}

/**
 * The cut points. `fallShare` is the midpoint: a fall is named once half the mix carries it, so the word changes where
 * the crossfade is half done. The three strengths are the midpoints between the converter's own (0.35 and 0.6, 0.6 and
 * 0.7, 0.7 and 1), which only sort the four strengths it ever hands over (the weather hands over one of them, not a
 * mean, so where a crossfade changes the word is the weather's half-way mark, not these). `withShare` is how much of the
 * mix the other of rain and lightning needs to make a Storm, and `foggyLevel` the level a plain fog is Foggy from: the
 * two guesses. None of this is feel; it is how the game's numbers are read, live through `__debug.hud({ weatherWords })`.
 */
export const WEATHER_WORD_TUNE = {
  fallShare: 0.5,
  veryLightBelow: 0.475,
  lightBelow: 0.65,
  heavyFrom: 0.85,
  withShare: 0.25,
  foggyLevel: 3,
};

/** Every word the line can say. One string each, made once, so a frame that asks makes nothing. */
export const WEATHER_WORDS = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  overcast: 'Overcast',
  sprinkle: 'Sprinkle',
  rain: 'Rain',
  downpour: 'Downpour',
  storm: 'Storm',
  lightning: 'Lightning',
  dusty: 'Dusty',
  blowingDust: 'Blowing Dust',
  dustStorm: 'Dust Storm',
  snow: 'Snow',
  blizzard: 'Blizzard',
  misty: 'Misty',
  foggy: 'Foggy',
  windy: 'Windy',
  smoky: 'Smoky',
} as const;

export type WeatherWord = (typeof WEATHER_WORDS)[keyof typeof WEATHER_WORDS];

/**
 * The level's own word, with nothing falling: rounded, so it changes at the midpoint of the schedule's crossfade. It
 * takes the reading and not the level, since a fraction handed to a call the compiler leaves out is a number made.
 */
function levelWord(r: WeatherReading): WeatherWord {
  const l = Math.round(r.level > 0 ? r.level : 0);
  return l <= 0 ? WEATHER_WORDS.clear : l <= 2 ? WEATHER_WORDS.cloudy : WEATHER_WORDS.overcast;
}

/** The weather now in a word or two. Takes a record and hands back a kept string, so a frame that asks makes nothing. */
export function weatherWord(r: WeatherReading): WeatherWord {
  const T = WEATHER_WORD_TUNE;
  const kind = r.kind;
  if (kind === 'clear' || kind === 'other' || !(r.fallShare >= T.fallShare)) return levelWord(r);
  const s = r.fallStrength;
  switch (kind) {
    case 'rain':
      if (r.lightningShare >= T.withShare) return WEATHER_WORDS.storm;
      return s < T.veryLightBelow ? WEATHER_WORDS.sprinkle : s < T.heavyFrom ? WEATHER_WORDS.rain : WEATHER_WORDS.downpour;
    case 'lightning':
      return r.rainShare >= T.withShare ? WEATHER_WORDS.storm : WEATHER_WORDS.lightning;
    case 'dust':
      return s < T.lightBelow ? WEATHER_WORDS.dusty : s < T.heavyFrom ? WEATHER_WORDS.blowingDust : WEATHER_WORDS.dustStorm;
    case 'snow':
      return s < T.heavyFrom ? WEATHER_WORDS.snow : WEATHER_WORDS.blizzard;
    case 'fog':
      if (s < T.lightBelow) return WEATHER_WORDS.misty;
      if (s >= T.heavyFrom) return WEATHER_WORDS.foggy;
      return Math.round(r.level) >= T.foggyLevel ? WEATHER_WORDS.foggy : WEATHER_WORDS.misty;
    case 'leaves':
      return WEATHER_WORDS.windy;
    case 'smoke':
      return WEATHER_WORDS.smoky;
    default:
      return levelWord(r);
  }
}

/** Why the weather is not running while the Graphics page's Weather switch is off (`WeatherState.reason`). */
export const WEATHER_SETTING_OFF = 'setting off';

/** What the line reads: the six, and why the weather is not running, or null while it is (`WeatherState.reason`). */
export interface WeatherLineReading extends WeatherReading {
  readonly reason: string | null;
}

/**
 * The line's word from the weather's own state: `weatherWord` while the weather runs; "Clear" with the Weather setting
 * off, since nothing falls then and the switch says there is no weather (the level still walks down to 0 over a few
 * seconds, and read as it walks it said Overcast, then Cloudy, for weather just switched off: the wave's review saw it);
 * and nothing where the weather is off for any other reason (no sky, no table to read, space, the gallery). A kept
 * string, so a frame that asks makes nothing.
 */
export function weatherLineWord(s: WeatherLineReading): WeatherWord | '' {
  const why = s.reason;
  if (why === null) return weatherWord(s);
  return why === WEATHER_SETTING_OFF ? WEATHER_WORDS.clear : '';
}

/** Move any of the cut points (finite numbers only); the answer is the table as it stands. */
export function tuneWeatherWords(o: Partial<typeof WEATHER_WORD_TUNE>): typeof WEATHER_WORD_TUNE {
  const t = WEATHER_WORD_TUNE as Record<string, number>;
  for (const k of Object.keys(WEATHER_WORD_TUNE)) {
    const v = (o as Record<string, unknown>)[k];
    if (typeof v === 'number' && Number.isFinite(v)) t[k] = v;
  }
  return WEATHER_WORD_TUNE;
}
