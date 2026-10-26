// The placement editor in the game (the dev server only): where a thing in hand is kept when it is put down,
// what row a building or a prop in hand is written as, and what the editor says.
//
// **Where it is kept.** Yours (this browser's store for a prop, a deed's house), or one of a world's two files
// of permanent placements (`src/story/placements.ts`): the story's dressing or the world's own edits. The
// Props and Housing tabs carry a switch, Yours or Permanent, that is never remembered across a reload, and a
// thing taken in hand with it on Permanent goes to the session's destination; L in hand moves the hand's own
// destination round (`nextDestination`). A thing of your own may become permanent (one a server keeps is then
// asked away from it); **a permanent thing never becomes yours** -- its way out of a file is the delete key,
// never a click that copies it into this browser's store while the file still stands it for everybody.
//
// **Where it came from** (`HandSource`) decides what letting go of it does, and every let-go in the game switches
// on it, so the compiler names a kind of hand a branch forgot: a thing taken fresh from a tab has nowhere to go
// back to, one of your own picked up goes back into your store, a house of your own picked up at its door stands
// again where it stood or is moved where it is put down (never taken down: the Housing tab does that), and a
// permanent row picked up is stood again from its file, taken out of it, or (a travel, the select screen) left in
// the file for the next visit to stand.
//
// **The words are here and nowhere else**, so a release, which never reaches any of this (every call is behind
// `import.meta.env.DEV`), carries none of them.
//
// Pure: no three, no rapier, no DOM. Rule for this file (node runs it with type stripping for the tests):
// every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { PLACEMENT_LIMITS, fromGame, placementsPath, type GamePlace, type PlacementFrame, type PlacementLayer, type PlacementPack, type PlacementRow } from '../story/placements.ts';
import type { PlacedProp } from './propsPlaced.ts';
import type { KeptRow } from '../net/propsKept.ts';

/** Every number of the editor in the game, ours. Live through `__debug.placements({ edit: { … } })`. */
export const PERMANENT_EDIT_TUNE = {
  /** How long a first click waits for its second, milliseconds: the first save to a file in a session, or a refused spot forced. */
  confirmMs: 2500,
};

/** Where a thing in hand is kept when it is put down: yours, or one of the two files. */
export type Destination = 'yours' | PlacementLayer;

/**
 * Where a thing in hand came from: taken fresh from a tab, one of your own this machine keeps picked up, one of
 * your own a server keeps picked up (down in this browser only until the server says where it went), or a
 * permanent row picked up.
 */
export type HandSource = { kind: 'fresh' } | { kind: 'local'; row: PlacedProp } | { kind: 'server'; row: KeptRow } | { kind: 'permanent'; layer: PlacementLayer; row: PlacementRow };

/**
 * One of your own houses picked up where it stands (the pick-up key at its door): the server's id or this machine's
 * key (`id`), whether this machine keeps it (`local`) or a server does, where it stood in the game's frame (`row`:
 * its doorstep, its height, its heading and the circle it kept clear), how many things put down in its rooms stay
 * where they stood when it moves (`inside`), and which world it was picked up in (`gen`, `World.generation`): a
 * house whose world has gone since is let go of where it stood, kept for the next visit.
 */
export type HomeSource = { kind: 'home'; id: string; local: boolean; row: { model: string; name: string; x: number; y: number; z: number; yaw: number; r: number }; inside: number; gen: number };

/** The same for a building, which is never one of your own props, and may be one of your own houses. */
export type BuildingSource = Exclude<HandSource, { kind: 'local' | 'server' }> | HomeSource;

/** A row as the editor writes it: its id absent for a thing never saved, which the endpoint names. */
export type DraftRow = Omit<PlacementRow, 'id'> & { id?: string };

/** The file a permanent destination is kept in, as the owner reads it. */
export function destinationFile(dest: PlacementLayer, world: string): string {
  return `public/${placementsPath(dest, world)}`;
}

/** Where a thing in hand is kept, in words: yours, or the file. */
export function destinationText(dest: Destination, world: string): string {
  return dest === 'yours' ? 'yours' : destinationFile(dest, world);
}

/** A destination named as the line that offers it reads it. */
function destinationName(dest: Destination): string {
  return dest === 'yours' ? 'yours' : dest === 'story' ? "the story's dressing" : 'the world edits';
}

