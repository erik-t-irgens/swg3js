// Matching a look's colours to a reference by measurement: the lightness, colour strength (chroma) and
// hue of the lit part of a body's disc in CIELAB (D65), their means and their spreads, from any RGBA
// pixels (a picture, or the stage as drawn). Pure: no DOM and no three, so the page and node's tests
// share it. A generated look of recipe version 2 has four grade dials (generate.js's GRADE_DIALS:
// colour strength, lightness, contrast and hue turn); `gradeToward` moves them so the look's disc
// measures as the reference's does, a step at a time (the look is baked and measured again between
// steps, since clouds, air and light all stand between the dials and the disc).

const D2R = Math.PI / 180;

/** One 8-bit sRGB colour to CIELAB (D65 white), as [L*, a*, b*]. */
export function srgbToLab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** A #rrggbb colour's CIELAB. */
export function hexToLab(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return srgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
const relLum = (r, g, b) => {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126729 * lin(r) + 0.7151522 * lin(g) + 0.0721750 * lin(b);
};

/**
 * The lit disc's colour numbers from RGBA pixels (row by row, `w` x `h`).
 * Which pixels count: inside `circle` ({ x, y, r } in pixels) when given; opaque (alpha at least
 * `alphaMin`); not the black of space (L* above `blackL`); and lit: luminance at least `litShare` of the
 * brightest twentieth of the disc's own (so the night side and the terminator's dusk are left out
 * whatever the phase). Every `step`-th pixel each way is read (by default enough for about 250 000).
 * Returns { n, share (of the circle or picture), L, C, h, a, b } with { mean, sd } each (h's are
 * circular, in degrees, each pixel weighted by its chroma, since a grey pixel has no hue), or null when
 * nothing counts.
 */
// (With `sun` and a `circle` whose sphere it is, "lit" is the sphere's own: a pixel counts where the sun
// stands at least `sunMin` (its sine) above that point's horizon, the sphere's normal there taken from
// the pixel's place in the circle of full radius `circle.R` (else `circle.r`). `sun` is a unit vector in
// the view's frame: x right, y up, z toward the viewer. So a darkened look is still measured where it
// is lit, whatever its clouds do; a picture, whose light is painted, is measured by its luminance.)
export function discStats(px, w, h, { circle = null, alphaMin = 128, blackL = 4, litShare = 0.3, step = 0, sun = null, sunMin = 0.25 } = {}) {
  const st = step || Math.max(1, Math.floor(Math.sqrt((w * h) / 250000)));
  const x0 = circle ? Math.max(0, Math.floor(circle.x - circle.r)) : 0, x1 = circle ? Math.min(w, Math.ceil(circle.x + circle.r)) : w;
  const y0 = circle ? Math.max(0, Math.floor(circle.y - circle.r)) : 0, y1 = circle ? Math.min(h, Math.ceil(circle.y + circle.r)) : h;
  const r2 = circle ? circle.r * circle.r : 0;
  const geo = !!(sun && circle);
  const RR = circle ? circle.R || circle.r : 1;
  const keep = [];
  let seen = 0;
  for (let y = y0; y < y1; y += st) {
    for (let x = x0; x < x1; x += st) {
      if (circle) { const dx = x + 0.5 - circle.x, dy = y + 0.5 - circle.y; if (dx * dx + dy * dy > r2) continue; }
      seen++;
      const i = (y * w + x) * 4;
      if (px[i + 3] < alphaMin) continue;
      if (geo) {
        const nx = (x + 0.5 - circle.x) / RR, ny = -(y + 0.5 - circle.y) / RR, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        if (nx * sun.x + ny * sun.y + nz * sun.z < sunMin) continue;
      }
      keep.push(i);
    }
  }
  if (!keep.length) return null;
  const Y = new Float32Array(keep.length);
  for (let k = 0; k < keep.length; k++) { const i = keep[k]; Y[k] = relLum(px[i], px[i + 1], px[i + 2]); }
  const sorted = Float32Array.from(Y).sort();
  const top = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const yMin = geo ? 0 : Math.max(top * litShare, 0);
  let n = 0, sL = 0, sL2 = 0, sC = 0, sC2 = 0, sa = 0, sb = 0, sa2 = 0, sb2 = 0, hx = 0, hy = 0, wC = 0;
  const Ls = new Float32Array(keep.length), Cs = new Float32Array(keep.length);
  for (let k = 0; k < keep.length; k++) {
    if (Y[k] < yMin) continue;
    const i = keep[k];
    const [L, a, b] = srgbToLab(px[i], px[i + 1], px[i + 2]);
    if (L <= blackL) continue;
    const C = Math.sqrt(a * a + b * b);
    Ls[n] = L; Cs[n] = C;
    n++; sL += L; sL2 += L * L; sC += C; sC2 += C * C; sa += a; sb += b; sa2 += a * a; sb2 += b * b;
    if (C > 0.5) { hx += a; hy += b; wC += C; } // (a, b) is the hue's unit vector times C: weighted by chroma
  }
  if (!n) return null;
  const ms = (s, s2) => { const m = s / n; return { mean: m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)) }; };
  // the tenth, middle and ninetieth hundredths (the vivid tenth of a disc is what reads as "too saturated")
  const pct = (arr) => { const s = arr.subarray(0, n).sort(); const at = (q) => s[Math.min(n - 1, Math.floor(q * n))]; return { p10: at(0.1), p50: at(0.5), p90: at(0.9) }; };
  // circular hue: the mean direction of the chroma-weighted hue vectors, its spread from their length
  const Rbar = wC > 0 ? Math.sqrt(hx * hx + hy * hy) / wC : 0;
  const hMean = (Math.atan2(hy, hx) / D2R + 360) % 360;
  const hSd = Rbar > 0 ? Math.sqrt(-2 * Math.log(Math.min(1, Math.max(1e-9, Rbar)))) / D2R : 180;
  return { n, share: n / Math.max(1, seen), L: { ...ms(sL, sL2), ...pct(Ls) }, C: { ...ms(sC, sC2), ...pct(Cs) }, a: ms(sa, sa2), b: ms(sb, sb2), h: { mean: hMean, sd: hSd } };
}

