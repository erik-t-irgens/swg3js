// A map picture made from a real-elevation world's own raster (Map-maker II, DESIGN.md §2.10, its eighth wave): the world
// has no converted map, so its map window, its minimap and its city line had nothing to draw. Made in the browser, never
// committed, a few rows at a time on frames the world is in, and made again a moment after a height, paint or water edit
// lands, so the map shows what the owner made.
//
// **Each pixel** is a game point: the pixel's middle as a share of the picture, to the map's own frame (`mapShareX/Y`
// inverted over the frame `{ width: size, x: 0, z: 0 }`), to the game's (`mapFromGameX/Z` about (0, 0), the raw frame of a
// real-elevation world). There: the ground's own height (the world's `heightAt`, the raster through `makeDemPatch` with the
// sculpt's edits on it), the ground's own colour (`groundColour`: the family the chunks would draw there as its picture's mean
// colour, or the planet's palette where the world draws no family), shaded by a light from `sunAz`/`sunEl` over the height's
// slope at `shade` (flat ground keeps its colour), and **its water**, the planet's level and every lake and river of ours,
// drawn wherever its surface stands over the ground there, in `waterColour` (the planet's own water colour when it is
// unset) unless a lake names its own look's colour.
//
// **The frame trap** (`demTerrain.ts`): a raster's north is the game's -Z, and the map draws the raw frame with +Z up and x
// mirrored, so a picture made through the game's own frame is right against every dot and shows real north at the bottom,
// where the minimap's north mark already puts the game's north on those worlds. Told, not changed.
//
// **The slicing**: `step(budgetMs)` makes whole rows while a frame's budget lasts (a row's cost measured as it goes, so the
// next is not begun past the budget), and a slice is `sliceRows` rows, so a picture is `px / sliceRows` slices however
// many frames they take. Heights are worked out a row ahead of the colours, since the shade reads each pixel's neighbours.
// The buffers are made once a picture and let go with it; it is a 2D canvas's, so no GPU program.
//
// Pure (no three, no page): a node test makes a picture of a synthetic raster through the very `makeDemPatch`. Rule for this
// file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no constructor
// parameter properties.

/** The made picture's numbers, all ours and live through `__debug.locations({ map: { tune } })`, which makes it again. */
export const MAP_PICTURE_TUNE = {
  /** Pixels across (and down): 16 m a pixel on a 16 km world, as the client's own maps. */
  px: 1024,
  /** Rows a slice: a picture is `px / sliceRows` slices. */
  sliceRows: 32,
  /** The most a frame of making spends, milliseconds (a row is never begun past it). */
  sliceMs: 2,
  /** How long after an edit lands the picture is made again, milliseconds: a held stroke makes it once, after. */
  debounceMs: 2000,
  /** The light, degrees: its bearing clockwise from the picture's top (315: the cartographer's top left) and its height. */
  sunAz: 315,
  sunEl: 45,
  /** How much the slope's light moves a pixel's colour: 0 flat, 1 the light's whole. */
  shade: 0.6,
  /** The water's colour, "#rrggbb"; empty: the planet's own water colour. */
  waterColour: '',
};

