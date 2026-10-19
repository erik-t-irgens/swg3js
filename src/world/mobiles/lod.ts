// How much of a mobile's life is lived each frame: how often its mixer runs, whether it is drawn
// and throws a shadow, how often it thinks, and whether it moves at all. A pure function of the
// distance, the screen and the size, so the node tests can walk every tier.
//
// The performance pass's third wave adds three things, each of which leaves today's tier exactly as
// it was until it is asked for (`crowd.test.ts` holds that against this file as it stood at the pass's
// base): a body engaged in a fight on screen is never below the mid tier and never undrawn; a body
// this browser keeps for a server thinks no slower than `CROWD_TUNE.sharedThink`; and the client's two
// last tiers by screen share, both off until the owner turns them on (`holdShare`, `goneShare`).
//
// Rule for this file (it is run by node with type stripping): relative type imports as `import type`,
// a value import with its `.ts`, no enum, no namespace, no constructor parameter properties.
import type { SizeClass } from './types';
import { CROWD_TUNE, type CrowdLod } from './crowd.ts';

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
  /**
   * Whether a body whose sphere reaches none of the shadow cascades' light boxes throws no shadow
   * (`LodInput.inCascades`, commit 3c): three would draw it into no shadow map anyway, and it is then
   * free to freeze. False is the old rule, the size class's reach alone.
   */
  shadowClamp: boolean;
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
  shadowClamp: true,
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
   * Whether its sphere, grown by `shadowSlack`, reaches any of the shadow cascades' light boxes
   * (`reachesCascades`, from the boxes the cascades last stood in): a caster outside all of them is drawn
   * into no shadow map. The boxes and not a distance from the camera, because the cascades' reach is a
   * depth along the view -- a body at the side of the screen stands farther off than that depth while
   * inside the last cascade -- and because a box reaches past the view toward the sun, so a body beyond
   * the last cascade can still throw its shadow back into it. Absent, no limit.
   */
  inCascades?: boolean;
  /**
   * The rooms it counts in as the portal renderer's last frame saw them (commit 2c, `ActorRoutes.levelOf`):
   * 0 none seen, 1 one seen, 2 none seen but one is one room past a seen one, -1 (or absent) left to the
   * frustum. Unseen is off screen whatever the frustum says, and throws no shadow; one room past a seen one
   * is the hidden tier and never frozen.
   */
  room?: number;
  /**
   * The share of the screen's height it covers (`screenShare` in crowd.ts), read from the live camera so
   * aiming's zoom counts. Absent, it is taken to fill the screen and nothing is thinned by it.
   */
  share?: number;
  /** In a fight or lately in one (`Mobile.engaged`): on screen it is never below the mid tier and never undrawn. */
  engaged?: boolean;
  /** Kept by this browser for a server (`Mobile.keptForServer`): it thinks no slower than `sharedThink`. */
  shared?: boolean;
  /**
   * Its root has stayed within `holdStill` of one place for `holdAfter` seconds (`crowdInput`, judged over
   * time, since the physics moves a body only on whole sixtieths): only such a body may hold its pose under
   * `holdShare`, since a held pose on a moving root slides its feet.
   */
  still?: boolean;
}

/**
 * The tier: near (on screen within `near`), mid (on screen within `mid`), far (on screen within
 * the animation range), hidden (off screen or past the range: its mixer every eighth frame, every
 * fourth while it still casts), frozen (off screen and throwing no shadow: no mixer at all). A busy
 * mobile is never worse than every second frame and is never frozen. With `out`, that object is
 * filled and returned (the manager keeps one per mobile rather than making one a frame).
 *
 * Then the crowd's say (`crowd`, `CROWD_TUNE` unless handed another): an engaged body on screen is
 * lifted to the mid tier where the distance put it lower, and is never left undrawn; a body neither
 * engaged nor busy that covers less than `goneShare` of the screen is not drawn and throws no shadow;
 * one standing still under `holdShare` holds its pose (its mixer at nought, the clip's time kept by the
 * mobile's own accumulator); and a body kept for a server thinks at least every `sharedThink` seconds.
 * The names stay the distance's, so the console's counts by tier read as they always did.
 */
export function lodTier(i: LodInput, tune: LodTune = LOD_TUNE, out?: LodTier, crowd: CrowdLod = CROWD_TUNE): LodTier {
  // A room nobody could see last frame, or one just past a seen one, is off the screen and out of the
  // shadows whatever the frustum says: the walls are in the way, and no room is lit by the sun.
  const room = i.room ?? -1;
  const walled = room === 0 || room === 2;
  const onScreen = i.onScreen && !walled;
  const nearScreen = i.nearScreen && !walled;
  // A size class's reach, and never for a body in none of the cascades' light boxes: three would draw it
  // into no shadow map, so no shadow of it lands anywhere drawn.
  const outOfCascades = tune.shadowClamp && i.inCascades === false;
  let castShadow = i.shadows && nearScreen && i.dist < (tune.shadow[i.sizeClass] ?? 0) && !outOfCascades;
  // Whether it is drawn is still the frustum's alone: the room's say is last frame's, and the portal
  // renderer's routing hides what this frame cannot see (`portalCull.ts`), so a room coming round a
  // corner never shows its people a frame late.
  let visible = i.nearScreen || i.dist < tune.near;
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
  // The crowd's say, each part of it a no-op until it is asked for: no input set and both shares at nought
  // leave every number above exactly as it was.
  const engaged = i.engaged === true;
  if (engaged && onScreen && (name === 'far' || name === 'hidden')) {
    name = 'mid';
    if (animEvery === 0 || animEvery > 2) animEvery = 2;
    think = Math.min(think, i.playerDist < tune.thinkNear ? tune.think[0] : tune.think[1]);
  }
  if (!engaged && !i.busy) {
    const share = i.share ?? Number.POSITIVE_INFINITY;
    if (share < crowd.goneShare) {
      visible = false;
      castShadow = false;
    }
    if (i.still === true && share < crowd.holdShare) animEvery = 0;
  }
  // `Math.min` and never a conditional write: a number read off the tune and written into `think` on one branch only
  // was boxed on every call (16 bytes a body a frame, measured in node), the engine keeping `think` tagged across the
  // branches; the minimum keeps it a plain double.
  if (i.shared === true) think = Math.min(think, crowd.sharedThink);
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
