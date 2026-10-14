// What a fight and a roll pay, as the record's own changes: worked out by whoever holds the record (this browser
// alone, or a server, which runs this very file and checks a claim's deaths against its own word of them), never
// by the thing that says what happened. A claim says what was fought, at what level, how it ended and which of the player's skills it used;
// the amount is this file's arithmetic, every number of it `PROGRESS_RULES`'s and ours. Pure, its own folder.
//
// **A won fight pays every skill it used the fight's whole worth.** The worth is each member that fought and
// died, `base` times its band on the challenge table against the character's challenge level (a body with no
// level counts as the character's own, which is white), summed and held to `encounterCap`; a fight against the
// same creature again and again pays less each time (`drStep` a repeat within `drWindow`, down to `drFloor`), a
// first win over a creature or on a planet pays more (`novelty`), a world turned soft never pays more than it
// would at the data's own numbers (`diff` held to one), and every pool is held to a bucket of `perMinute`.
// Fortitude is paid only for a fight that took half the player's health in blows (`heavy`), won or broken; a
// lost fight pays a tenth when the foes were down to a quarter; a broken one pays Fortitude alone.
//
// **Everything paid once, keyed before it is paid.** A claim's id goes into `paid` first in the batch, ahead of
// the XP it pays, so the same claim handed in twice -- a resend, a reload, a second host -- finds its key and
// pays nothing; and a claim older than `claimMaxAge` pays nothing at all, so a key can be dropped once it is that
// old without opening the door to paying it again. **A trim is a change**: a list at its limit has its oldest
// entry dropped by a change written into the same batch before the one that adds, so a host applying another's
// batch under the backstop arrives at the same record whatever their limits.
//
// The rested bonus is worked out of the record alone (`last`, `rested`) and the host's own clock, so it needs no
// word of its own: back after `restedAfter` away, a character banks `restedPerHour` an hour up to `restedMax`,
// and every claim's pay gains as much again until it is spent.

import { BUILT_CORE, ratingOf, xpCap } from './core.ts';
import { bandOf, challengeOf, CON_LEVELS, type ConTable } from './challenge.ts';
import { LOG_SOURCES, applyProgress, copyRecord, fnv32, isCoreSkill, secondsOf, spSpent, trimFor, type CoreSkill, type Pool, type ProgressChange, type ProgressRecord, type TrimList } from './record.ts';
import { PROGRESS_LIMITS, PROGRESS_RULES, type ProgressLimits, type ProgressRules } from './tune.ts';

/** The skills a fight's own actions can log (`encounter.ts`): Fortitude is paid from how hard it was, not from an action. */
export type EncounterPool = 'marksmanship' | 'melee' | 'demolitions' | 'acrobatics';
export const ENCOUNTER_POOLS: readonly EncounterPool[] = ['marksmanship', 'melee', 'demolitions', 'acrobatics'];

export type ClaimOutcome = 'won' | 'lost' | 'broken';

/** One of a fight's members, as the claim names it. */
export interface ClaimMember {
  /** The world's own name for a shared body (`Mobile.npcId`), left out for one this browser stood alone. */
  w?: string;
  /** What it is: its row's own creature, never the body it wears nor its world name (`Mobile.creature`). */
  npc: string;
  level: number | null;
  dead: boolean;
  /** It was in the fight: it struck, it was hostile, it fought back, or its temper is anything but passive. */
  fought: boolean;
  /** Its health left over its whole, 0 to 1. */
  share: number;
}

/** A fight closed, as the browser that saw it says it: what happened and what was used, never an amount. */
export interface EncounterClaim {
  /** `e` + base 36 of the shared clock's milliseconds + four random base 36: one per fight, the same on a resend. */
  id: string;
  /** The shared clock, in milliseconds, when it closed. */
  at: number;
  outcome: ClaimOutcome;
  used: EncounterPool[];
  /** The player lost at least half their whole health to blows in it, and lived. */
  heavy: boolean;
  planet: string;
  /** This browser's Difficulty scale; a host pays it held to one. */
  diff: number;
  members: ClaimMember[];
}

/** A landing roll that saved some of a fall: how far the fall was and how much health the roll kept. */
export interface ProgressTask {
  id: string;
  at: number;
  kind: 'roll';
  /** Metres. */
  fell: number;
  /** Health the roll took off the fall. */
  saved: number;
}

