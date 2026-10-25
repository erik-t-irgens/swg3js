// The ground fog's rules (the third wave, the design's §2.6 as the owner's answer of 2026-10-24 changes it): whether a
// world's morning and evening are foggy and how thick, drawn per world per day on the shared clock; the level the hour
// brings; how it burns off and lifts; how its top varies over the ground; and a small CPU mirror of the field's fog
// channel, which the node test pools in a stand-in valley.
//
// **A fog day is a hash, never a roll.** The day's number is the drawn day, counted against the clock everybody shares
// (`FogDayCount`), and hashed with the world's id, exactly as the weather's schedule shares its weather with nothing sent: every player
// on a server agrees, and a player alone sees the same day twice. A world the table (`GROUND_FOG_LOOKS`) has no row for
// never fogs.
//
// **The fog is emitted and carried, never imposed** (the design's decision 31): nothing here relaxes the field toward a
// level. The level `F(t)` only sets how much the window's inflow carries in on the wind and how much the ground emits,
// patchily, so banks come in with gaps between them and pool in hollows by the drainage.
//
// Pure: no three, nothing of the page.
import { AIR_TUNE, GROUND_FOG_LOOKS, type FogLook } from './airTune.ts';

/** A fresh 32-bit hash of a world's id, a day's number and a salt (FNV-1a over the id, then the day mixed in), as 0..1. */
export function fogHash(world: string, day: number, salt: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < world.length; i++) {
    h ^= world.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // The day and the salt mixed in by an integer finaliser, so neighbouring days are unrelated.
  let x = (h ^ Math.imul((day | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * How far, as a share of a day, the drawn time may stand from the shared clock's own hour and still be taken as following
 * it [ours]: the day's ease keeps it within a hundredth of a day; past a quarter the drawn time is held by hand, fast
 * forwarded or being put right, and the count steps with the drawn time alone.
 */
export const FOG_DAY_AGREE = 0.25;

/**
 * The drawn day's number, the day whose fog is drawn, kept from frame to frame and stepped exactly at the drawn midnight.
 *
 * **It counts the drawn time's own wraps, never the wall clock against the drawn time**: with no server the drawn time
 * runs at its own pace (a frame's step is clamped, the fast-forward key runs it ninety times over, a hidden tab comes back
 * with one clamped step), so a number worked out as the wall's days less the drawn time drifted off a whole number and
 * stepped wherever its fraction crossed a half -- twice a drawn day at 10 frames a second, mid-morning after a tab hidden
 * six minutes. So the count is seeded once (from the shared clock's continuous day where there is one, else this
 * machine's wall, `wall`: days since the epoch at the planet's phase, unfloored), and then steps forward a day when the
 * drawn time wraps past midnight and back a day when it wraps the other way (a correction by the shorter way round).
 *
 * **With a server it is the shared day wherever the drawn time follows the shared clock**: `shared` is the shared
 * clock's own continuous day (its anchor, its phase, unfloored; NaN with no server), and while the drawn time stands
 * within `FOG_DAY_AGREE` of its hour the count is the whole number that puts the drawn moment nearest it, so every
 * browser names the same day whatever the anchor's fraction and wherever each stands in its ease; held, fast forwarded or
 * correcting, it steps with the drawn time as with no server, and is taken back to the shared day once the drawn time
 * follows again.
 */
export class FogDayCount {
  /** In, written before each `step` (no number handed across a call on the frame): the drawn time, 0 midnight. */
  time = 0.5;
  /** In: the shared clock's continuous day (NaN with no server), and this machine's (`SharedClock.dayCountIn` writes both). */
  shared = Number.NaN;
  wall = 0.5;
  /** Out: the drawn day's number; NaN before the first step. */
  day = Number.NaN;
  private last = Number.NaN;

  step(): void {
    const time = this.time;
    const shared = this.shared;
    const wall = this.wall;
    const t = Number.isFinite(time) ? time - Math.floor(time) : 0;
    if (!Number.isFinite(this.day) || !Number.isFinite(this.last)) {
      const from = Number.isFinite(shared) ? shared : Number.isFinite(wall) ? wall : 0;
      this.day = Math.round(from - t);
    } else {
      const d = t - this.last;
      if (d < -0.5) this.day += 1;
      else if (d > 0.5) this.day -= 1;
    }
    if (Number.isFinite(shared)) {
      // How far the drawn hour stands from the shared one, the shorter way round.
      const e0 = shared - t;
      const e = e0 - Math.round(e0);
      if ((e < 0 ? -e : e) < FOG_DAY_AGREE) this.day = Math.round(e0);
    }
    this.last = t;
  }

  /** Forgotten: the next step seeds it again. */
  reset(): void {
    this.day = Number.NaN;
    this.last = Number.NaN;
  }
}

/** One day's fog on one world: whether its morning and evening are foggy and how thick (0 for none). */
export interface FogDay {
  morning: number;
  evening: number;
  /** The evening before this day's midnight: the night carries it into the morning. */
  eveningBefore: number;
}

/** A world's draw for one day (no row, no fog): a chance roll and a thickness, each its own hash. */
export function fogDayOf(world: string, day: number, out: FogDay, looks: Readonly<Record<string, FogLook>> = GROUND_FOG_LOOKS): FogDay {
  const look = looks[world];
  out.morning = 0;
  out.evening = 0;
  out.eveningBefore = 0;
  if (!look) return out;
  out.morning = drawOf(world, day, 1, look.morning, look.morningLo, look.morningHi);
  out.evening = drawOf(world, day, 3, look.evening, look.eveningLo, look.eveningHi);
  out.eveningBefore = drawOf(world, day - 1, 3, look.evening, look.eveningLo, look.eveningHi);
  return out;
}

function drawOf(world: string, day: number, salt: number, chance: number, lo: number, hi: number): number {
  if (!(fogHash(world, day, salt) < chance)) return 0;
  const k = fogHash(world, day, salt + 1);
  const a = lo < hi ? lo : hi;
  const b = lo < hi ? hi : lo;
  return a + (b - a) * k;
}

/** The game's own day: first light at 06:00 (a quarter), dusk at the client's 70% of the day after it. */
export const FOG_HOURS = {
  /** First light, as a share of the day from midnight. */
  dawn: 0.25,
  /** Three hours after first light the morning's fog has burnt off. */
  morningEnds: 0.375,
  /** The client's dusk: 06:00 plus 70% of the day. */
  dusk: 0.95,
  /** The evening's fog rises over the hour before dusk. */
  eveningFrom: 0.95 - 1 / 24,
  /** After midnight the night carries the evening's level into the morning's by 03:00. */
  nightBlend: 0.125,
} as const;

/**
 * The hour's fog, in a kept record: in, the drawn time (0 midnight, 0.5 noon), the day's draw and the look's height at
 * dawn; out, the level `F(t)` the inflow and the ground emit by, the morning's peak, how far it has burnt off (0 at its
 * peak, 1 gone), and the top it fills to (the look's at dawn, rising toward `fog.topMax` as it thins).
 */
export interface FogHour {
  time: number;
  morning: number;
  evening: number;
  eveningBefore: number;
  lookTop: number;
  level: number;
  peak: number;
  burn: number;
  top: number;
}

export function newFogHour(): FogHour {
  return { time: 0.5, morning: 0.5, evening: 0.5, eveningBefore: 0.5, lookTop: 0.5, level: 0.5, peak: 0.5, burn: 0.5, top: 0.5 };
}

const smooth01 = (t: number): number => {
  const x = t > 0 ? (t < 1 ? t : 1) : 0;
  return x * x * (3 - 2 * x);
};

export function fogHourIn(r: FogHour): void {
  const H = FOG_HOURS;
  const t = Number.isFinite(r.time) ? r.time - Math.floor(r.time) : 0.5;
  const m = r.morning > 0 ? r.morning : 0;
  const e = r.evening > 0 ? r.evening : 0;
  const eb = r.eveningBefore > 0 ? r.eveningBefore : 0;
  let level = 0;
  let burn = 0;
  if (t < H.nightBlend) level = eb + (m - eb) * smooth01(t / H.nightBlend);
  else if (t < H.dawn) level = m;
  else if (t < H.morningEnds) {
    const k = smooth01((t - H.dawn) / (H.morningEnds - H.dawn));
    level = m * (1 - k);
    burn = m > 0 ? k : 0;
  } else if (t < H.eveningFrom) level = 0;
  else if (t < H.dusk) level = e * smooth01((t - H.eveningFrom) / (H.dusk - H.eveningFrom));
  else level = e;
  r.level = level;
  r.peak = m;
  r.burn = burn;
  const top0 = r.lookTop > 0 ? r.lookTop : 0;
  const most = AIR_TUNE.fog.topMax;
  r.top = top0 + (most - top0) * burn;
}

/**
 * The fog's top over a point (the owner's "height differences"): the hour's top raised or lowered by a slow noise `n`
 * (0 to 1, the field's own gust noise read at `fog.topScale` metres a cell, drifting on the wind) -- up to `topRise` more
 * where the noise is high, down to `topLow` of itself where it is low -- so banks stand taller in places and thin to
 * ground-hugging wisps in others. The march's line, for the test.
 */
export function fogTopAt(top: number, n: number, f = AIR_TUNE.fog): number {
  const k = Number.isFinite(n) ? (n < 0 ? 0 : n > 1 ? 1 : n) : 0.5;
  const lo = f.topLow > 0 ? f.topLow : 0;
  return top * (lo + (1 + f.topRise - lo) * k);
}

/**
 * The fog's height profile at `h` metres over the ground, under a top of `top`: full to 55% of the top and gone at it,
 * a level ceiling with the rooftops standing out of it [demo `land.html:1152`]. The march's line.
 */
export function fogProfile(h: number, top: number): number {
  if (!(h >= 0) || !(top > 0)) return 0;
  const a = 0.55 * top;
  const x = (h - a) / (top - a);
  return 1 - smooth01(x);
}

/** How patchily the ground emits: nought under `gaps` of the noise, rising to one above it (banks with gaps). */
export function fogPatch(n: number, gaps = AIR_TUNE.fog.gaps): number {
  const g = gaps > 0 ? (gaps < 0.99 ? gaps : 0.99) : 0;
  const x = (Number.isFinite(n) ? n : 0) - g;
  return x > 0 ? x / (1 - g) : 0;
}

/**
 * A small CPU mirror of the field's fog channel on a square grid of `n` cells of `cell` metres (the node test's): one
 * step of `dt` -- each cell backtraced by the wind plus the drainage down the ground's fall line where it leans past
 * `drainFrom`, the read bilinear (the inflow, `inflow`, outside), then the decay with the burn, then the ground's
 * emission times the patch noise. The shader's arithmetic, line for line (`SMOKE_FRAGMENT`'s fog channel).
 */
export interface FogGrid {
  n: number;
  cell: number;
  fog: Float64Array;
  next: Float64Array;
  ground: Float64Array;
  patch: Float64Array;
  windX: number;
  windZ: number;
  inflow: number;
  level: number;
  burn: number;
}

export function newFogGrid(n: number, cell: number): FogGrid {
  return { n, cell, fog: new Float64Array(n * n), next: new Float64Array(n * n), ground: new Float64Array(n * n), patch: new Float64Array(n * n).fill(1), windX: 0, windZ: 0, inflow: 0, level: 0, burn: 0 };
}

/**
 * The drainage at a cell, into `out`: its velocity, m/s, down the fall line -- `drain` where the ground leans past
 * `drainFrom` degrees, in proportion to the lean under it, so it never jumps -- and that velocity's divergence, a second
 * (`div`), which the fog is compressed by as it is carried (`exp(−div · dt)`, the continuity equation along the backtrace):
 * where the drainage converges -- a hollow, the foot of a slope -- the fog piles up, where it spreads it thins. Under the
 * lean the divergence is the proportional field's own, `−drain · Δh / lean`; past it, the unit field's, `−drain · (h_xx h_z²
 * − 2 h_xz h_x h_z + h_zz h_x²) / |∇h|³`, each held to `±FOG_DIV_MOST`. The shader's lines (`SMOKE_FRAGMENT`).
 */
export function fogDrainAt(g: FogGrid, i: number, j: number, out: { x: number; z: number; div: number }, f = AIR_TUNE.fog): { x: number; z: number; div: number } {
  const n = g.n;
  const at = (a: number, b: number): number => g.ground[Math.min(n - 1, Math.max(0, b)) * n + Math.min(n - 1, Math.max(0, a))];
  const c = g.cell;
  const hc = at(i, j);
  const hl = at(i - 1, j);
  const hr = at(i + 1, j);
  const hb = at(i, j - 1);
  const ht = at(i, j + 1);
  const gx = (hr - hl) / (2 * c);
  const gz = (ht - hb) / (2 * c);
  const hxx = (hr - 2 * hc + hl) / (c * c);
  const hzz = (ht - 2 * hc + hb) / (c * c);
  const hxz = (at(i + 1, j + 1) - at(i - 1, j + 1) - at(i + 1, j - 1) + at(i - 1, j - 1)) / (4 * c * c);
  const s = Math.sqrt(gx * gx + gz * gz);
  const lean0 = Math.tan(((f.drainFrom > 0 ? f.drainFrom : 0) * Math.PI) / 180);
  const lean = lean0 > 1e-4 ? lean0 : 1e-4;
  const D = f.drain;
  let div: number;
  if (s < lean) {
    out.x = (-gx / lean) * D;
    out.z = (-gz / lean) * D;
    div = (-D * (hxx + hzz)) / lean;
  } else {
    out.x = (-gx / s) * D;
    out.z = (-gz / s) * D;
    div = (-D * (hxx * gz * gz - 2 * hxz * gx * gz + hzz * gx * gx)) / (s * s * s);
  }
  out.div = div > FOG_DIV_MOST ? FOG_DIV_MOST : div < -FOG_DIV_MOST ? -FOG_DIV_MOST : div;
  return out;
}

/** The drainage's divergence is held to this either way, a second [ours: a crest's or a pit's own point never blows up]. */
export const FOG_DIV_MOST = 2;

export function fogStepGrid(g: FogGrid, dt: number, f = AIR_TUNE.fog): void {
  const n = g.n;
  const v = { x: 0, z: 0, div: 0 };
  const read = (x: number, z: number): number => {
    if (x < 0 || z < 0 || x > n - 1 || z > n - 1) return g.inflow;
    const i0 = Math.floor(x);
    const j0 = Math.floor(z);
    const i1 = Math.min(n - 1, i0 + 1);
    const j1 = Math.min(n - 1, j0 + 1);
    const fx = x - i0;
    const fz = z - j0;
    const a = g.fog[j0 * n + i0] * (1 - fx) + g.fog[j0 * n + i1] * fx;
    const b = g.fog[j1 * n + i0] * (1 - fx) + g.fog[j1 * n + i1] * fx;
    return a * (1 - fz) + b * fz;
  };
  const decay = Math.exp(-(f.decay + f.burn * g.burn) * dt);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      fogDrainAt(g, i, j, v, f);
      const ux = g.windX + v.x;
      const uz = g.windZ + v.z;
      const back = read(i - (ux * dt) / g.cell, j - (uz * dt) / g.cell);
      // Compressed where the drainage converges, never past `poolMost` by that (a bank already denser keeps its own).
      const pressed = back * Math.exp(-v.div * dt);
      const cap = back > f.poolMost ? back : f.poolMost;
      const kept = v.div < 0 ? (pressed < cap ? pressed : cap) : pressed;
      g.next[j * n + i] = kept * decay + f.emit * g.level * fogPatch(g.patch[j * n + i], f.gaps) * dt;
    }
  }
  const t = g.fog;
  g.fog = g.next;
  g.next = t;
}
