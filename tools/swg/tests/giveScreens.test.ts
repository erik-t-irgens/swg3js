// The give screens' display rules (src/ui/giveModel.ts), and the two panels that draw them, read as
// text the way the wiring tests read main.ts.
//
// What is pinned here is what turned the two tabs from dropdowns into pictures and what would quietly
// turn them back. The rules the dropdowns enforced -- hair belongs to the Appearance tab, a repeated
// id is one item, a piece of the other gender's or one this species cannot wear stays out unless
// asked for, and a piece on the body is shown whatever the switches say -- are the same rules, and a
// picture grid that lost one of them would list a piece the panel then could not put on.
//
// The mark is the other half, and it is the half that was got wrong first. The game calls seven
// different things "Helmet" and names hundreds more the same for longer than a 76-pixel cell can
// print, so a cell that cannot say which one it is has failed however good its picture. The first cut
// appended the whole id to the name, which a cell then clipped off: counted on the owner's own packs
// at the width the cell really shows, 172 of 587 weapon cells and 192 of 915 clothes cells read
// exactly like a neighbour. The mark is therefore short by construction, and what is pinned below is
// that no two cells of a group ever end up reading the same.
//
// And the one that decides whether the screens look broken: what a cell shows when the converter drew
// no picture. It is not a rare accident. Read off the owner's own packs while this was written: with
// the switches as the panel opens them the human folders list 915 and 964 items and every one has a
// picture, while the two Ithorian folders list 519 and 522 of which 172 have none -- every one of
// those a row the client's appearance table marks `:hide` for that species, which the converter
// writes with no meshes at all (`parts` empty, `sat` null). Such a piece draws nothing on the body
// either, so its cell must say "worn unseen" rather than falling back to initials by accident.
//
// Everything here is synthetic. No browser, no document, and nothing read from the game's own files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GIVE_TUNE,
  buildWardrobeView,
  buildWeaponView,
  countLine,
  fullLabel,
  giveCellHtml,
  initialsOf,
  openGroups,
  wearName,
  weaponName,
  type GiveCell,
  type GiveView,
  type WardrobeRow,
  type WeaponRow,
} from '../../../src/ui/giveModel.ts';
import { OTHER_GROUP, SLOT_GROUPS } from '../../../src/core/inventory.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A wardrobe entry with a picture and one mesh, unless the test says otherwise. */
function wear(id: string, more: Partial<WardrobeRow> = {}): WardrobeRow {
  return { id, kind: 'wearables', gender: 'm', icon: `icons/${id}.png`, parts: [{}], ...more };
}

const base = {
  own: 'm',
  species: 'human_male',
  mixed: false,
  blocked: false,
  find: '',
  worn: new Set<string>(),
  dir: 'assets-private/wardrobe/human_male/',
  packPart: () => false,
};

// ---------------------------------------------------------------------------------------------
// The names.
{
  ok(wearName('armor_mandalorian_chest_plate') === 'Mandalorian chest plate', 'an id reads as words, with the list it is in dropped');
  ok(wearName('shirt_s03') === 'Shirt 03', 'and a style number keeps its digits');
  ok(initialsOf('Plain Shirt') === 'PS', 'a name with two words gives two initials');
  ok(initialsOf('Helmet') === 'HE', 'and one word gives its first two letters');
  ok(initialsOf('') === '?', 'a name that is not there gives a mark rather than throwing');
  ok(weaponName({ id: 'carbine_dc15', name: null }).name === 'DC15', "a weapon with no name of the game's takes one from its id");
  ok(weaponName({ id: 'carbine_dc15', name: 'DC-15 Carbine' }).name === 'DC-15 Carbine', "and the game's own name wins when the pack carries it");
}

