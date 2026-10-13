// The rules a character's progress is paid and learnt by (`src/progress/payout.ts`, `learn.ts`, `challenge.ts`,
// `core.ts`), the ones a server will run as they stand: the challenge level and its bands, what a fight pays and
// why not more, the rested bonus, a roll's pay and its window, the rating curve and its milestones, learning and
// giving back at a trainer, the quest bonus, and the trainers' worlds against the emulator's own reference.
//
// Every record and table here is made up and labelled TEST; the one file read is the committed reference of the
// emulator's placements (`tools/swg/core3ref/statics.json`), for where its commando trainers stand.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bandOf, challengeOf, cleanLevels, type ConTable } from '../../../src/progress/challenge.ts';
import { coreGrants, ratingOf, xpCap, xpFor } from '../../../src/progress/core.ts';
import { TRAINER_WORLDS, TRAINERS, nodeById } from '../../../src/progress/disciplines.ts';
import { grantChanges, learnChanges, learnCost, nodeState, questBonus, surrenderChanges, surrenderFee, whyNotLearn, whyNotSurrender } from '../../../src/progress/learn.ts';
import { XpBuckets, challengeFor, payClaim, payTask, restedAt, type EncounterClaim, type ClaimMember } from '../../../src/progress/payout.ts';
import { applyProgress, emptyRecord, fnv32, secondsOf, spSpent, type ProgressRecord } from '../../../src/progress/record.ts';
import { PROGRESS_LIMITS, PROGRESS_RULES, type ProgressRules } from '../../../src/progress/tune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const T0 = 1_800_000_000_000;
const H = 3600 * 1000;
/** A TEST challenge table, not the game's: each band's lowest level a fixed gap from the row's own. */
const TEST_LEVELS: ConTable = cleanLevels({
  format: 1,
  rows: Array.from({ length: 90 }, (_, i) => {
    const l = i + 1;
    return [l, Math.max(0, l - 15), Math.max(0, l - 10), Math.max(0, l - 6), Math.max(0, l - 3), l, l + 1, l + 4, l + 7, l + 10];
  }),
})!;
const rules = (o: Partial<ProgressRules> = {}): ProgressRules => ({ ...PROGRESS_RULES, ...o });
const member = (o: Partial<ClaimMember> = {}): ClaimMember => ({ npc: 'test_kreetle', level: 1, dead: true, fought: true, share: 0, ...o });
let ids = 0;
const claim = (o: Partial<EncounterClaim> = {}): EncounterClaim => ({ id: `etest${ids++}`, at: T0, outcome: 'won', used: ['marksmanship'], heavy: false, planet: 'testworld', diff: 1, members: [member()], ...o });
/** Pay a claim and apply it, as a host does; answers what it paid. */
const pay = (rec: ProgressRecord, c: EncounterClaim, now = c.at, levels: ConTable | null = null, r: ProgressRules = PROGRESS_RULES, bucket: XpBuckets | null = null) => {
  const out = payClaim(rec, c, { now, levels, rules: r, limits: PROGRESS_LIMITS, bucket });
  applyProgress(rec, out.ch, PROGRESS_LIMITS);
  return out;
};

// ---- the challenge level and its bands -----------------------------------------------------------------------------
{
  ok([0, 8, 36, 134, 250].map(challengeOf).join() === '1,4,14,49,90', `the challenge level of 0, 8, 36, 134 and 250 Skill Points spent is 1, 4, 14, 49 and 90 (${[0, 8, 36, 134, 250].map(challengeOf).join()})`);
  ok(!!TEST_LEVELS, 'the TEST table reads as a challenge table');
  const at50 = [30, 35, 40, 44, 47, 50, 51, 54, 57, 60, 99].map((t) => bandOf(t, 50, TEST_LEVELS));
  ok(at50.join() === 'grey,grey,green,lightBlue,blue,white,yellow,orange,red,purple,purple', `against the TEST table a target falls in the highest band it reaches (${at50.join()})`);
  const fallback = [30, 39, 40, 44, 47, 50, 51, 54, 57, 60].map((t) => bandOf(t, 50, null));
  ok(fallback.join() === 'grey,grey,green,lightBlue,blue,white,yellow,orange,red,purple', `and with no table, by the gap of ours (${fallback.join()})`);
  ok(bandOf(null, 50, TEST_LEVELS) === 'white' && bandOf(null, 1, null) === 'white', 'a body with no level counts as the character’s own challenge, white');
}

