// The backpack's pure rules (src/core/inventory.ts) and the item facts (src/player/items.ts): which
// arrangement a piece takes and what it displaces, which hand a weapon goes in, bringing an old saved
// character into owned items, the starting kit, the species' verdict with the species packs' own
// pieces, the words for slots, and a repeated id in a wardrobe. Plain node, no game files needed.
import assert from 'node:assert/strict';
import { OFF_HAND_CLASSES, chooseArrangement, cleanTint, countOf, fitFor, migrateInventory, mintThing, normalizeOwned, occupancy, packPartOf, partToItemId, planHold, resolveKit, slotWords, speciesWords, thingOf, type Fit, type HeldRef, type OwnedItem } from '../../../src/core/inventory.ts';
import { itemInfo, wardrobeIndex, type ItemContext } from '../../../src/player/items.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The game's own arrangements (dumped from the archives).
const SHIRT = [['chest1']];
const JACKET = [['chest2', 'bicep_l', 'bicep_r', 'bracer_upper_l', 'bracer_upper_r', 'bracer_lower_l', 'bracer_lower_r']];
const PADAWAN = [['chest2', 'chest3_l', 'chest3_r', 'bicep_l', 'bicep_r', 'bracer_lower_l', 'bracer_lower_r', 'bracer_upper_l', 'bracer_upper_r', 'cloak', 'pants1', 'pants2', 'shoes']];
const PANTS = [['pants1']];
const SHOES = [['shoes']];
const HAT = [['hat']];
const EYES = [['eyes']];
const HELMET_CLOSED = [['hat', 'eyes', 'mouth']];
const RING_EITHER = [['ring_l'], ['ring_r']];
const HOLD_R = [['hold_r']];
const HOLD_BOTH = [['hold_r', 'hold_l']];

// --- 1: arrangements and what they displace --------------------------------------------------
{
  const worn = [{ id: 'jacket_s02', slots: JACKET[0] }];
  const shirt = chooseArrangement(SHIRT, occupancy(worn), 'shirt_s03');
  ok(same(shirt.slots, ['chest1']) && shirt.displaced.length === 0, 'a shirt beside a worn jacket displaces nothing (chest1 against chest2)');
  const dressed = [
    { id: 'shirt_s03', slots: SHIRT[0] },
    { id: 'jacket_s02', slots: JACKET[0] },
    { id: 'pants_s04', slots: PANTS[0] },
    { id: 'shoes_s02', slots: SHOES[0] },
  ];
  const robe = chooseArrangement(PADAWAN, occupancy(dressed), 'robe_jedi_padawan');
  ok(same([...robe.displaced].sort(), ['jacket_s02', 'pants_s04', 'shoes_s02']), 'the Padawan robe displaces the jacket, the trousers and the shoes');
  ok(!robe.displaced.includes('shirt_s03'), 'and not the shirt');
  const head = chooseArrangement(HELMET_CLOSED, occupancy([{ id: 'hat_s04', slots: HAT[0] }, { id: 'goggles_s01', slots: EYES[0] }]), 'helmet_x');
  ok(same([...head.displaced].sort(), ['goggles_s01', 'hat_s04']), 'a closed helmet displaces a hat and goggles');
}

// --- 2: the "either" arrangements --------------------------------------------------------------
{
  const free = chooseArrangement(RING_EITHER, occupancy([]), 'ring_a');
  ok(same(free.slots, ['ring_l']) && !free.displaced.length, 'a ring goes on the left hand while it is free');
  const left = chooseArrangement(RING_EITHER, occupancy([{ id: 'ring_a', slots: ['ring_l'] }]), 'ring_b');
  ok(same(left.slots, ['ring_r']) && !left.displaced.length, 'a second ring goes on the other hand');
  const both = chooseArrangement(RING_EITHER, occupancy([{ id: 'ring_a', slots: ['ring_l'] }, { id: 'ring_b', slots: ['ring_r'] }]), 'ring_c');
  ok(same(both.slots, ['ring_l']) && same(both.displaced, ['ring_a']), 'both taken: the first alternative, displacing only its wearer');
  const none = chooseArrangement(null, occupancy([{ id: 'x', slots: ['chest1'] }]), 'y');
  ok(none.slots.length === 0 && none.displaced.length === 0, 'no arrangements occupy and displace nothing');
  const self = chooseArrangement(SHIRT, occupancy([{ id: 'shirt_s03', slots: ['chest1'] }]), 'shirt_s03');
  ok(same(self.slots, ['chest1']) && !self.displaced.length, "an item's own slots never displace itself");
}

