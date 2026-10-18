// Racing together, as rules: where each member of a group stands behind a track's grid, the countdown read off the
// clock every player shares so every member's go is one instant, the standings worked out from what each member says
// of its laps and its finish, a digest of a track's gates so a member whose copy of the file differs sits the race
// out, and what a member is told about why they cannot join. The game's half and the browser's word are
// `src/net/raceNet.ts` and `App.startRun`; nothing here touches a page, the physics or the wire.
//
// Every number is ours, live through `__debug.raceTogether({ tune })`.
//
// Pure: node runs it (`tools/swg/tests/raceTogether.test.ts`).

import { RUN_STEP, raceTime, type RaceRun } from './raceRun.ts';
import { trackHash, type RaceKind, type TrackDef } from './trackFile.ts';

/** The group race's own numbers. */
export const RACE_GROUP_TUNE = {
  /**
   * How far ahead of the leader's call go is set by default (s): long enough to read the offer, type `/race` and come
   * through the course's curtain on a slow machine, short enough that nobody sits waiting.
   */
  lead: 20,
  /** The least lead a call may set (s): under it a member's curtain cannot be through by go. */
  leadLeast: 5,
  /** Metres between two pods side by side on the grid: the shared pod box is 7 m wide, so two metres between them. */
  across: 9,
  /** Metres from one row of the grid to the next behind it: the pod box is 15 m long, so five between them. */
  back: 20,
  /** How many stand side by side in a row. */
  perRow: 2,
  /** A racing bike's grid as a share of a pod's: its box is a seventh of a pod's width, so its slots stand closer. */
  bikeShare: 0.5,
  /** How long a race is kept after the last word about it (s), so a finished race's standings stay readable a while. */
  keep: 600,
};

/** Set any of those, clamped to what makes sense; words for anything refused. */
export function tuneRaceGroup(o: Partial<Record<keyof typeof RACE_GROUP_TUNE, unknown>>): string[] {
  const words: string[] = [];
  const ranges: Record<keyof typeof RACE_GROUP_TUNE, [number, number]> = {
    lead: [2, 600],
    leadLeast: [0, 120],
    across: [0, 100],
    back: [0, 200],
    perRow: [1, 8],
    bikeShare: [0.05, 2],
    keep: [10, 7200],
  };
  for (const [k, v] of Object.entries(o)) {
    if (!Object.hasOwn(RACE_GROUP_TUNE, k)) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      words.push(`${k} takes a number`);
      continue;
    }
    const key = k as keyof typeof RACE_GROUP_TUNE;
    const [lo, hi] = ranges[key];
    RACE_GROUP_TUNE[key] = key === 'perRow' ? Math.round(Math.max(lo, Math.min(hi, v))) : Math.max(lo, Math.min(hi, v));
  }
  return words;
}

/**
 * A track's gates as eight hex characters: every member's own copy of the world's file is read into the same digest
 * when it is the same course (`trackHash`: its kind, laps, kinds, corridor, grid and gates), so a member whose copy
 * differs is told so and sits the race out rather than racing another course against the same clock.
 */
