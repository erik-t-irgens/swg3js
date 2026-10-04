// The story's detectors (src/world/storyWatch.ts): what the player did that a job may be waiting on.
//
// What is pinned here:
//
//   - a room is the building's template and the cell's own name, as the models name their cells, and the
//     world outside (cell 0) is no room;
//   - an area is a circle, a rectangle or a polygon (a concave one too) in one frame, and a room it names;
//   - an arrival, a room, an area and a world are raised again every `repeatEv` while they stay true, and
//     not before; an arrival is on its world, within its radius and in its room when it names one;
//   - leaving an area is said once, on the edge, and an area nobody watches is forgotten without a word;
//   - going somewhere else (a travel, a death, nowhere to stand) says every area left, each once, and with
//     no view the areas are remembered until somebody can be told;
//   - a kill is handed on only when a kill step counts it, once per body within `killDedupe`; a death only
//     when a step fails on it; one body is one name however its death is heard, and only the server's word
//     of a death this browser struck credits the player;
//   - with no view, or no place, no arrival, room or world is raised.
//
// Synthetic: a view and a place made up here.
import assert from 'node:assert/strict';
import { STORY_TUNE } from '../../../src/story/bookClient.ts';
import type { StoryEvent } from '../../../src/story/quests.ts';
import type { StoryView, Watch } from '../../../src/story/view.ts';
import { StoryWatch, creditedByWord, inShape, killKey, killMatches, killOf, roomOf, roomSignal, sameRoom, type WatchPlace } from '../../../src/world/storyWatch.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const CANTINA = 'object/building/tatooine/shared_cantina_tatooine.iff';
const viewOf = (watch: Watch[]): StoryView => ({ rev: 1, quests: [], waypoints: [], watch, cast: [], objects: [], tracked: [], trackWp: null });

// ---- rooms --------------------------------------------------------------------------------------------------
{
  const cells = [
    { index: 0, name: 'world' },
    { index: 1, name: 'cantina' },
    { index: 2, name: '' },
  ];
  const r = roomOf(CANTINA, cells, 1);
  ok(r?.cell === 'cantina' && r.template === CANTINA, 'a cell is a room by its own name and its building\'s template');
  ok(roomOf(CANTINA, cells, 0) === null && roomOf(CANTINA, cells, 2) === null && roomOf(CANTINA, cells, 9) === null && roomOf(CANTINA, undefined, 1) === null, 'the world outside, a cell with no name, a cell the model has not and a model with no cells are no room');
  ok(roomSignal(r!) === `room:${CANTINA}#cantina`, 'and its signal is room:<template>#<cell>');
  ok(sameRoom(undefined, null) && sameRoom({ cell: 'cantina' }, r) && sameRoom({ cell: 'cantina', template: CANTINA }, r) && !sameRoom({ cell: 'cantina', template: 'object/building/other.iff' }, r) && !sameRoom({ cell: 'foyer1' }, r) && !sameRoom({ cell: 'cantina' }, null), 'a watch with no room takes any; one with a room asks its cell, and its template only when it names one');
}

// ---- shapes -------------------------------------------------------------------------------------------------
{
  const circle = { kind: 'circle' as const, c: [10, 20] as [number, number], r: 5 };
  ok(inShape(circle, 13, 24) && !inShape(circle, 16, 20), 'a circle: inside within its radius, outside past it');
  const rect = { kind: 'rect' as const, min: [0, 0] as [number, number], max: [10, 4] as [number, number] };
  ok(inShape(rect, 10, 4) && inShape(rect, 0, 0) && !inShape(rect, 11, 2) && !inShape(rect, 5, -1), 'a rectangle, its edges inside');
  // A U: the bowl between the arms is outside.
  const u = { kind: 'poly' as const, pts: [[0, 0], [9, 0], [9, 9], [6, 9], [6, 3], [3, 3], [3, 9], [0, 9]] as [number, number][] };
  ok(inShape(u, 1, 8) && inShape(u, 8, 8) && inShape(u, 4.5, 1) && !inShape(u, 4.5, 6) && !inShape(u, 12, 1), 'a polygon, a concave one included: in the arms and the base, not in the bowl between them');
}

