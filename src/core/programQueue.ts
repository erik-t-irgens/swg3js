// Building shader programs where the player is not looking, and never more than the frame can pay
// for.
//
// Two facts about three and about the drivers this game meets, both measured rather than assumed,
// decide everything here.
//
//  1. `renderer.compile()` does not finish a program. It compiles the two stages, calls
//     `linkProgram` and stops. Three then leaves the program's uniform and attribute locations
//     unfetched until something first draws with it (`WebGLProgram`'s own `onFirstUse`, reached
//     from `getUniforms()`), and a driver that links in the background does not finish the link
//     until it is asked a question either. So on such a driver the whole cost of a program lands on
//     the **first frame that draws it**, however carefully it was "compiled" behind a loading
//     screen: twelve trivial materials measured 0.6 ms to compile and 3806 ms to first draw.
//     `resolveLinks` is the missing half: it asks each program for its uniforms, which is exactly
//     the question the first draw asks, and it can be asked behind the screen instead.
//
//  2. `KHR_parallel_shader_compile` works on some machines and not on others. On the September
//     machine's driver it was advertised and never answered: six programs linked, four seconds of
//     wall clock, and `COMPLETION_STATUS_KHR` still false for every one of them, which is why one
//     ship took ten and a half seconds to prepare through `compileAsync`. On the owner's machine in
//     Chrome 155 (measured in the performance pass) it works: eight programs polled are all ready in
//     569 ms on Direct3D 11 with the main thread free meanwhile, where waiting on each costs about
//     400 ms of blocked main thread apiece. So nothing here waits on the flag without a bound: the
//     link mode (`linkMode.ts`) is decided by a boot check, `parallel` issues programs and polls them
//     (`LinkFlight`) and resolves each only once it reports ready, a program not ready within the
//     bound is resolved the old way and said once, and `blocking` resolves every link outright as
//     this queue always did.
//
// The queue itself is the pacing. Work is taken off it a job at a time until the frame's allowance
// is spent (`PaceBudget`), so a slow compiler costs a dropped frame rather than a freeze, and a
// job that turns out to cost nothing (its material was built behind the screen) costs nothing.
// Jobs that hold something back from being shown come before jobs that nobody is waiting on. A job
// may carry its own compile and its own finish (`OwnJob`: the motion blur's variants, which are
// keyed on the empty light set of their own draws and must never be compiled against a pass's).
//
// Nothing here knows what anything looks like, and nothing here may ever change it: a program that
// is built is the same program, built earlier.

import type * as THREE from 'three';
import { PACE_TUNE, PaceBudget, paceLine } from './programPace.ts';
import { LINK_TUNE, LinkFlight, type FlightEntry, type ReadyProgram } from './linkMode.ts';

/** Three's lazy program: `getUniforms()` is what the first draw calls, and what finishes the link. */
interface LazyProgram {
  getUniforms?: () => unknown;
}

/** Three's per-material record: every program variant it has been built for, and the last one used. */
interface MaterialRecord {
  programs?: Map<unknown, LazyProgram>;
  currentProgram?: LazyProgram;
}

interface RendererProperties {
  has(o: object): boolean;
  get(o: object): MaterialRecord | undefined;
}

/** Programs whose link has already been resolved, so a second pass over the same scene costs nothing. */
const resolved = new WeakSet<object>();

/** Every material under a root, drawables only, in one pass. The set is the caller's and is not cleared. */
export function materialsUnder(root: THREE.Object3D, out: Set<THREE.Material>): Set<THREE.Material> {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const drawable = mesh.isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite;
    if (!drawable || !mesh.material) return;
    if (Array.isArray(mesh.material)) for (const m of mesh.material) out.add(m);
    else out.add(mesh.material);
  });
  return out;
}

