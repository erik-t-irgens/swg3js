// The eye's frame on the main thread (the GPU port's pass 2, wave 2; the design's 2.8): which way the picture's exposure is
// made this frame, and the numbers the card's passes read. Pure: no three, no DOM; the node test runs it, and its frame
// allocates nothing (a number handed across a call is a number made, so everything goes through the kept records).
//
//   - **adapting** (WebGPU, our sky, a world whose air draws, a chain drawing its eye pass, the Eye adaptation row on): the
//     card measures and eases (`eyeGpu.ts`); the main thread writes only the frame's time and whether a loading screen stands;
//   - **following the sun** (the row off, no chain: Effects off, or a chain not drawing its eye pass: an Effects switch being
//     prepared, the computes not landed): the exposure the sun's height and the moon's give (`offStops`: the light on a level
//     surface the air's twin works out, taken as a scene's brightness by `OFF_MEAN`, through the eye's own curve), written
//     into the card's buffer by the main thread when it moves, so every reader of the buffer reads the same answer;
//   - **today's** (WebGL, SWG's sky, a world with no air): an exposure of 1 and no glow compensation, the picture of
//     before this wave; and (pass 2, wave 6) **space's** on WebGPU: the steady exposure of its dial (`SPACE_EYE`), its emissives
//     compensated alike.
//
// The renderer's own exposure (three's tone mapping) is the player's compensation (±2 stops) where a chain draws, since the
// chain's output multiplies by the eye's buffer itself; with no chain every material tone-maps itself onto the canvas at the
// renderer's exposure, so it carries the eye's answer too.
import { EK, EYE_FIXED, EYE_FRAME, EYE_TUNE, OFF_MEAN, kneeInto } from './eyeMath.ts';

/** What the frame hands the eye (written into the kept record before `eyeFrameRun`, never across the call). */
export const EYE_IN = {
  /** The frame's seconds. */
  dt: 0.016,
  /** WebGPU, under our sky (read at load), on a world whose air draws this frame. */
  air: false,
  /** An effects chain draws this frame (its output multiplies by the eye's buffer). */
  chain: false,
  /**
   * The wave's fixer: that chain draws its eye pass this frame (the pass wanted by the chain's own rule and the eye's computes
   * landed). False while an Effects switch is prepared, when the chain draws on with its setting already off: the main thread
   * then answers into the buffer, so the exposure never stands frozen.
   */
  eye: false,
  /** The Eye adaptation row (1 on, 0 the sun's height). */
  adapt: 1,
  /** The player's Exposure, stops (-2 to 2). */
  stops: 0.5,
  /** A loading screen stands (the eye is taken at once). */
  loading: true,
  /** The light on a level surface this frame, scene units (the air's twin: each body's light times its height, and the sky's). */
  level: 1.5,
  /** Pass 2, wave 6: the player stands in a space zone (WebGPU), where the exposure is `SPACE_EYE`'s. */
  space: false,
};

/**
 * Pass 2, wave 6 (wave 4b's leftover, "Naboo from orbit is dark"): space's exposure, in stops, where the card does not adapt
 * (space has no air for the eye's follow-the-sun answer, so its exposure was today's 1). Its emissives take the eye's own
 * compensation for the same stops (`EYE_TUNE.glow`), so lit windows, engines and bolts keep their look as at 1. **A dial, the
 * owner's**: the brief's choice was the eye's rule or a dial, his call; a dial keeps every space zone one steady picture (the
 * eye's measure of a frame mostly black would open it toward the stars and a planet's night side), and starts where Naboo from
 * its orbit reads: **3 stops** (an exposure of 8). Seen from its zone's arrival at 0 to 4 stops (a 30-degree field facing it,
 * its sun beside: `A:\swg3js\port\scratch\p2w6-makerA\shots\sheet-naboo-orbit.png`), at 0 the lit crescent alone showed and
 * the face read black (the old picture), at 2 the land was still dim, at 3 its seas and land read in their colours with its
 * limb's air bright short of white and no pixel clipped, at 4 the limb whitened; the station's sunlit hull at 3 is pale, not
 * clipped. 0 puts space back as it was.
 */
export const SPACE_EYE = { stops: 3 };
/** The dial's range, stops. */
export const SPACE_EYE_RANGE = [-2, 6] as const;

