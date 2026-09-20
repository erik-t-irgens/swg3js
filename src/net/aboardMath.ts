// Standing in a hull somebody else flies: the shape of what crosses, the rule that it takes the
// place of the vehicle a player rides, and the maths of putting a figure where that hull puts it.
//
// Nothing here knows about three.js or the page, so the node test runs it directly, the way
// `weatherSchedule.ts` and `dockingMath.ts` already are run. The vectors and quaternions it is
// given are read and written by their fields, which is what a three.js `Vector3` and `Quaternion`
// already are, so the game passes its own objects in and nothing is allocated.

/** Anything with the three fields of a place: the game hands in its own vectors. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Anything with the four fields of a turn: the game hands in its own quaternions. */
export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * A player who is in a hull somebody else flies: whose hull (their relay id), and where they stand
 * and which way they face **in that hull's own frame**.
 *
 * It takes the place of the vehicle they ride rather than joining it. Two people crewing one ship
 * each sending their own copy of the hull would have everyone else build two of it in the same
 * place; one of them sends the hull and the rest say which hull they are in, so a watcher draws one
 * hull with people in it. The place is the hull's frame and not the world's on purpose: the figure
 * and the hull come from two different players' messages, arriving on two different clocks, so a
 * world place glided on its own would have the passenger swim about the cabin and through its walls.
 */
export interface PeerAboard {
  /** The relay id of the player whose hull this is. */
  ship: number;
  /** Where the figure stands in that hull's own frame. */
  p: [number, number, number];
  /** Which way it faces in that frame. */
  h: number;
}

/**
 * A state's `in` when it is one, and undefined when it is not. The server checks the same shape
 * (`cleanAboard` in server/vehicleWire.mjs) and this is the browser's own guard over it: a state
 * also reaches this side straight out of the roster a server sends on arrival, and a far end on
 * another build can send `in: true` or a hull with no place in it. A missing place must not be
 * indexed and must not throw inside the socket's handler, which would cost every message after it.
 */
export function peerAboard(raw: unknown): PeerAboard | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const x = raw as { ship?: unknown; p?: unknown; h?: unknown };
  const ship = Number(x.ship);
  if (!Number.isInteger(ship) || ship <= 0) return undefined;
  const p = x.p;
  if (!Array.isArray(p) || p.length !== 3) return undefined;
  const px = Number(p[0]);
  const py = Number(p[1]);
  const pz = Number(p[2]);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return undefined;
  const h = Number(x.h);
  return { ship, p: [px, py, pz], h: Number.isFinite(h) ? h : 0 };
}

/**
 * What a peer is on, from the two fields a state can carry: either the vehicle they ride or fly,
 * which everyone draws, or the hull of another player's ship they are standing in, which is nobody's
 * to draw but the player who flies it. Never both, and a far end that sends both is taken at its
 * word about the hull it is in, since somebody else is already sending that hull. It is the same
 * rule the server keeps (`cleanRide`), on this side, so a roster or a relay on an older build cannot
 * put two hulls in one place either.
 */
export function rideFields<V>(rawIn: unknown, veh: V | undefined): { in?: PeerAboard; veh?: V } {
  const aboard = peerAboard(rawIn);
  if (aboard) return { in: aboard };
  return veh === undefined ? {} : { veh };
}

/**
 * Invented: the shortest glide anyone may ask for, so a zero or a negative one cannot divide by
 * nothing. A twentieth of a frame at any rate the game runs at, which is "instantly" in practice.
 */
export const MIN_GLIDE_SECONDS = 0.001;

/**
 * Where a passenger's figure goes: the hull's live pose applied to where the messages say they
 * stand in it, and the hull's turn with their own yaw inside it on top. It is the same transform
 * the game uses for its own figure aboard its own ship (the room's frame times the place, and the
 * room's turn times the heading), so a passenger stands where they would stand if this browser were
 * simulating the hull.
 *
 * `outQuat` is written field by field: hand it a scratch quaternion and copy that onto the object,
 * rather than the object's own, so a quaternion that tells its owner it changed is told once.
 * Nothing is allocated.
 */
export function placeInHull(hullPos: Vec3Like, hullQuat: QuatLike, local: Vec3Like, turn: number, outPos: Vec3Like, outQuat: QuatLike): void {
  const { x, y, z } = local;
  const qx = hullQuat.x;
  const qy = hullQuat.y;
  const qz = hullQuat.z;
  const qw = hullQuat.w;
  // The place, turned by the hull and then carried to where the hull is.
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  outPos.x = x + qw * tx + (qy * tz - qz * ty) + hullPos.x;
  outPos.y = y + qw * ty + (qz * tx - qx * tz) + hullPos.y;
  outPos.z = z + qw * tz + (qx * ty - qy * tx) + hullPos.z;
  // The turn: the hull's, then their own yaw within it (about the hull's own up, not the world's).
  const s = Math.sin(turn / 2);
  const c = Math.cos(turn / 2);
  outQuat.x = qx * c - qz * s;
  outQuat.y = qw * s + qy * c;
  outQuat.z = qx * s + qz * c;
  outQuat.w = qw * c - qy * s;
}

/**
 * A passenger's place and turn eased toward the last message, **in the hull's own frame**: the
 * place is nearly still there, so this smooths the tenth of a second between messages without the
 * figure ever being glided through the world on a clock that is not the hull's. The turn takes the
 * shorter way round, so facing across the half turn does not spin the figure the long way.
 *
 * `at` is written in place and the new turn is returned. Nothing is allocated.
 */
export function easeInHull(at: Vec3Like, target: Vec3Like, turn: number, heading: number, dt: number, glideSeconds: number): number {
  const k = 1 - Math.exp(-Math.max(0, dt) / Math.max(MIN_GLIDE_SECONDS, glideSeconds));
  at.x += (target.x - at.x) * k;
  at.y += (target.y - at.y) * k;
  at.z += (target.z - at.z) * k;
  let d = heading - turn;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return turn + d * k;
}