/**
 * Finish every program the materials under `root` have been compiled for: ask each one for its
 * uniforms, which is the very call three's first draw makes and the one that makes a deferred
 * driver link finish. Returns how many programs were finished here for the first time.
 *
 * Idempotent and safe to call on anything: a material with no program yet is skipped, and a
 * program that throws is counted as finished rather than asked again every frame.
 *
 * `onlyReady` (an object that a `parallel` flight saw ready): only the programs that report their link done are
 * finished, and one still linking is left for its own flight. Its materials may be shared, and another job may have
 * issued a program for them in another pass since this object was issued (a second person of one look whose first
 * person's rooms pass is in flight): finished here, that program's link was waited for on the main thread, 386 ms on
 * Direct3D 11 in the performance pass's smoke, by an object that never needed it.
 */
export function resolveLinks(renderer: THREE.WebGLRenderer | null | undefined, root: THREE.Object3D | Iterable<THREE.Material>, onlyReady = false): number {
  if (!renderer) return 0;
  const props = renderer.properties as unknown as RendererProperties | undefined;
  if (!props || typeof props.get !== 'function') return 0;
  const mats = (root as THREE.Object3D).isObject3D ? materialsUnder(root as THREE.Object3D, new Set<THREE.Material>()) : (root as Iterable<THREE.Material>);
  let done = 0;
  for (const m of mats) {
    if (!m) continue;
    if (typeof props.has === 'function' && !props.has(m)) continue;
    const rec = props.get(m);
    if (!rec) continue;
    if (rec.programs) for (const p of rec.programs.values()) done += finish(p, onlyReady);
    else done += finish(rec.currentProgram, onlyReady);
  }
  return done;
}

function finish(program: LazyProgram | undefined, onlyReady = false): number {
  if (!program || typeof program.getUniforms !== 'function' || resolved.has(program)) return 0;
  if (onlyReady && isPending(program)) {
    let ready = true;
    try {
      ready = (program as unknown as ReadyProgram).isReady();
    } catch {
      // A program that throws on the question is finished as ever; the draw reports it.
    }
    if (!ready) return 0;
  }
  resolved.add(program);
  try {
    program.getUniforms();
  } catch {
    // A program that will not answer is a program that will not draw either; the draw reports it.
  }
  return 1;
}

/**
 * Every program the materials under `root` have been compiled for that no resolve has finished yet: what a job issued
 * in `parallel` mode waits on (`LinkFlight`). Into `out`, which is the caller's and is emptied first; answers it.
 */
export function pendingPrograms(renderer: THREE.WebGLRenderer | null | undefined, root: THREE.Object3D | Iterable<THREE.Material>, out: ReadyProgram[] = []): ReadyProgram[] {
  out.length = 0;
  if (!renderer) return out;
  const props = renderer.properties as unknown as RendererProperties | undefined;
  if (!props || typeof props.get !== 'function') return out;
  const mats = (root as THREE.Object3D).isObject3D ? materialsUnder(root as THREE.Object3D, new Set<THREE.Material>()) : (root as Iterable<THREE.Material>);
  for (const m of mats) {
    if (!m) continue;
    if (typeof props.has === 'function' && !props.has(m)) continue;
    const rec = props.get(m);
    if (!rec) continue;
    if (rec.programs) {
      for (const p of rec.programs.values()) if (isPending(p)) out.push(p as unknown as ReadyProgram);
    } else if (isPending(rec.currentProgram)) out.push(rec.currentProgram as unknown as ReadyProgram);
  }
  return out;
}

function isPending(p: LazyProgram | undefined): boolean {
  return !!p && typeof p.getUniforms === 'function' && typeof (p as { isReady?: unknown }).isReady === 'function' && !resolved.has(p);
}

/**
 * A job's own compile and finish, for work the queue's compile must not touch (the motion blur's variants, compiled as
 * their own scene under the effects' target so their key carries the empty light set their draws are made under).
 * `compile` takes one turn at an object as the queue's does, and with `resolve` false only issues its programs (the
 * queue polls and resolves them); `finish` runs once the object's programs are resolved.
 */
export interface OwnJob {
  compile(o: THREE.Object3D, allowance: number, resolve: boolean): CompileStep;
  finish?(o: THREE.Object3D): void;
  /** An object of this job let go unbuilt (`clear`, `clearLoose`): its owner may ask for it again when it wants it. */
  dropped?(o: THREE.Object3D): void;
}