const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/** How a measured disc stands against a reference's: differences of means and ratios of spreads. */
export function compareStats(cur, ref) {
  if (!cur || !ref) return null;
  return {
    dL: cur.L.mean - ref.L.mean, LsdRatio: ref.L.sd > 0 ? cur.L.sd / ref.L.sd : 1,
    dC: cur.C.mean - ref.C.mean, Cratio: ref.C.mean > 0 ? cur.C.mean / ref.C.mean : 1,
    dh: wrap180(cur.h.mean - ref.h.mean), hsdRatio: ref.h.sd > 0 ? cur.h.sd / ref.h.sd : 1,
  };
}

/** CIELAB (D65) back to an 8-bit sRGB #rrggbb, held to the gamut. */
export function labToHex(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  const enc = (c) => { c = Math.min(1, Math.max(0, c)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };
  return '#' + [R, G, B].map((c) => enc(c).toString(16).padStart(2, '0')).join('');
}

/** The grade dials' ranges (generate.js's GRADE_DIALS hold the same numbers and their starts). */
export const GRADE_RANGES = {
  gradeStrength: [0, 2], gradeLightness: [0.5, 2], gradeContrast: [0.5, 1.5], gradeHue: [-60, 60], gradeWash: [0, 1],
};
const clampTo = (k, v) => Math.min(GRADE_RANGES[k][1], Math.max(GRADE_RANGES[k][0], v));

/**
 * The grade dials one step nearer the reference: the colour strength scaled by the ratio of mean chroma,
 * the hue turned by the difference of mean hue, the contrast scaled by the ratio of lightness spreads,
 * the lightness by the ratio of mean lightness, and the wash (every colour pulled toward one, which
 * narrows the spread of hues) raised while the look's hues spread wider than the reference's and
 * lowered while they spread narrower, its colour the reference's mean colour. `damp` (0..1) takes that
 * share of each step (the first steps of a match overshoot least at about 0.8). Each dial is held to
 * its range. `use` leaves dials out ({ wash: false } keeps the wash, { chroma: false } the colour
 * strength, { lightness: false } the lightness); the contrast and the hue turn move only when asked,
 * { contrast: true } and { hue: true }.
 */
export function gradeToward(cur, ref, grade, { damp = 0.8, use = {} } = {}) {
  const g = { gradeStrength: 0.8, gradeLightness: 1, gradeContrast: 1, gradeHue: 0, gradeWash: 0, gradeWashColour: '#8a9cb0', ...grade };
  if (!cur || !ref) return g;
  const on = (k) => use[k] !== false;
  const step = (from, to) => from + (to - from) * damp;
  const out = { ...g };
  if (on('chroma') && cur.C.mean > 0.5) out.gradeStrength = clampTo('gradeStrength', step(g.gradeStrength, g.gradeStrength * ref.C.mean / cur.C.mean));
  if (on('lightness') && cur.L.mean > 1) out.gradeLightness = clampTo('gradeLightness', step(g.gradeLightness, g.gradeLightness * ref.L.mean / cur.L.mean));
  // (the contrast only when asked, { contrast: true }: on a lit sphere most of the lightness's spread is
  // the light's own fall toward the terminator, which no grade of the ground can take away, and chasing
  // it drags the mean lightness toward the middle)
  if (use.contrast === true && cur.L.sd > 0.5) out.gradeContrast = clampTo('gradeContrast', step(g.gradeContrast, g.gradeContrast * ref.L.sd / cur.L.sd));
  // the hue only where both have a hue worth the name (a near-grey disc's mean hue is noise)
  const hued = cur.C.mean > 3 && ref.C.mean > 3;
  // (the wash already pulls the hues toward the reference's mean colour: the turn takes only the share
  // the wash leaves, so the two never chase each other round the wheel)
  // (and only when asked, { hue: true }: a turn moves every hue alike, so olive land goes teal and blue
  // sea violet to bring a mean round, where the wash brings the mean round and keeps each hue its own)
  if (use.hue === true && hued) out.gradeHue = clampTo('gradeHue', step(g.gradeHue, g.gradeHue - wrap180(cur.h.mean - ref.h.mean) * (1 - g.gradeWash)));
  if (on('wash') && hued && cur.h.sd > 0) {
    // (wider hues than the reference's want more wash; so does a mean hue off the reference's, since the
    // wash colour is the reference's mean)
    const want = g.gradeWash + (1 - ref.h.sd / cur.h.sd) * 0.5 + (Math.abs(wrap180(cur.h.mean - ref.h.mean)) / 180) * 0.5;
    out.gradeWash = clampTo('gradeWash', step(g.gradeWash, want));
    out.gradeWashColour = labToHex(ref.L.mean, ref.a.mean, ref.b.mean);
  }
  for (const k of Object.keys(GRADE_RANGES)) out[k] = Math.round(out[k] * 1000) / 1000;
  return out;
}

/** A line of words for a measured disc. */
export function statsWords(s) {
  if (!s) return 'nothing measured';
  const f = (v, d = 1) => v.toFixed(d);
  return `lightness ${f(s.L.mean)} ± ${f(s.L.sd)}, colour strength ${f(s.C.mean)} ± ${f(s.C.sd)} (vivid tenth from ${f(s.C.p90 ?? 0)}), hue ${f(s.h.mean, 0)}° ± ${f(s.h.sd, 0)}° (${s.n} pixels)`;
}
