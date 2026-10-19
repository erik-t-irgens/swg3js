// The loading screens' own numbers and rules (the performance pass's first wave), and the record of what the last
// trip's screens did (`__debug.loading()`).
//
// What a screen decides is pure and lives here so a node test drives it: when the sweep that compiles the scene behind
// a screen waits a frame (`sweepYield`), whether a race start needs a curtain at all (`raceCurtainNeed`, over the
// counts `courseCounts` makes) and how its loads are bounded (`loadBounded`), where a place on another world stands in
// the game's frame before the world is loaded (`poisCentreOf`, `placeFromPois`), whether that world's layout agrees
// with the place's own centre once it is (`centreAgrees`), when the screen covers the picture (`opaqueAt`), and what
// was built after it lifted for the bodies it had up (`programsForUp`). Every number is ours and a
// technical bound, never a matter of feel: how long a screen may work before it shows the bar moving, how long it
// waits for the bodies it stood, how often it draws the world behind itself, how wide a race start's "beside the
// grid" is.
//
// Nothing here reads a clock of its own or touches a page: the record is handed the time with every call. Pure; node
// loads it.

export const LOADING_TUNE = {
  /**
   * Behind a screen the sweep compiles batch after batch for this long before it waits a frame, unless a batch built
   * a program (which a frame then shows on the bar). 0 is the old frame per batch, for comparing: the frame per eight
   * objects was 28 of a 44-second screen at Mos Eisley, its work 0.45 s. The shortest that still moves the bar.
   */
  sliceMs: 10,
  /** How long a screen waits for the bodies it stood to be up (`World.bodiesUp`): a dungeon copy's own number. */
  standWaitMs: 8000,
  /** Behind a fully opaque screen the world is drawn at most this often (every frame during the reveal and in play). */
  drawEveryMs: 100,
  /** The switch for `drawEveryMs`: on only while the arrival's smoke shows no program moved into play by it. */
  screenDraws: true,
  /** The window `__debug.loading().after` counts programs and long frames in after a screen lifts, seconds. */
  afterS: 30,
  /** Metres: a pack whose layout centre differs from its `pois.json` centre by more than this runs the old second phase. */
  centreSlack: 0.5,
  /** Metres between the points a course's legs are sampled at for the models along it (`modelsAlong`). */
  courseStep: 100,
  /** Metres: a hull farther than this from the grid is a teleport, and a race start then needs a curtain (one chunk). */
  courseNear: 64,
  /** A course curtain's missing models are loaded this many at a time, as the placed warm loads them. */
  courseLoads: 4,
  /** A far course curtain waits at most this long, ms, for the grid's ground and colliders (`World.settled`). */
  gridSettleMs: 10000,
  /** A course curtain goes without the reveal's glide and its 180 ms. */
  quickHide: true,
  /**
   * How long one screen a session waits after its sweep for the driver check's tries, ms: the first screen whose
   * check is not done, and no other (the check goes on over every later screen's frames without holding it). The
   * check times a link only while nothing of the world's is building one, and bodies stood behind the screen are
   * still landing as it lifts, so with no wait the tries had a tenth of a second and on Vulkan never got one over two
   * arrivals. Three quiet frames are about 50 ms where links are quick. Once a session because the check decides
   * only the Interface page's sentence: a screen held a second on every arrival for it would be paid for nothing.
   */
  driverWaitMs: 1000,
};

export type LoadingTune = typeof LOADING_TUNE;

/** The ranges a number of `LOADING_TUNE` is held to when moved; the switches take a boolean. */
const RANGES: Partial<Record<keyof LoadingTune, [number, number]>> = {
  sliceMs: [0, 500],
  standWaitMs: [0, 60000],
  drawEveryMs: [0, 5000],
  afterS: [1, 600],
  centreSlack: [0, 100],
  courseStep: [10, 1000],
  courseNear: [1, 2000],
  courseLoads: [1, 16],
  gridSettleMs: [0, 60000],
  driverWaitMs: [0, 10000],
};

