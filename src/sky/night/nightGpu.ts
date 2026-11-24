// The night sky on WebGPU under our sky (the GPU port's pass 2, wave 3; the design's 2.7): the Milky Way baked for the
// system behind the loading screen and drawn over the air's sky, each system's stars as soft cards, and the towns' glow, all
// in the scene's units at their physical light, so the eye (`src/sky/exposure/`) makes them what a real eye would see: none
// by day, the stars and a faint band on a moonlit night, the band brighter on a darker one. Everything is made once a sky
// and hung in the sky's camera-following group before it is built (`World.loadNight`, then `gpuSkyReady`), so no pipeline is
// built in play; a frame writes kept numbers alone.
//
//   - **The band** (`bandGraph`, the bake): a 2048 by 1024 picture of two half floats (8 MB) in the galaxy map's frame,
//     longitude across and latitude down (`bandDirOf`), each texel the galaxy's one density (`galaxyDensity.ts`, the map
//     disc's own) summed along its direction from the system's place by the band's quadrature (`BAND_RAY`), each step dimmed
//     by the dust in front of it, in the scene's units (`bandUnit`) and with its warm share. Drawn once at arrival (some
//     milliseconds of the card, behind the screen) and again when the disc's numbers move (`__debug.galaxy`, the shape).
//   - **The band drawn** (`bandMaterial`): a sphere about the camera after the air's dome, each pixel's direction turned into
//     the galaxy's frame by the sky's turn (`skyTurn.ts`), the picture's light coloured between a cool and a warm star light
//     by its warm share, times the air's transmittance to space toward it (so it fades into the horizon's haze), plus the
//     towns' glow (`cityGlow.ts`), all added.
//   - **The stars** (`starsMaterial`): one card a star of the system's catalogue (`starCatalogue.ts`), the brightest the
//     tier draws, each placed at its direction turned by the sky's turn and sized in pixels (2 to 3 across), its light the
//     physical star's spread over the card (so a card's size never moves its light), twinkling toward the horizon, faded by
//     the air's transmittance, and shown only as far as a dark-adapted eye would see it against the sky behind it (the air's
//     sky view and the towns' glow there, Schaefer's limit), so none shows by day and few beside a town.
//
// Nothing here is loaded on the WebGL path; the runtime hands it to the world (`GpuRuntime.night`).

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { AIR, AIR_UNITS, type AirTables } from '../air/airApi.ts';
import { chainMaterial, GPU_FX_TRIANGLE } from '../../core/gpu/gpuChain.ts';
import { FX_CAMERA } from '../../core/fx/pass.ts';
import { BAND_RAY, BAND_SIZE, MILKY_STATE, SUN_LUX, bandUnit, densityOf, numberParams, type DensityOps, type DensityOut, type DensityParams } from './galaxyDensity.ts';
import { catalogueOf, STAR_MOST, LIMIT_K, type StarCatalogue } from './starCatalogue.ts';
import { CityGlow, CITY_MOST } from './cityGlow.ts';
import { CITY_GLOW, NIGHT_STATE, NIGHT_TUNE, countOfTier, tiltOf } from './nightTune.ts';
import { celestialFrameInto, nightFrameInto, tiltFrameInto } from './skyTurn.ts';
import { SKY_MOTION } from '../system/skyMotion.ts';
import { kelvinToLinear } from '../stars.ts';
import { GALAXY_TUNE } from '../../data/galaxy.ts';
import { tierIndexOf } from './nightTier.ts';
import { liveSettings } from '../../core/settings.ts';
import type { CityRow } from '../../story/cities.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, Loop, If, asin, atan, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, exp, float, floor, int, log2, max, min, mix, modelViewMatrix, normalize, positionGeometry, positionLocal, pow, renderGroup, screenSize, select, sin, smoothstep, sqrt, texture, time, transpose, uint, uniform, uv, varying, vec2, vec3, vec4 } = TSL as Any;

/**
 * What is not a dial:
 *   - `hideAbove` 0.05: the light on a level surface (the air's `AIR.frame.level`, the scene's units) over which the stars and
 *     the band are not drawn at all: the sun some ten degrees up, where the eye's limit is already brighter than any star
 *     (a cost cut that shows nothing: the cards' own `seen` is nought long before);
 *   - `cool` and `warm` 9000 K and 4200 K: the band's two star lights, the arms' young blue and the bulge's old orange;
 *   - `spread` 2.5: a card's half-width in its Gaussian's own spreads (its light past that is under 5%);
 *   - `tierEvery` 30: frames between two reads of the settings' tier (a read compares the tier table; never a frame's work).
 */
export const NIGHT_FIXED = { hideAbove: 0.05, cool: 9000, warm: 4200, spread: 2.5, tierEvery: 30 } as const;

