// The story's detectors: what the player did that a job may be waiting on, worked out four times a second
// and handed to whoever holds the story as an event. They watch only what the story's view lists
// (`Watch` in `src/story/view.ts`), so a world with no job running asks nothing at all.
//
// **Level, not edge.** An arrival, a room, an area and a world are raised again every `repeatEv` while they
// stay true, so an event dropped while nobody could take it (a server's line that was coming back) costs
// nothing that is still true when somebody can; a kill is not, since a kill happens once. The step machine
// counts nothing twice for it: a goto is done once, an observe step's watch is opened once, and a signal
// nobody is waiting on when it comes is not kept. Leaving an area is said once, on the edge, because
// said while it stays true it would be said for every area of the world the player is not in.
//
// **Frames.** A planet's places are in the raw (snapshot) frame, which is what the story's files are
// written in; a space zone's in its own game frame. The wiring hands the player's place in the frame of the
// world they stand on (`WatchPlace`), from `player.worldPos` and never `player.pos`, which is the hull's
// frame aboard a ship.
//
// **Rooms.** A room is the building's template and the cell's own name, as the models name their cells
// (`cantina`, `foyer1`), and its signal is `room:<template>#<cell>`. Cell 0 is the world outside, and not a
// room.
//
// **Going somewhere else.** A travel, a death and a step onto another world all take the player out of
// every area they stood in, and that is said (`leaveAll`) before anything forgets them: an observe step's
// watch is closed by the word of leaving and by nothing else, so an area forgotten in silence would go on
// counting on the far side of a shuttle trip and finish the step there. Only the select screen forgets
// without a word, because the host closes every watch itself when the character leaves the world.
//
// **Kills.** A death the player is credited with comes from two places: a blow of the player's own that
// finished a body this browser keeps (`World.watchPlayerHits`), and the server's word of a death that names
// this browser's player among those who struck (a body another browser keeps, whose death is invisible
// here otherwise). The same body is one kill however many of them say so within `killDedupe`, which is
// why both are keyed by one function (`killKey`) rather than each by its own idea of the body's name.
//
// Pure: nothing here touches the world, the page or three, so the node test drives it with places of its
// own. The numbers are `STORY_TUNE`'s.

import { STORY_TUNE } from '../story/bookClient.ts';
import type { StoryEvent } from '../story/quests.ts';
import type { KillMatch, Room, Shape } from '../story/set.ts';
import type { StoryView, Watch } from '../story/view.ts';

/** Where the player stands, as the detectors read it: the world, a place in that world's own frame, the room. */
export interface WatchPlace {
  /** The pack id of the world stood on. */
  world: string;
  /** Across the ground, in the raw frame on a planet and the game frame in space. */
  x: number;
  z: number;
  room: Room | null;
}

/** One body's death, as the detectors are told it. */
export interface KillInfo {
  /** The catalogue id. */
  who: string;
  group?: string;
  social?: string;
  tags?: readonly string[];
  /** The body's shared name, or one of this browser's own for a body nobody else knows: what a second word of the same death is told apart by. */
  npc: string;
}

/** The room a cell is, by the building's template and the cell's own name; null for the world outside (cell 0) or a cell with no name. */
export function roomOf(template: string, cells: readonly { index: number; name: string }[] | undefined, index: number): Room | null {
  if (!(index > 0) || !cells) return null;
  for (const c of cells) if (c.index === index) return c.name ? { cell: c.name, template } : null;
  return null;
}

/** A room's signal: `room:<template>#<cell>`. */
export function roomSignal(room: Room): string {
  return `room:${room.template ?? ''}#${room.cell}`;
}

/** Whether a point is inside a shape (a circle, a rectangle, a polygon), all in one frame. */
export function inShape(shape: Shape, x: number, z: number): boolean {
  switch (shape.kind) {
    case 'circle':
      return (x - shape.c[0]) ** 2 + (z - shape.c[1]) ** 2 <= shape.r * shape.r;
    case 'rect':
      return x >= shape.min[0] && x <= shape.max[0] && z >= shape.min[1] && z <= shape.max[1];
    case 'poly': {
      // Crossings of a ray along +x: an odd count is inside.
      let inside = false;
      const p = shape.pts;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, zi] = p[i];
        const [xj, zj] = p[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    }
  }
}

/** Whether the player's room is the one a watch names (the template only where it names one). */
export function sameRoom(want: Room | undefined, room: Room | null): boolean {
  if (!want) return true;
  return !!room && room.cell === want.cell && (!want.template || room.template === want.template);
}

