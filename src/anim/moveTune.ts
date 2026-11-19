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
  /**
   * Climbing II's smoothness round, item 4 (the owner: "dynamically slow down movement speed depending on height of the
   * crouch so it matches our various crouch and prone heights the closer we get to them, and dynamically switch to their
   * animations if we get to their heights"): 'height' a ducked body's speed eases from the standing class's toward the
   * crouch's as it lowers, wears the crouch's clips at `crouchAt`, eases on toward the crawl's past it, and where the room
   * is under `proneUnder` but a lying body fits it lies down and crawls, getting up again where the room comes back;
   * 'before' the feedback round's duck at the walk's own speeds and clips.
   */
  duckPace: 'height' | 'before';
  /** The ducked height at or under which the body wears the crouch's clips and walks at the crouch's pace, metres (ours, 1.05: the crouch's own 1.0 and the 5 cm the duck keeps over it, so a roof the crouch just passes under is walked under crouched). */
  crouchAt: number;
  /** How much higher than `crouchAt` a ducked body must rise before it takes the walk's clips again, metres (ours, 0.05: a hand's width, so a duck holding at the crouch's height never swaps clips back and forth). */
  crouchBand: number;
  /** The pace's blend by how far down the body is between two heights (standing to `crouchAt`, then `crouchAt` to the lying height): that share raised to this (ours, 1: the pace follows the height straight; over 1 it keeps the faster pace longer, under 1 slows sooner). */
  paceCurve: number;
  /** The room (metres over the feet) under which a ducking body lies down and crawls where a lying body fits (ours, 0.8: the deepest duck's 0.75 and its 0.05 clearance, so every room the duck passes under it walks under and only a lower one is crawled). */
  proneUnder: number;
  /** How far along its travel a room under `proneUnder` lays the body down, metres (ours, 1.2: the lying body's half length, 0.9, and a third of a stride, so it is down before its head reaches the roof). */
  proneAhead: number;
  /** The room over its feet a body that lay down for a low roof needs before it gets up into a crouch, metres (ours, 1.0: the crouch's own height; the duck stands it the rest of the way as the room allows). */
  riseAt: number;
  /**
   * Climbing II, Smoothness II, item 4 (the owner: "My head sometimes clips through low ceilings when doing the auto-crouch and
   * ducking mechanic"): 'clear' the duck reads how far the drawn figure's own top (its head, neck and chest spheres, src/player/
   * bodySpheres.ts, as the pose stands) reaches over the capsule's top, and keeps the room over and ahead of the body that much and
   * `headSkin` more, so it ducks further (and lies down sooner) until the drawn head clears what is over it; 'before' the
   * smoothness round's duck (the capsule's own 5 cm).
   */
  duckHead: 'clear' | 'before';
  /** Item 4: how far the drawn head keeps under what stands over it, metres (ours, 0.03: a hair, so a beam just over the head is passed with the head brushing nothing). */
  headSkin: number;
  /**
   * Climbing II, Smoothness III, item 3 (the owner: "I'm also automatically proning when I get close to intersecting geometry, so
   * I wonder if there's also no minimum to trying to go under something"): 'opening' the duck lays the body down only where it
   * moves toward a real opening: a roof under `proneUnder` whose underside stands at least the lying body's height and
   * `proneSkin` over the floor, open under it for a lying body's length past where the roof begins, the lying body fitting where
   * it lies down; and every cast of the roof probe is asked from a place clear of everything (one that starts inside something,
   * a slab's edge, a piece standing into the floor, the ground's own seam, is no answer: said, and the body stays upright). Anything
   * else (a wall, a step, a slab's edge, a crack lower than that) blocks as a wall does. 'today': Smoothness II's (its casts taken
   * as they come back, a cast begun inside the ground read as an open way under).
   */
  proneMin: 'opening' | 'today';
  /** Item 3: how much over the lying capsule's full height an opening's underside must stand, metres (the brief's start, 0.05: the lying body's 0.4 m and a hand's thickness). */
  proneSkin: number;
  /**
   * Smoothness III, item 3b (the owner: "the animation we use for crouching + walk (alt) has the lowest head clearance of the 3
   * animations"): 'clearance' a body the duck walks under something in the crouch's clips wears the highest-headed of the three
   * crouched walks (`CROUCH_CLIPS`, their heads read off the rig at load) that still clears the roof by `headSkin`, the sneak
   * walk last of all, its capsule held no taller than that clip's own head and never shrunk under the sneak walk's (under it
   * the body lies down by item 3's rule, into an opening, else is stopped as by a wall); the pace the clip's own. 'one':
   * Smoothness II's (the class the keys ask, the capsule shrunk to whatever the room allows down to `duckMost`).
   */
  duckClip: 'clearance' | 'one';
  /**
   * Climbing II, phase 6 (the owner: "great for when sprinting to automatically clamber over obstacles that are appropriate"):
   * 'sprint' a body sprinting into something still whose top it can go over vaults it (or dives over a long low one), and onto a
   * waist-high ledge clambers (src/player/vault.ts); 'run' the same for any run, the sprint among them; 'off' today's (a run
   * meets an obstacle as it always did).
   */
  vault: 'sprint' | 'run' | 'off';
  /** A top at least this high over the feet is vaulted (the brief's start, 0.5: what the step-up's own 0.5 m climbs is no vault). */
  vaultLow: number;
  /** A top at most this high over the feet is vaulted (the brief's start, 1.25: about the hips' height, the clips' own hands stand 0.85 and 0.97 m up). */
  vaultHigh: number;
  /** A top must end with ground beyond within this far past its face to be vaulted; deeper, it is a ledge (the brief's start, 2 m). */
  vaultFar: number;
  /**
   * Past this depth a top no higher than `diveHigh` is dived over (`jump_over`) rather than vaulted, metres (ours, 1.0: the hand
   * vaults' own figures clear their own top over a metre of depth and dip into it past that, measured).
   */
  vaultDeep: number;
  /** The highest top a dive is taken over, metres over the feet (ours, 1.25: `vaultHigh`'s own, since the dive's figure clears 1.6 m over 1.5 m of depth, measured). */
  diveHigh: number;
  /** A ledge's top at least this high over the feet is clambered onto (the brief's start, 0.8: about the waist). */
  clamberLow: number;
  /** A ledge's top at most this high over the feet is clambered onto; higher, the face is a wall, as today (the brief's start, 1.4). */
  clamberHigh: number;
  /** A vault's hand plants this far in from the near edge of the top (ours, 0.25: a hand's breadth or two, as the clips' own; held to half the depth). */
  vaultHandIn: number;
  /** A clamber's hand lands this far in past the face (ours, 0.27: the clip's own, measured, so its feet come down where it put them). */
  clamberHandIn: number;
  /** A vault's feet come down at least this far past the far side, metres; its flight is stretched to reach it (ours, 0.3: a foot's length). */
  vaultLand: number;
  /**
   * A vault's clip is played at the speed the body came with over its own run-in, held to these (ours, 0.8 and 1.8: at the sprint's
   * 7 m/s `jumping`'s run-in asks 1.86, `jumping_1`'s 2.2; past the most, the body slows to the clip while it vaults).
   */
  vaultRateLeast: number;
  vaultRateMost: number;
  /** How long the run crossfades into a vault, and the vault back out into the run, seconds (ours, 0.15: about the speed classes' own fade between two paces). */
  vaultBlend: number;
  /** A face met further off square than this across the ground is no vault: it is run past or into, as today (ours, 40 degrees). */
  vaultAngle: number;
  /** The room a vault needs over the top it goes over, metres (ours, 0.9: the vaults' heads stand at most 0.82 m over their own top, measured, and a hand's breadth). */
  vaultRoom: number;
  /** The ground beyond a vault may stand this far under the feet; deeper is a drop, not a vault (ours, 1.0 m). */
  vaultDrop: number;
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
  duckPace: 'height',
  crouchAt: 1.05,
  crouchBand: 0.05,
  paceCurve: 1,
  proneUnder: 0.8,
  proneAhead: 1.2,
  riseAt: 1.0,
  duckHead: 'clear',
  headSkin: 0.03,
  proneMin: 'opening',
  proneSkin: 0.05,
  duckClip: 'clearance',
  vault: 'sprint',
  vaultLow: 0.5,
  vaultHigh: 1.25,
  vaultFar: 2,
  vaultDeep: 1,
  diveHigh: 1.25,
  clamberLow: 0.8,
  clamberHigh: 1.4,
  vaultHandIn: 0.25,
  clamberHandIn: 0.27,
  vaultLand: 0.3,
  vaultRateLeast: 0.8,
  vaultRateMost: 1.8,
  vaultBlend: 0.15,
  vaultAngle: 40,
  vaultRoom: 0.9,
  vaultDrop: 1,
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
  // The crouch's clips anywhere from the deepest duck to standing.
  crouchAt: { min: 0.75, max: 1.6 },
  crouchBand: { min: 0, max: 0.3 },
  paceCurve: { min: 0.25, max: 4 },
  // A lying body stands 0.48 m with the controller's skins; a room under 0.45 never fits one.
  proneUnder: { min: 0.45, max: 1.6 },
  proneAhead: { min: 0.3, max: 3 },
  // Never under the capsule's own two radii and a hair (0.75 m).
  riseAt: { min: 0.75, max: 1.6 },
  headSkin: { min: 0, max: 0.2 },
  proneSkin: { min: 0, max: 0.5 },
  // Phase 6: a vault's tops from the step-up's own height to a little over the head's; its reach to the clamber's least.
  vaultLow: { min: 0.3, max: 1.2 },
  vaultHigh: { min: 0.5, max: 1.8 },
  vaultFar: { min: 0.3, max: 4 },
  vaultDeep: { min: 0.2, max: 4 },
  diveHigh: { min: 0.3, max: 1.8 },
  clamberLow: { min: 0.3, max: 1.4 },
  clamberHigh: { min: 0.6, max: 1.8 },
  vaultHandIn: { min: 0.05, max: 1 },
  clamberHandIn: { min: 0.05, max: 1 },
  vaultLand: { min: 0, max: 1.5 },
  vaultRateLeast: { min: 0.3, max: 1.5 },
  vaultRateMost: { min: 0.8, max: 3 },
  vaultBlend: { min: 0, max: 0.6 },
  vaultAngle: { min: 5, max: 85 },
  vaultRoom: { min: 0.3, max: 2 },
  vaultDrop: { min: 0, max: 4 },
};

