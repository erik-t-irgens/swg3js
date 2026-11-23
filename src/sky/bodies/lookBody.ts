// Every look's layers in the game (the GPU port's pass 2, wave 5, maker L; the design's 2.5, 2.6 and 2.10, the brief's part L).
// A body that wears one of his looks, in a ground sky or as a planet in space, is drawn by the space body viewer's own drawing
// of that look (`src/sky/look/build.js`'s `buildLook`, the one file the viewer and the game import), so it shows what the
// viewer shows: its surface and its clouds moving as the viewer's do, rings lit and casting and taking the planet's shadow,
// glows, halos and painted rims, city lights on its night side, storms and their lightning, gas round it, a giant's banded
// depth, belts of rocks near, cards farther and dust far, each in the planet's shadow. WebGPU only: the runtime makes it
// (`GpuRuntime.lookBodies`), nothing here is loaded on the WebGL path.
//
// **Drawn into a picture of its own, laid on a card where the body stands.** Each body's look stands in a scene of its own at
// its true angle across, seen by a camera at that scene's origin turned as the body's card is turned in the world (toward it,
// upright to the horizon: `turnSkyBody`), with a frustum exactly the card's, and drawn into its own half-float picture (its
// light per unit of its star's, premultiplied by how much of what is behind it covers). The card (`skyCardMaterial`,
// `spaceCardMaterial`) lays that picture where the body is:
//   - **in a ground sky** through the world's air as the moons' cards are (`skyBody.ts`): its light times the star's at the top
//     of the air over pi and what gets through the air along each pixel's ray (`transmittanceToSpace`), held as a whole to
//     `BODY_TUNE.seenMost` of the screen's white, over the sky's own light put back where it covers (`skyRadiance`), so by day
//     it is pale against the blue, at dusk reddened, at night bright and readable, and the stars behind its night side hidden;
//   - **in space** lit by the zone's star at the main light's strength over pi, as the planet's own Lambert sphere was.
// The world's haze pass never sees it (it writes no depth: the depth stays the sky's), and nothing measured from the world's
// middle reaches the card (directions alone, as every sky card's).
//
// **Which air**: a body that shows a ground world takes that world's own record (`bodyRecord`, the one its ground sky and its
// rims from a moon and from orbit are drawn with, the file's saved air in it: `setAirRecordFor`), every other its look's own;
// its form by the tier at the screen (`lookAirChoiceFor`: Low Painted, else the look's own form, the march's steps the
// tier's), a tier moved in play taking effect at the next loading screen.
//
// **Where**: a card of SWG's sky stays SWG's (or maker S's, under an applied system: `SKY_MOTION`); its place, size and
// whether it is up are read off the bodies' frame (`BodyCardState`), its card standing down for this one. An extra body of an
// applied system with no card of SWG's (Yavin Prime's other moons, a lore body) is hung here at the motion's direction and
// size. A space planet stands where the zone hangs it, its Lambert sphere and its air's shells standing down.
// **Lit**: from where its star really is (the motion's `light` under an applied system), else the world's casting sun.
//
// **Built behind the loading screen**: the look baked on the game's card (its kit asked first: `GeneratedSet.warm`), its
// programs compiled against its own picture (`compileAsync` with that target set), drawn once, and its card hung in the
// group the world warms. **A frame allocates nothing**: kept records and fields; a still body is drawn again only when its
// light or size moves (`LOOK_BODY_TUNE`).
import * as THREE from 'three';
import { MeshBasicNodeMaterial, RenderTarget } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { WEATHER_TIME, buildLook, disposeLook, domeOutline, lookFrameRecord, releaseTextures, setAirChoice, setAirRecordFor, setBakeRenderer, setPictureSource, updateLookWith, type BuiltLook, type LookFrameRecord } from '../look/build.js';
import { PRIVATE_SKY, gamePictureSource, privateSkyReport } from '../look/privateSky.ts';
import { makeLook } from '../look/looks.js';
import { SKY_BODIES } from '../look/bodiesFile.ts';
import { GeneratedSet, PRESETS, presetLook } from '../look/generate.js';
import { STORM_TAPE } from '../look/weather.js';
import { kitWithin } from '../look/lookBake.ts';
import { setVolumeQuality } from '../look/volume.js';
import { AIR } from '../air/airApi.ts';
import { eyeExposureNode } from '../exposure/eyeBuffer.ts';
import { markMotion } from '../../core/gpu/motion.ts';
import { BODY_TUNE } from './bodyTier.ts';
import { nearOrder } from '../system/skyMotion.ts';
import type { SkyBodyCard } from './bodyCard.ts';
import type { BodyCardState } from './skyBody.ts';
import type { BodyLook } from '../look/bodiesFile.ts';
import { LOOK_BODY_TUNE, everyFor, lookAirChoiceFor, lookBodyPictureSize, lookSizeFor, screenShareOf, tuneLookBodies } from './lookBodyMath.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, clamp, dot, float, max, min, normalize, texture, uniform, uv, vec2, vec3, vec4 } = TSL as Any;

/**
 * Where a card's own coordinate reads its body's picture (the fixer of pass 2, wave 5). A picture drawn on WebGPU stands its
 * first row at the top of what its camera saw, and WebGPU reads a texture's v from its first row, while the card's coordinate
 * runs up from its bottom edge (three turns v over for a target's picture on WebGL alone, `TextureNode.setupUV`); so the
 * picture is read at v turned over, or every body hung upside down (lit from below with the star above it). The card's own
 * ray through the air keeps the coordinate as it is.
 */
const pictureAt = (at: Any): Any => vec2(at.x, float(1).sub(at.y));

