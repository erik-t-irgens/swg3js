// The ground's tile program and the far rings on WebGPU (the GPU port's step 5, items 1 and 2). On WebGL each is a
// `MeshStandardMaterial` whose compile hook writes text of ours into three's chunks (`terrainTextures.ts`'s
// `injectGroundTiles` and the version-3 `injectGroundFamilies`/`injectGroundNormal`, `horizonRings.ts`'s `injectRing`);
// three's WebGPU renderer runs no `onBeforeCompile` and cannot copy such a material's text, so each site registers a node
// material here as its stand-in (`userData.gpuStandIn`, `fallback.ts`), drawn in its place with the original's render
// state. Each is a `MeshStandardNodeMaterial` whose nodes are that text line for line:
//
//   - **the tile program** (`groundTilesNode`): the tile's layers, codes, place and tint off the chunk's own attributes in
//     the vertex stage, the colour map's tint in its four modes and gain cap (`groundTintOf`), the families laid over the
//     bottom one through the client's masks turned onto their corners (`groundMask`), each picture along the terrain's own
//     x (`mirror`), the steep faces' side pictures (`tri`) and the relief near the eye (`relief`) where they were taken in
//     at load as on WebGL, the bump's slope added to the ground's own lean, the gloss off the roughness or kept for the flat
//     shine, the flat shine itself after three's highlight in each direct light, the client's cloud shadows over the lit
//     ground, and the program's own views for the self test and the console (`uGroundLook.z`);
//   - **the version-3 program** (`groundFamiliesNode`): three families' pictures blended by each triangle's corners, with
//     the bumps and gloss where the pack carries them;
//   - **the rings** (`ringNode`): the vertex stage's morph by each vertex's own place, the reach's clamp, the drop and the
//     skirts, the bake's heights and the shape window's out of the heights atlas, the normals baked and worked out; the
//     fragment's near composition out of the composition and tint windows (the tile program's own lines through the same
//     functions as the ground's), faded into the bake's albedo, the ground's lean, the gloss, the flat shine, the clouds, the
//     fog's cheap path, the horizon fade into the sky's own colour or the fog's, and the console's views.
//
// One rule in one place: every uniform is the very object the WebGL program reads (`GroundTileUniforms`, `RingUniforms`),
// read once a render in the shared render group (a vector or a colour by reference, its writes reaching the picture; a
// picture swapped into its `{ value }` taken at the next render, `LiveTexture`), so every switch of `__debug.ground` and
// `__debug.horizon` moves both renderers; every number of the arithmetic is the mirrors' (`groundMath.ts`'s `CLOUD_*` and
// `LUMA` and the curve and floors its functions write out, `GROUND_SRGB` and `GROUND_FLOORS` here; `horizonMath.ts`'s
// `PATCH`, `LEAF`; `ALBEDO_SCALE`), held to them by the node test, the curve and the floors by running the mirror's own
// functions at their edges (`groundMath.ts` stays 28fdb7c's to the byte, which `horizonWiring.test.ts` holds).
//
// What differs from WebGL, by what three's WebGPU renderer is: the colour is written linear and three tone-maps and encodes
// it in its own output pass, so the horizon fade and the fog mix in linear light (WebGL mixes them after its tone mapping,
// `ringOut`), and the console's views go through that output pass too; the weather's wet look is a remake of the owner's
// and not here; three 0.187's physical lighting cuts the diffuse for its highlight where WebGL holds 0.185's uncut diffuse,
// which is given back by `GPU_LOOK.groundDiffuseBack` (1, WebGL's picture). The composition window is RGBA32UI on WebGPU
// (three 0.187 binds an unsigned 16-bit integer picture as a float one), its numbers the same.

import * as THREE from 'three';
import { MeshStandardNodeMaterial, NodeUpdateType, PhysicalLightingModel, TextureNode } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { CLOUD_GREY, CLOUD_METRES, CLOUD_PERIOD, LUMA } from '../../world/groundMath.ts';
import { GROUND_RELIEF_WANTED, GROUND_TRI_WANTED, type GroundTileUniforms } from '../../world/terrainTextures.ts';
import type { RingUniforms } from '../../world/horizon/horizonRings.ts';
import { LEAF, PATCH } from '../../world/horizon/horizonMath.ts';
import { ALBEDO_SCALE } from '../../world/horizon/horizonDecode.ts';
import { acesInverseNode, toLinearNode } from './gpuCard.ts';
import { diffuseBackNode } from './gpuSpec.ts';
import { HeldLightingModel } from './gpuLightHold.ts';
import { motionPrevious, previousUniform } from './motion.ts';
import { GPU_LOOK } from './gpuLook.ts';
import { GPU_LOOKS } from './looks.ts';
import { drawsInline } from './inlineOutput.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Three's node functions, taken untyped: the graphs here are built of nodes whose types three's declarations cannot follow.
const {
  BRDF_Lambert,
  Fn,
  If,
  abs,
  attribute,
  bitAnd,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  dFdx,
  dFdy,
  diffuseContribution,
  dot,
  exp,
  exp2,
  float,
  floor,
  int,
  ivec2,
  length,
  log2,
  max,
  min,
  mix,
  mod,
  normalView,
  normalViewGeometry,
  normalWorldGeometry,
  normalize,
  positionGeometry,
  positionView,
  positionWorld,
  pow,
  property,
  renderGroup,
  select,
  shiftRight,
  smoothstep,
  sqrt,
  step,
  uint,
  uniform,
  uniformArray,
  varying,
  varyingProperty,
  vec2,
  vec3,
  vec4,
  PI,
} = TSL as Any;

/**
 * Every number the graphs are built from that is not a uniform, in one record so the node test holds the graphs to the
 * mirrors: the sRGB curve and the floors (`groundMath.ts`), the cloud layer's grey, scale and period, the luminance weights,
 * the patch and the leaf (`horizonMath.ts`: a level-L node's quad is LEAF / PATCH · 2^L metres), the albedo's scale
 * (`horizonDecode.ts`), the baked normals' bias (RG8 about 127.5), the relief's four steps and the sentinel of a shape
 * sample not made yet.
 */
/**
 * sRGB's curve as `groundMath.ts`'s `srgbDecode` and `srgbEncode` write it (and the WebGL text's own), and the floors its
 * tint, bump and cloud functions hold their divisions off (`tintGammaOf`, `bumpNormal`, `cloudShade`), with the tile
 * program's roughness floor (`TILE_ROUGHNESS`'s 0.08). The mirror writes them out as numbers and is 28fdb7c's to the byte,
 * so they are named here and `gpuGround.test.ts` runs the mirror's functions at their edges against them.
 */
export const GROUND_SRGB = { below: 0.04045, slope: 12.92, offset: 0.055, scale: 1.055, power: 2.4, encodeBelow: 0.0031308, encodeFloor: 1e-6 } as const;
export const GROUND_FLOORS = { tintRef: 1e-3, tintLum: 1e-6, bumpZ: 0.2, cloudBase: 1e-5, rough: 0.08 } as const;
export const GROUND_GRAPH_NUMBERS = {
  srgb: GROUND_SRGB,
  floors: GROUND_FLOORS,
  cloudGrey: CLOUD_GREY,
  cloudMetres: CLOUD_METRES,
  cloudPeriod: CLOUD_PERIOD,
  luma: LUMA,
  quad: LEAF / PATCH,
  patch: PATCH,
  albedoScale: ALBEDO_SCALE,
  normalBias: 127.5,
  reliefSteps: 4,
  shapeSentinel: -1e29,
} as const;

// ---------------------------------------------------------------- the uniforms, read off the WebGL path's own objects

/** A vector or colour the WebGL program reads, by reference: three reads its fields once a render. */
const ref = (u: { value: unknown }): Any => uniform(u.value as never).setGroup(renderGroup);
/** A number read off a JS value once a render (a dial, a switch). */
const live = (read: () => number): Any => uniform(read()).setGroup(renderGroup).onRenderUpdate(read);

/**
 * A texture the WebGL program reads through `{ value }`, which the world replaces as a world's pictures are bound
 * (`bindTiles`, the field's textures): every sample of it is a clone of one base (one binding), and each clone takes the
 * object's picture once a render, writing it through to the base. A picture not there yet is a fallback of the same kind,
 * so a sampler always holds a real texture.
 */
export class LiveTexture extends (TextureNode as Any) {
  constructor(value: THREE.Texture, uvNode: Any = null, levelNode: Any = null, biasNode: Any = null) {
    super(value, uvNode, levelNode, biasNode);
    this.updateType = NodeUpdateType.RENDER;
    this.setUpdateMatrix(false);
    this.isLiveTexture = true;
  }

  update(): void {
    const t = (this.source?.value as THREE.Texture | null | undefined) ?? this.fallback;
    if (t && this.value !== t) this.value = t;
  }

