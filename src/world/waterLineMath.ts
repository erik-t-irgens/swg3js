// Where the water's surface line is, for the one question "am I under water": how far over the
// plain surface still counts as under, how far the answer holds once it is yes, how deep under
// a point is, and -- for the reader the feet and the blade share -- whether the point is in a room,
// where there is no water at all whatever height it stands at. Pure, and it imports nothing, so a
// node test runs exactly what the game runs.
//
// (The look of the water once you are under it is a different file, `src/core/fx/underwaterMath.ts`,
// and a different tuning object. This one decides only which side of the surface the eye is on.)
//
// Every number here is ours. The game this recreates had no under water at all -- you could not go
// under -- so there is nothing in the archives to be faithful to and nothing to copy. The values
// below are the ones the game already ran on, gathered from the three places that each asked the
// question with a margin of their own.

/**
 * Ours, all four. Nothing here reads a setting, and nothing may write it: unlike the look's own
 * `UNDERWATER_TUNE`, which is deliberately live through `__debug.underwater`, where the surface line
 * is must be the same answer for the reflections, the flare and the chain for the whole session.
 */
export const WATER_LINE_TUNE = {
  /**
   * Metres over the plain surface that still count as under, before any swell is added: at the very
   * line the eye is in the film of the surface rather than cleanly above it.
   */
  margin: 0.1,
  /**
   * Metres the answer holds by once it is yes, so a crest passing over the eye does not flicker the
   * verdict (and with it the reflections, the lens flare and the chain's own pass).
   */
  hysteresis: 0.2,
  /** How far a lake's surface moves: it does not swell, but its rings and its rain still lift it. */
  lakeReach: 0.15,
  /**
   * The least the whole margin may be, whatever the water's own reach is. A lake's reach plus the
   * margin is under this, and the camera's own test has carried this floor as a flat number since
   * before the swell was measured; keeping it means no call site's answer moves except where the
   * lava guard moves it.
   */
  floor: 0.3,
} as const;

/** Everything the rule needs about one point. Nothing here is a THREE type, so node reads it as the game does. */
export interface WaterLineQuery {
  /** The point's height in metres. */
  y: number;
  /** The water surface over the point in metres; -Infinity (or any non-finite value) where there is none. */
  surface: number;
  /** How far a crest can lift that surface here: the sea's swell, or a lake's ring reach. */
  reach: number;
  /** The answer the last time this caller asked, which is where the hysteresis lives. */
  wasUnder: boolean;
  /** The table over the point is lava: water to the terrain, and never water to anything else. */
  lava: boolean;
  /** Nowhere water can be at all: no planet, a space zone, or inside a building's rooms. */
  dry: boolean;
}

export interface WaterLineVerdict {
  /**
   * The conservative answer: the point may have water over it, crests and all. This is the one a
   * reflection, a flare or anything else that must not be caught *wrong* reads, and it is true
   * throughout the margin band -- which is up to 1.5 m over the open sea's mean surface.
   */
  under: boolean;
  /**
   * The strict answer: the point is genuinely below the surface. **This** is the one anything that
   * paints the picture reads, because being conservative there is a bug rather than a safety: the
   * band above the line is air, and tinting it would paint the screen while the eye is plainly out
   * in the open. `submerged` is exactly `depth > 0`, named so a reader cannot mistake it for `under`.
   */
  submerged: boolean;
  /**
   * Metres of water over the point, never below 0. Inside the margin band the eye is above the true
   * surface and `under` is still yes, and there the depth is 0, so nothing the depth drives pops
   * on at the line.
   */
  depth: number;
}

/**
 * Whether a point stands inside a building's room. The world answers it from the streamed
 * buildings' own cells; a node test answers it from fixtures. Nothing about it is a THREE type, so
 * the rule below is the same arithmetic in both.
 */
export type RoomTest = (x: number, y: number, z: number) => boolean;

