// The fights a character has, noticed for them: one open at a time, from the first blow the player lands on, or
// takes from, something that could be in a fight with them, to its close -- won, lost or broken off -- when it
// hands the host a claim (`payout.ts`) of what was fought, at what level, how it ended and which of the player's
// own skills it used. The host works out what that pays; this never decides an amount.
//
// **It never infers a member's state from blows: it looks.** A body dies in ways the player's blows never report
// -- a burn finishing it in its own step, a follower's or the companion's blow, a group member's on a body this
// browser keeps -- so four times a second every member is looked at through `look`, which the game hands in and
// which writes into a kept struct: dead, taken away, where it is, its health, whether it is still in the fight
// with the player or anybody on their side, and its temper. A kill by anybody finishes the fight like any other;
// only what the player did is logged.
//
// **What is logged is what the player did that worked**: a gun's blow logs Marksmanship, a launcher's or a
// grenade's or a charge's Demolitions, a blade's or a turned bolt's Melee, a block of a member's bolt Melee, a
// dodge Acrobatics, the Force nothing (Progression II). A blow on a body that is not in the fight (a grazing
// beast) is held, and logged only if it joins the fight. Fortitude is paid from how hard the fight was, not an
// action: half the player's whole health lost to blows inside it (never a fall, their own blast or the lava).
//
// The player, another player, a follower and the companion are never members: `who` says no for them. Members
// are held as the living things themselves, keyed by their key, so a body taken away still answers for itself.
// Every number is ours, in `ENCOUNTER_TUNE`. Pure, its own folder; the browser runs it and the server never does.

import { ENCOUNTER_POOLS, type ClaimMember, type ClaimOutcome, type EncounterClaim, type EncounterPool } from './payout.ts';

/** Every number of the encounters, ours, live through `__debug.encounter({ tune })`. */
export const ENCOUNTER_TUNE = {
  /** Seconds of simulated play with no blow by or on the player after which a fight closes. */
  calm: 15,
  /** A living member farther than this many metres when it goes quiet is out of the fight. */
  leaveRange: 60,
  /** The most members one fight holds. */
  membersMax: 24,
  /** How near a bolt must go by the middle of a rolling player to count as dodged, in metres. */
  dodgeReach: 1,
  /** How near a trainer the player must stay to learn from them, in metres. */
  teachReach: 6,
  /** 1 counts a passive creature struck as in the fight, so it pays; 0, the owner's default, does not. */
  passivePays: 0,
  /** The share of the player's whole health lost to blows that makes a fight heavy, for Fortitude. */
  heavyShare: 0.5,
  /** How many closed fights are kept for the console. */
  kept: 8,
};

const TUNE_RANGE: Record<keyof typeof ENCOUNTER_TUNE, [number, number, boolean?]> = {
  calm: [1, 600],
  leaveRange: [1, 1000],
  membersMax: [1, 100, true],
  dodgeReach: [0, 10],
  teachReach: [1, 100],
  passivePays: [0, 1, true],
  heavyShare: [0, 1],
  kept: [1, 50, true],
};

/** Move any of the numbers, each held to its range, in place. */
export function tuneEncounter(o: Partial<Record<keyof typeof ENCOUNTER_TUNE, unknown>>): typeof ENCOUNTER_TUNE {
  for (const k of Object.keys(o) as (keyof typeof ENCOUNTER_TUNE)[]) {
    const r = TUNE_RANGE[k];
    const v = o[k];
    if (!r || typeof v !== 'number' || !Number.isFinite(v)) continue;
    ENCOUNTER_TUNE[k] = Math.max(r[0], Math.min(r[1], r[2] ? Math.round(v) : v));
  }
  return ENCOUNTER_TUNE;
}

/** What a blow of the player's was struck with (`src/combat/strikeTag.ts`'s kinds), or null. */
export type StrikeKindLike = 'gun' | 'launcher' | 'demolitions' | 'melee' | 'deflect' | 'force' | null;

/** What a loss of the player's health was: a blow from something, a fall, their own blast or cloud, or the surroundings (lava, drowning, a fire's tick, a crash). */
export type HarmKindLike = 'blow' | 'fall' | 'self' | 'env';

