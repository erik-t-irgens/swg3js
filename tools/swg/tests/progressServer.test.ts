// The server's half of a character's progress (`server/progress.mjs`), run here as a module over a world of its own
// in memory, written through the store's own `applyChange` and paying fees through a real `Purses`: settling a
// character's record the way the rest of the character is settled, every payout worked out by the server from a
// claim it checks and held to its own caps on what a claim carries, a shared body's death taken on the keeper's own
// word -- once to a character, and only while the body stays down -- and a claim that comes ahead of that word parked
// for it on the clock of its first hearing, two claims a second, a batch past the most a record may be refused
// whole, a record whose pieces stop coming given up, the buckets kept by character, a batch made under a moved limit
// that a browser applying it under the backstop arrives at exactly, and the browser's own client holding the very
// record the server does under a limit and caps moved past its own (through every way it reads one back), setting
// aside a copy the server would not take, waiting out a tie and pacing its queue; learning and giving back, the
// admin's own, a quest's bonus owed and paid once, the log played back and the world read back off the disk to the
// same records, the archive capped, and then the browser's own client against the module word for word.
//
// The relay round trip, the browser's `Net` and the worst hand-up on one claim are `progressRelay.test.ts`'s. Every
// number here is a TEST number: nothing is read from the game's files.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROGRESS_TUNING, Progress, applyProgressRec, readProgress, setProgressTuning } from '../../../server/progress.mjs';
import { PURSE_TUNING, Purses } from '../../../server/purse.mjs';
import { applyChange, emptyWorld, openStore } from '../../../server/store.mjs';
import { STORY_TUNING, Stories } from '../../../server/stories.mjs';
import { readStorySet } from '../../../server/storySet.mjs';
import { ProgressClient, type ProgressLine } from '../../../src/progress/progressClient.ts';
import { asideRecord, asides, type ProgressStorage } from '../../../src/progress/progressStore.ts';
import { XpBuckets, payClaim, type EncounterClaim } from '../../../src/progress/payout.ts';
import { LOG_SOURCES, applyProgress, cleanRecord, copyRecord, emptyRecord, fnv32, recordText, secondsOf, type ProgressRecord } from '../../../src/progress/record.ts';
import { xpCap } from '../../../src/progress/core.ts';
import { surrenderFee } from '../../../src/progress/learn.ts';
import { nodeById } from '../../../src/progress/disciplines.ts';
import { PROGRESS_BACKSTOP, PROGRESS_LIMITS, PROGRESS_RULES, PROGRESS_TUNE, copyRules } from '../../../src/progress/tune.ts';
import { chunkText, cleanClaim, recordWireText } from '../../../src/progress/wire.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type Msg = Record<string, unknown>;
type Told = { ok: boolean; why?: string; parked?: boolean; tell: { to: number; msg: Msg }[] };
type Line = { id: number; character: string; keep: string; asking: unknown; world: string; admin: boolean };

const T0 = 1_800_000_000_000;
const W0 = 5_000_000;
const WORLD = 'tatooine\0';
const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));

const freshTuning = () => ({ ...PROGRESS_TUNING, rules: copyRules(), limits: { ...PROGRESS_LIMITS } });

/** A server's progress over a world of its own, written through the store's own `applyChange` as the relay's store does. */
function host(o: { tuning?: ReturnType<typeof freshTuning>; shared?: Set<string>; start?: number } = {}) {
  const data = emptyWorld(1000);
  const log: Msg[] = [];
  let q = 0;
  const clock = { now: T0, wall: W0 };
  const tuning = o.tuning ?? freshTuning();
  const write = (rec: Msg) => {
    const stamped = { ...rec, q: ++q };
    log.push(stamped);
    applyChange(data, stamped);
  };
  const purses = new Purses({ tuning: { ...PURSE_TUNING, start: o.start ?? PURSE_TUNING.start }, write });
  const shared = o.shared ?? new Set<string>();
  const p = new Progress({ tuning, write, now: () => clock.now, wall: () => clock.wall, purses, admin: (c: Line) => c.admin === true, shared: (id: string) => shared.has(id), worldOf: (c: Line) => c.world });
  p.load(data);
  return { p, data, log, clock, tuning, purses, shared };
}
const lineOf = (id: number, character: string, o: Partial<Line> = {}): Line => ({ id, character, keep: '', asking: null, world: WORLD, admin: false, ...o });
const hear = (h: ReturnType<typeof host>, c: Line, msg: Msg): Told => h.p.hear(c, { t: 'progress', ...msg }) as Told;
/** What one line was told of progress, in order. */
const toldTo = (r: Told, id: number): Msg[] => r.tell.filter((t) => t.to === id && t.msg.t === 'progress').map((t) => t.msg);
const one = (r: Told, id: number, what: string): Msg | undefined => toldTo(r, id).find((m) => m.do === what);
/** Settle a line on a character the server has no record of yet, with nothing to hand up. */
const settle = (h: ReturnType<typeof host>, c: Line): Told => {
  h.clock.wall += 1100;
  return hear(h, c, { do: 'sync', has: 0, rev: 0, base: 0, local: 0, known: 0 });
};
/** Hand a record up in pieces of `size`, as the browser does when asked. */
const handUp = (h: ReturnType<typeof host>, c: Line, rec: unknown, size = PROGRESS_TUNE.offerChunk, known = 0): Told => {
  const parts = chunkText(recordWireText(rec), size);
  // Everything every piece was answered with, in order: a refusal can come at the first piece, and the rest then
  // answer nothing.
  const all: Told = { ok: true, tell: [] };
  for (let n = 0; n < parts.length; n++) {
    h.clock.wall += 1000;
    const r = hear(h, c, { do: 'offer', id: 1, n, of: parts.length, part: parts[n], known });
    all.tell.push(...r.tell);
    all.ok = r.ok;
  }
  return all;
};
/** A record's text with its own counters set aside: what two copies of it must agree on. */
const body = (r: ProgressRecord | null | undefined): string => (r ? recordText({ ...r, base: 0, local: 0 }) : '');
/** The same, with every table's keys in one order: a record read back through the cleaner lays its fields out afresh. */
const canon = (x: unknown): unknown => (Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])) : x);
const same = (a: ProgressRecord | null | undefined, b: ProgressRecord | null | undefined): boolean => !!a && !!b && JSON.stringify(canon({ ...a, base: 0, local: 0 })) === JSON.stringify(canon({ ...b, base: 0, local: 0 }));
let claims = 0;
const claimOf = (at: number, o: Partial<EncounterClaim> = {}): EncounterClaim => ({ id: `etest${(claims++).toString(36)}`, at, outcome: 'won', used: ['marksmanship'], heavy: false, planet: 'tatooine', diff: 1, members: [{ npc: 'test_kreetle', level: 1, dead: true, fought: true, share: 0 }], ...o });
const member = (npc: string, w?: string) => ({ ...(w ? { w } : {}), npc, level: 1, dead: true, fought: true, share: 0 });

// ---- the hail, and the wire's own cleaner of a claim -----------------------------------------------------------------
{
  const h = host();
  ok(h.p.hail() === 1, 'the server says it holds progress, at the first version of the words');
  const c = cleanClaim({ ...claimOf(T0), diff: 99, members: Array.from({ length: 40 }, (_, i) => ({ npc: `test_${i}`, level: i === 0 ? 99999 : i === 1 ? -5 : 3, dead: true, fought: true, share: 7 })) }, { membersMax: 24, levelMax: 400 })!;
  ok(c.members.length === 24 && c.members[0].level === 400 && c.members[1].level === 1 && c.members.every((m) => m.share === 1) && c.diff === 10, 'a claim is held to the server\'s members and levels on the way in, and its numbers to their ranges');
  ok(cleanClaim({ ...claimOf(T0), id: '__proto__' }) === null && cleanClaim({ ...claimOf(T0), outcome: 'paid' }) === null && cleanClaim({ ...claimOf(T0), members: [{ npc: 'x\u0007y', level: 1, dead: true, fought: true, share: 0 }] })!.members.length === 0, 'and one named for the language\'s own names, one that ended in no way a fight ends, or a member with a control character in it is not taken');
}

