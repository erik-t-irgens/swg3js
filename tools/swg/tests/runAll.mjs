// `npm run test:par`: every suite `npm run test:all` runs, the same commands with the same flags, run several at a
// time instead of one after another. It reads the chain out of package.json each time, so it never drifts from it.
//
// Three rules keep a parallel run honest:
//  - A suite that starts a relay on a fixed port (`const port = 18797`) holds that port while it runs, so two suites
//    with the same port never overlap (grappleRelay and storyRelay share one).
//  - A suite that fails in the crowd is run again alone, one at a time, once the rest are done. The allocation measures
//    flake under load (docs/lessons/testing.md), so a suite that passes alone is reported as "failed under load, passed
//    alone" and does not fail the run; a suite that fails alone does.
//  - Everything runs below normal priority (children inherit it on Windows), so the machine stays usable.
//
// It runs every suite even after one fails (the serial chain stops at the first), and prints the slowest at the end.
// Each suite's time is kept in node_modules/.cache/swg-test-times.json so the next run starts the longest first.
//
// Options: --jobs N (how many at once; the default is half the logical processors less two, at least 2), --list
// (print the suites and their groups and stop), --group test:fx (only the suites under one script), --keep-logs
// (write every suite's output, not only the failures').
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { cpus, setPriority, constants, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(name);

const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
const top = opt('--group') ?? 'test:all';
if (!scripts[top]) { console.error(`no script ${top}`); process.exit(2); }

/** Every leaf command under a script, with the top-level group it came through, `npm run x` expanded in place. */
function expand(name, group, out, seen) {
  if (seen.has(name)) throw new Error(`script ${name} runs itself`);
  seen.add(name);
  for (const part of scripts[name].split('&&').map((s) => s.trim()).filter(Boolean)) {
    const m = /^npm run (\S+)$/.exec(part);
    if (m) {
      if (!scripts[m[1]]) throw new Error(`${name} runs a script that is not there: ${m[1]}`);
      expand(m[1], group ?? m[1], out, new Set(seen));
    } else out.push({ cmd: part, group: group ?? name });
  }
  return out;
}
const leaves = expand(top, top === 'test:all' ? null : top, [], new Set());

const portCache = new Map();
/** The fixed port a suite's file starts a relay on, if it has one: the lock two suites must not hold at once. */
function lockOf(cmd) {
  const m = /(\S+\.test\.(?:ts|mjs))/.exec(cmd);
  if (!m) return null;
  const file = join(ROOT, m[1]);
  if (portCache.has(file)) return portCache.get(file);
  let key = null;
  try {
    const p = /\bconst\s+port\s*=\s*(\d{3,5})\b/.exec(readFileSync(file, 'utf8'));
    if (p) key = `port ${p[1]}`;
  } catch { /* a missing file fails on its own when it runs */ }
  portCache.set(file, key);
  return key;
}
const suites = leaves.map((l, i) => ({ ...l, i, key: lockOf(l.cmd), name: (/(\S+)\.test\.(?:ts|mjs)/.exec(l.cmd)?.[1].split('/').pop() ?? l.cmd) + (/\.test\.(?:ts|mjs)\s+(\S.*)$/.exec(l.cmd)?.[1] ? ` ${/\.test\.(?:ts|mjs)\s+(\S.*)$/.exec(l.cmd)[1]}` : '') }));

if (has('--list')) {
  for (const s of suites) console.log(`${s.group.padEnd(16)} ${s.key ? `[${s.key}] ` : ''}${s.cmd}`);
  console.log(`${suites.length} suites`);
  process.exit(0);
}

const jobs = Math.max(1, Number(opt('--jobs')) || Math.max(2, Math.floor(cpus().length / 2) - 2));
try { setPriority(process.pid, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed: run at normal */ }

const CACHE = join(ROOT, 'node_modules', '.cache', 'swg-test-times.json');
let times = {};
try { times = JSON.parse(readFileSync(CACHE, 'utf8')); } catch { /* first run: chain order */ }
const known = Object.values(times);
const typical = known.length ? known.sort((a, b) => a - b)[Math.floor(known.length / 2)] : 1;
// Longest first, so the long ones do not start last and run on alone at the end.
const queue = suites.slice().sort((a, b) => (times[b.cmd] ?? typical) - (times[a.cmd] ?? typical) || a.i - b.i);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const LOGS = join(tmpdir(), 'swg-test-par', stamp);
mkdirSync(LOGS, { recursive: true });
const keepLogs = has('--keep-logs');
const logName = (s, tag) => join(LOGS, `${String(s.i).padStart(3, '0')}-${s.name.replace(/[^\w.-]+/g, '_')}${tag}.log`);

function run(s) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(s.cmd, { cwd: ROOT, shell: true, env: process.env, windowsHide: true });
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), ms: Date.now() - t0, out: Buffer.concat(chunks).toString('utf8') }));
    child.on('error', (err) => resolve({ code: 1, ms: Date.now() - t0, out: String(err) }));
  });
}

