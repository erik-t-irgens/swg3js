// The HUD's arithmetic: every number and every place, with no DOM and no three, so a plain node test
// can check all of it (`tools/swg/tests/hudMath.test.ts`).
//
// Angles are **degrees, clockwise from twelve o'clock** everywhere in the interface — on the overlay's
// calls, in this module's answers and in the design. Screen x grows right and y grows down, so a point
// at angle a and radius r is (cx + r sin a, cy - r cos a).
//
// Nothing here allocates: every function that returns more than a number fills a struct the caller
// owns and hands back, and the layout struct is built once and refilled on a resize or a change of
// scale, never in a frame.

const DEG = Math.PI / 180;

/** A point on a circle, in the interface's angle convention. */
export function pointX(cx: number, r: number, deg: number): number {
  return cx + r * Math.sin(deg * DEG);
}
export function pointY(cy: number, r: number, deg: number): number {
  return cy - r * Math.cos(deg * DEG);
}

/** Along a span, 0 at `from` and 1 at `to`. The span may run either way round. */
export function along(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Every size in the HUD, in CSS pixels at scale 1. A size the owner wants changed is one line here.
 *
 * The geometry is ours: **every number in this table is invented** — chosen for this pass, not read
 * from anything the game shipped. They are gathered by kind, with the thresholds, the timings and the
 * pool sizes at the foot.
 *
 * The table is deliberately not frozen: `tuneSizes` writes into it so a number can be tried from a
 * console knob rather than an edit and a reload. A change reaches the screen on the next `layout()`,
 * which is a resize or a change of scale, so whoever tunes a layout number must run that again.
 */
export const HUD_SIZES = {
  // --- the reticle, flying -----------------------------------------------------------------------
  /** Four boresight ticks: this far from the middle, this long, this wide. */
  boresightFrom: 12,
  boresightLen: 6,
  boresightWidth: 1.5,
  boresightAlpha: 0.85,
  /** The aim circle: four arcs of `aimSpan` degrees with `aimGap` between them at the diagonals. */
  aimSpan: 60,
  aimGap: 30,
  aimWidth: 1.5,
  /** The aim circle never grows past this, so it can never touch the arcs. */
  aimMax: 118,
  aimAlpha: 0.5,
  aimAlphaInside: 0.9,
  /** The cursor: a diamond this wide, with this much of an arrow behind it when it is clamped out. */
  cursorSize: 10,
  cursorArrow: 9,
  /** The lead marker: a ring with a centre dot and two ticks, so it is never the cursor. */
  leadRadius: 14,
  leadWidth: 1.5,
  leadDot: 3,
  leadTick: 4,
  // --- the three arcs ----------------------------------------------------------------------------
  arcRadius: 132,
  arcWidth: 4,
  /** A tick across the speed rail. */
  tickLen: 8,
  /** Speed, up the left: 225 to 315 through nine o'clock, filling upward. */
  speedFrom: 225,
  speedTo: 315,
  /** The guns, up the right: 135 to 45 through three o'clock, filling upward. */
  gunsFrom: 135,
  gunsTo: 45,
  /**
   * The booster, across six o'clock. The design's span is 155 to 205; it is written from its left end
   * here so that filling from `boostFrom` to `boostTo` runs left to right on the screen.
   */
  boostFrom: 205,
  boostTo: 155,
  /** A gap left between two neighbouring gun slices, so a notch is legible. */
  sliceGap: 1.5,
  // --- bars (DOM, but their sizes belong with the rest) -------------------------------------------
  shipBarW: 132,
  shipBarH: 9,
  shipBarGap: 4,
  /** The label column beside the ship's bars, and the gap between a face's two bars. */
  shipLabelW: 64,
  shipColGap: 10,
  /**
   * The body block's bars (the interface rewrite's first wave): no words and no numbers, each attached to the one
   * under it rather than standing in a row of its own (`barLayout`). Health is 160 long as it was and as thick as the
   * Force bar was (the owner's "6 px, from 10"); its thickness is a dial, since in the inside look less of it shows.
   * Force keeps its 6, and stamina and breath are the thin ones at 4 (breath "thin like stamina", from 8).
   */
  healthBarW: 160,
  healthBarH: 6,
  poolBarW: 160,
  poolBarH: 6,
  /** Breath (ours: there was no going under water in the game at all), thin like stamina; its length is `barLayout`'s. */
  breathBarW: 160,
  breathBarH: 4,
  /** Stamina (the speed classes), as thin as it was; its length is `barLayout`'s. */
  staminaBarW: 160,
  staminaBarH: 4,
  /**
   * An attached bar's length over the bar it is attached to: Force over health, stamina over Force, breath over the
   * top-most bar. At the sides 75%, lined up with the outer end; in the middle 60%, centred (the owner's numbers).
   */
  barSideShare: 0.75,
  barMiddleShare: 0.6,
  /**
   * The weapon mark's box (the second maker's mark goes in it), and the gap between it and the bars: above them in the
   * middle, beside them at the screen's edge at the sides. Ours, both.
   */
  markSize: 40,
  markGap: 6,
  /**
   * The weapon mark itself (the interface rewrite's first wave, item 6; `weaponMark.ts`, `hud.css`): "slightly
   * translucent" (ours, three quarters), and a lightsaber's tilt for each stance in degrees clockwise from upright (the
   * owner's: fast 45 to the right, medium 22.5, strong upright; the double-bladed saber at 45; each half of two crossed
   * sabers at 45, the one leaning each way). `markTurnSeconds` is how long the mark takes to turn to a new stance (ours:
   * a stance changes at a key and the mark follows it at a glance; 0 snaps it).
   */
  markAlpha: 0.75,
  markTiltFast: 45,
  markTiltMedium: 22.5,
  markTiltStrong: 0,
  markTiltStaff: 45,
  markTiltDual: 45,
  markTurnSeconds: 0.15,
  /**
   * How long the mark's blade takes to come out and go back when there is no blade to read the timing from (the game's
   * own blade runs at its file's timing held to a third of a second, `SaberBlade.openSeconds`, which is what the mark
   * reads when there is one): the same third of a second, so the default and the read value agree.
   */
  markBladeSeconds: 0.32,
  /**
   * A pair (anything in the left hand but a second lightsaber of the X): both marks at `markPairScale` of the box (the
   * owner's "a third their size, or smaller, whatever lets it fit"), their middles `markPairAt` of the way along the box's
   * diagonal from its top left and from its bottom right (ours), and between them a muted slanted line `markSplitLength`
   * long in the box's own 24 units, `markSplitWidth` thick, at `markSplitAngle` degrees from level (ours: across the
   * diagonal the two marks stand on).
   */
  // A third, written as the stylesheet's fallback can write it (`hudBars.test.ts` holds the two to one number).
  markPairScale: 0.333,
  markPairAt: 0.3,
  markSplitLength: 11,
  markSplitWidth: 1.2,
  markSplitAngle: 45,
  /** How far the block stands in from the screen's side edge when it is on the left or the right (the message line's own 14). */
  blockSide: 14,
  /**
   * Health's colour (the owner's): the palette's `muted` from full down to `hpLow`, `health` (the dark red) at it and
   * below, eased over `hpEaseSeconds`; under `hpRipple` a ripple of `bad` spreads `ripplePx` out from the bar and
   * fades, once every `rippleSeconds`. Both thresholds are shares of full health. `rippleStrength` is how much of the
   * bright red the ripple starts at, against the bar's edge, before it fades to nothing as it spreads (ours: three
   * quarters, so it reads as a pulse beside the bar and not a second bar).
   */
  hpLow: 0.4,
  hpRipple: 0.3,
  hpEaseSeconds: 0.25,
  rippleSeconds: 1,
  ripplePx: 6,
  rippleStrength: 0.75,
  /** Breath under this share of a full breath flashes white (`ink`), slowly in and out: `breathFlashSeconds` each way. */
  breathFlashBelow: 0.3,
  breathFlashSeconds: 1,
  /**
   * Health and Force go this long after they are full (the owner's 1.5 s, stamina's own `linger` in `LOCO_TUNE`, kept
   * apart here so the two can be moved apart), and every bar fades in and out over `barFadeSeconds` (ours: a fifth of a
   * second, so a bar coming back is not a pop; 0 is today's stamina, which went at once).
   */
  fullLinger: 1.5,
  barFadeSeconds: 0.2,
  targetBarW: 64,
  targetBarH: 5,
  plateBarW: 44,
  plateBarH: 4,
  /** A pip per fitted part. */
  pipSize: 10,
  pipGap: 4,
  // --- the target --------------------------------------------------------------------------------
  /** Four L-corners, each two legs this long, this wide. */
  bracketLeg: 10,
  bracketWidth: 2,
  bracketMin: 28,
  bracketMax: 220,
  /** The lock: the corners close from this far out over `lockSeconds`. */
  lockFrom: 6,
  /** An off-screen target: a triangle this big on a ring this far inside the edge, with a tail. */
  edgeInset: 40,
  edgeArrow: 14,
  edgeTail: 3,
  edgeLabel: 18,
  // --- damage ------------------------------------------------------------------------------------
  /** The direction arc: three plain strokes at these radii and alphas, this wide, this many degrees. */
  damageSpan: 70,
  damageR1: 176,
  damageR2: 190,
  damageR3: 204,
  damageA1: 0.1,
  damageA2: 0.22,
  damageA3: 0.1,
  damageWidth: 14,
  /** The hit tick: the boresight jumps out to here, and a kill throws a ring from here to here. */
  hitTickFrom: 16,
  killRingFrom: 6,
  killRingTo: 22,
  // --- on foot -----------------------------------------------------------------------------------
  /**
   * The crosshair: a dot, four ticks, and the charge as a ring. The ticks run from `footTickFrom` out to
   * `footTickFrom + footTickLen`: 7 to 11 since the interface rewrite's second wave (item 10, the owner's "closer to the
   * center dot and a little shorter, though still not touching"; they ran 9 to 14), so the dot's 3 and its dark
   * under-stroke still stand clear of their inner ends. The charge ring is a faint full circle (`muted` at
   * `chargeTrackAlpha`) with the filled arc on it (at `chargeArcAlpha`); both alphas are the ones the ring always had,
   * and the rope ring is drawn at the same two.
   */
  dotRadius: 3,
  footTickFrom: 7,
  footTickLen: 4,
  chargeRadius: 16,
  chargeWidth: 2.5,
  chargeTrackAlpha: 0.35,
  chargeArcAlpha: 0.95,
  /**
   * The grapple's mark: a diamond with its corners on the axes this far out, this wide, at this alpha, drawn
   * where the dart would bite, and the small mark at the anchor while it is in front of the view. Since the interface
   * rewrite's second wave (item 10, the owner's "smaller and fatter, definitely within the current reticle's four
   * lines"): corners 6 out (they were 12, the owner's earlier smaller size) and 1.4 thick (0.8), so the whole diamond,
   * its stroke included, stands inside the crosshair's ticks, whose inner ends are 7 out. Its colours stay.
   */
  grappleMark: 6,
  grappleMarkWidth: 1.4,
  grappleMarkAlpha: 0.85,
  grappleAnchor: 3,
  /**
   * The rope used over the longest, while the rope is in (item 10): a ring drawn like the charge ring -- a faint full
   * circle with the filled arc on it, clockwise from twelve -- at the charge ring's own radius and width to begin with
   * (the owner's "at the charge ring's size"; it was a thin arc at 10), the arc `muted` and turning `warn` (amber) past
   * `grappleRopeWarn` of the longest rope. While a shot charges on the rope the two would lie on each other, so the
   * rope ring steps out by `grappleRopeStep` of its own width (1, the owner's "by its own width").
   */
  grappleRopeArc: 16,
  grappleRopeArcWidth: 2.5,
  grappleRopeWarn: 0.5,
  grappleRopeStep: 1,
  /**
   * The action bar (the interface rewrite's second wave, item 7; `.slots` in `hud.css`): one bar of `plate` with slightly
   * rounded corners (`slotRadius`), its cells `slotW` wide and `slotSize` high (the bar's own height), smaller than the
   * 40 px squares they were, each the ability's mark (`slotGlyph`, from 28) with the key it is on under it, inside the
   * bar, in type `slotKeySize` (ours, all five: a cell a little narrower than it is tall, so the key fits under a mark a
   * glance still reads). Between two cells a line `slotLineWidth` thick and `slotLineShare` of the bar's height (the
   * owner's "about 80%"; the Interface page's switch puts it at the bar's full height instead).
   */
  slotSize: 36,
  slotW: 32,
  slotGlyph: 20,
  slotKeySize: 9,
  slotRadius: 6,
  slotLineShare: 0.8,
  slotLineWidth: 1,
  /**
   * A press darkens the cell (`void` at `pressDark`, ours) over `pressInSeconds` and brings it back over
   * `pressOutSeconds` (the second wave's defaults: about 80 ms and 200 ms). A cooldown darkens the cell at once (`void` at
   * `coolDark`, the old turning wedge's own 60%) and the cell's own colour fills back up from the bottom over the
   * cooldown's time; when it is ready, a flash of `ink` up to `readyFlashGlow` and back, eased in and out over
   * `readyFlashSeconds` (the defaults: about a quarter brighter, about a third of a second).
   */
  pressInSeconds: 0.08,
  pressOutSeconds: 0.2,
  pressDark: 0.45,
  coolDark: 0.6,
  readyFlashSeconds: 0.33,
  readyFlashGlow: 0.25,
  /**
   * A lit cell (a toggle running, a power holding, the blade out): its mark in `accent` and a soft light of the same
   * inside the cell, `slotLitPx` across at `slotLitGlow` of the colour (ours: inside, since the bar's corners clip what is
   * outside it; the separate square cells had worn an outer glow of 45%).
   */
  slotLitPx: 10,
  slotLitGlow: 0.35,
  /**
   * A key-cap: the use prompt's soft cap (item 8), and the long line's caps, which are the same. At least `capW` wide,
   * `capH` high (the long line is as tall as its caps, so a cap sits in it), `capPad` in at each side for a long key's
   * word, its corners `capRadius` round, the key in type `capKeySize` high; the words beside it in type `promptWordSize`
   * high, `promptKeyGap` from the cap. Ours, all seven, the sizes the prompt's caps and words had before the wave but the
   * corners, which went from 2 to 4 as the hard border went. On the bar's own scale (`--hud-acts-s`), and the long line's
   * on the HUD's.
   */
  capW: 22,
  capH: 18,
  capPad: 4,
  capRadius: 4,
  capKeySize: 11,
  promptWordSize: 13,
  promptKeyGap: 5,
  /**
   * The use prompt (the interface rewrite's second wave, item 8; `ActionBar` in `prompt.ts`, `.hud-acts` in `hud.css`):
   * one rounded see-through bar, the palette's `panel` at `promptStrength` of itself (the owner's "about half"), corners
   * `promptRadius`, every action on offer side by side `promptGap` apart with the action bar's lines between them, the bar
   * padded `promptPadX` and `promptPadY` round them (ours, the four). The key in a soft cap of `ink` at `promptCapLight`
   * over the bar (ours: "slightly lighter than the bar", no border); the words in `ink` at `promptInk` (the owner's "about
   * 85%"), no outline round each letter. It fades in over `promptInSeconds` and out over `promptOutSeconds` (the owner's
   * "about 150 ms" and "about 200 ms"); when the actions change its width eases over `promptWidthSeconds` and the words
   * cross-fade over `promptSwapSeconds` (ours). Aboard and in vehicles it is the same bar at `promptQuiet` of its
   * strength on foot (the default answer, "about 60%"), `promptQuietSize` of its size ("slightly smaller", ours), and
   * `promptQuietBottom` up from the floor at the HUD scale, raised clear of the flight display: the ship's condition
   * block stands 96 up and is 63 tall in the browser at scale 1 (measured at a fighter's controls, 1600 by 900), so it
   * reaches 159, and 168 clears it by 9 (ours; the on-foot bar's 155 touched it). The blur behind it, a switch that
   * starts off, is `promptBlurPx` across (ours).
   */
  promptStrength: 0.5,
  promptRadius: 8,
  promptGap: 12,
  promptPadX: 6,
  promptPadY: 4,
  promptCapLight: 0.12,
  promptInk: 0.85,
  promptInSeconds: 0.15,
  promptOutSeconds: 0.2,
  promptWidthSeconds: 0.18,
  promptSwapSeconds: 0.15,
  promptQuiet: 0.6,
  promptQuietSize: 0.9,
  promptQuietBottom: 168,
  promptBlurPx: 6,
  // --- the world's own places ---------------------------------------------------------------------
  /** The minimap's circle, across, at the top left. */
  minimap: 168,
  /**
   * The world's name over the top of the circle stands this far down from the canvas's top: under the
   * mark for north, whose tip is on the rim three pixels in (`MINIMAP_TUNE.rimInsetPx`) and whose base is
   * `northPx` (6) under that, with three to spare. Ours.
   */
  minimapNameTop: 12,
  /** The coordinates over the foot of the circle stand this far up from the canvas's bottom. Ours. */
  minimapLocBottom: 8,
  /**
   * The corner's readouts (the interface rewrite's first wave), each a switch on the Interface page. The frame rate alone
   * at the top right in type `fpsSize` high (ours: the minimap's coordinates' 11 and a point, as the one number up
   * there), under "a simple drop shadow" (the owner's words) of the palette's shade, `fpsShadowY` down and blurred over
   * `fpsShadowBlur` (ours: a pixel down, two across, so the number lifts off a bright sky without a box). The weather's
   * word under the minimap in type `weatherSize` high (ours: the nearby line's 10, "small"), in a line of its own that
   * stays 13 high whatever the size, so the block under it and what docks below never move (`hudMath.test.ts` adds the
   * block up).
   */
  fpsSize: 12,
  fpsShadowY: 1,
  fpsShadowBlur: 2,
  weatherSize: 10,
  /**
   * The frame rate on the character list and the creator (the second wave, item 9), where it stands by itself: its own
   * top and right, in plain pixels as its place in play is. In play it stands 12 in from the top and the right, and
   * there on the list it sat on the list's "1 of 5", which stands at the head's bottom right, in from the right by the
   * list's own side padding (at most 40) and its own width (about 36), and down by under 30 on a window under about 720
   * high (the wave's review, at 1280 by 720). So on those two screens it keeps the top's 12 and stands 88 in from the
   * right: the most that padding and that counter reach, and 12 to spare, so it clears the counter at every window size
   * and grows leftward at a larger scale. On the creator that is inside the top of its window on the right, clear of the
   * window's words. Both the owner's to move by eye.
   */
  stageFpsTop: 12,
  stageFpsRight: 88,
  /** A waypoint's mark in the world: this far from its middle to each of its points. */
  waypointMark: 7,
  // --- the blocks --------------------------------------------------------------------------------
  /** The ship's condition, centred, this far up from the bottom. */
  conditionUp: 96,
  /** The message line, bottom left. */
  messageLeft: 14,
  messageBottom: 14,
  messageW: 420,
  messageLineH: 22,
  /**
   * The action bar, bottom centre, this far up from the floor at the scale. It clears whichever
   * block stands under it: the on-foot one, or the ship's condition, which is the taller of the two
   * at every scale the settings allow. `hud.css` states it again and `hudMath.test.ts` checks the
   * two agree.
   */
  actionBottom: 155,
  /**
   * Where the bar goes on a window too short to hold it above the block: back under the block, which
   * is where it sat before there was anything under it to clear. Both numbers are invented and both
   * are stated again in `hud.css`, the second inside a height query.
   */
  actionLow: 52,
  /** A window shorter than this cannot hold the bar above the block even at the smallest scale. */
  actionShortH: 270,
  actionW: 420,
  actionH: 24,
  /** The gap kept between the message line and the condition block, so they can never touch. */
  blockGap: 24,
  /** The smallest the message line is squeezed to before it climbs above the centred blocks instead. */
  messageMinW: 120,
  // --- the layout's own margins and floors ---------------------------------------------------------
  // These were loose numbers inside `layout` and `nameplate`; they are here with the rest so that a
  // window or a scale that reads wrong is one line, like every other size.
  /** How much clear space the arcs keep inside the shorter side of the window. */
  arcMargin: 8,
  /** The arcs never shrink past this, however small the window. */
  arcMin: 24,
  /** The gap the aim circle keeps inside the arcs, and the smallest it is allowed to be. */
  aimInset: 8,
  aimMin: 12,
  /** The side margin the centred blocks keep off the window's edges. */
  blockMargin: 16,
  /** The off-screen arrow's ring never comes further in than this share of the shorter side. */
  edgeMaxShare: 0.25,
  /** How far off the window a nameplate's head may be before it is not drawn at all. */
  plateMargin: 48,
  // --- the timings, in seconds -------------------------------------------------------------------
  lockSeconds: 0.2,
  ghostSeconds: 0.6,
  flashSeconds: 0.25,
  damageSeconds: 1.2,
  hitTickSeconds: 0.12,
  killTickSeconds: 0.3,
  messageSeconds: 8,
  messageFadeSeconds: 1,
  nameplateFadeSeconds: 0.15,
  // --- the pools, fixed, never grown --------------------------------------------------------------
  messagePool: 8,
  nameplatePool: 8,
  damagePool: 4,
  numberPool: 12,
  actionSlots: 4,
  // --- the thresholds (invented, as the sizes above are) -------------------------------------------
  /** A bar is `warn` under a third of its length and `bad` under a sixth. */
  bandWarn: 1 / 3,
  bandBad: 1 / 6,
  /** A pip's fill goes `warn` under a quarter. */
  pipWarn: 0.25,
  /**
   * A breath within a thousandth of full is full, and the row goes down. It is a real guard and not
   * a rounding nicety: a pool that eases back toward its top rather than reaching it would otherwise
   * leave the row standing on dry land for ever, which is the one thing it must never do.
   */
  breathFull: 0.999,
  /** The booster pulses under a fifth. */
  boostPulse: 0.2,
  /** A blow whose sideways part is under this share of its forward part is taken as ahead or behind. */
  damageAhead: 0.2,
  /** The look-at nameplate: this far, and this many degrees off the crosshair. */
  nameplateRange: 40,
  nameplateCone: 3,
  /** A repeat of the same message inside this many seconds is counted on the line it is already on. */
  messageMerge: 2,
  /** A boost top within this much of the plain top is no booster at all, not a sliver of a span. */
  boostEpsilon: 1.001,
  /** The HUD scale's ends. */
  scaleMin: 0.75,
  scaleMax: 1.5,
};

export type HudSizes = typeof HUD_SIZES;

/**
 * Write sizes into the table in place, for a console knob. Only keys already in the table and only
 * finite numbers are taken, so a typo cannot put `undefined` into the geometry. Returns how many were
 * written. A layout number needs `layout()` run again — which is what `applyHudSettings()` does.
 */
export function tuneSizes(partial: Partial<HudSizes>): number {
  let written = 0;
  const table = HUD_SIZES as unknown as Record<string, number>;
  for (const key of Object.keys(partial)) {
    const value = (partial as Record<string, unknown>)[key];
    if (typeof table[key] !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) continue;
    table[key] = value;
    written++;
  }
  return written;
}

/** A rectangle, in CSS pixels from the top left of the window. */
export interface HudRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where everything sits, at one window size and one scale. Built once by `makeLayout` and refilled by
 * `layout` on a resize or a change of scale — never in a frame.
 */
export interface HudLayout {
  w: number;
  h: number;
  scale: number;
  /** The reticle's centre (the middle of the window; the boresight may be offset from it per frame). */
  cx: number;
  cy: number;
  /** The three arcs' radius and width, already clamped to the window. */
  arcR: number;
  arcW: number;
  tickLen: number;
  /** The most the aim circle may grow to here. */
  aimMax: number;
  /** How far inside the edge the off-screen arrow rides. */
  edgeInset: number;
  /** The ship's condition block. */
  condition: HudRect;
  /**
   * The message line's whole column (its lines stack up from its bottom). The line itself is placed
   * by `hud.css`, which reads this column's width through the `--hud-msg-w` property: whoever applies
   * the HUD settings writes `w` there on a resize and on a change of scale, and until they do the
   * stylesheet falls back on `messageW` at the HUD scale.
   */
  message: HudRect;
  /** The action bar. */
  action: HudRect;
}

export function makeLayout(): HudLayout {
  return {
    w: 0,
    h: 0,
    scale: 1,
    cx: 0,
    cy: 0,
    arcR: 0,
    arcW: 0,
    tickLen: 0,
    aimMax: 0,
    edgeInset: 0,
    condition: { x: 0, y: 0, w: 0, h: 0 },
    message: { x: 0, y: 0, w: 0, h: 0 },
    action: { x: 0, y: 0, w: 0, h: 0 },
  };
}

/**
 * Fill a layout struct for a window and a scale. Everything is clamped to the window, so a small
 * window or a large scale shrinks the display rather than pushing any of it off the screen, and the
 * message line is narrowed before it can reach the condition block.
 */
export function layout(w: number, h: number, scale: number, out: HudLayout): HudLayout {
  const s = Math.max(HUD_SIZES.scaleMin, Math.min(HUD_SIZES.scaleMax, scale));
  const S = HUD_SIZES;
  out.w = w;
  out.h = h;
  out.scale = s;
  out.cx = Math.round(w / 2);
  out.cy = Math.round(h / 2);
  out.arcW = S.arcWidth * s;
  out.tickLen = S.tickLen * s;
  // The arcs stay inside the window whatever the scale: half the shorter side, less a margin.
  const room = Math.min(w, h) / 2 - S.arcMargin * s - out.arcW / 2;
  out.arcR = Math.max(S.arcMin, Math.min(S.arcRadius * s, room));
  // The aim circle never touches the arcs.
  out.aimMax = Math.max(S.aimMin, Math.min(S.aimMax * s, out.arcR - out.arcW / 2 - S.aimInset * s));
  out.edgeInset = Math.min(S.edgeInset * s, Math.min(w, h) * S.edgeMaxShare);

  // The ship's condition: three rows of bars over a row of pips, centred, `conditionUp` off the floor.
  const condW = S.shipLabelW * s + S.shipBarW * s * 2 + S.shipColGap * s;
  const condH = S.shipBarH * s * 3 + S.shipBarGap * s * 2 + S.pipGap * s + S.pipSize * s;
  out.condition.w = Math.min(condW, w - S.blockMargin * s);
  out.condition.h = condH;
  out.condition.x = Math.round((w - out.condition.w) / 2);
  out.condition.y = Math.round(h - S.conditionUp * s - condH);

  // The action bar, bottom centre, clear of the block under it. On a window too short to hold it up
  // there it goes back under the block instead of climbing off the top, which is the same rule the
  // stylesheet states again in a height query.
  out.action.w = Math.min(S.actionW * s, w - S.blockMargin * s);
  out.action.h = S.actionH * s;
  out.action.x = Math.round((w - out.action.w) / 2);
  const up = (h < S.actionShortH ? S.actionLow : S.actionBottom) * s;
  out.action.y = Math.round(h - up - out.action.h);

  // The message line, bottom left. It is narrowed before it can reach either of the centred blocks,
  // and on a window too cramped for even the narrowest column it climbs above them instead, so the
  // three can never overlap at any size or scale.
  const gap = S.blockGap * s;
  const roomLeft = Math.min(out.condition.x, out.action.x) - S.messageLeft * s - gap;
  out.message.x = Math.round(S.messageLeft * s);
  const narrowed = Math.max(S.messageMinW * s, Math.min(S.messageW * s, roomLeft));
  // …and never wider than the window it sits in, however narrow that is.
  out.message.w = Math.max(0, Math.min(narrowed, w - S.messageLeft * s * 2));
  let bottom = h - S.messageBottom * s;
  if (out.message.w > roomLeft) bottom = Math.min(bottom, Math.min(out.condition.y, out.action.y) - gap);
  // As tall as the pool asks for, and never taller than the room between the window's top and its own
  // foot: on a window too short for even one line the column is nothing rather than a rectangle above
  // the top of the screen.
  const wanted = Math.min(S.messageLineH * s * S.messagePool, Math.max(S.messageLineH * s, bottom));
  out.message.h = Math.max(0, Math.min(wanted, bottom));
  out.message.y = Math.round(Math.max(0, bottom - out.message.h));
  return out;
}

/** Whether two rectangles touch at all. What the layout test asks of the blocks. */
export function overlaps(a: HudRect, b: HudRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The speed arc. It is scaled to the ship's boost top, so the needle can never run off the end of it,
 * and it carries two ticks: the top speed with the wings open and the plain top. The span between
 * them is what open wings cost; the span above the plain top is boost.
 */
export interface SpeedArc {
  /** The needle's angle. */
  angle: number;
  /** The needle's share of the whole arc, 0 to 1. */
  share: number;
  /** The fill's span. */
  from: number;
  to: number;
  /** The open-wing top's tick and the plain top's tick. */
  openAngle: number;
  topAngle: number;
  /** The amber span between the two ticks, empty when the hull has no wing factor. */
  wingFrom: number;
  wingTo: number;
  hasWing: boolean;
  /** The cyan span above the plain top, empty on a ship with no booster. */
  boostFrom: number;
  boostTo: number;
  hasBoost: boolean;
}

export function makeSpeedArc(): SpeedArc {
  return { angle: 0, share: 0, from: 0, to: 0, openAngle: 0, topAngle: 0, wingFrom: 0, wingTo: 0, hasWing: false, boostFrom: 0, boostTo: 0, hasBoost: false };
}

/**
 * `speed`, `top` and `boostTop` in the same unit (the game's metres a second); `wingFactor` is the
 * chassis's `wing_open_speed_factor`, 1 where there is none. `boostTop` at or under `top` means no
 * booster, which is the case on most hulls. `whole` is what the arc's end stands for: the hull's
 * fastest whole and outside every nebula, so a top a nebula or a downed part has lowered sits below
 * the end and the tick shows it; nought (or anything under the hull's own numbers) scales the arc to
 * `top` and `boostTop` as they are now.
 */
export function speedArc(speed: number, top: number, boostTop: number, wingFactor: number, out: SpeedArc, whole = 0): SpeedArc {
  const from = HUD_SIZES.speedFrom;
  const to = HUD_SIZES.speedTo;
  const full = Math.max(top, boostTop, whole > 0 ? whole : 0, 1e-6);
  const wing = wingFactor > 0 && wingFactor < 1 ? wingFactor : 1;
  out.share = clamp01(speed / full);
  out.from = from;
  out.to = to;
  out.angle = along(from, to, out.share);
  out.openAngle = along(from, to, (top * wing) / full);
  out.topAngle = along(from, to, top / full);
  out.hasWing = wing < 1;
  out.wingFrom = out.openAngle;
  out.wingTo = out.topAngle;
  out.hasBoost = boostTop > top * HUD_SIZES.boostEpsilon;
  out.boostFrom = out.topAngle;
  // To the end of the arc, unless the boost top too has been lowered under what the end stands for.
  out.boostTo = boostTop >= full ? to : along(from, to, boostTop / full);
  return out;
}

/** One gun's slice of the gun arc, with a gap between neighbours so a notch reads. */
export interface ArcSlice {
  from: number;
  to: number;
}

export function gunSlice(i: number, n: number, scale: number, out: ArcSlice): ArcSlice {
  const from = HUD_SIZES.gunsFrom;
  const to = HUD_SIZES.gunsTo;
  const count = Math.max(1, n);
  const span = (to - from) / count;
  // The gap is taken in degrees off each end, and never eats more than a third of a slice.
  const gap = Math.min(Math.abs(span) / 3, HUD_SIZES.sliceGap * scale) * Math.sign(span || 1);
  out.from = from + span * i + gap / 2;
  out.to = from + span * (i + 1) - gap / 2;
  return out;
}

/**
 * A bar's colour band from its share: `good` down to a third, `warn` down to a sixth, `bad` under
 * that. The thresholds are ours (`HUD_SIZES.bandWarn`, `bandBad`). The answer is a palette name,
 * which is both a `COL` index for the overlay and a class for the stylesheet.
 */
export function barBand(share: number): 'good' | 'warn' | 'bad' {
  if (share >= HUD_SIZES.bandWarn) return 'good';
  if (share >= HUD_SIZES.bandBad) return 'warn';
  return 'bad';
}

/**
 * A distance as the interface spells it: metres up to `kmFrom`, then kilometres to a tenth. It is
 * here, in the pure file, because two places on the screen read a distance out -- the group's roster
 * down the side and the death card's list of facilities -- and they are often a few centimetres
 * apart. One spelling and one threshold, so the two can never say `1400 m` and `1.4 km` of the same
 * distance at the same moment.
 *
 * `kmFrom` is handed in rather than read here so this stays a function of its arguments: the roster
 * and the card both pass `ROSTER_TUNE.kmFrom`, which is live at the console, and so both follow a
 * change of it together. A distance that is not one at all reads as nothing, because `0 m` and
 * `NaN m` are each a statement and neither is true.
 */
export function distanceWords(metres: number, kmFrom: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '';
  return metres >= kmFrom ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

/** The breath bar: whether it stands at all, how full it is, and whether it is low enough to flash. */
export interface BreathRow {
  show: boolean;
  share: number;
  low: boolean;
}

export function makeBreathRow(): BreathRow {
  // `share` begins as a fraction, so the field is a double from its first write (it is written every frame under water).
  return { show: false, share: 0.5, low: false };
}

/** A breath as whoever holds it keeps it: what is left and the most there can be. */
export interface BreathIn {
  readonly value: number;
  readonly max: number;
}

/** The record `breathRow` hands its two numbers to `breathOf` in: kept, so asking makes nothing. */
const BREATH_IN = { value: 0.5, max: 0.5 };

/**
 * Breath, as the display asks about it. The row is wanted while there is a real pool and it is not
 * full — which is both halves of the rule the design asks for in one test: it comes up the moment
 * breath starts to go, it stays up while it comes back in air (so you can watch it return), and it
 * is down, costing a frame nothing, the rest of the time. Whoever holds the breath may hand over
 * nothing at all on dry land instead, and that is the same answer by a shorter road.
 *
 * An empty breath is emphatically wanted: `value` of 0 shows an empty bar, not no bar. A pool with no
 * maximum, or either number not a number at all, is nothing known rather than a bar at nought, so the
 * row goes down — a display that cannot be told what it is showing shows nothing.
 *
 * `low` is the owner's "below 30%" (`breathFlashBelow`, a share of a full breath): the bar flashes white
 * slowly in and out while it holds. Nothing is allocated: the answer is written into the caller's own struct.
 */
export function breathRow(value: number, max: number, out: BreathRow): BreathRow {
  BREATH_IN.value = value;
  BREATH_IN.max = max;
  return breathOf(BREATH_IN, out);
}

/**
 * The same rule, read off the breath's own record rather than handed two numbers: what the display's frame asks, since a
 * fraction handed to a call the compiler leaves out is a number made a frame (docs/lessons, "A frame allocates nothing").
 */
export function breathOf(r: BreathIn, out: BreathRow): BreathRow {
  const value = r.value;
  const max = r.max;
  const known = Number.isFinite(value) && Number.isFinite(max) && max > 0;
  const share = value / max;
  out.share = !known ? 1 : share < 0 ? 0 : share > 1 ? 1 : share;
  out.show = known && out.share < HUD_SIZES.breathFull;
  out.low = out.show && out.share < HUD_SIZES.breathFlashBelow;
  return out;
}

/** No breath to show (dry land, or a caller that knows nothing of breath): the bar down, full, not flashing. */
export function noBreath(out: BreathRow): BreathRow {
  out.share = 1;
  out.show = false;
  out.low = false;
  return out;
}

// ---- the body block's bars (the interface rewrite's first wave) -------------------------------------------------------

/** Where the block stands: at the bottom left, in the middle, or at the bottom right. Left and right are mirror images. */
export type BlockAlign = 'left' | 'middle' | 'right';
/** How Force meets health: laid over its edge (half over, in front), or inside it (a pill along the edge, half drawn). */
export type ForceLook = 'over' | 'inside';
/** Which of health's two long edges Force is on. */
export type ForceEdge = 'lower' | 'upper';

/**
 * One bar's box in the block's bar area, in CSS pixels at scale 1 from the area's top left (the page multiplies by
 * the HUD scale). `roundL`/`roundR` are the two ends' rounding (a half-height radius, or flat); `clipTop`/`clipBottom`
 * draw only the other half of the box, which is the inside look: the half of the pill outside the health bar is not
 * drawn, so its round ends seem to curve on over the edge. `on` is whether the bar is in the block at all.
 */
export interface BarBox {
  on: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  roundL: boolean;
  roundR: boolean;
  clipTop: boolean;
  clipBottom: boolean;
}

/** The four bars and the area that holds them, which is the size the block lays out round (`w` by `h`, at scale 1). */
export interface BarLayout {
  w: number;
  h: number;
  hp: BarBox;
  pool: BarBox;
  stamina: BarBox;
  breath: BarBox;
}

function makeBarBox(): BarBox {
  return { on: false, x: 0, y: 0, w: 0, h: 0, roundL: true, roundR: true, clipTop: false, clipBottom: false };
}

export function makeBarLayout(): BarLayout {
  return { w: 0, h: 0, hp: makeBarBox(), pool: makeBarBox(), stamina: makeBarBox(), breath: makeBarBox() };
}

/** A box's length and its place along the bar: flush with the outer end at the sides, centred in the middle; rounded away from the edge. */
function alongBar(b: BarBox, align: BlockAlign, full: number, w: number): void {
  b.w = w;
  b.x = align === 'left' ? 0 : align === 'right' ? full - w : (full - w) / 2;
  b.roundL = align !== 'left';
  b.roundR = align !== 'right';
}

/** The top and bottom of what a box shows, its clipped half left out. */
function shownTop(b: BarBox): number {
  return b.clipTop ? b.y + b.h / 2 : b.y;
}
function shownBottom(b: BarBox): number {
  return b.clipBottom ? b.y + b.h / 2 : b.y + b.h;
}

/**
 * Where each bar of the body block stands (the owner's design, 19 November 2026), at scale 1. Pure, and it allocates
 * nothing: the answer is written into the caller's own struct.
 *
 * Health is the long bar. Force is against it with no gap: *laid over* its edge (its middle on the edge, so half of it
 * lies over health, drawn in front), or *inside* it (the same pill, with the half outside health not drawn); `edge`
 * says which of health's edges. Stamina is to Force what Force is to health in the same look: laid over, on Force's
 * outer edge; inside, in health on the edge Force does not use (three never stack inside one bar). With no Force it
 * takes Force's place against health and keeps its own size. Breath is on top of the top-most bar, attached to it as
 * stamina is to Force when laid over; in the inside look every other bar is within health, so it stands against
 * health's top edge, wholly outside it (it cannot go inside: both of health's edges are taken).
 *
 * Every attached bar is `barSideShare` of the one it is attached to at the sides, flush with the outer end, and
 * `barMiddleShare` in the middle, centred. Ends are rounded away from the screen's edge and flat at it; in the middle
 * rounded at both. Breath's place is always kept, under water or not, and so is stamina's while the speed classes are
 * in force, so nothing on the screen moves when a bar comes or goes.
 */
export function barLayout(align: BlockAlign, look: ForceLook, edge: ForceEdge, force: boolean, stamina: boolean, out: BarLayout): BarLayout {
  const S = HUD_SIZES;
  const W = S.healthBarW;
  const Hh = S.healthBarH;
  const Hp = S.poolBarH;
  const Hs = S.staminaBarH;
  const Hb = S.breathBarH;
  const share = align === 'middle' ? S.barMiddleShare : S.barSideShare;
  const lower = edge === 'lower';
  const inside = look === 'inside';
  const hp = out.hp;
  const pool = out.pool;
  const st = out.stamina;
  const br = out.breath;

  hp.on = true;
  alongBar(hp, align, W, W);
  hp.y = 0;
  hp.h = Hh;
  hp.clipTop = false;
  hp.clipBottom = false;

  pool.on = force;
  alongBar(pool, align, W, W * share);
  pool.h = Hp;
  pool.y = lower ? Hh - Hp / 2 : -Hp / 2;
  pool.clipTop = force && inside && !lower;
  pool.clipBottom = force && inside && lower;

  st.on = stamina;
  // Its own size whether Force is there or not: a share of Force's length, which is a share of health's.
  alongBar(st, align, W, W * share * share);
  st.h = Hs;
  if (inside) {
    // On the edge Force does not use; with no Force, on Force's own.
    const up = force ? lower : !lower;
    st.y = up ? -Hs / 2 : Hh - Hs / 2;
    st.clipTop = stamina && up;
    st.clipBottom = stamina && !up;
  } else {
    st.clipTop = false;
    st.clipBottom = false;
    if (force) st.y = lower ? pool.y + Hp - Hs / 2 : pool.y - Hs / 2;
    else st.y = lower ? Hh - Hs / 2 : -Hs / 2;
  }

  br.on = true;
  br.h = Hb;
  br.clipTop = false;
  br.clipBottom = false;
  if (inside) {
    alongBar(br, align, W, W * share);
    br.y = -Hb;
  } else {
    // The top-most bar: health, or whichever attached bar stands higher than it.
    let top: BarBox = hp;
    if (pool.on && pool.y < top.y) top = pool;
    if (st.on && st.y < top.y) top = st;
    alongBar(br, align, W, top.w * share);
    br.y = top.y - Hb / 2;
  }

  // The area: what the bars show, from the highest to the lowest, and every box moved down into it.
  let minY = 0;
  let maxY = Hh;
  if (pool.on) {
    minY = Math.min(minY, shownTop(pool));
    maxY = Math.max(maxY, shownBottom(pool));
  }
  if (st.on) {
    minY = Math.min(minY, shownTop(st));
    maxY = Math.max(maxY, shownBottom(st));
  }
  minY = Math.min(minY, shownTop(br));
  maxY = Math.max(maxY, shownBottom(br));
  hp.y -= minY;
  pool.y -= minY;
  st.y -= minY;
  br.y -= minY;
  out.w = W;
  out.h = maxY - minY;
  return out;
}

/** Where a target sits once it is kept on the screen, and which way to point at it if it is not. */
export interface EdgeMark {
  x: number;
  y: number;
  /** The angle from the middle of the screen to it, for the arrow's turn. */
  angle: number;
  /**
   * Whether it was clamped — that is, whether it is behind the camera or outside the **inset ring**,
   * which stands `inset` pixels in from each edge. It is not the screen test: a target thirty pixels
   * inside the right edge is plainly visible and is still clamped here, because the arrow rides the
   * ring and not the edge. A caller that wants to keep drawing the bracket until the target really
   * leaves does its own screen test and takes the clamp from here (`shipHud` does exactly that).
   */
  off: boolean;
}

export function makeEdgeMark(): EdgeMark {
  return { x: 0, y: 0, angle: 0, off: false };
}

/**
 * A projected point kept on the screen. `behind` is whether the point is behind the camera, in which
 * case its projection is mirrored through the middle before it is clamped — otherwise a target
 * directly behind draws its arrow the wrong way. `inset` is how far inside the edge the arrow rides.
 */
export function edgeMark(x: number, y: number, behind: boolean, w: number, h: number, inset: number, out: EdgeMark): EdgeMark {
  const cx = w / 2;
  const cy = h / 2;
  let dx = x - cx;
  let dy = y - cy;
  if (behind) {
    dx = -dx;
    dy = -dy;
  }
  const inX = cx - inset;
  const inY = cy - inset;
  const off = behind || Math.abs(dx) > inX || Math.abs(dy) > inY;
  out.off = off;
  out.angle = angleOf(dx, dy);
  if (!off) {
    out.x = x;
    out.y = y;
    return out;
  }
  // Onto the inset box: the shorter of the two crossings, and the middle itself points straight up.
  if (dx === 0 && dy === 0) {
    out.x = cx;
    out.y = cy - inY;
    out.angle = 0;
    return out;
  }
  const tx = Math.abs(dx) > 1e-9 ? inX / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-9 ? inY / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  out.x = cx + dx * t;
  out.y = cy + dy * t;
  return out;
}

/** A screen offset to an angle in the interface's convention: 0 up, 90 right. */
export function angleOf(dx: number, dy: number): number {
  const deg = Math.atan2(dx, -dy) / DEG;
  return deg < 0 ? deg + 360 : deg;
}

/**
 * The screen angle a blow came from, for the damage arc: the direction from the player to whatever
 * struck them, against the camera's own axes. A blow from straight ahead or straight behind has
 * almost no sideways part, so under `damageAhead` of the forward part it is taken as twelve or six
 * o'clock rather than left to a rounding error.
 */
export function damageAngle(dx: number, dy: number, dz: number, rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, fx: number, fy: number, fz: number): number {
  const right = dx * rx + dy * ry + dz * rz;
  const up = dx * ux + dy * uy + dz * uz;
  const fwd = dx * fx + dy * fy + dz * fz;
  if (Math.hypot(right, up) < HUD_SIZES.damageAhead * Math.abs(fwd)) return fwd < 0 ? 180 : 0;
  return angleOf(right, -up);
}

/** A nameplate's place over a head, and whether to draw it at all. */
export interface Nameplate {
  x: number;
  y: number;
  show: boolean;
}

export function makeNameplate(): Nameplate {
  return { x: 0, y: 0, show: false };
}

/**
 * A projected head position to a nameplate's place. Behind the camera, off the screen by more than a
 * margin, or further than `range` metres: not drawn at all rather than clamped, because a nameplate
 * is a readout over a thing and not a pointer to it.
 */
export function nameplate(x: number, y: number, behind: boolean, distance: number, range: number, w: number, h: number, out: Nameplate): Nameplate {
  const margin = HUD_SIZES.plateMargin;
  out.show = !behind && distance <= range && x >= -margin && x <= w + margin && y >= -margin && y <= h + margin;
  out.x = x;
  out.y = y;
  return out;
}

/**
 * The target bracket's half-width on the screen, from the target's projected size, kept between
 * `bracketMin` and `bracketMax` so a distant fighter is still a bracket and a capital ship close up
 * is not a frame round the whole window.
 */
export function bracketHalf(projectedSize: number, scale: number): number {
  const lo = HUD_SIZES.bracketMin * scale;
  const hi = HUD_SIZES.bracketMax * scale;
  return Math.max(lo, Math.min(hi, projectedSize)) / 2;
}

/**
 * The lock animation: the corners close from `lockFrom` out to nothing over `lockSeconds`. `t` is the
 * seconds since the target was taken.
 */
export function lockOffset(t: number, scale: number): number {
  const k = clamp01(t / HUD_SIZES.lockSeconds);
  return HUD_SIZES.lockFrom * scale * (1 - k);
}

/** A fade from 1 to 0 over the last `fade` seconds of a life of `life`. */
export function fadeOut(age: number, life: number, fade: number): number {
  if (age >= life) return 0;
  if (age <= life - fade || fade <= 0) return 1;
  return clamp01((life - age) / fade);
}

/**
 * The grapple's diamond's inner edge from the middle, its dark under-stroke included, at a scale: the
 * corners stand `grappleMark` out on the axes, so an edge's nearest point is that over the square root of
 * two, less half the stroke and the under-stroke's own widening (`widen`, the overlay's, two pixels a side).
 */
export function grappleMarkInnerHalo(scale: number, widen: number): number {
  const S = HUD_SIZES;
  return (S.grappleMark * scale) / Math.SQRT2 - (S.grappleMarkWidth * scale) / 2 - widen * scale;
}

/** The rope-used arc's inner edge from the middle, its dark under-stroke included, at a scale: what clears the charge ring. */
export function grappleRopeArcInnerHalo(scale: number, widen: number): number {
  const S = HUD_SIZES;
  return S.grappleRopeArc * scale - (S.grappleRopeArcWidth * scale) / 2 - widen * scale;
}

/** The charge ring's outer edge from the middle, its dark under-stroke included: what the diamond must clear. */
export function chargeOuterHalo(scale: number, widen: number): number {
  const S = HUD_SIZES;
  return S.chargeRadius * scale + (S.chargeWidth * scale) / 2 + widen * scale;
}
