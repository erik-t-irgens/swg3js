// What lava does to whatever stands in it: how much of a life one blow takes, how often, and where
// the line between "over a flow" and "in it" falls. Pure, and it imports nothing, so a node test
// runs exactly what the game runs.
//
// Two kinds of number pass through here and they are marked apart wherever they appear.
//
// **The client's** are its terrain water values -- per water type, whether it hurts what stands in
// it, whether it can kill, how many seconds between one blow and the next, and how much it takes
// each time. **Not one of them is written in this file, or anywhere else in this repository.** They
// live in the archives, the water command reads them into a planet's `water.json`, and `LAVA_HARM`
// is seeded from that block as the planet loads. A pack that has not been converted since the
// command learned to read them carries no block, and then nothing burns and the world says which
// command mends it -- which is also what keeps a planet already on disk behaving exactly as it does
// today. Whoever has the archives gets the burn; the repository never carries a row of their tables.
//
// **Ours** are the margins, the two hysteresis numbers and the switch. The archives say what happens
// to something standing in a flow; they do not say where a thing has to be standing for it to count,
// because the client's server knew that from its own collision and never wrote it down. So how far
// under a surface counts as being in it, how far over one a hovering ride still counts as being over
// it, and how much of a band and how long a gap it takes to stop counting, are all invented here and
// all tunable.
//
// Nothing in this file knows about a planet, a vehicle or a player: `World.lavaAt` turns a point
// into a depth and the tick in `World.stepLiving` turns a depth into a blow.

/** One row of the client's water values: what a terrain water type does to what stands in it. */
export interface LavaHarmRow {
  /** The terrain's own water type the row is for. The tables' rows are in water-type order, so 0 is water and 1 is lava. */
  type: number;
  /** The client's: this water hurts whatever stands in it. */
  damage: boolean;
  /** The client's: and it can kill. This is why the share below is read against a whole life rather than what is left of one. */
  kills: boolean;
  /** The client's: seconds between one blow and the next. */
  interval: number;
  /** The client's: how much of a whole life one blow takes, 0 to 1. */
  share: number;
}

/**
 * Where the numbers being applied came from: a converted pack's own block, or nobody at all. There
 * is deliberately no third answer. A set of stand-in numbers would have to be the client's own to be
 * right, and the client's own numbers may not be written down here, so a planet whose pack has not
 * been converted since the water command learned to read them simply does not burn.
 */
export type LavaHarmSource = 'pack' | 'none';

/**
 * What the game actually applies, live. Seeded from the pack's own `harm` block as each planet
 * loads (`World` calls `applyLavaHarm`), and writable from the console afterwards through
 * `__debug.lava`, which is the whole point of keeping it here rather than reading the pack at the
 * moment of the blow: the owner must be able to soften a burn, or switch it off, without running
 * the converter again.
 *
 * The values standing in it below are the **nothing-has-said** state, and are what every planet has
 * until a pack says otherwise: no share, so no blow, and `source` 'none'.
 */
export const LAVA_HARM = {
  /** Ours: the switch. Off, a flow burns nothing at all and the game is exactly what it was. */
  on: true,
  /**
   * How much of a whole life one blow takes, 0 to 1. **The client's** once a pack has said; 0 until
   * one does, which is what makes an unconverted pack behave exactly as it does today.
   */
  share: 0,
  /**
   * Seconds between blows. **The client's** once a pack has said. The 1 below is ours and is a plain
   * tick period for a clock that has nothing to count yet: while `share` is 0 nothing reads it, and
   * the first pack to say anything overwrites it.
   */
  interval: 1,
  /**
   * This water can kill, which is what makes the share a share of the maximum rather than of what is
   * left. **The client's** once a pack has said; false until one does.
   */
  kills: false,
  /**
   * Ours. Metres a point must stand under the surface before it counts as being in the flow. A flow
   * is a flat polygon and the ground beneath it is generated separately, so at the very edge the two
   * all but coincide and an exact compare flips back and forth as a walker shifts their weight.
   */
  margin: 0.15,
  /**
   * Ours. The band a body or a ride already counted as burning must climb back out through before it
   * stops counting: the verdict goes true at the line and false only `hold` metres the other side of
   * it. Without it a body resting exactly at the line flips every step -- which costs a message-line
   * write a frame and, worse, burns at half rate or not at all, since the clock only runs on the
   * steps that came out true. It is the same trick and the same distance the swim line already uses.
   */
  hold: 0.3,
  /**
   * Ours. Metres a ride's **belly** may stand over a flow and still be burnt by it. A hover machine
   * rides a flow exactly as it rides a lake -- nothing filters lava out of its springs -- so it
   * never gets under the surface at all, and without a reach of some kind nothing a player drives
   * could ever be hurt. Measured from the belly and not from the origin, so the answer does not
   * depend on how tall the hull is; `World.stepHazards` is where the belly is worked out.
   */
  rideReach: 3,
  /**
   * Ours. Seconds a verdict that has gone false is held before it is believed. The band above cannot
   * help where the depth does not merely wobble but vanishes: a hull drifting over the edge of a flow
   * polygon reads a real depth one step and "no flow here at all" the next, and nothing about a
   * distance can bridge that. So the line already said stands, and the clock keeps its place, through
   * a gap this short. A blow still only lands on a step that is really in the flow.
   */
  linger: 0.5,
  /** Where `share`, `interval` and `kills` above came from: the pack's own block, or nothing at all. */
  source: 'none' as LavaHarmSource,
  /** What the pack said about itself, when it said anything ('client' from the water command); null otherwise. */
  packSource: null as string | null,
};

