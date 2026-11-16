// The appearance page's Walk row (the animations' second wave): the character's gait, chosen among the walk class's clips
// at one speed (`GAITS` in src/anim/locoTable.ts), on the creator's page and in play alike. The client has no word for it,
// so the row's words are ours. A pick plays that gait's walk in place on the page's doll for a few seconds: the doll is
// a clone already drawn (its programs built behind whatever prepared the figure), so a clip on its own skeleton builds
// nothing, and the clip is the fitted one every rig of the figure's skeleton shares, which carries no travel.
//
// Pure of the page: the row is a string and the walk a little player over a host with a per-frame hook, so the node
// test drives both.
import * as THREE from 'three';
import { GAITS, type LocoGait } from '../anim/locoTable.ts';

/** Each gait under words of ours, in `GAITS`' order. */
export const GAIT_LABELS: Readonly<Record<LocoGait, string>> = {
  standard: 'Standard',
  masculine: 'Masculine',
  feminine: 'Feminine',
  heavy: 'Heavy',
  game: "The game's own",
};

/** How long a pick's walk plays on the doll, seconds: long enough for two or three strides of any gait. */
export const GAIT_WALK_SECONDS = 4;

/** The Walk row: a section heading and one choice, the gait in force selected. */
export function gaitRowHtml(now: string): string {
  const options = GAITS.map((g) => `<option value="${g}"${g === now ? ' selected' : ''}>${GAIT_LABELS[g]}</option>`).join('');
  return `<h3 class="wardrobe-section">Walk <span>how the character walks: the walk's clip, at the walk's own speed</span></h3><label class="wardrobe-slot shape"><span class="slot-label">Walk</span><select class="gait">${options}</select></label>`;
}

/** The little of a preview the walk plays through: its per-frame hook, handed the model it draws. */
export interface WalkHost {
  onFrame: ((dt: number, model: THREE.Object3D) => void) | null;
}

/**
 * A gait's walk on a doll for `GAIT_WALK_SECONDS`: a mixer on whatever model the preview draws (bound afresh when the
 * preview takes a new copy of the figure), let go once the time is up, and `done` asked then (the page takes a fresh
 * copy, so the doll stands as the figure does again).
 */
export class GaitWalk {
  private readonly host: WalkHost;
  private mixer: THREE.AnimationMixer | null = null;
  private root: THREE.Object3D | null = null;
  private clip: THREE.AnimationClip | null = null;
  private left = 0.5;
  private done: (() => void) | null = null;
  /** The clip's name while it plays, for the console. */
  playing: string | null = null;

  constructor(host: WalkHost) {
    this.host = host;
    this.left = 0;
  }

  start(clip: THREE.AnimationClip, done: (() => void) | null = null, seconds = GAIT_WALK_SECONDS): void {
    this.stop(false);
    this.clip = clip;
    this.left = seconds;
    this.done = done;
    this.playing = clip.name;
    this.host.onFrame = (dt, model) => this.frame(dt, model);
  }

  private frame(dt: number, model: THREE.Object3D): void {
    if (!this.clip) return;
    if (this.root !== model || !this.mixer) {
      this.mixer?.stopAllAction();
      this.mixer = new THREE.AnimationMixer(model);
      this.root = model;
      this.mixer.clipAction(this.clip).play();
    }
    this.mixer.update(dt);
    this.left -= dt;
    if (this.left <= 0) this.stop(true);
  }

  /** Let the walk go; `finished` asks the page's `done` (the doll stood again). */
  stop(finished: boolean): void {
    const done = this.done;
    if (this.host.onFrame && this.clip) this.host.onFrame = null;
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.root = null;
    this.clip = null;
    this.done = null;
    this.playing = null;
    if (finished) done?.();
  }
}
