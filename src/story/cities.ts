// Which city the player has just walked into, for the name that fades in under the minimap.
//
// A city is a row of the world's own `pois.json` (`kind: 'city'`, a middle and a reach `r`, in the raw
// frame the snapshot and the client's own waypoints are in), and only one with a reach of at least
// `CITY_TUNE.minR`: a city row with no reach is a name on the map and not a place you can be inside.
// Measured over the converted packs that leaves every city there is (Corellia six, Naboo six, Tatooine
// seven and so on) and none at all on Kashyyyk, Mustafar or in the dungeons, whose packs carry places
// and no cities; those worlds simply never say a name.
//
// Three rules, every number of them ours:
//
//   - **In** is inside the reach; **out** is past the reach and a share more (`hysteresis`), so a
//     walk along a city's edge does not say its name at every step.
//   - Where two reaches overlap, the city whose middle is nearer is the one you are in. Walking from one
//     into the other hands over once the other's middle is nearer by that same share, so a walk along
//     the line where the two are equally near does not say both names at every step. (No two retail
//     cities overlap; this is for a pack that one day does, and for the test that walks it.)
//   - The same city walked into again within `repeatGap` seconds of last being in it says nothing:
//     out of the gate and back for something forgotten is not an arrival.
//
// Pure: no DOM and nothing imported. What it answers is a name to show, or null; showing it, fading it
// and how often the page is written are the minimap's business.

/** The city label's numbers. Every one is ours, and every one is live through `__debug.minimap({ city })`. */
export const CITY_TUNE = {
  /** How far past its reach, as a share of it, a city must be left before it counts as left. */
  hysteresis: 0.1,
  /** Seconds the name takes to come in, stays, and takes to go. */
  fadeIn: 0.4,
  hold: 3.0,
  fadeOut: 0.8,
  /** Seconds after last being in a city before walking into it again says its name again. */
  repeatGap: 60,
  /** The smallest reach, in metres, a row must have to be a city you can be inside. */
  minR: 50,
};

/** Move any of those, each held to something that makes sense; the answer is the table as it stands. */
export function tuneCities(o: Partial<typeof CITY_TUNE>): typeof CITY_TUNE {
  const t = CITY_TUNE as Record<string, number>;
  for (const k of Object.keys(CITY_TUNE) as (keyof typeof CITY_TUNE)[]) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    t[k] = k === 'hysteresis' ? Math.max(0, Math.min(2, v)) : Math.max(0, v);
  }
  return CITY_TUNE;
}

/** A place as `pois.json` writes it; only these fields are read. */
export interface CityRow {
  name: string;
  x: number;
  z: number;
  r: number;
  kind: string;
}

/** Whether a row is a city you can be inside. */
export function isCity(p: CityRow): boolean {
  return p.kind === 'city' && Number.isFinite(p.r) && p.r >= CITY_TUNE.minR && Number.isFinite(p.x) && Number.isFinite(p.z);
}

/**
 * The city a point is inside, by the rows' own reaches: of those whose reach holds it, the one whose
 * middle is nearest. Null when none does. Allocates nothing.
 */
export function cityAt(rows: readonly CityRow[], x: number, z: number): CityRow | null {
  let best: CityRow | null = null;
  let bestD = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    if (!isCity(p)) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > p.r || d >= bestD) continue;
    bestD = d;
    best = p;
  }
  return best;
}

/**
 * The walk in and out of cities, one step at a time. `step` is handed where the player stands in the
 * raw frame and the time in seconds, and answers the name to say, or null. Its memory is one city it is
 * in and, per name, when it was last in it; `reset` forgets both, for another world.
 */
export class CityWatch {
  /** The city the player is in now, by the hysteresis rule, or null. */
  private inside: CityRow | null = null;
  /** When the player was last in each city, in the seconds `step` is given. */
  private readonly lastIn = new Map<string, number>();
  /** What `report` reads. */
  said = 0;
  quiet = 0;
  last = '';

  /** The name of the city the player is in, or ''. */
  get here(): string {
    return this.inside?.name ?? '';
  }

  reset(): void {
    this.inside = null;
    this.lastIn.clear();
  }

  step(rows: readonly CityRow[], x: number, z: number, now: number): string | null {
    const was = this.inside;
    const margin = 1 + CITY_TUNE.hysteresis;
    if (was) {
      // Still in until past the reach and its margin; while in, the clock of its last visit runs on.
      const dWas = Math.hypot(was.x - x, was.z - z);
      if (dWas <= was.r * margin && rows.includes(was)) {
        this.lastIn.set(was.name, now);
        // Unless another city's own reach holds you and its middle is nearer by the margin: walked from
        // one city into the next across where the two overlap, which is an arrival in the next.
        const other = cityAt(rows, x, z);
        if (!other || other === was || Math.hypot(other.x - x, other.z - z) * margin >= dWas) return null;
        return this.arrive(other, now);
      }
      this.inside = null;
    }
    const city = cityAt(rows, x, z);
    if (!city) return null;
    return this.arrive(city, now);
  }

  /** In a city now: its name, unless you were last in it within the repeat gap. */
  private arrive(city: CityRow, now: number): string | null {
    this.inside = city;
    const before = this.lastIn.get(city.name);
    this.lastIn.set(city.name, now);
    if (before !== undefined && now - before < CITY_TUNE.repeatGap) {
      this.quiet++;
      return null;
    }
    this.said++;
    this.last = city.name;
    return city.name;
  }
}
