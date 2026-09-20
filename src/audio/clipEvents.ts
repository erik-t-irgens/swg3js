/**
 * When a clip says something happens.
 *
 * The game's own animations carry messages: `event_footstep` on the frames a foot lands,
 * `event_vocalize`, `event_hitheavy`, `event_hitground` and the emote voices. Jedi Academy's
 * animations carry the same idea in `animevents.cfg`, split into an upper-body list and a
 * lower-body list. The converter turns both into a fraction of the clip (frame divided by frame
 * count), so a clip the packs play faster or slower than it was written still speaks in time: the
 * fraction is mapped onto whatever duration the action playing it actually has.
 *
 * Three things make this harder than "compare a time each frame", and all three cost silent or
 * doubled feet when they are got wrong:
 *  - a looping clip wraps, so a frame can cross the end and the beginning;
 *  - the player's body plays a clip's upper and lower halves as two actions of its own, and a mobile
 *    blends a walk into a run, so several actions carry the same foot events at once;
 *  - an action can be restarted, reversed, faded out or left behind entirely.
 *
 * So the rule is: foot events come from a whole clip or a lower half, and only from the one such
 * action a body has with the greatest weight; everything else comes from a whole clip or an upper
 * half carrying at least half the weight. Nothing here touches Web Audio, three.js or a clock -- a
 * rig fills in a small record per action it is playing and this says which events were crossed --
 * so the whole of it is checked by the node test with numbers, which is the only way it can be
 * checked at all in a tab that can hear nothing.
 */

/** Which half of the body an action drives. A rig's halves are the same clip split at the spine. */
export type ClipHalf = 'whole' | 'upper' | 'lower';

/** What an event is for, which decides who may speak it and what plays. */
export type ClipEventKind = 'foot' | 'event' | 'sound' | 'voice';

/** One event of one clip, at a fraction of it. */
export interface ClipEvent {
  /** The event's own name with the game's `event_` prefix taken off (`footstep`, `vocalize`). */
  name: string;
  /** Where in the clip it happens, 0 at the first frame and 1 at the last. */
  f: number;
  kind: ClipEventKind;
  /** Jedi Academy names a file pattern rather than an event (`sound/weapons/saber/saberhup%d.wav`). */
  sound?: string;
  /** The pattern's index range, both ends included. */
  range?: [number, number];
  /** How often it plays at all, out of a hundred, in which nought means always; Jedi Academy's own carry one. */
  chance?: number;
}

/** One action a body is playing now, as its rig reports it. Filled into a pooled record per frame. */
export interface ActiveClip {
  /** The clip's own name, with any half prefix already taken off. */
  name: string;
  half: ClipHalf;
  /** The action's time in the clip's own seconds. */
  time: number;
  duration: number;
  /** Signed: a clip played backwards has a negative one. */
  timeScale: number;
  /** Its effective weight, 0 to 1. */
  weight: number;
  /** Whether it repeats; a one-shot that has run out simply stops moving. */
  looping: boolean;
  /** The action itself, used as an identity to remember where it had got to. Never read. */
  token: object;
}

/** Somewhere to put a crossed event. `clip` is the record the event came from and is not kept. */
export type ClipEventSink = (event: ClipEvent, clip: ActiveClip) => void;

export interface ClipEventTune {
  /**
   * INVENTED: the most of a clip one frame may be taken to have crossed. A frame's dt is already
   * capped at 0.05 s, but a tab that was away, or a clip at a tenfold time scale, can otherwise
   * jump most of a walk and fire both feet at once. Past this the events are skipped and the clock
   * is simply moved on.
   */
  maxStep: number;
  /**
   * INVENTED: an action must carry at least this much weight for anything but a foot to speak, so a
   * pose fading out does not grunt on its way.
   */
  speakWeight: number;
  /** INVENTED: a foot event under this weight is ignored even when it is the heaviest action. */
  footWeight: number;
}

/** Ours, all three; `__debug.footsteps({ ... })` moves them live. */
export const CLIP_EVENT_TUNE: ClipEventTune = { maxStep: 0.5, speakWeight: 0.5, footWeight: 0.15 };

/**
 * What the converter writes at `sounds/clipEvents.json`. The shapes below are the converter's own;
 * a few older spellings are read as well, because a pack on disk from a run before this was built
 * should still give a body its feet rather than nothing at all.
 */
