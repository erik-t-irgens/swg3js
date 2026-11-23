// The screen's dither (the GPU port's pass 2, wave 4b, maker B): a dark sky is a smooth ramp a few levels of 255 deep, and
// the canvas's eight bits round it into flat rings a level apart. A noise of a level either way, added to the picture's
// display value just before the canvas rounds it, spreads each ring's edge into grain the eye does not see as a step.
//
// Triangular (two interleaved-gradient noises summed, each its own offset, both moving a frame), so the rounding's error is
// independent of the picture and its mean is nought: the picture's mean light is the same with the dither as without. Its
// dial and the numbers' model the tests run are `ditherTune.ts`.
// WebGPU only: the chain's last pass draws it onto the canvas (`gpuChain.ts`'s `outputGraph`); WebGL keeps its picture.
import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { DITHER_FIXED, DITHER_TUNE } from './ditherTune.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { float, frameId, interleavedGradientNoise, renderGroup, screenCoordinate, select, uniform, vec2, vec3, vec4 } = TSL as Any;

/** The dial into the shader, kept (a field written once a render, never a value handed across a call). */
const AMOUNT = new THREE.Vector2(1, 0);

/** Once a render: the dial into its uniform. */
function readAmount(): Any {
  AMOUNT.x = DITHER_TUNE.amount;
  return AMOUNT;
}

let AMOUNT_NODE: Any = null;

/**
 * A display value (sRGB, 0 to 1, the picture as the canvas will round it) and its dither: `c` plus a triangular noise of
 * `amount` levels either way, where `on` (a node, 1 while the draw goes onto the canvas); else `c` as it came. The alpha kept.
 */
export function ditheredOut(c: Any, on: Any): Any {
  AMOUNT_NODE ??= uniform(AMOUNT).setGroup(renderGroup).onRenderUpdate(readAmount);
  const v = vec4(c);
  // Two of Jimenez's interleaved-gradient noises at offsets of their own, moved a frame by his golden step.
  const step = float(frameId.mod(DITHER_FIXED.frames)).mul(DITHER_FIXED.frameStep);
  const p = vec2(screenCoordinate.xy).add(vec2(step, step));
  const n1 = interleavedGradientNoise(p);
  const n2 = interleavedGradientNoise(p.add(vec2(DITHER_FIXED.second[0], DITHER_FIXED.second[1])));
  const n = n1.add(n2).sub(1).mul(AMOUNT_NODE.x).div(255);
  const d = vec4(v.rgb.add(vec3(n)), v.a);
  return select(on.greaterThan(0.5), d, v);
}
