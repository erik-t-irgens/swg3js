// The effects chain's own node graphs on WebGPU (the GPU port's step 6, items 1 to 3): the pass that zeroes the frame's
// pixels that are not numbers, the bloom (its bright pass, its ten blurs, its composite and its blend over the picture),
// the colour grade, and the output's copy onto three's frame-buffer target. Each is the WebGL pass's own text line for
// line, over that pass's very uniform objects (rule 2): the WebGL passes are made on WebGPU too (their `ShaderMaterial`s
// are never drawn there), the runner writes their uniforms exactly as it does on WebGL, and each graph here reads them
// once a render (`live`, `liveTexture`), a vector by reference (`ref`). Every number that is not a uniform is the mirror's
// own or the WebGL text's literal, gathered in `CHAIN_NUMBERS` and held to the text by `gpuChain.test.ts`.
//
// Three things about three 0.187's WebGPU decided the shape:
//   - **the full-screen triangle is the game's own** (`FX_TRIANGLE`'s place) with its v turned over, drawn through
//     `FX_CAMERA` as the WebGL passes draw theirs, never three's `QuadMesh`: a `QuadMesh` swaps its vertex node in only
//     for its own draw, so a warm-up's compile of it would build another program than the frame draws; and WebGPU keeps a
//     render target's first row at the top where WebGL keeps it at the bottom, which the v turned over answers;
//   - **the output is three's own**: the chain's last pass copies the picture into three's frame-buffer target (what the
//     canvas is drawn through with tone mapping on) and three's own output pass applies the ACES fit at the renderer's
//     exposure and the sRGB curve, the same arithmetic WebGL's `OutputPass` writes (`renderOutput`, its one program held
//     by three for the session); drawn straight onto the canvas with three's tone mapping switched off round the draw, a
//     warm-up could not build the program the frame draws (the canvas's colour space and sample count are read off the
//     renderer as it stands when the build runs, not as it stood for the draw);
//   - **a sample is taken at the top of the fragment**, assigned to a variable before any branch, since three writes a
//     `select` out as an `if` and a node out where it is first read (step 5's lesson).
//
// Nothing here is loaded on the WebGL path (`gpuOff.test.ts`). The passes that draw these are `gpuChainPasses.ts`.

import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { LUMA } from '../fx/gradeMath.ts';
import { liveTexture } from './gpuGround.ts';
import { eyeExposureNode } from '../../sky/exposure/eyeBuffer.ts';
import { PRE_FIXED, preNode } from '../../sky/exposure/preExpose.ts';
import { ditheredOut } from '../../sky/night/dither.ts';
import { toCanvasNode } from './inlineOutput.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, If, clamp, dot, float, floatBitsToUint, log2, max, min, mix, positionGeometry, pow, renderGroup, smoothstep, uint, uniform, uv, vec3, vec4 } = TSL as Any;

/**
 * Every number the graphs are built from that is not a uniform, each its WebGL text's own (`gpuChain.test.ts` reads the
 * GLSL out of `passes.ts`, `bloomHold.ts`, three's own shaders and `grade.ts` and holds these to its literals):
 *   - the sanitize's ceiling (`clamp(c.rgb, 0.0, 256.0)`) and the exponent field a value that is not a number fills
 *     (WGSL has no `isnan` or `isinf`, and a compiler may assume neither happens: the bits are read instead);
 *   - the bloom composite's `3.0`, the radius's mirror at `1.2` and the bright pass's luminance weights (three's
 *     `luminance()` written as `WebGLProgram` writes it, the working space's coefficients to four places);
 *   - the grade's floors and its zone's numbers.
 */
export const CHAIN_NUMBERS = {
  sanitize: { ceiling: 256.0, exponent: 0x7f800000 },
  bloom: { composite: 3.0, mirror: 1.2 },
  grade: { luma: LUMA, lumaFloor: 1e-7, logFloor: 1e-5, zoneShift: 2.0, zoneSpan: 4.0, smoothA: 3.0, smoothB: 2.0, shadowFrom: 32.0, shadowTo: 4.0, highFrom: 8.0, highTo: 32.0, satFloor: 1e-7 },
} as const;

