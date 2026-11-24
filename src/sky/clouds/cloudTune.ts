// The clouds' march's dials and its switch (the GPU port's pass 3, wave 1, maker V; the design's 2.2 and 2.6): pure, so the
// console, the debug menu, the world and the tests read them on either renderer without loading anything of three's WebGPU
// build. The march itself (`cloudMarch.ts`) is WebGPU's alone and reads these by reference once a frame.
//
// The switch starts OFF (the brief: `__debug.clouds({ on: true })`; the Clouds row is wave 5's). Off, nothing of the clouds
// is made or drawn and the frame is the base's: the sheets, the flare's sheets and the storm fades as they were.

import { CLOUD_LAYER_VEC4 } from './cloudLayers.ts';

/**
 * The march's numbers: `CLOUD_TUNE` (the design's "ray budget, trace, update share, steps, reach 50 km, history, resets";
 * the update share, the history and the resets are wave 2's). Each a dial with its start and reason; a frame reads them.
 */
export const CLOUD_TUNE = {
  /** The trace's share of the display each way (the design's half): 0.5, a quarter of the display's pixels marched. */
  trace: 0.5,
  /**
   * The most trace pixels (rays) a frame: 1,100,000, a 1600 by 900 display's half (360,000) three times over, so only a 4K
   * display's half (2.07 million) is held down to it, its trace shrunk evenly both ways.
   */
  rayBudget: 1_100_000,
  /** The most primary steps a ray takes: 128 (the design's High 64 overhead and 128 toward the horizon, one count for now). */
  steps: 128,
  /** The step over the first kilometre from the lens, metres (the design's "finely stepped for the first kilometre"): 30. */
  nearStep: 30,
  nearReach: 1000,
  /** Past it, a step is this share of its distance from the lens (the screen's detail falls off as distance grows): 0.025. */
  grow: 0.025,
  /** The longest step, metres: 900 (a step past a layer's thickness would step over its clouds on most jitters). */
  farStep: 900,
  /** The march's reach, metres (the design's 50 km): past it the sky stays clear. */
  reach: 50_000,
  /** The light march's reach toward the light, metres (its six cone steps within the first 38%, the far one to the whole): 1800. */
  lightReach: 1800,
  /** A ray ends when this little of what is behind it gets through (the design's 1%). */
  minTransmittance: 0.01,
  /** Over clear map a step grows by this factor until cloud is met again (the design's "skips clear map"): 2. */
  clearGrow: 2,
  /**
   * Each step's sample jittered within its stretch by a pixel's own fraction that moves every frame (the edge smoothing gathers
   * it, with no history of the march's own until wave 2): 1 on; 0 samples each step's middle (steady, and sliced into bands).
   */
  jitter: 1,
  /** How far apart (a share of a pixel's distance) two depths still count as one surface when the trace is laid on the picture: 0.08. */
  depthMatch: 0.08,
};

/** The dials' ranges (the menu's sliders and the console's clamps). */
export const CLOUD_TUNE_RANGE: Readonly<Record<keyof typeof CLOUD_TUNE, readonly [number, number]>> = {
  trace: [0.2, 1],
  rayBudget: [50_000, 4_000_000],
  steps: [8, 256],
  nearStep: [2, 400],
  nearReach: [0, 8000],
  grow: [0.002, 0.2],
  farStep: [50, 5000],
  reach: [2000, 120_000],
  lightReach: [100, 8000],
  minTransmittance: [0.0005, 0.2],
  clearGrow: [1, 8],
  jitter: [0, 1],
  depthMatch: [0.005, 1],
};

/** The loop bound the card's march is built with: `CLOUD_TUNE.steps` moves under it with nothing built. */
export const CLOUD_STEPS_MOST = 256;

/**
 * The switch's draw side: whether the clouds are wanted (the console's `on`), whether everything they need has landed
 * (`ready`: the noise baked, the march's and the composite's pipelines and the map's), and what the last frame did. Written by
 * the console and the march; read by the world (the sheets and the storm fades) and the flare, from the one verdict below.
 */
