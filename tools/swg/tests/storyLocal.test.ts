// The story held by this browser alone (src/story/localHost.ts), driven over the committed test set through
// the real book client (src/story/bookClient.ts) and the real detectors (src/world/storyWatch.ts), with a
// world, a purse, a backpack and a storage of the test's own.
//
// What is pinned here:
//
//   - nothing is worked out before a set is read: a book's jobs are never held as revised away for want of
//     a set that has not arrived yet;
//   - an arrival, a room, an area watched for twenty seconds, a story object used, kills and a death each
//     move the job waiting on them, through the detectors exactly as the game feeds them;
//   - the detectors raise what stays true again only after `repeatEv`, so standing still is not a flood;
//   - a story object is found where the world really places its template, about the object's own point
//     turned into the world's frame, the nearest on the world stood on, looked for again a little later;
//   - a reward is paid once whatever happens twice, and a thing owned already is said rather than given;
//   - the fourth wave's words hand over credits, a thing, experience, Standing, a waypoint and words, and
//     read credits, a thing owned and Standing; each that pays pays once per completion, however often
//     its step is begun again, and a waypoint a story sets is the story's and never one the player set;
//   - a tracked job leaves the tracked list when it ends or is dropped, and with none tracked the newest shows;
//   - deadlines that fell while the character was away are settled at load, in order, each at its own time,
//     and the frame loop's own tick sweeps them in play;
//   - a played clock counts only while the character is in the world, whichever way it was begun;
//   - every change the host makes is a change made here (`local`), and only then does the character's
//     change counter move (`characterMark`);
//   - while a server holds the book, nothing here works it out, and nor against a server that keeps the
//     credits but holds no story (a reward recorded as paid there would never arrive);
//   - leaving every area on the way somewhere else closes an observe step's watch;
//   - the server's word of a death carries who struck it through to the wiring (`Owned.onGone`);
//   - every payment goes through the game's own `payLocally`, and a price is taken out of the real purse at
//     once, refused when it cannot be met and never taken out of (nor credits put into) a purse a server keeps;
//   - a conversation through this host: refused with no conversation open or to somebody else, its nodes handed
//     to the listener before the call returns, a price charged out of the purse every time it is chosen and
//     said, and one the purse would not give said as not spent;
//   - a document through this host: handed to the window, frozen by its words' hash in the store handed in or in
//     the host itself, read again as that very page, and read to its end; and a conversation's transcript
//     written here as its window closes, once.
//
// Synthetic: no browser, no socket, nothing read from the game's files.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BookClient, STORY_TUNE, type StoryLine } from '../../../src/story/bookClient.ts';
import { JOBS_WAIT_CREDITS, LocalHost, jobsWait, payLocally, type TextKeep } from '../../../src/story/localHost.ts';
import type { DocWord } from '../../../src/story/docRules.ts';
import type { NodeWord } from '../../../src/story/storyHost.ts';
import { Purse } from '../../../src/net/purse.ts';
import { noteWords } from '../../../src/story/notes.ts';
import type { PayOrder, StoryEvent } from '../../../src/story/quests.ts';
import { questWaypointId } from '../../../src/story/view.ts';
import { textOf } from '../../../src/story/text.ts';
import { StoryWatch, type WatchPlace } from '../../../src/world/storyWatch.ts';
import { STAND_TUNE, StoryStands } from '../../../src/world/storyStands.ts';
import { pickShown } from '../../../src/ui/tracker.ts';
import type { QuestView } from '../../../src/story/view.ts';
import { characterMark } from '../../../src/net/session.ts';
import { Owned } from '../../../src/net/owned.ts';
import { readStorySet } from '../../../server/storySet.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));
const TEST_FILES = readStorySet(TESTSET).files;
/** A fixed shared-clock time to start from, well clear of zero. */
const T0 = 1_800_000_000_000;
const CANTINA = 'object/building/tatooine/shared_cantina_tatooine.iff';

/** One whole stand-in game: a storage, a book client, a host, a world, a purse, a backpack and the detectors. */
function game(opts: { sets?: boolean; own?: { path: string; text: string }[]; refuseCharges?: boolean; texts?: TextKeep } = {}) {
  const store = new Map<string, string>();
  const storage = { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => (store.set(k, v), true), remove: (k: string) => void store.delete(k) };
  const clock = { now: T0, wall: 1000 };
  const line: StoryLine = { authority: 'me', story: 0, status: 'off', mode: 'off' };
  const world: WatchPlace & { inWorld: boolean } = { world: 'tatooine', x: 3000, z: -4000, room: null, inWorld: true };
  const purse = { credits: 25000 };
  // The starting kit's own plain shirt is owned already.
  const owned = new Set<string>(['wear:shirt_s03']);
  const paid: PayOrder[] = [];
  const said: string[] = [];
  const client = new BookClient({ store: storage, send: () => {}, say: (t) => said.push(t), now: () => clock.now, wall: () => clock.wall, line: () => line, known: () => false });
  const watch = new StoryWatch();
  // Asked as the game asks it (`App.storyJobsWait`): a character in play, the book held here, and no server
  // keeping the character's credits.
  const why = () => jobsWait({ inPlay: !!client.book, holdsBook: client.holdsHere(), authority: line.authority });
  const host: LocalHost = new LocalHost({
    book: () => client.book,
    holds: () => why() === null,
    whyNot: why,
    apply: (ch) => client.applyLocal(ch),
    // Through the very function the game pays with (`payLocally`), over a purse and a backpack of the test's own.
    pay: (o) => {
      paid.push(o);
      // A purse that will not give what a price asks: what a charge spent elsewhere in the same moment meets.
      if (opts.refuseCharges && o.charge) return false;
      return payLocally(o, {
        serverKeeps: () => line.authority === 'server',
        credits: () => purse.credits,
        give: (n) => void (purse.credits += n),
        spend: (n, then) => {
          if (purse.credits < n) return;
          purse.credits -= n;
          then();
        },
        item: (kind, id) => {
          const k = `${kind}:${id}`;
          if (owned.has(k)) return false;
          owned.add(k);
          return true;
        },
      });
    },
    note: (n, given) => {
      const w = noteWords(n, host.library, { text: (r) => textOf(r) }, given);
      if (w) said.push(w);
    },
    ctx: () => ({ world: world.world, here: [world.x, world.z], room: world.room, areas: [...watch.inside], credits: purse.credits, has: (k: string, id: string) => (owned.has(`${k}:${id}`) ? 1 : 0) }),
    now: () => clock.now,
    wall: () => clock.wall,
    inWorld: () => world.inWorld,
    ...(opts.texts ? { texts: opts.texts } : {}),
  });
  client.onChange(() => host.changed());
  client.use('char-1');
  if (opts.sets !== false) host.setSets({ test: TEST_FILES, own: opts.own ?? null });
  const events: StoryEvent[] = [];
  /** One tick of the frame loop's story step: the host's own, then the detectors over the view. */
  const tick = () => {
    host.tick();
    watch.step(host.view(), world, clock.wall, (ev) => {
      events.push(ev);
      host.event(ev);
    });
  };
  const q = (id: string) => client.book?.quests?.[id];
  const stepOf = (id: string, s: string) => client.book?.quests?.[id]?.steps[s];
  return { store, storage, clock, line, world, purse, owned, paid, said, client, watch, host, events, tick, q, stepOf };
}

