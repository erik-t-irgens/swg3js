// The character's waypoints in the world: a mark of our own where each one stands, drawn on the overlay,
// and the distance to the tracked one and the nearest one in view, written beside them.
//
// The marks are shapes, so they are the overlay's: no text, nothing allocated, the union clear and every
// stroke twice (the `void` halo two pixels wider, then the colour), all of which `HudCanvas` already does
// inside each call. Three shapes, so a glance tells what kind of place it is:
//
//   - a waypoint of your own is a diamond;
//   - a quest's is a diamond with a dot in its middle;
//   - one in a room is a diamond with a notch cut up into its foot, the way a doorway is cut into a wall;
//
// and a mark standing well above or below you (`heightHint`) carries a small caret over or under it, so a
// waypoint on the floor above in a cantina reads as up the stairs and not through the ceiling. The
// tracked one is drawn filled and a little larger, and when it is off the screen it is the flight
// display's own edge arrow (`edgeMark`) instead, riding the ring inside the screen's edge.
//
// The distances are words and the overlay draws none, so they are page elements: a pool of
// `labelsMax`, made once, each written only when the distance it shows has moved by a rounding step or
// it has moved a whole pixel on the screen. A label is under its mark, or inboard of the arrow.
//
// Where each mark stands is not worked out here (`src/world/waypointPlace.ts` does that a few times a
// second); this file only projects points it is handed, every frame, through the camera's own two
// matrices. Nothing of three is imported.
//
// In a conversation all of it stands aside, deliberately and with nothing done here: the conversation
// hides every child of the interface layer but its own (`#ui.talking`), the overlay and these labels
// among them, and a waypoint is nothing to look at while somebody is talking to you.

import { COL, type PaletteName } from '../core/palette.ts';
import { WAYPOINT_TUNE } from '../story/waypoints.ts';
import { MARK_QUEST, MARK_ROOM, type PlacedMark } from '../world/waypointPlace.ts';
import { HUD_SIZES, edgeMark, makeEdgeMark, pointX, pointY } from './hudMath.ts';
import { makeProjected, projectPoint, type PlateCamera } from './nameplate.ts';

/** What this file draws on the overlay: the part of `HudCanvas` it needs, declared structurally. */
export interface WaypointCanvas {
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: number, alpha: number): void;
  ring(cx: number, cy: number, r: number, width: number, colour: number, alpha: number): void;
  poly(pts: ArrayLike<number>, n: number, width: number, colour: number, alpha: number, close?: boolean, fill?: boolean): void;
}

/** The marks this file is handed: `WaypointPlaces` satisfies it. */
export interface MarkSource {
  readonly marks: readonly PlacedMark[];
  readonly count: number;
}

/** A palette name to the index the overlay draws with; a name that is not one reads as `accent`. */
export function markColour(name: string): number {
  return COL[name as PaletteName] ?? COL.accent;
}

/**
 * A distance as the marks' labels say it: to `nearRound` metres under `farFrom`, then to `farRound`
 * kilometres. Not a distance at all is nothing, because `0 m` of something unknown is a statement.
 */
export function waypointWords(metres: number): string {
  const T = WAYPOINT_TUNE;
  if (!Number.isFinite(metres) || metres < 0) return '';
  if (metres < T.farFrom) return `${Math.round(metres / T.nearRound) * T.nearRound} m`;
  const km = Math.round(metres / 1000 / T.farRound) * T.farRound;
  return `${km.toFixed(T.farRound < 0.1 ? 2 : 1)} km`;
}

/**
 * The step a distance is said at, as a number, so a label compares two numbers rather than two strings
 * and writes only when the words would really change. The kilometres are counted from a million so the
 * two kinds of step can never be mistaken for each other.
 */
export function waypointStep(metres: number): number {
  const T = WAYPOINT_TUNE;
  if (!Number.isFinite(metres) || metres < 0) return -1;
  if (metres < T.farFrom) return Math.round(metres / T.nearRound);
  return 1e6 + Math.round(metres / 1000 / T.farRound);
}