  clone(): Any {
    const n = super.clone();
    n.source = this.source;
    n.fallback = this.fallback;
    n.setUpdateMatrix(false);
    return n;
  }
}

/** A live texture's base over `{ value }`, with a fallback picture for while it is null. */
export function liveTexture(src: { value: THREE.Texture | null }, fallback: THREE.Texture): Any {
  const n = new LiveTexture(src.value ?? fallback) as Any;
  n.source = src;
  n.fallback = fallback;
  return n;
}

/** One white texel, the fallback of a picture the WebGL path holds as null (the sky's gradients before a sky). */
let white: THREE.Texture | null = null;
function whiteTexture(): THREE.Texture {
  if (!white) {
    white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    white.needsUpdate = true;
  }
  return white;
}

/** The tile program's uniforms as nodes, made per graph from the one set the WebGL program reads. */
export interface GroundNodes {
  ground: Any;
  bump: Any;
  mask: Any;
  clouds: Any;
  frame: Any;
  tint: Any;
  tintRef: Any;
  look: Any;
  shine: Any;
  cloud: Any;
  tri: Any;
  relief: Any;
}

export function groundNodes(u: GroundTileUniforms): GroundNodes {
  return {
    ground: liveTexture(u.uGround, u.uGround.value),
    bump: liveTexture(u.uGroundBump, u.uGroundBump.value),
    mask: liveTexture(u.uGroundMask, u.uGroundMask.value),
    clouds: liveTexture(u.uGroundClouds, u.uGroundClouds.value),
    frame: ref(u.uGroundFrame),
    tint: ref(u.uGroundTint),
    tintRef: ref(u.uGroundTintRef),
    look: ref(u.uGroundLook),
    shine: ref(u.uGroundShine),
    cloud: ref(u.uGroundCloud),
    tri: ref(u.uGroundTri),
    relief: ref(u.uGroundRelief),
  };
}

// ---------------------------------------------------------------- the tile program's functions (`terrainTextures.ts`)

const N = GROUND_GRAPH_NUMBERS;

/** `groundTintOf`: the colour map's tint in the client's gamma, off, the client's, normalised, per channel. */
export function groundTintOf(c: Any, tint: Any, tintRef: Any): Any {
  const lum = dot(c, vec3(N.luma[0], N.luma[1], N.luma[2]));
  const norm = c.mul(min(float(1).div(max(tintRef.w, N.floors.tintRef)), tint.y.div(max(lum, N.floors.tintLum))));
  const channel = min(c.div(max(tintRef.xyz, vec3(N.floors.tintRef))), vec3(tint.y));
  return select(tint.x.lessThan(0.5), vec3(1), select(tint.x.lessThan(1.5), c, select(tint.x.lessThan(2.5), norm, channel)));
}

/** `groundDecode`: sRGB's decode, run on past one. */
export function groundDecode(c: Any): Any {
  const s = N.srgb;
  const lo = c.mul(1 / s.slope);
  const hi = pow(max(c, vec3(0)).add(s.offset).mul(1 / s.scale), vec3(s.power));
  // `lessThanEqual(c, below)` as a step: one where c <= below.
  return mix(hi, lo, step(c, vec3(s.below)));
}

/** `groundEncode`: and its encode. */
export function groundEncode(c: Any): Any {
  const s = N.srgb;
  const lo = c.mul(s.slope);
  const hi = pow(max(c, vec3(s.encodeFloor)), vec3(1 / s.power)).mul(s.scale).sub(s.offset);
  return mix(hi, lo, step(c, vec3(s.encodeBelow)));
}

/** `groundCloudShade`: the client's cloud layer over a lit colour, at the tile's alpha squared, never brightening. */
export function groundCloudShade(g: GroundNodes, lit: Any, groundUV: Any): Any {
  const uv = groundUV.mul(4 / N.cloudMetres).add(vec2(1, -1).mul(g.cloud.z.mul(1 / N.cloudPeriod)));
  const a = g.clouds.sample(uv).r;
  const k = clamp(a.mul(a).mul(g.cloud.y), 0, 1);
  const enc = groundEncode(clamp(lit, 0, 1));
  const shaded = groundDecode(mix(enc, vec3(N.cloudGrey), k));
  return min(vec3(1), shaded.div(max(groundDecode(enc), vec3(N.floors.cloudBase))));
}

/** `groundTurn`: a tile place turned onto a mask's own frame a quarter turn at a time (k a whole number as a float). */
function groundTurn(st: Any, k: Any): Any {
  return select(k.equal(1), vec2(st.y, float(1).sub(st.x)), select(k.equal(2), vec2(float(1).sub(st.x), float(1).sub(st.y)), select(k.equal(3), vec2(float(1).sub(st.y), st.x), st)));
}

/** `groundTurnDir`: a derivative turned with it. */
function groundTurnDir(d: Any, k: Any): Any {
  return select(k.equal(1), vec2(d.y, d.x.negate()), select(k.equal(2), d.negate(), select(k.equal(3), vec2(d.y.negate(), d.x), d)));
}

/** `groundMaskTap`: one mask, turned, with the derivatives it is handed. */
function groundMaskTap(g: GroundNodes, tile: Any, kind: Any, k: Any, dx: Any, dy: Any): Any {
  return g.mask.sample(groundTurn(tile, k)).depth(int(kind)).grad(groundTurnDir(dx, k), groundTurnDir(dy, k)).r;
}

/** `groundMask`: an overlay's weight from its code, one plus four times the kind plus the turn. Emits into the current flow. */
export function groundMask(g: GroundNodes, tile: Any, code: Any, dx: Any, dy: Any): Any {
  const c = floor(code.add(0.5)).sub(1);
  const kind = floor(c.div(4));
  const k = c.sub(kind.mul(4));
  const m = float(0).toVar();
  If(kind.equal(3), () => {
    const a = groundMaskTap(g, tile, float(0), k, dx, dy);
    const b = groundMaskTap(g, tile, float(0), k.add(2), dx, dy);
    m.assign(select(g.look.x.greaterThan(0.5), min(a.add(b), 1), max(a, b)));
  }).Else(() => {
    m.assign(groundMaskTap(g, tile, kind, k, dx, dy));
  });
  return select(c.lessThan(0), float(0), select(g.look.y.greaterThan(0.5), m, step(0.5, m)));
}

/** The steep faces' state (`groundTriSetup`'s globals): the three weights and the two side taps' places and derivatives. */
interface TriState {
  W: Any;
  X: Any;
  Z: Any;
  Xd: Any;
  Zd: Any;
}

/** `groundTriSetup`: the sides' share of a face by its normal in the world's frame (unit). */
export function groundTriSetup(g: GroundNodes, uv: Any, dx: Any, dy: Any, y: Any, yd: Any, n: Any): TriState {
  const side = float(1).sub(smoothstep(g.tri.z, g.tri.y, abs(n.y)));
  const ax = pow(abs(n.x), g.tri.w);
  const az = pow(abs(n.z), g.tri.w);
  const s = ax.add(az);
  const on = g.tri.x.greaterThanEqual(0.5).and(side.greaterThan(0)).and(s.greaterThan(1e-6));
  const W = select(on, vec3(float(1).sub(side), side.mul(ax).div(s), side.mul(az).div(s)), vec3(1, 0, 0)).toVar('gTriW');
  const q = y.mul(-0.25);
  return {
    W,
    X: vec2(uv.y, q),
    Z: vec2(uv.x, q),
    Xd: vec4(dx.y, yd.x.mul(-0.25), dy.y, yd.y.mul(-0.25)),
    Zd: vec4(dx.x, yd.x.mul(-0.25), dy.x, yd.y.mul(-0.25)),
  };
}

/** A picture of an array at a layer (a float index, rounded as a GLSL array layer is), with the derivatives handed in. */
function layerTap(base: Any, uv: Any, layer: Any, dx: Any, dy: Any): Any {
  return base.sample(uv).depth(int(floor(layer.add(0.5)))).grad(dx, dy);
}

/** `groundTap`: the plain tap, and on a steep face the side taps by their shares. Emits into the current flow. */
function groundTap(base: Any, uv: Any, layer: Any, dx: Any, dy: Any, tri: TriState | null): Any {
  if (!tri) return layerTap(base, uv, layer, dx, dy);
  const c = layerTap(base, uv, layer, dx, dy).toVar();
  If(tri.W.x.lessThan(1), () => {
    c.mulAssign(tri.W.x);
    If(tri.W.y.greaterThan(0), () => {
      c.addAssign(layerTap(base, tri.X, layer, tri.Xd.xy, tri.Xd.zw).mul(tri.W.y));
    });
    If(tri.W.z.greaterThan(0), () => {
      c.addAssign(layerTap(base, tri.Z, layer, tri.Zd.xy, tri.Zd.zw).mul(tri.W.z));
    });
  });
  return c;
}

