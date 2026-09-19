// The backpack's rules, pure: who may wear what, which body slots a piece takes and what it
// displaces, which hand a weapon goes in, the starting kit, and bringing an old saved character
// into the world of owned items. No runtime imports, so the plain node tests load it as it is.
//
// The data comes from the converter (tools/swg/items.mjs): each wardrobe item's arrangements (the
// game's `arrangementDescriptorFilename`, a list of alternatives, each a list of slots) and its
// `fit` (the client's appearance table: species that cannot wear it, species that wear it unseen).

export type Hand = 'right' | 'left';
export type Fit = 'ok' | 'block' | 'hide';

/** One thing a character owns, by catalogue id: a wardrobe item or a weapon off the rack. */
export interface OwnedItem {
  id: string;
  kind: 'wear' | 'weapon';
  /** Date.now() when it was given: the backpack's "newest" order. */
  got: number;
}

/** The appearance table's verdict per species (species ids of one gender: `wookiee_male`). */
export interface ItemFit {
  block?: string[];
  hide?: string[];
  own?: Record<string, string>;
}

/**
 * The classes a left hand may hold: every blade but the double-bladed staff. One in each hand fights
 * as Jedi Academy's dual style. The one list the rack (`OFF_HAND` in src/player/weapons.ts), the
 * player and `planHold` read. SWG itself held every lightsaber and polearm in both hands.
 */
export const OFF_HAND_CLASSES: ReadonlySet<string> = new Set(['sword1h', 'knife', 'sword2h', 'polearm', 'fist', 'lightsaber', 'lightsaber2h']);

/**
 * The species' verdict on an item. `packOwn`: the character's own species pack carries this item as a
 * part, which makes it 'ok' whatever the table says (the converter dressed every species pack in the
 * same shirt, trousers and shoes, which the table blocks or hides for the Wookiees).
 */
export function fitFor(fit: ItemFit | undefined | null, species: string, packOwn = false): Fit {
  if (packOwn) return 'ok';
  if (fit?.block?.includes(species)) return 'block';
  if (fit?.hide?.includes(species)) return 'hide';
  return 'ok';
}

/** A pack part's name without its gender and detail suffix: `shirt_s03_m_l0` is `shirt_s03`. */
const PACK_SUFFIX = /_[mf]_l\d+$/i;

/** A worn part's catalogue id: the name itself when the catalogue has it, else without `_m_l<n>`/`_f_l<n>`, else null. */
export function partToItemId(part: string, has: (id: string) => boolean): string | null {
  if (has(part)) return part;
  const stripped = part.replace(PACK_SUFFIX, '');
  if (stripped !== part && has(stripped)) return stripped;
  return null;
}

/** The pack part that is this item (`<id>_<m|f>_l<n>` among the pack's non-body part names), or null. */
export function packPartOf(id: string, packParts: readonly string[]): string | null {
  for (const p of packParts) if (p !== id && p.replace(PACK_SUFFIX, '') === id) return p;
  return null;
}

/** slot -> the id occupying it, from worn pieces and the arrangement each went on with, in wear order. */
export function occupancy(worn: readonly { id: string; slots: readonly string[] }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of worn) for (const s of w.slots) out.set(s, w.id);
  return out;
}

/**
 * Where a piece goes: the first alternative whose slots are all free (or held by `self`); else the
 * first, with its occupants displaced (SWG moved them to the inventory). No arrangements: it occupies
 * nothing and displaces nothing (a pack from before the converter read them).
 */
export function chooseArrangement(arrangements: readonly (readonly string[])[] | null | undefined, occupied: ReadonlyMap<string, string>, self: string): { slots: string[]; displaced: string[] } {
  const alts = (arrangements ?? []).filter((a) => a.length > 0);
  if (!alts.length) return { slots: [], displaced: [] };
  for (const alt of alts) {
    if (alt.every((s) => !occupied.has(s) || occupied.get(s) === self)) return { slots: [...alt], displaced: [] };
  }
  const first = alts[0];
  const displaced: string[] = [];
  for (const s of first) {
    const who = occupied.get(s);
    if (who !== undefined && who !== self && !displaced.includes(who)) displaced.push(who);
  }
  return { slots: [...first], displaced };
}

