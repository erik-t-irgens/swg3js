// Programs built off the frame (the performance pass's second wave): whether this machine can link a shader program
// in the background while the game goes on drawing, the record of the programs it has asked for and is waiting on,
// and the watch that times what the main thread really waited on links, whoever made it wait.
//
// On Chrome's default backend (Direct3D 11) a program takes about 400 ms to build, and every time the game asked a
// program a question before it was linked -- its uniforms, its link status -- the main thread waited for the whole of
// it, which froze the game and the browser. The parallel-compile extension lets a program link on the GPU process's
// own threads and answers, for nothing, whether it is done (`COMPLETION_STATUS_KHR`, three's `program.isReady()`). It
// works on the owner's machine in Chrome 155 (measured: eight programs all ready in 569 ms polled, the main thread
// free meanwhile); on the machine the September driver was on it never answered, which is what the boot check and
// the bound here guard against: a program not ready within `boundMs` is resolved the old way, said once.
//
// Three pieces, all pure and node-tested (`linkMode.test.ts`), with what they read handed in:
//
//   1. The **boot check** (`linkCheckVerdict` and `LinkCheck`): one salted program compiled at the top of the first
//      loading screen and polled once a frame for up to `checkMs`. Ready in time with no poll that waited: `parallel`.
//      Not ready, or no extension (always so on Vulkan, whose links take about 10 ms anyway): `blocking`. A hidden tab
//      is `blocking` while it stays hidden whatever the check said, because a hidden tab never reports a program
//      linked (CLAUDE.md); the check itself waits a hidden spell out and decides once the tab shows.
//   2. **`LinkFlight`**: the programs issued and not yet resolved, in kept arrays, polled each frame.
//   3. The **link-wait watch** (`watchLinkWaits`): the GL calls that can make the main thread wait on a link, wrapped
//      once and timed, each frame's sum kept. They are made only when a program is built or first used, so the watch
//      costs a steady frame nothing; a completion poll passes straight through untimed.
//
// Every number here is ours and a technical bound, never a matter of feel.

/** The link mode's numbers. Ours; live through `__debug.links({ tune })`. */
export const LINK_TUNE = {
  /** The boot check polls its one salted program this long, ms, before calling the machine `blocking`. */
  checkMs: 3000,
  /** ...and calls it `blocking` too if any one of those polls took longer than this, ms (a poll that waits). */
  pollMaxMs: 1,
  /** Programs issued and not yet ready, at most, in play: eight are all ready in 569 ms on Direct3D 11. */
  inFlight: 8,
  /** Programs issued on one play frame at most (three's own JavaScript is about 1.3 ms a program). */
  issuePerFrame: 2,
  /** A program not ready after this, ms, is resolved the old way (blocking), and the console says so once. */
  boundMs: 5000,
  /** The same cap as `inFlight` behind a loading screen: sixteen are all ready in 853 ms. */
  sweepInFlight: 16,
  /** A frame whose main thread waited longer than this on links in all, ms, is counted (T9). */
  waitFrameMs: 5,
};

export type LinkTune = typeof LINK_TUNE;

/** The ranges a number of `LINK_TUNE` is held to when moved. */
const RANGES: Record<keyof LinkTune, [number, number]> = {
  checkMs: [0, 60000],
  pollMaxMs: [0, 1000],
  inFlight: [1, 256],
  issuePerFrame: [1, 64],
  boundMs: [100, 120000],
  sweepInFlight: [1, 512],
  waitFrameMs: [0, 1000],
};

/** Any of `LINK_TUNE` moved live, in memory; words for anything refused or held to its range. */
export function tuneLinks(patch: Partial<Record<keyof LinkTune, unknown>> | null | undefined): string[] {
  const words: string[] = [];
  const t = LINK_TUNE as unknown as Record<string, number>;
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!Object.hasOwn(LINK_TUNE, key)) {
      words.push(`no number called ${key}`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      words.push(`${key} takes a number`);
      continue;
    }
    const [lo, hi] = RANGES[key as keyof LinkTune];
    const n = Math.min(hi, Math.max(lo, value));
    if (n !== value) words.push(`${key} held to ${lo} to ${hi}: ${n}`);
    t[key] = n;
  }
  return words;
}

