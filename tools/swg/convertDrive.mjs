// One conversion, from "what is missing" to the last child ending: the driver that `npm run swg --
// convert` and the launcher's Convert button both run, so there is one set of rules and neither can
// drift from the other.
//
// It holds no list of conversions and settles no order of its own. Three modules do the work and this
// one only joins them up:
//
//   - `status --json` (the converter's own) says what is missing, and is the only truth about what is
//     done: nothing is remembered between runs, which is what makes stopping free and resuming exact;
//   - `convertPlan.mjs` turns that into steps with what each one waits for, what it may not run beside
//     and roughly what it costs;
//   - `convertRun.mjs` runs those steps as children of this very node, several at once, and says what
//     became of each.
//
// Then it asks `status` again. A pass can leave work behind that only becomes askable once another pack
// exists (the ships are asked for again once the astromechs are there), so the passes go round until
// `status` asks for nothing, or asks only for things it asked for before running them -- which is a
// step that cannot be satisfied here, and is reported rather than run for ever.
//
// Two things follow from the passes, and both are this module's to answer because neither the plan nor
// the runner can see more than the one list it was handed:
//
//   - **one round's list is not the whole conversion.** `status` asks only for work whose own
//     preconditions are already there: it cannot ask for the character's parts before the player pack
//     exists, nor for the clip pair before the parts rig does. Both the plan (`waitsFor`) and the
//     runner (`normaliseSteps`) read "a command this list does not name" as "a command that has been
//     run", which is right for one complete list and wrong for a partial one -- and the very first
//     conversion on a new machine is partial. So a step is held back here until everything it reads is
//     really there (`groundSteps`), and the round after runs it.
//   - **some work `status` cannot ask for at all** until another pack names it: the wardrobes are
//     asked for out of the mobiles catalogue, which does not exist yet, and the loading pictures are
//     never asked for. The command hands those in as `seeds`, which join what `status` asked before
//     anything is planned, so the order and the waiting are worked out over one list as they always
//     were.
//
// Every number in here is ours.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readStatus, runnableSteps } from '../launcher/plan.mjs';
import { criticalPaths, defaultJobs, jobsFor, normaliseSteps, startConversion, startDisplay, words } from './convertRun.mjs';

/** The runner's own moving display, through this one door, so a caller loads one module and not three. */
export { startDisplay };

/**
 * What `--jobs=` comes to, and this machine's own figure: the runner's, re-exported so that the command
 * line, the launcher and this driver cannot each have their own idea of what `--jobs=0` means. Every
 * door passes what it was given straight to `runConvert`, which puts it through `jobsFor` once.
 */
export { defaultJobs, jobsFor };

/** Bumped when the shape of an event or of the result changes in a way a caller must know about. */
export const DRIVE_FORMAT = 1;

export const DRIVE_TUNE = {
  /**
   * How many times round the "run what is missing, then ask again" loop before it gives up and says so.
   *
   * A first conversion needs four or five, and not because anything goes wrong: `status` cannot ask for
   * a step until what it reads exists, so the list grows a round at a time. The planets' packs make the
   * ground, sky, water and places askable; the player pack makes the parts askable; the parts rig makes
   * the clip pair askable; and only then can the species, the mobiles, the ships and the sounds run in
   * that order. One more round finds nothing missing and ends it. This is the backstop for a plan that
   * never settles, which is worth saying out loud rather than running all night.
   */
  MAX_PASSES: 10,
};

// ---------------------------------------------------------------------------------------------
// The two modules this one leans on.

/**
 * The plan module, loaded when it is wanted rather than imported, so every other converter command
 * carries none of it and a checkout without it says which file is missing instead of failing to parse.
 */
export async function loadPlan() {
  try {
    return await import('./convertPlan.mjs');
  } catch (err) {
    throw new Error(`the conversion plan (tools/swg/convertPlan.mjs) could not be loaded: ${err.message}`);
  }
}

/**
 * A step as the plan hands it over, as the runner reads it. The two were written apart, so this is the
 * one place their spellings meet: what a step waits for may be called `needs` (command names) or
 * `after` (the keys those names came to), and a memory figure may be in megabytes or in bytes. A step
 * the plan marked `skip` never reaches the runner at all, because it is not work that failed: it is
 * work this machine cannot do (no Jedi Academy folder), and saying so once is the whole of it.
 */
