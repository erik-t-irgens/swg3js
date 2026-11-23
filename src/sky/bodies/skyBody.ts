// Moons and planets in the sky as lit spheres seen through the world's air (the GPU port's pass 2, wave 4a; the design's 2.5
// and 2.6, the brief's items 5, 6 and 8). WebGPU only: the runtime makes it (`GpuRuntime.skyBodies`), nothing here is loaded
// on the WebGL path.
//
// **Each body is a card** the sky places as it placed SWG's flat picture (`src/world/sky.ts`'s `place`: SWG's rule for where,
// the moon riding the light by night, opposite the sun, the extra bodies fixed in the sky, until wave 5 applies systems), and
// every pixel of it works out what the eye sees along its own ray:
//   - **the world's air in front**: its transmittance to space (`AIR.tables.transmittanceToSpace`), the body's light added to
//     the dome's own sky behind it (which is the air's light along that very ray), so a body by day is the sky plus its own
//     light dimmed by the air: pale against the blue as ours is, red and dim low over the horizon, bright at night (held to
//     `BODY_TUNE.seenMost` of the screen's white, so a night's opened eye does not blow it over the frame);
//   - **its surface at its physical light**: SWG's flat picture with the shading SWG painted into it (the design's rule for a
//     place still in SWG's look), its reflectance `BODY_TUNE.flatAlbedo`, or (`BODY_TUNE.sphere`, the stand-in for a look) a
//     sphere lit by the star from where the star really is, its phase following the sun, the picture its colours; both lit by
//     the star's light at the top of the world's air (`AIR.frame.sunTop`, the scene's units);
//   - **its own air** (Scattered, by the tier, `bodyTier.ts`): the viewer's march through the body's shell
//     (`src/sky/look/airProfile.js`'s `airShader`, one file the viewer and the game import), its record the world's own where
//     the body is a ground world (`bodyAir.ts`), its three tables made on the main thread behind the loading screen and kept
//     in the browser's storage by the record's hash (`bakeCache.ts`), so only a first arrival bakes. Painted draws SWG's glow
//     picture as the body's halo instead; a body whose tables are not baked yet takes Painted until the next loading screen.
//
// **Both forms are built behind the loading screen.** A body with air has two cards over one geometry, the Painted and the
// Scattered, both in the sky's group when the sky is built (`World.gpuSkyReady`), and the frame shows one; each form's graph is
// one for every body (its key the card material's text), its numbers read off the drawn card at every draw (an object's own
// group, refreshed at every draw, as `gpuPrograms.ts`' graphs are), so nothing is built in play.
//
// **A frame allocates nothing**: every number goes into a kept vector of the card's record.
import * as THREE from 'three';
import { MeshBasicNodeMaterial, NodeUpdateType, TextureNode } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { AIR } from '../air/airApi.ts';
import { F } from '../air/airParams.ts';
import { TABLES, airShader, type AirProfileTables } from '../look/airProfile.js';
import { markMotion } from '../../core/gpu/motion.ts';
import { BODY_LAY, BODY_TUNE, bodyFormOf, tierRule } from './bodyTier.ts';
import { bodyRecord, bodyTablesKey, hasAir, makeBodyTables } from './bodyAir.ts';
import { BakeCache, idbStore, type BakeHow } from './bakeCache.ts';
import { bodyCardMaterial, type SkyBodyCard } from './bodyCard.ts';
import { tierIndexOf } from '../night/nightTier.ts';
import { liveSettings } from '../../core/settings.ts';
import { eyeExposureNode } from '../exposure/eyeBuffer.ts';
import { turnSkyBody } from '../../world/skyBodies.ts';
import { skyLookOf } from '../look/skyLooks.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, clamp, dFdx, dFdy, dot, float, fwidth, int, max, min, mix, normalize, renderGroup, smoothstep, sqrt, texture, uniform, uv, vec2, vec3, vec4 } = TSL as Any;

/** How often the frame reads the tier (a read walks the tier table; frames). */
const TIER_EVERY = 30;

// ---------------------------------------------------------------- the card's record

