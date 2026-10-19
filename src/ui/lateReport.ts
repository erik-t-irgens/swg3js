// What SOE's final files (publishes 55 to 59, read through the names list the converter ships) brought to each
// menu, asked of each menu's own pure function: the wardrobe view, the hair grid, the rack, the props view, the
// emote list, and the lists the garage, the NPC tab and the Housing tab read. `__debug.late()` asks these of
// whatever the game has already fetched, and `lateMenus.test.ts` asks the very same of the packs on disk, keyed on
// each pack's own late stamp (the `late` the converter writes into the file `status` reads for its command), so a
// pack converted before the list is a note and never a failure, and one converted with it fails when its menu does
// not show the late thing.
//
// Every id here is a name out of the converted packs (a catalogue id, a template path), never the game's words.
// Pure: no DOM, no three, every value import with its extension, so a node test loads it as it stands.
import { DANCES, danceOf, emoteChoices, isDanceClip } from '../core/emotes.ts';
import { NO_HAIR, hairCells, type HairItem } from './hairGrid.ts';
import type { CreatorTable } from './creatorModel.ts';
import { buildPropView, buildWardrobeView, buildWeaponView, type PropRow, type WardrobeRow, type WeaponRow } from './giveModel.ts';

/** A pack's late stamp, as the converter's `withLate` writes it. */
export interface LateStamp {
  key?: string | null;
  state?: string;
  rows?: number;
  v?: number;
  why?: string;
}

/**
 * What a stamp says of the pack: mounted with SOE's final names list (`applied`) or with SOE's own final indexes
 * (`final`), converted by a build that ran the late phase and found nothing to do (`none`) or refused it
 * (`refused`), or `before`: no stamp at all, converted before the list existed.
 */
export type LateState = 'applied' | 'final' | 'none' | 'refused' | 'before';

export function lateStateOf(stamp: unknown): LateState {
  if (!stamp || typeof stamp !== 'object') return 'before';
  const s = (stamp as LateStamp).state;
  return s === 'applied' || s === 'final' || s === 'none' || s === 'refused' ? s : 'before';
}

/** Whether a stamp says the late files were in the mount, so the late things must show. */
export function lateMounted(stamp: unknown): boolean {
  const s = lateStateOf(stamp);
  return s === 'applied' || s === 'final';
}

/** The late things each menu is asked for: ids out of the converted packs, one or a few a menu. */
export const LATE_THINGS = {
  /** The give tab's Clothes: the infiltrator armour's chest plate (`armor/infiltrator/`, publish 55 on). */
  clothes: 'armor_infiltrator_s02_chest_plate',
  /**
   * And three late pieces no id pattern places, each standing under the group of its arrangement's first slot
   * (`slotGroupOf(id, slots)`): the Life Day wings on the back, the crafting headband on the head (a hat), and the
   * Dathomir bracelet under the left bracer (a left wrist). Under Other, the Clothes view lost its slots.
   */
  slotted: { back_love_day_11_hue_wings: 'back', cyborg_crafting_headband_s01: 'head', bracelet_wod_crafting_l: 'bracer_l' } as Readonly<Record<string, string>>,
  /** The appearance page's hair grid: the Wookiee men's own styles, which no table before had. */
  hair: { species: 'wookiee', gender: 'male' as const },
  /** The rack: a Dathomir scythe among the two-handed blades. */
  weapon: '2h_sword_wod_scyth',
  /** The garage: the single-pod airspeeder's three templates and SOE's own player AT-ST and AT-XT templates. */
  vehicles: ['single_pod_airspeeder', 'tcg_8_air_speeder', 'tcg_8_single_pod_airspeeder', 'walker_at_st', 'walker_at_xt_player'],
  /** The garage's mounts the saddle map names under other templates' names, found by their appearance. */
  mounts: ['bm_whisper_bird_mount', 'bm_reptilian_flier_mount', 'bm_snorbal_mount', 'tcg_armored_tauntaun'],
  /** The garage's ships: a late hull, and the NPC tab's ladder at tier 10. */
  hull: 'twing',
  npcType: 'xwing_tier10',
  /** The NPC tab's bodies: the Dug. */
  body: 'dug_m',
  /** The props tab: a Dathomir painting. */
  prop: /^painting_wod_/,
  /** The Housing tab: a deed that makes the YT-1300 house. */
  house: 'object/building/player/shared_player_house_yt1300.iff',
  /** The emote list: one of the undead emotes the late body table names. */
  emote: 'emt_undead_idle',
  /** The dances the late body table names, which a rig converted with it carries. */
  dances: [33, 34, 35, 36],
};

/** One menu's answer: whether the late thing shows, and in words what was found. */
export interface LateProduct {
  menu: string;
  shows: boolean;
  what: string;
}

/**
 * The give tab's Clothes over a wardrobe's items: does the view list the late chest plate, and the late pieces no id
 * pattern places each under its arrangement's group (`LATE_THINGS.slotted`)? Every piece is listed (both genders',
 * blocked ones too), so only an absence or a piece under the wrong heading fails.
 */
