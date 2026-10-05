// The backpack's pure rules (src/core/inventory.ts) and the item facts (src/player/items.ts): which
// arrangement a piece takes and what it displaces, which hand a weapon goes in, bringing an old saved
// character into owned items, the starting kit, the species' verdict with the species packs' own
// pieces, the words for slots, and a repeated id in a wardrobe. Plain node, no game files needed.
import assert from 'node:assert/strict';
import { OFF_HAND_CLASSES, TINT_LEAST, chooseArrangement, cleanTint, collapseOwned, countOf, firstItems, fitFor, garmentMeshesOf, heldThingsOf, lookWithoutGarments, migrateInventory, mintThing, moveTints, normalizeOwned, occupancy, outfitTints, packPartOf, pairOwned, partToItemId, pickedTint, planHold, pruneHeld, pruneThings, resolveKit, sameTint, slotWords, speciesWords, thingOf, tintFromValues, tintValues, wornThingOf, type Fit, type HeldRef, type OwnedItem, type TintVariable } from '../../../src/core/inventory.ts';
import { itemInfo, itemSwatch, wardrobeIndex, type ItemContext } from '../../../src/player/items.ts';
import { characterMark } from '../../../src/net/session.ts';

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
  const long = mintThing('weapon', 'x'.repeat(80), Date.now(), () => 0.999999);
  ok(long.length <= 80 && /^[A-Za-z0-9_.:|-]+$/.test(long), `a name is never past the 80 characters a server takes one to, however long the id (${long.length}): a name refused is no name, and two of an item with none are folded into one`);
  ok(mintThing('wear', 'x'.repeat(46), 1000, () => 0.5) === `w${'x'.repeat(46)}|${(1000).toString(36)}|${Math.floor(0.5 * 0x1000000).toString(36)}`, 'while one for the longest id the packs carry is made as it always was');
}

{
  ok(cleanTint({ 'index_color_1': 12 })!['index_color_1'] === 12, "a thing's own colours are kept by the customizer's own names");
  ok(cleanTint({ 'index_color_1': 300 })!['index_color_1'] === 255, 'a value past the palette is brought back into it');
  ok(cleanTint({ 'index_color_1': -4 })!['index_color_1'] === -4, 'a value below nought is a colour of its own, -(0xRRGGBB + 1), and is kept as it is');
  ok(cleanTint({ 'index_color_1': -(0xffffff + 1) })!['index_color_1'] === TINT_LEAST && cleanTint({ 'index_color_1': -99999999 })!['index_color_1'] === TINT_LEAST, 'white is the lowest a colour goes, and one past it is brought back to white');
  ok(cleanTint({ 'index_color_1': -4 }, 255, 0)!['index_color_1'] === 0, 'and a caller that takes palette indices only can still hold the floor at nought');
  ok(cleanTint({ 'index_color_1': 2.6 })!['index_color_1'] === 3, 'a fraction is rounded: a palette has no half-colours');
  ok(cleanTint({ __proto__: 1 } as unknown) === undefined, "one of the language's own names is not a colour");
  ok(cleanTint({ a: 'red' } as unknown) === undefined && cleanTint(null) === undefined && cleanTint([1, 2] as unknown) === undefined, 'and nothing that is not a set of numbers is a set of colours');
}

{
  const rows = normalizeOwned([{ id: 'a', kind: 'wear', got: 1, thing: 't1', tint: { 'index_color_1': 7 } }, { id: 'a', kind: 'wear', got: 1, thing: 't2' }] as OwnedItem[]);
  ok(rows[0].tint?.['index_color_1'] === 7 && rows[1].tint === undefined, 'two of one item may be two colours, which is the whole reason a thing has a name');
  const timed = normalizeOwned([{ id: 'a', kind: 'wear', got: 1, thing: 't1', tint: { 'index_color_1': 7 }, tintAt: 99 }] as OwnedItem[]);
  ok(timed[0].tintAt === 99, 'and when a colour was set is kept with it, so the newer of two copies of it can win');
}

// ---------------------------------------------------------------- one of each, and which one is worn
//
// The ledger keeps a row per thing now, so a character can really hold two of one shirt. What that
// asks of the rules: the creator and the migration still give one of each, one pure answer says which
// copy is on the body, a server's list is laid over this one without a single name minted, and a
// record from before is collapsed once -- the one place a second copy could have come from.

{
  const a1 = { id: 'shirt', kind: 'wear', got: 1, thing: 'a1' } as OwnedItem;
  const a2 = { id: 'shirt', kind: 'wear', got: 2, thing: 'a2' } as OwnedItem;
  const b1 = { id: 'shirt', kind: 'weapon', got: 3, thing: 'b1' } as OwnedItem;
  const once = firstItems([a1, a2, b1]);
  ok(once.length === 2 && once[0] === a1 && once[1] === b1, 'firstItems keeps one of each kind and id, the first given');
  ok(wornThingOf([a2, a1], 'wear', 'shirt', null) === 'a1', 'with no choice, the copy worn is the oldest');
  ok(wornThingOf([a1, a2], 'wear', 'shirt', { shirt: 'a2' }) === 'a2', 'with one, it is the one chosen');
  ok(wornThingOf([a1], 'wear', 'shirt', { shirt: 'a2' }) === 'a1', 'and a choice naming a copy no longer owned falls back to the oldest');
  ok(wornThingOf([a1, a2], 'weapon', 'shirt', null) === null && wornThingOf([], 'wear', 'shirt', null) === null, 'none owned is none');
  const tie = [{ ...a2, got: 1 }, a1] as OwnedItem[];
  ok(wornThingOf(tie, 'wear', 'shirt', null) === 'a2', 'and two got in the same moment go by the order of the list');
  const ctor = { id: 'constructor', kind: 'wear', got: 1, thing: 'c1' } as OwnedItem;
  ok(wornThingOf([ctor], 'wear', 'constructor', {}) === 'c1', "a choice map is read by its own keys, never by the language's own names on every object");
}