/** `groundBumpTap`: the bump takes no side tap; on a side it leans to flat by the sides' share. */
function groundBumpTap(base: Any, uv: Any, layer: Any, dx: Any, dy: Any, tri: TriState | null): Any {
  const c = layerTap(base, uv, layer, dx, dy);
  if (!tri) return c;
  return select(tri.W.x.greaterThanEqual(1), c, vec4(mix(vec3(0.5, 0.5, 1), c.rgb, tri.W.x), c.a.mul(tri.W.x)));
}

/** What the composition hands on: the colour, the bump and gloss, the overlays' weights (variables of the flow). */
export interface Composed {
  colour: Any;
  bump: Any;
  w: Any;
}

/**
 * `TILE_MAP`'s composition: the bottom layer, each overlay mixed over it by its mask in turn, the bump and gloss with the
 * same weights. Emits its branches into the current flow (most tiles hold one layer); every tap takes the derivatives
 * handed in, taken where the whole quad runs.
 */
export function composeTile(g: GroundNodes, uv: Any, layers: Any, blend: Any, tile: Any, dx: Any, dy: Any, tx: Any, ty: Any, tri: TriState | null): Composed {
  const colour = groundTap(g.ground, uv, layers.x, dx, dy, tri).toVar();
  const bump = groundBumpTap(g.bump, uv, layers.x, dx, dy, tri).toVar();
  const w = vec3(0).toVar();
  If(blend.x.greaterThan(0.5), () => {
    w.x.assign(groundMask(g, tile, blend.x, tx, ty));
    colour.assign(mix(colour, groundTap(g.ground, uv, layers.y, dx, dy, tri), w.x));
    bump.assign(mix(bump, groundBumpTap(g.bump, uv, layers.y, dx, dy, tri), w.x));
    If(blend.y.greaterThan(0.5), () => {
      w.y.assign(groundMask(g, tile, blend.y, tx, ty));
      colour.assign(mix(colour, groundTap(g.ground, uv, layers.z, dx, dy, tri), w.y));
      bump.assign(mix(bump, groundBumpTap(g.bump, uv, layers.z, dx, dy, tri), w.y));
      If(blend.z.greaterThan(0.5), () => {
        w.z.assign(groundMask(g, tile, blend.z, tx, ty));
        colour.assign(mix(colour, groundTap(g.ground, uv, layers.w, dx, dy, tri), w.z));
        bump.assign(mix(bump, groundBumpTap(g.bump, uv, layers.w, dx, dy, tri), w.z));
      });
    });
  });
  return { colour, bump, w };
}

/**
 * `groundRelief`: the picture's offset toward the eye for a depth k (metres, faded): the eye's direction in the world, its
 * run over the ground per metre of height in picture units, at the blended height, four times. Emits into the current flow.
 */
function groundRelief(g: GroundNodes, groundUV: Any, layers: Any, blend: Any, tile: Any, k: Any, tx: Any, ty: Any, dx: Any, dy: Any): Any {
  const w = vec3(0).toVar();
  If(blend.x.greaterThan(0.5), () => {
    w.x.assign(groundMask(g, tile, blend.x, tx, ty));
    If(blend.y.greaterThan(0.5), () => {
      w.y.assign(groundMask(g, tile, blend.y, tx, ty));
      If(blend.z.greaterThan(0.5), () => {
        w.z.assign(groundMask(g, tile, blend.z, tx, ty));
      });
    });
  });
  // Toward the eye in the world's frame: WebGL's `normalize( vViewPosition * viewMatrix )`, the view's inverse turn.
  const e = normalize(cameraPosition.sub(positionWorld));
  const r = vec2(g.frame.z.negate().mul(e.x), e.z).mul(k.mul(0.25).div(max(e.y, 0.25)));
  const off = vec2(0).toVar();
  for (let i = 0; i < N.reliefSteps; i++) {
    const at = groundUV.add(off);
    const h = layerTap(g.ground, at, layers.x, dx, dy).a.toVar();
    If(w.x.greaterThan(0), () => {
      h.assign(mix(h, layerTap(g.ground, at, layers.y, dx, dy).a, w.x));
    });
    If(w.y.greaterThan(0), () => {
      h.assign(mix(h, layerTap(g.ground, at, layers.z, dx, dy).a, w.y));
    });
    If(w.z.greaterThan(0), () => {
      h.assign(mix(h, layerTap(g.ground, at, layers.w, dx, dy).a, w.z));
    });
    off.assign(r.mul(h.sub(0.5)));
  }
  return off;
}

/**
 * `TILE_NORMAL`: the blended bump's slope added to the ground's own lean `gN` (unit, the world's frame), the slope's x
 * turned with the pictures' way round. Answers the lean in the world's frame (`gGroundNormalW`).
 */
export function tileNormalW(g: GroundNodes, bump: Any, gN: Any): Any {
  const gn = bump.xyz.mul(2).sub(1);
  const gs0 = gn.xy.negate().div(max(gn.z, N.floors.bumpZ)).mul(g.shine.z);
  const gs = vec2(gs0.x.mul(g.frame.z.negate()), gs0.y);
  const gg = vec2(gN.x.negate(), gN.z.negate()).div(max(gN.y, N.floors.bumpZ));
  return normalize(vec3(gg.x.add(gs.x).negate(), 1, gg.y.add(gs.y).negate()));
}

/** A direction in the world's frame into the view's (`viewMatrix * vec4( d, 0.0 )`). */
const toView = (d: Any): Any => cameraViewMatrix.mul(vec4(d, 0)).xyz;

// ---------------------------------------------------------------- the lighting: the flat shine and the diffuse given back

/**
 * Three's physical lighting with the tile program's two changes: after three's highlight each direct light adds the flat
 * shine (`TILE_FLAT_LINE`: the light's colour times the gloss's flat share over pi, no N·L, as the client's power of nought
 * reads), and the diffuse three 0.187 cut for its highlight given back by `GPU_LOOK.groundDiffuseBack` (`diffuseBackNode`'s
 * arithmetic, gpuSpec.ts; WebGL holds 0.185's uncut diffuse).
 */
export class GroundLightingModel extends (HeldLightingModel as Any) {
  readonly flat: Any;
  readonly back: Any;
  constructor(flat: Any, back: Any) {
    super();
    this.flat = flat;
    this.back = back;
  }

  direct(input: Any, builder: Any): void {
    (PhysicalLightingModel.prototype as Any).direct.call(this, input, builder);
    const { lightDirection, lightColor, reflectedLight } = input;
    reflectedLight.directSpecular.addAssign(lightColor.mul(this.flat.div(PI)));
    reflectedLight.directDiffuse.addAssign(diffuseBackNode(lightDirection, lightColor, normalView, float(1).sub(this.back)));
  }

  indirectDiffuse(builder: Any): void {
    // 0.187's indirect light (`HeldLightingModel`, pass 1's wave 2), then the ambient's share given back.
    (HeldLightingModel.prototype as Any).indirectDiffuse.call(this, builder);
    const self = this as Any;
    const { irradiance, reflectedLight } = builder.context;
    const energy = self.singleScatteringDielectric.add(self.multiScatteringDielectric);
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul((BRDF_Lambert as Any)({ diffuseColor: diffuseContribution })).mul(energy).mul(this.back));
  }
}

// ---------------------------------------------------------------- the tile program's material

/** The shared properties every stage of the tile program and the rings reads (`main()`'s globals on WebGL). */
const P = {
  bump: (): Any => property('vec4', 'gGroundBump'),
  albedo: (): Any => property('vec3', 'gGroundAlbedo'),
  flat: (): Any => property('float', 'gGroundFlat'),
};

/** The node material's live switches (`__debug.gpu({ look: { ground } })`): one, read once a render. */
let groundOn: Any = null;
function groundSwitch(): Any {
  return (groundOn ??= live(() => (GPU_LOOKS.ground ? 1 : 0)));
}

/** Counts for the console: graphs made, and builds of each. */
export const GROUND_GPU_STATS = { tiles: 0, families: 0, rings: 0, builds: { tiles: 0, families: 0, rings: 0 } };

/**
 * The tile program on WebGPU, drawing from the one set of uniforms the WebGL program reads (the session's, or a self
 * test's own). The plain look the console's switch falls back to is step 3's stand-in (the chunk's colour-map colour, lit).
 */
