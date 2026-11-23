// His looks' pictures in the game, the pure half (the GPU port's pass 2, wave 4b, maker A; the design's 2.10 and 3, way 1):
// which look a place wears by the Save to game (`bodiesFile.ts`), the key its baked pictures are kept under, what the bake
// hands back (`LookPictures`, the read-back of the viewer's `generatedPixels`), and the sky card's disc picture made from it
// on the main thread. The bake itself is the WebGPU side's (`lookBake.ts`, reached through the runtime, `GPU.rt.looks`); the
// space planets and the galaxy map's globes read the same pictures (`GpuLooks` in `src/core/gpuSwitch.ts`, and the note
// `A:\swg3js\port\scratch\p2w4b-makerA\API.md`).
//
// **What a place wears**: its look by the file's `uses` when that look is a generated one (recipe, seed and dials: numbers
// every player's game bakes alike); a look of shipped photos alone, or a place the file does not name, wears SWG's picture.
// His imported pictures never reach the game's file (the viewer sends their generated twins), so a build without anything
// private shows the twins or SWG's pictures and asks for nothing of his.
//
// **The pictures' rows**: as the bake's target holds them and a `DataTexture` (flipY false) samples them, row 0 the south pole
// (the bake's v = 0, latitude -90°), the last row the north; a row runs west to east from longitude -180° (u = 0) through 0
// (u = 0.5, the +z side of the body) to +180°. `surface` is sRGB colour with the shine in alpha; `clouds` the clouds'
// brightness with their cover in alpha (null for a look with no clouds on).
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension, no three,
// nothing that touches the page at load.

import { BakeCache } from '../bodies/bakeCache.ts';
import { SKY_BODIES, type BodyLook } from './bodiesFile.ts';

/**
 * The bakes' sizes (feel is not in them; memory is): each start's reason beside it.
 *   - **skySize: 1024.** A body in a ground sky is a few degrees across (Naboo from Rori about 7°, Tatooine's moon 2°), so a
 *     1024 by 512 bake (its disc picture at 512) holds more texels than its disc ever covers on a 1440p screen, and keeps a
 *     sky body near the design's 8 MB (2.10: the bake's surface and clouds read back, 4 MB, its disc 1.4 MB with mips).
 *   - **spaceSize: 2048.** A planet from orbit fills the screen: the design's 2048 by 1024 (33 MB on the card with its relief and
 *     clouds), which Ultra keeps until measured.
 *   - **discSize: 512.** The sky card's picture (`discPicture`): the disc's 471-texel diameter at the card's 0.92 fill.
 */
export const LOOK_BAKE_TUNE = { skySize: 1024, spaceSize: 2048, discSize: 512 };

/** The bake sizes a look may ask for (generate.js's `SIZES`' widths; the height is half). */
export const LOOK_SIZES = [1024, 2048, 4096] as const;

/** How a look's pictures were had (the bake cache's words). */
export type LookHow = 'memo' | 'stored' | 'baked';

