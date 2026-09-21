// The character select screen's rules (src/ui/selectModel.ts), apart from the page: the five places in
// the list, where a key moves the choice and what it asks for, what a name may be, and how a record's
// place and times are put into words.
//
// Everything here is synthetic: made-up records and a made-up list of worlds. Nothing is read from the
// game's files and no page is built.
import assert from 'node:assert/strict';
import { agoWords, classGlyph, classWords, cleanName, initialIndex, keyAction, NAME_MAX, placeWords, safeColour, slotsFor, stepIndex, type PlaceDef } from '../../../src/ui/selectModel.ts';
import { readFileSync } from 'node:fs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const rec = (id: string, played: number, extra: Record<string, unknown> = {}) =>
  ({ id, name: id.toUpperCase(), species: 'human_male', class: 'jedi', appearance: { morphs: {}, values: {}, height: 0.5 }, outfit: [], planet: 'tatooine', created: 1, played, ...extra }) as any;

// --- the places in the list ----------------------------------------------------------------------
{
  const two = [rec('a', 10), rec('b', 30)];
  const s = slotsFor(two, 5);
  ok(s.length === 5, 'five places whatever the number of characters');
  ok(s[0].kind === 'char' && s[1].kind === 'char', 'the characters first, in the order they are kept');
  ok(s[2].kind === 'empty' && s[2].first && s.slice(3).every((x) => x.kind === 'empty' && !x.first), 'then the free places, the first of them where Create sits');
  ok(slotsFor([], 5).every((x) => x.kind === 'empty') && (slotsFor([], 5)[0] as any).first, 'no characters: five free places, Create first');
  const six = slotsFor([1, 2, 3, 4, 5, 6].map((n) => rec(`c${n}`, n)), 5);
  ok(six.length === 6 && six.every((x) => x.kind === 'char'), 'a store written past the cap shows every character and no free place, rather than hiding one');
  ok(slotsFor([1, 2, 3, 4, 5].map((n) => rec(`c${n}`, n)), 5).every((x) => x.kind === 'char'), 'a full list has no place to create in');
}

// --- which one is chosen when the screen opens ---------------------------------------------------------
{
  const s = slotsFor([rec('a', 10), rec('b', 30), rec('c', 20)], 5);
  ok(initialIndex(s, null) === 1, 'the character played last is chosen');
  ok(initialIndex(s, 'c') === 2, 'unless one was chosen before and is still there');
  ok(initialIndex(s, 'gone') === 1, 'one chosen before and since deleted falls back to the last played');
  ok(initialIndex(slotsFor([rec('a', 0), rec('b', 0)], 5), null) === 0, 'nobody ever played: the first');
  ok(initialIndex(slotsFor([], 5), null) === 0, 'no characters: the first free place, which is Create');
  ok(initialIndex([], null) === -1, 'and nothing at all when there is no place');
  ok(initialIndex(slotsFor([rec('a', NaN)], 5), null) === 0, 'a broken time does not stop a choice');
}

// --- moving through it ----------------------------------------------------------------------------------
{
  ok(stepIndex(0, -1, 5) === 0, 'up at the top stays at the top: a held key does not spin round');
  ok(stepIndex(4, 1, 5) === 4, 'and down at the bottom stays at the bottom');
  ok(stepIndex(2, 1, 5) === 3 && stepIndex(2, -1, 5) === 1, 'one step each way in the middle');
  ok(stepIndex(-1, 1, 5) === 1 && stepIndex(-1, -1, 5) === 0, 'from nothing chosen a step lands inside the list');
  ok(stepIndex(0, 1, 0) === -1, 'and an empty list has nowhere to go');
}

// --- what a key asks for ---------------------------------------------------------------------------------
{
  ok(keyAction('ArrowUp', false, false) === 'up' && keyAction('KeyW', false, false) === 'up', 'Up and W go up');
  ok(keyAction('ArrowDown', false, false) === 'down' && keyAction('KeyS', false, false) === 'down', 'Down and S go down');
  ok(keyAction('ArrowDown', false, true) === 'down', 'a held arrow keeps moving');
  ok(keyAction('Enter', false, false) === 'play' && keyAction('NumpadEnter', false, false) === 'play', 'Enter plays the chosen character');
  ok(keyAction('Enter', true, false) === 'create', 'and makes one on a free place');
  ok(keyAction('Enter', false, true) === null, 'a held Enter plays nothing: it cannot go on to the next entry');
  ok(keyAction('Delete', false, false) === 'delete', 'Delete asks to delete');
  ok(keyAction('Delete', true, false) === null && keyAction('Delete', false, true) === null, 'but never on a free place, and never from a held key');
  ok(keyAction('F2', false, false) === 'rename' && keyAction('F2', true, false) === null, 'F2 renames a character and nothing else');
  ok(keyAction('Home', false, false) === 'first' && keyAction('End', false, false) === 'last', 'Home and End go to the ends');
  ok(keyAction('KeyA', false, false) === null && keyAction('Escape', false, false) === null && keyAction('Backspace', false, false) === null, 'every other key is left alone');
}

