// Every GLSL string of the fourth wave's particles and rain (the design's §2.16), in one file the scanner reads as it reads
// `airShaders.ts` (`tools/swg/tests/glslScan.ts`): the kick-up pool's update and its two draws (the leaves cut and writing
// depth, the puffs, spray and fine streaks blended), the precipitation pool's update and its draw.
//
// **The state lives on the card** in float32 targets that ping-pong, one texel a particle, positions relative to a corner
// near the camera (the air window's for the kick-up pool, the rain's own anchor for the drops), so a slow drift moves at
// its own speed eight kilometres from the world's origin at any frame rate. A draw reads its particle by
// `texelFetch(state, ivec2(gl_InstanceID % W, row + gl_InstanceID / W), 0)` from an instanced quad with no instanced
// attribute: nothing is written into a vertex buffer a frame and nothing per particle reaches the main thread.
//
// **Every number is a uniform** (rule 10): the pools' sizes, the kinds' rows, every tune number; `SPAWN_MOST` and
// `KICK_KINDS` are loop bounds and array sizes only. Every output is made finite before it is written: a NaN in a
// position is a quad across the screen, and a NaN pixel a black box once the bloom spreads it.
//
// Pure strings, built from the field's own GLSL where they share it (`slabVelAt`, the tile program's tint, the leaf cards'
// curve and the grass's shadow lookup), never a copy.
import { GROUND_DECODE_GLSL, GROUND_TINT_GLSL } from '../terrainTextures.ts';
import { CARD_CURVE_PARS } from '../cardLight.ts';
import { GRASS_SHADOW_PARS } from '../grass.ts';
import { SLAB_VEL_GLSL, SRGB_GLSL } from './airShaders.ts';
import { CLASS_INDEX, KICK_KINDS, SPAWN_MOST } from './airSpawn.ts';
import { WIND7_GLSL } from '../windMath.ts';

/**
 * The shared hash and the colour packing: a 32-bit integer mix (`airHash` in `airSpawn.ts` is its mirror) and a colour
 * as three bytes of its `1/2.2` power in one float (`unpackColour`'s mirror).
 */
const KICK_COMMON = /* glsl */ `
uint airHash(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float airRand(uint x) { return float(airHash(x) >> 8u) * (1.0 / 16777216.0); }
vec3 airUnpackColour(float p) {
  // A packed colour is a whole number up to 2^24 - 1, exact in a float32; never p + 0.5, which a float32 rounds to the
  // next even number from 2^23 up, so white (2^24 - 1) came back 2^24 and drew black.
  int i = int(floor(p + 0.25));
  vec3 c = vec3(float((i >> 16) & 255), float((i >> 8) & 255), float(i & 255)) / 255.0;
  return pow(c, vec3(2.2));
}
float airPackColour(vec3 c) {
  ivec3 q = ivec3(floor(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)) * 255.0 + 0.5));
  return float((q.r << 16) | (q.g << 8) | q.b);
}
`;

/**
 * The lifts, the pull toward the air and the streak's length as scalar functions (`airParticleMath.ts`' `oroLift`,
 * `vortLift`, `pullShare` and `streakLength` are their mirrors; the tests run these lines as script): the orographic
 * lift over a fixed span, held to ±its most; the vortex lift past its threshold, held under its most; the share of the
 * way to the air's speed a frame takes, alike at any frame rate; a streak's speed over its trail, held between its least
 * and most.
 */
export const KICK_LIFT_GLSL = /* glsl */ `
uniform vec4 uLift;
uniform vec4 uLiftB;
float airOroLift(float vx, float vz, float gx, float gz) {
  float w = uLift.x * (vx * gx + vz * gz);
  return clamp(w, -uLift.z, uLift.z);
}
float airVortLift(float curl) {
  float a = abs(curl);
  float w = uLift.w * max(a - uLiftB.x, 0.0);
  return min(w, uLiftB.y);
}
float airPull(float dt, float tau) {
  return 1.0 - exp(-dt / max(tau, 1e-3));
}
`;

/**
 * The orographic lift at a window place `l` (uv) for the air (vx, vz), a window `size` metres across: the gradient of
 * the ground and the walls standing on it taken over the fixed span `uLift.y` in metres (four taps half the span either
 * side, whatever the air's cell), so no quality preset changes it (`oroLiftAt` its mirror; the tests run it over a wall
 * at every detail). Needs the shader's own `groundAt` and `wallTop` above it.
 */
export const KICK_ORO_GLSL = /* glsl */ `
float airOroAt(vec2 l, float vx, float vz, float size) {
  float span = max(uLift.y, 1e-3);
  float s = 0.5 * span / max(size, 1e-3);
  float gx = ((groundAt(vec2(l.x + s, l.y)) + wallTop(vec2(l.x + s, l.y))) - (groundAt(vec2(l.x - s, l.y)) + wallTop(vec2(l.x - s, l.y)))) / span;
  float gz = ((groundAt(vec2(l.x, l.y + s)) + wallTop(vec2(l.x, l.y + s))) - (groundAt(vec2(l.x, l.y - s)) + wallTop(vec2(l.x, l.y - s)))) / span;
  return airOroLift(vx, vz, gx, gz);
}
`;

export const KICK_STREAK_GLSL = /* glsl */ `
uniform vec4 uStreakD;
float airStreakLength(float speed) {
  return clamp(speed * uStreakD.x, uStreakD.y, uStreakD.z);
}
`;

/**
 * The kick-up pool's update (the design's §2.16), one draw over the whole pool a frame the field runs, three outputs:
 * position (relative to the air window's corner, the corner's height `uKickP.z`) and age; velocity and life (nought:
 * dead); seed (its whole part the look), size, a spare (a leaf's seconds lying, spray's water surface) and the colour
 * packed. Each texel finds its kind by its row. A dead slot in this frame's range of the ring takes its record; one not
 * in range may be picked up by the wind alone (a random cell of the window, leafy or sandy, the air past the lift
 * threshold). A live one is carried by the window's whole-cell moves (`uKickShift`), pulled toward the air of its own
 * height (`1 − e^(−dt/τ)`, alike at any frame rate), lifted by the orographic and vortex lifts, pulled down by its
 * gravity, a leaf fluttering, and killed inside a wall, a compound's hall, the ridden hull, under the ground, out of the
 * window or past its life; a leaf lands and lies, and is lifted again; spray dies back in the water it rose from.
 */
