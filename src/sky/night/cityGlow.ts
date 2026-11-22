// The towns' glow in the night sky (the GPU port's pass 2, wave 3; the brief's default 2): each city of the world's own
// `pois.json` with a reach (`src/story/cities.ts`'s rule) lights the sky low over the horizon in its direction, brighter the
// bigger and nearer it is, and the sky behind a star then hides the faint ones there (`nightGpu.ts` reads the glow into the
// background of the eye's limit). Every number is ours (`nightTune.ts`'s `CITY_GLOW`), each with its reason.
//
// A frame hands in the camera's place and the nearest `CITY_MOST` towns' glows are written into a kept array the card reads
// (four numbers a town: its direction across the ground, unit; its light at the horizon, the scene's units; its half-width
// round the horizon, radians), the strongest first. Allocates nothing a frame.
//
// Pure: no three, no DOM; the node test imports it.
import { isCity, type CityRow } from '../../story/cities.ts';
import { rawToGameX, rawToGameZ } from '../../story/waypoints.ts';
import { CITY_GLOW, NIGHT_TUNE } from './nightTune.ts';

/** The most towns the card weighs at once. */
export const CITY_MOST = 8;

/** A town in the game's frame: its middle and its reach, metres. */
interface Town {
  x: number;
  z: number;
  r: number;
}

export class CityGlow {
  /** The world's towns in the game's frame, set at load (`setRows`). */
  private towns: Town[] = [];
  /** What the card reads: `CITY_MOST` towns of four numbers (direction x, z; light; half-width), the strongest first. */
  readonly out = new Float32Array(CITY_MOST * 4);
  /** How many of `out` hold a town this frame. */
  count = 0;
  /** Kept for the frame's choice: each town's light and half-width and its direction, and the order. */
  private light = new Float64Array(0);
  private width = new Float64Array(0);
  private dirX = new Float64Array(0);
  private dirZ = new Float64Array(0);
  private order = new Int32Array(0);

  /** The world's rows (`pois.json`'s `pois`, the raw frame) about its layout's centre: the cities with a reach, in the game's frame. */
  setRows(rows: readonly CityRow[] | null, centre: { x: number; z: number } | null): void {
    const c = centre ?? { x: 0, z: 0 };
    this.towns = (rows ?? []).filter((p) => isCity(p) && p.r > 0).map((p) => ({ x: rawToGameX(c.x, p.x), z: rawToGameZ(c.z, p.z), r: p.r }));
    const n = this.towns.length;
    this.light = new Float64Array(n);
    this.width = new Float64Array(n);
    this.dirX = new Float64Array(n);
    this.dirZ = new Float64Array(n);
    this.order = new Int32Array(n);
    this.count = 0;
    this.out.fill(0);
  }

  /** How many towns the world has. */
  get townCount(): number {
    return this.towns.length;
  }

  /**
   * The towns' glows from where the camera stands (`at`'s `camX`, `camZ`, the game's frame, read from the record's fields:
   * a number handed across a call is a number made), the strongest `CITY_MOST` written into `out`: a town's light at the
   * horizon `strength · (r / 300)² / (1 + (d / near)^falloff)` (Walker's law far off, levelling off near and inside the town),
   * its half-width its own angle plus `width` (inside a town the glow is all round). Allocates nothing.
   */
  frame(at: { readonly camX: number; readonly camZ: number }): void {
    const x = at.camX;
    const z = at.camZ;
    const n = this.towns.length;
    const g = CITY_GLOW;
    const k = g.strength * NIGHT_TUNE.cityGlow;
    for (let i = 0; i < n; i++) {
      const t = this.towns[i];
      const dx = t.x - x;
      const dz = t.z - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const rr = t.r / 300;
      this.light[i] = (k * rr * rr) / (1 + Math.pow(d / g.near, g.falloff));
      this.width[i] = Math.atan2(t.r, d) + g.width;
      if (d > 1e-3) {
        this.dirX[i] = dx / d;
        this.dirZ[i] = dz / d;
      } else {
        this.dirX[i] = 0;
        this.dirZ[i] = 1;
      }
      // Into the order by light, the strongest first (an insertion).
      let j = i - 1;
      while (j >= 0 && this.light[this.order[j]] < this.light[i]) {
        this.order[j + 1] = this.order[j];
        j--;
      }
      this.order[j + 1] = i;
    }
    const m = n < CITY_MOST ? n : CITY_MOST;
    for (let s = 0; s < CITY_MOST; s++) {
      const o = s * 4;
      if (s < m) {
        const i = this.order[s];
        this.out[o] = this.dirX[i];
        this.out[o + 1] = this.dirZ[i];
        this.out[o + 2] = this.light[i];
        this.out[o + 3] = this.width[i];
      } else {
        this.out[o] = 0;
        this.out[o + 1] = 1;
        this.out[o + 2] = 0;
        this.out[o + 3] = 1;
      }
    }
    this.count = m;
  }
}

/**
 * The glow toward a direction (unit, +Y up) from one town of `out` (`at` its first number), the sky's light in the scene's
 * units: its light at the horizon, a lobe round the horizon by the angle from its direction, falling with the height over the
 * horizon by `CITY_GLOW.height` (more for a wide, near town), nought under the horizon. The card's arithmetic, in numbers.
 */
export function glowToward(out: Float32Array, at: number, x: number, y: number, z: number): number {
  const light = out[at + 2];
  if (!(light > 0)) return 0;
  const h = Math.sqrt(x * x + z * z);
  const ca = h > 1e-6 ? (x * out[at] + z * out[at + 1]) / h : 1;
  const ang = Math.acos(ca > 1 ? 1 : ca < -1 ? -1 : ca);
  const w = out[at + 3];
  const lobe = Math.exp(-0.5 * (ang / w) * (ang / w));
  const e = Math.asin(y > 1 ? 1 : y < -1 ? -1 : y);
  const height = CITY_GLOW.height + 0.5 * (w - CITY_GLOW.width);
  const up = e > 0 ? Math.exp(-e / height) : 0;
  return light * lobe * up;
}
