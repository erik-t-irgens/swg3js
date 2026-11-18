// What the importer cannot read off a file: one row for each clip that needs more than the defaults, keyed by the
// clip's id (the file name's slug; `npm run anims -- import` prints every id). Everything here is the owner's brief
// (`Animation Brief.txt`, never committed) put into numbers, or a measurement's exception.
//
// A row may say:
//   use        the game loads it at start (wave 1's swaps, wave 2a's walks and runs), and its mirrored twin with it;
//              every other clip waits for the console to ask
//   loop       true or false, over what the first and last poses say
//   trimStart  where the game starts a one-off, seconds. The brief counts frames at 30 a second
//   mirror     also write `<id>_mirrored`, its mirror image through the body's middle
//   ground     false for a clip with nothing under its feet (a swim, a fall, a hang): no foot marks, no speed
//   level      true for an airborne loop authored off the ground: the fitter takes its mean height out, so the body
//              rides in its capsule rather than over it

/** A trim given in the brief's frames (its viewer and the source's own counter both step at 30 a second). */
const frames = (n) => Math.round((n / 30) * 1000) / 1000;

export const CLIP_DEFAULTS = Object.freeze({ use: false, trimStart: 0, mirror: false, ground: true, level: false });

export const CLIPS = {
  // ---- wave 1: the brief's "Generic" list -------------------------------------------------------------------------
  // In water, not moving.
  treading_water: { use: true, loop: true, ground: false },
  // Adrift on foot in space.
  flying: { use: true, loop: true, ground: false },
  // Thrown, in the air.
  falling: { use: true, loop: true, ground: false },
  // Thrown, hitting the ground: "everything after the first 11 or 12 frames". A body landing flat, not feet landing:
  // measured as on the ground, it carried two "steps" that were a leg settling beside a body already lying (and the
  // game played them as footsteps a quarter and a half of a second into the impact), so its feet are left out.
  falling_flat_impact: { use: true, loop: false, trimStart: frames(11.4), ground: false },
  // A plain jump's start, every class.
  jumping_up: { use: true, loop: false },
  // In the air after it. Its feet hang a third of a metre over the floor, legs tucked.
  falling_idle: { use: true, loop: true, ground: false },
  // In the air after a flip or a Force jump. Authored a third of a metre over the floor with the legs hanging: levelled.
  floating: { use: true, loop: true, ground: false, level: true },
  // A slow landing.
  jumping_down: { use: true, loop: false },
  // A faster one that does no harm: "skip the first 7 frames".
  falling_to_landing: { use: true, loop: false, trimStart: frames(7) },
  // A landing that harms: "skip the first 16 frames".
  hard_landing: { use: true, loop: false, trimStart: frames(16) },

  // ---- wave 2a: the brief's "Locomotion" list, standing (src/anim/locoTable.ts names every one of these) -----------
  // Forward: the walk (the general one; the other gaits wait for the creator's switch), the jog, the jog while
  // tired, the run and the sprint.
  standard_walk: { use: true },
  slow_run: { use: true },
  drunk_run_forward: { use: true },
  running: { use: true },
  fast_run: { use: true },
  // Backward.
  walking_backwards: { use: true },
  jog_backward: { use: true },
  running_backward: { use: true },
  // Sideways: the slow strafes, the strafe walks, and the jog and the run, whose right-hand sides are their mirror
  // images ("the example online is too different"). A mirrored twin is loaded with the clip it mirrors.
  walk_strafe_left: { use: true },
  walk_strafe_right: { use: true },
  left_strafe_walking: { use: true },
  right_strafe_walking: { use: true },
  jog_strafe_left: { use: true, mirror: true },
  left_strafe: { use: true, mirror: true },
  // The diagonals' jogs: forward and right, and back and right, as the files are; mirrored for the left.
  jog_forward_diagonal: { use: true, mirror: true },
  jog_backward_diagonal: { use: true, mirror: true },

  // ---- later waves: imported and measured now, played only from the console ---------------------------------------
  // The three that climb stairs rise half a metre a cycle, so their hips do not end where they began; pose for pose
  // they end as they began (within two degrees) and are cycles all the same. The two that descend are not: each ends
  // with its legs 46 and 55 degrees from where they began (and no mirror image of it either), so they are left as the
  // one-offs their first and last poses say they are until a later wave decides how stairs are cycled.
  ascending_stairs: { loop: true },
  ascending_stairs_1: { loop: true },
  running_up_stairs: { loop: true },
  // On a wall: the "feet" the measurement finds are on no ground.
  climbing_up_wall: { loop: true, ground: false },
  climbing_down_wall: { loop: true, ground: false },
  // A shimmy that ends nine degrees off where it began; a cycle all the same.
  left_shimmy: { loop: true, ground: false },
  free_hang_left_shimmy: { loop: true, ground: false },

  // ---- Climbing II, phase 3: the bars (src/anim/barClips.ts names what the game plays of it) --------------------------
  // The owner's bar swing: a run, a leap, the hands on the bar, the swing, the release, the flight and the landing, one
  // take (his frames at 30 a second: 17 off the ground, 24-25 the hands on the bar, 25-51 the swing, 52 the release, 63
  // the landing). Its first and last poses are both a body on its feet, so the poses read it as a loop: it is a one-off,
  // played in parts by the bar's own clock (the swing by the pendulum's angle). Its feet are on the ground only at its two
  // ends, and the parts the game plays are in the air: nothing under its feet.
  run_and_swing: { loop: false, ground: false },

  // ---- Climbing II, phase 4: the ropes (src/anim/ropeClips.ts names what the game plays of them) -----------------------
  // On the rope: the still hang, the climb (a loop; played backward for down), and the owner's getting on and swinging,
  // usable from his frame 32 (1.07 s, the feet off the ground, both hands on the rope) and played by the pendulum's angle
  // from there. Nothing under the feet of any of the three.
  hanging: { loop: true, ground: false },
  climbing_a_rope: { loop: true, ground: false },
  start_swinging: { loop: false, ground: false, trimStart: frames(32) },
  // Letting go into a landing (phase 4's item 4), each from the owner's let-go frame: level with the body (31, 1.03 s), knee
  // high (40, 1.33 s), between knee and waist (31, 1.03 s), and waist high with the feet to the wall (28, 0.93 s). Each lands
  // on its feet, so its ground is measured as ever.
  swinging: { loop: false, trimStart: frames(31) },
  swing_to_land_1: { loop: false, trimStart: frames(40) },
  swing_to_land: { loop: false, trimStart: frames(31) },
  swing_into_wall: { loop: false, trimStart: frames(28) },
};

/** A clip's row over the defaults. */
export function rowFor(id) {
  return { ...CLIP_DEFAULTS, ...(CLIPS[id] ?? {}) };
}
