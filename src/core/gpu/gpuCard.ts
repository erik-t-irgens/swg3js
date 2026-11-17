// The leaf cards on WebGPU (the GPU port's step 4, item 4). On WebGL a card's look is text put into three's chunks by
// the card rule's wrap (`cardRule.ts`) and the card light's (`cardLight.ts`, `leafShadow.ts`); three's WebGPU renderer
// runs no `onBeforeCompile`, so here each piece is the node copy of the card's classic material changed where three
// builds it:
//
//   - **the alpha** (`setupDiffuseColor`): the card rule's cut handed to three's own alpha test as the node it compares
//     with, a blended card's alpha raised by its picture's mip level first (`cardAlpha.ts`), the cut by the class;
//   - **the stored normal** (`setupPosition`): `backs: 'stored'` lights every card by the client's one normal again, put in
//     `normalLocal` before three's instancing turns it, as the rule's line goes in before three's normal chunks;
//   - **the light** (`setupLightingModel`): three's lighting model, physical or the client's highlight's (`gpuSpec.ts`),
//     given four changes on the instance: every directional light put out while the card light is on (the sun and the
//     fill are inside the client's sum), the point and spot lights lit against a normal blended toward the leaf's own face
//     (`pointFlat`), the sun's direction and shadow kept as its light is met, and after three's own indirect light the
//     client's sum added to the direct diffuse and the indirect diffuse made three's ambient alone (no hemisphere);
//   - **the sun's shadow** (a context round the lighting): the factor three's `CSMShadowNode` gives the sun, through its
//     own lookups and fade, taken for the client's `rise` (the leaf's share of it, `uSwgLeafShare`), and the leaf skip --
//     the shadow lookup made from the leaf's place moved toward the sun by how far its ray stays inside its own crown
//     (`crownExit`), which in an orthographic cascade is exactly the WebGL bias lowered by the metres over that cascade's
//     own range -- with the acne floor's raised bias read by every cascade's bias node (`LEAF_FLOOR`, `sun.ts`).
//
// The carry through the tone curve: on WebGPU three draws the scene to its own target and tone-maps and encodes it in its
// output pass to the canvas, after every material, as the WebGL renderer does at the end of each program: so a card's
// scene colour (the client's displayed value carried back through three's ACES fit, held under the bloom cap) is written by
// the material, and three's own ACES at the game's exposure turns it back into the client's bytes on the canvas.
//
// One rule in one place: every knob is read off the very uniform objects the WebGL injection reads (`CARD_LIGHT_UNIFORMS`,
// `CARD_UNIFORMS`), once a render (so the rooms pass's `setCardRoomPass` reaches it, as each WebGL pass uploads it anew);
// each card's own class, emissive and crown off the very records the WebGL injection hands its program (`cardUniformsOf`,
// `cardLightUniformsOf`) and its defines (whether it takes the light, the skip), once an object; every number of the
// arithmetic is the mirror's (`cardLightMath.ts`, `leafShadow.ts`). Whether a copy takes the part at all is decided by what
// is in the classic material's cache key (the card rule's wrap in its hook chain, its cut, its picture); a card's defines
// are not in the key, so they are uniforms here. The console's look switch (`__debug.gpu({ look: { card: false } })`) is a
// uniform back to three's plain copy, building nothing; `localStorage['swg.gpu.card'] = '0'` leaves the part out at load.

