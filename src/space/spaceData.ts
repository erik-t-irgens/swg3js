// A space zone's pack (space.json, version 2) as the converter writes it, the fetch that reads it, and
// the destinations a hyperspace jump can pick. Pure: no three, no DOM, no import.meta.env; the node
// tests import it. Every coordinate in a pack is in the client's frame (X not mirrored); `landmarksOf`
// and `arrivalAt` return the game's frame, (-X, Y, Z), as the streamer places the zone's objects.
//
// Some of what a pack holds is made up rather than read from the client's files (Kessel's and Deep
// Space's point positions, Deep Space's fields and its Star Destroyer): such points carry
// `source: 'invented'`, such scenery `invented: true` (the converter's INVENTED_* tables in space.mjs).

export type Vec3 = [number, number, number];

export interface SpaceStation {
  /** The server's name from the station table (station_tatooine). */
  name: string;
  /** Its name in the client's strings ("Tatooine Space Station"); the name on an older pack. */
  title: string;
  description: string;
  model: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** How far the end of a jump to this station from the zone's arrival is from anything else placed; null when nothing is. */
  approachClearance: number | null;
}

export interface SpaceScenery {
  name: string;
  template: string;
  model: string;
  x: number;
  y: number;
  z: number;
  /** Its turn as [w, x, y, z], client frame. */
  q: [number, number, number, number];
  radius: number;
  /** The hyperspace point it hangs near. */
  near: string;
  invented: true;
}

export interface HyperspacePoint {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
  z: number;
  /** 'table': the client's hyperspace table; 'borrowed': another scene's row (`from`); 'invented': made up. */
  source: 'table' | 'borrowed' | 'invented';
  from?: string;
  /** Metres from the nearest placed object's surface; null when nothing is placed. */
  clearance: number | null;
}

export interface HyperspaceStage {
  seconds: number;
  particle: string;
  clientEffect: string;
  /** A float the scene carries whose meaning is not known. */
  value: number;
  sound: string;
}

export interface HyperspaceSceneData {
  source: 'scene/hyperspace.iff';
  /** The scene's DATA float, unresolved. */
  scale: number;
  enter: HyperspaceStage;
  /** STG2's three floats as they are read (the longest wait, the leaving speed, the hand-over fade): a reading, not confirmed. */
  transit: { limit: number; speed: number; fade: number; sound: string };
  exit: HyperspaceStage;
}

export interface WarpTiming {
  enterPeak: number | null;
  tunnelAt: number | null;
  exitBurstAt: number | null;
  exitClearAt: number | null;
}

export interface SpaceArrival {
  x: number;
  y: number;
  z: number;
  kind: 'launch' | 'point';
  planet?: string;
  point?: string;
}

export interface SpaceHyperspace {
  points: HyperspacePoint[];
  scene: HyperspaceSceneData | null;
  /** The warp effects' pack-relative particle files, and the timings the converter read from them. */
  effects: { enter: string | null; exit: string | null; timing: WarpTiming | null };
  messages: { alreadyAtPoint: string | null };
  frameCheck: { checked: number; sameCloser: number; mirroredCloser: number; meanErrorSame: number; meanErrorMirrored: number };
}

export interface SpacePack {
  /** 1 for a pack converted before hyperspace (no title, arrival, scenery or hyperspace in the file). */
  version: number;
  zone: string;
  /** The planet the zone is the orbit of; null for Kessel, Deep Space and Ord Mantell. */
  planet: string | null;
  /** The system's name ("Tatoo System", "Deep Space"); the zone's id on an older pack. */
  title: string;
  stations: SpaceStation[];
  scenery: SpaceScenery[];
  planets: { appearance: string; direction: number[]; size: number; texture: string | null }[];
  /** Null on an older pack. */
  arrival: SpaceArrival | null;
  /** Null on an older pack: nothing to jump to. */
  hyperspace: SpaceHyperspace | null;
}

/** A pack as the file has it, filled out so every field of `SpacePack` is there (an older pack has fewer). */
function normalise(zone: string, raw: Partial<SpacePack> & { stations?: Partial<SpaceStation>[] }): SpacePack {
  const stations = (raw.stations ?? []).map((s) => ({
    name: String(s.name ?? ''),
    title: s.title || String(s.name ?? ''),
    description: s.description ?? '',
    model: String(s.model ?? ''),
    x: Number(s.x) || 0,
    y: Number(s.y) || 0,
    z: Number(s.z) || 0,
    radius: Number(s.radius) || 0,
    approachClearance: typeof s.approachClearance === 'number' ? s.approachClearance : null,
  }));
  return {
    version: Number(raw.version) || 1,
    zone: raw.zone || zone,
    planet: raw.planet ?? null,
    title: raw.title || zone,
    stations,
    scenery: raw.scenery ?? [],
    planets: raw.planets ?? [],
    arrival: raw.arrival ?? null,
    hyperspace: raw.hyperspace?.points ? raw.hyperspace : null,
  };
}

const packs = new Map<string, Promise<SpacePack | null>>();

/**
 * The pack's space.json (`${baseUrl}assets-private/<zone>/space.json`), fetched once per zone and shared
 * (the world and the catalogue use the same promise). A response that is not JSON (Vite answers a
 * missing file with index.html and a 200) is null, as `AssetPack` treats it. Only a converted pack (one
 * with `hyperspace`) is remembered: a missing or older one is fetched again next time, so a reconversion
 * mid-session needs no reload. Callers that ask at the same moment still share the one fetch in flight.
 */
