// The depth of field's arithmetic, with no imports: the lens, the focus and the per-frame numbers
// the shaders in `dof.ts` and `src/ui/previewDof.ts` implement, written once here so a plain node
// test (`tools/swg/tests/dof.test.ts`) can pin what the GPU draws. Every formula below has a line
// for line twin in GLSL; change one and change the other.
//
// The lens is a thin lens up to its aperture: blur grows with the difference in dioptres (1/metres)
// between a pixel and the focus. The aperture widens with the square root of the focus distance, so
// a target at 15 m separates from the town behind it without the whole world blurring at 10 m, and
// stops widening at 40 m, so a far focus does not blur the entire foreground or pump on a sweep.

export interface DofTuning {
  /** m^0.5: raw = aperture * sqrt(min(s, apertureStop)) * (1/s - 1/z). */
  aperture: number;
  /** Metres: the aperture stops widening past this focus. */
  apertureStop: number;
  /** |raw| below this is sharp. */
  deadZone: number;
  /** Blur radius at strength 1, as a fraction of the drawing-buffer height. */
  maxCoc: number;
  /** Metres past the shooter's plane where near blur starts (third person). */
  selfNear: number;
  /** Metres past it where near blur is full (third person). */
  selfFar: number;
  /** Metres past the shooter's plane before a depth tap may set the focus (third person). */
  selfMargin: number;
  /** First person: where near blur starts, below the eyes (arms, gun, feet). */
  fpSelf: number;
  /** First person: metres from fpSelf to full near blur. */
  fpRamp: number;
  /** First person: the nearest focus. */
  fpMinFocus: number;
  /** The nearest focus anywhere. */
  focusMin: number;
  /** A counted tap beyond this counts as this. */
  focusMax: number;
  /** Of the far plane: a tap this deep is sky and does not count. */
  skyFraction: number;
  /** Seconds: the focus easing towards a nearer target, and the lens amount easing in. */
  tauNearer: number;
  /** Seconds: the focus easing towards a farther target. */
  tauFarther: number;
  /** Extra weight of a bright tap at full highlight (the bokeh look). */
  bokehGain: number;
  /** Linear luminance where the extra weight starts. */
  bokehLo: number;
  /** Where it is full. */
  bokehHi: number;
  /** The prefilter's weight 1/(1 + firefly x luma): tames single-pixel sparkle without erasing highlights. */
  firefly: number;
  /** Gather taps at or below `denseAbove`. */
  taps: 16 | 24;
  /** Grid pixels: 24 taps above this radius. */
  denseAbove: number;
  /** Grid pixels: the hole fill runs above this radius. */
  fillAbove: number;
  /** The near fade starts at the shooter's plane, so the player's own figure stays sharp. */
  keepShooterSharp: boolean;
}

export const DOF_DEFAULTS: Readonly<DofTuning> = Object.freeze({
  aperture: 2.8,
  apertureStop: 40,
  deadZone: 0.06,
  maxCoc: 0.006,
  selfNear: 0.5,
  selfFar: 3.0,
  selfMargin: 0.4,
  fpSelf: 1.7,
  fpRamp: 1.5,
  fpMinFocus: 0.6,
  focusMin: 0.3,
  focusMax: 2000,
  skyFraction: 0.99,
  tauNearer: 0.08,
  tauFarther: 0.18,
  bokehGain: 1.5,
  bokehLo: 1.5,
  bokehHi: 8,
  firefly: 0.15,
  taps: 16,
  denseAbove: 7,
  fillAbove: 2,
  keepShooterSharp: true,
} as DofTuning);

/** The most gather taps the shader carries. */
export const DOF_TAP_MAX = 24;
/** Drawing-buffer pixels per stride step: the lens grid is never taller than half of this. */
export const DOF_GRID_HEIGHT = 2000;
/** The dilation's reach of 3 tiles of 4 grid pixels: no radius may outrun it. */
export const DOF_MAX_GRID_RADIUS = 12;
/** The golden angle, radians. */
const GOLDEN_ANGLE = 2.39996323;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Vogel (golden-angle) spiral in the unit disc: r_i = sqrt((i + 0.5) / n), angle_i = i x the golden
 * angle. Its first m taps scaled by sqrt(n / m) are exactly the m-tap spiral, which is how the gather
 * uses the first 16 of 24.
 */
