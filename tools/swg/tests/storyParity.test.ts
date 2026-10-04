// One rule book, two hosts: the same scripted run of the committed test set through the browser's own host
// (src/story/localHost.ts, over the real book client) and through the server's (`Stories` in
// server/stories.mjs, over a real `Store` in a temporary folder, with real `Purses` and a real `Ledger`)
// must end in the same book and the same payments. This is the test that proves the server runs the very
// rules the browser does, rather than a second copy of them that drifts.
//
// What is driven, side by side on one clock: a reward paid once however often its step is reached; every
// hand-over word of the fourth wave (credits, a thing owned already, experience, Standing, a waypoint the
// story sets and tidies away, words); kills counted by catalogue id and by social group; a timer, a game
// hour's wait and a time limit run out in order by the deadline sweep; an arrival at a place written relative
// to where the job was taken, then at a room; twenty seconds watched in an area; a use, an area entered and
// a counted console signal joined; a harsh job dropped; and a repeat refused inside its cooldown, then taken
// with its Standing capped for the day. Then the server is started again from what it wrote down, and the
// book it reads back is the book it held.
//
// Synthetic: no browser, no socket, nothing read from the game's files.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BookClient, type StoryLine } from '../../../src/story/bookClient.ts';
import { LocalHost } from '../../../src/story/localHost.ts';
import type { PayOrder, StoryEvent } from '../../../src/story/quests.ts';
import type { StoryBook } from '../../../src/story/book.ts';
import { readStorySet } from '../../../server/storySet.mjs';
import { openStore } from '../../../server/store.mjs';
import { Purses, PURSE_TUNING } from '../../../server/purse.mjs';
import { Ledger } from '../../../server/ledger.mjs';
import { STORY_TUNING, Stories, lazyBatch } from '../../../server/stories.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (msg: string): void => console.log(`     ${msg}`);

const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));
const TEST_FILES = readStorySet(TESTSET).files;
const CHAR = 'char-1';
const CANTINA = 'object/building/tatooine/shared_cantina_tatooine.iff';
/** One shared clock for both hosts, well clear of zero. */
const clock = { now: 1_800_000_000_000 };
/** Where the player stands, the same for both: the raw frame on Tatooine, a room, and the areas stood in. */
const here = { x: 3000, z: -4000, room: null as { cell: string; template?: string } | null, areas: [] as string[] };

// ---- the browser's own host -----------------------------------------------------------------------------
const store = new Map<string, string>();
const storage = { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => (store.set(k, v), true), remove: (k: string) => void store.delete(k) };
const line: StoryLine = { authority: 'me', story: 0, status: 'off', mode: 'off' };
const client = new BookClient({ store: storage, send: () => {}, say: () => {}, now: () => clock.now, wall: () => clock.now, line: () => line, known: () => false });
const localPurse = { credits: PURSE_TUNING.start };
const localOwned = new Set<string>(['wear:shirt_s03']);
const localPaid: PayOrder[] = [];
const local: LocalHost = new LocalHost({
  book: () => client.book,
  holds: () => !!client.book && client.holdsHere(),
  apply: (ch) => client.applyLocal(ch),
  pay: (o) => {
    if (o.credits) {
      localPurse.credits += o.credits;
      localPaid.push(o);
      return true;
    }
    if (o.item) {
      const k = `${o.item.kind}:${o.item.id}`;
      if (localOwned.has(k)) return false;
      localOwned.add(k);
      localPaid.push(o);
    }
    return true;
  },
  note: () => {},
  ctx: () => ({ world: 'tatooine', here: [here.x, here.z], room: here.room, areas: [...here.areas], credits: localPurse.credits, has: (k: string, id: string) => (localOwned.has(`${k}:${id}`) ? 1 : 0) }),
  now: () => clock.now,
  wall: () => clock.now,
  inWorld: () => true,
});
client.onChange(() => local.changed());
client.use(CHAR);
local.setSets({ test: TEST_FILES });

