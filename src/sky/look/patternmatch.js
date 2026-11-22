// Matching a look's pattern to a reference by measurement, beside colourmatch.js's colours: how big and
// how many the patches of land, sea, spots or cloud are, how ragged their edges, how much of the body
// they cover, a gas giant's bands along latitude, and how the detail falls off with scale (the slope of
// a radial power spectrum). Pure: no DOM and no three, so the page and node's tests share it.
//
// Everything works on one kind of picture, a "window": a lat-long grid of RGBA pixels with a mask of the
// pixels that count and the latitude and longitude its edges stand at. A whole equirectangular picture
// (an imported map, or a look's baked maps) is one window (`equirectWindow`); a disc picture (a menu
// circle, or the stage as drawn) is turned into one by `discToWindow`, the visible half of the sphere
// unwrapped about the middle of the disc. Areas are measured on the sphere (each pixel weighted by its
// row's cos(latitude)) and given as shares of the whole sphere, so a patch's size means the same from a
// whole map and from a disc. Lengths along a coast are in window pixels, the same on both sides as long
// as both windows have the same angular step (`STEP`, by default 0.4 degrees a pixel).
//
// Numbers only: nothing here keeps a picture's pixels; what comes back is statistics.

const D2R = Math.PI / 180;
/** The angular step of a window made by discToWindow and of a resampled equirect window, in degrees a pixel. */
export const STEP = 0.4;

// ---------------------------------------------------------------------------------------------
// windows

/** A whole equirectangular picture as a window (u wraps; the poles at the top and bottom rows). */
export function equirectWindow(px, w, h) {
  return { px, w, h, mask: null, lat0: Math.PI / 2, lat1: -Math.PI / 2, lon0: -Math.PI, lon1: Math.PI, wrapU: true };
}

/**
 * An equirectangular picture resampled to `step` degrees a pixel (by box averaging when smaller), so its
 * coasts are measured at the same step as a disc window's. A picture already as fine as the step or
 * coarser is resampled by nearest pixel.
 */
export function resampleEquirect(px, w, h, step = STEP) {
  const W = Math.max(8, Math.round(360 / step)), H = Math.max(4, Math.round(180 / step));
  if (W === w && H === h) return equirectWindow(px, w, h);
  const out = new Uint8ClampedArray(W * H * 4);
  const fx = w / W, fy = h / H;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < Math.min(h, y1); yy++) for (let xx = x0; xx < Math.min(w, x1); xx++) {
        const i = (yy * w + xx) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3]; n++;
      }
      const o = (y * W + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return equirectWindow(out, W, H);
}

/**
 * The visible half of a sphere in a disc picture, unwrapped about the disc's middle into a lat-long
 * window of `step` degrees a pixel reaching `reach` degrees each way (the view's own frame: latitude up
 * the picture, longitude across it, the disc's middle at 0, 0). `circle` is { x, y, r } in the picture's
 * pixels. A pixel counts where it is opaque, not the black of space and lit: its luminance at least
 * `litShare` of the brightest twentieth of the window's (as colourmatch.js's discStats; give `sun` (a
 * unit vector, x right, y up, z toward the viewer) to take the sphere's own lit side instead, at least
 * `sunMin` above the horizon). Read bilinearly.
 */
