// The truth the server keeps between runs (server/store.mjs): a snapshot you can read, a log of the
// changes since it was written, and a start that puts the two back together. Nothing in here is
// game data: it writes and reads its own scratch folder and takes it away again.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyChange, emptyWorld, openStore, STORE_VERSION } from '../../../server/store.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const made: string[] = [];
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'swg3js-store-'));
  made.push(dir);
  return dir;
};
const quiet = { saveEvery: 0, log: () => {} };

// --- 1: one change at a time -------------------------------------------------------------------------
{
  const world = emptyWorld(1000);
  ok(world.v === STORE_VERSION && world.seq === 0 && world.epoch === 1000, '1: an empty world knows its version, its change number and when it began');
  ok('players' in world && 'characters' in world && 'items' in world && 'houses' in world, '1: the slots all exist, including the two this pass leaves empty on purpose');
  ok(applyChange(world, { t: 'player', id: 'p1', player: { name: 'Han' } }) === true && world.players.p1.name === 'Han', '1: a player is written');
  applyChange(world, { t: 'player', id: 'p1', player: { seen: 5 } });
  ok(world.players.p1.name === 'Han' && world.players.p1.seen === 5, '1: a later change adds to a player rather than replacing them');
  applyChange(world, { t: 'character', id: 'c1', character: { owner: 'p1', counter: 3 } });
  ok(world.characters.c1.owner === 'p1', '1: a character is written');
  applyChange(world, { t: 'characterGone', id: 'c1' });
  ok(world.characters.c1 === undefined, '1: and can be taken away');
  applyChange(world, { t: 'settings', settings: { friendlyFire: true } });
  ok(world.settings.friendlyFire === true, '1: the switches the server was started with are kept');
  ok(applyChange(world, { t: 'somethingNewer', id: 'x' }) === false, '1: a change from a newer server is not understood, and is not an error either');
  ok(applyChange(world, null as never) === false && applyChange(world, { t: 'player' } as never) === false, '1: nonsense changes nothing');
}

// --- 2: the log, and reading it back -----------------------------------------------------------------
{
  const dir = folder();
  const a = openStore({ dir, epoch: 1000, ...quiet });
  const base = a.data.seq;
  a.change({ t: 'player', id: 'p1', player: { name: 'Han', key: 'ab' } });
  a.change({ t: 'character', id: 'c1', character: { owner: 'p1', name: 'Han', counter: 2 } });
  ok(a.data.seq === base + 2, '2: every change gets the next number');
  ok(existsSync(join(dir, 'world.log')) && !existsSync(join(dir, 'world.json')), '2: the changes are in the log at once, before any snapshot is written');

  const b = openStore({ dir, epoch: 9999, ...quiet });
  ok(b.data.characters.c1.counter === 2 && b.data.players.p1.name === 'Han', '2: a server started again plays the log back and has everything');
  ok(b.data.seq === a.data.seq, '2: and carries on from the same change number');
  b.close();
  a.close();
}

// --- 3: the snapshot ----------------------------------------------------------------------------------
{
  const dir = folder();
  const a = openStore({ dir, epoch: 1000, ...quiet });
  a.change({ t: 'player', id: 'p1', player: { name: 'Han' } });
  const wrote = a.saveNow();
  ok(wrote.written === true && wrote.tries === 1, '3: a snapshot is written when something has changed');
  ok(existsSync(join(dir, 'world.json')) && !existsSync(join(dir, 'world.json.tmp')), '3: the temp file is renamed over the real one and does not stay behind');
  ok(statSync(join(dir, 'world.log')).size === 0, '3: the log is emptied, and only once the snapshot is in place');
  ok(a.saveNow().written === false, '3: a snapshot with nothing new in it is not written again');
  const text = readFileSync(join(dir, 'world.json'), 'utf8');
  ok(text.includes('\n') && JSON.parse(text).players.p1.name === 'Han', '3: and what is written is a file you can read');

  a.change({ t: 'character', id: 'c1', character: { owner: 'p1', counter: 1 } });
  const b = openStore({ dir, epoch: 5, ...quiet });
  ok(b.data.players.p1.name === 'Han' && b.data.characters.c1.counter === 1, '3: starting again reads the snapshot and then the changes since');
  ok(b.data.epoch === 1000, '3: the world keeps the moment it began, so the time of day picks up where it was');
  ok(b.data.seq === a.data.seq, '3: and the change number goes on from the log rather than the snapshot');
  b.close();
  a.close();
}

