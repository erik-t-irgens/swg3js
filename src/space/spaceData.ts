// A space zone's pack (space.json, version 3) as the converter writes it, the fetch that reads it, and
// the destinations a hyperspace jump can pick. Pure: no three, no DOM, no import.meta.env; the node
// tests import it. Every coordinate in a pack is in the client's frame (X not mirrored); `landmarksOf`
// and `arrivalAt` return the game's frame, (-X, Y, Z), as the streamer places the zone's objects.
//
// The exceptions, which are in the GAME's frame already and say so on their type, are what version 3
// added: the nebulae, the asteroid fields and the docking lanes. They are drawn rather than jumped to,
// so they are mirrored once by the converter instead of by every reader.
//
// A pack written before version 3 has no nebulae, fields, lanes, lightning or dock effects; `normalise`
// fills them in empty, so everything reads an older pack without asking what version it is.
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

/** A colour as the nebula table stores it: alpha, red, green, blue, each 0 to 1. */
export type NebulaColour = [number, number, number, number];

export interface NebulaLightningRow {
  /** The .ltn the row names; the pack converts one of them into `SpacePack.lightning`. */
  appearance: string;
  /** The table's `lightningFrequency`. Read as strikes a second, which is OUR reading. */
  every: number;
  maxSeconds: number;
  /** The table's damage band, [min, max]. What it does to a ship here is the game's decision, not the table's. */
  damage: [number, number];
  colour: NebulaColour;
  ramp: NebulaColour;
  sounds: { strike: string | null; loop: string | null };
  hit: { client: string | null; server: string | null };
}

export interface Nebula {
  name: string;
  /** GAME frame, mirrored by the converter. */
  at: Vec3;
  radius: number;
  density: number;
  /** The table's `facingPercent`, read as the share of sheets that turn to face the camera (ours). */
  facingShare: number;
  facing: { colour: NebulaColour; ramp: NebulaColour };
  oriented: { colour: NebulaColour; ramp: NebulaColour };
  /** The camera shake inside; non-zero in two zones only. */
  jitter: number;
  /** Which sheet look the row's `shaderIndex` picks. Inferred from the client's shader list, not read. */
  shader: 'glow' | 'mist';
  shaderIndex: number;
  sound: { ambient: string | null; volume: number };
  lightning: NebulaLightningRow | null;
  /** Columns that are 0 or empty on every retail row, kept so the pack says what the table held. */
  unused: Record<string, number | string | null>;
}

export interface NebulaSheetLook {
  shader: string;
  effect: string | null;
  blend: 'add' | 'alpha';
  /** The pack-relative image, or null when the converter could not write it. */
  texture: string | null;
  /** The near shell's look: a different effect over the same image. */
  shell: { shader: string; effect: string | null; texture: string | null };
}

export interface NebulaLightningLook {
  source: string;
  /** The flip-book the .ltn's particle texture describes. */
  flipbook: { shader: string; frames: number; frameStart: number; frameEnd: number; uvSize: number; perColumn: number; fps: number; visible: boolean } | null;
  /** The pack-relative image for the beam. */
  texture: string | null;
  /** The .ltn's two waveforms, in the particle reader's shape. Read as the beam's width and alpha, which is OUR reading. */
  waveforms: { interp: number; sample: number; min?: number; max?: number; points: number[][] }[];
  /** The float the data chunk opens with; its meaning is not known. */
  value: number;
  /** The effects played where a bolt starts and ends, as pack-relative particle files (null when they did not convert). */
  start: string | null;
  end: string | null;
  /** Bytes after the two effect names that the converter does not read. */
  trailingBytes: number;
}

export interface AsteroidFieldShape {
  /**
   * The table's own Name, filled on 70 of the 214 retail rows and null on the rest. It is a
   * designer's note as often as a label, so anything shown to a player should name the field itself
   * and treat this as a hint.
   */
  name: string | null;
  kind: 'sphere' | 'spline';
  /** GAME frame. */
  at: Vec3;
  radius: number;
  /** GAME frame; empty for a sphere field. */
  spline: Vec3[];
  count: number;
  sound: string | null;
  /** The table's two view distances, null where the column is absent (the made-up fields). Unread. */
  viewFrom: number | null;
  viewAll: number | null;
  flattenDepth: number;
  faceTowards: string | null;
  invented: boolean;
}

/** A point on a station's docking lane, in the MODEL's frame with X mirrored as the model's meshes are. */
export interface LanePoint {
  at: Vec3;
  /** Its turn as [w, x, y, z]. */
  q: [number, number, number, number];
  /** Its own forward (the hardpoint's Z axis). */
  forward: Vec3;
}