export function discToWindow(px, w, h, circle, { step = STEP, reach = 62, litShare = 0.3, sun = null, sunMin = 0.2, alphaMin = 128 } = {}) {
  const n = Math.max(4, Math.round((2 * reach) / step));
  const W = n, H = n;
  const out = new Uint8ClampedArray(W * H * 4);
  const mask = new Uint8Array(W * H);
  const Y = new Float32Array(W * H);
  const rr = circle.r;
  for (let j = 0; j < H; j++) {
    const lat = (reach - (j + 0.5) * step) * D2R;
    for (let i = 0; i < W; i++) {
      const lon = (-reach + (i + 0.5) * step) * D2R;
      const nx = Math.cos(lat) * Math.sin(lon), ny = Math.sin(lat), nz = Math.cos(lat) * Math.cos(lon);
      const sx = circle.x + rr * nx - 0.5, sy = circle.y - rr * ny - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
      const o = (j * W + i) * 4;
      for (let c = 0; c < 4; c++) {
        const a = px[(y0 * w + x0) * 4 + c], b = px[(y0 * w + x0 + 1) * 4 + c], d = px[((y0 + 1) * w + x0) * 4 + c], e = px[((y0 + 1) * w + x0 + 1) * 4 + c];
        out[o + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
      if (out[o + 3] < alphaMin) continue;
      if (sun && nx * sun.x + ny * sun.y + nz * sun.z < sunMin) continue;
      const k = j * W + i;
      Y[k] = relLum(out[o], out[o + 1], out[o + 2]);
      mask[k] = 1;
    }
  }
  if (!sun) {
    const ys = [];
    for (let k = 0; k < W * H; k++) if (mask[k]) ys.push(Y[k]);
    ys.sort((a, b) => a - b);
    const top = ys.length ? ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.95))] : 0;
    for (let k = 0; k < W * H; k++) if (mask[k] && (Y[k] < top * litShare || labL(Y[k]) <= 4)) mask[k] = 0;
  }
  return { px: out, w: W, h: H, mask, lat0: reach * D2R, lat1: -reach * D2R, lon0: -reach * D2R, lon1: reach * D2R, wrapU: false };
}

