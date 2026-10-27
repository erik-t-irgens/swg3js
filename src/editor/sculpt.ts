// The sculpt brush's stroke, pure (Map-maker II, DESIGN.md §2.4): what a stamp does to the ground's height edits, worked
// out in the raw frame over the 2 m poles a tile of the store holds (`heightEdits.ts`).
//
// **The weight** of a stamp of radius R at a pole d from its middle is `u = clamp((R - d) / (R (1 - hard)), 0, 1)`,
// `f = feather(falloff, u)` with **the client's own four feather functions** (`generator.ts`: linear, easeIn, easeOut,
// easeInOut, imported, never copied), and `w = strength * f * keep(x, z)`. **Every mode is written per second** and a stamp
// is `dt = 1 / rate` of it, so a held second gives the same ground at any rate (`stampsDue`, `brush.ts`, stamps on the
// scatter brush's clock):
// - **raise** and **lower**: `d += +-w * speed * dt`;
// - **flatten to a height H** (both ways, raise only, lower only): `q = w (1 - exp(-dt / tau))`, `d += q (H - h)`, `h` the
//   ground now (raw plus the delta);
// - **smooth**: Jacobi, never in place -- the 1-2-1 mean of the 3 x 3 poles round each pole, from the heights as they stood
//   before the stamp, `d += q (m - h)` with `q = w (1 - exp(-dt / smoothTau))`; it reads one pole past the disc.
// Within a stroke the deltas are kept in float64 (one array a tile touched) and written into the store's float32 tiles as
// they go, so a held second at 10, 30 and 60 stamps a second rounds to the same float32 deltas.
//
// **Keep off what stands** (`keepWeight`): nought inside the footprint of everything the brush must not move the ground
// under (a box grown by `keepMargin`, a trunk by `keepTrunkMargin`), feathered back to one over `keepFeather` and
// `keepTrunkFeather` (the client's easeInOut), one elsewhere; a row of ours the stroke carries is never in the list.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties. The dev server's alone: reached only through the editor.

import { FeatherFunction, feather } from '../swg/terrain/generator.ts';
import { HEIGHT_POLE, HEIGHT_TILE_POLES, tileNumber, tileOfNumber, type HeightEdits } from '../swg/terrain/heightEdits.ts';