/** Three's GLSL `luminance()` as `WebGLProgram` writes it: the working space's coefficients, each to four places. */
export function bloomLuminance(): [number, number, number] {
  const v = new THREE.Vector3();
  THREE.ColorManagement.getLuminanceCoefficients(v);
  return [Number(v.x.toFixed(4)), Number(v.y.toFixed(4)), Number(v.z.toFixed(4))];
}

// ---------------------------------------------------------------- the uniforms, read off the WebGL pass's own objects

/** A number a WebGL uniform holds, read once a render. */
export const live = (u: { value: unknown }): Any => uniform(Number(u.value) || 0).setGroup(renderGroup).onRenderUpdate(() => u.value as number);
/** A vector or colour a WebGL uniform holds, by reference (three reads its fields once a render). */
export const ref = (u: { value: unknown }): Any => uniform(u.value as never).setGroup(renderGroup);
/**
 * A vector a WebGL uniform holds whose object the WebGL pass replaces (the blur's `invSize` is a new `Vector2` at every
 * resize, its `direction` the pass's X or Y as it draws): read once a render through the uniform, never held.
 */
export const liveVec2 = (u: { value: unknown }): Any => uniform(new THREE.Vector2()).setGroup(renderGroup).onRenderUpdate(() => u.value as THREE.Vector2);
export const liveVec3 = (read: () => THREE.Vector3): Any => uniform(new THREE.Vector3()).setGroup(renderGroup).onRenderUpdate(read);

/** A linear-filtered half-float texel of its own, a slot's picture until the runner binds one (each slot its own: one texture held by two slots of a graph is one binding). */
function fallback(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** A texture a WebGL uniform holds through `{ value }`, which the runner rebinds as it draws (step 5's `LiveTexture`). */
export const tex = (u: { value: THREE.Texture | null }): Any => liveTexture(u as { value: THREE.Texture | null }, fallback());

// ---------------------------------------------------------------- the triangle and the material

/**
 * The game's full-screen triangle (`FX_TRIANGLE`'s corners) with its v turned over: a WebGPU render target keeps its first
 * row at the top of the picture, so the pixel at the bottom of the screen reads the bottom of the picture as on WebGL.
 */
export const GPU_FX_TRIANGLE = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, -1, 0, 1, 2, 1], 2));
  return g;
})();

/** A chain pass's node material: unlit, no fog, no depth, the triangle placed in clip space whatever the camera. */
export function chainMaterial(name: string): NodeMaterial {
  const m = new NodeMaterial();
  m.name = name;
  m.depthTest = false;
  m.depthWrite = false;
  (m as Any).lights = false;
  m.fog = false;
  m.toneMapped = false;
  m.vertexNode = vec4(positionGeometry.xy, 0, 1);
  // Pass 2, wave 2's fixer: a chain pass draws into no scene target (`postfx.ts`'s R1), so its output is never stored
  // pre-exposed (`src/sky/exposure/preExpose.ts`); every chain graph is the same key whatever this says (its own fragment).
  m.userData.swgChain = true;
  return m;
}

/**
 * The scene's own units from the picture's (pass 2, wave 2's fixer: the scene is stored times `pre`, last frame's eye
 * exposure, `src/sky/exposure/preExpose.ts`): the factor a number in the scene's units is multiplied by to stand in the
 * picture's, 1 under SWG's sky and before the eye's computes have landed.
 */
export function storedOf(): Any {
  return max(preNode(), PRE_FIXED.least);
}

/** A mesh on the triangle, never culled, marked as the chain's. */
export function chainMesh(m: NodeMaterial): THREE.Mesh {
  const mesh = new THREE.Mesh(GPU_FX_TRIANGLE, m);
  mesh.frustumCulled = false;
  mesh.name = m.name;
  mesh.userData.gpuChain = true;
  return mesh;
}

/** What a graph's nodes are made of, built outside its fragment's function so the node test can hold them: the uniforms by the WebGL name each reads, the textures, and for a blur its weights and taps. */
export interface ChainParts {
  uniforms: Record<string, Any>;
  textures: Record<string, Any>;
  weights?: number[];
  taps?: number;
  luminance?: [number, number, number];
}

/** What a graph binds, said by the console and held by the node test (rule 4): its textures and samplers. */
export interface ChainGraph {
  material: NodeMaterial;
  mesh: THREE.Mesh;
  /** Pictures the graph samples (one binding each, however many taps). */
  textures: number;
  parts: ChainParts;
}