/** How programs are linked: polled in the background, or the old way, each one waited for the moment it is asked. */
export type LinkModeName = 'parallel' | 'blocking';

/** Why the mode is what it is, in the words `__debug.links()` gives. */
export type LinkWhy = 'parallel' | 'blocking: no extension' | 'blocking: hidden' | 'blocking: the check never answered' | 'blocking: a poll waited' | 'blocking: not checked yet' | 'blocking: asked for' | 'parallel: asked for';

/**
 * The session's link mode: what the boot check decided (`checked`), what the console forced (`forced`, null when
 * nothing is), and whether the tab is hidden now, which always means `blocking` (`linkMode`).
 */
export const LINK_STATE: { checked: LinkModeName; why: LinkWhy; decided: boolean; forced: LinkModeName | null } = {
  checked: 'blocking',
  why: 'blocking: not checked yet',
  decided: false,
  forced: null,
};

/** The mode in force: blocking while hidden, else the console's word, else the check's. */
export function linkMode(hidden: boolean): LinkModeName {
  if (hidden) return 'blocking';
  return LINK_STATE.forced ?? LINK_STATE.checked;
}

/** Why the mode in force is what it is (`linkMode`), in words. */
export function linkWhy(hidden: boolean): LinkWhy {
  if (hidden) return 'blocking: hidden';
  if (LINK_STATE.forced) return LINK_STATE.forced === 'parallel' ? 'parallel: asked for' : 'blocking: asked for';
  return LINK_STATE.why;
}

/** What the boot check saw, for its verdict. */
export interface LinkCheckFacts {
  /** Whether the context offers `KHR_parallel_shader_compile` at all. */
  extension: boolean;
  /** Whether the tab was hidden while the check ran. */
  hidden: boolean;
  /** Whether the salted program reported itself ready within `checkMs`. */
  readyInTime: boolean;
  /** The longest any one poll took, ms. */
  worstPollMs: number;
}

/** The boot check's verdict: `parallel` only when the program was ready in time and no poll waited. */
export function linkCheckVerdict(f: LinkCheckFacts, tune: Pick<LinkTune, 'pollMaxMs'> = LINK_TUNE): { mode: LinkModeName; why: LinkWhy } {
  if (!f.extension) return { mode: 'blocking', why: 'blocking: no extension' };
  if (f.hidden) return { mode: 'blocking', why: 'blocking: hidden' };
  if (f.worstPollMs > tune.pollMaxMs) return { mode: 'blocking', why: 'blocking: a poll waited' };
  if (!f.readyInTime) return { mode: 'blocking', why: 'blocking: the check never answered' };
  return { mode: 'parallel', why: 'parallel' };
}

/**
 * A program as the check, the flight and the queue see it: three's own `WebGLProgram` answers both. Three's also
 * carries its GL handle as `program`, which its `destroy` sets to undefined (`programGone`).
 */
export interface ReadyProgram {
  isReady(): boolean;
  getUniforms(): unknown;
  program?: unknown;
}

/**
 * Whether three has destroyed this program (its material disposed while it was in flight, the last to use it): the
 * GL handle is gone, and `isReady` would ask the driver about a deleted program, which answers nothing for ever (null,
 * and a GL error once), so a flight that polled it would wait out the bound and blame the driver. Only a program that
 * carries the field at all is judged: a stand-in without it never reads as gone.
 */
export function programGone(p: ReadyProgram): boolean {
  return 'program' in p && p.program === undefined;
}