export function groundTilesNode(u: GroundTileUniforms, opts: { tri?: boolean; relief?: boolean } = {}): MeshStandardNodeMaterial {
  const tri = opts.tri ?? GROUND_TRI_WANTED;
  const relief = opts.relief ?? GROUND_RELIEF_WANTED;
  const g = groundNodes(u);
  const m = new MeshStandardNodeMaterial() as Any;
  m.name = 'gpu: the ground tile program';
  m.roughness = 1;
  m.metalness = 0;
  GROUND_GPU_STATS.tiles++;
  const on = groundSwitch().greaterThan(0.5);
  // The vertex stage: the terrain-space picture place (one repeat a 4 m tile), the tile's data, its tint.
  const terrain = vec2(g.frame.x.sub(positionWorld.x), positionWorld.z.add(g.frame.y));
  const vUV = varying(vec2(g.frame.z.mul(terrain.x), terrain.y).mul(0.25), 'vGroundUV');
  const vLayers = varying(attribute('aGroundLayers', 'vec4'), 'vGroundLayers').setInterpolation('flat');
  const blendA = attribute('aGroundBlend', 'vec4');
  const vBlend = varying(blendA, 'vGroundBlend').setInterpolation('flat');
  const code = floor(blendA.w.add(0.5));
  const s = floor(code.add(0.5).div(3));
  const vTile = varying(vec2(s, code.sub(s.mul(3))).mul(0.5), 'vGroundTile');
  const tintA = attribute('aGroundTint', 'vec3');
  const vTint = varying(groundTintOf(tintA, g.tint, g.tintRef), 'vGroundTint');
  const vY = varying(positionWorld.y, 'vGroundY');
  const bump = P.bump();
  const albedo = P.albedo();
  const flat = P.flat();
  // The colour stage (`TILE_RELIEF` then `TILE_MAP`), the derivatives taken once where the whole quad runs.
  m.colorNode = Fn(() => {
    GROUND_GPU_STATS.builds.tiles++;
    // Assigned here, at the top, so they are taken where the whole quad runs: a derivative node is written out where it is
    // first read, and a first read inside a branch (the relief's, whose distance parts a quad) is undefined there.
    const dx = property('vec2', 'gGroundDx');
    const dy = property('vec2', 'gGroundDy');
    const tx = property('vec2', 'gGroundTx');
    const ty = property('vec2', 'gGroundTy');
    const yd = property('vec2', 'gGroundYd');
    dx.assign(dFdx(vUV));
    dy.assign(dFdy(vUV));
    tx.assign(dFdx(vTile));
    ty.assign(dFdy(vTile));
    yd.assign(vec2(dFdx(vY), dFdy(vY)));
    let uv: Any = vUV;
    if (relief) {
      const k = g.relief.w.mul(g.relief.x).mul(float(1).sub(smoothstep(g.relief.y.mul(float(1).sub(g.relief.z)), g.relief.y, length(positionView))));
      const off = vec2(0).toVar('gGroundOff');
      If(k.greaterThan(0), () => {
        off.assign(groundRelief(g, vUV, vLayers, vBlend, vTile, k, tx, ty, dx, dy));
      });
      uv = vUV.add(off);
    }
    const t = tri ? groundTriSetup(g, uv, dx, dy, vY, yd, normalWorldGeometry) : null;
    const c = composeTile(g, uv, vLayers, vBlend, vTile, dx, dy, tx, ty, t);
    bump.assign(c.bump);
    albedo.assign(c.colour.rgb.mul(groundDecode(vTint)));
    // `TILE_ROUGHNESS`'s second line: the gloss kept for the flat shine.
    flat.assign(select(on, bump.a.mul(g.shine.y), float(0)));
    // Off by the console's switch: step 3's plain look (the colour map's colour, decoded, lit).
    const plain = pow(tintA, vec3(2.2)).mul(live(() => GPU_LOOK.groundTint));
    return vec4(select(on, albedo, plain), 1);
  })();
  // `TILE_ROUGHNESS`'s first line, before the weather's (which WebGPU does not draw: a remake).
  m.roughnessNode = select(on, clamp(float(1).sub(bump.a.mul(g.shine.x)), N.floors.rough, 1), float(1));
  m.metalnessNode = float(0);
  // `TILE_NORMAL`: the blended bump's slope added to the ground's own lean, in the view's frame.
  m.normalNode = select(on, normalize(toView(tileNormalW(g, bump, normalWorldGeometry))), normalViewGeometry);
  const back = live(() => GPU_LOOK.groundDiffuseBack);
  m.setupLightingModel = function (this: Any) {
    return new GroundLightingModel(flat, back);
  };
  // The clouds over the lit ground (`TILE_CLOUDS`), a switch of their own.
  const ownLighting = m.setupLighting;
  m.setupLighting = function (this: Any, builder: Any) {
    const lit = ownLighting.call(this, builder);
    return select(on.and(g.cloud.x.greaterThan(0.5)), lit.mul(groundCloudShade(g, lit, vUV)), lit);
  };
  // The program's own views (`TILE_VIEW`): the colour, the colour under the clouds, the bump's lean and gloss.
  const ownOutput = m.setupOutput;
  m.setupOutput = function (this: Any, builder: Any, out: Any) {
    const done = ownOutput.call(this, builder, out);
    const lean = tileNormalW(g, bump, normalWorldGeometry);
    const view = select(g.look.z.greaterThan(2.5), vec4(lean.mul(0.5).add(0.5), bump.a), vec4(select(g.look.z.greaterThan(1.5), albedo.mul(groundCloudShade(g, albedo, vUV)), albedo), 1));
    return select(on.and(g.look.z.greaterThan(0.5)), asShown(view), done);
  };
  return m as MeshStandardNodeMaterial;
}

// ---------------------------------------------------------------- the version-3 program

/** What a version-3 ground hands its program: its one picture a family, the lookups, and the bumps' two strengths. */
export interface FamiliesInput {
  texture: THREE.Texture;
  layerOf: Float32Array;
  sizeOf: Float32Array;
  normals: THREE.DataArrayTexture | null;
  normalScale: { value: number };
  glossScale: { value: number };
}

/**
 * The version-3 program on WebGPU (`injectGroundFamilies`, `injectGroundNormal`): each triangle's three families' pictures
 * blended by its corners' weights, at the family's own size, and where the pack carries bumps their slopes added to the
 * ground's lean and their gloss off the roughness. Every number of the lookups the WebGL program's own arrays.
 */
export function groundFamiliesNode(p: FamiliesInput): MeshStandardNodeMaterial {
  const count = p.layerOf.length;
  const m = new MeshStandardNodeMaterial() as Any;
  m.name = 'gpu: the ground (version 3)';
  m.roughness = 1;
  m.metalness = 0;
  GROUND_GPU_STATS.families++;
  const tex = liveTexture({ value: p.texture }, p.texture);
  const layer = uniformArray(Array.from(p.layerOf), 'float');
  const size = uniformArray(Array.from(p.sizeOf), 'float');
  const vFamily = varying(attribute('aFamily', 'vec3'), 'vFamily');
  const vBary = varying(attribute('aBary', 'vec3'), 'vBary');
  const vXZ = varying(positionWorld.xz, 'vGroundXZ');
  const idOf = (f: Any): Any => clamp(int(f.add(0.5)), int(0), int(count - 1));
  const sample = (base: Any, f: Any): Any => {
    const id = idOf(f);
    return base.sample(vXZ.div(size.element(id))).depth(int(floor(layer.element(id).add(0.5))));
  };
  const weights = vBary.div(max(vBary.x.add(vBary.y).add(vBary.z), 1e-4));
  m.colorNode = Fn(() => {
    GROUND_GPU_STATS.builds.families++;
    const c = sample(tex, vFamily.x).mul(weights.x).add(sample(tex, vFamily.y).mul(weights.y)).add(sample(tex, vFamily.z).mul(weights.z));
    return vec4(c.rgb, 1);
  })();
  if (p.normals) {
    const nrm = liveTexture({ value: p.normals }, p.normals);
    const scale = live(() => p.normalScale.value);
    const gloss = live(() => p.glossScale.value);
    const slope = (f: Any): Any => {
      const n = sample(nrm, f).xyz.mul(2).sub(1);
      return n.xy.negate().div(max(n.z, N.floors.bumpZ));
    };
    const gs = slope(vFamily.x).mul(weights.x).add(slope(vFamily.y).mul(weights.y)).add(slope(vFamily.z).mul(weights.z)).mul(scale);
    const gN = normalWorldGeometry;
    const gg = vec2(gN.x.negate(), gN.z.negate()).div(max(gN.y, N.floors.bumpZ));
    m.normalNode = normalize(toView(normalize(vec3(gg.x.add(gs.x).negate(), 1, gg.y.add(gs.y).negate()))));
    const a = sample(nrm, vFamily.x).a.mul(weights.x).add(sample(nrm, vFamily.y).a.mul(weights.y)).add(sample(nrm, vFamily.z).a.mul(weights.z));
    m.roughnessNode = clamp(float(1).sub(a.mul(gloss)), N.floors.rough, 1);
  } else m.roughnessNode = float(1);
  m.metalnessNode = float(0);
  // 0.187's indirect light (pass 1, wave 2: three's development commit reflects the ambient and hemisphere lights).
  m.setupLightingModel = function (this: Any) {
    return new HeldLightingModel();
  };
  return m as MeshStandardNodeMaterial;
}

// ---------------------------------------------------------------- the rings (`horizonRings.ts`)

