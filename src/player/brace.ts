// The hands bracing (wave 4 of the animations, item B; the owner's brief's line 19: "if I press my body fully against a
// wall while running, a left/right hand will brace against it - same with if I'm going between a tight spot or through
// crowds, or if I'm floating in space I press my hands against a surface if I'm close and 'walk' with them").
//
// One `HandBrace` a figure (the player's, and each other player's within `ik.peerReach`), stepped after the figure is
// posed, placed and its feet put down; what it decides is handed to the figure's one limbs' solve
// (src/player/limbPlace.ts: `setHand`, and the palm turned flat against what it rests on), which puts it back before the
// mixer runs again. Each hand on its own:
//  - against a wall: moving into a face steeper than the climb limit (by at least `brace.press` of the move), within a
//    hand's reach (`brace.reach`) of the shoulders, the hand on that side rests its palm on the face, weighted by how near
//    the face is and how hard the body moves into it; head on into a wall, both hands;
//  - in a tight spot: a passage narrower than `brace.tight` at the shoulders, moving: both hands touch its sides;
//  - in a crowd (`brace.people`): another player, or one of the world's people or creatures (never one fighting the
//    player: the caller leaves those out), within reach at the shoulders, moving: the hand on their side rests on the
//    nearest point of their body's capsule;
//  - in space (drifting on foot): a surface within `brace.spaceReach` of the chest, both hands reach to it and step hand
//    over hand as the body drifts past, each keeping its hold until it would overreach. Visual only: the drift is the
//    drift (pulling oneself along would be a rule of play, a question for the owner).
// A hand holding something never braces (the other may); none while fighting, aiming, swinging, emoting, hanging or
// climbing, riding, swimming or lying (the caller's `busy`), nor the hand holding the grappling rope. Every share eased in
// and out over `brace.ease` by the frame's own seconds, so alike at 30, 60 and 144 frames a second; a hand changing what it
// rests on lets go of the first before it reaches for the next.
//
// The rays: none standing still with nothing pushing (a figure at rest casts nothing); moving on foot, three at the
// shoulders (ahead and seventy degrees either side), every frame while a face was felt at the last look or the move is cut
// short against something, and otherwise once every `WALL_LOOK` seconds (a walk in the open asks nothing on most frames:
// the fix round's); drifting in space, one along the surface's normal while it is known
// and six (the body's six ways) every `SPACE_LOOK` seconds while none is. Nothing here makes an object on a frame: every
// ask and answer is a kept record, and the engine's own answers are the only things made, counted in `casts`.

import type { RAPIER } from '../core/physics.ts';
import { STILL_FLAGS } from './stairSense.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { LOCO_TUNE } from '../anim/locoTune.ts';
import { PALM_OFF } from '../anim/wallClips.ts';
import type { LimbPlace } from './limbPlace.ts';

/** The little of a physics world the bracing asks (rapier's `World`). */
export interface BraceWorld {
  castRayAndGetNormal(ray: RAPIER.Ray, maxToi: number, solid: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): RAPIER.RayColliderIntersection | null;
}

/** A frame of the figure as the bracing reads it, written by the caller (fields, so no number crosses a call). */
export class BraceIn {
  dt = 0.5;
  /** The feet's place, the heading (its front (sin h, 0, cos h)) and the figure's size against the human male. */
  x = 0.5;
  y = 0.5;
  z = 0.5;
  heading = 0.5;
  scale = 0.5;
  /** The groups the rays cast in. */
  filter = 0.5;
  /** The body's velocity, and the move keys' way in the world (level, unit, or nought for none). */
  vx = 0.5;
  vy = 0.5;
  vz = 0.5;
  moveX = 0.5;
  moveZ = 0.5;
  /** Each hand holds nothing and no rope. */
  freeL = true;
  freeR = true;
  /** Fighting, aiming, swinging, emoting, hanging, climbing, riding, swimming, lying, dead: nothing braces. */
  busy = false;
  /** Standing on its feet (the wall, the passage and the crowd), or drifting in space (the space's). */
  onFeet = false;
  space = false;
  /** The frame's move was cut short across the ground by something in its way (the player's `wallBlocked`): a face is there to feel for at once. */
  blocked = false;
  /** Drifting in space: the body's own up and front (its frame turns freely). */
  ux = 0.5;
  uy = 0.5;
  uz = 0.5;
  fx = 0.5;
  fy = 0.5;
  fz = 0.5;
  constructor() {
    this.dt = 0;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.heading = 0;
    this.scale = 1;
    this.filter = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.moveX = 0;
    this.moveZ = 0;
    this.ux = 0;
    this.uy = 1;
    this.uz = 0;
    this.fx = 0;
    this.fy = 0;
    this.fz = 1;
  }
}