// ---- settling: the first copy handed up is taken whole, after the cleaner ---------------------------------------------
{
  const h = host();
  const c = lineOf(1, 'c-first');
  let r = hear(h, c, { do: 'sync', has: 1, rev: 4, base: 0, local: 4, known: 0 });
  ok(!!one(r, 1, 'want') && !one(r, 1, 'rec'), 'a browser with a record the server has never seen is asked for it');
  const offered = emptyRecord('c-first');
  applyProgress(offered, [{ k: 'core', skill: 'melee', xp: 900 }, { k: 'pool', pool: 'demolitions', xp: 3000 }]);
  offered.core.marksmanship = 999_999_999;
  offered.nodes['demo.novice'] = { at: 5, xp: 1000 };
  offered.nodes['demo.grenadier.2'] = { at: 6, xp: 6000 };
  offered.rev = 4;
  offered.local = 4;
  r = handUp(h, c, offered);
  const rec = one(r, 1, 'rec') as { rec: ProgressRecord; take: string; rate: number } | undefined;
  const stored = h.p.recordOf('c-first') as ProgressRecord;
  ok(rec?.take === 'browser' && stored.rev === 5 && stored.local === 0 && rec.rec.rev === 5, `taken whole and handed back as the browser's, at a revision past it (rev ${stored.rev})`);
  ok(stored.core.melee === 900 && stored.pools.demolitions === 3000 && stored.nodes['demo.novice'] !== undefined, 'what was made alone is trusted on first contact: its XP and its nodes stand');
  ok(stored.core.marksmanship === xpCap(h.tuning.rules) && stored.nodes['demo.grenadier.2'] === undefined, 'but cleaned first: XP held to its cap, a node with nothing under it dropped');
  ok(rec?.rate === h.tuning.rules.xpRate, 'and the server says the rate it pays at');

  // A character with nothing anywhere: a new, empty record, written down.
  const fresh = lineOf(2, 'c-fresh');
  r = settle(h, fresh);
  ok((one(r, 2, 'rec') as { take: string })?.take === 'server' && !!h.p.recordOf('c-fresh') && h.log.some((x) => x.t === 'progressRec' && x.id === 'c-fresh'), 'a browser with nothing is handed a new, empty record, written down');

  // The verdict matrix, on the record c-first now holds.
  const ask = (keep: string, has: number, local: number, asking: unknown = null) => {
    h.clock.wall += 1100;
    return hear(h, lineOf(3, 'c-first', { keep, asking }), { do: 'sync', has, rev: 2, base: 2, local, known: 1 });
  };
  ok((one(ask('server', 1, 3), 3, 'rec') as { take: string })?.take === 'server', 'the character settled the server\'s way: the server\'s record stands whatever the browser made alone');
  ok((one(ask('browser', 1, 0), 3, 'rec') as { take: string })?.take === 'server', 'settled the browser\'s way but nothing made alone: the server\'s stands');
  ok(ask('ask', 1, 3).tell.length === 0 && ask('browser', 1, 3, { character: 'c-first' }).tell.length === 0, 'and while a tie is still put to the player, a sync is not answered at all');
  r = ask('browser', 1, 2);
  ok(!!one(r, 3, 'want'), 'settled the browser\'s way and changed alone: the browser\'s record is asked for');
  const guardedBefore = h.p.stats.guarded;
  r = handUp(h, lineOf(3, 'c-first', { keep: 'browser' }), emptyRecord('c-first'), 8000, 1);
  ok((one(r, 3, 'rec') as { take: string; rec: ProgressRecord })?.take === 'server' && (one(r, 3, 'rec') as { rec: ProgressRecord }).rec.core.melee === 900 && h.p.stats.guarded === guardedBefore + 1, 'an empty record from a browser that believes a server held it before is a cleared cache: the server\'s stands');
  r = ask('browser', 1, 2);
  const archived = h.data.progressArchive['c-first']?.length ?? 0;
  const newer = copyRecord(stored);
  newer.core.melee = 1200;
  newer.local = 2;
  r = handUp(h, lineOf(3, 'c-first', { keep: 'browser' }), newer);
  ok((one(r, 3, 'rec') as { take: string })?.take === 'browser' && h.p.recordOf('c-first').core.melee === 1200 && (h.data.progressArchive['c-first']?.length ?? 0) === archived + 1, 'a newer copy made alone is taken, and the one it replaced is archived whole');

  // Pieces: four taken whole, five refused; past the most a record may be, refused, the server's standing.
  const four = h.p.recordOf('c-first');
  const text = recordWireText(four);
  r = ask('browser', 1, 2);
  r = handUp(h, lineOf(3, 'c-first', { keep: 'browser' }), { ...four, local: 2 }, Math.ceil(text.length / 4));
  ok((one(r, 3, 'rec') as { take: string })?.take === 'browser', `a record in ${h.tuning.offerPieces} pieces is taken once whole`);
  r = ask('browser', 1, 2);
  r = handUp(h, lineOf(3, 'c-first', { keep: 'browser' }), { ...four, local: 2 }, Math.ceil(text.length / 5));
  ok(/at most 4 pieces/.test(String(one(r, 3, 'no')?.why)) && (one(r, 3, 'rec') as { take: string })?.take === 'server', 'and one in five is refused in words, the server\'s own handed down');
  r = ask('browser', 1, 2);
  h.clock.wall += 1000;
  r = hear(h, lineOf(3, 'c-first', { keep: 'browser' }), { do: 'offer', id: 9, n: 1, of: 2, part: 'x' });
  ok(r.tell.length === 0, 'a piece of a record nobody is waiting on the start of is nothing to take');
  const wasMax = h.tuning.recMax;
  const big = recordWireText({ ...four, local: 2 });
  h.tuning.recMax = Math.floor(big.length / 2);
  try {
    r = ask('browser', 1, 2);
    r = handUp(h, lineOf(3, 'c-first', { keep: 'browser' }), { ...four, local: 2 }, 100000);
    ok(/larger/.test(String(one(r, 3, 'no')?.why)) && (one(r, 3, 'rec') as { take: string })?.take === 'server', `a record past the most the server takes (${big.length} characters against ${h.tuning.recMax}) is refused, and the server's stands`);
  } finally {
    h.tuning.recMax = wasMax;
  }
  // The allowance: six words a second, the rest dropped (and a learn refused in words).
  h.clock.wall += 2000;
  const flood = lineOf(4, 'c-fresh');
  let answered = 0;
  for (let i = 0; i < 8; i++) answered += hear(h, flood, { do: 'sync', has: 0, rev: 0, base: 0, local: 0, known: 0 }).tell.length ? 1 : 0;
  ok(answered === h.tuning.wordRate, `no more than ${h.tuning.wordRate} progress words a second are heard from one line`);
  ok(/too many/.test(String(one(hear(h, flood, { do: 'learn', node: 'demo.novice', teacher: null }), 4, 'no')?.why)), 'and a learn over the allowance is refused in words rather than dropped');
}