/** Whether a death is one a kill watch counts: every field it gives must match. */
export function killMatches(m: KillMatch, k: KillInfo): boolean {
  if (m.who && !m.who.includes(k.who)) return false;
  if (m.group && m.group !== k.group) return false;
  if (m.social && m.social !== k.social) return false;
  if (m.tag && !k.tags?.includes(m.tag)) return false;
  return true;
}

/**
 * The name one body's death is known by, whichever way it is heard: its shared name while it is on the wire,
 * the world's own name for it otherwise (the two are one string for a body the server stood), and a name of
 * this browser's own for a body nobody else knows. A blow seen here and the server's word of the same death
 * reach the same string, so the second is the same kill.
 */
export function killKey(npcId: string, worldId: string, key: number): string {
  return npcId || worldId || `ours:${key}`;
}

/** What a body's catalogue entry says a kill step may match on. An entry from a catalogue with no stats matches by its id and group alone. */
export interface KillEntry {
  id: string;
  group?: string;
  stats?: { tags?: readonly string[]; core3?: { socialGroup?: string } | null } | null;
}

/** One death as the detectors are told it: the body's entry and the name its death is known by. */
export function killOf(entry: KillEntry, npc: string): KillInfo {
  const k: KillInfo = { who: entry.id, npc };
  if (entry.group) k.group = entry.group;
  const social = entry.stats?.core3?.socialGroup;
  if (social) k.social = social;
  const tags = entry.stats?.tags;
  if (tags?.length) k.tags = tags;
  return k;
}

/**
 * Whether the server's word that a body is gone credits this browser's player with killing it: a death (not
 * one taken down, not one already down when this browser stood it, which is `fresh`), with this browser's
 * relay number among those who struck it. Nought is no number: a browser with no line was never named.
 */
export function creditedByWord(why: string, fresh: boolean, me: number, by: readonly number[]): boolean {
  return why === 'dead' && !fresh && me > 0 && by.includes(me);
}

export class StoryWatch {
  /** When each level detector last raised, by its key, in the wall clock's milliseconds. */
  private readonly raised = new Map<string, number>();
  /** The areas the player stands in now, by id: what a condition's `inArea` reads. */
  readonly inside: string[] = [];
  /** The room the last tick found, as its signal, or ''. */
  private roomWas = '';
  private worldWas = '';
  /** Each body's death heard, and when, so a second word of it within `killDedupe` is the same kill. */
  private readonly killed = new Map<string, number>();
  /** The watches met this tick, kept and emptied rather than made again four times a second. */
  private readonly seen = new Set<string>();
  readonly stats = { ticks: 0, raised: 0, kills: 0, sameKill: 0, ignoredKills: 0, deaths: 0 };

  /**
   * Everything forgotten, in silence: a new character, whose host has closed every watch already. Whatever
   * is true is raised again at the next tick. A new world says it left its areas first (`leaveAll`).
   */
  reset(): void {
    this.raised.clear();
    this.inside.length = 0;
    this.roomWas = '';
    this.worldWas = '';
  }

  /**
   * The player has gone from every area they stood in (a travel begun, a death, another world): each is
   * said once, taken off the list first so a condition read while it is said no longer sees the player in
   * it. Answers how many. Nothing at all when there were none, which is every frame of a travel after the first.
   */
  leaveAll(out: (ev: StoryEvent) => void): number {
    let n = 0;
    while (this.inside.length) {
      const id = this.inside.pop()!;
      this.raised.delete(`area:${id}`);
      this.raise({ k: 'area', area: id, inside: false }, out);
      n++;
    }
    return n;
  }

  /** A level detector's turn to raise: on the first tick it is true, then every `repeatEv` while it stays true. */
  private due(key: string, now: number): boolean {
    const was = this.raised.get(key);
    if (was !== undefined && now - was < STORY_TUNE.repeatEv) return false;
    this.raised.set(key, now);
    return true;
  }

  private raise(ev: StoryEvent, out: (ev: StoryEvent) => void): void {
    this.stats.raised++;
    out(ev);
  }

