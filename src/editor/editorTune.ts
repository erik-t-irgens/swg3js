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

/**
 * The scatter brush's numbers (DESIGN.md §2.8, research5 §4.7's starts, `brush.ts`): `EDITOR_TUNE.brush` is this very
 * object, so `__debug.editor({ tune: { brush: { spacing: 2 } } })` moves it. Every one the owner's to judge by hand.
 */
export const BRUSH_TUNE = {
  /** The disc's radius, metres: a few trees' worth across. */
  radius: 8,
  /** The density it fills toward, rows of its own entries per 100 m² (Unreal's per 1,000 × 1,000 units): a light wood. */
  density: 2,
  /** The least distance between two plants, and between a plant and anything standing, metres: trunks never touch. */
  spacing: 1.5,
  /** Stamps a second while a button is held, at any frame rate. */
  rate: 8,
  /** A plant's yaw at random; off, the camera's heading. */
  randomYaw: true,
  /** A plant's uniform scale drawn between these: a wood of one tree's size reads as planted. */
  scaleMin: 0.8,
  scaleMax: 1.2,
  /** A plant's up leaned toward the ground's (off), by at most this many degrees (Unreal's example). */
  align: false,
  alignMax: 10,
  /** The ground's slope a plant may stand on, degrees: a tree on a cliff's face reads as an accident. */
  slopeMin: 0,
  slopeMax: 30,
  /** The ground's height a plant may stand at (absolute metres), only with `heightOn`: none to none. */
  heightOn: false,
  heightMin: -1000,
  heightMax: 10000,
  /** Never in the drawn water unless the model is meant for it (the radial flora's own rule). */
  keepOffWater: true,
  /** Never inside what stands (a placed object's own box). */
  keepOffStanding: true,
  /**
   * Never on a road's flat part or a river's bed (Map-maker II's fourth wave: the generator's own road byte, the poles a road
   * or a river clears its plants off), which draws nothing new, so every seed paints alike off the roads.
   */
  keepOffRoads: true,
  /** The share of its own rows in the disc an erase stroke's stamp takes: all of them. */
  eraseShare: 1,
  /** Candidates a stamp tries for each plant it still wants before it gives the rest up (ours: enough for a light wood). */
  tries: 8,
};

/**
 * The sculpt brush's numbers (Map-maker II, DESIGN.md §2.4 and §2.16's starts, `sculpt.ts`), live through
 * `__debug.sculpt({ tune })` and its numbers of feel as sliders in the debug menu's `sculpt` dials. Every one the owner's to
 * judge by hand; none was chosen by measuring. `frameMs` and `floraHz` are the ground's own rebuild's
 * (`GROUND_REWRITE_TUNE`, which ships, since a heights file that lands late in a release is rebuilt the same way): a line
 * that moves them here moves that.
 */
export const SCULPT_TUNE = {
  /** The disc's radius, metres (a small hill), and a notch of C with the wheel's step between these. */
  radius: 12,
  radiusStep: 1.15,
  radiusMin: 1,
  radiusMax: 200,
  /** The share of the radius at full strength before the feather begins. */
  hard: 0.25,
  /** The feather over the rest: the client's own (`generator.ts`), its smoothest to start. */
  falloff: 'easeInOut' as 'linear' | 'easeIn' | 'easeOut' | 'easeInOut',
  /** The mode LMB applies (RMB the inverse: lower for raise, raise for lower; flatten and smooth have none). */
  mode: 'raise' as 'raise' | 'lower' | 'flatten' | 'smooth',
  /** How hard a stamp bites (a share), and raise's and lower's metres a second held at the middle: a metre in half a second. */
  strength: 1,
  speed: 2,
  /** Flatten's and smooth's seconds to close most of the way: a flatten closing in about a second. */
  tau: 0.3,
  smoothTau: 0.5,
  /** Stamps a second while a button is held (the same ground at any frame rate). */
  rate: 30,
  /** Flatten's way: both, raise only (never lowers), lower only (never raises). */
  flatMode: 'both' as 'both' | 'raise' | 'lower',
  /** Flatten's height: the ground under the brush as the button went down, one Shift+clicked, the typed one, or each stamp's. */
  target: 'press' as 'press' | 'sampled' | 'typed' | 'stamp',
  /** The typed height and the last sampled one, absolute metres. */
  height: 0,
  sampled: 0,
  /** Keep off what stands (the game's objects, its trees by their trunks, our buildings, the players' things): a building's doorstep not lifted. */
  keepOff: true,
  keepMargin: 2,
  keepFeather: 4,
  /** A placed tree's trunk: held at its foot without a forest becoming unsculptable. */
  keepTrunkMargin: 0.5,
  keepTrunkFeather: 2,
  /** Carry what stands on the ground (our props and the brush's trees) up and down with it, within this of their foot. */
  carry: true,
  carryNear: 0.25,
  /** The rebuild's milliseconds a frame and its replants a second (`GROUND_REWRITE_TUNE`, the same numbers). */
  frameMs: 2,
  floraHz: 4,
  /** The file's soft lines (it ships in every release): the bar says when it is past them. */
  tilesNote: 2000,
  bytesNote: 8 * 1024 * 1024,
  /** The most one stroke's tiles may hold for its undo, bytes deflated. */
  undoBytes: 16 * 1024 * 1024,
};