// ---- nothing before a set is read --------------------------------------------------------------------------
{
  const g = game({ sets: false });
  ok(g.host.view() === null && g.host.grant('test:goto').why === 'the story has not been read yet', 'before a set is read there is no view, and nothing can be granted');
  const before = g.client.book!.rev;
  g.tick();
  g.host.event({ k: 'death' });
  ok(g.client.book!.rev === before && g.host.stats.dropped === 1, 'and what the detectors see is dropped and counted, the book left as it was');
  g.host.setSets({ test: TEST_FILES });
  ok(!!g.host.view() && g.host.report().ready === true && (g.host.report().sets as { name: string }[])[0].name === 'test', 'once the test set is read, the view is there');
}

// ---- a book read with jobs in it, before its set: never held as revised away ----------------------------------
{
  const g = game();
  g.host.grant('goto');
  ok(g.q('test:goto')?.state === 'active', 'a job granted by its name alone, the prefix found for it');
  const text = g.store.get('swg.story.char-1')!;
  // The same storage read by a new client and a host that has read no set yet.
  const g2 = game({ sets: false });
  g2.store.set('swg.story.char-1', text);
  g2.client.use(null);
  g2.client.use('char-1');
  g2.tick();
  ok(g2.q('test:goto')?.state === 'active', 'a book read before any set is held to nothing: its job is still running, not held as revised away');
  g2.host.setSets({ test: TEST_FILES });
  ok(g2.q('test:goto')?.state === 'active' && g2.q('test:goto')?.why === undefined, 'and once the set arrives it carries straight on');
}

// ---- test:goto: an arrival, then a room, then a reward ------------------------------------------------------
{
  const g = game();
  const r = g.host.grant('test:goto');
  ok(r.ok && g.q('test:goto')?.state === 'active' && g.said.includes('Job: TEST: go to a place') && g.said.includes('Objective: TEST: walk to the marker'), 'granted: the message line says a job was taken and its first objective');
  ok(g.client.local > 0 && g.client.book!.local === g.client.local, `every change the host makes is a change made here (local ${g.client.local})`);
  const view = g.host.view()!;
  ok(view.waypoints.some((w) => w.id === questWaypointId('test:goto', 'outdoor') && w.on) && view.watch.some((w) => w.k === 'arrive' && w.step === 'outdoor'), "the view carries the step's own waypoint and tells the detectors to watch for the arrival");
  g.tick();
  ok(g.stepOf('test:goto', 'outdoor')?.state === 'active', 'standing where the job was taken is not arriving 30 m along');
  g.world.x += 29;
  g.tick();
  ok(g.stepOf('test:goto', 'outdoor')?.state === 'done' && g.said.includes('Reached TEST: walk to the marker'), 'walked to the marker: the step is done, and the message line says the place is reached');
  ok(g.stepOf('test:goto', 'cantina')?.state === 'active' && g.said.includes('Objective: TEST: go into the cantina'), 'and the next objective is set and said');
  // At the cantina's place but in the street: not yet.
  g.world.x = 3432;
  g.world.z = -4818;
  g.tick();
  ok(g.stepOf('test:goto', 'cantina')?.state === 'active', 'at the cantina but outside it: the room is what is asked for');
  const credits = g.purse.credits;
  g.world.room = { cell: 'cantina', template: CANTINA };
  g.clock.wall += 300;
  g.tick();
  ok(g.q('test:goto')?.state === 'done' && g.events.some((e) => e.k === 'room' && e.cell === 'cantina' && e.template === CANTINA), 'stepping into the cantina raises the room and finishes the job');
  ok(g.purse.credits === credits + 10 && g.said.includes('Paid 10 credits') && g.said.some((s) => /^Experience 5 recorded/.test(s)) && g.said.includes('Freelance standing rose') && g.said.includes('Done: TEST: go to a place'), 'and the reward is paid out of the purse, and said: credits, experience, which way Standing moved, and the job done');
  ok(g.client.book!.xp === 5 && g.client.book!.tracks?.freelance?.standing === 10, 'experience and Standing are recorded in the book');
}