/** Where the world's sky's group stands its sphere: inside the dome (`SKY_RADIUS` 3500 × 1.6) and well inside any far plane. */
const BAND_SPHERE = 4800;

/**
 * Pass 2, wave 4b (maker B; wave 4a's small question, its default): the band is drawn after the opaque world and tested against
 * its depth, so a pixel a roof, a ridge or the far ground covers costs it nothing (wave 3's measure: 0.09 ms of the card's
 * world pass, nearly all the night's, a whole sphere drawn first under every solid). Its draw order puts it after every solid
 * of the opaque list and before everything see-through (the bodies, which cover it, among them); its vertices stand on the
 * far plane (`bandClip`), so the depth test passes only where nothing solid was drawn.
 */
export const BAND_ORDER = 900;

/**
 * A clip-space place on the far plane (pass 2, wave 4b): the sphere's vertex through three's own model-view and projection,
 * its depth then stood on the far plane (z = w, or nought under the reversed depth the game draws with on WebGPU), so the
 * depth test lets it through only where the scene drew nothing solid. Clipping keeps the far plane itself.
 */
export function bandClip(reversed: boolean): Any {
  const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(positionLocal, 1))).toVar('swgBandClip');
  return vec4(clip.xy, reversed ? float(0) : clip.w, clip.w);
}

/** What the night sky has done, for `__debug.stars()`. */
export const NIGHT_STATS = { made: 0, bakes: 0, lastBakeMs: 0, lastBakeAt: '', graphBuilds: 0, rebakesInPlay: 0 };

// ---------------------------------------------------------------- the density in three's shading language

/** The PCG step on a `u32` node (`galaxyDensity.ts`'s `pcgNumber`, the same constants). */
function pcgNode(u: Any): Any {
  const v = u.mul(uint(747796405)).add(uint(2891336453));
  const w = v.shiftRight(v.shiftRight(uint(28)).add(uint(4))).bitXor(v).mul(uint(277803737));
  return w.shiftRight(uint(22)).bitXor(w);
}

/** The density's operations over three's shading language: the bake's graph is `densityOf` itself, handed these. */
export const NODE_OPS: DensityOps<Any> = {
  k: (v) => float(v),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  div: (a, b) => a.div(b),
  exp: (a) => exp(a),
  cos: (a) => cos(a),
  sqrt: (a) => sqrt(a),
  min: (a, b) => min(a, b),
  max: (a, b) => max(a, b),
  pow: (a, b) => pow(a, b),
  atan2: (y, x) => atan(y, x),
  floor: (a) => floor(a),
  smoothstep: (e0, e1, x) => smoothstep(e0, e1, x),
  mix: (a, b, t) => mix(a, b, t),
  hash2: (ix, iz) => float(pcgNode(uint(int(ix)).add(pcgNode(uint(int(iz)))))).mul(1 / 4294967296),
};

/** The bake's uniforms: the shape in four vectors and the place (with the ray's reach in w), each read once a render. */
interface BakeUniforms {
  p0: THREE.Vector4;
  p1: THREE.Vector4;
  p2: THREE.Vector4;
  p3: THREE.Vector4;
  place: THREE.Vector4;
}

function bakeUniforms(): BakeUniforms {
  return { p0: new THREE.Vector4(0.5, 0.5, 0.5, 0.5), p1: new THREE.Vector4(0.5, 0.5, 0.5, 0.5), p2: new THREE.Vector4(0.5, 0.5, 0.5, 0.5), p3: new THREE.Vector4(0.5, 0.5, 0.5, 0.5), place: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) };
}

/** The shape's numbers and the place written into the bake's uniforms; answers the band's units. */
function writeBake(u: BakeUniforms, p: DensityParams<number>, place: { x: number; y: number; z: number }): number {
  const unit = bandUnit(AIR_UNITS.scene, p);
  u.p0.set(p.radius, p.arms, p.thick, p.wind);
  u.p1.set(p.discScale, p.armShare, p.armSharp, p.armNorm);
  u.p2.set(p.coreShare, p.coreSize, p.coreFlat, p.clumpShare);
  u.p3.set(p.clumpSize, p.dustShare, p.dustThin, unit);
  u.place.set(place.x, place.y, place.z, BAND_RAY.reach * p.radius);
  return unit;
}

/**
 * The bake's graph: each texel's direction (`bandDirOf`), the band's quadrature along it from the place, `densityOf` over
 * `NODE_OPS` at each step's middle, the dust's opacity summed in front; written as the light in the density's own units (the
 * draw scales it into the scene's by `bandUnit`: the scene's own, some 1e-8, would sink under a half float's normals) and the
 * warm share. A chain material on the chain's triangle (its v turned over, so `uv` runs down the picture's rows as a WebGPU
 * target keeps them), drawn into the band's picture alone.
 */
