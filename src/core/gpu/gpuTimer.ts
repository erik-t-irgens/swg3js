// The card's clock on WebGPU (the GPU port's pass 1, wave 1, item 5; moved onto three's `GPUTimer` in wave 2): the one file
// that knows how three times a render pass, so a change in three's timing changes this file and no other. On WebGPU alone:
// reached through `framePerf.ts`, which `start.ts` reaches; nothing of it is loaded on the WebGL path.
//
// Three r188 (here its development commit 577fb27) took out the backend's `trackTimestamp` and the renderer's
// `resolveTimestampsAsync` for a `GPUTimer`: `begin()` makes a timer of the backend's timestamp pool active, every render pass
// begun while a timer is active is given timestamp writes (`initTimestampQuery` allocates a pair of queries in the pool's
// current set and keeps the timers active then), three's animation loop reads the pool back once a frame
// (`backend.resolveTimestamps`), and `end()` answers the timer's span, from the earliest begin to the latest end of its passes,
// once all of them are read back. So each pass is timed alone by beginning the one kept timer just before the pass begins and
// ending it as soon as it has begun: the pass's pair is allocated inside `beginRender`, and no other pass begins in between.
// The pass's uid (`r:<render call>:<context>:f<frame>`, set by `updateTimeStampUID` just before `beginRender`) names it, as it
// did on 0.187. With no timer active a pass gets no writes, and no query set exists until the first `begin()`: free unless
// asked.
//
// What `end()` answers is read off the build the game loads, never off three's src/: at the commit the build's
// `Backend.endTimer` answers the pool's `getDuration`, a bare number of milliseconds (null when a query was lost), while the
// src/ answers `{ start, end, delta }`, the shape the released 0.188.0 is likely to be built with. Both are read here, so
// the release changes nothing; `threeAnchors.test.ts` pins the build's shape, so the day it moves is seen.
//
// Coarse on Apple's GPUs: their timestamps are taken at the edges of a whole pass, quantised, and a short pass can read nought
// or a whole tick; said wherever the numbers are printed.

import * as WEBGPU from 'three/webgpu';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What a `GPUTimer`'s `end()` answers: the build's bare milliseconds at the pinned commit, its src/'s record, or null. */
type TimerAnswer = number | { delta: number } | null;

/** Three's `GPUTimer` (r188's; not yet in the 0.187 type declarations the game builds against). */
const GPUTimer = (WEBGPU as Any).GPUTimer as new (renderer: Any) => { begin(): void; end(): Promise<TimerAnswer> };

/** A timer's milliseconds out of either shape three answers, or NaN for none. */
export function timerMs(a: TimerAnswer | undefined): number {
  if (typeof a === 'number') return a;
  if (a !== null && typeof a === 'object' && typeof a.delta === 'number') return a.delta;
  return NaN;
}

export interface GpuPassTimer {
  /** Whether the device was granted timestamp queries at all. */
  readonly able: boolean;
  /** Why the numbers are coarse here (Apple's GPUs), or null. */
  readonly coarse: string | null;
  /** Whether passes are being timed now. */
  readonly on: boolean;
  /** From now every render pass three begins is timed. */
  start(): void;
  /** From now none is. */
  stop(): void;
  /** The passes timed since the last read-back, uid to milliseconds in the order begun; null if they did not answer in time. */
  resolve(timeoutMs: number): Promise<Map<string, number> | null>;
  /** Calls `fn(uid, renderContext)` as each render pass begins until the returned function is called. */
  watchPasses(fn: (uid: string, ctx: Any) => void): () => void;
}

/** A promise raced against a timeout: null when it does not answer in time. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** The frame a pass uid belongs to (`...:f<frame>`), or null. */
export function frameOfUid(uid: string): string | null {
  const m = /:f(\d+)$/.exec(uid);
  return m ? m[1] : null;
}

/** One pass timed: its uid and three's answer for it, still to come. */
interface Timed {
  uid: string;
  answer: Promise<TimerAnswer>;
}

/** The card's clock over three's `GPUTimer`. `vendor` is the adapter's (Apple's is coarse). */
export function passTimer(renderer: Any, vendor: string): GpuPassTimer {
  const be = renderer?.backend;
  const able = !!be && be.hasTimestamp === true;
  const coarse = /apple/i.test(vendor) ? "Apple's GPUs take a pass's timestamps at its edges, quantised: short passes read coarse (0 or a whole tick), so compare sums, not small sections" : null;
  let on = false;
  /** The one timer, begun and ended round each pass's beginning (three lets it begin again before an answer is read). */
  let timer: Any = null;
  /** The passes timed and not yet read back, in the order begun. */
  let timed: Timed[] = [];
  /** Every `beginRender` wrap in place, outermost last: the timing's own and the watchers'. */
  const watchers = new Set<(uid: string, ctx: Any) => void>();
  let wrapped: Any = null;
  let hadOwn = false;
  let orig: Any = null;

  const install = (): void => {
    if (wrapped || !be || typeof be.beginRender !== 'function') return;
    hadOwn = Object.prototype.hasOwnProperty.call(be, 'beginRender');
    orig = be.beginRender;
    wrapped = function (this: Any, ctx: Any) {
      let uid = '';
      if (watchers.size > 0 || on) {
        try {
          uid = String(be.getTimestampUID(ctx) ?? '');
        } catch {
          // A pass the clock cannot name is drawn all the same.
        }
      }
      for (const fn of watchers) {
        try {
          fn(uid, ctx);
        } catch {
          // A watcher's fault is the watcher's.
        }
      }
      if (!on || timer === null) return orig.call(this, ctx);
      timer.begin();
      try {
        return orig.call(this, ctx);
      } finally {
        timed.push({ uid, answer: timer.end() });
      }
    };
    be.beginRender = wrapped;
  };
  const uninstall = (): void => {
    if (!wrapped || on || watchers.size > 0) return;
    if (be.beginRender === wrapped) {
      if (hadOwn) be.beginRender = orig;
      else delete be.beginRender;
    }
    wrapped = null;
  };

  return {
    able,
    coarse,
    get on() {
      return on;
    },
    start() {
      if (on || !be || !able) return;
      if (timer === null) timer = new GPUTimer(renderer);
      timed = [];
      on = true;
      install();
    },
    stop() {
      if (!on) return;
      on = false;
      uninstall();
    },
    async resolve(timeoutMs: number) {
      if (!be) return null;
      const batch = timed;
      timed = [];
      const answers = await within(Promise.all(batch.map((t) => t.answer.catch(() => null))), timeoutMs);
      if (answers === null) return null;
      const out = new Map<string, number>();
      for (let i = 0; i < batch.length; i++) {
        const ms = timerMs(answers[i]);
        if (Number.isFinite(ms)) out.set(batch[i].uid, ms);
      }
      return out;
    },
    watchPasses(fn) {
      if (!be || typeof be.beginRender !== 'function') return () => {};
      watchers.add(fn);
      install();
      return () => {
        watchers.delete(fn);
        uninstall();
      };
    },
  };
}
