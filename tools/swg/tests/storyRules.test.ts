// The step machine (`src/story/quests.ts`), the signal board and its watchdog (`src/story/signals.ts`),
// the view (`src/story/view.ts`) and the host loop both hosts share (`src/story/hostCore.ts`), driven
// over the committed test set with a clock the test holds, and over small sets made up here for what the
// test set leaves out.
//
// The failures pinned. Working out an event must never change the book it was handed, and the changes it
// answers, applied to that book, must make exactly the book the machine ended with: that is what lets
// the server write a batch down and a browser apply it and both hold one book. A reward must be paid once
// whatever happens twice -- a detector repeating itself, a loop back to the same step, a reload. Deadlines
// that passed while nobody was looking must be settled in the order they fell, each stamped with its own
// time. A quest rewritten under a running book must carry on, start over, or be held where Drop costs
// nothing -- never break. A step whose only raisers are closed must be moved on, not left waiting for
// ever. And a circle in the data must stop rather than hang the host.
//
// Synthetic: no browser, no socket, nothing read from the game's files.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { applyChanges, cleanBook, emptyBook, type StoryBook } from '../../../src/story/book.ts';
import { HostCore, storyEvent, type HostCtx } from '../../../src/story/hostCore.ts';
import { STALLED_REVISED, STALLED_STUCK, dueList, evalCond, nextDeadline, plan, settleDeadlines, type StoryResult } from '../../../src/story/quests.ts';
import { loadSet, stableText, type StorySet } from '../../../src/story/set.ts';
import { raise, raisersFor } from '../../../src/story/signals.ts';
import { questWaypointId, viewHash, viewOf } from '../../../src/story/view.ts';
import { seedRoll } from '../../../src/story/seed.ts';
import { GAME_DAY_MS, REAL_DAY_MS } from '../../../src/story/clock.ts';
import { readStorySet } from '../../../server/storySet.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));
const testLoad = loadSet(readStorySet(TESTSET).files, { test: true });
assert.equal(testLoad.errors.length, 0, testLoad.errors.map((e) => e.message).join('; '));
const LIB = testLoad.set;
/** A fixed shared-clock time to start from, well clear of zero. */
const T0 = 1_800_000_000_000;
const HERE: [number, number] = [3000, -4000];
const at = (now: number, extra: Partial<HostCtx> = {}): HostCtx => ({ now, world: 'tatooine', here: HERE, ...extra });
const hostOf = (lib: StorySet = LIB, payer: 'browser' | 'server' = 'browser', book: StoryBook = emptyBook('char-1')) => new HostCore({ book, lib, payer });
const q = (h: HostCore, id: string) => h.book.quests?.[id];
const stepOf = (h: HostCore, id: string, s: string) => h.book.quests?.[id]?.steps[s];

/** A small set of the test's own, written as files the loader reads. */
function setOf(prefix: string, quests: Record<string, unknown>[], extra: { path: string; text: string }[] = []): StorySet {
  const files = [{ path: 'story.jsonc', text: JSON.stringify({ prefix, title: 'TEST' }) }, ...quests.map((x) => ({ path: `quests/${(x as { id: string }).id}.jsonc`, text: JSON.stringify(x) })), ...extra];
  const r = loadSet(files, { test: true });
  assert.equal(r.errors.length, 0, r.errors.map((e) => `${e.file}:${e.line} ${e.message}`).join('; '));
  return r.set;
}

// ---- a plan never touches its book, and its changes make the book it ended with -------------------------
{
  const book = emptyBook('char-1');
  const before = stableText(book);
  const r = plan(book, LIB, { now: T0, char: 'char-1', payer: 'browser', world: 'tatooine', here: HERE }, (d) => d.grant('test:goto'));
  ok(stableText(book) === before && r.ch.length > 0 && r.why === null, 'working out a grant leaves the book it was handed exactly as it was');
  const copy = cleanBook(JSON.parse(JSON.stringify(book)))!;
  applyChanges(copy, JSON.parse(JSON.stringify(r.ch)));
  const h = hostOf();
  h.grant('test:goto', at(T0));
  ok(stableText({ ...copy, rev: 0 }) === stableText({ ...h.book, rev: 0 }) && h.book.rev === 1, 'its changes, sent over the wire and applied to the book, make the book the host now holds, one revision on');
  const ev = storyEvent(h.book, LIB, { k: 'arrive', world: 'tatooine', p: [3030, -4000] }, { now: T0 + 1000, char: 'char-1', payer: 'browser', world: 'tatooine', here: [3030, -4000] });
  ok(ev.ch.length > 0 && stepOf(h, 'test:goto', 'outdoor')?.state === 'active', 'G1\'s event works an arrival out without applying it');
}

// ---- test:goto: a relative marker, then a room, then a reward paid once -----------------------------
{
  const h = hostOf();
  const g = h.grant('test:goto', at(T0));
  const rec = q(h, 'test:goto')!;
  ok(rec.state === 'active' && rec.run === 1 && rec.defHash === LIB.quests['test:goto'].hash && stableText(rec.from) === stableText({ world: 'tatooine', p: HERE }), 'granted: active, the first run, under the definition it began with, and where it began remembered');
  ok(stableText(stepOf(h, 'test:goto', 'outdoor')?.place) === stableText([3030, -4000]) && g.notes.some((n) => n.k === 'job') && g.notes.some((n) => n.k === 'objective'), 'the relative marker is worked out from where it began (30 m along x), and the message line is told a job was taken and an objective set');
  const v = h.view(at(T0));
  const wpId = questWaypointId('test:goto', 'outdoor');
  ok(v.quests[0].lines[0].text === 'TEST: walk to the marker' && v.quests[0].lines[0].wp === wpId && v.waypoints[0].id === wpId && v.waypoints[0].on && v.waypoints[0].colour === 'component', 'the view carries the objective line, and the quest\'s waypoint switched on in the quest colour');
  ok(v.watch.some((w) => w.k === 'arrive' && w.step === 'outdoor' && w.radius === 6 && stableText(w.p) === stableText([3030, -4000])), 'and tells the detectors to watch for the arrival there');
  ok(h.event({ k: 'arrive', world: 'tatooine', p: [3030, -3990] }, at(T0 + 1000)).ch.length === 0, 'eleven metres off a six-metre marker is not there');
  ok(h.event({ k: 'arrive', world: 'naboo', p: [3030, -4000] }, at(T0 + 1000)).ch.length === 0, 'and the right place on the wrong world is not either');
  h.event({ k: 'arrive', world: 'tatooine', p: [3034, -4002] }, at(T0 + 2000));
  ok(stepOf(h, 'test:goto', 'outdoor')?.state === 'done' && stepOf(h, 'test:goto', 'cantina')?.state === 'active', 'within the radius: the marker is done and the cantina begins');
  const room = { cell: 'cantina', template: 'object/building/tatooine/shared_cantina_tatooine.iff' };
  ok(h.event({ k: 'arrive', world: 'tatooine', p: [3432, -4818] }, at(T0 + 3000)).ch.length === 0, 'at the cantina\'s place but outside its room: not done');
  ok(h.event({ k: 'arrive', world: 'tatooine', p: [3432, -4818], room: { cell: 'foyer1', template: room.template } }, at(T0 + 3000)).ch.length === 0, 'in the wrong room of it: not done');
  ok(h.event({ k: 'arrive', world: 'tatooine', p: [3432, -4818], room: { cell: 'cantina', template: 'object/building/tatooine/shared_hotel_tatooine.iff' } }, at(T0 + 3000)).ch.length === 0, 'in a room of the right name in another building: not done either');
  const paid = h.event({ k: 'arrive', world: 'tatooine', p: [3440, -4810], room }, at(T0 + 4000));
  const done = q(h, 'test:goto')!;
  ok(done.state === 'done' && done.outcome === 'done' && done.completions === 1 && done.ended === T0 + 4000, 'in the room, within reach: the reward step pays and ends the quest done');
  ok(paid.pay.length === 1 && paid.pay[0].credits === 10 && paid.pay[0].key === 'test:goto#1#paid' && h.book.xp === 5 && h.book.tracks?.freelance?.standing === 10, 'credits to pay once under the reward\'s own key, experience recorded and standing added');
  ok(h.book.paid?.['test:goto#1#paid']?.by === 'browser' && paid.notes.some((n) => n.k === 'done'), 'the book says who paid, and the message line is told it is done');
  const again = h.event({ k: 'arrive', world: 'tatooine', p: [3440, -4810], room }, at(T0 + 5000));
  ok(again.ch.length === 0 && again.pay.length === 0, 'the detector saying it again (they repeat while true) pays nothing and changes nothing');
  // Taken again: a new run, a new reward key.
  h.grant('test:goto', at(T0 + 10000, { here: [100, 100] }));
  ok(q(h, 'test:goto')?.run === 2 && stableText(stepOf(h, 'test:goto', 'outdoor')?.place) === stableText([130, 100]) && q(h, 'test:goto')?.history.length === 1, 'repeatable: taken again as a second run, measured from where it was taken this time');
  // A restart at the checkpoint keeps what was done before it.
  h.event({ k: 'arrive', world: 'tatooine', p: [130, 100] }, at(T0 + 11000, { here: [130, 100] }));
  const restarted = h.restart('test:goto', at(T0 + 12000, { here: [999, 999] }));
  ok(restarted.why === null && q(h, 'test:goto')?.run === 3 && stepOf(h, 'test:goto', 'outdoor')?.state === 'done' && stepOf(h, 'test:goto', 'cantina')?.state === 'active' && restarted.notes.some((n) => n.k === 'restarted'), 'a restart begins a new run at the last checkpoint reached, keeping the step done before it');
  ok(stableText(q(h, 'test:goto')?.from) === stableText({ world: 'tatooine', p: [100, 100] }), 'and keeps where the quest began, since its places are measured from there');
  // The terminal gives it: E on the object while it may be taken grants it.
  const t = hostOf();
  const viewed = t.view(at(T0));
  ok(viewed.objects.some((o) => o.id === 'test:obj/test-terminal' && o.template === 'object/tangible/terminal/shared_terminal_mission.iff') && viewed.watch.some((w) => w.k === 'use' && w.object === 'test:obj/test-terminal'), 'the terminal that gives a job you may take is a story object the view lists, and E on it is watched');
  t.event({ k: 'use', object: 'test:obj/test-terminal' }, at(T0));
  ok(q(t, 'test:goto')?.state === 'active', 'and using it grants the job');
}