// ---------------------------------------------------------------------------------------------
// colour helpers (the same CIELAB as colourmatch.js's)

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) LIN[i] = lin(i);
const relLum = (r, g, b) => 0.2126729 * LIN[r | 0] + 0.7151522 * LIN[g | 0] + 0.0721750 * LIN[b | 0];
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const labL = (Y) => 116 * fLab(Y) - 16;
function lab(r, g, b, out) {
  const R = LIN[r | 0], G = LIN[g | 0], B = LIN[b | 0];
  const fx = fLab((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const fy = fLab(0.2126729 * R + 0.7151522 * G + 0.0721750 * B);
  const fz = fLab((0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
  return out;
}

/** Each row's weight on the sphere (cos of its latitude) and the window's own geometry. */
function rowsOf(win) {
  const wt = new Float32Array(win.h);
  for (let j = 0; j < win.h; j++) wt[j] = Math.max(0, Math.cos(win.lat0 + ((j + 0.5) / win.h) * (win.lat1 - win.lat0)));
  // a pixel's share of the whole sphere: (dlon * dlat * cos lat) / 4 pi
  const dA = (Math.abs(win.lon1 - win.lon0) / win.w) * (Math.abs(win.lat1 - win.lat0) / win.h) / (4 * Math.PI);
  return { wt, dA };
}
const counts = (win, k) => !win.mask || win.mask[k];

// ---------------------------------------------------------------------------------------------
// fields: one number a pixel

/**
 * One number a pixel of a window, by `channel`:
 *   'L'      CIELAB lightness
 *   'hue'    which way the colour leans, blue (-1) to yellow (+1): b* over chroma, so lighting's fall
 *            toward the terminator moves it little (sea against land, in any light); grey is 0
 *   'cloud'  how cloud-like: light and colourless (L* less twice the chroma)
 *   'flat'   lightness over its own neighbourhood's (`radius` degrees): the lighting and the broad
 *            tone taken out, the spots and the craters left (1 is the neighbourhood's own)
 *   'alpha'  the alpha channel (a cloud map's cover)
 * Returns a Float32Array; pixels that do not count hold NaN.
 */
export function field(win, channel = 'L', { radius = 6 } = {}) {
  const { px, w, h } = win, n = w * h;
  const f = new Float32Array(n).fill(NaN);
  const t = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    if (!counts(win, k)) continue;
    const i = k * 4;
    if (channel === 'alpha') { f[k] = px[i + 3] / 255; continue; }
    lab(px[i], px[i + 1], px[i + 2], t);
    const C = Math.sqrt(t[1] * t[1] + t[2] * t[2]);
    if (channel === 'L' || channel === 'flat') f[k] = t[0];
    else if (channel === 'hue') f[k] = t[2] / Math.max(C, 3);
    else if (channel === 'cloud') f[k] = t[0] - 2 * C;
    else throw new Error('unknown channel ' + channel);
  }
  if (channel === 'flat') {
    const rpx = Math.max(1, Math.round((radius * D2R) / (Math.abs(win.lat1 - win.lat0) / h)));
    const m = blurMasked(f, w, h, rpx, win.wrapU);
    for (let k = 0; k < n; k++) if (!Number.isNaN(f[k])) f[k] = m[k] > 1 ? f[k] / m[k] : NaN;
  }
  return f;
}

// a box blur of the counted pixels only (NaN left out), separable, u wrapping when asked
function blurMasked(f, w, h, r, wrap) {
  const s = new Float32Array(w * h), c = new Float32Array(w * h);
  const tmpS = new Float32Array(w * h), tmpC = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0;
      for (let d = -r; d <= r; d++) {
        let xx = x + d;
        if (wrap) xx = ((xx % w) + w) % w; else if (xx < 0 || xx >= w) continue;
        const v = f[y * w + xx];
        if (!Number.isNaN(v)) { a += v; b++; }
      }
      tmpS[y * w + x] = a; tmpC[y * w + x] = b;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let a = 0, b = 0;
      for (let d = -r; d <= r; d++) { const yy = y + d; if (yy < 0 || yy >= h) continue; a += tmpS[yy * w + x]; b += tmpC[yy * w + x]; }
      s[y * w + x] = a; c[y * w + x] = b;
    }
  }
  for (let k = 0; k < w * h; k++) s[k] = c[k] > 0 ? s[k] / c[k] : 0;
  return s;
}

/** Otsu's threshold over a field's counted values (weighted by the sphere): the split that best parts two classes. */
export function otsu(f, win, bins = 256) {
  const { wt } = rowsOf(win);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < f.length; k++) { const v = f[k]; if (Number.isNaN(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) return lo;
  const hist = new Float64Array(bins);
  for (let k = 0; k < f.length; k++) { const v = f[k]; if (Number.isNaN(v)) continue; hist[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins))] += wt[Math.floor(k / win.w)]; }
  let tot = 0, sum = 0;
  for (let i = 0; i < bins; i++) { tot += hist[i]; sum += i * hist[i]; }
  let wB = 0, sB = 0, best = -1, at = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = tot - wB; if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; at = i; }
  }
  return lo + ((at + 1) / bins) * (hi - lo);
}

/** The value a share `q` of the counted area lies under (weighted by the sphere). */
export function quantile(f, win, q) {
  const { wt } = rowsOf(win);
  const vs = [];
  for (let k = 0; k < f.length; k++) if (!Number.isNaN(f[k])) vs.push([f[k], wt[Math.floor(k / win.w)]]);
  vs.sort((a, b) => a[0] - b[0]);
  let tot = 0; for (const v of vs) tot += v[1];
  let acc = 0;
  for (const v of vs) { acc += v[1]; if (acc >= q * tot) return v[0]; }
  return vs.length ? vs[vs.length - 1][0] : NaN;
}

// ---------------------------------------------------------------------------------------------
// patches: connected areas above a threshold

/**
 * The connected patches of a field above `thr` (4-connected; u wraps when the window does). Each patch:
 * its area as a share of the sphere, its edge length in window pixels (the sides of its pixels that
 * meet a counted pixel outside it: the edge of the window and the uncounted pixels are not coast), and
 * its pixel count. Also the share of the counted area above the threshold.
 */
