// The backpack's rules, pure: who may wear what, which body slots a piece takes and what it
// displaces, which hand a weapon goes in, the starting kit, and bringing an old saved character
// into the world of owned items. No runtime imports, so the plain node tests load it as it is.
//
// The data comes from the converter (tools/swg/items.mjs): each wardrobe item's arrangements (the
// game's `arrangementDescriptorFilename`, a list of alternatives, each a list of slots) and its
// `fit` (the client's appearance table: species that cannot wear it, species that wear it unseen).

export type Hand = 'right' | 'left';
export type Fit = 'ok' | 'block' | 'hide';

/**
 * One thing a character owns: a wardrobe item or a weapon off the rack.
 *
 * `id` is what it **is** -- the catalogue's own id, which every copy of it shares -- and `thing` is
 * which one it is, minted the moment it was got and never reused. The two were one field for a long
 * time, which is exactly why two of the same item could not be told apart, and why colours, stats
 * and crafting all waited on this: they are things one *thing* has and not things a *kind* has.
 *
 * A row from before this has no `thing`; `normalizeOwned` mints one, so nothing has to be rewritten.
 */
export interface OwnedItem {
  id: string;
  kind: 'wear' | 'weapon';
  /** Date.now() when it was given: the backpack's "newest" order. */
  got: number;
  /**
   * Which one of them this is. Absent on a record from before there were instances, and minted on
   * the way in; never shown to a player and never meaningful anywhere but as a key.
   */
  thing?: string;
  /**
   * This one thing's own colours, by **bare** variable name (`index_color_1`, `index_color_dye`), or
   * absent for the item's defaults. It is per **thing** and not per kind, which is the whole point: two
   * of one shirt may be two colours. A bare name and never a mesh's key, because the meshes are a
   * gender's (`_m_l0`, `_f_l0`) and a shirt traded between two characters keeps its colour; the piece
   * is drawn in it by `tintValues`, over every mesh it is worn under.
   */
  tint?: Record<string, number>;
  /**
   * When those colours were set, so the newer of two copies of them wins; absent for never. It is the
   * clock the server hands out (`sharedClock.now()`, the server's own while one answers and this
   * machine's while none does), never this machine's alone: a clock that runs fast would otherwise win
   * against every colour set after it. A time past the server's clock is read as now wherever it is
   * compared (`pairOwned`, `Trade.noteTint`, and the server's `cleanTintAt`).
   */
  tintAt?: number;
}

/**
 * How many things one character may own: the server's own cap (`LEDGER_TUNING.items` in
 * server/ledger.mjs), which a backpack handed up is cut to and an add past it is refused at. A copy
 * given here past it would be cut or refused there and then gone at the next list, so the developer's
 * "give another" stops at it in words. A test holds the two numbers equal.
 */
export const ITEMS_MOST = 400;

/**
 * How much of a catalogue id a thing's name carries: 60 characters, which with the moment (eight or
 * nine base-36 digits), the chance (at most five) and the kind's letter and two bars stays under 80.
 */
const THING_ID_MOST = 60;

/**
 * A name for one thing, from what it is and when it was got.
 *
 * It has to be unique within one character's own list and nowhere else, so it is short: the kind,
 * the catalogue id, the moment and a few characters of chance. `crypto.randomUUID` is not reached
 * for because this runs in a node test as well and a character's list is a few hundred rows at most.
 *
 * The id in it is cut at `THING_ID_MOST` characters, so a name is never past the 80 a server and this
 * browser take one to (`cleanThing` in server/ledger.mjs, `readThing` in src/net/trade.ts): a name
 * refused there is no name, and two of an item with no names are folded into one. The longest
 * catalogue id the packs carry is 46 characters, so no name made so far is any different for it.
 */
export function mintThing(kind: string, id: string, got: number, chance = Math.random): string {
  const tail = Math.floor(chance() * 0x1000000)
    .toString(36)
    .padStart(4, '0');
  return `${kind[0] ?? 'x'}${id.slice(0, THING_ID_MOST)}|${Math.round(got).toString(36)}|${tail}`;
}

