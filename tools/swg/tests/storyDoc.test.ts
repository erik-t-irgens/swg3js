// A story's documents (`src/story/doc.ts`, `src/story/docRules.ts`): the text format read into blocks, its
// mistakes refused at their own lines, a page read for one reader at one moment, and the version read frozen.
//
// What is pinned:
//
//   - the header, the paragraphs (lines run on with a space), fields, a table, stamps, a signature, a slot and a
//     page turn read as written, and a redaction inside a paragraph or across lines;
//   - a variant's fills, its condition read as any condition is, and its ids prefixed;
//   - a slot a variant fills that the body has not got (rule 11), a variant called the true one (rule 10), a mark
//     the format does not have and a table never closed are refused at their own lines;
//   - read, the first variant whose condition holds is the one read, a redaction is a bar with none of its
//     words under it unless its condition holds, and every token is filled (the calendar's date, the player, the
//     species, a person as the reader knows them);
//   - a document is opened only when it was handed over; the first reading writes it into the journal and freezes
//     it, and every later reading is that page, after the owner rewrites the file and after the condition that
//     chose its version has changed;
//   - two characters who chose differently hold two different letters, neither marked the true one, and
//     `witnessed(doc[, variant])` reads which;
//   - a card's foot offers Accept and Decline while its job is on offer, a choice's foot its options; a page
//     whose foot still asks is not put away by being read to its end, and the choice made at a foot, or the card
//     taken or turned down, puts it away (a card offered again is a new handing);
//   - lost words cost only what is shown: a page whose frozen words are gone says so and is still read to its
//     end, and one the journal is too full to freeze is shown unfrozen and read on;
//   - a page off the wire is rebuilt, and the committed test set's documents are all labelled TEST.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BOOK_LIMITS, emptyBook, type StoryBook } from '../../../src/story/book.ts';
import { cleanDocView, dateText, docLinesOf, docWords, type DocBlock, type DocView } from '../../../src/story/doc.ts';
import { docsToRead, footOf, isUnkeptView, renderDoc } from '../../../src/story/docRules.ts';
import { HostCore } from '../../../src/story/hostCore.ts';
import { evalCond } from '../../../src/story/quests.ts';
import { checkSet } from '../../../src/story/check.ts';
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
const head = { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' };
const set = (...files: { path: string; text: string }[]) => loadSet([head, ...files]);

// ---- reading the format ------------------------------------------------------------------------------------
{
  const text = [
    '// a comment line',
    'kind: memo',
    'id: one',
    'title: TEST ONE #4471',
    'issuer: TEST ISSUER',
    'client: civic',
    '',
    'TEST: the first line',
    'runs on to the second.',
    '',
    '[field] TEST LABEL: TEST VALUE',
    '[table]',
    '| A | B |',
    '| 1 | 2 |',
    '[/table]',
    '[stamp] TEST STAMP',
    'TEST: open [redact when flag(own.seen)] HIDDEN WORDS [/redact] closed.',
    '[redact when flag(own.seen)] A REDACTION',
    'ACROSS LINES [/redact]',
    '[slot sig]',
    '[page]',
    'TEST: page two.',
    '[sign] TEST SIGNED',
    '--- variant a when flag(own.pick) == "a"',
    '[slot sig] [sign] TEST A',
    '--- variant b',
    '[slot sig] TEST B',
  ].join('\n');
  const r = set({ path: 'docs/one.doc.txt', text });
  const d = r.set.docs?.['own:doc/one'];
  ok(r.errors.length === 0 && !!d, `a document reads (${r.errors.map((e) => `${e.line}: ${e.message}`).join('; ')})`);
  ok(d!.kind === 'memo' && d!.title === 'TEST ONE #4471' && d!.issuer === 'TEST ISSUER' && d!.client === 'civic', 'its header: kind, title (a # in it kept, since only a // line is a comment), issuer and client');
  const b = d!.body;
  ok(b[0].t === 'p' && (b[0] as { s: unknown[] }).s.join('') === 'TEST: the first line runs on to the second.', 'a paragraph\'s lines run on with a space between');
  ok(b[1].t === 'field' && (b[1] as { label: string }).label === 'TEST LABEL' && (b[1] as { value: string[] }).value.join('') === 'TEST VALUE', 'a field is its label and its value');
  ok(b[2].t === 'table' && JSON.stringify((b[2] as { rows: string[][] }).rows) === '[["A","B"],["1","2"]]' && b[3].t === 'stamp', 'a table is its rows, and a stamp its words');
  const p = b[4] as { t: 'p'; s: (string | { redact: unknown; text: string })[] };
  ok(p.t === 'p' && typeof p.s[1] === 'object' && (p.s[1] as { text: string }).text === 'HIDDEN WORDS' && JSON.stringify((p.s[1] as { redact: unknown }).redact) === '{"flag":"own.seen","set":true}', 'a redaction inside a paragraph keeps its words and the condition that lifts it, its ids prefixed');
  ok(p.s.some((x) => typeof x === 'object' && x.text === 'A REDACTION ACROSS LINES'), 'and one across lines gathers its words, in the paragraph it runs on in');
  ok(b.some((x) => x.t === 'slot') && b.some((x) => x.t === 'page') && d!.slots.join() === 'sig', 'a slot and a page turn stand where they are written');
  ok(d!.variants.length === 2 && d!.variants[0].id === 'a' && JSON.stringify(d!.variants[0].when) === '{"flag":"own.pick","eq":"a"}' && d!.variants[1].when === null && d!.variants[0].fills.sig[0].t === 'sign', 'variants fill their slots, a condition read as any condition is, and one with none always holds');
  ok(/^[0-9a-f]{16}$/.test(d!.hash), 'a document carries the hash of its definition');
}
{
  const bad = set(
    { path: 'docs/two.doc.txt', text: 'kind: memo\nid: two\ntitle: TEST\n\nTEST\n[slot here]\n[wobble] TEST\n[table]\n| a |\n--- variant true when flag(x)\n[slot elsewhere] TEST\n' },
    { path: 'docs/three.doc.txt', text: 'kind: scroll\nid: three\n\nTEST\n' },
  );
  const at = (re: RegExp) => bad.errors.find((e) => re.test(e.message));
  ok(at(/is not a mark a document knows/)?.line === 7, 'a mark the format does not have is refused at its own line');
  ok(at(/never closed with \[\/table\]/)?.line === 8, 'a table never closed is refused where it opened');
  ok(at(/canonical or true/)?.rule === 10 && at(/canonical or true/)?.line === 10, 'a variant called the true one is refused, as rule 10');
  ok(at(/fills elsewhere, which is not a slot/)?.rule === 11, 'a variant filling a slot the body has not got is refused, as rule 11');
  ok(bad.warnings.some((w) => w.rule === 11 && /no variant fills the slot here/.test(w.message)), 'and a slot no variant fills is warned about');
  ok(!!at(/kind is one of/) && !!at(/needs a title/) && !bad.set.docs?.['own:doc/three'], 'a document with no kind it may be or no title is not read');
}

// ---- reading a page ------------------------------------------------------------------------------------------
{
  const r = set({ path: 'docs/four.doc.txt', text: 'kind: letter\nid: four\ntitle: TEST TO {player}\n\nTEST: for {player} the {player.species}, from {npc:cast/x}, on {date}.\n\nTEST: [redact when flag(own.k)] SECRET WORDS [/redact]\n[slot s]\n--- variant a when flag(own.v) == 1\n[slot s] TEST A\n--- variant b\n[slot s] TEST B\n' }, { path: 'calendar.jsonc', text: '{ "epoch": 0, "day": "real", "yearDays": 10, "firstYear": 35, "format": "day {day} of {year}" }' });
  const def = r.set.docs!['own:doc/four'];
  const read = (flags: Record<string, number>): DocView =>
    renderDoc(def, { holds: (c) => (c && 'flag' in c ? (c.eq !== undefined ? flags[c.flag as string] === c.eq : flags[c.flag as string] !== undefined) : true), player: 'Han', species: 'Human', npc: (who) => (who === 'own:cast/x' ? 'the clerk' : 'someone'), date: dateText(r.set.calendar, 86400000 * 23) });
  const plain = read({});
  const all = JSON.stringify(plain);
  ok(plain.variant === 'b' && all.includes('TEST B') && !all.includes('TEST A'), 'with the first variant\'s condition failing, the first that holds is read: here the one with none');
  ok(!all.includes('SECRET') && (plain.pages[0][1] as { s: unknown[] }).s.some((x) => typeof x === 'object' && (x as { bar: number }).bar === 'SECRET WORDS'.length), 'a redaction is a bar as long as its words, and not one of them is in the page');
  ok(all.includes('for Han the Human, from the clerk, on day 4 of 37.') && plain.title === 'TEST TO Han', 'every token is filled: the player, the species, a person as the reader knows them, and the calendar\'s date');
  const lifted = read({ 'own.v': 1, 'own.k': 1 });
  ok(lifted.variant === 'a' && JSON.stringify(lifted).includes('SECRET WORDS'), 'and the variant and the redaction read by the reader\'s own book');
  ok(docLinesOf(plain)[0].startsWith('TEST: for Han') && docLinesOf(plain).length === 3, 'a page read as lines, for a call');
  ok(dateText(null, 0) === '[no date]' && dateText({ text: '[TEST DATE]', epoch: 0, dayMs: 1, yearDays: 1, firstYear: 0, format: '' }, 9) === '[TEST DATE]', 'a story with no calendar says no date, and the test set\'s says only its own words');
}

// ---- reading through the host: handed, frozen, put away ------------------------------------------------------------
const lib = loadSet(testFiles, { test: true }).set;
let now = 1_900_000_000_000;
const hostOf = (s: StorySet, book: StoryBook = emptyBook('c-doc')) => new HostCore({ book, lib: s, payer: 'browser' });
const ctx = () => ({ now, world: 'tatooine', here: [3482, -4690] as [number, number], room: null, species: 'human_male', name: 'Han' });
const texts = new Map<string, string>();
const keep = (r: { texts: Record<string, string> }) => {
  for (const h of Object.keys(r.texts)) texts.set(h, r.texts[h]);
};
const look = (h: string) => texts.get(h);
{
  const h = hostOf(lib);
  const never = h.read('test:doc/test-pages', {}, ctx(), look);
  ok(!never.word.view && /never handed/.test(never.word.why ?? '') && !(h.book.journal?.length), 'a document nobody handed over is not opened, and nothing is written');
  keep(h.grant('test:docs', ctx()));
  ok(docsToRead(h.book, lib).some((d) => d.id === 'test:doc/test-pages' && d.step === 'read' && d.quest === 'test:docs') && !(h.book.journal?.length), 'a document step hands its page over as it begins, and handing writes nothing in the journal');
  const first = h.read('test:doc/test-pages', {}, ctx(), look);
  keep(first.r);
  const e = h.book.journal?.[0];
  ok(!!first.word.view && first.word.view.pages.length === 2 && e?.kind === 'doc' && e.doc === 'test:doc/test-pages' && e.h && texts.get(e.h) === JSON.stringify(first.word.view), 'the first reading writes the page into the journal by its words, exactly as it was shown');
  ok(JSON.stringify(first.word.view).includes('[TEST DATE]') && JSON.stringify(first.word.view).includes('Han the Human') && first.r.notes.some((n) => n.k === 'journal'), 'filled from the calendar and the reader, and the message line told of the new entry');
  ok(!JSON.stringify(first.word.view).includes('SOMEBODY WHO HAS MET'), 'its redaction stands for a reader who has not met the clerk');
  ok(h.book.quests?.['test:docs']?.steps.read.state === 'active', 'opened, a document step still waits for its last page');
  // The owner rewrites the memo, and the reader meets the clerk: the page read stays the page read.
  const rewritten = loadSet(testFiles.map((f: { path: string; text: string }) => (f.path === 'docs/test-pages.doc.txt' ? { ...f, text: f.text.replace('This is the first page of a test memo', 'TEST: REWRITTEN') } : f)), { test: true }).set;
  h.setLibrary(rewritten, ctx());
  h.talkOpen('test:cast/test-clerk', ctx());
  const again = h.read('test:doc/test-pages', {}, ctx(), look);
  ok(JSON.stringify(again.word.view) === JSON.stringify(first.word.view) && h.book.journal!.filter((x) => x.kind === 'doc').length === 1, 'read again it is the very page first read -- after the owner rewrote it and after the reader met the clerk -- and no second entry');
  now += 1000;
  const end = h.read('test:doc/test-pages', { end: true }, ctx(), look);
  keep(end.r);
  ok(h.book.docs?.['test:doc/test-pages']?.done === now && h.book.quests?.['test:docs']?.steps.read.state === 'done' && h.book.quests['test:docs'].steps.call.state === 'active', 'read to its last page, it is put away and the step waiting on it is done');
  ok(h.book.journal!.some((x) => x.kind === 'note' && texts.get(x.h!)?.startsWith('TEST: a note')), 'and the note the step writes where the player was is in the journal');
  ok(docsToRead(h.book, rewritten).some((d) => d.id === 'test:doc/test-call' && d.from === 'test:cast/test-clerk'), 'the call is handed over next, from the clerk');
  const call = h.read('test:doc/test-call', { end: true }, ctx(), look);
  keep(call.r);
  ok(call.word.from === 'test:cast/test-clerk' && h.book.journal!.some((x) => x.kind === 'comm' && x.with[0] === 'test:cast/test-clerk') && h.book.quests?.['test:docs']?.state === 'done', 'a call heard to its end is written as a call, with its caller, and finishes the job');
}

// ---- two characters, two letters -----------------------------------------------------------------------------------
{
  const books: Record<string, StoryBook> = {};
  const read = (option: 'a' | 'b'): { variant: string | null; text: string } => {
    const h = hostOf(lib, emptyBook(`c-${option}`));
    h.grant('test:branchDoc', ctx());
    const ask = h.read('test:doc/test-branch-ask', {}, ctx(), look);
    keep(ask.r);
    ok(ask.word.foot?.k === 'choice' && ask.word.foot.options.map((o) => o.id).join() === 'a,b', `the notice's foot offers A and B (${option})`);
    // Read to its last page and shut without choosing: the page is not put away, since its question still stands.
    const ended = h.read('test:doc/test-branch-ask', { end: true }, ctx(), look);
    ok(ended.word.end === true && h.book.docs?.['test:doc/test-branch-ask']?.done === undefined && h.book.quests?.['test:branchDoc']?.steps.pick.state === 'active' && docsToRead(h.book, lib).some((d) => d.id === 'test:doc/test-branch-ask'), `read to its end with its choice still open, the notice stays to read, and the answer says it answers that reading (${option})`);
    const again = h.read('test:doc/test-branch-ask', {}, ctx(), look);
    ok(again.word.foot?.k === 'choice' && JSON.stringify(again.word.view) === JSON.stringify(ask.word.view), `opened again it is the page first read, with the choice still at its foot (${option})`);
    h.read('test:doc/test-branch-ask', { pick: option }, ctx(), look);
    const letter = h.read('test:doc/test-branch', { end: true }, ctx(), look);
    ok(h.book.quests?.['test:branchDoc']?.state === 'done' && h.book.docs?.['test:doc/test-branch-ask']?.done !== undefined && !docsToRead(h.book, lib).some((d) => d.id === 'test:doc/test-branch-ask'), `a choice made at the foot puts the page away and moves the job on (${option})`);
    const e = h.book.journal!.find((x) => x.doc === 'test:doc/test-branch')!;
    books[option] = h.book;
    return { variant: e.variant ?? null, text: JSON.stringify(letter.word.view) };
  };
  const a = read('a');
  const b = read('b');
  ok(a.variant === 'a' && b.variant === 'b' && a.text.includes('A version') && b.text.includes('B version') && !/true|canonical/i.test(`${a.text}${b.text}`), 'two characters who chose differently hold two different letters, each frozen as it was read, and nothing marks either as the true one');
  // What a character witnessed is read by a condition: the letter, and which version of it.
  const saw = (book: StoryBook, c: { witnessed: string; variant?: string }) => evalCond(c, book, { now, char: book.char, payer: 'browser' });
  ok(saw(books.a, { witnessed: 'test:doc/test-branch', variant: 'a' }) && !saw(books.b, { witnessed: 'test:doc/test-branch', variant: 'a' }) && saw(books.b, { witnessed: 'test:doc/test-branch', variant: 'b' }), 'witnessed(doc, a) holds for the reader of the A letter and not for the reader of the B letter');
  const fresh = hostOf(lib, emptyBook('c-witness'));
  keep(fresh.grant('test:docs', ctx()));
  ok(!saw(fresh.book, { witnessed: 'test:doc/test-pages' }), 'witnessed(doc) does not hold for a page only handed over');
  keep(fresh.read('test:doc/test-pages', {}, ctx(), look).r);
  ok(saw(fresh.book, { witnessed: 'test:doc/test-pages' }) && !saw(fresh.book, { witnessed: 'test:doc/test-call' }), 'and holds once it has been read, for that page alone');
}

// ---- lost words cost only what is shown ------------------------------------------------------------------------------
{
  // A page opened once whose frozen words this host has since lost (a store that went, a server past its cap).
  const h = hostOf(lib, emptyBook('c-lost'));
  keep(h.grant('test:docs', ctx()));
  h.read('test:doc/test-pages', {}, ctx(), look);
  const lost = (x: string) => (x === h.book.journal?.[0]?.h ? undefined : texts.get(x));
  const shown = h.read('test:doc/test-pages', {}, ctx(), lost);
  ok(!!shown.word.view && isUnkeptView(shown.word.view) && shown.word.view.title === h.book.journal![0].title && !shown.word.why, 'opened again with its words lost, the page says it was not kept, under the title the journal kept, and is no refusal');
  const end = h.read('test:doc/test-pages', { end: true }, ctx(), lost);
  keep(end.r);
  ok(!!end.word.view && h.book.docs?.['test:doc/test-pages']?.done !== undefined && h.book.quests?.['test:docs']?.steps.read.state === 'done', 'and read to its end all the same, which does the step waiting on it');
  // A journal too full to freeze a page in: the page is shown as it reads now and read on as any page is.
  const full = new HostCore({ book: emptyBook('c-full'), lib, payer: 'browser', limits: { ...BOOK_LIMITS, journal: 0 } });
  full.grant('test:docs', ctx());
  const open = full.read('test:doc/test-pages', {}, ctx(), look);
  ok(!!open.word.view && open.word.view.pages.length === 2 && !(full.book.journal?.length) && full.book.docs?.['test:doc/test-pages']?.j === undefined && /journal holds/.test(open.r.why ?? ''), 'a journal too full to take the page shows it unfrozen, writes nothing, and says why');
  full.read('test:doc/test-pages', { end: true }, ctx(), look);
  ok(full.book.quests?.['test:docs']?.steps.read.state === 'done', 'and the page is still read to its end, and the step waiting on it done');
}

// ---- a card's foot ---------------------------------------------------------------------------------------------------
{
  const h = hostOf(lib, emptyBook('c-card'));
  h.offer('test:card', ctx());
  const card = h.read('test:doc/test-card', {}, ctx(), look);
  keep(card.r);
  ok(card.word.foot?.k === 'card' && card.word.foot.offered && card.word.foot.client === 'civic' && card.word.foot.stakes === 'TEST: nothing is at stake but a test', 'a card\'s foot offers the job, with what is at stake and who it is for');
  h.read('test:doc/test-card', { end: true }, ctx(), look);
  ok(h.book.docs?.['test:doc/test-card']?.done === undefined && docsToRead(h.book, lib).some((d) => d.card), 'read to its last page and not yet answered, the card stays to read');
  h.accept('test:card', ctx());
  ok(h.book.quests?.['test:card']?.state === 'active' && h.book.docs?.['test:doc/test-card']?.done !== undefined && !docsToRead(h.book, lib).some((d) => d.card), 'taken, the job runs and its card is put away');
  ok(footOf(h.book, lib, 'test:doc/test-card', { now, char: 'c-card', payer: 'browser' })?.k === 'card' && !(footOf(h.book, lib, 'test:doc/test-card', { now, char: 'c-card', payer: 'browser' }) as { offered: boolean }).offered, 'and its foot no longer offers it');
  const declined = hostOf(lib, emptyBook('c-card2'));
  declined.offer('test:card', ctx());
  declined.read('test:doc/test-card', {}, ctx(), look);
  declined.decline('test:card', ctx());
  ok(declined.book.docs?.['test:doc/test-card']?.done !== undefined && !docsToRead(declined.book, lib).length && declined.book.quests?.['test:card']?.state === 'none', 'turned down, its card is put away and off the list, and the job may be offered again');
  now += 1000;
  declined.offer('test:card', ctx());
  const fresh = declined.book.docs?.['test:doc/test-card'];
  ok(!!fresh && fresh.done === undefined && fresh.j === undefined && fresh.at === now && docsToRead(declined.book, lib).some((d) => d.card && !d.opened), 'offered again, the card is a new handing, not yet opened, read afresh');
}

// ---- off the wire, and the committed test set ---------------------------------------------------------------------------
{
  const view: DocView = { id: 'test:doc/x', kind: 'memo', title: 'TEST', variant: null, pages: [[{ t: 'p', s: ['TEST', { bar: 9999 }] }, { t: 'stamp', text: 'TEST' }, { t: 'table', rows: [['a']] }] as DocBlock[]] };
  const back = cleanDocView(JSON.parse(JSON.stringify({ ...view, extra: 1, pages: [...view.pages, 'nonsense'] })));
  ok(!!back && back.pages.length === 1 && (back.pages[0][0] as { s: { bar: number }[] }).s[1].bar === 400 && !('extra' in back), 'a page off the wire is rebuilt: a bar held to its length, nothing carried that was not rebuilt');
  ok(cleanDocView({ ...view, id: 'nonsense' }) === null && cleanDocView({ ...view, kind: 'scroll' }) === null, 'and one with no document\'s id or kind is not one');
  const docs = Object.values(lib.docs ?? {});
  const unlabelled = docs.flatMap((d) => docWords(d).filter((w) => !/^TEST\b/.test(w.text.trim())).map((w) => `${d.id}:${w.line} ${w.text}`));
  ok(docs.length === 7 && unlabelled.length === 0, `every word the test set's documents carry is labelled TEST, and so is every title (${unlabelled.join('; ') || `${docs.length} documents`})`);
  const r = checkSet(loadSet(testFiles, { test: true }));
  ok(!r.errors.length && r.counts.docs === 7, 'and the set checks clean with its documents');
}
{
  // Rule 11's other half: every document a card, a step, an action or a condition names exists.
  const r = checkSet(set(
    { path: 'quests/q.jsonc', text: JSON.stringify({ id: 'q', title: 'TEST', card: 'doc/none', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'document', doc: 'doc/nothing', do: { start: ['doc(doc/gone)'] }, next: [{ to: 't', when: 'witnessed(doc/missing)' }] }, t: { type: 'nothing', ends: 'done' } } }) },
  ));
  for (const d of ['none', 'nothing', 'gone', 'missing']) ok(r.errors.some((e) => e.rule === 11 && e.message.includes(`own:doc/${d}`)), `rule 11: a document named that is not there (${d})`);
}

console.log(`\n${checks} checks passed`);