export function patches(f, win, thr) {
  const { w, h } = win, n = w * h;
  const { wt, dA } = rowsOf(win);
  const lab = new Int32Array(n).fill(-1);
  const on = (k) => !Number.isNaN(f[k]) && f[k] > thr;
  const list = [];
  const stack = new Int32Array(n);
  let countedArea = 0, onArea = 0;
  for (let k = 0; k < n; k++) if (!Number.isNaN(f[k])) { countedArea += wt[Math.floor(k / w)] * dA; if (f[k] > thr) onArea += wt[Math.floor(k / w)] * dA; }
  const nb = (k, d) => {
    const x = k % w, y = (k - x) / w;
    if (d === 0) return x + 1 < w ? k + 1 : win.wrapU ? k + 1 - w : -1;
    if (d === 1) return x > 0 ? k - 1 : win.wrapU ? k - 1 + w : -1;
    if (d === 2) return y + 1 < h ? k + w : -1;
    return y > 0 ? k - w : -1;
  };
  for (let k0 = 0; k0 < n; k0++) {
    if (lab[k0] >= 0 || !on(k0)) continue;
    const id = list.length;
    let sp = 0, area = 0, edge = 0, cnt = 0;
    stack[sp++] = k0; lab[k0] = id;
    while (sp) {
      const k = stack[--sp];
      cnt++;
      area += wt[Math.floor(k / w)] * dA;
      for (let d = 0; d < 4; d++) {
        const m = nb(k, d);
        if (m < 0 || Number.isNaN(f[m])) continue;
        if (on(m)) { if (lab[m] < 0) { lab[m] = id; stack[sp++] = m; } }
        else edge++;
      }
    }
    list.push({ area, edge, n: cnt });
  }
  return { list, countedArea, onArea, share: countedArea > 0 ? onArea / countedArea : 0, labels: lab };
}

/**
 * A patch list's statistics: how many there are per share of the sphere counted, the size histogram (by
 * area, in powers of two of a share of the sphere: bin i holds the land in patches from 2^-(i+1) to 2^-i
 * of the sphere, as a share of all the land), the area-weighted median size (half the land lies in
 * patches smaller), the largest patch's share of the land, and two measures of ragged edges:
 * `ragged`, the land's edge length against the edge of the same patches were each a disc (1 for round
 * patches, more for ragged), and `coastD`, the coast's dimension from the edge measured at the window's
 * step and at twice it (1 smooth, toward 2 for a coast ragged at every scale). Patches of fewer than
 * `minPx` pixels are counted but left out of the ragged measures (a pixel is all edge).
 */
export function patchStats(P, win, { minPx = 6, bins = 20, coarse = null } = {}) {
  const L = P.list;
  const land = P.onArea;
  const hist = new Array(bins).fill(0);
  for (const p of L) {
    const s = p.area;
    const i = Math.max(0, Math.min(bins - 1, Math.floor(-Math.log2(Math.max(1e-12, s)))));
    hist[i] += land > 0 ? s / land : 0;
  }
  const sorted = L.map((p) => p.area).sort((a, b) => a - b);
  let acc = 0, median = 0;
  for (const s of sorted) { acc += s; if (acc >= land / 2) { median = s; break; } }
  const largest = sorted.length ? sorted[sorted.length - 1] : 0;
  // ragged: the sum of the edges against the sum of the round edges, for patches of some size (in window
  // pixels: a disc of N pixels has an edge of about 2 sqrt(pi N) pixel sides... times 4/pi for the staircase)
  let e = 0, round = 0;
  for (const p of L) if (p.n >= minPx) { e += p.edge; round += 2 * Math.sqrt(Math.PI * p.n) * (4 / Math.PI); }
  const ragged = round > 0 ? e / round : 0;
  let coastD = null;
  if (coarse) {
    // the edge at the window's step and at twice it, each in lengths of the finer step
    const fine = L.reduce((a, p) => a + p.edge, 0), half = coarse.list.reduce((a, p) => a + p.edge, 0) * 2;
    coastD = fine > 0 && half > 0 ? 1 + Math.log2(fine / half) : null;
  }
  const perSphere = P.countedArea > 0 ? L.length / P.countedArea : 0;
  return {
    share: P.share, count: L.length, perSphere, medianSize: median, largestShare: land > 0 ? largest / land : 0,
    ragged, coastD, hist: hist.map((v) => Math.round(v * 1000) / 1000),
  };
}

