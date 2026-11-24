// The pure half of every look's layers in the game (the GPU port's pass 2, wave 5, maker L: `lookBody.ts` draws them): the
// dials, each body's picture's size, its card's reach, and the air's form by the tier. Node runs it with type stripping for the
// tests: no three, nothing that touches the page at load.

import { LOOK_BAKE_TUNE } from '../look/lookPictures.ts';

/**
 * The dials (feel is the owner's; each start's reason beside it). `__debug.lookBodies({ tune })` moves them live.
 *   - **everyFrames: 1.** A look that moves of itself (its clouds' own motion, storms, gas, a ring's spin) is drawn into its
 *     picture again every this many frames: at 1 its lightning flickers and its clouds creep at the frame rate as the viewer's
 *     do; 2 halves what it costs for a cloud motion no one can tell apart at 30 a second.
 *   - **stillMoves: 0.0005.** A look that does not move of itself is drawn again only when its light, seen in its card's own
 *     frame, has moved by more than this (a unit vector's change: about 0.03 degrees, under a pixel of a terminator across a
 *     moon a few degrees wide), or its size by 1%: so a still moon costs nothing on most frames.
 *   - **samples: 4.** Its picture's edge smoothing (multisampled, resolved): the limb and a ring's edge as smooth as the
 *     viewer's own stage draws them (its canvas antialiased); 1 to draw it plain.
 *   - **skyMost: 512, spaceMost: 2048.** The largest picture a body takes, a side, in a ground sky and in space: a sky body
 *     a few degrees across covers far under 512 pixels at 1440 lines, and a planet filling the screen from orbit needs the
 *     screen's own height (2048 holds 1440p); half floats, 2 MB and 32 MB with their depth and samples resolved. Each body
 *     takes the power of two over its reach's pixels at the screen's height, at least `least`.
 *   - **least: 64.** The smallest picture (a moon of a pixel or two still drawn whole).
 *   - **extraReach: 3500.** Where an extra body's card hangs (scene units from the eye): where SWG's own cards hang (the sky's
 *     reach, its dome beyond), so the land in front takes its pixels by depth as it takes a moon's.
 *   - **lowShare: 0.25, mediumShare: 0.5** (the fixer of wave 5). The share of the use's most a body's picture may take on
 *     the Low and the Medium tier (High and Ultra take it whole): the design's rule that bodies give way first. At Low a planet
 *     filling the screen from orbit is drawn at 512 and a sky body at 128 (a sixteenth of the pixels at 2048, where the checker
 *     read 0.5 ms more on the card at Low than the base's planet), at Medium at 1024 and 256; at least `least` either way.
 *   - **lowEvery: 4, mediumEvery: 2** (the fixer of wave 5). A moving look on the Low tier is drawn every fourth frame (clouds
 *     creeping and lightning flickering at 15 a second at 60), on Medium every other; High and Ultra take `everyFrames`.
 *   - **kitWaitMs: 60000** (the owner's word of 23 November, pass 2 wave 6's late addition 3: "one loading screen for
 *     everything, unless it is very, very long"; the fixer of wave 5 had it at 2000). The most a loading screen waits, in all,
 *     for the bake kits of the looks the arrival shows (a generated look's surface, relief and clouds, compiled once a session
 *     and kept by the browser's shader cache) and for their bakes: every look the arrival shows is baked and its pipelines
 *     compiled behind this one screen, an applied system's extra body's preset included (its kit asked as the bodies are
 *     planned), and only a kit still out after a minute leaves its body in SWG's picture on this screen, to wear its look from
 *     the next. On a cold shader cache a kit took 5 to 30 s here; a minute is a cap for the extreme alone, never a wait a
 *     player meets on a warm cache. 0 waits for nothing (only kits already landed, wave 5's put-off). The map's opened
 *     systems are not shown by the arrival: their kits are still asked once the screen is gone (`kitsAfterScreen`).
 *   - **kitsAfterScreen: 2** (the fixer of wave 5). How many of those kits are asked as each screen goes: they compile in play,
 *     off the frame, never by a draw, and land for the next screen; two keeps the card's compile threads from a minute's queue
 *     the next screen would wait behind, and the rest follow at the screens after.
 * The bake a body's look is made at is wave 4b's (LOOK_BAKE_TUNE's skySize and spaceSize, its own size at most). The tier's
 * sizes and cadence are taken when a world's bodies are made, behind its loading screen, as the air's form is.
 */
export const LOOK_BODY_TUNE = {
  everyFrames: 1,
  stillMoves: 0.0005,
  samples: 4,
  skyMost: 512,
  spaceMost: 2048,
  least: 64,
  extraReach: 3500,
  lowShare: 0.25,
  mediumShare: 0.5,
  lowEvery: 4,
  mediumEvery: 2,
  kitWaitMs: 60000,
  kitsAfterScreen: 2,
};