const t0 = Date.now();
const held = new Set();
const results = new Map();
let running = 0;
let done = 0;
let lastNote = 0;
const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
console.log(`test:par: ${suites.length} suites from ${top}, ${jobs} at a time, below normal priority; logs in ${LOGS}`);

await new Promise((finish) => {
  const pump = () => {
    while (running < jobs) {
      const at = queue.findIndex((s) => !s.key || !held.has(s.key));
      if (at < 0) break;
      const s = queue.splice(at, 1)[0];
      if (s.key) held.add(s.key);
      running++;
      run(s).then((r) => {
        running--;
        if (s.key) held.delete(s.key);
        results.set(s, r);
        times[s.cmd] = r.ms;
        done++;
        if (r.code !== 0) console.log(`  failed in the crowd: ${s.name} (${s.group}, exit ${r.code}, ${fmt(r.ms)})`);
        if (r.code !== 0 || keepLogs) writeFileSync(logName(s, r.code ? '-crowd' : ''), `$ ${s.cmd}\n\n${r.out}`);
        if (Date.now() - lastNote > 30000 || done === suites.length) {
          lastNote = Date.now();
          const bad = [...results.values()].filter((x) => x.code !== 0).length;
          console.log(`[${done}/${suites.length}] ${fmt(Date.now() - t0)}${bad ? `, ${bad} failed so far` : ''}`);
        }
        if (done === suites.length) finish();
        else pump();
      });
    }
  };
  pump();
});
const crowdMs = Date.now() - t0;

// The failures again, alone and in chain order, with nothing else running.
const failed = suites.filter((s) => results.get(s).code !== 0);
const flaky = [];
const real = [];
for (const s of failed) {
  console.log(`  again alone: ${s.name} ...`);
  const r = await run(s);
  writeFileSync(logName(s, r.code ? '-alone' : '-alone-passed'), `$ ${s.cmd}\n\n${r.out}`);
  (r.code === 0 ? flaky : real).push(s);
  console.log(`    ${r.code === 0 ? 'passed alone' : `FAILED alone (exit ${r.code})`} in ${fmt(r.ms)}`);
}

try { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify(times)); } catch { /* no cache: chain order next time */ }

const total = Date.now() - t0;
const sum = [...results.values()].reduce((a, r) => a + r.ms, 0);
const slow = suites.slice().sort((a, b) => results.get(b).ms - results.get(a).ms).slice(0, 10);
console.log('');
console.log(`slowest: ${slow.map((s) => `${s.name} ${fmt(results.get(s).ms)}`).join(', ')}`);
console.log(`${suites.length} suites in ${fmt(total)} (${fmt(crowdMs)} together, the suites' own times add to ${fmt(sum)}), ${jobs} at a time`);
if (flaky.length) console.log(`failed under load, passed alone (${flaky.length}): ${flaky.map((s) => s.name).join(', ')}`);
if (real.length) {
  console.log(`FAILED (${real.length}): ${real.map((s) => `${s.name} (${s.group})`).join(', ')}`);
  console.log(`their output: ${LOGS}`);
  process.exit(1);
}
console.log('all passed');