/**
 * The water over a point, for the one reader the feet, the blade and everything after them share
 * (`World.footSurfaces.waterTop`): the surface the terrain gives, **unless the point stands in a
 * room**, and then no water at all.
 *
 * Caves and bunkers really do sit below a planet's water table -- 87 placed portal buildings across
 * ten converted planets have a room floor under one -- and in every one of those rooms the height
 * alone says the body is wading: the footsteps go silent and a lit blade hisses and boils indoors,
 * in the dry. The room is the answer, not the height, so the rule is the room's and is written here
 * rather than in any one caller's clause order, where it would mend the feet and leave the blade.
 *
 * `indoors` is asked **only when it could change the answer**: a point above the surface, and every
 * point on a planet with no water over it (`surface` -Infinity), returns before asking. So a step on
 * dry land costs exactly what it cost before -- one compare more, and not one lookup -- and the room
 * is looked up only where the old answer would have been "wading".
 *
 * This is the same exception `underwaterVerdict` already takes for the camera through its `dry`
 * flag; the camera reads the player's own tracked room, and this reads the point's, because a blade
 * and a foot are not always the player's.
 *
 * **Who must not read it.** A body with a tracked cell of its own -- the player, whose swim reads
 * `World.waterColumnAt` and `Player.inside` -- must take the column and its own room rule instead.
 * `indoors` here is a box test, and a room box is padded and overhangs its hull (89 of the 938
 * placed portal buildings in the converted packs have one that straddles the water line at the
 * building's own point). The worst a wrong box can do to a foot is silence one step; handed to a
 * swimmer it is a depth of -Infinity, which fails every swim test at once with no hysteresis able to
 * soften it, and takes the water out from under a body mid-stroke.
 */
export function waterTopAt(x: number, y: number, z: number, surface: number, indoors: RoomTest): number {
  // Written as "not under" rather than "above": a height that is not a number asks nothing and keeps
  // the surface it was handed, which every caller already reads as no water over it.
  if (!(y < surface)) return surface;
  return indoors(x, y, z) ? -Infinity : surface;
}

/**
 * How far over the surface still counts as under, for water whose crests reach `reach` metres and a
 * caller who last heard `wasUnder`. Never less than the floor.
 */
export function underwaterMargin(reach: number, wasUnder: boolean): number {
  const r = Number.isFinite(reach) && reach > 0 ? reach : 0;
  const m = r + WATER_LINE_TUNE.margin + (wasUnder ? WATER_LINE_TUNE.hysteresis : 0);
  return m > WATER_LINE_TUNE.floor ? m : WATER_LINE_TUNE.floor;
}

/**
 * The verdict for one point, written into the caller's own record. Asking twice at the same point
 * answers the same twice (the margin only ever grows once the answer is yes), so a caller may ask
 * as often as it likes in a frame without the hysteresis walking away from it.
 */
export function underwaterVerdict(q: WaterLineQuery, out: WaterLineVerdict): WaterLineVerdict {
  if (q.dry || q.lava || !Number.isFinite(q.surface) || !Number.isFinite(q.y)) {
    out.under = false;
    out.submerged = false;
    out.depth = 0;
    return out;
  }
  const under = q.y < q.surface + underwaterMargin(q.reach, q.wasUnder);
  out.under = under;
  const d = q.surface - q.y;
  out.depth = under && d > 0 ? d : 0;
  out.submerged = out.depth > 0;
  return out;
}

/**
 * How far a crest can lift the surface over a point: the sea's own measured swell where the surface
 * is the sea, and a lake's fixed reach otherwise (a lake does not swell, but its rings and its rain
 * still move it). A swell that is not a positive number is no reach at all.
 */
export function surfaceReach(onSea: boolean, swell: number): number {
  if (!onSea) return WATER_LINE_TUNE.lakeReach;
  return Number.isFinite(swell) && swell > 0 ? swell : 0;
}

/**
 * Whether the surface over a point is the planet's own global sea rather than a lake. The compare is
 * float-exact on purpose and is not a tolerance waiting to be written: the terrain answers with the
 * global table's height *itself* -- the very same number -- wherever no local table covers the
 * point, so equality here means "no table won", which is what the sea is. `seaDrawn` is whether the
 * planet has a global sea at all (its mesh is in the scene); with none, no surface is ever the sea's.
 */
export function onSeaSurface(surface: number, waterLevel: number, seaDrawn: boolean): boolean {
  return seaDrawn && Number.isFinite(surface) && surface === waterLevel;
}

/**
 * Which shader's look the water over a point wears: the covering table's own, when that table is
 * what the surface is, and the planet's global sea otherwise. A lava table is never a look (it is
 * not water at all), and a table standing below the surface is not what the eye is under.
 */
export function coveringWaterShader(
  table: { height: number; shader?: string | null } | null,
  lava: boolean,
  surface: number,
  globalShader: string | null,
): string | null {
  if (table && !lava && table.height === surface) return table.shader || null;
  return globalShader;
}
