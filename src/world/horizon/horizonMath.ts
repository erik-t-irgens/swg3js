// The far ground's arithmetic (the horizon pass, DESIGN.md §2.4, §2.6): the knobs, the reach rules, the mirrors of the
// ring program's morph, edge level, drop and reach clamp (each the very formula `horizonRings.ts`'s GLSL runs, which
// `horizonShaders.test.ts` holds to these), the hole's byte grid of standing chunks, the leaves' min/max pyramid, and the
// CDLOD selection: a quadtree over the bake's extent, every node one instance of one 8 by 8 patch, culled whole against
// the camera's frustum and split by range, by meeting the hole's square and by the edge's level, from kept stacks into
// two kept instance arrays, allocating nothing a frame.
//
// Pure: three's maths alone (a frustum and a box), so node runs it.
import * as THREE from 'three';
import { SHAPE_BLOCK, SHAPE_SIDE, shapeReachMostOf } from './shapeWindow.ts';
import { SKY_SHARE as FLARE_SKY_SHARE } from '../../core/fx/flareMath.ts';

export type HorizonGround = 'tiles' | 'both' | 'rings';

/** A shape window block's width in metres at its 2 m step (`shapeWindowReach`'s, written out in `shapeRanges`). */
const SHAPE_BW = SHAPE_BLOCK * 2;

/**
 * Every number of the far ground [ours unless a line says so], live through `__debug.horizon({ tune })`; the look ones are
 * sliders under `horizon` in the debug menu (`horizonDials.ts`). The wave each is used from is DESIGN.md §2.14's.
 */
export const HORIZON_TUNE = {
  /** 'tiles' today's far tiles; 'both' the rings drawn and the far tiles built and hidden; 'rings' the rings and no far tile or far grid. */
  ground: 'tiles' as HorizonGround,
  /** In 'both', which of the two is drawn (the frame report's A/B, `perf({ ab: { key: 'horizon' } })`). */
  drawn: 'rings' as 'rings' | 'tiles',
  /** How far the rings go, metres (the Graphics page's Terrain distance from W5). */
  reach: 8000,
  /** The reach in force stops where the planet's fog leaves less than `fogCapAt` of the ground (§12 Q12). */
  fogCap: true,
  fogCapAt: 1 / 255,
  /** Past this fog factor a fragment is the fog's colour with no taps (the critique's M1). */
  fogCheap: 0.996,
  /** Level 0's range, before the floors of §2.4 (the standing chunks' farthest corner over 1 - morph). */
  lod0: 1400,
  /** The share of each range, and of each edge band, the morph runs over. */
  morph: 0.3,
  /** The first band of the edge's level, doubling outward (the critique's M7). */
  edgeBand: 64,
  /** How far a leaf's skirt hangs toward the hole, metres. */
  ringSkirt: 16,
  /** How far under the bake the rings stand at the hole's edge (the far tiles' own `FAR_TILE_DROP`), fading over `dropFade`. */
  drop: 2.5,
  dropFade: 256,
  dropAt: 'seam' as 'seam' | 'everywhere',
  /** Drawn after the chunks, so their depth rejects hidden ring pixels early. */
  renderOrder: 1,
  /**
   * W5 (§1b Q10): metres of reach a metre of the eye's height over the ground under it buys, so a ship high up sees further
   * (4 [ours]: a ship 2 km up sees the slider's reach and 8 km more); held under the slider's top (`REACH_SLIDER_TOP`, or
   * the console's reach where that is more) and the bake's own extent. Nought is the slider's reach at any height.
   */
  heightReach: 4,
  /**
   * W5: the far plane and the sky's radius follow the reach (grown by height) in steps of this many metres [ours], so a
   * climbing ship moves the far plane, the projection and the cascades' fit only as it crosses a step, never a frame.
   */
  farStep: 500,
  /** W5 (§12 Q3): the far ridges stop the god rays and the flare (depth past the reach in force less half the fade is sky). */
  raysBlock: true,
  /** W5 (§2.7): how far the reach in force moves before the far sea's outer row follows it, metres [ours]. */
  seaStep: 250,
  /**
   * The third wave: inside `detailReach` (metres from the eye, the Graphics page's Ground detail distance) the rings draw
   * the near ground's own composition (the tile program's pictures, alternates, masks, tint, bump and gloss) from the
   * composition window; it fades into the bake's per-tile mean over the last `detailFadeShare` of that distance, so no
   * line shows where it ends. 'off' draws the mean everywhere.
   */
  detail: 'tile' as 'tile' | 'off',
  detailReach: 2500,
  detailFadeShare: 0.5,
  /** The horizon fade: the last `fade` share of the reach in force dissolves into `fadeTo` (§1b Q4: a switch of three). */
  fade: 0.15,
  fadeOn: true,
  fadeTo: 'sky' as 'sky' | 'fog' | 'none',
  /** The sky's radius over the reach (grown by height, never the fog's) and the far plane over the sky's radius (W5). */
  skyMargin: 1.1,
  farMargin: 1.7,
  /** What the program draws: the lit ground, or one of its parts for the console (a uniform). */
  view: 'shaded' as 'shaded' | 'lod' | 'albedo' | 'normals' | 'edge' | 'detail' | 'window',
  /**
   * W2: with the rings in place of the far tiles, far grids are still made this many 512 m tiles each way of the eye, for
   * the far tree cards' families and the race's look-ahead (§2.9; at least a kilometre, so a pod's half second is inside).
   */
  farGridRadius: 2,
  /** W2: how long an arrival waits behind its screen for the overlays the terrain worker makes again (paint, a dropped building, Life Day), ms; the rest lands in play. */
  regenWaitMs: 4000,
  /**
   * Wave 3b, the rings' shape up close: finer levels than the bake's 8 m from the hole outward, standing on the live
   * generator's own 2 m heights round the eye (the shape window, `shapeWindow.ts`), so the shape does not change just past
   * the near ground. `shapeReach` is how far the finest (`shapeFinest` metres, 2 or 4) holds before it gives way (the
   * Graphics page's Terrain shape detail): it morphs over the range's last `morph` share onto 4 m, which the ranges hand on to
   * the 8 m level, never coarser than the rings were without it. Nought, or the switch off, is the rings of before.
   */
  shape: true,
  shapeFinest: 2,
  shapeReach: 700,
  /** The finer levels' own morph share (their ranges are short: a share of 0.3 would want more room before the next). */
  shapeMorph: 0.15,
  /** How many of the coarser level's node sizes past a finer range the coarser one's morph begins (keeps the T-junctions closed). */
  shapeGap: 2.5,
  /** How far the selection's frustum box is grown up and down for the 2 m heights, which stand off the bake's 8 m samples (metres). */
  shapePad: 12,
  /** The shape window's share fades to nought over its last this many samples, so its edge is never a step. */
  shapeFade: 16,
  /**
   * Wave h6a: where the bake's own heights are 4 m (`horizon --step=4`), the 4 m level reads them past the shape window and
   * runs to twice the 2 m level's range, level 0 to twice its, so each level hands over where its triangles reach the size
   * the finer one's had at its own handover. Off, the ranges of an 8 m bake (the shape window's alone). No 8 m bake moves.
   */
  shapeBake: true,
  /**
   * W4, the edits followed live (DESIGN.md §6, §2.13): a region put on the card makes no mips; the fine normals' and the
   * albedos' mips are made again by one flagged 1-texel copy at most every `mipsEvery` ms while an edit is held, and once at
   * its end. `liveMs` is a frame's share for a course's change laid over the bake (the race drawer's own 2 ms), nearest the
   * eye first; a stroke's stamp is laid whole at once (a 200 m brush is 25 by 25 samples).
   */
  mipsEvery: 250,
  liveMs: 2,
};
export type HorizonTune = typeof HORIZON_TUNE;