/** The rings' uniforms as nodes, made per graph from the one set the WebGL program reads. */
export interface RingNodes {
  eye: Any;
  square: Any;
  morph: Any;
  drop: Any;
  grid: Any;
  fine: Any;
  coarse: Any;
  colour: Any;
  sizes: Any;
  colourN: Any;
  look: Any;
  fade: Any;
  shape: Any;
  shapeWin: Any;
  shapeAt: Any;
  win: Any;
  winC: Any;
  heights: Any;
  fineN: Any;
  albedo: Any;
  coarseAlbedo: Any;
  window: Any;
  tintWin: Any;
  gradient: Any;
  gradient2: Any;
  dome: Any;
  clear: Any;
  horizonFog: Any;
}

export function ringNodes(u: RingUniforms): RingNodes {
  return {
    eye: ref(u.uHorizonEye),
    square: ref(u.uHorizonSquare),
    morph: ref(u.uHorizonMorph),
    drop: ref(u.uHorizonDrop),
    grid: ref(u.uHorizonGrid),
    fine: ref(u.uHorizonFine),
    coarse: ref(u.uHorizonCoarse),
    colour: ref(u.uHorizonColour),
    sizes: ref(u.uHorizonSizes),
    colourN: ref(u.uHorizonColourN),
    look: ref(u.uHorizonLook),
    fade: ref(u.uHorizonFade),
    shape: ref(u.uHorizonShape),
    shapeWin: ref(u.uHorizonShapeWin),
    shapeAt: ref(u.uHorizonShapeAt),
    win: ref(u.uHorizonWin),
    winC: ref(u.uHorizonWinC),
    heights: liveTexture(u.uHorizonHeights, u.uHorizonHeights.value),
    fineN: liveTexture(u.uHorizonFineN, u.uHorizonFineN.value),
    albedo: liveTexture(u.uHorizonAlbedo, u.uHorizonAlbedo.value),
    coarseAlbedo: liveTexture(u.uHorizonCoarseAlbedo, u.uHorizonCoarseAlbedo.value),
    window: liveTexture(u.uHorizonWindow, u.uHorizonWindow.value),
    tintWin: liveTexture(u.uHorizonTint, u.uHorizonTint.value),
    gradient: liveTexture(u.uGradient, whiteTexture()),
    gradient2: liveTexture(u.uGradient2, whiteTexture()),
    dome: ref(u.uRingDome),
    clear: ref(u.uClear),
    horizonFog: ref(u.uHorizonFog),
  };
}

/** A uniform's last-frame copy where its value is a vector (`motion.ts`), else the node it already has. */
function previousOr(src: { value: unknown }, now: Any): Any {
  const v = src.value as { clone?: unknown; copy?: unknown } | null;
  return v && typeof v.clone === 'function' && typeof v.copy === 'function' ? previousUniform(src as { value: Any }) : now;
}

/** The rings' nodes with every vector the vertex reads that a frame moves taken at last frame (pass 1, wave 5's motion). */
export function ringPrevious(r: RingNodes, u: RingUniforms): RingNodes {
  return {
    ...r,
    eye: previousOr(u.uHorizonEye, r.eye),
    square: previousOr(u.uHorizonSquare, r.square),
    morph: previousOr(u.uHorizonMorph, r.morph),
    drop: previousOr(u.uHorizonDrop, r.drop),
    grid: previousOr(u.uHorizonGrid, r.grid),
    fine: previousOr(u.uHorizonFine, r.fine),
    coarse: previousOr(u.uHorizonCoarse, r.coarse),
    shapeWin: previousOr(u.uHorizonShapeWin, r.shapeWin),
    shapeAt: previousOr(u.uHorizonShapeAt, r.shapeAt),
    win: previousOr(u.uHorizonWin, r.win),
    winC: previousOr(u.uHorizonWinC, r.winC),
  };
}

// The bake's lattices and the morph (`HORIZON_RING_FUNCTIONS`), each as nodes over float operands.

export function ringDistLevelN(d: Any, lod0: Any, morph: Any): Any {
  // The level's log taken of no less than one (a distance under lod0 is level nought, which the select picks): the
  // GLSL's ternary never evaluates the log there, and a log of nought (a vertex on the eye) is minus infinity.
  const k = select(d.lessThan(lod0), float(0), floor(log2(max(d.div(lod0), 1))).add(1));
  const r = lod0.mul(exp2(k));
  const f = clamp(d.sub(r.mul(float(1).sub(morph))).div(r.mul(morph)), 0, 1);
  return k.add(f);
}

export function ringLevelOfN(d: Any, lod0: Any, morph: Any, shape: Any, mf: Any): Any {
  const coarse = ringDistLevelN(d, lod0, morph);
  const four = float(-1).add(clamp(d.sub(shape.y.mul(float(1).sub(mf))).div(shape.y.mul(mf)), 0, 1));
  const two = float(-2).add(clamp(d.sub(shape.x.mul(float(1).sub(mf))).div(shape.x.mul(mf)), 0, 1));
  return select(shape.z.greaterThan(-0.5).or(d.greaterThanEqual(shape.y)), coarse, select(shape.z.greaterThan(-1.5).or(d.greaterThanEqual(shape.x)), four, two));
}

export function ringEdgeLevelN(e: Any, band: Any, morph: Any): Any {
  const x = max(e, 0);
  const k = floor(log2(x.div(band).add(1)));
  const w = band.mul(exp2(k));
  const start = band.mul(exp2(k).sub(1));
  const f = clamp(x.sub(start).sub(w.mul(float(1).sub(morph))).div(w.mul(morph)), 0, 1);
  return k.add(f);
}

const ringSnapN = (v: Any, origin: Any, spacing: Any): Any => origin.add(floor(v.sub(origin).div(spacing)).mul(spacing));

export function ringMorphN(v: Any, origin: Any, w: Any, node: Any): Any {
  const lw = max(w, node);
  const k = floor(lw);
  const f = lw.sub(k);
  const s = exp2(k).mul(N.quad);
  const a = ringSnapN(v, origin, s);
  const b = ringSnapN(v, origin, s.mul(2));
  return a.add(b.sub(a).mul(f));
}

const ringEdgeDistanceN = (x: Any, z: Any, sq: Any): Any => max(max(sq.x.sub(x), x.sub(sq.z)), max(sq.y.sub(z), z.sub(sq.w)));
export const ringDropN = (e: Any, drop: Any, fade: Any, everywhere: Any): Any => select(everywhere.greaterThan(0.5), drop, drop.mul(clamp(float(1).sub(e.div(fade)), 0, 1)));
export const ringReachN = (dx: Any, dz: Any, reach: Any): Any => {
  const r = sqrt(dx.mul(dx).add(dz.mul(dz)));
  return select(r.greaterThan(reach), reach.div(r), float(1));
};

/** `bakeTap`: one height of the atlas by `texelFetch`. */
const bakeTap = (r: RingNodes, i: Any, j: Any): Any => r.heights.load(ivec2(i, j)).r;

/** `bakeLerp`: a lattice's bilinear in the heights atlas, its rows from `row0`. */
function bakeLerpN(r: RingNodes, fx: Any, fz: Any, nx: Any, nz: Any, row0: Any): Any {
  const cx = clamp(fx, 0, nx.sub(1));
  const cz = clamp(fz, 0, nz.sub(1));
  const ix = min(floor(cx), nx.sub(2));
  const iz = min(floor(cz), nz.sub(2));
  const ax = cx.sub(ix);
  const az = cz.sub(iz);
  const i = int(ix);
  const j = int(iz.add(row0));
  const h0 = mix(bakeTap(r, i, j), bakeTap(r, i.add(1), j), ax);
  const h1 = mix(bakeTap(r, i, j.add(1)), bakeTap(r, i.add(1), j.add(1)), ax);
  return mix(h0, h1, az);
}

const bakeCoarseN = (r: RingNodes, rx: Any, rz: Any): Any => bakeLerpN(r, rx.sub(r.coarse.x).div(r.coarse.z), rz.sub(r.coarse.y).div(r.coarse.z), r.sizes.z, r.sizes.w, r.sizes.y);

/** `bakeHeight`: the fine lattice inside its extent, the coarse past it. */
export function bakeHeightN(r: RingNodes, rx: Any, rz: Any): Any {
  const fx = rx.sub(r.fine.x).div(r.fine.z);
  const fz = rz.sub(r.fine.y).div(r.fine.z);
  const inside = fx.greaterThanEqual(0).and(fz.greaterThanEqual(0)).and(fx.lessThanEqual(r.sizes.x.sub(1))).and(fz.lessThanEqual(r.sizes.y.sub(1)));
  return select(inside, bakeLerpN(r, fx, fz, r.sizes.x, r.sizes.y, float(0)), bakeCoarseN(r, rx, rz));
}