// ---- the detectors raise what stays true again only after repeatEv --------------------------------------------
{
  const g = game();
  g.host.grant('test:observe');
  g.world.x = 3476;
  g.world.z = -4694;
  g.tick();
  const n0 = g.events.filter((e) => e.k === 'area').length;
  ok(n0 === 1 && g.watch.inside.includes('test:area/test-square') && g.stepOf('test:observe', 'watch')?.since === T0, 'stepping into the test square is raised once, and the watch opens');
  g.clock.wall += STORY_TUNE.repeatEv / 2;
  g.tick();
  ok(g.events.filter((e) => e.k === 'area').length === n0, 'standing still in it raises nothing more within repeatEv');
  g.clock.wall += STORY_TUNE.repeatEv;
  g.tick();
  ok(g.events.filter((e) => e.k === 'area').length === n0 + 1 && g.stepOf('test:observe', 'watch')?.since === T0, 'and once more after it, which the watch already open takes as nothing');
  // Out after five seconds: said once, on the edge, and the five seconds kept.
  g.clock.now += 5000;
  g.world.x = 3000;
  g.tick();
  g.clock.wall += STORY_TUNE.repeatEv * 2;
  g.tick();
  ok(g.events.filter((e) => e.k === 'area' && !e.inside).length === 1 && !g.watch.inside.length && g.stepOf('test:observe', 'watch')?.n === 5000, 'stepping out is said once, on the edge, and the time watched is kept');
  // Back in, and fifteen seconds more on the shared clock: the sweep finishes the watch.
  g.world.x = 3476;
  g.tick();
  g.clock.now += 15500;
  g.host.sweep();
  ok(g.q('test:observe')?.state === 'done' && g.said.includes('Done: TEST: watch a place'), 'twenty seconds in the square over two visits, swept: the job is done');
  g.world.x = 3000;
  g.tick();
  ok(g.events.filter((e) => e.k === 'area' && !e.inside).length === 1 && !g.watch.inside.length, 'and an area no job watches any more is forgotten without a word');
}

// ---- use, kills and death --------------------------------------------------------------------------------------
{
  const g = game();
  g.host.grant('test:signal');
  const view = g.host.view()!;
  ok(view.objects.some((o) => o.id === 'test:obj/test-terminal') && view.watch.some((w) => w.k === 'use' && w.object === 'test:obj/test-terminal'), 'a job waiting on the test terminal puts it among the things the story stands');
  // The thing found among what the world places: the stand-in world holds things where the snapshot put them,
  // in the world's frame about a layout centre of its own, and answers only for a point it is really asked
  // about -- the nearest thing of the template within the reach given -- as `World.placedNear` does.
  const TERMINAL = 'object/tangible/terminal/shared_terminal_mission.iff';
  const centre = { x: -1376, z: -3576 };
  const gameAt = (rx: number, rz: number, y = 10) => ({ x: -(rx - centre.x), y, z: rz - centre.z });
  const placed: { template: string; x: number; y: number; z: number }[] = [{ template: TERMINAL, ...gameAt(3475.7, -4694.1) }];
  const asks: [number, number][] = [];
  const deps = {
    placed: (template: string, x: number, _y: number, z: number, reach: number) => {
      asks.push([x, z]);
      let best: { x: number; y: number; z: number } | null = null;
      let bestD = Infinity;
      for (const p of placed) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (p.template === template && d <= reach && d < bestD) {
          best = p;
          bestD = d;
        }
      }
      return best;
    },
  };
  const terminal = placed[0];
  const stands = new StoryStands();
  ok(stands.near(view.objects, 'tatooine', 1, centre, terminal.x + 1, 10, terminal.z, 0, deps)?.id === 'test:obj/test-terminal', 'standing a metre from it, it is the thing the use key would work');
  const want = gameAt(3476, -4694);
  ok(asks.length === 1 && Math.abs(asks[0][0] - want.x) < 1e-9 && Math.abs(asks[0][1] - want.z) < 1e-9, `and the world was asked about the object's own point turned into its frame, X mirrored about the layout centre (${asks[0].map((n) => n.toFixed(1)).join(', ')})`);
  ok(stands.near(view.objects, 'tatooine', 1, centre, terminal.x + 5, 10, terminal.z, 0, deps) === null && stands.near(view.objects, 'tatooine', 1, centre, terminal.x, 16, terminal.z, 0, deps) === null && asks.length === 1, 'five metres off, or a floor above, it is not; and it was looked for once and kept');
  // Two objects of the story's own on one world, and one on another world with the very same numbers: the
  // nearest on the world stood on is the one, whatever order they come in.
  const obj = (id: string, world: string, near: [number, number]) => ({ id, world, template: TERMINAL, near, reach: 3, label: id });
  placed.push({ template: TERMINAL, ...gameAt(3478, -4694) });
  const objects = [obj('test:obj/elsewhere', 'naboo', [3476, -4694]), obj('test:obj/near', 'tatooine', [3476, -4694]), obj('test:obj/far', 'tatooine', [3478, -4694])];
  const s2 = new StoryStands();
  ok(s2.near(objects, 'tatooine', 1, centre, terminal.x - 0.5, 10, terminal.z, 0, deps)?.id === 'test:obj/near', 'of two in reach the nearer is the one, and an object on another world is never in reach, even at the same numbers');
  ok(s2.near(objects, 'tatooine', 1, centre, gameAt(3478, -4694).x + 0.5, 10, terminal.z, 0, deps)?.id === 'test:obj/far', 'and standing by the other, the other is');
  // A thing not found yet (the pack still on its way) is looked for again once `retry` has gone by, and
  // everything is looked for afresh on a new world.
  const late = [obj('test:obj/late', 'tatooine', [3600, -4600])];
  const s3 = new StoryStands();
  const lateAt = gameAt(3600, -4600);
  const n0 = asks.length;
  ok(s3.near(late, 'tatooine', 1, centre, lateAt.x, 10, lateAt.z, 1000, deps) === null && asks.length === n0 + 1, 'a thing the world does not have yet is not found');
  placed.push({ template: TERMINAL, ...lateAt });
  ok(s3.near(late, 'tatooine', 1, centre, lateAt.x, 10, lateAt.z, 1000 + STAND_TUNE.retry - 1, deps) === null && asks.length === n0 + 1, 'and is not asked for again within retry');
  ok(s3.near(late, 'tatooine', 1, centre, lateAt.x, 10, lateAt.z, 1000 + STAND_TUNE.retry, deps)?.id === 'test:obj/late' && asks.length === n0 + 2, 'once retry has gone by it is looked for again, and found');
  ok(s3.near(late, 'tatooine', 2, centre, lateAt.x, 10, lateAt.z, 1000 + STAND_TUNE.retry, deps)?.id === 'test:obj/late' && asks.length === n0 + 3, 'and on a new world everything is looked for afresh');
  g.host.event({ k: 'use', object: 'test:obj/test-terminal' });
  ok(g.stepOf('test:signal', 'poke')?.state === 'done' && g.said.includes('Objective done: TEST: use the test terminal'), 'E on it raises used:<object>, the step waiting on it is done, and the message line says the objective is done');
  for (let i = 0; i < 3; i++) g.host.event({ k: 'signal', name: 'debug:test-ping' });
  ok(g.stepOf('test:signal', 'ping')?.state === 'done', 'a console signal sent three times finishes the counted step');

  g.host.grant('test:kill');
  const kill = (who: string, npc: string, social?: string) => g.watch.kill(g.host.view(), { who, npc, ...(social ? { social } : {}) }, g.clock.wall, (ev) => g.host.event(ev));
  ok(kill('kreetle', 'wild:a:1') && !kill('kreetle', 'wild:a:1') && g.watch.stats.sameKill === 1, 'a kill is handed on once, and a second word of the same body is the same kill');
  kill('kreetle', 'wild:a:2');
  kill('kreetle', 'wild:a:3');
  ok(g.stepOf('test:kill', 'mites')?.state === 'done' && g.stepOf('test:kill', 'mites')?.n === 3, 'three of the creature, three kills, and the step is done');
  ok(!kill('bantha', 'wild:b:1') && g.watch.stats.ignoredKills === 1, 'a body no job counts is not handed on at all');
  kill('womp_rat', 'wild:r:1', 'rat');
  kill('womp_rat', 'wild:r:2', 'rat');
  ok(g.q('test:kill')?.state === 'done', 'two of the social group, and the job is done');

  const own = [
    { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' },
    { path: 'quests/brave.jsonc', text: JSON.stringify({ id: 'brave', title: 'TEST: do not die', givers: [{ kind: 'debug' }], start: ['live'], steps: { live: { type: 'signal', signal: 'debug:brave-done', failOn: ['death'], ends: 'done' } } }) },
  ];
  const d = game({ own });
  d.host.grant('own:brave');
  ok(d.watch.death(d.host.view(), (ev) => d.host.event(ev)) && d.q('own:brave')?.state === 'failed' && d.said.includes('Failed: TEST: do not die'), 'the player dying fails a step that fails on death, and the message line says so');
  ok(!d.watch.death(d.host.view(), (ev) => d.host.event(ev)), 'and with nothing failing on death, a death is not handed on');
}

