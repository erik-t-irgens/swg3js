// A character's progress record and the one function that changes it (`src/progress/record.ts`), the store that
// keeps it in this browser and the client that holds it, and the stats the passive Demolitions nodes give.
//
// The record is the story book's rule again: a closed list of changes, each whole and already clamped, applied
// the same on every host; a list is never trimmed by the function that applies a batch, only by the changes the
// host that made the batch wrote into it, so a browser applying a server's batch under the backstop arrives at
// the server's record whatever the two hosts' limits. Every test record is made up here: nothing is read from
// the game's files.
import assert from 'node:assert/strict';
import { GADGETS } from '../../../src/combat/gadgets.ts';
import { GUNS } from '../../../src/combat/guns.ts';
import { PlayerStats } from '../../../src/player/playerStats.ts';
import { characterMark } from '../../../src/net/session.ts';
import { grantChanges, resetChanges, unlearnChanges, xpChanges } from '../../../src/progress/learn.ts';
import { ProgressClient } from '../../../src/progress/progressClient.ts';
import { loadRecord, localOf, saveRecord, setAside, asides, type ProgressStorage } from '../../../src/progress/progressStore.ts';
import { RECORD_MAX, applyProgress, cleanRecord, emptyRecord, fnv32, recordText, spSpent, trimFor, type ProgressChange, type ProgressRecord } from '../../../src/progress/record.ts';
import { resolveGrants, resolveStats } from '../../../src/progress/stats.ts';
import { xpCap, xpFor } from '../../../src/progress/core.ts';
import { PROGRESS_BACKSTOP, PROGRESS_LIMITS, PROGRESS_RULES, tuneProgress, type ProgressLimits } from '../../../src/progress/tune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const mapStore = (): ProgressStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => (map.set(k, v), true), remove: (k) => void map.delete(k) };
};
const clone = (r: ProgressRecord): ProgressRecord => cleanRecord(JSON.parse(recordText(r)), PROGRESS_BACKSTOP)!;
const same = (a: ProgressRecord, b: ProgressRecord) => recordText(a) === recordText(b);
const h = (n: number) => fnv32(`test:${n}`);

// ---- every change kind -------------------------------------------------------------------------------------
{
  const rec = emptyRecord('c1');
  const batch: ProgressChange[] = [
    { k: 'core', skill: 'marksmanship', xp: 400 },
    { k: 'pool', pool: 'demolitions', xp: 5000 },
    { k: 'earned', pool: 'demolitions', xp: 5000 },
    { k: 'node', id: 'demo.novice', rec: { at: 100, xp: 1000 } },
    { k: 'gone', id: 'demo.ordnance.1', at: 90 },
    { k: 'seen', key: h(1) },
    { k: 'recent', key: h(2), at: 100, n: 1 },
    { k: 'paid', key: 'eabc123', at: 100 },
    { k: 'bonus', key: h(3) },
    { k: 'logRow', row: [100, 100, 2, 84] },
    { k: 'last', at: 100 },
    { k: 'rested', xp: 300 },
  ];
  const out = applyProgress(rec, batch);
  ok(out.changed === batch.length && out.why.length === 0 && rec.rev === 1, `a batch of every kind that adds is taken whole, and the revision rises once (${out.changed})`);
  ok(rec.core.marksmanship === 400 && rec.pools.demolitions === 5000 && rec.earned?.demolitions === 5000 && rec.nodes['demo.novice'].xp === 1000 && rec.gone?.['demo.ordnance.1'] === 90, 'the numbers are stored as the whole totals they are');
  ok(rec.seen?.[0] === h(1) && rec.recent?.[h(2)][1] === 1 && rec.paid?.eabc123 === 100 && rec.bonus?.[0] === h(3) && rec.log?.[0][3] === 84 && rec.last === 100 && rec.rested === 300, 'and every list and table holds what it was given');
  const merge = applyProgress(rec, [{ k: 'logRow', row: [100, 250, 2, 160] }, { k: 'core', skill: 'marksmanship', xp: 480 }]);
  ok(merge.changed === 2 && rec.log?.length === 1 && rec.log[0][1] === 250 && rec.log[0][3] === 160 && rec.core.marksmanship === 480, 'a log row with the same first time and source is replaced whole, and an XP is written as its new total');
  const drops: ProgressChange[] = [
    { k: 'nodeGone', id: 'demo.novice' },
    { k: 'goneClear', id: 'demo.ordnance.1' },
    { k: 'seenDrop', key: h(1) },
    { k: 'recentDrop', key: h(2) },
    { k: 'paidDrop', key: 'eabc123' },
    { k: 'bonusDrop', key: h(3) },
    { k: 'logDrop', first: 100, src: 2 },
    { k: 'last', at: 0 },
    { k: 'rested', xp: 0 },
    { k: 'core', skill: 'marksmanship', xp: 0 },
    { k: 'pool', pool: 'demolitions', xp: 0 },
    { k: 'earned', pool: 'demolitions', xp: 0 },
  ];
  ok(applyProgress(rec, drops).changed === drops.length && rec.rev === 3, 'and every kind that takes away is taken');
  const bare = emptyRecord('c1');
  bare.rev = 3;
  bare.earned = Object.create(null);
  bare.gone = Object.create(null);
  bare.seen = [];
  bare.recent = Object.create(null);
  bare.paid = Object.create(null);
  bare.bonus = [];
  bare.log = [];
  ok(same(rec, bare), 'which leaves the empty record, its revision apart');
  const refused = applyProgress(rec, [{ k: 'nodeGone', id: 'demo.novice' }, { k: 'paidDrop', key: 'nope' }, { k: 'seenDrop', key: h(9) }]);
  ok(refused.changed === 0 && refused.why.length === 3 && rec.rev === 3, `taking away what is not there is refused with a reason and moves no revision (${refused.why[0]})`);
}