const ringCoarseSpanN = (r: RingNodes, lod: Any): Any => r.coarse.z.mul(exp2(max(lod.sub(r.coarse.w), 0)));
const ringCoarseDxN = (r: RingNodes, rx: Any, rz: Any, s: Any): Any => bakeCoarseN(r, rx.add(s), rz).sub(bakeCoarseN(r, rx.sub(s), rz)).div(s.mul(2));
const ringCoarseDzN = (r: RingNodes, rx: Any, rz: Any, s: Any): Any => bakeCoarseN(r, rx, rz.add(s)).sub(bakeCoarseN(r, rx, rz.sub(s))).div(s.mul(2));

/** `shapeHeight`: the shape window's height and its share at a raw place, as (height, share); nought where it holds none. */
function shapeHeightN(r: RingNodes, rx: Any, rz: Any): Any {
  const at = r.shapeAt;
  const fx = rx.div(at.x);
  const fz = rz.div(at.x);
  const ix = floor(fx);
  const iz = floor(fz);
  const lx = ix.sub(r.shapeWin.x);
  const lz = iz.sub(r.shapeWin.y);
  const inner = min(min(lx, lz), min(at.y.sub(2).sub(lx), at.y.sub(2).sub(lz)));
  const share = clamp(inner.div(at.z), 0, 1);
  const tap = (gi: Any, gj: Any): Any => r.heights.load(ivec2(int(r.shapeWin.z.add(mod(gi, at.y))), int(r.shapeWin.w.add(mod(gj, at.y))))).r;
  const h00 = tap(ix, iz);
  const h10 = tap(ix.add(1), iz);
  const h01 = tap(ix, iz.add(1));
  const h11 = tap(ix.add(1), iz.add(1));
  const made = min(min(h00, h10), min(h01, h11)).greaterThanEqual(N.shapeSentinel);
  const ax = fx.sub(ix);
  const az = fz.sub(iz);
  const h = mix(mix(h00, h10, ax), mix(h01, h11, ax), az);
  const ok = share.greaterThan(0).and(made);
  return vec2(select(ok, h, float(0)), select(ok, share, float(0)));
}

/** `ringHeightAt`: the bake's height, and with the window read its own wherever it holds the place, as (height, share). */
export function ringHeightAtN(r: RingNodes, rx: Any, rz: Any): Any {
  const h = bakeHeightN(r, rx, rz);
  const w = shapeHeightN(r, rx, rz);
  const read = r.shape.w.greaterThanEqual(0.5);
  const share = select(read, w.y, float(0));
  return vec2(select(share.greaterThan(0), mix(h, w.x, share), h), share);
}

/** A baked normal's RG (biased about 127.5) into a unit normal in the game's frame, the up rebuilt. */
function fineNormal(rg: Any): Any {
  const n = rg.mul(255).sub(N.normalBias).div(N.normalBias);
  return normalize(vec3(n.x, sqrt(max(float(1).sub(dot(n, n)), 0)), n.y));
}

/** `ringNormalAt`: the baked normal inside the fine extent at the node's level, the coarse heights' differences past it. */
function ringNormalAtN(r: RingNodes, raw: Any, lod: Any): Any {
  const f = raw.sub(r.fine.xy).div(r.fine.z);
  const inside = f.x.greaterThanEqual(0).and(f.y.greaterThanEqual(0)).and(f.x.lessThanEqual(r.sizes.x.sub(1))).and(f.y.lessThanEqual(r.sizes.y.sub(1)));
  const baked = fineNormal(r.fineN.sample(f.add(0.5).div(r.sizes.xy)).level(max(lod.sub(r.fine.w), 0)).rg);
  const s = ringCoarseSpanN(r, lod);
  const coarse = normalize(vec3(ringCoarseDxN(r, raw.x, raw.y, s), 1, ringCoarseDzN(r, raw.x, raw.y, s).negate()));
  return select(inside, baked, coarse);
}

/** `ringShapeNormal`: the window's own central differences at the vertex's spacing, mixed by the least share of the five places. */
function ringShapeNormalN(r: RingNodes, raw: Any, s: Any, base: Any, share: Any): Any {
  const x1 = shapeHeightN(r, raw.x.add(s), raw.y);
  const x0 = shapeHeightN(r, raw.x.sub(s), raw.y);
  const z1 = shapeHeightN(r, raw.x, raw.y.add(s));
  const z0 = shapeHeightN(r, raw.x, raw.y.sub(s));
  const k = min(min(min(share, x1.y), min(x0.y, z1.y)), z0.y);
  const n = normalize(vec3(x1.x.sub(x0.x).div(s.mul(2)), 1, z1.x.sub(z0.x).div(s.mul(2)).negate()));
  return select(share.lessThanEqual(0).or(k.lessThanEqual(0)), base, normalize(mix(base, n, k)));
}

/** What the ring's vertex stage works out for a vertex, before it is written into the varyings. */
export interface RingVertex {
  pos: Any;
  raw: Any;
  edge: Any;
  dist: Any;
  level: Any;
  shape: Any;
  y: Any;
  uv: Any;
  /** The vertex's normal (the window's lean over the bake's): built only where it is read. */
  shapeN: () => Any;
}

/**
 * `HORIZON_RING_VERTEX` as nodes: an instance `a` (a node's corner, its level and, for a skirt, its side) and a patch or
 * skirt vertex `p`, over the ring's uniforms and the ground's frame. The ring's own draw writes its answer into the
 * varyings; `horizonSelfTestGpu` runs this very function into a float target and holds it to `horizonMath.ts`, so the
 * test reads the composition the ring draws and not only its parts.
 */
export function ringVertexN(r: RingNodes, frame: Any, a: Any, p: Any): RingVertex {
  const gL = a.z;
  const gQ = exp2(gL).mul(N.quad);
  const side = a.w;
  const P = float(N.patch);
  const skirt = side.greaterThan(0.5);
  const gI = select(skirt, select(side.lessThan(1.5), p.x, select(side.lessThan(2.5), P, select(side.lessThan(3.5), p.x, float(0)))), p.x);
  const gJ = select(skirt, select(side.lessThan(1.5), float(0), select(side.lessThan(2.5), p.x, select(side.lessThan(3.5), P, p.x))), p.z);
  const hang = select(skirt.and(p.y.greaterThan(1.5)), float(1), float(0));
  const gVx = a.x.add(gI.mul(gQ));
  const gVz = a.y.add(gJ.mul(gQ));
  const gH0 = bakeHeightN(r, frame.x.sub(gVx), gVz.add(frame.y));
  const dx = gVx.sub(r.eye.x);
  const dz = gVz.sub(r.eye.z);
  const dy = gH0.sub(r.eye.y);
  const gD = ringLevelOfN(sqrt(dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz))), r.morph.x, r.morph.y, r.shape, r.shapeAt.w);
  const gE = ringEdgeLevelN(ringEdgeDistanceN(gVx, gVz, r.square), r.morph.z, r.morph.y);
  const gW = min(min(gD, gE), r.morph.w);
  const mx0 = ringMorphN(gVx, r.grid.x, gW, gL);
  const mz0 = ringMorphN(gVz, r.grid.y, gW, gL);
  const k = ringReachN(mx0.sub(r.eye.x), mz0.sub(r.eye.z), r.eye.w);
  const gMx = r.eye.x.add(mx0.sub(r.eye.x).mul(k));
  const gMz = r.eye.z.add(mz0.sub(r.eye.z).mul(k));
  const edge = ringEdgeDistanceN(gMx, gMz, r.square);
  const raw = vec2(frame.x.sub(gMx), gMz.add(frame.y));
  const hs = ringHeightAtN(r, raw.x, raw.y);
  const gH = hs.x.sub(ringDropN(edge, r.drop.x, r.drop.y, r.drop.z)).sub(hang.mul(r.drop.w));
  return {
    pos: vec3(gMx, gH, gMz),
    raw,
    edge,
    dist: length(vec2(gMx.sub(r.eye.x), gMz.sub(r.eye.z))),
    level: gL,
    shape: hs.y,
    y: gH,
    uv: vec2(frame.z.mul(raw.x), raw.y).mul(0.25),
    shapeN: () => ringShapeNormalN(r, raw, max(r.shapeAt.x, exp2(floor(max(gW, gL))).mul(N.quad)), ringNormalAtN(r, raw, gL), hs.y),
  };
}

/** The varyings the ring's vertex stage writes and its fragment reads (`SHARED_PARS`'). */
const V = {
  shape: (): Any => varyingProperty('float', 'vRingShape'),
  shapeN: (): Any => varyingProperty('vec3', 'vRingShapeN'),
  y: (): Any => varyingProperty('float', 'vGroundY'),
  raw: (): Any => varyingProperty('vec2', 'vRingRaw'),
  world: (): Any => varyingProperty('vec3', 'vRingWorld'),
  edge: (): Any => varyingProperty('float', 'vRingEdge'),
  dist: (): Any => varyingProperty('float', 'vRingDist'),
  level: (): Any => varyingProperty('float', 'vRingLevel'),
  uv: (): Any => varyingProperty('vec2', 'vGroundUV'),
};