/**
 * The lowest value a colour may take: a colour of its own rather than a palette's, written as a negative
 * number, `-(0xRRGGBB + 1)`, so white is the lowest of all. A palette index is 0 to 255. The server keeps
 * the same range (`cleanTintSet` in server/ledger.mjs).
 */
export const TINT_LEAST = -16777216;

/**
 * A per-thing colour set, cleaned: the customizer's own variable names and whole numbers in its own
 * range -- a palette index, or a colour of its own below nought. Anything else is dropped, so a record
 * edited by hand cannot put a colour out of a palette.
 */
export function cleanTint(tint: unknown, most = 255, least = TINT_LEAST): Record<string, number> | undefined {
  if (!tint || typeof tint !== 'object' || Array.isArray(tint)) return undefined;
  const out: Record<string, number> = {};
  let any = false;
  for (const [k, v] of Object.entries(tint as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_./|-]{1,64}$/.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const n = Math.max(least, Math.min(most, Math.round(v)));
    out[k] = n;
    any = true;
  }
  return any ? out : undefined;
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

/**
 * Whether a worn part's name is a hairstyle, which is never an item: hair belongs to the appearance page.
 * Every hairstyle id begins `hair_` but the Sullustan's eighteen, which are `sul_hair_s<nn>_<f|m>`, and
 * those were taken for wearables -- owned, put in the backpack, and never taken off when a style changed.
 */
export function isHairKey(key: string): boolean {
  return /^(hair_|sul_hair_)/.test(key);
}

/** As much of a catalogue entry as the hair lists read. */
export interface HairEntry {
  id: string;
  kind?: string;
  template?: string;
}

/**
 * A species' hairstyles out of a wardrobe, both genders' (a species' hair suits both): every hair entry
 * whose template is under that species' hair folder or whose id names it. A wardrobe folder holds every
 * species' hair, so the Singing Mountain Clan's, under a folder of their own, are never anyone's.
 */
export function hairOfSpecies<T extends HairEntry>(items: readonly T[], species: string): T[] {
  const s = species.toLowerCase();
  return items.filter((i) => i.kind === 'hair' && ((i.template ?? '').toLowerCase().includes(`/hair/${s}/`) || i.id.toLowerCase().includes(`hair_${s}_`)));
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

/**
 * A weapon in or for a hand: its id, its class and its arrangements, and which owned thing it is where
 * that is known (absent for a weapon nobody owns, and on the developer's give tab before it is given).
 */
export interface HeldRef {
  id: string;
  cls: string;
  slots: string[][] | null;
  thing?: string;
}

/**
 * Whether the weapon in a hand is the very one being taken up: the same thing where both are named,
 * else the same catalogue id. Two copies of one hilt are two things and may be held one in each hand
 * (the owner's call); one copy cannot be in both, and a weapon nobody owns is still told by its id.
 */
function sameHeld(a: HeldRef, b: HeldRef): boolean {
  return a.thing && b.thing ? a.thing === b.thing : a.id === b.id;
}

/**
 * Where a weapon goes and what comes out of the hands. Thrown weapons are refused (the Skills slots
 * throw them). The left hand takes only off-hand classes (else the right). Right: the old right comes
 * out; the left comes out too when the new weapon's class has no off-hand use in this game (every gun,
 * the double-bladed saber). The class alone decides it: the game's arrangement is not read, since every
 * lightsaber's names both hands and an off-hand class keeps the left all the same, while a class with no
 * off-hand use empties it whatever its arrangement says. Left: the old left comes out, and the right when
 * it holds a class with no off-hand use. Moving a thing from one hand to the other empties the one it
 * leaves; a second copy of the same item is another thing, and goes in the other hand beside the first.
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
  const there = cur[other];
  if (there && sameHeld(there, w)) add(other);
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

/**
 * A character's list read in: every row given a `thing` of its own, its colours cleaned, and
 * anything malformed dropped.
 *
 * **Duplicates are removed by `thing` and no longer by kind and id**, which is what lets a character
 * hold two of one item at last. A record from before instances has no `thing` on any row, so one is
 * minted per row -- and because such a record was itself deduped by kind and id, nothing about
 * reading it changes what it held.
 */
export function normalizeOwned(items: readonly OwnedItem[] | null | undefined, mint: (kind: string, id: string, got: number) => string = mintThing): OwnedItem[] {
  const seen = new Set<string>();
  const out: OwnedItem[] = [];
  for (const o of items ?? []) {
    if (!o || typeof o.id !== 'string' || !o.id || (o.kind !== 'wear' && o.kind !== 'weapon')) continue;
    const got = Number.isFinite(o.got) ? o.got : 0;
    const thing = typeof o.thing === 'string' && o.thing ? o.thing : mint(o.kind, o.id, got);
    if (seen.has(thing)) continue;
    seen.add(thing);
    const row: OwnedItem = { id: o.id, kind: o.kind, got, thing };
    const tint = cleanTint(o.tint);
    if (tint) row.tint = tint;
    if (Number.isFinite(o.tintAt) && (o.tintAt ?? 0) > 0) row.tintAt = o.tintAt;
    out.push(row);
  }
  return out;
}

/**
 * One of each item, the first of each kind and catalogue id in the order given: what bringing a
 * character into the backpack means (`migrateInventory`), what the creator's first items are (it is
 * handed what the character wears and the kit, which overlap), and what goes up to a server whose
 * hail does not say it keeps two of one item.
 */
export function firstItems<T extends { id: string; kind: string }>(items: readonly T[]): T[] {
  const once = new Map<string, T>();
  for (const o of items) {
    if (!o || typeof o.id !== 'string' || !o.id) continue;
    const k = `${o.kind}:${o.id}`;
    if (!once.has(k)) once.set(k, o);
  }
  return [...once.values()];
}

/**
 * Which of a character's copies of one item is the one on the body: the one the record names
 * (`wornThings`, catalogue id to thing) while it is still owned, else the oldest copy, the first in the
 * list on a tie. Null when none is owned. The one answer the backpack, the trade window and what the
 * server is told is worn all read, so the three can never point at different shirts. A weapon is a
 * hand's, not an item's (`heldThingsOf`): two copies of one hilt can be held one in each hand.
 */
export function wornThingOf(items: readonly OwnedItem[], kind: string, id: string, chosen?: Readonly<Record<string, string>> | null): string | null {
  const want = chosen && Object.prototype.hasOwnProperty.call(chosen, id) ? chosen[id] : '';
  let oldest: OwnedItem | null = null;
  for (const o of items) {
    if (o.kind !== kind || o.id !== id || !o.thing) continue;
    if (want && o.thing === want) return o.thing;
    if (!oldest || o.got < oldest.got) oldest = o;
  }
  return oldest?.thing ?? null;
}

/**
 * The record's choice of which copy is worn or held, written down only when it is not the one the
 * rule would take anyway, and kept only while that item is still on the body or in a hand and the copy
 * still owned: the map never names a thing that is not there to wear.
 */
export function pruneThings(chosen: Readonly<Record<string, string>> | undefined, items: readonly OwnedItem[], kind: string, inUse: ReadonlySet<string>): Record<string, string> | undefined {
  if (!chosen) return undefined;
  let out: Record<string, string> | undefined;
  for (const id of Object.keys(chosen)) {
    if (!inUse.has(id)) continue;
    const thing = chosen[id];
    if (!items.some((o) => o.kind === kind && o.id === id && o.thing === thing)) continue;
    // The oldest copy needs no line of its own: it is what absent means.
    if (wornThingOf(items, kind, id, null) === thing) continue;
    (out ??= {})[id] = thing;
  }
  return out;
}

/** Which thing is in each hand, by its name, or null for an empty hand or a weapon not owned. */
export interface HandThings {
  right: string | null;
  left: string | null;
}

/**
 * Which owned thing is in each hand, from the catalogue ids the hands hold and the record's own choice
 * per hand (`heldThings`). A hand takes the thing the record names for it while that is still owned and
 * is a copy of what the hand holds; else the oldest copy not already in the other hand. One thing is in
 * one hand at most -- named for both, the right keeps it -- so two copies of one hilt held one in each
 * hand are two things, and a single copy held twice over leaves the left with none. A choice map of the
 * shape before this (catalogue id to thing) names neither hand and is read as no choice at all.
 */
export function heldThingsOf(items: readonly OwnedItem[], held: { right?: string | null; left?: string | null }, chosen?: Readonly<{ right?: string; left?: string }> | null): HandThings {
  const owns = (id: string, thing: string | undefined): thing is string => !!thing && items.some((o) => o.kind === 'weapon' && o.id === id && o.thing === thing);
  const oldest = (id: string, not: string | null): string | null => {
    let best: OwnedItem | null = null;
    for (const o of items) {
      if (o.kind !== 'weapon' || o.id !== id || !o.thing || o.thing === not) continue;
      if (!best || o.got < best.got) best = o;
    }
    return best?.thing ?? null;
  };
  const r = held.right || null;
  const l = held.left || null;
  let right = r && owns(r, chosen?.right) ? chosen!.right! : null;
  let left = l && owns(l, chosen?.left) ? chosen!.left! : null;
  if (left && left === right) left = null;
  if (r && !right) right = oldest(r, l === r ? left : null);
  if (l && !left) left = oldest(l, l === r ? right : null);
  return { right, left };
}

/**
 * The record's choice of which copy is in each hand, written down only where it is not what the rule
 * would take anyway (`heldThingsOf` with no choice for the right, and with the right's for the left) and
 * only while that hand holds it: the map never names a thing that is not in a hand.
 */
export function pruneHeld(chosen: Readonly<{ right?: string; left?: string }> | undefined, items: readonly OwnedItem[], held: { right?: string | null; left?: string | null }): { right?: string; left?: string } | undefined {
  if (!chosen) return undefined;
  const now = heldThingsOf(items, held, chosen);
  const out: { right?: string; left?: string } = {};
  if (now.right && now.right !== heldThingsOf(items, held, null).right) out.right = now.right;
  if (now.left && now.left !== heldThingsOf(items, held, out).left) out.left = now.left;
  return out.right || out.left ? out : undefined;
}

/**
 * One row of what a server says a character owns: what it is, which one (`thing`, absent from a server
 * built before things had names), and its colours (`null` once taken off, absent when it never had any).
 */
export interface ListedItem {
  id: string;
  kind: 'wear' | 'weapon';
  got: number;
  thing?: string;
  tint?: Record<string, number> | null;
  tintAt?: number;
}

/**
 * The server's list laid over this browser's, thing by thing, which is how a list that stands is
 * taken without minting a single name: a server row and a local thing of the same name are the same
 * thing; what is left is paired by kind and catalogue id, the oldest of each side with the oldest of
 * the other, and the pair takes the server's name (`renamed`, old name to new). A server row with no
 * local thing is a thing that came; a local thing with no server row is one that went.
 *
 * What a paired thing keeps: the server's name, kind, id and when it was got, and the newer of the two
 * colours by when each was set -- the server's when it is as new, since it is the truth; a server row
 * that says nothing of colour leaves this browser's alone. Nothing is minted for a server that names
 * its things; a server from before names gives each new row a name here, as it always had to.
 *
 * `now` is the server's clock as this list is read. A colour this browser stamped later than that was
 * stamped by a clock running fast, while no server answered, and is read -- and kept -- as set now: it
 * still wins against what the server held before it, and stops winning against what comes after, which
 * left alone it would have done for as long as the clock was ahead.
 *
 * `resend` names every thing (by the name it ends with) whose colour this browser kept over the server's
 * and which the server does not hold: a colour set while no server answered, one a server that had none
 * has never been told of, one taken off here since. Newest wins both ways, so those go up after the list
 * (`Equipment.reconcile`), and a colour set offline survives connecting.
 */
export function pairOwned(had: readonly OwnedItem[], server: readonly ListedItem[], mint: (kind: string, id: string, got: number) => string = mintThing, now = Infinity): { items: OwnedItem[]; renamed: Map<string, string>; came: number; gone: OwnedItem[]; resend: string[] } {
  const byThing = new Map<string, OwnedItem>();
  for (const o of had) if (o.thing) byThing.set(o.thing, o);
  const used = new Set<OwnedItem>();
  const out: (OwnedItem | null)[] = new Array(server.length).fill(null);
  const renamed = new Map<string, string>();
  const resend: string[] = [];
  let came = 0;
  const cap = Number.isFinite(now) ? now : Infinity;
  const merge = (local: OwnedItem, s: ListedItem): OwnedItem => {
    used.add(local);
    const thing = s.thing || local.thing || mint(s.kind, s.id, s.got);
    if (local.thing && thing !== local.thing) renamed.set(local.thing, thing);
    const row: OwnedItem = { id: s.id, kind: s.kind, got: s.got || local.got, thing };
    const localAt = local.tintAt !== undefined ? Math.min(local.tintAt, cap) : undefined;
    const theirs = s.tint !== undefined && (s.tintAt ?? 0) >= (localAt ?? 0);
    const tint = theirs ? s.tint : local.tint;
    const at = theirs ? s.tintAt : localAt;
    if (tint) row.tint = { ...tint };
    if (at && at > 0) row.tintAt = at;
    if (!theirs && !sameTint(local.tint, s.tint)) resend.push(thing);
    return row;
  };
  // By name first.
  const left: number[] = [];
  for (let i = 0; i < server.length; i++) {
    const s = server[i];
    const local = s.thing ? byThing.get(s.thing) : undefined;
    if (local && !used.has(local) && local.kind === s.kind && local.id === s.id) out[i] = merge(local, s);
    else left.push(i);
  }
  // Then what is left, by what it is: the oldest with the oldest, each side in its own order on a tie.
  const pool = new Map<string, OwnedItem[]>();
  for (const o of had) {
    if (used.has(o)) continue;
    const k = `${o.kind}:${o.id}`;
    const list = pool.get(k);
    if (list) list.push(o);
    else pool.set(k, [o]);
  }
  for (const list of pool.values()) list.sort((a, b) => a.got - b.got);
  left.sort((a, b) => server[a].got - server[b].got || a - b);
  for (const i of left) {
    const s = server[i];
    const local = pool.get(`${s.kind}:${s.id}`)?.shift();
    if (local) out[i] = merge(local, s);
    else {
      const row: OwnedItem = { id: s.id, kind: s.kind, got: s.got, thing: s.thing || mint(s.kind, s.id, s.got) };
      if (s.tint) row.tint = { ...s.tint };
      if (s.tint !== undefined && s.tintAt && s.tintAt > 0) row.tintAt = s.tintAt;
      out[i] = row;
      came++;
    }
  }
  const gone = had.filter((o) => !used.has(o));
  return { items: normalizeOwned(out.filter((o): o is OwnedItem => !!o)), renamed, came, gone, resend };
}

/** Two colour sets alike: no colour and `null` are one answer, and a set is its names and numbers. */
export function sameTint(a: Readonly<Record<string, number>> | null | undefined, b: Readonly<Record<string, number>> | null | undefined): boolean {
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!b || !Object.prototype.hasOwnProperty.call(b, k) || b[k] !== a![k]) return false;
  return true;
}

/**
 * Bring a record's items into named things, once and in place: before a thing had a name nothing
 * could give a character two of one item, so two of one kind and id in an old record are the creator's
 * doing (it once handed a new character both the shirt it was dressed in and the kit's shirt) and are
 * collapsed to the one on the body or in a hand (`wornThingOf`), and the record is marked `named: 1`.
 * A record already marked comes back untouched. It runs before a server is first handed the list, or
 * a server that keeps two of one item would keep the duplicate for ever.
 */
export function collapseOwned<T extends { items?: OwnedItem[]; named?: 1; wornThings?: Record<string, string>; held?: { right?: string; left?: string }; heldThings?: { right?: string; left?: string } }>(c: T): T {
  if (c.named === 1) return c;
  const items = normalizeOwned(c.items);
  const keep = new Set<string>();
  const hands = heldThingsOf(items, c.held ?? {}, c.heldThings);
  for (const o of firstItems(items)) {
    const inHand = o.kind === 'weapon' ? (c.held?.right === o.id ? hands.right : null) ?? (c.held?.left === o.id ? hands.left : null) : null;
    const thing = inHand ?? wornThingOf(items, o.kind, o.id, o.kind === 'wear' ? c.wornThings : null);
    if (thing) keep.add(thing);
  }
  c.items = items.filter((o) => !!o.thing && keep.has(o.thing));
  c.named = 1;
  return c;
}

/**
 * How many of one item a character holds. What the backpack counts and what a give refuses on: a
 * thing is one thing, but "have I got one of these" is still a question worth asking.
 */
export function countOf(items: readonly OwnedItem[], kind: string, id: string): number {
  let n = 0;
  for (const o of items) if (o.kind === kind && o.id === id) n++;
  return n;
}

/** One thing by its own name, or null. */
export function thingOf(items: readonly OwnedItem[], thing: string): OwnedItem | null {
  return items.find((o) => o.thing === thing) ?? null;
}

/** A variable's own name, without the mesh it is read on or its path: `shirt_s03_m_l0|/private/index_color_1` is `index_color_1`. */
export function bareVariable(name: string): string {
  return name.replace(/^.*\|/, '').replace(/^.*\//, '');
}

/**
 * One variable a piece's recipes read on one of its meshes, as the customizer lists it
 * (`Customizer.variablesOn`): its key (a private one scoped to its mesh), its name, whether it is the
 * mesh's own, its resting value and whether it picks a palette's colour or a texture.
 */
export interface TintVariable {
  key: string;
  name: string;
  private: boolean;
  default: number;
  kind?: 'palette' | 'index';
}

/**
 * A thing's colours as the values its piece is drawn with: **every** variable the piece's recipes read on
 * the meshes it is worn under (`defs`, gathered by the caller from the part as it is worn -- the pack's own
 * mesh for the species' shirt, the catalogue's for the rest), set to the thing's own colour by bare name,
 * or to the recipe's default where it has none. Writing the defaults too is what makes putting on a copy
 * with no colour put the piece back to the game's own, rather than leaving the last copy's colour standing
 * on the shared mesh. Only a mesh's own variables: a shared one (the skin a garment's bare midriff wears)
 * is the body's and never a thing's. A colour carried whole (below nought) never lands on a texture
 * choice, which takes the default instead.
 *
 * A private copy that follows one of the body's own colours (`follows`, the customizer's link by name: on
 * a Wookiee every garment's `index_color_1` follows the fur) is the body's too, and is written at the
 * colour it follows, never at the thing's and never at its own default. `follows` answers the value such a
 * key takes, or undefined for a key that is the piece's own; left out, nothing follows anything.
 */
export function tintValues(tint: Readonly<Record<string, number>> | null | undefined, defs: readonly TintVariable[], follows?: (key: string) => number | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defs) {
    if (!d.private) continue;
    const body = follows?.(d.key);
    if (typeof body === 'number' && Number.isFinite(body)) {
      out[d.key] = body;
      continue;
    }
    const bare = bareVariable(d.name);
    const v = tint && Object.prototype.hasOwnProperty.call(tint, bare) ? tint[bare] : undefined;
    out[d.key] = typeof v === 'number' && Number.isFinite(v) && !(d.kind === 'index' && v < 0) ? v : d.default;
  }
  return out;
}

/**
 * A piece's colours read back as a thing's tint: every value held under one of its meshes' own keys, by
 * bare name. The full spelling of a key (`mesh|/private/index_color_1`) is what a render reads first, so it
 * wins over the short one; a mesh listed first wins over a later one, since the appearance page writes one
 * colour over every mesh of a piece. A key that follows one of the body's colours (`follows`) is the
 * body's and never the thing's, and is passed over. Undefined when nothing is held for any of them.
 */
export function tintFromValues(values: Readonly<Record<string, number>> | null | undefined, meshes: readonly string[], follows?: (key: string) => boolean): Record<string, number> | undefined {
  if (!values) return undefined;
  const out: Record<string, number> = {};
  let any = false;
  for (const mesh of meshes) {
    const scope = `${mesh}|`;
    const keys = Object.keys(values).filter((k) => k.startsWith(scope) && !follows?.(k));
    // The full spelling first: it is what `valueOf` reads first.
    keys.sort((a, b) => Number(!a.includes('/')) - Number(!b.includes('/')));
    for (const k of keys) {
      const v = values[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const bare = bareVariable(k);
      if (!bare || Object.prototype.hasOwnProperty.call(out, bare)) continue;
      out[bare] = v;
      any = true;
    }
  }
  return any ? cleanTint(out) : undefined;
}

/**
 * Bring a record's garment colours onto the things they colour, once and in place, and mark it `tints: 1`.
 * Until colour was a thing's, a worn piece's colours were kept in the look (`appearance.values`) under its
 * meshes' keys; now they are the thing's own. For each wardrobe item the record owns, the values held under
 * its meshes' keys (`meshesOf`, the catalogue's and the pack's own) go into the tint of the copy worn, else
 * the oldest (`wornThingOf`), by bare name -- a colour the thing already carries is kept over them -- and
 * come out of the look. A mesh two owned items share colours both. No time is stamped on what moved: it
 * was set at no time anybody knows, so a server's colour, which has one, wins over it. Hair stays in the
 * look, since a hairstyle is never a thing. A record already marked is left alone. How many things took a
 * colour.
 *
 * Two kinds of key leave the look and go nowhere. A copy that follows one of the body's colours
 * (`opts.follows`: on a Wookiee a garment's `index_color_1` follows the fur) is the body's, and is drawn
 * from the body's colour wherever the piece is (`tintValues`). And every key of a garment's mesh the record
 * does not own (`opts.garment`, every garment the wardrobe and the species pack hold): the old look kept
 * the colours of every piece ever coloured, kept or traded away, and left there they would come back on the
 * day another of that piece arrived, which has no colour of its own.
 */
export function moveTints<T extends { items?: OwnedItem[]; appearance?: { values?: Record<string, number> }; wornThings?: Record<string, string>; tints?: 1 }>(c: T, meshesOf: (id: string) => readonly string[], opts: { follows?: (key: string) => boolean; garment?: (mesh: string) => boolean } = {}): number {
  if (c.tints === 1) return 0;
  const items = c.items ?? [];
  const values = c.appearance?.values;
  const moved = new Set<string>();
  let n = 0;
  if (values) {
    for (const o of firstItems(items)) {
      if (o.kind !== 'wear' || isHairKey(o.id)) continue;
      const meshes = meshesOf(o.id);
      if (!meshes.length) continue;
      const tint = tintFromValues(values, meshes, opts.follows);
      const thing = wornThingOf(items, 'wear', o.id, c.wornThings);
      const row = thing ? thingOf(items, thing) : null;
      if (!row) continue;
      if (tint) {
        row.tint = { ...tint, ...(row.tint ?? {}) };
        n++;
      }
      for (const mesh of meshes) for (const k of Object.keys(values)) if (k.startsWith(`${mesh}|`)) moved.add(k);
    }
    for (const k of moved) delete values[k];
    if (opts.garment) {
      const kept = lookWithoutGarments(values, opts.garment);
      for (const k of Object.keys(values)) if (!Object.prototype.hasOwnProperty.call(kept, k)) delete values[k];
    }
  }
  c.tints = 1;
  return n;
}

/**
 * A look's values less every one scoped to a garment's mesh (`garment`: a set of mesh names, or a test of
 * one): what a record keeps once a garment's colours are its thing's. Shared values, the body's own meshes'
 * and the hair's (its meshes and the remembered `hair|`) stay. A new object; the one given is not touched.
 */
export function lookWithoutGarments(values: Readonly<Record<string, number>>, garment: ReadonlySet<string> | ((mesh: string) => boolean)): Record<string, number> {
  const isGarment = typeof garment === 'function' ? garment : (mesh: string) => garment.has(mesh);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) {
    const bar = k.indexOf('|');
    if (bar > 0 && isGarment(k.slice(0, bar))) continue;
    out[k] = v;
  }
  return out;
}

/** Every catalogue's garment meshes, worked out once per wardrobe (a wardrobe is one object for the session). */
const garmentMeshCache = new WeakMap<object, ReadonlySet<string>>();

/**
 * Every mesh a garment is drawn with: every wardrobe item that is not a hairstyle, by its parts' names (the
 * converter's mesh names, which the recipes key a private colour by), and the species pack's own pieces
 * (`packParts`, its shirt, trousers and shoes). Neither the body's meshes nor any hair's are among them. A
 * new set each call, which the caller may add to.
 */
export function garmentMeshesOf(wardrobe: { items: readonly { id: string; kind: string; parts: readonly { name: string }[] }[] } | null | undefined, packParts: readonly string[] = []): Set<string> {
  let base = wardrobe ? garmentMeshCache.get(wardrobe.items) : undefined;
  if (wardrobe && !base) {
    const made = new Set<string>();
    for (const it of wardrobe.items) if (it.kind !== 'hair' && !isHairKey(it.id)) for (const p of it.parts) made.add(p.name);
    garmentMeshCache.set(wardrobe.items, made);
    base = made;
  }
  const out = new Set<string>(base ?? []);
  for (const p of packParts) if (!isHairKey(p)) out.add(p);
  return out;
}

/**
 * The colours the creator dressed a new character in, made the things' own: for each piece of the outfit
 * that is an item the character owns (`itemIdOf`), the values held under its meshes (`tintFromValues`, a
 * copy that follows a body colour left out) become the oldest copy's tint, stamped `at` -- a colour picked in
 * the creator is set as one picked in play is. In place; how many things took a colour.
 */
export function outfitTints(items: OwnedItem[], outfit: readonly string[], values: Readonly<Record<string, number>>, itemIdOf: (part: string) => string | null, meshesOf: (part: string) => readonly string[], at: number, follows?: (key: string) => boolean): number {
  let n = 0;
  for (const part of outfit) {
    if (isHairKey(part)) continue;
    const id = itemIdOf(part);
    const thing = id ? wornThingOf(items, 'wear', id, null) : null;
    const row = thing ? thingOf(items, thing) : null;
    const tint = row ? tintFromValues(values, meshesOf(part), follows) : undefined;
    if (!row || !tint) continue;
    row.tint = tint;
    row.tintAt = at;
    n++;
  }
  return n;
}

/**
 * What a colour picked on a worn piece's row is to its thing: `null` -- no colour of its own, each mesh at
 * its own default -- only when the value is the default of every mesh the row wrote (`defaults`, one a key),
 * else the value itself. A piece whose meshes rest at different defaults (a dress's bodice and skirt) keeps
 * the value picked: taken as no colour, the other mesh would go back to its own default under a colour the
 * page had just written over the whole piece.
 */
export function pickedTint(value: number, defaults: readonly number[]): number | null {
  return defaults.length > 0 && defaults.every((d) => d === value) ? null : value;
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
    if (isHairKey(part)) continue;
    const id = toItem(part);
    if (id) worn.push({ id, kind: 'wear', got: now });
  }
  // One of each, and not one per list it turned up in. The three lists overlap on purpose -- a
  // character is usually wearing something the kit also gives -- and until items had instances the
  // collapse by kind and id happened in `normalizeOwned`, which now keeps duplicates because two of
  // one item are two things. So the collapse lives here, where it is right: bringing a character
  // into the backpack gives it one of each, and getting a second one afterwards is a second thing.
  c.items = normalizeOwned(firstItems([...(c.items ?? []), ...worn, ...kit]));
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