// ---- paid once, seen once ---------------------------------------------------------------------------------------
{
  const rec = emptyRecord('c1');
  const once = applyProgress(rec, [
    { k: 'paid', key: 'e-claim', at: 100 },
    { k: 'paid', key: 'e-claim', at: 200 },
  ]);
  ok(once.changed === 1 && rec.paid?.['e-claim'] === 100 && /paid already/.test(once.why[0]), 'a claim is paid once: the same key again, even in the same batch, is refused and the first time kept');
  const later = applyProgress(rec, [{ k: 'paid', key: 'e-claim', at: 300 }]);
  ok(later.changed === 0 && rec.rev === 1 && rec.paid?.['e-claim'] === 100, 'and in any batch after it');
  const seen = applyProgress(rec, [
    { k: 'seen', key: h(1) },
    { k: 'seen', key: h(1) },
    { k: 'bonus', key: h(2) },
    { k: 'bonus', key: h(2) },
  ]);
  ok(seen.changed === 2 && rec.seen?.length === 1 && rec.bonus?.length === 1 && /seen already/.test(seen.why[0]) && /paid already/.test(seen.why[1]), 'a thing seen, and a quest bonus paid, are each written once');
}

// ---- whole, clamped, and the closed list --------------------------------------------------------------------
{
  const rec = emptyRecord('c1');
  const out = applyProgress(rec, [
    { k: 'core', skill: 'marksmanship', xp: 12.5 },
    { k: 'core', skill: 'marksmanship', xp: -4 },
    { k: 'core', skill: 'jumping', xp: 4 },
    { k: 'pool', pool: 'ballistics', xp: 4 },
    { k: 'node', id: 'demo.nothing', rec: { at: 1, xp: 0 } },
    { k: 'seen', key: 'not-a-hash' },
    { k: 'logRow', row: [5, 4, 2, 10] },
    { k: 'whatever' },
  ]);
  ok(out.changed === 0 && out.why.length === 8, 'a fraction, a number under nought, a skill or pool or node that is not one, a key that is no hash, a row that ends before it begins and a change of no kind are all refused');
  ok(applyProgress(rec, 'not a list').why[0] === 'that is not a list of changes', 'and a batch that is not a list is said to be none');
  const bad = applyProgress(rec, [
    { k: 'paid', key: '__proto__', at: 1 },
    { k: 'paid', key: 'constructor', at: 1 },
    { k: 'paid', key: 'prototype', at: 1 },
  ]);
  ok(bad.changed === 0 && Object.getPrototypeOf(rec) === Object.prototype && !(rec as Record<string, unknown>).polluted, 'the three names the language gives a meaning to are refused as keys');
  ok(cleanRecord({ v: 1, char: '__proto__', rev: 0, base: 0, local: 0, core: {}, pools: {}, nodes: {} }) === null, 'and as a character');
  const raw = JSON.parse('{"v":1,"char":"c9","rev":2,"base":0,"local":1,"core":{"marksmanship":400},"pools":{},"nodes":{},"paid":{"__proto__":{"x":1},"e1":5},"extra":{"__proto__":1}}');
  const r = cleanRecord(raw)!;
  ok(r && Object.getPrototypeOf(r.paid!) === null && Object.keys(r.paid!).join() === 'e1' && r.extra === undefined, 'a record read back keeps no reserved key in a table, nor a later section carrying one');
  ok(cleanRecord({ ...raw, later: { kept: [1, 'two'] } })!.later !== undefined, "and keeps a later wave's plain section");
}

