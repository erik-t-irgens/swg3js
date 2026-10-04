// The story's one companion, as this browser stands them: the pure half, with no three and no physics, so a
// node test drives the very keeper the game keeps.
//
// **Who and how is the story's.** The book holds the companion (`CompanionRec`, `quests.ts`), and the view
// hands this browser who they are, their body and how they stand (`CompanionView`): with the player (`active`),
// down in a fight (`downed`), told to wait (`waiting`), let go (`released`) or dead by the story's word
// (`dead`). Told to wait or let go they are the story's cast again, stood where they were left
// (`storyStands.ts`); this keeper stands them only while they are with the player.
//
// **One body, handed across.** The person in front of the player never vanishes to be stood again somewhere
// else: taken on in their own conversation, or come back when spoken to where they waited, the body the story's
// cast stands is handed to this keeper where it stands (`adopt`), and told to wait or let go, this keeper's body
// is handed back to the cast where it stands (`handBack`), so a conversation held with them goes on through it.
//
// **Beside the player, always.** A follower is dropped at every change of world (`FollowerSet.clear`), so the
// companion is stood again beside the player at each arrival, behind the loading screen (`stand`), and taken
// on as follower slot 0 with the owner kind `companion`; the spot is the first of a ring round the player,
// behind them first, that the game finds a floor at with nothing solid between (`standSpot`, `floor`), or the
// player's own spot when none is. In a vehicle, a ship or adrift they are aboard and not drawn, and get off
// where the player next stands on foot. Left behind past `FOLLOW_TUNE.letGo` and out of view -- a lift, a door
// into a building with no way in on foot, the console -- they are stood again beside the player.
//
// **Down, never dead.** The body is `downable`: at nought health it lies incapacitated and out of the fight,
// and the host is told (`StoryEvent` `companion`). It gets up at `reviveShare` of its health when the player
// holds the use key for `reviveHold` seconds within `reviveReach` metres (`revive`, from the game's own E), or
// by itself after `selfAfter` seconds with nothing within `selfClear` still in the fight (`isThreat`: hostile
// either way, or still after the player, a follower or the companion, whatever its temper). Leaving the world
// while it is down brings it back up at the arrival. Only the story kills it (`kill(who)`), and then it falls
// for good.
//
// **This browser's alone**, as every follower is: never on the wire, and its kills credited to nobody in this
// pass. Every number is ours, in `COMPANION_TUNE`, live through `__debug.companion`.

import { hostileSides, type Fighter } from '../combat/targets.ts';
import type { CompanionView } from '../story/view.ts';
import { FOLLOW_TUNE } from './followers.ts';

/** Every number of the companion, all of them ours. */
export const COMPANION_TUNE = {
  /** Companions at once (the design's one; the story's record holds exactly one). */
  max: 1,
  /** Seconds the use key is held beside a companion who is down to get them up. */
  reviveHold: 3,
  /** Metres from a companion who is down within which holding the key gets them up. */
  reviveReach: 2,
  /** Their health's share they get up with. */
  reviveShare: 0.3,
  /** Seconds a companion lies down before getting up by themselves... */
  selfAfter: 20,
  /** ...with nothing hostile within this many metres. */
  selfClear: 30,
  /** Metres behind the player a companion is stood at an arrival, or stood again. */
  standBack: 2.5,
  /** Metres above or below the player's feet a floor beside them may be and still be stood on. */
  floorRise: 1.5,
  /** Metres past a spot that must be clear of anything solid as well, so a body is not stood against a wall. */
  clearPad: 0.4,
  /** Milliseconds a loading screen waits for a companion stood behind it to have their model up. */
  standWait: 4000,
};

/** Move any of those, live; a number only ever by a finite one, never below nought, `max` a whole one. */
export function tuneCompanion(o?: Partial<typeof COMPANION_TUNE> | null): typeof COMPANION_TUNE {
  if (!o) return COMPANION_TUNE;
  const into = COMPANION_TUNE as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(o)) {
    if (!(k in COMPANION_TUNE) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    into[k] = k === 'max' ? Math.max(0, Math.round(v)) : k === 'reviveShare' ? Math.max(0.01, Math.min(1, v)) : Math.max(0, v);
  }
  return COMPANION_TUNE;
}

/**
 * The ways round the player a companion is stood, tried in order: behind them first, then turned off behind to
 * either side, then beside them, then ahead, each `standBack` out, and last half that behind. Radians from
 * straight behind, with the share of `standBack`.
 */
