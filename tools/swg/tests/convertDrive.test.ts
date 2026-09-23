// The conversion driver: the module `npm run swg -- convert` and the launcher's Convert button both
// run. It is driven here with a plan of its own and children that sleep, print and end with the code
// they were told to, so nothing reads a game install and nothing is converted -- what is pinned is the
// joining up: asking what is missing, running what the plan allows, asking again, and knowing when to
// stop asking.
//
// The children are real child processes, because that is the thing worth testing: a step that failed is
// a process that really exited non-zero, a cancelled run is checked by the children never writing their
// last line, and a step the plan set aside is checked by there being no child at all.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as D from '../convertDrive.mjs';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

const scratch = mkdtempSync(join(tmpdir(), 'swg3js convert drive '));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

// The fake converter: it says who it is, waits, says so again and ends with the code it was given,
// writing its own start and end to a mark file so what really ran is read from the child and not from
// the driver's own bookkeeping.
const fake = join(scratch, 'fake.mjs');
writeFileSync(
  fake,
  `import { appendFileSync } from 'node:fs';
const arg = (n) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const mark = arg('mark');
const ms = Number(arg('ms') ?? 30);
const say = process.argv[2] ?? 'step';
if (mark) appendFileSync(mark, 'start ' + Date.now() + '\\n');
console.log(say + ' starting');
setTimeout(() => {
  console.log(say + ' finished');
  if (mark) appendFileSync(mark, 'end ' + Date.now() + '\\n');
  process.exitCode = Number(arg('exit') ?? 0);
}, ms);
`,
);

type Asked = { command: string; args: string[]; reason?: string; needs?: string[]; after?: string[]; locks?: string[]; skip?: string; seconds?: number };
type Status = { format: 1; done: boolean; steps: Asked[]; unreadable?: string[] };

/** What `status --json` would say, one answer per time round. The last is repeated if it runs out. */
const statuses = (list: Status[]) => {
  const asks: number[] = [];
  const status = async () => {
    const at = Math.min(asks.length, list.length - 1);
    asks.push(at);
    return list[at];
  };
  return { status, asks };
};

/**
 * What each command reads, as the real plan's `STEP_FACTS` says it: the driver asks the plan for these
 * to know whether a command it cannot see in a round has been run or merely cannot be asked for yet.
 * It is one object for the file, emptied and filled by whichever block wants a graph.
 */
const FACTS: Record<string, { needs: string[]; seconds: number }> = Object.create(null);
const facts = (graph: Record<string, string[]>) => {
  for (const k of Object.keys(FACTS)) delete FACTS[k];
  for (const [command, needs] of Object.entries(graph)) FACTS[command] = { needs, seconds: 60 };
};

/**
 * The plan module the driver would load, written here instead. It answers in the spellings the real
 * plan answers in -- `needs` as command names, `cost.bytes`, a stable `key`, `factsFor` and
 * `STEP_FACTS` -- which is the path the owner's machine takes. The other spellings the adapter reads
 * (`after`, `cost.memoryMb`) are pinned on `stepsForRunner` directly, at the top of this file.
 */
const plan = {
  STEP_FACTS: FACTS,
  factsFor: (command: string) => FACTS[command] ?? null,
  costOf: (command: string) => ({ seconds: FACTS[command]?.seconds ?? 60, bytes: 16 * 1024 ** 2 }),
  convertPlan: (asked: Status, { out, only }: { out: string; only: string[] | null }) => ({
    steps: asked.steps
      .filter((s) => !only || only.includes(s.command))
      .map((s) => ({
        key: s.args.join('\u0000'),
        command: s.command,
        label: s.command,
        args: [...s.args, `--mark=${join(out, `${s.command}.mark`)}`],
        reason: s.reason ?? '',
        needs: s.needs ?? FACTS[s.command]?.needs ?? [],
        locks: s.locks ?? [],
        cost: { seconds: s.seconds ?? 1, bytes: 16 * 1024 ** 2 },
        skip: s.skip ?? null,
      })),
  }),
};

