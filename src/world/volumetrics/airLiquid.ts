// Water and lava (the fifth wave, the design's §2.9): the liquid tile's reach into the water's and the lava's own
// programs, the ripples carried by it, and the arithmetic every one of those is held to.
//
// **The liquid tile** is a tile of the air's atlas (`airAtlas.ts`) the same solver steps: its obstacle is the land (the
// colour raster's medium byte, so a current runs round shores and islands and sheds eddies behind them), water is pulled
// toward its share of the wind and lava toward stillness, and either toward a ribbon's own flow where the terrain lays one
// down a slope. What it is pulled toward is one GLSL function here (`LIQUID_TARGET_GLSL`), which the solver's advect pass
// takes in, so the seventh wave's one wind sets it by the air's own branch in this one place.
//
// **One session record** (`LIQUID_U`) is what every reader of the current holds by reference: the water's current variant
// and both its mask twins (`water.ts`), the lava's crust twin (`lavaCrustMaterial`), the ripples' carry (`RippleCarryPass`).
// The field the world has taken writes it at the end of every frame (`AirField.writeLiquid`), and nothing else does, so a
// field made and thrown away (the in-play warm's) can never be what the water reads; with no field, or the master off, its
// two art shares are nought and every reader is the plain one by its own uniform branch.
//
// **The ripples carried.** The ripple field (`waterSim.ts`) is a height field in a window of its own; carried by the
// current, a frame's first step reads it at `uv + scroll − current · dt / window` through a Catmull-Rom filter made of
// `texelFetch` taps, which is exact at a whole-texel offset (a still current is an exact copy) and damps a ripple about a
// tenth as much as a bilinear carry would (the design's §2.9, held by `rippleCarry.test.ts`).
//
// Nothing here is made on a frame: the materials with the world, their numbers in kept vectors.
import * as THREE from 'three';
import { AIR_TUNE } from './airTune.ts';
import { WATER_SIM_WINDOW, type RippleCarry } from '../waterSim.ts';

/** The record every reader of the current holds by reference (the water's variant and twins, the lava's twin, the carry). */
export interface LiquidUniforms {
  /** The air's velocity atlas as it stands (the liquid tile is one of its tiles). */
  uAirLiquidVel: { value: THREE.Texture | null };
  /** The air window's corner x and z, its size (metres), and its edge band's share, across which the current fades out. */
  uAirLiquidWin: { value: THREE.Vector4 };
  /** The liquid tile's rectangle in the atlas's uv (x, y, w, h). */
  uAirLiquidRect: { value: THREE.Vector4 };
  /** Half a texel of the atlas, x and y: every read clamped that far inside the tile. */
  uAirLiquidHalf: { value: THREE.Vector2 };
  /**
   * x how far the current moves the water's detail and carries the ripples (`volArtWater`, nought off), y how far the
   * crust is carried (`volArtLava`, nought off), z the water detail's share of the current's own speed
   * (`liquid.detailFlow`), w the debug view (0 none, 1 the current on the water, 2 the crust's carry on the lava).
   */
  uAirLiquidP: { value: THREE.Vector4 };
  /** The crust's two phases: x phase A's seconds since its restart, y phase B's, z phase B's weight, w one over the cycle. */
  uAirLiquidQ: { value: THREE.Vector4 };
}

/** A fresh record: every number a double from its first write, the shares nought (every reader plain). */
export function makeLiquidUniforms(): LiquidUniforms {
  const u: LiquidUniforms = {
    uAirLiquidVel: { value: null },
    uAirLiquidWin: { value: new THREE.Vector4(0.5, 0.5, 192, AIR_TUNE.window.edge) },
    uAirLiquidRect: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
    uAirLiquidHalf: { value: new THREE.Vector2(0.5, 0.5) },
    uAirLiquidP: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
    uAirLiquidQ: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
  };
  liquidOff(u);
  return u;
}

/** The record with nothing to read: both shares nought, no texture, no view (a field let go, the master off). */
export function liquidOff(u: LiquidUniforms): void {
  u.uAirLiquidVel.value = null;
  const p = u.uAirLiquidP.value;
  p.x = 0;
  p.y = 0;
  p.w = 0;
}

