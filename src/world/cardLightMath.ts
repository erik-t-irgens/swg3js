// The client's light on a leaf card, as arithmetic: the JavaScript mirror the card light's shader must equal
// (`cardLight.ts`), as `gradeMath.ts` is for the grade. Pure: no three, no DOM.
//
// **What the client drew** (read: its card programs and their shared lighting functions, described in our
// words). The vertex stage hands the pixel stage the stored normal untouched and a light sum of the scene's
// ambient, the material's emissive, two plain parallel lights by Lambert and the point lights; the main light
// is left out of it. The pixel stage takes `d`, the normal's dot with the sun, and works the main light out as
// the tangent colour, plus `d × (front − tangent)` when `d ≥ 0`, plus `|d| × (back − tangent)` when `d < 0`; it
// adds the vertex sum, saturates each channel and multiplies the texture. So a face toward the sun shows the
// front colour, one edge-on the tangent colour all across the terminator, and one turned right away the back
// colour, where three's Lambert falls to black past the terminator: the "dark faces" the owner saw.
//
// **The colours** are rows of the area's colour ramp at the hour's column, the ones `SwgSky` already reads: by
// our converter's own note (no source) row 1 the front, 9 the tangent, 8 the back, 0 the ambient, 3 and 4 the
// two plain parallel lights, 7 a shadow colour. Row 9 as the tangent is supported by its hue, which follows the
// sun's rather than the sky's on 39 of the 50 distinct ground ramps (measured); row 8 cannot be told apart.
// The registers held the ramp's bytes over 255 (inferred). Rows 3 and 4 are not black everywhere: row 3 is lit
// at noon on 14 of 50 ramps, row 4 on 8, all of Endor among them.
//
// **The curve** is the other half (`'client'`): the client showed `texel × light` straight on the screen, and
// our frame goes through a grade and three's ACES fit, which crushes a dark leaf to a quarter of it. So a card's
// colour is the client's displayed value carried back through that fit: sRGB to linear, the output matrix
// inverted, the fit solved per channel (a quadratic), the input matrix inverted, times 0.6 (three's own scale
// inside the fit). Exact to the byte with the grade off; with each world's grade on, within 4.3 bytes of
// brightness everywhere, the hue moving with the grade's own mood. The inverse of a display of 1 is a scene value
// of 15.4, which would bloom, so a card's scene luminance is held under `bloomCap` (0.84, just under the bloom
// pass's 0.85).

/** One RGB triple, plain numbers. */
export type Rgb = [number, number, number];

/** Which ramp rows feed the card's colours: our converter's note (row 9 supported by its hue). */
export interface CardRows {
  front: number;
  tangent: number;
  back: number;
  ambient: number;
  fill: number;
  bounce: number;
  /** The row the `'row7'` shadow look blends a shaded card toward. */
  shadow: number;
}

export const CARD_ROWS_DEFAULT: Readonly<CardRows> = { front: 1, tangent: 9, back: 8, ambient: 0, fill: 3, bounce: 4, shadow: 7 };

