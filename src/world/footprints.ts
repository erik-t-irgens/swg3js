/**
 * The print a foot leaves where it lands.
 *
 * A body's animation already says when a foot lands, and the sound pass already asks what it landed
 * on (`src/audio/footsteps.ts`, which reads the marks in `src/audio/clipEvents.ts`). This is a
 * second listener beside that sound and **never a second clock**: it is handed one kept record per
 * step, works out where the foot was and how big its print is, and asks the marks system for one
 * mark. A body standing still plays no foot marks, so it costs nothing at all.
 *
 * Three things it decides, all of them ours:
 *
 *  - **Which ground keeps a print** is `printDepth` in `./surfaces.ts` -- sand and snow keep one,
 *    stone and metal keep none -- so the rule lives with the rest of what a surface is.
 *  - **Where the print goes.** The step's place is the body's own, between its feet, so each print
 *    is stepped sideways by half a stance and the two feet alternate. Which foot landed is not in
 *    the marks the game's own animations carry (Jedi Academy's say `_l` or `_r`, the game's say
 *    only `footstep`), so a body's feet are simply taken in turn, which is what a walk does.
 *  - **Which ground it lies in.** A print laid flat is half buried on any real slope, and sand and
 *    snow are exactly the ground that is never flat, so the world is asked for the surface's own
 *    normal and the print is lain in it: the sideways step onto the body's other foot is taken in
 *    that plane too (`slopeStep`), so the print's middle stays on the dune's face. The same answer
 *    carries the collider underfoot, so a print laid on a placed object goes down when that object
 *    streams out instead of hanging in the air where it stood.
 *  - **Aboard a hull nothing is laid at all.** A ship's rooms keep the hull's own frame while the
 *    marks are drawn in the world's, so a print made on a deck would be left hanging in the air the
 *    moment the ship moved. (Every deck the interior table names is metal or carpet, which keeps no
 *    print in any case, so this loses nothing that would have shown.)
 *
 * Nothing here draws: the mark itself is the marks system's (`src/world/marks.ts`), which this asks
 * through one sink so that neither side has to know the other. With no sink set -- before the world
 * has wired one, or in a node test -- every step is counted and nothing is drawn.
 *
 * Every invented number is in `PRINT_TUNE`, live through `__debug.footprints({ ... })`, and the
 * maths below is pure and mirrored by `tools/swg/tests/footprints.test.ts`.
 */
import type { FootGround, FootStep } from '../audio/footsteps.ts';
import { PRINT_SURFACES, printDepth } from './surfaces.ts';

export interface PrintTune {
  /** Whether prints are laid at all. */
  enabled: boolean;
  /** INVENTED: a print's length along the way the body faces, in metres, for a body of scale 1. */
  length: number;
  /** INVENTED: its width across, in metres. */
  width: number;
  /** INVENTED: half the distance between a body's feet: how far each print is stepped off its middle. */
  stance: number;
  /** INVENTED: seconds a print lasts before it has faded away. */
  life: number;
  /** INVENTED: metres a body must have moved since its last print before it leaves another, so a
   * clip that marks feet while standing (a dance, a shuffle) does not stack prints in one place. */
  minStep: number;
  /** INVENTED: the most a body's own size may grow its print and its stride by. */
  maxScale: number;
  /** INVENTED: the most bodies whose feet are remembered at once; the least recently seen go first. */
  bodies: number;
  /**
   * INVENTED: how much of a print's life the ground's own grading is spent on, 0 to 1. The marks
   * system has no per-mark fade, so `printDepth`'s grading (mud 0.85, soft dirt 0.6) is spent here
   * instead: at 1 a print lasts in proportion to how deeply the ground took it, at 0 every print
   * lasts the same time and the grading reaches nothing.
   */
  strengthLife: number;
}

/** Ours, every one; `__debug.footprints({ ... })` moves them live. */
export const PRINT_TUNE: PrintTune = {
  enabled: true,
  length: 0.28,
  width: 0.11,
  stance: 0.17,
  life: 45,
  minStep: 0.2,
  maxScale: 3,
  bodies: 64,
  strengthLife: 1,
};

/**
 * One print, as the marks system is asked for it. The way it points and its own side are handed
 * over as vectors rather than as an angle, so neither side has to agree about which way a heading
 * turns: the quad is the middle, plus or minus `f` by half the length and `s` by half the width.
 * The side is already mirrored for a left foot, which is how one picture serves both feet.
 *
 * It is one kept record, refilled per step: a sink reads what it needs and never holds on to it.
 */
