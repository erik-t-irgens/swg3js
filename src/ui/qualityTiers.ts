// The quality slider's tiers (the GPU port's pass 1, wave 6; the design's section 9): one slider on the Graphics page's Picture
// and effects sub-tab that sets the costliest settings together, Low, Medium, High or Ultra, and reads Custom the moment any of
// them is moved on its own. Nothing is stored for the slider itself: which tier the settings hold is worked out from them each
// time it is asked (`tierOf`), as the volumetrics' preset is. Every row below is an existing setting, written through the page's
// own setter and applied as its own row applies it, behind the Effects switch's notice (`App.applyQualityTier`).
//
// **The table is the owner's to change** (the design's "starting values, yours to change"): one row a setting, one column a tier,
// each row with its reason. Each tier is held when the four views (Mos Eisley's street, Bestine's square, Kachirho, a Naboo forest)
// stay under both budgets (`TIER_BUDGET`) at p95: the owner's answer to the design's question 3. WebGPU's alone: the slider has no
// row on WebGL, where the game is the base commit's.
//
// Pure: no three and no page, so a node test reads the very table the menu and the game read.

import type { Settings } from '../core/settings.ts';
import type { Knob } from './hudPage.ts';

/** The tiers, cheapest first, as the slider stands them left to right. */
export const TIER_NAMES = ['low', 'medium', 'high', 'ultra'] as const;
export type TierName = (typeof TIER_NAMES)[number];

/** The words the slider says for each tier, and for settings that are none of them. */
export const TIER_LABELS: Readonly<Record<TierName | 'custom', string>> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', custom: 'Custom' };

/** The tier a new player starts on: High (the owner's answer to the design's question 3). */
export const START_TIER: TierName = 'high';

/**
 * What every tier must hold, on the main thread and on the card alike: 60 frames a second at the 95th percentile (the owner's
 * answer to question 3), so a frame of 16.7 ms on each.
 */
export const TIER_BUDGET = { fps: 60, percentile: 95, mainMs: 1000 / 60, cardMs: 1000 / 60 } as const;

/** The settings the tiers set, in the table's order. */
export const TIER_KEYS = ['renderScale', 'smoothing', 'smoothingShare', 'shadowMapSize', 'shadowDistance', 'ssao', 'mobileCap', 'grassReach', 'floraTreeReach'] as const;
export type TierKey = (typeof TIER_KEYS)[number];

/** One row: a value for each tier, Low to Ultra; `null` where a tier leaves the setting as it stands. */
type Row<T> = readonly [T | null, T | null, T | null, T | null];

/**
 * The table, a setting a row, Low, Medium, High and Ultra across (the design's starting values; the owner's to change).
 */
export const TIER_TABLE: { readonly [K in TierKey]: Row<Settings[K]> } = {
  // The resolution over the screen's, the biggest lever there is: never above the screen's own (`renderScaleFor`), so on a screen
  // of one pixel a point every tier draws at 1 and the tiers differ by the rest; 2 is the M2 Max's today.
  renderScale: [1, 1, 1.5, 2],
  // The edge smoothing (WebGPU's, `src/core/gpu/taa/`): Upscaled (2) for the two cheaper tiers, drawing the scene at a share of the
  // screen and filling it out over frames; Full (1) for the two dearer, drawing at the screen's own size.
  smoothing: [2, 2, 1, 1],
  // Upscaled's share of the screen's width and height: 0.6 for Low (36% of the pixels drawn), 0.7 for Medium (the design's "about
  // 70%", 49%). Full draws at the screen's size, so the two dearer tiers leave the share as it stands.
  smoothingShare: [0.6, 0.7, null, null],
  // Each sun cascade's map edge: 1024 is cheap, 4096 crisp at four times 2048's memory.
  shadowMapSize: [1024, 2048, 2048, 4096],
  // How far the sun's shadows reach, metres: 320 is the game's default and High's.
  shadowDistance: [120, 200, 320, 400],
  // The ambient occlusion, off for Low alone: its pass is the chain's dearest at full resolution.
  ssao: [false, true, true, true],
  // How many creatures and NPCs the spawner may have out at once (the people cap): 40 is the game's default and High's.
  mobileCap: [24, 32, 40, 60],
  // The grass's reach over the world's own (0.6x, 0.8x, 1x, 1.25x): the design's "grass and trees reach".
  grassReach: [0.6, 0.8, 1, 1.25],
  // The trees' reach, as the Tree distance row takes it, in metres, 0 as far as the ground goes (the default and High's): the trees
  // stand as far as the ground's detailed window, six chunks of 64 m a side of the chunk you stand on (about 416 m to its edge),
  // so the design's 0.6x and 0.8x of that are the row's own 256 m and 320 m; past it the far tree cards stand in. No reach is
  // further than the ground, so Ultra's 1.25x is the ground's own as High's is (the grass's 1.25x is Ultra's own).
  floraTreeReach: [256, 320, 0, 0],
};