/** The card light's knobs (`CARD_LIGHT_TUNE`): every one ours unless its comment says otherwise. */
export interface CardLightTune {
  /** The card light at all: false is three's light on cards. */
  on: boolean;
  /** `'client'`: the client's displayed value through our curve; `'scene'`: the client's ramp in linear light at today's sunlit level. */
  curve: 'client' | 'scene';
  /** Which ramp rows feed the colours (read live by the sky). */
  rows: CardRows;
  /** `'bytes'`: the rows as their bytes; `'alpha'`: each times our reading of its alpha (4 × (a − 128) / 128). Unknowable which (check 1(a)). */
  rampScale: 'bytes' | 'alpha';
  /** `'both'`: rows 3 and 4 both added by Lambert inside the sum (the client's sum); `'fill'` row 3 only; `'none'` neither. */
  fills: 'both' | 'fill' | 'none';
  /** Adds the material's emissive inside the sum (the client's). */
  emissive: boolean;
  /** Multiplies the light before the client's saturate. */
  gain: number;
  /** The exposure the inversion assumes, so the exposure slider still moves cards. */
  exposureRef: number;
  /** The most scene luminance a card may carry: just under the bloom pass's threshold. */
  bloomCap: number;
  /** `'self'`: no shadow from the leaf's own crown (the owner's answer 3); `'all'`: every shadow, as before; `'none'`: card meshes of trees that cast receive nothing. */
  shadow: 'self' | 'all' | 'none';
  /** `'rise'`: a shaded leaf keeps the tangent colour (the shadow takes the sunward rise); `'row7'`: blended toward ramp row 7 by its alpha, an inferred reading of the client's own resolve. */
  shadowLook: 'rise' | 'row7';
  /** How dark any shadow a leaf still takes is. */
  share: number;
  /** The skip's floor, in texels of each cascade, against the leaf's own acne. */
  acne: number;
  /** `'cards'`: a crown is the box of its card vertices; `'model'` its whole model's. Load-time. */
  box: 'cards' | 'model';
  /** Lights trunks and branches with the same sum as well (the client did); load-time, and they then lose the crown's shadow. */
  bark: boolean;
  /** `'face'`: the sum reads the normal the mirror turned toward the viewer (each face takes the sun on its own side; the owner's answer 13); `'stored'`: the client's one normal per card. */
  sunSide: 'face' | 'stored';
  /** How far the torch, the flash pool and the room lights take a leaf's own face in place of its normal (0 its normal, 1 its face). */
  pointFlat: number;
}

/** The ramp's colours a card is lit by, as bytes over 255 (the registers' reading), with the shadow row's alpha. */
export interface CardColours {
  front: Rgb;
  tangent: Rgb;
  back: Rgb;
  ambient: Rgb;
  fill: Rgb;
  bounce: Rgb;
  shadow: Rgb;
  shadowAlpha: number;
}

// ---------------------------------------------------------------- the colour spaces (three's own formulas)

/** sRGB-encoded 0..1 to linear, three's `SRGBToLinear`. */
export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** Linear to sRGB-encoded 0..1, three's `LinearToSRGB` (and its shader's `sRGBTransferOETF`). */
export function linearToSrgb(c: number): number {
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
}

// ---------------------------------------------------------------- three's ACES fit, both ways

/** Three's ACES input matrix, by rows (`out = MI × in`): its shader's columns transposed. */
export const ACES_IN: readonly (readonly number[])[] = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
/** Three's ACES output matrix, by rows. */
export const ACES_OUT: readonly (readonly number[])[] = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];

