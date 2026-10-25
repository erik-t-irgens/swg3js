// The unified wind's dials (src/ui/dials.ts), outside the air's own (`airDials.ts`) because the hold and the wind aloft
// must work with the master off: "Hold the wind" (the owner's slider to observe with: moving one holds, the menu's reset
// gives the wind back to the weather), "Wind by weather" (a group a kind of weather, with the read-outs gusts an hour and
// seconds a gust beside cover and size), "Wind by world" (the world you stand on and its level in force), "Wind aloft",
// "Gusts and devils" and the grass's sheen. Each is set through `__debug.wind`'s own arguments (`holdWind`, `tuneWind`),
// so the line the menu copies out is that helper's (`wind({ speed: 8 })`, `wind({ tune: { profiles: { clear: { gust: 1.5 } } } })`).
// Every number of feel is the owner's to judge by eye (CLAUDE.md, "Feel is the owner's"); a slider's range is ours.
//
// Pure: it imports the wind's tables and the dials' own types and nothing of the page.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { WIND_KINDS, WORLD_KEYS, type WindKind, type WorldKey } from './windMath.ts';
import { WIND_HOLD, WIND_PROFILES, WIND_TUNE, holdWind, releaseWind, tuneWind, windHeld, windReadouts, windWorldId, windWorldOf } from './wind.ts';

const DEG = 180 / Math.PI;

/** What the dials read of the world now (set by the game): the wind as it blows and where the player stands. */
export interface WindNowSource {
  speed(): number;
  heading(): number;
  at(): { x: number; z: number };
  /** The weather's whole level in force (for "Wind by world"'s level row). */
  level(): number;
}

let source: WindNowSource | null = null;

/** The game's source of the wind now, for the hold's "held" choice and the read-outs. */
export function setWindNowSource(s: WindNowSource | null): void {
  source = s;
}

/** A hold dial: −1 is the weather's own (the shipped value), anything else held. */
function holdDial(field: 'speed' | 'heading' | 'gust', label: string, max: number, step: number, unit: string, note: string): NumberDial {
  return {
    kind: 'number',
    key: field,
    label,
    note,
    min: -1,
    max,
    step,
    unit,
    get: () => {
      const v = WIND_HOLD[field];
      if (v === null) return -1;
      if (field === 'heading') return Math.round(((((v * DEG) % 360) + 360) % 360) * 10) / 10;
      return v;
    },
    set: (v) => {
      if (!(v >= 0)) return holdWind({ [field]: null });
      return holdWind({ [field]: field === 'heading' ? v / DEG : v });
    },
    text: (v) => (v < 0 ? "the weather's own" : ''),
  };
}

/** A number of `WIND_TUNE`, as a slider set through `tuneWind`. */
function tuneDial(group: keyof typeof WIND_TUNE, key: string, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  const table = WIND_TUNE[group] as unknown as Record<string, number>;
  return {
    kind: 'number',
    key: `tune.${group}.${key}`,
    label,
    note,
    min,
    max,
    step,
    unit,
    get: () => table[key],
    set: (v) => tuneWind({ [group]: { [key]: v } }).notes,
  };
}

/** The read-outs of a kind of weather at the player's place, worked out when one of its dials moves and kept. */
const readouts = new Map<WindKind, string>();

function readoutOf(kind: WindKind): string {
  let r = readouts.get(kind);
  if (r === undefined) {
    const at = source?.at();
    const o = at ? windReadouts(at.x, at.z, WIND_PROFILES[kind]) : null;
    r = o ? `about ${Math.round(o.perHour)} gusts an hour where you stand, ${o.secondsEach.toFixed(0)} s each` : 'no world: the read-outs come with one';
    readouts.set(kind, r);
  }
  return r;
}

/** A number of a kind of weather's profile. */
function profileDial(kind: WindKind, key: keyof (typeof WIND_PROFILES)['clear'], label: string, min: number, max: number, step: number, unit: string, note: string, readout = false): NumberDial {
  const row = WIND_PROFILES[kind] as unknown as Record<string, number>;
  const d: NumberDial = {
    kind: 'number',
    key: `tune.profiles.${kind}.${key}`,
    label,
    note,
    min,
    max,
    step,
    unit,
    get: () => row[key],
    set: (v) => {
      readouts.delete(kind);
      return tuneWind({ profiles: { [kind]: { [key]: v } } }).notes;
    },
  };
  if (readout) d.text = () => readoutOf(kind);
  return d;
}

