// The rules that decide when a shader program may be built, checked without a browser.
//
// Making a GPU program is blocking work on the main thread, and on a machine with a slow compiler
// it is a flat third of a second whatever the shader says. Seventeen of them on one frame is a
// five-second freeze; one each on seventeen frames is a stutter. Everything in `programPace.ts`
// and the queue in `programQueue.ts` exists to turn the first into the second, and every rule in
// both is pure: a frame's allowance never reads a clock of its own, the queue never reads a
// renderer of its own, and `resolveLinks` only ever asks a program for its uniforms. So all of it
// can be driven here with numbers and stand-ins, which is the only place the ordering can be seen
// at all -- in a browser it is hidden inside a frame.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as THREE from 'three';
import { PACE_TUNE, PaceBudget, QueueWatch, framesFor, paceLine, tuneProgramPace } from '../../../src/core/programPace.ts';
import { ProgramQueue, materialsUnder, resolveLinks, type OwnJob, type QueueLinks } from '../../../src/core/programQueue.ts';
import { SHADER_TUNE } from '../../../src/core/shaderWatch.ts';

/** The pass's base: the queue's idle rule as it stood before the performance pass judged it by frames. */
const BASE = '5f3cff4';
/** The old rule's trace (`idle` over a sweep of instants after one tick), hashed: what the day-one check holds to where git cannot answer. */
const BASE_IDLE_TRACE = '2e02c93d';
const REPO = new URL('../../../', import.meta.url);

