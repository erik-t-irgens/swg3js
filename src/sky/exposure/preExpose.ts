// The scene stored pre-exposed (the GPU port's pass 2, wave 2, its fixer; the brief's "store and read what the exposure needs
// so a dark night is still readable once the floor goes"). The effects' scene target is half floats, whose smallest normal is
// 2^-14 and whose last subnormal is 2^-24: a moonlit night's sky in the scene's units is about 1e-7 (2^-23) and the ground
// under a canopy less, so the night the eye opens to 2^17 was stored as nought or as the last subnormals' two bits, and the
// edge smoothing's history (half floats too, a tenth of each new frame mixed in) lost every increment under a step. The
// review measured it: at Kachirho's night nine tenths of the eye's count sat in its lowest bin whatever the eye did, and the
// Naboo forest's ground broke into flat blotches with a pale halo trailing the player.
//
// So every draw into a scene target is stored times `pre`, last frame's eye exposure, and every reader of the scene's own
// units divides it back out:
//   - **the store**: every node material's output (`NodeMaterial.setupOutput`, wrapped once at boot after the inline output's
//     own) times `pre` where the render under way draws into a chain's scene target (a render-group gate read once a render),
//     held to `PRE_FIXED.cap`, so a bright thing over an opened eye is white rather than a half float's infinity (which the
//     sanitize would zero to black); the fog, the haze's own fog node and the premultiplied alpha come before it, so all of
//     a pixel's light is stored alike, and the see-through layer, which reads three's `output`, takes it with the colour;
//   - **the roll**: once a drawn frame with a chain, before the scene, a compute of one invocation (`eyeGpu.ts`'s kit) moves
//     `pre` into `preLast` and the eye's exposure into `pre`, all on the card (nothing read back): `pre` follows the eye a
//     frame behind, so the stored values stay near the display's own range at noon, in a lit room and on a moonlit night;
//   - **the readers** (the scene's units are what they hold their numbers in): the eye's quarter copy (its log2 less log2
//     `pre`), the edge smoothing (last frame's history times `pre / preLast`, stored a frame earlier), the haze pass (the air's
//     light added times `pre`, and its ceiling), the occlusion's apply (the lit ceiling and the fog colour times `pre`), the
//     sanitize's ceiling, the bloom's threshold and the grade's pivot (the exposure over `pre`), and the output (the picture
//     times the exposure over `pre`).
//
// The buffer is the card's own: made `[1, 1]` and written only by the roll, never by the main thread (the eye's own buffer is
// uploaded whole whenever the main thread answers, which would put back a stale `pre`). Under SWG's sky no roll runs and it
// stays `[1, 1]`, so the readers read the picture of before; and a material built once SWG's sky is read takes no part.
// Nothing here is loaded on the WebGL path.

import * as THREE from 'three';
import { NodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { SKY_AT_LOAD } from '../skyMode.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { float, max, min, renderGroup, select, storage, uniform, vec4 } = TSL as Any;

/**
 * What is not a dial:
 *   - `cap` 30000, the most a draw stores: a half float holds 65,504, so two such draws added (a glow over a lit surface)
 *     still hold; stored at the eye's own exposure a value of 16 is already white on the screen, and a noon sun disc, the
 *     brightest thing the scene draws, stores about 26,000 (its 36,000 in the scene's units times noon's 0.72);
 *   - `least` and `most`, the range `pre` is held to: the eye's own stops' (`EYE_FIXED.least` -12 to the floor's top of 24),
 *     so a value the eye never hands (a buffer not yet written, a nought) cannot zero or overflow the store.
 */
export const PRE_FIXED = { cap: 30000, least: 2 ** -12, most: 2 ** 24 } as const;

/** The buffer's two places: the factor this frame's scene is stored at, and last frame's. */
export const PRE_SLOT = { now: 0, last: 1 } as const;

/** The buffer, made once a session at `[1, 1]` (the scene stored as it always was) and written by the roll alone. */
export const PRE_ATTR: Any = new StorageBufferAttribute(new Float32Array([1, 1]), 1);

/** Every reader's node over it: read only, in the shared render group (the eye's buffer's way, `eyeBuffer.ts`). */
const READ: Any = storage(PRE_ATTR, 'float', 2).toReadOnly().setGroup(renderGroup);

/** The factor this frame's scene is stored at. */
export function preNode(): Any {
  return READ.element(PRE_SLOT.now);
}

/** Last frame's stored values (the edge smoothing's history) brought to this frame's: `pre / preLast`. */
export function preRatioNode(): Any {
  return READ.element(PRE_SLOT.now).div(max(READ.element(PRE_SLOT.last), PRE_FIXED.least));
}

/** The chains' scene targets (`GpuChain.sceneTarget` marks each as it is made). */
const SCENES = new WeakSet<object>();

export function markSceneTarget(t: THREE.RenderTarget): void {
  SCENES.add(t);
}

export function isSceneTarget(t: unknown): boolean {
  return t !== null && t !== undefined && SCENES.has(t as object);
}

/**
 * 1 while the render under way draws into a chain's scene target, read once a render: a capture, a product, the occlusion's
 * region, a shadow map, the canvas and every chain pass's own target store as they always did.
 */
const GATE: Any = uniform(0)
  .setGroup(renderGroup)
  .onRenderUpdate((f: Any) => (isSceneTarget(f?.renderer?.getRenderTarget?.()) ? 1 : 0));

/** A material's output stored pre-exposed where it draws into a scene target (its light times `pre`, held to the cap), else as it comes. */
export function preExposedOut(out: Any): Any {
  const v = vec4(out);
  const on = GATE.greaterThan(0.5);
  const c = v.rgb.mul(select(on, preNode(), float(1)));
  return vec4(select(on, min(c, float(PRE_FIXED.cap)), c), v.a);
}

/** What `__debug.exposure()` says of it. */
export const PRE_STATS = { installed: false, graphs: 0, left: 0, why: 'not installed' };

/**
 * Whether a material's graph takes the store: never a chain pass's own (`chainMaterial` marks them: they draw into no scene
 * target, rule R1 of `postfx.ts`), and nothing built once SWG's sky is read (its sky has no eye; a graph built before the sky
 * is read takes it, and stores at the buffer's `[1, 1]` under SWG's sky, which no roll moves).
 */
export function takesPre(m: Any): boolean {
  if (m?.userData?.swgChain === true) return false;
  return !(SKY_AT_LOAD.read && !SKY_AT_LOAD.ours);
}

/**
 * Installed at boot on WebGPU, after the inline output's own `setupOutput` and before any material is built: three's
 * `NodeMaterial.setupOutput` (as it stands then) followed by the store. A struct of outputs (the edge smoothing's resolves, the
 * haze's terms) is left as it is: those are chain passes' own.
 */
export function installPreExpose(): void {
  if (PRE_STATS.installed) return;
  const proto = NodeMaterial.prototype as Any;
  const base = proto.setupOutput;
  if (typeof base !== 'function') {
    PRE_STATS.why = 'three has no NodeMaterial.setupOutput: the scene is stored as it comes';
    return;
  }
  proto.setupOutput = function (this: Any, builder: Any, outputNode: Any): Any {
    const out = base.call(this, builder, outputNode);
    if (out?.isOutputStructNode === true || !takesPre(this)) {
      PRE_STATS.left++;
      return out;
    }
    PRE_STATS.graphs++;
    return preExposedOut(out);
  };
  PRE_STATS.installed = true;
  PRE_STATS.why = '';
}
