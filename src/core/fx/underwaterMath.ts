// What the water does to the picture when the camera is under it, as numbers. The pass
// (`underwater.ts`) is one full-screen draw built from exactly these constants and these formulas;
// this module has no imports at all, so a plain node script (tools/swg/tests/underwater.test.ts)
// runs it directly and pins the curve, the way out through the surface overhead and the shimmer.
// That test also reads the pass's own source and checks the shader text against what is here, so
// the two cannot drift apart quietly.
//
// There was no under water in the game at all: you could not go under, so there is nothing in the
// archives to be faithful to. Every number below is ours, chosen by eye, and every one of them is
// live through `__debug.underwater`.
//
// Units: metres, and light in the renderer's own linear terms (the scene target is linear and
// brighter than white; the tone curve comes later). Every function here is allocation-free: the
// caller owns every vector written into.

/** Linear-light RGB, written in place. */
export type Vec3 = [number, number, number];

export interface UnderwaterTune {
  /**
   * Metres: how far the water's *strongest* channel travels before it has lost 1 - 1/e of itself.
   * The other channels are shorter in proportion to the body's own colour, so the whole look reads
   * as "I can see about this far".
   */
  sight: number;
  /**
   * 0..1: how much the body's own colour drives the per-channel distances. 0 is a colourless murk
   * that eats every channel alike; 1 gives a channel that is absent from the water's colour almost
   * no reach at all, which is what makes red die first in blue water.
   */
  tint: number;
  /** The least a channel's distance may be, as a share of `sight`: without it a body with a zero channel would eat it in centimetres. */
  minLength: number;
  /**
   * 0..1: how much the body's *own* opacity, as the converter read it from the client's water
   * texture, moves that reach. 0 gives every body on every planet the same visibility; 1 lets a
   * silty pond eat the picture in a fraction of the distance open sea does.
   */
  bodyMurk: number;
  /** The opacity that counts as ordinary water, so a body at exactly this is seen exactly `sight` through. */
  bodyMurkRef: number;
  /**
   * The radiance of the murk's brightest channel at the surface under `lightRef` worth of light, in
   * scene units. It is not an absolute any more: what the murk really sits at is this times the
   * share of `lightRef` the scene's own lights come to (`lightShareFor`), so a storm hour, a
   * shadowed cove and midnight each dim the water by themselves rather than every body on every
   * planet reaching one fixed grey.
   */
  murkLight: number;
  /**
   * The scene light that counts as full daylight, in the renderer's own linear terms: the summed
   * luminance of the sun, the sky half of the hemisphere and the fill — or, indoors, the room's own
   * ambient and parallel, whichever set comes to more, exactly as `lightOf` reads them. A planet at
   * noon comes to about this, so `murkLight` still means at noon what it has always meant.
   */
  lightRef: number;
  /**
   * The least share of `lightRef` the murk may be lit by, so however dark the hour the water is dark
   * rather than black. It was the share kept at midnight against the day's own 0 to 1; it is the
   * same guard, now against the light the scene really has.
   */
  nightFloor: number;
  /**
   * And the most. It is **1**, which is to say the murk may be dimmed by the light and never lifted
   * by it: the owner asked for water that is shadowier, and a ceiling above 1 would have let a
   * planet whose lights come to more than `lightRef` sit *brighter* at the surface than the fixed
   * 0.35 this replaced — the change moving the wrong way on exactly the bright planets it was meant
   * for. With it at 1, `murkLight` is what the murk reaches on the brightest planet at noon and
   * every other hour and place is darker, which is the one property the request needs and the one
   * `lightRef`'s own uncertainty cannot spoil. `__debug.underwater({ lightCeil: 1.6 })` gives the
   * headroom back if a bright planet reads too flat.
   */
  lightCeil: number;
  /** Metres: the depth over which the light reaching the murk falls away toward `deepFloor`. */
  lightDepth: number;
  /**
   * The share of its surface brightness the murk keeps however deep the camera goes: the floor that
   * keeps deep water very dark rather than pure black.
   */
  deepFloor: number;
  /** The most of the whole picture the depth veil may take, 0..1. `veilFor` never returns more than this, at any strength. */
  veilMax: number;
  /** Metres: the camera depth at which the veil has reached 1 - 1/e of `veilMax`. */
  veilDepth: number;
  /**
   * Metres: the camera depth over which the *whole* look comes in, from nothing at the surface line
   * to all of itself. See `easeIn` — this is the number that keeps the picture from changing in one
   * frame as the eye crosses the water.
   */
  surfaceEase: number;
  /** The murk stops at the water surface overhead rather than running to the far plane (see `waterPath`). */
  ceiling: boolean;
  /**
   * How far the shimmer may move the picture, in uv across the screen's *width*, at shimmer
   * strength 1 and at the surface. It is the whole frame that moves by this now, so it buys much
   * more of the picture than the same number did while only the near field wobbled: 0.0035 of a
   * 1920-wide window is about 3 px at the wobble's extremes and about 1 px most of the time.
   */
  shimmerUv: number;
  /**
   * Noise cells across the screen's **height**, not its width. The shader lays the field out as
   * `vUv * vec2(aspect, 1) x shimmerCells`, and `vUv.x` spans the width, so the width carries
   * `aspect` times as many cells as this and a cell is `height / shimmerCells` pixels square
   * whatever the window's shape (`shimmerCellsAcross`). At the default 3.5 that is a swell about
   * 309 px across on a 1920x1080 window — six or so across the view — and the same 309 px on an
   * ultrawide, which is why the count is the height's: widening the window adds swells rather than
   * stretching them.
   *
   * The ceiling is the width's, though. The finer octave samples `SHIMMER_FINE` times as fast and
   * the field repeats every `SHIMMER_PERIOD` cells, so the largest value that does not tile inside
   * one view is `SHIMMER_PERIOD / (SHIMMER_FINE x aspect)` — about 7.8 at 16:9, 6.0 at 21:9 and 5.8
   * on the widest monitor anybody plays on (`shimmerCellsMax`, which the node test sweeps at each of
   * those shapes). Keep it under about 5.5 and it is safe on all of them. Low is a lens — a few
   * broad swells across the whole window — and high is heat.
   */
  shimmerCells: number;
  /** Cells a second the noise drifts (the first octave travels `sqrt(1.25)` of this; see `shimmerPhase`). */
  shimmerRate: number;
  /**
   * Metres of water in front of a pixel past which the shimmer is gone. **0 is the lens**, and is
   * the default: the wobble is the same everywhere in the frame, the far wall and the surface
   * overhead included, which is what the owner asked for ("like the camera itself has a lens over
   * it that wobbles slightly"). Anything above 0 puts back the old near-field rule — whole out to
   * `SHIMMER_FADE_START` metres of water and gone by this — which is kept for one reason only: so
   * the two can be looked at in one session (`__debug.underwater({ shimmerReach: 28 })` is exactly
   * the rule as it shipped), which is the comparison the owner was promised and cannot be made at
   * all once the old rule is deleted.
   *
   * **It goes in the next wave, whichever way the owner answers**, rather than waiting on them:
   * four things carry it and nothing else does — this field and its default, `SHIMMER_FADE_START`
   * with `shimmerFadeStart`, the tail of `shimmerFor` from `const reach`, and in `underwater.ts` the
   * `uShimmerFade` uniform with its two lines in `prepare` and the one `if` in the fragment program.
   * Leaving it is a second rule standing beside the first, which is the thing the brief warned
   * against; at 0 it is inert (one uniform compare, the same for every pixel in the draw, never
   * divergent), and that is the only reason it is here for one wave and not for two.
   */
  shimmerReach: number;
  /** Metres: the camera depth over which the shimmer eases from all of itself toward `shimmerDeep`. */
  shimmerSurface: number;
  /** The share of the shimmer left far under the surface, where the ripples' own light no longer reaches. */
  shimmerDeep: number;
}

