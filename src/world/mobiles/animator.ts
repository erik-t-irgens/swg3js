// A mobile's clips, played by role: one looping base cross-faded by hand, one one-shot over it
// (an attack, a hit, a death), and additive pulses on top (the game's one-frame blaster recoils).
//
// Every weight is set by hand every frame rather than by three's own fades: a fade that finishes
// disables its action (the next use shows the bind pose until reset), and two actions both at
// weight 1 are averaged by the property mixer, which is how a hit ends up half blended with the
// loop. An action is only stopped once its weight has reached zero, so nothing is ever disabled
// behind this code's back, and a gait started again keeps its phase.
import * as THREE from 'three';
import { blendWeight, clampFades, oneShotWeight } from './gait';

/** One-shot priorities: a lower one is refused while a higher one plays. */
export const SHOT_PRIORITY = { emote: 0, hit: 1, attack: 2, down: 3 } as const;

export interface OnceOptions {
  fadeIn?: number;
  fadeOut?: number;
  /** Stay on the last frame when it ends (a death, a knockdown), until something else plays. */
  hold?: boolean;
  timeScale?: number;
  priority?: number;
  /** Called once as it ends (for a held clip, as its last frame is reached). */
  onEnd?: () => void;
}

interface Pulse {
  action: THREE.AnimationAction;
  left: number;
  fade: number;
}

export class MobileAnimator {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private from: THREE.AnimationAction | null = null;
  private to: THREE.AnimationAction | null = null;
  private blendTime = 0;
  private fade = 0;
  private shotAction: THREE.AnimationAction | null = null;
  private shotName: string | null = null;
  private shotTime = 0;
  private shotDuration = 0;
  private shotTimeScale = 1;
  private fadeIn = 0;
  private fadeOut = 0;
  private hold = false;
  private shotPriority = 0;
  private shotEnd: (() => void) | null = null;
  private shotEnded = false;
  /** Bumped by `reset`: a `finished` from before it belongs to a clip nobody is waiting on. */
  private epoch = 0;
  private shotEpoch = -1;
  private readonly pulses: Pulse[] = [];
  private readonly onFinished = (e: { action: THREE.AnimationAction }): void => {
    if (e.action !== this.shotAction || this.shotEpoch !== this.epoch) return;
    this.endShot();
  };

  constructor(
    private readonly root: THREE.Object3D,
    private readonly clips: ReadonlyMap<string, THREE.AnimationClip>,
    private readonly additive: ReadonlySet<string>,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    // One listener for the life of the animator, removed in dispose.
    this.mixer.addEventListener('finished', this.onFinished as unknown as (e: THREE.Event) => void);
  }

  has(clip: string | null | undefined): boolean {
    return !!clip && this.clips.has(clip);
  }

  /** The clip's action, made once. Additive clips blend additively. */
  private action(name: string | null | undefined): THREE.AnimationAction | null {
    if (!name) return null;
    let a = this.actions.get(name);
    if (a) return a;
    const clip = this.clips.get(name);
    if (!clip) return null;
    a = this.mixer.clipAction(clip, undefined, this.additive.has(name) || clip.blendMode === THREE.AdditiveAnimationBlendMode ? THREE.AdditiveAnimationBlendMode : THREE.NormalAnimationBlendMode);
    a.clampWhenFinished = true;
    this.actions.set(name, a);
    return a;
  }

  /** How long a clip lasts, or 0. */
  duration(name: string | null | undefined): number {
    return (name && this.clips.get(name)?.duration) || 0;
  }

  /** The clip under everything; a change cross-fades over `fade` seconds. */
  loop(clip: string | null, timeScale = 1, fade = 0.25): void {
    const a = this.action(clip);
    if (!a) return;
    a.timeScale = timeScale;
    if (a === this.to) return;
    if (a === this.from) {
      // Going back to what it was fading out of: swap, and carry on from where the blend stood.
      this.from = this.to;
      this.to = a;
      this.blendTime = Math.max(0, this.fade - this.blendTime);
      return;
    }
    if (this.from && this.from !== this.to) this.from.stop();
    this.from = this.to;
    this.to = a;
    if (!a.isRunning()) {
      a.reset();
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.setEffectiveWeight(0);
      a.play();
    }
    this.fade = this.from ? fade : 0;
    this.blendTime = 0;
  }

