// A character's progress held by this browser alone (`src/progress/progressClient.ts`), over a storage of the
// test's own: fights claimed and paid, a roll, learning and giving back with a purse, and a quest's bonus paid
// through the story's own wallet (`payLocally`) from a quest of the committed test set run through the real
// book client and host.
//
// What is pinned here:
//
//   - a claim applies, counts as a change made here (`local`), and a reload reads the very record;
//   - the character's change mark carries `x:` only while there are changes made here, and a mark with none is
//     the mark it was before there was progress;
//   - a bonus order goes through the wallet's own `bonus`, and with none pays nothing and refuses nothing;
//   - the test set's own quest, run through the story's host, pays its experience as a bonus into the skill the
//     test's fight used while it ran, and only that one;
//   - a batch that would take the record past the most it may be written out as is refused whole;
//   - giving a node back waits for the purse, and does nothing when the purse will not pay.
//
// Synthetic: no browser, no socket, nothing read from the game's files.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BookClient, type StoryLine } from '../../../src/story/bookClient.ts';
import { LocalHost, jobsWait, payLocally, type LocalWallet } from '../../../src/story/localHost.ts';
import type { PayOrder } from '../../../src/story/quests.ts';
import { StoryWatch, type WatchPlace } from '../../../src/world/storyWatch.ts';
import { characterMark } from '../../../src/net/session.ts';
import { readStorySet } from '../../../server/storySet.mjs';
import { ProgressClient } from '../../../src/progress/progressClient.ts';
import type { ProgressStorage } from '../../../src/progress/progressStore.ts';
import type { EncounterClaim } from '../../../src/progress/payout.ts';
import { RECORD_MAX, copyRecord, emptyRecord, fnv32, recordText, secondsOf } from '../../../src/progress/record.ts';
import { xpFor } from '../../../src/progress/core.ts';
import { nodeById } from '../../../src/progress/disciplines.ts';
import { surrenderFee } from '../../../src/progress/learn.ts';
import { PROGRESS_RULES } from '../../../src/progress/tune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const T0 = 1_800_000_000_000;
const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));
const TEST_FILES = readStorySet(TESTSET).files;
const CANTINA = 'object/building/tatooine/shared_cantina_tatooine.iff';

const mapStore = (): ProgressStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => (map.set(k, v), true), remove: (k) => void map.delete(k) };
};
/** A record as text with every object's keys sorted: the same record whatever order its fields were written in. */
const canon = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v));
let ids = 0;
const claim =(at: number, o: Partial<EncounterClaim> = {}): EncounterClaim => ({ id: `etest${ids++}`, at, outcome: 'won', used: ['marksmanship'], heavy: false, planet: 'tatooine', diff: 1, members: [{ npc: 'test_kreetle', level: 1, dead: true, fought: true, share: 0 }], ...o });

// ---- claims apply, count and are kept ----------------------------------------------------------------------------
{
  const store = mapStore();
  const clock = { now: T0 };
  const said: string[] = [];
  const client = new ProgressClient({ store, now: () => clock.now, say: (l) => said.push(l) });
  client.use('char-1');
  const o = client.claim(claim(T0));
  ok(o.ok && o.paid?.marksmanship === 50 && client.record!.core.marksmanship === 50 && client.local === 1, `a fight claimed is paid and applied here, a change made here (${o.paid?.marksmanship})`);
  ok(said.includes('Marksmanship +50') && o.notes.includes('Marksmanship +50'), 'and said on the message line in one line');
  clock.now += 1000;
  const twice = client.claim({ ...claim(T0), id: 'etest-dup' });
  const again = client.claim({ ...claim(T0), id: 'etest-dup' });
  ok(twice.ok && !again.ok && client.local === 2, 'the same claim twice pays once');
  const roll = client.task({ id: 'rtest-1', at: clock.now, kind: 'roll', fell: 6, saved: 30 });
  ok(roll.ok && client.record!.core.acrobatics === 60, 'a landing roll that saved some of a fall pays Acrobatics');
  const reloaded = new ProgressClient({ store, now: () => clock.now });
  reloaded.use('char-1');
  ok(canon(reloaded.record) === canon(client.record), 'a reload reads the very record, every field of it (its keys in the order a read writes them)');
  // The mark: progress only while there is any made here, and a mark with none is today's.
  const c = { name: 'Test', outfit: [], items: [] };
  ok(characterMark({ ...c }) === characterMark({ ...c, progress: { local: 0 } }), "a character with no progress made here keeps the mark it had before there was progress");
  const marks = new Set([1, 2, 3].map((n) => characterMark({ ...c, progress: { local: n } })));
  ok(marks.size === 3 && !marks.has(characterMark({ ...c })), 'and one with changes made here is marked by how many, each count its own mark');
}