/** The most bodies a crowd is felt among in a frame (the nearest kept). */
export const CROWD_MOST = 8;

/**
 * The people near enough to brace on, as upright capsules (the caller fills it a frame: their axis's foot and top, and
 * their radius), never one fighting the figure.
 */
export class Crowd {
  count = 0;
  readonly x = new Float64Array(CROWD_MOST);
  readonly z = new Float64Array(CROWD_MOST);
  readonly y0 = new Float64Array(CROWD_MOST);
  readonly y1 = new Float64Array(CROWD_MOST);
  readonly r = new Float64Array(CROWD_MOST);
  /** A body, if room is left, kept by nearness to (cx, cz) within `reach` (level): the nearest `CROWD_MOST`. */
  add(cx: number, cz: number, x: number, z: number, y0: number, y1: number, r: number, reach: number): void {
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (!(d2 <= reach * reach)) return;
    let at = this.count;
    if (at >= CROWD_MOST) {
      // The farthest kept goes if this one is nearer.
      let far = -1;
      let farD = d2;
      for (let k = 0; k < CROWD_MOST; k++) {
        const ex = this.x[k] - cx;
        const ez = this.z[k] - cz;
        const e2 = ex * ex + ez * ez;
        if (e2 > farD) {
          farD = e2;
          far = k;
        }
      }
      if (far < 0) return;
      at = far;
    } else this.count++;
    this.x[at] = x;
    this.z[at] = z;
    this.y0[at] = y0;
    this.y1[at] = y1;
    this.r[at] = r;
  }
}

/** What a hand rests on. */
export const BRACE_NONE = 0;
export const BRACE_WALL = 1;
export const BRACE_TIGHT = 2;
export const BRACE_PERSON = 3;
export const BRACE_SPACE = 4;
const SOURCE_NAMES = ['none', 'wall', 'tight', 'person', 'space'];

/** The shoulder's own way out from the body's middle line, metres on the human male (his shoulder joint's). */
const SHOULDER_OUT = 0.19;
/** The capsule's radius: a face no nearer than this is the body against it. */
const BODY_R = 0.35;
/** The side rays' angle off ahead, radians: seventy degrees, which meets a wall alongside within reach as well as one ahead of a shoulder. */
const SIDE_ANGLE = (70 * Math.PI) / 180;
/** Head on: a face ahead turned toward the body within this of square (its cosine) takes both hands. */
const HEAD_ON = Math.cos((30 * Math.PI) / 180);
/** A tight spot's touch: the palms held this much further off its sides than a flat palm, metres on the human male (lightly). */
const LIGHT = 0.015;
/** Drifting in space with no surface known, the six ways are felt along every this many seconds. */
const SPACE_LOOK = 0.2;
/**
 * On foot with no face felt at the last look and the move not cut short, the shoulders' three rays are cast every this many
 * seconds rather than every frame (ours, the fix round's: a walk in the open asks nothing on most frames; a face found is
 * felt for every frame while it stays, and a move pressed against one looks at once).
 */
export const WALL_LOOK = 0.25;
/** How far ahead along the drift a space hold is put down, metres on the human male (a reach forward, then the body drifts past it). */
const SPACE_LEAD = 0.3;

