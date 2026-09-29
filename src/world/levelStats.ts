// A body's health and blow at a level of the console's choosing, worked out the way the catalogue works
// out everybody's: the emulator's own health pool and damage range, put through the one curve the
// catalogue puts them through (`CORE3_MAP` in `tools/swg/mobiles.mjs`), which is copied here by value
// because the runtime does not import the converter, and held against it by the node test.
//
// **There is no level-to-health table in the emulator.** Every mobile's pool and damage are written
// in its own script beside its level, so what "level 60" means is read off the catalogue itself: the
// bodies whose own emulator row sits nearest that level, the middle of their pools and their damage,
// and the curve over those. People are read from people and creatures from creatures, since the two
// run on different pools at the same level. A catalogue built with no emulator rows at all has nothing
// to read, and then a level is only a level: the body keeps its own numbers, and the answer says so.
//
// Pure: no three, no browser. The console's `__debug.mobile(..., { level })` is the only caller.

/** The catalogue's curve (`CORE3_MAP` less its gun range), by value. */
export const CORE3_CURVE = { hpBase: 30, hpScale: 8, hpMin: 20, hpMax: 6000, damageBase: 4, damageScale: 1.6, damageMin: 1, damageMax: 400 };

/** How many rows nearest the level are read. Ours. */
export const LEVEL_SAMPLES = 9;

/** One emulator row's level, pool and mean damage, out of a catalogue entry. */
export interface LevelSample {
  level: number;
  ham: number;
  damage: number;
  person: boolean;
}

/** What `levelSamples` reads of an entry: the catalogue's own shape, loosely, since its `core3` block carries more than the runtime's type names. */
export interface LevelEntryLike {
  kind?: string;
  stats?: { source?: string; core3?: unknown } | null;
}

/**
 * Every row of the catalogue that carries its emulator level, a health pool and a damage range, as a
 * sample. `person` is an NPC or a dressed body, which is what a person asking for a level is compared with.
 */
export function levelSamples(entries: readonly LevelEntryLike[]): LevelSample[] {
  const out: LevelSample[] = [];
  for (const e of entries) {
    const c = e.stats?.core3 as { level?: unknown; ham?: unknown; damage?: unknown } | null | undefined;
    if (!c || e.stats?.source !== 'core3') continue;
    const level = typeof c.level === 'number' && Number.isFinite(c.level) ? c.level : NaN;
    const ham = Array.isArray(c.ham) && typeof c.ham[0] === 'number' ? c.ham[0] : NaN;
    const dmg = Array.isArray(c.damage) && typeof c.damage[0] === 'number' && typeof c.damage[1] === 'number' ? (c.damage[0] + c.damage[1]) / 2 : NaN;
    if (!(level > 0) || !(ham > 0) || !(dmg >= 0)) continue;
    out.push({ level, ham, damage: dmg, person: e.kind === 'npc' || e.kind === 'dressed' });
  }
  return out;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const n = values.length;
  return n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
}

/** The catalogue's curve over one pool and one mean damage: the numbers a body of those is stood with. */
export function curveOf(ham: number, damage: number, curve = CORE3_CURVE): { hp: number; damage: number } {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return {
    hp: clamp(Math.round(curve.hpBase + curve.hpScale * Math.sqrt(Math.max(0, ham))), curve.hpMin, curve.hpMax),
    damage: clamp(Math.round(curve.damageBase + curve.damageScale * Math.sqrt(Math.max(0, damage))), curve.damageMin, curve.damageMax),
  };
}

/**
 * A body's health and blow at `level`: the middle pool and damage of the `k` rows nearest that level
 * among its own kind (people for a person, the rest for anything else, and all of them where its kind
 * has none), through the curve. Null when no row can say, which is a catalogue with no emulator rows.
 * `near` is the span of levels those rows cover, so an answer read from far-off levels says so.
 */
export function statsAtLevel(level: number, samples: readonly LevelSample[], person: boolean, k = LEVEL_SAMPLES, curve = CORE3_CURVE): { hp: number; damage: number; rows: number; near: [number, number] } | null {
  if (!(level > 0) || !samples.length) return null;
  let pool = samples.filter((s) => s.person === person);
  if (!pool.length) pool = samples.slice();
  const nearest = pool.map((s) => ({ s, d: Math.abs(s.level - level) })).sort((a, b) => a.d - b.d || a.s.level - b.s.level).slice(0, Math.max(1, Math.round(k)));
  const ham = median(nearest.map((n) => n.s.ham));
  const damage = median(nearest.map((n) => n.s.damage));
  const levels = nearest.map((n) => n.s.level);
  return { ...curveOf(ham, damage, curve), rows: nearest.length, near: [Math.min(...levels), Math.max(...levels)] };
}