/**
 * How fast each pool may fill, a token bucket a pool and a character: `perMinute` a minute, at most `bucketMax`
 * held, full the first time it is asked. Kept by the host in memory and never in the record, by character so a
 * reconnect does not fill it again.
 */
export class XpBuckets {
  private readonly held = new Map<string, { left: number; at: number }>();

  /** What of `want` this pool may have now (whole), taken from its bucket. */
  take(char: string, pool: string, want: number, now: number, rules: ProgressRules = PROGRESS_RULES): number {
    if (!(want > 0)) return 0;
    const key = `${char}|${pool}`;
    let b = this.held.get(key);
    if (!b) {
      b = { left: rules.bucketMax, at: now };
      this.held.set(key, b);
    }
    b.left = Math.min(rules.bucketMax, b.left + (Math.max(0, now - b.at) * rules.perMinute) / 60);
    b.at = now;
    const got = Math.max(0, Math.min(Math.round(want), Math.floor(b.left)));
    b.left -= got;
    return got;
  }

  /** Forget a character's, or everybody's (a reload empties them anyway). */
  clear(char?: string): void {
    if (char === undefined) this.held.clear();
    else for (const k of [...this.held.keys()]) if (k.startsWith(`${char}|`)) this.held.delete(k);
  }

  report(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, b] of this.held) out[k] = Math.floor(b.left);
    return out;
  }
}

/** What a host pays by: its clock, the game's table, its rules and limits, its buckets, and a server's witness. */
export interface PayCtx {
  /** The shared clock, in milliseconds. */
  now: number;
  levels: ConTable | null;
  rules?: ProgressRules;
  limits?: ProgressLimits;
  bucket: XpBuckets | null;
  /**
   * The server's: whether it believes a member the claim names by its world name (`w`) died -- one of the world's
   * shared bodies on the server's own word of its death, and a name it does not share against the character's own
   * rate, as `localKill`. Absent, every claim is taken at its word (this browser holding the record alone).
   */
  witness?(w: string): boolean;
  /** The server's: a dead member nobody shares, counted against the character's own rate; false once that is spent. */
  localKill?(): boolean;
}

/** One pool's part of a payout, for the console: its worth, what it was paid, and why it was not paid more. */
export interface PoolPaid {
  pool: CoreSkill | Pool;
  challenge: number;
  worth: number;
  paid: number;
  rested: number;
  why?: string;
}

export interface PayResult {
  ch: ProgressChange[];
  /** What each pool was paid, whole. */
  paid: Partial<Record<CoreSkill | Pool, number>>;
  /** Why nothing was paid, when nothing was. */
  why?: string;
  /** Each pool's working, for `__debug.encounter`. */
  pools?: PoolPaid[];
  novelty?: number;
}

/** Changes worked out on a draft of the record, each applied to it as it is written, so a trim is decided against the list as it stands. */
class Batch {
  readonly ch: ProgressChange[] = [];
  readonly draft: ProgressRecord;
  private readonly limits: ProgressLimits;

  constructor(rec: ProgressRecord, limits: ProgressLimits) {
    this.draft = copyRecord(rec);
    this.limits = limits;
  }

  /** Write a change, when the draft takes it. */
  add(c: ProgressChange): boolean {
    const out = applyProgress(this.draft, [c], this.limits);
    if (!out.changed) return false;
    this.ch.push(c);
    return true;
  }

  /** Make room in a list for one more, oldest first; false when room cannot be made. */
  room(list: TrimList, keepFrom = Infinity): boolean {
    const drops = trimFor(this.draft, list, this.limits, keepFrom);
    if (!drops) return false;
    for (const d of drops) this.add(d);
    return true;
  }
}

/** A key a list holds in `recent`: when it was last met and how many times in a row. */
function recentOf(rec: ProgressRecord, key: string): [number, number] | null {
  return rec.recent && Object.hasOwn(rec.recent, key) ? rec.recent[key] : null;
}

/**
 * The diminishing-returns factor of a key at `now`, and the repeat count to write: a key met within `drWindow`
 * of its last pays `drStep` to the power of how many times in a row it has been met, down to `drFloor`.
 */
export function drFactor(rec: ProgressRecord, key: string, now: number, rules: ProgressRules = PROGRESS_RULES): { factor: number; n: number } {
  const r = recentOf(rec, key);
  if (r && now - r[0] <= rules.drWindow) return { factor: Math.max(rules.drFloor, Math.pow(rules.drStep, r[1])), n: r[1] + 1 };
  return { factor: 1, n: 1 };
}