{
  const items = [
    { id: 'shirt', kind: 'wear', got: 1, thing: 'a1' },
    { id: 'shirt', kind: 'wear', got: 2, thing: 'a2' },
    { id: 'hat', kind: 'wear', got: 3, thing: 'h1' },
  ] as OwnedItem[];
  const kept = pruneThings({ shirt: 'a2', hat: 'h1', boots: 'x' }, items, 'wear', new Set(['shirt', 'hat']));
  ok(same(kept, { shirt: 'a2' }), `the choice is kept while the piece is on and the copy owned, and the oldest needs no line (${JSON.stringify(kept)})`);
  ok(pruneThings({ shirt: 'a2' }, items, 'wear', new Set()) === undefined, 'a piece taken off takes its choice with it');
  ok(pruneThings({ shirt: 'gone' }, items, 'wear', new Set(['shirt'])) === undefined, 'and a choice naming a copy that has gone is dropped');
  ok(pruneThings(undefined, items, 'wear', new Set(['shirt'])) === undefined, 'nothing chosen is nothing');
}

{
  // The creator's duplicate: a kit shirt worn in the creator was given twice, and before things had
  // names nothing else could have given a character two of one item. Collapsed once, keeping the copy
  // on the body.
  const rec = {
    items: [
      { id: 'npe_shirt', kind: 'wear', got: 1, thing: 's1' },
      { id: 'npe_shirt', kind: 'wear', got: 2, thing: 's2' },
      { id: 'pistol', kind: 'weapon', got: 3, thing: 'p1' },
      { id: 'pistol', kind: 'weapon', got: 4, thing: 'p2' },
      { id: 'hat', kind: 'wear', got: 5, thing: 'h1' },
    ] as OwnedItem[],
    held: { right: 'pistol' },
    heldThings: { right: 'p2' },
  } as { items: OwnedItem[]; named?: 1; held?: { right?: string; left?: string }; heldThings?: { right?: string; left?: string } };
  collapseOwned(rec);
  ok(rec.named === 1, 'the record is marked, so the collapse runs once');
  ok(same(rec.items.map((o) => o.thing), ['s1', 'p2', 'h1']), `one of each is kept, and of a held weapon the copy in the hand (${rec.items.map((o) => o.thing).join(',')})`);
  rec.items.push({ id: 'hat', kind: 'wear', got: 6, thing: 'h2' });
  collapseOwned(rec);
  ok(rec.items.length === 4, 'and a record already marked keeps two of one item: from here on that is two things, not a mistake');
  const old = collapseOwned({ items: [{ id: 'a', kind: 'wear', got: 1 }, { id: 'a', kind: 'wear', got: 1 }] as OwnedItem[] } as { items: OwnedItem[]; named?: 1 });
  ok(old.items.length === 1 && !!old.items[0].thing, 'a record from before names had none, and comes out with one of each, named');
}

