// What a person from the catalogue fights with: first what its own creature fought with -- the
// emulator's weapon groups, a Tusken's stone knife and wooden staves, a trooper's carbine, a
// pirate's axe, mapped onto this game's rack (`ownWeapon`) -- and only where that names nothing the
// rack has, the old guess from its name: a blaster off the rack in the hand when its pack shoots, a
// lightsaber when it is a Jedi. And which of the pack's clips carry the weapon. A droid's or a
// creature's ranged attack is its own (a built-in blaster, a spit) and takes no model; its shot
// leaves from a muzzle bone found by name.
//
// A droid is armed only when it is a combat droid; a protocol droid on the human skeleton has the
// hand joint but never carried a blaster.
//
// It also holds what a swing by anybody who is not the player is worth (`BLADE_SWING`), the
// figures those swings leave behind and the knob over both, because that is arithmetic and a table
// of numbers and belongs where node can run it.
//
// Pure: no three, no fetch. Rule for this file (it is run by node with type stripping for the
// tests): no enum, no namespace, no constructor parameter properties, and a relative import only
// as `import type` or with its `.ts` extension onto another module that is pure the same way
// (`saberHit.ts` is: arithmetic, one type import, and node already runs it for its own test).
import type { CarryRow, CarryWeapon, MobileAggression, MobileEntry, PackClipInfo, Roles } from './types';
import type { WeaponClass } from '../../player/weapons';
import { SABER_HIT_STATS } from '../../combat/saberHit.ts';

/** How a pack's ranged attack is held: a pistol, a rifle, or the body's own (a droid's gun, a spit). */
export type GunKind = 'pistol' | 'rifle' | 'own';

/**
 * The kind of ranged attack a pack's roles describe, from the logical name the ranged role came
 * from (`roleSources.ranged`): `add_pistol_fire_1` and `pistol_*` are a pistol, `add_rifle_*` and
 * `rifle_*` a rifle, `cbt_attack_ranged` the mobile's own. Without a source the clip's own name is
 * read the same way. Null when the pack has no ranged attack at all.
 */
export function gunKindForRoles(roleSources: Record<string, string> | undefined, roles: Pick<Roles, 'ranged'>): GunKind | null {
  if (!roles.ranged) return null;
  const src = (roleSources?.ranged ?? '').toLowerCase();
  if (/^(add_)?pistol/.test(src)) return 'pistol';
  if (/^(add_)?rifle/.test(src)) return 'rifle';
  if (/attack_ranged/.test(src)) return 'own';
  const clip = roles.ranged.toLowerCase();
  if (/pistol/.test(clip)) return 'pistol';
  if (/rifle/.test(clip)) return 'rifle';
  return 'own';
}

/** One row of the hints: an id that matches is armed from these classes, preferring these id fragments in order. */
export interface WeaponHint {
  match: RegExp;
  carry: 'pistol' | 'rifle';
  classes: WeaponClass[];
  prefer: string[];
}

/**
 * Who carries what, by the template's id (then its species or appearance, `hintForEntry`): the troopers a rifle, the officers and the underworld a
 * pistol, the species their own (a Wookiee's bowcaster, a Jawa's ion gun, a Trandoshan's hunting
 * rifle). The first row that matches wins; anything else takes a random weapon of the kind its
 * pack's clips hold.
 */
export const WEAPON_HINTS: WeaponHint[] = [
  { match: /death_?trooper/, carry: 'rifle', classes: ['rifle', 'carbine'], prefer: ['deathtroopers', 'e11'] },
  { match: /dark_?trooper/, carry: 'rifle', classes: ['rifle', 'carbine'], prefer: ['t21', 'e11'] },
  { match: /sniper/, carry: 'rifle', classes: ['rifle'], prefer: ['t21', 'dlt20', 'e11'] },
  { match: /bounty_?hunter/, carry: 'rifle', classes: ['carbine', 'rifle'], prefer: ['ee3', 'bounty', 'dh17'] },
  { match: /mandalorian/, carry: 'rifle', classes: ['carbine', 'rifle', 'pistol'], prefer: ['mandalorian'] },
  { match: /clone|republic/, carry: 'rifle', classes: ['rifle', 'carbine'], prefer: ['dc15', 'republic'] },
  { match: /storm|trooper|imperial_(soldier|army|marine|private|corporal|sergeant)|swamp|coastal|scout|commando|assault|marine|soldier|guard/, carry: 'rifle', classes: ['rifle', 'carbine'], prefer: ['e11', 'dlt20', 't21', 'dh17'] },
  // Officers before the rest of their side: a rebel officer carries a sidearm, not the troops' rifle.
  { match: /officer|captain|lieutenant|colonel|general|major|admiral|moff|commander/, carry: 'pistol', classes: ['pistol'], prefer: ['dl44', 'dh17', 'de_10', 'power5'] },
  { match: /rebel|alliance|resistance/, carry: 'rifle', classes: ['rifle', 'carbine'], prefer: ['a280', 'dh17', 'rebel'] },
  { match: /wookiee|wke/, carry: 'rifle', classes: ['carbine', 'rifle'], prefer: ['bowcaster'] },
  { match: /trandoshan|trando/, carry: 'rifle', classes: ['rifle', 'carbine'], prefer: ['trando'] },
  { match: /jawa/, carry: 'rifle', classes: ['rifle', 'pistol'], prefer: ['jawa'] },
  { match: /ewok/, carry: 'rifle', classes: ['rifle'], prefer: ['ewok_crossbow'] },
  { match: /geonosian/, carry: 'pistol', classes: ['pistol'], prefer: ['geonosian'] },
  { match: /corsec/, carry: 'pistol', classes: ['pistol', 'carbine'], prefer: ['cdef_corsec', 'cdef'] },
  { match: /hunter|tracker|poacher|mercenary|hired_gun|gunner/, carry: 'rifle', classes: ['rifle', 'carbine'], prefer: ['dlt20', 'e11', 'laser'] },
  { match: /noble|smuggler|pirate|thug|gangster|hutt|black_?sun|merchant|agent|spy|thief|scoundrel|bandit|criminal|slicer|informant/, carry: 'pistol', classes: ['pistol'], prefer: ['dl44', 'dh17', 'de_10', 'power5', 'cdef'] },
];