export class HandBrace {
  /** Each hand's share (left 0, right 1), eased, and its target and the face's outward normal there (left 0..2, right 3..5). */
  readonly w = new Float64Array(2);
  readonly at = new Float64Array(6);
  readonly n = new Float64Array(6);
  /** What each hand rests on (`BRACE_*`), and what it would rest on this frame. */
  readonly src = new Int8Array(2);
  /** Rays asked of the engine (the console's and the tests'), and the steps hand over hand in space. */
  casts = 0;
  steps = 0;
  private ray: RAPIER.Ray | null = null;
  private readonly makeRay: () => RAPIER.Ray;
  /** Each hand's goal this frame: its share, target, normal and source. */
  private readonly gw = new Float64Array(2);
  private readonly gat = new Float64Array(6);
  private readonly gn = new Float64Array(6);
  private readonly gsrc = new Int8Array(2);
  /** The three shoulder rays' answers: hit, point, normal, how far along (ahead 0, left 1, right 2). */
  private readonly rh = new Float64Array(21);
  /** The probe (fields, so nothing crosses a call). */
  private qx = 0.5;
  private qy = 0.5;
  private qz = 0.5;
  private qdx = 0.5;
  private qdy = 0.5;
  private qdz = 0.5;
  private qlen = 0.5;
  private qflt = 0.5;
  private hx = 0.5;
  private hy = 0.5;
  private hz = 0.5;
  private hnx = 0.5;
  private hny = 0.5;
  private hnz = 0.5;
  private htoi = 0.5;
  /** Space: the surface known (a point and its outward normal), whether one is, the clock to the next look, each hand's hold. */
  private readonly sp = new Float64Array(6);
  private spOk = false;
  private spLook = 0.5;
  private readonly hold = new Float64Array(6);
  private readonly holdOk = [false, false];
  /** On foot: a face was felt at the last look, and the seconds to the next look while none was (`WALL_LOOK`). */
  private felt = false;
  private wallLook = 0.5;

  constructor(makeRay: () => RAPIER.Ray) {
    this.makeRay = makeRay;
    this.qx = 0;
    this.qy = 0;
    this.qz = 0;
    this.qdx = 0;
    this.qdy = 0;
    this.qdz = 0;
    this.qlen = 0;
    this.qflt = 0;
    this.hx = 0;
    this.hy = 0;
    this.hz = 0;
    this.hnx = 0;
    this.hny = 0;
    this.hnz = 0;
    this.htoi = 0;
    this.spLook = 0;
    this.wallLook = 0;
    this.dtNow = 0;
    this.pmx = 0;
    this.pmz = 0;
    this.pressV = 0;
    this.nearV = 0;
    this.aExtra = 0;
    this.aW = 0;
    this.cHy = 0;
    this.cReach = 0;
  }

  /** A hand still reaching or coming back (the limbs' solve is asked). */
  get busy(): boolean {
    return this.w[0] > 0 || this.w[1] > 0;
  }

  /** Everything let go at once (stood somewhere new, the switch thrown). */
  reset(): void {
    this.w[0] = 0;
    this.w[1] = 0;
    this.src[0] = BRACE_NONE;
    this.src[1] = BRACE_NONE;
    this.spOk = false;
    this.spLook = 0;
    this.holdOk[0] = false;
    this.holdOk[1] = false;
    this.felt = false;
    this.wallLook = 0;
  }

  /** One ray from (q) along (qd) for `qlen` into `h*` (the still family only). */
  private cast(world: BraceWorld): boolean {
    let ray = this.ray;
    if (!ray) ray = this.ray = this.makeRay();
    ray.origin.x = this.qx;
    ray.origin.y = this.qy;
    ray.origin.z = this.qz;
    ray.dir.x = this.qdx;
    ray.dir.y = this.qdy;
    ray.dir.z = this.qdz;
    this.casts++;
    const h = world.castRayAndGetNormal(ray, this.qlen, true, STILL_FLAGS, this.qflt);
    if (!h) return false;
    const t = h.timeOfImpact;
    this.htoi = t;
    this.hx = this.qx + this.qdx * t;
    this.hy = this.qy + this.qdy * t;
    this.hz = this.qz + this.qdz * t;
    this.hnx = h.normal.x;
    this.hny = h.normal.y;
    this.hnz = h.normal.z;
    return true;
  }

