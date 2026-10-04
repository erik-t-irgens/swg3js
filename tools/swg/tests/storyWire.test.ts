// The story's words on the wire (`src/story/storyWire.ts`): a book cut into pieces and put back
// together, both ways, and every word cleaned so that what a browser or a server on another build sends
// can neither grow a message nor put anything through that was not rebuilt.
//
// The failures pinned. A book that does not come back whole from its pieces is a book silently cut short.
// A piece out of order, a book past the size a server takes, and pieces that stop coming must each be
// given up rather than glued into something that is not the book. And a word that is not one -- the wrong
// type, a missing field, an id that is a language name -- is dropped and never acted on.
//
// Synthetic throughout.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Reassembly, STORY_WIRE, bookText, chunkText, cleanStoryWord, cleanTexts, storyHailVersion } from '../../../src/story/storyWire.ts';
import { emptyBook } from '../../../src/story/book.ts';
import { HostCore } from '../../../src/story/hostCore.ts';
import { JOURNAL_TUNE, cleanMine, textHash } from '../../../src/story/journal.ts';
import { loadSet } from '../../../src/story/set.ts';
import { cleanView } from '../../../src/story/view.ts';
import { readStorySet } from '../../../server/storySet.mjs';

const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- pieces -------------------------------------------------------------------------------------------
{
  const text = Array.from({ length: 5000 }, (_, i) => String.fromCharCode(32 + (i % 90))).join('');
  for (const size of [1, 7, 1000, 4999, 5000, 5001, 24000]) {
    const parts = chunkText(text, size);
    ok(parts.join('') === text && parts.every((p) => p.length <= size) && parts.length === Math.ceil(text.length / size), `a text cut into pieces of ${size} comes back whole from ${parts.length}`);
  }
  ok(chunkText('', 100).length === 1 && chunkText('', 100)[0] === '', 'an empty text is one empty piece, so even it can be sent');
  const book = { ...emptyBook('char-1'), waypoints: [{ id: 'w1', name: 'Éclair Café — ☃', world: 'naboo', f: 'raw', p: [1, 2, null], colour: 'accent', on: true, made: 1 }] };
  const wire = bookText(book);
  ok(/^[\x20-\x7e]*$/.test(wire), 'a book on the wire is plain ASCII, so a piece\'s length in characters is its length in bytes');
  ok(JSON.parse(wire).waypoints[0].name === 'Éclair Café — ☃', 'and reads back to every character it had');
}

// ---- putting them back together -------------------------------------------------------------------------
{
  const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(40);
  const parts = chunkText(text, 100);
  const r = new Reassembly(10000, 1000);
  let got: ReturnType<Reassembly['add']> = null;
  for (let n = 0; n < parts.length; n++) got = r.add({ id: 4, n, of: parts.length, part: parts[n] }, 10 + n);
  ok(!!got && 'text' in got && got.text === text && !r.busy, 'pieces in order make the book again, and nothing is left half in');
  r.add({ id: 5, n: 0, of: 3, part: 'aa' }, 0);
  got = r.add({ id: 5, n: 2, of: 3, part: 'cc' }, 1);
  ok(!!got && 'why' in got && /order/.test(got.why) && !r.busy, 'a piece out of order gives the book up, saying why');
  r.add({ id: 6, n: 0, of: 3, part: 'aa' }, 0);
  ok(r.add({ id: 99, n: 1, of: 3, part: 'bb' }, 1) === null && r.busy, 'a piece of another book is no piece of this one, and changes nothing');
  got = r.add({ id: 6, n: 1, of: 3, part: 'bb' }, 5000);
  ok(!!got && 'why' in got && /stopped/.test(got.why), 'a piece that comes after too long a wait gives the book up');
  const small = new Reassembly(150, 1000);
  small.add({ id: 1, n: 0, of: 3, part: 'x'.repeat(100) }, 0);
  got = small.add({ id: 1, n: 1, of: 3, part: 'x'.repeat(100) }, 1);
  ok(!!got && 'why' in got && /larger/.test(got.why) && !small.busy, 'a book past the size taken is given up as soon as it is past it');
  small.add({ id: 2, n: 0, of: 2, part: 'x' }, 0);
  ok(!small.expire(500) && small.expire(1001) && !small.busy, 'a book whose next piece is overdue is given up by the clock too');
  small.add({ id: 3, n: 0, of: 2, part: 'x' }, 0);
  got = small.add({ id: 7, n: 0, of: 1, part: 'y' }, 1);
  ok(!!got && 'text' in got && got.text === 'y', 'a piece numbered nought starts a book over, whatever was arriving');
}

