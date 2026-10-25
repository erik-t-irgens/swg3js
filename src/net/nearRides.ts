// Other players' rides as the moving air reads them (the volumetrics' sixth wave, the design's §2.12): each ride whose
// picture is drawn here, near a point, written into the caller's kept typed arrays -- its place, the velocity its own game
// sent while the picture is reckoned (else the relay's smoothed one, as `vehiclePose` reads it), its turn, its kind, whether
// somebody sits at its controls or it is set down, its box's underside, middle and half length, the floor its kind flies
// from, and the picture's own key -- allocating nothing. The kept-record sibling of `RemotePlayers.nearPictures`, which
// writes places alone.
//
// **The box is the picture's own, in the picture's own frame** (`RemoteVehicle.box`, measured off its drawn meshes), never
// the pack's bounds: the garage frames every machine picture so its origin is the underside of its box, centred across and
// along (`Garage.frameModel`), and the place a peer sends is that same underside, so the pack's mesh box -- centred on its
// own origin, a ship's reaching 0.75 to 4.7 m under it -- put a hovering ship's downwash metres under its belly and read a
// ship 4 m up as standing on the ground. A hull of ours is read in that framed frame too (`spec.bounds`, its underside at
// nought).
//
// Nothing of anybody's is sent for it, and nothing is believed but what this screen already draws: a ride clamped onto
// another ship is left out (it rides that ship), as is a picture not in yet, a player shown nowhere (another world, or in a
// jump: `j`) and anybody on foot, who has no ride at all.
//
// Pure, its own file so the node test runs the very walk the game runs (`remotePlayers.ts` cannot load in node).

/** What a ride is to the air, by the garage def it is drawn from: nothing (a creature), or the thrust of a speeder, a pod, a flyer or a ship. */
export const RIDE_KIND = { none: 0, speeder: 1, pod: 2, flyer: 3, ship: 4 } as const;

/** A ride's flags: somebody seated in it or at its controls (`role` ride or pilot), and set down on the ground (the relay's `landed`). */
export const RIDE_FLAG = { driven: 1, landed: 2 } as const;

/** The air's kind code for a garage def: a creature stirs nothing, a ship (by kind or its pack) a ship's, the rest by kind as `kindExit` takes them. */
export function rideKindOf(def: { kind: string; source: string }): number {
  if (def.source === 'creature') return RIDE_KIND.none;
  if (def.kind === 'ship' || def.source === 'ship') return RIDE_KIND.ship;
  if (def.kind === 'podracer') return RIDE_KIND.pod;
  if (def.kind === 'flyer') return RIDE_KIND.flyer;
  return RIDE_KIND.speeder;
}

/**
 * The kept record the rides are written into: `n` of them, each field a typed array as long as the most it holds; and
 * where they were asked about, flat, and how far round it (written by the asker, so no number is handed across a call).
 */
export interface NearRides {
  atX: number;
  atZ: number;
  reach: number;
  n: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  vz: Float64Array;
  qx: Float64Array;
  qy: Float64Array;
  qz: Float64Array;
  qw: Float64Array;
  /** `RIDE_KIND`. */
  kind: Uint8Array;
  /** `RIDE_FLAG` bits. */
  flags: Uint8Array;
  /** The underside over the place, metres (the picture's box's lowest y in its own frame: nought for a framed machine at rest), and half the box's length along its nose. */
  low: Float64Array;
  half: Float64Array;
  /** The box's middle from the place, in the world (the picture's turn laid on it): where the push leaves from, less the tail. */
  cx: Float64Array;
  cy: Float64Array;
  cz: Float64Array;
  /** The floor its kind flies from, metres over the ground (a hull of ours of that kind's own `spec.fly.floor`; nought for one that does not fly). */
  floor: Float64Array;
  /** The picture's own key (its object's id): steady for the life of the picture, what a rut or a puff is owed under. */
  key: Float64Array;
}

/** A fresh record holding at most `most` rides. */
export function newNearRides(most = 16): NearRides {
  const m = Math.max(1, Math.floor(most));
  const r: NearRides = {
    atX: 0.5,
    atZ: 0.5,
    reach: 200.5,
    n: 0,
    x: new Float64Array(m),
    y: new Float64Array(m),
    z: new Float64Array(m),
    vx: new Float64Array(m),
    vy: new Float64Array(m),
    vz: new Float64Array(m),
    qx: new Float64Array(m),
    qy: new Float64Array(m),
    qz: new Float64Array(m),
    qw: new Float64Array(m),
    kind: new Uint8Array(m),
    flags: new Uint8Array(m),
    low: new Float64Array(m),
    half: new Float64Array(m),
    cx: new Float64Array(m),
    cy: new Float64Array(m),
    cz: new Float64Array(m),
    floor: new Float64Array(m),
    key: new Float64Array(m),
  };
  r.atX = 0;
  r.atZ = 0;
  r.reach = 200;
  return r;
}

