// The motion blur's arithmetic, kept apart from three so a plain node test can hold the shaders to it.
//
// The blur merges two velocities per pixel. Everything still takes the camera's reprojection of the
// scene depth, with a near cut pushed out past the far side of whatever the camera follows. Things
// that move on their own (the movers the game lists) draw a velocity picture of their own, and only
// for the meshes whose motion differs from what the reprojection would give. The functions below are
// the decisions and the formulas: which movers draw, how the relay's messages become a speed, the
// velocity each mover pixel stores, and the weights the reconstruction filter gathers with. The GLSL
// in velocity.ts and motionBlur.ts mirrors them line for line; `tools/swg/tests/velocity.test.ts`
// checks these.
//
// Nothing here imports anything but the morph ladder (`personKeys.ts`, pure), which the warm list is made from.

import { warmLadder } from '../../world/personKeys.ts';

/**
 * A step of the camera's that must not read as motion: last frame's view is moved by it before the
 * reprojection, so a world that stands still reprojects onto itself and only turning smears.
 *
 * It is set by the one thing that carries the camera faster than the blur can mean anything -- an
 * ultra-fast cruise, kilometres a frame, where every pixel's velocity would run clean off the screen
 * and the picture would be a wash rather than a sense of speed. Everything else leaves it at zero.
 * It is module state because there is one camera, and whatever sets it clears it again when it is
 * done. `velocity.ts` turns these three numbers into the matrix it multiplies by.
 */
const carry = { x: 0, y: 0, z: 0, on: false };

/** Move last frame's view by this world-space step before the reprojection; (0, 0, 0) turns it off. */
export function setReprojectionCarry(x: number, y: number, z: number): void {
  carry.x = x;
  carry.y = y;
  carry.z = z;
  carry.on = x !== 0 || y !== 0 || z !== 0;
}

/** What the reprojection is being moved by now; the record is shared and read-only to callers. */
export function reprojectionCarry(): Readonly<{ x: number; y: number; z: number; on: boolean }> {
  return carry;
}

/** Who a mover is, which decides its jump limit and how it is reported. */
export type FxMoverKind = 'player' | 'ridden' | 'vehicle' | 'creature' | 'npc' | 'remote' | 'remoteVehicle';

/** Why a mover draws nothing this frame. */
export type MoverSkip = 'hidden' | 'culled' | 'fresh' | 'jump' | 'still' | 'small' | 'budget';
/** What a mover draws this frame: nothing (and why), all its meshes, or only its parts that move relative to it. */
export type MoverResult = MoverSkip | 'all' | 'animated';

/** What the classification reads about one mover this frame. */
export interface MoverFacts {
  kind: FxMoverKind;
  /** The camera follows it: the player, and what they ride, fly or stand aboard. */
  carried: boolean;
  /** It, or something above it, is not visible, or it is not in a scene. */
  hidden: boolean;
  /** Its bounding sphere touches the view. */
  inFrustum: boolean;
  /** Its root was recorded last frame and it has been scanned. */
  historyValid: boolean;
  /** Metres its root moved since last frame. */
  moved: number;
  dt: number;
  /** m/s: the game's own velocity where it gives one (a remote peer), else moved / dt. */
  speed: number;
  /** rad/s, roughly: how fast its root turns. */
  turn: number;
  /** Rigid parts whose matrix relative to the root changed since last frame. */
  animated: number;
  screenRadiusPx: number;
  /** What the camera follows is the mask this frame (`masksFollowed`): it draws all of itself. */
  mask?: boolean;
}