import * as THREE from 'three';
import { PhysicalLightingModel } from 'three/webgpu';
import {
  BRDF_GGX,
  BRDF_Lambert,
  F_Schlick,
  Fn,
  bool,
  If,
  attribute,
  cameraViewMatrix,
  clamp,
  context,
  diffuseColor,
  diffuseContribution,
  dFdx,
  dFdy,
  dot,
  float,
  length,
  log2,
  mat3,
  materialAlphaTest,
  max,
  min,
  mix,
  modelWorldMatrix,
  normalFlat,
  normalGeometry,
  normalLocal,
  normalView,
  normalize,
  positionGeometry,
  positionViewDirection,
  positionWorld,
  pow,
  property,
  referenceAttribute,
  renderGroup,
  roughness,
  select,
  specularColor,
  specularColorBlended,
  specularF90,
  sqrt,
  step,
  transformNormal,
  transformNormalToView,
  transpose,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { CARD_HOOK, CARD_RULE_ON, CARD_UNIFORMS, cardUniformsOf } from '../../world/cardRule.ts';
import { CARD_LIGHT_UNIFORMS, cardLightUniformsOf } from '../../world/cardLight.ts';
import { ACES_FIT, ACES_IN_INV, ACES_OUT_INV, CARD_FLOORS, LUMINANCE, SRGB_CURVE } from '../../world/cardLightMath.ts';
import { CROWN_DIR_FLOOR } from '../../world/leafShadow.ts';
import { chainHas } from '../../world/compileHooks.ts';
import { ClientLightingModel, clientSpecularNode, filmNode } from './gpuSpec.ts';
import { GPU_LOOKS, LOOKS_AT_LOAD, type LookPart } from './looks.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The mirror's own numbers the graph is built from, kept in one record so the node test can hold the graph to them. */
export const CARD_GRAPH_NUMBERS = { aces: ACES_FIT, inIn: ACES_IN_INV, outIn: ACES_OUT_INV, srgb: SRGB_CURVE, luminance: LUMINANCE, floors: CARD_FLOORS, crown: CROWN_DIR_FLOOR } as const;

// ---------------------------------------------------------------- the knobs, read off the WebGL injection's own objects

/** A render-group uniform reading one uniform object's value, once a render (a shared group: one write a render). */
const read = <T>(u: { value: T }): Any => uniform(u.value as Any).setGroup(renderGroup).onRenderUpdate(() => u.value);

type Knobs = ReturnType<typeof makeKnobs>;
function makeKnobs() {
  const L = CARD_LIGHT_UNIFORMS;
  const R = CARD_UNIFORMS;
  return {
    /** The card light at all, this pass (the rooms pass puts it out) and with the console's look switch on. */
    on: uniform(0).setGroup(renderGroup).onRenderUpdate(() => (L.uSwgCardOn.value > 0.5 && GPU_LOOKS.card ? 1 : 0)),
    /** The console's look switch alone: the card rule's own pieces (the cut, the stored normal, the skip) follow it. */
    look: uniform(1).setGroup(renderGroup).onRenderUpdate(() => (GPU_LOOKS.card ? 1 : 0)),
    curve: read(L.uSwgCardCurve),
    front: read(L.uSwgCardFront),
    tangent: read(L.uSwgCardTangent),
    back: read(L.uSwgCardBack),
    ambient: read(L.uSwgCardAmbient),
    fill: read(L.uSwgCardFill),
    bounce: read(L.uSwgCardBounce),
    row7: read(L.uSwgCardRow7),
    row7Alpha: read(L.uSwgCardRow7Alpha),
    fillDir: read(L.uSwgCardFillDir),
    bounceDir: read(L.uSwgCardBounceDir),
    fills: read(L.uSwgCardFills),
    emissiveOn: read(L.uSwgCardEmissiveOn),
    gain: read(L.uSwgCardGain),
    exposureRef: read(L.uSwgCardExposureRef),
    bloomCap: read(L.uSwgCardBloomCap),
    shadowLook: read(L.uSwgCardShadowLook),
    sunSide: read(L.uSwgCardSunSide),
    pointFlat: read(L.uSwgCardPointFlat),
    leafSun: read(L.uSwgLeafSun),
    leafSelf: read(L.uSwgLeafSelf),
    leafShare: read(L.uSwgLeafShare),
    leafAcne: read(L.uSwgLeafAcne),
    cutPunch: read(R.uSwgCardCutPunch),
    cutBlend: read(R.uSwgCardCutBlend),
    mipScale: read(R.uSwgCardMipScale),
    mipScalePunch: read(R.uSwgCardMipScalePunch),
    backsStored: read(R.uSwgCardBacksStored),
  };
}
let knobs: Knobs | null = null;
/** The shared knobs, made the first time a card asks (this module is only ever loaded on WebGPU). */
export function cardKnobs(): Knobs {
  return (knobs ??= makeKnobs());
}

/** Each picture's size and its matrix, kept per texture so an object's update hands back an object it already has. */
const mapSizes = new WeakMap<THREE.Texture, THREE.Vector2>();
function mapSizeOf(t: THREE.Texture | null | undefined): THREE.Vector2 {
  if (!t) return ONE_TEXEL;
  let s = mapSizes.get(t);
  const img = t.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 1;
  const h = img?.height ?? 1;
  if (!s) {
    s = new THREE.Vector2(w, h);
    mapSizes.set(t, s);
  } else if (s.x !== w || s.y !== h) s.set(w, h);
  return s;
}
const ONE_TEXEL = new THREE.Vector2(1, 1);
const IDENTITY3 = new THREE.Matrix3();

type PerObject = ReturnType<typeof makePerObject>;
function makePerObject() {
  return {
    /** The card light's define on this material (absent on a building's own cells and with `swg.cardLight` '0'). */
    light: uniform(0).onObjectUpdate((f: Any) => (f.material?.defines?.SWG_CARD_LIGHT !== undefined ? 1 : 0)),
    /** The leaf skip's define (absent without a crown and with `swg.leafShadow` 'all'). */
    leaf: uniform(0).onObjectUpdate((f: Any) => (f.material?.defines?.SWG_LEAF_SHADOW !== undefined ? 1 : 0)),
    /** The class: the blended one (1) or a cut-out (0), the WebGL injection's own record. */
    blend: uniform(0).onObjectUpdate((f: Any) => cardUniformsOf(f.material).swgCardBlend.value),
    emissive: uniform(new THREE.Vector3()).onObjectUpdate((f: Any) => cardLightUniformsOf(f.material).swgCardEmissive.value),
    boxMin: uniform(new THREE.Vector3()).onObjectUpdate((f: Any) => cardLightUniformsOf(f.material).swgLeafBoxMin.value),
    boxMax: uniform(new THREE.Vector3()).onObjectUpdate((f: Any) => cardLightUniformsOf(f.material).swgLeafBoxMax.value),
    /** The picture's size at its top level and its uv matrix (the WebGL `vMapUv`'s), for the mip level. */
    mapSize: uniform(new THREE.Vector2(1, 1)).onObjectUpdate((f: Any) => mapSizeOf(f.material?.map)),
    mapMatrix: uniform(new THREE.Matrix3()).onObjectUpdate((f: Any) => {
      const t = f.material?.map as THREE.Texture | null | undefined;
      if (!t) return IDENTITY3;
      if (t.matrixAutoUpdate === true) t.updateMatrix();
      return t.matrix;
    }),
  };
}
let perObject: PerObject | null = null;
export function cardPerObject(): PerObject {
  return (perObject ??= makePerObject());
}

/**
 * The acne floor's share of each cascade's own bias (`2 × acne × self` on a card with the skip, nought anywhere else):
 * a shader-local variable every cascade's bias node multiplies its bias by one plus (`sun.ts`), assigned only by a card's
 * lighting, so every other material's lookup reads nought (a function-scope `var` is zero in WGSL) and is unchanged to
 * the bit. The leaf's skip itself needs no such thing: it moves the place the lookup is made from.
 */
export const LEAF_FLOOR: Any = property('float', 'swgLeafFloor');

/** The bias node every sun cascade is given (`sun.ts`): its own bias, raised by the acne floor where a card asks for it. */
export function leafBiasNode(reference: Any): Any {
  return reference.mul(LEAF_FLOOR.add(1));
}

// ---------------------------------------------------------------- the arithmetic, as nodes (the mirror's numbers)

/** Linear to sRGB-encoded, three's own curve (`cardLightMath.linearToSrgb`). */
export function toSrgbNode(c: Any, k = SRGB_CURVE): Any {
  const hi = pow(max(c, vec3(0)), vec3(k.toSrgbPower)).mul(k.toSrgbScale).sub(vec3(k.toSrgbOffset));
  const lo = c.mul(k.toSrgbLine);
  return mix(hi, lo, step(vec3(k.toSrgbBelow), c).oneMinus());
}

/** sRGB-encoded to linear, three's own curve (`cardLightMath.srgbToLinear`). */
export function toLinearNode(c: Any, k = SRGB_CURVE): Any {
  const hi = pow(max(c, vec3(0)).mul(k.toLinearScale).add(vec3(k.toLinearOffset)), vec3(k.toLinearPower));
  const lo = c.mul(k.toLinearLine);
  return mix(hi, lo, step(vec3(k.toLinearBelow), c).oneMinus());
}

/**
 * A 3x3 matrix by rows as a node. TSL's `mat3` of nine numbers is a constant made by three's `Matrix3.set`, which takes its
 * numbers row by row (and keeps them by columns for the shader): so the rows go in as they are, unlike the GLSL text's
 * `mat3( column, column, column )` (`glslMat3`). Handed the GLSL's order it is the transpose, and every hue turns.
 */
const mat3Rows = (m: readonly (readonly number[])[]): Any => mat3(m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]);