export const KICK_UPDATE_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUv;
uniform vec4 uWindow;
uniform vec2 uWind;
${SLAB_VEL_GLSL}
${SRGB_GLSL}
uniform vec4 uGroundTint;
uniform vec4 uGroundTintRef;
${GROUND_TINT_GLSL}
${GROUND_DECODE_GLSL}
${KICK_COMMON}
${KICK_LIFT_GLSL}
uniform highp sampler2D uS0;
uniform highp sampler2D uS1;
uniform highp sampler2D uS2;
uniform sampler2D uVel;
uniform sampler2D uGround;
uniform sampler2D uObstacles;
uniform sampler2D uKlass;
uniform sampler2D uColour;
uniform sampler2D uTint;
uniform vec2 uVelShift;
uniform vec4 uSlabMid;
uniform float uObstacleOver;
uniform mat4 uHullInverse;
uniform vec4 uHullBox;
// x the frame's dt, y the frame's seed, z the corner's height (metres), w the pool's width in texels.
uniform vec4 uKickP;
// xyz the window's moves since the last update, metres; w the window's edge band (a share).
uniform vec4 uKickShift;
// A kind each: its first row, its rows, the ring's head this frame and how many it starts.
uniform vec4 uKind[${KICK_KINDS}];
// A kind each: its records' first and end, whether it is on, and its share of the wind's pickups.
uniform vec4 uKindOn[${KICK_KINDS}];
uniform vec4 uRecA[${SPAWN_MOST}];
uniform vec4 uRecB[${SPAWN_MOST}];
uniform vec4 uRecC[${SPAWN_MOST}];
uniform vec4 uRecD[${SPAWN_MOST}];
// x a dead slot's chance of a pickup this frame, y the sand's lift threshold (m/s), z the share that lifts a leaf, w the storm.
uniform vec4 uPick;
uniform vec4 uTau;
uniform vec4 uGrav;
// x a leaf's drag, y its flutter, z its rest, w the wake's gravity (m/s²).
uniform vec4 uLeaf;
uniform vec4 uPickLife;
uniform vec4 uPickSize;
// x a streak's lowest start, y its highest.
uniform vec4 uStreak;
// x one where a drop of spray landing back on the water leaves a ring (the fifth wave: the current and the ripples on).
uniform vec4 uRing;
${WIND7_GLSL}
layout(location = 0) out highp vec4 o0;
layout(location = 1) out highp vec4 o1;
layout(location = 2) out highp vec4 o2;
float groundAt(vec2 l) { return texture(uGround, clamp(l, 0.0, 1.0)).r; }
float wallTop(vec2 l) {
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) return 0.0;
  float r = texture(uObstacles, l).r;
  return r > uObstacleOver ? r : 0.0;
}
${KICK_ORO_GLSL}
// The unified wind's gust patch over a cell of the window (the seventh wave): a gust sheds leaves and puffs as it passes,
// as the trees take it. Never a streak (a storm's), and nothing with the unified wind off. Written by its components, so
// the tests run this very function.
bool kickGustSheds(vec2 lc, int kind) {
  return w7On() && kind != 3 && w7Gust(vec2(uWindow.x + lc.x * uWindow.z, uWindow.y + lc.y * uWindow.z)).z > 0.5;
}
// A dead slot's record in this frame's range of its kind's ring: the first of the kind's records (r0 to r1) whose
// cumulative count is past the slot's place in the range, or -1 (recordOf in airSpawn.ts, the mirror).
int kickRecordOf(float ring, int r0, int r1) {
  for (int i = 0; i < ${SPAWN_MOST}; i++) {
    if (i < r0) continue;
    if (i >= r1) break;
    if (ring < uRecA[i].w) return i;
  }
  return -1;
}
// The air past which the wind alone picks a kind up off the ground: the sand's lift threshold, a leaf at its share of it,
// a streak at the storm's own share (pickThreshold in airParticleMath.ts, the mirror).
float kickPickThreshold(int kind) {
  return uPick.y * (kind == 0 ? uPick.z : (kind == 3 ? uLiftB.w : 1.0));
}
// A leaf lying on the ground, a frame: 1 lifted again by the air over it past its share of the lift threshold, 2 gone
// past its rest and a second's fade, 0 still lying (leafRestIn in airParticleMath.ts, the mirror).
int kickLeafRest(float spare, float air, float dt) {
  if (air > uPick.y * uPick.z) return 1;
  if (spare + dt > uLeaf.z + 1.0) return 2;
  return 0;
}
// Whether a particle at window place l, h metres over the ground, is killed there: out of the window, under the
// ground (a leaf lies on it instead), inside a wall below its top, or in a compound's hall below its height. The ridden
// hull is the caller's.
bool kickKilledAt(vec2 l, float h, int kind) {
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) return true;
  if (kind != 0 && h < -0.15) return true;
  float top = wallTop(l);
  if (top > 0.0 && h < top) return true;
  float hall = texture(uObstacles, l).g;
  return hall > uObstacleOver && h < hall;
}
// The air at a height over the ground: blended between the two nearest slabs' middles, read at the air's pending scroll.
vec2 airAt(vec2 l, float h) {
  vec2 q = l + uVelShift;
  vec2 va = slabVelAt(uVel, q, 0, uWind);
  if (h <= uSlabMid.x) return va;
  vec2 vb = slabVelAt(uVel, q, 1, uWind);
  if (h <= uSlabMid.y) return mix(va, vb, (h - uSlabMid.x) / max(uSlabMid.y - uSlabMid.x, 1e-3));
  vec2 vc = slabVelAt(uVel, q, 2, uWind);
  if (h <= uSlabMid.z) return mix(vb, vc, (h - uSlabMid.y) / max(uSlabMid.z - uSlabMid.y, 1e-3));
  return vc;
}
// The vertical air invented from what the rasters hold: the orographic lift over the ground and the walls, and the
// vortex lift off the curl, both over the fixed span uLift.y (four taps half the span either side).
float airLift(vec2 l, vec2 air, float h) {
  float span = max(uLift.y, 1e-3);
  float s = 0.5 * span / uWindow.z;
  vec2 dx = vec2(s, 0.0);
  vec2 dz = vec2(0.0, s);
  vec2 ax1 = airAt(l + dx, h);
  vec2 ax0 = airAt(l - dx, h);
  vec2 az1 = airAt(l + dz, h);
  vec2 az0 = airAt(l - dz, h);
  float curl = (ax1.y - ax0.y) / span - (az1.x - az0.x) / span;
  return airOroAt(l, air.x, air.y, uWindow.z) + airVortLift(curl);
}
bool fin4(vec4 v) { return !(any(isnan(v)) || any(isinf(v))); }
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  int W = int(uKickP.w + 0.5);
  int kind = -1;
  int idx = 0;
  int size = 1;
  for (int k = 0; k < ${KICK_KINDS}; k++) {
    int r0 = int(uKind[k].x + 0.5);
    int rows = int(uKind[k].y + 0.5);
    if (t.y >= r0 && t.y < r0 + rows) {
      kind = k;
      idx = (t.y - r0) * W + t.x;
      size = max(rows * W, 1);
    }
  }
  o0 = vec4(0.0);
  o1 = vec4(0.0);
  o2 = vec4(0.0);
  if (kind < 0) return;
  vec4 s0 = texelFetch(uS0, t, 0);
  vec4 s1 = texelFetch(uS1, t, 0);
  vec4 s2 = texelFetch(uS2, t, 0);
  float dt = uKickP.x;
  float cornerY = uKickP.z;
  vec3 pos = s0.xyz - uKickShift.xyz;
  float age = s0.w;
  vec3 v = s1.xyz;
  float life = s1.w;
  float seed = s2.x;
  float sz = s2.y;
  float spare = s2.z;
  float col = s2.w;
  bool on = uKindOn[kind].z > 0.5;
  bool alive = on && life > 0.0 && fin4(s0) && fin4(s1) && fin4(s2);
  uint slot = uint(t.y * W + t.x);
  uint rs = slot * 747796405u + uint(uKickP.y) * 2891336453u;
  bool born = false;
  if (!alive && on) {
    // This frame's range of the ring: the CPU's records, found by their cumulative counts.
    int head = int(uKind[kind].z + 0.5);
    int ring = idx - head;
    if (ring < 0) ring += size;
    if (float(ring) < uKind[kind].w) {
      int ri = kickRecordOf(float(ring), int(uKindOn[kind].x + 0.5), int(uKindOn[kind].y + 0.5));
      if (ri >= 0) {
        vec4 A = uRecA[ri];
        vec4 B = uRecB[ri];
        vec4 C = uRecC[ri];
        vec4 D = uRecD[ri];
        float ang = 6.2831853 * airRand(rs + 1u);
        float rad = D.z * sqrt(airRand(rs + 2u));
        pos = A.xyz + vec3(cos(ang) * rad, 0.0, sin(ang) * rad);
        vec3 j = vec3(airRand(rs + 3u), airRand(rs + 4u), airRand(rs + 5u)) * 2.0 - 1.0;
        v = B.xyz + j * B.w;
        life = C.z * (0.8 + 0.4 * airRand(rs + 6u));
        sz = C.y * (0.75 + 0.5 * airRand(rs + 7u));
        spare = C.w;
        col = C.x;
        seed = D.y + 0.999 * airRand(rs + 8u);
        age = 0.0;
        born = true;
      }
    }
    // The wind alone, off a random cell of the window: leaves off grass and litter, puffs and (in a storm) streaks off
    // sand, ash and dirt, where the air near the ground passes the lift threshold. Spray is never picked up.
    if (!born && kind != 2 && airRand(rs + 11u) < uPick.x * uKindOn[kind].w) {
      float e = uKickShift.w;
      vec2 lc = vec2(e) + vec2(airRand(rs + 12u), airRand(rs + 13u)) * (1.0 - 2.0 * e);
      int c = int(texture(uKlass, lc).r * 255.0 + 0.5);
      bool leafy = c == ${CLASS_INDEX.grass} || c == ${CLASS_INDEX.litter};
      bool sandy = c == ${CLASS_INDEX.sand} || c == ${CLASS_INDEX.ash} || c == ${CLASS_INDEX.dirt};
      vec2 a0 = airAt(lc, 0.5);
      bool ok = (kind == 0 ? leafy : sandy) && (length(a0) > kickPickThreshold(kind) || kickGustSheds(lc, kind)) && wallTop(lc) <= 0.0 && (kind != 3 || uPick.w > 0.0);
      if (ok) {
        float h0 = kind == 0 ? 0.05 : (kind == 1 ? 0.3 : mix(uStreak.x, uStreak.y, airRand(rs + 14u)));
        pos = vec3(lc.x * uWindow.z, groundAt(lc) + h0 - cornerY, lc.y * uWindow.z);
        v = vec3(a0.x, 0.5 + airRand(rs + 15u), a0.y);
        life = uPickLife[kind] * (0.8 + 0.4 * airRand(rs + 16u));
        sz = uPickSize[kind] * (0.75 + 0.5 * airRand(rs + 17u));
        spare = 0.0;
        vec4 cc = texture(uColour, lc);
        vec4 tq = texture(uTint, lc);
        col = airPackColour(srgbToLinear(cc.rgb) * mix(vec3(1.0), groundDecode(groundTintOf(tq.rgb)), tq.a));
        seed = 2.0 + 0.999 * airRand(rs + 18u);
        age = 0.0;
        born = true;
      }
    }
  }
  if (!alive && !born) return;
  bool dead = false;
  bool landed = false;
  if (alive) {
    vec2 l = pos.xz / uWindow.z;
    float g = groundAt(l);
    float h = pos.y + cornerY - g;
    bool lying = kind == 0 && spare > 0.0;
    if (lying) {
      // A leaf on the ground lies its rest, then fades over a second; the air over it past the leaf's share of the lift
      // threshold lifts it again (kickLeafRest).
      vec2 a0 = airAt(l, 0.2);
      int rest = kickLeafRest(spare, length(a0), dt);
      if (rest == 1) {
        spare = 0.0;
        v = vec3(a0.x * 0.5, 1.2 + airRand(rs + 21u), a0.y * 0.5);
        age = min(age, 0.5 * life);
        lying = false;
      } else {
        spare += dt;
        v = vec3(0.0);
        if (rest == 2) dead = true;
      }
    }
    if (!lying && !dead) {
      float hh = max(h, 0.0);
      vec2 air = airAt(l, hh);
      float w = airLift(l, air, hh);
      float k = airPull(dt, uTau[kind]);
      v.xz += (air - v.xz) * k;
      v.y += (w - v.y) * k;
      float look = floor(seed);
      v.y -= (kind == 2 && look > 0.5 && look < 1.5 ? uLeaf.w : uGrav[kind]) * dt;
      if (kind == 0) {
        v.y *= exp(-uLeaf.x * dt);
        float sp = length(air);
        vec2 side = sp > 1e-3 ? vec2(-air.y, air.x) / sp : vec2(1.0, 0.0);
        float ph = 6.2831853 * fract(seed * 7.13) + age * 3.0;
        v.xz += side * (uLeaf.y * sin(ph) * dt);
      }
      pos += v * dt;
      l = pos.xz / uWindow.z;
      g = groundAt(l);
      h = pos.y + cornerY - g;
      if (kind == 0 && h <= 0.02 && v.y <= 0.0) {
        pos.y = g + 0.02 - cornerY;
        v = vec3(0.0);
        spare = 1e-4;
      }
      // Spray falls back into the water it rose from: its spare is that surface's world height.
      if (kind == 2 && v.y < 0.0 && pos.y + cornerY < spare && age > 0.1) {
        dead = true;
        landed = true;
      }
      if (age >= life) dead = true;
    }
    age += dt;
    // Kills: out of the window, under the ground, inside a wall or a compound's hall (kickKilledAt), inside the ridden hull.
    if (kickKilledAt(l, h, kind)) dead = true;
    if (uHullBox.w > 0.5) {
      vec3 hp = (uHullInverse * vec4(pos + vec3(uWindow.x, cornerY, uWindow.y), 1.0)).xyz;
      if (all(lessThan(abs(hp), uHullBox.xyz))) dead = true;
    }
  }
  if (dead) {
    // A drop landed back in the water (the fifth wave's): a dead slot for this one frame with its place kept and a
    // spare of -1, which the ring draw reads and turns into a ring in the ripples; any slot next frame takes it over.
    if (landed && uRing.x > 0.5 && fin4(vec4(pos, age))) {
      o0 = vec4(pos, age);
      o2 = vec4(seed, sz, -1.0, col);
    }
    return;
  }
  vec4 r0 = vec4(pos, age);
  vec4 r1 = vec4(v, max(life, 1e-3));
  vec4 r2 = vec4(seed, sz, spare, col);
  if (!fin4(r0) || !fin4(r1) || !fin4(r2)) return;
  o0 = r0;
  o1 = r1;
  o2 = r2;
}
`;

/** The kick-up pool cleared: every slot dead (a jump, a new world, a switch turned on again). */
export const KICK_FILL_FRAGMENT = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 o0;
layout(location = 1) out highp vec4 o1;
layout(location = 2) out highp vec4 o2;
void main() {
  o0 = vec4(0.0);
  o1 = vec4(0.0);
  o2 = vec4(0.0);
}
`;

