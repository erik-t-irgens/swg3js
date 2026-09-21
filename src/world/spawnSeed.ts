// What a creature stood by hand is, once nothing stands on its own any more.
//
// The planet's automatic wildlife is switched off (`WILDLIFE_KEY` below, and `World.warmUp`, which is
// the only place that asks). Nothing appears in a world unless somebody stood it there, and what an
// admin stands belongs to the world rather than to them: every browser connected sees the same
// creature, one of them thinks for it, and it is handed between them. That only works if the thing
// being handed over has a name and a look every browser agrees on without being told, which is what
// this file is for.
//
// A spawn is therefore a record rather than a call: an id, the world it stands in, the catalogue key
// of what it is, where it stands, which way it faces, and one seed. Everything a stood creature would
// otherwise take from `Math.random` -- the size it is within its own range, the weapon off the rack,
// the colour of a blade, where in its idle it starts -- is drawn from that seed instead, so two
// browsers standing the same record stand the same creature down to the numbers. The id is worked out
// the same way in every browser as well, from the world, the player who asked and a counter, so the
// browser that asked does not have to wait to be told what its own spawn is called before it can talk
// about it.
//
// Nothing here touches the document, three.js, the socket or the catalogue: a node test runs it
// exactly as it is. The one thing that is not pure is `wildlifeWanted`, which reads one switch out of
// this browser's storage through the same guard the session uses, since a private window, cleared
// site data and a node test all give a storage that is not there. Nothing here runs in a frame -- a
// spawn is an event, and the switch is read once when a planet arrives.

import { sha256, toHex, utf8 } from '../net/hash.ts';

/**
 * The switch that puts the planet's own wildlife back. It is off unless this browser's storage holds
 * `'1'` under it, which is the owner's decision: nothing appears in a world on its own any more, and
 * what is out there was stood by somebody. It is kept as a switch rather than deleted so that the old
 * path can be measured against the new one (`localStorage['swg.wildlife'] = '1'`, then travel).
 */
export const WILDLIFE_KEY = 'swg.wildlife';

/** Where a browser keeps its own small things; a node test hands in its own, a browser gets storage. */
export interface SwitchStore {
  get(key: string): string | null;
}

/** localStorage, or nothing at all when there is none (a private window, a node test, cleared data). */
export function browserSwitches(): SwitchStore {
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
  };
}

/**
 * Whether a planet stands its own wildlife when it loads. Off unless the switch says otherwise: the
 * answer is false for a browser with no storage at all, which is the same answer as a browser that
 * never set it.
 */
export function wildlifeWanted(store: SwitchStore = browserSwitches()): boolean {
  try {
    return store.get(WILDLIFE_KEY) === '1';
  } catch {
    // A store that throws is a store with nothing in it. This is read on the way into a world, and
    // the way into a world is not somewhere a storage that has been switched off may throw.
    return false;
  }
}

/** How many characters a spawn's id is. Long enough that two worlds' counters cannot collide. */
const ID_CHARS = 12;

/**
 * One creature stood by hand, as everything that talks about it says it. The place is the world's own
 * (the planet's metres), and `y` is left out when whoever made the record did not know the ground
 * there: the manager then asks the ground itself, as it always has.
 */
export interface SpawnRecord {
  /** The name every browser knows it by, from `spawnIdFor`. */
  id: string;
  /** The world it stands in: the planet or zone id, so a record cannot be stood in the wrong place. */
  world: string;
  /** The catalogue entry's id -- what it is. */
  species: string;
  x: number;
  y?: number;
  z: number;
  /** Radians, the game's own heading. */
  heading: number;
  /** Everything it rolls comes out of this one number. */
  seed: number;
  /** Whether it was stood inside a building's rooms rather than on the ground. */
  inside?: boolean;
}

/**
 * The rolls a stood creature would otherwise take from `Math.random`, each a number from 0 up to but
 * not including 1. Each is drawn from its own stream of the seed, so a roll added here later does not
 * move any of the ones already in use and every record stood before it stands the same way after.
 */