/** Any of `LOADING_TUNE` moved live, in memory; words for anything refused or held to its range. */
export function tuneLoading(patch: Partial<Record<keyof LoadingTune, unknown>> | null | undefined): string[] {
  const words: string[] = [];
  const t = LOADING_TUNE as unknown as Record<string, number | boolean>;
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!Object.hasOwn(LOADING_TUNE, key)) {
      words.push(`no number called ${key}`);
      continue;
    }
    if (typeof t[key] === 'boolean') {
      if (typeof value !== 'boolean') {
        words.push(`${key} takes true or false`);
        continue;
      }
      t[key] = value;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      words.push(`${key} takes a number`);
      continue;
    }
    const [lo, hi] = RANGES[key as keyof LoadingTune] ?? [0, Number.POSITIVE_INFINITY];
    const n = Math.min(hi, Math.max(lo, value));
    if (n !== value) words.push(`${key} held to ${lo} to ${hi}: ${n}`);
    t[key] = n;
  }
  return words;
}

/**
 * Whether the sweep that compiles the scene waits a frame after a batch. In play (the Effects switch's sweep, which
 * goes on drawing the old picture meanwhile) every batch does, as it always has. Behind a screen only a batch that
 * built a program, which the bar then shows, or once `sliceMs` of work has gone by since the last wait.
 */
export function sweepYield(built: number, elapsedMs: number, behindScreen: boolean, sliceMs: number): boolean {
  if (!behindScreen) return true;
  return built > 0 || elapsedMs >= sliceMs;
}

/** What a race start must do before its countdown: nothing, or a course curtain, with the first reason that holds. */
export interface CurtainNeed {
  need: 'none' | 'course';
  why: string;
}

/**
 * Whether a race start beside its grid can go with no curtain at all: only when the hull is within `courseNear` of
 * the grid, the grid's ground and colliders are in, every model along the course is loaded and warmed, and nothing is
 * left on the program queue. A start with no curtain can load and warm nothing (no screen is up), so the test is
 * strict; the first reason that holds is the one given, in this order.
 */
export function raceCurtainNeed(n: { hullToGrid: number; settled: boolean; pending: number; missing: number; unwarmed: number }, near = LOADING_TUNE.courseNear): CurtainNeed {
  if (!(n.hullToGrid <= near)) return { need: 'course', why: `the hull is ${Number.isFinite(n.hullToGrid) ? Math.round(n.hullToGrid) : '?'} m from the grid` };
  if (!n.settled) return { need: 'course', why: "the grid's ground is not in yet" };
  if (n.missing > 0) return { need: 'course', why: `${n.missing} of the course's models ${n.missing === 1 ? 'is' : 'are'} not loaded` };
  if (n.unwarmed > 0) return { need: 'course', why: `${n.unwarmed} of the course's models ${n.unwarmed === 1 ? 'is' : 'are'} not warmed` };
  if (n.pending > 0) return { need: 'course', why: `${n.pending} program${n.pending === 1 ? ' is' : 's are'} still queued` };
  return { need: 'none', why: 'everything along the course is in' };
}

/**
 * A place out of a world's `pois.json`, in the game's frame about that file's own centre: the snapshot's x mirrored and
 * both taken about the centre, exactly as `App.teleport` places one once the world is loaded.
 */
export function placeFromPois(centre: { x: number; z: number }, poi: { x: number; z: number }): { x: number; z: number } {
  return { x: -(poi.x - centre.x), z: poi.z - centre.z };
}

/** Whether two centres are both there, finite, and within `slack` metres of each other along x and along z. */
export function centreAgrees(a: { x: number; z: number } | null | undefined, b: { x: number; z: number } | null | undefined, slack: number): boolean {
  if (!a || !b) return false;
  if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(b.x) || !Number.isFinite(b.z)) return false;
  return Math.abs(a.x - b.x) <= slack && Math.abs(a.z - b.z) <= slack;
}

/**
 * The centre a parsed `pois.json` is measured about, or null where it has none worth placing a travel by: missing,
 * either coordinate not a number, or not finite. Null is what sends a travel to a place on another world down the
 * two old phases (`App.teleport`), so nothing that is not plainly a centre may pass for one.
 */
export function poisCentreOf(data: unknown): { x: number; z: number } | null {
  if (!data || typeof data !== 'object') return null;
  const c = (data as { center?: unknown }).center;
  if (!c || typeof c !== 'object') return null;
  const { x, z } = c as { x?: unknown; z?: unknown };
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z };
}

/** The screen's own fade in, `#loading`'s opacity transition in the stylesheet (0.5 s): only after it is the screen whole. */
export const SCREEN_FADE_MS = 500;

/**
 * Whether a loading screen covers the whole picture at `now`: shown, its fade in over, and not yet going away. What
 * `LoadingScreen.opaque` answers, and with `screenDraws` the one thing that lets the world be drawn less often than
 * every frame: false through the fade in and from the moment `hide` begins, so the reveal is always drawn whole.
 */
