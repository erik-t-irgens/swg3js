// What a body remembers from frame to frame for the imported clips' rules (animRules.ts), and the hand-over of each
// rule's answer to the rig: what the air has been since the feet left the ground, whether the body was thrown from a
// wreck, the landing the movement step reports put into the rules' own terms, how long an imported landing has
// played before the keys cut it, and the thrown fall's impact with the hold on the keys it brings.
//
// The player's update calls one method here at each of those moments and does nothing else about them, so the node
// test drives this very class over stand-in events and a rig that records what it is asked (animBody.test.ts), and
// over the game's own CharacterRig (animRig.test.ts). A rig without the imported clips answers "as before" to
// everything, and the caller then plays what it always played by its own rule.
//
// Pure: no three.js and nothing of the page. Nothing here makes an object on a frame: a landing, a jump and an impact
// make one each, as events.

import { NO_LANDING, airLoop, impact, impactHold, jumpStart, landing, landingSpeed, landingYields, type Landing } from './animRules.ts';
import type { AnimTune } from './animTune.ts';

/** The little of a rig this asks for: the game's `CharacterRig` is one. */
export interface AnimRig {
  has(clip: string): boolean;
  /** Play a one-off over the state's clips, from `from` seconds in; what is left of it to play, or null without the clip. */
  play(clip: string, options?: { fadeIn?: number; from?: number }): number | null;
  /** End a whole-body one-off early, into the clip of the state as it stands now. */
  yieldOverride(fade?: number): void;
  /** The one-off playing, by name, or null. */
  readonly overrideName: string | null;
}

/**
 * What became of a landing the movement step reported:
 *  - `imported`: one of the imported landings is playing;
 *  - `none`: too gentle for any clip, and none plays;
 *  - `before`: the game's own landing, by the rule it always had (the caller's);
 *  - `impact`: the thrown fall's own landing, which the impact already has: nothing more plays.
 */
export type LandingPlayed = 'imported' | 'none' | 'before' | 'impact';

export class BodyAnim {
  private readonly tune: AnimTune;
  /** Metres in one of the movement step's units (a landing's speed is reported in those). */
  private readonly unit: number;
  /** The rig the rules are asked about just now, for `has` below: set at every call that asks. */
  private rig: AnimRig | null = null;
  /** `rig.has`, kept, so a frame makes no closure. */
  private readonly has = (clip: string): boolean => this.rig?.has(clip) ?? false;
  /** A flip, a Force jump or a wall move began since the feet last left the ground: the air is a Force user's until they touch down. */
  private force = false;
  /** Thrown from a wreck, and not yet down. */
  private thrown = false;
  /** Seconds left of the impact's hold on the keys. (Declared as a fraction: it is counted down by a frame's step.) */
  private impactLeft = 0.5;
  /** The impact is playing for a landing the movement step has yet to report (it reports a frame on): that landing is the impact's. */
  private impactOwed = false;
  /**
   * The movement has not been stepped in the air since the body swam, or was stood somewhere: what it next reports
   * as a landing is the plunge's, or the last place's, and no fall onto this ground.
   */
  private noFall = false;
  /** The imported landing playing, and for how long. */
  private landClip: string | null = null;
  private landFor = 0.5;
  /** The landing in the rules' terms; one kept record. */
  private readonly rec: Landing = { speed: 0.5, harm: 0, force: false, rolled: false, jka: false };

  constructor(tune: AnimTune, unit: number) {
    this.tune = tune;
    this.unit = unit;
    this.impactLeft = 0;
    this.landFor = 0;
    this.rec.speed = 0;
  }

  /** Whether the thrown fall's impact still holds the keys: the game mutes them before anything reads one. */
  get impactLocked(): boolean {
    return this.impactLeft > 0;
  }

  /** Thrown from a wreck and still in the air. */
  get flung(): boolean {
    return this.thrown;
  }

  /** Whether the air is a Force user's (a flip, a Force jump or a wall move since the feet left the ground). */
  get forceAir(): boolean {
    return this.force;
  }

  /** An imported landing is playing and may yet be cut. */
  get landing(): string | null {
    return this.landClip;
  }

  /** The start of the body's update: the impact's hold runs down (it stands still under a panel, as the body does). */
  tick(dt: number): void {
    if (this.impactLeft > 0) this.impactLeft = Math.max(0, this.impactLeft - dt);
  }

  /**
   * The body was stood somewhere new, reset or mounted: everything held is let go. The thrown fall goes with it: left
   * standing, a rider killed by the blast that threw them, or wrecked adrift in space, played the impact and had the
   * keys held wherever they next came to ground (the respawn, the next world).
   */
  drop(): void {
    this.force = false;
    this.thrown = false;
    this.impactLeft = 0;
    this.impactOwed = false;
    this.landClip = null;
    this.noFall = true;
  }