/** A weapon in or for a hand: its id, its class and its arrangements. */
export interface HeldRef {
  id: string;
  cls: string;
  slots: string[][] | null;
}

/**
 * Where a weapon goes and what comes out of the hands. Thrown weapons are refused (the Skills slots
 * throw them). The left hand takes only off-hand classes (else the right). Right: the old right comes
 * out; the left comes out too when the new weapon's class has no off-hand use in this game (every gun,
 * the double-bladed saber). The class alone decides it: the game's arrangement is not read, since every
 * lightsaber's names both hands and an off-hand class keeps the left all the same, while a class with no
 * off-hand use empties it whatever its arrangement says. Left: the old left comes out, and the right when
 * it holds a class with no off-hand use. Moving an item from one hand to the other empties the one it leaves.
 */
export function planHold(cur: { right: HeldRef | null; left: HeldRef | null }, w: HeldRef, want: Hand): { hand: Hand; stow: Hand[]; refused?: string } {
  if (w.cls === 'thrown') return { hand: want, stow: [], refused: 'a grenade is thrown from the Skills slots, not held' };
  const offHand = OFF_HAND_CLASSES.has(w.cls);
  const hand: Hand = want === 'left' && offHand ? 'left' : 'right';
  const other: Hand = hand === 'right' ? 'left' : 'right';
  const stow: Hand[] = [];
  const add = (h: Hand) => {
    if (!stow.includes(h)) stow.push(h);
  };
  if (cur[hand]) add(hand);
  if (cur[other]?.id === w.id) add(other);
  if (hand === 'right') {
    // A class with no off-hand use takes both hands whatever its arrangement says; an off-hand class
    // keeps the left even when the game's arrangement names both (every lightsaber is hold_both).
    if (cur.left && !offHand) add('left');
  } else if (cur.right && !OFF_HAND_CLASSES.has(cur.right.cls)) add('right');
  return { hand, stow };
}

/** One line of the starting kit: the first candidate the catalogues hold that the species wears. */
export interface KitEntry {
  kind: 'wear' | 'weapon';
  any: string[];
  hold?: Hand;
}

/**
 * The starting kit (the client's creation tables carry none: that was server data). Candidates in
 * order, the Ithorian ids after the human ones so each wardrobe folder finds its own.
 */
export const STARTING_KIT: { common: KitEntry[]; jedi: KitEntry[]; bounty_hunter: KitEntry[] } = {
  common: [
    { kind: 'wear', any: ['npe_shirt', 'shirt_s03', 'ith_shirt_s01'] },
    { kind: 'wear', any: ['pants_s04', 'pants_s01', 'ith_pants_s01'] },
    { kind: 'wear', any: ['shoes_s02', 'boots_s03'] },
    { kind: 'wear', any: ['npe_belt_01'] },
  ],
  jedi: [
    { kind: 'weapon', any: ['sword_lightsaber_training', 'sword_lightsaber_one_handed_gen1'], hold: 'right' },
    { kind: 'wear', any: ['robe_jedi_padawan', 'ith_robe_s02'] },
  ],
  bounty_hunter: [
    { kind: 'weapon', any: ['pistol_cdef', 'pistol_cdef_npe'], hold: 'right' },
    { kind: 'weapon', any: ['carbine_cdef', 'carbine_cdef_npe'] },
  ],
};

/**
 * The kit for a class. Per entry: the first candidate the catalogues hold that the species wears drawn
 * ('ok'); failing that, the first it wears unseen ('hide'); a blocked or absent candidate never. So an
 * Ithorian gets its Long Sweater rather than an unseen Plain Shirt, and still gets the belt.
 */
export function resolveKit(cls: 'jedi' | 'bounty_hunter', look: (kind: 'wear' | 'weapon', id: string) => Fit | null, now: number): { items: OwnedItem[]; held: { right?: string; left?: string } } {
  const items: OwnedItem[] = [];
  const held: { right?: string; left?: string } = {};
  for (const e of [...STARTING_KIT.common, ...(STARTING_KIT[cls] ?? [])]) {
    let pick: string | null = null;
    let unseen: string | null = null;
    for (const id of e.any) {
      const f = look(e.kind, id);
      if (f === 'ok') {
        pick = id;
        break;
      }
      if (f === 'hide' && unseen === null) unseen = id;
    }
    const id = pick ?? unseen;
    if (!id) continue;
    items.push({ id, kind: e.kind, got: now });
    if (e.hold && e.kind === 'weapon' && !held[e.hold]) held[e.hold] = id;
  }
  return { items: normalizeOwned(items), held };
}

