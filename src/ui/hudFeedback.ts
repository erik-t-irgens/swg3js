// Damage feedback: the three things that tell you a blow happened without asking you to read a number.
//
//   - **An arc on the edge of the screen** on the side a blow came from, so being shot from behind is
//     not the same picture as being shot from in front. The red vignette stays underneath it and is
//     the whole of what a blow with no direction (a fall) shows.
//   - **A tick on the crosshair** when one of your own shots hurts something, and a different tick —
//     red, with a ring thrown out of the middle — when it kills.
//   - **Damage numbers over heads**, behind a setting that starts off, because the game itself put
//     combat results in words and the message line is the faithful answer.
//
// Everything that is a shape is drawn through the overlay canvas, which touches no WebGL context and
// so compiles nothing; the numbers are DOM, because everything that carries words is DOM. Nothing is
// allocated in a frame: the arcs, the numbers and the accumulators are fixed pools filled in place,
// the overlay's calls take numbers and colour indices, and a number's transform is the only string
// built in a frame — one per number that is actually rising, and only while the setting is on.
//
// Nothing here knows what a Living, a Vector3 or a camera is. The game hands over numbers: a
// direction, an amount, a key, a label and a world point. That keeps the whole module testable from
// node (`tools/swg/tests/hudFeedback.test.ts`) and the game's own types out of it.
//
// One thing to know about the amount: it is the damage the blow **offered**, not what the body took.
// A body decides for itself whether a blow reaches it at all — one already dead takes nothing, and
// one of your own side that would not fight you refuses the whole blow — and the hook that feeds
// this file stands outside the body and cannot see that. The already-dead case is filtered where the
// hook is (a corpse never ticks the crosshair); the refused-ally case is not, so a number over such
// a head is what was swung, not what landed.
//
// Angles are degrees, clockwise from twelve o'clock, as everywhere in the interface.
import { HUD_SIZES, clamp01, damageAngle, fadeOut, layout, makeLayout, type HudLayout } from './hudMath.ts';

/**
 * The numbers this file invents, gathered in one place. **Every one of them is invented** — chosen
 * for this pass, not read from anything the game shipped. Everything that is a size, a radius or a
 * timing the design already names lives in `HUD_SIZES` instead (the arc's span, its three radii and
 * their alphas, its width and its 1.2 s; the tick's reach and its 0.12 s; the kill ring's two radii
 * and its 0.3 s; the pools), and everything the numbers wear is `.hud-dmg` in `src/ui/hud.css`.
 * These are the few that are neither.
 *
 * `HudFeedback.tune` writes them in place, so each is reachable live from the console rather than by
 * an edit and a reload. They take effect on the next frame; nothing caches them.
 */
export const FEEDBACK_TUNE = {
  // --- the direction arc ---------------------------------------------------------------------------
  /** A multiplier over the design's three alphas, for an arc that turns out too faint or too loud. */
  arcAlpha: 1,
  /**
   * The arc keeps pointing at where the blow came from as you turn, rather than freezing at the
   * screen angle it had when it landed. False freezes it, which is the other reading of the design.
   */
  followCamera: true,
  /** A direction shorter than this is taken as no direction at all: the vignette alone. */
  arcMinLength: 1e-4,
  // --- the tick on the crosshair -------------------------------------------------------------------
  /** How wide the four ticks and the kill ring are drawn, in pixels at scale 1. */
  tickWidth: 2,
  ringWidth: 2,
  /** The tick's alpha at its brightest, and the kill ring's. */
  tickAlpha: 1,
  ringAlpha: 0.9,
  // --- the numbers over heads ----------------------------------------------------------------------
  /** Seconds a number rises and fades for, and how far it rises in pixels at scale 1. */
  numberSeconds: 0.8,
  numberRise: 28,
  /**
   * A second blow on the same body within this many seconds is added to the number already rising
   * over it rather than throwing a second one. It is what keeps a flame thrower, which hurts a
   * fraction of a point every frame, from filling the pool twelve times a second.
   */
  numberMerge: 0.35,
  /** Steps the fade is written in: an opacity reaches the element only when it changes by one. */
  numberSteps: 8,
  /** A number under this is not shown at all (the same fraction-a-frame case). */
  numberMin: 1,
  // --- the lines in words --------------------------------------------------------------------------
  /**
   * At most one line per body per this many seconds, carrying what it has taken since the last one,
   * so a continuous weapon says "bantha: 34" four times rather than sixty. A kill says so at once.
   */
  lineEvery: 0.6,
  /** Damage under this is not worth a line on its own; it waits for the next one. */
  lineMin: 1,
};

