// The arithmetic of a room's air, with no dependency at all, so a plain node script can check it:
// which way each doorway of a portal building faces into its room, the box a sunbeam through it is
// clipped to, how far into the room the beam reaches, the map from the room to the beam's unit
// prism, and the closed forms the shaders evaluate (the soft-edged beam along a view ray, the glow
// around a lamp, the scattering phase, where a drifting mote is drawn and how bright its sprite
// comes out). `roomAir.ts` builds the frame from these, and `lightShafts.ts` and
// `roomAirShaders.ts` do the same sums on the GPU.

export type Vec3 = [number, number, number];

/** A box with min below max on every axis (normaliseBox makes one from a manifest's BOX). */
export interface RoomBox {
  min: Vec3;
  max: Vec3;
}

/** A pack model's cell, as much of it as the room's air reads. */
export interface RoomCellDef {
  index: number;
  name?: string;
  bounds: { min: number[]; max: number[] };
  portals?: { geometry: number; target: number; passable?: boolean }[];
}

/** A pack model's portal layout: its cells, and the portal polygons their links index. */
export interface RoomModelDef {
  cells?: RoomCellDef[];
  portals?: { v: number[][]; i: number[] }[];
}

/** A doorway from a room onto the world: where it is, which way is in, and the rectangle a sunbeam through it is extruded from. Room (model) frame. */
export interface ExitAperture {
  /** The portal polygon's index in the model's `portals`. */
  portal: number;
  /** The room it opens from. */
  cell: number;
  cellName: string;
  /** The room's box. */
  box: RoomBox;
  /** What a beam through it is clipped to: the room's box padded 0.05 m, and the doorway's own box padded 0.3 m. */
  shaftBox: RoomBox;
  /** Unit, into the room. */
  inward: Vec3;
  /** The mean of the polygon's vertices. */
  centroid: Vec3;
  /** The rectangle's corner at (0, 0): u across, v up the doorway. */
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  width: number;
  height: number;
  /** The polygon's own area, from its triangles. */
  area: number;
  /** Five points on the opening, inside its own triangles, for the sun-visibility rays. */
  samples: Vec3[];
  /** Whether the probes into the room's box decided the inward side, or the box's centre did. */
  decidedBy: 'probes' | 'centre';
  /** The polygon, for the tests and the debug view. */
  verts: Vec3[];
  /** Whole triangles only, indices into `verts`. */
  tris: number[];
}

/** The room effects' settings: the effects registry's keys, read by name so a key not there yet takes its default. */
export interface RoomAirSettings {
  effects: boolean;
  lightShafts: boolean;
  lightShaftStrength: number;
  roomGlowStrength: number;
  roomMotes: boolean;
  roomMoteAmount: number;
}

/** The registry's defaults for the room effects' keys (fx-shafts 11.1). */
export const ROOM_AIR_SETTING_DEFAULTS: Readonly<RoomAirSettings> = {
  effects: true,
  lightShafts: true,
  lightShaftStrength: 0.8,
  roomGlowStrength: 0.5,
  roomMotes: true,
  roomMoteAmount: 1,
};

/** Doorway beams at once. A define in both shaders, so a change is one other program, warmed like the first. */
export const MAX_SHAFTS = 6;
/** Lamps at once: the pooled room lights (`INTERIOR_LIGHT_CAP`). */
export const MAX_LAMPS = 8;
/** The rooms the motes fill at once: the camera's own and three it opens onto. */
export const MAX_MOTE_BOXES = 4;
/** The most motes ever drawn (the amount knob at 2). */
export const MAX_MOTES = 3000;

/** The smallest a mote is drawn, pixels: below about 3 px a sprite's brightness swings up to twentyfold as it crosses pixels. */
export const MOTE_MIN_PX = 3.5;
export const MOTE_MAX_PX = 12;
/** The sprite kernel exp(-MOTE_KERNEL x |pointCoord - 0.5|^2), i.e. exp(-4 r2) with r2 = 4|c|^2. */
export const MOTE_KERNEL = 16;
/** The streak noise's two octaves, cycles per metre across the doorway. */
export const NOISE_FREQ: readonly [number, number] = [1.7, 4.3];

