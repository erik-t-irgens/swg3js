// SOE's earlier objects and the holidays' dressing in the game (src/world/worldState.ts's `soe` and its ruled states,
// src/world/holidays.ts), and what reads them.
//
// The earlier objects are a world state as Restuss's is (the server's word, else this browser's setting, else the final
// world), kept by the server too (its table is the browser's). Each holiday is a state this browser rules alone by its
// switch and the date, taken at an arrival and never a server's word; its seasons cross the new year where they wrap; a
// world whose only states are the holidays' waits on no server. The real streamer files a TEST layout's earlier objects
// and holiday rows dormant until their state stands. The rows that join an added room stand after the brigade, so nobody
// else's `stood:` name moves, and go by their own keys, so theirs is the same whatever the brigade came to; the browser's
// list of those states is the converter's. The settings, the Gameplay page's row and the Weather section's switches, and
// the game's hand-overs (main.ts, world.ts), pinned as text.
//
// Run: node tools/swg/tests/soeHolidays.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORLD_STATES, WORLD_STATE_WORDS, cleanStates, forgetWorldStates, isRuled, releaseWorldStates, serverKeptIn, setLocalWorldState, setServerStates, stateLink, stateNews, standsIn, stateNow, takeWorldStates, worldStateOf } from '../../../src/world/worldState.ts';
import { HOLIDAYS, HOLIDAY_SEASONS, holidayNews, holidayOn, inSeason, installHolidays, settingWords, tuneSeason } from '../../../src/world/holidays.ts';
import { LATER_KEYS, laterRows, standingList } from '../../../src/world/ngeOverlay.ts';
import { stoodName } from '../../../src/world/standingPeople.ts';
import { STATE_OBJECT_KEYS } from '../stateObjects.mjs';
import { GAMEPLAY } from '../../../src/ui/gameplayPage.ts';
import { DEFAULT_SETTINGS } from '../../../src/core/settings.ts';
import { WORLD_STATES as SERVER_STATES, cleanWorldStateSet } from '../../../server/worldState.mjs';
import { makeStreamer, type SnapshotObject } from './streamHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

// --- SOE's earlier objects, a world state ----------------------------------------------------------------------------------
{
  forgetWorldStates();
  store.clear();
  ok(JSON.stringify(WORLD_STATES.soe) === '{"values":["final","earlier"],"default":"final"}' && JSON.stringify(SERVER_STATES) === JSON.stringify(WORLD_STATES), "the earlier objects are final or earlier, final by default, and the server keeps the very same table");
  ok(worldStateOf('soe') === 'final', 'with nobody having said, the worlds stand as SOE left them');
  setLocalWorldState('soe', 'earlier');
  ok(worldStateOf('soe') === 'earlier' && store.get('swg.world.soe') === 'earlier', "this browser's own setting is next, kept");
  setServerStates(cleanStates({ restuss: 'ruins', soe: 'final' }));
  ok(worldStateOf('soe') === 'final', "and the server's word first");
  setServerStates(cleanStates({ restuss: 'living' }));
  ok(worldStateOf('soe') === 'earlier', "a server from before them says nothing of them, and this browser's own setting stands");
  ok(cleanWorldStateSet({ key: 'soe', value: 'earlier' }).key === 'soe' && !!cleanWorldStateSet({ key: 'soe', value: 'all' }).why && !!cleanWorldStateSet({ key: 'halloween', value: 'on' }).why, "the admin's word on them is taken, a holiday's never");
  const news = stateNews('soe', 'final', 'earlier', null);
  ok(stateLink('soe') === 'are' && stateLink('restuss') === 'stands as' && news === `${WORLD_STATE_WORDS.soe.name} are ${WORLD_STATE_WORDS.soe.values.earlier} when you next arrive on ${WORLD_STATE_WORDS.soe.world}`, `the message line says it in its own words (${news})`);
  ok(stateNews('restuss', 'ruins', 'living', 'ruins') === 'Restuss stands as the living city when you next arrive on Rori: it stays as it is until then', "and Restuss's words are what they were");
}

