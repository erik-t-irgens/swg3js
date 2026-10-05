// How the client's own pixel programs read a normal map, for the converter and the browser alike.
//
// The slot a map sits in decides it, and nothing about the picture does. Measured over all 22,322 retail
// shaders: every program that reads a CNRM slot decodes it as the compressed layout --
// `tex2DDxt5CompressedNormal`, x out of the alpha, y out of the green, z rebuilt as the root of what is
// left -- and every program that reads an NRML slot decodes plain signed RGB (`signAndBias`); no retail
// shader carries a DOT3 slot at all, and the fixed-function DOT3 it is named for reads RGB. The converter
// and the recolour path both used to guess the layout from the picture instead (an alpha that varies far
// more than the red read as x), and the guess was wrong on 1,157 of the shaders the game uses and on 554
// of the 873 plain maps a recolour reads: an uncompressed map keeps the height it was made from in its
// alpha, which varies plenty and is not x. On a typical texel the light landed 33 degrees off.
//
// Pure, and it imports nothing: the converter (`tools/swg/surface.mjs`, run by Node with its types
// stripped) and the game's recolour (`src/player/texrender.ts`) call this one file, so the two can never
// decode one map two ways again.

/** The two ways a program reads a normal map: `compressed` (x in alpha, y in green, z rebuilt) or `plain` signed RGB. */
export type NormalLayout = 'compressed' | 'plain';

/** The layout a slot's map is read in: CNRM compressed, NRML and DOT3 plain; null for a slot that holds no normal map. */
export function normalLayoutOf(slot: string | null | undefined): NormalLayout | null {
  if (slot === 'CNRM') return 'compressed';
  if (slot === 'NRML' || slot === 'DOT3') return 'plain';
  return null;
}

/**
 * A normal map as the program reads it, written back as an ordinary tangent-space RGB map (alpha 255)
 * that three reads with `(rgb * 2 - 1)`. The plain layout is the source's own red, green and blue byte
 * for byte; the compressed one puts the alpha in red, keeps the green and writes the rebuilt z, so x and
 * y are exact and z is within half a level of the program's own square root. A vector whose x and y
 * reach past the unit circle gets z nought, as `sqrt` of nothing; the client's own would be NaN there and
 * three normalises what it reads, so the direction is the same.
 *
 * `out`, when given, is written into rather than a new array made (it must hold width x height x 4 bytes).
 */
export function decodeNormalMap(rgba: ArrayLike<number>, width: number, height: number, layout: NormalLayout, out?: Uint8Array): Uint8Array {
  const n = width * height;
  const dst = out ?? new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (layout === 'plain') {
      dst[o] = rgba[o];
      dst[o + 1] = rgba[o + 1];
      dst[o + 2] = rgba[o + 2];
    } else {
      const xb = rgba[o + 3];
      const yb = rgba[o + 1];
      const x = xb / 127.5 - 1;
      const y = yb / 127.5 - 1;
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      dst[o] = xb;
      dst[o + 1] = yb;
      dst[o + 2] = Math.round((z * 0.5 + 0.5) * 255);
    }
    dst[o + 3] = 255;
  }
  return dst;
}

/**
 * The unit vector the client's program works out for one texel of a map in this layout, before the
 * tangent frame: what a test compares a written map against. Returns [x, y, z], normalised as the
 * programs normalise it (a zero vector comes back as straight up).
 */
export function normalOfTexel(r: number, g: number, b: number, a: number, layout: NormalLayout): [number, number, number] {
  const x = (layout === 'compressed' ? a : r) / 255 * 2 - 1;
  const y = g / 255 * 2 - 1;
  const z = layout === 'compressed' ? Math.sqrt(Math.max(0, 1 - x * x - y * y)) : b / 255 * 2 - 1;
  const len = Math.hypot(x, y, z);
  return len > 0 ? [x / len, y / len, z / len] : [0, 0, 1];
}