// ---------------------------------------------------------------------------------------------
// What is listed and what is left out: the dropdowns' own rules, kept to the letter.
{
  const items: WardrobeRow[] = [
    wear('shirt_s03'),
    wear('shirt_s03'), // the same id twice: the first entry is the one that dresses
    wear('hair_s01', { kind: 'hair' }),
    wear('hair_long'),
    wear('jacket_s02', { gender: 'f' }),
    wear('boots_s03', { fit: { block: ['human_male'] } }),
  ];
  const v = buildWardrobeView(items, base);
  const ids = v.groups.flatMap((g) => g.cells.map((c) => c.id));
  ok(!ids.includes('hair_s01') && !ids.includes('hair_long'), "hair is the Appearance tab's and is never listed here");
  ok(ids.filter((i) => i === 'shirt_s03').length === 1, 'a repeated id is one item');
  ok(!ids.includes('jacket_s02') && v.hidden === 1, "a piece authored for the other gender's body stays out, and is counted");
  ok(!ids.includes('boots_s03') && v.blocked === 1, 'so does one this species cannot wear');
  ok(v.listed === 1 && v.shown === 1, `and what is left is what the panel lists (${v.listed})`);

  const both = buildWardrobeView(items, { ...base, mixed: true, blocked: true });
  const bothIds = both.groups.flatMap((g) => g.cells.map((c) => c.id));
  ok(bothIds.includes('jacket_s02') && bothIds.includes('boots_s03'), 'both switches bring them back');
  ok(both.hidden === 0 && both.blocked === 0, 'and nothing is then counted as left out');

  // The one exception the dropdowns had: what is on the body is shown whatever the switches say,
  // because the panel is describing that body.
  const worn = buildWardrobeView(items, { ...base, worn: new Set(['jacket_s02', 'boots_s03']) });
  const wornIds = worn.groups.flatMap((g) => g.cells.map((c) => c.id));
  ok(wornIds.includes('jacket_s02') && wornIds.includes('boots_s03'), 'a piece on the body is listed however it is filtered');
  ok(worn.groups.flatMap((g) => g.cells).every((c) => (c.id === 'shirt_s03' ? !c.on : c.on)), 'and only the pieces on the body are marked worn');

  // A species pack that carries the piece as a part makes it wearable whatever the table says.
  const own = buildWardrobeView(items, { ...base, packPart: (id) => id === 'boots_s03' });
  ok(own.groups.flatMap((g) => g.cells).some((c) => c.id === 'boots_s03' && c.fit === 'ok'), "a piece the species' own pack carries is never blocked");
}

// ---------------------------------------------------------------------------------------------
// Which group a piece is listed under.
{
  const items: WardrobeRow[] = [
    wear('helmet_a', { name: 'Helmet' }),
    wear('helmet_b', { name: 'Helmet' }),
    wear('shirt_s03', { name: 'Plain Shirt' }),
    wear('boots_s03', { name: 'Field Boots' }),
    wear('some_trinket', { name: 'Trinket' }),
  ];
  const v = buildWardrobeView(items, base);
  const by = new Map(v.groups.map((g) => [g.id, g]));
  ok(by.get('head')?.cells.length === 2, 'the two helmets are listed under the head');
  ok(by.get('chest')?.cells[0].id === 'shirt_s03', 'the shirt under the chest');
  ok(by.get('feet')?.cells[0].id === 'boots_s03', 'the boots under the feet');
  ok(by.get('other')?.cells[0].id === 'some_trinket', 'and what fits no slot under Other');
  const order = v.groups.map((g) => g.id);
  const want = [...SLOT_GROUPS, OTHER_GROUP].map((s) => s.id).filter((id) => order.includes(id));
  ok(order.join(',') === want.join(','), `the groups read down the body, Other last (${order.join(', ')})`);
}