  /**
   * One frame: what each hand would rest on, and the shares eased toward it. `crowd` the bodies near (null or empty for
   * none). Under `brace.rule` 'before' nothing is felt for and every share is nought at once (the wave 3 commit's arms).
   */
  step(world: BraceWorld | null, i: BraceIn, crowd: Crowd | null): void {
    const T = CLIMB_TUNE.brace;
    const g = this.gw;
    g[0] = 0;
    g[1] = 0;
    this.gsrc[0] = BRACE_NONE;
    this.gsrc[1] = BRACE_NONE;
    if (T.rule !== 'on') {
      this.reset();
      return;
    }
    if (world && !i.busy && (i.freeL || i.freeR)) {
      if (i.space) this.feelSpace(world, i);
      else if (i.onFeet) this.feelFeet(world, i, crowd);
    }
    if (!i.space) {
      this.holdOk[0] = false;
      this.holdOk[1] = false;
    }
    if (!i.freeL) g[0] = 0;
    if (!i.freeR) g[1] = 0;
    this.dtNow = i.dt;
    this.ease();
  }

  /** On foot: the walls ahead and either side, a tight passage, the crowd. */
  private feelFeet(world: BraceWorld, i: BraceIn, crowd: Crowd | null): void {
    const T = CLIMB_TUNE.brace;
    const s = i.scale;
    const sh = Math.sin(i.heading);
    const ch = Math.cos(i.heading);
    // The way the body goes: the keys' way, else its own travel while it moves.
    const speed = Math.sqrt(i.vx * i.vx + i.vz * i.vz);
    let mx = i.moveX;
    let mz = i.moveZ;
    let ml = Math.sqrt(mx * mx + mz * mz);
    if (!(ml > 1e-6) && speed > T.moving) {
      mx = i.vx;
      mz = i.vz;
      ml = speed;
    }
    if (!(ml > 1e-6)) return;
    mx /= ml;
    mz /= ml;
    const moving = speed > T.moving;
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    const reach = T.reach * s;
    const hy = i.y + T.height * s;
    // Three rays from the middle line at the shoulders' height: ahead, and seventy degrees either side. Only where a face may
    // be near: every frame while one was felt at the last look or the move is cut short, else every `WALL_LOOK` seconds.
    const rh = this.rh;
    this.qflt = i.filter;
    const look = this.felt || i.blocked || this.wallLook <= 0;
    if (look) this.wallLook = WALL_LOOK;
    else {
      this.wallLook -= i.dt;
      rh[0] = 0;
      rh[7] = 0;
      rh[14] = 0;
    }
    for (let k = 0; k < 3 && look; k++) {
      const a = k === 0 ? 0 : k === 1 ? SIDE_ANGLE : -SIDE_ANGLE;
      // The front turned by a (toward the left for a positive turn: the left is (cos h, -sin h)).
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      this.qx = i.x;
      this.qy = hy;
      this.qz = i.z;
      this.qdx = sh * ca + ch * sa;
      this.qdy = 0;
      this.qdz = ch * ca - sh * sa;
      this.qlen = reach + SHOULDER_OUT * s;
      const o = k * 7;
      const hit = this.cast(world) && this.hny < walk && this.hny > -walk;
      rh[o] = hit ? 1 : 0;
      if (!hit) continue;
      rh[o + 1] = this.hx;
      rh[o + 2] = this.hy;
      rh[o + 3] = this.hz;
      const nl = Math.sqrt(this.hnx * this.hnx + this.hnz * this.hnz);
      rh[o + 4] = this.hnx / nl;
      rh[o + 5] = 0;
      rh[o + 6] = this.hnz / nl;
    }
    if (look) this.felt = rh[0] !== 0 || rh[7] !== 0 || rh[14] !== 0;
    // A tight passage: a face either side, their distances from the middle line summed under `brace.tight`, moving.
    if (moving && rh[7] && rh[14]) {
      const dl = (i.x - rh[8]) * rh[11] + (i.z - rh[10]) * rh[13];
      const dr = (i.x - rh[15]) * rh[18] + (i.z - rh[17]) * rh[20];
      if (dl > 0 && dr > 0 && dl + dr < T.tight * s) {
        this.aExtra = LIGHT * s;
        this.aW = 1;
        this.aimWall(0, 7, i, BRACE_TIGHT);
        this.aimWall(1, 14, i, BRACE_TIGHT);
        return;
      }
    }
    // Head on into a face ahead: both hands, by how hard the body goes into it.
    if (rh[0]) {
      const nx = rh[4];
      const nz = rh[6];
      if (-(nx * sh + nz * ch) >= HEAD_ON) {
        this.pmx = mx;
        this.pmz = mz;
        this.pressShare(0);
        this.nearShare(i, 0);
        const w = this.pressV * this.nearV;
        if (w > 0) {
          this.aExtra = 0;
          this.aW = w;
          this.aimWall(0, 0, i, BRACE_WALL);
          this.aimWall(1, 0, i, BRACE_WALL);
          return;
        }
      }
    }
    // A face on a side (that side's ray, else the one ahead where it lies to that side), the hand on that side.
    for (let side = 0; side < 2; side++) {
      const o = side === 0 ? 7 : 14;
      let use = rh[o] ? o : -1;
      if (use < 0 && rh[0]) {
        // The face ahead on this side of the front (its normal pointing back toward that side's shoulder).
        const lx = ch;
        const lz = -sh;
        const toward = (rh[4] * lx + rh[6] * lz) * (side === 0 ? -1 : 1);
        if (toward > 0.2) use = 0;
      }
      if (use < 0) continue;
      this.pmx = mx;
      this.pmz = mz;
      this.pressShare(use);
      this.nearShare(i, use);
      const w = this.pressV * this.nearV;
      if (w > this.gw[side]) {
        this.aExtra = 0;
        this.aW = w;
        this.aimWall(side, use, i, BRACE_WALL);
      }
    }
    // The crowd: the nearest body each side within reach at the shoulders, moving.
    if (moving && crowd && crowd.count > 0 && T.people === 'on') {
      this.cHy = hy;
      this.cReach = reach;
      this.feelCrowd(i, crowd);
    }
  }