const STAND_RING: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.9, 1],
  [-0.9, 1],
  [1.6, 1],
  [-1.6, 1],
  [Math.PI, 1],
  [0, 0.5],
];

/**
 * The `i`th spot round the player (at `x`, `z`, facing `heading`) a companion may be stood at, written into
 * `out`, or false past the last. The first is `standBack` metres straight behind.
 */
export function standSpot(i: number, x: number, z: number, heading: number, out: { x: number; z: number }): boolean {
  const r = STAND_RING[i];
  if (!r) return false;
  const a = heading + Math.PI + r[0];
  const d = COMPANION_TUNE.standBack * r[1];
  out.x = x + Math.sin(a) * d;
  out.z = z + Math.cos(a) * d;
  return true;
}

/** What `isThreat` reads of something alive near the companion. */
export interface ThreatLike extends Fighter {
  readonly dead: boolean;
  /** Whether it is fighting, or holds a grudge against, anybody `ours` names (a catalogue body's `Mobile.fights`). */
  fights?(ours: (key: number) => boolean): boolean;
}

/**
 * Whether something keeps a companion lying down: alive, and still in the fight -- it would pick one with the
 * player (`side`, whose side the companion is on) on sight, or it is fighting, or holds a grudge against, the
 * player, a follower or the companion (`ours`), whatever its temper. Asked of the companion's own body instead,
 * a companion who cannot fight is passive and nothing would ever count, and a creature that was only defending
 * itself keeps its own temper while it fights, so its side alone would not count it either.
 */
export function isThreat(t: ThreatLike, side: Fighter, ours: (key: number) => boolean): boolean {
  if (t.dead) return false;
  if (hostileSides(t, side)) return true;
  return !!t.fights?.(ours);
}

/** What the keeper reads of a body: a catalogue person stood for the companion satisfies it as it stands. */
export interface CompanionBody {
  readonly removed: boolean;
  readonly dead: boolean;
  readonly downed: boolean;
  readonly pos: { readonly x: number; readonly z: number };
}

/** Where the player is, as the keeper is told each step. */
export interface CompanionScene {
  /** On foot in a world being simulated: not riding, flying, aboard, adrift or travelling. */
  onFoot: boolean;
  /** The world's generation: a body stood in another is no body of this world. */
  gen: number;
  /** The player in the world's frame, and the way they face. */
  x: number;
  z: number;
  heading: number;
  /** The world's own clock, in seconds: what a self-revive is timed on, so a panel stops it as it stops the fight. */
  now: number;
}

/** What the keeper asks of the game. */
export interface CompanionDeps<B extends CompanionBody> {
  /**
   * Stand the companion at a point in the world's frame, on the floor at `y` where one was found (null: the
   * ground's own), facing `heading`, and take them on as follower slot 0; null when the world would not.
   */
  stand(v: CompanionView, x: number, z: number, heading: number, y: number | null): B | null;
  /**
   * The floor a body could stand on at a point beside the player, reached from the player in a straight line
   * with nothing solid between, or null where there is none (a wall in the way, the edge of a room, nothing under
   * it). Absent: every spot is taken as it is.
   */
  floor?(x: number, z: number): number | null;
  /**
   * The body already standing for this person, handed over where it stands and taken on as follower slot 0, or
   * null when there is none: the story's cast standing them, as they are taken on in their own conversation or
   * come back when spoken to where they waited. Absent: a body is always stood afresh.
   */
  adopt?(v: CompanionView): B | null;
  /**
   * The body handed back to the story's cast where it stands, told to wait or let go, rather than taken down and
   * another stood where they wait: false when the cast will not have it, and it is taken down instead.
   */
  handBack?(b: B, v: CompanionView): boolean;
  /** Take a body back down. */
  unstand(b: B): void;
  /** Get a body that is down up again, with that share of its health. */
  getUp(b: B, share: number): boolean;
  /** The story kills them: the body falls for good. */
  fall(b: B): void;
  /** Whether anything still in the fight stands within `radius` of the body (`isThreat`). */
  hostileNear(b: B, radius: number): boolean;
  /** Whether the camera can see the body: one in view is never stood again under the player's eyes. */
  inView(b: B): boolean;
  /** The host told the companion went down (false) or got up (true). */
  tell(up: boolean): void;
}

/** What the keeper did on a step, for the console and the test. */
export type CompanionStep = 'none' | 'stood' | 'adopted' | 'restood' | 'down' | 'up' | 'unstood' | 'handed' | 'fell' | 'aboard';