export const MOVER_LIMITS = {
  /** Draws of movers the camera does not follow, per frame: 0.18-0.26 ms of CPU at 2.8-4 µs each. */
  maxDraws: 64,
  /** Animated parts of what the camera follows (wings, a held weapon). */
  maxCarriedDraws: 16,
  /** Draws of what the camera follows while its own pixels are the mask (`masksFollowed`): the whole of a raced pod and its rider, at most about 0.35 ms of CPU. A follow that would take more keeps the depth cut that frame. */
  maxMaskDraws: 96,
  /**
   * Under the mask, a glow sprite riding what the camera follows (an engine's) is held sharp with it where its own picture's
   * alpha is at least this: the glow writes no depth, so its pixels are the ground's and would otherwise smear with it. A
   * tenth keeps the glow's disc and leaves its faint rim to the ground.
   */
  glowAlphaTest: 0.1,
  /** A mover smaller on screen than this (radius, pixels) is left to the camera's blur. */
  minScreenRadiusPx: 3,
  /** m/s: slower than this, and turning slower than `stillTurn`, a mover stands. */
  stillSpeed: 0.05,
  /** rad/s */
  stillTurn: 0.02,
  /** More in one frame is a jump for anything. */
  teleportMetres: 60,
  /** m/s: a creature or fighter faster than this jumped (a respawn 35-125 m away). */
  figureJumpSpeed: 50,
  /** m/s: vehicles, ships, and figures that ride them (the player, remote players). */
  machineJumpSpeed: 1500,
  /** A part's matrix relative to its root changed by more than this: it is animated. */
  relTolerance: 1e-5,
  /** Every mover is scanned again this often (frames), staggered. */
  rescanFrames: 30,
  maxScansPerFrame: 4,
  /** A mover not listed for this many frames is forgotten. */
  forgetFrames: 120,
};

/**
 * Where the camera is, for the motion blur's rule about what it follows (`App.placeCamera` decides it a frame):
 * 'race' the race view of a raced pod or bike, 'chase' a flown ship's chase, 'third' any other view from outside
 * the figure (on foot, a mount, a speeder, a passenger's view, Alt looking round a ship), 'other' a view that keeps
 * the depth cut whatever the rule says (first person, the cockpit, the editor's eye, a jump's tunnel, a conversation).
 */
export type FollowView = 'race' | 'chase' | 'third' | 'other';
/** What keeps what the camera follows sharp (`MOTION_TUNING.followRule`). */
export type FollowRule = 'auto' | 'cut' | 'mask';
export const FOLLOW_RULES: readonly FollowRule[] = ['auto', 'cut', 'mask'];

/** The longest tile the tile max can take (its loop's bound): the race view's cap is held under it. */
export const MAX_TILE_K = 128;

export const MOTION_TUNING = {
  /** View depth (m) where the camera's own movement starts to smear, and where it smears fully, before the push past what the camera follows. */
  nearCut: [25, 60] as [number, number],
  /** The longest smear either side of a pixel, as a share of the drawing buffer's height. */
  radiusOfHeight: 0.025,
  /** Taps in the gather. */
  samples: 12,
  /** The blur is scaled as if every frame lasted this long. */
  shutter: 1 / 60,
  /**
   * What keeps what the camera follows sharp. 'auto': its own pixels in the race view and a flown ship's chase (the
   * velocity product draws the whole of what is followed and the reprojection leaves those pixels out, so the ground and
   * the walls right beside the hull, the fastest things on the screen, smear), the depth cut in every other view, which
   * is what the owner already plays on foot. 'cut': the depth cut everywhere, as before. 'mask': the mask in every view
   * from outside the figure. First person and the cockpit keep the cut whatever this says.
   */
  followRule: 'auto' as FollowRule,
  /**
   * Under the mask, the view depth (m) where the camera's own movement starts to smear and where it smears fully: nothing
   * is pushed past what the camera follows. A third of a metre keeps a leaf brushing the lens from smearing across the screen.
   */
  maskCut: [0.3, 1] as [number, number],
  /**
   * The race view's longest smear either side, as a share of the drawing buffer's height (the rest of the game's is
   * `radiusOfHeight`): nearly three times it to start, so the near ground streaks at racing speed where it stopped at a
   * stub. Held to 8..`MAX_TILE_K` px; the tile max costs the same whatever its tile.
   */
  raceRadiusOfHeight: 0.07,
  /** Taps in the race view's gather: four more than the rest's, so a streak nearly three times as long stays a streak rather than a row of dots. */
  raceSamples: 16,
  /** The race view's shutter (s): the rest of the game's to start, so entering the race view changes only the mask and the cap until the owner moves it. */
  raceShutter: 1 / 60,
  /** The race view's strength, times the Graphics page's: 1 to start, the setting's own look. */
  raceStrength: 1,
};