// ---- a reward paid once; a thing owned already said, not given -------------------------------------------------
{
  const g = game();
  const credits = g.purse.credits;
  g.host.grant('test:reward');
  ok(g.purse.credits === credits + 25 && g.said.includes('Paid 25 credits') && g.said.includes('shirt s03: owned already, so nothing more was given'), 'the reward pays its credits, and the shirt owned already is said rather than given twice');
  g.host.event({ k: 'signal', name: 'debug:test-again' });
  ok(g.stepOf('test:reward', 'give')?.state === 'done' && g.purse.credits === credits + 25 && g.paid.length === 2, 'looped round to the reward step in the same run: nothing more is paid');
  g.host.restart('test:reward');
  ok(g.purse.credits === credits + 25 && g.paid.length === 2, 'nor when the job is started over');
}

// ---- the fourth wave's words -----------------------------------------------------------------------------------
{
  const g = game();
  const credits = g.purse.credits;
  g.host.grant('test:words');
  g.host.event({ k: 'signal', name: 'debug:test-hand' });
  const wp = g.client.book!.waypoints.find((w) => w.name === "TEST: the job's own waypoint");
  ok(g.purse.credits === credits + 5 && g.client.book!.xp === 3 && g.client.book!.tracks?.freelance?.standing === 2, 'pay, xp and standing hand over credits, experience and Standing');
  ok(!!wp && wp.id === 'w1' && wp.f === 'raw' && wp.p[0] === 3476 && wp.colour === 'component' && g.said.includes('TEST: said by the job'), 'waypoint sets one of the character\'s own, minted by the host, and say says its words');
  ok(g.stepOf('test:words', 'rich')?.state === 'active', 'and the fork reads what the character has: credits, the shirt, the Standing just given');
  // Begun again within the same completion -- started over, then dropped and taken again -- the hand-over
  // step pays nothing it paid already: each action that hands something over is a reward of its own, keyed
  // by where it is written, and the waypoint it set is already there.
  g.host.restart('test:words');
  g.host.event({ k: 'signal', name: 'debug:test-hand' });
  ok(g.q('test:words')?.run === 2 && g.stepOf('test:words', 'hand')?.state === 'done', 'started over, the hand-over step is done again in the new run');
  g.host.drop('test:words');
  g.host.grant('test:words');
  g.host.event({ k: 'signal', name: 'debug:test-hand' });
  ok(g.purse.credits === credits + 5 && g.paid.filter((p) => p.credits === 5).length === 1 && g.client.book!.xp === 3 && g.client.book!.tracks?.freelance?.standing === 2, 'started over, and dropped and taken again: the credits, the experience and the Standing are each paid once');
  ok(g.client.book!.waypoints.filter((w) => w.name === "TEST: the job's own waypoint").length === 1, 'and the waypoint is set once');
  g.host.event({ k: 'signal', name: 'debug:test-tidy' });
  ok(!g.client.book!.waypoints.some((w) => w.name === "TEST: the job's own waypoint") && g.q('test:words')?.state === 'done' && g.said.includes('Done: TEST: what a job hands over'), 'waypointGone takes it away by the name the job gave it, and the job is done');
  g.purse.credits = 0;
  g.owned.clear();
  g.host.grant('test:words');
  g.host.event({ k: 'signal', name: 'debug:test-hand' });
  ok(g.q('test:words')?.state === 'failed' && g.q('test:words')?.outcome === 'poor' && g.paid.filter((p) => p.credits === 5).length === 2, 'with nothing to spend and no shirt, the fork goes the other way; a second completion pays again');
  ok(g.said.includes('Failed: TEST: what a job hands over (poor)'), 'and the message line names the way it failed');
}