export const graph = (material: NodeMaterial, textures: number, parts: ChainParts): ChainGraph => ({ material, mesh: chainMesh(material), textures, parts });

// ---------------------------------------------------------------- the sanitize (`passes.ts`'s SANITIZE)

/** A value that is not a number or is infinite: its exponent field filled (f32, read off the bits). */
const notFinite = (x: Any): Any => floatBitsToUint(x).bitAnd(uint(CHAIN_NUMBERS.sanitize.exponent)).equal(uint(CHAIN_NUMBERS.sanitize.exponent));

export function sanitizeGraph(u: { tScene: { value: THREE.Texture | null } }): ChainGraph {
  const m = chainMaterial('fx.gpu.sanitize');
  const scene = tex(u.tScene);
  m.fragmentNode = Fn(() => {
    const c = vec4(scene.sample(uv())).toVar('swgSanC');
    If(notFinite(c.x).or(notFinite(c.y)).or(notFinite(c.z)).or(notFinite(c.w)), () => {
      c.assign(vec4(0, 0, 0, 1));
    });
    // Pass 2, wave 2's fixer: the ceiling is the scene's, stood in the picture's units (`storedOf`, 1 where nothing is pre-exposed).
    return vec4(clamp(c.rgb, vec3(0), vec3(storedOf().mul(CHAIN_NUMBERS.sanitize.ceiling))), 1);
  })();
  return graph(m, 1, { uniforms: {}, textures: { tScene: scene } });
}

// ---------------------------------------------------------------- the bloom (three's `UnrealBloomPass` with 0.185's blur, `bloomHold.ts`)

/** `LuminosityHighPassShader`: the bright parts, faded in over the smooth width above the threshold. */
export function brightGraph(bloom: UnrealBloomPass): ChainGraph {
  const u = (bloom as Any).highPassUniforms as Record<string, { value: Any }>;
  const m = chainMaterial('fx.gpu.bloom.bright');
  const input = tex(u.tDiffuse);
  const lum = bloomLuminance();
  const threshold = live(u.luminosityThreshold);
  const smoothWidth = live(u.smoothWidth);
  const defaultColor = ref(u.defaultColor);
  const defaultOpacity = live(u.defaultOpacity);
  m.fragmentNode = Fn(() => {
    const texel = vec4(input.sample(uv())).toVar('swgBrightT');
    // Pass 2, wave 2: the threshold against the luminance as the eye exposes it (`eyeBuffer.ts`; 1 where the eye does not
    // adapt), so what blooms is what is bright on the screen, at noon and at night alike; the picture stored pre-exposed
    // (the wave's fixer, `storedOf`), so the eye's exposure over the store's.
    const v = dot(texel.xyz, vec3(lum[0], lum[1], lum[2])).mul(eyeExposureNode().div(storedOf()));
    const outputColor = vec4(defaultColor, defaultOpacity);
    const alpha = smoothstep(threshold, threshold.add(smoothWidth), v);
    return mix(outputColor, texel, alpha);
  })();
  return graph(m, 1, { uniforms: { luminosityThreshold: threshold, smoothWidth, defaultColor, defaultOpacity }, textures: { tDiffuse: input }, luminance: lum });
}

/**
 * One level's blur in one direction (`bloomBlurMaterial185`): the centre and each tap a side at the level's own texel
 * along the direction, one fetch a tap at the Gaussian's own weights (the WebGL material's `gaussianCoefficients`, read
 * at build: they never move). The direction and the texel are the WebGL material's uniforms, read as it draws.
 */
export function blurGraph(blur: THREE.ShaderMaterial, name: string): ChainGraph {
  const u = blur.uniforms as Record<string, { value: Any }>;
  const m = chainMaterial(name);
  const input = tex(u.colorTexture);
  const coefficients = u.gaussianCoefficients.value as number[];
  const radius = Number((blur.defines as Record<string, unknown>).KERNEL_RADIUS);
  const invSize = liveVec2(u.invSize);
  const direction = liveVec2(u.direction);
  m.fragmentNode = Fn(() => {
    const at = uv();
    const step = direction.mul(invSize);
    const weightSum = float(coefficients[0]);
    const sum = vec3(input.sample(at).rgb.mul(weightSum)).toVar('swgBlurSum');
    for (let i = 1; i < radius; i++) {
      const off = step.mul(float(i));
      const a = input.sample(at.add(off)).rgb;
      const b = input.sample(at.sub(off)).rgb;
      sum.addAssign(a.add(b).mul(float(coefficients[i])));
    }
    return vec4(sum, 1);
  })();
  return graph(m, 1, { uniforms: { invSize, direction }, textures: { colorTexture: input }, weights: coefficients.slice(0, radius), taps: 2 * radius - 1 });
}

