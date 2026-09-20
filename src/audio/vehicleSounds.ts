/**
 * What the machines sound like: a speeder's engine, a ship's, the wings, the blows a hull takes, the
 * lock tone, a jump's three stages, a ship blowing up, and the lift.
 *
 * All of it is the game's own data, joined up from four files the packs already carry:
 *  - the client data of every hull, engine part and vehicle (`sounds/events.json`), which is where
 *    the idle, speed-up, slow-down and run loops live (`VTHR > VSND`), a ship engine part's run loop
 *    and its three damage loops (`ENGS > INTS`), a hull's own loop (`ASND`), the sound over water
 *    (`VGEF`) and the effect a hull is destroyed by (`DSTR`);
 *  - the ship tables (`sounds/sources.json`): each chassis's flyby sound and hit-sound group, the hit
 *    sounds per layer, the power-up and power-down sounds per system, and the interior table's rooms,
 *    which is where the hum inside a hull and the floor its deck is made of come from;
 *  - the ships pack's own manifest, which carries each wing's opening sound;
 *  - the space pack, which carries the jump's three stage sounds.
 *
 * Nothing in the world has to know that sound exists: this reads the vehicles the game already keeps
 * and works out what changed, the way the feet do. The three places that cannot be read -- a blow
 * landing, a hull going up, a stop picked in a lift -- call in.
 *
 * The rules of the house this keeps:
 *  - **Nothing is allocated per frame.** A vehicle's record is made once and kept against the vehicle
 *    itself; the frame walks an array by index and writes numbers.
 *  - **One voice each for the ships you are not flying.** The ship flown (or ridden, or stood inside)
 *    holds an idle and a run loop crossfaded by speed; every other holds one, swapped with a fade when
 *    its speed crosses the band. A fight with a dozen fighters is therefore a dozen voices, not
 *    twenty-five, and the budget has room for the guns.
 *  - **Nothing can be heard from a driven tab**, so every choice is reported with what decided it
 *    (`__debug.vehicleSounds()`).
 */
import { OUTSIDE, type SoundSpace } from './distance.ts';
import type { LoopHost } from './emitters.ts';

/** One `VTHR > VSND` set of a client data file: a damage level and its four loops. */
export interface ThrusterSet {
  level?: number;
  name?: string;
  idle?: string | null;
  accel?: string | null;
  decel?: string | null;
  run?: string | null;
  damaged?: (string | null)[];
}

/**
 * One `ENGS > INTS` or `INTS` row: the hardpoint or slot it sits at, and its sound. A hull's own
 * `INTS` rows are the booster's rocket loop, not a room bed: every one in the archives names the
 * same sound, on the eight hulls that have them and on the forty-five booster components.
 */
export interface EngineRow {
  slot?: string;
  sound?: string | null;
  params?: number[];
}

/** One client data file as the converter writes it into `sounds/events.json`. */
export interface ClientDataSounds {
  ambient?: string | null;
  destroyed?: string | null;
  thrusters?: ThrusterSet[];
  ground?: { water?: boolean; sound?: string | null }[];
  engines?: EngineRow[];
  interior?: EngineRow[];
  [key: string]: unknown;
}

/**
 * The joins the converter's ship half writes, if the pack has been made since. Each maps something
 * the game knows by name -- an engine part's template, a hull, a vehicle -- to the client data file
 * that speaks for it, which only the template chain can say. Every one is optional: without them the
 * names below are matched instead, which finds most of them and says which it could not.
 */
export interface ShipSoundJoins {
  /** Engine part template (or its file name) to its client data file. */
  engines?: Record<string, string>;
  /** Ship id or hull template to its client data file. */
  hulls?: Record<string, string>;
  /**
   * Ship id or hull template to the client data of the engine part its chassis fits it with, for the
   * hulls that wear no engine part of their own (the TIEs, the gunboats, the corvette): the one
   * thing that cannot be worked out from a fit, since there is nothing in the fit to work it out of.
   */
  shipEngines?: Record<string, string>;
  /** Garage id or vehicle template to its client data file. */
  vehicles?: Record<string, string>;
  /** Ship id or hull template to the power set its chassis row's hit-sound group names. */
  power?: Record<string, string>;
  /** A run loop to the idle, speed-up and slow-down loops some client data file names beside it. */
  kin?: Record<string, { idle?: string; accel?: string; decel?: string }>;
  /** The lift's own sounds, so the choice of them lives in one place rather than two. */
  lifts?: { rise?: string; descend?: string; riseLoop?: string; descendLoop?: string };
  /** The ship hit effects' and each hull's destruction effect's own sounds, keyed as `combat.json` keys them. */
  combat?: { hitEffects?: Record<string, string[]>; hulls?: Record<string, string[]> };
}

/** The parts of `sounds/events.json` this reads; the rest of that file is other people's. */
export interface VehicleEventsPack {
  clientData?: Record<string, ClientDataSounds>;
  clientEffects?: Record<string, { sounds?: string[]; particle?: string }>;
  ships?: ShipSoundJoins;
  [key: string]: unknown;
}

/** One row of the game's interior table, as far as a ship's rooms need it. */
export interface ShipRoomRow {
  pob: string;
  cell: string;
  day?: string | null;
  night?: string | null;
  surface?: string;
}

/** The tables this reads out of `sounds/sources.json`. */
export interface VehicleTables {
  /** Chassis row to its flyby sound. */
  flyby?: Record<string, string>;
  /** Chassis row to the group its hit sounds come from. */
  hitGroups?: Record<string, string>;
  /** Hit-sound group to its four layers. */
  shipHits?: Record<string, Record<string, string | null>>;
  /** Power set (`default`, `xwing`, `tie`) to `<system>_enabled` and `<system>_disabled`. */
  shipPower?: Record<string, Record<string, string | null>>;
  rooms?: ShipRoomRow[];
  [table: string]: unknown;
}

/** The layers a blow can land on, as the ships' own combat data names them. */
export type HullLayer = 'shield' | 'armor' | 'component' | 'chassis';

/** The stages of a jump, as the game's own scene names them. */
export type JumpStage = 'enter' | 'transit' | 'exit';

/** What this needs to see of a vehicle; `Vehicle` satisfies it, and the node test's stub does too. */
export interface SoundVehicle {
  readonly pos: { x: number; y: number; z: number };
  readonly speed: number;
  readonly destroyed: boolean;
  readonly disposed: boolean;
  readonly onWater: boolean;
  readonly spec: { id: string; label: string; maxSpeed: number; animal: boolean; ship?: boolean };
  readonly def: {
    id: string;
    template?: string;
    chassis?: string | null;
    attachments?: readonly { kind: string; slot?: string; template?: string; sound?: string | null }[];
    fit?: { slots: readonly { slot: string; looks: readonly { parts: readonly { template: string }[] }[] }[] } | null;
  } | null;
  readonly fit: { looks: Record<string, number> } | null;
  readonly wings: { readonly length: number; readonly target: boolean };
}

