// The race drawer's numbers that are ours to move (`A:\swg3js\racedrawer\DESIGN.md` §2.15), live through
// `__debug.course({ tune })` and the debug menu's sliders for `course`. None of these shapes the ground or what stands on it:
// every such number is a field of the track file (a node's, the course's own, the track's `clear`), so two browsers and the
// walk grid's bake read one world. These are the values a new node and a new course are written with, the rules gates are
// placed by, how the tool's handles move, and when its notes speak; each starts where the design put it, with its reason,
// and every one is a matter of feel the owner sets by hand. Pure; node loads it.

export const COURSE_TUNE = {
  /** A new node's full width (m): the pod gate's own (`TRACK_TUNE.podGateWidth`), room for the pod box's 7 m with room to drift. */
  width: 24,
  /** A new node's shoulder (m): how far the road's edge blends into the land, the client's road falloff over it. */
  shoulder: 8,
  /** A new node's bank (degrees, the driver's right up): flat until banked by hand. */
  bank: 0,
  /** A new node's edge: a natural curve, the shape most of a course is. */
  curve: 'smooth' as 'smooth' | 'straight',
  /** A new course's `clear`, metres past the road's edge kept free of plants and life (from the second wave). */
  clear: 2,
  /** A new course's own numbers (§2.15): the client's road falloff, walls where a crossing's upper road ends, the lower road's slot, the band two passes are one road in, the grass on the road, the walls' place and height. */
  feather: 'easeInOut' as 'linear' | 'easeIn' | 'easeOut' | 'easeInOut',
  crossing: 'wall' as 'wall' | 'slope',
  margin: 2,
  level: 1,
  grass: 'clear' as 'clear' | 'keep',
  wallOut: 0.5,
  wallHigh: 8,
  /** Who a new track is raced as: both kinds, until the Tools tab says one. */
  forPods: true,
  forBikes: true,
  /** A gate every this many metres along the main line (m). */
  gateEvery: 200,
  /** And one at the apex of every turn sharper than this (degrees) over this much road (m). */
  gateTurn: 45,
  gateTurnSpan: 60,
  /** Never two gates nearer than this along the road (m). */
  gateMin: 60,
  /** A gate's place over the road's surface (m): a hull's middle, which a gate is tested at. */
  gateLift: 2.5,
  /** A circuit's grid this far back along the road before gate 0 (m), and a sprint's gate 0 this far along from its start. */
  gridBack: 30,
  gridAhead: 20,
  /**
   * The handles' rates: metres of height and degrees of bank (a gate's turn) for each hundred pixels of the mouse. A width
   * has no rate: its grabber keeps the point grabbed under the cursor along the width line, as every drag of the editor does.
   */
  raiseRate: 2,
  bankRate: 10,
  /** A shoulder stepped this far by C with a notch of the wheel (m); a gate widened this far a notch (m). */
  shoulderStep: 1,
  gateWidthStep: 2,
  /** The notes: a shoulder steeper than this (degrees), room past the widest box of the kinds raced (m), a crossing's clearance under this (m), a bridge's top this far off the deck (m), a touch-up left past this (m). */
  steepNote: 45,
  narrowRoom: 2,
  clearanceNote: 4.5,
  deckLip: 0.5,
  touchNote: 0.5,
  /** Fit to land's step along an edge (m) and how far the land may leave the road's line before a node is put there (m). */
  fitStep: 20,
  fitTol: 1,
  /** Walls where steep: sides rising steeper than this (degrees) within this much of the edge (m). */
  steepFrom: 35,
  wallProbe: 12,
  /** How far off the eye a course is drawn at all (m), and within how far every sample of its spine (past it, every fourth). */
  drawReach: 1500,
  drawNear: 300,
  /** How near on the screen a click must be to a handle, a node or a gate's outline to take it (px). */
  hitPx: 14,
  /** A click within this of the first node closes a draft, and within this of the last finishes it (m). */
  closeReach: 8,
  /** Switches: what the drive rides at a crossing (the bridge placed, or the drawn road), its band, who meets the walls, touch-ups when a course moves, and the ground while dragging. */
  deck: 'bridge' as 'bridge' | 'drawn',
  deckBand: 6,
  /**
   * Who meets the race walls (the third wave, as the owner reshaped them): 'run', a race-driven hull in a run on the walls'
   * track (the run hands them over and takes them back); 'racing', any race-driven hull, every track's walls on the world (to
   * try a wall without a run); 'off', nobody. Nothing else is ever told.
   */
  walls: 'run' as 'run' | 'racing' | 'off',
  /** A new wall's height over its feet (m) and lean (degrees), C with a notch of the wheel on its height (m), and an arc cut every this many metres. */
  newWallHigh: 4,
  newWallLean: 0,
  wallHighStep: 0.5,
  arcStep: 2,
  touchUps: 'keep' as 'keep' | 'clear',
  live: 'drag' as 'drag' | 'release',
  /** How often a drag's course is made again while it is held, a second. */
  previewHz: 10,
  /**
   * A cost number, never feel (§2.15): how many milliseconds a frame lays a drawn course's change into the cached ground
   * (`World.stepCourseRelay`), nearest the cursor first; the chunks over what it laid are then rewritten within the sculpt's own
   * budget. Not a dial.
   */
  relayMs: 2,
};

