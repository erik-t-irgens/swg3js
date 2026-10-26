// The world editor's selection (DESIGN.md §2.6): what is picked to be moved, turned, raised, scaled, copied or deleted,
// by the ids of the permanent rows it names, in the order they were picked.
//
// A click picks the nearest pickable on the aim; **Shift with a click adds what is not picked and takes away what is**
// (there is no Ctrl with a click: W with Ctrl closes the tab). In Point mode a drag from empty ground draws a box, and
// what stands with its middle inside the box on the screen is picked (Shift adds, Alt takes away). "All like this" picks
// every row of the same model. Picking writes nothing, so a Shift held to fly fast at the moment of a click costs a box
// on the screen and nothing more.
//
// The **pivot** a selection turns, raises and scales about is the one row's own origin, or for several the bottom middle
// of the box round them all [ours].
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

/** How a pick changes what is picked: in place of it, added to it, or taken out of it. */
export type PickMode = 'set' | 'add' | 'take';

/** The selection: row ids in the order they were picked. */
export class Selection {
  private list: string[] = [];
  private set = new Set<string>();
  /** Counted up at every change, so whoever draws the selection knows when to look again. */
  version = 0;

  get ids(): readonly string[] {
    return this.list;
  }

  get size(): number {
    return this.list.length;
  }

  has(id: string): boolean {
    return this.set.has(id);
  }

  /** The first picked: what the bar names. */
  get first(): string | null {
    return this.list.length ? this.list[0] : null;
  }

  /**
   * A click on the aim: `id` the pickable under it (null for nothing). Plain, it is the whole selection (nothing clears
   * it); with Shift (`add`) it is added when not picked and taken away when it is; nothing under a Shift click changes
   * nothing. Answers whether anything changed.
   */
  click(id: string | null, shift: boolean): boolean {
    if (shift) {
      if (!id) return false;
      if (this.set.has(id)) this.remove([id]);
      else this.add([id]);
      return true;
    }
    if (!id) return this.clear();
    if (this.list.length === 1 && this.list[0] === id) return false;
    this.replace([id]);
    return true;
  }

  /** Picked in place of, added to, or taken out of what is picked. Answers whether anything changed. */
  pick(ids: readonly string[], mode: PickMode): boolean {
    if (mode === 'set') return this.replace(ids);
    if (mode === 'add') return this.add(ids);
    return this.remove(ids);
  }

  /** Nothing picked. */
  clear(): boolean {
    if (!this.list.length) return false;
    this.list = [];
    this.set = new Set();
    this.version++;
    return true;
  }

  /** Every id that names nothing standing any more let go (a row taken out of its file, a world gone). */
  keepOnly(alive: (id: string) => boolean): boolean {
    const kept = this.list.filter(alive);
    if (kept.length === this.list.length) return false;
    this.list = kept;
    this.set = new Set(kept);
    this.version++;
    return true;
  }

  /** An id renamed under the selection (a paste's ids, an undo's). */
  rename(from: string, to: string): void {
    const i = this.list.indexOf(from);
    if (i < 0) return;
    this.list[i] = to;
    this.set.delete(from);
    this.set.add(to);
    this.version++;
  }

  private replace(ids: readonly string[]): boolean {
    const uniq = [...new Set(ids)];
    if (uniq.length === this.list.length && uniq.every((id, i) => this.list[i] === id)) return false;
    this.list = uniq;
    this.set = new Set(uniq);
    this.version++;
    return true;
  }

  private add(ids: readonly string[]): boolean {
    let changed = false;
    for (const id of ids) {
      if (this.set.has(id)) continue;
      this.set.add(id);
      this.list.push(id);
      changed = true;
    }
    if (changed) this.version++;
    return changed;
  }

  private remove(ids: readonly string[]): boolean {
    let changed = false;
    for (const id of ids) {
      if (!this.set.delete(id)) continue;
      changed = true;
    }
    if (!changed) return false;
    this.list = this.list.filter((id) => this.set.has(id));
    this.version++;
    return true;
  }
}

/** Which way a box drawn with a modifier picks: Shift adds, Alt takes away, plain is in place of. */
export function boxMode(shift: boolean, alt: boolean): PickMode {
  if (alt) return 'take';
  return shift ? 'add' : 'set';
}

/** A rectangle on the screen, CSS pixels, either corner first. */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Which of `things` a box on the screen picks: those whose middle, projected (`project`, false behind the eye), lands
 * inside the rectangle. In the order handed in.
 */
