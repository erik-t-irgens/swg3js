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
  /**
   * The most primary steps a ray looking straight up takes: 64, the design's High (2.6; Ultra's 96 set by the tier,
   * `setCloudTier`). A ray between takes a share between this and `stepsHorizon` by how high it looks (wave 2, maker T).
   */
  steps: 64,
  /** The most a ray along the horizon takes, where rays are longest: 128, the design's High (Ultra's 192 set by the tier). */
  stepsHorizon: 128,
  /**
   * One more light step in the cone toward the light (1) or not (0): the design's Ultra takes eight light steps, High its six
   * and the far one. Set by the tier; a dial so either look can be seen on any tier.
   */
  lightExtra: 0,
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
   * Each step's sample jittered within its stretch by a pixel's own fraction that moves every frame, far clouds included (the
   * fill-in's history gathers it, wave 2): 1 on; 0 samples each step's middle (steady, and sliced into bands).
   */
  jitter: 1,
  /** How far apart (a share of a pixel's distance) two depths still count as one surface when the trace is laid on the picture: 0.08. */
  depthMatch: 0.08,
  // ---- wave 2 (maker T): the fill-in, flight, the storm reach and the fade (the design's 2.2; the plan's ranks 3 and 5)
  /**
   * The fill-in (1): a quarter of the trace marched a frame, one pixel of each two by two, the rest reprojected from the history
   * and held to the new rays round it (Red Dead Redemption 2's way); 0 marches every trace pixel every frame, as wave 1 did (for
   * a side by side, and the bench's own "every pixel" line).
   */
  reuse: 1,
  /**
   * How much of its history a freshly marched pixel keeps, the rest its new ray: 0.8 averages about nine of its rays (each pixel
   * is marched every fourth frame: about half a second at 60 fps), enough to gather a moving jitter's grain and far slices away
   * while a drifting heap's edge still follows within a few frames.
   */
  history: 0.8,
  /**
   * How far past the spread of the new rays round a pixel its history may stand, a share of that spread each side: 0.25, so the
   * average the history holds (inside the jittered rays' spread) passes while a cloud gone from under it is cut back.
   */
  clampWiden: 0.25,
  /** The history's weight starts to fall once its point moves this many trace pixels a frame (the design's "over a trace pixel"): 1. */
  motionFrom: 1,
  /** ...and is down to `motionKeep` by this many: 8, a fast turn, where a reprojected history is blurred by its own resampling. */
  motionTo: 8,
  /** The history's weight left at `motionTo` and past it: 0.35, so a turning view keeps some of its averaging rather than its grain. */
  motionKeep: 0.35,
  /** A history whose cloud distance changed by more than this share is thrown away (the design's 10%): 0.1. */
  distChange: 0.1,
  /**
   * How hard a cloud tells the edge smoothing to trust the new frame where it covers the picture (the motion buffer's reactive
   * mark, times what the cloud covers), only where the trace is marched whole with no history of its own (flight mode): 0.05,
   * which with the smoothing's own reactive share (0.8) takes its new frame from 5% to 9%, so a deck flown through follows the
   * hull within a few frames more; at 0.25 the smoothing averaged only seven frames and flight mode's grain stood out whole.
   * Under the fill-in no mark is laid (a mark there stopped the smoothing gathering what the fill-in left).
   */
  reactive: 0.05,
  /**
   * The trace's share of the display each way in flight mode, where the whole trace is marched each frame: 0.3, so a climb
   * through a deck marches about 1.4 times the fill-in's rays (0.3 squared against a quarter of 0.5 squared), the soft inside
   * of a cloud needing no finer trace and the frame keeping near the fill-in's cost.
   */
  flightTrace: 0.3,
  /**
   * How much of its history each pixel keeps in flight mode, where the whole trace is marched new each frame: 0.5, about three
   * frames, so a climb at speed lets go of where the cloud was within a few frames (no smear) while the smaller trace's grain,
   * which the edge smoothing cannot gather once a trace texel spans three screen pixels, is halved. 0 is the design's flight
   * mode with nothing reused at all.
   */
  flightHistory: 0.5,
  /** Flight mode within this many metres of a deck's band while climbing or falling fast (the design's 300): 300. */
  flightNear: 300,
  /** ...faster than this many metres a second up or down (the design's 30): 30. */
  flightClimb: 30,
  /** Seconds flight mode holds after its reason has gone, so a climb that pauses at a band's edge does not flip the trace back and forth: 1. */
  flightHold: 1,
  /**
   * The reach of a layer holding storm towers (towering cumulus or cumulonimbus at the level now), metres: 80 km, the owner's
   * start (24 November), since storms are mostly seen from far away; every other layer reaches `reach`.
   */
  stormReach: 80_000,
  /**
   * The share of each layer's reach over which its clouds fade out before it (the plan's rank 5): 0.2, ten kilometres at 50 km,
   * so the march's end is no hard line across the sky.
   */
  fade: 0.2,
  // ---- the look wave, round 1: sampling (the plan's ranks 5 and 8)
  /**
   * The cheap first pass (Schneider 2015's): 1 marches with the shape alone (no detail and no erosion, so its density is never
   * less than the full shape's) in `probeStep` times longer steps until it meets cloud, then steps back one step and takes the
   * full shape and the light; 0 takes the full shape at every step, as wave 2 did. 0 to start, measured: on the NVIDIA
   * Blackwell card at one moment the march cost more with it than without (Mos Eisley's street 0.137 against 0.122 ms, the
   * open view at dusk under six layers 0.412 against 0.365, flight mode inside them 0.588 against 0.398), since the bands'
   * jumps and the clear map's growing steps already skip the empty air it would skip, and each step back is a step more.
   */
  probe: 0,
  /** The cheap pass's step against the full one's: 2, Schneider's, so empty air between heaps costs half the steps. */
  probeStep: 2,
  /** Empty full samples in a row after which the march goes back to the cheap pass: 3, past a heap's fraying edge. */
  probeAfter: 3,
  /**
   * Where the detail noise starts to fade out, metres from the lens: 10 km, past which a trace pixel (half a 1600 by 900
   * display) spans more than the detail's finest cells (some 20 to 30 m), so its frays are grain the fill-in must average.
   */
  detailNear: 10_000,
  /** ...and where it is gone (its two reads skipped, the erosion its mean): 20 km, where the detail is under a pixel. */
  detailFar: 20_000,
  /**
   * The decks curved down toward the horizon as on a planet of this radius, km (the plan's rank 5 "forced scale"): 0, flat,
   * as before (at the air's own 6,360 km a deck drops only 0.2 km at 50 km, which shows nothing). An option only: about
   * 420 brings a 3 km base down to the horizon within the reach, and every horizon ray it adds is a dear one.
   */
  curveRadius: 0,
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
  stepsHorizon: [8, 256],
  lightExtra: [0, 1],
  reuse: [0, 1],
  history: [0, 0.97],
  clampWiden: [0, 2],
  motionFrom: [0, 16],
  motionTo: [0.5, 64],
  motionKeep: [0, 1],
  distChange: [0.01, 1],
  reactive: [0, 1],
  flightTrace: [0.15, 1],
  flightHistory: [0, 0.97],
  flightNear: [0, 3000],
  flightClimb: [0, 400],
  flightHold: [0, 10],
  stormReach: [2000, 120_000],
  fade: [0, 0.9],
  probe: [0, 1],
  probeStep: [1, 4],
  probeAfter: [1, 12],
  detailNear: [500, 120_000],
  detailFar: [1000, 120_000],
  curveRadius: [0, 20_000],
};