/**
 * The tuning, live: `__debug.underwater({ sight: 30 })` writes here and the pass reads it on the
 * next frame it draws. Every one of these is ours.
 */
export const UNDERWATER_TUNE: UnderwaterTune = {
  sight: 22,
  tint: 0.85,
  minLength: 0.08,
  bodyMurk: 0.6,
  bodyMurkRef: 0.75,
  murkLight: 0.35,
  lightRef: 2.8,
  nightFloor: 0.06,
  lightCeil: 1,
  lightDepth: 6,
  deepFloor: 0.06,
  veilMax: 0.35,
  veilDepth: 9,
  surfaceEase: 0.6,
  ceiling: true,
  shimmerUv: 0.0035,
  shimmerCells: 3.5,
  shimmerRate: 0.18,
  shimmerReach: 0,
  shimmerSurface: 10,
  shimmerDeep: 0.35,
};

/**
 * Metres of water in front of a pixel at which the *old* near-field fade began, kept so that one
 * number (`shimmerReach`) restores that rule exactly rather than approximately: at reach 28 the fade
 * runs from 2 m to 28 m, which is the pair the pass shipped with. With a reach shorter than twice
 * this the start is halved into it instead, so the fade is never inverted whatever is typed.
 *
 * It does nothing at the default reach of 0, where there is no fade at all.
 */
