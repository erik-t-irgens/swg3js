// What the game says about one owned item, for the backpack and the equipment rules: its name and
// description (the game's own, from the converted wardrobe and weapon packs), the body slots it
// takes, its picture, and whether this character's species may wear it. Pure and node-loadable:
// type-only imports apart from the rules module and the name maker, both with their extensions.
import { fitFor, isHairKey, packPartOf, type Fit } from '../core/inventory.ts';
import { prettyName } from '../ui/catalogue.ts';
import type { Wardrobe } from './character';
import type { WeaponCatalogue, WeaponClass, WeaponDef } from './weapons';

export interface ItemInfo {
  kind: 'wear' | 'weapon';
  id: string;
  /** `${kind}:${id}`: the backpack's cell key. */
  key: string;
  /** The game's name, else words made from the id. */
  name: string;
  /** The game's description, else ''. */
  description: string;
  slots: string[][] | null;
  /** The picture as a full URL, or null. */
  icon: string | null;
  fit: Fit;
  cls?: WeaponClass;
  def?: WeaponDef;
  /** 'Clothing', 'Pistol', 'Two-hand lightsaber', ... */
  kindText: string;
  /** The species pack's own part that is this item (worn as that part, and wearable whatever the table says). */
  packPart: string | null;
  /** A worn-unseen entry: the item has no meshes. */
  unseen: boolean;
  /** Not in this character's catalogues: shown, destroyable, not wearable. */
  missing: boolean;
}

export interface ItemContext {
  wardrobe: Wardrobe | null;
  /** The wardrobe folder's URL (ending in '/'), which the items' pictures are relative to. */
  wardrobeDir: string | null;
  weapons: WeaponCatalogue | null;
  /** The character's species id (`wookiee_male`), which the items' `fit` lists name. */
  species: string;
  /** The species pack's non-body part names. */
  packParts: readonly string[];
}

type WardrobeItem = Wardrobe['items'][number];

const indexes = new WeakMap<Wardrobe, Map<string, WardrobeItem>>();

/** A wardrobe's items by id, built once per catalogue; the first entry of a repeated id wins (as `wearItem`'s find does). */
export function wardrobeIndex(w: Wardrobe): Map<string, WardrobeItem> {
  let m = indexes.get(w);
  if (!m) {
    m = new Map();
    for (const item of w.items) if (!m.has(item.id)) m.set(item.id, item);
    indexes.set(w, m);
  }
  return m;
}

const CLASS_TEXT: Record<WeaponClass, string> = {
  pistol: 'Pistol',
  carbine: 'Carbine',
  rifle: 'Rifle',
  heavy: 'Heavy weapon',
  sword1h: 'One-hand sword',
  knife: 'Knife',
  sword2h: 'Two-hand sword',
  polearm: 'Polearm',
  fist: 'Fist weapon',
  lightsaber: 'Lightsaber',
  lightsaber2h: 'Two-hand lightsaber',
  lightsaberStaff: 'Double-bladed lightsaber',
  thrown: 'Grenade',
  instrument: 'Instrument',
  entertainer: "Dancer's prop",
};

/** The weapons rack's own class order, for the backpack's sort (the rack's headings read in this order). */
export const WEAPON_ORDER: readonly WeaponClass[] = ['lightsaber', 'lightsaber2h', 'lightsaberStaff', 'sword1h', 'knife', 'fist', 'sword2h', 'polearm', 'pistol', 'carbine', 'rifle', 'heavy', 'thrown', 'instrument'];

/** A name or description as shown: trimmed, empty as null. */
function clean(s: string | null | undefined): string | null {
  const t = typeof s === 'string' ? s.trim() : '';
  return t ? t : null;
}

/**
 * The colour a thing's first colour shows, as `#rrggbb`, for the backpack's and the trade window's small
 * swatch; null where it shows none. First is the game's own variables in the catalogue's order, then any
 * other the thing carries (our dye). A colour carried whole (below nought) is itself; a palette index is
 * that palette's entry where the catalogue lists the palette's colours (a weapon has none, and our dye's
 * one entry is no colour at all, so an index on it shows nothing). These are game colours shown as what
 * they are, the way the appearance page's own swatches are, and never the interface's.
 */
export function itemSwatch(kind: 'wear' | 'weapon', id: string, tint: Readonly<Record<string, number>> | null | undefined, ctx: ItemContext | null): string | null {
  if (!tint) return null;
  const vars = kind === 'wear' && ctx?.wardrobe ? (wardrobeIndex(ctx.wardrobe).get(id)?.variables ?? []) : [];
  const bare = (n: string) => n.replace(/^.*\|/, '').replace(/^.*\//, '');
  const order: string[] = [];
  for (const v of vars) if (v.private && !order.includes(bare(v.name))) order.push(bare(v.name));
  for (const k of Object.keys(tint)) if (!order.includes(k)) order.push(k);
  const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
  for (const k of order) {
    if (!Object.prototype.hasOwnProperty.call(tint, k)) continue;
    const v = tint[k];
    if (!Number.isFinite(v)) continue;
    if (v < 0) {
      const x = -Math.round(v) - 1;
      return hex((x >>> 16) & 255, (x >>> 8) & 255, x & 255);
    }
    const def = vars.find((d) => bare(d.name) === k && d.kind !== 'index');
    const c = def?.colors?.[Math.round(v)];
    if (c) return hex(c[0], c[1], c[2]);
  }
  return null;
}

export function itemInfo(kind: 'wear' | 'weapon', id: string, ctx: ItemContext): ItemInfo {
  const key = `${kind}:${id}`;
  if (kind === 'weapon') {
    const def = ctx.weapons?.weapons.find((w) => w.id === id);
    return {
      kind,
      id,
      key,
      name: clean(def?.name) ?? prettyName(id).name,
      description: clean(def?.description) ?? '',
      slots: def?.slots ?? null,
      icon: def && ctx.weapons ? ctx.weapons.iconUrl(def) : null,
      fit: 'ok',
      cls: def?.class,
      def,
      kindText: def ? CLASS_TEXT[def.class] ?? 'Weapon' : 'Weapon',
      packPart: null,
      unseen: false,
      missing: !def,
    };
  }
  const item = ctx.wardrobe ? wardrobeIndex(ctx.wardrobe).get(id) : undefined;
  const packPart = packPartOf(id, ctx.packParts);
  return {
    kind,
    id,
    key,
    name: clean(item?.name) ?? prettyName(id).name,
    description: clean(item?.description) ?? '',
    slots: item?.slots ?? null,
    icon: item?.icon && ctx.wardrobeDir ? `${ctx.wardrobeDir}${item.icon}` : null,
    fit: fitFor(item?.fit, ctx.species, packPart !== null),
    kindText: item?.kind === 'hair' || isHairKey(id) ? 'Hair' : 'Clothing',
    packPart,
    unseen: !!item && (item.parts?.length ?? 0) === 0,
    missing: !item && packPart === null,
  };
}
