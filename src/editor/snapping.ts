// The world editor's snapping (DESIGN.md §2.6): a grid for where a thing stands, steps for how it is turned, the ground
// under it, the lean of a surface, and a neighbour's faces.
//
// **The grid is laid in the file's own frame** (raw on a planet, the game's in space): a place is carried into the
// file's frame, snapped there and carried back, so the numbers the file holds come out round and its diff reads, on a
// world whose layout centre is not whole as on one whose is. Only the axes a move moved are snapped, so a thing sitting
// on the ground is not lifted to a grid line by a move along the ground. The grid's steps and the angle's
// (`snap.gridSteps`, `snap.angleSteps`) are stepped through by `[` and `]` (Shift for the angle) and `\` turns the lot off
// and on: there is no held inversion, since no editor key holds Ctrl but the chords.
//
// **To the ground** (End): each thing dropped so its lowest point stands on what is under it (a floor indoors, else the
// terrain, else what stands), and with Shift its up leaned toward the surface's by at most `snap.normalMaxDeg`.
// **To a neighbour** (V held during a drag): the moving selection's box faces taken flush to the nearest neighbour's within
// `snap.neighbourPx` (in metres at that distance), from the models' own boxes, so no mesh is read; flush only between
// boxes turned alike (to a quarter turn), whose boxes are their own.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

import { gameToRawX, gameToRawZ, rawToGameX, rawToGameZ } from '../story/waypoints.ts';

/** A value on a grid of `step`: the nearest line. A step of nought or less is no grid. */
export function snapValue(v: number, step: number): number {
  if (!(step > 0)) return v;
  const k = Math.round(v / step);
  // Rounded to as many decimals as the step has, so 0.1 × 3 is written 0.3 and not 0.30000000000000004.
  let p = 1;
  for (let d = 0; d < 9 && Math.abs(step * p - Math.round(step * p)) > 1e-9 * p; d++) p *= 10;
  return Math.round(k * step * p) / p;
}

const ORIGIN = { x: 0, z: 0 };

/** Which of a place's axes a move moved, so only those are snapped. */
export interface MovedAxes {
  x: boolean;
  y: boolean;
  z: boolean;
}

/**
 * A place of the game's frame snapped to the grid **in the file's frame**, written into `out`: carried into the file's
 * frame about `centre` (`raw`: the layout's mirror, `x = cx - gx`, `z = gz + cz`; `game`: as it stands), each moved axis
 * put on its nearest line of `step`, and carried back. `y` is absolute in both frames.
 */
export function snapPlace(g: { x: number; y: number; z: number }, moved: MovedAxes, step: number, centre: { x: number; z: number } | null, frame: 'raw' | 'game', out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const c = centre ?? ORIGIN;
  const raw = frame === 'raw';
  const fx = raw ? gameToRawX(c.x, g.x) : g.x;
  const fz = raw ? gameToRawZ(c.z, g.z) : g.z;
  const sx = moved.x ? snapValue(fx, step) : fx;
  const sz = moved.z ? snapValue(fz, step) : fz;
  out.x = moved.x ? (raw ? rawToGameX(c.x, sx) : sx) : g.x;
  out.z = moved.z ? (raw ? rawToGameZ(c.z, sz) : sz) : g.z;
  out.y = moved.y ? snapValue(g.y, step) : g.y;
  return out;
}

/** A yaw (radians) on a grid of `stepDeg` degrees. */
export function snapAngle(yaw: number, stepDeg: number): number {
  if (!(stepDeg > 0)) return yaw;
  const step = (stepDeg * Math.PI) / 180;
  return Math.round(yaw / step) * step;
}

/**
 * The next of a list of steps from `now`, `dir` +1 coarser or -1 finer, held at the list's ends; a value not in the list
 * goes to the nearest step the way asked.
 */
