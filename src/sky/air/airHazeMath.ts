// The haze's arithmetic (the GPU port's pass 2, wave 1; the design's 2.2), pure, so the node tests run it as the game runs it
// and the graphs of `airHaze.ts` and `airSee.ts` are built from these very rules.
//
// How a pixel is hazed on WebGPU with our sky. Every draw into the effects' scene target writes, beside its colour and its
// motion, a third output, the see-through layer (`see`, RGBA16F, cleared to (0, 0, 0, 1)):
//   - **a solid thing** (a material three does not blend) writes its colour as ever and in the layer (0, 0, 0, ±1), the sign
//     minus in a building's rooms pass (`roomSign`), so a solid pixel of a room is known by its layer's sign;
//   - **a see-through thing** three blends normally or additively writes nought into the colour with its own alpha, so the
//     colour behind it is kept times one less its alpha (normal) or as it was (additive), and its own light into the layer,
//     premultiplied, blended over what the layer holds (`SEE_BLENDS`): the layer's colour is then every see-through thing's
//     light as the colour target would have blended it, and its alpha's size what of the solid behind gets through them;
//   - **a see-through thing of another blend** (multiply, subtract, a custom rule that is neither) keeps its colour as ever
//     and adds nothing to the layer: it is hazed with the solid behind it, the one place this is not exact.
// Each see-through thing hazes itself at its own distance first (the scene's one fog node, `hazeFogNode`). So the haze pass
// (`GpuHazePass`) takes each pixel as the solid behind (`c`, the colour target, already times what the see-through things let
// through) and the layer (`s`): `c · T + L · |s.a| + s.rgb`, with `T` and `L` the air's at the solid's own distance (the haze
// volume to 24 km, the sky view past it), `|s.a|` the solid's light the see-through things let through, so the air in front of
// the solid is added under them and never over them; a pixel of the sky (nothing drawn: the depth's clear) is `c + s.rgb`, and a
// room's solid pixel seen from inside its building too. A smoke in front of a far ridge is therefore hazed at its own distance,
// never at the ridge's.

import * as THREE from 'three';

/** How a material's draw goes into the see-through layer, read off the fields three keys its pipeline on. */
export type SeeKind =
  /** Not blended: writes its colour, and ±1 into the layer's alpha. */
  | 'solid'
  /** Blended over (`src · a + dst · (1 − a)`), straight alpha: nought into the colour, `rgb · a` into the layer. */
  | 'over'
  /** Blended over, its colour already times its alpha (three's premultiplied alpha, or a custom rule of one and one less alpha). */
  | 'overPremultiplied'
  /** Added (`src · a + dst`), straight: the colour kept, `rgb · a` added into the layer. */
  | 'add'
  /** Added whole (`src + dst`). */
  | 'addPremultiplied'
  /** Any other blend: its colour as three blends it, nothing into the layer. */
  | 'keep';

/** Three's own rule for whether it blends a material's colour (`motion.ts`'s `seeThrough`, `createRenderPipeline`'s). */
export function blends(m: { blending: number; transparent?: boolean }): boolean {
  return m.blending !== THREE.NoBlending && (m.blending !== THREE.NormalBlending || m.transparent !== false);
}

/** The fields of a material the see-through layer reads (all of them in three's pipeline key). */
export interface SeeFields {
  blending: number;
  transparent?: boolean;
  premultipliedAlpha?: boolean;
  blendSrc?: number;
  blendDst?: number;
  blendEquation?: number;
  colorWrite?: boolean;
}

/** How a material's draw goes into the layer (`SeeKind`). A material writing no colour is solid: it writes nothing anyway. */
export function seeKindOf(m: SeeFields): SeeKind {
  if (!blends(m as { blending: number; transparent?: boolean })) return 'solid';
  const pre = m.premultipliedAlpha === true;
  if (m.blending === THREE.NormalBlending) return pre ? 'overPremultiplied' : 'over';
  if (m.blending === THREE.AdditiveBlending) return pre ? 'addPremultiplied' : 'add';
  if (m.blending === THREE.CustomBlending && (m.blendEquation ?? THREE.AddEquation) === THREE.AddEquation) {
    const src = m.blendSrc ?? THREE.SrcAlphaFactor;
    const dst = m.blendDst ?? THREE.OneMinusSrcAlphaFactor;
    if (dst === THREE.OneMinusSrcAlphaFactor && src === THREE.SrcAlphaFactor) return 'over';
    if (dst === THREE.OneMinusSrcAlphaFactor && src === THREE.OneFactor) return 'overPremultiplied';
    if (dst === THREE.OneFactor && src === THREE.SrcAlphaFactor) return 'add';
    if (dst === THREE.OneFactor && src === THREE.OneFactor) return 'addPremultiplied';
  }
  return 'keep';
}