  /**
   * How hard the body goes into the face of ray `o` (its level normal): its move's share (`pmx`, `pmz`) pointed into it past
   * `brace.press`, 0 to 1, into `pressV`. (Every number of these helpers goes in and out through fields: a number handed
   * across a call the compiler leaves out is a number made.)
   */
  private pressShare(o: number): void {
    const rh = this.rh;
    const p = -(this.pmx * rh[o + 4] + this.pmz * rh[o + 6]);
    const lo = CLIMB_TUNE.brace.press;
    if (!(p > lo)) this.pressV = 0;
    else this.pressV = lo < 1 ? Math.min(1, (p - lo) / (1 - lo)) : 1;
  }

  /** How near a ray's face is to the middle line: wholly within the capsule's skin and a hand's width, nought at a hand's reach. */
  private nearShare(i: BraceIn, o: number): void {
    const rh = this.rh;
    const s = i.scale;
    const d = (i.x - rh[o + 1]) * rh[o + 4] + (i.z - rh[o + 3]) * rh[o + 6];
    const full = (BODY_R + 0.1) * s;
    const end = CLIMB_TUNE.brace.reach * s + SHOULDER_OUT * s;
    if (d <= full) this.nearV = 1;
    else if (d >= end) this.nearV = 0;
    else this.nearV = 1 - (d - full) / (end - full);
  }

