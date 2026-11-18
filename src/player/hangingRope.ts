// Climbing II, phase 4: a rope hanging from an anchor (the owner's "rope climbing and swinging", 2026-11-16), under
// `climb.ropes` 'on'. A rope is no collider at all, so nothing walks on it and nothing is stopped by it: it is its anchor, its
// length (`climb.ropeLength`, live, unless it was stood with one of its own), its own free swing from the anchor when nobody
// holds it, and the points the grappling hook's ribbon is laid along (src/player/grappleDraw.ts's `RopeRibbon`, in the hook's
// own layout: the anchor, then a bend at the hands while a body holds it, and the free span on to its end), measured with the
// hook's own arithmetic (src/player/grappleMath.ts). A body on it (src/player/ropeSwing.ts) swings it as a pendulum from the
// anchor at the body's place along it; let go, the rope swings on by itself from where the body left it, and dies away.
//
// The test course's `rope` piece is a still column of its own (src/anim/climbCourse.ts): stood under 'on', that column is a
// rope from the top of it (`courseRopes`), its collider and its drawn column switched off while ropes are on and back on while
// they are off, live (`sync`), so 'off' is the course of before to the collider.
//
// Pure: no three.js, no engine (the column's collider and mesh are handed in as the little they are asked), so node runs it.

import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { len3 } from './grappleMath.ts';

/** How far a free rope's swing dies away a second (a mechanic: a rope let go settles in a few swings). */
export const ROPE_FREE_DAMP = 0.3;
/** The physics' own step, the free swing's (`FIXED_DT`; climbRopes.test.ts holds the two equal). */
export const ROPE_STEP = 1 / 60;
/** Most steps a free rope takes in one frame (a backstop for a frame held long: a hidden tab come back). */
const FREE_MOST = 8;

/** What the course's column is to a rope: its collider, switched (rapier's `Collider.setEnabled`). */
export interface RopeColumn {
  setEnabled(enabled: boolean): void;
}

/** What draws a rope: the hook's ribbon (the game hands one in; the harness none). */
export interface RopeDrawn {
  hide(): void;
}

/** One rope hanging from its anchor. */
export class HangingRope {
  /** The anchor, the world's frame. */
  ax = 0.5;
  ay = 0.5;
  az = 0.5;
  /** Its own length, metres; NaN: `climb.ropeLength`, read live. */
  own = 0.5;
  /** A name for the console (the course's piece, the console's stand). */
  readonly name: string;
  /** Its swing's plane (level, unit), angle (radians from straight down, positive along the plane) and speed. */
  fx = 0.5;
  fz = 0.5;
  th = 0.5;
  om = 0.5;
  /** How far it is stretched now, metres (a body on it: the give). */
  e = 0.5;
  /** A body holds it (src/player/ropeSwing.ts writes its swing here every frame), and where the hands are along it from the anchor. */
  held = false;
  gripS = 0.5;
  /**
   * The hook's points (anchor, then the hands while held), three numbers each, and how many; the free span's end. Laid by
   * `lay` from the swing's angle at the frame's own time (`thDraw`).
   */
  readonly pts = new Float64Array(6);
  count = 1;
  endX = 0.5;
  endY = 0.5;
  endZ = 0.5;
  /** The angle the rope is drawn at (the steps' state led to the frame's own time). */
  thDraw = 0.5;
  /** The free swing's clock past its last step, seconds; and the frame's time its caller writes before `stepFree` (a field: no number crosses the call). */
  private acc = 0.5;
  dt = 0.5;
  /** The column standing in for it under 'off' (the course's), its drawn column, and whether both are on now. */
  column: RopeColumn | null = null;
  columnMesh: { visible: boolean } | null = null;
  private columnOn = true;
  /** What draws it (the game's), null in the harness. */
  drawn: RopeDrawn | null = null;

  constructor(name: string, ax: number, ay: number, az: number, length = Number.NaN) {
    this.name = name;
    this.ax = ax;
    this.ay = ay;
    this.az = az;
    this.own = length;
    this.fx = 0;
    this.fz = 1;
    this.th = 0;
    this.om = 0;
    this.e = 0;
    this.gripS = 0;
    this.endX = ax;
    this.endY = ay;
    this.endZ = az;
    this.thDraw = 0;
    this.acc = 0;
    this.dt = 0;
    this.lay();
  }