/** What `look` writes of a member, a kept struct the game fills four times a second. */
export interface MemberLook {
  dead: boolean;
  /** Taken out of the world. */
  removed: boolean;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  /** Still in the fight: hostile to the player on sight, or fighting or holding a grudge against them or anybody on their side. */
  threat: boolean;
  /** Its temper: 'aggressive', 'defensive', 'skittish' or 'passive'. */
  temper: string;
}

/** What `who` writes of a body that may be a member. */
export interface MemberWho {
  /** The world's own name for a shared body, empty for one this browser stood alone. */
  w: string;
  /** What creature it is (`Mobile.creature`), never the body it wears. */
  npc: string;
  /** Its own creature's level, or null for none. */
  level: number | null;
}

/** What the encounters need of the game, all handed in. */
export interface EncounterPorts<T extends { readonly key: number }> {
  /** Whether a body may be a member at all, writing what it is into `out`: false for the player, another player, a follower, the companion. */
  who(t: T, out: MemberWho): boolean;
  /** A member as it is now, into `out`; false when the game knows nothing of it any more. */
  look(t: T, out: MemberLook): boolean;
  /** The shared clock, in milliseconds: when a claim closed, and its id. */
  now(): number;
  /** Seconds of simulated play (`World.simTime`): the calm's clock. */
  sim(): number;
  /** The world the fight is on, as the pack names it. */
  planet(): string;
  /** This browser's Difficulty scale. */
  diff(): number;
  /** The player's whole health, for what a heavy fight is. */
  whole(): number;
  /** A fight opened. */
  onOpen?(): void;
  /** A fight closed, with its claim and why. */
  onClose(claim: EncounterClaim, why: string): void;
  /** For a claim's id; Math.random by default. */
  random?(): number;
}

interface Member<T> {
  t: T;
  key: number;
  w: string;
  npc: string;
  level: number | null;
  fought: boolean;
  dead: boolean;
  removed: boolean;
  share: number;
  /** The pools a blow on it logged while it was not yet in the fight, as bits. */
  held: number;
  threat: boolean;
  temper: string;
  x: number;
  z: number;
}

/** A closed fight, kept for the console: its claim, why it closed, and what the host paid of it once it says. */
export interface ClosedFight {
  claim: EncounterClaim;
  why: string;
  paid?: Record<string, number>;
  payWhy?: string;
  pools?: unknown;
}

/** The pool a kind of blow logs, as a bit, or 0 for none. */
export function poolBitOf(kind: StrikeKindLike): number {
  switch (kind) {
    case 'gun':
      return bitOf('marksmanship');
    case 'launcher':
    case 'demolitions':
      return bitOf('demolitions');
    case 'melee':
    case 'deflect':
      return bitOf('melee');
    default:
      return 0;
  }
}

function bitOf(p: EncounterPool): number {
  return 1 << ENCOUNTER_POOLS.indexOf(p);
}

export class Encounters<T extends { readonly key: number }> {
  private readonly ports: EncounterPorts<T>;
  private open = false;
  private readonly members: Member<T>[] = [];
  /** The pools the player's own actions logged, as bits. */
  private logged = 0;
  /** Health lost to blows since it opened. */
  private heavyLost = 0;
  /** When the last blow by or on the player was, on the calm's clock. */
  private lastActive = 0;
  private openedAt = 0;
  /** The last few closed, newest last. */
  readonly closed: ClosedFight[] = [];
  /** How many have opened and closed this session, for the console. */
  readonly counts = { opened: 0, won: 0, lost: 0, broken: 0 };
  /** The kept structs the game's `who` and `look` write into. */
  private readonly whoOut: MemberWho = { w: '', npc: '', level: null };
  private readonly lookOut: MemberLook = { dead: false, removed: false, x: 0, z: 0, hp: 0, maxHp: 0, threat: false, temper: '' };

