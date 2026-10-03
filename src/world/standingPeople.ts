// The people who stand somewhere and stay there.
//
// These are not the wildlife and the difference runs all the way through. A lair is a shape with a
// weighted list and a cap, and where its animals stand is drawn from a seed on this side because
// nobody knows where the server put them. A standing person is the opposite: every row is a real
// place the real server used, read out of its own screenplays, with its own facing and its own
// respawn in seconds. Nothing here is invented except how near you have to be, how many stand at
// once, how much nearer somebody must be to take another's place and how far one steps about its
// spot.
//
// **What a town's row says about the one standing there is the server's, and is kept.** Pack format 2
// says which rows the town stood with its brain off (`still`: they never wander) and which it made
// unattackable whatever body it drew (`peaceful`: part of the furniture), and each row's own creature
// carries its level, health, blow, temper, ranged attack, weapons and whether it may be struck. The
// body's catalogue entry is one creature's out of every one drawn as that body, so read alone it had a
// town's guards, jawas and trainers taking the tempers of whoever else once wore their bodies (the
// towns opened fire on anybody walking in), and all thirty-five kinds of Tusken from level 8 to 263
// stood as the level-8 child. So the row's own creature's numbers go on the body as overrides, its
// weapons are what it holds, and its mood is the idle it stands in.
//
// **Who stands at a row can be drawn, and is drawn again each life.** A town's stationary crowd names
// nobody: four in five from its commoners and one in five from its named people, as the server drew
// at each spawn; a dress group's creature (a commoner, a thug, an officer) is a whole pool of bodies;
// and a guard's row carries both sides, of which the side holding the world stands (`GCW_SIDES`,
// Imperial for a world nobody named, which is the server's rule for a neutral world). The converter
// drew the first life's person and body from each row's own key; a row killed and come back draws
// again from the same key and its count of lives, so the crowd changes as the server's did and every
// browser still agrees on it.
//
// **Half of them are indoors**, and that is the whole reason this is a file of its own rather than
// another branch of the wild pass. A row inside a building carries the room it stands in, and the
// converter has already carried its position and its facing out of that room's own frame into the
// snapshot's (`intoRoom` in `tools/swg/core3.mjs`; a pack written before the facing was carried faces
// everybody in a turned building off by that building's yaw, and `status` asks for it again); what is
// left is to stand it in the right cell, which a lair never has to do.
//
// **The rows are in the snapshot's frame and the world is not.** Every placed object goes through
// `LayoutStreamer`'s mirror -- `gx = -(x - centre.x)`, `gz = z - centre.z` -- and so do these, once,
// on the first pass that knows the layout's centre, with the heading negated beside them (a mirror
// in x turns a yaw into its negative). Until that was done every one of the 4,619 stood on the
// wrong side of its planet: outdoors on empty ground, and indoors nowhere at all, since a cantina's
// floor is not where its mirror image is. It escaped notice because the console's `go` walked the
// player to the same wrong spot and always found somebody standing there.
//
// Pure of three and of rapier: it asks the game for everything, so a node test can be the game.

import * as THREE from 'three';
import type { MobileCatalogue } from './mobiles/catalogue.ts';
import type { MobileEntry } from './mobiles/types.ts';
import type { Mobile } from './mobiles/mobile.ts';
import type { Post } from './mobiles/brain.ts';
import type { Aggression } from '../combat/kit.ts';
import { intoWorld, tuneTable } from './wildLife.ts';
import { roll } from './spawnSeed.ts';
import { SEATED_MOOD, moodOfRow } from './mobiles/moodIdle.ts';
import { Patrol, walksRound } from './patrols.ts';

/**
 * One person, as the converter wrote them: x and z in the snapshot's frame, as every placed object
 * is. The height is the snapshot's too, which is the world's, since the mirror is in x alone.
 */
export interface StandingRow {
  who: string;
  id: string;
  x: number;
  y: number;
  z: number;
  /** The way they face, `atan2(x, z)` in the snapshot's frame, indoors as well as out (see the head of this file). */
  heading: number;
  /** The emulator's own id for the cell, or 0 outdoors. Kept for the report, never resolved here. */
  cell: number;
  /** Which room of its building, where the converter could resolve it; absent outdoors. */
  room?: number | null;
  /**
   * Seconds before they come back. The data's own, and four in five of them are five minutes. **Nought
   * is never**: the server ran a body's timer only when it was above nought, so a row written with
   * nought (a bunker's boss, a trainer, an event's visitor) stays down once killed.
   */
  respawn: number;
  /** Which part of the world's life this is: a cave, a point of interest, a town, a dungeon. */
  where: string;
  /** Pack format 2: the town stood it with its brain off, so it never wanders from its spot. */
  still?: boolean;
  /** Pack format 2: the town made it unattackable whatever body it drew (its stationary crowd, its strolling patrols). */
  peaceful?: boolean;
  /** Pack format 2: what the row is known by, the same in every browser and every run whatever order the rows are in. */
  key?: string;
  /** Pack format 2: the mood the town stood it in, which is the idle it stands in (`moodIdle.ts`). */
  mood?: string;
  /** Pack format 2: a giver the server sat down (its `position = SIT`). */
  sit?: boolean;
  /** Pack format 2: the lists a row that names nobody draws its person from, each with its share. */
  draw?: [string, number][];
  /** Pack format 2: a town guard's two sides, the Imperial first, each with the body drawn for it and its own mood. */
  gcw?: { who: string; id?: string; mood?: string }[];
  /**
   * Pack format 2: the points a patroller walks, in the snapshot's frame (and carried into the world's
   * with the row); indoors a point carries its room. It stands at the first, and walks them later.
   */
  route?: { x: number; y: number; z: number; room?: number; linger?: boolean }[];
}

/**
 * What a creature the rows name is by its own numbers, out of the pack's fleet half: format 2's `game`
 * (its level, health, blow, temper, ranged attack and whether it may be struck), the default body it
 * stands as (`id`), every body it may stand as (`bodies`, a dress group's whole pool), and its weapons,
 * first and second, as the emulator wrote them. Read as data: every field is checked where it is used.
 */
export interface PeopleCreature {
  id?: unknown;
  game?: { level?: unknown; hp?: unknown; damage?: unknown; aggression?: unknown; ranged?: unknown; attackable?: unknown };
  bodies?: unknown;
  weapons?: unknown;
}

/** The rest of a world's pack a person is drawn from and armed out of. */
export interface PeopleExtras {
  /** The world, whose side holds its towns (`GCW_SIDES`). */
  world?: string;
  /** The towns' own lists a stationary row's person is drawn from, by name. */
  pools?: Readonly<Record<string, readonly string[]>> | null;
  /** The fleet's weapon groups: a group's name to its weapon templates. */
  weaponGroups?: Readonly<Record<string, readonly string[]>> | null;
}

const TEMPERS: readonly Aggression[] = ['passive', 'skittish', 'defensive', 'aggressive'];

/** Which side holds a world's towns, and so whose guards stand at their posts. */
export type GcwSide = 'imperial' | 'rebel';

