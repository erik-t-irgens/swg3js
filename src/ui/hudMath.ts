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
  healthBarW: 160,
  healthBarH: 10,
  poolBarW: 160,
  poolBarH: 6,
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
  /** The crosshair: a dot, four ticks, and the charge as a ring. */
  dotRadius: 3,
  footTickFrom: 9,
  footTickLen: 5,
  chargeRadius: 16,
  chargeWidth: 2.5,
  /** An ability cell and its glyph. */
  slotSize: 40,
  slotGlyph: 28,
  /** A key-cap. */
  capW: 22,
  capH: 18,
  // --- the blocks --------------------------------------------------------------------------------
  /** The ship's condition, centred, this far up from the bottom. */
  conditionUp: 96,
  /** The message line, bottom left. */
  messageLeft: 14,
  messageBottom: 14,
  messageW: 420,
  messageLineH: 22,
  /** The action bar, bottom centre. */
  actionBottom: 52,
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

  // The action bar, bottom centre, under the condition block.
  out.action.w = Math.min(S.actionW * s, w - S.blockMargin * s);
  out.action.h = S.actionH * s;
  out.action.x = Math.round((w - out.action.w) / 2);
  out.action.y = Math.round(h - S.actionBottom * s - out.action.h);

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
 * booster, which is the case on most hulls.
 */
export function speedArc(speed: number, top: number, boostTop: number, wingFactor: number, out: SpeedArc): SpeedArc {
  const from = HUD_SIZES.speedFrom;
  const to = HUD_SIZES.speedTo;
  const full = Math.max(top, boostTop, 1e-6);
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
  out.boostTo = to;
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
