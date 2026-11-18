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
import type { BarSwing } from './barSwing.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { LEDGE_CLIP_NAMES, ledgeClipName } from '../anim/ledgeClips.ts';
import { WALL_CLIP_NAMES } from '../anim/wallClips.ts';
import { BAR_TIMES } from '../anim/barClips.ts';
import type { RopeSwing } from './ropeSwing.ts';
import { ROPE_CLIMB, ROPE_CLIP_NAMES, ROPE_HANG, ROPE_MODE_CLIMB as MODE_CLIMB, ROPE_MODE_SWING as MODE_SWING, ROPE_TIMES } from '../anim/ropeClips.ts';

/** Climbing II, phase 3 (maker B): how long the bar's landing fades in from the flight's pose, seconds (a mechanic: the clip's own two frames). */
export const BAR_LAND_FADE = 0.06;

/**
 * A clip's rig name for what is named every frame (Smoothness III, the review's): a wall clip's or a table clip's own, made once
 * (`WALL_CLIP_NAMES`, `LEDGE_CLIP_NAMES`); any other made as ever.
 */
const rigName = (id: string): string => WALL_CLIP_NAMES[id] ?? LEDGE_CLIP_NAMES[id] ?? ledgeClipName(id);

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
    // (Smoothness III, item 4: a free hop up's arms, and its cue's, are a ledge clip's over the free hang's legs.)
    const upper = L.rigUpper ? rigName(L.rigUpper) : null;
    if (L.rigRate === L.rigRate) {
      st.ladderRate.rate = L.rigRate;
      st.ladderRate.fade = CLIMB_TUNE.ease;
      rig.setState(L.rigState as RigState, 0, null, st.ladderRate);
    } else rig.setState(L.rigState as RigState, 0, upper, st.hangFade);
    // Smoothness III, item 4b (`climb.ladderCycle` 'cycle'): the ladder's clip put at its cycle's phase; and items 4 and 4b, the
    // upper layer's at the move's own (NaN: each plays at its rate, as ever).
    if (L.rigSeek === L.rigSeek) {
      rig.timeAt = L.rigSeek;
      rig.setTimeNow(rigName(L.rigClip));
    }
    if (L.upperSeek === L.upperSeek && upper) {
      rig.upperAt = L.upperSeek;
      rig.upperSeek(upper);
    }
  } else rig.setState(L.stood || L.blendStand ? 'crouch' : 'air', 0, null, st.hangFade);
  // Smoothness III, item 1: an arc's move puts its one-off where the move's clock stood at the frame's start (NaN: nowhere, as
  // ever), so the pose and the clock are one at every frame rate.
  if (L.moveSeek === L.moveSeek) {
    rig.overrideSeekAt = L.moveSeek;
    rig.overrideSeekNow(rigName(L.moveClip));
  }
  // Smoothness II, item 1: a timed move's one-off played at the move's own clock (NaN: its own rate, as ever).
  // (Each number through the rig's own field, the review's: one handed across the call was made anew every frame.)
  if (L.moveRate === L.moveRate) {
    rig.overrideRateAt = L.moveRate;
    rig.overrideRateNow();
  }
  rig.update(dt);
}

/**
 * Climbing II, phase 3 (`climb.bars` 'on'): the bar's clip on the rig for this frame and the rig stepped by `dt`, as the hang's
 * are: the bar's clip (`run_and_swing`) begun held at its start's time (still, its rate nought), put each frame at the time the
 * swing's pendulum asks (`BarSwing.poseT`, through the rig's own `overrideSeekAt`: no number handed across a call), the body's
 * own falling loop under it; and on the let-go crossfaded into that loop ('blend') or let go over the hang's ease ('before').
 * The clip's name is the bar's own, made once (`BarSwing.clipName`).
 */