// ---- the server's host --------------------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'swg-story-parity-'));
const disk = openStore({ dir, saveEvery: 0, now: () => clock.now });
const purses = new Purses({ write: (rec: object) => disk.change(rec) });
purses.load(disk.data);
const ledger = new Ledger({ now: () => clock.now, write: (rec: object) => disk.change(rec) });
ledger.load(disk.data);
// The backpack is handed up first, as a browser hands its own up at a claim: the plain shirt the starting kit gave.
ledger.settle(CHAR, [{ kind: 'wear', what: 'shirt_s03', got: 1 }]);
const serverOut: { to: number; msg: Record<string, unknown> }[] = [];
/** Every record the stories handed the store, with whether it was handed over as a counter's, to be flushed lazily. */
type Written = { rec: { t: string; ch?: { k: string; quest?: string; rec?: { state?: string; n?: number } }[] }; lazy: boolean };
const writes: Written[] = [];
const stories = new Stories({
  tuning: STORY_TUNING,
  write: (rec: object, lazy?: boolean) => {
    writes.push({ rec: rec as Written['rec'], lazy: !!lazy });
    return disk.change(rec, { lazy: !!lazy });
  },
  flush: () => disk.flush(),
  now: () => clock.now,
  purses,
  ledger,
  read: () => ({ test: TEST_FILES, own: null }),
  admin: () => true,
  tests: true,
});
stories.load(disk.data);
stories.readSets();
const conn = { id: 1, character: CHAR, keep: 'server', asking: null, hello: { planet: 'tatooine', zone: '', species: 'human_male' }, state: null };
const told = (r: { tell?: { to: number; msg: Record<string, unknown> }[] }) => {
  for (const t of r.tell ?? []) serverOut.push(t);
  return r;
};
told(stories.hear(conn, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 }));
ok(stories.lines.get(1)?.ready === true && !!stories.bookOf(CHAR), 'the server settles a new book on the line and runs its jobs');

// ---- one script, both hosts ---------------------------------------------------------------------------------
/** Where the player stood, as the server is told it with every event. */
const at = () => ({ p: [here.x, here.z], room: here.room });
/** The same event to both hosts. */
function both(ev: StoryEvent): void {
  local.event(ev);
  told(stories.hear(conn, { t: 'story', do: 'ev', ev, at: at() }));
}
/** A console signal: the browser's host raises it, the server takes it from its admin. */
function signal(name: string): void {
  local.event({ k: 'signal', name });
  told(stories.hear(conn, { t: 'story', do: 'admin', op: 'signal', name, at: at() }));
}
/** A job granted at the console: the server is told where the player stood, which a relative place is measured from. */
function grant(quest: string): { local: string | undefined; server: string | undefined } {
  const a = local.grant(quest);
  const r = told(stories.hear(conn, { t: 'story', do: 'admin', op: 'grant', quest, at: at() })) as { why?: string };
  return { local: a.why, server: r.why };
}
/** Time passes on the one clock, and both hosts sweep their deadlines. */
function pass(ms: number): void {
  clock.now += ms;
  local.sweep();
  told(stories.tick(Date.now() + 1e9));
  stories.lastSweep = 0;
}
// The server's allowance of words a second is a browser's guard, not a rule: this script says far more in a
// second of its own clock than any browser could, so the window is reset between its words.
const hearAll = stories.hear.bind(stories);
stories.hear = (c: unknown, msg: unknown) => {
  stories.windows.delete(1);
  return hearAll(c, msg);
};

