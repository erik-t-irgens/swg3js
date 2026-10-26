// The placement editor's own rules in the game (`src/world/permanentEdit.ts`): the row a prop or a building in
// hand is saved as, which the file's reader turns back into the very place and turn the ghost stood at, on a
// planet (the raw frame, the layout's centre off and x mirrored) and in a space zone (the game's own); what a
// row saved again keeps of the row it was; where L moves what is in hand, a permanent row never to yours; and
// the words the editor says, which name the file every time.
//
// Run: node tools/swg/tests/permanentEdit.test.ts
import assert from 'node:assert/strict';
import { PERMANENT_EDIT_TUNE, badgeOf, confirmText, destinationFile, destinationText, driftText, forceText, groundMoved, homeStaysText, inHandText, keptText, nextDestination, notYoursText, pickedUpText, rowFromHouse, rowFromProp, savedText, takeOutText, yawOfTurn, yawTurn, type Destination } from '../../../src/world/permanentEdit.ts';
import { readPlacementRow, toGame, type PlacementRow } from '../../../src/story/placements.ts';
import { dressingStandOf, standsSolid } from '../../../src/world/permanent.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

/** Two turns that are the same turn: equal, or each the other negated. */
const sameTurn = (a: readonly number[], b: readonly number[]) => {
  const d1 = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const d2 = Math.max(...a.map((v, i) => Math.abs(v + b[i])));
  return Math.min(d1, d2) < 1e-9;
};
/** A draft row as the reader cleans it, its id given. */
const cleaned = (draft: object, id = 'x'): PlacementRow => {
  const r = readPlacementRow({ ...draft, id });
  if (typeof r === 'string') throw new Error(r);
  return r;
};

// ---------------------------------------------------------------------------------------------
// A prop's row: its whole turn, back through the reader to the very place and turn it stood at.
{
  const centre = { x: 3500, z: -4700 };
  const half = Math.SQRT1_2;
  // A crate tipped a quarter about x and spun an eighth, in three's [x, y, z, w].
  const spin = [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)];
  const tip = [half, 0, 0, half];
  // q = spin * tip
  const turn: [number, number, number, number] = [
    spin[3] * tip[0] + spin[0] * tip[3] + spin[1] * tip[2] - spin[2] * tip[1],
    spin[3] * tip[1] - spin[0] * tip[2] + spin[1] * tip[3] + spin[2] * tip[0],
    spin[3] * tip[2] + spin[0] * tip[1] - spin[1] * tip[0] + spin[2] * tip[3],
    spin[3] * tip[3] - spin[0] * tip[0] - spin[1] * tip[1] - spin[2] * tip[2],
  ];
  const at = { x: 24.12345, y: 6.5, z: 6.2 };
  const draft = rowFromProp({ id: 'crate_s01' }, at, turn, true, centre, 'raw');
  ok(draft.id === undefined && draft.kind === 'prop' && draft.pack === 'props' && draft.thing === 'crate_s01' && draft.inside === true, 'a prop never saved is a props row of its thing, with no id for the endpoint to give it one');
  ok(draft.x === Math.round((centre.x - at.x) * 1000) / 1000 && draft.z === Math.round((at.z + centre.z) * 1000) / 1000, `written in the raw frame, the layout's centre off and x mirrored, to the millimetre (${draft.x}, ${draft.z})`);
  const g = toGame(cleaned(draft), centre, 'raw');
  ok(Math.abs(g.x - at.x) < 6e-4 && Math.abs(g.y - at.y) < 6e-4 && Math.abs(g.z - at.z) < 6e-4, `which the reader carries back to where it stood (${g.x.toFixed(4)}, ${g.y}, ${g.z.toFixed(4)})`);
  ok(sameTurn(g.q, turn), 'turned exactly as it stood, its tip and its spin both');
  // In a space zone the file is the game's own frame, read as it stands.
  const space = rowFromProp({ id: 'crate_s01' }, { x: 1500, y: 20, z: 900 }, turn, false, null, 'game');
  ok(space.x === 1500 && space.z === 900 && space.inside === undefined && sameTurn(toGame(cleaned(space), null, 'game').q, turn), "in a space zone its place and turn are the game's own");
  // Saved again from a row it was: its id and what the owner set by hand are kept.
  const base: PlacementRow = { id: 'eisley-bay22-locker', kind: 'prop', pack: 'props', thing: 'crate_s01', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], solid: false, guard: 3, clear: 2, name: 'Locker', note: 'the drawer', inside: true, at: 5 };
  const again = rowFromProp({ id: 'crate_s01' }, at, turn, false, centre, 'raw', base);
  ok(again.id === base.id && again.solid === false && again.guard === 3 && again.clear === 2 && again.name === 'Locker' && again.note === 'the drawer', 'a row saved again keeps its id, its solidity, its guard, its clear, its name and its note');
  ok(again.inside === undefined && again.at === undefined, 'but takes where it stands now from the hand (out in the open), and the endpoint stamps the moment');
  const plain = rowFromProp({ id: 'crate_s01' }, at, turn, false, centre, 'raw', { ...base, solid: undefined, name: undefined, note: undefined, guard: undefined, clear: undefined });
  ok(!('solid' in plain) && !('name' in plain) && !('guard' in plain), 'and a word the row did not have is not given one: an absent solid stays absent');
}