let runs = 0;
type Opts = { only?: string[]; dryRun?: boolean; jobs?: number; stopAfter?: number; stopWhileAsking?: boolean; seeds?: any };

/** One run of the fake steps in a folder of its own: the result, every event, and where it all went. */
async function drive(list: Status[], { only, dryRun, jobs = 2, stopAfter, stopWhileAsking, seeds = null }: Opts = {}) {
  const out = join(scratch, `run${++runs}`);
  mkdirSync(out, { recursive: true });
  const events: any[] = [];
  const { status: asking, asks } = statuses(list);
  const stopper = new AbortController();
  if (stopAfter !== undefined) setTimeout(() => stopper.abort(), stopAfter);
  // Stopping in the moment between "what is missing?" and the first child: the signal has already gone
  // off by the time the pass is made, so a listener added then would never hear it.
  const status = stopWhileAsking
    ? async (o: any) => {
        const answer = await asking();
        stopper.abort();
        return answer;
      }
    : asking;
  const result = await D.runConvert({
    cli: fake,
    out,
    swg: 'D:\\SWG',
    jka: '',
    plan,
    status,
    jobs,
    only: only ?? null,
    // The converter's own seeds read the owner's folders; every run here says what it wants instead.
    seeds,
    dryRun: dryRun ?? false,
    signal: stopper.signal,
    onEvent: (e: any) => events.push(e),
  });
  return { result, events, out, asked: asks.length };
}

/** When a child really ran, from the file the child itself wrote. A child that was killed has no end. */
function span(out: string, command: string) {
  const file = join(out, `${command}.mark`);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const start = /start (\d+)/.exec(text);
  const end = /end (\d+)/.exec(text);
  return { ran: Boolean(start), start: start ? Number(start[1]) : 0, end: end ? Number(end[1]) : 0 };
}

const step = (command: string, extra: Partial<Asked> = {}): Asked => ({ command, args: [command, '--ms=30'], reason: `no ${command}`, ...extra });

// ---------------------------------------------------------------------------------------------
// What the plan hands over, as the runner reads it.
{
  const { run, skipped } = D.stepsForRunner({
    steps: [
      { args: ['alpha'], reason: 'why', after: ['beta'], cost: { seconds: 12, memoryMb: 64 } },
      { args: ['beta'], locks: ['tatooine'], alone: true },
      { args: ['gamma'], skip: 'needs a Jedi Academy folder' },
      { args: [] },
      null,
    ],
  });
  ok(run.length === 2 && skipped.length === 1, 'a step the plan set aside is kept apart, and a step with no command line is dropped');
  ok(run[0].needs[0] === 'beta', "the plan's `after` is the runner's `needs`");
  ok(run[0].cost.bytes === 64 * 1024 ** 2 && run[0].cost.seconds === 12, 'a cost in megabytes is the same cost in bytes');
  ok(run[1].alone === true && run[1].locks[0] === 'tatooine' && run[1].label === 'beta', 'what a step may not run beside comes through, and a step with no words of its own is called by its command');
  ok(skipped[0].because === 'needs a Jedi Academy folder' && skipped[0].key === 'gamma', 'and the reason it cannot be run here comes with it');
}

