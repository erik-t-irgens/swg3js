// Programs built off the frame (src/core/linkMode.ts and the queue's `parallel` mode in src/core/programQueue.ts),
// checked without a browser over fake programs whose `isReady` turns true after a number of polls: no program is ever
// asked for its uniforms before it reports ready, and never on the frame that issued it; a program never ready is
// finished the old way at the bound and said once; the caps on what is in flight and what one frame issues hold; a
// hidden tab and a context with no extension are `blocking`; the boot check's rule, and that a check which finds the tab
// hidden waits it out and decides on a fresh window once it shows; a tab that hides with programs in flight has every
// one resolved at the next pump, none waiting the bound; a program three destroyed in flight is struck off, never
// waited out or blamed on the driver. And the link-wait watch: a fake context whose first link-status question moves
// the clock 300 ms is summed into that frame's wait whoever asked (the queue or a stand-in for three's first draw), a
// completion poll is never timed, every wrapped call hands the driver both its arguments and answers what it answered,
// and a frame with no program work sums nought and (run with node --expose-gc) allocates nothing.
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import type * as THREE from 'three';
import { BOUND_SAID, COMPLETION_STATUS_KHR, LINK_STATE, LINK_TUNE, LinkCheck, LinkFlight, LinkWaits, WATCHED_CALLS, linkCheckVerdict, linkMode, linkWhy, programGone, tuneLinks, watchLinkWaits, type ReadyProgram } from '../../../src/core/linkMode.ts';
import { ProgramQueue, type QueueLinks } from '../../../src/core/programQueue.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A fake program: ready after `after` polls (never with -1), and how often it was asked for its uniforms and when. */
class FakeProgram implements ReadyProgram {
  polls = 0;
  asked = 0;
  askedOnFrame = -1;
  resolved = false;
  after: number;
  constructor(after: number) {
    this.after = after;
  }
  isReady(): boolean {
    this.polls++;
    return this.after >= 0 && this.polls > this.after;
  }
  getUniforms(): unknown {
    this.asked++;
    this.askedOnFrame = frameNo;
    return {};
  }
}

let frameNo = 0;
let clock = 0;
let hidden = false;
let mode: 'parallel' | 'blocking' = 'parallel';
const programs = new Map<object, FakeProgram[]>();
const issuedOnFrame = new Map<FakeProgram, number>();
const obj = (name: string): THREE.Object3D => ({ name }) as unknown as THREE.Object3D;
const scratch: ReadyProgram[] = [];
const links: QueueLinks = {
  parallel: () => mode === 'parallel',
  hidden: () => hidden,
  pending: (o) => {
    scratch.length = 0;
    for (const p of programs.get(o) ?? []) if (!p.resolved) scratch.push(p);
    return scratch;
  },
  resolve: (o) => {
    let n = 0;
    for (const p of programs.get(o) ?? []) {
      if (p.resolved) continue;
      p.resolved = true;
      p.getUniforms();
      n++;
    }
    return n;
  },
};

/** A compile that makes `count` programs for an object the first time, each ready after `after` polls. */
function compileWith(count: number, after: number, resolves: boolean[] = []) {
  return (o: THREE.Object3D, _allowance: number, resolve: boolean): { made: number; done: boolean } => {
    resolves.push(resolve);
    if (programs.has(o)) return { made: 0, done: true };
    const list: FakeProgram[] = [];
    for (let i = 0; i < count; i++) {
      const p = new FakeProgram(after);
      issuedOnFrame.set(p, frameNo);
      list.push(p);
    }
    programs.set(o, list);
    // The old way resolves as it compiles.
    if (resolve) links.resolve(o);
    return { made: count, done: true };
  };
}

function freshQueue(): ProgramQueue {
  const q = new ProgramQueue();
  q.links = links;
  q.flight.say = () => undefined;
  return q;
}

const flushMicro = (): Promise<void> => Promise.resolve().then(() => undefined);

