// Taking down what a player put up: a house from the Housing tab or its own doorstep, and a prop
// picked back up and thrown away rather than put back.
//
// The fix round's item, measured against what it found. Props: J picked one up and Escape put it
// back, and nothing else was ever offered, so a prop could not be got rid of; held through a travel it
// could be lost. Houses: the server could take one down and the browser could ask, but the only caller
// was the console, and with no server only the last house of the session could be taken down at all,
// because one slot held it -- and every house was filed under its model's own name, so a second of one
// model was the first one filed again over itself.
//
// The arithmetic is `src/world/myBuildings.ts` (pure, so it runs here); the store's own put-back is
// `propPlace.test.ts`'s; and the wiring, which lives in files node cannot load, is read out of the
// source, the way `hudWiring.test.ts` reads the bindings.
//
// Run: node tools/swg/tests/takeDown.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOUSING_TUNE, LOCAL_HOME_PREFIX, LocalHomes, MOVE_SAYS, atDoorDoes, atDoorOf, awayText, backHouseText, doorstepSpot, houseName, insideText, isLocalHome, movedHouseText, myBuildings, type LocalHome } from '../../../src/world/myBuildings.ts';
import { homeKey } from '../../../src/net/homes.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------- the houses this browser put down

{
  const h = new LocalHomes();
  const a = h.mint();
  const b = h.mint();
  ok(a !== b, 'two houses minted are two keys');
  ok(isLocalHome(a) && a.startsWith(LOCAL_HOME_PREFIX), 'and each says it is this browser\'s own');
  ok(!isLocalHome('h12') && !isLocalHome(homeKey('h12')), "and nothing the server hands out reads as one (its ids are h<n>, filed as home:<id>)");
  const row = (key: string, over: Partial<LocalHome> = {}): LocalHome => ({ key, model: 'ply_corl_house_m_s01', name: 'Medium Corellian House', x: 0, y: 4, z: 0, yaw: 0, ...over });
  h.add(row(a));
  h.add(row(b, { x: 100 }));
  ok(h.all.length === 2, 'two houses of one model are two houses on the list, not one filed over the other');
  ok(h.find(a)?.key === a && h.find('local:999') === null, 'each is found by its own key');
  h.add(row(a, { x: 5 }));
  ok(h.all.length === 2 && h.find(a)?.x === 5, 'adding one again under its key updates it rather than doubling it');
  ok(h.remove(a)?.key === a && h.all.length === 1 && h.remove(a) === null, 'taking one down takes that one and only that one, once');
  const c = h.mint();
  ok(c !== a && c !== b, 'a key is never handed out twice in a session, even after its house is gone');
  h.clear();
  ok(h.all.length === 0, 'a world going takes every one of them with it');
}

// ---------------------------------------------------------------- the tab's list

{
  const deeds = [
    { model: 'ply_corl_house_m_s01', name: 'Medium Corellian House' },
    { model: null, name: 'A deed with no model' },
  ];
  ok(houseName('ply_corl_house_m_s01', deeds) === 'Medium Corellian House', 'a building is called what its deed calls it');
  ok(houseName('ply_tato_guild_s01', deeds) === 'Tato guild s01', 'and one no deed makes reads as its model in words');
  ok(awayText(42.4) === '42 m away' && awayText(2500) === '2.5 km away', 'a distance reads in metres near and kilometres far');

  const at = { x: 0, z: 0 };
  const server = [
    { id: 'h3', model: 'ply_corl_house_m_s01', x: 300, z: 0 },
    { id: 'h7', model: 'ply_corl_house_m_s01', x: 30, z: 0 },
  ];
  const local: LocalHome[] = [{ key: 'local:1', model: 'ply_tato_house_s_s01', name: 'Small Tatooine House', x: 0, y: 0, z: 100, yaw: 0 }];
  const list = myBuildings(server, local, at, (m) => houseName(m, deeds));
  ok(list.length === 3, "the server's and this browser's own are one list");
  ok(list.map((b) => b.id).join(',') === 'h7,local:1,h3', 'nearest first, whoever keeps it');
  ok(list[0].shared && !list[1].shared, 'and each says who keeps it');
  ok(list[0].line.includes('server') && list[1].line.includes('this machine'), 'in its line, where the player can read it: the server, or this machine');
  ok(list[0].name === 'Medium Corellian House' && list[0].model === 'ply_corl_house_m_s01', "a server row is named from its model's deed");
  ok(myBuildings([], [], at, (m) => m).length === 0, 'nobody with nothing standing has an empty list, not an error');

  // The doorstep: a house is placed with its own origin on the ground at its door.
  ok(atDoorOf(list, { x: 33, z: 4 }, HOUSING_TUNE.doorReach)?.id === 'h7', 'standing a few metres from a door finds that building');
  ok(atDoorOf(list, { x: 60, z: 0 }, HOUSING_TUNE.doorReach) === null, 'and from across the street finds none');
  ok(atDoorOf(list, { x: 15, z: 0 }, 40)?.id === 'h7', 'and between two the nearer door wins');
}

