// The see-through layer (the GPU port's pass 2, wave 1; the design's 2.2): a third output of the effects' scene target under
// our sky, so the haze pass can haze a solid pixel at its own distance and leave what is drawn in front of it as it hazed
// itself (`airHazeMath.ts` says the rule; this is its graph and its blends).
//
// It rides the motion output's multi-output node (`motion.ts`'s `motionMrt`, which hands these in): the colour target's own
// entry (`fx.scene`, the name `PostFX` gives it) is taken here, since three merges the renderer's node over a material's own
// colour (`NodeMaterial.setup`'s `mrt({ [name]: output }).merge(rendererMRT)`); and the layer's (`see`). Both are worked out
// per build from the classic material three keys the draw on (`builder.material`) and from whether the target drawn into
// carries the layer: a target without it (SWG's sky, the motion off) draws the colour exactly as before. Each output's blend
// is read as three makes the pipeline (`patchMotion.ts` hands the material's kind in `PIPELINE_NOW.see`): the material's own
// for the colour, and for the layer the kind's rule (`SEE_BLENDS`). Both the kind and the material's blending are in three's
// pipeline key, so two draws three takes for one pipeline never want the layer blended two ways.
//
// Nothing here is loaded on the WebGL path.

import * as THREE from 'three';
import { BlendMode, Node } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { intoLayer, layerKindOf, timesAlpha, type SeeKind } from './airHazeMath.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { output, renderGroup, uniform, vec4 } = TSL as Any;

/** The layer's texture's name in the scene target (`gpuChainPasses.ts` names its third texture so). */
export const SEE_NAME = 'see';

/** What the layer has done, for `__debug.sky()` and the tests. */
export const SEE_STATS = { built: { solid: 0, over: 0, overPremultiplied: 0, add: 0, addPremultiplied: 0, keep: 0 } as Record<SeeKind, number>, targets: 0 };

/** Whether the target a build draws into carries the layer. */
export function buildsLayer(builder: Any): boolean {
  const t = builder?.renderer?.getRenderTarget?.();
  const tex = t?.textures as THREE.Texture[] | undefined;
  if (!tex) return false;
  for (let i = 0; i < tex.length; i++) if (tex[i].name === SEE_NAME) return true;
  return false;
}

/**
 * The sign a solid pixel writes into the layer's alpha: minus in a building's rooms pass (its proxy scene is marked
 * `userData.swgRoomsPass`, `passScenes.ts`), so the haze pass knows a room's solid pixel; plus everywhere else. In the shared
 * render group, written once a render call from the scene three draws.
 */
let ROOM_SIGN: Any = null;
function roomSign(): Any {
  if (!ROOM_SIGN) ROOM_SIGN = uniform(1).setGroup(renderGroup).onRenderUpdate((f: Any) => (f.scene?.userData?.swgRoomsPass === true ? -1 : 1));
  return ROOM_SIGN;
}

/** The colour target's own output: nought with the draw's alpha for a kind that goes into the layer, else the colour as ever. */
class SeeColourNode extends Node {
  static get type(): string {
    return 'SwgSeeColourNode';
  }
  constructor() {
    super('vec4');
  }
  setup(builder: Any): Any {
    if (!buildsLayer(builder)) return output;
    // Pass 3, wave 2 (maker B): a draw at infinity (`SKY_BEHIND`) keeps its colour, behind the clouds.
    const k = layerKindOf(builder.material);
    if (!intoLayer(k)) return output;
    return vec4(0, 0, 0, vec4(output).a);
  }
}

/** The layer's own output: a see-through kind's light, premultiplied, with its alpha; a solid's (0, 0, 0, ±1); else nothing. */
class SeeLayerNode extends Node {
  static get type(): string {
    return 'SwgSeeLayerNode';
  }
  constructor() {
    super('vec4');
  }
  setup(builder: Any): Any {
    const k = layerKindOf(builder.material);
    SEE_STATS.built[k]++;
    if (k === 'solid') return vec4(0, 0, 0, roomSign());
    if (!intoLayer(k)) return vec4(0, 0, 0, 0);
    const o = vec4(output);
    return vec4(timesAlpha(k) ? o.rgb.mul(o.a) : o.rgb, o.a);
  }
}

/** The multi-output entries the motion node takes in (`motionMrt`): the colour target's and the layer's. */
export function seeOutputs(colourName: string): Record<string, Any> {
  return { [colourName]: new SeeColourNode(), [SEE_NAME]: new SeeLayerNode() };
}

/** A blend of one rule for the layer's colour and one for its alpha. */
function blend(src: number, dst: number, srcA: number, dstA: number): Any {
  const b = new BlendMode(THREE.CustomBlending) as Any;
  b.blendSrc = src;
  b.blendDst = dst;
  b.blendEquation = THREE.AddEquation;
  b.blendSrcAlpha = srcA;
  b.blendDstAlpha = dstA;
  b.blendEquationAlpha = THREE.AddEquation;
  return b;
}

/**
 * The layer's blend by kind: over (its light plus what is there times one less its alpha; the alpha's size likewise), added
 * (its light plus what is there; the alpha kept), kept (nothing changes), and a solid's overwrite.
 */
export const SEE_BLENDS: Readonly<Record<SeeKind, Any>> = {
  solid: new BlendMode(THREE.NoBlending),
  over: blend(THREE.OneFactor, THREE.OneMinusSrcAlphaFactor, THREE.ZeroFactor, THREE.OneMinusSrcAlphaFactor),
  overPremultiplied: blend(THREE.OneFactor, THREE.OneMinusSrcAlphaFactor, THREE.ZeroFactor, THREE.OneMinusSrcAlphaFactor),
  add: blend(THREE.OneFactor, THREE.OneFactor, THREE.ZeroFactor, THREE.OneFactor),
  addPremultiplied: blend(THREE.OneFactor, THREE.OneFactor, THREE.ZeroFactor, THREE.OneFactor),
  keep: blend(THREE.ZeroFactor, THREE.OneFactor, THREE.ZeroFactor, THREE.OneFactor),
};

/** The layer's blend for the pipeline three is making now (the material's kind, handed in by the patch). */
export function seeBlendOf(kind: SeeKind): Any {
  return SEE_BLENDS[kind];
}

/** Each scene target's colour texture to its layer, for the haze pass. */
const layerOf = new WeakMap<object, THREE.Texture>();

/** A new chain's scene target made with the layer (`GpuChain.sceneTarget`): its third texture named for the node's output. */
export function markSeeTarget(t: THREE.RenderTarget): void {
  const s = t.textures[2];
  s.name = SEE_NAME;
  s.minFilter = THREE.NearestFilter;
  s.magFilter = THREE.NearestFilter;
  s.generateMipmaps = false;
  layerOf.set(t.texture, s);
  SEE_STATS.targets++;
}

/** The layer beside a scene target's colour texture, or null (no layer: SWG's sky, or the motion off). */
export function seeTextureOf(colour: THREE.Texture | null): THREE.Texture | null {
  return colour ? (layerOf.get(colour) ?? null) : null;
}
