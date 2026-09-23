// The conversion runner, driven with fake children: a script that prints, sleeps and ends with the code
// it was told to. Nothing here reads a game install or converts anything, and every folder it makes is a
// temporary one -- what is being pinned is the running, not the converting.
//
// The children are real child processes of this very node, because that is the thing worth testing: the
// cap is read off the times the children themselves wrote down rather than off the runner's own
// bookkeeping, a killed run is checked by the children never writing their last line, and a step that
// fails is a process that really exited non-zero.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../convertRun.mjs';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

const scratch = mkdtempSync(join(tmpdir(), 'swg3js convert run '));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

// The fake converter: it says who it is, waits, says so again and ends with the code it was given. It
// writes its own start and end to a mark file, so what really ran beside what is read from the children
// and not from the runner. It never calls process.exit, which on Windows can lose what it printed.
const fake = join(scratch, 'fake.mjs');
writeFileSync(
  fake,
  `import { appendFileSync } from 'node:fs';
const arg = (n) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const mark = arg('mark');
const ms = Number(arg('ms') ?? 40);
const say = arg('say') ?? process.argv[2] ?? 'step';
if (mark) appendFileSync(mark, 'start ' + Date.now() + '\\n');
console.log(say + ' starting');
console.error('mounted 200 archives (pretend)');
setTimeout(() => {
  console.log(say + ' finished');
  if (mark) appendFileSync(mark, 'end ' + Date.now() + '\\n');
  process.exitCode = Number(arg('exit') ?? 0);
}, ms);
`,
);

let runs = 0;
type Step = { key: string; label?: string; args: string[]; needs?: string[]; locks?: string[]; alone?: boolean; cost?: { seconds?: number; bytes?: number } };
type Opts = { jobs?: number; unreadable?: string[]; stopAfter?: number; memoryBudget?: number };

/** One run of the fake steps in a folder of its own. Answers the summary, the events and the folder. */
async function drive(steps: Step[], { jobs = 2, unreadable, stopAfter, memoryBudget }: Opts = {}) {
  const outDir = join(scratch, `run${++runs}`);
  mkdirSync(outDir, { recursive: true });
  const events: any[] = [];
  const marked = steps.map((s) => ({ ...s, args: [...s.args, `--mark=${join(outDir, `${s.key}.mark`)}`] }));
  const run = R.startConversion({ steps: marked, cli: fake, outDir, jobs, unreadable, memoryBudget, onEvent: (e: any) => events.push(e) });
  if (stopAfter !== undefined) setTimeout(() => run.stop(), stopAfter);
  const summary = await run.done;
  return { summary, events, outDir, state: run.state };
}

/** When each child really ran, from the file the child itself wrote. A child killed has no end. */
function spans(outDir: string, keys: string[]) {
  return keys.map((k) => {
    const file = join(outDir, `${k}.mark`);
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const start = /start (\d+)/.exec(text);
    const end = /end (\d+)/.exec(text);
    return { key: k, start: start ? Number(start[1]) : null, end: end ? Number(end[1]) : null };
  });
}

/** The most children that were alive at once, from their own times. A child with no end counts to the end. */
function mostAtOnce(list: ReturnType<typeof spans>) {
  const marks: { t: number; d: number }[] = [];
  for (const s of list) {
    if (s.start === null) continue;
    marks.push({ t: s.start, d: 1 });
    marks.push({ t: s.end ?? Number.MAX_SAFE_INTEGER, d: -1 });
  }
  marks.sort((a, b) => a.t - b.t || a.d - b.d);
  let live = 0;
  let most = 0;
  for (const m of marks) {
    live += m.d;
    most = Math.max(most, live);
  }
  return most;
}

const step = (key: string, ms: number, extra: Partial<Step> = {}): Step => ({ key, label: key, args: [key, `--ms=${ms}`], ...extra });