export interface VehicleTune {
  /** INVENTED: the share of top speed by which the run loop is at full and the idle is gone. */
  crossAt: number;
  /** INVENTED: the share of top speed the throttle counts as open at, and the share it counts as shut under. */
  open: number;
  close: number;
  /** INVENTED: semitones the engine rises by between a standstill and its top speed. */
  pitchSpan: number;
  /** INVENTED: the most a Doppler shift moves an engine, in semitones either way. */
  doppler: number;
  /** INVENTED: metres a second sound travels at, for that shift. The client's figure is not in the archives. */
  soundSpeed: number;
  /** INVENTED: metres within which another ship passing makes its flyby sound. */
  flyby: number;
  /** INVENTED: metres a second it must be closing or opening at for that to count as passing. */
  flybySpeed: number;
  /** INVENTED: seconds between two flybys, so a wing of four is not four whooshes at once. */
  flybyGap: number;
  /** INVENTED: the share of top speed an unflown ship swaps its one loop at (a band, so it does not flutter). */
  swapUp: number;
  swapDown: number;
  /** INVENTED: seconds a swapped loop fades over. */
  swapFade: number;
  /** INVENTED: seconds a voice the mixer had none free for waits before it asks again. */
  retry: number;
  /** INVENTED: metres a vehicle moves before its voice's place is written again. */
  moveStep: number;
  /** INVENTED: the gain an unflown vehicle's engine keeps at a standstill, so a parked ship still hums. */
  parkedGain: number;
  /** INVENTED: the gain the water under a speeder plays at. */
  water: number;
  /** INVENTED: seconds the lock tone will not sound again in, so a solution flickering at the edge of range is one tone. */
  lockGap: number;
  /** INVENTED: metres between two lift stops' doorways under which the pick is a step out rather than a ride. */
  liftLevel: number;
}

/**
 * Ours, every one: the game's files say which sound a machine makes and never how loud it is at
 * speed, how far a flyby carries or what a pitch does. `__debug.vehicleSounds({ ... })` moves them
 * live, and the ones that change a voice already playing take effect on its next loop.
 */
export const VEHICLE_TUNE: VehicleTune = {
  crossAt: 0.35,
  open: 0.22,
  close: 0.12,
  pitchSpan: 3,
  doppler: 4,
  soundSpeed: 340,
  flyby: 60,
  flybySpeed: 50,
  flybyGap: 2,
  swapUp: 0.2,
  swapDown: 0.1,
  swapFade: 0.25,
  retry: 0.5,
  moveStep: 0.5,
  parkedGain: 0.35,
  water: 1,
  lockGap: 1.5,
  liftLevel: 0.5,
};

/**
 * The mixer, as this needs it. It is the world's own looping host with one thing more: the pitch of
 * a voice already playing. The mixer applies a pitch when a sound starts, so an engine's follows its
 * speed in loop-length steps rather than continuously; the call is optional so a host without it (a
 * node test's stub) simply keeps the pitch a voice started at.
 */
export interface VehicleHost extends LoopHost {
  setPitch?(key: number, semitones: number): void;
}

/** What a machine's engine sounds like, and where the answer came from. */
export interface EngineSounds {
  idle: string | null;
  accel: string | null;
  decel: string | null;
  run: string | null;
  /** For the report: `part`, `hull ASND`, `hull VSND`, `vehicle VSND`, `flyby family` or `none`. */
  source: string;
}

const EMPTY_ENGINE: EngineSounds = { idle: null, accel: null, decel: null, run: null, source: 'none' };

/** A name with everything but its letters and digits taken out, for matching one spelling against another. */
export function flatName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A file path's own name, without its folder, its `shared_` and its extension. */
export function baseName(path: string): string {
  const file = path.replace(/\\/g, '/').split('/').pop() ?? '';
  return file.replace(/^shared_/i, '').replace(/\.[a-z0-9]+$/i, '');
}

/**
 * The nearest of a set of names to the one wanted: the same spelling first, then the longest whose
 * letters end the other's (`speederbike` and `speeder_bike`), then the longest either contains.
 * INVENTED, and used only when the converter has not written the join the template chain gives.
 */
export function bestName(want: string, index: readonly { key: string; flat: string }[]): string | null {
  const n = flatName(want);
  if (!n) return null;
  let best: { key: string; flat: string } | null = null;
  for (const c of index) if (c.flat === n) return c.key;
  for (const c of index) if ((n.endsWith(c.flat) || c.flat.endsWith(n)) && (!best || c.flat.length > best.flat.length)) best = c;
  if (best) return best.key;
  for (const c of index) if ((n.includes(c.flat) || c.flat.includes(n)) && (!best || c.flat.length > best.flat.length)) best = c;
  return best?.key ?? null;
}

/**
 * The idle, speed-up and slow-down loops that go with a run loop, by the game's own naming:
 * `eng_run_xwing` beside `eng_idle_xwing`, `veh_speederbike_run_lp` beside `veh_speederbike_idle_lp`.
 * INVENTED as a link (the archives name these three nowhere for a fighter; only the run loop is in
 * any client data), and `playable` drops the ones the pack has no template for, so a family with no
 * idle simply has none.
 */
export function siblingLoops(run: string | null | undefined, playable?: (id: string) => boolean): { idle: string | null; accel: string | null; decel: string | null } {
  const out = { idle: null as string | null, accel: null as string | null, decel: null as string | null };
  if (!run) return out;
  for (const word of ['idle', 'accel', 'decel'] as const) {
    // The last `run` written as a word of its own: `eng_run_tie_defender_lp` keeps its tail.
    const id: string = run.replace(/(^|[_/])run($|[_.])/, (_m: string, a: string, b: string) => `${a}${word}${b}`);
    if (id !== run && (!playable || playable(id))) out[word] = id;
  }
  return out;
}

/** The undamaged thruster set of a client data file: the one whose damage level is 0 (or the first there is). */
export function undamagedThruster(entry: ClientDataSounds | null | undefined): ThrusterSet | null {
  const list = entry?.thrusters ?? [];
  for (const t of list) if (!t.level) return t;
  return list[0] ?? null;
}

/**
 * The engine sounds one client data file gives, in the order the client's own data puts them:
 *  1. a ship engine part's run loop (`ENGS`), whose first row is the undamaged one;
 *  2. the hull's own loop (`ASND`);
 *  3. the undamaged thruster set (`VTHR > VSND`), which is where a freighter, a gunboat and every
 *     ground vehicle keep all four loops.
 * The three loops a set does not name are looked for beside its run loop by name.
 */
export function engineFromClientData(
  entry: ClientDataSounds | null | undefined,
  playable?: (id: string) => boolean,
  family?: (run: string) => { idle?: string; accel?: string; decel?: string } | null | undefined,
): EngineSounds | null {
  if (!entry) return null;
  const thruster = undamagedThruster(entry);
  const part = entry.engines?.[0]?.sound ?? null;
  const run = part ?? entry.ambient ?? thruster?.run ?? null;
  if (!run && !thruster) return null;
  const source = part ? 'part' : entry.ambient ? 'hull ASND' : 'VSND';
  // The set's own three first (they are in the same file as its run loop), then the three the
  // converter found in whatever client data file names that run loop, and only then the ones found
  // beside it by name, which is the guess.
  const named = (run && family?.(run)) || null;
  const kin = siblingLoops(run, playable);
  return {
    idle: thruster?.idle ?? named?.idle ?? kin.idle,
    accel: thruster?.accel ?? named?.accel ?? kin.accel,
    decel: thruster?.decel ?? named?.decel ?? kin.decel,
    run: run ?? thruster?.run ?? null,
    source,
  };
}

