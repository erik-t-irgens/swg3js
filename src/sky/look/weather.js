// Weather in motion (wave 4 of the generated bodies): lightning in storm cells and clouds that move.
// Everything here works by uniforms: no bake ever runs for it, and nothing is made in a frame (the
// storm clock keeps its numbers in typed arrays it made once; the shader pieces are built with the
// cloud material, only when its look asks for them, so a look with neither is drawn exactly as before).
//
// The lightning: a few storm sites wander over the body (each lives 12 to 45 seconds, then moves on);
// flashes come at random (an exponential wait at the rate dial, so the gaps are irregular), each from
// one site with a little scatter, each a burst of one to four strokes a few hundredths of a second
// apart, and now and then a flash sets off another close by a moment later. A flash lights the cloud
// round it (a soft spot the "spread" dial sizes) and shows through the cloud's own cover, so it is
// seen where the cloud is thick and best on the night side (the day's light all but drowns it).
//
// The motion: the cloud's picture is read twice, at two phases of a four-second cycle, each pushed a
// little along the moving air and blended so the push never piles up (the way a flow map runs), the
// cycle staggered from place to place so the body never breathes as one: the belts drift east and west
// by latitude and a generated look's spiral storms turn about their own eyes (where its bake put them:
// generate.js's cycloneSites). The churn is a slow warp read once for both (churnedDir, churnedUV).
//
// (The look tuner's pass changed the flash's shape and timing, the churn and the cycle; see each piece.)

import * as THREE from 'three/webgpu';
import { uniform, float, vec2, vec3, dot, exp, mix, fract, abs, sin, cos, cross, length, atan, smoothstep, pow, normalize, max, sign, clamp, mx_noise_float } from 'three/tsl';

export const STORM_SLOTS = 8;
const SITES = 5;
// (the look tuner's pass) a flash: x, y, z, the way its strokes crawl (dx, dy, dz), its size (a factor on
// the spread), up to six strokes (start, amplitude), the end
const STROKES = 6;
const SLOT_W = 7 + STROKES * 2 + 1;
/** How often a flash sets off a run of others across the same storm (one to three, each a step on). Seen
 * from orbit a storm's flashes come in such runs, one cell lighting its neighbour; the rate dial stays the
 * average over everything, the runs included. */
const CASCADE_P = 0.45;
const CASCADE_MEAN = 2;
/** Seconds of the motion's cycle (the two reads are half a cycle apart): shorter keeps the two reads
 * closer (less doubling of a fast swirl's arms), longer makes their blend's slow breathing slower. */
export const MOTION_PERIOD = 4;

/** The lightning's dials (under the clouds layer's `storm`); every range has its start as a reset. */
export const STORM_DIALS = [
  { k: 'storm.on', label: 'Storm cells with lightning', type: 'check', struct: true, title: 'Brief flashes inside the clouds, scattered and irregular; best seen on the night side' },
  { k: 'storm.rate', label: 'Flashes a second', type: 'range', min: 0, max: 4, step: 0.01, reset: 1, title: 'On average, over the whole body (about a quarter of them on the night side facing you): they come in runs, one cell lighting the next, with quiet gaps between' },
  { k: 'storm.bright', label: 'Flash brightness', type: 'range', min: 0, max: 6, step: 0.01, reset: 1.6 },
  { k: 'storm.colour', label: 'Flash colour', type: 'color', reset: '#d8e0ff' },
  { k: 'storm.spread', label: 'Flash spread', type: 'range', min: 0.01, max: 0.4, step: 0.001, reset: 0.07, title: 'The size of the patch of cloud one flash lights, in radians of the body (0.07 is about 4 degrees)' },
];
/** The clouds' own motion (under the clouds layer's `motion`). */
export const MOTION_DIALS = [
  { k: 'motion.on', label: 'Clouds move of their own', type: 'check', struct: true, title: 'Drift by latitude, churn, and spiral storms that turn: by uniforms, never a bake' },
  { k: 'motion.drift', label: 'Belt drift', unit: '°/min', type: 'range', min: 0, max: 60, step: 0.5, reset: 8, title: 'Degrees a minute: the belts move east and west against each other, beyond the clouds\' spin' },
  { k: 'motion.churn', label: 'Churn', type: 'range', min: 0, max: 1, step: 0.01, reset: 0.3, title: 'The masses slowly change shape' },
  { k: 'motion.swirl', label: 'Spirals turn', unit: '/min', type: 'range', min: 0, max: 2, step: 0.01, reset: 0.25, title: 'Turns a minute at the eye: a generated look\'s spiral storms (its Clouds dials\' storm cells) turn about their eyes, the inner arms faster (a pictured look has none)' },
];