// ---- test:signal: three raisers, a counted one, and a join --------------------------------------------
{
  const h = hostOf();
  h.grant('test:signal', at(T0));
  h.event({ k: 'use', object: 'test:obj/test-terminal' }, at(T0 + 1));
  ok(stepOf(h, 'test:signal', 'poke')?.state === 'done' && q(h, 'test:goto')?.state === 'active', 'E on the terminal raises used: for the waiting step, and also gives the job it gives');
  h.event({ k: 'area', area: 'test:area/test-square', inside: true }, at(T0 + 2));
  h.event({ k: 'area', area: 'test:area/test-square', inside: true }, at(T0 + 2002));
  ok(stepOf(h, 'test:signal', 'square')?.state === 'done', 'stepping into the square raises entered:, and the detector saying it again changes nothing more');
  h.event({ k: 'signal', name: 'debug:test-ping' }, at(T0 + 3));
  h.event({ k: 'signal', name: 'debug:test-ping' }, at(T0 + 4));
  const line = h.view(at(T0 + 4)).quests.find((x) => x.id === 'test:signal')!.lines.find((l) => l.step === 'ping')!;
  ok(stepOf(h, 'test:signal', 'ping')?.n === 2 && line.n === 2 && line.of === 3, 'a counted signal counts, and its line says two of three');
  const last = h.event({ k: 'signal', name: 'debug:test-ping' }, at(T0 + 5));
  ok(q(h, 'test:signal')?.state === 'done' && stepOf(h, 'test:signal', 'meet')?.state === 'done' && last.notes.some((n) => n.k === 'done'), 'the third ping completes it, the join finds all three done, and the quest ends');
  ok(raise(emptyBook('char-1'), LIB, 'debug:test-ping', { now: T0, char: 'char-1', payer: 'browser' }).ch.length === 0, 'a signal nobody is waiting for is not kept');
}

// ---- test:kill: by catalogue id and by social group ---------------------------------------------------
{
  const h = hostOf();
  h.grant('test:kill', at(T0));
  const kv = h.view(at(T0)).watch.filter((w) => w.k === 'kill');
  ok(kv.length === 2, 'the view asks the detectors to watch for both kinds of kill');
  h.event({ k: 'kill', who: 'kreetle', social: 'kreetle', tags: ['critter'] }, at(T0 + 1));
  h.event({ k: 'kill', who: 'rill', social: 'rill' }, at(T0 + 2));
  h.event({ k: 'kill', who: 'kreetle', social: 'kreetle' }, at(T0 + 3));
  ok(stepOf(h, 'test:kill', 'mites')?.n === 2 && stepOf(h, 'test:kill', 'rats')?.n === 0, 'kreetles count for the id step, and a rill counts for nothing');
  h.event({ k: 'kill', who: 'womp_rat', social: 'rat' }, at(T0 + 4));
  h.event({ k: 'kill', who: 'lesser_desert_womp_rat', social: 'rat' }, at(T0 + 5));
  ok(stepOf(h, 'test:kill', 'rats')?.state === 'done' && q(h, 'test:kill')?.state === 'active', 'two of the social group, of two different creatures, finish that step');
  h.event({ k: 'kill', who: 'kreetle', social: 'kreetle' }, at(T0 + 6));
  ok(q(h, 'test:kill')?.state === 'done', 'and the third kreetle the quest');
}

// ---- test:timer: clocks, a limit that fails into onFail, and deadlines settled in order -----------------
{
  const h = hostOf();
  h.grant('test:timer', at(T0));
  ok(stepOf(h, 'test:timer', 'tick')?.deadline === T0 + 30000 && nextDeadline(h.book, LIB) === T0 + 30000, 'a thirty-second timer runs out thirty seconds on, on the shared clock');
  ok(h.sweep(at(T0 + 29999)).ch.length === 0, 'a millisecond before, the sweep does nothing');
  h.sweep(at(T0 + 30000));
  ok(stepOf(h, 'test:timer', 'tick')?.state === 'done' && stepOf(h, 'test:timer', 'later')?.deadline === T0 + 60000, 'on the second it is done, and the one game-hour wait runs thirty real seconds');
  const wl = h.view(at(T0 + 30000)).quests.find((x) => x.id === 'test:timer')!.lines.find((l) => l.step === 'later')!;
  ok(wl.text === 'Come back after 1 game hour' && wl.deadline === T0 + 60000, 'a wait with no line of its author\'s says how long, and carries its deadline');
  h.sweep(at(T0 + 60000));
  ok(stepOf(h, 'test:timer', 'race')?.deadline === T0 + 120000 && stableText(stepOf(h, 'test:timer', 'race')?.place) === stableText([3000, -3960]), 'then the race begins with its minute');
  h.sweep(at(T0 + 120000));
  const rec = q(h, 'test:timer')!;
  ok(stepOf(h, 'test:timer', 'race')?.state === 'failed' && stepOf(h, 'test:timer', 'slow')?.state === 'done' && rec.state === 'failed' && rec.outcome === 'late', 'out of time, the goto fails into its onFail, which ends the quest as the named failure it declares');
  // The same, all while away: settled at load, in order, each at its own time.
  const away = hostOf();
  away.grant('test:timer', at(T0));
  const loaded = away.load(at(T0 + 10 * 3600000));
  const r2 = q(away, 'test:timer')!;
  ok(stepOf(away, 'test:timer', 'tick')?.at === T0 + 30000 && stepOf(away, 'test:timer', 'later')?.at === T0 + 60000 && stepOf(away, 'test:timer', 'race')?.at === T0 + 120000, 'ten hours away: every deadline is settled at load, each stamped with when it fell due, not when anybody looked');
  ok(r2.state === 'failed' && r2.ended === T0 + 120000 && loaded.notes.filter((n) => n.k === 'failed').length === 1, 'and the quest ended when its last deadline ran out');
  ok(settleDeadlines(away.book, LIB, T0 + 20 * 3600000).ch.length === 0 && dueList(away.book, LIB).length === 0, 'with nothing left to fall due, settling again does nothing');
  // In time, the other way.
  const fast = hostOf();
  fast.grant('test:timer', at(T0));
  fast.sweep(at(T0 + 60000));
  fast.event({ k: 'arrive', world: 'tatooine', p: [3001, -3961] }, at(T0 + 70000));
  ok(q(fast, 'test:timer')?.state === 'done' && q(fast, 'test:timer')?.outcome === 'done', 'reached inside the minute, it ends done');
}

// ---- test:join: parallel steps, a join, after and unless -------------------------------------------------
{
  const a = hostOf();
  a.grant('test:join', at(T0));
  a.event({ k: 'signal', name: 'debug:test-left' }, at(T0 + 1));
  ok(stepOf(a, 'test:join', 'meet')?.state === 'waiting', 'left done first: the join waits on the right');
  a.event({ k: 'signal', name: 'debug:test-right' }, at(T0 + 2));
  ok(stepOf(a, 'test:join', 'alt')?.state === 'skipped' && a.book.flags?.['test.join.alt'] === undefined && q(a, 'test:join')?.state === 'done', 'then right: the join is done, and the step that is unless left is skipped and does nothing');
  const b = hostOf();
  b.grant('test:join', at(T0));
  b.event({ k: 'signal', name: 'debug:test-right' }, at(T0 + 1));
  ok(stepOf(b, 'test:join', 'alt')?.state === 'done' && b.book.flags?.['test.join.alt'] === 1 && stepOf(b, 'test:join', 'meet')?.state === 'waiting', 'right first: the unless step runs and sets its flag, and the join waits');
  b.event({ k: 'signal', name: 'debug:test-left' }, at(T0 + 2));
  ok(q(b, 'test:join')?.state === 'done', 'and left then finishes it');
}

// ---- test:reward: every kind, paid once ---------------------------------------------------------------
{
  const h = hostOf(LIB, 'server');
  const r = h.grant('test:reward', at(T0));
  ok(r.pay.length === 2 && r.pay[0].credits === 25 && r.pay[1].item?.id === 'shirt_s03' && r.pay[1].item.kind === 'wear' && h.book.xp === 10 && h.book.tracks?.freelance?.standing === 5, 'credits and an item to pay, experience and standing recorded');
  ok(h.book.paid?.['test:reward#1#give']?.by === 'server' && r.notes.some((n) => n.k === 'item') && r.notes.some((n) => n.k === 'xp'), 'recorded as paid by the server that paid it');
  const loop = h.event({ k: 'signal', name: 'debug:test-again' }, at(T0 + 1));
  ok(stepOf(h, 'test:reward', 'give')?.state === 'done' && loop.pay.length === 0 && h.book.xp === 10 && h.book.tracks?.freelance?.standing === 5, 'looped round to the reward step in the same run: it is done again and pays nothing');
  const twice = applyChanges(h.book, [{ k: 'paid', key: 'test:reward#1#give', at: T0, by: 'browser' }]);
  ok(twice.applied.length === 0 && /already paid/.test(twice.refused[0].why), 'the book itself refuses to record one reward twice, whoever asks');
  h.event({ k: 'signal', name: 'debug:test-finish' }, at(T0 + 2));
  ok(q(h, 'test:reward')?.state === 'done', 'and finishing ends it');
  const run2 = h.grant('test:reward', at(T0 + 3));
  ok(run2.pay.length === 2 && run2.pay[0].key === 'test:reward#2#give', 'a second run is a second reward, under its own key');
}