const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** One body to draw in its look: what the world hands `LookBodies.make`. */
export interface LookBodyPlan {
  /** Its place (the viewer's id), for the console. */
  readonly place: string;
  /** The look's id in the file (or the preset's for an extra body with none) and the look. */
  readonly id: string;
  readonly look: BodyLook;
  /** The ground world's own record where the body shows one (its look's air is then that world's), else null. */
  readonly record: Float64Array | null;
  readonly where: 'sky' | 'space';
  /** A ground sky's card of SWG's it stands for (its frame read off the bodies' record), or none. */
  readonly card?: SkyBodyCard | null;
  /** An applied system's item it stands for (`SKY_MOTION.now.items[item]`), or -1. */
  readonly item?: number;
  /** A space planet's own sphere (where it stands, its radius), standing down while this draws. */
  readonly mesh?: THREE.Mesh | null;
  readonly radius?: number;
  /** The group its card is hung in (the sky's group, or the zone's bodies' group) and the card's render order. */
  readonly group: THREE.Object3D;
  readonly order: number;
  /** Its disc's half angle across (radians) and the camera's vertical field (degrees) at the screen, for its picture's size. */
  readonly halfRad: number;
  readonly fovDeg: number;
}

/** The prover's switch (`__debug.lookBodies({ show })`): the bodies drawn in their looks, or neither their cards nor their pictures (a cost's A/B). */
export const LOOK_BODY_SHOW = { on: true };

/** What the world writes into the frame's fields before `frame` (a number handed across a call is a number made). */
export const LOOK_BODY_IN = {
  /** Seconds of play this frame, and the screen's height in pixels. */
  dt: 0.016,
  screenH: 1080.5,
  /** Space: the star's direction (world axes, unit) and the main light's colour times its intensity, scene units. */
  sunX: 0.5,
  sunY: 0.5,
  sunZ: 0.5,
  lightR: 1.5,
  lightG: 1.5,
  lightB: 1.5,
};

/** The applied motion's fields this drawing reads (maker S's `SkyMotion`), handed in by the world (null: SWG's sky). */
export interface LookMotion {
  readonly dir: Float64Array;
  readonly light: Float64Array;
  readonly spinTurn: Float64Array;
  readonly items: readonly { readonly drawn: boolean; readonly sizeDeg: number; readonly spinDeg: number }[];
  readonly T: number;
  /** Each item's distance from the world seen from (AU), for the cards' order (`nearOrder`); absent, the plan's own order. */
  readonly dist?: Float64Array;
}

/** One body drawn in its look. */
class LookBody {
  readonly plan: LookBodyPlan;
  readonly built: BuiltLook;
  readonly scene = new THREE.Scene();
  readonly cam = new THREE.PerspectiveCamera(10, 1, 0.1, 100);
  readonly target: Any;
  readonly size: number;
  /** Its card and the card's graph (`attach`, once its vectors exist for the graph to read). */
  card!: THREE.Mesh;
  mat!: THREE.Material;
  /** The card's numbers: its half width's tangent, its presence (the storms' fade), its light (1), the hold's most. */
  readonly cardV = new THREE.Vector4(0.1, 1, 1, 1);
  readonly dirV = new THREE.Vector3(0, 0, -1);
  readonly rightV = new THREE.Vector3(1, 0, 0);
  readonly upV = new THREE.Vector3(0, 1, 0);
  /** Space: the star's light at the planet, scene units over pi. */
  readonly lightV = new THREE.Vector3(1, 1, 1);
  readonly fr: LookFrameRecord;
  readonly lightW = new THREE.Vector3(0, 1, 0);
  readonly turn = new THREE.Quaternion();
  /** The light in the card's frame and the card's size when last drawn (a still body is drawn again only when they move). */
  private readonly lastL = new THREE.Vector3(9, 9, 9);
  lastTan = -1;
  lastDrawn = -1e9;
  /** Whether the look moves of itself (clouds' motion or spin, storms, gas, a turn of its own): drawn on the cadence then. */
  readonly moving: boolean;
  /** Its reach in its own radii (rings, halo, air, gas), from the build. */
  readonly reach: number;
  up = false;
  drawn = 0;
  /** The pictures' sizer for its rocks (the picture's own pixels, not the screen's). */
  readonly sizer: { getDrawingBufferSize(v: { x: number; y: number }): unknown };
  /** The camera's frustum as last set (its tangent, near and far), so it is set again only when it moves. */
  private camTan = -1;
  private camNear = -1;
  private camFar = -1;
  constructor(plan: LookBodyPlan, built: BuiltLook, size: number, target: Any) {
    this.plan = plan;
    this.built = built;
    this.size = size;
    this.target = target;
    this.fr = lookFrameRecord();
    this.fr.camera = this.cam;
    this.fr.face = this.turn;
    this.fr.lightWorld = this.lightW;
    this.fr.sunWorld = this.lightW;
    this.fr.tilt = 0;
    this.fr.spin = 0;
    this.fr.sphereRadius = 0;
    const self = this;
    this.sizer = {
      getDrawingBufferSize(v: { x: number; y: number }) {
        v.x = self.size;
        v.y = self.size;
        return v;
      },
    };
    this.fr.sizer = this.sizer;
    this.scene.add(built.root);
    this.scene.matrixWorldAutoUpdate = true;
    this.cam.matrixAutoUpdate = false;
    this.cam.matrixWorldAutoUpdate = false;
    const L = (built.look?.layers ?? {}) as Record<string, Record<string, unknown>>;
    const clouds = L.clouds ?? {};
    const motionOn = !!(clouds.motion as Record<string, unknown> | undefined)?.on;
    const stormOn = !!(clouds.storm as Record<string, unknown> | undefined)?.on;
    // (a pictured rings layer turns by its own spin; a generated look's rings and belt stand in its axis and do not)
    this.moving = !!built.vol || (!!built.hasClouds && (motionOn || stormOn)) || !!built.storms || (L.rings?.on === true && (Number(L.rings?.spin) || 0) !== 0) || (plan.item !== undefined && plan.item >= 0);
    this.reach = Math.max(1, Number(built.radius) || 1);
  }

  /** Its card made with its graph (made over this body's own vectors, so the frame writes them in place). */
  attach(mat: THREE.Material): void {
    this.mat = mat;
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.card.name = `sky body (look ${this.plan.id})`;
    this.card.frustumCulled = false;
    this.card.renderOrder = this.plan.order;
    this.card.visible = false;
    this.card.userData.unlit = true;
    // its matrix is written by `pose` (a quaternion set on it would turn its Euler again each frame)
    this.card.matrixAutoUpdate = false;
  }