// ---------------------------------------------------------------------------------------------
// The mark: the id's own part, where the name a cell shows would not tell it from its neighbour.
//
// Two faults in one rule. The game names two different things the same ("Helmet" seven times), and
// it names many more the same for longer than a cell prints. Both come out here as "these two cells
// read alike", and the check below is that they never do.
{
  /** What a cell really reads as: the name as far as it prints, then the mark under it. */
  const reads = (c: GiveCell) => `${c.name.slice(0, GIVE_TUNE.nameChars)}\u0000${c.mark}`;
  const alike = (v: GiveView) => {
    const bad: string[] = [];
    for (const g of v.groups) {
      const seen = new Map<string, string>();
      for (const c of g.cells) {
        const key = reads(c);
        if (seen.has(key)) bad.push(`${g.id}: ${seen.get(key)} and ${c.id} both read "${c.label} / ${c.mark}"`);
        seen.set(key, c.id);
      }
    }
    return bad;
  };

  const items: WardrobeRow[] = [
    // One name, two things: the plain case the dropdowns handled with the whole id.
    wear('helmet_a', { name: 'Helmet' }),
    wear('helmet_b', { name: 'Helmet' }),
    // One name and ids that agree at both ends: the mark must be the middle, not the start.
    wear('sword_lightsaber_two_handed_s09_gen1', { name: 'Two-Handed Lightsaber' }),
    wear('sword_lightsaber_two_handed_s10_gen1', { name: 'Two-Handed Lightsaber' }),
    // One id the whole start of the other: a mark cut at the common start alone would be empty.
    wear('armor_scout_trooper_utility_belt', { name: 'Utility Belt' }),
    wear('armor_scout_trooper_utility_belt_camo', { name: 'Utility Belt' }),
    // Different names that are the same for longer than the cell prints: the other half of the fault.
    wear('armor_scout_trooper_battle_worn_arm_left', { name: 'Battle Worn Imperial Scout Trooper Armor Left Arm' }),
    wear('armor_scout_trooper_battle_worn_arm_right', { name: 'Battle Worn Imperial Scout Trooper Armor Right Arm' }),
    // A name that is its own: no mark at all.
    wear('shirt_s03', { name: 'Plain Shirt' }),
  ];
  const v = buildWardrobeView(items, { ...base, mixed: true, blocked: true });
  const cells = new Map(v.groups.flatMap((g) => g.cells).map((c) => [c.id, c]));
  ok(cells.get('shirt_s03')!.mark === '', 'a piece whose name is its own within its group carries no mark');
  ok(cells.get('shirt_s03')!.label === 'Plain Shirt', 'and its name is printed as the game gives it, with nothing appended');
  ok(cells.get('sword_lightsaber_two_handed_s09_gen1')!.mark === 's09', `the mark is what differs and nothing else, both ends of the id taken off (${cells.get('sword_lightsaber_two_handed_s09_gen1')!.mark})`);
  ok(cells.get('armor_scout_trooper_utility_belt')!.mark === 'belt', 'and it is never empty, even when one id is the whole start of another');
  ok(cells.get('armor_scout_trooper_utility_belt_camo')!.mark === 'belt_camo', 'the longer of that pair keeping what it has over the other');
  ok(cells.get('armor_scout_trooper_battle_worn_arm_left')!.mark === 'left', 'two different names alike for longer than a cell prints are marked too');
  ok(cells.get('helmet_a')!.mark === 'a' && cells.get('helmet_b')!.mark === 'b', 'and a one-word difference is one character, not a line of id');
  ok(v.marked === 8 && v.shown === 9, `the view counts the marks it gave (${v.marked} of ${v.shown})`);
  ok(alike(v).length === 0, `no two cells of a group read the same${alike(v).length ? `: ${alike(v).join('; ')}` : ''}`);
  ok(fullLabel(cells.get('helmet_a')!) === 'Helmet (a)', 'a heading, which has room for it, puts the mark on the line');
  ok(fullLabel(cells.get('shirt_s03')!) === 'Plain Shirt', 'and leaves an unmarked name alone');

  // Every mark fits its line, whatever the pack throws at it: a family of forty, ids far longer than
  // the line holds, and ids that differ only at the very end.
  const many: WardrobeRow[] = [];
  for (let i = 0; i < 40; i++) many.push(wear(`armor_mandalorian_${'very_long_'.repeat(4)}chest_plate_variant_${String(i).padStart(2, '0')}_gen3`, { name: 'Mandalorian Chest Plate' }));
  const big = buildWardrobeView(many, base);
  const marks = big.groups.flatMap((g) => g.cells).map((c) => c.mark);
  ok(marks.every((m) => m.length > 0 && m.length <= GIVE_TUNE.markChars), `no mark is longer than the line holds (longest ${Math.max(...marks.map((m) => m.length))} of ${GIVE_TUNE.markChars})`);
  ok(new Set(marks).size === marks.length, 'and forty of one name still get forty different marks');
  ok(alike(big).length === 0, 'so none of them reads the same as a neighbour');

  // A mark belongs to the group, not to what the search happened to leave: it must not appear and
  // vanish as the box is typed in.
  const found = buildWardrobeView(items, { ...base, mixed: true, blocked: true, find: 's09' });
  ok(found.shown === 1 && found.groups[0].cells[0].mark === 's09', 'a mark is worked out before the find box filters, so a search does not change it');
}

