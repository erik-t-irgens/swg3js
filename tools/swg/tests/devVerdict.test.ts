// The world editor's verdict (DESIGN.md §2.4): every rule a player meets is still worked out, in the very same words,
// and the editor's path returns them as notes and never refuses. Over a table of fixed spots -- a synthetic terrain, a
// blocker, water, a story row's guard -- the player's own path (`ghostVerdict`, `propVerdict`) answers exactly the
// words 5a4e765 answers: the strings below were taken once by running 5a4e765's `housePlace.ts`, `propPlace.ts` and
// `placeGhost.ts` over these very spots (both of the first unchanged since, the third only added to), and are held here
// as literals, so a later change to a player's words fails here rather than reading as the editor's own.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ghostVerdict } from '../../../src/world/placeGhost.ts';
import { patchOfBounds } from '../../../src/world/housePlace.ts';
import { propVerdict } from '../../../src/world/propPlace.ts';
import { OLDER_ENDPOINT, PASSABLE_NOTE, TILTED_NOTE, buildingNotes, editorRefusal, limitNotes, notesLine, olderEndpoint, propNotes, refusalWords } from '../../../src/editor/devVerdict.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** 5a4e765's words over these spots, literally. */
const PRE_PASS_WORDS = {
  rising: 'the ground stands 7.2 m over the doorstep, and 2.5 is the most a house will take',
  steep: 'the ground slopes 19 degrees under it, and 15 is the most',
  liftedNote: 'the door will stand 4.00 m over the ground, out of reach of a plain jump',
  water: 'that is under water',
  blocked: 'something is already standing there',
  unknown: 'the ground there is not known yet',
  buried: 'it would be buried',
  wall: 'it is inside a wall',
  guard: 'that is part of this world (TEST yard)',
};

const patch = patchOfBounds({ min: [-10, -16, -10], max: [10, 8, 10] });
const small = patchOfBounds({ min: [-2, -1, -2], max: [2, 3, 2] });
const flat = () => 0;
const none = () => -Infinity;
const nothing = () => [];
const at = { x: 0, z: 0 };
const blocker = () => [{ x: 3, z: 3, radius: 6, template: 'object/building/tatooine/shared_test_hut.iff' }];
const houses: [keyof typeof PRE_PASS_WORDS, typeof patch, Parameters<typeof ghostVerdict>[3], number][] = [
  ['rising', patch, { heightAt: (x) => (x > 0 ? x * 0.6 : 0), waterAt: none, standing: nothing }, 0],
  ['steep', small, { heightAt: (x) => x * 0.35, waterAt: none, standing: nothing }, 0],
  ['water', patch, { heightAt: flat, waterAt: () => 1, standing: nothing }, 0],
  ['blocked', patch, { heightAt: flat, waterAt: none, standing: blocker }, 0],
  ['unknown', patch, { heightAt: () => Number.NaN, waterAt: none, standing: nothing }, 0],
];

for (const [spot, p, deps, lift] of houses) {
  const player = ghostVerdict(p, at, 0, deps, lift);
  ok(!player.ok && player.why === PRE_PASS_WORDS[spot], `a player's house ${spot}: refused in 5a4e765's words (“${player.why}”)`);
  const editor = buildingNotes(p, at, 0, deps, lift, false, { notes: [], y: 0, blocker: null, refuses: false });
  ok(editor.notes.includes(PRE_PASS_WORDS[spot]) && editor.refuses, `the editor's: the same words as a note, the ghost's box in warn (${notesLine(editor.notes)})`);
}
{
  const clearDeps = { heightAt: flat, waterAt: none, standing: nothing };
  ok(ghostVerdict(patch, at, 0, clearDeps).ok, 'on clear, level ground a player may put a house down');
  const clear = buildingNotes(patch, at, 0, clearDeps, 0, false, { notes: [], y: 0, blocker: null, refuses: false });
  ok(clear.notes.length === 0 && !clear.refuses, 'and the editor has nothing to note');
  const lifted = ghostVerdict(patch, at, 0, clearDeps, 4);
  ok(lifted.ok && lifted.note === PRE_PASS_WORDS.liftedNote, "a door left high is a player's note, never a refusal");
  const liftedEd = buildingNotes(patch, at, 0, clearDeps, 4, false, { notes: [], y: 0, blocker: null, refuses: false });
  ok(liftedEd.notes.includes(PRE_PASS_WORDS.liftedNote) && !liftedEd.refuses, 'and the editor says it the same, with the box in ink');
  const blocked = buildingNotes(patch, at, 0, { heightAt: flat, waterAt: none, standing: blocker }, 0, false, { notes: [], y: 0, blocker: null, refuses: false });
  ok(blocked.blocker === 'test hut' || (blocked.blocker ?? '').length > 0, `and names what is in the way (${blocked.blocker})`);
  const tilted = buildingNotes(patch, at, 0, clearDeps, 0, true, { notes: [], y: 0, blocker: null, refuses: false });
  ok(tilted.notes.includes(TILTED_NOTE), 'a building tipped or rolled says what nobody has tried');
}

