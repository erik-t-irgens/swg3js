// Every number of a race run and of the track editor that is ours to move (`__debug.track({ tune })`, and the debug
// menu's sliders for `track`): how long the countdown is, the start's window and boost, how long a crash keeps you out,
// the gates the editor drops and how far its buttons nudge one. All of them are matters of feel and the owner's to set
// by hand; each starts where the design put it, with its reason beside it. The track file's own limits are not here:
// they are the reader's (`TRACK_LIMITS` in `trackFile.ts`), which the dev server's editor holds every file to as well,
// so they never move from the browser. Pure; node loads it.

export const TRACK_TUNE = {
  /** Seconds of countdown on the run's own clock, standing at the grid: three, as every starting light has. */
  countdown: 3,
  /** Seconds either side of go within which W pressed (not held from before) earns the start boost: a beat, not a guess. */
  startWindow: 0.3,
  /** The thrust's rate while the start boost lasts, times the plain rate: a start worth timing, never a launch. */
  startBoost: 3,
  /** The start boost ends once the speed passes this share of the plain top (or W is let go): off the line, not round the lap. */
  startCap: 0.8,
  /** Seconds a crash in a run keeps you out before you are put back on a whole vehicle at the last gate: the lost time is the penalty. */
  putBack: 2.5,
  /** The gate the editor drops for a pod (m): wide enough for the pod box's 7 m with room to drift, tall enough for a crest's jump. */
  podGateWidth: 24,
  podGateHeight: 40,
  /** And for a bike (m): the widest racing bike (a transport's 5.9 m) with room either side. */
  bikeGateWidth: 14,
  bikeGateHeight: 25,
  /** How far the editor's nudge buttons move a gate (m) and turn it (degrees). */
  nudge: 1,
  nudgeTurn: 5,
  /** Seconds a split stands in the race block after its gate. */
  splitShow: 4,
  /**
   * Milliseconds the "preparing the track" curtain waits for the course's placed models to load before it compiles
   * them: a bound on the wait, never a number of feel (what is not in by then builds as its tier comes into range).
   */
  warmWaitMs: 8000,
};

export type TrackTune = typeof TRACK_TUNE;

/** The ranges a number of `TRACK_TUNE` is held to when moved. */
const RANGES: Record<keyof TrackTune, [number, number]> = {
  countdown: [0, 10],
  startWindow: [0, 2],
  startBoost: [1, 10],
  startCap: [0, 1],
  putBack: [0, 20],
  podGateWidth: [4, 80],
  podGateHeight: [5, 100],
  bikeGateWidth: [4, 80],
  bikeGateHeight: [5, 100],
  nudge: [0.05, 50],
  nudgeTurn: [0.5, 90],
  splitShow: [0, 30],
  warmWaitMs: [0, 60000],
};

/** Any number of `TRACK_TUNE` moved live; words for anything refused or held to its range. */
export function tuneTrack(patch: Partial<Record<keyof TrackTune, unknown>> | null | undefined): string[] {
  const words: string[] = [];
  const t = TRACK_TUNE as unknown as Record<string, number>;
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!Object.hasOwn(TRACK_TUNE, key)) {
      words.push(`no number called ${key}`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      words.push(`${key} takes a number`);
      continue;
    }
    const [lo, hi] = RANGES[key as keyof TrackTune];
    const n = Math.min(hi, Math.max(lo, value));
    if (n !== value) words.push(`${key} held to ${lo} to ${hi}: ${n}`);
    t[key] = n;
  }
  return words;
}

/** The gate the editor drops for a kind raced as: a pod's or a bike's. */
export function gateSizeFor(kind: string): { w: number; h: number } {
  return kind === 'speederbike' ? { w: TRACK_TUNE.bikeGateWidth, h: TRACK_TUNE.bikeGateHeight } : { w: TRACK_TUNE.podGateWidth, h: TRACK_TUNE.podGateHeight };
}
