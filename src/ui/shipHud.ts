// The flight display: everything the pilot reads while a ship is flown.
//
// Three pieces, and each is drawn where it is cheapest. The shapes that move every frame — the
// reticle, the three arcs round it, the target's bracket, the edge arrow — go on the 2D overlay,
// which touches no WebGL context and so compiles nothing. Everything that carries words — the ship's
// condition, the speed, the target's name and range — is DOM, written only when the value shown has
// changed. The overlay never draws text and nothing here allocates in a frame: the structs it is
// handed are filled in place by the caller, the colours it draws in are `COL` indices, and the few
// strings it writes are built only in the branch where the number behind them moved.
//
// **Where each number lives.** Every size and every threshold the shapes are drawn from comes from
// `hudMath`; every size, colour and type size the DOM half wears comes from `src/ui/hud.css`, whose
// classes this file only names (`hud-cond`, `hud-bar`, `hud-pip`, `hud-tgt`, `hud-num`). Nothing here
// writes a colour, a font or a length as a style string, so a value the owner changes in the
// stylesheet reaches the flight display with no reload and there is one home for it. What is left in
// code is what changes while the game runs: a transform, a class, a word. The handful of numbers this
// file still invents are gathered in `FLIGHT_RATE` below and are reachable live.
//
// Nothing here knows what a Vehicle or a ShipCombat is: the caller fills `FlightView` and hands the
// condition over as shares, which keeps this file testable from node
// (`tools/swg/tests/shipStatus.test.ts`) and the game's own types out of it.
import { HUD_SIZES, along, bracketHalf, edgeMark, gunSlice, layout, lockOffset, makeEdgeMark, makeLayout, makeSpeedArc, pointX, pointY, speedArc, type ArcSlice, type HudLayout } from './hudMath.ts';

/**
 * The numbers this file invents, gathered in one place beside each other. **Every one of them is
 * invented** — chosen for this pass, not read from anything the game shipped. Everything that is a
 * size or a timing the shapes share with the rest of the interface is in `HUD_SIZES` instead, and
 * everything the DOM half wears is in `src/ui/hud.css`; these are the few that are neither.
 *
 * `ShipHud.tune` writes them in place, which is what `__debug.hud({ flight: … })` reaches. A rate or
 * an alpha is live on the next frame; the two placements are read when the display is laid out, so
 * `tune` runs the layout again itself.
 */
export const FLIGHT_RATE = {
  // --- rates and counts ---------------------------------------------------------------------------
  /** How often the speed readout is rewritten, at most, in times a second. */
  speedHz: 8,
  /** The same for the target's range. */
  targetHz: 8,
  /** How finely a pip's fill is followed: a tenth of its height is the smallest change worth a write. */
  pipSteps: 10,
  /**
   * The most slices the guns' arc is cut into. A hull with more gun slots than this still shows every
   * one of them: the slots past the cap share the last slice, so a gun going down always leaves a
   * notch somewhere rather than nowhere.
   */
  gunCap: 12,
  /** A bar at least this many pixels tall draws the dash glyph; a shorter one shows only its dimmed track. */
  dashMinH: 7,
  // --- alphas on the overlay ----------------------------------------------------------------------
  /** The cursor's arrow: this much, plus this much again by how hard the ship is turning. */
  arrowAlpha: 0.45,
  arrowTurn: 0.55,
  /** The cursor's own diamond. */
  cursorAlpha: 0.95,
  /** The lead marker's ring, dot and two ticks. */
  leadAlpha: 0.9,
  /** The amber span between the speed rail's two ticks, and the cyan one above the plain top. */
  wingSpanAlpha: 0.45,
  boostSpanAlpha: 0.25,
  /** The speed rail's two ticks, and a notch's hairline. */
  tickAlpha: 0.9,
  /** A filled arc: the speed needle, the guns' refire, the booster. */
  fillAlpha: 0.95,
  /** A gun slot that is down: the dark notch cut out of the arc. */
  notchAlpha: 0.85,
  /** The booster's pulse while it is nearly out: this much, swinging by this much at 1 Hz. */
  pulseLow: 0.55,
  pulseSwing: 0.4,
  /** The target's bracket and arrow, and the same while it cannot be fired on. */
  bracketAlpha: 0.95,
  bracketDim: 0.4,
  // --- shapes -------------------------------------------------------------------------------------
  /** The aim circle never draws smaller than this, so a ship whose circle is nothing still has one. */
  circleMin: 4,
  /** The edge arrow's own shape, as shares of its size: its tip ahead, its back behind, its half-width. */
  arrowTip: 0.6,
  arrowBack: 0.4,
  arrowHalf: 0.5,
  // --- placements, in pixels at scale 1 (read when the display is laid out) ------------------------
  /** The speed readout sits this far outside the speed arc, with the wings' word this far under it. */
  speedGap: 12,
  wingDrop: 20,
  /** The target's block hangs this far under the bracket, and this far back from the edge arrow. */
  blockDrop: 6,
  blockBack: 30,
};

/** What `ShipHud.tune` takes and gives back, so the console can offer the names. */
export type FlightTune = typeof FLIGHT_RATE;

/**
 * The most pips the condition block keeps: six fitted parts and up to ten gun slots, which no retail
 * fit reaches. Invented, and a pool size rather than a knob — the row is built once, so it is not in
 * the table above.
 */
const MAX_PIPS = 16;

/** The kinds a message line can carry. Ours: they are our categories, not the game's. */
export type MessageKind = 'system' | 'you hit' | 'hit you' | 'spatial' | 'note';

/** Where a line of this display's own goes. Set by whoever owns the message line. */
export type MessageSink = (kind: MessageKind, text: string, colour?: string) => void;

/**
 * The overlay the shapes are drawn through: the part of `HudCanvas` the flight display uses, declared
 * structurally so this file needs no import of it and still shows its DOM half when nothing is
 * attached. Angles are degrees, clockwise from twelve o'clock, as everywhere in the interface.
 */
export interface FlightCanvas {
  arc(cx: number, cy: number, r: number, from: number, to: number, width: number, colour: number, alpha: number): void;
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: number, alpha: number): void;
  ring(cx: number, cy: number, r: number, width: number, colour: number, alpha: number): void;
  poly(pts: ArrayLike<number>, n: number, width: number, colour: number, alpha: number, close?: boolean, fill?: boolean): void;
}

/** The palette indices the flight display draws in: the palette's own `COL` satisfies this. */
export interface FlightColours {
  readonly accent: number;
  readonly ink: number;
  readonly muted: number;
  readonly void: number;
  readonly rule: number;
  readonly good: number;
  readonly warn: number;
  readonly bad: number;
  readonly hot: number;
  readonly shield: number;
  readonly armour: number;
  readonly chassis: number;
  readonly component: number;
}