{
  // A list from a server laid over this browser's. The names are the thing: a server that names
  // its things is paired by name first and nothing is minted, and a name the server gave a thing this
  // browser named otherwise is taken, the colour on it kept.
  const had = [
    { id: 'shirt', kind: 'wear', got: 10, thing: 'w-local-1', tint: { index_color_1: 4 } },
    { id: 'shirt', kind: 'wear', got: 20, thing: 'w-local-2' },
    { id: 'hat', kind: 'wear', got: 30, thing: 'h-same' },
    { id: 'boots', kind: 'wear', got: 40, thing: 'b-gone' },
  ] as OwnedItem[];
  const server = [
    { id: 'hat', kind: 'wear' as const, got: 30, thing: 'h-same' },
    { id: 'shirt', kind: 'wear' as const, got: 11, thing: '0.i7' },
    { id: 'shirt', kind: 'wear' as const, got: 21, thing: '0.i8' },
    { id: 'pistol', kind: 'weapon' as const, got: 50, thing: '0.i9', tint: { index_color_1: 2 }, tintAt: 5 },
  ];
  let minted = 0;
  const r = pairOwned(had, server, () => `m${minted++}`);
  ok(minted === 0, 'not one name is minted for a server that names its things');
  ok(r.items.length === 4 && r.came === 1 && r.gone.length === 1 && r.gone[0].thing === 'b-gone', `what came and what went are counted thing by thing (${r.came} came, ${r.gone.length} went)`);
  ok(r.renamed.get('w-local-1') === '0.i7' && r.renamed.get('w-local-2') === '0.i8', 'the two shirts are paired oldest with oldest and take the server’s names');
  const shirt = r.items.find((o) => o.thing === '0.i7')!;
  ok(shirt.tint?.index_color_1 === 4, 'and the colour on the first shirt stays on the first shirt');
  ok(r.items.find((o) => o.thing === 'h-same')?.got === 30, 'a thing of the same name is the same thing');
  ok(r.items.find((o) => o.thing === '0.i9')?.tint?.index_color_1 === 2, 'a thing that came carries the colour the server holds for it');
  const again = pairOwned(r.items, server, () => `m${minted++}`);
  ok(again.came === 0 && again.gone.length === 0 && again.renamed.size === 0 && minted === 0, 'the same list again changes nothing and renames nothing');
  // The colours by when they were set: the server's when it is as new, this browser's when newer.
  const newer = pairOwned([{ id: 'hat', kind: 'wear', got: 1, thing: 'h', tint: { index_color_1: 9 }, tintAt: 50 }] as OwnedItem[], [{ id: 'hat', kind: 'wear', got: 1, thing: 'h', tint: { index_color_1: 1 }, tintAt: 40 }]);
  ok(newer.items[0].tint?.index_color_1 === 9, 'a colour set here later than the server’s stays');
  const older = pairOwned([{ id: 'hat', kind: 'wear', got: 1, thing: 'h', tint: { index_color_1: 9 }, tintAt: 30 }] as OwnedItem[], [{ id: 'hat', kind: 'wear', got: 1, thing: 'h', tint: null, tintAt: 40 }]);
  ok(older.items[0].tint === undefined && older.items[0].tintAt === 40, 'and one the server took off since is off here too, with when');
  // A colour stamped here by a clock running fast, while no server answered, is held to the server's clock
  // as the list arrives: it still wins against what the server held before it, and only that.
  const fast = pairOwned([{ id: 'hat', kind: 'wear', got: 1, thing: 'h', tint: { index_color_1: 9 }, tintAt: 5_000_000 }] as OwnedItem[], [{ id: 'hat', kind: 'wear', got: 1, thing: 'h', tint: { index_color_1: 1 }, tintAt: 900 }], undefined, 1000);
  ok(fast.items[0].tint?.index_color_1 === 9 && fast.items[0].tintAt === 1000, 'a colour stamped here by a clock running fast beats what the server held before it, and is kept as set when the list came');
  const after = pairOwned(fast.items, [{ id: 'hat', kind: 'wear', got: 1, thing: 'h', tint: { index_color_1: 3 }, tintAt: 1500 }], undefined, 2000);
  ok(after.items[0].tint?.index_color_1 === 3 && after.items[0].tintAt === 1500, 'so a colour the server takes after it wins in its turn, which it could not have done for as long as the clock was ahead');
  const unclocked = pairOwned([{ id: 'hat', kind: 'wear', got: 1, thing: 'h', tint: { index_color_1: 9 }, tintAt: 5_000_000 }] as OwnedItem[], [{ id: 'hat', kind: 'wear', got: 1, thing: 'h' }]);
  ok(unclocked.items[0].tintAt === 5_000_000, 'with no server clock handed in a time is kept as it was');
  // A server from before names: its rows name nothing, so the pairing is by what each is, and the
  // names this browser already has are kept rather than minted again on every list.
  const plain = pairOwned(had.slice(0, 3), [{ id: 'shirt', kind: 'wear', got: 5 }, { id: 'hat', kind: 'wear', got: 30 }], () => `m${minted++}`);
  ok(plain.items.map((o) => o.thing).join(',') === 'w-local-1,h-same' && minted === 0, 'a server from before names keeps the names already here, the oldest shirt with its one row');
  ok(plain.gone.length === 1 && plain.gone[0].thing === 'w-local-2', 'and a second shirt it never held is not one it holds');
}

// ---------------------------------------------------------------- a colour is a thing's, and a hand holds a thing
//
// A garment's colour moved off the look and onto the thing it colours, by bare variable name, so a shirt
// keeps it when it is taken off, traded or worn by another gender; putting on a copy writes every variable
// the piece reads, its own colour or the recipe's default. And two copies of one hilt are two things, held
// one in each hand.

{
  // The shirt's two meshes as the customizer lists them: the full spelling of each key, the defaults the
  // recipes carry, a shared skin variable on the same mesh (the body's, never a thing's) and a texture choice.
  const defs = (g: 'm' | 'f'): TintVariable[] => [
    { key: `shirt_${g}_l0|/private/index_color_1`, name: '/private/index_color_1', private: true, default: 11, kind: 'palette' },
    { key: `shirt_${g}_l0|/private/index_color_2`, name: '/private/index_color_2', private: true, default: 4, kind: 'palette' },
    { key: `shirt_${g}_l0|/private/index_texture_1`, name: '/private/index_texture_1', private: true, default: 0, kind: 'index' },
    { key: '/shared_owner/index_color_skin', name: '/shared_owner/index_color_skin', private: false, default: 2, kind: 'palette' },
    { key: `cuff_${g}_l0|/private/index_color_1`, name: '/private/index_color_1', private: true, default: 11, kind: 'palette' },
  ];
  const v = tintValues({ index_color_1: 30 }, defs('m'));
  ok(v['shirt_m_l0|/private/index_color_1'] === 30 && v['cuff_m_l0|/private/index_color_1'] === 30, 'a thing\'s colour reaches every mesh of the piece that reads it');
  ok(v['shirt_m_l0|/private/index_color_2'] === 4 && v['shirt_m_l0|/private/index_texture_1'] === 0, 'and every variable it does not set is written at the recipe\'s default, so an undyed copy really puts the piece back');
  ok(!('/shared_owner/index_color_skin' in v), 'a shared variable is the body\'s and never a thing\'s');
  ok(Object.keys(tintValues(undefined, defs('m'))).length === 4 && Object.values(tintValues(null, defs('m'))).join() === '11,4,0,11', 'a thing with no colour at all writes the defaults, every one of them');
  ok(tintValues({ index_texture_1: -5000 }, defs('m'))['shirt_m_l0|/private/index_texture_1'] === 0, 'a colour carried whole never lands on a texture choice');
  ok(tintValues({ index_color_2: -1 }, defs('m'))['shirt_m_l0|/private/index_color_2'] === -1, 'while a palette takes it as itself');
  // The same shirt worn by a woman: other meshes, the same bare names, the same colour.
  const female = tintValues({ index_color_1: 30, index_color_2: 7 }, defs('f'));
  ok(female['shirt_f_l0|/private/index_color_1'] === 30 && female['shirt_f_l0|/private/index_color_2'] === 7, 'a tint kept by bare name colours the other gender\'s meshes the same, so a shirt traded between them keeps its colour');
}