/** Weapons a random pick leaves out: quest and new-player copies, decorations, and the exotic ones whose shot is a beam or a flame. */
export const NOT_RANDOM = /_static$|_npe$|_noob$|(^|_)quest(_|$)|decorative|flame|lightning|acid|beam|launcher|flare|eweb|geo_drill|spraystick|crossbow|heroic|pvp|ep3_loot|event_|avatar|love_day|jinkins|massassi|training|ion_stunner|carbonite/;

/** The first hint that matches an id, or null. */
export function hintFor(id: string): WeaponHint | null {
  const lower = id.toLowerCase();
  for (const h of WEAPON_HINTS) if (h.match.test(lower)) return h;
  return null;
}

/**
 * The hint for an entry: a dressed NPC's species first (`wookiee_male` a bowcaster, `trandoshan_*`
 * the hunting rifle, whatever its job: most dressed Wookiees and Trandoshans are named for their
 * job, not their species, and a Wookiee guard still carries a bowcaster), then its template id (a
 * trooper, an officer, a smuggler), then a person's own appearance. The human species name no row.
 */
export function hintForEntry(entry: Pick<MobileEntry, 'id' | 'species' | 'appearance'>): WeaponHint | null {
  return (entry.species ? hintFor(entry.species) : null) ?? hintFor(entry.id) ?? (entry.appearance ? hintFor(entry.appearance) : null);
}

/**
 * The droids that carry a gun in the hand: the assassin and bounty-hunter droids (IG-88's body,
 * 4-LOM, HK) and the battle droids. Every other droid on the humanoid skeleton (a protocol droid,
 * a surgical droid, a pit droid) is not armed off the rack, by its id or its appearance.
 */
export const ARMED_DROID = /battle|(^|[_/])b1(_|$)|super_?battle|commando|assassin|droideka|(^|[_/])hk_?\d|(^|[_/])ig_?\d|4_?lom/;

/** Whether a droid holds a weapon off the rack (only the combat droids do). */
export function droidArmed(entry: Pick<MobileEntry, 'id' | 'appearance'>): boolean {
  return ARMED_DROID.test(entry.id.toLowerCase()) || ARMED_DROID.test((entry.appearance ?? '').toLowerCase());
}

/**
 * What kind of weapon a pick is for: a gun of a carry, a lightsaber, or a blade, a club, a staff or a
 * fist weapon, each held in the carry its class fights in (`armsKindOf`).
 */
export type ArmsKind =
  | { kind: 'gun'; carry: 'pistol' | 'rifle'; classes: WeaponClass[]; prefer: string[] }
  | { kind: 'saber'; classes: WeaponClass[]; prefer: string[] }
  | { kind: 'melee'; carry: 'sword' | 'sword2h' | 'polearm' | 'unarmed'; classes: WeaponClass[]; prefer: string[] };

/** A Jedi, a Sith, a Dark Jedi or an Inquisitor by its id: it carries a lightsaber and fights with it. */
export function wantsSaber(id: string): boolean {
  return /(^|[_/])(jedi|sith|inquisitor)(?=[_/]|$)/.test(id.toLowerCase());
}

/**
 * Whether a body may hold anything off the rack at all: a person (the `all_b` skeleton, which has the
 * hand's weapon joint), never a hologram, a droid only when it is a combat droid (`droidArmed`), and
 * never one whose temper is `passive` -- a vendor or a trainer that never fights does not stand behind
 * its counter with a rifle in its hands, whatever its creature's list says it could fight with.
 */
export function mayHoldWeapon(entry: Pick<MobileEntry, 'id' | 'kind' | 'appearance' | 'flags'>, hierarchy: string, aggression: string | null | undefined): boolean {
  if (hierarchy !== 'all_b') return false;
  if ((entry.flags ?? []).includes('hologram')) return false;
  if (entry.kind === 'droid' && !droidArmed(entry)) return false;
  return aggression !== 'passive';
}

/** A weapon slot that says the body fights with its hands. */
export const UNARMED = 'unarmed';

/**
 * The templates one of a creature's weapons stands for, as the emulator wrote them: a group's name is
 * its whole list, a template is itself, `unarmed` is itself, and a name no group carries (a creature's
 * built-in spit is written as its template and the rack has none) comes to nothing.
 */