/** The wing states the display shows beside the speed. */
export const WING_NONE = 0;
export const WING_CLOSED = 1;
export const WING_OPENING = 2;
export const WING_OPEN = 3;
/** Chosen open, but a low wing is waiting for room under it. */
export const WING_HELD = 4;

const WING_WORD = ['', 'wings closed', 'wings opening', 'wings open', 'wings waiting for room'] as const;

/** What the target is to the pilot. */
export const STAND_ENEMY = 0;
export const STAND_FRIEND = 1;
export const STAND_NEUTRAL = 2;

/**
 * The only two colours this file names, and both are the palette's own custom properties rather than
 * values: the wings' word goes to the caution colour while a low wing is held shut, and back to the
 * secondary colour when it is not, and `src/ui/hud.css` has no class for that one word. The literal
 * after each is the same fallback `palette.ts` carries, so a half-edited stylesheet cannot leave the
 * word with no colour at all.
 */
const WING_WARN = 'var(--warn, #e2a33c)';
const WING_CALM = 'var(--muted, #9fb3c4)';

// ---------------------------------------------------------------------------------------------
// The words and the shares.

/** A chassis slot in words, for "engine down". */
export function partWord(slot: string): string {
  if (slot === 'shield_0' || slot === 'shield_1') return 'shield generator';
  if (slot === 'droid_interface') return 'droid interface';
  const gun = /^weapon_(\d+)$/.exec(slot);
  if (gun) return `gun ${Number(gun[1]) + 1}`;
  return slot.replace(/_/g, ' ');
}

/** What the condition block shows: shares 0..1, NaN where the ship has none of that layer. */
export interface ShipStatusLine {
  shield: [number, number];
  armour: [number, number];
  hull: number;
}

/** The maxima of the flown ship's stats (ShipCombat.stats): a layer whose maximum is 0 the ship has none of. */
export interface ShipStatusMax {
  readonly shieldMax: readonly number[];
  readonly armourMax: readonly number[];
}

/** One fitted part, as `ShipCondition.parts` holds it (structural: nothing is imported from the combat model). */
export interface ShipPartState {
  readonly slot: string;
  readonly hp: number;
  readonly max: number;
  readonly down: boolean;
}

/** A share, or NaN (a dash) where the ship's maximum of it is 0: the status gives 0 there. */
export const has = (share: number, max: number | undefined): number => (max === undefined || max > 0 ? share : NaN);

/** A share clamped, or NaN kept as NaN. */
const clamp01 = (n: number): number => (n > 1 ? 1 : n > 0 ? n : 0);

// ---------------------------------------------------------------------------------------------
// The structs the game fills in place.

/** Everything the reticle and the three arcs are drawn from, filled in place each frame by the caller. */
export interface FlightView {
  /** Where the boresight shows, in pixels from the middle of the window. */
  ox: number;
  oy: number;
  /** The guns' cursor, in pixels from the boresight, in the aim circle's own true units. */
  cx: number;
  cy: number;
  /** The aim circle's true radius in pixels, which the display clamps before it draws it. */
  circle: number;
  /**
   * The stick's whole travel in pixels, which is a larger circle than the aim circle. The cursor is
   * clamped to the aim circle's rim (the design draws it there), so nothing here reads this; it is
   * kept because the caller fills it and it is what a line drawn out to the stick's reach would need.
   */
  ring: number;
  /** How hard the ship is turning, 0..1: the arrow brightens with it. */
  turn: number;
  /** The cursor sits on the target's lead. */
  onLead: boolean;
  /** The hull's own reckoning that the cursor is inside the aim circle. */
  inside: boolean;
  /** Where the lead marker shows, in pixels from the middle of the window, and whether it does. */
  leadX: number;
  leadY: number;
  leadOn: boolean;
  /** The hull's speed in metres a second, its plain top, its boost top, and the wing factor (1: no wings). */
  speed: number;
  topSpeed: number;
  boostTop: number;
  wingFactor: number;
  /** The booster is burning now. */
  boosting: boolean;
  /** The guns' refire clock 0..1 full, how many gun slots the fit has, and a bit per slot that is down. */
  gunReady: number;
  gunSlots: number;
  gunsDown: number;
  /** The boost energy left, 0..1, and whether the ship has a booster at all. */
  boostShare: number;
  hasBooster: boolean;
  /** WING_NONE, WING_CLOSED, WING_OPENING, WING_OPEN or WING_HELD. */
  wings: number;
}

/** A flight view to fill: made once by the caller and handed over every frame. */
export function newFlightView(): FlightView {
  return {
    ox: 0,
    oy: 0,
    cx: 0,
    cy: 0,
    circle: 0,
    ring: 0,
    turn: 0,
    onLead: false,
    inside: true,
    leadX: 0,
    leadY: 0,
    leadOn: false,
    speed: 0,
    topSpeed: 0,
    boostTop: 0,
    wingFactor: 1,
    boosting: false,
    gunReady: 1,
    gunSlots: 0,
    gunsDown: 0,
    boostShare: 0,
    hasBooster: false,
    wings: WING_NONE,
  };
}

/** The target block: where it is, what it is, and the three layers of the face turned toward the pilot. */
export interface TargetView {
  /** Where the target projects, in pixels from the top left of the window, exactly as it came. */
  x: number;
  y: number;
  /**
   * Behind the camera the projection comes out mirrored, and the arrow must be turned back or it
   * points the way the pilot must not go. The caller says so here and hands the projection over
   * untouched; the display mirrors it itself before clamping the arrow to the edge.
   */
  behind: boolean;
  /** How wide the target's projected box is, in pixels: the bracket is clamped to it. */
  size: number;
  /** Its name, what it is (a faction and a tier, already in words), and the range in metres. */
  name: string;
  kind: string;
  range: number;
  /** STAND_ENEMY, STAND_FRIEND or STAND_NEUTRAL. */
  standing: number;
  /** Shares 0..1 of the facing side; NaN where the target has none of that layer. */
  shield: number;
  armour: number;
  hull: number;
  /** False while the target cannot be fired on (in a jump, dead): the bracket dims and the bars go. */
  active: boolean;
}

/** A target view to fill: made once by the caller. */
export function newTargetView(): TargetView {
  return { x: 0, y: 0, behind: false, size: 0, name: '', kind: '', range: 0, standing: STAND_NEUTRAL, shield: 1, armour: 1, hull: 1, active: true };
}

