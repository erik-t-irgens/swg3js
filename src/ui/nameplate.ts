// The name and the health of whatever the crosshair is resting on, over its head.
//
// It replaces "nearby: <creature>" in the corner, which said the name of the nearest living thing
// whether you were looking at it or not and cost a walk of every living thing on the planet every
// frame. This walks the same list, but at a rate of its own, and it answers a different question:
// what am I pointing at.
//
// It is a readout and not a target system. Nothing is selected, nothing is remembered between
// frames but the key of what was shown, and no combat code hears about it.
//
// Nothing is allocated in a frame: the plates are a fixed pool built once, the maths is arithmetic
// on numbers, and the only strings written are a name that has changed. The two pure halves — the
// pick and the projection — take plain numbers and objects so a node test can drive them with no
// page and no renderer.
import { HUD_SIZES, barBand, clamp01, nameplate, type Nameplate } from './hudMath.ts';

/**
 * What the pick and the plates need of a living thing. It is written structurally rather than as
 * the combat model's `Living`, so nothing in the interface depends on the combat model and a test
 * can hand over four plain objects.
 */
export interface PlateThing {
  readonly key: number;
  readonly label: string;
  readonly dead: boolean;
  readonly pos: { x: number; y: number; z: number };
  readonly halfHeight: number;
  /** Where it has them: the bar is left off anything that does not keep a health of its own. */
  readonly hp?: number;
  readonly maxHp?: number;
}

/** A camera, structurally: three's own satisfies it and nothing here imports three. */
export interface PlateCamera {
  readonly matrixWorldInverse: { readonly elements: ArrayLike<number> };
  readonly projectionMatrix: { readonly elements: ArrayLike<number> };
}

/**
 * The numbers this file invents. They are kept together here and are live through
 * `Nameplates.tune`, which `__debug.hud` reaches, so each one can be tried at the console rather
 * than in an edit and a reload.
 */
export const PLATE_TUNE = {
  /** Invented: how many times a second the list of the living is walked. A plate follows every frame; only the pick is at this rate. */
  pickHz: 10,
  /** Invented: how far above the head the plate sits, in pixels at scale 1. */
  liftPx: 10,
  /** Invented: a plate is let go this many seconds after the crosshair leaves it, so a glance away does not blink it out. */
  hold: 0.35,
  /** Invented: the smallest change in the health share worth a write, as a share of the bar's own length. */
  barStep: 1 / 44,
};

const TUNE_KEYS = ['pickHz', 'liftPx', 'hold', 'barStep'] as const;

/** Where a point lands on the screen, and whether it is behind the camera. Filled in place. */
export interface Projected {
  x: number;
  y: number;
  behind: boolean;
}

export function makeProjected(): Projected {
  return { x: 0, y: 0, behind: false };
}

/**
 * A world point to a place on the screen, through a camera's own two matrices. three's elements are
 * in column order, which is what the indices below read. Behind the camera the clip w is zero or
 * less; the place is still filled (mirrored through the middle by whoever clamps it), so a caller
 * that wants an arrow at the edge has something to work with.
 *
 * Pure arithmetic: no vector is made, nothing is read back off a renderer.
 */
export function projectPoint(x: number, y: number, z: number, camera: PlateCamera, w: number, h: number, out: Projected): Projected {
  const v = camera.matrixWorldInverse.elements;
  const p = camera.projectionMatrix.elements;
  const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
  const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
  const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
  const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
  const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
  const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
  const behind = cw <= 1e-6;
  const d = behind ? -cw : cw;
  const ndcX = d > 1e-6 ? cx / d : 0;
  const ndcY = d > 1e-6 ? cy / d : 0;
  out.behind = behind;
  out.x = (ndcX * 0.5 + 0.5) * w;
  out.y = (-ndcY * 0.5 + 0.5) * h;
  return out;
}

/**
 * The living thing under the crosshair: the nearest one within `range` metres whose direction from
 * the eye is inside `cone` degrees of where the camera looks. Dead things, the player and anything
 * standing exactly at the eye (a hundredth of a metre, which is a body the camera is inside rather
 * than one you are looking at) are passed over. Nothing wider is cut: a creature swinging at you is
 * a metre away, and a plate that vanished at melee range would go out exactly when it is wanted.
 *
 * It is the nearest of those inside the cone, not the one closest to the middle of it: a bantha
 * three metres away and a little off the crosshair is what you are looking at, whatever stands
 * behind it exactly on the line.
 */
