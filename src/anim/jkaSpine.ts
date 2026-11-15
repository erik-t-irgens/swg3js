// Jedi Academy's clips' lower back (the owner's word of 2026-11-15: "All JKA saber moves are off - it looks like I am
// bending my lower spine back so my lower back is concave. It's always been a little wonky").
//
// What was measured (tools/swg/tests/jkaSpine.test.ts, on the converted rigs): the converter carries each Jedi Academy
// bone's change from that game's standing frame onto the game's skeleton by world turns, and lays the standing frame on
// the skeleton's **bind pose**. The bind pose is a modelling pose, not how the game stands: against the game's own idle
// its spine is bent back (on the human, the first spine joint 8 to 11 degrees, the chest's joint 10 to 12 the other
// way), so every Jedi Academy clip begins that much hollower in the lower back than the game's own standing body, and the
// clips that tip the pelvis forward (the saber walk and run, the diagonal swings) add their own on top. The Mixamo legs
// under a swing on the upper body change the torso's lean but not the lower back's bend, which is the spine's own.
//
// The mend: every Jedi Academy clip's spine rebased from the bind pose onto the idle's, by one turn per spine joint
// worked out once per skeleton from the two (`K`, below), with the joints hung from the top of the spine (the neck, the
// shoulders) turned back by the last one so they stay where the clip has them in the world. Written into the clips'
// own keys once, as the rig is made (a clip shared between rigs once only: `rebased`), and put back from a kept copy
// for the switch's 'before', so nothing is done a frame, nothing is made a frame, and every body playing the clips (the
// player, the peers, the fighters, the people lent them) plays the same keys.
//
// Pure: plain arrays and the structural shape of a three.js track, so the node test runs the very function on clips it
// reads out of a rig's GLB.

/** A quaternion as x, y, z, w. */
export type Q = [number, number, number, number];

/** The little of a three.js keyframe track this reads and writes: its name (`<bone>.quaternion`) and its values, four a key. */
export interface RotTrack {
  name: string;
  values: Float32Array;
}
/** The little of a three.js clip: its name and its tracks. */
export interface SpineClip {
  name: string;
  tracks: RotTrack[];
}