const box = { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };
const q = { x: 0, y: 0, z: 0, w: 1 };
const props: [keyof typeof PRE_PASS_WORDS, { x: number; y: number; z: number }, { floorAt(): number; solidAt(): boolean; reserved?: () => string | null }][] = [
  ['buried', { x: 0, y: -2, z: 0 }, { floorAt: () => 0, solidAt: () => false }],
  ['wall', { x: 0, y: 0, z: 0 }, { floorAt: () => 0, solidAt: () => true }],
  ['guard', { x: 0, y: 0, z: 0 }, { floorAt: () => 0, solidAt: () => false, reserved: () => 'TEST yard' }],
];
for (const [spot, place, deps] of props) {
  const player = propVerdict(box, place, q, deps);
  ok(!player.ok && player.why === PRE_PASS_WORDS[spot], `a player's prop ${spot}: refused in 5a4e765's words (“${player.why}”)`);
  const notes = propNotes(box, place, q, deps, false, []);
  ok(notes.includes(PRE_PASS_WORDS[spot]), `the editor's: the same words as a note (${notesLine(notes)})`);
}
{
  ok(propVerdict(box, { x: 0, y: 0, z: 0 }, q, { floorAt: () => 0, solidAt: () => false }).ok, 'a prop on clear ground is let stand');
  ok(propNotes(box, { x: 0, y: 0, z: 0 }, q, { floorAt: () => 0, solidAt: () => false }, false, []).length === 0, 'with nothing to note');
  ok(propNotes(box, { x: 0, y: 0, z: 0 }, q, { floorAt: () => 0, solidAt: () => false }, true, []).includes(PASSABLE_NOTE), 'a seat or a table notes it stands passable');
}

{
  // Spots that fail several rules at once: the player's path stops at the first, the editor's says every one, in the
  // player's own order -- the editor's whole difference from the player's verdict.
  const all = { heightAt: (x: number) => (x > 0 ? x * 0.6 : 0), waterAt: () => 100, standing: blocker };
  const player = ghostVerdict(patch, at, 0, all, 0);
  ok(!player.ok && player.why === PRE_PASS_WORDS.rising, `a player's house on rising ground under water with a hut in the way is refused for the first alone (“${player.why}”)`);
  const ed = buildingNotes(patch, at, 0, all, 0, false, { notes: [], y: 0, blocker: null, refuses: false });
  const iR = ed.notes.indexOf(PRE_PASS_WORDS.rising);
  const iW = ed.notes.indexOf(PRE_PASS_WORDS.water);
  const iB = ed.notes.indexOf(PRE_PASS_WORDS.blocked);
  ok(iR >= 0 && iW > iR && iB > iW && ed.refuses, `the editor says all three, the ground first, then the water, then what is in the way (${notesLine(ed.notes)})`);
  const waterAndBlocked = buildingNotes(patch, at, 0, { heightAt: flat, waterAt: () => 1, standing: blocker }, 0, false, { notes: [], y: 0, blocker: null, refuses: false });
  ok(waterAndBlocked.notes.length === 2 && waterAndBlocked.notes[0] === PRE_PASS_WORDS.water && waterAndBlocked.notes[1] === PRE_PASS_WORDS.blocked, `and on level ground, the water and what is in the way both (${notesLine(waterAndBlocked.notes)})`);
  const gb = propNotes(box, { x: 0, y: -2, z: 0 }, q, { floorAt: () => 0, solidAt: () => false, reserved: () => 'TEST yard' }, false, []);
  ok(gb.length === 2 && gb[0] === PRE_PASS_WORDS.guard && gb[1] === PRE_PASS_WORDS.buried, `a prop buried inside a story row's guard says both, the guard first, as the player's rule asks it (${notesLine(gb)})`);
  const bw = propNotes(box, { x: 0, y: -2, z: 0 }, q, { floorAt: () => 0, solidAt: () => true }, false, []);
  ok(bw.length === 2 && bw[0] === PRE_PASS_WORDS.buried && bw[1] === PRE_PASS_WORDS.wall, `one both buried and in a wall says both, buried first (${notesLine(bw)})`);
  const gbw = propNotes(box, { x: 0, y: -2, z: 0 }, q, { floorAt: () => 0, solidAt: () => true, reserved: () => 'TEST yard' }, true, []);
  ok(gbw.length === 4 && gbw[0] === PRE_PASS_WORDS.guard && gbw[1] === PRE_PASS_WORDS.buried && gbw[2] === PRE_PASS_WORDS.wall && gbw[3] === PASSABLE_NOTE, `and a seat all three, then that it stands passable (${notesLine(gbw)})`);
}