  /** Thrown from a wreck: the long fall until the ground. */
  fling(): void {
    this.thrown = true;
    this.impactOwed = false;
  }

  /**
   * Swimming this frame. Water ends a thrown fall (left standing, the swimmer hit the ground as thrown the moment
   * they waded out, and would play the impact on the shore with the keys held) and a Force user's air; and the swim
   * never steps the movement, which still remembers the plunge, so what it reports on the first step out is no landing.
   */
  swim(): void {
    this.thrown = false;
    this.force = false;
    this.impactOwed = false;
    this.noFall = true;
  }

  /** A flip, a Force jump or a wall move has begun (or the body was launched as one). */
  forceMove(): void {
    this.force = true;
  }

  /** The movement was stepped this frame, in the air or on the ground: a step in the air is a fall begun here. */
  stepped(grounded: boolean): void {
    if (!grounded) this.noFall = false;
  }

  /** On the ground under a movement that reports no landings: the air's memory is simply put down. */
  onGround(): void {
    this.force = false;
    this.impactOwed = false;
  }

  /**
   * A jump has begun. True when its start is the imported one, which is then playing; false leaves the caller the
   * jump it always played (Jedi Academy's animations in charge, or a rig without the clip).
   */
  jump(rig: AnimRig | null, jka: boolean): boolean {
    this.rig = rig;
    const up = rig ? jumpStart(this.has, jka, this.tune) : null;
    if (!up || !rig) return false;
    rig.play(up.clip, { fadeIn: up.fade, from: up.from });
    return true;
  }

  /**
   * The loop in the air, or null for the caller's own: thrown, the long fall (null without it: the caller's old flail);
   * after a flip, a Force jump or a wall move, the float; else the falling loop; and Jedi Academy's own in-air pose
   * with its animations in charge (`jka`) or on a rig without the clip.
   */
  air(rig: AnimRig | null, jka: boolean): string | null {
    this.rig = rig;
    return airLoop(this.has, this.thrown, this.force, jka);
  }

  /**
   * The movement step reported a landing: `delta` its own measure of how fast (a speed squared), `harm` the fall's
   * damage, `forceLanded` its word for a Force jump's landing, `rolled` a landing roll, `jka` Jedi Academy's animations
   * in charge (a swing under way, the block held). Plays the imported landing where the rules name one, and answers
   * what became of it; the air's memory is put down either way, after the rule has read it.
   */
  land(rig: AnimRig | null, delta: number, harm: number, forceLanded: boolean, rolled: boolean, jka: boolean): LandingPlayed {
    this.rig = rig;
    const force = this.force;
    this.force = false;
    if (this.impactOwed) {
      // The thrown fall's own landing, reported a frame after the impact began: the impact keeps the body, however
      // long it holds the keys.
      this.impactOwed = false;
      this.noFall = false;
      return 'impact';
    }
    if (this.noFall) {
      this.noFall = false;
      return 'before';
    }
    if (!rig) return 'before';
    const l = this.rec;
    l.speed = landingSpeed(delta, this.unit);
    l.harm = harm;
    // The step's own word for a Force jump's landing also says "it harmed"; the air's own memory tells the two apart.
    l.force = force || (forceLanded && harm <= 0);
    l.rolled = rolled;
    l.jka = jka;
    const answer = landing(this.has, l, this.tune);
    if (answer === null) return 'before';
    if (answer === NO_LANDING) return 'none';
    rig.play(answer.clip, { fadeIn: answer.fade, from: answer.from });
    this.landClip = answer.clip;
    this.landFor = 0;
    return 'imported';
  }

  /**
   * Every frame the movement is stepped: an imported landing gives way to the keys once it has shown its start
   * (`land.moveCut`), into the clip of the state as it stands now. No clip moves the body, so one held to its end
   * under a body already running would slide its feet for as long as it had left. Forgotten the moment anything else
   * has the body.
   */
  cut(rig: AnimRig | null, dt: number, moving: boolean): void {
    if (this.landClip === null) return;
    if (!rig || rig.overrideName !== this.landClip) {
      this.landClip = null;
      return;
    }
    this.landFor += dt;
    if (landingYields(this.landFor, moving, this.tune)) {
      rig.yieldOverride(this.tune.land.moveFade);
      this.landClip = null;
    }
  }

  /**
   * The thrown fall has met the ground: the impact from its trim, and the keys held for the tune's share of what is
   * left of it to play. Without the clip nothing plays and nothing is held: the body lies down at once, as before.
   */
  hitGround(rig: AnimRig | null): void {
    this.rig = rig;
    this.thrown = false;
    this.force = false;
    this.landClip = null;
    const hit = rig ? impact(this.has, this.tune) : null;
    const plays = hit && rig ? rig.play(hit.clip, { fadeIn: hit.fade, from: hit.from }) : null;
    this.impactLeft = plays !== null ? impactHold(plays, this.tune) : 0;
    this.impactOwed = plays !== null;
  }
}