export function driveBarClips(rig: CharacterRig, B: BarSwing, dt: number, st: HangClipState): void {
  st.hangFade.fade = CLIMB_TUNE.ease;
  if (B.startClip) rig.play(B.clipName, { from: B.startFrom, fadeIn: B.startFade, hold: true, timeScale: 0, keepWeight: CLIMB_TUNE.transitions === 'blend' });
  // Maker B (`climb.barFlight` 'fly'): a flight landed, the clip's landing (2.10 s on) played at its own rate to its end, a
  // one-off the rig ends by itself (or the body's own landing takes its place, as a drop's), on the flight's twin.
  else if (B.landNow) rig.play(B.clipName, { from: BAR_TIMES.land, fadeIn: BAR_LAND_FADE, hold: false, timeScale: 1, keepWeight: CLIMB_TUNE.transitions === 'blend' });
  else if (B.ended) {
    // (Maker B: the falling loop remembered first, since the hands on the bar remember the free hang's.)
    rig.setState('air', 0, null, st.hangFade);
    if (CLIMB_TUNE.transitions === 'blend') rig.blendOut(CLIMB_TUNE.transitionBlend);
    else rig.stopOverride(CLIMB_TUNE.ease);
  }
  // Maker B: with the hands on the bar the rig's state is the free hang's (under the bar's clip, never seen), which is what the
  // wire carries to other players' games: the nearest pose they have; in the flight and after it, the falling loop's.
  rig.setState(B.onBar ? 'hangFree' : 'air', 0, null, st.hangFade);
  if (B.holding && B.poseT === B.poseT) {
    rig.overrideSeekAt = B.poseT;
    rig.overrideSeekNow(B.clipName);
  }
  rig.update(dt);
}

/**
 * Phase 3: off the bar (the player's `ledgeClocks`, every frame of the movement, before the bar's own `tick`): a bar let go of
 * by a path that never ran the bar's frame (stood elsewhere, off the feet) still has its held clip on the rig, which is let go
 * of here as the let-go's own frame would (only while that clip is the one playing; nothing at all otherwise).
 */
export function releaseBarClip(rig: CharacterRig | null, B: BarSwing): void {
  if (!B.ended || !rig || rig.overrideName !== B.clipName) return;
  if (CLIMB_TUNE.transitions === 'blend') rig.blendOut(CLIMB_TUNE.transitionBlend);
  else rig.stopOverride(CLIMB_TUNE.ease);
}

/**
 * Climbing II, phase 4 (`climb.ropes` 'on'): the rope's clips on the rig for this frame and the rig stepped by `dt`, as the
 * bar's are. With the hands on the rope the rig's state is the free hang's, its clip the rope's own (`prefer`): `hanging` while it
 * hangs still, `climbing_a_rope` while it climbs, either held (its rate nought) and put each frame at the time the rope has it
 * at (`RopeSwing.loopT`: the hang's own clock, the climb's phase by the way climbed; through the rig's own `timeAt`, no number
 * handed across a call), so the pose is the one the figure is placed by; while it swings `start_swinging` (or its
 * twin, in turn) held over it at the time the pendulum asks (`RopeSwing.poseT`, through `overrideSeekAt`), begun as the swing
 * begins and crossfaded into the hang or the climb as it ends ('blend'; let go over the hang's ease, 'before'). On the let-go the
 * rope's preference taken off and the falling loop taken up. Every clip's name is the rope's own, made once.
 */