/**
 * A chassis's run loop from its flyby sound: `eng_flyby_awing` and `eng_run_awing` are one family,
 * and the chassis table names the flyby for 450 of its rows. INVENTED as a link, and the only thing
 * that speaks for the 39 hulls whose engine part the pack cannot name; `playable` decides whether
 * the pack holds it, and the `_lp` spelling is tried as well.
 */
export function runFromFlyby(flyby: string | null | undefined, playable?: (id: string) => boolean): string | null {
  if (!flyby || !/flyby/.test(flyby)) return null;
  const plain = flyby.replace('flyby', 'run');
  if (!playable || playable(plain)) return plain;
  const looped = plain.replace(/\.snd$/i, '_lp.snd');
  return playable(looped) ? looped : null;
}

/**
 * The pitch a Doppler shift makes, in semitones: the ordinary rate against the speed the source is
 * closing at, capped. `closing` is metres a second the gap is shrinking by (negative: opening).
 * INVENTED throughout -- Web Audio's panner no longer does this, and the client's own figures are not
 * in the archives -- but the arithmetic is the plain one.
 */
export function dopplerSemitones(closing: number, tune: VehicleTune = VEHICLE_TUNE): number {
  const c = Math.max(1, tune.soundSpeed);
  const v = Math.max(-c * 0.9, Math.min(c * 0.9, closing));
  const st = 12 * Math.log2(c / (c - v));
  return st < -tune.doppler ? -tune.doppler : st > tune.doppler ? tune.doppler : st;
}