{
  // A piece's colours read back as a tint: the full spelling wins over the short, the first mesh over a later one.
  const values = { 'shirt_m_l0|index_color_1': 3, 'shirt_m_l0|/private/index_color_1': 9, 'cuff_m_l0|/private/index_color_1': 12, 'cuff_m_l0|/private/index_color_dye': -200, 'hum_m_head_l0|/private/index_color_2': 5, index_color_skin: 1 };
  const t = tintFromValues(values, ['shirt_m_l0', 'cuff_m_l0']);
  ok(same(t, { index_color_1: 9, index_color_dye: -200 }), `the values held under a piece's meshes are its tint by bare name, the full spelling first (${JSON.stringify(t)})`);
  ok(tintFromValues(values, ['boots_m_l0']) === undefined, 'a piece with nothing held has no tint');
  ok(sameTint(undefined, null) && sameTint({ a: 1 }, { a: 1 }) && !sameTint({ a: 1 }, { a: 2 }) && !sameTint({ a: 1 }, null), 'two colour sets alike: none and null are one answer');
}

{
  // The one move of a record's garment colours onto its things. Two shirts, the second worn; a hat with
  // nothing coloured; the body's own colours and the hair's, which stay in the look.
  const rec = {
    appearance: {
      morphs: {},
      height: 0.5,
      values: {
        index_color_skin: 4,
        'hum_m_head_l0|/private/index_color_2': 6,
        'hair_human_male_s01|/private/index_color_1': 2,
        'hair|index_color_1': 2,
        'shirt_s03_m_l0|/private/index_color_1': 33,
        'shirt_s03_m_l0|/private/index_color_dye': -1000,
        'jacket_s02_m_l0|/private/index_color_1': 7,
      } as Record<string, number>,
    },
    items: [
      { id: 'shirt_s03', kind: 'wear', got: 1, thing: 's1' },
      { id: 'shirt_s03', kind: 'wear', got: 2, thing: 's2' },
      { id: 'hat_s04', kind: 'wear', got: 3, thing: 'h1' },
      { id: 'pistol', kind: 'weapon', got: 4, thing: 'p1' },
    ] as OwnedItem[],
    wornThings: { shirt_s03: 's2' },
  } as { appearance: { morphs: Record<string, number>; height: number; values: Record<string, number> }; items: OwnedItem[]; wornThings: Record<string, string>; tints?: 1 };
  const meshes: Record<string, string[]> = { shirt_s03: ['shirt_s03_m_l0'], hat_s04: ['hat_s04_m_l0'] };
  const shirtDefs: TintVariable[] = [
    { key: 'shirt_s03_m_l0|/private/index_color_1', name: '/private/index_color_1', private: true, default: 11 },
    { key: 'shirt_s03_m_l0|/private/index_color_dye', name: '/private/index_color_dye', private: true, default: 0 },
  ];
  const before = Object.fromEntries(shirtDefs.map((d) => [d.key, rec.appearance.values[d.key] ?? d.default]));
  const moved = moveTints(rec, (id) => meshes[id] ?? []);
  ok(moved === 1 && rec.tints === 1, `one thing took a colour and the record is marked (${moved})`);
  ok(same(thingOf(rec.items, 's2')?.tint, { index_color_1: 33, index_color_dye: -1000 }) && !thingOf(rec.items, 's1')?.tint, 'the colours went onto the copy worn, by bare name, and the other copy has none');
  const after = tintValues(thingOf(rec.items, 's2')?.tint, shirtDefs);
  ok(same(after, before), `and drawn from the thing the shirt is exactly the colour it was (${JSON.stringify(after)})`);
  ok(same(Object.keys(rec.appearance.values).sort(), ['hair_human_male_s01|/private/index_color_1', 'hair|index_color_1', 'hum_m_head_l0|/private/index_color_2', 'index_color_skin', 'jacket_s02_m_l0|/private/index_color_1']), 'exactly the owned piece\'s keys left the look: the body\'s, the hair\'s, and a piece not owned stay');
  const again = moveTints(rec, () => ['jacket_s02_m_l0']);
  ok(again === 0 && 'jacket_s02_m_l0|/private/index_color_1' in rec.appearance.values, 'a record already moved is left alone');
  // An old record with only one copy, never chosen: the oldest takes it.
  const lone = { appearance: { values: { 'shirt_s03_m_l0|index_color_1': 5 } as Record<string, number> }, items: [{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 'a' }] as OwnedItem[] } as { appearance: { values: Record<string, number> }; items: OwnedItem[]; tints?: 1 };
  moveTints(lone, () => ['shirt_s03_m_l0']);
  ok(thingOf(lone.items, 'a')?.tint?.index_color_1 === 5 && Object.keys(lone.appearance.values).length === 0, 'a lone copy takes its colour, short spelling and all');
  // A colour the thing already carries is kept over the look's, and the look's other names are added.
  const both = { appearance: { values: { 'shirt_s03_m_l0|/private/index_color_1': 5, 'shirt_s03_m_l0|/private/index_color_dye': -77 } as Record<string, number> }, items: [{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 'a', tint: { index_color_1: 9 } }] as OwnedItem[] } as { appearance: { values: Record<string, number> }; items: OwnedItem[]; tints?: 1 };
  moveTints(both, () => ['shirt_s03_m_l0']);
  ok(same(thingOf(both.items, 'a')?.tint, { index_color_1: 9, index_color_dye: -77 }), `a colour the thing already carries wins over the look's, and the look's other colours join it (${JSON.stringify(thingOf(both.items, 'a')?.tint)})`);
}