  /**
   * A hand's goal on a ray's face: the face's point nearest that hand's shoulder (its place out from the middle line at the
   * shoulders' height), its palm `PALM_OFF` (and `aExtra`) off it, its share `aW`.
   */
  private aimWall(side: number, o: number, i: BraceIn, src: number): void {
    const extra = this.aExtra;
    const w = this.aW;
    const rh = this.rh;
    const s = i.scale;
    const sh = Math.sin(i.heading);
    const ch = Math.cos(i.heading);
    const k = (side === 0 ? 1 : -1) * SHOULDER_OUT * s;
    const sx = i.x + ch * k;
    const sy = i.y + CLIMB_TUNE.brace.height * s;
    const sz = i.z - sh * k;
    const nx = rh[o + 4];
    const nz = rh[o + 6];
    const d = (sx - rh[o + 1]) * nx + (sz - rh[o + 3]) * nz;
    const off = PALM_OFF * s + extra;
    const a = side * 3;
    this.gat[a] = sx - nx * (d - off);
    this.gat[a + 1] = sy;
    this.gat[a + 2] = sz - nz * (d - off);
    this.gn[a] = nx;
    this.gn[a + 1] = 0;
    this.gn[a + 2] = nz;
    this.gw[side] = w;
    this.gsrc[side] = src;
  }

  /** The crowd: each side, the nearest body whose capsule spans the shoulders' height within reach on that side. */
  private feelCrowd(i: BraceIn, crowd: Crowd): void {
    const hy = this.cHy;
    const reach = this.cReach;
    const s = i.scale;
    const sh = Math.sin(i.heading);
    const ch = Math.cos(i.heading);
    for (let side = 0; side < 2; side++) {
      if (this.gw[side] >= 1) continue;
      const k = (side === 0 ? 1 : -1) * SHOULDER_OUT * s;
      const sx = i.x + ch * k;
      const sz = i.z - sh * k;
      let best = -1;
      let bestD = reach;
      for (let c = 0; c < crowd.count; c++) {
        if (!(hy >= crowd.y0[c] && hy <= crowd.y1[c])) continue;
        const dx = crowd.x[c] - sx;
        const dz = crowd.z[c] - sz;
        // On this side of the figure (its left is (cos h, -sin h)).
        const lat = (dx * ch - dz * sh) * (side === 0 ? 1 : -1);
        if (!(lat > 0)) continue;
        const d = Math.sqrt(dx * dx + dz * dz) - crowd.r[c];
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best < 0) continue;
      const near = bestD <= 0.1 * s ? 1 : 1 - (bestD - 0.1 * s) / (reach - 0.1 * s);
      if (!(near > this.gw[side])) continue;
      const dx = sx - crowd.x[best];
      const dz = sz - crowd.z[best];
      const dl = Math.sqrt(dx * dx + dz * dz);
      if (!(dl > 1e-6)) continue;
      const nx = dx / dl;
      const nz = dz / dl;
      const r = crowd.r[best] + PALM_OFF * s;
      const a = side * 3;
      this.gat[a] = crowd.x[best] + nx * r;
      this.gat[a + 1] = hy;
      this.gat[a + 2] = crowd.z[best] + nz * r;
      this.gn[a] = nx;
      this.gn[a + 1] = 0;
      this.gn[a + 2] = nz;
      this.gw[side] = near;
      this.gsrc[side] = BRACE_PERSON;
    }
  }