/** What the walk reads of a peer's ride: the few fields of `RemotePlayers`' own record, so a test can hand it stand-ins. */
export interface RideOf {
  obj: { id: number; position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } } | null;
  dock: unknown;
  role: string;
  landed: boolean;
  reckoned: boolean;
  sentVel: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  airKind: number;
  /** The floor its kind flies from (`spec.fly.floor` of a hull of ours of that kind), nought for one that does not fly. */
  airFloor: number;
  /** The pack's own bounds: read only for the length and height when the picture's own box is not measured. */
  size: { bounds: { min: number[]; max: number[] } } | null;
  /** The picture's own box in its own frame (its origin the underside of a framed machine), or null before it is measured. */
  box: { half: readonly number[]; mid: readonly number[] } | null;
}

/** What the walk reads of a peer: whether they are drawn here, and their ride. */
export interface RiderOf {
  group: { visible: boolean };
  vehicle: RideOf | null;
}

/** The record the walk is writing into while it runs (`nearRidesIn`): an object, so writing it makes nothing. */
let walking: NearRides | null = null;

/**
 * One peer, into the record being walked (`walking`): the walk's kept visitor, so a map's peers are walked by its own
 * `forEach` and no iterator is made for them (a map's values iterated with `for ... of` made one a call, 25 bytes a frame).
 */
const visitRide = (r: RiderOf): void => {
  const out = walking;
  if (!out || out.n >= out.x.length) return;
  const rv = r.vehicle;
  if (!r.group.visible || !rv || !rv.obj || rv.dock) return;
  const p = rv.obj.position;
  const dx = p.x - out.atX;
  const dz = p.z - out.atZ;
  if (dx * dx + dz * dz > out.reach * out.reach) return;
  const i = out.n;
  out.x[i] = p.x;
  out.y[i] = p.y;
  out.z[i] = p.z;
  const v = rv.reckoned ? rv.sentVel : rv.vel;
  out.vx[i] = v.x;
  out.vy[i] = v.y;
  out.vz[i] = v.z;
  const q = rv.obj.quaternion;
  out.qx[i] = q.x;
  out.qy[i] = q.y;
  out.qz[i] = q.z;
  out.qw[i] = q.w;
  out.kind[i] = rv.airKind;
  out.flags[i] = (rv.role === 'ride' || rv.role === 'pilot' ? RIDE_FLAG.driven : 0) | (rv.landed ? RIDE_FLAG.landed : 0);
  out.floor[i] = rv.airFloor > 0 ? rv.airFloor : 0;
  // The box's middle and its half sizes in the picture's own frame: its measured box, else (not measured yet) a framed
  // machine's off the pack's lengths -- centred across and along, its underside at the place -- else a small one.
  let mx = 0;
  let my = 0;
  let mz = 0;
  let hy = 0;
  let hz = 1;
  const box = rv.box;
  const b = rv.size?.bounds;
  if (box) {
    mx = box.mid[0];
    my = box.mid[1];
    mz = box.mid[2];
    hy = box.half[1] < 0 ? -box.half[1] : box.half[1];
    hz = box.half[2] < 0 ? -box.half[2] : box.half[2];
  } else if (b) {
    const h = b.max[1] - b.min[1];
    const len = b.max[2] - b.min[2];
    hy = (h < 0 ? -h : h) * 0.5;
    hz = (len < 0 ? -len : len) * 0.5;
    my = hy;
  }
  out.low[i] = my - hy;
  out.half[i] = hz;
  // The middle turned by the picture's turn (q v q⁻¹, written out: t = 2 q×v, v + w t + q×t), so a ride turned or tipped
  // pushes from where its box stands.
  const tx = 2 * (q.y * mz - q.z * my);
  const ty = 2 * (q.z * mx - q.x * mz);
  const tz = 2 * (q.x * my - q.y * mx);
  out.cx[i] = mx + q.w * tx + (q.y * tz - q.z * ty);
  out.cy[i] = my + q.w * ty + (q.z * tx - q.x * tz);
  out.cz[i] = mz + q.w * tz + (q.x * ty - q.y * tx);
  out.key[i] = rv.obj.id;
  out.n++;
};

/**
 * Every shown peer's ride whose picture stands within `out.reach` of (`out.atX`, `out.atZ`) (flat), into `out` (`out.n`
 * of them, at most as many as its arrays hold), walked by the list's own `forEach` (a map's or an array's). Answers
 * `out.n`. Nothing is allocated.
 */
export function nearRidesIn(peers: { forEach(visit: (r: RiderOf) => void): void }, out: NearRides): number {
  out.n = 0;
  walking = out;
  try {
    peers.forEach(visitRide);
  } finally {
    walking = null;
  }
  return out.n;
}
