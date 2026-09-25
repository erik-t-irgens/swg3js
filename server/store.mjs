// The truth the server keeps between runs: the players it knows, their characters, the things they
// own (a row per item, whose shape is the ledger's: see ledger.mjs), the buildings they have put
// down (a row per house, whose shape is homes.mjs's) and the switches it was started with. One file
// you can read, plus a log of the changes since it was last written.
//
// How it is written, and why: the snapshot goes to `world.json.tmp`, is flushed to the disk and
// only then renamed over `world.json`, so a machine that loses power mid-write still has the last
// good file. Every change is a line of JSON in `world.log` with a sequence number, appended and
// flushed as it happens, so nothing between snapshots is lost either; on start the snapshot is read
// and any line newer than it is replayed. The log is truncated only after a new snapshot has been
// flushed and renamed.
//
// On Windows a rename over a file another program is holding open throws EPERM or EBUSY, so the
// rename is tried a few times and then left until the next scheduled write -- which is safe, because
// the log still holds everything. If you have `world.json` open in an editor the server simply writes
// later. It never tries again sooner than that: a snapshot that cannot go in place is usually held
// open for as long as an editor is, and a quick retry is a full write and an fsync of the whole world
// every time, which is a disk thrashed and a log filled for nothing.
//
// Not a database: what is kept here is a few hundred kilobytes you can read with any editor.
// Dependency-free, node's own modules only.

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { applyItems } from './ledger.mjs';
import { applyHomes } from './homes.mjs';

/** The shape of the file. A file written by a newer server is left alone and not played into. */
export const STORE_VERSION = 1;

/**
 * How often a snapshot is written when anything has changed, and how many times a rename that was
 * refused for an instant is tried before it is left until the next write. Both are ours, invented
 * for this pass and kept together; the server carries them in its own `TUNING` so that
 * `--set store.saveEvery=10000` moves one for a run.
 */
export const STORE_TUNING = { saveEvery: 30000, renameTries: 3 };

/**
 * A table keyed by something a browser chose (a player id, a character id). It has no prototype, so
 * a key like `__proto__` is a key and not a way into `Object.prototype`. The wire refuses those names
 * as well; this is the other half of the same belt.
 */
function table(from = null) {
  const out = Object.create(null);
  if (from && typeof from === 'object') for (const key of Object.keys(from)) out[key] = from[key];
  return out;
}

/** An empty world: every slot that exists, each filled by the file that owns its shape. */
export function emptyWorld(epoch = Date.now()) {
  return { v: STORE_VERSION, seq: 0, epoch, players: table(), characters: table(), items: table(), houses: table(), settings: {} };
}

/**
 * Apply one change to the world in memory. The same function runs when a change is made and when
 * the log is replayed on start, so a replayed world and a live one can never drift apart.
 * Returns true when the record was understood.
 */
export function applyChange(data, rec) {
  if (!rec || typeof rec !== 'object' || typeof rec.t !== 'string') return false;
  switch (rec.t) {
    case 'player': {
      if (typeof rec.id !== 'string' || !rec.id) return false;
      const was = data.players[rec.id] ?? {};
      data.players[rec.id] = { ...was, ...rec.player, id: rec.id };
      return true;
    }
    case 'character': {
      if (typeof rec.id !== 'string' || !rec.id) return false;
      const was = data.characters[rec.id] ?? {};
      data.characters[rec.id] = { ...was, ...rec.character, id: rec.id };
      return true;
    }
    case 'characterGone': {
      if (typeof rec.id !== 'string' || !rec.id) return false;
      delete data.characters[rec.id];
      return true;
    }
    case 'settings': {
      data.settings = { ...data.settings, ...rec.settings };
      return true;
    }
    case 'world': {
      // The moment this world first ran. It is written once, on the very first start, and read back
      // every time after, so the server can say how old the world is and anything later that wants
      // to count from the world's birth has one moment to count from. The time of day is not worked
      // out from it: that is the wall clock everyone already shares (see clock.mjs).
      if (Number.isFinite(rec.epoch)) data.epoch = rec.epoch;
      return true;
    }
    default:
      // What a character owns is the ledger's shape rather than this file's, and a building it has
      // put down is `homes.mjs`'s, so a record about either goes there to be applied: one place
      // decides what each row looks like on disk, and the same function runs when the thing happens
      // and when the log is replayed on start. Anything neither of them knows is a record from a
      // newer server: kept in the log, not understood here, and not an error.
      return applyItems(data, rec) || applyHomes(data, rec);
  }
}