// ---------------------------------------------------------------------------------------------
// The picture, and what stands in for it. This is the check the screens' look hangs on.
{
  const items: WardrobeRow[] = [
    wear('shirt_s03', { name: 'Plain Shirt' }),
    // The appearance table's `:hide` row as the converter writes it: no meshes, no picture.
    { id: 'armor_chest_plate', kind: 'wearables', gender: 'm', name: 'Chest Plate', icon: null, parts: [], fit: { hide: ['ithorian_male'] } },
    // A piece with meshes whose render came out empty: there is something to draw and no picture of it.
    wear('jacket_s02', { name: 'Field Jacket', icon: null }),
  ];
  const v = buildWardrobeView(items, { ...base, species: 'ithorian_male' });
  const cells = new Map(v.groups.flatMap((g) => g.cells).map((c) => [c.id, c]));
  ok(cells.get('shirt_s03')!.picture === 'icon', 'a piece the converter drew shows its picture');
  ok(cells.get('shirt_s03')!.icon === 'assets-private/wardrobe/human_male/icons/shirt_s03.png', "and the picture is that item's, under the folder the catalogue came from");
  ok(cells.get('armor_chest_plate')!.picture === 'unseen', 'a piece with no meshes at all is marked worn unseen, not merely picture-less');
  ok(/worn unseen/.test(cells.get('armor_chest_plate')!.note), 'and its note says so in words');
  // The cell's mark and the words under it are one field, so they cannot disagree. Before, the corner
  // mark read the picture and the words read the fit, and a `:hide` row that did have a picture got
  // the words and no mark.
  const hidden = buildWardrobeView([wear('armor_shoulder_pad', { name: 'Shoulder Pad', fit: { hide: ['ithorian_male'] } })], { ...base, species: 'ithorian_male' });
  const pad = hidden.groups.flatMap((g) => g.cells)[0];
  ok(pad.picture === 'icon' && pad.unseen && /worn unseen/.test(pad.note), 'a piece this species wears unseen that does have a picture is marked unseen all the same');
  ok(giveCellHtml(pad, { selected: false, on: 'worn' }).includes('give-tag">unseen'), 'and its cell wears the corner mark its words promise');
  ok(cells.get('jacket_s02')!.picture === 'blank', 'a piece with meshes and no picture falls back to initials');
  ok(cells.get('jacket_s02')!.initials === 'FJ', 'which are its own name\'s');
  ok(v.noPicture === 2 && v.unseen === 1, `the counts say how many of each (${v.noPicture} without a picture, ${v.unseen} of them unseen)`);
  ok(cells.get('shirt_s03')!.icon !== null && v.pictures === 1, 'and how many different pictures are on the screen');

  const line = countLine(v);
  ok(/worn unseen/.test(line) && /with no picture/.test(line), `the count line says both, so a screen full of initials is explained (${line})`);

  // With no folder settled on yet there is no URL to give an <img>, and a cell must not point at one.
  const nowhere = buildWardrobeView(items, { ...base, dir: null });
  ok(nowhere.groups.flatMap((g) => g.cells).every((c) => c.icon === null), 'before the wardrobe folder is known no cell claims a picture');
}

// ---------------------------------------------------------------------------------------------
// The find box.
{
  const items: WardrobeRow[] = [wear('shirt_s03', { name: 'Plain Shirt' }), wear('jacket_s02', { name: 'Field Jacket' }), wear('boots_s03', { name: 'Field Boots' })];
  const v = buildWardrobeView(items, { ...base, find: 'field' });
  ok(v.shown === 2 && v.listed === 3, `the find keeps what matches and still says how many there are (${v.shown} of ${v.listed})`);
  const byId = buildWardrobeView(items, { ...base, find: 'shirt_s03' });
  ok(byId.shown === 1 && byId.groups[0].cells[0].id === 'shirt_s03', 'and an id finds its item as surely as a name');
  const none = buildWardrobeView(items, { ...base, find: 'zzz' });
  ok(none.groups.length === 0 && none.shown === 0, 'a find that matches nothing leaves no empty groups behind');
  ok(/1 of 3 items/.test(countLine(byId)), 'the count line says what the find left');
}