/** A field at half the step (each 2x2 block's counted mean): for the coast's dimension. */
export function halve(f, win) {
  const w = Math.floor(win.w / 2), h = Math.floor(win.h / 2);
  const g = new Float32Array(w * h).fill(NaN);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const v = f[(2 * y + dy) * win.w + 2 * x + dx]; if (!Number.isNaN(v)) { s += v; c++; } }
    if (c >= 3) g[y * w + x] = s / c;
  }
  return { f: g, win: { ...win, w, h, mask: null, px: null } };
}

// ---------------------------------------------------------------------------------------------
// bands along latitude

/**
 * A field's profile along latitude (each row's mean over its counted pixels, in `rows` steps from the
 * window's top latitude to its bottom), with what a gas giant's bands are measured by: `crossings`, how
 * often the profile crosses its own slow trend (a band's edge each); `bands`, the band count (crossings
 * plus one, over the latitudes measured, scaled to pole to pole); `widths`, the mean and spread of the
 * bands' widths in degrees; `contrast`, the spread of the row means; and `turbulence`, the mean spread
 * within a row against the spread between rows (bands torn and curled have much within each row).
 */
export function bandProfile(f, win, { rows = 0, trendDeg = 40, smoothDeg = 1.5 } = {}) {
  const { w, h } = win;
  const R = rows || h;
  const sum = new Float64Array(R), sum2 = new Float64Array(R), cnt = new Float64Array(R);
  for (let y = 0; y < h; y++) {
    const r = Math.min(R - 1, Math.floor((y / h) * R));
    for (let x = 0; x < w; x++) { const v = f[y * w + x]; if (Number.isNaN(v)) continue; sum[r] += v; sum2[r] += v * v; cnt[r]++; }
  }
  const prof = [], within = [];
  const degPerRow = Math.abs(win.lat1 - win.lat0) / D2R / R;
  const minCount = Math.max(4, 0.05 * w * (h / R));
  for (let r = 0; r < R; r++) {
    if (cnt[r] < minCount) { prof.push(NaN); within.push(NaN); continue; }
    const m = sum[r] / cnt[r];
    prof.push(m); within.push(Math.sqrt(Math.max(0, sum2[r] / cnt[r] - m * m)));
  }
  const sm = smoothProfile(prof, Math.max(0, Math.round(smoothDeg / degPerRow)));
  const tr = smoothProfile(prof, Math.max(1, Math.round(trendDeg / degPerRow / 2)));
  const ok = sm.map((v, i) => !Number.isNaN(v) && !Number.isNaN(tr[i]));
  const det = sm.map((v, i) => (ok[i] ? v - tr[i] : NaN));
  const vals = det.filter((v) => !Number.isNaN(v));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) * (v - m)))); };
  const amp = sd(vals);
  // a crossing counts once the profile has gone a fifth of its spread past the trend on the other side
  const hyst = 0.2 * amp;
  let side = 0, last = -1;
  const cross = [];
  for (let i = 0; i < det.length; i++) {
    const v = det[i]; if (Number.isNaN(v)) continue;
    const s = v > hyst ? 1 : v < -hyst ? -1 : 0;
    if (s && side && s !== side) cross.push(last >= 0 ? (last + i) / 2 : i);
    if (s) { side = s; last = i; }
  }
  const widths = [];
  for (let i = 1; i < cross.length; i++) widths.push((cross[i] - cross[i - 1]) * degPerRow);
  const span = ok.filter(Boolean).length * degPerRow;
  const means = prof.filter((v) => !Number.isNaN(v));
  const inRow = mean(within.filter((v) => !Number.isNaN(v)));
  const between = sd(means);
  return {
    profile: prof.map((v) => (Number.isNaN(v) ? null : Math.round(v * 100) / 100)),
    crossings: cross.length, bands: span > 0 ? Math.round(((cross.length + 1) * 180) / span * 10) / 10 : 0,
    widths: { mean: mean(widths), sd: sd(widths), n: widths.length },
    contrast: between, detail: amp, turbulence: between > 1e-6 ? inRow / between : 0, span,
  };
}
function smoothProfile(p, r) {
  if (r <= 0) return p.slice();
  const out = [];
  for (let i = 0; i < p.length; i++) {
    let s = 0, c = 0;
    for (let d = -r; d <= r; d++) { const v = p[i + d]; if (v !== undefined && !Number.isNaN(v)) { s += v; c++; } }
    out.push(c > r ? s / c : NaN);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// the radial power spectrum's slope

function fft(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/**
 * The slope of a field's radial power spectrum (log power against log frequency), from square tiles
 * of `size` pixels (a power of two) wholly counted, taken where the sphere is least stretched (within
 * `latMax` degrees of the window's middle latitude), each with its mean taken out and a Hann window.
 * The slope is fitted from `kLo` cycles a tile to a quarter of the tile's pixels. About -2 for detail at
 * every scale alike (brown noise), steeper (-3, -4) for broad smooth shapes, flatter for fine speckle.
 * Also the share of the power at the finer half of the fitted range (`fine`).
 */
export function spectrumSlope(f, win, { size = 128, latMax = 35, kLo = 3, maxTiles = 24 } = {}) {
  const { w, h } = win;
  const midLat = (win.lat0 + win.lat1) / 2;
  const tiles = [];
  for (let y = 0; y + size <= h; y += size / 2) {
    const lat = win.lat0 + ((y + size / 2) / h) * (win.lat1 - win.lat0);
    if (Math.abs(lat - midLat) / D2R > latMax && Math.abs(lat) / D2R > latMax) continue;
    for (let x = 0; x + size <= w; x += size / 2) {
      let ok = true;
      for (let yy = y; yy < y + size && ok; yy += 4) for (let xx = x; xx < x + size; xx += 4) if (Number.isNaN(f[yy * w + xx])) { ok = false; break; }
      if (ok) tiles.push([x, y]);
    }
  }
  if (!tiles.length) return null;
  const pick = tiles.length > maxTiles ? tiles.filter((_, i) => i % Math.ceil(tiles.length / maxTiles) === 0) : tiles;
  const nb = size / 2;
  const P = new Float64Array(nb), C = new Float64Array(nb);
  const hann = new Float64Array(size);
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const re = new Float64Array(size * size), im = new Float64Array(size * size);
  const rowR = new Float64Array(size), rowI = new Float64Array(size);
  for (const [x0, y0] of pick) {
    let m = 0, c = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const v = f[(y0 + y) * w + x0 + x]; if (!Number.isNaN(v)) { m += v; c++; } }
    m /= Math.max(1, c);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = f[(y0 + y) * w + x0 + x];
      re[y * size + x] = (Number.isNaN(v) ? 0 : v - m) * hann[x] * hann[y]; im[y * size + x] = 0;
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) { rowR[x] = re[y * size + x]; rowI[x] = im[y * size + x]; }
      fft(rowR, rowI);
      for (let x = 0; x < size; x++) { re[y * size + x] = rowR[x]; im[y * size + x] = rowI[x]; }
    }
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) { rowR[y] = re[y * size + x]; rowI[y] = im[y * size + x]; }
      fft(rowR, rowI);
      for (let y = 0; y < size; y++) { re[y * size + x] = rowR[y]; im[y * size + x] = rowI[y]; }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const kx = x <= size / 2 ? x : x - size, ky = y <= size / 2 ? y : y - size;
      const k = Math.round(Math.sqrt(kx * kx + ky * ky));
      if (k < 1 || k >= nb) continue;
      P[k] += re[y * size + x] * re[y * size + x] + im[y * size + x] * im[y * size + x]; C[k]++;
    }
  }
  const kHi = Math.floor(size / 4);
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0, lo = 0, hi = 0;
  const mid = Math.sqrt(kLo * kHi);
  for (let k = kLo; k <= kHi; k++) {
    if (!C[k] || !(P[k] > 0)) continue;
    const p = P[k] / C[k];
    const X = Math.log(k), Yv = Math.log(p);
    sx += X; sy += Yv; sxx += X * X; sxy += X * Yv; n++;
    if (k < mid) lo += p * k; else hi += p * k;
  }
  if (n < 3) return null;
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  // the frequencies in cycles a radian, so a tile's step means the same on both sides
  const radPerPx = Math.abs(win.lat1 - win.lat0) / h;
  return { slope, tiles: pick.length, size, fine: hi / Math.max(1e-12, lo + hi), cyclesPerRadian: [kLo / (size * radPerPx), kHi / (size * radPerPx)] };
}