/** How far the probes reach into and out of a doorway to find which side its room is on, metres. */
const PROBES = [0.25, 1.0];
/** The room's box is padded this much for the beam, metres; the doorway's own box this much. */
const CELL_PAD = 0.05;
const DOOR_PAD = 0.3;
/** A doorway narrower or lower than this casts no beam, metres. */
const MIN_APERTURE = 0.2;
/** The reach rays start this far inside the doorway, metres. */
const REACH_NUDGE = 0.02;
/** A slab's direction component smaller than this is taken as this, as the shader does. */
const SLAB_EPS = 1e-6;

// ---- Settings ----

/**
 * The room effects' settings from the live settings object, into `out`. A key the effects registry
 * does not carry (yet), or carries with the wrong type, takes its default. Allocates nothing.
 */
export function readRoomAirSettings(from: object, out: RoomAirSettings): RoomAirSettings {
  const s = from as Partial<Record<keyof RoomAirSettings, unknown>>;
  const D = ROOM_AIR_SETTING_DEFAULTS;
  out.effects = typeof s.effects === 'boolean' ? s.effects : D.effects;
  out.lightShafts = typeof s.lightShafts === 'boolean' ? s.lightShafts : D.lightShafts;
  out.lightShaftStrength = typeof s.lightShaftStrength === 'number' ? s.lightShaftStrength : D.lightShaftStrength;
  out.roomGlowStrength = typeof s.roomGlowStrength === 'number' ? s.roomGlowStrength : D.roomGlowStrength;
  out.roomMotes = typeof s.roomMotes === 'boolean' ? s.roomMotes : D.roomMotes;
  out.roomMoteAmount = typeof s.roomMoteAmount === 'number' ? s.roomMoteAmount : D.roomMoteAmount;
  return out;
}

// ---- Small vector helpers (tuples; the callers here are not per-frame) ----

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
}
function inBox(p: Vec3, b: RoomBox): boolean {
  return p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2];
}

export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---- Boxes ----

/**
 * A manifest's box with its corners taken componentwise: a mesh's BOX chunk holds the larger corner
 * first, and packs converted before that was known carry it swapped, so neither corner is trusted.
 */
export function normaliseBox(b: { min: number[]; max: number[] }): RoomBox {
  return {
    min: [Math.min(b.min[0], b.max[0]), Math.min(b.min[1], b.max[1]), Math.min(b.min[2], b.max[2])],
    max: [Math.max(b.min[0], b.max[0]), Math.max(b.min[1], b.max[1]), Math.max(b.min[2], b.max[2])],
  };
}

/** Every room's box, by cell index; the shell (cell 0) is left out. */
export function cellBoxes(def: RoomModelDef): Map<number, RoomBox> {
  const out = new Map<number, RoomBox>();
  for (const c of def.cells ?? []) if (c.index > 0 && c.bounds) out.set(c.index, normaliseBox(c.bounds));
  return out;
}

/** The rooms a room opens onto: its own links' targets and the rooms whose links target it, never the shell. */
export function neighbourCells(def: RoomModelDef, cell: number): number[] {
  const out: number[] = [];
  for (const c of def.cells ?? []) {
    for (const p of c.portals ?? []) {
      if (c.index === cell && p.target > 0 && p.target !== cell && !out.includes(p.target)) out.push(p.target);
      if (p.target === cell && c.index > 0 && c.index !== cell && !out.includes(c.index)) out.push(c.index);
    }
  }
  return out;
}

/** The box moved in by `inset` on every side; an axis narrower than 2 x inset collapses to its middle. */
export function shrinkBox(b: RoomBox, inset: number, out: RoomBox = { min: [0, 0, 0], max: [0, 0, 0] }): RoomBox {
  for (let k = 0; k < 3; k++) {
    const lo = b.min[k] + inset;
    const hi = b.max[k] - inset;
    if (lo > hi) {
      const mid = (b.min[k] + b.max[k]) / 2;
      out.min[k] = mid;
      out.max[k] = mid;
    } else {
      out.min[k] = lo;
      out.max[k] = hi;
    }
  }
  return out;
}

export function clampToBox(p: Vec3, b: RoomBox, out: Vec3 = [0, 0, 0]): Vec3 {
  for (let k = 0; k < 3; k++) out[k] = Math.min(b.max[k], Math.max(b.min[k], p[k]));
  return out;
}

/**
 * The union of the room's box padded 0.05 m and the doorway rectangle's box padded 0.3 m, and of the
 * polygon's own vertices padded the same: an opening that is not flat (Mustafar's crashed ship's torn
 * bridge stands 3.8 m off its own mean plane) has corners the rectangle, which lies in that plane,
 * does not reach.
 */