/**
 * The side holding each world's towns, where somebody has said so: `__debug.people({ gcw: 'rebel' })`
 * for the world you are on. Every other world is Imperial, which is the server's own rule for a world
 * nobody holds (`city.lua`'s `spawnGcwMobiles` stands the Imperial row there), and the owner's (D2).
 */
export const GCW_SIDES: Record<string, GcwSide> = {};

/** The side standing a world's guards. */
export function gcwSideOf(world: string | undefined): GcwSide {
  return (world && Object.prototype.hasOwnProperty.call(GCW_SIDES, world) ? GCW_SIDES[world] : undefined) ?? 'imperial';
}

/** A body's own numbers over its body's, as a standing person is stood with them: `MobileSpawn.overrides`, spelt out. */
export interface PersonOverrides {
  aggression?: Aggression;
  hp?: number;
  damage?: number;
  level?: number;
  ranged?: { range: number; additive: boolean } | null;
}

/** How one person is stood, beyond the body and the place: everything the row and its creature say. */
export interface PersonSpawn {
  /** In a room, which changes how the ground is found. */
  inside: boolean;
  /** Its place in the pack's list: the world's name for it (`stood:<n>`), which no other row has. */
  index: number;
  /** The one number everything it rolls is drawn from: its key's, so it rolls the same whatever order the rows are in. */
  seed: number;
  /** Part of the furniture: the town made it so, or its own creature may not be struck. */
  essential: boolean;
  /** Its own creature's numbers over its body's; absent where the pack says nothing. */
  overrides?: PersonOverrides;
  /** The mood it stands in: its idle, where a species rig has a branch for it. */
  mood?: string;
  /** Its own creature's weapons, first and second, and the groups those names stand for. */
  weapons?: readonly string[];
  weaponGroups?: Readonly<Record<string, readonly string[]>> | null;
  /** The room of its building it stands in, where the data says: it seeds the body's cell. */
  room?: number;
}

/** Who stands at a row this time: the person, the body, the mood, and whether it is part of the furniture. */
export interface PersonPlan {
  who: string;
  id: string;
  mood: string | null;
  creature: PeopleCreature | null;
  /** Null where neither the row nor its creature says, and the body's own entry answers (`standsStill`). */
  essential: boolean | null;
}

/** What the plan needs besides the row: the fleet, the towns' lists, the side, and what bodies are already built. */
export interface PlanContext {
  creatures: Readonly<Record<string, PeopleCreature>> | null;
  pools: Readonly<Record<string, readonly string[]>> | null;
  side: GcwSide;
  /** Whether a body is already built and held by something standing; with none, nothing is reused. */
  holds?: (id: string) => boolean;
  /** The share of an unattackable crowd's draws that take a body already built (`PEOPLE_TUNE.reuseLook`). */
  reuse: number;
}

/**
 * The one number a row rolls everything from: its key's first eight hex figures where it has a key, so
 * a row reordered in the pack stands the same body the same way; its place in the list otherwise.
 */
export function seedOfRow(r: Pick<StandingRow, 'key'>, index: number): number {
  const k = r.key;
  if (typeof k === 'string' && /^[0-9a-f]{8}/i.test(k)) return parseInt(k.slice(0, 8), 16) >>> 0;
  if (typeof k === 'string' && k) {
    let h = 0x811c9dc5;
    for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }
  return index >>> 0;
}

/** The streams a row's draws come out of, one for each question and each life, so no draw moves another. */
const DRAW = { list: 11, who: 12, body: 13, reuse: 14, built: 15 } as const;

/** One draw for a row: a number from 0 up to but not including 1, from its seed, the question and its life. */
function drawOf(seed: number, what: number, life: number): number {
  return roll(seed, what + life * 32);
}

/** One of a list by a draw. */
function pick<T>(list: readonly T[], u: number): T {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))];
}

function has(creatures: PlanContext['creatures'], who: string): boolean {
  return !!creatures && Object.prototype.hasOwnProperty.call(creatures, who);
}

/** A creature's bodies as a list of names, or none. */
function bodiesOf(c: PeopleCreature | null): readonly string[] {
  return Array.isArray(c?.bodies) ? (c!.bodies as unknown[]).filter((b): b is string => typeof b === 'string' && !!b) : [];
}

/**
 * Who stands at a row this life, and as what body. Pure: the same row, life and context give the same
 * answer in every browser.
 *
 * A guard's row stands the side holding the world, or the other where that side has no body; a row
 * that names nobody keeps the person the converter drew for its first life and draws again from its
 * lists, by their shares, for every life after; everybody else is who the row says. The body is the
 * converter's for the first life of a row whose person did not change, and drawn again from the
 * creature's own bodies otherwise. An unattackable crowd's body is drawn, `reuse` of the time, from the
 * bodies already built and standing, which costs no model memory and needs no browser to agree with
 * another, since such a body is never shared.
 */
export function personFor(row: StandingRow, life: number, ctx: PlanContext): PersonPlan {
  const seed = seedOfRow(row, 0);
  let who = row.who;
  let id: string | null = row.id;
  let mood = moodOfRow(row);
  if (row.gcw?.length) {
    const want = ctx.side === 'rebel' ? 1 : 0;
    const order = want === 1 ? [1, 0] : [0, 1];
    for (const s of order) {
      const side = row.gcw[s];
      if (!side?.id || !has(ctx.creatures, side.who)) continue;
      who = side.who;
      id = side.id;
      mood = side.mood ?? mood;
      break;
    }
  } else if (row.draw?.length && life > 0) {
    const drawn = drawnPerson(row.draw, ctx, seed, life);
    if (drawn && drawn !== who) {
      who = drawn;
      id = null;
    }
  }
  const creature = has(ctx.creatures, who) ? ctx.creatures![who] : null;
  const peaceful = row.peaceful === true;
  const attackable = creature?.game && typeof creature.game.attackable === 'boolean' ? creature.game.attackable : null;
  const essential = peaceful ? true : attackable === null ? null : !attackable;
  const bodies = bodiesOf(creature);
  if (id === null || life > 0) {
    id = bodies.length ? pick(bodies, drawOf(seed, DRAW.body, life)) : typeof creature?.id === 'string' ? creature.id : row.id;
  }
  // An unattackable crowd leans on the bodies already standing (a commoner looks like the commoner
  // at the next table); somebody who may be fought is always the body drawn for them, so what one
  // browser fights is what every other would.
  if (essential === true && bodies.length > 1 && ctx.holds && drawOf(seed, DRAW.reuse, life) < ctx.reuse) {
    const built = bodies.filter((b) => ctx.holds!(b));
    if (built.length) id = pick(built, drawOf(seed, DRAW.built, life));
  }
  return { who, id: id!, mood, creature, essential };
}

/**
 * The person a row that names nobody stands in a life after its first: one of its lists by their
 * shares (four in five of a town's stationary people from its commoners), then one of that list's
 * names, both drawn from the row's seed and life. A list with nobody the fleet knows is passed over for
 * the next. Null when no list can.
 */