// ---- a browser's words, as the server reads them -----------------------------------------------------------
{
  const sync = cleanStoryWord({ t: 'story', do: 'sync', has: 1, base: 3, local: 2, known: 1 }, 'up');
  ok(!!sync && sync.do === 'sync' && sync.has && sync.base === 3 && sync.local === 2 && sync.known, 'a sync is read');
  ok(cleanStoryWord({ do: 'sync', has: 1, base: -1, local: 0 }, 'up') === null && cleanStoryWord({ do: 'sync', base: 1.5, local: 0 }, 'up') === null && cleanStoryWord({ do: 'sync', base: '3', local: 0 }, 'up') === null, 'one whose counts are not whole numbers is dropped');
  const offer = cleanStoryWord({ t: 'story', do: 'offer', id: 2, n: 0, of: 3, part: 'abc', known: 0 }, 'up');
  ok(!!offer && offer.do === 'offer' && offer.part === 'abc' && !offer.known, 'a piece of an offer is read');
  ok(cleanStoryWord({ do: 'offer', id: 2, n: 3, of: 3, part: 'x' }, 'up') === null && cleanStoryWord({ do: 'offer', id: 2, n: 0, of: 0, part: 'x' }, 'up') === null && cleanStoryWord({ do: 'offer', id: 2, n: 0, of: 1, part: 'x'.repeat(STORY_WIRE.partMax + 1) }, 'up') === null && cleanStoryWord({ do: 'offer', id: 2, n: 0, of: 1, part: 5 }, 'up') === null, 'a piece past its own count, of no pieces, too long, or not text is dropped');
  const set = cleanStoryWord({ t: 'story', do: 'wp', op: 'set', wp: { name: 'Home', world: 'tatooine', f: 'raw', p: [1, 2, null], id: 'w999', made: 5, extra: 1 } }, 'up');
  ok(!!set && set.do === 'wp' && set.op === 'set' && !('id' in set.wp) && !('made' in set.wp) && !('extra' in set.wp), 'a waypoint asked for carries no id and no time of the browser\'s: both are the server\'s to give');
  const edit = cleanStoryWord({ do: 'wp', op: 'edit', wp: { id: 'w3', colour: 'bad', name: 'Danger' } }, 'up');
  ok(!!edit && edit.do === 'wp' && edit.op === 'edit' && edit.id === 'w3' && edit.colour === 'bad' && edit.name === 'Danger', 'an edit is read');
  ok(cleanStoryWord({ do: 'wp', op: 'edit', wp: { id: 'w3', colour: 'void' } }, 'up') === null, 'and one that changes nothing it may change is dropped');
  ok(cleanStoryWord({ do: 'wp', op: 'gone', wp: { id: '__proto__' } }, 'up') === null && cleanStoryWord({ do: 'wp', op: 'on', wp: { id: 'constructor' } }, 'up') === null && cleanStoryWord({ do: 'wp', op: 'off', wp: { id: 7 } }, 'up') === null, 'an id that is a language name, or not a string, is dropped');
  const track = cleanStoryWord({ do: 'wp', op: 'track', wp: { id: null } }, 'up');
  ok(!!track && track.do === 'wp' && track.op === 'track' && track.id === null, 'tracking nothing is a word');
  ok(!!cleanStoryWord({ do: 'wp', op: 'track', wp: { id: 'q:own:courier#deliver' } }, 'up'), 'and so is tracking a quest\'s waypoint');
  ok(cleanStoryWord({ do: 'wp', op: 'nonsense', wp: { id: 'w1' } }, 'up') === null && cleanStoryWord({ do: 'wp', op: 'gone' }, 'up') === null && cleanStoryWord({ do: 'book' }, 'up') === null, 'an operation that is not one, a waypoint word with no waypoint, and a server\'s word sent up are all dropped');
  ok(cleanStoryWord({ t: 'items', do: 'sync', base: 0, local: 0 }, 'up') === null && cleanStoryWord(null, 'up') === null && cleanStoryWord([], 'up') === null, 'and so is anything that is not a story word at all');
}