/**
 * The boot check as a thing polled once a frame: `start` with the salted program (null when none could be made),
 * then `poll(now)` each frame until it answers; the clock and the page are the caller's. Its verdict is written into
 * `LINK_STATE` once, and never again in the session.
 *
 * A hidden tab never reports a program linked, so a check that finds the tab hidden decides nothing: it waits, polling
 * nothing and counting no time, and starts its clock again the first time it is polled with the tab shown, asking the
 * very program it compiled (whose link went on meanwhile), so nothing is compiled in play to decide it. Decided while
 * hidden, as it first was, a page that entered play hidden (a reload after the physics broke, which goes straight back
 * into play) was `blocking` for its whole session, its console saying "hidden" with the tab in plain view.
 */
export class LinkCheck {
  private program: ReadyProgram | null = null;
  private extension = false;
  private startedAt = 0;
  private worst = 0;
  private sawHidden = false;
  private ready = false;
  done = false;
  /** Whether the tab was hidden at the last poll, the check waiting for it to show. */
  paused = false;

  /** Begin: the program to poll, whether the context has the extension, and the time. */
  start(program: ReadyProgram | null, extension: boolean, now: number): void {
    this.program = program;
    this.extension = extension;
    this.startedAt = now;
    this.worst = 0;
    this.sawHidden = false;
    this.ready = false;
    this.done = false;
    this.paused = false;
    if (!program || !extension) this.finish();
  }

  /**
   * One poll. `timed` is a clock for the poll itself (the caller's `performance.now`), so a poll that waits is seen.
   * Answers true once the check has decided; with `hidden` it waits (see the class's head) and answers false.
   */
  poll(now: number, hidden: boolean, timed: () => number = () => 0): boolean {
    if (this.done) return true;
    if (hidden) {
      this.sawHidden = true;
      this.paused = true;
      return false;
    }
    if (this.paused) {
      // Shown again: a fresh window from now for the program to say it is linked.
      this.paused = false;
      this.startedAt = now;
    }
    const p = this.program;
    if (p) {
      const t0 = timed();
      let ok = false;
      try {
        ok = p.isReady();
      } catch {
        ok = false;
      }
      const ms = timed() - t0;
      if (ms > this.worst) this.worst = ms;
      if (ok) this.ready = true;
    }
    if (this.ready || now - this.startedAt >= LINK_TUNE.checkMs || this.worst > LINK_TUNE.pollMaxMs) this.finish();
    return this.done;
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    // Decided only on polls made with the tab shown, so the verdict is never "hidden" (that is `linkWhy`'s, while it lasts).
    const v = linkCheckVerdict({ extension: this.extension, hidden: false, readyInTime: this.ready, worstPollMs: this.worst });
    LINK_STATE.checked = v.mode;
    LINK_STATE.why = v.why;
    LINK_STATE.decided = true;
    // The program it polled is resolved now either way, so it never waits on anyone's first use.
    try {
      this.program?.getUniforms();
    } catch {
      // A program that will not answer will not draw either; nothing draws this one.
    }
    this.program = null;
  }

  /** What the check saw, for the console: `hidden` whether the tab was hidden at some poll (the check waited it out), `paused` whether it is waiting now. */
  facts(): { done: boolean; extension: boolean; readyInTime: boolean; worstPollMs: number; hidden: boolean; paused: boolean } {
    return { done: this.done, extension: this.extension, readyInTime: this.ready, worstPollMs: Number(this.worst.toFixed(3)), hidden: this.sawHidden, paused: this.paused };
  }
}

/** One object in flight: its programs, when it was issued, and what the queue keeps beside it. */
export interface FlightEntry {
  object: object | null;
  programs: (ReadyProgram | null)[];
  count: number;
  /** Of its programs, those three destroyed while they were in flight (`programGone`), struck off as done. */
  gone: number;
  issuedAt: number;
  /** Whether it is finished: every program ready, or resolved by the bound or because the tab hid. */
  finished: boolean;
  /** Why it finished: 'ready', 'bound', 'hidden', or 'turned' (the mode turned to `blocking`, or the queue let go). */
  how: '' | 'ready' | 'bound' | 'hidden' | 'turned';
  /** The queue's own record beside it (its batch, its job's own compile), kept opaque here. */
  tag: unknown;
}