// ---------------------------------------------------------------------------------------------
// The DOM pieces. Every one of them is a class in `src/ui/hud.css`; what is written here is a
// transform, a class or a word, and only when it has changed.

/**
 * One bar: the track, the fill, the ghost of where it was, and the dash for a layer the ship has
 * none of.
 *
 * The ghost is eased **by the stylesheet** (`.hud-bar > .ghost` carries a 0.6 s transition), not by
 * this file: a fall takes the `snap` class off and writes the new value, and the browser walks it
 * down. While the ghost is not easing it carries `snap` and is written straight to the fill's value,
 * where it sits behind the fill and is not seen. That is two writes for a hit rather than one a
 * frame for half a second.
 */
interface Bar {
  root: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  dash: HTMLElement | null;
  /** Pixels of its own length, which is what a change is measured in. */
  px: number;
  /** The share drawn (-1: none yet) and the value last written to the ghost. */
  cur: number;
  ghostAt: number;
  /** The ghost is following the fill at once rather than easing down. */
  snap: boolean;
  /** Seconds left of the ghost's ease, and of the border's flash. */
  ghostFor: number;
  flash: number;
  flashOn: boolean;
  dashOn: boolean;
}

interface Pip {
  root: HTMLElement;
  fill: HTMLElement;
  shown: boolean;
  share: number;
  down: boolean;
  warm: boolean;
}

const div = (parent: HTMLElement | null, className: string): HTMLElement => {
  const el = document.createElement('div');
  if (className) el.className = className;
  if (parent) parent.appendChild(el);
  return el;
};

/** The same for an inline piece: a span, or the `small` the stylesheet gives a readout's unit. */
const inline = (parent: HTMLElement | null, tag: 'span' | 'small', className: string): HTMLElement => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (parent) parent.appendChild(el);
  return el;
};

/** Scratch for the polygons: filled in place, never grown. */
const POLY: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

export class ShipHud {
  readonly root: HTMLElement;
  /** Where a line of this display's own goes: a part down, a taunt. Nothing is shown without one. */
  messages: MessageSink | null = null;

  /** The condition block. */
  private readonly cond: HTMLElement;
  private readonly bars: Bar[] = [];
  private readonly pips: Pip[] = [];
  private readonly pipRow: HTMLElement;
  private readonly hullPct: HTMLElement;
  private condShown = false;
  private hullPctShown = -1;
  /** Whether each pip's part was down when it was last looked at, so a change makes exactly one message. */
  private readonly wasDown: boolean[] = new Array(MAX_PIPS).fill(false);
  private readonly slotOf: string[] = new Array(MAX_PIPS).fill('');
  private partCount = 0;

  /** The speed readout beside the arcs, and the wings' word under it. */
  private readonly speedEl: HTMLElement;
  private readonly speedNum: HTMLElement;
  private readonly wingEl: HTMLElement;
  private readonly wingWord: HTMLElement;
  private speedVisible = false;
  private speedShown = -1;
  private wingShown = -1;
  private speedAt = -Infinity;

  /** The target block. */
  private readonly targetEl: HTMLElement;
  private readonly targetName: HTMLElement;
  private readonly targetRange: HTMLElement;
  private readonly targetKind: HTMLElement;
  private readonly targetBars: Bar[] = [];
  private targetShown = false;
  private targetAt = -Infinity;
  private targetRangeShown = -1;
  private targetNameShown = '';
  private targetKindShown = '';
  private targetClass = '';
  private targetX = NaN;
  private targetY = NaN;
  /** Seconds since this target was taken, which is what closes the bracket's corners. */
  private lockAge = 0;

  /** The overlay and the palette's indices, once they are attached. */
  private canvas: FlightCanvas | null = null;
  private colours: FlightColours | null = null;

  /** The views, copied in place from what the caller hands over. */
  private readonly view: FlightView = newFlightView();
  private readonly target: TargetView = newTargetView();
  private flying = false;
  private targeting = false;

  /** Seconds since the page began, advanced by `update`. */
  private clock = 0;
  private scale = 1;
  private readonly place: HudLayout = makeLayout();
  private readonly speed = makeSpeedArc();
  private readonly mark = makeEdgeMark();
  private readonly slice: ArcSlice = { from: 0, to: 0 };

  /** What the last frame cost, for the console: a kept object. */
  private readonly drawn = { ops: 0, writes: 0, pips: 0, scale: 1, attached: false };
  /** Every DOM write this display has made, and the total at the last second's boundary. */
  private writes = 0;
  private writesMark = 0;
  private writesAt = -Infinity;
  private writesLast = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'ship-hud';
    parent.appendChild(this.root);

    this.cond = div(this.root, 'hud-cond');
    this.cond.style.display = 'none';
    this.pipRow = document.createElement('div');
    this.pipRow.className = 'hud-pips';
    this.hullPct = document.createElement('div');
    this.hullPct.className = 'pct';
    // `.hud-cond .pct` has its width and its right-hand type, but nothing pushes it to the far end of
    // the row the way the design's sketch has it; one property, set once, until the stylesheet does it.
    this.hullPct.style.marginLeft = 'auto';

    this.speedEl = div(this.root, 'hud-num');
    // `.hud-num` is placed by a transform from the layout and the stylesheet gives it no origin to be
    // placed from; two properties, set once.
    this.speedEl.style.left = '0';
    this.speedEl.style.top = '0';
    this.speedEl.style.display = 'none';
    this.speedNum = inline(this.speedEl, 'span', '');
    // The unit is the stylesheet's own `small` beside a readout: smaller, and in the secondary colour.
    inline(this.speedEl, 'small', '').textContent = 'km/h';
    this.wingEl = div(this.root, 'hud-num');
    this.wingEl.style.left = '0';
    this.wingEl.style.top = '0';
    this.wingEl.style.display = 'none';
    this.wingWord = inline(this.wingEl, 'small', '');

    this.targetEl = div(this.root, 'hud-tgt');
    this.targetEl.style.display = 'none';
    this.targetName = document.createElement('span');
    this.targetRange = document.createElement('span');
    this.targetKind = document.createElement('div');