export const SHIMMER_FADE_START = 2;

/**
 * The neutral body: `waterLookFor`'s own default (#2e7fbb) in linear light, its own opacity, and a
 * depth to stand in with. The pass wears the depth on the one frame in a thousand that says the
 * camera is under water and hands over a depth that is not a number; the colour and the opacity are
 * the ones a record starts life with before any body has been asked about.
 */
export const UNDERWATER_FALLBACK: { readonly color: Readonly<Vec3>; readonly depth: number; readonly opacity: number } = {
  color: [0.0273, 0.2123, 0.4969],
  depth: 1.5,
  opacity: 0.75,
};

/**
 * The shimmer's noise repeats every this many cells in both axes, and its drift wraps at twice that.
 * Both are whole numbers and the second is twice the first **on purpose**: across one wrap the first
 * octave's sample point moves (2P, P) cells and the second's (-P, -2P), each a whole number of
 * periods, so the field after the wrap is the field before it to the last bit. Plain value noise has
 * no period at all, so a drift that simply reset its phase would snap the whole picture sideways
 * once every `SHIMMER_WRAP / shimmerRate` seconds. The pass writes `SHIMMER_PERIOD` straight into
 * its own GLSL from here, so the two cannot disagree.
 *
 * It is 32 rather than the 16 the wrap needs because the period is also how far the field may be
 * stretched before it tiles across the screen, and `shimmerCells` is a live knob: at 32 the finer
 * octave has room out to `shimmerCellsMax` cells across the screen's height, which is about 7.8 on
 * a 16:9 window and 6.0 on a 21:9 one. (It is not 13. That figure was worked out as though
 * `shimmerCells` counted across the *width*; it counts across the height, and the width carries
 * `aspect` times as many, so the real ceiling is that much lower — see `shimmerCellsMax`.)
 */
export const SHIMMER_PERIOD = 32;
export const SHIMMER_WRAP = SHIMMER_PERIOD * 2;

/**
 * How much faster the finer of the two octaves samples the lattice. The pass writes this straight
 * into its own GLSL, as it does `SHIMMER_PERIOD`, so the shader and `shimmerCellsMax` cannot pick
 * two different numbers — which is the whole of what made the tiling ceiling wrong before.
 */
export const SHIMMER_FINE = 2.3;

/**
 * The lights the murk is lit by, read structurally so this module still imports nothing: the
 * frame's own `FxLights` (`src/core/fx/lights.ts`) satisfies it exactly, and a node test can hand
 * over a plain object. Only luminances are read, so nothing here allocates or touches a colour.
 *
 * Which lights: the same four `World.litIrradianceNear` adds for the blade glow's ceiling — the sun
 * (or the moon; with the cascades on they carry its colour and intensity, and `fillFxLights` reads
 * them), the sky half of the hemisphere, the client's unshadowed fill, and a lit room's ambient and
 * parallel. A room that is not lit holds zeros, so no test is needed for it.
 */
export interface UnderwaterLightSources {
  readonly sky: {
    readonly sun: { readonly luminance: number };
    readonly hemiSkyLuminance: number;
    readonly fill: { readonly luminance: number };
  };
  readonly rooms: {
    readonly ambientLuminance: number;
    readonly parallel: { readonly luminance: number };
  };
}

/** What one frame comes to: the five things the shader is given. */
export interface UnderwaterLook {
  /** Per channel, 1 / metres: how fast it is eaten. Already times the look's strength, the body's own murkiness and the surface ease. */
  extinction: Vec3;
  /** The colour a far pixel becomes, in scene units: the body's hue under the light the scene really has, dimmed as the camera goes down. */
  murk: Vec3;
  /** 0..1: how much of the whole picture, near pixels and the surface overhead included, is taken by the murk. */
  veil: number;
  /** How far the shimmer may move a pixel, in uv. The same for every pixel in the frame unless `shimmerReach` is on. */
  shimmer: number;
  /** 0..1: how much of the whole look this depth has brought in (`easeIn`), kept for the console only. */
  ease: number;
}