export function opaqueAt(visible: boolean, hiding: boolean, shownAt: number, now: number): boolean {
  return visible && !hiding && now - shownAt >= SCREEN_FADE_MS;
}

/**
 * The counts a race start's need test is made of (`World.courseNeed`), over the models along the course with whether
 * any copy of each stands in a building's rooms: `missing`, loaded neither yet nor known not to load; `failed`, known
 * not to load (a missing or broken file nothing in play can mend, counted apart so it never asks for a curtain on
 * every start); `unwarmed`, loaded and neither warmed for a course this session (`warmed`) nor warmed whole by the
 * rule `placedStandIns` trusts. **A model with an indoor copy is never warmed whole**: its rooms' pass is built only by
 * a sweep that saw it indoors, which an outdoor tier never is. `warmedWhole` is asked of the materials alone.
 */
export function courseCounts<M>(models: ReadonlyMap<string, boolean>, look: { loaded(id: string): M | null; failed(id: string): boolean; warmed(id: string): boolean; warmedWhole(m: M): boolean }): { missing: number; failed: number; unwarmed: number } {
  let missing = 0;
  let failed = 0;
  let unwarmed = 0;
  for (const [id, indoor] of models) {
    if (look.failed(id)) {
      failed++;
      continue;
    }
    const m = look.loaded(id);
    if (!m) {
      missing++;
      continue;
    }
    if (look.warmed(id)) continue;
    if (indoor || !look.warmedWhole(m)) unwarmed++;
  }
  return { missing, failed, unwarmed };
}

/**
 * Load `ids` at most `lanes` at a time, for at most `ms` and only while `keepOn` holds (a course curtain's loads,
 * `World.loadCourse`): the race between every lane being done and `sleep(ms)` is the bound, so a model whose load
 * never settles cannot hold a curtain open. A lane stops taking new ids once the bound has run out or `keepOn` says
 * no; what is still loading then goes on loading into the streamer's cache. Answers how many loaded within the bound.
 */
export async function loadBounded(ids: readonly string[], load: (id: string) => Promise<unknown>, keepOn: () => boolean, lanes: number, ms: number, sleep: (ms: number) => Promise<void>): Promise<{ loaded: number }> {
  let next = 0;
  let loaded = 0;
  let over = false;
  const lane = async (): Promise<void> => {
    while (!over && next < ids.length && keepOn()) {
      const id = ids[next++];
      try {
        await load(id);
        if (!over) loaded++;
      } catch {
        // A model that will not load is noted by the streamer (`LayoutStreamer.hasFailed`), and is no reason to stop.
      }
    }
  };
  const all = Promise.all(Array.from({ length: Math.max(1, Math.floor(lanes)) }, () => lane()));
  await Promise.race([all, sleep(Math.max(0, ms))]);
  over = true;
  return { loaded };
}

/**
 * How many programs were built for the bodies up as a screen lifted, inside the window after it (`__debug.loading()`'s
 * `after.forUp`, T7's own figure): the distinct programs in those bodies' materials' records (three's
 * `properties.get(material).programs`, every variant a material has been built for) whose id is past the highest the
 * renderer held as the screen lifted (`fromId`) and no later than the highest it held as the window closed (`toId`).
 * Program ids only rise, so the range is exactly "built after the lift, inside the window". Depth and velocity
 * programs are other materials' and are never in a body's own records: what this counts is the colour programs, the
 * world's set and the rooms'. `names`, when handed, gets the name of each material that had one, at most eight.
 */
export function programsForUp<M>(materials: Iterable<M>, fromId: number, toId: number, programsOf: (m: M) => Iterable<{ id: number }> | null | undefined, nameOf?: (m: M) => string, names?: string[]): number {
  const seen = new Set<number>();
  for (const m of materials) {
    const list = programsOf(m);
    if (!list) continue;
    let mine = false;
    for (const p of list) {
      if (!p || !(p.id > fromId) || !(p.id <= toId)) continue;
      if (!seen.has(p.id)) mine = true;
      seen.add(p.id);
    }
    if (mine && names && nameOf && names.length < 8) names.push(nameOf(m) || '(unnamed)');
  }
  return seen.size;
}

// ---------------------------------------------------------------------------------------------
// The record of the last trip's screens.

/** One phase of a screen: the words it said under the title (numbers folded), and how long it said them. */
export interface ScreenPhase {
  words: string;
  s: number;
}