/** The keys `__debug.lava` may write. `source` and `packSource` are reports, not knobs. */
export type LavaHarmTune = Partial<Pick<typeof LAVA_HARM, 'on' | 'share' | 'interval' | 'kills' | 'margin' | 'hold' | 'rideReach' | 'linger'>>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * A share as the pack may have written it. The client's own column is a **percentage**, so a value
 * over 1 is read as one: that is not a guess about the converter's shape but a guard against the
 * one mistake that would otherwise take a whole life a blow and look like a bug in the game.
 */
function shareOf(row: Record<string, unknown>): number {
  const pct = num(row.percent);
  let s = num(row.share) ?? (pct !== undefined ? pct / 100 : undefined) ?? 0;
  if (s > 1) s /= 100;
  return s > 1 ? 1 : s > 0 ? s : 0;
}

/** The `harm` block of a parsed `water.json`, or undefined where the pack has none. */
function harmBlock(pack: unknown): Record<string, unknown> | undefined {
  if (!isObject(pack)) return undefined;
  const harm = (pack as { harm?: unknown }).harm;
  return isObject(harm) ? harm : undefined;
}

/**
 * The client's water values as the pack carries them, leniently and never throwing: an empty list
 * where the pack has no block, the block is not an object, or its rows are not an array. A row with
 * no `type` of its own takes its place in the list, which is what the table's own row order means.
 */
export function readLavaHarmRows(pack: unknown): LavaHarmRow[] {
  const harm = harmBlock(pack);
  if (!harm) return [];
  const raw = harm.types ?? harm.waterTypes ?? harm.rows;
  if (!Array.isArray(raw)) return [];
  const out: LavaHarmRow[] = [];
  raw.forEach((r, i) => {
    if (!isObject(r)) return;
    out.push({
      type: num(r.type) ?? i,
      damage: r.damage === true,
      kills: r.kills === true,
      interval: num(r.interval) ?? num(r.intervalSeconds) ?? 1,
      share: shareOf(r),
    });
  });
  return out;
}

/**
 * Which row lava takes. Water type 1 is lava in the terrain's own numbering and in the tables' row
 * order alike, so that row is asked for first; where the pack has no such row, the first row that
 * hurts at all is taken, which is the honest reading of a table whose rows have been renumbered.
 *
 * A table's own `waterType` is **not** consulted at the moment of a burn, and deliberately: a
 * planet's lava tables do not all carry type 1 (the shader and the pack's own `kind` decide what is
 * lava, through `isLavaWater`), so keying the blow on the table would leave most of a flow harmless.
 */
export function lavaHarmRow(rows: readonly LavaHarmRow[]): LavaHarmRow | null {
  for (const r of rows) if (r.type === 1) return r;
  for (const r of rows) if (r.damage) return r;
  return null;
}

/** Whose numbers those were, if the pack said: the water command writes 'client'. */
export function lavaHarmPackSource(pack: unknown): string | null {
  const harm = harmBlock(pack);
  const s = harm?.source;
  return typeof s === 'string' ? s : null;
}