/** What the placing bar's badge and the chip at the top of the screen say. */
export function badgeOf(dest: Destination): string {
  return dest === 'yours' ? 'YOURS' : dest === 'story' ? 'PERMANENT · STORY' : 'PERMANENT · WORLD EDIT';
}

/**
 * L in hand: the next place to keep it. Taken fresh, or one of your own props picked up: yours, the story's
 * dressing, the world edits, and round. A permanent row picked up: the two files only, since a permanent thing never
 * becomes yours. A house of your own picked up where it stands: yours only, since it is moved, keeping its id and
 * its keeper, and never copied into a file while its keeper still stands it.
 */
export function nextDestination(dest: Destination, source: HandSource['kind'] | BuildingSource['kind']): Destination {
  if (source === 'home') return 'yours';
  if (source === 'permanent') return dest === 'story' ? 'world' : 'story';
  return dest === 'yours' ? 'story' : dest === 'story' ? 'world' : 'yours';
}

/** A file asked for while a house of yours picked up where it stands is in hand, which is refused. */
export function homeStaysText(name: string): string {
  return `${name} is yours and moves where it stands: a house goes into a file from the Housing tab with Permanent on`;
}

/** The first save to a file in a session asks a second click, and says where L would keep it instead. */
export function confirmText(dest: PlacementLayer, world: string, layerKey: string, next: Destination): string {
  return `click again to save to ${destinationFile(dest, world)} · ${layerKey} for ${destinationName(next)} instead`;
}

/** A refused spot in a permanent destination is placed anyway on a second click; a first save says its file too. */
export function forceText(why: string | null, dest: PlacementLayer, world: string, unconfirmed: boolean): string {
  return `refused: ${why ?? 'not here'} · click again to place it anyway${unconfirmed ? ` in ${destinationFile(dest, world)}` : ''}`;
}

/** What L says as it moves where the thing in hand is kept. */
export function keptText(name: string, dest: Destination, world: string): string {
  return dest === 'yours' ? `${name}: yours when it is put down` : `${name}: saved to ${destinationFile(dest, world)} when it is put down`;
}

/** What a save says on the message line: the file and the id, every time. */
export function savedText(file: string, id: string): string {
  return `saved to ${file} as ${id}`;
}

/** What taking a permanent row in hand says. */
export function pickedUpText(label: string, layer: PlacementLayer): string {
  return `picked up the ${label} (permanent · ${layer})`;
}

/** What taking one out of its file says. */
export function removedText(id: string, file: string): string {
  return `${id} is taken out of ${file}`;
}

/** A click asking to keep a permanent thing as yours, which is refused. */
export function notYoursText(delKey: string): string {
  return `a permanent thing cannot become yours: ${delKey} removes it from its file`;
}

/**
 * The pick-up key again, Delete or the bar's Put away with a permanent row in hand: it is taken out of a file
 * every player is handed, so the first press only asks, and a second within `confirmMs` takes it out.
 */
export function takeOutText(id: string, file: string): string {
  return `press again to take ${id} out of ${file} · cancel puts it back where it stood`;
}

/** A row in hand is the hand's until it is put down: the panel and the console change nothing of it meanwhile. */
export function inHandText(id: string, delKey: string, deleting: boolean): string {
  return deleting ? `${id} is in your hand: ${delKey} there takes it out of its file` : `${id} is in your hand: put it down first`;
}

/**
 * How far the ground under a row has moved since it was put there, metres (signed: up is the ground risen), or
 * null when it has not moved past `drift`, or when nothing says. A row the editor saved carries the ground it was
 * judged on (`ground`), and is measured against that, so a building raised or sunk on purpose is not taken for
 * one the ground moved under. A row written by hand carries none: a building is then taken to have stood on the
 * ground, and a prop, which may stand on something on purpose, is said to have moved only once the ground has
 * risen over it. `now` is the ground under it now, `y` the height it stands at.
 */
export function groundMoved(row: Pick<PlacementRow, 'kind' | 'ground'>, y: number, now: number, drift: number): number | null {
  if (row.ground !== undefined) {
    const d = now - row.ground;
    return Math.abs(d) > drift ? d : null;
  }
  const over = y - now;
  if (row.kind === 'building') return Math.abs(over) > drift ? -over : null;
  return -over > drift ? -over : null;
}