export type CourseTune = typeof COURSE_TUNE;

/** The tune as it shipped, for the dials' "as shipped" and a reset. */
export const COURSE_TUNE_SHIPPED: Readonly<CourseTune> = { ...COURSE_TUNE };

/** The ranges a number of `COURSE_TUNE` is held to when moved. */
const RANGES: Partial<Record<keyof CourseTune, [number, number]>> = {
  width: [4, 80],
  shoulder: [0, 64],
  bank: [-45, 45],
  clear: [0, 32],
  margin: [0, 16],
  level: [0, 5],
  wallOut: [0, 8],
  wallHigh: [1, 50],
  gateEvery: [20, 4000],
  gateTurn: [5, 180],
  gateTurnSpan: [5, 400],
  gateMin: [5, 1000],
  gateLift: [0, 20],
  gridBack: [0, 400],
  gridAhead: [0, 400],
  raiseRate: [0.05, 50],
  bankRate: [0.5, 90],
  shoulderStep: [0.1, 16],
  gateWidthStep: [0.5, 20],
  steepNote: [5, 89],
  narrowRoom: [0, 20],
  clearanceNote: [0, 50],
  deckLip: [0, 5],
  touchNote: [0, 20],
  fitStep: [2, 400],
  fitTol: [0.05, 20],
  steepFrom: [5, 89],
  wallProbe: [1, 64],
  drawReach: [50, 20000],
  drawNear: [10, 5000],
  hitPx: [4, 60],
  closeReach: [1, 100],
  deckBand: [0.5, 50],
  newWallHigh: [0.5, 50],
  newWallLean: [-60, 60],
  wallHighStep: [0.05, 10],
  arcStep: [0.25, 50],
  previewHz: [1, 60],
  relayMs: [0.1, 100],
};

/** The choices each switch of the tune takes. */
const CHOICES: Partial<Record<keyof CourseTune, readonly (string | boolean)[]>> = {
  curve: ['smooth', 'straight'],
  feather: ['linear', 'easeIn', 'easeOut', 'easeInOut'],
  crossing: ['wall', 'slope'],
  grass: ['clear', 'keep'],
  forPods: [true, false],
  forBikes: [true, false],
  deck: ['bridge', 'drawn'],
  walls: ['run', 'racing', 'off'],
  touchUps: ['keep', 'clear'],
  live: ['drag', 'release'],
};

/** Any number or switch of `COURSE_TUNE` moved live; words for anything refused or held to its range. */
export function tuneCourse(patch: Record<string, unknown> | null | undefined): string[] {
  const words: string[] = [];
  const t = COURSE_TUNE as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!Object.hasOwn(COURSE_TUNE, key)) {
      words.push(`no number called ${key}`);
      continue;
    }
    const k = key as keyof CourseTune;
    const choices = CHOICES[k];
    if (choices) {
      if (!choices.includes(value as string | boolean)) words.push(`${key} is ${choices.join(' or ')}`);
      else t[key] = value;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      words.push(`${key} takes a number`);
      continue;
    }
    const [lo, hi] = RANGES[k] ?? [-Infinity, Infinity];
    const n = Math.min(hi, Math.max(lo, value));
    if (n !== value) words.push(`${key} held to ${lo} to ${hi}: ${n}`);
    t[key] = n;
  }
  return words;
}

/** The range a number of the tune is held to (the dials' own min and max). */
export function courseRange(k: keyof CourseTune): [number, number] | null {
  return RANGES[k] ?? null;
}

/** The choices a switch of the tune takes, as words (the dials' own; the raced-as booleans are the Tools tab's checks). */
export function courseChoices(k: keyof CourseTune): string[] {
  return (CHOICES[k] ?? []).filter((c): c is string => typeof c === 'string');
}