/** The session's one record: the world's field writes it (`AirField.writeLiquid`), every reader holds it by reference. */
export const LIQUID_U: LiquidUniforms = makeLiquidUniforms();

/**
 * The liquid tile's current at a world point, m/s in x and z, and how far in from the window's edge band (0 outside the
 * window, 1 inside the band, eased across it): read the shaders' way, clamped half a texel inside the tile. Needs the
 * record's uniforms declared (`LIQUID_PARS_GLSL`). Made finite.
 */
export const LIQUID_PARS_GLSL = /* glsl */ `
uniform sampler2D uAirLiquidVel;
uniform vec4 uAirLiquidWin;
uniform vec4 uAirLiquidRect;
uniform vec2 uAirLiquidHalf;
uniform vec4 uAirLiquidP;
uniform vec4 uAirLiquidQ;
// How far in from the window's edge band a window place is, eased: nought at the edge, one a band's width inside.
float airLiquidEdge(float lx, float ly) {
  float e = min(min(lx, 1.0 - lx), min(ly, 1.0 - ly));
  float edge = clamp(e / max(uAirLiquidWin.w, 1e-4), 0.0, 1.0);
  return edge * edge * (3.0 - 2.0 * edge);
}
// One axis of the liquid tile's atlas coordinate at window place l: the tile's origin and size along it, the read held
// half a texel (hf) inside the tile, never in the slab beside it.
float airLiquidAtlas(float l, float origin, float size, float hf) {
  return origin + clamp(l * size, hf, size - hf);
}
vec3 airLiquidAt(vec2 xz) {
  vec2 l = (xz - uAirLiquidWin.xy) / uAirLiquidWin.z;
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) return vec3(0.0);
  vec2 a = vec2(airLiquidAtlas(l.x, uAirLiquidRect.x, uAirLiquidRect.z, uAirLiquidHalf.x), airLiquidAtlas(l.y, uAirLiquidRect.y, uAirLiquidRect.w, uAirLiquidHalf.y));
  vec2 c = texture2D(uAirLiquidVel, a).xy;
  if (any(isnan(c)) || any(isinf(c))) c = vec2(0.0);
  return vec3(c, airLiquidEdge(l.x, l.y));
}
`;

/**
 * The water's detail flow with the current laid in (the water's variant, the design's §2.9): `f + k · (c − f)`, `f`
 * today's `flowAt`, `c` the current in `flowAt`'s own units, `k` the art share times how far in from the window's edge.
 * At a share of nought it is `f` itself by a uniform branch, and outside the window `f` itself; never a function applied
 * to `f` whatever `k`. The units: `detailSlope` carries its tile `flow · uDrift · detailFlow` metres a cycle of its
 * crossfade and the crossfade runs `detailCycle` cycles a second, so the tile drifts at `flow · uDrift · detailFlow ·
 * detailCycle` m/s and a current of `c` m/s is `c / (uDrift · detailFlow · detailCycle)` in its units (both constants
 * `water.ts`'s own, handed in, so the test reads them there). The view (`uAirLiquidP.w` 1) colours the water by the
 * current: its direction in red and green, its speed in blue (2 m/s full).
 */
export function waterCurrentGlsl(detailFlow: number, detailCycle: number): string {
  return /* glsl */ `
${LIQUID_PARS_GLSL}
vec2 waterAirFlow(vec2 f, vec2 xz) {
  if (uAirLiquidP.x <= 0.0) return f;
  vec3 c = airLiquidAt(xz);
  float k = uAirLiquidP.x * c.z;
  if (k <= 0.0) return f;
  vec2 cf = c.xy * (uAirLiquidP.z / max(uDrift * ${detailFlow.toFixed(4)} * ${detailCycle.toFixed(4)}, 1e-6));
  return f + k * (cf - f);
}
void waterAirView(inout vec4 colour, vec2 xz) {
  if (uAirLiquidP.w < 0.5 || uAirLiquidP.w > 1.5) return;
  vec3 c = airLiquidAt(xz);
  float s = length(c.xy);
  vec2 d = s > 1e-3 ? c.xy / s : vec2(0.0);
  colour = vec4(0.5 + 0.5 * d.x, 0.5 + 0.5 * d.y, clamp(s / 2.0, 0.0, 1.0), 1.0);
}
`;
}

