// The output's dither on WebGPU (the sky and light fix round, maker E): one 8-bit step of noise added after the tone curve and
// the colour space, where the picture is about to be written into the canvas's eight bits, so a night sky's and a haze's
// gentle gradients round to a fine grain instead of steps. The owner's demo's own (`TONEMAP_WGSL`'s last line, `col +=
// (ign(fp.xy) - 0.5) / 255.0`): Jimenez's interleaved gradient noise of the pixel's place, the same pattern every frame. Its
// dial is `src/sky/exposure/ditherDial.ts`'s (the `exposure` set's Dither, 1 step to start).
//
// A small piece on its own, as the brief asks: wave 4b's maker B adds the night's dither in `src/sky/night/dither.ts` and the
// chain's output, and the lead keeps one of the two at the merge. Dropping this one is this file, `ditherDial.ts`, its one
// line in `gpuChainPasses.ts` (`withOutputDither`) and the console's `dither` line in `main.ts`.
//
// Only the chain's last pass straight onto the canvas under the inline output takes it (the inline output's own gate,
// `toCanvasNode`): a copy into three's frame-buffer target (the inline output left out at load) is tone-mapped after it by
// three's output pass, where a dither before the curve would be wrong, so there none is added. Nothing is allocated in a
// frame: the dial is a uniform read once a render, handed back only when it moved. Nothing here is loaded on the WebGL path.
import * as TSL from 'three/tsl';
import { IGN, OUTPUT_DITHER } from '../../sky/exposure/ditherDial.ts';
import { toCanvasNode } from './inlineOutput.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { dot, float, fract, renderGroup, screenCoordinate, select, uniform, vec2, vec4 } = TSL as Any;

const STEPS: Any = uniform(OUTPUT_DITHER.steps)
  .setGroup(renderGroup)
  .onRenderUpdate((_f: unknown, self: Any) => (self.value !== OUTPUT_DITHER.steps ? OUTPUT_DITHER.steps : undefined));

/** A colour already tone-mapped and encoded, with the dither added where it goes straight onto the canvas. */
export function ditherOut(out: Any): Any {
  const v = vec4(out);
  const n = fract(float(IGN.a).mul(fract(dot(screenCoordinate, vec2(IGN.x, IGN.y)))));
  const d = n.sub(0.5).mul(STEPS).div(255);
  return select(toCanvasNode().greaterThan(0.5), vec4(v.rgb.add(d), v.a), v);
}

/**
 * The chain's output material takes the dither after three's own output arithmetic: its `setupOutput` (the inline output's
 * tone curve and sRGB curve, put on the prototype at boot) and then the noise. Set once, as the pass is made, before the
 * material is first built.
 */
export function withOutputDither(m: Any): void {
  // The prototype's method as it stands when the graph is built (the boot's installs come first), never a copy taken now.
  const proto = Object.getPrototypeOf(m);
  m.setupOutput = function (this: Any, builder: Any, outputNode: Any): Any {
    return ditherOut(proto.setupOutput.call(this, builder, outputNode));
  };
  m.userData.swgDither = true;
}