export function vogelTaps(n = DOF_TAP_MAX): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * GOLDEN_ANGLE;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

/** 'const vec2 NAME[n] = vec2[n](vec2(x, y), ...);' with 6 decimals: the taps' one source for the shaders. */
export function glslVec2Array(name: string, taps: readonly [number, number][]): string {
  const items = taps.map(([x, y]) => `vec2(${x.toFixed(6)}, ${y.toFixed(6)})`);
  return `const vec2 ${name}[${taps.length}] = vec2[${taps.length}](${items.join(', ')});`;
}

/** How many drawing-buffer pixels a lens-grid texel spans, over two: max(1, ceil(height / 2000)). */
export function dofStride(height: number): number {
  return Math.max(1, Math.ceil(height / DOF_GRID_HEIGHT));
}

/** The aperture term for a focus: aperture x sqrt(min(1 / focusDioptres, apertureStop)). */
export function dofKs(focusDioptres: number, t: DofTuning): number {
  const fd = Math.max(focusDioptres, 1e-4);
  return t.aperture * Math.sqrt(Math.min(1 / fd, t.apertureStop));
}

/** The raw circle of confusion: positive farther than the focus, negative nearer, rising with z. */
export function dofRaw(z: number, focusDioptres: number, t: DofTuning): number {
  const fd = Math.max(focusDioptres, 1e-4);
  return dofKs(fd, t) * (fd - 1 / Math.max(z, 1e-3));
}

/**
 * Signed blur radius (grid pixels) for a raw value; near blur faded by smoothstep(fadeFrom, fadeTo, z),
 * where z is recovered from the raw value. `maxRadius` already includes the lens amount.
 */
export function dofRadius(raw: number, focusDioptres: number, maxRadius: number, fadeFrom: number, fadeTo: number, t: DofTuning): number {
  const mag = clamp((Math.abs(raw) - t.deadZone) / (1 - t.deadZone), 0, 1);
  if (raw >= 0) return mag * maxRadius;
  const fd = Math.max(focusDioptres, 1e-4);
  const z = 1 / (fd - raw / dofKs(fd, t));
  const r = mag * smoothstep(fadeFrom, fadeTo, z) * maxRadius;
  return r === 0 ? 0 : -r;
}

/** How far the lens has come in with the aim: smoothstep(0.02, 0.9, aimAmount). */
export function dofEase(aimAmount: number): number {
  return smoothstep(0.02, 0.9, aimAmount);
}

/**
 * The focus distance in metres: the median (the lower on an even count) of the taps at or beyond
 * `minFocus` and short of `skyZ`, each capped at `maxFocus`; null when none counts.
 */
export function focusMedian(taps: readonly number[], minFocus: number, maxFocus: number, skyZ: number): number | null {
  const v: number[] = [];
  for (const z of taps) if (z >= minFocus && z < skyZ) v.push(Math.min(z, maxFocus));
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  return v[(v.length - 1) >> 1];
}

/**
 * Holds tuning (from the console) inside what the shaders can divide by, in place: a dead zone of 1,
 * equal fade or bokeh edges, a negative gain or firefly weight each make a NaN, and the lens runs
 * after the sanitize pass, so a NaN would reach bloom as a black box. The defaults are all inside.
 */