/** Three's ACES fit carried back (`cardLightMath.acesInverse`): a display-linear colour to the scene value that shows it. */
export function acesInverseNode(display: Any, k = ACES_FIT): Any {
  const v = clamp(mat3Rows(ACES_OUT_INV).mul(clamp(display, 0, 1)), 0, 1);
  const A = vec3(1).sub(v.mul(k.c));
  const B = vec3(k.a).sub(v.mul(k.d));
  const C = v.mul(k.e).add(k.b).negate();
  const F = B.negate().add(sqrt(max(B.mul(B).sub(A.mul(C).mul(4)), vec3(0)))).div(A.mul(2));
  return max(mat3Rows(ACES_IN_INV).mul(F).mul(k.scale), vec3(0));
}

/** The client's light on a card pixel (`cardLightMath.clientLight`) before the curve: `g`, each channel held to 0..1. */
export function clientLightNode(n: Any, sunDir: Any, sunShadow: Any, emissive: Any, k: Knobs = cardKnobs()): Any {
  const d = clamp(dot(n, sunDir), -1, 1);
  const rise = select(k.shadowLook.greaterThan(0.5), float(1), clamp(sunShadow, 0, 1));
  const main = select(d.greaterThanEqual(0), mix(k.tangent, k.front, d.mul(rise)), mix(k.tangent, k.back, d.negate()));
  const fillV = normalize(cameraViewMatrix.mul(vec4(k.fillDir, 0)).xyz);
  const bounceV = normalize(cameraViewMatrix.mul(vec4(k.bounceDir, 0)).xyz);
  let sum = k.ambient.add(k.emissiveOn.mul(emissive)).add(main);
  sum = sum.add(select(k.fills.greaterThan(0.5), k.fill.mul(max(dot(n, fillV), 0)), vec3(0)));
  sum = sum.add(select(k.fills.greaterThan(1.5), k.bounce.mul(max(dot(n, bounceV), 0)), vec3(0)));
  return clamp(sum.mul(k.gain), 0, 1);
}

