// The jobs held by the server (server/stories.mjs), against the relay itself on a port of its own, its
// world in a temp folder, started with the committed test set (`--story-tests`), a set of the test's own
// (`--story`) and converted content of its own that gives Tatooine a layout centre and Naboo none
// (`--assets`). Plain sockets stand in for browsers; the browser's own half (src/story/remoteHost.ts) is
// driven against a fake and then against the relay.
//
// What is pinned:
//
//   - the hail says the server runs jobs, with its sets by name and hash and the test set on;
//   - the console's own words are its admin's alone, and another player is refused in words;
//   - an arrival a step is not waiting on is refused, and one that is is believed only within the step's
//     radius and the slack of where the server holds the player -- on a world whose layout centre it was
//     told -- while on a world with none it is taken on the browser's word;
//   - a kill of one of the world's shared creatures is credited from the server's own word of the death to
//     every player it names and its keeper, once each, a report that came first is parked until the word
//     comes, and one whose word never comes is given up; a body nobody else knows is believed;
//   - a reward is paid once, through the purse and the ledger, and never again however often its step is
//     reached or the browser reconnects;
//   - a book played alone and taken by the server has its rewards the browser paid paid here, once, up to
//     the cap a settle, the rest owed and paid at the next settle, never twice;
//   - the deadlines of a connected character are swept on the server's clock, and an offline character's
//     are settled at its claim, in the order they fell, each at its own time;
//   - every other thing a browser says it saw is checked where the server can check it: a signal is never a
//     browser's word; a use only of a thing a step waits on or that gives a job, from near it; an area only
//     from inside it; a room only one a step waits on, near the place a goto names (on the browser's word
//     for a step waiting on the room alone); an arrival only in the room the browser last said it stood in,
//     and on the world the step names; a world only the one stood on; a player in another player's hull is
//     taken at their word, one walking their own hull's rooms is measured where they stand;
//   - the server's allowance of words a second, the cap on kills nobody else knows, a view sent only when it
//     changed, a job's waypoint switched by its key, the counts written lazily and flushed;
//   - the admin's reload holds a running book to the new sets at once, and on a server that reads no set a
//     line is told so and brought into the world by the first set read;
//   - the game hour a job asks about is the server's own, and a browser's is taken only for a world the list
//     of planets does not know, and only while fresh;
//   - the browser's half sends a kill a tick late, drops what it sees while the line is held, says why in
//     words that match the line's state, and takes the server's view and notes.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const note = (msg: string): void => console.log(`     ${msg}`);

type Msg = Record<string, unknown>;

// ---- the browser's half, against a fake --------------------------------------------------------------------
const { RemoteHost, JOBS_WAIT_OLD, JOBS_WAIT_UNREAD, JOBS_HELD, JOBS_SETTLING } = await import('../../../src/story/remoteHost.ts');
{
  const sent: Msg[] = [];
  // A line that has dropped reads story nought (the session's story is the server's only while it has this
  // browser), which is how the real wiring hands it over.
  const line = { host: 'held' as 'local' | 'server' | 'held', story: 0 };
  let wall = 1000;
  const notes: { k: string; given: boolean }[] = [];
  const host = new RemoteHost({ send: (m) => sent.push(m), line: () => line, char: () => 'c-x', at: () => ({ p: [1, 2], room: null }), now: () => 5000, wall: () => wall, note: (n, given) => notes.push({ k: n.k, given }) });
  ok(!host.event({ k: 'death' }).ok && host.stats.dropped === 1 && !sent.length, 'while the line is held, what the detectors see is dropped and counted, and nothing goes up');
  ok(host.whyNot() === JOBS_HELD && host.event({ k: 'use', object: 'test:obj/test-terminal' }).why === JOBS_HELD, `a line that has dropped says the server is not answering, never that it runs no jobs (${host.whyNot()})`);
  line.story = 2;
  ok(host.whyNot() === JOBS_SETTLING, 'a line just claimed on a server that runs jobs is held while it settles the book');
  line.story = 1;
  ok(host.whyNot() === JOBS_WAIT_OLD, 'and one on a server from before the jobs says they wait there');
  line.host = 'server';
  ok(host.whyNot() === JOBS_WAIT_OLD && !host.grant('test:goto').ok, 'a server that holds the story but runs no jobs is asked nothing: the jobs wait, in words');
  line.story = 2;
  host.event({ k: 'arrive', world: 'tatooine', p: [3, 4], quest: 'test:goto', step: 'outdoor' });
  ok(sent.length === 1 && sent[0].do === 'ev' && JSON.stringify((sent[0] as { at: unknown }).at) === JSON.stringify({ p: [1, 2], room: null }), 'an event goes up at once, with where the player stood');
  host.event({ k: 'kill', who: 'kreetle', npc: 'wild:tatooine:1:0' });
  ok(sent.length === 1, 'a kill waits a tick, so a keeper\'s own word of the death reaches the server ahead of the claim on it');
  host.tick();
  ok(sent.length === 2 && (sent[1].ev as { k: string }).k === 'kill', 'and goes up on the next');
  for (let i = 0; i < 20; i++) host.event({ k: 'world', world: 'tatooine' });
  ok(sent.length === 8 && host.report().queued === 14, `no more words a second than its allowance (${sent.length} sent, the rest waiting)`);
  wall += 1000;
  host.tick();
  ok(sent.length === 16, 'and the rest go in the seconds after');
  host.accept('test:goto');
  wall += 2000;
  host.tick();
  ok(sent.some((m) => m.do === 'q' && m.op === 'accept' && !!(m as { at?: unknown }).at), 'a job\'s word carries where the player stood too');
  host.word({ t: 'story', do: 'view', view: { rev: 3, quests: [{ id: 'test:goto', title: 'TEST: go', client: 'none', state: 'active', lines: [], canDrop: true, canRestart: true, at: 1 }], waypoints: [], watch: [{ k: 'death' }, { k: 'nonsense' }], cast: [], objects: [], tracked: [], trackWp: null }, off: 31000 });
  const v = host.view();
  ok(!!v && v.rev === 3 && v.quests.length === 1 && v.watch.length === 1 && host.now() === 5000 + 31000, 'the server\'s view is taken, what is not one dropped from it, and its clock read with the admin\'s move');
  host.word({ t: 'story', do: 'note', note: { k: 'paid', quest: 'test:reward', credits: 25 }, given: 1 });
  host.word({ t: 'story', do: 'note', note: { k: 'objective', quest: 'test:goto', step: 'outdoor', line: 'TEST: walk', goto: true }, given: 1 });
  ok(notes.length === 2 && notes[0].k === 'paid' && notes[0].given, 'and so are its notes, for the message line');
  host.reset();
  ok(host.view() === null && host.report().queued === 0, 'another character takes the view and the queue away');
}