// ---------------------------------------------------------------------------------------------
// Which groups open on their own, and how much that draws.
{
  const items: WardrobeRow[] = [wear('shirt_s03'), wear('boots_s03'), wear('helmet_a')];
  const nothing = buildWardrobeView(items, base);
  const openA = openGroups(nothing, '');
  ok(openA.size === 1 && openA.has(nothing.groups[0].id), 'with nothing worn the first group opens, so the panel is never blank');
  const dressed = buildWardrobeView(items, { ...base, worn: new Set(['boots_s03']) });
  const openB = openGroups(dressed, '');
  ok(openB.size === 1 && openB.has('feet'), 'with something worn its group opens and the others stay shut');
  const searched = buildWardrobeView(items, { ...base, find: 's0' });
  const openC = openGroups(searched, 's0');
  ok(openC.size === searched.groups.length && searched.groups.length > 1, 'a search opens every group it found something in');

  // A dressed body wears one piece in each of thirteen slot groups, so "open what holds something
  // worn" opened all thirteen -- 856 cells on the owner's own wardrobe, which is the paging thrown
  // away by the rule that decides what is open. The budget is what keeps the first paint bounded.
  const big: WardrobeRow[] = [];
  const worn = new Set<string>();
  for (const [slot, id] of [['head', 'helmet'], ['neck', 'necklace'], ['chest', 'shirt'], ['back', 'backpack'], ['waist', 'belt'], ['legs', 'pants'], ['feet', 'boots'], ['hands', 'glove']] as const) {
    for (let i = 0; i < 200; i++) big.push(wear(`${id}_s${String(i).padStart(3, '0')}`, { name: `${slot} ${i}` }));
    worn.add(`${id}_s000`);
  }
  const all = buildWardrobeView(big, { ...base, worn });
  const everywhere = openGroups(all, '');
  let drawn = 0;
  for (const g of all.groups) if (everywhere.has(g.id)) drawn += Math.min(g.cells.length, GIVE_TUNE.page);
  ok(all.groups.filter((g) => g.wearing.length).length === 8, 'eight slot groups each hold something worn');
  ok(everywhere.size < 8 && everywhere.size >= 1, `and not all of them open at once (${everywhere.size} did)`);
  ok(drawn <= GIVE_TUNE.openCells, `what the first paint draws is inside the budget (${drawn} of ${GIVE_TUNE.openCells})`);
  const folded = all.groups.filter((g) => g.wearing.length && !everywhere.has(g.id));
  ok(folded.length > 0 && folded.every((g) => !!g.wearing[0]), `a group left folded still names what is worn in it, which is the thing worth knowing (${folded[0]?.id}: ${folded[0]?.wearing[0]})`);

  // One group bigger than the whole budget still opens, or the panel could open with nothing at all.
  const one: WardrobeRow[] = [];
  for (let i = 0; i < GIVE_TUNE.openCells * 2; i++) one.push(wear(`shirt_s${String(i).padStart(4, '0')}`));
  const onlyOne = openGroups(buildWardrobeView(one, { ...base, worn: new Set(['shirt_s0000']) }), '');
  ok(onlyOne.size === 1 && onlyOne.has('chest'), 'the first group holding something worn opens however big it is');
}