/** Whether what the camera follows is kept sharp by its own pixels this frame (the mask) rather than by the depth cut. */
export function masksFollowed(rule: FollowRule, view: FollowView): boolean {
  if (rule === 'cut' || view === 'other') return false;
  if (rule === 'mask') return true;
  return view === 'race' || view === 'chase';
}

/** The mask's cut (c0, c1) on view depth: nothing pushed past what the camera follows. */
export function maskCut(out: { x: number; y: number }): { x: number; y: number } {
  out.x = MOTION_TUNING.maskCut[0];
  out.y = MOTION_TUNING.maskCut[1];
  return out;
}

/** The race view's longest smear either side of a pixel, in pixels, and its tile size. */
export function raceBlurRadiusPx(height: number): number {
  return clamp(Math.round(MOTION_TUNING.raceRadiusOfHeight * height), 8, MAX_TILE_K);
}

/** The longest smear for a view: the race view's own, every other view's. */
export function blurRadiusFor(view: FollowView, height: number): number {
  return view === 'race' ? raceBlurRadiusPx(height) : maxBlurRadiusPx(height);
}

/**
 * The radius scale the resolve takes (the pass's `uScale`; a radius is the field's uv per frame times this). Every view
 * but the race view: the setting's strength over the game's shutter, a frame of `dt` held to a quarter and twice it, as
 * b4bfa5c had it. The race view: the setting's strength times its own, over its own shutter, with no bound on the ratio
 * but the frame's own floor, so a fixed speed smears as far at 30, 60 and 144 frames a second; held to twice the frame,
 * 1/60 already read as 1/72 at 144 Hz and every Shutter past it moved nothing. The streak's length is held by the race
 * K (`uMaxRadius`), never by the ratio.
 */
export function blurScale(view: FollowView, strength: number, dt: number): number {
  const step = Math.max(dt, 1e-3);
  if (view === 'race') return strength * MOTION_TUNING.raceStrength * (MOTION_TUNING.raceShutter / step);
  return strength * clamp(MOTION_TUNING.shutter / step, 0.25, 2);
}

/** What `tuneMotion` takes: every key optional, the console's `motionTune` argument. */
export interface MotionChanges {
  nearCut?: [number, number];
  radiusOfHeight?: number;
  samples?: number;
  followRule?: string;
  maskCutNear?: number;
  maskCutFull?: number;
  raceRadiusOfHeight?: number;
  raceSamples?: number;
  raceShutter?: number;
  raceStrength?: number;
}

/**
 * Move the motion blur's numbers for this session, as `__debug.motionTune` and its dials do: each value checked, a
 * refused one named in the words returned and left as it was. Nothing is saved. The pass sizes its tiles again by
 * itself on the frame a radius moves.
 */
export function tuneMotion(c: MotionChanges): string[] {
  const words: string[] = [];
  const T = MOTION_TUNING;
  const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (c.nearCut !== undefined) {
    const [a, b] = c.nearCut;
    if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && a < b) T.nearCut = [a, b];
    else words.push(`nearCut must be two distances in metres, the first below the second (got ${JSON.stringify(c.nearCut)})`);
  }
  if (c.radiusOfHeight !== undefined) {
    if (pos(c.radiusOfHeight)) T.radiusOfHeight = c.radiusOfHeight;
    else words.push(`radiusOfHeight must be a share above nought (got ${c.radiusOfHeight})`);
  }
  if (c.samples !== undefined && Number.isFinite(c.samples)) T.samples = Math.min(32, Math.max(4, Math.round(c.samples)));
  if (c.followRule !== undefined) {
    if ((FOLLOW_RULES as readonly string[]).includes(c.followRule)) T.followRule = c.followRule as FollowRule;
    else words.push(`followRule is one of ${FOLLOW_RULES.join(', ')} (got ${JSON.stringify(c.followRule)})`);
  }
  if (c.maskCutNear !== undefined || c.maskCutFull !== undefined) {
    const a = c.maskCutNear ?? T.maskCut[0];
    const b = c.maskCutFull ?? T.maskCut[1];
    if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && a < b) T.maskCut = [a, b];
    else words.push(`the mask's cut must be two distances in metres, the near below the full (got ${a} and ${b})`);
  }
  if (c.raceRadiusOfHeight !== undefined) {
    if (pos(c.raceRadiusOfHeight)) T.raceRadiusOfHeight = c.raceRadiusOfHeight;
    else words.push(`raceRadiusOfHeight must be a share above nought (got ${c.raceRadiusOfHeight})`);
  }
  if (c.raceSamples !== undefined && Number.isFinite(c.raceSamples)) T.raceSamples = Math.min(32, Math.max(4, Math.round(c.raceSamples)));
  if (c.raceShutter !== undefined) {
    if (pos(c.raceShutter)) T.raceShutter = c.raceShutter;
    else words.push(`raceShutter must be seconds above nought (got ${c.raceShutter})`);
  }
  if (c.raceStrength !== undefined) {
    if (typeof c.raceStrength === 'number' && Number.isFinite(c.raceStrength) && c.raceStrength >= 0) T.raceStrength = c.raceStrength;
    else words.push(`raceStrength must be nought or more (got ${c.raceStrength})`);
  }
  return words;
}