// ---- claims: worked out here, deaths taken on the keeper's word, parked for it when it is late ----------------------
{
  const h = host({ shared: new Set(['wild:a', 'wild:b', 'wild:c', 'wild:d', 'wild:e']) });
  const c = lineOf(1, 'c-claim');
  settle(h, c);
  // What the rules pay for a claim, worked out apart, with only these of its shared members believed dead.
  const expect = (cl: EncounterClaim, believed: string[]) => {
    const r = payClaim(h.p.recordOf('c-claim'), cl, { now: h.clock.now, levels: null, rules: h.tuning.rules, limits: h.tuning.limits, bucket: new XpBuckets(), witness: (w) => believed.includes(w), localKill: () => true });
    return r.paid.marksmanship ?? 0;
  };
  // A claim before its sync is not heard, and the browser asks again.
  ok(hear(h, lineOf(9, 'c-claim'), { do: 'claim', c: claimOf(h.clock.now) }).tell.length === 0, 'a claim from a line whose record is not settled here is not answered: the browser sends it again');
  h.p.death('wild:a', [1], 1, WORLD);
  const both = claimOf(h.clock.now, { members: [member('test_a', 'wild:a'), member('test_b', 'wild:b')] });
  const wantOne = expect(both, ['wild:a']);
  const wantTwo = expect(both, ['wild:a', 'wild:b']);
  const parkedBefore = h.p.stats.parked;
  h.clock.wall += 1000;
  const firstHeard = h.clock.wall;
  let r = hear(h, c, { do: 'claim', c: both });
  ok(r.parked === true && r.tell.length === 0 && h.p.parked.size === 1, 'a won claim naming a shared body dead that the server has not heard die is parked, with nothing said yet');
  h.clock.wall += 1000;
  r = hear(h, c, { do: 'claim', c: both });
  ok(r.parked === true && h.p.parked.size === 1 && h.p.stats.parked === parkedBefore + 1, 'and the same claim sent again while it waits is the one park, not two');
  // The park runs on the clock of the claim first heard, never restarted by the resend.
  h.clock.wall = firstHeard + h.tuning.claimPark;
  r = h.p.tick(h.clock.wall) as Told;
  const late = one(r, 1, 'ch') as { ch: unknown[]; of: string; kind: string } | undefined;
  ok(!!late && late.of === both.id && late.kind === 'claim' && h.p.recordOf('c-claim').core.marksmanship === wantOne && wantOne < wantTwo, `run out, it is paid for what was heard and nothing for the body the server never saw die (${wantOne}, where both would be ${wantTwo})`);
  // The reversed order: the claim first, then each death word; paid in full the moment the last comes.
  const before = h.p.recordOf('c-claim').core.marksmanship;
  const pair = claimOf(h.clock.now, { members: [member('test_c', 'wild:c'), member('test_d', 'wild:d')] });
  const wantPair = expect(pair, ['wild:c', 'wild:d']);
  h.clock.wall += 1000;
  hear(h, c, { do: 'claim', c: pair });
  ok(h.p.death('wild:c', [1], 1, WORLD).tell.length === 0 && h.p.parked.size === 1, 'the keeper\'s word of the first death leaves it waiting on the second');
  r = h.p.death('wild:d', [1], 1, WORLD) as Told;
  ok(!!one(r, 1, 'ch') && h.p.recordOf('c-claim').core.marksmanship === before + wantPair && h.p.parked.size === 0, `and the last runs it at once, paid in full (+${wantPair})`);
  // The same claim sent again once it is paid is answered at once: nothing a death word says could change it.
  h.clock.wall += 1000;
  r = hear(h, c, { do: 'claim', c: pair });
  ok(r.parked !== true && /paid already/.test(String(one(r, 1, 'no')?.why)), 'that claim sent again, paid already, is refused at once rather than parked for a death it was paid on');
  // A heard death pays a character once: a fresh claim id naming the same death waits for a later death's word,
  // and none coming, pays nothing for it.
  const again = claimOf(h.clock.now, { members: [member('test_c', 'wild:c')] });
  h.clock.wall += 1000;
  r = hear(h, c, { do: 'claim', c: again });
  ok(r.parked === true, 'a second claim naming a death this character was already paid for is not taken on that death: it waits for another');
  h.clock.wall += h.tuning.claimPark;
  r = h.p.tick(h.clock.wall) as Told;
  ok(/nothing it fought died/.test(String(one(r, 1, 'no')?.why)) && (one(r, 1, 'no') as Msg).of === again.id, 'and no later death coming, it pays nothing for it: one death, paid once to a character');
  // Another character who fought it is believed on that very death.
  const other = lineOf(2, 'c-claim-other');
  settle(h, other);
  h.clock.wall += 1000;
  r = hear(h, other, { do: 'claim', c: claimOf(h.clock.now, { members: [member('test_c', 'wild:c')] }) });
  ok(!!one(r, 2, 'ch') && (h.p.recordOf('c-claim-other').core.marksmanship ?? 0) > 0, 'while a second character who fought it is paid on the same death word');
  // A seeded body comes back under the name it died under: its last life's death stands only while its post is
  // empty (never less than the floor), and its next death is a claim's to wait for.
  h.shared.add('wild:g');
  h.p.death('wild:g', [1], 1, WORLD, 30);
  h.clock.wall += 1000;
  r = hear(h, c, { do: 'claim', c: claimOf(h.clock.now, { members: [member('test_g', 'wild:g')] }) });
  ok(!!one(r, 1, 'ch'), 'a respawning body\'s death, heard first, pays the claim that follows it');
  h.clock.wall += Math.max(h.tuning.deathFloor, 30_000) + 1000;
  h.clock.now += 120_000;
  const nextLife = claimOf(h.clock.now, { members: [member('test_g', 'wild:g')] });
  const wantNext = expect(nextLife, ['wild:g']);
  const marksNext = h.p.recordOf('c-claim').core.marksmanship;
  r = hear(h, c, { do: 'claim', c: nextLife });
  ok(r.parked === true && r.tell.length === 0, 'once it may stand again, a claim naming it dead before the keeper\'s word of that death is parked, not refused on the death before');
  // A character the last death was never credited to is not believed on it either, once the body may be back.
  const otherLife = claimOf(h.clock.now, { members: [member('test_g', 'wild:g')] });
  const otherWas = h.p.recordOf('c-claim-other').core.marksmanship ?? 0;
  r = hear(h, other, { do: 'claim', c: otherLife });
  ok(r.parked === true && r.tell.length === 0, 'and so is another character\'s: a death from the body\'s last life stands for nobody in its next');
  r = h.p.death('wild:g', [1], 1, WORLD, 30) as Told;
  ok(!!one(r, 1, 'ch') && h.p.recordOf('c-claim').core.marksmanship === marksNext + wantNext, `and the word of its next death pays it in full (+${wantNext})`);
  ok(!!one(r, 2, 'ch') && (h.p.recordOf('c-claim-other').core.marksmanship ?? 0) > otherWas, 'the other character\'s too, each on that one word');
  // One heard longer ago than the server keeps a death is not believed at all.
  h.shared.add('wild:h');
  h.p.death('wild:h', [1], 1, WORLD);
  h.clock.wall += h.tuning.deathKeep + 1000;
  const stale = claimOf(h.clock.now, { members: [member('test_h', 'wild:h')] });
  r = hear(h, c, { do: 'claim', c: stale });
  h.clock.wall += h.tuning.claimPark;
  r = { ok: true, tell: [...r.tell, ...(h.p.tick(h.clock.wall) as Told).tell] };
  ok(/nothing it fought died/.test(String(one(r, 1, 'no')?.why)) && (one(r, 1, 'no') as Msg).of === stale.id, `a death heard more than ${h.tuning.deathKeep / 60000} minutes before stands for nothing`);
  // A death on another world witnesses nothing on this one.
  h.p.death('wild:e', [1], 1, 'naboo\0');
  h.clock.wall += 1000;
  r = hear(h, c, { do: 'claim', c: claimOf(h.clock.now, { members: [member('test_e', 'wild:e')] }) });
  h.clock.wall += h.tuning.claimPark;
  r = { ok: true, tell: [...r.tell, ...(h.p.tick(h.clock.wall) as Told).tell] };
  ok(/nothing it fought died/.test(String(one(r, 1, 'no')?.why)), 'a shared body heard to die on another world counts as alive on this one: nothing it fought died, said in words');
  // And one the server never hears die at all pays nothing for it, once its park runs out.
  h.shared.add('wild:f');
  h.clock.wall += 1000;
  const unheard = claimOf(h.clock.now, { members: [member('test_f', 'wild:f')] });
  r = hear(h, c, { do: 'claim', c: unheard });
  ok(r.parked === true, 'a claim naming a shared body the server has not heard die waits for the word');
  h.clock.wall += h.tuning.claimPark + 10;
  r = h.p.tick(h.clock.wall) as Told;
  ok(/nothing it fought died/.test(String(one(r, 1, 'no')?.why)) && (one(r, 1, 'no') as Msg).of === unheard.id, 'and the word never coming, it pays nothing for it: said in words, naming the claim');
  // The same claim twice pays once.
  const twice = claimOf(h.clock.now, { members: [member('test_twice')] });
  h.clock.wall += 1000;
  r = hear(h, c, { do: 'claim', c: twice });
  ok(!!one(r, 1, 'ch'), 'a claim with nobody shared in it is paid at once');
  h.clock.wall += 1000;
  r = hear(h, c, { do: 'claim', c: twice });
  ok(/paid already/.test(String(one(r, 1, 'no')?.why)) && (one(r, 1, 'no') as Msg).of === twice.id, 'the same claim again pays nothing, and the refusal names it');
  // A body nobody shares is believed, up to the character's own rate.
  h.tuning.localKillsPerMinute = 2;
  const three = claimOf(h.clock.now, { members: [member('test_l1'), member('test_l2', 'wild:unknown'), member('test_l3')] });
  // Worked out apart before it is heard: two of its three believed, and all three.
  const wantTwoLocal = expect({ ...three, members: three.members.slice(0, 2).map((m) => ({ ...m, w: undefined })) }, []);
  const wantAllThree = expect({ ...three, members: three.members.map((m) => ({ ...m, w: undefined })) }, []);
  h.clock.wall += 61_000;
  const was = h.p.recordOf('c-claim').core.marksmanship;
  r = hear(h, c, { do: 'claim', c: three });
  const gained = h.p.recordOf('c-claim').core.marksmanship - was;
  ok(!!one(r, 1, 'ch') && gained === wantTwoLocal && gained < wantAllThree, `three bodies nobody shares, one named but not shared here, are believed up to the rate of two (+${gained}, where three would be +${wantAllThree})`);
  h.tuning.localKillsPerMinute = PROGRESS_TUNING.localKillsPerMinute;
  // A claim with no use pays nothing.
  h.clock.wall += 1000;
  r = hear(h, c, { do: 'claim', c: claimOf(h.clock.now, { used: [] }) });
  ok(/no skill was used/.test(String(one(r, 1, 'no')?.why)), 'a fight that used no skill pays nothing, said in words');
  // A fight lost spends nothing of the rate a character's bodies nobody shares are believed at: only a win pays a kill.
  h.tuning.localKillsPerMinute = 1;
  h.clock.wall += 61_000;
  h.clock.now += 61_000;
  hear(h, c, { do: 'claim', c: claimOf(h.clock.now, { outcome: 'lost', members: [member('test_lost_a'), member('test_lost_b')] }) });
  h.clock.wall += 1000;
  r = hear(h, c, { do: 'claim', c: claimOf(h.clock.now, { members: [member('test_won_after')] }) });
  ok(!!one(r, 1, 'ch'), 'a fight lost naming two dead bodies nobody shares leaves the rate whole: the win after it, on a rate of one, is believed');
  h.tuning.localKillsPerMinute = PROGRESS_TUNING.localKillsPerMinute;
  // No more than two claims a second from one line: the third is dropped in silence, and the browser sends it again.
  h.clock.wall += 2000;
  const answeredOf = [0, 1, 2].map((i) => hear(h, c, { do: 'claim', c: claimOf(h.clock.now, { members: [member(`test_rate_${i}`)] }) }));
  ok(!!one(answeredOf[0], 1, 'ch') && !!one(answeredOf[1], 1, 'ch') && answeredOf[2].tell.length === 0 && answeredOf[2].why === 'too often', `no more than ${h.tuning.claimRate} claims a second are taken from one line, the rest dropped in silence for the browser to send again`);
}

