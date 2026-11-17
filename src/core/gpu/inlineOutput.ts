// The Effects-off picture on WebGPU drawn the way WebGL draws it (the GPU port's step 6, item 5): every material tone-mapped
// and encoded in its own output and summed on the canvas, where three's WebGPU draws every material linear into a
// frame-buffer target and tone-maps the whole after.
//
// Why: with the effects off WebGL draws straight onto the canvas, and each fragment of a material that includes three's
// `tonemapping_fragment` and `colorspace_fragment` (every built-in one; the game's particles, lava and tunnel) is turned
// into the canvas's own value before it is blended, so additive piles (a brazier's fire, sparks, glows) and blended smoke
// add up in display space; three's WebGPU adds them in linear light and tone-maps the sum, which reads far fainter (step
// 5's pairs; measured again here: a brazier's flames at night 255 against 206 in their brightest twentieth). Opaque
// surfaces are the same either way (the curve of one value is the curve of one value), so only what blends moves.
//
// How, all WebGPU-only and installed at boot before any material is built:
//   - three's renderer is told it needs no frame-buffer target while this is on (`needsFrameBufferTarget` on the renderer
//     itself, never on the prototype), so a draw onto the canvas goes straight onto the canvas (its eight-bit picture,
//     multisampled as the game asked, clamped at every blend as WebGL's is) and three's own output pass is never drawn;
//   - every node material's output takes three's own output arithmetic (its ACES fit at the renderer's exposure, then
//     the sRGB curve: `toneMapping`, `workingToColorSpace`, the very nodes three's output pass is made of) after its fog
//     and before its premultiplied alpha, exactly where WebGL's chunks stand, chosen once a render by a uniform: 1 only
//     while the draw goes onto the canvas, so the effects chain's scene target, the shadow maps and every capture are
//     drawn linear as they always were, and the chain's own last pass (its output's copy) takes it once, onto the canvas;
//   - a material WebGL does not tone-map (`toneMapped` false) takes the sRGB curve alone, and one WebGL writes as the
//     canvas's own value with no chunk at all (the marks, the blades, the debug view: `swgRawOut`) takes neither, and is
//     carried back through nothing (`asShownFB`): so the blue blade's glow is the colour WebGL writes, where carried back
//     through the ACES fit it drifted violet (step 5), whose inverse cannot reach a bright saturated colour.
//
// `localStorage['swg.gpu.inline'] = '0'` and a reload leaves it out (step 5's picture through three's frame-buffer target);
// `__debug.gpu({ inline: false })` moves it live (the canvas's pipelines are then built at their first draw). Nothing here
// is loaded on the WebGL path. Three's two methods it replaces or leans on are held to their 0.187 text by `gpuSsao.test.ts`.

import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import { renderGroup, select, uniform, vec4 } from 'three/tsl';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The switch (`on`, live) and what came of installing it at load. */
export const INLINE = { on: false, applied: false, why: 'not installed', materials: 0 };

/** Whether the render under way draws straight onto the canvas with the inline output on. */
export function drawsInline(f: Any): boolean {
  return INLINE.on && f?.renderer?.getRenderTarget?.() === null;
}

/** 1 while the render under way draws straight onto the canvas with the inline output on (read once a render). */
const toCanvas = uniform(0)
  .setGroup(renderGroup)
  .onRenderUpdate((f: Any) => (drawsInline(f) ? 1 : 0));

/** Three's own output arithmetic on one colour: its tone mapping (when the material takes it) and the colour space. */
export function inlineOut(out: Any, toneMapped: boolean, toneMapping: THREE.ToneMapping, colorSpace: string): Any {
  // Three's own nodes: the tone mapping keeps the alpha (a vec4 in, a vec4 out), as does the colour space.
  let c: Any = vec4(out);
  if (toneMapped && toneMapping !== THREE.NoToneMapping) c = c.toneMapping(toneMapping);
  if (colorSpace !== THREE.LinearSRGBColorSpace) c = c.workingToColorSpace(colorSpace);
  return select(toCanvas.greaterThan(0.5), vec4(c.rgb, out.a), out);
}

/**
 * Install at boot, on WebGPU alone, before any material is built. `on` is the at-load switch. Answers null when installed,
 * or why not in words.
 */
export function installInline(renderer: Any, on: boolean): string | null {
  INLINE.on = on;
  if (!on) {
    INLINE.why = "left out at load (localStorage['swg.gpu.inline'] = '0')";
    return INLINE.why;
  }
  let proto = Object.getPrototypeOf(renderer);
  let need: PropertyDescriptor | undefined;
  while (proto && !(need = Object.getOwnPropertyDescriptor(proto, 'needsFrameBufferTarget'))) proto = Object.getPrototypeOf(proto);
  const base = NodeMaterial.prototype as Any;
  if (!need?.get || typeof base.setupOutput !== 'function' || typeof base.setupFog !== 'function' || typeof base.setupPremultipliedAlpha !== 'function') {
    INLINE.on = false;
    INLINE.why = "three has no needsFrameBufferTarget getter or NodeMaterial.setupOutput as 0.187 wrote them: step 5's picture";
    return INLINE.why;
  }
  const getter = need.get;
  Object.defineProperty(renderer, 'needsFrameBufferTarget', {
    configurable: true,
    get(this: Any) {
      return INLINE.on ? false : getter.call(this);
    },
  });
  // NodeMaterial.setupOutput as three 0.187 writes it (the fog, then the premultiplied alpha), with the output's arithmetic
  // between the two, where WebGL's `tonemapping_fragment` and `colorspace_fragment` stand before its `premultiplied_alpha_fragment`.
  base.setupOutput = function (this: Any, builder: Any, outputNode: Any): Any {
    if (this.fog === true) outputNode = this.setupFog(builder, outputNode);
    if (this.swgRawOut !== true) {
      INLINE.materials++;
      outputNode = inlineOut(outputNode, this.toneMapped !== false, builder.renderer.toneMapping, builder.renderer.outputColorSpace);
    }
    if (this.premultipliedAlpha === true) outputNode = this.setupPremultipliedAlpha(builder, outputNode);
    return outputNode;
  };
  INLINE.applied = true;
  INLINE.why = '';
  return null;
}

/** What `__debug.gpu()` says of it. */
export function inlineReport(): Record<string, unknown> {
  return {
    on: INLINE.on,
    applied: INLINE.applied,
    ...(INLINE.why ? { why: INLINE.why } : {}),
    graphsTaken: INLINE.materials,
    does: "with the effects off, every material tone-mapped and encoded in its own output and summed on the canvas, as WebGL draws it (additive fire, sparks and glows, and blended smoke, add up in display space); with them on, only the chain's last pass is drawn onto the canvas, and takes the same arithmetic once",
    switch: "__debug.gpu({ inline: false }) live (the canvas's pipelines built at their first draw), or localStorage['swg.gpu.inline'] = '0' and a reload: three's frame-buffer target and output pass, step 5's picture",
  };
}