// ---------------------------------------------------------------------------------------------
// A building's row: turned about up only, its clear the patch's, back to where it stood.
{
  const centre = { x: 100, z: -50 };
  for (const yaw of [0, 0.4, Math.PI / 2, 2.9, 5.5]) {
    const state = { x: 30.5, y: 12.4, z: -7.25, yaw, clear: 14.53 };
    const draft = rowFromHouse(state, 'ply_tato_house_sm_s01_fp1', 'tatooine_house_small_deed', centre, 'raw');
    const g = toGame(cleaned(draft), centre, 'raw');
    const back = ((yawOfTurn(g.q) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    ok(Math.abs(g.x - state.x) < 6e-4 && Math.abs(g.y - state.y) < 6e-4 && Math.abs(g.z - state.z) < 6e-4 && Math.abs(back - yaw) < 1e-9 && draft.clear === 14.5 && draft.deed === 'tatooine_house_small_deed' && draft.kind === 'building' && draft.pack === 'gallery', `a building turned ${yaw.toFixed(2)} rad comes back where it stood, turned the same (${back.toFixed(4)}), its clear to the decimetre`);
  }
  // What a file may hold is the backstop the world editor's pass raised from 64 m to 2,000 (`PLACEMENT_LIMITS.circle`).
  const noDeed = rowFromHouse({ x: 0, y: 0, z: 0, yaw: 0, clear: 2500 }, 'ply_tato_cantina', null, centre, 'raw');
  ok(noDeed.deed === undefined && noDeed.clear === 2000, 'one taken by its model alone has no deed, and its clear is held to what a file may hold');
  ok(sameTurn(yawTurn(1.2), [0, Math.sin(0.6), 0, Math.cos(0.6)]) && Math.abs(yawOfTurn(yawTurn(-0.7)) + 0.7) < 1e-12, 'a yaw is a turn about up, and back');
  // A row picked up by its model (its deed not one this build makes it from) and saved again keeps the deed its
  // file names: the endpoint's put replaces the whole row, so a deed left off here was gone from the file.
  const deeded: PlacementRow = { id: 'anchorhead-house-1', kind: 'building', pack: 'gallery', model: 'ply_tato_house_sm_s01_fp1', deed: 'tatooine_house_small_deed', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], name: 'House' };
  const resaved = rowFromHouse({ x: 1, y: 2, z: 3, yaw: 0.5, clear: 12 }, deeded.model!, null, centre, 'raw', deeded);
  ok(resaved.deed === 'tatooine_house_small_deed' && resaved.id === 'anchorhead-house-1' && resaved.name === 'House', 'a building taken up by its model and saved again keeps the deed its row named, with its id and words');
  ok(rowFromHouse({ x: 1, y: 2, z: 3, yaw: 0, clear: 12 }, deeded.model!, 'naboo_house_small_deed', centre, 'raw', deeded).deed === 'naboo_house_small_deed', 'while a deed in hand is the one written');
}

// ---------------------------------------------------------------------------------------------
// The ground it was judged on: written out in the open, measured against later, so a building raised or sunk
// on purpose is not taken for one the ground moved under.
{
  const centre = { x: 0, z: 0 };
  const house = rowFromHouse({ x: 5, y: 15.4, z: 5, yaw: 0, clear: 10 }, 'ply_tato_house_sm_s01_fp1', null, centre, 'raw', null, 12.3456);
  ok(house.ground === 12.346 && cleaned(house).ground === 12.346, `a building saved out in the open carries the ground under its doorstep, to the millimetre, and the reader keeps it (${house.ground})`);
  const prop = rowFromProp({ id: 'crate_s01' }, { x: 1, y: 2, z: 3 }, [0, 0, 0, 1], false, centre, 'raw', null, 1.5);
  const roomProp = rowFromProp({ id: 'crate_s01' }, { x: 1, y: 2, z: 3 }, [0, 0, 0, 1], true, centre, 'raw', null, 1.5);
  ok(prop.ground === 1.5 && roomProp.ground === undefined && rowFromProp({ id: 'crate_s01' }, { x: 1, y: 2, z: 3 }, [0, 0, 0, 1], false, null, 'game', null, null).ground === undefined, "so does a prop in the open; one in a room, or in a space zone, carries none");
  ok(rowFromHouse({ x: 5, y: 15, z: 5, yaw: 0, clear: 10 }, 'm', null, centre, 'raw', { id: 'h', kind: 'building', pack: 'gallery', model: 'm', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], ground: 99 }, 11).ground === 11, 'and a row saved again is measured again where it stands now, never the ground it stood on before');
  const tune = 0.5;
  ok(groundMoved({ kind: 'building', ground: 12.3 }, 15.4, 12.3, tune) === null, 'a building raised three metres on purpose over ground that has not moved is not flagged');
  ok(groundMoved({ kind: 'building', ground: 12 }, 15.5, 13, tune) === 1 && driftText(1, true) === 'the ground under it has risen 1.0 m since it was put there', 'while the ground under it risen a metre since is, in those words');
  ok(groundMoved({ kind: 'prop', ground: 4 }, 4, 3.2, tune) !== null && driftText(-0.8, true).includes('fallen 0.8 m'), 'a prop the same, either way, against the ground it was saved on');
  ok(groundMoved({ kind: 'building' }, 3, 0, tune) === -3 && driftText(-3, false) === 'the ground stands 3.0 m under it' && groundMoved({ kind: 'building' }, 0.2, 0, tune) === null, 'a row written by hand, with no ground of its own, is taken to stand on the ground: a building is flagged off it either way');
  ok(groundMoved({ kind: 'prop' }, 3, 0, tune) === null && groundMoved({ kind: 'prop' }, 0, 1, tune) === 1, 'and a prop only once the ground has risen over it, since it may stand on something on purpose');
}

