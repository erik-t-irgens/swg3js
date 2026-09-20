// The overlay: one plain 2D canvas over the game, under every panel, for the parts of the interface
// that are shapes and move every frame — the reticle, the arcs, the target bracket, the edge arrow,
// the damage arc, the cooldown sweeps.
//
// It touches no WebGL context, no shader, no light and no material, so nothing compiles because of it
// and the effects chain, the light count and the portal renderer never see it.
//
// Three rules hold it to nothing per frame:
//
//   - **No text, ever.** Canvas text costs a shaping pass per call and gives up the browser's subpixel
//     rendering; every string on the screen is a DOM element. The whole API takes numbers.
//   - **No allocation.** Colours are indices into the palette's frozen table of ready strings and alpha
//     is `globalAlpha`, so no `rgba()` is built; a polygon is read out of an array the caller owns.
//   - **The clear is the union of what was drawn last frame**, not the screen.
//
// Every stroke is drawn twice: once in `void`, two pixels wider, then once in its own colour. That is
// what lets a cyan hairline read against a noon dune and against a starfield, and it is applied inside
// each call so a caller cannot forget it.
//
// Angles are degrees, clockwise from twelve o'clock, as everywhere else in the interface.
import { COL, COLOURS, colourOf, initPalette } from '../core/palette';

/**
 * The overlay's own invented numbers, all three of them, kept together and left mutable so they can be
 * tried live from a console knob rather than an edit and a reload. They take effect on the next frame
 * drawn; nothing caches them.
 *
 * The first two are the ones most likely to be asked for: if a hairline is lost against a noon dune
 * the answer is a higher `alpha` or a wider `widen`, and if the overlay turns out to be dear the
 * under-stroke is the first thing to give up (`alpha: 0`).
 */
export const OVERLAY_TUNE = {
  /** Invented: how much wider than the stroke the dark one under it sits, in CSS pixels at scale 1. */
  widen: 2,
  /** Invented: the under-stroke's alpha, times the caller's, so a faint band gets no halo. */
  alpha: 0.45,
  /** Invented: the slop in CSS pixels the union clear takes round its rectangle, for the round caps. */
  clearSlop: 1,
};

const DEG = Math.PI / 180;
/** Canvas angles run anticlockwise from three o'clock; ours run clockwise from twelve. */
const toCanvas = (deg: number) => (deg - 90) * DEG;

/** How many drawn frames the overlay's own milliseconds are averaged over. Invented. */
const MS_WINDOW = 60;

export interface HudCanvasStats {
  /** The overlay's own milliseconds, a moving average of the last 60 frames it drew (0 while off). */
  ms: number;
  /** Operations in the last frame, counting each under-stroke as one of its own. */
  ops: number;
  /** The rectangle the next frame will clear, in CSS pixels. */
  clearX: number;
  clearY: number;
  clearW: number;
  clearH: number;
  /** The backing store in use. */
  dpr: number;
  scale: number;
  enabled: boolean;
}

export class HudCanvas {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** CSS pixels. */
  w = 0;
  h = 0;
  private dpr = 1;
  private scale = 1;
  private enabled = true;
  private boxes = false;
  private drawing = false;
  /** What this frame has touched, in CSS pixels; empty while `dirty` is false. */
  private x0 = 0;
  private y0 = 0;
  private x1 = 0;
  private y1 = 0;
  private dirty = false;
  /** What the last frame touched, which is what the next clear takes out. */
  private lastX = 0;
  private lastY = 0;
  private lastW = 0;
  private lastH = 0;
  private ops = 0;
  private started = 0;
  /** A ring of the last `MS_WINDOW` drawn frames' milliseconds: a moving average, never a block one. */
  private readonly msRing = new Float64Array(MS_WINDOW);
  private msAt = 0;
  private msFilled = 0;
  private msSum = 0;
  private msAvg = 0;
  private readonly onResize = () => this.resize();

  readonly stats: HudCanvasStats = { ms: 0, ops: 0, clearX: 0, clearY: 0, clearW: 0, clearH: 0, dpr: 1, scale: 1, enabled: true };

  /**
   * `parent` is the interface layer (`#ui`). The canvas goes in as its first child so every panel
   * draws over it, and it never takes the pointer (the layer already gives that up).
   */
  constructor(parent: HTMLElement) {
    initPalette();
    this.el = document.createElement('canvas');
    this.el.id = 'hud-overlay';
    parent.insertBefore(this.el, parent.firstChild);
    // Not `desynchronized`: an overlay presented out of step with the WebGL canvas under it would
    // show the reticle a frame behind the ship it is drawn over.
    const ctx = this.el.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('the interface overlay could not take a 2D context');
    this.ctx = ctx;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.el.remove();
  }

