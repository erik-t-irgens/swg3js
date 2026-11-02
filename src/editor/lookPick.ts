// The world editor's looks and attachments as rules (Map-maker II's seventh wave, Map-maker I's §2.7 and §7): what a row's
// materials are called, a look changed on one of them, an attachment hung where the aim met a row (in the model's own frame),
// one moved by the hand, and a mark's row. The glue is `editorLooks.ts`; nothing here touches the game.
//
// Pure (three's maths only): no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts`
// extension, no enum, no namespace, no constructor parameter properties.

import * as THREE from 'three';
import { PLACEMENT_LIMITS, fromGame, type GamePlace, type PlacementFrame, type PlacementRow, type RowAttach, type RowLook } from '../story/placements.ts';

/** One material of a model as the Selected tab lists it: its name, whether it has a picture, and on which coordinate set. */
export interface MaterialItem {
  name: string;
  map: boolean;
  channel: number;
  material: THREE.Material;
}

/**
 * A model's materials by their names, the shell's first and each name once (a building's rooms carry copies of the shell's
 * own under the same names): what a look's `of` names. Every piece is a primitive's material.
 */
export function materialList(prims: readonly { material: THREE.Material | THREE.Material[]; cell?: number }[]): MaterialItem[] {
  const out: MaterialItem[] = [];
  const seen = new Set<string>();
  const sorted = [...prims].sort((a, b) => ((a.cell ?? 0) > 0 ? 1 : 0) - ((b.cell ?? 0) > 0 ? 1 : 0));
  for (const p of sorted) {
    for (const m of Array.isArray(p.material) ? p.material : [p.material]) {
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      const map = (m as THREE.MeshStandardMaterial).map;
      out.push({ name: m.name, map: !!map, channel: map?.channel ?? 0, material: m });
    }
  }
  return out;
}

/**
 * Why one of the owner's own imported models lends no picture or material to a look (Map-maker II's tenth wave): a look names
 * its donor by a pack the world finds again at every arrival, and an imports folder is no such pack (the private one is the
 * dev server's alone, so a look written on it would stand nowhere a player sees).
 */
export const IMPORTED_LENDS_NO_LOOK = "one of your own imported models lends no picture or material to a look: take it from one of the game's own models, or name the game's picture in that model's record (borrow)";

/** What a look change asks of one material: a tint (null takes it off), a borrowed picture or material (null takes it off), or every look of it cleared. */
export interface LookChange {
  tint?: string | null;
  map?: string | null;
  like?: string | null;
  clear?: boolean;
}

/**
 * A row's looks with one material's changed (`of`, a name in the model or `*`): cleared, a borrowed material put in place of
 * whatever it wore (a material stands alone), or a tint and a borrowed picture set or taken off beside each other (a borrowed
 * material taken off first). An entry left with nothing is taken out, and a list left with nothing is none (`undefined`),
 * which is how a row writes it. The other materials' looks are as they were, in their order.
 */
export function lookWith(mats: readonly RowLook[] | undefined, of: string, change: LookChange): RowLook[] | undefined {
  const list = mats ? mats.map((m) => ({ ...m })) : [];
  const i = list.findIndex((m) => m.of === of);
  const was = i >= 0 ? list[i] : null;
  let next: RowLook | null;
  if (change.clear) next = null;
  else if (typeof change.like === 'string') next = { of, like: change.like };
  else {
    next = was && !was.like ? { ...was } : { of };
    if (change.like === null && was?.like) next = { of };
    if (change.tint !== undefined) {
      if (change.tint === null) delete next.tint;
      else next.tint = change.tint.toLowerCase();
    }
    if (change.map !== undefined) {
      if (change.map === null) delete next.map;
      else next.map = change.map;
    }
    if (!next.tint && !next.map && !next.like) next = null;
  }
  if (next) {
    // The fields in one order (of, tint, map, like), so one look has one spelling in the file.
    const tidy: RowLook = { of: next.of };
    if (next.tint) tidy.tint = next.tint;
    if (next.map) tidy.map = next.map;
    if (next.like) tidy.like = next.like;
    if (i >= 0) list[i] = tidy;
    else list.push(tidy);
  } else if (i >= 0) list.splice(i, 1);
  return list.length ? list : undefined;
}

