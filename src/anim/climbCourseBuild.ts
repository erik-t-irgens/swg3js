// Climbing II, phase 1: what stands the test course (src/anim/climbCourse.ts) in a world, for the game's
// `__debug.climbTest()` and the node harness (tools/swg/tests/climbCourseBody.ts) alike: each piece's solids carried from
// its own frame into the world's (`courseToWorld`), made fixed colliders with no body in the exterior group (as every
// placed building's shell is, so the ledges and the wall climb read them exactly as they read the world's own still
// geometry: the engine's still flags and the move's own groups), and one triangle list of them all for the one mesh the
// game draws. Node loads it (the engine through src/core/physics.ts, no three.js).
//
// The course's frame has x to the body's right, y up and z ahead; the world's is three's, whose right of a heading h is
// (-cos h, 0, sin h) and whose forward is (sin h, 0, cos h). So a course point (x, y, z) stands at
// origin + right * x + up * (y + the piece's floor) + forward * z: with h = 0, the world's x is the course's turned round.

import { Group, RAPIER, groups } from '../core/physics.ts';
import type { ClimbCourse, CoursePiece, CourseSolid, SolidRole } from './climbCourse.ts';
import { solidFoot } from './climbCourse.ts';
import { courseRopes, type HangingRope } from '../player/hangingRope.ts';

/** Where the course stands: its origin in the world (x, z), the heading it faces, and each piece's floor slab's top height. */
export interface CourseFrame {
  ox: number;
  oz: number;
  h: number;
  ref(p: CoursePiece): number;
}

/** A point of a piece (its own frame) in the world, into `out`. */
export function courseToWorld(f: CourseFrame, p: CoursePiece, x: number, y: number, z: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const cx = p.at[0] + x;
  const cz = p.at[1] + z;
  const c = Math.cos(f.h);
  const s = Math.sin(f.h);
  out.x = f.ox - c * cx + s * cz;
  out.y = f.ref(p) + y;
  out.z = f.oz + s * cx + c * cz;
  return out;
}

/** A way of a piece (level, its own frame) in the world, into `out` (level, unit if it was). */
export function courseWayToWorld(f: CourseFrame, dx: number, dz: number, out: { x: number; z: number }): { x: number; z: number } {
  const c = Math.cos(f.h);
  const s = Math.sin(f.h);
  out.x = -c * dx + s * dz;
  out.z = s * dx + c * dz;
  return out;
}

/** A world point back into a piece's own frame, into `out` (the harness reads where a body is on its piece). */
export function worldToCourse(f: CourseFrame, p: CoursePiece, x: number, y: number, z: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const c = Math.cos(f.h);
  const s = Math.sin(f.h);
  const dx = x - f.ox;
  const dz = z - f.oz;
  // The inverse of the map above: (dx, dz) = M (cx, cz) with M = [[-c, s], [s, c]], its own inverse (M M = 1).
  out.x = -c * dx + s * dz - p.at[0];
  out.y = y - f.ref(p);
  out.z = s * dx + c * dz - p.at[1];
  return out;
}

/** A solid's corners in the world: its footprint's corners at its floor, then the same at its top. */
export function solidCorners(f: CourseFrame, p: CoursePiece, s: CourseSolid): { bottom: [number, number, number][]; top: [number, number, number][] } {
  const { foot, y0 } = solidFoot(s);
  const tops = s.kind === 'box' ? foot.map(() => s.mid[1] + s.half[1]) : s.tops;
  const w = { x: 0, y: 0, z: 0 };
  const bottom: [number, number, number][] = [];
  const top: [number, number, number][] = [];
  const bottoms = s.kind === 'prism' ? s.bottoms : undefined;
  foot.forEach(([x, z], i) => {
    courseToWorld(f, p, x, bottoms ? bottoms[i] : y0, z, w);
    bottom.push([w.x, w.y, w.z]);
    courseToWorld(f, p, x, tops[i], z, w);
    top.push([w.x, w.y, w.z]);
  });
  return { bottom, top };
}

/** One collider the course made: the piece and the solid it stands for (a rope's is marked by its solid's role). */
export interface CourseCollider {
  collider: RAPIER.Collider;
  piece: string;
  role: SolidRole;
}

/** The little of a Rapier world the course asks. */
export interface CourseWorld {
  createCollider(desc: RAPIER.ColliderDesc): RAPIER.Collider;
}

/**
 * Every solid of the course a fixed collider with no body: a box a cuboid at its middle turned with it, a prism the convex
 * hull of its corners; in the exterior group against every group, friction 0.8 (as the ledges' own test walls stand).
 */
