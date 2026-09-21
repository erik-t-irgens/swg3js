// Going where the group goes: a leader who crosses to another world -- up to space, down to a
// planet, across the galaxy map or through a hyperspace jump -- offers the rest of the group the
// same trip, and whoever takes it comes out beside them rather than at whatever spawn their own
// world happens to hand them.
//
// The offer itself is the group's (`src/net/groups.ts` sends `trip` and `travel`, the server holds
// it in `server/groups.mjs`, and the panel that asks is `src/ui/groupUi.ts`): nobody is moved
// without saying yes, and an offer lapses on its own. What is here is the other half -- what a trip
// means, which crossing each browser has to make to keep it, and where exactly to come out.
//
// Where to come out is the one thing the offer alone cannot give. A leader flying up to space does
// not know where they will be until they are there, and a member on another planet is not sent that
// player's position at all (`state` goes to the world they are on and no further). So there is one
// more word, `cross`, which goes to the group and only to the group: "I am on my way to this world"
// as the crossing begins, and "I came out here" when it ends. A member taking the trip up waits a
// few seconds under their own loading screen for that second word and stands where it says, a fixed
// distance to one side so that two ships do not arrive inside each other.
//
// Four rules shape this file, the same four the rest of the net side keeps to. Nothing here touches
// the document, three.js or the socket, so a node test runs it as it is. Nothing here runs in a
// frame: every one of these is an event, and the only clock is one bounded wait per crossing.
// Nothing is decided here that the server holds -- who is in the group, who leads it and whether an
// offer still stands are all answered there, and this side asks the session, never the socket, so
// with no address set (or against the relay that came before) `active` is false, not one word goes
// out and the game is exactly what it is today. And everything that arrives is data: a number is
// checked finite before it is used, a world is a name that is looked up and not trusted, and
// nothing that arrives is allowed to throw in the middle of a message.

import type { Authority } from './session.ts';

/**
 * The words this module answers. The socket (`src/net/net.ts`) hands a word over rather than reading
 * it, so this list and the one in its switch have to agree: missing there, the word never arrives
 * and a group lands scattered with nothing to say why.
 */
export const CROSS_WORDS = ['cross'] as const;

/** Where a trip goes, as the group's offer carries it. */
export interface TripWhere {
  planet: string;
  zone: string;
  /** 'space', 'ground', 'jump' or 'travel': what kind of crossing the leader made. */
  how: string;
  /** Where the leader means to come out, in that world's own metres, or null when it is not known yet. */
  at: number[] | null;
}

/** What this browser is doing now, as the game answers it when a trip is taken up. */
export interface HereNow {
  planet: string;
  zone: string;
  /** This world is a space zone. */
  inSpace: boolean;
  /** A ship is being flown from its seat or its bridge. */
  flying: boolean;
  /** Standing in a hull somebody else flies: theirs to carry, not ours to fly off in. */
  aboardOther: boolean;
  /** A travel, a jump or the loading screen is already under way. */
  busy: boolean;
}

/** What this browser has to do to keep the trip. `stay` is the answer with a reason to show. */
export interface TogetherMove {
  do: 'jump' | 'travel' | 'stay';
  planet: string;
  zone: string;
  /** Carry the ship being flown across, rather than crossing on foot. */
  withShip: boolean;
  /** Where to come out, this browser's own place in the line already in it; null: wherever the world puts us. */
  at: number[] | null;
  /** Why nothing is happening, for the message line; empty when something is. */
  why: string;
}

/**
 * Every number this side invents, in one place and live: `__debug.together({ spreadSpace: 300 })`
 * sets one and the next trip obeys it. None of them is from the game -- the game's own numbers in
 * this area are the group's ranges, which are `GROUP_RANGE`'s and are read out of the client's
 * radial menu table.
 */
