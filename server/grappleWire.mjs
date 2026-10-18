// Another player's grappling hook, as the relay passes it on in their state (the design's §3.15): the rope
// they hold and the dart they have fired, `gr`, and beside a held rope the points of it that ride a third
// player's vehicle, `grf`. Dependency-free, shared by the relay (through `cleanState` in `wire.mjs`) and the
// tests, as `vehicleWire.mjs` is. Everything is checked and kept small; anything else is dropped, so a
// browser on another build can neither grow a message nor put anything unexpected through.
//
// `gr` is one flat list of numbers, absent while there is no rope:
//   - the dart flying (and a loose prop on the line, which is sent as the dart coming home): `[0, x, y, z, vx, vy, vz]`;
//   - a rope held: `[1, slack, ax, ay, az, w1x, w1y, w1z, ...]`, the free span's slack, then the anchor, then every bend
//     from the anchor toward the player, each a world point as the sender drew it at the moment of sending.
//
// `grf` is six numbers a point, `[kind, id, index, lx, ly, lz, ...]`: kind 1 is the vehicle of the player whose relay
// id is `id` (the only kind there is yet: the precedent of a clamp's `dock.to` and a passenger's `in.ship`), `index`
// the point's place in `gr` (0 the anchor), and the three numbers its place in that vehicle's own frame. A point with
// no entry is a world point. Each watcher puts such a point on its own picture of that vehicle, which is where it
// draws the hull; without it, the anchor stood up to a few metres off the hull every other screen draws.

/**
 * The most points a rope sends, anchor included: the wire's own shape, and so fixed here and never a number a run
 * may move. A relay started with a smaller one would drop every longer rope an unchanged browser sends, whole, which
 * is worse than the straight end the sender's own cut leaves (`GRAPPLE_TUNE.sendPoints`, held at this or under).
 */
export const ROPE_POINTS = 16;

/** The kinds of frame a `grf` entry may name. 1, another player's vehicle, is the only one there is yet. */
const FRAME_KINDS = [1];

/** The most slack a held rope may say it has, in metres: a rope is at most a hundred long, so this is room and a cap. */
const SLACK_MOST = 1000;

/**
 * What this relay passes on of the rope, live: `frames` false keeps `gr` and drops every `grf`, which is what a relay
 * that knew the rope and not its frames would do. It is for the tests to stand in for such a relay with the real one;
 * nothing in play moves it, and the status page does not print it.
 */
export const ROPE_WIRE = { frames: true };

/** A whole number, or NaN. */
function whole(x) {
  const n = Number(x);
  return Number.isInteger(n) ? n : Number.NaN;
}

/**
 * A cleaned copy of a state's `gr`, or undefined when it is not one: kind 0 with exactly seven finite numbers, or kind
 * 1 with `2 + 3k` finite numbers for k from one to `ROPE_POINTS`, its slack held to [0, 1000]. Any other shape, a
 * third kind among them, is dropped whole: a rope cut short here would be drawn somewhere it is not.
 */
export function cleanRope(x, most = ROPE_POINTS) {
  if (!Array.isArray(x) || x.length < 2) return undefined;
  const out = x.map(Number);
  if (out.some((v) => !Number.isFinite(v))) return undefined;
  if (out[0] === 0) return out.length === 7 ? out : undefined;
  if (out[0] !== 1) return undefined;
  const k = (out.length - 2) / 3;
  if (!Number.isInteger(k) || k < 1 || k > most) return undefined;
  out[1] = Math.max(0, Math.min(SLACK_MOST, out[1]));
  return out;
}

/** How many points a cleaned `gr` holds: one for the dart, else its anchor and bends. */
export function ropePointCount(gr) {
  if (!Array.isArray(gr)) return 0;
  return gr[0] === 0 ? 1 : (gr.length - 2) / 3;
}

/**
 * A cleaned copy of a state's `grf`, or undefined: kept only beside a held rope (`points` is how many `gr` holds), a
 * length a positive multiple of six of at most `ROPE_POINTS` entries, each a known kind, an `id` a whole number above
 * nought and **not the sender** (nobody ropes the vehicle they are on, which is theirs to send: `cleanAboard`'s rule),
 * an `index` a whole number under the rope's point count and used once, and three finite numbers. A bad entry is
 * dropped on its own; a `grf` with no good entry is dropped whole, and `gr` stands either way.
 */
export function cleanRopeFrames(x, points, self = 0, most = ROPE_POINTS) {
  if (!ROPE_WIRE.frames) return undefined;
  if (!Array.isArray(x) || !(points > 0)) return undefined;
  if (x.length === 0 || x.length % 6 !== 0 || x.length / 6 > most) return undefined;
  const out = [];
  const used = new Set();
  for (let i = 0; i < x.length; i += 6) {
    const kind = whole(x[i]);
    const id = whole(x[i + 1]);
    const index = whole(x[i + 2]);
    const lx = Number(x[i + 3]);
    const ly = Number(x[i + 4]);
    const lz = Number(x[i + 5]);
    if (!FRAME_KINDS.includes(kind)) continue;
    if (!(id > 0) || (self > 0 && id === self)) continue;
    if (!(index >= 0) || index >= points || used.has(index)) continue;
    if (!Number.isFinite(lx) || !Number.isFinite(ly) || !Number.isFinite(lz)) continue;
    used.add(index);
    out.push(kind, id, index, lx, ly, lz);
  }
  return out.length ? out : undefined;
}
