// The people who follow the player: who they are, where each walks, whom they fight, and how they are
// let go again -- the pure half, with no three and no physics, so a node test drives the very set the
// game keeps.
//
// **A follower is a combatant on the player's side.** Asked to follow, a person takes the player's side
// and a temper that answers blows rather than picking fights (`defensive`), so it may be struck and may
// fall, and it never turns on the player or on anybody else following them: nothing on the player's side
// is ever held a grudge against (`Mobile.remember`), and a blow from its own side is refused where it
// lands (`Mobile.damage`). What it fights is **whatever attacks the player and whatever the player
// attacks**, which is two calls into `assist` -- the player struck by something, and something struck by
// the player -- each of which hands that thing to every follower as though it had struck them. The
// brain's own attacker memory does the rest, so a follower fights exactly as any other body of its kind
// does, with everything its tier gives it.
//
// **Where it walks is a place of its own behind the player**: two to a row, left then right, a row
// further back for the third (`slotOf`), turned by the way the player has been walking rather than the
// way the camera looks, so a follower is not flung round the player every time the view swings. Its home
// is that place, rewritten on every thought, so the brain's own leash measures from the player: a
// follower drawn more than a leash off by a chase gives it up and runs back, which is the brain's rule and
// not a new one. Only the idle half of its decision is this file's (`keepFollow`): a fight, a flight and
// that run back are the brain's.
//
// **Everything here is ours**, and live through `__debug.followers({ tune })`.
//
// **A follower is this browser's alone and stays on its world.** It is left behind by any change of
// world and at the select screen (`clear`, from the world's own unload), and a body the server shares is
// never one (`talk.ts` refuses it). Asked to stop following it stays where it was left -- its home moved
// to that spot -- and is handed back to whatever stood it once the player is `letGo` away: until then the
// standing people's own caps and memory rules may not take it (`holds`), and one of ours or a lair's,
// which were given up to the set when they were asked, is taken away by the set itself.
import type { Decision, Post } from './mobiles/brain.ts';
import type { Aggression, Living, Side } from '../combat/kit.ts';

/** Every number of the followers, all of them ours. */
export const FOLLOW_TUNE = {
  /** The most who may follow at once. */
  most: 3,
  /**
   * The places behind the player: `back` metres behind, `side` metres either side of their line, and a
   * row `row` metres further back for every two.
   */
  back: 2.2,
  side: 1.3,
  row: 1.6,
  /**
   * When a follower stands: within `near` of its place, or within `settle` of the player and not more
   * than `ahead` in front of them. Nearer than that is no matter, since the player walks through it.
   */
  near: 1.4,
  settle: 3.2,
  ahead: 0.5,
  /** Farther than `run` from its place it runs, and so it does while the player is going faster than `runWith` m/s. */
  run: 7,
  runWith: 3.2,
  /** How far the player must go before the way they are walking is taken as their heading, metres. */
  turn: 0.8,
  /** A move of the player's longer than this in one step is a jump of place, not a speed, metres. */
  jump: 12,
  /** How far off the player must be before somebody asked to stop following is handed back, metres. */
  letGo: 80,
};

/** Set any of the numbers at once; a number only ever by a finite number, and `most` a whole one. */
export function tuneFollow(o?: Partial<typeof FOLLOW_TUNE> | null): typeof FOLLOW_TUNE {
  if (!o) return FOLLOW_TUNE;
  const into = FOLLOW_TUNE as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(o)) {
    if (!(k in FOLLOW_TUNE) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    into[k] = k === 'most' ? Math.max(0, Math.round(v)) : Math.max(0, v);
  }
  return FOLLOW_TUNE;
}

/**
 * What a follower is told, rewritten by the set every step and read by the body on every thought: whom
 * it follows, its place behind them, the way they are walking and whether they are going fast enough to
 * run after. `spot` and `look` are the two points its decision is written with, kept so a thought makes
 * nothing.
 */