// ---- what a fight pays ----------------------------------------------------------------------------------------------
{
  const rec = emptyRecord('c1');
  const first = pay(rec, claim());
  // White against challenge 1 is 25, and a first win over a creature and on a planet is half again each: twice it.
  ok(first.paid.marksmanship === 50 && rec.core.marksmanship === 50, `a won fight pays its member's worth, doubled by a first creature and a first planet (${first.paid.marksmanship})`);
  ok(first.ch[0].k === 'paid' && (first.ch[0] as { key: string }).key.startsWith('etest'), "the claim's key is the first change of its batch, ahead of the XP it pays");
  ok(rec.last === secondsOf(T0) && rec.seen?.length === 2, 'it writes when it was paid, and the creature and planet won against');
  const second = pay(rec, claim({ at: T0 + 60_000 }), T0 + 60_000);
  ok(second.paid.marksmanship === 20, `the same creature again within the window pays a step less, with no novelty (${second.paid.marksmanship})`);
  const two = pay(rec, claim({ at: T0 + 120_000, members: [member({ w: 'wild:a:1' }), member({ w: 'wild:a:2' })] }), T0 + 120_000);
  // 25 x 0.64 + 25 x 0.512, the second body the same creature, never a new one for being a new body.
  ok(two.paid.marksmanship === 29, `two bodies of one creature are one creature to diminishing returns (${two.paid.marksmanship})`);
  let last = 0;
  for (let i = 0; i < 12; i++) last = pay(rec, claim({ at: T0 + 200_000 + i * 1000 }), T0 + 200_000 + i * 1000).paid.marksmanship ?? 0;
  ok(last === Math.round(25 * PROGRESS_RULES.drFloor), `and down to the floor, never below (${last})`);
  const later = pay(rec, claim({ at: T0 + 2 * H }), T0 + 2 * H);
  ok(later.paid.marksmanship === 25, `past the window it pays whole again (${later.paid.marksmanship})`);
}
{
  const rec = emptyRecord('c2');
  const big = pay(rec, claim({ members: Array.from({ length: 20 }, (_, i) => member({ npc: `test_${i}`, level: 90 })) }));
  ok(big.paid.marksmanship === Math.round(PROGRESS_RULES.encounterCap * (1 + PROGRESS_RULES.noveltyMax)), `a fight is held to the encounter's cap before its novelty (${big.paid.marksmanship})`);
  const purple = emptyRecord('c3');
  ok(pay(purple, claim({ members: [member({ level: 90 })] })).paid.marksmanship === Math.round(25 * PROGRESS_RULES.band.purple * 2), 'a member far above the challenge pays the purple share');
}
{
  const rec = emptyRecord('c4');
  pay(rec, claim());
  const before = rec.core.marksmanship ?? 0;
  const lost = pay(rec, claim({ at: T0 + 1000, outcome: 'lost', members: [member({ dead: false, share: 0.2 })] }), T0 + 1000);
  ok(lost.paid.marksmanship === Math.round(25 * PROGRESS_RULES.trickle) && rec.core.marksmanship === before + lost.paid.marksmanship!, `a fight lost with the foe near falling pays a tenth (${lost.paid.marksmanship})`);
  const far = pay(rec, claim({ at: T0 + 2000, outcome: 'lost', members: [member({ dead: false, share: 0.6 })] }), T0 + 2000);
  ok(far.ch.length === 0, 'and one lost with the foe well up pays nothing');
  const broken = pay(rec, claim({ at: T0 + 3000, outcome: 'broken', heavy: true, used: ['marksmanship', 'melee'], members: [member({ npc: 'test_other', dead: false, share: 0.5 })] }), T0 + 3000);
  ok(Object.keys(broken.paid).join() === 'fortitude' && broken.paid.fortitude === 25, `a fight broken off pays only Fortitude, and only when it was heavy (${JSON.stringify(broken.paid)})`);
  const light = pay(rec, claim({ at: T0 + 4000, outcome: 'broken', heavy: false }), T0 + 4000);
  ok(light.ch.length === 0, 'a light one broken off pays nothing');
  const wonHeavy = pay(rec, claim({ at: T0 + 5000, heavy: true, members: [member({ npc: 'test_third' })] }), T0 + 5000);
  ok((wonHeavy.paid.fortitude ?? 0) > 0 && (wonHeavy.paid.marksmanship ?? 0) > 0, 'a heavy fight won pays Fortitude beside the skills used');
  // A claim says what it says: a lost one that calls itself heavy (a server will take claims from browsers) pays no Fortitude.
  const lostHeavy = pay(rec, claim({ at: T0 + 6000, outcome: 'lost', heavy: true, members: [member({ npc: 'test_fourth', dead: false, share: 0.1 })] }), T0 + 6000);
  ok(!lostHeavy.paid.fortitude && lostHeavy.paid.marksmanship === Math.round(25 * PROGRESS_RULES.trickle), `a lost fight pays no Fortitude whatever its claim says of how heavy it was, only its trickle (${JSON.stringify(lostHeavy.paid)})`);
}
{
  // Only what fought is paid for: a grazing beast killed in the same fight as a real foe is worth nothing.
  const rec = emptyRecord('c4b');
  const both = pay(rec, claim({ members: [member({ npc: 'test_foe' }), member({ npc: 'test_grazer', fought: false, level: 90 })] }));
  const alone = pay(emptyRecord('c4c'), claim({ members: [member({ npc: 'test_foe' })] }));
  ok(both.paid.marksmanship === alone.paid.marksmanship && both.paid.marksmanship === 50, `a won fight pays the members that fought, never a passive one that died beside them (${both.paid.marksmanship})`);
  ok(rec.seen?.length === 2 && !rec.seen.includes(fnv32('npc:test_grazer')), 'and the beast that never fought is no first win either');
  const heavy = pay(emptyRecord('c4d'), claim({ heavy: true, used: [], members: [member({ npc: 'test_foe' }), member({ npc: 'test_grazer', fought: false, dead: false, share: 1, level: 90 })] }));
  ok(heavy.paid.fortitude === 25, `Fortitude too is the worth of what fought (${heavy.paid.fortitude})`);
}
{
  const soft = emptyRecord('c5');
  const hard = emptyRecord('c6');
  const half = emptyRecord('c7');
  const a = pay(soft, claim({ diff: 2 })).paid.marksmanship;
  const b = pay(hard, claim({ diff: 1 })).paid.marksmanship;
  const c = pay(half, claim({ diff: 0.5 })).paid.marksmanship;
  ok(a === b && c === Math.round((b ?? 0) / 2), `a world turned up pays as the data's own, and one turned down pays less (${a}, ${b}, ${c})`);
}
{
  const rec = emptyRecord('c8');
  rec.core.marksmanship = xpFor(50, PROGRESS_RULES);
  ok(challengeFor(rec, 'marksmanship', rules({ coreChallenge: 0 })) === 1 && challengeFor(rec, 'marksmanship', rules({ coreChallenge: 1 })) === 46 && challengeFor(rec, 'demolitions', rules({ coreChallenge: 1 })) === 1, 'with the switch, a core skill is paid against its own rating and a discipline against Skill Points');
  const r0 = payClaim(rec, claim({ members: [member({ level: 46 })] }), { now: T0, levels: null, rules: rules({ coreChallenge: 0 }), bucket: null });
  const r1 = payClaim(rec, claim({ members: [member({ level: 46 })] }), { now: T0, levels: null, rules: rules({ coreChallenge: 1 }), bucket: null });
  ok(r0.paid.marksmanship === Math.round(25 * PROGRESS_RULES.band.purple * 2) && r1.paid.marksmanship === 50, `a level-46 foe is purple to a character of challenge 1 and white to a rating of 50 (${r0.paid.marksmanship}, ${r1.paid.marksmanship})`);
}

