// The story book on its own: what a book is (`src/story/book.ts`), what a waypoint is
// (`src/story/waypoints.ts`), where this browser keeps one (`src/story/storyStore.ts`), and this
// browser's half of holding one (`src/story/bookClient.ts`) -- alone, and talking to a server that is
// played here by the test.
//
// The failures pinned. A batch must do the same thing on the same book every time, or the server's log
// played back on start and the browser's copy applying the server's batches would each come out a
// different book. A waypoint past the hundredth must be refused and say so. Nothing a browser or a file
// hands in may carry a key the language gives a meaning to, nor anything the cleaner did not rebuild. A
// character whose story was never played alone must keep the change counter's mark it had before there
// was a story, or bringing a browser up to date would raise every counter. And a copy the server did not
// take is set aside, never thrown away.
//
// Everything is synthetic: no browser, no socket, nothing read from the game's own files.
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOOK_LIMITS, applyChanges, bookIsEmpty, bookSummary, cleanBook, cleanChange, emptyBook, markPaidBy, whyNot, type StoryBook } from '../../../src/story/book.ts';
import { evalCond } from '../../../src/story/quests.ts';
import { Stories, applyStory } from '../../../server/stories.mjs';
import { openStore } from '../../../server/store.mjs';
import { WAYPOINT_COLOURS, WAYPOINT_TUNE, cleanWaypoint, cleanWaypointAsk, gameToRaw, gameToRawX, gameToRawZ, rawToGame, rawToGameX, rawToGameZ, waypointName, type Waypoint } from '../../../src/story/waypoints.ts';
import { ASIDE_KEPT, asideBook, asides, loadBook, saveBook, setAside, type StoryStorage } from '../../../src/story/storyStore.ts';
import { BookClient, STORY_TUNE, type StoryLine } from '../../../src/story/bookClient.ts';
import { bookText, chunkText } from '../../../src/story/storyWire.ts';
import { PALETTE_NAMES } from '../../../src/core/palette.ts';
import { Session, characterMark } from '../../../src/net/session.ts';
import { mapFromGameX, mapFromGameZ } from '../../../src/ui/spaceMapLayers.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ask = (over: Record<string, unknown> = {}) => ({ name: 'Cantina', world: 'tatooine', f: 'raw', p: [3407.2, -4587.1, null], ...over });
const wp = (id: string, over: Record<string, unknown> = {}): Waypoint => cleanWaypoint({ id, made: 5, ...ask(), ...over })!;

// The rules' own folder importing nothing outside it but the hashing is `storyImports.test.ts`'s.

// ---- the colours --------------------------------------------------------------------------------------
{
  ok(WAYPOINT_COLOURS.length === 13, 'a waypoint may wear thirteen colours');
  ok(WAYPOINT_COLOURS.every((c) => (PALETTE_NAMES as readonly string[]).includes(c)), 'every one of them a name in the palette');
  ok(!['void', 'plate', 'panel', 'rule', 'edge'].some((c) => (WAYPOINT_COLOURS as readonly string[]).includes(c)), 'and none of the dark or the translucent ones, which a mark would not be seen in');
  ok((WAYPOINT_COLOURS as readonly string[]).includes(WAYPOINT_TUNE.defaultPersonal) && (WAYPOINT_COLOURS as readonly string[]).includes(WAYPOINT_TUNE.defaultQuest), 'the two defaults are among them');
}

// ---- a waypoint ---------------------------------------------------------------------------------------
{
  const a = cleanWaypointAsk(ask({ name: '  Near\u0007 Mos Eisley  ', colour: 'warn', room: { cell: 'cantina', template: 'object/building/tatooine/shared_cantina_tatooine.iff' } }));
  ok(!!a && a.name === 'Near Mos Eisley' && a.colour === 'warn' && a.room?.cell === 'cantina', 'a waypoint asked for is cleaned: its name stripped of control characters and trimmed, its colour and room kept');
  ok(cleanWaypointAsk(ask({ name: 'x'.repeat(200) }))!.name.length === WAYPOINT_TUNE.nameMax, `a long name is cut to ${WAYPOINT_TUNE.nameMax}`);
  ok(cleanWaypointAsk(ask({ name: '' }))!.name === 'Waypoint', 'an empty one is called something');
  ok(cleanWaypointAsk(ask({ colour: 'void' }))!.colour === WAYPOINT_TUNE.defaultPersonal, 'a colour that is not one of the thirteen is the default');
  ok(cleanWaypointAsk(ask({ p: [1, Number.NaN, null] })) === null && cleanWaypointAsk(ask({ p: [1] })) === null && cleanWaypointAsk(ask({ p: [1, 2, 'up'] })) === null, 'a place that is not two numbers and a height or nothing is no waypoint');
  ok(cleanWaypointAsk(ask({ f: 'other' })) === null && cleanWaypointAsk(ask({ world: '' })) === null && cleanWaypointAsk(ask({ world: '__proto__' })) === null, 'nor one in no frame, on no world, or on a world named for the language');
  ok(cleanWaypointAsk(ask({ room: { cell: 'cantina<script>' } }))!.room === undefined, 'a room whose name is not a cell name is left off');
  const odd = JSON.parse('{"name":"x","world":"naboo","f":"raw","p":[1,2,null],"__proto__":{"admin":true},"extra":1}');
  const cleaned = cleanWaypointAsk(odd) as Record<string, unknown>;
  ok(!!cleaned && !('extra' in cleaned) && !Object.prototype.hasOwnProperty.call(cleaned, '__proto__') && (cleaned as { admin?: unknown }).admin === undefined, 'nothing the cleaner did not rebuild is carried on, a __proto__ key included');
  ok(cleanWaypoint({ ...ask(), id: 'q:own:x#a', made: 1 }) === null && cleanWaypoint({ ...ask(), id: 'w12', made: 1 })!.id === 'w12', 'a stored waypoint is w and a number, never a quest\'s');
  // Who set one a story set is the host's to keep and never a browser's to ask for.
  ok(cleanWaypoint({ ...ask(), id: 'w3', made: 1, by: 'own:wages' })!.by === 'own:wages' && cleanWaypoint({ ...ask(), id: 'w3', made: 1, by: 'run' })!.by === 'run', 'a stored waypoint a story set keeps the job that set it');
  ok(cleanWaypoint({ ...ask(), id: 'w3', made: 1, by: 'not a job' })!.by === undefined && cleanWaypoint({ ...ask(), id: 'w3', made: 1 })!.by === undefined, 'and one that names no job, or none, is the player\'s own');
  ok(!('by' in (cleanWaypointAsk(ask({ by: 'own:wages' })) as Record<string, unknown>)), 'a browser asking to set one never marks it as a story\'s');
}