// --- the holidays, ruled states ------------------------------------------------------------------------------------------
{
  ok(inSeason({ from: [10, 20], to: [11, 4] }, 10, 20) && inSeason({ from: [10, 20], to: [11, 4] }, 10, 31) && inSeason({ from: [10, 20], to: [11, 4] }, 11, 4) && !inSeason({ from: [10, 20], to: [11, 4] }, 11, 5) && !inSeason({ from: [10, 20], to: [11, 4] }, 10, 19), 'a season holds its own ends, its first day and its last, and nothing past them');
  ok(inSeason({ from: [12, 15], to: [1, 5] }, 12, 15) && inSeason({ from: [12, 15], to: [1, 5] }, 12, 31) && inSeason({ from: [12, 15], to: [1, 5] }, 1, 2) && inSeason({ from: [12, 15], to: [1, 5] }, 1, 5) && !inSeason({ from: [12, 15], to: [1, 5] }, 12, 14) && !inSeason({ from: [12, 15], to: [1, 5] }, 1, 6) && !inSeason({ from: [12, 15], to: [1, 5] }, 6, 1), 'one that wraps the new year holds both ends of it, its first day and its last');
  ok(holidayOn(1, null, 6, 1) && !holidayOn(0, HOLIDAY_SEASONS.halloween, 10, 31) && holidayOn(-1, HOLIDAY_SEASONS.halloween, 10, 31) && !holidayOn(-1, HOLIDAY_SEASONS.halloween, 6, 1) && !holidayOn(-1, null, 10, 31), 'always is always, never never, in season by the season, and with none never');
  ok(settingWords(-1) === 'in season' && settingWords(1) === 'always' && settingWords(0) === 'never', "a switch's words");
  ok(JSON.stringify(HOLIDAY_SEASONS.halloween) === '{"from":[10,20],"to":[11,4]}' && JSON.stringify(HOLIDAY_SEASONS.loveday) === '{"from":[2,7],"to":[2,21]}' && JSON.stringify(HOLIDAY_SEASONS.empireday) === '{"from":[5,1],"to":[5,21]}', "the seasons of ours, as the menu's hints say them");
  ok(Object.keys(HOLIDAYS).join(',') === 'halloween,lifeday,loveday,empireday' && HOLIDAYS.lifeday.setting === 'lifeDay', "the holidays, Life Day's switched by the Life Day setting");
  const kept = { ...HOLIDAY_SEASONS.loveday };
  ok(tuneSeason('loveday', { from: [2, 1], to: [13, 40] })?.from.join('/') === '2/1' && HOLIDAY_SEASONS.loveday.to.join('/') === '2/21' && tuneSeason('lifeday', { from: [1, 1] }) === null, 'a season moves only to real days, and Life Day\'s is the weather\'s own');
  HOLIDAY_SEASONS.loveday = kept;
  ok(holidayNews('halloween', true).startsWith("The Galactic Moon Festival's dressing stands from your next arrival"), 'a switch moved is said in words');

  forgetWorldStates();
  store.clear();
  const on = new Map<string, boolean>([['halloween', true], ['lifeday', false], ['loveday', false], ['empireday', false]]);
  installHolidays((k) => on.get(k) ?? false);
  ok(isRuled('halloween') && isRuled('lifeday') && !isRuled('soe') && !isRuled('restuss'), 'every holiday is a state this browser rules; the earlier objects and Restuss are not');
  ok(cleanStates({ halloween: 'off', soe: 'earlier' })?.halloween === undefined && cleanStates({ halloween: 'off', soe: 'earlier' })?.soe === 'earlier', "a server never says a holiday's state");
  takeWorldStates({ halloween: { values: ['off', 'on'], default: 'off' }, lifeday: { values: ['off', 'on'], default: 'off' }, soe: { values: ['final', 'earlier'], default: 'final' } });
  ok(stateNow('halloween') === 'on' && standsIn('halloween=on') && !standsIn('lifeday=on') && !standsIn('soe=earlier'), "an arrival takes each holiday by its rule and the earlier objects by theirs");
  on.set('halloween', false);
  on.set('lifeday', true);
  ok(stateNow('halloween') === 'on' && stateNow('lifeday') === 'off', 'a switch moved in the middle of a world moves nothing until the next arrival');
  releaseWorldStates();
  ok(stateNow('halloween') === 'off' && stateNow('lifeday') === 'on', 'between worlds a holiday reads what an arrival would take');
  installHolidays(() => {
    throw new Error('a rule that fails');
  });
  ok(stateNow('halloween') === 'off', "a rule that throws stands the holiday at its default, never everything at once");
  ok(serverKeptIn({ soe: {}, halloween: {} }) && serverKeptIn({ restuss: {} }) && !serverKeptIn({ halloween: {}, lifeday: {} }) && !serverKeptIn(null), "only a world with a state a server keeps waits on a server's word");
  forgetWorldStates();
  ok(!isRuled('halloween') && standsIn('halloween=on'), "forgotten, a holiday is a key nobody knows (a build from before stands its rows; the packs need this build)");
}

