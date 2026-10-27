// The world editor's short curtain (Map-maker II, DESIGN.md §2.9 item 9): a loading screen of the course curtain's shape
// put up over work that must not happen in view -- Fold now filing every tier again, a family of another world lent the
// ground (the third wave), and later a first lake, a borrowed material and an imports reload -- in one order every one of
// them keeps: the screen shown opaque and the game held (travelling, a moment and not a journey, the mouse let go), the
// screen given its paint, the work, the world round the eye waited for (bounded), the sweep that builds behind the screen
// whatever the work brought, the queue flushed and its programs sampled, and the screen hidden and the game let go
// whatever came of the work. `App.editorCurtain` hands it the game's own pieces; the order is here, so a node test drives
// it (`editorCurtain.test.ts`).
//
// Rule for this file (node runs it with type stripping): no imports at all, no constructor parameter properties.

/** The game's pieces a curtain uses, each handed in. */
export interface CurtainDeps {
  /** The screen shown opaque, saying what it is for and on what. */
  show(what: string, detail: string): void;
  setWhat(words: string): void;
  setProgress(p: number): void;
  /** The screen hidden (quickly, with no reveal's glide). */
  hide(): Promise<void>;
  /** The game held for the curtain (travelling, the curtain alone, the mouse let go), and let go as it was. */
  hold(): void;
  release(): void;
  /** Whether the world round the eye is standing, and how far it has come. */
  settled(): boolean;
  progress(): { total: number; stage: string };
  /** The sweep behind the screen (programs built), the queue flushed after it, its programs sampled. */
  compile(): Promise<number>;
  flush(): Promise<void>;
  sample(): void;
  now(): number;
  wait(ms: number): Promise<void>;
}

/** The curtain's own numbers (ours): the screen's paint before the work, the world's bound and its poll. */
export const CURTAIN_TUNE = {
  /** How long the screen is given to paint before the work runs under it, ms. */
  paintMs: 250,
  /**
   * How long the world round the eye is waited for at most, ms (Fold now's bound before it was factored out): the arrival's
   * own settle is 30 s; what is not in by then streams in as any tier does, hidden until built.
   */
  settleMs: 20000,
  /** How often it is asked meanwhile, ms. */
  pollMs: 100,
};

/** What a curtain came to: the work's answer, the programs built behind the screen, and how long it was up. */
export interface CurtainResult<T> {
  answer: T;
  compiled: number;
  ms: number;
}

/**
 * The work run behind the curtain, in the one order (above). The screen is hidden and the game let go whatever came of the
 * work: a work that throws comes out of here after the screen is down.
 */
export async function runCurtain<T>(d: CurtainDeps, what: string, detail: string, work: () => T | Promise<T>, tune: { paintMs: number; settleMs: number; pollMs: number } = CURTAIN_TUNE): Promise<CurtainResult<T>> {
  d.hold();
  d.show(what, detail);
  let compiled = 0;
  const t0 = d.now();
  try {
    // The screen painted before anything moves under it.
    await d.wait(tune.paintMs);
    const answer = await work();
    while (!d.settled() && d.now() - t0 < tune.settleMs) {
      const { total, stage } = d.progress();
      d.setProgress(0.04 + total * 0.8);
      d.setWhat(`loading ${stage}`);
      await d.wait(tune.pollMs);
    }
    d.setWhat('compiling shaders');
    compiled = await d.compile();
    await d.flush();
    d.sample();
    return { answer, compiled, ms: Math.round(d.now() - t0) };
  } finally {
    await d.hide();
    d.release();
  }
}
