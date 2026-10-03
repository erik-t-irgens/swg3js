// What a world's trees and rocks are solid at: the shapes the client authored for each one, hung on
// every planting, with the old guess kept for a pack that has none.
//
// The client collided with each appearance's own collision extent (`tools/swg/extent.mjs` reads it,
// and the `floracollision` pass writes it into flora-collision.json beside the manifest): a tree's is
// its trunk, a rock's a few cylinders round its body, a fallen log a box, a dead wroshyr a small mesh,
// and a living wroshyr or a giant lickbush nothing at all, because the client walked through them.
// Before this every planting stood on one upright cylinder guessed from its model's box, and the box
// of a wide-canopied tree is its canopy: anything not three times as tall as it was wide was taken
// for a rock and blocked at 80% of its width, which put a 9 to 27 m column under a birch or an oak
// and turned whole forests solid. The guess is still here (`guessRadius`), for a pack converted
// before the pass and for comparison, and its numbers are now the tune's.
//
// A shape is in the model's own frame, mirrored as the GLB is, so the planting's own instance matrix
// carries it into the world exactly as it carries the model: its place, its mirrored turn and its
// scale. Nothing here runs per frame: a chunk's colliders are worked out once, when it is planted,
// and again only when the console moves the rule.

import type { FloraChunkData } from './floraBatch.ts';
import type { Collider } from './props.ts';

/** The shape of flora-collision.json this build reads; the converter's `FLORA_COLLISION_VERSION` (`tools/swg/extent.mjs`), held equal by a node test. */
export const FLORA_COLLISION_VERSION = 1;

/** One shape as the pack writes it, in the model's frame (X mirrored as the GLB is). */
export interface FloraShape {
  /** An upright cylinder (base `c`, radius `r`, height `h`), a ball (centre `c`, radius `r`), a box (`min`, `max`) or a mesh (`v` x, y, z; `i` triangles). */
  t: 'cyl' | 'ball' | 'box' | 'mesh';
  c?: number[];
  r?: number;
  h?: number;
  min?: number[];
  max?: number[];
  v?: number[];
  i?: number[];
}

/** One appearance's entry: the extent's kind, as the client's tag names it, and its shapes. An empty list is a NULL extent: walked through. */
export interface FloraCollision {
  kind: string;
  shapes: FloraShape[];
}

/**
 * The rule, live through `__debug.flora({ collision: { … } })`. The trunk and rock numbers are the old
 * guess's, ours, moved here unchanged; nothing in the client's own shapes is tuned.
 */
export const FLORA_COLLISION = {
  /** `'client'`: the client's own shapes wherever the pack has them, the guess where it has not. `'guess'`: the guess everywhere, the rule before the pass. */
  rule: 'client' as 'client' | 'guess',
  /**
   * A NULL extent is walked through, as the client did. On, a NULL planting tall enough for the guess
   * to call a tree stands on the guess's slim trunk instead (the owner's knob, should a living wroshyr
   * want to be solid after all).
   */
  nullTrunk: false,
  /** The guess: a model this many times as tall as its box is wide (as a radius) is a tree, blocked at its trunk. */
  treeRatio: 2.2,
  /** A guessed trunk: this share of the box's radius, held between these two. */
  trunkShare: 0.3,
  trunkMin: 0.25,
  trunkMax: 1.2,
  /** A guessed rock: this share of the box's radius, never under this. */
  rockShare: 0.8,
  rockMin: 0.3,
};

/** The defaults, for `__debug.flora({ collision: true })`. */
export const FLORA_COLLISION_DEFAULTS = Object.freeze({ ...FLORA_COLLISION });

/** The guess's radius for a model `r` wide (as a radius) and `h` tall, both at the planting's scale. */
export function guessRadius(r: number, h: number, t = FLORA_COLLISION): number {
  return h > t.treeRatio * r ? trunkRadius(r, t) : Math.max(r * t.rockShare, t.rockMin);
}

/** The guess's trunk for a model `r` wide. */
export function trunkRadius(r: number, t = FLORA_COLLISION): number {
  return Math.min(Math.max(r * t.trunkShare, t.trunkMin), t.trunkMax);
}

