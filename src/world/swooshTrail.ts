// The ribbon a particle trails behind it (a .swh, `tools/swg/swoosh.mjs`): points taken from where its
// carrier is, aged out behind it, and drawn as a strip of quads.
//
// The strip is written into the particle batch its texture already has, the same position, colour and
// UV arrays a quad particle fills, so a ribbon costs no material, no program and no draw call of its
// own: an entertainer twirling a ribbon stick adds a few dozen quads to a batch that was made, and
// compiled, while the loading screen was up.
//
// How the ribbon is sampled -- how often, how many points, how finely each span is drawn -- is the
// three fields version 0001 of the file adds, read as a rate, a count and a subdivision (the reader
// says why). Everything else about the drawing is ours: the strip faces the camera, runs its texture's
// V down its length from the carrier to the tail and its U across, and every number is in
// `SWOOSH_TUNE`, live through `__debug.ribbons`.
//
// Nothing here knows three: numbers in and numbers out, so the node test drives a trail round a circle
// and reads what it would draw.

/** A ribbon as the converter writes it. */
export interface SwooshDef {
  kind: 'swoosh';
  version: number;
  texture: {
    shader: string;
    frameCount: number;
    frameStart: number;
    frameEnd: number;
    frameUVSize: number;
    framesPerColumn: number;
    framesPerSecond: number;
    visible: boolean;
    file?: string;
    blend?: 'add' | 'alpha' | 'modulate' | 'opaque';
  };
  /** RGBA, 0..1. */
  color: number[];
  /** Metres across. */
  width: number;
  /** An effect that goes with the ribbon, played where its carrier is (the sparkly streamers' sparks). */
  appearance: { path: string; file?: string; failed?: string } | null;
  /** Points a second, points kept and pieces a span is drawn in; null on a version 0000 file. */
  rate: number | null;
  samples: number | null;
  subdivisions: number | null;
  /** The fields nothing reads yet, in file order. */
  fields: number[];
}

/** Every number of ours about a ribbon. */
export const SWOOSH_TUNE = {
  /** Points a second, points kept and pieces a span for a version 0000 file, which says none of it (the swords'). */
  rate: 30,
  samples: 10,
  subdivisions: 2,
  /** Multiplies every ribbon's width, and how long it reaches back. */
  width: 1,
  length: 1,
  /** The share of the length over which the tail fades out: 0 leaves a ribbon solid to its end, as its files colour it. */
  tailFade: 0,
  /** Seconds a ribbon may go unmoved by its carrier before it lets go, for a carrier that never says so. */
  idleStop: 0.5,
  /** Spans shorter than this, metres, are not drawn: a still carrier draws nothing rather than a ribbon folded on itself. */
  minSpan: 0.0005,
  /** At most this many pieces a span, whatever a file asks. */
  maxSubdivisions: 8,
};

/** One ribbon's points: a ring of (x, y, z, time) taken from its carrier, oldest first. */
export class SwooshTrail {
  /** Seconds since the ribbon started. */
  clock = 0;
  /** Seconds since its carrier last moved it; the owner zeroes it on every move. */
  idle = 0;
  private readonly ring: Float32Array;
  private readonly cap: number;
  private first = 0;
  private count = 0;
  private lastSample = -Infinity;
  /** Raw points for `points`, head first, and the drawn points after subdivision: kept, never made per frame. */
  private readonly raw: Float32Array;
  readonly drawn: Float32Array;
  readonly def: SwooshDef;
  /** The most pieces a span this trail's `drawn` was sized for: the console may raise the table's later. */
  private readonly maxSub: number;

  constructor(def: SwooshDef) {
    this.def = def;
    this.cap = Math.max(2, Math.floor(this.sampleCount) + 2);
    this.maxSub = Math.max(1, Math.round(SWOOSH_TUNE.maxSubdivisions));
    this.ring = new Float32Array(this.cap * 4);
    this.raw = new Float32Array((this.cap + 2) * 4);
    this.drawn = new Float32Array(((this.cap + 1) * this.maxSub + 2) * 4);
  }

  /** Points a second. */
  get rate(): number {
    const r = this.def.rate;
    return r !== null && r > 0 ? r : SWOOSH_TUNE.rate;
  }

  private get sampleCount(): number {
    const n = this.def.samples;
    return n !== null && n > 0 ? n : SWOOSH_TUNE.samples;
  }

  /** How many pieces each span between two points is drawn in. */
  get subdivisions(): number {
    const s = this.def.subdivisions;
    const n = s !== null && s > 0 ? s : SWOOSH_TUNE.subdivisions;
    return Math.max(1, Math.min(SWOOSH_TUNE.maxSubdivisions, this.maxSub, Math.round(n)));
  }

  /** Seconds the ribbon reaches back from its carrier. */
  get life(): number {
    return (this.sampleCount / this.rate) * SWOOSH_TUNE.length;
  }

  /** Points held now, for the console. */
  get held(): number {
    return this.count;
  }