// --- the real streamer files them -------------------------------------------------------------------------------------------
{
  forgetWorldStates();
  store.clear();
  const on = { halloween: false };
  installHolidays((k) => (k === 'halloween' ? on.halloween : false));
  const objs: SnapshotObject[] = [
    { template: 'object/rock', model: 'rock', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40 },
    { template: 'object/rock', model: 'rock', x: -300, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40, state: 'soe=earlier' },
    { template: 'object/rock', model: 'rock', x: -500, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40, state: 'halloween=on' },
  ];
  const BLOCKS = { soe: { values: ['final', 'earlier'], default: 'final' }, halloween: { values: ['off', 'on'], default: 'off' } };
  takeWorldStates(BLOCKS);
  const h = await makeStreamer(objs, { stands: standsIn });
  ok(h.stream.dormantCount === 2 && h.stream.objectsNear(300, 100, 30).length > 0, "in the final world out of season the earlier rock and the Halloween rock lie dormant, still asked by the placing rules");
  await h.settle({ x: 300, z: 100 });
  ok(h.rayDown(300, 100, 40) === null && h.rayDown(500, 100, 40) === null, 'and nothing of either is solid or stood');
  setLocalWorldState('soe', 'earlier');
  on.halloween = true;
  takeWorldStates(BLOCKS);
  const h2 = await makeStreamer(objs, { stands: standsIn });
  await h2.settle({ x: 300, z: 100 });
  await h2.settle({ x: 500, z: 100 });
  ok(h2.stream.dormantCount === 0 && h2.rayDown(300, 100, 40) !== null && h2.rayDown(500, 100, 40) !== null, 'with the earlier objects standing and Halloween on, both stand and are solid');
  forgetWorldStates();
}

// --- the people who join an added room ------------------------------------------------------------------------------------
{
  const rows = [{ key: 'a' }, { key: 'b', state: 'restuss=living' }, { key: 'c', state: 'soe=earlier' }, { key: 'd' }, { key: 'e', state: 'empireday=on' }];
  const split = laterRows(rows);
  ok(split.own.map((r) => r.key).join(',') === 'a,b,d' && split.later.map((r) => r.key).join(',') === 'c,e', "the rows tagged with an added state come out, Restuss's stay in their places");
  const list = standingList(split.own, [{ key: 'herald' }], [{ key: 'nge' }], [{ key: 'brigade' }, ...split.later]);
  ok(list.map((r) => r.key).join(',') === 'a,b,d,herald,brigade,c,e,nge', 'and stand after the heralds and the brigade, before the overlay, so nobody before them changes place');
  // Every key the converter tags an added state with comes out, and no other: the browser's list is the converter's.
  const tagged = STATE_OBJECT_KEYS.map((k: string, i: number) => ({ key: `t${i}`, state: `${k}=x` }));
  const all = laterRows([...tagged, { key: 'r', state: 'restuss=ruins' }, { key: 'u' }]);
  ok(all.later.length === STATE_OBJECT_KEYS.length && all.own.map((r) => r.key).join(',') === 'r,u' && [...LATER_KEYS].sort().join(',') === [...STATE_OBJECT_KEYS].sort().join(','), `a row tagged with every one of the converter's added keys (${STATE_OBJECT_KEYS.join(', ')}) stands after the brigade, Restuss's and the untagged in their places`);
  // Their names are their own, whatever the brigade before them came to in this browser (a catalogue or a file late, a knob
  // moved): two browsers, one with the brigade and one without, name every row after the heralds alike.
  const named = (brigade: { key: string }[]) => {
    const l = standingList(split.own, [{ key: 'herald' }], [], [...brigade, ...split.later]);
    return new Map(l.map((r, i) => [r.key, stoodName('rori', r, i)]));
  };
  const withBrigade = named([{ key: 'b1' }, { key: 'b2' }, { key: 'b3' }]);
  const without = named([]);
  ok(withBrigade.get('c') === 'stood:rori:soe-c' && without.get('c') === 'stood:rori:soe-c' && withBrigade.get('e') === 'stood:rori:empireday-e' && without.get('e') === withBrigade.get('e') && withBrigade.get('herald') === without.get('herald'), `a row of an added state goes by its state and its own key in every browser (${withBrigade.get('c')}, ${withBrigade.get('e')})`);
  const names = [...withBrigade.values()];
  ok(new Set(names).size === names.length && stoodName('rori', { state: 'soe=earlier' }, 9) === 'stood:rori:9' && stoodName('rori', { key: 'bad key!', state: 'soe=earlier' }, 9) === 'stood:rori:9' && stoodName('rori', { key: '012345678901', state: 'restuss=living' }, 9) === 'stood:rori:9' && stoodName('rori', { key: '012345678901', state: 'soe=earlier' }, 9) === 'stood:rori:soe-012345678901', "no two rows share a name; a row with no plain key, and one of Restuss's, go by their place; a key of figures alone is no place once its state leads it");
}

