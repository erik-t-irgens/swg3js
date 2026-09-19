// One paint render: a ship paint recipe (customize.json) run for a set of values, and for a shader
// that glows through a mask, split into its lit colour and its glow (glowSplit.ts) with the mask read
// from the texture the values chose (for a MAIN mask, the chosen pattern's own MAIN, not the coloured
// render). Shared by the paint worker and its main-thread fallback (paintRender.ts). Pure.
import { liveShader, renderRecipe, valueOf, type Img, type Recipe, type Values } from '../player/texrender.ts';
import { maskOf, splitGlow } from './glowSplit.ts';

/** How a paint shader glows: the texture holding the mask, its channel, and whether the lit colour keeps the main's alpha. */
export interface PaintGlow { maskTag: 'EMIS' | 'MAIN' | 'NRML' | 'SPEC'; channel: 'a' | 'rgb'; keepAlpha: boolean }
/** A ship's paint recipe: a customizer recipe, with its glow when the shader glows, and the SSHT's own MAIN kept by name (the pre-customization look). */
export interface PaintRecipe extends Recipe { glow?: PaintGlow; staticMain?: string }
/** A render: the colour for `map` (the lit half when there is a glow), and the glow for `emissiveMap` when there is one. */
export interface PaintImg extends Img { emis?: Img }

/** Every image a recipe reads for these values: each shader's fixed textures, and each choice at the value chosen only. */
export function paintFiles(r: PaintRecipe, values: Values): string[] {
  const files = new Set<string>();
  const fromShader = (s: Recipe['shader']) => {
    if (!s) return;
    for (const f of Object.values(s.textures ?? {})) if (f) files.add(f);
    for (const c of s.choices ?? []) {
      const n = c.files.length;
      if (!n) continue;
      const v = Math.min(Math.max(Math.round(valueOf(values, c.variable, c.default, c.private, r.mesh)), 0), n - 1);
      const f = c.files[v];
      if (f) files.add(f);
    }
  };
  fromShader(r.shader);
  for (const slot of r.slots ?? []) {
    for (const s of slot.blueprint.shaders) fromShader(s);
    for (const f of slot.blueprint.textures) if (f) files.add(f);
  }
  return [...files];
}

/** A black glow the size of an image (a pattern whose mask glows nowhere): the glow map stays, showing nothing. */
function blackGlow(img: Img): Img {
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width: img.width, height: img.height, rgba };
}

/** The image with its alpha forced to 255 (a lit colour that does not keep the main's alpha). */
function opaque(img: Img): Img {
  const rgba = new Uint8Array(img.rgba);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width: img.width, height: img.height, rgba };
}

/**
 * Render a paint recipe for the values; with a glow, split it: the mask is the texture the shader reads
 * at the glow's tag for these values (a choice when a choice sets that tag), sampled nearest at the
 * render's size. A mask that glows nowhere (under 8/255) gives the whole colour lit and a black glow.
 * Null when nothing renders (an image missing).
 */
export function runPaintJob(r: PaintRecipe, values: Values, palettes: Record<string, number[][]>, image: (file: string | null) => Img | null): PaintImg | null {
  const img = renderRecipe(r, values, palettes, image);
  if (!img) return null;
  const glow = r.glow;
  if (!glow) return img;
  const live = liveShader(r.shader, image, values, palettes, r.mesh);
  const mask = live?.textures.get(glow.maskTag) ?? null;
  const m = mask ? maskOf(img, mask, glow.channel) : null;
  if (!m) {
    const lit = glow.keepAlpha ? { width: img.width, height: img.height, rgba: new Uint8Array(img.rgba) } : opaque(img);
    return { ...lit, emis: blackGlow(img) };
  }
  const { lit, emis } = splitGlow(img, m, glow.keepAlpha);
  return { ...lit, emis };
}

/** Decoded images kept by bytes, the least recently used let go first; a missing image (null) weighs nothing. */
export class ImageCache {
  private readonly cap: number;
  private readonly map = new Map<string, Img | null>();
  private bytes = 0;

  constructor(capBytes: number) {
    this.cap = capBytes;
  }

  get size(): number {
    return this.bytes;
  }

  get(key: string): Img | null | undefined {
    if (!this.map.has(key)) return undefined;
    const img = this.map.get(key)!;
    // Used again: to the back of the line.
    this.map.delete(key);
    this.map.set(key, img);
    return img;
  }

  set(key: string, img: Img | null): void {
    const old = this.map.get(key);
    if (old) this.bytes -= old.rgba.length;
    this.map.delete(key);
    this.map.set(key, img);
    if (img) this.bytes += img.rgba.length;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.cap || k === key) break;
      this.map.delete(k);
      if (v) this.bytes -= v.rgba.length;
    }
  }
}