// ---- the rested bonus ------------------------------------------------------------------------------------------------
{
  const rec = emptyRecord('c9');
  pay(rec, claim());
  ok(!rec.rested && restedAt(rec, secondsOf(T0) + 3600, PROGRESS_RULES) === 0, 'nothing is rested after a first payout, nor an hour later');
  const t = T0 + 5 * H;
  ok(restedAt(rec, secondsOf(t), PROGRESS_RULES) === 500, 'five hours away banks five hundred');
  const r = pay(rec, claim({ at: t, members: [member({ npc: 'test_rested' })] }), t);
  // 25 x 1.5 (a new creature) = 38 (rounded), doubled by what is rested.
  ok(r.paid.marksmanship === 76 && rec.rested === 500 - 38, `and the next fight pays double out of it, the rest kept (${r.paid.marksmanship}, ${rec.rested} left)`);
  const long = emptyRecord('c10');
  pay(long, claim());
  ok(restedAt(long, secondsOf(T0 + 40 * H), PROGRESS_RULES) === PROGRESS_RULES.restedMax, 'held to its most');
  const roll = payTask(long, { id: 'rtest1', at: T0 + 40 * H, kind: 'roll', fell: 6, saved: 20 }, { now: T0 + 40 * H, levels: null, bucket: null });
  ok(roll.paid.acrobatics === 40 && !roll.ch.some((c) => c.k === 'rested'), `a roll never takes it (${roll.paid.acrobatics})`);
  const withLog: ProgressRecord = emptyRecord('c11');
  withLog.log = [[secondsOf(T0), secondsOf(T0), 2, 100]];
  withLog.last = secondsOf(T0);
  const bonus = questBonus(withLog, 'test:q#1#out:done', 50, T0 - 1000, { now: T0 + 40 * H });
  ok(bonus.paid.marksmanship === 50 && !bonus.ch.some((c) => c.k === 'rested'), 'nor a quest bonus');
}