export function stepThrough(list: readonly number[], now: number, dir: number): number {
  if (!list.length) return now;
  const sorted = [...list].sort((a, b) => a - b);
  if (dir > 0) {
    for (const s of sorted) if (s > now + 1e-9) return s;
    return sorted[sorted.length - 1];
  }
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i] < now - 1e-9) return sorted[i];
  return sorted[0];
}

/**
 * The world axis a camera-relative nudge goes along (the arrows: forward, back, left and right of the camera, laid on
 * the world axis nearest the way asked, so a nudge is one grid step along a grid line), written into `out` as a unit
 * vector of the game's frame. `fx`, `fz` the camera's level forward; `along` +1 forward, -1 back; `across` +1 right, -1 left.
 * With `cameraRelative` off, forward is the game's -Z and right its +X whatever the camera does.
 */
export function nudgeAxis(fx: number, fz: number, along: number, across: number, cameraRelative: boolean, out: { x: number; z: number }): { x: number; z: number } {
  let wx: number;
  let wz: number;
  if (cameraRelative) {
    // The way asked in the world: forward times along, plus the camera's right (forward × up = (-fz, fx)) times across.
    wx = fx * along - fz * across;
    wz = fz * along + fx * across;
  } else {
    wx = across;
    wz = -along;
  }
  if (Math.abs(wx) >= Math.abs(wz)) {
    out.x = wx >= 0 ? 1 : -1;
    out.z = 0;
  } else {
    out.x = 0;
    out.z = wz >= 0 ? 1 : -1;
  }
  return out;
}

/**
 * The height a thing stands at once dropped to the ground: its lowest point (`lowest`, how far its turned, scaled box
 * reaches under its own origin, negative under) on the surface at `surface`. NaN where there is no surface.
 */
export function droppedY(surface: number, lowest: number): number {
  return Number.isFinite(surface) ? surface - lowest : Number.NaN;
}

/** A surface under a thing: its height and its normal. */
export interface SurfaceHit {
  y: number;
  nx: number;
  ny: number;
  nz: number;
}

/**
 * What a thing whose lowest point stands at `bottom` is dropped onto (End), into `out`: what a cast straight down from just
 * under its lowest point found (`cast`, null for nothing: a floor indoors, else whatever stands under it), and out in the
 * open (`open`: not in a room, not in space) the terrain (`terrain`, its height, NaN for none, and its normal), which wins
 * where the thing is sunk under it, where nothing stands under it, or where it stands higher than what does. False for
 * nothing under it at all.
 */
export function surfaceUnder(bottom: number, cast: SurfaceHit | null, terrain: SurfaceHit, open: boolean, out: SurfaceHit): boolean {
  let found = false;
  if (cast && Number.isFinite(cast.y)) {
    out.y = cast.y;
    out.nx = cast.nx;
    out.ny = cast.ny;
    out.nz = cast.nz;
    found = true;
  }
  if (open && Number.isFinite(terrain.y) && (terrain.y > bottom || !found || terrain.y > out.y)) {
    out.y = terrain.y;
    out.nx = terrain.nx;
    out.ny = terrain.ny;
    out.nz = terrain.nz;
    found = true;
  }
  return found;
}

/** The terrain's normal at a point from its heights `e` metres either way, into `out` (y left as it is); a slope NaN reads level. */
export function terrainNormal(hx0: number, hx1: number, hz0: number, hz1: number, e: number, out: SurfaceHit): SurfaceHit {
  const gx = (hx1 - hx0) / (2 * e);
  const gz = (hz1 - hz0) / (2 * e);
  const fx = Number.isFinite(gx) ? gx : 0;
  const fz = Number.isFinite(gz) ? gz : 0;
  const nl = Math.sqrt(fx * fx + 1 + fz * fz);
  out.nx = -fx / nl;
  out.ny = 1 / nl;
  out.nz = -fz / nl;
  return out;
}

/**
 * A turn (three's order) leaned toward a surface's normal by at most `maxDeg` degrees, composed in the world's frame
 * (`r * q`), written into `out`: the turn that takes the thing's own up onto the normal, cut to the most. A normal straight
 * up leaves it as it is.
 */
