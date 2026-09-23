// The launcher proper. It lives in the release, so it updates with the game; swg3js.exe's bootstrap
// installs the release and calls `start` here. It is a small web server on 127.0.0.1 that
//
//   - serves its own page at /launcher/ and opens it in the player's browser;
//   - remembers the Star Wars Galaxies folder, the Jedi Academy folder and where the converted content
//     goes, offers Windows' own folder dialog for each, and checks each folder is what it claims;
//   - converts: hands the whole job to the converter's own driver (`tools/swg/convertDrive.mjs`, the
//     same one `npm run swg -- convert` uses), which asks `status --json` what is missing and runs
//     exactly that, several steps at once where they do not tread on each other, until it asks for
//     nothing; with the converter's own last line per step, each step's running time, a log on disk and
//     a Stop that leaves nothing a second press cannot resume;
//   - serves the built game at / and the converted content at /assets-private/, and opens the game;
//   - hosts for friends if asked: the release's own server, with a join word.
//
// Every child (the converter, the server) is the exe itself told which file to run, or plain Node when
// this is started from a checkout with `node tools/launcher/main.mjs`. Nothing here talks to any network
// but this machine's own; the bootstrap is the one part that talks to GitHub.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkJka, checkOut, checkSwg, formatBytes, roomFor } from './checks.mjs';
import { labelOf, planSteps, readStatus } from './plan.mjs';
import { resolveUnder, sendFile } from './serve.mjs';

/** The port the launcher asks for first, and keeps: the game's characters live in the browser's storage for this address, so a port that moved would hide them. Ours. */
export const PREFERRED_PORT = 47031;
/** The server's own default port. */
export const RELAY_PORT = 8787;
/** How many lines of the conversion's output the page can scroll back through (the log on disk has them all). */
const LOG_KEEP = 3000;

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------
// Small pieces.

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Writes JSON through a temporary file, so a crash never leaves half a settings file. */
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Every IPv4 address this machine has on a network, for the address a friend would type. */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
  return out;
}

/** The game's address with a server and a join word, as the game reads them (`?server=`, `?word=`). */
export function gameUrl(port, server, word) {
  const q = new URLSearchParams();
  if (server) q.set('server', server);
  if (server && word) q.set('word', word);
  const s = q.toString();
  return `http://127.0.0.1:${port}/${s ? `?${s}` : ''}`;
}

/**
 * Windows' own folder dialog, from the server (a page cannot hand over a folder's path). PowerShell's
 * Windows Forms dialog, told its title and starting place through the environment so nothing needs
 * quoting; the path comes back on its output as UTF-8.
 */
function pickFolder(title, startAt) {
  if (process.platform !== 'win32') return Promise.resolve({ path: null, error: 'The folder dialog is Windows only; type the path instead.' });
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = $env:SWG3JS_PICK_TITLE',
    '$d.ShowNewFolderButton = $true',
    'if ($env:SWG3JS_PICK_START -and (Test-Path -LiteralPath $env:SWG3JS_PICK_START)) { $d.SelectedPath = $env:SWG3JS_PICK_START }',
    "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolvePick) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: { ...process.env, SWG3JS_PICK_TITLE: title, SWG3JS_PICK_START: startAt || '' },
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.on('error', (err) => resolvePick({ path: null, error: `The folder dialog did not open (${err.message}).` }));
    child.on('close', () => resolvePick({ path: out.trim() || null }));
  });
}