export function stepsForRunner(planned) {
  const list = Array.isArray(planned) ? planned : (planned?.steps ?? []);
  const run = [];
  const skipped = [];
  for (const s of list) {
    if (!s || !Array.isArray(s.args) || !s.args.length) continue;
    const args = s.args.filter((a) => typeof a === 'string');
    if (!args.length) continue;
    const base = {
      key: typeof s.key === 'string' && s.key ? s.key : args.join('\u0000'),
      label: typeof s.label === 'string' && s.label ? s.label : args[0],
      command: typeof s.command === 'string' && s.command ? s.command : args[0],
      args,
      reason: typeof s.reason === 'string' ? s.reason : '',
    };
    if (s.skip) {
      skipped.push({ ...base, because: String(s.skip) });
      continue;
    }
    const mb = s.cost?.memoryMb;
    run.push({
      ...base,
      needs: (s.needs?.length ? s.needs : s.after) ?? [],
      locks: s.locks ?? [],
      alone: s.alone === true,
      cost: { seconds: s.cost?.seconds, bytes: s.cost?.bytes ?? (Number.isFinite(mb) ? mb * 1024 ** 2 : undefined) },
    });
  }
  return { run, skipped };
}

/**
 * Which of a round's steps may be started now, and which must wait for the round after.
 *
 * A step declares the commands whose output it reads (`needs`). Over one complete list a name that is
 * no step of the list means that work has been done, which is what the plan and the runner both take
 * it to mean. Over a round of asking it can also mean that `status` could not see far enough to ask
 * for it yet, and starting the step anyway writes a pack that is quietly wrong: a species rig with no
 * Jedi Academy clips on it, a character index naming no wardrobes, NPCs dressed from wardrobes that
 * are not there. Nothing later notices, because the file exists and `status` asks no more.
 *
 * So a command counts as done only when it ran in this drive, or when `status` did not ask for it and
 * everything *it* reads is itself done -- an untouched `status` that can see a command and says
 * nothing about it is the converter saying that command is in place. Anything else holds the step.
 *
 * A command `status` is asking for that this run will not run (`--only` left it out, or this machine
 * cannot do it) is a third case and is neither held nor silent: the player asked for exactly this
 * step, so it runs and the fact is said out loud, once, per step and per command dropped.
 *
 * `holdBack` false is `--only`'s own case, where nothing is ever held: the rounds that would fill a
 * gap have been asked for by name and there are no others, so a step held there is a step that never
 * runs at all. Everything unsatisfied is then said rather than waited for, which is what `--only`
 * means -- run this, I know what I am doing.
 */
export function groundSteps(offered, { asked = [], ranOk = new Set(), needsOf = () => [], holdBack = true } = {}) {
  const steps = offered ?? [];
  const here = new Map();
  const byKey = new Map();
  for (const s of steps) {
    if (!here.has(s.command)) here.set(s.command, []);
    here.get(s.command).push(s);
    byKey.set(s.key, s);
  }
  // A need is a command name, and a plan that spells one as another step's own key is read the same way.
  const stepsOf = (need) => (byKey.has(need) ? [byKey.get(need)] : (here.get(need) ?? []));
  const wanted = new Set(asked);
  const known = new Map();
  const settled = (command) => {
    if (ranOk.has(command)) return true;
    // A step of this round, or one asked for and left out of it: either way it is not done.
    if (here.has(command) || wanted.has(command)) return false;
    const had = known.get(command);
    if (had !== undefined) return had;
    // The guard for a command that reads itself: unsettled while it is being worked out, so a ring of
    // them holds rather than calls itself done.
    known.set(command, false);
    const all = (needsOf(command) ?? []).every((n) => settled(n));
    known.set(command, all);
    return all;
  };

  const holdFor = new Map();
  const waitsHere = new Map();
  const without = [];
  for (const s of steps) {
    const waits = [];
    const missing = [];
    const dropped = [];
    for (const need of s.needs ?? []) {
      if (need === s.command || need === s.key) continue;
      if (stepsOf(need).length) waits.push(need);
      else if (ranOk.has(need)) continue;
      else if (wanted.has(need)) dropped.push(need);
      else if (!settled(need)) missing.push(need);
    }
    waitsHere.set(s.key, waits);
    if (missing.length && holdBack) holdFor.set(s.key, [...new Set(missing)]);
    const said = holdBack ? dropped : [...dropped, ...missing];
    if (said.length) without.push({ key: s.key, label: s.label, command: s.command, commands: [...new Set(said)] });
  }
  // A step waiting on a step of this round that is itself held waits just as long: the holds spread
  // until nothing changes, so nothing is ever started for a step that will not be run beside it.
  for (let again = true; again; ) {
    again = false;
    for (const s of steps) {
      if (holdFor.has(s.key)) continue;
      const blocked = (waitsHere.get(s.key) ?? []).filter((n) => stepsOf(n).every((o) => holdFor.has(o.key)));
      if (!blocked.length) continue;
      holdFor.set(s.key, [...new Set(blocked)]);
      again = true;
    }
  }
  return {
    run: steps.filter((s) => !holdFor.has(s.key)),
    held: steps.filter((s) => holdFor.has(s.key)).map((s) => ({ ...s, waitingFor: holdFor.get(s.key) })),
    without,
  };
}