// ---- an action that pays, reached again in the same run, pays once ----------------------------------------------
{
  const own = [
    { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' },
    {
      path: 'quests/wages.jsonc',
      text: JSON.stringify({
        id: 'wages',
        title: 'TEST: wages',
        givers: [{ kind: 'debug' }],
        start: ['work'],
        steps: {
          work: { type: 'signal', signal: 'debug:work', objective: 'TEST: work', do: { done: ['pay(7)', 'xp(2)', 'standing(empire, 3)', 'standing(rebellion, -2)', 'give(weapon, pistol_dl44, 2)'] }, next: ['again'] },
          again: { type: 'signal', signal: 'debug:again', objective: 'TEST: again', loop: true, next: ['work'] },
        },
      }),
    },
  ];
  const g = game({ own });
  const credits = g.purse.credits;
  g.host.grant('own:wages');
  g.host.event({ k: 'signal', name: 'debug:work' });
  const give = g.paid.find((p) => p.item);
  ok(g.purse.credits === credits + 7 && g.client.book!.xp === 2 && g.client.book!.tracks?.empire?.standing === 3 && g.client.book!.tracks?.rebellion?.standing === -2, 'pay, xp and standing each hand over what they say, a loss of Standing included');
  ok(give?.item?.kind === 'weapon' && give.item.id === 'pistol_dl44' && give.item.n === 2 && give.key === 'own:wages#1#do:work.done.4', `give hands over as many as it says, keyed by where it is written (${give?.key})`);
  ok(g.said.includes('Received pistol dl44 ×2') && g.said.includes('Empire standing rose') && g.said.includes('Rebellion standing fell') && g.said.includes('Paid 7 credits'), 'and the message line says the thing and how many, and which way each Standing moved');
  g.host.event({ k: 'signal', name: 'debug:again' });
  ok(g.stepOf('own:wages', 'work')?.state === 'active', 'looped round to the paying step in the same run');
  g.host.event({ k: 'signal', name: 'debug:work' });
  ok(g.purse.credits === credits + 7 && g.paid.length === 2 && g.client.book!.xp === 2 && g.client.book!.tracks?.empire?.standing === 3 && g.client.book!.tracks?.rebellion?.standing === -2, 'and done again: nothing more is paid, given, recorded or moved');
}

// ---- a waypoint a story sets is the story's: set once, and taken away without touching the player's own -------------
{
  const g = game();
  const mine = g.client.addWaypoint({ name: 'TEST: a meeting place', world: 'tatooine', f: 'raw', p: [10, 20, null] });
  ok(mine.ok && g.client.book!.waypoints.length === 1 && g.client.book!.waypoints[0].by === undefined, 'the player sets a waypoint of their own');
  g.host.run(['waypoint("TEST: a meeting place", tatooine, 10, 20)']);
  ok(g.client.book!.waypoints.length === 2 && g.client.book!.waypoints[1].by === 'run', 'the story setting one of the same name at the same place sets its own, not taking the player\'s for it');
  g.host.run(['waypoint("TEST: a meeting place", tatooine, 10, 20)']);
  ok(g.client.book!.waypoints.length === 2, 'and setting it again sets nothing: the story\'s is already there');
  g.host.run(['waypointGone("TEST: a meeting place")']);
  ok(g.client.book!.waypoints.length === 1 && g.client.book!.waypoints[0].id === mine.id, 'taking it away by its name takes the story\'s alone; the player\'s own stays');
  // A name longer than a waypoint keeps is kept cut, and taken away by the very words the story wrote.
  const long = `TEST: ${'a very long name for a place '.repeat(3)}`;
  g.host.run([`waypoint("${long}", tatooine, 30, 40)`]);
  const cut = g.client.book!.waypoints.find((w) => w.by);
  ok(!!cut && cut.name.length < long.length, `a long name is kept cut (${cut?.name.length} of ${long.length} characters)`);
  g.host.run([`waypointGone("${long}")`]);
  ok(!g.client.book!.waypoints.some((w) => w.by) && g.client.book!.waypoints.length === 1, 'and taken away by the words the story wrote, read as they were kept');
  g.host.run([`waypointGone(${mine.id})`]);
  ok(g.client.book!.waypoints.length === 1, 'a story never takes away the player\'s own, not even by its id');
}

// ---- the tracker's jobs: tracked ones leave it when they end or are dropped, and with none the newest shows ---------
{
  const g = game();
  const shown: QuestView[] = [];
  g.host.grant('test:signal');
  g.clock.now += 5000;
  g.host.grant('test:words');
  const v = g.host.view()!;
  const at = (id: string) => v.quests.find((x) => x.id === id)?.at;
  ok(at('test:signal') === T0 && at('test:words') === T0 + 5000, 'each job in the view says when it was taken');
  ok(pickShown(g.host.view(), shown) === 1 && shown[0].id === 'test:words' && g.client.book!.tracked.length === 0, 'with nothing tracked, the tracker shows the newest job taken, and writes nothing into the book for it');
  g.host.track('test:signal', true);
  g.host.track('test:words', true);
  ok(pickShown(g.host.view(), shown) === 2 && shown[0].id === 'test:signal', 'tracked, the jobs show in the order they were tracked');
  g.host.event({ k: 'signal', name: 'debug:test-hand' });
  g.host.event({ k: 'signal', name: 'debug:test-tidy' });
  ok(g.q('test:words')?.state === 'done' && !g.client.book!.tracked.includes('test:words'), 'a tracked job that ends leaves the tracked list');
  g.host.drop('test:signal');
  ok(g.q('test:signal')?.state === 'dropped' && !g.client.book!.tracked.length, 'and so does one that is dropped');
}

// ---- a server keeping the credits but holding no story: the jobs wait, and nothing is paid ----------------------------
{
  const g = game();
  // A relay from before the stories, answering as a server: its greeting says nothing of a story, so the
  // book is this browser's, but the credits are the server's and only its admin may put any in.
  g.line.authority = 'server';
  g.line.story = 0;
  g.line.status = 'online';
  g.line.mode = 'server';
  ok(g.client.holdsHere(), 'the book is still this browser\'s: waypoints are changed here');
  const r = g.host.grant('test:reward');
  ok(!r.ok && r.why === JOBS_WAIT_CREDITS && g.q('test:reward') === undefined && g.paid.length === 0, `but a job is not taken here, in words (${r.why})`);
  g.host.tick();
  ok(g.host.view() === null && !g.host.event({ k: 'death' }).ok && g.host.stats.dropped === 1, 'there is no view of the jobs, and what the detectors see is dropped and counted');
  g.line.authority = 'me';
  g.line.status = 'off';
  g.line.mode = 'off';
  ok(g.host.grant('test:reward').ok && g.paid.length === 2, 'with no server keeping the credits the job is taken and paid');
}

// ---- the sets read again while a server held the book: the jobs run against the new ones once it is back -------------
{
  const g = game();
  g.host.grant('test:goto');
  // A story server takes the line, and while it is settling (nobody may change the book) the sets are read again.
  g.line.authority = 'server';
  g.line.story = 1;
  g.line.status = 'online';
  g.line.mode = 'server';
  const book = g.client.book;
  const own = [
    { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' },
    { path: 'quests/late.jsonc', text: JSON.stringify({ id: 'late', title: 'TEST: read late', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:late', ends: 'done' } } }) },
  ];
  g.host.setSets({ test: TEST_FILES, own });
  ok(!g.client.holdsHere() && !g.host.grant('own:late').ok, 'read while a server holds the book, nothing is worked out here');
  // The line goes and playing together is switched off: the very same book is this browser's again.
  g.line.authority = 'me';
  g.line.story = 0;
  g.line.status = 'off';
  g.line.mode = 'off';
  const r = g.host.grant('own:late');
  ok(g.client.book === book && r.ok && g.q('own:late')?.state === 'active', `back in this browser's hands, the job only the new sets hold is taken (${r.why ?? 'taken'})`);
}

// ---- deadlines swept from the frame loop's own step, with nothing asked of the host by hand ----------------------------
{
  const g = game();
  g.host.grant('test:timer');
  const line = (s: string) => g.host.view()?.quests.find((x) => x.id === 'test:timer')?.lines.find((l) => l.step === s);
  ok(line('tick')?.deadline === T0 + 30000 && line('tick')?.limit === undefined, 'a timer\'s line carries when it runs out, and is no time limit');
  for (let i = 0; i < 40; i++) {
    g.clock.now += 1000;
    g.clock.wall += 1000;
    g.tick();
  }
  ok(g.stepOf('test:timer', 'tick')?.state === 'done' && g.stepOf('test:timer', 'later')?.state === 'active', 'forty seconds of the frame loop\'s ticks: the thirty-second timer was swept done, and the wait after it runs');
  ok(line('later')?.limit === undefined && line('later')?.deadline === T0 + 60000, 'a wait is no time limit either');
  for (let i = 0; i < 25; i++) {
    g.clock.now += 1000;
    g.clock.wall += 1000;
    g.tick();
  }
  ok(g.stepOf('test:timer', 'race')?.state === 'active' && line('race')?.limit === true && line('race')?.deadline === T0 + 120000, 'and the goto after it runs against a time limit, which its line says');
}

// ---- a step waiting on a death the player is credited with: the kill detector watches for it ---------------------------
{
  const own = [
    { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' },
    { path: 'quests/hunt.jsonc', text: JSON.stringify({ id: 'hunt', title: 'TEST: a hunt', givers: [{ kind: 'debug' }], start: ['one'], steps: { one: { type: 'signal', signal: 'died:kreetle', objective: 'TEST: one kreetle', ends: 'done' } } }) },
  ];
  const g = game({ own });
  g.host.grant('own:hunt');
  const w = g.host.view()!.watch.find((x) => x.k === 'kill');
  ok(!!w && w.k === 'kill' && w.quest === 'own:hunt' && w.step === 'one' && w.match.who?.join() === 'kreetle', 'a step waiting on died:<who> puts a kill watch for that creature in the view');
  ok(g.watch.kill(g.host.view(), { who: 'kreetle', npc: 'wild:k:1' }, g.clock.wall, (ev) => g.host.event(ev)) && g.q('own:hunt')?.state === 'done', 'and the kill is handed on, and the step waiting on it is done');
}

// ---- in and out of the world: a played clock counts only while the character is in it ---------------------------------
{
  const own = [
    { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' },
    { path: 'quests/shift.jsonc', text: JSON.stringify({ id: 'shift', title: 'TEST: a shift', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:shift', timeLimit: { seconds: 60, clock: 'played' }, ends: 'done' } } }) },
    { path: 'quests/after.jsonc', text: JSON.stringify({ id: 'after', title: 'TEST: a shift after a wait', givers: [{ kind: 'debug' }], start: ['first'], steps: { first: { type: 'timer', for: { seconds: 30 }, next: ['second'] }, second: { type: 'signal', signal: 'debug:after', timeLimit: { seconds: 60, clock: 'played' }, ends: 'done' } } }) },
  ];
  // Running when the character leaves: it stops with what it had left, and starts again from that.
  const g = game({ own });
  g.tick();
  g.host.grant('own:shift');
  ok(g.stepOf('own:shift', 's')?.deadline === T0 + 60000 && g.host.report().entered === true, 'begun in the world, a played time limit counts from now');
  g.clock.now += 10000;
  g.clock.wall += 1000;
  g.world.inWorld = false;
  g.tick();
  ok(g.host.report().entered === false && g.stepOf('own:shift', 's')?.remaining === 50000 && g.stepOf('own:shift', 's')?.deadline === undefined, 'the character leaving the world stops it with fifty seconds left');
  g.clock.now += 7200000;
  g.clock.wall += 1000;
  g.tick();
  ok(g.q('own:shift')?.state === 'active' && g.stepOf('own:shift', 's')?.remaining === 50000, 'two hours away settle nothing on it');
  g.world.inWorld = true;
  g.clock.wall += 1000;
  g.tick();
  ok(g.host.report().entered === true && g.stepOf('own:shift', 's')?.deadline === g.clock.now + 50000, 'coming back in starts it again from what it had left');
  g.clock.now += 50000;
  g.clock.wall += 1000;
  g.tick();
  ok(g.q('own:shift')?.state === 'failed', 'and it runs out fifty seconds of play later');
  // Begun by a sweep while the character is away: it keeps its whole length until they come in.
  const a = game({ own });
  a.tick();
  a.host.grant('own:after');
  a.world.inWorld = false;
  a.clock.now += 1000;
  a.clock.wall += 1000;
  a.tick();
  a.clock.now = T0 + 31000;
  a.clock.wall += 1000;
  a.tick();
  ok(a.stepOf('own:after', 'first')?.state === 'done' && a.stepOf('own:after', 'second')?.remaining === 60000 && a.stepOf('own:after', 'second')?.deadline === undefined, 'a world timer swept done while the character is away begins the played limit after it with all of its time kept');
  a.clock.now = T0 + 7200000;
  a.clock.wall += 1000;
  a.tick();
  ok(a.q('own:after')?.state === 'active', 'and hours more away do not spend it');
  // Begun by the settling of a book read while the character is away: the same.
  const b = game({ own });
  b.tick();
  b.host.grant('own:after');
  b.world.inWorld = false;
  b.clock.wall += 1000;
  b.tick();
  b.client.use(null);
  b.tick();
  b.clock.now = T0 + 7200000;
  b.client.use('char-1');
  b.clock.wall += 1000;
  b.tick();
  ok(b.stepOf('own:after', 'first')?.at === T0 + 30000 && b.stepOf('own:after', 'second')?.remaining === 60000 && b.q('own:after')?.state === 'active', 'read in two hours later with the character away, the timer is settled at its own time and the played limit it began keeps all of its time');
}

// ---- the story's own areas, left when the player goes somewhere else ---------------------------------------------------
{
  const g = game();
  g.host.grant('test:observe');
  g.world.x = 3476;
  g.world.z = -4694;
  g.tick();
  ok(g.stepOf('test:observe', 'watch')?.since === T0, 'in the test square, the watch opens');
  // A travel begins: the game says every area is left before anything forgets them.
  g.clock.now += 4000;
  ok(g.watch.leaveAll((ev) => g.host.event(ev)) === 1 && g.stepOf('test:observe', 'watch')?.since === undefined && g.stepOf('test:observe', 'watch')?.n === 4000, 'leaving every area closes the watch with the four seconds it had');
  g.watch.reset();
  // A minute later, somewhere else entirely, the sweep finds nothing to finish.
  g.world.world = 'naboo';
  g.clock.now += 60000;
  g.clock.wall += 1000;
  g.tick();
  ok(g.q('test:observe')?.state === 'active' && g.stepOf('test:observe', 'watch')?.n === 4000, 'and a minute on another world counts nothing towards it');
}

// ---- deadlines that fell while the character was away, settled at load in order ---------------------------------
{
  const g = game();
  g.host.grant('test:timer');
  ok(g.stepOf('test:timer', 'tick')?.deadline === T0 + 30000, 'the thirty-second timer runs on the shared clock');
  g.host.leave();
  g.world.inWorld = false;
  g.client.use(null);
  g.tick();
  // Two hours away.
  g.clock.now = T0 + 7200000;
  g.client.use('char-1');
  g.tick();
  const rec = g.q('test:timer')!;
  ok(rec.state === 'failed' && rec.outcome === 'late' && g.said.includes('Failed: TEST: clocks (late)'), 'two hours away: the timer, the wait and the time limit after them have all run out, and the job ended late, which the message line names');
  ok(rec.steps.tick.at === T0 + 30000 && rec.steps.later.at === T0 + 60000 && rec.steps.race.at === T0 + 120000 && rec.ended === T0 + 120000, 'each settled in the order it fell, at its own time, never when anybody looked');
}

// ---- the change counter moves only for changes made here -------------------------------------------------------
{
  const g = game({ sets: false });
  const base = { name: 'Ana', outfit: ['shirt_s03'] };
  ok(characterMark({ ...base, story: { local: 0 } }) === characterMark(base), 'a character with no story changes made alone keeps the mark it had before stories');
  g.host.setSets({ test: TEST_FILES });
  ok(g.client.local === 0, 'reading a set changes nothing in an empty book');
  g.host.grant('test:goto');
  ok(g.client.local > 0 && characterMark({ ...base, story: { local: g.client.local } }) !== characterMark(base), `a job taken alone is a change made here, and the mark moves with it (local ${g.client.local})`);
}

// ---- a server holding the book: nothing is worked out here ------------------------------------------------------
{
  const g = game();
  g.line.authority = 'server';
  g.line.story = 1;
  g.line.status = 'online';
  g.line.mode = 'server';
  const r = g.host.grant('test:goto');
  ok(!r.ok && g.client.host !== 'local' && g.q('test:goto') === undefined, 'while a server holds the book (or is settling it), nothing is granted here');
  g.host.tick();
  ok(g.host.view() === null, 'and there is no view of it to show');
}

// ---- the server's word of a death carries who struck it ----------------------------------------------------------
{
  const o = new Owned();
  const heard: { id: string; why: string; by: readonly number[] }[] = [];
  o.onGone = (id, why, _back, _fresh, by) => heard.push({ id, why, by });
  o.handle({ t: 'spawn', do: 'gone', id: 'wild:lair:1', why: 'dead', by: [7, 'x', 7, -1, 3] });
  o.handle({ t: 'spawn', do: 'gone', id: 'wild:lair:2', why: 'dead' });
  o.handle({ t: 'spawn', do: 'gone', id: 'wild:lair:3', why: 'taken', by: [7] });
  ok(heard.length === 3 && heard[0].by.join() === '7,3' && heard[1].by.length === 0 && heard[2].by.length === 0, `a death's strikers reach the wiring as relay ids, cleaned (${heard.map((h) => `${h.why}:[${h.by.join()}]`).join(' ')}), and nothing else carries any`);
}

// ---- the game's own payment, out of the real purse ------------------------------------------------------------------
{
  const saved: number[] = [];
  const p = new Purse();
  p.attach({ send: () => {}, say: () => {}, shared: () => false, saved: () => 40, save: (n) => void saved.push(n) });
  const wallet = (server = false) => ({ serverKeeps: () => server, credits: () => p.credits, give: (n: number) => void p.give(n), spend: (n: number, then: () => void) => p.spend(n, 'That', then), item: () => true });
  ok(payLocally({ key: 'k', charge: 10 }, wallet()) && p.credits === 30 && saved[saved.length - 1] === 30, 'a price is taken out of the purse at once with no server, and the character saved with what is left');
  ok(!payLocally({ key: 'k', charge: 50 }, wallet()) && p.credits === 30, 'one the purse cannot meet takes nothing, and says it did not');
  ok(!payLocally({ key: 'k', charge: 10 }, wallet(true)) && !payLocally({ key: 'k', credits: 10 }, wallet(true)) && p.credits === 30, 'and nothing goes into or out of a purse a server keeps');
  ok(payLocally({ key: 'k', credits: 5 }, wallet()) && p.credits === 35, 'while a reward\'s credits go in');
}

// ---- a conversation through this browser's own host: its nodes handed over, a price taken out of the purse -----------
{
  const CLERK = 'test:cast/test-clerk';
  const g = game();
  const nodes: NodeWord[] = [];
  g.host.onNode((n) => nodes.push(n));
  ok(g.host.canTalk(CLERK) && !g.host.canTalk('test:cast/test-companion') && !g.host.canTalk('test:cast/nobody'), 'this browser speaks for a cast member with a conversation in the sets it read, and for nobody else');
  const stray = g.host.talk('pick', CLERK, 'pay');
  ok(!stray.ok && stray.why === 'you are not talking to them' && nodes.length === 1 && nodes[0].view === null && nodes[0].why === stray.why && g.paid.length === 0, 'an answer with no conversation open is refused, the refusal handed over with no node, and nothing is paid');
  ok(g.host.talk('open', CLERK).ok && nodes.length === 2 && nodes[1].view?.node === 'hello' && g.host.talkState?.speaker === CLERK, 'an opening is worked out, kept, and its node handed over before the call returns');
  const wrong = g.host.talk('pick', 'test:cast/test-doomed', 'a');
  ok(!wrong.ok && nodes[2].view === null && g.host.talkState?.speaker === CLERK, 'an answer to somebody else is refused, and the conversation under way stands');
  const before = g.purse.credits;
  g.said.length = 0;
  g.host.talk('pick', CLERK, 'pay');
  ok(nodes[3]?.view?.node === 'paid' && g.paid.filter((o) => o.charge === 10).length === 1 && g.purse.credits === before - 10 && g.said.includes('Spent 10 credits'), `a price is handed over as a charge, taken out of the purse and said (${before} to ${g.purse.credits})`);
  g.host.talk('open', CLERK);
  g.host.talk('pick', CLERK, null);
  g.host.talk('pick', CLERK, 'pay');
  ok(g.purse.credits === before - 20, 'and taken again every time it is chosen');
  g.host.talk('close', CLERK);
  ok(g.host.talkState === null && !g.host.talk('pick', CLERK, null).ok, 'closing lets it go: an answer after it is refused');
  // A charge the purse refuses (spent elsewhere in the same moment) is said as one that was not made.
  const r = game({ refuseCharges: true });
  r.host.talk('open', CLERK);
  r.said.length = 0;
  r.host.talk('pick', CLERK, 'pay');
  ok(r.paid.some((o) => o.charge === 10) && r.said.includes('10 credits could not be spent') && !r.said.includes('Spent 10 credits'), 'a price the purse would not give is said as not spent, never as spent');
}

// ---- documents and the journal through this browser's own host --------------------------------------------------------
{
  const CLERK = 'test:cast/test-clerk';
  // With the browser's own store of words handed in, and without one (they then last as long as the host).
  const store = new Map<string, string>();
  const keep: TextKeep = { get: (h) => store.get(h), put: (t) => void Object.keys(t).forEach((h) => store.set(h, t[h])) };
  for (const kept of [true, false]) {
    const g = game(kept ? { texts: keep } : {});
    const docs: DocWord[] = [];
    g.host.onDoc((w) => docs.push(w));
    g.host.grant('test:docs');
    const first = g.host.read('test:doc/test-pages');
    const e = g.client.book?.journal?.[0];
    ok(first.ok && docs.length === 1 && !!docs[0].view && e?.kind === 'doc' && !!e.h && g.host.text(e.h) === JSON.stringify(docs[0].view) && (!kept || store.get(e.h) === g.host.text(e.h)), `a page read here is handed to the window before the call returns, and its words kept by their hash ${kept ? 'in the store handed in' : 'in the host itself'}`);
    g.clock.now += 60000;
    g.host.read('test:doc/test-pages');
    ok(JSON.stringify(docs[1]?.view) === JSON.stringify(docs[0].view) && g.client.book!.journal!.filter((x) => x.kind === 'doc').length === 1, `and read again it is the very page first read, out of those words, with no second entry (${kept ? 'a store' : 'no store'})`);
    g.host.read('test:doc/test-pages', { end: true });
    ok(docs[2]?.end === true && g.stepOf('test:docs', 'read')?.state === 'done', 'read to its end, the answer says so, and the step waiting on it is done');
  }
  // A conversation's transcript, written as its window closes, with the name it showed.
  const g = game({ texts: keep });
  g.host.talk('open', CLERK);
  g.host.talk('pick', CLERK, 'name');
  g.host.talk('pick', CLERK, null);
  g.host.talk('pick', CLERK, 'bye');
  ok(!(g.client.book?.journal ?? []).some((x) => x.kind === 'talk'), 'a conversation under way writes nothing yet');
  g.host.talk('close', CLERK, null, null, { read: {}, name: 'TEST: as shown' });
  const t = g.client.book?.journal?.find((x) => x.kind === 'talk');
  ok(!!t && t.with[0] === CLERK && t.title === 'TEST CLERK' && (t.lines?.length ?? 0) >= 5 && t.lines!.every((l) => !!l.h && store.has(l.h)), `closed, its transcript is written here, the clerk as named by then, every line's words kept (${t?.lines?.length} lines)`);
  g.host.talk('close', CLERK, null, null, { read: {}, name: null });
  ok(g.client.book!.journal!.filter((x) => x.kind === 'talk').length === 1, 'and closing again writes nothing more');
}

console.log(`\n${checks} checks passed`);
