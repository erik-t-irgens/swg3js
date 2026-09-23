// Under water: the one pass that makes being below a surface look like being below a surface.
//
// There was no under water in the game at all — you could not go under — so nothing here is copied
// from anything. With Effects off this pass does not exist and the game under water looks exactly
// as it always did; with Effects on the picture is graded by how much water each pixel is seen
// through, a flat veil rises with how deep the camera itself is, and the whole frame wobbles gently,
// as through a lens held over the camera. Every number is in `underwaterMath.ts` and live through
// `__debug.underwater`.
//
// Five things about it are not obvious.
//
// Water writes no depth. So the surface overhead, and the sky through it, carry the depth of
// whatever stands beyond them — the far plane — and a fog driven by the scene depth alone would
// paint the whole way up solid murk. The way out is arithmetic rather than another buffer: the
// surface is a plane `cameraDepth` metres over the eye, so a ray leaving upward is in water for
// `cameraDepth / up` metres and no further (`waterPath`). Looking up is then bright, looking along
// the bed is murk, and nothing had to be traced.
//
// The wobble is a lens and not a haze. It once faded out on the water in front of each pixel, so a
// far wall did not swim and only what was close moved; the owner played it and said it read as
// something sitting on the materials rather than as looking through water, and asked instead for
// "the camera itself has a lens over it that wobbles slightly". So the amplitude is now one number
// for the whole frame — the bed, a far wall, the surface overhead and the sky through it alike — and
// nothing about where a pixel is changes it. It still falls away with the camera's own *depth*
// (`shimmerSurface`, `shimmerDeep`), which is one number over the whole frame rather than a second
// rule about where a pixel stands, because the light that bends is the light coming through the
// ripples overhead. The old rule is one knob away for as long as the owner wants to compare the two
// (`shimmerReach`; see `shimmerFor`), and goes when they have settled.
//
// Deeper is darker, and the murk is a share of the light the world has rather than a level of its
// own. The owner played the first cut and said the water "gets brighter as it goes deeper like fog,
// but it should become shadowier". It did, and for a reason worth writing down: the murk was an
// absolute radiance (0.35) written into a linear scene target that runs well above 1 in daylight,
// and each body's colour is normalised by its own peak, so every body on every planet at every hour
// reached that one level. Anything darker than it — a shaded bed ten metres down — was *raised*
// toward it by distance, which is a fog that lightens. Now the level is `murkLight` times the share
// of `lightRef` the frame's own lights come to (`lightOf`, `lightShareFor`, from the record
// `World.fillFxLights` fills just before the chain runs) and it falls with the camera's own depth
// over `lightDepth` toward `deepFloor`, which is a floor and not a level, so deep water is very dark
// and never pure black. With Effects off none of this exists, as none of the pass does.
//
// The whole look eases in over the first half metre (`easeIn`). "Am I under water" is answered with
// a margin and hysteresis, so for a band reaching above the plain surface the answer is yes and the
// depth is 0; at depth 0 every upward ray leaves the water at once and only the downward half of
// the screen would be graded, which is a hard line across the middle of the view drawn while the
// camera is still in the air. Easing on the depth makes depth 0 a frame this pass leaves alone.
//
// It asks for no product. The scene's own depth texture is enough, and the chain's buffers carry no
// depth of their own, so sampling it here is allowed (rule R2 in `postfx.ts`).
//
// It costs nothing while the camera is dry: `enabled` says no and the chain skips it entirely. The
// only frames it draws are the ones the camera is under a water surface, which the game works out
// once and hands over on the frame context.
import * as THREE from 'three';
import type { FxPassId } from '../fxRegistry.ts';
import type { FxFrameContext } from './context';
import { ShaderFxPass } from './pass';
import { FX_FULLSCREEN_VERTEX, FX_HASH, FX_LINEARIZE } from './glsl';
import {
  createUnderwaterLook,
  deriveUnderwater,
  lightOf,
  lightShareFor,
  shimmerCellsAcross,
  shimmerCellsMax,
  shimmerFadeStart,
  shimmerPhase,
  SHIMMER_FINE,
  SHIMMER_PERIOD,
  UNDERWATER_FALLBACK,
  UNDERWATER_TUNE,
  type UnderwaterLook,
  type Vec3,
} from './underwaterMath.ts';