function drawnPerson(draw: readonly [string, number][], ctx: PlanContext, seed: number, life: number): string | null {
  const lists = draw.map(([pool, share]) => ({ names: (ctx.pools?.[pool] ?? []).filter((n) => has(ctx.creatures, n)), share: share > 0 ? share : 0 }));
  if (!lists.some((l) => l.names.length)) return null;
  const total = lists.reduce((a, l) => a + l.share, 0) || 1;
  let u = drawOf(seed, DRAW.list, life) * total;
  let at = lists.length - 1;
  for (let i = 0; i < lists.length; i++) {
    if (u < lists[i].share) {
      at = i;
      break;
    }
    u -= lists[i].share;
  }
  for (let k = 0; k < lists.length; k++) {
    const l = lists[(at + k) % lists.length];
    if (l.names.length) return pick(l.names, drawOf(seed, DRAW.who, life));
  }
  return null;
}

/**
 * A creature's own numbers as a body's overrides: only what its `game` says and says as the right kind
 * of thing, so a pack written by another converter can never stand a body with a word for its health.
 * Undefined when it says nothing at all. `ranged` null is a creature that does not shoot.
 */
export function overridesOf(c: PeopleCreature | null): PersonOverrides | undefined {
  const g = c?.game;
  if (!g) return undefined;
  const out: PersonOverrides = {};
  let any = false;
  if (TEMPERS.includes(g.aggression as Aggression)) {
    out.aggression = g.aggression as Aggression;
    any = true;
  }
  if (typeof g.hp === 'number' && Number.isFinite(g.hp) && g.hp > 0) {
    out.hp = g.hp;
    any = true;
  }
  if (typeof g.damage === 'number' && Number.isFinite(g.damage) && g.damage >= 0) {
    out.damage = g.damage;
    any = true;
  }
  if (typeof g.level === 'number' && Number.isFinite(g.level)) {
    out.level = g.level;
    any = true;
  }
  if (g.ranged === null) {
    out.ranged = null;
    any = true;
  } else if (g.ranged && typeof g.ranged === 'object') {
    const r = g.ranged as { range?: unknown; additive?: unknown };
    if (typeof r.range === 'number' && Number.isFinite(r.range) && r.range > 0) {
      out.ranged = { range: r.range, additive: r.additive === true };
      any = true;
    }
  }
  return any ? out : undefined;
}

/** A creature's weapons, first and second, as the words they are; none for a creature that names none. */
export function weaponsOf(c: PeopleCreature | null): readonly string[] | undefined {
  if (!Array.isArray(c?.weapons)) return undefined;
  const out = (c!.weapons as unknown[]).filter((w): w is string => typeof w === 'string' && !!w);
  return out.length ? out : undefined;
}

/**
 * Whether a standing person is part of the furniture: stands where they were stood, takes no
 * damage, never dies, never picks a fight and never wanders.
 *
 * **Read, not invented.** The emulator's own row carries the pvp status bitmask the server ran them
 * with, and a body with no ATTACKABLE bit is one no player could ever have struck: a vendor, a
 * trainer, a quest-giver, a shopkeeper. Measured over all 4,619 standing people in the game there
 * are exactly 518 of them, and the number matches `aggression: passive` one for one, which is two
 * independent fields of the same data agreeing.
 *
 * A catalogue built without a checkout carries no `core3` block at all; then nobody is essential and
 * every one of them behaves as they did before this existed, which is the honest default.
 */
export function standsStill(entry: MobileEntry | null | undefined): boolean {
  const pvp = entry?.stats?.core3?.pvp;
  if (!Array.isArray(pvp)) return false;
  return !pvp.some((bit) => /attackable/i.test(bit));
}

/** What standing people need of the game. */
export interface PeopleDeps {
  catalogue(): MobileCatalogue | null;
  /**
   * Stand one. `at` is in the world's own frame; `how` is everything the row and its own creature say
   * about it (`PersonSpawn`): in a room or not, part of the furniture or not (see `standsStill`), its
   * own numbers, mood, weapons and room.
   */
  spawn(entry: MobileEntry, at: { x: number; z: number; y?: number; heading?: number }, how: PersonSpawn): Mobile | string;
  remove(m: Mobile): void;
  /**
   * Whether the body a catalogue id names is already built and held by somebody standing. With it an
   * unattackable crowd leans on bodies already built (`PEOPLE_TUNE.reuseLook`); without it every body
   * is the one drawn for it.
   */
  holds?(id: string): boolean;
  /**
   * How many bytes the model memory budget is short of standing `entry` now (nought when it fits), and
   * how many putting a set of bodies down together would give back: `freeStart` begins a set, and
   * `frees(m)` puts `m` in it and answers what the whole set gives back so far. Counted together and
   * never added up body by body, since a model, a pack or a piece of a look that only the set holds
   * goes when the last of them does and is in none of their figures alone. All three or none: with them
   * a full budget is a reason to put somebody farther off down, as a full cap is; without them it
   * refuses as it did.
   */
  short?(entry: MobileEntry): number;
  freeStart?(): void;
  frees?(m: Mobile): number;
  /** The layout's centre, which the rows are measured from; null before the pack lands, and then nothing stands. */
  centre(): { x: number; z: number } | null;
  held(): boolean;
  /**
   * Whether the building a room belongs to is really built here yet, asked in the world's frame.
   *
   * A person stood in a cantina before its cell exists has no floor and falls through the world, so
   * the pass waits. Null where the game cannot say, which is taken as "yes" -- an outdoor world
   * with no streaming has no cells to wait for.
   */
  cellReady?(x: number, y: number, z: number): boolean | null;
  /**
   * Whether somebody else has the body for now: a person following the player, or one just asked to
   * stop and not yet handed back (`FollowerSet.holds`). Such a body is never put down by this pass -- not
   * for its distance, not to make room for somebody nearer, not for model memory, not for a change of the
   * side holding the towns -- and takes no place under either cap, though its row is still the row it
   * stands for, so a follower killed comes back at its post on the row's own clock as anybody else would.
   * With none wired nothing is held.
   */
  keeps?(m: Mobile): boolean;
}

/**
 * Every invented number here; everything else is the server's. Live through `__debug.people`.
 */
