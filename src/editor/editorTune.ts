// The world editor's numbers, every one of them ours, live through `__debug.editor({ tune })` and, for the numbers of
// feel (the camera's speeds and ease, the mouse's turn, the snapping steps, the window's size), sliders in the debug
// menu's `editor` dials (`editorDials.ts`). The owner decides how a thing feels by hand (2026-10-17: "the 'feel' of
// driving over things, or what is 'too sudden' of a hill steepness change should be something I decide"): each start
// below is the design's (DESIGN.md §2.15, research5 §6) or one of ours with its reason beside it, and none was chosen by
// measuring.
//
// The editor is the dev server's alone: nothing outside `src/editor/` and the editor's own interface files imports this,
// and the game reaches it only through one dynamic import behind `import.meta.env.DEV`, so a build carries none of it.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

/** Every number of the editor, ours. */
export const EDITOR_TUNE = {
  cam: {
    /** Metres a second, flying with nothing held: a little over a run (Minecraft's flight is 10.9). */
    speed: 10,
    /** Shift held: five times over, 50 m/s, to cross a town. */
    fast: 5,
    /** Alt held: a fifth, 2 m/s, for a shelf. */
    slow: 0.2,
    /** A notch of the wheel (or `=` and `-`) multiplies the speed by this: ten notches about nine times. */
    wheelStep: 1.25,
    /** The least and the most the speed steps to, m/s: noclip's 2 to 2,000 brought down at the top. */
    min: 0.5,
    max: 1000,
    /** Seconds the flight eases toward what the keys ask: a little drift; 0 is noclip's instant. */
    ease: 0.1,
    /** How far a drag with C held scales, per pixel (W2): a 170 px drag doubles. */
    scalePerPx: 0.004,
    /** The mouse's look over the game's own sensitivity: 1 is the orbit's, so the hand feels the same. */
    look: 1,
    /** The nearest the pitch comes to straight up or down, radians off the vertical: a little short of it, so the eye keeps a heading. */
    pitchMargin: 0.02,
  },
  /** Metres a second past which the world stands and puts away nobody (each body is a clone and a compile): over a run. */
  livingAbove: 15,
  aim: {
    /** How far the aim's ray reaches for anything, metres. */
    reach: 2000,
    /** Where a ray that meets nothing puts what is in hand, metres along it; the wheel pushes it out and pulls it in. */
    skyReach: 40,
    /** The least and the most the wheel puts it at with nothing under the crosshair, metres. */
    skyNear: 2,
    skyFar: 400,
    /** How far one notch of the wheel moves it, as a share of where it is. */
    skyStep: 0.15,
    /** Metres of the terrain's march a step: the first crossing is found to within this and then halved down. */
    marchStep: 4,
    /** How finely the crossing is halved down to, metres. */
    marchTol: 0.05,
  },
  hover: {
    /** Turned boxes tested every frame, past which the hover is asked `hz` times a second. */
    most: 5000,
    hz: 15,
  },
  pick: {
    /** Pixels within which a handle is under the cursor (W2). */
    hitPx: 10,
    /** Pixels a press must move to be a drag rather than a click. */
    dragPx: 4,
  },
  outline: {
    /** The width of a box's outline on the overlay, pixels. */
    width: 1.5,
    /** The most boxes outlined at once (W2), past which one box round them all. */
    most: 32,
  },
  /** Every action is written through at once, at most this many edits a request (W2's batch). */
  batchMost: 5000,
  /** Past this many rows in a file the bar says how big it is and that it ships in every release. */
  rowsNote: 20000,
  /** Past this many metres of `clear` or `guard` a note says it (the old cap). */
  circleNote: 64,
  write: {
    /** A place written to this many metres: a millimetre. */
    mm: 0.001,
    /** A turn written to this many decimals; the reader renormalises it. */
    turnDigits: 6,
    /** A scale written to this many decimals (W2). */
    scaleDigits: 4,
  },
  /** Ctrl+W asks first while the editor is on (`localStorage['swg.editor.guard'] = '0'` at load is the hatch). */
  guardUnload: true,
  window: {
    /** How wide the window opens, pixels, docked left: the library's grid of pictures and its sources down the side. */
    width: 560,
    /** How tall it opens, as a share of the screen's height. */
    heightShare: 0.78,
  },
};