/** The table's choices and the words each takes. */
export const MOVE_CHOICES: Readonly<Record<string, readonly string[]>> = {
  proneShape: ['lying', 'crouch'],
  duck: ['on', 'off'],
  duckPace: ['height', 'before'],
  duckHead: ['clear', 'before'],
  proneMin: ['opening', 'today'],
  duckClip: ['clearance', 'one'],
  vault: ['sprint', 'run', 'off'],
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

/**
 * Climbing II, the smoothness round: the body's switches it adds, at their other setting (`d2d5bc4`'s body): item 4's
 * `duckPace` ('before': the feedback round's duck at the walk's own speeds and clips). `climbSmoothBefore` (climbTune.ts)
 * puts these back with the climbing's. (The feedback round's own `moveBefore` turns the duck off, and with the duck off the
 * pace never runs, so it need not name this one.)
 */
export const MOVE_SMOOTH_BEFORE: Readonly<Record<string, string>> = { duckPace: 'before' };

/** The smoothness round's body switches at their other setting. */
export function moveSmoothBefore(): void {
  const t = MOVE_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(MOVE_SMOOTH_BEFORE)) t[k] = v;
}

/**
 * Climbing II, Smoothness II: the body's switches it adds, at their other setting (`dd88180`'s body): item 4's `duckHead`
 * ('before': the smoothness round's duck, the capsule's own clearance). `climbSmooth2Before` (climbTune.ts) puts these back with
 * the climbing's.
 */
export const MOVE_SMOOTH2_BEFORE: Readonly<Record<string, string>> = { duckHead: 'before' };

/** Smoothness II's body switches at their other setting. */
export function moveSmooth2Before(): void {
  const t = MOVE_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(MOVE_SMOOTH2_BEFORE)) t[k] = v;
}

/**
 * Climbing II, Smoothness III: the body's switches it adds, at their other setting (Smoothness II's body, `c57c0a5`): items 3 and
 * 3b (`proneMin` 'today', `duckClip` 'one'). `climbSmooth3Before` (climbTune.ts) puts these back with the climbing's.
 */
export const MOVE_SMOOTH3_BEFORE: Readonly<Record<string, string>> = { proneMin: 'today', duckClip: 'one' };

/** Smoothness III's body switches at their other setting. */
export function moveSmooth3Before(): void {
  const t = MOVE_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(MOVE_SMOOTH3_BEFORE)) t[k] = v;
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