/** The sculpt tune's shipped values, for a reset. */
export const SCULPT_TUNE_DEFAULTS: typeof SCULPT_TUNE = JSON.parse(JSON.stringify(SCULPT_TUNE));

/** The words each of the sculpt tune's names takes. */
const SCULPT_WORDS: Record<string, readonly string[]> = {
  falloff: ['linear', 'easeIn', 'easeOut', 'easeInOut'],
  mode: ['raise', 'lower', 'flatten', 'smooth'],
  flatMode: ['both', 'raise', 'lower'],
  target: ['press', 'sampled', 'typed', 'stamp'],
};

/**
 * `__debug.sculpt({ tune })`: the sculpt brush's numbers moved in memory, never saved, its words taken only from their own
 * lists, and `frameMs`/`floraHz` handed to the ground's rebuild (`into`). Answers what was said.
 */
export function tuneSculpt(partial: unknown, into?: { frameMs: number; floraHz: number }): string[] {
  const said: string[] = [];
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return ['sculpt({ tune }) takes an object'];
  const numbers: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial as Record<string, unknown>)) {
    const words = SCULPT_WORDS[k];
    if (words) {
      if (typeof v === 'string' && words.includes(v)) (SCULPT_TUNE as Record<string, unknown>)[k] = v;
      else said.push(`${k} is one of ${words.join(', ')}`);
      continue;
    }
    numbers[k] = v;
  }
  said.push(...tuneInto(SCULPT_TUNE as unknown as Record<string, unknown>, numbers));
  const t = SCULPT_TUNE;
  if (t.radiusMin > t.radiusMax) t.radiusMin = t.radiusMax;
  t.radius = Math.min(t.radiusMax, Math.max(t.radiusMin, t.radius));
  t.hard = Math.min(1, Math.max(0, t.hard));
  if (into) {
    into.frameMs = Math.max(0, t.frameMs);
    into.floraHz = Math.max(0.01, t.floraHz);
  }
  return said;
}

/**
 * The paint brush's numbers (Map-maker II's second wave, DESIGN.md §2.5 and §2.16's starts, `groundBrush.ts`), live through
 * `__debug.groundPaint({ tune })` and its numbers of feel as sliders in the debug menu's `groundPaint` dials. Every one the
 * owner's to judge by hand; none was chosen by measuring. `previewMs` is the ground's own rebuild's share for a paint
 * stroke and `rasterWaitMs` a real-elevation world's loading screen's (`GROUND_REWRITE_TUNE.paintMs`,
 * `GROUND_PAINT_TUNE.rasterWaitMs`, which ship): a line that moves them here moves those.
 */
export const PAINT_TUNE = {
  /** The disc's radius, metres (two cells across either way at 4 m), and a notch of C with the wheel's step between these. */
  radius: 8,
  radiusStep: 1.15,
  radiusMin: 2,
  radiusMax: 200,
  /** The share of the radius at full strength before the feather begins, and the feather: the client's own. */
  hard: 0.5,
  falloff: 'easeInOut' as 'linear' | 'easeIn' | 'easeOut' | 'easeInOut',
  /** How hard a stamp bites (a share of its weight). */
  strength: 1,
  /** A family cell takes the paint where the stamp's weight passes this: a cell is one family or the other, never a share. */
  cellAt: 0.5,
  /** Stamps a second while a button is held (the same paint at any frame rate). */
  rate: 15,
  /** The layer LMB paints and RMB erases (the plants', the fourth wave's, with its own numbers in `FLORA_PAINT_TUNE`). */
  layer: 'family' as 'family' | 'colour' | 'plants',
  /** The palette entry a family stroke lays (its place in the file's palette, from 1) and the colour a colour stroke lays. */
  entry: 0,
  colour: '#a08060',
  /** How much of the chosen colour a cell tends to, and how fast: a held second lays most of it. */
  colourAmount: 1,
  colourRate: 2,
  /** The preview's share of a frame for the chunks it rewrites (`GROUND_REWRITE_TUNE.paintMs`). */
  previewMs: 1.5,
  /** How long a textured real-elevation world's loading screen waits for its raster (`GROUND_PAINT_TUNE.rasterWaitMs`). */
  rasterWaitMs: 20000,
  /** The file's soft lines (it ships in every release): the bar says when it is past them. */
  rowsNote: 4000,
  bytesNote: 8 * 1024 * 1024,
};

