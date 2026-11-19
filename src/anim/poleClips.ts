// Climbing II, phase 5: the pole's clip (the owner's Swinging folder: `Climbing A Rope (1).fbx`, "rope climb up with the feet on
// the rope", which he named for the pole climb: there is no pole clip) and what the game reads of it.
//
// `climbing_a_rope_1` is a loop of 2.4 s (73 frames at 30 a second, the import's report and his table agree) climbing in place:
// each hand reaches up once a round and pulls down against the rig's root while it holds, the feet gathered up and clamped
// under it. There is no down clip: it is played backward for down, as the rope's own climb is. What the pole plays is measured off
// the rig's own fit of the clip once, at the first frame on a pole (`measurePoleTable`, through the rope's own measure,
// src/anim/ropeClips.ts's `RopeTable`: the grip (the hands' mean) and hips in the rig root's frame a sample a time, and the mean
// pose the climb is drawn by), with the climb's rise a round (`climbRiseOf`, the rope's own). The figure is drawn with its clip's
// mean grip on the pole's axis and its hands and feet put on the pole by the limbs' own solve (src/player/poleClimb.ts).
//
// Pure: numbers and names only.
import { RopeTable, climbRiseOf, ROPE_JOINTS, type RopeRig } from './ropeClips.ts';

/** The pole climb (a loop; backward for down). */
export const POLE_CLIMB = 'climbing_a_rope_1';

/** Every clip the poles ask the pack for (`PackIo.also`, beside the ropes'). */
export const POLE_IDS: readonly string[] = [POLE_CLIMB];

/** Its rig name (the pack's `mx_` prefix), made once (nothing names a clip anew on a frame). */
export const POLE_CLIP_NAME = `mx_${POLE_CLIMB}`;

/**
 * Measured on the human male (the pack's clip fitted to him; climbPoles.test.ts measures it again), each over the whole loop: the
 * mean grip over the rig's root (`grip`: where a grab from the ground takes the pole, the clip's own feet clamped up off the root
 * as it climbs), the hips' mean height under that grip (`hang`: the hanging body's middle under the hands), how far behind the
 * grip the hips hang across the ground (`out`: the body's middle that far off the pole's axis), and the climb's rise a round
 * (`climbRise`: each hand's pull, summed).
 */
export const POLE_FACTS = { grip: 1.979, hang: 0.603, out: 0.195, climbRise: 0.49 } as const;

/**
 * The pole's clip measured off a rig (its own fit: every skeleton's is its own), once, at the first frame on a pole; null where
 * the rig has not the clip (yet: asked again the next frame). Its `rise` the rig's own, else `POLE_FACTS.climbRise`.
 */
export function measurePoleTable(rig: RopeRig): RopeTable | null {
  const d = rig.clipDuration(POLE_CLIP_NAME);
  if (d === null) return null;
  const times = RopeTable.times(0, d);
  const samples = new Float64Array(times.length * ROPE_JOINTS.length * 3);
  if (!rig.sampleJoints(POLE_CLIP_NAME, ROPE_JOINTS, times, samples)) return null;
  const T = RopeTable.build(samples, times, d);
  if (!T) return null;
  const rise = climbRiseOf(rig, POLE_CLIP_NAME);
  T.rise = rise !== null && rise > 0.05 ? rise : POLE_FACTS.climbRise;
  return T;
}