// ---------------------------------------------------------------------------------------------
// L, and the words.
{
  const round = (start: Destination, kind: 'fresh' | 'local' | 'permanent', n: number) => {
    const seen: Destination[] = [];
    let d = start;
    for (let i = 0; i < n; i++) seen.push((d = nextDestination(d, kind)));
    return seen.join(' ');
  };
  ok(round('yours', 'fresh', 3) === 'story world yours', 'taken fresh: yours, the story, the world edits, and round');
  ok(round('yours', 'local', 3) === 'story world yours', 'one of yours picked up the same: it may become permanent');
  ok(round('story', 'permanent', 4) === 'world story world story' && nextDestination('yours', 'permanent') === 'story', 'a permanent row picked up goes between the two files only, and never to yours from anywhere');
  ok((['yours', 'story', 'world'] as const).every((d) => nextDestination(d, 'home') === 'yours'), 'a house of yours picked up where it stands stays yours from anywhere: it is moved, never copied into a file');
  ok(homeStaysText('Small House').startsWith('Small House is yours and moves where it stands'), 'and asking for a file says so');
  ok(destinationFile('story', 'tatooine') === 'public/placements/story/tatooine.json' && destinationText('world', 'tatooine') === 'public/placements/world/tatooine.json' && destinationText('yours', 'tatooine') === 'yours', 'every destination is named by the file it is saved to');
  ok(badgeOf('yours') === 'YOURS' && badgeOf('story') === 'PERMANENT · STORY' && badgeOf('world') === 'PERMANENT · WORLD EDIT', "the badge and the chip say which");
  const ask = confirmText('story', 'tatooine', 'L', 'world');
  ok(ask === 'click again to save to public/placements/story/tatooine.json · L for the world edits instead', `the first save's question names the file and where L would keep it instead (${ask})`);
  ok(confirmText('world', 'tatooine', 'L', 'yours').endsWith('L for yours instead') && confirmText('world', 'tatooine', 'L', 'story').endsWith("L for the story's dressing instead"), 'whichever that is');
  ok(forceText('that is under water', 'world', 'tatooine', true) === 'refused: that is under water · click again to place it anyway in public/placements/world/tatooine.json' && forceText(null, 'world', 'tatooine', false) === 'refused: not here · click again to place it anyway', 'a refused spot asks again before it is placed anyway, the file named where it is a first save');
  ok(savedText('public/placements/world/tatooine.json', 'crate_s01-1') === 'saved to public/placements/world/tatooine.json as crate_s01-1', 'a save says the file and the id');
  ok(pickedUpText('locker', 'story') === 'picked up the locker (permanent · story)' && notYoursText('Del') === 'a permanent thing cannot become yours: Del removes it from its file', 'a pick-up says which layer, and a click asking to make one yours is refused in words');
  ok(keptText('Crate', 'yours', 'tatooine') === 'Crate: yours when it is put down' && keptText('Crate', 'story', 'tatooine').includes('public/placements/story/tatooine.json'), 'and L says where it is kept now');
  ok(PERMANENT_EDIT_TUNE.confirmMs > 500 && PERMANENT_EDIT_TUNE.confirmMs < 10000, `a second click is waited for ${PERMANENT_EDIT_TUNE.confirmMs} ms`);
  ok(takeOutText('crate_s01-1', 'public/placements/story/tatooine.json') === 'press again to take crate_s01-1 out of public/placements/story/tatooine.json · cancel puts it back where it stood', 'a permanent row thrown away asks a second press first, naming the row and its file');
  ok(inHandText('locker', 'Del', false) === 'locker is in your hand: put it down first' && inHandText('locker', 'Del', true) === 'locker is in your hand: Del there takes it out of its file', 'and a row in hand is not changed from the panel or the console meanwhile, in words');
}