/** The paint tune's shipped values, for a reset. */
export const PAINT_TUNE_DEFAULTS: typeof PAINT_TUNE = JSON.parse(JSON.stringify(PAINT_TUNE));

/** The words each of the paint tune's names takes. */
const PAINT_WORDS: Record<string, readonly string[]> = {
  falloff: ['linear', 'easeIn', 'easeOut', 'easeInOut'],
  layer: ['family', 'colour', 'plants'],
};

/**
 * `__debug.groundPaint({ tune })`: the paint brush's numbers moved in memory, never saved, its words taken only from their
 * own lists, its colour only as `#rrggbb`, and `previewMs`/`rasterWaitMs` handed to the shipped ground's (`into`). Answers
 * what was said.
 */
export function tunePaint(partial: unknown, into?: { rewrite?: { paintMs: number }; paint?: { rasterWaitMs: number } }): string[] {
  const said: string[] = [];
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return ['groundPaint({ tune }) takes an object'];
  const numbers: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial as Record<string, unknown>)) {
    const words = PAINT_WORDS[k];
    if (words) {
      if (typeof v === 'string' && words.includes(v)) (PAINT_TUNE as Record<string, unknown>)[k] = v;
      else said.push(`${k} is one of ${words.join(', ')}`);
      continue;
    }
    if (k === 'colour') {
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) PAINT_TUNE.colour = v.toLowerCase();
      else said.push('colour is #rrggbb');
      continue;
    }
    numbers[k] = v;
  }
  said.push(...tuneInto(PAINT_TUNE as unknown as Record<string, unknown>, numbers));
  const t = PAINT_TUNE;
  if (t.radiusMin > t.radiusMax) t.radiusMin = t.radiusMax;
  t.radius = Math.min(t.radiusMax, Math.max(t.radiusMin, t.radius));
  t.hard = Math.min(1, Math.max(0, t.hard));
  t.cellAt = Math.min(1, Math.max(0.001, t.cellAt));
  t.colourAmount = Math.min(1, Math.max(0, t.colourAmount));
  t.entry = Math.max(0, Math.min(255, Math.round(t.entry)));
  if (into?.rewrite) into.rewrite.paintMs = Math.max(0, t.previewMs);
  if (into?.paint) into.paint.rasterWaitMs = Math.max(0, t.rasterWaitMs);
  return said;
}

/**
 * The paint brush's plants layer's numbers (Map-maker II's fourth wave, DESIGN.md §2.6 and §2.16's starts), live through
 * `__debug.floraPaint({ tune })` and its numbers of feel as sliders in the debug menu's `floraPaint` dials. Every one the
 * owner's to judge by hand; none was chosen by measuring.
 */
export const FLORA_PAINT_TUNE = {
  /** The disc's radius, metres (a clearing's or a grove's across), and a notch of C with the wheel's step between these. */
  radius: 12,
  radiusStep: 1.15,
  radiusMin: 4,
  radiusMax: 200,
  /** The share of the radius at full strength before the feather begins, and the feather: the client's own. */
  hard: 0.5,
  falloff: 'easeInOut' as 'linear' | 'easeIn' | 'easeOut' | 'easeInOut',
  /** How hard a stamp bites (a share of its weight). */
  strength: 1,
  /** How much of the chosen recipe a cell tends to (0 to 1): the amount the generator's flora takes, all of it to start. */
  amount: 1,
  /** How fast a held stroke thickens toward it (or an erasing one thins), a second: most of the way in about half a second. */
  thicken: 4,
  /** Stamps a second while a button is held (the same paint at any frame rate). */
  rate: 10,
  /** The recipe a stroke lays (its place in the file's recipes, from 1). */
  recipe: 0,
  /** A new add's density over its family's own (0: the family's own, the world's planting given back). */
  density: 0,
  /** The share a new thin keeps: half. */
  thin: 0.5,
};

/** The flora paint tune's shipped values, for a reset. */
export const FLORA_PAINT_TUNE_DEFAULTS: typeof FLORA_PAINT_TUNE = JSON.parse(JSON.stringify(FLORA_PAINT_TUNE));