export interface ClipEventPack {
  format?: number;
  /** Events by the source animation's own path (`appearance/animation/all_b_loc_run.ans`). */
  clips?: Record<string, ClipEntry | RawClipEvent[]>;
  events?: Record<string, ClipEntry | RawClipEvent[]>;
  /** Jedi Academy's: its clips by name, each with the two blocks its file keeps. */
  jka?: { clips?: Record<string, ClipEntry>; voices?: string[] } | Record<string, ClipEntry>;
  /**
   * The player species: each one's animation table, the client data it speaks from, and per table
   * the clip name to animation map the packs do not carry.
   */
  species?: { tables?: Record<string, Record<string, string>>; species?: Record<string, SpeciesEntry> };
  /** A mobile's template to its client data file, which only the template chain can say. */
  mobiles?: Record<string, string>;
  [key: string]: unknown;
}

/** One clip's record: its timing, and its events as one list or as the two halves. */
export interface ClipEntry {
  frames?: number;
  fps?: number;
  loop?: number;
  reverse?: boolean;
  events?: RawClipEvent[];
  upper?: RawClipEvent[];
  lower?: RawClipEvent[];
}

/** One of Jedi Academy's clips, whose file keeps its marks as a torso list and a legs list. */
interface JkaClip {
  whole: ClipEvent[] | null;
  upper: ClipEvent[] | null;
  lower: ClipEvent[] | null;
  /** The two lists merged in order, for an action driving the whole body; made on the first ask. */
  both: ClipEvent[] | null;
}

export interface SpeciesEntry {
  template?: string;
  sat?: string;
  /** The animation table its clip names are listed under. */
  table?: string;
  clientData?: string;
}

/** One event as the converter writes it, and as a couple of older spellings wrote it. */
export interface RawClipEvent {
  /** The game's own animations name theirs, prefix and all (`event_footstep`). */
  name?: string;
  event?: string;
  /** Jedi Academy's are typed instead: `footstep`, `sound`, `voice`, `effect`. */
  type?: string;
  /** The character's own voice set (`pain25`, `death%d`), with the star already taken off. */
  voice?: string;
  /** The fraction of the clip, which is what is played against the action's own duration. */
  f?: number;
  /** A frame number, read against `frames` when there is no fraction. */
  frame?: number;
  frames?: number;
  /** Seconds into the clip, with the clip's own length beside it. */
  t?: number;
  duration?: number;
  sound?: string;
  pattern?: string;
  range?: [number, number];
  chance?: number;
  kind?: string;
}

/** The names the game's own animations carry, so a `sound_x` or a `hpevent_x` is told from a voice. */
const EVENT_PREFIX = /^event_/;
/** Jedi Academy writes a player's own voice with a star (`*jump`); the species' sounds stand in for them. */
const JKA_VOICE = /^\*/;

/** An event's kind from its name, which is how a pack that does not say gets one. */
export function kindOf(name: string, sound?: string): ClipEventKind {
  if (/footstep/i.test(name)) return 'foot';
  if (JKA_VOICE.test(name)) return 'voice';
  if (sound) return 'sound';
  return 'event';
}

/** One raw event from a pack, in this game's own shape; null when it says nothing usable. */
export function normalizeEvent(raw: RawClipEvent): ClipEvent | null {
  if (!raw) return null;
  // Jedi Academy's are typed rather than named, and its voice lines name a set of the character's
  // own (`pain25`), which the body answers with its species' own sound.
  const typed = raw.type;
  const rawName = raw.name ?? raw.event ?? (typed === 'voice' ? `*${raw.voice ?? ''}` : (typed ?? ''));
  const sound = raw.sound ?? raw.pattern;
  if (!rawName && !sound) return null;
  let f = raw.f;
  if (f === undefined && raw.frame !== undefined) f = raw.frames && raw.frames > 1 ? raw.frame / (raw.frames - 1) : raw.frame;
  if (f === undefined && raw.t !== undefined) f = raw.duration && raw.duration > 0 ? raw.t / raw.duration : raw.t;
  if (f === undefined || !Number.isFinite(f)) return null;
  // A fraction past the end (a message on the frame after the last) lands on the last frame rather
  // than never being crossed at all.
  const at = f < 0 ? 0 : f > 1 ? 1 : f;
  const name = rawName.replace(EVENT_PREFIX, '');
  // A Jedi Academy `AEV_EFFECT` line names a particle, not a sound: kept as a sound event, which
  // nothing plays, rather than looked for in a body's client data and reported missing every time.
  const kind = (raw.kind as ClipEventKind | undefined) ?? (typed === 'effect' ? 'sound' : kindOf(rawName, sound));
  const out: ClipEvent = { name: name || (sound ?? ''), f: at, kind };
  if (sound) out.sound = sound;
  if (raw.range) out.range = raw.range;
  if (raw.chance !== undefined) out.chance = raw.chance;
  return out;
}

