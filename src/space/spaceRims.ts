// The air round a space zone's planets on WebGPU (the GPU port's pass 2, wave 4b, maker C; the design's 2.6: "planets in space
// gain the air round them", the brief's part C). WebGPU only: the runtime makes it (`GpuRuntime.spaceRims`), nothing here is
// loaded on the WebGL path, where every planet is SWG's lit sphere as it always was.
//
// **Each planet with air gains a shell**, a sphere over its own at the top of its air, two meshes over one geometry (the
// Painted and the Scattered, keyed apart), both hung beside the planet in the zone's sky group before the group is built, so the
// zone's loading screen (or a jump's closed tunnel, `World.gpuMadeNow`) builds both and the frame only shows one:
//   - **Scattered** (High and Ultra; Medium where the planet takes under a quarter of the screen): the viewer's march
//     (`airProfile.js`'s `airShader`, the body path the sky's moons and planets draw with, one file the viewer and the game
//     import) through the planet's own air, from its ground world's record at its dials (`bodyAir.ts`' `bodyRecord`, so its
//     ground sky, its rim from a moon and its rim from orbit change together) or its look's own; and the planet itself drawn
//     by the same pixel (its picture, its own look's where one is worn, lit by the star through its air), since the planet's own
//     sphere is a polygon whose edge stands up to half a percent inside the true one, which the march's limb would show as a
//     bright saw-toothed seam. The planet's own sphere stands down while it draws.
//   - **Painted** (Low; Medium over a quarter of the screen): the planet's own sphere, and round it the limb's own light by
//     height (`spaceAir.ts`' `rimProfile`, marched once a record), lit by the star's height over the limb: no march a pixel.
// The planet's own sphere is made finer where it has air (128 by 64), so its edge stands within a tenth of a percent of the
// painted rim's.
//
// **Lit as the planet is**: in space the star's light is the scene's main light (its colour times its intensity), the ambient
// the hemisphere's, in the scene's units, so the Scattered planet reads as its Lambert sphere did with the air added; the eye
// stands at an exposure of 1 in space and three's output takes it, as for every node material, the scene stored pre-exposed.
// **Placed from the camera**: the sky group rides the camera, so each shell's middle less the eye is the planet's place in it,
// handed in a kept vector each frame; nothing measured from the world's middle reaches the card.
//
// **A frame allocates nothing**: every number goes into a kept vector of a shell's record; the tier is read every 30 frames.
import * as THREE from 'three';
import { MeshBasicNodeMaterial, NodeUpdateType, TextureNode } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { F } from '../sky/air/airParams.ts';
import { TABLES, airShader } from '../sky/look/airProfile.js';
import { markMotion } from '../core/gpu/motion.ts';
import { BODY_LAY, BODY_TUNE, bodyFormOf, tierRule, tuneBodies } from '../sky/bodies/bodyTier.ts';
import { bodyRecord, bodyTablesKey, makeBodyTables } from '../sky/bodies/bodyAir.ts';
import { BakeCache, type BakeHow } from '../sky/bodies/bakeCache.ts';
import { bakeCache } from '../sky/bodies/skyBody.ts';
import { tierIndexOf } from '../sky/night/nightTier.ts';
import { liveSettings } from '../core/settings.ts';
import { RIM_LIT, RIM_PROFILE_SIZE, SPACE_RIM_TUNE, lookFormOf, lookRecordOf, rimProfile, spaceBodyAir, spacePlaceIds, tuneSpaceRims } from './spaceAir.ts';
import type { BodyAir } from '../sky/bodies/bodyAir.ts';
import { bodyLookOf } from '../sky/look/bodiesFile.ts';
import { LOOK_BAKE_TUNE, layLatLong, lookOfPlace } from '../sky/look/lookPictures.ts';
import { MATCH_HOLD } from '../sky/skyMatch.ts';
import { GPU } from '../core/gpuSwitch.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, atan, dFdx, dFdy, dot, float, fract, fwidth, int, max, min, mix, normalize, positionLocal, renderGroup, select, smoothstep, sqrt, texture, uniform, vec2, vec3, vec4, abs } = TSL as Any;

/** How often the frame reads the tier (a read walks the tier table; frames). */
const TIER_EVERY = 30;
/** The prover's tier held (`__debug.spaceRims({ tier })`, 0 Low to 3 Ultra), -1 the settings' own: the rims alone, nothing else. */
const RIM_TIER = { held: -1 };
/** The shell stands this much over the air's top, so its polygon's edge (96 by 48) is never inside the top of the air. */
const SHELL_OVER = 1.002;
/** The planet's own sphere where it has air: 128 by 64, its edge within a tenth of a percent of the true one. */
const FINE = { width: 128, height: 64 };