// ---------------------------------------------------------------------------------------------
// The plan as it comes in: the names, the ordering and the work behind each step.
{
  const { steps, problems } = R.normaliseSteps([
    { args: ['ships', '--retail-only'] },
    { key: 'sounds', args: ['sounds', 'x'], needs: ['player', 'gone'], locks: ['sounds'], cost: { seconds: 4000 } },
    { key: 'player', args: ['player', 'a'] },
    { key: 'player', args: ['player', 'a'] },
    { args: [] },
  ]);
  ok(steps.length === 3, `a step with no command line and a step asked for twice are left out (${steps.length} of 5 kept)`);
  ok(problems.length === 2, 'and both are said out loud rather than dropped in silence');
  ok(steps[0].key === ['ships', '--retail-only'].join('\u0000'), 'a step with no key of its own is known by its command line');
  ok(steps[0].label === 'ships' && steps[0].command === 'ships', 'and is labelled with its command');
  const sounds = steps.find((s: any) => s.key === 'sounds');
  ok(sounds.waitFor.length === 1 && sounds.waitFor[0] === 'player', 'a step waits for the steps of this run it names, by key');
  ok(!sounds.waitFor.includes('gone'), 'and a name that is no step of this run is taken as already done, since status asks only for what is left');
  const byCommand = R.normaliseSteps([
    { key: 'p1', args: ['player', 'male'] },
    { key: 'p2', args: ['player', 'female'] },
    { key: 's', args: ['sounds'], needs: ['player'] },
  ]).steps;
  ok(byCommand[2].waitFor.length === 2, 'a name that is a command waits for every step of that command (both player steps)');

  const paths = R.criticalPaths(
    R.normaliseSteps([
      { key: 'a', args: ['a'], cost: { seconds: 10 } },
      { key: 'b', args: ['b'], needs: ['a'], cost: { seconds: 100 } },
      { key: 'c', args: ['c'], cost: { seconds: 50 } },
    ]).steps,
  );
  ok(paths.get('a') === 110 && paths.get('c') === 50, 'the work behind a step is its own and everything waiting on it (110 against 50)');
  const cycle = R.criticalPaths(R.normaliseSteps([{ key: 'a', args: ['a'], needs: ['b'] }, { key: 'b', args: ['b'], needs: ['a'] }]).steps);
  ok(Number.isFinite(cycle.get('a')) && Number.isFinite(cycle.get('b')), 'a plan that circles back on itself is measured rather than followed for ever');
}

// How many at once on this machine.
{
  ok(R.defaultJobs({ cores: 16, memoryBytes: 32 * 1024 ** 3 }) === 4, 'a large machine runs four at a time, not sixteen');
  ok(R.defaultJobs({ cores: 4, memoryBytes: 8 * 1024 ** 3 }) === 2, 'a four-core machine with 8 GB runs two');
  ok(R.defaultJobs({ cores: 8, memoryBytes: 2 * 1024 ** 3 }) === 1, 'a machine with little memory runs one, whatever its cores');
  ok(R.defaultJobs({ cores: 1, memoryBytes: 1024 ** 3 }) === 1, 'and it is never less than one');
  ok(R.defaultJobs() >= 1, 'this machine answers with at least one');

  const big = { cores: 16, memoryBytes: 32 * 1024 ** 3 };
  ok(R.jobsFor('6', big) === 6, 'a number asked for on the command line is taken as it stands, above this machine\'s own figure');
  ok(R.jobsFor(1, big) === 1, 'one is one');
  ok(R.jobsFor('0', big) === R.defaultJobs(big) && R.jobsFor('-3', big) === R.defaultJobs(big), 'nought or less is nonsense and falls back to the machine\'s own figure');
  ok(R.jobsFor('lots', big) === R.defaultJobs(big) && R.jobsFor(undefined, big) === R.defaultJobs(big), 'so does a word, and so does nothing being asked at all');
  ok(R.jobsFor('99', { cores: 4, memoryBytes: 32 * 1024 ** 3 }) === 4, 'and more jobs than the machine has cores is never honoured');
  ok(R.jobsFor('2.7', big) === 2, 'a fraction is taken down, not up');
}

// ---------------------------------------------------------------------------------------------
// Running them.