// ---- a server that reads no set, then is given one -----------------------------------------------------------
{
  const { Stories, STORY_TUNING, applyStory } = await import('../../../server/stories.mjs');
  const files = [
    { path: 'story.jsonc', text: '{ "prefix": "own", "title": "played" }' },
    { path: 'quests/played.jsonc', text: JSON.stringify({ id: 'played', title: 'Played', givers: [{ kind: 'debug' }], start: ['wait'], steps: { wait: { type: 'timer', for: { seconds: 30, clock: 'played' }, objective: 'Wait', ends: 'done' } } }) },
  ];
  let readable = false;
  let now = 1_900_000_000_000;
  const s = new Stories({ tuning: STORY_TUNING, write: (rec: object) => void applyStory(s.data, rec), now: () => now, read: () => ({ test: null, own: readable ? files : null }), admin: () => true });
  s.readSets();
  const c = { id: 1, character: 'c-unread', keep: 'server', asking: null, hello: { planet: 'tatooine', zone: '' }, state: null };
  const first = s.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 }) as { tell: { msg: Msg }[] };
  const told = first.tell.find((t) => t.msg.do === 'view');
  const line = s.lines.get(1) as { ready: boolean; entered: boolean };
  ok(told?.msg.read === 0 && line.ready && !line.entered, 'a line settled on a server that reads no set is told so in its view, and is not brought into a world with nothing to work out');
  const host = new RemoteHost({ send: () => {}, line: () => ({ host: 'server', story: 2 }), char: () => 'c-unread', at: () => ({}), now: () => now, wall: () => now, note: () => {} });
  host.word(told!.msg);
  ok(host.waits() === JOBS_WAIT_UNREAD && !host.event({ k: 'death' }).ok && host.reload().ok, `the browser says its jobs wait for want of a set and sends nothing it sees, while the admin's reload still goes up (${host.waits()})`);
  readable = true;
  const reload = s.reload() as { tell: { msg: Msg }[] };
  ok(line.entered && (s.ctxOf(line) as { away: boolean }).away === false && reload.tell.some((t) => t.msg.do === 'view' && t.msg.read === 1), 'the first set the admin reads brings the line into the world as a claim would, and tells it a set is read');
  host.word(reload.tell.find((t) => t.msg.do === 'view')!.msg);
  ok(host.waits() === null, 'and the browser\'s jobs no longer wait');
  s.hear(c, { t: 'story', do: 'admin', op: 'grant', quest: 'own:played', at: {} });
  const wait = () => (s.bookOf('c-unread') as { quests: Record<string, { state: string; steps: Record<string, { deadline?: number; remaining?: number }> }> }).quests['own:played'];
  ok(wait()?.steps.wait.deadline === now + 30000, 'so a step on the played clock granted then counts down');
  now += 10000;
  s.gone(1);
  ok(wait()?.steps.wait.remaining === 20000 && wait()?.steps.wait.deadline === undefined, 'and its line closing is a leave: the clock stops with twenty seconds still to run');
  now += 600000;
  s.hear({ ...c, id: 2 }, { t: 'story', do: 'sync', has: 1, base: 0, local: 0, known: 1 });
  now += 21000;
  s.lastSweep = 0;
  s.tick(Date.now() + 1e9);
  ok(wait()?.state === 'done', 'and it runs out twenty seconds after the character comes back, not ten minutes after it went');
}