export interface DockLane {
  lane: string;
  dock: LanePoint | null;
  /** Metres from the dock to its `dockradius` point; null without one. */
  dockRadius: number | null;
  /**
   * The numbers the hardpoints carry are kept, gaps and all, and the number rises with `fromDock`
   * along one path. A lane may hold more than one path (one retail station's does), so grouping them
   * is the reader's job and `fromDock` (metres from this lane's dock, null without one) is what to
   * group and order by. Never assume the numbers run 1 upward from the dock.
   */
  approach: (LanePoint & { n: number; fromDock: number | null })[];
  exit: (LanePoint & { n: number; fromDock: number | null })[];
}

export interface ModelLanes {
  lanes: DockLane[];
  drydocks: (LanePoint & { name: string })[];
  /**
   * The model's hangar mouths, the only record in the client's files of where a hull opens: one on
   * the capital ship, seven and two on two of the stations, none on the rest. Empty on a pack
   * converted before they were carried.
   */
  bays: (LanePoint & { name: string })[];
}

export interface DockEffect {
  source: string;
  particle: string | null;
  /** Every dock effect in the retail archives names a sound and no particle. */
  sound: string | null;
}

/**
 * A planet or moon in a zone's sky. A retail zone's bodies are pictures with no true distance: they
 * hang along `direction` (CLIENT frame) at the sky's own reach and cover `size` of it.
 *
 * A made-up system's bodies stand somewhere instead: `place: 'world'` carries `at`, the body's true
 * middle in the GAME frame (mirrored by the converter, as the nebulae and the fields are), and
 * `radius`, its true radius in metres, so the game can grow it as a ship closes on it. `direction`
 * and `size` still point and size it the same way, so anything that does not know `place` draws it
 * as a picture on the sky exactly as before.
 */
export interface SpaceBody {
  appearance: string;
  direction: number[];
  size: number;
  texture: string | null;
  /** 'world' for a body that stands somewhere; absent or 'sky' for a picture hung on the sky. */
  place?: 'sky' | 'world';
  /** GAME frame; only with `place: 'world'`. */
  at?: Vec3;
  /** Metres; the appearance's own radius, or null on a body whose appearance names none. */
  radius?: number | null;
  /** 'invented' on a made-up system's body: nothing about it came from the client's files. */
  source?: string;
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
  planets: SpaceBody[];
  /** Null on an older pack. */
  arrival: SpaceArrival | null;
  /** Null on an older pack: nothing to jump to. */
  hyperspace: SpaceHyperspace | null;
  // The six below are version 3. They are optional so that a `SpacePack` written out by hand
  // anywhere else (a test's fixture) does not have to carry them, but `normalise` always fills them,
  // so a pack that came through `loadSpacePack` has every one.
  /** Version 3. Empty on an older pack. */
  nebulae?: Nebula[];
  /** Version 3: the two sheet looks and their near shells. Null on an older pack. */
  nebulaLook?: { glow: NebulaSheetLook; mist: NebulaSheetLook } | null;
  /** Version 3: the one lightning appearance the zone's rows name. Null on an older pack, or where nothing strikes. */
  lightning?: NebulaLightningLook | null;
  /** Version 3: the asteroid fields' shapes, for the map. Empty on an older pack. */
  fields?: AsteroidFieldShape[];
  /** Version 3: docking lanes by model id, so a station or scenery entry finds its own through `model`. Empty on an older pack. */
  lanes?: Record<string, ModelLanes>;
  /** Version 3: what a dock plays, by the part it plays. Empty on an older pack. */
  dockEffects?: Record<string, DockEffect>;
  /**
   * Only on a made-up system: the seed it was drawn from, how far it reaches from its middle in
   * metres, and which converted zone's sky it borrows. Its presence is what says "nothing in this
   * zone is the client's", and it is what an ultra-fast cruise asks for before it will run.
   */
  sandbox?: { source: 'invented'; seed: number; edge: number; skyFrom: string | null } | null;
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
    nebulae: Array.isArray(raw.nebulae) ? raw.nebulae : [],
    nebulaLook: raw.nebulaLook ?? null,
    lightning: raw.lightning ?? null,
    fields: Array.isArray(raw.fields) ? raw.fields : [],
    lanes: raw.lanes && typeof raw.lanes === 'object' ? raw.lanes : {},
    dockEffects: raw.dockEffects && typeof raw.dockEffects === 'object' ? raw.dockEffects : {},
    sandbox: raw.sandbox && typeof raw.sandbox === 'object' ? raw.sandbox : null,
  };
}

/** The empty answer, shared: the map asks per station per frame and nothing may allocate there. */
const NO_LANES: ModelLanes = Object.freeze({ lanes: Object.freeze([]), drydocks: Object.freeze([]), bays: Object.freeze([]) }) as unknown as ModelLanes;

/** The docking lanes of a station or piece of scenery, through the model it is drawn with; empty without any. */
export function lanesOfPlaced(pack: SpacePack | null, model: string): ModelLanes {
  return pack?.lanes?.[model] ?? NO_LANES;
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