// ---- a server's words, as the browser reads them -----------------------------------------------------------
{
  const book = cleanStoryWord({ t: 'story', do: 'book', id: 1, n: 0, of: 1, part: '{}', take: 'browser' }, 'down');
  ok(!!book && book.do === 'book' && book.take === 'browser', 'a piece of the server\'s book is read, with whose copy stands');
  ok(cleanStoryWord({ do: 'book', id: 1, n: 0, of: 1, part: '{}', take: 'nonsense' }, 'down')!.do === 'book' && (cleanStoryWord({ do: 'book', id: 1, n: 0, of: 1, part: '{}' }, 'down') as { take: string }).take === 'server', 'a take that says nothing reads as the server\'s');
  ok(cleanStoryWord({ do: 'want' }, 'down')!.do === 'want', 'a want is read');
  const ch = cleanStoryWord({ do: 'ch', rev: 4, ch: [{ k: 'wpOn', id: 'w1', on: true }, { k: 'nonsense' }] }, 'down');
  ok(!!ch && ch.do === 'ch' && ch.rev === 4 && ch.ch.length === 1 && !ch.whole, 'a batch keeps the changes it can read and says it is not whole, so the book is asked for again');
  ok(cleanStoryWord({ do: 'ch', rev: 4, ch: Array.from({ length: STORY_WIRE.changesMax + 1 }, () => ({ k: 'wpGone', id: 'w1' })) }, 'down') === null && cleanStoryWord({ do: 'ch', rev: -1, ch: [] }, 'down') === null, 'a batch too long, or at no revision, is dropped');
  const no = cleanStoryWord({ do: 'no', why: `bad\u0000${'x'.repeat(500)}` }, 'down');
  ok(!!no && no.do === 'no' && no.why.length === STORY_WIRE.whyMax && !no.why.includes('\u0000'), 'a refusal is cut to length and stripped of control characters');
  ok(cleanStoryWord({ do: 'sync', base: 0, local: 0 }, 'down') === null, 'a browser\'s word sent down is dropped');
}