/** The `'client'` curve: the displayed value carried back through three's ACES fit, over the exposure it assumes, under the cap. */
export function clientCurveNode(texel: Any, g: Any, sunShadow: Any, k: Knobs = cardKnobs(), f = CARD_FLOORS): Any {
  const display0 = clamp(toSrgbNode(texel).mul(g), 0, 1);
  const display = select(k.shadowLook.greaterThan(0.5), mix(display0, k.row7, k.row7Alpha.mul(float(1).sub(clamp(sunShadow, 0, 1)))), display0);
  const colour = acesInverseNode(toLinearNode(display)).div(max(k.exposureRef, f.exposure));
  const lum = dot(colour, vec3(LUMINANCE[0], LUMINANCE[1], LUMINANCE[2]));
  return select(lum.greaterThan(k.bloomCap), colour.mul(k.bloomCap.div(lum)), colour);
}

// ---------------------------------------------------------------- the part

/** Counts for the console: copies given the part, and what each build met. */
export const CARD_GPU_STATS = { copies: 0, models: 0, sums: 0, noSun: 0, skips: 0, noInstanceBasis: 0, alpha: 0, alphaNoMap: 0 };

/** Whether three references this instanced mesh's matrices as vertex data (its `canReferenceInstanceData`), which the skip reads too. */
function instanceBasis(builder: Any): Any | null {
  const object = builder.object;
  if (!(object?.isInstancedMesh === true && object.instanceMatrix?.isInstancedBufferAttribute === true)) return null;
  if (builder.renderer?.isRenderer !== true) return null;
  const buffers = 1 + (object.instanceColor ? 1 : 0) + (typeof builder.needsPreviousData === 'function' && builder.needsPreviousData() ? 1 : 0);
  if (Object.keys(object.geometry?.attributes ?? {}).length + buffers > 8) return undefined as Any;
  // The very columns three's own instancing reads (one GPU buffer: three keeps a column view per attribute).
  return referenceAttribute('instanceMatrix', 'mat4');
}

