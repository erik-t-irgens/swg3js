// The cover **rule** -- where it lives, who it can reach, and the word it puts on a body
// (src/world/mobiles/brain.ts, and the seams into src/world/npcs.ts and the relay).
//
// `cover.test.ts` proves the search and `fighterMove.test.ts` proves the physics it is given. This
// file is about the two decisions that sit either side of them, and both of them are the kind that
// look harmless and are not.
//
// **The rule is in the shared brain, behind a flag.** A fighter and a bantha call one `decide`, so
// anything added to it reaches both, and the flag is the whole of what keeps a spitting creature
// from crouching behind a rock. The flag is therefore checked from the wildlife's side as well as
// the fighter's: a decision taken with the flag off is compared field by field against the one
// taken before any of this existed, so "the wildlife is bit for bit what it was" is measured rather
// than asserted.
//
// **The word is the game's own.** `Cover` is state 0 in the client's own `state.iff`, beside Aiming
// and Alert, with 139 commands gated on it -- so it is a state here and not a field on the attack
// state, which is the owner's call over the design's recommendation. The cost of that is a list
// written out in four places that must agree, one of them in the relay, and the point of this file
// is that the four are compared with one another rather than each being read on its own.
//
// And one property that is the trap this wave was most likely to fall into: a **crouched body
// carries no actions at all** in the client's own data, so a rule that puts a body low while it
// should be shooting costs it its fire. The fire gate and the posture rule are both checked for it.
//
// Synthetic throughout: every body, place and distance below is written in this file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAIN_TUNE, decide, type BrainSelf, type BrainTarget, type Decision } from '../../../src/world/mobiles/brain.ts';
import { postureFor, type PostureInput } from '../../../src/world/fighterStance.ts';
import { askFromSkill, type CoverAsk } from '../../../src/world/cover.ts';
import { coverDue, skillOfGroundTier } from '../../../src/world/groundSkill.ts';
import { cleanNpcRow } from '../../../server/npcWire.mjs';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p: string[]): string => readFileSync(join(root, ...p), 'utf8');
const npcSrc = read('src', 'world', 'npcs.ts');

/** A tiered gunner twenty metres from somebody who hurt it a moment ago, home under its feet. */
const RANGE = 40;
function body(over: Partial<BrainSelf> = {}): BrainSelf {
  return {
    key: 2,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    homeX: 0,
    homeZ: 0,
    side: 'fighter',
    aggression: 'aggressive',
    inside: false,
    big: false,
    reach: 1.9,
    ranged: RANGE,
    melee: false,
    halfHeight: 0.9,
    hpRatio: 1,
    state: 'chase',
    // Already after this one, so the "stare at a fresh target" rung is not what answers.
    targetKey: 1,
    stuck: 0,
    now: 100,
    wanderAt: 1e9,
    goal: null,
    until: 0,
    blockedSince: null,
    forgetKey: null,
    forgetUntil: 0,
    ...over,
  };
}

function foe(over: Partial<BrainTarget> = {}): BrainTarget {
  return { key: 1, x: 20, y: 0, z: 0, halfHeight: 0.9, radius: 0.7, side: 'player', aggression: 'aggressive', dead: false, attackedMeAt: 99.5, hasLine: true, ...over };
}

const think = (self: BrainSelf, t: BrainTarget): Decision => decide(self, [t], BRAIN_TUNE, () => 0.5);

// --- 1: whether to look, which is the rule ---------------------------------------------------------