// ---- arrivals, level-triggered --------------------------------------------------------------------------------
{
  const w = new StoryWatch();
  const got: StoryEvent[] = [];
  const out = (ev: StoryEvent) => got.push(ev);
  const view = viewOf([{ k: 'arrive', quest: 'test:goto', step: 'cantina', world: 'tatooine', f: 'raw', p: [3432, -4818], radius: 16, room: { cell: 'cantina', template: CANTINA } }]);
  const at: WatchPlace = { world: 'tatooine', x: 3432, z: -4818, room: null };
  w.step(view, at, 0, out);
  ok(got.length === 0, 'at the place but not in its room: no arrival');
  at.room = { cell: 'cantina', template: CANTINA };
  w.step(view, at, 100, out);
  const first = got[0];
  ok(got.length === 1 && first.k === 'arrive' && first.quest === 'test:goto' && first.step === 'cantina' && first.room?.cell === 'cantina', 'in the room: the arrival, naming its quest and step and the room');
  w.step(view, at, 100 + STORY_TUNE.repeatEv - 1, out);
  ok(got.length === 1, 'still there within repeatEv: nothing more');
  w.step(view, at, 100 + STORY_TUNE.repeatEv, out);
  ok(got.length === 2, 'and again once repeatEv has gone by, while it stays true');
  // Out and straight back in, both well within repeatEv of the last raise: only stepping out re-arms it.
  at.x += 20;
  w.step(view, at, 100 + STORY_TUNE.repeatEv + 10, out);
  at.x -= 20;
  w.step(view, at, 100 + STORY_TUNE.repeatEv + 20, out);
  ok(got.length === 3, 'out of its radius and back: arrived again at once, however soon after the last');
  at.world = 'naboo';
  w.step(view, at, 100 + STORY_TUNE.repeatEv * 5, out);
  ok(got.length === 3, 'the same numbers on another world are not the place');
  w.step(null, at, 100 + STORY_TUNE.repeatEv * 6, out);
  w.step(view, null, 100 + STORY_TUNE.repeatEv * 7, out);
  ok(got.length === 3, 'and with no view, or no place, nothing is raised');
}

// ---- areas: in on the edge and while in, out once ------------------------------------------------------------
{
  const w = new StoryWatch();
  const got: StoryEvent[] = [];
  const out = (ev: StoryEvent) => got.push(ev);
  const square: Watch = { k: 'area', id: 'test:area/test-square', world: 'tatooine', shape: { kind: 'circle', c: [3476, -4694], r: 12 } };
  const view = viewOf([square]);
  const at: WatchPlace = { world: 'tatooine', x: 3000, z: -4000, room: null };
  w.step(view, at, 0, out);
  ok(got.length === 0 && !w.inside.length, 'outside the area from the start: nothing said, not even that it is not entered');
  at.x = 3476;
  at.z = -4694;
  w.step(view, at, 1000, out);
  ok(got.length === 1 && got[0].k === 'area' && got[0].inside && w.inside.includes('test:area/test-square'), 'stepping in: entered, and the area is one the conditions see the player in');
  w.step(view, at, 1000 + STORY_TUNE.repeatEv, out);
  ok(got.length === 2 && got[1].k === 'area' && got[1].inside, 'raised again while in it, after repeatEv');
  at.x = 3000;
  w.step(view, at, 1000 + STORY_TUNE.repeatEv + 10, out);
  w.step(view, at, 1000 + STORY_TUNE.repeatEv * 4, out);
  ok(got.length === 3 && got[2].k === 'area' && !got[2].inside && !w.inside.length, 'stepping out: said once, on the edge, and never again while out');
  at.x = 3476;
  w.step(view, at, 1000 + STORY_TUNE.repeatEv * 5, out);
  w.step(viewOf([]), at, 1000 + STORY_TUNE.repeatEv * 6, out);
  ok(got.length === 4 && !w.inside.length, 'an area nobody watches any more is forgotten without a word of leaving it');
  // A room on an area: the right cell or nothing.
  const inRoom: Watch = { k: 'area', id: 'own:area/bar', world: 'tatooine', shape: { kind: 'rect', min: [3400, -4850], max: [3460, -4790] }, room: { cell: 'cantina' } };
  const w2 = new StoryWatch();
  const got2: StoryEvent[] = [];
  w2.step(viewOf([inRoom]), { world: 'tatooine', x: 3432, z: -4818, room: null }, 0, (ev) => got2.push(ev));
  w2.step(viewOf([inRoom]), { world: 'tatooine', x: 3432, z: -4818, room: { cell: 'cantina', template: CANTINA } }, 10, (ev) => got2.push(ev));
  ok(got2.length === 1 && got2[0].k === 'area' && got2[0].inside, 'an area that names a room is entered only from inside that room');
}