// ---------------------------------------------------------------------------------------------
// Round and round until nothing is missing: what a pass leaves behind is asked for again.
{
  const { result, events, out, asked } = await drive([
    { format: 1, done: false, steps: [step('alpha'), step('beta', { needs: ['alpha'] })] },
    { format: 1, done: false, steps: [step('gamma')] },
    { format: 1, done: true, steps: [] },
  ]);
  ok(result.ok && result.outcome === 'Everything is converted.', `a conversion that leaves nothing missing says so (${result.outcome})`);
  ok(result.passes === 2 && asked === 3, 'it asked what was missing, ran it, asked again, ran that, and asked once more to find nothing');
  ok(result.done.map((s: any) => s.label).join(',') === 'alpha,beta,gamma', 'every step ran, and each pass is reported with the last');
  const a = span(out, 'alpha');
  const b = span(out, 'beta');
  ok(a.ran && b.ran && b.start >= a.end, 'a step that waits for another really started after it ended');
  ok(span(out, 'gamma').ran, 'and what only the second round asked for ran in the second round');
  const kinds = new Set(events.map((e) => e.kind));
  ok(['status', 'pass', 'step-start', 'step-line', 'step-end', 'pass-end'].every((k) => kinds.has(k)), `the launcher's own events all come out (${[...kinds].join(', ')})`);
  const line = events.find((e) => e.kind === 'step-line' && e.label === 'alpha');
  ok(/alpha starting/.test(line.line), "a child's own words reach the caller with the step they came from");
  ok(events.some((e) => e.kind === 'pass' && e.jobs === 2 && /convert-/.test(e.logDir)), 'each pass says how many run at once and where the logs are');
  ok(result.logDirs.length === 2 && existsSync(join(result.logDirs[0], 'summary.txt')), "and every pass leaves its children's output and a summary on disk");
}

// ---------------------------------------------------------------------------------------------
// A step `status` keeps asking for after it has run: said once, not run for ever.
{
  const always: Status = { format: 1, done: false, steps: [step('alpha')] };
  const { result, asked, out } = await drive([always]);
  ok(asked === 2 && result.passes === 1, 'it ran the step once and asked once more');
  ok(!result.ok && /still asked for after running/.test(result.outcome) && result.stuck[0].label === 'alpha', `the second asking for the same reason ends it, saying which step (${result.outcome})`);
  ok(readFileSync(join(out, 'alpha.mark'), 'utf8').split('start').length === 2, 'and the child really ran exactly once');
}

// ---------------------------------------------------------------------------------------------
// A failure: contained, named, and the end of the run.
{
  const { result, out, asked } = await drive([
    { format: 1, done: false, steps: [step('alpha', { args: ['alpha', '--ms=20', '--exit=3'] }), step('beta', { needs: ['alpha'] }), step('lone')] },
    { format: 1, done: true, steps: [] },
  ]);
  ok(!result.ok && result.failed.length === 1 && result.failed[0].code === 3, 'a step that ends badly is a failure with its own exit code');
  ok(/Finished, but 1 step failed: alpha/.test(result.outcome), `and the outcome names it (${result.outcome})`);
  ok(existsSync(result.failed[0].logFile), 'with a log of its own to read');
  ok(result.skipped.some((s: any) => s.label === 'beta') && !span(out, 'beta').ran, 'what waited on it is reported as not run rather than as failed, and no child was started for it');
  ok(span(out, 'lone').ran && result.done[0].label === 'lone', 'a step that did not depend on it ran all the same');
  ok(asked === 1, 'and the run ends there rather than asking again for a step it would not run');
}

// ---------------------------------------------------------------------------------------------
// Part of it, none of it, and a plan printed rather than run.
{
  const two: Status = { format: 1, done: false, steps: [step('alpha'), step('beta')] };
  const { result, out } = await drive([two, { format: 1, done: true, steps: [] }], { only: ['beta'] });
  ok(span(out, 'beta').ran && !span(out, 'alpha').ran, '--only runs the step asked for and no other');
  ok(/nothing more is asked of beta/.test(result.outcome), `and says so when there is nothing more of it to do (${result.outcome})`);

  const dry = await drive([{ format: 1, done: false, steps: [step('alpha', { seconds: 90 }), step('beta', { needs: ['alpha'] })] }], { dryRun: true });
  ok(dry.result.dryRun && dry.result.ok && !span(dry.out, 'alpha').ran && !span(dry.out, 'beta').ran, '--dry-run starts no child at all, and asking what would happen is not a failure');
  const text = dry.result.lines.join('\n');
  ok(/2 steps in this round, up to \d+ at once/.test(text) && /alpha -- about 1m 30s/.test(text) && /beta .*after alpha/.test(text), `and prints what would run, how long it takes and what it waits for:\n${text}`);
  ok(dry.result.lines[1].indexOf('alpha') > 0, 'longest work first, so the machine is busy to the end');

  // `status` asks for the same command twice where two gaps want it (the sound bank, with and without
  // Jedi Academy), so what is counted must be what would really run.
  const twice = await drive([{ format: 1, done: false, steps: [step('alpha'), step('alpha', { reason: 'and again' })] }], { dryRun: true });
  ok(twice.result.plan.length === 1 && /1 step would run/.test(twice.result.lines.join('\n')), 'a step asked for twice is one step, counted once');
}