// ---- 1. Issued, polled, resolved only once ready, never on the frame that issued. ----
{
  mode = 'parallel';
  hidden = false;
  const q = freshQueue();
  const a = obj('a');
  const resolves: boolean[] = [];
  const compile = compileWith(2, 0, resolves);
  let answered = false;
  void q.push([a], 'look:test', true).then(() => {
    answered = true;
  });
  frameNo = 1;
  q.pump(false, compile, () => clock);
  const [p0, p1] = programs.get(a)!;
  ok(resolves.length === 1 && resolves[0] === false, 'in parallel mode the job is compiled with no resolve (issued)');
  ok(p0.asked === 0 && p1.asked === 0, 'no program is asked for its uniforms on the frame that issued it, even one ready at once');
  ok(q.flight.programsInFlight === 2 && q.waiting === 1, 'its two programs are in flight and the batch still waits');
  await flushMicro();
  ok(!answered, 'and the promise is not answered');
  frameNo = 2;
  q.pump(false, compile, () => clock);
  await flushMicro();
  ok(p0.asked === 1 && p1.asked === 1 && p0.askedOnFrame === 2, 'the next frame polls them ready and resolves each once');
  ok(answered && q.pending === 0, 'and only then is the batch answered');
  ok(q.flight.resolved === 1 && q.flight.issued === 2, 'the flight counts what it issued and resolved');
}

// ---- 2. A program slow to link: polled frame after frame, never asked before it is ready. ----
{
  const q = freshQueue();
  const a = obj('slow');
  const compile = compileWith(1, 4);
  void q.push([a], 'slow', true);
  for (frameNo = 10; frameNo < 14; frameNo++) q.pump(false, compile, () => clock);
  const p = programs.get(a)![0];
  ok(p.polls >= 3 && p.asked === 0, `polled every frame and not asked while not ready (${p.polls} polls)`);
  for (; frameNo < 20; frameNo++) q.pump(false, compile, () => clock);
  ok(p.asked === 1 && p.askedOnFrame > issuedOnFrame.get(p)!, 'asked once, the frame it reported ready, after the frame it was issued on');
}

// ---- 3. The bound: a program never ready is finished the old way, and said once. ----
{
  BOUND_SAID.said = false;
  const said: string[] = [];
  const q = freshQueue();
  q.flight.say = (line) => said.push(line);
  const a = obj('never');
  const b = obj('never too');
  const compile = compileWith(1, -1);
  void q.push([a, b], 'never', true);
  clock = 0;
  frameNo = 30;
  q.pump(false, compile, () => clock);
  clock = LINK_TUNE.boundMs - 1;
  q.pump(false, compile, () => clock);
  ok(programs.get(a)![0].asked === 0, 'not resolved before the bound');
  clock = LINK_TUNE.boundMs + 1;
  q.pump(false, compile, () => clock);
  ok(programs.get(a)![0].asked === 1 && programs.get(b)![0].asked === 1, 'past the bound each is finished the old way (asked, which waits)');
  ok(q.flight.bound === 2 && said.length === 1, `and said once for the session, however many met it (${said.length})`);
  ok(q.pending === 0, 'and nothing is left waiting');
  clock = 0;
}

// ---- 4. The caps: what one play frame issues, and what is in flight at once. ----
{
  const q = freshQueue();
  const objs = Array.from({ length: 20 }, (_, i) => obj(`o${i}`));
  const compile = compileWith(1, -1);
  void q.push(objs, 'many', true);
  frameNo = 40;
  const r1 = q.pump(false, compile, () => clock);
  ok(r1.made === LINK_TUNE.issuePerFrame && q.flight.programsInFlight === LINK_TUNE.issuePerFrame, `one play frame issues issuePerFrame programs (${r1.made})`);
  ok(r1.over === false, 'and that is no overrun in parallel mode');
  for (let i = 0; i < 10; i++) q.pump(false, compile, () => clock);
  ok(q.flight.programsInFlight === LINK_TUNE.inFlight, `no more than inFlight are in flight at once (${q.flight.programsInFlight})`);
  // Behind a screen the cap is the sweep's.
  q.pump(true, compile, () => clock);
  q.pump(true, compile, () => clock);
  ok(q.flight.programsInFlight <= LINK_TUNE.sweepInFlight && q.flight.programsInFlight > LINK_TUNE.inFlight, `behind a screen up to sweepInFlight (${q.flight.programsInFlight})`);
  q.clear();
}