/** One shape of one planting, in the world: what the physics stands up (`Physics.createStaticPart`). */
export interface ColliderPart {
  kind: 'cyl' | 'ball' | 'box' | 'mesh';
  /** The shape's middle in the world; a mesh's vertices are in the world already and these are its box's middle. */
  x: number;
  y: number;
  z: number;
  /** A cylinder's or a ball's radius. */
  r: number;
  /** Half the box's extents; a cylinder's half height is `hy`. */
  hx: number;
  hy: number;
  hz: number;
  /** The box's turn about Y, as a quaternion's y and w (its x and z are nought). */
  qy: number;
  qw: number;
  /** A mesh's vertices in the world, and its triangles. */
  verts: Float32Array | null;
  idx: Uint32Array | null;
}

/** A mesh shape's triangles as typed arrays, made once per shape for every planting of it. */
const meshIndices = new WeakMap<FloraShape, Uint32Array>();

function trianglesOf(s: FloraShape): Uint32Array {
  let idx = meshIndices.get(s);
  if (!idx) {
    const n = Math.floor((s.v?.length ?? 0) / 3);
    const list = (s.i ?? []).filter((k) => Number.isInteger(k) && k >= 0 && k < n);
    idx = Uint32Array.from(list.length % 3 === 0 ? list : list.slice(0, list.length - (list.length % 3)));
    meshIndices.set(s, idx);
  }
  return idx;
}

function part(kind: ColliderPart['kind']): ColliderPart {
  return { kind, x: 0, y: 0, z: 0, r: 0, hx: 0, hy: 0, hz: 0, qy: 0, qw: 1, verts: null, idx: null };
}

/**
 * A planting's shapes in the world, through its own instance matrix (`m`, column-major as three
 * writes it, at `at`) and its scale. Shapes the engine could not take (a radius or a height of
 * nothing, a mesh with no triangle) are left out.
 */
export function shapeParts(shapes: readonly FloraShape[], m: ArrayLike<number>, at: number, scale: number, out: ColliderPart[] = []): ColliderPart[] {
  const tx = (x: number, y: number, z: number): number => m[at] * x + m[at + 4] * y + m[at + 8] * z + m[at + 12];
  const ty = (x: number, y: number, z: number): number => m[at + 1] * x + m[at + 5] * y + m[at + 9] * z + m[at + 13];
  const tz = (x: number, y: number, z: number): number => m[at + 2] * x + m[at + 6] * y + m[at + 10] * z + m[at + 14];
  // The planting turns only about Y, so its turn is in the matrix's first column: (s cos, 0, -s sin).
  const turn = Math.atan2(m[at + 8], m[at]);
  for (const s of shapes) {
    if (s.t === 'cyl' && s.c && s.r! > 0 && s.h! > 0) {
      const p = part('cyl');
      const mid = s.c[1] + s.h! / 2;
      p.x = tx(s.c[0], mid, s.c[2]);
      p.y = ty(s.c[0], mid, s.c[2]);
      p.z = tz(s.c[0], mid, s.c[2]);
      p.r = s.r! * scale;
      p.hy = (s.h! * scale) / 2;
      out.push(p);
    } else if (s.t === 'ball' && s.c && s.r! > 0) {
      const p = part('ball');
      p.x = tx(s.c[0], s.c[1], s.c[2]);
      p.y = ty(s.c[0], s.c[1], s.c[2]);
      p.z = tz(s.c[0], s.c[1], s.c[2]);
      p.r = s.r! * scale;
      out.push(p);
    } else if (s.t === 'box' && s.min && s.max) {
      const p = part('box');
      const cx = (s.min[0] + s.max[0]) / 2;
      const cy = (s.min[1] + s.max[1]) / 2;
      const cz = (s.min[2] + s.max[2]) / 2;
      p.x = tx(cx, cy, cz);
      p.y = ty(cx, cy, cz);
      p.z = tz(cx, cy, cz);
      p.hx = (Math.abs(s.max[0] - s.min[0]) * scale) / 2;
      p.hy = (Math.abs(s.max[1] - s.min[1]) * scale) / 2;
      p.hz = (Math.abs(s.max[2] - s.min[2]) * scale) / 2;
      p.qy = Math.sin(turn / 2);
      p.qw = Math.cos(turn / 2);
      if (p.hx > 0 && p.hy > 0 && p.hz > 0) out.push(p);
    } else if (s.t === 'mesh' && s.v && s.v.length >= 9) {
      const idx = trianglesOf(s);
      if (idx.length < 3) continue;
      const n = Math.floor(s.v.length / 3);
      const verts = new Float32Array(n * 3);
      let lo = Infinity;
      let hi = -Infinity;
      let sx = 0;
      let sz = 0;
      for (let k = 0; k < n; k++) {
        const x = s.v[k * 3];
        const y = s.v[k * 3 + 1];
        const z = s.v[k * 3 + 2];
        verts[k * 3] = tx(x, y, z);
        verts[k * 3 + 1] = ty(x, y, z);
        verts[k * 3 + 2] = tz(x, y, z);
        lo = Math.min(lo, verts[k * 3 + 1]);
        hi = Math.max(hi, verts[k * 3 + 1]);
        sx += verts[k * 3];
        sz += verts[k * 3 + 2];
      }
      const p = part('mesh');
      p.verts = verts;
      p.idx = idx;
      p.x = sx / n;
      p.y = (lo + hi) / 2;
      p.z = sz / n;
      p.hy = (hi - lo) / 2;
      out.push(p);
    }
  }
  return out;
}