/** The frame's star and ambient, written into its fields by the world before `frame` (a number handed across a call is a number made). */
export const SPACE_RIM_IN = {
  /** The star's direction (world axes, unit). */
  sunX: 0,
  sunY: 1,
  sunZ: 0,
  /** The main light's colour times its intensity (the scene's units). */
  lightR: 1,
  lightG: 1,
  lightB: 1,
  /** The hemisphere's sky and ground colours times its intensity. */
  skyR: 0,
  skyG: 0,
  skyB: 0,
  groundR: 0,
  groundG: 0,
  groundB: 0,
  /** The fill light's direction (world axes, unit) and its colour times its intensity: the planet's own sphere takes it too. */
  fillX: 0,
  fillY: 1,
  fillZ: 0,
  fillR: 0,
  fillG: 0,
  fillB: 0,
};

// ---------------------------------------------------------------- a shell's record

/** What a shell's graph reads off the drawn shell at every draw: kept vectors, written in place by the frame. */
export class SpaceRimState {
  /** The planet's middle less the eye (scene units, world axes), and the shell's radius as drawn. */
  readonly s0 = new THREE.Vector4(0, 0, -2600, 1);
  /** The ground's radius as drawn, km a scene unit, whether the planet's picture is drawn (1) or its colour, spare. */
  readonly s1 = new THREE.Vector4(1, 1, 1, 0);
  readonly sun = new THREE.Vector3(0, 1, 0);
  readonly light = new THREE.Vector3(1, 1, 1);
  readonly ambSky = new THREE.Vector3(0, 0, 0);
  readonly ambGround = new THREE.Vector3(0, 0, 0);
  readonly fillDir = new THREE.Vector3(0, 1, 0);
  readonly fill = new THREE.Vector3(0, 0, 0);
  /** The record packed as `skyBody.ts` packs it (airProfile's uniforms). */
  readonly a0 = new THREE.Vector4(6360, 6460, 8, 1.2);
  readonly a1 = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  readonly a2 = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  readonly a3 = new THREE.Vector4(25, 15, 0.8, 1);
  readonly a4 = new THREE.Vector4(1, 1, 1, 1);
  readonly a5 = new THREE.Vector4(1, 0.5, 0.5, 0.5);
  /** The planet's colour where it has no picture (linear). */
  readonly colour = new THREE.Vector3(0.25, 0.28, 0.32);
  map: THREE.Texture;
  tT: THREE.Texture;
  tMS: THREE.Texture;
  tE: THREE.Texture;
  rim: THREE.Texture;
  constructor(map: THREE.Texture, f: Fallbacks) {
    this.map = map;
    this.tT = f.t;
    this.tMS = f.ms;
    this.tE = f.e;
    this.rim = f.rim;
  }
}

