// The ISB's file on a character (`src/story/file.ts`, written by the `file()` action in `quests.ts`, shown by
// `view.ts`, read by conditions and by `reactions.ts`, and held by the server in `server/stories.mjs`).
//
// What is pinned:
//
//   - the set's own `file.jsonc` is read, its levels put in order, and every mistake in it named;
//   - an entry is written with its kind, weight, page, tags and where in the story it came from, and with when
//     the player may see it: the set's reveal span, or `FILE_TUNE.revealGameHours` with none;
//   - the level the exposure reaches acts at once -- a condition reads it and the tags, and a level that says so
//     makes a track's people greet the character coldly -- while the entry itself is not shown until its time
//     has come or its page has been handed over;
//   - nothing about the file is said on the message line and nothing goes in the journal;
//   - it only ever grows: no change takes an entry away or writes one out of its place, a weight is never below
//     nought, and the level never falls, even when the owner raises the thresholds after it was reached;
//   - one timeline: a book handed up within one timeline whose file is shorter or other is refused by the
//     server, which keeps its own, while one that only added to it is taken;
//   - the checker refuses a `file()` with a weight below nought, a kind the file has not got, two pages, a tag
//     that is not a word, or a page that is not in any set (rule 11).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BOOK_LIMITS, applyChanges, cleanBook, cleanChange, emptyBook, shrinksWithin, type StoryBook } from '../../../src/story/book.ts';
import { checkSet } from '../../../src/story/check.ts';
import { GAME_HOUR_MS } from '../../../src/story/clock.ts';
import { parseCondition } from '../../../src/story/expr.ts';
import { FILE_TUNE, fileDefOf, fileOf, fileShrinks, levelAt, reactsAt, revealAtOf, revealed, type FileDefIssue, type FileEntry } from '../../../src/story/file.ts';
import { HostCore } from '../../../src/story/hostCore.ts';
import { noteWords } from '../../../src/story/notes.ts';
import { evalCond } from '../../../src/story/quests.ts';
import { reactionFor } from '../../../src/story/reactions.ts';
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
const def = lib.file?.isb ?? null;
let now = 1_900_000_000_000;
const ctx = (o: Record<string, unknown> = {}) => ({ now, world: 'tatooine', here: [3482, -4690] as [number, number], room: null, species: 'human_male', name: 'Han', credits: 100, ...o });
const cond = (src: string) => {
  const r = parseCondition(src);
  if ('error' in r) throw new Error(`${src}: ${r.error.message}`);
  return r.cond;
};
const holds = (book: StoryBook, src: string) => evalCond(cond(src), book, { ...ctx(), char: book.char, payer: 'browser' });