// --- 4: what a power cut leaves behind ----------------------------------------------------------------
{
  const dir = folder();
  const a = openStore({ dir, epoch: 1000, ...quiet });
  a.change({ t: 'player', id: 'p1', player: { name: 'Han' } });
  a.saveNow();
  a.change({ t: 'player', id: 'p2', player: { name: 'Leia' } });
  const reached = a.data.seq;
  a.close();
  // A snapshot the machine was cut off in the middle of writing, and a log line the same.
  writeFileSync(join(dir, 'world.json.tmp'), '{"v":1,"seq":99,"players":{"gh');
  writeFileSync(join(dir, 'world.log'), `${readFileSync(join(dir, 'world.log'), 'utf8')}{"t":"player","id":"p3","pla`);
  const b = openStore({ dir, epoch: 5, ...quiet });
  ok(b.data.seq === reached && b.data.players.p2.name === 'Leia', '4: a half-written snapshot is ignored and the good one is read');
  ok(!existsSync(join(dir, 'world.json.tmp')), '4: and the half-written one is thrown away rather than tried again');
  ok(b.data.players.p3 === undefined, '4: a log line the power cut caught halfway is skipped');
  ok(b.data.players.p1.name === 'Han', '4: and everything written before it is still there');
  b.close();
}

// --- 5: a snapshot that cannot be put in place ---------------------------------------------------------
{
  const dir = folder();
  let attempts = 0;
  const a = openStore({
    dir,
    epoch: 1000,
    saveEvery: 0,
    log: () => {},
    rename: () => {
      attempts++;
      const err = new Error('EPERM: the file is open in an editor') as Error & { code: string };
      err.code = 'EPERM';
      throw err;
    },
  });
  const before = a.data.seq;
  a.change({ t: 'player', id: 'p1', player: { name: 'Han' } });
  const out = a.saveNow();
  ok(out.written === false && attempts === 3, `5: a rename Windows will not allow is tried three times (${attempts})`);
  ok(statSync(join(dir, 'world.log')).size > 0, '5: and the log is kept, so nothing is lost while the file is held open');
  ok(a.data.seq === before + 1, '5: the world in memory is untouched by the failure');
  a.close();
  ok(attempts === 6, `5: a clean shutdown has one more go at it and then stops (${attempts})`);
  const b = openStore({ dir, epoch: 5, ...quiet });
  ok(b.data.players.p1.name === 'Han', '5: a server started again gets everything from the log alone');
  b.close();
}

// --- 6: a file from another version ---------------------------------------------------------------------
{
  const dir = folder();
  writeFileSync(join(dir, 'world.json'), JSON.stringify({ v: STORE_VERSION + 1, seq: 40, players: { p9: { name: 'Later' } } }));
  const lines: string[] = [];
  const a = openStore({ dir, epoch: 1000, saveEvery: 0, log: (line: string) => lines.push(line) });
  ok(a.data.players.p9 === undefined && a.data.seq < 40, '6: a world written by a newer server is not read as if it were ours');
  ok(lines.some((l) => /version/.test(l)), `6: and the log says so rather than saying nothing (${lines.join(' | ')})`);
  ok(readFileSync(join(dir, 'world.json'), 'utf8').includes('Later'), '6: the file itself is left alone until something is saved over it');
  a.close();
}