/**
 * The kick-up pool's draw, one instanced quad a slot of a kind, its state read by `gl_InstanceID` (no instanced
 * attribute). The mesh stands at the air window's corner (the corner's height in its matrix), so three composes the view
 * in double. A dead particle, one out of reach of the eye (within half of `near`) or a kind switched off collapses outside
 * the view. A camera-facing quad of its size, grown over its life, turned by its spin; a streak a quad along its own
 * motion, its length its speed over its trail, never under a pixel and a fifth wide; never taller on the screen than
 * `clamp` of the half-height; faded over the last `near` metres to the eye and across the window's edge band. The leaves
 * (`KICK_CUT`) are lit by the leaf cards' own client sum per vertex (the grass's way); the rest as the volume lights its
 * dust, the sun through the air's light toward the sun at their height, times the phase, plus the ambient.
 */
export const KICK_DRAW_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${KICK_COMMON}
${KICK_STREAK_GLSL}
uniform highp sampler2D uS0;
uniform highp sampler2D uS1;
uniform highp sampler2D uS2;
uniform sampler2D uGround;
uniform sampler2D uLight;
uniform vec4 uWindow;
uniform vec2 uLightShift;
uniform vec4 uLightH;
// x the kind's first row, y the pool's width, z the kind, w whether it is drawn (its switch on and the pool stepped this frame).
uniform vec4 uDrawK;
// x near, y clamp, z the corner's height, w the screen's height in pixels.
uniform vec4 uDrawP;
// x this kind's alpha, y its growth over its life, z its spin, w a leaf's rest (it fades over a second after).
uniform vec4 uDrawQ;
// The wake's look: x its growth, y in by, z out from, w its alpha.
uniform vec4 uDrawW;
// x the window's edge band (a share), y the leaves' tint toward the ground, z the dust's brightness, w the least pixels a streak is wide.
uniform vec4 uDrawE;
uniform vec3 uSunDir;
uniform vec3 uSunColour;
uniform vec3 uAmbient;
// x the phase's base, y its lift, z its power, w the light pass on (1).
uniform vec4 uPhase;
varying vec2 vKickUv;
varying vec4 vKickColour;
varying vec3 vKickLocal;
#ifdef KICK_CUT
uniform vec3 uSwgCardFront;
uniform vec3 uSwgCardTangent;
uniform vec3 uSwgCardBack;
uniform vec3 uSwgCardAmbient;
uniform vec3 uSwgCardFill;
uniform vec3 uSwgCardBounce;
uniform vec3 uSwgCardFillDir;
uniform vec3 uSwgCardBounceDir;
uniform float uSwgCardFills;
uniform vec3 uSwgLeafSun;
uniform float uSwgGrassShadowRange;
uniform vec3 uSwgGrassShadowOn;
// x the leaves take the sun's shadow (volParticleShadows).
uniform vec4 uKickShade;
varying vec3 vKickLightSun;
varying vec3 vSwgShadowPos;
varying float vSwgShadowLd;
varying float vSwgReceive;
#endif
float airTauAt(vec4 tau, float h) {
  if (h <= uLightH.x) return tau.x;
  if (h <= uLightH.y) return mix(tau.x, tau.y, (h - uLightH.x) / max(uLightH.y - uLightH.x, 1e-3));
  if (h <= uLightH.z) return mix(tau.y, tau.z, (h - uLightH.y) / max(uLightH.z - uLightH.y, 1e-3));
  if (h <= uLightH.w) return mix(tau.z, tau.w, (h - uLightH.z) / max(uLightH.w - uLightH.z, 1e-3));
  return tau.w;
}
// How far a corner offset in view space (x, y; nought along the view) stands over its quad's middle in the world: the
// offset turned back to the world's frame, its up (the transposed view rotation's second row).
float airCornerRise(vec2 off) {
  return viewMatrix[1][0] * off.x + viewMatrix[1][1] * off.y;
}
void main() {
  int W = int(uDrawK.y + 0.5);
  int i = gl_InstanceID;
  ivec2 t = ivec2(i % W, int(uDrawK.x + 0.5) + i / W);
  vec4 s0 = texelFetch(uS0, t, 0);
  vec4 s1 = texelFetch(uS1, t, 0);
  vec4 s2 = texelFetch(uS2, t, 0);
  vKickUv = vec2(0.0);
  vKickColour = vec4(0.0);
  vKickLocal = vec3(0.0);
  #ifdef KICK_CUT
    vKickLightSun = vec3(0.0);
    vSwgShadowPos = vec3(0.0);
    vSwgShadowLd = 0.0;
    vSwgReceive = 0.0;
  #endif
  vec4 mvPosition = vec4(0.0, 0.0, 0.0, 1.0);
  bool dead = uDrawK.w < 0.5 || s1.w <= 0.0 || any(isnan(s0)) || any(isinf(s0));
  vec3 local = s0.xyz;
  vec4 world = modelMatrix * vec4(local, 1.0);
  mvPosition = viewMatrix * world;
  float d = -mvPosition.z;
  float near = uDrawP.x;
  if (dead || d < 0.5 * near) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <fog_vertex>
    return;
  }
  float kind = uDrawK.z;
  float age = s0.w;
  float life = max(s1.w, 1e-3);
  float u = clamp(age / life, 0.0, 1.0);
  float look = floor(s2.x);
  bool wake = kind > 1.5 && kind < 2.5 && look > 0.5 && look < 1.5;
  float grow = wake ? uDrawW.x : uDrawQ.y;
  float size = s2.y * (1.0 + grow * u);
  // A pixel's height at this depth, and the most a sprite may stand: clamp of the screen's half-height.
  float pixel = 2.0 * d / max(projectionMatrix[1][1] * uDrawP.w, 1.0);
  float most = uDrawP.y * d / max(projectionMatrix[1][1], 1e-3);
  float alpha = wake ? uDrawW.w : uDrawQ.x;
  // In and out over its life: a fifth in, the last fifth out (the wake's own points), a leaf lying fading after its rest.
  float fin = wake ? uDrawW.y : 0.2;
  float fout = wake ? uDrawW.z : 0.8;
  alpha *= smoothstep(0.0, max(fin, 1e-3), u) * (1.0 - smoothstep(min(fout, 0.999), 1.0, u));
  if (kind < 0.5) {
    alpha = 1.0;
    if (s2.z > uDrawQ.w) alpha = 1.0 - clamp(s2.z - uDrawQ.w, 0.0, 1.0);
    if (s2.z <= 0.0 && u > 0.92) alpha = 1.0 - (u - 0.92) / 0.08;
  }
  alpha *= smoothstep(0.5 * near, near, d);
  vec2 l = local.xz / uWindow.z;
  float e = max(uDrawE.x, 1e-3);
  alpha *= clamp(min(min(l.x, l.y), min(1.0 - l.x, 1.0 - l.y)) / e, 0.0, 1.0);
  vec2 corner = position.xy;
  vec3 colour = airUnpackColour(s2.w);
  // This corner's height over the particle's middle in the world (a sprite's; a streak keeps its middle's).
  float rise = 0.0;
  if (kind > 2.5) {
    // A fine streak: from its head back along its own motion (vertical as much as across), as long as its speed over its
    // trail, a fifth of that wide at most and never under the screen's least pixels.
    vec3 vel = s1.xyz;
    float sp = length(vel);
    vec3 dir = sp > 1e-4 ? vel / sp : vec3(0.0, 1.0, 0.0);
    float len = min(airStreakLength(sp), most);
    vec4 tail = viewMatrix * (world - vec4(dir * len, 0.0));
    vec2 along = mvPosition.xy - tail.xy;
    float al = length(along);
    vec2 ax = al > 1e-5 ? along / al : vec2(0.0, 1.0);
    vec2 across = vec2(-ax.y, ax.x);
    float wid = max(uStreakD.w, uDrawE.w * pixel);
    vec4 p = mix(tail, mvPosition, corner.y + 0.5);
    p.xy += across * corner.x * wid;
    mvPosition = p;
    vKickUv = vec2(corner.x + 0.5, corner.y + 0.5);
  } else {
    size = min(size, most);
    float spin = uDrawQ.z * (fract(s2.x * 13.7) < 0.5 ? -1.0 : 1.0) * (0.5 + fract(s2.x * 31.3)) * age + 6.2831853 * fract(s2.x * 3.1);
    float c = cos(spin);
    float s = sin(spin);
    vec2 q = corner * size;
    // A leaf tumbles: its width turns over as it falls.
    if (kind < 0.5) q.x *= max(abs(cos(age * 2.1 + fract(s2.x * 5.7) * 6.2831853)), 0.25);
    vec2 off = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
    mvPosition.xy += off;
    rise = airCornerRise(off);
    vKickUv = vec2(corner.x + 0.5, 0.5 - corner.y);
  }
  gl_Position = projectionMatrix * mvPosition;
  vKickLocal = local;
  float hOver = local.y + uDrawP.z - texture(uGround, clamp(l, 0.0, 1.0)).r;
  // The air's light toward the sun at the particle's height, as the volume lights its dust: a leaf or a puff in a dust
  // cloud's dark heart takes that much less of the sun.
  float T = 1.0;
  if (uPhase.w > 0.5 && l.x >= 0.0 && l.y >= 0.0 && l.x <= 1.0 && l.y <= 1.0) T = exp(-airTauAt(texture(uLight, l + uLightShift), max(hOver, 0.0)));
  #ifdef KICK_CUT
    // The leaf cards' client sum, by the leaf's up (a leaf's two faces are one card's), as the grass is lit; the sun's
    // share of it through the air's light toward the sun.
    vec3 swgN = vec3(0.0, 1.0, 0.0);
    float swgD = clamp(dot(swgN, uSwgLeafSun), -1.0, 1.0);
    vec3 swgMain = swgD >= 0.0 ? uSwgCardTangent : mix(uSwgCardTangent, uSwgCardBack, -swgD);
    vKickLightSun = swgD >= 0.0 ? (uSwgCardFront - uSwgCardTangent) * (swgD * T) : vec3(0.0);
    vec3 swgSum = uSwgCardAmbient + swgMain;
    if (uSwgCardFills > 0.5) swgSum += uSwgCardFill * max(dot(swgN, normalize(uSwgCardFillDir)), 0.0);
    if (uSwgCardFills > 1.5) swgSum += uSwgCardBounce * max(dot(swgN, normalize(uSwgCardBounceDir)), 0.0);
    // The leaf's tint: its pale picture toward the ground's carried colour (held to unit brightness) at the tint's share.
    float lum = max(dot(colour, vec3(0.2126, 0.7152, 0.0722)), 0.05);
    vec3 tint = mix(vec3(1.0), min(colour / lum, vec3(2.0)), uDrawE.y);
    vKickColour = vec4(swgSum, alpha);
    vKickLocal = tint;
    if (uKickShade.x > 0.5 && uSwgGrassShadowOn.x > 0.5) {
      vSwgShadowPos = world.xyz + uSwgLeafSun * (0.25 + size);
      vSwgShadowLd = d / max(uSwgGrassShadowRange, 1e-3);
      vSwgReceive = 1.0;
    }
  #else
    // As the volume lights its dust: the sun through the air's light toward the sun at this height, the phase, the ambient.
    vec3 ray = world.xyz - cameraPosition;
    float rl = length(ray);
    float mu = rl > 1e-4 ? dot(ray / rl, uSunDir) : 0.0;
    float ph = uPhase.x + uPhase.y * pow(max(mu, 0.0), uPhase.z);
    vec3 lit = colour * (uSunColour * ph * T + uAmbient) * (kind < 1.5 || kind > 2.5 ? uDrawE.z : 1.0);
    vKickColour = vec4(lit, alpha);
    // The corner's own height over the ground under the middle, so the puffs' lower edge fades by each fragment's height.
    vKickLocal = vec3(local.x, hOver + rise, local.z);
  #endif
  #include <fog_vertex>
}
`;

/**
 * The kick-up pool's fragment: the leaves (`KICK_CUT`) cut at a half, opaque, writing depth, the sun's shadow tapped in
 * this stage (never a shadow compare in a vertex stage) and carried back through the curve as a leaf card is; the puffs,
 * spray and streaks blended, the puffs' lower edge faded by their height over the ground (never the scene depth), a
 * streak's shape drawn here (a parabola across, a fade-in along) with no picture.
 */
export const KICK_DRAW_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uMap;
// x the kind, y a procedural shape (a streak), z a puff's lower edge, metres.
uniform vec4 uFragK;
varying vec2 vKickUv;
varying vec4 vKickColour;
varying vec3 vKickLocal;
#ifdef KICK_CUT
uniform float uSwgCardCurve;
uniform float uSwgCardExposureRef;
uniform float uSwgCardBloomCap;
uniform float uSwgCardGain;
${CARD_CURVE_PARS}${GRASS_SHADOW_PARS}
varying vec3 vKickLightSun;
#endif
void main() {
  if (vKickColour.a <= 0.002) discard;
  #ifdef KICK_CUT
    vec4 t = texture2D(uMap, vKickUv);
    if (t.a < 0.5) discard;
    // A leaf fading (lying past its rest, near the eye, at the window's edge) is cut by an ordered dither, as the grass's
    // far edge is: it writes depth and is never blended.
    if (vKickColour.a < 0.999) {
      float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (n > vKickColour.a) discard;
    }
    float swgShade = vSwgReceive > 0.5 ? swgGrassShadow(vSwgShadowPos, vSwgShadowLd) : 1.0;
    vec3 light = clamp((vKickColour.rgb + vKickLightSun * swgShade) * uSwgCardGain, 0.0, 1.0);
    vec3 display = clamp(t.rgb * vKickLocal * light, 0.0, 1.0);
    vec3 colour;
    if (uSwgCardCurve < 0.5) {
      colour = swgAcesInverse(swgCardToLinear(display)) / max(uSwgCardExposureRef, 1e-3);
      float lum = dot(colour, vec3(0.2126, 0.7152, 0.0722));
      if (lum > uSwgCardBloomCap) colour *= uSwgCardBloomCap / lum;
    } else colour = swgCardToLinear(display);
    gl_FragColor = vec4(colour, 1.0);
  #else
    float a;
    vec3 rgb = vKickColour.rgb;
    if (uFragK.y > 0.5) {
      float x = vKickUv.x * 2.0 - 1.0;
      a = max(1.0 - x * x, 0.0) * smoothstep(0.0, 0.35, vKickUv.y);
    } else {
      vec4 t = texture2D(uMap, vKickUv);
      a = t.a;
      rgb *= t.rgb;
    }
    if (uFragK.x > 0.5 && uFragK.x < 1.5) a *= smoothstep(0.0, max(uFragK.z, 1e-3), vKickLocal.y);
    a *= vKickColour.a;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(rgb, a);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * The precipitation pool's update (the design's §2.16), one draw a frame the weather wants rain or snow, two outputs:
 * position relative to the pool's own anchor (the camera snapped to whole metres) and its seed; velocity and a flag
 * (nought: never born, so the box fills at once). Every drop is always alive: it is carried by the anchor's moves, pulled
 * toward the air of its height (on a frame the field ran: `uRainP.z`) or the wind's inflow (any other), falling at its
 * own speed, lifted over a windward wall; its place wrapped across the box, and from past its top to its foot (a camera
 * coming down faster than the drops fall never empties the box); and born again at the box's top under a roof
 * (the weather's own roof grid), inside a wall, under the ground, under the box or inside the ridden hull. With no air
 * this frame only the roof grid kills, since its heights hold the ground where nothing stands over it.
 */
export const RAIN_UPDATE_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUv;
uniform vec4 uWindow;
uniform vec2 uWind;
${SLAB_VEL_GLSL}
${KICK_COMMON}
${KICK_LIFT_GLSL}
uniform highp sampler2D uR0;
uniform highp sampler2D uR1;
uniform sampler2D uVel;
uniform sampler2D uGround;
uniform sampler2D uObstacles;
uniform highp sampler2D uRoofMap;
uniform vec4 uRoofGrid;
uniform vec2 uVelShift;
uniform vec4 uSlabMid;
uniform float uObstacleOver;
uniform mat4 uHullInverse;
uniform vec4 uHullBox;
// x dt, y the frame's seed, z the air ran this frame (1), w snow (1).
uniform vec4 uRainP;
// xyz the anchor's moves since the last update, metres; w the box's half-width.
uniform vec4 uRainShift;
// x how far under the anchor, y over it, z the fall, w τ.
uniform vec4 uRainBox;
// The anchor itself (whole metres, exact in a float), and the roof grid's kill slack.
uniform vec4 uAnchor;
// The air window's corner relative to the anchor (x, z), and its size.
uniform vec4 uRainWin;
// x the snow's flutter, y the pool's width.
uniform vec4 uRainQ;
${WIND7_GLSL}
layout(location = 0) out highp vec4 o0;
layout(location = 1) out highp vec4 o1;
float groundAt(vec2 l) { return texture(uGround, clamp(l, 0.0, 1.0)).r; }
float wallTop(vec2 l) {
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) return 0.0;
  float r = texture(uObstacles, l).r;
  return r > uObstacleOver ? r : 0.0;
}
vec2 airAt(vec2 l, float h) {
  vec2 q = l + uVelShift;
  vec2 va = slabVelAt(uVel, q, 0, uWind);
  if (h <= uSlabMid.x) return va;
  vec2 vb = slabVelAt(uVel, q, 1, uWind);
  if (h <= uSlabMid.y) return mix(va, vb, (h - uSlabMid.x) / max(uSlabMid.y - uSlabMid.x, 1e-3));
  vec2 vc = slabVelAt(uVel, q, 2, uWind);
  if (h <= uSlabMid.z) return mix(vb, vc, (h - uSlabMid.y) / max(uSlabMid.z - uSlabMid.y, 1e-3));
  return vc;
}
// The wind's inflow by height, with no air raster read: the slab's own share of the wind.
vec2 inflowAt(float h) {
  if (h <= uSlabMid.x) return uWind * uSlabShare.x;
  if (h <= uSlabMid.y) return uWind * mix(uSlabShare.x, uSlabShare.y, (h - uSlabMid.x) / max(uSlabMid.y - uSlabMid.x, 1e-3));
  if (h <= uSlabMid.z) return uWind * mix(uSlabShare.y, uSlabShare.z, (h - uSlabMid.y) / max(uSlabMid.z - uSlabMid.y, 1e-3));
  return uWind * uSlabShare.z;
}
${KICK_ORO_GLSL}
float wrapBox(float x, float reach) { return mod(x + reach, 2.0 * reach) - reach; }
// A drop risen past the box's top (the camera coming down faster than the drops fall, or the anchor moved down by a
// pause in a fall) wrapped to the box's foot as it is wrapped across, so a descent never empties the box; any other
// height as it is (one that falls past the foot is born again at the top).
float rainRise(float y) {
  float span = max(uRainBox.x + uRainBox.y, 1e-3);
  return y > uRainBox.y ? y - span * ceil((y - uRainBox.y) / span) : y;
}
// The weather's own roof grid's cell over a place relative to the anchor (nearest cell), or (-1, -1) outside the grid,
// where it has no answer.
vec2 rainRoofCell(float x, float z) {
  float gx = floor((x + uAnchor.x - uRoofGrid.x) / max(uRoofGrid.z, 1e-3));
  float gz = floor((z + uAnchor.z - uRoofGrid.y) / max(uRoofGrid.z, 1e-3));
  if (gx < 0.0 || gz < 0.0 || gx >= uRoofGrid.w || gz >= uRoofGrid.w) return vec2(-1.0);
  return vec2(gx, gz);
}
// Whether a drop at a place relative to the anchor is under its column's top in that grid (a roof, an eave, the ground)
// by more than the weather's kill slack: the weather's own rule for its sheets.
bool rainUnderRoof(float x, float y, float z) {
  vec2 gc = rainRoofCell(x, z);
  return gc.x >= 0.0 && y + uAnchor.y < texelFetch(uRoofMap, ivec2(gc), 0).r - uAnchor.w;
}
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec4 s0 = texelFetch(uR0, t, 0);
  vec4 s1 = texelFetch(uR1, t, 0);
  float dt = uRainP.x;
  float reach = uRainShift.w;
  uint slot = uint(t.y * int(uRainQ.y + 0.5) + t.x);
  uint rs = slot * 747796405u + uint(uRainP.y) * 2891336453u;
  bool snow = uRainP.w > 0.5;
  float fall = uRainBox.z;
  vec3 pos = s0.xyz - uRainShift.xyz;
  vec3 v = s1.xyz;
  bool fresh = s1.w < 0.5 || any(isnan(s0)) || any(isnan(s1)) || any(isinf(s0)) || any(isinf(s1));
  bool reborn = false;
  if (fresh) {
    // Never born: anywhere in the box, so it fills at once.
    pos = vec3((airRand(rs + 1u) * 2.0 - 1.0) * reach, mix(-uRainBox.x, uRainBox.y, airRand(rs + 2u)), (airRand(rs + 3u) * 2.0 - 1.0) * reach);
    v = vec3(0.0, -fall, 0.0);
  } else {
    vec2 l = (pos.xz - uRainWin.xy) / max(uRainWin.z, 1e-3);
    bool live = uRainP.z > 0.5;
    bool inWin = live && l.x >= 0.0 && l.y >= 0.0 && l.x <= 1.0 && l.y <= 1.0;
    float g = inWin ? groundAt(l) : 0.0;
    float h = inWin ? pos.y + uAnchor.y - g : 1.5;
    // With the air not stepped this frame, the inflow; under the unified wind, the inflow as the gust at the drop's place
    // turns and scales it (the seventh wave), so the rain's lean walks with the gusts there too.
    vec2 air = live ? airAt(l, max(h, 0.0)) : (w7On() ? w7Target(pos.xz + uAnchor.xz, inflowAt(1.5)) : inflowAt(1.5));
    float w = 0.0;
    if (inWin) w = airOroAt(l, air.x, air.y, uRainWin.z);
    vec3 target = vec3(air.x, -fall + w, air.y);
    if (snow) {
      float ph = 6.2831853 * s0.w + pos.y * 0.7;
      target.xz += vec2(cos(ph), sin(ph)) * uRainQ.x;
    }
    float k = airPull(dt, uRainBox.w);
    v += (target - v) * k;
    pos += v * dt;
    pos.x = wrapBox(pos.x, reach);
    pos.z = wrapBox(pos.z, reach);
    pos.y = rainRise(pos.y);
    // Under a roof: the weather's own grid (absolute heights; outside it no answer).
    bool inGrid = rainRoofCell(pos.x, pos.z).x >= 0.0;
    if (rainUnderRoof(pos.x, pos.y, pos.z)) reborn = true;
    if (inWin) {
      l = (pos.xz - uRainWin.xy) / uRainWin.z;
      g = groundAt(l);
      h = pos.y + uAnchor.y - g;
      float top = wallTop(l);
      if (h < 0.0 || (top > 0.0 && h < top)) reborn = true;
      // Past the roof grid the coarse roof: the ground and the walls standing on it.
      if (!inGrid && h < top) reborn = true;
    }
    if (pos.y < -uRainBox.x) reborn = true;
    if (uHullBox.w > 0.5) {
      vec3 hp = (uHullInverse * vec4(pos + uAnchor.xyz, 1.0)).xyz;
      if (all(lessThan(abs(hp), uHullBox.xyz))) reborn = true;
    }
    if (reborn) {
      pos = vec3((airRand(rs + 5u) * 2.0 - 1.0) * reach, uRainBox.y - airRand(rs + 6u), (airRand(rs + 7u) * 2.0 - 1.0) * reach);
      v = vec3(air.x, -fall, air.y);
    }
  }
  float seed = fresh ? airRand(rs + 9u) : s0.w;
  vec4 a = vec4(pos, seed);
  vec4 b = vec4(v, 1.0);
  if (any(isnan(a)) || any(isinf(a)) || any(isnan(b)) || any(isinf(b))) {
    a = vec4(0.0, uRainBox.y, 0.0, seed);
    b = vec4(0.0, -fall, 0.0, 1.0);
  }
  o0 = a;
  o1 = b;
}
`;