/** The composite of the five levels, each weighted by its factor moved toward its mirror by the radius, and tinted. */
export function compositeGraph(bloom: UnrealBloomPass): ChainGraph {
  const u = bloom.compositeMaterial.uniforms as Record<string, { value: Any }>;
  const m = chainMaterial('fx.gpu.bloom.composite');
  const levels = [tex(u.blurTexture1), tex(u.blurTexture2), tex(u.blurTexture3), tex(u.blurTexture4), tex(u.blurTexture5)];
  const strength = live(u.bloomStrength);
  const radius = live(u.bloomRadius);
  // A number out of a plain array handed back is a number made each render (step 6's allocation check): handed back only
  // when it moved, three keeping the one it has otherwise (its wrapper writes nothing for undefined).
  const factors = [0, 1, 2, 3, 4].map((i) =>
    uniform(0)
      .setGroup(renderGroup)
      .onRenderUpdate((_f: unknown, self: Any) => {
        const x = (u.bloomFactors.value as number[])[i];
        return self.value !== x ? x : undefined;
      }),
  );
  const tints = [0, 1, 2, 3, 4].map((i) => liveVec3(() => (u.bloomTintColors.value as THREE.Vector3[])[i]));
  const N = CHAIN_NUMBERS.bloom;
  m.fragmentNode = Fn(() => {
    const at = uv();
    // Every level sampled first, at the top (rule 3).
    const s = levels.map((t, i) => vec3(t.sample(at).rgb).toVar(`swgBloomL${i}`));
    const lerp = (f: Any): Any => mix(f, float(N.mirror).sub(f), radius);
    let total: Any = null;
    for (let i = 0; i < 5; i++) {
      const term = lerp(factors[i]).mul(tints[i]).mul(s[i]);
      total = total ? total.add(term) : term;
    }
    const b = vec3(total.mul(strength).mul(N.composite)).toVar('swgBloomB');
    const a = max(b.r, max(b.g, b.b));
    return vec4(b, a);
  })();
  const uniforms: Record<string, Any> = { bloomStrength: strength, bloomRadius: radius };
  factors.forEach((n, i) => (uniforms[`bloomFactors[${i}]`] = n));
  tints.forEach((n, i) => (uniforms[`bloomTintColors[${i}]`] = n));
  return graph(m, 5, { uniforms, textures: { blurTexture1: levels[0], blurTexture2: levels[1], blurTexture3: levels[2], blurTexture4: levels[3], blurTexture5: levels[4] } });
}

/** `CopyShader` blended additively over the picture, premultiplied (the WebGL blend material's own state). */
export function blendGraph(bloom: UnrealBloomPass): ChainGraph {
  const u = (bloom as Any).copyUniforms as Record<string, { value: Any }>;
  const m = chainMaterial('fx.gpu.bloom.blend');
  const input = tex(u.tDiffuse);
  const opacity = live(u.opacity);
  m.fragmentNode = Fn(() => vec4(input.sample(uv())).mul(opacity))();
  const b = bloom.blendMaterial;
  m.blending = b.blending;
  m.premultipliedAlpha = b.premultipliedAlpha;
  m.transparent = b.transparent;
  // WebGL's flag says only that the colour is premultiplied already (the factors One, One); a node material's also multiplies
  // its output by its alpha (`NodeMaterial.setupOutput`), which with the composite's alpha the largest channel squared every
  // bloom over one. The factors are kept, the multiply is not.
  (m as Any).setupPremultipliedAlpha = (_builder: unknown, outputNode: unknown): unknown => outputNode;
  return graph(m, 1, { uniforms: { opacity }, textures: { tDiffuse: input } });
}

/** Every graph of the bloom, in the order the WebGL pass draws them: the bright pass, each level's two blurs, the composite, the blend. */
export interface BloomGraphs {
  bright: ChainGraph;
  blurs: { h: ChainGraph; v: ChainGraph }[];
  composite: ChainGraph;
  blend: ChainGraph;
}