export interface FollowOrder {
  readonly leader: Living;
  index: number;
  slotX: number;
  slotZ: number;
  leaderX: number;
  leaderZ: number;
  heading: number;
  run: boolean;
  readonly spot: { x: number; z: number };
  readonly look: { x: number; z: number };
  /**
   * Standing where it is because its place could not be reached (a wall stands on it): set when its stuck
   * count rises within `settle` of the leader, with where the leader stood then, and let go of once the
   * leader has moved `turn` from there. `stuckSeen` is the count it was last told.
   */
  parked: boolean;
  parkX: number;
  parkZ: number;
  stuckSeen: number;
}

/**
 * Follower `i`'s place behind a leader at (`lx`, `lz`) walking along `heading` (forward is `(sin, cos)`
 * in this game, and a body's left is `(cos, -sin)`): two to a row, the left first, a row further back for
 * every two. Written into `out`.
 */
export function slotOf(i: number, lx: number, lz: number, heading: number, out: { x: number; z: number }, tune = FOLLOW_TUNE): { x: number; z: number } {
  const row = Math.floor(Math.max(0, i) / 2);
  const side = i % 2 === 0 ? 1 : -1;
  const back = tune.back + row * tune.row;
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  out.x = lx - s * back + c * tune.side * side;
  out.z = lz - c * back - s * tune.side * side;
  return out;
}

/**
 * A decision kept to a follower's place, in place, as `keepPost` keeps one to a post: the brain's fight
 * and flight are left alone, and so is its run back past the leash until it is beside the leader again;
 * everything else becomes a walk to its place -- a run when it is far or the leader is running -- or, once
 * it is there, standing and looking the way the leader looks. "There" is its place, or near enough to
 * the leader and not in front of them; and a place it has been stuck trying to reach while beside the
 * leader is given up where it stands until the leader moves on (`parked`), since the commonest reason for
 * that is a wall standing on it and walking into the wall is the one thing that must not go on.
 */
export function keepFollow(d: Decision, self: { x: number; z: number; stuck?: number }, o: FollowOrder, tune = FOLLOW_TUNE): void {
  if (d.targetKey !== null || d.state === 'flee') return;
  const toSlot = Math.hypot(o.slotX - self.x, o.slotZ - self.z);
  const lx = self.x - o.leaderX;
  const lz = self.z - o.leaderZ;
  const toLeader = Math.hypot(lx, lz);
  if (d.state === 'return' && toLeader > tune.settle) return;
  if (o.parked && Math.hypot(o.leaderX - o.parkX, o.leaderZ - o.parkZ) > tune.turn) o.parked = false;
  const stuck = self.stuck ?? 0;
  if (stuck > o.stuckSeen && toLeader <= tune.settle) {
    o.parked = true;
    o.parkX = o.leaderX;
    o.parkZ = o.leaderZ;
  }
  o.stuckSeen = stuck;
  const ahead = lx * Math.sin(o.heading) + lz * Math.cos(o.heading);
  const settled = toSlot <= tune.near || o.parked || (toLeader <= tune.settle && ahead <= tune.ahead);
  if (!settled) {
    const s = o.spot;
    s.x = o.slotX;
    s.z = o.slotZ;
    d.state = 'wander';
    d.goal = s;
    d.moveTo = s;
    d.face = s;
    d.pace = o.run || toSlot > tune.run ? 'run' : 'walk';
    d.emote = null;
    return;
  }
  d.state = 'idle';
  d.goal = null;
  d.moveTo = null;
  d.pace = 'stand';
  const l = o.look;
  l.x = self.x + Math.sin(o.heading);
  l.z = self.z + Math.cos(o.heading);
  d.face = l;
}

/** What the set reads and writes of a body: a catalogue person satisfies it as it stands. */
export interface FollowerBody {
  readonly key: number;
  readonly label: string;
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly heading: number;
  readonly dead: boolean;
  readonly removed: boolean;
  /** Whether it has anything to fight with at all: a body with nothing keeps its passive temper. */
  readonly canFight: boolean;
  side: Side;
  aggression: Aggression;
  essential: boolean;
  post: Post | null;
  patrol: unknown;
  homeX: number;
  homeZ: number;
  follow: FollowOrder | null;
  /** Told that `attacker` struck: it remembers them as though it had been struck itself. */
  provoke(attacker: Living): void;
  /** Its steering let go of, once it is no longer following (its last decision was a walk to a place that has gone). */
  unfollow?(): void;
}