  /** The canvas is sized on a resize and on a change of the backing store, never in a frame. */
  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = this.dpr;
    this.w = w;
    this.h = h;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    const reallocated = this.el.width !== bw || this.el.height !== bh;
    if (reallocated) {
      this.el.width = bw;
      this.el.height = bh;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    if (reallocated) {
      // A new backing store comes up empty, so what was on it is gone and nothing is owed a clear.
      this.lastW = 0;
      this.lastH = 0;
    } else {
      // A resize that did not change the store — a device-pixel-ratio change, a browser zoom step,
      // devtools docking — leaves the last frame's strokes on it. Forgetting them without clearing
      // would leave them there until something happened to draw over that patch.
      this.clearLast();
    }
    this.stats.dpr = dpr;
  }

  /**
   * One device pixel per CSS pixel by default. Two is sharper hairlines for four times the backing
   * store, which is the Interface page's "sharper HUD canvas". Anything else is taken as one.
   */
  setDpr(dpr: number): void {
    const next = dpr >= 2 ? 2 : 1;
    if (next === this.dpr) return;
    this.dpr = next;
    this.resize();
  }

  /** The HUD scale, which only widens the under-stroke here; every size comes from `hudMath`. */
  setScale(scale: number): void {
    this.scale = scale > 0 ? scale : 1;
    this.stats.scale = this.scale;
  }

  /** Off for a baseline (`__debug.hud({ overlay: false })`): the next call clears what is on it. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.stats.enabled = on;
    if (on) return;
    this.idle();
    // A baseline must read as a baseline: leaving the last drawn frame's figures standing would have
    // `__debug.hud({ overlay: false })` still reporting the operations the overlay is no longer making.
    this.ops = 0;
    this.stats.ops = 0;
    this.msAt = 0;
    this.msFilled = 0;
    this.msSum = 0;
    this.msAvg = 0;
    this.stats.ms = 0;
  }

  /** Outline the region the clear takes out, which is how to see whether the union is doing its job. */
  setBoxes(on: boolean): void {
    this.boxes = on;
  }

  /**
   * Start a frame: take out what the last one drew and begin a new union. Returns whether to draw at
   * all — false while the overlay is off, and the caller may then skip its own work as well.
   */
  begin(): boolean {
    if (!this.enabled) return false;
    this.started = performance.now();
    this.clearLast();
    this.ops = 0;
    this.dirty = false;
    this.drawing = true;
    return true;
  }