/** Move any of those, each held to something that makes sense; the answer is the table as it stands. */
export function tuneMapPicture(o: Partial<typeof MAP_PICTURE_TUNE>): typeof MAP_PICTURE_TUNE {
  const t = MAP_PICTURE_TUNE as Record<string, number | string>;
  for (const k of Object.keys(MAP_PICTURE_TUNE) as (keyof typeof MAP_PICTURE_TUNE)[]) {
    const v = o[k];
    if (k === 'waterColour') {
      if (typeof v === 'string' && (v === '' || /^#[0-9a-f]{6}$/i.test(v))) t[k] = v.toLowerCase();
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (k === 'px') t[k] = Math.max(16, Math.min(4096, Math.round(v)));
    else if (k === 'sliceRows') t[k] = Math.max(1, Math.round(v));
    else if (k === 'shade') t[k] = Math.max(0, Math.min(1, v));
    else if (k === 'sunEl') t[k] = Math.max(1, Math.min(90, v));
    else t[k] = k === 'sunAz' ? v : Math.max(0, v);
  }
  return MAP_PICTURE_TUNE;
}

/** What a picture is made of: the world's ground and water at game points. Each answer is written, never handed back as a record. */
export interface DemMapSource {
  /** Metres the raster spans, both ways, about the raw frame's (0, 0). */
  size: number;
  /** The ground's height at a game point. */
  heightAt(gx: number, gz: number): number;
  /** The ground's own colour at a game point (and its height), sRGB bytes into `out`. */
  groundColour(gx: number, gz: number, h: number, out: Uint8Array): void;
  /** The water's surface at a game point, -Infinity where none stands. */
  waterAt(gx: number, gz: number): number;
  /** A lake of ours's own look's colour at a game point, sRGB bytes into `out`: false where none is named there. */
  waterColour(gx: number, gz: number, out: Uint8Array): boolean;
  /** The planet's own water colour, 0xRRGGBB. */
  planetWater: number;
}

/** A picture being made: its pixels (RGBA), its rows' heights, how far it has come and what it cost. */
export class DemMapMaker {
  readonly px: number;
  readonly size: number;
  /** RGBA, row 0 the picture's top. */
  readonly data: Uint8ClampedArray;
  private readonly heights: Float32Array;
  /** Rows whose heights are in, and rows coloured. */
  private heightRows = 0;
  row = 0;
  /** Slices finished, and frames that made any. */
  slices = 0;
  frames = 0;
  /** The most a frame of making took, and all of it, milliseconds. */
  worstMs = 0;
  totalMs = 0;
  private readonly src: DemMapSource;
  private readonly tune: typeof MAP_PICTURE_TUNE;
  private readonly col = new Uint8Array(3);
  private readonly water = new Uint8Array(3);
  private readonly sun = { x: 0, y: 1, z: 0 };
  /** A row's cost, measured as it went: the next is not begun when it would pass the budget. */
  private rowMs = 0;
  private readonly now: () => number;

  constructor(src: DemMapSource, tune: typeof MAP_PICTURE_TUNE = MAP_PICTURE_TUNE, now: () => number = () => performance.now()) {
    this.src = src;
    this.tune = tune;
    this.now = now;
    this.px = Math.max(16, Math.round(tune.px));
    this.size = src.size;
    this.data = new Uint8ClampedArray(this.px * this.px * 4);
    this.heights = new Float32Array(this.px * this.px);
    // The light in the game's frame: a bearing clockwise from the picture's top, the picture's +x the map's +x (the game's -x).
    const az = (tune.sunAz * Math.PI) / 180;
    const el = (tune.sunEl * Math.PI) / 180;
    const mx = Math.sin(az);
    const mz = Math.cos(az);
    this.sun.x = -mx * Math.cos(el);
    this.sun.z = mz * Math.cos(el);
    this.sun.y = Math.sin(el);
    const w = /^#[0-9a-f]{6}$/i.test(tune.waterColour) ? parseInt(tune.waterColour.slice(1), 16) : src.planetWater;
    this.water[0] = (w >> 16) & 255;
    this.water[1] = (w >> 8) & 255;
    this.water[2] = w & 255;
  }

  /** Whether every row is made. */
  get done(): boolean {
    return this.row >= this.px;
  }

  /** How many slices the whole picture is. */
  get sliceCount(): number {
    return Math.ceil(this.px / Math.max(1, Math.round(this.tune.sliceRows)));
  }

  /** A pixel's game point: its middle as a share of the picture, to the map's frame, to the game's about (0, 0). */
  gameX(i: number): number {
    return -(((i + 0.5) / this.px - 0.5) * this.size);
  }

  gameZ(j: number): number {
    return (0.5 - (j + 0.5) / this.px) * this.size;
  }

  /** The heights of one row worked out. */
  private heightRow(j: number): void {
    const gz = this.gameZ(j);
    const o = j * this.px;
    for (let i = 0; i < this.px; i++) this.heights[o + i] = this.src.heightAt(this.gameX(i), gz);
  }

  /** One row coloured, shaded and watered (its neighbours' heights in). */
  private colourRow(j: number): void {
    const px = this.px;
    const H = this.heights;
    const m = this.size / px;
    const gz = this.gameZ(j);
    const up = j > 0 ? j - 1 : j;
    const down = j < px - 1 ? j + 1 : j;
    const sun = this.sun;
    const flat = sun.y;
    const shade = this.tune.shade;
    const c = this.col;
    for (let i = 0; i < px; i++) {
      const gx = this.gameX(i);
      const k = j * px + i;
      const h = H[k];
      const o = k * 4;
      const ws = this.src.waterAt(gx, gz);
      if (ws > h) {
        const own = this.src.waterColour(gx, gz, c);
        const w = own ? c : this.water;
        this.data[o] = w[0];
        this.data[o + 1] = w[1];
        this.data[o + 2] = w[2];
        this.data[o + 3] = 255;
        continue;
      }
      this.src.groundColour(gx, gz, h, c);
      // The slope in the game's frame: the pixel to the right is the game's -x, the row below its -z.
      const l = i > 0 ? i - 1 : i;
      const r = i < px - 1 ? i + 1 : i;
      const dhx = (H[j * px + l] - H[j * px + r]) / ((r - l) * m || 1);
      const dhz = (H[up * px + i] - H[down * px + i]) / ((down - up) * m || 1);
      const len = Math.sqrt(dhx * dhx + 1 + dhz * dhz);
      const lam = Math.max(0, (-dhx * sun.x + sun.y - dhz * sun.z) / len);
      const f = 1 + shade * (lam / flat - 1);
      this.data[o] = c[0] * f;
      this.data[o + 1] = c[1] * f;
      this.data[o + 2] = c[2] * f;
      this.data[o + 3] = 255;
    }
  }

  /**
   * Rows made while the budget lasts (`budgetMs`, the tune's `sliceMs` by default), heights a row ahead of the colours; a row
   * is not begun once the last row's cost would carry it past the budget, but one row is always made. Answers whether the
   * picture is done.
   */
  step(budgetMs: number = this.tune.sliceMs): boolean {
    if (this.done) return true;
    const t0 = this.now();
    const rows = Math.max(1, Math.round(this.tune.sliceRows));
    let made = 0;
    while (!this.done) {
      const r0 = this.now();
      if (made > 0 && r0 - t0 + this.rowMs > budgetMs) break;
      const j = this.row;
      while (this.heightRows <= Math.min(this.px - 1, j + 1)) this.heightRow(this.heightRows++);
      this.colourRow(j);
      this.row++;
      made++;
      if (this.row % rows === 0 || this.row === this.px) this.slices++;
      this.rowMs = this.now() - r0;
    }
    const spent = this.now() - t0;
    this.frames++;
    this.totalMs += spent;
    if (spent > this.worstMs) this.worstMs = spent;
    return this.done;
  }
}

/**
 * What the game hands to make a world's picture source (`App.makeDemMap`): the world's own answers at game points, each
 * written into a record the world keeps or handed back as a kept record, so a pixel asked makes nothing.
 */
export interface DemMapWorld {
  size: number;
  heightAt(gx: number, gz: number): number;
  /** The ground's own colour in linear light (the family's mean colour, else the planet's palette), as a record the world keeps. */
  groundLinear(gx: number, gz: number): { r: number; g: number; b: number };
  /** Whether the ground is drawn by the tile program, whose colour map tints every family (the wash, the paint's colour). */
  tiled: boolean;
  /** The colour map's tint at a game point, bytes into `out` (asked only on a tiled world). */
  colourMapAt(gx: number, gz: number, out: Uint8Array): void;
  /** The water's surface at a game point, -Infinity where none stands. */
  waterAt(gx: number, gz: number): number;
  /** A lake or river of ours's own look's colour at a game point ("#rrggbb"), or nothing where none is named there. */
  waterLookAt(gx: number, gz: number): string | null | undefined;
  /** The planet's own water colour, 0xRRGGBB. */
  planetWater: number;
}

/** A linear channel in [0, 1] to sRGB (three's own `LinearToSRGB` curve), times 255. */
function srgbByte(c: number): number {
  const v = c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
  return v * 255;
}

/**
 * A picture's source over a world (`DemMapMaker`'s): the ground's own linear colour carried into sRGB bytes, a tiled world's
 * colour map laid over it, and a lake's own look's colour where it names one, the look's text parsed once a look and not once
 * a pixel. Pure: the node test drives it over a stand-in world.
 */
export function demMapSourceOf(w: DemMapWorld): DemMapSource {
  const tint = new Uint8Array(3);
  let lastLook = '';
  let lastHex = 0;
  return {
    size: w.size,
    heightAt: (gx, gz) => w.heightAt(gx, gz),
    groundColour: (gx, gz, _h, out) => {
      const c = w.groundLinear(gx, gz);
      let r = srgbByte(c.r);
      let g = srgbByte(c.g);
      let b = srgbByte(c.b);
      // The colour map the ground is tinted by (the wash, the paint's colour) laid over a textured ground's family colour.
      if (w.tiled) {
        w.colourMapAt(gx, gz, tint);
        r = (r * tint[0]) / 255;
        g = (g * tint[1]) / 255;
        b = (b * tint[2]) / 255;
      }
      out[0] = r;
      out[1] = g;
      out[2] = b;
    },
    waterAt: (gx, gz) => w.waterAt(gx, gz),
    waterColour: (gx, gz, out) => {
      const look = w.waterLookAt(gx, gz);
      if (!look) return false;
      if (look !== lastLook) {
        lastLook = look;
        lastHex = /^#[0-9a-f]{6}$/i.test(look) ? parseInt(look.slice(1), 16) : -1;
      }
      if (lastHex < 0) return false;
      bytesOf(lastHex, out);
      return true;
    },
    planetWater: w.planetWater,
  };
}

/** A colour byte triple read from a palette or a look: 0xRRGGBB into `out`. */
export function bytesOf(hex: number, out: Uint8Array): void {
  out[0] = (hex >> 16) & 255;
  out[1] = (hex >> 8) & 255;
  out[2] = hex & 255;
}

/**
 * Whether the picture wants making again, by a debounce on the moment of the last edit: true once `debounceMs` has passed
 * since `editedAt` (NaN: nothing edited), so a held stroke makes it once, after.
 */
export function remakeDue(editedAt: number, now: number, debounceMs: number = MAP_PICTURE_TUNE.debounceMs): boolean {
  return Number.isFinite(editedAt) && now - editedAt >= debounceMs;
}