/** A whole list, sorted by fraction so a frame's crossing walk is one pass. */
function normalizeList(raw: readonly RawClipEvent[] | undefined): ClipEvent[] {
  const out: ClipEvent[] = [];
  for (const r of raw ?? []) {
    const e = normalizeEvent(r);
    if (e) out.push(e);
  }
  out.sort((a, b) => a.f - b.f);
  return out;
}

/**
 * Which events a step over a clip crossed, as indices into the list, in the order they happen.
 * `prev` and `now` are times in the clip's own seconds.
 *
 * Pure and allocation-free: `out` is cleared and refilled, and the count is returned.
 *  - forwards, `prev < now`: the half-open span `(prev, now]`, so a frame boundary never fires twice;
 *  - a loop's wrap (`now < prev` while looping): `(prev, 1]` then `[0, now]`;
 *  - backwards (a negative time scale): the same spans, in reverse;
 *  - a restart (`now < prev`, not looping): `[0, now]`, since the action began again.
 *
 * The two spans that begin at the clip's own beginning are closed there, so a mark written on the
 * first frame (a fraction of exactly 0) is crossed once each time round rather than never: the
 * half-open rule is what keeps a frame boundary from firing twice, and no frame ever ends at a
 * time before the clip started.
 */
export function crossed(events: readonly ClipEvent[], prev: number, now: number, duration: number, looping: boolean, backwards: boolean, out: number[]): number {
  out.length = 0;
  if (!events.length || !(duration > 0)) return 0;
  const a = clampTime(prev, duration);
  const b = clampTime(now, duration);
  if (a === b) return 0;
  // Both ends are fractions from here on (`clampTime` divided by the duration), and so is every
  // event's own `f`: the far end of a wrap is 1, never the duration in seconds. A clip of a second
  // or longer hides the difference, and 712 of the 2,350 clips in the first sixty animation packs
  // are shorter than that, so the marks in the last part of a short looping clip were being dropped.
  if (backwards) {
    if (b < a) span(events, b, a, out, true);
    else {
      // Wrapped off the beginning: from here back to the start, then from the end back to there.
      span(events, 0, a, out, true);
      span(events, b, 1, out, true);
    }
    return out.length;
  }
  if (b > a) span(events, a, b, out, false);
  else if (looping) {
    span(events, a, 1, out, false);
    span(events, FROM_START, b, out, false);
  } else {
    // Not looping and the time went backwards: the action was started again from `0`.
    span(events, FROM_START, b, out, false);
  }
  return out.length;
}

/** A lower bound under every fraction there is, which is how a span closed at 0 is asked for. */
const FROM_START = -1;

/** The events in `(from, to]` as fractions of the clip, appended to `out` (in reverse when asked). */
function span(events: readonly ClipEvent[], from: number, to: number, out: number[], reverse: boolean): void {
  if (reverse) {
    for (let i = events.length - 1; i >= 0; i--) {
      const t = events[i].f;
      if (t > from && t <= to) out.push(i);
    }
    return;
  }
  for (let i = 0; i < events.length; i++) {
    const t = events[i].f;
    if (t > from && t <= to) out.push(i);
  }
}

/** An event's fraction is compared as a fraction, so this only keeps a time inside the clip. */
function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(t)) return 0;
  const f = t / duration;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * The pack, and the two lookups the game does with it: a clip name to its events, and Jedi
 * Academy's clips to the two halves of theirs. It holds no state of its own beyond the pack, so a
 * node test can build one from a literal.
 */
