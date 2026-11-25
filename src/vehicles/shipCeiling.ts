// The ships' ceiling over a world's ground (the GPU port's pass 3, wave 2, maker B; the design's question 1, his answer
// "ships may climb higher": the ceiling becomes a dial). A ship's held height and the gentle hand that eases its nose down
// past the ceiling read `SHIP_CEILING.now`: the low deck's fair-weather top over the world's ground plus `above`, never under
// `least`. The clouds' model hands the deck's top in whenever the stack changes (`cloudCeiling.ts`, from the stack he edits,
// so the ceiling follows his heights); with no clouds' model (no deck known) the ceiling is `least`, the old fixed 1,500 m.
// Speeders, bikes and hover cars keep their own ceilings (`vehicle.ts`' specs); space is still offered above 1,100 m
// (`SPACE_GATE_HEIGHT`, `src/main.ts`), under the least ceiling.
//
// Pure, and read as a field: the flight's step reads `now` (no call, so no number is made a frame); `now` is worked out only
// when a dial or the deck moves.

/** The dials and the ceiling now. Feel is the owner's: each start has its reason. */
export const SHIP_CEILING = {
  /**
   * Metres a ship may climb over the low deck's fair-weather top: 1,000 to start (the design's: room to fly above a fair deck
   * and look down on it; Naboo's deck tops out about 2.6 km over its ground, so its ceiling is about 3.6 km).
   */
  above: 1000,
  /** The least ceiling, metres over the ground: 1,500 to start, the old fixed ceiling, so no world's sky is ever lower than it was. */
  least: 1500,
  /** The low deck's fair-weather top over the world's ground now, metres; NaN with none known. Written by `setDeckTop`. */
  deckTop: Number.NaN,
  /** The ceiling now, metres over the ground: what the flight reads. */
  now: 1500,
};

/** The ceiling worked out again from the dials and the deck (`now`). */
function rework(): void {
  const t = SHIP_CEILING.deckTop;
  const c = t === t ? t + SHIP_CEILING.above : SHIP_CEILING.least;
  SHIP_CEILING.now = c > SHIP_CEILING.least ? c : SHIP_CEILING.least;
}

/** The low deck's fair-weather top over the world's ground (metres), or NaN for none (between worlds, no clouds' model). */
export function setDeckTop(top: number): void {
  SHIP_CEILING.deckTop = Number.isFinite(top) ? top : Number.NaN;
  rework();
}

/** The dials moved (the debug menu's, the console's): words for anything held. */
export function tuneShipCeiling(ch: { above?: number; least?: number }): string[] {
  const words: string[] = [];
  if (typeof ch.above === 'number' && Number.isFinite(ch.above)) {
    const v = Math.min(20000, Math.max(0, ch.above));
    if (v !== ch.above) words.push(`above held at ${v} m (0 to 20,000)`);
    SHIP_CEILING.above = v;
  }
  if (typeof ch.least === 'number' && Number.isFinite(ch.least)) {
    const v = Math.min(20000, Math.max(100, ch.least));
    if (v !== ch.least) words.push(`least held at ${v} m (100 to 20,000)`);
    SHIP_CEILING.least = v;
  }
  rework();
  return words;
}

/** The dials' ranges (the debug menu's sliders). */
export const SHIP_CEILING_RANGE = { above: [0, 20000], least: [100, 20000] } as const;