// ---- limits: refused past, never trimmed, and a server's larger batch under the backstop --------------------
{
  const small: ProgressLimits = { ...PROGRESS_LIMITS, seen: 3 };
  const rec = emptyRecord('c1');
  applyProgress(rec, [1, 2, 3].map((n) => ({ k: 'seen', key: h(n) })), small);
  const past = applyProgress(rec, [{ k: 'seen', key: h(4) }], small);
  ok(past.changed === 0 && rec.seen?.length === 3 && /3 things seen/.test(past.why[0]), 'a change that would take a list past the limits it is handed is refused, and nothing is trimmed to make room');
  // A host with a list of three makes room by a drop of its own, oldest first, written in the batch.
  const room = trimFor(rec, 'seen', small)!;
  ok(room.length === 1 && room[0].k === 'seenDrop' && (room[0] as { key: string }).key === h(1), 'the host that makes the batch writes the trim as a change: the oldest out first');
  const batch: ProgressChange[] = [...room, { k: 'seen', key: h(4) }];
  const theirs = clone(rec);
  ok(applyProgress(rec, batch, small).changed === 2, 'and its own batch then fits its own limits');
  ok(applyProgress(theirs, batch, PROGRESS_BACKSTOP).changed === 2 && same(rec, theirs), "another host applying that batch under the backstop arrives at the very same record, whatever its own limits");
  // A server with longer lists than this browser: its batch is taken whole here under the backstop, and refused under the browser's own.
  const server: ProgressLimits = { ...PROGRESS_LIMITS, seen: 300 };
  const big = emptyRecord('c1');
  const fill: ProgressChange[] = [];
  for (let n = 0; n < 250; n++) fill.push({ k: 'seen', key: h(1000 + n) });
  ok(applyProgress(big, fill, server).changed === 250, "a server whose limits a --set moved fills a list past this browser's own");
  const here = emptyRecord('c1');
  ok(applyProgress(here, fill, PROGRESS_BACKSTOP).changed === 250 && same(here, big), 'this browser applies that batch under the backstop and holds what the server holds');
  ok(applyProgress(emptyRecord('c1'), fill, PROGRESS_LIMITS).changed === PROGRESS_LIMITS.seen, 'where its own limits would have refused the rest');
  ok(Object.isFrozen(PROGRESS_BACKSTOP) && tuneProgress({ backstop: { seen: 1 } }).refused !== undefined && PROGRESS_BACKSTOP.seen === 2000, 'the backstop is fixed: asked to move it, the tune says no and nothing moves');
  // A limit asked past the backstop stops at it, and says so: a list grown past it would be cut, oldest first,
  // the next time the record is read back, and a payment cut so could be paid again.
  const was = { ...PROGRESS_LIMITS };
  const asked = tuneProgress({ limits: { paid: 5000, seen: 300 } });
  ok(PROGRESS_LIMITS.paid === PROGRESS_BACKSTOP.paid && PROGRESS_LIMITS.seen === 300 && /paid 1000/.test(asked.held ?? '') && !/seen/.test(asked.held ?? ''), `a limit asked past the backstop is held at it, and said (${asked.held}); one under it is moved`);
  ok(tuneProgress({ limits: { paid: 1000 } }).held === undefined, 'a limit asked at the backstop itself is taken as it is');
  tuneProgress({ limits: was });
  ok(Object.keys(was).every((k) => PROGRESS_LIMITS[k as keyof ProgressLimits] === was[k as keyof ProgressLimits]), 'and put back as it was');
  // The trims for tables, oldest first and ties by key, and a payment never dropped while it is young.
  const t = emptyRecord('c1');
  applyProgress(t, [
    { k: 'recent', key: h(5), at: 50, n: 1 },
    { k: 'recent', key: h(6), at: 40, n: 1 },
    { k: 'recent', key: h(7), at: 40, n: 1 },
  ]);
  const twoRecent = trimFor(t, 'recent', { ...PROGRESS_LIMITS, recent: 2 })!;
  const firstAt40 = [h(6), h(7)].sort()[0];
  ok(twoRecent.length === 2 && (twoRecent[0] as { key: string }).key === firstAt40, 'a table is trimmed oldest first, two of an age by their key');
  applyProgress(t, [
    { k: 'paid', key: 'e-old', at: 10 },
    { k: 'paid', key: 'e-new', at: 900 },
  ]);
  ok(trimFor(t, 'paid', { ...PROGRESS_LIMITS, paid: 2 }, 500)?.length === 1, 'an old payment may be dropped to make room');
  ok(trimFor(t, 'paid', { ...PROGRESS_LIMITS, paid: 1 }, 500) === null, 'but room is never made by dropping one younger than a claim may be: the claim is refused instead');
}