export function pickPlate(
  list: readonly PlateThing[],
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  range: number,
  cone: number,
  exclude: number,
): PlateThing | null {
  const cos = Math.cos((cone * Math.PI) / 180);
  let best: PlateThing | null = null;
  let bestD = range * range;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.dead || t.key === exclude) continue;
    // Toward the middle of the body, not its feet: a creature at your ankles is otherwise never in
    // the cone, and a tall one is picked by its shins.
    const dx = t.pos.x - eyeX;
    const dy = t.pos.y + t.halfHeight - eyeY;
    const dz = t.pos.z - eyeZ;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > bestD || d2 < 1e-4) continue;
    const d = Math.sqrt(d2);
    if ((dx * dirX + dy * dirY + dz * dirZ) / d < cos) continue;
    bestD = d2;
    best = t;
  }
  return best;
}

/** A thing's health as a share, or NaN where it keeps none: the bar is left off then. */
export function healthShare(t: PlateThing): number {
  if (typeof t.hp !== 'number' || typeof t.maxHp !== 'number' || !(t.maxHp > 0)) return NaN;
  return clamp01(t.hp / t.maxHp);
}

// -------------------------------------------------------------------------------------------------

interface Plate {
  root: HTMLElement;
  name: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  /** What was written last: the key it belongs to, its name, its share and where it stood. */
  key: number;
  label: string;
  share: number;
  band: string;
  x: number;
  y: number;
  on: boolean;
  barShown: boolean;
}

/** The clock the write count's second is measured on, wherever this file is run. */
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

const div = (parent: HTMLElement | null, className: string): HTMLElement => {
  const el = document.createElement('div');
  if (className) el.className = className;
  if (parent) parent.appendChild(el);
  return el;
};

/**
 * The plates: a fixed pool, built once, moved by a transform and written only when what they show
 * has changed. Only one is ever up today — what the crosshair rests on — and the pool is the
 * design's eight so that a second reader (a group, a fight) needs no new machinery.
 */
export class Nameplates {
  readonly root: HTMLElement;
  private readonly pool: Plate[] = [];
  private enabled = true;
  private scale = 1;
  private w = 0;
  private h = 0;
  /** The seconds left of the pick's own clock, what it last found, and how long that is kept for. */
  private pickIn = 0;
  private held: PlateThing | null = null;
  private heldFor = 0;
  private readonly place: Nameplate = { x: 0, y: 0, show: false };
  private readonly at: Projected = makeProjected();
  /**
   * The writes this second, and the last full second's, which is what `report` hands over: the same
   * reading as the display's own counter beside it, rather than a total since the page opened, which
   * cannot be compared with anything.
   */
  private writes = 0;
  private lastWrites = 0;
  private windowStart = nowMs();
  /** What `report` hands back: one object, filled in place. */
  private readonly out = { shown: 0, writes: 0, label: '', enabled: true };

  constructor(parent: HTMLElement) {
    this.root = div(parent, 'hud-plates');
    for (let i = 0; i < HUD_SIZES.nameplatePool; i++) {
      const root = div(this.root, 'hud-plate');
      root.hidden = true;
      const name = div(root, 'name');
      const bar = div(root, 'hud-bar good');
      div(bar, 'ghost snap');
      const fill = div(bar, 'fill');
      this.pool.push({ root, name, bar, fill, key: 0, label: '', share: -1, band: '', x: NaN, y: NaN, on: false, barShown: true });
    }
  }

  /** Off in the Interface page: every plate goes and nothing is walked. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.out.enabled = on;
    if (!on) this.clear();
  }

  setScale(scale: number): void {
    this.scale = scale > 0 ? scale : 1;
  }

  /** The invented numbers, live. Only the names above and only finite numbers above zero are taken. */
  tune(patch: Partial<typeof PLATE_TUNE>): typeof PLATE_TUNE {
    for (const key of Object.keys(patch)) {
      const value = (patch as Record<string, unknown>)[key];
      if (!(TUNE_KEYS as readonly string[]).includes(key)) {
        console.warn(`nameplates: no number called ${key}; they are ${TUNE_KEYS.join(', ')}`);
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        console.warn(`nameplates: ${key} wants a number above zero, not ${String(value)}`);
        continue;
      }
      PLATE_TUNE[key as keyof typeof PLATE_TUNE] = value;
    }
    return PLATE_TUNE;
  }

  /**
   * What is up and what it cost, for the console: a kept object, filled in place. `writes` is the
   * last full second's, not a total: a plate that is up writes its place on every frame the head it
   * sits over moves on the screen, which walking does, so the figure is a rate and is meant to be
   * read beside the display's own.
   */
  report(): { shown: number; writes: number; label: string; enabled: boolean } {
    const o = this.out;
    this.roll();
    o.writes = this.lastWrites;
    o.shown = 0;
    o.label = '';
    for (const p of this.pool) {
      if (!p.on) continue;
      o.shown++;
      if (!o.label) o.label = p.label;
    }
    return o;
  }

  /** Every plate off at once: a travel, a death, the select screen, the setting turned off. */
  clear(): void {
    this.held = null;
    this.heldFor = 0;
    this.pickIn = 0;
    for (const p of this.pool) this.hide(p);
  }