export const PEOPLE_TUNE = {
  /** Stood within this, put away past `drop`. Tighter than the lairs': a town is dense. */
  build: 110,
  drop: 190,
  /**
   * Most standing at once, nearest first, and most stood in one pass. `most` is the owner's number and
   * counts those who may be fought; `mostEssential` is the part of the furniture beside them, a cap of
   * its own (the owner's D3), since a vendor thinks nothing and costs only drawing, and one cantina
   * alone has forty-nine rows.
   */
  most: 40,
  mostEssential: 40,
  perPass: 3,
  /**
   * The share of an unattackable crowd's draws that take a body already built and standing rather than
   * the one drawn for them. Ours: it saves model memory in a crowded room, and needs no two browsers to
   * agree, since such a body is never shared.
   */
  reuseLook: 0.7,
  /**
   * With the cap full, how much nearer a row in range must be than the farthest person standing
   * before that person is put down to make room for it, metres. Without it the cap was nearest first
   * only for a player who stood still: people stood on the way in were kept until they were `drop`
   * behind, so walking into a town left the room you walked into empty while the street behind you
   * stood. The margin is what keeps two people at nearly the same distance from swapping places on
   * every pass as the player shuffles about.
   */
  swapMargin: 20,
  /** How often the pass runs, in seconds of the world's own clock. */
  everySeconds: 1.5,
  /** How far the player must move before it looks again. */
  moveMetres: 15,
  /**
   * How far a person may step about the spot the data put them on, metres, and how often, seconds.
   * The brain's own wander is eight to thirty metres every three to eight seconds, which is an animal
   * ranging over open ground; a person at a counter went walking off it into the street.
   */
  postRadius: 3,
  postEvery: [8, 20] as [number, number],
  /**
   * How far from its own row a patroller's first point may lie and still be where it stands, metres.
   * The server stood every patroller at its row and walked it to the points from there
   * (`CityScreenPlay:spawnPatrol`); standing it at the first point instead, as this game does, is the
   * same place on 308 of the 312 patrol rows the towns carry, and the other four are a script's slips (a
   * power droid on Talus whose first point has its sign turned, six kilometres off). Past this a
   * patroller stands at its own row, as the server stood it. Ours.
   */
  routeReach: 50,
  /**
   * Whether the dead come back at all. Off, a person killed stays killed for the life of the world,
   * whether or not the player walks away and back; on again, each comes back on its own clock. One
   * the game merely took away rather than killed comes back on its clock either way.
   */
  respawns: true,
};

/** Where a row's body stands, in the world's frame: the row's own spot, or a patroller's first point near it. */
export interface StandPlace {
  x: number;
  y: number;
  z: number;
  /** In a room, which changes how the ground is found. */
  inside: boolean;
  /** Which room, where it is in one and the data says. */
  room: number | undefined;
}

/**
 * Where a row's body stands: a patroller at the first point of its walk when that point lies within
 * `reach` of its own row (`PEOPLE_TUNE.routeReach`), everybody else, and a patroller whose first point
 * is a script's slip, at the row's own spot. Every distance the pass measures a row by -- whether it is
 * in range, which cap place it takes, whether it is dropped, what the console says -- is measured from
 * here, since this is where the body is.
 */
export function standPlaceOf(r: Pick<StandingRow, 'x' | 'y' | 'z' | 'cell' | 'room' | 'route'>, reach: number = PEOPLE_TUNE.routeReach): StandPlace {
  const first = r.route?.[0];
  if (first && Math.hypot(first.x - r.x, first.z - r.z) <= reach) return { x: first.x, y: first.y, z: first.z, inside: first.room !== undefined && first.room !== null, room: first.room ?? undefined };
  const inside = !!r.cell;
  return { x: r.x, y: r.y, z: r.z, inside, room: inside ? (r.room ?? undefined) : undefined };
}

interface Stood {
  row: StandingRow;
  /** Where its body stands (`standPlaceOf`). */
  stand: StandPlace;
  body: Mobile | null;
  /** When it died or was taken away, on the world's own clock; 0 while it is up. */
  diedAt: number;
  /**
   * Whether it was really killed, as against taken away by the game (fallen out of the world, say).
   * Only a kill is remembered while respawning is off: see the dead loop in `step`.
   */
  killed: boolean;
  /** Which cap it counts against: part of the furniture, or somebody who may be fought. */
  essential: boolean;
  /** Who it was stood as this life, and in what mood, for the console. */
  who: string;
  mood: string | null;
}

export class StandingPeople {
  private rows: StandingRow[] = [];
  /**
   * How many lives each row has had: a row killed and come back is its next life, which draws its
   * person and body again (`personFor`). Walking away and back is not a life; the same body stands.
   */
  private lives = new Uint16Array(0);
  /** The fleet's creatures and the rest of the pack a person is drawn from (`adopt`). */
  private creatures: Readonly<Record<string, PeopleCreature>> | null = null;
  private extras: PeopleExtras = {};
  /** What a pass plans each person with, kept and refilled rather than made per pass. */
  private readonly plan: PlanContext = { creatures: null, pools: null, side: 'imperial', reuse: PEOPLE_TUNE.reuseLook };
  /** The game the pass was last given, and the one arrow that asks it what is built. */
  private holdsVia: PeopleDeps | null = null;
  private readonly holdsOf = (id: string): boolean => !!this.holdsVia?.holds?.(id);
  /** Whether the rows have been carried into the world's frame yet (see the head of this file). */
  private framed = false;
  /** Where each row's body stands, in the world's frame: made with the frame, and again when `routeReach` moves. */
  private stands: StandPlace[] = [];
  private readonly up = new Map<number, Stood>();
  private since = 0;
  private readonly lastAt = new THREE.Vector3(NaN, NaN, NaN);
  /**
   * The rows in range this pass and how far each is, kept rather than made per pass, and the one
   * comparator that sorts them: the cap is filled nearest first, not in the file's order, which had
   * forty people standing fifty to seventy metres off while the ones beside the player never stood.
   */
  private readonly near: number[] = [];
  private away = new Float64Array(0);
  private readonly nearer = (a: number, b: number): number => this.away[a] - this.away[b];
  private readonly farther = (a: number, b: number): number => this.away[b] - this.away[a];
  /** Kept lists for making room in the memory budget (`makeMemory`): who could go, and who does. */
  private readonly spare: number[] = [];
  private readonly chosen: number[] = [];
  /**
   * `up` is the bodies standing, `down` the dead waiting to come back; `stood`, `dropped`, `swapped`
   * (put down to make room for somebody nearer) and `waiting` are what the last pass that really ran
   * did, and are left alone by a step that returns before it looks -- reset at the top of every
   * step, they read nought almost always.
   *
   * `short` is how many rows that pass could not stand for want of model memory with nobody of their
   * own farther off to give it back, and `shortBytes` the least of what those rows were short by: what
   * the people of ours are asked to give back (`src/world/ambient/`), since whatever covers the least of
   * them stands somebody of the data's on the next pass. `pass` counts the passes that really ran and is
   * never reset, so a shortfall is answered once and not once for every time it is read.
   */
  readonly last = { rows: 0, up: 0, down: 0, indoors: 0, stood: 0, dropped: 0, swapped: 0, waiting: 0, refused: '', essential: 0, short: 0, shortBytes: 0, pass: 0 };

  get ready(): boolean {
    return this.rows.length > 0;
  }