/**
 * The templates the client's own list of what takes no damage names, **as the pack spelled them**:
 * a plain list of strings, however the block carries them (a bare array of paths, an array of rows
 * that name a template, or an object with `templates`). Nothing is reduced here and nothing here
 * decides what the list means -- reducing a name to the key both sides join on, and the join itself,
 * are `src/world/lavaImmunity.ts`'s, which is the file that owns the immunity.
 *
 * It exists so that there is one reader of the `harm` block rather than two, and it is handed the
 * **raw** parsed `water.json` rather than `readWaterPack`'s record, which keeps only the fields it
 * knows. An empty list back means either "the pack names nobody" or "there is no block": the
 * immunity's own reader tells those apart, and this one does not have to.
 */
export function lavaImmuneTemplates(pack: unknown): string[] {
  const harm = harmBlock(pack);
  if (!harm) return [];
  const raw = Array.isArray(harm.immune) ? harm.immune : isObject(harm.immune) && Array.isArray(harm.immune.templates) ? harm.immune.templates : null;
  if (!raw) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string') {
      if (v.trim()) out.push(v);
      continue;
    }
    if (!isObject(v)) continue;
    // A row of the client's table as the converter writes it: the template it names, and beside it
    // the `shared_` sibling the packs are keyed on where the archives hold one.
    const name = v.template ?? v.shared ?? v.id ?? v.name;
    if (typeof name === 'string' && name.trim()) out.push(name);
  }
  return out;
}

/** What `applyLavaHarm` did, for the console and for the one console line the world prints. */
export interface LavaHarmApplied {
  source: LavaHarmSource;
  share: number;
  interval: number;
  kills: boolean;
  /** A line worth printing when the planet has lava, or null when there is nothing to say. */
  note: string | null;
}

/**
 * Seed `LAVA_HARM` from a planet's pack. Called on every load, so a planet whose pack says nothing
 * puts the numbers back to "nobody has said" and nothing carries over from the last world.
 *
 * `hasLava` is only about what is worth saying: the numbers are seeded either way. A planet with no
 * flows on it and no block is not missing anything and is not asked to convert.
 */
export function applyLavaHarm(pack: unknown, hasLava: boolean): LavaHarmApplied {
  const row = lavaHarmRow(readLavaHarmRows(pack));
  if (!row) {
    // Nobody has said. Nothing burns, which is exactly what a planet on disk does today, and the
    // caller is handed the one command that changes it. There is no set of stand-in numbers here on
    // purpose: the only right ones are the client's, and the client's may not be written down in
    // this repository, so a flow that has not been converted is a flow that does not bite.
    resetLavaHarm();
    const note = hasLava
      ? 'lava: water.json carries no harm values, so a flow burns nothing at all; reconvert to give it the client\'s own (npm run swg -- water @SWG all assets-private --retail-only)'
      : null;
    return { source: 'none', share: 0, interval: LAVA_HARM.interval, kills: false, note };
  }
  LAVA_HARM.share = row.share;
  LAVA_HARM.interval = row.interval > 0 ? row.interval : 1;
  LAVA_HARM.kills = row.kills;
  LAVA_HARM.source = 'pack';
  LAVA_HARM.packSource = lavaHarmPackSource(pack);
  // A row that says this water does no damage at all is still a row and is taken at its word.
  if (!row.damage) LAVA_HARM.share = 0;
  return { source: 'pack', share: LAVA_HARM.share, interval: LAVA_HARM.interval, kills: LAVA_HARM.kills, note: null };
}

/**
 * Put the applied numbers back to the nothing-has-said state: a world left with no world after it,
 * and a planet whose pack says nothing. The margins and the switch are the owner's and are left
 * exactly where the console put them -- only what a pack can say is cleared here.
 */
export function resetLavaHarm(): void {
  LAVA_HARM.share = 0;
  LAVA_HARM.interval = 1;
  LAVA_HARM.kills = false;
  LAVA_HARM.source = 'none';
  LAVA_HARM.packSource = null;
}

/**
 * How much one blow takes off a life whose whole is `maxHp`. **Of the maximum, never of what is
 * left**, because the same row of the client's table says this water kills: a share of what is left
 * is fast at first and never fatal, which contradicts the table it came from.
 *
 * Nothing here knows whose life it is: the player's and a hull's are both 100 today and both go
 * through this.
 */
