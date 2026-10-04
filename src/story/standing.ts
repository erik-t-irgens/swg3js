// Standing and Trust on the three tracks (the Rebellion, the Empire, freelance work), and the ranks a ladder
// hangs on them. Pure: the step machine (`quests.ts`) works every change out with these and writes the whole
// record (`trackSet`), the view (`view.ts`) shows the player what they may know of it, and the server runs the
// very same file.
//
// **The bible's two axes.** Standing is how much work a track has had out of the character, from nought to
// `standingMax`; it may be ground out, but a repeatable job gives only so much of it a real day (`quests.ts`).
// Trust is a small number, from `trustMin` to `trustMax`, that moves only on a choice made under pressure
// (`check.ts` holds the data to that). The player sees Standing as a bar to the next rung with its numbers
// hidden, and Trust only in words (`trustWords`, five bands cut at `trustBands`): never a number.
//
// **Rank is held, never worked out.** The rung a character holds is written down and changed only by the
// story -- `promote`, `demote`, `suspend`, `burn`, `assign` -- so it can be lost. Crossing a rung's thresholds
// only makes `rankReady(t)` true, for the promotion beat the owner wrote; a rung written `promote: "auto"` is
// taken by itself the moment it is reached. Either only while the track has taken the character on (status
// `active`): a stranger who happens to have done the Rebellion favours is not made one of its cell for it. The
// status runs `none -> used -> active` only through the story's own `useTrack` and `activate`; there is no
// recruiter. A burn takes the rank and the cell, puts Standing back to the ladder's floor and Trust to nought,
// and remembers what was burned (`burnedFrom`), so the next cell knows why the character came to it; only an
// `activate` takes a burned track back. A suspension runs out by itself, on the shared clock. Nothing locks one
// track against another: holding two is allowed, and made dangerous by the story's own data.
//
// **Ladders** are `ladders.jsonc`, one to a story (the owner's winning over the test set's): per track a floor
// and its rungs, lowest first, each with an id, a name, the Standing and Trust it asks for, how it is taken
// (`beat` or `auto`), what it pays, what Trust a conversation briefs at, how much heavier it makes an entry in
// the ISB's file (`exposure`, multiplied over every rung held: knowing more names is more exposure), and the
// jobs a demotion off it closes (`closes`); and the five words Trust is shown in. With none, every track has
// no rungs and Trust is shown in our own five words.
//
// Every number here is ours; the committed test set's rungs are "TEST RUNG n".

import { BOOK_LIMITS, DIVISIONS, TRACKS, isRankWord, ownOf, type Division, type StoryBook, type Track, type TrackHistory, type TrackRec, type TrackStatus } from './book.ts';
import { FORBIDDEN_KEYS } from './waypoints.ts';

/** Every number of Standing and Trust. Ours. */
export const STANDING_TUNE = {
  /** Standing a track runs to. It never goes below nought. */
  standingMax: 10000,
  /** Trust runs from this... */
  trustMin: -5,
  /** ...to this. */
  trustMax: 10,
  /** A named person's own Standing toward the character runs between these. */
  npcStandingMin: -1000,
  npcStandingMax: 1000,
  /** Standing on a speaker's track at or past which the game's own people greet warmly (`reactions.ts`). */
  niceAt: 2500,
  /** Trust on a speaker's track (or their own, for a named person) at or below which they greet coldly. */
  meanTrust: -3,
  /**
   * Lines of history a track keeps, newest last: never more than the book itself will take of one
   * (`BOOK_LIMITS.trackHistory`), or a track whose history outgrew it would be refused every move from then on.
   */
  historyMax: 64,
  /** Where the five words Trust is shown in are cut: below the first is the first word, at or past the last the fifth. */
  trustBands: [-3, 0, 3, 6] as number[],
  /** How finely the bar to the next rung moves, as a share: the view never carries more than this says. */
  barStep: 0.02,
};

