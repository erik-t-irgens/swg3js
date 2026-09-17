// Shader pieces more than one effect wants. One definition each, pasted into whichever shader
// needs it, so two passes can never disagree about what a depth sample means.

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