  /**
   * Take the rows a pack carries. Only those that reach a body, and only those really placed. Each
   * is copied, since the pass carries its own into the world's frame and the pack's are left as the
   * pack wrote them.
   *
   * `creatures` is the pack's fleet half, where each row's own creature carries its numbers, its
   * bodies and its weapons (format 2); a row whose creature says nothing stands as its body does.
   * `extras` is the rest: the world (whose side holds its towns), the towns' own lists and the
   * weapon groups.
   */
  adopt(rows: readonly StandingRow[] | null | undefined, creatures?: Readonly<Record<string, PeopleCreature>> | null, extras?: PeopleExtras | null): void {
    this.rows = [];
    this.up.clear();
    this.framed = false;
    this.stands = [];
    this.creatures = creatures ?? null;
    this.extras = extras ?? {};
    for (const r of rows ?? []) {
      // A row indoors whose room could not be resolved is a position in a cell and nowhere on a
      // planet: the converter leaves those out, and this refuses any that slip through.
      if (r.cell && (r.room === null || r.room === undefined)) continue;
      // Copied, and its route with it: the pass carries both into the world's frame.
      const row: StandingRow = { ...r };
      if (r.route) row.route = r.route.map((p) => ({ ...p }));
      this.rows.push(row);
    }
    this.lives = new Uint16Array(this.rows.length);
    this.away = new Float64Array(this.rows.length);
    this.near.length = 0;
    this.lastAt.set(NaN, NaN, NaN);
    this.last.rows = this.rows.length;
    this.last.up = 0;
    this.last.down = 0;
  }

  clear(deps?: PeopleDeps): void {
    if (deps) for (const s of this.up.values()) if (s.body) deps.remove(s.body);
    this.up.clear();
    this.last.up = 0;
    this.last.down = 0;
    this.last.indoors = 0;
    this.last.essential = 0;
    this.last.short = 0;
    this.last.shortBytes = 0;
  }

  unload(): void {
    this.rows = [];
    this.framed = false;
    this.stands = [];
    this.up.clear();
    this.creatures = null;
    this.extras = {};
    this.lives = new Uint16Array(0);
    this.away = new Float64Array(0);
    this.near.length = 0;
    this.last.rows = 0;
    this.last.up = 0;
    this.last.down = 0;
    this.last.indoors = 0;
    this.last.essential = 0;
    this.last.short = 0;
    this.last.shortBytes = 0;
  }

  /** Every row carried into the world's frame, once: the mirror every placed object goes through, its route's points with it. */
  private frame(centre: { x: number; z: number }): void {
    for (const r of this.rows) {
      const w = intoWorld(r.x, r.z, centre);
      r.x = w.x;
      r.z = w.z;
      r.heading = -r.heading;
      for (const p of r.route ?? []) {
        const q = intoWorld(p.x, p.z, centre);
        p.x = q.x;
        p.z = q.z;
      }
    }
    this.framed = true;
    this.placeStands();
  }

  /** Where every row's body stands, once the rows are in the world's frame (`standPlaceOf`). */
  private placeStands(): void {
    this.stands = this.rows.map((r) => standPlaceOf(r));
  }