/** The uniforms a look's clouds read for both. */
export function weatherUniforms() {
  // (the GPU port's pass 2, wave 5) the numbers written every frame ride in a vector's field, written in place: a number
  // written into a float uniform's own `value` is a number made (its field holds every kind of value), and the game steps
  // the storms and the motion every frame. `t` and each `cellInv[i]` are the vectors' `x`, read so by the graphs.
  const tv = uniform(new THREE.Vector4(0, 0, 0, 0));
  return {
    cells: Array.from({ length: STORM_SLOTS }, () => uniform(new THREE.Vector4(0, 1, 0, 0))),
    // each flash's own size, as 1 / size^2 in its vector's x (a factor on the spread: some small, some broad)
    cellInv: Array.from({ length: STORM_SLOTS }, () => uniform(new THREE.Vector4(1, 0, 0, 0))),
    flashColour: uniform(new THREE.Vector3(0.69, 0.75, 1)), invSpread2: uniform(1 / (0.07 * 0.07)), invSpread: uniform(1 / 0.07),
    tv, t: tv.x, drift: uniform(0), churn: uniform(0), swirl: uniform(0),
    // a generated look's spiral storms: centre, and radius times the side's sign (0: none)
    cyclones: Array.from({ length: 8 }, () => uniform(new THREE.Vector4(0, 1, 0, 0))),
  };
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const _col = new THREE.Color();
/** The dials into the uniforms (when a control moves, never a frame). */
export function syncWeather(W, L, cyclones = null) {
  const s = L?.storm || {};
  _col.setStyle(/^#[0-9a-f]{6}$/i.test(s.colour || '') ? s.colour : '#d8e0ff');
  W.flashColour.value.set(_col.r, _col.g, _col.b); // linear (setStyle converts)
  const sp = Math.max(0.005, Number.isFinite(+s.spread) ? +s.spread : 0.07);
  W.invSpread2.value = 1 / (sp * sp);
  W.invSpread.value = 1 / sp;
  const m = L?.motion || {};
  const num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null && v !== undefined ? +v : d);
  W.drift.value = (num(m.drift, 8) * Math.PI) / 180 / 60; // radians a second
  W.churn.value = num(m.churn, 0.3) * 0.03; // radians of the warp's reach at full churn (about two degrees)
  W.swirl.value = (num(m.swirl, 0.25) * Math.PI * 2) / 60; // radians a second at the eye
  for (let i = 0; i < 8; i++) {
    const c = cyclones && cyclones[i];
    if (c) W.cyclones[i].value.set(c[0], c[1], c[2], c[3] * c[4]);
    else W.cyclones[i].value.set(0, 1, 0, 0);
  }
}
export const stormDial = (L, k, d) => { const v = L?.storm?.[k]; return Number.isFinite(+v) && v !== '' && v !== null && v !== undefined ? +v : d; };

// ---------------------------------------------------------------------------------------------
// The shader pieces.

/** How much flash light reaches a point: `p` the direction in the cloud's own frame (a sphere), or the
 * point on the dome's disc (`disc`: its x and y, the rim at 1). */
export function flashAt(W, p, disc = false) {
  // (the look tuner's pass) a flash lights a ragged patch, never a round spot: its edge is pushed in and
  // out by a noise a third of the spread across, and a faint wide halo (the light spreading through the
  // deck) stands round its core; each flash has its own size
  const q = (disc ? vec3(p.xy, 0.37) : p).mul(W.invSpread.mul(1.5));
  const n = mx_noise_float(q).mul(0.7).add(mx_noise_float(q.mul(2.1).add(vec3(5.1, 1.7, 3.3))).mul(0.3));
  const rag = clamp(float(1).add(n.mul(0.85)), 0.45, 1.8);
  let g = float(0);
  for (let i = 0; i < STORM_SLOTS; i++) {
    const c = W.cells[i];
    const d2 = disc ? dot(p.xy.sub(c.xy), p.xy.sub(c.xy)) : float(2).mul(float(1).sub(dot(p, c.xyz)));
    const e = d2.mul(W.invSpread2).mul(W.cellInv[i].x);
    g = g.add(c.w.mul(exp(e.mul(rag).negate()).add(exp(e.mul(-0.12)).mul(0.14))));
  }
  return g;
}

/**
 * The light a flash adds to a cloud, given its sun angle (the night side shows it best; in daylight a
 * flash is all but lost, as from orbit), the cloud's own colour (the flash lights the cloud's texture,
 * not a disc over it) and its cover (thick cloud glows more than thin).
 */
export function flashLight(W, glow, ndl, albedo = null, cover = null) {
  const night = float(1).sub(smoothstep(-0.15, 0.35, ndl));
  let k = glow.mul(mix(float(0.06), float(1), night));
  if (cover) k = k.mul(mix(float(0.35), float(1), cover));
  const light = W.flashColour.mul(k);
  return albedo ? light.mul(albedo) : light;
}

/** A slow field over the body (-1..1) that staggers the motion's cycle from place to place, so its
 * two reads never cross-fade everywhere at once (the whole body breathing every three seconds). */
export const phaseOffsetDir = (d) => sin(d.x.mul(2.1).add(d.y.mul(1.3)).add(0.4)).mul(0.5).add(sin(d.z.mul(2.7).sub(d.y.mul(1.9)).add(1.7)).mul(0.5));
/** The same on a lat-long picture (whole turns in u, so the seam stays shut). */
export const phaseOffsetUV = (u) => sin(u.x.mul(Math.PI * 2).add(u.y.mul(3.0)).add(0.4)).mul(0.5).add(sin(u.x.mul(Math.PI * 4).sub(u.y.mul(2.3)).add(1.7)).mul(0.5));

/** The two phases of the motion's cycle: their pushes (seconds of travel, -P/2..P/2) and the first's
 * weight; `off` (a node, optional) staggers the cycle from place to place. */
export function motionPhases(W, off = null) {
  const ph0 = off ? fract(W.t.div(MOTION_PERIOD).add(off)) : fract(W.t.div(MOTION_PERIOD));
  const ph1 = fract(ph0.add(0.5));
  return { a0: ph0.sub(0.5).mul(MOTION_PERIOD), a1: ph1.sub(0.5).mul(MOTION_PERIOD), w0: float(1).sub(abs(ph0.mul(2).sub(1))) };
}

// v turned about the unit axis k by the angle a (Rodrigues)
const turn = (v, k, a) => {
  const c = cos(a), s = sin(a);
  return v.mul(c).add(cross(k, v).mul(s)).add(k.mul(dot(k, v).mul(float(1).sub(c))));
};
// the belts: the equator one way, the middle latitudes the other, nothing at the poles
const beltWind = (lat) => cos(lat.mul(3.0));

/**
 * (The look tuner's pass) the churn: the masses slowly change shape. It is a warp that wanders and
 * comes back (three slow waves at unrelated periods of half a minute or so, about thirty degrees
 * across), read once for both of the cycle's reads: pushed through the cycle as before it made every
 * cloud a double image, half a degree apart at its start, and blurred the whole layer.
 */
export function churnedDir(W, dir) {
  const t = W.t, A = W.churn;
  const f = vec3(
    sin(dir.y.mul(11.0).add(dir.z.mul(5.3)).add(t.mul(0.21)).add(1.3)),
    sin(dir.z.mul(9.7).add(dir.x.mul(6.1)).add(t.mul(0.17)).add(2.1)),
    sin(dir.x.mul(10.3).add(dir.y.mul(4.9)).add(t.mul(0.26)).add(0.7)),
  );
  return normalize(dir.add(f.mul(A)));
}
/** The same on a lat-long picture (whole turns in u, so the seam stays shut). */
export function churnedUV(W, u) {
  const t = W.t, A = W.churn, TAU = Math.PI * 2;
  const f = vec2(
    sin(u.y.mul(19.0).add(u.x.mul(TAU * 3)).add(t.mul(0.21)).add(1.3)),
    sin(u.x.mul(TAU * 4).sub(u.y.mul(11.0)).add(t.mul(0.17)).add(2.1)),
  );
  return u.add(f.mul(A).mul(vec2(1 / TAU, 1 / Math.PI)));
}

/** A direction on a sphere's cloud shell moved `a` seconds along the air (a generated look's clouds):
 * the belts' drift and the spiral storms' turn (the churn is churnedDir's, read before this). */
export function movedDir(W, dir, a) {
  const lat = atan(dir.y, length(vec2(dir.x, dir.z)));
  let p = turn(dir, vec3(0, 1, 0), W.drift.mul(a).mul(beltWind(lat)));
  for (let i = 0; i < 8; i++) {
    const S = W.cyclones[i];
    const rad = max(abs(S.w), 0.00001);
    const d = length(p.sub(S.xyz));
    // the bake's own profile of the turn, strongest at the eye; its side's sign
    const prof = exp(pow(d.div(rad), 1.5).mul(-1.1));
    const on = smoothstep(0.0, 0.0001, abs(S.w));
    p = turn(p, S.xyz, W.swirl.mul(a).mul(prof).mul(on).mul(sign(S.w)));
  }
  return p;
}

/** A lat-long cloud picture's place moved `a` seconds along the air (its u round, v from pole to pole). */
export function movedUV(W, uvNode, a) {
  const lat = uvNode.y.sub(0.5).mul(Math.PI);
  const du = W.drift.mul(a).mul(beltWind(lat)).div(Math.PI * 2);
  return uvNode.add(vec2(du, 0));
}

// ---------------------------------------------------------------------------------------------
// The storm clock: where and when the flashes are, on the CPU, into the cells' uniforms.

export class Storms {
  constructor(seed = 1, disc = false) {
    this.a = (seed >>> 0) || 1;
    // (pass 2, wave 5) the seed it began with and its hints, for a recording of the same storm (`record`)
    this.seed0 = this.a;
    this.hintList = null;
    this.tape = null;
    this.disc = disc;
    this.sites = new Float64Array(SITES * 4); // x, y, z, until
    this.slots = new Float64Array(STORM_SLOTS * SLOT_W);
    this.next = -1;
    this.last = -1;
    this.rateUsed = -1;
    this.slot = 0;
    this.chain = -1; // the next flash of a run set off by the one before: when
    this.chainSite = 0;
    this.chainLeft = 0; // how many more of the run
    this.lastPos = new Float64Array(3); // the last flash's place, and the way a run steps on
    this.chainDir = new Float64Array(3);
    this.tmp = new Float64Array(3);
    // hints: places a site may sit (a generated look's spiral storms), as [x, y, z, ...]
    this.hints = new Float64Array(8 * 3);
    this.hintCount = 0;
    // the last flashes' start times, for the checks (a ring)
    this.log = new Float64Array(256);
    this.logCount = 0;
    this.flashes = 0;
    this.onFlash = null; // (x, y, z, peak, delayToLast) when a flash starts
  }

  rand() {
    this.a = (this.a + 0x6D2B79F5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  setHints(cyclones) {
    this.hintList = cyclones || null;
    this.hintCount = 0;
    for (const c of cyclones || []) {
      if (this.hintCount >= 8) break;
      this.hints.set([c[0], c[1], c[2]], this.hintCount * 3);
      this.hintCount++;
    }
  }

  placeSite(i, now) {
    const S = this.sites, o = i * 4;
    if (this.disc) {
      const r = 0.9 * Math.sqrt(this.rand()), a = this.rand() * Math.PI * 2;
      S[o] = r * Math.cos(a); S[o + 1] = r * Math.sin(a); S[o + 2] = 0;
    } else if (this.hintCount && this.rand() < 0.4) {
      const h = Math.floor(this.rand() * this.hintCount) * 3;
      this.jitter(this.hints[h], this.hints[h + 1], this.hints[h + 2], 0.12, S, o);
    } else {
      // anywhere but the far poles
      const lon = this.rand() * Math.PI * 2;
      const lat = Math.asin((this.rand() * 2 - 1) * 0.94);
      S[o] = Math.cos(lat) * Math.sin(lon); S[o + 1] = Math.sin(lat); S[o + 2] = Math.cos(lat) * Math.cos(lon);
    }
    S[o + 3] = now + 12 + this.rand() * 33;
  }

  // a point `r` (radians) at most from (x, y, z), into out[o..o+2]
  jitter(x, y, z, r, out, o) {
    if (this.disc) {
      const a = this.rand() * Math.PI * 2, d = r * Math.sqrt(this.rand());
      out[o] = x + d * Math.cos(a); out[o + 1] = y + d * Math.sin(a); out[o + 2] = 0;
      return;
    }
    const jx = (this.rand() * 2 - 1) * r, jy = (this.rand() * 2 - 1) * r, jz = (this.rand() * 2 - 1) * r;
    const nx = x + jx, ny = y + jy, nz = z + jz, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l;
  }

  // a random way along the body at (x, y, z) (or on the disc), `len` long, into out[o..o+2]
  tangent(x, y, z, len, out, o) {
    if (this.disc) {
      const a = this.rand() * Math.PI * 2;
      out[o] = len * Math.cos(a); out[o + 1] = len * Math.sin(a); out[o + 2] = 0;
      return;
    }
    const rx = this.rand() * 2 - 1, ry = this.rand() * 2 - 1, rz = this.rand() * 2 - 1, d = rx * x + ry * y + rz * z;
    const tx = rx - d * x, ty = ry - d * y, tz = rz - d * z, l = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    out[o] = (tx / l) * len; out[o + 1] = (ty / l) * len; out[o + 2] = (tz / l) * len;
  }

  // (x, y, z) + (dx, dy, dz), back onto the body (or the disc), into out[o..o+2]
  step3(x, y, z, dx, dy, dz, out, o) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (this.disc) { out[o] = nx; out[o + 1] = ny; out[o + 2] = 0; return; }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l;
  }

  /**
   * One flash from site `si`, starting at `now`; `follow`, the next of a run: a step on from the last.
   * (The look tuner's pass:) up to six strokes a few hundredths of a second apart, as a real flash has
   * three or four on average, each lighting the cloud a little way on from the last (the light crawls
   * through the storm rather than blinking in one place), and each flash its own size.
   */
  flash(now, si, spread, follow = false) {
    const T = this.slots, o = this.slot * SLOT_W;
    this.slot = (this.slot + 1) % STORM_SLOTS;
    const P = this.lastPos, D = this.chainDir;
    if (follow) {
      const len = spread * (1.1 + this.rand() * 1.3);
      const dl = Math.sqrt(D[0] * D[0] + D[1] * D[1] + D[2] * D[2]) || 1;
      // the run bends a little at each step
      this.tangent(P[0], P[1], P[2], 0.6, this.tmp, 0);
      this.step3(P[0], P[1], P[2], (D[0] / dl + this.tmp[0]) * len, (D[1] / dl + this.tmp[1]) * len, (D[2] / dl + this.tmp[2]) * len, T, o);
    } else {
      const S = this.sites, so = si * 4;
      this.jitter(S[so], S[so + 1], S[so + 2], spread * 1.3, T, o);
    }
    P[0] = T[o]; P[1] = T[o + 1]; P[2] = T[o + 2];
    const size = 0.55 + this.rand() * this.rand() * 1.3;
    this.tangent(T[o], T[o + 1], T[o + 2], spread * size * (0.25 + this.rand() * 0.45), T, o + 3);
    T[o + 6] = size;
    const strokes = Math.min(STROKES, 1 + Math.floor(STROKES * Math.pow(this.rand(), 1.5)));
    let t = now, peak = 0;
    for (let k = 0; k < STROKES; k++) {
      const so = o + 7 + k * 2;
      if (k < strokes) {
        const amp = k === 0 ? 0.7 + this.rand() * 0.3 : 0.3 + this.rand() * 0.6;
        T[so] = t; T[so + 1] = amp;
        peak = Math.max(peak, amp);
        t += 0.035 + this.rand() * 0.12;
      } else { T[so] = 0; T[so + 1] = 0; }
    }
    T[o + SLOT_W - 1] = t + 1.0;
    this.log[this.logCount % this.log.length] = now;
    this.logCount++;
    this.flashes++;
    if (this.onFlash) this.onFlash(T[o], T[o + 1], T[o + 2], peak, now);
    // often a flash sets off a run of others across the same storm, each a moment and a step on
    // (while a run is still going, the new one's flashes join it, so the dial's average holds)
    if (!follow && this.rand() < CASCADE_P) {
      const n = 1 + Math.floor(this.rand() * (2 * CASCADE_MEAN - 1));
      if (this.chainLeft > 0) this.chainLeft = Math.min(8, this.chainLeft + n);
      else {
        this.chainLeft = n;
        this.chain = now + 0.12 + this.rand() * 0.5;
        this.chainSite = si;
        this.tangent(P[0], P[1], P[2], 1, D, 0);
      }
    }
  }

  /**
   * Step the clock to `now` (seconds) and write each cell's place and brightness into `cells` (the
   * uniforms), `rate` flashes a second over the body, `bright` their strength, `spread` their size.
   */
  step(now, on, rate, bright, spread, cells, sizes = null) {
    const a = (this.args ||= stormArgs());
    a.now = now; a.on = on; a.rate = rate; a.bright = bright; a.spread = spread; a.cells = cells; a.sizes = sizes;
    this.stepWith(a);
  }

  /**
   * (the GPU port's pass 2, wave 5) `step` with its numbers read off a kept record (`stormArgs()`: now, on, rate, bright,
   * spread, cells, sizes), written in place by the caller: a number handed across a call is a number made, and the game
   * steps the storms every frame. The same steps as `step`, number for number.
   */
  stepWith(a) {
    const now = a.now, on = a.on, rate = a.rate, bright = a.bright, spread = a.spread, cells = a.cells, sizes = a.sizes;
    // (pass 2, wave 5) a recorded storm played back (`record`), while its dials are the ones it was recorded at
    if (this.tape && on && rate === this.tapeRate && spread === this.tapeSpread) {
      const P = this.tapeSeconds, n = this.tapeCount, tape = this.tape;
      const loop = Math.floor(now / P), local = now - loop * P;
      if (loop !== this.tapeLoop || local < this.tapeLast) { this.tapeLoop = loop; this.tapeCursor = 0; }
      this.tapeLast = local;
      while (this.tapeCursor < n && tape[this.tapeCursor * SLOT_W + 7] <= local) this.tapeCursor++;
      for (let i = 0; i < STORM_SLOTS; i++) {
        const v = cells[i].value;
        let idx = this.tapeCursor - 1 - i, lt = local;
        // the first flashes of a pass: the slots hold the last of the pass before
        if (idx < 0) { idx += n; lt = local + P; }
        if (idx < 0) { v.w = 0; continue; }
        const o = idx * SLOT_W;
        let I = 0, lastK = 0;
        if (lt < tape[o + SLOT_W - 1]) {
          for (let k = 0; k < STROKES; k++) {
            const s = tape[o + 7 + k * 2], amp = tape[o + 8 + k * 2];
            if (!(amp > 0) || lt < s) continue;
            const dt = lt - s;
            lastK = k;
            I += amp * Math.min(1, dt / 0.012) * (Math.exp(-dt / 0.06) + 0.28 * Math.exp(-dt / 0.2));
          }
        }
        if (lastK > 0) {
          const nx = tape[o] + tape[o + 3] * lastK, ny = tape[o + 1] + tape[o + 4] * lastK, nz = tape[o + 2] + tape[o + 5] * lastK;
          if (this.disc) { v.x = nx; v.y = ny; v.z = 0; }
          else {
            const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            v.x = nx / l; v.y = ny / l; v.z = nz / l;
          }
        } else { v.x = tape[o]; v.y = tape[o + 1]; v.z = tape[o + 2]; }
        v.w = I * bright;
        if (sizes) { const sz = tape[o + 6] || 1; sizes[i].value.x = 1 / (sz * sz); }
      }
      return;
    }
    const T = this.slots;
    if (!on || !(rate > 0)) {
      for (let i = 0; i < STORM_SLOTS; i++) if (cells[i].value.w !== 0) cells[i].value.w = 0;
      this.next = -1;
      this.last = now;
      return;
    }
    // the dial is the average over everything: the first flashes of runs come at what the runs leave
    const first = rate / (1 + CASCADE_P * CASCADE_MEAN);
    // back after a long gap (a hidden tab): start afresh rather than firing every flash missed
    if (this.next < 0 || now - this.last > 2 || now < this.last) {
      for (let i = 0; i < SITES; i++) this.placeSite(i, now);
      this.next = now + this.wait(first);
      this.rateUsed = first;
      this.chain = -1;
      this.chainLeft = 0;
    } else if (first !== this.rateUsed) {
      // (the reviewer's pass) the rate dial moved: the wait is drawn again at the new rate (a wait drawn at a
      // rate near nothing could otherwise hold the storm silent for minutes after the dial came back up;
      // the waits have no memory, so drawing again is the same storm)
      this.next = now + this.wait(first);
      this.rateUsed = first;
    }
    this.last = now;
    for (let i = 0; i < SITES; i++) if (now > this.sites[i * 4 + 3]) this.placeSite(i, now);
    let guard = 0;
    while (now >= this.next && guard++ < 6) {
      this.flash(this.next, Math.floor(this.rand() * SITES), spread);
      this.next += this.wait(first);
    }
    if (this.chainLeft > 0 && now >= this.chain) {
      const t = this.chain;
      this.chainLeft--;
      this.chain = t + 0.12 + this.rand() * 0.55;
      this.flash(t, this.chainSite, spread, true);
    }
    for (let i = 0; i < STORM_SLOTS; i++) {
      const o = i * SLOT_W;
      let I = 0, lastK = 0;
      if (now < T[o + SLOT_W - 1]) {
        for (let k = 0; k < STROKES; k++) {
          const s = T[o + 7 + k * 2], amp = T[o + 8 + k * 2];
          if (!(amp > 0) || now < s) continue;
          const dt = now - s;
          lastK = k;
          // a sharp stroke and the cloud's shorter glow after it, with a rise of a hundredth of a second
          I += amp * Math.min(1, dt / 0.012) * (Math.exp(-dt / 0.06) + 0.28 * Math.exp(-dt / 0.2));
        }
      }
      const v = cells[i].value;
      // each stroke lights the cloud a little further along the flash's own way (`step3` written out: this runs a frame)
      if (lastK > 0) {
        const nx = T[o] + T[o + 3] * lastK, ny = T[o + 1] + T[o + 4] * lastK, nz = T[o + 2] + T[o + 5] * lastK;
        if (this.disc) { v.x = nx; v.y = ny; v.z = 0; }
        else {
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          v.x = nx / l; v.y = ny / l; v.z = nz / l;
        }
      } else { v.x = T[o]; v.y = T[o + 1]; v.z = T[o + 2]; }
      v.w = I * bright;
      // (pass 2, wave 5) into its vector's field, in place
      if (sizes) { const sz = T[o + 6] || 1; sizes[i].value.x = 1 / (sz * sz); }
    }
  }

  /**
   * (the GPU port's pass 2, wave 5) This storm recorded ahead at its dials (`rate` flashes a second, `spread` their size) for
   * `seconds` (`STORM_TAPE.seconds`), then played back by `stepWith` round and round while those dials hold: the same seed's
   * storm, flash for flash, as `stepWith` would draw it live from the start. A flash is drawn rarely, so its own steps run in the
   * engine's slower tiers, where every number it works is a number made (some 1.3 KB a flash in the game's measure); played
   * back, a frame reads the recorded flashes alone. The game records every storm it draws behind its loading screen
   * (`STORM_TAPE.on`); the viewer never does, its dials moving live as ever. Some tens of milliseconds.
   */
  record(rate, spread, seconds = STORM_TAPE.seconds) {
    const s = new Storms(this.seed0, this.disc);
    s.setHints(this.hintList);
    const cells = Array.from({ length: STORM_SLOTS }, () => ({ value: { x: 0, y: 1, z: 0, w: 0 } }));
    const a = stormArgs();
    a.on = true; a.rate = rate; a.bright = 1; a.spread = spread; a.cells = cells;
    const recs = [];
    let seen = 0;
    const dt = 1 / 30;
    for (let i = 0; i * dt <= seconds; i++) {
      a.now = i * dt;
      s.stepWith(a);
      for (; seen < s.flashes; seen++) {
        const o = (seen % STORM_SLOTS) * SLOT_W;
        recs.push(s.slots.slice(o, o + SLOT_W));
      }
    }
    const tape = new Float64Array(recs.length * SLOT_W);
    recs.forEach((r, i) => tape.set(r, i * SLOT_W));
    this.tape = tape;
    this.tapeCount = recs.length;
    this.tapeSeconds = seconds;
    this.tapeRate = rate;
    this.tapeSpread = spread;
    // (a fraction to begin: the field then holds a double from the first frame, and is never a whole loop's number)
    this.tapeLoop = -1.5;
    this.tapeCursor = 0;
    this.tapeLast = 0.5;
    return recs.length;
  }

  /** A slot's size factor (1 when none), for a reader that sizes its flashes itself (the ground's sky). */
  sizeOf(i) { return this.slots[i * SLOT_W + 6] || 1; }

  wait(rate) { return -Math.log(1 - this.rand() * 0.999999) / rate; }

  /** The last flashes' start times, oldest first (for the checks; this one makes an array). */
  times() {
    const n = Math.min(this.logCount, this.log.length), out = [];
    for (let i = this.logCount - n; i < this.logCount; i++) out.push(this.log[i % this.log.length]);
    return out;
  }
}

/**
 * (the GPU port's pass 2, wave 5) Whether the storms built from now on are recorded ahead and played back (`Storms.record`): the
 * game's, set before it builds a look; the viewer leaves it off and steps its storms live. `seconds` the recording's length, the
 * storm going round again after it: ten minutes, which no one watching one storm's flashes tells from a storm that never repeats
 * (its sites wander every 12 to 45 seconds), a few thousand flashes at most (some 200 KB at four a second).
 */
export const STORM_TAPE = { on: false, seconds: 600 };

/**
 * (the GPU port's pass 2, wave 5) The record `Storms.stepWith` reads, made once and written in place each frame: its numbers
 * begin as fractions so the fields hold doubles from the first write (a field begun as a whole number and written a fraction
 * later changes its kind).
 */
export function stormArgs() {
  return { now: 0.5, on: false, rate: 0.5, bright: 0.5, spread: 0.5, cells: null, sizes: null };
}