export class ClipEventIndex {
  /** Events by source path. */
  private readonly byPath = new Map<string, ClipEvent[]>();
  /**
   * Jedi Academy's, by clip name: its file keeps a torso list and a legs list per clip, and a whole
   * clip wants them merged. Kept as one record per clip rather than under a `jka:<clip>:<half>`
   * string key, because the lookup runs for every action of every body every frame and building
   * that key would allocate a string each time.
   */
  private readonly jkaClips = new Map<string, JkaClip>();
  /** A clip name to its source path, by scope (a species or a pack id); `''` is the shared map. */
  private readonly names = new Map<string, Map<string, string>>();
  /** A species (by id and by template) to the client data it speaks from. */
  private readonly speciesData = new Map<string, string>();
  /** A mobile's template to its client data, which only the template chain can say. */
  private readonly mobileData = new Map<string, string>();
  private loaded = false;
  private packFormat = 0;
  /** Names asked for that the pack knows nothing about, for the report; each is counted once. */
  readonly unknown = new Set<string>();
  /** The same names without their scope, so a miss already reported builds no string at all. */
  private readonly unknownNames = new Set<string>();
  readonly counts = { paths: 0, jka: 0, names: 0, asked: 0, hits: 0, misses: 0 };

  get ready(): boolean {
    return this.loaded;
  }

  get format(): number {
    return this.packFormat;
  }

  /**
   * Read a pack. Every shape below is allowed on purpose: the converter writes one of them, and a
   * runtime that refuses the others would leave every foot silent rather than say what it found.
   */
  adopt(pack: ClipEventPack | null): void {
    if (!pack) return;
    this.packFormat = pack.format ?? 0;
    for (const [path, entry] of Object.entries(pack.clips ?? pack.events ?? {})) this.addPath(path, entry);
    // Jedi Academy's, under its own container or written straight out as a map of clips.
    const jka = pack.jka as { clips?: Record<string, ClipEntry> } | Record<string, ClipEntry> | undefined;
    const jkaClips = (jka && 'clips' in jka ? (jka as { clips?: Record<string, ClipEntry> }).clips : (jka as Record<string, ClipEntry> | undefined)) ?? {};
    for (const [clip, entry] of Object.entries(jkaClips)) {
      const name = clip.replace(/^jka:/, '').toUpperCase();
      if (Array.isArray(entry)) this.addJka(name, 'whole', entry as RawClipEvent[]);
      else {
        if (entry?.upper) this.addJka(name, 'upper', entry.upper);
        if (entry?.lower) this.addJka(name, 'lower', entry.lower);
        if (entry?.events) this.addJka(name, 'whole', entry.events);
      }
    }
    // The species: each one's own clip names (through the animation table it shares with the rest)
    // and the client data file it speaks from, which only its template chain could say.
    const tables = pack.species?.tables ?? {};
    for (const [id, entry] of Object.entries(pack.species?.species ?? {})) {
      const table = entry?.table ? tables[entry.table] : null;
      if (table) for (const [clip, path] of Object.entries(table)) this.addName(id, clip, path);
      if (entry?.clientData) this.speciesData.set(id, entry.clientData);
      if (entry?.template && entry.clientData) this.speciesData.set(entry.template, entry.clientData);
    }
    for (const [template, file] of Object.entries(pack.mobiles ?? {})) if (typeof file === 'string') this.mobileData.set(template, file);
    this.loaded = this.byPath.size > 0 || this.jkaClips.size > 0 || this.names.size > 0;
    this.counts.paths = this.byPath.size;
    this.counts.names = [...this.names.values()].reduce((n, m) => n + m.size, 0);
  }

  private addPath(path: string, entry: ClipEntry | RawClipEvent[] | undefined): void {
    if (!path || !entry) return;
    if (path.startsWith('jka:')) {
      const rest = path.slice(4);
      const cut = rest.lastIndexOf(':');
      const half = cut > 0 ? rest.slice(cut + 1) : '';
      const raw = Array.isArray(entry) ? entry : (entry.events ?? []);
      if (half === 'upper' || half === 'lower') this.addJka(rest.slice(0, cut), half, raw);
      else this.addJka(rest, 'whole', raw);
      return;
    }
    const list = normalizeList(Array.isArray(entry) ? entry : entry.events);
    if (list.length) this.byPath.set(path, list);
  }