  /**
   * One pass.
   *
   * `now` is the world's own clock, which every respawn keys off, so `__debug.advance` drives it.
   */
  step(dt: number, now: number, at: THREE.Vector3, deps: PeopleDeps, force = false): void {
    if (!this.ready || (deps.held() && !force)) return;
    const cat = deps.catalogue();
    if (!cat) return;
    const centre = deps.centre();
    if (!centre) return;
    if (!this.framed) this.frame(centre);
    this.since += dt;
    const moved = force || !Number.isFinite(this.lastAt.x) || this.lastAt.distanceTo(at) > PEOPLE_TUNE.moveMetres;
    if (this.since < PEOPLE_TUNE.everySeconds && !moved) return;
    this.since = 0;
    this.lastAt.copy(at);
    this.last.stood = 0;
    this.last.dropped = 0;
    this.last.swapped = 0;
    this.last.waiting = 0;
    this.last.short = 0;
    this.last.shortBytes = 0;
    this.last.pass++;

    // The dead first, so a place somebody cleared fills again on its own time.
    for (const [i, s] of this.up) {
      // **The clock is checked whether or not the body is still here.** Nulling it and then skipping
      // the rest of the loop on a null body is how a dead row waits for ever: the first pass takes
      // the body away, and every pass after that steps over the very record it is waiting on.
      if (s.body && (s.body.dead || s.body.removed)) {
        // **Killed is not the same as taken away**, and `dead` alone cannot tell them apart: disposing
        // a mobile sets `dead` too, so a body the game took away (fallen out of the world, say) reads
        // exactly like one somebody fought. The corpse does: a body really killed is dead and still in
        // the world for its death clip and its timer, which is far longer than a pass, while one taken
        // away is dead and gone in the same instant (`WildLife.reap` reads it the same way). Both come
        // back once the row's own wait is out, which is the server's number; only a kill is kept down
        // while respawning is off, or a person the game merely lost would stay lost for good.
        if (s.diedAt === 0) {
          s.diedAt = now;
          s.killed = !s.body.removed;
        }
        s.body = null;
      }
      if (s.diedAt > 0 && !staysDown(s) && now - s.diedAt >= Math.max(1, s.row.respawn)) {
        // Somebody killed comes back as the row's next life, which draws its person and its body
        // again; one the game merely took away comes back as it was.
        if (s.killed && this.lives[i] < 0xffff) this.lives[i]++;
        this.up.delete(i);
      }
    }

    // Then who is too far off to keep, and who is near enough to stand.
    const near = this.near;
    near.length = 0;
    for (let i = 0; i < this.rows.length; i++) {
      // Measured from where the body stands, which for a patroller is the first point of its walk.
      const st = this.stands[i];
      const away = Math.hypot(st.x - at.x, st.z - at.z);
      this.away[i] = away;
      const here = this.up.get(i);
      if (here) {
        // Past `drop` everyone goes. Nearer than that a body is only ever put down to make room for
        // somebody nearer still, and never one in a fight (`farthestFree`): somebody you are
        // fighting does not vanish. Nor, at any distance, one somebody else has for now (`keeps`): a
        // follower walks with the player and is as far from its own row as they are.
        if (away > PEOPLE_TUNE.drop && !(here.body && deps.keeps?.(here.body))) {
          if (here.body) {
            deps.remove(here.body);
            this.last.dropped++;
          }
          // Somebody killed who stays down (respawning off, or a row that never came back) is
          // remembered however far the player goes, or walking away and back would be a respawn by
          // another name.
          if (staysDown(here)) here.body = null;
          else this.up.delete(i);
        }
        continue;
      }
      if (away <= PEOPLE_TUNE.build) near.push(i);
    }
    near.sort(this.nearer);

    // Two caps, counted apart (`most` and `mostEssential`): those who may be fought, and the furniture.
    // Nobody somebody else has for now (`keeps`) is counted against either: a follower walks with the
    // player wherever they go and is no part of the crowd round them, so it takes nobody's place.
    let liveFought = 0;
    let liveKept = 0;
    for (const s of this.up.values()) {
      if (!s.body || deps.keeps?.(s.body)) continue;
      if (s.essential) liveKept++;
      else liveFought++;
    }
    // A cap that found nobody to take the place of is full for the rest of this pass: the rows are
    // nearest first, so every later row of that kind would find nobody too.
    let fullFought = false;
    let fullKept = false;
    const plan = this.plan;
    plan.creatures = this.creatures;
    plan.pools = this.extras.pools ?? null;
    plan.side = gcwSideOf(this.extras.world);
    plan.reuse = PEOPLE_TUNE.reuseLook;
    this.holdsVia = deps;
    plan.holds = deps.holds ? this.holdsOf : undefined;
    let stood = 0;
    for (const i of near) {
      // Three a pass in play, so walking into a town brings them a few at a time and nothing
      // compiles in a lump on a live frame. Behind the loading screen that is exactly backwards --
      // there is no live frame to spare and the whole point is to have them standing before it lifts
      // -- so a forced pass stands everything in range at once and the warm-up compiles the lot.
      if (!force && stood >= PEOPLE_TUNE.perPass) break;
      if (fullFought && fullKept) break;
      const r = this.rows[i];
      // Where the body stands: a patroller at the first point of its walk, near where the town stood
      // it (it walks the rest later), everybody else at the row's own spot (`standPlaceOf`).
      const st = this.stands[i];
      const inside = st.inside;
      // A person in a room whose building is not built yet waits rather than falling through it.
      if (inside && deps.cellReady?.(st.x, st.y, st.z) === false) {
        this.last.waiting++;
        continue;
      }
      const who = personFor(r, this.lives[i], plan);
      const entry = cat.byId(who.id);
      if (!entry) continue;
      // Part of the furniture when the town made it so whatever body it drew, or when its own creature
      // may not be struck; its body's catalogue entry answers only for a row whose creature says nothing.
      const essential = who.essential ?? standsStill(entry);
      if (essential ? fullKept : fullFought) continue;
      // **The cap full, the farthest standing of the same kind makes room**, if it is enough farther
      // off than this row and in no fight. Found before this one is stood and put down only once it
      // has been, so a refusal never costs anybody their place. And decided **before** the memory is:
      // with two caps, a row whose own cap was full with nobody of its kind to replace used to put
      // farther people of the other kind down for model memory first and then not be stood, and those
      // people stood again on the next pass and were put down again on the one after, for as long as
      // the player stood in a crowded town.
      const cap = essential ? PEOPLE_TUNE.mostEssential : PEOPLE_TUNE.most;
      let makeRoom = -1;
      if ((essential ? liveKept : liveFought) >= cap) {
        makeRoom = this.farthestFree(this.away[i] + PEOPLE_TUNE.swapMargin, essential, deps);
        if (makeRoom < 0) {
          if (essential) fullKept = true;
          else fullFought = true;
          continue;
        }
      }
      // **The model memory budget full, the farthest standing make room too**, as they do for the cap:
      // people farther off than this row by the margin and in no fight, farthest first -- the one the cap
      // is putting down for it anyway before any other -- and only as many as give back what this one
      // needs. Nobody at all when all of them together would not: a row that cannot fit would otherwise
      // put people down for nothing on every pass, and they would stand again behind it. Without this a
      // crowd stood on the way in held the budget and every nearer person, the cantina's whole room
      // among them, was refused for as long as it stood.
      const short = deps.short?.(entry) ?? 0;
      // Short of memory with nobody of its own farther off to give it back: counted, with the least any
      // such row was short by, for the people of ours, who stand only in what the data's own leave and
      // give it back when these are short.
      if (short > 0 && this.makeMemory(i, short, deps, makeRoom) === 0) {
        this.last.short++;
        if (!(this.last.shortBytes > 0) || short < this.last.shortBytes) this.last.shortBytes = short;
      } else if (short > 0) {
        liveFought = 0;
        liveKept = 0;
        for (const s of this.up.values()) {
          if (!s.body || deps.keeps?.(s.body)) continue;
          if (s.essential) liveKept++;
          else liveFought++;
        }
        // The one the cap was to put down went for memory, or somebody of its kind did: its cap has
        // room now, and nobody more is put down for it.
        if (makeRoom >= 0 && (!this.up.has(makeRoom) || (essential ? liveKept : liveFought) < cap)) makeRoom = -1;
      }
      // Indoors the height is the floor's and is given, because the converter worked it out from the
      // room's own frame and the manager's own ground lookup would find the terrain under the
      // building instead. Outdoors no height is given, for the reason the wildlife learned.
      const spot = inside ? { x: st.x, z: st.z, y: st.y, heading: r.heading } : { x: st.x, z: st.z, heading: r.heading };
      const room = inside ? st.room : undefined;
      // Its own creature's numbers, weapons and mood go with it, since the body's are some other
      // creature's (a level-8 child for every Tusken there is).
      const m = deps.spawn(entry, spot, {
        inside,
        index: i,
        seed: seedOfRow(r, i),
        essential,
        overrides: overridesOf(who.creature),
        mood: who.mood ?? undefined,
        weapons: weaponsOf(who.creature),
        weaponGroups: this.extras.weaponGroups ?? null,
        room,
      });
      if (typeof m === 'string') {
        this.last.refused = m;
        continue;
      }
      if (makeRoom >= 0) {
        const out = this.up.get(makeRoom);
        if (out?.body) deps.remove(out.body);
        this.up.delete(makeRoom);
        if (essential) liveKept--;
        else liveFought--;
        this.last.swapped++;
      }
      // They stand where they were put. A person placed by the server is not a wanderer: their home
      // is their own spot, and their post keeps them on it (`keepPost`) rather than roaming the
      // street the way the brain roams an animal about its range.
      m.homeX = st.x;
      m.homeZ = st.z;
      m.post = postFor(r, who.mood);
      // A town's walker walks its round from the first point, where it was stood, on the server's own
      // clock (`patrols.ts`); its post is kept beside it for the console and nothing reads it.
      m.patrol = patrolFor(r, st, now);
      this.up.set(i, { row: r, stand: st, body: m, diedAt: 0, killed: false, essential, who: who.who, mood: who.mood });
      stood++;
      if (essential) liveKept++;
      else liveFought++;
      this.last.stood++;
    }
    this.count(deps);
  }

