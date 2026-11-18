// The ledge clips (wave 4 of the animations, the owner's brief's "Free climbing" at lines 157 to 159): which of his
// parkour clips plays what, and where each one's hands and feet are at the frames the game lines it up by, measured on
// the human male in node (the very clips the pack fits for his skeleton, `MixamoPack.clipsFor`) and held to that
// measurement by `ledgeClips.test.ts`, so a reimport that moves a clip fails the test rather than a hang in the game.
//
// The figure's own frame: +x its left, +y up, +z forward, metres, the figure's origin the clip's own ground under the
// hips. Each clip was authored at a height of its own (the braced shimmy's hands stand 0.43 m higher in its frame than
// the braced idle's), so a clip is lined up by its hands (a hang) or its feet (standing, or in the air before a grab):
// `g0`/`g1` the hands' grip point (between the wrist and the index knuckle, both hands' middle) at the clip's start and
// end, `span0`/`span1` the left hand's x less the right's there (negative where the clip has turned the figure round),
// `a0`/`a1` the ankles' middle height, `t0` where the game starts it (a grab from the frame its hands reach the lip and
// stay), `net` the clip's own travel scaled to the human male (the pack strips the level part off every clip, so a
// clip never moves the body: the body is moved by what the ledge rules ask, and only after the player asked).
//
// Twins in his folders, measured and set aside (`LEDGE_TWINS`): `hanging_idle` is the braced idle's very pose (its file
// at the folder's root), `hanging_idle_1` the free hang's "looking up" idle's, `left_shimmy` and `right_shimmy` the
// free shimmies' poses with their travel taken out in Mixamo. `braced_hang_shimmy` goes right and `braced_hang_shimmy_1`
// left (the pair is a pair of directions). Of the four free idles the Parkour folder's own (`free_hang_hanging_idle`,
// 4.7 s) is the idle; the looking-up one is not used. `braced_hang_drop` drops to its own ground 2.1 m under the lip and
// turns round, which the world's ground never is, so the straight let-go (`braced_hang_drop_1`) is the drop.
// `jump_to_freehang` starts on the ground and runs 2.2 m into a free hang: the grab is the air's, so the airborne
// `jump_to_hang` is the free grab. `idle_to_braced_hang` and `stand_to_freehang` are a standing jump up into the hang
// (not a step down, as the brief named the first): they are the grab of a slow, standing jump.
//
// Pure: numbers and names only.

/** One clip's measured numbers (see the header). */
export interface LedgeClipFacts {
  dur: number;
  loop: boolean;
  t0: number;
  g0: readonly [number, number, number];
  g1: readonly [number, number, number];
  span0: number;
  span1: number;
  a0: number;
  a1: number;
  net: readonly [number, number, number];
}

/** The human male's rest pose: the hips' and the ankles' height (what a figure's size is measured against, and a foot-anchored line-up). */
export const LEDGE_REST = { hips: 1.002, ankle: 0.093 } as const;