  /** The light in the card's frame moved, or its size, since it was last drawn. */
  changed(): boolean {
    const L = this.lightW;
    const cx = L.x * this.rightV.x + L.y * this.rightV.y + L.z * this.rightV.z;
    const cy = L.x * this.upV.x + L.y * this.upV.y + L.z * this.upV.z;
    const cz = -(L.x * this.dirV.x + L.y * this.dirV.y + L.z * this.dirV.z);
    const d = this.lastL;
    const moved = (cx - d.x) * (cx - d.x) + (cy - d.y) * (cy - d.y) + (cz - d.z) * (cz - d.z) > LOOK_BODY_TUNE.stillMoves * LOOK_BODY_TUNE.stillMoves;
    const tan = this.cardV.x;
    const grew = this.lastTan < 0 || Math.abs(tan - this.lastTan) > this.lastTan * 0.01;
    return moved || grew;
  }

  /** What `changed` compares against next, taken as it is drawn. */
  took(frame: number): void {
    const L = this.lightW;
    this.lastL.x = L.x * this.rightV.x + L.y * this.rightV.y + L.z * this.rightV.z;
    this.lastL.y = L.x * this.upV.x + L.y * this.upV.y + L.z * this.upV.z;
    this.lastL.z = -(L.x * this.dirV.x + L.y * this.dirV.y + L.z * this.dirV.z);
    this.lastTan = this.cardV.x;
    this.lastDrawn = frame;
  }

  /** Its disc's half angle across (radians) and its card's distance from the eye in its group: written by the frame. */
  half = 0.05;
  cardR = 1.5;
  /** A dome's scale as last worked (`domeOutline`, worked again only when its half angle moves). */
  private domeHalf = -1;
  private domeScale = 1;

  /**
   * Everything that follows from its direction (`dirV`), half angle (`half`) and card distance (`cardR`), every number into a
   * field (a number handed across a call is a number made; the frame calls this for every body shown): its card's frame (right
   * levelled, up = back × right, as `turnSkyBody` turns a card; kept as the bodies' frame wrote it where `ownFrame`), its turn
   * (three's `setFromRotationMatrix` written out), its reach's tangent (`lookExtentTan` written out), the look stood in its
   * scene (a sphere one over the half angle's sine away, its radius 1, the look's own unit; a dome scaled to fill the angle
   * with its outline), its camera turned as the card is with the card's frustum (its matrices written as columns), and the
   * card itself placed (its matrix written likewise, `matrixAutoUpdate` off).
   */
  pose(ownFrame: boolean): void {
    const d = this.dirV;
    const r = this.rightV;
    const u = this.upV;
    if (!ownFrame) {
      const hz = Math.sqrt(d.x * d.x + d.z * d.z);
      if (hz > 1e-6) {
        r.x = -d.z / hz;
        r.y = 0;
        r.z = d.x / hz;
      } else {
        r.x = 1;
        r.y = 0;
        r.z = 0;
      }
      u.x = -d.y * r.z + d.z * r.y;
      u.y = -d.z * r.x + d.x * r.z;
      u.z = -d.x * r.y + d.y * r.x;
    }
    // the turn: columns right, up and back (-dir), as three's `setFromRotationMatrix` reads them
    const m11 = r.x;
    const m12 = u.x;
    const m13 = -d.x;
    const m21 = r.y;
    const m22 = u.y;
    const m23 = -d.y;
    const m31 = r.z;
    const m32 = u.z;
    const m33 = -d.z;
    const q = this.turn as Any;
    const trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      q._w = 0.25 / s;
      q._x = (m32 - m23) * s;
      q._y = (m13 - m31) * s;
      q._z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      q._w = (m32 - m23) / s;
      q._x = 0.25 * s;
      q._y = (m12 + m21) / s;
      q._z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      q._w = (m13 - m31) / s;
      q._x = (m12 + m21) / s;
      q._y = 0.25 * s;
      q._z = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      q._w = (m21 - m12) / s;
      q._x = (m13 + m31) / s;
      q._y = (m23 + m32) / s;
      q._z = 0.25 * s;
    }
    // its reach's tangent (`lookExtentTan`): its bounding sphere's angle from where its body fills `half`, under 80 degrees
    const h = this.half > 0 ? this.half : 0;
    const sh = Math.sin(h);
    const sE = sh * (this.reach > 1 ? this.reach * 1.05 : 1.05);
    const a = Math.asin(sE < SIN_80 ? sE : SIN_80);
    const tanE = Math.tan(a);
    this.cardV.x = tanE;
    // the look stood in its scene
    const b = this.built;
    const D = sh > 1e-6 ? 1 / sh : 1e6;
    const root = b.root;
    root.position.x = d.x * D;
    root.position.y = d.y * D;
    root.position.z = d.z * D;
    let sc = 1;
    if (b.look?.kind === 'dome' && b.profile) {
      if (Math.abs(h - this.domeHalf) > 1e-5) {
        this.domeHalf = h;
        this.domeScale = domeOutline(b.profile, h < HALF_PI_LESS ? h : HALF_PI_LESS, D).scale;
      }
      sc = this.domeScale;
      this.fr.sphereRadius = 1;
    } else this.fr.sphereRadius = 0;
    if (root.scale.x !== sc) {
      root.scale.x = sc;
      root.scale.y = sc;
      root.scale.z = sc;
    }
    b.placeScale = sc;
    // its camera at its scene's origin turned as the card is
    const c = this.cam;
    const e = c.matrixWorld.elements;
    e[0] = m11;
    e[1] = m21;
    e[2] = m31;
    e[3] = 0;
    e[4] = m12;
    e[5] = m22;
    e[6] = m32;
    e[7] = 0;
    e[8] = m13;
    e[9] = m23;
    e[10] = m33;
    e[11] = 0;
    e[12] = 0;
    e[13] = 0;
    e[14] = 0;
    e[15] = 1;
    const v = c.matrixWorldInverse.elements;
    v[0] = m11;
    v[1] = m12;
    v[2] = m13;
    v[3] = 0;
    v[4] = m21;
    v[5] = m22;
    v[6] = m23;
    v[7] = 0;
    v[8] = m31;
    v[9] = m32;
    v[10] = m33;
    v[11] = 0;
    v[12] = 0;
    v[13] = 0;
    v[14] = 0;
    v[15] = 1;
    // its frustum, set again only when the reach outgrows it or shrinks well inside it, or its depth leaves the near and far
    // planes (three's projection hands numbers across its calls: a number made a frame were it set every frame); the card spans
    // the frustum's own tangent, so the picture lands on it at the body's true size whatever the frustum's margin
    const reach = this.reach * sc * 1.05;
    if (tanE > this.camTan || tanE < this.camTan * 0.97 || D - reach < this.camNear || D + reach > this.camFar) {
      const nearAt = (D - reach) * 0.9;
      this.camTan = tanE * 1.01;
      this.camNear = nearAt > D * 0.02 ? nearAt : D * 0.02;
      this.camFar = (D + reach) * 1.1;
      c.fov = (2 * Math.atan(this.camTan) * 180) / Math.PI;
      c.near = this.camNear;
      c.far = this.camFar;
      c.updateProjectionMatrix();
    }
    const tanC = this.camTan;
    this.cardV.x = tanC;
    // its card: right and up times its width, back, at its distance along its way
    const R = this.cardR;
    const w = 2 * tanC * R;
    const k = this.card.matrix.elements;
    k[0] = m11 * w;
    k[1] = m21 * w;
    k[2] = m31 * w;
    k[3] = 0;
    k[4] = m12 * w;
    k[5] = m22 * w;
    k[6] = m32 * w;
    k[7] = 0;
    k[8] = m13;
    k[9] = m23;
    k[10] = m33;
    k[11] = 0;
    k[12] = d.x * R;
    k[13] = d.y * R;
    k[14] = d.z * R;
    k[15] = 1;
    this.card.matrixWorldNeedsUpdate = true;
  }
}