/** A multiplier of `WIND_WORLDS` for a world (and a level of it, or none for the world's own). */
function worldDial(id: string, level: number | null, key: WorldKey, label: string): NumberDial {
  const e = windWorldOf(id);
  const row = (level === null ? e : e.byLevel[level]) as unknown as Record<string, number>;
  return {
    kind: 'number',
    key: level === null ? `tune.worlds.${id}.${key}` : `tune.worlds.${id}.byLevel.${level}.${key}`,
    label,
    note: level === null ? `Every kind of weather's ${key} on this world times this.` : `And at weather level ${level} times this as well.`,
    min: 0,
    max: key === 'devils' ? 10 : 4,
    step: 0.05,
    unit: '×',
    get: () => row[key],
    set: (v) => tuneWind({ worlds: { [id]: level === null ? { [key]: v } : { byLevel: { [level]: { [key]: v } } } } }).notes,
  };
}

const KIND_WORDS: Record<WindKind, string> = {
  clear: 'Clear days (a row with no weather of its own)',
  leaves: 'Falling leaves',
  rain: 'Rain',
  dust: 'Dust storms',
  snow: 'Snow',
  fog: 'Fog',
  smoke: "Smoke (Mustafar's)",
  lightning: "Lightning (Mustafar's)",
};

const WORLD_WORDS: Record<WorldKey, string> = { floor: 'Calm floor', gust: 'Gusts', cover: 'Ground under a gust', size: 'Gust size', wander: 'Heading wanders', devils: 'Devils' };

/** The hold's "the weather's / held" choice: held takes the wind as it blows now. */
function holdChoice(): ChoiceDial {
  return {
    kind: 'choice',
    key: 'hold',
    label: 'Whose wind',
    note: "The weather's own, or held where it stands now (speed, heading and gusts). Moving any slider below holds it too; Reset gives the wind back to the weather.",
    choices: ['the weather', 'held'],
    get: () => (windHeld() ? 'held' : 'the weather'),
    set: (v) => {
      if (v === 'the weather') {
        releaseWind();
        return [];
      }
      if (!source) return ['nothing to hold: no world'];
      return holdWind({ speed: source.speed(), heading: source.heading(), gust: 1 });
    },
  };
}