{
  // A Wookiee's record: the fur is the body's shared `index_color_1`, and the shirt's own `index_color_1` is a
  // copy of it (the customizer's link by name), so it is the body's and never the thing's. And the old look
  // held the colours of a jacket long since given away, which must not wait there for the next jacket.
  const rec = {
    appearance: {
      values: {
        index_color_1: 5,
        'wke_m_body_l0|/private/index_color_2': 1,
        'hair|index_color_1': 3,
        'shirt_s03_m_l0|/private/index_color_1': 5,
        'shirt_s03_m_l0|/private/index_color_dye': -300,
        'jacket_s02_m_l0|/private/index_color_2': 8,
        'jacket_s02_m_l0|/private/index_color_dye': -9,
      } as Record<string, number>,
    },
    items: [{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 's1' }] as OwnedItem[],
  } as { appearance: { values: Record<string, number> }; items: OwnedItem[]; tints?: 1 };
  const follows = (k: string) => k.endsWith('|/private/index_color_1');
  const garments = new Set(['shirt_s03_m_l0', 'jacket_s02_m_l0', 'pants_s01_m_l0']);
  moveTints(rec, () => ['shirt_s03_m_l0'], { follows, garment: (m) => garments.has(m) });
  ok(same(thingOf(rec.items, 's1')?.tint, { index_color_dye: -300 }), `the shirt's own colour goes on the thing, and its copy of the fur does not (${JSON.stringify(thingOf(rec.items, 's1')?.tint)})`);
  ok(same(Object.keys(rec.appearance.values).sort(), ['hair|index_color_1', 'index_color_1', 'wke_m_body_l0|/private/index_color_2']), `and every garment's key leaves the look, the copy of the fur and a jacket not owned among them, while the body's and the hair's stay (${Object.keys(rec.appearance.values).join(', ')})`);
  // Drawn, the copy of the fur takes the fur, never the thing's colour and never its own default.
  const defs: TintVariable[] = [
    { key: 'shirt_s03_m_l0|/private/index_color_1', name: '/private/index_color_1', private: true, default: 11, kind: 'palette' },
    { key: 'shirt_s03_m_l0|/private/index_color_dye', name: '/private/index_color_dye', private: true, default: 0, kind: 'palette' },
  ];
  const drawn = tintValues({ index_color_1: 2, index_color_dye: -300 }, defs, (k) => (follows(k) ? 5 : undefined));
  ok(drawn['shirt_s03_m_l0|/private/index_color_1'] === 5 && drawn['shirt_s03_m_l0|/private/index_color_dye'] === -300, 'drawn, a copy of a body colour is at the body\'s colour whatever the thing carries under that name, and the rest is the thing\'s');
  ok(tintValues(undefined, defs, () => undefined)['shirt_s03_m_l0|/private/index_color_1'] === 11, 'and with nothing followed it is the piece\'s own, as before');
  ok(same(tintFromValues({ 'shirt_s03_m_l0|/private/index_color_1': 5, 'shirt_s03_m_l0|/private/index_color_dye': 4 }, ['shirt_s03_m_l0'], follows), { index_color_dye: 4 }), 'read back as a tint, a copy of a body colour is passed over');
}

