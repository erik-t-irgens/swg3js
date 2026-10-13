// How a leaf card is cut, as arithmetic: the JavaScript mirror of what the card rule's shader does to a card's
// alpha (`cardRule.ts`), and what decides it. Pure: no three, no DOM, so a node test can sweep it.
//
// **The client drew two kinds of leaf** (measured over every planted card): `a_punchout`, opaque, depth
// written and clipped at half the texture's alpha -- our cut exactly -- and `a_alpha`, blended with no depth
// write and nothing cut but what is clear. Which one a card is comes from its effect, never its name (the
// converter writes it as `extras.swgCard.blend`); the name suffix agrees on all but two of the 329 card
// shaders and stands in until a pack carries the class.
//
// **A blended card cannot be blended here**: an instanced forest cannot be sorted, so it is cut at half like a
// cut-out. Near, that keeps the client's amount of leaf (0.270 of the card's texels against a mean alpha of
// 0.266). Down the mips, though, a cut thins it where blending would not: the box filter averages a leaf's
// edge with the clear texels round it and the average falls under the cut, so a crown at 320 m kept 0.83 of
// the client's leaf on the trees measured. So a blended card's alpha is raised by how far down the chain the
// texture is sampled, `a × (1 + k × lod)`, which at k = 0.1 (ours, a measured fit) keeps trees within 0.99 to
// 1.03 of the client's crown from 10 to 320 m and changes nothing at mip 0. A cut-out's own chain keeps its
// coverage in ours and the client's alike, so it takes no scale (`mipScalePunch`, 0).
//
// **The level is the texture's own**: half the log of the larger squared footprint of a screen pixel in texels,
// from the screen derivatives of the texture coordinate times the texture's size -- what the hardware picks
// a level by, to within its own approximations. The floor sits **inside** the log: GLSL ES 3.00 leaves log2
// undefined at or below nought, and a NaN alpha draws a clear texel that the effects' NaN pass cannot see.

/** A card's class: what the client drew it as, and where that came from. */
export type CardClass = 'blend' | 'punch';

/** The numbers the card rule cuts and scales by (`CARD_TUNE`'s alpha part). */
export interface CardAlphaTune {
  /** The cut on cards the client drew `a_punchout`: the client's own half. */
  cutPunch: number;
  /** The cut on cards the client blended: ours, measured to match near. */
  cutBlend: number;
  /** How much a blended card's alpha is raised a mip level: ours, a measured fit. */
  mipScale: number;
  /** The same for cut-outs: nought, since their own chain keeps their coverage. */
  mipScalePunch: number;
}

/** The floor inside the level's log: the larger squared footprint is never taken under this. */
export const LOD_FLOOR = 1e-12;

/** The cut a card of this class is drawn at: the punch-out's for a cut-out and for a card of no known class. */
export function cardCut(cls: CardClass | null, t: CardAlphaTune): number {
  return cls === 'blend' ? t.cutBlend : t.cutPunch;
}

/** How much a card of this class has its alpha raised a mip level: none for a card of no known class. */
export function cardMipScale(cls: CardClass | null, t: CardAlphaTune): number {
  if (cls === 'blend') return t.mipScale;
  if (cls === 'punch') return t.mipScalePunch;
  return 0;
}

/**
 * The texture level a pixel samples: half the log of the larger squared footprint, in texels, of one screen pixel
 * across and one down (`dx`, `dy`: the screen derivatives of the texture coordinate times the texture's size).
 * Exactly the shader's `0.5 * log2( max( max( dot( dx, dx ), dot( dy, dy ) ), 1e-12 ) )`.
 */
export function cardLod(dxu: number, dxv: number, dyu: number, dyv: number): number {
  const a = dxu * dxu + dxv * dxv;
  const b = dyu * dyu + dyv * dyv;
  return 0.5 * Math.log2(Math.max(Math.max(a, b), LOD_FLOOR));
}

/** A card's alpha raised by its level: `min(1, a × (1 + k × max(0, lod)))`, the identity at k nought or a level of nought or less. */
export function scaledAlpha(a: number, k: number, lod: number): number {
  return Math.min(1, a * (1 + k * Math.max(0, lod)));
}

/** Whether a card's texel is kept: its scaled alpha against its class's cut. */
export function cardKeeps(a: number, cls: CardClass | null, lod: number, t: CardAlphaTune): boolean {
  return scaledAlpha(a, cardMipScale(cls, t), lod) >= cardCut(cls, t);
}

/**
 * A card's class from its shader's name, the stand-in until a pack carries the class (`cardClass: 'names'`):
 * blended when the name says `_aa<n>` anywhere (the art's suffix for `a_alpha`, kept by the `_aa7_phong1`
 * variants too), a cut-out otherwise. Right on 327 of the 329 retail card shaders; the two it gets wrong are
 * `leaf_dath_rinor_aa7.sht` (a cut-out) and `kashyyk_floor_cone_flower_as8.sht` (blended).
 */
export function classByName(shader: string): CardClass {
  return /_aa\d/i.test(shader) ? 'blend' : 'punch';
}