// A reward, paid once however often its step is reached.
grant('test:reward');
signal('debug:test-again');
signal('debug:test-finish');
// The fourth wave's words.
grant('test:words');
signal('debug:test-hand');
signal('debug:test-tidy');
// Kills, by catalogue id and by social group, of bodies nobody else knows. The first is a counter moving and
// nothing more: it goes into the log without the disk being asked to keep it, until the stories' own
// `coalesce` comes round (the sweep is held off for that one tick, so both hosts still see the same time).
grant('test:kill');
both({ k: 'kill', who: 'kreetle', npc: 'ours:1' });
const unflushedAfterKill = disk.unflushed;
stories.lastSweep = clock.now + 1e12;
stories.lastFlush = 0;
stories.tick(clock.now + 1e12);
stories.lastSweep = 0;
stories.lastFlush = 0;
ok(unflushedAfterKill && !disk.unflushed && stories.stats.flushed === 1, 'a kill counted is in the log unflushed, and the stories\' coalesce flushes it');
for (let i = 2; i <= 3; i++) both({ k: 'kill', who: 'kreetle', npc: `ours:${i}` });
for (let i = 4; i <= 5; i++) both({ k: 'kill', who: 'womprat', social: 'rat', npc: `ours:${i}` });
// Clocks: a timer, a game hour, then a time limit run out into its failure.
grant('test:timer');
pass(31000);
pass(31000);
pass(61000);
// An arrival at a place relative to where the job was taken, then at a room.
both({ k: 'world', world: 'tatooine' });
grant('test:goto');
here.x += 30;
both({ k: 'arrive', world: 'tatooine', p: [here.x, here.z], quest: 'test:goto', step: 'outdoor' });
here.x = 3432;
here.z = -4818;
here.room = { cell: 'cantina', template: CANTINA };
both({ k: 'room', template: CANTINA, cell: 'cantina' });
here.room = null;
// Twenty seconds watched in an area.
grant('test:observe');
here.x = 3476;
here.z = -4694;
here.areas = ['test:area/test-square'];
both({ k: 'area', area: 'test:area/test-square', inside: true });
pass(21000);
// A use, an area entered and a counted console signal, joined.
grant('test:signal');
both({ k: 'use', object: 'test:obj/test-terminal' });
both({ k: 'area', area: 'test:area/test-square', inside: true });
signal('debug:test-ping');
signal('debug:test-ping');
signal('debug:test-ping');
// A harsh job dropped ends as its failure.
grant('test:harsh');
local.drop('test:harsh');
told(stories.hear(conn, { t: 'story', do: 'q', op: 'drop', quest: 'test:harsh', at: at() }));
// A repeat refused inside its cooldown, then taken with its Standing capped for the day.
grant('test:repeat');
const again = grant('test:repeat');
ok(!!again.local && again.local === again.server, `a repeat inside its cooldown is refused alike by both (${again.server})`);
pass(121000);
grant('test:repeat');

// ---- the same book, the same payments ---------------------------------------------------------------------
const mine = client.book as StoryBook;
const theirs = stories.bookOf(CHAR) as StoryBook;
/** A book as both hosts must agree on it: everything but who it says paid each reward, and the counters of who holds it. */
const comparable = (b: StoryBook) => {
  const paid: Record<string, number> = {};
  for (const k of Object.keys(b.paid ?? {})) paid[k] = b.paid![k].at;
  const quests: Record<string, unknown> = {};
  for (const k of Object.keys(b.quests ?? {}).sort()) quests[k] = b.quests![k];
  return JSON.stringify({ quests, flags: { ...(b.flags ?? {}) }, paid, xp: b.xp ?? 0, tracks: b.tracks ?? {}, closed: b.closed ?? [], waypoints: b.waypoints, nextWp: b.nextWp, tracked: b.tracked, wpOff: b.wpOff });
};
const states = (b: StoryBook) =>
  Object.keys(b.quests ?? {})
    .sort()
    .map((q) => `${q.slice(5)}:${b.quests![q].state}${b.quests![q].outcome ? `/${b.quests![q].outcome}` : ''}`)
    .join(' ');
ok(states(mine) === states(theirs), `every job ends in the same state on both hosts (${states(theirs)})`);
// The goto was done once and is running again: the terminal used for the signals is the one that gives it.
ok(['reward:done', 'words:done', 'kill:done', 'timer:failed/late', 'goto:active', 'observe:done', 'signal:done', 'harsh:failed/failed', 'repeat:done'].every((s) => states(theirs).includes(s)) && theirs.quests?.['test:goto']?.completions === 1, 'and in the state each script meant: the reward, the words, the kills, the watch and the signals done, the timer late, the harsh job failed, the repeat done, and the goto done once and taken again at the terminal that gives it');
// Where the two books part, printed before the failure, since a failure that only says "not the same" is
// a book to read by hand.
if (comparable(mine) !== comparable(theirs)) {
  const a = comparable(mine);
  const b = comparable(theirs);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  note(`the books part at character ${i}:\n       browser: ${a.slice(Math.max(0, i - 200), i + 200)}\n       server:  ${b.slice(Math.max(0, i - 200), i + 200)}`);
}
ok(comparable(mine) === comparable(theirs), 'the two books are the same, job for job, step for step, reward for reward');
ok(Object.keys(theirs.paid ?? {}).length > 0 && Object.values(theirs.paid ?? {}).every((p) => p.by === 'server') && Object.values(mine.paid ?? {}).every((p) => p.by === 'browser'), 'every reward the server paid says so, and every one the browser paid says that');
ok(mine.rev === theirs.rev, `both books moved by the same batches (rev ${theirs.rev})`);