    this.relayout(true);
  }

  // -------------------------------------------------------------------------------------------
  // Building, once, and again only on a change of scale.

  /**
   * One bar. `w` and `h` are the stylesheet's own size for this bar at scale 1 — they are not written
   * anywhere, only used to work out the smallest change worth a write and whether the dash fits as a
   * glyph, so the two tables can never make the bar a different size than it is drawn.
   */
  private makeBar(parent: HTMLElement, w: number, h: number, layer: string): Bar {
    const s = this.scale;
    const root = div(parent, `hud-bar ${layer}`);
    const ghost = div(root, 'ghost snap');
    const fill = div(root, 'fill');
    // The dash for a layer the ship has none of. The stylesheet dims the track through `.none`; the
    // glyph itself has no rule there yet, so it is one element with one style, and a bar too short to
    // hold it legibly (the target's) shows the dimmed track alone.
    let dash: HTMLElement | null = null;
    if (Math.round(h * s) >= FLIGHT_RATE.dashMinH) {
      dash = div(root, 'dash');
      dash.style.cssText = 'position:absolute;inset:0;z-index:4;display:none;align-items:center;justify-content:center;line-height:1;color:var(--muted, #9fb3c4);';
      dash.textContent = '–';
    }
    return { root, fill, ghost, dash, px: Math.max(1, Math.round(w * s)), cur: -1, ghostAt: -1, snap: true, ghostFor: 0, flash: 0, flashOn: false, dashOn: false };
  }

  /** The condition block: shields and armour front and back, the hull, then a pip per fitted part. */
  private buildCondition(): void {
    const S = HUD_SIZES;
    this.cond.textContent = '';
    this.bars.length = 0;
    this.pips.length = 0;
    for (const face of [0, 1]) {
      const row = div(this.cond, 'row');
      const lab = div(row, 'label');
      lab.textContent = face === 0 ? 'Shields' : 'Armour';
      const layer = face === 0 ? 'shield' : 'armour';
      this.bars.push(this.makeBar(row, S.shipBarW, S.shipBarH, layer));
      this.bars.push(this.makeBar(row, S.shipBarW, S.shipBarH, layer));
    }
    const hullRow = div(this.cond, 'row');
    const hullLab = div(hullRow, 'label');
    hullLab.textContent = 'Hull';
    this.bars.push(this.makeBar(hullRow, S.shipBarW, S.shipBarH, 'chassis'));
    hullRow.appendChild(this.hullPct);
    this.hullPctShown = -1;

    this.pipRow.textContent = '';
    this.cond.appendChild(this.pipRow);
    for (let i = 0; i < MAX_PIPS; i++) {
      const root = div(this.pipRow, 'hud-pip');
      root.style.display = 'none';
      const fill = div(root, 'fill');
      this.pips.push({ root, fill, shown: false, share: -1, down: false, warm: false });
    }
  }

  /** The target's three lines: its name and range, what it is, and the three bars of the facing side. */
  private buildTarget(): void {
    const S = HUD_SIZES;
    this.targetEl.textContent = '';
    this.targetBars.length = 0;
    const name = div(this.targetEl, 'name');
    this.targetRange.className = 'range';
    // The range is floated to the far end of the line by the stylesheet, so it comes first in the
    // markup: a float placed after the text it shares a line with is pushed off it.
    name.append(this.targetRange, this.targetName);
    this.targetKind.className = 'what';
    this.targetEl.appendChild(this.targetKind);
    const barRow = div(this.targetEl, 'bars');
    this.targetBars.push(this.makeBar(barRow, S.targetBarW, S.targetBarH, 'shield'));
    this.targetBars.push(this.makeBar(barRow, S.targetBarW, S.targetBarH, 'armour'));
    this.targetBars.push(this.makeBar(barRow, S.targetBarW, S.targetBarH, 'chassis'));
    this.targetNameShown = '';
    this.targetKindShown = '';
    this.targetRangeShown = -1;
    this.targetX = NaN;
    this.targetY = NaN;
  }

  /**
   * The layout for this window and this scale: the blocks are built again at the new sizes and the two
   * readouts the arcs carry are put in their places. Called at boot, on a resize and on a change of
   * scale, and never in a frame. The condition block and the target's own block place themselves —
   * the first from the stylesheet, the second from the target every frame — so neither is written here.
   */
  private relayout(build: boolean): void {
    const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const h = typeof window === 'undefined' ? 720 : window.innerHeight;
    layout(w, h, this.scale, this.place);
    if (build) {
      this.buildCondition();
      this.buildTarget();
    }
    const s = this.place.scale;
    // The speed readout sits just outside the speed arc, on the reticle's own centre, with the wings'
    // word under it. Both are placed here and never moved in a frame.
    const x = Math.round(this.place.cx - this.place.arcR - FLIGHT_RATE.speedGap * s);
    const y = Math.round(this.place.cy);
    this.speedEl.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-100%, -50%)`;
    this.wingEl.style.transform = `translate3d(${x}px, ${y + Math.round(FLIGHT_RATE.wingDrop * s)}px, 0) translate(-100%, -50%)`;
  }

  // -------------------------------------------------------------------------------------------
  // The overlay and the knobs.

  /** The overlay to draw the shapes on, and the palette's indices. Until this is called the DOM half shows alone. */
  attach(canvas: FlightCanvas, colours: FlightColours): void {
    this.canvas = canvas;
    this.colours = colours;
    this.drawn.attached = true;
  }

  /** The HUD scale, 0.75 to 1.5: the blocks are built again at the new sizes, which never happens in a frame. */
  setScale(scale: number): void {
    const s = Math.max(HUD_SIZES.scaleMin, Math.min(HUD_SIZES.scaleMax, Number.isFinite(scale) ? scale : 1));
    if (s === this.scale) return;
    this.scale = s;
    this.drawn.scale = s;
    this.relayout(true);
  }

  /**
   * The numbers this file invents, live: `__debug.hud({ flight: { speedHz: 2 } })`. Only keys already
   * in the table and only finite numbers are taken, so a typo cannot put `undefined` into the
   * geometry; the layout is run again, since two of them are placements.
   */
  tune(patch: Partial<FlightTune>): FlightTune {
    const table = FLIGHT_RATE as unknown as Record<string, number>;
    for (const key of Object.keys(patch)) {
      const value = (patch as Record<string, unknown>)[key];
      if (typeof table[key] !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) continue;
      table[key] = value;
    }
    this.relayout(false);
    return FLIGHT_RATE;
  }

  /** What the last frame drew and wrote, for the console: a kept object. */
  report(): { ops: number; writes: number; pips: number; scale: number; attached: boolean } {
    this.drawn.writes = this.writesLast;
    this.drawn.pips = this.partCount;
    this.drawn.scale = this.scale;
    return this.drawn;
  }

  /**
   * A frame on which the overlay drew nothing at all (the game is not simulating): the shape count
   * the console reports goes to nothing with it, rather than standing at the last flying frame's.
   */
  idle(): void {
    this.drawn.ops = 0;
  }

  // -------------------------------------------------------------------------------------------
  // The lines this display sends.

  /** A taunt: the speaker and the line, in the faction's colour, to whoever owns the message line. */
  say(speaker: string, text: string, color: string): void {
    if (this.messages) this.messages('spatial', `${speaker}: ${text}`, color);
  }

  /** A line of our own (a part going down). */
  private note(kind: MessageKind, text: string): void {
    if (this.messages) this.messages(kind, text);
  }

  // -------------------------------------------------------------------------------------------
  // The ship's condition.

  /**
   * The flown ship's condition, or null when there is no ship. `max` (its stats) turns a share whose
   * maximum is 0 into a dash; `parts` is `ShipCondition.parts`, one pip each, in its own order. A part
   * changing state makes exactly one message. Nothing is written that has not changed.
   *
   * `show` is whether the block is **drawn**, not whether there is one: with it false the block is
   * hidden and nothing about it is written, but the parts are still watched, so a part going down
   * still says so in words. That is the half of it the design calls the answer to "with the pointer
   * locked there is no hover", and it is worth having with the block switched off.
   */
  setStatus(s: ShipStatusLine | null, max?: ShipStatusMax | null, parts?: readonly ShipPartState[] | null, show = true): void {
    if (!s) {
      this.setShown(false);
      this.setPips(null, false);
      for (let i = 0; i < MAX_PIPS; i++) this.wasDown[i] = false;
      return;
    }
    this.setShown(show);
    if (show) {
      this.setBar(this.bars[0], has(s.shield[0], max?.shieldMax[0]));
      this.setBar(this.bars[1], has(s.shield[1], max?.shieldMax[1]));
      this.setBar(this.bars[2], has(s.armour[0], max?.armourMax[0]));
      this.setBar(this.bars[3], has(s.armour[1], max?.armourMax[1]));
      this.setBar(this.bars[4], s.hull);
      const pct = Math.round(clamp01(s.hull) * 100);
      if (pct !== this.hullPctShown) {
        this.hullPctShown = pct;
        this.hullPct.textContent = `${pct}%`;
        this.writes++;
      }
    }
    this.setPips(parts ?? null, show);
  }

  private setShown(show: boolean): void {
    if (show === this.condShown) return;
    this.condShown = show;
    this.cond.style.display = show ? 'flex' : 'none';
    this.writes++;
  }

  /**
   * One pip per fitted part. The watch over what is down runs whether the row is drawn or not — that
   * is what makes the one line in words independent of the block's own switch — and only the writing
   * is conditional.
   */
  private setPips(parts: readonly ShipPartState[] | null, show: boolean): void {
    const n = parts ? Math.min(parts.length, MAX_PIPS) : 0;
    const steps = Math.max(1, FLIGHT_RATE.pipSteps);
    for (let i = 0; i < MAX_PIPS; i++) {
      const pip = this.pips[i];
      const want = i < n;
      if (show && want !== pip.shown) {
        pip.shown = want;
        pip.root.style.display = want ? 'block' : 'none';
        this.writes++;
      }
      if (!want) {
        this.slotOf[i] = '';
        continue;
      }
      const p = parts![i];
      // A pip showing a part it did not show last time starts afresh: a refit makes no message.
      if (this.slotOf[i] !== p.slot) {
        this.slotOf[i] = p.slot;
        this.wasDown[i] = p.down;
      } else if (p.down !== this.wasDown[i]) {
        this.wasDown[i] = p.down;
        this.note(p.down ? 'hit you' : 'note', `${partWord(p.slot)} ${p.down ? 'down' : 'repaired'}`);
      }
      if (!show) continue;
      const share = p.max > 0 ? clamp01(p.hp / p.max) : 0;
      const q = Math.round(share * steps) / steps;
      if (q !== pip.share) {
        pip.share = q;
        pip.fill.style.transform = `scaleY(${q.toFixed(2)})`;
        this.writes++;
      }
      const warm = share < HUD_SIZES.pipWarn;
      if (warm !== pip.warm) {
        pip.warm = warm;
        pip.root.classList.toggle('low', warm);
        this.writes++;
      }
      if (p.down !== pip.down) {
        pip.down = p.down;
        pip.root.classList.toggle('down', p.down);
        this.writes++;
      }
    }
    this.partCount = n;
  }

  /**
   * One bar: the fill, the ghost behind it, the flash on its border, or the dash where the ship has
   * none of that layer.
   *
   * The ghost costs two writes a hit and nothing at all otherwise. While it is not easing it carries
   * `snap` — the stylesheet's "no transition" — and is written straight to the fill's own value,
   * where it sits behind the fill and is never seen; a fall takes `snap` off and writes the new
   * value, and the stylesheet walks it down over `ghostSeconds` by itself.
   */
  private setBar(bar: Bar, share: number): void {
    const dash = !Number.isFinite(share);
    if (dash !== bar.dashOn) {
      bar.dashOn = dash;
      bar.root.classList.toggle('none', dash);
      if (bar.dash) bar.dash.style.display = dash ? 'flex' : 'none';
      this.writes += bar.dash ? 2 : 1;
      if (dash) {
        // Nothing is left standing in the track behind the dash.
        bar.fill.style.transform = 'scaleX(0)';
        bar.ghost.style.transform = 'scaleX(0)';
        this.writes += 2;
        bar.cur = -1;
        bar.ghostAt = 0;
        if (!bar.snap) {
          bar.snap = true;
          bar.ghost.classList.add('snap');
          this.writes++;
        }
        bar.ghostFor = 0;
      }
    }
    if (dash) return;
    const v = clamp01(share);
    // A change smaller than a pixel of the bar's own length is not shown, so a regenerating shield
    // does not write every frame.
    const q = Math.round(v * bar.px) / bar.px;
    if (q === bar.cur) return;
    const fell = bar.cur >= 0 && q < bar.cur;
    if (fell) {
      // The ghost is standing at where the bar was: let the stylesheet ease it down from there.
      if (bar.snap) {
        bar.snap = false;
        bar.ghost.classList.remove('snap');
        this.writes++;
      }
      bar.ghostFor = HUD_SIZES.ghostSeconds;
      bar.flash = HUD_SIZES.flashSeconds;
      if (!bar.flashOn) {
        bar.flashOn = true;
        bar.root.classList.add('hit');
        this.writes++;
      }
      this.writeGhost(bar, q);
    } else if (bar.snap) {
      // Rising, and the ghost is not easing: it follows at once, under the fill, where it is not seen.
      this.writeGhost(bar, q);
    }
    bar.cur = q;
    bar.fill.style.transform = `scaleX(${q.toFixed(4)})`;
    this.writes++;
  }

  private writeGhost(bar: Bar, q: number): void {
    if (q === bar.ghostAt) return;
    bar.ghostAt = q;
    bar.ghost.style.transform = `scaleX(${q.toFixed(4)})`;
    this.writes++;
  }

  /** The ghosts' eases ending and the flashes going out; once a frame, and it writes nothing in a steady one. */
  private updateBars(dt: number): void {
    for (let i = 0; i < this.bars.length; i++) this.easeBar(this.bars[i], dt);
    for (let i = 0; i < this.targetBars.length; i++) this.easeBar(this.targetBars[i], dt);
  }

  private easeBar(bar: Bar, dt: number): void {
    if (bar.ghostFor > 0) {
      bar.ghostFor -= dt;
      if (bar.ghostFor <= 0) {
        // The ease is over: the ghost goes back to following the fill at once, ready for the next blow.
        bar.ghostFor = 0;
        bar.snap = true;
        bar.ghost.classList.add('snap');
        this.writes++;
        if (bar.cur >= 0) this.writeGhost(bar, bar.cur);
      }
    }
    if (bar.flash > 0) {
      bar.flash -= dt;
      if (bar.flash <= 0 && bar.flashOn) {
        bar.flashOn = false;
        bar.root.classList.remove('hit');
        this.writes++;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // The reticle, the arcs and the target.

  /** The flight view for this frame, or null out of a ship: its fields are copied, so the caller may reuse its struct. */
  setFlight(view: FlightView | null): void {
    this.flying = !!view;
    if (!view) {
      if (this.speedVisible) {
        this.speedVisible = false;
        this.speedShown = -1;
        this.wingShown = -1;
        this.speedEl.style.display = 'none';
        this.wingEl.style.display = 'none';
        this.writes += 2;
      }
      return;
    }
    const v = this.view;
    v.ox = view.ox;
    v.oy = view.oy;
    v.cx = view.cx;
    v.cy = view.cy;
    v.circle = view.circle;
    v.ring = view.ring;
    v.turn = view.turn;
    v.onLead = view.onLead;
    v.inside = view.inside;
    v.leadX = view.leadX;
    v.leadY = view.leadY;
    v.leadOn = view.leadOn;
    v.speed = view.speed;
    v.topSpeed = view.topSpeed;
    v.boostTop = view.boostTop;
    v.wingFactor = view.wingFactor;
    v.boosting = view.boosting;
    v.gunReady = view.gunReady;
    v.gunSlots = view.gunSlots;
    v.gunsDown = view.gunsDown;
    v.boostShare = view.boostShare;
    v.hasBooster = view.hasBooster;
    v.wings = view.wings;
    this.writeSpeed();
  }

  /** The speed in km/h and the wings' word: rewritten at the rate above, and only when the number moved. */
  private writeSpeed(): void {
    if (!this.speedVisible) {
      this.speedVisible = true;
      this.speedEl.style.display = 'block';
      this.writes++;
    }
    if (this.clock - this.speedAt >= 1 / Math.max(1, FLIGHT_RATE.speedHz)) {
      this.speedAt = this.clock;
      const kmh = Math.round(Math.abs(this.view.speed) * 3.6);
      if (kmh !== this.speedShown) {
        this.speedShown = kmh;
        this.speedNum.textContent = `${kmh}`;
        this.writes++;
      }
    }
    const w = this.view.wings;
    if (w !== this.wingShown) {
      this.wingShown = w;
      const word = WING_WORD[w] ?? '';
      this.wingWord.textContent = word;
      this.wingEl.style.display = word ? 'block' : 'none';
      this.wingWord.style.color = w === WING_HELD ? WING_WARN : WING_CALM;
      this.writes += 3;
    }
  }

  /** The target for this frame, or null: its fields are copied. */
  setTarget(t: TargetView | null): void {
    if (!t) {
      this.targeting = false;
      if (this.targetShown) {
        this.targetShown = false;
        this.targetEl.style.display = 'none';
        this.writes++;
      }
      this.target.name = '';
      this.targetNameShown = '';
      return;
    }
    const o = this.target;
    // A new target closes its corners afresh.
    if (t.name !== o.name) this.lockAge = 0;
    o.x = t.x;
    o.y = t.y;
    o.behind = t.behind;
    o.size = t.size;
    o.name = t.name;
    o.kind = t.kind;
    o.range = t.range;
    o.standing = t.standing;
    o.shield = t.shield;
    o.armour = t.armour;
    o.hull = t.hull;
    o.active = t.active;
    this.targeting = true;
    this.writeTarget();
  }

  /** Where the target sits once it is kept on the screen, and whether it had to be clamped there. */
  private markTarget(): void {
    const o = this.target;
    edgeMark(o.x, o.y, o.behind, this.place.w, this.place.h, this.place.edgeInset, this.mark);
  }

  private writeTarget(): void {
    const o = this.target;
    const s = this.place.scale;
    if (!this.targetShown) {
      this.targetShown = true;
      this.targetEl.style.display = 'flex';
      this.writes++;
    }
    if (o.name !== this.targetNameShown) {
      this.targetNameShown = o.name;
      this.targetName.textContent = o.name;
      this.writes++;
    }
    // Enemy, friend or neither, and dimmed while it cannot be fired on: one class, written on a change.
    const want = `hud-tgt${o.standing === STAND_ENEMY ? ' enemy' : o.standing === STAND_FRIEND ? ' friend' : ''}${o.active ? '' : ' inactive'}`;
    if (want !== this.targetClass) {
      this.targetClass = want;
      this.targetEl.className = want;
      this.writes++;
    }
    if (o.kind !== this.targetKindShown) {
      this.targetKindShown = o.kind;
      this.targetKind.textContent = o.kind;
      this.writes++;
    }
    if (this.clock - this.targetAt >= 1 / Math.max(1, FLIGHT_RATE.targetHz)) {
      this.targetAt = this.clock;
      const range = Math.round(o.range);
      if (range !== this.targetRangeShown) {
        this.targetRangeShown = range;
        this.targetRange.textContent = `${range} m`;
        this.writes++;
      }
    }
    // The bars go while the target cannot be fired on.
    this.setBar(this.targetBars[0], o.active ? o.shield : NaN);
    this.setBar(this.targetBars[1], o.active ? o.armour : NaN);
    this.setBar(this.targetBars[2], o.active ? o.hull : NaN);
    // Where the block sits: under the bracket on screen, beside the edge arrow off it.
    this.markTarget();
    let x: number;
    let y: number;
    if (!this.mark.off) {
      const half = bracketHalf(o.size, s);
      x = Math.round(this.mark.x - half);
      y = Math.round(this.mark.y + half + FLIGHT_RATE.blockDrop * s);
    } else {
      // Inboard of the arrow, not outboard of it: the block is three lines tall and the arrow already
      // rides only `edgeInset` from the edge, so a block put outside it would be cut off by the window.
      const out = (HUD_SIZES.edgeLabel + HUD_SIZES.edgeArrow) * s;
      x = Math.round(pointX(this.mark.x, -out, this.mark.angle) - FLIGHT_RATE.blockBack * s);
      y = Math.round(pointY(this.mark.y, -out, this.mark.angle));
    }
    if (x !== this.targetX || y !== this.targetY) {
      this.targetX = x;
      this.targetY = y;
      this.targetEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      this.writes++;
    }
  }

  // -------------------------------------------------------------------------------------------
  // The overlay's own drawing: one call a frame, between the canvas's begin and end.

  /** Every shape of the flight display. Draws nothing without an overlay, or out of a ship. */
  draw(): void {
    this.drawn.ops = 0;
    const c = this.canvas;
    const col = this.colours;
    if (!c || !col || !this.flying) return;
    const s = this.place.scale;
    // The reticle hangs on the boresight, which drifts off the middle while a chase view catches a
    // turn; the three arcs stay on the middle, so the instrument never swims about the screen.
    this.drawReticle(c, col, this.place.cx + this.view.ox, this.place.cy + this.view.oy, s);
    this.drawArcs(c, col, this.place.cx, this.place.cy, s);
    if (this.targeting) this.drawTarget(c, col, s);
  }

  private op(n: number): void {
    this.drawn.ops += n;
  }

  private drawReticle(c: FlightCanvas, col: FlightColours, bx: number, by: number, s: number): void {
    const S = HUD_SIZES;
    const R = FLIGHT_RATE;
    const v = this.view;
    // The boresight: four ticks out of the middle, never a dot over what is being aimed at.
    const gap = S.boresightFrom * s;
    const len = S.boresightLen * s;
    const w = S.boresightWidth * s;
    c.line(bx - gap - len, by, bx - gap, by, w, col.ink, S.boresightAlpha);
    c.line(bx + gap, by, bx + gap + len, by, w, col.ink, S.boresightAlpha);
    c.line(bx, by - gap - len, bx, by - gap, w, col.ink, S.boresightAlpha);
    c.line(bx, by + gap, bx, by + gap + len, w, col.ink, S.boresightAlpha);
    this.op(4);
    // The aim circle: four arcs with gaps at the diagonals, so it never closes into a ring the eye
    // reads as a target. Clamped by the layout so it can never touch the arcs — and the cursor is
    // scaled into the circle as it is drawn, or on a tall window the hull would call the cursor
    // inside a circle the display had already shrunk under it.
    const r = Math.min(this.place.aimMax, Math.max(R.circleMin, v.circle));
    const k = v.circle > 1e-3 ? r / v.circle : 1;
    const cx = v.cx * k;
    const cy = v.cy * k;
    const inside = v.inside || Math.hypot(cx, cy) <= r;
    const alpha = inside ? S.aimAlphaInside : S.aimAlpha;
    const colour = v.onLead ? col.good : col.accent;
    const step = S.aimSpan + S.aimGap;
    for (let i = 0; i < 4; i++) {
      // Centred on each diagonal: 45 degrees is the first of the four, a quarter turn apart.
      const from = 45 + i * step - S.aimSpan / 2;
      c.arc(bx, by, r, from, from + S.aimSpan, S.aimWidth * s, colour, alpha);
      this.op(1);
    }
    // The cursor: a diamond inside the circle; outside it the same diamond clamped to the rim with an
    // arrow behind it, brighter the harder the ship is turning.
    const d = (S.cursorSize / 2) * s;
    let px = bx + cx;
    let py = by + cy;
    if (!inside) {
      const len2 = Math.max(1e-3, Math.hypot(cx, cy));
      const ux = cx / len2;
      const uy = cy / len2;
      px = bx + ux * r;
      py = by + uy * r;
      const tail = S.cursorArrow * s;
      POLY[0] = px + ux * tail;
      POLY[1] = py + uy * tail;
      POLY[2] = px - uy * tail * 0.5;
      POLY[3] = py + ux * tail * 0.5;
      POLY[4] = px + uy * tail * 0.5;
      POLY[5] = py - ux * tail * 0.5;
      // In the instrument's own colour, which is what tells it from the target's arrow at the edge.
      c.poly(POLY, 3, S.aimWidth * s, col.accent, R.arrowAlpha + R.arrowTurn * clamp01(v.turn), true, true);
      this.op(1);
    }
    POLY[0] = px;
    POLY[1] = py - d;
    POLY[2] = px + d;
    POLY[3] = py;
    POLY[4] = px;
    POLY[5] = py + d;
    POLY[6] = px - d;
    POLY[7] = py;
    c.poly(POLY, 4, S.aimWidth * s, col.ink, R.cursorAlpha, true, false);
    this.op(1);
    // The lead marker: a ring with a centre dot and two ticks, so it is never taken for the cursor.
    if (v.leadOn) {
      const lx = this.place.cx + v.leadX;
      const ly = this.place.cy + v.leadY;
      const lr = (S.leadRadius / 2) * s;
      const lead = v.onLead ? col.good : col.muted;
      const lw = S.leadWidth * s;
      c.ring(lx, ly, lr, lw, lead, R.leadAlpha);
      c.ring(lx, ly, (S.leadDot / 2) * s, lw, lead, R.leadAlpha);
      c.line(lx, ly - lr - S.leadTick * s, lx, ly - lr, lw, lead, R.leadAlpha);
      c.line(lx, ly + lr, lx, ly + lr + S.leadTick * s, lw, lead, R.leadAlpha);
      this.op(4);
    }
  }

  private drawArcs(c: FlightCanvas, col: FlightColours, cx: number, cy: number, s: number): void {
    const S = HUD_SIZES;
    const R = FLIGHT_RATE;
    const v = this.view;
    const r = this.place.arcR;
    const w = this.place.arcW;
    // Speed, up the left, scaled to the boost top so the needle can never run off the end.
    const a = speedArc(Math.abs(v.speed), v.topSpeed, v.boostTop, v.wingFactor, this.speed);
    c.arc(cx, cy, r, a.from, a.to, w, col.rule, 1);
    this.op(1);
    // What open wings cost: the span between the open top and the plain top.
    if (a.hasWing) {
      c.arc(cx, cy, r, a.wingFrom, a.wingTo, w, col.warn, R.wingSpanAlpha);
      this.op(1);
    }
    // Boost: the span above the plain top, which the needle enters only while the booster burns.
    if (a.hasBoost) {
      c.arc(cx, cy, r, a.boostFrom, a.boostTo, w, col.accent, R.boostSpanAlpha);
      this.op(1);
    }
    if (a.share > 1e-4) {
      c.arc(cx, cy, r, a.from, a.angle, w, v.boosting ? col.hot : col.accent, R.fillAlpha);
      this.op(1);
    }
    // The two ticks across the rail: the open-wing top, then the plain top.
    const half = this.place.tickLen / 2;
    this.railTick(c, col, cx, cy, r, half, a.openAngle, s);
    this.railTick(c, col, cx, cy, r, half, a.topAngle, s);
    // The guns, up the right: the refire clock across the whole arc, a notch where a slot is down.
    if (v.gunSlots > 0) {
      c.arc(cx, cy, r, S.gunsFrom, S.gunsTo, w, col.rule, 1);
      this.op(1);
      const ready = clamp01(v.gunReady);
      if (ready > 1e-4) {
        c.arc(cx, cy, r, S.gunsFrom, along(S.gunsFrom, S.gunsTo, ready), w, col.good, R.fillAlpha);
        this.op(1);
      }
      // One slice a gun slot, up to the cap; a fit with more slots than that folds the rest onto the
      // last slice, so a gun going down always leaves a notch rather than none at all.
      const n = Math.max(1, Math.min(v.gunSlots, Math.round(R.gunCap)));
      let bits = 0;
      for (let i = 0; i < v.gunSlots; i++) {
        if (v.gunsDown & (1 << i)) bits |= 1 << Math.min(i, n - 1);
      }
      for (let i = 0; i < n; i++) {
        if (!(bits & (1 << i))) continue;
        gunSlice(i, n, s, this.slice);
        c.arc(cx, cy, r, this.slice.from, this.slice.to, w, col.void, R.notchAlpha);
        const mid = (this.slice.from + this.slice.to) / 2;
        c.line(pointX(cx, r - w / 2, mid), pointY(cy, r - w / 2, mid), pointX(cx, r + w / 2, mid), pointY(cy, r + w / 2, mid), S.boresightWidth * s, col.bad, R.tickAlpha);
        this.op(2);
      }
    }
    // The booster, across six o'clock: absent on a ship that has none, pulsing while it is nearly out.
    if (v.hasBooster) {
      c.arc(cx, cy, r, S.boostFrom, S.boostTo, w, col.rule, 1);
      this.op(1);
      const share = clamp01(v.boostShare);
      if (share > 1e-4) {
        const pulse = share < S.boostPulse ? R.pulseLow + R.pulseSwing * (0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2)) : R.fillAlpha;
        c.arc(cx, cy, r, S.boostFrom, along(S.boostFrom, S.boostTo, share), w, v.boosting ? col.hot : col.warn, pulse);
        this.op(1);
      }
    }
  }

  /** One tick across the speed rail, at an angle. */
  private railTick(c: FlightCanvas, col: FlightColours, cx: number, cy: number, r: number, half: number, deg: number, s: number): void {
    c.line(pointX(cx, r - half, deg), pointY(cy, r - half, deg), pointX(cx, r + half, deg), pointY(cy, r + half, deg), HUD_SIZES.boresightWidth * s, col.ink, FLIGHT_RATE.tickAlpha);
    this.op(1);
  }

  private drawTarget(c: FlightCanvas, col: FlightColours, s: number): void {
    const S = HUD_SIZES;
    const R = FLIGHT_RATE;
    const o = this.target;
    const colour = o.standing === STAND_ENEMY ? col.bad : o.standing === STAND_FRIEND ? col.good : col.ink;
    const alpha = o.active ? R.bracketAlpha : R.bracketDim;
    this.markTarget();
    if (this.mark.off) {
      // Off the screen: a triangle on a ring inside the edge, pointing at it, with a short tail.
      const ax = this.mark.x;
      const ay = this.mark.y;
      const deg = this.mark.angle;
      const size = S.edgeArrow * s;
      const back = size * R.arrowBack;
      const wide = size * R.arrowHalf;
      const backX = pointX(ax, -back, deg);
      const backY = pointY(ay, -back, deg);
      POLY[0] = pointX(ax, size * R.arrowTip, deg);
      POLY[1] = pointY(ay, size * R.arrowTip, deg);
      POLY[2] = pointX(backX, wide, deg + 90);
      POLY[3] = pointY(backY, wide, deg + 90);
      POLY[4] = pointX(backX, wide, deg - 90);
      POLY[5] = pointY(backY, wide, deg - 90);
      c.poly(POLY, 3, S.bracketWidth * s, colour, alpha, true, true);
      c.line(backX, backY, pointX(ax, -(back + S.edgeTail * s), deg), pointY(ay, -(back + S.edgeTail * s), deg), S.bracketWidth * s, colour, alpha);
      this.op(2);
      return;
    }
    // On the screen: four L-corners at the corners of the target's box, closing from a little out as
    // the lock takes. Never a rectangle — the corners alone keep the target visible inside them.
    const half = bracketHalf(o.size, s) + lockOffset(this.lockAge, s);
    const leg = S.bracketLeg * s;
    const w = S.bracketWidth * s;
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? 1 : -1;
      const sy = i & 2 ? 1 : -1;
      const x = this.mark.x + sx * half;
      const y = this.mark.y + sy * half;
      c.line(x, y, x - sx * leg, y, w, colour, alpha);
      c.line(x, y, x, y - sy * leg, w, colour, alpha);
      this.op(2);
    }
  }

  // -------------------------------------------------------------------------------------------

  /** The ghosts' eases ending, the flashes going out, the lock closing; once a frame. */
  update(dt: number): void {
    this.clock += dt;
    this.lockAge += dt;
    if (typeof window !== 'undefined' && (window.innerWidth !== this.place.w || window.innerHeight !== this.place.h)) this.relayout(false);
    this.updateBars(dt);
    // The writes of the last second, for the console: in a steady frame the number to look for is 0.
    if (this.clock - this.writesAt >= 1) {
      this.writesAt = this.clock;
      this.writesLast = this.writes - this.writesMark;
      this.writesMark = this.writes;
    }
  }

  /** Every block gone (the world left, or the game is not simulating). */
  clear(): void {
    this.setStatus(null);
    this.setFlight(null);
    this.setTarget(null);
    this.idle();
  }
}