/** What the Standing here list says of a row the ground has moved under. */
export function driftText(moved: number, measured: boolean): string {
  const by = `${Math.abs(moved).toFixed(1)} m`;
  return measured ? `the ground under it has ${moved > 0 ? 'risen' : 'fallen'} ${by} since it was put there` : `the ground stands ${by} ${moved > 0 ? 'over' : 'under'} it`;
}

/** A row's place, rounded to the millimetre, as a file is easier read with it. */
function mm(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * The State choice the editor's list offers a row on a world with states, in order: every state (`''`), then each
 * value of each state the world has (`restuss=living`, `restuss=ruins`). `next` is the one after `now`, round.
 */
export function nextStateChoice(now: string | undefined, tags: readonly string[]): string {
  const all = ['', ...tags];
  const i = all.indexOf(now ?? '');
  return all[(i + 1) % all.length];
}

/** A state choice in words, as the list's button says it. */
export function stateChoiceText(tag: string | undefined): string {
  if (!tag) return 'every state';
  const eq = tag.indexOf('=');
  return eq > 0 ? `${tag.slice(0, eq)} ${tag.slice(eq + 1)} only` : tag;
}

/** What a row written again keeps of the row it was: its id and everything the owner set by hand. */
function keepOf(base: PlacementRow | null | undefined): Partial<PlacementRow> {
  if (!base) return {};
  const out: Partial<PlacementRow> = { id: base.id };
  if (base.solid !== undefined) out.solid = base.solid;
  if (base.guard !== undefined) out.guard = base.guard;
  if (base.clear !== undefined) out.clear = base.clear;
  if (base.name !== undefined) out.name = base.name;
  if (base.note !== undefined) out.note = base.note;
  // And the world state it stands in (rubble placed for Restuss's ruins), set from the editor's list.
  if (base.state !== undefined) out.state = base.state;
  return out;
}

/** The ground a row was judged on, written out in the open only: a room's floor is not the ground, and moves with nothing. */
function withGround(row: DraftRow, ground: number | null | undefined): DraftRow {
  if (!row.inside && typeof ground === 'number' && Number.isFinite(ground)) row.ground = mm(ground);
  return row;
}

/**
 * The row a prop in hand is saved as: the props catalogue's thing, its place and its whole turn (three's
 * `[x, y, z, w]`) carried into the file's frame (`fromGame`), whether it stands in a room, and out in the open
 * the ground's height under it now (`ground`, null in a space zone), which the editor's list measures the ground
 * against later. A row picked up and saved again (`base`) keeps its id and what the owner set on it by hand
 * (solid, guard, clear, name, note); a thing never saved has no id, which the endpoint gives it.
 */
export function rowFromProp(def: { id: string }, at: { x: number; y: number; z: number }, turn: readonly [number, number, number, number], inside: boolean, centre: { x: number; z: number } | null, frame: PlacementFrame, base?: PlacementRow | null, ground?: number | null): DraftRow {
  const g = fromGame({ x: at.x, y: at.y, z: at.z, q: [turn[0], turn[1], turn[2], turn[3]] }, centre, frame);
  const row: DraftRow = { kind: 'prop', pack: 'props', thing: def.id, x: mm(g.x), y: mm(g.y), z: mm(g.z), q: g.q, ...keepOf(base) };
  if (inside) row.inside = true;
  return withGround(row, ground);
}

/**
 * What the world editor takes in hand out of its library, as a row writes it: a props thing, a gallery model, or a model
 * of a world's own pack (this world's, or another's named in `from`), with the object template it really is wherever one
 * is known, so a world's brazier burns and a world's chair counts as the world's own wherever it is put.
 */
export interface EditorSource {
  kind: 'prop' | 'building';
  pack: PlacementPack;
  thing?: string;
  model?: string;
  template?: string | null;
  /** The ground world a world model comes from; null or this world's own pack id writes none. */
  from?: string | null;
  deed?: string | null;
}

/** A number cut to `digits` decimals, as the editor writes a turn: a diff that reads, which the reader renormalises. */
function cut(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

/**
 * The row the world editor writes for a thing put down, from wherever its library entry came: its place in the file's
 * frame to `mm` metres (1 mm), its **whole** turn (three's `[x, y, z, w]`, a building tipped too: the editor allows it,
 * with a note) to `turnDigits` decimals, whether it stands in a room, the flora it keeps off (`clear`, the caller's from
 * the model's own footprint, held under the reader's backstop), the template it really is, the world its model comes
 * from (written absent when it is this world), and out in the open the ground under it now. A row picked up and put
 * down again (`base`) keeps its id and what was set on it by hand, its own `clear` among them.
 */
export function rowFromEditor(
  src: EditorSource,
  at: { x: number; y: number; z: number },
  turn: readonly [number, number, number, number],
  inside: boolean,
  centre: { x: number; z: number } | null,
  frame: PlacementFrame,
  opts: { here: string; clear?: number; ground?: number | null; base?: PlacementRow | null; mm?: number; turnDigits?: number } = { here: '' },
): DraftRow {
  const g = fromGame({ x: at.x, y: at.y, z: at.z, q: [turn[0], turn[1], turn[2], turn[3]] }, centre, frame);
  const step = opts.mm && opts.mm > 0 ? opts.mm : 0.001;
  const place = (v: number) => Math.round(v / step) * step;
  const digits = opts.turnDigits ?? 6;
  const row: DraftRow = { kind: src.kind, pack: src.pack, x: mm(place(g.x)), y: mm(place(g.y)), z: mm(place(g.z)), q: [cut(g.q[0], digits), cut(g.q[1], digits), cut(g.q[2], digits), cut(g.q[3], digits)], ...keepOf(opts.base) };
  if (src.pack === 'props') row.thing = src.thing;
  else row.model = src.model;
  // A gallery row picked up and put down keeps its deed, as the Housing tab's own save keeps it (`rowFromHouse`): the
  // endpoint's put writes the whole row, and a deed dropped here is gone from the file, and with it the building's way
  // back to its deed.
  const deed = src.deed ?? (src.pack === 'gallery' && opts.base?.pack === 'gallery' ? opts.base.deed : null);
  if (deed) row.deed = deed;
  if (src.pack !== 'props' && src.template) row.template = src.template;
  if (src.pack === 'world' && src.from && src.from !== opts.here) row.from = src.from;
  if (inside) row.inside = true;
  if (opts.base?.clear === undefined && opts.clear !== undefined && opts.clear > 0) row.clear = Math.min(PLACEMENT_LIMITS.circle, Math.round(opts.clear * 10) / 10);
  return withGround(row, opts.ground);
}

/** The turn about up three's `[x, y, z, w]` holds for a yaw, radians (three's sense). */
export function yawTurn(yaw: number): GamePlace['q'] {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/** The yaw a turn about up holds (three's `[x, y, z, w]`), radians; a building is only ever turned about up. */
export function yawOfTurn(q: readonly [number, number, number, number]): number {
  return 2 * Math.atan2(q[1], q[3]);
}

/**
 * The row a building in hand is saved as: the gallery's model, its deed where it came from one, where the
 * ghost stands it (its doorstep on the ground, the player's lift in it) turned about up, carried into the
 * file's frame, the flora it keeps off (`clear`, the patch's own reach, within what a file may hold), and the
 * ground's height under its doorstep now (`ground`), so a building raised or sunk on purpose is never taken
 * later for one the ground moved under. A row picked up and saved again keeps its id, its deed (one whose deed
 * this build cannot make it from is taken up by its model, and the file's deed is still the owner's word) and
 * what the owner set on it by hand, its clear measured again.
 */
export function rowFromHouse(state: { x: number; y: number; z: number; yaw: number; clear: number }, model: string, deed: string | null, centre: { x: number; z: number } | null, frame: PlacementFrame, base?: PlacementRow | null, ground?: number | null): DraftRow {
  const g = fromGame({ x: state.x, y: state.y, z: state.z, q: yawTurn(state.yaw) }, centre, frame);
  const clear = Math.min(PLACEMENT_LIMITS.circle, Math.max(0, Math.round(state.clear * 10) / 10));
  const row: DraftRow = { kind: 'building', pack: 'gallery', model, x: mm(g.x), y: mm(g.y), z: mm(g.z), q: g.q, ...keepOf(base), clear };
  const d = deed ?? base?.deed ?? null;
  if (d) row.deed = d;
  if (base?.inside) row.inside = true;
  return withGround(row, ground);
}
