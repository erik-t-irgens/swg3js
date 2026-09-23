// Running a conversion: the steps the plan hands over, several at once, with a log a person can read
// afterwards and a display they can follow while it runs.
//
// Nothing here decides what to convert or in what order. The steps, their order and what may run beside
// what come in from the plan, which builds them from the converter's own `status`; this module only
// runs them. Every step is a child process of this very node running the converter's own `cli.mjs`,
// never a call in this process: a step that runs out of memory, throws, or is killed takes itself down
// and nothing else, and a run of nineteen steps that loses one still finishes the other eighteen.
//
// Three rules keep a step from running beside another: a step waits for the steps it `needs`; two steps
// never run while they hold the same `lock` (two steps that write the same pack folder); and a step
// marked `alone` runs with nothing else at all, which is what an unknown step gets. Beyond that the
// only limits are the job cap and a rough memory budget, since each child mounts the archives for
// itself (about 300 MB of index before it converts anything).
//
// A step that fails never stops an independent one. What waited on it is reported as skipped rather
// than failed, because it was never run and running it again may well work. Ctrl+C kills the children
// and says what finished; nothing is remembered between runs, because `status` is the only truth about
// what is done and the next run asks it again.
//
// Two callers watch a run and neither parses a line of its output: the command line draws the in-place
// display (`startDisplay`), and the launcher's page reads `run.state` on its own clock and takes the
// events through `run.listen`. Everything either of them needs is a field or an event, so a change to
// the words on the screen can never change what the page understands.

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { setAside } from '../launcher/plan.mjs';

/** Bumped when the shape of a step, an event or the summary changes in a way a caller must know about. */
export const RUN_FORMAT = 1;

/** Setting aside a file a killed step left half written is the launcher's rule; there is one copy of it. */
export { setAside };

/**
 * Our numbers, none of them the converter's. `SHARE` of the cores, never more than `MAX_JOBS`, and
 * never more jobs than `SHARE_MEMORY` of the machine's memory holds at `STEP_BYTES` each: a machine
 * with eight cores and eight gigabytes runs two at a time and stays usable while it does.
 */
export const JOBS_TUNE = {
  /** The share of the machine's cores a conversion takes. */
  SHARE: 0.5,
  /** However many cores there are, more than this buys little: the long steps are few. */
  MAX_JOBS: 4,
  /** The share of the machine's memory a conversion may plan to use. */
  SHARE_MEMORY: 0.6,
  /** What a step is assumed to want when the plan gives it no figure. The mount alone is about 300 MB. */
  STEP_BYTES: 1.5 * 1024 ** 3,
  /** What a step is assumed to take when the plan gives it no figure, for the bar and the ordering. */
  STEP_SECONDS: 300,
  /** How long a killed child is given to go before it is killed outright. */
  KILL_GRACE_MS: 5000,
};

/** How many steps to run at once on this machine, unless the player says otherwise. */
export function defaultJobs({ cores = cpus().length, memoryBytes = totalmem(), stepBytes = JOBS_TUNE.STEP_BYTES } = {}) {
  const byCores = Math.floor((cores || 1) * JOBS_TUNE.SHARE);
  const byMemory = Math.floor((memoryBytes * JOBS_TUNE.SHARE_MEMORY) / Math.max(1, stepBytes));
  return Math.max(1, Math.min(JOBS_TUNE.MAX_JOBS, byCores || 1, byMemory || 1));
}

/**
 * What `--jobs=` came to: the number asked for when it is a number at all, never less than one and
 * never more than there are cores, and this machine's own figure when nothing was asked or the text
 * was not a number. It lives here rather than in whatever parses the command line so that the launcher
 * and the command line cannot disagree about what `--jobs=0` or `--jobs=lots` means.
 */
export function jobsFor(asked, { cores = cpus().length, memoryBytes = totalmem() } = {}) {
  const n = typeof asked === 'string' ? Number(asked.trim()) : asked;
  if (!Number.isFinite(n) || n < 1) return defaultJobs({ cores, memoryBytes });
  return Math.max(1, Math.min(Math.floor(n), Math.max(1, cores || 1)));
}