// --- names -----------------------------------------------------------------------------------------------
{
  ok(NAME_MAX === 24, 'a name is at most 24 characters, as the creator has it');
  ok(cleanName('  Kyle Katarn ') === 'Kyle Katarn', 'trimmed at both ends');
  ok(cleanName('') === null && cleanName('    ') === null, 'and nothing left is no name at all');
  ok(cleanName('x'.repeat(40))!.length === NAME_MAX, 'a long one is cut to the creator\'s length');
  ok(cleanName(`${'y'.repeat(23)}  z`) === 'y'.repeat(23), 'and one cut at a space is trimmed again');
  const creator = readFileSync(new URL('../../../src/ui/creatorBar.ts', import.meta.url), 'utf8');
  ok(creator.includes(`maxlength="${NAME_MAX}"`), 'the creator still asks for the same length, so the two cannot drift');
}

// --- words ------------------------------------------------------------------------------------------------
{
  const now = 1_000_000_000_000;
  ok(agoWords(0, now) === 'never played', 'a character never played says so');
  ok(agoWords(now - 5_000, now) === 'just now', 'a few seconds ago is just now');
  ok(agoWords(now - 5 * 60_000, now) === '5 min ago', 'minutes');
  ok(agoWords(now - 3 * 3_600_000, now) === '3 h ago', 'hours');
  ok(agoWords(now - 30 * 3_600_000, now) === 'yesterday', 'a day');
  ok(agoWords(now - 5 * 86_400_000, now) === '5 days ago', 'days');
  ok(agoWords(now + 60_000, now) === 'just now', 'a clock that has gone back is not a time in the future');
  ok(classWords('jedi') === 'Jedi' && classWords('bounty_hunter') === 'Bounty Hunter', 'the two classes by their names');
  ok(classGlyph('jedi') === 'ic-saber' && classGlyph('bounty_hunter') === 'ic-blaster', 'and their marks');
  const sheet = readFileSync(new URL('../../../src/ui/hud.svg', import.meta.url), 'utf8');
  ok([classGlyph('jedi'), classGlyph('bounty_hunter'), classGlyph('someone')].every((id) => sheet.includes(`id="${id}"`)), 'every class mark is one the sheet draws');
  ok(safeColour('#3aa0ff') === '#3aa0ff' && safeColour('#ABC') === '#ABC', 'a hex saber colour goes into the page');
  ok(safeColour('red;background:url(x)') === null && safeColour(undefined) === null && safeColour(12) === null, 'and nothing else ever does');
}

// --- where a character is ---------------------------------------------------------------------------------
{
  const worlds: PlaceDef[] = [
    { id: 'tatooine', name: 'Tatooine' },
    { id: 'kashyyyk', name: 'Kashyyyk', zones: [{ id: 'main', name: 'Kachirho' }, { id: 'hunting', name: 'Etyyy' }] },
    { id: 'space_tatooine', name: 'Tatooine orbit', space: 'tatooine' },
    { id: 'space_light1', name: 'Kessel', space: 'kessel' },
  ];
  const at = (planet: string, zone?: string, pos?: number[]) => placeWords({ planet, zone, pos } as any, worlds);
  ok(at('tatooine', undefined, [1, 2, 3]).line === 'Tatooine' && !at('tatooine', undefined, [1, 2, 3]).fresh, 'a planet is its name');
  ok(at('tatooine').fresh, 'a character that has never stood anywhere is new');
  ok(at('kashyyyk', 'hunting').line === 'Kashyyyk · Etyyy', 'a zone of a many-zoned world is named');
  ok(at('kashyyyk', 'nowhere').within === 'nowhere', 'a zone the list does not know is said as it is kept');
  ok(at('tatooine', 'main').within === '', 'a zone on a world with none is not invented');
  ok(at('space_tatooine').line === 'Tatooine · in orbit', 'an orbit is the planet under it, in orbit');
  ok(at('space_light1').line === 'Kessel · in space', 'a system with nothing below is itself, in space');
  ok(at('gone_planet').world === 'gone_planet', 'a world no longer in the game is said by its id rather than dropped');
  ok(at('').world === 'somewhere unknown', 'and a record with none says so');
}

console.log(`\n${checks} checks passed`);
