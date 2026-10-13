// The colour under a leaf card's clear texels, bled from the leaf round it.
//
// Every planted leaf picture is a leaf on black: the texels the cut throws away carry no colour of their own,
// so the browser's mip chain, which averages colour without weighing it by alpha, pulls black into every leaf
// edge as the picture shrinks. Measured over every planted card picture, the kept texels' brightness at mip 3
// was a median 0.857 of mip 0's and 0.565 in the worst tenth, and close up the samples just inside the cut
// were 0.735 of the leaf's own brightness. The client's own mips darken further still (0.788), so this is
// ours and is aimed at the owner's "too dark", not at matching the original.
//
// So a texel under the cut takes the alpha-weighted colour of its neighbourhood, from a pull-push over the
// picture's own levels: each level the alpha-weighted mean of the four beneath it, and on the way back down a
// texel with little alpha of its own takes its parent's colour by what it lacks. Alpha, and every texel at or
// over the cut, are left byte for byte as they were, so nothing the game draws at mip 0 changes and the cut
// keeps exactly the leaf it kept. Only the flora command asks for it, and only for a picture a card material
// draws as a cut-out (`surfaceTexture`'s `bleed`): blended pictures, placed models, props and the wardrobe
// are never touched.
//
// Pure: plain arrays in and out, so a node test can bleed a disc it drew itself.

/** The cut the bleed works under: a byte, the client's own half (its `a_punchout` programs clip at 0.5). */
export const BLEED_CUT = 128;

/**
 * A copy of `img` ({ width, height, rgba }, RGBA bytes) with the colour of every texel whose alpha is under
 * `cut` replaced by the alpha-weighted colour of its neighbourhood. Alpha and every kept texel are the input's.
 */
export function bleedCard(img, cut = BLEED_CUT) {
  const levels = [];
  let w = img.width;
  let h = img.height;
  let P = new Float64Array(w * h * 3);
  let W = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = img.rgba[i * 4 + 3] / 255;
    W[i] = a;
    P[i * 3] = img.rgba[i * 4] * a;
    P[i * 3 + 1] = img.rgba[i * 4 + 1] * a;
    P[i * 3 + 2] = img.rgba[i * 4 + 2] * a;
  }
  levels.push({ w, h, P, W });
  // Pull: each level the alpha-weighted sum of the four under it, down to one texel.
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const nP = new Float64Array(nw * nh * 3);
    const nW = new Float64Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const o = y * nw + x;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(w - 1, x * 2 + dx);
            const sy = Math.min(h - 1, y * 2 + dy);
            const s = sy * w + sx;
            nW[o] += W[s];
            nP[o * 3] += P[s * 3];
            nP[o * 3 + 1] += P[s * 3 + 1];
            nP[o * 3 + 2] += P[s * 3 + 2];
          }
        }
      }
    }
    levels.push({ w: nw, h: nh, P: nP, W: nW });
    P = nP;
    W = nW;
    w = nw;
    h = nh;
  }
  // Push: a level's colour, a texel with little weight of its own taking its parent's by what it lacks.
  let C = null;
  for (let L = levels.length - 1; L >= 0; L--) {
    const lv = levels[L];
    const up = levels[L + 1];
    const c = new Float64Array(lv.w * lv.h * 3);
    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < lv.w; x++) {
        const o = y * lv.w + x;
        const parent = C ? Math.min(up.h - 1, y >> 1) * up.w + Math.min(up.w - 1, x >> 1) : -1;
        const wt = Math.min(1, lv.W[o]);
        for (let k = 0; k < 3; k++) {
          const own = lv.W[o] > 1e-6 ? lv.P[o * 3 + k] / lv.W[o] : 0;
          c[o * 3 + k] = parent >= 0 ? own * wt + C[parent * 3 + k] * (1 - wt) : own;
        }
      }
    }
    C = c;
  }
  const out = new Uint8Array(img.rgba);
  for (let i = 0; i < img.width * img.height; i++) {
    if (img.rgba[i * 4 + 3] >= cut) continue;
    out[i * 4] = Math.round(C[i * 3]);
    out[i * 4 + 1] = Math.round(C[i * 3 + 1]);
    out[i * 4 + 2] = Math.round(C[i * 3 + 2]);
  }
  return { width: img.width, height: img.height, rgba: out, ...(img.hasAlpha !== undefined ? { hasAlpha: img.hasAlpha } : {}) };
}
