// The journal (`src/story/journal.ts`, written by the host loop in `hostCore.ts`, `docRules.ts` and
// `talkRules.ts`, kept by the server in `server/stories.mjs`): what a character witnessed, and nothing else.
//
// What is pinned:
//
//   - an entry is written only as something is delivered to the character's screen: a document opened, a call
//     heard, a conversation's transcript once its window closes, a note where the player is; handing a document
//     over, a deadline running out, a file entry, a change of Standing and a signal write nothing;
//   - none comes from a hidden step or a world-clock expiry: a note the story runs while the character is away
//     is not written, and the checker refuses one written where the player might not be (rule 6);
//   - the words are kept by their hash, so an entry shows the words as they were after the owner rewrites the
//     line -- a document's page and a conversation's lines alike -- and a line in the client's own words is kept
//     as the browser read it out, or as its reference when nobody did;
//   - entries are only ever added, each the next in line; no change takes one away, a list read back stops at an
//     entry out of its place, and the caps hold;
//   - one timeline: a book handed up that descends from the server's own copy and has lost entries is refused and
//     the server's stands, while a book from another timeline is never compared entry by entry;
//   - the window's paging, filters and facets, and the player's own notes on an entry;
//   - the server's disk: the words past `textsApart` go to a file of their own, which a snapshot writes again only
//     when a word was added since;
//   - the server's transcript of one of the game's own people keeps a client line in the words the browser read
//     out, keeps nothing handed up for a line never said, names them as the band did, and a conversation cut off
//     by the line closing is written as far as it went, its client lines as references;
//   - against the relay itself: a document opened and read to its end, the words of a stretch of the journal, a
//     conversation's transcript, a note of the player's own, and a book played alone whose journal's words the
//     server has not got, asked for (`need`) and handed up in pieces (`texts`) -- and the same driven through the
//     very `RemoteHost` the game runs: a page reaching the window, the answer to a reading to the end saying so, a
//     note's words kept the moment it goes up, lost words asked for and put into the store, and words a server
//     asked for sent up in pieces on the host's own clock.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOK_LIMITS, applyChanges, cleanBook, cleanChange, emptyBook, shrinksWithin, type StoryBook } from '../../../src/story/book.ts';
import { checkSet } from '../../../src/story/check.ts';
import { HostCore } from '../../../src/story/hostCore.ts';
import type { DocWord } from '../../../src/story/docRules.ts';
import { cleanJournal, journalFacets, journalHashes, journalPage, journalShrinks, minesOn, textHash, type JournalEntry } from '../../../src/story/journal.ts';
import type { TextKeep } from '../../../src/story/localHost.ts';
import { loadSet, type StorySet } from '../../../src/story/set.ts';
import { readStorySet } from '../../../server/storySet.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));
const testFiles = readStorySet(TESTSET).files.filter((f: { path: string }) => !f.path.startsWith('fixtures/'));
const lib = loadSet(testFiles, { test: true }).set;
const CLERK = 'test:cast/test-clerk';
let now = 1_900_000_000_000;
const ctx = (o: Record<string, unknown> = {}) => ({ now, world: 'tatooine', here: [3482, -4690] as [number, number], room: null, species: 'human_male', name: 'Han', credits: 100, ...o });
const texts = new Map<string, string>();
const keep = (r: { texts: Record<string, string> }) => {
  for (const h of Object.keys(r.texts)) texts.set(h, r.texts[h]);
  return r;
};
const hostOf = (s: StorySet = lib, book: StoryBook = emptyBook('c-j')) => new HostCore({ book, lib: s, payer: 'browser' });