/** A look's baked pictures, read back (the viewer's `generatedPixels`), as the API hands them. */
export interface LookPictures {
  /** The look's id in the file. */
  readonly id: string;
  /** The bake cache's key (the look's numbers, its size and whether it has clouds). */
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /** RGBA8, `width × height`, row 0 the south pole: sRGB colour, the shine in alpha. */
  readonly surface: Uint8Array;
  /** RGBA8 likewise: the clouds' brightness, their cover in alpha; null where the look has no clouds on. */
  readonly clouds: Uint8Array | null;
  readonly how: LookHow;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether a look of the file is one the game can bake (a generated look: its recipe, seed and dials). */
export function bakeable(look: BodyLook | null | undefined): boolean {
  const g = look?.generated;
  return !!g && typeof g.recipe === 'string' && !!g.recipe && Number.isFinite(Number(g.seed)) && isObj(g.dials);
}

/** Whether a look shows clouds (its clouds layer on): the bake then makes its clouds picture too. */
export function lookHasClouds(look: BodyLook | null | undefined): boolean {
  const c = look?.layers?.clouds;
  return !!c && c.on === true;
}

/** The size a look is baked at for a use: its own size at most, the use's at most, never under the smallest. */
export function lookBakeSize(look: BodyLook, most: number): number {
  const own = Number(look.generated?.size) || 2048;
  let size = own < most ? own : most;
  if (!(LOOK_SIZES as readonly number[]).includes(size)) size = LOOK_SIZES[0];
  return size;
}

/**
 * The key a look's pictures are kept under: the bake cache's (`look:v<n>:<hash>`) over the look's generated numbers, its size
 * and its clouds, so the same numbers find the same bake in any session and a moved dial bakes again.
 */
export function lookPicturesKey(look: BodyLook, size: number, clouds: boolean): string {
  return BakeCache.keyOf('look', JSON.stringify([look.generated, size, clouds]));
}

/** The look a place wears by the file and can be baked, with its id; null where SWG's picture stands (no file, no use, not generated). */
export function lookOfPlace(placeId: string): { id: string; look: BodyLook } | null {
  const f = SKY_BODIES.file;
  const id = f?.uses[placeId];
  if (!f || !id) return null;
  const look = f.looks[id];
  return look && bakeable(look) ? { id, look } : null;
}

/**
 * A ground sky's place id for one of its cards, as the viewer's places name them (`src/sky/system/places.js`): the sky's id,
 * then `moon`, `moon2` or `celestial:<picture>` (with `#n` for the second and later of one picture).
 */
export function skyPlaceId(sky: string, slot: 'moon' | 'moon2' | 'celestial', file: string, nth = 1): string {
  if (slot !== 'celestial') return `${sky}:${slot}`;
  const f = String(file).toLowerCase();
  const name = f.slice(Math.max(f.lastIndexOf('/'), f.lastIndexOf('\\')) + 1).replace(/\.[a-z0-9]+$/, '');
  return `${sky}:celestial:${name}${nth > 1 ? '#' + nth : ''}`;
}

/** The viewer's sky id for a game world (its zone): Kashyyyk's sky is `kashyyyk_main`, Hoth's heroic `hoth`. */
export function viewerSkyOf(world: string): string {
  return world === 'kashyyyk' ? 'kashyyyk_main' : world === 'adventure2' ? 'hoth' : world;
}

// ---------------------------------------------------------------- the sky card's disc picture

/** A surface layer's colour controls (the viewer's `adjust` in build.js: replace, hue, saturation, contrast, brightness, tint). */
interface LayerTone {
  hue: number;
  sat: number;
  contrast: number;
  bright: number;
  tint: [number, number, number];
  opacity: number;
}

function hexSRGB(hex: unknown, out: [number, number, number]): [number, number, number] {
  const s = typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ffffff';
  const n = parseInt(s.slice(1), 16);
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
  return out;
}

function toneOf(L: Record<string, unknown> | undefined): LayerTone {
  const num = (v: unknown, d: number): number => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  return {
    hue: (num(L?.hue, 0) * Math.PI) / 180,
    sat: num(L?.sat, 1),
    contrast: num(L?.contrast, 1),
    bright: num(L?.bright, 1),
    tint: hexSRGB(L?.tint, [1, 1, 1]),
    opacity: num(L?.opacity, 1),
  };
}

/**
 * Three's TSL `hue` and `saturation` (in gamma space, as build.js's `adjust` runs them), on one colour in place: the hue turned
 * about the grey axis by Rodrigues' formula, the saturation a mix from the luminance.
 */
function toneInPlace(c: [number, number, number], t: LayerTone): void {
  if (t.hue !== 0) {
    const k = 0.57735;
    const cosA = Math.cos(t.hue);
    const sinA = Math.sin(t.hue);
    const d = (c[0] + c[1] + c[2]) * k;
    const x = c[0];
    const y = c[1];
    const z = c[2];
    // v cos a + (k × v) sin a + k (k · v)(1 − cos a)
    const cx = k * z - k * y;
    const cy = k * x - k * z;
    const cz = k * y - k * x;
    c[0] = x * cosA + cx * sinA + k * d * (1 - cosA);
    c[1] = y * cosA + cy * sinA + k * d * (1 - cosA);
    c[2] = z * cosA + cz * sinA + k * d * (1 - cosA);
  }
  if (t.sat !== 1) {
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    c[0] = l + (c[0] - l) * t.sat;
    c[1] = l + (c[1] - l) * t.sat;
    c[2] = l + (c[2] - l) * t.sat;
  }
  for (let i = 0; i < 3; i++) {
    let v = (c[i] - 0.5) * t.contrast + 0.5;
    v = v > 0 ? v : 0;
    c[i] = v * t.bright * t.tint[i];
  }
}

/**
 * One layer of a look's lat-long bake toned in place as the look's layer tones it (`discPicture`'s rule, its alpha kept): the
 * space planets and the map's globes wear it so, as the sky's discs do (the fixer of pass 2, wave 4b; maker C's ask). Answers
 * the layer's opacity (the clouds' cover is laid times it).
 */
export function toneLayer(px: Uint8Array, look: BodyLook, layer: 'surface' | 'clouds'): number {
  const t = toneOf(look.layers?.[layer] as Record<string, unknown> | undefined);
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    c[0] = px[i] / 255;
    c[1] = px[i + 1] / 255;
    c[2] = px[i + 2] / 255;
    toneInPlace(c, t);
    for (let ch = 0; ch < 3; ch++) {
      const v = c[ch] > 1 ? 1 : c[ch] < 0 ? 0 : c[ch];
      px[i + ch] = Math.round(v * 255);
    }
  }
  return t.opacity;
}