/** A peer's velocity from its relay messages. */
export const RELAY = {
  /** Each message moves the estimate a quarter of the way: within about 10% at 25 ms of arrival jitter. */
  blend: 0.25,
  /** s: two messages closer than this are taken as this far apart. */
  minGap: 0.05,
  /** A move between messages larger than this is a jump (travel, first placement), not a speed. */
  jumpMetres: 200,
  /** No message for this long: the estimate decays. */
  silentSeconds: 0.25,
};

/** GLSL's clamp. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** GLSL's smoothstep, for e0 < e1. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A move too fast to be motion: a respawn, a travel, a first placement. */
export function isJump(kind: FxMoverKind, moved: number, dt: number): boolean {
  if (moved > MOVER_LIMITS.teleportMetres) return true;
  const limit = kind === 'creature' || kind === 'npc' ? MOVER_LIMITS.figureJumpSpeed : MOVER_LIMITS.machineJumpSpeed;
  return moved / Math.max(dt, 1e-3) > limit;
}

/** Why a mover draws nothing this frame, or what it draws (the budget is decided after, by priority). */
export function classifyMover(f: MoverFacts): MoverResult {
  if (f.hidden) return 'hidden';
  if (!f.inFrustum) return 'culled';
  if (!f.historyValid) return 'fresh';
  if (isJump(f.kind, f.moved, f.dt)) return 'jump';
  // What the camera follows is exactly the static result wherever its parts ride with it: only a
  // part that moves relative to it has anything to draw, and it is never too small to matter. Under the mask it draws all
  // of itself, its parts riding with it at nought, so its pixels are marked and taken out of the reprojection.
  if (f.carried) return f.mask ? 'all' : f.animated > 0 ? 'animated' : 'still';
  if (f.screenRadiusPx < MOVER_LIMITS.minScreenRadiusPx) return 'small';
  const standing = f.speed < MOVER_LIMITS.stillSpeed && f.turn < MOVER_LIMITS.stillTurn;
  if (standing) return f.animated > 0 ? 'animated' : 'still';
  return 'all';
}

/** Larger and faster draws first, among movers the camera does not follow. */
export function moverPriority(screenRadiusPx: number, speed: number): number {
  return Math.min(screenRadiusPx, 4096) * (1 + Math.min(speed, 50) / 5);
}

/** One mover's claim on the frame's draws. */
export interface BudgetClaim {
  /** The draws it would make now. */
  pending: number;
  /** moverPriority: larger and faster first. */
  priority: number;
  /** The camera follows it: counted against its own cap, in list order, before any other. */
  carried: boolean;
}

export interface BudgetTotals {
  draws: number;
  carriedDraws: number;
}

/**
 * Which claims the frame's draws go to, written into `taken` in the claims' order. Claims the camera
 * follows are taken in list order up to `maxCarriedDraws`; the rest larger and faster first (equal
 * priorities in list order) up to `maxDraws`. A claim that does not fit is passed over and the loop
 * goes on, so one large mover never takes the smaller ones' blur with it. `order` is the caller's
 * kept scratch, so nothing is allocated once the arrays have grown.
 */
