// The eye's buffer on the card and every reader of it (the GPU port's pass 2, wave 2; the design's 2.8): one small storage
// buffer the eye's passes write (`eyeGpu.ts`) and the main thread writes only while the card does not adapt (`eyeRun.ts`),
// never read back in a frame. Everything that must follow the eye reads it on the card:
//   - the chain's output (`gpuChain.ts`'s `outputGraph`): the picture times the eye's exposure, before three's tone mapping
//     at the player's own compensation;
//   - the bloom's bright pass: its threshold compared with the exposed luminance, so what blooms is what is bright on the
//     screen, at noon and at night alike;
//   - the colour grade: its pivot (display mid-grey, `0.18` over the renderer's exposure) over the eye's exposure too, so a
//     grade dial means the same at noon and at night;
//   - the emissive things (`eyeGlowPart` on every classic material's node copy, and step 5's programs through `finish`):
//     sabers, lamps, bolts, lit windows and every unlit surface drawn times the glow factor, so at the glow dial's 1 they
//     look as they did at an exposure of 1.
//
// Nothing here is loaded on the WebGL path (it imports three's WebGPU build); the runtime hands it to the game.
import * as THREE from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { EYE_FIXED, EYE_FLOATS, EYE_SLOT } from './eyeMath.ts';
import { EYE_OUT } from './eyeRun.ts';
import { toCanvasNode } from '../../core/gpu/inlineOutput.ts';
import type { LookPart } from '../../core/gpu/looks.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { float, materialColor, materialEmissive, renderGroup, select, storage, vec3, vec4 } = TSL as Any;

/** The eye's own numbers (`EYE_SLOT`'s places) and four more the console's check reads: the stops eased from, the seconds and the snap the last frame used, spare. */
export const EYE_BUFFER_FLOATS = EYE_FLOATS + 4;
export const EYE_SLOT_MORE = { prev: EYE_FLOATS, dt: EYE_FLOATS + 1, snap: EYE_FLOATS + 2 } as const;

/** The buffer, made once a session: an exposure of 1, no glow compensation, nought stops, the key's brightness measured. */
export const EYE_ATTR: Any = (() => {
  const a = new Float32Array(EYE_BUFFER_FLOATS);
  a[EYE_SLOT.exposure] = 1;
  a[EYE_SLOT.glow] = 1;
  a[EYE_SLOT.mean] = Math.log2(EYE_FIXED.key);
  return new StorageBufferAttribute(a, 1);
})();

/**
 * Every reader's node over the buffer: read only, in the shared render group, so the buffer's binding is looked at once a
 * render (an upload the main thread asked for reaches every reader in the next render) and a still mesh's draw reads the
 * frame's value as a moving one's does.
 */
const READ: Any = storage(EYE_ATTR, 'float', EYE_BUFFER_FLOATS).toReadOnly().setGroup(renderGroup);

/** The eye's exposure on the card (the output's, the bloom's and the grade's factor). */
export function eyeExposureNode(): Any {
  return READ.element(EYE_SLOT.exposure);
}

/**
 * The emissive things' factor on the card. `raw` is for a program WebGL writes as the canvas's own value (the marks, the
 * blades: `swgRawOut`) and for a material that skips tone mapping (`toneMapped` false), either of which straight onto the
 * canvas (Effects off) takes no exposure at all and so no compensation.
 */
export function eyeGlowNode(raw = false): Any {
  const g = READ.element(EYE_SLOT.glow);
  return raw ? select(toCanvasNode().greaterThan(0.5), float(1), g) : g;
}

/** A colour (vec4 node) with its light times the glow factor, its alpha kept. */
export function withGlow(c: Any, raw = false): Any {
  const v = vec4(c);
  return vec4(v.rgb.mul(eyeGlowNode(raw)), v.a);
}

/**
 * The main thread's answer written into the buffer (the card does not adapt this frame: the sun's height, or today's): the
 * exposure, the glow and the stops of `EYE_OUT` (read from the kept record, never handed across the call), marked for upload.
 * Allocates nothing.
 */
export function writeEyeCpu(): void {
  const a = EYE_ATTR.array as Float32Array;
  const o = EYE_OUT;
  a[EYE_SLOT.exposure] = o.exposure;
  a[EYE_SLOT.glow] = o.glow;
  a[EYE_SLOT.stops] = o.stops;
  a[EYE_SLOT.target] = o.stops;
  EYE_ATTR.needsUpdate = true;
}

/** Counts for the console: node copies the glow part changed, lit and unlit, and of them those that skip tone mapping. */
export const EYE_GLOW_STATS = { lit: 0, unlit: 0, untoned: 0 };

/** Whether a classic material is one of three's lit ones with an emissive colour (its glow is the emissive term). */
function litEmissive(m: Any): boolean {
  return m.isMeshStandardMaterial === true || m.isMeshLambertMaterial === true || m.isMeshPhongMaterial === true || m.isMeshToonMaterial === true;
}

/** Whether a classic material is unlit (its whole colour is its own light: a bolt, a glow, a sprite, a line, a point). */
function unlit(m: Any): boolean {
  return m.isMeshBasicMaterial === true || m.isSpriteMaterial === true || m.isPointsMaterial === true || m.isLineBasicMaterial === true;
}

/**
 * The look part of the emissive compensation: a lit material's emissive term (three's `materialEmissive`, its colour times
 * its intensity times its map) times the glow factor, and an unlit one's colour (three's `materialColor`, or whatever an
 * earlier part made of it) likewise. Decided by the material's kind and its `toneMapped`, both in three's key, so every
 * material of one key takes the same graph; a black emissive times the factor is black.
 *
 * The wave's fixer: a material that skips tone mapping (`toneMapped` false: a bolt, a hologram, an engine trail or glow) takes
 * no exposure when drawn straight onto the canvas (Effects off: the inline output gives it the sRGB curve alone, where three's
 * exposure is applied only by the tone mapping), so there it takes no compensation either, as the marks and the blades do
 * (`eyeGlowNode(true)`); under a chain the output's exposure follows it as it follows everything, and the glow stands.
 */
export const eyeGlowPart: LookPart = {
  name: 'eyeGlow',
  applies: (m: Any) => litEmissive(m) || unlit(m),
  apply(node: Any, m: Any) {
    const raw = m.toneMapped === false;
    if (litEmissive(m)) {
      const base = node.emissiveNode ?? materialEmissive;
      node.emissiveNode = vec3(base).mul(eyeGlowNode(raw));
      EYE_GLOW_STATS.lit++;
    } else {
      const base = node.colorNode ?? materialColor;
      node.colorNode = withGlow(base, raw);
      EYE_GLOW_STATS.unlit++;
    }
    if (raw) EYE_GLOW_STATS.untoned++;
  },
};

/** The buffer read back (the console's, never a frame's): its numbers as floats. */
export async function readEyeBuffer(renderer: Any): Promise<Float32Array> {
  const buf = (await renderer.getArrayBufferAsync(EYE_ATTR)) as ArrayBuffer;
  return new Float32Array(buf.slice(0));
}

/** Whether three can read a storage buffer back (a renderer of this build: `getArrayBufferAsync`). */
export function canReadBack(renderer: THREE.WebGLRenderer): boolean {
  return typeof (renderer as Any).getArrayBufferAsync === 'function';
}
