// The clouds' light (the GPU port's pass 3, wave 1, maker V; the design's 2.2): what a sample of cloud sends toward the eye,
// lit only through pass 2's air, so a cloud reddens at dusk and greys under a storm of its own accord and no colour of SWG's
// is in it.
//
//   - **the sun at the sample**: each body's top-of-air light (`AIR.frame`'s sun, second sun and moon, an eclipse already
//     taken out of it) times the air's transmittance from the sample's own height toward it (pass 2's transmittance table,
//     `AirTables.transmittanceAt`), times what gets through the cloud toward the light (the march's six light steps in a cone
//     and one far, along `AIR.frame.lightDir`: the sun by day, the moon by night; Tatooine's second sun takes the first's
//     steps, standing 1.5 degrees from it);
//   - **the phase**: two Henyey-Greenstein lobes (a forward one for the silver lining and the glow round the sun, a back one
//     for a sunlit face seen with the sun behind), mixed by a share;
//   - **multiple scattering**: three octaves (Wrenninge 2013), each with the light's extinction, its share and the phase's
//     eccentricity times its own power of a factor, so a thick cloud is not black inside;
//   - **powder**: the thin edges facing away from the light darkened (Schneider 2015), less toward the sun;
//   - **the ambient**: the air's sky view's light about the sky (its zenith and its horizon both ways from the sun), carried to
//     each sample's height by the multiple-scattering table's ratio, darker at a layer's belly than its top.
//
// Written over operations (`LightOps`: plain numbers for the node tests, three's shading language for the card), so the
// march's graph is these functions themselves. The air's readers (`transmittanceAt`, `multiScatterAt`, `skyRadiance`) are
// the card's alone. Pure: no three here; the march hands its node operations in.

import { CLOUD_LOOK } from './cloudShape.ts';

/** The operations the light is written over: numbers or nodes. */
export interface LightOps<N> {
  k(v: number): N;
  add(a: N, b: N): N;
  sub(a: N, b: N): N;
  mul(a: N, b: N): N;
  div(a: N, b: N): N;
  max(a: N, b: N): N;
  exp(a: N): N;
  sqrt(a: N): N;
  mix(a: N, b: N, t: N): N;
}

export const LIGHT_NUM: LightOps<number> = {
  k: (v) => v,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  max: Math.max,
  exp: Math.exp,
  sqrt: Math.sqrt,
  mix: (a, b, t) => a + (b - a) * t,
};

/** The look's light numbers as the light reads them (numbers, or a graph's uniforms). */
export interface LightLook<N> {
  forward: N;
  back: N;
  forwardShare: N;
  octaveExtinction: N;
  octaveLight: N;
  octavePhase: N;
  powder: N;
  powderDepth: N;
}

/** The look's light dials as numbers (the twin's). */
export function lightLookNumbers(out?: LightLook<number>): LightLook<number> {
  const o = out ?? { forward: 0, back: 0, forwardShare: 0, octaveExtinction: 0, octaveLight: 0, octavePhase: 0, powder: 0, powderDepth: 0 };
  const L = CLOUD_LOOK;
  o.forward = L.forward;
  o.back = L.back;
  o.forwardShare = L.forwardShare;
  o.octaveExtinction = L.octaveExtinction;
  o.octaveLight = L.octaveLight;
  o.octavePhase = L.octavePhase;
  o.powder = L.powder;
  o.powderDepth = L.powderDepth;
  return o;
}

const FOUR_PI = 4 * Math.PI;

/** Henyey-Greenstein's phase at eccentricity `g` and the cosine `c` of the angle between the light's way and the view's (per steradian). */
export function hgOf<N>(o: LightOps<N>, g: N, c: N): N {
  const g2 = o.mul(g, g);
  const den = o.max(o.sub(o.add(o.k(1), g2), o.mul(o.mul(o.k(2), g), c)), o.k(1e-6));
  return o.div(o.sub(o.k(1), g2), o.mul(o.k(FOUR_PI), o.mul(den, o.sqrt(den))));
}

/** The two lobes at an eccentricity factor `s` (an octave's power of `octavePhase`), mixed by the forward share. */
export function phaseOf<N>(o: LightOps<N>, look: LightLook<N>, s: N, c: N): N {
  return o.mix(hgOf(o, o.mul(look.back, s), c), hgOf(o, o.mul(look.forward, s), c), look.forwardShare);
}