  /**
   * Advance by `dt`: while `live`, take a point where the carrier is (hx, hy, hz) whenever one is
   * due; then let go of what has aged past the ribbon's length, keeping one point beyond it so the
   * tail can be cut exactly where it ends. False once nothing is left to draw and nothing will be.
   */
  step(dt: number, hx: number, hy: number, hz: number, live: boolean): boolean {
    this.clock += dt;
    if (live && (this.count === 0 || this.clock - this.lastSample >= 1 / this.rate)) {
      if (this.count === this.cap) {
        this.first = (this.first + 1) % this.cap;
        this.count--;
      }
      const o = ((this.first + this.count) % this.cap) * 4;
      this.ring[o] = hx;
      this.ring[o + 1] = hy;
      this.ring[o + 2] = hz;
      this.ring[o + 3] = this.clock;
      this.count++;
      this.lastSample = this.clock;
    }
    const cutoff = this.clock - this.life;
    // The oldest goes once the next one is itself past the end: it is no longer needed to cut there.
    while (this.count >= 2 && this.ring[((this.first + 1) % this.cap) * 4 + 3] <= cutoff) {
      this.first = (this.first + 1) % this.cap;
      this.count--;
    }
    if (live) return true;
    if (this.count === 0) return false;
    const newest = this.ring[((this.first + this.count - 1) % this.cap) * 4 + 3];
    return newest > cutoff;
  }