// ---- paid once, and not too late -------------------------------------------------------------------------------------
{
  const rec = emptyRecord('c12');
  const c = claim();
  pay(rec, c);
  const again = payClaim(rec, c, { now: T0 + 1000, levels: null, bucket: null });
  ok(again.ch.length === 0 && /paid already/.test(again.why ?? ''), 'the same claim handed in twice pays once');
  const old = payClaim(rec, claim({ at: T0 }), { now: T0 + (PROGRESS_RULES.claimMaxAge + 5) * 1000, levels: null, bucket: null });
  ok(old.ch.length === 0 && /too long ago/.test(old.why ?? ''), 'a claim older than its longest age pays nothing');
}
{
  const rec = emptyRecord('c13');
  rec.seen = Array.from({ length: PROGRESS_LIMITS.seen }, (_, i) => fnv32(`test:seen:${i}`));
  const out = pay(rec, claim({ members: [member({ npc: 'test_brand_new' })] }));
  const drop = out.ch.findIndex((c) => c.k === 'seenDrop');
  const add = out.ch.findIndex((c) => c.k === 'seen');
  ok(drop >= 0 && drop < add && rec.seen!.length === PROGRESS_LIMITS.seen && rec.seen![0] !== fnv32('test:seen:0'), 'a list at its limit has its oldest dropped by a change in the same batch, before the one that adds');
}