/** The screen's own device pixels a CSS pixel, as the render scale's default reads it (1 in node). */
export function screenScale(): number {
  const dpr = typeof window !== 'undefined' ? Number(window.devicePixelRatio) : 1;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** A tier's render scale on a screen of `dpr` device pixels a CSS pixel: the tier's, never above the screen's own. */
export function renderScaleFor(tier: TierName, dpr: number): number {
  const want = TIER_TABLE.renderScale[TIER_NAMES.indexOf(tier)] as number;
  return Math.min(want, dpr > 0 ? dpr : 1);
}

/** Every setting a tier sets, on this screen: the render scale held to the screen's own; a setting the tier leaves out is absent. */
export function tierValues(tier: TierName, dpr: number): Partial<Pick<Settings, TierKey>> {
  const at = TIER_NAMES.indexOf(tier);
  const out: Record<string, unknown> = {};
  for (const k of TIER_KEYS) {
    const v = TIER_TABLE[k][at];
    if (v === null) continue;
    out[k] = k === 'renderScale' ? renderScaleFor(tier, dpr) : v;
  }
  return out as Partial<Pick<Settings, TierKey>>;
}

/** Two of a setting's values alike: numbers to a millionth (the render scale is the screen's, worked), anything else exactly. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return a === b;
}

/** How many of a tier's settings the settings hold as it sets them, and how many it sets. */
function matches(s: Pick<Settings, TierKey>, tier: TierName, dpr: number): { held: number; of: number } {
  const want = tierValues(tier, dpr) as Record<string, unknown>;
  let held = 0;
  let of = 0;
  for (const k of TIER_KEYS) {
    if (!(k in want)) continue;
    of++;
    if (same(s[k], want[k])) held++;
  }
  return { held, of };
}

/** The tier the settings hold on this screen, or 'custom' where they are none of them. */
export function tierOf(s: Pick<Settings, TierKey>, dpr: number): TierName | 'custom' {
  for (const t of TIER_NAMES) {
    const m = matches(s, t, dpr);
    if (m.held === m.of) return t;
  }
  return 'custom';
}

/** The tier the slider's thumb stands at: the one the settings hold, or under Custom the one they hold most of (the cheaper on a tie). */
export function tierNearest(s: Pick<Settings, TierKey>, dpr: number): TierName {
  let best: TierName = START_TIER;
  let most = -1;
  for (const t of TIER_NAMES) {
    const m = matches(s, t, dpr);
    if (m.held > most) {
      most = m.held;
      best = t;
    }
  }
  return best;
}

/**
 * Whether this browser holds no player yet: no settings saved and no character made (wave 6's fixer). Saved settings hold only
 * what differs from the defaults, so a player who left the render scale at its default reads like a new one by the settings
 * alone (and one who moved everything back to its default has no settings saved at all); a character tells them apart.
 */
export function isNewPlayer(settingsSaved: boolean, characters: number): boolean {
  return !settingsSaved && characters === 0;
}

/**
 * A new player starts on High (the owner's answer to question 3; the brief's "new players start on High"): at load, on WebGPU,
 * where `fresh` (`isNewPlayer`), every setting of the start tier that stands at the game's default (`defaults`) takes the start
 * tier's value for this screen, and where that moved anything the settings are saved (`save`), so the tier outlasts the first
 * character made, after which the player is no longer new. A player who is not new keeps every setting as it was read (wave 6's
 * review: a player at two device pixels a point with the render scale at its default was dropped to 1.5 unasked). Only the render
 * scale differs today, and only on a screen of more than 1.5 device pixels a point, whose default is the screen's own up to 2 and
 * High's 1.5. Answers the settings it was handed.
 */
export function startOnTier<S extends Pick<Settings, TierKey>>(s: S, defaults: Pick<Settings, TierKey>, dpr: number, fresh: boolean, save: ((s: S) => void) | null): S {
  if (!fresh) return s;
  const want = tierValues(START_TIER, dpr) as Record<string, unknown>;
  let moved = false;
  for (const k of TIER_KEYS) {
    if (!(k in want) || !same(s[k], defaults[k]) || same(s[k], want[k])) continue;
    (s as unknown as Record<string, unknown>)[k] = want[k];
    moved = true;
  }
  if (moved && save !== null) save(s);
  return s;
}

/**
 * The slider's row on Picture and effects (`menu.ts` draws a preset with `slider` as a slider of its sets): its key is the edge
 * smoothing's, WebGPU's own row, so the game leaves it off the page on WebGL as it leaves that row (`App.volKnobState`'s hide);
 * the sets' values are this screen's, read when they are asked.
 */
export const QUALITY_KNOB: Knob = {
  key: 'smoothing',
  label: 'Quality',
  hint: 'Sets the dearest settings together: the render scale (never above your screen\'s own), the smoothing, the shadow resolution and distance, the ambient occlusion, how many creatures and people are out, and how far grass and trees are drawn. Low for a weaker machine, Ultra for a strong one; a new player starts on High. Move any of those settings on its own and this reads Custom. A change is prepared behind a short notice before it is drawn.',
  kind: 'preset',
  slider: true,
  presets: TIER_NAMES.map((name) => ({
    name,
    label: TIER_LABELS[name],
    get values() {
      return tierValues(name, screenScale());
    },
  })),
  presetOf: (s: Settings) => tierOf(s, screenScale()),
  otherLabel: TIER_LABELS.custom,
};