  /**
   * Put down, farthest first, the fewest people farther than row `i` by the margin and in no fight who
   * between them give back `short` bytes of the model memory budget, and answer how many. `first` is the
   * one the cap is putting down for this row anyway (`farthestFree`), or -1: it is counted before anybody
   * else, since it goes whatever happens and what it gives back is memory nobody more need be put down
   * for. What they give back is asked of the set as it grows (`PeopleDeps.frees`) and never added up body
   * by body: two far people of one species give back that species' body only together, and neither of
   * them alone. Once the set is enough, anybody the rest cover without is let stay after all, the nearest
   * tried first and the one the cap is putting down last (it goes after the stand in any case, and the
   * others would not). Nought, with nobody put down, when all of them together would not. Uses the kept
   * scratch lists, so a pass that makes room allocates nothing.
   */
  private makeMemory(i: number, short: number, deps: PeopleDeps, first = -1): number {
    if (!deps.frees || !deps.freeStart) return 0;
    const beyond = this.away[i] + PEOPLE_TUNE.swapMargin;
    const c = this.spare;
    c.length = 0;
    for (const [k, s] of this.up) {
      const b = s.body;
      if (k === first || !b || b.dead || b.removed || b.engaged || this.away[k] <= beyond || deps.keeps?.(b)) continue;
      c.push(k);
    }
    c.sort(this.farther);
    const chosen = this.chosen;
    chosen.length = 0;
    deps.freeStart();
    let got = 0;
    const lead = first >= 0 ? this.up.get(first)?.body : null;
    if (lead) {
      chosen.push(first);
      got = deps.frees(lead);
    }
    for (const k of c) {
      if (got >= short) break;
      chosen.push(k);
      got = deps.frees(this.up.get(k)!.body!);
    }
    if (got < short) return 0;
    // Everybody the rest cover without stays, asked of the set without them.
    for (let j = chosen.length - 1; j >= 0; j--) {
      deps.freeStart();
      let without = 0;
      for (let t = 0; t < chosen.length; t++) if (t !== j) without = deps.frees(this.up.get(chosen[t])!.body!);
      if (without < short) continue;
      for (let t = j; t < chosen.length - 1; t++) chosen[t] = chosen[t + 1];
      chosen.length--;
    }
    for (const k of chosen) {
      const s = this.up.get(k)!;
      if (s.body) deps.remove(s.body);
      this.up.delete(k);
      this.last.swapped++;
    }
    return chosen.length;
  }

  /**
   * The row of the farthest person standing past `beyond` who may be put down to make room for one of
   * the same kind (`essential`, since the two kinds have caps of their own): alive, and in no fight and
   * holding no grudge (`Mobile.engaged`), and nobody somebody else has for now (`PeopleDeps.keeps`). -1
   * for nobody. Walks the eighty standing and allocates nothing but the loop's own entries, once per
   * person a full pass stands.
   */
  private farthestFree(beyond: number, essential: boolean, deps?: PeopleDeps): number {
    let best = -1;
    let bestAway = beyond;
    for (const [k, s] of this.up) {
      const b = s.body;
      if (!b || b.dead || b.removed || b.engaged || s.essential !== essential || deps?.keeps?.(b)) continue;
      const away = this.away[k];
      if (away > bestAway) {
        bestAway = away;
        best = k;
      }
    }
    return best;
  }

  /**
   * The pass's own counts. `essential` is the furniture's cap as the pass counted it, which is what the
   * people of ours stand in the rest of (`essentialUp`), so a body somebody else has for now takes no
   * place there either.
   */
  private count(deps?: PeopleDeps): void {
    let up = 0;
    let down = 0;
    let inside = 0;
    let essential = 0;
    for (const s of this.up.values()) {
      if (s.body) up++;
      else down++;
      if (s.body && s.stand.inside) inside++;
      if (s.body && s.essential && !deps?.keeps?.(s.body)) essential++;
    }
    this.last.up = up;
    this.last.down = down;
    this.last.indoors = inside;
    this.last.essential = essential;
  }

  // ---- what the people of ours ask of the data's (`src/world/ambient/`) ------------------------------

  /**
   * How many places of the cap on part-of-the-furniture people the data's own are standing in: the
   * people of ours stand only in what is left, after the data's own rows (the design's W6).
   */
  get essentialUp(): number {
    return this.last.essential;
  }

  /**
   * The lists the stationary crowd of the town nearest a point draws its people from, with their
   * shares -- four in five from its commoners and one in five from its named people, the server's own
   * split -- or null where no town on this world has any (a world the emulator never populated). The
   * row nearest the point that names nobody and draws from a town's stationary lists says which town
   * that is. Asked once a port and once a building.
   */
  townDraw(x: number, z: number): [string, number][] | null {
    if (!this.framed) return null;
    let best: [string, number][] | null = null;
    let bestD = Infinity;
    for (const r of this.rows) {
      const d = r.draw;
      if (!d?.length || !d.some(([pool]) => /stationary/i.test(pool))) continue;
      const away = Math.hypot(r.x - x, r.z - z);
      if (away >= bestD) continue;
      bestD = away;
      best = d;
    }
    return best;
  }

  /**
   * Somebody out of a town's own lists, drawn as a row that names nobody draws its person for a life
   * after its first (`personFor`): the list by its share, a name on it, and a body out of that
   * creature's own, leaning on the bodies already built (`reuseLook`) since nobody of ours is ever
   * fought or shared. The same draw, seed and life give the same person wherever the same bodies are
   * built. Null where the lists name nobody the fleet knows.
   */
  drawPerson(draw: readonly [string, number][], seed: number, life: number, deps: PeopleDeps, reuse: number = PEOPLE_TUNE.reuseLook): PersonPlan | null {
    const plan = this.plan;
    plan.creatures = this.creatures;
    plan.pools = this.extras.pools ?? null;
    plan.side = gcwSideOf(this.extras.world);
    plan.reuse = reuse;
    this.holdsVia = deps;
    plan.holds = deps.holds ? this.holdsOf : undefined;
    const row: StandingRow = { who: '', id: '', x: 0, y: 0, z: 0, heading: 0, cell: 0, respawn: 0, where: 'ours', peaceful: true, draw: draw as [string, number][], key: (seed >>> 0).toString(16).padStart(8, '0') };
    const who = personFor(row, Math.max(1, life), plan);
    return who.who ? who : null;
  }

  /**
   * Whether any of the data's own people stands where `inside` says, among the rows within `reach` of a
   * point: what says a building is the data's and not one of ours to fill. Measured from where each
   * row's body stands (`standPlaceOf`). False before the rows are in the world's frame.
   */
  anyStanding(x: number, z: number, reach: number, inside: (st: StandPlace) => boolean): boolean {
    if (!this.framed) return false;
    for (const st of this.stands) {
      if (Math.abs(st.x - x) > reach || Math.abs(st.z - z) > reach) continue;
      if (inside(st)) return true;
    }
    return false;
  }

  /** Whether the rows have been carried into the world's frame yet, which everything the people of ours ask needs. */
  get inWorld(): boolean {
    return this.framed;
  }

  /**
   * Whether the dead come back. Turned on again, every one already waiting comes back once its own
   * clock is out, which for somebody killed long ago is on the next pass.
   */
  setRespawns(on: boolean): void {
    PEOPLE_TUNE.respawns = on;
  }

  /**
   * Move any of the numbers above, live; answers which it moved. A number, a pair or a switch is
   * only ever replaced by one of its own kind, so a console typo cannot turn the cap into a word.
   */
  retune(t: Record<string, unknown>): string[] {
    const moved = tuneTable(PEOPLE_TUNE, t);
    // Where a patroller stands is worked out once with the frame; moved, it is worked out again, and
    // everybody not yet standing is measured from where they would now stand.
    if (moved.includes('routeReach') && this.framed) this.placeStands();
    return moved;
  }