// The cap: five steps that could all run at once, two jobs.
{
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const { summary, outDir } = await drive(keys.map((k) => step(k, 200)), { jobs: 2 });
  ok(summary.done.length === 5 && summary.ok, 'five independent steps all convert');
  const most = mostAtOnce(spans(outDir, keys));
  ok(most === 2, `and never more than the two jobs asked for ran at once (${most})`);
  ok(summary.seconds >= 0 && summary.done.every((s: any) => s.seconds >= 0), 'each one says how long it took');
}

// One job is one at a time, and the longest work goes first.
{
  const steps = [step('short', 60, { cost: { seconds: 10 } }), step('long', 60, { cost: { seconds: 900 } }), step('middle', 60, { cost: { seconds: 100 } })];
  const { summary, outDir } = await drive(steps, { jobs: 1 });
  const order = spans(outDir, ['short', 'long', 'middle']).sort((a, b) => a.start! - b.start!).map((s) => s.key);
  ok(mostAtOnce(spans(outDir, ['short', 'long', 'middle'])) === 1, 'with one job nothing overlaps');
  ok(summary.done.length === 3, 'all three convert');
  ok(order.join(',') === 'long,middle,short', `and the longest pole is started first, the shortest last (${order.join(', ')})`);
}

// Two steps that write the same pack folder hold the same lock and never run together.
{
  const keys = ['w1', 'w2', 'free'];
  const steps = [step('w1', 200, { locks: ['pack:naboo'] }), step('w2', 200, { locks: ['pack:naboo'] }), step('free', 200)];
  const { summary, outDir } = await drive(steps, { jobs: 3 });
  ok(summary.done.length === 3, 'all three convert');
  const list = spans(outDir, keys);
  const w1 = list[0];
  const w2 = list[1];
  ok(w1.end! <= w2.start! || w2.end! <= w1.start!, 'but the two that share a lock never overlap, however many jobs there are');
  ok(mostAtOnce(list) === 2, 'while the one that shares nothing runs beside one of them');
}

// A step nothing is known about runs alone.
{
  const keys = ['x', 'lone', 'y'];
  const steps = [step('x', 150), step('lone', 150, { alone: true }), step('y', 150)];
  const { summary, outDir } = await drive(steps, { jobs: 3 });
  const list = spans(outDir, keys);
  const lone = list[1];
  ok(summary.done.length === 3, 'a step that must run alone still runs');
  ok(list.filter((s) => s.key !== 'lone').every((s) => s.end! <= lone.start! || s.start! >= lone.end!), 'and nothing at all runs beside it');
}

// What waits for what.
{
  const steps = [step('second', 80, { needs: ['first'] }), step('first', 80), step('loose', 80, { needs: ['never-asked-for'] })];
  const { summary, outDir } = await drive(steps, { jobs: 3 });
  const [second, first, loose] = spans(outDir, ['second', 'first', 'loose']);
  ok(second.start! >= first.end!, 'a step that needs another starts only once that one has finished');
  ok(loose.start !== null && summary.done.length === 3, 'and one that needs a step this run was never asked for runs at once, since status asks only for what is left');
}

// A failure is contained: what did not need it still converts, what did is reported as not run.
{
  const steps = [
    { ...step('bad', 60), args: ['bad', '--ms=60', '--exit=3'] },
    step('after', 60, { needs: ['bad'] }),
    step('later', 60, { needs: ['after'] }),
    step('apart', 60),
  ];
  const { summary, events, outDir } = await drive(steps, { jobs: 2 });
  ok(summary.failed.length === 1 && summary.failed[0].label === 'bad' && summary.failed[0].code === 3, 'the step that failed is named with the code it ended with');
  ok(summary.done.length === 1 && summary.done[0].label === 'apart', 'the step that needed nothing of it converted all the same');
  ok(summary.skipped.length === 2, 'the two that needed it are reported as not run');
  ok(summary.skipped[0].because.includes('bad'), `and say which step they were waiting for ("${summary.skipped[0].because}")`);
  ok(!summary.skipped.some((s: any) => s.code), 'a step that was never run has no exit code of its own, so it is never called a failure');
  ok(summary.ok === false, 'and the run as a whole is not a success');
  ok(spans(outDir, ['after']).every((s) => s.start === null), 'nothing was started for a step whose dependency failed');
  ok(events.some((e) => e.kind === 'step-skip' && e.key === 'after'), 'the caller is told as it happens, not only at the end');
  ok(summary.failed[0].logFile.startsWith(summary.logDir), 'the failure carries the path of its own log');
  ok(existsSync(summary.failed[0].logFile) && readFileSync(summary.failed[0].logFile, 'utf8').includes('bad finished'), 'and that log holds what the child printed');
}