/**
 * Who stood a follower, which says who takes it away when it is done with: the standing people keep
 * their own (`stood`, and the set only says it `holds` it while it follows), one of ours or a lair's was
 * given up to the set outright (`adopted`, and the set takes it away), and one stood by hand is the
 * manager's as it always was (`own`).
 */
export type FollowerOwner = 'stood' | 'adopted' | 'own';

/**
 * Who a body asked to follow belongs to, from what the world calls it, or why it may not follow, in words.
 * `back` is the owner the set already has for it when it was asked to stop and not yet handed back
 * (`FollowerSet.releasedOwner`): such a body is the set's already, so it keeps that owner and nothing is
 * given up for it a second time -- one of ours or a lair's was taken off its books the first time, and
 * asking those books again could only say it is not theirs any more. Otherwise a body the world named
 * `stood:` stays its row's, one named `ours:` or `wild:` is given up by its books (`release`, which
 * answers whether they had it), one with no name was stood by hand, and anything else is the world's.
 */
export function recruitOwner(id: string, back: FollowerOwner | null, release: { ours(): boolean; wild(): boolean }): { owner: FollowerOwner } | { refused: string } {
  if (back) return { owner: back };
  if (!id) return { owner: 'own' };
  if (id.startsWith('stood:')) return { owner: 'stood' };
  if (id.startsWith('ours:')) return release.ours() ? { owner: 'adopted' } : { refused: 'not one of ours any more' };
  if (id.startsWith('wild:')) return release.wild() ? { owner: 'adopted' } : { refused: 'not one of its camp any more' };
  return { refused: 'kept by the world, not by you' };
}

/**
 * Whether something that struck is somebody following the player: a living thing carrying a follow order.
 * Such a blow or shot on the player is no blow at all (`App`'s damage wrapper and its bolts' `onPlayerHit`).
 */
export function isFollowerSource(t: unknown): boolean {
  return !!t && !!(t as { follow?: unknown }).follow;
}

/** What the set needs of the game: taking a body away, letting the player walk through one, and saying things. */
export interface FollowerDeps<B extends FollowerBody> {
  remove(b: B): void;
  walkThrough?(b: B, on: boolean): void;
  say?(text: string): void;
}

interface Kept<B extends FollowerBody> {
  body: B;
  owner: FollowerOwner;
  since: number;
  order: FollowOrder;
  was: { side: Side; aggression: Aggression; essential: boolean; post: Post | null };
}

/** The people following the player, and those just asked to stop. The world keeps one, steps it and clears it with itself. */
export class FollowerSet<B extends FollowerBody = FollowerBody> {
  private readonly kept: Kept<B>[] = [];
  private readonly released: { body: B; owner: FollowerOwner }[] = [];
  deps: FollowerDeps<B> | null = null;
  /** The way the leader has been walking, how fast, and where their heading was last taken from. */
  heading = 0;
  speed = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private anchorX = Number.NaN;
  private anchorZ = Number.NaN;
  /** The place a slot is worked out into, kept. */
  private readonly slot = { x: 0, z: 0 };
  /** What the set has done since the world loaded, for the console. */
  readonly tally = { joined: 0, dismissed: 0, fell: 0, handedBack: 0, assists: 0 };

  /** How many follow now. */
  get count(): number {
    return this.kept.length;
  }

  /** Whether no one more may follow. */
  get full(): boolean {
    return this.kept.length >= FOLLOW_TUNE.most;
  }

  /** The bodies following, in their order. */
  bodies(): B[] {
    return this.kept.map((k) => k.body);
  }

  following(b: B): boolean {
    for (const k of this.kept) if (k.body === b) return true;
    return false;
  }

  /**
   * Whether the set has a body at all: following, or asked to stop and not yet handed back. What the
   * standing people ask before putting a body down for their cap or their memory (`PeopleDeps.keeps`).
   */
  holds(b: B): boolean {
    if (this.following(b)) return true;
    for (const r of this.released) if (r.body === b) return true;
    return false;
  }

  /**
   * Who stood a body asked to stop and not yet handed back, or null for one that is not waiting here:
   * what a second ask to follow keeps (`recruitOwner`), since such a body is the set's already.
   */
  releasedOwner(b: B): FollowerOwner | null {
    for (const r of this.released) if (r.body === b) return r.owner;
    return null;
  }