  private addJka(clip: string, half: ClipHalf, raw: readonly RawClipEvent[]): void {
    const list = normalizeList(raw);
    if (!list.length) return;
    let row = this.jkaClips.get(clip);
    if (!row) {
      row = { whole: null, upper: null, lower: null, both: null };
      this.jkaClips.set(clip, row);
    }
    row[half] = list;
    // A block arriving after the merge was made (two spellings of the same pack) invalidates it.
    row.both = null;
    this.counts.jka++;
  }

  /**
   * A scope's own clip names, for a pack the converter did not write a map for: a mobile's
   * animation pack names the `.ans` each of its clips was baked from, so the pack itself is the
   * map. Registered once per pack, not per body.
   */
  registerNames(scope: string, entries: Iterable<readonly [string, string]>): void {
    let added = 0;
    for (const [clip, path] of entries) {
      this.addName(scope, clip, path);
      added++;
    }
    if (added) this.counts.names += added;
  }

  /** Whether a scope's names are already registered, so a pack is walked once. */
  hasScope(scope: string): boolean {
    return this.names.has(scope);
  }

  /** The client data a player species speaks from, by its pack id or its template. */
  clientDataForSpecies(id: string): string | null {
    return this.speciesData.get(id) ?? null;
  }

  /** The client data a mobile speaks from, by its object template. */
  clientDataForTemplate(template: string): string | null {
    return this.mobileData.get(template) ?? null;
  }

  private addName(scope: string, clip: string, path: string): void {
    if (!clip || !path) return;
    let map = this.names.get(scope);
    if (!map) {
      map = new Map<string, string>();
      this.names.set(scope, map);
    }
    map.set(clip, path);
  }

  /**
   * The events of one clip as one action plays it. `scope` is the species or pack the clip belongs
   * to, so two skeletons' clips of the same name find their own animation. Null when the pack knows
   * nothing of it, which is a great many clips: only 3,308 of the game's 8,351 carry messages.
   */
  eventsFor(name: string, half: ClipHalf, scope: string | null): ClipEvent[] | null {
    this.counts.asked++;
    const found = this.lookup(name, half, scope);
    if (found) this.counts.hits++;
    else {
      this.counts.misses++;
      // Only a name not already in the set builds the string: a handful of repeating unknown clips
      // would otherwise allocate one apiece every frame for the life of the session.
      if (this.unknown.size < 200 && !this.unknownNames.has(name)) {
        this.unknownNames.add(name);
        this.unknown.add(scope ? `${scope}/${name}` : name);
      }
    }
    return found;
  }

  private lookup(name: string, half: ClipHalf, scope: string | null): ClipEvent[] | null {
    if (!name) return null;
    // Jedi Academy's clips keep two blocks: the legs' marks and the torso's. An action driving one
    // half speaks that half's alone; one driving the whole body speaks both, merged once and kept,
    // or a death's cry (an upper mark) would be lost under its own footsteps.
    if (/^(BOTH|TORSO|LEGS)_/.test(name)) {
      const row = this.jkaClips.get(name);
      if (!row) return null;
      if (half !== 'whole') return row[half] ?? row.whole ?? null;
      if (row.both) return row.both;
      const parts: ClipEvent[][] = [];
      if (row.lower) parts.push(row.lower);
      if (row.upper) parts.push(row.upper);
      if (row.whole) parts.push(row.whole);
      if (!parts.length) return null;
      if (parts.length === 1) return parts[0];
      // Merged once and then kept on the row, so nothing allocates after the first ask.
      const merged = parts.flat().sort((a, b) => a.f - b.f);
      row.both = merged;
      return merged;
    }
    // A mobile hands over its source path outright.
    const direct = this.byPath.get(name);
    if (direct) return direct;
    if (scope) {
      const path = this.names.get(scope)?.get(name);
      if (path) return this.byPath.get(path) ?? null;
    }
    const shared = this.names.get('')?.get(name);
    if (shared) return this.byPath.get(shared) ?? null;
    return null;
  }