export type FeedbackTune = typeof FEEDBACK_TUNE;

/** How many bodies are followed at once for the lines in words. Invented, a pool size rather than a knob. */
const LINE_SLOTS = 8;

/**
 * The overlay the shapes are drawn through — the part of `HudCanvas` this file uses, declared
 * structurally so nothing is imported from it and the module still works with no overlay attached.
 */
export interface FeedbackCanvas {
  arc(cx: number, cy: number, r: number, from: number, to: number, width: number, colour: number, alpha: number): void;
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: number, alpha: number): void;
  ring(cx: number, cy: number, r: number, width: number, colour: number, alpha: number): void;
}

/** The palette indices this file draws in: the palette's own `COL` satisfies it. */
export interface FeedbackColours {
  readonly ink: number;
  readonly bad: number;
}

/** The kinds this file says a line in. The message line's own sink takes these and more. */
export type FeedbackKind = 'you hit' | 'note';

/** Where a line of this module's own goes. Set by whoever owns the message line; nothing is said without one. */
export type FeedbackMessage = (kind: FeedbackKind, text: string, colour?: string) => void;

/** A point on the screen, in CSS pixels from the top left: filled in place by the projector. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * A world point to a point on the screen. The game owns the camera, so it owns this: it fills `out`
 * and returns whether the point is in front of the camera at all. It is called at most twelve times
 * a frame (once per number rising) and must not allocate.
 */
export type Projector = (x: number, y: number, z: number, out: ScreenPoint) => boolean;

/** One arc on the edge: where the blow came from, and how long ago. */
interface Blow {
  /** The direction from the player to whatever struck, kept so the arc can follow the camera. */
  dx: number;
  dy: number;
  dz: number;
  /** The screen angle worked out when it landed, which is what a frozen arc keeps. */
  angle: number;
  age: number;
  live: boolean;
}

/** One rising number. */
interface Number3D {
  el: HTMLElement;
  /** The world point it rises from. */
  x: number;
  y: number;
  z: number;
  /** Whose it is, so a second blow within `numberMerge` is added to it rather than thrown beside it. */
  key: number;
  amount: number;
  age: number;
  live: boolean;
  kill: boolean;
  /**
   * The words this number is: built where the amount changes (a blow, a merge) and never in a frame,
   * so a frame of twelve rising numbers builds no string for any of them. Empty means "too small to
   * show", which is the same test the amount would be put to.
   */
  text: string;
  /** What the element is showing, so nothing is written twice. */
  shown: string;
  step: number;
  atX: number;
  atY: number;
  hidden: boolean;
}

/**
 * What a number says, or nothing at all when it is too small to be worth showing. It is called where
 * an amount changes — a blow, and a blow merged into one already rising — and never in a frame.
 */
const textOf = (amount: number): string => (amount >= FEEDBACK_TUNE.numberMin ? String(Math.round(amount)) : '');

const div = (parent: HTMLElement | null, className: string): HTMLElement => {
  const el = document.createElement('div');
  if (className) el.className = className;
  if (parent) parent.appendChild(el);
  return el;
};

export class HudFeedback {
  readonly root: HTMLElement;
  /** Where a line of this module's own goes: a blow you landed, a body you killed. */
  messages: FeedbackMessage | null = null;

  /** The overlay and the palette's indices, once they are attached. */
  private canvas: FeedbackCanvas | null = null;
  private colours: FeedbackColours | null = null;

  /** The switches, as the Interface page sets them. The numbers start off; the rest start on. */
  private showArc = true;
  private showTick = true;
  private showNumbers = false;
  private sayLines = true;

  /** The arcs, the numbers and the two ticks: fixed pools, never grown. */
  private readonly blows: Blow[] = [];
  private readonly numbers: Number3D[] = [];
  /** Seconds since the last blow you landed, and since the last kill; `Infinity` for neither yet. */
  private tickAge = Infinity;
  private killAge = Infinity;
  /**
   * The same two, for the console alone. They are not reset when play stops, so opening the map after
   * a kill does not make the report say no blow has ever landed; they count seconds of simulated play,
   * since that is the only clock this file is given. `clear` (the world is going) forgets them.
   */
  private sinceHit = Infinity;
  private sinceKill = Infinity;