// ---- the most a record may be ---------------------------------------------------------------------------------------
{
  const store = mapStore();
  const client = new ProgressClient({ store, now: () => T0 });
  client.use('char-2');
  // A fight paid first, so every list the batch below writes into is already there: a copy that shared a list with
  // the record held would carry the refused batch's entries into it.
  client.claim(claim(T0));
  // A later wave's section, kept as plain data, made big enough that one more change would take the record past the line.
  const rec = client.record!;
  const row = rec.log![0];
  ok(!!rec.seen?.length && !!rec.log?.length && Object.keys(rec.recent ?? {}).length > 0 && Object.keys(rec.paid ?? {}).length > 0, 'a record with a fight paid holds a list of each kind');
  rec.padding = 'x'.repeat(RECORD_MAX - recordText(rec).length - 30);
  const before = canon(rec);
  const r = client.apply([
    { k: 'core', skill: 'marksmanship', xp: 40000 },
    { k: 'seen', key: fnv32('test:refused:seen') },
    { k: 'logRow', row: [row[0], row[1] + 5, row[2], row[3] + 7] },
    { k: 'logRow', row: [row[0] + 100, row[0] + 100, row[2], 9] },
    { k: 'recent', key: fnv32('test:refused:recent'), at: secondsOf(T0), n: 1 },
    { k: 'paid', key: 'etest-refused', at: secondsOf(T0) },
    { k: 'bonus', key: fnv32('test:refused:bonus') },
    { k: 'last', at: 1_800_000_000 },
  ]);
  ok(r.changed === 0 && /past/.test(r.why.join()) && canon(client.record) === before && client.record === rec, 'a batch that would take the record past the most it may be written out as is refused whole, and the record is as it was, every list of it');
}
{
  // The copy a batch is tried on is a copy all the way down: written into, the record it was made from is untouched.
  const rec = emptyRecord('char-copy');
  rec.core.marksmanship = 100;
  rec.pools.demolitions = 500;
  rec.nodes['demo.novice'] = { at: 1, xp: 1000 };
  rec.seen = [fnv32('test:a')];
  rec.recent = Object.assign(Object.create(null), { [fnv32('test:r')]: [1, 1] as [number, number] });
  rec.paid = Object.assign(Object.create(null), { etestcopy: 1 });
  rec.bonus = [fnv32('test:b')];
  rec.log = [[1, 2, 2, 30]];
  rec.earned = Object.assign(Object.create(null), { demolitions: 500 });
  rec.gone = Object.assign(Object.create(null), { 'demo.grenadier.1': 1 });
  const before = canon(rec);
  const c = copyRecord(rec);
  c.core.marksmanship = 9;
  c.pools.demolitions = 9;
  c.nodes['demo.novice'].xp = 9;
  c.seen!.push('x');
  c.recent![fnv32('test:r')][1] = 9;
  c.paid!.etestcopy = 9;
  c.bonus!.push('x');
  c.log![0][3] = 9;
  c.log!.push([9, 9, 9, 9]);
  c.earned!.demolitions = 9;
  c.gone!['demo.grenadier.1'] = 9;
  ok(canon(rec) === before, 'every table, list and row of a copied record is its own');
}

