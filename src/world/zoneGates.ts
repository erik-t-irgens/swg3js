// Walking from one of a world's zones into another, at the gates the game stands between them.
//
// One world is seven terrains, each a pack of its own, and the way between them on foot is a gate.
// Which zone a gate opens on is not in the archives and is worked out at conversion time instead
// (`tools/swg/gates.mjs`), so all this file does is read the answer the pack carries, find the gate
// you are standing at, and decide whether pressing the key here should take you through it.
//
// Two rules of the deciding are ours and are the reason there is a module rather than a branch in
// the frame loop. The gate never takes the key from anything else that wants it -- a lift, an
// elevator, a way into a building, a vehicle within reach all win -- and it is not offered at all
// for a few seconds after a blow is struck or taken, which is what keeps a fight beside a gate from
// ending in another zone. Both are pure functions here and both are pinned by the node test.
//
// Where a gate leads is never worn by the action bar. The bar's labels are the frozen table in
// `promptRules.ts` and each one names the thing that happens rather than the thing you are looking
// at, so at a gate the cap says "through the gate" and the destination's own name is said once on
// the message line as you come to it, and again in full on the long prompt line.
//
// Which pack's gates these are is set by the world's own load (`App.arrive`), not by the prompt
// gather: a gate is a thing in a world and belongs to the world arriving, and pointed at from the
// gather it would be the last world's gates, in the last world's frame, for the first few frames
// after every arrival on foot.

import { PLANETS, type PlanetDef, type PlanetZone } from '../data/planets.ts';

/** A gate as a pack's gates.json carries it: the point in the snapshot's own frame, and the join. */
export interface GateRow {
  x: number;
  y: number;
  z: number;
  /** The pack the gate opens on, or null where the converter would not name one. */
  to: string | null;
  /** What to call that place, in the archives' own words where they have any. */
  label: string | null;
  /** The named place the join matched, how far off it was, and the instance the gate stands in. */
  place?: string | null;
  placeName?: string | null;
  d?: number | null;
  area?: string | null;
  by?: string | null;
  rests?: string;
}

/** A zone's gates.json. A pack converted before this has none, and a world with no file has no gates. */
export interface GatePack {
  planet: string;
  format?: number;
  center: { x: number; z: number };
  gates: GateRow[];
}

/** A gate where the game stands it, rather than where the snapshot does. */
export interface Gate {
  x: number;
  y: number;
  z: number;
  to: string | null;
  label: string | null;
}

/**
 * Ours, every one of them.
 *
 * `reach` is how close you must stand: the gateway is about 23 m across and 44 m tall and its point
 * is the middle of the arch, so twelve metres is standing in it or a step outside. `calm` is how
 * long after a blow -- struck or taken -- the gate stays out of the way, which is the whole of the
 * rule that a fight beside a gate cannot end in another zone by accident.
 */
export const GATE_TUNE = {
  reach: 12,
  calm: 4,
};

/** Set the live numbers at once (the console's one call), clamped to what makes sense. */
export function tuneGates(o: Partial<typeof GATE_TUNE>): typeof GATE_TUNE {
  if (typeof o.reach === 'number' && Number.isFinite(o.reach)) GATE_TUNE.reach = Math.max(1, Math.min(200, o.reach));
  if (typeof o.calm === 'number' && Number.isFinite(o.calm)) GATE_TUNE.calm = Math.max(0, Math.min(120, o.calm));
  return GATE_TUNE;
}

/** What `gatesInWorld` understands. A file from a later converter is read as far as this and said so. */
export const GATES_READ = 1;

/**
 * The pack's gates in the game's own frame. Snapshot space is mirrored in X and centred on the
 * layout centre, exactly as the placed objects and the map's own points are, and the centre travels
 * in the file so that a pack recentred later needs no rerun of anything but its own conversion.
 *
 * `say` is where the note about a file from a newer converter goes; it is a parameter so the node
 * test can read the note rather than the console.
 */
export function gatesInWorld(pack: GatePack | null | undefined, say: (note: string) => void = (n) => console.info(n)): Gate[] {
  if (!pack || !Array.isArray(pack.gates) || !pack.center) return [];
  // A version written into a file and never read buys nothing, so it is read: a pack from a later
  // converter is taken as far as this game understands it and the console is told which pack it was.
  if ((pack.format ?? 0) > GATES_READ) say(`zone gates: ${pack.planet ?? 'a pack'}'s gates are from a newer converter (format ${pack.format}); read as far as this game understands them`);
  const out: Gate[] = [];
  for (const g of pack.gates) {
    if (!Number.isFinite(g?.x) || !Number.isFinite(g?.z)) continue;
    out.push({ x: -(g.x - pack.center.x), y: g.y, z: g.z - pack.center.z, to: g.to ?? null, label: g.label ?? null });
  }
  return out;
}

/**
 * The gate within `reach` of a point, nearest first, measured in three dimensions.
 *
 * The third dimension is a choice and not a necessity: measured over the packs, no two gates are
 * stacked -- every one of the 37 stands at its own x and z, the six on the trail are all at one
 * height (171 m), and the closest pair in any zone is 492 m apart -- so taking y in changes no
 * pairing today. It is in because a walkway or a branch over a gate is not the gate, and a reach
 * that ignored height would offer it to someone standing well above one.
 */