/** The share of its top speed a machine is doing, 0 to 1. */
export function speedShare(speed: number, top: number): number {
  const s = Math.abs(speed) / Math.max(1, top);
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

/** The idle and run gains at a share of top speed: the run comes in over `crossAt` and the idle goes out with it. */
export function engineMix(share: number, tune: VehicleTune = VEHICLE_TUNE): { idle: number; run: number } {
  const t = Math.max(0.01, tune.crossAt);
  const up = share >= t ? 1 : share / t;
  return { idle: 1 - up, run: up };
}

/** One line of the report: what happened and what decided it. */
export interface VehicleLogRow {
  at: number;
  what: string;
  who: string;
  sound: string | null;
  key: number;
}

/**
 * One looping voice a vehicle holds, with the sound it is playing and the space it was started in.
 * Both are kept beside the key because the mixer cannot be asked either: a voice that is still
 * running is not necessarily running the sound wanted now (a refit puts a different engine in the
 * slot, climbing aboard turns one loop into two), and a hull that began humming out in the open
 * while you stood beside it must stop being muffled by its own walls once you are in it.
 */
interface Voice {
  key: number;
  id: string | null;
  space: SoundSpace;
}

/** A vehicle's own voices and the choices behind them; made once, kept against the vehicle itself. */
interface Rec {
  v: SoundVehicle;
  seen: number;
  /** The engine's own sounds, worked out once (and again after a refit changes the engine slot). */
  set: EngineSounds;
  water: string | null;
  wing: string | null;
  flyby: string | null;
  chassis: string;
  hitGroup: string;
  power: string;
  /** The look the engine slot wore when the set was worked out, so a refit is noticed. */
  lookKey: string;
  readonly idleVoice: Voice;
  readonly runVoice: Voice;
  readonly waterVoice: Voice;
  /** Which of the two an unflown vehicle plays now. */
  usingRun: boolean;
  own: boolean;
  wingTarget: boolean;
  throttleOpen: boolean;
  lastFlyby: number;
  retryAt: number;
  /** Its distance to the ear last frame, for the Doppler shift and the flyby. */
  lastDistance: number;
  hasDistance: boolean;
  x: number;
  y: number;
  z: number;
}

/**
 * Every machine's sound. One of these lives as long as the game does; the game hands it each frame's
 * vehicles and calls in when a hull is struck, blows up, jumps or rides a lift.
 *
 * It is a module-level object (`vehicleSounds` below) rather than something passed down, because the
 * places that know a hull has been hit are three files deep in the space code and threading a mixer
 * through all of them would put sound in the signature of everything that flies.
 */
export class VehicleSounds {
  /** The invented numbers themselves, so `__debug.vehicleSounds({ flyby: 120 })` moves them live. */
  readonly tune: VehicleTune = VEHICLE_TUNE;
  /**
   * Event tallies, every one of them: how often a thing happened since the game started. How many
   * machines are in the world with an engine and how many without is a census and is counted in
   * `status()`, where it is reported as `engines` and `silent` beside these; `resolved` and
   * `resolvedSilent` are how often a set was worked out, which a refit or a table landing does again.
   */
  readonly counts = { vehicles: 0, resolved: 0, resolvedSilent: 0, accels: 0, decels: 0, wings: 0, flybys: 0, hits: 0, downs: 0, power: 0, jumps: 0, lifts: 0, targets: 0, noHost: 0 };
  readonly log: VehicleLogRow[] = [];
  /** Sounds asked for that the bank turned out not to hold; each is named once, for the report. */
  readonly missing = new Set<string>();

  private host: VehicleHost | null = null;
  private baseUrl = '';
  private events: VehicleEventsPack | null = null;
  private eventsState = 'not fetched';
  private tables: VehicleTables | null = null;
  /** The client data files that name an engine, a vehicle's thrusters or a hull, indexed for the name match. */
  private engineIndex: { key: string; flat: string }[] = [];
  private vehicleIndex: { key: string; flat: string }[] = [];
  private hullIndex: { key: string; flat: string }[] = [];
  /** The interior table's rows, by the pob they name: the bed each names, and the floor. */
  private readonly roomBeds = new Map<string, string>();
  private readonly roomFloors = new Map<string, string>();
  /** The last hull a deck surface was asked for and the answer, so a frame's ask is one compare. */
  private deckFor = '';
  private deckWas: string | null = null;
  private readonly recs = new Map<object, Rec>();
  /** Every rec in one array, walked by index: the frame allocates nothing. */
  private readonly live: Rec[] = [];
  private pass = 0;
  private clock = 0;
  /** The hull the ear is inside and the hum it makes, so a change is noticed without asking every frame. */
  private humFor: object | null = null;
  private humKey = 0;
  private humId = '';
  /** The vehicle the player rides, flies or stands inside, for the power-up and the two-loop rule. */
  private ownNow: object | null = null;
  /** The last flyby of any ship, so a wing going past abreast is one whoosh rather than one each. */
  private lastFlybyAny = -1e9;
  /** The ship picked now, so the lock tones sound on a change and not every frame. */
  private targetNow: object | null = null;
  private targetLocked = false;
  /** When the lock pair last sounded, so a solution flickering at the edge of range is not a ratchet. */
  private lastLockAt = -1e9;
  private readonly ear = { x: 0, y: 0, z: 0 };
  private readonly earSpace: SoundSpace = { building: OUTSIDE.building, cell: OUTSIDE.cell };
  /** Refilled per call, so nothing is allocated when something sounds. */
  private readonly prepareList: string[] = [];

  /** The mixer, once the game has one. Everything below is silent and counted until then. */
  attach(host: VehicleHost, baseUrl: string): void {
    this.host = host;
    this.baseUrl = baseUrl;
    this.load();
  }

  /**
   * The shared event pack, once. It is the same file the feet read; a second fetch of it comes out of
   * the browser's own cache, and neither is on any visual path. Until it lands every machine is
   * silent and says so.
   */
  private load(): void {
    if (typeof window === 'undefined' || this.eventsState !== 'not fetched') return;
    this.eventsState = 'loading';
    void fetch(`${this.baseUrl}assets-private/sounds/events.json`)
      .then(async (res) => (res.ok && (res.headers.get('content-type') ?? '').includes('json') ? ((await res.json()) as VehicleEventsPack) : null))
      .catch(() => null)
      .then((pack) => {
        this.adoptEvents(pack);
        this.eventsState = pack ? `${Object.keys(pack.clientData ?? {}).length} client data files${pack.ships ? ', with the ship joins' : ', without the ship joins'}` : 'no events.json; run the sounds command';
      });
  }

  /** A pack read elsewhere (the node test). Every set worked out before it landed is thrown away. */
  adoptEvents(pack: VehicleEventsPack | null): void {
    this.events = pack;
    this.engineIndex = [];
    this.vehicleIndex = [];
    this.hullIndex = [];
    for (const key of Object.keys(pack?.clientData ?? {})) {
      const entry = pack!.clientData![key];
      const flat = flatName(baseName(key).replace(/^eng_/i, ''));
      if (entry.engines?.length) this.engineIndex.push({ key, flat });
      else if (/^clientdata\/vehicle\//i.test(key)) this.vehicleIndex.push({ key, flat: flatName(baseName(key)) });
      if (/^clientdata\/ship\//i.test(key)) this.hullIndex.push({ key, flat: flatName(baseName(key).replace(/^client_/i, '')) });
    }
    this.forget();
  }

  /** The shared tables from `sounds/sources.json`, handed over when they change. */
  setTables(tables: VehicleTables | null): void {
    if (tables === this.tables) return;
    this.tables = tables;
    this.roomBeds.clear();
    this.roomFloors.clear();
    for (const row of tables?.rooms ?? []) {
      // A ship's rooms are one row in the retail table (the YT-1300's), and the bed is the same by
      // day and by night: the day column is taken, with the night one standing in where it is empty.
      const bed = row.day ?? row.night ?? null;
      if (row.pob && bed && !this.roomBeds.has(row.pob)) this.roomBeds.set(row.pob, bed);
      if (row.pob && row.surface && !this.roomFloors.has(row.pob)) this.roomFloors.set(row.pob, row.surface);
    }
    this.deckFor = '';
    this.deckWas = null;
    this.forget();
  }

  /** Every set worked out again: a table or the pack landed and the answers may differ now. */
  private forget(): void {
    for (const rec of this.live) rec.lookKey = '';
  }

  /** Where the ear is and which room it is in, written by the game each frame. */
  setListener(x: number, y: number, z: number, space: SoundSpace): void {
    this.ear.x = x;
    this.ear.y = y;
    this.ear.z = z;
    this.earSpace.building = space.building;
    this.earSpace.cell = space.cell;
  }

  // ---- the frame's work ----

  /**
   * Every vehicle in the world this frame: their engines, the water under them, their wings and the
   * ones that fly past. `own` is the vehicle the player rides, flies or stands inside, which is the
   * one that holds two loops; `aboard` is the hull whose rooms the player is in, which hums.
   */
  update(dt: number, vehicles: readonly SoundVehicle[], own: SoundVehicle | null, aboard: SoundVehicle | null): void {
    const step = Math.max(0, Math.min(0.25, dt));
    this.clock += step;
    this.pass++;
    this.counts.vehicles = vehicles.length;
    const host = this.host;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v.disposed || v.destroyed) continue;
      const rec = this.recOf(v);
      rec.seen = this.pass;
      rec.own = v === own;
      this.stepOne(rec, step);
    }
    this.prune();
    this.stepHum(aboard);
    this.stepPower(own);
    if (!host) this.counts.noHost++;
  }

  private recOf(v: SoundVehicle): Rec {
    let rec = this.recs.get(v as object);
    if (rec) return rec;
    rec = {
      v,
      seen: this.pass,
      set: EMPTY_ENGINE,
      water: null,
      wing: null,
      flyby: null,
      chassis: '',
      hitGroup: '',
      power: 'default',
      lookKey: '',
      idleVoice: { key: 0, id: null, space: { building: OUTSIDE.building, cell: OUTSIDE.cell } },
      runVoice: { key: 0, id: null, space: { building: OUTSIDE.building, cell: OUTSIDE.cell } },
      waterVoice: { key: 0, id: null, space: { building: OUTSIDE.building, cell: OUTSIDE.cell } },
      usingRun: false,
      own: false,
      wingTarget: v.wings.target,
      throttleOpen: false,
      lastFlyby: -1e9,
      retryAt: -1e9,
      lastDistance: 0,
      hasDistance: false,
      x: v.pos.x,
      y: v.pos.y,
      z: v.pos.z,
    };
    this.recs.set(v as object, rec);
    this.live.push(rec);
    return rec;
  }

  /** Vehicles gone this frame: their voices let go and their records dropped. Walked backwards, so nothing is allocated. */
  private prune(): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const rec = this.live[i];
      if (rec.seen === this.pass && !rec.v.disposed) continue;
      this.release(rec);
      this.recs.delete(rec.v as object);
      const last = this.live.length - 1;
      if (i !== last) this.live[i] = this.live[last];
      this.live.length = last;
    }
  }

  private release(rec: Rec): void {
    this.dropVoice(rec.idleVoice);
    this.dropVoice(rec.runVoice);
    this.dropVoice(rec.waterVoice);
  }

  /** One voice let go and forgotten: the key, the sound it held and the space it held it in. */
  private dropVoice(voice: Voice): void {
    if (voice.key) this.host?.stop(voice.key, this.tune.swapFade);
    voice.key = 0;
    voice.id = null;
  }

  /** One vehicle's frame: its sounds resolved once, then its engine, its water, its wings and its flyby. */
  private stepOne(rec: Rec, dt: number): void {
    const v = rec.v;
    const look = this.lookKeyOf(v);
    if (look !== rec.lookKey) {
      rec.lookKey = look;
      this.resolve(rec);
    }
    // The gap to the ear, and how fast it is shrinking: one distance a frame answers the falloff,
    // the Doppler shift and the flyby together.
    const dx = v.pos.x - this.ear.x;
    const dy = v.pos.y - this.ear.y;
    const dz = v.pos.z - this.ear.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const closing = rec.hasDistance && dt > 1e-4 ? (rec.lastDistance - d) / dt : 0;
    rec.lastDistance = d;
    rec.hasDistance = true;
    const share = speedShare(v.speed, v.spec.maxSpeed);
    // The ear rides what the player flies, so nothing it makes is Doppler-shifted; everything else is
    // (a creature is not a machine and has no engine anyway).
    const doppler = rec.own || v.spec.animal ? 0 : dopplerSemitones(closing, this.tune);
    const pitch = this.tune.pitchSpan * share + doppler;
    this.stepEngine(rec, share, pitch);
    this.stepWater(rec);
    this.stepWings(rec);
    if (!rec.own && v.spec.ship) this.stepFlyby(rec, d, closing);
  }

  /**
   * The engine. The vehicle the player is on holds both loops and crossfades them; everything else
   * holds one and swaps it with a fade when its speed crosses the band, which keeps a space fight to
   * one voice a ship.
   */
  private stepEngine(rec: Rec, share: number, pitch: number): void {
    const set = rec.set;
    if (!set.run && !set.idle) {
      // Nothing to play: a hull the pack has no engine for, and a hull whose new fit turned out to
      // have none, which must let go of whatever the old one was playing.
      this.holdLoop(rec, rec.idleVoice, null, 0, 0);
      this.holdLoop(rec, rec.runVoice, null, 0, 0);
      return;
    }
    const mix = engineMix(share, this.tune);
    if (rec.own) {
      this.holdLoop(rec, rec.idleVoice, set.idle, mix.idle, pitch);
      this.holdLoop(rec, rec.runVoice, set.run, mix.run, pitch);
      // Speeding up and slowing down: one sound each as the throttle crosses, with a band between
      // so a hand on the edge does not play it over and over.
      if (!rec.throttleOpen && share > this.tune.open) {
        rec.throttleOpen = true;
        if (set.accel) {
          this.counts.accels++;
          this.at(rec, 'accel', set.accel);
        }
      } else if (rec.throttleOpen && share < this.tune.close) {
        rec.throttleOpen = false;
        if (set.decel) {
          this.counts.decels++;
          this.at(rec, 'decel', set.decel);
        }
      }
      return;
    }
    // Not the player's: one loop, the run over the band and the idle under it, at a gain that never
    // quite reaches nothing, so a ship parked beside you is still a machine standing there. The swap
    // itself is `holdLoop`'s: it sees the wanted sound change under a living voice and fades it over.
    rec.usingRun = rec.usingRun ? share > this.tune.swapDown : share > this.tune.swapUp;
    const id = (rec.usingRun ? set.run : set.idle) ?? set.run ?? set.idle;
    const gain = this.tune.parkedGain + (1 - this.tune.parkedGain) * mix.run;
    this.holdLoop(rec, rec.runVoice, id, gain, pitch);
    this.holdLoop(rec, rec.idleVoice, null, 0, 0);
  }

  private stepWater(rec: Rec): void {
    // Only under what the player is on: another speeder's spray is the game's `amb_river_large_lp`,
    // which every vehicle names, and a dozen of them would be a dozen rivers.
    const want = rec.own && rec.v.onWater ? rec.water : null;
    this.holdLoop(rec, rec.waterVoice, want, this.tune.water, 0);
  }

  private stepWings(rec: Rec): void {
    const wings = rec.v.wings;
    if (!wings.length) return;
    if (wings.target === rec.wingTarget) return;
    rec.wingTarget = wings.target;
    if (!rec.wing) return;
    this.counts.wings++;
    this.at(rec, wings.target ? 'wings open' : 'wings close', rec.wing);
  }

  /**
   * A ship going past the ear: once, and not again for a moment, however many fly by together. The
   * gap is kept twice over -- on the ship, so one ship crossing back and forth is not a stutter, and
   * across all of them, so a wing of four going past abreast is one whoosh and not four at once.
   */
  private stepFlyby(rec: Rec, distance: number, closing: number): void {
    if (!rec.flyby || distance > this.tune.flyby) return;
    if (Math.abs(closing) < this.tune.flybySpeed) return;
    if (this.clock - rec.lastFlyby < this.tune.flybyGap) return;
    if (this.clock - this.lastFlybyAny < this.tune.flybyGap) return;
    rec.lastFlyby = this.clock;
    this.lastFlybyAny = this.clock;
    this.counts.flybys++;
    this.at(rec, 'flyby', rec.flyby);
  }

  /** The hum inside a hull: the `INTS` sound its client data names, else the interior table's row for it. */
  private stepHum(aboard: SoundVehicle | null): void {
    const key = (aboard as object | null) ?? null;
    if (key === this.humFor) {
      if (this.humKey && !this.host?.isPlaying(this.humKey)) this.humKey = 0;
      return;
    }
    this.humFor = key;
    if (this.humKey) {
      this.host?.stop(this.humKey);
      this.humKey = 0;
      this.humId = '';
    }
    if (!aboard) return;
    const id = this.hullHum(aboard);
    if (!id) return;
    this.humId = id;
    // Flat and in the ear's own space: the hum is the room around you, not a point in it.
    this.humKey = this.loop(id, undefined, undefined, undefined, 1, 0, this.earSpace);
    this.note('hum', aboard.def?.id ?? aboard.spec.id, id, this.humKey);
  }

  /** The ship the player is on changed: the game's own power-up, and the power-down when they step off. */
  private stepPower(own: SoundVehicle | null): void {
    const key = (own as object | null) ?? null;
    if (key === this.ownNow) return;
    const before = this.ownNow;
    this.ownNow = key;
    const table = this.tables?.shipPower;
    if (!table) return;
    if (before) {
      const rec = this.recs.get(before);
      if (rec?.v.spec.ship) this.power(rec, 'default', false);
    }
    if (own?.spec.ship) {
      const rec = this.recs.get(own as object);
      if (rec) this.power(rec, 'default', true);
    }
  }

  /** One system's power sound at a ship: `default` is the ship itself powering up or down. */
  private power(rec: Rec, system: string, on: boolean): void {
    const set = this.tables?.shipPower?.[rec.power] ?? this.tables?.shipPower?.default;
    const id = set?.[`${system}_${on ? 'enabled' : 'disabled'}`] ?? null;
    if (!id) return;
    this.counts.power++;
    this.at(rec, `power ${system} ${on ? 'up' : 'down'}`, id);
  }

  // ---- what the world calls in ----

  /**
   * A blow landed on a hull. `chassis` is the ship's own chassis row, which is what the game keys its
   * hit sounds on; a ship whose chassis the tables do not name takes the fallback row, which is what
   * the client did with the table's own empty-named row.
   */
  shipHit(chassis: string | null, layer: HullLayer, x: number, y: number, z: number, partDown: string | null = null): void {
    this.counts.hits++;
    const group = (chassis && this.tables?.hitGroups?.[chassis]) || '';
    const hits = this.tables?.shipHits;
    // The hit table's fallback row is written under `default` by the converter; a pack that kept the
    // table's own empty name for it is read too.
    const id = hits?.[group]?.[layer] ?? hits?.default?.[layer] ?? hits?.['']?.[layer] ?? null;
    // In the ear's own space: there is no wall between a bolt striking the outside of the hull you
    // are sitting in and the cockpit, and without this every blow on your own ship would be muffled.
    const key = this.play(id, x, y, z, this.earSpace);
    this.note(`hit ${layer}`, chassis ?? 'ship', id, key);
    if (!partDown) return;
    // A part gone is the game's own power-down for that system; the slot's number (weapon_0) is not
    // part of the name the table keys on.
    const set = this.powerSetFor(chassis, null, null);
    const system = partDown.replace(/_\d+$/, '');
    const table = this.tables?.shipPower?.[set] ?? this.tables?.shipPower?.default;
    const down = table?.[`${system}_disabled`] ?? table?.default_disabled ?? null;
    if (!down) return;
    this.counts.power++;
    this.note(`power ${system} down`, chassis ?? 'ship', down, this.play(down, x, y, z, this.earSpace));
  }

  /** A hull blew up: the sounds of the effect its own client data names it destroyed by. */
  shipDown(id: string | null, template: string | null, x: number, y: number, z: number): void {
    this.counts.downs++;
    const joined = id ? this.events?.ships?.combat?.hulls?.[id] : null;
    let sounds: readonly string[] | null = joined ?? null;
    if (!sounds) {
      const cef = this.hullData(id, template)?.destroyed ?? null;
      sounds = cef ? (this.events?.clientEffects?.[cef]?.sounds ?? null) : null;
    }
    if (!sounds?.length) {
      this.note('destroyed', id ?? 'ship', null, 0);
      return;
    }
    for (const s of sounds) this.note('destroyed', id ?? 'ship', s, this.play(s, x, y, z, this.earSpace));
  }

  /** One stage of a jump, at the hull. The scene's three sounds are the pack's, not ours. */
  jump(stage: JumpStage, sound: string | null | undefined, x: number, y: number, z: number): void {
    if (!sound) return;
    this.counts.jumps++;
    // The jump's three are the scene's own non-positional sounds: they belong wherever the ear is,
    // which aboard a hull is that hull's rooms.
    this.note(`jump ${stage}`, 'hyperspace', sound, this.play(sound, x, y, z, this.earSpace));
  }

  /**
   * The target tones the game's own combat data carries. `activate` when a ship is picked and
   * `deactivate` when the pick is let go are the game's; `acquired` when the guns first have a firing
   * solution on it is INVENTED, since nothing in this game locks a missile.
   */
  target(sounds: { activate?: string; deactivate?: string; acquiring?: string; acquired?: string } | null | undefined, picked: object | null, locked: boolean): void {
    if (!sounds) return;
    if (picked !== this.targetNow) {
      this.targetNow = picked;
      this.targetLocked = false;
      // A different ship starts the lock over, so the tone for it is not swallowed by the last one's.
      this.lastLockAt = -1e9;
      const id = picked ? sounds.activate : sounds.deactivate;
      if (id) {
        this.counts.targets++;
        this.note(picked ? 'target' : 'target off', 'ship', id, this.play(id));
      }
    }
    if (picked && locked !== this.targetLocked) {
      this.targetLocked = locked;
      // Whether the guns have a line on a target is worked out from scratch every frame, so a ship
      // hovering at the edge of the bolt's reach flips it over and over. The new state is taken
      // either way, but the pair does not sound again inside `lockGap`.
      if (this.clock - this.lastLockAt < this.tune.lockGap) return;
      this.lastLockAt = this.clock;
      const id = locked ? sounds.acquired : sounds.acquiring;
      if (id) {
        this.counts.targets++;
        this.note(locked ? 'lock' : 'unlock', 'ship', id, this.play(id));
      }
    }
  }

  /**
   * A stop picked in a lift. The game has two one-shots for it and nothing says where they were used
   * (the lift was a server object): rising takes the rise sound and going down the descend one, at
   * the stop the player is put at. INVENTED in its use, the game's in its sound, and the two files
   * are the converter's own choice where it has written one, so the choice lives in one place.
   */
  lift(up: boolean, x: number, y: number, z: number, space?: SoundSpace): void {
    const joined = this.events?.ships?.lifts;
    const id = (up ? joined?.rise : joined?.descend) ?? (up ? 'sound/item_elevator_02_rise.snd' : 'sound/item_elevator_02_descend.snd');
    this.counts.lifts++;
    const host = this.host;
    if (!host) {
      this.counts.noHost++;
      return;
    }
    if (host.bank.available && !host.bank.template(id) && this.missing.size < 100) this.missing.add(id);
    this.note(up ? 'lift up' : 'lift down', 'lift', id, host.play(id, { x, y, z, space: space ?? this.earSpace }));
  }

  /** Every voice let go (a world unload, the select screen): the records go with them. */
  leave(): void {
    for (const rec of this.live) this.release(rec);
    this.live.length = 0;
    this.recs.clear();
    if (this.humKey) this.host?.stop(this.humKey);
    this.humKey = 0;
    this.humId = '';
    this.humFor = null;
    this.ownNow = null;
    this.targetNow = null;
    this.targetLocked = false;
    this.lastLockAt = -1e9;
    this.lastFlybyAny = -1e9;
  }

  // ---- working out what a machine sounds like ----

  /** The key a vehicle's engine set is worked out against: its hull and the look its engine slot wears now. */
  private lookKeyOf(v: SoundVehicle): string {
    const id = v.def?.id ?? v.spec.id;
    const look = v.fit?.looks?.engine;
    return `${id}|${look === undefined ? '' : look}|${this.eventsState}`;
  }

  /**
   * Everything one vehicle sounds like, worked out once. A ship's engine is its fitted engine part's
   * own run loop first, which is why a refit changes what it sounds like; then the hull's own loop
   * and its thruster set; then the run loop of the family its flyby names. A ground vehicle's is its
   * own client data, which holds all four loops.
   */
  private resolve(rec: Rec): void {
    const v = rec.v;
    const def = v.def;
    rec.chassis = def?.chassis ?? (def?.id ? `player_${def.id}` : '');
    rec.hitGroup = (rec.chassis && this.tables?.hitGroups?.[rec.chassis]) || '';
    rec.power = this.powerSetFor(rec.chassis, def?.id ?? v.spec.id, def?.template);
    rec.flyby = (rec.chassis && this.tables?.flyby?.[rec.chassis]) || null;
    rec.wing = null;
    for (const a of def?.attachments ?? []) {
      if (a.kind === 'wing' && a.sound) {
        rec.wing = a.sound;
        break;
      }
    }
    const playable = (id: string): boolean => this.playable(id);
    const family = (run: string) => this.events?.ships?.kin?.[run];
    let set: EngineSounds | null = null;
    if (v.spec.ship) {
      set = engineFromClientData(this.engineData(v), playable, family);
      if (!set?.run) set = engineFromClientData(this.hullData(def?.id ?? v.spec.id, def?.template), playable, family) ?? set;
      if (!set?.run) {
        const run = runFromFlyby(rec.flyby, playable);
        if (run) {
          const named = family(run);
          const kin = siblingLoops(run, playable);
          set = { idle: named?.idle ?? kin.idle, accel: named?.accel ?? kin.accel, decel: named?.decel ?? kin.decel, run, source: 'flyby family' };
        }
      }
      rec.water = null;
    } else {
      const entry = this.vehicleData(v);
      set = engineFromClientData(entry, playable, family);
      rec.water = entry?.ground?.find((g) => g.water)?.sound ?? null;
    }
    rec.set = set ?? EMPTY_ENGINE;
    if (rec.set.run || rec.set.idle) this.counts.resolved++;
    else this.counts.resolvedSilent++;
    this.prepareOf(rec);
  }

  /**
   * Which of the game's three power sets a hull answers to. The converter works it out off the
   * chassis row's own hit-sound group and writes it per hull, so the two cannot drift apart; without
   * that join the same rule is applied here to the same column. INVENTED as a mapping, and the only
   * link between a hull and a faction's sounds there is.
   */
  private powerSetFor(chassis: string | null, id?: string | null, template?: string | null): string {
    const joins = this.events?.ships?.power;
    for (const want of [id, template]) {
      const joined = want ? (joins?.[want] ?? joins?.[baseName(want)]) : null;
      if (joined) return joined;
    }
    const group = (chassis && this.tables?.hitGroups?.[chassis]) || '';
    return group === 'xwing' || group === 'tie' ? group : 'default';
  }

  /**
   * A ship's engine part's client data: the fitted part's, by the converter's join and then by the
   * part's name, and failing that the join for a hull whose engine is not a part it wears at all
   * (every TIE, both gunboats, the corvette), which nothing in the fit can say.
   */
  private engineData(v: SoundVehicle): ClientDataSounds | null {
    const data = this.events?.clientData;
    if (!data) return null;
    for (const template of this.enginePartsOf(v)) {
      const joined = this.events?.ships?.engines?.[template] ?? this.events?.ships?.engines?.[baseName(template)];
      const entry = joined ? data[joined] : null;
      if (entry?.engines?.length) return entry;
      // The part's own name against the engine parts the pack holds: `xwing_engine_pos_s01` is
      // `eng_xwing_pos_s01`. INVENTED, and only until the converter writes the join.
      const found = bestName(baseName(template).replace(/engine/i, ''), this.engineIndex);
      if (found && data[found]?.engines?.length) return data[found];
    }
    const joins = this.events?.ships?.shipEngines;
    for (const want of [v.def?.id ?? v.spec.id, v.def?.template]) {
      const joined = want ? (joins?.[want] ?? joins?.[baseName(want)]) : null;
      if (joined && data[joined]?.engines?.length) return data[joined];
    }
    return null;
  }

  /**
   * The engine parts a ship wears now: the look its fit puts in the engine slot, or, without a fit,
   * the stock parts the manifest lists for that slot. Its own array, walked once per resolve and not
   * per frame.
   */
  private enginePartsOf(v: SoundVehicle): string[] {
    const out: string[] = [];
    const slot = v.def?.fit?.slots?.find((s) => s.slot === 'engine');
    const look = slot?.looks?.[v.fit?.looks?.engine ?? 0];
    for (const p of look?.parts ?? []) if (p.template) out.push(p.template);
    if (out.length) return out;
    for (const a of v.def?.attachments ?? []) if (a.slot === 'engine' && a.template) out.push(a.template);
    return out;
  }

  /** A hull's own client data: the converter's join first, then the ship's id and template by name. */
  private hullData(id: string | null | undefined, template?: string | null): ClientDataSounds | null {
    const data = this.events?.clientData;
    if (!data) return null;
    const joins = this.events?.ships?.hulls;
    for (const want of [id, template]) {
      if (!want) continue;
      const joined = joins?.[want] ?? joins?.[baseName(want)];
      if (joined && data[joined]) return data[joined];
    }
    for (const want of [id, template]) {
      if (!want) continue;
      const found = bestName(baseName(want).replace(/^player_/i, ''), this.hullIndex);
      if (found && data[found]) return data[found];
    }
    return null;
  }

  /** A ground vehicle's client data, the same way. */
  private vehicleData(v: SoundVehicle): ClientDataSounds | null {
    const data = this.events?.clientData;
    if (!data) return null;
    const id = v.def?.id ?? v.spec.id;
    const joins = this.events?.ships?.vehicles;
    for (const want of [id, v.def?.template]) {
      if (!want) continue;
      const joined = joins?.[want] ?? joins?.[baseName(want)];
      if (joined && data[joined]) return data[joined];
    }
    for (const want of [id, v.def?.template]) {
      if (!want) continue;
      const found = bestName(baseName(want), this.vehicleIndex);
      if (found && data[found]?.thrusters?.length) return data[found];
    }
    return null;
  }

  /**
   * What a hull's deck is made of, from the interior table's row for it: the feet ask this each
   * frame while the player is aboard, so the last answer is kept rather than looked up again. Null
   * where the table names no row, and the caller decides what a deck with no row is made of.
   */
  deckSurface(id: string | null | undefined): string | null {
    const key = id ?? '';
    if (key === this.deckFor) return this.deckWas;
    this.deckFor = key;
    this.deckWas = key ? this.rowKeyFor(key, this.roomFloors) : null;
    return this.deckWas;
  }

  /**
   * A row of the interior table for a hull, keyed as the table keys its rooms: on the portal
   * layout's own name, which for a hull with rooms is the ship's. A decorated one
   * (`yt1300_decorated_01`) falls back a word at a time to the plain hull it is a decoration of.
   */
  private rowKeyFor(id: string, table: Map<string, string>): string | null {
    let key = id;
    while (key) {
      const row = table.get(key);
      if (row) return row;
      const shorter = key.replace(/_[^_]+$/, '');
      key = shorter === key ? '' : shorter;
    }
    return null;
  }

  /**
   * The hum heard inside a hull: the interior table's row for it, and only that. A hull's own
   * `FORM INTS` rows are not a bed -- every one of them in the archives names the same booster
   * rocket loop, on the eight hulls that carry one and on the forty-five booster components, which
   * is a thruster firing and not a room's air. They are kept in the record for whenever the boost
   * key gets a sound of its own.
   */
  private hullHum(v: SoundVehicle): string | null {
    return this.rowKeyFor(v.def?.id ?? v.spec.id, this.roomBeds);
  }

  /** Whether the bank holds a template at all; true before it lands, so nothing is thrown away early. */
  private playable(id: string): boolean {
    const bank = this.host?.bank;
    if (!bank?.available) return true;
    return !!bank.template(id);
  }

  /** Ask the bank for everything a vehicle can make, so the first sound is not the one that waits. */
  private prepareOf(rec: Rec): void {
    const host = this.host;
    if (!host) return;
    const list = this.prepareList;
    list.length = 0;
    for (const id of [rec.set.idle, rec.set.accel, rec.set.decel, rec.set.run, rec.water, rec.wing, rec.flyby]) if (id) list.push(id);
    if (list.length) host.prepare(list);
  }

  // ---- plumbing ----

  /**
   * A looping voice kept where the vehicle is, playing the sound wanted now. It is started when the
   * mixer can (the pack may still be coming, and a simulated second starts nothing), and asked for
   * again after a wait rather than on every frame.
   *
   * A voice already running is not simply kept: the sound it holds is compared with the one wanted,
   * and a voice holding the wrong one is faded out and the wanted one started in its place. That is
   * the one thing that makes a refit change what a ship sounds like, that turns the single loop a
   * parked ship holds into the idle and run pair of the ship you have just climbed into, and that
   * takes the run loop off a ship you have stepped out of.
   */
  private holdLoop(rec: Rec, voice: Voice, id: string | null, gain: number, pitch: number): void {
    const host = this.host;
    if (!host) return;
    // A voice the mixer let go of (it ran out, or its slot went to something nearer) is forgotten
    // here rather than kept as a key that plays nothing.
    if (voice.key && !host.isPlaying(voice.key)) {
      voice.key = 0;
      voice.id = null;
    }
    if (voice.key && voice.id !== id) this.dropVoice(voice);
    if (!id) return;
    // Where the sound belongs: the ship the player is on is in the room the ear is in, so its own
    // engine is never muffled by its own walls; everything else is out in the world.
    const space = rec.own ? this.earSpace : OUTSIDE;
    if (!voice.key) {
      if (this.clock < rec.retryAt) return;
      if (host.bank.available && !host.bank.template(id) && this.missing.size < 100) this.missing.add(id);
      voice.space.building = space.building;
      voice.space.cell = space.cell;
      const key = host.loop(id, { x: rec.v.pos.x, y: rec.v.pos.y, z: rec.v.pos.z, gain, pitch, space: voice.space });
      if (!key) {
        rec.retryAt = this.clock + this.tune.retry;
        return;
      }
      voice.key = key;
      voice.id = id;
      rec.x = rec.v.pos.x;
      rec.y = rec.v.pos.y;
      rec.z = rec.v.pos.z;
      return;
    }
    // The space a living voice is in follows the ear: boarding a hull that was already humming out
    // in the open puts its engine in the hull with you rather than leaving it outside.
    if (voice.space.building !== space.building || voice.space.cell !== space.cell) {
      voice.space.building = space.building;
      voice.space.cell = space.cell;
      host.setSpace(voice.key, voice.space);
    }
    const dx = rec.v.pos.x - rec.x;
    const dy = rec.v.pos.y - rec.y;
    const dz = rec.v.pos.z - rec.z;
    if (dx * dx + dy * dy + dz * dz > this.tune.moveStep * this.tune.moveStep) {
      rec.x = rec.v.pos.x;
      rec.y = rec.v.pos.y;
      rec.z = rec.v.pos.z;
      host.move(voice.key, rec.x, rec.y, rec.z);
    }
    host.setGain(voice.key, gain);
    host.setPitch?.(voice.key, pitch);
  }

  /** One sound where a vehicle is, in the space it is in. */
  private at(rec: Rec, what: string, id: string | null): void {
    const p = rec.v.pos;
    const key = this.play(id, p.x, p.y, p.z, rec.own ? this.earSpace : undefined);
    this.note(what, rec.v.def?.id ?? rec.v.spec.id, id, key);
  }

  private play(id: string | null | undefined, x?: number, y?: number, z?: number, space?: SoundSpace): number {
    const host = this.host;
    if (!id) return 0;
    if (!host) {
      this.counts.noHost++;
      return 0;
    }
    if (host.bank.available && !host.bank.template(id) && this.missing.size < 100) this.missing.add(id);
    return host.play(id, { x, y, z, space: space ?? (x === undefined ? undefined : OUTSIDE) });
  }

  private loop(id: string, x?: number, y?: number, z?: number, gain = 1, pitch = 0, space?: SoundSpace): number {
    const host = this.host;
    if (!host) {
      this.counts.noHost++;
      return 0;
    }
    if (host.bank.available && !host.bank.template(id) && this.missing.size < 100) this.missing.add(id);
    return host.loop(id, { x, y, z, gain, pitch, space });
  }

  private note(what: string, who: string, sound: string | null | undefined, key: number): void {
    this.log.push({ at: Math.round(this.clock * 100) / 100, what, who, sound: sound ?? null, key });
    if (this.log.length > 40) this.log.splice(0, this.log.length - 40);
  }

  /** The whole of it in numbers, which is the only way a driven tab can check any of this. */
  status(): Record<string, unknown> {
    const machines: Record<string, unknown>[] = [];
    // `engines` and `silent` are a census of the machines in the world now, counted here rather than
    // tallied as sets are worked out: a set is worked out again on every refit and every time a
    // table lands, so a tally of those is how often the question was asked, not how many are silent.
    let engines = 0;
    let silent = 0;
    for (const rec of this.live) {
      if (rec.set.run || rec.set.idle) engines++;
      else silent++;
      machines.push({
        id: rec.v.def?.id ?? rec.v.spec.id,
        own: rec.own,
        chassis: rec.chassis || null,
        from: rec.set.source,
        run: rec.set.run,
        idle: rec.set.idle,
        accel: rec.set.accel,
        decel: rec.set.decel,
        water: rec.water,
        wing: rec.wing,
        flyby: rec.flyby,
        hits: rec.hitGroup || 'default',
        power: rec.power,
        // What each voice is playing now, not merely that it holds a key: a voice holding the wrong
        // sound is the one fault that cannot be heard from a driven tab.
        voices: {
          idle: rec.idleVoice.id,
          run: rec.runVoice.id,
          water: rec.waterVoice.id,
          keys: [rec.idleVoice.key, rec.runVoice.key, rec.waterVoice.key],
          space: [rec.runVoice.space.building, rec.runVoice.space.cell],
        },
        speed: Math.round(rec.v.speed * 10) / 10,
        distance: Math.round(rec.lastDistance),
      });
    }
    return {
      events: this.eventsState,
      tables: this.tables ? { flyby: Object.keys(this.tables.flyby ?? {}).length, hits: Object.keys(this.tables.shipHits ?? {}).length, power: Object.keys(this.tables.shipPower ?? {}).length, rooms: this.roomBeds.size } : null,
      joins: this.events?.ships ? { engines: Object.keys(this.events.ships.engines ?? {}).length, hulls: Object.keys(this.events.ships.hulls ?? {}).length, vehicles: Object.keys(this.events.ships.vehicles ?? {}).length } : null,
      listener: { at: [Math.round(this.ear.x), Math.round(this.ear.y), Math.round(this.ear.z)], space: { ...this.earSpace } },
      hum: this.humKey ? this.humId : null,
      counts: { ...this.counts, engines, silent },
      missing: [...this.missing].slice(0, 12),
      machines,
      recent: this.log.slice(-12),
      tune: { ...this.tune },
    };
  }
}

/**
 * The one of these the game has. A module-level object, because a hull is struck, blown up and flown
 * into hyperspace from three different systems and none of them should have to carry a mixer.
 */
export const vehicleSounds = new VehicleSounds();