/**
 * Pass 3, wave 2 (maker B): the own field of a material that draws at infinity (a star, the Milky Way's band, a belt, a sky
 * body's card, SWG's painted halo beside it). Its light goes into the colour as three blends it and never into the see-through
 * layer, so it is part of the sky BEHIND the clouds, which the clouds' composite dims by what gets through the cloud (wave 1
 * laid the layer back over the cloud undimmed: bodies, stars and belts showed through a full overcast). An own field, never
 * `userData`: three's render-object key walks a material's own keys (`RenderObject.getMaterialCacheKey`, `userData` left out),
 * so a flagged draw keys its graph and pipeline apart from an unflagged one of the same fields.
 */
export const SKY_BEHIND = 'swgSkyBehind';

/** Marks a material as drawn at infinity, behind the clouds (`SKY_BEHIND`). Returns it. */
export function markSkyBehind<M extends object>(m: M): M {
  (m as Record<string, unknown>)[SKY_BEHIND] = true;
  return m;
}

/**
 * How a material's draw goes into the see-through layer (what `airSee.ts`' outputs and the layer's blend read): its blend's
 * kind (`seeKindOf`), save that a blended draw marked at infinity (`SKY_BEHIND`) is `keep` (its colour as three blends it,
 * nothing into the layer). The haze's own rule for a see-through thing still reads its blend's kind (`seeKindOf`).
 */
export function layerKindOf(m: SeeFields): SeeKind {
  const k = seeKindOf(m);
  return k !== 'solid' && (m as { swgSkyBehind?: unknown }).swgSkyBehind === true ? 'keep' : k;
}

/** Whether a kind's own light goes into the layer (and nought into the colour), or into the colour as ever. */
export function intoLayer(k: SeeKind): boolean {
  return k === 'over' || k === 'overPremultiplied' || k === 'add' || k === 'addPremultiplied';
}

/** Whether a kind's light is its colour times its alpha (straight) or its colour as it stands (premultiplied, or not blended). */
export function timesAlpha(k: SeeKind): boolean {
  return k === 'over' || k === 'add';
}

/** Whether a kind covers what is behind it (blends over), so the layer's alpha takes one less its alpha. */
export function covers(k: SeeKind): boolean {
  return k === 'over' || k === 'overPremultiplied';
}

/**
 * A see-through thing hazed at its own distance (`hazeFogNode`'s rule), into `out` [r, g, b], from its colour `rgb` (as it
 * leaves its material, before any premultiplying), the air's transmittance `t` and added light `l` [r, g, b] at its distance:
 *   - covering (over): its light is what gets through plus the air in front, `rgb · t + l` (the blend then takes its alpha);
 *   - added: light only, so only what gets through, `rgb · t`;
 *   - any other (a multiply): faded toward no effect at all, `1 − (1 − rgb) · t`;
 *   - solid: `rgb · t + l`, which only a solid hazing itself takes (Effects off, or a scene target with no layer).
 */
export function hazeOwnIn(kind: SeeKind, rgb: ArrayLike<number>, t: number, l: ArrayLike<number>, out: Float64Array | number[]): void {
  for (let i = 0; i < 3; i++) {
    if (kind === 'add' || kind === 'addPremultiplied') out[i] = rgb[i] * t;
    else if (kind === 'keep') out[i] = 1 - (1 - rgb[i]) * t;
    else out[i] = rgb[i] * t + l[i];
  }
}

/**
 * One pixel of the haze pass, into `out` [r, g, b]: `c` the colour target (the solid behind, times what see-through things let
 * through), `s` the layer [r, g, b, a], `t` and `l` the air's at the solid's distance; `hazed` false for the sky and a room's
 * solid pixel from inside its building, which take `c + s.rgb` alone.
 */
export function hazePixelIn(c: ArrayLike<number>, s: ArrayLike<number>, t: number, l: ArrayLike<number>, hazed: boolean, out: Float64Array | number[]): void {
  const through = Math.abs(s[3]);
  for (let i = 0; i < 3; i++) out[i] = hazed ? c[i] * t + l[i] * through + s[i] : c[i] + s[i];
}

/**
 * The same pixel drawn the old way, every layer straight into one colour (a reference for the test): `solid` the solid
 * behind (its own light), then each see-through layer in draw order, each hazed at its own distance (`hazeOwnIn`) and blended
 * as three would. The haze pass of the layer must equal this wherever no `keep` kind is drawn.
 */