// ---- rooms and worlds, level-triggered --------------------------------------------------------------------------
{
  const w = new StoryWatch();
  const got: StoryEvent[] = [];
  const out = (ev: StoryEvent) => got.push(ev);
  const view = viewOf([{ k: 'room' }, { k: 'world' }]);
  const at: WatchPlace = { world: 'tatooine', x: 0, z: 0, room: null };
  w.step(view, at, 0, out);
  ok(got.length === 1 && got[0].k === 'world' && got[0].world === 'tatooine', 'arriving on a world raises it; the street is no room');
  at.room = { cell: 'cantina', template: CANTINA };
  w.step(view, at, 10, out);
  ok(got.length === 2 && got[1].k === 'room' && got[1].cell === 'cantina' && got[1].template === CANTINA, 'stepping into a room raises it, by its template and its cell');
  w.step(view, at, 20, out);
  ok(got.length === 2, 'standing in it raises nothing more within repeatEv');
  w.step(view, at, 10 + STORY_TUNE.repeatEv, out);
  ok(got.filter((e) => e.k === 'room').length === 2 && got.filter((e) => e.k === 'world').length === 2, 'and after it, the room and the world again');
  at.room = { cell: 'foyer1', template: CANTINA };
  w.step(view, at, 20 + STORY_TUNE.repeatEv, out);
  ok(got.filter((e) => e.k === 'room').length === 3 && got.at(-1)?.k === 'room' && (got.at(-1) as { cell: string }).cell === 'foyer1', 'another room is raised at once');
  w.reset();
  w.step(view, at, 30 + STORY_TUNE.repeatEv, out);
  ok(got.filter((e) => e.k === 'world').length === 3, 'and after a reset (a new world) everything true is raised afresh');
  at.world = 'naboo';
  w.step(view, at, 40 + STORY_TUNE.repeatEv, out);
  ok(got.filter((e) => e.k === 'world').length === 4 && got.at(-1)?.k === 'world' && (got.at(-1) as { world: string }).world === 'naboo', 'another world, with no reset and well within repeatEv of the last: raised at once');
  const quiet = new StoryWatch();
  const none: StoryEvent[] = [];
  quiet.step(viewOf([]), at, 0, (ev) => none.push(ev));
  ok(none.length === 0, 'with nothing watched, a room and a world are raised for nobody');
}

// ---- kills and deaths ----------------------------------------------------------------------------------------------
{
  ok(killMatches({ who: ['kreetle'] }, { who: 'kreetle', npc: 'a' }) && !killMatches({ who: ['kreetle'] }, { who: 'womp_rat', npc: 'a' }), 'a kill step names its creatures by their catalogue id');
  ok(killMatches({ social: 'rat' }, { who: 'womp_rat', social: 'rat', npc: 'a' }) && !killMatches({ social: 'rat', tag: 'boss' }, { who: 'womp_rat', social: 'rat', tags: ['pack'], npc: 'a' }) && killMatches({ tag: 'boss' }, { who: 'x', tags: ['boss'], npc: 'a' }), 'and by its social group and its tag, every field given matching');
  ok(killMatches({ group: 'tatooine_creatures' }, { who: 'x', group: 'tatooine_creatures', npc: 'a' }) && !killMatches({ group: 'tatooine_creatures' }, { who: 'x', group: 'naboo_creatures', npc: 'a' }) && !killMatches({ group: 'tatooine_creatures' }, { who: 'x', npc: 'a' }), 'and by its catalogue group, which a body with no group never matches');
  const w = new StoryWatch();
  const got: StoryEvent[] = [];
  const out = (ev: StoryEvent) => got.push(ev);
  const view = viewOf([{ k: 'kill', quest: 'test:kill', step: 'mites', match: { who: ['kreetle'] } }, { k: 'death' }]);
  ok(w.kill(view, { who: 'kreetle', npc: 'wild:a:1', group: 'insect' }, 0, out) && got[0].k === 'kill' && got[0].who === 'kreetle' && got[0].npc === 'wild:a:1', 'a kill a step counts is handed on, with its creature and its body');
  ok(!w.kill(view, { who: 'kreetle', npc: 'wild:a:1' }, 5000, out) && got.length === 1, 'the same body again within killDedupe is the same kill');
  ok(w.kill(view, { who: 'kreetle', npc: 'wild:a:1' }, STORY_TUNE.killDedupe + 1, out) && got.length === 2, 'past it, a body of that name is another (a new life at the same post)');
  ok(!w.kill(view, { who: 'bantha', npc: 'wild:b:1' }, 0, out) && !w.kill(null, { who: 'kreetle', npc: 'wild:a:9' }, 0, out) && got.length === 2, 'a kill nothing counts, or with no view, is not handed on');
  ok(w.death(view, out) && got.at(-1)?.k === 'death' && !w.death(viewOf([]), out), 'a death is handed on only when something fails on it');
}