export function inBox<T extends { id: string }>(things: readonly T[], rect: ScreenRect, project: (t: T, out: Float64Array) => boolean): string[] {
  const xl = Math.min(rect.x0, rect.x1);
  const xh = Math.max(rect.x0, rect.x1);
  const yl = Math.min(rect.y0, rect.y1);
  const yh = Math.max(rect.y0, rect.y1);
  const pt = new Float64Array(2);
  const out: string[] = [];
  for (const t of things) {
    if (!project(t, pt)) continue;
    if (pt[0] >= xl && pt[0] <= xh && pt[1] >= yl && pt[1] <= yh) out.push(t.id);
  }
  return out;
}

/** One picked thing as the pivot needs it: its origin, and its box at the size it stands, already turned and placed (world corners), or null. */
export interface PivotThing {
  x: number;
  y: number;
  z: number;
  /** The world box round it (its turned box's corners taken componentwise), or null for a thing with none. */
  lo: [number, number, number] | null;
  hi: [number, number, number] | null;
}

/**
 * The point a selection turns, raises and scales about, into `out`: the one thing's own origin, or for several the
 * bottom middle of the box round them all (their world boxes, or their origins where they have none) [ours]. Answers
 * false for nothing picked.
 */
export function pivotOf(things: readonly PivotThing[], out: { x: number; y: number; z: number }): boolean {
  if (!things.length) return false;
  if (things.length === 1) {
    out.x = things[0].x;
    out.y = things[0].y;
    out.z = things[0].z;
    return true;
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const t of things) {
    const lo = t.lo ?? [t.x, t.y, t.z];
    const hi = t.hi ?? [t.x, t.y, t.z];
    if (lo[0] < x0) x0 = lo[0];
    if (lo[1] < y0) y0 = lo[1];
    if (lo[2] < z0) z0 = lo[2];
    if (hi[0] > x1) x1 = hi[0];
    if (hi[2] > z1) z1 = hi[2];
  }
  out.x = (x0 + x1) / 2;
  out.y = y0;
  out.z = (z0 + z1) / 2;
  return true;
}

/**
 * A box's world corners, componentwise, into `lo` and `hi`: the box `min`..`max` (either corner first) at a scale along
 * its own axes, turned by `q` (three's order) and stood at `p`. What the pivot, the box selection's middles and the
 * snaps read, from the models' own boxes so no mesh is read.
 */
export function worldBox(min: ArrayLike<number>, max: ArrayLike<number>, sx: number, sy: number, sz: number, q: { x: number; y: number; z: number; w: number }, p: { x: number; y: number; z: number }, lo: [number, number, number], hi: [number, number, number]): void {
  lo[0] = lo[1] = lo[2] = Infinity;
  hi[0] = hi[1] = hi[2] = -Infinity;
  for (let c = 0; c < 8; c++) {
    const vx = (c & 1 ? Math.max(min[0], max[0]) : Math.min(min[0], max[0])) * sx;
    const vy = (c & 2 ? Math.max(min[1], max[1]) : Math.min(min[1], max[1])) * sy;
    const vz = (c & 4 ? Math.max(min[2], max[2]) : Math.min(min[2], max[2])) * sz;
    const tx = 2 * (q.y * vz - q.z * vy);
    const ty = 2 * (q.z * vx - q.x * vz);
    const tz = 2 * (q.x * vy - q.y * vx);
    const x = p.x + vx + q.w * tx + (q.y * tz - q.z * ty);
    const y = p.y + vy + q.w * ty + (q.z * tx - q.x * tz);
    const z = p.z + vz + q.w * tz + (q.x * ty - q.y * tx);
    if (x < lo[0]) lo[0] = x;
    if (y < lo[1]) lo[1] = y;
    if (z < lo[2]) lo[2] = z;
    if (x > hi[0]) hi[0] = x;
    if (y > hi[1]) hi[1] = y;
    if (z > hi[2]) hi[2] = z;
  }
}

/**
 * "All like this": every row of `rows` that is the same thing as `like` (the same props thing, else the same model out
 * of the same pack and world), within `reach` metres of `at` on the ground when one is given, else in the file.
 */
export function likeThis<T extends { id: string; pack: string; thing?: string; model?: string; from?: string; x: number; z: number }>(rows: readonly T[], like: { pack: string; thing?: string; model?: string; from?: string }, at: { x: number; z: number } | null, reach: number): string[] {
  const same = (r: T) => r.pack === like.pack && (like.pack === 'props' ? r.thing === like.thing : r.model === like.model && (r.from ?? '') === (like.from ?? ''));
  const out: string[] = [];
  for (const r of rows) {
    if (!same(r)) continue;
    if (at && (r.x - at.x) ** 2 + (r.z - at.z) ** 2 > reach * reach) continue;
    out.push(r.id);
  }
  return out;
}