// ---- the set's own file.jsonc ----------------------------------------------------------------------------------
{
  ok(!!def && def.levels.map((l) => l.at).join() === '10,25,50' && def.levels.every((l) => /^TEST LEVEL \d$/.test(l.name)) && def.reveal?.ms === 6 * GAME_HOUR_MS, 'the test set\'s file has three levels at the test thresholds, named TEST, and an entry waits six game hours');
  ok(def!.levels[0].reacts.empire === 'mean' && !def!.levels[1].reacts.empire, 'its first level makes the Empire\'s people cold, the others say nothing of it');
  const issues: FileDefIssue[] = [];
  const read = fileDefOf({ isb: { levels: [{ at: 50, name: 'TEST C' }, { at: 5, name: 'TEST A', reacts: { empire: 'icy', guild: 'mean' } }, { at: -1, name: 'TEST B' }, { name: 'TEST D' }], reveal: { minutes: 3 }, revealBy: { rumour: { seconds: 1 }, intercept: { seconds: 30 } }, colour: 'red' }, cia: {} }, issues);
  const says = (re: RegExp, level: 'error' | 'warning' = 'error') => issues.some((i) => i.level === level && re.test(i.message));
  ok(read?.isb?.levels.map((l) => l.name).join() === 'TEST A,TEST C', 'levels are put in order of the exposure they are reached at, and one that is not a level is left out');
  ok(says(/cia is not an agency/) && says(/a level is \{ "at": exposure of nought or more/) && says(/reacts names a track/) && says(/rumour is not a kind of entry/) && says(/minutes is not part of a span/) && says(/colour is not part of a file/, 'warning'), `and every mistake in it is named (${issues.length})`);
  ok(read?.isb?.revealBy.intercept?.ms === 30000 && read.isb.reveal === null, 'a span for one kind of entry stands beside the span for every kind');
  ok(fileDefOf([], []) === null, 'a file.jsonc that is not one object is not read');
  const bad = loadSet([...testFiles.filter((f: { path: string }) => f.path !== 'file.jsonc'), { path: 'file.jsonc', text: '{ "isb": { "levels": [{ "at": "ten", "name": "TEST" }] } }' }], { test: true });
  ok(bad.errors.some((e) => e.file === 'file.jsonc' && /a level is/.test(e.message)), 'and a set whose file.jsonc is wrong says so, naming the file');
}

// ---- when an entry may be seen --------------------------------------------------------------------------------
{
  ok(revealAtOf(def, 'incident', now) === now + 6 * GAME_HOUR_MS, 'an entry is seen six game hours after it is written, as the set says');
  ok(revealAtOf(null, 'incident', now) === now + Math.round(FILE_TUNE.revealGameHours * GAME_HOUR_MS), 'and with no span of the set\'s own, after FILE_TUNE.revealGameHours');
  const e: FileEntry = { id: 'f1', at: now, kind: 'incident', weight: 1, mult: 1, tags: [], source: {}, revealAt: now + 1000, doc: 'test:doc/test-file-page' };
  ok(!revealed(e, now, () => false) && revealed(e, now + 1000, () => false) && revealed(e, now, (d) => d === 'test:doc/test-file-page'), 'it is seen once its time comes, or at once when its page has been handed over');
  ok(levelAt(def, 9.99) === 0 && levelAt(def, 10) === 1 && levelAt(def, 49) === 2 && levelAt(def, 1e6) === 3, 'the level is how many thresholds the exposure has reached');
  ok(reactsAt(def, 0).empire === undefined && reactsAt(def, 1).empire === 'mean' && reactsAt(def, 3).empire === 'mean', 'and how coldly a track greets is the coldest any level reached says');
}

// ---- before the player knows why -----------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-isb'), lib, payer: 'browser' });
  const r = h.grant('test:file', ctx());
  const rec = fileOf(h.book, 'isb')!;
  const e = rec.entries[0];
  ok(rec.entries.length === 1 && e.id === 'f1' && e.kind === 'incident' && e.weight === 12 && e.doc === 'test:doc/test-file-page' && e.tags.join() === 'test-tag' && e.source.quest === 'test:file' && e.source.step === 'mark' && e.revealAt === now + 6 * GAME_HOUR_MS, 'the job begins and an entry is written: its kind, weight, page, tags, where in the story it came from and when it may be seen');
  ok(rec.exposure === 12 && rec.level === 1, 'its weight is the exposure, which reaches the first level at once');
  ok(holds(h.book, 'fileLevel(isb) >= 1') && holds(h.book, 'fileHas(isb, test-tag)') && !holds(h.book, 'fileLevel(isb) >= 2') && !holds(h.book, 'fileHas(isb, other-tag)'), 'a condition reads the level and the tags at once');
  const view = h.view(ctx());
  ok(view.file?.entries.length === 0 && view.file.react?.empire === 'mean', 'the player sees no entry yet, while the view already carries how coldly the Empire\'s people greet them');
  const book = h.book;
  const imperial = reactionFor({ diction: 'military', faction: 'imperial' }, book, 'row:x', now, undefined, view.file?.react);
  const rebel = reactionFor({ diction: 'military', faction: 'rebel' }, book, 'row:x', now, undefined, view.file?.react);
  ok(imperial?.warmth === 'mean' && /hi_mean_/.test(imperial.hi) && rebel?.warmth === 'mid', 'so an imperial greets them coldly before they can read why, and a rebel as before');
  const said = r.notes.map((n) => noteWords(n, lib, { text: (t) => (typeof t === 'string' ? t : t.en) }) ?? '').join(' | ');
  // The job's own title and objective are said as any job's are; nothing of the entry is.
  ok(!/incident|test-tag|TEST LEVEL|exposure|\bisb\b|"k":"file/i.test(JSON.stringify(r.notes)) && !/incident|test-tag|TEST LEVEL|exposure|\bisb\b|intercept/i.test(said), `nothing about the entry is said on the message line (${said})`);
  ok(!(h.book.journal?.length), 'and nothing of it goes in the journal');
  now += 6 * GAME_HOUR_MS;
  const later = h.view(ctx());
  ok(later.file?.entries.length === 1 && later.file.entries[0].docTitle === 'TEST INTERCEPT 0001' && !('weight' in later.file.entries[0]), 'six game hours on the entry is seen, with its page\'s title and never its weight');
  // An entry whose page the story hands over is seen at once.
  h.sweep(ctx());
  h.grant('test:file', ctx());
  ok(fileOf(h.book, 'isb')?.entries.length === 2 && h.view(ctx()).file?.entries.length === 1, 'a second entry, written now, waits its own time');
  const hand = new HostCore({ book: emptyBook('c-hand'), lib, payer: 'browser' });
  hand.grant('test:file', ctx());
  hand.run(['doc(doc/test-file-page)'], ctx());
  ok(hand.view(ctx()).file?.entries.length === 1, 'while one whose page the story has handed over is seen at once');
  const read = hand.read('test:doc/test-file-page', {}, ctx(), () => undefined);
  ok(!!read.word.view && read.word.view.title === 'TEST INTERCEPT 0001', 'and the page itself is read like any document');
}
{
  // The page of an entry is not to be read before the player may see the entry: the host refuses it, writes
  // nothing and hands nothing over, until its time has come.
  const t0 = now;
  const h = new HostCore({ book: emptyBook('c-early'), lib, payer: 'browser' });
  h.grant('test:file', ctx({ now: t0 }));
  const early = h.read('test:doc/test-file-page', {}, ctx({ now: t0 + 1000 }), () => undefined);
  ok(!early.word.view && /never handed/.test(early.word.why ?? '') && !h.book.docs?.['test:doc/test-file-page'] && !(h.book.journal?.length), 'the page of an entry not yet seen is refused, with why, and nothing is handed over or written');
  const almost = h.read('test:doc/test-file-page', {}, ctx({ now: t0 + 6 * GAME_HOUR_MS - 1000 }), () => undefined);
  ok(!almost.word.view, 'nor a moment before its time');
  const due = h.read('test:doc/test-file-page', {}, ctx({ now: t0 + 6 * GAME_HOUR_MS + 1000 }), () => undefined);
  ok(!!due.word.view && due.word.view.title === 'TEST INTERCEPT 0001' && h.book.journal?.[0]?.doc === 'test:doc/test-file-page', 'once its time has come it opens, and is written into the journal as it is first read');
}

// ---- it only ever grows ---------------------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-grow'), lib, payer: 'browser' });
  // The job is repeatable: each time it is done it may be granted again, and each time it writes an entry.
  const again = () => {
    now += 6000;
    h.sweep(ctx());
    const r = h.grant('test:file', ctx());
    assert.ok(!r.why, r.why ?? '');
  };
  h.grant('test:file', ctx());
  again();
  ok(fileOf(h.book, 'isb')?.exposure === 24 && fileOf(h.book, 'isb')?.level === 1, 'a second entry adds its weight, still under the second level');
  again();
  ok(fileOf(h.book, 'isb')?.level === 2 && fileOf(h.book, 'isb')?.entries.map((e) => e.id).join() === 'f1,f2,f3', 'a third reaches it, the entries numbered in order');
  // The owner raises every threshold: the level reached stays.
  const raised = loadSet(testFiles.map((f: { path: string; text: string }) => (f.path === 'file.jsonc' ? { ...f, text: '{ "isb": { "levels": [{ "at": 1000, "name": "TEST HIGH" }, { "at": 2000, "name": "TEST HIGHER" }] } }' } : f)), { test: true }).set;
  h.setLibrary(raised, ctx());
  again();
  ok(fileOf(h.book, 'isb')?.level === 2 && fileOf(h.book, 'isb')?.exposure === 48, 'the owner raises the thresholds after a level was reached, and the next entry leaves the level where it was');
  const b = h.book;
  const entry = (id: string, weight: number): FileEntry => ({ id, at: now, kind: 'note', weight, mult: 1, tags: [], source: {}, revealAt: now });
  ok(applyChanges(b, [{ k: 'fileAdd', agency: 'isb', entry: entry('f9', 1), level: 2 }]).refused.length === 1, 'an entry out of its place is refused');
  ok(cleanChange({ k: 'fileAdd', agency: 'isb', entry: entry('f5', -1), level: 2 }) === null && cleanChange({ k: 'fileGone', agency: 'isb', id: 'f1' }) === null && cleanChange({ k: 'fileAdd', agency: 'cia', entry: entry('f5', 1), level: 2 }) === null, 'and no change writes a weight below nought, takes an entry away, or keeps a file for an agency there is none of');
  applyChanges(b, [{ k: 'fileAdd', agency: 'isb', entry: entry('f5', 1), level: 0 }]);
  ok(fileOf(b, 'isb')?.level === 2 && fileOf(b, 'isb')?.exposure === 49, 'an entry that says a lower level does not lower it');
  ok(applyChanges(emptyBook('c-cap'), [{ k: 'fileAdd', agency: 'isb', entry: entry('f1', 1), level: 0 }, { k: 'fileAdd', agency: 'isb', entry: entry('f2', 1), level: 0 }], { ...BOOK_LIMITS, file: 1 }).refused[0]?.why === 'a file holds 1 entries', 'and past its cap nothing more is written');
  const back = cleanBook(JSON.parse(JSON.stringify({ ...b, files: { isb: { ...fileOf(b, 'isb'), exposure: 3 } } })));
  ok(fileOf(back, 'isb')?.exposure === 49, 'a file read back never carries less exposure than its entries add to');
}