// ---------------------------------------------------------------------------------------------
// The weapons rack.
{
  const order = [
    { id: 'lightsaber', label: 'Lightsabers' },
    { id: 'pistol', label: 'Pistols' },
    { id: 'thrown', label: 'Grenades and thrown weapons' },
  ];
  const items: WeaponRow[] = [
    { id: 'sword_lightsaber_one_handed_gen1', class: 'lightsaber', name: 'Lightsaber', length: 1.3, icon: 'icons/saber.png' },
    { id: 'sword_lightsaber_one_handed_gen4', class: 'lightsaber', name: 'Lightsaber', length: 1.3, icon: 'icons/saber.png' },
    { id: 'pistol_dl44', class: 'pistol', name: 'DL-44', length: 0.3, icon: 'icons/dl44.png', description: 'A heavy blaster pistol.' },
    { id: 'grenade_frag', class: 'thrown', name: 'Fragmentation Grenade', length: 0.1, icon: 'icons/frag.png' },
  ];
  const opts = {
    find: '',
    right: 'pistol_dl44',
    left: null as string | null,
    offHand: new Set(['lightsaber']),
    order,
    iconUrl: (w: WeaponRow) => (w.icon ? `assets-private/weapons/${w.icon}` : null),
  };
  const v = buildWeaponView(items, opts);
  ok(v.listed === 4 && v.shown === 4, 'the rack lists every weapon the pack carries');
  ok(v.groups.map((g) => g.id).join(',') === 'lightsaber,pistol,thrown', 'in the rack\'s own class order');
  ok(v.pictures === 3, `a family that shares one model counts as one picture (${v.pictures} for ${v.shown} weapons)`);
  const sabers = v.groups[0].cells;
  ok(sabers.every((c) => c.label === 'Lightsaber') && sabers.map((c) => c.mark).join(',') === 'gen1,gen4', `two weapons the game calls "Lightsaber" are told apart by the id's own part (${sabers.map((c) => c.mark).join(', ')})`);
  ok(v.marked === 2, `and the rack counts them (${v.marked})`);
  const gun = v.groups[1].cells[0];
  ok(gun.on && gun.tag === 'right hand', 'what is in a hand is marked with which hand it is in');
  ok(v.groups[1].wearing.join('') === gun.label, "and its group's heading says what it is holding");
  ok(/reach 0\.30 m/.test(gun.note) && gun.description === 'A heavy blaster pistol.', `the reach and the game's own words come out of the tooltip (${gun.note})`);
  ok(/the right hand/.test(gun.note) && /either hand/.test(v.groups[0].cells[0].note), 'and each says which hands may hold it');
  ok(/thrown from a number slot/.test(v.groups[2].cells[0].note), 'a grenade says it is not held at all');
  const found = buildWeaponView(items, { ...opts, find: 'dl44' });
  ok(found.shown === 1 && found.groups.length === 1, 'the find box narrows the rack as it always did');
}

// ---------------------------------------------------------------------------------------------
// The page: a group draws a page at a time, as the NPC tab's rows do.
{
  const many: WardrobeRow[] = [];
  for (let i = 0; i < GIVE_TUNE.page + 40; i++) many.push(wear(`shirt_s${String(i).padStart(3, '0')}`));
  const v = buildWardrobeView(many, base);
  ok(v.groups[0].cells.length === GIVE_TUNE.page + 40, 'the view holds every cell of a group');
  ok(GIVE_TUNE.page > 0 && GIVE_TUNE.page <= 200, `and the page the panel draws at a time is a sane number (${GIVE_TUNE.page})`);
  ok(GIVE_TUNE.openCells >= GIVE_TUNE.page, 'the first paint may always draw at least one whole page');
  ok(GIVE_TUNE.nameChars > 0 && GIVE_TUNE.markChars > 0 && GIVE_TUNE.findMs > 0, 'and every number the screens invent is in the one object the console moves');
}