/** The measured table (generated in node on the human male; `ledgeClips.test.ts` measures it again). */
export const LEDGE_FACTS: Readonly<Record<string, LedgeClipFacts>> = {
  braced_hanging_idle: { dur: 2.333, loop: true, t0: 0, g0: [-0.012, 2.01, 0.352], g1: [-0.011, 2.01, 0.352], span0: 0.598, span1: 0.599, a0: 0.817, a1: 0.817, net: [0, 0, 0] },
  braced_hang_shimmy: { dur: 1.167, loop: true, t0: 0, g0: [-0.012, 2.44, 0.352], g1: [-0.012, 2.44, 0.352], span0: 0.598, span1: 0.598, a0: 1.247, a1: 1.247, net: [-0.563, 0, 0] },
  braced_hang_shimmy_1: { dur: 1.167, loop: true, t0: 0, g0: [0.077, 2.44, 0.345], g1: [0.077, 2.44, 0.345], span0: 0.593, span1: 0.593, a0: 1.247, a1: 1.247, net: [0.563, 0, 0] },
  braced_hang_hop_left: { dur: 1.5, loop: true, t0: 0, g0: [-0.012, 2.01, 0.352], g1: [-0.012, 2.01, 0.352], span0: 0.598, span1: 0.598, a0: 0.817, a1: 0.817, net: [1.403, 0, 0] },
  braced_hang_hop_right: { dur: 1.667, loop: true, t0: 0, g0: [-0.012, 1.87, 0.352], g1: [-0.012, 1.87, 0.352], span0: 0.598, span1: 0.598, a0: 0.677, a1: 0.677, net: [-1.248, 0, 0] },
  braced_hang_hop_up: { dur: 1.667, loop: false, t0: 0, g0: [-0.011, 1.808, 0.347], g1: [-0.011, 2.541, 0.347], span0: 0.598, span1: 0.598, a0: 0.614, a1: 1.348, net: [0, 0.734, 0] },
  braced_hang_to_crouch: { dur: 1.133, loop: false, t0: 0, g0: [-0.017, 1.548, 0.347], g1: [-0.004, 1.845, 0.424], span0: 0.598, span1: 0.392, a0: 0.355, a1: 1.725, net: [-0.115, 1.46, 0.553] },
  braced_hang_drop_1: { dur: 0.883, loop: false, t0: 0, g0: [-0.011, 2.711, 0.347], g1: [-0.011, 1.882, 0.347], span0: 0.598, span1: 0.598, a0: 1.518, a1: 0.688, net: [0, -0.829, 0] },
  braced_to_free_hang: { dur: 0.933, loop: false, t0: 0, g0: [-0.011, 2.306, 0.347], g1: [-0.003, 2.319, -0.092], span0: 0.598, span1: 0.572, a0: 1.112, a1: 0.418, net: [-0.009, -0.123, 0.462] },
  jump_from_wall: { dur: 1.25, loop: false, t0: 0, g0: [-0.011, 2.01, 0.347], g1: [0.222, 1.449, -0.302], span0: 0.598, span1: -1.066, a0: 0.817, a1: 0.597, net: [-0.006, -0.103, -1.785] },
  jumping_to_hanging: { dur: 1.5, loop: false, t0: 0.25, g0: [-0.034, 1.911, 1.086], g1: [-0.011, 1.8, 0.347], span0: 0.733, span1: 0.598, a0: 1.116, a1: 0.607, net: [0.091, -0.72, 0.836] },
  braced_hang: { dur: 1.3, loop: false, t0: 0.267, g0: [-0.007, 1.929, 1.157], g1: [-0.011, 1.858, 0.347], span0: 0.605, span1: 0.598, a0: 0.923, a1: 0.665, net: [-0.008, -1.018, 0.994] },
  idle_to_braced_hang: { dur: 1.25, loop: false, t0: 0.567, g0: [-0.027, 2.168, 0.278], g1: [-0.011, 2.231, 0.347], span0: 0.504, span1: 0.598, a0: 0.316, a1: 1.038, net: [0.009, 0.383, 0.181] },
  free_hang_hanging_idle: { dur: 4.7, loop: true, t0: 0, g0: [0.027, 2.285, -0.086], g1: [0.027, 2.285, -0.086], span0: 0.427, span1: 0.427, a0: 0.277, a1: 0.278, net: [0, 0, 0] },
  free_hang_left_shimmy: { dur: 1.367, loop: true, t0: 0, g0: [-0.003, 2.319, -0.076], g1: [0.012, 2.319, -0.071], span0: 0.571, span1: 0.57, a0: 0.418, a1: 0.429, net: [0.369, 0.004, -0.006] },
  free_hang_right_shimmy: { dur: 1.4, loop: true, t0: 0, g0: [-0.002, 2.319, -0.076], g1: [-0.002, 2.319, -0.076], span0: 0.572, span1: 0.572, a0: 0.418, a1: 0.418, net: [-0.392, 0, 0] },
  free_hang_hop_left: { dur: 2.083, loop: true, t0: 0, g0: [-0.003, 2.319, -0.076], g1: [-0.003, 2.319, -0.076], span0: 0.572, span1: 0.572, a0: 0.418, a1: 0.418, net: [0.85, 0, 0] },
  free_hang_hop_right: { dur: 2.083, loop: true, t0: 0, g0: [-0.003, 2.319, -0.076], g1: [-0.003, 2.319, -0.076], span0: 0.572, span1: 0.572, a0: 0.418, a1: 0.418, net: [-0.85, 0, 0] },
  free_hang_to_braced: { dur: 1.133, loop: false, t0: 0, g0: [-0.003, 2.319, -0.092], g1: [-0.011, 2.306, 0.347], span0: 0.572, span1: 0.598, a0: 0.418, a1: 1.112, net: [0.009, 0.123, -0.462] },
  freehang_climb: { dur: 3.867, loop: false, t0: 0, g0: [-0.002, 2.294, -0.094], g1: [-0.056, 3.253, 0.033], span0: 0.57, span1: 0.557, a0: 0.394, a1: 2.444, net: [0.143, 2.036, 0.607] },
  freehang_drop: { dur: 1.333, loop: false, t0: 0, g0: [-0.003, 2.486, -0.092], g1: [-0.059, 0.892, 0.031], span0: 0.572, span1: 0.563, a0: 0.585, a1: 0.097, net: [-0.009, -0.518, -0.438] },
  jump_to_hang: { dur: 2, loop: false, t0: 0.183, g0: [0.045, 2.516, 0.788], g1: [-0.003, 2.398, -0.092], span0: 0.621, span1: 0.572, a0: 1.518, a1: 0.497, net: [0.067, -0.302, 1.052] },
  stand_to_freehang: { dur: 1.7, loop: false, t0: 0.633, g0: [-0.157, 2.228, 0.04], g1: [-0.003, 2.319, -0.092], span0: 0.515, span1: 0.572, a0: 0.357, a1: 0.418, net: [-0.223, 0.335, 0.379] },
  drop_to_freehang: { dur: 2.383, loop: false, t0: 0, g0: [-0.059, 3.261, 0.031], g1: [0.003, 2.319, -0.016], span0: 0.563, span1: -0.572, a0: 2.45, a1: 0.418, net: [0.306, -2.018, 0.427] },
};