{
  const shooting = think(body({ seeksCover: true }), foe());
  ok(shooting.state === 'attack' && shooting.attack === 'ranged' && shooting.pace === 'stand', 'a flagged gunner with a clear shot still answers the attack it always answered');
  ok(shooting.cover === true, '... and wants cover while it takes it: a body that only looked while it was blocked would take cover and step straight back out of it the moment it could see, which is peek-a-boo and not a firefight');

  const blocked = think(body({ seeksCover: true }), foe({ hasLine: false }));
  ok(blocked.state === 'chase', 'with a wall in the way it still answers the chase, which is the line in this game that was always going to be wrong');
  ok(blocked.cover === true, '... and now wants somewhere to stand instead of walking into the open');
  ok(!!blocked.moveTo && blocked.moveTo.x === 20 && blocked.pace === 'run', '**and the chase is untouched**: the target is still where it is walking and it is still running there, so a body that looks and finds nothing closes exactly as it did before any of this -- which is the one failure this rule must not have');

  const faroff = think(body({ seeksCover: true }), foe({ x: RANGE * BRAIN_TUNE.coverRange + 1, hasLine: false }));
  ok(faroff.cover === false && faroff.state === 'chase', `past ${BRAIN_TUNE.coverRange}x its own reach a blocked shot is just somebody a long way off, and it closes without hiding from them`);
  const inside = think(body({ seeksCover: true }), foe({ x: RANGE * BRAIN_TUNE.coverRange - 1, hasLine: false }));
  ok(inside.cover === true, '... and a metre inside that, it does hide');

  // The number is live, and moving it really moves the rule rather than a copy of it.
  const was = BRAIN_TUNE.coverRange;
  BRAIN_TUNE.coverRange = 3;
  ok(think(body({ seeksCover: true }), foe({ x: RANGE * was + 1, hasLine: false })).cover === true, 'and the reach is one live number on the brain’s own tuning, not a literal in the rule');
  BRAIN_TUNE.coverRange = was;

  const melee = think(body({ seeksCover: true, ranged: 0, melee: true }), foe({ x: 2 }));
  ok(melee.attack === 'melee' && melee.cover === false, 'nothing with a blade ever wants cover, flag or no flag: it has to close to arm’s length to do anything, so standing behind a crate is standing still');

  const fresh = think(body({ seeksCover: true, targetKey: null, state: 'idle' }), foe({ hasLine: false }));
  ok(fresh.state === 'alert' && fresh.cover === false, 'and the stare at a fresh target is still the stare: the cover rule replaces the attack and the chase and nothing else in the ladder');

  const home = think(body({ seeksCover: true, homeX: 1e4 }), foe());
  ok(home.state === 'return' && home.cover === false && home.targetKey === null, 'the leash still outranks everything, so a body past it goes home rather than taking cover on the way');
}

// --- 2: the flag, from the wildlife's side ----------------------------------------------------------
//
// The thing to prove is not that a creature answers `cover: false` -- that is one field. It is that
// every *other* field of every decision is the same number it was, which is what "one `decide` and
// not two" is worth and is the only way a shared brain can be added to safely.

{
  const cases: [string, BrainSelf, BrainTarget][] = [
    ['with a clear shot', body(), foe()],
    ['with a wall in the way', body(), foe({ hasLine: false })],
    ['out of range', body(), foe({ x: 200, hasLine: false })],
    ['at arm’s length', body({ ranged: 0, melee: true }), foe({ x: 2 })],
    ['staring at a fresh one', body({ targetKey: null, state: 'idle' }), foe({ hasLine: false })],
    ['past its leash', body({ homeX: 1e4 }), foe()],
    ['with nothing to fight', body({ targetKey: null, state: 'idle', wanderAt: 0 }), foe({ dead: true })],
  ];
  let same = 0;
  for (const [what, self, t] of cases) {
    const plain = think(self, t);
    // The very same body with the flag on, and with cover to stand in: only the two new fields may
    // differ, and on an unflagged body not even those.
    const flagged = think({ ...self, seeksCover: true, inCover: true }, t);
    ok(plain.cover === false, `a creature ${what} never wants cover`);
    ok(plain.state !== 'cover', `... and is never in it`);
    for (const key of Object.keys(plain) as (keyof Decision)[]) {
      if (key === 'cover' || key === 'state') continue;
      const a = plain[key];
      const b = flagged[key];
      const alike = a === b || (a && b && typeof a === 'object' && typeof b === 'object' ? JSON.stringify(a) === JSON.stringify(b) : false);
      assert.ok(alike, `${what}: the flag moved ${key} (${JSON.stringify(a)} -> ${JSON.stringify(b)})`);
      same++;
    }
  }
  ok(same > 0, `and the flag moves nothing else at all: ${same} fields compared across ${cases.length} situations, and only the state word and the cover flag ever differ`);

  const unflaggedInCover = think(body({ inCover: true }), foe());
  ok(unflaggedInCover.state === 'attack', 'a body that says it is in cover but has no flag is not: both gates are read, so nothing can put the word on a creature by writing one field');
}