/**
 * A mark's outline into `out` (x, y pairs), answering how many points. A diamond `r` from its middle to
 * each point; a room's has its foot cut up into a notch a third of the way, so the three kinds differ in
 * shape and not only in what is drawn inside them.
 */
export function markShape(kind: number, cx: number, cy: number, r: number, out: Float32Array | number[]): number {
  out[0] = cx;
  out[1] = cy - r;
  out[2] = cx + r;
  out[3] = cy;
  if (kind !== MARK_ROOM) {
    out[4] = cx;
    out[5] = cy + r;
    out[6] = cx - r;
    out[7] = cy;
    return 4;
  }
  const n = r * 0.35;
  out[4] = cx + n;
  out[5] = cy + r - n;
  out[6] = cx;
  out[7] = cy + r - 2 * n;
  out[8] = cx - n;
  out[9] = cy + r - n;
  out[10] = cx - r;
  out[11] = cy;
  return 6;
}

/** Whether a projected point is on the screen with room for a mark of half-width `r` round it. */
export function onScreen(x: number, y: number, behind: boolean, w: number, h: number, r: number): boolean {
  return !behind && x >= -r && x <= w + r && y >= -r && y <= h + r;
}

/** The edge arrow's own shape, as shares of its size: the flight display's (`FLIGHT_RATE`), so the two read as one thing. */
const ARROW = { tip: 0.6, back: 0.4, half: 0.5 };
/** The tracked mark is drawn this much larger than the rest. Ours. */
const TRACKED_SCALE = 1.3;
/** The marks' alpha. Ours. */
const MARK_ALPHA = 0.95;

const POLY = new Float32Array(16);

interface Label {
  root: HTMLElement;
  /** The id it shows, the step its words were written at, and where it was last placed. */
  id: string;
  step: number;
  x: number;
  y: number;
  on: boolean;
}