// ---- learning and giving back, with a purse --------------------------------------------------------------------------
{
  const store = mapStore();
  const said: string[] = [];
  const client = new ProgressClient({ store, now: () => T0, say: (l) => said.push(l) });
  client.use('char-3');
  client.debug({ xp: { demolitions: 3000 } });
  ok(!client.learn('demo.novice', null).ok, 'the Novice is not learnt away from a trainer');
  const l = client.learn('demo.novice', 'trainer_commando');
  ok(l.ok && !!client.record!.nodes['demo.novice'] && said.includes('Learnt Demolitions Novice'), 'and is from a commando trainer, and said');
  const credits = { n: 300 };
  const purse = { spend: (n: number, _what: string, then: () => void) => (credits.n >= n ? ((credits.n -= n), then()) : undefined) };
  const poor = client.surrender('demo.novice', 'trainer_commando', purse);
  ok(poor.ok && !!client.record!.nodes['demo.novice'], 'giving it back waits on the purse, and a purse that will not pay leaves it learnt');
  credits.n = 1000;
  let done = false;
  client.surrender('demo.novice', 'trainer_commando', purse, (o) => (done = o.ok));
  ok(done && !client.record!.nodes['demo.novice'] && credits.n === 500 && said.includes('Gave back Demolitions Novice for 500 credits'), 'one that pays takes the fee and then the node, and says so');
}
{
  // A server's purse answers later, keeps one answer waiting, and a second spend meanwhile would take its place.
  const store = mapStore();
  const said: string[] = [];
  const client = new ProgressClient({ store, now: () => T0, say: (l) => said.push(l) });
  client.use('char-5');
  client.debug({ xp: { demolitions: 50000 } });
  for (const id of ['demo.novice', 'demo.grenadier.1', 'demo.grenadier.2']) client.learn(id, 'trainer_commando');
  ok(!!client.record!.nodes['demo.grenadier.2'], 'a character with three nodes learnt');
  const waiting: (() => void)[] = [];
  let fees = 0;
  const slow = { spend: (n: number, _what: string, then: () => void) => void (fees += n, waiting.push(then)), busy: () => waiting.length > 0 };
  const outcomes: { ok: boolean; why?: string }[] = [];
  const first = client.surrender('demo.grenadier.2', 'trainer_commando', slow, (o) => outcomes.push(o));
  const second = client.surrender('demo.grenadier.1', 'trainer_commando', slow, (o) => outcomes.push(o));
  ok(first.ok && !second.ok && /still answering/.test(second.why ?? '') && waiting.length === 1 && fees === 1500, 'nothing more is given back while the purse is still answering for the last fee: one fee asked, one answer waited on');
  // While it answers, the node is learnt upon at the trainer: when the fee comes through, it can no longer go.
  client.learn('demo.grenadier.3', 'trainer_commando');
  const before = canon(client.record);
  waiting.shift()!();
  ok(canon(client.record) === before && !!client.record!.nodes['demo.grenadier.2'] && outcomes.length === 1 && !outcomes[0].ok && /fee for .* went, and it was not given back: .*stands on/.test(outcomes[0].why ?? ''), `worked out again when the fee comes through, it is refused against the record as it stands, nothing written, and said in words that say the fee went (${outcomes[0]?.why})`);
  const quiet = client.surrender('demo.grenadier.3', 'trainer_commando', slow);
  waiting.shift()!();
  const third = nodeById('demo.grenadier.3')!;
  ok(quiet.ok && !client.record!.nodes['demo.grenadier.3'] && said.includes(`Gave back ${third.name} for ${surrenderFee(third).toLocaleString('en-GB')} credits`), `and once the purse has answered, the next is given back as ever (${said.at(-1)})`);
}

// ---- each pool held to its bucket, and a milestone said --------------------------------------------------------------------
{
  const store = mapStore();
  const said: string[] = [];
  const clock = { now: T0 };
  const client = new ProgressClient({ store, now: () => clock.now, say: (l) => said.push(l) });
  client.use('char-6');
  // Four big fights in one moment, each against creatures never met: far more than a minute's worth.
  const big = (k: number) => claim(clock.now, { members: Array.from({ length: 20 }, (_, i) => ({ npc: `test_bucket_${k}_${i}`, level: 90, dead: true, fought: true, share: 0 })) });
  let total = 0;
  for (let k = 0; k < 4; k++) total += client.claim(big(k)).paid?.marksmanship ?? 0;
  ok(total === PROGRESS_RULES.bucketMax && client.record!.core.marksmanship === PROGRESS_RULES.bucketMax, `fights claimed through the client are held to the pool's bucket (${total} of ${PROGRESS_RULES.bucketMax})`);
  clock.now += 60_000;
  const later = client.claim(big(5)).paid?.marksmanship ?? 0;
  ok(later === PROGRESS_RULES.perMinute, `and a minute on it has filled by a minute's worth (${later})`);
  // A payout that carries a skill past a milestone says so, a line of its own.
  const near = new ProgressClient({ store: mapStore(), now: () => T0, say: (l) => said.push(l) });
  near.use('char-7');
  near.debug({ xp: { marksmanship: xpFor(25, PROGRESS_RULES) - 10 } });
  said.length = 0;
  const o = near.claim(claim(T0));
  ok(o.ok && said.length === 2 && said[0] === 'Marksmanship +50' && said[1].startsWith('Marksmanship 25: ') && o.notes.join('|') === said.join('|'), `a payout that crosses a milestone says the gain and then the milestone (${said.join(' / ')})`);
}

