// The story's named people and the consequences this pass builds (`src/story/people.ts`, the actions in
// `src/story/quests.ts`, the server's own rule in `server/stories.mjs`).
//
// What is pinned:
//
//   - named people only: a cast member, or one of the game's own people a cast file promotes, has a record of
//     their own; a crowd row met in passing keeps its met and named stamps and nothing more -- the rules refuse
//     the rest, the checker says so, and a server cuts it from a book handed up (on a live relay);
//   - truth and knowledge are apart: a person the story kills stops being stood and spoken to at once, every
//     step waiting on them is held, and the People tab shows them gone only once the page that says so is in
//     the journal;
//   - a refusal and a vouching: refused, they say only that; vouched for, they speak again, at the voucher's cost;
//     a track that burns the character takes its contacts with it;
//   - a fine takes what the purse holds and owes the rest, the purse never going below nought;
//   - who was last seen, where and when, which the People tab shows by the name the character knows;
//   - `test:fail` end to end, and the job it closes never offered again.
//
// Synthetic, the committed test set and a relay on a port of its own: nothing is read from the game's own files.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyBook, type StoryBook } from '../../../src/story/book.ts';
import { checkSet } from '../../../src/story/check.ts';
import { parseCondition } from '../../../src/story/expr.ts';
import { HostCore } from '../../../src/story/hostCore.ts';
import { noteWords } from '../../../src/story/notes.ts';
import { TALK_GONE, TALK_REFUSED, accessOf, castFor, isNamed, knownGone, namedOnly, peopleView, whoOf } from '../../../src/story/people.ts';
import { evalCond, type StoryNote } from '../../../src/story/quests.ts';
import { reactionFor } from '../../../src/story/reactions.ts';
import { joinSets, loadSet } from '../../../src/story/set.ts';
import { cleanView, viewOf } from '../../../src/story/view.ts';
import { readStorySet } from '../../../server/storySet.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));
const testFiles = readStorySet(TESTSET).files.filter((f: { path: string }) => !f.path.startsWith('fixtures/'));
const test = loadSet(testFiles, { test: true }).set;
// A set of the test's own beside it, promoting one of the game's own people to a named person.
const ownFiles = [
  { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST OWN" }' },
  { path: 'cast/keeper.jsonc', text: '{ "id": "keeper", "row": "row:keep1", "name": "TEST KEEPER", "unknownAs": "TEST: a keeper", "side": "rebel" }' },
];
const own = loadSet(ownFiles).set;
const lib = joinSets([own, test]);
const CLERK = 'test:cast/test-clerk';
const DOOMED = 'test:cast/test-doomed';
let now = 1_900_000_000_000;
const ctx = (o: Record<string, unknown> = {}) => ({ now, world: 'tatooine', here: [3482, -4690] as [number, number], room: null, species: 'human_male', name: 'Han', credits: 100, ...o });
const holds = (book: StoryBook, src: string) => {
  const r = parseCondition(src);
  if ('error' in r) throw new Error(`${src}: ${r.error.message}`);
  return evalCond(r.cond, book, { ...ctx(), char: book.char, payer: 'browser' }, {}, undefined, lib);
};
const words = (notes: StoryNote[]) => notes.map((n) => noteWords(n, lib, { text: (t) => (typeof t === 'string' ? t : t.en) }) ?? '').filter(Boolean);
const tick = () => {
  now += 1000;
};

// ---- who is named ------------------------------------------------------------------------------------------
{
  ok(isNamed(lib, CLERK) && isNamed(lib, 'row:keep1') && isNamed(lib, 'own:cast/keeper') && !isNamed(lib, 'row:crowd') && !isNamed(lib, 'test:cast/nobody'), 'a cast member and a promoted row are named; a crowd row and somebody no set has are not');
  ok(whoOf(lib, 'own:cast/keeper') === 'row:keep1' && whoOf(lib, CLERK) === CLERK && castFor(lib, 'row:keep1')?.name === 'TEST KEEPER', 'a promotion is kept under its row\'s key, whichever way the story writes it');
  const h = new HostCore({ book: emptyBook('c-named'), lib, payer: 'browser' });
  const crowd = h.run(['npc(row:crowd, 50, 0)'], ctx());
  ok(/not one of the story's named people/.test(crowd.why ?? '') && h.book.npcs?.['row:crowd'] === undefined, `a crowd row is given no record of their own (${crowd.why})`);
  tick();
  h.run(['npc(row:keep1, 50, 0)', 'npc(own:cast/keeper, 10, 0)'], ctx());
  ok(h.book.npcs?.['row:keep1']?.standing === 60 && h.book.npcs?.['own:cast/keeper'] === undefined, 'a promoted row is, under the row\'s own key, however it is named');
  // Introduced by their cast id, they are named under the row's key too: shown by name, and one person on the tab.
  tick();
  h.run(['introduce(own:cast/keeper)'], ctx());
  const keeper = peopleView(h.book, lib).filter((p) => p.id === 'row:keep1' || p.id === 'own:cast/keeper');
  ok(h.book.npcs?.['row:keep1']?.named === now && h.book.npcs?.['own:cast/keeper'] === undefined && holds(h.book, 'named(own:cast/keeper)') && holds(h.book, 'named(row:keep1)'), 'a promoted row introduced by their cast id is named under the row\'s key, and read so either way');
  ok(keeper.length === 1 && keeper[0].id === 'row:keep1' && keeper[0].name === 'TEST KEEPER', `and the People tab shows one person, by name (${JSON.stringify(keeper)})`);
  const r = checkSet(
    loadSet([
      ...ownFiles,
      { path: 'quests/q.jsonc', text: JSON.stringify({ id: 'q', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], needs: 'npcStanding(row:crowd) > 1 || met(row:crowd)', steps: { s: { type: 'nothing', do: { done: ['refuse(row:crowd)', 'kill(row:keep1)', 'recruit(cast/keeper)'] }, ends: 'done' } } }) },
    ]),
  );
  ok(r.errors.filter((e) => e.rule === 1 && /row:crowd is not one of the story's named people/.test(e.message)).length === 2 && !r.errors.some((e) => /row:keep1 is not/.test(e.message)), 'the checker refuses a record of a crowd row (a condition on their Standing, a refusal) and lets them be met; a promoted row passes');
  ok(r.errors.some((e) => /not a companion/.test(e.message)), 'and recruiting somebody who is not a companion');
}

// ---- truth and knowledge -------------------------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-death'), lib, payer: 'browser' });
  h.talkOpen(DOOMED, ctx());
  ok(peopleView(h.book, lib).some((p) => p.id === DOOMED && !p.gone) && viewOf(h.book, lib, { ...ctx(), char: 'c-death', payer: 'browser' }).cast.some((c) => c.id === DOOMED), 'TEST DOOMED met and stood');
  h.grant('test:talk', ctx());
  tick();
  h.run(['kill(cast/test-doomed, test-how, doc/test-death)'], ctx());
  const rec = h.book.npcs?.[DOOMED];
  ok(rec?.alive === false && rec.diedAt === now && rec.how === 'test-how' && rec.known?.by === 'test:doc/test-death' && rec.known.alive === undefined, 'killed: the truth written, with how and the page that will tell it, and nothing known yet');
  const v = viewOf(h.book, lib, { ...ctx(), char: 'c-death', payer: 'browser' });
  ok(!v.cast.some((c) => c.id === DOOMED) && v.people?.some((p) => p.id === DOOMED && !p.gone) === true, 'never stood again at once, while the People tab, which shows only what is known, does not say they are gone');
  ok(v.mute?.some((m) => m.id === DOOMED && m.why === 'gone') === true, 'and the view says they will not speak, for a greeting that asks no host');
  const spoke = h.talkOpen(DOOMED, ctx());
  ok(spoke.turn.view === null && spoke.turn.why === TALK_GONE, 'nobody speaks for them any more');
  ok(!holds(h.book, 'alive(test:cast/test-doomed)') && holds(h.book, 'alive(test:cast/test-clerk)'), 'a condition reads the truth');
  // The page that says so, handed over and opened: now it is known.
  tick();
  h.run(['doc(doc/test-death)'], ctx());
  h.read('test:doc/test-death', {}, ctx(), () => undefined);
  ok(knownGone(h.book, DOOMED) && peopleView(h.book, lib).find((p) => p.id === DOOMED)?.gone === true, 'once the notice is in the journal, the People tab shows them gone');
  // A step waiting on a conversation of theirs is held: nobody is left who can sign it off.
  const lib2 = joinSets([loadSet([{ path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' }, { path: 'quests/ask.jsonc', text: JSON.stringify({ id: 'ask', title: 'TEST ASK', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'talk', who: 'test:cast/test-doomed', ends: 'done' } } }) }]).set, test]);
  const h2 = new HostCore({ book: emptyBook('c-held'), lib: lib2, payer: 'browser' });
  h2.grant('own:ask', ctx());
  ok(h2.book.quests?.['own:ask']?.state === 'active', 'a job waiting to talk to TEST DOOMED runs');
  tick();
  h2.run(['kill(cast/test-doomed)'], ctx());
  ok(h2.book.quests?.['own:ask']?.state === 'stalled' && /Nobody is left/.test(h2.book.quests['own:ask'].why ?? ''), 'and is held the moment they are killed');
}

// ---- refused, vouched, and a burned track's contacts --------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-access'), lib, payer: 'browser' });
  h.run(['refuse(cast/test-clerk)'], ctx());
  ok(accessOf(h.book, lib, CLERK, now) === 'refused' && holds(h.book, 'access(test:cast/test-clerk) == "refused"'), 'refused: their access says so');
  const no = h.talkOpen(CLERK, ctx());
  ok(no.turn.view === null && no.turn.why === TALK_REFUSED, `and they say only that they will not speak (${no.turn.why})`);
  tick();
  h.run(['npc(cast/test-doomed, 40, 0)', 'vouch(cast/test-doomed, cast/test-clerk, 10)'], ctx());
  ok(accessOf(h.book, lib, CLERK, now) === 'vouched' && h.book.npcs?.[DOOMED]?.standing === 30, 'vouched for, the clerk will speak again, and the voucher\'s regard for the character pays for it');
  ok(h.talkOpen(CLERK, ctx()).turn.view?.node === 'hello', 'and they do');
  // The keeper is the Rebellion's: burned by it, they will not speak, unless somebody vouches.
  tick();
  h.run(['activate(rebellion)', 'burn(rebellion)'], ctx());
  ok(accessOf(h.book, lib, 'row:keep1', now) === 'refused' && accessOf(h.book, lib, CLERK, now) === 'vouched', 'a burned track takes its contacts with it, and a vouching still stands');
  // The keeper has no conversation of their own, so no host is asked before their greeting: the view says they
  // will not speak, and it crosses the wire as it is.
  const muted = viewOf(h.book, lib, { ...ctx(), char: 'c-access', payer: 'browser' });
  ok(muted.mute?.some((m) => m.id === 'row:keep1' && m.why === 'refused') === true && !muted.mute?.some((m) => m.id === CLERK), `the view names a burned track's contact as one who will not speak, under the row's key, and not one vouched for (${JSON.stringify(muted.mute)})`);
  ok(JSON.stringify(cleanView(JSON.parse(JSON.stringify(muted)))?.mute) === JSON.stringify(muted.mute) && cleanView({ ...muted, mute: [{ id: 'row:keep1', why: 'sulking' }, { id: '__proto__', why: 'gone' }] })?.mute === undefined, 'and off the wire it is kept exactly, and nothing else is taken for it');
  tick();
  h.run(['vouch(cast/test-clerk, row:keep1, 5)'], ctx());
  ok(accessOf(h.book, lib, 'row:keep1', now) === 'vouched' && !viewOf(h.book, lib, { ...ctx(), char: 'c-access', payer: 'browser' }).mute?.some((m) => m.id === 'row:keep1'), 'and a contact vouched for after the burn speaks again, and is no longer named as mute');
}

// ---- fines and debts ------------------------------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-fine'), lib, payer: 'browser' });
  const r = h.run(['fine(25, "TEST: a fine", test.bank)'], ctx({ credits: 10 }));
  const charge = r.pay.find((p) => p.charge);
  ok(charge?.charge === 10 && h.book.debts?.['test.bank'] === 15, `what the purse holds is taken and the rest owed, never below nought (${charge?.charge} taken, ${h.book.debts?.['test.bank']} owed)`);
  ok(words(r.notes).includes('Fined 10 credits: TEST: a fine; 15 credits owed to test bank'), `and the message line says both (${words(r.notes).join(' | ')})`);
  ok(holds(h.book, 'debt(test.bank) > 14') && !holds(h.book, 'debt(test.bank) > 15'), 'a condition reads what is owed');
  tick();
  const two = h.run(['fine(5, "TEST: one", fines)', 'fine(5, "TEST: two", fines)'], ctx({ credits: 7 }));
  ok(two.pay.filter((p) => p.charge).map((p) => p.charge).join() === '5,2' && h.book.debts?.fines === 3, 'two fines in one breath never take the same credits twice');
  tick();
  h.run(['debt(test.bank, -15)'], ctx());
  ok(h.book.debts?.['test.bank'] === undefined && !holds(h.book, 'debt(test.bank) > 0'), 'a debt paid off is gone');
  // The purse refusing the charge after all: the host owes it instead, so a fine ends taken or owed.
  ok(r.pay.find((p) => p.charge)?.owe === 'test.bank', 'a fine\'s charge names what it is owed to, should the purse refuse it');
  tick();
  h.owe('test.bank', 10, ctx());
  ok(h.book.debts?.['test.bank'] === 10 && h.owe('test.bank', 0, ctx()).ch.length === 0 && h.owe('__proto__', 5, ctx()).ch.length === 0, 'and owing it adds to the debt, while nothing, or a debt with no proper name, is not owed');
  ok(words([{ k: 'fined', quest: 'run', credits: 0, owed: 10, reason: 'TEST: a fine', to: 'test.bank' }]).join() === 'Fined: TEST: a fine; 10 credits owed to test bank' && noteWords({ k: 'fined', quest: 'run', credits: 10, owed: 0, reason: 'TEST: a fine', to: 'test.bank' }, lib, { text: (t) => (typeof t === 'string' ? t : t.en) }, false) === 'Fined: TEST: a fine; 10 credits could not be taken', 'said as owed, and one that could be neither taken nor owed says it was not taken');
}

// ---- a fine on a server whose purse refuses it -------------------------------------------------------------------
{
  const { STORY_TUNING, Stories, applyStory } = await import('../../../server/stories.mjs');
  const { Purses } = await import('../../../server/purse.mjs');
  const { cleanStoryWord } = await import('../../../src/story/storyWire.ts');
  const purses = new Purses();
  const worlds = { worldOf: (p: string) => p, kindOf: () => 'planet', centreOf: () => null, hourOf: () => null, describe: () => ({}) };
  const server = new Stories({ tuning: { ...STORY_TUNING }, write: (rec: object) => void applyStory(server.data, rec), now: () => now, purses, worlds, read: () => ({ test: testFiles, own: null }), admin: () => true, tests: true });
  server.readSets();
  // A purse that will not give what a charge asks, whatever it holds: what a spend elsewhere in the same moment meets.
  const realPay = server.pay.bind(server);
  server.pay = (line: unknown, o: { charge?: number }, tell: unknown[]) => (o.charge ? false : realPay(line, o, tell));
  const c = { id: 1, character: 'c-srvfine', keep: 'server', asking: null, hello: { planet: 'tatooine', zone: '' }, state: { p: [0, 0, 0] } };
  server.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
  const r = server.hear(c, { t: 'story', do: 'admin', op: 'grant', quest: 'test:fail' }) as { tell: { msg: Record<string, unknown> }[] };
  const book = server.bookOf('c-srvfine') as StoryBook;
  const note = r.tell.map((t) => cleanStoryWord(t.msg, 'down')).find((w) => w?.do === 'note' && (w.note as { k: string }).k === 'fined') as { note: StoryNote; given: boolean } | undefined;
  ok(purses.of('c-srvfine') >= 25 && book.debts?.['test.bank'] === 25, `the server owes a fine its purse refused, in full (${JSON.stringify(book.debts)})`);
  ok(!!note && note.given && words([note.note]).join() === 'Fined: TEST: a fine; 25 credits owed to test bank', `and says so as owed, never as taken (${note ? words([note.note]).join() : 'no note'})`);
  const batches = r.tell.filter((t) => t.msg.do === 'ch').map((t) => t.msg.ch as { k: string; to?: string; owed?: number }[]);
  ok(batches.some((ch) => ch.length === 1 && ch[0].k === 'debt' && ch[0].to === 'test.bank' && ch[0].owed === 25), 'in a batch of its own, sent to the browser as every batch is');
}

// ---- last seen ---------------------------------------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-seen'), lib, payer: 'browser' });
  h.talkOpen(CLERK, ctx());
  const rec = h.book.npcs?.[CLERK];
  ok(rec?.lastSeenAt === now && rec.lastSeenWhere === 'tatooine' && rec.met === now, 'spoken to, a named person is seen: when and where');
  const p = peopleView(h.book, lib).find((x) => x.id === CLERK);
  ok(p?.name === 'TEST: a clerk' && p.lastSeenWhere === 'tatooine', 'the People tab shows them by the name the character knows');
  const back = cleanView(JSON.parse(JSON.stringify(viewOf(h.book, lib, { ...ctx(), char: 'c-seen', payer: 'browser' }))));
  ok(back?.people?.[0]?.id === CLERK && back.people[0].lastSeenAt === now, 'and the people cross the wire as the view does');
  // A record from before anybody was marked seen was last seen when it was met.
  const old = { ...emptyBook('c-old'), npcs: { [CLERK]: { met: now - 5000 } } };
  ok(peopleView(old, lib).find((x) => x.id === CLERK)?.lastSeenAt === now - 5000, 'a person met before the seen stamps were kept was last seen when they were met');
  // One of the game's own people a story names greets as coldly as their own Trust says.
  tick();
  h.run(['npc(row:keep1, 0, -4)'], ctx());
  const cold = reactionFor({ diction: 'military', faction: 'rebel' }, h.book, 'row:keep1', now);
  const other = reactionFor({ diction: 'military', faction: 'rebel' }, h.book, 'row:other', now);
  ok(cold?.warmth === 'mean' && other?.warmth === 'mid', 'a promoted row greets as coldly as their own Trust says, and nobody else is touched');
}

// ---- everything goes wrong ------------------------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-fail'), lib, payer: 'browser' });
  h.talkOpen(DOOMED, ctx());
  h.grant('test:closedLater', ctx());
  h.drop('test:closedLater', ctx());
  tick();
  const r = h.grant('test:fail', ctx({ credits: 0 }));
  ok(h.book.debts?.['test.bank'] === 25 && accessOf(h.book, lib, CLERK, now) === 'refused', 'the fine owed in full with an empty purse, and the clerk refusing');
  tick();
  const vouched = h.event({ k: 'signal', name: 'debug:test-vouch' }, ctx());
  ok(accessOf(h.book, lib, CLERK, now) === 'vouched' && h.book.tracks?.rebellion?.status === 'burned', 'vouched for, and the Rebellion has burned the character');
  tick();
  const killed = h.event({ k: 'signal', name: 'debug:test-kill' }, ctx());
  ok(h.book.npcs?.[DOOMED]?.alive === false && h.book.quests?.['test:fail']?.state === 'done' && h.book.closed?.includes('test:closedLater') === true && h.book.docs?.['test:doc/test-death'] !== undefined, 'TEST DOOMED killed, the notice handed over, the job done and test:closedLater closed');
  ok(h.grant('test:closedLater', ctx()).why === 'that job is closed', 'and test:closedLater is never offered again');
  // Everything the three batches said, by what kind of thing it says: the job's own lines (its objectives name
  // what it waits on), the fine, the rank changing and the notice handed over are said; nothing else may be.
  const all = [...r.notes, ...vouched.notes, ...killed.notes];
  const rank = words(all.filter((n) => n.k === 'rank'));
  ok(rank.includes('Rebellion: taken on') && rank.includes('Rebellion: you are burned'), `the track taking the character on and burning them is said, in words (${rank.join(' | ')})`);
  const SAID = ['job', 'objective', 'objectiveDone', 'done', 'fined', 'rank', 'doc'];
  const rest = all.filter((n) => !SAID.includes(n.k));
  ok(rest.length === 0, `nothing else is said at all: no refusal, no vouching, no Trust and no death (${words(rest).join(' | ')})`);
  ok(!words(all.filter((n) => n.k === 'doc')).some((w) => /DOOMED|stranger|dead|kill/i.test(w)), 'and the notice is pointed to by its title alone, never by whose death it tells');
}

// ---- the server: named people only, on a live relay ----------------------------------------------------------------
{
  // In memory first: the rule a server holds a book handed up to.
  const book: StoryBook = { ...emptyBook('c-cut'), npcs: { 'row:crowd': { met: 1, named: 2, standing: 900, alive: false, known: { alive: false } }, 'row:keep1': { met: 1, standing: 7 }, [CLERK]: { access: 'refused' } }, companion: { who: CLERK, state: 'active', downs: 0, recruitedAt: 1 } } as unknown as StoryBook;
  const n = namedOnly(book, lib);
  ok(n === 2 && JSON.stringify(book.npcs?.['row:crowd']) === '{"met":1,"named":2}' && book.npcs?.['row:keep1']?.standing === 7 && book.npcs?.[CLERK]?.access === 'refused' && book.companion === null, 'a crowd row\'s record is cut to its met and named stamps, a named person\'s kept, and a companion the story has no such companion of let go');

  const { randomBytes } = await import('node:crypto');
  const { playerIdFor, proofFor, verifierFor } = await import('../../../server/identity.mjs');
  const { bookText, chunkText } = await import('../../../src/story/storyWire.ts');
  const dir = mkdtempSync(join(tmpdir(), 'swg-people-'));
  const storyDir = join(dir, 'story');
  mkdirSync(join(storyDir, 'cast'), { recursive: true });
  for (const f of ownFiles) writeFileSync(join(storyDir, f.path), f.text);
  const port = 18843;
  process.env.PORT = String(port);
  process.argv.push(`--data=${join(dir, 'world')}`, '--story-tests', `--story=${storyDir}`);
  await import('../../../server/relay.mjs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  type Msg = Record<string, unknown>;
  const key = new Uint8Array(randomBytes(32));
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: Msg[] = [];
  let nonce = '';
  try {
    await new Promise<void>((done, fail) => {
      ws.addEventListener('open', () => done());
      ws.addEventListener('error', () => fail(new Error('could not connect')));
    });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String((e as MessageEvent).data)) as Msg;
      if (m.t === 'hail') nonce = String(m.nonce ?? '');
      got.push(m);
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    await wait(150);
    const hail = got.find((m) => m.t === 'hail') as { story?: { v: number } } | undefined;
    ok(hail?.story?.v === 5, 'the relay\'s hail says it holds Standing, the people and the companion (story 5)');
    send({ t: 'claim', player: playerIdFor(key), key: verifierFor(key), proof: proofFor(verifierFor(key), nonce), character: 'c-relay', name: 'Han', counter: 1, about: { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' } });
    await wait(150);
    send({ t: 'hello', name: 'Han', species: 'human_male', class: 'jedi', planet: 'tatooine', v: 5 });
    await wait(150);
    send({ t: 'story', do: 'sync', has: 1, base: 0, local: 1, known: 0 });
    await wait(200);
    ok(got.some((m) => m.t === 'story' && m.do === 'want'), 'a character the server has no book of is asked for its own');
    const offered = { ...emptyBook('c-relay'), local: 1, npcs: { 'row:crowd': { met: 1, standing: 900, access: 'refused', lastSeenAt: 3 }, 'row:keep1': { met: 1, trust: 2 } }, companion: { who: 'row:crowd', state: 'active', downs: 0, recruitedAt: 1 } };
    const parts = chunkText(bookText(offered), 24000);
    for (let i = 0; i < parts.length; i++) send({ t: 'story', do: 'offer', id: 1, n: i, of: parts.length, part: parts[i], known: 0 });
    await wait(300);
    const pieces = got.filter((m) => m.t === 'story' && m.do === 'book');
    const last = pieces.length ? pieces[pieces.length - 1] : null;
    const mine = last ? pieces.filter((m) => m.id === last.id).sort((a, b) => Number(a.n) - Number(b.n)) : [];
    const taken = mine.length && mine.length === Number(mine[0].of) ? (JSON.parse(mine.map((m) => String(m.part)).join('')) as StoryBook) : null;
    ok(!!taken && last?.take === 'browser', 'the browser\'s book is taken and handed back');
    ok(JSON.stringify(taken?.npcs?.['row:crowd']) === '{"met":1}' && taken?.npcs?.['row:keep1']?.trust === 2 && !taken?.companion, `and the server cut it to the named people: the crowd row kept only as met, the promoted row whole, the companion who was nobody's let go (${JSON.stringify(taken?.npcs)})`);
    const status = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { stories: { v: number; stats: { unnamed: number } } };
    ok(status.stories.v === 5 && status.stories.stats.unnamed === 2, `the status page counts what it cut (${status.stories.stats.unnamed})`);
    // The companion's word: believed from the browser that stands them. Taken on first, in their own conversation
    // (the server knows no layout centre here, so where the player stands is taken on the browser's word).
    const COMPANION = 'test:cast/test-companion';
    send({ t: 'story', do: 'talk', op: 'open', speaker: COMPANION, at: {} });
    await wait(150);
    send({ t: 'story', do: 'talk', op: 'pick', speaker: COMPANION, reply: 'join', at: {} });
    await wait(150);
    send({ t: 'story', do: 'talk', op: 'close', speaker: COMPANION, at: {} });
    await wait(100);
    type Rec = { k: string; rec?: { who: string; state: string; downs: number } | null };
    const companionRecs = () => got.filter((m) => m.t === 'story' && m.do === 'ch').flatMap((m) => m.ch as Rec[]).filter((c) => c.k === 'companion');
    ok(companionRecs().at(-1)?.rec?.who === COMPANION && companionRecs().at(-1)?.rec?.state === 'active', `TEST COMPANION taken on in their own conversation on the server (${JSON.stringify(companionRecs().at(-1))})`);
    const before = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { stories: { stats: { events: number }; refusedBy: Record<string, number> } };
    send({ t: 'story', do: 'ev', ev: { k: 'companion', up: false }, at: {} });
    await wait(200);
    const down = companionRecs().at(-1)?.rec;
    const after = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { stories: { stats: { events: number }; refusedBy: Record<string, number> } };
    ok(down?.state === 'downed' && down.downs === 1, `word of the companion going down is believed: the server's book holds them down, and the batch says so (${JSON.stringify(down)})`);
    ok(after.stories.stats.events === before.stories.stats.events + 1 && !after.stories.refusedBy.companion, 'counted as an event the server took, and never as one refused');
    send({ t: 'story', do: 'ev', ev: { k: 'companion', up: true }, at: {} });
    await wait(200);
    ok(companionRecs().at(-1)?.rec?.state === 'active', 'and up again as the browser says');
  } finally {
    ws.close();
    await wait(100);
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\npeople: ${checks} checks passed`);
process.exit(0);