{
  // The look a record keeps, the garments' meshes, the creator's colours onto its things, and a pick's default.
  const values = { index_color_skin: 2, 'hum_m_head_l0|/private/index_color_2': 6, 'hair|index_color_1': 1, 'hair_human_male_s01|/private/index_color_1': 1, 'shirt_s03_m_l0|/private/index_color_1': 4, 'robe_s32_m_l0|/private/index_color_dye': -5 };
  const garments = garmentMeshesOf(
    {
      items: [
        { id: 'robe_s32', kind: 'wearables', parts: [{ name: 'robe_s32_m_l0' }] },
        { id: 'hair_human_male_s01', kind: 'hair', parts: [{ name: 'hair_human_male_s01' }] },
        { id: 'sul_hair_s01_m', kind: 'wearables', parts: [{ name: 'sul_hair_s01_m' }] },
      ],
    },
    ['shirt_s03_m_l0'],
  );
  ok(garments.has('robe_s32_m_l0') && garments.has('shirt_s03_m_l0') && !garments.has('hair_human_male_s01') && !garments.has('sul_hair_s01_m'), 'a garment\'s meshes are the wardrobe\'s and the pack\'s own pieces, never a hairstyle\'s however its id is spelt');
  const kept = lookWithoutGarments(values, garments);
  ok(same(Object.keys(kept).sort(), ['hair_human_male_s01|/private/index_color_1', 'hair|index_color_1', 'hum_m_head_l0|/private/index_color_2', 'index_color_skin']), `a record's look keeps the body's and the hair's and none of a garment's, loaded or not (${Object.keys(kept).join(', ')})`);
  ok('shirt_s03_m_l0|/private/index_color_1' in values, 'and the values handed in are not touched');
  // The creator: a shirt and a robe worn, the shirt's copy of a body colour left out, the hair never an item.
  const items = [
    { id: 'shirt_s03', kind: 'wear', got: 1, thing: 's1' },
    { id: 'robe_s32', kind: 'wear', got: 2, thing: 'r1' },
  ] as OwnedItem[];
  const made = outfitTints(items, ['shirt_s03_m_l0', 'robe_s32', 'hair_human_male_s01'], { ...values, 'shirt_s03_m_l0|/private/index_color_2': 3 }, (p) => (p === 'shirt_s03_m_l0' ? 'shirt_s03' : p === 'robe_s32' ? 'robe_s32' : null), (p) => [p === 'robe_s32' ? 'robe_s32_m_l0' : p], 777, (k) => k.endsWith('index_color_1'));
  ok(made === 2 && same(thingOf(items, 's1')?.tint, { index_color_2: 3 }) && thingOf(items, 's1')?.tintAt === 777 && same(thingOf(items, 'r1')?.tint, { index_color_dye: -5 }), `the creator's colours go on the new character's things, stamped, a copy of a body colour left on the body (${JSON.stringify(items)})`);
  // A pick on a piece whose two meshes rest at different defaults (a dress's bodice and skirt).
  ok(pickedTint(245, [245, 44]) === 245 && pickedTint(44, [245, 44]) === 44, 'a value that is one mesh\'s default and not the other\'s is the thing\'s own colour');
  ok(pickedTint(11, [11, 11]) === null && pickedTint(3, [11]) === 3, 'and only the default of every mesh is no colour at all');
}

{
  // Which recipe meshes a worn part is drawn with, and which are a garment's, as the character asks them.
  const { pieceMeshes, garmentMeshesOn } = await import('../../../src/player/pieceMeshes.ts');
  ok(same(pieceMeshes([{ name: 'robe_s32_m_l0_1' }, { name: 'robe_s32_m_l0_2' }, { name: 'belt_m_l0' }], 'robe_s32_m_l0', [{ name: 'x' }]), ['robe_s32_m_l0', 'belt_m_l0']), 'a loaded part is its recipe meshes, the loader\'s `_<n>` taken off, each once');
  ok(same(pieceMeshes(null, 'shirt_s03_m_l0', [{ name: 'shirt_s03_m_l0' }]), ['shirt_s03_m_l0']) && same(pieceMeshes(undefined, null, [{ name: 'a_m_l0' }, { name: 'b_m_l0' }]), ['a_m_l0', 'b_m_l0']) && pieceMeshes(null, null, null).length === 0, 'not loaded, it is the pack\'s own part, else the catalogue item\'s parts, else nothing');
  const on = garmentMeshesOn(
    [
      { body: true, hair: false, meshes: [{ name: 'hum_m_body_l0' }] },
      { body: false, hair: true, meshes: [{ name: 'hair_human_male_s01' }] },
      { body: false, hair: false, meshes: [{ name: 'jacket_s02_m_l0_1' }] },
    ],
    new Set(['robe_s32_m_l0']),
  );
  ok(on.has('jacket_s02_m_l0') && on.has('jacket_s02_m_l0_1') && on.has('robe_s32_m_l0') && !on.has('hum_m_body_l0') && !on.has('hair_human_male_s01'), 'the garments on a character are its loaded pieces under both spellings and every garment it could put on, never the body or the hair');
}

{
  // The character's mark: unchanged for a character with no colour anywhere, a change for a colour set,
  // and blind to the names of things, which a server's list may change.
  const base = { name: 'Han', outfit: ['shirt_s03'], items: [{ kind: 'wear', id: 'shirt_s03', thing: 'a' }], held: {} };
  const plain = characterMark(base);
  ok(plain === characterMark({ ...base, items: [{ kind: 'wear', id: 'shirt_s03' }] }) && plain === characterMark({ ...base, items: [{ kind: 'wear', id: 'shirt_s03', tint: null }] }), 'with no colour on any thing the mark is the one it always was');
  const dyed = characterMark({ ...base, items: [{ kind: 'wear', id: 'shirt_s03', tint: { index_color_1: 3 } }] });
  ok(dyed !== plain, 'a colour on a thing is a change of the character');
  ok(dyed === characterMark({ ...base, items: [{ kind: 'wear', id: 'shirt_s03', thing: 'renamed', tint: { index_color_1: 3 } }] }), 'and the thing\'s name is no part of it');
  ok(dyed !== characterMark({ ...base, items: [{ kind: 'wear', id: 'shirt_s03', tint: { index_color_1: 4 } }] }), 'while another colour is another mark');
}