// ---- the bucket ------------------------------------------------------------------------------------------------------
{
  const b = new XpBuckets();
  const t = secondsOf(T0);
  ok(b.take('c', 'marksmanship', 5000, t) === PROGRESS_RULES.bucketMax, 'a pool takes at most its bucket at once');
  ok(b.take('c', 'marksmanship', 5000, t) === 0 && b.take('d', 'marksmanship', 10, t) === 10 && b.take('c', 'melee', 10, t) === 10, 'emptied, nothing more, while another character and another pool are their own');
  ok(b.take('c', 'marksmanship', 5000, t + 60) === PROGRESS_RULES.perMinute, 'and it fills at its rate a minute');
  const rec = emptyRecord('c14');
  const capped = pay(rec, claim({ members: Array.from({ length: 20 }, (_, i) => member({ npc: `test_b${i}`, level: 90 })) }), T0, null, rules({ bucketMax: 300 }), new XpBuckets());
  ok(capped.paid.marksmanship === 300 && rec.core.marksmanship === 300, `a payout is held to its bucket, and only what the bucket gave goes in (${capped.paid.marksmanship})`);
}

// ---- a roll's pay, and its window ------------------------------------------------------------------------------------
{
  const rec = emptyRecord('c15');
  let total = 0;
  for (let i = 0; i < 30; i++) {
    const at = T0 + i * 30_000;
    const r = payTask(rec, { id: `rtest${i}`, at, kind: 'roll', fell: 8, saved: 51 }, { now: at, levels: null, bucket: null });
    applyProgress(rec, r.ch, PROGRESS_LIMITS);
    total += r.paid.acrobatics ?? 0;
  }
  ok(total === PROGRESS_RULES.rollWindowCap && rec.core.acrobatics === total, `a ledge rolled off thirty times in fifteen minutes pays its window's cap and no more (${total})`);
  const nothing = payTask(rec, { id: 'rtest-none', at: T0, kind: 'roll', fell: 2, saved: 0 }, { now: T0, levels: null, bucket: null });
  ok(nothing.ch.length === 0, 'a roll that saved nothing pays nothing');
  // The same roll handed in twice (a resend, a reload) finds its own key and pays once.
  const once = emptyRecord('c15b');
  const task = { id: 'rtest-twice', at: T0, kind: 'roll' as const, fell: 8, saved: 20 };
  const first = payTask(once, task, { now: T0, levels: null, bucket: null });
  applyProgress(once, first.ch, PROGRESS_LIMITS);
  const second = payTask(once, task, { now: T0 + 1000, levels: null, bucket: null });
  ok(first.paid.acrobatics === 40 && second.ch.length === 0 && /paid already/.test(second.why ?? '') && once.core.acrobatics === 40 && once.paid?.['rtest-twice'] === secondsOf(T0), 'one roll handed in twice pays once, its key kept');
  const after = T0 + 20 * 60_000;
  const next = payTask(rec, { id: 'rtest-after', at: after, kind: 'roll', fell: 8, saved: 51 }, { now: after, levels: null, bucket: null });
  ok((next.paid.acrobatics ?? 0) > 0, 'and past the window a roll pays again');
}

// ---- the rating and its milestones -----------------------------------------------------------------------------------
{
  ok(xpCap(PROGRESS_RULES) === 40000 && xpFor(25, PROGRESS_RULES) === 5000 && xpFor(1, PROGRESS_RULES) === 40, `forty thousand to reach 100, five thousand to 25, forty to 1 (${xpCap(PROGRESS_RULES)}, ${xpFor(25, PROGRESS_RULES)})`);
  ok(ratingOf(5000, PROGRESS_RULES) === 25 && ratingOf(4999, PROGRESS_RULES) === 24 && ratingOf(0, PROGRESS_RULES) === 0 && ratingOf(1e9, PROGRESS_RULES) === 100, 'a rating is the whole one its XP reaches');
  const rec = emptyRecord('c16');
  ok(coreGrants(rec, PROGRESS_RULES).length === 0, 'at 0 a skill grants nothing');
  rec.core.acrobatics = xpFor(25, PROGRESS_RULES);
  const g25 = coreGrants(rec, PROGRESS_RULES);
  ok(g25.some((g) => g.stat === 'fall.rollFree' && g.op === 'set' && g.value === 8) && g25.some((g) => g.stat === 'roll.iframes' && Math.abs(g.value - 0.0375) < 1e-12), 'Acrobatics 25 rolls out of falls up to eight metres and has a quarter of its dodge');
  rec.core.marksmanship = xpCap(PROGRESS_RULES);
  const g100 = coreGrants(rec, PROGRESS_RULES);
  ok(g100.some((g) => g.stat === 'gun.spread' && Math.abs(g.value - 0.8) < 1e-12) && g100.some((g) => g.stat === 'gun.steady' && g.value === 0.5) && g100.some((g) => g.stat === 'gun.aimRate'), 'Marksmanship 100 steadies the spread to 0.8 and has its 25 and 50');
}