  /** Its length now, metres (its own, else the slider's). */
  get len(): number {
    return this.own === this.own ? this.own : CLIMB_TUNE.ropeLength;
  }

  /** The column on while ropes are off and off while they are on (the course's), written only when that moves. */
  sync(): void {
    const on = CLIMB_TUNE.ropes !== 'on';
    if (on === this.columnOn) return;
    this.columnOn = on;
    if (this.column) this.column.setEnabled(on);
    if (this.columnMesh) this.columnMesh.visible = on;
  }

  /** Whether its column stands now (the console's and the tests' word). */
  get columnStands(): boolean {
    return this.columnOn;
  }

  /**
   * Its own swing when nobody holds it, on whole steps of the physics' own (`ROPE_STEP`, a clock of its own so it swings alike at
   * every frame rate): a pendulum of a hanging rope's own reach (two thirds of its length, a rod's), dying away by
   * `ROPE_FREE_DAMP` under the swing's gravity, its stretch let back.
   */
  stepFree(): void {
    if (this.held) return;
    this.acc += this.dt;
    let n = 0;
    while (this.acc >= ROPE_STEP && n < FREE_MOST) {
      this.acc -= ROPE_STEP;
      n++;
      const g = CLIMB_TUNE.swingGravity;
      const r = Math.max(0.3, (2 * this.len) / 3);
      this.om += (-(g / r) * Math.sin(this.th) - ROPE_FREE_DAMP * this.om) * ROPE_STEP;
      this.th += this.om * ROPE_STEP;
      this.e *= 0.9;
    }
    if (n >= FREE_MOST) this.acc = 0;
    this.thDraw = this.th + this.om * this.acc;
    this.lay();
  }

  /**
   * The hook's points for the swing drawn now: the anchor, the hands at `gripS` (plus the stretch's share) while held, and the
   * end on along the same line (a rope hangs straight: the hook's ribbon's free span with no slack). Writes kept fields only.
   */
  lay(): void {
    const s = Math.sin(this.thDraw);
    const c = Math.cos(this.thDraw);
    const ux = s * this.fx;
    const uy = -c;
    const uz = s * this.fz;
    const P = this.pts;
    P[0] = this.ax;
    P[1] = this.ay;
    P[2] = this.az;
    const L = this.len + this.e;
    if (this.held) {
      const g = this.gripS + this.e;
      P[3] = this.ax + ux * g;
      P[4] = this.ay + uy * g;
      P[5] = this.az + uz * g;
      this.count = 2;
    } else this.count = 1;
    this.endX = this.ax + ux * L;
    this.endY = this.ay + uy * L;
    this.endZ = this.az + uz * L;
  }

  /** How long it is drawn now, anchor to end (the hook's own length arithmetic): its length and the stretch. */
  drawnLength(): number {
    return len3(this.endX - this.ax, this.endY - this.ay, this.endZ - this.az);
  }
}

/** A solid of the course the rope reads (a box: its middle and half sizes, its role). */
interface RopeSolidBox {
  kind: 'box' | 'prism';
  role: string;
  mid?: [number, number, number];
  half?: [number, number, number];
}

/**
 * The course's ropes (`climb.ropes` 'on': the `rope` piece's still column made a rope): each of a piece's `rope` solids a rope
 * hanging from the column's top middle (the beam's underside) in the world, its column's collider handed in so `sync` switches
 * it, the length the slider's. `toWorld` carries a piece's point into the world (src/anim/climbCourseBuild.ts's
 * `courseToWorld`); `colliderOf` the collider the builder made for a piece's solid of that role (null for none).
 */
export function courseRopes(
  pieces: readonly { id: string; solids: readonly RopeSolidBox[] }[],
  toWorld: (piece: number, x: number, y: number, z: number, out: { x: number; y: number; z: number }) => void,
  colliderOf: (pieceId: string, role: string) => RopeColumn | null,
): HangingRope[] {
  const out: HangingRope[] = [];
  const w = { x: 0, y: 0, z: 0 };
  pieces.forEach((p, i) => {
    for (const s of p.solids) {
      if (s.role !== 'rope' || s.kind !== 'box' || !s.mid || !s.half) continue;
      toWorld(i, s.mid[0], s.mid[1] + s.half[1], s.mid[2], w);
      const r = new HangingRope(`the course's rope (${p.id})`, w.x, w.y, w.z);
      r.column = colliderOf(p.id, 'rope');
      out.push(r);
    }
  });
  for (const r of out) r.sync();
  return out;
}