/**
 * What the queue needs of the world to issue programs and poll them (`parallel` mode, `linkMode.ts`): whether that mode
 * is in force now and whether the tab is hidden (read at every pump), an object's programs not yet resolved, and the
 * resolve itself (answers how many links it finished; `onlyReady` for an object its flight saw ready, `resolveLinks`).
 */
export interface QueueLinks {
  parallel(): boolean;
  hidden(): boolean;
  pending(o: THREE.Object3D): ReadyProgram[];
  resolve(o: THREE.Object3D, onlyReady?: boolean): number;
}

/** What one object in flight carries beside it in the flight: its batch (null for loose work), its job's own and label. */
interface FlightTag {
  batch: Batch | null;
  own: OwnJob | null;
  label: string;
}

/**
 * What a look's own label starts with (`MobileAssets` names a dressed person's prepare `look:<key>`): the
 * frame report's `programs (people)` counts the programs built in play under it.
 */
export const LOOK_LABEL = 'look:';

/** How many labels of programs built in play the queue remembers (`lastBuilt`). */
const LAST_BUILT = 8;

/** One thing to compile, and what to say about it if the frame it lands on overruns; its job's own compile, if any. */
interface Job {
  object: THREE.Object3D;
  label: string;
  own: OwnJob | null;
}

/**
 * A group of objects something is waiting on before it is shown. In `parallel` mode an object taken off it is in
 * flight until its programs are resolved (`inFlight`), and the batch is answered only once every object is taken and
 * none is in flight.
 */
interface Batch {
  objects: THREE.Object3D[];
  next: number;
  label: string;
  resolve: () => void;
  own: OwnJob | null;
  inFlight: number;
}

/** The compile the queue is handed: one turn at an object, the frame's allowance, and whether to resolve its links. */
export type QueueCompile = (o: THREE.Object3D, allowance: number, resolve: boolean) => CompileStep;


/**
 * What one turn at a job did: how many programs it built, and whether there is anything of it
 * left. A job that answers `done: false` is offered again -- on this frame if the allowance is not
 * spent, on the next one if it is -- and stays at the head of the queue meanwhile. This is what
 * lets the rule be **one program a frame** rather than "one job a frame": an object drawn in the
 * world's pass and in a room's is two programs, and a frame that can pay for one should pay for
 * one.
 */
export interface CompileStep {
  made: number;
  done: boolean;
}

/** What `pump` did with a frame, filled in place so a steady frame allocates nothing. */
export interface PumpResult {
  made: number;
  ms: number;
  jobs: number;
  pending: number;
  over: boolean;
  from: string;
}

/**
 * The one queue every deferred compile goes through.
 *
 * `push` is for work that holds something back from being shown: it answers a promise, and its
 * jobs are taken before anything else. It has two ranks, and the difference matters more than it
 * looks. Something the player must be shown *now* -- a peer arriving, a weapon taken up, a dressed
 * NPC, a ship spawned or refitted -- is `urgent`, and goes ahead of every tier of scenery and every
 * building's rooms already queued. The placed-object streamer is the one producer that pushes
 * without stopping, so with a single line a peer walking up behind a town filling in would wait
 * behind every one of its tiers. `add` is for work nobody is waiting on (the quarter-second scan's
 * finds), which fills whatever allowance is left. `flush` is for behind a loading screen or inside
 * a jump's closed tunnel, where the player is waiting on purpose and the point is to get it over
 * with.
 */