export function shaftBoxOf(box: RoomBox, origin: Vec3, u: Vec3, v: Vec3, width: number, height: number, verts: readonly Vec3[] = []): RoomBox {
  const out: RoomBox = {
    min: [box.min[0] - CELL_PAD, box.min[1] - CELL_PAD, box.min[2] - CELL_PAD],
    max: [box.max[0] + CELL_PAD, box.max[1] + CELL_PAD, box.max[2] + CELL_PAD],
  };
  for (let i = 0; i < 4; i++) {
    const a = i & 1 ? width : 0;
    const b = i & 2 ? height : 0;
    for (let k = 0; k < 3; k++) {
      const c = origin[k] + u[k] * a + v[k] * b;
      out.min[k] = Math.min(out.min[k], c - DOOR_PAD);
      out.max[k] = Math.max(out.max[k], c + DOOR_PAD);
    }
  }
  for (const p of verts) {
    for (let k = 0; k < 3; k++) {
      out.min[k] = Math.min(out.min[k], p[k] - DOOR_PAD);
      out.max[k] = Math.max(out.max[k], p[k] + DOOR_PAD);
    }
  }
  return out;
}

// ---- Doorways ----

/** The radical inverse in base 2 of i: 1 -> 0.5, 2 -> 0.25, 3 -> 0.75, 4 -> 0.125, 5 -> 0.625. */
function radicalInverse(i: number): number {
  let f = 0.5;
  let r = 0;
  while (i > 0) {
    if (i & 1) r += f;
    i >>= 1;
    f *= 0.5;
  }
  return r;
}

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  return 0.5 * len(cross(sub(b, a), sub(c, a)));
}

/**
 * `n` points inside a polygon's own triangles (the ones the portal renderer draws as the opening),
 * spread by area: sample k takes the triangle its share of the running area falls in, and a point
 * in it by the square-root rule; each point is then pulled `pull` of the way toward its triangle's
 * centroid, which keeps it off the jambs.
 */
export function apertureSamples(verts: Vec3[], tris: number[], n: number, pull: number): Vec3[] {
  const areas: number[] = [];
  const cum: number[] = [];
  let total = 0;
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = triangleArea(verts[tris[t]], verts[tris[t + 1]], verts[tris[t + 2]]);
    cum.push(total);
    areas.push(a);
    total += a;
  }
  const out: Vec3[] = [];
  if (!areas.length || !(total > 0)) return out;
  for (let k = 0; k < n; k++) {
    const s = ((k + 0.5) / n) * total;
    let j = 0;
    while (j + 1 < areas.length && cum[j + 1] <= s) j++;
    while (j < areas.length - 1 && areas[j] <= 0) j++;
    const f = areas[j] > 0 ? Math.min(1, Math.max(0, (s - cum[j]) / areas[j])) : 0.5;
    const A = verts[tris[j * 3]];
    const B = verts[tris[j * 3 + 1]];
    const C = verts[tris[j * 3 + 2]];
    const r1 = Math.sqrt(f);
    const r2 = radicalInverse(k + 1);
    const p: Vec3 = [0, 0, 0];
    for (let d = 0; d < 3; d++) p[d] = (1 - r1) * A[d] + r1 * (1 - r2) * B[d] + r1 * r2 * C[d];
    const cen: Vec3 = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    out.push([cen[0] + (1 - pull) * (p[0] - cen[0]), cen[1] + (1 - pull) * (p[1] - cen[1]), cen[2] + (1 - pull) * (p[2] - cen[2])]);
  }
  return out;
}

/**
 * Every doorway from a room onto the world (a portal a room above 0 links to cell 0), counted once
 * per polygon, impassable openings included: they still let light in. The side the room is on is
 * found by probing into the room's box along the polygon's winding normal and against it; where the
 * probes cannot tell (both land inside a huge box, or a door on a box's corner), the box's centre
 * decides. The converter drops each portal's clockwise flag, so this is inferred rather than read.
 */