function inverse3(m: readonly (readonly number[])[]): number[][] {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** The two matrices inverted, by rows: what the shader's inverse is written with. */
export const ACES_IN_INV: readonly (readonly number[])[] = inverse3(ACES_IN);
export const ACES_OUT_INV: readonly (readonly number[])[] = inverse3(ACES_OUT);

const mul3 = (m: readonly (readonly number[])[], v: readonly number[], out: number[]): number[] => {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  out[0] = m[0][0] * x + m[0][1] * y + m[0][2] * z;
  out[1] = m[1][0] * x + m[1][1] * y + m[1][2] * z;
  out[2] = m[2][0] * x + m[2][1] * y + m[2][2] * z;
  return out;
};

/** Three's RRT and ODT fit, one channel. */
export function acesFit(v: number): number {
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
}

/** The fit solved for its input, one channel: the larger root of its quadratic, for an output held to 0..1. */
export function acesFitInverse(y: number): number {
  const yy = Math.min(1, Math.max(0, y));
  const A = 1 - 0.983729 * yy;
  const B = 0.0245786 - 0.432951 * yy;
  const C = -(0.000090537 + 0.238081 * yy);
  return (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
}

/** Three's ACES filmic at an exposure: scene-linear in, display-linear (0..1) out. */
export function acesForward(rgb: Rgb, exposure = 1): Rgb {
  const t = [0, 0, 0];
  mul3(ACES_IN, [(rgb[0] * exposure) / 0.6, (rgb[1] * exposure) / 0.6, (rgb[2] * exposure) / 0.6], t);
  const f = [acesFit(t[0]), acesFit(t[1]), acesFit(t[2])];
  const o = [0, 0, 0];
  mul3(ACES_OUT, f, o);
  return [Math.min(1, Math.max(0, o[0])), Math.min(1, Math.max(0, o[1])), Math.min(1, Math.max(0, o[2]))];
}

/** Three's ACES filmic carried back: a display-linear colour to the scene value that shows it at exposure 1. Fed clamped values only. */
export function acesInverse(display: Rgb): Rgb {
  const v = [0, 0, 0];
  mul3(ACES_OUT_INV, [Math.min(1, Math.max(0, display[0])), Math.min(1, Math.max(0, display[1])), Math.min(1, Math.max(0, display[2]))], v);
  const f = [acesFitInverse(v[0]), acesFitInverse(v[1]), acesFitInverse(v[2])];
  const x = [0, 0, 0];
  mul3(ACES_IN_INV, f, x);
  return [Math.max(0, x[0] * 0.6), Math.max(0, x[1] * 0.6), Math.max(0, x[2] * 0.6)];
}

// ---------------------------------------------------------------- the client's sum

/** What lights one pixel of a card, besides its colours: `d` the normal's dot with the sun, the shadow factor the cascades let through, the fills' own dots, the emissive. */
export interface CardPixel {
  d: number;
  shadow: number;
  fillDot: number;
  bounceDot: number;
  emissive: Rgb;
}

/**
 * The client's light on one pixel (`g`), each channel held to 0..1: the ambient, the emissive, the two plain
 * parallel lights by Lambert, and the main light by the ramp about the sun's axis, the sunward rise scaled by
 * the shadow under `'rise'` (the client had no shadow maps; the rise is the part a shadow takes away), all
 * times `gain` inside the saturate.
 */
export function clientLight(c: CardColours, p: CardPixel, t: Pick<CardLightTune, 'fills' | 'emissive' | 'gain' | 'shadowLook'>, out: Rgb = [0, 0, 0]): Rgb {
  const d = Math.min(1, Math.max(-1, p.d));
  const rise = t.shadowLook === 'row7' ? 1 : p.shadow;
  const fill = t.fills === 'none' ? 0 : Math.max(p.fillDot, 0);
  const bounce = t.fills === 'both' ? Math.max(p.bounceDot, 0) : 0;
  const em = t.emissive ? 1 : 0;
  for (let k = 0; k < 3; k++) {
    const main = d >= 0 ? c.tangent[k] + (c.front[k] - c.tangent[k]) * d * rise : c.tangent[k] + (c.back[k] - c.tangent[k]) * -d;
    const sum = c.ambient[k] + em * p.emissive[k] + c.fill[k] * fill + c.bounce[k] * bounce + main;
    out[k] = Math.min(1, Math.max(0, sum * t.gain));
  }
  return out;
}

/** The client's displayed value of a card pixel, sRGB-encoded 0..1: its texel times its light, with the `'row7'` look's blend toward the shadow row. */
export function clientDisplay(texel: Rgb, g: Rgb, c: CardColours, shadow: number, look: CardLightTune['shadowLook'], out: Rgb = [0, 0, 0]): Rgb {
  for (let k = 0; k < 3; k++) {
    let v = Math.min(1, Math.max(0, texel[k] * g[k]));
    if (look === 'row7') v = v + (c.shadow[k] - v) * c.shadowAlpha * (1 - shadow);
    out[k] = v;
  }
  return out;
}

/** Linear luminance, Rec. 709. */
export function luminance(rgb: Rgb): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** A scene colour scaled down whole where its luminance passes the cap: what a card may hand the bloom pass. */
export function capBloom(rgb: Rgb, cap: number): Rgb {
  const l = luminance(rgb);
  if (l > cap && l > 0) {
    const s = cap / l;
    return [rgb[0] * s, rgb[1] * s, rgb[2] * s];
  }
  return rgb;
}

/** The scene colour a card pixel is drawn with under the `'client'` curve: its displayed value carried back through the fit, over the exposure it assumes, under the cap. */
export function clientScene(display: Rgb, t: Pick<CardLightTune, 'exposureRef' | 'bloomCap'>): Rgb {
  const lin: Rgb = [srgbToLinear(display[0]), srgbToLinear(display[1]), srgbToLinear(display[2])];
  const x = acesInverse(lin);
  const e = Math.max(t.exposureRef, 1e-3);
  return capBloom([x[0] / e, x[1] / e, x[2] / e], t.bloomCap);
}

/** What a scene colour shows on the screen with the grade off: three's fit at an exposure, then sRGB, as 0..1. */
export function displayOf(scene: Rgb, exposure = 1): Rgb {
  const d = acesForward(scene, exposure);
  return [linearToSrgb(d[0]), linearToSrgb(d[1]), linearToSrgb(d[2])];
}

// ---------------------------------------------------------------- the two faces and our own lights

/** A unit vector, or the zero vector for a degenerate one (never a NaN). */
function unit(v: readonly number[]): Rgb {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
}

/**
 * The client's stored normal back out of a mirrored one and the plane it was reflected through, as the card
 * rule's vertex line works it out: the plane's bytes normalised (nought kept nought, never `normalize` of
 * nought), then `n − 2(n·p)p`.
 */
export function storedNormal(normal: readonly number[], plane: readonly number[]): Rgb {
  const p = unit(plane);
  const d = 2 * (normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2]);
  return [normal[0] - d * p[0], normal[1] - d * p[1], normal[2] - d * p[2]];
}

/** The sum's `d` under a side rule: the drawn (mirrored) normal's dot with the sun under `'face'`, the stored normal's under `'stored'`. */
export function sideDot(side: CardLightTune['sunSide'], drawn: readonly number[], stored: readonly number[], sun: readonly number[]): number {
  const n = unit(side === 'stored' ? stored : drawn);
  return n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2];
}