export interface PrintMark {
  /** The middle of the print, on the ground the foot landed on. */
  x: number;
  y: number;
  z: number;
  /**
   * The way it points: a unit vector in the **horizontal** plane, which is where a heading lives.
   * A marks system with a normal flattens it into the surface, as `Marks.place`'s `along` does.
   */
  fx: number;
  fz: number;
  /** Its own side, at right angles to that and horizontal too, already mirrored for the left foot. */
  sx: number;
  sz: number;
  /**
   * The normal of what the foot landed on, a unit vector; straight up where nothing could say. A
   * print laid flat on a slope is half buried -- the lift a mark is given is millimetres against a
   * print's own 14 cm half-length, so past about two and a half degrees the toe is under the sand --
   * so the marks system is given the real one and lies the quad in it.
   */
  nx: number;
  ny: number;
  nz: number;
  /**
   * The collider the print was laid on, **null** for the world itself (the terrain, a building's
   * shell). A print on a placed object must go down with that object when it streams out, and a
   * body standing on a crate in the desert is laid on "sand" at the crate's own height, because
   * most placed things are made of nothing of their own and the ground underneath answers for
   * them. Null and not a number: which number means "the world" is the marks system's to say, and
   * a sink turns this into its own `MARK_WORLD` in the one line that already knows it.
   */
  owner: number | null;
  length: number;
  width: number;
  /** Seconds it lasts, the ground's own grading already spent on it (`lifeFor`). */
  life: number;
  /** How deeply the ground took it, 0 to 1: a snowfield keeps more than dry sand. */
  strength: number;
  left: boolean;
  /** What it was laid on, for the report. */
  surface: string;
}

/** Where a print goes. The marks system sets one of these and nothing else calls in. */
export type PrintSink = (mark: PrintMark) => void;

/** One line of the report: the last few prints, which is how they are checked in a driven tab. */
export interface PrintRow {
  body: string;
  surface: string;
  foot: 'l' | 'r';
  x: number;
  z: number;
  strength: number;
  /** How steep the ground it was laid on was, in degrees: 0 is flat and a dune face is 10 to 20. */
  slope: number;
  /** The collider it was laid on, null for the world itself; anything else dies with that thing. */
  owner: number | null;
  /** Seconds it will last, which is the tuned life graded by how deeply the ground took it. */
  life: number;
}

/** One body's feet: which one lands next, and where it last left a print. */
interface Feet {
  /** True when the last print was the left foot's, so the next is the right's. */
  left: boolean;
  x: number;
  z: number;
  /** Nothing has been laid for this body yet, so the first step is never too soon. */
  laid: boolean;
  /** The step this body was last seen on, so the least recently seen are the ones dropped. */
  seen: number;
}

/** Scratch at module scope, as the rest of the combat and world code keeps it: a step allocates nothing. */
const mark: PrintMark = { x: 0, y: 0, z: 0, fx: 0, fz: 1, sx: 1, sz: 0, nx: 0, ny: 1, nz: 0, owner: null, length: 0, width: 0, life: 0, strength: 0, left: false, surface: '' };
const fwd = { x: 0, z: 1 };
const side = { x: 1, z: 0 };
/** What the world says about the ground under the foot, refilled per step and never held. */
const ground: FootGround = { nx: 0, ny: 1, nz: 0, owner: null };
/** The sideways step onto the slope, refilled per step. */
const offset = { x: 0, y: 0, z: 0 };

/**
 * The way a body of this heading faces, in the ground plane. The game's own convention, which is
 * `(sin h, cos h)` and is written out in four places: the player takes its heading from the way it
 * is moving (`Math.atan2(move.x, move.z)` in `player.ts`) and reads its own forward back as
 * `(sin, cos)` beside it; a mobile's muzzle stands at `(sin h, cos h)` of its middle; a fighter's
 * walk steps by `(sin h, cos h)`. So heading 0 faces +Z and a quarter turn faces +X.
 *
 * It is **not** the camera's `forward()`, which is `(-sin yaw, 0, -cos yaw)` of the camera's own
 * yaw: a heading is that yaw plus half a turn (`camYaw = atan2(fwd.x, fwd.z)` in `player.ts`), so
 * the two are the same vector written from two different angles, and reading the camera's formula
 * with a heading in it points a print the way the body came from.
 */
export function facingOf(heading: number, out: { x: number; z: number }): void {
  out.x = Math.sin(heading);
  out.z = Math.cos(heading);
}

/**
 * The perpendicular of that in the ground plane -- the body's own side, which is what a print is
 * stepped off along. Heading 0 gives (1, 0), which is the one `player.ts` itself calls the body's
 * right (`enemyNear`'s `R` is `(cos h, -sin h)`).
 *
 * Only that it is perpendicular matters to where a print goes; which of the two perpendiculars is
 * really the right boot's decides only whether a walk's left and right prints are swapped, and
 * that cannot be seen from a tab that draws nothing. Flipping both signs here is the one line if
 * the owner sees a mirrored gait.
 */