/** The substitution the variant makes, at the one place today's water asks its detail's flow (`water.ts`). */
export const WATER_FLOW_FROM = 'vec2 slope = detailSlope(vWaterXZ, flowAt(shoreGrad, depth))';
export const WATER_FLOW_TO = 'vec2 slope = detailSlope(vWaterXZ, waterAirFlow(flowAt(shoreGrad, depth), vWaterXZ))';
/** The view's anchor: after the foam's last word on the colour, in the variant alone. */
export const WATER_VIEW_FROM = 'diffuseColor.a = mix(diffuseColor.a, 1.0, waterFoam * 0.5);';
export const WATER_VIEW_TO = 'diffuseColor.a = mix(diffuseColor.a, 1.0, waterFoam * 0.5);\n        waterAirView(diffuseColor, vWaterXZ);';

/**
 * The water's flow with the current laid in, on the CPU: the variant's `waterAirFlow` line for line, for the tests (a
 * share of nought or a point off the window answers `f` itself).
 */
export function waterAirFlowMirror(fx: number, fz: number, cx: number, cz: number, share: number, edge: number, drift: number, detailFlowShare: number, detailFlow: number, detailCycle: number, out: { x: number; z: number }): void {
  if (!(share > 0)) {
    out.x = fx;
    out.z = fz;
    return;
  }
  const k = share * edge;
  if (!(k > 0)) {
    out.x = fx;
    out.z = fz;
    return;
  }
  const scale = detailFlowShare / Math.max(drift * detailFlow * detailCycle, 1e-6);
  out.x = fx + k * (cx * scale - fx);
  out.z = fz + k * (cz * scale - fz);
}

/**
 * How far the water's detail tile has moved at `time` seconds under a steady flow (`detailSlope`'s phase A, metres):
 * `flow · drift · detailFlow · fract(time · detailCycle)`; its rate is the tile's own speed, which is what the variant's
 * units are worked out from.
 */
export function detailCarried(flow: number, drift: number, detailFlow: number, detailCycle: number, time: number): number {
  const t = time * detailCycle;
  return flow * drift * detailFlow * (t - Math.floor(t));
}

/**
 * What the liquid is pulled toward (the solver's advect pass, the liquid tile alone): the wind times the medium's own
 * share of it, gusts and all, plus the liquid's own flow there (a ribbon's, the flow raster `uFlowR`) times its share
 * (`uLiquidR.y`). One function, so the seventh wave's one wind sets the target here and nowhere else: under its arm the
 * unified wind there (`w7Target`, the air's own branch), else the gusts' `windHere`. Needs those two, `w7On` and the
 * uniforms `uFlowR` and `uLiquidR`.
 */
export const LIQUID_TARGET_GLSL = /* glsl */ `
// The wind the air and the liquid are pulled toward at world place w, for an inflow wind (the seventh wave): under the
// unified wind's arm the wind where its gust travels (w7Target), else the air's own gust cells (windHere), as before. One
// function, the advect's and the liquid's, so the tests run this very choice.
vec2 airTarget(vec2 w, vec2 wind) {
  return w7On() ? w7Target(w, wind) : windHere(w, wind);
}
vec2 liquidTarget(vec2 w, vec2 l, float windShare) {
  vec2 own = texture(uFlowR, clamp(l, 0.0, 1.0)).xy * uLiquidR.y;
  if (any(isnan(own)) || any(isinf(own))) own = vec2(0.0);
  vec2 wind = uWind * windShare;
  return airTarget(w, wind) + own;
}
`;

/**
 * The liquid's advect's own rule for one cell, on the CPU (the tests' mirror of the advect's `liquidStep` over its
 * target, the gusts left out; `waterCurrent.test.ts` runs the GLSL against it): the back-traced velocity in `vx`, `vz`
 * dissipated, then pulled toward its target -- the wind times
 * its medium's share plus its own flow times the flow's share (`LIQUID_TARGET_GLSL`) -- at its medium's relax, held to
 * the liquid's fastest; the answer written back into `vx`, `vz`. A kept record, nothing made.
 */
