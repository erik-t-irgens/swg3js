// What the world's removal file took away, as the readers outside the streamer ask after it (Map-maker II's twelfth wave,
// Map-maker I §2.9's table): the placed sounds, the fittings and the travel things, and the people standing in a hidden
// building's rooms. The streamer sees only what is filed and needs none of this.
//
// Kept in the layout's own frame (raw on a planet), which is the frame the placed sounds are written in; a fitting's or a
// travel thing's building is carried back into it from the game's (`gameTo`), as every reader carries the other way.
//
// Pure: no three. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no
// namespace, no constructor parameter properties.

/** A template's two spellings as one (`shared_` or not, slashes and case), as the layout's own `sameTemplateName` reads them. */
export function plainTemplate(t: string): string {
  return t.replace(/\\/g, '/').toLowerCase().replace(/\/shared_([^/]+)$/, '/$1');
}

/** One hidden object: its template, its place in the layout's own frame, and its own box (a building's), where known. */
export interface HiddenObject {
  template: string;
  x: number;
  y: number;
  z: number;
  contained: boolean;
  /** Its turn as the layout writes it (`[w, x, y, z]`, the layout's own frame), for a building's box; none, unturned. */
  q?: readonly number[] | null;
  /** A building's model box in its own frame (corners in either order), for the people standing in its rooms. */
  box?: { min: readonly number[]; max: readonly number[] } | null;
}

/** How near a building's place a child's `bx`, `bz` must name it to be its child, metres (the copies' own filter's metre). */
export const HIDDEN_CHILD_REACH = 1;

/** The hidden objects of a world, asked at an arrival and at each landing, never in a frame. */
export class HiddenPlaces {
  readonly objects: readonly HiddenObject[];
  private readonly buildings: HiddenObject[];

  constructor(objects: readonly HiddenObject[]) {
    this.objects = objects;
    this.buildings = objects.filter((o) => !o.contained);
  }

  get empty(): boolean {
    return this.objects.length === 0;
  }

  /** Whether a hidden building of this template stands at a place of the layout's own frame (within `reach` across the ground). */
  buildingAt(template: string, x: number, z: number, reach = HIDDEN_CHILD_REACH): boolean {
    if (!this.buildings.length) return false;
    const want = plainTemplate(template);
    for (const b of this.buildings) {
      if (Math.abs(b.x - x) > reach || Math.abs(b.z - z) > reach) continue;
      if (plainTemplate(b.template) === want) return true;
    }
    return false;
  }

  /** Whether any hidden building stands at a place (whatever its template: a placed sound names its building by place alone). */
  anyBuildingAt(x: number, z: number, reach = HIDDEN_CHILD_REACH): boolean {
    for (const b of this.buildings) if (Math.abs(b.x - x) <= reach && Math.abs(b.z - z) <= reach) return true;
    return false;
  }

  /** Whether a hidden object of this template stands within `reach` of a point (height counting). */
  objectAt(template: string, x: number, y: number, z: number, reach: number): boolean {
    if (!this.objects.length) return false;
    const want = plainTemplate(template);
    const r2 = reach * reach;
    for (const o of this.objects) {
      if ((o.x - x) ** 2 + (o.y - y) ** 2 + (o.z - z) ** 2 > r2) continue;
      if (plainTemplate(o.template) === want) return true;
    }
    return false;
  }

  /**
   * Whether a placed sound goes with a hide (Map-maker I §2.9): its template and place match a hidden object, or the
   * building it stands in (`pob`, `bp`) is a hidden one. `match` is `HIDE_TUNE.match`.
   */
  emitterHidden(e: { template?: string; p?: readonly number[]; pob?: string; bp?: readonly number[] }, match: number): boolean {
    if (!this.objects.length) return false;
    if (e.template && e.p && e.p.length >= 3 && this.objectAt(e.template, e.p[0], e.p[1], e.p[2], match)) return true;
    if (e.pob && e.bp && e.bp.length >= 3 && this.anyBuildingAt(e.bp[0], e.bp[2], match)) return true;
    return false;
  }

  /**
   * Whether one of the people stands in a hidden building's rooms (the people's rows are in the layout's own frame as the
   * pack wrote them): stood in a room by the data, at a place inside that building's box grown by `grow` -- the fillers'
   * own test (`standsInside`). A person outdoors, perched on a hidden platform, is never one: they are let down.
   */
  personInside(r: { x: number; y: number; z: number; cell?: number }, grow: number): boolean {
    if (!r.cell || !this.buildings.length) return false;
    for (const b of this.buildings) {
      if (!b.box) continue;
      // The point into the building's model frame, exactly as the streamer stands the model: the layout's raw offset carried
      // into the game's (x mirrored, `placementFrame`), then turned back by the game's turn (the layout's quaternion with its
      // y and z negated) -- its conjugate, as the inverse of a unit turn.
      const vx = -(r.x - b.x);
      const vy = r.y - b.y;
      const vz = r.z - b.z;
      const q = b.q ?? null;
      // The game's turn is (x: q1, y: -q2, z: -q3, w: q0); its inverse turns by (-q1, q2, q3, q0).
      const qx = q ? -q[1] : 0;
      const qy = q ? q[2] : 0;
      const qz = q ? q[3] : 0;
      const qw = q ? q[0] : 1;
      // v' = v + w t + q × t, with t = 2 (q × v).
      const tx = 2 * (qy * vz - qz * vy);
      const ty = 2 * (qz * vx - qx * vz);
      const tz = 2 * (qx * vy - qy * vx);
      const lx = vx + qw * tx + (qy * tz - qz * ty);
      const ly = vy + qw * ty + (qz * tx - qx * tz);
      const lz = vz + qw * tz + (qx * ty - qy * tx);
      const mn = b.box.min;
      const mx = b.box.max;
      if (lx < Math.min(mn[0], mx[0]) - grow || lx > Math.max(mn[0], mx[0]) + grow) continue;
      if (ly < Math.min(mn[1], mx[1]) - grow || ly > Math.max(mn[1], mx[1]) + grow) continue;
      if (lz < Math.min(mn[2], mx[2]) - grow || lz > Math.max(mn[2], mx[2]) + grow) continue;
      return true;
    }
    return false;
  }
}

/** A point of the game's frame carried back into the layout's own about its centre (the streamer's mirror undone). */
export function gameTo(gx: number, gz: number, centre: { x: number; z: number }): { x: number; z: number } {
  return { x: centre.x - gx, z: gz + centre.z };
}

/** The yaw about up of a layout quaternion `[w, x, y, z]` in the layout's own frame (`atan2` of its turned +x). */
export function layoutYaw(q: readonly number[]): number {
  const w = q[0];
  const x = q[1];
  const y = q[2];
  const z = q[3];
  // The layout's +x turned: (1 - 2(y² + z²), 2(xy + wz), 2(xz - wy)); its heading across the ground.
  const ax = 1 - 2 * (y * y + z * z);
  const az = 2 * (x * z - w * y);
  return Math.atan2(-az, ax);
}