export const HORIZON_VIEWS = ['shaded', 'lod', 'albedo', 'normals', 'edge', 'detail', 'window'] as const;

/** The reach without reversed depth: today's slider top (ordinary depth's 24 bits were already living there). */
export const REACH_NO_REVZ = 4900;
/** The Graphics page's Terrain distance top (`menu.ts`'s 16 km), which the height's growth is held under (§1b Q10). */
export const REACH_SLIDER_TOP = 16000;
/**
 * Today's numbers, each what every reader holds with the rings not drawn (`'tiles'`, no bake, a space zone), by `Object.is`:
 * the sky's bodies' radius (`sky.ts`'s SKY_RADIUS), the camera's far plane (`camera.ts`), the god rays' ground sky
 * (`context.ts`'s GROUND_SKY, once `passes.ts`'s GROUND_SKY_DISTANCE) and the far sea's outer edge (`createGlobalWater`).
 */
export const SKY_BASE = 3500;
export const FAR_BASE = 9000;
export const RAYS_GROUND_SKY = 2500;
export const SEA_BASE = 9000;
/** Every sky element's radius as a multiple of `SKY_BASE` (`sky.ts`: the bodies 1, the stars 1.2, the skybox 1.5, the dome 1.6). */
export const SKY_SHELLS = [1, 1.2, 1.5, 1.6] as const;
/** The most levels the quadtree has (a root at level 7 is 8 km across). */
export const LEVELS_MOST = 7;
/** A leaf is one 64 m chunk; a patch is 8 by 8 quads. */
export const LEAF = 64;
export const PATCH = 8;

/** The fog's density at which ground at `d` keeps `at` of itself (FogExp2: exp(-(k d)^2)), solved for d. */
export function fogReachOf(density: number, at: number): number {
  if (!(density > 0)) return Infinity;
  return Math.sqrt(-Math.log(at)) / density;
}

/** The answers every reader of the reach takes, from one function (§2.6). */
export interface ReachRules {
  /** The fog's density in force, the caller's to write before asking (a kept record: a number handed across a call is a number made). */
  fogDensity: number;
  /** W5: the eye's height over the bake's ground under it (never under nought) and how far the bake reaches from the eye, the caller's to write. */
  eyeOver: number;
  bakeMost: number;
  /** The slider's reach, held to 4.9 km without reversed depth. */
  reach: number;
  /** W5 (§1b Q10): the slider's reach grown by the eye's height (`heightReach`), held under the slider's top and the bake's extent. */
  grown: number;
  /** Where the fog leaves less than `fogCapAt` of the ground. */
  fogReach: number;
  /** The reach the rings stop at: the lesser of the grown reach and the fog's with `fogCap`, else the grown reach. */
  inForce: number;
  /** The sky's radius and the far plane, on the grown reach in steps of `farStep` (the fog never moves the cascades). */
  skyRadius: number;
  far: number;
  /** The grown reach on `farStep`'s steps, held a step and a quarter below its step as it falls (no flip back and forth on a step's line). */
  farReach: number;
  /** W5 (§2.6): depth past this is sky to the god rays and the flare: the reach in force less half the fade with `raysBlock`, else 2,500 m. */
  groundSky: number;
  /** The flare's `skyDistance`: so that `skyDistance x SKY_SHARE` is `groundSky` with `raysBlock`, else the sky's radius. */
  flareSky: number;
  /** Level 0's range in force, and how many levels reach the reach in force. */
  lod0: number;
  levels: number;
  /** Wave 3b: the finest level (nought, minus one or minus two), the 4 m level's range and the 2 m level's (nought where none). */
  finest: number;
  r1: number;
  r2: number;
  /** The finer levels' morph share in force (`shapeMorph` held to [0.01, 0.9]): the ranges are placed with it and the ring morphs by it. */
  mf: number;
  /**
   * Wave h6a, the caller's to write once a field is made (a kept record): the shape window's side in samples (1,024 or
   * 2,048), whose whole share holds the finer ranges, and the bake's own fine step in metres (4 where baked at 4 m, which
   * carries the 4 m level past the window with `shapeBake`).
   */
  side: number;
  bakeStep: number;
}

