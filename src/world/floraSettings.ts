// The flora's settings (wave 8): the Graphics page's Flora section and the console's knobs over the same values,
// and the one rule between the two. Pure: no three and no DOM, so the node test runs exactly what the page and the
// console run (`floraSettings.test.ts`).
//
// **One value, which the page always shows.** A console knob that has a setting writes the setting in memory and
// applies it, and never saves it: only the page saves (`App.setSettingFromConsole`). Past the page's range it is
// applied live and the setting is left alone, so the next slider moved or a reload puts the page's value back. Three
// console fields stand *over* a setting rather than beside it -- a reach typed in metres for the grass, the far
// cards or the small plants, and a grass window typed outright -- and each says so (`floraOverrides`, and a line on
// the message line when the setting under it moves, `floraHeldNote`).
import type { CardLightTune } from './cardLightMath.ts';
import { FLORA_DEFAULTS, type FloraReachTune } from './floraReach.ts';
import type { FarCardTune, GrassShadowTune, GrassTune } from './grassMath.ts';
import type { ShadowCasterTune } from './shadowCasters.ts';

/** The settings this file speaks for, as `Settings` spells them. */
export interface FloraSettings {
  grass: boolean;
  grassReach: number;
  grassDensity: number;
  farCards: boolean;
  farCardReach: number;
  floraPlantReach: number;
  floraTreeReach: number;
  floraTreeShadows: boolean;
  floraPlantShadows: boolean;
  grassShadows: boolean;
  grassTakesShadows: boolean;
  farCardShadows: boolean;
  leafShadows: string;
}

/** Every flora setting's key, in the page's order. */
export const FLORA_KEYS: readonly (keyof FloraSettings)[] = ['grass', 'grassReach', 'grassDensity', 'farCards', 'farCardReach', 'floraPlantReach', 'floraTreeReach', 'floraTreeShadows', 'floraPlantShadows', 'grassShadows', 'grassTakesShadows', 'farCardShadows', 'leafShadows'];

/**
 * The ends the page's controls and the console both read, all ours. The far cards' scale starts at 1: their own end
 * is 500 to 1000 m, and below it a quarter or a half of that falls inside the detailed ground, where at the default
 * Tree distance no card is ever shown. The Tree distance's options are where its trees stop, nought for as far as
 * the ground goes (Infinity, which a setting cannot hold: the loader drops a value that is not finite).
 */
export const FLORA_RANGES = {
  grassReach: { min: 0.5, max: 3, step: 0.1 },
  grassDensity: { min: 0.25, max: 1, step: 0.05 },
  farCardReach: { min: 1, max: 2, step: 0.05 },
  floraPlantReach: { min: 1, max: 4, step: 0.25 },
  floraTreeReach: { options: [0, 128, 192, 256, 320] as readonly number[] },
  leafShadows: { choices: ['self', 'all', 'none'] as readonly string[] },
} as const;

/** The Graphics page's own two shadow ends, which `__debug.shadows` reads too (`menu.ts` holds the same numbers, `floraSettings.test` both). */
export const SHADOW_RANGES = {
  shadowDistance: { min: 80, max: 800, step: 20 },
  shadowCasterRadius: { min: 0.5, max: 8, step: 0.1 },
} as const;

/** What the settings come to in each tune's own fields. */
export interface FloraTunes {
  grass: Pick<GrassTune, 'on' | 'reachScale' | 'density'>;
  farCards: Pick<FarCardTune, 'on' | 'reachScale'>;
  grassShadow: Pick<GrassShadowTune, 'cast' | 'receive' | 'farReceive' | 'farCast'>;
  reach: Pick<FloraReachTune, 'plantReachFactor' | 'treeReach'>;
  casters: Pick<ShadowCasterTune, 'trees' | 'plants'>;
  leaves: CardLightTune['shadow'];
}

/** The settings into the tunes' fields: a Tree distance of nought is Infinity, and a leaf rule that is not one of the three is the owner's `self`. */
export function floraTunesFrom(s: FloraSettings): FloraTunes {
  const leaves = s.leafShadows === 'all' || s.leafShadows === 'none' ? s.leafShadows : 'self';
  return {
    grass: { on: s.grass, reachScale: s.grassReach, density: s.grassDensity },
    farCards: { on: s.farCards, reachScale: s.farCardReach },
    grassShadow: { cast: s.grassShadows, receive: s.grassTakesShadows, farReceive: s.grassTakesShadows, farCast: s.farCardShadows },
    reach: { plantReachFactor: s.floraPlantReach, treeReach: s.floraTreeReach > 0 ? s.floraTreeReach : Number.POSITIVE_INFINITY },
    casters: { trees: s.floraTreeShadows, plants: s.floraPlantShadows },
    leaves,
  };
}

/**
 * `flora({ reach: true })`: the reach put back, its fields with no setting to what shipped (`FLORA_DEFAULTS`, a
 * reach typed in metres let go of) and its two with one to the settings' own values, where before it put the shipped
 * numbers back behind the page's back.
 */