export function exitApertures(def: RoomModelDef): ExitAperture[] {
  const out: ExitAperture[] = [];
  const polys = def.portals ?? [];
  const seen = new Set<number>();
  for (const c of def.cells ?? []) {
    if (c.index <= 0 || !c.bounds) continue;
    for (const link of c.portals ?? []) {
      if (link.target !== 0 || seen.has(link.geometry)) continue;
      const poly = polys[link.geometry];
      if (!poly || !poly.v || !poly.i) continue;
      seen.add(link.geometry);
      const verts: Vec3[] = poly.v.map((p) => [p[0], p[1], p[2]]);
      const tris: number[] = [];
      for (let t = 0; t + 2 < poly.i.length; t += 3) {
        const a = poly.i[t];
        const b = poly.i[t + 1];
        const d = poly.i[t + 2];
        if (a >= 0 && a < verts.length && b >= 0 && b < verts.length && d >= 0 && d < verts.length) tris.push(a, b, d);
      }
      if (tris.length < 3) continue;
      // The winding normal of the first triangle with any area.
      let n: Vec3 = [0, 0, 0];
      for (let t = 0; t + 2 < tris.length && len(n) === 0; t += 3) n = normalize(cross(sub(verts[tris[t + 1]], verts[tris[t]]), sub(verts[tris[t + 2]], verts[tris[t]])));
      if (len(n) === 0) continue;
      const centroid: Vec3 = [0, 0, 0];
      for (const p of verts) for (let k = 0; k < 3; k++) centroid[k] += p[k] / verts.length;
      const box = normaliseBox(c.bounds);
      let plus = 0;
      let minus = 0;
      for (const s of PROBES) {
        if (inBox(addScaled(centroid, n, s), box)) plus++;
        if (inBox(addScaled(centroid, n, -s), box)) minus++;
      }
      let inward: Vec3;
      let decidedBy: 'probes' | 'centre';
      if (plus !== minus) {
        inward = plus > minus ? n : scale(n, -1);
        decidedBy = 'probes';
      } else {
        const centre: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
        inward = dot(n, sub(centre, centroid)) >= 0 ? n : scale(n, -1);
        decidedBy = 'centre';
      }
      const u = Math.abs(inward[1]) < 0.9 ? normalize(cross([0, 1, 0], inward)) : normalize(cross([1, 0, 0], inward));
      const v = cross(inward, u);
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (const p of verts) {
        const d = sub(p, centroid);
        const pu = dot(d, u);
        const pv = dot(d, v);
        minU = Math.min(minU, pu);
        maxU = Math.max(maxU, pu);
        minV = Math.min(minV, pv);
        maxV = Math.max(maxV, pv);
      }
      const width = maxU - minU;
      const height = maxV - minV;
      if (!(width >= MIN_APERTURE) || !(height >= MIN_APERTURE)) continue;
      const origin = addScaled(addScaled(centroid, u, minU), v, minV);
      let area = 0;
      for (let t = 0; t + 2 < tris.length; t += 3) area += triangleArea(verts[tris[t]], verts[tris[t + 1]], verts[tris[t + 2]]);
      out.push({
        portal: link.geometry,
        cell: c.index,
        cellName: c.name ?? '',
        box,
        shaftBox: shaftBoxOf(box, origin, u, v, width, height, verts),
        inward,
        centroid,
        origin,
        u,
        v,
        width,
        height,
        area,
        samples: apertureSamples(verts, tris, 5, 0.3),
        decidedBy,
        verts,
        tris,
      });
    }
  }
  return out;
}

// ---- Rays and the beam's prism ----

/** Slab test: [tmin, tmax] along o + s d (empty when tmin >= tmax); a direction component under 1e-6 is taken as 1e-6, as the shader does. */
export function slab(o: Vec3, d: Vec3, lo: Vec3, hi: Vec3, out: [number, number] = [0, 0]): [number, number] {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let k = 0; k < 3; k++) {
    const dk = Math.abs(d[k]) < SLAB_EPS ? SLAB_EPS : d[k];
    const inv = 1 / dk;
    const t0 = (lo[k] - o[k]) * inv;
    const t1 = (hi[k] - o[k]) * inv;
    tmin = Math.max(tmin, Math.min(t0, t1));
    tmax = Math.min(tmax, Math.max(t0, t1));
  }
  out[0] = tmin;
  out[1] = tmax;
  return out;
}

export function rayBoxRange(o: Vec3, d: Vec3, box: RoomBox, out: [number, number] = [0, 0]): [number, number] {
  return slab(o, d, box.min, box.max, out);
}

const reachP: Vec3 = [0, 0, 0];
const reachR: [number, number] = [0, 0];

/**
 * How far into the room a beam can reach: the farthest a ray along `travel` from the rectangle's
 * corners and centre (nudged just inside) runs before it leaves the shaft box, clamped to 0.5..maxT.
 * Allocates nothing.
 */