export function takeByBudget(claims: readonly BudgetClaim[], taken: boolean[], order: number[], maxDraws: number, maxCarriedDraws: number, out: BudgetTotals): BudgetTotals {
  taken.length = claims.length;
  order.length = 0;
  let carriedDraws = 0;
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];
    taken[i] = false;
    if (c.carried) {
      if (carriedDraws + c.pending <= maxCarriedDraws) {
        taken[i] = true;
        carriedDraws += c.pending;
      }
      continue;
    }
    // An insertion into a short kept list; a later claim of equal priority goes after.
    let k = order.length;
    order.push(i);
    while (k > 0 && claims[order[k - 1]].priority < c.priority) {
      order[k] = order[k - 1];
      k--;
    }
    order[k] = i;
  }
  let draws = 0;
  for (let j = 0; j < order.length; j++) {
    const i = order[j];
    const n = claims[i].pending;
    if (draws + n <= maxDraws) {
      taken[i] = true;
      draws += n;
    }
  }
  out.draws = draws;
  out.carriedDraws = carriedDraws;
  return out;
}

/** The first frame of a mesh's current run of passing the draw check, after this frame's check; -1 when it did not pass. */
export function shownSince(firstShown: number, shown: boolean, frame: number): number {
  if (!shown) return -1;
  return firstShown < 0 ? frame : firstShown;
}

/** A mesh may be drawn directly only once it passed on an earlier frame too: three has projected it then, so its buffers exist. */
export function drawableSince(firstShown: number, frame: number): boolean {
  return firstShown >= 0 && firstShown < frame;
}

/** 0 for a thing standing, 1 from a walk up: how much of the camera's movement a non-carried mover's velocity keeps. */
export function movingWeight(speed: number): number {
  return smoothstep(0.5, 3, speed);
}

/** The static cut (c0, c1) on view depth: the near cut, pushed past the far side of what the camera follows. */
export function staticCut(followFar: number, out: { x: number; y: number }): { x: number; y: number } {
  const [a, b] = MOTION_TUNING.nearCut;
  out.x = Math.max(a, followFar);
  out.y = out.x + (b - a);
  return out;
}

/** The longest smear either side of a pixel, in pixels, and the tile size of the blur's tile max. */
export function maxBlurRadiusPx(height: number): number {
  return clamp(Math.round(MOTION_TUNING.radiusOfHeight * height), 8, 64);
}

/** What decides a velocity material's program: every program three builds for a different one of these is a variant. */
export interface VariantKeyParts {
  skinned: boolean;
  morphs: number;
  morphNormals: boolean;
  morphColors: boolean;
  alpha: boolean;
}

export function variantKey(p: VariantKeyParts): string {
  return `s${+p.skinned}|m${p.morphs}|n${+p.morphNormals}|c${+p.morphColors}|a${+p.alpha}`;
}

/**
 * The variants compiled behind the loading screen for a ladder (`warmLadder`): the two rigid variants and every skinned
 * rung of the morph ladder (`PERSON_KEYS_TUNE.morphLadder`, every skinned primitive padded to it at load by
 * `skinnedLoad.ts`), with morph normals above nought (every morphed primitive the packs carry has them) and with and
 * without alpha: eight, a closed list of our own, where the old one was fourteen read off the packs and every head's
 * count (19 to 33) was missed and built in play. A primitive past the top rung keeps its own count, and its variant is
 * queued when it is met. Rigid movers have no morphs. With no ladder (`localStorage['swg.morphLadder'] = '0'`, where
 * every primitive keeps its own count) it is the first wave's list as it stood, so the hatch is the old way to compare.
 */
export function warmVariants(ladder: readonly number[] | null): readonly VariantKeyParts[] {
  const rigid: VariantKeyParts[] = [
    { skinned: false, morphs: 0, morphNormals: false, morphColors: false, alpha: false },
    { skinned: false, morphs: 0, morphNormals: false, morphColors: false, alpha: true },
  ];
  if (!ladder) return [...rigid, ...WAVE_ONE_SKINNED];
  return [...rigid, ...ladder.flatMap((m) => [false, true].map((alpha) => ({ skinned: true, morphs: m, morphNormals: m > 0, morphColors: false, alpha })))];
}