/** Move any of those, live; a number only ever by a finite number, the bands by four rising ones. */
export function tuneStanding(o: Partial<typeof STANDING_TUNE> | null | undefined): typeof STANDING_TUNE {
  if (!o) return STANDING_TUNE;
  const into = STANDING_TUNE as unknown as Record<string, unknown>;
  for (const k of Object.keys(o) as (keyof typeof STANDING_TUNE)[]) {
    const v = o[k];
    if (k === 'trustBands') {
      if (Array.isArray(v) && v.length === 4 && v.every((n, i) => typeof n === 'number' && Number.isFinite(n) && (i === 0 || n > (v[i - 1] as number)))) STANDING_TUNE.trustBands = [...(v as number[])];
      continue;
    }
    if (k in STANDING_TUNE && typeof v === 'number' && Number.isFinite(v)) into[k] = k === 'historyMax' ? Math.max(1, Math.min(BOOK_LIMITS.trackHistory, Math.round(v))) : k === 'barStep' ? Math.max(0.001, Math.min(1, v)) : v;
  }
  return STANDING_TUNE;
}

/** Our own five words for Trust, lowest first: what a story with no `trustWords` of its own shows. */
export const TRUST_WORDS: readonly string[] = Object.freeze(['They tell you nothing', 'They tell you only what you need', 'They tell you what they would tell anyone', 'They tell you what they think', 'They trust you with names']);

/** One rung of a ladder. */
export interface Rung {
  id: string;
  name: string;
  standing: number;
  trust: number;
  promote: 'beat' | 'auto';
  pays: number;
  brief: number;
  exposure: number;
  /** Jobs closed to the character when they are demoted off this rung (`<set>:<quest>`). */
  closes: string[];
}

export interface Ladder {
  /** Where a burn puts Standing back to. */
  floor: number;
  rungs: Rung[];
}

/** A story's `ladders.jsonc`: a ladder per track, and the five words Trust is shown in. */
export interface LaddersDef {
  tracks: Partial<Record<Track, Ladder>>;
  trustWords: string[] | null;
}

/** What reading `ladders.jsonc` reports a problem with: the path in the file and why. */
export type LadderIssue = { path: string; message: string; level: 'error' | 'warning' };