// --- 7: when the world began ---------------------------------------------------------------------------
{
  const dir = folder();
  const a = openStore({ dir, epoch: 1000, ...quiet });
  ok(a.data.epoch === 1000, '7: a brand new world begins when it is made');
  a.change({ t: 'player', id: 'p1', player: { name: 'Han' } });
  a.close();
  // No snapshot at all: a machine that was cut off has only the log, and the moment the world began
  // has to be in it or the time of day would start over on every restart.
  const b = openStore({ dir, epoch: 55555, ...quiet });
  ok(b.data.epoch === 1000, '7: a server started again keeps the moment the world began, from the log alone');
  b.saveNow();
  b.close();
  const c = openStore({ dir, epoch: 77777, ...quiet });
  ok(c.data.epoch === 1000, '7: and from the snapshot after that');
  ok(c.data.seq === b.data.seq, '7: with no change written for it a second time');
  c.close();
}

// --- 8: a change number older than the snapshot ------------------------------------------------------------
{
  const dir = folder();
  const a = openStore({ dir, epoch: 1000, ...quiet });
  a.change({ t: 'player', id: 'p1', player: { name: 'Han', seen: 1 } });
  a.change({ t: 'player', id: 'p1', player: { seen: 2 } });
  a.saveNow();
  a.close();
  // A log left over from before the snapshot: its numbers are behind, so nothing in it is replayed.
  writeFileSync(join(dir, 'world.log'), `${JSON.stringify({ t: 'player', id: 'p1', player: { seen: 1 }, q: 1 })}\n`);
  const b = openStore({ dir, epoch: 5, ...quiet });
  ok(b.data.players.p1.seen === 2, '8: a log line older than the snapshot is not played over it');
  b.close();
}

// --- 9: a snapshot that cannot be put in place does not turn into a loop -----------------------------------
// The one path the rest of this file did not take: the numbers the server actually runs with. A retry
// scheduled here would be a full write of the world and an fsync every fraction of a second, for as
// long as somebody had world.json open, with a line in the log each time.
{
  const dir = folder();
  let attempts = 0;
  const lines: string[] = [];
  const a = openStore({
    dir,
    epoch: 1000,
    saveEvery: 30000,
    log: (line: string) => lines.push(line),
    rename: () => {
      attempts++;
      const err = new Error('EPERM: the file is open in an editor') as Error & { code: string };
      err.code = 'EPERM';
      throw err;
    },
  });
  a.change({ t: 'player', id: 'p1', player: { name: 'Han' } });
  a.saveNow();
  const first = attempts;
  const said = lines.length;
  await new Promise((done) => setTimeout(done, 250));
  ok(attempts === first, `9: nothing is tried again on its own between one write and the next (${attempts} tries, and ${first} straight after the write)`);
  ok(lines.length === said, '9: and the log is not filled while the file is held open');
  ok(lines.some((l) => /next try is in 30 s/.test(l)), `9: the line says when the next try really is (${lines.join(' | ')})`);
  a.close();
}

// --- 10: a key that is not a key --------------------------------------------------------------------------
{
  const world = emptyWorld(1000);
  ok(Object.getPrototypeOf(world.players) === null && Object.getPrototypeOf(world.characters) === null, '10: the tables a browser puts keys in have no prototype of their own');
  applyChange(world, { t: 'character', id: '__proto__', character: { owner: 'p1' } });
  const odd = world.characters as Record<string, { owner?: string }>;
  ok(odd['__proto__']?.owner === 'p1' && (({}) as Record<string, unknown>).owner === undefined, '10: so a character called __proto__ is a character and nothing else in the program is touched');
  const dir = folder();
  const a = openStore({ dir, epoch: 1000, ...quiet });
  a.change({ t: 'character', id: '__proto__', character: { owner: 'p1', counter: 1 } });
  a.saveNow();
  a.close();
  const b = openStore({ dir, epoch: 5, ...quiet });
  ok(Object.getPrototypeOf(b.data.characters) === null, '10: and a world read back from the file has none either');
  b.close();
}

for (const dir of made) rmSync(dir, { recursive: true, force: true });
console.log(`\n${checks} checks passed`);
