// How one lava look flows and colours, read from a planet's water.json, and the hand-made stand-in for a
// pack converted before the lava look was. Types are the only imports, so a plain node test reads this
// file as the game does.
import type { WaterLavaInfo, WaterShaderInfo } from './waterLook';

/** How one lava look flows and colours (the client's MATL and TFNS), and where its textures are in the pack. */
export interface LavaStyle {
  /** The shader name, or 'stand-in:<shader>'. */
  key: string;
  /** Seconds; time is taken modulo this. */
  loopTime: number;
  /** Noise texture units per second. */
  flow: [number, number, number];
  colorScale: number;
  colorBias: number;
  tcScale: number;
  /** The bloom factor the glow thresholds apply to. */
  textureFactor: number;
  /** Null: the stand-in ramp. */
  ramp: { width: number; rgba: string } | null;
  /** Null: the ramp alone. */
  mix: string | null;
  /** Null: the shared runtime noise. */
  noise: { file: string; size: [number, number, number] } | null;
}

/** The retail still and slow shaders' factor (0x48 / 255): the stand-in's, and any style whose shader had none. */
export const LAVA_TEXTURE_FACTOR = 0.2824;
/** The client's noise volume's mean, and the runtime noise's. */
export const NOISE_MEAN = 0.49;

/** Hand-made values, not the client's: a slow boil, a dark crust with orange veins. */
export const FALLBACK_LAVA_STYLE: LavaStyle = {
  key: 'stand-in',
  loopTime: 100,
  flow: [0, 0.03, 0],
  colorScale: 0.5,
  colorBias: 0.12,
  tcScale: 2,
  textureFactor: LAVA_TEXTURE_FACTOR,
  ramp: null,
  mix: null,
  noise: null,
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A pack-relative path: not empty, not rooted, never climbing out. */
const relative = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && !v.startsWith('/') && !v.startsWith('\\') && !v.split(/[\\/]/).includes('..') && !/^[a-z]+:/i.test(v);

/**
 * A water.json lava block read leniently, never throwing. Null when it is not an object, loopTime is not
 * finite and above 0, flow is not three finite numbers, colorScale or colorBias is not finite, or tcScale
 * is not finite and above 0. Optional parts that are malformed become null on their own: textureFactor
 * outside 0..1; ramp without an integer width 2..1024 and a base64 string of exactly width × 4 bytes; mix not a relative path (empty,
 * starting with '/', or containing '..'); noise without a relative file and three integers 1..512.
 */
export function readLavaInfo(raw: unknown): WaterLavaInfo | null {
  if (!isObject(raw)) return null;
  const { loopTime, flow, colorScale, colorBias, tcScale } = raw;
  if (!finite(loopTime) || loopTime <= 0) return null;
  if (!Array.isArray(flow) || flow.length !== 3 || !flow.every(finite)) return null;
  if (!finite(colorScale) || !finite(colorBias)) return null;
  if (!finite(tcScale) || tcScale <= 0) return null;
  const tf = raw.textureFactor;
  const textureFactor = finite(tf) && tf >= 0 && tf <= 1 ? tf : null;
  const r = raw.ramp;
  let ramp: WaterLavaInfo['ramp'] = isObject(r) && Number.isInteger(r.width) && (r.width as number) >= 2 && (r.width as number) <= 1024 && typeof r.rgba === 'string' ? { width: r.width as number, rgba: r.rgba } : null;
  // A ramp whose bytes are not exactly width × 4 is as good as none.
  if (ramp && !decodeRamp(ramp)) ramp = null;
  const mix = relative(raw.mix) ? raw.mix : null;
  const nz = raw.noise;
  let noise: WaterLavaInfo['noise'] = null;
  if (isObject(nz) && relative(nz.file) && Array.isArray(nz.size) && nz.size.length === 3 && nz.size.every((s) => Number.isInteger(s) && (s as number) >= 1 && (s as number) <= 512)) {
    noise = { file: nz.file, size: [nz.size[0] as number, nz.size[1] as number, nz.size[2] as number] };
  }
  return { loopTime, flow: [flow[0], flow[1], flow[2]], colorScale, colorBias, tcScale, textureFactor, ramp, mix, noise };
}

/** The style for one shader: its entry's valid lava block, else the stand-in keyed 'stand-in:<shader>'. */
export function lavaStyleFor(shader: string, info: WaterShaderInfo | undefined): LavaStyle {
  const lava = readLavaInfo(info?.lava);
  if (!lava) return { ...FALLBACK_LAVA_STYLE, flow: [...FALLBACK_LAVA_STYLE.flow], key: `stand-in:${shader}` };
  return {
    key: shader,
    loopTime: lava.loopTime,
    flow: lava.flow,
    colorScale: lava.colorScale,
    colorBias: lava.colorBias,
    tcScale: lava.tcScale,
    textureFactor: lava.textureFactor ?? LAVA_TEXTURE_FACTOR,
    ramp: lava.ramp,
    mix: lava.mix,
    noise: lava.noise,
  };
}

/** A base64 ramp's bytes, or null when they are not exactly width × 4 (or not base64). Uses atob (browser and node). */
export function decodeRamp(ramp: { width: number; rgba: string } | null): Uint8Array | null {
  if (!ramp) return null;
  let text: string;
  try {
    text = atob(ramp.rgba);
  } catch {
    return null;
  }
  if (text.length !== ramp.width * 4) return null;
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

/** The stand-in's colour stops: position 0..1 and an sRGB colour; linear in bytes between them. */
const STAND_IN_STOPS: readonly (readonly [number, number])[] = [
  [0, 0x000000],
  [0.3, 0x3a0600],
  [0.4, 0xc83200],
  [0.5, 0xff8a10],
  [0.7, 0xffe060],
  [1, 0xffe060],
];

/**
 * The hand-made ramp, 256 RGBA bytes each. Colour stops (sRGB bytes, linear between stops): 0 000000,
 * 0.3 3a0600, 0.4 c83200, 0.5 ff8a10, 0.7 ffe060, 1 ffe060. Alpha = round(255 × clamp(0.315 + i/255,
 * 0.3, 0.95)): with LAVA_TEXTURE_FACTOR it crosses the glow thresholds (0.203, 0.213) between index 0.405
 * and 0.44, about the top sixth of the stand-in's noise.
 */
export function standInRamp(): Uint8Array {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < STAND_IN_STOPS.length - 2 && t > STAND_IN_STOPS[k + 1][0]) k++;
    const [p0, c0] = STAND_IN_STOPS[k];
    const [p1, c1] = STAND_IN_STOPS[k + 1];
    const f = p1 > p0 ? Math.min(1, Math.max(0, (t - p0) / (p1 - p0))) : 0;
    for (let ch = 0; ch < 3; ch++) {
      const shift = 16 - ch * 8;
      const a = (c0 >> shift) & 255;
      const b = (c1 >> shift) & 255;
      out[i * 4 + ch] = Math.round(a + (b - a) * f);
    }
    out[i * 4 + 3] = Math.round(255 * Math.min(0.95, Math.max(0.3, 0.315 + t)));
  }
  return out;
}