export function sideOf(heading: number, out: { x: number; z: number }): void {
  out.x = Math.cos(heading);
  out.z = -Math.sin(heading);
}

/**
 * A step of `dist` metres along the horizontal direction (sx, sz), laid **in** the surface the foot
 * landed on rather than across it: the direction is flattened into the plane of the normal and made
 * a unit vector again, so a print stepped half a stance sideways on a dune face sits on the sand
 * and not in it or over it. On flat ground `out.y` is exactly 0 and this is the plain offset.
 *
 * A normal with nothing left to flatten against (one lying along the step itself, which no ground a
 * foot stands on has) keeps the horizontal step, which is the safe answer rather than a zero.
 */
export function slopeStep(sx: number, sz: number, nx: number, ny: number, nz: number, dist: number, out: { x: number; y: number; z: number }): void {
  const d = sx * nx + sz * nz;
  const px = sx - nx * d;
  const py = -ny * d;
  const pz = sz - nz * d;
  const len = Math.sqrt(px * px + py * py + pz * pz);
  if (!(len > 1e-6)) {
    out.x = sx * dist;
    out.y = 0;
    out.z = sz * dist;
    return;
  }
  const k = dist / len;
  out.x = px * k;
  out.y = py * k;
  out.z = pz * k;
}

/**
 * How long a print lasts on ground that took it only partly. The marks system has no per-mark
 * fade of its own, so how deeply the ground took a print is spent on how long it stays: ground
 * that keeps a whole print keeps it for the whole life, and softer-edged ground loses it sooner.
 * `k` is `PRINT_TUNE.strengthLife`, 0 for "every print lasts the same time" and 1 for "in
 * proportion". Pure, so the test sweeps it.
 */
export function lifeFor(life: number, strength: number, k: number): number {
  const s = clamp(strength, 0, 1);
  const mix = clamp(k, 0, 1);
  return life * (1 - mix + mix * s);
}