// ---------------------------------------------------------------------------------------------
// the whole set

/**
 * Every pattern measure of a window, as numbers:
 *   land   sea against land by the colour's lean ('hue', parted by Otsu's threshold unless `landThr`):
 *          the land's share, its patches (patchStats) and the coast's raggedness
 *   spots  bright spots against their neighbourhood ('flat' above 1 + `spotK` of its spread): the
 *          spots' share and patches (craters' rims and rays on a moon, flecks of cloud on a world)
 *   clouds the cloud-like ('cloud' above `cloudThr`, or a cloud map's alpha above 0.5 when `cloudsWin`
 *          is given): the cover and the cloud masses' sizes
 *   bands  the lightness's profile along latitude (bandProfile)
 *   spectrum the lightness's spectrum slope
 * `want` picks a subset ({ land: true, ... }); all by default.
 */
export function patternStats(win, { want = null, landThr = null, landChannel = 'hue', landShare = null, spotK = 1.5, cloudThr = 55, cloudsWin = null, spectrum = {}, coast = true } = {}) {
  const on = (k) => !want || want[k];
  const out = {};
  if (on('land')) {
    // (by the colour's lean by default; 'flat' parts lighter ground from darker, whatever the light; with
    // `landShare` the threshold is the one that leaves that share above it, so two pictures' patches are
    // compared at the same share)
    const f = field(win, landChannel);
    const thr = landThr ?? (landShare != null ? quantile(f, win, 1 - landShare) : otsu(f, win));
    const P = patches(f, win, thr);
    let coarse = null;
    if (coast) { const hv = halve(f, win); coarse = patches(hv.f, hv.win, thr); }
    out.land = { channel: landChannel, thr, ...patchStats(P, win, { coarse }) };
  }
  if (on('spots') || on('dark')) {
    const f = field(win, 'flat');
    const vs = []; for (const v of f) if (!Number.isNaN(v)) vs.push(v);
    const m = vs.reduce((a, b) => a + b, 0) / Math.max(1, vs.length);
    const s = Math.sqrt(vs.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, vs.length));
    if (on('spots')) out.spots = { spread: s, ...patchStats(patches(f, win, m + spotK * s), win) };
    // dark spots (lakes in land, craters' floors, shadowed pits): the same field turned over
    if (on('dark')) {
      const g = new Float32Array(f.length);
      for (let k = 0; k < f.length; k++) g[k] = Number.isNaN(f[k]) ? NaN : -f[k];
      out.dark = { spread: s, ...patchStats(patches(g, win, -(m - spotK * s)), win) };
    }
  }
  if (on('clouds')) {
    let f, thr;
    if (cloudsWin) { f = field(cloudsWin, 'alpha'); thr = 0.5; }
    else { f = field(win, 'cloud'); thr = cloudThr; }
    const P = patches(f, cloudsWin || win, thr);
    out.clouds = { thr, ...patchStats(P, cloudsWin || win) };
  }
  if (on('bands')) out.bands = bandProfile(field(win, 'L'), win);
  if (on('spectrum')) out.spectrum = spectrumSlope(field(win, 'L'), win, spectrum);
  return out;
}