export function bloomGraphs(bloom: UnrealBloomPass): BloomGraphs {
  const blurs = bloom.separableBlurMaterials.map((b, i) => ({ h: blurGraph(b, `fx.gpu.bloom.blur${i}.h`), v: blurGraph(b, `fx.gpu.bloom.blur${i}.v`) }));
  return { bright: brightGraph(bloom), blurs, composite: compositeGraph(bloom), blend: blendGraph(bloom) };
}

/** The directions the WebGL pass blurs along, its own two vectors. */
export const BLUR_DIRECTIONS = { x: (UnrealBloomPass as Any).BlurDirectionX as THREE.Vector2, y: (UnrealBloomPass as Any).BlurDirectionY as THREE.Vector2 };

// ---------------------------------------------------------------- the colour grade (`grade.ts`'s COLOR_GRADE)

export interface GradeUniforms {
  tDiffuse: { value: THREE.Texture | null };
  uAmount: { value: number };
  uBalance: { value: THREE.Vector3 };
  uShadowTint: { value: THREE.Vector3 };
  uHighlightTint: { value: THREE.Vector3 };
  uSplit: { value: number };
  uSaturation: { value: number };
  uContrast: { value: number };
  uPivot: { value: number };
  uCompare: { value: number };
}

/** The grade's fragment, line for line: the white balance, the split toning, the saturation and the contrast, each back to the pixel's luma. */
export function gradeGraph(u: GradeUniforms): ChainGraph {
  const m = chainMaterial('fx.gpu.colorGrade');
  const input = tex(u.tDiffuse);
  const amount = live(u.uAmount);
  const balance = ref(u.uBalance);
  const shadowTint = ref(u.uShadowTint);
  const highlightTint = ref(u.uHighlightTint);
  const split = live(u.uSplit);
  const saturation = live(u.uSaturation);
  const contrast = live(u.uContrast);
  const pivot0 = live(u.uPivot);
  const compare = live(u.uCompare);
  // Pass 2, wave 2: display mid-grey in the picture's own units, the pivot (0.18 over the player's compensation) over the eye's
  // exposure too (`eyeBuffer.ts`), so the grade's contrast turns about the same grey on the screen at noon and at night; the
  // picture stored pre-exposed (the wave's fixer, `storedOf`), so times the store's.
  const pivot = pivot0.mul(storedOf()).div(max(eyeExposureNode(), 1e-8));
  const G = CHAIN_NUMBERS.grade;
  const LUMA3 = vec3(G.luma[0], G.luma[1], G.luma[2]);
  m.fragmentNode = Fn(() => {
    const at = uv();
    const c = vec3(input.sample(at).rgb).toVar('swgGradeC');
    const a = float(0).toVar('swgGradeA');
    If(at.x.lessThan(compare).not(), () => {
      a.assign(clamp(amount, 0, 1));
    });
    const l0 = float(dot(c, LUMA3)).toVar('swgGradeL0');
    If(a.greaterThan(0).and(l0.greaterThan(G.lumaFloor)), () => {
      // 1. white balance
      c.mulAssign(mix(vec3(1), balance, a));
      // 2. split toning by the original luma's zone, then back to that luma
      const t = clamp(log2(l0.add(G.logFloor)).sub(log2(pivot)).add(G.zoneShift).div(G.zoneSpan), 0, 1);
      const w = float(1).sub(t.mul(t).mul(float(G.smoothA).sub(t.mul(G.smoothB))));
      c.mulAssign(mix(vec3(1), mix(highlightTint, shadowTint, w), split.mul(a)));
      c.mulAssign(l0.div(max(dot(c, LUMA3), G.lumaFloor)));
      // 3. saturation: a raise scaled by how grey the pixel already is, a cut in full; no negative channel; back to that luma
      const mx = max(c.r, max(c.g, c.b));
      const mn = min(c.r, min(c.g, c.b));
      const s = float(mix(1, saturation, a)).toVar('swgGradeS');
      If(s.greaterThan(1), () => {
        s.assign(float(1).add(s.sub(1).mul(float(1).sub(mx.sub(mn).div(max(mx, G.satFloor))))));
      });
      c.assign(max(mix(vec3(l0), c, s), 0));
      c.mulAssign(l0.div(max(dot(c, LUMA3), G.lumaFloor)));
      // 4. contrast on log luma about the pivot, guarded below a thirty-second of it and above thirty-two times it
      const lc = pivot.mul(pow(l0.div(pivot), mix(1, contrast, a)));
      const g = smoothstep(pivot.div(G.shadowFrom), pivot.div(G.shadowTo), l0).mul(float(1).sub(smoothstep(pivot.mul(G.highFrom), pivot.mul(G.highTo), l0)));
      c.mulAssign(mix(l0, lc, g).div(l0));
    });
    return vec4(c, 1);
  })();
  return graph(m, 1, { uniforms: { uAmount: amount, uBalance: balance, uShadowTint: shadowTint, uHighlightTint: highlightTint, uSplit: split, uSaturation: saturation, uContrast: contrast, uPivot: pivot0, uCompare: compare }, textures: { tDiffuse: input } });
}

