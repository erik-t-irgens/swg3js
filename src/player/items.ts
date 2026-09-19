// What the game says about one owned item, for the backpack and the equipment rules: its name and
// description (the game's own, from the converted wardrobe and weapon packs), the body slots it
// takes, its picture, and whether this character's species may wear it. Pure and node-loadable:
// type-only imports apart from the rules module and the name maker, both with their extensions.
import { fitFor, packPartOf, type Fit } from '../core/inventory.ts';
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
};

/** The weapons rack's own class order, for the backpack's sort (the rack's headings read in this order). */
export const WEAPON_ORDER: readonly WeaponClass[] = ['lightsaber', 'lightsaber2h', 'lightsaberStaff', 'sword1h', 'knife', 'fist', 'sword2h', 'polearm', 'pistol', 'carbine', 'rifle', 'heavy', 'thrown'];

/** A name or description as shown: trimmed, empty as null. */
function clean(s: string | null | undefined): string | null {
  const t = typeof s === 'string' ? s.trim() : '';
  return t ? t : null;
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
    kindText: item?.kind === 'hair' || /^hair_/.test(id) ? 'Hair' : 'Clothing',
    packPart,
    unseen: !!item && (item.parts?.length ?? 0) === 0,
    missing: !item && packPart === null,
  };
}