  /**
   * One tick: every arrival, room, area and world the view watches, against where the player stands.
   * `now` is the wall clock's milliseconds, which is only what the repeats are paced by. With nowhere to
   * stand the player is in no area, and that is said; with no view nobody can be told anything, so the
   * areas are remembered as they were and the edge is found when somebody can be.
   */
  step(view: StoryView | null, at: WatchPlace | null, now: number, out: (ev: StoryEvent) => void): void {
    this.stats.ticks++;
    if (!at) {
      this.leaveAll(out);
      return;
    }
    if (!view) return;
    let wantRoom = false;
    let wantWorld = false;
    const seen = this.seen;
    seen.clear();
    for (const w of view.watch) {
      switch (w.k) {
        case 'arrive': {
          const key = `arrive:${w.quest}#${w.step}`;
          seen.add(key);
          const there = w.world === at.world && Math.hypot(at.x - w.p[0], at.z - w.p[1]) <= w.radius && sameRoom(w.room, at.room);
          if (!there) this.raised.delete(key);
          else if (this.due(key, now)) this.raise({ k: 'arrive', world: at.world, p: [at.x, at.z], room: at.room, quest: w.quest, step: w.step }, out);
          break;
        }
        case 'area':
          this.area(w, at, now, out);
          seen.add(`area:${w.id}`);
          break;
        case 'room':
          wantRoom = true;
          break;
        case 'world':
          wantWorld = true;
          break;
        default:
          break;
      }
    }
    // An area no longer watched is forgotten: nothing is said of leaving it.
    for (let i = this.inside.length - 1; i >= 0; i--) if (!seen.has(`area:${this.inside[i]}`)) this.inside.splice(i, 1);
    // A Map may lose the entry it is standing on while it is walked.
    for (const key of this.raised.keys()) if ((key.startsWith('arrive:') || key.startsWith('area:')) && !seen.has(key)) this.raised.delete(key);
    // The room: raised when stepped into and while stood in.
    const room = at.room ? roomSignal(at.room) : '';
    if (room !== this.roomWas) {
      this.raised.delete('room');
      this.roomWas = room;
    }
    if (wantRoom && room && at.room && this.due('room', now)) this.raise({ k: 'room', template: at.room.template ?? '', cell: at.room.cell }, out);
    // The world: raised on arriving and while there.
    if (at.world !== this.worldWas) {
      this.raised.delete('world');
      this.worldWas = at.world;
    }
    if (wantWorld && at.world && this.due('world', now)) this.raise({ k: 'world', world: at.world }, out);
  }

  private area(w: Extract<Watch, { k: 'area' }>, at: WatchPlace, now: number, out: (ev: StoryEvent) => void): void {
    const key = `area:${w.id}`;
    const isIn = w.world === at.world && inShape(w.shape, at.x, at.z) && sameRoom(w.room, at.room);
    const was = this.inside.indexOf(w.id);
    if (isIn) {
      if (was < 0) this.inside.push(w.id);
      if (this.due(key, now)) this.raise({ k: 'area', area: w.id, inside: true }, out);
    } else if (was >= 0) {
      this.inside.splice(was, 1);
      this.raised.delete(key);
      this.raise({ k: 'area', area: w.id, inside: false }, out);
    }
  }

  /**
   * A death the player is credited with: told whoever holds the story when a kill watch counts it, once
   * per body within `killDedupe`. Answers whether it was handed on.
   */
  kill(view: StoryView | null, k: KillInfo, now: number, out: (ev: StoryEvent) => void): boolean {
    for (const [npc, at] of this.killed) if (now - at > STORY_TUNE.killDedupe) this.killed.delete(npc);
    if (this.killed.has(k.npc)) {
      this.stats.sameKill++;
      return false;
    }
    this.killed.set(k.npc, now);
    let wanted = false;
    for (const w of view?.watch ?? []) if (w.k === 'kill' && killMatches(w.match, k)) wanted = true;
    if (!wanted) {
      this.stats.ignoredKills++;
      return false;
    }
    this.stats.kills++;
    this.raise({ k: 'kill', who: k.who, ...(k.group ? { group: k.group } : {}), ...(k.social ? { social: k.social } : {}), ...(k.tags?.length ? { tags: [...k.tags] } : {}), npc: k.npc }, out);
    return true;
  }

  /** The player died: told whoever holds the story when anything fails on it. */
  death(view: StoryView | null, out: (ev: StoryEvent) => void): boolean {
    if (!view?.watch.some((w) => w.k === 'death')) return false;
    this.stats.deaths++;
    this.raise({ k: 'death' }, out);
    return true;
  }

  report(): Record<string, unknown> {
    return { inside: [...this.inside], room: this.roomWas, world: this.worldWas, levels: this.raised.size, killsHeard: this.killed.size, stats: { ...this.stats } };
  }
}
