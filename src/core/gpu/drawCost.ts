// The main thread's draw cost on WebGPU (the GPU port's performance step, item 2): the step's switches, each one way the
// frame issues the same draws for less of the main thread, and each with step 6's draw as its other setting. On WebGPU
// alone (`start.ts` reaches it; nothing of it is loaded on the WebGL path).
//
//   replay        `patchReplay.ts`: a render bundle's replay asks three whether a render object needs refreshing only where
//                 the answer could be other than "nothing" (the first of each program in this render, or one three
//                 refreshes in full on every draw), once the bundle's last full replay found none in need and nothing it
//                 depends on has moved since;
//   shadowCull    `shadowCull.ts`: in a shadow pass a thing that casts no shadow is culled before its frustum test, where
//                 three tested it, listed it, sorted it and stepped over it at its draw;
//   sweepPace     not a draw but the Effects switch's sweep in play (`World.sweepBatches`, `sweepYieldPaced`): a batch there
//                 only lists its objects for the warm-up, which builds them on its own clock, so the sweep waits a frame
//                 once its listing has spent the warm-up's in-play slice (`WARM_TUNE.sliceInPlayMs`), where step 6 waited
//                 a frame after every batch of eight (at Mos Eisley's street 13.5 s, some 960 frames, for 0.8 s of work).
//                 Nothing drawn changes: the old picture is drawn meanwhile and the change-over is the same.
//
// Tried and taken back out, because it measured as nothing: telling every plain caster's shadow program (no picture, no
// node but three's constant colour) that it carries no node, so three refreshes it by comparison rather than in full in
// every cascade. The full refreshes fell from about 450 a frame to 120 at Mos Eisley's street, and the comparison three then
// makes in `needsRefresh` cost what the refreshes had (profiled: `updateForRender` down by 0.06 to 0.07 ms a frame in the
// cascades, `needsRefresh` up by 0.12 to 0.13).
//
// Each is read at load from `localStorage['swg.gpu.draw.<name>']` ('0' leaves it off) and moved live by
// `__debug.gpu({ draw: { <name>: false } })`; each is also a switch of the frame report's A/B (`__debug.perf({ ab: { key:
// 'gpu.<name>' } })`), its old draw first.

export type DrawSwitch = 'replay' | 'shadowCull' | 'sweepPace';

export const DRAW_SWITCHES: readonly DrawSwitch[] = ['replay', 'shadowCull', 'sweepPace'];

/** The switches, each true unless left off at load or moved by the console. */
export const DRAW_COST: Record<DrawSwitch, boolean> = { replay: true, shadowCull: true, sweepPace: true };

/** What each did since load, for the console. */
export const DRAW_STATS = {
  /** Render objects a bundle's replay asked about, and those it stepped over. */
  replayAsked: 0,
  replaySkipped: 0,
  /** Replays made in full (no record of a clean replay, or something moved since). */
  replayFull: 0,
  /** Things culled in a shadow pass for casting no shadow. */
  shadowCulled: 0,
};

/** Whether each was installed (its patch applied), and why not. */
export const DRAW_APPLIED: Record<DrawSwitch, { applied: boolean; why: string }> = {
  replay: { applied: false, why: 'not installed' },
  shadowCull: { applied: false, why: 'not installed' },
  // The game's own sweep reads it through the runtime (`GpuRuntime.sweepPaceMs`): nothing of three's to apply to.
  sweepPace: { applied: true, why: '' },
};

/** The switches as left at load (`localStorage['swg.gpu.draw.<name>']`, '0' off). */
export function readDrawSwitches(): void {
  for (const k of DRAW_SWITCHES) {
    try {
      DRAW_COST[k] = localStorage.getItem(`swg.gpu.draw.${k}`) !== '0';
    } catch {
      DRAW_COST[k] = true;
    }
  }
}

export function isDrawSwitch(n: string): n is DrawSwitch {
  return (DRAW_SWITCHES as readonly string[]).includes(n);
}

/** A switch moved live: answers it as it stands. Each is read where it acts, so nothing more is told. */
export function setDrawSwitch(name: DrawSwitch, on: boolean): boolean {
  DRAW_COST[name] = on;
  return DRAW_COST[name];
}

/** What `__debug.gpu()` says of them. */
export function drawCostReport(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of DRAW_SWITCHES) out[k] = { on: DRAW_COST[k], applied: DRAW_APPLIED[k].applied, ...(DRAW_APPLIED[k].applied ? {} : { why: DRAW_APPLIED[k].why }), switch: `__debug.gpu({ draw: { ${k}: false } }), or localStorage['swg.gpu.draw.${k}'] = '0' and a reload; __debug.perf({ ab: { key: 'gpu.${k}' } }) puts the two side by side` };
  out.stats = { ...DRAW_STATS };
  return out;
}

/** The step's switches as the frame report says them (`framePerf.ts`). */
export function drawSwitchesNow(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of DRAW_SWITCHES) out[k] = DRAW_APPLIED[k].applied ? DRAW_COST[k] : `not applied (${DRAW_APPLIED[k].why})`;
  return out;
}

/** Registered with the frame report's A/B, each with its old draw first. */
export function registerDrawPerfSwitches(register: (name: string, sw: { get(): unknown; set(v: unknown): void; values: readonly unknown[]; note?: string }) => void): void {
  for (const k of DRAW_SWITCHES) {
    register(`gpu.${k}`, {
      get: () => DRAW_COST[k],
      set: (v: unknown) => {
        setDrawSwitch(k, v === true);
      },
      values: [false, true],
      note: `the GPU port's performance step on WebGPU: ${k} (off is step 6's draw)`,
    });
  }
}