// ---- frames -------------------------------------------------------------------------------------------
{
  const centre = { x: -1376, z: -3576 };
  const g = rawToGame(3407, -4587, centre);
  ok(g.x === -(3407 - centre.x) && g.z === -4587 - centre.z, 'a raw point into the game\'s frame mirrors X and takes the centre off');
  const back = gameToRaw(g.x, g.z, centre);
  ok(back.x === 3407 && back.z === -4587, 'and back again to the same point');
  ok(mapFromGameX(centre.x, g.x) === 3407 && mapFromGameZ(centre.z, g.z) === -4587, 'which is exactly the map\'s own frame, so a waypoint and the map\'s places agree');
  ok(rawToGameX(5, gameToRawX(5, 12)) === 12 && rawToGameZ(5, gameToRawZ(5, 12)) === 12, 'the one-number forms agree with the pairs');
  ok(waypointName('Mos Eisley', 300, 4) === 'Near Mos Eisley' && waypointName('Mos Eisley', WAYPOINT_TUNE.nearName + 1, 4) === 'Waypoint 4' && waypointName(null, 0, 9) === 'Waypoint 9', 'a waypoint set on the map is named for the place near it, or by its number');
}

// ---- a book -------------------------------------------------------------------------------------------
{
  const b = emptyBook('char-1');
  ok(b.v === 1 && b.rev === 0 && b.nextWp === 1 && bookIsEmpty(b), 'an empty book is empty, at revision nought');
  ok(cleanBook({ ...b, v: 2 }) === null && cleanBook({ ...b, char: '__proto__' }) === null && cleanBook({ ...b, char: 'a b' }) === null && cleanBook([]) === null && cleanBook(null) === null, 'a book of another version, or for a character id that is not one, is not a book');
  const raw = { ...b, rev: 7, waypoints: [wp('w3'), wp('w3'), { id: 'w9' }, wp('w5')], nextWp: 2, trackWp: 'w99', tracked: ['own:a', 'own:a', 'nonsense', 'own:b'], quests: { 'own:a': { state: 'active' } }, bad: { constructor: 1 }, deep: JSON.parse('['.repeat(40) + ']'.repeat(40)) };
  const c = cleanBook(raw)!;
  ok(c.waypoints.length === 2 && c.waypoints[0].id === 'w3' && c.waypoints[1].id === 'w5', 'a book is cleaned: a waypoint that is not one dropped, a second of one id dropped');
  ok(c.nextWp === 6, 'and its counter is past every id it holds, whatever it said');
  ok(c.trackWp === null && c.tracked.length === 2, 'a tracked waypoint that is not there is not tracked, and the tracked quests are deduplicated and checked');
  ok((c.quests as Record<string, unknown>)['own:a'] !== undefined, 'a section a later wave writes is kept as it came when it is well formed');
  ok(c.bad === undefined && c.deep === undefined, 'and dropped whole when it holds a key the language gives a meaning to, or nests too deep');
  ok(!bookIsEmpty(c) && bookSummary(c)!.sections.includes('quests'), 'a book with a later wave\'s section in it is not empty');
  const many = cleanBook({ ...b, waypoints: Array.from({ length: 150 }, (_, i) => wp(`w${i + 1}`)) })!;
  ok(many.waypoints.length === BOOK_LIMITS.waypoints, `a book read in is held to ${BOOK_LIMITS.waypoints} waypoints`);
  ok(cleanBook(JSON.parse(bookText(c)))!.waypoints.length === 2, 'a book written out and read back is the same book');
}