export function bandGraph(u: BakeUniforms): { material: THREE.Material; mesh: THREE.Mesh } {
  NIGHT_STATS.graphBuilds++;
  const m = chainMaterial('gpu: milky way bake');
  const P0 = uniform(u.p0).setGroup(renderGroup);
  const P1 = uniform(u.p1).setGroup(renderGroup);
  const P2 = uniform(u.p2).setGroup(renderGroup);
  const P3 = uniform(u.p3).setGroup(renderGroup);
  const PL = uniform(u.place).setGroup(renderGroup);
  const p: DensityParams<Any> = {
    radius: P0.x,
    arms: P0.y,
    thick: P0.z,
    wind: P0.w,
    discScale: P1.x,
    armShare: P1.y,
    armSharp: P1.z,
    armNorm: P1.w,
    coreShare: P2.x,
    coreSize: P2.y,
    coreFlat: P2.z,
    clumpShare: P2.w,
    clumpSize: P3.x,
    dustShare: P3.y,
    dustThin: P3.z,
  };
  const n = BAND_RAY.steps;
  m.fragmentNode = Fn(() => {
    const st = uv();
    const lon = st.x.sub(0.5).mul(Math.PI * 2);
    const lat = float(0.5).sub(st.y).mul(Math.PI);
    const cl = cos(lat);
    const d = vec3(cl.mul(cos(lon)), sin(lat), cl.mul(sin(lon))).toVar('swgBandRay');
    const tau = float(0).toVar('swgBandTau');
    const light = float(0).toVar('swgBandL');
    const warm = float(0).toVar('swgBandW');
    Loop(n, ({ i }: Any) => {
      // Each step's ends, length and middle taken into variables first (a node is written where it is first read).
      const u0 = float(i).div(n).toVar('swgBandU0');
      const u1 = float(i).add(1).div(n).toVar('swgBandU1');
      const um = u0.add(u1).mul(0.5).toVar('swgBandUm');
      const ds = PL.w.mul(u1.mul(u1).sub(u0.mul(u0))).toVar('swgBandDs');
      const sm = PL.w.mul(um.mul(um)).toVar('swgBandSm');
      const x = PL.x.add(d.x.mul(sm)).toVar('swgBandX');
      const y = PL.y.add(d.y.mul(sm)).toVar('swgBandY');
      const z = PL.z.add(d.z.mul(sm)).toVar('swgBandZ');
      const o: DensityOut<Any> = { emit: null, warm: null, dust: null };
      densityOf(NODE_OPS, x, y, z, p, o);
      const e = float(o.emit).toVar('swgBandE');
      const w = float(o.warm).toVar('swgBandWm');
      const dd = float(o.dust).toVar('swgBandDd');
      const T = exp(tau.add(dd.mul(ds).mul(0.5)).negate()).toVar('swgBandT');
      light.addAssign(e.mul(T).mul(ds));
      warm.addAssign(w.mul(T).mul(ds));
      tau.addAssign(dd.mul(ds));
    });
    // Stored in the density's own units (tens to hundreds), never the scene's: a band of 1e-8 in the scene's units is under a
    // half float's normal range and was stored as nought or the last subnormals' steps (a flat wedge). The draw scales it.
    return vec4(light, warm.div(max(light, 1e-30)), 0, 1);
  })();
  const mesh = new THREE.Mesh(GPU_FX_TRIANGLE, m);
  mesh.frustumCulled = false;
  mesh.name = m.name;
  return { material: m, mesh };
}

// ---------------------------------------------------------------- the night's look, read by the band and the cards

/** The look's numbers a frame writes, kept vectors begun as fractions (so a write in place makes nothing). */
interface NightUniforms {
  /** The galaxy's frame in the world's sky now (`nightFrameInto`). */
  frame: THREE.Matrix3;
  /** (stars' gain, the eye's reach in magnitudes, twinkle share, twinkle rate). */
  look: THREE.Vector4;
  /** (Milky Way gain, a candela in the scene's units, the scene's units, the band's units: a sum of the density in the scene's). */
  units: THREE.Vector4;
  /** The towns: four numbers a town (`CityGlow.out`). */
  towns: THREE.Vector4[];
  /** The towns' glow's colour (luminance one) and its height's start (radians). */
  glow: THREE.Vector4;
}

function nightUniforms(): NightUniforms {
  const towns: THREE.Vector4[] = [];
  for (let i = 0; i < CITY_MOST; i++) towns.push(new THREE.Vector4(0.5, 0.5, 0.5, 0.5));
  return { frame: new THREE.Matrix3(), look: new THREE.Vector4(0.5, 0.5, 0.5, 0.5), units: new THREE.Vector4(0.5, 0.5, 0.5, 0.5), towns, glow: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) };
}