// --- 3: the hands --------------------------------------------------------------------------------
{
  const w = (id: string, cls: string, slots: string[][] | null): HeldRef => ({ id, cls, slots });
  const rifle = w('rifle_e11', 'rifle', HOLD_BOTH);
  const sword = w('sword_01', 'sword1h', HOLD_R);
  const saberA = w('saber_a', 'lightsaber', HOLD_BOTH);
  const saberB = w('saber_b', 'lightsaber', HOLD_BOTH);
  const pistol = w('pistol_cdef', 'pistol', HOLD_R);
  const staff = w('saber_staff', 'lightsaberStaff', HOLD_BOTH);
  const grenade = w('grenade_x', 'thrown', HOLD_R);
  let p = planHold({ right: null, left: sword }, rifle, 'right');
  ok(p.hand === 'right' && p.stow.includes('left'), 'a rifle (both hands, no off-hand use) to the right stows the left');
  p = planHold({ right: null, left: saberB }, saberA, 'right');
  ok(p.hand === 'right' && !p.stow.includes('left'), 'a lightsaber (hold_both, but an off-hand class) to the right keeps a left lightsaber');
  p = planHold({ right: null, left: sword }, pistol, 'right');
  ok(p.stow.includes('left'), 'a pistol to the right stows a left blade');
  p = planHold({ right: rifle, left: null }, sword, 'left');
  ok(p.hand === 'left' && p.stow.includes('right'), 'a blade to the left with a rifle in the right stows the right');
  p = planHold({ right: null, left: null }, staff, 'left');
  ok(p.hand === 'right', 'a double-bladed saber asked for the left goes right');
  p = planHold({ right: null, left: null }, grenade, 'right');
  ok(!!p.refused, 'a thrown weapon is refused');
  p = planHold({ right: saberA, left: null }, saberA, 'left');
  ok(p.hand === 'left' && p.stow.includes('right'), "moving the right's own saber to the left empties the right");
  p = planHold({ right: sword, left: null }, saberB, 'left');
  ok(p.hand === 'left' && !p.stow.includes('right'), 'a blade to the left beside a right blade keeps both (the dual style)');
}

// --- 4: an old record migrated -----------------------------------------------------------------
{
  const catalogue = new Set(['shirt_s03', 'pants_s01', 'npe_shirt', 'pants_s04']);
  const has = (id: string) => catalogue.has(id);
  const kit: OwnedItem[] = [
    { id: 'npe_shirt', kind: 'wear', got: 5 },
    { id: 'pants_s01', kind: 'wear', got: 5 },
    { id: 'sword_lightsaber_training', kind: 'weapon', got: 5 },
  ];
  const rec: { outfit: string[]; items?: OwnedItem[]; inv?: 1; held?: { right?: string } } = { outfit: ['shirt_s03_m_l0', 'pants_s01', 'hair_human_male_s05', 'trn_boot_m_l0'] };
  const out = migrateInventory(rec, kit, (part) => partToItemId(part, has), 7);
  const ids = out.items!.map((o) => `${o.kind}:${o.id}`);
  ok(ids.includes('wear:shirt_s03') && ids.includes('wear:pants_s01'), 'what it wears becomes owned (a pack part by its item id)');
  ok(ids.includes('wear:npe_shirt') && ids.includes('weapon:sword_lightsaber_training'), 'the kit is given');
  ok(!ids.some((i) => i.includes('hair_')) && !ids.some((i) => i.includes('trn_boot')), 'no hair, no pack part without an item');
  ok(ids.filter((i) => i === 'wear:pants_s01').length === 1, 'duplicates collapse (worn and in the kit)');
  ok(out.inv === 1 && out.held === undefined, 'marked inv 1, held untouched');
  const before = JSON.stringify(out);
  migrateInventory(out, [{ id: 'other', kind: 'wear', got: 9 }], (part) => partToItemId(part, has), 9);
  ok(JSON.stringify(out) === before, 'a second run changes nothing');
  // This used to be `normalizeOwned`'s own rule and is now the migration's: two of one item are two
  // things, so keeping one per kind and id belongs where a character is *brought into* the backpack
  // and nowhere else. The section at the end of this file pins the other half of it.
  const merged = migrateInventory({ outfit: [], items: [{ id: 'a', kind: 'wear', got: 1 }, { id: 'a', kind: 'wear', got: 2 }, { id: 'a', kind: 'weapon', got: 3 }] } as never, [], () => null, 1);
  ok((merged.items ?? []).length === 2, 'a migration keeps one per kind and id, which is what bringing a character in means');
}