// ---- test:repeat: a cooldown and the daily standing cap -------------------------------------------------
{
  const day0 = Math.floor(T0 / 86400000) * 86400000 + 3600000;
  const h = hostOf();
  h.grant('test:repeat', at(day0));
  ok(q(h, 'test:repeat')?.state === 'done' && h.book.tracks?.freelance?.standing === 20, 'the first run gives its twenty');
  const early = h.grant('test:repeat', at(day0 + 60000));
  ok(/again in 60 seconds/.test(early.why ?? '') && early.ch.length === 0, `a minute later it may not be taken again yet (${early.why})`);
  h.grant('test:repeat', at(day0 + 120000));
  ok(h.book.tracks?.freelance?.standing === 30 && stableText(q(h, 'test:repeat')?.day) === stableText([Math.floor(day0 / 86400000), 30]), 'two minutes on it may, and its standing is capped at thirty for the day: ten of twenty');
  h.grant('test:repeat', at(day0 + 240000));
  ok(h.book.tracks?.freelance?.standing === 30 && q(h, 'test:repeat')?.completions === 3, 'the third run that day is done and gives none');
  h.grant('test:repeat', at(day0 + 86400000));
  ok(h.book.tracks?.freelance?.standing === 50, 'the next real day it gives its twenty again');
}

// ---- test:harsh: no restart, and abandoning is a failure --------------------------------------------------
{
  const h = hostOf();
  h.grant('test:harsh', at(T0));
  ok(h.restart('test:harsh', at(T0 + 1)).why === 'this job cannot be started over' && q(h, 'test:harsh')?.run === 1, 'a harsh quest cannot be restarted');
  const dropped = h.drop('test:harsh', at(T0 + 2));
  ok(q(h, 'test:harsh')?.state === 'failed' && q(h, 'test:harsh')?.outcome === 'failed' && dropped.notes.some((n) => n.k === 'failed'), 'and dropping it ends it as a failure');
  const soft = hostOf();
  soft.grant('test:signal', at(T0));
  soft.drop('test:signal', at(T0 + 1));
  ok(q(soft, 'test:signal')?.state === 'dropped' && q(soft, 'test:signal')?.history.at(-1)?.outcome === 'dropped' && soft.grant('test:signal', at(T0 + 2)).why === null, 'an ordinary quest dropped is just dropped, and may be taken again');
}

// ---- test:branchNext: a fork by a flag ------------------------------------------------------------------
{
  const high = hostOf();
  high.grant('test:branchNext', at(T0));
  high.run(['flag(test.branch, 2)'], at(T0 + 1));
  high.event({ k: 'signal', name: 'debug:test-branch' }, at(T0 + 2));
  ok(q(high, 'test:branchNext')?.outcome === 'high' && stepOf(high, 'test:branchNext', 'low') === undefined, 'the flag at two: only the high edge is followed');
  const low = hostOf();
  low.grant('test:branchNext', at(T0));
  low.event({ k: 'signal', name: 'debug:test-branch' }, at(T0 + 1));
  ok(q(low, 'test:branchNext')?.outcome === 'low', 'no flag: the low edge');
}

// ---- test:observe: twenty seconds in the square, summed over visits ---------------------------------------
{
  const h = hostOf();
  h.grant('test:observe', at(T0));
  const sq = 'test:area/test-square';
  ok(h.view(at(T0)).watch.some((w) => w.k === 'area' && w.id === sq), 'the view asks the detectors to watch the square');
  h.event({ k: 'area', area: sq, inside: true }, at(T0 + 1000));
  h.event({ k: 'area', area: sq, inside: false }, at(T0 + 13000));
  ok(stepOf(h, 'test:observe', 'watch')?.n === 12000 && stepOf(h, 'test:observe', 'watch')?.since === undefined, 'twelve seconds inside, then out: twelve seconds kept');
  h.event({ k: 'area', area: sq, inside: true }, at(T0 + 20000));
  ok(h.view(at(T0 + 24000)).quests[0].lines[0].n === 16, 'back inside, the line counts on from twelve');
  ok(h.sweep(at(T0 + 27999)).ch.length === 0, 'a millisecond short of twenty, nothing');
  h.sweep(at(T0 + 28000));
  ok(q(h, 'test:observe')?.state === 'done' && stepOf(h, 'test:observe', 'watch')?.at === T0 + 28000, 'at twenty seconds summed it is done, stamped with the moment it filled');
  const inside = hostOf();
  inside.grant('test:observe', at(T0, { areas: [sq] }));
  ok(stepOf(inside, 'test:observe', 'watch')?.since === T0, 'taken while already inside, it starts watching at once');
}

// ---- test:waypoints: on by default, off stays off --------------------------------------------------------
{
  const h = hostOf();
  h.grant('test:waypoints', at(T0));
  const id = questWaypointId('test:waypoints', 'mark');
  ok(h.view(at(T0)).waypoints.find((w) => w.id === id)?.on === true, 'a quest\'s waypoint appears by itself, switched on');
  applyChanges(h.book, [{ k: 'qwpOn', key: id, on: false }]);
  ok(h.view(at(T0)).waypoints.find((w) => w.id === id)?.on === false, 'switched off by the player, it is off');
  const back = new HostCore({ book: cleanBook(JSON.parse(JSON.stringify(h.book)))!, lib: LIB, payer: 'browser' });
  back.load(at(T0 + 1000));
  ok(back.view(at(T0 + 1000)).waypoints.find((w) => w.id === id)?.on === false, 'and stays off through a reload');
  back.event({ k: 'arrive', world: 'tatooine', p: [3476, -4694] }, at(T0 + 2000));
  const quietId = questWaypointId('test:waypoints', 'quiet');
  const quiet = back.view(at(T0 + 2000)).waypoints.find((w) => w.id === quietId);
  ok(!!quiet && quiet.on === false, 'a step that says its waypoint starts off shows it off');
  ok(applyChanges(back.book, [{ k: 'qwpOn', key: quietId, on: true }]).applied.length === 1 && back.view(at(T0 + 2000)).waypoints.find((w) => w.id === quietId)?.on === true, 'switched on by the player, a waypoint its step starts off is on');
  const again = new HostCore({ book: cleanBook(JSON.parse(JSON.stringify(back.book)))!, lib: LIB, payer: 'browser' });
  ok(again.view(at(T0 + 3000)).waypoints.find((w) => w.id === quietId)?.on === true && !again.book.wpOff.includes(quietId), 'and stays on through a reload');
  applyChanges(again.book, [{ k: 'qwpOn', key: quietId, on: false }]);
  ok(again.view(at(T0 + 3000)).waypoints.find((w) => w.id === quietId)?.on === false && !again.book.qwpOn?.includes(quietId), 'and off again when the player says so, the book holding the key in one list only');
}

// ---- the whole test set, granted at once: the view's hash moves only when something changes --------------
{
  const h = hostOf();
  for (const id of Object.keys(LIB.quests)) h.grant(id, at(T0));
  const v1 = viewHash(h.view(at(T0)));
  ok(v1 === viewHash(h.view(at(T0))) && Object.keys(LIB.quests).every((id) => q(h, id)), 'every test quest can be granted at once, and the same book shows the same view');
  h.event({ k: 'signal', name: 'debug:test-left' }, at(T0 + 1));
  ok(viewHash(h.view(at(T0 + 1))) !== v1, 'and a change shows as a different view');
}

// ---- revisions: carry on, start over, or be held -----------------------------------------------------------
{
  const v1 = { id: 'rev', title: 'TEST: revised', restart: 'start', givers: [{ kind: 'debug' }], start: ['a'], steps: { a: { type: 'signal', signal: 'debug:a', next: ['b'] }, b: { type: 'signal', signal: 'debug:b', ends: 'done' } } };
  const lib1 = setOf('own', [v1]);
  const h = hostOf(lib1);
  h.grant('own:rev', at(T0));
  h.event({ k: 'signal', name: 'debug:a' }, at(T0 + 1));
  const lib2 = setOf('own', [{ ...v1, title: 'TEST: revised again', rev: 2 }]);
  h.setLibrary(lib2, at(T0 + 2));
  ok(q(h, 'own:rev')?.state === 'active' && q(h, 'own:rev')?.defHash === lib2.quests['own:rev'].hash && q(h, 'own:rev')?.defRev === 2 && stepOf(h, 'own:rev', 'b')?.state === 'active', 'a revision whose steps the quest is in all still exist simply carries on, under the new definition');
  const lib3 = setOf('own', [{ ...v1, steps: { a: v1.steps.a, c: { type: 'signal', signal: 'debug:c', ends: 'done' } }, rev: 3 }].map((x) => ({ ...x, steps: { ...x.steps, a: { ...v1.steps.a, next: ['c'] } } })));
  const rs = h.setLibrary(lib3, at(T0 + 3));
  ok(q(h, 'own:rev')?.run === 2 && stepOf(h, 'own:rev', 'a')?.state === 'active' && rs.notes.some((n) => n.k === 'restarted'), 'one whose step is gone starts over, where its definition allows');
  const lib4 = setOf('own', [{ ...v1, restart: 'never', steps: { z: { type: 'signal', signal: 'debug:z', ends: 'done' } }, start: ['z'], rev: 4 }]);
  h.setLibrary(lib4, at(T0 + 4));
  ok(q(h, 'own:rev')?.state === 'stalled' && q(h, 'own:rev')?.why === STALLED_REVISED && h.view(at(T0 + 4)).quests[0].stalled === STALLED_REVISED && h.view(at(T0 + 4)).quests[0].canDrop, 'and one that may not start over is held, saying its paperwork was revised, with Drop offered');
  h.setLibrary(lib3, at(T0 + 5));
  ok(q(h, 'own:rev')?.state === 'active' && q(h, 'own:rev')?.why === undefined, 'when the steps it is in exist again, a held quest carries on');
  h.setLibrary(setOf('own', [{ id: 'other', title: 'TEST', start: ['s'], steps: { s: { type: 'nothing' } } }]), at(T0 + 6));
  ok(q(h, 'own:rev')?.state === 'stalled', 'a quest whose definition is gone is held');
  h.drop('own:rev', at(T0 + 7));
  ok(q(h, 'own:rev')?.state === 'dropped', 'and dropping a held quest costs nothing: it is dropped, not failed');
}