/** How two pattern measures stand against each other: a difference or a ratio a number, as fits it. */
export function comparePatterns(cur, ref) {
  const out = {};
  const ratio = (a, b) => (b > 0 && Number.isFinite(a) ? a / b : null);
  for (const k of ['land', 'spots', 'dark', 'clouds']) {
    if (!cur[k] || !ref[k]) continue;
    const a = cur[k], b = ref[k];
    out[k] = {
      dShare: a.share - b.share, perSphere: ratio(a.perSphere, b.perSphere), medianSize: ratio(a.medianSize, b.medianSize),
      dLargest: a.largestShare - b.largestShare, ragged: ratio(a.ragged, b.ragged), dCoastD: a.coastD != null && b.coastD != null ? a.coastD - b.coastD : null,
      histDistance: histDistance(a.hist, b.hist),
    };
  }
  if (cur.bands && ref.bands) out.bands = { dBands: cur.bands.bands - ref.bands.bands, width: ratio(cur.bands.widths.mean, ref.bands.widths.mean), turbulence: ratio(cur.bands.turbulence, ref.bands.turbulence), contrast: ratio(cur.bands.contrast, ref.bands.contrast) };
  if (cur.spectrum && ref.spectrum) out.spectrum = { dSlope: cur.spectrum.slope - ref.spectrum.slope, dFine: cur.spectrum.fine - ref.spectrum.fine };
  return out;
}
/** Half the summed absolute difference of two size histograms (0 the same, 1 nothing in common). */
export function histDistance(a, b) {
  if (!a || !b) return null;
  let s = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) s += Math.abs((a[i] || 0) - (b[i] || 0));
  return Math.round(s * 500) / 1000;
}