/** The twins measured and set aside (see the header): each with the clip whose pose it is. */
export const LEDGE_TWINS: Readonly<Record<string, string>> = {
  hanging_idle: 'braced_hanging_idle',
  hanging_idle_1: 'hanging_idle_looking_up',
  left_shimmy: 'free_hang_left_shimmy',
  right_shimmy: 'free_hang_right_shimmy',
};

/** What plays what, by the hang's kind. A role with no clip (null) is filled as the header says. */
export interface LedgeRoles {
  idle: string;
  shimmyLeft: string;
  shimmyRight: string;
  hopLeft: string;
  hopRight: string;
  /** A hop up: the braced one; a free hang has none and goes braced first where there is wall, else is refused. */
  hopUp: string | null;
  climb: string;
  drop: string;
  /** Rising fast into the hang (a running jump), rising slow (a standing jump), and falling onto it. */
  grabRise: string;
  grabStand: string;
  grabFall: string;
  /** To the other kind of hang where the wall under the lip begins or ends. */
  toOther: string;
}

export const LEDGE_ROLES: Readonly<{ braced: LedgeRoles; free: LedgeRoles }> = {
  braced: {
    idle: 'braced_hanging_idle',
    shimmyLeft: 'braced_hang_shimmy_1',
    shimmyRight: 'braced_hang_shimmy',
    hopLeft: 'braced_hang_hop_left',
    hopRight: 'braced_hang_hop_right',
    hopUp: 'braced_hang_hop_up',
    climb: 'braced_hang_to_crouch',
    drop: 'braced_hang_drop_1',
    grabRise: 'jumping_to_hanging',
    grabStand: 'idle_to_braced_hang',
    grabFall: 'braced_hang',
    toOther: 'braced_to_free_hang',
  },
  free: {
    idle: 'free_hang_hanging_idle',
    shimmyLeft: 'free_hang_left_shimmy',
    shimmyRight: 'free_hang_right_shimmy',
    hopLeft: 'free_hang_hop_left',
    hopRight: 'free_hang_hop_right',
    hopUp: null,
    climb: 'freehang_climb',
    drop: 'freehang_drop',
    grabRise: 'jump_to_hang',
    grabStand: 'stand_to_freehang',
    grabFall: 'jump_to_hang',
    toOther: 'free_hang_to_braced',
  },
};

/**
 * Climbing II, the feedback round (`climb.roomRule` 'fit'): where a climb up that ends nearer the lip or tucked crouched has
 * its clip cut, its figure crouched on the top with both feet down: the time, seconds, and the ankles' middle height there
 * (the figure's own frame, as `a1`). Measured on the human male as the table is (the hips' and ankles' path through the
 * clip): the free climb's feet are both on the top at 3.05 s (ankles 2.439, against its end's 2.444), after which it stands
 * up for 0.8 s more; the braced climb's own end is its crouch, so it is never cut and has no row.
 */
export const LEDGE_CLIMB_CUT: Readonly<Record<string, { t: number; ankle: number }>> = {
  freehang_climb: { t: 3.05, ankle: 2.439 },
};

/** The jump off backward (braced) and the step down into a hang (free; braced is the free one then `toOther`). */
export const LEDGE_JUMP_OFF = 'jump_from_wall';
export const LEDGE_STEP_DOWN = 'drop_to_freehang';

/** Every clip the game asks the pack for (`PackIo.also`, beside the stair clips): the table's. */
export const LEDGE_IDS: readonly string[] = Object.keys(LEDGE_FACTS);

/** A clip's name on a rig (the pack's `mx_` prefix). */
/**
 * Climbing II, Smoothness II, item 6 (`climb.pushOff` 'jka'): the push off a wall is Jedi Academy's own rebound back off a wall,
 * which the rig plays by its own name as it plays every Jedi Academy move.
 */
export const LEDGE_PUSH_OFF = 'BOTH_FORCEWALLREBOUND_BACK';

/** A clip's name on the rig: the pack's `mx_` names, a Jedi Academy move's own (`BOTH_`) as it stands. */
export const ledgeClipName = (id: string): string => (id.startsWith('BOTH_') ? id : `mx_${id}`);