// ---- the watchdog: a step whose only raiser has been closed ------------------------------------------------
{
  const lib = setOf('own', [
    { id: 'waiter', title: 'TEST', givers: [{ kind: 'debug' }], start: ['wait'], steps: { wait: { type: 'signal', signal: 'word', ends: 'done' } } },
    { id: 'skipper', title: 'TEST', givers: [{ kind: 'debug' }], start: ['wait'], steps: { wait: { type: 'signal', signal: 'word', onStuck: 'skip', next: ['after'] }, after: { type: 'signal', signal: 'debug:x', ends: 'done' } } },
    { id: 'sayer', title: 'TEST', givers: [{ kind: 'debug' }], start: ['say'], steps: { say: { type: 'signal', signal: 'debug:say', signalsOut: { done: ['word'] }, ends: 'done' } } },
  ]);
  ok(raisersFor(lib, 'own:word').length === 1 && raisersFor(lib, 'own:word')[0].quest === 'own:sayer', 'the board knows who raises each signal');
  const h = hostOf(lib);
  h.grant('own:waiter', at(T0));
  h.grant('own:skipper', at(T0));
  ok(q(h, 'own:waiter')?.state === 'active', 'while the quest that raises it is open, the waiting step waits');
  h.run(['close(own:sayer)'], at(T0 + 1));
  ok(q(h, 'own:waiter')?.state === 'stalled' && q(h, 'own:waiter')?.why === STALLED_STUCK, 'once it is closed, the watchdog holds the waiting quest: nobody is left who can sign it off');
  ok(stepOf(h, 'own:skipper', 'wait')?.state === 'skipped' && stepOf(h, 'own:skipper', 'after')?.state === 'active', 'and a step whose onStuck is skip is skipped, and the quest goes on past it');
  ok(h.grant('own:sayer', at(T0 + 2)).why === 'that job is closed', 'a closed quest is never granted again');
}

