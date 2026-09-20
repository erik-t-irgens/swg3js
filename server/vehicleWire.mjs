// The vehicle a player is on, as the relay passes it on in their state: which vehicle, where it
// stands, how it is turned, how the player is on it, the riding pose, a winged ship's wings and
// whether it is set down on the ground. Dependency-free, shared by the relay and the tests.
// Everything is checked and kept small; anything else is dropped, so a client on another build
// can neither grow a message nor put anything unexpected through the relay.

const VEHICLE_ID = /^[A-Za-z0-9_.\- ]+$/;
const ROLES = ['ride', 'pilot', 'aboard'];
/** The words two browsers pass about one ship clamped onto another. */
const ASK_WORDS = ['dock', 'allow', 'refuse', 'undock'];

/** Three finite numbers, or null. */
function vec3(x) {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const out = x.map(Number);
  return out.some((v) => !Number.isFinite(v)) ? null : out;
}

/** Four finite numbers, or null. */
export function quat(x) {
  if (!Array.isArray(x) || x.length !== 4) return null;
  const out = x.map(Number);
  return out.some((v) => !Number.isFinite(v)) ? null : out;
}

/**
 * A cleaned copy of a state's `veh`, or undefined when it is not one:
 * `{ id, p, q, role, pose?, w?, landed? }`. id: at most 48 characters of letters, digits, dots,
 * dashes, spaces and underscores; p: three finite numbers; q: four finite numbers; role: ride,
 * pilot or aboard (ride otherwise); pose: at most 48 characters, kept as it is sent (an empty one is
 * a rider in the vehicle's own default pose); w and landed: 0 or 1, and kept only when they were sent.
 */
export function cleanVehicle(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.id !== 'string' || !x.id || x.id.length > 48 || !VEHICLE_ID.test(x.id)) return undefined;
  const p = vec3(x.p);
  const q = quat(x.q);
  if (!p || !q) return undefined;
  const out = { id: x.id, p, q, role: ROLES.includes(x.role) ? x.role : 'ride' };
  if (typeof x.pose === 'string') out.pose = x.pose.slice(0, 48);
  if (x.w === 0 || x.w === 1) out.w = x.w;
  if (x.landed === 0 || x.landed === 1) out.landed = x.landed;
  const dock = cleanDock(x.dock);
  if (dock) out.dock = dock;
  return out;
}

/**
 * A cleaned copy of a vehicle's `dock`, or undefined when it is not one: `{ to, p, q }`, where `to` is
 * the id of the player whose ship carries this one and `p`/`q` are where it rests in that ship's own
 * frame. A ship clamped onto another is drawn from the carrier's pose times this, so it stays exactly
 * where it was put between messages instead of gliding about on the hull.
 *
 * `to` is a whole number above zero (the relay's own ids start at 1), so a client cannot name nobody
 * and cannot name a ship with a fraction of an id.
 */
export function cleanDock(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const to = Number(x.to);
  if (!Number.isInteger(to) || to <= 0) return undefined;
  const p = vec3(x.p);
  const q = quat(x.q);
  if (!p || !q) return undefined;
  return { to, p, q };
}

/**
 * A cleaned copy of a directed `ask`, or undefined when it is not one: `{ to, word }`. It is the one
 * message a client sends to a single other player rather than to everyone -- asking their pilot for
 * room on their hull, and the answer -- so it is checked as tightly as a broadcast is, and the relay
 * drops it when the player named is not there.
 */
export function cleanAsk(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const to = Number(x.to);
  if (!Number.isInteger(to) || to <= 0) return undefined;
  if (typeof x.word !== 'string' || !ASK_WORDS.includes(x.word)) return undefined;
  return { to, word: x.word };
}