  /**
   * Take a body on as a follower of `leader`, or say in words why not. What it was is kept for the day it
   * is asked to stop: its side, its temper, whether it was part of the furniture and its post. It takes
   * the player's side, answers blows (keeping its passive temper only when it has nothing to fight with),
   * may be struck, keeps no post and walks no round.
   */
  add(b: B, owner: FollowerOwner, leader: Living, now: number): string | null {
    if (b.dead || b.removed) return 'gone';
    if (this.following(b)) return 'already following you';
    if (this.full) return 'you have as much company as you can take';
    const back = this.released.findIndex((r) => r.body === b);
    if (back >= 0) this.released.splice(back, 1);
    const order: FollowOrder = {
      leader,
      index: this.kept.length,
      slotX: b.pos.x,
      slotZ: b.pos.z,
      leaderX: leader.pos.x,
      leaderZ: leader.pos.z,
      heading: this.heading,
      run: false,
      spot: { x: b.pos.x, z: b.pos.z },
      look: { x: b.pos.x, z: b.pos.z },
      parked: false,
      parkX: 0,
      parkZ: 0,
      stuckSeen: Number.POSITIVE_INFINITY,
    };
    this.kept.push({ body: b, owner, since: now, order, was: { side: b.side, aggression: b.aggression, essential: b.essential, post: b.post } });
    b.side = 'player';
    b.aggression = b.canFight ? 'defensive' : 'passive';
    b.essential = false;
    b.post = null;
    b.patrol = null;
    b.follow = order;
    this.deps?.walkThrough?.(b, true);
    this.tally.joined++;
    this.place();
    return null;
  }

  /**
   * Ask a follower to stop: back on its own side and temper and part of the furniture again if it was,
   * its home moved to where it stands (a post there, if it had one), and held until the player is
   * `letGo` away. False for a body that was not following.
   */
  dismiss(b: B): boolean {
    const i = this.kept.findIndex((k) => k.body === b);
    if (i < 0) return false;
    const k = this.kept[i];
    this.kept.splice(i, 1);
    this.restore(k);
    this.released.push({ body: b, owner: k.owner });
    this.tally.dismissed++;
    this.place();
    return true;
  }

  private restore(k: Kept<B>): void {
    const b = k.body;
    b.follow = null;
    this.deps?.walkThrough?.(b, false);
    if (b.dead || b.removed) return;
    b.side = k.was.side;
    b.aggression = k.was.aggression;
    b.essential = k.was.essential;
    b.homeX = b.pos.x;
    b.homeZ = b.pos.z;
    b.post = k.was.post ? { kind: 'near', heading: b.heading, tune: k.was.post.tune } : null;
    b.unfollow?.();
  }

  /**
   * One step, before the bodies think: the way the leader is walking and how fast, every follower's
   * place written into its order, the fallen and the gone let go of, and anybody asked to stop handed
   * back once the player is far enough off. Allocates nothing.
   */
  step(dt: number, leader: Living): void {
    const p = leader.pos;
    if (!Number.isFinite(this.lastX)) {
      this.lastX = this.anchorX = p.x;
      this.lastZ = this.anchorZ = p.z;
    }
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    if (moved > FOLLOW_TUNE.jump) {
      // A jump of place (a lift, a door into a building with no way in on foot, the console): no speed
      // at all, and the heading taken afresh from the next walk.
      this.speed = 0;
      this.anchorX = p.x;
      this.anchorZ = p.z;
    } else if (dt > 0) this.speed += (moved / dt - this.speed) * (1 - Math.exp(-dt / 0.3));
    this.lastX = p.x;
    this.lastZ = p.z;
    const ax = p.x - this.anchorX;
    const az = p.z - this.anchorZ;
    if (Math.hypot(ax, az) >= FOLLOW_TUNE.turn) {
      this.heading = Math.atan2(ax, az);
      this.anchorX = p.x;
      this.anchorZ = p.z;
    }
    let removed = false;
    for (let i = this.kept.length - 1; i >= 0; i--) {
      const k = this.kept[i];
      const b = k.body;
      if (!b.dead && !b.removed) continue;
      // Fallen, or taken away by the game: no longer anybody's follower. A body killed is left to
      // whatever stood it, which stands its row again on its own clock as it always would.
      this.kept.splice(i, 1);
      b.follow = null;
      this.deps?.walkThrough?.(b, false);
      if (b.dead && !b.removed) {
        this.tally.fell++;
        this.deps?.say?.(`${b.label} has fallen`);
      }
      removed = true;
    }
    if (removed || this.kept.length) this.place();
    for (let i = this.released.length - 1; i >= 0; i--) {
      const r = this.released[i];
      const b = r.body;
      if (b.dead || b.removed) {
        this.released.splice(i, 1);
        continue;
      }
      if (Math.hypot(b.pos.x - p.x, b.pos.z - p.z) <= FOLLOW_TUNE.letGo) continue;
      this.released.splice(i, 1);
      this.tally.handedBack++;
      if (r.owner === 'adopted') this.deps?.remove(b);
    }
  }