// ---- cleanRecord repairs a tree and holds the Skill Points -----------------------------------------------------
{
  const raw = {
    v: 1,
    char: 'c3',
    rev: 4,
    base: 0,
    local: 4,
    core: { marksmanship: 1e9, melee: 12.7, fortitude: -5 },
    pools: { demolitions: 1e9 },
    nodes: {
      'demo.nothing': { at: 1, xp: 0 },
      'demo.ordnance.2': { at: 5, xp: 0 },
      'demo.charges.1': { at: 3, xp: 0 },
      'demo.charges.2': { at: 4, xp: 0 },
    },
  };
  const r = cleanRecord(raw)!;
  ok(Object.keys(r.nodes).length === 0, 'a node the data has not got is dropped, and so is every node whose way down is missing, again and again until the tree stands (no Novice: nothing stands)');
  ok(r.core.marksmanship === xpCap(PROGRESS_RULES) && r.core.melee === 12 && r.core.fortitude === undefined && r.pools.demolitions === PROGRESS_RULES.bankCap, 'core XP is held to what 100 needs, whole; a pool to the bank cap');
  const tree = cleanRecord({ ...raw, nodes: { 'demo.novice': { at: 1, xp: 1000 }, 'demo.ordnance.2': { at: 5, xp: 0 }, 'demo.ordnance.1': { at: 2, xp: 0 }, 'demo.charges.2': { at: 4, xp: 0 } } })!;
  ok(Object.keys(tree.nodes).sort().join() === 'demo.novice,demo.ordnance.1,demo.ordnance.2', 'a branch node over a missing one is dropped, the rest of the tree kept');
  // Listed above what it stands on, a node outlives a pass over the list that takes its footing only after it:
  // a branch listed top first, standing on nothing, needs a pass for every tier of it, more than the two times
  // the tree is repaired.
  const above = cleanRecord({ ...raw, nodes: { 'demo.charges.4': { at: 6, xp: 0 }, 'demo.charges.3': { at: 5, xp: 0 }, 'demo.charges.2': { at: 4, xp: 0 }, 'demo.charges.1': { at: 3, xp: 0 } } })!;
  ok(Object.keys(above.nodes).length === 0, 'a branch listed top first, whose first tier goes for want of the Novice, goes whole');
  const higher = cleanRecord({ ...raw, nodes: { 'demo.novice': { at: 1, xp: 0 }, 'demo.charges.4': { at: 5, xp: 0 }, 'demo.charges.3': { at: 4, xp: 0 }, 'demo.charges.2': { at: 3, xp: 0 } } })!;
  ok(Object.keys(higher.nodes).join() === 'demo.novice', 'and with the Novice there, a branch with its first tier missing goes whole, its top first in the list');
  // The count of nodes is a backstop of its own: past it the latest-learnt go, and then whatever stood on them.
  const few = cleanRecord({ ...raw, nodes: { 'demo.novice': { at: 1, xp: 0 }, 'demo.ordnance.1': { at: 5, xp: 0 }, 'demo.ordnance.2': { at: 6, xp: 0 }, 'demo.charges.1': { at: 2, xp: 0 } } }, { ...PROGRESS_LIMITS, nodes: 3 })!;
  ok(Object.keys(few.nodes).sort().join() === 'demo.charges.1,demo.novice,demo.ordnance.1', 'past the count of nodes the latest-learnt go first');
  const orphaned = cleanRecord({ ...raw, nodes: { 'demo.novice': { at: 1, xp: 0 }, 'demo.ordnance.2': { at: 3, xp: 0 }, 'demo.ordnance.1': { at: 5, xp: 0 } } }, { ...PROGRESS_LIMITS, nodes: 2 })!;
  ok(Object.keys(orphaned.nodes).join() === 'demo.novice', 'and a node whose footing that took goes after it');
  // A list read back past its limit keeps its newest, and once each.
  const long = cleanRecord({ ...raw, nodes: {}, seen: [h(0), ...Array.from({ length: 300 }, (_, n) => h(n)), h(5)], bonus: Array.from({ length: 250 }, (_, n) => h(n)) })!;
  ok(long.seen?.length === PROGRESS_LIMITS.seen && long.seen[0] === h(300 - PROGRESS_LIMITS.seen) && long.seen[PROGRESS_LIMITS.seen - 1] === h(299) && new Set(long.seen).size === long.seen.length, `a list of things seen read back past its limit keeps the newest ${PROGRESS_LIMITS.seen}, each once`);
  ok(long.bonus?.length === PROGRESS_LIMITS.bonus && long.bonus[PROGRESS_LIMITS.bonus - 1] === h(249), 'and the quest bonuses the same');
  const paidLong = cleanRecord({ ...raw, nodes: {}, paid: Object.fromEntries(Array.from({ length: 150 }, (_, n) => [`e${n}`, 1000 + n])) })!;
  ok(Object.keys(paidLong.paid!).length === PROGRESS_LIMITS.paid && paidLong.paid!.e149 === 1149 && paidLong.paid!.e49 === undefined && paidLong.paid!.e50 === 1050, 'and the payments keep the newest by when they were paid');
  const tight = { ...PROGRESS_RULES, spCap: 20 };
  const capped = cleanRecord({ ...raw, nodes: { 'demo.novice': { at: 1, xp: 0 }, 'demo.ordnance.1': { at: 2, xp: 0 }, 'demo.ordnance.2': { at: 3, xp: 0 }, 'demo.ordnance.3': { at: 4, xp: 0 } } }, PROGRESS_LIMITS, tight)!;
  ok(spSpent(capped) <= 20 && Object.keys(capped.nodes).sort().join() === 'demo.novice,demo.ordnance.1,demo.ordnance.2', `past the Skill Point cap the latest-learnt go first, until it fits (${spSpent(capped)} of 20)`);
  const master = grantChanges(emptyRecord('c4'), 'demo.master', 7, PROGRESS_RULES);
  const m = emptyRecord('c4');
  applyProgress(m, master.ch);
  ok(!master.why && spSpent(m) === 8 + 3 * 28 + 14 && cleanRecord(JSON.parse(recordText(m)))!.nodes['demo.master'] !== undefined, `the Master stands on three whole branches (${spSpent(m)} Skill Points) and survives being read back`);
  const unlearn = unlearnChanges(m, 'demo.grenadier.2', 9);
  applyProgress(m, unlearn.ch);
  ok(!m.nodes['demo.grenadier.2'] && !m.nodes['demo.grenadier.3'] && !m.nodes['demo.grenadier.4'] && !m.nodes['demo.master'] && m.nodes['demo.grenadier.1'] !== undefined && m.gone?.['demo.grenadier.2'] === 9, 'taking a node away takes what stands on it -- the rest of its branch and the Master -- and writes each as surrendered');
}

