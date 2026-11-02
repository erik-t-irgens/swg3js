// The hand-overs only the game makes for the removal and people files (Map-maker II's twelfth wave), pinned as text, since
// every behaviour test of them (`hides`, `liveHide`, `peopleRemoved`, `placedPeople`, `sitesRemoved`, `zones`, `peopleZoned`,
// `ambientZoned`, `zoneOutline`, `seatsData`, `gridOpen`, `storyCheckRemovals`) builds the rest for itself and a line lost
// from the game alone passes all of them: the world asks for both files as its load begins and waits for them (bounded)
// before anything that reads them, on the pack path and the packless one; matches the rows over the very list the streamer
// files and hands the streamer what is hidden and switched; sets this world's template rows; folds the people taken away
// into the people's `removed` with no row leaving the list; lays the wildlife with the zones; drops the `.lay` ground of a
// hide that asks; and lands each file by difference. The page fetches both files, routes the dev server's word about each,
// lands a batch's answer, and drops a hidden building's fittings and travel things.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
const world = read('src/world/world.ts');
const main = read('src/main.ts');
const inOrder = (text: string, parts: string[]): boolean => {
  let at = 0;
  for (const p of parts) {
    const i = text.indexOf(p, at);
    if (i < 0) return false;
    at = i + p.length;
  }
  return true;
};