export function shaftReach(a: ExitAperture, travel: Vec3, maxT: number): number {
  let best = 0;
  for (let i = 0; i < 5; i++) {
    const fu = i === 4 ? 0.5 : i & 1 ? 1 : 0;
    const fv = i === 4 ? 0.5 : i & 2 ? 1 : 0;
    for (let k = 0; k < 3; k++) reachP[k] = a.origin[k] + a.u[k] * a.width * fu + a.v[k] * a.height * fv + a.inward[k] * REACH_NUDGE;
    rayBoxRange(reachP, travel, a.shaftBox, reachR);
    if (reachR[1] > best) best = reachR[1];
  }
  return Math.min(maxT, Math.max(0.5, best));
}

/** Column-major 4x4 (three's Matrix4.elements order) taking the unit prism (a across, b up, t along the light) to the room frame. */
export function shaftBasis(a: ExitAperture, travel: Vec3, reach: number, out: number[]): number[] {
  out[0] = a.u[0] * a.width;
  out[1] = a.u[1] * a.width;
  out[2] = a.u[2] * a.width;
  out[3] = 0;
  out[4] = a.v[0] * a.height;
  out[5] = a.v[1] * a.height;
  out[6] = a.v[2] * a.height;
  out[7] = 0;
  out[8] = travel[0] * reach;
  out[9] = travel[1] * reach;
  out[10] = travel[2] * reach;
  out[11] = 0;
  out[12] = a.origin[0];
  out[13] = a.origin[1];
  out[14] = a.origin[2];
  out[15] = 1;
  return out;
}

/** The inverse of an affine column-major 4x4 (last row 0, 0, 0, 1). */
export function invertAffine(m: number[], out: number[]): number[] {
  const a00 = m[0], a10 = m[1], a20 = m[2];
  const a01 = m[4], a11 = m[5], a21 = m[6];
  const a02 = m[8], a12 = m[9], a22 = m[10];
  const tx = m[12], ty = m[13], tz = m[14];
  const c00 = a11 * a22 - a12 * a21;
  const c01 = a02 * a21 - a01 * a22;
  const c02 = a01 * a12 - a02 * a11;
  const c10 = a12 * a20 - a10 * a22;
  const c11 = a00 * a22 - a02 * a20;
  const c12 = a02 * a10 - a00 * a12;
  const c20 = a10 * a21 - a11 * a20;
  const c21 = a01 * a20 - a00 * a21;
  const c22 = a00 * a11 - a01 * a10;
  const det = a00 * c00 + a01 * c10 + a02 * c20;
  const inv = det !== 0 ? 1 / det : 0;
  const i00 = c00 * inv, i01 = c01 * inv, i02 = c02 * inv;
  const i10 = c10 * inv, i11 = c11 * inv, i12 = c12 * inv;
  const i20 = c20 * inv, i21 = c21 * inv, i22 = c22 * inv;
  out[0] = i00;
  out[1] = i10;
  out[2] = i20;
  out[3] = 0;
  out[4] = i01;
  out[5] = i11;
  out[6] = i21;
  out[7] = 0;
  out[8] = i02;
  out[9] = i12;
  out[10] = i22;
  out[11] = 0;
  out[12] = -(i00 * tx + i01 * ty + i02 * tz);
  out[13] = -(i10 * tx + i11 * ty + i12 * tz);
  out[14] = -(i20 * tx + i21 * ty + i22 * tz);
  out[15] = 1;
  return out;
}

/** 1 inside 0..1, easing to 0 across +-e at each end; a hard edge when e is 0. */
export function softBand(x: number, e: number): number {
  if (!(e > 0)) return x >= 0 && x <= 1 ? 1 : 0;
  return smoothstep(-e, e, x) * smoothstep(-e, e, 1 - x);
}

const segR: [number, number] = [0, 0];
const segLo: Vec3 = [0, 0, 0];
const segHi: Vec3 = [0, 0, 1];

/**
 * Metres of beam along a unit-space ray o + s d (s in metres, the map being affine): the outer slab
 * (the prism widened by the soft edge) clipped to [s0, s1], times the mean soft membership at 1/8,
 * 3/8, 5/8 and 7/8 of it, at density 1. The haze shader does exactly this with the noise on top.
 */