export function slotTemplates(slot: string, groups: Readonly<Record<string, readonly string[]>> | null | undefined): readonly string[] {
  if (slot === UNARMED) return [UNARMED];
  const g = groups && Object.prototype.hasOwnProperty.call(groups, slot) ? groups[slot] : undefined;
  if (Array.isArray(g)) return g;
  return /^object\/weapon\/.+\.iff$/i.test(slot) ? [slot] : [];
}

/**
 * The rack's spellings of one of the server's templates, in the order tried: its client template (the
 * rack keeps each weapon under its `shared_` name, the server writes the other), then, for the server's
 * own `_ranged` copies of a blade -- a Dark Jedi's sword that also shoots -- the blade they copy, which
 * the client never had a template for.
 */
export function rackTemplates(template: string): string[] {
  const m = /^(.*\/)(?:shared_)?([^/]+)\.iff$/.exec(template.toLowerCase().replace(/\\/g, '/'));
  if (!m) return [];
  const out = [`${m[1]}shared_${m[2]}.iff`];
  const plain = m[2].replace(/_ranged$/, '');
  if (plain !== m[2]) out.push(`${m[1]}shared_${plain}.iff`);
  return out;
}

/** A rack by its templates, made once per rack. */
const racksByTemplate = new WeakMap<readonly { template: string }[], Map<string, { template: string }>>();

/** What a body's own creature's weapons came to: the weapon off the rack, or empty hands, and which template it was. */
export interface OwnWeapon<W> {
  def: W | null;
  unarmed: boolean;
  template: string;
}

/**
 * What a body holds from its own creature's weapons, which the emulator wrote as its first and its
 * second (`weapons` on the pack's creature): the first that comes to anything on this rack, and one of
 * that slot's list drawn by `rand`, as the server drew one of a group's templates for each body it
 * stood. `unarmed` drawn is empty hands, and so is a first slot that says so outright -- the server's
 * word that this one fights with its fists is never overruled by a guess from its name. A slot whose
 * every template the rack has not got is stepped over (a creature's spit, a probe droid's own gun).
 *
 * Null when neither slot comes to anything at all: the caller falls back on the guess from the body's
 * name (`armsFor`), which is what every body stood before the rows carried weapons still is.
 */
export function ownWeapon<W extends { template: string }>(weapons: readonly string[] | null | undefined, groups: Readonly<Record<string, readonly string[]>> | null | undefined, rack: readonly W[], rand: () => number = Math.random): OwnWeapon<W> | null {
  if (!weapons?.length) return null;
  let byTemplate = racksByTemplate.get(rack) as Map<string, W> | undefined;
  if (!byTemplate) {
    byTemplate = new Map(rack.map((w) => [w.template.toLowerCase(), w]));
    racksByTemplate.set(rack, byTemplate);
  }
  for (const slot of weapons) {
    const options: (W | typeof UNARMED)[] = [];
    const names: string[] = [];
    for (const t of slotTemplates(slot, groups)) {
      if (t === UNARMED) {
        options.push(UNARMED);
        names.push(UNARMED);
        continue;
      }
      let hit: W | undefined;
      for (const k of rackTemplates(t)) if ((hit = byTemplate.get(k))) break;
      if (hit) {
        options.push(hit);
        names.push(t);
      }
    }
    if (!options.length) continue;
    const i = Math.min(options.length - 1, Math.floor(rand() * options.length));
    const pick = options[i];
    return pick === UNARMED ? { def: null, unarmed: true, template: UNARMED } : { def: pick, unarmed: false, template: names[i] };
  }
  return null;
}

/**
 * How a weapon off the rack is held, by its class: a pistol in the pistol's carry, every long gun in the
 * rifle's, a lightsaber as the blades are, a knife, a sword or a club in the one-handed blade's carry, a
 * two-handed sword or an axe in its own, a staff or a lance in the polearm's, and a fist weapon in the
 * body's own unarmed guard. Null for what is not held to fight (a grenade, an instrument, a prop).
 */
export function armsKindOf(cls: WeaponClass): ArmsKind | null {
  switch (cls) {
    case 'pistol':
      return { kind: 'gun', carry: 'pistol', classes: [cls], prefer: [] };
    case 'carbine':
    case 'rifle':
    case 'heavy':
      return { kind: 'gun', carry: 'rifle', classes: [cls], prefer: [] };
    case 'lightsaber':
    case 'lightsaber2h':
    case 'lightsaberStaff':
      return { kind: 'saber', classes: [cls], prefer: [] };
    case 'knife':
    case 'sword1h':
      return { kind: 'melee', carry: 'sword', classes: [cls], prefer: [] };
    case 'sword2h':
      return { kind: 'melee', carry: 'sword2h', classes: [cls], prefer: [] };
    case 'polearm':
      return { kind: 'melee', carry: 'polearm', classes: [cls], prefer: [] };
    case 'fist':
      return { kind: 'melee', carry: 'unarmed', classes: [cls], prefer: [] };
    default:
      return null;
  }
}