// ---- 5. Loose work never goes ahead of an urgent batch. ----
{
  const q = freshQueue();
  const order: string[] = [];
  const base = compileWith(1, -1);
  const compile = (o: THREE.Object3D, allowance: number, resolve: boolean): { made: number; done: boolean } => {
    order.push((o as unknown as { name: string }).name);
    return base(o, allowance, resolve);
  };
  q.add([obj('loose')], 'scan');
  void q.push([obj('u1'), obj('u2'), obj('u3')], 'urgent', true);
  frameNo = 50;
  q.pump(false, compile, () => clock);
  q.pump(false, compile, () => clock);
  ok(order.slice(0, 3).join(',') === 'u1,u2,u3' && order.indexOf('loose') > 2, `every urgent object is issued before the loose work (${order.join(',')})`);
  q.clear();
}

// ---- 6. A tab that hides with programs in flight: every one resolved at the next pump, none waiting the bound. ----
{
  const q = freshQueue();
  const objs = [obj('h1'), obj('h2'), obj('h3')];
  const compile = compileWith(1, -1);
  let answered = false;
  void q.push(objs, 'hide', true).then(() => {
    answered = true;
  });
  frameNo = 60;
  clock = 0;
  for (let i = 0; i < 3; i++) q.pump(false, compile, () => clock);
  ok(q.flight.objects >= 2, 'programs are in flight');
  hidden = true;
  ok(linkMode(true) === 'blocking' && linkWhy(true) === 'blocking: hidden', 'a hidden tab is blocking whatever the check said');
  clock = 10;
  q.pump(false, compile, () => clock);
  await flushMicro();
  ok(q.flight.objects === 0 && q.flight.hiddenResolved >= 2, `every program in flight was resolved at the next pump (${q.flight.hiddenResolved}), long before the bound`);
  ok(objs.every((o) => programs.get(o)![0].asked === 1), 'each asked once');
  ok(answered, 'and the batch is answered');
  hidden = false;
}

// ---- 7. The flush in parallel mode issues, polls between breaths and resolves as each is ready. ----
{
  const q = freshQueue();
  const objs = Array.from({ length: 5 }, (_, i) => obj(`f${i}`));
  const compile = compileWith(1, 2);
  let answered = false;
  void q.push(objs, 'flush', true).then(() => {
    answered = true;
  });
  let breaths = 0;
  await q.flush(compile, async () => {
    breaths++;
  }, undefined, () => clock);
  ok(answered && q.pending === 0, `a flush behind a screen leaves nothing behind (${breaths} breaths)`);
  ok(objs.every((o) => programs.get(o)![0].asked === 1 && programs.get(o)![0].polls > 2), 'and asked every program only once it had reported ready');
}

// ---- 8. Blocking mode is the old way. ----
{
  mode = 'blocking';
  const q = freshQueue();
  const resolves: boolean[] = [];
  const compile = compileWith(1, -1, resolves);
  void q.push([obj('b1')], 'old', true);
  q.pump(false, compile, () => clock);
  ok(resolves[0] === true && q.flight.objects === 0 && q.pending === 0, 'in blocking mode a job is compiled and resolved at once, nothing put in flight');
  mode = 'parallel';
}