/** The challenge a pool is paid against: the character's own (Skill Points spent), or a core skill's own rating with `coreChallenge` 1. */
export function challengeFor(rec: ProgressRecord, pool: CoreSkill | Pool, rules: ProgressRules = PROGRESS_RULES): number {
  if (rules.coreChallenge === 1 && isCoreSkill(pool)) {
    const r = ratingOf(rec.core?.[pool] ?? 0, rules);
    return Math.max(1, Math.min(CON_LEVELS, Math.round(1 + (r * 89) / 100)));
  }
  return challengeOf(spSpent(rec));
}

/** What one member is worth against a challenge: `base` times its band. A body with no level counts as the challenge itself, white. */
export function memberWorth(level: number | null, challenge: number, levels: ConTable | null, rules: ProgressRules = PROGRESS_RULES): number {
  const band = bandOf(level === null ? null : level, challenge, levels, rules);
  return rules.base * rules.band[band];
}

/** Write a pool's gain into its log row: the row a payout to it within `logMerge` began, or a new one. */
function logGain(b: Batch, src: number, gain: number, now: number, rules: ProgressRules): void {
  if (gain <= 0 || src < 0) return;
  const log = b.draft.log ?? [];
  let row: [number, number, number, number] | null = null;
  for (const r of log) if (r[2] === src && now - r[0] <= rules.logMerge && (!row || r[0] > row[0])) row = r;
  if (row) {
    b.add({ k: 'logRow', row: [row[0], Math.max(row[1], now), src, row[3] + gain] });
    return;
  }
  if (!b.room('log')) return;
  b.add({ k: 'logRow', row: [now, now, src, gain] });
}

/**
 * Put a gain into a core skill or a pool, each held to its cap; answers what really went in. Never less than it
 * was: a record another host paid to a higher cap of its own (a server's `--set`) is kept as it stands, not cut to
 * this host's cap by a payout.
 */
function gainInto(b: Batch, pool: CoreSkill | Pool, add: number, rules: ProgressRules): number {
  if (add <= 0) return 0;
  const rec = b.draft;
  if (isCoreSkill(pool)) {
    const was = rec.core[pool] ?? 0;
    const now = Math.max(was, Math.min(xpCap(rules), was + add));
    if (now !== was) b.add({ k: 'core', skill: pool, xp: now });
    return now - was;
  }
  const was = rec.pools[pool] ?? 0;
  const now = Math.max(was, Math.min(rules.bankCap, was + add));
  if (now === was) return 0;
  b.add({ k: 'pool', pool, xp: now });
  b.add({ k: 'earned', pool, xp: (rec.earned?.[pool] ?? 0) + (now - was) });
  return now - was;
}

/** The pool a fight's skill pays into: the four core skills are core skills, Demolitions its discipline's pool. */
function poolOf(p: EncounterPool): CoreSkill | Pool {
  return p;
}

/**
 * A closed fight's payout, as a batch of the record's changes, worked out against the record as it stands. A
 * claim already paid, too old, or that pays nothing writes nothing at all.
 */
