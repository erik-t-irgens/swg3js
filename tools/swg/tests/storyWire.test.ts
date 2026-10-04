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
import { Reassembly, STORY_WIRE, bookText, chunkText, cleanStoryWord, storyHailVersion } from '../../../src/story/storyWire.ts';
import { emptyBook } from '../../../src/story/book.ts';

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

// ---- the hail ---------------------------------------------------------------------------------------------
{
  ok(storyHailVersion({ v: 1, sets: [], tests: 0 }) === 1, 'a hail that carries a story says which');
  ok(storyHailVersion(undefined) === 0 && storyHailVersion({ v: '1' }) === 0 && storyHailVersion({ v: -2 }) === 0 && storyHailVersion([]) === 0, 'and one that carries none, or nonsense, holds none');
}

console.log(`\n${checks} checks passed`);