const UNDERWATER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uNearFar: { value: new THREE.Vector2(0.05, 9000) },
    /** (tan(fov/2) x aspect, tan(fov/2)): the view ray from a screen place, and the screen's shape. */
    uTanHalfFov: { value: new THREE.Vector2(1, 1) },
    /** World up in the camera's own space: which way a pixel's ray is climbing. */
    uUpView: { value: new THREE.Vector3(0, 1, 0) },
    /** Per channel, 1 / metres. */
    uExtinction: { value: new THREE.Vector3() },
    /** The colour a far pixel becomes, in scene units. */
    uMurk: { value: new THREE.Vector3() },
    uVeil: { value: 0 },
    /** x: metres the camera is under the surface; y: 1 while the murk stops at the surface overhead. */
    uCeiling: { value: new THREE.Vector2(0, 1) },
    /**
     * x: uv the whole frame may move; y: noise cells across the screen's **height** (the width
     * carries `aspect` times as many — see the layout line below and `shimmerCellsAcross`);
     * z: the drift's phase.
     */
    uShimmer: { value: new THREE.Vector3() },
    /**
     * The comparison knob only. y is `shimmerReach`: **0, the default, is the lens** and the branch
     * below is not taken at all; above 0 the old near-field rule is back, whole out to x metres of
     * water in front of the pixel and gone by y.
     */
    uShimmerFade: { value: new THREE.Vector2(0, 0) },
  },
  vertexShader: FX_FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform highp sampler2D tDepth;
    uniform vec2 uNearFar;
    uniform vec2 uTanHalfFov;
    uniform vec3 uUpView;
    uniform vec3 uExtinction;
    uniform vec3 uMurk;
    uniform float uVeil;
    uniform vec2 uCeiling;
    uniform vec3 uShimmer;
    uniform vec2 uShimmerFade;
    varying vec2 vUv;
    ${FX_LINEARIZE}
    ${FX_HASH}

    // Value noise that repeats every ${SHIMMER_PERIOD} cells in both axes (the period is written in
    // from SHIMMER_PERIOD in underwaterMath.ts, so the two cannot disagree). Plain value noise has
    // no period at all, which is why the drift below could not simply have its phase reset.
    float uwNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      vec2 a = mod(i, ${SHIMMER_PERIOD}.0);
      vec2 b = mod(i + 1.0, ${SHIMMER_PERIOD}.0);
      return mix(mix(fxHash(a), fxHash(vec2(b.x, a.y)), f.x), mix(fxHash(vec2(a.x, b.y)), fxHash(b), f.x), f.y);
    }

    // Two octaves of that drifting against each other: 0 to 1, mean 0.5. The same shape as the heat
    // haze's, slower and much smaller, so it reads as light bending rather than as heat. Over one
    // wrap of the phase (0 to 2 x the period) the first octave moves (2P, P) cells and the second
    // (-P, -2P), each a whole number of periods, so the field at the wrap is the field at 0 exactly.
    // The finer octave's rate is written in from SHIMMER_FINE, because shimmerCellsMax -- the
    // largest shimmerCells that does not tile inside one view -- is worked out from that number.
    float wobble(vec2 p, float phase) {
      return uwNoise(p + phase * vec2(1.0, 0.5)) * 0.65 + uwNoise(p * ${SHIMMER_FINE} - phase * vec2(0.5, 1.0)) * 0.35;
    }

    void main() {
      // Where this pixel stands: along the view axis from the depth, then along its own ray.
      float z = fxViewZ(texture2D(tDepth, vUv).x, uNearFar.x, uNearFar.y);
      vec2 ndc = vUv * 2.0 - 1.0;
      vec3 ray = vec3(ndc.x * uTanHalfFov.x, ndc.y * uTanHalfFov.y, -1.0);
      float spread = length(ray);
      vec3 dir = ray / spread;
      float dist = z * spread;

      // How much water this pixel is seen through: how far off it is, but never further than the
      // way out through the surface overhead, since water writes no depth and the sky beyond it
      // would otherwise carry the far plane's. The divisor is held off zero rather than the test
      // being made at an angle threshold, so the answer moves smoothly through the horizon.
      float path = dist;
      float up = dot(dir, uUpView);
      if (uCeiling.y > 0.5 && up > 0.0) path = min(path, uCeiling.x / max(up, 1e-4));
      if (!(path >= 0.0)) path = 0.0;

      // The shimmer: read the picture from a little to one side, by the same amount everywhere in
      // the frame, so the whole view wobbles as if through a lens rather than only what is close.
      // The murk below still uses this pixel's own path and not the one it borrows from, which
      // keeps a silhouette's murk from jumping as the offset crosses it, and the offset is scaled by
      // the aspect in v so the wobble is as wide as it is tall in pixels.
      vec2 uv = vUv;
      float aspect = uTanHalfFov.x / max(uTanHalfFov.y, 1e-6);
      float amp = uShimmer.x;
      // The old near-field rule, for comparison only and off at the default (uShimmerFade.y is 0).
      // One uniform decides it for every pixel in the draw, so the branch never diverges.
      if (uShimmerFade.y > 0.0) amp *= 1.0 - smoothstep(uShimmerFade.x, uShimmerFade.y, path);
      if (amp > 1e-5) {
        // vUv.x spans the width, so this lays uShimmer.y cells down the HEIGHT and aspect times as
        // many across the width, which is what keeps a cell square in pixels. Every figure quoted
        // across the width therefore carries the aspect: shimmerCellsAcross, shimmerCellsMax.
        vec2 p = vUv * vec2(aspect, 1.0) * uShimmer.y;
        vec2 off = (vec2(wobble(p, uShimmer.z), wobble(p.yx + 11.3, uShimmer.z)) - 0.5) * amp * vec2(1.0, aspect);
        // NaN, or further than any strength should reach: no move at all.
        if (abs(off.x) + abs(off.y) < 0.2) uv = clamp(vUv + off, vec2(0.0), vec2(1.0));
      }
      vec3 c = texture2D(tDiffuse, uv).rgb;

      vec3 t = exp(-uExtinction * path);
      c = c * t + uMurk * (1.0 - t);
      c = mix(c, uMurk, uVeil);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

/**
 * The look under water. A scene pass: after the god rays, so scattered sunlight is graded by the
 * water it comes through like anything else, and before the depth of field, so the lens softens and
 * smears what the water has already done rather than the other way round.
 */
export class UnderwaterPass extends ShaderFxPass {
  readonly id: FxPassId = 'underwater';

  /** This frame's numbers, kept so nothing allocates. */
  private readonly look: UnderwaterLook = createUnderwaterLook();
  private readonly body: Vec3 = [0, 0, 0];
  /** What the last frame drawn was given, for `__debug.underwater` only. */
  private readonly last = { depth: 0, opacity: 0, daylight: 1, light: 0, lightShare: 1, depthWasFinite: false, drewFrame: -1, aspect: 1 };

  constructor() {
    super(UNDERWATER);
  }

  /**
   * `cameraSubmerged`, never `cameraUnderwater`. The two are different facts: the second is the safe
   * one the reflections and the flare read and is true for up to a metre and a half of *air* over
   * the open sea, because a crest could be there. Drawing from it would paint the screen while the
   * player stood in the shallows. This costs no pixel either way -- `easeIn` is 0 at depth 0, so
   * every frame in that band came out bit-for-bit as it went in -- but it is one whole-screen draw
   * a frame that the game now never makes.
   */
  enabled(ctx: FxFrameContext): boolean {
    if (ctx.settings.underwaterStrength <= 0 && ctx.settings.underwaterShimmerStrength <= 0) return false;
    return ctx.cameraSubmerged;
  }

  /**
   * Why it did not draw: the switch, then its own strengths, then the frame — the god rays' order,
   * and for the same reason. `postfx` falls through to "forced off" and "its setting is off" only
   * on a null, so answering about the frame first would hide both behind "the camera is not under
   * water" on every dry frame, which is almost every frame there is.
   */
  reason(ctx: FxFrameContext): string | null {
    if (!ctx.settings.underwater) return null;
    if (ctx.settings.underwaterStrength <= 0 && ctx.settings.underwaterShimmerStrength <= 0) return 'the underwater strength and its shimmer are both zero';
    if (!ctx.cameraSubmerged) return ctx.cameraUnderwater ? 'the camera is within reach of a crest but still above the surface' : 'the camera is not under water';
    return null;
  }

  prepare(ctx: FxFrameContext): void {
    // The three facts the game hands over beside `cameraSubmerged` (src/core/fx/context.ts): the
    // depth, the body's own colour and that body's own opacity. All three are required fields, so
    // there is no optional reading here and a rename would fail the build rather than leaving the
    // pass wearing a fallback for ever. Only a value that is not a number falls back, which is a
    // guard against a NaN and not against a shape.
    const given = ctx.underwaterColor;
    this.body[0] = given.r;
    this.body[1] = given.g;
    this.body[2] = given.b;
    const depthWasFinite = Number.isFinite(ctx.underwaterDepth);
    const depth = depthWasFinite ? Math.max(0, ctx.underwaterDepth) : UNDERWATER_FALLBACK.depth;
    const opacity = Number.isFinite(ctx.underwaterOpacity) ? ctx.underwaterOpacity : UNDERWATER_FALLBACK.opacity;
    const S = ctx.settings;
    const T = UNDERWATER_TUNE;
    // What is lighting the world this frame, from the record `World.fillFxLights` refilled a few
    // lines before the chain runs: the sun (or the moon), the sky half of the hemisphere, the fill
    // and a lit room's own ambient and parallel. The murk is a share of this rather than a fixed
    // radiance, which is what stops a dark pool at dusk reaching the same grey-blue as open sea at
    // noon, and `lightOf` answers with the reference day when the record holds nothing at all.
    const light = lightOf(ctx.lights, T);
    const look = deriveUnderwater(this.body, opacity, depth, light, S.underwaterStrength, S.underwaterShimmerStrength, T, this.look);

    const u = this.material.uniforms;
    u.tDepth.value = ctx.depth;
    (u.uNearFar.value as THREE.Vector2).set(ctx.near, ctx.far);
    (u.uTanHalfFov.value as THREE.Vector2).copy(ctx.tanHalfFov);
    // World up in the camera's space: the view matrix applied to (0, 1, 0), which is its second column.
    const e = ctx.view.elements;
    (u.uUpView.value as THREE.Vector3).set(e[4], e[5], e[6]).normalize();
    (u.uExtinction.value as THREE.Vector3).set(look.extinction[0], look.extinction[1], look.extinction[2]);
    (u.uMurk.value as THREE.Vector3).set(look.murk[0], look.murk[1], look.murk[2]);
    u.uVeil.value = look.veil;
    (u.uCeiling.value as THREE.Vector2).set(depth, T.ceiling ? 1 : 0);
    // The drift's phase, wrapped in double precision at a whole number of the noise's own periods
    // (`shimmerPhase`), so the field after the wrap is the field before it and no shader ever
    // carries a large, growing time into a hash.
    (u.uShimmer.value as THREE.Vector3).set(look.shimmer, Math.max(0.1, T.shimmerCells), shimmerPhase(ctx.time, T));
    // 0 at the default, which is the lens: the shader's fade branch is then not taken at all.
    const reach = Math.max(0, T.shimmerReach);
    (u.uShimmerFade.value as THREE.Vector2).set(shimmerFadeStart(reach), reach);

    this.last.depth = depth;
    this.last.opacity = opacity;
    this.last.daylight = ctx.daylight;
    this.last.light = light;
    this.last.lightShare = lightShareFor(light, T);
    this.last.depthWasFinite = depthWasFinite;
    this.last.drewFrame = ctx.frame;
    // The window's own shape, kept so `describe` can answer about the lattice in the width's terms
    // rather than in the tune's. `uTanHalfFov` is (tan(fov/2) x aspect, tan(fov/2)).
    this.last.aspect = ctx.tanHalfFov.x / Math.max(ctx.tanHalfFov.y, 1e-6);
  }

  /** For `__debug.underwater`: what the last frame drawn was given and what it came to. Reads stored values only. */
  describe(): object {
    const l = this.look;
    return {
      drewFrame: this.last.drewFrame,
      cameraDepth: this.last.depth,
      bodyOpacity: this.last.opacity,
      daylight: this.last.daylight,
      // The light the world really had this frame (sun + sky + fill + a lit room's own), and that
      // over `lightRef`, held between `nightFloor` and `lightCeil`: what the murk's level is a share
      // of. A share near 1 is a planet at noon; the murk is that much of `murkLight` at the surface.
      sceneLight: this.last.light,
      lightShare: this.last.lightShare,
      // False only on a frame whose handed-over depth was not a number and the fallback was worn.
      depthWasFinite: this.last.depthWasFinite,
      bodyColor: [this.body[0], this.body[1], this.body[2]],
      // 0 at the surface line and 1 a short way under: how much of the whole look this depth has brought in.
      ease: l.ease,
      // Metres each channel travels before it has lost 1 - 1/e of itself.
      channelMetres: l.extinction.map((k) => (k > 1e-9 ? 1 / k : Infinity)),
      murk: [l.murk[0], l.murk[1], l.murk[2]],
      veil: l.veil,
      // How far the whole frame may move, in uv across the screen's width. The same for every pixel
      // unless `shimmerReach` (in this call's `tuning`) has been given the old near-field rule back.
      shimmerUv: l.shimmer,
      // The lattice in the terms the owner can see it in, on the window they are really playing on.
      // `shimmerCells` is counted across the *height*; the width carries `aspect` times as many, so
      // a figure worked out by dividing the window's width by the tune's own number is out by the
      // aspect. `cellsMax` is the largest `shimmerCells` this window can take before the finer
      // octave repeats inside one view.
      shimmerLattice: {
        aspect: this.last.aspect,
        cellsDown: Math.max(0.1, UNDERWATER_TUNE.shimmerCells),
        cellsAcross: shimmerCellsAcross(Math.max(0.1, UNDERWATER_TUNE.shimmerCells), this.last.aspect),
        cellsMax: shimmerCellsMax(this.last.aspect),
      },
    };
  }
}
