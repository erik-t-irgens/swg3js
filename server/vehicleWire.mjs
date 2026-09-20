// The vehicle a player is on, as the relay passes it on in their state: which vehicle, where it
// stands, how it is turned, how the player is on it, the riding pose, a winged ship's wings and
// whether it is set down on the ground. Dependency-free, shared by the relay and the tests.
// Everything is checked and kept small; anything else is dropped, so a client on another build
// can neither grow a message nor put anything unexpected through the relay.
//
// A player who is in a hull somebody else flies says so instead (`in`): whose hull, and where they
// stand in that hull's own frame. Two people crewing one ship each sending a copy of the hull would
// have everyone else build two of it, one inside the other -- doubled geometry fighting for the
// same pixels, doubled engine glows and trails, and both handed to the motion blur. One of them
// sends the hull and the rest say which hull they are in, so a watcher draws one hull with people
// in it. `cleanRide` is the rule in one place: a state may carry one or the other, never both.

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
 * A cleaned copy of a state's `in`, or undefined when it is not one: `{ ship, p, h }`, where `ship`
 * is the relay id of the player whose hull this one is in, and `p` and `h` are where they stand and
 * which way they face **in that hull's own frame**. The watcher places them from the hull's live
 * pose, so a passenger keeps their seat however the hull moves instead of gliding through the walls
 * toward a world place that was true a tenth of a second ago on somebody else's clock.
 *
 * `ship` is a whole number above zero (the relay's own ids start at 1), so a client cannot name
 * nobody and cannot name half a player. The place is finite and otherwise unbounded, exactly as a
 * clamp's place in a hull's frame already is: a hull is as big as it is, and the frame is the
 * hull's own.
 */
export function cleanAboard(x, self = 0) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const ship = Number(x.ship);
  if (!Number.isInteger(ship) || ship <= 0) return undefined;
  // Nobody stands in their own hull: that hull is theirs to send, and a watcher told otherwise would
  // have a figure and no ship to put it in. A caller that knows who is speaking says so; one that
  // does not (a caller on an older build) passes nothing and this is not asked.
  if (self > 0 && ship === self) return undefined;
  const p = vec3(x.p);
  if (!p) return undefined;
  const h = Number(x.h);
  return { ship, p, h: Number.isFinite(h) ? h : 0 };
}

/**
 * What a player is on, from the whole state: either the vehicle they ride or fly (`veh`, a hull of
 * their own that everyone draws) or the hull of another player's ship they are in (`in`, which is
 * nobody's to draw but the player who flies it). Never both, and a client that sends both is taken
 * at its word about the hull it is in -- its own copy of that hull is the one thing that must not
 * go out, since somebody else is already sending it.
 *
 * The answer is a small object rather than two calls so that the rule lives here, beside the two
 * checkers, and is tested here; the caller copies across whichever field came back.
 *
 * `self` is who is speaking, when the caller knows: a hull that names the speaker is refused, and
 * the vehicle they sent with it stands. Left out, nothing about the speaker is asked, so a caller
 * that has no id to hand behaves exactly as before.
 */
export function cleanRide(x, self = 0) {
  const out = {};
  if (!x || typeof x !== 'object') return out;
  const aboard = cleanAboard(x.in, self);
  if (aboard) {
    out.in = aboard;
    return out;
  }
  const veh = cleanVehicle(x.veh);
  if (veh) out.veh = veh;
  return out;
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