/** What one build of a card's copy shares between its stages: made in the vertex stage's setup, read by the fragment's. */
interface CardBuild {
  storedView: Any;
  leafPos: Any;
  leafSun: Any;
  leafScale: Any;
  /** Whether this object's frame is known (an instanced mesh three draws from its own buffer is not): the skip and the stored side need it. */
  basis: boolean;
}
const builds = new WeakMap<object, CardBuild>();

/** The client's stored normal in the object's own frame (`CARD_STORED`): the drawn normal reflected back through its plane. */
function storedLocalNode(builder: Any, f = CARD_FLOORS): Any {
  if (!builder.geometry?.hasAttribute?.('cardPlane')) return normalGeometry;
  const p = attribute('cardPlane', 'vec4').xyz;
  const pl = length(p);
  const pn = select(pl.greaterThan(f.plane), p.div(pl), vec3(0));
  return normalGeometry.sub(pn.mul(dot(normalGeometry, pn).mul(2)));
}

/** The vertex stage: the stored normal for `backs: 'stored'`, and the varyings the sum and the skip read. */
function cardVertex(builder: Any): void {
  const k = cardKnobs();
  const stored = storedLocalNode(builder);
  if (builder.geometry?.hasAttribute?.('normal')) {
    normalLocal.assign(select(k.look.greaterThan(0.5).and(k.backsStored.greaterThan(0.5)), stored, normalLocal));
  }
  const inst = instanceBasis(builder);
  const basisKnown = inst !== undefined;
  if (!basisKnown) CARD_GPU_STATS.noInstanceBasis++;
  const instM = inst ?? null;
  const storedInst = instM ? transformNormal(stored, instM) : stored;
  const M = instM ? modelWorldMatrix.mul(instM) : modelWorldMatrix;
  const basis: Any = mat3(M);
  builds.set(builder, {
    storedView: transformNormalToView(storedInst).toVarying('vSwgStoredNormal'),
    leafPos: positionGeometry.toVarying('vSwgLeafPos'),
    leafSun: normalize((transpose(basis) as Any).mul(k.leafSun)).toVarying('vSwgLeafSun'),
    leafScale: length(basis.element(0)).toVarying('vSwgLeafScale'),
    basis: basisKnown,
  });
}

/** The fragment's card build (made in the vertex stage), or one made now with no frame for a build that never ran it. */
function buildOf(builder: Any): CardBuild {
  const b = builds.get(builder);
  if (b) return b;
  return { storedView: normalView, leafPos: vec3(0), leafSun: vec3(0, 1, 0), leafScale: float(1), basis: false };
}

/** How far the leaf's ray toward the sun stays inside its own crown, in metres (`crownExit`), as the WebGL skip works it. */
export function crownSkipNode(leafPos: Any, leafSun: Any, leafScale: Any, boxMin: Any, boxMax: Any, floor = CROWN_DIR_FLOOR): Any {
  const s = leafSun;
  const d = vec3(
    select(s.x.greaterThanEqual(0), max(s.x, floor), min(s.x, -floor)),
    select(s.y.greaterThanEqual(0), max(s.y, floor), min(s.y, -floor)),
    select(s.z.greaterThanEqual(0), max(s.z, floor), min(s.z, -floor)),
  );
  const t1 = boxMin.sub(leafPos).div(d);
  const t2 = boxMax.sub(leafPos).div(d);
  const far: Any = max(t1, t2);
  const exit = min(min(far.x, far.y), far.z);
  return max(exit, 0).mul(leafScale);
}