/** The towns' glow toward a world direction `d` (unit vec3 node), the scene's units (`cityGlow.ts`'s `glowToward`, written out a town at a time). */
function townsGlow(d: Any, towns: Any[], glow: Any): Any {
  const h = max(sqrt(d.x.mul(d.x).add(d.z.mul(d.z))), 1e-6);
  const e = asin(clamp(d.y, -1, 1));
  let sum: Any = float(0);
  for (let i = 0; i < towns.length; i++) {
    const t = towns[i];
    const ca = clamp(d.x.mul(t.x).add(d.z.mul(t.y)).div(h), -1, 1);
    const a = atan(sqrt(max(float(1).sub(ca.mul(ca)), 0)), ca).div(t.w);
    const lobe = exp(a.mul(a).mul(-0.5));
    const height = glow.w.add(t.w.sub(CITY_GLOW.width).mul(0.5));
    const up = select(e.greaterThan(0), exp(e.negate().div(height)), float(0));
    sum = sum.add(t.z.mul(lobe).mul(up));
  }
  return sum;
}

/** A material of the night sky's: unlit, added over what is there, no depth either way, no fog, kept out of the cascades and the wet look. */
function nightMaterial(name: string): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = name;
  m.transparent = false;
  m.blending = THREE.AdditiveBlending;
  m.depthTest = false;
  m.depthWrite = false;
  m.fog = false;
  m.userData.unlit = true;
  m.userData.dry = true;
  return m;
}

/**
 * The band and the towns' glow on a sphere about the camera: each pixel's direction turned into the galaxy's frame, the
 * band's picture there coloured by its warm share and times the air's transmittance to space, the towns' glow added.
 */
function bandMaterial(tables: AirTables, band: THREE.Texture, u: NightUniforms, cool: THREE.Color, warm: THREE.Color, reversed = true): MeshBasicNodeMaterial {
  NIGHT_STATS.graphBuilds++;
  const m = nightMaterial('gpu: milky way');
  m.side = THREE.BackSide;
  // Pass 2, wave 4b: after the solids, against their depth, on the far plane (`BAND_ORDER`, `bandClip`).
  m.depthTest = true;
  m.vertexNode = bandClip(reversed);
  const F = uniform(u.frame).setGroup(renderGroup);
  const U = uniform(u.units).setGroup(renderGroup);
  const G = uniform(u.glow).setGroup(renderGroup);
  const towns = u.towns.map((t) => uniform(t).setGroup(renderGroup));
  const coolU = uniform(cool).setGroup(renderGroup);
  const warmU = uniform(warm).setGroup(renderGroup);
  const tex = texture(band);
  m.colorNode = Fn(() => {
    const d = normalize(positionLocal).toVar('swgBandDir');
    // Every table read at the top, before anything else.
    const T = vec3(tables.transmittanceToSpace(d)).toVar('swgBandTr');
    const g = transpose(F).mul(d).toVar('swgBandG');
    const bu = atan(g.z, g.x).div(Math.PI * 2).add(0.5);
    const bv = float(0.5).sub(asin(clamp(g.y, -1, 1)).div(Math.PI));
    const b = vec4(tex.sample(vec2(bu, bv))).toVar('swgBandPic');
    // The picture's light is the density's sum: times the band's units (`U.w`) into the scene's, times the owner's dial (`U.x`);
    // under storms faded by one less the overcast, as the sun discs are until pass 3's clouds stand in front of the sky.
    const clear = float(1).sub(clamp(tables.nodes.overcast, 0, 1));
    const light = mix(coolU, warmU, clamp(b.y, 0, 1)).mul(b.x.mul(U.w).mul(U.x)).mul(T).mul(clear);
    const glow = vec3(G.x, G.y, G.z).mul(townsGlow(d, towns, G));
    return vec4(light.add(glow), 1);
  })();
  return m;
}

/**
 * The stars' cards: an instanced quad a star, its corner placed in the clip's own pixels about the star's direction (turned
 * into the world's sky), its light the star's spread over a Gaussian of the card's size (so the card's sum is the star's
 * light whatever its size), twinkling by the air it looks through, times the air's transmittance, and seen only as far as
 * a dark-adapted eye would see it against the sky and the towns' glow behind it.
 */
