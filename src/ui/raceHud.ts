// A race run on the screen: the race block (the countdown, the lap, the time at tenths, a split against the best lap's
// at that gate, the last lap and the best), a page element written only when what it says changes; and the gates on
// the overlay -- in a run the next gate and the one after as their windows' outlines, the flight display's edge arrow
// when the next is out of sight; while a track is laid or edited on the dev server every gate of it, gate 0 apart in
// its own colour. No model and nothing compiled: the gates are shapes, projected through the camera's own two
// matrices as the waypoints' marks are (`waypointHud.ts`).
//
// The block's words are worked out by the game (`App.raceBlockView`) and handed over as strings, a few times a second
// at most and only when they change; the overlay's numbers are kept rows of corners the game fills when a track or a
// run changes, never in a frame. Nothing here allocates in a frame.

import { COL } from '../core/palette.ts';
import { HUD_SIZES, edgeMark, makeEdgeMark, pointX, pointY } from './hudMath.ts';
import { makeProjected, projectPoint, type PlateCamera } from './nameplate.ts';

/** What this file draws on the overlay: the part of `HudCanvas` it needs, declared structurally. */
export interface RaceCanvas {
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: number, alpha: number): void;
  poly(pts: ArrayLike<number>, n: number, width: number, colour: number, alpha: number, close?: boolean, fill?: boolean): void;
}

/** The race block's words, as the game hands them over. An empty field is not shown. */
export interface RaceBlockView {
  title: string;
  /** The countdown's number or word, '' once the run is under way. */
  countdown: string;
  lap: string;
  time: string;
  split: string;
  /** How the split reads against the best: 'good' faster, 'bad' slower, '' neither. */
  splitTone: '' | 'good' | 'bad';
  last: string;
  best: string;
  note: string;
  /** A group race's standings, a line a racer (`src/race/raceGroup.ts`'s `standingLines`), '' outside one. */
  standings: string;
}

/** The gates' shapes: the next and the one after in a run, every gate while editing. Ours. */
const RACE_HUD_TUNE = {
  /** The outline's width (scaled with the display) and alpha. */
  width: 2,
  alpha: 0.9,
  /** The one after the next, fainter. */
  afterAlpha: 0.45,
  /** While editing, every gate but 0, fainter still. */
  editAlpha: 0.6,
};

const ARROW = { tip: 0.6, back: 0.4, half: 0.5 };
const POLY = new Float32Array(16);

// Every colour is one of the palette's eighteen names: `hudPage.test.ts` reads this string and holds it to that rule.
const RACE_HUD_CSS = `
.hud-race {
  position: absolute;
  top: calc(56px * var(--hud-scale, 1));
  left: 50%;
  transform: translateX(-50%);
  min-width: calc(200px * var(--hud-scale, 1));
  padding: calc(6px * var(--hud-scale, 1)) calc(12px * var(--hud-scale, 1));
  background: color-mix(in srgb, var(--plate) 70%, transparent);
  border: 1px solid var(--edge);
  border-radius: 6px;
  color: var(--ink);
  font: 600 calc(13px * var(--hud-scale, 1))/1.35 system-ui, sans-serif;
  text-align: center;
  pointer-events: none;
}
.hud-race[hidden] { display: none; }
.hud-race .rc-title { color: var(--muted); font-size: 0.85em; letter-spacing: 0.06em; }
.hud-race .rc-count { color: var(--accent); font-size: 2.6em; line-height: 1.1; }
.hud-race .rc-time { font: 600 1.6em/1.2 ui-monospace, Menlo, Consolas, monospace; color: var(--ink); }
.hud-race .rc-lap { color: var(--accent); }
.hud-race .rc-split { font-family: ui-monospace, Menlo, Consolas, monospace; }
.hud-race .rc-split.good { color: var(--good); }
.hud-race .rc-split.bad { color: var(--bad); }
.hud-race .rc-row { color: var(--muted); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
.hud-race .rc-note { color: var(--warn); }
.hud-race .rc-board { color: var(--ink); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.85em; white-space: pre-line; text-align: left; border-top: 1px solid var(--rule); margin-top: 3px; padding-top: 3px; }
`;