/** A line of words for a pattern measure. */
export function patternWords(p) {
  if (!p) return 'nothing measured';
  const f = (v, d = 2) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(d));
  const sz = (s) => (s > 0 ? `1/${Math.round(1 / s)}` : '-');
  const parts = [];
  if (p.land) parts.push(`land ${f(p.land.share * 100, 0)}% in ${p.land.count} patches (half the land in patches under ${sz(p.land.medianSize)} of the sphere, the largest ${f(p.land.largestShare * 100, 0)}%), ragged ${f(p.land.ragged)}, coast D ${f(p.land.coastD)}`);
  if (p.spots) parts.push(`spots ${f(p.spots.share * 100, 1)}% (${p.spots.count}, ${f(p.spots.perSphere / 1000, 1)}k a sphere)`);
  if (p.dark) parts.push(`dark spots ${f(p.dark.share * 100, 1)}% (${p.dark.count}, ${f(p.dark.perSphere / 1000, 1)}k a sphere, median ${sz(p.dark.medianSize)})`);
  if (p.clouds) parts.push(`cloud ${f(p.clouds.share * 100, 0)}% (median mass ${sz(p.clouds.medianSize)})`);
  if (p.bands) parts.push(`${p.bands.bands} bands (${f(p.bands.widths.mean, 1)}° ± ${f(p.bands.widths.sd, 1)}°), turbulence ${f(p.bands.turbulence)}`);
  if (p.spectrum) parts.push(`spectrum slope ${f(p.spectrum.slope)}`);
  return parts.join('; ');
}