const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * A story's `ladders.jsonc`, read: `{ "trustWords": [five words], "<track>": { "floor": 0, "rungs": [ { "id",
 * "name", "standing", "trust", "promote": "beat" | "auto", "pays", "brief", "exposure", "closes": [quest...] } ] } }`.
 * A rung's `closes` names quests, prefixed with `prefix` where they carry none, as every id in a set is.
 */
export function laddersOf(v: unknown, prefix: string, issues: LadderIssue[]): LaddersDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    issues.push({ path: '', message: 'ladders.jsonc holds one object: a ladder by track, and the words Trust is shown in', level: 'error' });
    return null;
  }
  const o = v as Record<string, unknown>;
  const out: LaddersDef = { tracks: {}, trustWords: null };
  for (const k of Object.keys(o)) {
    if (k === 'trustWords') {
      const w = o.trustWords;
      if (!Array.isArray(w) || w.length !== 5 || !w.every((x) => typeof x === 'string' && x.trim())) issues.push({ path: '/trustWords', message: 'trustWords is five words, lowest Trust first', level: 'error' });
      else out.trustWords = (w as string[]).map((x) => x.replace(CONTROL, '').slice(0, 80));
      continue;
    }
    if (!(TRACKS as readonly string[]).includes(k)) {
      issues.push({ path: `/${k}`, message: `${k} is not a track: rebellion, empire or freelance`, level: 'error' });
      continue;
    }
    const l = o[k] as Record<string, unknown> | null;
    if (!l || typeof l !== 'object' || Array.isArray(l)) {
      issues.push({ path: `/${k}`, message: 'a ladder is { "floor": n, "rungs": [...] }', level: 'error' });
      continue;
    }
    for (const key of Object.keys(l)) if (key !== 'floor' && key !== 'rungs') issues.push({ path: `/${k}/${key}`, message: `${key} is not part of a ladder`, level: 'warning' });
    const floor = l.floor === undefined ? 0 : typeof l.floor === 'number' && Number.isFinite(l.floor) && l.floor >= 0 ? l.floor : (issues.push({ path: `/${k}/floor`, message: 'a floor is Standing of nought or more', level: 'error' }), 0);
    const rungs: Rung[] = [];
    if (!Array.isArray(l.rungs)) issues.push({ path: `/${k}/rungs`, message: 'rungs are a list, lowest first', level: 'error' });
    (Array.isArray(l.rungs) ? l.rungs : []).forEach((x, i) => {
      const p = `/${k}/rungs/${i}`;
      const r = x as Record<string, unknown> | null;
      if (!r || typeof r !== 'object' || Array.isArray(r) || !isRankWord(r.id) || typeof r.name !== 'string' || !r.name.trim()) {
        issues.push({ path: p, message: 'a rung is { "id": a plain word, "name": words, "standing": n, "trust": n }', level: 'error' });
        return;
      }
      if (rungs.some((y) => y.id === r.id)) {
        issues.push({ path: `${p}/id`, message: `${String(r.id)} is the id of another rung of this ladder`, level: 'error' });
        return;
      }
      for (const key of Object.keys(r)) if (!['id', 'name', 'standing', 'trust', 'promote', 'pays', 'brief', 'exposure', 'closes'].includes(key)) issues.push({ path: `${p}/${key}`, message: `${key} is not part of a rung`, level: 'warning' });
      const num = (key: string, fallback: number, lo: number, hi: number): number => {
        const n = r[key];
        if (n === undefined) return fallback;
        if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) {
          issues.push({ path: `${p}/${key}`, message: `${key} is a number from ${lo} to ${hi}`, level: 'error' });
          return fallback;
        }
        return n;
      };
      const promote = r.promote === undefined ? 'beat' : r.promote === 'beat' || r.promote === 'auto' ? r.promote : (issues.push({ path: `${p}/promote`, message: 'a rung is taken by a "beat" the story writes, or "auto"', level: 'error' }), 'beat');
      const closes: string[] = [];
      if (r.closes !== undefined) {
        if (!Array.isArray(r.closes)) issues.push({ path: `${p}/closes`, message: 'closes is a list of quests', level: 'error' });
        else
          for (const q of r.closes) {
            const id = typeof q === 'string' ? (q.includes(':') ? q : `${prefix}:${q}`) : '';
            if (/^[A-Za-z0-9_-]{1,24}:[A-Za-z0-9_./-]{1,96}$/.test(id)) closes.push(id);
            else issues.push({ path: `${p}/closes`, message: `${JSON.stringify(q)} is not a quest id`, level: 'error' });
          }
      }
      rungs.push({ id: r.id as string, name: (r.name as string).replace(CONTROL, '').slice(0, 80), standing: num('standing', 0, 0, 1e7), trust: num('trust', -1e3, -1e3, 1e3), promote, pays: num('pays', 1, 0, 1000), brief: num('brief', 0, -1e3, 1e3), exposure: num('exposure', 1, 0, 1000), closes });
    });
    for (let i = 1; i < rungs.length; i++) if (rungs[i].standing < rungs[i - 1].standing) issues.push({ path: `/${k}/rungs/${i}/standing`, message: `${rungs[i].id} asks for less Standing than the rung below it`, level: 'warning' });
    out.tracks[k as Track] = { floor, rungs };
  }
  return out;
}

// ---- reading a track ------------------------------------------------------------------------------------

/** A track's record as the book holds it, or one with nothing on it. Never anything a table's prototype carries. */
export function trackOf(book: Pick<StoryBook, 'tracks'> | null | undefined, t: Track): TrackRec {
  return ownOf(book?.tracks as Record<string, TrackRec> | undefined, t) ?? { standing: 0, trust: 0 };
}

/** A track's ladder in a story's ladders, or one with no rungs. */
export function ladderOf(ladders: LaddersDef | null | undefined, t: Track): Ladder {
  return ladders?.tracks[t] ?? { floor: 0, rungs: [] };
}

/** Where a rank is on its ladder, from nought; -1 for no rank (or a rung the ladder no longer has). */
export function rungIndex(ladder: Ladder, rank: string | null | undefined): number {
  if (!rank) return -1;
  for (let i = 0; i < ladder.rungs.length; i++) if (ladder.rungs[i].id === rank) return i;
  return -1;
}

/** The rung held, or null. */
export function rungOf(ladder: Ladder, rec: TrackRec): Rung | null {
  const i = rungIndex(ladder, rec.rank);
  return i >= 0 ? ladder.rungs[i] : null;
}

/** The rung above the one held (the first, with none held), or null at the top. */
export function nextRungOf(ladder: Ladder, rec: TrackRec): Rung | null {
  return ladder.rungs[rungIndex(ladder, rec.rank) + 1] ?? null;
}

/**
 * How a track stands just now: its status, with a suspension whose time has run out read as over -- the status
 * it held before it was suspended, which the sweep then writes back (`liftSuspension`).
 */
export function statusOf(rec: TrackRec, now: number): TrackStatus {
  const s = rec.status ?? 'none';
  if (s !== 'suspended' || rec.suspendedUntil === undefined || now < rec.suspendedUntil) return s;
  return statusBeforeSuspension(rec);
}

/** The status a suspension took a track from, by its own history: `active` when the history does not say. */
function statusBeforeSuspension(rec: TrackRec): TrackStatus {
  const h = rec.history ?? [];
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].what !== 'suspend') continue;
    const was = h[i].from;
    return was === 'none' || was === 'used' || was === 'active' ? was : 'active';
  }
  return 'active';
}

/** Whether a track's next rung is reached and waits on the story's promotion beat: taken on, the rung a beat's, both thresholds met. */
export function rankReady(book: Pick<StoryBook, 'tracks'> | null | undefined, ladders: LaddersDef | null | undefined, t: Track, now: number): boolean {
  const rec = trackOf(book, t);
  const next = nextRungOf(ladderOf(ladders, t), rec);
  return !!next && next.promote === 'beat' && statusOf(rec, now) === 'active' && rec.standing >= next.standing && rec.trust >= next.trust;
}

/** Whether the rung held is `rung` or above it on the ladder. False for a rung the ladder has not got. */
export function rankAtLeast(book: Pick<StoryBook, 'tracks'> | null | undefined, ladders: LaddersDef | null | undefined, t: Track, rung: string): boolean {
  const ladder = ladderOf(ladders, t);
  const want = rungIndex(ladder, rung);
  return want >= 0 && rungIndex(ladder, trackOf(book, t).rank) >= want;
}

/** How much heavier an entry in the ISB's file is for the ranks held: every rung's `exposure`, multiplied. One with none. */
export function exposureOf(book: Pick<StoryBook, 'tracks'> | null | undefined, ladders: LaddersDef | null | undefined): number {
  let m = 1;
  for (const t of TRACKS) {
    const r = rungOf(ladderOf(ladders, t), trackOf(book, t));
    if (r) m *= r.exposure;
  }
  return m;
}

/** Which of the five words a Trust is shown in, from nought. */
export function trustBand(trust: number, bands: readonly number[] = STANDING_TUNE.trustBands): number {
  let n = 0;
  for (const b of bands) if (trust >= b) n++;
  return Math.min(4, n);
}

/** The words a Trust is shown in: the story's own five, or ours. */
export function trustWords(trust: number, ladders: LaddersDef | null | undefined): string {
  const words = ladders?.trustWords ?? TRUST_WORDS;
  return words[trustBand(trust)] ?? words[0];
}

/**
 * How far a track is from the rung held to the next, as a share from nought to one in steps of `barStep`, or
 * null at the top of the ladder. The numbers themselves are never shown: this is the bar.
 */
export function barToNext(rec: TrackRec, ladder: Ladder): number | null {
  const next = nextRungOf(ladder, rec);
  if (!next) return null;
  const held = rungOf(ladder, rec);
  const lo = held ? held.standing : 0;
  const span = next.standing - lo;
  const share = span <= 0 ? (rec.standing >= next.standing ? 1 : 0) : Math.max(0, Math.min(1, (rec.standing - lo) / span));
  const step = STANDING_TUNE.barStep;
  return Math.round(Math.floor(share / step + 1e-9) * step * 1000) / 1000;
}

// ---- changing a track: each answers the whole new record, never a change in place --------------------------

/** Standing as a track may hold it: nought to `standingMax`. */
export function clampStanding(n: number): number {
  return Math.max(0, Math.min(STANDING_TUNE.standingMax, n));
}

/** Trust as anybody may hold it: `trustMin` to `trustMax`. */
export function clampTrust(n: number): number {
  return Math.max(STANDING_TUNE.trustMin, Math.min(STANDING_TUNE.trustMax, n));
}

/** A named person's own Standing toward the character: `npcStandingMin` to `npcStandingMax`. */
export function clampNpcStanding(n: number): number {
  return Math.max(STANDING_TUNE.npcStandingMin, Math.min(STANDING_TUNE.npcStandingMax, n));
}

/** A record with one more line of history, held to `historyMax` from the newest, and never past what the book takes. */
export function withHistory(rec: TrackRec, at: number, what: string, from: string | number | null | undefined, to: string | number | null | undefined, max = STANDING_TUNE.historyMax): TrackRec {
  const history: TrackHistory[] = [...(rec.history ?? []), { at, what, from: from ?? null, to: to ?? null }];
  const keep = Math.max(1, Math.min(BOOK_LIMITS.trackHistory, max));
  while (history.length > keep) history.shift();
  return { ...rec, history };
}

/** What a change of rank or status says on the message line: the facts, whose words are `notes.ts`'s. */
export type RankWhat = 'promoted' | 'demoted' | 'suspended' | 'reinstated' | 'burned' | 'assigned' | 'used' | 'active';

/** A track's record with its rank moved to `to` (an index on its ladder; -1 is no rank), and the history saying so. */
function toRung(rec: TrackRec, ladder: Ladder, to: number, at: number, what: 'promote' | 'demote'): TrackRec {
  const id = to >= 0 ? (ladder.rungs[to]?.id ?? null) : null;
  return withHistory({ ...rec, rank: id }, at, what, rec.rank ?? null, id);
}

/** Up one rung, or null at the top. */
export function promoted(rec: TrackRec, ladder: Ladder, at: number): TrackRec | null {
  const i = rungIndex(ladder, rec.rank);
  return i + 1 < ladder.rungs.length ? toRung(rec, ladder, i + 1, at, 'promote') : null;
}

/** Down `n` rungs (to no rank at the bottom), with every job the rungs left behind close, or null with no rank to lose. */
export function demoted(rec: TrackRec, ladder: Ladder, n: number, at: number): { rec: TrackRec; closes: string[] } | null {
  const i = rungIndex(ladder, rec.rank);
  if (i < 0) return null;
  const to = Math.max(-1, i - Math.max(1, Math.floor(n)));
  const closes: string[] = [];
  for (let k = i; k > to; k--) for (const q of ladder.rungs[k]?.closes ?? []) if (!closes.includes(q)) closes.push(q);
  return { rec: toRung(rec, ladder, to, at, 'demote'), closes };
}

/** A status taken (`used`, `active`), with a cell where one is named, or null when there is nothing to change. A burned track is taken back only by `activate`. */
export function withStatus(rec: TrackRec, status: 'used' | 'active', at: number, cell?: string | null): TrackRec | null {
  const was = rec.status ?? 'none';
  if (status === 'used' && (was === 'active' || was === 'burned' || was === 'suspended')) return null;
  const sameCell = cell === undefined || cell === null || rec.cell === cell;
  if (was === status && sameCell) return null;
  let next: TrackRec = { ...rec, status };
  if (was !== status) next.since = at;
  if (status === 'active') delete next.suspendedUntil;
  if (cell !== undefined && cell !== null) next.cell = cell;
  next = withHistory(next, at, status === 'used' ? 'use' : 'activate', was, status);
  if (!sameCell) next = withHistory(next, at, 'cell', rec.cell ?? null, cell);
  return next;
}

/** Suspended for so long: the status before it is in the history, and comes back when the time runs out. Null for a track not taken on. */
export function suspended(rec: TrackRec, until: number, at: number): TrackRec | null {
  const was = rec.status ?? 'none';
  if (was === 'none' || was === 'burned') return null;
  // A suspension lengthened or shortened keeps the status the first one took the track from.
  const from = was === 'suspended' ? statusBeforeSuspension(rec) : was;
  return withHistory({ ...rec, status: 'suspended', suspendedUntil: until, since: at }, at, 'suspend', from, 'suspended');
}

/** A suspension whose time has run out, lifted: the status it took the track from. Null when there is none to lift. */
export function liftSuspension(rec: TrackRec, now: number): TrackRec | null {
  if (rec.status !== 'suspended' || rec.suspendedUntil === undefined || now < rec.suspendedUntil) return null;
  const back = statusBeforeSuspension(rec);
  const next: TrackRec = { ...rec, status: back, since: rec.suspendedUntil };
  delete next.suspendedUntil;
  return withHistory(next, rec.suspendedUntil, 'reinstate', 'suspended', back);
}

/** Burned: no rank, no cell, Standing back to the ladder's floor, Trust nought, and what was burned remembered. */
export function burned(rec: TrackRec, ladder: Ladder, at: number): TrackRec {
  const from = rec.cell ?? rec.rank ?? rec.burnedFrom;
  const next: TrackRec = { ...rec, rank: null, cell: null, standing: clampStanding(ladder.floor), trust: 0, status: 'burned', since: at };
  if (from) next.burnedFrom = from;
  delete next.suspendedUntil;
  return withHistory(next, at, 'burn', rec.rank ?? rec.status ?? null, 'burned');
}

/** Assigned to one of the Empire's divisions (any track takes one; the checker warns off any but the Empire's). */
export function assigned(rec: TrackRec, division: Division, at: number): TrackRec | null {
  if (rec.division === division) return null;
  return withHistory({ ...rec, division }, at, 'assign', rec.division ?? null, division);
}

export function isDivision(x: unknown): x is Division {
  return typeof x === 'string' && (DIVISIONS as readonly string[]).includes(x) && !FORBIDDEN_KEYS.includes(x);
}

// ---- what the player is shown ------------------------------------------------------------------------------

/** One track as the Standing tab shows it: the rank in words, a bar to the next rung, Trust in words, and how it stands. Never a number. */
export interface TrackView {
  track: Track;
  /** The rung held, by its name, or null with none. */
  rank: string | null;
  rankId: string | null;
  /** The next rung's name, or null at the top (or with no ladder). */
  next: string | null;
  /** How far to the next rung, a share in steps of `barStep`, or null at the top. */
  bar: number | null;
  trust: string;
  status: TrackStatus;
  /** The next rung waits on the story's own promotion beat. */
  ready: boolean;
  division?: Division;
  cell?: string;
  /** What a burn took, by name, for a burned track. */
  burnedFrom?: string;
}

export interface StandingView {
  tracks: TrackView[];
  /** Experience recorded. It counts for nothing yet. */
  xp: number;
}

/** What the Standing tab shows of a book: every track that has anything on it, in the tracks' own order. */
export function standingView(book: StoryBook, ladders: LaddersDef | null | undefined, now: number): StandingView {
  const tracks: TrackView[] = [];
  for (const t of TRACKS) {
    const rec = trackOf(book, t);
    const ladder = ladderOf(ladders, t);
    const status = statusOf(rec, now);
    const held = rungOf(ladder, rec);
    const next = nextRungOf(ladder, rec);
    const any = ownOf(book.tracks as Record<string, TrackRec> | undefined, t) !== undefined;
    if (!any && !ladder.rungs.length) continue;
    const v: TrackView = { track: t, rank: held ? held.name : null, rankId: held ? held.id : null, next: next ? next.name : null, bar: barToNext(rec, ladder), trust: trustWords(rec.trust, ladders), status, ready: rankReady(book, ladders, t, now) };
    if (rec.division) v.division = rec.division;
    if (rec.cell) v.cell = rec.cell;
    if (status === 'burned' && rec.burnedFrom) v.burnedFrom = ladder.rungs[rungIndex(ladder, rec.burnedFrom)]?.name ?? rec.burnedFrom;
    tracks.push(v);
  }
  return { tracks, xp: book.xp ?? 0 };
}