  constructor(ports: EncounterPorts<T>) {
    this.ports = ports;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** The member a body is, joining it to the fight (and opening one) when it may be one; null when it may not. */
  private memberOf(t: T | null | undefined): Member<T> | null {
    if (!t) return null;
    for (let i = 0; i < this.members.length; i++) if (this.members[i].key === t.key) return this.members[i];
    if (this.members.length >= ENCOUNTER_TUNE.membersMax) return null;
    const who = this.whoOut;
    who.w = '';
    who.npc = '';
    who.level = null;
    if (!this.ports.who(t, who)) return null;
    if (!this.open) {
      this.open = true;
      this.logged = 0;
      this.heavyLost = 0;
      this.openedAt = this.ports.sim();
      this.lastActive = this.openedAt;
      this.counts.opened++;
      this.ports.onOpen?.();
    }
    const m: Member<T> = { t, key: t.key, w: who.w, npc: who.npc || 'someone', level: who.level, fought: false, dead: false, removed: false, share: 1, held: 0, threat: false, temper: '', x: 0, z: 0 };
    this.members.push(m);
    this.refresh(m);
    return m;
  }

  /** In the fight: what it was logged for while it was not comes in now. */
  private fight(m: Member<T>): void {
    if (m.fought) return;
    m.fought = true;
    this.logged |= m.held;
    m.held = 0;
  }

  /** A member looked at as it is now. */
  private refresh(m: Member<T>): void {
    const out = this.lookOut;
    out.dead = false;
    out.removed = false;
    out.threat = false;
    out.temper = '';
    if (!this.ports.look(m.t, out)) {
      m.removed = true;
      return;
    }
    if (out.dead) m.dead = true;
    m.removed = out.removed;
    m.x = out.x;
    m.z = out.z;
    if (out.maxHp > 0) m.share = Math.max(0, Math.min(1, out.hp / out.maxHp));
    if (m.dead) m.share = 0;
    m.threat = out.threat;
    if (out.temper) m.temper = out.temper;
    if (out.threat || (m.temper && m.temper !== 'passive') || ENCOUNTER_TUNE.passivePays > 0) this.fight(m);
  }

  private active(): void {
    this.lastActive = this.ports.sim();
  }

  /** The player landed a blow: on what, how much, whether it finished it, and with what. */
  hit(target: T, _amount: number, killed: boolean, kind: StrikeKindLike): void {
    const m = this.memberOf(target);
    if (!m) return;
    this.active();
    if (killed) {
      m.dead = true;
      m.share = 0;
    }
    const bit = poolBitOf(kind);
    if (bit) {
      if (m.fought) this.logged |= bit;
      else m.held |= bit;
    }
  }

  /** Something struck the player (a blow, a bite, a bolt that landed): it is in the fight. */
  struckBy(source: T | null | undefined): void {
    const m = this.memberOf(source);
    if (!m) return;
    this.fight(m);
    this.active();
  }

  /** The player's blade turned a member's bolt away: it is in the fight, and Melee is logged. */
  blocked(source: T | null | undefined): void {
    const m = this.memberOf(source);
    if (!m) return;
    this.fight(m);
    this.logged |= bitOf('melee');
    this.active();
  }

  /** A roll beat a member's blow or bolt: it is in the fight, and Acrobatics is logged. */
  dodged(source: T | null | undefined): void {
    const m = this.memberOf(source);
    if (!m) return;
    this.fight(m);
    this.logged |= bitOf('acrobatics');
    this.active();
  }

  /**
   * Health the player really lost: a blow's counts toward a heavy fight and keeps it from going quiet; a fall's,
   * their own blast's and the surroundings' never do either (standing in lava through a fight buys no Fortitude).
   */
  hurt(lost: number, kind: HarmKindLike): void {
    if (!this.open || kind !== 'blow' || !(lost > 0)) return;
    this.heavyLost += lost;
    this.active();
  }

  /** A body another browser keeps was said gone by the server: dead, or taken away. The fast word; `look` sees it too. */
  gone(worldId: string, why: string): void {
    if (!this.open || !worldId) return;
    for (const m of this.members) {
      if (m.w !== worldId) continue;
      if (why === 'dead') {
        m.dead = true;
        m.share = 0;
      } else m.removed = true;
    }
  }

  /** The player died: the fight is lost. */
  died(): void {
    if (this.open) this.close('lost', 'you died');
  }

  /** The player left the world (a travel, the select screen): the fight is broken off. */
  left(): void {
    if (this.open) this.close('broken', 'you left');
  }

  /**
   * Four times a second: every member looked at, and the fight closed when it is over -- won with every member
   * dead; on the calm, won when somebody died and every member still standing is out of the fight (gone, far
   * off, or no longer after anybody), and broken off otherwise. `px`, `pz` is where the player stands.
   */
  tick(px: number, pz: number): void {
    if (!this.open) return;
    let alive = 0;
    let died = 0;
    let stillIn = 0;
    const reach2 = ENCOUNTER_TUNE.leaveRange * ENCOUNTER_TUNE.leaveRange;
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      this.refresh(m);
      if (m.dead) {
        died++;
        continue;
      }
      alive++;
      const dx = m.x - px;
      const dz = m.z - pz;
      if (!m.removed && m.threat && dx * dx + dz * dz <= reach2) stillIn++;
    }
    if (this.members.length && alive === 0) {
      this.close('won', 'everything in it is dead');
      return;
    }
    if (this.ports.sim() - this.lastActive < ENCOUNTER_TUNE.calm) return;
    if (died > 0 && stillIn === 0) this.close('won', 'it went quiet with the foes down or gone');
    else this.close('broken', died ? 'it went quiet with foes still in it' : 'it went quiet with nothing down');
  }