export const CLOUD_DRAW = {
  want: false,
  /** Everything built and baked (the march's own word). */
  ready: false,
  /** Why not ready, in words (the march's). */
  waiting: 'not asked',
  /** Whether the march drew last frame (the flare reads its trace only then). */
  drew: false,
  /** The frame the march last drew. */
  drewFrame: -1,
  /** Turned on or off how many times this session (the pipeline counter's proof). */
  switched: 0,
  /** The march's own view over the picture: 0 the clouds, 1 their mean distance (white at the reach), 2 what gets through them. */
  view: 0,
};

/** The march's views by name (the console's `{ view: 'distance' }`; the map's own views are the map's maker's). */
export const MARCH_VIEWS = { off: 0, distance: 1, transmittance: 2 } as const;

/** Set the march's view (null or 'off' the clouds as drawn): answers what it now shows, in words. Builds nothing (a uniform). */
export function setMarchView(name: string | null): string {
  const v = name && name in MARCH_VIEWS ? MARCH_VIEWS[name as keyof typeof MARCH_VIEWS] : 0;
  CLOUD_DRAW.view = v;
  return v === 1 ? "the march's mean cloud distance over the picture (black at the lens, white at the reach)" : v === 2 ? 'what gets through the clouds over the picture (white clear, black opaque)' : 'the clouds as drawn';
}

/**
 * What the map's maker hands the march each frame (written in place by `cloudMapGpu.ts`'s frame, read by the march's): the
 * packed stack (the contract's `packStack` out) and how many of its slots are in use, each layer's FULL drift and wind (x, z,
 * vx, vz in metres and m/s, never wrapped, from the closed form: the march takes the camera less the drift modulo each noise's
 * tile in double precision, so a streaked layer never jumps when the contract's 65,536 m wrap turns over), the live layers
 * (their types, shares, seeds and turns make each layer's streak), and a number that moves whenever the layers change.
 */
export interface CloudMarchFeed {
  stack: Float32Array | null;
  count: number;
  drift: Float64Array | null;
  layers: readonly { types: readonly string[]; shares: readonly number[]; seed: number; turn: number }[];
  version: number;
}

export const CLOUD_FEED: CloudMarchFeed = { stack: null, count: 0, drift: null, layers: [], version: 0 };

/** Set the switch (the console's `on`): answers what it now is. Turning it on asks the march to build; nothing draws until ready. */
export function setCloudsOn(on: boolean): boolean {
  if (on !== CLOUD_DRAW.want) CLOUD_DRAW.switched++;
  CLOUD_DRAW.want = on;
  if (!on) CLOUD_DRAW.drew = false;
  return CLOUD_DRAW.want;
}

/**
 * The one verdict every reader asks (the September march's lesson: a question asked before the scene is drawn must refuse
 * wherever the pass refuses, from the same verdicts): the clouds draw this frame where they are wanted and ready, the air is
 * drawing (our sky over a planet: never on SWG's Sky row, where no pass is registered), and the camera is neither in a space
 * zone nor under water. Indoors they draw, the rays stopped at the walls by the depth.
 */
export function cloudsWouldDraw(space: boolean, underwater: boolean, airOn: boolean): boolean {
  return cloudsMarching() && airOn && !space && !underwater;
}

/**
 * Whether any slot of a packed stack (the contract's `packStack` out, `count` slots) would put cloud in the sky: on, with a
 * cover and a density over nought (`packBands`' own rule). With none, nothing is drawn at all: a march over an empty sky would
 * be the picture copied at the march's full cost (the September march's fourth bug: a strength of nought drew `scene · 1 + 0`
 * and reported that it drew).
 */
export function stackDraws(stack: Float32Array | null, count: number): boolean {
  if (!stack) return false;
  const V = CLOUD_LAYER_VEC4 * 4;
  for (let i = 0; i < count; i++) {
    const o = i * V;
    if (stack[o + 7] > 0 && stack[o + 11] > 0 && stack[o + 2] > 0) return true;
  }
  return false;
}

/** The march is on, ready and has a layer to draw (the world's and the flare's word, before the frame's place is known). */
export function cloudsMarching(): boolean {
  return CLOUD_DRAW.want && CLOUD_DRAW.ready && stackDraws(CLOUD_FEED.stack, CLOUD_FEED.count);
}