  /**
   * The points to draw into `drawn`, the carrier first: x, y, z and how far down the ribbon each is
   * (0 at the carrier, 1 at the tail), each span cut into `subdivisions` pieces along a Catmull-Rom
   * curve through the points either side, so a ribbon swung round a stick is a curve rather than a
   * polygon. `m` is a column-major 4x4 that carries the points into the world (a hull's frame), or
   * null. Returns how many points were written.
   */
  points(hx: number, hy: number, hz: number, live: boolean, m: ArrayLike<number> | null): number {
    const raw = this.raw;
    const life = this.life;
    const cutoff = this.clock - life;
    let n = 0;
    const push = (x: number, y: number, z: number, t: number) => {
      if (n > 0) {
        const o = (n - 1) * 4;
        const dx = x - raw[o];
        const dy = y - raw[o + 1];
        const dz = z - raw[o + 2];
        if (dx * dx + dy * dy + dz * dz < SWOOSH_TUNE.minSpan * SWOOSH_TUNE.minSpan) return;
      }
      const o = n * 4;
      raw[o] = x;
      raw[o + 1] = y;
      raw[o + 2] = z;
      raw[o + 3] = life > 0 ? Math.min(1, Math.max(0, (this.clock - t) / life)) : 0;
      n++;
    };
    if (live) push(hx, hy, hz, this.clock);
    for (let k = this.count - 1; k >= 0; k--) {
      const o = ((this.first + k) % this.cap) * 4;
      const t = this.ring[o + 3];
      if (t < cutoff) {
        // Past the end: the tail stops between this point and the one before it, exactly at the cutoff,
        // so the ribbon's end slides rather than stepping back a whole point at a time.
        if (n === 0) break;
        const p = (n - 1) * 4;
        const newer = this.clock - raw[p + 3] * life;
        const f = newer > t ? (newer - cutoff) / (newer - t) : 1;
        push(raw[p] + (this.ring[o] - raw[p]) * f, raw[p + 1] + (this.ring[o + 1] - raw[p + 1]) * f, raw[p + 2] + (this.ring[o + 2] - raw[p + 2]) * f, cutoff);
        break;
      }
      push(this.ring[o], this.ring[o + 1], this.ring[o + 2], t);
    }
    if (n < 2) return 0;
    const out = this.drawn;
    const sub = this.subdivisions;
    let w = 0;
    const emit = (x: number, y: number, z: number, v: number) => {
      const o = w * 4;
      if (m) {
        out[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
        out[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        out[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      } else {
        out[o] = x;
        out[o + 1] = y;
        out[o + 2] = z;
      }
      out[o + 3] = v;
      w++;
    };
    for (let i = 0; i < n - 1; i++) {
      const a = Math.max(0, i - 1) * 4;
      const b = i * 4;
      const c = (i + 1) * 4;
      const d = Math.min(n - 1, i + 2) * 4;
      for (let s = 0; s < sub; s++) {
        const t = s / sub;
        const t2 = t * t;
        const t3 = t2 * t;
        // Catmull-Rom's four weights, which pass through b at 0 and c at 1.
        const wa = -0.5 * t3 + t2 - 0.5 * t;
        const wb = 1.5 * t3 - 2.5 * t2 + 1;
        const wc = -1.5 * t3 + 2 * t2 + 0.5 * t;
        const wd = 0.5 * t3 - 0.5 * t2;
        emit(
          wa * raw[a] + wb * raw[b] + wc * raw[c] + wd * raw[d],
          wa * raw[a + 1] + wb * raw[b + 1] + wc * raw[c + 1] + wd * raw[d + 1],
          wa * raw[a + 2] + wb * raw[b + 2] + wc * raw[c + 2] + wd * raw[d + 2],
          raw[b + 3] + (raw[c + 3] - raw[b + 3]) * t,
        );
      }
    }
    const last = (n - 1) * 4;
    emit(raw[last], raw[last + 1], raw[last + 2], raw[last + 3]);
    return w;
  }
}

/**
 * Write a ribbon's drawn points as quads into a batch's arrays from quad `at`, at most `room` of them:
 * each span a quad between two points, turned to face the camera about the ribbon's own direction,
 * `width` across, V running down the ribbon and U across it within the texture frame (cu, cv, size).
 * The colour is (r, g, b) and the alpha `a`, less the tail's fade. Returns the quads written.
 */
export function writeStrip(
  pts: Float32Array,
  n: number,
  cam: { x: number; y: number; z: number },
  width: number,
  r: number,
  g: number,
  b: number,
  a: number,
  cu: number,
  cv: number,
  size: number,
  pos: Float32Array,
  col: Float32Array,
  uv: Float32Array,
  at: number,
  room: number,
): number {
  if (n < 2 || room <= 0) return 0;
  const half = width * 0.5;
  const fade = SWOOSH_TUNE.tailFade;
  let quads = 0;
  // The side at each point, carried from one span to the next so neighbouring quads share their edge.
  let sx0 = 0;
  let sy0 = 0;
  let sz0 = 0;
  let have = false;
  // The side `side` last worked out.
  let sideX = 0;
  let sideY = 0;
  let sideZ = 0;
  const side = (i: number): boolean => {
    const o = i * 4;
    const p = Math.max(0, i - 1) * 4;
    const q = Math.min(n - 1, i + 1) * 4;
    const tx = pts[q] - pts[p];
    const ty = pts[q + 1] - pts[p + 1];
    const tz = pts[q + 2] - pts[p + 2];
    const vx = cam.x - pts[o];
    const vy = cam.y - pts[o + 1];
    const vz = cam.z - pts[o + 2];
    let x = ty * vz - tz * vy;
    let y = tz * vx - tx * vz;
    let z = tx * vy - ty * vx;
    const len = Math.hypot(x, y, z);
    if (!(len > 1e-12)) return false;
    x *= half / len;
    y *= half / len;
    z *= half / len;
    sideX = x;
    sideY = y;
    sideZ = z;
    return true;
  };
  const alphaAt = (v: number) => (fade > 0 && v > 1 - fade ? a * Math.max(0, (1 - v) / fade) : a);
  for (let i = 0; i < n - 1 && quads < room; i++) {
    if (!have) {
      if (!side(i)) continue;
      sx0 = sideX;
      sy0 = sideY;
      sz0 = sideZ;
      have = true;
    }
    // A point where the ribbon doubles straight back at the camera has no side of its own: it keeps the last.
    if (!side(i + 1)) {
      sideX = sx0;
      sideY = sy0;
      sideZ = sz0;
    }
    const o0 = i * 4;
    const o1 = (i + 1) * 4;
    const q = at + quads;
    const p = q * 12;
    // a: this point +side, b: the next +side, c: the next -side, d: this point -side.
    pos[p] = pts[o0] + sx0; pos[p + 1] = pts[o0 + 1] + sy0; pos[p + 2] = pts[o0 + 2] + sz0;
    pos[p + 3] = pts[o1] + sideX; pos[p + 4] = pts[o1 + 1] + sideY; pos[p + 5] = pts[o1 + 2] + sideZ;
    pos[p + 6] = pts[o1] - sideX; pos[p + 7] = pts[o1 + 1] - sideY; pos[p + 8] = pts[o1 + 2] - sideZ;
    pos[p + 9] = pts[o0] - sx0; pos[p + 10] = pts[o0 + 1] - sy0; pos[p + 11] = pts[o0 + 2] - sz0;
    const a0 = alphaAt(pts[o0 + 3]);
    const a1 = alphaAt(pts[o1 + 3]);
    const c = q * 16;
    col[c] = r; col[c + 1] = g; col[c + 2] = b; col[c + 3] = a0;
    col[c + 4] = r; col[c + 5] = g; col[c + 6] = b; col[c + 7] = a1;
    col[c + 8] = r; col[c + 9] = g; col[c + 10] = b; col[c + 11] = a1;
    col[c + 12] = r; col[c + 13] = g; col[c + 14] = b; col[c + 15] = a0;
    const v0 = cv + pts[o0 + 3] * size;
    const v1 = cv + pts[o1 + 3] * size;
    const u = q * 8;
    uv[u] = cu + size; uv[u + 1] = v0;
    uv[u + 2] = cu + size; uv[u + 3] = v1;
    uv[u + 4] = cu; uv[u + 5] = v1;
    uv[u + 6] = cu; uv[u + 7] = v0;
    sx0 = sideX;
    sy0 = sideY;
    sz0 = sideZ;
    quads++;
  }
  return quads;
}

/** How many quads a ribbon of `n` drawn points writes at most. */
export function stripQuads(n: number): number {
  return n > 1 ? n - 1 : 0;
}