// ---- learning and giving back ------------------------------------------------------------------------------------------
{
  const now = secondsOf(T0);
  const rec = emptyRecord('c17');
  rec.pools.demolitions = 50000;
  ok(/trainer/.test(whyNotLearn(rec, 'demo.novice', null, now) ?? '') && nodeState(rec, 'demo.novice', null, now) === 'needsTrainer', 'the Novice wants a trainer');
  ok(Object.hasOwn(TRAINERS, 'trainer_commando') && whyNotLearn(rec, 'demo.novice', 'trainer_commando', now) === null && nodeState(rec, 'demo.novice', 'trainer_commando', now) === 'learnable', 'and a commando trainer teaches it');
  ok(nodeState(rec, 'demo.grenadier.1', 'trainer_commando', now) === 'locked', 'a node above it is locked until it is learnt');
  const l = learnChanges(rec, 'demo.novice', 'trainer_commando', now);
  applyProgress(rec, l.ch, PROGRESS_LIMITS);
  ok(rec.nodes['demo.novice']?.xp === 1000 && rec.pools.demolitions === 49000 && spSpent(rec) === 8, 'learning costs its tier: 8 Skill Points and 1,000 XP out of the pool');
  ok(whyNotLearn(rec, 'demo.grenadier.1', null, now) === null && whyNotLearn(rec, 'demo.grenadier.2', null, now) !== null, 'a tier I node is learnt anywhere, and II wants I first');
  for (const id of ['demo.grenadier.1', 'demo.grenadier.2']) applyProgress(rec, learnChanges(rec, id, null, now).ch, PROGRESS_LIMITS);
  ok(/trainer/.test(whyNotLearn(rec, 'demo.grenadier.3', null, now) ?? '') && whyNotLearn(rec, 'demo.grenadier.3', 'trainer_commando', now) === null, 'III wants a trainer');
  ok(/branches/.test(whyNotLearn(rec, 'demo.master', 'trainer_commando', now) ?? ''), 'the Master wants three branches learnt to the end');
  const poor = emptyRecord('c18');
  poor.pools.demolitions = 500;
  ok(/costs 1,000/.test(whyNotLearn(poor, 'demo.novice', 'trainer_commando', now) ?? '') && nodeState(poor, 'demo.novice', 'trainer_commando', now) === 'needsXp', 'with too little XP it is said what it costs');
  const tight = emptyRecord('c19');
  tight.pools.demolitions = 50000;
  applyProgress(tight, grantChanges(tight, 'demo.novice', now, PROGRESS_RULES).ch, PROGRESS_LIMITS);
  ok(/Skill Points/.test(whyNotLearn(tight, 'demo.ordnance.1', null, now, rules({ spCap: 10 })) ?? ''), 'past the Skill Point cap it is refused');
  // Giving back: from the bottom up, at a trainer, for a fee; and learnt again within the month for half.
  ok(/stands on/.test(whyNotSurrender(rec, 'demo.grenadier.1', 'trainer_commando') ?? '') && /stands on/.test(whyNotSurrender(rec, 'demo.novice', 'trainer_commando') ?? ''), 'a node with one standing on it cannot be given back');
  ok(/trainer/.test(whyNotSurrender(rec, 'demo.grenadier.2', null) ?? ''), 'and nothing is given back away from a trainer');
  const s = surrenderChanges(rec, 'demo.grenadier.2', 'trainer_commando', now);
  ok(s.fee === 1500 && s.fee === surrenderFee(nodeById('demo.grenadier.2')!), `the bottom one goes, for 500 credits a tier step (${s.fee})`);
  const bank = rec.pools.demolitions;
  applyProgress(rec, s.ch, PROGRESS_LIMITS);
  ok(!rec.nodes['demo.grenadier.2'] && rec.gone?.['demo.grenadier.2'] === now && rec.pools.demolitions === bank, 'its Skill Points come back and its XP does not');
  ok(learnCost(rec, nodeById('demo.grenadier.2')!, now + 86400) === 3000 && learnCost(rec, nodeById('demo.grenadier.2')!, now + 31 * 86400) === 6000, 'learnt again within thirty days it costs half, after that the whole');
  const relearn = learnChanges(rec, 'demo.grenadier.2', null, now + 86400);
  applyProgress(rec, relearn.ch, PROGRESS_LIMITS);
  ok(relearn.xp === 3000 && !rec.gone?.['demo.grenadier.2'], 'and learning it again clears its giving back');
  const master = emptyRecord('c20');
  for (const id of ['demo.grenadier.4', 'demo.launchers.4', 'demo.charges.4', 'demo.master']) applyProgress(master, grantChanges(master, id, now, PROGRESS_RULES).ch, PROGRESS_LIMITS);
  ok(!!master.nodes['demo.master'] && /goes first/.test(whyNotSurrender(master, 'demo.charges.4', 'trainer_commando') ?? '') && whyNotSurrender(master, 'demo.master', 'trainer_commando') === null, 'while the Master stands it goes first');
}