// ---- the server's own caps on what a claim carries ----------------------------------------------------------------------
{
  const h = host();
  h.tuning.membersMax = 3;
  h.tuning.levelMax = 5;
  setProgressTuning('rules.encounterCap', 1e6, h.tuning);
  setProgressTuning('rules.perMinute', 1e6, h.tuning);
  setProgressTuning('rules.bucketMax', 1e7, h.tuning);
  const c = lineOf(1, 'c-caps');
  settle(h, c);
  const wide = claimOf(h.clock.now, { members: Array.from({ length: 10 }, (_, i) => ({ npc: `test_cap_${i}`, level: 99999, dead: true, fought: true, share: 0 })) });
  const pay = (cl: EncounterClaim) => payClaim(h.p.recordOf('c-caps'), cl, { now: h.clock.now, levels: null, rules: h.tuning.rules, limits: h.tuning.limits, bucket: new XpBuckets(), witness: () => true, localKill: () => true }).paid.marksmanship ?? 0;
  const held = pay({ ...wide, members: wide.members.slice(0, 3).map((m) => ({ ...m, level: 5 })) });
  const levelsLoose = pay({ ...wide, members: wide.members.slice(0, 3) });
  const loose = pay(wide);
  h.clock.wall += 1000;
  const r = hear(h, c, { do: 'claim', c: wide });
  const gained = h.p.recordOf('c-caps').core.marksmanship ?? 0;
  ok(!!one(r, 1, 'ch') && gained === held && held < levelsLoose && levelsLoose < loose, `a claim is held to this server's own members and levels on the way in: ten members at level 99999, with the server taking three at level five, pay what three at level five pay (+${gained}, where three at their own level would be +${levelsLoose} and all ten +${loose})`);
}

// ---- a batch the server would write past the most a record may be is refused whole ---------------------------------------
{
  const h = host();
  const c = lineOf(1, 'c-long');
  settle(h, c);
  h.clock.wall += 1000;
  hear(h, c, { do: 'claim', c: claimOf(h.clock.now, { members: [member('test_long_a')] }) });
  const text = recordText(h.p.recordOf('c-long'));
  const wasMax = h.tuning.recMax;
  h.tuning.recMax = text.length + 5;
  try {
    h.clock.wall += 1000;
    const big = claimOf(h.clock.now, { members: [member('test_long_b')] });
    const r = hear(h, c, { do: 'claim', c: big });
    const no = one(r, 1, 'no') as Msg | undefined;
    ok(!!no && no.of === big.id && /past the/.test(String(no.why)) && !one(r, 1, 'ch') && recordText(h.p.recordOf('c-long')) === text && h.p.stats.tooLong === 1, `a batch that would take the record past the most this server writes (${h.tuning.recMax} characters) is refused whole, naming the claim, and the record is as it was`);
  } finally {
    h.tuning.recMax = wasMax;
  }
}

// ---- a record whose pieces stop coming is given up ------------------------------------------------------------------------
{
  const h = host();
  const c = lineOf(1, 'c-stall');
  h.clock.wall += 1100;
  hear(h, c, { do: 'sync', has: 1, rev: 1, base: 0, local: 1, known: 0 });
  const rec = emptyRecord('c-stall');
  applyProgress(rec, [{ k: 'core', skill: 'melee', xp: 40 }]);
  const parts = chunkText(recordWireText(rec), Math.ceil(recordWireText(rec).length / 3));
  h.clock.wall += 1000;
  hear(h, c, { do: 'offer', id: 1, n: 0, of: parts.length, part: parts[0], known: 0 });
  ok(h.p.offers.size === 1 && h.p.tick(h.clock.wall + h.tuning.offerWait - 10).tell.length === 0, 'a record half up waits its time for the next piece');
  const r = h.p.tick(h.clock.wall + h.tuning.offerWait + 10) as Told;
  ok(/stopped coming/.test(String(one(r, 1, 'no')?.why)) && h.p.offers.size === 0 && h.p.wanting.size === 0 && !h.p.recordOf('c-stall'), 'and once the pieces stop coming past it, it is given up and the browser told, with nothing taken');
}

