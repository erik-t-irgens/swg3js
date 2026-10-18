// Racing together: the browser's half of the group's race word (`server/raceWire.mjs`). The group's leader calls a race
// on a track of the world's file at a moment of the shared clock; every member hears it, is offered it, and joins with
// `/race` (or `__debug.raceTogether({ join: true })`), which stands what they ride at a grid slot of their own behind the
// track's grid and counts down to that one moment; from go each browser times itself on the physics' own steps exactly
// as a run of its own does (`src/race/raceRun.ts`), and says its laps and its finish to the group, which every member's
// browser lays into the standings. Nothing is judged by the server: who may race, where each stands and who is ahead
// are worked out here from the same words (`src/race/raceGroup.ts`).
//
// The same four rules the net side's other modules keep: nothing here touches the document, three or the socket, so a
// node test runs it as it is; nothing here runs in a frame, every one of these is an event; nothing is decided that the
// server holds (who is in the group and who leads it are the roster's); and everything that arrives is data, checked
// before it is used and never allowed to throw in the middle of a message. With no server, against a relay that came
// before, or one whose hail says nothing of races, nothing is sent and no race is called.

import { RACE_GROUP_TUNE, joinCheck, newStanding, standingLines, trackDigest, type GroupStanding } from '../race/raceGroup.ts';
import { raceTime } from '../race/raceRun.ts';
import type { TrackDef } from '../race/trackFile.ts';
import type { Authority } from './session.ts';

/** The words this module answers: the socket hands them over whole, so its switch must have a case for each. */
export const RACE_WORDS = ['race'] as const;

/** A member of the group as the race needs them: their relay id (0 while away), their name, and whether they lead it. */
export interface RaceMember {
  id: number;
  name: string;
  leader: boolean;
}

/** A race called, as every member's browser keeps it. */
export interface GroupRace {
  world: string;
  track: string;
  /** Its name, from this browser's own copy of the file ('' when it has none). */
  name: string;
  /** The start, on the shared clock (ms). */
  at: number;
  digest: string;
  laps: number;
  /** The members in grid order, by relay id, as the leader's word listed them. */
  members: number[];
  /** Who called it (their relay id). */
  leader: number;
  /** Each member's standing, by relay id. */
  rows: Map<number, GroupStanding>;
  /** Where this browser is in it. */
  mine: 'offered' | 'joining' | 'joined' | 'out' | 'refused';
  /** Why this browser is out or refused, in words. */
  why: string;
  /** The shared clock when anything about it was last heard (ms), for forgetting it. */
  lastAt: number;
}

/** What an `out` word says, from the words the game ends a run with. */
export function outWordFor(why: string): string {
  if (/died/.test(why)) return 'died';
  if (/got off/.test(why)) return 'left';
  if (/racing mode|vehicle is gone|could not be spawned/.test(why)) return 'vehicle';
  if (/put back/.test(why)) return 'crashed';
  if (/console|stopped|left the race/.test(why)) return 'stopped';
  if (/group/.test(why)) return 'group';
  if (/world|travel|arriv|select|leav|system|jump/.test(why)) return 'world';
  return 'other';
}

/** An `out` word in words. */
const OUT_SAYS: Record<string, string> = {
  left: 'got off',
  world: 'left the world',
  vehicle: 'lost the vehicle',
  crashed: 'could not be put back',
  died: 'died',
  stopped: 'stopped',
  group: 'left the group',
  other: 'dropped out',
};