export function clampTuning(t: DofTuning): DofTuning {
  t.aperture = Math.max(0, t.aperture);
  t.apertureStop = Math.max(0.1, t.apertureStop);
  t.deadZone = clamp(t.deadZone, 0, 0.9);
  t.maxCoc = Math.max(0, t.maxCoc);
  t.selfNear = Math.max(0, t.selfNear);
  t.selfFar = Math.max(t.selfNear + 0.01, t.selfFar);
  t.fpSelf = Math.max(0, t.fpSelf);
  t.fpRamp = Math.max(0.01, t.fpRamp);
  t.fpMinFocus = Math.max(0.01, t.fpMinFocus);
  t.focusMin = Math.max(0.01, t.focusMin);
  t.focusMax = Math.max(t.focusMin + 0.01, t.focusMax);
  t.skyFraction = clamp(t.skyFraction, 0.01, 1);
  t.bokehGain = Math.max(0, t.bokehGain);
  t.bokehHi = Math.max(t.bokehLo + 0.01, t.bokehHi);
  t.firefly = Math.max(0, t.firefly);
  return t;
}

/** How far to move towards a target this frame: 1 on a snap, else 1 - exp(-dt / tau). */
export function focusBlend(dt: number, tau: number, snap: boolean): number {
  return snap ? 1 : 1 - Math.exp(-Math.max(0, dt) / Math.max(tau, 1e-6));
}

/** The focus texel: dioptres now and target (0 before a surface), taps counted, lens amount 0..1. */
export interface FocusState {
  now: number;
  target: number;
  samples: number;
  amount: number;
}

/** One frame of the GPU focus shader, for the node test. Fills and returns `out`. */
export function focusStep(
  prev: FocusState,
  taps: readonly number[],
  minFocus: number,
  maxFocus: number,
  skyZ: number,
  blendNearer: number,
  blendFarther: number,
  snap: boolean,
  out: FocusState,
): FocusState {
  let n = 0;
  for (const z of taps) if (z >= minFocus && z < skyZ) n++;
  const fresh = snap || prev.amount <= 0;
  const median = focusMedian(taps, minFocus, maxFocus, skyZ);
  if (median === null) {
    if (fresh) {
      out.now = 0;
      out.target = 0;
      out.samples = 0;
      out.amount = 0;
    } else {
      out.now = prev.now;
      out.target = prev.target;
      out.samples = 0;
      out.amount = prev.amount;
    }
    return out;
  }
  const target = 1 / median;
  if (fresh) {
    out.now = target;
    out.target = target;
    out.samples = n;
    out.amount = blendNearer;
    return out;
  }
  const k = target > prev.now ? blendNearer : blendFarther;
  out.now = prev.now + (target - prev.now) * k;
  out.target = target;
  out.samples = n;
  out.amount = prev.amount + (1 - prev.amount) * blendNearer;
  return out;
}

export interface DofFrameInput {
  /** Drawing-buffer height, pixels. */
  height: number;
  strength: number;
  aimAmount: number;
  firstPerson: boolean;
  /** Metres from the camera to the orbit's centre (the shooter's plane); 0 in first person. */
  orbitDistance: number;
  tuning: DofTuning;
}

export interface DofFrame {
  ease: number;
  stride: number;
  /** The largest blur radius on the lens grid this frame, grid pixels, at most DOF_MAX_GRID_RADIUS. */
  maxRadiusGrid: number;
  /** Tiles the near dilation reaches, 0..3. */
  reach: number;
  fill: boolean;
  tapCount: number;
  /** sqrt(24 / tapCount): the first tapCount of the 24-tap spiral, spread over the disc. */
  tapScale: number;
  selfDepth: number;
  fadeFrom: number;
  fadeTo: number;
  minFocus: number;
}

export function createDofFrame(): DofFrame {
  return { ease: 0, stride: 1, maxRadiusGrid: 0, reach: 0, fill: false, tapCount: 16, tapScale: Math.sqrt(1.5), selfDepth: 0, fadeFrom: 0, fadeTo: 0, minFocus: 0.3 };
}