// ---- the jobs' words (story 2) ----------------------------------------------------------------------------
{
  const ev = cleanStoryWord({ t: 'story', do: 'ev', ev: { k: 'arrive', world: 'tatooine', p: [3476, -4694], quest: 'test:goto', step: 'outdoor', extra: 1 }, at: { p: [1, 2], room: { cell: 'cantina', template: 'object/building/tatooine/shared_cantina_tatooine.iff' }, hour: 13, junk: 9 } }, 'up');
  ok(!!ev && ev.do === 'ev' && ev.ev.k === 'arrive' && !('extra' in ev.ev) && ev.at.p?.[0] === 1 && ev.at.room?.cell === 'cantina' && ev.at.hour === 13 && !('junk' in ev.at), 'an event is read with where the player stood, and nothing carried that was not rebuilt');
  ok(cleanStoryWord({ do: 'ev', ev: { k: 'tick' } }, 'up') === null && cleanStoryWord({ do: 'ev', ev: { k: 'arrive', world: 'tatooine', p: [1, 'x'] } }, 'up') === null && cleanStoryWord({ do: 'ev', ev: { k: 'use', object: '__proto__' } }, 'up') === null, 'a step machine\'s own tick, a place that is not two numbers and an id that is a language name are never events');
  const kill = cleanStoryWord({ do: 'ev', ev: { k: 'kill', who: 'kreetle', social: 'rat', tags: ['a', 'a', 'b', 5], npc: 'wild:tatooine:3:0' } }, 'up');
  ok(!!kill && kill.do === 'ev' && kill.ev.k === 'kill' && JSON.stringify(kill.ev.tags) === '["a","b"]' && kill.ev.npc === 'wild:tatooine:3:0' && JSON.stringify(kill.at) === '{}', 'a kill keeps its tags once each and its body\'s name, and an event with no place says none');
  const q = cleanStoryWord({ do: 'q', op: 'drop', quest: 'goto', at: { p: [1, 2] } }, 'up');
  ok(!!q && q.do === 'q' && q.op === 'drop' && q.quest === 'goto' && q.at.p?.[1] === 2, 'a job\'s word may name the job by its name alone, which the server finds in its own sets');
  ok(cleanStoryWord({ do: 'q', op: 'steal', quest: 'test:goto' }, 'up') === null && cleanStoryWord({ do: 'q', op: 'drop', quest: 'a b' }, 'up') === null, 'an operation that is not one, or a job that is no name, is dropped');
  ok(!!cleanStoryWord({ do: 'admin', op: 'complete', quest: 'test:goto', step: 'outdoor' }, 'up') && cleanStoryWord({ do: 'admin', op: 'complete', quest: 'test:goto' }, 'up') === null && cleanStoryWord({ do: 'admin', op: 'grant' }, 'up') === null, 'the console\'s words name what they work on: a step to finish, a job to grant');
  ok(!!cleanStoryWord({ do: 'admin', op: 'clock', ms: null }, 'up') && !!cleanStoryWord({ do: 'admin', op: 'clock', ms: 31000 }, 'up') && cleanStoryWord({ do: 'admin', op: 'clock' }, 'up') === null && !!cleanStoryWord({ do: 'admin', op: 'signal', name: 'debug:test-ping' }, 'up') && !!cleanStoryWord({ do: 'admin', op: 'reload' }, 'up'), 'a clock moved or put back, a signal and a reload are words of their own');
  ok(!!cleanStoryWord({ do: 'wp', op: 'off', wp: { id: 'q:test:waypoints#mark' } }, 'up') && cleanStoryWord({ do: 'wp', op: 'gone', wp: { id: 'q:test:waypoints#mark' } }, 'up') === null, 'a job\'s own waypoint may be switched as the character\'s own are, and never taken away');
  const view = cleanStoryWord({ do: 'view', off: 5, view: { rev: 2, quests: [{ id: 'test:goto', title: { en: '@not a ref' }, client: 'none', state: 'active', lines: [{ quest: 'test:goto', step: 'outdoor', text: 'TEST: walk', n: 1, of: 3, deadline: 99, wp: 'q:test:goto#outdoor' }], canDrop: true, canRestart: false, at: 7 }, { id: 'bad id', title: 'x', state: 'active' }], waypoints: [{ id: 'q:test:goto#outdoor', name: 'TEST: walk', world: 'tatooine', f: 'raw', p: [1, 2, null], colour: 'void', on: true, quest: 'test:goto', step: 'outdoor' }], watch: [{ k: 'area', id: 'test:area/sq', world: 'tatooine', shape: { kind: 'poly', pts: [[0, 0], [1, 0]] } }, { k: 'kill', quest: 'test:kill', step: 'mites', match: { who: ['kreetle'] } }, { k: 'room' }], cast: [{ any: 1 }], objects: [{ id: 'test:obj/t', world: 'tatooine', template: 'object/x.iff', near: [1, 2], reach: 3, label: null }], tracked: ['test:goto', '__proto__'], trackWp: 'q:test:goto#outdoor' } }, 'down');
  ok(!!view && view.do === 'view' && view.off === 5 && view.view.quests.length === 1 && view.view.quests[0].lines[0].of === 3, 'a view is rebuilt, a job that is not one dropped from it');
  ok(!!view && view.do === 'view' && view.view.waypoints[0].colour === 'component' && view.view.watch.length === 2 && view.view.cast.length === 0 && view.view.tracked.length === 1 && view.view.objects[0].label === null, 'a colour not a waypoint\'s takes the quest colour, a polygon of two points is no area, the people stood are not read yet, and a language name is no job');
  ok(cleanStoryWord({ do: 'view', view: { quests: [] } }, 'down') === null, 'and a view at no revision is no view');
  const unread = cleanStoryWord({ do: 'view', off: 0, read: 0, view: { rev: 1, quests: [], waypoints: [], watch: [], cast: [], objects: [], tracked: [], trackWp: null } }, 'down');
  const said = cleanStoryWord({ do: 'view', off: 0, read: 'nonsense', view: { rev: 1, quests: [], waypoints: [], watch: [], cast: [], objects: [], tracked: [], trackWp: null } }, 'down');
  ok(!!unread && unread.do === 'view' && unread.read === false && !!view && view.do === 'view' && view.read === true && !!said && said.do === 'view' && said.read === true, 'a view says whether the server reads a story set: only an outright nought says it does not');
  const note = cleanStoryWord({ do: 'note', note: { k: 'objectiveDone', quest: 'test:goto', step: 'outdoor', line: 'TEST: walk', goto: true }, given: 1 }, 'down');
  ok(!!note && note.do === 'note' && note.note.k === 'objectiveDone' && note.note.line === 'TEST: walk' && note.note.goto === true && note.given, 'a note carries an objective\'s own words and whether it was a place to reach');
  ok(cleanStoryWord({ do: 'note', note: { k: 'paid', credits: 'lots' } }, 'down') === null && (cleanStoryWord({ do: 'note', note: { k: 'item', kind: 'wear', id: 'shirt_s03', n: 1 }, given: 0 }, 'down') as { given: boolean }).given === false, 'a payment that is no number is no note, and a thing that did not arrive says so');
  const job = cleanStoryWord({ do: 'no', why: 'that job is not taken', of: 'job' }, 'down');
  ok(!!job && job.do === 'no' && job.of === 'job' && (cleanStoryWord({ do: 'no', why: 'x', of: 'book' }, 'down') as { of?: string }).of === undefined, 'a refusal about a job says so, and any other is about the book');
}