/** The loop bound the card's march is built with: `CLOUD_TUNE.steps` moves under it with nothing built. */
export const CLOUD_STEPS_MOST = 256;

/**
 * The tiers' steps (the design's 2.6, "within Volumetric"): Ultra 96 steps (192 toward the horizon) and eight light steps, High
 * 64 (128) and six plus the far one. Medium and Low march as High until wave 5's flat tiers take them. Written into
 * `CLOUD_TUNE` by `setCloudTier` when the quality tier is applied, so the dials then move from the tier's start.
 */
export const CLOUD_TIER_STEPS = {
  low: { steps: 64, stepsHorizon: 128, lightExtra: 0 },
  medium: { steps: 64, stepsHorizon: 128, lightExtra: 0 },
  high: { steps: 64, stepsHorizon: 128, lightExtra: 0 },
  ultra: { steps: 96, stepsHorizon: 192, lightExtra: 1 },
};

/** The tier the steps were last set for (the report's word). */
export const CLOUD_TIER = { name: 'high' as string };

/** The quality tier's steps into the march's dials (`App.applyQualityTier` and the boot): answers the tier taken. */
export function setCloudTier(name: string): string {
  const row = (CLOUD_TIER_STEPS as Record<string, { steps: number; stepsHorizon: number; lightExtra: number }>)[name] ?? CLOUD_TIER_STEPS.high;
  CLOUD_TIER.name = name in CLOUD_TIER_STEPS ? name : 'high';
  CLOUD_TUNE.steps = row.steps;
  CLOUD_TUNE.stepsHorizon = row.stepsHorizon;
  CLOUD_TUNE.lightExtra = row.lightExtra;
  return CLOUD_TIER.name;
}

/**
 * What the app tells the clouds of the flight each frame (`main.ts`, beside the effects' input): whether the player is flying a
 * ship or aboard one (a pod or a speeder never is: pods never enter flight mode), and what the pass decided (the report's).
 */
export const CLOUD_FLIGHT = { ship: false, on: false, why: 'not flying' as string };

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
  traceSizeAt(cssW, cssH, CLOUD_TUNE.trace, out);
}

/** The trace's size at a share `s` of the display each way (flight mode's smaller trace), capped by the same ray budget. */
export function traceSizeAt(cssW: number, cssH: number, s: number, out: Int32Array | number[]): void {
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