// ---- the buckets are the character's for the life of the server ------------------------------------------------------
{
  const h = host();
  setProgressTuning('rules.bucketMax', 60, h.tuning);
  setProgressTuning('rules.perMinute', 60, h.tuning);
  ok(h.tuning.rules.bucketMax === 60 && PROGRESS_RULES.bucketMax !== 60, '--set progress.rules.<name> moves the server\'s own copy of the rules and nobody else\'s');
  const c = lineOf(1, 'c-bucket');
  settle(h, c);
  const big = claimOf(h.clock.now, { members: Array.from({ length: 10 }, (_, i) => member(`test_big_${i}`)) });
  h.clock.wall += 1000;
  hear(h, c, { do: 'claim', c: big });
  ok(h.p.recordOf('c-bucket').core.marksmanship === 60, 'a big fight is held to the pool\'s bucket');
  h.p.gone(1);
  const again = lineOf(2, 'c-bucket');
  settle(h, again);
  h.clock.wall += 1000;
  const r = hear(h, again, { do: 'claim', c: claimOf(h.clock.now, { members: [member('test_after')] }) });
  ok(/bucket/.test(String(one(r, 2, 'no')?.why)) && h.p.buckets.report()['c-bucket|marksmanship'] === 0, 'and a line that closes and comes back finds its character\'s bucket as it left it, empty');
}

// ---- a batch made under a moved limit, applied by a browser under the backstop: one record --------------------------
{
  const h = host();
  ok(setProgressTuning('limits.seen', 50, h.tuning) && h.tuning.limits.seen === 50 && PROGRESS_LIMITS.seen !== 50, '--set progress.limits.seen=50 moves the server\'s own limit');
  ok(setProgressTuning('limits.seen', 999999, freshTuning()) && !setProgressTuning('limits.nothing', 5, freshTuning()) && !setProgressTuning('rules.__proto__', 5, freshTuning()) && !setProgressTuning('rules.band', 5, freshTuning()), 'a limit past the backstop is held at it, and a name that is not a number of the tuning is refused');
  setProgressTuning('rules.perMinute', 1e6, h.tuning);
  setProgressTuning('rules.bucketMax', 1e7, h.tuning);
  const c = lineOf(1, 'c-limits');
  const settled = settle(h, c);
  // The browser's copy: the record handed down, then every batch as it comes, under the backstop.
  const mine = cleanRecord((one(settled, 1, 'rec') as { rec: unknown }).rec, PROGRESS_BACKSTOP)!;
  for (let i = 0; i < 60; i++) {
    h.clock.wall += 600;
    h.clock.now += 1000;
    const r = hear(h, c, { do: 'claim', c: claimOf(h.clock.now, { members: [member(`test_seen_${i}`)] }) });
    const ch = one(r, 1, 'ch') as { rev: number; ch: unknown[] };
    assert.ok(ch, `claim ${i} paid`);
    applyProgress(mine, ch.ch, PROGRESS_BACKSTOP);
    mine.rev = ch.rev;
  }
  const theirs = h.p.recordOf('c-limits');
  ok(theirs.seen.length === 50 && mine.seen!.length === 50 && body(mine) === body(theirs), `sixty fights under a limit of fifty: the server trimmed as it wrote, and the browser applying its batches under the backstop holds the very same record (${recordText(theirs).length} characters)`);
}

/** The browser's own client on a line to a host, as `main.ts` wires it: every word it sends heard by the module, and the module's answers handed back by `pump`. */
function clientOn(h: ReturnType<typeof host>, c: Line) {
  const map = new Map<string, string>();
  const store: ProgressStorage = { get: (k) => map.get(k) ?? null, set: (k, v) => (map.set(k, v), true), remove: (k) => void map.delete(k) };
  const line: ProgressLine = { authority: 'server', progress: 1, status: 'online', mode: 'server' };
  const said: string[] = [];
  const sent: { at: number; msg: Msg }[] = [];
  const inbox: Msg[] = [];
  const client = new ProgressClient({
    store,
    now: () => h.clock.now,
    wall: () => h.clock.wall,
    line: () => line,
    say: (l) => said.push(l),
    send: (m) => {
      sent.push({ at: h.clock.wall, msg: m });
      for (const t of (h.p.hear(c, m) as Told).tell) if (t.to === c.id) inbox.push(t.msg);
    },
  });
  const pump = () => {
    while (inbox.length) client.word(inbox.shift()!);
  };
  return { client, map, store, line, said, sent, pump };
}

// ---- a limit and the rules' caps moved UP on the server, through the browser's own client: still one record ----------
{
  const tuning = freshTuning();
  ok(setProgressTuning('limits.seen', 300, tuning) && tuning.limits.seen === 300 && tuning.limits.seen > PROGRESS_LIMITS.seen, '--set progress.limits.seen=300 moves the server\'s limit past this browser\'s own');
  setProgressTuning('rules.perMinute', 1e6, tuning);
  setProgressTuning('rules.bucketMax', 1e7, tuning);
  setProgressTuning('localKillsPerMinute', 100000, tuning);
  ok(setProgressTuning('rules.bankCap', 100000, tuning) && setProgressTuning('rules.coreK', 80, tuning) && tuning.rules.bankCap > PROGRESS_RULES.bankCap && xpCap(tuning.rules) > xpCap(PROGRESS_RULES), `and --set progress.rules.bankCap and coreK move the server's caps past this browser's (a pool to ${tuning.rules.bankCap}, a core skill to ${xpCap(tuning.rules)})`);
  const h = host({ tuning });
  const c = lineOf(6, 'c-up', { admin: true });
  const b = clientOn(h, c);
  b.client.use('c-up');
  h.clock.wall += 1100;
  b.client.claimed(false);
  b.pump();
  ok(b.client.host === 'server', 'the browser\'s own client settles on the server');
  for (let i = 0; i < 250; i++) {
    h.clock.wall += PROGRESS_TUNE.claimGap + 10;
    h.clock.now += 7000;
    b.client.claim(claimOf(h.clock.now, { members: [member(`test_up_${i}`)] }));
    b.pump();
  }
  const theirs = h.p.recordOf('c-up');
  const mine = b.client.record!;
  ok(theirs.seen.length > PROGRESS_LIMITS.seen && mine.seen!.length === theirs.seen.length && body(mine) === body(theirs), `two hundred and fifty fights under a limit of 300, past this browser's own 200: the client applying the server's batches holds the very same record (${theirs.seen.length} seen, ${recordText(theirs).length} characters)`);
  // The admin's XP past this browser's caps, and the record read back every way another host's record is read.
  h.clock.wall += 2000;
  b.client.debug({ xp: { demolitions: 80000, marksmanship: 80000 } });
  b.pump();
  ok(h.p.recordOf('c-up').pools.demolitions === 80000 && h.p.recordOf('c-up').core.marksmanship === 80000 && b.client.record!.pools.demolitions === 80000 && b.client.record!.core.marksmanship === 80000, `the server pays to its own caps, past this browser's (${PROGRESS_RULES.bankCap} and ${xpCap(PROGRESS_RULES)}), and the client's copy follows`);
  b.client.use(null);
  b.client.use('c-up');
  ok(b.client.record!.pools.demolitions === 80000 && b.client.record!.core.marksmanship === 80000, 'read back out of the browser\'s storage, nothing is cut to the browser\'s own caps');
  h.clock.wall += 1100;
  b.client.claimed(false);
  b.pump();
  ok(b.client.host === 'server' && b.client.stats.records >= 2 && same(b.client.record, h.p.recordOf('c-up')), 'nor when the server hands its record down whole: the copy taken is the server\'s to the last number');
  const restarted = readProgress(JSON.parse(JSON.stringify(h.data)));
  const replayed = emptyWorld(1000);
  for (const rec of h.log) applyChange(replayed, rec);
  ok(same(restarted.progress['c-up'], h.p.recordOf('c-up')) && same(replayed.progress['c-up'], h.p.recordOf('c-up')), 'nor when the server starts again: its file read back and its log played back both give the record it wrote');
  // A record handed up past this browser's caps, to a server whose own caps take it, is written down as it came.
  const up = lineOf(7, 'c-up-hand');
  h.clock.wall += 1100;
  hear(h, up, { do: 'sync', has: 1, rev: 1, base: 0, local: 1, known: 0 });
  const handed = emptyRecord('c-up-hand');
  applyProgress(handed, [{ k: 'pool', pool: 'demolitions', xp: 90000 }, { k: 'core', skill: 'melee', xp: 75000 }]);
  handed.local = 1;
  const took = handUp(h, up, handed);
  ok((one(took, 7, 'rec') as { take: string } | undefined)?.take === 'browser' && h.p.recordOf('c-up-hand').pools.demolitions === 90000 && h.p.recordOf('c-up-hand').core.melee === 75000, 'a record handed up past this browser\'s caps, to a server whose own caps take it, is written down as it came');
  const replayedHand = emptyWorld(1000);
  for (const rec of h.log) applyChange(replayedHand, rec);
  ok(same(replayedHand.progress['c-up-hand'], h.p.recordOf('c-up-hand')), 'and played back from the log the same');
  // And this browser holding the record alone again never cuts it down to its own caps by a payout.
  Object.assign(b.line, { authority: 'me', progress: 0, status: 'off', mode: 'off' });
  h.clock.now += 7000;
  const meleeWas = b.client.record!.core.melee ?? 0;
  const alone = b.client.claim(claimOf(h.clock.now, { used: ['marksmanship', 'melee'], members: [member('test_up_alone')] }));
  ok(b.client.host === 'local' && alone.ok && b.client.record!.core.marksmanship === 80000 && (b.client.record!.core.melee ?? 0) > meleeWas, 'a fight paid here alone, under this browser\'s lower caps, pays the skill with room and leaves the one past them where the server put it');
}