/** How many issue-to-ready times the flight keeps for its median. */
const READY_KEEP = 64;

/** Whether the bound has been said on the console this session, by any flight (a test may put it back). */
export const BOUND_SAID = { said: false };

/**
 * The programs issued and not yet resolved, object by object, in kept arrays and kept entries: a steady frame polls
 * and allocates nothing (an entry's program list grows to the largest object it has held and is reused).
 */
export class LinkFlight {
  private readonly entries: FlightEntry[] = [];
  private live = 0;
  private readonly spare: FlightEntry[] = [];
  /** The entries `poll` finished this time, for the caller to resolve; kept and refilled. */
  readonly finished: FlightEntry[] = [];
  private finishedCount = 0;
  /** Programs issued and not yet ready. */
  programsInFlight = 0;
  /** Programs issued, and objects resolved, this session. */
  issued = 0;
  resolved = 0;
  /** Objects the bound resolved blocking, objects resolved outright because the tab hid, and because the mode turned. */
  bound = 0;
  hiddenResolved = 0;
  turned = 0;
  /** Programs three destroyed while they were in flight (their material disposed), struck off without a wait or a bound. */
  gone = 0;
  /** Issue-to-ready milliseconds, as a ring. */
  private readonly readyMs = new Float64Array(READY_KEEP);
  private readyAt = 0;
  private readyN = 0;
  worstReadyMs = 0;
  /** Where the bound is said (once a session, whichever flight meets it first): the console, unless a test hands a sink. */
  say: (line: string) => void = (line) => console.warn(line);

  /** How many objects are in flight. */
  get objects(): number {
    return this.live;
  }

  /** How many entries the last `poll` finished (read `finished[0 .. this - 1]`). */
  get finishedNow(): number {
    return this.finishedCount;
  }

  /** An object's programs issued now; `tag` is the caller's record beside it. Answers the entry. */
  issue(object: object, programs: readonly ReadyProgram[], now: number, tag: unknown = null): FlightEntry {
    const e = this.spare.pop() ?? { object: null, programs: [], count: 0, gone: 0, issuedAt: 0, finished: false, how: '', tag: null };
    e.object = object;
    e.count = 0;
    e.gone = 0;
    for (let i = 0; i < programs.length; i++) e.programs[e.count++] = programs[i];
    for (let i = e.count; i < e.programs.length; i++) e.programs[i] = null;
    e.issuedAt = now;
    e.finished = false;
    e.how = '';
    e.tag = tag;
    this.entries[this.live++] = e;
    this.programsInFlight += e.count;
    this.issued += e.count;
    return e;
  }

  /** Whether an object is not in flight (never issued, or finished and let go). */
  ready(object: object): boolean {
    for (let i = 0; i < this.live; i++) if (this.entries[i].object === object) return false;
    return true;
  }

  /**
   * Look at every entry: a program that reports ready is struck off its list, and an entry with none left finishes
   * (`ready`); one past `boundMs` finishes anyway (`bound`, said once a session); with `hidden` every entry finishes at
   * once (`hidden`), since a hidden tab never reports a program linked and nothing behind a screen may wait the bound
   * for it. A program three destroyed in flight (`programGone`) is struck off as done before it is asked anything, so
   * a material disposed mid-flight neither waits the bound nor blames the driver. Finished entries are moved to
   * `finished` for the caller to resolve and then hand back (`release`).
   */
  poll(now: number, hidden: boolean): number {
    this.finishedCount = 0;
    let w = 0;
    for (let i = 0; i < this.live; i++) {
      const e = this.entries[i];
      if (!e.finished) {
        if (hidden) {
          this.finish(e, 'hidden', now);
        } else {
          let left = 0;
          for (let k = 0; k < e.count; k++) {
            const p = e.programs[k];
            if (!p) continue;
            if (programGone(p)) {
              e.programs[k] = null;
              this.programsInFlight--;
              e.gone++;
              this.gone++;
              continue;
            }
            let ok = false;
            try {
              ok = p.isReady();
            } catch {
              // A program that throws on the question is taken as done: its resolve says the rest.
              ok = true;
            }
            if (ok) {
              e.programs[k] = null;
              this.programsInFlight--;
            } else left++;
          }
          if (left === 0) this.finish(e, 'ready', now);
          else if (now - e.issuedAt >= LINK_TUNE.boundMs) this.finish(e, 'bound', now);
        }
      }
      if (e.finished) this.finished[this.finishedCount++] = e;
      else this.entries[w++] = e;
    }
    this.live = w;
    return this.finishedCount;
  }