{
  // The two building tests are the player's own functions, asked by both paths: nothing in the editor's verdict writes
  // them out again, and the player's verdict asks them.
  const here = dirname(fileURLToPath(import.meta.url));
  const dev = readFileSync(join(here, '..', '..', '..', 'src', 'editor', 'devVerdict.ts'), 'utf8').replace(/\r\n/g, '\n');
  const ghost = readFileSync(join(here, '..', '..', '..', 'src', 'world', 'placeGhost.ts'), 'utf8').replace(/\r\n/g, '\n');
  const gv = ghost.slice(ghost.indexOf('export function ghostVerdict('), ghost.indexOf('\n}\n', ghost.indexOf('export function ghostVerdict(')));
  ok(!dev.includes('deps.waterAt(') && !dev.includes('deps.standing(') && dev.includes('probesUnderWater(probes, HEIGHTS, deps)') && dev.includes('standingIn(mid.x, mid.z, clear, deps)'), "the editor's notes ask the player's own water and standing tests, written out nowhere else");
  ok(gv.includes('probesUnderWater(probes, HEIGHTS, deps)') && gv.includes('standingIn(mid.x, mid.z, clear, deps)'), "and the player's verdict asks the very same two");
}

{
  // The files' soft lines are notes; an older endpoint's refusal says to restart the dev server.
  const none = limitNotes('public/placements/world/tatooine.json', 120, 20000, Number.NaN, 30, 0, 64, []);
  ok(none.length === 0, 'a small file and a circle within the old cap say nothing');
  const big = limitNotes('public/placements/world/tatooine.json', 20001, 20000, 412.4, 130, 80, 64, []);
  ok(big.length === 3 && big[0].includes('20001 rows') && big[0].includes('every release') && big[0].includes('412 ms') && big[1].includes('130 m') && big[2].includes('guard'), `past them, the file's size and what a write took, the flora circle and the guard (${big.join(' · ')})`);
  ok(!limitNotes('f', 20001, 20000, Number.NaN, 0, 0, 64, [])[0].includes('ms'), 'with no write yet, no time is said');
  const old = 'that row is refused: it carries fields this build does not write: template';
  ok(olderEndpoint(old) && refusalWords(old).endsWith(OLDER_ENDPOINT), `an older endpoint's refusal of a new field says to restart it (“${refusalWords(old)}”)`);
  ok(olderEndpoint('public/placements/world/x.json holds 2000 rows, as many as a file may') && olderEndpoint('that row is refused: clear is a number of metres from 0 to 64'), 'and so do its old row cap and its old 64 m circle');
  ok(!olderEndpoint('public/placements/world/x.json holds 100000 rows, as many as a file may') && refusalWords('that id is in the story file') === 'that id is in the story file', "and today's own refusals say only themselves");
}

{
  ok(editorRefusal('ground', true) === null && editorRefusal('ground', false) === null, 'the editor refuses nothing on a ground world');
  ok(editorRefusal('space', false) === null, 'a prop stands in space (space maps are wanted later)');
  ok(/space/.test(editorRefusal('space', true) ?? '') && /later pass|not this pass|this pass/.test(editorRefusal('space', true) ?? ''), `a building in space is refused in words that say not this pass (“${editorRefusal('space', true)}”)`);
  ok(/copies/.test(editorRefusal('copies', false) ?? ''), "anything in the dungeons' world of copies is refused");
  ok(/streamer/.test(editorRefusal('none', false) ?? ''), 'and a world that stands nothing says so');
}

console.log(`\n${checks} checks passed`);