const SIN_80 = Math.sin((80 * Math.PI) / 180);
const HALF_PI_LESS = Math.PI / 2 - 0.05;

/** The card's graph in a ground sky: the picture through the world's air, held to `seenMost`, the sky put back where it covers. */
function skyCardMaterial(b: { cardV: THREE.Vector4; dirV: THREE.Vector3; rightV: THREE.Vector3; upV: THREE.Vector3 }, picture: THREE.Texture): THREE.Material {
  const m = premultipliedCard('gpu: sky body (look)');
  const tables = AIR.tables;
  const c = uniform(b.cardV);
  const dirW = uniform(b.dirV);
  const rightW = uniform(b.rightV);
  const upW = uniform(b.upV);
  const eye = eyeExposureNode();
  const PI = Math.PI;
  m.colorNode = Fn(() => {
    const at = uv();
    // the card's ray in the world (directions alone): its tangent plane's coordinates over the card's half width's tangent
    const tx = at.x.sub(0.5).mul(c.x.mul(2));
    const ty = at.y.sub(0.5).mul(c.x.mul(2));
    const dW = normalize(rightW.mul(tx).add(upW.mul(ty)).add(dirW)).toVar('lookDW');
    const Tw = (tables ? vec3(tables.transmittanceToSpace(dW)) : vec3(1)).toVar('lookTw');
    const skyBack = (tables ? vec3(tables.skyRadiance(dW)) : vec3(0)).toVar('lookSkyBack');
    const sunTop = tables ? tables.nodes.sunTop : vec3(1);
    const imp = texture(picture, pictureAt(at)).toVar('lookImp');
    // the light a white surface facing the star would send through the air, times the eye: one factor for the whole body
    const whiteLum = dot(Tw.mul(sunTop), vec3(LUMA[0], LUMA[1], LUMA[2])).mul(1 / PI).mul(eye);
    const hold = min(float(1), c.w.div(max(whiteLum, 1e-30)));
    const own = imp.rgb.mul(Tw).mul(sunTop).mul(1 / PI).mul(hold).mul(c.z);
    const alpha = clamp(imp.a, 0, 1).mul(c.y).toVar('lookAlpha');
    return vec4(own.mul(c.y).add(skyBack.mul(alpha)), alpha);
  })();
  return markMotion(m, 'sky');
}

/** The card's graph in space: the picture lit by the zone's star at the main light's strength over pi (the Lambert sphere's light). */
function spaceCardMaterial(b: { lightV: THREE.Vector3; cardV: THREE.Vector4 }, picture: THREE.Texture): THREE.Material {
  const m = premultipliedCard('gpu: space planet (look)');
  const light = uniform(b.lightV);
  const c = uniform(b.cardV);
  m.colorNode = Fn(() => {
    const imp = texture(picture, pictureAt(uv())).toVar('lookImp');
    const alpha = clamp(imp.a, 0, 1).mul(c.y);
    return vec4(imp.rgb.mul(light).mul(c.y), alpha);
  })();
  return markMotion(m, 'sky');
}

/** A card blended premultiplied over what is behind it (one and one less its alpha), no depth written, no fog. */
function premultipliedCard(name: string): Any {
  const m = new MeshBasicNodeMaterial();
  m.name = name;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  // the alpha is the graph's own (three multiplies a node material's alpha by its opacity)
  m.opacityNode = float(1);
  return m;
}

export type LookBodiesReport = Record<string, unknown>;

/** A look for an extra body that names none: the viewer's preset of its kind's recipe (a giant's bands, a moon's craters). */
export function presetFor(kind: string): BodyLook | null {
  const recipe = kind === 'giant' ? 'gasgiant' : kind === 'planet' ? 'terran' : 'moon';
  for (const [id, p] of Object.entries(PRESETS as Record<string, { recipe?: string; group?: string; shape?: unknown; volume?: unknown }>)) {
    if (p.recipe === recipe && !p.shape && !p.volume) return presetLook(id) as unknown as BodyLook;
  }
  return null;
}