export function createUnderwaterLook(): UnderwaterLook {
  return { extinction: [0, 0, 0], murk: [0, 0, 0], veil: 0, shimmer: 0, ease: 0 };
}

// --- helpers (no imports, so each is written out) ---

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** GLSL's smoothstep. */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** A finite number, or `fallback`. */
function finite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

// --- the derivation ---

/**
 * How much of the whole look this camera depth has brought in: 0 at the surface line, all of it by
 * `surfaceEase` metres under.
 *
 * This is not a nicety. "Am I under water" is answered with a margin and 20 cm of hysteresis
 * (`waterLineMath.ts`), so for the whole band between the plain surface and up to half a metre
 * *above* it the answer is yes and the depth is exactly 0 — and at depth 0 the water is nothing:
 * every ray leaves through the surface at once, so without this the picture would split at the
 * horizon, everything below it taking the full murk and everything above it untouched, with the
 * camera still in the air. Easing the whole look in on the depth makes depth 0 a frame the pass
 * leaves bit-for-bit alone, which is the only honest answer while the eye is above the water.
 */
export function easeIn(cameraDepth: number, tune: UnderwaterTune): number {
  const over = Math.max(0.0001, finite(tune.surfaceEase, 0.6));
  return smoothstep(0, over, Math.max(0, finite(cameraDepth, 0)));
}

/**
 * How much faster this body eats the picture than ordinary water: its converted opacity against
 * `bodyMurkRef`, softened by `bodyMurk` and held inside sane bounds so no converted entry can
 * either blind the player or make the water disappear. This is the one per-body signal there is of
 * how thick the water is, so without it a silty pond and open sea are seen exactly as far through.
 */
export function murkinessFor(opacity: number, tune: UnderwaterTune): number {
  const ref = Math.max(0.05, finite(tune.bodyMurkRef, 0.75));
  const o = finite(opacity, ref);
  if (!(o > 0)) return 1;
  const k = clamp01(finite(tune.bodyMurk, 0.6));
  const raw = 1 + k * (o / ref - 1);
  return raw < 0.35 ? 0.35 : raw > 2.5 ? 2.5 : raw;
}

/**
 * How fast each channel is eaten, 1 / metres. The body's brightest channel travels `sight` metres;
 * a channel at a share s of it travels `sight x (1 - tint + tint x s)`, never less than
 * `sight x minLength`. `strength` is the menu's, applied here so that 0 leaves the picture exactly
 * as it was and 2 halves every distance.
 */
export function extinctionFor(color: Readonly<Vec3>, strength: number, tune: UnderwaterTune, out: Vec3): Vec3 {
  const k = Math.max(0, finite(strength, 1));
  const sight = Math.max(0.01, finite(tune.sight, 22));
  const tint = clamp01(finite(tune.tint, 0.85));
  const floor = clamp01(finite(tune.minLength, 0.08));
  const peak = Math.max(color[0], color[1], color[2], 1e-6);
  for (let i = 0; i < 3; i++) {
    const share = clamp01(Math.max(0, color[i]) / peak);
    const length = sight * Math.max(floor, 1 - tint + tint * share);
    out[i] = k / length;
  }
  return out;
}

/**
 * The light the scene really has, in the renderer's own linear terms: the sun, the sky half of the
 * hemisphere and the fill, or a lit room's ambient and parallel, whichever of the two sets comes to
 * more.
 *
 * **The brighter of the two, not both.** `World.litIrradianceNear` adds all five, and this used to
 * as well, but that sum is a deliberate over-estimate used as a *ceiling* for the blade glow, where
 * too high is merely cautious. Here it is the value itself, and inside a building the sky set does
 * not light the cell at all — that is the whole of the portal renderer's layer split — so adding the
 * lamps on top of a sun that is not shining in would read an indoor pool as brighter than open sea
 * at noon, which is the opposite of what was asked for. Taking the larger set leaves every outdoor
 * frame exactly as it was (a room that is not lit holds zeros) and can never make a roofed pool
 * brighter than the sky above the roof.
 *
 * A record no frame has filled is all zeros, and there is no planet whose sky is off while anything
 * is drawn at all, so a light that is not above zero is read as "not told" and answered with
 * `lightRef` — a frame the game did not fill must leave the water looking like daylight rather than
 * paint the screen black. A record that is not there at all (a driven frame built by hand, a test)
 * goes the same way rather than throwing inside a draw, which is why every reach is guarded.
 */