// ---- changes ------------------------------------------------------------------------------------------
{
  const b = emptyBook('char-1');
  let out = applyChanges(b, [{ k: 'wpSet', wp: wp('w1') }]);
  ok(out.applied.length === 1 && b.waypoints.length === 1 && b.rev === 1 && b.nextWp === 2, 'a waypoint set is in the book, at the next revision, and the counter moves past it');
  out = applyChanges(b, [{ k: 'wpSet', wp: wp('w1') }]);
  ok(out.applied.length === 0 && out.refused[0].why.includes('already') && b.rev === 1, 'a second with the same id is refused, and a batch that changed nothing does not move the revision');
  applyChanges(b, [{ k: 'wpEdit', id: 'w1', name: 'Home', colour: 'good' }, { k: 'wpOn', id: 'w1', on: false }]);
  ok(b.waypoints[0].name === 'Home' && b.waypoints[0].colour === 'good' && !b.waypoints[0].on && b.rev === 2, 'renamed, recoloured and switched off in one batch, at one revision');
  ok(applyChanges(b, [{ k: 'wpEdit', id: 'w1' }]).refused[0].why.includes('nothing') && applyChanges(b, [{ k: 'wpOn', id: 'w7', on: true }]).refused[0].why.includes('no such'), 'an edit that changes nothing, or of a waypoint that is not there, is refused');
  applyChanges(b, [{ k: 'trackWp', id: 'w1' }]);
  ok(b.trackWp === 'w1', 'a waypoint is tracked');
  applyChanges(b, [{ k: 'wpGone', id: 'w1' }]);
  ok(b.waypoints.length === 0 && b.trackWp === null, 'and one taken away is tracked no more');
  applyChanges(b, [{ k: 'qwpOn', key: 'q:own:courier#deliver', on: false }, { k: 'qwpOn', key: 'q:own:courier#deliver', on: false }]);
  ok(b.wpOff.length === 1, 'a quest\'s waypoint switched off is remembered once');
  applyChanges(b, [{ k: 'qwpOn', key: 'q:own:courier#deliver', on: true }]);
  ok(b.wpOff.length === 0, 'and switched on again is forgotten');
  out = applyChanges(b, [{ k: 'track', quest: 'own:a', on: true }, { k: 'track', quest: 'own:b', on: true }, { k: 'track', quest: 'own:c', on: true }, { k: 'track', quest: 'own:d', on: true }]);
  ok(b.tracked.length === 3 && out.refused.length === 1 && out.refused[0].why.includes('3'), 'three jobs are tracked at once and a fourth is refused with the reason');
  ok(applyChanges(b, [{ k: 'nonsense' }]).refused.length === 1 && applyChanges(b, 'nonsense').refused.length === 1, 'a change this book does not know, or a batch that is not a list, is refused rather than thrown on');
  ok(cleanChange({ k: 'wpGone', id: '__proto__' }) === null && cleanChange({ k: 'track', quest: 'constructor', on: true }) === null, 'a change naming one of the language\'s own names is no change');
}
{
  // The hundred, and the hundred and first.
  const b = emptyBook('char-1');
  for (let i = 1; i <= WAYPOINT_TUNE.max; i++) applyChanges(b, [{ k: 'wpSet', wp: wp(`w${i}`) }]);
  ok(b.waypoints.length === 100 && b.rev === 100, 'a character keeps a hundred waypoints');
  const out = applyChanges(b, [{ k: 'wpSet', wp: wp('w101') }]);
  ok(out.applied.length === 0 && out.refused[0].why === 'a character keeps 100 waypoints' && b.waypoints.length === 100, 'and the hundred and first is refused, in words');
  ok(whyNot(b, { k: 'wpSet', wp: wp('w101') }) !== null && b.waypoints.length === 100, 'asking why changes nothing');
}
{
  // The same batch on the same book is the same book, which is what makes the log and the browser's copy agree.
  const batch = [{ k: 'wpSet', wp: wp('w1') }, { k: 'wpSet', wp: wp('w2', { name: 'Two' }) }, { k: 'wpEdit', id: 'w2', colour: 'bad' }, { k: 'wpGone', id: 'w1' }, { k: 'trackWp', id: 'w2' }, { k: 'wpSet', wp: wp('w2') }];
  const one = emptyBook('char-1');
  const two = emptyBook('char-1');
  applyChanges(one, batch);
  applyChanges(two, JSON.parse(JSON.stringify(batch)));
  ok(bookText(one) === bookText(two), 'one batch on two copies of one book comes out the same book, to the character');
}
{
  const b = cleanBook({ ...emptyBook('char-1'), paid: { 'own:a#1#done': { at: 5, by: 'browser' }, 'own:b#1#done': { at: 6, by: 'server' }, 'own:c#1#done': { at: 7, by: 'settle' }, 'own:d#1#done': { at: 8 } } })!;
  const paid = b.paid as Record<string, { by?: string }>;
  ok(markPaidBy(b, 'browser') === 2 && paid['own:a#1#done'].by === 'browser' && paid['own:d#1#done'].by === 'browser', 'every reward a taken book says the browser paid, or names nobody as paying, is marked as the browser\'s');
  ok(paid['own:b#1#done'].by === 'server' && paid['own:c#1#done'].by === 'settle', 'while one the server paid, or paid at a settle, keeps saying so: relabelled, it would be paid again once its own book was archived away');
  ok(markPaidBy(emptyBook('x'), 'browser') === 0, 'and a book with none is left as it is');
}
{
  // The jobs' sections: typed, capped, keyed with no prototype, and read back in the order they were written.
  const raw = JSON.parse(
    '{"v":1,"char":"char-1","rev":3,"waypoints":[],"nextWp":1,"wpOff":[],"trackWp":null,"tracked":[],' +
      '"flags":{"test.a":1,"__proto__":{"admin":true},"bad name!":2,"test.b":"open"},' +
      '"quests":{"test:goto":{"state":"active","run":2,"steps":{"outdoor":{"state":"active","n":1,"at":5,"place":[1,2]},"__proto__":{"state":"done"}},"history":[{"run":1,"outcome":"done","at":4}]},"nonsense":{"state":"active"},"test:x":{"state":"lost"}},' +
      '"xp":12,"tracks":{"freelance":{"standing":30,"trust":1,"rank":"r1"},"jedi":{"standing":5}},"closed":["test:old","test:old","nope"]}',
  );
  const c = cleanBook(raw)!;
  ok(c.flags?.['test.a'] === 1 && c.flags['test.b'] === 'open' && Object.keys(c.flags).length === 2 && Object.getPrototypeOf(c.flags) === null, 'flags keep their numbers and words, refuse a bad name and the language\'s keys, and are a table with no prototype');
  const g = c.quests?.['test:goto'];
  ok(!!g && g.run === 2 && g.steps.outdoor.n === 1 && g.steps.outdoor.place?.[1] === 2 && Object.keys(g.steps).length === 1 && Object.keys(c.quests!).length === 1, 'a quest\'s record is rebuilt with its steps; a key that is not a quest id, a state that is not one and a step called __proto__ are dropped');
  ok(c.xp === 12 && c.tracks?.freelance?.standing === 30 && c.tracks.freelance.rank === 'r1' && !('jedi' in (c.tracks as object)) && c.closed?.length === 1, 'experience, the three tracks (what a later wave adds to a track kept) and the closed list are read and cleaned');
  ok(Object.keys(c).slice(-5).join(',') === 'flags,quests,xp,tracks,closed', 'and the sections stay in the order the book had them, so a book read back is the book written');
  const b = emptyBook('char-1');
  const qs = { state: 'active', run: 1, at: 0, completions: 0, defRev: 1, defHash: '0123456789abcdef', steps: {}, history: [] };
  const lim = { ...BOOK_LIMITS, quests: 1, steps: 1, flags: 1 };
  ok(applyChanges(b, [{ k: 'qState', quest: 'test:a', rec: qs }], lim).applied.length === 1 && applyChanges(b, [{ k: 'qState', quest: 'test:b', rec: qs }], lim).refused[0]?.why === 'a character keeps a record of 1 jobs', 'a new quest past the cap is refused, in words');
  ok(applyChanges(b, [{ k: 'step', quest: 'test:a', step: 's', rec: { state: 'active', n: 0, at: 1 } }], lim).applied.length === 1 && /keeps 1 steps/.test(applyChanges(b, [{ k: 'step', quest: 'test:a', step: 't', rec: { state: 'active', n: 0, at: 1 } }], lim).refused[0]?.why ?? '') && applyChanges(b, [{ k: 'step', quest: 'test:z', step: 's', rec: { state: 'active', n: 0, at: 1 } }]).refused[0]?.why === 'there is no such job in this book', 'so is a step past a quest\'s cap, and a step of a quest the book does not have');
  ok(applyChanges(b, [{ k: 'flag', name: 'a', value: 1 }, { k: 'flag', name: 'b', value: 1 }], lim).refused.length === 1 && applyChanges(b, [{ k: 'flag', name: 'a', value: null }], lim).applied.length === 1 && b.flags?.a === undefined, 'a flag past the cap is refused, and unsetting one frees its place');
  ok(applyChanges(b, [{ k: 'paid', key: 'test:a#1#s', at: 1, by: 'browser' }, { k: 'paid', key: 'test:a#1#s', at: 2, by: 'server' }]).refused[0]?.why === 'that reward is already paid' && b.paid?.['test:a#1#s']?.by === 'browser', 'a reward is recorded once, and the second record of it refused');
  ok(applyChanges(b, [{ k: 'xp', add: 5 }, { k: 'xp', add: 2.5 }, { k: 'trackAdd', track: 'empire', standing: -4 }, { k: 'trackAdd', track: 'jedi', standing: 1 }, { k: 'closed', quest: 'test:a' }, { k: 'closed', quest: 'test:a' }]).applied.length === 3 && b.xp === 5 && b.tracks?.empire?.standing === -4 && b.closed?.length === 1, 'the counters only add, a fraction of experience and a track that is not one are refused, and a quest is closed once');
  ok(cleanChange({ k: 'qState', quest: 'test:a', rec: { state: 'flying' } }) === null && cleanChange({ k: 'flag', name: '__proto__', value: 1 }) === null && cleanChange({ k: 'paid', key: 'x#1', at: 1 }) === null, 'a change carrying a state that is not one, a forbidden name or nobody paying is not a change');
  ok(!bookIsEmpty(b) && bookSummary(b)!.quests === 1 && bookSummary(b)!.active === 1 && bookSummary(b)!.xp === 5, 'and a book with jobs in it is not empty, and says how many');
}
{
  // A book read from a file whose own top level names the language's keys: they are never carried, and the
  // cleaned book is a plain object whatever the text said its prototype was.
  const text = `{"v":1,"char":"char-1","rev":2,"waypoints":[],"nextWp":1,"wpOff":[],"trackWp":null,"tracked":[],"__proto__":{"x":1,"admin":true},"constructor":{"y":2},"prototype":{"z":3},"quests":{"own:a":{"state":"active"}}}`;
  const c = cleanBook(JSON.parse(text))! as Record<string, unknown>;
  ok(!!c && Object.getPrototypeOf(c) === Object.prototype && !Object.prototype.hasOwnProperty.call(c, '__proto__') && !Object.prototype.hasOwnProperty.call(c, 'constructor') && !Object.prototype.hasOwnProperty.call(c, 'prototype'), 'a top-level __proto__, constructor or prototype in a book is not carried, and the book keeps a plain prototype');
  ok(c.x === undefined && c.admin === undefined && c.y === undefined && c.rev === 2 && (c.quests as Record<string, unknown>)['own:a'] !== undefined, 'nothing under them can be reached through the book, and the rest of it is read as it was');
  // A later wave's section past the budget is dropped whole; one within it is kept.
  const limits = { ...BOOK_LIMITS, sectionNodes: 50 };
  const big = cleanBook({ ...emptyBook('char-1'), journal: Array.from({ length: 60 }, (_, i) => i) }, limits)!;
  const small = cleanBook({ ...emptyBook('char-1'), journal: Array.from({ length: 40 }, (_, i) => i) }, limits)!;
  ok(big.journal === undefined && Array.isArray(small.journal) && (small.journal as number[]).length === 40, `a later wave's section with more values than the book allows (${limits.sectionNodes}) is dropped whole, and one within it kept`);
}
{
  // A section named for something every object already has. Looked up in a plain table of cleaners, these
  // found the language's own methods and called them, which threw out of the relay and took it down.
  const names = ['valueOf', 'hasOwnProperty', 'toString', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__lookupGetter__'];
  const raw = JSON.parse(`{"v":1,"char":"char-1","rev":4,"waypoints":[],"nextWp":1,"wpOff":[],"trackWp":null,"tracked":[],${names.map((n) => `"${n}":1`).join(',')},"journal":[1,2]}`);
  let c: Record<string, unknown> | null = null;
  let threw = '';
  try {
    c = cleanBook(raw) as Record<string, unknown> | null;
  } catch (e) {
    threw = String(e);
  }
  ok(!threw && !!c && c.rev === 4 && Array.isArray(c.journal), `a book with sections named valueOf, hasOwnProperty, toString and the rest is cleaned, not thrown on (${threw || 'read'})`);
  ok(!!c && names.every((n) => !Object.prototype.hasOwnProperty.call(c, n)) && typeof c.toString === 'function' && typeof c.valueOf === 'function', 'and none of them is kept: the book still answers the language\'s own names with the language\'s own methods');
  ok(!!c && `${c}` === '[object Object]', 'so it can still be turned into words like any object');
  // The history a quest keeps, cut to its length as it is read.
  const long = cleanBook({ ...emptyBook('char-1'), quests: { 'own:a': { state: 'done', history: Array.from({ length: 12 }, (_, i) => ({ run: i + 1, outcome: 'done', at: i })) } } })!;
  const hist = long.quests!['own:a'].history;
  ok(hist.length === BOOK_LIMITS.history && hist[0].run === 5 && hist.at(-1)?.run === 12, `a quest's history read in keeps its last ${BOOK_LIMITS.history} runs`);
  // A quest's waypoint switched both ways, and read back.
  const b = emptyBook('char-1');
  const key = 'q:own:courier#deliver';
  applyChanges(b, [{ k: 'qwpOn', key, on: true }]);
  ok(b.qwpOn?.length === 1 && b.wpOff.length === 0, 'a quest\'s waypoint switched on by the player is remembered as switched on');
  applyChanges(b, [{ k: 'qwpOn', key, on: false }]);
  ok(b.qwpOn?.length === 0 && b.wpOff.length === 1, 'and switched off again, as switched off, the key never in both lists');
  applyChanges(b, [{ k: 'qwpOn', key, on: true }]);
  const back = cleanBook(JSON.parse(bookText(b)))!;
  ok(back.qwpOn?.[0] === key && back.wpOff.length === 0 && cleanBook({ ...emptyBook('x'), qwpOn: [key, key, 'nonsense'] })!.qwpOn?.length === 1, 'and read back as it was written, deduplicated and checked');
}
{
  // The server: a book offered with such sections is taken without them, and the server answers rather than falling over.
  const stories = new Stories({ write: (rec: object) => applyStory(stories.data, rec), now: () => 1000 });
  const line = { id: 7, character: 'c-proto', keep: 'browser' };
  const asked = stories.hear(line, { t: 'story', do: 'sync', has: 1, base: 0, local: 1, known: 0 });
  ok(asked.ok && asked.tell[0]?.msg.do === 'want', 'a browser whose book the server has never seen is asked for it');
  const offered = { ...emptyBook('c-proto'), local: 1, valueOf: 1, hasOwnProperty: 1, toString: 1, isPrototypeOf: 1, waypoints: [wp('w1')], nextWp: 2 };
  let answer: { ok: boolean; take?: string; tell: { msg: Record<string, unknown> }[] } | null = null;
  let threw = '';
  try {
    answer = stories.hear(line, { t: 'story', do: 'offer', id: 1, n: 0, of: 1, part: bookText(offered), known: 0 });
  } catch (e) {
    threw = String(e);
  }
  const kept = stories.bookOf('c-proto') as Record<string, unknown> | null;
  ok(!threw && !!answer && answer.ok && answer.take === 'browser' && !!kept && (kept.waypoints as unknown[]).length === 1, `an offered book carrying valueOf, hasOwnProperty, toString and isPrototypeOf is taken, not thrown on (${threw || answer?.take})`);
  ok(!!kept && ['valueOf', 'hasOwnProperty', 'toString', 'isPrototypeOf'].every((n) => !Object.prototype.hasOwnProperty.call(kept, n)), 'and is written down without them');
}
{
  // A world read back from its file: the books' own tables come back with no prototype, as a live one has.
  const dir = mkdtempSync(join(tmpdir(), 'swg-story-readback-'));
  try {
    const quiet = { saveEvery: 0, log: () => {} };
    const a = openStore({ dir, epoch: 1000, ...quiet });
    const book = {
      ...emptyBook('c-back'),
      flags: { 'test.a': 1 },
      paid: { 'test:a#1#s': { at: 5, by: 'server' } },
      quests: { 'test:a': { state: 'active', run: 1, at: 1, completions: 0, defRev: 1, defHash: '', steps: { s: { state: 'active', n: 0, at: 1 } }, history: [] } },
    };
    a.change({ t: 'storyBook', id: 'c-back', book });
    a.saveNow();
    a.close();
    // An older server wrote a book with such a section into its log, which this one must still start from.
    appendFileSync(join(dir, 'world.log'), `${JSON.stringify({ t: 'storyBook', id: 'c-old', book: { ...emptyBook('c-old'), valueOf: 1, toString: 'x' }, q: 999999, at: 6 })}\n`);
    let threw = '';
    let b: ReturnType<typeof openStore> | null = null;
    try {
      b = openStore({ dir, epoch: 9999, ...quiet });
    } catch (e) {
      threw = String(e);
    }
    ok(!threw && !!b, `a server starts from a log holding a book an older server wrote with a section named valueOf (${threw || 'started'})`);
    const back = b!.data.stories['c-back'] as StoryBook;
    ok(Object.getPrototypeOf(back.flags) === null && Object.getPrototypeOf(back.paid) === null && Object.getPrototypeOf(back.quests) === null && Object.getPrototypeOf(back.quests!['test:a'].steps) === null, 'a book read back from the snapshot has its flags, rewards, quests and steps as tables with no prototype');
    const ctx = { now: 0, char: 'c-back', payer: 'server' as const };
    ok(!evalCond({ flag: 'toString', set: true }, back, ctx) && evalCond({ flag: 'test.a', set: true }, back, ctx) && !evalCond({ step: ['test:a', 'toString'], is: 'active' }, back, ctx), 'so a flag called toString reads unset on the server\'s copy, as it does on the browser\'s');
    const raw = JSON.parse(JSON.stringify(book)) as StoryBook;
    ok(!evalCond({ flag: 'toString', set: true }, raw, ctx) && whyNot(raw, { k: 'paid', key: 'toString', at: 1, by: 'server' }) === null, 'and even a book nobody cleaned answers the rules only from its own keys');
    ok(!Object.prototype.hasOwnProperty.call(b!.data.stories['c-old'], 'valueOf'), 'and the older server\'s odd section is dropped as the book is read');
    b!.close();
    // The stories take a world handed to them the same way, whoever read it.
    const handed = new Stories().load({ stories: JSON.parse(JSON.stringify({ 'c-back': book })), storyArchive: JSON.parse(JSON.stringify({ 'c-back': [book] })) });
    const mine = handed.bookOf('c-back') as StoryBook;
    const put = handed.data.storyArchive['c-back'][0] as StoryBook;
    ok(Object.getPrototypeOf(mine.flags) === null && Object.getPrototypeOf(mine.quests!['test:a'].steps) === null && Object.getPrototypeOf(put.paid) === null, 'and so does the stories\' own copy of a world handed to them, archive and all');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- the change counter's mark --------------------------------------------------------------------------
{
  // The marks these two records had before there was a story at all, worked out by `characterMark` as it
  // stood at c7ee12c (`git show c7ee12c:src/net/session.ts`), the commit this pass began from. Comparing the
  // function with itself could never fail; comparing it with what it used to say is what pins that bringing
  // a browser up to date moves nobody's counter.
  const c = { name: 'Han', outfit: ['shirt_s03', 'pants_s01'], items: [{ kind: 'wear', id: 'a' }, { kind: 'weapon', id: 'b' }], held: { right: 'b' }, ships: { xwing: { paint: 3, parts: ['a', 'b'] } }, powers: ['push'], gadgets: [] as string[], saber: { color: 'blue' } };
  const BEFORE = '6ba586c14c5ee7eb';
  const BARE_BEFORE = '2209b08143d980c8';
  ok(characterMark(c) === BEFORE && characterMark({ name: 'Han' }) === BARE_BEFORE, `a character's mark is what it was before the pass (${characterMark(c)}, ${characterMark({ name: 'Han' })})`);
  ok(characterMark({ ...c, story: { local: 0 } }) === BEFORE && characterMark({ name: 'Han', story: { local: 0 } }) === BARE_BEFORE, 'and a character whose story was never played alone keeps exactly that mark');
  ok(characterMark({ ...c, story: { local: 1 } }) !== BEFORE, 'a change made alone is a change');
  ok(characterMark({ ...c, story: { local: 2 } }) !== characterMark({ ...c, story: { local: 1 } }), 'and so is the next one');
}
{
  // The settle that takes the count of changes made alone back to nought is not a change to the character:
  // the counter stays where it was, so a copy the server just refused does not win the next claim over it.
  const data: Record<string, string> = {};
  const s = new Session({ get: (k) => (k in data ? data[k] : null), set: (k, v) => void (data[k] = v) });
  const rec = { id: 'char-9', name: 'Han' };
  const about = { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' };
  s.noteCharacter({ ...rec, story: { local: 0 } }, about);
  s.noteCharacter({ ...rec, story: { local: 1 } });
  const offline = s.counterOf('char-9');
  ok(offline === 2, 'a waypoint set alone raises the counter');
  s.noteSettled({ ...rec, story: { local: 1 } }, { ...rec, story: { local: 0 } });
  ok(s.counterOf('char-9') === offline, 'the server settling the book does not');
  s.noteCharacter({ ...rec, story: { local: 0 } });
  ok(s.counterOf('char-9') === offline, 'and the mark it settled to is the one held, so noting the record again counts nothing');
  s.noteCharacter({ ...rec, story: { local: 1 } });
  s.noteSettled({ ...rec, name: 'Solo', story: { local: 1 } }, { ...rec, name: 'Solo', story: { local: 0 } });
  ok(s.counterOf('char-9') === offline + 2, 'while a settle with another change behind it that was never noted still counts that change');
}

// ---- where this browser keeps it ------------------------------------------------------------------------
function memory(fail = false): StoryStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      if (fail) return false;
      map.set(k, v);
      return true;
    },
    remove: (k) => void map.delete(k),
  };
}
{
  const s = memory();
  const b = emptyBook('char-1');
  applyChanges(b, [{ k: 'wpSet', wp: wp('w1', { name: 'Ã‰clair' }) }]);
  ok(saveBook(s, b) && [...s.map.keys()].includes('swg.story.char-1'), 'a book is kept under swg.story.<character>, apart from the character list');
  ok(/^[\x20-\x7e]*$/.test(s.map.get('swg.story.char-1')!), 'written as plain ASCII, every other character escaped');
  ok(loadBook(s, 'char-1')!.waypoints[0].name === 'Ã‰clair', 'and read back as it was');
  ok(loadBook(s, 'char-2') === null, 'another character has none');
  s.map.set('swg.story.char-3', '{nonsense');
  ok(loadBook(s, 'char-3') === null, 'and what is not a book reads as none rather than throwing');
  ok(!saveBook(memory(true), b), 'storage that will not take it says so, and the book stands for the session');
  for (let i = 0; i < 5; i++) setAside(s, b);
  ok(asides(s, 'char-1').length === ASIDE_KEPT && asides(s, 'char-1')[0] === 3, `copies set aside are kept, the last ${ASIDE_KEPT}`);
  ok(!s.map.has('swg.story.char-1.aside.1') && asideBook(s, 'char-1', 5)!.waypoints.length === 1, 'the oldest go, and what is kept reads back');
  // A server run with a larger cap of its own hands down a book past this browser's hundred, and what is
  // kept of it must read back whole, or a change made alone on top would hand the server a shorter book.
  s.map.set('swg.story.char-4', bookText({ ...emptyBook('char-4'), rev: 9, base: 9, waypoints: Array.from({ length: 150 }, (_, i) => wp(`w${i + 1}`)), nextWp: 151 }));
  ok(loadBook(s, 'char-4')!.waypoints.length === 150, `a server's book kept here reads back whole, past this browser's own ${BOOK_LIMITS.waypoints}`);
}

// ---- this browser's half, holding the book itself ----------------------------------------------------------
function client(line: Partial<StoryLine> = {}) {
  const store = memory();
  const sent: Record<string, unknown>[] = [];
  const said: string[] = [];
  let wall = 1000;
  const l: StoryLine = { authority: 'me', story: 0, status: 'off', mode: 'off', ...line };
  const c = new BookClient({ store, send: (m) => void sent.push(m), say: (t) => void said.push(t), now: () => 777, wall: () => wall, line: () => l, known: () => false });
  return { c, store, sent, said, l, tick: (ms: number) => (wall += ms), get wall() { return wall; } };
}
{
  const t = client();
  t.c.use('char-1');
  ok(t.c.host === 'local' && t.c.book!.char === 'char-1' && bookIsEmpty(t.c.book!), 'with no server this browser holds the book, a new one for a new character');
  let changed = 0;
  t.c.onChange(() => changed++);
  const r = t.c.addWaypoint(ask());
  ok(r.ok && r.id === 'w1' && t.c.book!.waypoints[0].made === 777, 'a waypoint set is applied here at once, with the host\'s id and the shared clock\'s time');
  ok(t.c.local === 1 && changed === 1 && t.sent.length === 0, 'it counts as a change made alone, tells its listeners, and sends nothing');
  ok(loadBook(t.store, 'char-1')!.waypoints.length === 1, 'and is kept at once');
  t.c.renameWaypoint('w1', 'Home');
  t.c.recolourWaypoint('w1', 'warn');
  t.c.switchWaypoint('w1', false);
  t.c.trackWaypoint('w1');
  ok(t.c.book!.waypoints[0].name === 'Home' && t.c.book!.waypoints[0].colour === 'warn' && !t.c.book!.waypoints[0].on && t.c.book!.trackWp === 'w1' && t.c.local === 5, 'renamed, recoloured, switched off and tracked, each a change of its own');
  ok(!t.c.recolourWaypoint('w1', 'void').ok && !t.c.renameWaypoint('w1', '   ').ok && !t.c.removeWaypoint('w9').ok, 'a colour that is not one, an empty name and a waypoint that is not there are refused, and say why');
  ok(t.c.removeWaypoint('w1').ok && t.c.book!.waypoints.length === 0 && t.c.book!.trackWp === null, 'and one is taken away');
  const before = t.c.local;
  for (let i = 0; i < 101; i++) t.c.addWaypoint(ask());
  ok(t.c.book!.waypoints.length === 100 && t.c.local === before + 100, 'a hundred are kept here too');
  ok(t.c.addWaypoint(ask()).why === 'a character keeps 100 waypoints', 'and the next is refused in words');
  t.c.use(null);
  ok(t.c.book === null, 'and with no character in play there is no book at all');
}

// ---- this browser's half, with a server holding the book (played here by the test) -----------------------
{
  const t = client({ authority: 'server', story: 1, status: 'online', mode: 'server' });
  t.store.set('swg.story.char-1', bookText({ ...emptyBook('char-1'), rev: 3, base: 2, local: 1, waypoints: Array.from({ length: 20 }, (_, i) => wp(`w${i + 1}`)), nextWp: 21 }));
  t.c.use('char-1');
  ok(t.c.host === 'held', 'with a server holding the story, nothing changes the book until it is settled');
  ok(!t.c.addWaypoint(ask()).ok && t.c.book!.waypoints.length === 20, 'so a waypoint asked for meanwhile is refused, and says the story is being settled or held');
  t.c.claimed(true);
  ok(t.sent.length === 0, 'a tie still waiting on the player says nothing yet');
  t.c.answered();
  const sync = t.sent.pop()!;
  ok(sync.do === 'sync' && sync.has === 1 && sync.base === 2 && sync.local === 1 && sync.known === 1, 'once it is answered, the browser says what its copy holds: something, matched at 2, one change since, and that a server held it before');
  // The server asks for it: it goes up in pieces, the first at once.
  t.c.word({ t: 'story', do: 'want', chunk: 1000 });
  const text = bookText(t.c.book);
  const pieces = chunkText(text, 1000).length;
  ok(pieces > 2 && t.sent.length === 1 && t.sent[0].do === 'offer' && t.sent[0].n === 0 && t.sent[0].of === pieces, `the server asks for this copy and the first piece of ${pieces} goes at once`);
  t.tick(STORY_TUNE.chunkGap - 1);
  t.c.step(t.wall);
  ok(t.sent.length === 1, 'the next waits its gap');
  for (let i = 1; i < pieces; i++) {
    t.tick(STORY_TUNE.chunkGap);
    t.c.step(t.wall);
  }
  const up = t.sent.filter((m) => m.do === 'offer').map((m) => String(m.part)).join('');
  ok(up === text, 'and every piece goes up in order, a gap apart, to make the book again');
  // The server took it, and hands back what it wrote.
  const taken = bookText({ ...cleanBook(JSON.parse(text))!, rev: 4, local: 0, base: 0 });
  t.c.word({ t: 'story', do: 'book', id: 1, n: 0, of: 1, part: taken, take: 'browser' });
  ok(t.c.host === 'server' && t.c.book!.rev === 4 && t.c.book!.base === 4 && t.c.local === 0, 'the server\'s answer is this browser\'s copy from now on: matched at its revision, no changes of its own');
  ok(asides(t.store, 'char-1').length === 0, 'and nothing is set aside, because nothing was lost');
  // Changes are asked for and shown when the server's batch comes back.
  t.sent.length = 0;
  const r = t.c.addWaypoint(ask({ name: 'Two' }));
  ok(r.ok && r.sent && t.sent.length === 1 && t.sent[0].do === 'wp' && t.sent[0].op === 'set' && t.c.book!.waypoints.length === 20, 'with the server holding the book a waypoint is asked for and not shown yet');
  t.c.word({ t: 'story', do: 'ch', rev: 5, ch: [{ k: 'wpSet', wp: { ...ask({ name: 'Two' }), id: 'w21', made: 9 } }] });
  ok(t.c.book!.waypoints.length === 21 && t.c.book!.rev === 5 && t.c.local === 0, 'and is shown when the server\'s batch comes back at the next revision');
  t.sent.length = 0;
  t.c.word({ t: 'story', do: 'ch', rev: 7, ch: [] });
  ok(t.sent.length === 1 && t.sent[0].do === 'sync' && t.c.host === 'held', 'a batch past the next revision is a gap: the book is asked for again and held meanwhile');
  t.c.word({ t: 'story', do: 'book', id: 2, n: 0, of: 1, part: bookText({ ...t.c.book!, rev: 7 }), take: 'server' });
  ok(t.c.host === 'server' && t.c.book!.rev === 7, 'and settled again by the server\'s book');
  // More waypoint words than the allowance wait their turn rather than being refused.
  t.sent.length = 0;
  t.tick(1000);
  for (let i = 0; i < 5; i++) t.c.switchWaypoint('w1', i % 2 === 0);
  ok(t.sent.length === STORY_TUNE.wpPerSecond, `${STORY_TUNE.wpPerSecond} waypoint words go at once`);
  t.tick(1000);
  t.c.step(t.wall);
  ok(t.sent.length === 5, 'and the rest the next second');
  // The line drops: held until it is back and settled again.
  t.l.authority = 'me';
  t.l.status = 'reconnecting';
  t.l.mode = 'off';
  t.c.step(t.wall);
  ok(t.c.host === 'held' && !t.c.addWaypoint(ask()).ok, 'a line that drops holds the book: nothing changes it while the server is not answering');
  t.l.status = 'off';
  t.c.step(t.wall);
  ok(t.c.host === 'local' && t.c.addWaypoint(ask()).ok && t.c.local === 1, 'a line put down hands the book back to this browser, from the copy it had, and changes count as its own again');
}
{
  // Played in two places: the server's copy stands and this one is set aside, never thrown away.
  const t = client({ authority: 'server', story: 1, status: 'online', mode: 'server' });
  t.c.use('char-1');
  t.l.authority = 'me';
  t.l.status = 'off';
  t.c.step(t.wall);
  t.c.addWaypoint(ask());
  t.l.authority = 'server';
  t.l.status = 'online';
  t.c.claimed(false);
  ok(t.sent.at(-1)!.do === 'sync' && t.sent.at(-1)!.local === 1, 'a copy changed alone says so when the line is back');
  t.c.word({ t: 'story', do: 'book', id: 1, n: 0, of: 1, part: bookText(emptyBook('char-1')), take: 'server' });
  ok(asides(t.store, 'char-1').length === 1 && asideBook(t.store, 'char-1', 1)!.waypoints.length === 1, 'the server\'s copy stands and this browser\'s is kept aside, waypoint and all');
  ok(t.said.some((s) => /played in two places/.test(s)) && bookIsEmpty(t.c.book!), 'the player is told so, and the book is the server\'s');
}
{
  // A settle says it is one, with the count of changes made alone it took back to nought: the wiring tells
  // the session so, and the change counter is not raised for a record that moved only by coming to agree.
  const t = client({ authority: 'server', story: 1, status: 'online', mode: 'server' });
  t.store.set('swg.story.char-1', bookText({ ...emptyBook('char-1'), rev: 3, base: 3, local: 2, waypoints: [wp('w1')], nextWp: 2 }));
  const heard: string[] = [];
  t.c.onChange((why, was) => void heard.push(`${why}:${was}`));
  t.c.use('char-1');
  t.c.claimed(false);
  t.c.word({ t: 'story', do: 'book', id: 1, n: 0, of: 1, part: bookText({ ...emptyBook('char-1'), rev: 5, waypoints: [wp('w1')], nextWp: 2 }), take: 'browser' });
  ok(heard.join() === 'use:2,settled:2' && t.c.local === 0, `the listeners hear a book read in, then a settle that took two changes made alone back to nought (${heard.join()})`);
}
{
  // Every waypoint taken away while playing alone: a story with nothing left in it, not a cleared cache.
  const t = client({ authority: 'server', story: 1, status: 'online', mode: 'server' });
  t.store.set('swg.story.char-1', bookText({ ...emptyBook('char-1'), rev: 3, base: 3, local: 1, waypoints: [], nextWp: 2 }));
  t.c.use('char-1');
  t.c.claimed(false);
  const sync = t.sent.at(-1)!;
  ok(sync.do === 'sync' && sync.has === 1 && sync.local === 1, 'a book emptied by hand says it has a story to offer, so a server the character settled for can ask for it');
  t.c.word({ t: 'story', do: 'book', id: 1, n: 0, of: 1, part: bookText({ ...emptyBook('char-1'), rev: 3, waypoints: [wp('w1')], nextWp: 2 }), take: 'server' });
  ok(asides(t.store, 'char-1').length === 1 && bookIsEmpty(asideBook(t.store, 'char-1', 1)!) && t.said.some((s) => /played in two places/.test(s)), 'and when the server\'s copy stands instead, the emptied one is set aside and the player told, like any other');
  ok(t.c.book!.waypoints.length === 1, 'the book being the server\'s');
  const u = client({ authority: 'server', story: 1, status: 'online', mode: 'server' });
  u.c.use('char-2');
  u.c.claimed(false);
  ok(u.sent.at(-1)!.do === 'sync' && u.sent.at(-1)!.has === 0, 'while a book this browser never changed, with nothing in it, has nothing to offer');
}
{
  // A sync goes only on a line the server has claimed, and is asked again when it is not answered; one
  // waiting when the line dropped is forgotten with it, and a book that answers nothing outstanding is
  // never taken -- or a sync left over from the last line could settle the book before a tie on this one
  // had been answered.
  const t = client({ authority: 'server', story: 1, status: 'online', mode: 'server' });
  t.c.use('char-1');
  t.c.claimed(false);
  ok(t.sent.length === 1 && t.sent[0].do === 'sync', 'a claim answered says what this copy holds');
  t.tick(STORY_TUNE.syncWait + 1);
  t.c.step(t.wall);
  ok(t.sent.length === 2 && t.sent[1].do === 'sync', `and says it again when nothing has answered within ${STORY_TUNE.syncWait} ms`);
  t.l.authority = 'me';
  t.l.status = 'reconnecting';
  t.l.mode = 'off';
  t.c.step(t.wall);
  t.tick(STORY_TUNE.syncWait * 3);
  t.c.step(t.wall);
  ok(t.sent.length === 2 && t.c.host === 'held', 'the line drops: the book is held and nothing is said while it comes back');
  t.l.status = 'online';
  t.l.mode = 'server';
  t.tick(STORY_TUNE.syncWait * 3);
  t.c.step(t.wall);
  ok(t.sent.length === 2, 'nor once the line is open again and the server has still to answer the claim');
  t.c.word({ t: 'story', do: 'book', id: 9, n: 0, of: 1, part: bookText({ ...emptyBook('char-1'), rev: 8, waypoints: [wp('w1')], nextWp: 2 }), take: 'server' });
  ok(t.c.book!.waypoints.length === 0 && t.c.host === 'held', 'a book that answers no question outstanding is not taken');
  t.l.authority = 'server';
  t.c.claimed(true);
  const refused = t.c.addWaypoint(ask());
  ok(t.sent.length === 2 && !refused.ok && /being settled/.test(refused.why ?? ''), 'claimed with a tie still waiting on the player: still nothing said, and a change is refused as being settled');
  t.c.answered();
  ok(t.sent.length === 3 && t.sent[2].do === 'sync', 'until the tie is answered, and then the book is settled');
}
{
  // An old relay, or a server whose hail says nothing of a story: this browser holds the book.
  const t = client({ authority: 'server', story: 0, status: 'online', mode: 'server' });
  t.c.use('char-1');
  t.c.claimed(false);
  ok(t.c.host === 'local' && t.sent.length === 0 && t.c.addWaypoint(ask()).ok, 'a server whose hail carries no story never hears a story word, and this browser holds the book');
  const r = client({ authority: 'me', story: 0, status: 'online', mode: 'relay' });
  r.c.use('char-1');
  ok(r.c.host === 'local', 'and so does the relay that came before');
}

console.log(`\n${checks} checks passed`);
