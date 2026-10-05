// The minimap: the planet's own map picture in a circle at the top left, centred on you, with your arrow,
// every waypoint that is switched on as a point in its own colour and a mark for north on its rim; the
// world's name over the top of the circle and your coordinates over its foot; and under it the name of a
// city as you walk into one.
//
// It is a small 2D canvas of its own, the first child of the display's top-left block, and while it shows
// it stands in for that block's own name and `/loc` lines, which the stylesheet hides. Not the overlay:
// the overlay is the first child of the interface layer and every panel paints over it, the top-left one
// included; and not WebGL: nothing here may compile anything. The picture is the map window's
// (`mapImages.ts`), decoded once per pack and shared, which the rules allow: it is the client's map of
// the world, not its interface art. At the default reach it is blurry -- the pictures are sixteen metres
// to the pixel -- and that is what the picture is.
//
// The name and the coordinates are words, so they are the page's and never the canvas's: two elements
// after the canvas in one box (`.hud-minimap-face`), placed over it by the stylesheet with no `z-index`,
// which paint over it because they come later in the tree. The coordinates are the map window's own pair
// (the snapshot's frame, which is the frame the minimap is handed), rounded, and are written only when
// that rounded pair has changed and at most `locHz` times a second.
//
// It is drawn only when something it shows has changed: you have moved `movePx` of a pixel across it or
// turned `turnDeg`, the waypoints have changed, the reach or which way is up has changed, or the picture
// has arrived. A still player costs it nothing at all, neither a drawing nor a write, and
// `__debug.minimap().redraws` and `writes` are how that is checked. North is up unless the setting turns
// it with you, in which case your arrow is what is up and the mark for north goes round the rim.
//
// It stands aside in space, in the dungeon copies and on any world whose pack has no picture; indoors it
// keeps the planet's picture, which is still where you are. The city name is part of it and goes with it.
// In a conversation it goes with the rest of the display (`#ui.talking` hides everything but the talk),
// which is meant: the talk has the screen.
//
// The frame's arithmetic is pure and at the top, so the node test checks it without a page.

import { COL, colourOf, type PaletteName } from '../core/palette.ts';
import { CITY_TUNE } from '../story/cities.ts';
import { HUD_SIZES, angleOf } from './hudMath.ts';
import { mapShareX, mapShareY, type MapFrame, type WaypointList } from './spaceMapLayers.ts';

/**
 * The minimap's numbers. Every one is ours, and every one is live through `__debug.minimap({ tune })`.
 * Its size is not here -- it is `HUD_SIZES.minimap`, which the stylesheet states again -- nor its reach,
 * which is the player's own setting (`hudMinimapRange`).
 */
export const MINIMAP_TUNE = {
  /** A waypoint's point, and the tracked one's, as a radius in pixels at scale 1. */
  dotPx: 2.5,
  trackedDotPx: 3.5,
  /** Your arrow, from its middle to its tip, in pixels at scale 1. */
  arrowPx: 7,
  /** How far across the picture you must move, in its own pixels, before it is drawn again. */
  movePx: 0.5,
  /** How far you must turn, in degrees, before it is drawn again. */
  turnDeg: 1,
  /** The picture's edge stands this far inside the canvas, and an out-of-reach waypoint is clamped to it. */
  rimInsetPx: 3,
  /**
   * The coordinates over the foot of the circle are written at most this many times a second, and only
   * when the rounded pair has moved: a walk changes it nearly every frame, and a line that cannot be read
   * that fast is not worth the writes. `/loc` in the corner has always gone at four.
   */
  locHz: 4,
  /** The mark for north: from its tip on the rim to its base, and half its base across, in pixels at scale 1. */
  northPx: 6,
  northHalfPx: 4,
};

/** The coordinates' rate is never let under this, so a rate tried at nought cannot stop them for good. */
const LOC_HZ_FLOOR = 0.5;