export function trackDigest(t: TrackDef): string {
  const s = trackHash(t);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Where a member's slot stands, in the game's frame: rows behind the track's grid, `perRow` side by side, centred on the
 * grid's line, the first row on the grid itself and each after it `back` metres further back, all facing the way the
 * grid faces. `slot` is the member's place in the leader's list, from nought; a racing bike's grid is `bikeShare` of a
 * pod's. The height is the grid's: the hull is stood on the ground under it, never in it (`App.standOnCourse`).
 */
export function gridSlot(grid: { x: number; y: number; z: number; heading: number }, slot: number, kind: RaceKind, tune = RACE_GROUP_TUNE): { x: number; y: number; z: number; heading: number } {
  const per = Math.max(1, Math.round(tune.perRow));
  const i = Math.max(0, Math.floor(slot));
  const row = Math.floor(i / per);
  const col = i % per;
  const share = kind === 'speederbike' ? tune.bikeShare : 1;
  const across = (col - (per - 1) / 2) * tune.across * share;
  const back = row * tune.back * share;
  // The nose is (sin h, cos h); the right is the nose crossed with up, (-cos h, sin h).
  const nx = Math.sin(grid.heading);
  const nz = Math.cos(grid.heading);
  const rx = -nz;
  const rz = nx;
  return { x: grid.x + rx * across - nx * back, y: grid.y, z: grid.z + rz * across - nz * back, heading: grid.heading };
}

/**
 * The run's own clock while it counts down to a start on the shared clock: the seconds left, below nought, rounded up
 * to the physics' whole steps so go lands on one as a run's own countdown does, or once the start has come the seconds
 * since it (a member who stands at the grid late starts late, with those seconds on the clock). `startMs` and `nowMs`
 * are on the shared clock.
 */
export function groupCountdown(startMs: number, nowMs: number, step = RUN_STEP): number {
  const left = (startMs - nowMs) / 1000;
  if (!(left > 0)) return -left;
  return -Math.ceil(left / step - 1e-6) * step;
}

/**
 * A group run's countdown read off the shared clock (`groupCountdown`), every frame play is simulated and only while it
 * counts down: from go the run times itself on the physics' own steps, as every run does. A run with no shared start is
 * left alone. Allocates nothing.
 */
export function syncGroupCountdown(run: Pick<RaceRun, 'phase' | 'clock' | 'sharedStart'>, nowMs: number): void {
  if (run.phase !== 'countdown' || !Number.isFinite(run.sharedStart) || !Number.isFinite(nowMs)) return;
  run.clock = groupCountdown(run.sharedStart, nowMs);
}

/** One member of a group race as the standings know them. */
export interface GroupStanding {
  /** Their relay id. */
  id: number;
  name: string;
  /** Said they joined (or this browser's own, joined). */
  joined: boolean;
  /** Laps done, the last one's time, and the time from go at its end (s). */
  laps: number;
  lapTime: number;
  total: number;
  finished: boolean;
  /** Why they dropped out, in words, or ''. */
  out: string;
  /** This browser's own row. */
  me: boolean;
}

export function newStanding(id: number, name: string, me = false): GroupStanding {
  return { id, name, joined: false, laps: 0, lapTime: Number.NaN, total: Number.NaN, finished: false, out: '', me };
}

/**
 * The joined members in place order: the finished first by their time from go, then those still racing by laps done
 * (more first) and then by the time from go at their last lap (sooner first), then those who dropped out. A new list;
 * the rows are the caller's own.
 */
export function standingsOf(rows: Iterable<GroupStanding>): GroupStanding[] {
  const list = [...rows].filter((r) => r.joined);
  const rank = (r: GroupStanding) => (r.out ? 2 : r.finished ? 0 : 1);
  list.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return a.total - b.total;
    if (ra === 1) {
      if (a.laps !== b.laps) return b.laps - a.laps;
      const ta = Number.isFinite(a.total) ? a.total : Infinity;
      const tb = Number.isFinite(b.total) ? b.total : Infinity;
      if (ta !== tb) return ta - tb;
    }
    return a.id - b.id;
  });
  return list;
}

/** The standings as the race block's lines: place, name, laps and time, at most `most` of them. */
export function standingLines(rows: Iterable<GroupStanding>, laps: number, most = 8): string[] {
  const out: string[] = [];
  const sorted = standingsOf(rows);
  for (let i = 0; i < sorted.length && out.length < most; i++) {
    const r = sorted[i];
    const name = r.me ? `${r.name} (you)` : r.name;
    if (r.out) out.push(`– ${name} out`);
    else if (r.finished) out.push(`${i + 1} ${name} ${raceTime(r.total)}`);
    else out.push(`${i + 1} ${name} ${Math.min(r.laps, laps)}/${laps}${Number.isFinite(r.total) ? ` ${raceTime(r.total)}` : ''}`);
  }
  return out;
}

/** What a member's browser knows when it is asked to join, as the game answers it. */
export interface JoinHere {
  /** This browser's world (its pack id). */
  world: string;
  /** This world's copy of the track called, or null when it has none. */
  track: TrackDef | null;
  /** Why what the player rides cannot race this track as the kind it was spawned as, or ''. */
  ride: string;
  /** The shared clock now (ms). */
  now: number;
  /** This browser's relay id. */
  me: number;
}

/** The race as a join reads it. */
export interface JoinRace {
  world: string;
  track: string;
  at: number;
  digest: string;
  members: readonly number[];
}

/** Why a member cannot join a race called, in words, or '' when they can; and their slot when they can. */
export function joinCheck(race: JoinRace, here: JoinHere): { why: string; slot: number } {
  if (here.world !== race.world) return { why: `the race is on ${race.world}, and you are on ${here.world || 'no world'}`, slot: -1 };
  if (!here.track) return { why: `this build has no track called ${race.track} on ${race.world}`, slot: -1 };
  if (trackDigest(here.track) !== race.digest) return { why: `your copy of ${here.track.name} differs from the leader's, so you sit this one out`, slot: -1 };
  if (!(here.now < race.at)) return { why: 'too late: the race has started', slot: -1 };
  const slot = race.members.indexOf(here.me);
  if (slot < 0) return { why: 'you were not in the group when the race was called', slot: -1 };
  if (here.ride) return { why: here.ride, slot: -1 };
  return { why: '', slot };
}