// ---- a full record fits ----------------------------------------------------------------------------------------
{
  const full = emptyRecord('character-with-a-long-id-0123456789');
  const ch: ProgressChange[] = [];
  for (const s of ['athletics', 'acrobatics', 'marksmanship', 'melee', 'fortitude', 'awareness', 'finesse'] as const) ch.push({ k: 'core', skill: s, xp: xpCap(PROGRESS_RULES) });
  ch.push({ k: 'pool', pool: 'demolitions', xp: PROGRESS_RULES.bankCap }, { k: 'earned', pool: 'demolitions', xp: 999999999 });
  const g = grantChanges(full, 'demo.master', 1_800_000_000, PROGRESS_RULES);
  ch.push(...g.ch);
  for (const id of ['demo.launchers.1', 'demo.launchers.2', 'demo.launchers.3', 'demo.launchers.4']) ch.push({ k: 'gone', id, at: 1_800_000_000 });
  for (let n = 0; n < PROGRESS_LIMITS.seen; n++) ch.push({ k: 'seen', key: h(n) });
  for (let n = 0; n < PROGRESS_LIMITS.recent; n++) ch.push({ k: 'recent', key: h(5000 + n), at: 1_800_000_000 + n, n: 99 });
  for (let n = 0; n < PROGRESS_LIMITS.paid; n++) ch.push({ k: 'paid', key: `e${(1_800_000_000_000 + n).toString(36)}abcd`, at: 1_800_000_000 + n });
  for (let n = 0; n < PROGRESS_LIMITS.bonus; n++) ch.push({ k: 'bonus', key: h(9000 + n) });
  for (let n = 0; n < PROGRESS_LIMITS.log; n++) ch.push({ k: 'logRow', row: [1_800_000_000 + n * 400, 1_800_000_000 + n * 400 + 299, n % 8, 99999] });
  ch.push({ k: 'last', at: 1_800_000_000 }, { k: 'rested', xp: PROGRESS_RULES.restedMax });
  const out = applyProgress(full, ch);
  const size = recordText(full).length;
  ok(out.why.length === 0 && size < RECORD_MAX, `a record at every cap is ${size} characters, under the ${RECORD_MAX} a record may be`);
}