const localCredits = localPaid.reduce((n, o) => n + (o.credits ?? 0), 0);
const serverCredits = purses.of(CHAR) - PURSE_TUNING.start;
ok(localCredits > 0 && localCredits === serverCredits, `the same credits were paid by both (${serverCredits})`);
ok(localPurse.credits === purses.of(CHAR), 'and both purses stand at the same balance');
ok(!localPaid.some((o) => o.item) && ledger.listFor(CHAR).length === 1, 'the shirt owned already was given by neither: a character keeps one of each');
ok(theirs.xp === mine.xp && (theirs.xp ?? 0) === 10 + 3 + 5, `the same experience recorded by both (${theirs.xp})`);
ok(theirs.tracks?.freelance?.standing === mine.tracks?.freelance?.standing && theirs.tracks?.freelance?.standing === 5 + 2 + 10 + 20 + 10, `and the same Standing, the second repeat capped at the day's thirty (${theirs.tracks?.freelance?.standing})`);
const paidNotes = serverOut.filter((t) => t.msg.do === 'note' && (t.msg.note as { k: string }).k === 'paid');
ok(paidNotes.length === localPaid.filter((o) => o.credits).length && paidNotes.every((t) => t.msg.given === 1), 'the server says each payment it made, and that it arrived');
ok(serverOut.filter((t) => t.msg.t === 'purse').length === paidNotes.length, 'and each went through the purse, which told the browser its new balance');
ok(stories.stats.lazy > 0 && stories.stats.batches > stories.stats.lazy, `kill counts were written lazily and everything else at once (${stories.stats.lazy} of ${stories.stats.batches} batches)`);
// What the store was really told, record by record, rather than the stories' own tally of what they decided.
const batches = writes.filter((w) => w.rec.t === 'story');
const killCounts = batches.filter((w) => w.rec.ch?.length && w.rec.ch.every((c) => c.k === 'step' && c.quest === 'test:kill' && c.rec?.state === 'active' && (c.rec.n ?? 0) > 0));
ok(killCounts.length > 0 && killCounts.every((w) => w.lazy), `every batch that only counted a kill went to the store lazily (${killCounts.length} of them)`);
const weighty = batches.filter((w) => w.rec.ch?.some((c) => c.k === 'paid' || c.k === 'qState' || (c.k === 'step' && c.rec?.state !== 'active')));
ok(weighty.length > 0 && weighty.every((w) => !w.lazy), `and every batch that paid, moved a job or finished a step went at once (${weighty.length} of them)`);
ok(writes.filter((w) => w.rec.t !== 'story').every((w) => !w.lazy), 'as did every book taken whole and every book put away');
ok(!lazyBatch([{ k: 'step', quest: 'q', step: 's', rec: { state: 'active', n: 1 } }, { k: 'paid', key: 'q#1#s', at: 1, by: 'server' }]) && lazyBatch([{ k: 'step', quest: 'q', step: 's', rec: { state: 'active', n: 1 } }]) && !lazyBatch([{ k: 'step', quest: 'q', step: 's', rec: { state: 'done', n: 1 } }]) && !lazyBatch([]), 'a batch is lazy only when every change in it is a step still running: one that also pays, one that finishes and one that is empty are not');

// ---- what the server wrote down, read back ----------------------------------------------------------------------
disk.flush();
const kept = JSON.parse(JSON.stringify(theirs));
// The world is not closed (a snapshot would hide the log): a second store reads the log the first wrote.
const again2 = openStore({ dir, saveEvery: 0, now: () => clock.now });
const back = new Stories({ write: (rec: object) => again2.change(rec) }).load(again2.data).bookOf(CHAR);
ok(!!back && comparable(back as StoryBook) === comparable(kept) && (back as StoryBook).rev === kept.rev, 'a server started again from its log reads back the very book it held');
again2.close();
disk.close();
rmSync(dir, { recursive: true, force: true });

console.log(`\n${checks} checks passed`);
