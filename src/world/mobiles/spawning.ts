// The small decisions around standing a catalogue entry in the world, kept apart so the node tests
// can run them: the box a person without a model of their own is planned from, how far ahead a
// thing of a size is put, which entries a group's "one of each" stands, the planet's own values as
// a mobile's overrides, and the one permanent gap in the game's archives, said as a sentence.
//
// Pure: no three, no fetch. Rule for this file (it is run by node with type stripping for the
// tests): relative imports only as `import type`, no enum, no namespace, no constructor parameter
// properties.
import type { MobileAggression, MobileAppearance, MobileEntry, Vec3 } from './types';

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** A person in the bind pose, arms out: what a dressed entry is planned from when nothing better is known. */
export const HUMANOID_BOUNDS: Bounds = { min: [-0.55, 0, -0.15], max: [0.55, 1.8, 0.15] };

/** How tall each player species stands at scale 1 (metres), where it differs from a human's 1.8. */
export const SPECIES_HEIGHT: Record<string, number> = {
  wookiee: 2.2,
  ithorian: 2.0,
  trandoshan: 1.95,
  moncal: 1.8,
  rodian: 1.72,
  bothan: 1.55,
  sullustan: 1.5,
};

/** The species part of a species id: `wookiee_male` is `wookiee`. */
export function speciesOf(id: string | null | undefined): string {
  return (id ?? '').toLowerCase().replace(/_(male|female)$/, '');
}

const packBoundsCache = new WeakMap<object, Map<string, Bounds | null>>();

/**
 * The bind-pose box a mobile's body is planned from. An entry on its own model takes its
 * appearance's. A dressed entry (a player species in clothes, no appearance of its own) takes the
 * median-height box of the parts models that play the same animation pack, which are the same
 * skeleton; failing any, a person's box at its species' height.
 */
export function lookBounds(entry: Pick<MobileEntry, 'appearance' | 'pack' | 'species'>, appearances: Record<string, MobileAppearance>): Bounds {
  const own = entry.appearance ? appearances[entry.appearance] : undefined;
  if (own?.bounds) return own.bounds;
  let byPack = packBoundsCache.get(appearances);
  if (!byPack) {
    byPack = new Map();
    packBoundsCache.set(appearances, byPack);
  }
  const key = entry.pack ?? '';
  let found = byPack.get(key);
  if (found === undefined) {
    const heights = Object.values(appearances)
      .filter((a) => a.form === 'parts' && a.pack === entry.pack && a.bounds)
      .map((a) => ({ a, h: Math.abs(a.bounds.max[1] - a.bounds.min[1]) }))
      .filter((x) => x.h > 0.8 && x.h < 3.5)
      .sort((p, q) => p.h - q.h);
    found = heights.length ? heights[Math.floor(heights.length / 2)].a.bounds : null;
    byPack.set(key, found);
  }
  if (found && !SPECIES_HEIGHT[speciesOf(entry.species)]) return found;
  const h = SPECIES_HEIGHT[speciesOf(entry.species)] ?? HUMANOID_BOUNDS.max[1];
  const k = h / HUMANOID_BOUNDS.max[1];
  return { min: [HUMANOID_BOUNDS.min[0] * k, 0, HUMANOID_BOUNDS.min[2] * k], max: [HUMANOID_BOUNDS.max[0] * k, h, HUMANOID_BOUNDS.max[2] * k] };
}

/**
 * How far ahead of the player something of this box is put: a person or a womp rat eight metres
 * off, a bantha a dozen, a krayt dragon far enough that it does not stand on the player. The
 * horizontal extents are taken componentwise (old packs carry their box corners swapped).
 */
export function spawnDistance(bounds: Bounds, scale = 1): number {
  const w = Math.abs(bounds.max[0] - bounds.min[0]) * scale;
  const l = Math.abs(bounds.max[2] - bounds.min[2]) * scale;
  const reach = Math.max(w, l) / 2;
  return Math.min(45, Math.max(8, 2 * reach + 5));
}

/** The planet's own creature values as a mobile's overrides: its health and blow, and its aggression read as the old creatures read it. */
export function ambientOverrides(def: { hp: number; damage: number; aggressive: boolean; speed: number }): { hp: number; damage: number; aggression: MobileAggression } {
  return {
    hp: def.hp,
    damage: def.damage > 0 ? def.damage : 8,
    aggression: def.aggressive ? 'aggressive' : def.speed > 3 ? 'skittish' : 'defensive',
  };
}

/** A model the archives could not give, as the catalogue lists it. */
export interface FailedModel {
  what: string;
  id: string;
  why: string;
}

/**
 * When an entry's model is one the game's own archives cannot give (its appearance is stripped
 * at every detail level, so no converter run can ever make it), the sentence that says so; else
 * null. Not an error to report: a permanent gap to show quietly.
 */
export function permanentGap(entry: Pick<MobileEntry, 'appearance' | 'name' | 'id'>, failed: readonly FailedModel[] | undefined): string | null {
  if (!entry.appearance || !failed?.length) return null;
  const f = failed.find((x) => x.what === 'model' && x.id === entry.appearance);
  if (!f) return null;
  return `unavailable: the game's own archives hold no usable model for ${entry.name} (${f.id}: ${f.why}), so nothing can stand it`;
}

/**
 * The entries a group's "one of each" stands: the first `n` that can be stood, in the group's
 * order. `standable` says whether one can (ready, not a permanent gap).
 */
export function groupPicks<E>(entries: readonly E[], n: number, standable: (e: E) => boolean): E[] {
  const out: E[] = [];
  for (const e of entries) {
    if (out.length >= n) break;
    if (standable(e)) out.push(e);
  }
  return out;
}
