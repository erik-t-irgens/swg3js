// Shader pieces more than one effect wants. One definition each, pasted into whichever shader
// needs it, so two passes can never disagree about what a depth sample means.
import { GLSL_OCT_DECODE, GLSL_OCT_ENCODE } from '../glslOct';

/**
 * The vertex shader for a full-screen draw. The quad in `pass.ts` is a single triangle that
 * overhangs the screen, so its uvs run past 1 at the corners that are never seen.
 */
export const FX_FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * fxViewZ: how far along the view axis a depth sample lies, in metres. The projection is the
 * ordinary perspective one, not reversed and not logarithmic.
 */
export const FX_LINEARIZE = /* glsl */ `
  float fxViewZ(float depth, float near, float far) {
    float ndcZ = depth * 2.0 - 1.0;
    return (2.0 * near * far) / (far + near - ndcZ * (far - near));
  }
`;

/**
 * fxViewPos: where a pixel is in the camera's own space, from its screen place and its distance
 * along the view axis. `tanHalfFov` is (tan(fov/2) x aspect, tan(fov/2)), which the frame context
 * carries as `tanHalfFov`.
 */
export const FX_VIEW_POS = /* glsl */ `
  vec3 fxViewPos(vec2 uv, float viewZ, vec2 tanHalfFov) {
    vec2 ndc = uv * 2.0 - 1.0;
    return vec3(ndc.x * tanHalfFov.x * viewZ, ndc.y * tanHalfFov.y * viewZ, -viewZ);
  }
`;

/** fxHash: the same speckle for the same pixel every frame, 0 to 1. */
export const FX_HASH = /* glsl */ `
  float fxHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

/**
 * fxPcg3d: a three-dimensional integer hash (Jarzynski and Olano). It needs GLSL ES 3.00, which is
 * what three compiles a ShaderMaterial as, and high-precision int, which is the default prefix. A
 * sine hash shows banded patterns at large screen coordinates on this driver; this one does not.
 */
export const FX_PCG3D = /* glsl */ `
  uvec3 fxPcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
  }
`;

/** fxOctEncode and fxOctDecode: a unit normal in two numbers, from the one copy the water material also writes with. */
export const FX_OCT = GLSL_OCT_ENCODE + GLSL_OCT_DECODE;

/** fxIgn: interleaved gradient noise, stable per pixel (no frame term: there is no temporal filter to hide it). */
export const FX_IGN = /* glsl */ `
  float fxIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

/** fxEdgeFade: 0 at the screen's border, 1 beyond `w` inside it. */
export const FX_EDGE_FADE = /* glsl */ `
  float fxEdgeFade(vec2 uv, float w) { return smoothstep(0.0, w, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y))); }
`;