export function nearestGate(gates: readonly Gate[], x: number, y: number, z: number, reach: number = GATE_TUNE.reach): { gate: Gate; d: number } | null {
  let best: { gate: Gate; d: number } | null = null;
  for (const g of gates) {
    const d = Math.hypot(g.x - x, g.y - y, g.z - z);
    if (d <= reach && (!best || d < best.d)) best = { gate: g, d };
  }
  return best;
}

/** Where the player is standing, as the gate's rule wants it: flat, so the test can state a case in one line. */
export interface GateWhere {
  /** The game is simulating, and not already on its way somewhere. */
  live: boolean;
  /** On foot in the world: not riding, not at a bridge's controls, not in a ship's rooms, not flying free. */
  onFoot: boolean;
  /** Nothing else within reach wants this key: a lift, an elevator, a way into a building, a vehicle, a hull to board. */
  free: boolean;
  /** Seconds since the last blow struck or taken, on the world's own clock. */
  since: number;
  /** How far the nearest gate is, or null for none within reach. */
  d: number | null;
  /** Whether that gate has a destination at all. */
  to: boolean;
}

/** What the key would do where the player is standing: go through, say the gate leads nowhere, or nothing at all. */
export function gateAction(w: GateWhere): 'travel' | 'nowhere' | 'none' {
  if (!w.live || !w.onFoot || !w.free) return 'none';
  if (w.d === null || !(w.d <= GATE_TUNE.reach)) return 'none';
  if (!(w.since >= GATE_TUNE.calm)) return 'none';
  return w.to ? 'travel' : 'nowhere';
}

/**
 * Where a gate leads, as the game says it in words. Never the action bar's: a bar label is one of
 * `PROMPT_WORDS` and names the thing that happens ("through the gate"), never the place you are
 * looking at, and a place name put on a cap would be a label built outside that table. This is for
 * the message line, which says a thing once, and for the long prompt line.
 */
export function gateSaid(gate: Gate | null | undefined): string {
  const s = (gate?.label ?? '').trim();
  return s || 'somewhere this pack does not name';
}

/** The world and zone a pack id belongs to, which is what travel is asked for. */
export function zoneOfPack(packId: string): { planet: PlanetDef; zone: PlanetZone } | null {
  for (const planet of PLANETS) {
    for (const zone of planet.zones ?? []) if (zone.pack === packId) return { planet, zone };
  }
  return null;
}

/**
 * The gates of the world being played, and the clock that keeps them out of a fight.
 *
 * The file is fetched once per pack and kept, so walking back and forth between two zones costs one
 * request each. A world with no gates costs one request that answers nothing, and everything below
 * then answers "no gate", which is what every pack converted before this does.
 */
export class ZoneGates {
  private readonly packs = new Map<string, Promise<GatePack | null>>();
  private here: Gate[] = [];
  private id = '';
  /** The gates already said out loud in this world, so a place is named once and not every eighth of a second. */
  private said = new Set<Gate>();
  /** The world's own clock at the last blow. Far in the past to start with, so a fresh world is calm. */
  private foughtAt = -1e9;

  /**
   * Point at the pack being played, from the world's own load and from nowhere else. The gates
   * appear when the file arrives; nothing waits on it, and until then there is no gate anywhere,
   * which is a world with none rather than the last world's in the last world's frame.
   *
   * What has been said out loud goes with the world too: the message line names a gate's
   * destination once as you come to it, and the same words in the next world are a different place.
   */
  use(baseUrl: string, packId: string): void {
    if (this.id === packId) return;
    this.id = packId;
    this.said.clear();
    this.here = [];
    // The world's clock starts again at nothing with the world, so a blow struck in the last one
    // would otherwise sit in this one's future and hold every gate shut for good.
    this.foughtAt = -1e9;
    let p = this.packs.get(packId);
    if (!p) {
      p = fetch(`${baseUrl}assets-private/${packId}/gates.json`)
        .then(async (res) => {
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
          return (await res.json()) as GatePack;
        })
        .catch(() => null);
      this.packs.set(packId, p);
    }
    void p.then((pack) => {
      if (this.id === packId) this.here = gatesInWorld(pack);
    });
  }

  /** The gates of the world being played, in its own frame. */
  get gates(): readonly Gate[] {
    return this.here;
  }

  /** A blow, struck or taken: the gates stand aside for `GATE_TUNE.calm` seconds. */
  fought(now: number): void {
    this.foughtAt = now;
  }

  /**
   * Seconds since the last blow either way. A clock that has gone backwards is a world that has
   * been left (the world's own clock starts again at nothing), and counts as calm rather than as a
   * blow struck some time in the future.
   */
  since(now: number): number {
    return now < this.foughtAt ? Number.POSITIVE_INFINITY : now - this.foughtAt;
  }

  /** The gate within reach of a point in the world, or null. */
  nearest(x: number, y: number, z: number): { gate: Gate; d: number } | null {
    return this.here.length ? nearestGate(this.here, x, y, z) : null;
  }

  /**
   * True the first time a gate is offered in this world, and false every time after: where a gate
   * leads is a thing the game says once, on the message line, and the bar cannot say it (its words
   * are the frozen table's). Standing at one says nothing more, and neither does walking away and
   * back; arriving in the world again says each of them again.
   */
  fresh(gate: Gate | null | undefined): boolean {
    if (!gate || this.said.has(gate)) return false;
    this.said.add(gate);
    return true;
  }

  /** The world is being left: the gates go with it, and so do the last blow and what was said. */
  clear(): void {
    this.id = '';
    this.here = [];
    this.said.clear();
    this.foughtAt = -1e9;
  }
}
