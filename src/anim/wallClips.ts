// The wall climb's clips (wave 4 of the animations, item B; the owner's brief's line 159: "I am thinking we can use
// Climbing Up Wall.fbx and Climbing Down Wall.fbx for a Breath of the Wild-like wall climbing system that takes
// stamina"), and where each one's hands and feet are on its own wall, measured on the human male in node from the very
// clips the pack fits for his skeleton (`MixamoPack.clipsFor`) and held to that measurement by `wallClips.test.ts`, so a
// reimport that moves a clip fails the test rather than a climb in the game.
//
// The figure's own frame: +x its left, +y up, +z forward, metres, the figure's origin the clip's own ground under the
// hips. Both clips are fitted as loops with their net climb taken out (the down clip falls 1.26 m a round in its file;
// the up clip was made in place): the body's height is the capsule's, moved by what the climb rules ask, and only while
// the player asks (the owner's rule: loops never carry travel).
//
// A limb is planted where it stands within 4 cm of its own nearest approach to the wall over the round; `stride` is how
// fast a planted hand slides along the wall against the figure in the clip's own time (what the body must climb to keep
// the hands where they are). The down clip was authored with its figure 1.22 m higher over its ground than the up clip's,
// so each is drawn lined up by its hips' middle (`clipLift`). Measured: the up clip's planted hands slide 0.592 m/s and
// the down clip's 0.586, so each plays at the climb's speed over that (scaled by the figure): up at 1 m/s plays it at
// 1.69, down at 1.2 m/s at 2.05.
//
// Gaps in his clips, filled from what is here (the brief asks to say how, so he can download more if he dislikes it):
// - **No sideways climb.** A and D play the up clip slowed to the sideways speed's share of its stride (`sideRate`), the
//   body moved along the face: the hands and feet stay planted on the face by the solves while the body slides past them,
//   each let go and put down again where the clip lifts and plants it. A "Climbing Left/Right" pair from Mixamo would
//   take its place here as a role of its own.
// - **No top-out from a wall climb.** The climb reaches a lip, becomes a braced hang there (the ledges, item A), and W
//   climbs up from it with the braced hang's own climb (`braced_hang_to_crouch`).
// - **No still pose on the wall.** Held still, the clip playing stops where it is (its rate nought), as a climber in
//   Breath of the Wild freezes mid-reach; the planted limbs stay on the face by the solves.
//
// Pure: numbers and names only.

/** One clip's measured numbers (see the header). */
export interface WallClipFacts {
  /** Seconds of a round. */
  dur: number;
  /** Where the planted hands' grip points stand forward of the figure's origin (the two hands' medians' middle), and the planted feet's balls, metres. */
  hand: number;
  foot: number;
  /** A planted hand's slide along the wall against the figure, m/s in the clip's own time (the median over the frames a hand is planted). */
  stride: number;
  /** The grip points', the balls' and the hips' mean height over the figure's origin across the round, metres. */
  hands: number;
  feet: number;
  hips: number;
}

/** The two clips by way. */
export const WALL_CLIPS = { up: 'climbing_up_wall', down: 'climbing_down_wall' } as const;

/** Every wall clip's id: what the pack fits as a loop with its net climb taken out (`FitRow.climb`), and what the game asks it for (`PackIo.also`). */
export const WALL_IDS: readonly string[] = [WALL_CLIPS.up, WALL_CLIPS.down];

/**
 * How far a palm laid flat on a face holds its grip point (between the wrist and the index knuckle) off it, metres on the
 * human male (the wrist's middle about 2.5 cm off a flat palm, the knuckle's about 1.5).
 */
export const PALM_OFF = 0.025;

/** A limb is wholly planted within this of the face, and let go of from this far off it, metres (human male). */
export const WALL_PLANT = { near: 0.05, far: 0.15 } as const;

/** The measured table (generated in node on the human male; `wallClips.test.ts` measures it again). */
export const WALL_FACTS: Readonly<Record<string, WallClipFacts>> = {
  climbing_up_wall: { dur: 2, hand: 0.218, foot: 0.266, stride: 0.592, hands: 1.816, feet: 0.503, hips: 1.114 },
  climbing_down_wall: { dur: 2, hand: 0.313, foot: 0.355, stride: 0.586, hands: 3.007, feet: 1.716, hips: 2.335 },
};

/**
 * Where a clip's own wall stands forward of the figure's origin, metres (human male): at its planted hands' palms (the
 * grip point's `PALM_OFF` in front of them). Its planted feet's balls stand a few centimetres further forward than that
 * (the clip's wall leans back a couple of degrees): the legs' solve bends the knees that much more to stand them `BALL_OFF`
 * off the face, which a bent leg always can, where an arm reaching up for its next hold has nothing left to stretch (drawn
 * against the palms and the soles' middle, the reaching hand stood 2 cm short of the face).
 */
export function clipWall(f: WallClipFacts): number {
  return f.hand + PALM_OFF;
}

/** How far a clip's figure is drawn up against the up clip's (its hips' middle on the up clip's), metres (human male). */
export function clipLift(f: WallClipFacts): number {
  return WALL_FACTS[WALL_CLIPS.up].hips - f.hips;
}
/** A clip's name on a rig (the pack's `mx_` prefix). */
export const wallClipName = (id: string): string => `mx_${id}`;