/** A number to the millimetre (an attachment's place, as the editor writes it). */
function mm(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** A number cut to `digits` decimals. */
function cut(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

const tM = new THREE.Matrix4();
const tV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * Where a point of the game's frame stands in a row's own model frame (`base`: the row's place, turn and scale), to the
 * millimetre: what an attachment hung where the aim met the row writes as its `at` (in the model's frame as the game draws
 * it, so it rides the row's own scale and turn).
 */
export function attachAtHit(base: THREE.Matrix4, hit: { x: number; y: number; z: number }, lift = 0): [number, number, number] {
  tM.copy(base).invert();
  tV.set(hit.x, hit.y + lift, hit.z).applyMatrix4(tM);
  return [mm(tV.x), mm(tV.y), mm(tV.z)];
}

/** What a hand does to one attachment: a move along its model's own axes (metres), a turn about its up (radians), a size factor. */
export interface AttachChange {
  dx?: number;
  dy?: number;
  dz?: number;
  turn?: number;
  size?: number;
}

/**
 * One attachment moved (`AttachChange`), as the editor writes it: its place to the millimetre within the backstop, its turn
 * composed about its own up (a sound has none) to six decimals, its size (an effect's) multiplied and held within the
 * backstops to four, the origin, no turn and a size of 1 written absent.
 */
export function attachMoved(a: RowAttach, c: AttachChange): RowAttach {
  const L = PLACEMENT_LIMITS;
  const out: RowAttach = a.fx ? { fx: a.fx } : { snd: a.snd };
  const at = a.at ?? [0, 0, 0];
  const held = (v: number) => Math.max(-L.attachReach, Math.min(L.attachReach, mm(v)));
  const nat: [number, number, number] = [held(at[0] + (c.dx ?? 0)), held(at[1] + (c.dy ?? 0)), held(at[2] + (c.dz ?? 0))];
  if (nat[0] !== 0 || nat[1] !== 0 || nat[2] !== 0) out.at = nat;
  if (a.fx) {
    const q = a.q ?? [1, 0, 0, 0];
    let w = q[0];
    let x = q[1];
    let y = q[2];
    let z = q[3];
    if (c.turn) {
      // Its turn composed with a turn about up, in its own frame: q * r.
      const rw = Math.cos(c.turn / 2);
      const ry = Math.sin(c.turn / 2);
      const nw = w * rw - y * ry;
      const nx = x * rw - z * ry;
      const ny = y * rw + w * ry;
      const nz = z * rw + x * ry;
      w = nw;
      x = nx;
      y = ny;
      z = nz;
    }
    const n = Math.hypot(w, x, y, z) || 1;
    const t: [number, number, number, number] = [cut(w / n, 6), cut(x / n, 6), cut(y / n, 6), cut(z / n, 6)];
    if (!(t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 0)) out.q = t;
    const s = Math.max(L.sizeMin, Math.min(L.sizeMax, cut((a.size ?? 1) * (c.size ?? 1), 4)));
    if (s !== 1) out.size = s;
  }
  return out;
}

const tQ3 = new THREE.Quaternion();

/**
 * `attachMoved`'s frame and size, worked out without making anything (the hand's live carry, a frame's work): its place and
 * turn into `out`, its size into `sized.v`, every number as the written one will read (to the millimetre, the six decimals and
 * the four, within the backstops). Answers `out`.
 */
export function attachMovedFrame(a: RowAttach, c: AttachChange, out: THREE.Matrix4, sized: { v: number }): THREE.Matrix4 {
  const L = PLACEMENT_LIMITS;
  const at = a.at;
  const r = L.attachReach;
  const x0 = mm((at ? at[0] : 0) + (c.dx ?? 0));
  const y0 = mm((at ? at[1] : 0) + (c.dy ?? 0));
  const z0 = mm((at ? at[2] : 0) + (c.dz ?? 0));
  tV.set(x0 < -r ? -r : x0 > r ? r : x0, y0 < -r ? -r : y0 > r ? r : y0, z0 < -r ? -r : z0 > r ? r : z0);
  const q = a.q;
  let w = q ? q[0] : 1;
  let x = q ? q[1] : 0;
  let y = q ? q[2] : 0;
  let z = q ? q[3] : 0;
  const turn = a.fx ? (c.turn ?? 0) : 0;
  if (turn) {
    const rw = Math.cos(turn / 2);
    const ry = Math.sin(turn / 2);
    const nw = w * rw - y * ry;
    const nx = x * rw - z * ry;
    const ny = y * rw + w * ry;
    const nz = z * rw + x * ry;
    w = nw;
    x = nx;
    y = ny;
    z = nz;
  }
  const n = Math.sqrt(w * w + x * x + y * y + z * z) || 1;
  tQ3.set(cut(x / n, 6), cut(y / n, 6), cut(z / n, 6), cut(w / n, 6));
  const s = a.fx ? cut((a.size ?? 1) * (c.size ?? 1), 4) : 1;
  sized.v = s < L.sizeMin ? L.sizeMin : s > L.sizeMax ? L.sizeMax : s;
  return out.compose(tV, tQ3, ONE);
}

/**
 * A row with one attachment hung on it, or why not in words: past the backstop it is refused (the reader would keep the
 * whole list out as a field it does not read).
 */
export function withAttachment(row: PlacementRow, a: RowAttach): PlacementRow | string {
  const list = row.attach ?? [];
  if (list.length >= PLACEMENT_LIMITS.attachments) return `${row.id} carries ${PLACEMENT_LIMITS.attachments} attachments, as many as a row may`;
  const { at: _at, ...rest } = row;
  return { ...rest, attach: [...list, a] } as PlacementRow;
}

/** A row with its attachment `i` put in place of what it was, or taken out (`null`); none left is none at all. */
export function withAttachmentAt(row: PlacementRow, i: number, a: RowAttach | null): PlacementRow {
  const list = [...(row.attach ?? [])];
  if (a) list[i] = a;
  else list.splice(i, 1);
  const { at: _at, attach: _old, ...rest } = row;
  return (list.length ? { ...rest, attach: list } : rest) as PlacementRow;
}

/** A row with its looks put in place of what they were (none: taken off). */
export function withLooks(row: PlacementRow, mats: RowLook[] | undefined): PlacementRow {
  const { at: _at, mats: _old, ...rest } = row;
  return (mats && mats.length ? { ...rest, mats } : rest) as PlacementRow;
}

/**
 * A mark's row (`kind: 'mark'`), as the editor writes it: its place in the file's frame to the millimetre, no turn, whether
 * it stands in a room, out in the open the ground under it, and what it carries. Its id the endpoint's (from `mark`).
 */
export function markRow(attach: RowAttach[], place: { x: number; y: number; z: number }, centre: { x: number; z: number } | null, frame: PlacementFrame, inside: boolean, ground: number | null): Omit<PlacementRow, 'id'> {
  const g = fromGame({ x: place.x, y: place.y, z: place.z, q: [0, 0, 0, 1] } as GamePlace, centre, frame);
  const row: Omit<PlacementRow, 'id'> = { kind: 'mark', x: mm(g.x), y: mm(g.y), z: mm(g.z), q: [1, 0, 0, 0], attach };
  if (inside) row.inside = true;
  else if (ground !== null && Number.isFinite(ground)) row.ground = mm(ground);
  return row;
}