  /** The bodies followed for the lines in words: parallel arrays, so nothing is allocated to follow one. */
  private readonly lineKey = new Int32Array(LINE_SLOTS);
  private readonly lineSum = new Float64Array(LINE_SLOTS);
  private readonly lineAge = new Float64Array(LINE_SLOTS);
  private readonly lineName: string[] = new Array(LINE_SLOTS).fill('');

  /** The camera's own axes, as the game last handed them over; the identity until it does. */
  private rx = 1;
  private ry = 0;
  private rz = 0;
  private ux = 0;
  private uy = 1;
  private uz = 0;
  private fx = 0;
  private fy = 0;
  private fz = -1;

  /** The world to the screen, for the numbers. Without one they are not drawn at all. */
  private projector: Projector | null = null;
  private readonly point: ScreenPoint = { x: 0, y: 0 };

  /** Where the crosshair is: the middle of the window unless the game says otherwise. */
  private cx = 0;
  private cy = 0;
  /** Whether the game has put the crosshair somewhere of its own, so a relayout does not take it back. */
  private ownCentre = false;
  private scale = 1;
  private readonly place: HudLayout = makeLayout();
  /**
   * Whether the game tells this file the window's size (`setLayout`). Until it does — a caller that
   * has not been taught to — the window is read in `update` instead, which is what the rest of the
   * display is careful not to do. The first `setLayout` stops that for the life of the session.
   */
  private toldLayout = false;

  /** The opacity strings, one per step, built once and again only if the step count is changed live. */
  private opacity: string[] = [];
  private builtSteps = 0;

  /** Nothing is on the screen and nothing was taken off it since: what makes `idle` cost a branch. */
  private quiet = true;

  /** What the last frame drew and what has been written, for the console: a kept object. */
  private readonly drawn = { ops: 0, arcs: 0, numbers: 0, writes: 0, writesNow: 0, attached: false, projector: false, tick: 0, kill: 0 };
  /**
   * Writes to the page this second so far and in the last full second. The second is what is
   * reported, so this file's figure can be added to the display's own headline, which the design
   * asks to be 0 in a steady frame; a lifetime total could not be.
   */
  private writes = 0;
  private lastWrites = 0;
  private writeClock = 0;

  constructor(parent: HTMLElement) {
    this.root = div(parent, 'hud-dmgs');
    // The wrapper is geometry, not a look: every number under it is placed in window pixels by a
    // transform, so it has to be a positioned box over the whole window rather than the zero-height
    // block a bare div is. It is two properties written once, here, rather than a rule in a
    // stylesheet this module does not own, so the numbers cannot end up stacked in the top left
    // corner because an edit elsewhere lost the rule. `#ui` and its children take no pointer, so a
    // box over the screen swallows no click.
    this.root.style.position = 'absolute';
    this.root.style.inset = '0';
    // Both pools are made here and never grown or remade: a pool size changed at the console (they
    // are in `HUD_SIZES` with the rest of the geometry) is read at the next boot, not at once.
    for (let i = 0; i < Math.max(1, Math.round(HUD_SIZES.damagePool)); i++) {
      this.blows.push({ dx: 0, dy: 0, dz: 0, angle: 0, age: 0, live: false });
    }
    for (let i = 0; i < Math.max(1, Math.round(HUD_SIZES.numberPool)); i++) {
      const el = div(this.root, 'hud-dmg');
      el.hidden = true;
      this.numbers.push({ el, x: 0, y: 0, z: 0, key: 0, amount: 0, age: 0, live: false, kill: false, text: '', shown: '', step: -1, atX: NaN, atY: NaN, hidden: true });
    }
    this.buildOpacity();
    this.relayout();
  }

  // -------------------------------------------------------------------------------------------
  // What the game sets.

  /** The overlay to draw the shapes on, and the palette's indices. Until this is called only the numbers show. */
  attach(canvas: FeedbackCanvas, colours: FeedbackColours): void {
    this.canvas = canvas;
    this.colours = colours;
    this.drawn.attached = true;
  }

  /** The HUD scale, 0.75 to 1.5. Nothing is rebuilt: every size is read as it is drawn. */
  setScale(scale: number): void {
    const s = Math.max(HUD_SIZES.scaleMin, Math.min(HUD_SIZES.scaleMax, Number.isFinite(scale) ? scale : 1));
    if (s === this.scale) return;
    this.scale = s;
    this.relayout();
  }