/**
 * The first wave's skinned variants, as they stood before the ladder: over the 3441 character, wardrobe and player
 * files then there were 36 skinned keys (m3 1570 parts, m0 1464, m4 1061, m0 with alpha 163, m5 110, m2 77, m1 47, m6
 * 40, ...), and these twelve with the two rigid ones covered 4613 of 4723 parts (97.7%). Kept only for the hatch.
 */
const WAVE_ONE_SKINNED: readonly VariantKeyParts[] = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((m) => ({ skinned: true, morphs: m, morphNormals: m > 0, morphColors: false, alpha: false })),
  ...[0, 2, 3, 4].map((m) => ({ skinned: true, morphs: m, morphNormals: m > 0, morphColors: false, alpha: true })),
];

/** What this session compiles behind the loading screen (see `warmVariants`). */
export const WARM_VARIANTS: readonly VariantKeyParts[] = warmVariants(warmLadder());

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** One relay message's step of a peer's smoothed world velocity (m/s), in place; a jump resets it to zero. */
export function stepRelayVelocity(vel: Vec3Like, dx: number, dy: number, dz: number, gapSeconds: number): void {
  if (dx * dx + dy * dy + dz * dz > RELAY.jumpMetres * RELAY.jumpMetres) {
    vel.x = 0;
    vel.y = 0;
    vel.z = 0;
    return;
  }
  const g = Math.max(RELAY.minGap, gapSeconds);
  vel.x += (dx / g - vel.x) * RELAY.blend;
  vel.y += (dy / g - vel.y) * RELAY.blend;
  vel.z += (dz / g - vel.z) * RELAY.blend;
}

/**
 * The velocity fragment shader's formula in 2D: ((now − ref) × max(nearWeight, moving) + (ref − prev)) × 0.5.
 * `now` is where the point is on the screen (ndc), `ref` where it would have been had it only ridden
 * with what the camera follows, `prev` where it was. For the test only: it allocates its result.
 */
export function combineVelocity(now: [number, number], ref: [number, number], prev: [number, number], nearWeight: number, moving: number): [number, number] {
  const w = Math.max(nearWeight, moving);
  return [((now[0] - ref[0]) * w + (ref[0] - prev[0])) * 0.5, ((now[1] - ref[1]) * w + (ref[1] - prev[1])) * 0.5];
}

function cone(d: number, r: number): number {
  return clamp(1 - d / Math.max(r, 1e-3), 0, 1);
}

function cylinder(d: number, r: number): number {
  const q = Math.max(r, 1e-3);
  return 1 - smoothstep(0.95 * q, 1.05 * q, d);
}

/** 1 when depth a is in front of b; fades over 5 cm, or 2% of b's depth, whichever is larger. */
function inFront(za: number, zb: number): number {
  return clamp(1 - (za - zb) / Math.max(0.05, 0.02 * zb), 0, 1);
}

/**
 * The gather's weight for one tap: how much a sample Y at `d` pixels from the pixel X adds to it,
 * given each one's blur radius (pixels) and view depth (m). The same guards as the shader, so it is
 * finite for every radius including zero.
 */
export function reconstructionWeight(d: number, rX: number, rY: number, zX: number, zY: number): number {
  return (
    inFront(zY, zX) * cone(d, rY) + // a blurred thing in front reaches X as far as its own radius
    inFront(zX, zY) * cone(d, rX) + // what is behind X shows only as far as X's own radius
    cylinder(d, rY) * cylinder(d, rX) * 2 // two blurred pixels at similar depth mix where both reach
  );
}

/**
 * Whether the neighbour max takes a tile at offset (ox, oy) moving by (vx, vy): an orthogonal tile
 * always, a diagonal one only when it moves along the diagonal, either way (the gather spreads both
 * ways). The shader's `normalize(v + 1e-6)` is mirrored, so a zero velocity answers as it does.
 */
export function neighbourAccepts(ox: number, oy: number, vx: number, vy: number): boolean {
  if (ox === 0 || oy === 0) return true;
  const ax = vx + 1e-6;
  const ay = vy + 1e-6;
  const al = Math.hypot(ax, ay);
  const bl = Math.hypot(ox, oy);
  const dot = (ax / al) * (ox / bl) + (ay / al) * (oy / bl);
  return Math.abs(dot) >= 0.7;
}