// ---- the quest bonus -------------------------------------------------------------------------------------------------
{
  const rec = emptyRecord('c21');
  const t = secondsOf(T0);
  // Marksmanship (2) paid 300 and Demolitions (7) 100 since the quest began; Melee (3) before it.
  rec.log = [[t - 5000, t - 5000, 3, 999], [t + 10, t + 50, 2, 300], [t + 20, t + 20, 7, 100]];
  const b = questBonus(rec, 'test:quest#1#out:done', 80, T0, { now: T0 + 60_000 });
  ok(b.paid.marksmanship === 60 && b.paid.demolitions === 20 && !b.paid.melee, `split over what each skill earned since the quest began, nothing to a skill used before (${JSON.stringify(b.paid)})`);
  ok(b.ch[0].k === 'bonus' && b.ch[0].key === fnv32('test:quest#1#out:done'), "its key, the story's own hashed, goes first");
  applyProgress(rec, b.ch, PROGRESS_LIMITS);
  ok(questBonus(rec, 'test:quest#1#out:done', 80, T0, { now: T0 + 60_000 }).ch.length === 0, 'and it is paid once');
  const idle = emptyRecord('c22');
  const none = questBonus(idle, 'test:quest#2#out:done', 80, T0, { now: T0 });
  ok(none.ch.length === 0 && /no skill/.test(none.why ?? ''), 'a quest that used no skill pays nothing, never into a general pool');
}

// ---- the trainers' worlds, against the emulator's own reference ----------------------------------------------------------
{
  const ref = JSON.parse(readFileSync(new URL('../core3ref/statics.json', import.meta.url), 'utf8')) as { statics: { $map: [string, { who: string }[]][] } };
  const worlds: Record<string, string[]> = {};
  for (const [world, rows] of ref.statics.$map) {
    for (const r of rows) {
      if (!Object.hasOwn(TRAINERS, r.who)) continue;
      (worlds[r.who] ??= []).includes(world) || worlds[r.who].push(world);
    }
  }
  for (const who of Object.keys(TRAINERS)) {
    const want = (worlds[who] ?? []).sort().join();
    ok(want === [...(TRAINER_WORLDS[who] ?? [])].sort().join(), `TRAINER_WORLDS names exactly the worlds the reference stands a ${who} on (${want})`);
  }
}

console.log(`\n${checks} checks passed`);