/** `ringSky`: the dome's colour in a direction (`DOME_COLOUR_GLSL`), its gradients at their top level. */
function ringSkyN(r: RingNodes, d: Any): Any {
  const up = clamp(d.y, 0, 0.999);
  const at = vec2(r.dome.x, up);
  const g1 = select(r.dome.y.greaterThan(0.5), r.gradient.sample(at).level(0).rgb, r.clear);
  const g2 = select(r.dome.z.greaterThan(0.5), r.gradient2.sample(at).level(0).rgb, r.clear);
  const col = mix(g1, g2, r.dome.w);
  return mix(r.horizonFog, col, smoothstep(-0.03, 0, d.y));
}

/**
 * The rings on WebGPU over the one session's uniforms (`RingSession`): the tile program's uniforms by reference for the
 * near composition, as `injectRing` hands them its program.
 */
export function ringNode(u: RingUniforms, ground: GroundTileUniforms, opts: { tri?: boolean } = {}): MeshStandardNodeMaterial {
  const tri = opts.tri ?? GROUND_TRI_WANTED;
  const r = ringNodes(u);
  const g = groundNodes(ground);
  const m = new MeshStandardNodeMaterial() as Any;
  m.name = 'gpu: the far rings';
  m.roughness = 1;
  m.metalness = 0;
  GROUND_GPU_STATS.rings++;
  const v = {
    shape: V.shape(),
    shapeN: V.shapeN(),
    y: V.y(),
    raw: V.raw(),
    world: V.world(),
    edge: V.edge(),
    dist: V.dist(),
    level: V.level(),
    uv: V.uv(),
  };
  // Pass 1, wave 5: the ring's place last frame, for the motion output (`motion.ts`): the same vertex worked over last frame's
  // eye, square, morph, drop, lattices, shape window and ground frame (each a copy rolled once a frame), its pictures as they
  // stand. Built only where the motion output is.
  motionPrevious(m, () => ringVertexN(ringPrevious(r, u), previousOr(ground.uGroundFrame, g.frame), attribute('aRing', 'vec4'), positionGeometry).pos);
  // The vertex (`HORIZON_RING_VERTEX`): an instance is a node's corner, its level and, for a skirt, its side.
  m.positionNode = Fn(() => {
    const o = ringVertexN(r, g.frame, attribute('aRing', 'vec4'), positionGeometry);
    v.raw.assign(o.raw);
    v.world.assign(o.pos);
    v.edge.assign(o.edge);
    v.dist.assign(o.dist);
    v.level.assign(o.level);
    v.shape.assign(o.shape);
    v.y.assign(o.y);
    v.uv.assign(o.uv);
    v.shapeN.assign(o.shapeN());
    return o.pos;
  })();
  const bump = P.bump();
  const albedo = P.albedo();
  const flat = P.flat();
  const ringAlbedo = property('vec3', 'gRingAlbedo');
  const near = property('float', 'gRingNear');
  const count = property('float', 'gRingCount');
  const rdx = property('vec2', 'gRingDx');
  const rdy = property('vec2', 'gRingDy');
  // Every derivative the colour and the normal read, and the flat face (three's `normalFlat`, a cross of two derivatives,
  // the ring having no normal attribute), are taken once at the top of the colour stage, where the whole quad runs, as the
  // WebGL program takes them at the top of `main()`. A `select` of three's nodes is an `if`, and a derivative inside one is
  // undefined wherever the quad's lanes part (a silhouette's helper lanes do): read there, the face came out a zero vector,
  // and its normalised NaN drew a dashed black line along every ridge outside the fine extent.
  const face = property('vec3', 'gRingFaceW');
  const uvDx = property('vec2', 'gRingUvDx');
  const uvDy = property('vec2', 'gRingUvDy');
  const yd = property('vec2', 'gRingYd');
  // The ground's own lean at the fragment in the world's frame (`ringBaseNormal`): the baked normal by the place's own
  // derivatives inside the fine extent, the face's past it.
  const baseNormal = (raw: Any): Any => {
    const f = raw.sub(r.fine.xy).div(r.fine.z);
    const inside = f.x.greaterThanEqual(0).and(f.y.greaterThanEqual(0)).and(f.x.lessThanEqual(r.sizes.x.sub(1))).and(f.y.lessThanEqual(r.sizes.y.sub(1)));
    const kk = vec2(1).div(r.sizes.xy.mul(r.fine.z));
    const baked = fineNormal(r.fineN.sample(f.add(0.5).div(r.sizes.xy)).grad(rdx.mul(kk), rdy.mul(kk)).rg);
    return select(inside, baked, face);
  };
  // The ground's lean before the near composition's bump (`FRAGMENT_NORMAL`'s first two lines).
  const leanW = (): Any => {
    const b = baseNormal(v.raw);
    return select(v.shape.greaterThan(0), normalize(mix(b, normalize(v.shapeN), v.shape)), b);
  };
  // The colour (`FRAGMENT_TOP` and `FRAGMENT_MAP`).
  m.colorNode = Fn(() => {
    GROUND_GPU_STATS.builds.rings++;
    rdx.assign(dFdx(v.raw));
    rdy.assign(dFdy(v.raw));
    face.assign(normalWorldGeometry);
    uvDx.assign(dFdx(v.uv));
    uvDy.assign(dFdy(v.uv));
    yd.assign(vec2(dFdx(v.y), dFdy(v.y)));
    const tileDx = rdx.mul(0.25);
    const tileDy = rdy.mul(0.25);
    bump.assign(vec4(0.5, 0.5, 1, 0));
    albedo.assign(vec3(1));
    count.assign(0);
    const wd = r.look.w.mul(float(1).sub(smoothstep(r.look.y.sub(r.look.z), r.look.y, v.dist))).toVar();
    // `ringWindowAt`: the composition window and the tint window at the raw place.
    const raw = v.raw;
    const tx = floor(raw.x.mul(0.25));
    const tz = floor(raw.y.mul(0.25));
    const rx = tx.sub(r.win.x);
    const rz = tz.sub(r.win.y);
    const cx = raw.x.sub(r.colour.x).div(r.colour.z);
    const cz = raw.y.sub(r.colour.y).div(r.colour.z);
    const rcx = floor(cx).sub(r.winC.x);
    const rcz = floor(cz).sub(r.winC.y);
    const inWin = rx.greaterThanEqual(0).and(rz.greaterThanEqual(0)).and(rx.lessThan(r.win.z)).and(rz.lessThan(r.win.z)).and(rcx.greaterThanEqual(0)).and(rcz.greaterThanEqual(0)).and(rcx.add(1).lessThan(r.win.w)).and(rcz.add(1).lessThan(r.win.w));
    const w = r.window.load(ivec2(int(mod(tx, r.win.z)), int(mod(tz, r.win.z))));
    const has = w.w.notEqual(uint(0));
    const gIn = wd.greaterThan(0).and(inWin).and(has);
    If(gIn.not(), () => {
      wd.assign(0);
    });
    If(wd.lessThan(1), () => {
      // `ringAlbedoAt`: the fine cells inside their extent, the coarse past it, each with its mips by the place's derivatives.
      const f = raw.sub(r.colour.xy).div(r.colour.z);
      const fine = f.x.greaterThanEqual(-0.5).and(f.y.greaterThanEqual(-0.5)).and(f.x.lessThanEqual(r.colourN.x.sub(0.5))).and(f.y.lessThanEqual(r.colourN.y.sub(0.5)));
      If(fine, () => {
        const kk = vec2(1).div(r.colourN.xy.mul(r.colour.z));
        ringAlbedo.assign(r.albedo.sample(f.add(0.5).div(r.colourN.xy)).grad(rdx.mul(kk), rdy.mul(kk)).rgb.mul(N.albedoScale));
      }).Else(() => {
        const c = raw.sub(r.coarse.xy).div(r.coarse.z);
        const kc = vec2(1).div(r.coarse.z.mul(r.sizes.zw));
        ringAlbedo.assign(r.coarseAlbedo.sample(c.add(0.5).div(r.sizes.zw)).grad(rdx.mul(kc), rdy.mul(kc)).rgb.mul(N.albedoScale));
      });
    });
    If(gIn, () => {
      const layers = vec4(float(bitAnd(w.x, uint(255))), float(shiftRight(w.x, uint(8))), float(bitAnd(w.y, uint(255))), float(shiftRight(w.y, uint(8))));
      const blend = vec4(float(bitAnd(w.z, uint(31))), float(bitAnd(shiftRight(w.z, uint(5)), uint(31))), float(bitAnd(shiftRight(w.z, uint(10)), uint(31))), 0);
      const tile = vec2(raw.x.mul(0.25).sub(tx), raw.y.mul(0.25).sub(tz));
      const tintUv = vec2(mod(cx, r.win.w).add(0.5).div(r.win.w), mod(cz, r.win.w).add(0.5).div(r.win.w));
      const tint = groundTintOf(r.tintWin.sample(tintUv).level(0).rgb, g.tint, g.tintRef);
      count.assign(float(w.w));
      const t = tri ? groundTriSetup(g, v.uv, uvDx, uvDy, v.y, yd, leanW()) : null;
      const c = composeTile(g, v.uv, layers, blend, tile, uvDx, uvDy, tileDx, tileDy, t);
      albedo.assign(c.colour.rgb.mul(groundDecode(tint)));
      ringAlbedo.assign(select(wd.lessThan(1), mix(ringAlbedo, albedo, wd), albedo));
      bump.assign(vec4(mix(vec3(0.5, 0.5, 1), c.bump.xyz, wd), c.bump.a.mul(wd)));
    });
    near.assign(wd);
    flat.assign(bump.a.mul(g.shine.y));
    return vec4(ringAlbedo, 1);
  })();
  m.roughnessNode = clamp(float(1).sub(bump.a.mul(g.shine.x)), N.floors.rough, 1);
  m.metalnessNode = float(0);
  // `FRAGMENT_NORMAL`: the ground's lean, and where the near composition is drawn the tile program's `TILE_NORMAL` over it.
  const normalW = (): Any => {
    const base = leanW();
    return select(near.greaterThan(0), tileNormalW(g, bump, base), base);
  };
  m.normalNode = normalize(toView(normalW()));
  const back = live(() => GPU_LOOK.groundDiffuseBack);
  m.setupLightingModel = function (this: Any) {
    return new GroundLightingModel(flat, back);
  };
  const ownLighting = m.setupLighting;
  m.setupLighting = function (this: Any, builder: Any) {
    const lit = ownLighting.call(this, builder);
    return select(g.cloud.x.greaterThan(0.5), lit.mul(groundCloudShade(g, lit, v.uv)), lit);
  };
  // After the fog: the fog's cheap path (`FRAGMENT_TOP`'s), the horizon fade (`FRAGMENT_FADE`) and the views (`FRAGMENT_VIEW`).
  const fogColour = uniform(new THREE.Color()).setGroup(renderGroup).onRenderUpdate((f: Any) => (f.scene?.fog?.color as THREE.Color | undefined) ?? FOG_NONE);
  const fogDensity = uniform(0).setGroup(renderGroup).onRenderUpdate((f: Any) => (f.scene?.fog?.isFogExp2 === true ? (f.scene.fog.density as number) : 0));
  const hasFog = uniform(0).setGroup(renderGroup).onRenderUpdate((f: Any) => (f.scene?.fog ? 1 : 0));
  const ownOutput = m.setupOutput;
  m.setupOutput = function (this: Any, builder: Any, out: Any) {
    const done = ownOutput.call(this, builder, out);
    const dir = normalize(v.world.sub(cameraPosition));
    const gF = smoothstep(r.eye.w.mul(float(1).sub(r.fade.x)), r.eye.w, v.dist);
    const to = select(r.fade.z.lessThan(0.5), ringSkyN(r, dir), select(hasFog.greaterThan(0.5), fogColour, r.horizonFog));
    const faded = select(r.fade.y.greaterThan(0.5).and(r.fade.z.lessThan(1.5)), vec4(mix(done.rgb, to, gF), done.a), done);
    const depth = positionView.z.negate();
    const fog = float(1).sub(exp(fogDensity.mul(fogDensity).mul(depth).mul(depth).negate()));
    const cheapSky = select(r.fade.y.greaterThan(0.5).and(r.fade.z.lessThan(0.5)), mix(fogColour, ringSkyN(r, dir), gF), fogColour);
    const cheap = fogDensity.greaterThan(0).and(fog.greaterThan(r.look.x)).and(r.fade.w.lessThan(0.5));
    const shaded = select(cheap, vec4(cheapSky, 1), faded);
    const lvl = v.level;
    const view = select(
      r.fade.w.lessThan(1.5),
      vec4(lvl.mul(0.37).add(0.1).fract(), lvl.mul(0.61).add(0.5).fract(), lvl.mul(0.13).add(0.8).fract(), 1),
      select(
        r.fade.w.lessThan(2.5),
        vec4(ringAlbedo, 1),
        select(
          r.fade.w.lessThan(3.5),
          vec4(normalW().mul(0.5).add(0.5), 1),
          select(
            r.fade.w.lessThan(4.5),
            vec4(clamp(v.edge.div(512), 0, 1), clamp(v.edge.negate().div(64), 0, 1), 0.2, 1),
            select(r.fade.w.lessThan(5.5), vec4(select(near.greaterThan(0), albedo, ringAlbedo.mul(0.35)), 1), vec4(near, select(count.greaterThan(0), float(1), float(0)), count.mul(0.25), 1)),
          ),
        ),
      ),
    );
    return select(r.fade.w.greaterThan(0.5), asShown(view), shaded);
  };
  return m as MeshStandardNodeMaterial;
}

