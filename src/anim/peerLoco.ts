// Another player's legs. Nothing new crosses the wire for the speed classes: a figure's state, heading and speed are
// what they always were, and its velocity is worked out from the places it was heard at. From those the table gives
// the very clip the sender's own game plays (`peerPickIn`, locoTable.ts): how the travel lies against the heading sent
// says which way the clip's feet go, and the speed which class.
//
// One of these is kept a figure. It holds the pick steady for a moment before changing class, since a body gathering
// speed passes through the slower classes' speeds for a message or two; keeps the legs' way until the travel lies
// clearly nearer another clip's (a slope or a wall turns a body's travel a few degrees from its heading); and works
// out the rate the clip plays at.
//
// Pure: `RemotePlayers` calls `resolve` each frame for each figure on foot, and the node test calls the same. Nothing
// is made on a frame and no number crosses a call: what a frame hands in rides one kept record (`PeerIn`), and the
// rate is read off this record (locoAlloc.test.ts measures it).

import type { LocoRig } from './bodyLoco.ts';
import { PeerAsk, SPEED_SLOTS, fillSpeeds, peerLocoState, peerPickIn, type LocoPick } from './locoTable.ts';
import type { LocoTune } from './locoTune.ts';

const DEG = 180 / Math.PI;

/** A frame of a figure as its legs need it: one kept record, written by the caller before `resolve`. (Declared as fractions.) */
export class PeerIn {
  /** The figure's velocity as it was heard, m/s. */
  vx = 0.5;
  vz = 0.5;
  /** The heading its game sent, radians, and how fast it says it goes, m/s. */
  heading = 0.5;
  speed = 0.5;
  /** The frame's seconds. */
  dt = 0.5;
}

/** The tune's class speeds, read by name once a call and by a pick's own place from there (one array for every figure: a call fills it before it reads it). */
const SPEEDS = new Float64Array(SPEED_SLOTS);

export class PeerLoco {
  /** The clip the figure's legs play, or null for the state's own. */
  pick: LocoPick | null = null;
  /** The rate it plays at. (Declared as a fraction.) */
  rate = 0.5;
  /** How the figure's travel lay against its heading at the last frame it moved, degrees (+ left): what a rig without the table's clips reads for a figure going backward. */
  rel = 0.5;
  /** A pick that would replace the one playing, and how long it has stood. */
  private next: LocoPick | null = null;
  private nextFor = 0.5;
  private readonly ask = new PeerAsk();

  constructor() {
    this.rate = 1;
    this.rel = 0;
    this.nextFor = 0;
  }

  /**
   * The frame's answer: `state` as the peer's game sent it, and in `f` the figure's velocity as it was heard, the
   * heading and the speed sent and the frame's seconds. Null (and nothing kept) for a state that is no walk or run
   * on foot, with the classes off, or on a rig without the clip: the caller plays the state's own clip, as before.
   */
  resolve(tune: LocoTune, rig: LocoRig, state: string, f: PeerIn): LocoPick | null {
    if (!peerLocoState(state) || !(f.speed > 0.05)) {
      this.rel = 0;
      return this.drop();
    }
    // The travel against the heading, degrees (+ left); a figure heard at only one place yet is taken to go forward,
    // and one that says it moves while it is heard standing (pressed to a wall it went into) keeps the way its legs
    // last went, as its own game plays it.
    const moving = f.vx * f.vx + f.vz * f.vz > 0.09;
    let rel = 0;
    if (moving) {
      const a = (Math.atan2(f.vx, f.vz) - f.heading) * DEG;
      rel = ((((a + 180) % 360) + 360) % 360) - 180;
    } else if (this.pick) rel = this.pick.heading;
    this.rel = rel;
    if (!tune.on) return this.drop();
    if (moving) {
      // The legs keep the way they go until the travel lies clearly nearer another clip's: ground that deflects a body
      // (a slope climbed across, a wall slid along) turns its travel a few degrees, and must not flick the legs.
      if (this.pick) {
        const off = ((((rel - this.pick.heading + 180) % 360) + 360) % 360) - 180;
        if ((off < 0 ? -off : off) < 22.5 + tune.peer.hold) rel = this.pick.heading;
      }
    }
    fillSpeeds(tune, SPEEDS);
    this.ask.rel = rel;
    this.ask.speed = f.speed;
    const found = peerPickIn(SPEEDS, state, this.ask);
    if (!found || !rig.has(found.clip)) return this.drop();
    if (!this.pick || found === this.pick) {
      this.pick = found;
      this.next = null;
    } else if (found.heading !== this.pick.heading || found.state !== this.pick.state) {
      // Another way, or the other side of the walk: taken at once.
      this.pick = found;
      this.next = null;
    } else {
      // Another class the same way: only once it has stood a moment.
      if (found !== this.next) {
        this.next = found;
        this.nextFor = 0;
      }
      this.nextFor += f.dt;
      if (this.nextFor >= tune.peer.settle) {
        this.pick = found;
        this.next = null;
      }
    }
    // The rate: the speed sent over the speed the clip's feet were made for, inside the tune's band with its top
    // doubled (`rateFor`'s own lines, written out): a peer under Force Speed says so only by how fast it goes.
    let rate = 1;
    if (rig.readSpeed(this.pick.clip)) {
      const natural = rig.speedOut;
      if (natural > 0) {
        const band = tune.rate;
        const top = band.max * 2;
        const r = f.speed / (natural * band.feet);
        rate = r < band.min ? band.min : r > top ? top : r;
      }
    }
    this.rate = rate;
    return this.pick;
  }

  private drop(): null {
    this.pick = null;
    this.next = null;
    return null;
  }
}