// ---- 9. The mode, and the boot check's rule. ----
{
  const v = (f: Partial<Parameters<typeof linkCheckVerdict>[0]>) => linkCheckVerdict({ extension: true, hidden: false, readyInTime: true, worstPollMs: 0.01, ...f });
  ok(v({}).mode === 'parallel', 'ready in time with no poll that waited: parallel');
  ok(v({ extension: false }).why === 'blocking: no extension', 'no extension: blocking');
  ok(v({ hidden: true }).why === 'blocking: hidden', 'hidden while checked: blocking');
  ok(v({ readyInTime: false }).why === 'blocking: the check never answered', 'never ready within checkMs: blocking');
  ok(v({ worstPollMs: LINK_TUNE.pollMaxMs + 0.5 }).why === 'blocking: a poll waited', 'a poll that took longer than pollMaxMs: blocking');
  // The check as polled.
  const check = new LinkCheck();
  const p = new FakeProgram(3);
  let t = 0;
  check.start(p, true, 0);
  ok(!check.poll(16, false, () => t), 'the check goes on while its program is not ready');
  check.poll(32, false, () => t);
  check.poll(48, false, () => t);
  ok(check.poll(64, false, () => t) && LINK_STATE.checked === 'parallel', 'and answers parallel once it reports ready in time');
  ok(p.asked === 1, 'its program is resolved once it has answered');
  const slow = new LinkCheck();
  slow.start(new FakeProgram(-1), true, 0);
  ok(!slow.poll(LINK_TUNE.checkMs - 1, false, () => t) && slow.poll(LINK_TUNE.checkMs, false, () => t) && LINK_STATE.checked === 'blocking', 'a program never ready within checkMs leaves the machine blocking');
  const waits = new LinkCheck();
  let clockT = 0;
  const waiting = new FakeProgram(-1);
  waiting.isReady = () => {
    clockT += 5;
    return false;
  };
  waits.start(waiting, true, 0);
  ok(waits.poll(16, false, () => clockT) && LINK_STATE.why === 'blocking: a poll waited', 'a poll that itself waits decides blocking at once');
  const none = new LinkCheck();
  none.start(new FakeProgram(0), false, 0);
  ok(none.done && LINK_STATE.why === 'blocking: no extension', 'no extension decides blocking without polling');
  LINK_STATE.forced = 'parallel';
  ok(linkMode(false) === 'parallel' && linkWhy(false) === 'parallel: asked for', 'the console can force a mode for comparing');
  LINK_STATE.forced = null;
  ok(linkMode(false) === LINK_STATE.checked, 'and give the check\'s back');
  ok(tuneLinks({ inFlight: 0 })[0].includes('held'), 'a tune past its range is held to it and said');
  ok(LINK_TUNE.inFlight === 1, 'and held');
  tuneLinks({ inFlight: 8 });
  ok(tuneLinks({ nonsense: 3 } as never)[0].includes('no number'), 'a name the table does not hold is refused');

  // A check that finds the tab hidden decides nothing: decided on that, a page that entered play hidden (a reload
  // after the physics broke) was `blocking` for its whole session and said "hidden" with the tab in plain view.
  LINK_STATE.checked = 'blocking';
  LINK_STATE.why = 'blocking: not checked yet';
  LINK_STATE.decided = false;
  const hid = new LinkCheck();
  const hp = new FakeProgram(2);
  hid.start(hp, true, 0);
  ok(!hid.poll(16, true, () => t) && !hid.poll(LINK_TUNE.checkMs * 3, true, () => t), 'polled with the tab hidden, however long, the check does not answer');
  ok(hid.facts().paused && !LINK_STATE.decided && hp.polls === 0, 'it decides nothing and asks its program nothing (a hidden tab never reports a program linked)');
  ok(linkMode(true) === 'blocking' && linkWhy(true) === 'blocking: hidden', 'while the mode is blocking for as long as the tab is hidden, whatever the check');
  const shown = LINK_TUNE.checkMs * 3 + 16;
  ok(!hid.poll(shown, false, () => t) && !hid.facts().paused, 'shown again, it polls the very program it compiled, with a fresh window from that frame (no time counted while hidden)');
  hid.poll(shown + 16, false, () => t);
  ok(hid.poll(shown + 32, false, () => t) && LINK_STATE.decided && LINK_STATE.checked === 'parallel' && LINK_STATE.why === 'parallel', 'and decides parallel once it reports ready in time, never "hidden"');
  ok(hid.facts().hidden && linkWhy(false) === 'parallel', 'the facts still say the tab was hidden during the check, and the console says what is so');
  const hidSlow = new LinkCheck();
  hidSlow.start(new FakeProgram(-1), true, 0);
  hidSlow.poll(5, false, () => t);
  hidSlow.poll(10, true, () => t);
  ok(!hidSlow.poll(5000, false, () => t) && !hidSlow.poll(5000 + LINK_TUNE.checkMs - 1, false, () => t), 'hidden part way, the window starts again when it shows');
  ok(hidSlow.poll(5000 + LINK_TUNE.checkMs, false, () => t) && LINK_STATE.why === 'blocking: the check never answered', 'and a program that never answers in a shown window is still blocking, on the check\'s own words');
}