interface Fallbacks {
  pic: THREE.Texture;
  t: THREE.Texture;
  ms: THREE.Texture;
  e: THREE.Texture;
  rim: THREE.Texture;
}
let FALLBACKS: Fallbacks | null = null;
function fallbacks(): Fallbacks {
  if (!FALLBACKS) {
    const pic = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
    pic.colorSpace = THREE.SRGBColorSpace;
    pic.minFilter = pic.magFilter = THREE.LinearFilter;
    pic.needsUpdate = true;
    const half = (): THREE.DataTexture => {
      const z = THREE.DataUtils.toHalfFloat(0);
      const t = new THREE.DataTexture(new Uint16Array([z, z, z, THREE.DataUtils.toHalfFloat(1)]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    FALLBACKS = { pic, t: half(), ms: half(), e: half(), rim: half() };
  }
  return FALLBACKS;
}

/** A table of airProfile's (RGBA floats) as a half-float picture the shell samples (filterable on every adapter). */
function tableTexture(data: Float32Array, w: number, h: number): THREE.DataTexture {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- reading the drawn shell

interface Frame {
  object?: { userData?: { swgSpaceRim?: SpaceRimState } } | null;
}
type StateVec = 's0' | 's1' | 'sun' | 'light' | 'ambSky' | 'ambGround' | 'fillDir' | 'fill' | 'a0' | 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'colour';

/** A number of the drawn shell's record, read at every draw (the object's own group). */
function rimVec(field: StateVec, init: THREE.Vector3 | THREE.Vector4): Any {
  return uniform(init).onObjectUpdate((f: Frame) => f.object?.userData?.swgSpaceRim?.[field] ?? init);
}

const TextureNodeBase = TextureNode as Any;

/** A texture of the drawn shell's record, read at every draw: each sample a clone of one base, each writing the shell's texture through. */
class RimTexture extends TextureNodeBase {
  field: 'map' | 'tT' | 'tMS' | 'tE' | 'rim' = 'map';
  fallback: THREE.Texture | null = null;
  constructor(value: THREE.Texture, uvNode: Any = null, levelNode: Any = null, biasNode: Any = null) {
    super(value, uvNode, levelNode, biasNode);
    this.updateType = NodeUpdateType.OBJECT;
    this.setUpdateMatrix(false);
  }
  update(frame: Frame): void {
    const t = frame.object?.userData?.swgSpaceRim?.[this.field] ?? this.fallback;
    if (t && this.value !== t) this.value = t;
  }
  clone(): Any {
    const n = super.clone() as RimTexture;
    n.field = this.field;
    n.fallback = this.fallback;
    (n as Any).setUpdateMatrix(false);
    return n;
  }
}
function rimTexture(field: RimTexture['field'], fallback: THREE.Texture): Any {
  const n = new RimTexture(fallback);
  n.field = field;
  n.fallback = fallback;
  return n;
}

/** The object's own group refreshed at every draw (three refreshes it only when the object's matrix, material or geometry moved). */
function everyDraw(m: Any): void {
  const base = m.setupObserver;
  m.setupObserver = function (this: Any, builder: Any): Any {
    const o = base.call(this, builder);
    o.hasNode = true;
    return o;
  };
}

/** The march's steps (the tier's) and the painted rim's strength, read once a render. */
const STEPS_U = new THREE.Vector4(12, 1, 0.5, 0.5);

// ---------------------------------------------------------------- the two graphs

/** The shell's ray, worked in the vertex's place: the planet's middle less the eye plus the shell's own point (world axes). */
function rayOf(s0: Any): Any {
  return normalize(s0.xyz.add(positionLocal.mul(s0.w)));
}

/**
 * A form's graph (one for every shell): Painted lays the limb's own light round the disc by height; Scattered marches the
 * shell and draws the planet itself under it. Built once a session per form, as the first shell is built.
 */
function rimGraph(form: 'painted' | 'scattered'): THREE.Material {
  const m = new MeshBasicNodeMaterial();
  m.name = `gpu: space rim (${form})`;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  everyDraw(m);
  const f = fallbacks();
  const s0 = rimVec('s0', new THREE.Vector4(0, 0, -2600, 1));
  const s1 = rimVec('s1', new THREE.Vector4(1, 1, 1, 0));
  const sunW = rimVec('sun', new THREE.Vector3(0, 1, 0));
  const light = rimVec('light', new THREE.Vector3(1, 1, 1));
  const a0 = rimVec('a0', new THREE.Vector4(6360, 6460, 8, 1.2));
  const tune = uniform(STEPS_U).setGroup(renderGroup);
  m.colorNode = Fn(() => {
    const rd = rayOf(s0).toVar('rimRd');
    const C = s0.xyz;
    const kmPer = s1.y;
    const bottom = a0.x;
    const top = a0.y;
    // The ray's nearest approach to the middle, in km, and the star's height over that point.
    const tc = dot(C, rd);
    const P = rd.mul(tc).sub(C).mul(kmPer).toVar('rimP');
    const b = sqrt(dot(P, P)).toVar('rimB');
    if (form === 'painted') {
      const muS = dot(P, sunW).div(max(b, 1e-6));
      const rho = b.div(bottom);
      const shell = top.div(bottom);
      const u = max(rho.sub(1), 0).div(max(shell.sub(1), 1e-6));
      const x = sqrt(min(u, 1)).mul((RIM_PROFILE_SIZE - 1) / RIM_PROFILE_SIZE).add(0.5 / RIM_PROFILE_SIZE);
      const prof = texture(rimTexture('rim', f.rim), vec2(x, 0.5)).level(0);
      // Over the disc the air in front of the ground is the slant path's share of the grazing one (`paintedRimAt`'s rule).
      const graze = sqrt(max(shell.sub(1), 0).mul(0.5));
      const inside = select(rho.lessThan(1), min(float(1), graze.div(sqrt(max(float(1).sub(rho.mul(rho)), 1e-6)))), float(1));
      const outside = float(1).sub(smoothstep(shell.mul(0.999), shell, rho));
      const lit = smoothstep(RIM_LIT.from, RIM_LIT.to, muS);
      const k = inside.mul(outside).mul(lit).mul(tune.y);
      return vec4(prof.rgb.mul(light).mul(k), float(0));
    }
    // Scattered: the viewer's march (16, 12 or 8 steps, the tier's, a number the loop runs to) through the planet's own air.
    const a1 = rimVec('a1', new THREE.Vector4(0.5, 0.5, 0.5, 0.5));
    const a2 = rimVec('a2', new THREE.Vector4(0.5, 0.5, 0.5, 0.5));
    const a3 = rimVec('a3', new THREE.Vector4(25, 15, 0.8, 1));
    const a4 = rimVec('a4', new THREE.Vector4(1, 1, 1, 1));
    const a5 = rimVec('a5', new THREE.Vector4(1, 0.5, 0.5, 0.5));
    const ambSky = rimVec('ambSky', new THREE.Vector3(0, 0, 0));
    const ambGround = rimVec('ambGround', new THREE.Vector3(0, 0, 0));
    const colour = rimVec('colour', new THREE.Vector3(0.25, 0.28, 0.32));
    const fillDir = rimVec('fillDir', new THREE.Vector3(0, 1, 0));
    const fill = rimVec('fill', new THREE.Vector3(0, 0, 0));
    const U = { bottom, top, rayH: a0.z, mieH: a0.w, ray: a1.xyz, mieS: a1.w, oz: a2.xyz, mieA: a2.w, ozC: a3.x, ozW: a3.y, mieG: a3.z, mieTint: a4.xyz, limb: a4.w, twilight: a5.x };
    const NS = { ...(TSL as Any), Loop: (_n: unknown, body: Any) => TSL.Loop({ start: int(0), end: int(tune.x), type: 'int', condition: '<' }, body) };
    // Its steps laid as the sky's bodies lay theirs (`BODY_LAY`), so a rim from orbit marches as the same world's rim from a moon.
    const air = airShader(NS, U, { T: rimTexture('tT', f.t), MS: rimTexture('tMS', f.ms), E: rimTexture('tE', f.e) }, tune.x, BODY_LAY);
    const marched = air.march(rd, C, kmPer, sunW);
    const L = vec3(marched.L).toVar('rimAirL');
    const Tv = vec3(marched.Tv).toVar('rimAirTv');
    // The ground: where the ray meets it (the near crossing), its normal, the star's height there and its picture's place
    // (three's sphere: u round from -x toward +z, v from the top), the picture read with its derivatives mended at the seam.
    const fw = max(fwidth(b), 1e-6).toVar('rimFw');
    const cover = float(1).sub(smoothstep(bottom.sub(fw), bottom.add(fw), b)).toVar('rimCover');
    const sg = sqrt(max(bottom.mul(bottom).sub(b.mul(b)), 0)).negate();
    const n = normalize(P.add(rd.mul(sg))).toVar('rimN');
    const mu = dot(n, sunW).toVar('rimMu');
    const uA = atan(n.z, n.x.negate()).mul(1 / (2 * Math.PI)).add(1).toVar('rimUa');
    const uv0 = vec2(fract(uA), float(1).sub(TSL.acos(TSL.clamp(n.y, -1, 1)).mul(1 / Math.PI))).toVar('rimUv');
    const uB = fract(uA.add(0.5));
    const pick = (d: Any, e: Any): Any => select(abs(d).lessThan(abs(e)), d, e);
    const dx = vec2(pick(dFdx(uv0.x), dFdx(uB)), dFdx(uv0.y));
    const dy = vec2(pick(dFdy(uv0.x), dFdy(uB)), dFdy(uv0.y));
    const pic = texture(rimTexture('map', f.pic), uv0).grad(dx, dy).toVar('rimPic');
    const albedo = mix(colour, pic.rgb, s1.z);
    const lit = air.lightAt(bottom, mu);
    // The ambient as three's hemisphere gives it and the fill as its directional light does: the planet's own sphere's other light.
    const amb = mix(ambGround, ambSky, n.y.mul(0.5).add(0.5)).add(fill.mul(max(dot(n, fillDir), 0)));
    const surface = albedo.mul(light.mul(vec3(lit.sun).mul(max(mu, 0)).add(vec3(lit.sky))).add(amb)).mul(1 / Math.PI);
    const rgb = surface.mul(Tv).mul(cover).add(L.mul(light));
    const seen = float(1).sub(Tv.x.add(Tv.y).add(Tv.z).mul(1 / 3));
    const alpha = cover.add(float(1).sub(cover).mul(seen));
    return vec4(rgb, alpha);
  })();
  return markMotion(m, 'sky');
}

let GRAPHS: { painted: THREE.Material | null; scattered: THREE.Material | null } = { painted: null, scattered: null };
function graphOf(form: 'painted' | 'scattered'): THREE.Material {
  return (GRAPHS[form] ??= rimGraph(form));
}

/** The shells' one sphere (a unit sphere the frame scales to each shell's top). */
let SHELL: THREE.SphereGeometry | null = null;
function shellGeometry(): THREE.SphereGeometry {
  return (SHELL ??= new THREE.SphereGeometry(1, 96, 48));
}

// ---------------------------------------------------------------- his looks worn

/** A look worn by a zone's planet: its place, the look's id, how its pictures were had, the texture made of them. */
interface Worn {
  place: string;
  id: string;
  how: string;
  size: number;
  clouds: boolean;
  texture: THREE.DataTexture;
}

/**
 * The look the owner's Save to game gives a planet's place, worn: its pictures (`GpuLooks.bake`, behind the screen alone) laid
 * into one picture, the clouds over the surface by their cover (in the pictures' own sRGB, as the viewer lays a cloud layer
 * over), and put on the planet's own sphere in place of SWG's picture (freed: nothing else holds it). The bake's longitude 0
 * stands where three's sphere's u = 0.25 does; nothing about a planet in space fixes its turn, so the picture is laid as it
 * comes. Null where the place wears no generated look or its bake is put off to the next screen (SWG's picture stays).
 */
async function wearLook(place: string, mat: THREE.MeshLambertMaterial): Promise<Worn | null> {
  const hit = lookOfPlace(place);
  const looks = GPU.rt?.looks;
  if (!hit || !looks) return null;
  const pics = await looks.bake(hit.id, hit.look, LOOK_BAKE_TUNE.spaceSize);
  if (!pics) return null;
  // Toned as the look's layers tone it, the clouds laid by their cover times their layer's opacity: the sky's disc's own rule
  // (`discPicture`), so a world reads the same from a moon and from its orbit (the fixer of pass 2, wave 4b).
  const px = layLatLong(pics, hit.look);
  const c = pics.clouds;
  // The bake's own pictures let go once laid into the planet's (the fixer of pass 2, wave 4b: 16 MB a planet kept all session
  // before); the browser's storage holds them for the next screen.
  looks.release(hit.look, LOOK_BAKE_TUNE.spaceSize);
  const t = new THREE.DataTexture(px, pics.width, pics.height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  mat.map?.dispose();
  mat.map = t;
  mat.color.setRGB(1, 1, 1);
  return { place, id: hit.id, how: pics.how, size: pics.width, clouds: !!c, texture: t };
}

// ---------------------------------------------------------------- one zone's planets

/** A zone's planet as the world hands it over: its sphere, the radius it was built at, and its row in the zone's file. */
export interface SpaceRimBody {
  readonly mesh: THREE.Mesh;
  readonly radius: number;
  readonly index: number;
}

interface Rim {
  body: SpaceRimBody;
  /** Its place in the space body viewer (`spacePlaceIds`). */
  place: string;
  air: BodyAir;
  state: SpaceRimState;
  painted: THREE.Mesh;
  scattered: THREE.Mesh;
  ready: boolean;
  how: BakeHow | 'none';
  form: 'scattered' | 'painted' | 'none';
  share: number;
  /** The form a look worn here names, or null (the tier's). */
  own: 'scattered' | 'painted' | 'none' | null;
  tables: THREE.DataTexture[];
  /** The planet's own sphere's geometry before it was made finer, put back at the end. */
  coarse: THREE.BufferGeometry | null;
  fine: THREE.BufferGeometry | null;
}

export type SpaceRimsReport = Record<string, unknown> & { rims: Record<string, unknown>[] };

export class SpaceRims {
  private readonly rims: Rim[] = [];
  /** The looks worn by the zone's planets (their pictures freed with the zone). */
  private readonly worn: Worn[] = [];
  private frames = 0;
  private tierAt = -9;
  /** What the zone's planets wear from the owner's file (the look's air), read once at the screen. */
  readonly zone: string;

  private constructor(zone: string) {
    this.zone = zone;
  }

  /**
   * A zone's planets made ready behind its loading screen: each planet with air its record and tables (baked within the bake
   * cache's budget, or read from the browser's storage, by the same key as the sky's bodies, so Naboo's tables baked at Rori
   * serve Naboo's orbit), its painted rim's table, its two shells hung beside it, and its own sphere made finer. `appearances`
   * is the zone's file's planets in order (each body's `index` its row), from which each one's place in the viewer is named and
   * the look the owner's Save to game gives it read (`bodyLookOf`, its air a body with no ground's own record). Answers once
   * every planet's tables are had or put off.
   */
  static async make(zone: string, appearances: readonly string[], bodies: readonly SpaceRimBody[], renderer: unknown = null): Promise<SpaceRims> {
    const s = new SpaceRims(zone);
    installSpaceRimsDebug();
    CURRENT = s;
    RENDERER = renderer;
    const cache = bakeCache();
    cache.beginScreen();
    const f = fallbacks();
    const places = spacePlaceIds(zone, appearances);
    for (const body of bodies) {
      const appearance = appearances[body.index] ?? '';
      const place = places[body.index] ?? '';
      const air = spaceBodyAir(appearance);
      const look = bodyLookOf(place);
      const lookAir = look?.air ?? null;
      const mat = body.mesh.material as THREE.MeshLambertMaterial;
      // His look worn where the Save to game gives the place a generated one (`lookPictures.ts`' `lookOfPlace`): its pictures
      // baked on the card within the screen's budget (or read from storage), the clouds laid over the surface by their cover,
      // the planet's own picture put away; SWG's space picture where none is had (`wearLook`).
      const worn = await wearLook(place, mat);
      if (worn) s.worn.push(worn);
      const rec = air.kind === 'world' ? bodyRecord(air) : lookRecordOf(air, lookAir);
      if (!rec) continue;
      const state = new SpaceRimState(mat.map ?? f.pic, f);
      state.s1.z = mat.map ? 1 : 0;
      state.colour.set(mat.color.r, mat.color.g, mat.color.b);
      writeRecord(state, rec);
      const rim: Rim = { body, place, air, state, painted: null as unknown as THREE.Mesh, scattered: null as unknown as THREE.Mesh, ready: false, how: 'none', form: 'none', share: 0.5, own: lookFormOf(lookAir), tables: [], coarse: null, fine: null };
      // The painted rim's table (a few milliseconds of small tables: never waits on the bake cache).
      const prof = rimProfile(rec);
      const pt = tableTexture(prof, RIM_PROFILE_SIZE, 1);
      rim.tables.push(pt);
      state.rim = pt;
      const key = BakeCache.keyOf('air', bodyTablesKey(rec));
      const got = await cache.take(key, () => {
        const t = makeBodyTables(rec);
        return [t.T, t.MS, t.E];
      });
      rim.how = got.how;
      if (got.parts) {
        const [T, MS, E] = got.parts;
        const tt = tableTexture(T, TABLES.transmittance.width, TABLES.transmittance.height);
        const tm = tableTexture(MS, TABLES.multiScatter.width, TABLES.multiScatter.height);
        const te = tableTexture(E, TABLES.irradiance.width, 1);
        rim.tables.push(tt, tm, te);
        state.tT = tt;
        state.tMS = tm;
        state.tE = te;
        rim.ready = true;
      }
      // The two shells, one geometry, each form's own material (keyed apart), hidden until the frame shows one.
      for (const form of ['painted', 'scattered'] as const) {
        const shell = new THREE.Mesh(shellGeometry(), graphOf(form));
        shell.name = `space rim (${form})`;
        // In the see-through list, after every solid (a ship in front hides it by depth), before the nebulae's sheets.
        shell.renderOrder = -3.5;
        shell.frustumCulled = false;
        shell.userData.swgSpaceRim = state;
        shell.userData.unlit = true;
        shell.visible = false;
        body.mesh.parent?.add(shell);
        if (form === 'painted') rim.painted = shell;
        else rim.scattered = shell;
      }
      // The planet's own sphere made finer, so its edge stands where the rim's ground does.
      const g = body.mesh.geometry as THREE.SphereGeometry;
      rim.coarse = g;
      rim.fine = new THREE.SphereGeometry(body.radius, FINE.width, FINE.height);
      body.mesh.geometry = rim.fine;
      s.rims.push(rim);
    }
    return s;
  }

  /** The tier read again at the next frame (the console's hold moved). */
  rereadTier(): void {
    this.frames = 0;
  }

  /** The first shell of a form (the console's shader readout). */
  shellOf(form: 'painted' | 'scattered'): THREE.Mesh | null {
    const r = this.rims[0];
    return r ? (form === 'painted' ? r.painted : r.scattered) : null;
  }

  /**
   * Once a game frame, after the sky group is put on the camera and the standing bodies placed: each shell put on its planet,
   * its record's frame written (the star, the light, the planet's middle less the eye), its form chosen (the tier's rule,
   * Medium's by its share of the screen; a look's own form wins), one shell shown and the planet's own sphere hidden under the
   * Scattered one. Allocates nothing.
   */
  frame(camera: THREE.PerspectiveCamera): void {
    this.frames++;
    if (this.frames % TIER_EVERY === 1) this.tierAt = RIM_TIER.held >= 0 ? RIM_TIER.held : tierIndexOf(liveSettings());
    const rule = tierRule(this.tierAt);
    STEPS_U.x = rule.steps;
    STEPS_U.y = SPACE_RIM_TUNE.painted;
    const fovY = (camera.fov * Math.PI) / 180;
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    const I = SPACE_RIM_IN;
    const off = SPACE_RIM_TUNE.off >= 0.5;
    for (let i = 0; i < this.rims.length; i++) {
      const r = this.rims[i];
      const st = r.state;
      const mesh = r.body.mesh;
      const p = mesh.position;
      const scale = mesh.scale.x;
      const rg = r.body.radius * scale;
      const bottom = st.a0.x;
      const top = st.a0.y;
      const rt = (rg * top) / bottom;
      const d = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      const drawn = rt * SHELL_OVER;
      // Every number written into its field (a number handed across a call is a number made).
      const s0 = st.s0;
      s0.x = p.x;
      s0.y = p.y;
      s0.z = p.z;
      s0.w = drawn;
      st.s1.x = rg;
      st.s1.y = rg > 0 ? bottom / rg : 1;
      const sun = st.sun;
      sun.x = I.sunX;
      sun.y = I.sunY;
      sun.z = I.sunZ;
      const light = st.light;
      light.x = I.lightR;
      light.y = I.lightG;
      light.z = I.lightB;
      const sky = st.ambSky;
      sky.x = I.skyR;
      sky.y = I.skyG;
      sky.z = I.skyB;
      const ground = st.ambGround;
      ground.x = I.groundR;
      ground.y = I.groundG;
      ground.z = I.groundB;
      const fd = st.fillDir;
      fd.x = I.fillX;
      fd.y = I.fillY;
      fd.z = I.fillZ;
      const fl = st.fill;
      fl.x = I.fillR;
      fl.y = I.fillG;
      fl.z = I.fillB;
      st.a4.w = BODY_TUNE.limb;
      st.a5.x = BODY_TUNE.twilight;
      // Its share of the screen (`screenShareOf`'s rule written out: the disc's tangent squared over the screen's).
      const sin = d > rt ? rt / d : 1;
      const tan = sin < 0.997 ? sin / Math.sqrt(1 - sin * sin) : 12.9;
      const h = Math.tan(fovY * 0.5);
      r.share = (Math.PI * tan * tan) / (4 * h * h * aspect);
      let form: 'scattered' | 'painted' | 'none' = 'none';
      if (!off && d > rt) {
        const want = BODY_TUNE.form;
        form = bodyFormOf(this.tierAt, r.share, want !== 'tier' ? want : r.own, true, false);
        if (form === 'scattered' && !r.ready) form = 'painted';
      }
      r.form = form;
      const painted = r.painted;
      const scattered = r.scattered;
      painted.visible = form === 'painted';
      scattered.visible = form === 'scattered';
      const shown = form === 'painted' ? painted : form === 'scattered' ? scattered : null;
      if (shown) {
        shown.position.copy(p);
        const sc = shown.scale;
        sc.x = drawn;
        sc.y = drawn;
        sc.z = drawn;
      }
      // The Scattered shell draws the planet itself; its own sphere stands down meanwhile.
      mesh.visible = form !== 'scattered';
    }
  }

  report(): SpaceRimsReport {
    const r = tierRule(this.tierAt);
    return {
      zone: this.zone,
      tier: this.tierAt,
      steps: r.steps,
      tune: { ...SPACE_RIM_TUNE },
      worn: this.worn.map((w) => ({ place: w.place, look: w.id, how: w.how, size: w.size, clouds: w.clouds })),
      rims: this.rims.map((x) => ({
        place: x.place,
        shows: x.air.kind === 'world' ? x.air.world : x.air.kind,
        form: x.form,
        ownForm: x.own,
        tables: x.ready ? x.how : `not baked (${x.how}): Painted until the next loading screen`,
        shareOfScreen: Number(x.share.toPrecision(3)),
        km: { bottom: x.state.a0.x, top: x.state.a0.y },
      })),
      bake: { ...bakeCache().stats },
    };
  }

  /** Everything this zone's rims made let go: the shells out of the sky group, the planets' own spheres put back, the tables. */
  dispose(forget: (materials: Iterable<THREE.Material>) => void): void {
    for (const r of this.rims) {
      r.painted.removeFromParent();
      r.scattered.removeFromParent();
      delete r.painted.userData.swgSpaceRim;
      delete r.scattered.userData.swgSpaceRim;
      if (r.coarse && r.body.mesh.geometry === r.fine) r.body.mesh.geometry = r.coarse;
      r.fine?.dispose();
      r.body.mesh.visible = true;
      for (const t of r.tables) t.dispose();
    }
    // The two graphs are the session's (every zone's shells share them): nothing to forget or free here. A worn look's picture
    // is its planet's own sphere's map now, freed with the sphere (`World.disposeSpaceBodies`).
    forget([]);
    this.rims.length = 0;
    this.worn.length = 0;
    if (CURRENT === this) CURRENT = null;
  }
}

/** The record into a shell's packed numbers (`skyBody.ts`' `writeRecord`, the same layout). */
function writeRecord(st: SpaceRimState, rec: Float64Array): void {
  st.a0.set(rec[F.bottom], rec[F.top], rec[F.rayH], rec[F.mieH]);
  st.a1.set(rec[F.rayR], rec[F.rayG], rec[F.rayB], rec[F.mieS]);
  st.a2.set(rec[F.ozR], rec[F.ozG], rec[F.ozB], rec[F.mieA]);
  st.a3.set(rec[F.ozC], rec[F.ozW], rec[F.mieG], 1);
  st.a4.set(rec[F.mieTintR], rec[F.mieTintG], rec[F.mieTintB], BODY_TUNE.limb);
  st.a5.set(BODY_TUNE.twilight, 0.5, 0.5, 0.5);
}

/** The graphs let go (a session's end; the tests'). */
export function resetSpaceRimGraphs(): void {
  GRAPHS = { painted: null, scattered: null };
}

// ---------------------------------------------------------------- the console

/** The zone's rims while a space zone stands, and the renderer that draws them (the console's). */
let CURRENT: SpaceRims | null = null;
let RENDERER: unknown = null;

/**
 * `__debug.spaceRims()` says each planet's air in the zone (its place, what it shows, its form, its tables, its share of the
 * screen); `({ tune: { painted, off } })` moves the rims' dials live; `({ form: 'scattered' | 'painted' | 'none' | 'tier' })`
 * every body's form at once (the bodies' own switch, `BODY_TUNE.form`, shared with the sky's moons and planets).
 */
const spaceRimsHook = (o?: { tune?: Record<string, unknown>; form?: string; shader?: 'painted' | 'scattered'; face?: number[]; fov?: number }): Record<string, unknown> | string | Promise<unknown> => {
  // A form's built shader text (three's WGSL for the first shell of that form), for reading what the card runs.
  if (o?.shader && CURRENT && RENDERER) {
    const mesh = CURRENT.shellOf(o.shader);
    const cam = new THREE.PerspectiveCamera();
    return mesh ? (RENDERER as Any).debug.getShaderAsync(mesh, cam, mesh).then((s: Any) => ({ vertex: s.vertexShader, fragment: s.fragmentShader })) : 'no shell of that form';
  }
  // The prover's aim: a sky match held (`__debug.sky({ match: true })` holds the camera where it is) turned to face a direction.
  const face = (o as { face?: number[] } | undefined)?.face;
  if (Array.isArray(face) && face.length === 3 && MATCH_HOLD.on) {
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(face[0], face[1], face[2]).normalize(), new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    MATCH_HOLD.qx = q.x;
    MATCH_HOLD.qy = q.y;
    MATCH_HOLD.qz = q.z;
    MATCH_HOLD.qw = q.w;
    const fov = (o as { fov?: number }).fov;
    if (typeof fov === 'number' && fov > 5 && fov < 150) MATCH_HOLD.fov = fov;
  }
  const said: string[] = [];
  if (o?.tune) said.push(...tuneSpaceRims(o.tune));
  if (o?.form !== undefined) said.push(...tuneBodies({ form: o.form }));
  // The prover's tier for the rims alone (their forms and steps as that tier's), or `null` for the settings' own.
  const tier = (o as { tier?: number | null } | undefined)?.tier;
  if (tier === null || (typeof tier === 'number' && tier >= -1 && tier <= 3)) {
    RIM_TIER.held = tier === null ? -1 : Math.round(tier);
    if (CURRENT) CURRENT.rereadTier();
  }
  if (!CURRENT) return `no space zone's planets here (WebGPU in a space zone draws them)${said.length ? ': ' + said.join('; ') : ''}`;
  const r = CURRENT.report();
  if (said.length) r.said = said;
  return r;
};

/** Put the hook on `__debug` (called at every zone's make: the game builds its `__debug` in one go at startup). */
export function installSpaceRimsDebug(): void {
  if (typeof window === 'undefined') return;
  const holder = window as unknown as { __debug?: Record<string, unknown> };
  const debug = (holder.__debug ??= {});
  if (debug.spaceRims !== spaceRimsHook) debug.spaceRims = spaceRimsHook;
}