// ---- the bonus through the story's own wallet --------------------------------------------------------------------------
{
  const order: PayOrder = { key: 'test:goto#1#out:done', bonus: { xp: 5, since: T0 } };
  const asked: PayOrder[] = [];
  const wallet: LocalWallet = { serverKeeps: () => false, credits: () => 0, give: () => {}, spend: () => {}, item: () => true, bonus: (o) => (asked.push(o), true) };
  ok(payLocally(order, wallet) && asked[0] === order, 'a bonus order goes through the wallet’s own bonus');
  const bare: LocalWallet = { serverKeeps: () => true, credits: () => 0, give: () => assert.fail('nothing is given for a bonus'), spend: () => assert.fail('nothing is spent'), item: () => assert.fail('nothing is handed over') };
  ok(payLocally(order, bare) === true, 'and a wallet with none pays nothing for it and refuses nothing');
}
{
  // The test set's own quest, run through the real book client and host, with a fight claimed while it ran.
  const store = new Map<string, string>();
  const storage = { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => (store.set(k, v), true), remove: (k: string) => void store.delete(k) };
  const clock = { now: T0, wall: 1000 };
  const line: StoryLine = { authority: 'me', story: 0, status: 'off', mode: 'off' };
  const world: WatchPlace & { inWorld: boolean } = { world: 'tatooine', x: 3000, z: -4000, room: null, inWorld: true };
  const said: string[] = [];
  const progress = new ProgressClient({ store: mapStore(), now: () => clock.now, say: (l) => said.push(l) });
  progress.use('char-1');
  const client = new BookClient({ store: storage, send: () => {}, say: () => {}, now: () => clock.now, wall: () => clock.wall, line: () => line, known: () => false });
  const watch = new StoryWatch();
  const why = () => jobsWait({ inPlay: !!client.book, holdsBook: client.holdsHere(), authority: line.authority });
  // The game's own wallet's bonus: into the progress this browser holds.
  const wallet: LocalWallet = {
    serverKeeps: () => false,
    credits: () => 25000,
    give: () => {},
    spend: (_n, then) => then(),
    item: () => true,
    bonus: (o) => {
      if (!o.bonus || progress.host !== 'local' || !progress.record) return false;
      progress.bonus(o.key, o.bonus.xp, o.bonus.since);
      return true;
    },
  };
  const host: LocalHost = new LocalHost({
    book: () => client.book,
    holds: () => why() === null,
    whyNot: why,
    apply: (ch) => client.applyLocal(ch),
    pay: (o) => payLocally(o, wallet),
    note: () => {},
    ctx: () => ({ world: world.world, here: [world.x, world.z], room: world.room, areas: [...watch.inside], credits: 25000, has: () => 0 }),
    now: () => clock.now,
    wall: () => clock.wall,
    inWorld: () => world.inWorld,
  });
  client.onChange(() => host.changed());
  client.use('char-1');
  host.setSets({ test: TEST_FILES });
  const tick = () => {
    host.tick();
    watch.step(host.view(), world, clock.wall, (ev) => host.event(ev));
  };
  // A fight before the quest is taken: its Melee is not the quest's.
  progress.claim(claim(T0, { used: ['melee'], members: [{ npc: 'test_before', level: 1, dead: true, fought: true, share: 0 }] }));
  clock.now = T0 + 60_000;
  ok(host.grant('test:goto').ok, 'the test set’s quest is taken');
  // A fight while it runs, with a gun.
  clock.now += 60_000;
  progress.claim(claim(clock.now, { members: [{ npc: 'test_during', level: 1, dead: true, fought: true, share: 0 }] }));
  const melee = progress.record!.core.melee ?? 0;
  const marks = progress.record!.core.marksmanship ?? 0;
  world.x += 30;
  tick();
  world.x = 3432;
  world.z = -4818;
  world.room = { cell: 'cantina', template: CANTINA };
  clock.wall += 300;
  clock.now += 60_000;
  tick();
  ok(client.book?.quests?.['test:goto']?.state === 'done' && client.book.xp === 5, 'walked to its end through the detectors, its experience recorded in the book');
  ok((progress.record!.core.marksmanship ?? 0) === marks + 5 && (progress.record!.core.melee ?? 0) === melee, `and paid as a bonus into the skill the fight during it used, none into the one before it (${(progress.record!.core.marksmanship ?? 0) - marks})`);
  ok(said.includes('Quest bonus: Marksmanship +5') && (progress.record!.bonus?.length ?? 0) === 1, 'said as a quest bonus, its key kept');
  host.restart('test:goto');
  ok((progress.record!.core.marksmanship ?? 0) === marks + 5, 'and never paid twice');
}

console.log(`\n${checks} checks passed`);