// ---- 10. The link-wait watch. ----
{
  let t = 0;
  let firstLink = true;
  const LINK_STATUS = 0x8b82;
  const gl = {
    getProgramParameter(_p: unknown, name: unknown): unknown {
      if (name === COMPLETION_STATUS_KHR) {
        t += 50;
        return true;
      }
      if (name === LINK_STATUS && firstLink) {
        firstLink = false;
        t += 300;
      }
      return true;
    },
    getProgramInfoLog: () => '',
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    getActiveUniform: () => null,
    getActiveAttrib: () => null,
  };
  const waits = new LinkWaits();
  ok(watchLinkWaits(gl, () => t, waits), 'the watch wraps a context once');
  ok(!watchLinkWaits(gl, () => t, waits), 'and never twice');
  // A stand-in for three's own first draw of a program nobody resolved: it asks the link status.
  gl.getProgramParameter({}, LINK_STATUS);
  ok(waits.frameMs === 300, `a first link question that waits 300 ms is summed into the frame's wait (${waits.frameMs})`);
  gl.getProgramParameter({}, COMPLETION_STATUS_KHR);
  ok(waits.frameMs === 300, 'a completion poll is never timed, however long it takes');
  ok(waits.endFrame(true) === 300 && waits.framesOverPlay === 1 && waits.worstPlayMs === 300, 'the frame ends counted past waitFrameMs, a frame of play');
  ok(waits.endFrame(true) === 0 && waits.framesOverPlay === 1, 'a frame with no program work sums nought');
  // The queue's own resolve asks the same question three's first use does (the link status, then its uniforms).
  const q = freshQueue();
  const a = obj('watched');
  programs.set(a, [new FakeProgram(0)]);
  q.links = {
    ...links,
    resolve: (o) => {
      gl.getProgramParameter({}, LINK_STATUS);
      return links.resolve(o);
    },
  };
  firstLink = true;
  void q.push([a], 'w', true);
  q.pump(false, () => ({ made: 1, done: true }), () => t);
  ok(waits.frameMs === 0, 'the frame that issued it waited nothing');
  waits.endFrame(true);
  q.pump(false, () => ({ made: 0, done: true }), () => t);
  ok(waits.frameMs === 300, "and the frame whose resolve waited is summed the same, the queue's resolve counted as three's own first draw is");
  waits.endFrame(false);
  ok(waits.framesOverPlay === 1 && waits.framesOver === 2, 'a frame that is not play counts in every frame\'s tally alone');
  waits.forget();
  ok(waits.framesOver === 0 && waits.worstMs === 0, 'and the tallies can be counted from nought');

  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    for (let i = 0; i < 20000; i++) waits.endFrame(true);
    let gcs = 0;
    const obs = new PerformanceObserver((list) => {
      gcs += list.getEntries().length;
    });
    obs.observe({ entryTypes: ['gc'] });
    const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    let perFrame = Infinity;
    for (let attempt = 0; attempt < 4; attempt++) {
      gc();
      await new Promise((r) => setTimeout(r, 20));
      gcs = 0;
      const before = young();
      for (let i = 0; i < 20000; i++) waits.endFrame(true);
      const after = young();
      await new Promise((r) => setTimeout(r, 20));
      perFrame = (after - before) / 20000;
      if (gcs === 0) break;
    }
    obs.disconnect();
    ok(perFrame < 1, `a frame of the watch with no program work allocates nothing (${perFrame.toFixed(3)} bytes a frame)`);
  } else console.log('skip the watch allocates nothing: run with node --expose-gc to measure');
}

