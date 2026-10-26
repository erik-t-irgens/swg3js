// The world editor's verdict (DESIGN.md §2.4): every placing rule a player meets is still worked out, and its words go on
// the editor's bar as notes (the ghost's box turns `warn`), but the click places all the same -- "as a developer, I should
// be unlimited". The player's own path answers exactly what it always answered: `ghostVerdict` and `propVerdict` turn
// their first failing rule into a refusal; this works out **every** rule beside them, in the very same words, as a list,
// and asks the very same tests to do it -- the ground's (`groundVerdict`), the water's and what stands in the way
// (`probesUnderWater`, `standingIn`, which `ghostVerdict` asks too) and the prop's (`propVerdict`) -- so the two can never
// part. Only the order of asking differs: the player's stops at the first.
//
// What still refuses in the editor is kept apart (`editorRefusal`), each for a reason a note would not make true: a
// building in a space zone (the layer skips the row, so a note would lie), any placement in the dungeons' world of copies
// (a row at one raw place stands in one copy of 48), and a world that stands nothing at all.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

import { HOUSE_TUNE, blockerName, clearRadius, groundVerdict, patchMiddle, patchProbes, type GroundVerdict, type Patch } from '../world/housePlace.ts';
import { PROP_TUNE, propVerdict, type PropBox, type PropTurn, type PropVerdict } from '../world/propPlace.ts';
import { ALREADY_STANDING, UNDER_WATER, probesUnderWater, standingIn, type GhostDeps } from '../world/placeGhost.ts';

/** The probes, their heights, the ground's verdict and the middle, kept: a frame of notes makes nothing beyond its list. */
const PROBES: { x: number; z: number }[] = [];
const HEIGHTS: number[] = [];
const VERDICT: GroundVerdict = { ok: false, y: 0, rise: 0, sink: 0, slope: 0, why: null, note: null };
const MIDDLE = { x: 0, z: 0 };

/** The words a building tipped or rolled is put down with: the editor allows it, and says what nobody has tried. */
export const TILTED_NOTE = "a tilted building's floors, lifts and indoor paths are untested";
/** The words a seat or table out of the props pack is put down with: it stands passable unless its row says solid. */
export const PASSABLE_NOTE = 'a seat or a table stands passable unless its row says solid';

/** What a building's notes are worked out from: the patch, where its origin stands, its yaw, and the lift. */
export interface BuildingNotes {
  /** Every rule's words, the player's own, in the player's order. */
  notes: string[];
  /** The ground's own height under the doorstep with the lift (what a player's house would stand at), or NaN. */
  y: number;
  /** What is in the way, by the template it was placed under, or null: the bar names it. */
  blocker: string | null;
  /** Whether a player would be refused here (the door's note and the editor's own are notes to a player too). */
  refuses: boolean;
}

/**
 * Every rule a player's building is held to, at `at` turned by `yaw` with `lift`, as notes in the player's own words:
 * the ground's (not known, rising over the doorstep, falling away, too steep: `groundVerdict`'s first failing rule, as a
 * player would read it) and the door's note; under the water; something already standing there (and its name, for the
 * bar). A player's ghost (`ghostVerdict`) stops at the first and refuses; this goes on and refuses nothing. `tilted`
 * adds the editor's own note for a building tipped or rolled.
 */
export function buildingNotes(patch: Patch, at: { x: number; z: number }, yaw: number, deps: GhostDeps, lift: number, tilted: boolean, out: BuildingNotes): BuildingNotes {
  out.notes.length = 0;
  out.blocker = null;
  out.refuses = false;
  const probes = patchProbes(patch, at, yaw, HOUSE_TUNE.margin, PROBES);
  HEIGHTS.length = probes.length;
  for (let i = 0; i < probes.length; i++) HEIGHTS[i] = deps.heightAt(probes[i].x, probes[i].z);
  const v = groundVerdict(probes, HEIGHTS, HOUSE_TUNE, lift, VERDICT);
  out.y = v.y;
  if (v.why) {
    out.notes.push(v.why);
    out.refuses = true;
  }
  if (v.note) out.notes.push(v.note);
  // The player's own two tests (`placeGhost.ts`), asked here too rather than written out again, so the two never part.
  if (probesUnderWater(probes, HEIGHTS, deps)) {
    out.notes.push(UNDER_WATER);
    out.refuses = true;
  }
  const clear = clearRadius(patch);
  const mid = patchMiddle(patch, at, yaw, MIDDLE);
  const s = standingIn(mid.x, mid.z, clear, deps);
  if (s) {
    out.notes.push(ALREADY_STANDING);
    out.blocker = blockerName(s.template);
    out.refuses = true;
  }
  if (tilted) out.notes.push(TILTED_NOTE);
  return out;
}