export class ProgramQueue {
  /** What must be shown now, then what is merely being filled in; the loose work after both. */
  private readonly urgent: Batch[] = [];
  private readonly batches: Batch[] = [];
  private readonly loose: Job[] = [];
  private readonly budget = new PaceBudget();
  private readonly result: PumpResult = { made: 0, ms: 0, jobs: 0, pending: 0, over: false, from: '' };
  /** The job `peek` last answered with, filled in place: a steady frame allocates nothing. */
  private readonly head: Job = { object: null as unknown as THREE.Object3D, label: '', own: null };
  /**
   * How `parallel` mode issues and polls (`linkMode.ts`), set by the world; null runs every job the old way. The
   * programs issued and not yet resolved are the flight's (`LinkFlight`), and loose work in flight is counted apart.
   */
  links: QueueLinks | null = null;
  readonly flight = new LinkFlight();
  private looseInFlight = 0;
  /** Kept records beside each object in flight (`FlightTag`), reused. */
  private readonly spareTags: FlightTag[] = [];
  /** How many programs have been built through this queue, and how many links it has finished. */
  private builtEver = 0;
  private linkedEver = 0;
  /** What the last overrunning frame was blamed on, for the console. */
  private lastOverrun = '';
  /** When a frame last looked at this queue, and how many times one has. */
  private tickedAt = Number.NEGATIVE_INFINITY;
  private tickCount = 0;
  /**
   * Programs the idle rule built in a timer task while the page was on screen with no loading screen up, a waiter's
   * flush or an outright build at the entry test (`noteIdleBuilt`): the fault the rule judged by frames exists to end
   * (a long frame, or frames the browser held back while the GPU process caught up, taken for a stopped loop, and
   * the queue built outside any frame: 37 of 170 programs of a Bestine session). With the rule right a page on screen
   * has frames ticking the queue and nothing builds there, so it stays at nought; a hidden tab, whose frames stop,
   * builds as the rule means it to and is not counted.
   */
  private flushedPlay = 0;
  /** The labels of the last `LAST_BUILT` jobs that built a program in play, as a ring: a string put in a slot, nothing made. */
  private readonly builtLabels = new Array<string>(LAST_BUILT).fill('');
  private builtAt = 0;
  /** Programs built in play for a look (`LOOK_LABEL`): what the frame report's `programs (people)` counts. */
  private peopleEver = 0;

  /**
   * Objects something is waiting on. The promise answers once every one of them has been compiled.
   * `urgent` is for what the player must be shown now, which goes ahead of scenery being filled in.
   */
  push(objects: readonly THREE.Object3D[], label: string, urgent = false, own?: OwnJob): Promise<void> {
    const list = objects.filter(Boolean);
    if (!list.length) return Promise.resolve();
    return new Promise<void>((resolve) => {
      (urgent ? this.urgent : this.batches).push({ objects: list.slice(), next: 0, label, resolve, own: own ?? null, inFlight: 0 });
    });
  }

  /** Objects nobody is waiting on: compiled whenever a frame has room left. */
  add(objects: readonly THREE.Object3D[], label: string, own?: OwnJob): void {
    for (const o of objects) if (o) this.loose.push({ object: o, label, own: own ?? null });
  }

  /**
   * A batch pushed below the urgent rank, carrying `own`, made urgent now: a body's rooms programs, deferred because it
   * was stood outdoors, wanted at once because it has walked into a room (`World.roomsNow`). Answers whether one moved.
   */
  promote(own: OwnJob): boolean {
    const list = this.batches;
    for (let i = 0; i < list.length; i++) {
      if (list[i].own !== own) continue;
      const b = list[i];
      for (let k = i; k < list.length - 1; k++) list[k] = list[k + 1];
      list.length--;
      this.urgent.push(b);
      return true;
    }
    return false;
  }

  /**
   * A frame looked at the queue, whether or not it had anything to do. `pump` does this itself;
   * the frame loop calls it even when the queue is empty, so that "nothing has ticked" means
   * "no frame is running" and never "the queue happened to be empty".
   */
  tick(now: number): void {
    this.tickedAt = now;
    this.tickCount++;
  }

  /** How long since a frame last looked at the queue; Infinity if none ever has. */
  since(now: number): number {
    return now - this.tickedAt;
  }