// --- 5: the starting kit -----------------------------------------------------------------------
{
  const verdicts: Record<string, Fit> = {
    'wear:npe_shirt': 'hide',
    'wear:shirt_s03': 'block',
    'wear:ith_shirt_s01': 'ok',
    'wear:pants_s04': 'block',
    'wear:pants_s01': 'ok',
    'wear:npe_belt_01': 'hide',
    'wear:robe_jedi_padawan': 'ok',
    'weapon:sword_lightsaber_training': 'ok',
    'weapon:pistol_cdef': 'ok',
    'weapon:carbine_cdef': 'ok',
  };
  const look = (kind: 'wear' | 'weapon', id: string) => verdicts[`${kind}:${id}`] ?? null;
  const jedi = resolveKit('jedi', look, 1);
  const ids = jedi.items.map((o) => o.id);
  ok(ids.includes('ith_shirt_s01') && !ids.includes('npe_shirt'), 'a hide candidate loses to a later ok one (the Ithorian shirt)');
  ok(ids.includes('pants_s01') && !ids.includes('pants_s04'), 'a blocked candidate is skipped for the next');
  ok(ids.includes('npe_belt_01'), 'a hide candidate is taken when no candidate is ok (the belt)');
  ok(!ids.includes('shoes_s02') && !ids.includes('boots_s03'), 'an entry with no candidate present is left out');
  ok(jedi.held.right === 'sword_lightsaber_training' && ids.includes('robe_jedi_padawan'), "the Jedi's weapon lands in held.right");
  const bh = resolveKit('bounty_hunter', look, 1);
  ok(bh.held.right === 'pistol_cdef' && bh.items.some((o) => o.id === 'carbine_cdef') && bh.held.left === undefined, 'the carbine is in the items only');
  const first = resolveKit('jedi', (k, id) => (k === 'wear' && id === 'npe_shirt') || (k === 'wear' && id === 'shirt_s03') ? 'ok' : null, 1);
  ok(first.items.some((o) => o.id === 'npe_shirt') && !first.items.some((o) => o.id === 'shirt_s03'), 'the first ok candidate wins');
}

