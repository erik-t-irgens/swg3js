// The holidays' dressing: what the buildout areas a holiday names stand in the world while it is on
// (`tools/swg/stateObjects.mjs` reads them in, tagged `<holiday>=on`), each behind a switch of its own beside Life
// Day's in the Weather section (the owner, 2026-10-31: "Halloween as a switch like the snow for life day and keep that
// in the same settings area").
//
// Each holiday is a world state this browser decides alone (`ruleWorldState`, `worldState.ts`): on or off by its switch
// (in season, always, never) and the date, taken at an arrival exactly as Life Day's snow on the ground is, whether the
// weather is on or not, and never a server's word (the owner's brief takes a setting, as Life Day's is). Life Day's own
// rows follow the Life Day switch and its season (`Weather.lifeDayToday`, which the game hands in); the others have
// seasons of ours, said in the menu's hints and here.
//
// Pure of three and of the page: every import with its `.ts` extension, no enum, no namespace, no constructor parameter
// properties (node runs it with type stripping for the tests).

import { ruleWorldState } from './worldState.ts';

/** A month and a day of it, 1-based both. */
export type MonthDay = readonly [number, number];

/** A season: from its first day to its last, both included, across the new year where `to` comes before `from`. */
export interface Season {
  from: MonthDay;
  to: MonthDay;
}

/** The settings key each holiday's switch is kept under (`Settings`), and the menu's words for it. */
export interface HolidayDef {
  /** The `Settings` key: -1 in season, 1 always, 0 never. */
  setting: 'halloween' | 'lifeDay' | 'loveday' | 'empireday';
  /** What the message line and the console call it. */
  name: string;
}

/**
 * The holidays a world's dressing can stand for, by the key its rows are tagged with: the converter's events name them
 * (`HOLIDAY_OF_EVENT` in tools/swg/stateObjects.mjs, held to these keys by the node test). Empire Day's is one event in
 * the tables for the Empire's ceremonies and the Rebels' Remembrance Day together.
 */
export const HOLIDAYS: Readonly<Record<string, HolidayDef>> = {
  halloween: { setting: 'halloween', name: 'The Galactic Moon Festival' },
  lifeday: { setting: 'lifeDay', name: 'Life Day' },
  loveday: { setting: 'loveday', name: 'Love Day' },
  empireday: { setting: 'empireday', name: 'Empire Day and Remembrance Day' },
};

/**
 * Each holiday's season of ours, "about" SOE's own events, whose dates the archives do not hold: the Galactic Moon
 * Festival in the last third of October into November, Love Day round the middle of February, Empire Day and Remembrance
 * Day in the first three weeks of May. Life Day's is the weather's own (`LIFE_DAY_FROM`, `LIFE_DAY_TO`). Live through
 * `__debug.holidays({ seasons })`; not numbers of feel.
 */
export const HOLIDAY_SEASONS: Record<string, Season> = {
  halloween: { from: [10, 20], to: [11, 4] },
  loveday: { from: [2, 7], to: [2, 21] },
  empireday: { from: [5, 1], to: [5, 21] },
};

/** Whether a month and day fall in a season, its ends included, across the new year where it wraps. */
export function inSeason(season: Season, month: number, day: number): boolean {
  const v = month * 100 + day;
  const from = season.from[0] * 100 + season.from[1];
  const to = season.to[0] * 100 + season.to[1];
  return from <= to ? v >= from && v <= to : v >= from || v <= to;
}

/** Whether a holiday is on: its setting 1 always, 0 never, -1 by its season (none: never). */
export function holidayOn(setting: number, season: Season | null | undefined, month: number, day: number): boolean {
  if (setting === 1) return true;
  if (setting === 0) return false;
  return !!season && inSeason(season, month, day);
}

/** The words a holiday setting's value is said in. */
export function settingWords(setting: number): string {
  return setting === 1 ? 'always' : setting === 0 ? 'never' : 'in season';
}

/** What the message line says when a holiday's switch moves: its rows stand, or go, at the next arrival. */
export function holidayNews(key: string, on: boolean): string {
  const name = HOLIDAYS[key]?.name ?? key;
  return `${name}'s dressing ${on ? 'stands' : 'is taken down'} from your next arrival on a world that has it`;
}

/**
 * Every holiday made a ruled world state: on (`'on'`) when `isOn(key)` says so at the moment an arrival asks. The game
 * hands the rule in (its settings and today's date, and Life Day's own `Weather.lifeDayToday`).
 */
export function installHolidays(isOn: (key: string) => boolean): void {
  for (const key of Object.keys(HOLIDAYS)) ruleWorldState(key, { values: ['off', 'on'], default: 'off', now: () => (isOn(key) ? 'on' : 'off') });
}

/** Set a season, held to real months and days; answers the season in force. */
export function tuneSeason(key: string, season: unknown): Season | null {
  if (!Object.prototype.hasOwnProperty.call(HOLIDAY_SEASONS, key)) return null;
  const s = season as { from?: unknown; to?: unknown } | null;
  const md = (v: unknown): MonthDay | null => {
    if (!Array.isArray(v) || v.length !== 2) return null;
    const m = Math.round(Number(v[0]));
    const d = Math.round(Number(v[1]));
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? [m, d] : null;
  };
  const from = md(s?.from);
  const to = md(s?.to);
  if (from) HOLIDAY_SEASONS[key] = { ...HOLIDAY_SEASONS[key], from };
  if (to) HOLIDAY_SEASONS[key] = { ...HOLIDAY_SEASONS[key], to };
  return HOLIDAY_SEASONS[key];
}