export class CompanionKeeper<B extends CompanionBody = CompanionBody> {
  /** The body stood for the companion, or null. */
  body: B | null = null;
  /** Whose body it is. */
  who: string | null = null;
  private gen = -1;
  /** When the body went down, on the world's clock, or NaN while it is up. */
  private downAt = Number.NaN;
  /** How long the use key has been held beside the body while it is down. */
  holding = 0;
  /** What the host was last told: so each going down and getting up is told once. */
  private toldDown = false;
  /** What the keeper has done, for the console. */
  readonly tally = { stood: 0, adopted: 0, restood: 0, handedBack: 0, downs: 0, ups: 0, selfUps: 0, revives: 0, fell: 0, spotsTried: 0, onPlayer: 0 };

  /** Whether a body is the companion's. */
  isBody(b: unknown): boolean {
    return !!this.body && this.body === b;
  }

  private readonly spot = { x: 0, z: 0 };
  /** The floor's height `place` found under the spot, or null for the ground's own. */
  private spotY: number | null = null;

  /**
   * The spot a companion is stood at beside the player: the first of the ring (`standSpot`) the game finds a
   * floor at with nothing between it and the player, else the player's own spot. Left in `spot` and `spotY`.
   */
  private place(s: CompanionScene, deps: CompanionDeps<B>): void {
    for (let i = 0; standSpot(i, s.x, s.z, s.heading, this.spot); i++) {
      this.tally.spotsTried++;
      if (!deps.floor) {
        this.spotY = null;
        return;
      }
      const y = deps.floor(this.spot.x, this.spot.z);
      if (y !== null) {
        this.spotY = y;
        return;
      }
    }
    // Nowhere clear round them: on the player's own spot, which the player walks through (`walkThrough`).
    this.tally.onPlayer++;
    this.spot.x = s.x;
    this.spot.z = s.z;
    this.spotY = deps.floor ? deps.floor(s.x, s.z) : null;
  }

  /** A body stood beside the player, or null when the world would not. */
  private standNew(view: CompanionView, s: CompanionScene, deps: CompanionDeps<B>): B | null {
    this.place(s, deps);
    const nb = deps.stand(view, this.spot.x, this.spot.z, s.heading, this.spotY);
    if (!nb) return null;
    this.body = nb;
    this.who = view.id;
    this.gen = s.gen;
    return nb;
  }

  /**
   * One step, a few times a second: the body stood, taken down or stood again as the view and the player's
   * place say, a body gone down told, and one down long enough with nothing hostile near got up by itself.
   */
  step(view: CompanionView | null | undefined, s: CompanionScene, deps: CompanionDeps<B>): CompanionStep {
    const b = this.body;
    // Gone from under us: another world, or taken away by the game.
    if (b && (this.gen !== s.gen || b.removed)) this.forget();
    const along = !!view && (view.state === 'active' || view.state === 'downed');
    if (view?.state === 'dead') {
      if (!this.body) return 'none';
      const dying = this.body;
      if (!dying.dead) deps.fall(dying);
      this.forget();
      this.tally.fell++;
      return 'fell';
    }
    if (!along || !view) {
      if (!this.body) return 'none';
      const leaving = this.body;
      this.forget();
      // Told to wait, or let go: the body is handed to the story's cast where it stands, so whoever is speaking
      // to them goes on speaking to the same person, and only a cast that will not have it takes it down. One
      // lying down (the story told them while they were) gets up first: nothing but this keeper gets a body up,
      // and one lying in a fight's state is somebody nobody can speak to, who could never be fetched back.
      if (view && (view.state === 'waiting' || view.state === 'released') && deps.handBack) {
        if (leaving.downed) deps.getUp(leaving, COMPANION_TUNE.reviveShare);
        if (deps.handBack(leaving, view)) {
          this.tally.handedBack++;
          return 'handed';
        }
      }
      deps.unstand(leaving);
      return 'unstood';
    }
    if (this.body && this.who !== view.id) {
      deps.unstand(this.body);
      this.forget();
    }
    if (!s.onFoot) {
      // Aboard: not drawn, and off where the player next stands on foot.
      if (!this.body) return 'aboard';
      deps.unstand(this.body);
      this.forget();
      return 'aboard';
    }
    if (!this.body) {
      // The body already standing for them first, where it stands: the one the player is speaking to.
      const had = deps.adopt?.(view) ?? null;
      if (had) {
        this.body = had;
        this.who = view.id;
        this.gen = s.gen;
        this.tally.adopted++;
        if (view.state === 'downed' && !had.downed) deps.tell(true);
        return 'adopted';
      }
      if (!this.standNew(view, s, deps)) return 'none';
      this.tally.stood++;
      // Stood fresh is stood up: one the book holds down (the world was left while they were) comes back up.
      if (view.state === 'downed') deps.tell(true);
      return 'stood';
    }
    const body = this.body;
    // Left far behind and out of sight: stood again beside the player.
    if (!body.downed && Math.hypot(body.pos.x - s.x, body.pos.z - s.z) > FOLLOW_TUNE.letGo && !deps.inView(body)) {
      deps.unstand(body);
      this.forget();
      if (!this.standNew(view, s, deps)) return 'none';
      this.tally.restood++;
      return 'restood';
    }
    if (body.downed) {
      if (!this.toldDown) {
        this.toldDown = true;
        this.downAt = s.now;
        this.holding = 0;
        this.tally.downs++;
        deps.tell(false);
        return 'down';
      }
      if (s.now - this.downAt >= COMPANION_TUNE.selfAfter && !deps.hostileNear(body, COMPANION_TUNE.selfClear) && deps.getUp(body, COMPANION_TUNE.reviveShare)) {
        this.tally.selfUps++;
        return this.upped(deps);
      }
      return 'none';
    }
    // Up while the book still holds them down (somebody got them up another way): the host is told.
    if (this.toldDown) return this.upped(deps);
    return 'none';
  }