/** Fills and returns `out`; the pass keeps one input and one output object, so a frame allocates nothing. */
export function dofFrame(p: DofFrameInput, out: DofFrame): DofFrame {
  const t = p.tuning;
  const ease = dofEase(p.aimAmount);
  const stride = dofStride(p.height);
  const strength = Math.max(0, p.strength);
  const maxRadiusGrid = Math.min(DOF_MAX_GRID_RADIUS, (t.maxCoc * p.height * strength * ease) / (2 * stride));
  out.ease = ease;
  out.stride = stride;
  out.maxRadiusGrid = maxRadiusGrid;
  out.reach = Math.min(3, Math.ceil(maxRadiusGrid / 4));
  out.fill = maxRadiusGrid > t.fillAbove;
  out.tapCount = maxRadiusGrid > t.denseAbove ? DOF_TAP_MAX : t.taps;
  out.tapScale = Math.sqrt(DOF_TAP_MAX / out.tapCount);
  const orbit = Math.max(0, p.orbitDistance);
  out.selfDepth = p.firstPerson ? t.fpSelf : orbit;
  if (!t.keepShooterSharp) {
    out.fadeFrom = -2e4;
    out.fadeTo = -1e4;
  } else if (p.firstPerson) {
    out.fadeFrom = t.fpSelf;
    out.fadeTo = t.fpSelf + t.fpRamp;
  } else {
    out.fadeFrom = orbit + t.selfNear;
    out.fadeTo = orbit + t.selfFar;
  }
  out.minFocus = p.firstPerson ? t.fpMinFocus : Math.max(t.focusMin, orbit + t.selfMargin);
  return out;
}

/** The wardrobe doll's lens (fx-dof 11). */
export const PREVIEW_DOF = Object.freeze({
  /** Fraction of the drawing-buffer height blurred per dioptre of difference. */
  cocPerDioptre: 0.009,
  /** The largest blur, as a fraction of the drawing-buffer height, at strength 1. */
  maxRadius: 0.006,
  /** The lens path comes on above this many pixels of blur... */
  enterPx: 1,
  /** ...and goes off below this many. */
  exitPx: 0.7,
  /** The clamp on half the doll's front-to-back depth, metres. */
  halfDepthMin: 0.15,
  halfDepthMax: 0.35,
} as const);

export interface PreviewSpan {
  focus: number;
  nearest: number;
  farthest: number;
}

/**
 * The doll's depth along the view, in metres: `distance` the orbit distance to where the camera looks,
 * `axisDistance` the horizontal distance from the camera to the doll's vertical axis, `halfDepth` half its
 * front-to-back depth (clamped to halfDepthMin..halfDepthMax), `near` the camera's near plane. Fills `out`.
 */
export function previewSpan(distance: number, axisDistance: number, halfDepth: number, near: number, out: PreviewSpan): PreviewSpan {
  const r = clamp(halfDepth, PREVIEW_DOF.halfDepthMin, PREVIEW_DOF.halfDepthMax);
  out.focus = Math.max(near, distance - r);
  out.nearest = Math.max(near, axisDistance - r);
  out.farthest = Math.max(out.nearest, axisDistance + r);
  return out;
}

/** Drawing-buffer pixels of the largest blur the doll can show from here, capped at maxRadius x height x strength. */
export function previewGate(bufferHeight: number, strength: number, span: PreviewSpan): number {
  const s = Math.max(0, strength);
  if (s === 0 || bufferHeight <= 0) return 0;
  const fd = 1 / Math.max(span.focus, 1e-3);
  const spread = Math.max(Math.abs(fd - 1 / Math.max(span.nearest, 1e-3)), Math.abs(fd - 1 / Math.max(span.farthest, 1e-3)));
  return Math.min(PREVIEW_DOF.maxRadius * bufferHeight * s, PREVIEW_DOF.cocPerDioptre * bufferHeight * s * spread);
}

/** Hysteresis: on above enterPx, off below exitPx, else as it was. */
export function previewLensOn(wasOn: boolean, gate: number): boolean {
  if (gate > PREVIEW_DOF.enterPx) return true;
  if (gate < PREVIEW_DOF.exitPx) return false;
  return wasOn;
}