// A plan that circles back on itself ends rather than waiting for ever.
{
  const steps = [step('a', 40, { needs: ['b'] }), step('b', 40, { needs: ['a'] }), step('c', 40)];
  const { summary } = await drive(steps, { jobs: 2 });
  ok(summary.done.length === 1 && summary.done[0].label === 'c', 'the step outside the circle converts');
  ok(summary.skipped.length === 2 && summary.skipped.every((s: any) => /order/.test(s.because)), 'and the two inside it are reported, not waited on');
}

// Ctrl+C: the children are killed, what was running is stopped rather than failed, the rest never ran.
{
  const keys = ['s1', 's2', 's3', 's4'];
  const { summary, outDir, state } = await drive(keys.map((k) => step(k, 4000)), { jobs: 2, stopAfter: 250 });
  ok(summary.cancelled === true, 'the run says it was stopped');
  ok(summary.stopped.length === 2, 'the two that were running are reported as stopped part way');
  ok(summary.notRun.length === 2, 'and the two that had not started are reported as never run');
  ok(summary.failed.length === 0, 'neither of them is called a failure');
  const list = spans(outDir, keys);
  ok(list.filter((s) => s.start !== null).every((s) => s.end === null), 'every child that was running really was killed, well inside its own four seconds');
  ok(state.finishedAt - state.startedAt < 3000, `and the run itself came back at once (${state.finishedAt - state.startedAt} ms)`);
  ok(R.summaryLines(summary).some((l: string) => /Stopped after/.test(l)), 'the words say so');
  ok(R.summaryLines(summary).some((l: string) => /carries on/.test(l)), 'and say that running convert again carries on');
}

// Every step's whole output is on disk, and the run leaves a summary beside the logs.
{
  const { summary, outDir } = await drive([step('one', 60), step('two', 60)], { jobs: 2 });
  const logs = readdirSync(summary.logDir);
  ok(logs.filter((n) => n.endsWith('.log')).length === 2, 'a log a step, in a folder of this run\'s own');
  ok(logs.includes('summary.txt'), 'and a summary beside them');
  const text = readFileSync(join(summary.logDir, logs.find((n) => n.includes('one'))!), 'utf8');
  ok(text.includes('one starting') && text.includes('one finished'), 'the log holds what the child printed');
  ok(text.includes('mounted 200 archives'), 'including what it printed on the error stream, which is where the converter says what it mounted');
  ok(text.includes('# done after'), 'and ends with what became of the step');
  ok(summary.logDir.startsWith(join(outDir, 'logs')), 'the logs go with the converted content, not into the checkout');
}

// The events a page follows, and the display a person watches.
{
  const { events, state } = await drive([step('alpha', 120), step('beta', 120)], { jobs: 1 });
  const kinds = events.map((e) => e.kind);
  ok(kinds[0] === 'start' && kinds[kinds.length - 1] === 'end', 'the events open with the plan and close with the summary');
  ok(events.filter((e) => e.kind === 'step-start').length === 2 && events.filter((e) => e.kind === 'step-end').length === 2, 'each step starts and ends once');
  const line = events.find((e) => e.kind === 'step-line' && /starting/.test(e.line));
  ok(Boolean(line) && line.key === 'alpha', 'every line a child prints reaches the caller with the step it came from');
  ok(events.filter((e) => e.kind === 'step-line' && e.stream === 'err').length >= 1, 'the error stream reaches it too');
  ok(state.steps.every((s: any) => s.status === 'done' && s.lastLine), 'and the state a page polls holds each step\'s last line');
}