/**
 * The commands `status` cannot ask for yet: everything the plan knows of that this round does not name
 * and that is not settled, which is to say everything waiting on a pack this round has still to write.
 * It is what makes a dry run honest -- the round it prints is not the conversion -- and it is worked
 * out from the plan's own facts, so a command added there appears here with nothing done about it.
 */
export function notYetAskable(planner, { asked = [], ranOk = new Set() } = {}) {
  const facts = planner?.STEP_FACTS;
  if (!facts) return [];
  const needsOf = (c) => planner.factsFor?.(c)?.needs ?? facts[c]?.needs ?? [];
  const wanted = new Set(asked);
  const known = new Map();
  const settled = (command) => {
    if (ranOk.has(command)) return true;
    if (wanted.has(command)) return false;
    const had = known.get(command);
    if (had !== undefined) return had;
    known.set(command, false);
    const all = needsOf(command).every((n) => settled(n));
    known.set(command, all);
    return all;
  };
  const out = [];
  for (const command of Object.keys(facts)) {
    if (wanted.has(command) || settled(command)) continue;
    const seconds = planner.costOf?.(command, [command])?.seconds ?? facts[command]?.seconds ?? 0;
    out.push({ command, seconds });
  }
  return out;
}

/**
 * The work `status` has no way of asking for, in `status`'s own shape, asked of the converted folder
 * itself before every round. Two kinds, and both of them are the converter's own reading rather than a
 * second list of commands:
 *
 *   - **the wardrobes.** `status` asks for a wardrobe run only out of the mobiles catalogue, which
 *     names the folders its NPCs' outfits wear from (`cli.mjs`'s mobiles block), so on a machine that
 *     has not converted the mobiles yet it cannot ask for one at all -- while the character index names
 *     each species' wardrobe folder from what is on disk when it is written, the NPCs are dressed from
 *     them and the backpack shows them. Run only when the folder's own `wardrobe.json` is not there,
 *     and each line is built from the converter's own table of runs, the one the `status` case asks
 *     with.
 *   - **the loading pictures.** `status` has never asked for them; the README's own list has always
 *     had them, and without them a planet is drawn from its sky colours.
 *
 * A seed disappears the moment what it writes is on disk, so nothing is ever run twice for it, and
 * anything `status` is already asking for is dropped before planning rather than planned twice.
 */