export function clothesProduct(items: readonly WardrobeRow[], opts: { own: string; species: string }): LateProduct {
  const view = buildWardrobeView(items, { own: opts.own, species: opts.species, mixed: true, blocked: true, find: '', worn: new Set(), dir: null, packPart: () => false });
  const groupOf = new Map(view.groups.flatMap((g) => g.cells.map((c) => [c.id, g.id] as const)));
  const plate = groupOf.get(LATE_THINGS.clothes);
  const wrong = Object.entries(LATE_THINGS.slotted).filter(([id, want]) => groupOf.get(id) !== want).map(([id, want]) => `${id} under ${groupOf.get(id) ?? 'nothing'}, not ${want}`);
  const words = [plate ? `${LATE_THINGS.clothes} under ${plate}` : `no ${LATE_THINGS.clothes} among ${view.listed} pieces`, wrong.length ? wrong.join(', ') : `${Object.keys(LATE_THINGS.slotted).join(', ')} under ${Object.values(LATE_THINGS.slotted).join(', ')}`];
  return { menu: 'clothes', shows: !!plate && !wrong.length, what: words.join('; ') };
}

/** The appearance page's hair grid: does a Wookiee man get a group of his own styles? */
export function hairProduct(table: CreatorTable | null | undefined, items: readonly HairItem[]): LateProduct {
  const { species, gender } = LATE_THINGS.hair;
  const grid = hairCells(table, items, species, gender, null);
  const own = grid.groups.find((g) => g.id === 'own');
  const n = own ? own.cells.filter((c) => c.id !== NO_HAIR).length : 0;
  return { menu: 'hair', shows: n > 0, what: n ? `a Wookiee man's own group: ${n} styles` : `no own group for a Wookiee man (${grid.groups.map((g) => g.id).join(', ') || 'no grid'})` };
}

/** The rack: does the view list the Dathomir scythe? `order` is the rack's own class order. */
export function rackProduct(weapons: readonly WeaponRow[], order: readonly { id: string; label: string }[]): LateProduct {
  const view = buildWeaponView(weapons, { find: '', right: null, left: null, offHand: new Set(), order, iconUrl: () => null });
  const cell = view.groups.flatMap((g) => g.cells.map((c) => ({ g: g.id, c }))).find((x) => x.c.id === LATE_THINGS.weapon);
  return { menu: 'rack', shows: !!cell, what: cell ? `${LATE_THINGS.weapon} under ${cell.g}` : `no ${LATE_THINGS.weapon} among ${view.listed}` };
}

/** The garage: the late vehicles and mounts among the entries it lists (`ids`, its vehicles' ids). */
export function garageProduct(ids: Iterable<string>): LateProduct {
  const have = new Set(ids);
  const missing = [...LATE_THINGS.vehicles, ...LATE_THINGS.mounts].filter((id) => !have.has(id));
  return { menu: 'garage', shows: !missing.length, what: missing.length ? `missing ${missing.join(', ')}` : `the ${LATE_THINGS.vehicles.length} late vehicles and the ${LATE_THINGS.mounts.length} late mounts` };
}

/**
 * The garage's ships and the NPC tab's ladder: the late hull among the hulls, and a tier 10 type among the NPC types.
 * `npcTypes` is null where the ships pack holds no NPC types at all (its `combat.json` missing, or one this build
 * cannot read): the tier 10 type cannot show then, so the menu does not show its late things, and whether that is a
 * fault is the ships pack's stamp's to say (`missingMenus`). A combat file not yet landed is the caller's to say as
 * not fetched, never this.
 */
export function shipsProduct(hulls: Iterable<string>, npcTypes: Iterable<string> | null): LateProduct {
  const hull = new Set(hulls).has(LATE_THINGS.hull);
  const tier = npcTypes ? new Set(npcTypes).has(LATE_THINGS.npcType) : false;
  const words = [hull ? `${LATE_THINGS.hull} in the garage` : `no ${LATE_THINGS.hull} in the garage`, npcTypes === null ? 'no NPC ship types: ships/combat.json is missing or would not read' : tier ? `${LATE_THINGS.npcType} in the NPC tab` : `no ${LATE_THINGS.npcType} in the NPC tab`];
  return { menu: 'ships', shows: hull && tier, what: words.join('; ') };
}

/** The NPC tab's bodies: is the Dug in the catalogue and ready to be stood? */
export function bodiesProduct(ready: (id: string) => boolean | null): LateProduct {
  const r = ready(LATE_THINGS.body);
  return { menu: 'npcs', shows: r === true, what: r === null ? `no ${LATE_THINGS.body} in the catalogue` : r ? `${LATE_THINGS.body} ready` : `${LATE_THINGS.body} in the catalogue, not ready` };
}