/** Each dial's range (the console holds a move to it). */
export const LOOK_BODY_RANGE: Record<keyof typeof LOOK_BODY_TUNE, readonly [number, number]> = {
  everyFrames: [1, 8],
  stillMoves: [0, 0.1],
  samples: [1, 4],
  skyMost: [64, 2048],
  spaceMost: [256, 4096],
  least: [16, 512],
  extraReach: [500, 20000],
  lowShare: [0.0625, 1],
  mediumShare: [0.0625, 1],
  lowEvery: [1, 8],
  mediumEvery: [1, 8],
  kitWaitMs: [0, 300000],
  kitsAfterScreen: [0, 16],
};

/** The most a body's picture may take at a tier (0 Low to 3 Ultra): the use's most times the tier's share (`lowShare`, `mediumShare`). */
export function tierMost(where: 'sky' | 'space', tier: number): number {
  const most = where === 'space' ? LOOK_BODY_TUNE.spaceMost : LOOK_BODY_TUNE.skyMost;
  const share = tier <= 0 ? LOOK_BODY_TUNE.lowShare : tier === 1 ? LOOK_BODY_TUNE.mediumShare : 1;
  return most * share;
}

/** Every how many frames a moving look is drawn at a tier (0 Low to 3 Ultra): never more often than `everyFrames`. */
export function everyFor(tier: number): number {
  const own = tier <= 0 ? LOOK_BODY_TUNE.lowEvery : tier === 1 ? LOOK_BODY_TUNE.mediumEvery : 1;
  const all = LOOK_BODY_TUNE.everyFrames >= 1 ? LOOK_BODY_TUNE.everyFrames : 1;
  return own > all ? own : all;
}

/** Moves to the dials, each held to its range; answers the dials as they stand. */
export function tuneLookBodies(o: Partial<Record<keyof typeof LOOK_BODY_TUNE, number>> | null | undefined): typeof LOOK_BODY_TUNE {
  if (o && typeof o === 'object') {
    for (const k of Object.keys(LOOK_BODY_TUNE) as (keyof typeof LOOK_BODY_TUNE)[]) {
      const v = o[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const [lo, hi] = LOOK_BODY_RANGE[k];
      LOOK_BODY_TUNE[k] = v < lo ? lo : v > hi ? hi : v;
    }
    LOOK_BODY_TUNE.samples = LOOK_BODY_TUNE.samples >= 2 ? 4 : 1;
  }
  return LOOK_BODY_TUNE;
}

/**
 * The tangent of the half angle a body's card spans: its reach (`reach` its own radii: rings, halo, air, gas) seen from where
 * a sphere of radius 1 stands `halfRad` across in half, its bounding sphere's angle, held under 80 degrees (a reach round the
 * eye has no card that holds it).
 */
export function lookExtentTan(halfRad: number, reach: number): number {
  const s = Math.sin(halfRad > 0 ? halfRad : 0) * (reach > 1 ? reach * 1.05 : 1.05);
  const most = Math.sin((80 * Math.PI) / 180);
  const a = Math.asin(s < most ? s : most);
  return Math.tan(a);
}

/**
 * A body's picture's side: the power of two over the pixels its card's reach may take at the screen's height
 * (`screenShare` the share of the screen's height, `screenH` its pixels), held between `least` and the use's most.
 */
export function lookBodyPictureSize(screenShare: number, screenH: number, where: 'sky' | 'space', tier = 3): number {
  const most = tierMost(where, tier);
  const px = (screenShare > 0 ? screenShare : 0) * (screenH > 0 ? screenH : 1080);
  let size = LOOK_BODY_TUNE.least;
  while (size < px && size * 2 <= most) size *= 2;
  return size;
}

/** The bake's size for a look at a use (its own at most, a size the bake makes: 1024, 2048 or 4096). */
export function lookSizeFor(where: 'sky' | 'space', look: { generated?: Record<string, unknown> | null } | null | undefined): number {
  const own = Number(look?.generated?.size) || 2048;
  const want = where === 'space' ? LOOK_BAKE_TUNE.spaceSize : LOOK_BAKE_TUNE.skySize;
  const s = own < want ? own : want;
  return s >= 4096 ? 4096 : s >= 2048 ? 2048 : 1024;
}

/**
 * The air's form for the looks built at a screen, by the tier (`tierIndexOf`: 0 Low to 3 Ultra; the design's 2.6): Low draws
 * every body Painted (its painted rim or halo, no march), the rest each look's own form (Scattered where the owner set it,
 * else Painted, as the viewer draws it), the march's steps the tier's: Medium 8, High 12, Ultra 16 (the viewer's qualities
 * low, medium and high).
 */
export function lookAirChoiceFor(tier: number): { all: 'own' | 'painted'; quality: 'low' | 'medium' | 'high' } {
  if (tier <= 0) return { all: 'painted', quality: 'low' };
  return { all: 'own', quality: tier === 1 ? 'low' : tier === 2 ? 'medium' : 'high' };
}

/**
 * The share of the screen's height a body's reach takes at a field of view (`fovDeg`, vertical): `halfRad` its disc's half
 * angle, `reach` its own radii. For a body's picture's size at the screen.
 */
export function screenShareOf(halfRad: number, reach: number, fovDeg: number): number {
  const t = lookExtentTan(halfRad, reach);
  const f = Math.tan(((fovDeg > 1 ? fovDeg : 1) * Math.PI) / 360);
  return t / f;
}