export function lightOf(src: Readonly<UnderwaterLightSources> | null | undefined, tune: UnderwaterTune): number {
  const ref = Math.max(1e-4, finite(tune.lightRef, 2.8));
  const sky = src?.sky;
  const rooms = src?.rooms;
  // Written out rather than folded through a helper: this runs on every frame the camera is under
  // water, and a closure made here would be an allocation a frame.
  let open = 0;
  if (sky) {
    if (sky.sun) open += Math.max(0, finite(sky.sun.luminance, 0));
    open += Math.max(0, finite(sky.hemiSkyLuminance, 0));
    if (sky.fill) open += Math.max(0, finite(sky.fill.luminance, 0));
  }
  let indoors = 0;
  if (rooms) {
    indoors += Math.max(0, finite(rooms.ambientLuminance, 0));
    if (rooms.parallel) indoors += Math.max(0, finite(rooms.parallel.luminance, 0));
  }
  const light = open > indoors ? open : indoors;
  return light > 0 ? light : ref;
}

/**
 * How brightly the murk is lit, as a share of the reference daylight: the scene's own light over
 * `lightRef`, held between `nightFloor` and `lightCeil`. This is the whole of what makes the water
 * sit under the light the world has rather than at one fixed level on every planet at every hour —
 * the murk used to be an absolute radiance written into a linear target that runs well above 1 in
 * daylight, so a body that should have been a dark pool reached the same grey-blue as open sea at
 * noon and the far water read *brighter* than the near picture.
 *
 * A light that is not a number reads as the reference day, never as darkness.
 */
export function lightShareFor(light: number, tune: UnderwaterTune): number {
  const ref = Math.max(1e-4, finite(tune.lightRef, 2.8));
  const floor = clamp01(finite(tune.nightFloor, 0.06));
  const ceil = Math.max(floor, finite(tune.lightCeil, 1));
  const share = Math.max(0, finite(light, ref)) / ref;
  return share < floor ? floor : share > ceil ? ceil : share;
}

/**
 * The colour a far pixel becomes: the body's own hue, at `murkLight` times the share of the
 * reference daylight the scene's lights come to, dimmed as the camera goes down — the light has
 * that much more water to get through, and that fall is what makes deep water read as shadow rather
 * than as a brightening fog. `light` is `lightOf`'s sum, not the day's own 0 to 1.
 */
export function murkFor(color: Readonly<Vec3>, cameraDepth: number, light: number, tune: UnderwaterTune, out: Vec3): Vec3 {
  const depth = Math.max(0, finite(cameraDepth, 0));
  const deepFloor = clamp01(finite(tune.deepFloor, 0.06));
  const lightDepth = Math.max(0.01, finite(tune.lightDepth, 6));
  const down = deepFloor + (1 - deepFloor) * Math.exp(-depth / lightDepth);
  const level = Math.max(0, finite(tune.murkLight, 0.35)) * down * lightShareFor(light, tune);
  const peak = Math.max(color[0], color[1], color[2], 1e-6);
  for (let i = 0; i < 3; i++) out[i] = (Math.max(0, color[i]) / peak) * level;
  return out;
}

/**
 * The flat tint over the whole picture, the sky through the surface included: nothing at the
 * surface, rising toward `veilMax` as the camera goes down. This is the term the pixel's own
 * distance cannot give, and it is what makes deep water read as deep rather than merely far.
 *
 * `veilMax` is a ceiling and not a scale: the strength brings the veil on sooner, never past what
 * the field says is its most, so the knob's top end cannot take the whole picture.
 */
export function veilFor(cameraDepth: number, strength: number, tune: UnderwaterTune): number {
  const depth = Math.max(0, finite(cameraDepth, 0));
  const veilDepth = Math.max(0.01, finite(tune.veilDepth, 9));
  const max = clamp01(finite(tune.veilMax, 0.35));
  const v = max * (1 - Math.exp(-depth / veilDepth)) * Math.max(0, finite(strength, 1));
  return v < 0 ? 0 : v > max ? max : v;
}