/** One loading screen of the last trip, as `__debug.loading()` reports it. */
export interface ScreenRecord {
  title: string;
  /** Seconds the screen was up; null while it still is. */
  s: number | null;
  phases: ScreenPhase[];
  /** Programs built behind it, the whole screen's (the people's and the streamer's outright builds among them). */
  programs: number;
  /** The sweep's own programs and milliseconds, where the screen had one. */
  sweep: { programs: number; ms: number } | null;
  /** The bodies stood behind it, when it lifted: the people pass's want, its budget refusals, and how many were up. */
  bodies: { want: number; refused: number; up: number; stood: number; loading: number } | null;
  /** A race start's: `none`, or `course (<why>)`, with the models it loaded and those it left at the bound. */
  curtain: string | null;
  course: CourseRecord | null;
}

/** What a course curtain did: the course's models, those it loaded and left at the bound, the programs it built, and how long its sweep and its shadow draws took. */
export interface CourseRecord {
  models: number;
  loaded: number;
  left: number;
  compiled: number;
  sweepMs?: number;
  depthMs?: number;
}

/** What `after` counts in the first `afterS` seconds after the last screen lifted. */
export interface AfterRecord {
  /** Seconds of the window gone by (it closes at `afterS`). */
  s: number;
  /** Programs built in play for a dressed person (the queue's look labels) in the window. */
  people: number;
  /**
   * The highest program id the renderer held as the screen lifted, and the highest it held at the last frame of the
   * window: what `programsForUp` reads the window's programs by (the game counts `forUp` with them).
   */
  idFrom: number;
  idTo: number;
  /** Frames drawn, the worst frame, and the frames over 100 ms in the window. */
  frames: number;
  worstMs: number;
  over100: number;
  /** Bodies still loading when the screen's bound ran out, whose programs build in play. */
  afterBound: number;
}

/** A trip's screens are those that followed one another within this many milliseconds. */
const TRIP_GAP_MS = 3000;
/** At most this many screens are kept for a trip. */
const TRIP_MOST = 8;

/** Folded words: every run of digits one mark, so "building shaders, 3 new" and "…, 4 new" are one phase. */
function foldWords(s: string): string {
  return s.replace(/\d+(\.\d+)?/g, '#');
}

/**
 * What the last trip's loading screens did. The game hands it every change the screen makes (on, the words under
 * the title, off) with the time, and the figures only it knows (the programs, the sweep, the bodies, a race start's
 * curtain); `frame` is called every frame and does nothing outside the window after a screen, and allocates nothing.
 */
export class LoadingLog {
  readonly screens: ScreenRecord[] = [];
  private open: ScreenRecord | null = null;
  private openAt = 0;
  private openPrograms = 0;
  private phaseWords = '';
  private phaseAt = 0;
  private lastOff = Number.NEGATIVE_INFINITY;
  // The window after the last screen lifted. Numbers only, so a frame writes nothing new.
  private afterFrom = Number.NEGATIVE_INFINITY;
  private afterUntil = Number.NEGATIVE_INFINITY;
  private afterFrames = 0;
  private afterWorst = 0;
  private afterOver = 0;
  private afterPeopleFrom = -1;
  private afterPeopleTo = 0;
  private afterBound = 0;
  /** The highest program id as the screen lifted, and at the window's last frame (`programsForUp`). */
  private afterIdFrom = -1;
  private afterIdTo = -1;

  /** A screen went up with `title`; `programs` is the watch's count of programs built behind screens so far. */
  on(title: string, now: number, programs: number): void {
    if (this.open) this.off(now, programs);
    if (now - this.lastOff > TRIP_GAP_MS) this.screens.length = 0;
    if (this.screens.length >= TRIP_MOST) this.screens.shift();
    const rec: ScreenRecord = { title, s: null, phases: [], programs: 0, sweep: null, bodies: null, curtain: null, course: null };
    this.screens.push(rec);
    this.open = rec;
    this.openAt = now;
    this.openPrograms = programs;
    this.phaseWords = '';
    this.phaseAt = now;
    // A screen going up closes whatever window the last one had open: nothing after it is "after the screen".
    this.afterUntil = Number.NEGATIVE_INFINITY;
  }

  /** The screen said something new under its title. */
  what(words: string, now: number): void {
    const rec = this.open;
    if (!rec) return;
    const folded = foldWords(words);
    if (folded === this.phaseWords) return;
    this.closePhase(now);
    this.phaseWords = folded;
    this.phaseAt = now;
  }