  status(): Record<string, unknown> {
    return {
      ready: this.loaded,
      format: this.packFormat,
      clips: this.byPath.size + this.jkaClips.size,
      jkaClips: this.jkaClips.size,
      jkaLists: this.counts.jka,
      clipNames: this.counts.names,
      speciesWithClientData: this.speciesData.size,
      mobilesWithClientData: this.mobileData.size,
      scopes: [...this.names.keys()].slice(0, 12),
      counts: { ...this.counts },
      unknownClips: [...this.unknown].slice(0, 12),
    };
  }
}

/**
 * One body's watch over the actions it is playing. It remembers where each action had got to, so a
 * frame is a comparison per event of the clips that carry any, and nothing is allocated.
 */
export class ClipWatcher {
  readonly tune: ClipEventTune;
  /** Where each action was last seen, and on which pass, so an action left behind is forgotten. */
  private readonly at = new Map<object, { time: number; pass: number }>();
  private pass = 0;
  private readonly hits: number[] = [];
  /** Counted for the report: events crossed, and steps too big to be believed. */
  readonly counts = { fired: 0, skippedBigStep: 0, actions: 0 };

  constructor(tune: ClipEventTune = CLIP_EVENT_TUNE) {
    this.tune = tune;
  }

  /**
   * The events this body crossed since its last step. `clips` holds the actions it is playing (only
   * the first `count` of them are read, so the caller keeps one pooled array).
   *
   * Every event is handed to `sink` in the order it happened. Nothing is played here: this says
   * what happened, and the caller decides what it sounds like.
   */
  step(clips: readonly ActiveClip[], count: number, index: ClipEventIndex, scope: string | null, sink: ClipEventSink): void {
    this.pass++;
    this.counts.actions = count;
    // Which action's feet speak: the heaviest whole or lower-half action, so a walk blending into a
    // run steps once, not twice. Chosen before anything fires, since the events are walked in order.
    let footToken: object | null = null;
    let footWeight = this.tune.footWeight;
    for (let i = 0; i < count; i++) {
      const c = clips[i];
      if (c.half === 'upper' || c.weight <= footWeight) continue;
      footWeight = c.weight;
      footToken = c.token;
    }
    for (let i = 0; i < count; i++) {
      const c = clips[i];
      const events = index.eventsFor(c.name, c.half, scope);
      const seen = this.at.get(c.token);
      const prev = seen ? seen.time : c.time;
      if (seen) {
        seen.time = c.time;
        seen.pass = this.pass;
      } else this.at.set(c.token, { time: c.time, pass: this.pass });
      // An action met for the first time, or met again after this body was out of range, speaks
      // nothing: its clock is simply picked up where it stands, or a walk away and back would fire
      // every step it took meanwhile in one frame.
      if (!seen || !events) continue;
      const duration = c.duration > 0 ? c.duration : 0;
      if (!duration) continue;
      const backwards = c.timeScale < 0;
      // How far the clip actually ran, which is not the difference of the two times: a loop that
      // wrapped went from `prev` to the end and on from the beginning. A step past the tuned share
      // of the clip is a tab that was away or a clip shorter than a frame, and firing everything it
      // passed would put both feet down at once, so the clock is moved on in silence instead.
      const delta = c.time - prev;
      const travel = backwards ? (delta <= 0 ? -delta : c.looping ? prev + (duration - c.time) : c.time) : delta >= 0 ? delta : c.looping ? duration - prev + c.time : c.time;
      if (travel / duration > this.tune.maxStep) {
        this.counts.skippedBigStep++;
        continue;
      }
      const n = crossed(events, prev, c.time, duration, c.looping, backwards, this.hits);
      for (let k = 0; k < n; k++) {
        const e = events[this.hits[k]];
        if (e.kind === 'foot') {
          if (c.token !== footToken) continue;
        } else if (c.half === 'lower' || c.weight < this.tune.speakWeight) continue;
        this.counts.fired++;
        sink(e, c);
      }
    }
    this.sweep();
  }

  /** An action nobody is playing any more is forgotten, so a long session keeps a handful of records. */
  private sweep(): void {
    if (this.at.size < 16) return;
    for (const [token, seen] of this.at) if (this.pass - seen.pass > 4) this.at.delete(token);
  }

  /** The body went out of range or was put back: every clock is picked up afresh, and nothing fires. */
  forget(): void {
    this.at.clear();
  }
}
