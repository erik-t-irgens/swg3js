// The holes a hull punches in the clouds (the volumetrics' seventh wave's second half, the design's §2.18): the
// processor's half of the hole field -- who punches, the capsules each tick stamps, the square's move the tick's clear is
// handed, and the live holes' box the march steps finely through. The field itself (an RG32F pair, 512² over 1,024 m, R
// the low deck's holes and G the high slab's) and its tick are the clouds' pass's (`airClouds.ts`).
//
// **Each channel lives in its own deck's drifting frame**, addressed toroidally: a world point p is the field's frame
// point p + D, D the deck frame's unwrapped offset (the feed's, never wrapped), and the field holds the 1,024 m square of
// frame points round the camera's. So a hole rides its deck's wind with no advection at all. Every place here is worked
// out in double from the unwrapped offsets and handed to the card only as small numbers relative to the square's centre,
// and the square's move since the last tick drawn is handed apart, so the 1,024 m a fold adds is never read as a move (the
// design's risk 78: one wrap at 4,200 m read at 1,024 moved the square 104 m and wiped every hole).
//
// **The tick is the dents' 10 Hz clock**, the same at every frame rate: a tick worked out here every tenth of a second of
// the field's own clock, and drawn by the pass on the frame it draws, every tick owed since folded into one keep
// (`exp(−0.1 · ticks / fill)`), so a frame rate changes nothing but how often the blur runs.
//
// Pure: no three, types only, so the node tests run exactly what the game runs. Nothing allocated in a frame.
import { AIR_TUNE } from './airTune.ts';

/** The hole field's clock, a tick a tenth of a second (the dents', `airDents.ts`). */
export const HOLE_TICK = 0.1;
/** The most stamps a tick holds (the tick program's `uCap` array: two `vec4` a stamp). */
export const HOLE_STAMPS = 32;
/** The most hulls remembered between ticks. */
const SLOTS = 64;

/** What a hull is to the holes: the few fields of a `Vehicle` it reads, so a test can hand stand-ins. */
export interface CloudHull {
  readonly group: { readonly visible: boolean; readonly id: number };
  readonly spec: { readonly fly?: { readonly floor: number } | null };
  readonly airborne: boolean;
  readonly altitude: number;
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
}

/** Other players' rides (`NearRides`) as far as the holes read them. */
export interface CloudRides {
  n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly half: Float64Array;
  readonly key: Float64Array;
  readonly kind: Uint8Array;
}

/** Stood shuttles' lit jets (`ShuttleJets`) as far as the holes read them. */
export interface CloudJets {
  n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly key: Float64Array;
}

/** A deck's band and frame, as the feed writes them each frame (doubles). */
export class HoleDeck {
  /** Its band, metres over sea level. */
  bottom = 0.5;
  top = 0.5;
  /** Its frame's unwrapped offset now (a world point p is frame point p + D), metres. */
  dx = 0.5;
  dz = 0.5;
  /** Whether it takes holes at all (the low deck while it draws, the high slab where a hull can reach it). */
  on = false;
}

/**
 * The hole field's processor half. The feed steps it every frame (`step`) and the pass asks it for a tick to draw
 * (`prepareTick`), then says it drew one (`drawn`).
 */
