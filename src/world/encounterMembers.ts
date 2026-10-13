// Who may be in one of the player's fights and what it is like now: the two answers the game hands its encounters
// (`src/progress/encounter.ts`'s `who` and `look`), apart from `main.ts` so a node test runs them over bodies of
// the shapes the game really holds -- another player, a follower, the companion, a lair's creature, a fighter --
// with the real predicates (`isFollowerSource`, `isThreat`), rather than over a stand-in that says no for itself.
//
// Never a member: the player's own record, another player (`side === 'player'`, which every peer body is), a
// follower (`isFollowerSource`), the companion (the game's own test, handed in). What a member is, for diminishing
// returns and a first win, is its row's own creature (`Mobile.creature`), else a fighter's species, else an old
// creature's own name, and never the body nor the world's name for it. `look` writes into the kept struct it is
// handed and allocates nothing: it runs four times a second for every member.

import type { Living } from '../combat/kit.ts';
import type { MemberLook, MemberWho } from '../progress/encounter.ts';
import { isThreat, type ThreatLike } from './companion.ts';
import { isFollowerSource } from './followers.ts';

/** What the answers need of the game. */
export interface MemberDeps {
  /** The player's own record: never a member, and the side a member is a threat to. */
  player(): Living;
  /** Whether a body is the companion's (`main.ts`: a catalogue body the keeper holds). */
  isCompanion(t: Living): boolean;
  /** Whether a key is on the player's side: the player's, a follower's, the companion's. */
  ours(key: number): boolean;
}

/** Whether a body may be a member, writing what it is into `out`. */
export function memberWho(t: Living, out: MemberWho, d: MemberDeps): boolean {
  if (t === d.player() || t.side === 'player' || isFollowerSource(t)) return false;
  if (d.isCompanion(t)) return false;
  const o = t as { creature?: unknown; npcId?: unknown; level?: unknown; species?: unknown; def?: { name?: unknown } };
  out.w = typeof o.npcId === 'string' ? o.npcId : '';
  out.npc = typeof o.creature === 'string' && o.creature ? o.creature : typeof o.species === 'string' && o.species ? o.species : typeof o.def?.name === 'string' ? o.def.name : t.label;
  out.level = typeof o.level === 'number' && Number.isFinite(o.level) ? o.level : null;
  return true;
}

/**
 * A member as it is now, into `out`: dead, taken away, where, its health, whether it is still in the fight with
 * the player or anybody on their side (`isThreat`), and its temper.
 */
export function memberLook(t: Living, out: MemberLook, d: MemberDeps): boolean {
  const o = t as { removed?: unknown; hp?: unknown; maxHp?: unknown };
  out.dead = t.dead;
  out.removed = o.removed === true;
  out.x = t.pos.x;
  out.z = t.pos.z;
  out.hp = typeof o.hp === 'number' ? o.hp : t.dead ? 0 : 1;
  out.maxHp = typeof o.maxHp === 'number' ? o.maxHp : 1;
  out.threat = isThreat(t as ThreatLike, d.player(), d.ours);
  out.temper = t.aggression;
  return true;
}
