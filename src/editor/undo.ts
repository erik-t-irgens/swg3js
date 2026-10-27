// The world editor's undo and redo (DESIGN.md §2.6): actions as the rows they changed, before and after, across files.
//
// Per world, in memory, for the session, at most `undoMost` actions, cleared when the world goes. An action is the list
// of rows it changed in every file it touched, each with the row before and after (null for none). **The rows kept are
// the rows the endpoint answered**: every write's answer carries each put row as it was stamped, and History stores
// those, so the `was` of the next undo or redo is exactly what is on disk. Undo writes the befores and redo the afters
// **keeping their own `at`** (the batch's `keepAt`), so an undo puts a file back to its text before the action byte for
// byte, and a row edited by hand or by another tab since is refused by name (`was`) rather than written over. Redo puts
// a created row back under its same id. An action bigger than one request goes as consecutive batches (`chunkEdits`),
// one undo entry all the same.
//
// **Across kinds** (Map-maker II's groundwork): a change names any kind of edit file and its rows are that kind's
// (`EditRow`: a placement row, a tile of heights), so one action may change rows of the files and tiles of the ground
// together (a sculpt stroke carrying what stands on it) and one undo puts both back.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

import type { EditFileKind } from '../story/placements.ts';
import type { BatchEdit, EditRow } from '../world/placementEdits.ts';

/** One row an action changed: the kind of file, its id, the row before (null: there was none) and after (null: there is none). */
export interface RowChange {
  file: EditFileKind;
  id: string;
  before: EditRow | null;
  after: EditRow | null;
}

/** One action: what it was called in words, and every row it changed. */
export interface EditAction {
  label: string;
  changes: RowChange[];
}

/** A row as a put carries it: every field it has (its `at` too, which a `keepAt` asks for). */
function asPut(row: EditRow): Record<string, unknown> {
  return { ...row };
}

/**
 * The edits that undo an action: its changes in the opposite order, each row put back as it was (its own `at` kept, and
 * `was` the row as it stands after the action) or taken out where it was made, so a row that moved between the files is
 * taken out of the new one before it is put back in the old. A row with no `at` of its own is put back stamped now.
 */
export function undoEdits(a: EditAction): BatchEdit[] {
  const out: BatchEdit[] = [];
  for (let i = a.changes.length - 1; i >= 0; i--) {
    const c = a.changes[i];
    if (c.after && !c.before) out.push({ file: c.file, delete: c.id, was: asPut(c.after) });
    else if (c.before) out.push({ file: c.file, put: asPut(c.before), was: c.after ? asPut(c.after) : null, ...(typeof c.before.at === 'number' ? { keepAt: true } : {}) });
  }
  return out;
}

/** The edits that do an action again: its changes in order, each after put (its own `at` kept) or taken out, `was` the row before. */
export function redoEdits(a: EditAction): BatchEdit[] {
  const out: BatchEdit[] = [];
  for (const c of a.changes) {
    if (c.before && !c.after) out.push({ file: c.file, delete: c.id, was: asPut(c.before) });
    else if (c.after) out.push({ file: c.file, put: asPut(c.after), was: c.before ? asPut(c.before) : null, ...(typeof c.after.at === 'number' ? { keepAt: true } : {}) });
  }
  return out;
}

/** The edits that do an action for the first time: its afters put (stamped now) or its rows taken out, `was` the row before. */
export function doEdits(a: EditAction): BatchEdit[] {
  const out: BatchEdit[] = [];
  for (const c of a.changes) {
    if (c.before && !c.after) out.push({ file: c.file, delete: c.id, was: asPut(c.before) });
    else if (c.after) {
      const { at: _at, ...row } = c.after;
      out.push({ file: c.file, put: row, was: c.before ? asPut(c.before) : null });
    }
  }
  return out;
}

/** Edits cut into requests of at most `most` each, in order: an action bigger than one request, as consecutive batches. */
export function chunkEdits(edits: readonly BatchEdit[], most: number): BatchEdit[][] {
  const n = Math.max(1, Math.floor(most));
  const out: BatchEdit[][] = [];
  for (let i = 0; i < edits.length; i += n) out.push(edits.slice(i, i + n));
  return out;
}

/** What a write answered for each kind of file: the rows put as stamped, by id. */
export type Answered = Partial<Record<EditFileKind, ReadonlyMap<string, EditRow>>>;