// The two seams the command line and the launcher's page hang on: a run can be watched after it has
// been made (the display is drawn from its state, so it cannot exist any earlier), and a display handed
// the whole run needs nothing wired by hand.
{
  const outDir = join(scratch, `run${++runs}`);
  mkdirSync(outDir, { recursive: true });
  const seen: string[] = [];
  const quiet: string[] = [];
  const written: string[] = [];
  const run = R.startConversion({
    steps: [{ key: 'one', label: 'One', args: ['one', '--ms=60'] }, { key: 'two', label: 'Two', args: ['two', '--ms=60'] }],
    cli: fake,
    outDir,
    jobs: 1,
  });
  run.listen((e: any) => seen.push(e.kind));
  const off = run.listen((e: any) => quiet.push(e.kind));
  off();
  const display = R.startDisplay(run, { stream: { isTTY: false, write: (s: string) => written.push(s) } as any });
  const summary = await run.done;
  display.stop();
  ok(seen.includes('step-start') && seen.includes('end'), 'a watcher added after the run was made hears everything that happens after it');
  ok(!seen.includes('start'), 'and not the opening word, which had already gone by; that one is the caller\'s own');
  ok(quiet.length === 0, 'a watcher that lets go again hears nothing at all');
  ok(written.some((l) => /One started/.test(l)) && written.some((l) => /Two done/.test(l)), 'a display handed the whole run takes its own events, with nothing wired by hand');
  ok(written.every((l) => !l.includes('\u001b')), 'and where there is no terminal it writes plain lines rather than cursor moves');
  ok(summary.done.length === 2, 'and the run is none the worse for being watched');
}

// Ctrl+C in one place: the first press stops the run, a second ends the children outright, and the
// handlers are given back afterwards so one run's cannot stop the next.
{
  const outDir = join(scratch, `run${++runs}`);
  mkdirSync(outDir, { recursive: true });
  const handlers = new Map<string, () => void>();
  const said: string[] = [];
  const run = R.startConversion({
    steps: [{ key: 'slow1', label: 'Slow one', args: ['slow1', '--ms=6000'] }, { key: 'slow2', label: 'Slow two', args: ['slow2', '--ms=6000'] }],
    cli: fake,
    outDir,
    jobs: 1,
  });
  const release = R.stopOnSignals(run, {
    on: (s: string, f: () => void) => handlers.set(s, f),
    off: (s: string) => handlers.delete(s),
    say: (line: string) => said.push(line),
  });
  ok(handlers.has('SIGINT') && handlers.has('SIGTERM'), 'Ctrl+C and a kill from outside both stop a run');
  setTimeout(() => {
    handlers.get('SIGINT')!();
    handlers.get('SIGINT')!();
  }, 250);
  const summary = await run.done;
  release();
  ok(summary.cancelled === true && summary.stopped.length === 1 && summary.notRun.length === 1, 'the press stops the run, the step running is stopped and the one behind it never starts');
  ok(said.length === 2 && /Press again/.test(said[0]) && /outright/.test(said[1]), 'the first press says what a second one would do, and the second says it is doing it');
  ok(handlers.size === 0, 'and the handlers are given back, so the next run is not stopped by this one\'s');
}