// ---- one timeline ---------------------------------------------------------------------------------------------
{
  const e = (id: string, weight = 5): FileEntry => ({ id, at: 1, kind: 'note', weight, mult: 1, tags: [], source: {}, revealAt: 1 });
  const rec = (entries: FileEntry[], exposure?: number) => ({ isb: { entries, exposure: exposure ?? entries.reduce((s, x) => s + x.weight, 0), level: 0 } });
  const server = { ...emptyBook('c-t'), rev: 7, files: rec([e('f1'), e('f2')]) } as StoryBook;
  const at = (files: StoryBook['files'], base = 7) => ({ ...emptyBook('c-t'), rev: 9, base, local: 2, files }) as StoryBook;
  ok(!!fileShrinks(at(rec([e('f1')])), server) && !!fileShrinks(at(rec([e('f1'), e('f2', 6)])), server) && !!fileShrinks(at(rec([e('f1'), e('f2')], 9)), server), 'a file shorter, other, or carrying less exposure than the one it would replace loses something');
  ok(!!shrinksWithin(at(rec([e('f1')])), server) && shrinksWithin(at(rec([e('f1'), e('f2'), e('f3')])), server) === null, 'within one timeline that is refused, and one that only added to it is not');
  ok(shrinksWithin(at(rec([]), 4), server) === null && shrinksWithin(at(undefined, 0), server) === null, 'while a book of another timeline is never compared entry by entry');
}