/**
 * The programs' views as WebGL shows them. WebGL writes a view's colour after the tone mapping and the colour space
 * (`TILE_VIEW`, `FRAGMENT_VIEW`), so the console's view shows its numbers as they are; WebGPU draws the world into the
 * game's own scene target and tone-maps and encodes it after every material, so a view drawn there is carried back through
 * three's ACES fit (the leaf card's own inverse, `acesInverseNode`) and the sRGB curve first, and shows the same. The self
 * test's own draws (into targets nothing tone-maps after) carry nothing: `groundSelfTestGpu` holds `GROUND_VIEW_CARRY.on`
 * false round them. Read once a render.
 *
 * Carried only where three's own output pass tone-maps what is drawn (the frame-buffer target the canvas is drawn
 * through, `isPostProcessingRenderTarget`), which is WebGL's picture with its effects off. Into the effects chain's scene
 * target (step 6) nothing is carried: WebGL draws these programs into its own chain's target as they are, and its output
 * pass tone-maps them once after, as three's output pass does here after the chain's last pass.
 */
export const GROUND_VIEW_CARRY = { on: true };
/** Into three's frame-buffer target, which its output pass tone-maps after every material (the inline output off). */
const shownAfterFB = (f: Any): boolean => GROUND_VIEW_CARRY.on && f.renderer?.getRenderTarget?.()?.isPostProcessingRenderTarget === true;
/** And straight onto the canvas with the inline output on (step 6, `inlineOutput.ts`), which tone-maps the material's own output. */
const shownAfter = (f: Any): boolean => shownAfterFB(f) || (GROUND_VIEW_CARRY.on && drawsInline(f));
const viewAces = uniform(0).setGroup(renderGroup).onRenderUpdate((f: Any) => (shownAfter(f) && f.renderer?.toneMapping === THREE.ACESFilmicToneMapping ? 1 : 0));
const viewSrgb = uniform(0).setGroup(renderGroup).onRenderUpdate((f: Any) => (shownAfter(f) && f.renderer?.outputColorSpace === THREE.SRGBColorSpace ? 1 : 0));
const viewExposure = uniform(1).setGroup(renderGroup).onRenderUpdate((f: Any) => f.renderer?.toneMappingExposure ?? 1);
export function asShown(view: Any): Any {
  const lin = select(viewSrgb.greaterThan(0.5), toLinearNode(clamp(view.rgb, 0, 1)), view.rgb);
  return vec4(select(viewAces.greaterThan(0.5), acesInverseNode(lin).div(max(viewExposure, 1e-4)), lin), view.a);
}
const fbAces = uniform(0).setGroup(renderGroup).onRenderUpdate((f: Any) => (shownAfterFB(f) && f.renderer?.toneMapping === THREE.ACESFilmicToneMapping ? 1 : 0));
const fbSrgb = uniform(0).setGroup(renderGroup).onRenderUpdate((f: Any) => (shownAfterFB(f) && f.renderer?.outputColorSpace === THREE.SRGBColorSpace ? 1 : 0));
/**
 * A program WebGL writes wholly as the canvas's own value, with no chunk (the marks, the blades, the debug view; its material
 * `swgRawOut`, which the inline output never touches): carried back only into three's frame-buffer target, the one place
 * three tone-maps after it; straight onto the canvas under the inline output it is written as it is, as WebGL writes it.
 */
export function asShownFB(view: Any): Any {
  const lin = select(fbSrgb.greaterThan(0.5), toLinearNode(clamp(view.rgb, 0, 1)), view.rgb);
  return vec4(select(fbAces.greaterThan(0.5), acesInverseNode(lin).div(max(viewExposure, 1e-4)), lin), view.a);
}
/** The fog colour read while a scene has none (the fade then takes the horizon's own). */
const FOG_NONE = new THREE.Color(0, 0, 0);