function starsMaterial(tables: AirTables, u: NightUniforms): MeshBasicNodeMaterial {
  NIGHT_STATS.graphBuilds++;
  const m = nightMaterial('gpu: stars');
  const F = uniform(u.frame).setGroup(renderGroup);
  const L = uniform(u.look).setGroup(renderGroup);
  const U = uniform(u.units).setGroup(renderGroup);
  const G = uniform(u.glow).setGroup(renderGroup);
  const towns = u.towns.map((t) => uniform(t).setGroup(renderGroup));
  const aStar = attribute('aStar', 'vec4');
  const aTint = attribute('aTint', 'vec4');
  const aSize = attribute('aSize', 'float');
  const w = F.mul(aStar.xyz);
  // The card's spread in pixels and its half-width.
  const sigmaPx = aSize.div(2.3548);
  const halfPx = max(sigmaPx.mul(NIGHT_FIXED.spread), 1.5);
  // Twinkle: nought straight up, growing with the air the star is seen through, on a seed of its own.
  const air = clamp(float(1).div(max(w.y, 0.05)).sub(1).div(10), 0, 1);
  const phase = time.mul(L.w).mul(Math.PI * 2);
  const flick = sin(phase.add(aTint.w.mul(40))).mul(0.6).add(sin(phase.mul(1.73).add(aTint.w.mul(91))).mul(0.4));
  const twinkle = max(float(1).add(L.z.mul(air).mul(flick)), 0);
  // The star's light at the top of the air (the scene's units of illuminance): the sun's 10^(−0.4 (m + 26.74)).
  const flux = U.z.mul(exp(aStar.w.add(26.74).mul(-0.4 * Math.LN10))).mul(L.x).mul(twinkle);
  m.vertexNode = Fn(() => {
    const view = cameraViewMatrix.mul(vec4(w, 0)).xyz.toVar('swgStarView');
    const clip = cameraProjectionMatrix.mul(vec4(view, 1)).toVar('swgStarClip');
    const out = vec4(clip.xy.add(positionGeometry.xy.mul(halfPx).mul(2).div(screenSize).mul(clip.w)), clip.z, clip.w).toVar('swgStarOut');
    // Behind the eye: placed outside the clip's box, so nothing is drawn.
    If(view.z.greaterThan(-1e-3), () => {
      out.assign(vec4(2, 2, 2, 1));
    });
    return out;
  })();
  const vLocal = varying(positionGeometry.xy.mul(halfPx.div(sigmaPx)), 'swgStarLocal');
  const vDir = varying(w, 'swgStarDir');
  const vLight = varying(aTint.xyz.mul(flux), 'swgStarLight');
  const vMag = varying(aStar.w, 'swgStarMag');
  const vSigma = varying(sigmaPx, 'swgStarSigma');
  m.colorNode = Fn(() => {
    const d = normalize(vDir).toVar('swgStarD');
    // Every table read at the top, before anything else.
    const sky = vec3(tables.skyRadiance(d)).toVar('swgStarSky');
    const T = vec3(tables.transmittanceToSpace(d)).toVar('swgStarTr');
    // The sky behind the star, in candelas a square metre, and the faintest star an eye sees against it (Schaefer).
    const bg = sky.x.mul(0.2126).add(sky.y.mul(0.7152)).add(sky.z.mul(0.0722)).add(townsGlow(d, towns, G));
    const cd = max(bg.mul(U.y), 0);
    const limit = float(7.93).sub(log2(sqrt(cd).mul(LIMIT_K).add(1)).mul(5 / Math.log2(10))).add(L.y);
    const seen = smoothstep(-0.75, 0.75, limit.sub(vMag));
    // The light a steradian at the card's middle: the star's light over the Gaussian's solid angle.
    // A pixel's angle at the middle of the view: the projection's second column's second row is one over tan(fov / 2).
    const radPerPx = float(2).div(cameraProjectionMatrix.element(1).y.mul(screenSize.y));
    const sigmaRad = vSigma.mul(radPerPx);
    const peak = float(1).div(sigmaRad.mul(sigmaRad).mul(Math.PI * 2));
    const r2 = vLocal.x.mul(vLocal.x).add(vLocal.y.mul(vLocal.y));
    const shape = exp(r2.mul(-0.5));
    // Under storms faded by one less the overcast, as the sun discs are (until pass 3's clouds).
    const clear = float(1).sub(clamp(tables.nodes.overcast, 0, 1));
    return vec4(vLight.mul(peak).mul(shape).mul(seen).mul(T).mul(clear), 1);
  })();
  return m;
}

/** The quad every card is drawn on, with the catalogue's three attributes as instance data, the tier's count drawn. */
function starsGeometry(cat: StarCatalogue): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aStar', new THREE.InstancedBufferAttribute(new Float32Array(cat.star), 4));
  g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(cat.tint), 4));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(cat.size), 1));
  g.instanceCount = STAR_MOST;
  // Placed in the vertex graph; a bound that is never tested still has to exist.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/** A temperature's colour (luminance one) as a three colour. */
function kelvinColour(kelvin: number): THREE.Color {
  const c = [1, 1, 1];
  kelvinToLinear(kelvin, c);
  return new THREE.Color(c[0], c[1], c[2]);
}

// ---------------------------------------------------------------- one sky's night

/** What the world hands the night sky at its making. */
export interface NightMake {
  /** The world (a PLANETS id): its tilt dials. */
  planet: string;
  /** The system's key (its stars' seed) and where it stands in the map's frame, worked again when the map's numbers move. */
  key: string;
  placeOf: () => { x: number; y: number; z: number };
}