export interface SpawnRolls {
  /** Which way it faces, when the record names no heading of its own. */
  heading: number;
  /** Where in its own size range it falls. */
  scale: number;
  /** Which weapon off the rack, and which colour a blade is. */
  arms: number;
  /** Which of the entry's colour variants, where it has any. */
  variant: number;
  /** Where in its idle it starts, so a row of them is not in step. */
  idle: number;
}

/** The streams, named rather than numbered at the call sites: adding one never disturbs the others. */
const STREAM = { heading: 1, scale: 2, arms: 3, variant: 4, idle: 5 } as const;

/**
 * One number from a seed and a stream, from 0 up to but not including 1. It is mulberry32's step,
 * which is written entirely in `Math.imul` and unsigned shifts, so it is exact and gives the same
 * answer in every browser and in node -- which is the whole point of it being here rather than being
 * a hash of a string.
 */
export function roll(seed: number, stream: number): number {
  let a = (Math.imul(seed >>> 0, 0x9e3779b1) + Math.imul(stream >>> 0, 0x85ebca6b)) >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * A stream of numbers from a seed, for the few callers that want more than one (choosing a weapon
 * walks a rack). The same seed and stream give the same run of numbers in every browser.
 */
export function rngFor(seed: number, stream = 0): () => number {
  let a = (Math.imul(seed >>> 0, 0x9e3779b1) + Math.imul(stream >>> 0, 0x85ebca6b)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every roll one record makes, worked out from its seed alone. */
export function rollsFor(seed: number): SpawnRolls {
  return {
    heading: roll(seed, STREAM.heading),
    scale: roll(seed, STREAM.scale),
    arms: roll(seed, STREAM.arms),
    variant: roll(seed, STREAM.variant),
    idle: roll(seed, STREAM.idle),
  };
}

/** The stream a weapon is chosen from, handed to whatever wants a run of numbers rather than one. */
export function armsRng(seed: number): () => number {
  return rngFor(seed, STREAM.arms);
}

/**
 * The name a spawn is known by, the same in every browser: a short hash of the world, the player who
 * asked for it and their own count of how many they have asked for. It is worked out rather than
 * handed out so the browser that asked can talk about its own spawn before the server has answered,
 * and so two admins in one world can never name the same creature.
 */
export function spawnIdFor(world: string, spawner: string, counter: number): string {
  return toHex(sha256(utf8(`${world}|${spawner}|${Math.trunc(counter)}`))).slice(0, ID_CHARS);
}

/**
 * The seed that goes with an id. It is drawn from the id rather than from a clock or a die, so a
 * record rebuilt from nothing but its id and its place still rolls the same creature -- which is what
 * makes a spawn something a browser can be told about long after it was stood.
 */
export function seedFor(id: string): number {
  const h = sha256(utf8(`seed|${id}`));
  return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

/** A whole record from the three things the browser standing one knows, with the place it picked. */
export function recordFor(world: string, spawner: string, counter: number, species: string, at: { x: number; y?: number; z: number; heading: number; inside?: boolean }): SpawnRecord {
  const id = spawnIdFor(world, spawner, counter);
  const rec: SpawnRecord = { id, world, species, x: at.x, z: at.z, heading: at.heading, seed: seedFor(id) };
  if (at.y !== undefined) rec.y = at.y;
  if (at.inside) rec.inside = true;
  return rec;
}

/**
 * Where a creature's size falls in its own range, from one roll. The range is the catalogue's own two
 * numbers; a range that is not a range (a missing one, a zero, a pair the wrong way round) is one,
 * which is what a body with no size of its own has always been.
 */
export function scaleFrom(range: readonly number[] | undefined, r: number): number {
  const lo = Number(range?.[0]);
  const hi = Number(range?.[1]);
  if (!Number.isFinite(lo) || lo <= 0) return 1;
  const span = Number.isFinite(hi) ? Math.max(0, hi - lo) : 0;
  return lo + Math.max(0, Math.min(1, r)) * span;
}

/** What the manager is asked for: a place, a way to face, and the rolls, with nothing left to chance. */
export interface SpawnArgs {
  id: string;
  species: string;
  x: number;
  /** The ground's own height where the record did not carry one. */
  y: number | undefined;
  z: number;
  heading: number;
  inside: boolean;
  seed: number;
  rolls: SpawnRolls;
}

/**
 * One record turned into the arguments the manager stands a creature from. Every number it answers
 * with is either the record's own or drawn from its seed, so the same record gives the same arguments
 * on any machine, in any order, however long after it was made.
 */
export function spawnArgsFor(rec: SpawnRecord): SpawnArgs {
  const seed = Number.isFinite(rec.seed) ? rec.seed >>> 0 : seedFor(rec.id);
  const rolls = rollsFor(seed);
  const heading = Number.isFinite(rec.heading) ? rec.heading : rolls.heading * Math.PI * 2;
  return {
    id: rec.id,
    species: rec.species,
    x: rec.x,
    y: Number.isFinite(rec.y as number) ? (rec.y as number) : undefined,
    z: rec.z,
    heading,
    inside: !!rec.inside,
    seed,
    rolls,
  };
}

/**
 * Whether a record is one this world can stand at all: the fields it must have, as numbers, and the
 * world it names. What arrives from another browser is data and is checked before it is used, the way
 * every other message in this game is; a record that fails this is dropped rather than stood badly.
 */
export function recordFits(rec: SpawnRecord | null | undefined, world: string): boolean {
  if (!rec || typeof rec !== 'object') return false;
  if (typeof rec.id !== 'string' || !rec.id) return false;
  if (typeof rec.species !== 'string' || !rec.species) return false;
  if (rec.world !== world) return false;
  if (!Number.isFinite(rec.x) || !Number.isFinite(rec.z)) return false;
  if (rec.y !== undefined && !Number.isFinite(rec.y)) return false;
  if (!Number.isFinite(rec.heading)) return false;
  if (!Number.isFinite(rec.seed)) return false;
  return true;
}

// ---- standing one, decided before anything is built ---------------------------------------------
//
// The decision is here rather than in the manager so that it is a pure function of four facts and can
// be tried for real by a node test: the manager itself wants a physics world, a terrain, a catalogue
// and a renderer, which is most of the game to stand up for one call, and the rules below are exactly
// the ones that are worth being sure of -- that the same record arriving twice makes one creature,
// that a record for the world just left is never stood in the world just arrived in, and that a
// record that arrives before the catalogue has landed waits for it rather than being thrown away.

/** What standing a record comes to, before anything has been built. */
export type StandChoice =
  /** One of that name is already standing: the answer is the one already there. */
  | { do: 'already' }
  /** Not yet: the catalogue has not landed. The record is kept and stood the moment it does. */
  | { do: 'wait'; why: string }
  /** Never: the record is for another world, or is not a record at all, or names nothing known. */
  | { do: 'refuse'; why: string }
  /** Stand it, from these arguments and nothing else. */
  | { do: 'stand'; args: SpawnArgs };

/** The four facts the decision turns on, all of them the caller's to look up. */
export interface StandWhere {
  /** The world this browser is standing in. A record naming any other is refused. */
  world: string;
  /** Whether one of that name is already standing here. */
  standing: boolean;
  /** Whether the creature and NPC catalogue has landed yet. */
  catalogue: boolean;
  /** Whether the catalogue knows what the record says it is; not asked before the catalogue is here. */
  known: boolean;
}

/**
 * Said when a record turns up before the catalogue does, which is the ordinary case rather than a
 * rare one: the catalogue's one fetch is usually still in flight when the first planet loads, and
 * that is exactly when a server sends a browser the list of what stands in the world it has arrived
 * in. Such a record waits and is stood the moment the catalogue is here.
 */
export const WAITING_FOR_CATALOGUE = 'the creature and NPC catalogue has not landed yet; it stands as soon as it does';

/** What standing one record comes to. Pure: every fact it needs is in `at`. */
export function decideStand(rec: SpawnRecord, at: StandWhere): StandChoice {
  if (at.standing) return { do: 'already' };
  if (!recordFits(rec, at.world)) {
    const from = rec && typeof rec === 'object' && typeof rec.world === 'string' ? rec.world : '';
    if (from && from !== at.world) return { do: 'refuse', why: `that creature belongs to ${from}, and this is ${at.world}` };
    return { do: 'refuse', why: 'that is not a record this world can stand' };
  }
  if (!at.catalogue) return { do: 'wait', why: WAITING_FOR_CATALOGUE };
  if (!at.known) return { do: 'refuse', why: `nothing in the catalogue is called ${rec.species}` };
  return { do: 'stand', args: spawnArgsFor(rec) };
}

/** How many records may wait for the catalogue at once; a world's whole list is far inside this. */
export const PENDING_CAP = 1024;

/** One record waiting, with the world it was for: a trip must never stand the last world's creatures. */
export interface PendingSpawn {
  rec: SpawnRecord;
  world: string;
}

/**
 * The records that arrived before the catalogue did. It is a plain map keyed by the record's own
 * name, so the same record arriving twice while both are waiting is still one creature, and taking
 * one down before it has ever been stood forgets it rather than standing it a moment later.
 */
export class PendingSpawns {
  private readonly waiting = new Map<string, PendingSpawn>();
  /** How many may wait at once; written out rather than a parameter property, which node cannot strip. */
  private readonly cap: number;

  constructor(cap: number = PENDING_CAP) {
    this.cap = cap;
  }

  get size(): number {
    return this.waiting.size;
  }

  /** Keep one until the catalogue lands. One of the same name replaces it. False when there is no room. */
  add(rec: SpawnRecord, world: string): boolean {
    if (!rec || typeof rec.id !== 'string' || !rec.id) return false;
    if (!this.waiting.has(rec.id) && this.waiting.size >= this.cap) return false;
    this.waiting.set(rec.id, { rec, world });
    return true;
  }

  /** Forget one, because it was stood, refused, or taken down before it ever stood. */
  drop(id: string): boolean {
    return this.waiting.delete(id);
  }

  has(id: string): boolean {
    return this.waiting.has(id);
  }

  /** Everything waiting, in the order it arrived, with nothing left waiting afterwards. */
  take(): PendingSpawn[] {
    const out = [...this.waiting.values()];
    this.waiting.clear();
    return out;
  }

  clear(): void {
    this.waiting.clear();
  }
}

// ---- who may stand one at all -------------------------------------------------------------------

/**
 * The three questions the NPC tab's gate asks about a world whose creatures a server is holding. It
 * is the shape `WorldSpawns` in `src/ui/npcUi.ts` answers with, and it is declared here so that the
 * refusal below is pure and a node test can drive every branch of it.
 */
export interface WorldSpawnGate {
  /** Whether a server is holding the world's creatures at all. False offline and on the old relay. */
  shared(): boolean;
  /** Whether this browser may stand and take down what the world holds. */
  maySpawn(): boolean;
  /** Why not, in plain words. */
  why(): string;
}

/** Said to anyone who is not the world's admin, when the gate itself has nothing better to say. */
export const NOT_ADMIN = 'only the world’s admin may stand creatures here';

/**
 * Said on the machine rows above the catalogue that stand one of the world's own creatures: on a
 * shared world the same thing is stood from the catalogue below, where it goes over the wire and
 * everybody sees it, rather than here, where only this browser would.
 */
export const WORLD_HOLDS_IT = 'the world holds its creatures: stand this one from the catalogue below';

/**
 * Why this browser may not stand or take down one of the world's creatures, or '' when it may. It is
 * only ever a refusal of the world's: with no gate at all, or with one that leaves the creatures to
 * each browser, this is empty and nothing about the tab changes.
 */
export function spawnRefusal(w: WorldSpawnGate | null | undefined): string {
  if (!w || !w.shared()) return '';
  if (w.maySpawn()) return '';
  return w.why() || NOT_ADMIN;
}