/** The rain pool cleared: every drop never born, so the next update fills the box at once. */
export const RAIN_FILL_FRAGMENT = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 o0;
layout(location = 1) out highp vec4 o1;
void main() {
  o0 = vec4(0.0);
  o1 = vec4(0.0);
}
`;

/**
 * The rain's draw, in the weather's own scene (no light, no fog of three's: the weather's own fog uniforms, as its sheets
 * have), through the weather's per-draw stencil. A drop drawn while its slot's hash is under the share falling; a streak
 * of ours from its head back along its velocity by `streak` seconds, `width` wide and never under `minPx` pixels or
 * shorter than it is wide; snow a soft dot. Its alpha the setting's own `rainOpacity` times a parabola across, a fade-in
 * along and the box's outer edge; the colour the sky's light worked out on the CPU (`rainColourIn`) times the
 * backlight against the sun; the roof and the ridden hull discarded per fragment as the weather's own shader does.
 */
export const RAIN_DRAW_VERTEX = /* glsl */ `
${KICK_COMMON}
uniform highp sampler2D uR0;
uniform highp sampler2D uR1;
// x the pool's width, y the share drawn, z snow (1), w the alpha (the setting's rainOpacity times the tune's).
uniform vec4 uRainD;
// x the streak's seconds, y its width, z the least pixels, w the screen's height in pixels.
uniform vec4 uRainS;
// x the box's half-width, y its edge share, z under, w over.
uniform vec4 uRainE;
uniform vec3 uRainColour;
uniform vec3 uSunDir;
// x the backlight's base, y its lift, z its power, w the snow's size.
uniform vec4 uRainB;
uniform float uFogDensity;
varying vec2 vRainUv;
varying float vRainAlpha;
varying vec3 vRainColour;
varying vec3 vRainWorld;
varying float vRainFog;
// Whether a drop's slot is drawn at a share of the pool: its own hash under the share (slotDrawn in airParticleMath.ts).
bool rainSlotDrawn(int i, float share) {
  return airRand(uint(i) * 2654435761u + 7u) < share;
}
void main() {
  int W = int(uRainD.x + 0.5);
  int i = gl_InstanceID;
  ivec2 t = ivec2(i % W, i / W);
  vec4 s0 = texelFetch(uR0, t, 0);
  vec4 s1 = texelFetch(uR1, t, 0);
  vRainUv = vec2(0.0);
  vRainAlpha = 0.0;
  vRainColour = vec3(0.0);
  vRainWorld = vec3(0.0);
  vRainFog = 0.0;
  bool drawn = s1.w > 0.5 && rainSlotDrawn(i, uRainD.y);
  if (!drawn || any(isnan(s0)) || any(isinf(s0))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 world = modelMatrix * vec4(s0.xyz, 1.0);
  vec4 mv = viewMatrix * world;
  float d = max(-mv.z, 1e-3);
  float pixel = 2.0 * d / max(projectionMatrix[1][1] * uRainS.w, 1.0);
  vec2 corner = position.xy;
  vec4 p;
  if (uRainD.z > 0.5) {
    float s = max(uRainB.w, uRainS.z * pixel);
    p = mv;
    p.xy += corner * s;
    vRainUv = corner + 0.5;
  } else {
    vec3 vel = s1.xyz;
    vec4 tail = viewMatrix * (world - vec4(vel * uRainS.x, 0.0));
    vec2 along = mv.xy - tail.xy;
    float wid = max(uRainS.y, uRainS.z * pixel);
    float al = length(along);
    // Never shorter on the screen than it is wide.
    if (al < wid) tail.xy = mv.xy - (al > 1e-6 ? along / al : vec2(0.0, 1.0)) * wid;
    along = mv.xy - tail.xy;
    al = length(along);
    vec2 ax = al > 1e-6 ? along / al : vec2(0.0, 1.0);
    vec2 across = vec2(-ax.y, ax.x);
    p = mix(tail, mv, corner.y + 0.5);
    p.xy += across * corner.x * wid;
    vRainUv = vec2(corner.x + 0.5, corner.y + 0.5);
  }
  gl_Position = projectionMatrix * p;
  // The box's outer edge, across and up and down.
  float r = max(abs(s0.x), abs(s0.z)) / max(uRainE.x, 1e-3);
  float edge = 1.0 - smoothstep(1.0 - max(uRainE.y, 1e-3), 1.0, r);
  edge *= 1.0 - smoothstep(uRainE.w * (1.0 - uRainE.y), uRainE.w, s0.y);
  vRainAlpha = uRainD.w * edge;
  vec3 ray = world.xyz - cameraPosition;
  float rl = length(ray);
  float mu = rl > 1e-4 ? dot(ray / rl, uSunDir) : 0.0;
  vRainColour = uRainColour * (uRainB.x + uRainB.y * pow(max(mu, 0.0), uRainB.z));
  vRainWorld = world.xyz;
  vRainFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
}
`;

export const RAIN_DRAW_FRAGMENT = /* glsl */ `
uniform highp sampler2D uRoofMap;
uniform vec4 uRoofGrid;
uniform float uKillSlack;
uniform float uHullOn;
uniform mat4 uHullToLocal;
uniform vec3 uHullMin;
uniform vec3 uHullMax;
uniform vec3 uFogColor;
// x snow (1).
uniform vec4 uRainF;
varying vec2 vRainUv;
varying float vRainAlpha;
varying vec3 vRainColour;
varying vec3 vRainWorld;
varying float vRainFog;
void main() {
  // Below its column's top (a roof, an eave, the ground): gone, the weather's own rule (nearest cell).
  vec2 g = floor((vRainWorld.xz - uRoofGrid.xy) / uRoofGrid.z);
  if (g.x >= 0.0 && g.y >= 0.0 && g.x < uRoofGrid.w && g.y < uRoofGrid.w && vRainWorld.y < texelFetch(uRoofMap, ivec2(g), 0).r - uKillSlack) discard;
  if (uHullOn > 0.5) {
    vec3 h = (uHullToLocal * vec4(vRainWorld, 1.0)).xyz;
    if (all(greaterThan(h, uHullMin)) && all(lessThan(h, uHullMax))) discard;
  }
  float a;
  if (uRainF.x > 0.5) {
    vec2 c = vRainUv * 2.0 - 1.0;
    a = max(1.0 - dot(c, c), 0.0);
  } else {
    float x = vRainUv.x * 2.0 - 1.0;
    a = max(1.0 - x * x, 0.0) * smoothstep(0.0, 0.4, vRainUv.y);
  }
  a *= vRainAlpha;
  if (a <= 0.002) discard;
  vec3 c = mix(vRainColour, uFogColor, vRainFog);
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The spray's rings (the fifth wave, the design's §2.9): one instanced quad a slot of the spray's rows, its state read by
 * `gl_InstanceID`; a slot the update marked as a drop that landed back in the water this frame (`ringLanded`: its life
 * nought and its spare -1) is a quad over its place in the ripples' window (their v runs against world Z: `ringU`,
 * `ringV`), `liquid.ringSize` of its own size across (never under a texel of the ripples), every other slot collapsed
 * outside the target. Drawn additively into the ripples' state.
 */