/** The frame's numbers the world writes before `frame` (a number handed across a call is a number made). */
export const NIGHT_IN = { camX: 0.5, camZ: 0.5 };

export class NightSky {
  /** What the world hangs in the sky's group: the band's sphere and the stars' cards. */
  readonly group = new THREE.Group();
  readonly planet: string;
  readonly key: string;
  private readonly placeOf: () => { x: number; y: number; z: number };
  private place: { x: number; y: number; z: number };
  private readonly renderer: Any;
  private readonly target: THREE.RenderTarget;
  private readonly bake: { material: THREE.Material; mesh: THREE.Mesh };
  private readonly bakeU = bakeUniforms();
  private readonly u = nightUniforms();
  private readonly band: THREE.Mesh;
  private readonly stars: THREE.Mesh<THREE.InstancedBufferGeometry, MeshBasicNodeMaterial>;
  private cat: StarCatalogue;
  readonly cities = new CityGlow();
  /** The galaxy's frame at the day's angle nought (`tiltFrameInto`), worked when a tilt dial moves. */
  private readonly tilt = new Float64Array(9);
  /** What the band was baked under: the disc's and the layout's numbers, the shape's count, and whether it is baked at all. */
  private readonly bakedSig = new Float64Array(9);
  private baked = false;
  private bakeReady = false;
  private dialSeen = -1;
  /** The tier read at the last night frame (`tierIndexOf`: 0 Low to 3 Ultra, −1 a custom set), −9 before the first. */
  private tierAt = -9;
  private tierCount = 8000;
  private unit = 0;
  /** The prover's switch (`__debug.stars({ off: true })`): the night not drawn, for an A/B on one screen; nothing else moves. */
  off = false;
  disposed = false;
  /** Frames drawn and those the night was hidden by day, for the report. */
  frames = 0;
  hiddenFrames = 0;

  constructor(renderer: Any, make: NightMake) {
    this.renderer = renderer;
    this.planet = make.planet;
    this.key = make.key;
    this.placeOf = make.placeOf;
    this.place = make.placeOf();
    const tables = AIR.tables;
    if (!tables) throw new Error('the night sky needs the air\'s tables');
    this.target = new THREE.RenderTarget(BAND_SIZE.width, BAND_SIZE.height, { type: THREE.HalfFloatType, format: THREE.RGFormat, depthBuffer: false, stencilBuffer: false, samples: 0, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
    this.target.texture.name = 'gpu: milky way';
    this.bake = bandGraph(this.bakeU);
    this.band = new THREE.Mesh(new THREE.SphereGeometry(BAND_SPHERE, 48, 24), bandMaterial(tables, this.target.texture, this.u, kelvinColour(NIGHT_FIXED.cool), kelvinColour(NIGHT_FIXED.warm), renderer?.reversedDepthBuffer === true));
    this.band.name = 'night: milky way';
    this.band.frustumCulled = false;
    this.band.renderOrder = BAND_ORDER;
    this.cat = catalogueOf(this.key, this.place);
    this.stars = new THREE.Mesh(starsGeometry(this.cat), starsMaterial(tables, this.u));
    this.stars.name = 'night: stars';
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -7;
    this.group.add(this.band, this.stars);
    this.group.name = 'night sky';
    // The glow's colour and its height's start, fixed.
    const gc = kelvinColour(CITY_GLOW.kelvin);
    this.u.glow.set(gc.r, gc.g, gc.b, CITY_GLOW.height);
    this.readDials();
    NIGHT_STATS.made++;
  }

  /** The world's towns (`pois.json`'s rows about its layout's centre), at load and whenever the file lands. */
  setCities(rows: readonly CityRow[] | null, centre: { x: number; z: number } | null): void {
    this.cities.setRows(rows, centre);
  }

  /** The dials read again (a move of any: the tilt's frame, the look's gains). Not a frame's work: a dial moved. */
  private readDials(): void {
    const t = tiltOf(this.planet);
    tiltFrameInto(t.tiltDeg, t.nodeDeg, this.tilt);
    this.dialSeen = NIGHT_STATE.version;
  }

  /** The disc's and the layout's numbers and the shape's count, as the band was baked under them (`bakedSig`'s order). */
  private sigMoved(): boolean {
    const g = GALAXY_TUNE;
    const s = this.bakedSig;
    return s[0] !== g.discRadius || s[1] !== g.discArms || s[2] !== g.discThickness || s[3] !== g.square || s[4] !== g.jitter || s[5] !== g.lift || s[6] !== g.centreCol || s[7] !== g.centreRow || s[8] !== MILKY_STATE.version;
  }

  private keepSig(): void {
    const g = GALAXY_TUNE;
    const s = this.bakedSig;
    s[0] = g.discRadius;
    s[1] = g.discArms;
    s[2] = g.discThickness;
    s[3] = g.square;
    s[4] = g.jitter;
    s[5] = g.lift;
    s[6] = g.centreCol;
    s[7] = g.centreRow;
    s[8] = MILKY_STATE.version;
  }

  /** The bake's pipeline compiled against the band's picture (its format and attachments), asked behind the loading screen. */
  async warm(): Promise<void> {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.target);
    let p: Promise<unknown>;
    try {
      p = r.compileAsync(this.bake.mesh, FX_CAMERA) as Promise<unknown>;
    } finally {
      r.setRenderTarget(prev);
    }
    await p;
    this.bakeReady = true;
  }

  /** The band baked for the system's place as the map's numbers stand (one draw of the bake's graph into its picture). */
  drawBake(): number {
    if (!this.bakeReady || this.disposed) return 0;
    const t0 = performance.now();
    const p = numberParams();
    this.unit = writeBake(this.bakeU, p, this.place);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.target);
    try {
      r.render(this.bake.mesh, FX_CAMERA);
    } finally {
      r.setRenderTarget(prev);
    }
    this.keepSig();
    this.baked = true;
    const ms = performance.now() - t0;
    NIGHT_STATS.bakes++;
    NIGHT_STATS.lastBakeMs = ms;
    NIGHT_STATS.lastBakeAt = this.key;
    return ms;
  }

