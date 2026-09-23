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
//  2. `KHR_parallel_shader_compile` is advertised on those drivers and does not work: six programs
//     linked, four seconds of wall clock, and `COMPLETION_STATUS_KHR` still false for every one of
//     them. `compileAsync` waits on exactly that flag, so anything awaiting it waits without a
//     bound — which is why one ship took ten and a half seconds to prepare. Nothing in this file
//     waits on it; the link is resolved outright, which is slower on a machine where the extension
//     works and finite on one where it does not.
//
// The queue itself is the pacing. Work is taken off it a job at a time until the frame's allowance
// is spent (`PaceBudget`), so a slow compiler costs a dropped frame rather than a freeze, and a
// job that turns out to cost nothing (its material was built behind the screen) costs nothing.
// Jobs that hold something back from being shown come before jobs that nobody is waiting on.
//
// Nothing here knows what anything looks like, and nothing here may ever change it: a program that
// is built is the same program, built earlier.

import type * as THREE from 'three';
import { PACE_TUNE, PaceBudget, paceLine } from './programPace.ts';

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
 */
export function resolveLinks(renderer: THREE.WebGLRenderer | null | undefined, root: THREE.Object3D | Iterable<THREE.Material>): number {
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
    if (rec.programs) for (const p of rec.programs.values()) done += finish(p);
    else done += finish(rec.currentProgram);
  }
  return done;
}

function finish(program: LazyProgram | undefined): number {
  if (!program || typeof program.getUniforms !== 'function' || resolved.has(program)) return 0;
  resolved.add(program);
  try {
    program.getUniforms();
  } catch {
    // A program that will not answer is a program that will not draw either; the draw reports it.
  }
  return 1;
}

/** One thing to compile, and what to say about it if the frame it lands on overruns. */
interface Job {
  object: THREE.Object3D;
  label: string;
}

/** A group of objects something is waiting on before it is shown. */
interface Batch {
  objects: THREE.Object3D[];
  next: number;
  label: string;
  resolve: () => void;
}


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
  private readonly head: Job = { object: null as unknown as THREE.Object3D, label: '' };
  /** How many programs have been built through this queue, and how many links it has finished. */
  private builtEver = 0;
  private linkedEver = 0;
  /** What the last overrunning frame was blamed on, for the console. */
  private lastOverrun = '';
  /** When a frame last looked at this queue, and how many times one has. */
  private tickedAt = Number.NEGATIVE_INFINITY;
  private tickCount = 0;

  /**
   * Objects something is waiting on. The promise answers once every one of them has been compiled.
   * `urgent` is for what the player must be shown now, which goes ahead of scenery being filled in.
   */
  push(objects: readonly THREE.Object3D[], label: string, urgent = false): Promise<void> {
    const list = objects.filter(Boolean);
    if (!list.length) return Promise.resolve();
    return new Promise<void>((resolve) => {
      (urgent ? this.urgent : this.batches).push({ objects: list.slice(), next: 0, label, resolve });
    });
  }

  /** Objects nobody is waiting on: compiled whenever a frame has room left. */
  add(objects: readonly THREE.Object3D[], label: string): void {
    for (const o of objects) if (o) this.loose.push({ object: o, label });
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
   * Whether no frame has looked at the queue for long enough that none is running at all.
   *
   * The queue is emptied by a frame and by nothing else, so a stretch with no frame in it means
   * either that nothing is being drawn yet (a loading screen before the world's first frame, a
   * driven session, a tab drawing none) or that the frame loop has stopped. In both cases there is
   * no drawn frame to protect, and a promise from `push` would otherwise never be answered at all:
   * whoever is waiting builds the work itself instead. A frame notes itself with `tick` whether or
   * not it had anything to do, so this is a fact about frames and never about the work.
   */
  idle(now: number): boolean {
    return this.since(now) > PACE_TUNE.idleMs;
  }

  /** How many frames have looked at the queue this session. */
  get ticks(): number {
    return this.tickCount;
  }

  /** How many objects are still to be compiled. */
  get pending(): number {
    let n = this.loose.length;
    for (const b of this.urgent) n += b.objects.length - b.next;
    for (const b of this.batches) n += b.objects.length - b.next;
    return n;
  }

  /** How many of those hold something back from being shown. */
  get waiting(): number {
    let n = 0;
    for (const b of this.urgent) n += b.objects.length - b.next;
    for (const b of this.batches) n += b.objects.length - b.next;
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
  pump(loading: boolean, compile: (o: THREE.Object3D, allowance: number) => CompileStep, clock: () => number): PumpResult {
    const out = this.result;
    const b = this.budget;
    this.tick(clock());
    b.open(loading);
    let from = '';
    while (b.allows()) {
      const job = this.peek();
      if (!job) break;
      const t0 = clock();
      let made = 0;
      let done = true;
      try {
        const step = compile(job.object, b.left);
        made = step.made;
        done = step.done;
      } catch (err) {
        console.warn(`shaders: ${job.label} could not be compiled ahead of its first draw`, err);
      }
      const ms = clock() - t0;
      if (made > 0) {
        this.builtEver += made;
        if (!from) from = job.label;
      }
      b.charge(made, ms);
      // A job that says it has more to do and built nothing is a job that cannot make progress:
      // it is let go rather than offered for ever. The frame's job cap bounds the rest.
      if (done || made <= 0) this.drop();
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
    return paceLine(this.result.made, 1, this.result.ms, this.result.from || 'something outside the queue');
  }

  /**
   * Everything on the queue, now, with a breath between objects: behind a loading screen or inside
   * a jump's closed tunnel. Work pushed while this runs is taken too, so a caller need only call it
   * once when its own streaming has stopped.
   */
  async flush(compile: (o: THREE.Object3D, allowance: number) => CompileStep, breath: () => Promise<void>): Promise<void> {
    for (;;) {
      const job = this.peek();
      if (!job) break;
      try {
        // Nothing is being looked at, so there is no allowance to keep to: the whole object at once.
        const step = compile(job.object, Number.POSITIVE_INFINITY);
        this.builtEver += step.made;
        if (!step.done && step.made > 0) continue;
      } catch (err) {
        console.warn(`shaders: ${job.label} could not be compiled ahead of its first draw`, err);
      }
      this.drop();
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
    this.loose.length = 0;
  }

  /** Let go of everything, answering every promise: a world unloading, or a renderer that has gone. */
  clear(): void {
    this.loose.length = 0;
    for (const b of this.urgent.splice(0)) b.resolve();
    for (const b of this.batches.splice(0)) b.resolve();
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
      return this.head;
    }
    if (!this.loose.length) return null;
    const j = this.loose[0];
    this.head.object = j.object;
    this.head.label = j.label;
    return this.head;
  }

  /** The batch with the next job in it: urgent work first, and finished batches answered on the way. */
  private headBatch(): Batch | null {
    return this.firstIn(this.urgent) ?? this.firstIn(this.batches);
  }

  /** The first batch in a list with work left, answering and dropping every finished one before it. */
  private firstIn(list: Batch[]): Batch | null {
    while (list.length) {
      const b = list[0];
      if (b.next < b.objects.length) return b;
      list.shift();
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