export interface LiquidRule {
  vx: number;
  vz: number;
  relax: number;
  diss: number;
  share: number;
  windX: number;
  windZ: number;
  flowX: number;
  flowZ: number;
  flowShare: number;
  cap: number;
  dt: number;
}

export function newLiquidRule(): LiquidRule {
  return { vx: 0.5, vz: 0.5, relax: AIR_TUNE.liquid.waterRelax, diss: AIR_TUNE.liquid.waterDiss, share: AIR_TUNE.liquid.waterWind, windX: 0.5, windZ: 0.5, flowX: 0, flowZ: 0, flowShare: AIR_TUNE.liquid.ribbonFlow, cap: AIR_TUNE.solver.liquidCap, dt: 1 / 60 };
}

export function liquidTargetRule(r: LiquidRule): void {
  const k = 1 / (1 + r.diss * r.dt);
  const vx = r.vx * k;
  const vz = r.vz * k;
  const tx = r.windX * r.share + r.flowX * r.flowShare;
  const tz = r.windZ * r.share + r.flowZ * r.flowShare;
  let a = r.relax * r.dt;
  a = a < 0 ? 0 : a > 1 ? 1 : a;
  const ox = vx * (1 - a) + tx * a;
  const oz = vz * (1 - a) + tz * a;
  const cap = r.cap;
  r.vx = ox < -cap ? -cap : ox > cap ? cap : ox;
  r.vz = oz < -cap ? -cap : oz > cap ? cap : oz;
}

/**
 * The lava's crust carried by the liquid's current (the design's §2.9): two phases half a cycle apart, each moving the
 * noise's coordinate by the current at the pixel times its seconds since its restart, cross-faded so a restart is never
 * seen, times the art share and the window's edge fade, on top of the style's own constant flow. The plain sample is
 * taken before anything branches (as the base takes its derivatives), and the moved taps take explicit derivatives, so
 * nothing is sampled with undefined ones; at a share of nought the noise is the base's own sample by a uniform branch.
 * The view (`uAirLiquidP.w` 2) shows the carry: the current's speed in red (5 m/s full), its share here in green.
 */
const LAVA_CRUST_PARS = /* glsl */ `
${LIQUID_PARS_GLSL}
uniform mat3 uTcAxes;
uniform float uNoiseScale;
varying vec3 vLavaWorld;
vec3 lavaCrustA;
vec3 lavaCrustB;
float lavaCrustK;
// Where the two phases move the noise's coordinate here, into the globals above (nought where nothing carries it).
void lavaCrustShift() {
  lavaCrustA = vec3(0.0);
  lavaCrustB = vec3(0.0);
  lavaCrustK = 0.0;
  if (uAirLiquidP.y <= 0.0) return;
  vec3 cl = airLiquidAt(vLavaWorld.xz);
  float k = uAirLiquidP.y * cl.z;
  if (k <= 0.0) return;
  vec3 c = uTcAxes * vec3(cl.x, 0.0, cl.y) * (k * uNoiseScale);
  lavaCrustA = c * uAirLiquidQ.x;
  lavaCrustB = c * uAirLiquidQ.y;
  lavaCrustK = k;
}
float lavaCrustNoise(highp sampler3D tex, vec3 tc, vec3 gx, vec3 gy) {
  float plain = texture(tex, tc).r;
  if (lavaCrustK <= 0.0) return plain;
  return mix(textureGrad(tex, tc - lavaCrustA, gx, gy).r, textureGrad(tex, tc - lavaCrustB, gx, gy).r, uAirLiquidQ.z);
}
vec3 lavaCrustMix(sampler2D tex, vec2 uv, vec2 gx, vec2 gy) {
  vec3 plain = texture2D(tex, uv).rgb;
  if (lavaCrustK <= 0.0) return plain;
  return mix(textureGrad(tex, uv - lavaCrustA.xz, gx, gy).rgb, textureGrad(tex, uv - lavaCrustB.xz, gx, gy).rgb, uAirLiquidQ.z);
}
`;

