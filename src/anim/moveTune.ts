// The body's shape on foot (Climbing II's feedback round, items 3 and 4, the owner after playing): what the capsule the
// body wears is while it lies prone and while it walks under something low. Two switches and the numbers of feel beside
// them, moved by `__debug.move({ tune })` and by the debug menu's sliders (`src/anim/moveDials.ts`); every number here is how
// lying down and ducking feel and is the owner's to judge by hand.
//
// - `proneShape` 'lying': a prone body wears a capsule lying along it (0.4 m round at `lyingRadius`'s start, turned with
//   the heading and tipped along the ground), so it passes under anything twice the radius and 0.08 m up or more; 'crouch' is today's (the crouch's upright capsule, 1.0 m, which a lying body could
//   not pass under anything lower than).
// - `duck` 'on': what stands still over the body and a little ahead along its travel sets how tall its capsule may be,
//   from standing down past the crouch to the deepest duck, and the pose follows (the crouch blended in, then the spine
//   and neck bent); 'off' is today's (the capsule standing or crouched by the key alone).
//
// Pure: no engine, no page; node reads it.

export interface MoveTune {
  /** Item 3: 'lying' a prone body wears a capsule lying along it; 'crouch' today's (the crouch's upright capsule). */
  proneShape: 'lying' | 'crouch';
  /** Item 4: 'on' the body ducks under what stands over it and ahead along its travel, without the key; 'off' today's. */
  duck: 'on' | 'off';
  /**
   * The lying capsule's radius, metres (0.2: the capsule and the character controller's 0.04 m kept off the ground under it
   * and off a roof over it stand 0.48 m, about the 0.45 m a body lying on its front stands back to chest, so it crawls under
   * the round's 0.5 m slab at every frame rate; the brief's start, 0.22, needed 0.52 m and passed a 0.5 m slab at 30 and 60
   * frames a second and stopped at 144 and 240, the controller squeezing through less than its offset at a long step only).
   */
  lyingRadius: number;
  /** How far past the body's own front the duck looks for something low along its travel, metres (the round's start, 0.6: a stride). */
  duckAhead: number;
  /** The least the capsule shrinks to under something low, metres of body (the round's start, 0.75: a deep stoop under the crouch's 1.0). */
  duckMost: number;
  /** How fast the capsule shrinks and grows as the room over it changes, metres of height a second (ours, 3: standing to the crouch in 0.2 s, about the rig's own fade between two clips). */
  duckRate: number;
  /** How far the spine bends forward at the deepest duck, degrees (ours, 40: the head lowered the quarter metre past the crouch over a torso of about 0.6 m). */
  duckBend: number;
  /** How far the neck bends forward with it at the deepest duck, degrees (ours, 20: the head carried down with the back, the face still ahead). */
  duckNeck: number;
}

export const MOVE_TUNE: MoveTune = {
  proneShape: 'lying',
  duck: 'on',
  lyingRadius: 0.2,
  duckAhead: 0.6,
  duckMost: 0.75,
  duckRate: 3,
  duckBend: 40,
  duckNeck: 20,
};

/** What the game shipped with: what a reset puts back. */
export const MOVE_TUNE_SHIPPED: MoveTune = JSON.parse(JSON.stringify(MOVE_TUNE)) as MoveTune;

/** Each number's range: what a typed value is held to, and a slider's ends. */
export const MOVE_RANGES: Record<string, { min: number; max: number }> = {
  lyingRadius: { min: 0.15, max: 0.35 },
  duckAhead: { min: 0, max: 2 },
  // Never under the capsule's own two radii (0.7 m): a capsule can be no shorter than its ball.
  duckMost: { min: 0.7, max: 1.6 },
  duckRate: { min: 0.5, max: 12 },
  duckBend: { min: 0, max: 80 },
  duckNeck: { min: 0, max: 45 },
};

/** The table's choices and the words each takes. */
export const MOVE_CHOICES: Readonly<Record<string, readonly string[]>> = {
  proneShape: ['lying', 'crouch'],
  duck: ['on', 'off'],
};

/** Every switch of the round at its other setting: the body's shape as `12ae8ad` shipped it. */
export const MOVE_BEFORE: Readonly<Record<string, string>> = {
  proneShape: 'crouch',
  duck: 'off',
};

/** The round's body switches at their other setting (today's capsule: standing, or crouched by the key, prone, kneeling). */
export function moveBefore(): void {
  const t = MOVE_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(MOVE_BEFORE)) t[k] = v;
}

/** Whether anything of the round decides the capsule (either switch on): off, the capsule is today's to the line. */
export function shapeRulesOn(): boolean {
  return MOVE_TUNE.duck === 'on' || MOVE_TUNE.proneShape === 'lying';
}

/** A patch of the table (`{ duck: 'off', duckAhead: 0.9 }`): each value held to its range or its choices; the words say what was refused or held. */
export function tuneMove(patch: unknown): string[] {
  const words: string[] = [];
  if (!patch || typeof patch !== 'object') return ["tune takes an object: { duck: 'off', duckAhead: 0.9 }"];
  const table = MOVE_TUNE as unknown as Record<string, unknown>;
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(table, key)) {
      words.push(`no ${key}`);
      continue;
    }
    const choices = MOVE_CHOICES[key];
    if (choices) {
      if (typeof raw !== 'string' || !choices.includes(raw)) words.push(`${key} takes ${choices.map((w) => `'${w}'`).join(' or ')}`);
      else table[key] = raw;
      continue;
    }
    const range = MOVE_RANGES[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      words.push(`${key} takes a number`);
      continue;
    }
    const v = Math.min(range.max, Math.max(range.min, raw));
    if (v !== raw) words.push(`${key} held to ${v} (${range.min} to ${range.max})`);
    table[key] = v;
  }
  return words;
}

/** Everything back as the game shipped it. */
export function resetMoveTune(): void {
  Object.assign(MOVE_TUNE, MOVE_TUNE_SHIPPED);
}