export function floraReachBack(tune: FloraReachTune, s: FloraSettings): FloraReachTune {
  Object.assign(tune, FLORA_DEFAULTS, floraTunesFrom(s).reach);
  return tune;
}

/** The console helpers whose fields have settings. */
export type FloraHelper = 'grass' | 'farCards' | 'flora' | 'floraShadows' | 'shadows';

/** One console field as a setting: the key, the value as the setting holds it, and whether the page's control can show it. */
export interface ConsoleSetting {
  key: keyof FloraSettings | 'shadowDistance' | 'shadowCasterRadius';
  value: number | boolean | string;
  inRange: boolean;
}

const BOOLEAN_FIELDS: Record<FloraHelper, Record<string, keyof FloraSettings>> = {
  grass: { on: 'grass' },
  farCards: { on: 'farCards' },
  flora: {},
  floraShadows: { trees: 'floraTreeShadows', plants: 'floraPlantShadows', grassCast: 'grassShadows', grassReceive: 'grassTakesShadows', farCast: 'farCardShadows' },
  shadows: {},
};

const NUMBER_FIELDS: Record<FloraHelper, Record<string, ConsoleSetting['key']>> = {
  grass: { reachScale: 'grassReach', density: 'grassDensity' },
  farCards: { reachScale: 'farCardReach' },
  flora: { plantReachFactor: 'floraPlantReach', treeReach: 'floraTreeReach' },
  floraShadows: {},
  shadows: { distance: 'shadowDistance', minRadius: 'shadowCasterRadius' },
};

const RANGE_OF: Record<string, { min: number; max: number }> = { ...FLORA_RANGES, ...SHADOW_RANGES } as unknown as Record<string, { min: number; max: number }>;

/**
 * A console call's fields that have a setting, as settings: a field that is not a usable value (a word where a
 * number goes, NaN, a choice not on the page) is dropped, and so is every field with no setting at all (the cut, the
 * mip scale, the cascades, the facing, the lift, the flora's own line), which moves its tune live as knobs always
 * have. Each value is marked by whether the page's control can hold it; one past it is applied live and the setting
 * left alone. Infinity, a Tree distance with no end, is the setting's nought.
 */
export function consoleToSettings(helper: FloraHelper, o: Record<string, unknown>): ConsoleSetting[] {
  const out: ConsoleSetting[] = [];
  for (const [field, key] of Object.entries(BOOLEAN_FIELDS[helper])) {
    const v = o[field];
    if (typeof v === 'boolean') out.push({ key, value: v, inRange: true });
  }
  for (const [field, key] of Object.entries(NUMBER_FIELDS[helper])) {
    const v = o[field];
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    if (key === 'floraTreeReach') {
      const m = v === Number.POSITIVE_INFINITY ? 0 : v;
      if (!(m >= 0) || !Number.isFinite(m)) continue;
      out.push({ key, value: m, inRange: FLORA_RANGES.floraTreeReach.options.includes(m) });
      continue;
    }
    if (!Number.isFinite(v) || v < 0) continue;
    const r = RANGE_OF[key];
    out.push({ key, value: v, inRange: !!r && v >= r.min && v <= r.max });
  }
  if (helper === 'floraShadows' && o.leaves !== undefined) {
    if (typeof o.leaves === 'string' && FLORA_RANGES.leafShadows.choices.includes(o.leaves)) out.push({ key: 'leafShadows', value: o.leaves, inRange: true });
  }
  return out;
}

/** The console's fields standing over a setting now, by the setting they stand over (each `null` when none stands). */
export interface FloraOverrides {
  grassReach: number | null;
  grassWindow: number | null;
  farCardReach: number | null;
  floraPlantReach: number | null;
}

/** What stands over the settings now, read off the tunes. */
export function floraOverrides(grass: Pick<GrassTune, 'reach' | 'windowHold'>, far: Pick<FarCardTune, 'reach'>, flora: Pick<FloraReachTune, 'fixedReach'>): FloraOverrides {
  return {
    grassReach: grass.reach,
    grassWindow: grass.windowHold,
    farCardReach: far.reach,
    floraPlantReach: flora.fixedReach > 0 ? flora.fixedReach : null,
  };
}

/** The line the message line says when a setting a console value stands over is moved, or null when none stands over it. */
export function floraHeldNote(key: string, o: FloraOverrides): string | null {
  if (key === 'grassReach') {
    if (o.grassReach !== null) return `Grass distance is held at ${o.grassReach} m from the console: __debug.grass({ reach: null }) hands it back`;
    if (o.grassWindow !== null) return `The grass's window is held at ${o.grassWindow} chunks from the console: __debug.grass({ window: null }) hands it back`;
  }
  if (key === 'farCardReach' && o.farCardReach !== null) return `Far tree card distance is held at ${o.farCardReach} m from the console: __debug.farCards({ reach: null }) hands it back`;
  if (key === 'floraPlantReach' && o.floraPlantReach !== null) return `Small plant distance is held at ${o.floraPlantReach} m from the console: __debug.flora({ reach: true }) hands it back`;
  return null;
}