// ---------------------------------------------------------------- standing people out on the doorstep

{
  const door = { x: 10, z: -5 };
  const spots = Array.from({ length: 12 }, (_, i) => doorstepSpot(i + 1, door));
  let closest = Infinity;
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) closest = Math.min(closest, Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z));
  ok(closest >= HOUSING_TUNE.standApart * 0.6, `twelve people stood out of one building are not stood inside each other (closest ${closest.toFixed(2)} m)`);
  const off = Math.min(...spots.map((s) => Math.hypot(s.x - door.x, s.z - door.z)));
  ok(off >= HOUSING_TUNE.standApart, `and none of them is on the doorstep itself, which is the player's (nearest ${off.toFixed(2)} m)`);
  const far = Math.max(...spots.map((s) => Math.hypot(s.x - door.x, s.z - door.z)));
  ok(far < 6, `and all of them are still at the door, not scattered down the street (farthest ${far.toFixed(2)} m)`);
  ok(spots.every((s) => Number.isFinite(s.x) && Number.isFinite(s.z)), 'every spot is a real place');
}

// ---------------------------------------------------------------- the numbers are ours and named

{
  const select = read('src/ui/characterSelect.ts');
  const arm = /armMs:\s*(\d+)/.exec(select);
  ok(!!arm && Number(arm[1]) === HOUSING_TUNE.armMs, `the take-down's answer stays shut as long as the select screen's delete does (${HOUSING_TUNE.armMs} ms)`);
  ok(HOUSING_TUNE.doorReach > 2 && HOUSING_TUNE.doorReach < 20, 'the doorstep reach is a step or two either side of a door');
}

// ---------------------------------------------------------------- the wiring, read out of the source