// ---- going somewhere else: every area left is said ------------------------------------------------------------------
{
  const square: Watch = { k: 'area', id: 'test:area/test-square', world: 'tatooine', shape: { kind: 'circle', c: [3476, -4694], r: 12 } };
  const yard: Watch = { k: 'area', id: 'own:area/yard', world: 'tatooine', shape: { kind: 'circle', c: [3476, -4694], r: 50 } };
  const view = viewOf([square, yard]);
  const at: WatchPlace = { world: 'tatooine', x: 3476, z: -4694, room: null };
  const w = new StoryWatch();
  const got: StoryEvent[] = [];
  const out = (ev: StoryEvent) => got.push(ev);
  w.step(view, at, 0, out);
  ok(w.inside.length === 2 && got.length === 2, 'standing in two areas at once');
  // What a condition reads while the leaving is said: the area being left is already gone from the list.
  const seen: number[] = [];
  ok(w.leaveAll((ev) => (got.push(ev), seen.push(w.inside.length))) === 2 && !w.inside.length, 'a travel begun: both are left');
  const left = got.slice(2);
  ok(left.length === 2 && left.every((e) => e.k === 'area' && !e.inside) && seen.join() === '1,0', 'each said once, as leaving, after it is off the list a condition reads');
  ok(w.leaveAll(out) === 0 && got.length === 4, 'and said again, nothing: they are all left already');
  w.step(view, at, 10, out);
  ok(got.length === 6 && w.inside.length === 2, 'back where they were, both are entered again at once');
  // Nowhere to stand (between worlds): the player is in no area, and that is said.
  w.step(view, null, 20, out);
  ok(got.length === 8 && got.slice(6).every((e) => e.k === 'area' && !e.inside) && !w.inside.length, 'with nowhere to stand, every area is left and said');
  // No view (a server taking the book, the line coming back): nobody can be told, so nothing is forgotten,
  // and the edge is found once somebody can be.
  w.step(view, at, 30, out);
  const before = got.length;
  w.step(null, at, 40, out);
  ok(got.length === before && w.inside.length === 2, 'with no view nothing is said and the areas stood in are remembered');
  at.x = 0;
  w.step(null, at, 50, out);
  w.step(view, at, 60, out);
  ok(got.length === before + 2 && got.slice(before).every((e) => e.k === 'area' && !e.inside), 'so walking out while nobody could be told is said as leaving when somebody can be');
}

// ---- one body's death, however it is heard ------------------------------------------------------------------------
{
  // A body the server stood is shared under the world's own name for it, so the blow seen here (which knows
  // its shared name and asks the world for its own) and the server's word (which names it) reach one string.
  ok(killKey('wild:lair:1', 'wild:lair:1', 7) === 'wild:lair:1' && killKey('wild:lair:1', 'wild:lair:1', 7) === killKey('wild:lair:1', 'wild:lair:1', 9), 'a shared body is known by its shared name, from the blow and from the word alike');
  ok(killKey('', 'wild:lair:1', 7) === 'wild:lair:1', 'a body of the world\'s own that is off the wire by the world\'s name for it');
  ok(killKey('wild:lair:2', '', 7) === 'wild:lair:2' && killKey('wild:lair:2', 'wild:lair:9', 7) === 'wild:lair:2', 'and the shared name wins over any other, since it is the one the server\'s word carries');
  ok(killKey('', '', 7) === 'ours:7' && killKey('', '', 7) !== killKey('', '', 8), 'and one this browser stood for itself by a name of its own');
  const plain = killOf({ id: 'kreetle', group: 'tatooine' }, 'wild:a:1');
  ok(plain.who === 'kreetle' && plain.group === 'tatooine' && plain.social === undefined && plain.tags === undefined && plain.npc === 'wild:a:1', 'an entry from a catalogue with no stats is a kill by its id and group alone');
  const full = killOf({ id: 'womp_rat', group: '', stats: { tags: ['pack'], core3: { socialGroup: 'rat' } } }, 'wild:r:1');
  ok(full.group === undefined && full.social === 'rat' && full.tags?.join() === 'pack', 'and one with stats carries its social group and its tags, an empty group left out');
  ok(killOf({ id: 'x', stats: { tags: [], core3: null } }, 'n').tags === undefined, 'no tags and no emulator row: neither is carried');
  // The server's word: a death this browser's player struck, and nothing else.
  ok(creditedByWord('dead', false, 7, [3, 7]), 'a death with this browser among those who struck it credits the player');
  ok(!creditedByWord('dead', true, 7, [7]), 'not one that was already down when this browser stood it');
  ok(!creditedByWord('taken', false, 7, [7]) && !creditedByWord('removed', false, 7, [7]), 'not a body taken down rather than killed');
  ok(!creditedByWord('dead', false, 7, [3, 4]) && !creditedByWord('dead', false, 7, []), 'not one somebody else killed, nor one nobody is named for');
  ok(!creditedByWord('dead', false, 0, [0]), 'and never with no line, whatever the list says');
}

console.log(`\n${checks} checks passed`);