/**
 * The cut (`CARD_ALPHA`), as the node three's own alpha test compares the alpha with: a blended card's alpha raised by its
 * picture's level first (an assignment the node makes before it answers), then the class's cut; with the look off, three's
 * own `alphaTest` and no raise. It has to be three's own test's node and not a cut after it: three makes an opaque
 * material's alpha one straight after its test, so a cut made later never cuts anything (every leaf a solid square).
 * Three discards at `alpha <= cut` where the WebGL text discards at `alpha < cut`: they differ only on an alpha of exactly
 * the cut, which an 8-bit picture's texel (k / 255) never is.
 */
function cardAlphaTest(builder: Any, f = CARD_FLOORS): Any {
  const k = cardKnobs();
  const o = cardPerObject();
  const blend = o.blend.greaterThan(0.5);
  const scale = select(blend, k.mipScale, k.mipScalePunch);
  const map = builder.material?.map as THREE.Texture | undefined;
  const look = k.look.greaterThan(0.5);
  const cut = select(blend, k.cutBlend, k.cutPunch);
  if (map?.isTexture === true) CARD_GPU_STATS.alpha++;
  else CARD_GPU_STATS.alphaNoMap++;
  return Fn(() => {
    if (map?.isTexture === true) {
      // Taken before any branch, in the whole quad's flow: what the WebGL text works out under a uniform branch.
      const uvT = o.mapMatrix.mul(vec3(uv(map.channel ?? 0), 1)).xy;
      const texel = uvT.mul(o.mapSize);
      const dx = dFdx(texel);
      const dy = dFdy(texel);
      const lod = float(0.5).mul(log2(max(max(dot(dx, dx), dot(dy, dy)), f.lod))).toVar('swgCardLod');
      If(look.and(scale.greaterThan(0)), () => {
        diffuseColor.a.assign(min(float(1), diffuseColor.a.mul(float(1).add(scale.mul(max(float(0), lod))))));
      });
    }
    return select(look, cut, materialAlphaTest);
  })();
}
/** Every ambient light's colour the lighting meets (WebGL's `ambientLightColor`), from the lights three set up for this build. */
function ambientOf(builder: Any): Any {
  let sum: Any = vec3(0);
  for (const ln of builder.lightsNode?.getLightNodes?.(builder) ?? []) if (ln?.light?.isAmbientLight === true) sum = sum.add(ln.colorNode);
  return sum;
}

/** The hemisphere's irradiance toward the sun (`getHemisphereLightIrradiance`), for the `'scene'` curve; nought with no hemisphere. */
function hemisphereToward(builder: Any, sunWorld: Any): Any {
  for (const ln of builder.lightsNode?.getLightNodes?.(builder) ?? []) {
    if (ln?.light?.isHemisphereLight === true) return mix(ln.groundColorNode, ln.colorNode, dot(sunWorld, ln.lightDirectionNode).mul(0.5).add(0.5));
  }
  return vec3(0);
}

/** Whether a light is the sun on WebGPU (`sun.ts` marks the one light with the cascades). */
export function isGpuSun(light: Any): boolean {
  return light?.userData?.swgSun === true;
}

/**
 * Change one build's lighting model in place for a card: its directional lights out while the card light is on, its
 * point and spot lights against the blended normal, the sun's direction and colour kept, and the client's sum after
 * three's own indirect light. Answers the context the lighting is built in (the sun's shadow and the skip).
 */