export class Store {
  /**
   * @param {{ dir: string, epoch?: number, now?: () => number, saveEvery?: number,
   *           renameTries?: number, rename?: (from: string, to: string) => void,
   *           log?: (line: string) => void }} options
   */
  constructor({ dir, epoch = Date.now(), now = () => Date.now(), saveEvery = STORE_TUNING.saveEvery, renameTries = STORE_TUNING.renameTries, rename = renameSync, log = () => {} } = {}) {
    this.dir = dir;
    this.file = join(dir, 'world.json');
    this.temp = join(dir, 'world.json.tmp');
    this.logFile = join(dir, 'world.log');
    this.now = now;
    this.saveEvery = saveEvery;
    this.renameTries = renameTries;
    this.rename = rename;
    this.say = log;
    this.dirty = false;
    this.timer = null;
    this.fd = -1;
    this.data = emptyWorld(epoch);
    this.load(epoch);
  }

  /** Read the snapshot and replay anything newer in the log. */
  load(epoch) {
    mkdirSync(this.dir, { recursive: true });
    // A half-written temp file is never read: it is the thing the rename was going to replace.
    if (existsSync(this.temp)) {
      try {
        unlinkSync(this.temp);
        this.say('a half-written snapshot was left behind and has been thrown away');
      } catch {
        /* it can stay */
      }
    }
    let loaded = null;
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.v === STORE_VERSION) loaded = parsed;
        else this.say(`world.json is version ${parsed?.v} and this server speaks ${STORE_VERSION}: starting empty and leaving it alone`);
      } catch (err) {
        this.say(`world.json could not be read (${err instanceof Error ? err.message : String(err)}): starting empty and leaving it alone`);
      }
    }
    if (loaded) {
      // The tables are rebuilt rather than taken as they are: `JSON.parse` hands back plain objects,
      // and the keys in them came from a browser (see `table`).
      this.data = { ...emptyWorld(loaded.epoch ?? epoch), ...loaded, players: table(loaded.players), characters: table(loaded.characters), items: table(loaded.items), houses: table(loaded.houses) };
      this.say(`world.json read: ${Object.keys(this.data.players).length} players, ${Object.keys(this.data.characters).length} characters, up to change ${this.data.seq}`);
    }
    let knownEpoch = !!loaded && Number.isFinite(loaded.epoch);
    let replayed = 0;
    if (existsSync(this.logFile)) {
      const text = readFileSync(this.logFile, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          // The last line of a log a power cut caught mid-write: skipped, and nothing after it.
          this.say('the last line of world.log was half written and has been skipped');
          break;
        }
        const q = Number(rec?.q);
        if (!Number.isFinite(q) || q <= this.data.seq) continue;
        if (applyChange(this.data, rec)) replayed++;
        if (rec.t === 'world' && Number.isFinite(rec.epoch)) knownEpoch = true;
        this.data.seq = q;
      }
      if (replayed) this.say(`world.log replayed: ${replayed} changes since the snapshot, now at change ${this.data.seq}`);
    }
    this.fd = openSync(this.logFile, 'a');
    // A world that has never said when it began says so now, so every start after this one knows how
    // old the world is rather than calling it new.
    if (!knownEpoch) this.change({ t: 'world', epoch: this.data.epoch });
    if (this.saveEvery > 0) {
      this.timer = setInterval(() => this.saveNow(), this.saveEvery);
      if (typeof this.timer.unref === 'function') this.timer.unref();
    }
  }

  /**
   * Make a change: stamp it with the next sequence number, apply it, and put it in the log at once.
   * Changes here are rare (a player registering, a character's record, a switch), so the flush per
   * change costs nothing on the path anything is sent on.
   */
  change(rec) {
    const stamped = { ...rec, q: ++this.data.seq, at: this.now() };
    applyChange(this.data, stamped);
    this.dirty = true;
    try {
      writeSync(this.fd, `${JSON.stringify(stamped)}\n`);
      fsyncSync(this.fd);
    } catch (err) {
      this.say(`world.log could not be written (${err instanceof Error ? err.message : String(err)})`);
    }
    return stamped;
  }

  /**
   * Write the snapshot if anything has changed: a temp file, flushed, then renamed over the old one,
   * then the log truncated. Returns `{ written, tries, error }`. The file is written once and only
   * the rename is tried again, because a rename is a syscall and the write is the whole world; and
   * when the last try fails nothing is scheduled -- the next ordinary write is the next attempt, so
   * a world.json somebody is holding open can never turn into a loop of writes and fsyncs.
   */
  saveNow() {
    if (!this.dirty) return { written: false, tries: 0, error: null };
    let text;
    try {
      text = JSON.stringify(this.data, null, 1);
    } catch (err) {
      this.say(`the world could not be turned into a file: ${err instanceof Error ? err.message : String(err)}`);
      return { written: false, tries: 0, error: err };
    }
    try {
      const fd = openSync(this.temp, 'w');
      writeSync(fd, text);
      fsyncSync(fd);
      closeSync(fd);
    } catch (err) {
      this.say(`the snapshot could not be written (${err instanceof Error ? err.message : String(err)}); the log still has everything`);
      return { written: false, tries: 0, error: err };
    }
    let error = null;
    for (let tries = 1; tries <= this.renameTries; tries++) {
      try {
        this.rename(this.temp, this.file);
        this.dirty = false;
        this.truncateLog();
        return { written: true, tries, error: null };
      } catch (err) {
        error = err;
      }
    }
    const when = this.saveEvery > 0 ? `in ${Math.round(this.saveEvery / 1000)} s` : 'the next time the world is written';
    this.say(`the snapshot could not be put in place after ${this.renameTries} tries (${error instanceof Error ? error.message : String(error)}); the log still has everything, and the next try is ${when}`);
    return { written: false, tries: this.renameTries, error };
  }

  /**
   * Empty the log, which is only ever done once a snapshot newer than it is in place. Windows will
   * not let a file opened for appending be cut short (`EPERM: ftruncate`), so the handle is closed,
   * the file written empty and the handle opened again -- which is safe here because nothing may be
   * written between the snapshot being renamed into place and this.
   */
  truncateLog() {
    try {
      if (this.fd >= 0) closeSync(this.fd);
      writeFileSync(this.logFile, '');
      this.fd = openSync(this.logFile, 'a');
    } catch (err) {
      this.say(`world.log could not be emptied (${err instanceof Error ? err.message : String(err)})`);
      if (this.fd < 0) {
        try {
          this.fd = openSync(this.logFile, 'a');
        } catch {
          this.say('and world.log could not be opened again: changes from here are only in memory until the next snapshot');
        }
      }
    }
  }

  /** A line for the log and the status page. */
  describe() {
    return `${Object.keys(this.data.players).length} players, ${Object.keys(this.data.characters).length} characters, change ${this.data.seq}${this.dirty ? ' (unsaved)' : ''}`;
  }

  /** Write everything out and close the log: what a clean shutdown does. */
  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.saveNow();
    if (this.fd >= 0) {
      try {
        closeSync(this.fd);
      } catch {
        /* going anyway */
      }
      this.fd = -1;
    }
  }
}

/** Start a store in a folder, making it if it is not there. */
export function openStore(options) {
  if (!options?.dir) throw new Error('a store needs a folder');
  if (!existsSync(options.dir)) mkdirSync(options.dir, { recursive: true });
  return new Store(options);
}

/** Only used by the tests: write a snapshot by hand. */
export function writeSnapshot(dir, data) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'world.json'), JSON.stringify(data, null, 1));
}