  /**
   * The disc's numbers moved (`__debug.galaxy`, the shape): the system's place worked again, its stars drawn again if it moved,
   * and the band baked again. A dial's work, in the frame it moved; nothing is built (the graphs read uniforms).
   */
  private rebake(): void {
    const was = this.place;
    this.place = this.placeOf();
    if (was.x !== this.place.x || was.y !== this.place.y || was.z !== this.place.z || this.sigShapeMoved) {
      this.cat = catalogueOf(this.key, this.place);
      const g = this.stars.geometry;
      (g.getAttribute('aStar') as THREE.InstancedBufferAttribute).copyArray(this.cat.star).needsUpdate = true;
      (g.getAttribute('aTint') as THREE.InstancedBufferAttribute).copyArray(this.cat.tint).needsUpdate = true;
      (g.getAttribute('aSize') as THREE.InstancedBufferAttribute).copyArray(this.cat.size).needsUpdate = true;
    }
    this.drawBake();
    NIGHT_STATS.rebakesInPlay++;
  }

  /** Whether the disc's own numbers (not only the layout's) moved since the bake: the stars are drawn out of them too. */
  private get sigShapeMoved(): boolean {
    const g = GALAXY_TUNE;
    const s = this.bakedSig;
    return s[0] !== g.discRadius || s[1] !== g.discArms || s[2] !== g.discThickness || s[8] !== MILKY_STATE.version;
  }

  /**
   * Once a game frame after the air's frame (`AirRun.frame`): the sky's turn from the air's sun, the look's numbers, the towns'
   * glows from the camera (`NIGHT_IN`), the tier's count, and by day nothing drawn. Reads fields and writes kept numbers:
   * allocates nothing (but on the frame a dial or the map's numbers moved).
   */
  frame(): void {
    if (this.disposed) return;
    this.frames++;
    const f = AIR.frame;
    const day = !(f.level < NIGHT_FIXED.hideAbove);
    this.group.visible = !day && this.baked && !this.off;
    if (day) {
      this.hiddenFrames++;
      return;
    }
    if (this.dialSeen !== NIGHT_STATE.version) this.readDials();
    if (this.baked && this.bakeReady && this.sigMoved()) this.rebake();
    // (The fixer of pass 2, wave 6: the owner's late addition 2) under an applied star system the stars turn about the world's
    // own axis at its own spin (`SkyMotion.celestial`, written by the day's `at` this frame), so they, the sun's path and the
    // bodies share one sky; a world not applied keeps its turn about SWG's pole read off the sun, exactly as it was.
    const motion = SKY_MOTION.now;
    if (motion !== null && motion.celestialAt === motion.T) celestialFrameInto(this.tilt, motion.celestial, this.u.frame.elements);
    else nightFrameInto(this.tilt, f.sunDir, this.u.frame.elements);
    // Every number written into a vector's own field, never handed to a setter (a number handed across a call is a number made).
    const T = NIGHT_TUNE;
    const look = this.u.look;
    look.x = T.stars;
    look.y = T.seeing;
    look.z = T.twinkle;
    look.w = T.twinkleRate;
    const units = this.u.units;
    units.x = T.milkyWay;
    units.y = SUN_LUX / AIR_UNITS.scene;
    units.z = AIR_UNITS.scene;
    units.w = this.unit;
    this.cities.frame(NIGHT_IN);
    const o = this.cities.out;
    const towns = this.u.towns;
    for (let i = 0; i < CITY_MOST; i++) {
      const t = towns[i];
      t.x = o[i * 4];
      t.y = o[i * 4 + 1];
      t.z = o[i * 4 + 2];
      t.w = o[i * 4 + 3];
    }
    // The tier's count, read every few frames (a read compares the tier table).
    if (this.frames % NIGHT_FIXED.tierEvery === 1) {
      this.tierAt = tierIndexOf(liveSettings());
      this.tierCount = countOfTier(this.tierAt);
    }
    const g = this.stars.geometry;
    if (g.instanceCount !== this.tierCount) g.instanceCount = this.tierCount;
  }