/**
 * The light a unit of the body's light at the sample sends toward the eye, per unit scattering, with multiple scattering's
 * three octaves: `tau` the cloud's optical depth toward the light (the light march's), `c` the cosine between the light's
 * way (from the sample toward the light) and the way to the eye's opposite (the view's way). Octave i takes `exp(−a^i τ)`,
 * `b^i` of the light and the phase at `c^i` of each lobe's eccentricity.
 */
export function octavesOf<N>(o: LightOps<N>, look: LightLook<N>, tau: N, c: N): N {
  const a1 = look.octaveExtinction;
  const b1 = look.octaveLight;
  const c1 = look.octavePhase;
  const a2 = o.mul(a1, a1);
  const b2 = o.mul(b1, b1);
  const c2 = o.mul(c1, c1);
  const l0 = o.mul(o.exp(o.mul(tau, o.k(-1))), phaseOf(o, look, o.k(1), c));
  const l1 = o.mul(o.mul(b1, o.exp(o.mul(o.mul(tau, a1), o.k(-1)))), phaseOf(o, look, c1, c));
  const l2 = o.mul(o.mul(b2, o.exp(o.mul(o.mul(tau, a2), o.k(-1)))), phaseOf(o, look, c2, c));
  return o.add(o.add(l0, l1), l2);
}

/**
 * Powder (Schneider 2015): a sample of extinction `sigma` (per metre) keeps `1 − exp(−2σ·depth)` of its light where the dial is
 * whole, so a thin edge seen with the light behind it is darker than the heart; nothing toward the light itself (`c` 1), where
 * the silver lining belongs.
 */
export function powderOf<N>(o: LightOps<N>, look: LightLook<N>, sigma: N, c: N): N {
  const p = o.sub(o.k(1), o.exp(o.mul(o.mul(sigma, look.powderDepth), o.k(-2))));
  const away = o.mul(o.sub(o.k(1), c), o.k(0.5));
  return o.mix(o.k(1), p, o.mul(look.powder, away));
}

/**
 * One step's light toward the eye and what gets through it (Hillaire 2016's integration, exact for a step of one medium): the
 * source `S` (light per unit length per unit extinction already times the albedo) over a step of extinction `sigma` and length
 * `ds`, into what the step adds at transmittance one: `S · (1 − exp(−σ ds))`. The march multiplies by the transmittance so far.
 */
export function stepLightOf<N>(o: LightOps<N>, S: N, sigma: N, ds: N): N {
  return o.mul(S, o.sub(o.k(1), o.exp(o.mul(o.mul(sigma, ds), o.k(-1)))));
}

/**
 * The light march's steps (the design's "six light steps in a cone plus one far"): each step's distance from the sample
 * toward the light (metres, the middle of its stretch) and its length; the cone's offsets, a fixed kernel of unit directions
 * scaled by the distance times `CLOUD_LOOK.cone`. Not dials: the steps' layout, which `CLOUD_TUNE.lightReach` scales.
 */
export const LIGHT_STEPS = {
  /** Each step's end as a share of the reach (the far step last): the first five within a third, the far one to the whole. */
  ends: [0.02, 0.05, 0.1, 0.17, 0.26, 0.38, 1] as readonly number[],
  /** The cone's kernel (unit vectors, one a step; the far step on the axis). */
  kernel: [
    [0.38, 0.62, -0.69],
    [-0.81, 0.33, 0.48],
    [0.12, -0.91, 0.39],
    [0.72, 0.21, 0.66],
    [-0.31, -0.42, -0.85],
    [0.05, 0.98, 0.18],
    [0, 0, 0],
  ] as readonly (readonly [number, number, number])[],
} as const;

/**
 * The ambient's height factor: the air's multiple scattering at the sample's height over the camera's (the air thins and its
 * glow with it), held to a quarter and four times, times the belly's share at the sample's height share `h` of its layer.
 */
export function ambientShareOf<N>(o: LightOps<N>, msHere: N, msCamera: N, h: N, belly: N): N {
  const r = o.div(msHere, o.max(msCamera, o.k(1e-12)));
  const held = o.max(o.k(0.25), o.mul(o.k(-1), o.max(o.mul(r, o.k(-1)), o.k(-4))));
  return o.mul(held, o.mix(belly, o.k(1), h));
}