/** Duplicates (same kind and id) removed, the first kept; anything malformed dropped. */
export function normalizeOwned(items: readonly OwnedItem[] | null | undefined): OwnedItem[] {
  const seen = new Set<string>();
  const out: OwnedItem[] = [];
  for (const o of items ?? []) {
    if (!o || typeof o.id !== 'string' || !o.id || (o.kind !== 'wear' && o.kind !== 'weapon')) continue;
    const k = `${o.kind}:${o.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: o.id, kind: o.kind, got: Number.isFinite(o.got) ? o.got : 0 });
  }
  return out;
}

/**
 * Bring a record from before the backpack into it, in place (and returned): its items become what it
 * owned already, what it wears (hair and pack parts with no catalogue item left out) and the kit, with
 * no duplicates, and it is marked `inv: 1`. A record already at 1 comes back untouched. `held` is left
 * alone, so an old character does not suddenly hold the kit's weapon.
 */
export function migrateInventory<T extends { items?: OwnedItem[]; outfit: string[]; inv?: 1 }>(c: T, kit: readonly OwnedItem[], toItem: (part: string) => string | null, now: number): T {
  if (c.inv === 1) return c;
  const worn: OwnedItem[] = [];
  for (const part of c.outfit ?? []) {
    if (/^hair_/.test(part)) continue;
    const id = toItem(part);
    if (id) worn.push({ id, kind: 'wear', got: now });
  }
  c.items = normalizeOwned([...(c.items ?? []), ...worn, ...kit]);
  c.inv = 1;
  return c;
}

/** The groups the Clothes (give) tab lists by, in the order they read down a body, and the id fragments that name them. */
export const SLOT_GROUPS: readonly { id: string; label: string; match: RegExp }[] = [
  { id: 'head', label: 'Head', match: /helmet|_hat|^hat_|goggles|headwrap|mask|headdress|bonnet/ },
  { id: 'neck', label: 'Neck', match: /necklace|choker|pendant/ },
  { id: 'chest', label: 'Chest', match: /chest_plate|chest_armor|^shirt|_shirt|jacket|robe|vest|dress|bodysuit|bikini|apron|tunic|blouse|coat/ },
  { id: 'back', label: 'Back', match: /backpack|cape|bandolier|_pack/ },
  { id: 'bicep_l', label: 'Left bicep', match: /bicep_l$|bicep_left/ },
  { id: 'bicep_r', label: 'Right bicep', match: /bicep_r$|bicep_right/ },
  { id: 'bracer_l', label: 'Left bracer', match: /bracer_l$|bracer_left|wrist_l$/ },
  { id: 'bracer_r', label: 'Right bracer', match: /bracer_r$|bracer_right|wrist_r$/ },
  { id: 'hands', label: 'Hands', match: /glove/ },
  { id: 'waist', label: 'Waist', match: /^belt|_belt|sash/ },
  { id: 'legs', label: 'Legs', match: /leggings|^pants|_pants|skirt|kilt|shorts/ },
  { id: 'feet', label: 'Feet', match: /boots|shoes|sandals/ },
];
export const OTHER_GROUP: { id: string; label: string; match: RegExp } = { id: 'other', label: 'Other', match: /.*/ };

/** The give tab's group for an item, by the first pattern its id fits (a guess from the id, kept for packs without arrangements). */
export function slotGroupOf(id: string): string {
  for (const s of SLOT_GROUPS) if (s.match.test(id)) return s.id;
  return OTHER_GROUP.id;
}

/** The player's slots head to foot (abstract/slot/descriptor/player.iff's wearable ones), for ordering what is worn. */
export const SLOT_ORDER: readonly string[] = [
  'hat', 'hair', 'earring_r', 'earring_l', 'eyes', 'mouth', 'neck', 'cloak', 'back',
  'chest1', 'chest2', 'chest3_r', 'chest3_l',
  'bicep_r', 'bicep_l', 'bracer_upper_r', 'bracer_upper_l', 'bracer_lower_r', 'bracer_lower_l', 'wrist_r', 'wrist_l',
  'gloves', 'ring_r', 'ring_l', 'hold_r', 'hold_l', 'default_weapon', 'cybernetic_hand_r', 'cybernetic_hand_l',
  'utility_belt', 'pants1', 'pants2', 'shoes',
];

const SLOT_WORDS: Record<string, string> = {
  hat: 'head', hair: 'hair', earring_r: 'right ear', earring_l: 'left ear', eyes: 'eyes', mouth: 'mouth', neck: 'neck',
  cloak: 'cloak', back: 'back', chest1: 'shirt', chest2: 'jacket', chest3_r: 'robe', chest3_l: 'robe',
  bicep_r: 'right upper arm', bicep_l: 'left upper arm', bracer_upper_r: 'right forearm', bracer_upper_l: 'left forearm',
  bracer_lower_r: 'right lower forearm', bracer_lower_l: 'left lower forearm', wrist_r: 'right wrist', wrist_l: 'left wrist',
  gloves: 'hands', ring_r: 'right ring finger', ring_l: 'left ring finger', hold_r: 'right hand', hold_l: 'left hand',
  default_weapon: 'weapon', cybernetic_hand_r: 'right cybernetic hand', cybernetic_hand_l: 'left cybernetic hand',
  utility_belt: 'belt', pants1: 'legs', pants2: 'over the legs', shoes: 'feet',
};

/** Slots that read as one word together (the whole set must be there). */
const SLOT_SETS: { slots: string[]; words: string }[] = [
  { slots: ['bicep_l', 'bicep_r', 'bracer_upper_l', 'bracer_upper_r', 'bracer_lower_l', 'bracer_lower_r'], words: 'both arms' },
  { slots: ['bicep_l', 'bracer_upper_l', 'bracer_lower_l'], words: 'left arm' },
  { slots: ['bicep_r', 'bracer_upper_r', 'bracer_lower_r'], words: 'right arm' },
  { slots: ['hold_r', 'hold_l'], words: 'both hands' },
  { slots: ['earring_l', 'earring_r'], words: 'both ears' },
  { slots: ['wrist_l', 'wrist_r'], words: 'both wrists' },
  { slots: ['pants1', 'pants2'], words: 'legs' },
];

/** Words for one arrangement: "shirt"; "jacket and both arms"; `[hold_r, hold_l]` is "both hands". */
export function slotWords(arrangement: readonly string[]): string {
  const left = new Set(arrangement);
  const words: string[] = [];
  const put = (w: string) => {
    if (!words.includes(w)) words.push(w);
  };
  for (const s of arrangement) {
    if (!left.has(s)) continue;
    const set = SLOT_SETS.find((g) => g.slots.includes(s) && g.slots.every((x) => left.has(x)));
    if (set) {
      for (const x of set.slots) left.delete(x);
      put(set.words);
      continue;
    }
    left.delete(s);
    put(SLOT_WORDS[s] ?? s.replace(/_/g, ' '));
  }
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Where a slot sits head to foot (unknown slots after every known one). */
export function slotRank(slot: string | undefined): number {
  const i = slot ? SLOT_ORDER.indexOf(slot) : -1;
  return i < 0 ? SLOT_ORDER.length : i;
}

const SPECIES_WORDS: Record<string, [string, string]> = {
  human: ['a Human', 'Humans'],
  twilek: ["a Twi'lek", "Twi'leks"],
  zabrak: ['a Zabrak', 'Zabraks'],
  wookiee: ['a Wookiee', 'Wookiees'],
  trandoshan: ['a Trandoshan', 'Trandoshans'],
  rodian: ['a Rodian', 'Rodians'],
  moncal: ['a Mon Calamari', 'Mon Calamari'],
  bothan: ['a Bothan', 'Bothans'],
  sullustan: ['a Sullustan', 'Sullustans'],
  ithorian: ['an Ithorian', 'Ithorians'],
};

/** "wookiee_male" as "Wookiees" (many) or "a Wookiee" (one), for the backpack's notes. */
export function speciesWords(species: string, many: boolean): string {
  const key = species.toLowerCase().replace(/_(male|female)$/, '');
  const known = SPECIES_WORDS[key];
  if (known) return many ? known[1] : known[0];
  const word = key ? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ') : 'this species';
  return many ? `${word}s` : /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}