/**
 * The finer levels' ranges (wave 3b) round level 0's of before (`lodT`): the finest level's range is the shape's reach;
 * the 4 m level's is twice it where that fits under level 0's range of before (so no coarser level moves), else as short as
 * the morph allows; level 0's is held at least far enough for the 4 m level to morph onto it. Every finer range is held
 * inside the shape window's whole share (`shapeWindowReach`), past which its 2 m shape would be the bake's 8 m. Written into `out`.
 */
export function shapeRanges(t: HorizonTune, lodT: number, shapeOk: boolean, out: ReachRules): void {
  let finest = shapeOk && t.shape && t.shapeReach > 0 ? (t.shapeFinest <= 2 ? -2 : t.shapeFinest <= 4 ? -1 : 0) : 0;
  const mf = Math.min(Math.max(t.shapeMorph, 0.01), 0.9);
  out.mf = mf;
  out.lod0 = lodT;
  out.r1 = 0;
  out.r2 = 0;
  if (finest === 0) {
    out.finest = 0;
    return;
  }
  // Each level's morph must not have begun where it meets the finer one's nodes, or a finer node's edge vertex and its
  // coarser neighbour's would morph by two fractions and part (the T-junction a doubling range's 40% keeps closed): so a
  // range's morph begins `shapeGap` of its coarser level's node sizes past the finer range, the finer levels morphing over
  // their own outer `shapeMorph` share.
  const S = Math.max(t.shapeReach, 1);
  const gap = Math.max(t.shapeGap, 0);
  // A finer vertex asks its level at d < r1 and its morph moves it at most a 4 m step, so r1 stands that step inside the
  // window's whole share (`shapeWindowReach`, written out: a frame's, and a number handed back from a call is a number made).
  const f = Math.max(t.shapeFade, 1);
  // The window's side in force (wave h6a: 1,024 or 2,048 samples), its half in blocks a whole number.
  const side = out.side;
  const half = (side / SHAPE_BLOCK) >> 1;
  const most = Math.min((side - 1 - f) * 2 - (half + 1) * SHAPE_BW, half * SHAPE_BW - f * 2) - LEAF / PATCH / 2;
  // Wave h6a: a bake of 4 m carries the 4 m level past the window, to twice the 2 m level's range, and level 0 to twice
  // its (each level handing over where its triangles reach the size the finer one's had at its own); an 8 m bake's ranges
  // are wave 3b's to the bit.
  const bake4 = t.shapeBake && out.bakeStep <= 4;
  if (finest === -2) {
    const s2 = Math.min(S, most * (1 - mf) - gap * (LEAF / 2));
    if (s2 >= 1) {
      out.r2 = s2;
      out.r1 = (s2 + gap * (LEAF / 2)) / (1 - mf);
      if (bake4) out.r1 = Math.max(out.r1, 2 * s2);
    } else finest = -1;
  }
  if (finest === -1) out.r1 = bake4 ? S : Math.min(S, most);
  out.finest = finest;
  out.lod0 = Math.max(lodT, (out.r1 + gap * LEAF) / (1 - t.morph));
  if (bake4) out.lod0 = Math.max(out.lod0, 2 * out.r1);
}

/**
 * The furthest the 2 m shape may hold under the tune's fade, morph and gap (wave 3b's review): the reach `shapeRanges` keeps
 * whole, which the Graphics page's Terrain shape detail and the dial stop at (`SHAPE_REACH_MOST`, at the shipped numbers),
 * for a window of `side` samples (wave h6a; today's 1,024 by default).
 */
export function shapeReachMost(t: HorizonTune, side = SHAPE_SIDE): number {
  return shapeReachMostOf(side, t.shapeFade, t.shapeMorph, t.shapeGap);
}

export function reachRules(t: HorizonTune, viewRadius: number, reversed: boolean, out: ReachRules, shapeOk = true): ReachRules {
  const fogDensity = out.fogDensity;
  const reach = reversed ? t.reach : Math.min(t.reach, REACH_NO_REVZ);
  out.reach = reach;
  // W5 (§1b Q10): the reach grown by the eye's height over the ground, held under the slider's top (or the console's own
  // reach past it) and the bake's extent; without reversed depth today's 4.9 km holds it whatever the height.
  // (The ternary picks between two whole constants: a worked number in one arm and a constant in the other is a number made.)
  const top = Math.max(reversed ? REACH_SLIDER_TOP : REACH_NO_REVZ, reach);
  const up = reach + Math.max(0, t.heightReach) * Math.max(0, out.eyeOver);
  out.grown = Math.max(reach, Math.min(Math.min(up, top), out.bakeMost));
  // `fogReachOf`, written out (a frame's: a number handed back from a call is a number made).
  // No ternary with Infinity in it: a constant and a worked number met in one branch are a number made each call (no
  // density divides to Infinity by itself).
  out.fogReach = Math.sqrt(-Math.log(t.fogCapAt)) / Math.max(fogDensity, 0);
  out.inForce = t.fogCap ? Math.min(out.grown, out.fogReach) : out.grown;
  // The far plane and the sky on the grown reach in steps (`farStep`), never the fog's: the projection and the cascades'
  // fit move only as a step is crossed, and a reach falling back keeps its step until a quarter step past it.
  const step = Math.max(1, t.farStep);
  const want = Math.ceil(out.grown / step) * step;
  if (!(out.farReach >= want && out.farReach - out.grown < step * 1.25)) out.farReach = want;
  out.skyRadius = Math.max(SKY_BASE, out.farReach * t.skyMargin);
  out.far = Math.max(FAR_BASE, out.skyRadius * t.farMargin);
  // The god rays' and the flare's sky (§2.6, §12 Q3): past the reach in force less half the fade (none with the fade off,
  // when the ridge at the reach is drawn whole) a ridge is sky; with `raysBlock` off, today's 2,500 m and the sky's radius.
  // Written by branch into the record's fields, never through a ternary of a worked number and a constant (a number made).
  const fade = Math.min(Math.max(t.fade, 0), 1) * (t.fadeOn && t.fadeTo !== 'none' ? 1 : 0);
  if (t.raysBlock) {
    out.groundSky = out.inForce * (1 - fade / 2);
    out.flareSky = out.groundSky / FLARE_SKY_SHARE;
  } else {
    out.groundSky = RAYS_GROUND_SKY;
    out.flareSky = out.skyRadius;
  }
  shapeRanges(t, Math.max(t.lod0, ((viewRadius + 2) * LEAF * Math.SQRT2) / (1 - t.morph)), shapeOk, out);
  // A whole number kept a whole number (| 0): a float64 stored into a small-integer field is a number made.
  out.levels = (Math.min(LEVELS_MOST, Math.max(0, Math.ceil(Math.log2(Math.max(1, out.inForce) / out.lod0)))) | 0) + 1;
  return out;
}