/**
 * How much water a pixel is seen through. Ordinarily that is simply how far away it is, but the
 * water stops at its own surface: looking up from two metres down, a ray leaves the water after
 * `cameraDepth / up` metres however far off what it lands on is. Without that, the sky and the
 * surface overhead — which write the far plane's depth, since water writes no depth at all — would
 * be painted solid murk and there would be no looking up.
 *
 * `rayUp` is the ray's component along world up, 0 level and 1 straight up. The divisor is held off
 * zero rather than the test being made at a threshold, so the answer moves smoothly through the
 * horizon instead of stepping at whatever angle the threshold happened to be.
 */
export function waterPath(distance: number, rayUp: number, cameraDepth: number, tune: UnderwaterTune): number {
  const d = Math.max(0, finite(distance, 0));
  if (!tune.ceiling) return d;
  const up = finite(rayUp, 0);
  if (!(up > 0)) return d;
  const exit = Math.max(0, finite(cameraDepth, 0)) / Math.max(up, 1e-4);
  return Math.min(d, exit);
}

/**
 * How many noise cells the lens lays across the screen's **width**, which is `shimmerCells` times
 * the window's aspect and not `shimmerCells` itself.
 *
 * The shader's layout is `vec2 p = vUv * vec2(aspect, 1.0) * uShimmer.y`, and `vUv.x` spans the
 * width: so `p.x` runs from 0 to `aspect x cells` across the width while `p.y` runs 0 to `cells`
 * down the height. That is what keeps a cell square in pixels (`height / cells` each way), and it
 * is what makes every figure quoted across the width — a swell's width, how near the field is to
 * tiling — carry the aspect. Reported by `__debug.underwater` so the owner is judging the number
 * their own window really has.
 */
export function shimmerCellsAcross(cells: number, aspect: number): number {
  return Math.max(0, finite(cells, 0)) * Math.max(0, finite(aspect, 1));
}

/**
 * The largest `shimmerCells` whose finer octave still does not repeat within one view, on a window
 * of this shape: the lattice tiles every `SHIMMER_PERIOD` cells, the finer octave samples
 * `SHIMMER_FINE` times as fast, and the furthest the frame reaches along either of the noise's own
 * axes is `cells x max(1, aspect)` (see `shimmerCellsAcross`; the v channel samples the same field
 * with its axes swapped, so the same pair of spans covers both).
 *
 * About 7.8 at 16:9 and 6.0 at 21:9. The default of 3.5 is well inside both; anything past this
 * shows the same swell twice in one frame, which reads as a pattern rather than as water.
 */
export function shimmerCellsMax(aspect: number): number {
  const a = Math.max(1, finite(aspect, 1));
  return SHIMMER_PERIOD / (SHIMMER_FINE * a);
}

/**
 * Where the old near-field fade begins, for a given reach. One function so the pass and this module
 * cannot pick two different numbers; at the default reach of 0 there is no fade and this is unused.
 */
export function shimmerFadeStart(reach: number): number {
  const r = Math.max(0, finite(reach, 0));
  return r > 0 ? Math.min(SHIMMER_FADE_START, r * 0.5) : 0;
}

/**
 * How far the shimmer may move a pixel, in uv.
 *
 * It is **the whole frame's** number: the surface overhead, the sky through it, the bed, a far wall
 * and the pixel against the eye all move by the same amount, because what the owner asked for is a
 * lens over the camera rather than a haze hanging on what is near. It still falls away with the
 * camera's own depth, since what makes the picture wobble is the light bending through the ripples
 * overhead and deep down that light is no longer arriving; that is one number over the whole frame
 * and not a second rule about where a pixel is.
 *
 * The rule this replaced faded it out on `path`, the water in front of each pixel (`waterPath`), so
 * that a far wall did not swim. It sold "there is something on this material" rather than "I am
 * looking through water", which is what the owner reported. It is still reachable, for comparison
 * only, by giving `shimmerReach` the distance it used to end at; `path` is ignored at the default.
 */
export function shimmerFor(path: number, cameraDepth: number, strength: number, tune: UnderwaterTune): number {
  const k = Math.max(0, finite(strength, 1));
  if (k <= 0) return 0;
  const surface = Math.max(0.01, finite(tune.shimmerSurface, 10));
  const deep = clamp01(finite(tune.shimmerDeep, 0.35));
  const sank = 1 - Math.exp(-Math.max(0, finite(cameraDepth, 0)) / surface);
  const amp = Math.max(0, finite(tune.shimmerUv, 0.0035)) * k * (1 + (deep - 1) * sank);
  const reach = Math.max(0, finite(tune.shimmerReach, 0));
  if (!(reach > 0)) return amp;
  return amp * (1 - smoothstep(shimmerFadeStart(reach), reach, Math.max(0, finite(path, 0))));
}