export async function defaultSeeds(out) {
  const { existsSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { WARDROBE_RUNS } = await import('./mobiles.mjs');
  // The folder as `status` writes it into its own steps, so a seed and an asking of the same run come
  // out character for character the same.
  const dir = resolve(out);
  const steps = [];
  for (const [folder, extra] of Object.entries(WARDROBE_RUNS)) {
    if (existsSync(join(dir, 'wardrobe', folder, 'wardrobe.json'))) continue;
    steps.push({
      args: ['wardrobe', '@SWG', dir, '--retail-only', ...extra.split(' ').filter(Boolean)],
      reason: `wardrobe/${folder} has not been converted, and the character index, the NPCs' outfits and the backpack read it`,
    });
  }
  if (!existsSync(join(dir, 'loading', 'index.json'))) {
    steps.push({
      args: ['loading', '@SWG', dir, '--retail-only'],
      reason: "the game's own loading pictures are missing (without them a planet is drawn from its sky colours)",
    });
  }
  return steps.map((s) => ({ ...s, command: s.args[0], jka: null }));
}

/**
 * What tells one run of a command from another: the command and the options on it. The folders are left
 * out on purpose, so that a seed and an asking of the same run are one whatever either of them spells
 * the output folder as.
 */
function runKey(args) {
  const list = args ?? [];
  return [list[0], ...list.slice(1).filter((a) => a.startsWith('--')).sort()].join(' ');
}

/** The converter's own command line as a child of this very node. */
function spawnConverter({ cli, args, cwd, env }) {
  return spawn(process.execPath, [cli, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * The launcher starts a child its own way (the exe told which file to run), so it hands its
 * `childCommand` over and this makes the runner's kind of starter out of it.
 */
export function spawnByCommand(childCommand) {
  return ({ cli, args, cwd, env }) => {
    const c = childCommand(cli, args);
    return spawn(c.command, c.args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  };
}

/** `status <out> --json` as a child, its JSON read as the launcher has always read it. */
export async function askStatus({ cli, out, cwd = process.cwd(), env = process.env, spawnStep = null }) {
  const child = (spawnStep ?? spawnConverter)({ cli, args: ['status', out, '--json'], cwd, env });
  let text = '';
  const errs = [];
  child.stdout?.on('data', (d) => (text += d.toString()));
  child.stderr?.on('data', (d) => errs.push(d.toString()));
  const code = await new Promise((res) => {
    child.on('error', (err) => {
      errs.push(err.message);
      res(-1);
    });
    child.on('close', (c, signal) => res(c ?? (signal ? -2 : -1)));
  });
  if (code !== 0) {
    const last = errs.join('').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
    throw new Error(last || `status ended with ${code}`);
  }
  return readStatus(text);
}

// ---------------------------------------------------------------------------------------------
// The plan in words, for --dry-run and for the launcher's log.

/**
 * What a lock is, in words. The plan's lock names are its own bookkeeping (`pack:*`, `zone:tatooine`,
 * `wardrobe:human_female`); a line meant to be read by a person says what the lock stands for, which is
 * a folder two steps would both write.
 */
function lockWords(locks) {
  const out = [];
  for (const lock of locks ?? []) {
    const [kind, which] = lock.split(':');
    const word = !which ? `the ${kind} folder` : kind === 'pack' ? (which === '*' ? 'a planet pack' : `${which}'s pack`) : kind === 'zone' ? (which === '*' ? 'a space zone' : `the ${which} zone`) : kind === 'wardrobe' ? `the wardrobe/${which} folder` : `the ${which} folder`;
    if (!out.includes(word)) out.push(word);
  }
  // A step that holds every planet pack holds each of them too; saying both is saying it twice.
  const without = (all, one) => [one, ...out.filter((w) => w !== one && !all(w))];
  if (out.includes('a planet pack')) return without((w) => w.endsWith("'s pack"), 'a planet pack');
  if (out.includes('a space zone')) return without((w) => w.startsWith('the ') && w.endsWith(' zone'), 'a space zone');
  return out;
}

/**
 * What would be run, in what order, and what may run beside what. The order is the runner's own (the
 * longest work behind a step first), so what is printed is what would really happen rather than a second
 * guess at it.
 *
 * It is one round of asking and says so: `extra.held` are this round's steps that wait for a later one,
 * `extra.later` the commands `status` cannot ask for at all until these packs exist, and
 * `extra.without` the dependencies `--only` left out of a step that is being run all the same.
 */
export function describePlan(steps, jobs = defaultJobs(), total = null, extra = {}) {
  const { steps: plan, problems } = normaliseSteps(steps);
  const paths = criticalPaths(plan);
  const order = new Map(plan.map((s, i) => [s.key, i]));
  const labels = new Map(plan.map((s) => [s.key, s.label]));
  const without = new Map((extra.without ?? []).map((w) => [w.key, w.commands]));
  const sorted = [...plan].sort((a, b) => (paths.get(b.key) ?? 0) - (paths.get(a.key) ?? 0) || order.get(a.key) - order.get(b.key));
  const lines = [`${plan.length} step${plan.length === 1 ? '' : 's'} in this round, up to ${jobs} at once:`];
  for (const s of sorted) {
    const waits = s.waitFor.map((k) => labels.get(k) ?? k);
    const after = waits.length ? `, after ${waits.join(' and ')}` : '';
    const held = lockWords(s.locks);
    const alone = s.alone ? ', alone' : held.length ? `, never beside another step that writes ${held.join(' or ')}` : '';
    lines.push(`  ${s.label} -- about ${words(s.seconds)}${after}${alone}`);
    lines.push(`      swg ${s.args.join(' ')}`);
    if (s.reason) lines.push(`      why: ${s.reason}`);
    const dropped = without.get(s.key);
    if (dropped) lines.push(`      note: run without ${dropped.join(' and ')}, which it reads`);
  }
  for (const p of problems) lines.push(`  ${p}`);
  // The plan's own reckoning of this round, which knows what waits for what; it is a guess made of
  // guesses and says so, but it is the difference between "go and make tea" and "go to bed".
  if (Number.isFinite(total) && total > 0) lines.push(`Roughly ${words(total)} for this round with ${jobs} at once, if nothing goes wrong.`);
  // And the part no round can price: what this round cannot even be asked about yet.
  const held = extra.held ?? [];
  const later = extra.later ?? [];
  if (held.length) {
    lines.push(`${held.length} step${held.length === 1 ? '' : 's'} of this round ${held.length === 1 ? 'waits' : 'wait'} for work it has still to do, and ${held.length === 1 ? 'runs' : 'run'} in a later round:`);
    for (const s of held) lines.push(`  ${s.label} -- waits for ${s.waitingFor.join(' and ')}`);
  }
  if (later.length) {
    const more = later.reduce((n, c) => n + (c.seconds ?? 0), 0);
    // "until this round's work is done" rather than "until these packs exist": on a first conversion
    // the packs really are not there, but on a top-up they are and the question is only whether this
    // round's work makes `status` ask about them again (the ships once the astromechs have changed).
    lines.push(`This is one round of asking, not the whole conversion: ${later.length} more command${later.length === 1 ? '' : 's'} (${later.map((c) => c.command).join(', ')}) cannot be asked for until this round's work is done, about ${words(more)} more of work between them.`);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// The run.

/**
 * Converts until `status` asks for nothing, and answers what became of it.
 *
 * `cli` is the converter's own `cli.mjs` and every step is another run of it; `out` is where the
 * converted content goes; `swg` and `jka` are the two installs (found and checked before this is
 * called). `onEvent` is how a caller follows it without reading anybody's words: `status`, `plan`,
 * `pass`, `step-start`, `step-line`, `step-end`, `step-skip`, `stopping`, `pass-end` and `note`, the
 * middle ones exactly as the runner emits them. `onPass` is handed each pass's live state, which is
 * what the command line draws its display from.
 *
 * `seeds` is the work `status` cannot ask for -- a function of the output folder answering steps in
 * `status`'s own shape, asked again every pass, so the wardrobes it hands in stop being handed in once
 * they are on disk. They join what `status` asked before anything is planned.
 *
 * `plan`, `startRun`, `status` and `spawnStep` are seams for the test, which drives the whole thing
 * with a plan of its own and children that sleep and print.
 */
export async function runConvert({
  cli,
  out,
  swg = '',
  jka = '',
  jobs = null,
  only = null,
  seeds = defaultSeeds,
  dryRun = false,
  logsDir = null,
  cwd = process.cwd(),
  env = process.env,
  childCommand = null,
  spawnStep = null,
  signal = null,
  onEvent = () => {},
  onPass = () => {},
  plan = null,
  startRun = startConversion,
  status = askStatus,
  maxPasses = DRIVE_TUNE.MAX_PASSES,
  now = Date.now,
} = {}) {
  const planner = plan ?? (await loadPlan());
  const starter = spawnStep ?? (childCommand ? spawnByCommand(childCommand) : null);
  const say = (event) => {
    try {
      onEvent(event);
    } catch {
      /* a caller whose display throws never stops the conversion */
    }
  };
  const startedAt = now();
  const wanted = only && only.length ? only : null;
  // One answer to "how many at once" for the command line, the launcher and this: whatever each of them
  // was given goes through the runner's own `jobsFor`, which is where a 0, a word or a 64 is decided.
  const atOnce = jobsFor(jobs);
  const needsOf = (command) => planner.factsFor?.(command)?.needs ?? [];

  // What has been run in this drive: key to { runs, reason, failed }, which is how a step that `status`
  // keeps asking for after it has run is told from one that is genuinely still to do.
  const history = new Map();
  // And the same by command, which is what a step's `needs` are spelled in: a command that really ran
  // here is the one thing a later round may take as done without asking the converter about it.
  const ranOk = new Set();
  const done = [];
  const failed = [];
  const skipped = [];
  const notRun = [];
  const stuck = [];
  const logDirs = [];
  const saidNotes = new Set();
  let waiting = [];
  let passes = 0;
  let cancelled = false;
  let everythingDone = false;
  let ranOut = false;
  const add = (list, step) => {
    if (!list.some((x) => x.key === step.key)) list.push(step);
  };
  const once = (line, level = 'note') => {
    if (saidNotes.has(line)) return;
    saidNotes.add(line);
    say({ kind: 'note', line, level });
  };
  /** The work `status` cannot ask for, asked again every pass; a seed that throws costs its own step. */
  const seedSteps = async () => {
    try {
      const list = typeof seeds === 'function' ? await seeds(out) : seeds;
      return (Array.isArray(list) ? list : []).filter((s) => Array.isArray(s?.args) && s.args.length);
    } catch (err) {
      once(`what else to convert could not be worked out (${err.message}); only what status asks for is being run`, 'bad');
      return [];
    }
  };

  for (;;) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    if (passes >= maxPasses) {
      ranOut = true;
      break;
    }
    const answered = await status({ cli, out, cwd, env, spawnStep: starter });
    // What `status` asked, and beside it the work it has no way of asking for: the wardrobes, which it
    // reads out of a mobiles catalogue that does not exist yet, and the loading pictures, which it never
    // asks for at all. A seed already asked for is dropped rather than planned twice.
    const askedKeys = new Set((answered.steps ?? []).map((s) => runKey(s.args)));
    const sown = (await seedSteps()).filter((s) => !askedKeys.has(runKey(s.args)));
    const asked = { ...answered, done: answered.done && !sown.length, steps: [...(answered.steps ?? []), ...sown] };
    waiting = [];
    say({ kind: 'status', pass: passes + 1, done: asked.done, steps: asked.steps.length, seeded: sown.length, unreadable: asked.unreadable ?? [] });
    if (asked.done) {
      everythingDone = true;
      break;
    }
    // Every command this round is about, whether or not it is being run: what `--only` left out and what
    // this machine cannot do are both in here, and neither may be read as work that has been done.
    const askedCommands = new Set(asked.steps.map((s) => (s.args ?? [])[0]).filter(Boolean));
    const made = planner.convertPlan(asked, { swg, jka, out, only: wanted });
    const { run: planned, skipped: cannot } = stepsForRunner(made);
    for (const s of cannot) {
      if (wanted && !wanted.includes(s.command)) continue;
      if (!skipped.some((x) => x.key === s.key)) {
        skipped.push(s);
        say({ kind: 'step-skip', key: s.key, label: s.label, because: s.because });
      }
    }
    // What the plan itself wants said (a command it has never heard of and so runs alone, steps that
    // wait for each other). A note about a step left out is dropped: that step has just been reported
    // in its own words, and the same thing said twice reads as two different things.
    for (const line of made?.notes ?? []) {
      if (saidNotes.has(line) || cannot.some((s) => line.includes(s.because))) continue;
      saidNotes.add(line);
      say({ kind: 'note', line });
    }
    // `--only` is honoured here as well as passed on, so a plan that does not read it still cannot run
    // a step the player did not ask for.
    const offered = wanted ? planned.filter((s) => wanted.includes(s.command)) : planned;
    // And then the one thing only this module can see: a round of asking is not the whole conversion,
    // so a step whose declared needs name work this round has not reached waits for the round after
    // rather than writing a pack that is quietly wrong.
    const ground = groundSteps(offered, { asked: askedCommands, ranOk, needsOf, holdBack: !wanted });
    for (const w of ground.without) {
      // A dependency the player themselves left out with `--only`, or one this machine cannot run: the
      // step is run, because it is the step that was asked for, and the fact is said rather than hidden.
      // Unless the plan has just said it in its own words: the same thing twice reads as two things.
      const missing = w.commands.filter((c) => !(made?.notes ?? []).some((n) => n.includes(c) && n.includes(w.command)));
      if (!missing.length) continue;
      const why = wanted ? '--only left it out of this run' : 'it is not being run here';
      once(`${w.label} is being run without ${missing.join(' and ')}, which it reads: ${why}`, 'bad');
    }
    for (const s of ground.held) once(`${s.label} waits for ${s.waitingFor.join(' and ')}, which this round of asking has not reached; it runs in a later round`);
    const nowStuck = [];
    const toRun = runnableSteps(ground.run, history, nowStuck);
    for (const s of nowStuck) add(stuck, s);
    if (dryRun) {
      // The runner's own reading of the steps, so what is printed is the run that would happen: two
      // steps that came out the same are one here as they would be there. What is printed is one round
      // of asking and says so, with what waits for a later round and what cannot be asked for yet.
      const { steps: unique } = normaliseSteps(toRun);
      const later = notYetAskable(planner, { asked: askedCommands, ranOk });
      const lines = describePlan(toRun, atOnce, made?.seconds ?? null, { held: ground.held, without: ground.without, later });
      say({ kind: 'plan', steps: unique, jobs: atOnce, seconds: made?.seconds ?? null, lines, held: ground.held, later });
      return finish({ dryRun: true, plan: unique, lines, held: ground.held, later });
    }
    if (!toRun.length) {
      // Nothing may start. Anything held would have run once what it reads was there, so the run ends
      // saying what is waiting for what rather than pretending it finished.
      waiting = ground.held;
      break;
    }

    const pass = ++passes;
    const byKey = new Map(toRun.map((s) => [s.key, s]));
    const run = startRun({
      steps: toRun,
      cli,
      outDir: out,
      logDir: logsDir ?? join(out, 'logs'),
      jobs: atOnce,
      cwd,
      env,
      // A file a stopped step left half written is set aside (renamed, never deleted) before anything
      // starts, or the step that writes it may read the old one back before it writes a new one.
      unreadable: asked.unreadable ?? [],
      spawnStep: starter,
      onEvent: (e) => {
        if (e.kind === 'start') {
          logDirs.push(e.logDir);
          say({ kind: 'pass', pass, jobs: e.jobs, logDir: e.logDir, steps: e.steps, problems: e.problems });
          return;
        }
        if (e.kind === 'end') {
          say({ kind: 'pass-end', pass, summary: e.summary });
          return;
        }
        say(e);
      },
    });
    onPass({ pass, state: run.state, stop: run.stop });
    const onAbort = () => run.stop();
    signal?.addEventListener('abort', onAbort);
    // A signal that went off while `status` was being asked has already fired: a listener added now
    // would never hear it, and the pass would run to the end with somebody holding Ctrl+C.
    if (signal?.aborted) run.stop();
    let summary;
    try {
      summary = await run.done;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    const mark = (list, itFailed) => {
      for (const s of list) {
        const was = history.get(s.key);
        history.set(s.key, { runs: (was?.runs ?? 0) + 1, reason: byKey.get(s.key)?.reason ?? '', failed: itFailed });
        const command = byKey.get(s.key)?.command;
        if (!itFailed && command) ranOk.add(command);
      }
    };
    mark(summary.done, false);
    mark(summary.failed, true);
    for (const s of summary.done) add(done, s);
    for (const s of summary.failed) add(failed, s);
    for (const s of summary.skipped) add(skipped, s);
    for (const s of [...summary.stopped, ...summary.notRun]) add(notRun, s);
    if (summary.cancelled) {
      cancelled = true;
      break;
    }
    // A pass runs everything it can, so a failure has nothing more to give this run: `status` will ask
    // for the failed step again and it would not be run again, and what waited on it cannot be trusted
    // to work without it. It is said plainly and the run ends; convert again once it is mended.
    if (summary.failed.length) break;
    // Nothing converted and nothing left to try: another pass would ask exactly the same question.
    if (!summary.done.length) break;
  }

  return finish({});

  function finish({ dryRun: wasDry = false, plan: dryPlan = null, lines: dryLines = null, held = [], later = [] }) {
    const seconds = Math.max(0, Math.round((now() - startedAt) / 1000));
    const result = {
      format: DRIVE_FORMAT,
      // A dry run did what it was asked: it is a success, and the command line comes back 0.
      ok: wasDry || (!cancelled && !failed.length && !stuck.length && !notRun.length && !waiting.length && !ranOut),
      dryRun: wasDry,
      cancelled,
      // `status` asked for nothing at all: the run converted nothing because there was nothing to
      // convert, which is the commonest way of all to end and must not read as a run that did nothing.
      nothingMissing: everythingDone,
      passes,
      seconds,
      out,
      logDirs,
      done,
      failed,
      skipped,
      stuck: stuck.map((s) => ({ key: s.key, label: s.label, reason: s.reason, args: s.args })),
      // Steps that were never started because what they read is not there and this round could not make
      // it so. They are not failures and not work that was done: they are work still to do.
      waiting: waiting.map((s) => ({ key: s.key, label: s.label, reason: s.reason, args: s.args, waitingFor: s.waitingFor })),
      notRun,
      only: wanted,
      plan: dryPlan,
      outcome: '',
      lines: [],
    };
    if (wasDry) {
      const more = held.length + later.length ? ' in this round' : '';
      result.held = held.map((s) => ({ key: s.key, label: s.label, waitingFor: s.waitingFor }));
      result.later = later;
      result.outcome = `${dryPlan.length} step${dryPlan.length === 1 ? '' : 's'} would run${more}; nothing was.`;
      result.lines = [...dryLines, result.outcome];
      return result;
    }
    result.outcome = outcomeOf(result, { everythingDone, ranOut });
    result.lines = driveLines(result);
    return result;
  }
}

/** The one sentence the launcher's page shows and the command line ends on. The words are the page's. */
export function outcomeOf(result, { everythingDone = false, ranOut = false } = {}) {
  const names = (list) => list.map((s) => s.label).join(', ');
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (result.cancelled) return `Stopped${result.seconds >= 1 ? ` after ${words(result.seconds)}` : ''}. Convert again to carry on from what status says is left.`;
  if (result.failed.length) return `Finished, but ${count(result.failed.length, 'step', 'steps')} failed: ${names(result.failed)}. The log says why; Convert tries again.`;
  if (ranOut) return `Stopped after ${result.passes} rounds of asking what is missing, which is more than a conversion should need. What is still asked for is in the report.`;
  if (result.waiting?.length) return `Finished what can be done here. ${count(result.waiting.length, 'step is', 'steps are')} waiting for work that was not done: ${result.waiting.map((s) => `${s.label} (needs ${s.waitingFor.join(' and ')})`).join(', ')}.`;
  if (result.stuck.length) return `Finished what can be done here. ${count(result.stuck.length, 'step is', 'steps are')} still asked for after running, which running again will not change: ${names(result.stuck)}.`;
  if (result.skipped.length) return `Finished. ${count(result.skipped.length, 'step was', 'steps were')} not run: ${result.skipped.map((s) => `${s.label} (${s.because})`).join(', ')}.`;
  if (result.only) return `Finished: nothing more is asked of ${result.only.join(', ')}.`;
  return everythingDone ? 'Everything is converted.' : 'Finished.';
}

/** The whole run in plain sentences: what was converted, what was not, and where to read why. */
export function driveLines(result) {
  const lines = [result.outcome];
  if (result.done.length) {
    lines.push(`${result.done.length} step${result.done.length === 1 ? '' : 's'} converted in ${words(result.seconds)}:`);
    for (const s of result.done) lines.push(`  ${s.label}: ${words(s.seconds)}`);
  } else if (!result.cancelled && !result.nothingMissing) {
    lines.push('Nothing was converted.');
  }
  if (result.failed.length) {
    lines.push('Failed:');
    for (const s of result.failed) lines.push(`  ${s.label} (exit ${s.code}) -- ${s.logFile ?? 'no log'}`);
  }
  if (result.skipped.length) {
    lines.push('Not run:');
    for (const s of result.skipped) lines.push(`  ${s.label}: ${s.because}`);
  }
  if (result.notRun.length) lines.push(`Had not started: ${result.notRun.map((s) => s.label).join(', ')}.`);
  if (result.waiting?.length) {
    lines.push('Waiting for work this run did not do, and not started for that reason:');
    for (const s of result.waiting) lines.push(`  ${s.label}: needs ${s.waitingFor.join(' and ')}`);
  }
  if (result.stuck.length) {
    lines.push('Still asked for after running, which running again will not change:');
    for (const s of result.stuck) lines.push(`  ${s.label}: ${s.reason}`);
  }
  for (const dir of result.logDirs) lines.push(`Every step's own output is in ${dir}.`);
  return lines;
}