/** A world's bodies in their looks: one set a sky or a zone, made behind its loading screen. */
export class LookBodies {
  private readonly bodies: LookBody[] = [];
  private readonly renderer: Any;
  private frames = 0;
  private motionClock = 0;
  private wallClock = 0;
  /** What the screen took (bakes, compiles), for the console. */
  private readonly made: Record<string, unknown>[] = [];
  private readonly clear = new THREE.Color();
  /** The quality tier the set was made at (0 Low to 3 Ultra): its pictures' sizes and a moving look's cadence (`everyFor`). */
  tier = 3;

  private constructor(renderer: Any) {
    this.renderer = renderer;
  }

  /**
   * A sky's or a zone's bodies in their looks, behind its loading screen: each look built on the game's card (its kit asked
   * first so its bake builds nothing in its draws), its programs compiled against its own picture, drawn once, and its card
   * made (hung by the caller in the group it names, before that group is warmed). `tier` the quality tier (0 Low to 3 Ultra).
   */
  static async make(renderer: Any, plans: readonly LookBodyPlan[], tier: number): Promise<LookBodies> {
    const s = new LookBodies(renderer);
    s.tier = tier;
    CURRENT.add(s);
    installLookBodiesDebug(renderer);
    if (!plans.length) return s;
    setBakeRenderer(renderer);
    // the game's storms recorded ahead behind the screen and played back in its frames (`weather.js`' `STORM_TAPE`)
    STORM_TAPE.on = true;
    // every picture and mesh a look names: a shipped photo of his, and in development alone his imported folder's (`privateSky.ts`)
    setPictureSource(gamePictureSource((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'));
    const choice = lookAirChoiceFor(tier);
    setAirChoice(choice);
    // a look's gas marched at the viewer's baked tiers alone, as the zone's volumes are (its live High, 13 to 47 ms in the
    // viewer, is never the game's): Medium from the Medium tier up, Low below
    setVolumeQuality(tier <= 1 ? 'low' : 'medium');
    for (const plan of plans) {
      const t0 = performance.now();
      // the look as built: its bake at the use's size (a sky body's smaller), its air the ground world's where it shows one
      // made whole first (every slot and setting present, as the viewer makes every look it draws: `looks.js`' `makeLook`)
      const look = sizedLook(makeLook(plan.look as unknown as Record<string, unknown>) as unknown as BodyLook, lookSizeFor(plan.where, plan.look));
      setAirRecordFor(look, plan.record);
      const gen = look.generated as Any;
      let warmMs = 0;
      if (gen && look.kind === 'sphere') {
        const set = new GeneratedSet(Number(gen.size) || 1024);
        try {
          warmMs = await set.warm(renderer, gen, { withClouds: !!(look.layers?.clouds as Any)?.on });
        } finally {
          set.dispose();
        }
      }
      let built: BuiltLook;
      try {
        built = await buildLook(look, { place: plan.where === 'sky' });
      } catch (err) {
        console.warn(`sky: the look ${plan.id} at ${plan.place} could not be built (${(err as Error).message}); SWG's picture there`);
        continue;
      }
      const size = lookBodyPictureSize(screenShareOf(plan.halfRad, Math.max(1, Number(built.radius) || 1), plan.fovDeg), LOOK_BODY_IN.screenH, plan.where, tier);
      const target = new RenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, samples: LOOK_BODY_TUNE.samples, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      target.texture.name = `look body ${plan.id}`;
      const b = new LookBody(plan, built, size, target);
      b.cardV.w = BODY_TUNE.seenMost;
      b.attach(plan.where === 'sky' ? skyCardMaterial(b, target.texture) : spaceCardMaterial(b, target.texture));
      plan.group.add(b.card);
      s.bodies.push(b);
      // stood once where it will first be seen, then its programs compiled against its own picture and drawn behind the screen
      s.placeFirst(b);
      const tc = performance.now();
      await s.compile(b);
      s.draw1(b);
      s.made.push({ place: plan.place, look: plan.id, where: plan.where, picture: size, kitMs: Math.round(warmMs), buildMs: Math.round(tc - t0), compileMs: Math.round(performance.now() - tc), air: built.airMode, reach: Number(b.reach.toFixed(3)) });
    }
    return s;
  }

  /**
   * (The fixer of pass 2, wave 5) The plans whose looks can be drawn on this screen: a generated look's bake kit waited on
   * through the screen's own memo (`kitWithin`) for what is left of `LOOK_BODY_TUNE.kitWaitMs`, in all; a body whose kit has not
   * landed by then is left out (its SWG card stays up, or an extra body waits), to wear its look from the next screen, its kit
   * landing meanwhile behind this one. Answers the plans kept, in order, and `putOff` the places left out. Behind a screen alone.
   */
  static async ready(renderer: Any, plans: readonly LookBodyPlan[], putOff: string[]): Promise<LookBodyPlan[]> {
    const kept: LookBodyPlan[] = [];
    const t0 = performance.now();
    for (const plan of plans) {
      const look = sizedLook(makeLook(plan.look as unknown as Record<string, unknown>) as unknown as BodyLook, lookSizeFor(plan.where, plan.look));
      const gen = look.generated as Any;
      if (!gen || look.kind !== 'sphere') {
        kept.push(plan);
        continue;
      }
      const left = LOOK_BODY_TUNE.kitWaitMs - (performance.now() - t0);
      if (await kitWithin(renderer, look, Number(gen.size) || 1024, left)) kept.push(plan);
      else putOff.push(plan.place);
    }
    return kept;
  }

  /** A body stood where its plan first puts it (a sky card straight up until the bodies' frame places it). */
  private placeFirst(b: LookBody): void {
    const p = b.plan;
    if (p.where === 'space' && p.mesh) this.placeSpace(b);
    else {
      b.dirV.x = 0;
      b.dirV.y = 1;
      b.dirV.z = 0;
      b.half = p.halfRad > 0 ? p.halfRad : 0.05;
      b.cardR = LOOK_BODY_TUNE.extraReach;
      b.pose(false);
    }
    this.lightFor(b, null);
    updateLookWith(b.built, b.fr);
  }

  /** The look's programs compiled against its own picture (its format, its samples, its depth), behind the screen. */
  private async compile(b: LookBody): Promise<void> {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(b.target);
    let p: Promise<unknown>;
    try {
      p = r.compileAsync(b.scene, b.cam) as Promise<unknown>;
    } finally {
      r.setRenderTarget(prev);
    }
    await p;
  }

  /**
   * Once a game frame, after the sky has placed its cards and the bodies' frame has read them (`SkyBodies.frame`), or after the
   * zone's planets are placed: each body's place, size, light and look's turn, and whether it is shown. `motion` the applied
   * system's (maker S's `SKY_MOTION.now`), null for SWG's sky. Allocates nothing.
   */
  frame(motion: LookMotion | null): void {
    this.frames++;
    const I = LOOK_BODY_IN;
    this.motionClock += I.dt;
    this.wallClock += I.dt;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const p = b.plan;
      if (p.where === 'space') {
        this.placeSpace(b);
      } else if (p.card) {
        const st = p.card.disc.userData.swgBodyCard as BodyCardState | undefined;
        b.up = !!st && st.shown;
        if (b.up && st) {
          // its place, frame and size as the bodies' frame left them (`SkyBodies.frame`), its card at the SWG card's distance
          const sd = st.dir;
          const dv = b.dirV;
          dv.x = sd.x;
          dv.y = sd.y;
          dv.z = sd.z;
          b.rightV.copy(st.right);
          b.upV.copy(st.up);
          b.half = Math.atan(st.card.y);
          b.cardV.y = st.card.w;
          const dp = p.card.disc.position;
          const R = Math.sqrt(dp.x * dp.x + dp.y * dp.y + dp.z * dp.z);
          b.cardR = R > 1e-6 ? R : LOOK_BODY_TUNE.extraReach;
          b.pose(true);
        }
      } else if (motion && p.item !== undefined && p.item >= 0) {
        this.placeExtra(b, motion, p.item);
      } else b.up = false;
      b.card.visible = b.up && LOOK_BODY_SHOW.on;
      if (!b.up) continue;
      // its draw order: its SWG card's as the sky's frame left it, an extra's by its distance (the nearer drawn later, `nearOrder`)
      b.card.renderOrder = p.card ? p.card.disc.renderOrder : motion && motion.dist && p.item !== undefined && p.item >= 0 ? p.order + nearOrder(motion.dist[p.item]) : p.order;
      b.cardV.w = BODY_TUNE.seenMost;
      this.lightFor(b, motion);
      this.spinFor(b, motion);
    }
  }

  /**
   * Before the scene's passes (the world's `airFrame`): each shown body's look stepped and drawn into its picture, a moving
   * look on the cadence (`LOOK_BODY_TUNE.everyFrames`), a still one when its light or size moved. Allocates nothing of ours.
   */
  draw(): void {
    WEATHER_TIME.motion = this.motionClock;
    WEATHER_TIME.wall = this.wallClock;
    const every = everyFor(this.tier);
    if (!LOOK_BODY_SHOW.on) return;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (!b.up) continue;
      const due = b.moving ? this.frames - b.lastDrawn >= every : false;
      if (!due && !b.changed()) continue;
      updateLookWith(b.built, b.fr);
      this.draw1(b);
      b.took(this.frames);
    }
  }

  /** One body's look drawn into its picture. */
  private draw1(b: LookBody): void {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const alpha = r.getClearAlpha();
    r.getClearColor(this.clear);
    r.setRenderTarget(b.target);
    r.setClearColor(0x000000, 0);
    try {
      r.clear(true, true, false);
      r.render(b.scene, b.cam);
    } finally {
      r.setClearColor(this.clear, alpha);
      r.setRenderTarget(prev);
    }
    b.drawn++;
  }

  /** An extra body of the applied system (no card of SWG's): at the motion's direction, its size the item's. */
  private placeExtra(b: LookBody, motion: LookMotion, j: number): void {
    const it = motion.items[j];
    const k = 3 * j;
    const dy = motion.dir[k + 1];
    const overcast = AIR.frame.overcast;
    const presence = 1 - (overcast > 0 ? (overcast < 1 ? overcast : 1) : 0);
    b.up = BODY_TUNE.off < 0.5 && !!it && it.drawn && dy > -0.3 && presence > 0.002;
    if (!b.up) return;
    const dv = b.dirV;
    dv.x = motion.dir[k];
    dv.y = dy;
    dv.z = motion.dir[k + 2];
    b.half = ((it.sizeDeg * Math.PI) / 180) * 0.5;
    b.cardV.y = presence;
    b.cardR = LOOK_BODY_TUNE.extraReach;
    b.pose(false);
  }

  /** A space planet: where its own sphere stands in the zone's group (which rides the camera), its size its sphere's. */
  private placeSpace(b: LookBody): void {
    const mesh = b.plan.mesh!;
    const mp = mesh.position;
    const d = Math.sqrt(mp.x * mp.x + mp.y * mp.y + mp.z * mp.z);
    b.up = d > 1e-6;
    if (!b.up) return;
    const dv = b.dirV;
    dv.x = mp.x / d;
    dv.y = mp.y / d;
    dv.z = mp.z / d;
    const rad = (b.plan.radius ?? 1) * mesh.scale.x;
    const sin = rad / d;
    b.half = Math.asin(sin < 0.999 ? sin : 0.999);
    b.cardV.y = 1;
    b.cardR = d;
    b.pose(false);
    // its own sphere stands down while its look draws it
    mesh.visible = false;
    const I = LOOK_BODY_IN;
    b.lightV.x = I.lightR / Math.PI;
    b.lightV.y = I.lightG / Math.PI;
    b.lightV.z = I.lightB / Math.PI;
  }

  /** The light on a body: from where its star really is under an applied system, else the world's casting sun (space: the zone's). */
  private lightFor(b: LookBody, motion: LookMotion | null): void {
    const L = b.lightW;
    const j = b.plan.item ?? -1;
    if (b.plan.where === 'space') {
      const I = LOOK_BODY_IN;
      L.x = I.sunX;
      L.y = I.sunY;
      L.z = I.sunZ;
    } else if (motion && j >= 0) {
      const k = 3 * j;
      L.x = motion.light[k];
      L.y = motion.light[k + 1];
      L.z = motion.light[k + 2];
    } else {
      const s = AIR.frame.sunDir;
      L.x = s.x;
      L.y = s.y;
      L.z = s.z;
    }
  }

  /** Its own turn: the motion's (a share of its own day, its spin in degrees a real day) under a system, else none. */
  private spinFor(b: LookBody, motion: LookMotion | null): void {
    const j = b.plan.item ?? -1;
    const fr = b.fr;
    if (motion && j >= 0 && motion.items[j] && motion.items[j].spinDeg !== 0) {
      // `updateLookWith` turns by spin × clock / 360: a spin of 360 with the clock the share of its day
      fr.spin = 360;
      fr.clock = motion.spinTurn[j];
    } else {
      fr.spin = 0;
      fr.clock = this.motionClock;
    }
  }

  get count(): number {
    return this.bodies.length;
  }

  /** The places this set draws. */
  places(): string[] {
    return this.bodies.map((b) => b.plan.place);
  }

  report(): LookBodiesReport {
    return {
      bodies: this.bodies.map((b) => ({
        place: b.plan.place,
        look: b.plan.id,
        where: b.plan.where,
        shown: b.up,
        picture: b.size,
        drawn: b.drawn,
        moving: b.moving,
        air: b.built.airMode,
        reach: Number(b.reach.toFixed(3)),
        halfWidthDeg: Number(((Math.atan(b.cardV.x) * 180) / Math.PI).toFixed(3)),
        discDeg: Number(((2 * b.half * 180) / Math.PI).toFixed(3)),
        dir: [b.dirV.x, b.dirV.y, b.dirV.z].map((v) => Number(v.toFixed(4))),
        lightInCard: [b.lightW.dot(b.rightV), b.lightW.dot(b.upV), -b.lightW.dot(b.dirV)].map((v) => Number(v.toFixed(3))),
      })),
      made: this.made,
      tune: { ...LOOK_BODY_TUNE },
    };
  }

  /** The cards drawn this frame by look (the world's stand-downs: a sky card's own, a planet's sphere and shells). */
  drawsCard(card: SkyBodyCard): boolean {
    for (let i = 0; i < this.bodies.length; i++) if (this.bodies[i].plan.card === card) return true;
    return false;
  }

  /** A body's picture read back (the console's and the proofs': RGBA half floats as numbers), or null. */
  async picture(i: number): Promise<{ width: number; height: number; data: Float32Array } | null> {
    const b = this.bodies[i];
    if (!b) return null;
    const raw = (await this.renderer.readRenderTargetPixelsAsync(b.target, 0, 0, b.size, b.size)) as Uint16Array;
    const out = new Float32Array(raw.length);
    for (let k = 0; k < raw.length; k++) out[k] = THREE.DataUtils.fromHalfFloat(raw[k]);
    return { width: b.size, height: b.size, data: out };
  }

  /** Everything let go: the cards out of their groups, the looks, the pictures, the cards' materials. */
  dispose(forget: (materials: Iterable<THREE.Material>) => void): void {
    const mats: THREE.Material[] = [];
    for (const b of this.bodies) {
      b.card.removeFromParent();
      b.card.geometry.dispose();
      mats.push(b.mat);
      const inner: THREE.Material[] = [];
      b.built.root.traverse((o: Any) => {
        if (o.material) inner.push(o.material);
      });
      setAirRecordFor(b.built.look, null);
      disposeLook(b.built);
      b.target.dispose();
      if (b.plan.mesh) b.plan.mesh.visible = true;
    }
    forget(mats);
    for (const m of mats) m.dispose();
    const had = this.bodies.length;
    this.bodies.length = 0;
    CURRENT.delete(this);
    // the pictures the looks loaded (his, in development) let go with them, but those another standing set wears
    if (had) {
      const keep = new Set<string>();
      for (const s of CURRENT) for (const b of s.bodies) for (const n of (b.built.keep as Set<string> | undefined) ?? []) keep.add(n);
      releaseTextures(keep, 0);
    }
  }
}

/** A copy of a look baked at a size (its own at most): the same layers, its generated numbers at that size. */
function sizedLook(look: BodyLook, size: number): BodyLook {
  const g = look.generated as Record<string, unknown> | null;
  if (!g) return { ...look };
  return { ...look, generated: { ...g, size } };
}

/** The sets standing (a sky's and a zone's), for the console. */
const CURRENT = new Set<LookBodies>();

// ---------------------------------------------------------------- the console

/**
 * Linear half-float pixels as an sRGB PNG's address, `gain` times, over black where it is clear. WebGPU reads a target back
 * from its first row, the top of what its camera saw (the fixer of pass 2, wave 5: these were written turned over before),
 * so the rows go out as they come.
 */
function pngOf(data: Float32Array, w: number, h: number, gain: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const enc = (v: number): number => {
    const x = v <= 0 ? 0 : v >= 1 ? 1 : v;
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = i;
      img.data[o] = enc(data[i] * gain);
      img.data[o + 1] = enc(data[i + 1] * gain);
      img.data[o + 2] = enc(data[i + 2] * gain);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * A look drawn as the viewer's Look tab draws it (the comparison's other half): its own stage camera (35 degrees, the body
 * framed with the stage's margin), the stage's sun (azimuth -60, elevation 15 by default), its sun power 1, built for the stage
 * (not a place), into a picture of `size`, read back. The look by its id in the file (or his imported one, or a preset's id).
 */
async function stagePicture(renderer: Any, look: BodyLook, o: { size?: number; az?: number; el?: number; clock?: number; camEl?: number; without?: string[] }): Promise<{ png: string; ms: number }> {
  const t0 = performance.now();
  setBakeRenderer(renderer);
  setPictureSource(gamePictureSource((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'));
  const size = o.size ?? 512;
  // made whole and baked at a sky body's size, its kit warmed first (a pass whose pipeline is not built is stepped over in play)
  const whole = sizedLook(makeLook(look as unknown as Record<string, unknown>) as unknown as BodyLook, lookSizeFor('sky', look));
  // (a part left out for the picture: `without: ['belt', 'rings', 'volume', 'shape']`, the prover's)
  for (const part of o.without ?? []) if (whole.generated) delete (whole.generated as Record<string, unknown>)[part];
  const gen = whole.generated as Any;
  if (gen && whole.kind === 'sphere') {
    const set = new GeneratedSet(Number(gen.size) || 1024);
    try {
      await set.warm(renderer, gen, { withClouds: !!(whole.layers?.clouds as Any)?.on });
    } finally {
      set.dispose();
    }
  }
  const built = await buildLook(whole, { place: false });
  const scene = new THREE.Scene();
  scene.add(built.root);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 3000);
  const r = Math.max(1, Number(built.radius) || 1);
  const dist = (r * 1.18) / Math.sin((35 * Math.PI) / 360);
  // the stage's camera on +z, raised by `camEl` degrees to see a ring's face (0 as the Look tab first frames it)
  const ce = ((o.camEl ?? 0) * Math.PI) / 180;
  cam.position.set(0, dist * Math.sin(ce), dist * Math.cos(ce));
  cam.lookAt(0, 0, 0);
  cam.near = Math.max(0.005, dist / 400);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  const a = ((o.az ?? -60) * Math.PI) / 180;
  const e = ((o.el ?? 15) * Math.PI) / 180;
  const sun = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const fr = lookFrameRecord();
  fr.camera = cam;
  fr.clock = o.clock ?? 0;
  fr.sunWorld = sun;
  fr.tilt = Number.NaN;
  fr.spin = Number.NaN;
  fr.sphereRadius = 0;
  updateLookWith(built, fr);
  const target = new RenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, samples: 4 });
  const prev = renderer.getRenderTarget();
  const clear = new THREE.Color();
  renderer.getClearColor(clear);
  const alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  const compiled = renderer.compileAsync(scene, cam) as Promise<unknown>;
  renderer.setRenderTarget(prev);
  await compiled;
  try {
    // (set again after the wait: the game's frames set their own targets meanwhile)
    renderer.setRenderTarget(target);
    // the stage's own dark backdrop (0x020306, linear)
    renderer.setClearColor(new THREE.Color(0x020306), 1);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
  } finally {
    renderer.setClearColor(clear, alpha);
    renderer.setRenderTarget(prev);
  }
  const raw = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size)) as Uint16Array;
  const data = new Float32Array(raw.length);
  for (let k = 0; k < raw.length; k++) data[k] = THREE.DataUtils.fromHalfFloat(raw[k]);
  target.dispose();
  disposeLook(built);
  return { png: pngOf(data, size, size, 1), ms: Math.round(performance.now() - t0) };
}

/**
 * `__debug.lookBodies()` says every standing set's bodies (place, look, shown, picture, draws, air, reach) and his imported looks'
 * seam; `({ tune: { everyFrames, stillMoves, ... } })` moves the dials; `({ picture: [set, body], gain })` answers a body's own
 * picture as a PNG's address (its light per unit of its star's, times `gain`); `({ stage: { look, size, az, el } })` draws a look
 * of the file as the viewer's Look tab does and answers its PNG's address (the comparison's other half).
 */
let RENDERER: Any = null;
const lookBodiesHook = async (o?: { show?: boolean; tune?: Record<string, number>; picture?: [number, number]; gain?: number; stage?: { look: string; size?: number; az?: number; el?: number; clock?: number; camEl?: number; without?: string[] } }): Promise<Record<string, unknown>> => {
  const out: Record<string, unknown> = {};
  if (o?.tune) out.tune = { ...tuneLookBodies(o.tune as Partial<typeof LOOK_BODY_TUNE>) };
  if (o && typeof o.show === 'boolean') out.show = LOOK_BODY_SHOW.on = o.show;
  if (o?.picture) {
    const set = [...CURRENT][o.picture[0]];
    const p = set ? await set.picture(o.picture[1]) : null;
    out.picture = p ? { width: p.width, png: pngOf(p.data, p.width, p.height, o.gain ?? 1) } : 'no such body';
  }
  if (o?.stage && RENDERER) {
    const id = o.stage.look;
    const priv = PRIVATE_SKY.looks[id.replace(/^own:/, '')];
    const look = (SKY_BODIES.file?.looks[id] as BodyLook | undefined) ?? priv ?? (id.startsWith('preset:') ? (presetLook(id.slice(7)) as unknown as BodyLook) : null);
    out.stage = look ? await stagePicture(RENDERER, look, o.stage) : `no look ${id} in the file, his imported looks or the presets`;
  }
  return { ...out, ...lookBodiesReport(), private: privateSkyReport() };
};

/** Put the hook on `__debug` (at every set's making: the game builds its `__debug` in one go at startup). */
function installLookBodiesDebug(renderer: Any): void {
  RENDERER = renderer;
  if (typeof window === 'undefined') return;
  const holder = window as unknown as { __debug?: Record<string, unknown> };
  const debug = (holder.__debug ??= {});
  if (debug.lookBodies !== lookBodiesHook) debug.lookBodies = lookBodiesHook;
}

/** The places drawn whole by a standing set (a zone's volumes leave a planet's own gas to its look: `spaceVolumes.ts`). */
export function lookDrawnPlaces(): Set<string> {
  const out = new Set<string>();
  for (const s of CURRENT) for (const p of s.places()) out.add(p);
  return out;
}
/** What `__debug.lookBodies()` says: every set's bodies. */
export function lookBodiesReport(): Record<string, unknown> {
  return { sets: [...CURRENT].map((s) => s.report()), tune: { ...LOOK_BODY_TUNE } };
}
/** The standing sets (the console's picture reads). */
export function lookBodySets(): LookBodies[] {
  return [...CURRENT];
}
