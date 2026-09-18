// The dust motes' shaders. Every mote is placed, lit and sized in the vertex shader from the room's
// frame (`RoomAir`): its drift tiles the room every few metres so the cloud stays put as the camera
// moves, it takes the room's ambient and parallel light and every live lamp, and it glints where it
// hangs in a doorway's sunbeam. The defines (MAX_SHAFTS, MAX_LAMPS, MAX_BOXES, MOTE_MIN_PX,
// MOTE_MAX_PX, MOTE_KERNEL) come from roomAirMath.ts, which the node test checks.

export const MOTES_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uSpan, uSize, uProjScale, uAlbedo, uShaftGain, uPhaseG;
uniform vec3 uCamRoom;
uniform int uBoxCount;
uniform vec3 uBoxMin[MAX_BOXES];
uniform vec3 uBoxMax[MAX_BOXES];
uniform int uShaftCount;
uniform mat4 uShaftToUnit[MAX_SHAFTS];
uniform vec4 uShaftSize[MAX_SHAFTS];
uniform vec4 uShaftLight[MAX_SHAFTS];
uniform vec3 uShaftBoxMin[MAX_SHAFTS];
uniform vec3 uShaftBoxMax[MAX_SHAFTS];
uniform vec3 uSunDirRoom;
uniform int uLampCount;
uniform vec4 uLampPos[MAX_LAMPS];
uniform vec4 uLampColor[MAX_LAMPS];
uniform vec3 uAmbient, uParallel;
varying vec3 vColor;

float band(float x, float e) { return smoothstep(-e, e, x) * smoothstep(-e, e, 1.0 - x); }
float boxFade(vec3 p, vec3 lo, vec3 hi) {
  vec3 a = smoothstep(lo, lo + 0.3, p) * (1.0 - smoothstep(hi - 0.3, hi, p));
  return a.x * a.y * a.z;
}

void main() {
  // Each mote wanders on its own and settles a little; the pattern tiles every uSpan metres, so it
  // stays put in the room as the camera moves, and the copy nearest the camera is the one drawn.
  vec3 vel = (aSeed.yzx - 0.5) * vec3(0.06, 0.03, 0.06) + vec3(0.0, -0.008, 0.0);
  vec3 wob = 0.08 * sin(uTime * (0.3 + 0.4 * aSeed.w) + aSeed.xyz * 40.0);
  vec3 p = aSeed.xyz * uSpan + vel * uTime + wob;
  vec3 rel = mod(p - uCamRoom + 0.5 * uSpan, uSpan) - 0.5 * uSpan;
  vec3 pos = uCamRoom + rel;
  float dist = length(rel);
  float a = smoothstep(0.2, 0.6, dist) * (1.0 - smoothstep(0.35 * uSpan, 0.5 * uSpan, dist));
  float inside = 0.0;
  for (int k = 0; k < MAX_BOXES; k++) {
    if (k >= uBoxCount) break;
    inside = max(inside, boxFade(pos, uBoxMin[k], uBoxMax[k]));
  }
  a *= inside;
  if (a < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColor = vec3(0.0); return; }

  vec3 light = uAmbient + 0.5 * uParallel;
  for (int j = 0; j < MAX_LAMPS; j++) {            // every live lamp, in sight or not
    if (j >= uLampCount) break;
    vec3 L = uLampPos[j].xyz - pos;
    float r = length(L), range = uLampPos[j].w;
    light += uLampColor[j].rgb / (r * r + 0.1) * (1.0 - smoothstep(0.6 * range, range, r));
  }
  // pos - uCamRoom is at least 0.2 m long wherever a is above 0, so this never normalises nothing.
  float cosT = dot(normalize(pos - uCamRoom), uSunDirRoom);
  float g2 = uPhaseG * uPhaseG;
  float phase = 0.3 + 0.7 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * uPhaseG * cosT, 1e-4), 1.5);
  for (int i = 0; i < MAX_SHAFTS; i++) {
    if (i >= uShaftCount) break;
    if (uShaftLight[i].a <= 0.0) continue;         // a freed slot: its size may be stale, never divide by it
    if (any(lessThan(pos, uShaftBoxMin[i])) || any(greaterThan(pos, uShaftBoxMax[i]))) continue;   // the haze's own clip
    vec3 u = (uShaftToUnit[i] * vec4(pos, 1.0)).xyz;
    vec4 sz = uShaftSize[i];
    float m = band(u.x, sz.w / sz.x) * band(u.y, sz.w / sz.y) * step(0.0, u.z) * step(u.z, 1.0);
    light += uShaftLight[i].rgb * m * phase * uShaftGain;
  }
  float sparkle = 0.6 + 0.4 * sin(uTime * (1.5 + 4.0 * aSeed.w) + aSeed.y * 60.0);
  vec3 c = light * uAlbedo * sparkle * a;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float pxTrue = uSize * (0.6 + 0.8 * aSeed.w) * uProjScale / max(-mv.z, 0.05);
  // Never drawn below MOTE_MIN_PX: smaller sprites flash by up to twenty times as they cross pixels.
  // A mote drawn wider than it is keeps its energy: the colour falls with the area it is spread over.
  float pxDrawn = clamp(pxTrue, MOTE_MIN_PX, MOTE_MAX_PX);
  float k = min(pxTrue / pxDrawn, 1.0);
  c *= k * k;
  // With the effects off there is no sanitize pass after this: a NaN here would reach the screen.
  vColor = (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : clamp(c, 0.0, 64.0);
  gl_PointSize = pxDrawn;
  gl_Position = projectionMatrix * mv;
}
`;

export const MOTES_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  // exp(-4 r2) with r2 = 4|c|^2: a Gaussian 0.18 of the sprite wide, 0.018 at the square's edge.
  // No discard: the kernel's drawn sum is within 4% of its integral wherever the mote sits.
  float w = exp(-MOTE_KERNEL * dot(c, c));
  gl_FragColor = vec4(vColor * w, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