/**
 * What an entry is armed with by the guess from its name, or null for nothing off the rack: what a body
 * whose own creature names no weapon this rack has falls back on (`ownWeapon` comes first). Only a body
 * that may hold anything at all (`mayHoldWeapon`) is armed. A Jedi gets a lightsaber; anyone else a gun
 * only when the catalogue gives it a ranged attack, its pack has a ranged clip held as a pistol or a
 * rifle, and it would ever fight.
 */
export function armsFor(entry: Pick<MobileEntry, 'id' | 'kind' | 'species' | 'appearance' | 'flags' | 'stats'>, hierarchy: string, roles: Pick<Roles, 'ranged'>, roleSources?: Record<string, string>): ArmsKind | null {
  if (!mayHoldWeapon(entry, hierarchy, null)) return null;
  if (wantsSaber(entry.id)) return { kind: 'saber', classes: ['lightsaber'], prefer: ['one_handed_gen', 'one_handed_s'] };
  if (entry.stats?.aggression === 'passive' || !entry.stats?.ranged || !(entry.stats.ranged.range > 0)) return null;
  const held = gunKindForRoles(roleSources, roles);
  if (held !== 'pistol' && held !== 'rifle') return null;
  const hint = hintForEntry(entry);
  if (hint) return { kind: 'gun', carry: hint.carry, classes: hint.classes, prefer: hint.prefer };
  return { kind: 'gun', carry: held, classes: held === 'pistol' ? ['pistol'] : ['rifle', 'carbine'], prefer: [] };
}

/** A body's ranged attack as its numbers carry it: how far it shoots, and whether its shot is laid over its stance. */
export interface RangedStat {
  range: number;
  additive: boolean;
}

/**
 * How far a gun its own creature's list put in its hand shoots when its own numbers give it no ranged
 * attack at all: the converter's `CORE3_MAP.range`, the very 20 m every creature it does count as a
 * shooter is given (`core3StatsFor` in `tools/swg/mobiles.mjs`; arms.test.ts reads that table so the
 * two stay one number).
 */
export const OWN_GUN_RANGE = 20;

/** What a body's own creature says it fights with and how, over its body's catalogue entry. */
export interface OwnArms {
  /** Its weapons, first and second, as the emulator wrote them, and the groups those names stand for. */
  weapons?: readonly string[];
  groups?: Readonly<Record<string, readonly string[]>> | null;
  /** Its temper, where its own numbers say. */
  aggression?: MobileAggression;
  /** Its ranged attack: left out is its body's, null is none at all. */
  ranged?: RangedStat | null;
  /**
   * A weapon chosen for it from the console (`__debug.mobile(.., { weapon })`), by the rack's own
   * template: held whatever its own list, its name or its temper would have given it. Only a body with
   * a hand to hold it takes it (the humanoid skeleton), and only a thing that is fought with.
   */
  forcedTemplate?: string;
}

/**
 * A weapon off the rack by what somebody typed: its id exactly, its template (whole, then by its file's
 * name with or without `shared_`), the game's own name exactly, then an id and then a name holding the
 * text. Of several that hold it, the plainest: one the game used for a quest, a decoration, an event or
 * never at all (`donotuse`) last, as the rack's own random draw leaves them out, and then the shortest
 * id, which is the plain model rather than one of its variants (`dl44` is the DL-44, not the DL-44 XT).
 * Null when nothing matches.
 */