/** What one answer's files put, laid into `answered` by kind (each file's rows by id, a later batch's over an earlier's). Answers the kinds touched. */
export function noteAnswered(answered: Partial<Record<EditFileKind, Map<string, EditRow>>>, files: Partial<Record<EditFileKind, { put: readonly EditRow[] } | undefined>>): EditFileKind[] {
  const out: EditFileKind[] = [];
  for (const kind of Object.keys(files) as EditFileKind[]) {
    const f = files[kind];
    if (!f) continue;
    out.push(kind);
    let m = answered[kind];
    if (!m) answered[kind] = m = new Map();
    for (const r of f.put) m.set(r.id, r);
  }
  return out;
}

/**
 * The rows the endpoint answered laid over the actions a write (or a jump through the history) put, so the next `was` is
 * the disk's: `actions` in the order their edits went, each one's `side` (`after` doing or redoing, `before` undoing).
 * **The answer is a file's last put of an id**, so it is the row of only the last of these actions to put that id; an
 * earlier action's row of the same id is left as it was sent. That row is exact all the same: a row put back with its
 * own `at` (`keepAt`) is written as sent, and the rows a history holds all carry one. Taken for every action, two moves
 * of one crate jumped back over together wrote the older one's row into the newer one's `before`, and every later redo of
 * either was refused as a row changed since. A delete that came last keeps any earlier put of its id from taking a row
 * the file no longer holds.
 */
export function takeAnswered(actions: readonly EditAction[], side: 'before' | 'after', answered: Answered): void {
  const seen = new Set<string>();
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i];
    // Within an action its edits go in change order doing and redoing, and backwards undoing.
    const order = side === 'after' ? -1 : 1;
    for (let k = order < 0 ? a.changes.length - 1 : 0; order < 0 ? k >= 0 : k < a.changes.length; k += order) {
      const c = a.changes[k];
      const key = `${c.file}\u0000${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = c[side];
      if (!row) continue;
      const got = answered[c.file]?.get(c.id);
      if (got) c[side] = got;
    }
  }
}

/** The history of one world's actions, in memory for the session. */
export class History {
  /** Every action, oldest first; those before `at` are done, those from `at` on are undone and may be done again. */
  actions: EditAction[] = [];
  at = 0;
  most: number;

  constructor(most: number) {
    this.most = most;
  }

  /** A new action done: whatever was undone is let go, and past `most` the oldest is forgotten. */
  record(a: EditAction): void {
    this.actions.length = this.at;
    this.actions.push(a);
    const over = this.actions.length - Math.max(1, this.most);
    if (over > 0) this.actions.splice(0, over);
    this.at = this.actions.length;
  }

  get canUndo(): boolean {
    return this.at > 0;
  }

  get canRedo(): boolean {
    return this.at < this.actions.length;
  }

  /**
   * The edits that take the history to `n` actions done (0 to every one), in order, and which actions they undo or redo:
   * back through every action between, newest first, or forward through them, oldest first. Empty where it is there.
   */
  editsTo(n: number): { edits: BatchEdit[]; undo: EditAction[]; redo: EditAction[] } {
    const to = Math.max(0, Math.min(this.actions.length, Math.floor(n)));
    const edits: BatchEdit[] = [];
    const undo: EditAction[] = [];
    const redo: EditAction[] = [];
    if (to < this.at) {
      for (let i = this.at - 1; i >= to; i--) {
        undo.push(this.actions[i]);
        edits.push(...undoEdits(this.actions[i]));
      }
    } else {
      for (let i = this.at; i < to; i++) {
        redo.push(this.actions[i]);
        edits.push(...redoEdits(this.actions[i]));
      }
    }
    return { edits, undo, redo };
  }

  /** The history moved to `n`, once its edits were written: each action's rows taken from what the write answered. */
  landAt(n: number, moved: { undo: EditAction[]; redo: EditAction[] }, answered: Answered): void {
    // Each list is in the order its edits went (`editsTo`): the newest undone first, the oldest redone first.
    takeAnswered(moved.undo, 'before', answered);
    takeAnswered(moved.redo, 'after', answered);
    this.at = Math.max(0, Math.min(this.actions.length, Math.floor(n)));
  }

  /** Forgotten: the world went. */
  clear(): void {
    this.actions = [];
    this.at = 0;
  }
}