// ---------------------------------------------------------------------------------------------
// A step this machine cannot run at all: said once, and never a child.
{
  const { result, out } = await drive([
    { format: 1, done: false, steps: [step('alpha'), step('jka-only', { skip: 'needs a Jedi Academy folder' })] },
    { format: 1, done: true, steps: [] },
  ]);
  ok(!span(out, 'jka-only').ran && result.skipped[0].label === 'jka-only', 'a step the plan set aside is never started');
  ok(result.ok && /needs a Jedi Academy folder/.test(result.outcome), `and is not a failure: this machine simply has not got it (${result.outcome})`);
}

// ---------------------------------------------------------------------------------------------
// Stop: the children go, and what was finished is what is reported.
{
  const { result, out } = await drive([{ format: 1, done: false, steps: [step('slow', { args: ['slow', '--ms=8000'] })] }], { stopAfter: 120 });
  ok(result.cancelled && !result.ok, 'a stopped conversion says it was stopped');
  ok(/^Stopped[.,]| after /.test(result.outcome) && /carry on/.test(result.outcome), `and that running it again carries on (${result.outcome})`);
  const s = span(out, 'slow');
  ok(s.ran && !s.end, 'the child was really killed: it started and never wrote its last line');
  ok(result.done.length === 0 && result.notRun.length + result.failed.length >= 1, 'nothing is counted as converted that was not');

  // Stopped while it was asking what is missing: the signal has already gone off by the time the pass
  // is started, so nothing would hear it unless the pass is asked again on the spot.
  const early = await drive([{ format: 1, done: false, steps: [step('slow', { args: ['slow', '--ms=8000'] })] }], { stopWhileAsking: true });
  ok(early.result.cancelled && early.result.done.length === 0 && !span(early.out, 'slow').end, 'a stop that lands while it is asking stops the pass that was about to run');
}

// ---------------------------------------------------------------------------------------------
// One round of asking is not the whole conversion. `status` cannot ask for a step until what it reads
// exists -- not for the character's parts before the player pack, nor for the clip pair before the
// parts rig -- so a step whose needs name work this round has not reached waits for the round after
// rather than being started against a pack that is not there yet.
{
  facts({ player: [], parts: ['player'], species: ['parts'] });
  const { result, events, out } = await drive([
    // Round one: only the player can be asked for. `species` is asked for as well (it has no index),
    // and what it reads -- the parts -- cannot even be asked for until the player pack exists.
    { format: 1, done: false, steps: [step('player'), step('species')] },
    { format: 1, done: false, steps: [step('parts'), step('species')] },
    { format: 1, done: true, steps: [] },
  ]);
  const player = span(out, 'player');
  const parts = span(out, 'parts');
  const species = span(out, 'species');
  ok(player.ran && parts.ran && species.ran && result.ok, `everything ran in the end (${result.outcome})`);
  ok(readFileSync(join(out, 'species.mark'), 'utf8').split('start').length === 2, 'the long step ran exactly once, not once wrongly and once again');
  ok(species.start >= parts.end && parts.start >= player.end, 'and it ran after the work it reads, although the round that first asked for it could not name that work');
  ok(
    events.some((e) => e.kind === 'note' && /species waits for parts/.test(e.line)),
    'the round that held it back says what it is waiting for',
  );
  facts({});
}

// ---------------------------------------------------------------------------------------------
// And when nothing can be started at all, that is said rather than called a finish.
{
  facts({ hen: ['egg'], egg: ['hen'] });
  const { result } = await drive([{ format: 1, done: false, steps: [step('hen')] }]);
  ok(!result.ok && result.waiting.length === 1 && result.waiting[0].waitingFor[0] === 'egg', 'a step waiting for work nothing here will do is reported, not run');
  ok(/waiting for work that was not done/.test(result.outcome), `and the outcome says so (${result.outcome})`);
  facts({});
}