/** What a card's graph reads off the drawn card at every draw: kept vectors, written in place by the frame. */
export class BodyCardState {
  /** The card's width over its distance, the tangent of its disc's angular radius, the sphere switch (0 or 1), its opacity. */
  readonly card = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /** The star's direction in the card's frame (x right, y up, z toward the eye). */
  readonly sun = new THREE.Vector3(0, 1, 0);
  /** The card's frame in the world: toward its middle, its right, its up (directions alone: no place reaches the card). */
  readonly dir = new THREE.Vector3(0, 0, -1);
  readonly right = new THREE.Vector3(1, 0, 0);
  readonly up = new THREE.Vector3(0, 1, 0);
  /** The body's air record packed (airProfile's uniforms): bottom, top, Rayleigh's height, the haze's height. */
  readonly a0 = new THREE.Vector4(6360, 6460, 8, 1.2);
  /** Rayleigh's red, green, blue; the haze's scattering. */
  readonly a1 = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /** Ozone's red, green, blue; the haze's absorption. */
  readonly a2 = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /** Ozone's centre and half width, the haze's phase, the body's distance in km (a unit of the card's frame). */
  readonly a3 = new THREE.Vector4(25, 15, 0.8, 1e5);
  /** The haze's colour; the limb's brightness. */
  readonly a4 = new THREE.Vector4(1, 1, 1, 1);
  /**
   * The twilight's brightness; what covers what stands behind (pass 2, wave 4b: 0 the sphere's disc, 1 the picture's own
   * alpha, a held body's: a station's or a ship's outline); its light (a held body's `light`, 1 as converted); and (the
   * fixer of pass 2, wave 4b) its sphere's reflectance, written by the frame: `BODY_TUNE.sphereAlbedo` for SWG's picture,
   * the worn look's own (`skyLooks.ts`) for a body wearing one.
   */
  readonly a5 = new THREE.Vector4(1, 0, 1, 0.3);
  /**
   * Pass 2, wave 5 (maker L): whether the body is up this frame (written by the frame), and whether its look is drawn whole
   * by `lookBody.ts` (set at its making): then this card, its Scattered twin and its halo stand down, and the look's card is
   * placed from this record.
   */
  shown = false;
  lookDrawn = false;
  /** Its picture and its air's three tables (half floats), or the fallbacks. */
  map: THREE.Texture;
  tT: THREE.Texture;
  tMS: THREE.Texture;
  tE: THREE.Texture;
  constructor(map: THREE.Texture, f: Fallbacks) {
    this.map = map;
    this.tT = f.t;
    this.tMS = f.ms;
    this.tE = f.e;
  }
}