/**
 * A look's lat-long picture as one opaque picture (a space planet's): its surface toned, its clouds toned and laid over by
 * their cover times the cloud layer's opacity, as `discPicture` lays them; the bake's pictures are left as they were.
 */
export function layLatLong(pics: LookPictures, look: BodyLook): Uint8Array {
  const n = pics.width * pics.height;
  const out = pics.surface.slice();
  toneLayer(out, look, 'surface');
  const cl = pics.clouds && lookHasClouds(look) ? pics.clouds.slice() : null;
  const op = cl ? toneLayer(cl, look, 'clouds') : 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (cl) {
      const a0 = (cl[o + 3] / 255) * op;
      const a = a0 > 1 ? 1 : a0 < 0 ? 0 : a0;
      out[o] = Math.round(out[o] * (1 - a) + cl[o] * a);
      out[o + 1] = Math.round(out[o + 1] * (1 - a) + cl[o + 1] * a);
      out[o + 2] = Math.round(out[o + 2] * (1 - a) + cl[o + 2] * a);
    }
    out[o + 3] = 255;
  }
  return out;
}

/** One RGBA8 texel of a lat-long picture, bilinear, wrapping in longitude and clamped at the poles, into `out` (0 to 1). */
function sampleLL(px: Uint8Array, w: number, h: number, u: number, v: number, out: [number, number, number, number]): void {
  const x = u * w - 0.5;
  const y = v * h - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const xa = ((x0 % w) + w) % w;
  const xb = (xa + 1) % w;
  const ya = y0 < 0 ? 0 : y0 >= h ? h - 1 : y0;
  const yb = y0 + 1 < 0 ? 0 : y0 + 1 >= h ? h - 1 : y0 + 1;
  for (let ch = 0; ch < 4; ch++) {
    const a = px[(ya * w + xa) * 4 + ch];
    const b = px[(ya * w + xb) * 4 + ch];
    const c = px[(yb * w + xa) * 4 + ch];
    const d = px[(yb * w + xb) * 4 + ch];
    out[ch] = ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) / 255;
  }
}

/** What the disc picture is made with. */
export interface DiscOptions {
  /** The picture's side, texels (`LOOK_BAKE_TUNE.discSize`). */
  size: number;
  /** The disc's share of the picture's half width (the card's `BODY_TUNE.discFill`, so the lit sphere reads it where it stands). */
  fill: number;
  /** The longitude facing the eye, degrees (0: the bake's middle, u = 0.5). */
  faceLonDeg: number;
  /** The body's tilt on the card, degrees about the line of sight (the look's own `adjust.tilt`). */
  tiltDeg: number;
}