/** How far a part reaches across the ground from (x, z), and how high its top stands. */
function reachOf(p: ColliderPart, x: number, z: number): { across: number; top: number } {
  const off = Math.hypot(p.x - x, p.z - z);
  if (p.kind === 'cyl') return { across: off + p.r, top: p.y + p.hy };
  if (p.kind === 'ball') return { across: off + p.r, top: p.y + p.r };
  if (p.kind === 'box') return { across: off + Math.hypot(p.hx, p.hz), top: p.y + p.hy };
  let across = 0;
  let top = -Infinity;
  const v = p.verts!;
  for (let k = 0; k < v.length; k += 3) {
    across = Math.max(across, Math.hypot(v[k] - x, v[k + 2] - z));
    top = Math.max(top, v[k + 1]);
  }
  return { across, top };
}

/**
 * Every collidable planting of a chunk as its colliders, into `out`. A planting whose model the pack
 * has the client's shapes for stands on them (`parts`); one the client walked through stands on
 * nothing (or on the guess's trunk, with `nullTrunk`); one the pack has no word on stands on the
 * guess, the one upright cylinder it always did. `r` and `top` are kept on every collider, for the
 * console's list: how far across the ground it reaches from the planting, and its top.
 */
export function floraColliders(data: FloraChunkData, out: Collider[] = [], t = FLORA_COLLISION): Collider[] {
  for (let i = 0; i < data.n; i++) {
    if (!data.collidable[i]) continue;
    const model = data.models[i];
    const s = data.scale[i];
    const x = data.x[i];
    const y = data.y[i];
    const z = data.z[i];
    const r = model.radius * s;
    const h = model.height * s;
    // A model with no def at all (a stand-in) is no word, and is guessed.
    const c = t.rule === 'client' ? (model.def as { collision?: FloraCollision } | undefined)?.collision : undefined;
    if (!c) {
      out.push({ x, z, r: guessRadius(r, h, t), top: y + h });
      continue;
    }
    if (!c.shapes.length) {
      if (t.nullTrunk && h > t.treeRatio * r) out.push({ x, z, r: trunkRadius(r, t), top: y + h });
      continue;
    }
    const parts = shapeParts(c.shapes, data.mats, i * 16, s);
    if (!parts.length) continue;
    let across = 0;
    let top = -Infinity;
    for (const p of parts) {
      const e = reachOf(p, x, z);
      across = Math.max(across, e.across);
      top = Math.max(top, e.top);
    }
    out.push({ x, z, r: across, top, parts });
  }
  return out;
}

/**
 * flora-collision.json onto a pack's flora defs, as floors.json goes onto its cells: each def whose
 * appearance the file has an entry for carries it as `collision`. A file of another shape is passed
 * over whole, and a def it has no entry for is left with none, which the planter takes as "no word"
 * and guesses. Returns how many defs took an entry.
 */
export function mergeFloraCollision(defs: readonly { appearance?: string; collision?: FloraCollision }[], file: unknown): number {
  const f = file as { version?: number; appearances?: Record<string, FloraCollision> } | null;
  if (!f || f.version !== FLORA_COLLISION_VERSION || !f.appearances || typeof f.appearances !== 'object') return 0;
  let n = 0;
  for (const def of defs) {
    if (!def.appearance) continue;
    const key = def.appearance.replace(/\\/g, '/').toLowerCase();
    const entry = Object.prototype.hasOwnProperty.call(f.appearances, key) ? f.appearances[key] : undefined;
    if (!entry || !Array.isArray(entry.shapes)) continue;
    def.collision = entry;
    n++;
  }
  return n;
}