/** The library's own numbers. */
export const LIBRARY_TUNE = {
  /** How many things placed last are kept under Recent. */
  recent: 30,
  /** Cells built a slice at a time, this many a slice, the first time a source is opened. */
  slice: 2000,
  /** Cells a group shows a page at a time (the give screen's own page). */
  page: 120,
};

/** The tune's shipped values, kept so a reset puts them back. */
export const EDITOR_TUNE_DEFAULTS: typeof EDITOR_TUNE = JSON.parse(JSON.stringify(EDITOR_TUNE));
export const LIBRARY_TUNE_DEFAULTS: typeof LIBRARY_TUNE = JSON.parse(JSON.stringify(LIBRARY_TUNE));

/** A key nobody may write into a tune (the language's own). */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Move numbers of a tune in place from a partial of the same shape: a number for a number, a boolean for a boolean, a
 * nested object into its own; anything else (a key the tune has not got, a value of another kind, a number that is not
 * one) is named in the words handed back rather than taken. Answers what was said.
 */
export function tuneInto(target: Record<string, unknown>, partial: unknown, path = ''): string[] {
  const said: string[] = [];
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    said.push(`${path || 'the tune'} takes an object`);
    return said;
  }
  for (const [k, v] of Object.entries(partial as Record<string, unknown>)) {
    const at = path ? `${path}.${k}` : k;
    if (FORBIDDEN.has(k) || !Object.prototype.hasOwnProperty.call(target, k)) {
      said.push(`${at} is no number of the editor's`);
      continue;
    }
    const was = target[k];
    if (was && typeof was === 'object') {
      said.push(...tuneInto(was as Record<string, unknown>, v, at));
      continue;
    }
    if (typeof was === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) said.push(`${at} takes a number`);
      else target[k] = v;
      continue;
    }
    if (typeof was === 'boolean') {
      if (typeof v !== 'boolean') said.push(`${at} takes true or false`);
      else target[k] = v;
      continue;
    }
    said.push(`${at} is not something to set`);
  }
  return said;
}

/**
 * Who is told a tune moved: the editor, which keeps two of its numbers live beside the tune (the flight's speed, which the
 * wheel steps, and how far a thing in hand stands in the sky, which the wheel moves) and takes a moved tune into them, so
 * a console line or a slider moves what is flown now and not only the next session's start. Null until an editor is made.
 */
export const TUNE_WATCH: { moved: ((partial: unknown) => void) | null } = { moved: null };

/** `__debug.editor({ tune })`: the editor's numbers moved in memory, never saved, and the editor told. Answers what was said. */
export function tuneEditor(partial: unknown): string[] {
  const said = tuneInto(EDITOR_TUNE as unknown as Record<string, unknown>, partial);
  TUNE_WATCH.moved?.(partial);
  return said;
}

/**
 * Which of the two numbers kept live beside the tune a partial names: what the editor takes again when a tune moves
 * (`TUNE_WATCH`). A path present in the partial counts, whatever the value; the tune itself has already refused a bad one.
 */
export function liveTuned(partial: unknown): { speed: boolean; skyReach: boolean } {
  const o = partial && typeof partial === 'object' ? (partial as Record<string, unknown>) : null;
  const cam = o?.cam && typeof o.cam === 'object' ? (o.cam as Record<string, unknown>) : null;
  const aim = o?.aim && typeof o.aim === 'object' ? (o.aim as Record<string, unknown>) : null;
  return { speed: !!cam && 'speed' in cam, skyReach: !!aim && 'skyReach' in aim };
}