/**
 * The sky card's picture of a look: the sphere seen face on (an orthographic view, north up, `faceLonDeg` toward the eye),
 * its surface toned as the look's surface layer tones it and its clouds laid over by their cover, the disc `fill` of the
 * picture's half width, RGBA8 with sRGB colour in rgb and the disc's coverage in alpha (1 inside, a texel's edge soft, 0
 * outside), row 0 the bottom (a `DataTexture`'s, flipY false). The card's sphere reads a pixel at `0.5 + n.xy · fill / 2` for a
 * point of normal `n` (x right, y up, z toward the eye), which is where this puts it. Run once a body behind the loading screen.
 */
export function discPicture(pics: LookPictures, look: BodyLook, o: DiscOptions): Uint8Array {
  const S = o.size;
  const out = new Uint8Array(S * S * 4);
  const surfTone = toneOf(look.layers?.surface as Record<string, unknown> | undefined);
  const cloudL = look.layers?.clouds as Record<string, unknown> | undefined;
  const cloudTone = toneOf(cloudL);
  const clouds = pics.clouds && lookHasClouds(look) ? pics.clouds : null;
  const tilt = (o.tiltDeg * Math.PI) / 180;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const face = (o.faceLonDeg * Math.PI) / 180;
  const cf = Math.cos(face);
  const sf = Math.sin(face);
  const r = 0.5 * o.fill;
  const edge = 1 / (r * S);
  const s4: [number, number, number, number] = [0, 0, 0, 0];
  const c4: [number, number, number, number] = [0, 0, 0, 0];
  const col: [number, number, number] = [0, 0, 0];
  const cc: [number, number, number] = [0, 0, 0];
  const TAU = Math.PI * 2;
  for (let row = 0; row < S; row++) {
    const vy = ((row + 0.5) / S - 0.5) / r;
    for (let x = 0; x < S; x++) {
      const vx = ((x + 0.5) / S - 0.5) / r;
      const q = vx * vx + vy * vy;
      const rho = Math.sqrt(q);
      const i = (row * S + x) * 4;
      if (rho > 1 + edge) continue;
      const cover = rho <= 1 - edge ? 1 : (1 + edge - rho) / (2 * edge);
      // The normal in the card's frame, the point held to the rim at the soft edge.
      const nx = rho > 1 ? vx / rho : vx;
      const ny = rho > 1 ? vy / rho : vy;
      const nz = rho >= 1 ? 0 : Math.sqrt(1 - q);
      // Untilt about the line of sight, then into the body's frame: +z toward the eye is longitude `face`, y north.
      const bx = nx * ct + ny * st;
      const by = -nx * st + ny * ct;
      const bz = nz;
      const dx = bx * cf + bz * sf;
      const dz = -bx * sf + bz * cf;
      const lon = Math.atan2(dx, dz);
      const lat = Math.asin(by > 1 ? 1 : by < -1 ? -1 : by);
      const u = lon / TAU + 0.5;
      const v = lat / Math.PI + 0.5;
      sampleLL(pics.surface, pics.width, pics.height, u, v, s4);
      col[0] = s4[0];
      col[1] = s4[1];
      col[2] = s4[2];
      toneInPlace(col, surfTone);
      if (clouds) {
        sampleLL(clouds, pics.width, pics.height, u, v, c4);
        cc[0] = c4[0];
        cc[1] = c4[1];
        cc[2] = c4[2];
        toneInPlace(cc, cloudTone);
        const a = c4[3] * cloudTone.opacity;
        const k = a > 1 ? 1 : a < 0 ? 0 : a;
        col[0] = col[0] * (1 - k) + cc[0] * k;
        col[1] = col[1] * (1 - k) + cc[1] * k;
        col[2] = col[2] * (1 - k) + cc[2] * k;
      }
      for (let ch = 0; ch < 3; ch++) {
        const vv = col[ch] > 1 ? 1 : col[ch] < 0 ? 0 : col[ch];
        out[i + ch] = Math.round(vv * 255);
      }
      out[i + 3] = Math.round(cover * 255);
    }
  }
  return out;
}

/** What `__debug.sky({ looks: true })` says of the looks worn on this screen (the world's report fills it). */
export const LOOKS_WORN: { worn: Record<string, unknown>[]; at: string } = { worn: [], at: '' };