// ---- a copy made alone that the server would not take is set aside; a tie waits; the queue goes a gap apart --------------
{
  const h = host();
  const first = lineOf(1, 'c-aside');
  settle(h, first);
  h.clock.wall += 1000;
  hear(h, first, { do: 'claim', c: claimOf(h.clock.now, { members: [member('test_aside_server')] }) });
  h.p.gone(1);
  // A browser that made a batch of its own meanwhile, with nobody holding the record, for a character that settles
  // the server's way.
  const c = lineOf(2, 'c-aside', { keep: 'server' });
  const b = clientOn(h, c);
  Object.assign(b.line, { authority: 'me', progress: 0, status: 'off', mode: 'off' });
  b.client.use('c-aside');
  b.client.debug({ xp: { melee: 500 } });
  ok(b.client.host === 'local' && b.client.local === 1, 'a browser alone makes a batch of its own');
  Object.assign(b.line, { authority: 'server', progress: 1, status: 'online', mode: 'server' });
  for (let i = 0; i < 5; i++) b.client.claim(claimOf(h.clock.now, { members: [member(`test_queue_${i}`)] }));
  ok(b.client.host === 'held' && b.sent.length === 0, 'on a line that holds progress and has not settled it, nothing is sent and five fights wait in the queue');
  h.clock.wall += 1100;
  b.client.claimed(true);
  ok(!b.sent.some((s) => s.msg.do === 'sync'), 'while a tie between two copies of the character is still put to the player, nothing is said of progress');
  h.clock.wall += 500;
  b.client.answered();
  b.pump();
  ok(b.sent.filter((s) => s.msg.do === 'sync').length === 1, 'and once it is answered, the copy says what it holds');
  const kept = asideRecord(b.store, 'c-aside', asides(b.store, 'c-aside')[0] ?? 0);
  ok(b.client.stats.setAside === 1 && asides(b.store, 'c-aside').length === 1 && kept?.core.melee === 500 && b.client.record!.core.melee === undefined && b.client.local === 0, 'the server\'s copy stands, and the one made alone is set aside in storage, never thrown away');
  ok(b.said.filter((l) => /kept aside/.test(l)).length === 1, 'and the player is told so once, on the message line');
  const from = b.sent.length;
  for (let t = 0; t < 40; t++) {
    h.clock.wall += 100;
    b.client.step(h.clock.wall);
    b.pump();
  }
  const ups = b.sent.slice(from).filter((s) => s.msg.do === 'claim');
  ok(ups.length === 5 && ups.every((s, i) => i === 0 || s.at - ups[i - 1].at >= PROGRESS_TUNE.claimGap), `the five that waited go up one at a time, ${PROGRESS_TUNE.claimGap} ms apart at the least (${ups.map((s) => s.at - (ups[0]?.at ?? 0)).join(', ')} ms)`);
}