  /**
   * Whether no frame has ever looked at the queue, or none has for `idleBackstopMs`: the one test a
   * caller can make at a single instant, before it decides whether to queue at all.
   *
   * The queue is emptied by a frame and by nothing else, so a stretch with no frame in it means
   * either that nothing is being drawn yet (a loading screen before the world's first frame, a
   * driven session, a tab drawing none) or that the frame loop has stopped. In both cases there is
   * no drawn frame to protect, and a promise from `push` would otherwise never be answered at all:
   * whoever is waiting builds the work itself instead. A frame notes itself with `tick` whether or
   * not it had anything to do, so this is a fact about frames and never about the work.
   *
   * It is not what a waiter asks once it is waiting: that is two of its own polls seeing no new frame
   * (`QueueWatch`). Judged here by the time since the last tick at `idleMs`, a frame that built one
   * program for 1.6 s read as a stopped loop to the first timer after it, and its waiter flushed the
   * rest of the queue in that timer task, outside any frame -- 37 of 170 programs of a Bestine session.
   * On a page on screen (`shown`) the bound is `idleShownMs`: frames stand still there only while the
   * browser waits on the GPU process, which is the worst moment to build anything outright.
   */
  idle(now: number, shown = false): boolean {
    return this.tickCount === 0 || this.since(now) > (shown ? Math.max(PACE_TUNE.idleBackstopMs, PACE_TUNE.idleShownMs) : PACE_TUNE.idleBackstopMs);
  }

  /** How many frames have looked at the queue this session. */
  get ticks(): number {
    return this.tickCount;
  }

  /** How many objects are still to be compiled, those issued and not yet resolved among them. */
  get pending(): number {
    let n = this.loose.length + this.looseInFlight;
    for (const b of this.urgent) n += b.objects.length - b.next + b.inFlight;
    for (const b of this.batches) n += b.objects.length - b.next + b.inFlight;
    return n;
  }

  /** How many of those hold something back from being shown. */
  get waiting(): number {
    let n = 0;
    for (const b of this.urgent) n += b.objects.length - b.next + b.inFlight;
    for (const b of this.batches) n += b.objects.length - b.next + b.inFlight;
    return n;
  }

  get built(): number {
    return this.builtEver;
  }

  get linked(): number {
    return this.linkedEver;
  }

  get worstFrame(): number {
    return this.budget.worstFrame;
  }

  get overranFrames(): number {
    return this.budget.overranFrames;
  }

  get blame(): string {
    return this.lastOverrun;
  }

  /** Programs the idle rule built in a timer task on a page on screen with no loading screen up (should stay at nought). */
  get flushedInPlay(): number {
    return this.flushedPlay;
  }

  /** Programs built in play for a look, for the session (`LOOK_LABEL`). */
  get peopleBuilt(): number {
    return this.peopleEver;
  }

  /** The labels of the last eight jobs that built a program in play, newest first. For the console: it makes a list. */
  get lastBuilt(): string[] {
    const out: string[] = [];
    for (let i = 1; i <= LAST_BUILT; i++) {
      const s = this.builtLabels[(this.builtAt - i + LAST_BUILT * 2) % LAST_BUILT];
      if (s) out.push(s);
    }
    return out;
  }

  /** A job built `made` programs in play under `label`: its label kept, and a look's counted. Nothing made. */
  private notePlay(label: string, made: number): void {
    if (made <= 0) return;
    this.builtLabels[this.builtAt] = label;
    this.builtAt = (this.builtAt + 1) % LAST_BUILT;
    if (label.startsWith(LOOK_LABEL)) this.peopleEver += made;
  }

  /**
   * Programs the idle rule built outright on a page on screen with no loading screen up (`World.queueOrBuild`'s entry
   * test calling the loop stopped): the same fault as a waiter's flush there, and counted with it in `flushedInPlay`.
   */
  noteIdleBuilt(made: number): void {
    if (made > 0) this.flushedPlay += made;
  }

  /** Count a link finished somewhere else (the loading screen's own batches), so the figure is the session's. */
  countLinks(n: number): void {
    if (n > 0) this.linkedEver += n;
  }