  /** What `__debug.stars()` says of this sky. */
  report(): Record<string, unknown> {
    const n3 = (v: number): number => Number(v.toPrecision(3));
    const f = this.u.frame.elements;
    const towns: Record<string, unknown>[] = [];
    for (let i = 0; i < this.cities.count; i++) {
      const o = this.cities.out;
      towns.push({ toward: [n3(o[i * 4]), n3(o[i * 4 + 1])], horizonLight: n3(o[i * 4 + 2]), halfWidthDeg: n3((o[i * 4 + 3] * 180) / Math.PI) });
    }
    const t = tiltOf(this.planet);
    return {
      system: this.key,
      place: [n3(this.place.x), n3(this.place.y), n3(this.place.z)],
      drawn: this.group.visible,
      why: this.group.visible ? null : this.off ? "off by the prover's switch (stars({ off: false }) puts it back)" : !this.baked ? 'the band is not baked yet' : `day: the light on a level surface (${n3(AIR.frame.level)}) is over ${NIGHT_FIXED.hideAbove}, where no star is seen`,
      stars: {
        tier: this.tierAt === -9 ? 'not read yet (it is read on the night\'s frames)' : (['low', 'medium', 'high', 'ultra'][this.tierAt] ?? "custom (High's count)"),
        drawn: this.stars.geometry.instanceCount,
        of: this.cat.count,
        brightest: n3(this.cat.brightest),
        faintestDrawn: n3(this.cat.star[(Math.max(1, this.stars.geometry.instanceCount) - 1) * 4 + 3]),
        catalogueMs: n3(this.cat.ms),
      },
      band: { baked: this.baked, size: [BAND_SIZE.width, BAND_SIZE.height], memoryMB: (BAND_SIZE.width * BAND_SIZE.height * 4) / (1024 * 1024), unit: this.unit, steps: BAND_RAY.steps },
      turn: {
        galacticNorth: [n3(f[3]), n3(f[4]), n3(f[5])],
        tiltDeg: t.tiltDeg,
        nodeDeg: t.nodeDeg,
        // (the fixer of pass 2, wave 6) which axis the stars turn about, and where that pole stands (+Y up, +Z north)
        about: SKY_MOTION.now ? `the world's own axis (its applied system ${SKY_MOTION.now.id})` : "SWG's pole, read off the sun",
        pole: SKY_MOTION.now ? [n3(SKY_MOTION.now.celestial[6]), n3(SKY_MOTION.now.celestial[7]), n3(SKY_MOTION.now.celestial[8])] : [0, n3(Math.sin((22.5 * Math.PI) / 180)), n3(Math.cos((22.5 * Math.PI) / 180))],
      },
      towns: { count: this.cities.townCount, nearest: towns },
      frames: this.frames,
      hiddenByDay: this.hiddenFrames,
      ...NIGHT_STATS,
    };
  }

  /**
   * The band's picture read back (the console's and the prover's, never a frame's): two half floats a texel, as floats, the
   * light put in the scene's units (the picture holds the density's own sums, `drawBake`'s units scale them).
   */
  async readBand(): Promise<Float32Array> {
    const r = this.renderer;
    const w = BAND_SIZE.width;
    const h = BAND_SIZE.height;
    const raw = (await r.readRenderTargetPixelsAsync(this.target, 0, 0, w, h)) as Uint16Array | Float32Array;
    const out = new Float32Array(w * h * 2);
    const per = raw.length / (w * h);
    for (let i = 0; i < w * h; i++) {
      const a = raw[i * per];
      const b = raw[i * per + 1];
      out[i * 2] = (raw instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(a) : a) * this.unit;
      out[i * 2 + 1] = raw instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(b) : b;
    }
    return out;
  }

  /** Everything this night owns, freed (`forget` is the world's `forgetMaterials`). */
  dispose(forget?: (materials: Iterable<THREE.Material>) => void): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    const mats = [this.band.material as THREE.Material, this.stars.material as THREE.Material];
    forget?.(mats);
    for (const m of mats) m.dispose();
    this.band.geometry.dispose();
    this.stars.geometry.dispose();
    this.bake.material.dispose();
    this.target.dispose();
  }
}

/** Kept for a reference by the node test: every graph's builders, without a renderer. */
export const NIGHT_GRAPHS = { bandGraph, bakeUniforms, bandMaterial, starsMaterial, nightUniforms, townsGlow };