export type SculptMode = 'raise' | 'lower' | 'flatten' | 'smooth';
export const SCULPT_MODES: readonly SculptMode[] = ['raise', 'lower', 'flatten', 'smooth'];
export type SculptFalloff = keyof typeof FeatherFunction;
export const SCULPT_FALLOFFS: readonly SculptFalloff[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
export type FlatMode = 'both' | 'raise' | 'lower';
export const FLAT_MODES: readonly FlatMode[] = ['both', 'raise', 'lower'];
export type SculptTarget = 'press' | 'sampled' | 'typed' | 'stamp';
export const SCULPT_TARGETS: readonly SculptTarget[] = ['press', 'sampled', 'typed', 'stamp'];

/** A stamp's weight at a pole `d` metres from its middle, before the keep-off mask: the client's feather over the band past the hard core. */
export function stampWeight(d: number, radius: number, hard: number, falloff: SculptFalloff): number {
  if (!(radius > 0) || !(d <= radius)) return 0;
  const band = radius * (1 - Math.min(1, Math.max(0, hard)));
  const u = band > 0 ? Math.min(1, Math.max(0, (radius - d) / band)) : 1;
  return feather(FeatherFunction[falloff] ?? FeatherFunction.easeInOut, u);
}

/**
 * One thing the brush keeps off (`keepWeight`), in the same frame as the poles it is asked at: a turned box (its middle,
 * its half sizes along its own X and Z, which way its own X points) or a trunk (a circle).
 */
export interface KeepFoot {
  kind: 'box' | 'trunk';
  x: number;
  z: number;
  hx: number;
  hz: number;
  cos: number;
  sin: number;
  r: number;
  /** Whose it is (the game's, ours, a player's), the template it is filed under and a key the stroke's counts are kept by. */
  owner?: 'game' | 'ours' | 'player';
  template?: string;
  key?: string;
}

/** The keep-off numbers a mask is worked out with. */
export interface KeepTune {
  keepMargin: number;
  keepFeather: number;
  keepTrunkMargin: number;
  keepTrunkFeather: number;
}

/** The client's easeInOut over a feather's band, nought at its inside and one past it. */
function band(dist: number, width: number): number {
  if (!(dist > 0)) return 0;
  if (!(width > 0)) return 1;
  const t = dist >= width ? 1 : dist / width;
  return feather(FeatherFunction.easeInOut, t);
}

/** How far a point stands outside a foot grown by its margin (nought inside), and the feather it fades back over. */
function footReach(f: KeepFoot, x: number, z: number, t: KeepTune): number {
  const dx = x - f.x;
  const dz = z - f.z;
  if (f.kind === 'trunk') return band(Math.sqrt(dx * dx + dz * dz) - (f.r + t.keepTrunkMargin), t.keepTrunkFeather);
  const u = dx * f.cos + dz * f.sin;
  const v = -dx * f.sin + dz * f.cos;
  const ou = Math.max(0, Math.abs(u) - (f.hx + t.keepMargin));
  const ov = Math.max(0, Math.abs(v) - (f.hz + t.keepMargin));
  return band(Math.sqrt(ou * ou + ov * ov), t.keepFeather);
}

/** The keep-off mask at a point: the least over every foot (nought inside any grown footprint, one clear of all of them). */
export function keepWeight(feet: readonly KeepFoot[], x: number, z: number, t: KeepTune): number {
  let k = 1;
  for (let i = 0; i < feet.length && k > 0; i++) {
    const w = footReach(feet[i], x, z, t);
    if (w < k) k = w;
  }
  return k;
}

/**
 * How far from its middle a foot can keep anything off at all: its footprint grown by its margin, then its feather. Past
 * this `footReach` is one, so a pole further off than it takes nothing from the foot (a negative margin or feather counted
 * as nought, which only shrinks what the foot reaches).
 */
export function footBound(f: KeepFoot, t: KeepTune): number {
  if (f.kind === 'trunk') return Math.max(0, f.r + t.keepTrunkMargin) + Math.max(0, t.keepTrunkFeather);
  return Math.hypot(Math.max(0, f.hx + t.keepMargin), Math.max(0, f.hz + t.keepMargin)) + Math.max(0, t.keepFeather);
}

/** Whether a foot's own footprint (never grown) meets a disc of radius `r` round (x, z), in the foot's own frame: what a stroke counts as having reached it. */
export function footMeetsDisc(f: KeepFoot, x: number, z: number, r: number): boolean {
  const dx = x - f.x;
  const dz = z - f.z;
  if (f.kind === 'trunk') return Math.sqrt(dx * dx + dz * dz) - f.r < r;
  const u = dx * f.cos + dz * f.sin;
  const v = -dx * f.sin + dz * f.cos;
  const ou = Math.max(0, Math.abs(u) - f.hx);
  const ov = Math.max(0, Math.abs(v) - f.hz);
  return Math.sqrt(ou * ou + ov * ov) < r;
}

/** A point of one frame written into a kept record in the other (the game's and the raw: a mirror and a shift). */
export type FrameTo = (x: number, z: number, out: { x: number; z: number }) => void;

/**
 * The keep-off mask of one stamp, worked out once over the stamp's own disc of poles (the very window `SculptStroke.stamp`
 * walks) rather than asked of every foot at every pole: each foot lowers only the poles inside its own reach (`footBound`),
 * each by `footReach` at that pole, the least kept. So a stamp costs the poles its feet reach, never the disc's poles times
 * its feet (a 200 m brush in a town is some 31,000 poles and hundreds of feet). The weight at a pole is `keepWeight` over the
 * same feet to the bit: one where no foot reaches, the least of their reaches elsewhere. Kept and grown, never made a stamp.
 */
export class KeepGrid {
  px0 = 0;
  pz0 = 0;
  nx = 0;
  nz = 0;
  w = new Float64Array(0);
  /** Whether any foot lowered any pole of this stamp. */
  any = false;
  private readonly g = { x: 0.5, z: 0.5 };
  private readonly c = { x: 0.5, z: 0.5 };

  /** Every pole of the disc round (cx, cz) of the raw frame at one: the window the stamp walks. */
  reset(cx: number, cz: number, radius: number): void {
    this.px0 = Math.ceil((cx - radius) / HEIGHT_POLE);
    this.pz0 = Math.ceil((cz - radius) / HEIGHT_POLE);
    const nx = Math.floor((cx + radius) / HEIGHT_POLE) - this.px0 + 1;
    const nz = Math.floor((cz + radius) / HEIGHT_POLE) - this.pz0 + 1;
    this.nx = nx > 0 ? nx : 0;
    this.nz = nz > 0 ? nz : 0;
    const need = this.nx * this.nz;
    if (this.w.length < need) this.w = new Float64Array(need);
    this.w.fill(1, 0, need);
    this.any = false;
  }

  /**
   * One foot (in the game's frame) laid in: every pole of the window inside its reach lowered to `footReach` where that is
   * less. `toGame` and `toRaw` carry a point between the frames. Answers whether it lowered any pole.
   */
  lay(f: KeepFoot, t: KeepTune, toGame: FrameTo, toRaw: FrameTo): boolean {
    if (!this.nx || !this.nz) return false;
    const b = footBound(f, t);
    // The foot's reach as a box of the raw frame, from its four corners (the frames are a mirror and a shift, so two would do).
    const c = this.c;
    let rx0 = Infinity;
    let rx1 = -Infinity;
    let rz0 = Infinity;
    let rz1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      toRaw(f.x + (k & 1 ? b : -b), f.z + (k & 2 ? b : -b), c);
      if (c.x < rx0) rx0 = c.x;
      if (c.x > rx1) rx1 = c.x;
      if (c.z < rz0) rz0 = c.z;
      if (c.z > rz1) rz1 = c.z;
    }
    const i0 = Math.max(0, Math.ceil(rx0 / HEIGHT_POLE) - this.px0);
    const i1 = Math.min(this.nx - 1, Math.floor(rx1 / HEIGHT_POLE) - this.px0);
    const j0 = Math.max(0, Math.ceil(rz0 / HEIGHT_POLE) - this.pz0);
    const j1 = Math.min(this.nz - 1, Math.floor(rz1 / HEIGHT_POLE) - this.pz0);
    if (i0 > i1 || j0 > j1) return false;
    const g = this.g;
    const w = this.w;
    let lowered = false;
    for (let j = j0; j <= j1; j++) {
      const z = (this.pz0 + j) * HEIGHT_POLE;
      const row = j * this.nx;
      for (let i = i0; i <= i1; i++) {
        const k = row + i;
        if (!(w[k] > 0)) continue;
        toGame((this.px0 + i) * HEIGHT_POLE, z, g);
        const r = footReach(f, g.x, g.z, t);
        if (r < w[k]) {
          w[k] = r;
          lowered = true;
        }
      }
    }
    if (lowered) this.any = true;
    return lowered;
  }

  /** The mask at a pole of the raw frame (x = 2 px): its weight, one off the window. A kept function, so a stamp makes none. */
  readonly at = (x: number, z: number): number => {
    const i = Math.round(x / HEIGHT_POLE) - this.px0;
    const j = Math.round(z / HEIGHT_POLE) - this.pz0;
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 1;
    return this.w[j * this.nx + i];
  };
}