  /**
   * Which side holds this world's towns, and so whose guards stand; answers the side in force. The
   * guards standing now are put down so the next pass stands the other side's (`deps`, when given).
   */
  setSide(side: GcwSide, deps?: PeopleDeps): GcwSide {
    const world = this.extras.world;
    if (world && (side === 'imperial' || side === 'rebel') && gcwSideOf(world) !== side) {
      GCW_SIDES[world] = side;
      if (deps) {
        for (const [i, s] of this.up) {
          // A guard following the player goes on following on the side it took; its row stands the other
          // side's the next time it is stood, once the body it has now is killed or put down for distance.
          if (!s.row.gcw || !s.body || deps.keeps?.(s.body)) continue;
          deps.remove(s.body);
          this.up.delete(i);
        }
        this.lastAt.set(NaN, NaN, NaN);
      }
    }
    return gcwSideOf(world);
  }

  /** The world these rows are for, as the pack named it: the key its side is kept under. */
  get world(): string {
    return this.extras.world ?? '';
  }

  /** The side holding this world's towns, whose guards stand. */
  get side(): GcwSide {
    return gcwSideOf(this.extras.world);
  }

  /**
   * For the console: who is standing, nearest first, in the world's own frame. `where` keeps the rows
   * of one part of the world's life (`cities`, `caves`, `tasks`, `poi`...). Each says who it was stood
   * as this life, its body, the mood it was asked for and the idle it really stands in (a lent branch is
   * `idle:<mood>`, its own pack's idle where the rig had none), what it holds, its level and whether it
   * is part of the furniture.
   */
  report(at: THREE.Vector3, where?: string): PersonReport[] {
    const out: PersonReport[] = [];
    for (const s of this.up.values()) {
      if (where && s.row.where !== where) continue;
      const b = s.body;
      out.push({
        who: s.who,
        id: b?.entry?.id ?? null,
        where: s.row.where,
        room: s.stand.inside ? (s.stand.room ?? null) : null,
        away: Math.round(Math.hypot(s.stand.x - at.x, s.stand.z - at.z)),
        up: !!b,
        dead: s.killed,
        mood: s.mood,
        idle: b?.roles?.idle ?? null,
        holding: b?.weapon ?? null,
        level: b?.level ?? null,
        essential: s.essential,
        post: postFor(s.row, s.mood).kind,
      });
    }
    return out.sort((a, b) => a.away - b.away);
  }

  /**
   * For the console: the rows nearest a point whose body walks a round (`patrolFor`'s rule), standing or
   * not, each where it stands -- the first point of its round -- with how many points the round has and
   * how many of them are lingered at. Nothing until a pass has known the layout's centre.
   */
  walkers(at: THREE.Vector3, n = 5): WalkerRow[] {
    if (!this.framed) return [];
    const out: WalkerRow[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const st = this.stands[i];
      const first = r.route?.[0];
      if (!first || !walksRound(r.route, first.x === st.x && first.z === st.z, r.peaceful === true)) continue;
      out.push({
        who: r.who,
        x: Math.round(st.x * 10) / 10,
        y: Math.round(st.y * 10) / 10,
        z: Math.round(st.z * 10) / 10,
        indoors: st.inside,
        room: st.inside ? (st.room ?? null) : null,
        points: r.route!.length,
        lingers: r.route!.filter((p) => p.linger).length,
        away: Math.round(Math.hypot(st.x - at.x, st.z - at.z)),
        up: !!this.up.get(i)?.body,
      });
    }
    return out.sort((a, b) => a.away - b.away).slice(0, n);
  }

  /**
   * For the console: the rows nearest a point, standing or not, in the world's own frame, each where
   * its body stands (`standPlaceOf`: a patroller at the first point of its walk), which is where `go`
   * takes the player. Nothing until a pass has known the layout's centre, since before that a row is a
   * number in another frame.
   */
  nearest(at: THREE.Vector3, n = 5): { who: string; where: string; x: number; y: number; z: number; heading: number; indoors: boolean; room: number | null; away: number; up: boolean }[] {
    if (!this.framed) return [];
    return this.rows
      .map((r, i) => {
        const st = this.stands[i];
        return {
          who: r.who,
          where: r.where,
          x: Math.round(st.x * 10) / 10,
          y: Math.round(st.y * 10) / 10,
          z: Math.round(st.z * 10) / 10,
          heading: Math.round(r.heading * 1000) / 1000,
          indoors: st.inside,
          room: st.inside ? (st.room ?? null) : null,
          away: Math.round(Math.hypot(st.x - at.x, st.z - at.z)),
          up: !!this.up.get(i)?.body,
        };
      })
      .sort((a, b) => a.away - b.away)
      .slice(0, n);
  }
}

/** One row that walks a round, as the console reads it (`StandingPeople.walkers`). */
export interface WalkerRow {
  who: string;
  x: number;
  y: number;
  z: number;
  indoors: boolean;
  room: number | null;
  points: number;
  lingers: number;
  away: number;
  up: boolean;
}

/** One person standing, as the console reads it (`StandingPeople.report`). */
export interface PersonReport {
  who: string;
  id: string | null;
  where: string;
  room: number | null;
  away: number;
  up: boolean;
  dead: boolean;
  mood: string | null;
  idle: string | null;
  holding: string | null;
  level: number | null;
  essential: boolean;
  post: 'still' | 'near';
}

/**
 * The post a row stands at: `still` for one the town stood with its brain switched off (its named
 * people and its guards, which the server never let wander and walked home after a fight), and for
 * one posed off its feet (sat at a table, on the ground, in a chair: a giver the server sat down),
 * who would otherwise get up and stroll about in a sitting pose; `near` for everyone else, who steps
 * about their spot.
 */
export function postFor(r: Pick<StandingRow, 'still' | 'sit' | 'heading'>, mood?: string | null): Post {
  const seated = !!mood && SEATED_MOOD.test(mood);
  return { kind: r.still || r.sit || seated ? 'still' : 'near', heading: r.heading, tune: PEOPLE_TUNE };
}

/**
 * The round a row's body walks, or null: a round of two points or more that it was stood at the start
 * of (`standPlaceOf` put it on the first point rather than at its own row), walked by a walker the town
 * made unattackable and, only with `PATROL_TUNE.combat`, by one of its combat walkers too
 * (`walksRound`). Made when the body is stood, so its clock starts then.
 */
export function patrolFor(r: Pick<StandingRow, 'route' | 'peaceful'>, st: Pick<StandPlace, 'x' | 'z'>, now: number, rand: () => number = Math.random): Patrol | null {
  const first = r.route?.[0];
  const atFirst = !!first && first.x === st.x && first.z === st.z;
  return walksRound(r.route, atFirst, r.peaceful === true) ? new Patrol(r.route!, now, rand) : null;
}

/**
 * Whether somebody killed stays down rather than coming back on their clock: while respawning is
 * switched off, and always for a row the server wrote with a respawn of nought, which it never brought
 * back. One the game merely took away (fallen out of the world) is never kept down.
 */
function staysDown(s: Stood): boolean {
  return s.killed && (!PEOPLE_TUNE.respawns || !(s.row.respawn > 0));
}

/** The one for the session. */
export const standingPeople = new StandingPeople();