/** The twin's replacements in the base's own lava text, each found exactly once or the twin is not made. */
const LAVA_VERT_FROM = '  vec4 world = modelMatrix * vec4(position, 1.0);';
const LAVA_VERT_TO = '  vec4 world = modelMatrix * vec4(position, 1.0);\n  vLavaWorld = world.xyz;';
const LAVA_VERT_PARS_FROM = 'varying vec3 vNoiseTc;';
const LAVA_VERT_PARS_TO = 'varying vec3 vNoiseTc;\nvarying vec3 vLavaWorld;';
const LAVA_FRAG_PARS_FROM = 'varying vec3 vNoiseTc;\nvoid main() {';
const LAVA_FRAG_PARS_TO = `varying vec3 vNoiseTc;\n${LAVA_CRUST_PARS}\nvoid main() {\n  vec3 lavaGx = dFdx(vNoiseTc);\n  vec3 lavaGy = dFdy(vNoiseTc);\n  lavaCrustShift();`;
const LAVA_INDEX_FROM = 'float index = texture(tNoise, vNoiseTc).r * uColorScale + uColorBias;';
const LAVA_INDEX_TO = 'float index = lavaCrustNoise(tNoise, vNoiseTc, lavaGx, lavaGy) * uColorScale + uColorBias;';
const LAVA_MIX_FROM = 'vec3 crust = texture2D(tMix, vNoiseTc.xz + index * 0.1).rgb;';
const LAVA_MIX_TO = 'vec3 crust = lavaCrustMix(tMix, vNoiseTc.xz + index * 0.1, lavaGx.xz, lavaGy.xz);';
const LAVA_VIEW_FROM = '  gl_FragColor = vec4(rgb, 1.0);';
const LAVA_VIEW_TO = '  if (uAirLiquidP.w > 1.5) { vec3 cv = airLiquidAt(vLavaWorld.xz); rgb = vec3(clamp(length(cv.xy) / 5.0, 0.0, 1.0), lavaCrustK, 0.0); }\n  gl_FragColor = vec4(rgb, 1.0);';

/**
 * The twin's replacements in the order they are made, each `[from, to]` (the tests undo them on the twin's text and must
 * find the base's own): the vertex stage's two, then the fragment stage's four. The crust's picture is read only with
 * `USE_MIX`; its line is in the text either way, inside that block.
 */
export const LAVA_CRUST_EDITS: { readonly vertex: readonly (readonly [string, string])[]; readonly fragment: readonly (readonly [string, string])[] } = {
  vertex: [
    [LAVA_VERT_PARS_FROM, LAVA_VERT_PARS_TO],
    [LAVA_VERT_FROM, LAVA_VERT_TO],
  ],
  fragment: [
    [LAVA_FRAG_PARS_FROM, LAVA_FRAG_PARS_TO],
    [LAVA_INDEX_FROM, LAVA_INDEX_TO],
    [LAVA_MIX_FROM, LAVA_MIX_TO],
    [LAVA_VIEW_FROM, LAVA_VIEW_TO],
  ],
};

/** `text` with `from` replaced by `to`, or null where `from` is not found exactly once. */
function replaceOnce(text: string, from: string, to: string): string | null {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + from.length) >= 0) return null;
  return text.slice(0, i) + to + text.slice(i + from.length);
}

/** The crust twin's text from the base's own, every replacement made or none (null). */
export function lavaCrustText(vertex: string, fragment: string): { vertex: string; fragment: string } | null {
  let v: string | null = vertex;
  for (const [from, to] of LAVA_CRUST_EDITS.vertex) if (v) v = replaceOnce(v, from, to);
  let f: string | null = fragment;
  for (const [from, to] of LAVA_CRUST_EDITS.fragment) if (f) f = replaceOnce(f, from, to);
  return v && f ? { vertex: v, fragment: f } : null;
}

/**
 * The crust twin of a lava material (`createLavaMaterial`'s): the base's own text with the crust's carry made in (all of
 * it or none: null where the base's text has moved), its every uniform object shared with the base by reference (so the
 * flow's clock the world writes into the base reaches the twin) and the session record's beside them, a define and a key
 * suffix of its own. Nothing is compiled here.
 */