export function lavaTickDamage(share: number, maxHp: number): number {
  if (!Number.isFinite(share) || !Number.isFinite(maxHp) || maxHp <= 0) return 0;
  const s = share > 1 ? 1 : share > 0 ? share : 0;
  return s * maxHp;
}

/** How much of the hysteresis band applies: the whole of it to something already counted in, none to something not. */
function band(was: boolean, hold: number): number {
  return was && Number.isFinite(hold) && hold > 0 ? hold : 0;
}

/**
 * A point is in the flow: at least `margin` under its surface. `depth` is what `World.lavaAt` hands
 * back -- metres under the lava surface, negative over it, and -Infinity where the water over the
 * point is not lava at all, which is never finite and so never in it.
 *
 * `was` is whether this same body counted as in the flow on the last step, and it moves the line:
 * you go in at `margin` and come out only `hold` metres above that. Without it a body whose feet
 * rest at the line -- which is where a walker at the lip of a flow rests, since the flat polygon and
 * the ground generated under it all but coincide there -- flips every single step, saying two
 * contradictory things on the message line at the frame rate and burning at half rate or not at all.
 * The swim line does the same thing for the same reason.
 */
export function inLava(depth: number, was = false, margin: number = LAVA_HARM.margin, hold: number = LAVA_HARM.hold): boolean {
  if (!Number.isFinite(depth)) return false;
  return depth >= (Number.isFinite(margin) ? margin : 0) - band(was, hold);
}

/**
 * A ride is over the flow: under the surface, or no more than `reach` over it, measured at the
 * ride's belly. A hover machine never gets under a surface at all, so this is the test that decides
 * whether what a player drives burns, and `inLava` is the one that decides whether the player does.
 * `was` widens the reach by `hold` for something already counted in, exactly as it lowers the line
 * for a body.
 */
export function rideOverLava(depth: number, was = false, reach: number = LAVA_HARM.rideReach, hold: number = LAVA_HARM.hold): boolean {
  if (!Number.isFinite(depth)) return false;
  const r = Number.isFinite(reach) && reach > 0 ? reach : 0;
  return depth >= -(r + band(was, hold));
}

/**
 * Whether something that was in the flow still counts as being in it, `secondsSince` seconds after
 * the verdict above last came out true. The band in `inLava` moves a line; this bridges the case
 * where there is no line to move -- a hull drifting across the edge of a flow polygon reads a depth
 * one step and "there is no flow over this column at all" the next, and no margin in metres can
 * span that. Hold the verdict for `linger` seconds and the message line says one thing, the clock
 * keeps its place, and a pilot who really has left is believed a moment later.
 *
 * It decides what is *said* and whether the clock is kept; it never decides whether a blow lands.
 * `World.stepHazards` only ever charges a step whose own verdict was true, so nobody is burnt for
 * ground they have already left.
 */
export function stillInLava(raw: boolean, secondsSince: number, linger: number = LAVA_HARM.linger): boolean {
  if (raw) return true;
  const l = Number.isFinite(linger) && linger > 0 ? linger : 0;
  return Number.isFinite(secondsSince) && secondsSince < l;
}

/**
 * One subject's standing in a flow, as the tick remembers it between steps. There are two readers of
 * it -- the world's hazard tick, which decides whether anything is hurt, and the player's sink, which
 * decides how far the figure is drawn down -- and they must draw the **same** line, so they step the
 * same record through the same function below rather than each writing the three lines out.
 *
 * They really could differ otherwise, and not by a centimetre: `inLava`'s band moves a line by
 * `hold` metres, but `stillInLava` bridges a case no distance can reach, and a reader that had the
 * band and not the bridge would come out false for half a second in the middle of a flow. On the lava
 * planet that is not a wobble but a jump -- where no local table covers a column, `World.lavaAt`
 * falls through to the global sea's level, which is metres *below* the feet, so the depth goes from
 * half a metre under the surface to a large negative in a single step.
 */
export interface LavaHold {
  /**
   * The verdict as it stands, bridge and all: what is said, whether the clock is kept, and what the
   * next step's `inLava`/`rideOverLava` take as `was`.
   */
  in: boolean;
  /**
   * Whether **this** step's own verdict was true, with no bridge. It is the only one a blow may ever
   * be charged for, so that nobody is burnt for ground they have really left.
   */
  raw: boolean;
  /** Seconds since `raw` was last true; Infinity where it never has been. */
  gap: number;
  /**
   * The last depth that really was in the flow. A bridged step has no depth worth reading -- the
   * column it stands over is not the flow's at all -- so whatever measures itself against the surface
   * measures against this instead and holds where it was, which is the whole meaning of the bridge.
   */
  depth: number;
}