/**
 * The horizon fade's share at a distance (§2.5, §1b Q4; the mirror of the ring program's `gF`): nought inside the last
 * `share` of the reach in force, one at the reach, GLSL's smoothstep between.
 */
export function ringFadeOf(d: number, reach: number, share: number): number {
  const e0 = reach * (1 - share);
  const t = Math.min(Math.max((d - e0) / (reach - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

export function newReachRules(): ReachRules {
  // Every field that will hold a fraction starts as one: a field begun as a small integer boxes every fraction written after.
  const r = { fogDensity: 0.5, eyeOver: 0.5, bakeMost: 0.5, reach: 0.5, grown: 0.5, fogReach: 0.5, inForce: 0.5, skyRadius: 0.5, far: 0.5, farReach: 0.5, groundSky: 0.5, flareSky: 0.5, lod0: 0.5, levels: 1, finest: 0, r1: 0.5, r2: 0.5, mf: 0.5, side: SHAPE_SIDE, bakeStep: 8 };
  r.mf = 0.15;
  r.r1 = 0;
  r.r2 = 0;
  r.fogDensity = 0;
  r.eyeOver = 0;
  r.bakeMost = Infinity;
  r.reach = 0;
  r.grown = 0;
  r.fogReach = Infinity;
  r.inForce = 0;
  r.skyRadius = SKY_BASE;
  r.far = FAR_BASE;
  r.farReach = 0;
  r.groundSky = RAYS_GROUND_SKY;
  r.flareSky = SKY_BASE;
  r.lod0 = 1400;
  return r;
}

// ---------------------------------------------------------------- the morph's mirrors (the GLSL's, line for line)

/** The distance's level: k the range the distance stands in, with the next level's morph fraction on top (`ringDistLevel`). */
export function ringDistLevel(d: number, lod0: number, morph: number): number {
  const k = d < lod0 ? 0 : Math.floor(Math.log2(d / lod0)) + 1;
  const r = lod0 * Math.pow(2, k);
  const f = Math.min(Math.max((d - r * (1 - morph)) / (r * morph), 0), 1);
  return k + f;
}

/**
 * The level a distance asks with the finer levels (wave 3b, `ringLevelOf`): r2 the 2 m level's range, r1 the 4 m level's,
 * `finest` the finest level, `mf` the finer levels' own morph share.
 */
export function ringLevelOf(d: number, lod0: number, morph: number, r2: number, r1: number, finest: number, mf: number): number {
  if (finest > -0.5 || d >= r1) return ringDistLevel(d, lod0, morph);
  if (finest > -1.5 || d >= r2) return -1 + Math.min(Math.max((d - r1 * (1 - mf)) / (r1 * mf), 0), 1);
  return -2 + Math.min(Math.max((d - r2 * (1 - mf)) / (r2 * mf), 0), 1);
}

/** The edge's level: bands doubling from `band`, each with a morph of its own over its outer share (`ringEdgeLevel`). */
export function ringEdgeLevel(e: number, band: number, morph: number): number {
  const x = Math.max(e, 0);
  const k = Math.floor(Math.log2(x / band + 1));
  const w = band * Math.pow(2, k);
  const start = band * (Math.pow(2, k) - 1);
  const f = Math.min(Math.max((x - start - w * (1 - morph)) / (w * morph), 0), 1);
  return k + f;
}

/** One axis snapped to a level's lattice from `origin`, toward the lower corner (`ringSnap`). */
export function ringSnap(v: number, origin: number, spacing: number): number {
  return origin + Math.floor((v - origin) / spacing) * spacing;
}

/** One axis of a vertex morphed: the level wanted `w` (held at the node's own), snapped there and moved toward the next by its fraction. */
export function ringMorphAxis(v: number, origin: number, w: number, node: number): number {
  const lw = Math.max(w, node);
  const k = Math.floor(lw);
  const f = lw - k;
  const s = LEAF / PATCH * Math.pow(2, k);
  const a = ringSnap(v, origin, s);
  const b = ringSnap(v, origin, s * 2);
  return a + (b - a) * f;
}

/** The signed Chebyshev distance from a point to the hole's square's edge (negative inside). */
export function ringEdgeDistance(x: number, z: number, sx0: number, sz0: number, sx1: number, sz1: number): number {
  return Math.max(Math.max(sx0 - x, x - sx1), Math.max(sz0 - z, z - sz1));
}

/** How far under the bake a ring vertex stands (`ringDrop`): the full drop at the hole's edge, fading over `fade` metres. */
export function ringDrop(e: number, drop: number, fade: number, everywhere: number): number {
  if (everywhere > 0.5) return drop;
  return drop * Math.min(Math.max(1 - e / fade, 0), 1);
}

/** A point moved in onto the reach, horizontally toward the eye: one axis's factor (`ringReach`), 1 within it. */
export function ringReach(dx: number, dz: number, reach: number): number {
  const r = Math.sqrt(dx * dx + dz * dz);
  return r > reach ? reach / r : 1;
}

/** A heights lattice as the program reads it: its raw-frame origin and step, its samples a side, its samples. */
export interface BakeGrid {
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
  h: ArrayLike<number>;
}

/** One lattice's bilinear at fractional sample (fx, fz), clamped to its extent (`bakeLerp`). */
export function bakeLerp(g: BakeGrid, fx: number, fz: number): number {
  const cx = Math.min(Math.max(fx, 0), g.nx - 1);
  const cz = Math.min(Math.max(fz, 0), g.nz - 1);
  const ix = Math.min(Math.floor(cx), g.nx - 2);
  const iz = Math.min(Math.floor(cz), g.nz - 2);
  const ax = cx - ix;
  const az = cz - iz;
  const at = (i: number, j: number) => g.h[j * g.nx + i];
  const h0 = at(ix, iz) * (1 - ax) + at(ix + 1, iz) * ax;
  const h1 = at(ix, iz + 1) * (1 - ax) + at(ix + 1, iz + 1) * ax;
  return h0 * (1 - az) + h1 * az;
}

/** The bake's height at a raw place: the fine lattice's bilinear inside its extent, the coarse past it (`bakeHeight`). */
export function bakeHeightAt(fine: BakeGrid, coarse: BakeGrid, rx: number, rz: number): number {
  const fx = (rx - fine.x0) / fine.step;
  const fz = (rz - fine.z0) / fine.step;
  if (fx >= 0 && fz >= 0 && fx <= fine.nx - 1 && fz <= fine.nz - 1) return bakeLerp(fine, fx, fz);
  return bakeLerp(coarse, (rx - coarse.x0) / coarse.step, (rz - coarse.z0) / coarse.step);
}

/**
 * What `ringSurfaceAt` reads (a kept record the field fills): the two lattices, the raw frame's centre and the ground's
 * shift, the hole's square in the game's frame (`uHorizonSquare`'s four numbers) and the drop's three.
 */
export interface RingSurface {
  fine: BakeGrid | null;
  coarse: BakeGrid | null;
  cx: number;
  cz: number;
  sx: number;
  sz: number;
  sq0: number;
  sq1: number;
  sq2: number;
  sq3: number;
  drop: number;
  fade: number;
  everywhere: number;
  /**
   * Wave 3b's review: the shape window the vertex stage reads where it holds the ground (null where it does not: the
   * window off, not placed, or no finer level), and its edge fade in force; a vertex's height is then the window's mixed
   * into the bake's by its share (`ringHeightAt`).
   */
  shape: { ringHeight(rx: number, rz: number, bake: number, fade: number): number } | null;
  shapeFade: number;
}

export function newRingSurface(): RingSurface {
  return { fine: null, coarse: null, cx: 0.5, cz: 0.5, sx: 0.5, sz: 0.5, sq0: 0.5, sq1: 0.5, sq2: 0.5, sq3: 0.5, drop: 0.5, fade: 0.5, everywhere: 0.5, shape: null, shapeFade: 16.5 };
}

/** One vertex as the vertex stage stands it unmorphed: the bake there (with the shape window's share, `ringHeightAt`) less the drop at its edge distance. */
function ringVertexHeight(s: RingSurface, vx: number, vz: number): number {
  const rx = s.cx - vx;
  const rz = vz + s.cz;
  const b = bakeHeightAt(s.fine!, s.coarse!, rx, rz);
  const h = s.shape !== null ? s.shape.ringHeight(rx, rz, b, s.shapeFade) : b;
  return h - ringDrop(ringEdgeDistance(vx, vz, s.sq0, s.sq1, s.sq2, s.sq3), s.drop, s.fade, s.everywhere);
}

/**
 * The drawn ring's surface at a game-frame point (§2.9, the far cards' height): the triangle of a level's lattice under it
 * (`q` metres, level 0's 8 by default; the finer levels' 4 and 2 where the far cards stand on them, wave 3b's review), its
 * three vertices each the vertex stage's own unmorphed height (`ringVertexHeight`), split as the patch is (the raw
 * south-west to north-east diagonal, which in the game's frame is the quad's (x + q, z) to (x, z + q)), never the
 * bilinear. NaN with no bake.
 */
export function ringSurfaceAt(s: RingSurface, gx: number, gz: number, q: number = LEAF / PATCH): number {
  if (!s.fine || !s.coarse) return Number.NaN;
  const i = Math.floor((gx - s.sx) / q);
  const j = Math.floor((gz - s.sz) / q);
  const x0 = s.sx + i * q;
  const z0 = s.sz + j * q;
  const u = (gx - x0) / q;
  const v = (gz - z0) / q;
  const h10 = ringVertexHeight(s, x0 + q, z0);
  const h01 = ringVertexHeight(s, x0, z0 + q);
  if (u + v <= 1) {
    const h00 = ringVertexHeight(s, x0, z0);
    return h00 + u * (h10 - h00) + v * (h01 - h00);
  }
  const h11 = ringVertexHeight(s, x0 + q, z0 + q);
  return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
}

/**
 * The rings' hole as the far cards stand on it (W2's review): the stream's chunk and view radius the selection squares the
 * hole round, and the drop's three numbers, kept by the world and written by `ringHoleMoved` as the stream moves. NaN
 * before the stream has run (a card then squares the hole round its own tile, as the first cut did).
 */
export class RingHole {
  // A class, its fields doubles from the start: the stream writes it on every frame (an object literal's fields box).
  pcx = Number.NaN;
  pcz = Number.NaN;
  r = Number.NaN;
  drop = 0.5;
  fade = 0.5;
  everywhere = 0.5;
}

export function newRingHole(): RingHole {
  return new RingHole();
}

/**
 * The hole written for the stream's chunk and radius and the drop in force; answers whether any of it moved, which is when
 * the far cards standing on the ring must be stood again (`FarCards.restand`): one chunk's step moves a card in the drop's
 * band by `drop * 64 / dropFade` (0.63 m at the defaults), and a card over a chunk whose trees are hidden is lifted by the
 * whole drop on the hole's edge. Numbers compared, nothing made.
 */
export function ringHoleMoved(h: RingHole, pcx: number, pcz: number, r: number, t: { drop: number; dropFade: number; dropAt: string }): boolean {
  const everywhere = t.dropAt === 'everywhere' ? 1 : 0;
  if (h.pcx === pcx && h.pcz === pcz && h.r === r && h.drop === t.drop && h.fade === t.dropFade && h.everywhere === everywhere) return false;
  h.pcx = pcx;
  h.pcz = pcz;
  h.r = r;
  h.drop = t.drop;
  h.fade = t.dropFade;
  h.everywhere = everywhere;
  return true;
}

/**
 * A far card's height on the ring (`FarSamples.surfaceAt`): the field's drawn surface round the hole as it stands when the
 * card is placed or stood again, never as it stood when its tile's samples were taken (W2's review: the closure once held
 * the hole of that moment, and a tile built later, or a card after the stream moved, stood up to the whole drop off the
 * drawn ring). The hole read at each call; before the stream has run, squared round the tile's own chunk.
 */
export function ringCardSurface(field: { surfaceAt(gx: number, gz: number, pcx: number, pcz: number, viewRadius: number): number }, hole: RingHole, gx0: number, gz0: number, viewRadius: () => number): (gx: number, gz: number) => number {
  const fx = Math.floor(gx0 / LEAF);
  const fz = Math.floor(gz0 / LEAF);
  return (gx, gz) => field.surfaceAt(gx, gz, hole.pcx === hole.pcx ? hole.pcx : fx, hole.pcz === hole.pcz ? hole.pcz : fz, hole.r === hole.r ? hole.r : viewRadius());
}

// ---------------------------------------------------------------- the hole: which chunks stand

/**
 * The chunks standing round the camera as a toroidal byte grid `2 (radius + 2) + 1` a side, each cell holding the chunk
 * it was written for so a chunk made before an old one is let go never reads as gone: made again only when the radius
 * moves, written by `World.noteChunk`, never a string key.
 */
export class HoleGrid {
  size = 0;
  private cx = new Int32Array(0);
  private cz = new Int32Array(0);
  private on = new Uint8Array(0);
  count = 0;
  resize(radius: number): boolean {
    const n = 2 * (radius + 2) + 1;
    if (n === this.size) return false;
    this.size = n;
    this.cx = new Int32Array(n * n);
    this.cz = new Int32Array(n * n);
    this.on = new Uint8Array(n * n);
    this.count = 0;
    return true;
  }
  clear(): void {
    this.on.fill(0);
    this.count = 0;
  }
  private cell(cx: number, cz: number): number {
    const n = this.size;
    return (((cz % n) + n) % n) * n + (((cx % n) + n) % n);
  }
  set(cx: number, cz: number, standing: boolean): void {
    if (!this.size) return;
    const k = this.cell(cx, cz);
    if (standing) {
      if (!this.on[k] || this.cx[k] !== cx || this.cz[k] !== cz) {
        if (!this.on[k]) this.count++;
        this.on[k] = 1;
        this.cx[k] = cx;
        this.cz[k] = cz;
      }
    } else if (this.on[k] && this.cx[k] === cx && this.cz[k] === cz) {
      this.on[k] = 0;
      this.count--;
    }
  }
  standing(cx: number, cz: number): boolean {
    if (!this.size) return false;
    const k = this.cell(cx, cz);
    return this.on[k] === 1 && this.cx[k] === cx && this.cz[k] === cz;
  }
}

// ---------------------------------------------------------------- the leaves' min/max pyramid

/**
 * The heights a node's vertices can take, by level: base cells one leaf (64 m) on the leaves' lattice from game
 * (`x0`, `z0`), `n` a side, each the least and most bake sample within it and a step round it (`horizonDecode.ts` makes
 * it), and each level above a cell's four. NaN where no bake stands: such a node is not drawn.
 */
export interface MinMaxPyramid {
  /** The base cells' game corner (on the leaves' lattice: a multiple of 64·2^levels from the shift). */
  x0: number;
  z0: number;
  n: number;
  levels: number;
  lo: Float32Array[];
  hi: Float32Array[];
}

// ---------------------------------------------------------------- the selection

/** What the selection reads beside the frustum: the eye, the reach, the hole and the knobs in force. */
export interface RingAsk {
  ex: number;
  ey: number;
  ez: number;
  reach: number;
  lod0: number;
  levels: number;
  morph: number;
  edgeBand: number;
  drop: number;
  /** The leaves' lattice origin (the ground's shift). */
  shiftX: number;
  shiftZ: number;
  /** The hole's square in chunk indices, inclusive, and in the game frame. */
  cx0: number;
  cz0: number;
  cx1: number;
  cz1: number;
  /** Wave 3b: the finest level (nought, minus one or minus two), the 4 m and 2 m levels' ranges, and the frustum box's growth for the 2 m heights. */
  finest: number;
  r1: number;
  r2: number;
  pad: number;
}

/** Per level, how many patches the last selection drew. */
export const LEVEL_COUNT = LEVELS_MOST + 1;

/**
 * The CDLOD selection over kept stacks: `select` writes the patches (node corner x, z, level, 0) and the skirts (leaf
 * corner x, z, 0, side + 1: 1 south, 2 east, 3 north, 4 west, the side toward a standing chunk) into the kept arrays and
 * answers how many patches. Pure of the scene: a frustum, a hole, an eye and a reach, so Light and shadow can run it
 * again against the sun's box with a hole of its own (§2.8).
 */
export class RingSelector {
  patches: Float32Array;
  skirts: Float32Array;
  patchCount = 0;
  skirtCount = 0;
  /** Patches the arrays had no room for (never expected: the arrays are sized past §2.4's counts). */
  overflow = 0;
  readonly perLevel = new Int32Array(LEVEL_COUNT);
  /** Wave 3b: patches of the finer levels, the 4 m level's then the 2 m level's. */
  readonly perFine = new Int32Array(2);
  /** Leaves left out because their chunk stands. */
  holeLeaves = 0;
  private stackI = new Int32Array(4096);
  private stackJ = new Int32Array(4096);
  private stackL = new Int8Array(4096);
  private readonly box = new THREE.Box3();
  // Wave h6a: room for the widest finer levels (a 2,048 window's 2 m level and a 4 m bake's 4 m level at their tops, about
  // 20,000 patches in a ground view), the instance buffer 512 KB.
  constructor(patchCap = 32768, skirtCap = 8192) {
    this.patches = new Float32Array(patchCap * 4);
    this.skirts = new Float32Array(skirtCap * 4);
  }
  get patchCap(): number {
    return this.patches.length >> 2;
  }
  get skirtCap(): number {
    return this.skirts.length >> 2;
  }

  select(frustum: THREE.Frustum, a: RingAsk, pyr: MinMaxPyramid | null, hole: HoleGrid): number {
    this.patchCount = 0;
    this.skirtCount = 0;
    this.holeLeaves = 0;
    this.overflow = 0;
    this.perLevel.fill(0);
    this.perFine.fill(0);
    if (!pyr) return 0;
    const top = Math.min(a.levels - 1, pyr.levels - 1, LEVELS_MOST);
    const S = LEAF * (1 << top);
    const R = a.reach;
    const i0 = Math.floor((a.ex - R - a.shiftX) / S);
    const i1 = Math.floor((a.ex + R - a.shiftX) / S);
    const j0 = Math.floor((a.ez - R - a.shiftZ) / S);
    const j1 = Math.floor((a.ez + R - a.shiftZ) / S);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let sp = 0;
        this.stackI[0] = i;
        this.stackJ[0] = j;
        this.stackL[0] = top;
        sp = 1;
        while (sp > 0) {
          sp--;
          const ni = this.stackI[sp];
          const nj = this.stackJ[sp];
          const L = this.stackL[sp];
          // A node finer than a leaf (wave 3b) is a power-of-two share of one: its size by a division, never a shift of a negative.
          const size = L >= 0 ? LEAF * (1 << L) : LEAF / (1 << -L);
          const x0 = a.shiftX + ni * size;
          const z0 = a.shiftZ + nj * size;
          const x1 = x0 + size;
          const z1 = z0 + size;
          // Wholly past the reach: nothing of it stands.
          const hx = Math.max(x0 - a.ex, 0, a.ex - x1);
          const hz = Math.max(z0 - a.ez, 0, a.ez - z1);
          if (hx * hx + hz * hz > R * R) continue;
          // The heights its vertices take (a node finer than a leaf: its leaf's); none baked there, none drawn.
          const pl = L > 0 ? L : 0;
          const n = pyr.n >> pl;
          const psize = LEAF * (1 << pl);
          const pi = Math.floor((x0 - pyr.x0) / psize);
          const pj = Math.floor((z0 - pyr.z0) / psize);
          if (pi < 0 || pj < 0 || pi >= n || pj >= n) continue;
          const lo = pyr.lo[pl][pj * n + pi];
          const hi = pyr.hi[pl][pj * n + pi];
          if (!(lo <= hi)) continue;
          const yl = lo - a.drop;
          // The 2 m heights stand off the bake's samples: the frustum's box grown for them (never the range's).
          this.box.min.set(x0, yl - a.pad, z0);
          this.box.max.set(x1, hi + a.pad, z1);
          if (!frustum.intersectsBox(this.box)) continue;
          const meets = a.cx0 * LEAF + a.shiftX <= x1 && (a.cx1 + 1) * LEAF + a.shiftX >= x0 && a.cz0 * LEAF + a.shiftZ <= z1 && (a.cz1 + 1) * LEAF + a.shiftZ >= z0;
          if (L <= 0) {
            // A leaf whose chunk stands is left out; one finer than a leaf is inside a leaf already found standing nowhere.
            if (L === 0 && ni >= a.cx0 && ni <= a.cx1 && nj >= a.cz0 && nj <= a.cz1 && hole.standing(ni, nj)) {
              this.holeLeaves++;
              continue;
            }
            if (L > a.finest) {
              // The finer levels' split (wave 3b): by range alone, from level 0 at the 4 m level's range and from the 4 m
              // level at the 2 m level's.
              const dy = Math.max(yl - a.ey, 0, a.ey - hi);
              const r = L === 0 ? a.r1 : a.r2;
              if (hx * hx + hz * hz + dy * dy < r * r) {
                if (sp + 4 > this.stackI.length) this.growStack();
                const ci = ni * 2;
                const cj = nj * 2;
                for (let q = 0; q < 4; q++) {
                  this.stackI[sp] = ci + (q & 1);
                  this.stackJ[sp] = cj + (q >> 1);
                  this.stackL[sp] = L - 1;
                  sp++;
                }
                continue;
              }
            }
            this.emitPatch(x0, z0, L);
            if (meets) {
              // A side on its leaf's own edge, with a standing chunk across it, takes a skirt (a leaf's every side).
              const k = L < 0 ? -L : 0;
              const li = ni >> k;
              const lj = nj >> k;
              const top = (1 << k) - 1;
              const mi = ni - (li << k);
              const mj = nj - (lj << k);
              if (mj === 0 && hole.standing(li, lj - 1)) this.emitSkirt(x0, z0, L, 1);
              if (mi === top && hole.standing(li + 1, lj)) this.emitSkirt(x0, z0, L, 2);
              if (mj === top && hole.standing(li, lj + 1)) this.emitSkirt(x0, z0, L, 3);
              if (mi === 0 && hole.standing(li - 1, lj)) this.emitSkirt(x0, z0, L, 4);
            }
            continue;
          }
          let split = meets;
          if (!split) {
            const dy = Math.max(yl - a.ey, 0, a.ey - hi);
            const d2 = hx * hx + hz * hz + dy * dy;
            const r = a.lod0 * (1 << (L - 1));
            if (d2 < r * r) split = true;
          }
          if (!split) {
            // The edge's whole level at the node's nearest point to the square (`ringEdgeLevel`'s band, written out: a
            // number handed back from a call the compiler leaves out is a number made): a node coarser than it is split.
            // Its morph share never reaches one inside its own band, so the whole level is the band's.
            const gap = Math.max(Math.max(a.cx0 * LEAF + a.shiftX - x1, x0 - ((a.cx1 + 1) * LEAF + a.shiftX)), Math.max(a.cz0 * LEAF + a.shiftZ - z1, z0 - ((a.cz1 + 1) * LEAF + a.shiftZ)));
            const ex = gap > 0 ? gap : 0;
            const ek = Math.floor(Math.log2(ex / a.edgeBand + 1));
            if (L > ek) split = true;
          }
          if (!split) {
            this.emitPatch(x0, z0, L);
            continue;
          }
          if (sp + 4 > this.stackI.length) this.growStack();
          const ci = ni * 2;
          const cj = nj * 2;
          for (let q = 0; q < 4; q++) {
            this.stackI[sp] = ci + (q & 1);
            this.stackJ[sp] = cj + (q >> 1);
            this.stackL[sp] = L - 1;
            sp++;
          }
        }
      }
    }
    return this.patchCount;
  }

  private growStack(): void {
    const n = this.stackI.length * 2;
    const i = new Int32Array(n);
    i.set(this.stackI);
    const j = new Int32Array(n);
    j.set(this.stackJ);
    const l = new Int8Array(n);
    l.set(this.stackL);
    this.stackI = i;
    this.stackJ = j;
    this.stackL = l;
  }

  private emitPatch(x0: number, z0: number, L: number): void {
    const k = this.patchCount;
    if (k >= this.patchCap) {
      this.overflow++;
      return;
    }
    const p = this.patches;
    p[k * 4] = x0;
    p[k * 4 + 1] = z0;
    p[k * 4 + 2] = L;
    p[k * 4 + 3] = 0;
    this.patchCount++;
    if (L >= 0) this.perLevel[L]++;
    else this.perFine[-L - 1]++;
  }

  private emitSkirt(x0: number, z0: number, L: number, side: number): void {
    const k = this.skirtCount;
    if (k >= this.skirtCap) {
      this.overflow++;
      return;
    }
    const s = this.skirts;
    s[k * 4] = x0;
    s[k * 4 + 1] = z0;
    s[k * 4 + 2] = L;
    s[k * 4 + 3] = side;
    this.skirtCount++;
  }
}

/**
 * The camera's frustum, built the reversed-aware way (`docs/REVERSED-DEPTH.md`), into a kept frustum and matrix: three's
 * `setFromProjectionMatrix` planes in three's own order and arithmetic (row 3 plus or less a row, or the depth row alone
 * for a reversed far plane, made unit as `Plane.normalize` makes it), written out here because its six `setComponents`
 * calls hand their numbers across a call (the portal flood measured 320 bytes a frame through it). Only integers cross
 * `lookPlane`.
 */
export function cameraFrustum(camera: THREE.PerspectiveCamera, m: THREE.Matrix4, out: THREE.Frustum): THREE.Frustum {
  m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = m.elements;
  const p = out.planes;
  lookPlane(p[0], e, 1, 0, -1);
  lookPlane(p[1], e, 1, 0, 1);
  lookPlane(p[2], e, 1, 1, 1);
  lookPlane(p[3], e, 1, 1, -1);
  if (camera.reversedDepth) {
    lookPlane(p[4], e, 0, 2, 1);
    lookPlane(p[5], e, 1, 2, -1);
  } else {
    lookPlane(p[4], e, 1, 2, -1);
    lookPlane(p[5], e, 1, 2, 1);
  }
  return out;
}

/** A plane of a column-major matrix: `base` times row 3 plus `sign` times row `row`, made unit. */
function lookPlane(plane: THREE.Plane, e: ArrayLike<number>, base: number, row: number, sign: number): void {
  const x = base * e[3] + sign * e[row];
  const y = base * e[7] + sign * e[4 + row];
  const z = base * e[11] + sign * e[8 + row];
  const w = base * e[15] + sign * e[12 + row];
  const inv = 1.0 / Math.sqrt(x * x + y * y + z * z);
  const n = plane.normal;
  n.x = x * inv;
  n.y = y * inv;
  n.z = z * inv;
  plane.constant = w * inv;
}