export function lavaCrustMaterial(base: THREE.ShaderMaterial, u: LiquidUniforms = LIQUID_U): THREE.ShaderMaterial | null {
  const text = lavaCrustText(base.vertexShader, base.fragmentShader);
  if (!text) return null;
  const twin = new THREE.ShaderMaterial({
    name: `${base.name}+crust`,
    vertexShader: text.vertex,
    fragmentShader: text.fragment,
    uniforms: { ...base.uniforms, ...u },
    defines: { ...base.defines, LAVA_AIR: '' },
    fog: base.fog,
    lights: false,
    transparent: base.transparent,
    depthWrite: base.depthWrite,
    side: base.side,
    polygonOffset: base.polygonOffset,
    polygonOffsetFactor: base.polygonOffsetFactor,
    polygonOffsetUnits: base.polygonOffsetUnits,
  });
  twin.userData = { ...base.userData, crust: true };
  return twin;
}

/** What the water's and the lava's choosers are asked (the ground's chooser's shape). */
export interface LiquidChoice {
  /** The master. */
  on: boolean;
  current: boolean;
  lava: boolean;
  /** A field the world holds and the machine can run. */
  field: boolean;
  /** The frame report's soft off: every swapped material back on its plain one. */
  softOff: boolean;
}

/** Whether the water wears its current variant (class M): the master, the current and a field, and no soft off. */
export function waterWearsAir(c: LiquidChoice): boolean {
  return c.on && c.current && c.field && !c.softOff;
}

/** Whether the lava wears its crust twin (class M). */
export function lavaWearsCrust(c: LiquidChoice): boolean {
  return c.on && c.lava && c.field && !c.softOff;
}

/** The water material a body wears: the plain one whenever the master is off, by identity. */
export function waterMaterialFor<M>(c: LiquidChoice, plain: M, air: M | null): M {
  return air !== null && waterWearsAir(c) ? air : plain;
}

/** The lava material a mesh wears: the plain one whenever the master is off, by identity. */
export function lavaMaterialFor<M>(c: LiquidChoice, plain: M, crust: M | null): M {
  return crust !== null && lavaWearsCrust(c) ? crust : plain;
}

/** The crust's clock, a kept record: the seconds and the cycle in, each phase's seconds and phase B's weight out. */
export interface CrustPhase {
  time: number;
  cycle: number;
  tA: number;
  tB: number;
  wB: number;
}

/** A fresh record, every field a double from its first write. */
export function newCrustPhase(): CrustPhase {
  return { time: 0.5, cycle: 3.5, tA: 0.5, tB: 0.5, wB: 0.5 };
}

/**
 * The crust's two phases at `c.time` seconds (`c.cycle` a cycle, `liquid.crustCycle`), into the same record (no number
 * handed across a call): each phase's seconds since its restart and phase B's weight, which is nought where B restarts
 * and one where A does.
 */
export function crustPhaseIn(out: CrustPhase): void {
  const c = out.cycle > 1e-3 ? out.cycle : 1e-3;
  const a = out.time / c;
  const fa = a - Math.floor(a);
  const b = a + 0.5;
  const fb = b - Math.floor(b);
  out.tA = fa * c;
  out.tB = fb * c;
  // Phase A weighs 1 - |2 fa - 1| (nought at its restart); B the rest.
  const wa = 1 - Math.abs(2 * fa - 1);
  out.wB = 1 - wa;
}

/** `crustPhaseIn` with its numbers as arguments (the tests'). */
export function crustPhasesIn(time: number, cycle: number, out: { tA: number; tB: number; wB: number }): void {
  const c = cycle > 1e-3 ? cycle : 1e-3;
  const a = time / c;
  const fa = a - Math.floor(a);
  const b = a + 0.5;
  const fb = b - Math.floor(b);
  out.tA = fa * c;
  out.tB = fb * c;
  // Phase A weighs 1 - |2 fa - 1| (nought at its restart); B the rest.
  const wa = 1 - Math.abs(2 * fa - 1);
  out.wB = 1 - wa;
}