// ---------------------------------------------------------------------------------------------
// The steps, as they come in and as they are run.

/**
 * A step as the plan hands it over: `args` (the converter's command line, already split), and any of
 * `key` (its own name, the arguments joined when there is none), `label` (words for a person), `needs`
 * (steps that must have finished first), `locks` (names it holds while it runs; two steps never run
 * while they hold the same one), `alone` (it runs with nothing else) and `cost` (`{ seconds, bytes }`).
 *
 * A name in `needs` is another step's `key`, or a command (`player`), which means every step of that
 * command: the plan can say "sounds needs player" without knowing how the player step's arguments came
 * out. A name that is no step of this run is taken as already done, because `status` asks only for the
 * work that is left, so a step it no longer asks for is a step that has been run.
 */
export function normaliseSteps(steps) {
  const out = [];
  const problems = [];
  const byKey = new Map();
  for (const s of steps ?? []) {
    const args = Array.isArray(s?.args) ? s.args.filter((a) => typeof a === 'string') : [];
    if (!args.length) {
      problems.push('a step with no command line was left out');
      continue;
    }
    const key = typeof s.key === 'string' && s.key ? s.key : args.join('\u0000');
    if (byKey.has(key)) {
      problems.push(`${s.label ?? args[0]} was asked for twice; the second was left out`);
      continue;
    }
    const step = {
      key,
      command: args[0],
      label: typeof s.label === 'string' && s.label ? s.label : args[0],
      args: args.slice(),
      reason: typeof s.reason === 'string' ? s.reason : '',
      needs: names(s.needs),
      locks: names(s.locks),
      alone: s.alone === true,
      seconds: figure(s.cost?.seconds, JOBS_TUNE.STEP_SECONDS),
      bytes: figure(s.cost?.bytes, JOBS_TUNE.STEP_BYTES),
    };
    byKey.set(key, step);
    out.push(step);
  }
  // Every name in `needs` as the keys of this run's steps: its own key, else every step of that command,
  // else nothing at all (it has been run already, or it is not part of this run).
  for (const s of out) {
    const waitFor = new Set();
    for (const need of s.needs) {
      if (byKey.has(need)) waitFor.add(need);
      else for (const other of out) if (other.command === need) waitFor.add(other.key);
    }
    waitFor.delete(s.key);
    s.waitFor = [...waitFor];
  }
  return { steps: out, problems };
}

const names = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : []);
const figure = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback);

/**
 * How long the work behind each step is, itself and everything waiting on it. The longest is started
 * first, which is what keeps the machine busy to the end: a two-hour step started last is two hours
 * during which nothing else is left to run beside it. Steps in a cycle answer with their own length.
 */
export function criticalPaths(steps) {
  const after = new Map(steps.map((s) => [s.key, []]));
  for (const s of steps) for (const k of s.waitFor) after.get(k)?.push(s.key);
  const by = new Map(steps.map((s) => [s.key, s]));
  const path = new Map();
  const busy = new Set();
  const walk = (key) => {
    if (path.has(key)) return path.get(key);
    const s = by.get(key);
    if (!s) return 0;
    if (busy.has(key)) return s.seconds;
    busy.add(key);
    let most = 0;
    for (const next of after.get(key) ?? []) most = Math.max(most, walk(next));
    busy.delete(key);
    const total = s.seconds + most;
    path.set(key, total);
    return total;
  };
  for (const s of steps) walk(s.key);
  return path;
}

// ---------------------------------------------------------------------------------------------
// The run.

