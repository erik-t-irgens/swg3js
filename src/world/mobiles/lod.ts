// How much of a mobile's life is lived each frame: how often its mixer runs, whether it is drawn
// and throws a shadow, how often it thinks, and whether it moves at all. A pure function of the
// distance, the screen and the size, so the node tests can walk every tier.
//
// Rule for this file (it is run by node with type stripping): relative imports only as
// `import type`, no enum, no namespace, no constructor parameter properties.
import type { SizeClass } from './types';

export interface LodTune {
  /** Within this of the camera and on screen, everything every frame. */
  near: number;
  /** Within this and on screen, the mixer every second frame. */
  mid: number;
  /** The default of the live animation-range setting (the manager's `animRange` is what counts). */
  animRange: number;
  /** Past this and frozen, it stops moving and its body sleeps. */
  sleep: number;
  /** Metres the cull sphere grows by for the shadow test, so a body just off screen still throws its shadow in. */
  shadowSlack: number;
  /** Ragdolls started per frame at most (the rest hold their death pose meanwhile). */
  ragdollsPerFrame: number;
  /** How far each size class throws a shadow. */
  shadow: Record<SizeClass, number>;
  /** Seconds between thoughts: near, the rest, frozen. */
  think: [number, number, number];
  /** Within this of the player a mid-tier mobile still thinks at the near rate. */
  thinkNear: number;
}

export const LOD_TUNE: LodTune = {
  near: 35,
  mid: 90,
  animRange: 160,
  sleep: 220,
  shadowSlack: 8,
  ragdollsPerFrame: 2,
  shadow: { tiny: 0, small: 45, medium: 110, large: 260, huge: 1e9 },
  think: [0.1, 0.4, 1.5],
  thinkNear: 60,
};

export type LodName = 'near' | 'mid' | 'far' | 'hidden' | 'frozen';

export interface LodTier {
  name: LodName;
  /** The mixer runs every this many frames; 0 is not at all (the pose holds). */
  animEvery: number;
  /** Whether it is drawn: the whole cull (`group.visible`). */
  visible: boolean;
  castShadow: boolean;
  /** Seconds between thoughts. */
  think: number;
  /** False once it is frozen and past `sleep`: it stops and its body sleeps. */
  move: boolean;
}

export interface LodInput {
  /** Camera to the mobile. */
  dist: number;
  /** Its world sphere against the camera frustum. */
  onScreen: boolean;
  /** The same sphere grown by `shadowSlack`. */
  nearScreen: boolean;
  /** A one-shot, dying or attacking: never worse than every second frame. */
  busy: boolean;
  sizeClass: SizeClass;
  /** The shadow setting is on at all. */
  shadows: boolean;
  playerDist: number;
  /** The live setting, not `tune.animRange`. */
  animRange: number;
  /**
   * The rooms it counts in as the portal renderer's last frame saw them (commit 2c, `ActorRoutes.levelOf`):
   * 0 none seen, 1 one seen, 2 none seen but one is one room past a seen one, -1 (or absent) left to the
   * frustum. Unseen is off screen whatever the frustum says, and throws no shadow; one room past a seen one
   * is the hidden tier and never frozen.
   */
  room?: number;
}

/**
 * The tier: near (on screen within `near`), mid (on screen within `mid`), far (on screen within
 * the animation range), hidden (off screen or past the range: its mixer every eighth frame, every
 * fourth while it still casts), frozen (off screen and throwing no shadow: no mixer at all). A busy
 * mobile is never worse than every second frame and is never frozen. With `out`, that object is
 * filled and returned (the manager keeps one per mobile rather than making one a frame).
 */
export function lodTier(i: LodInput, tune: LodTune = LOD_TUNE, out?: LodTier): LodTier {
  // A room nobody could see last frame, or one just past a seen one, is off the screen and out of the
  // shadows whatever the frustum says: the walls are in the way, and no room is lit by the sun.
  const room = i.room ?? -1;
  const walled = room === 0 || room === 2;
  const onScreen = i.onScreen && !walled;
  const nearScreen = i.nearScreen && !walled;
  const castShadow = i.shadows && nearScreen && i.dist < (tune.shadow[i.sizeClass] ?? 0);
  // Whether it is drawn is still the frustum's alone: the room's say is last frame's, and the portal
  // renderer's routing hides what this frame cannot see (`portalCull.ts`), so a room coming round a
  // corner never shows its people a frame late.
  const visible = i.nearScreen || i.dist < tune.near;
  let name: LodName;
  let animEvery: number;
  let think: number;
  if (onScreen && i.dist < tune.near) {
    name = 'near';
    animEvery = 1;
    think = tune.think[0];
  } else if (onScreen && i.dist < tune.mid) {
    name = 'mid';
    animEvery = 2;
    think = i.playerDist < tune.thinkNear ? tune.think[0] : tune.think[1];
  } else if (onScreen && i.dist < i.animRange) {
    name = 'far';
    animEvery = 4;
    think = tune.think[1];
  } else if (!onScreen && !castShadow && !i.busy && room !== 2) {
    name = 'frozen';
    animEvery = 0;
    think = tune.think[2];
  } else {
    name = 'hidden';
    animEvery = castShadow ? 4 : 8;
    think = tune.think[1];
  }
  if (i.busy && (animEvery === 0 || animEvery > 2)) animEvery = 2;
  const move = !(name === 'frozen' && i.dist > tune.sleep && i.playerDist > tune.sleep);
  if (!out) return { name, animEvery, visible, castShadow, think, move };
  out.name = name;
  out.animEvery = animEvery;
  out.visible = visible;
  out.castShadow = castShadow;
  out.think = think;
  out.move = move;
  return out;
}