/** Catmull-Rom's four weights at a fraction `f` of a texel, into `out` (exactly 0, 1, 0, 0 at nought). */
export function catmullRomWeights(f: number, out: Float64Array): Float64Array {
  out[0] = ((-0.5 * f + 1) * f - 0.5) * f;
  out[1] = (1.5 * f - 2.5) * f * f + 1;
  out[2] = ((-1.5 * f + 2) * f + 0.5) * f;
  out[3] = (0.5 * f - 0.5) * f * f;
  return out;
}

/**
 * The carry pass's own filter on the CPU, line for line (the tests' mirror): the field `src` of `n` a side (one value a
 * texel, row by row), read at each texel's index plus `sx, sy` (whole texels: the window's move) less `dx, dy` (texels:
 * the current's), Catmull-Rom over 4 by 4 taps, nought outside; at a whole-texel offset the texel itself.
 */
export function carryField(src: Float64Array, n: number, sx: number, sy: number, dx: number, dy: number, out: Float64Array): Float64Array {
  const wx = new Float64Array(4);
  const wy = new Float64Array(4);
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= n || y >= n ? 0 : src[y * n + x]);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const px = i + sx - dx;
      const py = j + sy - dy;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const fx = px - ix;
      const fy = py - iy;
      if (fx === 0 && fy === 0) {
        out[j * n + i] = at(ix, iy);
        continue;
      }
      catmullRomWeights(fx, wx);
      catmullRomWeights(fy, wy);
      let s = 0;
      for (let b = 0; b < 4; b++) {
        let row = 0;
        for (let a = 0; a < 4; a++) row += wx[a] * at(ix - 1 + a, iy - 1 + b);
        s += wy[b] * row;
      }
      out[j * n + i] = s;
    }
  }
  return out;
}

/** The same carry with a bilinear filter (the design's comparison: a bilinear carry diffuses by about `v · texel / 2`). */
export function carryFieldBilinear(src: Float64Array, n: number, sx: number, sy: number, dx: number, dy: number, out: Float64Array): Float64Array {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= n || y >= n ? 0 : src[y * n + x]);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const px = i + sx - dx;
      const py = j + sy - dy;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const fx = px - ix;
      const fy = py - iy;
      const a = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
      const b = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
      out[j * n + i] = a * (1 - fy) + b * fy;
    }
  }
  return out;
}

/**
 * The carry pass: the ripple state read at each texel's place less the current's travel over the seconds owed, plus the
 * window's move, through a Catmull-Rom filter of `texelFetch` taps (exact at a whole-texel offset: the texel itself, by a
 * branch, so a still current copies the field bit for bit), nought outside the ripples' window as their own step reads
 * it; the current faded across the air window's edge band and outside it nought. One full-target draw, its four channels
 * (the height, the height a step ago and the slope) carried alike.
 */