export function softSegment(o: Vec3, d: Vec3, ea: number, eb: number, s0: number, s1: number): number {
  segLo[0] = -ea;
  segLo[1] = -eb;
  segHi[0] = 1 + ea;
  segHi[1] = 1 + eb;
  slab(o, d, segLo, segHi, segR);
  const lo = Math.max(segR[0], s0);
  const hi = Math.min(segR[1], s1);
  if (!(hi > lo)) return 0;
  let m = 0;
  for (let k = 0; k < 4; k++) {
    const s = lo + (hi - lo) * (k + 0.5) * 0.25;
    m += softBand(o[0] + d[0] * s, ea) * softBand(o[1] + d[1] * s, eb);
  }
  return (hi - lo) * m * 0.25;
}

/**
 * The weight a noise octave keeps over a segment spanning `span` metres on the doorway plane:
 * 1 - smoothstep(0.5, 2, freq x span). Four samples cannot resolve more than about two cycles, so
 * past that the octave fades to its mean (0.5) instead of crawling as the camera moves.
 */
export function octaveFade(freq: number, span: number): number {
  return 1 - smoothstep(0.5, 2, freq * span);
}

/** Closed form of the integral of 1 / (dist^2 + eps^2) along o + s dir (dir unit), s in [0, D]: a lamp's glow along a view ray. */
export function lampIntegral(o: Vec3, dir: Vec3, D: number, lamp: Vec3, eps: number): number {
  const dl: Vec3 = [o[0] - lamp[0], o[1] - lamp[1], o[2] - lamp[2]];
  const b = dot(dir, dl);
  const h2 = Math.max(dot(dl, dl) - b * b, 0);
  const sq = Math.sqrt(h2 + eps * eps);
  return (Math.atan((D + b) / sq) - Math.atan(b / sq)) / sq;
}

/** Henyey-Greenstein without the 1/4pi, so it averages 1 over the sphere; cosT = 1 is forward scattering (looking towards the light). */
export function phaseHG(cosT: number, g: number): number {
  const g2 = g * g;
  return (1 - g2) / Math.pow(Math.max(1 + g2 - 2 * g * cosT, 1e-4), 1.5);
}

/** How squarely a doorway faces the light's travel: 0 below 0.02, 1 from 0.2. */
export function facing(inward: Vec3, travel: Vec3): number {
  return smoothstep(0.02, 0.2, dot(inward, travel));
}

// ---- Motes ----

/** GLSL's mod: x - y floor(x / y). */
const glslMod = (x: number, y: number) => x - y * Math.floor(x / y);

/** A mote's place: its seed tiled with period `span` in each axis, the copy nearest `cam`. */
export function moteWrap(p: Vec3, cam: Vec3, span: number, out: Vec3 = [0, 0, 0]): Vec3 {
  for (let k = 0; k < 3; k++) out[k] = cam[k] + glslMod(p[k] - cam[k] + 0.5 * span, span) - 0.5 * span;
  return out;
}

/**
 * The sum, over the pixels a GL point of `sizePx` covers (pixel centres inside the square about the
 * point), of the mote kernel, with the point's centre at sub-pixel offset (ox, oy) from a pixel
 * corner. Divided by (pi / 16) x size^2 it is the drawn energy over the kernel's integral.
 */
export function moteSpriteSum(sizePx: number, ox: number, oy: number): number {
  const half = sizePx / 2;
  const x0 = Math.ceil(ox - half - 0.5);
  const x1 = Math.floor(ox + half - 0.5);
  const y0 = Math.ceil(oy - half - 0.5);
  const y1 = Math.floor(oy + half - 0.5);
  let sum = 0;
  for (let py = y0; py <= y1; py++) {
    const cy = py + 0.5;
    if (cy < oy - half || cy >= oy + half) continue;
    const ty = (cy - (oy - half)) / sizePx - 0.5;
    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5;
      if (cx < ox - half || cx >= ox + half) continue;
      const tx = (cx - (ox - half)) / sizePx - 0.5;
      sum += Math.exp(-MOTE_KERNEL * (tx * tx + ty * ty));
    }
  }
  return sum;
}

/** A small seeded generator (mulberry32): the same motes every session. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each mote's four seeds: its place in the tile (xyz, 0..1) and a spare (w, 0..1) for its size, wander and twinkle. */
export function moteSeeds(count: number, seed = 0x5eed): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(count * 4);
  for (let i = 0; i < out.length; i++) out[i] = rnd();
  return out;
}