export function findRackWeapon<W extends { id: string; template: string; name?: string | null }>(rack: readonly W[], text: string): W | null {
  const q = text.trim().toLowerCase().replace(/\\/g, '/');
  if (!q) return null;
  const fileOf = (t: string) => t.toLowerCase().replace(/\\/g, '/').replace(/^.*\//, '').replace(/^shared_/, '').replace(/\.iff$/, '');
  const own = fileOf(q);
  const odd = (w: W) => (NOT_RANDOM.test(w.id) || /donotuse/.test(w.id) ? 1 : 0);
  /** The plainest of those `holds` accepts, or null. */
  const plainest = (holds: (w: W) => boolean): W | null => {
    let best: W | null = null;
    for (const w of rack) {
      if (!holds(w)) continue;
      if (!best) best = w;
      else {
        const d = odd(w) - odd(best) || w.id.length - best.id.length || (w.id < best.id ? -1 : w.id > best.id ? 1 : 0);
        if (d < 0) best = w;
      }
    }
    return best;
  };
  return (
    rack.find((w) => w.id.toLowerCase() === q) ??
    rack.find((w) => w.template.toLowerCase() === q) ??
    plainest((w) => fileOf(w.template) === own) ??
    // A name is often shared (fifteen of the rack's weapons are called plain "Lightsaber", the game's
    // two never-used ranged copies first among them), so even an exact one takes the plainest.
    plainest((w) => (w.name ?? '').toLowerCase() === q) ??
    plainest((w) => w.id.toLowerCase().includes(q)) ??
    plainest((w) => (w.name ?? '').toLowerCase().includes(q))
  );
}

/**
 * Why a body cannot be stood holding a chosen weapon, in words, or '' when it can: a creature or a droid
 * not on the humanoid skeleton has no hand to hold anything (the weapon would have no bone to hang on),
 * and a grenade, an instrument or a dancer's prop is not a thing a body fights with.
 */
export function forcedArmsRefusal(entryName: string, hierarchy: string | null | undefined, weapon: { id: string; class: WeaponClass }): string {
  if (hierarchy !== 'all_b') return `a ${entryName} has no hand to hold anything: only a body on the humanoid skeleton carries a weapon`;
  if (!armsKindOf(weapon.class)) return `${weapon.id} (${weapon.class}) is not something a body fights with`;
  return '';
}

/** How a weapon is handed to the body: one shot from, a lightsaber, or one swung and never shot from. */
export type HoldKind = 'gun' | 'saber' | 'melee';

/** How an arms choice is handed over (`MobileEquipment.kind`): only a gun is ever shot from. */
export function holdOf(choice: ArmsKind): HoldKind {
  return choice.kind;
}

/** What a body is armed with: the kind, the weapon its own list drew, how it is held, and what shooting the gun gives it. */
export interface ArmsDecision<W> {
  choice: ArmsKind;
  /** The weapon its own creature's list drew; null where the guess from its name chose the kind and the rack picks one (`chooseWeapon`). */
  weapon: W | null;
  hold: HoldKind;
  /**
   * The ranged attack the gun in its hand gives it where its own numbers give it none. The converter
   * decided whether a creature shoots from its weapon groups' *names*, and `jawa_weaker_weapons`,
   * `corsec_police_weapons` and `stormtrooper_weapons` name no gun although every template in them is
   * one; left at that, 109 creatures on 456 standing rows over the converted worlds raised a gun they
   * could never fire and walked in to punch (every Jawa, and the CorSec troopers, who shot before).
   * Absent whenever its own numbers already shoot, or it holds no gun.
   */
  ranged?: RangedStat;
}

/**
 * What a body the world stands holds, decided in full: its own creature's weapons first (`ownWeapon`),
 * empty hands where that list says so or where it never fights (`mayHoldWeapon`), and the guess from
 * its name (`armsFor`) only where the list names nothing on this rack -- judged on its own creature's
 * temper and ranged attack where the row has them, rather than whoever else once wore this body, which
 * is what kept a town's trainers and guards from opening fire on everybody walking in. A gun its own
 * list drew always comes with a ranged attack to fire it with (`ArmsDecision.ranged`). Null for empty
 * hands. `rand` draws the weapon out of its list; a body stood from a seed draws it from that.
 */
export function decideArms<W extends { template: string; class: WeaponClass }>(
  entry: Pick<MobileEntry, 'id' | 'kind' | 'species' | 'appearance' | 'flags' | 'stats'>,
  hierarchy: string,
  roles: Pick<Roles, 'ranged' | 'rangedAdditive'>,
  roleSources: Record<string, string> | undefined,
  own: OwnArms | null | undefined,
  rack: readonly W[] | null,
  rand: () => number = Math.random,
): ArmsDecision<W> | null {
  if (hierarchy !== 'all_b') return null;
  // One the console chose: held whatever its own list, its name or its temper say, and drawing nothing
  // from `rand`, so the colour and the style a seed draws afterwards are the ones it always drew.
  if (own?.forcedTemplate) {
    const def = rack?.find((w) => w.template === own.forcedTemplate) ?? null;
    const choice = def ? armsKindOf(def.class) : null;
    if (!def || !choice) return null;
    const out: ArmsDecision<W> = { choice, weapon: def, hold: holdOf(choice) };
    if (choice.kind === 'gun') {
      const shoots = own.ranged !== undefined ? own.ranged : (entry.stats?.ranged ?? null);
      if (!(shoots && shoots.range > 0)) out.ranged = { range: OWN_GUN_RANGE, additive: !!roles.rangedAdditive };
    }
    return out;
  }
  const mine = own?.weapons?.length && rack ? ownWeapon(own.weapons, own.groups ?? null, rack, rand) : null;
  if (mine) {
    if (mine.unarmed || !mine.def || !mayHoldWeapon(entry, hierarchy, own?.aggression ?? entry.stats?.aggression)) return null;
    const choice = armsKindOf(mine.def.class);
    if (!choice) return null;
    const out: ArmsDecision<W> = { choice, weapon: mine.def, hold: holdOf(choice) };
    if (choice.kind === 'gun') {
      const shoots = own && own.ranged !== undefined ? own.ranged : (entry.stats?.ranged ?? null);
      if (!(shoots && shoots.range > 0)) out.ranged = { range: OWN_GUN_RANGE, additive: !!roles.rangedAdditive };
    }
    return out;
  }
  const judged =
    own && (own.aggression !== undefined || own.ranged !== undefined)
      ? { ...entry, stats: { ...entry.stats, aggression: own.aggression ?? entry.stats.aggression, ranged: own.ranged !== undefined ? own.ranged : entry.stats.ranged } }
      : entry;
  const choice = armsFor(judged, hierarchy, roles, roleSources);
  return choice ? { choice, weapon: null, hold: holdOf(choice) } : null;
}

/**
 * The weapon off the rack for an arms choice: of its classes, the first preferred fragment that
 * any weapon's id holds (a random one of those), else a random weapon of the first class that
 * has any once the quest, new-player and exotic ones are left out. `rand` is `Math.random` in the
 * game and fixed in the tests. Null when the rack has nothing of the kind.
 */
export function chooseWeapon<W extends { id: string; class: WeaponClass }>(arms: ArmsKind, rack: readonly W[], rand: () => number = Math.random): W | null {
  const pick = <T>(list: T[]): T | null => (list.length ? list[Math.min(list.length - 1, Math.floor(rand() * list.length))] : null);
  const ofClass = rack.filter((w) => arms.classes.includes(w.class) && !/_static$|_npe$|_noob$/.test(w.id));
  for (const frag of arms.prefer) {
    const hits = ofClass.filter((w) => w.id.toLowerCase().includes(frag) && !/(^|_)quest(_|$)|decorative/.test(w.id));
    if (hits.length) return pick(hits);
  }
  for (const cls of arms.classes) {
    const plain = ofClass.filter((w) => w.class === cls && !NOT_RANDOM.test(w.id));
    if (plain.length) return pick(plain);
  }
  return pick(ofClass);
}

/** Which carry row an arms choice stands in. A lightsaber is the one-handed blade's carry. */
export function carryWeaponFor(arms: ArmsKind | null | undefined): CarryWeapon {
  if (!arms) return 'unarmed';
  return arms.kind === 'saber' ? 'sword' : arms.carry;
}

/**
 * One carry row laid over a pack's roles. The row is the converter's (`ALLB_CARRIES` in
 * `tools/swg/mobiles.mjs`) and says what the animation table says; this only decides which role
 * each of its fields is.
 *
 * Four things worth reading twice. The row drives the **combat** roles alone -- `idle`, `walk`,
 * `run` and `gaits` are left exactly as they were, so nothing about how fast a body walks about
 * moves and `moveSpeeds` reads the same numbers it always did. `ranged` takes a whole-body shot
 * where the table has one and falls back to the one-frame recoil where it has not, which is the
 * same choice `resolveRoles` makes and is what keeps a pack with nothing but a recoil behaving as
 * it does today. A blaster row leaves `attacks` alone: those are the melee swings a gunner throws
 * when something closes on it, and a row's `fires` are not them. And every field is allowed to be
 * missing: what a row is silent about is left where the pack's own roles put it, which is why a
 * rifle with a port-arms carry and no combat-stance branches comes out of this exactly as it goes
 * in today.
 */
export function rolesFromCarry(row: CarryRow): Partial<Roles> {
  const out: Partial<Roles> = {};
  const stance = row.ready ?? row.relaxed;
  if (stance) {
    out.rangedStance = stance;
    out.idleCombat = stance;
  }
  if (row.aimed) out.rangedAimed = row.aimed;
  if (row.gaits.length) {
    out.gaitsCombat = row.gaits;
    out.walkCombat = row.walk ?? row.gaits[0].clip;
    out.runCombat = row.run ?? row.gaits[row.gaits.length - 1].clip;
  }
  if (row.fires.length) {
    out.ranged = row.fires[0];
    out.rangedShots = row.fires;
    out.rangedAdditive = false;
  } else if (row.recoil) {
    out.ranged = row.recoil;
    out.rangedAdditive = true;
  }
  if (row.swings.length) out.attacks = row.swings;
  if (row.toCombat) out.toCombat = row.toCombat;
  if (row.fromCombat) out.fromCombat = row.fromCombat;
  return out;
}

/**
 * The roles that change for the weapon a body really holds: its carry row where the pack carries
 * one, and otherwise the clip-name matching this did before there were rows.
 *
 * The fallback is kept, not tidied away, because it is what every pack on a machine that has not
 * been reconverted still needs: it finds the rifle's port-arms stance, its held walk and run and
 * its recoil by matching clip names, and it has never had anything at all to say about a pistol, a
 * blade or an aimed pose. A pack with rows needs none of it. An empty object means "leave the
 * pack's roles exactly as they are", which is what a body whose weapon the table is silent about
 * must do.
 */
export function armedRoles(clips: readonly Pick<PackClipInfo, 'name' | 'speed' | 'additive'>[], carry: CarryWeapon, carries?: Partial<Record<CarryWeapon, CarryRow>> | null): Partial<Roles> {
  const row = carries?.[carry];
  if (row) return rolesFromCarry(row);
  if (carry !== 'rifle') return {};
  const find = (re: RegExp) => clips.find((c) => re.test(c.name));
  const idle = find(/rifle_a_standing_hold_idle|rifle.*standing.*idle/);
  const walk = find(/rifle_a_walk_hold|rifle.*walk/);
  const run = find(/rifle_a_run_held|rifle.*run/);
  const fire = find(/rifle_fire_1_add/) ?? find(/rifle.*fire.*add/);
  const out: Partial<Roles> = {};
  if (idle) {
    out.rangedStance = idle.name;
    out.idleCombat = idle.name;
  }
  if (fire) {
    out.ranged = fire.name;
    out.rangedAdditive = true;
  }
  const gaits = [walk, run].filter((c): c is NonNullable<typeof c> => !!c && c.speed > 0).map((c) => ({ clip: c.name, speed: c.speed }));
  if (gaits.length) {
    gaits.sort((a, b) => a.speed - b.speed);
    out.gaitsCombat = gaits;
    out.walkCombat = gaits[0].clip;
    out.runCombat = gaits[gaits.length - 1].clip;
  }
  return out;
}

/** Jedi Academy's one-hand swings, which the species rigs carry: a lightsaber-armed person swings these when one is loaded. */
export const SABER_SWINGS = ['BOTH_A1_T__B_', 'BOTH_A1__L__R', 'BOTH_A1__R__L', 'BOTH_A1_TL_BR', 'BOTH_A1_TR_BL', 'BOTH_A2_T__B_', 'BOTH_A2__L__R', 'BOTH_A2_TL_BR', 'BOTH_A3_T__B_', 'BOTH_A3_TR_BL'];

/** Every number a swing by anybody who is not the player has; all of them ours. */
export interface BladeSwingTune {
  /** Seconds a swing's blade is live. The timer it replaces landed its blow at 0.32 s. */
  window: number;
  /** What a fighter's lightsaber takes off. */
  fighterSaber: number;
  /** What a fighter's sword, axe or club takes off. */
  fighterMelee: number;
  /** The shove either gives. */
  fighterPush: number;
  /**
   * How near a foe had to stand for the blow the timer used to land. It is read only where a swing
   * can sweep nothing at all (no collider lookup was ever wired), which is the one case that would
   * otherwise leave every bladed body in the game harmless.
   */
  timerReach: number;
  /** The spark a sword or a club strikes off a body; a lightsaber's is its own blade's colour. */
  meleeSpark: number;
}

/**
 * A swing by anybody who is not the player: the fighters' and a blade-carrying body's. Their blows
 * used to land on a timer, at whatever stood within reach when it ran out; now the swing opens a
 * window over which the blade sweeps the ground it covers, so it can miss, can catch two bodies at
 * once, and takes one bite out of each. Every number here is ours, and the two damages and the
 * reach are exactly the ones the timer dealt before, so nothing about how hard a fighter hits has
 * moved. Live through `__debug.blades({ window: 0.2 })`.
 *
 * How thick a blade is has one home and it is not this one: it is `BLADE_RADIUS` in
 * `src/combat/sweep.ts`, which this file does not import because that one is three and rapier.
 */
export const BLADE_SWING: BladeSwingTune = {
  window: 0.32,
  fighterSaber: 32,
  fighterMelee: 18,
  fighterPush: 4,
  timerReach: 2.8,
  meleeSpark: 0xffd0a0,
};

/** Nothing here may go negative; a window of zero is a swing that lands nothing, which is legible. */
const BLADE_SWING_FLOOR: Record<keyof BladeSwingTune, number> = {
  window: 0,
  fighterSaber: 0,
  fighterMelee: 0,
  fighterPush: 0,
  timerReach: 0,
  meleeSpark: 0,
};

/** Move the tuning live, as `__debug.blades({ window: 0.2 })` does; returns what is in force. */
export function tuneBladeSwing(opts?: Partial<BladeSwingTune> | null): BladeSwingTune {
  if (!opts) return BLADE_SWING;
  for (const key of Object.keys(BLADE_SWING) as (keyof BladeSwingTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) BLADE_SWING[key] = Math.max(BLADE_SWING_FLOOR[key], v);
  }
  // A colour is a whole number inside a byte apiece, whatever was typed at it.
  BLADE_SWING.meleeSpark = Math.max(0, Math.min(0xffffff, Math.floor(BLADE_SWING.meleeSpark)));
  return BLADE_SWING;
}

/**
 * What everybody else's blades did, for `__debug.blades()`. Numbers only, written as the swings
 * run. It is deliberately **not** `SABER_HIT_STATS`: that record is the player's swing and there is
 * one of it, and the player's blades and everybody else's are swept at two different simulated
 * seconds of the same drawn frame (the loop sweeps the player before the clock moves and the
 * fighters after), so anything written into it from here would zero the player's own figures every
 * frame and count a fighter's cut as the player's.
 */
export const BLADE_SWING_STATS = {
  /** The last simulated second a blade that is not the player's was swept, and what that frame cost. */
  at: -Infinity,
  blades: 0,
  casts: 0,
  /** The most sub-steps any one of them took that frame, and the furthest any one had travelled. */
  steps: 0,
  travel: 0,
  fresh: 0,
  hits: 0,
  /** Since the page loaded: swings opened, bodies cut, swings that opened with no lookup to cut with. */
  swings: 0,
  cuts: 0,
  blind: 0,
  /** Swings that landed the old timer's blow because nothing could be swept. */
  fellBack: 0,
  /** Whether a collider lookup is wired now: with none, no swing can find anybody. */
  wired: false,
};

/** One blade, swept: what it cost this frame and what it cut. */
export function noteBladeSwept(now: number, casts: number, steps: number, travel: number, fresh: number, hits: number): void {
  const s = BLADE_SWING_STATS;
  if (s.at !== now) {
    s.at = now;
    s.blades = 0;
    s.casts = 0;
    s.steps = 0;
    s.travel = 0;
    s.fresh = 0;
    s.hits = 0;
  }
  s.blades++;
  s.casts += casts;
  if (steps > s.steps) s.steps = steps;
  if (travel > s.travel) s.travel = travel;
  s.fresh += fresh;
  s.hits += hits;
  s.cuts += hits;
}

/** A swing opened; `blind` when there was no lookup for it to find anybody with. */
export function noteBladeSwing(blind: boolean): void {
  BLADE_SWING_STATS.swings++;
  if (blind) BLADE_SWING_STATS.blind++;
}

/** A swing that could sweep nothing landed the blow the timer used to land instead. */
export function noteTimerBlow(): void {
  BLADE_SWING_STATS.fellBack++;
}

/** Whether anything can be found to cut at all; written every frame by whoever holds the lookup. */
export function noteBladeLookup(wired: boolean): void {
  BLADE_SWING_STATS.wired = wired;
}

/** The player's frame figures, set aside while one of everybody else's blades borrows the record. */
const LENT = { at: 0, blades: 0, casts: 0, steps: 0, travel: 0, fresh: 0, hits: 0 };

/**
 * Put the player's figures aside and zero the shared record, so that what the sweep about to run
 * writes into it is this one blade's and nobody else's. `now` goes in as well, so the sweep's own
 * `saberFrameStart` finds the frame it is already at and zeroes nothing under us.
 *
 * Always in a `try`, with `returnSwingFigures` in the `finally`: a throw between the two would
 * leave the player's readout holding one fighter's swing for good.
 */
export function borrowSwingFigures(now: number): void {
  const s = SABER_HIT_STATS;
  LENT.at = s.at;
  LENT.blades = s.blades;
  LENT.casts = s.casts;
  LENT.steps = s.steps;
  LENT.travel = s.travel;
  LENT.fresh = s.fresh;
  LENT.hits = s.hits;
  s.at = now;
  s.blades = 0;
  s.casts = 0;
  s.steps = 0;
  s.travel = 0;
  s.fresh = 0;
  s.hits = 0;
}

/** Take what that one blade wrote into our own figures, and put the player's back exactly as found. */
export function returnSwingFigures(now: number): void {
  const s = SABER_HIT_STATS;
  noteBladeSwept(now, s.casts, s.steps, s.travel, s.fresh, s.hits);
  s.at = LENT.at;
  s.blades = LENT.blades;
  s.casts = LENT.casts;
  s.steps = LENT.steps;
  s.travel = LENT.travel;
  s.fresh = LENT.fresh;
  s.hits = LENT.hits;
}

const r3 = (v: number): number => (Number.isFinite(v) ? Number(v.toFixed(3)) : v);

/**
 * The readout behind `__debug.blades()`: what everybody else's blades cost last frame, what they
 * have done since the page loaded, whether they can find anybody at all, and the tuning. Passing
 * any of the tuning's numbers moves them first. Console only, so it may allocate.
 */
export function bladeSwingReport(opts?: Partial<BladeSwingTune> | null): {
  frame: { at: number; blades: number; casts: number; steps: number; travel: number; fresh: number; hits: number };
  total: { swings: number; cuts: number; blind: number; fellBack: number };
  lookup: string;
  tune: BladeSwingTune;
} {
  if (opts) tuneBladeSwing(opts);
  const s = BLADE_SWING_STATS;
  return {
    frame: { at: r3(s.at), blades: s.blades, casts: s.casts, steps: s.steps, travel: r3(s.travel), fresh: s.fresh, hits: s.hits },
    total: { swings: s.swings, cuts: s.cuts, blind: s.blind, fellBack: s.fellBack },
    lookup: s.wired ? 'wired' : 'none (npcDeps.hittableAt is not set: every swing falls back on the old timer blow)',
    tune: { ...BLADE_SWING },
  };
}

/**
 * The far end of a weapon held in the hand, in the model's own frame: the extreme of its longest
 * extent, which is the barrel or the blade. The manifest's min and max come swapped from some
 * packs, so the extents are taken as sizes and never by which corner is which; with no bounds at
 * all it is the weapon's own length up the model's Y, as the rack reads it for the player's hand.
 * Which axis the length lies along, and how far along it the far end is from the grip.
 */
export function weaponFarPoint(bounds: { min: number[]; max: number[] } | null | undefined, length: number): { axis: number; distance: number } {
  if (!bounds || bounds.min.length < 3 || bounds.max.length < 3) return { axis: 1, distance: length };
  let axis = 0;
  let widest = -1;
  for (let i = 0; i < 3; i++) {
    const extent = Math.abs(bounds.max[i] - bounds.min[i]);
    if (extent > widest) {
      widest = extent;
      axis = i;
    }
  }
  const far = bounds.max[axis];
  const near = bounds.min[axis];
  return { axis, distance: Math.abs(far) >= Math.abs(near) ? far : near };
}

/** The bone a body's own shot leaves from, in the order tried: a gun's muzzle or the hand's weapon joint, else the mouth or the head. */
export const MUZZLE_PATTERNS: readonly RegExp[] = [/muzzle|barrel|gun|weapon|hold_r/i, /jaw|mouth|head/i];

/** The name of the bone a body's own shot leaves from, from the names of its bones (patterns in order), or null. */
export function muzzleBone(names: Iterable<string>): string | null {
  const list = [...names];
  for (const re of MUZZLE_PATTERNS) for (const n of list) if (re.test(n)) return n;
  return null;
}