/** `__debug.floraPaint({ tune })`: the plants layer's numbers moved in memory, never saved, the falloff only from its list. Answers what was said. */
export function tuneFloraPaint(partial: unknown): string[] {
  const said: string[] = [];
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return ['floraPaint({ tune }) takes an object'];
  const numbers: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial as Record<string, unknown>)) {
    if (k === 'falloff') {
      if (typeof v === 'string' && ['linear', 'easeIn', 'easeOut', 'easeInOut'].includes(v)) FLORA_PAINT_TUNE.falloff = v as typeof FLORA_PAINT_TUNE.falloff;
      else said.push('falloff is one of linear, easeIn, easeOut, easeInOut');
      continue;
    }
    numbers[k] = v;
  }
  said.push(...tuneInto(FLORA_PAINT_TUNE as unknown as Record<string, unknown>, numbers));
  const t = FLORA_PAINT_TUNE;
  if (t.radiusMin > t.radiusMax) t.radiusMin = t.radiusMax;
  t.radius = Math.min(t.radiusMax, Math.max(t.radiusMin, t.radius));
  t.hard = Math.min(1, Math.max(0, t.hard));
  t.amount = Math.min(1, Math.max(0, t.amount));
  t.thin = Math.min(1, Math.max(0, t.thin));
  t.density = Math.max(0, t.density);
  t.recipe = Math.max(0, Math.min(255, Math.round(t.recipe)));
  return said;
}

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
  gizmo: {
    /** How far the gizmo's handles reach out from the pivot, pixels on the screen at any distance: a fist's width. */
    px: 90,
    /** How thick its lines are, pixels. */
    width: 2,
  },
  snap: {
    /** Whether the grid and the angle snap at all (`\` turns it off and on for the session). */
    on: true,
    /** The grid a session starts on, metres: `PLACE_HOLD_TUNE`'s own prop lift step's neighbour, fine enough for a shelf. */
    grid: 0.25,
    /** The steps `[` and `]` go through, metres (0.1 and 0.25 are the placing hand's own lift steps). */
    gridSteps: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16],
    /** The angle a session starts on, degrees: the placing hand's own wheel step. */
    angle: 15,
    /** The angles Shift with `[` and `]` go through, degrees. */
    angleSteps: [1, 5, 15, 45, 90],
    /** The step a scale snaps to while snapping is on. */
    scaleStep: 0.05,
    /** The most Shift+End (and "On the surface") leans a thing's up toward a surface's, degrees. */
    normalMaxDeg: 10,
    /** Pixels within which V takes a moving selection's faces flush to a neighbour's. */
    neighbourPx: 12,
  },
  nudge: {
    /** The arrows go along the world axis nearest the camera's forward and right (off: the game's own -Z and +X). */
    cameraRelative: true,
  },
  /** Metres a duplicate is offset from what it copies (0: in place, picked to be moved). */
  dupOffset: 0,
  /** A delete of more than this many rows asks once in the page. */
  askAbove: 25,
  /** Actions kept to undo, per world, for the session. */
  undoMost: 200,
  /** Milliseconds the bar waits after a write before it asks git what the files are now. */
  statusDebounceMs: 500,
  /** Metres round the first picked within which "all like this" picks (0: the whole file). */
  likeReach: 0,
  /** Past these a scale is said on the bar (a note, never a refusal: the reader's backstops are 0.001 and 1,000). */
  scaleNote: { low: 0.05, high: 20 },
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
  /**
   * Past this many permanent rows drawn one by one (filed while their tier stood), the bar says how many and what they
   * cost, and offers Fold now (DESIGN.md §2.8): about 4 ms of frame at research3's measured rate.
   */
  foldHint: 200,
  /**
   * A Fold now by itself once more than `foldHint` rows are drawn one by one and nothing (a key, a drag, a stroke) has come
   * for `autoFoldIdle` seconds. Off: a loading screen nobody asked for is a surprise (the owner's default, Q6).
   */
  autoFold: false,
  autoFoldIdle: 3,
  /** The scatter brush's numbers (`BRUSH_TUNE`, the same object). */
  brush: BRUSH_TUNE,
  /** The sculpt brush's numbers (`SCULPT_TUNE`, the same object; its words move through `sculpt({ tune })`). */
  sculpt: SCULPT_TUNE,
  /** The paint brush's numbers (`PAINT_TUNE`, the same object; its words move through `groundPaint({ tune })`). */
  paint: PAINT_TUNE,
  /** The plants layer's numbers (`FLORA_PAINT_TUNE`, the same object; its falloff moves through `floraPaint({ tune })`). */
  floraPaint: FLORA_PAINT_TUNE,
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
export function liveTuned(partial: unknown): { speed: boolean; skyReach: boolean; snap: boolean } {
  const o = partial && typeof partial === 'object' ? (partial as Record<string, unknown>) : null;
  const cam = o?.cam && typeof o.cam === 'object' ? (o.cam as Record<string, unknown>) : null;
  const aim = o?.aim && typeof o.aim === 'object' ? (o.aim as Record<string, unknown>) : null;
  const snap = o?.snap && typeof o.snap === 'object' ? (o.snap as Record<string, unknown>) : null;
  return { speed: !!cam && 'speed' in cam, skyReach: !!aim && 'skyReach' in aim, snap: !!snap && ('on' in snap || 'grid' in snap || 'angle' in snap) };
}
