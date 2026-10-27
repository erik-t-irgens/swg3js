// The colour wash of ours a real-elevation world's ground takes where nothing is painted (Map-maker II, DESIGN.md §2.5).
//
// A converted world's ground is tinted by the client's colour map, which its colour affectors paint, and the tint is the
// client's main breaker of the 4 m repeat. A real-elevation world has no generator and so no colour map: its samples are
// white, and the tint has nothing to vary the ground by. The wash is a colour map made from the raster itself: a base colour,
// bands by height and slope laid over it in order by the client's own replace-with-amount (`replaceColour`, the colour
// affectors' arithmetic), and a slow variation from the generator's own fractal at a scale of metres. It is a pure function
// of the place, its height and its slope, so the chunks, the far tiles and a map made from them agree, and a sculpt stroke
// rewrites it with everything else. **Absent, the colour is white as today**; every number of it is the owner's, the world
// row's own fields (`groundPaint({ world: { wash } })`, the Tools tab's sliders).
//
// Heights are metres above sea level, as a real-elevation world's rules read them (the raster's lift taken back off), so a
// wash survives a re-cut of the same place. Pure: imports only the generator's colour arithmetic and its fractal. Rule for
// this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties.

import { replaceColour } from '../swg/terrain/generator.ts';
import { MultiFractal } from '../swg/terrain/fractal.ts';

/** One band laid over the base where its height and slope hold: its colour (bytes) and how much of it. */
export interface WashBand {
  /** Metres above sea level it starts at and stops at; absent, no bound that way. */
  above?: number;
  below?: number;
  /** Degrees of slope it starts at and stops at; absent, no bound that way. */
  slopeAbove?: number;
  slopeBelow?: number;
  colour: [number, number, number];
  amount: number;
}

/** A wash: its base colour (bytes), its bands in order, and its slow variation. */
export interface WashSpec {
  base: [number, number, number];
  bands?: WashBand[];
  /** The variation: metres a feature, how far it moves each channel (a share of a byte's full range either way), its seed. */
  noise?: { scale: number; amount: number; seed?: number };
}

/** The most bands a wash holds (a backstop). */
export const WASH_BANDS_MOST = 16;

const byte = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;
const rgbOf = (v: unknown): [number, number, number] | null => (Array.isArray(v) && v.length === 3 && v.every(byte) ? [v[0], v[1], v[2]] : null);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A wash read from a paint file's world row, or why not. */
export function readWash(v: unknown): WashSpec | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a wash is { base, bands, noise }';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'base' && k !== 'bands' && k !== 'noise') return `it carries ${k}, which this build does not read`;
  const base = rgbOf(o.base);
  if (!base) return 'its base is three bytes [r, g, b]';
  const out: WashSpec = { base };
  if (o.bands !== undefined) {
    if (!Array.isArray(o.bands) || o.bands.length > WASH_BANDS_MOST) return `its bands are a list of at most ${WASH_BANDS_MOST}`;
    out.bands = [];
    for (const b of o.bands) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) return 'a band is an object';
      const r = b as Record<string, unknown>;
      for (const k of Object.keys(r)) if (!['above', 'below', 'slopeAbove', 'slopeBelow', 'colour', 'amount'].includes(k)) return `a band carries ${k}, which this build does not read`;
      const colour = rgbOf(r.colour);
      if (!colour) return "a band's colour is three bytes [r, g, b]";
      if (!finite(r.amount) || r.amount < 0 || r.amount > 1) return "a band's amount is a number from 0 to 1";
      const band: WashBand = { colour, amount: r.amount };
      for (const k of ['above', 'below', 'slopeAbove', 'slopeBelow'] as const) {
        if (r[k] === undefined) continue;
        if (!finite(r[k])) return `a band's ${k} is a number`;
        band[k] = r[k] as number;
      }
      out.bands.push(band);
    }
  }
  if (o.noise !== undefined) {
    const n = o.noise as Record<string, unknown> | null;
    if (!n || typeof n !== 'object' || Array.isArray(n)) return 'its noise is { scale, amount, seed }';
    if (!finite(n.scale) || n.scale <= 0 || n.scale > 100000) return "its noise's scale is metres above nought";
    if (!finite(n.amount) || n.amount < 0 || n.amount > 1) return "its noise's amount is a number from 0 to 1";
    const noise: { scale: number; amount: number; seed?: number } = { scale: n.scale, amount: n.amount };
    if (n.seed !== undefined) {
      if (typeof n.seed !== 'number' || !Number.isInteger(n.seed)) return "its noise's seed is a whole number";
      noise.seed = n.seed;
    }
    for (const k of Object.keys(n)) if (k !== 'scale' && k !== 'amount' && k !== 'seed') return `its noise carries ${k}, which this build does not read`;
    out.noise = noise;
  }
  return out;
}

/** A wash made ready to be asked: its spec and its fractal, kept (a sample makes nothing). */
export class Wash {
  readonly spec: WashSpec;
  private readonly fractal: MultiFractal | null;
  private readonly amount: number;

  constructor(spec: WashSpec) {
    this.spec = spec;
    const n = spec.noise;
    if (n && n.amount > 0) {
      const f = new MultiFractal();
      f.setSeed(n.seed ?? 1);
      f.setScale(1 / n.scale);
      f.setNumberOfOctaves(3);
      f.setFrequency(2);
      f.setAmplitude(0.5);
      this.fractal = f;
      this.amount = n.amount;
    } else {
      this.fractal = null;
      this.amount = 0;
    }
  }

  /** The wash's base as the ground's tint reads its reference (each channel and the luminance over 0..1, Rec. 709's weights). */
  get reference(): { rgb: [number, number, number]; luminance: number } {
    const b = this.spec.base;
    const rgb: [number, number, number] = [b[0] / 255, b[1] / 255, b[2] / 255];
    return { rgb, luminance: rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 };
  }

  /**
   * The wash's colour at a place of the raw frame (`x`, `z`), its height in metres above sea level and its slope in degrees,
   * as three bytes into `out`: the base, each band whose bounds hold laid over it in order by replace-with-amount, then the
   * variation added to every channel alike and held to a byte.
   */
  colourAt(x: number, z: number, elevation: number, slope: number, out: Uint8Array): void {
    const s = this.spec;
    out[0] = s.base[0];
    out[1] = s.base[1];
    out[2] = s.base[2];
    const bands = s.bands;
    if (bands) {
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        if (b.above !== undefined && elevation < b.above) continue;
        if (b.below !== undefined && elevation > b.below) continue;
        if (b.slopeAbove !== undefined && slope < b.slopeAbove) continue;
        if (b.slopeBelow !== undefined && slope > b.slopeBelow) continue;
        replaceColour(out, 0, b.colour[0], b.colour[1], b.colour[2], b.amount);
      }
    }
    if (this.fractal) {
      const d = Math.round((this.fractal.value2(x, z) - 0.5) * 2 * this.amount * 255);
      for (let k = 0; k < 3; k++) {
        const v = out[k] + d;
        out[k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
}