/** The props tab: does the view list a Dathomir painting? `order` is the tab's own groups (all of them when left out). */
export function propsProduct(props: readonly PropRow[], order?: readonly { id: string; label: string }[]): LateProduct {
  const groups = order ?? [...new Set(props.map((p) => p.group))].map((id) => ({ id, label: id }));
  const view = buildPropView(props, { find: '', held: null, order: groups, iconUrl: () => null });
  const hits = view.groups.flatMap((g) => g.cells).filter((c) => LATE_THINGS.prop.test(c.id));
  return { menu: 'props', shows: hits.length > 0, what: hits.length ? `${hits.length} painting_wod_* props` : `no painting_wod_* among ${view.listed}` };
}

/** As much of a deed row as the Housing tab's check reads. */
export interface LateDeed {
  id: string;
  makes: string;
  model: string | null;
  ours?: boolean;
}

/** The Housing tab: does it offer a deed that makes the YT-1300 house (one with a model, the tab's own rule)? */
export function housingProduct(deeds: readonly LateDeed[]): LateProduct {
  const d = deeds.find((x) => x.makes === LATE_THINGS.house && !!x.model);
  return { menu: 'housing', shows: !!d, what: d ? `${d.id}${d.ours ? ' (a deed of ours)' : ''}` : `no deed with a model makes ${LATE_THINGS.house} (${deeds.length} deeds)` };
}

/** The emote list over a rig's clips: the late undead emote, the four late dances, and a label for every dance the rig carries. */
export function emotesProduct(clips: readonly string[]): LateProduct {
  const choices = emoteChoices([...clips]);
  const undead = choices.some((c) => c.clip === LATE_THINGS.emote);
  const dances = clips.filter((c) => isDanceClip(c)).map((c) => Number(danceOf(c)!.slice(6)));
  const late = LATE_THINGS.dances.filter((n) => dances.includes(n));
  const unlabelled = dances.filter((n) => !DANCES[n]);
  const shows = undead && late.length === LATE_THINGS.dances.length && !unlabelled.length;
  return { menu: 'emotes', shows, what: `${undead ? LATE_THINGS.emote : `no ${LATE_THINGS.emote}`}; dances ${late.length ? late.join(', ') : 'none'} of 33 to 36${unlabelled.length ? `; unlabelled: ${unlabelled.join(', ')}` : '; every dance labelled'}` };
}

/** A menu's answer as the console holds it: a product, or not asked yet (`shows` null) for want of its pack. */
export interface LateAnswer {
  menu: string;
  shows: boolean | null;
  what: string;
}

/**
 * The menus whose own pack says the late files were in the mount (`applied` or `final`) and that still do not show
 * their late thing, each as `menu: words`: what `__debug.late()` lists as `missing`, which should be empty. A menu not
 * asked yet (`shows` null) is never missing, and one none of whose packs was mounted with the late files is old, not
 * at fault. `packsOf` names each menu's packs as `packs` names them.
 */
export function missingMenus(menus: readonly LateAnswer[], packsOf: Readonly<Record<string, readonly string[]>>, packs: readonly { name: string; stamp: unknown }[]): string[] {
  const mounted = new Set(packs.filter((p) => lateMounted(p.stamp)).map((p) => p.name));
  return menus.filter((m) => m.shows === false && (packsOf[m.menu] ?? []).some((p) => mounted.has(p))).map((m) => `${m.menu}: ${m.what}`);
}

/**
 * The line the converter's `status` prints about SOE's final files, as far as the packs fetched can say it: mounted
 * in every one, not mounted (a refusal's why), in some and not others, or carried by none.
 */
export function lateLine(packs: readonly { name: string; stamp: unknown }[]): string {
  if (!packs.length) return "SOE's final files: no pack fetched yet";
  const states = packs.map((p) => ({ name: p.name, state: lateStateOf(p.stamp), stamp: p.stamp as LateStamp | null }));
  const mounted = states.filter((s) => s.state === 'applied' || s.state === 'final');
  const keys = [...new Set(mounted.map((s) => s.stamp?.key ?? '?'))];
  if (mounted.length === states.length) {
    const rows = mounted.find((s) => typeof s.stamp?.rows === 'number')?.stamp?.rows;
    return `SOE's final files: mounted in every pack fetched (${states.length}; names list ${keys.join(', ')}${rows ? `, ${rows.toLocaleString('en-US')} rows` : ''})`;
  }
  const refused = states.find((s) => s.state === 'refused');
  if (!mounted.length && refused) return `SOE's final files: not mounted on this install: ${refused.stamp?.why ?? 'refused'}; the world is publish 54's`;
  if (!mounted.length) return `SOE's final files: no pack fetched carries them (${states.filter((s) => s.state === 'before').length} converted before they could be mounted: run convert)`;
  return `SOE's final files: ${mounted.length} of ${states.length} packs fetched carry them (not: ${states.filter((s) => s.state !== 'applied' && s.state !== 'final').map((s) => s.name).join(', ')})`;
}