/** The clock the write count's second is measured on, wherever this file is run. */
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export class WaypointHud {
  readonly root: HTMLElement;
  private readonly labels: Label[] = [];
  private canvas: WaypointCanvas | null = null;
  private scale = 1;
  private marksOn = true;
  private inFlight = true;
  private readonly at = makeProjected();
  private readonly edge = makeEdgeMark();
  /** Each mark's place on the screen this frame, and whether it is on it, by its index in the source. */
  private sx = new Float32Array(16);
  private sy = new Float32Array(16);
  private seen = new Uint8Array(16);
  private far = new Float32Array(16);
  /** DOM writes this second and the last full second, the display's own reading. */
  private writes = 0;
  private lastWrites = 0;
  private windowStart = nowMs();
  /** What `report` hands back: one object, filled in place. */
  private readonly out = { drawn: 0, arrows: 0, labels: 0, ops: 0, writes: 0, shown: true, inFlight: true, attached: false };

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-wp-labels';
    parent.appendChild(this.root);
    const n = Math.max(1, Math.round(WAYPOINT_TUNE.labelsMax));
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'hud-wp-label';
      el.hidden = true;
      this.root.appendChild(el);
      this.labels.push({ root: el, id: '', step: -2, x: Number.NaN, y: Number.NaN, on: false });
    }
  }

  /** The overlay to draw on. Until this, nothing is drawn. */
  attach(canvas: WaypointCanvas): void {
    this.canvas = canvas;
    this.out.attached = true;
  }

  setScale(scale: number): void {
    this.scale = scale > 0 ? scale : 1;
  }

  /** The Interface page's two switches: the marks at all, and the marks while flying. */
  setShown(marks: boolean, inFlight: boolean): void {
    this.marksOn = marks;
    this.inFlight = inFlight;
    this.out.shown = marks;
    this.out.inFlight = inFlight;
    if (!marks) this.hideLabels();
  }

  /**
   * One frame, after the world is drawn: every mark the source holds projected through `camera`, drawn
   * on the overlay, and the labels placed. `px, py, pz` is where you stand in the world. Allocates nothing.
   */
  draw(src: MarkSource, camera: PlateCamera, w: number, h: number, px: number, py: number, pz: number, flying: boolean): void {
    this.roll();
    const c = this.canvas;
    const o = this.out;
    o.drawn = 0;
    o.arrows = 0;
    o.ops = 0;
    if (!c || !this.marksOn || (flying && !this.inFlight) || src.count === 0) {
      this.hideLabels();
      return;
    }
    const n = src.count;
    if (this.sx.length < n) {
      this.sx = new Float32Array(n * 2);
      this.sy = new Float32Array(n * 2);
      this.seen = new Uint8Array(n * 2);
      this.far = new Float32Array(n * 2);
    }
    const s = this.scale;
    const T = WAYPOINT_TUNE;
    const width = HUD_SIZES.boresightWidth * s;
    let tracked = -1;
    for (let k = 0; k < n; k++) {
      const m = src.marks[k];
      projectPoint(m.x, m.y, m.z, camera, w, h, this.at);
      this.far[k] = Math.hypot(m.x - px, m.y - py, m.z - pz);
      const r = HUD_SIZES.waypointMark * s * (m.tracked ? TRACKED_SCALE : 1);
      const colour = markColour(m.colour);
      this.seen[k] = 0;
      if (m.tracked) tracked = k;
      if (onScreen(this.at.x, this.at.y, this.at.behind, w, h, r)) {
        const x = this.at.x;
        const y = this.at.y;
        this.sx[k] = x;
        this.sy[k] = y;
        this.seen[k] = 1;
        const pts = markShape(m.kind, x, y, r, POLY);
        c.poly(POLY, pts, width, colour, MARK_ALPHA, true, m.tracked);
        o.ops++;
        if (m.kind === MARK_QUEST) {
          // The dot, as the crosshair's own dot is drawn: a circle stroked at half its radius is a disc.
          // On the filled tracked mark it is the dark, or it would vanish into its own colour.
          const dot = T.questDotPx * s;
          c.ring(x, y, dot / 2, dot, m.tracked ? COL.void : colour, 1);
          o.ops++;
        }
        const rise = m.y - py;
        if (rise > T.heightHint || rise < -T.heightHint) {
          // A caret over a mark above you and under one below, a pixel or two off its point.
          const cw = T.caretPx * s;
          const up = rise > 0;
          const base = up ? y - r - 2 * s : y + r + 2 * s;
          const tip = up ? base - cw : base + cw;
          POLY[0] = x - cw;
          POLY[1] = base;
          POLY[2] = x;
          POLY[3] = tip;
          POLY[4] = x + cw;
          POLY[5] = base;
          c.poly(POLY, 3, width, colour, MARK_ALPHA, false, false);
          o.ops++;
        }
        o.drawn++;
      } else if (m.tracked) {
        // Off the screen: the tracked one is an arrow on the ring inside the edge, pointing at it.
        const inset = Math.min(HUD_SIZES.edgeInset * s, Math.min(w, h) * HUD_SIZES.edgeMaxShare);
        edgeMark(this.at.x, this.at.y, this.at.behind, w, h, inset, this.edge);
        const ax = this.edge.x;
        const ay = this.edge.y;
        const deg = this.edge.angle;
        const size = HUD_SIZES.edgeArrow * s;
        const back = size * ARROW.back;
        const wide = size * ARROW.half;
        const bx = pointX(ax, -back, deg);
        const by = pointY(ay, -back, deg);
        POLY[0] = pointX(ax, size * ARROW.tip, deg);
        POLY[1] = pointY(ay, size * ARROW.tip, deg);
        POLY[2] = pointX(bx, wide, deg + 90);
        POLY[3] = pointY(by, wide, deg + 90);
        POLY[4] = pointX(bx, wide, deg - 90);
        POLY[5] = pointY(by, wide, deg - 90);
        c.poly(POLY, 3, HUD_SIZES.bracketWidth * s, colour, MARK_ALPHA, true, true);
        c.line(bx, by, pointX(ax, -(back + HUD_SIZES.edgeTail * s), deg), pointY(ay, -(back + HUD_SIZES.edgeTail * s), deg), HUD_SIZES.bracketWidth * s, colour, MARK_ALPHA);
        o.ops += 2;
        o.arrows++;
        // Its label stands inboard of the arrow, as the target's block does on the flight display.
        const out = (HUD_SIZES.edgeLabel + HUD_SIZES.edgeArrow) * s;
        this.sx[k] = pointX(ax, -out, deg);
        this.sy[k] = pointY(ay, -out, deg);
        this.seen[k] = 2;
      }
    }
    // The labels: the tracked one's first, wherever it is, then the nearest in view. The source is
    // already nearest first, so the first ones seen are the nearest.
    let used = 0;
    if (tracked >= 0 && this.seen[tracked]) this.place(this.labels[used++], src.marks[tracked], this.sx[tracked], this.sy[tracked], this.far[tracked]);
    for (let k = 0; k < n && used < this.labels.length; k++) {
      if (k === tracked || this.seen[k] !== 1) continue;
      this.place(this.labels[used++], src.marks[k], this.sx[k], this.sy[k], this.far[k]);
    }
    for (let i = used; i < this.labels.length; i++) this.hide(this.labels[i]);
    o.labels = used;
  }

  /** A frame that draws nothing (a panel, the map, the death card): every label goes, once. */
  idle(): void {
    this.roll();
    this.out.drawn = 0;
    this.out.arrows = 0;
    this.out.ops = 0;
    this.hideLabels();
  }

  /** A travel, the select screen: every label goes and is written afresh when it comes back. */
  clear(): void {
    this.hideLabels();
    for (const l of this.labels) {
      l.id = '';
      l.step = -2;
    }
  }

  /** What was drawn and what it cost, for the console: a kept object, filled in place. */
  report(): { drawn: number; arrows: number; labels: number; ops: number; writes: number; shown: boolean; inFlight: boolean; attached: boolean } {
    this.roll();
    this.out.writes = this.lastWrites;
    return this.out;
  }

  /** The label words as they stand, for the console; built on demand, never in a frame. */
  labelTexts(): string[] {
    const out: string[] = [];
    for (const l of this.labels) if (l.on) out.push(`${l.id} ${l.root.textContent ?? ''}`);
    return out;
  }

  /** DOM writes in the last full second, which a steady frame keeps at nought. */
  get writesLastSecond(): number {
    this.roll();
    return this.lastWrites;
  }

  private place(l: Label, m: PlacedMark, x: number, y: number, metres: number): void {
    if (!l.on) {
      l.on = true;
      l.root.hidden = false;
      this.writes++;
    }
    const step = waypointStep(metres);
    if (step !== l.step || m.id !== l.id) {
      l.step = step;
      l.id = m.id;
      l.root.textContent = waypointWords(metres);
      this.writes++;
    }
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx !== l.x || ry !== l.y) {
      l.x = rx;
      l.y = ry;
      l.root.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, 0)`;
      this.writes++;
    }
  }

  private hide(l: Label): void {
    if (!l.on) return;
    l.on = false;
    l.root.hidden = true;
    l.x = Number.NaN;
    l.y = Number.NaN;
    this.writes++;
  }

  private hideLabels(): void {
    for (const l of this.labels) this.hide(l);
    this.out.labels = 0;
  }

  /** The write count's second over: one comparison, from the frame and from the console alike. */
  private roll(): void {
    const now = nowMs();
    if (now - this.windowStart < 1000) return;
    this.lastWrites = this.writes;
    this.writes = 0;
    this.windowStart = now;
  }
}