/** Move any of those, each held to something that makes sense; the answer is the table as it stands. */
export function tuneMinimap(o: Partial<typeof MINIMAP_TUNE>): typeof MINIMAP_TUNE {
  const t = MINIMAP_TUNE as Record<string, number>;
  for (const k of Object.keys(MINIMAP_TUNE) as (keyof typeof MINIMAP_TUNE)[]) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) t[k] = Math.max(k === 'locHz' ? LOC_HZ_FLOOR : 0, v);
  }
  return MINIMAP_TUNE;
}

// ---- the arithmetic -----------------------------------------------------------------------------------

/** Screen pixels to a metre of ground: the circle's radius, less the rim, over the reach. */
export function minimapScale(sizePx: number, range: number, inset: number): number {
  return Math.max(0, sizePx / 2 - inset) / Math.max(1, range);
}

/**
 * Which way you face on a north-up minimap, in the interface's angles (degrees clockwise from twelve).
 * The game's forward is `(sin h, cos h)` in x and z, and the map's frame mirrors x and runs z up the
 * screen, so on the screen it is `(-sin h, -cos h)`: the same turn the map window's own arrow takes.
 */
export function facingAngle(heading: number): number {
  return angleOf(-Math.sin(heading), -Math.cos(heading));
}

/** How far the whole picture is turned, clockwise, in degrees: none with north up, else so you face up. */
export function minimapTurn(heading: number, northUp: boolean): number {
  return northUp ? 0 : -facingAngle(heading);
}

/** Where a point lands on the minimap, from its middle, and whether it had to be pulled in to the rim. */
export interface MinimapPoint {
  x: number;
  y: number;
  clamped: boolean;
}

export function makeMinimapPoint(): MinimapPoint {
  return { x: 0, y: 0, clamped: false };
}

/**
 * A point of the map's own frame onto the minimap: `dx, dz` from you in metres (map x right, map z up),
 * `k` pixels a metre, the picture turned `turn` degrees clockwise, and pulled in to `rim` pixels from the
 * middle when it is further out. Allocates nothing.
 */