  /** Play once over the loop. Returns its length, or null when the pack lacks it or something weightier plays. */
  once(clip: string | null | undefined, opts: OnceOptions = {}): number | null {
    const a = this.action(clip);
    if (!a || !clip) return null;
    const priority = opts.priority ?? SHOT_PRIORITY.attack;
    if (this.busy && this.shotPriority > priority) return null;
    if (this.shotAction && this.shotAction !== a) this.shotAction.stop();
    const duration = a.getClip().duration;
    const ts = opts.timeScale ?? 1;
    const fades = clampFades(duration, opts.fadeIn ?? 0.12, opts.fadeOut ?? 0.2);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = ts;
    a.setEffectiveWeight(0);
    a.play();
    this.shotAction = a;
    this.shotName = clip;
    this.shotTime = 0;
    this.shotDuration = duration;
    this.shotTimeScale = ts;
    this.fadeIn = fades.fadeIn;
    this.fadeOut = fades.fadeOut;
    this.hold = !!opts.hold;
    this.shotPriority = priority;
    this.shotEnd = opts.onEnd ?? null;
    this.shotEnded = false;
    this.shotEpoch = this.epoch;
    return duration / Math.max(1e-3, ts);
  }

  /** An additive pose over everything, held for `hold` seconds and faded over `fade`. */
  pulse(clip: string | null | undefined, hold = 0.08, fade = 0.15): void {
    const a = this.action(clip);
    if (!a) return;
    const existing = this.pulses.find((p) => p.action === a);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.setEffectiveWeight(1);
    a.play();
    if (existing) {
      existing.left = hold;
      existing.fade = fade;
    } else this.pulses.push({ action: a, left: hold, fade });
  }

  /** A one-shot is playing (a held one counts until something replaces it). */
  get busy(): boolean {
    return !!this.shotAction && (this.hold || !this.shotEnded);
  }

  /** The priority of the one-shot now playing, or -1. */
  get shotLevel(): number {
    return this.busy ? this.shotPriority : -1;
  }

  get base(): string | null {
    return this.to?.getClip().name ?? null;
  }

  get shot(): string | null {
    return this.shotAction ? this.shotName : null;
  }

  /** Let the one-shot go, fading back to the loop over `fade`. */
  stopShot(fade = 0.2): void {
    if (!this.shotAction) return;
    this.hold = false;
    this.shotEnded = true;
    this.shotEnd = null;
    this.fadeOut = fade;
    this.shotDuration = this.shotTime + fade;
  }

  private endShot(): void {
    if (this.shotEnded) return;
    this.shotEnded = true;
    const cb = this.shotEnd;
    this.shotEnd = null;
    cb?.();
  }

  update(dt: number): void {
    this.blendTime += dt;
    const blend = this.fade > 0 ? blendWeight(this.blendTime, this.fade) : 1;
    // The one-shot's weight comes from a clock of its own, advanced before the mixer: the
    // action's time is what the last update left, which would put a zero on the clip's first frame.
    if (this.shotAction) this.shotTime += dt * this.shotTimeScale;
    const shot = this.shotAction ? oneShotWeight(this.shotTime, this.shotDuration, this.fadeIn, this.fadeOut, this.hold) : 0;
    const under = 1 - shot;
    if (this.from && this.from !== this.to) this.from.setEffectiveWeight(under * (1 - blend));
    if (this.to) this.to.setEffectiveWeight(under * (this.from && this.from !== this.to ? blend : 1));
    if (this.shotAction) this.shotAction.setEffectiveWeight(shot);
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.left -= dt;
      p.action.setEffectiveWeight(p.left > 0 ? 1 : Math.max(0, 1 + p.left / Math.max(1e-3, p.fade)));
      if (p.left < -p.fade) {
        p.action.stop();
        this.pulses.splice(i, 1);
      }
    }
    this.mixer.update(dt);
    if (blend >= 1 && this.from && this.from !== this.to) {
      this.from.stop();
      this.from = null;
    }
    // A shot that has run its length (or been let go) and faded out is stopped, never disabled by three.
    if (this.shotAction && !this.hold && this.shotTime >= this.shotDuration) {
      this.endShot();
      this.shotAction.stop();
      this.shotAction = null;
      this.shotName = null;
    }
  }

  /** Everything stopped, nothing pending: a fresh start (a respawn). A `finished` from before is ignored. */
  reset(): void {
    this.epoch++;
    this.mixer.stopAllAction();
    this.from = null;
    this.to = null;
    this.shotAction = null;
    this.shotName = null;
    this.shotEnd = null;
    this.shotEnded = true;
    this.hold = false;
    this.pulses.length = 0;
    this.blendTime = 0;
    this.fade = 0;
  }

  dispose(): void {
    this.mixer.removeEventListener('finished', this.onFinished as unknown as (e: THREE.Event) => void);
    this.reset();
    this.mixer.uncacheRoot(this.root);
    this.actions.clear();
  }
}