// The display is lines, so it is read here rather than on a terminal.
{
  const state = {
    startedAt: 1000,
    jobs: 2,
    outDir: 'D:\\swg3js\\assets-private',
    stopping: false,
    totalWeight: 1000,
    doneWeight: 250,
    steps: [
      { label: 'Ships', status: 'running', startedAt: 1000, lastLine: 'wrote a hull', weight: 500 },
      { label: 'Sounds', status: 'running', startedAt: 1000, lastLine: 'copying a sample', weight: 250 },
      { label: 'Maps', status: 'done', startedAt: 0, lastLine: '', weight: 250 },
      { label: 'Skies', status: 'waiting', startedAt: 0, lastLine: '', weight: 0 },
    ],
  };
  const lines = R.displayLines(state, 78, 1000 + 125000);
  ok(lines.length === 5, 'a heading, a bar, a line for each step running and a tail');
  ok(lines[0].includes('assets-private') && lines[0].includes('2 running of 2'), 'the heading says where it is going and how many are running');
  ok(/\[#+-+\]\s+25%/.test(lines[1]), 'the bar stands at the share of the work behind the steps that are done');
  ok(lines[1].includes('2m 05s gone') && /about .* left/.test(lines[1]), 'with the time gone and a guess at what is left');
  ok(lines[2].includes('02:05') && lines[2].includes('wrote a hull'), 'each running step shows how long it has taken and the last thing it printed');
  ok(lines[4].includes('1 done') && lines[4].includes('1 waiting'), 'and the tail counts the rest');
  ok(R.displayLines(state, 40, 1000).every((l: string) => l.length <= 40), 'nothing is wider than the window');
  const halting = R.displayLines({ ...state, stopping: true }, 78, 2000);
  ok(halting[1].includes('stopping') && !/about .* left/.test(halting[1]), 'a run being stopped says so on the bar, where a narrow window does not clip it');
  ok(R.guessLeft({ ...state, doneWeight: 0 }, 0) > 0, 'a guess is made before anything has finished, from the plan\'s own figures');
  ok(Math.round(R.guessLeft(state, 100)) === 300, 'and after that from how fast the work has really gone');
  ok(R.words(45) === '45 s' && R.words(125) === '2m 05s' && R.words(7800) === '2h 10m', 'a length of time is read at a glance');
}

// A file a killed step left half written is set aside before anything runs; one outside the folder stops it.
{
  const outDir = join(scratch, 'aside');
  mkdirSync(join(outDir, 'naboo'), { recursive: true });
  const cut = join(outDir, 'naboo', 'layout.json');
  writeFileSync(cut, '{"half":');
  const run = R.startConversion({ steps: [step('go', 40)], cli: fake, outDir, jobs: 1, unreadable: [cut] });
  const summary = await run.done;
  ok(!existsSync(cut), 'the file cut short is out of the way before the step that writes it starts again');
  ok(readdirSync(join(outDir, 'naboo')).some((n) => n.startsWith('layout.json.cut-')), 'renamed beside itself, never deleted');
  ok(summary.movedAside === 1 && summary.done.length === 1, 'and the run carries on');

  const outside = join(scratch, 'elsewhere.json');
  writeFileSync(outside, 'x');
  const refused = await R.startConversion({ steps: [step('nope', 40)], cli: fake, outDir: join(scratch, 'aside2'), jobs: 1, unreadable: [outside] }).done;
  ok(existsSync(outside), 'a file outside the converted content is never touched');
  ok(refused.notRun.length === 1 && refused.done.length === 0 && !refused.ok, 'and nothing is run at all');
  ok(refused.problems.some((p: string) => /outside/.test(p)), 'the refusal says why');
}

// A command line that cannot be started at all is a failure like any other, not a hang.
{
  const summary = await R.runConversion({ steps: [{ key: 'ghost', label: 'ghost', args: ['ghost'] }], cli: join(scratch, 'not-a-file.mjs'), outDir: join(scratch, 'ghost'), jobs: 1 });
  ok(summary.failed.length === 1 && summary.failed[0].label === 'ghost', 'a step whose command could not be run is reported as failed');
  ok(!summary.ok, 'and the run is not a success');
}

// The log file names.
{
  const { steps } = R.normaliseSteps([{ args: ['snapshot', 'A:\\SWG Stuff\\SWG', 'tatooine', 'C:\\out', '--retail-only'] }]);
  ok(R.logName(steps[0], 3) === '03-snapshot-tatooine.log', `a log is named for its place in the run and what it converted (${R.logName(steps[0], 3)})`);
  ok(!/[\\/:*?"<>|]/.test(R.logName(steps[0], 3)), 'and carries nothing a file name cannot hold');
  ok(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(R.stamp(Date.UTC(2026, 8, 22, 14, 31, 7))), 'a run\'s folder is stamped with a name that sorts by time');
}

console.log(`\n${passed} checks passed`);