// ---- the store and the client --------------------------------------------------------------------------------
{
  const store = mapStore();
  const rec = emptyRecord('c5');
  applyProgress(rec, [{ k: 'core', skill: 'melee', xp: 900 }]);
  rec.local = 3;
  ok(saveRecord(store, rec) && store.map.has('swg.progress.c5') && same(loadRecord(store, 'c5')!, rec), 'a record kept is read back the same, under swg.progress.<character>');
  ok(loadRecord(store, 'c6') === null && localOf(store, 'c5') === 3 && localOf(store, 'nobody') === 0, "another character has none, and a kept record's count is read without making it anybody's");
  setAside(store, rec);
  setAside(store, rec);
  setAside(store, rec);
  setAside(store, rec);
  ok(asides(store, 'c5').join() === '2,3,4' && !store.map.has('swg.progress.c5.aside.1'), 'set-aside copies keep the last three');
  let now = 1_700_000_000_000;
  const client = new ProgressClient({ store, now: () => now });
  const told: [string, number][] = [];
  client.onChange((why, was) => told.push([why, was]));
  client.use('c7');
  ok(client.record?.char === 'c7' && client.local === 0 && told[0][0] === 'use', 'a character with nothing kept starts with the empty record');
  ok(client.localOf('c5') === 3 && client.record?.char === 'c7', "the count of a character it does not hold is the stored record's, and asking moves nothing");
  const res = client.debug({ grant: 'demo.ordnance.1' });
  ok(res[0].ok === true && client.local === 1 && told[1][0] === 'mine' && told[1][1] === 0 && client.record!.nodes['demo.novice'] !== undefined, 'a grant goes through the record\'s own changes, with the Novice it needs, counted in local and told');
  now += 5000;
  client.debug({ xp: { demolitions: 5000, marksmanship: 400 } });
  ok(client.record!.pools.demolitions === 5000 && client.record!.core.marksmanship === 400 && client.record!.earned?.demolitions === 5000 && client.local === 2, 'XP given lands in the pool and the core skill');
  const reloaded = new ProgressClient({ store, now: () => now });
  reloaded.use('c7');
  ok(same(reloaded.record!, client.record!), 'a reload reads the very record');
  const mark = (local: number) => characterMark({ name: 'X', progress: { local } });
  ok(mark(0) === characterMark({ name: 'X' }) && mark(2) !== mark(0) && mark(2) !== mark(3), "the character's mark carries progress only while a batch made alone is waiting, so every mark from before is the mark it was");
  client.debug({ reset: true });
  ok(Object.keys(client.record!.nodes).length === 0 && !client.record!.pools.demolitions && !client.record!.core.marksmanship && client.local === 3, 'a reset empties the record through its own changes, and is a change made here too');
  ok(client.debug({ grant: 'demo.nope' })[0].ok === false && client.debug({ surrender: 'demo.novice' })[0].ok === false, 'a node that is not one, or one not learnt, is refused in words');
  client.use(null);
  ok(client.record === null && client.debug({ grant: 'demo.novice' })[0].ok === false, 'with no character in play nothing is held and nothing is changed');
}