  /**
   * Where the crosshair is this frame, in pixels from the top left: the flight display's boresight
   * drifts off the middle while a chase view catches a turn, and the tick belongs on it. Called with
   * nothing it goes back to the middle of the window.
   */
  setCentre(x?: number, y?: number): void {
    const own = typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y);
    this.ownCentre = own;
    this.cx = own ? (x as number) : this.place.cx;
    this.cy = own ? (y as number) : this.place.cy;
  }

  /**
   * The window's size, in CSS pixels. Whoever applies the HUD settings works the layout out once on
   * a resize and on a change of scale rather than every frame, and this is how that reaches here;
   * until it is called at all the window is read in `update` instead, which is the slower way round.
   */
  setLayout(w: number, h: number): void {
    if (!(w > 0) || !(h > 0)) return;
    this.toldLayout = true;
    if (w === this.place.w && h === this.place.h) return;
    layout(w, h, this.scale, this.place);
    if (!this.ownCentre) {
      this.cx = this.place.cx;
      this.cy = this.place.cy;
    }
  }

  /**
   * The camera's own axes in world space: right, up and the way it looks. Handed over once a frame by
   * the game, which owns the camera; nine numbers, so nothing of three's reaches this file. Until it
   * is called the axes are the identity, which puts a blow from world +X on the right of the screen.
   */
  setCamera(rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, fx: number, fy: number, fz: number): void {
    this.rx = rx;
    this.ry = ry;
    this.rz = rz;
    this.ux = ux;
    this.uy = uy;
    this.uz = uz;
    this.fx = fx;
    this.fy = fy;
    this.fz = fz;
  }

  /** The world to the screen, for the numbers over heads. Null: no numbers, whatever the setting says. */
  setProjector(project: Projector | null): void {
    this.projector = project;
    this.drawn.projector = !!project;
  }

  /** The Interface page's four switches. Turning one off takes what it has on the screen off at once. */
  setShown(arc: boolean, tick: boolean, numbers: boolean, lines: boolean): void {
    this.showArc = arc;
    this.showTick = tick;
    if (numbers !== this.showNumbers) {
      this.showNumbers = numbers;
      if (!numbers) this.dropNumbers();
    }
    this.sayLines = lines;
  }

  /**
   * The numbers this file invents, live. Only keys already in the table and only values of the type
   * already there are taken, so a typo at the console cannot put `undefined` into the geometry.
   */
  tune(patch: Partial<FeedbackTune>): FeedbackTune {
    const table = FEEDBACK_TUNE as unknown as Record<string, number | boolean>;
    for (const key of Object.keys(patch)) {
      const value = (patch as Record<string, unknown>)[key];
      const held = table[key];
      if (typeof held === 'number' && typeof value === 'number' && Number.isFinite(value)) table[key] = value;
      else if (typeof held === 'boolean' && typeof value === 'boolean') table[key] = value;
    }
    // The one knob with something built behind it: a new step count is a new table of opacity
    // strings, and without this the number would be written and the fade would keep its old steps
    // until a reload, which is exactly the knob somebody reaches for when the fade looks stepped.
    if (Math.max(1, Math.round(FEEDBACK_TUNE.numberSteps)) !== this.builtSteps) this.buildOpacity();
    return FEEDBACK_TUNE;
  }

  // -------------------------------------------------------------------------------------------
  // What the game tells it.

  /**
   * You were hurt, from the direction `(dx, dy, dz)` — the vector from you to whatever struck, in
   * world space, of any length. A vector of nothing is a blow with no direction (a fall, a burn) and
   * draws no arc at all: the red vignette, which is not this file's, is the whole of what it shows.
   *
   * Up to four arcs stand at once; a fifth takes the oldest one's place.
   */
  hurt(dx: number, dy: number, dz: number): void {
    if (!this.showArc) return;
    const len = Math.hypot(dx, dy, dz);
    if (!(len > FEEDBACK_TUNE.arcMinLength)) return;
    this.take(dx / len, dy / len, dz / len);
  }

  /** The same, given the screen angle directly: 0 is ahead, 90 the right, 180 behind. */
  hurtAngle(deg: number): void {
    if (!this.showArc || !Number.isFinite(deg)) return;
    const b = this.freeBlow();
    b.dx = 0;
    b.dy = 0;
    b.dz = 0;
    b.angle = deg;
    b.age = 0;
    b.live = true;
    this.quiet = false;
  }

  private take(dx: number, dy: number, dz: number): void {
    const b = this.freeBlow();
    b.dx = dx;
    b.dy = dy;
    b.dz = dz;
    b.angle = this.angleOfBlow(dx, dy, dz);
    b.age = 0;
    b.live = true;
    this.quiet = false;
  }

  /** A free arc, or the oldest live one: the pool never grows and a blow is never dropped. */
  private freeBlow(): Blow {
    let oldest = this.blows[0];
    for (let i = 0; i < this.blows.length; i++) {
      const b = this.blows[i];
      if (!b.live) return b;
      if (b.age > oldest.age) oldest = b;
    }
    return oldest;
  }

  private angleOfBlow(dx: number, dy: number, dz: number): number {
    return damageAngle(dx, dy, dz, this.rx, this.ry, this.rz, this.ux, this.uy, this.uz, this.fx, this.fy, this.fz);
  }

  /**
   * You landed a blow: `amount` of damage on the body `key` called `label`, at the world point
   * `(x, y, z)` — its head, which is where a number rises from. `killed` is whether that blow was the
   * one that finished it.
   *
   * It ticks the crosshair, gathers the damage for the line in words, and — only with the setting on
   * and a projector attached — throws a number over the body.
   */
  hit(amount: number, killed: boolean, key: number, label: string, x: number, y: number, z: number): void {
    const hurt = Number.isFinite(amount) && amount > 0 ? amount : 0;
    this.sinceHit = 0;
    if (killed) this.sinceKill = 0;
    if (this.showTick) {
      this.tickAge = 0;
      if (killed) this.killAge = 0;
      this.quiet = false;
    }
    if (this.sayLines) this.gather(key, label, hurt, killed);
    if (this.showNumbers && this.projector && hurt > 0) this.number(hurt, killed, key, x, y, z);
  }

  // -------------------------------------------------------------------------------------------
  // The numbers.

  private number(amount: number, killed: boolean, key: number, x: number, y: number, z: number): void {
    // A blow on a body a number is already rising over is added to that number, so a weapon that
    // hurts a fraction of a point a frame shows one number growing rather than twelve tiny ones.
    for (let i = 0; i < this.numbers.length; i++) {
      const n = this.numbers[i];
      if (!n.live || n.key !== key || n.age > FEEDBACK_TUNE.numberMerge) continue;
      n.amount += amount;
      n.text = textOf(n.amount);
      n.age = 0;
      n.x = x;
      n.y = y;
      n.z = z;
      if (killed) n.kill = true;
      this.quiet = false;
      return;
    }
    let slot: Number3D | null = null;
    let oldest: Number3D = this.numbers[0];
    for (let i = 0; i < this.numbers.length; i++) {
      const n = this.numbers[i];
      if (!n.live) {
        slot = n;
        break;
      }
      if (n.age > oldest.age) oldest = n;
    }
    const n = slot ?? oldest;
    n.key = key;
    n.amount = amount;
    n.text = textOf(amount);
    n.age = 0;
    n.live = true;
    n.kill = killed;
    n.x = x;
    n.y = y;
    n.z = z;
    n.step = -1;
    n.atX = NaN;
    n.atY = NaN;
    this.quiet = false;
  }

  /** Every number off the screen at once: the setting went off, the world was left, play stopped. */
  private dropNumbers(): void {
    for (let i = 0; i < this.numbers.length; i++) {
      const n = this.numbers[i];
      n.live = false;
      this.hide(n);
    }
  }

  private hide(n: Number3D): void {
    if (n.hidden) return;
    n.hidden = true;
    n.el.hidden = true;
    this.writes++;
  }

  /**
   * Where each live number is and how faded it is. It is the one piece of this file that writes to
   * the DOM while it is doing its work — a rising number moves every frame, and there is no cheaper
   * way to move it than the transform it is moved by. It writes nothing while nothing is rising,
   * which with the setting off is always.
   */
  private drawNumbers(): void {
    const project = this.projector;
    let live = 0;
    for (let i = 0; i < this.numbers.length; i++) {
      const n = this.numbers[i];
      if (!n.live) continue;
      if (!project || n.age >= FEEDBACK_TUNE.numberSeconds) {
        n.live = false;
        this.hide(n);
        continue;
      }
      if (!project(n.x, n.y, n.z, this.point)) {
        // Behind the camera: kept alive, and simply not shown while it is back there.
        this.hide(n);
        continue;
      }
      // Built where the amount changed, so this frame compares two strings it already has and builds
      // none: with twelve numbers up that is twelve comparisons rather than twelve allocations.
      const shown = n.text;
      if (!shown) {
        this.hide(n);
        continue;
      }
      live++;
      const t = clamp01(n.age / Math.max(1e-4, FEEDBACK_TUNE.numberSeconds));
      const x = Math.round(this.point.x);
      const y = Math.round(this.point.y - FEEDBACK_TUNE.numberRise * this.scale * t);
      if (n.shown !== shown) {
        n.shown = shown;
        n.el.textContent = shown;
        this.writes++;
      }
      if (n.kill !== n.el.classList.contains('kill')) {
        n.el.classList.toggle('kill', n.kill);
        this.writes++;
      }
      if (x !== n.atX || y !== n.atY) {
        n.atX = x;
        n.atY = y;
        // The only string this file builds in a frame, and only for a number that is rising.
        n.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
        this.writes++;
      }
      const step = Math.round(clamp01(1 - t) * this.builtSteps);
      if (step !== n.step) {
        n.step = step;
        n.el.style.opacity = this.opacity[step];
        this.writes++;
      }
      if (n.hidden) {
        n.hidden = false;
        n.el.hidden = false;
        this.writes++;
      }
    }
    this.drawn.numbers = live;
  }

  // -------------------------------------------------------------------------------------------
  // The lines in words.

  /** Gather what a body has taken, and say it at most once every `lineEvery` seconds. A kill says so now. */
  private gather(key: number, label: string, amount: number, killed: boolean): void {
    if (killed) {
      if (key > 0) this.forget(key);
      this.say('you hit', `${label || 'it'} killed`);
      return;
    }
    // A key of nothing is nobody (the console's own test blow) and nothing is gathered under it: the
    // free slots are the ones whose key is 0, and a body filed under that would never be given up.
    if (key <= 0 || amount <= 0) return;
    let slot = -1;
    let oldest = 0;
    for (let i = 0; i < LINE_SLOTS; i++) {
      if (this.lineKey[i] === key) {
        slot = i;
        break;
      }
      if (this.lineKey[i] === 0) slot = slot < 0 ? i : slot;
      else if (this.lineAge[i] > this.lineAge[oldest]) oldest = i;
    }
    if (slot < 0) slot = oldest;
    if (this.lineKey[slot] !== key) {
      this.lineKey[slot] = key;
      this.lineSum[slot] = 0;
      this.lineAge[slot] = 0;
    }
    this.lineName[slot] = label;
    this.lineSum[slot] += amount;
  }

  private forget(key: number): void {
    for (let i = 0; i < LINE_SLOTS; i++) {
      if (this.lineKey[i] !== key) continue;
      this.lineKey[i] = 0;
      this.lineSum[i] = 0;
      this.lineAge[i] = 0;
      this.lineName[i] = '';
    }
  }

  /** The gathered damage said, once the wait is up. Called once a frame from `update`. */
  private flushLines(dt: number): void {
    for (let i = 0; i < LINE_SLOTS; i++) {
      if (this.lineKey[i] === 0) continue;
      this.lineAge[i] += dt;
      if (this.lineAge[i] < FEEDBACK_TUNE.lineEvery) continue;
      const sum = this.lineSum[i];
      if (sum <= 0) {
        // Nothing at all since the last line: the slot is given up for another body.
        this.forget(this.lineKey[i]);
        continue;
      }
      // Too little to be worth a line of its own: it waits and goes out with what comes next, rather
      // than being lost, so a weapon that hurts half a point a blow still adds up to a line.
      if (sum < FEEDBACK_TUNE.lineMin) continue;
      this.lineAge[i] = 0;
      this.lineSum[i] = 0;
      this.say('you hit', `${this.lineName[i] || 'it'}: ${Math.round(sum)}`);
    }
  }

  private say(kind: FeedbackKind, text: string): void {
    if (this.messages) this.messages(kind, text);
  }

  // -------------------------------------------------------------------------------------------
  // The frame.

  /** Once a frame, while the game is simulating: ages everything and says what is due in words. */
  update(dt: number): void {
    const step = dt > 0 ? dt : 0;
    for (let i = 0; i < this.blows.length; i++) {
      const b = this.blows[i];
      if (!b.live) continue;
      b.age += step;
      if (b.age >= HUD_SIZES.damageSeconds) b.live = false;
    }
    if (this.tickAge !== Infinity) this.tickAge += step;
    if (this.killAge !== Infinity) this.killAge += step;
    if (this.sinceHit !== Infinity) this.sinceHit += step;
    if (this.sinceKill !== Infinity) this.sinceKill += step;
    for (let i = 0; i < this.numbers.length; i++) {
      if (this.numbers[i].live) this.numbers[i].age += step;
    }
    this.flushLines(step);
    // What was written to the page in the last full second, so the figure can stand beside the
    // display's own, which the design asks to be 0 in a steady frame.
    this.writeClock += step;
    if (this.writeClock >= 1) {
      this.writeClock = 0;
      this.lastWrites = this.writes;
      this.writes = 0;
    }
    // Only while nobody has taken on the job of telling this file the window's size. The moment one
    // does (`setLayout`) the window is never read from a frame again.
    if (!this.toldLayout && typeof window !== 'undefined' && (window.innerWidth !== this.place.w || window.innerHeight !== this.place.h)) this.relayout();
  }

  /**
   * Every shape of the damage feedback, between the overlay's begin and end, and the numbers' places.
   * Drawn on the frames the game is simulating and on no others.
   */
  draw(): void {
    this.drawn.ops = 0;
    this.drawNumbers();
    const c = this.canvas;
    const col = this.colours;
    if (!c || !col) {
      this.drawn.arcs = 0;
      return;
    }
    const s = this.scale;
    this.drawArcs(c, col, s);
    this.drawTick(c, col, s);
  }

  private drawArcs(c: FeedbackCanvas, col: FeedbackColours, s: number): void {
    const S = HUD_SIZES;
    let live = 0;
    if (!this.showArc) {
      this.drawn.arcs = 0;
      return;
    }
    const half = S.damageSpan / 2;
    const width = S.damageWidth * s;
    // The three radii, held inside the window exactly as the flight display's arcs are: at the 1.5
    // the scale allows, the outer one stands 316 px off the middle and leaves the top and bottom of
    // any window shorter than about 640 px. The three are drawn in at one factor, so the band keeps
    // its shape rather than closing up. Worked out once a frame, from numbers already to hand.
    const outer = Math.max(S.arcMin, Math.min(S.damageR3 * s, Math.min(this.place.w, this.place.h) / 2 - S.arcMargin * s - width / 2));
    const fit = outer / (S.damageR3 * s);
    const r1 = S.damageR1 * s * fit;
    const r2 = S.damageR2 * s * fit;
    const r3 = S.damageR3 * s * fit;
    for (let i = 0; i < this.blows.length; i++) {
      const b = this.blows[i];
      if (!b.live) continue;
      live++;
      // The whole life is the fade: an arc is brightest as it lands and gone 1.2 s later.
      const k = fadeOut(b.age, S.damageSeconds, S.damageSeconds) * FEEDBACK_TUNE.arcAlpha;
      if (k <= 0) continue;
      const deg = FEEDBACK_TUNE.followCamera && (b.dx || b.dy || b.dz) ? this.angleOfBlow(b.dx, b.dy, b.dz) : b.angle;
      const from = deg - half;
      const to = deg + half;
      // Three plain strokes rather than a gradient object, so nothing is allocated to draw one.
      c.arc(this.place.cx, this.place.cy, r1, from, to, width, col.bad, S.damageA1 * k);
      c.arc(this.place.cx, this.place.cy, r2, from, to, width, col.bad, S.damageA2 * k);
      c.arc(this.place.cx, this.place.cy, r3, from, to, width, col.bad, S.damageA3 * k);
      this.drawn.ops += 3;
    }
    this.drawn.arcs = live;
  }

  /**
   * The tick on the crosshair: four marks that flash outside the boresight's own when a shot of yours
   * hurts something, red on a kill, with a ring thrown out of the middle.
   *
   * The design has the boresight's own four ticks jump outward instead. They belong to the flight
   * display and to the on-foot crosshair, neither of which this file may write into, so the tick is
   * drawn here as four marks of its own beyond them — the same jump to the eye, and one call away
   * from being the design's own if the two owners ever hand their ticks over.
   */
  private drawTick(c: FeedbackCanvas, col: FeedbackColours, s: number): void {
    const S = HUD_SIZES;
    const R = FEEDBACK_TUNE;
    if (!this.showTick) return;
    // The kill's own tick, unless a plain blow has landed since it: shooting the next body a tenth of
    // a second after a kill showed the kill's fading red rather than a fresh mark of its own.
    const kill = this.killAge < S.killTickSeconds && this.killAge <= this.tickAge;
    const age = kill ? this.killAge : this.tickAge;
    const life = kill ? S.killTickSeconds : S.hitTickSeconds;
    if (age < life) {
      const k = fadeOut(age, life, life);
      const from = S.hitTickFrom * s;
      const to = from + S.boresightLen * s;
      const colour = kill ? col.bad : col.ink;
      const alpha = R.tickAlpha * k;
      const w = R.tickWidth * s;
      const x = this.cx;
      const y = this.cy;
      c.line(x - to, y, x - from, y, w, colour, alpha);
      c.line(x + from, y, x + to, y, w, colour, alpha);
      c.line(x, y - to, x, y - from, w, colour, alpha);
      c.line(x, y + from, x, y + to, w, colour, alpha);
      this.drawn.ops += 4;
    }
    // The kill's own ring, thrown out of the middle as it fades.
    if (this.killAge < S.killTickSeconds) {
      const k = clamp01(this.killAge / Math.max(1e-4, S.killTickSeconds));
      const r = (S.killRingFrom + (S.killRingTo - S.killRingFrom) * k) * s;
      c.ring(this.cx, this.cy, r, R.ringWidth * s, col.bad, R.ringAlpha * (1 - k));
      this.drawn.ops++;
    }
  }

  /**
   * The game is not simulating — a panel, the map, the death card, the loading screen. Nothing is
   * drawn and what was on the screen is taken off once; calling it every frame after that costs a
   * branch. A frozen number over a dead body is exactly the fault this avoids.
   */
  idle(): void {
    this.drawn.ops = 0;
    this.drawn.arcs = 0;
    this.drawn.numbers = 0;
    if (this.quiet) return;
    this.quiet = true;
    for (let i = 0; i < this.blows.length; i++) this.blows[i].live = false;
    this.tickAge = Infinity;
    this.killAge = Infinity;
    this.dropNumbers();
  }

  /** Everything gone and everything forgotten: the world is being left. */
  clear(): void {
    this.idle();
    this.sinceHit = Infinity;
    this.sinceKill = Infinity;
    for (let i = 0; i < LINE_SLOTS; i++) {
      this.lineKey[i] = 0;
      this.lineSum[i] = 0;
      this.lineAge[i] = 0;
      this.lineName[i] = '';
    }
  }

  /**
   * What the last frame drew and what has been written, for the console: a kept object.
   *
   * `writes` is the last full second's, so it can stand beside the rest of the display's in the one
   * figure the design asks to be 0 in a steady frame; `writesNow` is this second so far. `tick` and
   * `kill` are seconds of play since your last blow and your last kill, -1 for neither yet, and they
   * are not forgotten when play stops — opening a panel after a kill used to say none had happened.
   */
  report(): { ops: number; arcs: number; numbers: number; writes: number; writesNow: number; attached: boolean; projector: boolean; tick: number; kill: number } {
    const d = this.drawn;
    d.writes = this.lastWrites;
    d.writesNow = this.writes;
    d.tick = Number.isFinite(this.sinceHit) ? Math.round(this.sinceHit * 1000) / 1000 : -1;
    d.kill = Number.isFinite(this.sinceKill) ? Math.round(this.sinceKill * 1000) / 1000 : -1;
    return d;
  }

  /** The switches as they stand, for the console and for a test. */
  get shown(): { arc: boolean; tick: boolean; numbers: boolean; lines: boolean } {
    return { arc: this.showArc, tick: this.showTick, numbers: this.showNumbers, lines: this.sayLines };
  }

  // -------------------------------------------------------------------------------------------

  private relayout(): void {
    // The size last handed over, once anybody has: a change of scale must not go back to reading the
    // window behind the back of whoever owns the layout.
    const told = this.toldLayout && this.place.w > 0 && this.place.h > 0;
    const w = told ? this.place.w : typeof window === 'undefined' ? 1280 : window.innerWidth;
    const h = told ? this.place.h : typeof window === 'undefined' ? 720 : window.innerHeight;
    layout(w, h, this.scale, this.place);
    // A crosshair the game is placing itself (the flight display's boresight, which drifts off the
    // middle in a chase view) is left where it put it: a resize in the same frame used to take it
    // back to the middle of the window for that frame.
    if (this.ownCentre) return;
    this.cx = this.place.cx;
    this.cy = this.place.cy;
  }

  private buildOpacity(): void {
    const steps = Math.max(1, Math.round(FEEDBACK_TUNE.numberSteps));
    this.opacity = new Array<string>(steps + 1);
    for (let i = 0; i <= steps; i++) this.opacity[i] = (i / steps).toFixed(3);
    this.builtSteps = steps;
    // Every step already written is an index into the table that has just gone: they are forgotten,
    // so the next frame writes each live number's opacity once out of the new one.
    for (let i = 0; i < this.numbers.length; i++) this.numbers[i].step = -1;
  }
}