/** One fallback a texture slot (never shared: three gives two slots holding one texture one binding), each of its slot's kind. */
interface Fallbacks {
  pic: THREE.Texture;
  t: THREE.Texture;
  ms: THREE.Texture;
  e: THREE.Texture;
}
let FALLBACKS: Fallbacks | null = null;
function fallbacks(): Fallbacks {
  if (!FALLBACKS) {
    const pic = new THREE.DataTexture(new Uint8Array([128, 128, 128, 0]), 1, 1, THREE.RGBAFormat);
    pic.colorSpace = THREE.SRGBColorSpace;
    pic.minFilter = pic.magFilter = THREE.LinearFilter;
    pic.needsUpdate = true;
    const half = (): THREE.DataTexture => {
      const one = THREE.DataUtils.toHalfFloat(0);
      const t = new THREE.DataTexture(new Uint16Array([one, one, one, THREE.DataUtils.toHalfFloat(1)]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    FALLBACKS = { pic, t: half(), ms: half(), e: half() };
  }
  return FALLBACKS;
}

/** A table of airProfile's (RGBA floats) as a half-float picture the card samples (filterable on every adapter). */
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

// ---------------------------------------------------------------- reading the drawn card

interface Frame {
  object?: { userData?: { swgBodyCard?: BodyCardState } } | null;
}

/** A number of the drawn card's record, read at every draw (the object's own group). */
function cardVec(field: 'card' | 'sun' | 'dir' | 'right' | 'up' | 'a0' | 'a1' | 'a2' | 'a3' | 'a4' | 'a5', init: THREE.Vector3 | THREE.Vector4): Any {
  return uniform(init).onObjectUpdate((f: Frame) => f.object?.userData?.swgBodyCard?.[field] ?? init);
}

/** Three's texture node, typed loosely (its update and matrix switch are typed narrower than three calls them). */
const TextureNodeBase = TextureNode as Any;

/** A texture of the drawn card's record, read at every draw: every sample a clone of one base (one binding), each writing the card's texture through to it. */
class CardTexture extends TextureNodeBase {
  field: 'map' | 'tT' | 'tMS' | 'tE' = 'map';
  fallback: THREE.Texture | null = null;
  constructor(value: THREE.Texture, uvNode: Any = null, levelNode: Any = null, biasNode: Any = null) {
    super(value, uvNode, levelNode, biasNode);
    this.updateType = NodeUpdateType.OBJECT;
    this.setUpdateMatrix(false);
  }
  update(frame: Frame): void {
    const t = frame.object?.userData?.swgBodyCard?.[this.field] ?? this.fallback;
    if (t && this.value !== t) this.value = t;
  }
  clone(): Any {
    const n = super.clone() as CardTexture;
    n.field = this.field;
    n.fallback = this.fallback;
    (n as Any).setUpdateMatrix(false);
    return n;
  }
}
function cardTexture(field: CardTexture['field'], fallback: THREE.Texture): Any {
  const n = new CardTexture(fallback);
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

// ---------------------------------------------------------------- the dials and the tier, once a render

/** The dials every card reads (written by the frame, read once a render): the flat and sphere reflectances, the night side's fill. */
const TUNE_U = new THREE.Vector4(0.4, 0.3, 0.5, 0.5);
/** The march's steps (the tier's) as a number the loop runs to. */
const STEPS_U = new THREE.Vector4(12, 0.5, 0.5, 0.5);

// ---------------------------------------------------------------- the two graphs

/**
 * A form's graph (one for every body): the card's ray, the world's air in front, the surface flat or lit, and for
 * Scattered the body's own air marched through its shell. Built once a session per form, as the first card is built.
 */
function cardGraph(form: 'painted' | 'scattered'): THREE.Material {
  const tables = AIR.tables;
  const m = new MeshBasicNodeMaterial();
  m.name = `gpu: sky body (${form})`;
  m.fog = false;
  // Pass 2, wave 4b: the alpha is the graph's own. Three multiplies a stand-in's alpha by the drawn material's opacity, and
  // the sky writes SWG's fade by the hour into the card's opacity (its `place`): with `swgFade` 0 that was nought by day and
  // the coverage below read as none, which is what wave 4a saw as "twice the sky" (the dome kept whole under the sky put back).
  m.opacityNode = float(1);
  everyDraw(m);
  const f = fallbacks();
  const card = cardVec('card', new THREE.Vector4(0.5, 0.5, 0.5, 0.5));
  const sunC = cardVec('sun', new THREE.Vector3(0, 1, 0));
  const dirW = cardVec('dir', new THREE.Vector3(0, 0, -1));
  const rightW = cardVec('right', new THREE.Vector3(1, 0, 0));
  const upW = cardVec('up', new THREE.Vector3(0, 1, 0));
  const pic = cardTexture('map', f.pic);
  const tune = uniform(TUNE_U).setGroup(renderGroup);
  const sunTop = tables ? tables.nodes.sunTop : vec3(0);
  // The eye's exposure on the card (the screen's white is one over it, in the scene's units).
  const eye = eyeExposureNode();
  const PI = Math.PI;
  m.colorNode = Fn(() => {
    const at = uv();
    // The card's tangent plane: its ray in the card's frame and in the world's (directions alone).
    const tx = at.x.sub(0.5).mul(card.x).toVar('bodyTx');
    const ty = at.y.sub(0.5).mul(card.x).toVar('bodyTy');
    const dW = normalize(rightW.mul(tx).add(upW.mul(ty)).add(dirW)).toVar('bodyDW');
    const dC = normalize(vec3(tx, ty, -1)).toVar('bodyDC');
    // The world's air in front, read at the top (every table and derivative before any select).
    const Tw = (tables ? vec3(tables.transmittanceToSpace(dW)) : vec3(1)).toVar('bodyTw');
    // Pass 2, wave 4b: the sky's own light along the ray, the dome's very light there (`airSky.ts`: the air's sky view), put
    // back over what the body covers: the body is past the air, so the air's light is in front of it and stays, while the
    // stars, the band and the sun's disc behind it are covered.
    const skyBack = (tables ? vec3(tables.skyRadiance(dW)) : vec3(0)).toVar('bodySkyBack');
    // The sphere at a unit distance: its angular radius's sine, the ray's nearest approach, where it meets the surface.
    const tanD = card.y;
    const sinD = tanD.div(sqrt(tanD.mul(tanD).add(1))).toVar('bodySinD');
    const q2 = tx.mul(tx).add(ty.mul(ty));
    const rho = sqrt(q2.div(q2.add(1))).toVar('bodyRho');
    const fw = max(fwidth(rho), 1e-6).toVar('bodyFw');
    const cover = float(1).sub(smoothstep(sinD.sub(fw), sinD.add(fw), rho)).toVar('bodyCover');
    const tc = dC.z.negate();
    const inside = max(sinD.mul(sinD).sub(float(1).sub(tc.mul(tc))), 0);
    const tHit = tc.sub(sqrt(inside));
    const nrm = normalize(dC.mul(tHit).add(vec3(0, 0, 1))).toVar('bodyN');
    const flat = texture(pic, at).toVar('bodyFlat');
    const uvS = vec2(0.5, 0.5).add(nrm.xy.mul(tanD.div(max(card.x, 1e-6))));
    const sph = texture(pic, uvS).grad(dFdx(at), dFdy(at)).toVar('bodySph');
    const mu = dot(nrm, sunC).toVar('bodyMu');
    const sphere = card.z;
    const opacity = card.w;
    // The card's last four numbers: its twilight (`x`), how much it covers by its picture's own alpha (`y`, a held body's),
    // its light dial (`z`) and (the fixer of pass 2, wave 4b) its sphere's reflectance (`w`: SWG's picture's
    // `BODY_TUNE.sphereAlbedo`, a worn look's own albedo, 1, since a look's colours are its albedo).
    const a5 = cardVec('a5', new THREE.Vector4(1, 0, 1, 0.3));
    const sphAlb = a5.w;
    // The flat picture's light (its painted shading in its alpha), and the sphere's lit by the star.
    const flatRad = flat.rgb.mul(flat.a).mul(tune.x).mul(sunTop).mul(1 / PI);
    // The body's own light held, as a whole, to `seenMost` times the screen's white: the light a white pixel of its picture
    // would send through the air (the larger of its two reflectances), times the eye's exposure, sets one factor for the whole
    // disc, so its painted features still read when it is held (a pixel-by-pixel cap would flatten them to one white).
    const whiteLum = dot(Tw.mul(sunTop), vec3(0.2126, 0.7152, 0.0722)).mul(max(tune.x, sphAlb)).mul(1 / PI).mul(eye);
    const hold = min(float(1), tune.w.div(max(whiteLum, 1e-30))).toVar('bodyHold');
    const seen = (own: Any): Any => own.mul(hold);
    // Pass 2, wave 4b: the body covers what stands behind it. Its card blends one and one less its alpha (premultiplied over,
    // `bodyCard.ts`), so its alpha is how much of what is behind it the body hides: its sphere's disc (a moon, a planet), or
    // the picture's own alpha (a held station or ship, `a5.y`); faded with the body by the storms (its opacity). Under our
    // sky that alpha takes the dome as well as the stars, the band and the sun's disc behind the body, so the sky's own light
    // along the ray (`skyBack`, the air in front of the body) is put back times it. Its own light is added on top, through the
    // air in front (`Tw`), and times its `light` (`a5.z`, a held body's dial; 1 for the rest).
    const covered = mix(cover, flat.a, clamp(a5.y, 0, 1)).toVar('bodyCovered');
    if (form === 'painted') {
      const sphRad = sph.rgb.mul(sphAlb).mul(sunTop).mul(max(mu, 0)).mul(1 / PI);
      const own = seen(mix(Tw.mul(flatRad), cover.mul(Tw.mul(sphRad)), sphere)).mul(a5.z);
      const alpha = covered.mul(opacity);
      return vec4(own.mul(opacity).add(skyBack.mul(alpha)), alpha);
    }
    // Scattered: the body's own air, the viewer's march (16, 12 or 8 steps, the tier's, a number the loop runs to).
    const a0 = cardVec('a0', new THREE.Vector4(6360, 6460, 8, 1.2));
    const a1 = cardVec('a1', new THREE.Vector4(0.5, 0.5, 0.5, 0.5));
    const a2 = cardVec('a2', new THREE.Vector4(0.5, 0.5, 0.5, 0.5));
    const a3 = cardVec('a3', new THREE.Vector4(25, 15, 0.8, 1e5));
    const a4 = cardVec('a4', new THREE.Vector4(1, 1, 1, 1));
    const steps = uniform(STEPS_U).setGroup(renderGroup);
    const U = { bottom: a0.x, top: a0.y, rayH: a0.z, mieH: a0.w, ray: a1.xyz, mieS: a1.w, oz: a2.xyz, mieA: a2.w, ozC: a3.x, ozW: a3.y, mieG: a3.z, mieTint: a4.xyz, limb: a4.w, twilight: a5.x };
    // The viewer's shader half handed three's namespace with its loop running to the tier's count (one graph for every tier),
    // its steps laid by the game's power (`BODY_LAY`: the limb within 3% of the ground path at High's 12).
    const NS = { ...(TSL as Any), Loop: (_n: unknown, body: Any) => TSL.Loop({ start: int(0), end: int(steps.x), type: 'int', condition: '<' }, body) };
    const air = airShader(NS, U, { T: cardTexture('tT', f.t), MS: cardTexture('tMS', f.ms), E: cardTexture('tE', f.e) }, steps.x, BODY_LAY);
    const C = vec3(0, 0, -1);
    const marched = air.march(dC, C, a3.w, sunC);
    const L = vec3(marched.L).toVar('bodyAirL');
    const Tv = vec3(marched.Tv).toVar('bodyAirTv');
    const lit = air.lightAt(a0.x, mu);
    const sphRad = sph.rgb.mul(sphAlb).mul(sunTop).mul(vec3(lit.sun).mul(max(mu, 0)).add(vec3(lit.sky))).mul(1 / PI);
    const surface = mix(flatRad, sphRad.mul(cover), sphere);
    const own = seen(Tw.mul(surface.mul(Tv).add(L.mul(sunTop)))).mul(a5.z);
    // Its air hides what is behind it as much as it dims it: the disc whole, the shell by what gets through it.
    const shell = float(1).sub(clamp(Tv.x.add(Tv.y).add(Tv.z).div(3), 0, 1));
    const alpha = covered.add(float(1).sub(covered).mul(shell)).mul(opacity);
    return vec4(own.mul(opacity).add(skyBack.mul(alpha)), alpha);
  })();
  return markMotion(m, 'sky');
}

let GRAPHS: { painted: THREE.Material | null; scattered: THREE.Material | null } = { painted: null, scattered: null };
function graphOf(form: 'painted' | 'scattered'): THREE.Material {
  return (GRAPHS[form] ??= cardGraph(form));
}

// ---------------------------------------------------------------- the bodies of one sky

/** The session's bake cache (one, so a look baked on one screen is kept for the next). */
let CACHE: BakeCache | null = null;
export function bakeCache(): BakeCache {
  return (CACHE ??= new BakeCache(idbStore()));
}

interface Body {
  card: SkyBodyCard;
  state: BodyCardState;
  /** The Scattered card (a body with air), or null. */
  twin: THREE.Mesh | null;
  air: boolean;
  /** Whether its tables are made (its Scattered form can draw), and how they were had. */
  ready: boolean;
  how: BakeHow | 'none';
  /** Its form this frame. */
  form: 'scattered' | 'painted' | 'none';
  /** The share of the screen its disc covered at the last frame, and whether it was up then. */
  share: number;
  up: boolean;
  tables: THREE.DataTexture[];
  /**
   * The fixer of pass 2, wave 4b: the reflectance of the look it wears (`skyLooks.ts`' `skyLookOf`), or -1 for SWG's picture. A
   * body wearing a look is lit as a sphere whatever `BODY_TUNE.sphere` says for SWG's pictures, and takes its tier's form.
   */
  look: number;
}

/** What a sky's bodies say, for `__debug.skyBodies()`. */
export type SkyBodiesReport = Record<string, unknown> & {
  bodies: Record<string, unknown>[];
  tier: number;
  steps: number;
  bake: Record<string, unknown>;
};

export class SkyBodies {
  private readonly bodies: Body[] = [];
  private frames = 0;
  private tierAt = -9;
  /** The camera's field and aspect last read (a frame's own arithmetic, no number across a call). */
  private readonly view = new THREE.Vector2(1, 1);

  /**
   * A sky's cards made ready behind its loading screen: each body's record and tables (baked within the screen's budget, or
   * read from the browser's storage), its Scattered twin made beside it, and each card's material told its stand-in, so the
   * sky's build (`World.gpuSkyReady`) builds both forms. Answers once every body's tables are had or put off.
   */
  static async make(cards: readonly SkyBodyCard[]): Promise<SkyBodies> {
    const s = new SkyBodies();
    const cache = bakeCache();
    cache.beginScreen();
    const f = fallbacks();
    for (const card of cards) {
      const state = new BodyCardState(card.map, f);
      card.disc.userData.swgBodyCard = state;
      (card.disc.material as THREE.Material).userData.gpuStandIn = () => graphOf('painted');
      const air = hasAir(card.air);
      const worn = skyLookOf(card.disc);
      const b: Body = { card, state, twin: null, air, ready: false, how: 'none', form: 'none', share: 0.5, up: false, tables: [], look: worn ? worn.albedo : -1 };
      // Pass 2, wave 4b: a held body (a station, a ship) covers by its picture's own outline and shines by its own light dial.
      if (card.held) {
        state.a5.y = 1;
        state.a5.z = card.held.light;
      }
      if (air) {
        const rec = bodyRecord(card.air);
        if (rec) {
          writeRecord(state, rec);
          const key = BakeCache.keyOf('air', bodyTablesKey(rec));
          const got = await cache.take(key, () => {
            const t: AirProfileTables = makeBodyTables(rec);
            return [t.T, t.MS, t.E];
          });
          b.how = got.how;
          if (got.parts) {
            const [T, MS, E] = got.parts;
            b.tables = [tableTexture(T, TABLES.transmittance.width, TABLES.transmittance.height), tableTexture(MS, TABLES.multiScatter.width, TABLES.multiScatter.height), tableTexture(E, TABLES.irradiance.width, 1)];
            state.tT = b.tables[0];
            state.tMS = b.tables[1];
            state.tE = b.tables[2];
            b.ready = true;
          }
        }
        // The Scattered card beside the Painted one: the same geometry, a material keyed apart, both built with the sky.
        const twinMat = bodyCardMaterial(card.map, 'scattered');
        twinMat.userData.gpuStandIn = () => graphOf('scattered');
        const twin = new THREE.Mesh(card.disc.geometry, twinMat);
        twin.name = 'sky body (scattered)';
        twin.renderOrder = card.disc.renderOrder;
        twin.frustumCulled = card.disc.frustumCulled;
        twin.layers.mask = card.disc.layers.mask;
        twin.userData.swgBodyCard = state;
        twin.visible = false;
        card.disc.parent?.add(twin);
        b.twin = twin;
      }
      s.bodies.push(b);
    }
    return s;
  }

  /**
   * Once a game frame after the sky has placed its cards (`SwgSky.update`): each body's record written from its card (its
   * place, size, opacity and whether it is up, as the sky left them) and the star, and its form chosen (the tier's rule,
   * Medium's by its share of the screen), one card of the two shown. Allocates nothing.
   */
  frame(camera: THREE.PerspectiveCamera): void {
    this.frames++;
    if (this.frames % TIER_EVERY === 1) this.tierAt = tierIndexOf(liveSettings());
    const rule = tierRule(this.tierAt);
    STEPS_U.x = rule.steps;
    TUNE_U.x = BODY_TUNE.flatAlbedo;
    TUNE_U.y = BODY_TUNE.sphereAlbedo;
    TUNE_U.z = BODY_TUNE.nightFill;
    TUNE_U.w = BODY_TUNE.seenMost;
    this.view.x = (camera.fov * Math.PI) / 180;
    this.view.y = camera.aspect > 0 ? camera.aspect : 1;
    const h = Math.tan(this.view.x * 0.5);
    const screen = 4 * h * h * this.view.y;
    const s = AIR.frame.sunDir;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const disc = b.card.disc;
      const st = b.state;
      const p = disc.position;
      const R = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      // Whether it is up: SWG's fade by the hour (the sky's own `place`, its opacity) where the dial keeps it; else the light
      // alone decides how it shows (a body above the land, faded by the storms alone), and a card the sky had put away for
      // SWG's fade is turned to face the eye here, as `place` turns what it shows.
      const keepFade = BODY_TUNE.swgFade >= 0.5;
      const presence = keepFade ? (disc.material as THREE.Material).opacity : 1 - (AIR.frame.overcast > 0 ? (AIR.frame.overcast < 1 ? AIR.frame.overcast : 1) : 0);
      const above = R > 1e-6 && p.y / R > -0.3;
      const up = BODY_TUNE.off < 0.5 && (keepFade ? disc.visible && R > 1e-6 : above && presence > 0.002);
      b.up = up;
      if (up) {
        const dir = st.dir;
        dir.x = p.x / R;
        dir.y = p.y / R;
        dir.z = p.z / R;
        if (!disc.visible) turnSkyBody(dir, disc.quaternion);
        disc.visible = true;
        // The card's frame as `turnSkyBody` turns it: right = (−dir.z, 0, dir.x) levelled, up = back × right, back = −dir.
        const hz = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
        const right = st.right;
        if (hz > 1e-6) {
          right.x = -dir.z / hz;
          right.y = 0;
          right.z = dir.x / hz;
        } else {
          right.x = 1;
          right.y = 0;
          right.z = 0;
        }
        const u = st.up;
        // back × right with back = −dir.
        u.x = -dir.y * right.z + dir.z * right.y;
        u.y = -dir.z * right.x + dir.x * right.z;
        u.z = -dir.x * right.y + dir.y * right.x;
        // Pass 2, wave 4b: a held body hangs still at its own turn, its roll about the line to it included (the quad's +X is
        // right · cos + up · sin, its +Y the rest), so its card's frame turns with it.
        const hd = b.card.held;
        if (hd) {
          disc.quaternion.copy(hd.quaternion);
          if (hd.rollRad !== 0) {
            const cr = Math.cos(hd.rollRad);
            const sr = Math.sin(hd.rollRad);
            const rx = right.x;
            const ry = right.y;
            const rz = right.z;
            right.x = rx * cr + u.x * sr;
            right.y = ry * cr + u.y * sr;
            right.z = rz * cr + u.z * sr;
            u.x = u.x * cr - rx * sr;
            u.y = u.y * cr - ry * sr;
            u.z = u.z * cr - rz * sr;
          }
        }
        const w = disc.scale.x / R;
        const tanD = 0.5 * w * BODY_TUNE.discFill;
        const c = st.card;
        c.x = w;
        c.y = tanD;
        // A body wearing a look is a sphere lit by the star at the look's own reflectance (the fixer of pass 2, wave 4b);
        // SWG's picture keeps the dials' rule (its painted shading, `BODY_TUNE.sphere` 0 at the start).
        c.z = b.look >= 0 ? 1 : BODY_TUNE.sphere;
        st.a5.w = b.look >= 0 ? b.look : BODY_TUNE.sphereAlbedo;
        c.w = presence;
        // The star in the card's frame (x right, y up, z back toward the eye).
        const sun = st.sun;
        sun.x = s.x * right.x + s.y * right.y + s.z * right.z;
        sun.y = s.x * u.x + s.y * u.y + s.z * u.z;
        sun.z = -(s.x * dir.x + s.y * dir.y + s.z * dir.z);
        b.share = (Math.PI * tanD * tanD) / screen;
        // A unit of the card's frame is the body's distance in km: its radius over its disc's angular radius's sine.
        if (b.air) st.a3.w = tanD > 1e-9 ? (st.a0.x * Math.sqrt(1 + tanD * tanD)) / tanD : st.a0.x * 1e6;
      } else disc.visible = false;
      // The limb's and the twilight's brightness are live dials like the rest (the fixer of pass 2, wave 4a: they were
      // written once at the loading screen); the record's own numbers and tables stay as the screen made them.
      if (b.air) {
        st.a4.w = BODY_TUNE.limb;
        st.a5.x = BODY_TUNE.twilight;
      }
      // Its form: the console's, else the tier's (Medium's by its share; Painted while SWG's flat picture is drawn, whose
      // painted shading the march would not follow: `bodyFormOf`), Painted until its tables are made.
      let form: 'scattered' | 'painted' | 'none' = 'none';
      if (b.air) {
        const want = BODY_TUNE.form;
        form = bodyFormOf(this.tierAt, b.share, want === 'tier' ? null : want, true, b.look < 0 && BODY_TUNE.sphere < 0.5);
        if (form === 'scattered' && !b.ready) form = 'painted';
      }
      b.form = form;
      const twin = b.twin;
      if (twin) {
        twin.visible = up && form === 'scattered';
        if (twin.visible) {
          twin.position.copy(p);
          twin.quaternion.copy(disc.quaternion);
          twin.scale.copy(disc.scale);
          // its draw order its card's as the sky's frame left it (under an applied system the nearer drawn later: `nearOrder`)
          twin.renderOrder = disc.renderOrder;
        }
        // The Painted card stands down while the Scattered one draws (the sky shows it again at its next place).
        if (form === 'scattered') disc.visible = false;
      }
      // SWG's halo is the Painted form's own layer: hidden where the body's air is drawn by the march, or by none.
      const glow = b.card.glow;
      if (glow && b.air && form !== 'painted') glow.visible = false;
      // Pass 2, wave 5 (maker L): a body its look draws whole (`lookBody.ts`) keeps its record and stands down here.
      st.shown = up;
      if (st.lookDrawn) {
        disc.visible = false;
        if (twin) twin.visible = false;
        if (glow) glow.visible = false;
      }
    }
  }

  report(): SkyBodiesReport {
    const r = tierRule(this.tierAt);
    return {
      tier: this.tierAt,
      steps: r.steps,
      bodies: this.bodies.map((b) => ({
        picture: b.card.file,
        slot: b.card.slot,
        shows: b.card.air.kind === 'world' ? b.card.air.world : b.card.air.kind,
        air: b.air,
        form: b.form,
        tables: b.ready ? b.how : b.air ? `not baked (${b.how}): Painted until the next loading screen` : 'none (no air)',
        shareOfScreen: Number(b.share.toPrecision(3)),
        radiusDeg: Number(((Math.atan(b.state.card.y) * 180) / Math.PI).toPrecision(3)),
        opacity: Number(b.state.card.w.toPrecision(3)),
        up: b.up,
        dir: [b.state.dir.x, b.state.dir.y, b.state.dir.z].map((v) => Number(v.toFixed(4))),
        sunInCard: [b.state.sun.x, b.state.sun.y, b.state.sun.z].map((v) => Number(v.toFixed(3))),
        km: b.air ? { bottom: b.state.a0.x, top: b.state.a0.y } : null,
        lit: b.look >= 0 ? `as a sphere, wearing a look (reflectance ${b.look})` : BODY_TUNE.sphere >= 0.5 ? 'as a sphere (the dial)' : "SWG's painted picture",
        ...(b.card.held ? { held: { name: b.card.held.name, picture: b.card.held.picture, light: b.card.held.light, rollDeg: Number(((b.card.held.rollRad * 180) / Math.PI).toFixed(2)) } } : {}),
      })),
      bake: { ...bakeCache().stats },
    };
  }

  /** Everything this sky made let go (its twins out of the sky's group, their materials and tables). */
  dispose(forget: (materials: Iterable<THREE.Material>) => void): void {
    const mats: THREE.Material[] = [];
    for (const b of this.bodies) {
      if (b.twin) {
        b.twin.removeFromParent();
        mats.push(b.twin.material as THREE.Material);
      }
      for (const t of b.tables) t.dispose();
      delete b.card.disc.userData.swgBodyCard;
    }
    forget(mats);
    for (const m of mats) m.dispose();
    this.bodies.length = 0;
  }
}

/**
 * The body's record into its card's packed numbers (airProfile's uniforms, its `F` the game's: `airHazeTint.test.ts` and
 * `lookGameAgree.test.mjs` hold the two layouts as one). Its distance in km, a unit of the card's frame, is the frame's
 * (`a3.w`: its radius over the sine of its disc's angular radius, which only the card's size tells).
 */
function writeRecord(st: BodyCardState, rec: Float64Array): void {
  st.a0.set(rec[F.bottom], rec[F.top], rec[F.rayH], rec[F.mieH]);
  st.a1.set(rec[F.rayR], rec[F.rayG], rec[F.rayB], rec[F.mieS]);
  st.a2.set(rec[F.ozR], rec[F.ozG], rec[F.ozB], rec[F.mieA]);
  st.a3.set(rec[F.ozC], rec[F.ozW], rec[F.mieG], rec[F.bottom] * 40);
  st.a4.set(rec[F.mieTintR], rec[F.mieTintG], rec[F.mieTintB], BODY_TUNE.limb);
  // The twilight alone (the fixer of pass 2, wave 4b): `a5`'s other three are the card's own (its cover, its light, its
  // reflectance), and setting them here halved every body with air's light and took half its cover from its picture's alpha.
  st.a5.x = BODY_TUNE.twilight;
}

/** The bodies' graphs let go (a session's end; the tests'). */
export function resetSkyBodyGraphs(): void {
  GRAPHS = { painted: null, scattered: null };
}
