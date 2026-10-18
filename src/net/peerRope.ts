// Another player's grappling hook as it comes off the wire (the design's §3.15): one kept record per peer, copied in
// place from their state's `gr` and `grf` every time one is heard, and read rather than trusted -- a far end on another
// build may send anything, and a throw in a message handler costs every message after it. Pure, with nothing of three
// or the page, so the node tests and the relay test read it as it stands.
//
// The shapes are the relay's (`server/grappleWire.mjs`): `gr` is `[0, x, y, z, vx, vy, vz]` for the dart flying (and
// a loose prop on the line, sent as the dart coming home) or `[1, slack, ax, ay, az, w1x, ...]` for a rope held, every
// point a world point; `grf` is six numbers a point riding another player's vehicle, `[kind, id, index, lx, ly, lz]`.
// What the record is drawn as is `remoteRopes.ts`'s business.

/** The most points a rope carries on the wire (`ROPE_POINTS` in server/grappleWire.mjs, the wire's own shape). */
export const PEER_ROPE_POINTS = 16;

/** The one kind of frame a point may ride: another player's vehicle, by their relay id. Others draw their world point. */
export const ROPE_FRAME_VEHICLE = 1;

/**
 * The watcher's own number, kept out of `GRAPPLE_TUNE` on purpose: that table holds 127 keys, and the engine makes an
 * object literal of 128 or more with every key out of the object (in a property array, where 127 keep all of theirs in
 * it), after which the hook's frame boxed the numbers it read off the table: its own measure went from 0.09 to 4.2 B a
 * frame the day this key sat there. Moved by `__debug.grapple({ tune: { peerLead } })` all the same.
 */
export const PEER_ROPE_TUNE = {
  /**
   * Another player's dart is drawn flown on from where their last state put it by its velocity, at most this long (s)
   * past that state: a state comes every tenth of a second, so half again of that covers one arriving late without
   * flying a dart far past where it really was. A ray in this world stops it where it struck.
   */
  peerLead: 0.15,
};

/** The table as it ships, for `__debug.grapple({ reset: true })`. */
export const PEER_ROPE_DEFAULTS: Readonly<typeof PEER_ROPE_TUNE> = Object.freeze({ ...PEER_ROPE_TUNE });

/** Move the watcher's numbers, clamped, in place; anything else in `o` is the hook's and is left alone. */
export function tunePeerRope(o: Record<string, unknown>): typeof PEER_ROPE_TUNE {
  if (typeof o.peerLead === 'number' && Number.isFinite(o.peerLead)) PEER_ROPE_TUNE.peerLead = Math.max(0, Math.min(1, o.peerLead));
  return PEER_ROPE_TUNE;
}

/** One peer's rope as last heard. Written in place: nothing here is made per message. */
export interface PeerRope {
  /** -1 for no rope, 0 the dart flying, 1 a rope held. */
  kind: number;
  /** The free span's slack as the sender worked it out (m), for hanging the rope; nought for a dart. */
  slack: number;
  /** How many points: one for the dart, else the anchor and every bend from it toward the player. */
  count: number;
  /** The points as world places (three each), the anchor first. */
  readonly pts: Float64Array;
  /** The dart's velocity while it flies (m/s). */
  readonly vel: Float64Array;
  /** Points riding another player's vehicle: how many, and for each its frame's relay id, its index and its local place. */
  frames: number;
  readonly frameId: Int32Array;
  readonly frameIndex: Int32Array;
  readonly frameLocal: Float64Array;
  /** When the last state with this rope was heard (ms, `performance.now()` as the game hands it), and how many were. */
  heardAt: number;
  heard: number;
}

export function newPeerRope(): PeerRope {
  return {
    kind: -1,
    slack: 0,
    count: 0,
    pts: new Float64Array(3 * PEER_ROPE_POINTS),
    vel: new Float64Array(3),
    frames: 0,
    frameId: new Int32Array(PEER_ROPE_POINTS),
    frameIndex: new Int32Array(PEER_ROPE_POINTS),
    frameLocal: new Float64Array(3 * PEER_ROPE_POINTS),
    heardAt: 0,
    heard: 0,
  };
}

/** No rope at all: what a state with none, or one this browser cannot read, leaves. */
export function clearPeerRope(r: PeerRope): void {
  r.kind = -1;
  r.slack = 0;
  r.count = 0;
  r.frames = 0;
}

/** A finite number. */
function finite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * A state's `gr` and `grf` into the record, in place, heard at `now`: true when it holds a rope. A `gr` of any shape
 * the relay would not keep reads as none; a `grf` entry that is not one of ours, names a point the rope has not got,
 * names one twice or carries a number that is not one is passed over on its own, and its point stays a world point.
 */
export function readPeerRope(gr: unknown, grf: unknown, now: number, out: PeerRope): boolean {
  if (!Array.isArray(gr) || gr.length < 2) {
    clearPeerRope(out);
    return false;
  }
  for (let i = 0; i < gr.length; i++) {
    if (!finite(gr[i])) {
      clearPeerRope(out);
      return false;
    }
  }
  const kind = gr[0] as number;
  if (kind === 0 && gr.length === 7) {
    out.kind = 0;
    out.slack = 0;
    out.count = 1;
    out.pts[0] = gr[1];
    out.pts[1] = gr[2];
    out.pts[2] = gr[3];
    out.vel[0] = gr[4];
    out.vel[1] = gr[5];
    out.vel[2] = gr[6];
    out.frames = 0;
  } else if (kind === 1 && (gr.length - 2) % 3 === 0 && gr.length >= 5 && (gr.length - 2) / 3 <= PEER_ROPE_POINTS) {
    out.kind = 1;
    out.slack = Math.max(0, gr[1] as number);
    out.count = (gr.length - 2) / 3;
    for (let i = 0; i < 3 * out.count; i++) out.pts[i] = gr[2 + i] as number;
    out.vel[0] = out.vel[1] = out.vel[2] = 0;
    out.frames = 0;
    if (Array.isArray(grf) && grf.length % 6 === 0) {
      for (let i = 0; i + 5 < grf.length && out.frames < PEER_ROPE_POINTS; i += 6) {
        const k = grf[i];
        const id = grf[i + 1];
        const index = grf[i + 2];
        if (k !== ROPE_FRAME_VEHICLE || !Number.isInteger(id) || !(id > 0) || !Number.isInteger(index) || !(index >= 0) || index >= out.count) continue;
        if (!finite(grf[i + 3]) || !finite(grf[i + 4]) || !finite(grf[i + 5])) continue;
        let twice = false;
        for (let j = 0; j < out.frames; j++) if (out.frameIndex[j] === index) twice = true;
        if (twice) continue;
        const n = out.frames;
        out.frameId[n] = id;
        out.frameIndex[n] = index;
        out.frameLocal[3 * n] = grf[i + 3];
        out.frameLocal[3 * n + 1] = grf[i + 4];
        out.frameLocal[3 * n + 2] = grf[i + 5];
        out.frames = n + 1;
      }
    }
  } else {
    clearPeerRope(out);
    return false;
  }
  out.heardAt = now;
  out.heard++;
  return true;
}