function groups(): DialGroup[] {
  const out: DialGroup[] = [];
  out.push({
    title: 'Hold the wind',
    note: "One wind for every reader at once, the water, the trees and grass, the rain's lean and the sky's clouds, whether the Volumetrics master is on or off. −1 is the weather's own. A held wind is this browser's alone.",
    dials: [
      holdChoice(),
      holdDial('speed', 'Speed', 25, 0.5, 'm/s', 'The wind held at this speed. Nought stands the sky\'s clouds still.'),
      holdDial('heading', 'Heading', 359, 1, '°', 'The way the wind blows toward, degrees: 0 is +Z, turning toward +X.'),
      holdDial('gust', 'Gusts', 3, 0.05, '', '0 a steady wind, 1 as the weather says, 2 twice as gusty.'),
    ],
  });
  for (const kind of WIND_KINDS) {
    out.push({
      title: `Wind by weather: ${KIND_WORDS[kind]}`,
      note: 'Laid over the game\'s own wind for that weather (its Wind Speed Scale), blended as the sky blends its rows. How often gusts come and how long they last follow from the ground under a gust, its size, its stretch and the wind\'s speed: the read-out beside them is worked out where you stand over the next hour, as the wind is drawn (a forced weather level and a held wind included), some 6 ms a kind when the dials open or one of that kind\'s dials moves, never on a frame.',
      dials: [
        profileDial(kind, 'floor', 'Calm floor', 0, 10, 0.1, 'm/s', 'The wind never falls under this, so a calm day is never dead still.'),
        profileDial(kind, 'scale', 'Game\'s strength times', 0, 3, 0.05, '×', 'The game\'s own wind for this weather times this (1 is the game\'s).'),
        profileDial(kind, 'gust', 'Gusts', 0, 3, 0.05, '', 'How much stronger a gust is than the mean: its peak is one and this times the mean.'),
        profileDial(kind, 'cover', 'Ground under a gust', 0, 0.8, 0.01, '', 'The share of the ground a gust covers at any moment: more, and gusts come more often.', true),
        profileDial(kind, 'size', 'Gust size', 5, 200, 1, 'm', 'How big a gust patch is across the wind.', true),
        profileDial(kind, 'stretch', 'Gust stretch', 0.5, 5, 0.1, '×', 'How much longer a gust is along the wind than across it.'),
        profileDial(kind, 'veer', 'A gust turns the wind', 0, 1, 0.01, 'rad', 'The most a gust turns the wind\'s heading where it passes.'),
        profileDial(kind, 'wander', 'Heading wanders', 0, 1.5, 0.01, 'rad', 'How far the wind\'s heading swings either side of its slow walk, every few minutes.'),
        profileDial(kind, 'devils', 'Dust devils', 0, 200, 1, '/km²/h', 'Devils born a square kilometre an hour, by day, where the ground gives dust.'),
        profileDial(kind, 'trees', 'Trees take a gust', 0, 1, 0.01, '', 'How much harder a tree sways as a gust passes it (with Trees in the gusts on).'),
      ],
    });
  }
  const here = windWorldId();
  if (here) {
    const id = here.planetId;
    const lv = Math.max(0, Math.min(4, Math.round(source?.level() ?? 0)));
    out.push({
      title: `Wind by world: ${id}`,
      note: 'This world\'s own multipliers on every kind of weather\'s numbers, and its level in force\'s. At 1 nothing moves.',
      dials: WORLD_KEYS.map((k) => worldDial(id, null, k, WORLD_WORDS[k])),
    });
    out.push({
      title: `Wind by world: ${id} at weather level ${lv}`,
      note: `And at the weather level in force now (${lv}).`,
      dials: WORLD_KEYS.map((k) => worldDial(id, lv, k, WORLD_WORDS[k])),
    });
  }
  out.push({
    title: 'Wind aloft',
    note: "The sky's clouds drift at the ground's wind times these (the lower sheet at 1,500 m, the upper at 2,300 m turned a little), with the unified wind on or a speed held; with neither they drift as they always did.",
    dials: [
      tuneDial('aloft', 'bottom', 'Lower clouds\' wind', 0, 8, 0.1, '×', 'The lower sheet drifts at the wind times this.'),
      tuneDial('aloft', 'top', 'Upper clouds\' wind', 0, 8, 0.1, '×', 'The upper sheet drifts at the wind times this.'),
      tuneDial('aloft', 'veerTop', 'Upper clouds turn', -90, 90, 1, '°', 'How far the upper sheet\'s wind turns from the ground\'s, so the sky shears.'),
      tuneDial('aloft', 'floor', 'Clouds never slower than', 0, 20, 0.5, 'm/s', 'With the unified wind on the clouds never drift slower than this (never under a hold).'),
      // The low deck's share (`aloft.low`) is the next wave's, read by nothing yet, so it has no slider until its deck draws.
    ],
  });
  out.push({
    title: 'Gusts and devils',
    note: 'The gusts\' and the devils\' own numbers; how often devils come is each kind of weather\'s.',
    dials: [
      tuneDial('heading', 'wanderPeriod', 'Heading walks over', 60, 7200, 10, 's', 'The wind\'s slow walk turns a knot every this many seconds (today\'s 1,200).'),
      tuneDial('heading', 'wobblePeriod', 'Heading swings over', 10, 1800, 5, 's', 'How often the weather\'s own swing of the heading turns.'),
      tuneDial('pulse', 'share', 'Whole-world pulse', 0, 1, 0.01, '', 'How far the whole wind rises and falls over half a minute (0.4 is today\'s 0.8 to 1.2).'),
      tuneDial('pulse', 'period', 'Pulse over', 5, 240, 1, 's', 'The whole-world pulse\'s period.'),
      tuneDial('gusts', 'cycle', 'A gust pattern lives', 20, 600, 5, 's', 'How long one pattern of gusts lives before the next fades in over it.'),
      tuneDial('gusts', 'travelFloor', 'Gusts travel at least', 0, 10, 0.1, 'm/s', 'The gusts never travel slower than this.'),
      tuneDial('shed', 'rate', 'A gust lifts dust', 0, 1, 0.01, '/s', 'How much dust a gust patch lifts off loose ground a second (a long gust settles to three times this).'),
      tuneDial('shed', 'at', 'Gust dust starts at', 0, 3, 0.05, 'm', 'How high over the ground the dust a gust lifts starts.'),
      tuneDial('shed', 'sigma', 'Gust dust spread', 0.05, 3, 0.05, 'm', 'How tall that dust is as it starts.'),
      tuneDial('shed', 'rise', 'Gust dust rises at', 0, 5, 0.05, 'm/s', 'How fast it rises as it starts.'),
      tuneDial('devils', 'lifeMin', 'A devil lives at least', 5, 300, 1, 's', ''),
      tuneDial('devils', 'lifeMax', 'And at most', 5, 600, 1, 's', ''),
      tuneDial('devils', 'coreMin', 'Devil core from', 0.5, 20, 0.1, 'm', 'Its core\'s radius, the least.'),
      tuneDial('devils', 'coreMax', 'To', 0.5, 30, 0.1, 'm', 'And the most.'),
      tuneDial('devils', 'swirlMin', 'Devil swirl from', 0, 40, 0.5, 'm/s', 'How fast it whirls at its core, the least.'),
      tuneDial('devils', 'swirlMax', 'To', 0, 60, 0.5, 'm/s', 'And the most.'),
      tuneDial('devils', 'inflow', 'Devil draws air in', 0, 1, 0.01, '', 'How much air it draws in toward its core, a share of its swirl.'),
      tuneDial('devils', 'spin', 'Devil drives its air', 0, 3, 0.05, '×', 'How hard a devil turns the air round its core: at 1 about its own swirl.'),
      tuneDial('devils', 'h0', 'Devil dust at', 0, 20, 0.1, 'm', 'The lowest of the four heights its column of dust is laid at.'),
      tuneDial('devils', 'h1', 'And at', 0, 30, 0.1, 'm', ''),
      tuneDial('devils', 'h2', 'And at', 0, 30, 0.1, 'm', ''),
      tuneDial('devils', 'h3', 'And at', 0, 40, 0.1, 'm', ''),
      tuneDial('devils', 'sigma', 'Devil dust spread', 0.2, 6, 0.1, 'm', 'How tall each of the column\'s four layers is.'),
      tuneDial('devils', 'dust', 'Devil lifts dust', 0, 5, 0.05, '/s', 'How much dust its core lifts a second where the ground gives it.'),
    ],
  });
  out.push({
    title: "The grass's sheen and lean",
    note: 'A stalk bent by the wind shows its paler side, so a gust runs across a meadow as a lighter wave (the demo\'s wheat), near you and on the far hills; outside the moving air the grass leans by the wind itself.',
    dials: [
      tuneDial('grass', 'sheen', 'Sheen of a bent stalk', 0, 1.5, 0.01, '', 'How far a bent stalk\'s colour is lifted toward its paler tone (nought, none).'),
      tuneDial('grass', 'sheenGrey', 'Paler tone: toward grey', 0, 1, 0.01, '', 'The paler tone is the tuft\'s own colour this far toward its grey…'),
      tuneDial('grass', 'sheenLift', 'and lifted by', 0.5, 2.5, 0.01, '×', '…and lifted by this.'),
      tuneDial('grass', 'farLean', 'Far cards lean', 0, 1, 0.01, '', "A far card's share of the grass's lean outside the moving air (a far card can stand for a whole tree)."),
    ],
  });
  return out;
}

