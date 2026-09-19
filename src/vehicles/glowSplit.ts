// The glow split of tools/swg/surface.mjs, for a hull painted at run time: a painted texture whose
// shader glows through a mask becomes a lit base colour and a glow that add up to it in linear light,
// the same arithmetic byte for byte (the same sRGB decode table and encoder), so a repainted hull
// glows where and as the converted one did, in the new colour. Pure.
import type { Img } from '../player/texrender.ts';

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A linear value (clamped to 0..1) as an sRGB byte. */
export function encodeSrgb(linear: number): number {
  const l = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

/** The mask values at img's size (the mask sampled nearest) and their largest. */
function maskValues(img: Img, mask: Img, channel: 'a' | 'rgb'): { m: Float32Array; max: number } {
  const m = new Float32Array(img.width * img.height);
  let max = 0;
  for (let y = 0; y < img.height; y++) {
    const my = Math.min(mask.height - 1, Math.floor((y * mask.height) / img.height));
    for (let x = 0; x < img.width; x++) {
      const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / img.width));
      const j = (my * mask.width + mx) * 4;
      const v = (channel === 'rgb' ? Math.max(mask.rgba[j], mask.rgba[j + 1], mask.rgba[j + 2]) : mask.rgba[j + 3]) / 255;
      m[y * img.width + x] = v;
      if (v > max) max = v;
    }
  }
  return { m, max };
}

/** Float32Array of m in [0,1] at img's size (mask resampled nearest); null when max m < 8/255. */
export function maskOf(img: Img, mask: Img, channel: 'a' | 'rgb'): Float32Array | null {
  const { m, max } = maskValues(img, mask, channel);
  return max < 8 / 255 ? null : m;
}

/**
 * Split a texture into a lit base colour and a glow that add up to it in linear light:
 * lit.rgb = enc(dec(rgb)·(1−m)), emis.rgb = enc(dec(rgb)·m); lit.a = keepAlpha ? img.a : 255; emis.a = 255.
 */
export function splitGlow(img: Img, m: Float32Array, keepAlpha: boolean): { lit: Img; emis: Img } {
  const n = img.width * img.height;
  const lit = new Uint8Array(n * 4);
  const emis = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = m[i];
    for (let c = 0; c < 3; c++) {
      const l = SRGB_TO_LINEAR[img.rgba[i * 4 + c]];
      lit[i * 4 + c] = encodeSrgb(l * (1 - k));
      emis[i * 4 + c] = encodeSrgb(l * k);
    }
    lit[i * 4 + 3] = keepAlpha ? img.rgba[i * 4 + 3] : 255;
    emis[i * 4 + 3] = 255;
  }
  return { lit: { width: img.width, height: img.height, rgba: lit }, emis: { width: img.width, height: img.height, rgba: emis } };
}