// --- 6: the species' verdict, pack parts, the off hand -----------------------------------------
{
  const fit = { block: ['wookiee_male', 'ithorian_male'], hide: ['trandoshan_male'] };
  ok(fitFor(fit, 'wookiee_male') === 'block' && fitFor(fit, 'trandoshan_male') === 'hide' && fitFor(fit, 'human_male') === 'ok', 'block and hide read per species');
  ok(fitFor(fit, 'wookiee_male', true) === 'ok' && fitFor({ hide: ['wookiee_male'] }, 'wookiee_male', true) === 'ok', "the species pack's own piece is ok whatever the table says (the Wookiee's shirt and shoes)");
  ok(fitFor(undefined, 'wookiee_male') === 'ok', 'no rule is ok');
  const has = (id: string) => id === 'shirt_s03';
  ok(partToItemId('shirt_s03_m_l0', has) === 'shirt_s03' && partToItemId('shirt_s03', has) === 'shirt_s03', 'partToItemId: shirt_s03_m_l0 is shirt_s03');
  ok(partToItemId('trn_boot_m_l0', has) === null, 'partToItemId: trn_boot_m_l0 has no item');
  const pack = ['shirt_s03_m_l0', 'pants_s01_m_l0', 'trn_boot_m_l0'];
  ok(packPartOf('shirt_s03', pack) === 'shirt_s03_m_l0' && packPartOf('jacket_s02', pack) === null, 'packPartOf is the inverse');
  ok(same([...OFF_HAND_CLASSES].sort(), ['fist', 'knife', 'lightsaber', 'lightsaber2h', 'polearm', 'sword1h', 'sword2h']), 'OFF_HAND_CLASSES is exactly the seven classes');
  ok(speciesWords('wookiee_male', true) === 'Wookiees' && speciesWords('ithorian_female', false) === 'an Ithorian', 'species words');
}

// --- 7: words for slots --------------------------------------------------------------------------
{
  ok(slotWords(['hold_r', 'hold_l']) === 'both hands', '[hold_r, hold_l] reads "both hands"');
  ok(slotWords(JACKET[0]) === 'jacket and both arms', 'the jacket reads "jacket and both arms"');
  ok(slotWords(['chest1']) === 'shirt' && slotWords(['hold_r']) === 'right hand', 'one slot, one word');
}

// --- 8: a repeated id in a wardrobe --------------------------------------------------------------
{
  const item = (name: string, icon: string) => ({ id: 'appearance_invisible_s01', kind: 'wearables', gender: 'm', template: 't', parts: [{ name: 'x', file: 'x.glb', triangles: 1, occlusionLayer: 1 }], name, icon, description: null, slots: [['chest1']] });
  const wardrobe = { species: 'human', gender: 'male', items: [item('First', 'icons/first.png'), item('Second', 'icons/second.png')] };
  const ctx: ItemContext = { wardrobe, wardrobeDir: 'http://x/wardrobe/human_male/', weapons: null, species: 'human_male', packParts: [] };
  const info = itemInfo('wear', 'appearance_invisible_s01', ctx);
  ok(info.name === 'First' && info.icon === 'http://x/wardrobe/human_male/icons/first.png', "a repeated id: the first entry's name and icon");
  ok(wardrobeIndex(wardrobe).size === 1, 'the index holds the id once');
  const missing = itemInfo('wear', 'nothing_here', ctx);
  ok(missing.missing && missing.name === 'Nothing here', 'an item the catalogue lacks is missing, named from its id');
  const packCtx: ItemContext = { ...ctx, species: 'wookiee_male', packParts: ['shirt_s03_m_l0'] };
  const packed = itemInfo('wear', 'shirt_s03', packCtx);
  ok(!packed.missing && packed.packPart === 'shirt_s03_m_l0' && packed.fit === 'ok', "a piece only the species pack carries is not missing, and is the pack's part");
  const weapons = { weapons: [{ id: 'pistol_cdef', template: 't', class: 'pistol', model: 'm', file: 'm.glb', length: 0.3, name: 'CDEF Pistol', description: 'A CDEF pistol.', slots: [['hold_r']], icon: 'icons/m.png' }], iconUrl: (d: { icon?: string | null }) => (d.icon ? `http://x/weapons/${d.icon}` : null) };
  const wctx = { ...ctx, weapons } as unknown as ItemContext;
  const pistol = itemInfo('weapon', 'pistol_cdef', wctx);
  ok(pistol.name === 'CDEF Pistol' && pistol.kindText === 'Pistol' && pistol.icon === 'http://x/weapons/icons/m.png' && !pistol.missing, 'a weapon: the game\'s name, its class and picture');
}