// ---- the server keeps its own ------------------------------------------------------------------------------------
{
  const { Stories, STORY_TUNING, applyStory } = await import('../../../server/stories.mjs');
  const { bookText, chunkText } = await import('../../../src/story/storyWire.ts');
  const s = new Stories({ tuning: { ...STORY_TUNING, syncRate: 100, docRate: 100 }, write: (r: object) => void applyStory(s.data, r), now: () => now, read: () => ({ test: testFiles, own: null }), admin: () => true, tests: true });
  s.readSets();
  const c = { id: 1, character: 'c-server', keep: 'browser', asking: null, hello: { planet: 'tatooine', zone: '' }, state: null };
  s.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
  s.hear(c, { t: 'story', do: 'admin', op: 'grant', quest: 'test:file', at: {} });
  const mine = s.bookOf('c-server') as StoryBook;
  ok(fileOf(mine, 'isb')?.entries.length === 1, 'the server writes the entry into the book it keeps');
  // The server opens the entry's page only once the player may see the entry: asked for it now, it refuses.
  const asked = s.hear(c, { t: 'story', do: 'read', doc: 'test:doc/test-file-page', at: {} }) as { tell: { msg: Record<string, unknown> }[] };
  const word = asked.tell.find((t) => t.msg.do === 'doc')?.msg;
  ok(!!word && word.view === null && /never handed/.test(String(word.why)) && !(s.bookOf('c-server') as StoryBook).docs?.['test:doc/test-file-page'], 'asked for the page of an entry the player may not see yet, the server refuses it and hands nothing over');
  const offer = (book: unknown) => {
    s.hear(c, { t: 'story', do: 'sync', has: 1, base: (book as StoryBook).base, local: 1, known: 1 });
    const parts = chunkText(bookText(book), 24000);
    let last: { ok: boolean; why?: string; tell: { msg: Record<string, unknown> }[] } | null = null;
    for (let n = 0; n < parts.length; n++) last = s.hear(c, { t: 'story', do: 'offer', id: 1, n, of: parts.length, part: parts[n], known: 1 });
    return last!;
  };
  const copy = JSON.parse(JSON.stringify(mine)) as StoryBook;
  const lost = { ...copy, rev: copy.rev + 1, base: copy.rev, local: 1, files: { isb: { entries: [], exposure: 0, level: 0 } } };
  const refused = offer(lost);
  ok(!refused.ok && /file/.test(refused.why ?? '') && fileOf(s.bookOf('c-server'), 'isb')?.entries.length === 1 && s.stats.shrinks === 1, `a copy handed up within one timeline with its file emptied is refused, and the server's stands (${refused.why})`);
  ok(refused.tell.some((t) => t.msg.do === 'no') && refused.tell.some((t) => t.msg.do === 'book'), 'the browser is told why, and handed the server\'s book so the two agree');
  const now2 = JSON.parse(JSON.stringify(s.bookOf('c-server'))) as StoryBook;
  const isb = fileOf(now2, 'isb')!;
  const grown = { ...now2, rev: now2.rev + 1, base: now2.rev, local: 1, files: { isb: { entries: [...isb.entries, { ...isb.entries[0], id: 'f2' }], exposure: isb.exposure * 2, level: 1 } } };
  const taken = offer(grown);
  ok(taken.ok !== false && fileOf(s.bookOf('c-server'), 'isb')?.entries.length === 2 && s.stats.shrinks === 1, 'one that only added to it is taken');
}