// ---- the world written to disk and read back: the same records, every table with no prototype -------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'swg3js-progress-store-'));
  try {
    const quiet = { saveEvery: 0, log: () => {} };
    const a = openStore({ dir, epoch: 1000, ...quiet });
    const clock = { now: T0, wall: W0 };
    const p = new Progress({ tuning: freshTuning(), write: (rec: Msg) => a.change(rec), now: () => clock.now, wall: () => clock.wall, worldOf: () => WORLD });
    p.load(a.data);
    const c = lineOf(1, 'c-store');
    clock.wall += 1100;
    p.hear(c, { t: 'progress', do: 'sync', has: 0, rev: 0, base: 0, local: 0, known: 0 });
    clock.wall += 1000;
    p.hear(c, { t: 'progress', do: 'claim', c: claimOf(clock.now, { members: [member('test_store_a')] }) });
    a.saveNow();
    clock.wall += 1000;
    clock.now += 1000;
    p.hear(c, { t: 'progress', do: 'claim', c: claimOf(clock.now, { members: [member('test_store_b')] }) });
    const live = copyRecord(p.recordOf('c-store'));
    a.close();
    const b = openStore({ dir, epoch: 5, ...quiet });
    const read = b.data.progress['c-store'] as ProgressRecord;
    ok(!!read && same(read, live) && read.rev === live.rev, `a world saved, changed after and read back gives the very record it held (rev ${live.rev}, the snapshot and the log after it)`);
    ok(Object.getPrototypeOf(b.data.progress) === null && Object.getPrototypeOf(read.core) === null && Object.getPrototypeOf(read.paid) === null, 'and every table of it is rebuilt with no prototype before anything reads it');
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- a character's archive keeps the last few records it replaced -----------------------------------------------------------
{
  const data: Record<string, any> = {};
  for (let i = 1; i <= PROGRESS_TUNING.archive + 1; i++) applyProgressRec(data, { t: 'progressArchive', id: 'c-arch', rec: { ...emptyRecord('c-arch'), rev: i } });
  const list = data.progressArchive['c-arch'] as ProgressRecord[];
  ok(list.length === PROGRESS_TUNING.archive && list[0].rev === 2 && list.at(-1)!.rev === PROGRESS_TUNING.archive + 1, `an archive past ${PROGRESS_TUNING.archive} records lets the oldest go`);
}

// ---- learning, giving back, the admin's own --------------------------------------------------------------------------
{
  const h = host({ start: 100 });
  const c = lineOf(1, 'c-learn');
  settle(h, c);
  const say = (msg: Msg, line: Line = c) => {
    h.clock.wall += 1100;
    return hear(h, line, msg);
  };
  ok(/trainer/.test(String(one(say({ do: 'learn', node: 'demo.novice', teacher: null }), 1, 'no')?.why)), 'a Novice with no teacher is refused, in words');
  ok(/costs/.test(String(one(say({ do: 'learn', node: 'demo.novice', teacher: 'trainer_commando' }), 1, 'no')?.why)), 'with a teacher and no XP, refused for the XP');
  ok(/admin/.test(String(one(say({ do: 'xp', src: 'demolitions', n: 5000 }), 1, 'no')?.why)), 'XP given by anybody but the admin is refused');
  const admin = lineOf(1, 'c-learn', { admin: true });
  ok(!!one(say({ do: 'xp', src: 'demolitions', n: 5000 }, admin), 1, 'ch') && h.p.recordOf('c-learn').pools.demolitions === 5000, 'and by the admin, given');
  let r = say({ do: 'learn', node: 'demo.novice', teacher: 'trainer_commando' });
  const learnt = one(r, 1, 'ch') as { kind: string; of: string } | undefined;
  ok(learnt?.kind === 'learn' && learnt.of === 'demo.novice' && !!h.p.recordOf('c-learn').nodes['demo.novice'] && h.p.recordOf('c-learn').pools.demolitions === 4000, 'learnt from a trainer, the XP taken from the pool, answered with the batch');
  ok(/learnt already/.test(String(one(say({ do: 'learn', node: 'demo.novice', teacher: 'trainer_commando' }), 1, 'no')?.why)), 'and not twice');
  // Giving back: the purse has 100 and the fee is more, so nothing moves at all.
  const fee = surrenderFee(nodeById('demo.novice')!, h.tuning.rules);
  r = say({ do: 'surrender', node: 'demo.novice', teacher: 'trainer_commando' });
  const purse = r.tell.find((t) => t.msg.t === 'purse')?.msg;
  ok(!!purse?.why && !one(r, 1, 'ch') && !!h.p.recordOf('c-learn').nodes['demo.novice'] && h.purses.of('c-learn') === 100, `giving back for a fee of ${fee} with 100 in the purse is refused whole: the purse says why, the node stays and no money moves`);
  h.purses.give('c-learn', 1000, 1);
  r = say({ do: 'surrender', node: 'demo.novice', teacher: 'trainer_commando' });
  const given = one(r, 1, 'ch') as { kind: string; fee: number } | undefined;
  ok(given?.kind === 'surrender' && given.fee === fee && !h.p.recordOf('c-learn').nodes['demo.novice'] && h.p.recordOf('c-learn').gone['demo.novice'] !== undefined && h.purses.of('c-learn') === 1100 - fee, 'with the money there, the fee is taken and the node given back in one step');
  ok(r.tell.some((t) => t.msg.t === 'purse' && t.msg.spent === fee), 'and the purse\'s own word of the new balance goes back with it');
  ok(/admin/.test(String(one(say({ do: 'grant', node: 'demo.master' }), 1, 'no')?.why)) && !!one(say({ do: 'grant', node: 'demo.ordnance.1' }, admin), 1, 'ch') && !!h.p.recordOf('c-learn').nodes['demo.ordnance.1'], 'a grant is the admin\'s alone');
  ok(!!one(say({ do: 'reset' }, admin), 1, 'ch') && Object.keys(h.p.recordOf('c-learn').nodes).length === 0, 'and so is emptying a record');
}

// ---- the quest bonus: owed before the character's progress settles, paid once when it does --------------------------
{
  const h = host();
  const tell: { to: number; msg: Msg }[] = [];
  const order = { key: 'test:goto#1#paid', bonus: { xp: 20, since: T0 - 60_000 } };
  ok(h.p.bonus('c-owed', 7, order, tell) === true && Object.keys(h.data.progressOwed).length === 1 && h.log.some((x) => x.t === 'progressOwed') && tell.length === 0, 'a bonus for a character whose progress has not settled here is owed, and written down');
  // The log played back into a fresh world keeps it: a restart owes it still.
  const again = emptyWorld(1000);
  for (const rec of h.log) applyChange(again, rec);
  ok(JSON.stringify(again.progressOwed) === JSON.stringify(h.data.progressOwed), 'and a log played back owes it still');
  // The character settles with a record that used Marksmanship after the quest began: the bonus is paid then.
  const c = lineOf(7, 'c-owed');
  h.clock.wall += 1100;
  hear(h, c, { do: 'sync', has: 1, rev: 1, base: 0, local: 1, known: 0 });
  const rec = emptyRecord('c-owed');
  const at = secondsOf(T0 - 30_000);
  applyProgress(rec, [{ k: 'core', skill: 'marksmanship', xp: 50 }, { k: 'logRow', row: [at, at, LOG_SOURCES.indexOf('marksmanship'), 50] }]);
  rec.local = 1;
  const r = handUp(h, c, rec);
  const bonus = one(r, 7, 'ch') as { kind: string } | undefined;
  ok(bonus?.kind === 'bonus' && h.p.recordOf('c-owed').core.marksmanship === 70 && Object.keys(h.data.progressOwed).length === 0 && h.p.recordOf('c-owed').bonus.includes(fnv32(order.key)), 'paid into the skill used while the quest ran the moment the progress settles, keyed by the story\'s own key, and struck off');
  h.clock.wall += 1100;
  hear(h, c, { do: 'sync', has: 1, rev: 0, base: 0, local: 0, known: 1 });
  ok(h.p.bonus('c-owed', 7, order, []) === true && h.p.recordOf('c-owed').core.marksmanship === 70, 'and paid once: the same order again, settled, finds its key');
}

// ---- the quest bonus from the server's own story host ---------------------------------------------------------------
{
  const h = host();
  const s = new Stories({ tuning: { ...STORY_TUNING }, write: (rec: Msg) => void applyChange(h.data, rec), now: () => h.clock.now, purses: h.purses, read: () => ({ test: readStorySet(TESTSET).files, own: null }), admin: () => true, tests: true, progress: h.p });
  s.load(h.data);
  s.readSets();
  const c = { ...lineOf(1, 'c-quest'), hello: { name: 'Q' }, state: null, member: null };
  s.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
  settle(h, c);
  const at = { p: [100, 100] };
  s.hear(c, { t: 'story', do: 'admin', op: 'grant', quest: 'test:goto', at });
  h.clock.now += 5000;
  h.clock.wall += 1000;
  hear(h, c, { do: 'claim', c: claimOf(h.clock.now, { members: [member('test_during')] }) });
  const marks = h.p.recordOf('c-quest').core.marksmanship;
  h.clock.now += 5000;
  const step1 = s.hear(c, { t: 'story', do: 'admin', op: 'complete', quest: 'test:goto', step: 'outdoor', at }) as Told;
  h.clock.now += 5000;
  const step2 = s.hear(c, { t: 'story', do: 'admin', op: 'complete', quest: 'test:goto', step: 'cantina', at }) as Told;
  const paidBonus = [...step1.tell, ...step2.tell].filter((t) => t.msg.t === 'progress' && t.msg.do === 'ch' && t.msg.kind === 'bonus');
  ok(paidBonus.length === 1 && h.p.recordOf('c-quest').core.marksmanship === marks + 5, `a quest whose reward carries experience, run by the server's own story host, pays it as a bonus into the skill used while it ran (+${h.p.recordOf('c-quest').core.marksmanship - marks})`);
  s.hear(c, { t: 'story', do: 'admin', op: 'complete', quest: 'test:goto', step: 'cantina', at });
  ok(h.p.recordOf('c-quest').core.marksmanship === marks + 5 && h.p.recordOf('c-quest').bonus.length === 1, 'and once');
  ok(new Stories().pay({ character: 'x', session: 1 }, { key: 'k', bonus: { xp: 5, since: 0 } }, []) === false, 'a story host with no progress beside it pays nothing for a bonus');
}

// ---- the log played back, and a world read back from its file ----------------------------------------------------------
{
  const h = host({ shared: new Set(['wild:r']) });
  const c = lineOf(1, 'c-replay');
  settle(h, c);
  for (let i = 0; i < 5; i++) {
    h.clock.wall += 1000;
    h.clock.now += 1000;
    hear(h, c, { do: 'claim', c: claimOf(h.clock.now, { members: [member(`test_replay_${i}`)] }) });
  }
  const again = emptyWorld(1000);
  for (const rec of h.log) applyChange(again, rec);
  ok(Object.keys(again.progress).length === Object.keys(h.data.progress).length && Object.keys(h.data.progress).every((id) => body(again.progress[id]) === body(h.data.progress[id])) && again.progress['c-replay'].rev === h.data.progress['c-replay'].rev, `replaying the log on an empty world gives the very same records (${Object.keys(again.progress).length})`);
  const fromFile = JSON.parse(JSON.stringify({ progress: { ...h.data.progress, 'not a character': {}, broken: { v: 1, char: 'someone-else' } }, progressArchive: { 'c-replay': [h.data.progress['c-replay']] }, progressOwed: { p3: { character: 'c-replay', key: 'test:a#1#x', xp: 5, since: 1, at: 2 }, nope: { character: 'c-replay' } } }));
  fromFile.progress.__proto__ = { v: 1 };
  readProgress(fromFile);
  ok(Object.getPrototypeOf(fromFile.progress) === null && Object.getPrototypeOf(fromFile.progressArchive) === null && Object.getPrototypeOf(fromFile.progressOwed) === null, 'a world read back has every table rebuilt with no prototype');
  ok(Object.keys(fromFile.progress).join() === 'c-replay' && fromFile.progressOwed.p3 && !fromFile.progressOwed.nope && fromFile.progressOwedSeq === 4, 'and only what reads: the record under its own character, a bonus owed under the server\'s own key, the counter past it');
  ok(applyProgressRec({}, { t: 'progressRec', id: '__proto__', rec: emptyRecord('x') }) === false && applyProgressRec({}, { t: 'progressRec', id: 'c-x', rec: emptyRecord('c-y') }) === false, 'a record under a reserved name, or under another character\'s, is never applied');
}

// ---- the browser's own client against the module, word for word ------------------------------------------------------
{
  const h = host({ shared: new Set(['wild:k']) });
  const c = lineOf(5, 'c-client', { keep: 'browser' });
  const map = new Map<string, string>();
  const store: ProgressStorage = { get: (k) => map.get(k) ?? null, set: (k, v) => (map.set(k, v), true), remove: (k) => void map.delete(k) };
  const line: ProgressLine = { authority: 'me', progress: 0, status: 'off', mode: 'off' };
  const said: string[] = [];
  const answers: [string, Record<string, number>, string | undefined][] = [];
  let deaf = false;
  const inbox: Msg[] = [];
  const sent: Msg[] = [];
  const client = new ProgressClient({
    store,
    now: () => h.clock.now,
    wall: () => h.clock.wall,
    line: () => line,
    say: (l) => said.push(l),
    send: (m) => {
      sent.push(m);
      if (deaf) return;
      for (const t of (h.p.hear(c, m) as Told).tell) if (t.to === c.id) inbox.push(t.msg);
    },
  });
  client.onAnswer((id, paid, why) => answers.push([id, paid, why]));
  const settledWas: number[] = [];
  client.onChange((why, was) => {
    if (why === 'settled') settledWas.push(was);
  });
  /** Hand the server's words to the client, as `Net` would, until there are none. */
  const pump = () => {
    while (inbox.length) client.word(inbox.shift()!);
  };
  client.use('c-client');
  client.debug({ xp: { demolitions: 2000, melee: 300 } });
  client.debug({ grant: 'demo.ordnance.1' });
  ok(client.host === 'local' && client.local === 2, 'with no server the browser holds the record, and what it did counts as two batches made alone');
  // A server whose hail says nothing of progress: still this browser's.
  Object.assign(line, { authority: 'server', progress: 0, status: 'online', mode: 'server' });
  ok(client.host === 'local', 'a server whose hail says nothing of progress leaves it this browser\'s, as before this wave');
  // A server that holds progress: held until the claim's answer, then settled the browser's way.
  line.progress = 1;
  ok(client.host === 'held' && !client.claim(claimOf(h.clock.now)).sent, 'a server that holds it: nobody changes it until it is settled, and a claim made meanwhile waits');
  h.clock.wall += 1100;
  client.claimed(false);
  pump();
  ok(sent.at(-1)?.do === 'sync' && sent.at(-1)?.local === 2 && !sent.some((m) => m.do === 'offer'), 'the claim answered, it says what it holds; asked for it, it waits the offer\'s delay before the first piece');
  h.clock.wall += PROGRESS_TUNE.offerDelay;
  client.step(h.clock.wall);
  pump();
  const rec = client.record!;
  ok(client.host === 'server' && rec.local === 0 && rec.base === rec.rev && rec.core.melee === 300 && !!rec.nodes['demo.ordnance.1'] && settledWas.at(-1) === 2, 'its record goes up and comes back as the server\'s, nothing left counted as made alone, the settle told with the count it took back');
  // The claim that waited goes up now, a gap after the last thing sent, and is paid by the server's batch.
  h.clock.wall += PROGRESS_TUNE.claimGap;
  client.step(h.clock.wall);
  pump();
  ok((client.record!.core.marksmanship ?? 0) > 0 && answers.length === 1 && (answers[0][1].marksmanship ?? 0) > 0, 'the claim made while it was held goes up once settled, and the server\'s batch pays it');
  // A claim now: nothing changes here until the server answers.
  const marks = client.record!.core.marksmanship ?? 0;
  const revWas = client.record!.rev;
  h.p.death('wild:k', [5], 5, WORLD);
  h.clock.wall += PROGRESS_TUNE.claimGap;
  const o = client.claim(claimOf(h.clock.now, { members: [member('test_kept', 'wild:k')] }));
  ok(o.ok && o.sent === true && client.record!.core.marksmanship === marks && client.record!.rev === revWas, 'a claim with the server holding the record is sent, and the browser applies nothing of it first');
  pump();
  ok((client.record!.core.marksmanship ?? 0) > marks && client.record!.rev === revWas + 1 && body(client.record) === body(h.p.recordOf('c-client')), 'the server\'s batch comes back at the next revision, and the two copies are one');
  // A claim the server never heard is sent again once, with the same id, and paid once.
  deaf = true;
  h.clock.wall += PROGRESS_TUNE.claimGap;
  const lost = claimOf(h.clock.now, { members: [member('test_lost')] });
  client.claim(lost);
  deaf = false;
  h.clock.wall += PROGRESS_TUNE.claimWait;
  client.step(h.clock.wall);
  pump();
  ok(client.stats.resent === 1 && sent.filter((m) => m.do === 'claim' && (m.c as EncounterClaim).id === lost.id).length === 2 && answers.at(-1)?.[0] === lost.id, 'a claim unanswered for the wait goes again, with the same id, and is answered');
  deaf = true;
  h.clock.wall += PROGRESS_TUNE.claimGap;
  const never = claimOf(h.clock.now, { members: [member('test_never')] });
  client.claim(never);
  h.clock.wall += PROGRESS_TUNE.claimWait;
  client.step(h.clock.wall);
  h.clock.wall += PROGRESS_TUNE.claimWait;
  client.step(h.clock.wall);
  deaf = false;
  ok(answers.at(-1)?.[0] === never.id && /never answered/.test(String(answers.at(-1)?.[2])) && client.stats.unanswered === 1, 'and one never answered is given up, and said so to whoever asked');
  // A batch that skips a revision asks for the whole record again.
  inbox.push({ t: 'progress', do: 'ch', rev: client.record!.rev + 5, ch: [], kind: 'claim' });
  h.clock.wall += 1100;
  pump();
  ok(client.stats.gaps === 1 && sent.at(-1)?.do === 'sync', 'a batch that skips a revision is not applied: the record is asked for again');
  h.clock.wall += 1100;
  pump();
  // The line drops for good with a claim on its way: it is this browser's again, and the claim is paid here once.
  deaf = true;
  h.clock.wall += PROGRESS_TUNE.claimGap;
  const dropped = claimOf(h.clock.now, { members: [member('test_drop')] });
  client.claim(dropped);
  Object.assign(line, { authority: 'me', progress: 0, status: 'off', mode: 'off' });
  const localBefore = client.local;
  client.step(h.clock.wall);
  deaf = false;
  ok(client.host === 'local' && client.local === localBefore + 1 && answers.at(-1)?.[0] === dropped.id && (answers.at(-1)?.[1].marksmanship ?? 0) > 0, 'the line put down with a claim unanswered: the record is this browser\'s again and the claim is paid here, once');
  ok(client.debug({ rate: 3 })[0].rate === 3 && PROGRESS_RULES.xpRate === 3, 'alone again, the console\'s rate is this browser\'s own');
  client.debug({ rate: 1 });
}

console.log(`\n${checks} checks passed`);