/** A file name for a run's own folder of logs: no colons, no spaces, sorts by time. */
export function stamp(when = Date.now()) {
  return new Date(when).toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/** A step's log file name: its place in the run, its command, and anything else that tells it apart. */
export function logName(step, index) {
  const detail = step.args.slice(1).filter((a) => !a.startsWith('--') && !a.includes('/') && !a.includes('\\') && !/^[A-Za-z]:$/.test(a));
  const words = [step.command, ...detail].join('-').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
  return `${String(index).padStart(2, '0')}-${words || 'step'}.log`;
}

/**
 * Starts a conversion and answers at once with the state to watch, a promise that resolves with the
 * summary, and the way to stop it. The caller keeps the promise; the launcher also reads `state` on its
 * own clock and the command-line display reads it every quarter of a second.
 *
 * `cli` is the converter's own `cli.mjs`, run by this very node (`process.execPath`), so a release and a
 * checkout convert with exactly the node they were started with. `spawnStep` is only for the test, which
 * runs a child that sleeps and prints instead of the converter.
 */
export function startConversion({
  steps: given,
  cli,
  outDir = '.',
  logDir = join(outDir, 'logs'),
  jobs = defaultJobs(),
  cwd = process.cwd(),
  env = process.env,
  memoryBudget = totalmem() * JOBS_TUNE.SHARE_MEMORY,
  unreadable = null,
  onEvent = () => {},
  spawnStep = null,
  now = Date.now,
} = {}) {
  const { steps: plan, problems } = normaliseSteps(given);
  const paths = criticalPaths(plan);
  const order = new Map(plan.map((s, i) => [s.key, i]));
  const startedAt = now();
  const runDir = join(logDir, `convert-${stamp(startedAt)}`);
  const state = {
    format: RUN_FORMAT,
    startedAt,
    finishedAt: 0,
    jobs: Math.max(1, Math.floor(jobs) || 1),
    outDir,
    logDir: runDir,
    stopping: false,
    cancelled: false,
    problems,
    movedAside: 0,
    steps: plan.map((s, i) => ({
      key: s.key,
      label: s.label,
      command: s.command,
      args: s.args,
      reason: s.reason,
      status: 'waiting',
      startedAt: 0,
      finishedAt: 0,
      seconds: 0,
      code: null,
      lastLine: '',
      because: '',
      logFile: join(runDir, logName(s, i + 1)),
      weight: s.seconds,
    })),
    totalWeight: plan.reduce((n, s) => n + s.seconds, 0) || 1,
    doneWeight: 0,
  };
  const byKey = new Map(state.steps.map((s) => [s.key, s]));
  const running = new Map(); // key -> { child, log, plan, view, forced }
  // Anything else watching: the display the command line draws, the launcher's page. They are added
  // after the run has been made (the display is drawn from its state), so the first event, which says
  // what the run is, has already gone by the time they arrive; that one is the caller's `onEvent`.
  const listeners = new Set();
  const say = (event) => {
    for (const fn of [onEvent, ...listeners]) {
      try {
        fn(event);
      } catch {
        /* a caller whose display throws never stops the conversion */
      }
    }
  };
  const listen = (fn) => {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  let finish = () => {};
  const done = new Promise((res) => {
    finish = res;
  });
  let over = false;

  mkdirSync(runDir, { recursive: true });
  say({ kind: 'start', jobs: state.jobs, logDir: runDir, steps: state.steps.map((s) => ({ key: s.key, label: s.label, args: s.args, weight: s.weight })), problems: state.problems });

  // A file a killed step left half written: `status` takes it as missing and asks for the step again,
  // but the step may read the old file before it writes a new one, so it is renamed beside itself
  // before anything starts. Never deleted, and never a file outside the converted content.
  let refused = false;
  if (unreadable && unreadable.length) {
    const cut = setAside(unreadable, outDir, (line, level) => say({ kind: 'note', line, level }), startedAt);
    state.movedAside = cut.moved;
    if (cut.failed) {
      refused = true;
      state.problems = [...state.problems, cut.failed];
      for (const s of state.steps) {
        s.status = 'not-run';
        s.because = 'nothing was run';
      }
    }
  }

  /** Whether `s` may start now: the cap, the lone steps, the locks it holds and the memory it wants. */
  const fits = (s) => {
    if (running.size >= state.jobs) return false;
    if (s.alone && running.size > 0) return false;
    for (const r of running.values()) {
      if (r.plan.alone) return false;
      for (const lock of s.locks) if (r.plan.locks.includes(lock)) return false;
    }
    if (running.size === 0) return true; // one step always runs, however large it says it is
    let used = 0;
    for (const r of running.values()) used += r.plan.bytes;
    return used + s.bytes <= memoryBudget;
  };

  /** The steps that could start now, longest work behind them first, then in the plan's own order. */
  const ready = () =>
    plan
      .filter((s) => byKey.get(s.key).status === 'waiting' && s.waitFor.every((k) => byKey.get(k)?.status === 'done'))
      .sort((a, b) => (paths.get(b.key) ?? 0) - (paths.get(a.key) ?? 0) || order.get(a.key) - order.get(b.key));

  /** Marks everything whose work can never be done now: what waited on a step that failed or was skipped. */
  const sweepSkips = () => {
    for (let again = true; again; ) {
      again = false;
      for (const s of plan) {
        const view = byKey.get(s.key);
        if (view.status !== 'waiting') continue;
        const bad = s.waitFor.map((k) => byKey.get(k)).find((w) => w && (w.status === 'failed' || w.status === 'skipped' || w.status === 'stopped' || w.status === 'not-run'));
        if (!bad) continue;
        view.status = 'skipped';
        view.because = bad.status === 'failed' ? `${bad.label} failed, and this needs it` : `${bad.label} did not run, and this needs it`;
        state.doneWeight += view.weight;
        say({ kind: 'step-skip', key: view.key, label: view.label, because: view.because });
        again = true;
      }
    }
  };

  const start = (s) => {
    const view = byKey.get(s.key);
    view.status = 'running';
    view.startedAt = now();
    const log = createWriteStream(view.logFile, { flags: 'a' });
    log.on('error', () => {
      /* a log that cannot be written never stops the conversion */
    });
    log.write(`# ${new Date(view.startedAt).toLocaleString()}\n# ${[cli, ...s.args].join(' ')}\n${view.reason ? `# why: ${view.reason}\n` : ''}\n`);
    const child = (spawnStep ?? spawnConverter)({ cli, args: s.args, cwd, env });
    const entry = { child, log, plan: s, view, forced: null };
    running.set(s.key, entry);
    say({ kind: 'step-start', key: view.key, label: view.label, args: view.args, reason: view.reason, logFile: view.logFile, at: view.startedAt });

    const keep = (kind) => {
      const lines = lineSplitter((line) => {
        view.lastLine = line;
        say({ kind: 'step-line', key: view.key, label: view.label, line, stream: kind });
      });
      return lines;
    };
    const outLines = keep('out');
    const errLines = keep('err');
    child.stdout?.on('data', (d) => {
      log.write(d);
      outLines.push(d);
    });
    child.stderr?.on('data', (d) => {
      log.write(d);
      errLines.push(d);
    });
    // A child that could not be started emits `error` and, depending on what went wrong, may never emit
    // `close`; one that started emits `error` for a kill that failed and closes all the same. So the end
    // is written once, by whichever arrives, and an `error` only ends it when there is no process at all.
    let settled = false;
    child.on('error', (err) => {
      view.lastLine = `could not start: ${err.message}`;
      log.write(`\n# could not start: ${err.message}\n`);
      if (!child.pid) settle(-1, null);
    });
    child.on('close', (code, signal) => settle(code, signal));
    function settle(code, signal) {
      if (settled) return;
      settled = true;
      outLines.end();
      errLines.end();
      if (entry.forced) clearTimeout(entry.forced);
      running.delete(s.key);
      view.finishedAt = now();
      view.seconds = Math.max(0, Math.round((view.finishedAt - view.startedAt) / 1000));
      view.code = code === null || code === undefined ? (signal ? -2 : -1) : code;
      const stopped = state.stopping;
      view.status = stopped ? 'stopped' : view.code === 0 ? 'done' : 'failed';
      state.doneWeight += view.weight;
      log.write(`\n# ${view.status} after ${view.seconds} s (exit ${view.code}${signal ? `, ${signal}` : ''})\n`);
      log.end();
      say({ kind: 'step-end', key: view.key, label: view.label, code: view.code, seconds: view.seconds, status: view.status, logFile: view.logFile });
      pump();
    }
  };

  /** Starts whatever can be started, and ends the run when nothing is running and nothing can be. */
  const pump = () => {
    if (over) return;
    if (!state.stopping && !refused) {
      sweepSkips();
      for (;;) {
        const next = ready().find(fits);
        if (!next) break;
        start(next);
      }
    }
    if (running.size) return;
    if (state.stopping || refused) {
      for (const s of state.steps) {
        if (s.status !== 'waiting') continue;
        s.status = 'not-run';
        s.because = state.stopping ? 'the conversion was stopped before it ran' : 'nothing was run';
      }
    } else {
      // Nothing is running and nothing could start, so what is left can never run: a step whose order
      // could not be worked out, which is a plan that says A waits for B while B waits for A.
      for (const s of state.steps) {
        if (s.status !== 'waiting') continue;
        s.status = 'skipped';
        s.because = 'its order could not be worked out';
        state.doneWeight += s.weight;
        say({ kind: 'step-skip', key: s.key, label: s.label, because: s.because });
      }
    }
    end();
  };

  const end = () => {
    if (over) return;
    over = true;
    state.finishedAt = now();
    const summary = summarise(state);
    try {
      writeFileSync(join(runDir, 'summary.txt'), `${summaryLines(summary).join('\n')}\n`);
    } catch {
      /* the summary is on the screen either way */
    }
    say({ kind: 'end', summary });
    finish(summary);
  };

  const stop = () => {
    if (over) return;
    if (state.stopping) {
      for (const r of running.values()) r.child.kill('SIGKILL');
      return;
    }
    state.stopping = true;
    state.cancelled = true;
    say({ kind: 'stopping', running: [...running.keys()] });
    if (!running.size) {
      pump();
      return;
    }
    for (const r of running.values()) {
      r.child.kill();
      r.forced = setTimeout(() => {
        try {
          r.child.kill('SIGKILL');
        } catch {
          /* it went on its own */
        }
      }, JOBS_TUNE.KILL_GRACE_MS);
      r.forced.unref?.();
    }
  };

  queueMicrotask(pump);
  return { state, done, stop, listen };
}

/**
 * Ctrl+C, in one place rather than in every caller. The first press stops the run: the children are
 * told to go, what they had done stays done, and the summary says what was finished and what was not.
 * A second press kills them outright. The run ends by itself either way, so nothing here exits the
 * process; the caller decides what to do with the summary it is handed. `on`/`off` are the test's.
 */
export function stopOnSignals(run, { signals = ['SIGINT', 'SIGTERM'], on = (s, f) => process.on(s, f), off = (s, f) => process.off(s, f), say = () => {} } = {}) {
  let pressed = 0;
  const handler = () => {
    pressed += 1;
    say(pressed === 1 ? 'Stopping: the steps running are being told to stop. Press again to end them outright.' : 'Ending the steps running outright.');
    run.stop();
  };
  for (const s of signals) on(s, handler);
  let letGo = false;
  return () => {
    if (letGo) return;
    letGo = true;
    for (const s of signals) off(s, handler);
  };
}

/** The whole thing as one call, for a caller that wants nothing but the summary. */
export async function runConversion(options) {
  return startConversion(options).done;
}

/** One step as a child of this very node running the converter's own command line. */
function spawnConverter({ cli, args, cwd, env }) {
  return spawn(process.execPath, [cli, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Bytes in, whole lines out, with whatever is left when the stream ends. */
export function lineSplitter(onLine) {
  let held = '';
  return {
    push(chunk) {
      held += chunk.toString();
      const parts = held.split(/\r?\n/);
      held = parts.pop() ?? '';
      for (const line of parts) if (line.trim()) onLine(line.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trimEnd());
    },
    end() {
      if (held.trim()) onLine(held.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trimEnd());
      held = '';
    },
  };
}

// ---------------------------------------------------------------------------------------------
// What became of it.

/** What the run came to: the lists a caller reports, and whether it is to be called a success. */
export function summarise(state) {
  const pick = (status) => state.steps.filter((s) => s.status === status).map((s) => ({ key: s.key, label: s.label, args: s.args, code: s.code, seconds: s.seconds, because: s.because, logFile: s.logFile }));
  const failed = pick('failed');
  const stopped = pick('stopped');
  const notRun = pick('not-run');
  const skipped = pick('skipped');
  const converted = pick('done');
  return {
    format: RUN_FORMAT,
    // A run is a success only when every step it was given was run and came back with nothing to say.
    // A note in `problems` (the plan asked for one step twice) is not a failure and does not count.
    ok: !failed.length && !skipped.length && !stopped.length && !notRun.length && !state.cancelled,
    cancelled: state.cancelled,
    seconds: Math.max(0, Math.round(((state.finishedAt || Date.now()) - state.startedAt) / 1000)),
    logDir: state.logDir,
    movedAside: state.movedAside,
    problems: state.problems,
    done: converted,
    failed,
    skipped,
    stopped,
    notRun,
  };
}

/** The summary in plain sentences, which is what the command line prints and the launcher's page shows. */
export function summaryLines(summary) {
  const lines = [];
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  for (const p of summary.problems) lines.push(p);
  if (summary.cancelled) lines.push(`Stopped after ${words(summary.seconds)}.`);
  lines.push(`${count(summary.done.length, 'step', 'steps')} converted in ${words(summary.seconds)}.`);
  for (const s of summary.done) lines.push(`  ${s.label}: ${words(s.seconds)}`);
  if (summary.stopped.length) lines.push(`${count(summary.stopped.length, 'step was', 'steps were')} stopped part way: ${summary.stopped.map((s) => s.label).join(', ')}. Running convert again carries on from what status says is done.`);
  if (summary.failed.length) {
    lines.push(`${count(summary.failed.length, 'step', 'steps')} failed:`);
    for (const s of summary.failed) lines.push(`  ${s.label} (exit ${s.code}) -- ${s.logFile}`);
  }
  if (summary.skipped.length) {
    lines.push(`${count(summary.skipped.length, 'step was', 'steps were')} not run:`);
    for (const s of summary.skipped) lines.push(`  ${s.label}: ${s.because}`);
  }
  if (summary.notRun.length) lines.push(`${count(summary.notRun.length, 'step', 'steps')} had not started: ${summary.notRun.map((s) => s.label).join(', ')}.`);
  lines.push(`The full output of every step is in ${summary.logDir}.`);
  return lines;
}

/** A length of time in words: 45 s, 12m 05s, 2h 10m. */
export function words(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/** mm:ss, for a step that is running now. */
function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------
// The display: one block of lines that is rewritten in place, so ten children do not shout at once.

/**
 * The display as lines, clipped to the width. Pure, so the test reads it rather than a terminal: a
 * heading, a bar with the time gone and a rough guess at what is left, a line per step running with how
 * long it has taken and the last thing it printed, and a tail counting what is done, failed and left.
 */
export function displayLines(state, width = 80, at = Date.now()) {
  const w = Math.max(24, Math.floor(width));
  const cut = (line) => (line.length <= w ? line : `${line.slice(0, w - 1)}…`);
  const running = state.steps.filter((s) => s.status === 'running');
  const done = state.steps.filter((s) => s.status === 'done').length;
  const failed = state.steps.filter((s) => s.status === 'failed').length;
  const skipped = state.steps.filter((s) => s.status === 'skipped' || s.status === 'not-run').length;
  const left = state.steps.length - done - failed - skipped - running.length;
  const share = Math.max(0, Math.min(1, state.doneWeight / (state.totalWeight || 1)));
  const gone = (at - state.startedAt) / 1000;
  const lines = [];
  lines.push(cut(`Converting into ${state.outDir} -- ${done + failed + skipped} of ${state.steps.length} steps, ${running.length} running of ${state.jobs}`));
  const bars = Math.max(10, Math.min(30, w - 40));
  const filled = Math.round(share * bars);
  // The word that matters most is put on the bar rather than at the end of the heading, which is as long
  // as the folder's name and is the line a narrow window clips.
  lines.push(cut(`[${'#'.repeat(filled)}${'-'.repeat(bars - filled)}] ${String(Math.round(share * 100)).padStart(3)}%  ${state.stopping ? 'stopping; ' : ''}${words(gone)} gone${state.stopping ? '' : `, about ${words(guessLeft(state, gone))} left`}`));
  const name = Math.min(24, Math.max(8, ...running.map((s) => s.label.length), 8));
  for (const s of running) lines.push(cut(`  ${s.label.padEnd(name).slice(0, name)}  ${clock((at - s.startedAt) / 1000)}  ${s.lastLine}`));
  const tail = [];
  if (done) tail.push(`${done} done`);
  if (failed) tail.push(`${failed} failed`);
  if (skipped) tail.push(`${skipped} not run`);
  if (left) tail.push(`${left} waiting`);
  if (tail.length) lines.push(cut(`  ${tail.join(' . ')}`));
  return lines;
}

/**
 * Roughly how much longer, from the work left and how fast the work done has gone. It is a guess and
 * says so on the screen: the point is that a person watching for hours can tell an hour from a minute.
 */
export function guessLeft(state, gone) {
  const share = Math.max(0, Math.min(1, state.doneWeight / (state.totalWeight || 1)));
  const leftWeight = Math.max(0, state.totalWeight - state.doneWeight);
  const running = state.steps.filter((s) => s.status === 'running').length || 1;
  // Until a step has finished there is nothing measured to guess from, so the plan's own figures are
  // taken at face value, shared over the jobs that are running.
  if (share <= 0 || gone <= 0) return leftWeight / Math.max(1, Math.min(state.jobs, running));
  return (gone / share) * (1 - share);
}

/**
 * Draws the display on a terminal, redrawing in place a few times a second; on anything that is not a
 * terminal (a pipe, the launcher, a log) it prints a line as each step starts and ends instead, since
 * rewriting in place there would leave a screenful of cursor moves in the file.
 *
 * Handed a whole run it listens to it itself and lets go when it stops, which is the only order that
 * works: the display is drawn from the run's state, so it cannot exist until the run does, and a caller
 * that had to hand it in as `onEvent` would be naming it before it was made.
 */
export function startDisplay(run, { stream = process.stdout, hz = 4 } = {}) {
  const state = run?.state ?? run;
  const tty = Boolean(stream.isTTY);
  let drawn = 0;
  let last = '';
  const width = () => (stream.columns && stream.columns > 24 ? stream.columns : 100);
  const draw = () => {
    const lines = displayLines(state, width());
    const text = lines.join('\n');
    if (text === last && drawn === lines.length) return;
    last = text;
    let out = '';
    if (drawn) out += `\u001b[${drawn}A`;
    for (let i = 0; i < Math.max(drawn, lines.length); i++) out += `\u001b[2K${lines[i] ?? ''}\n`;
    if (lines.length < drawn) out += `\u001b[${drawn - lines.length}A`;
    drawn = lines.length;
    stream.write(out);
  };
  let timer = null;
  if (tty) {
    stream.write('\u001b[?25l');
    timer = setInterval(draw, Math.max(100, Math.round(1000 / hz)));
    timer.unref?.();
  }
  const handle = tty
    ? {
        event() {},
        stop() {
          clearInterval(timer);
          draw();
          stream.write('\u001b[?25h');
        },
      }
    : {
        event(e) {
          if (e.kind === 'step-start') stream.write(`--- ${e.label} started\n`);
          if (e.kind === 'step-end') stream.write(`--- ${e.label} ${e.status} after ${words(e.seconds)}${e.status === 'done' ? '' : ` (exit ${e.code}; ${e.logFile})`}\n`);
          if (e.kind === 'step-skip') stream.write(`--- ${e.label} not run: ${e.because}\n`);
        },
        stop() {},
      };
  // Handed a run rather than bare state, the display takes its own events and gives them back when it
  // stops, so nothing outside has to remember to unsubscribe it.
  const drop = typeof run?.listen === 'function' ? run.listen((e) => handle.event(e)) : () => {};
  const stop = handle.stop;
  handle.stop = () => {
    drop();
    stop();
  };
  return handle;
}