export const RING_VERTEX = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uS0;
uniform highp sampler2D uS1;
uniform highp sampler2D uS2;
// x the spray's first row, y the pool's width, z the kick corner's height (unused), w the ring's size in the drop's sizes.
uniform vec4 uRingK;
// The ripples' window: origin x, origin z, metres across, metres a texel.
uniform vec4 uRingW;
// x the ring's depth (field units), y unused, z and w the air window's corner x and z.
uniform vec4 uRingP;
varying vec2 vRing;
// A drop that landed back in the water this frame: the update kept its slot dead (life nought) with a spare of -1. A
// living drop's spare is its water's own height, which over a sea standing below -0.5 m is as negative as the mark, so
// the life is asked first (the kick draw's own test of a dead slot).
bool ringLanded(float life, float spare) {
  return life <= 0.0 && spare == -1.0;
}
// The ripples' u and v of a world x and z: u along world X from their origin, v against world Z.
float ringU(float x) {
  return (x - uRingW.x) / uRingW.z;
}
float ringV(float z) {
  return 1.0 - (z - uRingW.y) / uRingW.z;
}
void main() {
  int W = int(uRingK.y + 0.5);
  int i = gl_InstanceID;
  ivec2 t = ivec2(i % W, int(uRingK.x + 0.5) + i / W);
  vec4 s1 = texelFetch(uS1, t, 0);
  vec4 s2 = texelFetch(uS2, t, 0);
  vRing = vec2(0.0);
  if (!ringLanded(s1.w, s2.z) || uRingW.z <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 s0 = texelFetch(uS0, t, 0);
  vec2 xz = s0.xz + uRingP.zw;
  float r = max(s2.y * uRingK.w, uRingW.w);
  vec2 uv = vec2(ringU(xz.x), ringV(xz.y));
  // The quad is three of the ring's radii each way: a Gaussian's whole.
  vec2 q = position.xy * 2.0;
  vec2 p = uv + q * (3.0 * r / uRingW.z);
  vRing = q * 3.0;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  if (any(isnan(gl_Position)) || any(isinf(gl_Position))) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

/** A ring pressed into the ripples' height (the red channel only, as a fast arrival's punch is). */
export const RING_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec4 uRingP;
varying vec2 vRing;
void main() {
  float g = exp(-dot(vRing, vRing));
  gl_FragColor = vec4(-uRingP.x * g, 0.0, 0.0, 0.0);
}
`;

/** Every particle shader by name, for the scanner and the self test. */
export const AIR_PARTICLE_SHADERS: Readonly<Record<string, string>> = {
  kickUpdate: KICK_UPDATE_FRAGMENT,
  kickFill: KICK_FILL_FRAGMENT,
  kickDrawVertex: KICK_DRAW_VERTEX,
  kickDrawFragment: KICK_DRAW_FRAGMENT,
  rainUpdate: RAIN_UPDATE_FRAGMENT,
  rainFill: RAIN_FILL_FRAGMENT,
  rainDrawVertex: RAIN_DRAW_VERTEX,
  rainDrawFragment: RAIN_DRAW_FRAGMENT,
  ringVertex: RING_VERTEX,
  ringFragment: RING_FRAGMENT,
};