export function leanTo(q: { x: number; y: number; z: number; w: number }, nx: number, ny: number, nz: number, maxDeg: number, out: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number; w: number } {
  // The thing's own up, turned by q.
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  const ax = (uy * nz - uz * ny) / nl;
  const ay = (uz * nx - ux * nz) / nl;
  const az = (ux * ny - uy * nx) / nl;
  const s = Math.sqrt(ax * ax + ay * ay + az * az);
  const c = (ux * nx + uy * ny + uz * nz) / nl;
  let angle = Math.atan2(s, c);
  const most = (Math.max(0, maxDeg) * Math.PI) / 180;
  if (angle > most) angle = most;
  if (!(s > 1e-9) || !(angle > 0)) {
    out.x = q.x;
    out.y = q.y;
    out.z = q.z;
    out.w = q.w;
    return out;
  }
  const h = angle / 2;
  const sh = Math.sin(h) / s;
  const rx = ax * sh;
  const ry = ay * sh;
  const rz = az * sh;
  const rw = Math.cos(h);
  // Worked out before any is written: `out` may be `q` itself.
  const x = rw * q.x + rx * q.w + ry * q.z - rz * q.y;
  const y = rw * q.y - rx * q.z + ry * q.w + rz * q.x;
  const z = rw * q.z + rx * q.y - ry * q.x + rz * q.w;
  const w = rw * q.w - rx * q.x - ry * q.y - rz * q.z;
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

/** A box in the world, its corners componentwise. */
export interface WorldBox {
  lo: readonly [number, number, number];
  hi: readonly [number, number, number];
}

/**
 * The move that takes a moving box's faces flush to its nearest neighbour's, within `within` metres along each axis, into
 * `out` (nought on an axis with nothing near enough): its low face to a neighbour's high one, its high to a low one, or a
 * face to the same face of a neighbour (two things lined up), whichever is nearest, from neighbours whose box overlaps it
 * on the two other axes (grown by `within`). Only boxes turned alike are flush, which the caller decides.
 */
export function snapFlush(moving: WorldBox, neighbours: readonly WorldBox[], within: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  // Kept: a frame of a drag with V held makes nothing.
  const best = FLUSH_BEST;
  const move = FLUSH_MOVE;
  best[0] = best[1] = best[2] = Infinity;
  move[0] = move[1] = move[2] = 0;
  for (let i = 0; i < neighbours.length; i++) {
    const n = neighbours[i];
    for (let a = 0; a < 3; a++) {
      const b = a === 2 ? 0 : a + 1;
      const c = a === 0 ? 2 : a - 1;
      // Beside each other on the two other axes, so a face on this one can meet.
      if (moving.hi[b] < n.lo[b] - within || moving.lo[b] > n.hi[b] + within) continue;
      if (moving.hi[c] < n.lo[c] - within || moving.lo[c] > n.hi[c] + within) continue;
      // Its low face to their high, its high to their low, or a face lined up with the same face.
      for (let f = 0; f < 4; f++) {
        const d = f === 0 ? n.hi[a] - moving.lo[a] : f === 1 ? n.lo[a] - moving.hi[a] : f === 2 ? n.lo[a] - moving.lo[a] : n.hi[a] - moving.hi[a];
        const m = Math.abs(d);
        if (m <= within && m < best[a]) {
          best[a] = m;
          move[a] = d;
        }
      }
    }
  }
  out.x = move[0];
  out.y = move[1];
  out.z = move[2];
  return out;
}
const FLUSH_BEST = new Float64Array(3);
const FLUSH_MOVE = new Float64Array(3);

/** Whether two turns about up are alike to a quarter turn (their boxes' faces run the same ways), within `tolDeg`. */
export function alikeToQuarter(yawA: number, yawB: number, tolDeg = 1): boolean {
  const q = Math.PI / 2;
  let d = (yawA - yawB) % q;
  if (d < 0) d += q;
  const tol = (tolDeg * Math.PI) / 180;
  return d <= tol || q - d <= tol;
}