export function payClaim(rec: ProgressRecord, claim: EncounterClaim, ctx: PayCtx): PayResult {
  const rules = ctx.rules ?? PROGRESS_RULES;
  const limits = ctx.limits ?? PROGRESS_LIMITS;
  const now = secondsOf(ctx.now);
  if (rec.paid && Object.hasOwn(rec.paid, claim.id)) return { ch: [], paid: {}, why: 'that fight is paid already' };
  if (now - secondsOf(claim.at) > rules.claimMaxAge) return { ch: [], paid: {}, why: 'that fight is too long ago to pay' };
  const b = new Batch(rec, limits);
  // The key first, ahead of everything it pays; never a payment younger than the claims' longest age dropped for it.
  if (!b.room('paid', now - rules.claimMaxAge)) return { ch: [], paid: {}, why: 'too many fights at once' };
  if (!b.add({ k: 'paid', key: claim.id, at: now })) return { ch: [], paid: {}, why: 'that fight is paid already' };
  const won = claim.outcome === 'won';
  // The members that count: those that fought; a dead one only when the host believes it died -- a body the world
  // shares on the host's own word of its death, any other against the character's own rate. Asked of a won fight
  // alone, since only a win pays a kill, so a fight lost or broken off spends nothing of the rate.
  const believed = (m: ClaimMember): boolean => (m.w && ctx.witness ? ctx.witness(m.w) : !ctx.localKill || ctx.localKill());
  const fought = claim.members.filter((m) => m.fought);
  const dead = won ? fought.filter((m) => m.dead && believed(m)) : [];
  // Diminishing returns, by the creature and never the body: each dead one's factor, its repeat written down. Only a win pays a kill.
  const dr = new Map<ClaimMember, number>();
  if (won) {
    for (const m of dead) {
      const key = fnv32(m.npc);
      const f = drFactor(b.draft, key, now, rules);
      dr.set(m, f.factor);
      if (!recentOf(b.draft, key) && !b.room('recent')) continue;
      b.add({ k: 'recent', key, at: now, n: f.n });
    }
  }
  // A first win over a creature, and on a planet, once each a claim, held together to `noveltyMax`.
  let novelty = 0;
  if (won && dead.length) {
    const fresh = new Set<string>();
    for (const m of dead) {
      const key = fnv32(`npc:${m.npc}`);
      if (!b.draft.seen?.includes(key)) fresh.add(key);
    }
    const planet = fnv32(`planet:${claim.planet}`);
    const newPlanet = !!claim.planet && !b.draft.seen?.includes(planet);
    novelty = Math.min(rules.noveltyMax, (fresh.size ? rules.novelty : 0) + (newPlanet ? rules.novelty : 0));
    if (newPlanet) fresh.add(planet);
    for (const key of fresh) if (b.room('seen')) b.add({ k: 'seen', key });
  }
  const diff = Math.max(0, Math.min(1, Number.isFinite(claim.diff) ? claim.diff : 1));
  // How near the foes were to falling, for a loss: their health left over their whole, the dead counting nought.
  const left = fought.length ? fought.reduce((a, m) => a + (m.dead ? 0 : Math.max(0, Math.min(1, m.share))), 0) / fought.length : 1;
  // What each pool is owed before its bucket and the rested bonus.
  const owed: [CoreSkill | Pool, number, number, string | undefined][] = [];
  const worthOf = (pool: CoreSkill | Pool, list: ClaimMember[], kills: boolean): [number, number] => {
    const c = challengeFor(b.draft, pool, rules);
    let v = 0;
    for (const m of list) v += memberWorth(m.level, c, ctx.levels, rules) * (kills ? (dr.get(m) ?? 1) : 1);
    return [Math.min(v, rules.encounterCap), c];
  };
  for (const p of ENCOUNTER_POOLS) {
    if (!claim.used.includes(p)) continue;
    const pool = poolOf(p);
    if (won) {
      const [v, c] = worthOf(pool, dead, true);
      owed.push([pool, v * (1 + novelty) * diff * rules.xpRate, c, v > 0 ? undefined : 'nothing it fought died']);
    } else if (claim.outcome === 'lost') {
      const [v, c] = worthOf(pool, fought, false);
      const close = left <= rules.closeShare;
      owed.push([pool, close ? v * rules.trickle * diff * rules.xpRate : 0, c, close ? undefined : 'lost, and the foes were not near falling']);
    } else owed.push([pool, 0, 0, 'broken off: only Fortitude is paid']);
  }
  if (claim.heavy && claim.outcome !== 'lost') {
    const [v, c] = worthOf('fortitude', fought, false);
    owed.push(['fortitude', v * diff * rules.xpRate, c, undefined]);
  }
  // The rested bonus: back after long enough, banked by the hour, then spent doubling what is paid.
  let rested = restedAt(b.draft, now, rules);
  const paid: Partial<Record<CoreSkill | Pool, number>> = {};
  const pools: PoolPaid[] = [];
  let total = 0;
  for (const [pool, raw, c, why] of owed) {
    const base = Math.round(raw);
    const extra = Math.min(base, rested);
    const want = base + extra;
    const granted = ctx.bucket ? ctx.bucket.take(rec.char, pool, want, now, rules) : want;
    const gain = gainInto(b, pool, granted, rules);
    const spent = Math.max(0, Math.min(extra, gain - base));
    rested -= spent;
    logGain(b, LOG_SOURCES.indexOf(pool), gain, now, rules);
    if (gain > 0) paid[pool] = (paid[pool] ?? 0) + gain;
    total += gain;
    pools.push({ pool, challenge: c, worth: base, paid: gain, rested: spent, ...(why ? { why } : granted < want ? { why: 'held to its bucket or its cap' } : {}) });
  }
  // Nothing paid: why, in the first pool's own words where it has any (nothing it fought died, held to its bucket).
  if (total <= 0) return { ch: [], paid: {}, why: owed.length ? (pools.find((p) => p.why)?.why ?? 'nothing to pay') : 'no skill was used', pools, novelty };
  // What is left of the rested bonus, banked hours and all, when it is not what the record holds.
  if (rested !== (b.draft.rested ?? 0)) b.add({ k: 'rested', xp: rested });
  b.add({ k: 'last', at: now });
  return { ch: b.ch, paid, pools, novelty };
}