/** A place as the message line says it. */
function placeName(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** The module's own count of what it did, for `__debug.raceTogether()`: one object, filled in place. */
export interface RaceTogetherStats {
  called: number;
  heard: number;
  sent: number;
  joined: number;
  refused: number;
  lastWhy: string;
}

/** The one the page made, for the chat's `/race`, which `src/net/groups.ts` reads; null before it is made. */
let current: RaceTogether | null = null;

/** The race module, for the chat's `/race`. */
export function raceNow(): RaceTogether | null {
  return current;
}

export class RaceTogether {
  /** Something to send: the socket puts it on the wire. */
  send: (msg: Record<string, unknown>) => void = () => {};
  /** Who decides: with no server this answers 'me' and the module stays quiet. */
  authority: () => Authority = () => 'me';
  /** Whether the server carries the race word (its hail's `race`); nought against one that does not. */
  raceVersion: () => number = () => 0;
  /** Something the player should read. */
  note: (text: string) => void = () => {};
  /** The shared clock, in milliseconds: the same clock the start is set on. */
  now: () => number = () => Date.now();
  /** Whether this browser leads its group. */
  leading: () => boolean = () => false;
  /** This browser's own relay id. */
  myId: () => number = () => 0;
  /** This browser's own name, for its row. */
  myName: () => string = () => 'you';
  /** The group as it stands, or null for none. */
  members: () => RaceMember[] | null = () => null;
  /** This browser's world, as its pack id. */
  world: () => string = () => '';
  /** This world's copy of a track, by id, or null. */
  track: (id: string) => TrackDef | null = () => null;
  /** Why what the player rides cannot race that track, or '' when it can. */
  canRace: (t: TrackDef) => string = () => 'nothing to race on';
  /**
   * Stand what the player rides at its slot and start the group run (the game's `startRun` with the start moment): the
   * words to say, '' when the run was started.
   */
  join: (race: GroupRace, slot: number) => Promise<string> = () => Promise.resolve('there is nothing to stand at a grid');
  /** Whether the game's run under way is this race's (its world, track and start). */
  ownsRun: (race: GroupRace) => boolean = () => false;
  /** End the game's run of this race, in the game's words (which says it to the group through `ranOut`). */
  stop: (why: string) => void = () => {};

  race: GroupRace | null = null;
  /** Moved whenever the standings or this browser's place in the race change: the race block reads it. */
  version = 0;
  private readonly stat: RaceTogetherStats = { called: 0, heard: 0, sent: 0, joined: 0, refused: 0, lastWhy: '' };

  constructor() {
    current = this;
  }

  /** Whether there is a server holding a world that carries the race word. */
  get active(): boolean {
    return this.authority() === 'server' && this.raceVersion() >= 1;
  }

  /**
   * The leader calls a race on a track of this world's file, go `inSeconds` from now (`RACE_GROUP_TUNE.lead` when not
   * given). The group hears it and this browser takes it as heard, joining at once when it can. The words to say.
   */
  call(trackId: string, inSeconds?: number): string {
    if (this.authority() !== 'server') return 'there is no server here, so there is nobody to race';
    if (this.raceVersion() < 1) return 'this server carries no races: restart it from this build (npm run relay)';
    const members = this.members();
    if (!members) return 'you are not in a group';
    if (!this.leading()) return 'only the leader can call a race';
    const t = this.track(trackId);
    if (!t) return `no track called ${trackId} on this world`;
    const lead = typeof inSeconds === 'number' && Number.isFinite(inSeconds) ? Math.max(RACE_GROUP_TUNE.leadLeast, inSeconds) : RACE_GROUP_TUNE.lead;
    const me = this.myId();
    // The leader first, then everybody here in the roster's own order: each one's slot is their place in this list.
    const list = [me, ...members.filter((m) => m.id > 0 && m.id !== me).map((m) => m.id)].slice(0, 8);
    const at = Math.round(this.now() + lead * 1000);
    const word = { t: 'race', phase: 'call', world: this.world(), track: t.id, at, digest: trackDigest(t), laps: t.kind === 'circuit' ? Math.max(1, t.laps) : 1, members: list };
    this.stat.called++;
    this.post(word);
    this.heardCall({ ...word, id: me, from: this.myName() });
    return `${t.name} called for the group: go in ${Math.round(lead)} s`;
  }

  /** This browser joins the race called, if it can: the words to say. */
  async joinNow(): Promise<string> {
    const race = this.race;
    if (!race) return 'no race has been called';
    if (race.mine === 'joined') return 'you are already in it';
    if (race.mine === 'joining') return 'already on the way to the grid';
    const t = this.track(race.track);
    const check = joinCheck(race, { world: this.world(), track: t, ride: t ? this.canRace(t) : '', now: this.now(), me: this.myId() });
    if (check.why) {
      this.stat.lastWhy = check.why;
      return check.why;
    }
    race.mine = 'joining';
    this.version++;
    let words: string;
    try {
      words = await this.join(race, check.slot);
    } catch (err) {
      words = `the grid could not be reached (${err instanceof Error ? err.message : String(err)})`;
    }
    // A newer race called meanwhile, or this one dropped: whatever the join came to is not this race's any more.
    if (this.race !== race) return words || 'the race changed meanwhile';
    if (words) {
      race.mine = 'offered';
      this.stat.lastWhy = words;
      this.version++;
      return words;
    }
    race.mine = 'joined';
    race.why = '';
    this.stat.joined++;
    const row = this.rowOf(race, this.myId(), this.myName(), true);
    row.joined = true;
    this.post(this.word(race, 'join', {}));
    this.version++;
    return `on the grid, slot ${check.slot + 1}: go in ${Math.max(0, Math.ceil((race.at - this.now()) / 1000))} s`;
  }

  /** This browser drops out of the race (the console's, or the chat's): its run ended, and the group told. */
  leave(why = 'you left the race'): string {
    const race = this.race;
    if (!race || race.mine !== 'joined') return 'you are in no race';
    // The game ends its run, which says it to the group (`ranOut`); a run already gone is said here.
    if (this.ownsRun(race)) this.stop(why);
    if (race.mine === 'joined') this.sayOut(race, why);
    race.mine = 'out';
    race.why = why;
    this.version++;
    return 'out of the race';
  }

  /** The chat's `/race`: `/race` joins, `/race leave` drops out, `/race <track> [seconds]` calls one (the leader's). */
  chat(arg: string): string {
    const words = arg.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (!this.race) return 'no race has been called (the leader types /race <track id>)';
      void this.joinNow().then((w) => this.note(w));
      return '';
    }
    if (words[0] === 'leave' || words[0] === 'out') return this.leave();
    const seconds = words[1] !== undefined ? Number(words[1]) : undefined;
    return this.call(words[0], Number.isFinite(seconds) ? seconds : undefined);
  }

  /** One message from the far end; true when it was one of ours. */
  handle(msg: Record<string, unknown>): boolean {
    if (!msg || msg.t !== 'race') return false;
    this.stat.heard++;
    const id = Number(msg.id) || 0;
    if (!id) return true;
    const phase = typeof msg.phase === 'string' ? msg.phase : '';
    if (phase === 'call') {
      this.heardCall(msg);
      return true;
    }
    const race = this.race;
    if (!race || msg.world !== race.world || msg.track !== race.track || Number(msg.at) !== race.at) return true;
    race.lastAt = this.now();
    const name = this.nameOf(id, msg.from);
    const row = this.rowOf(race, id, name, false);
    if (phase === 'join') {
      if (!row.joined) {
        row.joined = true;
        this.note(`${name} is on the grid`);
      }
    } else if (phase === 'lap') {
      const n = Number(msg.n);
      const time = Number(msg.time);
      const total = Number(msg.total);
      if (Number.isInteger(n) && n >= 1 && Number.isFinite(time) && Number.isFinite(total)) {
        row.joined = true;
        row.laps = Math.max(row.laps, n);
        row.lapTime = time;
        row.total = total;
        if (n < race.laps) this.note(`${name}: lap ${n}/${race.laps} ${raceTime(time)}`);
      }
    } else if (phase === 'finish') {
      const total = Number(msg.total);
      if (Number.isFinite(total)) {
        row.joined = true;
        row.finished = true;
        row.total = total;
        row.laps = race.laps;
        this.note(`${name} finished ${placeName(this.placeOf(race, row))} in ${raceTime(total)}`);
      }
    } else if (phase === 'out') {
      const why = typeof msg.why === 'string' && Object.hasOwn(OUT_SAYS, msg.why) ? msg.why : 'other';
      if (!row.out && row.joined && !row.finished) {
        row.out = OUT_SAYS[why];
        this.note(`${name} is out of the race (${row.out})`);
      }
    }
    this.version++;
    return true;
  }

  /** This browser's lap done in the race it joined: said to the group, and laid into its own row. */
  ranLap(n: number, time: number, total: number): void {
    const race = this.race;
    if (!race || race.mine !== 'joined' || !this.ownsRun(race)) return;
    const row = this.rowOf(race, this.myId(), this.myName(), true);
    row.laps = Math.max(row.laps, n);
    row.lapTime = time;
    row.total = total;
    this.post(this.word(race, 'lap', { n, time: round3(time), total: round3(total) }));
    this.version++;
  }

  /** This browser's finish: said to the group, and its place among those known said here. */
  ranFinish(total: number): void {
    const race = this.race;
    if (!race || race.mine !== 'joined' || !this.ownsRun(race)) return;
    const row = this.rowOf(race, this.myId(), this.myName(), true);
    row.finished = true;
    row.total = total;
    row.laps = race.laps;
    this.post(this.word(race, 'finish', { total: round3(total) }));
    this.note(`you finished ${placeName(this.placeOf(race, row))} of the ${[...race.rows.values()].filter((r) => r.joined).length} racing`);
    this.version++;
  }

  /** This browser's run of the race ended before its finish (`why` the game's words): said to the group. */
  ranOut(why: string): void {
    const race = this.race;
    if (!race || race.mine !== 'joined' || !this.ownsRun(race)) return;
    this.sayOut(race, why);
  }

  /** Out of the race, said to the group and laid into this browser's own row. */
  private sayOut(race: GroupRace, why: string): void {
    const word = outWordFor(why);
    race.mine = 'out';
    race.why = why;
    const row = this.rowOf(race, this.myId(), this.myName(), true);
    if (!row.finished) row.out = OUT_SAYS[word];
    this.post(this.word(race, 'out', { why: word }));
    this.version++;
  }

  /**
   * The roster changed. A racer no longer in the group dropped out, and the rest are told; this browser out of every
   * group is out of the race, its run going on alone (its own clock and its bests are its own). Nothing is sent: the
   * roster is what every member already shares.
   */
  rosterChanged(): void {
    const race = this.race;
    if (!race) return;
    const members = this.members();
    if (!members) {
      if (race.mine === 'joined') this.note('you left the group: your run goes on alone');
      this.race = null;
      this.version++;
      return;
    }
    const ids = new Set(members.map((m) => m.id));
    for (const row of race.rows.values()) {
      if (row.me || !row.joined || row.out || row.finished) continue;
      if (!ids.has(row.id)) {
        row.out = OUT_SAYS.group;
        this.note(`${row.name} left the group and is out of the race`);
        this.version++;
      }
    }
  }

  /** The race block's standings lines, or none when this browser is in no race or the run under way is not its. */
  lines(): string[] {
    const race = this.race;
    if (!race || !(race.mine === 'joined' || race.mine === 'out') || !this.ownsRun(race)) return [];
    return standingLines(race.rows.values(), race.laps);
  }

  /** The line dropped or was put down: nothing about a race still holds. */
  clear(): void {
    if (this.race) this.version++;
    this.race = null;
  }

  /** A race long over, forgotten. Called a few times a minute at most (`App.stepRun`'s, or the console). */
  forgetOld(): void {
    const race = this.race;
    if (race && race.mine !== 'joining' && race.mine !== 'joined' && this.now() - race.lastAt > RACE_GROUP_TUNE.keep * 1000) {
      this.race = null;
      this.version++;
    }
  }

  /** What it is doing, for `__debug.raceTogether()`. */
  debug(): Record<string, unknown> {
    const race = this.race;
    const now = this.now();
    return {
      active: this.active,
      server: { authority: this.authority(), raceVersion: this.raceVersion() },
      race: race
        ? {
            world: race.world,
            track: race.track,
            name: race.name,
            laps: race.laps,
            digest: race.digest,
            startsAt: new Date(race.at).toISOString(),
            goIn: Number(((race.at - now) / 1000).toFixed(2)),
            leader: race.leader,
            members: race.members,
            mySlot: race.members.indexOf(this.myId()),
            mine: race.mine,
            why: race.why,
            standings: standingLines(race.rows.values(), race.laps),
            rows: [...race.rows.values()].map((r) => ({ ...r, lapTime: Number.isFinite(r.lapTime) ? round3(r.lapTime) : null, total: Number.isFinite(r.total) ? round3(r.total) : null })),
          }
        : null,
      ...this.stat,
    };
  }

  // ---- the pieces ----------------------------------------------------------------------------------

  /** A call heard (the leader's own included): checked, kept as the race, offered, and the leader's own joined. */
  private heardCall(msg: Record<string, unknown>): void {
    const id = Number(msg.id) || 0;
    const members = this.members();
    // Only the group's own leader calls a race; a call from anybody else (a member on another build) is not one.
    const leader = members?.find((m) => m.leader)?.id ?? 0;
    const me = this.myId();
    if (!members || (id !== leader && !(id === me && this.leading()))) return;
    const at = Number(msg.at);
    const laps = Number(msg.laps);
    const list = Array.isArray(msg.members) ? msg.members.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (typeof msg.track !== 'string' || typeof msg.world !== 'string' || !Number.isFinite(at) || !Number.isInteger(laps) || typeof msg.digest !== 'string' || !list.length) return;
    const t = this.track(msg.track);
    // A race this browser is still running is left to run on alone: the newer call is the group's race from here on.
    const was = this.race;
    if (was && was.mine === 'joined' && this.ownsRun(was) && (was.track !== msg.track || was.at !== at)) this.note('a new race was called: your run goes on alone');
    const race: GroupRace = { world: msg.world, track: msg.track, name: t?.name ?? msg.track, at, digest: msg.digest, laps, members: list, leader: id, rows: new Map(), mine: 'offered', why: '', lastAt: this.now() };
    for (const m of list) this.rowOf(race, m, this.nameOf(m, m === id ? msg.from : undefined), m === me);
    this.race = race;
    this.version++;
    const leftS = Math.max(0, Math.round((at - this.now()) / 1000));
    const check = joinCheck(race, { world: this.world(), track: t, ride: '', now: this.now(), me });
    if (check.why) {
      race.mine = 'refused';
      race.why = check.why;
      this.stat.refused++;
      this.stat.lastWhy = check.why;
      if (id !== me) this.note(`${this.nameOf(id, msg.from)} calls a race on ${race.name}, but ${check.why}`);
      else this.note(check.why);
      return;
    }
    if (id === me) {
      // The leader races too, if what they ride can race it; if not, the race still stands for everybody else.
      void this.joinNow().then((w) => w && this.note(w));
      return;
    }
    // Offered whatever this member rides now, since they may yet get on something that races it before go; a member not
    // riding, or riding a kind the track is not raced as, is told why as it is offered and not only when they type /race.
    const ride = t ? this.canRace(t) : '';
    const offer = `${this.nameOf(id, msg.from)} calls a race on ${race.name}, ${laps} lap${laps === 1 ? '' : 's'}, go in ${leftS} s`;
    this.note(ride ? `${offer}, but you cannot race it as you are (${ride}): type /race once you can` : `${offer}: type /race to join`);
  }

  /** A member's row, made the first time they are named. */
  private rowOf(race: GroupRace, id: number, name: string, me: boolean): GroupStanding {
    let row = race.rows.get(id);
    if (!row) {
      row = newStanding(id, name, me);
      race.rows.set(id, row);
    }
    return row;
  }

  /** A member's place among those this browser knows of (their row's own standing, from one). */
  private placeOf(race: GroupRace, row: GroupStanding): number {
    let place = 1;
    for (const r of race.rows.values()) if (r !== row && r.joined && r.finished && r.total < row.total) place++;
    return place;
  }

  /** What to call a member: the roster's name, else the name the relay put on the word, else 'someone'. */
  private nameOf(id: number, from?: unknown): string {
    if (id === this.myId()) return this.myName();
    const m = this.members()?.find((x) => x.id === id);
    if (m?.name) return m.name;
    return typeof from === 'string' && from ? from.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').slice(0, 24) : 'someone';
  }

  private word(race: GroupRace, phase: string, extra: Record<string, unknown>): Record<string, unknown> {
    return { t: 'race', phase, world: race.world, track: race.track, at: race.at, ...extra };
  }

  private post(msg: Record<string, unknown>): void {
    if (!this.active) return;
    this.stat.sent++;
    this.send(msg);
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