/** Nothing in anything, nothing remembered. */
export function newLavaHold(): LavaHold {
  return { in: false, raw: false, gap: Infinity, depth: -Infinity };
}

/**
 * Everything forgotten, in silence: a world going, the switch going off, a body that has stopped
 * standing on its own feet (mounted, noclipping, adrift, aboard a hull's rooms). Turning the switch
 * back on then says the line afresh rather than saying "out" first.
 */
export function resetLavaHold(h: LavaHold): void {
  h.in = false;
  h.raw = false;
  h.gap = Infinity;
  h.depth = -Infinity;
}

/**
 * Move one subject's verdict on by `dt` seconds, given what `World.lavaAt` says about the point that
 * matters (a body's feet, a ride's belly). `ride` picks which of the two lines is drawn: a hover
 * machine never gets under a surface at all, so what it rides over is measured with a reach.
 *
 * This is the whole of the rule and there is deliberately no second copy of it anywhere. Allocates
 * nothing, and a subject over no flow at all is one compare and an add.
 */
export function stepLavaHold(h: LavaHold, dt: number, depth: number, ride = false): LavaHold {
  const raw = ride ? rideOverLava(depth, h.in) : inLava(depth, h.in);
  if (raw) {
    h.gap = 0;
    h.depth = depth;
  } else h.gap += Number.isFinite(dt) && dt > 0 ? dt : 0;
  h.raw = raw;
  h.in = stillInLava(raw, h.gap);
  return h;
}

/** Write the knobs, ignoring anything that is not a finite number (or a boolean where one goes). */
export function tuneLavaHarm(t: LavaHarmTune | undefined): typeof LAVA_HARM {
  if (!t) return LAVA_HARM;
  if (typeof t.on === 'boolean') LAVA_HARM.on = t.on;
  if (typeof t.kills === 'boolean') LAVA_HARM.kills = t.kills;
  const n = (v: number | undefined): boolean => typeof v === 'number' && Number.isFinite(v);
  if (n(t.share)) LAVA_HARM.share = Math.min(1, Math.max(0, t.share!));
  if (n(t.interval) && t.interval! > 0) LAVA_HARM.interval = t.interval!;
  if (n(t.margin)) LAVA_HARM.margin = t.margin!;
  if (n(t.hold)) LAVA_HARM.hold = Math.max(0, t.hold!);
  if (n(t.rideReach)) LAVA_HARM.rideReach = Math.max(0, t.rideReach!);
  if (n(t.linger)) LAVA_HARM.linger = Math.max(0, t.linger!);
  return LAVA_HARM;
}

/** The numbers in force, whose they are, and what a blow comes to against a life of 100. */
export function lavaHarmReport(): {
  on: boolean;
  source: LavaHarmSource;
  packSource: string | null;
  share: number;
  interval: number;
  kills: boolean;
  margin: number;
  hold: number;
  rideReach: number;
  linger: number;
  perTickAt100: number;
  secondsToKillAt100: number;
  /** In words, for the console: why nothing is burning, when nothing is. */
  why: string | null;
} {
  const per = lavaTickDamage(LAVA_HARM.share, 100);
  return {
    on: LAVA_HARM.on,
    source: LAVA_HARM.source,
    packSource: LAVA_HARM.packSource,
    share: LAVA_HARM.share,
    interval: LAVA_HARM.interval,
    kills: LAVA_HARM.kills,
    margin: LAVA_HARM.margin,
    hold: LAVA_HARM.hold,
    rideReach: LAVA_HARM.rideReach,
    linger: LAVA_HARM.linger,
    perTickAt100: per,
    secondsToKillAt100: per > 0 ? Math.ceil(100 / per) * LAVA_HARM.interval : Infinity,
    why: !LAVA_HARM.on
      ? 'the switch is off (lava({ on: true }))'
      : LAVA_HARM.source === 'none'
        ? 'this pack carries no harm values, so nothing burns (npm run swg -- water @SWG all assets-private --retail-only)'
        : per > 0
          ? null
          : 'the pack says this water does no damage',
  };
}