/** FNV-1a over a string, as eight hex digits. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** `programQueue.ts` (and the two files it reads) as they stood at `BASE`, out of git into a scratch folder; null where git cannot answer. */
async function baseQueue(): Promise<{ ProgramQueue: typeof ProgramQueue } | null> {
  const show = (rel: string): string | null => {
    try {
      return execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
    } catch {
      return null;
    }
  };
  const files = { programQueue: show('src/core/programQueue.ts'), programPace: show('src/core/programPace.ts'), shaderWatch: show('src/core/shaderWatch.ts') };
  if (!files.programQueue || !files.programPace || !files.shaderWatch) return null;
  const dir = mkdtempSync(join(tmpdir(), 'programpace-base-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, `${name}.ts`), text!.replace(/from 'three'/g, `from '${import.meta.resolve('three')}'`));
    return (await import(pathToFileURL(join(dir, 'programQueue.ts')).href)) as { ProgramQueue: typeof ProgramQueue };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let passed = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

/** A stand-in for anything the queue is asked to compile: the queue only ever holds it and hands it back. */
const obj = (name: string): THREE.Object3D => ({ name }) as unknown as THREE.Object3D;
const nameOf = (o: THREE.Object3D): string => (o as unknown as { name: string }).name;
/** Let the microtask queue run, so a promise the queue answered can be seen to have answered. */
const flush = (): Promise<void> => Promise.resolve().then(() => undefined);
/** A turn at a job that finished the object it was given. */
const built = (made: number): { made: number; done: boolean } => ({ made, done: true });

// --- one frame's allowance ---------------------------------------------------------------------

{
  const b = new PaceBudget();
  b.open(false);
  ok(b.allows(), 'a play frame with nothing built yet will take a job');
  b.charge(1, 0.4);
  ok(!b.allows(), 'one program is the whole of a play frame; the rest wait for the next one');
  ok(b.close() === false, 'a play frame that built one program is not an overrun');
  ok(b.made === 1 && b.jobs === 1, 'the frame reports what it built and how many jobs it took');
}

{
  // One job can build more than one program (an object drawn in the world pass and in a room's),
  // and the budget cannot stop that part way through: it is what the warning is for.
  const b = new PaceBudget();
  b.open(false);
  b.charge(3, 12);
  ok(b.close(), 'a play frame that built three programs says so');
  ok(b.worstFrame === 3 && b.overranFrames === 1, 'the worst play frame and the count of them are kept');
  b.open(false);
  ok(b.close() === false, 'a quiet frame afterwards is not counted as an overrun');
  ok(b.worstFrame === 3, 'the worst frame is remembered across quiet ones');
  b.forget();
  ok(b.worstFrame === 0 && b.overranFrames === 0, 'a new world forgets the worst frame and the overruns');
}

{
  const b = new PaceBudget();
  b.open(false);
  b.charge(0, PACE_TUNE.playMs + 1);
  ok(!b.allows(), 'a frame that has spent its milliseconds takes no more jobs, whatever they built');
  ok(b.close() === false, 'spending milliseconds on jobs that built nothing is not an overrun');
}

{
  const b = new PaceBudget();
  b.open(false);
  for (let i = 0; i < PACE_TUNE.playJobs; i++) b.charge(0, 0);
  ok(!b.allows(), 'the job cap closes a frame even when every job turned out to be free');
  ok(b.jobs === PACE_TUNE.playJobs, 'the jobs taken are counted');
}

{
  const b = new PaceBudget();
  b.open(true);
  ok(b.allows(), 'behind a loading screen the frame takes jobs');
  for (let i = 0; i < SHADER_TUNE.loadBudget; i++) b.charge(1, 0);
  ok(!b.allows(), `behind a screen a frame builds ${SHADER_TUNE.loadBudget} programs and no more`);
  ok(b.close() === false, 'a frame behind a loading screen is never an overrun: that is where the work belongs');
  ok(b.worstFrame === 0, 'and it never counts against the worst play frame');
}

// --- the numbers themselves ---------------------------------------------------------------------

ok(SHADER_TUNE.playBudget === 1, 'the rule this game holds to is one program a frame in play');
ok(SHADER_TUNE.loadBudget > SHADER_TUNE.playBudget, 'a loading screen is allowed more than play is');
ok(PACE_TUNE.loadMs > PACE_TUNE.playMs, 'and more milliseconds');
ok(PACE_TUNE.idleMs > PACE_TUNE.pollMs, 'a waiter looks for a frame several times before it gives up on there being one');

{
  const was = PACE_TUNE.playMs;
  tuneProgramPace({ playMs: 12 });
  ok(PACE_TUNE.playMs === 12, 'a pacing number can be moved live');
  tuneProgramPace({ playMs: Number.NaN });
  ok(PACE_TUNE.playMs === 12, 'a value that is not a number is ignored');
  tuneProgramPace({ playMs: -3 });
  ok(PACE_TUNE.playMs === 12, 'a negative value is ignored');
  tuneProgramPace({ nonsense: 5 } as unknown as Partial<typeof PACE_TUNE>);
  ok(!('nonsense' in PACE_TUNE), 'a name this table does not hold is not quietly added to it');
  tuneProgramPace({ playMs: was });
  ok(PACE_TUNE.playMs === was, 'and it can be put back');
}

// --- how long a queue will take, and the line that says a frame went over ------------------------

{
  const b = new PaceBudget();
  b.open(false);
  ok(b.left === SHADER_TUNE.playBudget, 'a fresh play frame says how many programs it may still build');
  b.charge(1, 0);
  ok(b.left === 0, 'and nothing is left once it has built its one');
  b.charge(3, 0);
  ok(b.left === 0, 'a job that overshot leaves nothing rather than a negative number');
  b.open(true);
  ok(b.left === SHADER_TUNE.loadBudget, 'behind a screen the allowance is the screen’s');
}

ok(framesFor(0, 1) === 0, 'an empty queue takes no frames');
ok(framesFor(5, 1) === 5, 'five programs at one a frame take five frames');
ok(framesFor(5, 2) === 3, 'five at two a frame take three');
ok(framesFor(5, 0) === 5, 'a budget of nothing is read as one, rather than answering for ever');
ok(framesFor(1, 8) === 1, 'anything left to do takes at least one frame');

{
  const line = paceLine(3, 1, 42.4, 'the placed-object streamer');
  ok(line.includes('3 programs'), 'the line names how many were built');
  ok(line.includes('42 ms'), 'and what the frame spent');
  ok(line.includes('1 is the budget'), 'and what it was allowed');
  ok(line.includes('the placed-object streamer'), 'and where the work came from, which is the whole point of it');
  ok(!paceLine(2, 1, 0.2, 'somewhere').includes(' ms'), 'a frame that spent under a millisecond claims no number');
}

// --- the queue: what something is waiting on comes first -----------------------------------------

{
  const q = new ProgramQueue();
  const seen: string[] = [];
  let shown = false;
  q.add([obj('loose1'), obj('loose2')], 'the quarter-second material scan');
  void q.push([obj('tier1'), obj('tier2')], 'the placed-object streamer').then(() => {
    shown = true;
  });
  ok(q.pending === 4, 'the queue holds everything given to it');
  ok(q.waiting === 2, 'and knows how much of it is holding something back from being shown');

  const first = q.pump(false, (o) => {
    seen.push(nameOf(o));
    return built(1);
  }, () => 0);
  ok(first.made === 1, 'a play frame builds one program and leaves the rest');
  ok(seen[0] === 'tier1', 'what something is waiting on is taken before what nobody is waiting on');
  ok(first.from === 'the placed-object streamer', 'and the frame can say where its work came from');
  ok(first.over === false, 'one program is within the rule');
  ok(first.pending === 3, 'the result says how much is left');

  q.pump(false, (o) => {
    seen.push(nameOf(o));
    return built(1);
  }, () => 0);
  await flush();
  ok(shown, 'a batch answers its promise on the frame its last object is built, not a frame later');
  ok(q.waiting === 0, 'and nothing is left waiting');

  while (q.pending) {
    q.pump(false, (o) => {
      seen.push(nameOf(o));
      return built(1);
    }, () => 0);
  }
  ok(seen.join(',') === 'tier1,tier2,loose1,loose2', 'the whole order is the batches and then the loose work');
  ok(q.built === 4, 'the queue counts what it built for the session');
}

{
  // Within the batches there are two ranks, and the difference is the whole of what the streamer
  // would otherwise do to everything else: it is the one producer that pushes without stopping, so
  // a peer walking up behind a town filling in must not queue behind every tier of it.
  const q = new ProgramQueue();
  const seen: string[] = [];
  void q.push([obj('tierA'), obj('tierB')], 'the placed-object streamer');
  void q.push([obj('peer')], 'something being made ready to be shown', true);
  q.add([obj('scan')], 'the quarter-second material scan');
  while (q.pending) {
    q.pump(false, (o) => {
      seen.push(nameOf(o));
      return built(1);
    }, () => 0);
  }
  ok(seen.join(',') === 'peer,tierA,tierB,scan', 'what must be shown now goes ahead of the scenery filling in, and both ahead of the loose work');
}

{
  // An urgent batch pushed while an ordinary one is part way through takes the very next turn,
  // rather than waiting for the tier at the head to finish.
  const q = new ProgramQueue();
  const seen: string[] = [];
  void q.push([obj('tier1'), obj('tier2'), obj('tier3')], 'the placed-object streamer');
  q.pump(false, (o) => {
    seen.push(nameOf(o));
    return built(1);
  }, () => 0);
  void q.push([obj('weapon')], 'something being made ready to be shown', true);
  q.pump(false, (o) => {
    seen.push(nameOf(o));
    return built(1);
  }, () => 0);
  ok(seen.join(',') === 'tier1,weapon', 'an urgent push is taken on the next frame, not after the tier it arrived behind');
  ok(q.waiting === 2, 'and the tier keeps its place for afterwards');
}

{
  // A batch is answered whichever rank it was pushed at, and `clear` answers both.
  const q = new ProgramQueue();
  let urgentDone = false;
  let plainDone = false;
  void q.push([obj('urgent')], 'something being made ready to be shown', true).then(() => {
    urgentDone = true;
  });
  void q.push([obj('plain')], 'the placed-object streamer').then(() => {
    plainDone = true;
  });
  ok(q.waiting === 2, 'both ranks count as holding something back');
  q.clear();
  await flush();
  ok(urgentDone && plainDone, 'a world unloading answers both ranks rather than leaving one waiting for ever');
  ok(q.pending === 0, 'and keeps nothing of either');
}

// --- a queue nothing is pumping ---------------------------------------------------------------

{
  // Only a frame empties the queue, so a caller that waits on `push` while no frame loop is
  // running waits for ever. That is not hypothetical: a character whose saved world is a space
  // zone is put back in a ship before the frame loop's own gate is opened. The queue's answer is
  // to say plainly that no frame has looked at it, so the caller can build the work itself.
  const q = new ProgramQueue();
  ok(q.since(1000) === Number.POSITIVE_INFINITY, 'a queue no frame has ever looked at says so');
  ok(q.idle(0), 'and counts as idle, whatever the clock says');
  ok(q.ticks === 0, 'with no frames on its books');
  q.tick(1000);
  ok(q.since(1000) === 0 && !q.idle(1000), 'a frame that has just looked at it is not idle');
  // The single-instant test is the backstop, never the waiter's: a frame that built one program for 1.6 s is
  // far past `idleMs` and still nothing like a stopped loop.
  ok(!q.idle(1000 + PACE_TUNE.idleMs + 1) && !q.idle(1000 + 1600), 'the single-instant test does not take a 1.6 s frame for a stopped loop');
  ok(!q.idle(1000 + PACE_TUNE.idleBackstopMs), 'nor one exactly at the backstop');
  ok(q.idle(1001 + PACE_TUNE.idleBackstopMs), 'past the backstop it is idle: nothing has looked for longer than any frame the game draws');
  ok(q.ticks === 1, 'and the frames are counted');
  ok(PACE_TUNE.idleBackstopMs > 1600 && PACE_TUNE.idleBackstopMs > PACE_TUNE.idleMs, 'the backstop is longer than the longest frame measured and than a waiter\'s span');
}

{
  // A waiter's own view (`QueueWatch`): the loop is stopped only once two of its polls spanning more than
  // `idleMs` saw no new frame. A frame that ran long ticks the queue again as it ends (the frame loop's tick
  // after its draw), so the poll after it sees a new count.
  const q = new ProgramQueue();
  q.tick(0);
  const w = new QueueWatch();
  ok(!w.stopped(q.ticks, 10), 'a first poll only takes note');
  ok(!w.stopped(q.ticks, 10 + PACE_TUNE.idleMs), 'two polls exactly idleMs apart with no frame between are not yet a stop');
  ok(w.stopped(q.ticks, 11 + PACE_TUNE.idleMs), 'past idleMs with no frame between, the loop is stopped');
  const w2 = new QueueWatch();
  ok(!w2.stopped(q.ticks, 10), 'a fresh waiter takes note');
  // The long frame: ticked at its start (the queue's pump) and again as it ends, 1.6 s later.
  q.tick(12);
  q.tick(1612);
  ok(!w2.stopped(q.ticks, 1615), 'a poll after a 1.6 s frame that ticked as it ended sees a new count, not a stop');
  ok(!w2.stopped(q.ticks, 1615 + PACE_TUNE.idleMs), 'and the span starts again from that poll');
  ok(w2.stopped(q.ticks, 1616 + PACE_TUNE.idleMs), 'which a loop that really stopped then runs out');
}

{
  // On a page on screen the browser can hold the frames back while its GPU process catches up, with the main thread
  // free and the waiters' timers running: on a cold Direct3D 11 arrival 486 ms with no frame, which the 250 ms span
  // read as a stopped loop and answered with a flush that blocked the page 3.9 s in a timer task. On screen both
  // tests take the long bound.
  const q = new ProgramQueue();
  q.tick(1000);
  const w = new QueueWatch();
  ok(!w.stopped(q.ticks, 1000, true), 'a waiter on a page on screen takes note');
  ok(!w.stopped(q.ticks, 1486, true) && !w.stopped(q.ticks, 1000 + PACE_TUNE.idleBackstopMs + 1, true), 'frames held back half a second, or past the hidden tab\'s backstop, are no stop on a page on screen');
  ok(w.stopped(q.ticks, 1001 + PACE_TUNE.idleShownMs, true), 'past idleShownMs even a page on screen has stopped, so no wait is ever left unanswered');
  const hidden = new QueueWatch();
  hidden.stopped(q.ticks, 1000);
  ok(hidden.stopped(q.ticks, 1001 + PACE_TUNE.idleMs), 'while a hidden tab, whose frames really stop, is answered after idleMs as before');
  ok(!q.idle(1486, true) && !q.idle(1000 + PACE_TUNE.idleBackstopMs + 1, true) && q.idle(1001 + PACE_TUNE.idleShownMs, true), 'and the single-instant test on screen takes the same long bound');
  ok(q.idle(1001 + PACE_TUNE.idleBackstopMs), 'where in a hidden tab it is the backstop');
  ok(new ProgramQueue().idle(0, true), 'a queue no frame has ever looked at is idle on screen too: a character put back in a ship before the frame loop opens is never kept waiting');
  ok(PACE_TUNE.idleShownMs === 10000 && PACE_TUNE.idleShownMs > PACE_TUNE.idleBackstopMs, 'the bound on screen is ours, ten seconds, longer than the hidden backstop');
  q.noteIdleBuilt(3);
  q.noteIdleBuilt(0);
  ok(q.flushedInPlay === 3, "and the entry test's own outright build on a page on screen is counted with the flushes");
}

{
  // The fault the rule removes, and a new queueOrBuild (whose entry is the single-instant test) still queuing on
  // such a frame: a fake compile that moves the clock 1,600 ms.
  const q = new ProgramQueue();
  let t = 0;
  q.tick(t);
  q.add([obj('slow')], 'something being made ready to be shown');
  q.pump(false, () => {
    t += 1600;
    return built(1);
  }, () => t);
  // The frame that built it ends with its tick after the draw.
  const beforeEndTick = t;
  ok(!q.idle(beforeEndTick + 1), 'right after a 1,600 ms compile, before the frame\'s closing tick, the backstop still does not call the loop stopped');
  q.tick(t);
  ok(!q.idle(t + 5), 'and with the closing tick a new queueOrBuild queues rather than building outright');
}

{
  // A waiter's flush in play takes only the jobs present when it began, and stops the moment frames look at the
  // queue again, handing the rest back to the pump. In a hidden tab (frames stopped, the rule working as meant) what
  // it builds is not the fault and is not counted.
  const q = new ProgramQueue();
  q.tick(0);
  q.add([obj('a'), obj('b'), obj('c')], 'look:jawa');
  const order: string[] = [];
  let pushed = false;
  await q.flush((o) => {
    order.push(nameOf(o));
    if (!pushed) {
      pushed = true;
      q.add([obj('late')], 'the quarter-second material scan');
    }
    return built(1);
  }, async () => undefined, { shown: () => false });
  ok(order.join(',') === 'a,b,c', 'a flush in play takes only the jobs present when it began, never one pushed after');
  ok(q.pending === 1, 'and leaves the late one for the pump');
  ok(q.flushedInPlay === 0, 'and in a tab not on screen, where frames really stop, nothing it built is the fault');
  ok(q.peopleBuilt === 3 && q.lastBuilt.length === 3 && q.lastBuilt[0] === 'look:jawa', 'what it built in play is counted for the people and keeps its label');
}

{
  // On a page on screen with no loading screen up, every program a waiter's flush builds is a timer task building
  // where frames ought to be ticking: counted, however few frames it then catches.
  const q = new ProgramQueue();
  q.tick(0);
  q.add([obj('a'), obj('b')], 'look:jawa');
  await q.flush(() => built(1), async () => undefined, { shown: () => true });
  ok(q.flushedInPlay === 2, `a flush on a page on screen is counted whole, the misjudgement itself (${q.flushedInPlay})`);
  q.add([obj('c')], 'the placed-object streamer');
  await q.flush(() => built(1), async () => undefined);
  ok(q.flushedInPlay === 2, "and a loading screen's own flush, which is no waiter's, never is");
}

{
  const q = new ProgramQueue();
  let t = 0;
  q.tick(0);
  q.add([obj('a'), obj('b'), obj('c')], 'the placed-object streamer');
  const order: string[] = [];
  await q.flush((o) => {
    order.push(nameOf(o));
    // A frame comes in while the flush is building: it ticks the queue.
    q.tick((t += 16));
    return built(1);
  }, async () => undefined, { shown: () => true });
  ok(order.join(',') === 'a', 'a flush in play stops the moment a frame looks at the queue again');
  ok(q.pending === 2, 'and hands the rest back to the pump');
  ok(q.flushedInPlay === 1, 'and the program it built on a page on screen is counted (the waiter misjudged)');
}

{
  // The labels of what was built in play are a ring of eight, newest first; a loading frame's builds are not kept.
  const q = new ProgramQueue();
  for (let i = 0; i < 10; i++) q.add([obj(`o${i}`)], `label${i}`);
  while (q.pending) q.pump(false, () => built(1), () => 0);
  ok(q.lastBuilt.length === 8 && q.lastBuilt[0] === 'label9' && q.lastBuilt[7] === 'label2', 'the last eight labels built in play, newest first');
  q.add([obj('screen')], 'look:behind');
  q.pump(true, () => built(1), () => 0);
  ok(q.lastBuilt[0] === 'label9' && q.peopleBuilt === 0, 'a build behind a loading screen is not play: no label kept and no person counted');
}

{
  // Day one: the queue as it stood at the pass's base (5f3cff4), loaded from git, calls the loop stopped on that
  // very 1,600 ms frame, which is the fault the new rule exists to remove, and its trace over a sweep of instants is
  // held to the hash written here. Where git cannot answer the half is said to be skipped and counts nothing.
  const old = await baseQueue();
  const trace: string[] = [];
  const sweep = (idle: (now: number) => boolean) => [0, 100, 250, 251, 1000, 1600, 2000, 2001, 5000].map((d) => (idle(1000 + d) ? '1' : '0')).join('');
  if (old) {
    const q = new old.ProgramQueue();
    q.tick(1000);
    ok(q.idle(1000 + 1600), 'day one: the old rule calls the loop stopped on the poll after a 1,600 ms frame (the timer-task flush, 37 of 170 programs in a Bestine session)');
    trace.push(sweep((n) => q.idle(n)));
    ok(fnv(trace.join('|')) === BASE_IDLE_TRACE, `day one: the old rule's trace is the one written down here (${fnv(trace.join('|'))})`);
  } else {
    // Nothing is compared here, so nothing is counted: a check that only finds a string written down would swell the
    // total and prove nothing about the old rule.
    console.log('note git could not hand over programQueue.ts at 5f3cff4: the day-one half is not run, and no check is counted for it');
  }
  const now = new ProgramQueue();
  now.tick(1000);
  ok(!now.idle(1000 + 1600), 'and today\'s does not');
  ok(sweep((n) => now.idle(n)) === '000000011', `today's single-instant test is idle only past the backstop (${sweep((n) => now.idle(n))})`);
}

{
  // A frame that found nothing to do must still count as a frame, or a queue that happened to be
  // empty would read as a frame loop that had stopped and every wait would be answered outright.
  const q = new ProgramQueue();
  q.pump(false, () => built(0), () => 5000);
  ok(!q.idle(5000) && q.ticks === 1, 'a pump with nothing on the queue is still a frame');
}

{
  // A job that turns out to be free (its material was built behind the loading screen) costs
  // nothing, so a queue of them drains as fast as the job cap allows rather than a frame each.
  const q = new ProgramQueue();
  q.add(Array.from({ length: 10 }, (_, i) => obj(`free${i}`)), 'the quarter-second material scan');
  const out = q.pump(false, () => built(0), () => 0);
  ok(out.made === 0 && out.jobs === 10, 'ten jobs that built nothing all ran on one frame');
  ok(q.pending === 0, 'and the queue is empty');
  ok(out.over === false, 'a frame that built nothing never warns');
}

{
  // The frame's own clock closes it even when nothing was built: a job can be slow without making
  // a program (three walks the material, uploads a texture).
  const q = new ProgramQueue();
  q.add(Array.from({ length: 5 }, (_, i) => obj(`slow${i}`)), 'the quarter-second material scan');
  let t = 0;
  const out = q.pump(false, () => built(0), () => (t += PACE_TUNE.playMs));
  ok(out.jobs === 1, 'one job that spent the whole frame is the whole frame');
  ok(q.pending === 4, 'the rest wait');
}

{
  // An object with more than one program in it (an actor is drawn in the world's pass and in a
  // room's) keeps its place at the head of the queue until every one is built, so the frame stops
  // between them rather than paying for all of them at once.
  const q = new ProgramQueue();
  q.add([obj('two-pass'), obj('after it')], 'the placed-object streamer');
  const turns: number[] = [];
  const twoPass = (o: THREE.Object3D, allowance: number): { made: number; done: boolean } => {
    turns.push(allowance);
    return nameOf(o) === 'two-pass' && turns.length === 1 ? { made: 1, done: false } : built(1);
  };
  const a = q.pump(false, twoPass, () => 0);
  ok(a.made === 1, 'the frame builds the first of an object’s programs and stops');
  ok(q.pending === 2, 'and the object is still at the head of the queue, unfinished');
  ok(turns[0] === SHADER_TUNE.playBudget, 'the turn was told how many programs the frame could still pay for');
  const b = q.pump(false, twoPass, () => 0);
  ok(b.made === 1, 'the next frame builds its second');
  ok(q.pending === 1, 'and only then moves on');
}

{
  // A job that says it has more to do and built nothing cannot make progress: it is let go rather
  // than offered for ever.
  const q = new ProgramQueue();
  q.add([obj('stuck')], 'the quarter-second material scan');
  q.pump(false, () => ({ made: 0, done: false }), () => 0);
  ok(q.pending === 0, 'a job that can never finish is let go rather than jamming the queue');
}

{
  // A turn that builds more than the frame allowed (one three's `compile` cannot be stopped inside)
  // is still charged, and the frame says so.
  const q = new ProgramQueue();
  q.add([obj('three-at-once')], 'the placed-object streamer');
  const out = q.pump(false, () => built(3), () => 0);
  ok(out.made === 3 && out.over, 'a turn that builds three programs overruns the frame');
  const line = q.line();
  ok(line.includes('the placed-object streamer'), 'and the line the console writes names it');
}

{
  // Work the queue could not do is not work it forgets: a compile that throws is warned about once
  // and the frame carries on, rather than the queue jamming on it for ever.
  const q = new ProgramQueue();
  q.add([obj('broken'), obj('fine')], 'the quarter-second material scan');
  const warn = console.warn;
  let warned = 0;
  console.warn = () => {
    warned++;
  };
  try {
    q.pump(false, (o) => {
      if (nameOf(o) === 'broken') throw new Error('no');
      return built(0);
    }, () => 0);
  } finally {
    console.warn = warn;
  }
  ok(warned === 1, 'a compile that throws is said once');
  ok(q.pending === 0, 'and the queue moves past it rather than jamming');
}

{
  // The result object is kept and filled in place: a steady frame allocates nothing.
  const q = new ProgramQueue();
  const a = q.pump(false, () => built(0), () => 0);
  const b = q.pump(false, () => built(0), () => 0);
  ok(a === b, 'the frame result is one object, filled again rather than made again');
}

// --- letting go: a sweep that will compile everything, and a world that is going -----------------

{
  const q = new ProgramQueue();
  let answered = false;
  void q.push([obj('tier')], 'the placed-object streamer').then(() => {
    answered = true;
  });
  q.add([obj('scan')], 'the quarter-second material scan');
  q.clearLoose();
  ok(q.pending === 1 && q.waiting === 1, 'a sweep drops the scan’s finds and keeps what is waiting to be shown');
  await flush();
  ok(!answered, 'and does not answer it early');
  q.clear();
  await flush();
  ok(answered, 'a world unloading answers whoever was waiting, rather than leaving them waiting for ever');
  ok(q.pending === 0, 'and keeps nothing');
}

// --- flushing behind a loading screen -------------------------------------------------------------

{
  const q = new ProgramQueue();
  const order: string[] = [];
  let answered = false;
  q.add([obj('scan')], 'the quarter-second material scan');
  void q.push([obj('tier')], 'the placed-object streamer').then(() => {
    answered = true;
  });
  let once = false;
  const allowances: number[] = [];
  await q.flush((o, allowance) => {
    order.push(nameOf(o));
    allowances.push(allowance);
    if (!once) {
      once = true;
      q.add([obj('late')], 'the quarter-second material scan');
    }
    return built(1);
  }, async () => undefined);
  ok(order.join(',') === 'tier,scan,late', 'a flush takes work pushed while it was running, in the same order');
  ok(allowances.every((n) => n === Number.POSITIVE_INFINITY), 'and keeps to no allowance: nothing is being looked at');
  ok(q.pending === 0, 'and leaves nothing behind');
  await flush();
  ok(answered, 'and answers the promises it passed');
  ok(q.built === 3, 'everything it built is on the session’s books');
}

{
  // A flush gives an unfinished object another turn at once rather than a frame later.
  const q = new ProgramQueue();
  q.add([obj('two-pass'), obj('after it')], 'the placed-object streamer');
  const order: string[] = [];
  let first = true;
  await q.flush((o) => {
    order.push(nameOf(o));
    if (first && nameOf(o) === 'two-pass') {
      first = false;
      return { made: 1, done: false };
    }
    return built(1);
  }, async () => undefined);
  ok(order.join(',') === 'two-pass,two-pass,after it', 'an unfinished object is taken up again straight away');
  ok(q.pending === 0, 'and the flush still empties the queue');
}

// --- counting the links finished elsewhere --------------------------------------------------------

{
  const q = new ProgramQueue();
  q.countLinks(5);
  q.countLinks(0);
  q.countLinks(-2);
  ok(q.linked === 5, 'links finished behind the loading screen are counted, and nothing silly is');
}

// --- the materials under a root -------------------------------------------------------------------

{
  const matA = { name: 'a' } as unknown as THREE.Material;
  const matB = { name: 'b' } as unknown as THREE.Material;
  const mesh = { isMesh: true, material: matA };
  const multi = { isMesh: true, material: [matA, matB] };
  const bare = { isMesh: true, material: null };
  const sprite = { isSprite: true, material: matB };
  const plain = { name: 'a group with nothing to draw' };
  const root = {
    traverse(cb: (o: unknown) => void) {
      cb(plain);
      cb(mesh);
      cb(multi);
      cb(bare);
      cb(sprite);
    },
  } as unknown as THREE.Object3D;
  const out = materialsUnder(root, new Set<THREE.Material>());
  ok(out.size === 2, 'every material under a root is found once, however many meshes wear it');
  ok(out.has(matA) && out.has(matB), 'and a mesh with a list of them gives up all of them');
  const again = materialsUnder(root, out);
  ok(again === out && again.size === 2, 'the set is the caller’s and is added to, not cleared');
}

// --- finishing a link -------------------------------------------------------------------------------

{
  let asked = 0;
  const program = {
    getUniforms: () => {
      asked++;
    },
  };
  const material = { name: 'one' } as unknown as THREE.Material;
  const record = { programs: new Map([['key', program]]) };
  const renderer = { properties: { has: () => true, get: () => record } } as unknown as THREE.WebGLRenderer;

  ok(resolveLinks(renderer, [material]) === 1, 'a program that has not been finished is finished');
  ok(asked === 1, 'by asking it the very question the first draw asks');
  ok(resolveLinks(renderer, [material]) === 0, 'and never asked twice');
  ok(asked === 1, 'so a second pass over the same scene costs nothing at all');
}

{
  // A program the driver will not answer for is counted as finished rather than asked every frame.
  const program = {
    getUniforms: () => {
      throw new Error('this program will not link');
    },
  };
  const material = { name: 'broken' } as unknown as THREE.Material;
  const record = { currentProgram: program };
  const renderer = { properties: { has: () => true, get: () => record } } as unknown as THREE.WebGLRenderer;
  ok(resolveLinks(renderer, [material]) === 1, 'a program that throws is counted as finished');
  ok(resolveLinks(renderer, [material]) === 0, 'and is not asked again every frame');
}

{
  const material = { name: 'never compiled' } as unknown as THREE.Material;
  const none = { properties: { has: () => false, get: () => undefined } } as unknown as THREE.WebGLRenderer;
  ok(resolveLinks(none, [material]) === 0, 'a material with no program yet is stepped over');
  ok(resolveLinks(null, [material]) === 0, 'and with no renderer there is nothing to finish');
  ok(resolveLinks({} as unknown as THREE.WebGLRenderer, [material]) === 0, 'a renderer with no properties store is stepped over too');
}

{
  // An object its flight saw ready finishes only what reports its link done (the performance pass's second wave): a
  // shared material can hold a program another job issued since (a second person of one look whose first person's
  // rooms pass is in flight), and finished here that link was waited for on the main thread by an object that never
  // needed it.
  const asked: string[] = [];
  const program = (name: string, done: boolean) => ({ isReady: () => done, getUniforms: () => void asked.push(name) });
  const world = program('world pass', true);
  const rooms = program('rooms pass, another job', false);
  const record = { programs: new Map<string, unknown>([['w', world], ['r', rooms]]) };
  const material = { name: 'shared' } as unknown as THREE.Material;
  const renderer = { properties: { has: () => true, get: () => record } } as unknown as THREE.WebGLRenderer;
  ok(resolveLinks(renderer, [material], true) === 1 && asked.join() === 'world pass', 'seen ready, only the program that reports its link done is finished');
  ok(resolveLinks(renderer, [material]) === 1 && asked.join() === 'world pass,rooms pass, another job', 'and the one still linking is left for its own flight, which finishes it (here, outright)');
  const plain = { getUniforms: () => void asked.push('no question') };
  const r2 = { properties: { has: () => true, get: () => ({ currentProgram: plain }) } } as unknown as THREE.WebGLRenderer;
  ok(resolveLinks(r2, [material], true) === 1 && asked.includes('no question'), 'a program that cannot be asked (no parallel compile) is finished as ever');
}

{
  // The queue hands the flag on: an entry its flight saw ready is resolved with `onlyReady`; one the bound or a hiding
  // tab finished is resolved whole.
  const q = new ProgramQueue();
  q.flight.say = () => undefined;
  const flags: string[] = [];
  let hidden = false;
  const progs = new Map<THREE.Object3D, { isReady(): boolean; getUniforms(): unknown }>();
  q.links = {
    parallel: () => !hidden,
    hidden: () => hidden,
    pending: (o) => {
      const p = progs.get(o);
      return p ? [p] : [];
    },
    resolve: (o, onlyReady) => {
      flags.push(`${nameOf(o)} ${onlyReady ? 'ready-only' : 'whole'}`);
      progs.delete(o);
      return 1;
    },
  };
  const compile = (o: THREE.Object3D) => {
    progs.set(o, { isReady: () => nameOf(o) === 'fast', getUniforms: () => undefined });
    return built(1);
  };
  q.add([obj('fast')], 'scan');
  q.add([obj('slow')], 'scan');
  for (let i = 0; i < 4; i++) q.pump(false, compile, () => 0);
  ok(flags.includes('fast ready-only') && !flags.some((f) => f.startsWith('slow')), `an entry seen ready is resolved ready-only, and one still linking waits (${flags.join(', ')})`);
  hidden = true;
  q.pump(false, compile, () => 0);
  ok(flags.includes('slow whole'), `one a hiding tab finished is resolved whole (${flags.join(', ')})`);
}

// --- a job carrying its own compile and finish (the performance pass's second wave) ----------------

{
  // Compiled by its own compile, never by the queue's callback, in a pump and in a flush; finished once, after.
  const q = new ProgramQueue();
  const log: string[] = [];
  const own: OwnJob = {
    compile: (o, _allowance, resolve) => {
      log.push(`own ${nameOf(o)} ${resolve ? 'resolve' : 'issue'}`);
      return built(1);
    },
    finish: (o) => {
      log.push(`finish ${nameOf(o)}`);
    },
  };
  const queueCompile = (o: THREE.Object3D) => {
    log.push(`queue ${nameOf(o)}`);
    return built(1);
  };
  q.add([obj('v1')], 'fx.velocity', own);
  void q.push([obj('v2')], 'fx.velocity for a body', true, own);
  q.add([obj('plain')], 'scan');
  while (q.pending) q.pump(false, queueCompile, () => 0);
  ok(log.join(',') === 'own v2 resolve,finish v2,own v1 resolve,finish v1,queue plain', `a job with its own compile is compiled by it, resolved as it compiles in blocking mode, and finished once after (${log.join(',')})`);
  log.length = 0;
  q.add([obj('f1')], 'fx.velocity', own);
  await q.flush(queueCompile, async () => undefined);
  ok(log.join(',') === 'own f1 resolve,finish f1', `and the same in a flush (${log.join(',')})`);
}

{
  // In parallel mode: issued by its own compile with no resolve, finished only once its programs are resolved; and an
  // urgent batch answered only when every object's programs are, with loose work never issued ahead of it.
  const q = new ProgramQueue();
  const ready = new Map<THREE.Object3D, { polls: number; resolved: boolean; isReady(): boolean; getUniforms(): unknown }>();
  const log: string[] = [];
  const make = (o: THREE.Object3D) => {
    const p = { polls: 0, resolved: false, isReady: () => ++p.polls > 1, getUniforms: () => undefined };
    ready.set(o, p);
  };
  const links: QueueLinks = {
    parallel: () => true,
    hidden: () => false,
    pending: (o) => {
      const p = ready.get(o);
      return p && !p.resolved ? [p] : [];
    },
    resolve: (o) => {
      const p = ready.get(o);
      if (!p || p.resolved) return 0;
      p.resolved = true;
      log.push(`resolve ${nameOf(o)}`);
      return 1;
    },
  };
  q.links = links;
  q.flight.say = () => undefined;
  const own: OwnJob = {
    compile: (o, _allowance, resolve) => {
      log.push(`own ${nameOf(o)} ${resolve ? 'resolve' : 'issue'}`);
      make(o);
      return built(1);
    },
    finish: (o) => {
      log.push(`finish ${nameOf(o)}`);
    },
  };
  let answered = false;
  void q.push([obj('a'), obj('b')], 'urgent', true, own).then(() => {
    answered = true;
  });
  q.add([obj('loose')], 'scan', own);
  q.pump(false, () => built(1), () => 0);
  await flush();
  ok(!answered && !log.some((l) => l.startsWith('finish')), 'issued, nothing finished and the batch not answered on the frame it went out');
  for (let i = 0; i < 6; i++) q.pump(false, () => built(1), () => 0);
  await flush();
  const order = log.join(',');
  ok(log.indexOf('own a issue') < log.indexOf('own loose issue') && log.indexOf('own b issue') < log.indexOf('own loose issue'), `the loose work is issued only after every urgent object (${order})`);
  ok(log.indexOf('resolve a') < log.indexOf('finish a') && log.indexOf('resolve b') < log.indexOf('finish b'), 'each own job is finished after its resolve, never before');
  ok(log.filter((l) => l === 'finish a').length === 1 && log.filter((l) => l === 'finish loose').length === 1, 'and once');
  ok(answered, 'the urgent batch is answered once both its objects are resolved');
}

{
  // An own job let go unbuilt (a world clearing the queue) says so, so its owner can ask for it again.
  const q = new ProgramQueue();
  const dropped: string[] = [];
  const own: OwnJob = { compile: () => built(1), dropped: (o) => dropped.push(nameOf(o)) };
  q.add([obj('d1')], 'fx.velocity', own);
  void q.push([obj('d2')], 'fx.velocity for a body', true, own);
  q.clear();
  ok(dropped.sort().join(',') === 'd1,d2', `every object of an own job let go unbuilt is told to its owner (${dropped.join(',')})`);
  q.add([obj('d3')], 'fx.velocity', own);
  q.clearLoose();
  ok(dropped.includes('d3'), 'and so is loose work a sweep drops');
}

{
  // A batch pushed below the urgent rank is made urgent by its own (the room deferral's promote): pushed after the
  // scenery, so only the promote can put it first, and the same two without the promote are taken in their order.
  const run = (promote: boolean): { seen: string[]; moved: boolean; again: boolean } => {
    const q = new ProgramQueue();
    const seen: string[] = [];
    const own: OwnJob = { compile: (o) => (seen.push(nameOf(o)), built(1)) };
    void q.push([obj('tier')], 'the placed-object streamer');
    void q.push([obj('rooms')], 'its rooms', false, own);
    const moved = promote ? q.promote(own) : false;
    for (let i = 0; i < 4; i++) q.pump(false, (o) => (seen.push(nameOf(o)), built(1)), () => 0);
    return { seen, moved, again: q.promote(own) };
  };
  const promoted = run(true);
  const left = run(false);
  ok(promoted.moved, 'a batch carrying an own job is found and moved');
  ok(promoted.seen.join() === 'rooms,tier', `and goes ahead of the scenery that was pushed before it (${promoted.seen.join()})`);
  ok(left.seen.join() === 'tier,rooms', `where without the promote the scenery pushed first is taken first, so the check above can fail (${left.seen.join()})`);
  ok(!promoted.again, 'and once moved it is not found below the urgent rank again');
}

console.log(`\n${passed} checks passed`);