  private finish(e: FlightEntry, how: 'ready' | 'bound' | 'hidden' | 'turned', now: number): void {
    e.finished = true;
    e.how = how;
    // What it still held goes from the count: resolved by its caller now, whatever the driver says.
    for (let k = 0; k < e.count; k++) {
      if (e.programs[k]) {
        e.programs[k] = null;
        this.programsInFlight--;
      }
    }
    this.resolved++;
    if (how === 'bound') {
      this.bound++;
      if (!BOUND_SAID.said) {
        BOUND_SAID.said = true;
        this.say(`shaders: a program was not linked ${LINK_TUNE.boundMs} ms after it was asked for, so it was finished the old way (the main thread waited for it); the driver's background linking may not answer here -- __debug.links() for the rest`);
      }
    } else if (how === 'hidden') this.hiddenResolved++;
    else if (how === 'turned') this.turned++;
    else if (e.gone < e.count) {
      // A time from asked to ready, unless every program of it was destroyed in flight and none was ever ready.
      const ms = now - e.issuedAt;
      this.readyMs[this.readyAt] = ms;
      this.readyAt = (this.readyAt + 1) % READY_KEEP;
      if (this.readyN < READY_KEEP) this.readyN++;
      if (ms > this.worstReadyMs) this.worstReadyMs = ms;
    }
  }

  /** Hand finished entries back to be reused, once the caller has resolved them. */
  release(): void {
    for (let i = 0; i < this.finishedCount; i++) {
      const e = this.finished[i];
      e.object = null;
      e.tag = null;
      this.spare.push(e);
    }
    this.finishedCount = 0;
  }

  /**
   * Everything in flight finished outright (the mode turned to `blocking`, a world going, the queue cleared): moved to
   * `finished`, as `poll` does, for the caller to resolve or let go.
   */
  finishAll(now: number): number {
    this.finishedCount = 0;
    for (let i = 0; i < this.live; i++) {
      const e = this.entries[i];
      if (!e.finished) this.finish(e, 'turned', now);
      this.finished[this.finishedCount++] = e;
    }
    this.live = 0;
    return this.finishedCount;
  }

  /** The median issue-to-ready milliseconds of the last few programs; 0 before any. */
  medianReadyMs(): number {
    if (!this.readyN) return 0;
    const a = Array.from(this.readyMs.subarray(0, this.readyN)).sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  }
}

/**
 * The link-wait watch's record: each frame's milliseconds of waiting, kept as a ring, the worst frame, how many frames
 * went past `waitFrameMs`, and the calls it timed. Written by the wrapped GL calls and rolled once a frame
 * (`endFrame`); nothing allocated.
 */
export class LinkWaits {
  /** Milliseconds the main thread spent in the watched calls this frame so far. */
  frameMs = 0;
  /** The same for the last frame that ended. */
  lastMs = 0;
  /** The worst frame's milliseconds this session, and the frames over `waitFrameMs`, every frame counted. */
  worstMs = 0;
  framesOver = 0;
  /** The same over frames of play alone (no loading screen, no jump's tunnel): what T9 reads. */
  worstPlayMs = 0;
  framesOverPlay = 0;
  playFrames = 0;
  /** Calls timed this session, and the total milliseconds. */
  calls = 0;
  totalMs = 0;
  /** The last frames' sums, as a ring. */
  readonly ring = new Float32Array(240);
  private at = 0;