export function buildCourseColliders(world: CourseWorld, course: ClimbCourse, f: CourseFrame): CourseCollider[] {
  const out: CourseCollider[] = [];
  const g = groups(Group.exterior, Group.all);
  const w = { x: 0, y: 0, z: 0 };
  for (const p of course.pieces) {
    for (const s of p.solids) {
      let desc: RAPIER.ColliderDesc | null;
      if (s.kind === 'box') {
        courseToWorld(f, p, s.mid[0], s.mid[1], s.mid[2], w);
        // The box's own x is (cos turn, sin turn) of the piece's (x, z); in the world that is (-cos a, sin a) with a = h +
        // turn, which three's turn about up by pi + a gives (its z comes out turned round, which a box does not mind).
        const th = Math.PI + f.h + s.turn;
        desc = RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]).setTranslation(w.x, w.y, w.z).setRotation({ x: 0, y: Math.sin(th / 2), z: 0, w: Math.cos(th / 2) });
      } else {
        const c = solidCorners(f, p, s);
        const pts = new Float32Array((c.bottom.length + c.top.length) * 3);
        let k = 0;
        for (const q of [...c.bottom, ...c.top]) {
          pts[k++] = q[0];
          pts[k++] = q[1];
          pts[k++] = q[2];
        }
        desc = RAPIER.ColliderDesc.convexHull(pts);
      }
      if (!desc) continue;
      desc.setFriction(0.8).setCollisionGroups(g);
      out.push({ collider: world.createCollider(desc), piece: p.id, role: s.role });
    }
  }
  return out;
}

/**
 * Climbing II, phase 4: the course's ropes, as the game's `climbTest` and the harness stand them alike: each `rope` solid a rope
 * from its column's top (src/player/hangingRope.ts's `courseRopes`), its column's collider (the builder's, found by its piece and
 * role) switched off while `climb.ropes` is 'on' and back on while it is 'off'. Under 'off' every collider stands as before.
 */
export function standCourseRopes(course: ClimbCourse, f: CourseFrame, colliders: readonly CourseCollider[]): HangingRope[] {
  return courseRopes(
    course.pieces,
    (i, x, y, z, out) => courseToWorld(f, course.pieces[i], x, y, z, out),
    (id, role) => colliders.find((c) => c.piece === id && c.role === role)?.collider ?? null,
  );
}

/** Each role's colour (linear, 0 to 1): the floor dark, the walls light, what hangs or stands thin a colour of its own. */
const ROLE_COLOUR: Record<SolidRole, [number, number, number]> = {
  floor: [0.22, 0.22, 0.24],
  wall: [0.62, 0.6, 0.56],
  plate: [0.52, 0.56, 0.62],
  platform: [0.5, 0.5, 0.46],
  bar: [0.75, 0.45, 0.15],
  beam: [0.4, 0.3, 0.2],
  rope: [0.8, 0.7, 0.35],
  pole: [0.75, 0.45, 0.15],
  obstacle: [0.55, 0.42, 0.32],
  // The feedback round's climbs up that only nearly fit: what stands over or on the top a colour of its own.
  roof: [0.36, 0.42, 0.5],
  bump: [0.7, 0.3, 0.3],
};

/**
 * The course as one triangle list in the world (positions, flat normals, colours: every piece a shade lighter or darker
 * than its neighbour so they read apart), every face turned out of its solid. `keep` (Climbing II, phase 4) draws only the solids
 * of the roles it says yes to (the game draws the rope's column apart, shown only while `climb.ropes` is 'off'); none, every one.
 */
export function courseTriangles(course: ClimbCourse, f: CourseFrame, keep?: (role: SolidRole) => boolean): { positions: Float32Array; normals: Float32Array; colors: Float32Array } {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  course.pieces.forEach((p, pi) => {
    const shade = pi % 2 === 0 ? 1 : 0.86;
    for (const s of p.solids) {
      if (keep && !keep(s.role)) continue;
      const { bottom, top } = solidCorners(f, p, s);
      const n = bottom.length;
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (const q of [...bottom, ...top]) {
        mx += q[0];
        my += q[1];
        mz += q[2];
      }
      mx /= 2 * n;
      my /= 2 * n;
      mz /= 2 * n;
      const rgb = ROLE_COLOUR[s.role];
      const tri = (a: number[], b: number[], c: number[]): void => {
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz);
        if (!(l > 1e-12)) return;
        nx /= l;
        ny /= l;
        nz /= l;
        const cx = (a[0] + b[0] + c[0]) / 3 - mx;
        const cy = (a[1] + b[1] + c[1]) / 3 - my;
        const cz = (a[2] + b[2] + c[2]) / 3 - mz;
        if (nx * cx + ny * cy + nz * cz < 0) {
          pos.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
          nx = -nx;
          ny = -ny;
          nz = -nz;
        } else pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        for (let k = 0; k < 3; k++) {
          nrm.push(nx, ny, nz);
          col.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade);
        }
      };
      for (let i = 1; i + 1 < n; i++) {
        tri(top[0], top[i], top[i + 1]);
        tri(bottom[0], bottom[i + 1], bottom[i]);
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        tri(bottom[i], bottom[j], top[j]);
        tri(bottom[i], top[j], top[i]);
      }
    }
  });
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col) };
}