  /**
   * One frame's worth. `compile` takes one turn at one object, with how many programs the frame
   * may still build, and answers what it built and whether that object is finished; `clock` is the
   * caller's, so a test drives this with numbers. Answers the filled result object, which is kept
   * and never made afresh.
   */
  pump(loading: boolean, compile: QueueCompile, clock: () => number): PumpResult {
    const out = this.result;
    const b = this.budget;
    this.tick(clock());
    const links = this.links;
    // `parallel` is read afresh at every pump: a tab that hides, or the console's word, turns it off at once.
    const parallel = links !== null && links.parallel() && !links.hidden();
    // In `parallel` mode a frame's allowance is programs issued, not built: `issuePerFrame` in play.
    b.open(loading, parallel && !loading ? LINK_TUNE.issuePerFrame : -1);
    let from = '';
    // What is in flight first: every object whose programs are all ready resolved (outright, all of it, once the
    // mode is not `parallel` any more or the tab has hidden), within the frame's milliseconds like everything else.
    if (links !== null && this.flight.objects > 0) this.land(links, clock, b, parallel);
    const cap = loading ? LINK_TUNE.sweepInFlight : LINK_TUNE.inFlight;
    while (b.allows()) {
      if (parallel && this.flight.programsInFlight >= cap) break;
      const job = this.peek();
      if (!job) break;
      const t0 = clock();
      let made = 0;
      let done = true;
      try {
        const step = job.own ? job.own.compile(job.object, b.left, !parallel) : compile(job.object, b.left, !parallel);
        made = step.made;
        done = step.done;
      } catch (err) {
        console.warn(`shaders: ${job.label} could not be compiled ahead of its first draw`, err);
      }
      const ms = clock() - t0;
      if (made > 0) {
        this.builtEver += made;
        if (!from) from = job.label;
        if (!loading) this.notePlay(job.label, made);
      }
      b.charge(made, ms);
      // A job that says it has more to do and built nothing is a job that cannot make progress:
      // it is let go rather than offered for ever. The frame's job cap bounds the rest.
      if (done || made <= 0) {
        if (parallel) this.issued(job, links!, clock);
        else this.finished(job);
      }
    }
    this.settle();
    const over = b.close();
    if (over && from) this.lastOverrun = from;
    out.made = b.made;
    out.ms = b.ms;
    out.jobs = b.jobs;
    out.pending = this.pending;
    out.over = over;
    out.from = from || this.lastOverrun;
    return out;
  }

  /** The line the console writes for an overrunning frame. */
  line(): string {
    return paceLine(this.result.made, this.budget.allowed, this.result.ms, this.result.from || 'something outside the queue');
  }

  /** A job compiled and resolved the old way is taken off, and its own finish runs (its programs are resolved already). */
  private finished(job: Job): void {
    const o = job.object;
    const own = job.own;
    this.drop();
    if (own?.finish) this.finishOwn(own, o, job.label);
  }

  private finishOwn(own: OwnJob, o: THREE.Object3D, label: string): void {
    try {
      own.finish!(o);
    } catch (err) {
      console.warn(`shaders: ${label} could not be finished`, err);
    }
  }

  /**
   * A job whose programs were issued and not resolved (`parallel` mode) is taken off and goes into the flight, with
   * its batch counting it in flight until it is resolved; one whose programs are all resolved already (built behind
   * the screen, or by another object) is finished at once.
   */
  private issued(job: Job, links: QueueLinks, clock: () => number): void {
    const o = job.object;
    const own = job.own;
    const label = job.label;
    const batch = this.headBatch();
    this.drop();
    const programs = links.pending(o);
    if (programs.length === 0) {
      this.countLinks(links.resolve(o));
      if (own?.finish) this.finishOwn(own, o, label);
      return;
    }
    const tag = this.spareTags.pop() ?? { batch: null, own: null, label: '' };
    tag.batch = batch;
    tag.own = own;
    tag.label = label;
    if (batch) batch.inFlight++;
    else this.looseInFlight++;
    this.flight.issue(o, programs, clock(), tag);
  }