export function minimapPoint(dx: number, dz: number, k: number, turn: number, rim: number, out: MinimapPoint): MinimapPoint {
  let x = dx * k;
  let y = -dz * k;
  if (turn !== 0) {
    const a = (turn * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const rx = x * c - y * s;
    const ry = x * s + y * c;
    x = rx;
    y = ry;
  }
  const d = Math.hypot(x, y);
  out.clamped = d > rim;
  if (out.clamped && d > 0) {
    x = (x / d) * rim;
    y = (y / d) * rim;
  }
  out.x = x;
  out.y = y;
  return out;
}

/**
 * Whether the minimap wants drawing again, against what it was last drawn with. A plain record of the
 * last drawing and one question, so the test can walk a player about and count the answers.
 */
export class MinimapClock {
  x = Number.NaN;
  z = Number.NaN;
  facing = Number.NaN;
  version = -1;
  k = Number.NaN;
  northUp = true;
  size = Number.NaN;

  /** Whether a drawing at this place, facing, waypoint version, scale and orientation would differ. */
  wants(x: number, z: number, facing: number, version: number, k: number, northUp: boolean, size: number): boolean {
    if (version !== this.version || k !== this.k || northUp !== this.northUp || size !== this.size) return true;
    if (!(Math.hypot(x - this.x, z - this.z) * k < MINIMAP_TUNE.movePx)) return true;
    let turn = Math.abs(facing - this.facing) % 360;
    if (turn > 180) turn = 360 - turn;
    return !(turn < MINIMAP_TUNE.turnDeg);
  }

  /** It was drawn with these. */
  took(x: number, z: number, facing: number, version: number, k: number, northUp: boolean, size: number): void {
    this.x = x;
    this.z = z;
    this.facing = facing;
    this.version = version;
    this.k = k;
    this.northUp = northUp;
    this.size = size;
  }

  /** Forget the last drawing, so the next asks for one. */
  reset(): void {
    this.version = -1;
  }
}

/**
 * The city label's fade, as a stylesheet: in over `fadeIn`, held for `hold`, out over `fadeOut`, as one
 * animation the browser runs on its own. It is two animations under two names that do the same thing,
 * so a new city starts its own from the top by swapping the class -- one write -- rather than taking
 * one off and putting it back. Written when the minimap is made and when the tune moves, never in a
 * frame; it carries no colour.
 */
export function cityFadeSheet(): string {
  const total = Math.max(0.01, CITY_TUNE.fadeIn + CITY_TUNE.hold + CITY_TUNE.fadeOut);
  const inAt = ((CITY_TUNE.fadeIn / total) * 100).toFixed(2);
  const outAt = (((CITY_TUNE.fadeIn + CITY_TUNE.hold) / total) * 100).toFixed(2);
  const frames = (name: string) => `@keyframes ${name} { 0% { opacity: 0; } ${inAt}% { opacity: 1; } ${outAt}% { opacity: 1; } 100% { opacity: 0; } }`;
  return `${frames('hud-city-a')}\n${frames('hud-city-b')}\n.hud-city.a { animation: hud-city-a ${total.toFixed(2)}s linear both; }\n.hud-city.b { animation: hud-city-b ${total.toFixed(2)}s linear both; }`;
}

// ---- the minimap ----------------------------------------------------------------------------------------

/** A waypoint's palette name to the index the canvas draws with. */
function colourIndex(name: string): number {
  return COL[name as PaletteName] ?? COL.accent;
}

/** What the minimap is handed each frame: where you are, and what world. */
export interface MinimapView {
  /** Whether it may show at all: the setting, and a world that is not space or a dungeon copy. */
  wanted: boolean;
  /** The pack whose picture it shows. */
  pack: string;
  /** You, in the map's own frame (the snapshot's), and which way you face (the game's heading, radians). */
  x: number;
  z: number;
  heading: number;
  /** Metres from the middle to the rim, and whether north is up. */
  range: number;
  northUp: boolean;
  /** Seconds on a clock that only goes forward, which the coordinates' rate is kept on. */
  now: number;
}

/** A picture as `mapImages.ts` keeps it. */
export interface MinimapPicture {
  image: CanvasImageSource & { width: number; height: number };
  frame: MapFrame;
}

export class Minimap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  /** The world's name over the top of the circle, and the coordinates over its foot: page text, not canvas text. */
  private readonly nameEl: HTMLElement;
  private readonly locEl: HTMLElement;
  private readonly city: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly sheet: HTMLStyleElement | null;
  private readonly picture: (pack: string) => MinimapPicture | null | undefined;
  private shown = false;
  private scale = 1;
  /** The canvas's size in CSS pixels and in its own, as last set. */
  private size = HUD_SIZES.minimap;
  private dpr = 1;
  private readonly clock = new MinimapClock();
  private readonly pt = makeMinimapPoint();
  /** The waypoints it draws, in the map's own frame, as the book had them when it was last told (`setWaypoints`). */
  private waypoints: WaypointList | null = null;
  private version = 0;
  /** The picture it last drew with, so its arrival is a change. */
  private drawnWith: MinimapPicture | null = null;
  /** The city label's class as last written: a new name swaps it, which starts its fade from the top. */
  private cityClass: 'a' | 'b' = 'b';
  /** Whether the label wears a fade (and a name) just now, or is back to its plain, unseen self. */
  private cityOn = false;
  /** The world's name as last written, which the console reads too. */
  nameShown = '';
  /**
   * The coordinates as last written, rounded (NaN: nothing yet), and when, in the view's seconds. They
   * are compared as numbers, so a frame whose rounded pair has not moved builds no string at all.
   */
  private locX = Number.NaN;
  private locZ = Number.NaN;
  private locAt = Number.NEGATIVE_INFINITY;
  /** Counts, for the console: redraws since it was made, and DOM writes this second and the last. */
  redraws = 0;
  dots = 0;
  private writes = 0;
  private lastWrites = 0;
  /** The coordinates' own writes, this second and the last: a share of `writes`, counted apart for the console. */
  private locWrites = 0;
  private lastLocWrites = 0;
  private windowStart = Date.now();
  cityShown = '';
  /** The coordinates as they stand over the foot of the circle, for the console. */
  locShown = '';

  /**
   * `panel` is the display's top-left block, which the minimap goes into first; `hud` is the display's
   * root, which wears `minimap-on` while it shows, so the block's own name and `/loc` lines stand aside
   * for the ones over the circle and the help block below can move out of its way.
   */
  constructor(panel: HTMLElement, hud: HTMLElement, picture: (pack: string) => MinimapPicture | null | undefined) {
    this.hud = hud;
    this.picture = picture;
    this.root = document.createElement('div');
    this.root.className = 'hud-minimap-wrap';
    this.root.hidden = true;
    // The circle's face: the canvas, then the two lines laid over it. They come after it in the tree and
    // carry no z-index, so they paint over it; the canvas never draws a word.
    const face = document.createElement('div');
    face.className = 'hud-minimap-face';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-minimap';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'hud-mm-name';
    this.locEl = document.createElement('div');
    this.locEl.className = 'hud-mm-loc';
    face.appendChild(this.canvas);
    face.appendChild(this.nameEl);
    face.appendChild(this.locEl);
    this.city = document.createElement('div');
    this.city.className = 'hud-city';
    this.root.appendChild(face);
    this.root.appendChild(this.city);
    panel.insertBefore(this.root, panel.firstChild);
    this.ctx = this.canvas.getContext('2d');
    this.sheet = typeof document.head?.appendChild === 'function' ? document.createElement('style') : null;
    if (this.sheet) {
      this.sheet.textContent = cityFadeSheet();
      document.head.appendChild(this.sheet);
    }
    this.sizeCanvas();
  }

  /** The display scale: the canvas is sized again, on a change of scale and never in a frame. */
  setScale(scale: number): void {
    const s = scale > 0 ? scale : 1;
    if (s === this.scale) return;
    this.scale = s;
    this.sizeCanvas();
  }

  /** The city fade's timings moved: the sheet is written again. */
  retune(): void {
    if (this.sheet) this.sheet.textContent = cityFadeSheet();
    this.clock.reset();
  }

  /** The waypoints changed: it is drawn again with these. The list is the caller's, filled in place. */
  setWaypoints(list: WaypointList): void {
    this.waypoints = list;
    this.version++;
  }

  /** Forget the last drawing, so the next frame draws it (a new world, a tune moved). */
  redraw(): void {
    this.clock.reset();
  }

  /**
   * The world's name over the top of the circle, told wherever the corner's own name is told (a world
   * arrived in, a jump carried across). One write, and none for the name already there.
   */
  setName(name: string): void {
    if (name === this.nameShown) return;
    this.nameShown = name;
    this.nameEl.textContent = name;
    this.writes++;
  }

  /** A city walked into: its name under the circle, in and held and out. Two writes, and nothing after. */
  showCity(name: string): void {
    this.cityShown = name;
    this.cityOn = true;
    this.city.textContent = name;
    this.cityClass = this.cityClass === 'a' ? 'b' : 'a';
    this.city.className = `hud-city ${this.cityClass}`;
    this.writes += 2;
  }

  /**
   * The label back to its plain, unseen self, name and fade both gone. A finished fade cannot be left on
   * it: an element whose box is taken away (`display: none`, which is how the minimap stands aside) runs
   * its animations again from the top when it is shown, so the last city's name would fade in under the
   * next world's map. Two writes when there was something to take off, none when there was not; never in
   * a steady frame.
   */
  clearCity(): void {
    this.cityShown = '';
    if (!this.cityOn) return;
    this.cityOn = false;
    this.city.className = 'hud-city';
    this.city.textContent = '';
    this.writes += 2;
  }

  /**
   * Taken down outright, for the way out to the select screen, where no frame runs to do it: hidden, the
   * help block given its place back, the city's name gone, and the next showing drawn afresh.
   */
  standDown(): void {
    if (this.shown) {
      this.shown = false;
      this.root.hidden = true;
      this.hud.classList.toggle('minimap-on', false);
      this.writes += 2;
    }
    this.clearCity();
    this.drawnWith = null;
    this.clock.reset();
  }

  /** DOM writes in the last full second. A still minimap writes none. */
  get writesLastSecond(): number {
    this.roll();
    return this.lastWrites;
  }

  /** The coordinates' own writes in the last full second: none standing still, at most `locHz` walking. */
  get locWritesLastSecond(): number {
    this.roll();
    return this.lastLocWrites;
  }

  /** Whether it is showing now. */
  get showing(): boolean {
    return this.shown;
  }

  /**
   * Once a frame. Comes up or stands aside as the world and the setting say, and draws only when what it
   * shows has changed. Allocates nothing on a frame that draws nothing.
   */
  update(v: MinimapView): void {
    this.roll();
    const pic = v.wanted ? this.picture(v.pack) : null;
    const show = !!pic && !!this.ctx;
    if (show !== this.shown) {
      this.shown = show;
      this.root.hidden = !show;
      this.hud.classList.toggle('minimap-on', show);
      this.writes += 2;
      if (show) this.clock.reset();
      // Standing aside, the city's name goes with it (`clearCity` says why it cannot merely be hidden).
      else this.clearCity();
    }
    if (!show || !pic) return;
    this.writeLoc(v);
    const inset = MINIMAP_TUNE.rimInsetPx * this.scale;
    const k = minimapScale(this.size, v.range, inset);
    const facing = facingAngle(v.heading);
    if (pic !== this.drawnWith) this.clock.reset();
    if (!this.clock.wants(v.x, v.z, facing, this.version, k, v.northUp, this.size)) return;
    this.clock.took(v.x, v.z, facing, this.version, k, v.northUp, this.size);
    this.drawnWith = pic;
    this.draw(pic, v, k, facing, inset);
  }

  /**
   * The coordinates over the foot of the circle: the map's own pair, rounded, written when that pair has
   * moved and no sooner than `1 / locHz` seconds after the last write. A pair that moved too soon is not
   * lost: the first frame after the wait writes whatever the pair is by then, still or not, so the last
   * words written are always where you stopped.
   */
  private writeLoc(v: MinimapView): void {
    const x = Math.round(v.x);
    const z = Math.round(v.z);
    if (x === this.locX && z === this.locZ) return;
    if (v.now - this.locAt < 1 / Math.max(LOC_HZ_FLOOR, MINIMAP_TUNE.locHz)) return;
    this.locX = x;
    this.locZ = z;
    this.locAt = v.now;
    // `Math.round` of a small negative is negative nought, which a template writes as plain "0".
    this.locShown = `${x}, ${z}`;
    this.locEl.textContent = this.locShown;
    this.writes++;
    this.locWrites++;
  }

  private draw(pic: MinimapPicture, v: MinimapView, k: number, facing: number, inset: number): void {
    const c = this.ctx!;
    const size = this.size;
    const half = size / 2;
    const rim = half - inset;
    const turn = minimapTurn(v.heading, v.northUp);
    this.redraws++;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, size, size);
    c.save();
    c.beginPath();
    c.arc(half, half, rim, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = colourOf(COL.void);
    c.fillRect(0, 0, size, size);
    // The picture, about you: a pixel of it is `frame.width / image.width` metres, and you stand at its
    // share across and down (`mapShareX/Y`), so the whole of it is drawn moved and scaled and the circle
    // clips it. Turned about the middle when the setting turns it with you.
    const f = pic.frame;
    const iw = pic.image.width;
    const ih = pic.image.height;
    const pxPerImage = (k * f.width) / iw;
    const ux = mapShareX(f, v.x) * iw;
    const uy = mapShareY(f, v.z) * ih;
    c.translate(half, half);
    if (turn !== 0) c.rotate((turn * Math.PI) / 180);
    c.imageSmoothingEnabled = true;
    // Only the patch of the picture the circle can show, a corner's worth wider so a turned one never
    // shows an edge: drawing the whole of a 1024 picture to keep a 168 px circle is work for nothing.
    const reach = (rim * Math.SQRT2) / Math.max(1e-6, pxPerImage);
    const sx = Math.max(0, ux - reach);
    const sy = Math.max(0, uy - reach);
    const sw = Math.min(iw, ux + reach) - sx;
    const sh = Math.min(ih, uy + reach) - sy;
    if (sw > 0 && sh > 0) c.drawImage(pic.image, sx, sy, sw, sh, (sx - ux) * pxPerImage, (sy - uy) * pxPerImage, sw * pxPerImage, sh * pxPerImage);
    c.restore();
    // The rim.
    c.beginPath();
    c.arc(half, half, rim, 0, Math.PI * 2);
    c.lineWidth = 1.5 * this.scale;
    c.strokeStyle = colourOf(COL.edge);
    c.stroke();
    // The waypoints switched on, each in its own colour over the dark, clamped to the rim when further
    // than the reach; the tracked one larger.
    this.dots = 0;
    const list = this.waypoints;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const m = list.items[i];
        // The list is in the map's own frame, as the waypoints are kept, so a point's offset from you is
        // a plain difference.
        minimapPoint(m.x - v.x, m.z - v.z, k, turn, rim - 1, this.pt);
        const r = (m.tracked ? MINIMAP_TUNE.trackedDotPx : MINIMAP_TUNE.dotPx) * this.scale;
        c.beginPath();
        c.arc(half + this.pt.x, half + this.pt.y, r + 1, 0, Math.PI * 2);
        c.fillStyle = colourOf(COL.void);
        c.fill();
        c.beginPath();
        c.arc(half + this.pt.x, half + this.pt.y, r, 0, Math.PI * 2);
        c.fillStyle = colourOf(colourIndex(m.colour));
        c.fill();
        this.dots++;
      }
    }
    // North: a small triangle in `accent` over a `void` halo, its tip on the rim where north is -- the top,
    // or wherever the turned picture has carried it, which is the picture's own turn. It is drawn before
    // your arrow, so the arrow is always over it and is the last thing turned.
    const nLen = MINIMAP_TUNE.northPx * this.scale;
    const nHalf = MINIMAP_TUNE.northHalfPx * this.scale;
    c.save();
    c.translate(half, half);
    c.rotate((turn * Math.PI) / 180);
    c.beginPath();
    c.moveTo(0, -rim);
    c.lineTo(nHalf, -rim + nLen);
    c.lineTo(-nHalf, -rim + nLen);
    c.closePath();
    c.lineJoin = 'round';
    c.lineWidth = 2 * this.scale;
    c.strokeStyle = colourOf(COL.void);
    c.stroke();
    c.fillStyle = colourOf(COL.accent);
    c.fill();
    c.restore();
    // You: an arrow in `ink` over a `void` halo, turned the way you face, or straight up when the map
    // turns with you.
    const a = ((v.northUp ? facing : 0) * Math.PI) / 180;
    const len = MINIMAP_TUNE.arrowPx * this.scale;
    c.save();
    c.translate(half, half);
    c.rotate(a);
    c.beginPath();
    c.moveTo(0, -len);
    c.lineTo(len * 0.7, len * 0.8);
    c.lineTo(0, len * 0.35);
    c.lineTo(-len * 0.7, len * 0.8);
    c.closePath();
    c.lineJoin = 'round';
    c.lineWidth = 3 * this.scale;
    c.strokeStyle = colourOf(COL.void);
    c.stroke();
    c.fillStyle = colourOf(COL.ink);
    c.fill();
    c.restore();
  }

  /** The canvas's backing store, for the scale and the screen's own pixels. */
  private sizeCanvas(): void {
    this.size = HUD_SIZES.minimap * this.scale;
    this.dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    this.canvas.width = Math.round(this.size * this.dpr);
    this.canvas.height = Math.round(this.size * this.dpr);
    this.clock.reset();
  }

  private roll(): void {
    const now = Date.now();
    if (now - this.windowStart < 1000) return;
    this.lastWrites = this.writes;
    this.writes = 0;
    this.lastLocWrites = this.locWrites;
    this.locWrites = 0;
    this.windowStart = now;
  }
}