// ---- 10b. The watch hands every call both its arguments and the driver's own answer. ----
// It replaces these methods on the game's live context: a wrapper that dropped an argument or answered for itself
// would break every program's uniforms (three reads its uniform count through `getProgramParameter`), so each is
// called through the wrapper and straight, with answers that depend on what they were handed.
{
  const seen: { name: string; self: unknown; a: unknown; b: unknown }[] = [];
  const raw: Record<string, (this: unknown, a: unknown, b: unknown) => unknown> = {};
  for (const name of WATCHED_CALLS) {
    raw[name] = function (this: unknown, a: unknown, b: unknown): unknown {
      seen.push({ name, self: this, a, b });
      return { name, a, b };
    };
  }
  const gl2 = { ...raw } as Record<string, (a: unknown, b: unknown) => unknown>;
  const waits2 = new LinkWaits();
  ok(watchLinkWaits(gl2, () => 0, waits2), 'the watch wraps a second context of its own');
  const prog = { program: 'a program' };
  let all = true;
  for (const name of WATCHED_CALLS) {
    seen.length = 0;
    const second = name === 'getProgramParameter' ? 0x8b86 : `u_${name}`;
    const wrapped = gl2[name](prog, second) as { name: string; a: unknown; b: unknown };
    const straight = raw[name].call(gl2, prog, second) as { name: string; a: unknown; b: unknown };
    const call = seen[0];
    const same = gl2[name] !== raw[name] && wrapped.name === straight.name && wrapped.a === straight.a && wrapped.b === straight.b && wrapped.a === prog && wrapped.b === second;
    const handed = !!call && call.name === name && call.self === gl2 && call.a === prog && call.b === second;
    if (!same || !handed) all = false;
    ok(same && handed, `${name} is wrapped, hands the driver both its arguments and the context, and answers what the driver answered`);
  }
  ok(all && waits2.calls === WATCHED_CALLS.length, 'every watched call was timed once');
  seen.length = 0;
  const poll = gl2.getProgramParameter(prog, COMPLETION_STATUS_KHR) as { a: unknown; b: unknown };
  ok(poll.a === prog && poll.b === COMPLETION_STATUS_KHR && seen[0]?.b === COMPLETION_STATUS_KHR && waits2.calls === WATCHED_CALLS.length, "a completion poll passes straight through with the driver's own answer, untimed");
}

// ---- 11. The flight on its own: kept entries, reused. ----
{
  const f = new LinkFlight();
  f.say = () => undefined;
  const p = new FakeProgram(0);
  const e1 = f.issue({}, [p], 0, 'tag');
  ok(!f.ready(e1.object!) && f.objects === 1, 'an issued object is in flight');
  const n = f.poll(1, false);
  ok(n === 1 && f.finished[0] === e1 && e1.how === 'ready', 'polled ready, it finishes');
  f.release();
  const e2 = f.issue({}, [new FakeProgram(0)], 2);
  ok(e2 === e1, 'a finished entry is reused for the next object');
}

// ---- 12. A program three destroyed in flight (its material disposed) is struck off, never waited out. ----
// Three's `destroy` deletes the program and sets its handle to undefined, after which `isReady` asks the driver about
// a deleted program and answers null for ever: polled as not ready, the entry waited the 5 s bound and blamed the
// driver once a session, against an innocent driver.
{
  class ThreeLike extends FakeProgram {
    program: unknown = { handle: true };
  }
  BOUND_SAID.said = false;
  const said: string[] = [];
  const f = new LinkFlight();
  f.say = (line) => said.push(line);
  const lost = new ThreeLike(-1);
  ok(!programGone(lost) && !programGone(new FakeProgram(0)), 'a live program, and a stand-in with no handle at all, are not gone');
  const e = f.issue({}, [lost], 0);
  lost.program = undefined;
  ok(programGone(lost), 'one whose handle three took away on destroy is');
  ok(f.poll(1, false) === 1 && e.how === 'ready' && lost.polls === 0, 'struck off at the next poll without being asked anything');
  ok(f.gone === 1 && f.bound === 0 && f.programsInFlight === 0 && !BOUND_SAID.said && said.length === 0, 'counted as gone, never as the bound, and the driver is not blamed');
  ok(f.medianReadyMs() === 0, 'and no time to ready is kept for an object none of whose programs was ever ready');
  f.release();
  const a = new ThreeLike(-1);
  const b = new ThreeLike(1);
  const e2 = f.issue({}, [a, b], 10);
  a.program = undefined;
  ok(f.poll(11, false) === 0 && f.programsInFlight === 1, 'beside a live program the gone one is struck off and the object waits on the live one alone');
  ok(f.poll(14, false) === 1 && e2.how === 'ready' && f.medianReadyMs() === 4, 'which finishes it ready, timed as ever');
  f.release();
  const c = new ThreeLike(-1);
  f.issue({}, [c], 20);
  f.poll(LINK_TUNE.boundMs + 25, false);
  ok(f.bound === 1 && BOUND_SAID.said, 'while a live program never ready still meets the bound and is said, as before');
}

console.log(`\n${checks} checks passed`);