// ---- documents and the journal (story 4) ---------------------------------------------------------------------
{
  const read = cleanStoryWord({ t: 'story', do: 'read', doc: 'test:doc/test-pages', end: 1, at: {} }, 'up');
  ok(!!read && read.do === 'read' && read.end && read.pick === null && cleanStoryWord({ do: 'read', doc: '__proto__' }, 'up') === null && cleanStoryWord({ do: 'read', doc: 'test:doc/x', pick: 'a b' }, 'up') === null, 'a reading names a document, read to its end or chosen on by a plain option; anything else is dropped');
  ok((cleanStoryWord({ do: 'journal', from: 0, count: STORY_WIRE.journalMax + 1 }, 'up') === null) && !!cleanStoryWord({ do: 'journal', from: 3, count: STORY_WIRE.journalMax }, 'up'), 'a stretch of the journal is asked for no longer than one word carries');
  const long = `${'TEST '.repeat(79)}x ${'y'.repeat(20)}`;
  const mine = cleanStoryWord({ do: 'mine', ref: 'j1', text: `\u0000  ${long}  ` }, 'up');
  ok(!!mine && mine.do === 'mine' && mine.text === cleanMine(`\u0000  ${long}  `) && !mine.text.includes('\u0000') && mine.text.length <= JOURNAL_TUNE.mineMax && cleanMine(mine.text) === mine.text && cleanMine(`${'a'.repeat(JOURNAL_TUNE.mineMax - 1)} b`) === cleanMine(cleanMine(`${'a'.repeat(JOURNAL_TUNE.mineMax - 1)} b`)), 'a note of the player\'s own is cleaned as every host cleans it, and cleaning it again changes nothing, even cut where a space falls');
  const view = { id: 'test:doc/test-pages', kind: 'memo', title: 'TEST', variant: null, pages: [[{ t: 'p', s: ['TEST'] }]] };
  const doc = cleanStoryWord({ t: 'story', do: 'doc', doc: 'test:doc/test-pages', view, foot: { k: 'choice', quest: 'test:branchDoc', step: 'pick', options: [{ id: 'a', label: 'TEST: A', enabled: true }] }, entry: 'j1', end: 1, from: 'test:cast/test-clerk' }, 'down');
  ok(!!doc && doc.do === 'doc' && doc.view?.title === 'TEST' && doc.foot?.k === 'choice' && doc.entry === 'j1' && doc.end === true && doc.from === 'test:cast/test-clerk', 'a page comes down with its foot, its journal entry, who calls, and whether it answers a reading to the end');
  ok(cleanStoryWord({ do: 'doc', doc: 'test:doc/other', view }, 'down') === null && (cleanStoryWord({ do: 'doc', doc: 'test:doc/test-pages', view: null, why: 'TEST: no' }, 'down') as { view: unknown; why: string; end?: true }).view === null && (cleanStoryWord({ do: 'doc', doc: 'test:doc/test-pages', view: null, why: 'x' }, 'down') as { end?: true }).end === undefined, 'a page under another document\'s name is dropped, a refusal carries no page, and only an answer to the end says so');
  const kept = 'TEST: words the server kept';
  const journal = cleanStoryWord({ do: 'journal', from: 4, entries: [{ id: 'j5', at: 1, kind: 'note', place: null, with: [], h: textHash(kept) }, { id: 'nonsense' }], texts: { [textHash(kept)]: kept, [textHash('TEST: other')]: 'TEST: forged', __proto__: 'x' } }, 'down');
  ok(!!journal && journal.do === 'journal' && journal.from === 4 && journal.entries.length === 1 && journal.texts[textHash(kept)] === kept, 'a stretch of the journal comes down with the entries it can read and their words');
  ok(!!journal && journal.do === 'journal' && Object.keys(cleanTexts(journal.texts, textHash)).length === 1, 'and words under a hash that is not their own are never kept');
  const need = cleanStoryWord({ do: 'need', hashes: [textHash(kept), textHash(kept), 'nonsense', 7] }, 'down');
  ok(!!need && need.do === 'need' && need.hashes.length === 1, 'a server\'s asking for words names each hash once, and nothing that is not one');
  // A view round trip keeps what is to read and how coldly the file makes a track greet the character.
  const host = new HostCore({ book: emptyBook('c-wire'), lib: loadSet(readStorySet(TESTSET).files.filter((f: { path: string }) => !f.path.startsWith('fixtures/')), { test: true }).set, payer: 'browser' });
  const at = { now: 1_900_000_000_000, world: 'tatooine', here: [3482, -4690] as [number, number], room: null };
  host.grant('test:docs', at);
  host.grant('test:file', at);
  const sent = host.view(at);
  const back = cleanView(JSON.parse(JSON.stringify(sent)));
  ok(!!sent.docs?.length && JSON.stringify(back?.docs) === JSON.stringify(sent.docs), 'a view off the wire keeps the documents still to read, as the server listed them');
  ok(sent.file?.react?.empire === 'mean' && back?.file?.react?.empire === 'mean' && back.file.entries.length === sent.file.entries.length, 'and the file: how coldly the Empire\'s people greet the character, before any entry may be seen');
}

// ---- the hail ---------------------------------------------------------------------------------------------
{
  ok(storyHailVersion({ v: 1, sets: [], tests: 0 }) === 1, 'a hail that carries a story says which');
  ok(storyHailVersion(undefined) === 0 && storyHailVersion({ v: '1' }) === 0 && storyHailVersion({ v: -2 }) === 0 && storyHailVersion([]) === 0, 'and one that carries none, or nonsense, holds none');
}

console.log(`\n${checks} checks passed`);
