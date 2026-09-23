// How much shader-program building one frame may pay for.
//
// Making a GPU program is blocking work on the main thread, and on a machine with a slow compiler
// it is a flat third of a second whatever the shader says. A frame that makes seventeen of them is
// a five-second freeze; seventeen frames that make one each is seventeen dropped frames, which is
// a stutter and not a hang. That is the whole of the rule: **one program a frame in ordinary play**.
//
// Two things are counted, because they are not the same thing and only one of them shows up in
// three's own books. `renderer.info.programs.length` counts a program the moment it is *created*,
// which on a driver that defers its linking costs almost nothing; the blocking work lands later,
// when something first asks the program a question (see `resolveLinks` in `programQueue.ts`). So a
// frame is charged for programs made **and** for the milliseconds it spent, and either can close
// it. A queue of jobs that turn out to cost nothing (their materials were built behind the loading
// screen) drains as fast as the job cap lets it and charges nothing.
//
// This file is pure and has no imports but the one number package C measured; a node test drives
// every rule in it directly. Nothing here knows what a program is drawn with, or what it looks
// like, and nothing here may ever decide either.

import { shaderBudget } from './shaderWatch.ts';

export const PACE_TUNE = {
  /** Milliseconds one live frame may spend building programs before the rest wait for the next one. */
  playMs: 6,
  /** The same behind a loading screen or inside a jump's closed tunnel, where the player is waiting on purpose. */
  loadMs: 120,
  /** How many queued jobs one frame may take, however cheap they are: a cap on the walking, not on the building. */
  playJobs: 24,
  /** The same behind a screen. */
  loadJobs: 512,
  /** A play frame that built more than this is worth one line in the console. */
  warnOver: 1,
  /**
   * How long the queue may go unlooked-at before whoever is waiting on it gives up and builds the
   * work itself. Only a frame empties the queue, so a stretch this long with no frame in it means
   * no frame is running: there is nothing to protect and nothing that would ever answer the wait.
   */
  idleMs: 250,
  /** How often someone waiting on the queue looks to see whether a frame is still running. */
  pollMs: 50,
};

/** Change any of the pacing numbers live; unknown names and values that are not finite are ignored. */
export function tuneProgramPace(patch: Partial<typeof PACE_TUNE>): typeof PACE_TUNE {
  for (const key of Object.keys(patch) as (keyof typeof PACE_TUNE)[]) {
    // A name this table does not hold is not quietly added to it: the console is where this is
    // called from, a mistyped name would otherwise grow a number nothing reads, and the caller
    // reads the table back and would see its own typo standing there as though it had taken.
    if (!Object.prototype.hasOwnProperty.call(PACE_TUNE, key)) continue;
    const v = patch[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) PACE_TUNE[key] = v;
  }
  return PACE_TUNE;
}

/**
 * One frame's allowance. Opened at the top of the frame, asked before each job and charged after
 * it; it never reads a clock of its own, so a test drives it with numbers.
 */
export class PaceBudget {
  /** Whether this frame is behind a loading screen (the player is waiting) or in play. */
  private behindScreen = false;
  /** How many programs this frame may still build. */
  private budget = 1;
  /** Milliseconds this frame may still spend. */
  private msBudget = 0;
  /** Jobs this frame may still take. */
  private jobBudget = 0;
  /** What this frame has built and spent so far. */
  private builtNow = 0;
  private spentMs = 0;
  private tookJobs = 0;
  /** The worst play frame seen, and how many frames went over the play budget. */
  private worst = 0;
  private overruns = 0;

  /** Start a frame. `loading` raises the allowance to the loading screen's. */
  open(loading: boolean): void {
    this.behindScreen = loading;
    this.budget = Math.max(0, Math.floor(shaderBudget(loading)));
    this.msBudget = loading ? PACE_TUNE.loadMs : PACE_TUNE.playMs;
    this.jobBudget = loading ? PACE_TUNE.loadJobs : PACE_TUNE.playJobs;
    this.builtNow = 0;
    this.spentMs = 0;
    this.tookJobs = 0;
  }

  /** Whether another job may run on this frame. */
  allows(): boolean {
    return this.builtNow < this.budget && this.spentMs < this.msBudget && this.tookJobs < this.jobBudget;
  }

  /**
   * How many more programs this frame may build. A job that can be taken a piece at a time (an
   * object drawn in two passes is two programs, and the frame may only be able to pay for one)
   * asks for this and stops when it is spent, which is the difference between holding to one
   * program a frame and merely aiming at it.
   */
  get left(): number {
    return Math.max(0, this.budget - this.builtNow);
  }

  /** What a job cost: how many programs it built and how long it took. */
  charge(programs: number, ms: number): void {
    this.tookJobs++;
    if (programs > 0) this.builtNow += programs;
    if (ms > 0) this.spentMs += ms;
  }

  /**
   * Close the frame and say whether it went over. A frame behind a screen never counts as an
   * overrun: that is where the work is meant to be.
   */
  close(): boolean {
    if (this.behindScreen) return false;
    if (this.builtNow > this.worst) this.worst = this.builtNow;
    if (this.builtNow > PACE_TUNE.warnOver) {
      this.overruns++;
      return true;
    }
    return false;
  }

  get made(): number {
    return this.builtNow;
  }

  get ms(): number {
    return this.spentMs;
  }

  get jobs(): number {
    return this.tookJobs;
  }

  get worstFrame(): number {
    return this.worst;
  }

  get overranFrames(): number {
    return this.overruns;
  }

  /** Forget the worst frame and the overrun count (a fresh world, or a console reset). */
  forget(): void {
    this.worst = 0;
    this.overruns = 0;
  }
}

/**
 * The one line the console writes when a play frame built more programs than the rule allows. It
 * names the count, what the frame was allowed and where the work came from, because the number on
 * its own has never once been enough to find the cause.
 */
export function paceLine(made: number, allowed: number, ms: number, from: string): string {
  const cost = ms >= 1 ? ` in ${Math.round(ms)} ms` : '';
  return `shaders: ${made} programs built on one play frame${cost} (${allowed} is the budget); they came from ${from}`;
}

/**
 * How many frames a queue of this many programs will take at a given budget: what to tell the
 * caller who wants to know why a thing has not shown yet. Never less than one frame for anything
 * left to do, and zero for an empty queue.
 */
export function framesFor(pending: number, budget: number): number {
  if (pending <= 0) return 0;
  const per = Math.max(1, Math.floor(budget));
  return Math.ceil(pending / per);
}