export function referencePixelIn(
  solid: ArrayLike<number>,
  solidT: number,
  solidL: ArrayLike<number>,
  hazed: boolean,
  layers: readonly { kind: SeeKind; rgb: ArrayLike<number>; a: number; t: number; l: ArrayLike<number> }[],
  out: Float64Array | number[],
): void {
  const own = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = hazed ? solid[i] * solidT + solidL[i] : solid[i];
  for (const ly of layers) {
    hazeOwnIn(ly.kind, ly.rgb, ly.t, ly.l, own);
    for (let i = 0; i < 3; i++) {
      // The light the layer leaves: straight kinds times their alpha; three's premultiplied alpha multiplies after the fog.
      const src = ly.kind === 'keep' ? own[i] : own[i] * ly.a;
      if (ly.kind === 'over' || ly.kind === 'overPremultiplied') out[i] = src + out[i] * (1 - ly.a);
      else if (ly.kind === 'add' || ly.kind === 'addPremultiplied') out[i] = src + out[i];
      else out[i] = out[i] * own[i];
    }
  }
}

/**
 * The layer and colour target a stack of see-through draws leaves over a solid, as the GPU's blends would (a reference for
 * the test, and the rule `SEE_BLENDS` writes): into `c` [r, g, b] (starting as the solid's own light) and `s` [r, g, b, a]
 * (starting at (0, 0, 0, ±1), the solid's write).
 */
export function layerStackIn(
  layers: readonly { kind: SeeKind; rgb: ArrayLike<number>; a: number; t: number; l: ArrayLike<number> }[],
  c: Float64Array | number[],
  s: Float64Array | number[],
): void {
  const own = [0, 0, 0];
  for (const ly of layers) {
    hazeOwnIn(ly.kind, ly.rgb, ly.t, ly.l, own);
    if (ly.kind === 'over' || ly.kind === 'overPremultiplied') {
      // Colour: nought times its alpha plus what is there times one less it. Layer: its light plus what is there times one
      // less its alpha, and its alpha's size likewise.
      for (let i = 0; i < 3; i++) {
        c[i] = c[i] * (1 - ly.a);
        s[i] = own[i] * ly.a + s[i] * (1 - ly.a);
      }
      s[3] = s[3] * (1 - ly.a);
    } else if (ly.kind === 'add' || ly.kind === 'addPremultiplied') {
      for (let i = 0; i < 3; i++) s[i] = own[i] * ly.a + s[i];
    } else {
      for (let i = 0; i < 3; i++) c[i] = c[i] * own[i];
    }
  }
}

// ---------------------------------------------------------------- distances

/** The view distance (metres, along the view's axis) a depth texel stands for, three's perspective, reversed or not. */
export function viewZOfDepth(d: number, near: number, far: number, reversed: boolean): number {
  return reversed ? (near * far) / (near + d * (far - near)) : (near * far) / (far - d * (far - near));
}

/** Whether a depth texel is the clear: nothing solid was drawn there (the sky). */
export function isSkyDepth(d: number, reversed: boolean): boolean {
  return reversed ? d <= 0 : d >= 1;
}

/**
 * The distance from the eye (metres) of a point at view depth `z` seen at normalised device place (`nx`, `ny`), for a view
 * whose half-extents at unit depth are `tx` and `ty` (`tanHalfFov`): the ray's length to that depth.
 */
export function rayDistance(z: number, nx: number, ny: number, tx: number, ty: number): number {
  const x = nx * tx;
  const y = ny * ty;
  return z * Math.sqrt(1 + x * x + y * y);
}

/**
 * The haze past the volume's reach (`HAZE_REACH_M`), into `out` [r, g, b, t]: at the reach the volume's `l` and `t`; past it
 * the transmittance falls on at the reach's own rate, `t^(d / reach)`, and the added light goes on toward the sky view's
 * radiance in that direction (`sky`) as the light behind it is lost, `l + (sky − l) · (1 − t' / t)`, which is the reach's at
 * the reach and the sky itself at an endless distance. Nearer than the reach it is the volume's as it stands.
 */
export function hazeBeyondIn(d: number, reach: number, l: ArrayLike<number>, t: number, sky: ArrayLike<number>, out: Float64Array | number[]): void {
  if (!(d > reach) || !(t > 0)) {
    out[0] = l[0];
    out[1] = l[1];
    out[2] = l[2];
    out[3] = d > reach ? 0 : t;
    return;
  }
  const tt = Math.pow(t, d / reach);
  const lost = 1 - tt / t;
  for (let i = 0; i < 3; i++) out[i] = l[i] + (sky[i] - l[i]) * lost;
  out[3] = tt;
}