// ---- the passives: what each Demolitions node does the day it is owned --------------------------------------------
{
  const owning = (id: string): PlayerStats => {
    const rec = emptyRecord('c8');
    applyProgress(rec, grantChanges(rec, id, 1, PROGRESS_RULES).ch);
    const s = new PlayerStats();
    s.update(rec);
    return s;
  };
  const thermal = GADGETS.find((g) => g.id === 'thermal')!.grenade!;
  const proton = GADGETS.find((g) => g.id === 'proton')!.grenade!;
  ok(owning('demo.ordnance.1').blastSelf === 0.21, 'Blast Discipline: your own blast takes 0.21 of its damage (0.35 x 0.6)');
  ok(owning('demo.ordnance.2').grenade(thermal).radius === 8.4 && thermal.radius === 7, "Shrapnel Casing: a thermal detonator's radius 8.4 (its own 7 untouched)");
  ok(owning('demo.ordnance.2').apply('blast.radius', 6) === 6 * 1.2, "and a det pack's 6 m with it");
  ok(owning('demo.charges.4').apply('blast.machines', proton.machines ?? 1) === 4.5, "Demolition Expert: a proton grenade's machines 4.5 (its 3 times 1.5)");
  const quick = owning('demo.launchers.2');
  ok(quick.gun('rocket').primary.fireTime === 0.675 && quick.gun('rocket').alt?.fireTime === 1.2 * 0.75 && GUNS.rocket.primary.fireTime === 0.9 && quick.gun('blaster').primary.fireTime === GUNS.blaster.primary.fireTime, "Quick Reload: the rocket fires again at 0.675 s (both triggers), and no other gun's refire moves");
  ok(owning('demo.launchers.1').pickCos === 0.8, 'Launcher Familiarity: the homing rocket picks its mark within a cosine of 0.8');
  ok(owning('demo.grenadier.1').throwLift === 4 * PROGRESS_RULES.demo.steadyArm, 'Steady Arm: the lift with the speed');
  ok(owning('demo.charges.3').packs === 3 && owning('demo.charges.1').packs === 2 && owning('demo.charges.3').chainReach === 1, 'Detonite Handling two det packs, Chain Detonation three and the chain to the whole radius (read by the mechanics\' wave)');
  const twin = owning('demo.grenadier.4');
  ok(twin.grenadeCooldown === PROGRESS_RULES.demo.twinCooldown && twin.grenadeCount === PROGRESS_RULES.demo.twinCount, `Twin Toss: a grenade's cooldown times ${twin.grenadeCooldown}, ${twin.grenadeCount} a throw`);
}

