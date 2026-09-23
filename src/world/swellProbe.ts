// A way to settle by measurement whether the CPU's swell and the card's are the same sea.
//
// `swellMath.ts` claims to run the water's own vertex arithmetic. Nothing in the game checks that
// claim against the card: the node test pins the numbers in the GLSL's text, which catches a
// constant moving, and it cannot catch a driver, a precision or a uniform-plumbing difference. This
// file reads the answer straight off the card at a point the caller names, using **the water
// shader's own text** (`WAVES_GLSL`, the same string the material compiles) and **the live uniform
// objects of the material in play**, so nothing about the sea is restated here.
//
// It is deliberately **not wired**. Nothing in the game calls it and nothing imports it, for three
// reasons: the first call compiles a program and makes a render target, the read-back is a GPU sync
// that stalls the frame, and neither belongs anywhere near a frame the owner is timing. `notes.md`
// beside this wave has the one line that wires it to `__debug` when it is wanted.
//
// What it writes, in one 1x1 float pixel:
//
//   r  the shader's `gerstner(...).y` at **scale 1** -- the height is linear in the scale, so one
//      reading answers every scale and the caller applies its own `uWaveHeight` or `swellFade`;
//   g  `waterDepth(p)` as the shader's own depth window reads it, which is the one input the CPU
//      cannot know (it is a texture the card fills), and 100 where the window has no verdict;
//   b  `phaseWarp(p)` in radians -- the part `swellMath` deliberately leaves out, so the owner can
//      see the whole of the gap rather than infer it.
//
// The gap between the card's height and the mirror's is then the warp's doing and nothing else, and
// the probe reports both so that can be read rather than argued.
//
// **This file has never been executed.** Nothing imports it, the node test beside it only reads its
// text (a node script can make no WebGL context), and there is no hidden-tab path that reaches it,
// so the first time it runs will be the first time the owner wires it. Three things in it are
// therefore unproven and are where to look if it throws or answers nonsense on that first run: the
// vertex stage compiles `waterDepth`, which samples a texture -- legal in the water's own vertex
// program, which calls it, and so expected to be legal here, where it is only declared; the
// read-back wants a float colour buffer, and a card that refuses one is caught and answers null,
// but a card that quietly hands back zeros would read as `gpu` 0 rather than as a refusal; and the
// uniform record is spread into a `ShaderMaterial`, which shares the live uniform objects on
// purpose, so a uniform three adds of its own would collide by name rather than by accident.
import * as THREE from 'three';
import { FX_CAMERA, createFxQuad } from '../core/fx/pass.ts';
import { WAVES_GLSL, type WaterMaterial } from './water.ts';
import { swellHeight } from './swellMath.ts';

/**
 * What one probe reading found. All heights are metres over the mean surface.
 *
 * Every call answers a **record of its own**, so two readings may be held and subtracted. (It was a
 * shared one, which made `probeSwell(a) - probeSwell(b)` silently zero; a probe that stalls the card
 * on every call has no business saving an object.)
 */
export interface SwellProbeReading {
  /** The card's own height at the point, at the scale asked for. */
  gpu: number;
  /** `swellMath`'s height at the same point, clock and scale. */
  cpu: number;
  /** `gpu - cpu`: what the phase warp and the card's arithmetic come to between them. */
  gap: number;
  /** Metres of water the shader's own depth window reads under the point; 100 means "no verdict". */
  depth: number;
  /** The shader's phase warp there, radians. The mirror leaves this out on purpose. */
  warp: number;
  /** The clock both sides were read at: the material's own `uTime`. */
  time: number;
  /** The scale both sides were read at. */
  scale: number;
}

const VERTEX = /* glsl */ `
  ${WAVES_GLSL}
  uniform float uProbeLevel;
  void main() {
    // waterDepth() reads the surface's own height out of this varying, exactly as the water's
    // vertex program writes it from the vertex it is displacing.
    vWaterLevel = uProbeLevel;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  ${WAVES_GLSL}
  uniform vec2 uProbePoint;
  void main() {
    vec3 disp; vec3 n; float crest;
    gerstner(uProbePoint, 1.0, disp, n, crest);
    gl_FragColor = vec4(disp.y, waterDepth(uProbePoint), phaseWarp(uProbePoint), 1.0);
  }
`;

let target: THREE.WebGLRenderTarget | null = null;
let material: THREE.ShaderMaterial | null = null;
let quad: THREE.Mesh | null = null;
/** The material the kit was built for: another one has its own uniform objects, so the kit is rebuilt. */
let builtFor: WaterMaterial | null = null;
const pixel = new Float32Array(4);
const point = new THREE.Vector2();

function build(water: WaterMaterial): void {
  dropProgram();
  target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, samples: 0 });
  target.texture.name = 'swell.probe';
  material = new THREE.ShaderMaterial({
    // The live uniform objects, not copies: the probe reads whatever the water is running on now.
    uniforms: { ...water.userData.uniforms, uProbePoint: { value: point }, uProbeLevel: { value: 0 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  quad = createFxQuad(material);
  builtFor = water;
}

function dropProgram(): void {
  target?.dispose();
  material?.dispose();
  target = null;
  material = null;
  quad = null;
  builtFor = null;
}

/**
 * Read the card's swell at a world xz and compare it with the mirror's.
 *
 * `water` is a lit water material in play (`WaterBodies` keeps them; the near sea's is the one with
 * a wave height of 1). `surfaceLevel` is the height of that body's surface in metres, which the
 * shader's depth reader needs and the caller knows. `scale` is what the caller would hand
 * `swellHeight`: `uWaveHeight` for the authored sea, `swellFade(...)` for the drawn scale.
 *
 * The first call for a material compiles one program and makes one 1x1 target; every call after it
 * costs one draw and one `readRenderTargetPixels`, which is a full GPU sync. Never on a timed frame.
 *
 * Answers null when the card refuses the read-back (no float colour buffer): the caller then knows
 * it measured nothing, which is not the same as measuring agreement. A reading of its own is made
 * per call, so two of them may be held side by side and compared.
 */
export function probeSwell(renderer: THREE.WebGLRenderer, water: WaterMaterial, x: number, z: number, surfaceLevel: number, scale = 1): SwellProbeReading | null {
  if (builtFor !== water || !target || !material || !quad) build(water);
  if (!target || !material || !quad) return null;
  point.set(x, z);
  (material.uniforms.uProbeLevel as { value: number }).value = surfaceLevel;
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(quad, FX_CAMERA);
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
  } catch {
    renderer.setRenderTarget(previous);
    return null;
  }
  renderer.setRenderTarget(previous);
  if (!Number.isFinite(pixel[0])) return null;
  const uniforms = water.userData.uniforms;
  const time = (uniforms.uTime?.value as number | undefined) ?? 0;
  const waves = uniforms.uWaves?.value as THREE.Vector4[] | undefined;
  const omega = uniforms.uOmega?.value as number[] | undefined;
  const gpu = pixel[0] * scale;
  const cpu = waves && omega ? swellHeight(waves, omega, x, z, time, scale) : 0;
  return { gpu, cpu, gap: gpu - cpu, depth: pixel[1], warp: pixel[2], time, scale };
}

/** Give the probe's program and target back. Safe to call when nothing was ever probed. */
export function disposeSwellProbe(): void {
  dropProgram();
}