export function driveRopeClips(rig: CharacterRig, R: RopeSwing, dt: number, st: HangClipState): void {
  st.hangFade.fade = CLIMB_TUNE.ease;
  const blend = CLIMB_TUNE.transitions === 'blend';
  if (R.ended) {
    rig.prefer('hangFree', null);
    // (Maker B, item 4: a landing ends in the crouch its clip ends in, every other let-go in the falling loop; the flight's or
    // the landing's clip let go of as the swing's is.)
    rig.setState(R.landedNow ? 'crouch' : 'air', 0, null, st.hangFade);
    if (rig.overrideName === R.swingName || rig.overrideName === R.airClip) {
      if (blend) rig.blendOut(CLIMB_TUNE.transitionBlend);
      else rig.stopOverride(CLIMB_TUNE.ease);
    }
  }
  // Maker B, item 4 (`climb.ropeLand` 'lips'): the flight off the rope plays the level clip from its let-go (crossfaded from the
  // swing's pose, the rope's preference taken off), a landing on a face its band's clip from the owner's second (crossfaded from
  // the flight's), each held (its rate nought) and put each frame at the time the flight or the landing has it at
  // (`RopeSwing.airT`, through the rig's own `overrideSeekAt`), the falling loop under it.
  if (R.startFly) {
    rig.prefer('hangFree', null);
    rig.play(R.airClip, { from: R.airT === R.airT ? R.airT : ROPE_TIMES.landLevel, fadeIn: CLIMB_TUNE.ease, hold: true, timeScale: 0, keepWeight: blend });
  } else if (R.startLand) rig.play(R.airClip, { from: R.airT === R.airT ? R.airT : 0, fadeIn: blend ? CLIMB_TUNE.transitionBlend : CLIMB_TUNE.ease, hold: true, timeScale: 0, keepWeight: blend });
  if (R.flying) {
    rig.setState('air', 0, null, st.hangFade);
    if (R.airT === R.airT) {
      rig.overrideSeekAt = R.airT;
      rig.overrideSeekNow(R.airClip);
    }
  }
  if (R.onRope) {
    const climbing = R.mode === MODE_CLIMB;
    rig.prefer('hangFree', climbing ? ROPE_CLIP_NAMES[ROPE_CLIMB] : ROPE_CLIP_NAMES[ROPE_HANG]);
    // The swing begun, or ended into what follows.
    if (R.mode !== R.lastMode || R.startClip) {
      if (R.mode === MODE_SWING) rig.play(R.swingName, { from: R.poseT === R.poseT ? R.poseT : ROPE_TIMES.swingFrom, fadeIn: CLIMB_TUNE.ease, hold: true, timeScale: 0, keepWeight: blend });
      else if (R.lastMode === MODE_SWING && rig.overrideName === R.swingName) {
        if (blend) rig.blendOut(CLIMB_TUNE.ease);
        else rig.stopOverride(CLIMB_TUNE.ease);
      }
    }
    // The loop (the hang's or the climb's) held (its rate nought) and put at the time the rope has it at, so its pose and the
    // figure's placement are one.
    st.ladderRate.rate = 0;
    st.ladderRate.fade = CLIMB_TUNE.ease;
    rig.setState('hangFree', 0, null, st.ladderRate);
    if (R.loopT === R.loopT) {
      rig.timeAt = R.loopT;
      rig.setTimeNow(climbing ? ROPE_CLIP_NAMES[ROPE_CLIMB] : ROPE_CLIP_NAMES[ROPE_HANG]);
    }
    if (R.mode === MODE_SWING && R.poseT === R.poseT) {
      rig.overrideSeekAt = R.poseT;
      rig.overrideSeekNow(R.swingName);
    }
  }
  rig.update(dt);
}

/**
 * Phase 4: off the rope (the player's `ledgeClocks`, every frame of the movement, before the rope's own `tick`): a rope let go of
 * by a path that never ran the rope's frame (stood elsewhere, off the feet) still has its clips on the rig, which are let go of
 * here as the let-go's own frame would (the rope's preference, and its swing while that is the one playing; nothing otherwise).
 */
export function releaseRopeClip(rig: CharacterRig | null, R: RopeSwing): void {
  if (!R.ended || !rig) return;
  rig.prefer('hangFree', null);
  // (Maker B: and the flight's or the landing's clip, as the swing's.)
  if (rig.overrideName !== R.swingName && rig.overrideName !== R.airClip) return;
  if (CLIMB_TUNE.transitions === 'blend') rig.blendOut(CLIMB_TUNE.transitionBlend);
  else rig.stopOverride(CLIMB_TUNE.ease);
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