{
  // Newest wins both ways: what this browser kept over the server's goes back up.
  const local = [
    { id: 'shirt', kind: 'wear', got: 1, thing: 'n', tint: { index_color_1: 9 }, tintAt: 500 },
    { id: 'shirt', kind: 'wear', got: 2, thing: 'o', tint: { index_color_1: 2 }, tintAt: 100 },
    { id: 'hat', kind: 'wear', got: 3, thing: 'm', tint: { index_color_1: 6 } },
    { id: 'boots', kind: 'wear', got: 4, thing: 'c', tintAt: 700 },
    { id: 'belt', kind: 'wear', got: 5, thing: 'e', tint: { index_color_1: 1 }, tintAt: 300 },
  ] as OwnedItem[];
  const server = [
    { id: 'shirt', kind: 'wear' as const, got: 1, thing: 'n', tint: { index_color_1: 1 }, tintAt: 400 },
    { id: 'shirt', kind: 'wear' as const, got: 2, thing: 'o', tint: { index_color_1: 5 }, tintAt: 200 },
    { id: 'hat', kind: 'wear' as const, got: 3, thing: 'm' },
    { id: 'boots', kind: 'wear' as const, got: 4, thing: 'c', tint: { index_color_1: 8 }, tintAt: 600 },
    { id: 'belt', kind: 'wear' as const, got: 5, thing: 'e', tint: { index_color_1: 1 }, tintAt: 200 },
  ];
  const r = pairOwned(local, server);
  ok(r.items.find((o) => o.thing === 'n')?.tint?.index_color_1 === 9 && r.items.find((o) => o.thing === 'o')?.tint?.index_color_1 === 5, 'a colour set here later than the server\'s stays; one set earlier is replaced by the server\'s');
  ok(same([...r.resend].sort(), ['c', 'm', 'n']), `and what is kept over the server's and differs from it goes back up: the newer colour, one the server never had, one taken off since (${r.resend.join(',')})`);
  ok(r.items.find((o) => o.thing === 'c')?.tint === undefined && r.items.find((o) => o.thing === 'c')?.tintAt === 700, 'a colour taken off here after the server\'s stays off');
  ok(!r.resend.includes('e'), 'and the same colour on both sides is not said again');
}

{
  // Two copies of one hilt: two things, one in each hand. One copy still cannot be in both.
  const a1: HeldRef = { id: 'saber', cls: 'lightsaber', slots: HOLD_BOTH, thing: 'a1' };
  const a2: HeldRef = { id: 'saber', cls: 'lightsaber', slots: HOLD_BOTH, thing: 'a2' };
  let p = planHold({ right: a1, left: null }, a2, 'left');
  ok(p.hand === 'left' && p.stow.length === 0, 'the second copy of a hilt goes in the left hand beside the first');
  p = planHold({ right: a1, left: null }, a1, 'left');
  ok(p.hand === 'left' && same(p.stow, ['right']), 'the very same copy asked for the left moves across and empties the right');
  p = planHold({ right: null, left: a2 }, a1, 'right');
  ok(p.hand === 'right' && p.stow.length === 0, 'and the right takes the first beside a second in the left');
  const nameless: HeldRef = { id: 'saber', cls: 'lightsaber', slots: HOLD_BOTH };
  p = planHold({ right: nameless, left: null }, a2, 'left');
  ok(same(p.stow, ['right']), 'a weapon in hand nobody owns is still told by its id');
  const gun1: HeldRef = { id: 'pistol', cls: 'pistol', slots: HOLD_R, thing: 'g1' };
  const gun2: HeldRef = { id: 'pistol', cls: 'pistol', slots: HOLD_R, thing: 'g2' };
  p = planHold({ right: gun1, left: null }, gun2, 'left');
  ok(p.hand === 'right' && same(p.stow, ['right']), 'a second pistol has no off hand to go to: it takes the right');

  const items = [
    { id: 'saber', kind: 'weapon', got: 1, thing: 'a1' },
    { id: 'saber', kind: 'weapon', got: 2, thing: 'a2' },
    { id: 'saber', kind: 'weapon', got: 3, thing: 'a3' },
    { id: 'baton', kind: 'weapon', got: 4, thing: 'b1' },
  ] as OwnedItem[];
  const both = { right: 'saber', left: 'saber' };
  ok(same(heldThingsOf(items, both, null), { right: 'a1', left: 'a2' }), 'both hands holding one hilt, with no choice: the oldest in the right and the next in the left');
  ok(same(heldThingsOf(items, both, { left: 'a1' }), { right: 'a2', left: 'a1' }), 'a choice for the left alone: the right takes the oldest the left does not hold');
  ok(same(heldThingsOf(items, both, { right: 'a3', left: 'a3' }), { right: 'a3', left: 'a1' }), 'one thing named for both hands is the right\'s');
  ok(same(heldThingsOf(items.slice(0, 1), both, null), { right: 'a1', left: null }), 'one copy held twice over leaves the left with none');
  ok(same(heldThingsOf(items, { right: 'baton' }, { saber: 'a2' } as never), { right: 'b1', left: null }), 'a choice map of the shape before (catalogue id to thing) names no hand');
  ok(pruneHeld({ right: 'a1', left: 'a2' }, items, both) === undefined, 'the rule\'s own answer needs no line in the record');
  ok(same(pruneHeld({ right: 'a3' }, items, both), { right: 'a3' }), 'a choice the rule would not make is kept');
  ok(same(pruneHeld({ right: 'a1', left: 'a3' }, items, both), { left: 'a3' }) && pruneHeld({ left: 'a3' }, items, { right: 'saber' }) === undefined, 'and only for a hand that holds it');
  ok(pruneHeld({ right: 'gone' }, items, both) === undefined, 'a thing no longer owned is let go of');
}