  /** Finish a frame: keep the union for the next clear and update the figures `__debug.hud` reads. */
  end(): void {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.boxes && this.dirty) {
      // Drawn last and taken into the union, so the outline itself is cleared with everything else.
      const x = this.x0;
      const y = this.y0;
      const w = this.x1 - this.x0;
      const h = this.y1 - this.y0;
      this.ctx.globalAlpha = 0.6;
      this.ctx.strokeStyle = colourOf(COL.warn);
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      this.ops++;
      this.mark(x - 2, y - 2, x + w + 2, y + h + 2);
    }
    if (this.dirty) {
      this.lastX = Math.max(0, Math.floor(this.x0));
      this.lastY = Math.max(0, Math.floor(this.y0));
      this.lastW = Math.min(this.w, Math.ceil(this.x1)) - this.lastX;
      this.lastH = Math.min(this.h, Math.ceil(this.y1)) - this.lastY;
    } else {
      this.lastW = 0;
      this.lastH = 0;
    }
    // A moving average over the ring, so the figure moves every frame instead of standing still for
    // sixty and then jumping. The ring is allocated once; nothing here allocates.
    const ms = performance.now() - this.started;
    this.msSum += ms - this.msRing[this.msAt];
    this.msRing[this.msAt] = ms;
    this.msAt = this.msAt + 1 >= MS_WINDOW ? 0 : this.msAt + 1;
    if (this.msFilled < MS_WINDOW) this.msFilled++;
    this.msAvg = this.msSum / this.msFilled;
    this.stats.ms = this.msAvg;
    this.stats.ops = this.ops;
    this.stats.clearX = this.lastX;
    this.stats.clearY = this.lastY;
    this.stats.clearW = Math.max(0, this.lastW);
    this.stats.clearH = Math.max(0, this.lastH);
  }

  /**
   * The game is not simulating — the loading screen, the death card, the character select, an open
   * panel, the mouse free. Nothing is drawn and what was on the canvas is taken off once; calling it
   * every frame after that costs a branch.
   */
  idle(): void {
    if (this.drawing) this.end();
    if (this.lastW <= 0 || this.lastH <= 0) return;
    this.clearLast();
    this.ops = 0;
    this.stats.ops = 0;
    this.stats.clearW = 0;
    this.stats.clearH = 0;
  }

  private clearLast(): void {
    if (this.lastW <= 0 || this.lastH <= 0) return;
    const slop = OVERLAY_TUNE.clearSlop;
    this.ctx.clearRect(this.lastX - slop, this.lastY - slop, this.lastW + slop * 2, this.lastH + slop * 2);
    this.lastW = 0;
    this.lastH = 0;
  }

  // --- the primitives ------------------------------------------------------------------------------
  // Each takes numbers only. `colour` is a `COL` index; `alpha` is 0 to 1.

  /** A straight stroke. */
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: number, alpha: number): void {
    if (!this.drawing || alpha <= 0) return;
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    this.stroke(width, colour, alpha);
    const pad = width / 2 + OVERLAY_TUNE.widen * this.scale + OVERLAY_TUNE.clearSlop;
    this.mark(Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad);
  }

  /**
   * An arc of a circle, from one angle to another. The span may run either way round; a span of zero
   * draws nothing, which is what an empty bar on a rail wants.
   */
  arc(cx: number, cy: number, r: number, from: number, to: number, width: number, colour: number, alpha: number): void {
    if (!this.drawing || alpha <= 0 || r <= 0 || from === to) return;
    const c = this.ctx;
    c.beginPath();
    c.arc(cx, cy, r, toCanvas(from), toCanvas(to), to < from);
    this.stroke(width, colour, alpha);
    this.markCircle(cx, cy, r, width);
  }

  /** A whole circle. */
  ring(cx: number, cy: number, r: number, width: number, colour: number, alpha: number): void {
    if (!this.drawing || alpha <= 0 || r <= 0) return;
    const c = this.ctx;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    this.stroke(width, colour, alpha);
    this.markCircle(cx, cy, r, width);
  }

  /**
   * A polygon from a flat array of x, y pairs the caller owns (never a new one): `n` points from the
   * start of `pts`. `fill` fills it in its colour over a slightly wider dark outline; otherwise it is
   * stroked like everything else. `close` joins the last point back to the first.
   */
  poly(pts: ArrayLike<number>, n: number, width: number, colour: number, alpha: number, close = true, fill = false): void {
    if (!this.drawing || alpha <= 0 || n < 2) return;
    const c = this.ctx;
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    let minX = pts[0];
    let maxX = pts[0];
    let minY = pts[1];
    let maxY = pts[1];
    for (let i = 1; i < n; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      c.lineTo(x, y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (close) c.closePath();
    const wide = width + OVERLAY_TUNE.widen * 2 * this.scale;
    if (fill) {
      c.globalAlpha = alpha * OVERLAY_TUNE.alpha;
      c.strokeStyle = COLOURS[COL.void];
      c.lineWidth = wide;
      c.stroke();
      c.globalAlpha = alpha;
      c.fillStyle = colourOf(colour);
      c.fill();
      this.ops += 2;
    } else {
      this.stroke(width, colour, alpha);
    }
    const pad = wide / 2 + OVERLAY_TUNE.clearSlop;
    this.mark(minX - pad, minY - pad, maxX + pad, maxY + pad);
  }

  /**
   * A filled wedge from the centre — the ability cells' cooldown sweep, which is a `void` pie over a
   * cell whose place is known. It takes no under-stroke: it is the dark itself.
   */
  wedge(cx: number, cy: number, r: number, from: number, to: number, colour: number, alpha: number): void {
    if (!this.drawing || alpha <= 0 || r <= 0 || from === to) return;
    const c = this.ctx;
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, r, toCanvas(from), toCanvas(to), to < from);
    c.closePath();
    c.globalAlpha = alpha;
    c.fillStyle = colourOf(colour);
    c.fill();
    this.ops++;
    this.markCircle(cx, cy, r, 2);
  }

  /** The two strokes of rule 2, on whatever path is current. */
  private stroke(width: number, colour: number, alpha: number): void {
    const c = this.ctx;
    c.globalAlpha = alpha * OVERLAY_TUNE.alpha;
    c.strokeStyle = COLOURS[COL.void];
    c.lineWidth = width + OVERLAY_TUNE.widen * 2 * this.scale;
    c.stroke();
    c.globalAlpha = alpha;
    c.strokeStyle = colourOf(colour);
    c.lineWidth = width;
    c.stroke();
    this.ops += 2;
  }

  private markCircle(cx: number, cy: number, r: number, width: number): void {
    const pad = r + width / 2 + OVERLAY_TUNE.widen * this.scale + OVERLAY_TUNE.clearSlop;
    this.mark(cx - pad, cy - pad, cx + pad, cy + pad);
  }

  private mark(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.dirty) {
      this.dirty = true;
      this.x0 = x0;
      this.y0 = y0;
      this.x1 = x1;
      this.y1 = y1;
      return;
    }
    if (x0 < this.x0) this.x0 = x0;
    if (y0 < this.y0) this.y0 = y0;
    if (x1 > this.x1) this.x1 = x1;
    if (y1 > this.y1) this.y1 = y1;
  }
}