export function loadSpacePack(baseUrl: string, zone: string): Promise<SpacePack | null> {
  const key = `${baseUrl}|${zone}`;
  const had = packs.get(key);
  if (had) return had;
  const p = (async (): Promise<SpacePack | null> => {
    try {
      const res = await fetch(`${baseUrl}assets-private/${zone}/space.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const raw = (await res.json()) as Partial<SpacePack>;
      return raw && typeof raw === 'object' ? normalise(zone, raw) : null;
    } catch {
      return null;
    }
  })();
  packs.set(key, p);
  void p.then((pack) => {
    if ((!pack || !pack.hyperspace) && packs.get(key) === p) packs.delete(key);
  });
  return p;
}

export interface Destination {
  /** `${zone}:${id}`: a point's id is its table name, a station's its server name, a launch point's 'launch'. */
  key: string;
  zone: string;
  id: string;
  kind: 'point' | 'station' | 'launch';
  name: string;
  description: string;
  /** CLIENT frame, as the pack has it: `toGame` before any maths. */
  at: Vec3;
  /** A station's radius, else 0. */
  radius: number;
  /** Made up here, not in the client's files. */
  invented: boolean;
}

/**
 * A zone's destinations in the menu's order: its hyperspace points, then its stations, then its launch
 * point (only for a planet's orbit: where a ship climbing out of that planet's sky comes out).
 * `planetName` names the launch point ("Tatooine: launch point"); the pack's title stands in without it.
 */
export function destinationsOf(pack: SpacePack, planetName: string | null): Destination[] {
  const zone = pack.zone;
  const out: Destination[] = [];
  for (const p of pack.hyperspace?.points ?? []) {
    out.push({ key: `${zone}:${p.id}`, zone, id: p.id, kind: 'point', name: p.name || p.id, description: p.description || p.name || p.id, at: [p.x, p.y, p.z], radius: 0, invented: p.source === 'invented' });
  }
  for (const s of pack.stations) {
    out.push({ key: `${zone}:${s.name}`, zone, id: s.name, kind: 'station', name: s.title || s.name, description: s.description || s.title || s.name, at: [s.x, s.y, s.z], radius: s.radius, invented: false });
  }
  const a = pack.arrival;
  if (a && a.kind === 'launch') {
    const below = planetName ?? pack.title;
    out.push({
      key: `${zone}:launch`,
      zone,
      id: 'launch',
      kind: 'launch',
      name: `${below}: launch point`,
      description: `Where a ship climbing out of ${planetName ? `${planetName}'s` : 'the planet\'s'} sky comes out.`,
      at: [a.x, a.y, a.z],
      radius: 0,
      invented: false,
    });
  }
  return out;
}

/** A client-frame position in the game's frame: X mirrored (never a negative zero). */
const game = (x: number, y: number, z: number): Vec3 => [x === 0 ? 0 : -x, y, z];

/** The places an arriving ship faces toward: the zone's stations and scenery, GAME frame. */
export function landmarksOf(pack: SpacePack): { at: Vec3; radius: number }[] {
  const out: { at: Vec3; radius: number }[] = [];
  for (const s of pack.stations) out.push({ at: game(s.x, s.y, s.z), radius: s.radius });
  for (const s of pack.scenery) out.push({ at: game(s.x, s.y, s.z), radius: s.radius });
  return out;
}

/** The zone's arrival in the GAME frame, or null (no pack, or a pack converted before arrivals). */
export function arrivalAt(pack: SpacePack | null): Vec3 | null {
  const a = pack?.arrival;
  return a ? game(a.x, a.y, a.z) : null;
}

export interface HyperspaceSystem {
  /** The zone's id (space_tatooine). */
  id: string;
  /** The game's name for the zone (PLANETS' name). */
  name: string;
  /** The pack's title ("Tatoo System"), else `name`. */
  title: string;
  /** Null when the zone has no pack. */
  pack: SpacePack | null;
  destinations: Destination[];
}

/** Every space zone's pack and destinations, read once for the System Map. */
export class HyperspaceCatalogue {
  readonly systems: HyperspaceSystem[];
  private readonly byKey: Map<string, Destination>;

  constructor(systems: HyperspaceSystem[]) {
    this.systems = systems;
    this.byKey = new Map();
    for (const s of systems) for (const d of s.destinations) this.byKey.set(d.key, d);
  }

  /** Fetch every zone's pack (shared with the world's through loadSpacePack); `below` names the planet a zone is the orbit of. */
  static async load(baseUrl: string, systems: { id: string; name: string; below: string | null }[]): Promise<HyperspaceCatalogue> {
    const packs = await Promise.all(systems.map((s) => loadSpacePack(baseUrl, s.id)));
    return new HyperspaceCatalogue(
      systems.map((s, i) => {
        const pack = packs[i];
        return { id: s.id, name: s.name, title: pack?.title && pack.title !== s.id ? pack.title : s.name, pack, destinations: pack ? destinationsOf(pack, s.below) : [] };
      }),
    );
  }

  find(key: string): Destination | null {
    return this.byKey.get(key) ?? null;
  }

  pack(zone: string): SpacePack | null {
    return this.systems.find((s) => s.id === zone)?.pack ?? null;
  }
}
