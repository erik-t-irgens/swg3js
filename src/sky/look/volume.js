// Space volumes (wave 5 of the generated bodies): glowing gas drawn as a true volume, ray-marched
// through 3D noise with emission and absorption. Scenery seen from a zone (a nebula near a planet, a
// backdrop, Kessel's Maelstrom with the Maw at its heart), never flown into.
//
// The volume is the unit ball of its look (a sphere drawn from inside, so it draws from any side and
// with the camera in it). Each pixel's ray is marched from where it enters the ball to where it leaves,
// or to the first body of the zone in its way (the bodies are spheres, handed over each frame: the gas
// behind a planet is hidden, the gas in front of it veils it), or to the heart (a dark sphere: what is
// behind it is black). At each step the gas's density gives light (glow, a two-colour ramp from thin to
// thick, a sunlit side when asked, lightning) and takes light (absorption), so stars and planets show
// through thin gas and vanish behind thick.
//
// Three tiers, one look: high reads the noise live at every step (sharpest), medium and low read a
// noise volume baked once (128 slices of 128 x 128 in one 2048 x 1024 picture, made again only when
// the seed or the billows' size changes) with fewer steps. A quality dial chooses, or "auto" steps down
// when frames are slow and back up when there is room. Every other dial, the drift and the currents
// are uniforms: nothing is baked or made in a frame.

import * as THREE from 'three/webgpu';
import {
  Fn, Loop, If, Break, uniform, float, vec2, vec3, vec4, floor, fract, mix, clamp, abs, min, max, dot, normalize, length,
  sqrt, exp, sin, cos, texture, uv, positionLocal, cameraPosition, modelWorldMatrixInverse, screenCoordinate, smoothstep, select,
} from 'three/tsl';
import { noise3 } from './generate.js';
import { weatherUniforms, Storms, STORM_SLOTS } from './weather.js';

const N = 128, TX = 16, TY = 8; // the baked noise volume: N slices of N x N, TX x TY of them in one picture
const CUBE = 1.1; // the noise volume reaches this far each way (room for the currents to push)
const OCC = 4; // bodies in the way, at most
const MAX_STEPS = 96;
/**
 * (the GPU port's pass 2, wave 4b) The gas faded in from the eye, in radii of its ball: nought at `from`, whole at `to`. The
 * viewer's own were 0.04 and 0.32 (the gas the eye stands in, alone); 0.15 and 0.7 also thin the near side of a ball wider than
 * about 72 degrees (the eye then within 0.7 radii of it: the eye stands 1 / sin(half the angle) radii from the middle), whose gas,
 * magnified, streaked over a planet behind it. A ball under 72 degrees across stands wholly past 0.7 radii of the eye, so the
 * Maelstrom (35 degrees) and every narrower gas draw as before.
 */
export const NEAR_FADE = { from: 0.15, to: 0.7 };
/**
 * (the GPU port's pass 2, wave 4b) The soft shoulder's whitening: the grey added for each unit the brightest channel is over its
 * roll-off, and the most of it. The viewer's own added 0.22 of every unit with no most, so the Maelstrom's heart ring (its rim
 * colour times nearly four) came out near white; 0.08 of at most half a unit keeps the ring and the hot disc their rim colour.
 */
export const SHOULDER = { white: 0.08, most: 0.5 };
/** (the GPU port's pass 2, wave 4b) The hot disc's inner edge: the colour it warms toward and how far (the viewer's own: a near white, 0.55). */
export const HOT_EDGE = { colour: [1.0, 0.82, 0.6], share: 0.35 };

