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

/** fxLuma: Rec. 709 luminance of linear colour. */
export const FX_LUMA = /* glsl */ `
  float fxLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/**
 * Half-resolution textures brought back to a full-resolution pixel (needs FX_VIEW_POS).
 *
 * fxHalfTaps: the four half-resolution texels around a full-resolution pixel and their bilinear
 * weights. The half-resolution depth (`LinearDepthHalf`) samples half texel i at full texel 2i + 1,
 * so its centre sits at full coordinate 2i + 1.5.
 *
 * fxDepthWeights: the four taps' bilinear weights times how close each tap's depth is to this
 * pixel's, normalised. Cheaper than the plane weights, which need the normals: for what has no
 * surface of its own to keep to (the room's haze).
 *
 * fxPlaneWeight: 1 when this pixel's surface point lies on the tap's plane (the tap's view position
 * and view normal), falling to 0 at `tolerance` metres off it; 0 for a sky texel.
 *
 * fxBilateralUpsample: a half-resolution texture at a full-resolution pixel, blending only taps whose
 * surface this pixel lies on; `fallback` when none does (a feature thinner than a half texel).
 */
export const FX_BILATERAL_UPSAMPLE = /* glsl */ `
  void fxHalfTaps(vec2 fragCoord, ivec2 halfSize, out ivec2 t00, out ivec2 t10, out ivec2 t01, out ivec2 t11, out vec4 w) {
    vec2 h = (fragCoord - 1.5) * 0.5;
    ivec2 b = ivec2(floor(h));
    vec2 f = h - vec2(b);
    ivec2 hi = halfSize - 1;
    t00 = clamp(b, ivec2(0), hi); t10 = clamp(b + ivec2(1, 0), ivec2(0), hi);
    t01 = clamp(b + ivec2(0, 1), ivec2(0), hi); t11 = clamp(b + ivec2(1, 1), ivec2(0), hi);
    w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  }
  vec4 fxDepthWeights(highp sampler2D tLinearHalf, ivec2 t00, ivec2 t10, ivec2 t01, ivec2 t11, vec4 w, float fullZ) {
    vec4 z = vec4(texelFetch(tLinearHalf, t00, 0).r, texelFetch(tLinearHalf, t10, 0).r, texelFetch(tLinearHalf, t01, 0).r, texelFetch(tLinearHalf, t11, 0).r);
    vec4 ww = w / (0.02 + abs(z - fullZ) / max(fullZ, 0.05)) + 1e-5;
    return ww / (ww.x + ww.y + ww.z + ww.w);
  }
  float fxPlaneWeight(highp sampler2D tLinearHalf, sampler2D tNormalHalf, ivec2 t, vec3 pFull, vec2 fullSize, vec2 tanHalfFov, float tolerance) {
    vec4 ne = texelFetch(tNormalHalf, t, 0);
    if (ne.a < 0.5) return 0.0;
    vec3 n = ne.xyz * 2.0 - 1.0;
    vec3 p = fxViewPos((vec2(t) * 2.0 + 1.5) / fullSize, texelFetch(tLinearHalf, t, 0).r, tanHalfFov);
    return clamp(1.0 - abs(dot(n, pFull - p)) / (tolerance * max(length(n), 0.5)), 0.0, 1.0);
  }
  vec4 fxBilateralUpsample(sampler2D tHalf, highp sampler2D tLinearHalf, sampler2D tNormalHalf, vec2 fragCoord, vec2 fullSize, vec2 tanHalfFov, float zFull, vec4 fallback) {
    ivec2 t00, t10, t01, t11;
    vec4 w;
    fxHalfTaps(fragCoord, textureSize(tHalf, 0), t00, t10, t01, t11, w);
    vec3 p = fxViewPos(fragCoord / fullSize, zFull, tanHalfFov);
    // upsampleTolerance in ssaoMath.ts: 1% of the depth plus 3 cm.
    float tolerance = zFull * 0.01 + 0.03;
    w.x *= fxPlaneWeight(tLinearHalf, tNormalHalf, t00, p, fullSize, tanHalfFov, tolerance);
    w.y *= fxPlaneWeight(tLinearHalf, tNormalHalf, t10, p, fullSize, tanHalfFov, tolerance);
    w.z *= fxPlaneWeight(tLinearHalf, tNormalHalf, t01, p, fullSize, tanHalfFov, tolerance);
    w.w *= fxPlaneWeight(tLinearHalf, tNormalHalf, t11, p, fullSize, tanHalfFov, tolerance);
    float sum = w.x + w.y + w.z + w.w;
    if (sum < 1e-3) return fallback;
    return (texelFetch(tHalf, t00, 0) * w.x + texelFetch(tHalf, t10, 0) * w.y + texelFetch(tHalf, t01, 0) * w.z + texelFetch(tHalf, t11, 0) * w.w) / sum;
  }
`;