// ---- the checker --------------------------------------------------------------------------------------------------
{
  const head = { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' };
  const q = (action: string) => ({ path: 'quests/q.jsonc', text: JSON.stringify({ id: 'q', title: 'TEST', givers: [{ kind: 'debug' }], start: ['a'], steps: { a: { type: 'nothing', do: { start: [action] }, ends: 'done' } } }) });
  const errs = (action: string) => checkSet(loadSet([head, q(action)])).errors.map((e) => `${e.rule ?? ''} ${e.message}`).join(' | ');
  ok(/never shrinks/.test(errs('file(isb, incident, -1)')), 'the checker refuses a weight below nought: a file never shrinks');
  ok(/kind is one of/.test(errs('file(isb, rumour, 1)')), 'a kind the file has not got');
  ok(/one page at most/.test(errs('file(isb, incident, 1, doc/a, doc/b)')), 'two pages for one entry');
  ok(/not a tag/.test(errs('file(isb, incident, 1, "two words")')), 'a tag that is not a plain word');
  ok(/^11 .*own:doc\/nowhere/m.test(errs('file(isb, incident, 1, doc/nowhere)').split(' | ').join('\n')), 'and a page that is in no set (rule 11)');
  ok(!errs('file(isb, incident, 1, doc/x, a-tag)').includes('never') && checkSet(loadSet(testFiles, { test: true })).errors.length === 0, 'while the test set\'s own entry checks clean');
}

console.log(`\n${checks} checks passed`);