/** The prop's verdict without the guard, kept. */
const PROP_SAID: PropVerdict = { ok: true, why: null, inside: 0, of: 0, clearance: 0 };

/**
 * Every rule a player's prop is held to, as notes in the player's own words: inside a story row's guard ("that is part of
 * this world (...)"), buried, inside a wall. `propVerdict` answers the first and refuses; this answers every one.
 * `passable` adds the note for a seat or a table, which stands passable unless its row says solid.
 */
export function propNotes(box: PropBox | null, at: { x: number; y: number; z: number }, q: PropTurn, deps: { floorAt(x: number, y: number, z: number): number | null; solidAt(x: number, y: number, z: number): boolean; reserved?: (x: number, z: number, r: number) => string | null }, passable: boolean, out: string[]): string[] {
  out.length = 0;
  if (deps.reserved) {
    const r = box ? Math.max(Math.abs(box.max[0] - box.min[0]), Math.abs(box.max[2] - box.min[2])) / 2 : 0;
    const taken = deps.reserved(at.x, at.z, r);
    if (taken !== null) out.push(`that is part of this world (${taken})`);
  }
  // The two rules of the thing itself, with the guard taken out so the first does not hide them.
  const v = propVerdict(box, at, q, { floorAt: deps.floorAt, solidAt: deps.solidAt }, PROP_TUNE, PROP_SAID);
  if (v.why) out.push(v.why);
  // Buried is said first by the player's rule; a thing both buried and in a wall says both here.
  if (v.why === 'it would be buried' && v.of > 0 && v.inside / v.of >= PROP_TUNE.buriedShare) out.push('it is inside a wall');
  if (passable) out.push(PASSABLE_NOTE);
  return out;
}

/** What kind of world a row would go into, as the editor asks it. */
export type EditWorld = 'ground' | 'space' | 'copies' | 'none';

/**
 * What still refuses in the editor, or null: each for a reason a note would not make true. A building in a space zone
 * (the permanent layer skips the row: a question for the owner, and Map-maker II's later pass of space maps), any
 * placement in the dungeons' world of copies (one raw place stands in one copy of 48), and a world that stands nothing.
 */
export function editorRefusal(world: EditWorld, building: boolean): string | null {
  if (world === 'none') return 'this world stands nothing: it has no streamer';
  if (world === 'copies') return "nothing is put down for good in the dungeons' world of copies (a row would stand in one copy of 48)";
  if (world === 'space' && building) return 'no building stands in a space zone this pass (space maps are a later pass); a prop does';
  return null;
}

/**
 * The notes past the files' soft lines (DESIGN.md §2.4): a file past `rowsNote` rows says how many it holds, that it
 * ships in every release and what the last write took (`writeMs`, the endpoint's answer timed; NaN for none yet); a
 * flora circle (`clear`) or a story row's guard (`guard`) past `circleNote` metres says it is past the old cap. Written
 * into `out` after what is there.
 */
export function limitNotes(file: string, rows: number, rowsNote: number, writeMs: number, clear: number, guard: number, circleNote: number, out: string[]): string[] {
  if (rows > rowsNote) out.push(`${file} holds ${rows} rows (past ${rowsNote}): it ships in every release${Number.isFinite(writeMs) ? `, and the last write took ${Math.round(writeMs)} ms` : ''}`);
  if (clear > circleNote) out.push(`it keeps the flora off ${Math.round(clear * 10) / 10} m round it, past the old cap of ${circleNote} m`);
  if (guard > circleNote) out.push(`its guard reaches ${Math.round(guard * 10) / 10} m, past the old cap of ${circleNote} m`);
  return out;
}

/** What the editor adds to a refusal an older endpoint gave (the dev server runs the endpoint code it first loaded until it restarts). */
export const OLDER_ENDPOINT = 'the dev server is running an older endpoint: restart it';

/**
 * Whether a write's refusal is an older endpoint's (one loaded before this pass, which a running dev server keeps until it
 * restarts): a field it does not write (`template`, `from`), the old 2,000 rows a file, or the old 64 m circle.
 */
export function olderEndpoint(why: string): boolean {
  return /fields this build does not write|holds 2000 rows, as many as a file may|(clear|guard) is a number of metres from 0 to 64\b/.test(why);
}

/** A write's refusal, with the restart words where an older endpoint gave it. */
export function refusalWords(why: string): string {
  return olderEndpoint(why) ? `${why} -- ${OLDER_ENDPOINT}` : why;
}

/** The bar's line for a list of notes: none, or each said, separated. */
export function notesLine(notes: readonly string[]): string {
  return notes.length ? notes.join(' · ') : '';
}