// ---------------------------------------------------------------------------------------------
// `--only` drops the dependencies with the steps, which is what it is for; it is said out loud.
{
  facts({ maps: ['snapshot', 'terrain'], terrain: ['snapshot'], snapshot: [] });
  const { result, out, events } = await drive(
    [
      { format: 1, done: false, steps: [step('maps'), step('snapshot')] },
      { format: 1, done: false, steps: [step('snapshot')] },
    ],
    { only: ['maps'] },
  );
  ok(span(out, 'maps').ran && !span(out, 'snapshot').ran, '--only runs what was asked for and nothing else');
  ok(
    events.some((e) => e.kind === 'note' && /maps is being run without snapshot and terrain, which it reads/.test(e.line)),
    'and what it leaves out is named, once, rather than read as work that has been done',
  );
  ok(!result.waiting.length, 'nothing is held back for a round that will never come: --only is the whole of the run it asked for');
  ok(result.ok, `the run is still a success: it did what it was told (${result.outcome})`);
  facts({});
}

// ---------------------------------------------------------------------------------------------
// The work `status` has no way of asking for: handed in beside what it asked, and never twice.
{
  // As the converter's own seeds are: asked of the folder every round, and gone the moment what they
  // write is on disk, so nothing is ever seeded twice for the same gap.
  const seeds = (where: string) => (existsSync(join(where, 'loading.mark')) ? [] : [{ command: 'loading', args: ['loading', '--ms=30'], reason: 'the loading pictures are missing' }]);
  const sown = await drive([{ format: 1, done: false, steps: [step('alpha')] }, { format: 1, done: true, steps: [] }], { seeds });
  ok(span(sown.out, 'loading').ran, 'a seeded step runs although status never asked for it');
  ok(
    sown.events.some((e) => e.kind === 'status' && e.seeded === 1 && e.steps === 2),
    'and is counted with what status asked, so the display and the page agree about how much is left',
  );

  const both = await drive([{ format: 1, done: false, steps: [step('loading')] }, { format: 1, done: true, steps: [] }], { seeds });
  ok(readFileSync(join(both.out, 'loading.mark'), 'utf8').split('start').length === 2, 'and a seed status is asking for too is one step, not two');
}

// ---------------------------------------------------------------------------------------------
// The dry run is one round of asking and says so, and it speaks in words rather than in lock names.
{
  facts({ snapshot: [], terrain: ['snapshot'], sky: ['terrain'] });
  const dry = await drive([{ format: 1, done: false, steps: [step('snapshot', { locks: ['pack:*', 'pack:tatooine'] }), step('sky')] }], { dryRun: true });
  const text = dry.result.lines.join('\n');
  ok(/never beside another step that writes a planet pack/.test(text) && !/pack:\*/.test(text), `the plan is read out in words, not in the plan's own lock names:\n${text}`);
  ok(/1 step of this round waits for work it has still to do/.test(text) && /sky -- waits for terrain/.test(text), 'a step that waits for a later round is named as one');
  ok(/one round of asking, not the whole conversion/.test(text) && /terrain/.test(text), 'and so is the work that cannot be asked for at all yet');
  ok(dry.result.later.some((c: any) => c.command === 'terrain') && dry.result.ok, 'which a caller can read as numbers as well as words');
  facts({});
}

// ---------------------------------------------------------------------------------------------
// How many at once is one question with one answer, whoever asks it.
{
  const cores = 8;
  ok(D.jobsFor(0, { cores }) >= 1 && D.jobsFor('lots', { cores }) >= 1, 'nothing anybody can type makes it run nought steps at once');
  ok(D.jobsFor(64, { cores }) === cores && D.jobsFor('3', { cores }) === 3, 'more than the machine has is the machine, and a number typed as words is that number');
}

console.log(`\n${passed} checks passed`);