// ---------------------------------------------------------------- the output's copy (three's `OutputPass` reads `tDiffuse`)

// ---------------------------------------------------------------- the motion buffer's view (pass 1, wave 5: `motion.ts`)

/**
 * The motion buffer drawn in place of the picture for looking at (`__debug.gpu({ view: 'motion' })`): each pixel's motion in
 * pixels a frame (the buffer's normalised device coordinates times half the target's size) as red rightward and green upward
 * about mid grey, full at `pixels`, its brightness the reactive mark (half bright unmarked, full bright marked). Its values
 * are the display's own: carried through no tone mapping (`swgRawOut`).
 */
export function motionViewGraph(u: { tMotion: { value: THREE.Texture | null }; size: THREE.Vector2; pixels: { pixels: number } }): ChainGraph {
  const m = chainMaterial('fx.gpu.motionView');
  const input = tex(u.tMotion);
  const size = uniform(u.size).setGroup(renderGroup);
  const pixels = uniform(u.pixels.pixels).setGroup(renderGroup).onRenderUpdate(() => u.pixels.pixels);
  m.fragmentNode = Fn(() => {
    const s = vec4(input.sample(uv())).toVar('swgMotionS');
    const n = clamp(s.xy.mul(size).mul(0.5).div(max(pixels, 1e-3)), -1, 1);
    const lit = float(0.5).add(clamp(s.w, 0, 1).mul(0.5));
    return vec4(vec3(n.x.mul(0.5).add(0.5), n.y.mul(0.5).add(0.5), 0.5).mul(lit), 1);
  })();
  (m as Any).swgRawOut = true;
  return graph(m, 1, { uniforms: { size, pixels }, textures: { tMotion: input } });
}

/**
 * The picture copied into three's frame-buffer target (or straight onto the canvas under the inline output), whose tone
 * mapping and encoding follow at the renderer's exposure (the player's compensation); pass 2, wave 2: times the eye's
 * exposure first (`eyeBuffer.ts`; 1 where the eye does not adapt and under SWG's sky), over the factor the scene was stored
 * at (the wave's fixer, `src/sky/exposure/preExpose.ts`; 1 under SWG's sky).
 */
export function outputGraph(u: { tDiffuse: { value: THREE.Texture | null } }): ChainGraph {
  const m = chainMaterial('fx.gpu.output');
  const input = tex(u.tDiffuse);
  m.fragmentNode = Fn(() => {
    const c = vec4(input.sample(uv())).toVar('swgOutC');
    // The wave's fixer: the picture is stored times `pre` (`storedOf`), so the eye's exposure over it.
    return vec4(c.rgb.mul(eyeExposureNode().div(storedOf())), c.a);
  })();
  // Pass 2, wave 4b (maker B): the picture dithered as the canvas rounds it (`src/sky/night/dither.ts`), after three's own
  // output arithmetic (the ACES fit and the sRGB curve, the inline output's) and only onto the canvas: a dark sky's eight-bit
  // rings spread into grain. With the inline output off, three's own output pass follows and nothing is dithered.
  const own = m as unknown as { setupOutput(builder: unknown, out: unknown): unknown };
  own.setupOutput = function (this: unknown, builder: unknown, out: unknown): unknown {
    return ditheredOut((NodeMaterial.prototype as unknown as { setupOutput(b: unknown, o: unknown): unknown }).setupOutput.call(this, builder, out), toCanvasNode());
  };
  return graph(m, 1, { uniforms: {}, textures: { tDiffuse: input } });
}