if (typeof WebSocket === 'undefined') {
  note('the relay round trip was skipped: this node has no WebSocket of its own');
  console.log(`\n${passed} checks passed`);
} else {
  const { randomBytes } = await import('node:crypto');
  const { playerIdFor, proofFor, verifierFor } = await import('../../../server/identity.mjs');
  const { STORY_TUNING } = await import('../../../server/stories.mjs');
  const { bookText, chunkText } = await import('../../../src/story/storyWire.ts');
  const { emptyBook } = await import('../../../src/story/book.ts');
  const { PLANETS } = await import('../../../src/data/planets.ts');
  const { hourOfDay, planetPhase } = await import('../../../src/world/dayPhase.ts');
  const { dayFraction } = await import('../../../server/clock.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'swg-stories-server-'));
  // A set of the test's own: one job on Naboo, whose layout centre the server is not told.
  const own = join(dir, 'story');
  mkdirSync(join(own, 'quests'), { recursive: true });
  writeFileSync(join(own, 'story.jsonc'), '{ "prefix": "own", "title": "the test\'s own" }');
  writeFileSync(join(own, 'quests', 'far.jsonc'), JSON.stringify({ id: 'far', title: 'Far away', givers: [{ kind: 'debug' }], start: ['go'], steps: { go: { type: 'goto', objective: 'Go far', at: { world: 'naboo', raw: [100, 100] }, radius: 5, ends: 'done' } } }));
  // A job that can never start over, so a revision of it that drops the step it is in holds it as revised.
  const longJob = (step: string, rev: number) => JSON.stringify({ id: 'long', rev, title: 'Long way', restart: 'never', givers: [{ kind: 'debug' }], start: [step], steps: { [step]: { type: 'goto', objective: 'Go a long way', at: { world: 'naboo', raw: [500, 500] }, radius: 5, ends: 'done' } } });
  writeFileSync(join(own, 'quests', 'long.jsonc'), longJob('go', 1));
  // A job that waits on a room alone, which names no place for the server to measure.
  writeFileSync(join(own, 'quests', 'den.jsonc'), JSON.stringify({ id: 'den', title: 'Den', givers: [{ kind: 'debug' }], start: ['enter'], steps: { enter: { type: 'signal', signal: 'room:object/building/tatooine/shared_cantina_tatooine.iff#cantina', objective: 'Go in', ends: 'done' } } }));
  // A thing standing in the test square that no step waits on and that gives no job.
  mkdirSync(join(own, 'objects'), { recursive: true });
  writeFileSync(join(own, 'objects', 'lamp.jsonc'), JSON.stringify({ id: 'lamp', world: 'tatooine', template: 'object/tangible/terminal/shared_terminal_mission.iff', near: [3476, -4694], reach: 3, label: 'LAMP' }));
  // Converted content of its own: Tatooine's layout centre and Corellia's, and nothing for Naboo.
  const assets = join(dir, 'assets');
  const CENTRE = { x: -1376, z: -3576 };
  const CORELLIA = { x: 210, z: -4120 };
  mkdirSync(join(assets, 'tatooine'), { recursive: true });
  writeFileSync(join(assets, 'tatooine', 'pois.json'), JSON.stringify({ planet: 'tatooine', center: CENTRE, pois: [] }));
  mkdirSync(join(assets, 'corellia'), { recursive: true });
  writeFileSync(join(assets, 'corellia', 'pois.json'), JSON.stringify({ planet: 'corellia', center: CORELLIA, pois: [] }));
  const port = 18801;
  process.env.PORT = String(port);
  process.argv.push(`--data=${join(dir, 'world')}`, '--story-tests', `--story=${own}`, `--assets=${assets}`, '--set=story.killPark=600', '--set=story.sweep=200', '--set=story.coalesce=400', '--set=story.evRate=40');
  await import('../../../server/relay.mjs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const settle = () => wait(150);
  const status = async () => (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { stories: Record<string, unknown> & { refusedBy: Record<string, number>; sets: { name: string; quests: number }[] } };

  /** A browser: a key (the same one makes the same player again), its character, and everything it heard. */
  async function connect(name: string, character: string, o: { key?: Uint8Array; counter?: number; planet?: string } = {}) {
    const key = o.key ?? new Uint8Array(randomBytes(32));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
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
    send({ t: 'claim', player: playerIdFor(key), key: verifierFor(key), proof: proofFor(verifierFor(key), nonce), character, name, counter: o.counter ?? 1, about: { species: 'human_male', class: 'jedi', planet, zone: '' } });
    await settle();
    send({ t: 'hello', name, species: 'human_male', class: 'jedi', planet, v: 5 });
    await settle();
    const welcome = got.find((m) => m.t === 'welcome') as { id?: number } | undefined;
    const story = (pick: (m: Msg) => boolean = () => true) => got.filter((m) => m.t === 'story' && pick(m));
    const me = {
      key,
      id: Number(welcome?.id ?? 0),
      got,
      send,
      close: () => ws.close(),
      last: (t: string, pick: (m: Msg) => boolean = () => true) => [...got].reverse().find((m) => m.t === t && pick(m)),
      story,
      clear: () => void (got.length = 0),
      /** Stand at a place in the game's own frame, as a state says it. */
      at: (x: number, z: number) => send({ t: 'state', p: [x, 0, z], h: 0, s: 'idle', v: 0 }),
      /** Settle the book: say it holds nothing. */
      sync: (has = 0, local = 0, base = 0, known = 0) => send({ t: 'story', do: 'sync', has, base, local, known }),
      ev: (ev: Msg, at: Msg = {}) => send({ t: 'story', do: 'ev', ev, at }),
      admin: (op: string, more: Msg = {}) => send({ t: 'story', do: 'admin', op, ...more }),
      q: (op: string, quest: string) => send({ t: 'story', do: 'q', op, quest }),
      /** The last view the server sent. */
      view: () => (me.last('story', (m) => m.do === 'view') as { view?: { quests: { id: string; state: string; lines: { step: string }[] }[]; watch: { k: string; step?: string }[]; waypoints: { id: string; on: boolean }[] } } | undefined)?.view,
      /** How many views the server has sent. */
      views: () => story((m) => m.do === 'view').length,
      /** A waypoint word: a job's own waypoint switched by its key, as the browser's book sends it. */
      wp: (op: string, id: string) => send({ t: 'story', do: 'wp', op, wp: { id } }),
      /** Every batch the server sent, flattened to its changes. */
      changes: () => story((m) => m.do === 'ch').flatMap((m) => m.ch as Msg[]),
      /** The step record the latest batches say a job's step is in. */
      step: (quest: string, s: string) => {
        let rec: Msg | null = null;
        for (const c of me.changes()) {
          if (c.k === 'step' && c.quest === quest && c.step === s) rec = c.rec as Msg;
          if (c.k === 'qState' && c.quest === quest) rec = ((c.rec as { steps: Record<string, Msg> }).steps[s] as Msg) ?? rec;
        }
        return rec as { state: string; n: number; at: number } | null;
      },
      quest: (quest: string) => {
        let rec: Msg | null = null;
        for (const c of me.changes()) if (c.k === 'qState' && c.quest === quest) rec = c.rec as Msg;
        return rec as { state: string; outcome?: string; completions: number } | null;
      },
      purse: () => (me.last('purse', (m) => typeof m.credits === 'number') as { credits: number } | undefined)?.credits ?? null,
      book: () => {
        const pieces = story((m) => m.do === 'book');
        if (!pieces.length) return null;
        const id = pieces[pieces.length - 1].id;
        const mine = pieces.filter((m) => m.id === id).sort((a, b) => Number(a.n) - Number(b.n));
        if (mine.length !== Number(mine[0].of)) return null;
        return JSON.parse(mine.map((m) => String(m.part)).join('')) as Msg & { paid?: Record<string, { by: string }>; rev: number; quests?: Record<string, { steps: Record<string, { state: string; at: number }> }> };
      },
      offer: async (book: unknown, known = 0) => {
        const parts = chunkText(bookText(book), 24000);
        for (let n = 0; n < parts.length; n++) send({ t: 'story', do: 'offer', id: 1, n, of: parts.length, part: parts[n], known });
        await settle();
      },
    };
    return me;
  }
  type Browser = Awaited<ReturnType<typeof connect>>;
  const opened: Browser[] = [];
  const open = async (...args: Parameters<typeof connect>) => {
    const b = await connect(...args);
    opened.push(b);
    return b;
  };
  // Tatooine's raw frame into the game's: X mirrored about the centre.
  const game = (x: number, z: number) => [-(x - CENTRE.x), z - CENTRE.z] as const;

  try {
    // ---- the hail, and the admin's words ------------------------------------------------------------------
    const a = await open('Han', 'c-a');
    const hail = a.last('hail') as { dayMs?: number; story?: { v: number; sets: { name: string; hash: string }[]; tests: number } };
    ok(hail.story?.v === 2 && hail.story.tests === 1 && hail.story.sets.map((s) => s.name).sort().join() === 'own,test' && hail.story.sets.every((s) => /^[0-9a-f]{64}$/.test(s.hash)), `the hail says the server runs jobs, with its sets by name and hash and the test set on (${JSON.stringify(hail.story?.sets.map((s) => s.name))})`);
    a.send({ t: 'items', do: 'list', rows: [] });
    a.sync();
    await settle();
    ok(!!a.book() && !!a.view(), 'a character settled on its line is handed its book, then the view of its jobs');
    const stranger = await open('Greedo', 'c-greedo');
    stranger.sync();
    await settle();
    stranger.admin('grant', { quest: 'test:reward' });
    await settle();
    const refused = stranger.last('story', (m) => m.do === 'no') as Msg | undefined;
    ok(refused?.of === 'job' && /admin/.test(String(refused.why)) && !stranger.quest('test:reward'), `the console's words are the admin's alone: another player is refused in words, and nothing is granted (${refused?.why})`);
    stranger.q('accept', 'test:goto');
    await settle();
    ok(/not on offer/.test(String((stranger.last('story', (m) => m.do === 'no') as Msg)?.why)), 'while a job word of a player\'s own is theirs, and the rules refuse it when it does not apply');

    // ---- arrivals -----------------------------------------------------------------------------------------
    const [mx, mz] = game(3476, -4694);
    a.at(0, 0);
    await settle();
    a.ev({ k: 'arrive', world: 'tatooine', p: [3476, -4694], quest: 'test:waypoints', step: 'mark' }, { p: [3476, -4694] });
    await settle();
    let st = await status();
    ok(!a.quest('test:waypoints') && (st.stories.refusedBy.arrive ?? 0) >= 1, 'an arrival no running step waits on is refused, and counted');
    a.admin('grant', { quest: 'test:waypoints' });
    await settle();
    ok(a.step('test:waypoints', 'mark')?.state === 'active' && !!a.view()?.watch.some((w) => w.k === 'arrive' && w.step === 'mark'), 'granted by the admin, its step runs and the view tells the detectors to watch for the arrival');
    a.ev({ k: 'arrive', world: 'tatooine', p: [3476, -4694], quest: 'test:waypoints', step: 'mark' }, { p: [3476, -4694] });
    await settle();
    ok(a.step('test:waypoints', 'mark')?.state === 'active', 'a browser that says it has arrived while the server holds it kilometres off is not believed, on a world whose layout centre the server knows');
    a.at(mx + 20, mz);
    await settle();
    a.ev({ k: 'arrive', world: 'tatooine', p: [3476, -4694], quest: 'test:waypoints', step: 'mark' }, { p: [3476, -4694] });
    await settle();
    ok(a.step('test:waypoints', 'mark')?.state === 'done' && a.step('test:waypoints', 'quiet')?.state === 'active', `within the step's radius and the slack (${STORY_TUNING.arriveSlack} m) of where the server holds the player, it is`);
    a.ev({ k: 'arrive', world: 'naboo', p: [3619, -4801], quest: 'test:waypoints', step: 'quiet' }, { p: [3619, -4801] });
    await settle();
    ok(a.step('test:waypoints', 'quiet')?.state === 'active', 'and an arrival on a world the player is not standing on never is');
    // Naboo: no layout centre, so the browser's word is taken, as every position already is.
    const n = await open('Leia', 'c-naboo', { key: a.key, planet: 'naboo' });
    n.sync();
    await settle();
    n.at(5000, 5000);
    await settle();
    n.admin('grant', { quest: 'far' });
    await settle();
    ok(n.step('own:far', 'go')?.state === 'active', 'a job named without its prefix is found in the server\'s own sets');
    n.ev({ k: 'arrive', world: 'naboo', p: [101, 99], quest: 'own:far', step: 'go' }, { p: [101, 99] });
    await settle();
    ok(n.quest('own:far')?.state === 'done', 'on a world whose layout centre the server was not told, an arrival is taken on the browser\'s word');

    // ---- what a browser says it saw, checked ----------------------------------------------------------------
    const why = async () => String(((await status()).stories.stats as Msg).lastWhy ?? '');
    const refusedOf = async (k: string) => (await status()).stories.refusedBy[k] ?? 0;
    // Nothing changed, nothing sent: an event the server believes that moves nothing sends no view again.
    const viewsWere = a.views();
    a.ev({ k: 'world', world: 'tatooine' });
    await settle();
    ok(viewsWere > 0 && a.views() === viewsWere, 'an event that moves nothing sends no view again: a view goes only when it changed');
    const worldRefused = await refusedOf('world');
    a.ev({ k: 'world', world: 'naboo' });
    await settle();
    ok((await refusedOf('world')) === worldRefused + 1, 'a world the player is not standing on is refused');
    // A job's own waypoint, switched by its key on the server that runs the job.
    const qwp = 'q:test:waypoints#quiet';
    ok(a.view()?.waypoints.some((w) => w.id === qwp && !w.on) === true, 'a job\'s waypoint its step starts switched off is off in the server\'s view');
    a.wp('on', qwp);
    await settle();
    ok(a.changes().some((c) => c.k === 'qwpOn' && c.key === qwp && c.on === true) && a.view()?.waypoints.some((w) => w.id === qwp && w.on) === true, 'switched on by the player, it is written down by its key, and the view sent again shows it on');
    // A signal: never a browser's word, not even the admin's own browser's; only the console's.
    a.admin('grant', { quest: 'test:signal' });
    await settle();
    const signalRefused = await refusedOf('signal');
    a.ev({ k: 'signal', name: 'debug:test-ping' });
    await settle();
    ok(a.step('test:signal', 'ping')?.state === 'active' && !a.step('test:signal', 'ping')?.n && (await refusedOf('signal')) === signalRefused + 1, 'a signal a browser says was raised is never believed, not even from the admin\'s own browser');
    a.admin('signal', { name: 'debug:test-ping' });
    await settle();
    ok(a.step('test:signal', 'ping')?.n === 1, 'while the admin\'s console raises it');
    stranger.admin('signal', { name: 'debug:test-ping' });
    await settle();
    ok(/admin/.test(String((stranger.last('story', (m) => m.do === 'no') as Msg)?.why)), 'and nobody else\'s console does');
    // A use: of a thing a step waits on, within its reach, the slack and the browser's own search round it.
    const useRefused = await refusedOf('use');
    a.at(mx, mz + 200);
    await settle();
    a.ev({ k: 'use', object: 'test:obj/test-terminal' });
    await settle();
    ok(a.step('test:signal', 'poke')?.state === 'active' && (await refusedOf('use')) === useRefused + 1 && /too far/.test(await why()), 'a thing used from two hundred metres off is refused, on a world whose centre the server knows');
    a.at(mx + 20, mz);
    await settle();
    a.ev({ k: 'use', object: 'own:obj/lamp' });
    await settle();
    ok((await refusedOf('use')) === useRefused + 2 && /nothing of yours waits/.test(await why()), 'a thing no step waits on, that gives no job, is refused however near it is');
    a.ev({ k: 'use', object: 'test:obj/not-there' });
    await settle();
    ok((await refusedOf('use')) === useRefused + 3 && /no such thing/.test(await why()), 'as is a thing that is not in any set');
    a.ev({ k: 'use', object: 'test:obj/test-terminal' });
    await settle();
    ok(a.step('test:signal', 'poke')?.state === 'done', `and the terminal used from 20 m, within its reach, the slack (${STORY_TUNING.talkSlack} m) and the browser's search (${STORY_TUNING.useFind} m), is believed`);
    // An area entered: only from inside it, or within the slack of its edge.
    a.admin('grant', { quest: 'test:observe' });
    await settle();
    const areaRefused = await refusedOf('area');
    const watchChanges = () => a.changes().filter((c) => c.k === 'step' && c.quest === 'test:observe').length;
    const watchWas = watchChanges();
    a.at(mx, mz + 200);
    await settle();
    a.ev({ k: 'area', area: 'test:area/test-square', inside: true });
    await settle();
    ok((await refusedOf('area')) === areaRefused + 1 && watchChanges() === watchWas && a.step('test:signal', 'square')?.state === 'active', 'an area said to be entered from two hundred metres outside it is refused: no watch begins and nothing waiting on it moves');
    a.at(mx, mz);
    await settle();
    a.ev({ k: 'area', area: 'test:area/test-square', inside: true });
    await settle();
    ok(watchChanges() > watchWas && a.step('test:signal', 'square')?.state === 'done', 'stood inside it, it is believed: the watch begins and the step waiting on it is done');
    a.ev({ k: 'area', area: 'test:area/test-square', inside: false });
    await settle();
    // A room: only one a step waits on, and where the server can say, only near the place that step names.
    // The terminal gives the goto job too, so using it from 20 m (raw 3456) took that job there, and its first
    // place is thirty metres on from where the server held the player at that moment.
    const CANTINA = 'object/building/tatooine/shared_cantina_tatooine.iff';
    const goStart = (a.quest('test:goto') as { from?: { p: number[] } } | null)?.from?.p;
    ok(a.quest('test:goto')?.state === 'active' && goStart?.[0] === 3456 && goStart?.[1] === -4694, `the terminal used gives its job, begun where the server held the player (${JSON.stringify(goStart)})`);
    const [ox, oz] = game(3486, -4694);
    a.at(ox, oz);
    await settle();
    a.ev({ k: 'arrive', world: 'tatooine', p: [3486, -4694], quest: 'test:goto', step: 'outdoor' }, { p: [3486, -4694], room: null });
    await settle();
    ok(a.step('test:goto', 'outdoor')?.state === 'done' && a.step('test:goto', 'cantina')?.state === 'active', 'and a place written from where the job was taken is reached thirty metres on');
    const roomRefused = await refusedOf('room');
    a.ev({ k: 'room', template: CANTINA, cell: 'cantina' }, { p: [3486, -4694], room: { cell: 'cantina', template: CANTINA } });
    await settle();
    ok(a.step('test:goto', 'cantina')?.state === 'active' && (await refusedOf('room')) === roomRefused + 1 && /not where that room is/.test(await why()), 'a room said to be entered while the server holds the player well over a hundred metres from it is refused');
    const [cx, cz] = game(3432, -4818);
    a.at(cx, cz);
    await settle();
    a.ev({ k: 'room', template: CANTINA, cell: 'backroom' }, { p: [3432, -4818], room: { cell: 'backroom', template: CANTINA } });
    await settle();
    ok((await refusedOf('room')) === roomRefused + 2 && /no step of yours waits on that room/.test(await why()), 'a room no step waits on is refused');
    const inCantina = { cell: 'cantina', template: CANTINA };
    a.ev({ k: 'arrive', world: 'tatooine', p: [3432, -4818], room: inCantina, quest: 'test:goto', step: 'cantina' }, { p: [3432, -4818], room: { cell: 'backroom', template: CANTINA } });
    await settle();
    ok(a.step('test:goto', 'cantina')?.state === 'active' && /not where that step waits/.test(await why()), 'an arrival claimed in the cantina\'s room while the room the browser last said it stood in is another is refused');
    a.ev({ k: 'arrive', world: 'tatooine', p: [3432, -4818], room: inCantina, quest: 'test:goto', step: 'cantina' }, { p: [3432, -4818], room: inCantina });
    await settle();
    ok(a.step('test:goto', 'cantina')?.state === 'done' && a.quest('test:goto')?.state === 'done', 'and in the room it last said, the arrival is believed and finishes the job');
    // Taken again at the terminal, the cantina is reached this time by the room itself, entered where it stands.
    a.at(mx + 20, mz);
    await settle();
    a.ev({ k: 'use', object: 'test:obj/test-terminal' });
    await settle();
    a.at(ox, oz);
    await settle();
    a.ev({ k: 'arrive', world: 'tatooine', p: [3486, -4694], quest: 'test:goto', step: 'outdoor' }, { p: [3486, -4694], room: null });
    await settle();
    a.at(cx, cz);
    await settle();
    a.ev({ k: 'room', template: CANTINA, cell: 'cantina' }, { p: [3432, -4818], room: inCantina });
    await settle();
    ok(a.quest('test:goto')?.state === 'done' && a.quest('test:goto')?.completions === 2, 'taken again at the terminal, the cantina\'s own room entered where it stands is believed and finishes the job');
    // A step that waits on the room alone names no place: the building is whichever near one has that cell,
    // which only the browser can find, so there the room is taken on its word wherever the server holds it.
    a.admin('grant', { quest: 'den' });
    await settle();
    a.at(mx, mz + 200);
    await settle();
    a.ev({ k: 'room', template: CANTINA, cell: 'cantina' }, { p: [3476, -4494], room: inCantina });
    await settle();
    ok(a.quest('own:den')?.state === 'done', 'a step waiting on a room alone takes the room on the browser\'s word, since nothing says where its building is');
    // The server's own allowance of words a second, which a browser's pacing keeps under.
    const rateWas = STORY_TUNING.evRate;
    STORY_TUNING.evRate = 2;
    try {
      await wait(1100);
      const before = await refusedOf('world');
      for (let i = 0; i < 4; i++) a.ev({ k: 'world', world: 'naboo' });
      await settle();
      ok((await refusedOf('world')) === before + 2, 'no more of a browser\'s words in a second than the server\'s allowance are heard: the rest are cut before anything is checked');
    } finally {
      STORY_TUNING.evRate = rateWas;
    }
    // Standing in another player's hull, the place a state carries is that hull's own frame and the hull is
    // somebody else's word: the server cannot say where the player is, and takes the arrival on the browser's.
    a.send({ t: 'state', p: [9000, 0, 9000], h: 0, s: 'idle', v: 0 });
    await settle();
    a.ev({ k: 'arrive', world: 'tatooine', p: [3619, -4801], quest: 'test:waypoints', step: 'quiet' }, { p: [3619, -4801] });
    await settle();
    ok(a.step('test:waypoints', 'quiet')?.state === 'active', 'an arrival claimed while the server holds the player kilometres off is refused');
    a.send({ t: 'state', p: [9000, 0, 9000], h: 0, s: 'idle', v: 0, in: { ship: stranger.id, p: [1, 0, 1], h: 0 } });
    await settle();
    a.ev({ k: 'arrive', world: 'tatooine', p: [3619, -4801], quest: 'test:waypoints', step: 'quiet' }, { p: [3619, -4801] });
    await settle();
    ok(a.step('test:waypoints', 'quiet')?.state === 'done', 'but the same arrival from a player standing in another player\'s hull is taken on the browser\'s word');
    a.at(mx, mz);
    await settle();
    // The world rule alone: a line on Corellia, whose centre the server knows, standing on the very raw point
    // of a step written on Tatooine.
    const gameC = (x: number, z: number) => [-(x - CORELLIA.x), z - CORELLIA.z] as const;
    const cor = await open('Mon', 'c-cor', { key: a.key, planet: 'corellia' });
    cor.sync();
    await settle();
    cor.admin('grant', { quest: 'test:waypoints' });
    await settle();
    const [kx, kz] = gameC(3476, -4694);
    cor.at(kx, kz);
    await settle();
    const arriveRefused = await refusedOf('arrive');
    cor.ev({ k: 'world', world: 'naboo' });
    await settle();
    cor.ev({ k: 'arrive', world: 'corellia', p: [3476, -4694], quest: 'test:waypoints', step: 'mark' }, { p: [3476, -4694] });
    await settle();
    ok(cor.step('test:waypoints', 'mark')?.state === 'active' && (await refusedOf('arrive')) === arriveRefused + 1 && /not where that step waits/.test(await why()), 'standing on the very point a step names, on another world, is not arriving there: the step\'s world is not the one stood on');
    cor.ev({ k: 'arrive', world: 'tatooine', p: [3476, -4694], quest: 'test:waypoints', step: 'mark' }, { p: [3476, -4694] });
    await settle();
    ok(cor.step('test:waypoints', 'mark')?.state === 'active' && (await refusedOf('arrive')) === arriveRefused + 2 && /not the world you stand on/.test(await why()), 'nor is an arrival claimed on a world the player is not standing on');

    // ---- paid once --------------------------------------------------------------------------------------------
    const before = (a.clear(), a.send({ t: 'purse', do: 'ask' }), await settle(), a.purse());
    a.admin('grant', { quest: 'test:reward' });
    await settle();
    const paid = a.purse();
    const added = a.last('items', (m) => m.do === 'added') as { row?: { what: string } } | undefined;
    ok(before !== null && paid === before + 25, `the reward's credits are paid through the purse (${before} to ${paid})`);
    ok(added?.row?.what === 'shirt_s03', 'and its thing through the ledger, which tells the browser of it as of anything it writes down');
    ok(a.story((m) => m.do === 'note' && (m.note as Msg).k === 'paid' && m.given === 1).length === 1, 'the message line is told it was paid, and that it arrived');
    a.admin('signal', { name: 'debug:test-again' });
    await settle();
    ok(a.purse() === paid && a.story((m) => m.do === 'note' && (m.note as Msg).k === 'paid').length === 1, 'reached again in the same completion, the reward pays nothing');
    a.close();
    await settle();
    const a2 = await open('Han', 'c-a', { key: a.key, counter: 1 });
    a2.send({ t: 'purse', do: 'ask' });
    a2.sync(1, 0, 3, 1);
    await settle();
    ok(a2.purse() === paid && !a2.last('items', (m) => m.do === 'added'), 'nor does a reconnect pay it again');
    a2.admin('signal', { name: 'debug:test-finish' });
    await settle();
    ok(a2.quest('test:reward')?.state === 'done', 'and the job finishes on the new line where it stood');

    // ---- kill credit --------------------------------------------------------------------------------------------
    const keeper = a2;
    const striker = await open('Chewie', 'c-b', { key: a.key });
    const bystander = await open('Lando', 'c-c', { key: a.key });
    for (const b of [striker, bystander]) {
      b.sync();
      await settle();
    }
    keeper.at(10, 0);
    striker.at(40, 0);
    bystander.at(60, 0);
    await settle();
    for (const b of [keeper, striker, bystander]) b.admin('grant', { quest: 'test:kill' });
    await settle();
    const X = 'wild:tatooine:9:0';
    keeper.send({ t: 'spawn', do: 'seen', id: X, at: [0, 0, 0], r: 30 });
    striker.send({ t: 'spawn', do: 'seen', id: X, at: [0, 0, 0], r: 30 });
    await wait(800);
    ok(keeper.got.some((m) => m.t === 'keep' && ((m.add as string[]) ?? []).includes(X)), 'the nearest browser with a body for the creature keeps it');
    // The striker hears of nothing yet and reports its kill: it waits for the server's own word.
    striker.ev({ k: 'kill', who: 'kreetle', npc: X });
    await settle();
    ok(!striker.step('test:kill', 'mites')?.n, 'a kill of a shared creature reported before the server\'s word of its death waits for it');
    keeper.send({ t: 'spawn', do: 'dead', id: X, by: [striker.id] });
    await settle();
    ok(striker.step('test:kill', 'mites')?.n === 1, 'and is counted when the word comes naming that player among those who struck');
    keeper.ev({ k: 'kill', who: 'kreetle', npc: X });
    await settle();
    ok(keeper.step('test:kill', 'mites')?.n === 1, 'the keeper\'s own report counts too: every character who struck it, and its keeper');
    striker.ev({ k: 'kill', who: 'kreetle', npc: X });
    bystander.ev({ k: 'kill', who: 'kreetle', npc: X });
    await settle();
    ok(striker.step('test:kill', 'mites')?.n === 1 && !bystander.step('test:kill', 'mites')?.n, 'once each, and never to a player the word does not name');
    const Y = 'wild:tatooine:9:1';
    keeper.send({ t: 'spawn', do: 'seen', id: Y, at: [0, 0, 0], r: 30 });
    await wait(400);
    const refusedKills = (await status()).stories.refusedBy.kill ?? 0;
    striker.ev({ k: 'kill', who: 'kreetle', npc: Y });
    await wait(STORY_TUNING.killPark + 1200);
    st = await status();
    ok(!striker.step('test:kill', 'mites') || striker.step('test:kill', 'mites')!.n === 1, 'a report of a death the server never hears of is never counted');
    ok((st.stories.refusedBy.kill ?? 0) > refusedKills, `and is given up after ${STORY_TUNING.killPark} ms, and counted`);
    bystander.ev({ k: 'kill', who: 'kreetle', npc: 'ours:7' });
    bystander.ev({ k: 'kill', who: 'kreetle', npc: 'ours:7' });
    await settle();
    ok(bystander.step('test:kill', 'mites')?.n === 1, 'a body nobody else knows is taken on the browser\'s word, once');
    const killCapWas = STORY_TUNING.killsPerMinute;
    STORY_TUNING.killsPerMinute = 2;
    try {
      bystander.ev({ k: 'kill', who: 'kreetle', npc: 'ours:8' });
      bystander.ev({ k: 'kill', who: 'kreetle', npc: 'ours:9' });
      await settle();
      ok(bystander.step('test:kill', 'mites')?.n === 2 && /more kills than anybody/.test(await why()), `but no more of them in a minute than the cap (${STORY_TUNING.killsPerMinute} here)`);
    } finally {
      STORY_TUNING.killsPerMinute = killCapWas;
    }
    // The counts went into the log lazily, and the stories' coalesce had the store flush them: what the relay
    // hands the stories really is the store's lazy write and its flush.
    await wait(STORY_TUNING.coalesce + 500);
    st = await status();
    ok(Number((st.stories.stats as Msg).lazy) > 0 && Number((st.stories.stats as Msg).flushed) > 0, `the kill counts went into the log lazily and were flushed on the stories' coalesce (${(st.stories.stats as Msg).lazy} lazy batches, ${(st.stories.stats as Msg).flushed} flushes)`);

    // ---- the sweep, on the server's clock -------------------------------------------------------------------------
    keeper.admin('grant', { quest: 'test:timer' });
    await settle();
    ok(keeper.step('test:timer', 'tick')?.state === 'active', 'a timer granted runs on the server');
    keeper.admin('clock', { ms: 29000 });
    await settle();
    ok(keeper.step('test:timer', 'tick')?.state === 'active', 'the admin moves the story\'s clock on, short of the deadline');
    await wait(1500);
    ok(keeper.step('test:timer', 'tick')?.state === 'done' && keeper.step('test:timer', 'later')?.state === 'active', 'and the server\'s own sweep finishes the step when the deadline passes, with nobody asking');

    // ---- an offline character's deadlines, settled at its claim ----------------------------------------------------
    const e = await open('Wedge', 'c-e', { key: a.key });
    e.sync();
    await settle();
    e.admin('grant', { quest: 'test:timer' });
    await settle();
    const granted = e.step('test:timer', 'tick')!.at;
    e.close();
    await settle();
    keeper.admin('clock', { ms: 62000 });
    await settle();
    const e2 = await open('Wedge', 'c-e', { key: a.key, counter: 1 });
    e2.sync(1, 0, 1, 1);
    await settle();
    const tick = e2.step('test:timer', 'tick');
    const later = e2.step('test:timer', 'later');
    ok(tick?.state === 'done' && later?.state === 'done' && e2.step('test:timer', 'race')?.state === 'active', 'an offline character\'s deadlines are settled at its claim: the timer and the wait done, the race begun');
    ok(!!tick && !!later && tick.at === granted + 30000 && later.at === granted + 30000 + 30000, `in the order they fell, each stamped with its own deadline (${tick?.at && tick.at - granted} and ${later?.at && later.at - granted} ms after the grant)`);
    keeper.admin('clock', { ms: null });
    await settle();

    // ---- the sets read again, and the game hour ------------------------------------------------------------------
    n.admin('grant', { quest: 'long' });
    await settle();
    ok(n.quest('own:long')?.state === 'active', 'a job of the server\'s own set runs');
    // The hour is the server's own, from the clock it hands out and Tatooine's own sun: the very hour every
    // browser draws Tatooine's sky at, known with no browser saying it. Worked out here the same way, clear of
    // the end of an hour so the two cannot fall either side of it.
    const tat = PLANETS.find((p) => p.id === 'tatooine')!;
    const dayMs = Number(hail.dayMs) || 720000;
    const phaseMs = planetPhase(tat.sky.sunAzimuth, tat.sky.sunElevation) * dayMs;
    const hourMs = dayMs / 24;
    const intoHour = (((Date.now() + phaseMs) % hourMs) + hourMs) % hourMs;
    if (hourMs - intoHour < 4000) await wait(hourMs - intoHour + 250);
    const H = hourOfDay(dayFraction(Date.now(), phaseMs, dayMs));
    const W = (H + 12) % 24;
    const within = (h: number) => (h < 23 ? `gameHour() >= ${h} && gameHour() < ${h + 1}` : 'gameHour() >= 23');
    const hourJob = (id: string, needs: string, world: string) => JSON.stringify({ id, title: id, needs, givers: [{ kind: 'debug' }], start: ['go'], steps: { go: { type: 'goto', objective: 'Go', at: { world, raw: [0, 0] }, radius: 5, ends: 'done' } } });
    writeFileSync(join(own, 'quests', 'now.jsonc'), hourJob('now', within(H), 'tatooine'));
    writeFileSync(join(own, 'quests', 'later.jsonc'), hourJob('later', within(W), 'tatooine'));
    writeFileSync(join(own, 'quests', 'atfive.jsonc'), hourJob('atfive', within(5), 'nowhere'));
    writeFileSync(join(own, 'quests', 'atfive2.jsonc'), hourJob('atfive2', within(5), 'nowhere'));
    // The job running on Naboo loses the step it is in.
    writeFileSync(join(own, 'quests', 'long.jsonc'), longJob('went', 2));
    n.admin('reload');
    await settle();
    ok(n.quest('own:long')?.state === 'stalled' && n.story((m) => m.do === 'note' && /read its story again/.test(String((m.note as Msg).text))).length === 1, 'the admin has the sets read again, and a running job whose step is gone is held as revised at once rather than at its next claim');
    keeper.admin('grant', { quest: 'now' });
    keeper.admin('grant', { quest: 'later' });
    await settle();
    ok(keeper.quest('own:now')?.state === 'active' && !keeper.quest('own:later'), `the game hour a job asks about is the server's own (${H} on Tatooine just now, with no browser saying so): a job wanting it is granted, one wanting ${W} is not`);
    // Aboard one's own hull's rooms, the place a state carries is still the figure's own in the world (the
    // browser carries it through the hull's turn before sending it), so it is what is measured, not the
    // hull's middle forty metres away.
    keeper.admin('grant', { quest: 'test:waypoints' });
    await settle();
    keeper.send({ t: 'state', p: [mx, 0, mz], h: 0, s: 'idle', v: 0, veh: { id: 'yt1300', p: [mx + 40, 0, mz], q: [0, 0, 0, 1], role: 'aboard' } });
    await settle();
    keeper.ev({ k: 'arrive', world: 'tatooine', p: [3476, -4694], quest: 'test:waypoints', step: 'mark' }, { p: [3476, -4694] });
    await settle();
    ok(keeper.step('test:waypoints', 'mark')?.state === 'done', 'a player walking their own hull\'s rooms is measured where they stand, not where the hull\'s middle is');
    keeper.at(10, 0);
    await settle();
    // A world the game's list of planets does not know: there the hour is the browser's word, while it is fresh.
    const x = await open('Dash', 'c-x', { key: a.key, planet: 'nowhere' });
    x.sync();
    await settle();
    const keepWas = STORY_TUNING.hourKeep;
    STORY_TUNING.hourKeep = 400;
    try {
      x.send({ t: 'story', do: 'admin', op: 'grant', quest: 'atfive', at: { hour: 5 } });
      await settle();
      ok(x.quest('own:atfive')?.state === 'active', 'on a world the list of planets does not know, the hour the browser says is taken');
      await wait(700);
      x.send({ t: 'story', do: 'admin', op: 'grant', quest: 'atfive2', at: {} });
      await settle();
      ok(!x.quest('own:atfive2'), `but only while it is fresh (${STORY_TUNING.hourKeep} ms here): a stale hour is no hour at all`);
    } finally {
      STORY_TUNING.hourKeep = keepWas;
    }

    // ---- paying for what was done alone, with the cap ----------------------------------------------------------------
    const capWas = STORY_TUNING.settleCreditsMax;
    STORY_TUNING.settleCreditsMax = 30;
    try {
      const d = await open('Biggs', 'c-d', { key: a.key });
      d.send({ t: 'purse', do: 'ask' });
      d.sync(1, 2);
      await settle();
      ok(!!d.last('story', (m) => m.do === 'want'), 'a book played alone that the server has never seen is asked for');
      const T = Date.now() - 60000;
      const done = (completions: number) => ({ state: 'done', run: 1, at: T, completions, defRev: 1, defHash: '', steps: {}, history: [] });
      const alone = {
        ...emptyBook('c-d'),
        rev: 4,
        local: 2,
        quests: { 'test:reward': done(1), 'test:goto': done(1), 'test:kill': done(0) },
        paid: { 'test:reward#1#give': { at: T, by: 'browser' }, 'test:goto#1#paid': { at: T + 1000, by: 'browser' }, 'test:kill#3#nothing': { at: T + 2000, by: 'browser' }, 'test:goto#5#paid': { at: T + 3000, by: 'browser' } },
      };
      const startD = d.purse()!;
      await d.offer(alone);
      await settle();
      const taken = d.book();
      ok(d.purse() === startD + 25, `the rewards the browser paid alone are paid here, up to the cap a settle (${STORY_TUNING.settleCreditsMax}): the first 25 credits, not the next 10 (${startD} to ${d.purse()})`);
      ok(taken?.paid?.['test:reward#1#give']?.by === 'settle' && taken.paid['test:goto#1#paid']?.by === 'browser', 'the one paid is marked as the settle\'s, the one over the cap still the browser\'s and owed');
      ok(taken?.paid?.['test:goto#5#paid']?.by === 'browser' && taken.paid['test:kill#3#nothing']?.by === 'browser', 'and nothing is paid for a completion the book does not reach, nor for a key the set cannot read back');
      ok(d.story((m) => m.do === 'note' && /away from this server/.test(String((m.note as Msg).text))).length === 1, 'the player is told what was paid for the jobs done away');
      d.send({ t: 'items', do: 'list', rows: [] });
      await settle();
      ok((d.last('items', (m) => m.do === 'added') as { row?: { what: string } } | undefined)?.row?.what === 'shirt_s03', 'the thing the reward gave is handed over once the ledger holds the backpack it was owed into');
      d.close();
      await settle();
      // Played alone again: the book handed up carries the settle's mark relabelled as the browser's, which the
      // server's own copy overrules, and the reward still owed, which is paid now.
      const d2 = await open('Biggs', 'c-d', { key: a.key, counter: 2 });
      d2.send({ t: 'purse', do: 'ask' });
      d2.sync(1, 1, taken!.rev, 1);
      await settle();
      const second = { ...taken, local: 1, paid: { ...taken!.paid, 'test:reward#1#give': { at: T, by: 'browser' } } };
      const startD2 = d2.purse()!;
      await d2.offer(second, 1);
      await settle();
      const again = d2.book();
      ok(d2.purse() === startD2 + 10, `at the next settle the reward still owed is paid, and the one paid before is not paid again (${startD2} to ${d2.purse()})`);
      ok(again?.paid?.['test:reward#1#give']?.by === 'settle' && again.paid['test:goto#1#paid']?.by === 'settle', 'both now say the settle paid them');
      d2.close();
    } finally {
      STORY_TUNING.settleCreditsMax = capWas;
    }

    // ---- the browser's half, against the relay ---------------------------------------------------------------------
    {
      const r = await open('Porkins', 'c-r', { key: a.key });
      r.send({ t: 'items', do: 'list', rows: [] });
      r.sync();
      await settle();
      const host = new RemoteHost({ send: (m) => r.send(m), line: () => ({ host: 'server', story: 2 }), char: () => 'c-r', at: () => ({ p: [3000, -4000], room: null }), now: () => Date.now(), wall: () => Date.now(), note: () => {} });
      for (const m of r.got) if (m.t === 'story') host.word(m);
      host.grant('test:kill');
      await settle();
      for (const m of r.got) if (m.t === 'story') host.word(m);
      ok(!!host.view()?.watch.some((w) => w.k === 'kill'), 'the browser\'s own half asks the server for a job and reads back the view that watches for its kills');
      host.event({ k: 'kill', who: 'kreetle', npc: 'ours:42' });
      host.tick();
      await settle();
      ok(r.step('test:kill', 'mites')?.n === 1, 'and its kill, sent a tick late, is counted on the server');
    }

    st = await status();
    ok(Number(st.stories.jobs) >= 13 && (st.stories.sweep as { sweeps: number }).sweeps > 0 && Number((st.stories.stats as Msg).paidCredits) > 0, `the status page prints the sets, the jobs, the sweep and the payments (${st.stories.jobs} jobs, ${(st.stories.sweep as { sweeps: number }).sweeps} sweeps)`);
    for (const o of opened) o.close();
    await settle();
  } finally {
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