  /**
   * The use key held beside the body while it is down, for `dt` seconds: got up once it has been held for
   * `reviveHold` seconds within `reviveReach` metres. Let go of, or out of reach, it starts again. Answers
   * how far along it is, from nought to one, or -1 when there is nothing to get up here.
   */
  hold(dt: number, held: boolean, px: number, pz: number, deps: CompanionDeps<B>): number {
    const b = this.body;
    if (!b || !b.downed) {
      this.holding = 0;
      return -1;
    }
    if (!held || Math.hypot(b.pos.x - px, b.pos.z - pz) > COMPANION_TUNE.reviveReach) {
      this.holding = 0;
      return held ? -1 : 0;
    }
    this.holding += Math.max(0, dt);
    if (this.holding < COMPANION_TUNE.reviveHold) return this.holding / Math.max(1e-6, COMPANION_TUNE.reviveHold);
    this.holding = 0;
    if (!deps.getUp(b, COMPANION_TUNE.reviveShare)) return -1;
    this.tally.revives++;
    this.upped(deps);
    return 1;
  }

  /** Whether the body is down within `reviveReach` of a point: what the use key would get up. */
  revivable(px: number, pz: number): boolean {
    const b = this.body;
    return !!b && b.downed && !b.removed && Math.hypot(b.pos.x - px, b.pos.z - pz) <= COMPANION_TUNE.reviveReach;
  }

  private upped(deps: CompanionDeps<B>): CompanionStep {
    this.toldDown = false;
    this.downAt = Number.NaN;
    this.holding = 0;
    this.tally.ups++;
    deps.tell(true);
    return 'up';
  }

  /**
   * The body forgotten (it went with its world, was taken down or handed back). What the host was told of it goes
   * with it: the next body is somebody's own, and a down told of one that has gone is never answered with an up
   * the next body never had to give (one the book still holds down is told up as it is stood).
   */
  private forget(): void {
    this.body = null;
    this.who = null;
    this.gen = -1;
    this.downAt = Number.NaN;
    this.holding = 0;
    this.toldDown = false;
  }

  /**
   * The world is going (a travel, the select screen): the body goes with it. A companion down as the world
   * goes comes back up at the arrival (`step` tells the host when it stands them again).
   */
  clear(): void {
    this.forget();
  }

  /** For the console. */
  report(px: number, pz: number): Record<string, unknown> {
    const b = this.body;
    return {
      who: this.who,
      stood: !!b,
      down: !!b?.downed,
      away: b ? Math.round(Math.hypot(b.pos.x - px, b.pos.z - pz) * 10) / 10 : null,
      downAt: Number.isFinite(this.downAt) ? Math.round(this.downAt * 10) / 10 : null,
      holding: Math.round(this.holding * 100) / 100,
      toldDown: this.toldDown,
      tally: { ...this.tally },
      tune: { ...COMPANION_TUNE },
    };
  }
}