  private closePhase(now: number): void {
    const rec = this.open;
    if (!rec || !this.phaseWords) return;
    rec.phases.push({ words: this.phaseWords, s: Number(((now - this.phaseAt) / 1000).toFixed(2)) });
  }

  /** The sweep behind the screen up now built `programs` in `ms`. */
  sweep(programs: number, ms: number): void {
    if (this.open) this.open.sweep = { programs, ms: Math.round(ms) };
  }

  /** The bodies the screen up now stood, as it lifts. */
  bodies(b: { want: number; refused: number; up: number; stood: number; loading: number }): void {
    if (this.open) this.open.bodies = b;
    this.afterBound = b.loading;
  }

  /**
   * A race start's curtain, whether or not one went up: on the screen up now, or, for none, on a record of its own
   * with no screen (a start with no curtain is still a step of the trip the owner asks about).
   */
  curtain(words: string, now: number, course: CourseRecord | null = null): void {
    if (this.open) {
      this.open.curtain = words;
      this.open.course = course;
      return;
    }
    if (now - this.lastOff > TRIP_GAP_MS) this.screens.length = 0;
    if (this.screens.length >= TRIP_MOST) this.screens.shift();
    this.screens.push({ title: '(no screen)', s: 0, phases: [], programs: 0, sweep: null, bodies: null, curtain: words, course });
    this.lastOff = now;
  }

  /**
   * The screen went away; `programs` as `on` was handed it, `highestId` the highest program id the renderer holds now.
   * The window after it opens.
   */
  off(now: number, programs: number, highestId = -1, afterS = LOADING_TUNE.afterS): void {
    const rec = this.open;
    if (!rec) return;
    this.closePhase(now);
    rec.s = Number(((now - this.openAt) / 1000).toFixed(2));
    rec.programs = Math.max(0, programs - this.openPrograms);
    this.open = null;
    this.lastOff = now;
    this.afterFrom = now;
    this.afterUntil = now + afterS * 1000;
    this.afterFrames = 0;
    this.afterWorst = 0;
    this.afterOver = 0;
    this.afterPeopleFrom = -1;
    this.afterPeopleTo = 0;
    this.afterIdFrom = highestId;
    this.afterIdTo = highestId;
  }

  /** When the window after the last screen ends (the page's own time); minus infinity once a screen has gone up since. */
  get afterEnds(): number {
    return this.afterUntil;
  }

  /** Whether `now` is inside the window after the last screen. */
  inWindow(now: number): boolean {
    return now >= this.afterFrom && now <= this.afterUntil;
  }

  /** Whether a screen is up now. */
  get up(): boolean {
    return this.open !== null;
  }

  /** When the screen up now went up (the page's own time), or the last one did. */
  get openedAt(): number {
    return this.openAt;
  }

  /** The watch's count of programs built behind screens when the screen up now went up. */
  get programsAtOn(): number {
    return this.openPrograms;
  }

  /** The window after the last screen, as times: where it began and where it ends. */
  get afterWindow(): { from: number; until: number } {
    return { from: this.afterFrom, until: this.afterUntil };
  }

  /**
   * Every frame: inside the window after a screen, the frame's length, the queue's count of programs built in play
   * for a look and the highest program id the renderer holds (which only rises while programs are built). Nothing at
   * all outside it, and nothing made inside it.
   */
  frame(frameMs: number, now: number, peopleBuilt: number, highestId = -1): void {
    if (now > this.afterUntil || now < this.afterFrom) return;
    if (this.afterPeopleFrom < 0) this.afterPeopleFrom = peopleBuilt;
    this.afterPeopleTo = peopleBuilt;
    if (highestId > this.afterIdTo) this.afterIdTo = highestId;
    this.afterFrames++;
    if (frameMs > this.afterWorst) this.afterWorst = frameMs;
    if (frameMs > 100) this.afterOver++;
  }

  /** The window after the last screen as it stands. */
  after(now: number): AfterRecord | null {
    if (!Number.isFinite(this.afterFrom)) return null;
    const span = Math.max(0, Math.min(now, this.afterUntil) - this.afterFrom);
    return {
      s: Number((span / 1000).toFixed(1)),
      people: this.afterPeopleFrom < 0 ? 0 : this.afterPeopleTo - this.afterPeopleFrom,
      idFrom: this.afterIdFrom,
      idTo: this.afterIdTo,
      frames: this.afterFrames,
      worstMs: Math.round(this.afterWorst),
      over100: this.afterOver,
      afterBound: this.afterBound,
    };
  }
}