  /**
   * One call a frame while the game is simulating. `list` is the world's own kept list of the
   * living; `eye` is where the crosshair is cast from and `dir` where it points, both in world
   * metres; `camera` is what the picture was drawn with. Nothing is allocated.
   */
  track(
    dt: number,
    list: readonly PlateThing[],
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    camera: PlateCamera,
    w: number,
    h: number,
    exclude = 0,
  ): void {
    this.roll();
    if (!this.enabled) return;
    this.w = w;
    this.h = h;
    // The list is walked at its own rate; what it found is followed every frame, so the plate sits
    // on a running creature and not where it was a tenth of a second ago.
    this.pickIn -= dt;
    if (this.pickIn <= 0) {
      this.pickIn = 1 / Math.max(1, PLATE_TUNE.pickHz);
      const found = pickPlate(list, eyeX, eyeY, eyeZ, dirX, dirY, dirZ, HUD_SIZES.nameplateRange, HUD_SIZES.nameplateCone, exclude);
      if (found) {
        this.held = found;
        this.heldFor = PLATE_TUNE.hold;
      }
    }
    // Nothing under the crosshair: the last one is kept for a moment, so a glance away does not
    // blink it out, and then let go. The hold runs on the frame's own clock, not the pick's.
    if (this.held) {
      this.heldFor -= dt;
      if (this.heldFor <= 0 || this.held.dead) this.held = null;
    }
    const t = this.held;
    if (t) {
      const dx = t.pos.x - eyeX;
      const dy = t.pos.y + t.halfHeight - eyeY;
      const dz = t.pos.z - eyeZ;
      this.draw(this.take(t.key), t, camera, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    for (const p of this.pool) if (p.on && (!t || p.key !== t.key)) this.hide(p);
  }

  /** The write count's second over: one comparison, from the frame and from the console alike. */
  private roll(): void {
    const now = nowMs();
    if (now - this.windowStart < 1000) return;
    this.lastWrites = this.writes;
    this.writes = 0;
    this.windowStart = now;
  }

  /** The plate holding this key, or nothing. */
  private plateOf(key: number): Plate | null {
    for (const p of this.pool) if (p.on && p.key === key) return p;
    return null;
  }

  /** The plate for a key: the one already showing it, else the first free one, else the first. */
  private take(key: number): Plate {
    const had = this.plateOf(key);
    if (had) return had;
    let free = this.pool[0];
    for (const p of this.pool) {
      if (p.on) continue;
      free = p;
      break;
    }
    free.key = key;
    return free;
  }

  private hide(p: Plate): void {
    if (!p.on) return;
    p.on = false;
    p.root.classList.toggle('on', false);
    p.root.hidden = true;
    p.key = 0;
    p.label = '';
    p.x = NaN;
    p.y = NaN;
    this.writes += 2;
  }

  /** One plate: its place, its name, its bar. Every write is guarded by what was written before. */
  private draw(p: Plate, t: PlateThing, camera: PlateCamera, distance: number): void {
    // The top of the body: `pos` is at the feet and `halfHeight` is half of it, which is how the
    // rest of the game aims at a body (`pos.y + halfHeight` is its middle).
    projectPoint(t.pos.x, t.pos.y + t.halfHeight * 2, t.pos.z, camera, this.w, this.h, this.at);
    nameplate(this.at.x, this.at.y, this.at.behind, distance, HUD_SIZES.nameplateRange, this.w, this.h, this.place);
    if (!this.place.show) {
      this.hide(p);
      return;
    }
    const x = Math.round(this.place.x);
    const y = Math.round(this.place.y - PLATE_TUNE.liftPx * this.scale);
    if (!p.on) {
      p.on = true;
      p.key = t.key;
      p.root.hidden = false;
      // The class is put on after the element is shown, so the stylesheet's own fade runs; both are
      // one write and neither happens again while the plate stands.
      p.root.classList.toggle('on', true);
      this.writes += 2;
    }
    if (x !== p.x || y !== p.y) {
      p.x = x;
      p.y = y;
      p.root.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
      this.writes++;
    }
    if (t.label !== p.label) {
      p.label = t.label;
      p.name.textContent = t.label;
      this.writes++;
    }
    const share = healthShare(t);
    const has = share === share;
    if (has !== p.barShown) {
      p.barShown = has;
      p.bar.hidden = !has;
      this.writes++;
    }
    if (!has) return;
    const step = Math.max(1e-6, PLATE_TUNE.barStep);
    const at = Math.round(share / step);
    if (at !== p.share) {
      p.share = at;
      p.fill.style.transform = `scaleX(${at * step})`;
      this.writes++;
      const band = barBand(share);
      if (band !== p.band) {
        p.band = band;
        p.bar.className = `hud-bar ${band}`;
        this.writes++;
      }
    }
  }
}