  private close(outcome: ClaimOutcome, why: string): void {
    const now = this.ports.now();
    const rnd = this.ports.random ?? Math.random;
    let tail = '';
    for (let i = 0; i < 4; i++) tail += Math.floor(rnd() * 36).toString(36);
    const members: ClaimMember[] = this.members.map((m) => ({ ...(m.w ? { w: m.w } : {}), npc: m.npc, level: m.level, dead: m.dead, fought: m.fought, share: Math.round(m.share * 1000) / 1000 }));
    const whole = this.ports.whole();
    const claim: EncounterClaim = {
      id: `e${Math.max(0, Math.floor(now)).toString(36)}${tail}`,
      at: now,
      outcome,
      used: ENCOUNTER_POOLS.filter((p) => this.logged & bitOf(p)),
      heavy: outcome !== 'lost' && whole > 0 && this.heavyLost >= ENCOUNTER_TUNE.heavyShare * whole,
      planet: this.ports.planet(),
      diff: this.ports.diff(),
      members,
    };
    this.open = false;
    this.members.length = 0;
    this.logged = 0;
    this.heavyLost = 0;
    this.counts[outcome]++;
    const kept: ClosedFight = { claim, why };
    this.closed.push(kept);
    while (this.closed.length > ENCOUNTER_TUNE.kept) this.closed.shift();
    this.ports.onClose(claim, why);
  }

  /** What the host made of a closed fight, kept beside it for the console. */
  notePaid(id: string, paid: Record<string, number>, why?: string, pools?: unknown): void {
    const c = this.closed.find((x) => x.claim.id === id);
    if (!c) return;
    c.paid = paid;
    if (why) c.payWhy = why;
    if (pools) c.pools = pools;
  }

  /** The open fight, for the console: its members, what is logged, how heavy, how long quiet. */
  report(): Record<string, unknown> {
    if (!this.open) return { open: false };
    const whole = this.ports.whole();
    return {
      open: true,
      seconds: Math.round((this.ports.sim() - this.openedAt) * 10) / 10,
      calm: Math.round((this.ports.sim() - this.lastActive) * 10) / 10,
      logged: ENCOUNTER_POOLS.filter((p) => this.logged & bitOf(p)),
      heavy: { lost: Math.round(this.heavyLost), of: whole, share: whole > 0 ? Math.round((this.heavyLost / whole) * 100) / 100 : 0 },
      members: this.members.map((m) => ({ npc: m.npc, w: m.w || null, level: m.level, fought: m.fought, dead: m.dead, removed: m.removed, threat: m.threat, temper: m.temper, share: Math.round(m.share * 100) / 100, held: ENCOUNTER_POOLS.filter((p) => m.held & bitOf(p)) })),
    };
  }

  /** Every member's creature and level, for the console's band column; empty with no fight open. */
  memberLevels(): { npc: string; level: number | null }[] {
    return this.members.map((m) => ({ npc: m.npc, level: m.level }));
  }
}