  /**
   * The flight looked at: each object finished (its programs ready, or the bound, or the tab hid) resolved, its job's
   * own finish run and its batch told. With `parallel` false (the mode turned, or the tab hid) everything in flight
   * finishes outright now: a hidden tab never reports a program linked, and nothing may wait the bound for it. Each
   * resolve is charged to the frame's budget when one is handed.
   */
  private land(links: QueueLinks, clock: () => number, b: PaceBudget | null, parallel: boolean): void {
    const f = this.flight;
    const now = clock();
    const n = parallel ? f.poll(now, false) : links.hidden() ? f.poll(now, true) : f.finishAll(now);
    for (let i = 0; i < n; i++) {
      const e = f.finished[i];
      const t0 = clock();
      this.resolveEntry(e, links);
      if (b) b.charge(0, clock() - t0);
    }
    f.release();
  }

  private resolveEntry(e: FlightEntry, links: QueueLinks): void {
    const tag = e.tag as FlightTag;
    const o = e.object as THREE.Object3D;
    try {
      // Seen ready: only what reports its link done (a program another job issued since is that job's to wait for).
      this.countLinks(links.resolve(o, e.how === 'ready'));
    } catch (err) {
      console.warn(`shaders: ${tag.label} could not be resolved`, err);
    }
    if (tag.own?.finish) this.finishOwn(tag.own, o, tag.label);
    if (tag.batch) tag.batch.inFlight--;
    else this.looseInFlight--;
    tag.batch = null;
    tag.own = null;
    this.spareTags.push(tag);
  }

  /**
   * Everything on the queue, now, with a breath between objects: behind a loading screen or inside
   * a jump's closed tunnel. Work pushed while this runs is taken too, so a caller need only call it
   * once when its own streaming has stopped.
   *
   * With `play` it is a waiter's flush in play, made because its own polls saw no frame (`QueueWatch`):
   * it takes only the jobs present when it began, and stops the moment a frame looks at the queue again,
   * handing the rest back to the pump. Every program it builds while `play.shown()` says the page is on
   * screen with no loading screen up is counted as `flushedInPlay`: a timer task building programs where
   * frames ought to be ticking, which the frame-judged rule exists to keep at nought. A flush that runs
   * there is the misjudgement itself, however few frames it then catches.
   */
  async flush(compile: QueueCompile, breath: () => Promise<void>, play?: { shown: () => boolean }, clock: () => number = () => performance.now()): Promise<void> {
    const startTicks = this.tickCount;
    let left = play ? this.pending : Number.POSITIVE_INFINITY;
    const links = this.links;
    for (;;) {
      if (play && this.tickCount !== startTicks) break;
      // Read afresh each turn: a tab that hides mid-flush lands everything in flight outright at once.
      const parallel = links !== null && links.parallel() && !links.hidden();
      if (links !== null && this.flight.objects > 0) this.land(links, clock, null, parallel);
      if (parallel) {
        // Issue up to the cap, polling between breaths; an object is resolved the moment its programs are ready.
        const cap = play ? LINK_TUNE.inFlight : LINK_TUNE.sweepInFlight;
        while (left > 0 && this.flight.programsInFlight < cap) {
          const job = this.peek();
          if (!job) break;
          let step: CompileStep = { made: 0, done: true };
          try {
            step = job.own ? job.own.compile(job.object, Number.POSITIVE_INFINITY, false) : compile(job.object, Number.POSITIVE_INFINITY, false);
          } catch (err) {
            console.warn(`shaders: ${job.label} could not be compiled ahead of its first draw`, err);
          }
          this.builtEver += step.made;
          if (play) {
            this.notePlay(job.label, step.made);
            if (step.made > 0 && play.shown()) this.flushedPlay += step.made;
          }
          if (!step.done && step.made > 0) continue;
          this.issued(job, links!, clock);
          left--;
        }
        this.settle();
        if (this.flight.objects === 0 && (left <= 0 || !this.peek())) break;
        await breath();
        continue;
      }
      if (left <= 0) break;
      const job = this.peek();
      if (!job) break;
      try {
        // Nothing is being looked at, so there is no allowance to keep to: the whole object at once.
        const step = job.own ? job.own.compile(job.object, Number.POSITIVE_INFINITY, true) : compile(job.object, Number.POSITIVE_INFINITY, true);
        this.builtEver += step.made;
        if (play) {
          this.notePlay(job.label, step.made);
          if (step.made > 0 && play.shown()) this.flushedPlay += step.made;
        }
        if (!step.done && step.made > 0) continue;
      } catch (err) {
        console.warn(`shaders: ${job.label} could not be compiled ahead of its first draw`, err);
      }
      this.finished(job);
      left--;
      this.settle();
      await breath();
    }
    this.settle();
  }

