// The vehicle a player is on, as the relay passes it on in their state: which vehicle, where it
// stands, how it is turned, how the player is on it, the riding pose, a winged ship's wings and
// whether it is set down on the ground. Dependency-free, shared by the relay and the tests.
// Everything is checked and kept small; anything else is dropped, so a client on another build
// can neither grow a message nor put anything unexpected through the relay.

const VEHICLE_ID = /^[A-Za-z0-9_.\- ]+$/;
const ROLES = ['ride', 'pilot', 'aboard'];

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
  return out;
}