/** Splits streamed output into lines, handing each finished one on (a carriage return ends one too). */
function lineSplitter(onLine) {
  let rest = '';
  return {
    push(chunk) {
      rest += chunk.toString('utf8');
      const parts = rest.split(/\r\n|\n|\r/);
      rest = parts.pop();
      for (const p of parts) if (p.trim()) onLine(p);
    },
    end() {
      if (rest.trim()) onLine(rest);
      rest = '';
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The launcher.

export async function start(ctx) {
  const dataDir = resolve(ctx.dataDir);
  const appDir = resolve(ctx.appDir);
  const log = ctx.log ?? ((l) => console.log(l));
  const cli = join(appDir, 'tools', 'swg', 'cli.mjs');
  const relayScript = join(appDir, 'server', 'relay.mjs');
  const distDir = join(appDir, 'dist');
  const settingsFile = join(dataDir, 'settings.json');
  const logsDir = join(dataDir, 'logs');
  mkdirSync(logsDir, { recursive: true });
  const token = randomBytes(18).toString('hex');
  const version = readJson(join(appDir, 'version.json')) ?? { commit: 'checkout', date: null, format: 0 };

  const settings = {
    swg: '',
    jka: '',
    out: '',
    port: PREFERRED_PORT,
    /** How many conversion steps may run at once; 0 is the driver's own reckoning of this machine. */
    jobs: 0,
    host: { word: '', port: RELAY_PORT },
    join: { server: '', word: '' },
    ...(readJson(settingsFile) ?? {}),
  };
  // Every folder is kept absolute, resolved once against the launcher's own working folder: the checks
  // run here, but the converter runs with the data folder as its working folder, so a relative path
  // handed on as typed would be checked in one place and converted from another.
  const absolute = (p) => (typeof p === 'string' && p.trim() ? resolve(p.trim()) : '');
  for (const k of ['swg', 'jka', 'out']) settings[k] = absolute(settings[k]);
  const saveSettings = () => writeJson(settingsFile, settings);

  // What the page reads.
  const logLines = [];
  let logSeq = 0;
  let convertLog = null;
  const say = (line, kind = 'out') => {
    logSeq++;
    logLines.push({ n: logSeq, t: Date.now(), kind, line });
    if (logLines.length > LOG_KEEP) logLines.splice(0, logLines.length - LOG_KEEP);
    if (convertLog) {
      try {
        appendFileSync(convertLog, `${line}\n`);
      } catch {
        /* the page still has it */
      }
    }
  };

  const checks = { swg: null, jka: null, out: null };
  const recheck = () => {
    checks.swg = checkSwg(settings.swg);
    checks.jka = checkJka(settings.jka);
    checks.out = checkOut(settings.out, { appDir, dataDir, swg: settings.swg, jka: settings.jka });
  };
  recheck();
  const folders = () => ({ swg: absolute(settings.swg), jka: checks.jka?.ok ? absolute(settings.jka) : '', out: resolve(settings.out || '.') });

  const children = new Set();
  /** Starts one of the release's scripts as a child, output split into lines. */
  const runChild = (file, args, { onLine, onErrLine } = {}) => {
    const { command, args: argv } = ctx.childCommand(file, args);
    const child = spawn(command, argv, { cwd: dataDir, env: { ...process.env, SWG3JS_DATA: dataDir }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const out = lineSplitter(onLine ?? (() => {}));
    const err = lineSplitter(onErrLine ?? onLine ?? (() => {}));
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    const done = new Promise((res) => {
      child.on('error', (e) => {
        (onErrLine ?? onLine ?? (() => {}))(`could not start: ${e.message}`);
        res(-1);
      });
      child.on('close', (code, signal) => {
        out.end();
        err.end();
        children.delete(child);
        res(code ?? (signal ? -2 : -1));
      });
    });
    return { child, done };
  };

  // ---- status ------------------------------------------------------------------------------
  // What the page lists. The drive does not read this: it asks `status` itself, every time round, since
  // that is the only truth about what is done and a list read once would be a list going stale.
  const status = { ran: null, running: false, error: '', steps: [], lines: [], done: false };
  const runStatus = async () => {
    if (!checks.out?.ok) {
      status.error = checks.out?.sentence ?? 'Choose a folder for the converted content.';
      status.steps = [];
      status.done = false;
      return null;
    }
    status.running = true;
    let text = '';
    const errs = [];
    const { done } = runChild(cli, ['status', folders().out, '--json'], { onLine: (l) => (text += `${l}\n`), onErrLine: (l) => errs.push(l) });
    const code = await done;
    status.running = false;
    status.ran = Date.now();
    try {
      if (code !== 0) throw new Error(errs.slice(-3).join(' ') || `status ended with ${code}`);
      const json = readStatus(text);
      status.steps = planSteps(json, folders());
      status.lines = json.lines;
      status.done = json.done;
      status.error = '';
      return json;
    } catch (err) {
      status.error = `The converter's status could not be read: ${err.message}`;
      status.steps = [];
      status.done = false;
      return null;
    }
  };

  // ---- the conversion drive ----------------------------------------------------------------
  // The launcher keeps no loop of its own any more. Which steps there are, what order they go in, what
  // may run beside what, when a file left half written is set aside and when the whole thing is
  // finished are the converter's own driver's (`tools/swg/convertDrive.mjs`), so the page and
  // `npm run swg -- convert` follow one set of rules and a change to either reaches both. What is left
  // here is what only the launcher can give: its own way of starting a child (the exe told which file
  // to run), its page's view of what is happening, and its Stop. It is answered in events rather than
  // console lines, so nothing here reads the driver's words.
  let job = null;
  let stopper = null;
  const drive = async ({ only = null } = {}) => {
    const started = Date.now();
    convertLog = join(logsDir, `convert-${stamp()}.log`);
    // The steps running just now, by their key. `current` stays what the page has always read (the
    // one that started first) and `steps` is all of them, so a page built before parallel runs still
    // shows something true.
    const live = new Map();
    job = { running: true, stopping: false, startedAt: started, done: 0, total: 0, current: null, steps: [], results: [], stuck: [], outcome: '', log: convertLog, only };
    const showLive = () => {
      job.steps = [...live.values()].sort((a, b) => a.startedAt - b.startedAt);
      job.current = job.steps[0] ?? null;
    };
    say(`conversion started ${new Date(started).toLocaleString()}${only ? ` (only ${only})` : ''}; log ${convertLog}`, 'note');
    stopper = new AbortController();
    const onEvent = (e) => {
      switch (e.kind) {
        case 'pass':
          job.total = job.done + e.steps.length;
          say(`--- ${e.steps.length} step${e.steps.length === 1 ? '' : 's'} to run, up to ${e.jobs} at once; every step's own output is in ${e.logDir}`, 'note');
          for (const p of e.problems ?? []) say(`    ${p}`, 'note');
          break;
        case 'step-start':
          live.set(e.key, { label: e.label, args: e.args, reason: e.reason, startedAt: Date.now(), lastLine: '', index: job.done + live.size + 1 });
          showLive();
          say(`--- started: ${e.label}`, 'note');
          if (e.reason) say(`    why: ${e.reason}`, 'note');
          say(`    runs: swg ${e.args.join(' ')}`, 'note');
          break;
        case 'step-line': {
          const s = live.get(e.key);
          if (s) s.lastLine = e.line;
          // With one step running the converter's own line is the line; with several, whose it is has
          // to be on it, or the log reads as one program contradicting itself.
          say(live.size > 1 ? `[${e.label}] ${e.line}` : e.line);
          break;
        }
        case 'step-end': {
          live.delete(e.key);
          showLive();
          job.results.push({ label: e.label, code: e.code, seconds: e.seconds, stopped: e.status === 'stopped' });
          if (e.code === 0) job.done++;
          say(e.code === 0 ? `--- ${e.label} done in ${e.seconds} s` : `--- ${e.label} ${e.status} (exit ${e.code}) after ${e.seconds} s; its own log is ${e.logFile}`, e.code === 0 ? 'note' : 'bad');
          break;
        }
        case 'step-skip':
          say(`--- ${e.label} was not run: ${e.because}`, 'note');
          break;
        case 'pass-end':
          // The page's list of what is left is `status`'s own answer, and the drive asks it again at
          // the top of every round; without this the list would keep the first round's answer for the
          // whole conversion while the progress block beside it moved.
          runStatus();
          break;
        case 'note':
          say(e.line, e.level === 'bad' ? 'bad' : 'note');
          break;
        default:
          break;
      }
    };
    try {
      const { runConvert } = await import('../swg/convertDrive.mjs');
      const f = folders();
      const summary = await runConvert({
        cli,
        out: f.out,
        swg: f.swg,
        jka: f.jka,
        // Whatever the settings hold, straight through: what `--jobs=0` or a word means is the runner's
        // own `jobsFor`, which the command line and this both hand it to, so the two cannot disagree.
        jobs: settings.jobs ?? null,
        only: only ? [only] : null,
        logsDir,
        cwd: dataDir,
        env: { ...process.env, SWG3JS_DATA: dataDir },
        childCommand: ctx.childCommand,
        signal: stopper.signal,
        onEvent,
      });
      job.stuck = summary.stuck.map((s) => ({ label: s.label, reason: s.reason, args: s.args ?? [] }));
      job.outcome = summary.outcome;
      for (const line of summary.lines.slice(1)) say(line, 'note');
    } catch (err) {
      job.outcome = `The conversion stopped: ${err.message}`;
      say(job.outcome, 'bad');
    } finally {
      live.clear();
      showLive();
      job.running = false;
      job.finishedAt = Date.now();
      say(`conversion ended: ${job.outcome}`, 'note');
      convertLog = null;
      stopper = null;
      runStatus();
    }
  };

  const startConvert = ({ only } = {}) => {
    if (job?.running) return { ok: false, sentence: 'A conversion is already running.' };
    recheck();
    if (!checks.swg.ok) return { ok: false, sentence: checks.swg.sentence };
    if (!checks.out.ok) return { ok: false, sentence: checks.out.sentence };
    if (settings.jka && !checks.jka.ok) return { ok: false, sentence: checks.jka.sentence };
    const room = roomFor(settings.out, { empty: checks.out.empty });
    if (!room.ok) return { ok: false, sentence: room.sentence };
    // Some of the converter's commands write straight into the folder they are given and expect it to
    // be there (`maps` writes galaxy.json into it), so it is made before the first step.
    try {
      mkdirSync(resolve(settings.out), { recursive: true });
    } catch (err) {
      return { ok: false, sentence: `The folder for the converted content could not be made (${err.code ?? err.message}).` };
    }
    drive({ only: only || null });
    return { ok: true, sentence: room.sentence };
  };

  const stopConvert = () => {
    if (!job?.running) return { ok: false, sentence: 'Nothing is running.' };
    job.stopping = true;
    // One word to the driver, which owns every child it started: it kills them, keeps what is finished
    // and says what was not, and Convert carries on from whatever status says is left.
    if (stopper) stopper.abort();
    return { ok: true, sentence: 'Stopping.' };
  };

  // ---- hosting ------------------------------------------------------------------------------
  let relay = null;
  const startRelay = ({ word, port }) => {
    if (relay?.running) return { ok: false, sentence: 'The server is already running.' };
    const p = Number(port) || RELAY_PORT;
    const w = String(word ?? '').trim();
    if (!/^[A-Za-z0-9_-]{0,64}$/.test(w)) return { ok: false, sentence: 'A join word is letters, numbers, - and _ only.' };
    settings.host = { word: w, port: p };
    saveSettings();
    const relayLog = join(logsDir, 'relay.log');
    const lines = [];
    const keep = (l) => {
      lines.push(l);
      if (lines.length > 200) lines.shift();
      try {
        appendFileSync(relayLog, `${new Date().toISOString()} ${l}\n`);
      } catch {
        /* the page still has it */
      }
    };
    const args = [`--port=${p}`, `--data=${join(dataDir, 'server')}`];
    if (w) args.push(`--word=${w}`);
    const run = runChild(relayScript, args, { onLine: keep });
    relay = { running: true, port: p, word: w, lines, startedAt: Date.now(), child: run.child, log: relayLog };
    const mine = relay;
    run.done.then((code) => {
      mine.running = false;
      mine.code = code;
      keep(`the server stopped (${code})`);
    });
    return { ok: true, sentence: `The server is starting on port ${p}.` };
  };
  const stopRelay = () => {
    if (!relay?.running) return { ok: false, sentence: 'The server is not running.' };
    relay.child.kill();
    return { ok: true, sentence: 'The server is stopping.' };
  };

  // ---- the page's view of it all -----------------------------------------------------------
  let port = 0;
  const view = () => ({
    app: 'swg3js-launcher',
    now: Date.now(),
    version,
    boot: ctx.bootVersion ?? null,
    canUpdate: typeof ctx.checkForUpdate === 'function',
    update: ctx.update ?? null,
    settings,
    checks,
    status: { ran: status.ran, running: status.running, error: status.error, done: status.done, steps: status.steps.map((s) => ({ label: s.label, reason: s.reason, skip: s.skip ?? null, command: s.args[0] })), lines: status.lines },
    job: job && { running: job.running, stopping: job.stopping, startedAt: job.startedAt, finishedAt: job.finishedAt ?? null, done: job.done, total: job.total, current: job.current, steps: job.steps, results: job.results, stuck: job.stuck, outcome: job.outcome, log: job.log },
    relay: relay && { running: relay.running, port: relay.port, word: relay.word, startedAt: relay.startedAt, lines: relay.lines.slice(-12), log: relay.log, addresses: lanAddresses().map((a) => `ws://${a}:${relay.port}`) },
    game: { url: gameUrl(port), built: existsSync(join(distDir, 'index.html')) },
    paths: { data: dataDir, app: appDir, logs: logsDir },
  });

  const pageHtml = () => readFileSync(join(HERE, 'page.html'), 'utf8').replace('%TOKEN%', token);

  // ---- the server ---------------------------------------------------------------------------
  const readBody = (req) =>
    new Promise((res, rej) => {
      let size = 0;
      const parts = [];
      req.on('data', (d) => {
        size += d.length;
        if (size > 65536) {
          rej(new Error('too large'));
          req.destroy();
        } else parts.push(d);
      });
      req.on('end', () => {
        try {
          res(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {});
        } catch (err) {
          rej(err);
        }
      });
      req.on('error', rej);
    });
  const json = (res, code, value) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };

  let closing = null;
  const api = async (req, res, route) => {
    if (route === 'ping') return json(res, 200, { app: 'swg3js-launcher', version: version.commit });
    // Everything else only for the launcher's own page: it carries the token this start made, which a
    // page from anywhere else cannot read, and a custom header a page from elsewhere cannot send unasked.
    if (req.headers['x-swg3js-token'] !== token) return json(res, 403, { ok: false, sentence: 'Reload the launcher page.' });
    if (route === 'state' && req.method === 'GET') return json(res, 200, view());
    if (route === 'log' && req.method === 'GET') {
      const after = Number(new URL(req.url, 'http://x').searchParams.get('after')) || 0;
      return json(res, 200, { lines: logLines.filter((l) => l.n > after), last: logSeq, file: job?.log ?? null });
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false });
    const body = await readBody(req).catch(() => null);
    if (body === null) return json(res, 400, { ok: false, sentence: 'That request could not be read.' });
    switch (route) {
      case 'settings': {
        for (const k of ['swg', 'jka', 'out']) if (typeof body[k] === 'string') settings[k] = absolute(body[k]);
        if (body.join && typeof body.join === 'object') settings.join = { server: String(body.join.server ?? '').trim(), word: String(body.join.word ?? '').trim() };
        saveSettings();
        recheck();
        if (typeof body.out === 'string' && !job?.running) runStatus();
        return json(res, 200, { ok: true, checks });
      }
      case 'pick': {
        const titles = { swg: 'The Star Wars Galaxies folder (the one holding the .tre archives)', jka: "Jedi Academy's GameData folder", out: 'Where the converted content goes (about 14 GB)' };
        if (!(body.which in titles)) return json(res, 400, { ok: false });
        const r = await pickFolder(titles[body.which], settings[body.which]);
        if (r.path) {
          settings[body.which] = r.path;
          saveSettings();
          recheck();
          if (body.which === 'out' && !job?.running) runStatus();
        }
        return json(res, 200, { ok: !!r.path, path: r.path, sentence: r.error ?? '', checks });
      }
      case 'status':
        if (job?.running) return json(res, 200, { ok: false, sentence: 'A conversion is running; it asks as it goes.' });
        recheck();
        await runStatus();
        return json(res, 200, { ok: !status.error, sentence: status.error });
      case 'convert':
        return json(res, 200, startConvert({ only: typeof body.only === 'string' ? body.only : null }));
      case 'stop':
        return json(res, 200, stopConvert());
      case 'host':
        return json(res, 200, body.on ? startRelay({ word: body.word, port: body.port }) : stopRelay());
      case 'update': {
        if (!ctx.checkForUpdate) return json(res, 200, { ok: false, sentence: 'This launcher was started from a checkout; pull instead.' });
        if (job?.running) return json(res, 200, { ok: false, sentence: 'Stop the conversion first.' });
        const answer = await ctx.checkForUpdate();
        ctx.update = answer;
        if (!answer.updated) return json(res, 200, { ok: true, restarting: false, sentence: answer.note });
        json(res, 200, { ok: true, restarting: true, sentence: `${answer.note} The launcher starts again on the new version.` });
        setTimeout(() => shutdown({ restart: answer }), 300);
        return undefined;
      }
      case 'quit':
        json(res, 200, { ok: true, sentence: 'The launcher has stopped. You can close this tab.' });
        setTimeout(() => shutdown(), 300);
        return undefined;
      default:
        return json(res, 404, { ok: false });
    }
  };

  const server = createServer((req, res) => {
    // Only this machine's own names for itself: a page elsewhere that tricks a name into pointing here
    // still sends its own name as the host.
    const host = String(req.headers.host ?? '');
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('wrong host');
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);
    const p = url.pathname;
    if (p === '/launcher') {
      res.writeHead(302, { Location: '/launcher/' });
      res.end();
      return;
    }
    if (p === '/launcher/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(pageHtml());
      return;
    }
    if (p.startsWith('/launcher/api/')) {
      api(req, res, p.slice('/launcher/api/'.length)).catch((err) => json(res, 500, { ok: false, sentence: err.message }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (p.startsWith('/assets-private/')) {
      if (!settings.out) {
        res.writeHead(404);
        res.end();
        return;
      }
      const file = resolveUnder(settings.out, p.slice('/assets-private'.length));
      if (!file) {
        res.writeHead(403);
        res.end();
        return;
      }
      sendFile(req, res, file, { cache: 'no-cache' });
      return;
    }
    const file = resolveUnder(distDir, p === '/' ? '/index.html' : p);
    if (!file) {
      res.writeHead(403);
      res.end();
      return;
    }
    // Vite names its bundles by their contents, so those can be kept; the page itself is always asked for again.
    sendFile(req, res, file, { cache: p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  });

  const listen = (at) =>
    new Promise((res) => {
      const onError = () => {
        server.off('listening', onOk);
        res(false);
      };
      const onOk = () => {
        server.off('error', onError);
        res(true);
      };
      server.once('error', onError);
      server.once('listening', onOk);
      server.listen(at, '127.0.0.1');
    });
  // The port asked for, then the one kept, then ours and its two neighbours, and only then any free one.
  const wanted = [...new Set([Number(ctx.port) || 0, Number(settings.port) || 0, PREFERRED_PORT, PREFERRED_PORT + 1, PREFERRED_PORT + 2].filter(Boolean)), 0];
  for (const at of wanted) if (await listen(at)) break;
  port = server.address().port;
  if (port !== settings.port) {
    settings.port = port;
    saveSettings();
  }
  writeJson(join(dataDir, 'launcher.json'), { pid: process.pid, port });

  const shutdown = async ({ restart = null, exit = true } = {}) => {
    if (closing) return closing;
    closing = (async () => {
      if (job?.running) stopConvert();
      if (relay?.running) stopRelay();
      for (const c of children) c.kill();
      await new Promise((r) => server.close(() => r()));
      rmSync(join(dataDir, 'launcher.json'), { force: true });
      if (restart && ctx.restart) ctx.restart(['--no-open', `--port=${port}`], restart);
      log(restart ? 'the launcher is starting again on the new version' : 'the launcher has stopped');
      if (exit) process.exit(0);
    })();
    return closing;
  };
  // Closing the console window (SIGHUP on Windows), Ctrl+C or Ctrl+Break: stop the children first, so a
  // conversion or a server is never left running with nothing to show it.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.once(sig, () => shutdown());

  const pageUrl = `http://127.0.0.1:${port}/launcher/`;
  log(`the launcher page: ${pageUrl}`);
  log('close this window to stop the launcher (and anything it is running)');
  if (ctx.open !== false) (ctx.openBrowser ?? openBrowserHere)(pageUrl);
  runStatus();
  return { port, url: pageUrl, shutdown, token };
}

function openBrowserHere(url) {
  try {
    if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the address is printed */
  }
}

// Started from a checkout (`node tools/launcher/main.mjs [--data=<dir>] [--no-open] [--port=<n>]`):
// the checkout is the release, and the children run on this Node.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dataDir = resolve(arg('data') ?? join(process.env.LOCALAPPDATA ?? join(HERE, '..', '..'), 'swg3js-dev'));
  mkdirSync(dataDir, { recursive: true });
  start({
    dataDir,
    appDir: join(HERE, '..', '..'),
    open: !process.argv.includes('--no-open'),
    port: Number(arg('port')) || null,
    update: { note: 'Started from a checkout: updates come from git.' },
    childCommand: (file, args) => ({ command: process.execPath, args: [file, ...args] }),
  });
}

export { labelOf, formatBytes };
