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
import type * as THREE from 'three';
import { PACE_TUNE, PaceBudget, framesFor, paceLine, tuneProgramPace } from '../../../src/core/programPace.ts';
import { ProgramQueue, materialsUnder, resolveLinks } from '../../../src/core/programQueue.ts';
import { SHADER_TUNE } from '../../../src/core/shaderWatch.ts';

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
  ok(!q.idle(1000 + PACE_TUNE.idleMs), 'nor is one exactly at the limit');
  ok(q.idle(1001 + PACE_TUNE.idleMs), 'past the limit it is idle again');
  ok(q.ticks === 1, 'and the frames are counted');
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

console.log(`\n${passed} checks passed`);