/** How far a print is stepped off the body's middle: half a stance, to the left or to the right. */
export function stanceOffset(stance: number, scale: number, left: boolean): number {
  return stance * scale * (left ? -1 : 1);
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * The world's answer made a unit vector in place, and straight up where it gave none worth having
 * (a zero, a NaN, or a normal pointing along the ground, which is a wall and not a floor). A print
 * is never laid on anything a foot could not have stood on, so the floor here is deliberate.
 */
function normalise(n: FootGround): void {
  const len = Math.sqrt(n.nx * n.nx + n.ny * n.ny + n.nz * n.nz);
  if (!(len > 1e-6) || !(n.ny / len > 0.05)) {
    n.nx = 0;
    n.ny = 1;
    n.nz = 0;
    return;
  }
  n.nx /= len;
  n.ny /= len;
  n.nz /= len;
}

/**
 * The feet of everything that walks. One of these lives as long as the game does; a world is let go
 * of with `leave`, which is also what forgets which foot each body had last put down.
 */
export class Footprints {
  /** The invented numbers themselves, not a copy, so the console moves what the game reads. */
  readonly tune: PrintTune = PRINT_TUNE;
  /** Where a print goes; null until the world has a marks system to draw them. */
  sink: PrintSink | null = null;
  readonly counts = { steps: 0, laid: 0, off: 0, aboard: 0, hardGround: 0, tooSoon: 0, noSink: 0 };
  /** The last few prints, for the report. */
  readonly log: PrintRow[] = [];

  private readonly feet = new Map<number, Feet>();

  /**
   * Handed to the feet as their step listener. A bound field rather than a method, so the wiring
   * makes no closure and the same function is registered every time.
   */
  readonly stepHook = (step: FootStep): void => {
    this.step(step);
  };

  /** One foot landing. Everything this decides is above; nothing here draws. */
  step(step: FootStep): void {
    this.counts.steps++;
    const t = this.tune;
    if (!t.enabled) {
      this.counts.off++;
      return;
    }
    // Aboard a hull the place is in that hull's frame and the marks are in the world's.
    if (step.deck) {
      this.counts.aboard++;
      return;
    }
    const depth = printDepth(step.surface);
    if (depth <= 0) {
      this.counts.hardGround++;
      return;
    }
    const scale = clamp(step.scale > 0 ? step.scale : 1, 0.2, t.maxScale);
    const feet = this.trackFor(step.key);
    const dx = step.x - feet.x;
    const dz = step.z - feet.z;
    const near = t.minStep * scale;
    if (feet.laid && dx * dx + dz * dz < near * near) {
      this.counts.tooSoon++;
      return;
    }
    // The feet are taken in turn: the marks the animations carry do not say which one landed.
    const left = !feet.left;
    feet.left = left;
    feet.laid = true;
    feet.x = step.x;
    feet.z = step.z;
    // What the foot is really standing on: the slope of it, so the print lies in the ground rather
    // than through it, and the collider it belongs to, so a print on a streamed prop goes down with
    // that prop. Asked for only here, after the ground has been found soft enough to keep a print,
    // so a walk over stone costs nothing at all. A world with nothing to say leaves it flat and
    // world-owned, which is what a node test and a planet with no physics get.
    ground.nx = 0;
    ground.ny = 1;
    ground.nz = 0;
    ground.owner = null;
    if (step.ground) step.ground(ground);
    normalise(ground);
    facingOf(step.heading, fwd);
    sideOf(step.heading, side);
    const off = stanceOffset(t.stance, scale, left);
    slopeStep(side.x, side.z, ground.nx, ground.ny, ground.nz, off, offset);
    mark.x = step.x + offset.x;
    mark.y = step.y + offset.y;
    mark.z = step.z + offset.z;
    mark.fx = fwd.x;
    mark.fz = fwd.z;
    // Mirrored for the left foot, so one picture draws both and each keeps its own inner edge.
    mark.sx = left ? -side.x : side.x;
    mark.sz = left ? -side.z : side.z;
    mark.nx = ground.nx;
    mark.ny = ground.ny;
    mark.nz = ground.nz;
    mark.owner = ground.owner;
    mark.length = t.length * scale;
    mark.width = t.width * scale;
    mark.life = lifeFor(t.life, depth, t.strengthLife);
    mark.strength = depth;
    mark.left = left;
    mark.surface = step.surface ?? '';
    this.note(step.label, mark);
    const sink = this.sink;
    if (!sink) {
      this.counts.noSink++;
      return;
    }
    sink(mark);
    this.counts.laid++;
  }

  /** The planet is going: every body's feet forgotten, so nothing carries a stride across a world. */
  leave(): void {
    this.feet.clear();
    this.log.length = 0;
  }

  /** For `__debug.footprints()`: the counts, the numbers and the last few prints. */
  status(): Record<string, unknown> {
    return {
      drawn: !!this.sink,
      bodies: this.feet.size,
      counts: { ...this.counts },
      tune: { ...this.tune },
      // Which ground keeps a print, since that is the first thing asked when one does not show.
      surfaces: { ...PRINT_SURFACES },
      recent: this.log.slice(-12),
    };
  }

  /** How many bodies' feet are remembered, for the report and the test. */
  get feetCount(): number {
    return this.feet.size;
  }

  private trackFor(key: number): Feet {
    const known = this.feet.get(key);
    if (known) {
      known.seen = this.counts.steps;
      return known;
    }
    // Marked as seen now, before anything is dropped: the body being met this very step is the one
    // thing the prune must never choose.
    const feet: Feet = { left: false, x: 0, z: 0, laid: false, seen: this.counts.steps };
    this.feet.set(key, feet);
    if (this.feet.size > this.tune.bodies) this.prune();
    return feet;
  }

  /**
   * The bodies seen longest ago are dropped when there are too many, down to half the cap: a valley
   * of wildlife walked through all evening otherwise keeps a record apiece for ever. All a dropped
   * body loses is which foot it had last put down.
   */
  private prune(): void {
    const keep = Math.max(1, Math.floor(this.tune.bodies / 2));
    while (this.feet.size > keep) {
      let oldestKey = 0;
      let oldest = Infinity;
      for (const [key, feet] of this.feet) {
        if (feet.seen >= oldest) continue;
        oldest = feet.seen;
        oldestKey = key;
      }
      if (!this.feet.delete(oldestKey)) return;
    }
  }

  private note(body: string, m: PrintMark): void {
    if (this.log.length >= 12) this.log.shift();
    // Rounded with arithmetic rather than `toFixed`, which would make a string per step to throw away.
    this.log.push({
      body,
      surface: m.surface,
      foot: m.left ? 'l' : 'r',
      x: Math.round(m.x * 100) / 100,
      z: Math.round(m.z * 100) / 100,
      strength: m.strength,
      slope: Math.round(Math.acos(clamp(m.ny, -1, 1)) * (180 / Math.PI)),
      owner: m.owner,
      life: Math.round(m.life * 10) / 10,
    });
  }
}

/** The one of these the game has. */
export const footprints = new Footprints();