export const CARRY_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uState;
// The ripple window: origin x, origin z, metres across, metres a texel.
uniform vec4 uRipWin;
// x and y the window's move owed, whole texels; z the seconds the current carries over; w the texels across.
uniform vec4 uCarry;
${LIQUID_PARS_GLSL}
vec4 ripState(int x, int y, int n) {
  if (x < 0 || y < 0 || x >= n || y >= n) return vec4(0.0);
  return texelFetch(uState, ivec2(x, y), 0);
}
vec4 ripWeights(float f) {
  return vec4(((-0.5 * f + 1.0) * f - 0.5) * f, (1.5 * f - 2.5) * f * f + 1.0, ((-1.5 * f + 2.0) * f + 0.5) * f, (0.5 * f - 0.5) * f * f);
}
// The world x and z of a ripple uv: u along world X from the window's origin, v against world Z (waterSim's own poke).
float ripWorldX(float u) {
  return uRipWin.x + u * uRipWin.z;
}
float ripWorldZ(float v) {
  return uRipWin.y + (1.0 - v) * uRipWin.z;
}
// Where a destination texel reads the state, along x and along y (texels): the window's move owed less the current's
// travel over the seconds owed at share k. The ripples' v runs against world Z, so a current toward +Z carries a ripple
// to a smaller y and the texel reads from a larger one.
float ripSourceX(float dx, float cx, float k) {
  return dx + uCarry.x - cx * (k * uCarry.z / uRipWin.w);
}
float ripSourceY(float dy, float cz, float k) {
  return dy + uCarry.y + cz * (k * uCarry.z / uRipWin.w);
}
// The state at a source place (texels): the texel itself at a whole-texel place, so a still current copies the field
// bit for bit; Catmull-Rom over 4 by 4 taps otherwise.
vec4 ripCarry(float sx, float sy, int n) {
  float x0 = floor(sx);
  float y0 = floor(sy);
  float fx = sx - x0;
  float fy = sy - y0;
  int ix = int(x0);
  int iy = int(y0);
  if (fx == 0.0 && fy == 0.0) return ripState(ix, iy, n);
  vec4 wx = ripWeights(fx);
  vec4 wy = ripWeights(fy);
  vec4 s = vec4(0.0);
  for (int b = 0; b < 4; b++) {
    vec4 row = ripState(ix - 1, iy - 1 + b, n) * wx.x + ripState(ix, iy - 1 + b, n) * wx.y + ripState(ix + 1, iy - 1 + b, n) * wx.z + ripState(ix + 2, iy - 1 + b, n) * wx.w;
    s += row * wy[b];
  }
  return s;
}
void main() {
  int n = int(uCarry.w + 0.5);
  ivec2 dst = ivec2(gl_FragCoord.xy);
  // Where this texel's middle is in the world.
  vec2 uv = (vec2(dst) + 0.5) / uCarry.w;
  vec3 c = airLiquidAt(vec2(ripWorldX(uv.x), ripWorldZ(uv.y)));
  float k = uAirLiquidP.x * c.z;
  vec4 s = ripCarry(ripSourceX(float(dst.x), c.x, k), ripSourceY(float(dst.y), c.y, k), n);
  gl_FragColor = (any(isnan(s)) || any(isinf(s))) ? vec4(0.0) : s;
}
`;

/**
 * The ripples' carry (`waterSim.ts`'s optional hook, set by the world only while the master, the current and its art
 * share are on): a material of its own, made once with the world and kept across every size change of the ripples (it
 * reads their state by the texture it is handed and their window by `WATER_SIM_WINDOW`'s own object), drawn into the
 * ripples' next state on a frame's first step. What it is owed comes in `ask` (no number handed across a call): the
 * window's move in the ripples' uv and the seconds the current carries over since it last ran.
 */
export class RippleCarryPass implements RippleCarry {
  readonly ask = { scrollU: 0.5, scrollV: 0.5, seconds: 0.5 };
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly carry = new THREE.Vector4(0, 0, 0, 512);
  /** What the carry did, for the console: frames it ran, and the largest travel it was handed (metres). */
  readonly stats = { runs: 0, peakTravel: 0, lastSeconds: 0 };
  /** The liquid record this pass reads (the session's, or a test's own). */
  private readonly u: LiquidUniforms;

  constructor(u: LiquidUniforms = LIQUID_U) {
    this.u = u;
    this.material = new THREE.ShaderMaterial({
      name: 'air.rippleCarry',
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: CARRY_FRAGMENT,
      uniforms: { uState: { value: null }, uRipWin: WATER_SIM_WINDOW, uCarry: { value: this.carry }, ...u },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.scene.matrixAutoUpdate = false;
    this.scene.matrixWorldAutoUpdate = false;
  }

  /** Draw `from` carried into `to`: the ripples' own step follows with no scroll. Answers whether it drew. */
  run(renderer: THREE.WebGLRenderer, from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget): boolean {
    const p = this.u.uAirLiquidP.value;
    if (!(p.x > 0)) return false;
    const w = WATER_SIM_WINDOW.value;
    const texels = w.w > 0 ? w.z / w.w : 512;
    const c = this.carry;
    c.x = Math.round(this.ask.scrollU * texels);
    c.y = Math.round(this.ask.scrollV * texels);
    c.z = this.ask.seconds;
    c.w = texels;
    this.material.uniforms.uState.value = from.texture;
    renderer.setRenderTarget(to);
    renderer.render(this.scene, this.camera);
    this.stats.runs++;
    this.stats.lastSeconds = c.z;
    return true;
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