// ---- only what is delivered --------------------------------------------------------------------------------
{
  const h = hostOf();
  keep(h.grant('test:docs', ctx()));
  ok(!(h.book.journal?.length) && !!h.book.docs?.['test:doc/test-pages'], 'a document handed over is to read, and nothing is written yet');
  keep(h.grant('test:file', ctx()));
  ok(!(h.book.journal?.length) && (h.book.files?.isb?.entries.length ?? 0) === 1, 'an entry in the ISB\'s file writes nothing in the journal');
  now += 6000;
  keep(h.sweep(ctx()));
  ok(h.book.quests?.['test:file']?.state === 'done' && !(h.book.journal?.length), 'nor does a deadline running out');
  keep(h.run(['standing(freelance, 5)', 'signal(debug:test-ping)'], ctx()));
  ok(!(h.book.journal?.length), 'nor a change of Standing, nor a signal');
  keep(h.read('test:doc/test-pages', { end: true }, ctx(), (x) => texts.get(x)).r);
  const kinds = (h.book.journal ?? []).map((e) => e.kind).join();
  ok(kinds === 'doc,note', `a document opened is written, and so is the note the story writes where the player read it (${kinds})`);
  // A conversation: nothing until its window closes, then its transcript.
  const open = keep(h.talkOpen(CLERK, ctx()).r);
  void open;
  ok((h.book.journal ?? []).length === 2, 'a conversation under way writes nothing yet');
}
{
  // A transcript: the clerk's lines and the player's answer said aloud, the clerk as named then, and the client's
  // own words kept as the browser read them out.
  const h = hostOf(lib, emptyBook('c-talk'));
  const a = h.talkOpen(CLERK, ctx());
  const b = h.talkPick(a.turn.state!, 'name', ctx());
  const c = h.talkPick(b.turn.state!, null, ctx());
  const bye = h.talkPick(c.turn.state!, 'bye', ctx());
  ok(bye.turn.state === null && (bye.turn.log?.length ?? 0) >= 5, `a conversation that ends leaves its transcript on its last turn (${bye.turn.log?.length} lines)`);
  keep(h.talkJournal(CLERK, bye.turn.log!, {}, null, ctx()));
  const e = h.book.journal?.at(-1);
  const said = (e?.lines ?? []).map((l) => `${l.you ? 'you' : 'them'}:${texts.get(l.h ?? '') ?? l.ref}`);
  ok(e?.kind === 'talk' && e.with[0] === CLERK && e.title === 'TEST CLERK', 'the transcript names the speaker as the player knew them by the end of it');
  ok(said[0] === 'them:TEST: Good day. This is the test clerk\'s first line.' && said.includes('you:TEST: Who are you?') && said.at(-1) === 'you:TEST: Goodbye, then.', `with every line said and every answer said aloud, in turn (${said.length})`);
  // The client's own words: as the browser read them out, or kept as their reference.
  const d = hostOf(lib, emptyBook('c-talk2'));
  const log = [{ text: '@conversation/x:s_1' }, { you: 1 as const, text: '@conversation/x:s_2' }, { text: 'TEST: plain %TO', fill: { TO: 'filled' } }];
  keep(d.talkJournal(CLERK, log, { '@conversation/x:s_1': 'Words the browser read.' }, null, ctx()));
  const t = d.book.journal?.at(-1);
  ok(texts.get(t?.lines?.[0].h ?? '') === 'Words the browser read.' && t?.lines?.[1].ref === '@conversation/x:s_2' && texts.get(t?.lines?.[2].h ?? '') === 'TEST: plain filled', 'a client line is kept as the browser read it, one it did not read as its reference, and a story line with what the host could fill');
  ok(keep(d.talkJournal(CLERK, [], {}, null, ctx())).ch.length === 0, 'and a conversation in which nothing was said writes nothing');
}