/**
 * The rested XP a character has at `now` (whole seconds): what the record banks, and what the hours since its
 * last payout would add the moment the next fight is paid. What the page says waits, in words.
 */
export function restedAt(rec: ProgressRecord | null, now: number, rules: ProgressRules = PROGRESS_RULES): number {
  if (!rec) return 0;
  const banked = rec.rested ?? 0;
  const last = rec.last ?? 0;
  if (last > 0 && now - last >= rules.restedAfter) return Math.min(rules.restedMax, banked + Math.floor((now - last) / 3600) * rules.restedPerHour);
  return banked;
}

/** The keys the roll task keeps in `recent`: its own repeat, and the sum of its window. */
const ROLL_KEY = fnv32('roll');
const ROLL_WINDOW = fnv32('roll:window');

/**
 * A landing roll's payout into Acrobatics: `saved` times `rollPerHp`, at most `rollCap` a roll, less for a roll
 * after a roll (`drWindow`), and at most `rollWindowCap` in any window of `drWindow` seconds, whose running sum
 * is a `recent` entry of its own. A roll that saved nothing pays nothing; it never takes the rested bonus.
 */
export function payTask(rec: ProgressRecord, task: ProgressTask, ctx: PayCtx): PayResult {
  const rules = ctx.rules ?? PROGRESS_RULES;
  const limits = ctx.limits ?? PROGRESS_LIMITS;
  const now = secondsOf(ctx.now);
  if (task.kind !== 'roll') return { ch: [], paid: {}, why: 'not a task this pays' };
  if (rec.paid && Object.hasOwn(rec.paid, task.id)) return { ch: [], paid: {}, why: 'that roll is paid already' };
  if (now - secondsOf(task.at) > rules.claimMaxAge) return { ch: [], paid: {}, why: 'that roll is too long ago to pay' };
  if (!(task.saved > 0)) return { ch: [], paid: {}, why: 'that roll saved nothing' };
  const b = new Batch(rec, limits);
  if (!b.room('paid', now - rules.claimMaxAge)) return { ch: [], paid: {}, why: 'too many at once' };
  b.add({ k: 'paid', key: task.id, at: now });
  const f = drFactor(b.draft, ROLL_KEY, now, rules);
  const win = recentOf(b.draft, ROLL_WINDOW);
  const fresh = !win || now - win[0] > rules.drWindow;
  const start = fresh ? now : win![0];
  const sum = fresh ? 0 : win![1];
  const raw = Math.round(Math.min(task.saved * rules.rollPerHp, rules.rollCap) * f.factor * rules.xpRate);
  const want = Math.max(0, Math.min(raw, rules.rollWindowCap - sum));
  const granted = ctx.bucket ? ctx.bucket.take(rec.char, 'acrobatics', want, now, rules) : want;
  const gain = gainInto(b, 'acrobatics', granted, rules);
  if (gain <= 0) return { ch: [], paid: {}, why: raw > 0 ? 'rolls have paid all they may for now' : 'that roll is worth nothing' };
  if (recentOf(b.draft, ROLL_KEY) || b.room('recent')) b.add({ k: 'recent', key: ROLL_KEY, at: now, n: f.n });
  if (recentOf(b.draft, ROLL_WINDOW) || b.room('recent')) b.add({ k: 'recent', key: ROLL_WINDOW, at: start, n: sum + gain });
  logGain(b, LOG_SOURCES.indexOf('acrobatics'), gain, now, rules);
  return { ch: b.ch, paid: { acrobatics: gain } };
}

/** Every built core skill, for whoever lists what a payout touched. */
export const PAID_SKILLS: readonly (CoreSkill | Pool)[] = [...BUILT_CORE, 'demolitions'];