  /**
   * Drifting in space: the surface near the chest (kept and felt for along its own normal, one ray; while none is known,
   * the body's six ways every `SPACE_LOOK` seconds), and each hand's hold on it, kept until it would overreach, then put
   * down again ahead along the drift (one hand at a time: hand over hand).
   */
  private feelSpace(world: BraceWorld, i: BraceIn): void {
    const T = CLIMB_TUNE.brace;
    const s = i.scale;
    const cx = i.x + i.ux * 1.0 * s;
    const cy = i.y + i.uy * 1.0 * s;
    const cz = i.z + i.uz * 1.0 * s;
    const sp = this.sp;
    const range = T.spaceReach * s;
    this.qflt = i.filter;
    this.qx = cx;
    this.qy = cy;
    this.qz = cz;
    this.qlen = range;
    let found = false;
    if (this.spOk) {
      this.qdx = -sp[3];
      this.qdy = -sp[4];
      this.qdz = -sp[5];
      found = this.cast(world);
    } else {
      this.spLook -= i.dt;
      if (this.spLook > 0) return;
      this.spLook = SPACE_LOOK;
      // The body's six ways: down, ahead, left, right, behind, up (its left is up crossed with ahead).
      const lx = i.uy * i.fz - i.uz * i.fy;
      const ly = i.uz * i.fx - i.ux * i.fz;
      const lz = i.ux * i.fy - i.uy * i.fx;
      let bestT = Number.POSITIVE_INFINITY;
      for (let k = 0; k < 6; k++) {
        const sg = k & 1 ? -1 : 1;
        const axis = k >> 1;
        this.qdx = (axis === 0 ? -i.ux : axis === 1 ? i.fx : lx) * sg;
        this.qdy = (axis === 0 ? -i.uy : axis === 1 ? i.fy : ly) * sg;
        this.qdz = (axis === 0 ? -i.uz : axis === 1 ? i.fz : lz) * sg;
        if (this.cast(world) && this.htoi < bestT) {
          bestT = this.htoi;
          sp[0] = this.hx;
          sp[1] = this.hy;
          sp[2] = this.hz;
          sp[3] = this.hnx;
          sp[4] = this.hny;
          sp[5] = this.hnz;
          found = true;
        }
      }
      if (found) {
        this.spOk = true;
        return this.spaceHolds(i);
      }
    }
    if (!found) {
      this.spOk = false;
      this.spLook = SPACE_LOOK;
      this.holdOk[0] = false;
      this.holdOk[1] = false;
      return;
    }
    sp[0] = this.hx;
    sp[1] = this.hy;
    sp[2] = this.hz;
    sp[3] = this.hnx;
    sp[4] = this.hny;
    sp[5] = this.hnz;
    this.spaceHolds(i);
  }

  /** Each hand's hold on the known surface: kept within reach of its shoulder, else (one hand a frame) put down again ahead along the drift. */
  private spaceHolds(i: BraceIn): void {
    const s = i.scale;
    const sp = this.sp;
    const reach = CLIMB_TUNE.brace.reach * s + SHOULDER_OUT * s;
    const lx = i.uy * i.fz - i.uz * i.fy;
    const ly = i.uz * i.fx - i.ux * i.fz;
    const lz = i.ux * i.fy - i.uy * i.fx;
    const vl = Math.sqrt(i.vx * i.vx + i.vy * i.vy + i.vz * i.vz);
    const lead = SPACE_LEAD * s;
    let stepped = false;
    for (let side = 0; side < 2; side++) {
      const k = (side === 0 ? 1 : -1) * SHOULDER_OUT * s;
      const sx = i.x + i.ux * 1.3 * s + lx * k;
      const sy = i.y + i.uy * 1.3 * s + ly * k;
      const sz = i.z + i.uz * 1.3 * s + lz * k;
      const a = side * 3;
      const h = this.hold;
      if (this.holdOk[side]) {
        const dx = h[a] - sx;
        const dy = h[a + 1] - sy;
        const dz = h[a + 2] - sz;
        if (dx * dx + dy * dy + dz * dz > reach * reach) this.holdOk[side] = false;
      }
      // One hand puts down a new hold a frame: hand over hand.
      if (!this.holdOk[side] && !stepped) {
        // The point of the surface nearest the shoulder, led ahead along the drift.
        let px = sx;
        let py = sy;
        let pz = sz;
        if (vl > 1e-3) {
          px += (i.vx / vl) * lead;
          py += (i.vy / vl) * lead;
          pz += (i.vz / vl) * lead;
        }
        const d = (px - sp[0]) * sp[3] + (py - sp[1]) * sp[4] + (pz - sp[2]) * sp[5];
        const off = PALM_OFF * s;
        h[a] = px - sp[3] * (d - off);
        h[a + 1] = py - sp[4] * (d - off);
        h[a + 2] = pz - sp[5] * (d - off);
        const ex = h[a] - sx;
        const ey = h[a + 1] - sy;
        const ez = h[a + 2] - sz;
        if (ex * ex + ey * ey + ez * ez <= reach * reach) {
          this.holdOk[side] = true;
          stepped = true;
          this.steps++;
        }
      }
      if (!this.holdOk[side]) continue;
      this.gat[a] = h[a];
      this.gat[a + 1] = h[a + 1];
      this.gat[a + 2] = h[a + 2];
      this.gn[a] = sp[3];
      this.gn[a + 1] = sp[4];
      this.gn[a + 2] = sp[5];
      this.gw[side] = 1;
      this.gsrc[side] = BRACE_SPACE;
    }
  }