// ---- never from a hidden step or an expiry ------------------------------------------------------------------------
{
  const h = hostOf(lib, emptyBook('c-away'));
  keep(h.run(['note("TEST: said while away")'], ctx({ away: true })));
  ok(!(h.book.journal?.length), 'a note the story runs while the character is away is not written: nobody was there to witness it');
  keep(h.run(['note("TEST: said here")'], ctx()));
  ok(h.book.journal?.length === 1 && texts.get(h.book.journal[0].h!) === 'TEST: said here', 'one run while they are here is');
  const q = (steps: unknown) => ({ path: 'quests/n.jsonc', text: JSON.stringify({ id: 'n', title: 'TEST', givers: [{ kind: 'debug' }], start: ['a'], steps }) });
  const head = { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' };
  const hidden = checkSet(loadSet([head, q({ a: { type: 'timer', for: { seconds: 5 }, visible: false, do: { done: ['note("TEST: hidden")'] }, ends: 'done' } })]));
  const expiry = checkSet(loadSet([head, q({ a: { type: 'timer', for: { seconds: 5 }, do: { done: ['note("TEST: expired")'] }, ends: 'done' } })]));
  ok(hidden.errors.some((e) => e.rule === 6 && /hidden/.test(e.message)) && expiry.errors.some((e) => e.rule === 6 && /world clock/.test(e.message)), 'and the checker refuses a note on a hidden step or on a world-clock deadline (rule 6)');
}

// ---- the words kept, after the owner rewrites them ------------------------------------------------------------------
{
  const h = hostOf(lib, emptyBook('c-rewrite'));
  keep(h.grant('test:docs', ctx()));
  const first = h.read('test:doc/test-pages', {}, ctx(), (x) => texts.get(x));
  keep(first.r);
  const a = h.talkOpen(CLERK, ctx());
  const log = h.talkPick(a.turn.state!, 'bye', ctx()).turn.log!;
  keep(h.talkJournal(CLERK, log, {}, null, ctx()));
  const rewrite = (f: { path: string; text: string }) =>
    f.path === 'docs/test-pages.doc.txt' ? { ...f, text: f.text.replace('first page of a test memo', 'TEST: REWRITTEN PAGE') } : f.path === 'talk/test-clerk.jsonc' ? { ...f, text: f.text.replace("TEST: Good day. This is the test clerk's first line.", 'TEST: A REWRITTEN GREETING') } : f;
  const next = loadSet(testFiles.map(rewrite), { test: true }).set;
  h.setLibrary(next, ctx());
  const doc = h.book.journal!.find((e) => e.kind === 'doc')!;
  const talk = h.book.journal!.find((e) => e.kind === 'talk')!;
  ok(texts.get(doc.h!)!.includes('first page of a test memo') && !texts.get(doc.h!)!.includes('REWRITTEN'), 'the owner rewrites the memo, and the entry shows the page as it was read');
  ok(texts.get(talk.lines![0].h!) === "TEST: Good day. This is the test clerk's first line.", 'and rewrites the clerk\'s greeting, and the transcript keeps the words as they were said');
  const reread = h.read('test:doc/test-pages', {}, ctx(), (x) => texts.get(x)).word.view;
  ok(!!reread && JSON.stringify(reread).includes('first page of a test memo') && !JSON.stringify(reread).includes('REWRITTEN'), 'the memo opened again from the journal is the page as it was read, not the rewritten one');
  // The two have met by now, so the clerk says something else first and goes on to the greeting.
  const again = h.talkOpen(CLERK, ctx());
  const on = h.talkPick(again.turn.state!, null, ctx());
  const fresh = h.talkPick(on.turn.state!, 'bye', ctx()).turn.log!;
  keep(h.talkJournal(CLERK, fresh, {}, null, ctx()));
  ok(texts.get(h.book.journal!.at(-1)!.lines![1].h!) === 'TEST: A REWRITTEN GREETING' && h.book.journal!.filter((e) => e.kind === 'talk').length === 2, 'while a conversation had since is a new entry, in the new words');
}

// ---- only ever added -----------------------------------------------------------------------------------------------
{
  const b = emptyBook('c-add');
  const entry = (id: string): JournalEntry => ({ id, at: now, kind: 'note', place: null, with: [], h: textHash(id) });
  ok(applyChanges(b, [{ k: 'journal', entry: entry('j1') }, { k: 'journal', entry: entry('j3') }, { k: 'journal', entry: entry('j2') }]).refused.length === 1 && b.journal?.map((e) => e.id).join() === 'j1,j2', 'an entry is only ever the next in line: one out of its place is refused');
  ok(cleanChange({ k: 'journalGone', id: 'j1' }) === null && cleanChange({ k: 'journal', entry: { ...entry('j9'), kind: 'doc' } }) === null, 'no change takes one away, and an entry without what its kind carries is not one');
  ok(cleanJournal([entry('j1'), entry('j2'), entry('j4'), entry('j5')], 100)?.length === 2, 'a journal read back stops at the first entry out of its place');
  const capped = emptyBook('c-cap');
  ok(applyChanges(capped, [{ k: 'journal', entry: entry('j1') }, { k: 'journal', entry: entry('j2') }], { ...BOOK_LIMITS, journal: 1 }).refused[0]?.why === 'a journal holds 1 entries', 'and past its cap nothing more is written');
  const mine = (id: string, ref: string): JournalEntry => ({ id, at: now, kind: 'mine', place: null, with: [], ref, h: textHash(id) });
  ok(applyChanges(b, [{ k: 'journal', entry: mine('j3', 'j3') }]).refused.length === 1 && applyChanges(b, [{ k: 'journal', entry: mine('j3', 'j1') }]).refused.length === 0 && applyChanges(b, [{ k: 'journal', entry: mine('j4', 'j3') }]).refused.length === 1, 'a note of the player\'s own goes only on an entry already there, and never on another of their own');
  const read = cleanBook(JSON.parse(JSON.stringify({ ...b, journal: [...b.journal!.slice(0, 2), mine('j3', 'j7')] })));
  ok(read?.journal?.length === 2, 'and a journal read back with one written on nothing is read up to it');
}

// ---- one timeline ---------------------------------------------------------------------------------------------------
{
  const e = (id: string, h = textHash(id)): JournalEntry => ({ id, at: 1, kind: 'note', place: null, with: [], h });
  const server = { ...emptyBook('c-t'), rev: 7, journal: [e('j1'), e('j2'), e('j3')] } as StoryBook;
  const shorter = { ...emptyBook('c-t'), rev: 9, base: 7, local: 2, journal: [e('j1'), e('j2')] } as StoryBook;
  const other = { ...emptyBook('c-t'), rev: 9, base: 7, local: 2, journal: [e('j1'), e('j2', textHash('else')), e('j3')] } as StoryBook;
  const longer = { ...emptyBook('c-t'), rev: 9, base: 7, local: 2, journal: [e('j1'), e('j2'), e('j3'), e('j4')] } as StoryBook;
  const forked = { ...emptyBook('c-t'), rev: 9, base: 5, local: 2, journal: [e('j1')] } as StoryBook;
  const alone = { ...emptyBook('c-t'), rev: 3, base: 0, local: 3, journal: [] } as StoryBook;
  ok(!!shrinksWithin(shorter, server) && !!shrinksWithin(other, server), 'a book that descends from the server\'s copy and has lost entries, or has others in their place, is refused');
  ok(shrinksWithin(longer, server) === null, 'one that only added to it is not');
  ok(shrinksWithin(forked, server) === null && shrinksWithin(alone, server) === null, 'a book from another timeline -- the server\'s copy has moved on since, or it was played from nothing -- is never compared entry by entry');
  ok(journalShrinks(undefined, undefined) === null, 'and two books with no journal lose nothing');
}

// ---- the window: paging, filters, facets, the player's own notes -------------------------------------------------------
{
  const entries: JournalEntry[] = [];
  for (let i = 1; i <= 120; i++) entries.push({ id: `j${i}`, at: i, kind: i % 3 ? 'note' : 'talk', place: { world: i % 2 ? 'tatooine' : 'naboo', raw: [0, 0] }, with: i % 3 ? [] : [CLERK], ...(i % 4 ? {} : { quest: 'test:docs' }), ...(i % 3 ? { h: textHash(`n${i}`) } : { lines: [] }) });
  entries.push({ id: 'j121', at: 121, kind: 'mine', place: null, with: [], ref: 'j3', h: textHash('mine') });
  const last = journalPage(entries, null, Infinity, 50);
  ok(last.pages === 3 && last.page === 2 && last.entries.length === 20 && last.entries[0].id === 'j101' && last.total === 120, 'the journal pages in order, the last page by default, the player\'s own notes not listed among the entries');
  const naboo = journalPage(entries, { world: 'naboo', who: CLERK }, 0, 50);
  ok(naboo.total === 20 && naboo.entries.every((e) => e.place?.world === 'naboo' && e.with.includes(CLERK)), 'filtered by where and by whom');
  ok(journalPage(entries, { quest: 'test:docs' }, 0, 500).total === 30, 'and by which job');
  const f = journalFacets(entries);
  ok(f.worlds.join() === 'tatooine,naboo' && f.who.join() === CLERK && f.quests.join() === 'test:docs', 'the filters offer every world, person and job the journal names, once each');
  ok(minesOn(entries, 'j3').length === 1 && minesOn(entries, 'j4').length === 0, 'the player\'s own notes are found on the entry they are written on');
  const h = hostOf(lib, emptyBook('c-mine'));
  keep(h.run(['note("TEST: noted")'], ctx()));
  const r = keep(h.mine('j1', '  my own words  ', ctx()));
  ok(!r.why && h.book.journal?.[1]?.kind === 'mine' && h.book.journal[1].ref === 'j1' && texts.get(h.book.journal[1].h!) === 'my own words', 'a note of the player\'s own is written on its entry, marked as theirs');
  ok(!!h.mine('j9', 'x', ctx()).why && !!h.mine('j2', 'on a note of my own', ctx()).why && !!h.mine('j1', '   ', ctx()).why, 'and refused on an entry that is not there, on a note of their own, or with nothing in it');
}

// ---- the words on the server's disk -----------------------------------------------------------------------------------
{
  const { Store, TEXTS_FILE } = await import('../../../server/store.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'swg-journal-store-'));
  try {
    const words = ['TEST: the first kept words', 'TEST: the second kept words, a little longer than the first'];
    const small = new Store({ dir: join(dir, 'small'), saveEvery: 0 });
    for (const w of words) small.change({ t: 'storyText', h: textHash(w), text: w });
    small.change({ t: 'storyText', h: textHash('TEST: other'), text: 'TEST: not what its hash says' });
    small.close();
    const inline = JSON.parse(readFileSync(join(dir, 'small', 'world.json'), 'utf8')) as { storyTexts?: Record<string, string>; storyTextsFile?: string };
    ok(Object.keys(inline.storyTexts ?? {}).length === 2 && !inline.storyTextsFile && !existsSync(join(dir, 'small', TEXTS_FILE)), 'a few words are kept in the world itself, by their hash, and words that are not what their hash says are not kept at all');
    const big = new Store({ dir: join(dir, 'big'), saveEvery: 0, textsApart: 40 });
    for (const w of words) big.change({ t: 'storyText', h: textHash(w), text: w });
    big.close();
    const apart = JSON.parse(readFileSync(join(dir, 'big', 'world.json'), 'utf8')) as { storyTexts?: Record<string, string>; storyTextsFile?: string };
    const file = JSON.parse(readFileSync(join(dir, 'big', TEXTS_FILE), 'utf8')) as Record<string, string>;
    ok(apart.storyTextsFile === TEXTS_FILE && apart.storyTexts === undefined && file[textHash(words[1])] === words[1], 'past `textsApart` they go to a file of their own beside the world, which names it');
    const back = new Store({ dir: join(dir, 'big'), saveEvery: 0, textsApart: 40 });
    ok(back.data.storyTexts[textHash(words[0])] === words[0] && Object.keys(back.data.storyTexts).length === 2, 'and are read back from it when the server starts again');
    back.close();
    // A snapshot written for something else entirely leaves the words' own file alone: it is written again only
    // once a word has been added since it last was.
    const placed: string[] = [];
    const again = new Store({ dir: join(dir, 'big'), saveEvery: 0, textsApart: 40, rename: (from: string, to: string) => void (placed.push(to), renameSync(from, to)) });
    again.change({ t: 'world', epoch: again.data.epoch });
    again.saveNow();
    ok(placed.some((p) => p.endsWith('world.json')) && !placed.some((p) => p.endsWith(TEXTS_FILE)), 'a snapshot with no new words writes the world and not the words\' file');
    const third = 'TEST: a third kept word, written after the others';
    again.change({ t: 'storyText', h: textHash(third), text: third });
    again.saveNow();
    const reread = JSON.parse(readFileSync(join(dir, 'big', TEXTS_FILE), 'utf8')) as Record<string, string>;
    ok(placed.filter((p) => p.endsWith(TEXTS_FILE)).length === 1 && reread[textHash(third)] === third && Object.keys(reread).length === 3, 'while one written after a word was added writes the words\' file again, with every word in it');
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- the server's transcript of one of the game's own people, in the words the browser read ------------------------------
{
  const { readCore3Story } = await import('../../../server/core3Story.mjs');
  const { Stories, STORY_TUNING, applyStory } = await import('../../../server/stories.mjs');
  const { cleanStoryWord } = await import('../../../src/story/storyWire.ts');
  const { wholeRef } = await import('../../../src/story/talkRules.ts');
  let clock = now;
  const s = new Stories({ tuning: { ...STORY_TUNING, talkRate: 1000, docRate: 1000 }, write: (rec: object) => void applyStory(s.data, rec), now: () => clock, read: () => ({ test: testFiles, own: null }), tests: true, core3: () => readCore3Story() });
  s.readSets();
  const c = { id: 1, character: 'c-herald', keep: 'server', asking: null, hello: { planet: 'corellia', zone: '' }, state: { p: [0, 0, 0] } };
  s.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
  const speaker = 'row:h98e10cfdf08';
  const say = (op: string, extra: Record<string, unknown> = {}) => {
    const r = s.hear(c, { t: 'story', do: 'talk', op, speaker, ...extra, at: {} }) as { tell: { msg: Record<string, unknown> }[] };
    clock += 1000;
    const w = r.tell.map((t) => cleanStoryWord(t.msg, 'down')).find((x) => x?.do === 'node');
    return w?.do === 'node' ? w : null;
  };
  const opened = say('open', { who: 'herald_corellia_karin' });
  const line = opened?.view?.lines[0];
  const ref = line ? wholeRef(line.text, opened!.view!.strings) : null;
  ok(typeof ref === 'string' && /^@/.test(ref), `a herald speaks in the client's own words, by reference (${ref})`);
  // The browser read the line out and closes the window: the words it read, and one for a line never said.
  const read = 'TEST: the words the browser read out for that line';
  const never = 'TEST: words for a line nobody said';
  s.hear(c, { t: 'story', do: 'talk', op: 'close', speaker, read: [{ ref, text: read }, { ref: '@nowhere/at_all:s_1', text: never }], name: 'TEST: as the band named them', at: {} });
  const book = s.bookOf('c-herald') as StoryBook;
  const t = book.journal?.find((e) => e.kind === 'talk');
  ok(!!t && t.lines?.[0]?.h === textHash(read) && s.textOf(textHash(read)) === read, 'the transcript keeps a client line in the words the browser read out, by their hash, and the server keeps those words');
  ok(s.textOf(textHash(never)) === undefined && !JSON.stringify(book.journal).includes(textHash(never)), 'and words handed up for a line that was never said are not kept at all');
  ok(t?.title === 'TEST: as the band named them' && t.with[0] === speaker, 'one of the game\'s own people, whom the story does not name, is titled as the band named them');
  const words = s.hear(c, { t: 'story', do: 'journal', from: 0, count: 5 }) as { tell: { msg: { texts?: Record<string, string> } }[] };
  ok(words.tell[0]?.msg.texts?.[textHash(read)] === read, 'and the journal\'s words come down again from the server');
  // A line that drops in the middle of a conversation: what was said is written all the same, its client lines as references.
  say('open', { who: 'herald_corellia_karin' });
  s.gone(c.id);
  const talks = (s.bookOf('c-herald') as StoryBook).journal!.filter((e) => e.kind === 'talk');
  ok(talks.length === 2 && (talks[1].lines?.length ?? 0) > 0 && talks[1].lines!.every((l) => typeof l.ref === 'string' && !l.h), 'a conversation cut off by the line closing is written as far as it went, its client lines kept as their references');
}

// ---- against the relay itself ---------------------------------------------------------------------------------------
if (typeof WebSocket === 'undefined') {
  console.log('skip the relay round trip: this node has no WebSocket of its own');
} else {
  const { randomBytes } = await import('node:crypto');
  const { playerIdFor, proofFor, verifierFor } = await import('../../../server/identity.mjs');
  const { bookText, chunkText } = await import('../../../src/story/storyWire.ts');
  const { RemoteHost } = await import('../../../src/story/remoteHost.ts');
  const { STORY_TUNE } = await import('../../../src/story/bookClient.ts');
  const dir = mkdtempSync(join(tmpdir(), 'swg-journal-'));
  const port = 18831;
  process.env.PORT = String(port);
  process.argv.push(`--data=${join(dir, 'world')}`, '--story-tests', `--story=${join(dir, 'none')}`);
  await import('../../../server/relay.mjs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  type Msg = Record<string, unknown>;
  const connect = async (name: string, character: string) => {
    const key = new Uint8Array(randomBytes(32));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: Msg[] = [];
    /** Whoever else hears this browser's words as they come: the browser's own half of a server's host, below. */
    const hooks: ((m: Msg) => void)[] = [];
    let nonce = '';
    await new Promise<void>((done, fail) => {
      ws.addEventListener('open', () => done());
      ws.addEventListener('error', () => fail(new Error('no relay')));
    });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String((ev as MessageEvent).data)) as Msg;
      if (m.t === 'hail') nonce = String(m.nonce ?? '');
      got.push(m);
      for (const h of hooks) h(m);
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    await wait(150);
    send({ t: 'claim', player: playerIdFor(key), key: verifierFor(key), proof: proofFor(verifierFor(key), nonce), character, name, counter: 1, about: { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' } });
    await wait(150);
    send({ t: 'hello', name, species: 'human_male', class: 'jedi', planet: 'tatooine', v: 5 });
    await wait(150);
    const story = (pick: (m: Msg) => boolean) => got.filter((m) => m.t === 'story' && pick(m));
    return { ws, got, send, story, hooks, last: (pick: (m: Msg) => boolean) => [...got].reverse().find((m) => m.t === 'story' && pick(m)) };
  };
  const browsers: { ws: WebSocket }[] = [];
  try {
    const a = await connect('Han', 'c-journal');
    browsers.push(a);
    a.send({ t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
    await wait(250);
    const hail = a.got.find((m) => m.t === 'hail') as { story?: { v: number } };
    ok((hail.story?.v ?? 0) >= 4, 'the relay\'s hail says it keeps the documents and the journal (story 4 or later)');
    a.send({ t: 'story', do: 'read', doc: 'test:doc/test-pages', at: {} });
    await wait(150);
    const refused = a.last((m) => m.do === 'doc') as Msg | undefined;
    ok(!!refused && refused.view === null && /never handed/.test(String(refused.why)), 'a document never handed over is refused, with why: the server opens only what is on the character\'s own list');
    a.send({ t: 'story', do: 'admin', op: 'grant', quest: 'test:docs', at: {} });
    await wait(150);
    const view = a.last((m) => m.do === 'view') as { view?: { docs?: { id: string }[] } } | undefined;
    ok(!!view?.view?.docs?.some((d) => d.id === 'test:doc/test-pages'), 'a document handed over is listed in the view by its title, never its words');
    a.send({ t: 'story', do: 'read', doc: 'test:doc/test-pages', at: {} });
    await wait(150);
    const opened = a.last((m) => m.do === 'doc') as { view?: { pages: unknown[] }; entry?: string; foot?: unknown } | undefined;
    const entries = a.story((m) => m.do === 'ch').flatMap((m) => m.ch as Msg[]).filter((c) => c.k === 'journal');
    ok(!!opened?.view && opened.view.pages.length === 2 && opened.entry === 'j1' && entries.length === 1, 'opened, the page comes down as it was read, frozen into the journal as its first entry, and the entry goes down in a batch');
    a.send({ t: 'story', do: 'read', doc: 'test:doc/test-pages', end: 1, at: {} });
    await wait(150);
    a.send({ t: 'story', do: 'journal', from: 0, count: 10 });
    await wait(150);
    const words = a.last((m) => m.do === 'journal') as { entries: JournalEntry[]; texts: Record<string, string> } | undefined;
    ok(!!words && words.entries.length === 2 && words.entries[1].kind === 'note' && Object.keys(words.texts).length === 2 && words.texts[words.entries[1].h!].startsWith('TEST: a note'), 'read to its end, the note is written too, and the words of a stretch of the journal come down by their hash');
    // A conversation, closed with the words the browser read out of the client's lines.
    a.send({ t: 'story', do: 'talk', op: 'open', speaker: CLERK, at: {} });
    await wait(150);
    a.send({ t: 'story', do: 'talk', op: 'pick', speaker: CLERK, reply: 'bye', at: {} });
    await wait(150);
    a.send({ t: 'story', do: 'talk', op: 'close', speaker: CLERK, read: [{ ref: '@nothing/here:x', text: 'not said' }], name: 'Somebody', at: {} });
    await wait(150);
    const talk = a.story((m) => m.do === 'ch').flatMap((m) => m.ch as Msg[]).find((c) => c.k === 'journal' && (c.entry as JournalEntry).kind === 'talk')?.entry as JournalEntry | undefined;
    ok(!!talk && talk.title === 'TEST: a clerk' && (talk.lines?.length ?? 0) >= 3, 'a conversation\'s window closing writes its transcript, the clerk as the player knew them then (not yet named)');
    a.send({ t: 'story', do: 'mine', ref: 'j1', text: 'TEST: my own words', at: {} });
    await wait(150);
    const mine = a.story((m) => m.do === 'ch').flatMap((m) => m.ch as Msg[]).find((c) => c.k === 'journal' && (c.entry as JournalEntry).kind === 'mine')?.entry as JournalEntry | undefined;
    ok(mine?.ref === 'j1', 'a note of the player\'s own is written on its entry');
    // The browser's own half of a server's host, the very RemoteHost the game runs, against the relay.
    {
      const store = new Map<string, string>();
      const keep: TextKeep = { get: (h) => store.get(h), put: (t) => void Object.keys(t).forEach((h) => store.set(h, t[h])) };
      const host = new RemoteHost({ send: (m) => a.send(m), line: () => ({ host: 'server', story: 4 }), char: () => 'c-journal', at: () => ({}), now: () => Date.now(), wall: () => Date.now(), note: () => {}, texts: keep });
      a.hooks.push((m) => {
        if (m.t === 'story') host.word(m);
      });
      const docs: DocWord[] = [];
      host.onDoc((w) => docs.push(w));
      const answered: string[][] = [];
      host.onJournal((_from, hs) => answered.push([...hs]));
      const ticking = setInterval(() => host.tick(), 50);
      try {
        // The call the memo led to, handed over and not yet heard.
        ok(host.read('test:doc/test-call').ok, 'a page is asked for');
        await wait(400);
        const call = docs.at(-1);
        ok(!!call?.view && call.from === CLERK && !call.end && store.get(textHash(JSON.stringify(call.view))) === JSON.stringify(call.view), 'the server\'s answer reaches the window through the browser\'s own half, a call with its caller, and its words are kept here by their hash');
        host.read('test:doc/test-call', { end: true });
        await wait(400);
        ok(docs.at(-1)?.doc === 'test:doc/test-call' && docs.at(-1)?.end === true, 'and the answer to hearing it to its end says so, so the band never plays it again');
        const note = 'TEST: a note written from the browser\'s own half';
        ok(host.mine('j1', `  ${note}  `).ok && store.get(textHash(note)) === note, 'a note of the player\'s own is kept here the moment it goes up');
        await wait(400);
        const written = a.story((m) => m.do === 'ch').flatMap((m) => m.ch as Msg[]).map((c) => c.entry as JournalEntry | undefined).filter((e) => e?.kind === 'mine').at(-1);
        ok(written?.h === textHash(note), 'and the server writes it under the very hash its words were kept by here');
        // Words lost (a new machine, a cleared store): asked for a stretch, put into the store as they come.
        store.clear();
        host.askJournal(0, 20);
        await wait(400);
        const j = a.last((m) => m.do === 'journal') as { entries: JournalEntry[] } | undefined;
        const want = journalHashes(j?.entries);
        ok(want.length >= 4 && want.every((h) => store.has(h)) && store.get(textHash(note)) === note, `the words of a stretch of the journal come down into the store handed in (${want.length})`);
        ok(answered.length === 1 && want.every((h) => answered[0].includes(h)), 'and the window is told which words that answer settled');
      } finally {
        clearInterval(ticking);
      }
    }
    // A book played alone, with an entry whose words the server has not got: asked for, handed up, kept.
    const b = await connect('Leia', 'c-alone');
    browsers.push(b);
    const words2 = 'TEST: words only this browser kept';
    const alone = { ...emptyBook('c-alone'), rev: 3, local: 3, journal: [{ id: 'j1', at: now, kind: 'note', place: null, with: [], h: textHash(words2) }] };
    b.send({ t: 'story', do: 'sync', has: 1, base: 0, local: 3, known: 0 });
    await wait(200);
    ok(!!b.last((m) => m.do === 'want'), 'the server, holding no book of this character, asks for the browser\'s');
    const parts = chunkText(bookText(alone), 24000);
    for (let n = 0; n < parts.length; n++) b.send({ t: 'story', do: 'offer', id: 1, n, of: parts.length, part: parts[n], known: 0 });
    await wait(250);
    const need = b.last((m) => m.do === 'need') as { hashes?: string[] } | undefined;
    ok(need?.hashes?.length === 1 && need.hashes[0] === textHash(words2), 'having taken it, the server asks for the words of its journal it has not got');
    const pieces = chunkText(bookText({ [textHash(words2)]: words2, [textHash('forged')]: 'not what its hash says', [textHash('TEST: unasked')]: 'TEST: unasked' }), 80);
    ok(pieces.length > 1, `the words go up in ${pieces.length} pieces`);
    for (let n = 0; n < pieces.length; n++) {
      b.send({ t: 'story', do: 'texts', id: 1, n, of: pieces.length, part: pieces[n] });
      await wait(250);
    }
    await wait(200);
    b.send({ t: 'story', do: 'journal', from: 0, count: 1 });
    await wait(150);
    const back = b.last((m) => m.do === 'journal') as { texts: Record<string, string> } | undefined;
    ok(back?.texts[textHash(words2)] === words2, 'the words come up in pieces, are kept, and come down again');
    const status = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { stories: { journal: { entries: number; texts: number }; stats: { textsTaken: number; transcripts: number } } };
    ok(status.stories.journal.entries >= 5 && status.stories.stats.textsTaken === 1 && status.stories.stats.transcripts === 1, `the status page counts the journals, their words, a transcript written, and only the one word that was asked for and is what its hash says (${JSON.stringify(status.stories.journal)})`);
    const disk = ['world.json', 'world.log'].map((f) => (existsSync(join(dir, 'world', f)) ? readFileSync(join(dir, 'world', f), 'utf8') : '')).join('\n');
    ok(disk.includes(`"h":"${textHash(words2)}"`) && disk.includes('"t":"storyText"') && !disk.includes('TEST: unasked') && !disk.includes('not said'), 'the words kept are written down beside the books, once each by their hash, and nothing unasked or never said is');
    // The same through the browser's own half: asked for words (`need`), it sends them up in pieces on its own
    // clock (`tick`), each a little apart, and the server keeps them.
    {
      const chunkWas = STORY_TUNE.offerChunk;
      const gapWas = STORY_TUNE.chunkGap;
      STORY_TUNE.offerChunk = 1000;
      STORY_TUNE.chunkGap = 250;
      const d = await connect('Biggs', 'c-alone2');
      browsers.push(d);
      const long = `TEST: ${'words only this browser kept, and long enough to go up in pieces. '.repeat(40)}`;
      const store = new Map<string, string>([[textHash(long), long]]);
      const keep: TextKeep = { get: (h) => store.get(h), put: (t) => void Object.keys(t).forEach((h) => store.set(h, t[h])) };
      const host = new RemoteHost({ send: (m) => d.send(m), line: () => ({ host: 'server', story: 4 }), char: () => 'c-alone2', at: () => ({}), now: () => Date.now(), wall: () => Date.now(), note: () => {}, texts: keep });
      d.hooks.push((m) => {
        if (m.t === 'story') host.word(m);
      });
      const ticking = setInterval(() => host.tick(), 50);
      try {
        const played = { ...emptyBook('c-alone2'), rev: 3, local: 3, journal: [{ id: 'j1', at: now, kind: 'note', place: null, with: [], h: textHash(long) }] };
        d.send({ t: 'story', do: 'sync', has: 1, base: 0, local: 3, known: 0 });
        await wait(200);
        const book = chunkText(bookText(played), 24000);
        for (let n = 0; n < book.length; n++) d.send({ t: 'story', do: 'offer', id: 1, n, of: book.length, part: book[n], known: 0 });
        await wait(2000);
        ok(host.stats.needs === 1 && host.stats.pieces > 1, `asked for the words of a book played alone, the browser's own half sends them up in ${host.stats.pieces} pieces`);
        d.send({ t: 'story', do: 'journal', from: 0, count: 1 });
        await wait(250);
        const back2 = d.last((m) => m.do === 'journal') as { texts: Record<string, string> } | undefined;
        ok(back2?.texts[textHash(long)] === long, 'and the server kept them, whole, and hands them down again');
      } finally {
        clearInterval(ticking);
        STORY_TUNE.offerChunk = chunkWas;
        STORY_TUNE.chunkGap = gapWas;
      }
    }
  } finally {
    for (const b of browsers) b.ws.close();
    await wait(100);
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${checks} checks passed`);
process.exit(0);