/** The tiers: live noise or the baked volume, and the steps a ray takes. */
export const VOLUME_TIERS = {
  high: { live: true, steps: 64, words: 'High: the noise read live at every step, 64 steps' },
  medium: { live: false, steps: 40, words: 'Medium: the baked noise volume, 40 steps' },
  low: { live: false, steps: 16, words: 'Low: the baked noise volume, 16 steps' },
};
export const VOLUME_QUALITIES = [['auto', 'Auto (by frame time)'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
const ORDER = ['high', 'medium', 'low'];

// ---------------------------------------------------------------------------------------------
// The quality: chosen, or "auto" by frame time. The page hands every frame's time over (volumeFrame).

const Q = { mode: 'auto', auto: 'high', slow: 0, fast: 0, ceiling: 0, sinceUp: 1e9, ema: 16.7, shown: false, changed: 0 };
export function setVolumeQuality(mode) {
  // (pass 2, wave 4b: a plain loop, no closure: the game moves it in its frame when the quality tier moves)
  let known = false;
  for (let i = 0; i < VOLUME_QUALITIES.length; i++) if (VOLUME_QUALITIES[i][0] === mode) known = true;
  Q.mode = known ? mode : 'auto';
  if (Q.mode === 'auto') { Q.auto = 'high'; Q.ceiling = 0; Q.slow = Q.fast = 0; Q.sinceUp = 1e9; }
}
export const volumeTier = () => (Q.mode === 'auto' ? Q.auto : Q.mode);
export const volumeQualityState = () => ({ mode: Q.mode, tier: volumeTier(), ema: Q.ema, changed: Q.changed });
/** How many times auto has changed its tier (read each frame: a number, nothing made). */
export const volumeQualityChanges = () => Q.changed;
/**
 * One frame's time (ms) while a volume is on show: above 24 ms for a second and a half, auto steps
 * down a tier; below 18 ms (60 frames a second with room) for six seconds it tries one up, and a tier
 * that was too slow within three seconds of being tried is not tried again until the dial is moved.
 */
export function volumeFrame(ms, shown) {
  Q.shown = shown;
  if (!shown || Q.mode !== 'auto' || !(ms > 0)) return;
  const dt = Math.min(ms, 100);
  Q.ema += (dt - Q.ema) * 0.08;
  Q.sinceUp += dt;
  const i = ORDER.indexOf(Q.auto);
  if (Q.ema > 24) { Q.slow += dt; Q.fast = 0; } else if (Q.ema < 18) { Q.fast += dt; Q.slow = 0; } else { Q.slow = Q.fast = 0; }
  if (Q.slow > 1500 && i < ORDER.length - 1) {
    if (Q.sinceUp < 3000) Q.ceiling = i + 1; // the tier just tried was too slow: it stays out of reach
    Q.auto = ORDER[i + 1]; Q.slow = 0; Q.ema = 18; Q.changed++;
  } else if (Q.fast > 6000 && i > Q.ceiling) {
    Q.auto = ORDER[i - 1]; Q.fast = 0; Q.sinceUp = 0; Q.changed++;
  }
}

// ---------------------------------------------------------------------------------------------
// The noise: four channels of one point, the same live or baked. r: the large shapes; g: the small
// detail as ridges (wisps and filaments); b: the same octaves folded the other way (rounded billows);
// a: the currents' field.

const O = [vec3(31.7, -17.3, 9.1), vec3(-5.3, 23.9, -41.7), vec3(12.9, 7.7, -3.3), vec3(-27.1, 4.4, 15.6), vec3(8.8, -33.2, 21.1), vec3(-14.6, -9.9, -26.4), vec3(19.2, 28.8, 3.7)];
const volChannels = /*@__PURE__*/ Fn(([x, so]) => {
  const p = x.add(so).toVar();
  const r = noise3(p.mul(1.3)).mul(0.6).add(noise3(p.mul(2.71).add(O[0])).mul(0.3)).add(noise3(p.mul(5.6).add(O[1])).mul(0.1));
  const n1 = noise3(p.mul(4.1).add(O[2])).toVar(), n2 = noise3(p.mul(8.3).add(O[3])).toVar(), n3 = noise3(p.mul(16.9).add(O[4])).toVar();
  const folded = abs(n1).mul(0.57).add(abs(n2).mul(0.29)).add(abs(n3).mul(0.14));
  const a = noise3(p.mul(0.9).add(O[5])).mul(0.67).add(noise3(p.mul(1.93).add(O[6])).mul(0.33));
  // ridges: high along the noise's zero crossings, thin; billows: rounded tops, creased between
  const ridges = float(1).sub(folded).sub(0.42).div(0.58);
  const billows = folded.div(0.45);
  return clamp(vec4(r.mul(0.9).add(0.5), ridges, billows, a.mul(0.9).add(0.5)), 0.0, 1.0);
}).setLayout({ name: 'volChannels', type: 'vec4', inputs: [{ name: 'x', type: 'vec3' }, { name: 'so', type: 'vec3' }] });

// the large shapes alone (the first channel, the same numbers): what the shadows read, a third of the cost
const volLarge = /*@__PURE__*/ Fn(([x, so]) => {
  const p = x.add(so).toVar();
  const r = noise3(p.mul(1.3)).mul(0.6).add(noise3(p.mul(2.71).add(O[0])).mul(0.3)).add(noise3(p.mul(5.6).add(O[1])).mul(0.1));
  return clamp(r.mul(0.9).add(0.5), 0.0, 1.0);
}).setLayout({ name: 'volLarge', type: 'float', inputs: [{ name: 'x', type: 'vec3' }, { name: 'so', type: 'vec3' }] });

/** The baked volume at a point of the cube: two slices read and blended. */
function atlasAt(tex, q) {
  const c = clamp(q.div(2 * CUBE).add(0.5), 0.5 / N, 1 - 0.5 / N);
  const zf = c.z.mul(N).sub(0.5);
  const z0 = clamp(floor(zf), 0.0, N - 1);
  const z1 = min(z0.add(1.0), N - 1);
  const fz = clamp(zf.sub(z0), 0.0, 1.0);
  const at = (z) => vec2(z.mod(TX).add(c.x).div(TX), floor(z.div(TX)).add(c.y).div(TY));
  return mix(texture(tex, at(z0)), texture(tex, at(z1)), fz);
}

// ---------------------------------------------------------------------------------------------
// The bake: the four channels over the cube, into the atlas. One material for every volume (bakes run
// one after another); its two uniforms are the seed's shift and the billows' size.

let bakeKit = null;
function kit() {
  if (bakeKit) return bakeKit;
  const scale = uniform(1), so = uniform(new THREE.Vector3());
  const m = new THREE.NodeMaterial();
  m.fragmentNode = Fn(() => {
    const t = uv().mul(vec2(TX, TY));
    const tile = floor(t);
    const inT = fract(t);
    const z = tile.x.add(tile.y.mul(TX));
    const q = vec3(inT.x, inT.y, z.add(0.5).div(N)).sub(0.5).mul(2 * CUBE);
    return volChannels(q.mul(scale), so);
  })();
  m.depthTest = false;
  m.depthWrite = false;
  m.name = 'volume-bake';
  bakeKit = { m, scale, so, quad: new THREE.QuadMesh(m) };
  return bakeKit;
}

// the seed's shift of the noise: an integer generator, the same on every machine
function seedShift(seed, v) {
  let a = ((seed * 7919 + 101) >>> 0) || 1;
  const r = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return v.set((r() - 0.5) * 200, (r() - 0.5) * 200, (r() - 0.5) * 200);
}

let bakeQueue = Promise.resolve();
let volumeBakes = 0;
/** One look's baked noise volume, shared by every place that shows the look. */
export class VolumeSet {
  constructor() {
    this.rt = new THREE.RenderTarget(N * TX, N * TY, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, colorSpace: THREE.NoColorSpace, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.rt.texture.name = 'volume';
    this.key = '';
    this.refs = 0;
    this.lastMs = 0;
    this.bakes = 0;
    this.disposed = false;
  }
  static keyOf(gen) { return JSON.stringify([gen.seed, gen.volume?.version || 1, +gen.volume?.dials?.scale || 1]); }
  /** Bake again if the seed or the billows' size changed; resolves with the milliseconds (0: nothing to do). */
  bake(renderer, gen) {
    const run = async () => {
      if (this.disposed || !gen.volume || this.key === VolumeSet.keyOf(gen)) return 0;
      const t0 = performance.now();
      const K = kit();
      K.scale.value = +gen.volume.dials.scale || 1;
      seedShift(gen.seed, K.so.value);
      const prev = renderer.getRenderTarget();
      try { renderer.setRenderTarget(this.rt); K.quad.render(renderer); } finally { renderer.setRenderTarget(prev); }
      await renderer.readRenderTargetPixelsAsync(this.rt, 0, 0, 1, 1);
      this.key = VolumeSet.keyOf(gen);
      this.lastMs = performance.now() - t0;
      this.bakes++;
      volumeBakes++;
      return this.lastMs;
    };
    const p = bakeQueue.then(run, run);
    bakeQueue = p.catch(() => {});
    return p;
  }
  async pixels(renderer) { await bakeQueue; return renderer.readRenderTargetPixelsAsync(this.rt, 0, 0, N * TX, N * TY); }
  dispose() { this.disposed = true; this.rt.dispose(); }
}
export const volumeBakeCount = () => volumeBakes;

// ---------------------------------------------------------------------------------------------
// The march.

function volumeUniforms() {
  const v3 = (x = 1, y = 1, z = 1) => uniform(new THREE.Vector3(x, y, z));
  // (the GPU port's pass 2, wave 4b) the drift's turn, written every frame, is a vector's field: a number written into a uniform's
  // own value is a number made each frame (its field holds every kind of value), a vector's field is written in place
  const turnV = uniform(new THREE.Vector4(0, 0, 0, 0));
  return {
    steps: uniform(40), scale: uniform(1), so: v3(0, 0, 0),
    colour1: v3(), colour2: v3(), glow: uniform(1), density: uniform(1), see: uniform(0), cut: uniform(0.5), soft: uniform(0.3),
    detail: uniform(0.8), form: uniform(0.3), core: uniform(0.6), shapeInv: v3(), twist: uniform(0), turb: uniform(0.15),
    turnV, turn: turnV.x, wob: v3(0, 0, 0), sunlit: uniform(0), sunDir: v3(0, 0, 1), sunPower: uniform(1), sunColour: v3(),
    mawR: uniform(0), rimColour: v3(1, 0.7, 0.4), rimK: uniform(0), bendK: uniform(0), flashOn: uniform(0), flashGain: uniform(1), flashDepth: uniform(0.55),
    gain: uniform(1), body: uniform(0),
    inner: uniform(0), innerTint: v3(), knots: uniform(0), dust: uniform(0), discK: uniform(0), spin: uniform(1), eye: uniform(0), halo: uniform(0),
    occ: Array.from({ length: OCC }, () => uniform(new THREE.Vector4(0, 0, 0, 0))),
  };
}

function densityOf(chan, V) {
  return (p) => {
    const r = length(p);
    // the swirl winds the gas round its heart (the inner parts more); the drift turns it all
    const ang = V.twist.div(r.add(0.3)).add(V.turn);
    const ca = cos(ang), sa = sin(ang);
    const q = vec3(p.x.mul(ca).sub(p.z.mul(sa)), p.y, p.x.mul(sa).add(p.z.mul(ca)));
    // its currents: the gas pushed about by a slow field whose read moves on a small circle
    const w0 = chan(q.mul(0.8).add(V.wob)).xyw.sub(0.5);
    const w = w0.mul(V.turb);
    const c = chan(q.add(w));
    const det = mix(c.y, c.z, V.form);
    const v = c.x.add(det.sub(0.5).mul(V.detail)).add(float(0.5).sub(r).mul(V.core));
    // its outline: the shape's own (flattened, stretched), bent out of true by the currents' field (so
    // it is lopsided, never a ball), pushed in and out by the large shapes and the currents (whole lobes)
    // and frayed by the small ones; always inside the ball
    const s = length(p.add(w0.mul(0.9)).mul(V.shapeInv)).add(c.x.sub(0.5).mul(0.9)).add(c.w.sub(0.5).mul(1.3)).add(det.sub(0.5).mul(0.3));
    const fall = float(1).sub(smoothstep(0.5, 0.97, s)).mul(float(1).sub(smoothstep(0.85, 1.0, r)));
    // the heart's pull sweeps an eye clear round it, so the dark heart, its ring and its hot gas read
    const eye = mix(float(1), smoothstep(V.mawR.mul(1.3), V.mawR.mul(3.6), r), V.eye);
    // the density, and where the colour ramp stands: thick gas toward the first colour, with the
    // small detail running the thin colour through it (so a nebula is never one flat colour)
    const d0 = smoothstep(V.cut, V.cut.add(V.soft), v).mul(fall);
    // faint outer wisps: the thinnest gas, below the fill's cut, reaching past the bright body toward
    // the ball's edge, so it fades into space as a nebula does rather than ending at a skin
    // (along the ridges only: strands, not a haze round a ball)
    const wisp = smoothstep(V.cut.sub(0.3), V.cut.add(0.05), v).mul(smoothstep(0.5, 0.85, c.y))
      .mul(float(1).sub(smoothstep(0.6, 1.25, s))).mul(float(1).sub(smoothstep(0.75, 0.98, r))).mul(V.halo.mul(0.22));
    const d = d0.add(wisp.mul(float(1).sub(d0))).mul(eye);
    const ramp = clamp(smoothstep(0.0, 0.7, d).mul(0.7).add(det.sub(0.5).mul(0.9)).add(0.15), 0.0, 1.0);
    // dark dust lanes: thin sheets along the currents' field's zero, frayed by the ridges; they
    // swallow light and give none (edge on, a long dark lane; face on, a faint veil)
    // (the sheet is bent by the large shapes and frayed by the small, so a lane seen edge on is never straight)
    // (broad and soft-edged, few of them: lanes, not cracks)
    const sheet = c.w.sub(0.5).add(c.x.sub(0.5).mul(0.5));
    const lane = float(1).sub(smoothstep(0.015, 0.13, abs(sheet))).mul(c.y.mul(0.7).add(0.45));
    const dust = V.dust.mul(lane).mul(fall);
    return { d, ramp, dust, q, w, w0, ca, sa, r };
  };
}

// The gas's bulk at a point of its twisted frame, from the large shapes alone: what its shadows read.
function bulkAt(large, V, qs, w, w0) {
  const rs = length(qs);
  const L = large(qs.add(w));
  const v = L.add(float(0.5).sub(rs).mul(V.core));
  const s = length(qs.add(w0.mul(0.9)).mul(V.shapeInv)).add(L.sub(0.5).mul(0.9));
  // (the lobes' push is left out: soft shadows from the bulk alone; the eye is kept, so the heart's light
  // reaches the eye's wall)
  const fall = float(1).sub(smoothstep(0.5, 0.97, s)).mul(float(1).sub(smoothstep(0.85, 1.0, rs)));
  const eye = mix(float(1), smoothstep(V.mawR.mul(1.3), V.mawR.mul(3.6), rs), V.eye);
  return smoothstep(V.cut, V.cut.add(V.soft), v).mul(fall).mul(eye);
}
// How much of a light from direction `L` (the twisted frame) reaches a point: two reads toward it,
// the gas between swallowing it as the march does (a little more, so a billow's far side is dark).
function towardLight(large, V, D, L) {
  const q = D.q, w = D.w, w0 = D.w0;
  const od = bulkAt(large, V, q.add(L.mul(0.07)), w, w0).mul(0.12).add(bulkAt(large, V, q.add(L.mul(0.2)), w, w0).mul(0.16));
  return exp(od.mul(V.density.add(0.6)).mul(-3.5));
}

// each storm slot lights at its own depth in the gas, so lightning is not all on one shell
const FLASH_DEPTH = [0.55, 1.4, 0.8, 1.2, 0.62, 1.5, 0.95, 0.72];
function flashSum(W, V, p) {
  let g = float(0);
  for (let i = 0; i < STORM_SLOTS; i++) {
    const c = W.cells[i];
    const dv = p.sub(c.xyz.mul(V.flashDepth.mul(FLASH_DEPTH[i % FLASH_DEPTH.length])));
    g = g.add(c.w.mul(exp(dot(dv, dv).mul(W.invSpread2).mul(W.cellInv[i]).negate())));
  }
  return W.flashColour.mul(g);
}

// The hot gas round the heart, where a ray crosses its plane at `x`: a flat ring wound into thin arcs,
// hottest at its inner edge, its near side brighter where it comes at us (`dir`: the ray, maybe bent).
function discAt(chan, V, x, dir) {
  const rh = V.mawR;
  const rr = max(length(x.xz), 0.0001);
  const prof = smoothstep(rh.mul(1.05), rh.mul(1.6), rr).mul(float(1).sub(smoothstep(rh.mul(2.2), rh.mul(5.5), rr)))
    .mul(min(rh.mul(1.8).div(rr).pow(2.0), 3.0));
  const a = V.turn.mul(8.0).add(V.spin.mul(0.22).div(max(rr, rh)));
  const ca = cos(a), sa = sin(a);
  const n = chan(vec3(x.x.mul(ca).sub(x.z.mul(sa)), 0.123, x.x.mul(sa).add(x.z.mul(ca))).mul(2.2)).y;
  const streak = n.mul(n).mul(1.2).add(0.25);
  const vel = vec3(x.z, 0.0, x.x.negate()).div(rr).mul(V.spin);
  const beam = clamp(dot(vel, dir).mul(-0.6).add(1.0), 0.25, 1.8);
  // (pass 2, wave 4b: toward a warm white, not a near white, so the heart's disc keeps its rim colour)
  const hot = mix(V.rimColour, vec3(HOT_EDGE.colour[0], HOT_EDGE.colour[1], HOT_EDGE.colour[2]), smoothstep(rh.mul(2.4), rh.mul(1.15), rr).mul(HOT_EDGE.share));
  const k = prof.mul(streak);
  return vec4(hot.mul(k.mul(beam).mul(V.discK)), clamp(k.mul(V.discK).mul(0.35), 0.0, 0.85));
}

function marchMaterial(V, W, chan, large) {
  const dens = densityOf(chan, V);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide, blending: THREE.CustomBlending });
  // premultiplied: the gas's light added, what is behind it kept by what the gas lets through
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  const out = Fn(() => {
    const ro = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz.toVar();
    const rd = normalize(positionLocal.sub(ro)).toVar();
    const b = dot(ro, rd).toVar();
    const sh = sqrt(max(b.mul(b).sub(dot(ro, ro).sub(1.0)), 0.0));
    const t0 = max(b.negate().sub(sh), 0.0).toVar();
    const t1 = b.negate().add(sh).toVar();
    // the bodies in the way: the gas ends where one stands
    for (let i = 0; i < OCC; i++) {
      const o = V.occ[i];
      const oc = ro.sub(o.xyz);
      const ob = dot(oc, rd);
      const oh = ob.mul(ob).sub(dot(oc, oc).sub(o.w.mul(o.w)));
      const ot = ob.negate().sub(sqrt(max(oh, 0.0)));
      t1.assign(select(oh.greaterThan(0.0).and(o.w.greaterThan(0.0)).and(ot.greaterThan(0.0)), min(t1, ot), t1));
    }
    const tc = b.negate();
    const imp = length(ro.add(rd.mul(tc)));
    // the look's own body inside the gas (its Surface layer on): the gas ends at it too, so the gas
    // behind the body is hidden and the gas in front veils it (radius in the ball's units, 0: none)
    const hb = V.body.mul(V.body).sub(imp.mul(imp));
    const tb = tc.sub(sqrt(max(hb, 0.0)));
    t1.assign(select(hb.greaterThan(0.0).and(V.body.greaterThan(0.0)).and(tb.greaterThan(0.0)), min(t1, tb), t1));
    // the heart: a ray that meets it ends there, in black; its rim glows round it
    const rh = V.mawR;
    const hh = rh.mul(rh).sub(imp.mul(imp));
    const th = tc.sub(sqrt(max(hh, 0.0)));
    const hole = hh.greaterThan(0.0).and(rh.greaterThan(0.0)).and(th.lessThan(t1)).and(th.greaterThan(0.0));
    t1.assign(select(hole, th, t1));
    const dt = max(t1.sub(t0), 0.0).div(V.steps).toVar();
    // each pixel starts a different fraction of a step in (no banding: a fine grain instead)
    const jit = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
    const T = float(1).toVar(), C = vec3(0.0).toVar(), Tc = float(1).toVar();
    const t = t0.add(dt.mul(jit)).toVar();
    const p = ro.add(rd.mul(t)).toVar();
    const pp = p.toVar();
    const dir = rd.toVar();
    Loop(MAX_STEPS, ({ i }) => {
      If(float(i).greaterThanEqual(V.steps).or(T.lessThan(0.004)), () => { Break(); });
      const D = dens(p);
      // never flown into: when a place is so wide the eye stands inside the ball, the gas within a
      // third of its radius of the eye thins away, so it stays scenery and never fogs the view
      // (the GPU port's pass 2, wave 4b: and out to most of a radius, NEAR_FADE, for a ball wider than
      // about 72 degrees, whose near side then stands within 0.7 radii of the eye: the gas there,
      // magnified several times over the rest, was drawn as long smeared streaks over a planet the veil
      // stands in front of; a narrower ball's nearest gas is past it and keeps every wisp)
      const near = smoothstep(NEAR_FADE.from, NEAR_FADE.to, t);
      const d = D.d.mul(near).toVar(), dust = D.dust.mul(near).toVar();
      If(d.add(dust).greaterThan(0.001), () => {
        // the light at this point: the gas's own glow (gathered into its thickest knots, as a real
        // nebula's glow grows with the square of its density), the sun's from its side and the
        // heart's from within, each shadowed by the gas between
        const light = vec3(V.glow.mul(mix(float(1), d.mul(2.0), V.knots))).toVar();
        If(V.sunlit.greaterThan(0.0), () => {
          const Ls = vec3(V.sunDir.x.mul(D.ca).sub(V.sunDir.z.mul(D.sa)), V.sunDir.y, V.sunDir.x.mul(D.sa).add(V.sunDir.z.mul(D.ca)));
          light.addAssign(V.sunColour.mul(V.sunlit.mul(V.sunPower).mul(towardLight(large, V, D, Ls))));
        });
        If(V.inner.greaterThan(0.0), () => {
          const Lh = D.q.div(max(D.r, 0.0001)).negate();
          const Ih = float(1.6).div(D.r.mul(D.r).mul(10.0).add(1.0));
          light.addAssign(V.innerTint.mul(V.inner.mul(Ih).mul(towardLight(large, V, D, Lh))));
        });
        const col = mix(V.colour2, V.colour1, D.ramp);
        const em = col.mul(light).mul(float(1).sub(clamp(dust.mul(1.5), 0.0, 1.0))).toVar();
        If(V.flashOn.greaterThan(0.0), () => { em.addAssign(flashSum(W, V, p).mul(V.flashGain)); });
        C.addAssign(em.mul(T.mul(d).mul(dt).mul(2.0)));
        T.mulAssign(exp(d.mul(V.density).add(dust.mul(4.0)).mul(dt).mul(-3.0)));
      });
      Tc.assign(select(t.lessThan(tc), T, Tc));
      // the light bent round the heart, a little
      If(V.bendK.greaterThan(0.0), () => {
        const r2 = max(dot(p, p), 0.0004);
        dir.assign(normalize(dir.sub(p.mul(V.bendK.mul(dt).div(r2.mul(sqrt(r2)))))));
      });
      pp.assign(p);
      p.addAssign(dir.mul(dt));
      t.addAssign(dt);
      // the hot ring round the heart, where the (bent) ray crosses its plane: so its far side shows
      // over the heart's top when the light is bent enough
      If(V.discK.greaterThan(0.0).and(pp.y.mul(p.y).lessThan(0.0)), () => {
        const x = mix(pp, p, pp.y.div(pp.y.sub(p.y)));
        const disc = discAt(chan, V, x, dir);
        C.addAssign(disc.xyz.mul(T));
        T.mulAssign(float(1).sub(disc.w));
      });
    });
    // the photon ring hugging the heart, a soft halo outside it, the side coming at us brighter; seen
    // through the gas in front of it (and not when a body stands before it)
    const ring = imp.sub(rh.mul(1.035)).div(rh.mul(0.045).add(0.00001));
    const out = max(imp.sub(rh), 0.0).div(rh.add(0.00001));
    const halo = select(imp.greaterThan(rh), exp(out.mul(-2.2)).mul(0.4).add(exp(out.mul(-0.45)).mul(0.08)), float(0));
    const pc = ro.add(rd.mul(tc));
    const vel = normalize(vec3(pc.z, 0.0, pc.x.negate()).add(vec3(0.00001, 0.0, 0.0))).mul(V.spin);
    const beam = clamp(dot(vel, rd).mul(-0.5).add(1.0), 0.35, 1.6);
    const rimOn = select(tc.lessThan(t1).and(tc.greaterThan(t0)), float(1), float(0));
    C.addAssign(V.rimColour.mul(V.rimK.mul(exp(ring.mul(ring).negate()).mul(1.3).add(halo)).mul(beam).mul(Tc).mul(rimOn)));
    // the heart is black whatever shows through the gas
    const a = select(hole, float(1), float(1).sub(T).mul(float(1).sub(V.see)));
    // the gas's own soft shoulder (the stage draws with no tone mapping): its brightest knots roll off
    // toward white instead of clipping to one flat colour
    const G = C.mul(V.gain);
    const m = max(max(G.x, G.y), max(G.z, 0.00001));
    const f = select(m.greaterThan(0.7), float(0.7).add(float(0.3).mul(float(1).sub(exp(m.sub(0.7).div(-0.3))))), m);
    // (pass 2, wave 4b: the grey the shoulder adds held to SHOULDER's most, so a bright heart keeps its colour)
    const Gc = G.mul(f.div(m)).add(vec3(min(m.sub(f), SHOULDER.most).mul(SHOULDER.white)));
    return vec4(Gc, a);
  })();
  mat.colorNode = out;
  mat.name = 'volume-march';
  return mat;
}

// ---------------------------------------------------------------------------------------------
// One volume on the stage: its sphere, its two materials (live and baked), its storm clock.

let proxy = null;
const proxyGeometry = () => proxy || (proxy = new THREE.SphereGeometry(1.03, 48, 24));

/**
 * Build a look's volume into `parent`; `set` its baked noise (VolumeSet), `seed` for its storms;
 * `body`: the look draws a body of radius 1 inside the gas (its Surface layer on), so the gas reaches
 * round it (the "Reach round a body" dial) and ends where the body stands.
 */
export function buildVolume(gen, set, parent, onFlash, { body = false } = {}) {
  const V = volumeUniforms();
  const W = weatherUniforms();
  const live = marchMaterial(V, W, (x) => volChannels(x.mul(V.scale), V.so), (x) => volLarge(x.mul(V.scale), V.so));
  const baked = marchMaterial(V, W, (x) => atlasAt(set.rt.texture, x), (x) => atlasAt(set.rt.texture, x).x);
  const mesh = new THREE.Mesh(proxyGeometry(), live);
  mesh.renderOrder = 8; // after a body's own layers
  mesh.frustumCulled = false;
  parent.add(mesh);
  let h = 2166136261;
  for (const ch of String(gen.seed) + 'volume') h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const storms = new Storms(h >>> 0, false);
  storms.onFlash = (x, y, z, peak) => onFlash?.(x, y, z, peak);
  const vol = { V, W, mesh, live, baked, set, storms, body, tier: 'high', _mi: new THREE.Matrix4(), _v: new THREE.Vector3(), occN: 0 };
  syncVolume(vol, gen);
  return vol;
}

const _c = new THREE.Color();
const lin = (u, hex) => { _c.setStyle(hex || '#808080'); u.value.set(_c.r, _c.g, _c.b); };
/** The dials into the uniforms (when a control moves, never a frame). */
export function syncVolume(vol, gen) {
  const d = gen.volume.dials, V = vol.V, W = vol.W;
  V.scale.value = +d.scale || 1;
  seedShift(gen.seed, V.so.value);
  vol.seed = gen.seed;
  lin(V.colour1, d.colour1); lin(V.colour2, d.colour2);
  V.glow.value = +d.glow; V.density.value = +d.density; V.see.value = +d.see;
  const cover = +d.cover;
  V.cut.value = 0.85 - cover * 0.7;
  V.soft.value = +d.soft;
  V.detail.value = +d.detail; V.form.value = +d.form; V.core.value = +d.core;
  const st = Math.max(1, +d.stretch || 1);
  V.shapeInv.value.set(1, st / Math.max(0.1, +d.flatten || 1), st);
  V.twist.value = +d.swirl * 0.35;
  V.turb.value = +d.turb;
  V.sunlit.value = +d.sunlit;
  const maw = +d.maw;
  V.mawR.value = maw > 0.001 ? +d.mawSize * Math.min(1, 0.25 + maw * 0.75) : 0;
  lin(V.rimColour, d.rimColour);
  V.rimK.value = maw * +d.rim;
  V.bendK.value = maw * +d.bend * +d.mawSize * 0.5;
  V.discK.value = maw * (+d.disc || 0) * 1.5;
  V.eye.value = V.mawR.value > 0 ? Math.min(1, maw * 1.3) : 0;
  // the heart's light from within is the gas's own colour, warmed toward the rim's as the heart shows
  V.inner.value = +d.inner || 0;
  _c.setStyle(d.rimColour || '#ffb070');
  const wm = Math.min(1, maw * 1.4);
  V.innerTint.value.set(1 + (_c.r - 1) * wm, 1 + (_c.g - 1) * wm, 1 + (_c.b - 1) * wm);
  V.knots.value = +d.knots || 0;
  V.dust.value = +d.dust || 0;
  V.halo.value = +d.wisps || 0;
  // which way it turns (its drift's way, else its swirl's): the side of the ring coming at us is brighter
  V.spin.value = (+d.drift || +d.swirl || 1) < 0 ? -1 : 1;
  // tipped toward the viewer about its own x axis (the sun, the bodies and the storms follow: they are
  // read through the ball's world matrix each frame)
  vol.mesh.rotation.x = ((+d.lean || 0) * Math.PI) / 180;
  // round a body the ball reaches out past it (gas alone: the ball is the look's own unit ball)
  const reach = vol.body ? Math.max(1.2, +d.reach || 3) : 1;
  vol.mesh.scale.setScalar(reach);
  V.body.value = vol.body ? 1 / reach : 0;
  V.flashOn.value = +d.flashes > 0 ? 1 : 0;
  V.flashGain.value = 4; // a flash outshines the gas's own glow many times over, so it shows through the storm
  lin(W.flashColour, d.flashColour);
  const sp = Math.max(0.01, +d.flashSize || 0.14);
  W.invSpread2.value = 1 / (sp * sp);
  W.invSpread.value = 1 / sp;
  vol.gen = gen;
}

/**
 * Every frame: the tier, the drift's turn and the currents' circle (from the weather's motion clock),
 * the lightning (from the wall's), the sun in the volume's own frame. Nothing is made here.
 */
export function updateVolume(vol, { motion, wall, lightWorld, sunPower = 1, sunColour = null, gain = 1, noStorms = false }) {
  const tier = volumeTier();
  if (vol.tier !== tier) {
    vol.tier = tier;
    const T = VOLUME_TIERS[tier];
    vol.mesh.material = T.live ? vol.live : vol.baked;
  }
  const d = vol.gen.volume.dials, V = vol.V;
  // a new seed rebakes the noise volume the cheaper tiers read (no sync of the dials follows it), so
  // the live tier's shift of the noise follows here, at every place showing the look
  if (vol.seed !== vol.gen.seed) { seedShift(vol.gen.seed, V.so.value); vol.seed = vol.gen.seed; }
  V.steps.value = VOLUME_TIERS[tier].steps;
  V.turnV.value.x = ((+d.drift * Math.PI) / 180 / 60) * motion;
  const w = motion * (+d.churn || 0) * 0.12;
  // (pass 2, wave 4b: each written into its field: a number handed to a call is a number made, and the game runs this a frame)
  const wob = V.wob.value;
  wob.x = 0.15 * Math.cos(w);
  wob.y = 0.07 * Math.sin(w * 0.73);
  wob.z = 0.15 * Math.sin(w);
  V.gain.value = gain;
  V.sunPower.value = sunPower;
  if (sunColour) V.sunColour.value.copy(sunColour);
  vol.mesh.updateWorldMatrix(true, false);
  vol._mi.copy(vol.mesh.matrixWorld).invert();
  if (lightWorld) V.sunDir.value.copy(lightWorld).transformDirection(vol._mi);
  // (the GPU port's pass 2, wave 4b) `noStorms`: the game's frame leaves the gas's lightning out, every flash dark, until the
  // storms' step takes its numbers from a kept record (handed across this call, each makes a number a frame: the game's rule)
  if (noStorms) {
    const cells = vol.W.cells;
    for (let i = 0; i < STORM_SLOTS; i++) if (cells[i].value.w !== 0) cells[i].value.w = 0;
    return;
  }
  vol.storms.step(wall, +d.flashes > 0, +d.flashes, +d.flashBright, Math.max(0.01, +d.flashSize || 0.14), vol.W.cells, vol.W.cellInv);
}

/**
 * The bodies in the volume's way this frame: `list` of Vector4 (world centre, world radius), `n` of them.
 * (the GPU port's pass 2, wave 4b: every number written into its field, the ball's scale worked from its matrix's columns where it
 * stands, since a number handed to a call the compiler does not build in is a number made, and the game draws this a frame)
 */
export function volumeOccluders(vol, list, n) {
  const e = vol.mesh.matrixWorld.elements;
  const sx = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  const sy = e[4] * e[4] + e[5] * e[5] + e[6] * e[6];
  const sz = e[8] * e[8] + e[9] * e[9] + e[10] * e[10];
  const s = Math.sqrt(Math.max(sx, sy, sz)) || 1;
  const m = vol._mi.elements;
  let k = 0;
  for (let i = 0; i < n && k < OCC; i++) {
    const o = list[i];
    if (!(o.w > 0)) continue;
    const u = vol.V.occ[k++].value;
    u.x = m[0] * o.x + m[4] * o.y + m[8] * o.z + m[12];
    u.y = m[1] * o.x + m[5] * o.y + m[9] * o.z + m[13];
    u.z = m[2] * o.x + m[6] * o.y + m[10] * o.z + m[14];
    u.w = o.w / s;
  }
  for (; k < OCC; k++) vol.V.occ[k].value.w = 0;
  vol.occN = n;
}

export function disposeVolume(vol) {
  if (!vol) return;
  vol.live.dispose();
  vol.baked.dispose();
  vol.mesh.removeFromParent();
}

// ---------------------------------------------------------------------------------------------
// The cost of each tier on this card: the stage drawn `n` times with the volume and `n` times without,
// waiting for the card each time, at the canvas's size. `render` draws one frame; `show` hides or shows
// the volumes. For checks (the page's __viewer.volumeCost).

export async function measureTiers(renderer, render, show, { n = 24, tiers = ORDER } = {}) {
  const dev = renderer.backend?.device;
  const sync = dev ? () => dev.queue.onSubmittedWorkDone() : () => renderer.backend?.gl?.finish?.();
  const time = async () => {
    for (let i = 0; i < 3; i++) render();
    await sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) render();
    await sync();
    return (performance.now() - t0) / n;
  };
  const was = Q.mode;
  const out = {};
  // every tier's material put on and made first, then the card warmed, so no time is a first time
  for (const t of tiers) { Q.mode = t; for (let i = 0; i < 4; i++) render(); await sync(); }
  show(false);
  const none1 = await time();
  show(true);
  for (const t of tiers) {
    Q.mode = t;
    render();
    await sync();
    out[t] = await time();
  }
  show(false);
  const none2 = await time();
  show(true);
  Q.mode = was;
  out.none = (none1 + none2) / 2;
  const res = {};
  for (const t of tiers) res[t] = { frameMs: +out[t].toFixed(2), volumeMs: +Math.max(0, out[t] - out.none).toFixed(2) };
  return { without: +out.none.toFixed(2), withoutRuns: [+none1.toFixed(2), +none2.toFixed(2)], tiers: res };
}