  /** Every follower's place behind the leader, in its order, and whether to run. */
  private place(): void {
    const run = this.speed > FOLLOW_TUNE.runWith;
    for (let i = 0; i < this.kept.length; i++) {
      const o = this.kept[i].order;
      const lp = o.leader.pos;
      slotOf(i, lp.x, lp.z, this.heading, this.slot);
      o.index = i;
      o.slotX = this.slot.x;
      o.slotZ = this.slot.z;
      o.leaderX = lp.x;
      o.leaderZ = lp.z;
      o.heading = this.heading;
      o.run = run;
    }
  }

  /**
   * Something the followers should fight: whatever struck the player, or whatever the player struck.
   * Nothing on the player's own side (the player, another player, another follower), nothing dead and
   * nothing that cannot be hurt at all (part of the furniture) is ever handed on. Answers how many took it.
   */
  assist(foe: (Living & { essential?: boolean }) | null | undefined): number {
    if (!foe || foe.dead || foe.side === 'player' || foe.essential === true || !this.kept.length) return 0;
    let n = 0;
    for (const k of this.kept) {
      const b = k.body;
      if (b.dead || b.removed || b.aggression === 'passive' || (b as unknown) === foe) continue;
      b.provoke(foe);
      n++;
    }
    if (n) this.tally.assists++;
    return n;
  }

  /** Everybody asked to stop, now: what the console's dismiss and nothing else calls. Answers how many. */
  dismissAll(): number {
    let n = 0;
    while (this.kept.length) {
      if (!this.dismiss(this.kept[this.kept.length - 1].body)) break;
      n++;
    }
    return n;
  }

  /**
   * The world is going (a travel, the select screen): everybody is let go of where they stand, with
   * nothing put back, since the bodies are about to go with the world.
   */
  clear(): void {
    for (const k of this.kept) {
      k.body.follow = null;
      this.deps?.walkThrough?.(k.body, false);
    }
    this.kept.length = 0;
    this.released.length = 0;
    this.lastX = this.lastZ = this.anchorX = this.anchorZ = Number.NaN;
    this.speed = 0;
  }

  /** For the console: who follows and who is waiting to be handed back, with where each stands. */
  report(at: { x: number; z: number }): { following: Record<string, unknown>[]; released: Record<string, unknown>[] } {
    const r1 = (n: number): number => Math.round(n * 10) / 10;
    return {
      following: this.kept.map((k) => ({
        key: k.body.key,
        name: k.body.label,
        owner: k.owner,
        away: r1(Math.hypot(k.body.pos.x - at.x, k.body.pos.z - at.z)),
        slot: [r1(k.order.slotX), r1(k.order.slotZ)],
        toSlot: r1(Math.hypot(k.order.slotX - k.body.pos.x, k.order.slotZ - k.body.pos.z)),
        run: k.order.run,
        was: { side: k.was.side, aggression: k.was.aggression, essential: k.was.essential, post: k.was.post?.kind ?? null },
      })),
      released: this.released.map((r) => ({ key: r.body.key, name: r.body.label, owner: r.owner, away: r1(Math.hypot(r.body.pos.x - at.x, r.body.pos.z - at.z)) })),
    };
  }
}
