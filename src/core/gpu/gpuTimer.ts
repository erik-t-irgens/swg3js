// The card's clock on WebGPU (the GPU port's pass 1, wave 1, item 5): the one file that knows how three 0.187 times a render
// pass, so three r188's `GPUTimer` swap changes this file and no other. On WebGPU alone: reached through `framePerf.ts`, which
// `start.ts` reaches; nothing of it is loaded on the WebGL path.
//
// Three 0.187 times a pass when its backend's `trackTimestamp` is on: `initTimestampQuery` gives the pass's descriptor
// timestamp writes into its pool's query set (made at the first pass timed, 2,048 queries), under the pass's uid
// (`r:<render call>:<context>:f<frame>`, set by `updateTimeStampUID` just before `beginRender`); `resolveTimestampsAsync`
// reads the set back, and the pool's `timestamps` map holds each pass's milliseconds by uid. With tracking off a descriptor
// gets no writes and no query set is made: free unless asked.
//
// Coarse on Apple's GPUs: their timestamps are taken at the edges of a whole pass, quantised, and a short pass can read nought
// or a whole tick; said wherever the numbers are printed.

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface GpuPassTimer {
  /** Whether the device was granted timestamp queries at all. */
  readonly able: boolean;
  /** Why the numbers are coarse here (Apple's GPUs), or null. */
  readonly coarse: string | null;
  /** Whether passes are being timed now. */
  readonly on: boolean;
  /** From now every render pass three begins carries timestamp writes. */
  start(): void;
  /** From now none does (as it was before `start`, if timestamps were on at load). */
  stop(): void;
  /** One read-back: each pass of the set three resolved, uid to milliseconds in the order begun; null if it did not answer in time. */
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

/** The card's clock over three 0.187's renderer. `vendor` is the adapter's (Apple's is coarse). */
export function passTimer(renderer: Any, vendor: string): GpuPassTimer {
  const be = renderer?.backend;
  const features = be?.device?.features as Set<string> | undefined;
  const able = !!features && typeof features.has === 'function' && features.has('timestamp-query');
  const coarse = /apple/i.test(vendor) ? "Apple's GPUs take a pass's timestamps at its edges, quantised: short passes read coarse (0 or a whole tick), so compare sums, not small sections" : null;
  let had = false;
  let on = false;
  return {
    able,
    coarse,
    get on() {
      return on;
    },
    start() {
      if (on || !be) return;
      had = be.trackTimestamp === true;
      be.trackTimestamp = true;
      on = true;
    },
    stop() {
      if (!on || !be) return;
      be.trackTimestamp = had;
      on = false;
    },
    async resolve(timeoutMs: number) {
      if (!be) return null;
      const v = await within(Promise.resolve(renderer.resolveTimestampsAsync('render')).catch(() => null), timeoutMs);
      if (v === null) return null;
      const ts = be.timestampQueryPool?.render?.timestamps as Map<string, number> | undefined;
      return ts ? new Map(ts) : new Map();
    },
    watchPasses(fn) {
      if (!be || typeof be.beginRender !== 'function') return () => {};
      const had = Object.prototype.hasOwnProperty.call(be, 'beginRender');
      const orig = be.beginRender;
      const wrapped = function (this: Any, ctx: Any) {
        try {
          fn(String(be.getTimestampUID(ctx) ?? ''), ctx);
        } catch {
          // A pass the watcher cannot name is drawn all the same.
        }
        return orig.call(this, ctx);
      };
      be.beginRender = wrapped;
      return () => {
        if (be.beginRender !== wrapped) return;
        if (had) be.beginRender = orig;
        else delete be.beginRender;
      };
    },
  };
}