// ---------------------------------------------------------------------------------------------
// Solid or not: one rule for how a row is stood and what the editor's Solid shows and turns.
{
  const props = (solid?: boolean) => ({ pack: 'props' as const, ...(solid === undefined ? {} : { solid }) });
  ok(standsSolid(props(), true) === false && standsSolid(props(), false) === true, 'a props row with no word of its own: a seat or a table passable, anything else solid');
  ok(standsSolid({ pack: 'gallery' }, false) === true && standsSolid({ pack: 'world' }, true) === true, 'a building solid whatever it is');
  ok(standsSolid(props(true), true) === true && standsSolid(props(false), false) === false && standsSolid({ pack: 'gallery', solid: false }, false) === false, "and the row's own word wins every time");
  const g = { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] as [number, number, number, number] };
  const things = { chair: { model: 'm', template: 'object/tangible/furniture/all/shared_frn_all_chair_test.iff' }, crate: { model: 'm', template: 'object/tangible/container/shared_crate_test.iff' } };
  const furniture = (t: string) => t.includes('chair');
  for (const thing of ['chair', 'crate'] as const) {
    for (const solid of [undefined, true, false]) {
      const row: PlacementRow = { id: 'r', kind: 'prop', pack: 'props', thing, x: 0, y: 0, z: 0, q: [1, 0, 0, 0], ...(solid === undefined ? {} : { solid }) };
      const stood = dressingStandOf(row, g, 'place/r', (t) => things[t as keyof typeof things] ?? null, furniture);
      ok(stood?.solid === standsSolid(row, furniture(things[thing].template)), `a ${thing} row whose solid is ${solid} stands as the editor shows it (${stood?.solid})`);
    }
  }
}

console.log(`\n${passed} checks passed`);
