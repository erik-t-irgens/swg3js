// The story book through a real relay: settling a character's book the way the rest of the character is
// settled, ids the server gives, the archive, the empty-book guard, a log played back on start to the
// same book -- and the browser's own stack (the socket, the session and the book) against it, end to end.
//
// The pieces each have tests of their own (storyBook.test.ts, storyWire.test.ts, store.test.ts). What they
// cannot see is the glue: that a story word reaches its handler at all and only from a line that holds its
// character; that the relay keeps how the character settled on the line, which it never did, and reads it
// when the book settles; that a tie answered changes it; that a book handed up in pieces is taken whole and
// what it replaced is archived; and that a server started again from what it wrote down hands out the
// same book. That is run here against the relay itself, on a port of its own and a world in a temp
// folder, with plain sockets standing in for browsers -- and then with the browser's own `Net`, `Session`
// and `BookClient`, which is the only way to know the words get through `src/net/net.ts` at all.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const note = (msg: string): void => console.log(`     ${msg}`);

type Msg = Record<string, unknown>;

if (typeof WebSocket === 'undefined') {
  note('the relay round trip was skipped: this node has no WebSocket of its own');
} else {
  const { randomBytes } = await import('node:crypto');
  const { playerIdFor, proofFor, verifierFor } = await import('../../../server/identity.mjs');
  const { STORY_TUNING } = await import('../../../server/stories.mjs');
  const { bookText, chunkText } = await import('../../../src/story/storyWire.ts');
  const { emptyBook, cleanBook } = await import('../../../src/story/book.ts');
  const dir = mkdtempSync(join(tmpdir(), 'swg-story-relay-'));
  const port = 18797;
  process.env.PORT = String(port);
  // Its world goes in the temp folder and never in `server/data`, which is somebody's real world. A tie
  // nobody answers is answered by the server in two and a half seconds rather than a minute, so the test
  // can wait for it; and a line taken over by a newer browser is left open a second and a half before it
  // is closed, so what it says in that time reaches the relay and the relay's own refusal is what is seen.
  process.argv.push(`--data=${dir}`, '--set=settle.wait=2500', '--set=close.grace=1500');
  await import('../../../server/relay.mjs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const settle = () => wait(150);
  // A `sync` is answered with the whole book, so the server takes one a second from a line: a test that
  // syncs twice on one line waits that long between.
  const syncGap = () => wait(1100);
  const status = async (p = port) => (await (await fetch(`http://127.0.0.1:${p}/`)).json()) as { stories: Record<string, number> };

  type Browser = Awaited<ReturnType<typeof connect>>;
  /** A browser: a key of its own (or one handed in, to be the same player again), its character, and what it heard. */
  async function connect(name: string, character: string, o: { counter?: number; planet?: string; key?: Uint8Array; claim?: boolean; at?: number } = {}) {
    const key = o.key ?? new Uint8Array(randomBytes(32));
    const ws = new WebSocket(`ws://127.0.0.1:${o.at ?? port}`);
    const got: Msg[] = [];
    let nonce = '';
    await new Promise<void>((done, fail) => {
      ws.addEventListener('open', () => done());
      ws.addEventListener('error', () => fail(new Error(`${name} could not connect`)));
    });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String((e as MessageEvent).data)) as Msg;
      if (m.t === 'hail') nonce = String(m.nonce ?? '');
      got.push(m);
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    await settle();
    const planet = o.planet ?? 'tatooine';
    if (o.claim !== false) {
      send({ t: 'claim', player: playerIdFor(key), key: verifierFor(key), proof: proofFor(verifierFor(key), nonce), character, name, counter: o.counter ?? 1, about: { species: 'human_male', class: 'jedi', planet, zone: '' } });
      await settle();
    }
    send({ t: 'hello', name, species: 'human_male', class: 'jedi', planet, v: 5 });
    await settle();
    const story = (pick: (m: Msg) => boolean = () => true) => got.filter((m) => m.t === 'story' && pick(m));
    return {
      key,
      got,
      send,
      close: () => ws.close(),
      isOpen: () => ws.readyState === WebSocket.OPEN,
      last: (t: string, pick: (m: Msg) => boolean = () => true) => [...got].reverse().find((m) => m.t === t && pick(m)),
      story,
      /** Forget what has been heard, so the next answer is the only one. */
      clear: () => void (got.length = 0),
      sync: (has: number, local: number, base = 0, known = 0) => send({ t: 'story', do: 'sync', has, base, local, known }),
      /** The last whole book the server handed down, and whose copy it said stood. */
      book: () => {
        const pieces = story((m) => m.do === 'book');
        if (!pieces.length) return null;
        const id = pieces[pieces.length - 1].id;
        const mine = pieces.filter((m) => m.id === id).sort((a, b) => Number(a.n) - Number(b.n));
        if (mine.length !== Number(mine[0].of)) return null;
        return { book: JSON.parse(mine.map((m) => String(m.part)).join('')) as Record<string, unknown> & { waypoints: { id: string; name: string; made: number }[]; rev: number; nextWp: number }, take: String(mine[0].take), pieces: mine.length };
      },
      /** Hand a book up in pieces of `size`, as the browser does when it is asked. */
      offer: async (book: unknown, size: number, known = 0) => {
        const parts = chunkText(bookText(book), size);
        for (let n = 0; n < parts.length; n++) send({ t: 'story', do: 'offer', id: 1, n, of: parts.length, part: parts[n], known });
        await settle();
      },
    };
  }
  const wpAsk = (name: string) => ({ name, world: 'tatooine', f: 'raw', p: [3407, -4587, null] });
  const aBook = (char: string, names: string[], rev = 3) => ({ ...emptyBook(char), rev, local: names.length, waypoints: names.map((n, i) => ({ id: `w${i + 1}`, ...wpAsk(n), colour: 'accent', on: true, made: 1 })), nextWp: names.length + 1 });

  const opened: Browser[] = [];
  const open = async (...args: Parameters<typeof connect>) => {
    const b = await connect(...args);
    opened.push(b);
    return b;
  };

  try {
    // ---- the hail --------------------------------------------------------------------------------------------
    const a = await open('Han', 'c-a');
    const hail = a.last('hail') as Msg;
    ok(hail.v === 5 && (hail.story as Msg)?.v === 1 && Array.isArray((hail.story as Msg).sets) && (hail.story as Msg).tests === 0, `the relay speaks the fifth wire and its hail says it holds a story (${JSON.stringify(hail.story)})`);
    ok(a.got.filter((m) => m.t === 'welcome').length === 1, 'and the welcome is still sent once and only once');

    // ---- a character the server has never seen ---------------------------------------------------------------
    a.sync(0, 0);
    await settle();
    let got = a.book();
    ok(!!got && got.take === 'server' && got.book.char === 'c-a' && got.book.waypoints.length === 0 && got.book.rev === 0, 'a browser with nothing is given a new, empty book');

    // ---- ids are the server's ---------------------------------------------------------------------------------
    a.clear();
    a.send({ t: 'story', do: 'wp', op: 'set', wp: { ...wpAsk('Cantina'), id: 'w999', made: 1 } });
    await settle();
    a.send({ t: 'story', do: 'wp', op: 'set', wp: wpAsk('Docking bay') });
    await settle();
    const ch = a.story((m) => m.do === 'ch') as { rev: number; ch: { k: string; wp: { id: string; made: number } }[] }[];
    ok(ch.length === 2 && ch[0].ch[0].wp.id === 'w1' && ch[1].ch[0].wp.id === 'w2', `the server gives each waypoint its id from the book's own counter, whatever the browser said (${ch.map((c) => c.ch[0].wp.id).join(', ')})`);
    ok(ch[0].rev === 1 && ch[1].rev === 2 && ch[0].ch[0].wp.made > 1, 'each batch comes back at the revision it made, with the server\'s own time');
    a.send({ t: 'story', do: 'wp', op: 'edit', wp: { id: 'w1', colour: 'warn' } });
    a.send({ t: 'story', do: 'wp', op: 'gone', wp: { id: 'w9' } });
    await settle();
    ok((a.last('story', (m) => m.do === 'ch') as { rev: number }).rev === 3 && /no such/.test(String((a.last('story', (m) => m.do === 'no') as Msg)?.why)), 'a recolour is taken, and taking away a waypoint that is not there is refused in words');
    await wait(1100);
    a.clear();
    for (let i = 0; i < 6; i++) a.send({ t: 'story', do: 'wp', op: i % 2 ? 'on' : 'off', wp: { id: 'w2' } });
    await settle();
    ok(a.story((m) => m.do === 'ch').length === STORY_TUNING.wpRate && a.story((m) => m.do === 'no').length === 6 - STORY_TUNING.wpRate, `no more than ${STORY_TUNING.wpRate} waypoint words a second are taken, and the rest are refused in words`);

    // ---- the first copy handed up -----------------------------------------------------------------------------
    const b = await open('Leia', 'c-b');
    b.sync(1, 2);
    await settle();
    const want = b.last('story', (m) => m.do === 'want');
    ok(!!want && want.chunk === STORY_TUNING.offerChunk && !b.book(), 'a browser with a book of its own the server has never seen is asked for it, with the size of piece to cut it into');
    const upPieces = chunkText(bookText(aBook('c-b', ['Theed', 'Keren'])), 120).length;
    await b.offer(aBook('c-b', ['Theed', 'Keren']), 120);
    got = b.book();
    ok(upPieces > 1 && !!got && got.take === 'browser' && got.book.waypoints.map((w) => w.name).join() === 'Theed,Keren' && got.book.rev === 4, `its copy is taken whole from its ${upPieces} pieces and handed back at a revision past it`);
    ok(got!.book.local === 0 && got!.book.nextWp === 3, 'with nothing counted as made alone, and the counter past the ids it holds');
    const c = await open('Lando', 'c-c');
    c.send({ t: 'story', do: 'offer', id: 1, n: 0, of: 1, part: bookText(aBook('c-c', ['Unasked'])) });
    await settle();
    c.sync(0, 0);
    await settle();
    ok(c.book()!.book.waypoints.length === 0, 'a book nobody asked for is never taken');

    // ---- the verdict matrix -------------------------------------------------------------------------------------
    // c-a's book holds Cantina and Docking bay, written down at counter 1.
    a.close();
    await settle();
    // Newer, and changed alone: the browser's copy is asked for, and the server's archived.
    let r = await open('Han', 'c-a', { key: a.key, counter: 2 });
    ok((r.last('claimed') as Msg).keep === 'browser', 'a copy with the higher counter settles the browser\'s way');
    const archivedBefore = (await status()).stories.archived;
    r.sync(1, 1, 3);
    await settle();
    ok(!!r.last('story', (m) => m.do === 'want'), '...and changed with nobody holding it: the browser\'s book is asked for');
    await r.offer(aBook('c-a', ['Offline']), 24000);
    got = r.book();
    ok(!!got && got.take === 'browser' && got.book.waypoints.length === 1 && got.book.waypoints[0].name === 'Offline', 'and taken whole, never merged with what it replaces');
    ok((await status()).stories.archived === archivedBefore + 1, 'the book it replaced is archived, whole');
    r.close();
    await settle();
    // Newer, but nothing changed alone: the server's stands.
    r = await open('Han', 'c-a', { key: a.key, counter: 3 });
    r.sync(1, 0, 4);
    await settle();
    got = r.book();
    ok((r.last('claimed') as Msg).keep === 'browser' && !!got && got.take === 'server' && !r.last('story', (m) => m.do === 'want'), 'newer but changed by nobody here: the server\'s copy is handed down and nothing is asked for');
    r.close();
    await settle();
    // Older: the server's stands whatever the browser changed.
    r = await open('Han', 'c-a', { key: a.key, counter: 1 });
    r.sync(1, 5);
    await settle();
    ok((r.last('claimed') as Msg).keep === 'server' && r.book()?.take === 'server' && !r.last('story', (m) => m.do === 'want'), 'an older copy changed alone is not taken: the server\'s stands and is handed down');
    r.close();
    await settle();
    // The same counter and the same story: the server's.
    r = await open('Han', 'c-a', { key: a.key, counter: 3 });
    r.sync(1, 2);
    await settle();
    ok((r.last('claimed') as Msg).keep === 'same' && r.book()?.take === 'server', 'the same counter and the same story: the server\'s stands');
    r.close();
    await settle();
    // A tie: the server's stands until it is answered, and the answer is the verdict after.
    r = await open('Han', 'c-a', { key: a.key, counter: 3, planet: 'naboo' });
    ok((r.last('claimed') as Msg).keep === 'ask' && !!r.last('settle'), 'the same counter and a different story is a tie, put to the player');
    r.sync(1, 1);
    await settle();
    ok(r.story().length === 0, 'a sync before the tie is answered is not answered at all: nothing is settled until the player says which copy stands');
    r.send({ t: 'settle', character: 'c-a', take: 'browser' });
    await syncGap();
    r.clear();
    r.sync(1, 1);
    await settle();
    ok(!!r.last('story', (m) => m.do === 'want'), 'answered the browser\'s way, the browser\'s book is asked for: the relay kept the answer on the line');
    // The empty-book guard: an empty copy from a browser that believes the server holds it is a cleared cache.
    const guarded = (await status()).stories.guarded;
    await r.offer(emptyBook('c-a'), 24000, 1);
    got = r.book();
    ok(!!got && got.take === 'server' && got.book.waypoints.length === 1 && got.book.waypoints[0].name === 'Offline', 'an empty book from a browser that says a server held it before is never written over the server\'s');
    ok((await status()).stories.guarded === guarded + 1, 'and the status page counts it');
    await syncGap();
    r.clear();
    r.sync(1, 1);
    await settle();
    await r.offer(emptyBook('c-a'), 24000, 0);
    ok(r.book()?.take === 'browser' && r.book()!.book.waypoints.length === 0, 'while an empty book from a browser that knows of no server before is a story with nothing in it, and taken');
    await syncGap();
    r.clear();
    r.sync(1, 3);
    await settle();
    await r.offer({ ...emptyBook('c-a'), local: 3, rev: 9 }, 24000, 1);
    ok(r.book()?.take === 'browser' && r.book()!.book.waypoints.length === 0 && (await status()).stories.guarded === guarded + 1, 'and so is one from a browser that knows of a server, when it counts the changes that emptied it: a story with every waypoint taken away is not a cleared cache');
    r.close();
    await settle();

    // ---- refusals, and the ways back from them ----------------------------------------------------------------
    // A book past what the server takes is refused in words, and the server's own is handed down.
    const offerMaxWas = STORY_TUNING.offerMax;
    STORY_TUNING.offerMax = 2000;
    try {
      const big = await open('Bossk', 'c-big');
      big.sync(1, 3);
      await settle();
      const huge = aBook('c-big', Array.from({ length: 40 }, (_, i) => `Mark ${i}`));
      ok(bookText(huge).length > STORY_TUNING.offerMax && !!big.last('story', (m) => m.do === 'want'), `a browser with a book of ${bookText(huge).length} characters is asked for it`);
      await big.offer(huge, 1000);
      ok(/larger/.test(String(big.last('story', (m) => m.do === 'no')?.why)) && big.book()?.take === 'server' && big.book()!.book.waypoints.length === 0, `and a book past the ${STORY_TUNING.offerMax} the server takes is refused in words, with the server's own handed down`);
    } finally {
      STORY_TUNING.offerMax = offerMaxWas;
    }
    // Pieces that are not a book at all: refused in words, and the server's own handed down.
    const junk = await open('Boba', 'c-junk');
    junk.sync(1, 1);
    await settle();
    junk.send({ t: 'story', do: 'offer', id: 1, n: 0, of: 2, part: '{not a ' });
    junk.send({ t: 'story', do: 'offer', id: 1, n: 1, of: 2, part: 'book' });
    await settle();
    ok(/could not be read/.test(String(junk.last('story', (m) => m.do === 'no')?.why)) && junk.book()?.take === 'server', 'pieces that make no book are refused in words, and the server\'s own is handed down');
    // Pieces that stop coming: given up within a second of the wait, and the browser told, so it asks again.
    const offerWaitWas = STORY_TUNING.offerWait;
    STORY_TUNING.offerWait = 500;
    try {
      const slow = await open('Dengar', 'c-slow');
      slow.sync(1, 1);
      await settle();
      slow.send({ t: 'story', do: 'offer', id: 1, n: 0, of: 3, part: '{"v":1,' });
      await wait(STORY_TUNING.offerWait + 1600);
      ok(/stopped coming/.test(String(slow.last('story', (m) => m.do === 'no')?.why)) && !slow.book(), 'a book whose pieces stop coming is given up and its browser told, with nothing taken');
      slow.send({ t: 'story', do: 'offer', id: 1, n: 1, of: 3, part: '"char"' });
      await settle();
      ok(!slow.book() && slow.story((m) => m.do === 'no').length === 1, 'and a piece of it that comes late is nobody\'s to take');
    } finally {
      STORY_TUNING.offerWait = offerWaitWas;
    }
    // A sync is answered with the whole book, so one line is answered once a second.
    const rate = await open('IG-88', 'c-rate');
    rate.sync(0, 0);
    rate.sync(0, 0);
    await settle();
    const ids = new Set(rate.story((m) => m.do === 'book').map((m) => m.id));
    ok(ids.size === STORY_TUNING.syncRate, `two syncs inside a second are answered ${STORY_TUNING.syncRate === 1 ? 'once' : `${STORY_TUNING.syncRate} times`}`);
    await syncGap();
    rate.sync(0, 0);
    await settle();
    ok(new Set(rate.story((m) => m.do === 'book').map((m) => m.id)).size === ids.size + 1, 'and the next second\'s is answered again');
    // A taken book's rewards: the ones the browser paid are marked as its own, the ones a server paid keep saying so.
    const paidBy = await open('Zuckuss', 'c-paid');
    paidBy.sync(1, 1);
    await settle();
    await paidBy.offer({ ...aBook('c-paid', ['Paid']), paid: { 'own:a#1#done': { at: 5 }, 'own:b#1#done': { at: 6, by: 'server' }, 'own:c#1#done': { at: 7, by: 'browser' } } }, 24000);
    const paidRows = (paidBy.book()?.book.paid ?? {}) as Record<string, { by?: string }>;
    ok(paidBy.book()?.take === 'browser' && paidRows['own:a#1#done']?.by === 'browser' && paidRows['own:c#1#done']?.by === 'browser' && paidRows['own:b#1#done']?.by === 'server', 'a taken book\'s rewards the browser paid are marked as the browser\'s, and one the server paid keeps saying so');

    // ---- only a line that holds the character speaks for it ---------------------------------------------------
    const stranger = await open('Greedo', '', { claim: false });
    stranger.sync(0, 0);
    stranger.send({ t: 'story', do: 'wp', op: 'set', wp: wpAsk('Nowhere') });
    await settle();
    ok(stranger.story().length === 0, 'a browser that has not said which character it plays has no story here and hears nothing');
    const older = await open('Leia', 'c-b', { key: b.key, counter: 5 });
    const newer = await open('Leia', 'c-b', { key: b.key, counter: 5 });
    ok(!!older.last('taken'), 'the same character opened in a second browser takes it from the first');
    older.clear();
    ok(older.isOpen(), 'whose line is still open for a moment after it is told');
    older.sync(0, 0);
    older.send({ t: 'story', do: 'wp', op: 'set', wp: wpAsk('Not yours now') });
    await settle();
    ok(older.isOpen() && older.story().length === 0, 'and in that moment, with its line still open, the first no longer speaks for its story: what it says is not answered');
    newer.sync(0, 0);
    await settle();
    ok(newer.book()?.book.waypoints.length === 2, 'while the newer one does, and is handed the book');

    // ---- the browser's own stack, end to end ----------------------------------------------------------------
    // `Net`, `Session` and `BookClient` exactly as the game builds them, with a window and a storage of the
    // test's: every story word the relay says reaches the book through `src/net/net.ts`'s own switch.
    const shelf = new Map<string, string>();
    const g = globalThis as unknown as Record<string, unknown>;
    g.localStorage = { getItem: (k: string) => shelf.get(k) ?? null, setItem: (k: string, v: string) => void shelf.set(k, String(v)), removeItem: (k: string) => void shelf.delete(k) };
    g.window = { setTimeout, clearTimeout, setInterval, clearInterval };
    const { Net } = await import('../../../src/net/net.ts');
    const { BookClient } = await import('../../../src/story/bookClient.ts');
    const { browserStoryStorage } = await import('../../../src/story/storyStore.ts');
    const net = new Net();
    const said: string[] = [];
    const story = new BookClient({
      store: browserStoryStorage(),
      send: (m) => net.sendWord(m),
      say: (t) => void said.push(t),
      now: () => Date.now(),
      wall: () => Date.now(),
      line: () => ({ authority: net.session.authority, story: net.session.storyVersion, status: net.status, mode: net.session.mode }),
      known: () => false,
    });
    const about = { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' };
    const record = { id: 'c-net', name: 'Wedge' };
    const noteCharacter = () => net.session.noteCharacter({ ...record, story: { local: story.local } }, about);
    // Wired as the game wires it (src/main.ts): the purse's listener and the ledger's stand in the same
    // list ahead of and behind the book's, which is the list that was one slot before this pass.
    const claimedHeard: string[] = [];
    net.session.onClaimed((keep) => void claimedHeard.push(`first:${keep}`));
    net.session.onClaimed(() => story.claimed(!!net.session.ask));
    net.session.onClaimed((keep) => void claimedHeard.push(`last:${keep}`));
    net.session.onAnswered(() => story.answered());
    const shown: unknown[] = [];
    net.session.onAsk = (a) => {
      if (a) shown.push(a);
    };
    net.onWord = (m) => {
      if (m.t === 'story') story.word(m);
    };
    story.onChange((why, was) => {
      if (why === 'settled') net.session.noteSettled({ ...record, story: { local: was } }, { ...record, story: { local: story.local } });
      else noteCharacter();
    });
    // The change counter, as this browser keeps it, put where a test needs it: the same number as the
    // server's copy with a different planet is a tie, and an answer forgotten makes it a fresh question.
    type Count = { n: number; mark: string; where?: string; ans?: unknown };
    const setCounter = (n: number, forget = false) => {
      const o = JSON.parse(shelf.get('swg.charrev') ?? '{}') as Record<string, Count>;
      o['c-net'].n = n;
      if (forget) delete o['c-net'].ans;
      shelf.set('swg.charrev', JSON.stringify(o));
    };
    const go = () => net.connect(`ws://127.0.0.1:${port}`, { name: 'Wedge', species: 'human_male', class: 'jedi', planet: about.planet });
    const stepper = setInterval(() => story.step(Date.now()), 100);
    const until = async (what: () => boolean, ms = 4000) => {
      for (let t = 0; t < ms && !what(); t += 50) await wait(50);
      return what();
    };
    try {
      story.use('c-net');
      noteCharacter();
      ok(story.host === 'local' && story.addWaypoint(wpAsk('Kept alone')).ok && story.addWaypoint(wpAsk('And another')).ok && story.local === 2, 'with no server the browser holds the book and two waypoints set alone count as two changes');
      const counterAlone = net.session.counterOf('c-net');
      net.connect(`ws://127.0.0.1:${port}`, { name: 'Wedge', species: 'human_male', class: 'jedi', planet: 'tatooine' });
      ok(await until(() => story.host === 'server'), `connected, the story is settled and held by the server (${JSON.stringify(story.report())})`);
      ok(story.book!.waypoints.map((w) => w.name).join() === 'Kept alone,And another' && story.local === 0 && story.book!.base === story.book!.rev, 'the two made alone went up and came back as the server\'s, with nothing left counted as made alone');
      const sent = story.addWaypoint(wpAsk('Set on the server'));
      ok(sent.ok && sent.sent === true, 'a waypoint set now is asked of the server');
      ok(await until(() => story.book!.waypoints.length === 3), 'and shows when the server\'s batch comes back through the socket\'s own switch');
      ok(story.book!.waypoints[2].id === 'w3', `with the server's own id (${story.book!.waypoints[2].id})`);
      // Put the line down, change the book alone, and come back: the change is the server's afterwards.
      net.disconnect();
      ok(await until(() => story.host === 'local'), 'the line put down hands the book back to this browser');
      story.addWaypoint(wpAsk('Offline again'));
      ok(story.local === 1 && net.session.counterOf('c-net') > counterAlone, `one change made alone is counted, and the character's counter rose with it (${counterAlone} to ${net.session.counterOf('c-net')})`);
      // What the claim is about to carry, which is what the server writes down for the character.
      const S = net.session.counterOf('c-net');
      net.connect(`ws://127.0.0.1:${port}`, { name: 'Wedge', species: 'human_male', class: 'jedi', planet: 'tatooine' });
      ok(await until(() => story.host === 'server' && story.local === 0), 'back on the server, the book settles the browser\'s way');
      ok(story.book!.waypoints.length === 4 && story.book!.waypoints[3].name === 'Offline again', 'and the server\'s book now has the waypoint set while it was away');
      ok(said.length === 0, 'with nothing set aside and nothing said');
      ok(net.session.counterOf('c-net') === S, `and the settle, which took the count of changes made alone back to nought, did not raise the character's counter past what the server wrote down (${S})`);
      ok(claimedHeard.join() === 'first:browser,last:browser,first:browser,last:browser', `every listener on the claim is told, in the order it was added (${claimedHeard.join()})`);
      net.disconnect();
      ok(await until(() => story.host === 'local'), 'put down again');

      // ---- a tie, through the real session: the book waits for the answer, whichever way it comes ----
      // The player keeps this browser's copy. A waypoint set alone, then the same counter as the server's
      // copy and another planet: a tie, put to the player, and nothing of the book is settled until they say.
      story.addWaypoint(wpAsk('Kept through a tie'));
      about.planet = 'naboo';
      noteCharacter();
      setCounter(S);
      const syncsBefore = story.stats.syncs;
      claimedHeard.length = 0;
      go();
      ok(await until(() => !!net.session.ask && net.session.authority === 'server'), 'the same counter and another planet is a tie, put to the player');
      ok(claimedHeard.join() === 'first:ask,last:ask' && story.host === 'held' && story.stats.syncs === syncsBefore, 'the claim is answered, both listeners hear it, and the book says nothing while the question stands');
      ok(!story.addWaypoint(wpAsk('Too soon')).ok, 'nor may it be changed meanwhile');
      net.session.resolveAsk('browser');
      ok(await until(() => story.host === 'server' && story.local === 0), 'answered the browser\'s way, the book is settled');
      ok(story.book!.waypoints.length === 5 && story.book!.waypoints[4].name === 'Kept through a tie' && said.length === 0, 'this browser\'s, with the waypoint set alone, and nothing set aside');
      ok(net.session.counterOf('c-net') === S + 1, `the counter where the answer put it, one past both copies, and not moved again by the settle (${net.session.counterOf('c-net')})`);
      net.disconnect();
      ok(await until(() => story.host === 'local'), 'put down again');
      // The player keeps the server's copy: this browser's change made alone is set aside and they are told.
      // The server has the copy it was given at counter S on naboo; this one goes back to tatooine at S.
      story.addWaypoint(wpAsk('Lost to a tie'));
      about.planet = 'tatooine';
      noteCharacter();
      setCounter(S);
      go();
      ok(await until(() => !!net.session.ask && net.session.authority === 'server'), 'a tie again');
      const shownAt = shown.length;
      net.session.resolveAsk('server');
      ok(await until(() => story.host === 'server' && story.local === 0), 'answered the server\'s way, the book is settled');
      ok(story.book!.waypoints.length === 5 && !story.book!.waypoints.some((w) => w.name === 'Lost to a tie'), 'with the server\'s copy standing');
      ok(said.some((s) => /played in two places/.test(s)) && (JSON.parse(shelf.get('swg.story.c-net.asides') ?? '[]') as number[]).length === 1, 'and this browser\'s set aside, the player told so');
      ok(net.session.counterOf('c-net') === S, `the counter not moved by the settle, so the answer just given is still the answer to this question (${net.session.counterOf('c-net')})`);
      net.disconnect();
      ok(await until(() => story.host === 'local'), 'put down again');
      // The same question again: answered from memory, which reaches the session before the claim does.
      claimedHeard.length = 0;
      go();
      ok(await until(() => story.host === 'server' && net.session.authority === 'server'), 'connected again, the book settles');
      ok(claimedHeard[0] === 'first:ask' && shown.length === shownAt && story.book!.waypoints.length === 5, `the server put the same question, and it was answered from memory without being shown, the book settling after it (${claimedHeard.join()})`);
      net.disconnect();
      ok(await until(() => story.host === 'local'), 'put down again');
      // Nobody answers: the server does, after its wait, and the book settles the server's way.
      about.planet = 'corellia';
      noteCharacter();
      setCounter(S, true);
      go();
      ok(await until(() => !!net.session.ask && net.session.authority === 'server'), 'a fresh question nobody answers');
      ok(story.host === 'held', 'the book held while it stands');
      ok(await until(() => story.host === 'server' && !net.session.ask, 6000), 'the server answers it after its own wait, and the book is settled');
      ok(story.book!.waypoints.length === 5, 'the server\'s way');
      net.disconnect();
      ok(await until(() => story.host === 'local'), 'put down again');

      // ---- every waypoint taken away alone ----------------------------------------------------------------
      for (const w of [...story.book!.waypoints]) story.removeWaypoint(w.id);
      ok(story.local === 5 && story.book!.waypoints.length === 0, 'every waypoint taken away while playing alone: five changes, nothing left');
      const takenBefore = story.stats.taken;
      said.length = 0;
      go();
      ok(await until(() => story.host === 'server' && story.local === 0), 'back on the server, the book settles');
      ok(story.book!.waypoints.length === 0 && story.stats.taken === takenBefore + 1 && said.length === 0, 'the browser\'s way: the server took the emptied book, rather than handing its old one back in silence');
      net.disconnect();
    } finally {
      clearInterval(stepper);
    }

    // ---- a restart plays the log back to the same book ------------------------------------------------------
    const before = await open('Leia', 'c-b', { key: b.key, counter: 5 });
    before.sync(0, 0);
    await settle();
    const live = before.book()!.book;
    const copy = mkdtempSync(join(tmpdir(), 'swg-story-restart-'));
    for (const f of readdirSync(dir)) copyFileSync(join(dir, f), join(copy, f));
    const port2 = port + 1;
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../server/relay.mjs', import.meta.url)), `--data=${copy}`, `--port=${port2}`], { stdio: 'ignore' });
    try {
      let after: Browser | null = null;
      for (let tries = 0; tries < 40 && !after; tries++) {
        await wait(150);
        try {
          after = await connect('Leia', 'c-b', { key: b.key, counter: 5, at: port2 });
        } catch {
          after = null;
        }
      }
      ok(!!after, 'a relay started again on a copy of what this one wrote down takes the same player and character');
      after!.sync(0, 0);
      await settle();
      const back = after!.book()?.book;
      ok(!!back && bookText(cleanBook(back)) === bookText(cleanBook(live)), `and hands down the very same book, to the character (rev ${back?.rev}, ${back?.waypoints.length} waypoints)`);
      const s2 = (await status(port2)).stories;
      ok(s2.books >= 4 && s2.archived >= 1, `with every book and the archive read back from the log (${s2.books} books, ${s2.archived} archived)`);
      after!.close();
    } finally {
      child.kill();
      setTimeout(() => {
        try {
          rmSync(copy, { recursive: true, force: true });
        } catch {
          /* a temp folder either way */
        }
      }, 300);
    }
    for (const o of opened) o.close();
    await settle();
  } finally {
    // The relay owns the port and the store for the rest of this process; the folder is ours.
    setTimeout(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the server still has it open: a temp folder either way */
      }
      console.log(`\n${passed} checks passed`);
      process.exit(0);
    }, 200);
  }
}
