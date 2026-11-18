// The hang's clips on the rig (the player's `animateHang`, moved here whole so the climbing's tests drive the game's own
// hand-over on the real rig, never a copy of it): a one-off begun, a held one let go into the loop, the reach-back pose
// held while looking away, the loop itself, and Climbing II, Smoothness II's two additions: a one-off crossfaded straight
// into what follows before its own end (`climb.transitions` 'blend', item 2) and a timed move's one-off kept on the move's
// clock (`climb.hopFlight` 'timed', item 1), a drop held to its own end. With every switch of Smoothness II at 'before' this
// is the smoothness round's `animateHang` to the call.
//
// Pure of the page: it names the rig's methods and the ledge's fields and nothing else (the rig's type only), so node runs
// it with the real `CharacterRig`.
import type { CharacterRig, RigState } from './rig.ts';
import type { LedgeHang } from './ledge.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { ledgeClipName } from '../anim/ledgeClips.ts';
import { WALL_CLIP_NAMES } from '../anim/wallClips.ts';

/** What the hang's clips keep between frames: the pose held now ('' for none) and the fades and rate handed to the rig (kept). */
export interface HangClipState {
  posePlaying: string;
  readonly hangFade: { fade: number };
  readonly ladderRate: { rate: number; fade: number };
}

/** The hang's clips put on the rig for this frame and the rig stepped by `dt` (the caller then turns the spine). */
export function driveHangClips(rig: CharacterRig, L: LedgeHang, dt: number, st: HangClipState): void {
  st.hangFade.fade = CLIMB_TUNE.ease;
  // Climbing II, Smoothness II, item 2 (`climb.transitions` 'blend'): a one-off near its end, or ended, crossfaded straight
  // into what follows (a climb up's crouch named first), the loop from its nearest pose; never under 'before'.
  if (CLIMB_TUNE.transitions === 'blend' && (L.blendNow || L.ended)) {
    if (L.stood || L.blendStand) rig.setState('crouch', 0, null, st.hangFade);
    rig.blendOut(CLIMB_TUNE.transitionBlend);
  }
  if (L.startClip) rig.play(ledgeClipName(L.startClip), { from: L.startFrom, fadeIn: L.startFade, hold: L.holding, keepWeight: CLIMB_TUNE.transitions === 'blend' });
  else if (L.ended) rig.stopOverride(CLIMB_TUNE.ease);
  // Climbing II, item 7: the reach-back pose held from the leading side's hop clip while looking away, and let go of.
  else if (L.poseClip !== st.posePlaying) {
    // (The smoothness round: a cue's pose eases over the cue's own fade, `climb.cueEase`; the hang's ease otherwise.)
    if (L.poseClip) rig.play(ledgeClipName(L.poseClip), { from: L.poseAt, fadeIn: L.poseFadeNow(), hold: true, timeScale: 0 });
    else rig.stopOverride(L.poseFadeNow());
    st.posePlaying = L.poseClip;
  }
  // Smoothness II, item 1: a drop played by the owner's rule is held to its own end, which the drop's clocks decide (the hold
  // renewed every frame by `driveDropClip`, so a drop nobody drives is let go by the rig).
  if (L.dropHold) {
    rig.holdOverride(ledgeClipName(L.dropId), DROP_LEASE);
    L.dropHold = false;
  }
  // A one-off begun or ended takes the held pose's place: it is held again from the next frame where still looking away.
  if (L.startClip || L.ended) st.posePlaying = '';
  if (L.rigState) {
    rig.prefer(L.rigState as RigState, ledgeClipName(L.rigClip));
    // The smoothness round, item 2: a ladder's climb plays the wall's clip at its rate, or its arms over a free hang's legs.
    if (L.rigRate === L.rigRate) {
      st.ladderRate.rate = L.rigRate;
      st.ladderRate.fade = CLIMB_TUNE.ease;
      rig.setState(L.rigState as RigState, 0, null, st.ladderRate);
    } else rig.setState(L.rigState as RigState, 0, L.rigUpper ? (WALL_CLIP_NAMES[L.rigUpper] ?? null) : null, st.hangFade);
  } else rig.setState(L.stood || L.blendStand ? 'crouch' : 'air', 0, null, st.hangFade);
  // Smoothness II, item 1: a timed move's one-off played at the move's own clock (NaN: its own rate, as ever).
  if (L.moveRate === L.moveRate) rig.overrideRate(L.moveRate);
  rig.update(dt);
}

/**
 * How long a let-go drop's hold lasts on the rig past the last frame that drove it, seconds. A backstop and no number of feel:
 * a few frames at the slowest step the game takes (a twentieth), and short enough that a drop the player's frame stops driving
 * (mounted, in noclip, aboard, dead) is let go by the rig before it is seen standing frozen.
 */
export const DROP_LEASE = 0.25;

/**
 * Climbing II, Smoothness II, item 1, after its review: a let-go drop's clip every frame off the ledge (the player's
 * `ledgeClocks`, after the ledge's own `tick`), moved here whole so the climbing's tests drive the game's own lines. The drop's
 * clocks run (`LedgeHang.dropClocks`: `falling` false, in the water or on the rope, ends the drop at once), its clip is put at
 * the clock and run at the frame's rate, its hold renewed for `DROP_LEASE`; a drop whose clip another one-off has taken the
 * place of is over, and nothing of it is handed over; and a one-off the drop's end or the let-go's cut ends is crossfaded into
 * the loop that follows ('blend') or let go over the hang's ease ('before'). Nothing at all while no drop runs and nothing is
 * cut. `rig` null: the clocks alone (the harness's frame).
 */
export function driveDropClip(rig: CharacterRig | null, L: LedgeHang, dt: number, grounded: boolean, falling: boolean): void {
  const dropping = L.dropId;
  L.dropClocks(dt, grounded, falling);
  if (dropping && rig) {
    const name = ledgeClipName(dropping);
    if (rig.overrideName !== name) {
      // (Something else plays now, a landing of the body's own or another one-off: the drop is over and hands nothing over.)
      L.dropId = '';
      L.cutNow = false;
    } else {
      if (L.dropSeek === L.dropSeek) rig.overrideSeek(L.dropSeek, name);
      if (L.dropRateNow === L.dropRateNow) rig.overrideRate(L.dropRateNow, name);
      if (L.dropId) rig.holdOverride(name, DROP_LEASE);
    }
  }
  if (L.cutNow && rig) {
    // Item 2: crossfaded into the loop that follows from its nearest pose ('blend'), as ever otherwise.
    if (CLIMB_TUNE.transitions === 'blend') rig.blendOut(CLIMB_TUNE.transitionBlend);
    else rig.yieldOverride(CLIMB_TUNE.ease);
  }
}