/** The wind's dials, made afresh each time the helper is picked (the world's rows follow the world you stand on). */
export function windDialSet(): DialSet {
  readouts.clear();
  const g = groups();
  return { helper: 'wind', groups: g, shipped: shippedOf(g) };
}

/** The tables as the game shipped them, copied as this module loads (with the game, before any console line moves them). */
const SHIPPED_TUNE = JSON.parse(JSON.stringify(WIND_TUNE)) as Record<string, Record<string, number>>;
const SHIPPED_PROFILES = JSON.parse(JSON.stringify(WIND_PROFILES)) as Record<string, Record<string, number>>;
const SHIPPED_WORLDS = JSON.parse(JSON.stringify(windWorldsNow())) as Record<string, Record<string, unknown>>;

function windWorldsNow(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of ['tatooine', 'naboo', 'corellia', 'dantooine', 'lok', 'endor', 'dathomir', 'yavin4', 'talus', 'rori', 'mustafar', 'kashyyyk']) out[id] = windWorldOf(id);
  return out;
}

/** A dial's shipped value by its key: the copies above, a world not named at its ones, the hold's −1 (the weather's own). */
function shippedValue(key: string, now: number | string): number | string {
  if (key === 'hold') return 'the weather';
  if (key === 'speed' || key === 'heading' || key === 'gust') return -1;
  const p = key.split('.');
  if (p[0] !== 'tune') return now;
  if (p[1] === 'profiles') return SHIPPED_PROFILES[p[2]]?.[p[3]] ?? now;
  if (p[1] === 'worlds') {
    const w = SHIPPED_WORLDS[p[2]] as Record<string, unknown> | undefined;
    if (p[3] === 'byLevel') return ((w?.byLevel as Record<string, Record<string, number>> | undefined)?.[p[4]]?.[p[5]] as number | undefined) ?? 1;
    return (w?.[p[3]] as number | undefined) ?? 1;
  }
  return SHIPPED_TUNE[p[1]]?.[p[2]] ?? now;
}

function shippedOf(g: DialGroup[]): Map<string, number | string> {
  const out = readDials(g);
  for (const [k, v] of out) out.set(k, shippedValue(k, v));
  return out;
}

/** The debug menu's dials for `wind`, or null for another helper. */
export function windDialsFor(helper: string): DialSet | null {
  return helper === 'wind' ? windDialSet() : null;
}