  /**
   * Each hand's share eased toward its goal by the frame's seconds over `brace.ease` (alike at every rate). A hand whose goal
   * rests on something else (or, in space, on a new hold) first lets go of what it rests on, its target held where it was,
   * and only once its share is nought takes the new one.
   */
  /** The frame's seconds, a field (a number handed across a call the compiler leaves out is a number made). */
  private dtNow = 0.5;
  /** The helpers' asks and answers (`pressShare`, `nearShare`, `aimWall`, `feelCrowd`). */
  private pmx = 0.5;
  private pmz = 0.5;
  private pressV = 0.5;
  private nearV = 0.5;
  private aExtra = 0.5;
  private aW = 0.5;
  private cHy = 0.5;
  private cReach = 0.5;

  private ease(): void {
    const dt = this.dtNow;
    const e = CLIMB_TUNE.brace.ease;
    const step = e > 0 ? dt / e : 2;
    for (let side = 0; side < 2; side++) {
      const gs = this.gsrc[side];
      const a = side * 3;
      const w = this.w[side];
      const src = this.src[side];
      const differs = gs !== src || (gs === BRACE_SPACE && (this.gat[a] !== this.at[a] || this.gat[a + 1] !== this.at[a + 1] || this.gat[a + 2] !== this.at[a + 2]));
      let goal = 0;
      if (src !== BRACE_NONE && w > 0 && differs) goal = 0;
      else if (gs !== BRACE_NONE) {
        goal = this.gw[side];
        this.src[side] = gs;
        this.at[a] = this.gat[a];
        this.at[a + 1] = this.gat[a + 1];
        this.at[a + 2] = this.gat[a + 2];
        this.n[a] = this.gn[a];
        this.n[a + 1] = this.gn[a + 1];
        this.n[a + 2] = this.gn[a + 2];
      }
      const nw = w < goal ? Math.min(goal, w + step) : Math.max(goal, w - step);
      this.w[side] = nw;
      if (nw === 0 && goal === 0) this.src[side] = BRACE_NONE;
    }
  }
  /** The shares, targets and palms handed to the figure's limbs' solve (its feet on no wall). */
  apply(lp: LimbPlace): void {
    for (let side = 0; side < 2; side++) {
      const a = side * 3;
      const w = this.w[side];
      lp.hand[a] = this.at[a];
      lp.hand[a + 1] = this.at[a + 1];
      lp.hand[a + 2] = this.at[a + 2];
      lp.handW[side] = w;
      lp.palm[a] = this.n[a];
      lp.palm[a + 1] = this.n[a + 1];
      lp.palm[a + 2] = this.n[a + 2];
      lp.palmW[side] = w;
    }
    lp.wallW = 0;
    lp.footFade = false;
  }

  /** What the console says. */
  report(): Record<string, unknown> {
    const n = (v: number) => Math.round(v * 1000) / 1000;
    return {
      rule: CLIMB_TUNE.brace.rule,
      left: { on: SOURCE_NAMES[this.src[0]], share: n(this.w[0]), at: [n(this.at[0]), n(this.at[1]), n(this.at[2])] },
      right: { on: SOURCE_NAMES[this.src[1]], share: n(this.w[1]), at: [n(this.at[3]), n(this.at[4]), n(this.at[5])] },
      space: this.spOk,
      steps: this.steps,
      casts: this.casts,
    };
  }
}