console.log(`${checks} checks passed`);

// ---------------------------------------------------------------- one thing, and not one kind
//
// An item was only ever a kind for a long time -- two of one shirt were one row -- and that is
// exactly why colours, stats and crafting all waited: those are things one **thing** has. A row now
// carries which one it is and its own colours, and a record from before carries neither, so reading
// one forward is the part that matters most.

{
  let n = 0;
  const mint = () => `t${n++}`;
  const rows = normalizeOwned(
    [
      { id: 'shirt_s01', kind: 'wear', got: 5 },
      { id: 'shirt_s01', kind: 'wear', got: 9 },
    ] as OwnedItem[],
    mint,
  );
  ok(rows.length === 2, 'two of one item are two things now, where they used to be one row');
  ok(rows[0].thing !== rows[1].thing, 'and each has a name of its own');
  ok(rows[0].id === rows[1].id, 'while both are still the same item, which is what the catalogue id is for');
  ok(countOf(rows, 'wear', 'shirt_s01') === 2, 'and "have I got one of these" is still a question with an answer');
  ok(thingOf(rows, rows[1].thing!) === rows[1], 'one of them can be named and found');
}

{
  // A record from before instances: every row keeps what it was and gains a name. Such a record was
  // itself deduped by kind and id, so nothing about reading it can change what the character held.
  const old = [
    { id: 'shirt_s01', kind: 'wear', got: 5 },
    { id: 'pistol_cdef', kind: 'weapon', got: 6 },
  ] as OwnedItem[];
  const rows = normalizeOwned(old);
  ok(rows.length === 2 && rows.every((r) => !!r.thing), 'an old record comes forward with a name minted per row');
  ok(rows[0].id === 'shirt_s01' && rows[0].got === 5, 'and nothing else about it changes');
  const again = normalizeOwned(rows);
  ok(again[0].thing === rows[0].thing, 'and reading it a second time keeps the names, so they are stable across a save');
}

{
  const rows = normalizeOwned([{ id: 'a', kind: 'wear', got: 1, thing: 'same' }, { id: 'b', kind: 'wear', got: 2, thing: 'same' }] as OwnedItem[]);
  ok(rows.length === 1, 'two rows claiming to be the same thing are one thing, since a name is what a thing is');
}

{
  const a = mintThing('wear', 'shirt_s01', 1000, () => 0.5);
  const b = mintThing('wear', 'shirt_s01', 1000, () => 0.25);
  ok(a !== b, 'two things got at the same moment still have different names');
  ok(/^w/.test(a) && a.includes('shirt_s01'), "and a name says what it is, which is worth having when reading a record by eye");
}

{
  ok(cleanTint({ 'index_color_1': 12 })!['index_color_1'] === 12, "a thing's own colours are kept by the customizer's own names");
  ok(cleanTint({ 'index_color_1': 300 })!['index_color_1'] === 255, 'a value past the palette is brought back into it');
  ok(cleanTint({ 'index_color_1': -4 })!['index_color_1'] === 0, 'and one below it likewise');
  ok(cleanTint({ 'index_color_1': 2.6 })!['index_color_1'] === 3, 'a fraction is rounded: a palette has no half-colours');
  ok(cleanTint({ __proto__: 1 } as unknown) === undefined, "one of the language's own names is not a colour");
  ok(cleanTint({ a: 'red' } as unknown) === undefined && cleanTint(null) === undefined && cleanTint([1, 2] as unknown) === undefined, 'and nothing that is not a set of numbers is a set of colours');
}

{
  const rows = normalizeOwned([{ id: 'a', kind: 'wear', got: 1, thing: 't1', tint: { 'index_color_1': 7 } }, { id: 'a', kind: 'wear', got: 1, thing: 't2' }] as OwnedItem[]);
  ok(rows[0].tint?.['index_color_1'] === 7 && rows[1].tint === undefined, 'two of one item may be two colours, which is the whole reason a thing has a name');
}