export class CloudHoles {
  /** Each remembered hull's key and where it was a tick ago in each channel's frame: [key, seen, lowX, lowZ, highX, highZ, y, radius]. */
  private readonly slots = new Float64Array(SLOTS * 8);
  private slotCount = 0;
  /** The stamps waiting for the next tick drawn: [channel, ax, az, bx, bz, radius] in each channel's frame, metres. */
  private readonly pend = new Float64Array(HOLE_STAMPS * 6);
  pendCount = 0;
  /** Stamps a tick that did not fit (the nearest kept), counted since the console last asked. */
  dropped = 0;
  /** Stamps made since the console last asked. */
  stamped = 0;
  /** The clock in seconds, the ticks worked out since the last tick drawn, and the time to the next. */
  clock = 0.5;
  ticksOwed = 0;
  private nextTick = 0.5;
  /** Each channel's square centre (frame metres) at the last tick drawn, NaN before the first (the whole field cleared). */
  private readonly drawnAt = new Float64Array([Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
  /** Each channel's live box in its frame: [minX, minZ, maxX, maxZ, last stamp's clock, smallest radius]. */
  readonly box = new Float64Array([1, 1, -1, -1, -Infinity, Infinity, 1, 1, -1, -1, -Infinity, Infinity]);
  /** The two decks the feed describes. */
  readonly low = new HoleDeck();
  readonly high = new HoleDeck();
  /** The camera, metres (the feed writes it). */
  camX = 0.5;
  camZ = 0.5;

  constructor() {
    this.clock = 0;
    this.nextTick = HOLE_TICK;
  }

  /** Every hole and memory let go (an arrival, a travel, the master off): the next tick drawn clears the whole field. */
  reset(): void {
    this.slotCount = 0;
    this.pendCount = 0;
    this.ticksOwed = 0;
    this.newest.fill(Number.NaN);
    this.hand.fill(Number.NaN);
    this.drawnAt[0] = Number.NaN;
    this.drawnAt[1] = Number.NaN;
    this.drawnAt[2] = Number.NaN;
    this.drawnAt[3] = Number.NaN;
    for (let c = 0; c < 2; c++) {
      const b = c * 6;
      this.box[b] = 1;
      this.box[b + 1] = 1;
      this.box[b + 2] = -1;
      this.box[b + 3] = -1;
      this.box[b + 4] = -Infinity;
      this.box[b + 5] = Infinity;
    }
  }

  /**
   * A frame of the field's clock: every tenth of a second a tick, which walks the hulls, the rides and the jets and
   * stamps a capsule from where each was a tick ago to where it is now wherever it crosses a deck's band grown by its
   * radius. `dt` of nought (a driven step of nothing) moves nothing. Nothing allocated.
   */
  step(dt: number, hulls: readonly CloudHull[], rides: CloudRides | null, jets: CloudJets | null): void {
    this.dtIn = dt;
    this.stepKept(hulls, rides, jets);
  }
  /** The step `stepKept` takes, seconds: a field the feed writes, so a frame hands no number across a call. */
  dtIn = 0.5;
  /** `step` with its step read from `dtIn` (the feed's, every frame). */
  stepKept(hulls: readonly CloudHull[], rides: CloudRides | null, jets: CloudJets | null): void {
    const dt = this.dtIn;
    if (!(dt > 0)) return;
    this.clock += dt;
    // A long stall (a hidden tab) is one tick, never a burst of them.
    if (this.clock - this.nextTick > 1) this.nextTick = this.clock;
    while (this.clock >= this.nextTick) {
      this.nextTick += HOLE_TICK;
      this.ticksOwed++;
      this.tick(hulls, rides, jets);
    }
    // A live box closes once its last stamp is `liveFor` old.
    const live = AIR_TUNE.holes.liveFor;
    for (let c = 0; c < 2; c++) {
      const b = c * 6;
      if (this.box[b] <= this.box[b + 2] && this.clock - this.box[b + 4] > live) {
        this.box[b] = 1;
        this.box[b + 1] = 1;
        this.box[b + 2] = -1;
        this.box[b + 3] = -1;
        this.box[b + 5] = Infinity;
      }
    }
  }

  /** One tick's walk: every slot first marked unseen, each puncher found and stamped, the unseen dropped. */
  private tick(hulls: readonly CloudHull[], rides: CloudRides | null, jets: CloudJets | null): void {
    const s = this.slots;
    for (let i = 0; i < this.slotCount; i++) s[i * 8 + 1] = 0;
    const H = AIR_TUNE.holes;
    const pk = this.pk;
    for (let i = 0; i < hulls.length; i++) {
      const v = hulls[i];
      if (!v.group.visible) continue;
      const fly = v.spec.fly;
      const alt = v.altitude;
      const up = v.airborne || (!!fly && alt === alt && alt !== Infinity && alt > fly.floor + 0.05);
      if (!up) continue;
      const r = v.radius > 0 ? v.radius : 2;
      pk[0] = v.group.id;
      pk[1] = v.pos.x;
      pk[2] = v.pos.y;
      pk[3] = v.pos.z;
      pk[4] = r * H.widen + H.wake;
      this.punch();
    }
    if (rides) {
      for (let i = 0; i < rides.n; i++) {
        if (rides.kind[i] === 0) continue;
        // A ride's key apart from every hull's group id: its own slot space, below nought.
        const r = rides.half[i] > 0 ? rides.half[i] : 2;
        pk[0] = -1 - rides.key[i];
        pk[1] = rides.x[i];
        pk[2] = rides.y[i];
        pk[3] = rides.z[i];
        pk[4] = r * H.widen + H.wake;
        this.punch();
      }
    }
    if (jets) {
      for (let i = 0; i < jets.n; i++) {
        pk[0] = -1e6 - jets.key[i];
        pk[1] = jets.x[i];
        pk[2] = jets.y[i];
        pk[3] = jets.z[i];
        pk[4] = H.jetRadius;
        this.punch();
      }
    }
    // The slots not seen this tick let go, the rest packed down.
    let w = 0;
    for (let i = 0; i < this.slotCount; i++) {
      if (s[i * 8 + 1] === 0) continue;
      if (w !== i) for (let k = 0; k < 8; k++) s[w * 8 + k] = s[i * 8 + k];
      w++;
    }
    this.slotCount = w;
  }

  /**
   * One puncher this tick at world (x, y, z) with a hole of radius `r`: its slot found or made, and a capsule from where it
   * was a tick ago (each end in the channel's frame as it stood then, so a hole stays where it was punched in the drifting
   * deck) to where it is now, in each channel whose band, grown by `r`, the segment's height range meets.
   */
  private punch(): void {
    const pk = this.pk;
    const key = pk[0];
    const x = pk[1];
    const y = pk[2];
    const z = pk[3];
    const r = pk[4];
    const s = this.slots;
    let k = -1;
    for (let i = 0; i < this.slotCount; i++) {
      if (s[i * 8] === key) {
        k = i;
        break;
      }
    }
    const L = this.low;
    const Hd = this.high;
    const lx = x + L.dx;
    const lz = z + L.dz;
    const hx = x + Hd.dx;
    const hz = z + Hd.dz;
    if (k < 0) {
      if (this.slotCount >= SLOTS) return;
      k = this.slotCount++;
      s[k * 8] = key;
      s[k * 8 + 1] = 1;
      s[k * 8 + 2] = lx;
      s[k * 8 + 3] = lz;
      s[k * 8 + 4] = hx;
      s[k * 8 + 5] = hz;
      s[k * 8 + 6] = y;
      s[k * 8 + 7] = r;
      return;
    }
    const o = k * 8;
    s[o + 1] = 1;
    const y0 = s[o + 6];
    const yLo = y0 < y ? y0 : y;
    const yHi = y0 < y ? y : y0;
    const sk = this.sk;
    if (L.on && yHi >= L.bottom - r && yLo <= L.top + r) {
      sk[0] = 0;
      sk[1] = s[o + 2];
      sk[2] = s[o + 3];
      sk[3] = lx;
      sk[4] = lz;
      sk[5] = r;
      this.stamp();
    }
    if (Hd.on && yHi >= Hd.bottom - r && yLo <= Hd.top + r) {
      sk[0] = 1;
      sk[1] = s[o + 4];
      sk[2] = s[o + 5];
      sk[3] = hx;
      sk[4] = hz;
      sk[5] = r;
      this.stamp();
    }
    s[o + 2] = lx;
    s[o + 3] = lz;
    s[o + 4] = hx;
    s[o + 5] = hz;
    s[o + 6] = y;
    s[o + 7] = r;
  }

  /** The puncher a tick hands `punch` ([key, x, y, z, radius]) and the capsule `punch` hands `stamp` ([channel, ax, az, bx, bz, radius]): kept records, so the tick hands no number across a call. */
  private readonly pk = new Float64Array(5);
  private readonly sk = new Float64Array(6);

  /** A capsule (`sk`) into the waiting stamps (the nearest the camera kept past `HOLE_STAMPS`), and its live box grown. */
  private stamp(): void {
    const sk = this.sk;
    const channel = sk[0];
    const ax = sk[1];
    const az = sk[2];
    const bx = sk[3];
    const bz = sk[4];
    const r = sk[5];
    this.stamped++;
    const D = channel === 0 ? this.low : this.high;
    const cx = this.camX + D.dx;
    const cz = this.camZ + D.dz;
    const mx = 0.5 * (ax + bx) - cx;
    const mz = 0.5 * (az + bz) - cz;
    const dist = mx * mx + mz * mz;
    const p = this.pend;
    let at = this.pendCount;
    if (at >= HOLE_STAMPS) {
      // The farthest waiting stamp gives way to a nearer one; a farther one is dropped.
      let far = -1;
      let farD = dist;
      for (let i = 0; i < HOLE_STAMPS; i++) {
        const fx = 0.5 * (p[i * 6 + 1] + p[i * 6 + 3]) - (this.camX + (p[i * 6] === 0 ? this.low.dx : this.high.dx));
        const fz = 0.5 * (p[i * 6 + 2] + p[i * 6 + 4]) - (this.camZ + (p[i * 6] === 0 ? this.low.dz : this.high.dz));
        const d = fx * fx + fz * fz;
        if (d > farD) {
          farD = d;
          far = i;
        }
      }
      this.dropped++;
      if (far < 0) return;
      at = far;
    } else this.pendCount++;
    p[at * 6] = channel;
    p[at * 6 + 1] = ax;
    p[at * 6 + 2] = az;
    p[at * 6 + 3] = bx;
    p[at * 6 + 4] = bz;
    p[at * 6 + 5] = r;
    // The live box in the channel's frame, grown by the radius; opened by this stamp if closed.
    const b = channel * 6;
    const B = this.box;
    const lo0 = (ax < bx ? ax : bx) - r;
    const lo1 = (az < bz ? az : bz) - r;
    const hi0 = (ax < bx ? bx : ax) + r;
    const hi1 = (az < bz ? bz : az) + r;
    if (B[b] > B[b + 2]) {
      B[b] = lo0;
      B[b + 1] = lo1;
      B[b + 2] = hi0;
      B[b + 3] = hi1;
    } else {
      if (lo0 < B[b]) B[b] = lo0;
      if (lo1 < B[b + 1]) B[b + 1] = lo1;
      if (hi0 > B[b + 2]) B[b + 2] = hi0;
      if (hi1 > B[b + 3]) B[b + 3] = hi1;
    }
    B[b + 4] = this.clock;
    if (r < B[b + 5]) B[b + 5] = r;
    // The newest stamp's middle in its frame, and its channel (the console's probe reads where it stands now).
    const nw = this.newest;
    nw[0] = channel;
    nw[1] = 0.5 * (ax + bx);
    nw[2] = 0.5 * (az + bz);
    nw[3] = this.clock;
    nw[4] = r;
  }
  /** The newest stamp: [channel, frame x, frame z, the clock it was made at, its radius] (NaN before any). */
  readonly newest = new Float64Array([Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN]);

  /**
   * A hole punched by hand at world (x, y, z) with radius `r` (the console's `clouds({ hole })`): a still capsule in
   * each deck that takes holes and whose band, grown by `r`, holds `y`, drawn at the next tick. Answers how many decks.
   */
  punchAt(x: number, y: number, z: number, r: number): number {
    let n = 0;
    const L = this.low;
    const Hd = this.high;
    const sk = this.sk;
    if (L.on && y >= L.bottom - r && y <= L.top + r) {
      sk[0] = 0;
      sk[1] = x + L.dx;
      sk[2] = z + L.dz;
      sk[3] = sk[1];
      sk[4] = sk[2];
      sk[5] = r;
      this.stamp();
      n++;
    }
    if (Hd.on && y >= Hd.bottom - r && y <= Hd.top + r) {
      sk[0] = 1;
      sk[1] = x + Hd.dx;
      sk[2] = z + Hd.dz;
      sk[3] = sk[1];
      sk[4] = sk[2];
      sk[5] = r;
      this.stamp();
      n++;
    }
    if (n > 0 && this.ticksOwed < 1) this.ticksOwed = 1;
    // The console's own hole, which its probe follows whatever punches after it (a landing shuttle's jets, a ship).
    if (n > 0) this.hand.set(this.newest);
    return n;
  }
  /** The hole the console punched last: [channel, frame x, frame z, the clock it was made at, its radius] (NaN before any). */
  readonly hand = new Float64Array([Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN]);

  /**
   * The tick's uniforms, for the pass to draw (false with none owed): `H` (the field's size, the keep over every tick owed,
   * the blur, the stamps), `SL`/`SH` (each channel's square centre now and at the last tick drawn, folded at the field's
   * size), `MV` (each channel's move since then, worked out in double, or a move past the field's size where everything is
   * to be cleared), and `cap` (two `vec4` a stamp: its ends relative to its channel's centre now, then its radius, strength
   * and channel). Nothing allocated.
   */
  prepareTick(H: Float32Array, SL: Float32Array, SH: Float32Array, MV: Float32Array, cap: Float32Array): boolean {
    if (this.ticksOwed <= 0) return false;
    const T = AIR_TUNE.holes;
    const size = T.size;
    const fill = T.fill > 1e-3 ? T.fill : 1e-3;
    const ticks = this.ticksOwed < 600 ? this.ticksOwed : 600;
    H[0] = size;
    H[1] = Math.exp((-HOLE_TICK * ticks) / fill);
    H[2] = T.blur > 0 ? (T.blur < 1 ? T.blur : 1) : 0;
    const L = this.low;
    const Hd = this.high;
    // Each channel's centre now in its frame (double), and its move since the last tick drawn.
    const clx = this.camX + L.dx;
    const clz = this.camZ + L.dz;
    const chx = this.camX + Hd.dx;
    const chz = this.camZ + Hd.dz;
    const d = this.drawnAt;
    const first = !(d[0] === d[0]);
    const mlx = first ? size * 4 : clx - d[0];
    const mlz = first ? size * 4 : clz - d[1];
    const mhx = first ? size * 4 : chx - d[2];
    const mhz = first ? size * 4 : chz - d[3];
    // Each centre folded at the field's size (`fold`, written out: the frame hands no number across a call).
    const pl0 = clx - mlx;
    const pl1 = clz - mlz;
    const ph0 = chx - mhx;
    const ph1 = chz - mhz;
    SL[0] = clx - size * Math.floor(clx / size);
    SL[1] = clz - size * Math.floor(clz / size);
    SL[2] = pl0 - size * Math.floor(pl0 / size);
    SL[3] = pl1 - size * Math.floor(pl1 / size);
    SH[0] = chx - size * Math.floor(chx / size);
    SH[1] = chz - size * Math.floor(chz / size);
    SH[2] = ph0 - size * Math.floor(ph0 / size);
    SH[3] = ph1 - size * Math.floor(ph1 / size);
    // A move past the field is a clear of all of it, said by the move itself (any texel's places then differ).
    MV[0] = mlx < size && mlx > -size ? mlx : size * 4;
    MV[1] = mlz < size && mlz > -size ? mlz : size * 4;
    MV[2] = mhx < size && mhx > -size ? mhx : size * 4;
    MV[3] = mhz < size && mhz > -size ? mhz : size * 4;
    d[0] = clx;
    d[1] = clz;
    d[2] = chx;
    d[3] = chz;
    // The stamps, each end relative to its channel's centre now.
    const p = this.pend;
    const n = this.pendCount;
    for (let i = 0; i < n; i++) {
      const ch = p[i * 6];
      const ox = ch === 0 ? clx : chx;
      const oz = ch === 0 ? clz : chz;
      cap[i * 8] = p[i * 6 + 1] - ox;
      cap[i * 8 + 1] = p[i * 6 + 2] - oz;
      cap[i * 8 + 2] = p[i * 6 + 3] - ox;
      cap[i * 8 + 3] = p[i * 6 + 4] - oz;
      cap[i * 8 + 4] = p[i * 6 + 5];
      cap[i * 8 + 5] = 1;
      cap[i * 8 + 6] = ch;
      cap[i * 8 + 7] = 0;
    }
    H[3] = n;
    return true;
  }

  /** The pass drew the tick `prepareTick` made: the owed ticks and the waiting stamps spent. */
  drawn(): void {
    this.ticksOwed = 0;
    this.pendCount = 0;
  }

  /**
   * Each channel's live box in the world at this frame (its frame box less the frame's offset now), into `low` and `high`
   * as (minX, minZ, maxX, maxZ), empty (min over max) where no stamp is live, and the fine step's length for each into
   * `step` (half the smallest live hole's radius, never under `fineStep`; nought where none is live).
   */
  liveBoxes(low: Float32Array, high: Float32Array, step: Float32Array): void {
    const B = this.box;
    const T = AIR_TUNE.holes;
    for (let c = 0; c < 2; c++) {
      const out = c === 0 ? low : high;
      const D = c === 0 ? this.low : this.high;
      const b = c * 6;
      if (B[b] > B[b + 2]) {
        out[0] = 1;
        out[1] = 1;
        out[2] = -1;
        out[3] = -1;
        step[c] = 0;
        continue;
      }
      out[0] = B[b] - D.dx;
      out[1] = B[b + 1] - D.dz;
      out[2] = B[b + 2] - D.dx;
      out[3] = B[b + 3] - D.dz;
      const half = 0.5 * B[b + 5];
      step[c] = half > T.fineStep ? half : T.fineStep;
    }
  }

  /** Whether a channel's live box is open (the console's and the tests'). */
  live(channel: 0 | 1): boolean {
    const b = channel * 6;
    return this.box[b] <= this.box[b + 2];
  }

  /** The remembered hulls (the console's). */
  get remembered(): number {
    return this.slotCount;
  }
}