// ---- the core skills: what each rating does to the player's kept fields -------------------------------------------
{
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-12;
  const rated = (skills: Partial<Record<'marksmanship' | 'melee' | 'fortitude' | 'acrobatics', number>>): PlayerStats => {
    const rec = emptyRecord('c10');
    for (const [skill, r] of Object.entries(skills)) rec.core[skill as 'melee'] = xpFor(r, PROGRESS_RULES);
    const s = new PlayerStats();
    ok(s.update(rec), `a record rated ${Object.entries(skills).map(([k, r]) => `${k} ${r}`).join(', ')} moves the stats`);
    return s;
  };
  const core = PROGRESS_RULES.core;
  const all = rated({ marksmanship: 100, melee: 100, fortitude: 100, acrobatics: 100 });
  ok(all.healthMax === 100 + core.fortitude.health && near(all.burnScale, core.fortitude.burn * core.fortitude.burnMore), `Fortitude 100: whole health ${all.healthMax}, a burn's seconds times ${all.burnScale} (its curve and its 25)`);
  ok(near(all.saberSwing, core.melee.swing) && near(all.meleePush, core.melee.push), `Melee 100: the saber swings times ${all.saberSwing}, a kick or a fist shoves times ${all.meleePush}`);
  ok(all.aimRate === core.marksmanship.aimRate && all.steady === core.marksmanship.steady && near(all.gun('blaster').primary.spread, GUNS.blaster.primary.spread * core.marksmanship.spread), 'Marksmanship 100: the snap aim, the steady breath and the spread at its curve\'s end');
  ok(near(all.fallSafeExtra, core.acrobatics.safeExtra) && near(all.rollDivisor, 3 + core.acrobatics.rollDivisor) && near(all.airAccel, core.acrobatics.airAccel) && near(all.rollIframes, core.acrobatics.iframes) && all.rollFree === core.acrobatics.rollFree, `Acrobatics 100: ${all.fallSafeExtra} m more of a harmless fall, a roll divides by ${all.rollDivisor}, air control times ${all.airAccel}, ${all.rollIframes} s of a roll's dodge, a free roll from ${all.rollFree} m`);
  const quarter = rated({ fortitude: 25, marksmanship: 25 });
  ok(near(quarter.healthMax, 100 + (core.fortitude.health * 25) / 100) && near(quarter.burnScale, (1 + ((core.fortitude.burn - 1) * 25) / 100) * core.fortitude.burnMore), `Fortitude 25: a quarter of the health and of the burn's curve, and its milestone whole (${quarter.healthMax}, ${quarter.burnScale})`);
  ok(quarter.steady === core.marksmanship.steady && quarter.aimRate === 0.15, 'Marksmanship 25: the steady breath, and the view still at today\'s rate until 50');
  const half = rated({ marksmanship: 50 });
  ok(half.aimRate === core.marksmanship.aimRate && near(half.gun('disruptor').primary.aimSpread, GUNS.disruptor.primary.aimSpread *(1 + ((core.marksmanship.aimSpread - 1) * 50) / 100)), 'Marksmanship 50: the snap aim, and the aimed spread half way along its curve');
}

// ---- layers, ops and clamps --------------------------------------------------------------------------------------
{
  const r = resolveGrants([
    { stat: 'health.max', op: 'set', value: 50, layer: 'discipline', from: 'test set' },
    { stat: 'health.max', op: 'mul', value: 2, layer: 'core', from: 'test mul' },
  ]);
  ok(r.apply('health.max', 100) === 50 * 1 && r.layers('health.max').map((l) => l.layer).join() === 'core,discipline', 'layers run in the doc\'s order whatever order the grants come in: the core layer\'s x2 first, then the discipline\'s set wins');
  const within = resolveGrants([
    { stat: 'throw.lift', op: 'mul', value: 2, layer: 'discipline', from: 'a' },
    { stat: 'throw.lift', op: 'add', value: 1, layer: 'discipline', from: 'b' },
    { stat: 'throw.lift', op: 'set', value: 5, layer: 'discipline', from: 'c' },
    { stat: 'throw.lift', op: 'set', value: 6, layer: 'discipline', from: 'd' },
  ]);
  ok(within.apply('throw.lift', 4) === (6 + 1) * 2, 'within a layer the set comes first (the last one wins), then the adds, then the multiplies');
  const clamped = resolveGrants([
    { stat: 'blast.self', op: 'set', value: 2, layer: 'discipline', from: 'x' },
    { stat: 'health.max', op: 'add', value: 1e9, layer: 'core', from: 'y' },
  ]);
  ok(clamped.apply('blast.self', 0.35) === 1 && clamped.apply('health.max', 100) === 10000, 'then the clamp');
  const nothing = resolveGrants([
    { stat: 'blast.self', op: 'mul', value: 1, layer: 'discipline', from: 'nothing' },
    { stat: 'health.max', op: 'add', value: 0, layer: 'core', from: 'nothing' },
  ]);
  ok(nothing.touched().length === 0, 'a grant of nothing writes no entry');
  // A core skill's curve, from its own numbers, and its milestone.
  const rec = emptyRecord('c9');
  rec.core.acrobatics = 40 * 25 ** 1.5;
  const acro = resolveStats(rec, PROGRESS_RULES);
  ok(acro.apply('fall.rollFree', 0) === PROGRESS_RULES.core.acrobatics.rollFree && acro.apply('fall.rollDivisor', 3) === 3 + (PROGRESS_RULES.core.acrobatics.rollDivisor * 25) / 100 && acro.layers('fall.rollFree')[0].from.join().includes('Acrobatics 25'), 'Acrobatics 25: its curve a quarter of the way, and the 8 m roll whole, said as the milestone it is');
}

console.log(`\n${checks} checks passed`);