export const TOGETHER_TUNE = {
  /**
   * Invented: how far to one side of the leader a member comes out in space, in metres. Ships are
   * tens of metres long and arrive facing the same way, so this is far enough not to arrive inside
   * one another and near enough that the group is plainly together on the screen.
   */
  spreadSpace: 150,
  /** Invented: the same on the ground, in metres, where everyone is a metre wide and on foot. */
  spreadGround: 6,
  /**
   * Invented: how many places there are in the ring round the leader. A group holds eight, so eight
   * places puts every member somewhere of their own; past that the ring widens rather than doubling
   * anybody up.
   */
  slots: 8,
  /**
   * Invented: how long a member waits, in milliseconds, for the leader's "I came out here" before
   * giving up and arriving where their own world would have put them. The wait is under the loading
   * screen, which is up for several seconds anyway, so it usually costs nothing at all; it is
   * bounded so that a leader whose line dropped mid-crossing cannot hold anybody on a black screen.
   */
  waitMs: 8000,
  /**
   * Invented: how long a place somebody reported is worth standing beside, in milliseconds. Past
   * this they have had time to fly somewhere else entirely and the point is a lie.
   */
  keepMs: 120000,
  /** Invented: how many members' places to remember at once. A group holds eight; this is that with room. */
  places: 12,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneTogether(o: Partial<typeof TOGETHER_TUNE>): typeof TOGETHER_TUNE {
  if (typeof o.spreadSpace === 'number') TOGETHER_TUNE.spreadSpace = Math.max(0, Math.min(10000, o.spreadSpace));
  if (typeof o.spreadGround === 'number') TOGETHER_TUNE.spreadGround = Math.max(0, Math.min(500, o.spreadGround));
  if (typeof o.slots === 'number') TOGETHER_TUNE.slots = Math.max(1, Math.min(64, Math.round(o.slots)));
  if (typeof o.waitMs === 'number') TOGETHER_TUNE.waitMs = Math.max(0, Math.min(60000, Math.round(o.waitMs)));
  if (typeof o.keepMs === 'number') TOGETHER_TUNE.keepMs = Math.max(1000, Math.min(3600000, Math.round(o.keepMs)));
  if (typeof o.places === 'number') TOGETHER_TUNE.places = Math.max(1, Math.min(64, Math.round(o.places)));
  return TOGETHER_TUNE;
}

/**
 * The place in the ring a member id takes. The ids a group mints are `m1`, `m2` and so on in the
 * order people joined, so the number in the id is the place: everybody gets one of their own
 * without anybody being told which, and it does not move when somebody else joins or leaves. An id
 * shaped any other way (a server on another build) falls back on the characters in it, which is
 * stable for the same reason and only risks two members sharing a place.
 *
 * It is never 0, and an id nobody has yet (a roster that has not come) is 1 rather than nothing: a
 * place of 0 is the middle, which is exactly where whoever is being followed is standing, and
 * arriving inside them is the one thing the ring exists to prevent.
 */
export function slotOf(mid: string): number {
  const id = mid ?? '';
  const digits = /^m([0-9]{1,4})$/.exec(id);
  if (digits) return Math.max(1, Number(digits[1]));
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return (n % 1000) + 1;
}

/**
 * How far to one side of the leader that place stands, as an offset in the world's own metres.
 * A ring in the ground plane: nothing is moved up or down, because in space that would put a
 * member under the leader's belly and on a planet it would put them under the ground. Place 0 is
 * the middle, which is where whoever is being followed is standing and so is nobody's place: the
 * ids a group mints start at 1 and `slotOf` never answers 0. Past a ring's worth of places the
 * next ring is half as far again out, so two members can only ever share a spot if a group
 * outlives sixteen joinings.
 */
export function spreadOffset(slot: number, spread: number, out: number[] = [0, 0, 0]): number[] {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  if (!Number.isFinite(slot) || slot <= 0 || !(spread > 0)) return out;
  const slots = Math.max(1, TOGETHER_TUNE.slots);
  const index = Math.floor(slot) - 1;
  const ring = Math.floor(index / slots);
  const angle = ((index % slots) / slots) * Math.PI * 2;
  const radius = spread * (1 + ring * 0.5);
  out[0] = Math.cos(angle) * radius;
  out[2] = Math.sin(angle) * radius;
  return out;
}

/**
 * What a member has to do to keep a trip the leader offered, given where they are standing when
 * they say yes. Pure, so the node test can walk every case without a world.
 *
 * - already there, and it was not a jump: nothing to do;
 * - a jump, in space, flying, and the world jumped to is a system: jump after them, which is the
 *   only way that keeps the hull, its rooms and whoever is walking them;
 * - anything else: cross the ordinary way, carrying the ship being flown when there is one.
 *
 * Standing in somebody else's hull is a refusal and not a crossing: that hull is theirs to take
 * anywhere, and a passenger who travelled by themselves would step out of a ship that is still
 * where it was. Nothing carries them across either -- a crossing is this browser's own, and the
 * hull they are standing in belongs to a browser that is not making it -- so what they are told is
 * to step out, and the offer is left standing for them to take once they have.
 */
export function planCrossing(where: TripWhere, here: HereNow, spaceThere: boolean): TogetherMove {
  const planet = where.planet ?? '';
  const zone = where.zone ?? '';
  const move: TogetherMove = { do: 'stay', planet, zone, withShip: false, at: where.at, why: '' };
  if (!planet) {
    move.why = 'the group named nowhere to go';
    return move;
  }
  if (here.busy) {
    move.why = 'already on the way somewhere';
    return move;
  }
  if (here.aboardOther) {
    move.why = "step out of their ship first: a crossing does not carry you out of somebody else's rooms";
    return move;
  }
  const jumpable = where.how === 'jump' && here.inSpace && here.flying && spaceThere;
  if (planet === here.planet && zone === (here.zone ?? '')) {
    if (!jumpable) {
      move.why = 'you are already there';
      return move;
    }
    move.do = 'jump';
    move.withShip = true;
    return move;
  }
  if (jumpable) {
    move.do = 'jump';
    move.withShip = true;
    return move;
  }
  move.do = 'travel';
  move.withShip = here.flying;
  return move;
}

/** A place somebody reported, and when they reported it. */
interface Place {
  planet: string;
  zone: string;
  at: number[];
  when: number;
  phase: string;
}

/** The trip this browser said yes to and has not finished. */
interface Following {
  planet: string;
  zone: string;
  at: number[] | null;
  /** When the wait for somebody's place gives up. */
  until: number;
  /** When the trip itself is no longer worth holding, for a crossing that never arrived anywhere. */
  expires: number;
}

export interface TogetherStats {
  active: boolean;
  /** The world this browser is crossing to with the group, or empty. */
  following: string;
  places: number;
  offered: number;
  taken: number;
  sent: number;
  heard: number;
  /** Why the last trip taken up did nothing, when it did nothing. */
  lastWhy: string;
  /** The last world this browser told the group it was crossing to, and the point on it when it named one. */
  lastTrip: string;
  /** How long the last crossing waited for the leader's place, in milliseconds, and whether it came. */
  waited: number;
  hadPlace: boolean;
}

/**
 * One of these is made once and lives for the page. Everything it is told comes through `handle`,
 * everything it asks for goes out through `send`, and what a crossing actually is belongs to the
 * game and reaches here as `onGo`.
 */
export class TravelTogether {
  /** Something to send: the socket puts it on the wire. */
  send: (msg: Record<string, unknown>) => void = () => {};
  /** Who decides: with no server this answers 'me' and the whole module stays quiet. */
  authority: () => Authority = () => 'me';
  /** Something the player should read. */
  note: (text: string) => void = () => {};
  /** The shared clock, in milliseconds: the same one the group's countdowns are measured against. */
  now: () => number = () => Date.now();

  /** Offer the group a trip (the group module's own `offerTrip`, which is refused unless we lead). */
  offerTrip: (where: { planet: string; zone?: string; how?: string; at?: number[] }) => void = () => {};
  /** Whether this browser leads the group it is in. */
  leading: () => boolean = () => false;
  /** How many members there are besides this one. */
  others: () => number = () => 0;
  /** This browser's own member id in the group, which is its place in the ring. */
  myMid: () => string = () => '';
  /** The connection the leader is on, so their word about where they came out is preferred to anyone's. */
  leaderId: () => number = () => 0;
  /** Whether a world id names a space zone. */
  isSpace: (planet: string) => boolean = () => false;
  /**
   * Whether a connection is still in this group. A place is only worth standing beside while
   * whoever reported it is somebody this browser is travelling with: a member who left, or a group
   * that disbanded, would otherwise go on being followed for as long as a place is kept.
   */
  inGroup: (id: number) => boolean = () => true;
  /** Where this browser is and what it is doing, asked when a trip is taken up. */
  here: () => HereNow = () => ({ planet: '', zone: '', inSpace: false, flying: false, aboardOther: false, busy: true });
  /** Make the crossing this trip needs. The game owns what that means. */
  onGo: (move: TogetherMove) => void = () => {};

  /** Where each member last said they were, by the connection they said it on. */
  private readonly places = new Map<number, Place>();
  private following: Following | null = null;
  /** Whoever is waiting on the leader's place, and the timer that gives up on it. */
  private waiting: ((at: number[] | null) => void) | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private waitFrom = 0;
  private readonly stat: TogetherStats = { active: false, following: '', places: 0, offered: 0, taken: 0, sent: 0, heard: 0, lastWhy: '', lastTrip: '', waited: 0, hadPlace: false };
  private readonly offset = [0, 0, 0];

  /** Whether there is a server holding a world. With none, nothing is sent and nothing is offered. */
  get active(): boolean {
    return this.authority() === 'server';
  }

  /**
   * Whether a crossing beginning here is anybody's business: a server, and somebody else in the
   * group. Asked before anything is worked out for the sake of the word, since a player on their
   * own crosses worlds all evening and must pay nothing at all for it.
   */
  get telling(): boolean {
    return this.active && this.others() > 0;
  }

  /** What it is doing, for `__debug.together()`. The same object between calls: nothing is allocated to read it. */
  debug(): TogetherStats {
    this.stat.active = this.active;
    this.stat.following = this.following ? worldName(this.following.planet, this.following.zone) : '';
    this.stat.places = this.places.size;
    return this.stat;
  }

  /** The trip being offered to this browser now, if any, is the group's; this is only what it does with one. */
  get followingNow(): { planet: string; zone: string } | null {
    return this.following ? { planet: this.following.planet, zone: this.following.zone } : null;
  }

  /**
   * A crossing has begun here. Leading a group, that is an offer to everyone else: the same trip,
   * with the same countdown an invitation has. Either way the group is told that this browser is
   * on its way, which is what makes the place it last reported stale: a member reading it throws
   * away whatever this one said about where it was standing, so that the next trip to a world
   * somebody has already been to is never followed to where they were the time before.
   */
  leaving(planet: string, zone: string, how: string, at: number[] | null = null): void {
    // Nobody to tell: a player on their own crosses worlds several times an evening and none of it
    // is anybody's business, so not a byte goes out.
    if (!this.active || !planet || this.others() <= 0) return;
    const point = goodPoint(at);
    this.stat.lastTrip = `${worldName(planet, zone)}${point ? ` at ${point.map((v) => Math.round(v)).join(', ')}` : ''}`;
    if (this.leading()) {
      this.stat.offered++;
      this.offerTrip({ planet, zone, how, ...(point ? { at: point } : {}) });
    }
    this.post({ t: 'cross', phase: 'going', planet, zone, how, ...(point ? { at: point } : {}) });
  }

  /**
   * The crossing is over and this is where it came out. It goes to the group and only to the group,
   * because a member still on another world is sent nothing else that would say.
   *
   * A crossing that has finished ends the trip this browser was following, whatever world it came
   * out on: it went where it was going or it went somewhere else, and either way there is nothing
   * left to follow. Left standing, a trip would match the next crossing to that world and put
   * somebody beside a place the group left minutes ago.
   */
  arrived(planet: string, zone: string, at: number[] | null): void {
    this.stopFollowing();
    if (!this.active || !planet || this.others() <= 0) return;
    const point = goodPoint(at);
    this.post({ t: 'cross', phase: 'here', planet, zone, how: 'travel', ...(point ? { at: point } : {}) });
  }

  /**
   * What taking that trip up would do, asked before saying yes rather than after. The server counts
   * an acceptance once and for all -- a second yes is refused -- so a member who said yes while a
   * loading screen was still up, or while standing in a friend's cabin, would be locked out of a
   * trip that is still standing for everybody else. Nothing is changed by asking.
   */
  canTake(where: TripWhere): TogetherMove {
    return planCrossing(where, this.here(), this.isSpace(where.planet));
  }

  /**
   * The server says this browser took the offer up. What that means is worked out from where this
   * browser is standing; a trip that cannot be kept says why and moves nobody.
   */
  take(where: TripWhere): TogetherMove {
    this.stat.taken++;
    const move = planCrossing(where, this.here(), this.isSpace(where.planet));
    this.stat.lastWhy = move.why;
    if (move.do === 'stay') {
      if (move.why) this.note(move.why);
      return move;
    }
    // A jump is aimed now, at the point the offer named (the leader's own arrival), because the
    // whole of a jump is decided before it starts. An ordinary crossing asks again for the freshest
    // place under its own loading screen, where there is time to wait for one.
    //
    // The offer's own point belongs to this trip and is preferred to any place remembered: a jump
    // names where it ends before it starts, while a place is a memory of a crossing that has
    // already happened and, for a group going back where it has been, is the last one's.
    const best = goodPoint(where.at) ?? this.pointFor(where.planet, where.zone);
    if (move.do === 'jump') {
      move.at = best ? this.beside(best, true) : null;
      this.stopFollowing();
      if (!move.at) {
        move.do = 'stay';
        move.why = 'there is nowhere to come out: nobody has said where they are';
        this.stat.lastWhy = move.why;
        this.note(move.why);
        return move;
      }
    } else {
      move.at = null;
      this.following = { planet: where.planet, zone: where.zone ?? '', at: best, until: this.now() + TOGETHER_TUNE.waitMs, expires: this.now() + TOGETHER_TUNE.keepMs };
    }
    this.onGo(move);
    return move;
  }

  /**
   * Where to come out on the world now being loaded, this browser's own place in the ring already
   * in it, or null when this crossing is nobody's trip but its own. It waits for the leader's word
   * for as long as `waitMs` allows, which costs nothing while the loading screen is up anyway.
   */
  async followPoint(planet: string, zone: string, inSpace: boolean): Promise<number[] | null> {
    // A trip nobody ever arrived from is dropped rather than kept: `arrived` ends a trip whose
    // crossing finished, and this is the other end of it, so that a crossing which never got there
    // cannot leave a trip lying for a later one to take for its own.
    if (this.following && this.following.expires <= this.now()) this.stopFollowing();
    const f = this.following;
    if (!f || f.planet !== planet || (f.zone ?? '') !== (zone ?? '')) return null;
    const known = this.pointFor(planet, zone);
    if (known) {
      this.stat.waited = 0;
      this.stat.hadPlace = true;
      return this.beside(known, inSpace);
    }
    const at = await this.waitForPlace(f);
    if (!at) {
      // `hadPlace` is whether anybody said where they came out, which is what the wait is for; the
      // offer's own point is not that, even though it is what is used in its place.
      this.stat.hadPlace = false;
      // Nothing came: the point the offer named is better than nothing, and often it is the same
      // point, since a jump names where it will end before it starts.
      return f.at ? this.beside(f.at, inSpace) : null;
    }
    this.stat.hadPlace = true;
    return this.beside(at, inSpace);
  }

  /**
   * One message from the far end. True when it was one of ours, so the socket's own switch can go
   * on ignoring everything it does not know.
   */
  handle(msg: Record<string, unknown>): boolean {
    if (!msg || msg.t !== 'cross') return false;
    this.stat.heard++;
    const id = Number(msg.id) || 0;
    const planet = text(msg.planet, 24);
    if (!id || !planet) return true;
    const phase = text(msg.phase, 8) || 'here';
    // Somebody on their way somewhere is not anywhere: whatever they last said about where they
    // came out was true of a crossing that is now over, and following it would take this browser to
    // where that member was the trip before. So the word that begins a crossing throws their place
    // away, and only the word that ends one puts a new place in its stead. This is what keeps a
    // group going back to a world it has already been to from arriving at the old point.
    if (phase !== 'here') {
      this.places.delete(id);
      return true;
    }
    const at = goodPoint(msg.at);
    if (!at) return true;
    const place: Place = { planet, zone: text(msg.zone, 24), at, when: this.now(), phase };
    this.places.set(id, place);
    this.forgetOld();
    const f = this.following;
    if (this.waiting && f && place.planet === f.planet && (place.zone ?? '') === (f.zone ?? '')) {
      const best = this.pointFor(f.planet, f.zone);
      if (best) this.settleWait(best);
    }
    return true;
  }

  /** The line dropped, or the player went to the select screen: nothing that was known still is. */
  clear(): void {
    this.places.clear();
    this.stopFollowing();
  }

  // ---- the pieces the above is made of -------------------------------------------------------------

  private post(msg: Record<string, unknown>): void {
    this.stat.sent++;
    this.send(msg);
  }

  /**
   * The freshest place reported on that world, the leader's preferred to anybody's. Only somebody
   * still in the group counts: a member who left, or a group that has gone, keeps a place in the
   * map until it ages out, and standing beside a stranger is not what any of this is for.
   */
  private pointFor(planet: string, zone: string): number[] | null {
    const want = zone ?? '';
    const leaderId = this.leaderId();
    const leader = this.places.get(leaderId);
    const now = this.now();
    if (leader && leader.planet === planet && (leader.zone ?? '') === want && now - leader.when <= TOGETHER_TUNE.keepMs && this.stillWith(leaderId)) return leader.at;
    let best: Place | null = null;
    for (const [id, place] of this.places) {
      if (place.planet !== planet || (place.zone ?? '') !== want) continue;
      if (now - place.when > TOGETHER_TUNE.keepMs) continue;
      if (!this.stillWith(id)) continue;
      if (!best || place.when > best.when) best = place;
    }
    return best ? best.at : null;
  }

  /** Whether that connection is somebody this browser is still travelling with; a hook that throws is not one. */
  private stillWith(id: number): boolean {
    try {
      return this.inGroup(id);
    } catch {
      return false;
    }
  }

  /** That place with this browser's own step to one side of it. A fresh array: one per crossing. */
  private beside(at: number[], inSpace: boolean): number[] {
    spreadOffset(slotOf(this.myMid()), inSpace ? TOGETHER_TUNE.spreadSpace : TOGETHER_TUNE.spreadGround, this.offset);
    return [at[0] + this.offset[0], at[1] + this.offset[1], at[2] + this.offset[2]];
  }

  private waitForPlace(f: Following): Promise<number[] | null> {
    const left = Math.max(0, Math.min(TOGETHER_TUNE.waitMs, f.until - this.now()));
    if (!left) return Promise.resolve(null);
    this.settleWait(null);
    this.waitFrom = this.now();
    return new Promise<number[] | null>((resolve) => {
      this.waiting = resolve;
      this.waitTimer = setTimeout(() => this.settleWait(null), left);
    });
  }

  /** Whoever is waiting is answered once, the timer dropped, and how long it took recorded. */
  private settleWait(at: number[] | null): void {
    if (this.waitTimer !== null) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    const resolve = this.waiting;
    this.waiting = null;
    if (!resolve) return;
    this.stat.waited = Math.max(0, Math.round(this.now() - this.waitFrom));
    resolve(at);
  }

  private stopFollowing(): void {
    this.following = null;
    this.settleWait(null);
  }

  /** The oldest places go when there are more than there is room for, so nothing grows without bound. */
  private forgetOld(): void {
    while (this.places.size > TOGETHER_TUNE.places) {
      let oldest = 0;
      let when = Infinity;
      for (const [id, place] of this.places) {
        if (place.when < when) {
          when = place.when;
          oldest = id;
        }
      }
      if (!oldest) return;
      this.places.delete(oldest);
    }
  }
}

/** Three finite numbers, or null. Everything that arrives is a stranger's until it has been read. */
function goodPoint(x: unknown): number[] | null {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const at = [Number(x[0]), Number(x[1]), Number(x[2])];
  return at.every((v) => Number.isFinite(v)) ? at : null;
}

/**
 * A word from the far end: never anything but a short string. The set taken out is the one the rest
 * of the net side takes out (`cleanText` in `src/net/groups.ts`) -- the control characters, and the
 * bidirectional overrides and isolates, which reverse the rest of the line they land in.
 */
function text(x: unknown, cap: number): string {
  return typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, cap) : '';
}

function worldName(planet: string, zone: string): string {
  return zone ? `${planet}:${zone}` : planet;
}