{
  const main = read('src/main.ts');
  const world = read('src/world/world.ts');
  const ui = read('src/ui/housingUi.ts');
  const bar = read('src/ui/placingBar.ts');
  const input = read('src/core/input.ts');
  const menu = read('src/ui/menu.ts');

  // Houses.
  ok(!/lastHouse/.test(main), 'the one slot that held only the last house is gone');
  ok(/this\.localHomes\.mint\(\)[\s\S]{0,200}placeBuilding\(model, \{ at: \{ x: state\.x, z: state\.z \}, yaw: state\.yaw, y: state\.y, key \}/.test(main), 'a house put down from a deed with no server is filed under a key of its own');
  // The world it goes into is kept across the placing's wait, and a travel in it files nothing into the next world.
  ok(/const key = this\.localHomes\.mint\(\);[\s\S]{0,300}?const world = this\.localHomes\.world;\s*const out = await this\.world\.placeBuilding\(model, \{ from:[^\n]*\n\s*if \(this\.localHomes\.world !== world\) \{\s*if \(out\.ok\) this\.world\.unplaceBuilding\(key\);\s*return \{ error:/.test(main), "and so is one the console's house helper puts down, never filed into a world it was not put down in");
  ok(/unplace: \(key\) => \{\s*this\.standOutOf\(key\);\s*return this\.world\.unplaceBuilding\(key\);/.test(main), "the server's word that takes a house down stands this browser's people out of it first");
  ok(/this\.standOutOf\(row\.key\);\s*this\.world\.unplaceBuilding\(row\.key\);/.test(main), 'and so does taking down one this browser put down itself');
  ok(/homes\.askDown\(id\)/.test(main) && /private takeDownHome\(id: string\): string/.test(main), "a server's house is asked for, and comes down when the server answers");
  ok(/clearRoomsOf\(key: string\): THREE\.Vector3 \| null/.test(world), 'the world says where the doorstep is, and lets go of the room the player was in');
  ok(/this\.mobiles\.standOutOf\(b, door\)/.test(world), 'and stands the people and creatures it keeps out of the rooms');
  ok(/const stood = this\.mobiles \? this\.mobiles\.standOutOf\(b, door\) : 0;\s*this\.npcs\?\.standOutOf\(b, door, stood \+ 1\);/.test(world), 'and the fighters too, on the doorstep spots after theirs');

  // What standing out leaves behind: no room, no path and no home in a building that is gone. Kept, a
  // body leashed itself to a room that was not there, walked home into it, or (a fighter) hung airless
  // at the height of the floor that had been.
  const bodyOf = (text: string, signature: string): string => {
    const at = text.indexOf(signature);
    if (at < 0) return '';
    let depth = 0;
    for (let i = text.indexOf('{', at + signature.length - 1); i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) return text.slice(at, i + 1);
    }
    return '';
  };
  const mobile = read('src/world/mobiles/mobile.ts');
  const out = bodyOf(mobile, 'standOut(x: number, y: number, z: number): boolean');
  const drivenAt = out.indexOf('if (this.driven) return false;');
  ok(drivenAt > 0 && [/this\.navCell = null;/, /this\.navAgent\.clear\(\);/, /this\.homeCell = null;/].every((r) => { const m = r.exec(out); return !!m && m.index < drivenAt; }), "a person or creature stood out drops its path and its home's room, even one another browser keeps");
  ok(/this\.homeX = x;\s*this\.homeZ = z;/.test(out.slice(drivenAt)), 'and one this browser keeps takes the doorstep as its home');
  const manager = read('src/world/mobiles/manager.ts');
  const managerOut = bodyOf(manager, 'standOutOf(building: object, door: { x: number; z: number }, first = 1): number');
  ok(!/if \(!m\.standOut\(/.test(managerOut) && /const moved = m\.standOut\([\s\S]*?held\.cell = null;[\s\S]*?m\.setAirless\(false\);\s*if \(moved\) n\+\+;/.test(managerOut), "a body another browser keeps is not moved, but is followed in no room of the building from then on");
  const npcs = read('src/world/npcs.ts');
  const npcOut = bodyOf(npcs, 'standOut(x: number, y: number, z: number): void');
  ok(['this.cell = null;', 'this.cellSolid = true;', 'this.navAgent.clear();', 'this.homeInside = false;', 'this.body.setTranslation('].every((s) => npcOut.includes(s)), 'a fighter stood out is in no room, on no path, homed on the ground and put there');
  const npcManagerOut = bodyOf(npcs, 'standOutOf(building: object, door: { x: number; z: number }, first = 1): number');
  ok(/npc\.cell\?\.building !== building/.test(npcManagerOut) && /doorstepSpot\(first \+ n, door\)/.test(npcManagerOut) && /npc\.standOut\(/.test(npcManagerOut), 'every fighter in one of its rooms is stood out, round the same doorstep');
  ok(/held\.cell = null;\s*v\.setInRoom\(false\)/.test(world), 'and a ship stood in one of its rooms is outdoors from then on');
  ok(/if \(this\.cellState\?\.building !== b\) return null;\s*this\.cellState = null;/.test(world), "the player's room is let go of only when it is that building");
  const arrive = /private arrive\(planet: PlanetDef[\s\S]*?this\.placeNames = \[\];/.exec(main)?.[0] ?? '';
  // This machine keeps its own houses per world now (W6): an arrival hands them the world and its store, and
  // never forgets them there; only the select screen clears the list, the rows staying in the storage.
  ok(/this\.world\.load\(planet/.test(arrive) && /this\.localHomes\.enter\(placesFor, this\.homeStore\(\)\);/.test(arrive) && !/this\.localHomes\.clear\(\);/.test(arrive), "an arrival reads this machine's own houses for the world arriving from its storage, and forgets none of them");
  const toSelectHomes = /private switchToSelect\(\): void \{[\s\S]{0,6000}/.exec(main)?.[0] ?? '';
  ok(/homes\.clear\(\);\s*keptProps\.clear\(\);\s*this\.localHomes\.clear\(\);/.test(toSelectHomes), 'and the select screen lets go of the server\'s houses and props and this machine\'s list, which the next arrival reads again');

  // The tab.
  const uiCode = ui.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/housing-confirm/g, '');
  ok(!/\bconfirm\s*\(/.test(uiCode) && !/window\.confirm/.test(uiCode), 'the Housing tab asks in the page, never with the browser\'s own confirm');
  ok(/HOUSING_TUNE\.armMs/.test(ui) && /disabled/.test(ui) && /arming/.test(ui), 'and its answer stays shut for a moment after the question');
  ok(/Your buildings/.test(ui) && /Take down/.test(ui), 'it lists your buildings, with a Take down on each');
  ok(/this\.housingUi\.onRemove = \(id\) => this\.messages\.system\(this\.takeDownHome\(id\)\)/.test(main), 'and its answer takes that one down');
  // W7: the pick-up key at the door takes the house up where it stands; only against a server that cannot move one
  // does it open the tab with the take-down asked, as it always did.
  ok(/const home = atDoorOf\(this\.myBuildingsHere\(\), \{ x: me\.x, z: me\.z \}, HOUSING_TUNE\.doorReach\);\s*if \(home\) \{\s*if \(atDoorDoes\(home\.shared, this\.net\.session\.homesVersion\) === 'take'\) return this\.takeHome\(home\);\s*this\.toggleInventory\('housing'\);\s*this\.housingUi\.ask\(home\.id\);/.test(main), "the pick-up key at a building's own doorstep takes it up where it stands, and against a server that cannot move one opens the tab with its take-down asked");

  // Props.
  ok(/putAway: \['Delete'\]/.test(input) && /putAway:/.test(menu), 'Delete puts a prop in hand away, and the Controls page names it');
  // The one placing block for both kinds (`stepPlacingKeys`): with a prop in hand O or Delete puts it away,
  // and it answers that something was in hand, which the pick-up below it reads.
  const placingKeys = bodyOf(main, 'private stepPlacingKeys(dt: number');
  // A permanent row the dev server's editor picked up goes on a second press (`awayAsked`), which answers yes at once
  // for anything else, and in a release always.
  ok(/if \(this\.propPlacing\) \{[\s\S]*?if \(\(takeKey \|\| input\.pressedAction\('putAway'\)\) && this\.awayAsked\(\)\) this\.stopPlacingProp\('away'\)/.test(placingKeys), 'the pick-up key (O) again, or Delete, puts a prop in hand away');
  ok(/private awayAsked\(\): boolean \{\s*if \(!import\.meta\.env\.DEV\) return true;/.test(main), 'with no question asked of anything but a permanent row, and none in a release');
  ok(/const hadInHand = this\.stepPlacingKeys\(dt, takeKey\);/.test(main) && /if \(takeKey && !hadInHand/.test(main) && /return true;\s*\}$/.test(placingKeys), 'and the same press does not then pick the next one up');
  ok(/this\.placingBar\.onPutAway = \(\) => \{\s*if \(this\.awayAsked\(\)\) this\.stopPlacingProp\('away'\);/.test(main) && /onPutAway/.test(bar) && /Put away/.test(bar), "the placing bar's Put away does the same");
  ok(/Put back \(Esc\)/.test(bar), 'and its Escape says it puts the prop back, which it does');
  // Escape in the key's own listener gives up what is in hand, and giving it up is the plain Escape: a
  // prop picked back up goes back where it stood (`stopPlacingProp()` with no fate is `back`).
  const escape = /window\.addEventListener\('keydown', \(e\) => \{\s*\/\/ A held Escape autorepeats[\s\S]*?\n    \}\);/.exec(main)?.[0] ?? '';
  const giveUp = bodyOf(main, 'private giveUpHand(): void');
  ok(/this\.giveUpHand\(\);/.test(escape) && /this\.stopPlacingProp\(\);/.test(giveUp), 'plain Escape still puts it back where it stood');
  const travel = /private async travel\([\s\S]{0,2500}/.exec(main)?.[0] ?? '';
  ok(/this\.stopPlacingProp\('keep'\)/.test(travel), 'a travel writes a prop in hand back into the store before the world goes');
  const toSelect = /private switchToSelect\(\): void \{[\s\S]{0,3000}/.exec(main)?.[0] ?? '';
  ok(/this\.stopPlacingProp\('keep'\)/.test(toSelect), 'and so does leaving for the select screen');
  ok(/this\.stopPlacing\('keep'\)/.test(travel) && /this\.stopPlacing\('keep'\)/.test(toSelect), 'and a building in hand is let go of the same way, so a permanent row the editor had up is left as its file has it');
  const drop = bodyOf(main, 'private async dropPlacingProp(): Promise<void>');
  ok(/const from = p\.from;\s*p\.from = HAND_FRESH;\s*this\.stopPlacingProp\(\);/.test(drop), 'a prop picked up and put down somewhere else is moved, not left standing where it was as well');

  // Where a thing in hand came from (`HandSource`): every let-go switches on it, with a `never` default the
  // compiler holds to every kind, and a permanent row the dev server's editor picked up never reaches this
  // browser's own store -- not put back into it, not kept in it, not saved over it -- which would stand a
  // second copy of it there while its file still stands it for everybody.
  const stopProp = bodyOf(main, 'private stopPlacingProp(how: LetGo = ');
  const stopHouse = bodyOf(main, 'private stopPlacing(how: LetGo = ');
  const letGoPermanent = /private letGoPermanent\([\s\S]*?\n  \}\r?\n/.exec(main)?.[0] ?? '';
  for (const [what, body] of [['stopPlacingProp', stopProp], ['stopPlacing', stopHouse], ['dropPlacingProp', drop]] as const) {
    ok(/switch \(from\.kind\) \{/.test(body) && /const never: never = from;/.test(body), `${what} switches on where the thing came from, every kind named`);
  }
  const permanentCases = [stopProp, stopHouse, drop].map((b) => /case 'permanent':([\s\S]*?)(?:case '|default:)/.exec(b)?.[1] ?? '');
  ok(permanentCases[0].length > 0 && permanentCases[1].length > 0 && permanentCases.every((c) => !/placedProps\.(restore|keepIn|put)|savePlaced/.test(c)), "a permanent source's branch never reaches the store's restore, keepIn or put");
  ok(letGoPermanent.length > 0 && !/placedProps\.|savePlaced/.test(letGoPermanent) && /case 'back':[\s\S]*?this\.permanent\.restore\(key\)/.test(letGoPermanent) && /case 'away':[\s\S]*?this\.deletePermanent\(/.test(letGoPermanent) && /case 'keep':\s*return;/.test(letGoPermanent), 'it is stood again from its file on Escape, taken out of its file by Delete, and left as its file has it on a travel');
  const refuseAt = drop.indexOf("if (p.from.kind === 'permanent') {");
  ok(refuseAt > 0 && refuseAt < drop.indexOf('placedProps.put(') && refuseAt < drop.indexOf('p.from = HAND_FRESH;'), 'and a click asking to keep one as yours is refused before anything is put or let go of');

  // W7: a house of yours picked up where it stands. It is a kind of hand of its own, let go of where it stood on
  // Escape and on Delete alike (never taken down: the Housing tab does that), and left where it stood on a travel.
  ok(/case 'home':\s*this\.letGoHome\(from, how, p\.name\);\s*return;/.test(stopHouse), 'a house of yours in hand is let go of by its own branch of the switch, apart from a permanent row');
  const letGoHome = bodyOf(main, 'private letGoHome(from: HomeSource, how: LetGo, name: string, say = true): void');
  ok(/this\.localHomes\.lower\(from\.id\);\s*if \(how === 'keep' \|\| !here\) return;/.test(letGoHome) && /if \(row && this\.homesKeeper === 'local'\) void this\.placeLocalHome\(row\);/.test(letGoHome), "this machine's is let go of in hand, and stood again where it stood through the one placer, unless the world or the keeper is going");
  ok(/if \(how === 'keep' \|\| !here\) \{\s*homes\.unhide\(from\.id\);\s*return;\s*\}\s*homes\.show\(from\.id\);/.test(letGoHome) && !/askDown|removeHome|unplaceBuilding|localHomes\.remove/.test(letGoHome), "a server's is shown again, or left to the server, and neither is ever taken down from here");
  const dropBuilding = bodyOf(main, 'private async dropPlacing(): Promise<void>');
  ok(/if \(p\.from\.kind === 'home'\) \{\s*await this\.dropHome\(p, p\.from\);\s*return;\s*\}/.test(dropBuilding) && dropBuilding.indexOf("p.from.kind === 'home'") < dropBuilding.indexOf('const deed = p.deed;'), 'a click with a house of yours in hand moves it, before anything about deeds is asked');
  const dropHome = bodyOf(main, 'private async dropHome(p: BuildingHand, from: HomeSource): Promise<void>');
  ok(dropHome.indexOf('const refusal = this.keptRefusal(keeper);') > 0 && dropHome.indexOf('const refusal = this.keptRefusal(keeper);') < dropHome.indexOf('p.from = HAND_FRESH;'), 'refused (it stays in hand) while nobody knows who keeps the houses or their server is not answering, before anything is let go of');
  ok(/if \(!from\.local && this\.net\.session\.homesVersion < HOMES_MOVE_VERSION\)/.test(dropHome) && dropHome.indexOf('homesVersion < HOMES_MOVE_VERSION') < dropHome.indexOf('homes.askMove('), 'never asked of a server whose hail does not say it moves a house');
  ok(/p\.from = HAND_FRESH;\s*this\.stopPlacing\(\);/.test(dropHome), 'let go of without being put back, or moving one would stand it where it was as well');
  ok(/homes\.askMove\(from\.id, \{ x: state\.x, z: state\.z \}, state\.yaw, state\.clear, state\.y\);/.test(dropHome), "a server's is asked of the server with the ghost's doorstep, heading, circle and height");
  ok(/this\.localHomes\.lower\(from\.id\);[\s\S]*?this\.placeLocalHome\(row, \{ \.\.\.row, x: state\.x, y: state\.y, z: state\.z, yaw: state\.yaw, r: state\.clear \}\)/.test(dropHome), "and this machine's goes up under its own key through the one placer, where the ghost has it");
  ok(!/unplaceBuilding|world\.placeBuilding/.test(dropHome), 'never through a placing or a take-down of its own: the tickets are the one placer\'s');
  // The put-back of a move the world refuses is the placer's own (`placeLocalHome`'s `back`, which localHomes.test.ts
  // drives), so the drop calls the placer once and has no second copy of the rule.
  ok((dropHome.match(/this\.placeLocalHome\(/g) ?? []).length === 1, 'a refused move is put back where it stood by the placer itself, not by a second call from the drop');
  // What it came to is `localMoveOf`'s (which localHomes.test.ts runs over the real placer's landings), and the
  // words follow that answer, so a move taken down while it went up is never said, or reported, as moved.
  ok(/this\.homeMove = localMoveOf\(moved, !!this\.localHomes\.find\(row\.key\)\);\s*if \(this\.homeMove === 'world'\) this\.homeMoveSaid = MOVE_SAYS\.world;\s*else if \(this\.homeMove === 'gone'\) this\.homeMoveSaid = MOVE_SAYS\.gone;\s*else if \(this\.homeMove === 'moved'\)/.test(dropHome), 'and a move whose house was taken down from the Housing tab while it went up says so, never that it moved');
  ok(/homes\.askMove\([^\n]*\);\s*this\.homeMove = 'asked';/.test(dropHome) && /this\.stopPlacing\('keep'\);\s*this\.homeMove = 'kept';/.test(dropHome) && /this\.stopPlacing\(\);\s*this\.homeMove = 'back';/.test(dropHome) && /if \(!row\) \{\s*this\.homeMove = 'gone';/.test(dropHome), "every way a move ends says what it came to: asked of the server, let go of where it stood, back where it stood, or gone");
  // And the click before any of that is answered too, and the words with it on every ending that says any, so
  // `homes()` (`lastOutcome`, `lastMove`) never reads one click's answer beside another's words.
  const fresh = /this\.homeMove = null;\s*this\.homeMoveSaid = '';\s*const state = p\.state;\s*if \(!state\?\.ok\) \{\s*this\.homeMove = 'held';\s*return;\s*\}/.exec(dropHome);
  ok(!!fresh && fresh.index < dropHome.indexOf('const keeper = this.homesKeeper;'), 'a click starts its answer afresh, and one the ghost refuses is held');
  ok(/if \(refusal\) \{\s*this\.homeMove = 'held';\s*this\.homeMoveSaid = refusal;/.test(dropHome), 'one refused for want of a keeper is held, in the words said');
  ok(/this\.homeMove = 'kept';\s*this\.homeMoveSaid = MOVE_SAYS\.keeper;/.test(dropHome) && /this\.homeMove = 'back';\s*this\.homeMoveSaid = `\$\{MOVE_SAYS\.cannot\}/.test(dropHome), "and a change of keeper and a server that cannot move one keep the words they said, as every other ending does");
  const assigns = dropHome.match(/this\.homeMove = [^;]+;/g) ?? [];
  const saids = dropHome.match(/this\.homeMoveSaid = [^;]+;/g) ?? [];
  ok(assigns.length === 8 && saids.length === 10, `every ending writes both (${assigns.length} answers, ${saids.length} words, counting the fresh start of each and the four of a move this machine keeps)`);
  // The console's own drop (W8): `dropped` is what the move came to, never the ghost's verdict, which only says the
  // spot could take it -- a move the world then refused and stood back, or one taken down while it went up, was
  // reported dropped.
  const deedHelper = /\n {6}deed: async \(deed\?: string[\s\S]*?\n {6}\},\r?\n/.exec(main)?.[0] ?? '';
  const homeDrop = /if \(home\) \{([\s\S]*?)\n {10}\}/.exec(deedHelper)?.[1] ?? '';
  ok(/this\.homeMove = null;\s*await this\.dropPlacing\(\);/.test(deedHelper) && /const outcome: HouseMove = \(this\.homeMove as HouseMove \| null\) \?\? 'held';/.test(homeDrop) && /dropped: moveDropped\(outcome\), outcome,/.test(homeDrop), "deed's drop of a house in hand reports what the move came to, cleared before the drop and read after it");
  ok(homeDrop.length > 0 && !/state\?\.ok/.test(homeDrop) && /asked: outcome === 'asked'/.test(homeDrop), "and never reads the ghost's verdict for it");
  const takeHome = bodyOf(main, 'private async takeHome(home: MyBuilding): Promise<string | null>');
  const liftAt = takeHome.indexOf('this.localHomes.lift(row.key)');
  ok(liftAt > 0 && liftAt < takeHome.indexOf('this.world.unplaceBuilding(row.key);') && /this\.standOutOf\(row\.key\);\s*this\.world\.unplaceBuilding\(row\.key\);/.test(takeHome), "this machine's is held in hand before it comes down, and whoever stands in it is stood out first");
  const hideAt = takeHome.indexOf('homes.hide(row.id);');
  const countLocal = takeHome.indexOf('this.world.thingsInside(row.key)');
  const countServer = takeHome.indexOf('this.world.thingsInside(homeKey(row.id))');
  ok(hideAt > 0 && countLocal > 0 && countLocal < liftAt && countServer > 0 && countServer < hideAt, 'what was put down in its rooms is counted before it comes down, which lets go of them');
  ok(/from = \{ kind: 'home', id: row\.key, local: true, [^\n]*\binside, gen \};/.test(takeHome) && /from = \{ kind: 'home', id: row\.id, local: false, [^\n]*\binside, gen \};/.test(takeHome), 'and the count rides with the house in hand, which the drop says');
  ok(/this\.homeMoveSaid = movedHouseText\(p\.name, from\.inside, true\);/.test(dropHome) && /this\.homeMoveSaid = movedHouseText\(p\.name, from\.inside, false\);/.test(dropHome), 'which says what stays where it stood, asked of the server or moved here');
  ok(/thingsInside\(key: string\): number \{\s*return this\.layoutStream\?\.hostedBy\(key\) \?\? 0;/.test(world), "the world's count is the streamer's own (`hostedBy`, which placedColliders.test.ts runs on the real streamer)");
  ok(takeHome.indexOf("const refusal = this.keptRefusal('server');") > 0 && takeHome.indexOf("const refusal = this.keptRefusal('server');") < hideAt, "a server's is refused while its server is not answering, before it is taken down here");
  // A server's whose move is asked and not answered yet is down here already: it is not taken up a second time.
  const askingAt = takeHome.indexOf('if (homes.isHidden(row.id)) return fail(MOVE_SAYS.asking);');
  ok(askingAt > 0 && askingAt < hideAt && askingAt < countServer, "a server's whose move is still asked of the server is refused, before anything is counted or hidden");
  // Its world or its keeper changed while the model loaded: nothing was in hand for the keeper's change to let go of
  // (`switchHomesKeeper`), so the pick-up asks again once it has the hand, and lets go of it where it stood.
  const awaitAt = takeHome.indexOf('await this.startPlacingBuilding(');
  const recheck = /if \(this\.world\.generation !== gen \|\| this\.homesKeeper !== \(from\.local \? 'local' : 'server'\)\) \{\s*this\.stopPlacing\('keep'\);\s*return fail\(MOVE_SAYS\.keeper\);\s*\}/.exec(takeHome);
  ok(/const gen = this\.world\.generation;/.test(takeHome.slice(0, awaitAt)) && !!recheck && recheck.index > awaitAt && recheck.index < takeHome.indexOf('this.anchorBuilding('), 'a pick-up overtaken by a new world or a change of keeper while its model loaded is let go of where it stood, never anchored');
  ok(/if \(why\) \{[\s\S]*?this\.letGoHome\(from, 'back', from\.row\.name, false\);/.test(takeHome) && /this\.anchorBuilding\(p, from\.row, from\.row\.yaw, GHOST_TUNE\.most\);/.test(takeHome), 'one that cannot be taken up stands again where it stood, and one taken up is anchored exactly where it stands');
  ok(/if \(this\.localHomes\.inHand\(row\.key\)\) continue;/.test(bodyOf(main, 'private async standLocalHomes(): Promise<void>')), "no run of standing puts one of this machine's back while it is in hand");
  ok(/if \(this\.placing\?\.from\.kind === 'home'\) this\.stopPlacing\('keep'\);\s*switchSets\(to, this\.homeSets\);/.test(bodyOf(main, 'private switchHomesKeeper(to: Keeper): void')), 'a change of keeper lets go of a house of yours in hand where it stood, before the sets change');
  ok(/if \(held\?\.from\.kind === 'home' && held\.from\.id === id\) return inHandHouseText\(held\.name\);/.test(bodyOf(main, 'private takeDownHome(id: string): string')), "the Housing tab's take-down waits for a house in hand to be put down");
  ok(/if \(routeHomeWord\(msg, homes\)\) \{/.test(main), "every house word off the socket reaches the houses through the one router the relay's round trip runs");
}

// ---------------------------------------------------------------- what moving a house says, and when the key moves one (W7)

{
  ok(atDoorDoes(false, 0) === 'take' && atDoorDoes(true, 2) === 'take', "the key at the door takes up this machine's house, and a server's that moves houses");
  ok(atDoorDoes(true, 0) === 'tab' && atDoorDoes(true, 1) === 'tab', "and a server's that does not, opens the Housing tab with its take-down asked");
  ok(insideText(0) === '' && insideText(1).includes('one thing') && insideText(3).includes('3 things') && insideText(3).includes('stay where they stood'), 'what stays behind is said, only when there is something');
  ok(movedHouseText('Small House', 2, false) === 'Small House is moved; the 2 things put down inside it stay where they stood' && movedHouseText('Small House', 0, true) === 'Small House: asking the server to move it', 'a move says what moved and what stayed');
  ok(backHouseText('Small House', true).includes('Housing tab') && backHouseText('Small House', false) === 'Small House put back where it stood', 'and Delete says it never takes a house down, which the Housing tab does');
  ok(MOVE_SAYS.cannot === 'this server cannot move a house', "and a server that cannot move one is said in the design's own words");
}

console.log(`\n${passed} checks passed`);
