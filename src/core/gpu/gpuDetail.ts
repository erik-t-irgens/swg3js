// The detail map on WebGPU (the GPU port's step 4, item 3). On WebGL it is a hook that multiplies the colour three read
// from the material's picture by the detail texture sampled at the second coordinate set (`src/world/detailMap.ts`); here
// it is the node copy's `colorNode`: the material's own colour (three's `materialColor`, picture and all) times the
// detail's colour at `uv(1)`, before three multiplies in the vertex colours and lights it. So it multiplies the diffuse
// and never the specular, the client's line.
//
// Which texture: the one `userData.swgDetail` names in the surfaces' registry (`surfaces.detailTexture`, the very lookup
// `detailWrap` hands the WebGL injection), read once an object off the material three draws, since materials whose cache
// keys are equal share one node builder state while their detail textures differ.
//
// Which copies: a material the detail's wrap went on (`DETAIL_HOOK` in its hook chain, which keys its program under
// `detail`), and only over a geometry carrying the second set (`uv1`, in the geometry's own part of the key): a material
// naming a detail map with no second set under it gets nothing, as the converter writes it on WebGL. The console's look
// switch (`__debug.gpu({ look: { detail: false } })`) selects the plain colour as a uniform, the bit of it, building
// nothing; `localStorage['swg.gpu.detail'] = '0'` leaves the part out at load.

import * as THREE from 'three';
import { NodeUpdateType, TextureNode } from 'three/webgpu';
import { materialColor, renderGroup, select, uniform, uv, vec4 } from 'three/tsl';
import { DETAIL_HOOK } from '../../world/detailMap.ts';
import { chainHas } from '../../world/compileHooks.ts';
import { surfaces } from '../../world/surfaces.ts';
import { GPU_LOOKS, LOOKS_AT_LOAD, type LookPart } from './looks.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The texture a material's `userData.swgDetail` names: `detailWrap`'s own lookup. */
export function detailTextureOf(material: Any): THREE.Texture | null {
  return surfaces.detailTexture(material?.userData?.swgDetail as string | undefined);
}

/** What a detail sampler holds before its first object is drawn (never sampled: every copy is built over a material that names one). */
let placeholder: THREE.Texture | null = null;
function placeholderTexture(): THREE.Texture {
  if (!placeholder) {
    placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    placeholder.colorSpace = THREE.SRGBColorSpace;
    placeholder.needsUpdate = true;
  }
  return placeholder;
}

/** The detail texture at the second coordinate set, its picture taken off the material three draws, once an object. */
export class DetailTextureNode extends (TextureNode as Any) {
  constructor() {
    super(placeholderTexture(), uv(1));
    this.updateType = NodeUpdateType.OBJECT;
    this.isDetailTextureNode = true;
  }

  setup(builder: Any): Any {
    const t = detailTextureOf(builder.material);
    if (t) this.value = t;
    return super.setup(builder);
  }

  update(frame: Any): void {
    const t = detailTextureOf(frame.material);
    if (t && this.value !== t) this.value = t;
  }
}

/** The look switch, read once a render. */
let on: Any = null;
export function detailSwitch(): Any {
  return (on ??= uniform(1).setGroup(renderGroup).onRenderUpdate(() => (GPU_LOOKS.detail ? 1 : 0)));
}

/** The colour node over a geometry with a second set: the material's colour, its rgb times the detail's, its alpha its own. */
export function detailColorNode(base: Any = materialColor): Any {
  const c = vec4(base);
  const d = new DetailTextureNode() as Any;
  return select(detailSwitch().greaterThan(0.5), vec4(c.rgb.mul(d.rgb), c.a), c);
}

/** Counts for the console: copies given a detail, and copies over a geometry with no second set (given nothing). */
export const DETAIL_GPU_STATS = { detailed: 0, noSecondSet: 0 };

/**
 * The look part (`looks.ts`): its colour node is decided per build, where the geometry is known; a geometry with no second
 * set keeps three's own colour.
 */
export const detailPart: LookPart = {
  name: 'detail',
  applies(m: Any): boolean {
    // The wrap went on only where the registry named a texture (`detailWrap`), so the chain alone says so.
    return LOOKS_AT_LOAD.detail && chainHas(m.onBeforeCompile, DETAIL_HOOK);
  },
  apply(node: Any): void {
    const own = node.setupDiffuseColor;
    const base = node.colorNode ?? null;
    node.setupDiffuseColor = function (this: Any, builder: Any) {
      if (builder.geometry?.hasAttribute?.('uv1')) {
        this.colorNode = detailColorNode(base ?? materialColor);
        DETAIL_GPU_STATS.detailed++;
      } else {
        this.colorNode = base;
        DETAIL_GPU_STATS.noSecondSet++;
      }
      return own.call(this, builder);
    };
  },
};