/** What a stamp is asked: its mode, its middle in the raw frame, its numbers, its seconds and its target height. */
export interface StampAsk {
  mode: SculptMode;
  cx: number;
  cz: number;
  radius: number;
  hard: number;
  falloff: SculptFalloff;
  strength: number;
  speed: number;
  tau: number;
  smoothTau: number;
  flatMode: FlatMode;
  /** Flatten's target height, absolute metres. */
  height: number;
  /** The stamp's seconds (`1 / rate`). */
  dt: number;
}

/** The ground a stroke reads: the raw height at a pole of the raw frame (pole px at x = 2 px), NaN where none can be had. */
export type RawAt = (px: number, pz: number) => number;

/** A rectangle of the raw frame a stamp changed, its poles' places; empty while `x0 > x1`. */
export interface RawRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** An empty rectangle. */
export function rawRect(): RawRect {
  return { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
}

/**
 * A stroke over a store: the tiles it touched kept as they stood before it (`before`, null for a tile it made) and its
 * deltas in float64 (one array a tile touched), written into the store's own float32 tiles as each stamp goes. Nothing is
 * written to a file here: the glue writes the tiles once, as the stroke ends (`editorSculpt.ts`).
 */
export class SculptStroke {
  readonly store: HeightEdits;
  readonly raw: RawAt;
  /** Each touched tile's deltas before the stroke, by tile number (null for one the stroke made). */
  readonly before = new Map<number, Float32Array | null>();
  /** Each touched tile's deltas as the stroke keeps them, float64. */
  private readonly d64 = new Map<number, Float64Array>();
  /** How many stamps it took, and the raw-frame rectangle every stamp together changed. */
  stamps = 0;
  readonly rect = rawRect();
  /** The smooth's heights before the stamp, a window round the disc (grown as asked). */
  private scratch = new Float64Array(0);

  constructor(store: HeightEdits, raw: RawAt) {
    this.store = store;
    this.raw = raw;
  }

  /** A tile's float64 deltas, taken from the store at its first touch (its before kept). */
  private tile64(n: number): Float64Array {
    let d = this.d64.get(n);
    if (d) return d;
    const t = tileOfNumber(n);
    const had = this.store.tile(t.tx, t.tz);
    this.before.set(n, had ? new Float32Array(had) : null);
    d = new Float64Array(HEIGHT_TILE_POLES * HEIGHT_TILE_POLES);
    if (had) for (let i = 0; i < had.length; i++) d[i] = had[i];
    this.d64.set(n, d);
    return d;
  }

  /** The delta at a pole as the stroke holds it now (float64 where it has touched the tile, the store's elsewhere). */
  delta(px: number, pz: number): number {
    const tx = Math.floor(px / HEIGHT_TILE_POLES);
    const tz = Math.floor(pz / HEIGHT_TILE_POLES);
    const n = tileNumber(tx, tz);
    const d = this.d64.get(n);
    if (d) return d[(pz - tz * HEIGHT_TILE_POLES) * HEIGHT_TILE_POLES + (px - tx * HEIGHT_TILE_POLES)];
    return this.store.poleDelta(px, pz);
  }

  /** The delta a pole had before the stroke. */
  deltaBefore(px: number, pz: number): number {
    const tx = Math.floor(px / HEIGHT_TILE_POLES);
    const tz = Math.floor(pz / HEIGHT_TILE_POLES);
    const n = tileNumber(tx, tz);
    if (this.before.has(n)) {
      const b = this.before.get(n);
      return b ? b[(pz - tz * HEIGHT_TILE_POLES) * HEIGHT_TILE_POLES + (px - tx * HEIGHT_TILE_POLES)] : 0;
    }
    return this.store.poleDelta(px, pz);
  }

  /** The ground at a pole now: raw plus the stroke's delta. */
  heightAt(px: number, pz: number): number {
    return this.raw(px, pz) + this.delta(px, pz);
  }

  /** The ground between poles now, bilinear over the four round (x, z) of the raw frame. */
  heightBetween(x: number, z: number): number {
    const fx = x / HEIGHT_POLE;
    const fz = z / HEIGHT_POLE;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    return (this.heightAt(i, j) * (1 - u) + this.heightAt(i + 1, j) * u) * (1 - v) + (this.heightAt(i, j + 1) * (1 - u) + this.heightAt(i + 1, j + 1) * u) * v;
  }

  /** How far the stroke has moved the ground at a point of the raw frame, bilinear (what carry moves a row by). */
  movedAt(x: number, z: number): number {
    const fx = x / HEIGHT_POLE;
    const fz = z / HEIGHT_POLE;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const m = (a: number, b: number) => this.delta(a, b) - this.deltaBefore(a, b);
    return (m(i, j) * (1 - u) + m(i + 1, j) * u) * (1 - v) + (m(i, j + 1) * (1 - u) + m(i + 1, j + 1) * u) * v;
  }

  /** A delta written at a pole: kept in float64 and put into the store's tile rounded once (a nought always +0). */
  private write(px: number, pz: number, v: number): void {
    const tx = Math.floor(px / HEIGHT_TILE_POLES);
    const tz = Math.floor(pz / HEIGHT_TILE_POLES);
    const n = tileNumber(tx, tz);
    if (n < 0) return;
    const d = this.tile64(n);
    const k = (pz - tz * HEIGHT_TILE_POLES) * HEIGHT_TILE_POLES + (px - tx * HEIGHT_TILE_POLES);
    d[k] = v;
    const t = this.store.writable(tx, tz);
    if (t) t[k] = v === 0 ? 0 : Math.fround(v);
  }

  /**
   * One stamp: every pole in the disc moved by its mode's per-second rule times `dt`, weighted by the feather and by
   * `keep` (the keep-off mask at a pole of the raw frame, one where nothing is kept off). Answers the rectangle of the raw
   * frame it changed (empty where it changed nothing), unioned into the stroke's `rect` too.
   */
  stamp(a: StampAsk, keep: (x: number, z: number) => number, out: RawRect = rawRect()): RawRect {
    out.x0 = Infinity;
    out.z0 = Infinity;
    out.x1 = -Infinity;
    out.z1 = -Infinity;
    const R = a.radius;
    if (!(R > 0) || !(a.dt > 0)) return out;
    this.stamps++;
    const px0 = Math.ceil((a.cx - R) / HEIGHT_POLE);
    const px1 = Math.floor((a.cx + R) / HEIGHT_POLE);
    const pz0 = Math.ceil((a.cz - R) / HEIGHT_POLE);
    const pz1 = Math.floor((a.cz + R) / HEIGHT_POLE);
    const nx = px1 - px0 + 1;
    const nz = pz1 - pz0 + 1;
    if (nx <= 0 || nz <= 0) return out;
    // The smooth reads the heights before the stamp, one pole past the disc each way (Jacobi).
    let hs: Float64Array | null = null;
    const wx = nx + 2;
    if (a.mode === 'smooth') {
      const need = wx * (nz + 2);
      if (this.scratch.length < need) this.scratch = new Float64Array(need);
      hs = this.scratch;
      for (let j = 0; j < nz + 2; j++) for (let i = 0; i < wx; i++) hs[j * wx + i] = this.heightAt(px0 - 1 + i, pz0 - 1 + j);
    }
    const qFlat = 1 - Math.exp(-a.dt / Math.max(1e-6, a.tau));
    const qSmooth = 1 - Math.exp(-a.dt / Math.max(1e-6, a.smoothTau));
    for (let j = 0; j < nz; j++) {
      const pz = pz0 + j;
      const z = pz * HEIGHT_POLE;
      for (let i = 0; i < nx; i++) {
        const px = px0 + i;
        const x = px * HEIGHT_POLE;
        const dx = x - a.cx;
        const dz = z - a.cz;
        const f = stampWeight(Math.sqrt(dx * dx + dz * dz), R, a.hard, a.falloff);
        if (!(f > 0)) continue;
        const w = a.strength * f * keep(x, z);
        if (!(w > 0)) continue;
        const d = this.delta(px, pz);
        let next = d;
        if (a.mode === 'raise') next = d + w * a.speed * a.dt;
        else if (a.mode === 'lower') next = d - w * a.speed * a.dt;
        else if (a.mode === 'flatten') {
          const h = this.raw(px, pz) + d;
          if (!Number.isFinite(h)) continue;
          const want = a.height - h;
          if ((a.flatMode === 'raise' && want <= 0) || (a.flatMode === 'lower' && want >= 0)) continue;
          next = d + w * qFlat * want;
        } else {
          const k = (j + 1) * wx + (i + 1);
          const h = hs![k];
          if (!Number.isFinite(h)) continue;
          const m = (4 * h + 2 * (hs![k - 1] + hs![k + 1] + hs![k - wx] + hs![k + wx]) + (hs![k - wx - 1] + hs![k - wx + 1] + hs![k + wx - 1] + hs![k + wx + 1])) / 16;
          if (!Number.isFinite(m)) continue;
          next = d + w * qSmooth * (m - h);
        }
        if (next === d) continue;
        this.write(px, pz, next);
        if (x < out.x0) out.x0 = x;
        if (x > out.x1) out.x1 = x;
        if (z < out.z0) out.z0 = z;
        if (z > out.z1) out.z1 = z;
      }
    }
    const r = this.rect;
    if (out.x0 <= out.x1) {
      r.x0 = Math.min(r.x0, out.x0);
      r.z0 = Math.min(r.z0, out.z0);
      r.x1 = Math.max(r.x1, out.x1);
      r.z1 = Math.max(r.z1, out.z1);
    }
    return out;
  }

  /** Every tile the stroke touched, by its place, with its deltas before and after (the store's own, pruned of noughts). */
  touched(): { tx: number; tz: number; before: Float32Array | null; after: Float32Array | null }[] {
    const out: { tx: number; tz: number; before: Float32Array | null; after: Float32Array | null }[] = [];
    for (const [n, before] of this.before) {
      const t = tileOfNumber(n);
      const still = this.store.prune(t.tx, t.tz);
      out.push({ tx: t.tx, tz: t.tz, before, after: still ? this.store.tile(t.tx, t.tz) : null });
    }
    return out;
  }

  /** Every touched tile put back as it stood before the stroke (a write refused). Answers the raw-frame rectangle they cover. */
  putBack(): RawRect {
    const r = rawRect();
    for (const [n, before] of this.before) {
      const t = tileOfNumber(n);
      this.store.set(t.tx, t.tz, before);
      r.x0 = Math.min(r.x0, t.tx * HEIGHT_TILE_POLES * HEIGHT_POLE);
      r.z0 = Math.min(r.z0, t.tz * HEIGHT_TILE_POLES * HEIGHT_POLE);
      r.x1 = Math.max(r.x1, (t.tx + 1) * HEIGHT_TILE_POLES * HEIGHT_POLE);
      r.z1 = Math.max(r.z1, (t.tz + 1) * HEIGHT_TILE_POLES * HEIGHT_POLE);
    }
    return r;
  }
}

/** Whether two tiles' deltas are the same bits (null is a tile of noughts). */
export function sameTileDeltas(a: Float32Array | null, b: Float32Array | null): boolean {
  if (!a || !b) {
    const t = a ?? b;
    if (!t) return true;
    for (let i = 0; i < t.length; i++) if (t[i] !== 0) return false;
    return true;
  }
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/** A tile's raw heights at its 1,024 poles (for its `on` digest), from a raw reader. */
export function tileRaw(tx: number, tz: number, raw: RawAt): Float32Array {
  const out = new Float32Array(HEIGHT_TILE_POLES * HEIGHT_TILE_POLES);
  for (let j = 0; j < HEIGHT_TILE_POLES; j++) for (let i = 0; i < HEIGHT_TILE_POLES; i++) out[j * HEIGHT_TILE_POLES + i] = raw(tx * HEIGHT_TILE_POLES + i, tz * HEIGHT_TILE_POLES + j);
  return out;
}