/** Why the clouds would not draw, in words (null when they would), for the report. */
export function cloudsWhyNot(space: boolean, underwater: boolean, airOn: boolean): string | null {
  if (!CLOUD_DRAW.want) return 'off (__debug.clouds({ on: true }) turns the march on)';
  if (!CLOUD_DRAW.ready) return `waiting: ${CLOUD_DRAW.waiting}`;
  if (!stackDraws(CLOUD_FEED.stack, CLOUD_FEED.count)) return 'no layer would draw (none on, or every one clear or of no density): nothing is marched or laid on';
  if (!airOn) return "the air is not drawing (SWG's Sky row, space, or between worlds): the clouds are our sky's";
  if (space) return 'a space zone: the clouds do not run in space';
  if (underwater) return 'under water: the clouds are not marched under water';
  return null;
}

/**
 * The storm fade the discs, the stars, the Milky Way and the bodies take (pass 2's "until pass 3" fades, the design's 2.4):
 * the weather's overcast where the march is not drawing, as it was; where it is, the clouds hide the sky by covering it, so
 * only what the clouds do not draw keeps its fade: a dust storm's (pass 6's) and a fog's (`fog` its sunless share), the larger.
 */
export function stormFadeOf(overcast: number, dust: number, fog: number, marching: boolean): number {
  if (!marching) return overcast;
  return dust > fog ? dust : fog;
}

/** Set the march's dials from the console (each held to its range): answers what was held or refused, in words. */
export function tuneMarch(o: Record<string, unknown>): string[] {
  const said: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (!(k in CLOUD_TUNE)) {
      said.push(`${k} is not a march dial (${Object.keys(CLOUD_TUNE).join(', ')})`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`${k} wants a number`);
      continue;
    }
    const [lo, hi] = CLOUD_TUNE_RANGE[k as keyof typeof CLOUD_TUNE];
    const c = v < lo ? lo : v > hi ? hi : v;
    if (c !== v) said.push(`${k} held to ${c} (its range ${lo} to ${hi})`);
    (CLOUD_TUNE as Record<string, number>)[k] = c;
  }
  return said;
}

/**
 * The trace's size for a display of `cssW` by `cssH` CSS pixels (the design: "half the display's width and height, capped by a
 * ray budget, so neither a Retina pixel ratio nor Ultra's render scale multiplies it"), into `out` as [width, height].
 */
export function traceSizeOf(cssW: number, cssH: number, out: Int32Array | number[]): void {
  const s = CLOUD_TUNE.trace;
  let w = Math.max(1, Math.ceil(cssW * s));
  let h = Math.max(1, Math.ceil(cssH * s));
  const budget = CLOUD_TUNE.rayBudget;
  if (w * h > budget) {
    const k = Math.sqrt(budget / (w * h));
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  }
  out[0] = w;
  out[1] = h;
}

/**
 * Where a ray ends, metres (the march's rule, written once here for the node tests; the card's `skyDepth` and `viewZ` are its
 * graph): a depth texel that holds the clear (nought under reversed depth, one otherwise) is the SKY and the ray runs to the
 * reach, never a surface at the far plane (the September march's second bug); any other is the solid's view depth along the
 * ray (`viewZ · slope`), held to the reach.
 */
export function rayEndM(depth: number, near: number, far: number, reversed: boolean, slope: number, reach: number): number {
  const sky = reversed ? depth <= 0 : depth >= 1;
  if (sky) return reach;
  const z = reversed ? (near * far) / (near + depth * (far - near)) : (near * far) / (far - depth * (far - near));
  const d = z * slope;
  return d < reach ? d : reach;
}

/**
 * The trace's texel coordinate under a pixel at a share `st` of the screen (the composite's rule): `st · size − 0.5`, the
 * trace's OWN size, whatever share of the display it is marched at (the September march's third bug read a half-size
 * product's taps at a quarter and at the whole).
 */
export function traceTexelOf(st: number, size: number): number {
  return st * size - 0.5;
}

/**
 * The march's step at a distance `t` (metres) from the lens (the card's rule, written once here for the node tests): the near
 * step over the first kilometre, past it the distance's share, never past the longest.
 */
export function stepAt(t: number): number {
  const T = CLOUD_TUNE;
  if (t < T.nearReach) return T.nearStep;
  const g = t * T.grow;
  return g < T.nearStep ? T.nearStep : g > T.farStep ? T.farStep : g;
}