function cardLighting(model: Any, builder: Any): Any {
  const k = cardKnobs();
  const o = cardPerObject();
  const b = buildOf(builder);
  const ownDirect = model.direct;
  const ownStart = model.start;
  const cardOn = k.on.greaterThan(0.5).and(o.light.greaterThan(0.5));
  // An object whose frame is not known (an instanced mesh three draws from a buffer of its own) takes no skip at all.
  const leafOn = b.basis ? k.look.greaterThan(0.5).and(o.leaf.greaterThan(0.5)) : bool(false);
  const sunDir = property('vec3', 'swgSunDir');
  const sunColour = property('vec3', 'swgSunColour');
  const sunShadow = property('float', 'swgSunShadow');
  let sawSun = false;
  model.start = function (this: Any, bld: Any) {
    sunShadow.assign(float(1));
    sunDir.assign(vec3(0, 0, 1));
    sunColour.assign(vec3(0));
    // The acne floor for every cascade's lookup this shader makes (read by the bias nodes `sun.ts` gave them).
    LEAF_FLOOR.assign(select(leafOn, k.leafAcne.mul(k.leafSelf).mul(2), float(0)));
    return ownStart.call(this, bld);
  };
  model.direct = function (this: Any, input: Any, bld: Any) {
    const light = input.lightNode?.light;
    if (light?.isDirectionalLight === true) {
      if (isGpuSun(light)) {
        sawSun = true;
        sunDir.assign(input.lightDirection);
        sunColour.assign(vec3(input.lightNode.baseColorNode ?? input.lightColor));
      }
      return ownDirect.call(this, { ...input, lightColor: select(cardOn, vec3(0), input.lightColor) }, bld);
    }
    if (light?.isPointLight === true || light?.isSpotLight === true) return pointDirect(this, input, select(cardOn.and(k.pointFlat.greaterThan(0)), blendedNormal(k), normalView));
    return ownDirect.call(this, input, bld);
  };
  model.indirect = function (this: Any, bld: Any) {
    this.indirectDiffuse(bld);
    this.indirectSpecular(bld);
    if (sawSun) {
      CARD_GPU_STATS.sums++;
      const { reflectedLight } = bld.context;
      const n0 = b.storedView;
      const nl = length(n0);
      const nStored = select(nl.greaterThan(CARD_FLOORS.stored), n0.div(nl), normalView);
      const n = select(k.sunSide.greaterThan(0.5), nStored, normalView);
      const g = clientLightNode(n, sunDir, sunShadow, o.emissive, k);
      const client = clientCurveNode(diffuseColor.rgb, g, sunShadow, k);
      const full = sunColour.add(hemisphereToward(bld, k.leafSun));
      const scene = (BRDF_Lambert as Any)({ diffuseColor: diffuseColor.rgb }).mul(full).mul(toLinearNode(g)).div(max(toLinearNode(k.front), vec3(CARD_FLOORS.front)));
      const colour = select(k.curve.lessThan(0.5), client, scene);
      const ambient = ambientOf(bld);
      If(cardOn, () => {
        reflectedLight.directDiffuse.addAssign(colour);
        reflectedLight.indirectDiffuse.assign((BRDF_Lambert as Any)({ diffuseColor: diffuseContribution }).mul(ambient));
      });
    } else CARD_GPU_STATS.noSun++;
    this.ambientOcclusion(bld);
  };
  // The sun's shadow, the cascades' own factor (with the leaf's share of it), and the skip's lookup place.
  const getShadow = (lightNode: Any) => {
    if (!isGpuSun(lightNode?.light) || !lightNode.shadowNode) return lightNode.shadowColorNode;
    const s = vec4(lightNode.shadowNode).x;
    sunShadow.assign(mix(float(1), s, select(leafOn, k.leafShare, float(1))));
    return vec3(lightNode.baseColorNode).mul(sunShadow);
  };
  const skip = crownSkipNode(b.leafPos, b.leafSun, b.leafScale, o.boxMin, o.boxMax);
  if (b.basis) CARD_GPU_STATS.skips++;
  const shadowPositionWorld = positionWorld.add(k.leafSun.mul(select(leafOn, skip.mul(k.leafSelf), float(0))));
  return { getShadow, shadowPositionWorld };
}

/** The blended normal our own lights see on a card (`POINT_FLAT`): the normal toward the leaf's face by `pointFlat`. */
function blendedNormal(k: Knobs, f = CARD_FLOORS): Any {
  const face = normalFlat;
  const m = mix(normalView, face, clamp(k.pointFlat, 0, 1));
  const ml = length(m);
  return select(ml.greaterThan(f.pointFlat), m.div(ml), face);
}

/**
 * A point or spot light on a card against the normal `n`: three's physical direct light with that normal in place of
 * `normalView` (a standard material's: no sheen, clearcoat, iridescence or anisotropy), and where the model is the client's
 * highlight's its specular is the client's term against `n`, mixed by the film as `ClientLightingModel.direct` mixes it.
 */