// --- the settings, the Gameplay page and the Weather section ---------------------------------------------------------------
{
  ok(DEFAULT_SETTINGS.soe === 'final' && DEFAULT_SETTINGS.halloween === -1 && DEFAULT_SETTINGS.loveday === -1 && DEFAULT_SETTINGS.empireday === -1, "the earlier objects start as SOE left the worlds, every holiday in its season");
  const row = GAMEPLAY.flatMap((s) => s.knobs).find((k) => k.key === 'soe') as unknown as { kind: string; choices: { value: string }[] } | undefined;
  ok(!!row && row.kind === 'choice' && row.choices.map((c) => c.value).join(',') === WORLD_STATES.soe.values.join(','), "the Gameplay page's row is the state's own two values");
  const menu = readFileSync(new URL('../../../src/ui/menu.ts', import.meta.url), 'utf8');
  const lifeAt = menu.indexOf("{ key: 'lifeDay'");
  for (const [key, from, to] of [['halloween', '20 Oct', '4 Nov'], ['loveday', '7', '21 Feb'], ['empireday', '1', '21 May']]) {
    const at = menu.indexOf(`{ key: '${key}'`);
    const line = menu.slice(at, menu.indexOf('\n', at));
    ok(at > lifeAt && line.includes("requires: []") && line.includes(`In season (${from} to ${to})`) && line.includes('{ value: 1, label: \'Always\' }') && line.includes('{ value: 0, label: \'Never\' }'), `${key}'s switch stands beside Life Day's in the Weather section, needs no weather, and says its season`);
  }
}

// --- the game's hand-overs ---------------------------------------------------------------------------------------------------
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  const pin = (src: string, re: RegExp, what: string) => ok(re.test(src), what);
  pin(main, /installHolidays\(\(key\) => this\.holidayOnNow\(key\)\);/, 'the game makes every holiday a ruled state at start');
  pin(main, /private holidayOnNow\(key: string\): boolean \{\s*if \(key === 'lifeday'\) return this\.world\.weather\.lifeDayToday\(\);[\s\S]{0,300}?holidayOn\(this\.settings\[def\.setting\] as number, HOLIDAY_SEASONS\[key\], now\.getMonth\(\) \+ 1, now\.getDate\(\)\);/, "Life Day's by the weather's own rule, every other by its switch and today");
  pin(main, /S\.soe = \(localWorldState\('soe'\) \?\? WORLD_STATES\.soe\.default\) as Settings\['soe'\];/, "the earlier objects' row shows the state's own kept setting at start");
  pin(main, /case 'soe':\s*\/\/[^\n]*\n\s*this\.messages\.system\(this\.chooseWorldState\('soe', S\.soe\)\);/, 'moving the row asks the same rule the console asks');
  pin(main, /case 'halloween':\s*case 'loveday':\s*case 'empireday':\s*\/\/[^\n]*\n\s*this\.messages\.system\(this\.holidayWord\(key\)\);/, "a holiday's switch moved is said");
  pin(main, /states: serverKeptIn\(this\.world\.statesComing\),/, "an arrival waits on a server's word only where a state the server keeps is in the world");
  pin(main, /if \(why !== 'gone' && states && typeof states\.soe === 'string'\) this\.mirrorWorldState\('soe', states\.soe\);/, "the server's word shows on the earlier objects' row");
  pin(world, /this\.statesComing = pack\.layout\?\.states \?\? null;\s*if \(pack\.layout\?\.states\) \{/, "the world says which states are coming before the arrival's wait");
  pin(world, /const \{ own: people, later \} = laterRows\(wildLife\.peopleRows\(\) as StandingRow\[\]\);/, "the rows joining an added room come out of the world's own");
  pin(world, /const roster = \[\.\.\.brigade, \.\.\.later\];/, 'and stand after the brigade');
}

console.log(`\n${passed} checks passed`);