// ---------------------------------------------------------------------------------------------
// The cell's own markup, called rather than read out of the file it is written in. Both panels draw
// through this one function, so what is checked here is what both of them put on the screen.
{
  const c: GiveCell = {
    id: 'shirt_s03',
    name: 'Plain Shirt',
    label: 'Plain Shirt',
    mark: 's03',
    tag: 'worn',
    icon: 'assets-private/wardrobe/human_male/icons/shirt_s03.png',
    picture: 'icon',
    initials: 'PS',
    on: true,
    unseen: false,
    fit: 'ok',
    other: false,
    group: 'chest',
    title: 'shirt_s03\ntakes: chest1',
    note: 'takes: chest1',
    description: '',
  };
  const html = giveCellHtml(c, { selected: false, on: 'worn' });
  ok(html.startsWith('<div class="bp-cell worn marked"'), `a cell is the backpack's own cell, and says it carries a mark (${html.slice(0, 44)}…)`);
  ok(html.includes('<img src="assets-private/wardrobe/human_male/icons/shirt_s03.png" loading="lazy" decoding="async"'), 'the picture is the one the converter baked, fetched lazily and decoded off the main thread');
  ok(html.includes('data-id="shirt_s03"') && html.includes('role="button"') && html.includes('tabindex="0"'), 'a click, a double-click and the keyboard can all reach it');
  ok(html.includes('<span class="bp-name"><small>worn</small><br>Plain Shirt</span>'), 'the name is printed plain, with what the cell is doing above it');
  ok(html.includes('<span class="give-id">s03</span>'), "and the id's own part on a line of its own under the name, so the clamp cannot eat it");
  ok(!giveCellHtml({ ...c, mark: '' }, { selected: false, on: 'worn' }).includes('give-id'), 'a cell with nothing to tell apart has no such line, and its name keeps the room');
  ok(!giveCellHtml({ ...c, mark: '' }, { selected: false, on: 'worn' }).includes('marked'), 'nor the class that gives the room away');
  const blank = giveCellHtml({ ...c, picture: 'blank', icon: null, on: false, tag: '' }, { selected: true, on: 'worn' });
  ok(blank.includes('<span class="bp-initials">PS</span>') && !blank.includes('<img'), 'a cell with no picture shows the initials and asks for no image at all');
  ok(blank.includes('bp-cell marked sel') && !blank.includes('worn'), 'and a cell that is picked says so and one that is off the body does not');
  const left = giveCellHtml(c, { selected: false, on: 'held', more: 'give-listing', corner: '<button class="give-off">L</button>' });
  ok(left.includes('bp-cell held give-listing') && /give-off">L<\/button><\/span><span class="bp-name"/.test(left), "the weapons' own class and its left-hand button go on the same cell");
  // Anything a pack can put in a name or an id is escaped, since the cell is built as a string.
  const nasty = giveCellHtml({ ...c, label: 'a"b<c', mark: '<x>', initials: '<>', title: '"&' }, { selected: false, on: 'worn' });
  ok(!/<c|<x>|<>/.test(nasty) && nasty.includes('a&quot;b&lt;c'), 'and every word that came out of a pack is escaped on the way in');
}

// ---------------------------------------------------------------------------------------------
// The two panels, read as text: the things that are about the panel rather than about a cell.
{
  const src = new URL('../../../src/ui/', import.meta.url);
  const wardrobe = readFileSync(new URL('wardrobeUi.ts', src), 'utf8');
  const weapons = readFileSync(new URL('weaponsUi.ts', src), 'utf8');

  for (const [name, text, builder] of [
    ['the Clothes tab', wardrobe, 'buildWardrobeView'],
    ['the Weapons tab', weapons, 'buildWeaponView'],
  ] as const) {
    ok(text.includes(builder), `${name} asks the display rules for its cells`);
    ok(text.includes('giveCellHtml('), `${name} draws them through the one cell the check above pins`);
    ok(text.includes('.bp-cell[data-id]'), `${name} answers a click and a double-click on a cell`);
    ok(text.includes('groupShell('), `${name} draws folding groups whose cells are filled when they are opened`);
    ok(!/<select/.test(text), `${name} has no dropdown left in it`);
    ok(text.includes('class="find"'), `${name} has a find box`);
    ok(text.includes('class="bp-examine"'), `${name} has an examine strip, so a description is read rather than hovered for`);
    // Folding a group and unfolding it fires the same `toggle` as opening it for the first time, so
    // which of the two it is has to be said: guessed, every fold appended another page.
    ok(/private fill\(key: string, more: boolean\)/.test(text), `${name}'s page filling is told whether it is a first draw or the next page`);
    ok(/this\.fill\((?:d\.dataset\.key \?\? '')\, false\)/.test(text), `${name} draws only the first page when a group is opened`);
    ok(/this\.fill\(more\.dataset\.more!, true\)/.test(text), 'and the next page only when the button under it is pressed');
  }
  // The Clothes tab owns a GL context (the doll beside the list, which it always has); the list does
  // not, and must not: a 3D cell would compile a program a material on the main thread.
  ok(!/new THREE\.|WebGLRenderer/.test(wardrobe) && (wardrobe.match(/new CharacterPreview\(\)/g) ?? []).length === 1, 'the Clothes tab draws with nothing but the one doll it always had');
  ok(!/new THREE\.|WebGLRenderer|CharacterPreview/.test(weapons), 'and the Weapons tab touches no GL context at all');
  // The doll is a clone whose geometry the live character shares, so rebuilding it makes the world's
  // renderer upload the whole body again. It must happen on a change of clothes and on nothing else --
  // not on a keystroke in the find box, which rebuilds the list and changes nothing about the body.
  ok((wardrobe.match(/this\.preview\.refresh\(/g) ?? []).length === 1, 'the doll is rebuilt from one place only');
  ok(/private syncDoll\(\): void \{[\s\S]*?this\.preview\.refresh\(/.test(wardrobe), 'and that place is the one that first asks whether the body really changed');
  ok(/if \(this\.dollFor === c && this\.dollParts === key\) return;/.test(wardrobe), 'which it answers from the parts the character holds, not from what the panel did');

  // The panels' own behaviour, which this change was not allowed to touch.
  ok(wardrobe.includes('onWear') && wardrobe.includes('onRemove'), 'the Clothes tab still puts a piece on and takes one off through the game\'s equipment');
  ok(/takes off every worn piece of this group/.test(wardrobe), 'and an empty pick is still the dropdowns\' "— none —"');
  ok(wardrobe.includes('Take everything off'), 'and the strip button is still there');
  ok(/def\.class === 'thrown'/.test(weapons), 'a grenade is still a listing rather than something to hold');
  ok(weapons.includes('blade-colours') && weapons.includes('Empty hands'), 'the blade colours and Empty hands are still on the rack');
  ok(weapons.includes('data-hand="left"') && weapons.includes('data-hand="right"'), 'and both hands are still reachable by a click');

  // The colours. The stylesheet's own rule is checked in hudPage.test.ts; this says the new rules did
  // not sneak a literal into the panels themselves, where that check does not look.
  for (const [name, text] of [['the Clothes tab', wardrobe], ['the Weapons tab', weapons]] as const) {
    // The blade swatches wear the pack's own hex colours, which are the game's data and not ours.
    const styles = [...text.matchAll(/style="(?!background:\$\{h\})([^"]*)"/g)].map((m) => m[1]);
    const typed = styles.filter((s) => /#[0-9a-fA-F]{3,8}|rgba?\(/.test(s));
    ok(typed.length === 0, `${name} types no colour into an inline style${typed.length ? `: ${typed.join(', ')}` : ''}`);
  }

  // Both panels are a long list with an examine strip under it and must take the room the wide
  // panels take: the wardrobe's has carried `wide` since the doll was put beside it, and the rewrite
  // dropped it, which cost the list four per cent of the window's height on the day it grew a strip.
  ok(/class="wardrobe-panel wide give-panel"/.test(wardrobe) && /class="wardrobe-panel wide give-panel"/.test(weapons), 'both give panels are wide panels, as the one with a doll beside its list always was');

  const css = readFileSync(new URL('../../../src/style.css', import.meta.url), 'utf8');
  ok(/#wardrobe \.cat-grid, #weapons \.cat-grid/.test(css), "the give tabs' grids are laid out as picture cells");
  ok(/\.give-tag \{/.test(css) && /\.give-off \{/.test(css), 'and the corner marks a cell wears have rules of their own');
  ok(/\.give-id \{/.test(css) && /\.bp-cell\.marked \.bp-name/.test(css), "the id's own part has a line of its own, and a marked cell gives it the room");
  // A rule that nothing can reach reads as live and is not: both of these were left behind by the
  // widths the give section sets.
  ok(!/#wardrobe \.wardrobe-panel \{ width/.test(css), 'and the width the wardrobe had before is gone rather than left dead under the new one');
  ok(!/#weapons \.wardrobe-panel, #garage/.test(css), 'as is the weapons rack\'s');
}

console.log(`\n${checks} checks passed`);