/**
 * Where the drift stands at this moment, wrapped at `SHIMMER_WRAP`. The wrap is done here, in double
 * precision, so the shader never carries a large and growing number into a hash that would lose its
 * nerve; it is seamless because the noise repeats every `SHIMMER_PERIOD` cells and each octave moves
 * a whole number of periods across one wrap.
 */
export function shimmerPhase(time: number, tune: UnderwaterTune): number {
  const t = finite(time, 0) * finite(tune.shimmerRate, 0.09);
  if (!Number.isFinite(t)) return 0;
  const w = ((t % SHIMMER_WRAP) + SHIMMER_WRAP) % SHIMMER_WRAP;
  return Number.isFinite(w) ? w : 0;
}

/**
 * The whole frame's numbers in one go: what `prepare` writes into the uniforms and what the node
 * test sweeps. `shimmer` is the amplitude every pixel in the frame takes; only with `shimmerReach`
 * turned on for a comparison does the shader narrow it per pixel, which is `shimmerFor` with that
 * pixel's own `path`.
 */
export function deriveUnderwater(
  color: Readonly<Vec3>,
  opacity: number,
  cameraDepth: number,
  light: number,
  strength: number,
  shimmerStrength: number,
  tune: UnderwaterTune,
  out: UnderwaterLook,
): UnderwaterLook {
  // Nothing at the surface line, all of it a short way under: see `easeIn`.
  const ease = easeIn(cameraDepth, tune);
  const body = murkinessFor(opacity, tune);
  extinctionFor(color, Math.max(0, finite(strength, 1)) * body * ease, tune, out.extinction);
  // `light` is the scene's own (`lightOf`), not the day's 0 to 1: see `lightShareFor`.
  murkFor(color, cameraDepth, light, tune, out.murk);
  out.veil = veilFor(cameraDepth, strength, tune) * ease;
  out.shimmer = shimmerFor(0, cameraDepth, shimmerStrength, tune) * ease;
  out.ease = ease;
  return out;
}

/**
 * What the look does to one linear pixel, line for line with the shader: the water between the eye
 * and the pixel eats it and puts its own colour in its place, and the veil takes a little of
 * whatever is left. An exponential, so the far end settles onto the murk exactly rather than
 * running past it and being clipped.
 */
export function applyUnderwaterPixel(color: Readonly<Vec3>, path: number, look: Readonly<UnderwaterLook>, out: Vec3): Vec3 {
  const d = Math.max(0, finite(path, 0));
  const veil = clamp01(look.veil);
  for (let i = 0; i < 3; i++) {
    const t = Math.exp(-look.extinction[i] * d);
    const lit = color[i] * t + look.murk[i] * (1 - t);
    out[i] = lit + (look.murk[i] - lit) * veil;
  }
  return out;
}

// --- the console knob ---

/**
 * Write a few of the tuning numbers, ignoring anything that is not a key of its own kind: the one
 * place `__debug.underwater` is allowed to change. Returns the live object.
 */
/**
 * The names in a patch `tuneUnderwater` will drop on the floor: a key that is not one of its own,
 * or one given the wrong kind of value. It drops them in silence, which is the right thing inside a
 * draw and the wrong thing at a console — `shimmerNear` and `shimmerFar` outlived the tune by a
 * whole wave in a doc comment, and anybody who typed one would have watched nothing happen and
 * concluded the shimmer was broken. `__debug.underwater` reports this beside the tuning.
 */
export function unknownUnderwaterKeys(patch: Partial<UnderwaterTune> | undefined): string[] {
  if (!patch) return [];
  const into = UNDERWATER_TUNE as unknown as Record<string, unknown>;
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in UNDERWATER_TUNE) || typeof value !== typeof into[key] || (typeof value === 'number' && !Number.isFinite(value))) {
      dropped.push(key);
    }
  }
  return dropped;
}

export function tuneUnderwater(patch: Partial<UnderwaterTune> | undefined): UnderwaterTune {
  if (!patch) return UNDERWATER_TUNE;
  const into = UNDERWATER_TUNE as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in UNDERWATER_TUNE)) continue;
    if (typeof value !== typeof into[key]) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    into[key] = value;
  }
  return UNDERWATER_TUNE;
}