  /**
   * Let go of the work nobody is waiting on, keeping what is holding something back from being
   * shown: a sweep that is about to compile the whole scene anyway has no use for the scan's list,
   * but the batches must still answer their promises, and they will cost nothing when they run.
   */
  clearLoose(): void {
    for (const j of this.loose) this.dropOwn(j.own, j.object);
    this.loose.length = 0;
  }

  /** An object of an own job let go unbuilt: its owner is told (`OwnJob.dropped`). */
  private dropOwn(own: OwnJob | null, o: THREE.Object3D): void {
    if (!own?.dropped) return;
    try {
      own.dropped(o);
    } catch (err) {
      console.warn('shaders: a job let go could not say so', err);
    }
  }

  /**
   * Let go of everything, answering every promise: a world unloading, or a renderer that has gone. What is in flight
   * is let go unresolved (its materials may be going with the world; a first use resolves whatever stays).
   */
  clear(): void {
    for (const j of this.loose) this.dropOwn(j.own, j.object);
    this.loose.length = 0;
    const f = this.flight;
    const n = f.finishAll(0);
    for (let i = 0; i < n; i++) {
      const e = f.finished[i];
      const tag = e.tag as FlightTag;
      this.dropOwn(tag.own, e.object as THREE.Object3D);
      tag.batch = null;
      tag.own = null;
      this.spareTags.push(tag);
    }
    f.release();
    this.looseInFlight = 0;
    for (const b of this.urgent.splice(0)) {
      for (let i = b.next; i < b.objects.length; i++) this.dropOwn(b.own, b.objects[i]);
      b.resolve();
    }
    for (const b of this.batches.splice(0)) {
      for (let i = b.next; i < b.objects.length; i++) this.dropOwn(b.own, b.objects[i]);
      b.resolve();
    }
    this.budget.forget();
    this.lastOverrun = '';
  }

  /**
   * The next job, left where it is: what must be shown now, then what is being filled in, then
   * what nobody is waiting on. It is only taken off by `drop`, once whoever compiles it says it is
   * finished, so an object that has more than one program in it keeps its place until every one is
   * built. The record it answers with is kept and filled again, never made afresh.
   */
  private peek(): Job | null {
    const b = this.headBatch();
    if (b) {
      this.head.object = b.objects[b.next];
      this.head.label = b.label;
      this.head.own = b.own;
      return this.head;
    }
    if (!this.loose.length) return null;
    const j = this.loose[0];
    this.head.object = j.object;
    this.head.label = j.label;
    this.head.own = j.own;
    return this.head;
  }

  /** The batch with the next job in it: urgent work first, and finished batches answered on the way. */
  private headBatch(): Batch | null {
    return this.firstIn(this.urgent) ?? this.firstIn(this.batches);
  }

  /**
   * The first batch in a list with work left, answering and dropping every finished one before it. A batch whose
   * objects are all taken but some still in flight (`parallel` mode) is neither: it keeps its place, unanswered, and
   * the search goes on past it, so what comes after it can be issued meanwhile. Nothing allocated.
   */
  private firstIn(list: Batch[]): Batch | null {
    let i = 0;
    while (i < list.length) {
      const b = list[i];
      if (b.next < b.objects.length) return b;
      if (b.inFlight > 0) {
        i++;
        continue;
      }
      for (let k = i; k < list.length - 1; k++) list[k] = list[k + 1];
      list.length--;
      b.resolve();
    }
    return null;
  }

  /** Take off the job `peek` just answered with. */
  private drop(): void {
    const b = this.headBatch();
    if (b) {
      b.next++;
      return;
    }
    this.loose.shift();
  }

  /** Answer the promise of every batch whose objects are all done. */
  private settle(): void {
    this.firstIn(this.urgent);
    this.firstIn(this.batches);
  }
}