interface Field {
  el: HTMLElement;
  text: string;
}

/** The clock the write count's second is measured on, wherever this file is run. */
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export class RaceHud {
  readonly root: HTMLElement;
  private readonly fields: Record<'title' | 'countdown' | 'lap' | 'time' | 'split' | 'last' | 'best' | 'note' | 'standings', Field>;
  private splitTone = '';
  private shown = false;
  private on = true;
  private canvas: RaceCanvas | null = null;
  private scale = 1;
  private readonly at = makeProjected();
  private readonly edge = makeEdgeMark();
  /** DOM writes this second and the last full second. */
  private writes = 0;
  private lastWrites = 0;
  private windowStart = nowMs();
  /** What `report` hands back: one object, filled in place. */
  private readonly out = { gates: 0, arrows: 0, writes: 0, shown: false, on: true };

  constructor(parent: HTMLElement) {
    if (typeof document !== 'undefined' && !document.getElementById('race-hud-style')) {
      const style = document.createElement('style');
      style.id = 'race-hud-style';
      style.textContent = RACE_HUD_CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'hud-race';
    this.root.hidden = true;
    parent.appendChild(this.root);
    const make = (cls: string): Field => {
      const el = document.createElement('div');
      el.className = cls;
      el.hidden = true;
      this.root.appendChild(el);
      return { el, text: '' };
    };
    this.fields = { title: make('rc-title'), countdown: make('rc-count'), lap: make('rc-lap'), time: make('rc-time'), split: make('rc-split'), last: make('rc-row'), best: make('rc-row'), note: make('rc-note'), standings: make('rc-board') };
  }

  /** The overlay to draw the gates on. Until this, none is drawn. */
  attach(canvas: RaceCanvas): void {
    this.canvas = canvas;
  }

  setScale(scale: number): void {
    this.scale = scale > 0 ? scale : 1;
  }

  /** The Interface page's switch for the block and the gates. */
  setShown(on: boolean): void {
    this.on = on;
    this.out.on = on;
    if (!on) this.hideBlock();
  }

  /** The block written with what it says now: each field only when its words changed. */
  block(v: RaceBlockView): void {
    this.roll();
    if (!this.on) return;
    if (!this.shown) {
      this.shown = true;
      this.root.hidden = false;
      this.writes++;
      this.out.shown = true;
    }
    this.field('title', v.title);
    this.field('countdown', v.countdown);
    this.field('lap', v.lap);
    this.field('time', v.time);
    this.field('split', v.split);
    if (v.splitTone !== this.splitTone) {
      this.splitTone = v.splitTone;
      this.fields.split.el.className = `rc-split${v.splitTone ? ` ${v.splitTone}` : ''}`;
      this.writes++;
    }
    this.field('last', v.last);
    this.field('best', v.best);
    this.field('note', v.note);
    this.field('standings', v.standings);
  }

  private field(k: keyof RaceHud['fields'], text: string): void {
    const f = this.fields[k];
    if (f.text === text) return;
    f.text = text;
    f.el.textContent = text;
    f.el.hidden = !text;
    this.writes++;
  }

  /** No run and nothing laid: the block goes, once. */
  hideBlock(): void {
    this.roll();
    if (!this.shown) return;
    this.shown = false;
    this.root.hidden = true;
    this.out.shown = false;
    this.writes++;
  }

  /**
   * The gates on the overlay, one frame: `corners` holds twelve numbers a gate (four corners, from `gateCorners`), `n`
   * of them. In a run (`edit` false) the gate `next` is drawn and the one `after` it fainter (-1 for none), and the
   * next one's edge arrow when it is out of sight; editing, every gate, gate 0 in its own colour. Allocates nothing.
   */
  drawGates(corners: Float64Array, n: number, next: number, after: number, edit: boolean, camera: PlateCamera, w: number, h: number): void {
    const c = this.canvas;
    const o = this.out;
    o.gates = 0;
    o.arrows = 0;
    if (!c || !this.on || n <= 0) return;
    const s = this.scale;
    const width = RACE_HUD_TUNE.width * s;
    if (edit) {
      for (let i = 0; i < n; i++) this.gate(c, corners, i, i === 0 ? COL.good : COL.accent, i === 0 ? RACE_HUD_TUNE.alpha : RACE_HUD_TUNE.editAlpha, width, camera, w, h);
      return;
    }
    if (after >= 0 && after < n && after !== next) this.gate(c, corners, after, COL.muted, RACE_HUD_TUNE.afterAlpha, width, camera, w, h);
    if (next >= 0 && next < n && !this.gate(c, corners, next, COL.accent, RACE_HUD_TUNE.alpha, width, camera, w, h)) this.arrow(c, corners, next, camera, w, h);
  }

  /** One gate's window outlined, when all four corners stand in front of the camera; whether it was drawn on the screen. */
  private gate(c: RaceCanvas, corners: Float64Array, i: number, colour: number, alpha: number, width: number, camera: PlateCamera, w: number, h: number): boolean {
    const b = i * 12;
    let inside = 0;
    for (let k = 0; k < 4; k++) {
      projectPoint(corners[b + k * 3], corners[b + k * 3 + 1], corners[b + k * 3 + 2], camera, w, h, this.at);
      if (this.at.behind) return false;
      POLY[k * 2] = this.at.x;
      POLY[k * 2 + 1] = this.at.y;
      if (this.at.x >= 0 && this.at.x <= w && this.at.y >= 0 && this.at.y <= h) inside++;
    }
    c.poly(POLY, 4, width, colour, alpha, true, false);
    this.out.gates++;
    // Drawn but wholly off the screen still wants the arrow (a gate behind a turn).
    return inside > 0 || this.spans(w, h);
  }

  /** Whether the outline just projected straddles the screen with no corner on it (a gate filling the view up close). */
  private spans(w: number, h: number): boolean {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < 4; k++) {
      const x = POLY[k * 2];
      const y = POLY[k * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return minX < w && maxX > 0 && minY < h && maxY > 0;
  }

  /** The flight display's own edge arrow at the screen's edge, pointing at the gate's middle. */
  private arrow(c: RaceCanvas, corners: Float64Array, i: number, camera: PlateCamera, w: number, h: number): void {
    const b = i * 12;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 0; k < 4; k++) {
      x += corners[b + k * 3] / 4;
      y += corners[b + k * 3 + 1] / 4;
      z += corners[b + k * 3 + 2] / 4;
    }
    projectPoint(x, y, z, camera, w, h, this.at);
    const s = this.scale;
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
    c.poly(POLY, 3, HUD_SIZES.bracketWidth * s, COL.accent, RACE_HUD_TUNE.alpha, true, true);
    this.out.arrows++;
  }

  /** What was drawn and written, for the console: a kept object, filled in place. */
  report(): { gates: number; arrows: number; writes: number; shown: boolean; on: boolean } {
    this.roll();
    this.out.writes = this.lastWrites;
    return this.out;
  }

  /** DOM writes in the last full second, which a steady frame keeps at nought (a run's clock writes ten a second). */
  get writesLastSecond(): number {
    this.roll();
    return this.lastWrites;
  }

  /** The block's words as they stand, for the console. */
  texts(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, f] of Object.entries(this.fields)) if (f.text) out[k] = f.text;
    return out;
  }

  private roll(): void {
    const now = nowMs();
    if (now - this.windowStart < 1000) return;
    this.lastWrites = this.writes;
    this.writes = 0;
    this.windowStart = now;
  }
}