  /** One watched call took `ms`. */
  add(ms: number): void {
    this.frameMs += ms;
    this.calls++;
    this.totalMs += ms;
  }

  /**
   * The frame ended: its sum kept, counted against `waitFrameMs` (and apart when it was a frame of play), and the next
   * frame's started at nought. Answers the sum.
   */
  endFrame(play = false): number {
    const ms = this.frameMs;
    this.lastMs = ms;
    this.ring[this.at] = ms;
    this.at = (this.at + 1) % this.ring.length;
    if (ms > this.worstMs) this.worstMs = ms;
    if (ms > LINK_TUNE.waitFrameMs) this.framesOver++;
    if (play) {
      this.playFrames++;
      if (ms > this.worstPlayMs) this.worstPlayMs = ms;
      if (ms > LINK_TUNE.waitFrameMs) this.framesOverPlay++;
    }
    this.frameMs = 0;
    return ms;
  }

  /** The watch's numbers counted from nought again (a fresh measurement from the console). */
  forget(): void {
    this.worstMs = 0;
    this.framesOver = 0;
    this.worstPlayMs = 0;
    this.framesOverPlay = 0;
    this.playFrames = 0;
    this.calls = 0;
    this.totalMs = 0;
    this.ring.fill(0);
  }
}

/** The one record the game's watch writes. */
export const LINK_WAITS = new LinkWaits();

/** The GL calls that can make the main thread wait on a link, every one of them answered only by a finished link. */
export const WATCHED_CALLS = ['getProgramParameter', 'getProgramInfoLog', 'getShaderParameter', 'getShaderInfoLog', 'getUniformLocation', 'getAttribLocation', 'getActiveUniform', 'getActiveAttrib'] as const;

/** `KHR_parallel_shader_compile`'s own question: a completion poll, which never waits and is never timed. */
export const COMPLETION_STATUS_KHR = 0x91b1;

/** A context as the watch sees it: the watched calls by name. */
type WatchedGl = Record<(typeof WATCHED_CALLS)[number], (...args: unknown[]) => unknown>;

/** Contexts already watched, so a second install wraps nothing twice. */
const watched = new WeakSet<object>();

/**
 * Wrap the watched calls on one context, once, so every wait on a link is timed into `waits` (the game's `LINK_WAITS`)
 * whoever made the call: the queue's resolves, three's own first use of a program nobody resolved, the effects'
 * `getUniforms`. A completion poll (`getProgramParameter(p, COMPLETION_STATUS_KHR)`) goes straight through untimed.
 * Each wrapper takes its arguments by name (never a rest array), so a call allocates nothing; `now` is the clock.
 * Answers whether it wrapped anything.
 */
export function watchLinkWaits(gl: object | null | undefined, now: () => number, waits: LinkWaits = LINK_WAITS): boolean {
  if (!gl || watched.has(gl)) return false;
  watched.add(gl);
  const g = gl as unknown as WatchedGl;
  const param = g.getProgramParameter;
  if (typeof param === 'function') {
    g.getProgramParameter = function watchedProgramParameter(this: unknown, p: unknown, name: unknown): unknown {
      if (name === COMPLETION_STATUS_KHR) return param.call(gl, p, name);
      const t0 = now();
      const r = param.call(gl, p, name);
      waits.add(now() - t0);
      return r;
    };
  }
  for (const key of WATCHED_CALLS) {
    if (key === 'getProgramParameter') continue;
    const fn = g[key];
    if (typeof fn !== 'function') continue;
    g[key] = function watchedCall(this: unknown, a: unknown, b: unknown): unknown {
      const t0 = now();
      const r = fn.call(gl, a, b);
      waits.add(now() - t0);
      return r;
    };
  }
  return true;
}