// ---- the world ------------------------------------------------------------------------------------------------------------------
ok(/this\.askRemovals\(packId\);\s*this\.askPeople\(packId\);/.test(world), 'the world asks for both files as its load begins');
ok(inOrder(world, ['await this.removalsReady();', 'await this.peopleReady();', 'this.compileRemovalsOver(pack.layout?.objects ?? [], pack.layout?.center ?? null, pack);', 'this.pack = pack;']), "and waits for them, bounded, before the pack is the world's: the rows matched over its layout first");
ok(inOrder(world, ['await this.removalsReady();', 'await this.peopleReady();', 'this.compileRemovalsOver([], null);', 'const placed = this.placedStandingRows();', "if (placed.length) standingPeople.adopt(standingList([], [], [], [], placed), {}, { world: planet.id, removed: this.personRemovedFn() });"]), "a world with no pack (his own) adopts his people with the zones that keep them");
ok(/const dropped = this\.removals\.groundDrop;[\s\S]{0,300}if \(dropped\.size && dropped\.has\(li\)\) continue;/.test(world), "a hide that asks takes its building's `.lay` ground out of the terrain at the arrival");
ok(/wildLife\.setRemovals\(planet\.space \? \[\] : wildAreasOf\(this\.zoneSet\.zones\), this\.removals\.sites\);\s*await wildLife\.load\(/.test(world), 'the wildlife is handed the zones that keep it and the sites taken away before it lays the world');
ok(/standingPeople\.adopt\(standingList\(people, heralds, wildLife\.overlayRows\(\) as StandingRow\[\], roster as StandingRow\[\], placed\), wildLife\.peopleCreatures\(\), \{ \.\.\.wildLife\.peopleExtras\(\), dormant: \(r\) => personDormant\(r, standsIn, ruins\), \.\.\.\(removed \? \{ removed \} : \{\}\) \}\);/.test(world), "the people are adopted with his placed people last and the removal file's `removed`, none with no file");
ok(/if \(streamed !== layout && this\.removalRows\.length\) this\.compileRemovalsOver\(streamed\.objects, layout\.center, pack\);/.test(world), "the rows are matched again over the list the streamer files where the client's furniture is appended (a piece's own key)");
ok(/\.\.\.\(hides\.size \? \{ hidden: \(li: number\) => hides\.has\(li\) \} : \{\}\), \.\.\.\(solids\.size \? \{ solidOf: \(li: number\) => solids\.get\(li\) \} : \{\}\)/.test(world), 'the streamer is handed what is hidden and switched, and nothing with no file');
ok(/setWorldSolidRows\(this\.removals\.templates\);/.test(world) && /setWorldSolidRows\(new Map\(\)\);/.test(world), "this world's template rows are set from its file, and emptied as the next world's load begins");
ok(/centre: \(\) => this\.placeFrame,/.test(world), "the people are carried about the frame the rows are written in (his own worlds' (0, 0) as well)");
ok(/zoned: \(x, z\) => this\.oursZoned\(x, z\)/.test(world), 'the people of ours are asked the zones that keep them');
const land = world.slice(world.indexOf('  landRemovals(rows: readonly RemovalRow[]'), world.indexOf('  landPeople(rows: readonly PlacedPersonRow[]'));
ok(inOrder(land, ['const before = this.removals;', 'this.compileRemovalsOver(this.removalObjects, this.layoutCenter);', 'const after = this.removals;', 'const plan = removalLandingPlan(before, after);', 'for (const li of plan.show) {', 'stream.showObject(o) || stream.showArrivalHidden(li)', 'for (const li of plan.hide) {', 'stream.hideObject(o)', 'for (const li of plan.unswitch) {', 'stream.setSolidOverride(o, undefined)', 'for (const [li, v] of plan.switch) {', 'stream.setSolidOverride(o, v)', 'if (plan.templatesMoved.size) this.removalWork.solidMoved += stream.refreshSolid(plan.templatesMoved);', 'this.ambience.setHidden(this.ambience.hiddenAt)', 'standingPeople.restrike(this.personRemovedFn(), this.peopleDeps())', 'wildLife.setRemovals(wildAreasOf(this.zoneSet.zones), after.sites, true)', 'this.removalsLanded?.();']), "a landing moves each reader by the plan's difference (`removalLandingPlan`), in order: the streamer, the sounds, the people, the wildlife, then the page");
ok((land.match(/stream\.(showObject|showArrivalHidden|hideObject|setSolidOverride|refreshSolid)\(/g) ?? []).length === 6, 'and moves the streamer nowhere else');
ok(/private keyIndex\(\): ObjectKeyIndex \{/.test(world) && (world.match(/new ObjectKeyIndex\(/g) ?? []).length === 1 && /return this\.keyIndex\(\)\.keyOf\(li\);/.test(world) && /const li = this\.keyIndex\(\)\.find\(key\);/.test(world), "one key index is kept over the list the rows are matched over, and the editor's keys are asked of it");

// ---- the landing's difference, run ----------------------------------------------------------------------------------------------
{
  const { removalLandingPlan, compileRemovals } = await import('../../../src/story/removals.ts');
  const set = (...v: number[]) => new Set(v);
  const before = { hidden: set(1, 2, 3), solid: new Map<number, boolean>([[4, false], [5, true], [6, false]]), templates: new Map<string, boolean>([['t/a', false], ['t/b', true]]) };
  const after = { hidden: set(2, 3, 7), solid: new Map<number, boolean>([[4, false], [5, false], [8, true]]), templates: new Map<string, boolean>([['t/a', false], ['t/b', false], ['t/c', true]]) };
  const p = removalLandingPlan(before, after);
  ok(p.show.join() === '1' && p.hide.join() === '7', 'a row shown again is stood, a row newly hidden taken away, and the two still hidden are in neither');
  ok(p.unswitch.join() === '6' && JSON.stringify(p.switch) === '[[5,false],[8,true]]', 'a switch taken off is unswitched, one moved or new is set, and one kept is left alone');
  ok([...p.templatesMoved].sort().join() === 't/b,t/c', "a template row moved or set is refreshed, one kept is not (and one taken off would be)");
  ok([...removalLandingPlan(after, before).templatesMoved].sort().join() === 't/b,t/c', 'and taken off again, the same rows move back');
  const same = removalLandingPlan(after, after);
  ok(!same.show.length && !same.hide.length && !same.unswitch.length && !same.switch.length && !same.templatesMoved.size, 'a landing that moves nothing stands, hides and switches nothing');
  // A building's piece in no room goes with it (its `ilfRow`), and a piece in another copy of the building does not.
  const objects = [
    { template: 'object/building/x/hall.iff', x: 0, y: 0, z: 0 },
    { template: 'object/building/x/hall.iff', x: 100, y: 0, z: 0 },
    { template: 'object/tangible/rug.iff', x: 1, y: 0, z: 1, ilf: 'o:object/building/x/hall.iff@0,0,0/3', ilfRow: 0 },
    { template: 'object/tangible/rug.iff', x: 101, y: 0, z: 1, ilf: 'o:object/building/x/hall.iff@100,0,0/3', ilfRow: 1 },
  ];
  const c = compileRemovals([{ id: 'o:object/building/x/hall.iff@0,0,0', hide: true }] as never, objects);
  ok(c.hidden.has(0) && c.hidden.has(2) && !c.hidden.has(1) && !c.hidden.has(3), "a building hidden takes its own piece standing in no room, and leaves another copy's");
  const piece = compileRemovals([{ id: 'o:object/building/x/hall.iff@100,0,0/3', hide: true }] as never, objects);
  ok(piece.hidden.size === 1 && piece.hidden.has(3), "and a piece hidden by its own key takes that one copy's piece alone");
}
ok(/standingPeople\.replacePlaced\(this\.placedStandingRows\(\), this\.peopleDeps\(\), this\.personRemovedFn\(\), this\.planet\?\.id \?\? ''\);/.test(world), "a landing of the people file takes his people again, and nobody else's");
ok(/if \(r\.key && people\.has\(r\.key\)\) return 2;\s*if \(!zones\.empty && zones\.rowZone\(r\) >= 0\) return 1;\s*if \(!hidden\.empty && hidden\.personInside\(r, FILLER_TUNE\.dataGrow\)\) return 1;/.test(world), "a person taken away by key counts as standing for the people of ours (2), one zoned or in a hidden building's rooms does not (1)");

// ---- the page --------------------------------------------------------------------------------------------------------------------
ok(/this\.world\.removalsSource = \(pack, kind\) => this\.fetchRemovals\(pack, kind\);\s*this\.world\.peopleSource = \(pack, kind\) => this\.fetchPeople\(pack, kind\);/.test(main), 'the page hands the world its fetches of both files');
ok(/if \(kind === 'removed'\) return \(pack, rev\) => void this\.reloadRemovals\(pack, rev\);\s*if \(kind === 'people'\) return \(pack, rev\) => void this\.reloadPeople\(pack, rev\);/.test(main), "the dev server's word about each is routed to its reload");
ok(/if \(kind === 'solid'\) \{[\s\S]{0,400}void this\.reloadSolid\(d\.rev\);/.test(main), "and its word about the shared walk-through file, which names every world (`all`), to its own");
ok(/this\.world\.landRemovals\(landRows\(this\.world\.removalRows, xf\.put as unknown as RemovalRow\[\], xf\.deleted\)\)/.test(main) && /this\.world\.landPeople\(landRows\(this\.world\.placedPeopleRows, qf\.put as unknown as PlacedPersonRow\[\], qf\.deleted\)\)/.test(main), "a batch's answer lands each file by difference, reading no file whole");
ok(/this\.world\.hidesAnything \? all\.filter\(\(t\) => !this\.world\.hiddenBuildingAt\(t\.building, t\.bx, t\.bz\)\) : all/.test(main) && /if \(this\.world\.hidesAnything && this\.world\.hiddenBuildingAt\(f\.building, f\.bx, f\.bz\)\) continue;/.test(main), "a hidden building's travel things and fittings are not stood");

// ---- the dev server ----------------------------------------------------------------------------------------------------------------
const vite = read('vite.config.ts');
ok(/const word = editFileOf\(decodeURIComponent/.test(vite) && /const word = editFileOf\(path\.relative\(PLACEMENTS_DIR, abs\)\)/.test(vite), "the dev server answers and watches every kind of edit file by the one reader (`editFileOf`), the removal and people files among them");
const kinds = read('src/story/placementPath.ts');
ok(/'removed', 'people'/.test(kinds), 'and both are kinds of edit file');

console.log(`\n${checks} checks passed`);