function pointDirect(model: Any, input: Any, n: Any): void {
  const { lightDirection, lightColor, reflectedLight } = input;
  const dotNL = n.dot(lightDirection).clamp();
  const irradiance = dotNL.mul(lightColor).toVar();
  const halfDir = lightDirection.add(positionViewDirection).normalize();
  const dotVH = positionViewDirection.dot(halfDir).clamp();
  const F: Any = (F_Schlick as Any)({ f0: specularColor, f90: specularF90, dotVH });
  const specularBRDF = (BRDF_GGX as Any)({ lightDirection, f0: specularColorBlended, f90: specularF90, roughness, normalView: n });
  const lambert = irradiance.mul((BRDF_Lambert as Any)({ diffuseColor: diffuseContribution }));
  const ggx = irradiance.mul(specularBRDF).mul(model.multiScatteringCompensation);
  if (model instanceof ClientLightingModel) {
    const client = clientSpecularNode(lightColor, lightDirection, n, positionViewDirection, (model as Any).mask);
    const film = filmNode();
    // The diffuse cut by the Fresnel share only as far as three's GGX stands (`diffuseBackNode`'s reason, gpuSpec.ts).
    reflectedLight.directDiffuse.addAssign(lambert.mul(float(1).sub(F.mul(film))));
    reflectedLight.directSpecular.addAssign(select(film.greaterThan(0), ggx.mul(film), vec3(0)).add(select(film.lessThan(1), client.mul(float(1).sub(film)), vec3(0))));
  } else {
    reflectedLight.directDiffuse.addAssign(lambert.mul(F.oneMinus()));
    reflectedLight.directSpecular.addAssign(ggx);
  }
}

/**
 * The look part (`looks.ts`): a lit standard material the card rule's wrap went on, with the rule and the hatch at load
 * both open. Goes after the highlight's (`gpuSpec.ts`), whose model it changes.
 */
export const cardPart: LookPart = {
  name: 'card',
  applies(m: Any): boolean {
    return LOOKS_AT_LOAD.card && CARD_RULE_ON && m.isMeshStandardMaterial === true && chainHas(m.onBeforeCompile, CARD_HOOK);
  },
  apply(node: Any): void {
    CARD_GPU_STATS.copies++;
    const ownPosition = node.setupPosition;
    node.setupPosition = function (this: Any, builder: Any) {
      cardVertex(builder);
      return ownPosition.call(this, builder);
    };
    const ownDiffuse = node.setupDiffuseColor;
    node.setupDiffuseColor = function (this: Any, builder: Any) {
      // The card rule's cut handed to three's own alpha test as the node it compares with, while its colour is set up (the
      // only place it is read), so it cuts before three makes an opaque material's alpha one.
      const atn = this.alphaTestNode;
      if (this.alphaTest > 0 && atn === null) this.alphaTestNode = cardAlphaTest(builder);
      try {
        ownDiffuse.call(this, builder);
      } finally {
        this.alphaTestNode = atn;
      }
    };
    const ownModel = node.setupLightingModel;
    let pending: { getShadow: Any; shadowPositionWorld: Any } | null = null;
    node.setupLightingModel = function (this: Any, builder: Any) {
      const base = ownModel.call(this, builder);
      if (!base || !(base instanceof (PhysicalLightingModel as Any))) return base;
      CARD_GPU_STATS.models++;
      pending = cardLighting(base, builder);
      return base;
    };
    const ownLighting = node.setupLighting;
    node.setupLighting = function (this: Any, builder: Any) {
      pending = null;
      const out = ownLighting.call(this, builder);
      // The lighting's subgraph built inside a context of ours: three's lights ask it for the sun's shadow, and the
      // cascades take the lookup's place from it, for this card alone.
      return out && pending ? context(out, pending) : out;
    };
  },
};

// Kept for the node test: the uniform objects every knob reads, by name.
export const CARD_KNOB_SOURCES = { light: CARD_LIGHT_UNIFORMS, rule: CARD_UNIFORMS } as const;