{
  // The backpack's swatch: a colour carried whole as itself, an index by the catalogue's palette, our dye's
  // index as no colour at all.
  const wardrobe = { species: 'human', gender: 'male', items: [{ id: 'shirt', kind: 'wearables', gender: 'm', template: 't', parts: [], variables: [{ name: 'index_color_1', private: true, kind: 'palette' as const, colors: [[10, 20, 30], [200, 100, 50]] }, { name: 'index_texture_1', private: true, kind: 'index' as const }] }] };
  const ctx = { wardrobe, wardrobeDir: '', weapons: null, species: 'human_male', packParts: [] } as unknown as ItemContext;
  ok(itemSwatch('wear', 'shirt', { index_color_1: 1 }, ctx) === '#c86432', 'an index is its palette\'s colour');
  ok(itemSwatch('wear', 'shirt', { index_color_dye: -(0x123456 + 1) }, ctx) === '#123456', 'a colour carried whole is itself');
  ok(itemSwatch('wear', 'shirt', { index_color_dye: 0 }, ctx) === null && itemSwatch('wear', 'shirt', { index_texture_1: 1 }, ctx) === null, 'our dye undyed and a texture choice show nothing');
  ok(itemSwatch('wear', 'shirt', { index_color_dye: -1, index_color_1: 0 }, ctx) === '#0a141e', 'the game\'s own colour comes first');
  ok(itemSwatch('weapon', 'saber', { index_color_1: 1 }, ctx) === null && itemSwatch('wear', 'shirt', undefined, ctx) === null, 'a weapon and a thing with no colour show none');
}

// The converted wardrobes, when they are here: a tint by bare name colours the same piece the same way on
// the other gender's meshes, which is what lets a shirt traded between a man and a woman keep its colour.
{
  const { existsSync, readFileSync } = await import('node:fs');
  const { Customizer } = await import('../../../src/player/customizer.ts');
  const root = new URL('../../../assets-private/wardrobe/', import.meta.url);
  const at = (f: string) => new URL(`${f}/`, root);
  if (!existsSync(new URL('wardrobe.json', at('human_male'))) || !existsSync(new URL('wardrobe.json', at('human_female')))) {
    console.log('     the human wardrobes are not converted here: the gender check over real pieces was skipped');
  } else {
    // The game's own customizer, fed each wardrobe's own customize.json through a stand-in for `fetch`, so the
    // variables a piece is coloured by are the ones `Customizer.variablesOn` lists in play, keys and all.
    const realFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      const m = /^test:\/\/wardrobe\/([a-z_]+)\/customize\.json$/.exec(url);
      return m ? new Response(readFileSync(new URL('customize.json', at(m[1]))), { headers: { 'content-type': 'application/json' } }) : new Response('', { status: 404 });
    };
    type Pack = { w: { items: { id: string; kind: string; parts: { name: string }[] }[] }; cz: InstanceType<typeof Customizer> };
    const load = async (f: string): Promise<Pack> => {
      const cz = new Customizer();
      ok(await cz.addSource(`test://wardrobe/${f}/`), `the ${f} wardrobe's recipes join a customizer as they do in play`);
      return { w: JSON.parse(readFileSync(new URL('wardrobe.json', at(f)), 'utf8')), cz };
    };
    const male = await load('human_male');
    const female = await load('human_female');
    (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    const defsOf = (p: Pack, item: { parts: { name: string }[] }): TintVariable[] => p.cz.variablesOn(new Set(item.parts.map((x) => x.name)));
    {
      // `variablesOn` keys a mesh's own colour exactly as the values the customizer holds and a render reads.
      const shirt = male.w.items.find((i) => i.id === 'shirt_s03') ?? male.w.items.find((i) => i.parts.length && i.kind !== 'hair')!;
      const vars = defsOf(male, shirt);
      ok(vars.length > 0 && vars.every((d) => !d.private || d.key === `${(d as { mesh?: string }).mesh}|${d.name}`) && new Set(vars.map((d) => d.key)).size === vars.length, `a piece's variables are listed once a key, a private one under its mesh (${shirt.id}: ${vars.map((d) => d.key).join(', ')})`);
    }
    const her = new Map(female.w.items.map((i) => [i.id, i]));
    let both = 0;
    let kept = 0;
    for (const it of male.w.items) {
      const f = her.get(it.id);
      if (it.kind === 'hair' || !f || !it.parts.length || !f.parts.length) continue;
      both++;
      // A colour for every variable the piece reads on him, read back off her meshes.
      const tint: Record<string, number> = {};
      for (const d of defsOf(male, it)) if (d.private) tint[d.name.replace(/^.*\//, '')] = d.kind === 'index' ? 0 : -(0x334455 + 1);
      const onHer = tintValues(tint, defsOf(female, f));
      const back = tintFromValues(onHer, f.parts.map((x) => x.name)) ?? {};
      if (Object.keys(tint).every((k) => back[k] === tint[k])) kept++;
    }
    ok(both > 1000 && kept / both >= 0.99, `a colour on every variable of a piece he wears is the same piece's colour on her, by bare name (${kept} of ${both} pieces in both wardrobes)`);
  }
}

console.log(`${checks} checks passed`);