// ---- played clocks: counting only while the character is in the world ------------------------------------
{
  const lib = setOf('own', [{ id: 'played', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:s', timeLimit: { seconds: 60, clock: 'played' }, ends: 'done' } } }]);
  const h = hostOf(lib);
  h.grant('own:played', at(T0));
  h.event({ k: 'leave' }, at(T0 + 10000));
  ok(stepOf(h, 'own:played', 's')?.remaining === 50000 && stepOf(h, 'own:played', 's')?.deadline === undefined, 'leaving the world stops the played clock with fifty seconds left');
  h.load(at(T0 + 3600000));
  ok(stepOf(h, 'own:played', 's')?.state === 'active', 'an hour away settles nothing on it');
  h.event({ k: 'enter' }, at(T0 + 3600000));
  ok(stepOf(h, 'own:played', 's')?.deadline === T0 + 3600000 + 50000, 'coming back starts it again from what it had left');
  h.sweep(at(T0 + 3650000));
  ok(q(h, 'own:played')?.state === 'failed', 'and it runs out fifty seconds after');
}

// ---- abandoning as the definition says, chains, death, chance, unbuilt words, escapes and circles ---------------
{
  const lib = setOf('own', [
    { id: 'stuck', title: 'TEST', abandon: false, givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:s', ends: 'done' } } },
    { id: 'quits', title: 'TEST', abandon: 'walked', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:s', ends: 'done' } }, outcomes: { walked: { failure: true } } },
    { id: 'first', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:first', ends: 'won' } }, outcomes: { won: {} } },
    { id: 'second', title: 'TEST', givers: [{ kind: 'chain', after: 'first', outcome: 'won' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:second', failOn: ['death'], ends: 'done' } } },
    { id: 'dice', title: 'TEST', givers: [{ kind: 'debug' }], start: ['never', 'always'], steps: { never: { type: 'nothing', chance: 0 }, always: { type: 'signal', signal: 'debug:dice', chance: 1, ends: 'done' } } },
    { id: 'later', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:later', do: { done: ['gesture(emt_wave1)'] }, next: [{ to: 'rich', when: 'met(cast/somebody)' }, { to: 'poor', when: 'call(test.always)' }, { to: 'nobody', when: 'call(nothing.here)' }] }, rich: { type: 'nothing' }, poor: { type: 'nothing' }, nobody: { type: 'nothing' } } },
    { id: 'circle', title: 'TEST', givers: [{ kind: 'debug' }], start: ['a'], steps: { a: { type: 'nothing', loop: true, next: ['b'] }, b: { type: 'nothing', loop: true, next: ['a'] } } },
  ]);
  const h = hostOf(lib);
  h.grant('own:stuck', at(T0));
  ok(h.drop('own:stuck', at(T0 + 1)).why === 'this job cannot be dropped' && q(h, 'own:stuck')?.state === 'active', 'a quest that may not be abandoned says so');
  h.grant('own:quits', at(T0));
  h.drop('own:quits', at(T0 + 1));
  ok(q(h, 'own:quits')?.state === 'failed' && q(h, 'own:quits')?.outcome === 'walked', 'one that names what abandoning means ends as that outcome');
  h.grant('own:first', at(T0));
  h.event({ k: 'signal', name: 'debug:first' }, at(T0 + 1));
  ok(q(h, 'own:second')?.state === 'active', 'a quest chained after another\'s outcome is granted when it ends that way');
  h.event({ k: 'death' }, at(T0 + 2));
  ok(q(h, 'own:second')?.state === 'failed', 'and dying fails a step that fails on death, and with no onFail the quest');
  h.grant('own:dice', at(T0));
  ok(stepOf(h, 'own:dice', 'never')?.state === 'skipped' && stepOf(h, 'own:dice', 'always')?.state === 'active', 'a chance of nought is skipped and one of one is not');
  ok(seedRoll('char-1', 'own:dice', 1, 'chance:x') === seedRoll('char-1', 'own:dice', 1, 'chance:x') && seedRoll('char-1', 'own:dice', 1, 'chance:x') !== seedRoll('char-1', 'own:dice', 2, 'chance:x'), 'a roll is the same for the same character, quest, run and place, and another run rolls again');
  h.grant('own:later', at(T0));
  const lr = h.event({ k: 'signal', name: 'debug:later' }, at(T0 + 1));
  ok(lr.unbuilt === 2 && lr.misses === 1 && stepOf(h, 'own:later', 'poor')?.state === 'done' && stepOf(h, 'own:later', 'rich') === undefined && stepOf(h, 'own:later', 'nobody') === undefined, 'a later wave\'s action does nothing and its condition reads false, both counted; a registered script answers and an unknown one reads false, counted');
  const revBefore = h.book.rev;
  const c = h.grant('own:circle', at(T0));
  ok(/circle/.test(c.why ?? '') && c.notes.length === 1 && c.notes[0].k === 'say', 'a circle in the data is stopped and said, rather than hanging the host');
  ok(c.ch.length === 0 && c.pay.length === 0 && q(h, 'own:circle') === undefined && h.book.rev === revBefore, 'and everything that event worked out is thrown away: the book is left exactly as it was');
  const hour = evalCond({ hour: [22, 4] }, emptyBook('x'), { now: 0, char: 'x', payer: 'browser', hour: 2 }) && !evalCond({ hour: [22, 4] }, emptyBook('x'), { now: 0, char: 'x', payer: 'browser', hour: 12 });
  ok(hour && !evalCond({ hour: [0, 24] }, emptyBook('x'), { now: 0, char: 'x', payer: 'browser' }), 'an hour range may wrap past midnight, and with no hour told it reads false');
}

// ---- what the character has: credits, a thing owned, Standing and Trust ----------------------------------------
{
  const book = emptyBook('x');
  book.tracks = { freelance: { standing: 2, trust: 7 } } as StoryBook['tracks'];
  const counts: Record<string, number> = { 'wear:shirt_s03': 1, 'weapon:pistol_dl44': 2 };
  const ctx = (extra: Record<string, unknown> = {}) => ({ now: 0, char: 'x', payer: 'browser' as const, credits: 5, has: (k: string, id: string) => counts[`${k}:${id}`] ?? 0, ...extra });
  const holds = (c: unknown, extra: Record<string, unknown> = {}) => evalCond(c as Parameters<typeof evalCond>[0], book, ctx(extra));
  ok(holds({ credits: { gte: 5 } }) && !holds({ credits: { gte: 5 } }, { credits: 4 }) && !holds({ credits: { gte: 0 } }, { credits: null }) && holds({ credits: { lt: 6 } }), 'credits() >= 5 holds with five and not with four; with the purse unknown it reads false');
  ok(holds({ has: { kind: 'wear', id: 'shirt_s03' } }) && !holds({ has: { kind: 'wear', id: 'pants_s01' } }) && !holds({ has: { kind: 'weapon', id: 'shirt_s03' } }), 'has(kind, id) holds for a thing owned, and not for one that is not, nor under the other kind');
  ok(holds({ has: { kind: 'weapon', id: 'pistol_dl44', n: 2 } }) && !holds({ has: { kind: 'wear', id: 'shirt_s03', n: 2 } }) && !holds({ has: { kind: 'wear', id: 'shirt_s03' } }, { has: null }), 'and asks for as many as it says; with the backpack unknown it reads false');
  ok(holds({ standing: { track: 'freelance', gte: 2 } }) && !holds({ standing: { track: 'freelance', gte: 3 } }) && !holds({ standing: { track: 'freelance', gte: 7 } }), 'standing(track) reads the track\'s Standing, not its Trust');
  ok(holds({ trust: { track: 'freelance', gte: 7 } }) && !holds({ trust: { track: 'freelance', gte: 8 } }) && !holds({ trust: { track: 'freelance', lte: 2 } }), 'trust(track) reads the track\'s Trust, not its Standing');
  ok(holds({ standing: { track: 'empire', gte: 0 } }) && !holds({ standing: { track: 'empire', gt: 0 } }) && !holds({ trust: { track: 'rebellion', gt: 0 } }), 'a track never touched stands at nought');
  // The same four written as an author writes them, each shown false while the others stay true.
  const lib = setOf('own', [{ id: 'rich', title: 'TEST', needs: 'credits() >= 5 && has(weapon, pistol_dl44, 2) && standing(freelance) >= 2 && trust(freelance) >= 7', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'nothing' } } }]);
  const needs = lib.quests['own:rich'].needs;
  ok(holds(needs), 'written as an expression, all four together hold');
  ok(!holds(needs, { credits: 4 }) && !holds(needs, { has: (k: string, id: string) => (k === 'weapon' && id === 'pistol_dl44' ? 1 : 0) }), 'and one credit short, or one pistol short, they do not');
  const poorer = emptyBook('x');
  poorer.tracks = { freelance: { standing: 1, trust: 7 } } as StoryBook['tracks'];
  const warier = emptyBook('x');
  warier.tracks = { freelance: { standing: 2, trust: 6 } } as StoryBook['tracks'];
  ok(!evalCond(needs, poorer, ctx()) && !evalCond(needs, warier, ctx()), 'nor with a point less Standing, or a point less Trust');
}

// ---- an action that pays is paid once per completion, wherever its step is begun again ---------------------------
{
  const lib = setOf('own', [
    { id: 'wages', title: 'TEST', givers: [{ kind: 'debug' }], start: ['work'], steps: { work: { type: 'signal', signal: 'debug:work', do: { start: ['xp(1)'], done: ['pay(7)', 'standing(empire, 3)'] }, next: ['again'] }, again: { type: 'signal', signal: 'debug:again', loop: true, next: ['work'] } } },
  ]);
  const h = hostOf(lib, 'server');
  const g0 = h.grant('own:wages', at(T0));
  const w1 = h.event({ k: 'signal', name: 'debug:work' }, at(T0 + 1));
  ok(g0.ch.some((c) => c.k === 'xp') && w1.pay.length === 1 && w1.pay[0].credits === 7 && w1.pay[0].key === 'own:wages#1#do:work.done.0' && h.book.tracks?.empire?.standing === 3, `an action that pays is keyed by its quest, the completion and where it is written (${w1.pay[0]?.key})`);
  h.event({ k: 'signal', name: 'debug:again' }, at(T0 + 2));
  const w2 = h.event({ k: 'signal', name: 'debug:work' }, at(T0 + 3));
  ok(w2.pay.length === 0 && h.book.xp === 1 && h.book.tracks?.empire?.standing === 3, 'reached again in the same run, its step begun and done again: nothing more paid, recorded or moved');
  const r = h.restart('own:wages', at(T0 + 4));
  const w3 = h.event({ k: 'signal', name: 'debug:work' }, at(T0 + 5));
  ok(r.pay.length === 0 && w3.pay.length === 0 && h.book.xp === 1 && h.book.tracks?.empire?.standing === 3 && q(h, 'own:wages')?.run === 2, 'nor when the job is started over and the step done in the new run');
}

// ---- a reward belongs to the completion it counts towards, never to the run --------------------------------
{
  const h = hostOf(LIB, 'server');
  let pays = h.grant('test:reward', at(T0)).pay.length;
  for (let i = 1; i <= 5; i++) pays += h.restart('test:reward', at(T0 + i)).pay.length;
  ok(pays === 2 && q(h, 'test:reward')?.run === 6 && h.book.xp === 10 && h.book.tracks?.freelance?.standing === 5, 'restarted five times, the reward step reached again on every run pays nothing more: no credits, item, experience or standing');
  let more = 0;
  for (let i = 1; i <= 5; i++) {
    h.drop('test:reward', at(T0 + 10 + i));
    more += h.grant('test:reward', at(T0 + 20 + i)).pay.length;
  }
  ok(more === 0 && h.book.xp === 10 && Object.keys(h.book.paid ?? {}).length === 1, 'nor dropped and granted again, five times over');
  h.event({ k: 'signal', name: 'debug:test-finish' }, at(T0 + 100));
  const next = h.grant('test:reward', at(T0 + 101));
  ok(q(h, 'test:reward')?.completions === 1 && next.pay.length === 2 && next.pay[0].key === 'test:reward#2#give', 'once it is done, taking it again counts towards a second completion and pays again');
}

// ---- repeats: never, a limit, once a game day, once a real day ---------------------------------------------------
{
  const lib = setOf('own', [
    { id: 'once', title: 'TEST', givers: [{ kind: 'debug' }], start: ['pay'], steps: { pay: { type: 'reward', reward: { credits: 100 }, next: ['wait'] }, wait: { type: 'signal', signal: 'debug:once', timeLimit: { seconds: 10 }, ends: 'done' } } },
    { id: 'twice', title: 'TEST', repeat: { every: 'always', limit: 2 }, givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'nothing', ends: 'done' } } },
    { id: 'daily', title: 'TEST', repeat: { every: 'gameDay' }, givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'nothing', ends: 'done' } } },
    { id: 'realDaily', title: 'TEST', repeat: { every: 'realDay' }, givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'nothing', ends: 'done' } } },
    { id: 'tries', title: 'TEST', repeat: { every: 'always' }, givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:tries', timeLimit: { seconds: 5 }, ends: 'done' } } },
  ]);
  // A quest that says nothing about repeating is taken once: after it is done, and after it has failed.
  const done = hostOf(lib, 'server');
  ok(done.grant('own:once', at(T0)).pay.length === 1, 'a quest with no repeat pays as it is taken');
  done.event({ k: 'signal', name: 'debug:once' }, at(T0 + 1000));
  const doneAgain = done.grant('own:once', at(T0 + 2000));
  ok(q(done, 'own:once')?.state === 'done' && doneAgain.why === 'this job is done' && doneAgain.ch.length === 0 && doneAgain.pay.length === 0, 'and once done is refused a second grant, with nothing paid');
  const failed = hostOf(lib, 'server');
  failed.grant('own:once', at(T0));
  failed.sweep(at(T0 + 10000));
  const failedAgain = failed.grant('own:once', at(T0 + 11000));
  ok(q(failed, 'own:once')?.state === 'failed' && q(failed, 'own:once')?.completions === 0 && failedAgain.why === 'this job has failed' && failedAgain.pay.length === 0, 'once failed is refused too, and a failure counts no completion');
  const retried = failed.restart('own:once', at(T0 + 12000));
  ok(retried.why === null && retried.pay.length === 0 && q(failed, 'own:once')?.run === 2, 'started over after failing, it pays nothing the failed try already paid');
  // A limit.
  const lim = hostOf(lib);
  lim.grant('own:twice', at(T0));
  lim.grant('own:twice', at(T0 + 1));
  const third = lim.grant('own:twice', at(T0 + 2));
  ok(q(lim, 'own:twice')?.completions === 2 && /at most/.test(third.why ?? '') && third.ch.length === 0, `a limit of two refuses the third (${third.why})`);
  // Once a game day, and once a real day.
  const g0 = Math.floor(T0 / GAME_DAY_MS) * GAME_DAY_MS + 1000;
  const gd = hostOf(lib);
  gd.grant('own:daily', at(g0));
  ok(/next game day/.test(gd.grant('own:daily', at(g0 + GAME_DAY_MS - 2000)).why ?? '') && gd.grant('own:daily', at(g0 + GAME_DAY_MS)).why === null && q(gd, 'own:daily')?.completions === 2, 'once a game day: refused later the same game day, and taken the next');
  const r0 = Math.floor(T0 / REAL_DAY_MS) * REAL_DAY_MS + 1000;
  const rd = hostOf(lib);
  rd.grant('own:realDaily', at(r0));
  ok(/tomorrow/.test(rd.grant('own:realDaily', at(r0 + REAL_DAY_MS - 2000)).why ?? '') && rd.grant('own:realDaily', at(r0 + REAL_DAY_MS)).why === null && q(rd, 'own:realDaily')?.completions === 2, 'once a real day: refused later the same day, and taken the next');
  // A failure leaves the completions alone; a done adds one.
  const t = hostOf(lib);
  t.grant('own:tries', at(T0));
  t.sweep(at(T0 + 5000));
  ok(q(t, 'own:tries')?.state === 'failed' && q(t, 'own:tries')?.completions === 0, 'a run that fails counts no completion');
  t.grant('own:tries', at(T0 + 6000));
  t.event({ k: 'signal', name: 'debug:tries' }, at(T0 + 7000));
  ok(q(t, 'own:tries')?.completions === 1 && evalCond({ completions: 'own:tries', gte: 1 }, t.book, { now: T0, char: 'char-1', payer: 'browser' }), 'and one that is done counts one');
  // A dropped quest reads as none.
  t.grant('own:tries', at(T0 + 8000));
  t.drop('own:tries', at(T0 + 9000));
  ok(q(t, 'own:tries')?.state === 'dropped' && evalCond({ quest: 'own:tries', is: 'none' }, t.book, { now: T0, char: 'char-1', payer: 'browser' }), 'questNone holds for a quest that was dropped');
}

// ---- deadlines settled in the order they fell, when the order changes what happens ----------------------------------
{
  const lib = setOf('own', [
    { id: 'slow', title: 'TEST', givers: [{ kind: 'debug' }], start: ['t'], steps: { t: { type: 'timer', for: { seconds: 30 }, next: [{ to: 'after', when: 'flag(order.quick)' }, { to: 'before', when: '!flag(order.quick)' }] }, after: { type: 'end', outcome: 'after' }, before: { type: 'end', outcome: 'before' } }, outcomes: { after: {}, before: {} } },
    { id: 'quick', title: 'TEST', givers: [{ kind: 'debug' }], start: ['t'], steps: { t: { type: 'timer', for: { seconds: 10 }, do: { done: ['flag(order.quick, 1)'] }, ends: 'done' } } },
  ]);
  // The slower is granted first, so it is first in the book: only the sort can put the quicker first.
  const between = hostOf(lib);
  between.grant('own:slow', at(T0));
  between.grant('own:quick', at(T0));
  between.load(at(T0 + 20000, { away: true }));
  ok(q(between, 'own:quick')?.state === 'done' && q(between, 'own:quick')?.ended === T0 + 10000 && q(between, 'own:slow')?.state === 'active' && stepOf(between, 'own:slow', 't')?.state === 'active', 'loaded between the two: the one that fell due is settled at its own time and the other is not');
  const after = hostOf(lib);
  after.grant('own:slow', at(T0));
  after.grant('own:quick', at(T0));
  after.load(at(T0 + 40000, { away: true }));
  ok(q(after, 'own:quick')?.ended === T0 + 10000 && q(after, 'own:slow')?.outcome === 'after' && q(after, 'own:slow')?.ended === T0 + 30000, 'loaded after both: the earlier first, so the later one finds the flag the earlier set and goes the way that says');
}

// ---- the played clock: a step that begins while the character is away keeps its time ---------------------------------
{
  const lib = setOf('own', [{ id: 'twoClocks', title: 'TEST', givers: [{ kind: 'debug' }], start: ['first'], steps: { first: { type: 'timer', for: { seconds: 60 }, next: ['second'] }, second: { type: 'timer', for: { seconds: 600, clock: 'played' }, ends: 'done' } } }]);
  const h = hostOf(lib);
  h.grant('own:twoClocks', at(T0));
  h.event({ k: 'leave' }, at(T0 + 1000));
  h.load(at(T0 + 7200000, { away: true }));
  const second = stepOf(h, 'own:twoClocks', 'second');
  ok(stepOf(h, 'own:twoClocks', 'first')?.at === T0 + 60000 && second?.state === 'active' && second.remaining === 600000 && second.deadline === undefined && q(h, 'own:twoClocks')?.state === 'active', 'two hours away: the world timer ran out offline, and the played one it led to began with all ten minutes kept');
  h.event({ k: 'enter' }, at(T0 + 7200000));
  ok(stepOf(h, 'own:twoClocks', 'second')?.deadline === T0 + 7200000 + 600000, 'coming back in starts it counting');
  ok(h.sweep(at(T0 + 7200000 + 599999)).ch.length === 0, 'and a moment short of ten minutes played it has not run out');
  h.sweep(at(T0 + 7200000 + 600000));
  ok(q(h, 'own:twoClocks')?.state === 'done', 'ten minutes played after, it has');
  // An observe step's watch is closed when the character leaves inside the area, so the time away is not counted.
  const sq = 'test:area/test-square';
  const o = hostOf();
  o.grant('test:observe', at(T0 + 1000, { areas: [sq] }));
  o.event({ k: 'leave' }, at(T0 + 2000));
  ok(stepOf(o, 'test:observe', 'watch')?.n === 1000 && stepOf(o, 'test:observe', 'watch')?.since === undefined, 'leaving the world inside the square closes the watch with the second it had');
  o.load(at(T0 + 3600000, { away: true }));
  ok(q(o, 'test:observe')?.state === 'active' && stepOf(o, 'test:observe', 'watch')?.n === 1000, 'and an hour away fills nothing of it');
}

// ---- every part of the step machine, driven ----------------------------------------------------------------------------
{
  const lib = setOf(
    'own',
    [
      { id: 'teller', title: 'TEST', givers: [{ kind: 'debug' }], start: ['say'], steps: { say: { type: 'signal', signal: 'debug:tell', do: { start: ['flag(teller.started, 1)'] }, signalsOut: { done: ['word'] }, grant: { done: ['given'] }, ends: 'done' } } },
      { id: 'listener', title: 'TEST', givers: [{ kind: 'debug' }], start: ['hear'], steps: { hear: { type: 'signal', signal: 'word', ends: 'done' } } },
      { id: 'given', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:given', ends: 'done' } } },
      { id: 'failer', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:never', timeLimit: { seconds: 5 }, do: { fail: ['flag(failer.failed, 1)'] }, onFail: ['after'] }, after: { type: 'nothing', ends: 'done' } } },
      { id: 'one', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:one', nextOne: [{ to: 'a', when: 'flag(nope)' }, { to: 'b' }, { to: 'c' }] }, a: { type: 'signal', signal: 'debug:x', ends: 'done' }, b: { type: 'signal', signal: 'debug:x', ends: 'done' }, c: { type: 'signal', signal: 'debug:x', ends: 'done' } } },
      { id: 'rescued', title: 'TEST', givers: [{ kind: 'debug' }], start: ['wait'], steps: { wait: { type: 'signal', signal: 'word2', onStuck: 'rescue' }, rescue: { type: 'signal', signal: 'debug:rescue', ends: 'done' } } },
      { id: 'sayer2', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:say2', signalsOut: { done: ['word2'] }, ends: 'done' } } },
      { id: 'bare', title: 'TEST', repeat: { every: 'always' }, givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:bare' } } },
      { id: 'paidout', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'end', outcome: 'won' } }, outcomes: { won: { reward: { credits: 7 } } } },
      { id: 'clear', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:clear', ends: 'cleared' } } },
      { id: 'user', title: 'TEST', givers: [{ kind: 'debug' }], start: ['u'], steps: { u: { type: 'use', object: 'obj/box', ends: 'done' } } },
      { id: 'manual', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:manual', next: ['t'] }, t: { type: 'signal', signal: 'debug:manual2', ends: 'done' } }, outcomes: { quit: { failure: true } } },
      { id: 'redo', title: 'TEST', givers: [{ kind: 'debug' }], start: ['a'], steps: { a: { type: 'signal', signal: 'debug:redo', do: { done: ['restart(own:redo)'] }, next: ['b'] }, b: { type: 'signal', signal: 'debug:b2', ends: 'done' } } },
    ],
    [{ path: 'objects/box.jsonc', text: JSON.stringify({ id: 'box', world: 'tatooine', template: 'object/tangible/test/shared_box.iff', near: [0, 0] }) }],
  );
  const h = hostOf(lib);
  h.grant('own:listener', at(T0));
  h.grant('own:teller', at(T0));
  ok(h.book.flags?.['teller.started'] === 1, 'a step\'s do.start actions run as it begins');
  h.event({ k: 'signal', name: 'debug:tell' }, at(T0 + 1));
  ok(q(h, 'own:teller')?.state === 'done' && q(h, 'own:listener')?.state === 'done', 'a step done raises its signalsOut, which counts another quest\'s step waiting on it');
  ok(q(h, 'own:given')?.state === 'active', 'and grants its grant.done');
  h.grant('own:failer', at(T0));
  h.sweep(at(T0 + 5000));
  ok(stepOf(h, 'own:failer', 's')?.state === 'failed' && h.book.flags?.['failer.failed'] === 1 && q(h, 'own:failer')?.state === 'done', 'a step that fails runs its do.fail, and goes on into its onFail');
  h.grant('own:one', at(T0));
  h.event({ k: 'signal', name: 'debug:one' }, at(T0 + 1));
  ok(stepOf(h, 'own:one', 'a') === undefined && stepOf(h, 'own:one', 'b')?.state === 'active' && stepOf(h, 'own:one', 'c') === undefined, 'nextOne follows only the first edge whose condition holds');
  h.grant('own:rescued', at(T0));
  h.run(['close(own:sayer2)'], at(T0 + 1), 'own');
  ok(stepOf(h, 'own:rescued', 'wait')?.state === 'skipped' && stepOf(h, 'own:rescued', 'rescue')?.state === 'active' && q(h, 'own:rescued')?.state === 'active', 'a stuck step whose onStuck names a step goes on to that step');
  h.grant('own:bare', at(T0));
  h.event({ k: 'signal', name: 'debug:bare' }, at(T0 + 1));
  ok(q(h, 'own:bare')?.state === 'done' && q(h, 'own:bare')?.outcome === 'done', 'a quest with nothing active or waiting left ends done by itself');
  const won = h.grant('own:paidout', at(T0));
  ok(q(h, 'own:paidout')?.outcome === 'won' && won.pay.length === 1 && won.pay[0].credits === 7 && won.pay[0].key === 'own:paidout#1#out:won', 'an outcome\'s reward is paid when the quest ends with it, under that outcome\'s own key');
  h.grant('own:clear', at(T0));
  h.event({ k: 'signal', name: 'debug:clear' }, at(T0 + 1));
  ok(q(h, 'own:clear')?.state === 'none' && q(h, 'own:clear')?.history.at(-1)?.outcome === 'cleared' && q(h, 'own:clear')?.completions === 0 && h.grant('own:clear', at(T0 + 2)).why === null, 'ending as cleared puts the quest back to none, its history kept, and it may be taken again');
  h.run(['end(own:clear, cleared)'], at(T0 + 3), 'own');
  ok(q(h, 'own:clear')?.state === 'none' && q(h, 'own:clear')?.history.length === 2, 'and so does the action end(q, cleared)');
  h.grant('own:user', at(T0));
  ok(h.view(at(T0)).watch.some((w) => w.k === 'use' && w.object === 'own:obj/box'), 'a use step asks the detectors to watch for E on its object');
  h.event({ k: 'use', object: 'own:obj/box' }, at(T0 + 1));
  ok(q(h, 'own:user')?.state === 'done', 'and E on it does it');
  // Offers.
  const offered = h.offer('own:bare', at(T0 + 10));
  ok(q(h, 'own:bare')?.state === 'offered' && offered.notes.some((n) => n.k === 'offered') && h.view(at(T0 + 10)).quests.find((x) => x.id === 'own:bare')?.canDrop === true, 'a quest can be offered, and an offer can be turned down');
  h.decline('own:bare', at(T0 + 11));
  ok(q(h, 'own:bare')?.state === 'none', 'declined, it is none again');
  h.offer('own:bare', at(T0 + 12));
  const accepted = h.accept('own:bare', at(T0 + 13));
  ok(q(h, 'own:bare')?.state === 'active' && q(h, 'own:bare')?.run === 2 && accepted.notes.some((n) => n.k === 'job'), 'offered again and accepted, it begins its next run');
  h.drop('own:bare', at(T0 + 14));
  h.offer('own:bare', at(T0 + 15));
  h.grant('own:bare', at(T0 + 16));
  ok(q(h, 'own:bare')?.state === 'active', 'and granting a quest on offer accepts it');
  // The console's complete and end.
  h.grant('own:manual', at(T0));
  h.run(['complete(own:manual, s)'], at(T0 + 1), 'own');
  ok(stepOf(h, 'own:manual', 's')?.state === 'done' && stepOf(h, 'own:manual', 't')?.state === 'active', 'complete(q, s) does a step as if it had been done, and the quest goes on from it');
  h.run(['end(own:manual, quit)'], at(T0 + 2), 'own');
  ok(q(h, 'own:manual')?.state === 'failed' && q(h, 'own:manual')?.outcome === 'quit', 'end(q, o) ends it with the outcome named, a failure when the outcome says so');
  // A restart in the middle of a step's own completion drops what that step was about to set off in the old run.
  h.grant('own:redo', at(T0));
  h.event({ k: 'signal', name: 'debug:redo' }, at(T0 + 1));
  ok(q(h, 'own:redo')?.run === 2 && stepOf(h, 'own:redo', 'a')?.state === 'active' && stepOf(h, 'own:redo', 'b') === undefined, 'a quest restarted by its own step begins again, and the step the old run was going on to is never begun in the new one');
}

// ---- what a step matches: a kill's group and tag, a continuous watch, and a roll ------------------------------------------
{
  const lib = setOf(
    'own',
    [
      { id: 'byGroup', title: 'TEST', givers: [{ kind: 'debug' }], start: ['k'], steps: { k: { type: 'kill', group: 'creatures/critter', n: 1, ends: 'done' } } },
      { id: 'byTag', title: 'TEST', givers: [{ kind: 'debug' }], start: ['k'], steps: { k: { type: 'kill', tag: 'beast', n: 1, ends: 'done' } } },
      { id: 'still', title: 'TEST', givers: [{ kind: 'debug' }], start: ['w'], steps: { w: { type: 'observe', area: 'area/spot', seconds: 10, continuous: true, ends: 'done' } } },
      { id: 'coin', title: 'TEST', givers: [{ kind: 'debug' }], start: ['flip', 'base'], steps: { flip: { type: 'nothing', chance: 0.5, do: { done: ['flag(coin.heads, 1)'] } }, base: { type: 'signal', signal: 'debug:coin', ends: 'done' } } },
    ],
    [{ path: 'areas/spot.jsonc', text: JSON.stringify({ id: 'spot', world: 'tatooine', shape: { kind: 'circle', c: [0, 0], r: 5 } }) }],
  );
  const h = hostOf(lib);
  h.grant('own:byGroup', at(T0));
  h.grant('own:byTag', at(T0));
  h.event({ k: 'kill', who: 'kreetle', group: 'creatures/other', tags: ['critter'] }, at(T0 + 1));
  ok(q(h, 'own:byGroup')?.state === 'active' && q(h, 'own:byTag')?.state === 'active', 'a kill of another group, carrying another tag, counts for neither');
  h.event({ k: 'kill', who: 'kreetle', group: 'creatures/critter', tags: ['critter'] }, at(T0 + 2));
  ok(q(h, 'own:byGroup')?.state === 'done' && q(h, 'own:byTag')?.state === 'active', 'one of the group counts for the group\'s step alone');
  h.event({ k: 'kill', who: 'kreetle', group: 'creatures/other', tags: ['critter', 'beast'] }, at(T0 + 3));
  ok(q(h, 'own:byTag')?.state === 'done', 'and one carrying the tag for the tag\'s');
  const spot = 'own:area/spot';
  h.grant('own:still', at(T0));
  h.event({ k: 'area', area: spot, inside: true }, at(T0));
  h.event({ k: 'area', area: spot, inside: false }, at(T0 + 6000));
  ok(stepOf(h, 'own:still', 'w')?.n === 0, 'a continuous watch broken off keeps nothing of what it had');
  h.event({ k: 'area', area: spot, inside: true }, at(T0 + 7000));
  ok(h.sweep(at(T0 + 16999)).ch.length === 0 && q(h, 'own:still')?.state === 'active', 'and counts from nought again when it starts again');
  h.sweep(at(T0 + 17000));
  ok(q(h, 'own:still')?.state === 'done', 'ten seconds unbroken fill it');
  let heads = 0;
  let agree = 0;
  for (let i = 0; i < 24; i++) {
    const char = `char-${i}`;
    const c = new HostCore({ book: emptyBook(char), lib, payer: 'browser' });
    c.grant('own:coin', at(T0));
    const up = stepOf(c, 'own:coin', 'flip')?.state === 'done';
    if (up) heads++;
    if (up === seedRoll(char, 'own:coin', 1, 'chance:flip') < 0.5 && (up ? c.book.flags?.['coin.heads'] === 1 : stepOf(c, 'own:coin', 'flip')?.state === 'skipped')) agree++;
  }
  ok(agree === 24 && heads > 0 && heads < 24, `a chance of a half comes up exactly as the seeded roll says, for each character, and both ways (${heads} of 24 came up)`);
}

// ---- waiting steps that can never begin, and a closed quest that is still running ------------------------------------------
{
  const lib = setOf('own', [
    { id: 'excl', title: 'TEST', givers: [{ kind: 'debug' }], start: ['fork'], steps: { fork: { type: 'signal', signal: 'debug:fork', nextOne: [{ to: 'a', when: 'flag(excl.a)' }, { to: 'b' }] }, a: { type: 'nothing', next: ['meet'] }, b: { type: 'nothing', next: ['meet'] }, meet: { type: 'join', after: ['a', 'b'], ends: 'done' } } },
    { id: 'exclSkip', title: 'TEST', givers: [{ kind: 'debug' }], start: ['fork'], steps: { fork: { type: 'signal', signal: 'debug:fork', nextOne: [{ to: 'a', when: 'flag(excl.a)' }, { to: 'b' }] }, a: { type: 'nothing', next: ['meet'] }, b: { type: 'nothing', next: ['meet'] }, meet: { type: 'join', after: ['a', 'b'], onStuck: 'skip', ends: 'done' } } },
    { id: 'maybe', title: 'TEST', givers: [{ kind: 'debug' }], start: ['roll', 'meet'], steps: { roll: { type: 'nothing', chance: 0 }, meet: { type: 'join', after: ['roll'], ends: 'done' } } },
    { id: 'selfClose', title: 'TEST', givers: [{ kind: 'debug' }], start: ['first', 'wait'], steps: { first: { type: 'nothing', do: { done: ['close(own:selfClose)'] }, next: ['shout'] }, shout: { type: 'signal', signal: 'debug:shout', signalsOut: { done: ['selfword'] } }, wait: { type: 'signal', signal: 'selfword', ends: 'done' } } },
  ]);
  const h = hostOf(lib);
  h.grant('own:excl', at(T0));
  h.event({ k: 'signal', name: 'debug:fork' }, at(T0 + 1));
  ok(q(h, 'own:excl')?.state === 'stalled' && q(h, 'own:excl')?.why === STALLED_STUCK, 'a join after two steps only one branch of a nextOne can reach is held once the other branch is taken, not left waiting for ever');
  ok(h.view(at(T0 + 1)).quests.find((x) => x.id === 'own:excl')?.canDrop === true, 'with Drop offered');
  h.grant('own:exclSkip', at(T0));
  h.event({ k: 'signal', name: 'debug:fork' }, at(T0 + 2));
  ok(stepOf(h, 'own:exclSkip', 'meet')?.state === 'skipped' && q(h, 'own:exclSkip')?.state === 'done', 'and one whose onStuck says skip is skipped, and the quest ends when nothing else is left');
  h.grant('own:maybe', at(T0));
  ok(q(h, 'own:maybe')?.state === 'stalled', 'a join after a step whose roll did not come up is held at once');
  h.sweep(at(1e12));
  ok(q(h, 'own:maybe')?.state === 'stalled', 'and nothing later moves it on by itself');
  h.grant('own:selfClose', at(T0));
  ok(q(h, 'own:selfClose')?.state === 'active' && h.book.closed?.includes('own:selfClose'), 'a quest that closes itself on its first step is still running, and its own steps that wait on its own later signal are not held');
  h.event({ k: 'signal', name: 'debug:shout' }, at(T0 + 1));
  ok(q(h, 'own:selfClose')?.state === 'done' && h.grant('own:selfClose', at(T0 + 2)).why === 'that job is closed', 'it finishes as it was written, and is then closed for good');
}

// ---- a circle of quests chained after themselves pays nothing ---------------------------------------------------------------
{
  const lib = setOf('own', [{ id: 'loop', title: 'TEST', repeat: { every: 'always' }, givers: [{ kind: 'debug' }, { kind: 'chain', after: 'loop' }], start: ['pay'], steps: { pay: { type: 'reward', reward: { credits: 10, xp: 1 }, ends: 'done' } } }]);
  const h = hostOf(lib, 'server');
  const r = h.grant('own:loop', at(T0));
  ok(/circle/.test(r.why ?? '') && r.ch.length === 0 && r.pay.length === 0 && h.book.paid === undefined && h.book.xp === undefined && h.book.rev === 0, `a quest chained after itself that finishes the moment it is given is stopped, and pays nothing at all (${r.pay.length} payments, ${r.ch.length} changes)`);
}

// ---- the view: steps shown after, ended quests newest first, watches, restarts and the history's length ----------------------------
{
  const lib = setOf(
    'own',
    [
      { id: 'late', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:late', visible: 'after', objective: 'TEST: shown once done', next: ['t'] }, t: { type: 'signal', signal: 'debug:late2', ends: 'done' } } },
      { id: 'first', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'nothing', ends: 'done' } } },
      { id: 'second', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'nothing', ends: 'done' } } },
      { id: 'mortal', title: 'TEST', restart: 'never', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:mortal', failOn: ['death'], next: [{ to: 'here', when: 'inArea(area/zone)' }, { to: 'there', when: '!inArea(area/zone)' }] }, here: { type: 'end' }, there: { type: 'end' } } },
      { id: 'tick', title: 'TEST', repeat: { every: 'always' }, givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'nothing', ends: 'done' } } },
    ],
    [{ path: 'areas/zone.jsonc', text: JSON.stringify({ id: 'zone', world: 'tatooine', shape: { kind: 'rect', min: [0, 0], max: [10, 10] } }) }],
  );
  const h = hostOf(lib);
  h.grant('own:late', at(T0));
  const lineOf = (s: string) => h.view(at(T0 + 5)).quests.find((x) => x.id === 'own:late')?.lines.find((l) => l.step === s);
  ok(lineOf('s') === undefined, 'a step written visible "after" shows no line while it is still to do');
  h.event({ k: 'signal', name: 'debug:late' }, at(T0 + 1));
  ok(lineOf('s')?.done === true && lineOf('s')?.text === 'TEST: shown once done', 'and shows its line, done, once it is');
  h.grant('own:second', at(T0 + 10));
  h.grant('own:first', at(T0 + 20));
  const ended = h.view(at(T0 + 30)).quests.filter((x) => x.state === 'done').map((x) => x.id);
  ok(ended[0] === 'own:first' && ended[1] === 'own:second', `ended quests are listed newest first (${ended.join(', ')})`);
  h.grant('own:mortal', at(T0));
  const watch = h.view(at(T0 + 30)).watch;
  ok(watch.some((w) => w.k === 'death') && watch.some((w) => w.k === 'area' && w.id === 'own:area/zone'), 'a step that fails on death asks for deaths to be watched, and an area a condition names is watched too, though no step stands in it');
  const viewOfQ = (id: string) => h.view(at(T0 + 30)).quests.find((x) => x.id === id);
  ok(viewOfQ('own:late')?.canRestart === true && viewOfQ('own:mortal')?.canRestart === false, 'a quest that may be started over says so, and one that may not does not');
  const hh = hostOf(LIB);
  hh.grant('test:harsh', at(T0));
  ok(hh.view(at(T0)).quests.find((x) => x.id === 'test:harsh')?.canRestart === false, 'nor does a harsh one');
  for (let i = 0; i < 12; i++) h.grant('own:tick', at(T0 + 100 + i));
  const hist = q(h, 'own:tick')!.history;
  ok(hist.length === 8 && hist[0].run === 5 && hist[7].run === 12 && q(h, 'own:tick')?.completions === 12, `a quest remembers the outcomes of its last eight runs and no more (${hist.length}, from run ${hist[0]?.run})`);
}

// ---- a quest whose id is as long as an id may be still has a waypoint the player can switch -----------------------------------
{
  const name = 'x'.repeat(96);
  const lib = setOf('own', [{ id: name, title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'goto', at: { world: 'tatooine', raw: [0, 0] }, ends: 'done' } } }]);
  const h = hostOf(lib);
  h.grant(`own:${name}`, at(T0, { here: [5000, 5000] }));
  const id = questWaypointId(`own:${name}`, 's');
  ok(h.view(at(T0)).waypoints.some((w) => w.id === id) && applyChanges(h.book, [{ k: 'qwpOn', key: id, on: false }, { k: 'trackWp', id }]).applied.length === 2 && h.book.trackWp === id, `a quest named with ${name.length} characters has a waypoint that can be switched off and tracked`);
}

// ---- two hosts, one rule book: the batches one wrote, replayed by the other, make the same book ----------------
{
  const log: unknown[][] = [];
  const server = new HostCore({ book: emptyBook('char-1'), lib: LIB, payer: 'server', apply: (ch) => {
    log.push(JSON.parse(JSON.stringify(ch)));
    applyChanges(server.book, ch);
  } });
  const browser = new HostCore({ book: emptyBook('char-1'), lib: LIB, payer: 'browser' });
  const script: [string, (h: HostCore) => StoryResult][] = [
    ['grant goto', (x) => x.grant('test:goto', at(T0))],
    ['grant timer', (x) => x.grant('test:timer', at(T0))],
    ['arrive', (x) => x.event({ k: 'arrive', world: 'tatooine', p: [3030, -4000] }, at(T0 + 1000))],
    ['sweep', (x) => x.sweep(at(T0 + 61000))],
    ['grant reward', (x) => x.grant('test:reward', at(T0 + 62000))],
    ['loop round', (x) => x.event({ k: 'signal', name: 'debug:test-again' }, at(T0 + 63000))],
    ['restart', (x) => x.restart('test:reward', at(T0 + 64000))],
    ['grant kill', (x) => x.grant('test:kill', at(T0 + 65000))],
    ['kill', (x) => x.event({ k: 'kill', who: 'womp_rat', social: 'rat' }, at(T0 + 66000))],
    ['nothing at all', (x) => x.event({ k: 'signal', name: 'debug:nobody' }, at(T0 + 67000))],
  ];
  const results: StoryResult[] = [];
  const mirror: StoryResult[] = [];
  for (const [, step] of script) {
    results.push(step(server));
    mirror.push(step(browser));
  }
  const replay = emptyBook('char-1');
  for (const ch of log) applyChanges(replay, ch);
  ok(stableText(replay) === stableText(server.book) && replay.rev === log.length, 'every batch the server wrote down, played back on a fresh book, makes the very book it holds');
  const answered = results.filter((r) => r.ch.length).map((r) => stableText(r.ch));
  ok(answered.length === log.length && answered.every((t, i) => t === stableText(log[i])), `and each batch it wrote down is exactly the changes it answered, which is what goes down the wire (${log.length} batches)`);
  const sansPayer = (b: StoryBook) => {
    const c = JSON.parse(JSON.stringify(b)) as StoryBook;
    for (const k of Object.keys(c.paid ?? {})) delete (c.paid as Record<string, { by?: string }>)[k].by;
    return stableText(c);
  };
  ok(sansPayer(browser.book) === sansPayer(server.book) && Object.keys(server.book.paid ?? {}).length > 0, 'a browser holding the book itself, told the same things, holds the same book, but for who paid');
  ok(stableText(mirror.map((r) => r.pay)) === stableText(results.map((r) => r.pay)) && results.every((r) => r.why === null) && mirror.every((r) => r.why === null), 'and is asked for the same payments, and neither refused anything');
  ok(results.flatMap((r) => r.pay).length === 2, 'only the reward\'s two payments were asked for, the loop round and the restart paying nothing');
}

console.log(`\n${checks} checks passed`);