/**
 * The normal our own lights (the torch, the flash pool, the room lights) see on a card: the drawn normal blended
 * toward the card's own face by `k`, normalised, and the face itself where the blend comes to nothing (a normal
 * exactly opposite the face at a half, the one case).
 */
export function pointFlatNormal(normal: readonly number[], face: readonly number[], k: number, out: Rgb = [0, 0, 0]): Rgb {
  const t = Math.min(1, Math.max(0, k));
  const m = [normal[0] + (face[0] - normal[0]) * t, normal[1] + (face[1] - normal[1]) * t, normal[2] + (face[2] - normal[2]) * t];
  const l = Math.hypot(m[0], m[1], m[2]);
  if (l > 1e-4) {
    out[0] = m[0] / l;
    out[1] = m[1] / l;
    out[2] = m[2] / l;
  } else {
    const f = unit(face);
    out[0] = f[0];
    out[1] = f[1];
    out[2] = f[2];
  }
  return out;
}

/** A GLSL float literal of a number, with enough digits that the shader's constants are the mirror's. */
export function glslNumber(v: number): string {
  const s = v.toPrecision(9);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** A GLSL `mat3` from a matrix by rows (GLSL takes columns). */
export function glslMat3(m: readonly (readonly number[])[]): string {
  const col = (j: number) => `vec3( ${glslNumber(m[0][j])}, ${glslNumber(m[1][j])}, ${glslNumber(m[2][j])} )`;
  return `mat3( ${col(0)}, ${col(1)}, ${col(2)} )`;
}