/** The space exposure moved as the console writes it (`{ stops: 1.5 }`), held to its range; words for anything held or refused. */
export function tuneSpaceEye(o: unknown): string[] {
  if (!o || typeof o !== 'object') return ['space takes { stops }'];
  const said: string[] = [];
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k !== 'stops') {
      said.push(`space.${k}: no such dial (stops)`);
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      said.push('space.stops: not a number');
      continue;
    }
    const held = n < SPACE_EYE_RANGE[0] ? SPACE_EYE_RANGE[0] : n > SPACE_EYE_RANGE[1] ? SPACE_EYE_RANGE[1] : n;
    if (held !== n) said.push(`space.stops held to ${held}`);
    SPACE_EYE.stops = held;
  }
  return said;
}

/** What the eye answers a frame: the mode, the main thread's own exposure and glow (when the card does not adapt), and the renderer's exposure. */
export const EYE_OUT = {
  /** 0 today's, 1 following the sun, 2 adapting on the card. */
  mode: 0,
  /** The exposure the main thread stands in the card's buffer (modes 0 and 1), and its stops. */
  exposure: 1.5,
  stops: 0.5,
  /** The glow factor beside it. */
  glow: 1.5,
  /** Whether the two moved enough this frame to be written to the card again. */
  write: true,
  /** Three's own exposure for the frame. */
  renderer: 1.5,
};

/** The last numbers written to the card, so a frame whose answer did not move writes nothing. */
const LAST = { exposure: -1.5, glow: -1.5, mode: -1 };

/** A share the main thread's answer must move by before it is written to the card again (the sun moves slowly). */
const WRITE_SHARE = 0.002;

/**
 * The eye's frame on the main thread, from `EYE_IN` into `EYE_OUT` and `EYE_FRAME`. Allocates nothing; a frame whose answer
 * stands writes nothing.
 */
export function eyeFrameRun(): void {
  const i = EYE_IN;
  const o = EYE_OUT;
  const dt = i.dt > 0 ? (i.dt < 0.25 ? i.dt : 0.25) : 0;
  EYE_FRAME.dtUs = (dt * 1e6) | 0;
  EYE_FRAME.snap = i.loading ? 1 : 0;
  // The player's compensation (`compensationOf`, written out: a number back from a call is a number made).
  const cs = i.stops === i.stops ? (i.stops < -2 ? -2 : i.stops > 2 ? 2 : i.stops) : 0;
  const comp = Math.pow(2, cs);
  let mode = 0;
  if (i.air) mode = i.chain && i.eye && i.adapt > 0.5 ? 2 : 1;
  o.mode = mode;
  EYE_FRAME.adapting = mode === 2 ? 1 : 0;
  if (mode === 1) {
    // "Off" (`offStops`, written out over the kept rule): the sun's height as a scene's brightness, through the eye's curve.
    const l = i.level > 1e-12 ? i.level : 1e-12;
    EK[0] = Math.log2(l * OFF_MEAN);
    kneeInto();
    const s = EK[1];
    o.stops = s;
    o.exposure = Math.pow(2, s);
    o.glow = Math.pow(2, -EYE_TUNE.glow * s);
  } else if (i.space) {
    // Pass 2, wave 6: space's own steady exposure (the dial), its emissives compensated as the eye compensates them.
    const s = SPACE_EYE.stops;
    o.stops = s;
    o.exposure = Math.pow(2, s);
    o.glow = Math.pow(2, -EYE_TUNE.glow * s);
  } else {
    o.stops = 0;
    o.exposure = 1;
    o.glow = 1;
  }
  // The card's buffer is written by the main thread only while the card does not adapt, and only when the answer moved.
  if (mode === 2) {
    o.write = false;
    LAST.mode = 2;
  } else {
    const de = o.exposure - LAST.exposure;
    const dg = o.glow - LAST.glow;
    o.write = mode !== LAST.mode || (de < 0 ? -de : de) > WRITE_SHARE * o.exposure || (dg < 0 ? -dg : dg) > WRITE_SHARE * o.glow;
    if (o.write) {
      LAST.exposure = o.exposure;
      LAST.glow = o.glow;
      LAST.mode = mode;
    }
  }
  // Three's exposure: the compensation alone where a chain draws (its output reads the buffer), else the compensation times
  // the eye's answer (every material tone-maps itself onto the canvas).
  o.renderer = i.chain ? comp : comp * o.exposure;
}

/** The stops the card counts over, for the console. */
export function eyeRange(): string {
  return `${EYE_FIXED.minLog} to ${EYE_FIXED.maxLog} (log2 of the scene's luminance), ${EYE_FIXED.bins} bins`;
}