// --- 3: the word, which is the game's own ------------------------------------------------------------

{
  const covered = think(body({ seeksCover: true, inCover: true }), foe());
  ok(covered.state === 'cover', 'a flagged body standing behind something is in the game’s own `Cover` state -- state 0 in the client’s own table, beside Aiming and Alert, with 139 commands gated on it');
  ok(covered.attack === 'ranged' && covered.pace === 'stand', '... and it is the attack state under another name: it is still shooting, from a standstill');
  const coveredBlocked = think(body({ seeksCover: true, inCover: true }), foe({ hasLine: false }));
  ok(coveredBlocked.state === 'cover' && !!coveredBlocked.moveTo, '... and behind something with no shot it is the chase under another name, target still as the point it walks to');
  ok(think(body({ seeksCover: true }), foe()).state === 'attack', 'and a body that wants cover and has not got any says so: the word cannot claim a body is behind something while it is walking about in the open');

  // The four lists. Read as text, out of the four files, and compared with one another: a word
  // added in one place and not the others is a word the wire turns quietly back into `idle`.
  const words = (src: string, after: string): string[] => {
    const tail = src.slice(src.indexOf(after) + after.length);
    const line = tail.slice(0, tail.indexOf(';') + 1);
    return [...line.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  };
  const lists: Record<string, string[]> = {
    'src/world/mobiles/types.ts': words(read('src', 'world', 'mobiles', 'types.ts'), 'export type MobileState ='),
    'src/world/mobiles/mobile.ts': words(read('src', 'world', 'mobiles', 'mobile.ts'), 'const STATE_WORDS'),
    'src/world/errand.ts': words(read('src', 'world', 'errand.ts'), 'export const ERRAND_STATES'),
    'server/npcWire.mjs': words(read('server', 'npcWire.mjs'), 'const STATES ='),
  };
  const names = Object.keys(lists);
  for (const name of names) ok(lists[name].includes('cover'), `${name} knows the word`);
  const first = [...lists[names[0]]].sort().join();
  for (const name of names.slice(1)) ok([...lists[name]].sort().join() === first, `${name} holds exactly the same words as ${names[0]}, which is the only check that catches a word added in one place and forgotten in the other three`);

  // And the errand's track codes a state as the **index** into its own list, so a word may only be
  // appended: a track already printed is read against it.
  const errand = lists['src/world/errand.ts'];
  const before = ['loading', 'idle', 'wander', 'alert', 'chase', 'attack', 'flee', 'return', 'knockdown', 'dying', 'dead'];
  ok(before.every((w, i) => errand[i] === w), 'the walk’s own list still codes every word it coded before at the same byte, because the code is the index and the new word went on the end');

  // The relay, run rather than read: the server keeps the word and still refuses anything else.
  const row = (s: string): unknown => cleanNpcRow({ i: 'w:1:7', p: [1, 2, 3], h: 0, s, v: 0, hp: 1 });
  ok((row('cover') as { s: string }).s === 'cover', 'and the relay lets it through, which needed the server’s own list edited and needs a running server restarted');
  ok((row('hiding') as { s: string }).s === 'idle', '... while a word nobody knows still stands idle rather than choosing a clip that is not there');
}

// --- 4: the seams, read as text ----------------------------------------------------------------------
//
// `npcs.ts` drags three and the whole world in, so what it does with the two new fields is pinned
// the way `fighterPosture.test.ts` pins `player.ts`.

{
  ok(npcSrc.includes("seeksCover: !!this.skill && this.arm === 'gun' && !!this.gun && !this.cell && !(this.errand && !this.errand.done)"), 'the flag is a capability and not a kind: a tier of its own, a gun in the hand, out of doors, and not under a long walk');
  ok(!/seeksCover:[^\n]*ranged/.test(npcSrc), '... and it is **not** "has a ranged attack", which 2,550 of the catalogue’s 5,140 entries are and most of them spit');
  ok(!/seeksCover:[^\n]*(kind|species|dressed)/.test(npcSrc), '... nor the kind, since a dressed NPC plays a curated pack with no low clips in it at all');
  ok(npcSrc.includes('inCover: this.coverKind !== null'), 'and whether it is really behind something is fed back from the one side that can answer it');
  ok(npcSrc.includes('if (d.cover !== true) return false;'), 'the search is asked for on the brain’s answer and on nothing else');
  ok(!/const blocked = d\.state === 'chase'/.test(npcSrc), '... and the two rules that used to be written here are gone rather than doubled');

  // The trap. A crouched body carries zero actions in the client's own data, so anything that puts
  // a body low or renames its state while it should be shooting costs it its fire.
  ok(npcSrc.includes("(d.state !== 'attack' && d.state !== 'cover')"), 'a body in cover fires on exactly the same terms as one in the attack state, because it is one');
  ok(npcSrc.includes("postureAsk.shooting = !!d && (d.state === 'attack' || d.state === 'cover')"), '... and the posture rule is told so too, or a body that walked to a crate would crouch behind it and never fire again');
  ok(npcSrc.includes("postureAsk.covered = this.coverKind === 'hard'"), 'and only **hard** cover ducks a body, which is the one place it goes low with no shot to take');
  ok(npcSrc.includes("d.state === 'chase' || d.state === 'attack' || d.state === 'alert' || d.state === 'cover'"), 'the aim follows the target through the new word as it does through the old two');
}

// --- 5: the duck -------------------------------------------------------------------------------------

{
  const at = (over: Partial<PostureInput> = {}): PostureInput => ({ grounded: true, gun: true, combat: true, shooting: false, gap: 12, hpRatio: 1, pace: 'stand', held: false, canProne: true, was: 'stand', ...over });
  ok(postureFor(at()) === 'stand', 'a body standing still with nothing to shoot at keeps what it had, exactly as before');
  ok(postureFor(at({ covered: true })) === 'crouch', 'and one standing in cover it cannot shoot out of ducks behind it, which is the crouch the rule was waiting for');
  ok(postureFor(at({ covered: true, shooting: true })) === 'kneel', 'but never while it is shooting: the crouch carries no actions at all in the client’s own data, so a body that ducked with a shot to take would have lost the shot');
  ok(postureFor(at({ covered: true, pace: 'run' })) === 'stand', 'and never while it is running, cover or no cover');
  ok(postureFor(at({ covered: true, combat: false })) === 'stand', '... nor out of a fight');
  ok(postureFor(at({ covered: undefined })) === postureFor(at()), 'and the field is optional throughout, so every caller that knows nothing about cover is the rule it always was');
}

// --- 6: what a tier really buys ----------------------------------------------------------------------
//
// The ladder's own monotonicity is `groundSkill.test.ts`. What is worth pinning here is the end of
// it: the two numbers a tier turns into, as the search is really asked them.

{
  const ask: CoverAsk = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, reach: 0, hardCost: 0, indoors: false };
  const low = { ...askFromSkill(ask, skillOfGroundTier(1)) };
  const high = { ...askFromSkill(ask, skillOfGroundTier(5)) };
  ok(high.reach > low.reach * 3, `a tier-5 body looks over ${high.reach} m of ground and a tier-1 one over ${low.reach}, so the bottom of the ladder can only ever take what it is standing next to`);
  ok(high.hardCost > low.hardCost && low.hardCost === 0, 'and only the higher rungs can tell a firing position from a hole to cower in: at the bottom a hole scores the same as a wall to shoot over');
  ok(!coverDue(skillOfGroundTier(1), 2) && coverDue(skillOfGroundTier(5), 2), 'two seconds into a fight a tier-5 body has already looked twice and a tier-1 one has not looked at all');
}

console.log(`${checks} checks passed`);