export function qmul(a: ArrayLike<number>, b: ArrayLike<number>): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export const qconj = (q: ArrayLike<number>): Q => [-q[0], -q[1], -q[2], q[3]];
function qnorm(q: Q): Q {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Whether a clip is one of Jedi Academy's: the converter keeps that game's own names (`BOTH_`, `TORSO_`, `LEGS_`). */
export const isJkaClip = (name: string): boolean => /^(BOTH|TORSO|LEGS)_/.test(name);

/** The spine joints, lowest first: the bones named spine 1 to 3 under one another (the rig's own `spineBones` names). */
export const SPINE_NAME = /^spine_?[1-3]$/i;

/** A clip's mean rotation of a bone over its keys (each key's sign put with the first's), or null without a track. */
export function meanOf(clip: SpineClip, bone: string): Q | null {
  const t = clip.tracks.find((x) => x.name === `${bone}.quaternion`);
  if (!t || t.values.length < 4) return null;
  const v = t.values;
  const s: Q = [0, 0, 0, 0];
  for (let i = 0; i < v.length; i += 4) {
    const d = v[i] * v[0] + v[i + 1] * v[1] + v[i + 2] * v[2] + v[i + 3] * v[3] < 0 ? -1 : 1;
    s[0] += v[i] * d;
    s[1] += v[i + 1] * d;
    s[2] += v[i + 2] * d;
    s[3] += v[i + 3] * d;
  }
  return qnorm(s);
}

/** What the rebase of one skeleton is: each spine joint's turn (`K`), lowest first, and the joints hung from the top one. */
export interface SpineRebase {
  /** The spine joints, lowest first, and each one's parent's name. */
  chain: { name: string; parent: string; k: Q }[];
  /** The joints hung from the top spine joint (the neck, the shoulders): turned back by its `K`. */
  kids: string[];
}

/**
 * The rebase for a skeleton: `bones` each joint's name, its parent's name ('' for none) and its bind rotation under its
 * parent; `idle` the game's own idle clip. Each spine joint's frame relative to the pelvis is G (the product of the bind
 * rotations from the lowest spine joint up), the same in the idle (its mean rotations); `K = conj(G bind) G idle`, so a
 * clip whose spine stands at the bind (Jedi Academy's standing frame) stands at the idle once rebased. Null where the
 * skeleton has no spine joints, or the idle drives none of them.
 */
export function spineRebaseFor(bones: readonly { name: string; parent: string; rest: Q }[], idle: SpineClip): SpineRebase | null {
  const spine = bones.filter((b) => SPINE_NAME.test(b.name));
  if (!spine.length) return null;
  // Lowest first: each one's parent is the one before (or the pelvis for the first).
  const names = new Set(spine.map((b) => b.name));
  const first = spine.find((b) => !names.has(b.parent));
  if (!first) return null;
  const order = [first];
  for (;;) {
    const next = spine.find((b) => b.parent === order[order.length - 1].name);
    if (!next) break;
    order.push(next);
  }
  let gb: Q = [0, 0, 0, 1];
  let gi: Q = [0, 0, 0, 1];
  let any = false;
  const chain: SpineRebase['chain'] = [];
  for (const b of order) {
    const m = meanOf(idle, b.name);
    if (m) any = true;
    gb = qnorm(qmul(gb, b.rest));
    gi = qnorm(qmul(gi, m ?? b.rest));
    chain.push({ name: b.name, parent: b.parent, k: qnorm(qmul(qconj(gb), gi)) });
  }
  if (!any) return null;
  const top = order[order.length - 1].name;
  const kids = bones.filter((b) => b.parent === top).map((b) => b.name);
  return { chain, kids };
}

/** One clip's rebased tracks: each track's keys as converted, kept for the switch's 'before'. */
interface Kept {
  track: RotTrack;
  /** The keys as converted. */
  before: Float32Array;
  /** The keys rebased. */
  after: Float32Array;
}

/** Every clip rebased so far (a clip shared between rigs once only), and its tracks. */
const rebased = new WeakMap<SpineClip, Kept[]>();
/** Every clip rebased, for the switch: kept for as long as the clips themselves are (a species' clips are kept for the session). */
const all: Kept[][] = [];
/** Clips seen and left alone (no spine tracks), so a second rig does not look again. */
const passed = new WeakSet<SpineClip>();

/** A clip's spine tracks rebased (`local' = conj(K parent) local K self`), into a fresh array per track; null when it lacks one it needs. */
export function rebaseClip(clip: SpineClip, r: SpineRebase): { track: RotTrack; after: Float32Array }[] | null {
  const byName = new Map<string, RotTrack>();
  for (const t of clip.tracks) if (t.name.endsWith('.quaternion')) byName.set(t.name.slice(0, -'.quaternion'.length), t);
  const out: { track: RotTrack; after: Float32Array }[] = [];
  const kOf = new Map(r.chain.map((c) => [c.name, c.k]));
  // Every spine joint and every joint hung from the top one must be driven, or the rebase would move a joint the clip
  // leaves to another clip.
  for (const c of r.chain) if (!byName.has(c.name)) return null;
  for (const n of r.kids) if (!byName.has(n)) return null;
  const turn = (t: RotTrack, pre: Q | null, post: Q | null) => {
    const v = t.values;
    const a = new Float32Array(v.length);
    for (let i = 0; i < v.length; i += 4) {
      let q: Q = [v[i], v[i + 1], v[i + 2], v[i + 3]];
      if (pre) q = qmul(pre, q);
      if (post) q = qmul(q, post);
      q = qnorm(q);
      a[i] = q[0];
      a[i + 1] = q[1];
      a[i + 2] = q[2];
      a[i + 3] = q[3];
    }
    out.push({ track: t, after: a });
  };
  for (const c of r.chain) {
    const kp = kOf.get(c.parent);
    turn(byName.get(c.name)!, kp ? qconj(kp) : null, c.k);
  }
  const kTop = qconj(r.chain[r.chain.length - 1].k);
  for (const n of r.kids) turn(byName.get(n)!, kTop, null);
  return out;
}

/**
 * Rebase every Jedi Academy clip of a set that has not been (a clip shared between rigs once only), keeping each
 * track's keys as converted; and put the set's clips in the switch's present state ('mended' the rebased keys, 'before'
 * the converted ones). Answers how many clips were rebased now.
 */
export function rebaseJkaClips(clips: readonly SpineClip[], r: SpineRebase | null, mended: boolean): number {
  let made = 0;
  if (!r) return 0;
  for (const clip of clips) {
    if (!isJkaClip(clip.name) || rebased.has(clip) || passed.has(clip)) continue;
    const turned = rebaseClip(clip, r);
    if (!turned) {
      passed.add(clip);
      continue;
    }
    // Each track takes keys of its own before anything plays it (the loader may hand two tracks one array where their
    // keys are alike, and a keyframe's player reads the array it was made with), which the switch then writes in place.
    const kept: Kept[] = turned.map((t) => {
      const before = t.track.values.slice();
      t.track.values = before.slice();
      return { track: t.track, before, after: t.after };
    });
    rebased.set(clip, kept);
    all.push(kept);
    if (mended) for (const k of kept) k.track.values.set(k.after);
    made++;
  }
  return made;
}

/** The switch moved: every clip rebased so far takes its rebased keys ('mended') or its converted ones ('before'). An event, never a frame. */
export function applyJkaSpine(mended: boolean): number {
  let n = 0;
  for (const kept of all) {
    for (const k of kept) k.track.values.set(mended ? k.after : k.before);
    n++;
  }
  return n;
}

/** How many clips are rebased (the console's). */
export function rebasedCount(): number {
  return all.length;
}