/** A noise file fits when its length is exactly the product of its size. */
export function noiseFits(byteLength: number, size: readonly number[]): boolean {
  if (size.length !== 3 || !size.every((s) => Number.isInteger(s) && s >= 1)) return false;
  return byteLength === size[0] * size[1] * size[2];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * What lava looks like where its veins are smaller than a pixel: the mean index over the noise, and the
 * mean glow the veins would have had. Samples every `stride`th byte (default max(1, floor(length / 160000)));
 * the ramp's alpha is read as linear filtering does (texel centres at (k + 0.5) / width, clamped).
 * glow = smoothstep(glowFrom, glowTo, alpha / 255 × textureFactor).
 */
export function lavaFarValues(noise: ArrayLike<number>, ramp: ArrayLike<number>, rampWidth: number, style: LavaStyle, glowFrom: number, glowTo: number, stride?: number): { indexMean: number; glowMean: number } {
  const step = Math.max(1, Math.floor(stride ?? Math.max(1, Math.floor(noise.length / 160000))));
  const width = Math.max(1, Math.floor(rampWidth));
  let sumIndex = 0;
  let sumGlow = 0;
  let n = 0;
  for (let i = 0; i < noise.length; i += step) {
    const index = (noise[i] / 255) * style.colorScale + style.colorBias;
    // The shader samples the ramp at the clamped index; texel k's centre is (k + 0.5) / width.
    const x = Math.min(width - 1, Math.max(0, Math.min(1, Math.max(0, index)) * width - 0.5));
    const k0 = Math.floor(x);
    const k1 = Math.min(width - 1, k0 + 1);
    const f = x - k0;
    const alpha = ramp[k0 * 4 + 3] * (1 - f) + ramp[k1 * 4 + 3] * f;
    sumIndex += index;
    sumGlow += smoothstep(glowFrom, glowTo, (alpha / 255) * style.textureFactor);
    n++;
  }
  if (!n) return { indexMean: NOISE_MEAN * style.colorScale + style.colorBias, glowMean: 0 };
  return { indexMean: sumIndex / n, glowMean: sumGlow / n };
}

/** Tables grouped by look, keyed `${shader}|${shaderSize}`, in first-seen order. */
export function groupLava<T extends { shader: string; shaderSize: number }>(tables: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of tables) {
    const key = `${t.shader}|${t.shaderSize}`;
    let list = out.get(key);
    if (!list) {
      list = [];
      out.set(key, list);
    }
    list.push(t);
  }
  return out;
}
