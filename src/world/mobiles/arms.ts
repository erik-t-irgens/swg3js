// What a person from the catalogue fights with: a blaster off the rack in the hand when its pack
// shoots, a lightsaber when it is a Jedi, and which of the pack's clips carry the gun. A droid's
// or a creature's ranged attack is its own (a built-in blaster, a spit) and takes no model; its
// shot leaves from a muzzle bone found by name.
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
import type { MobileEntry, PackClipInfo, Roles } from './types';
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

/** What kind of weapon a pick is for: a gun of a carry, or a lightsaber. */
export type ArmsKind = { kind: 'gun'; carry: 'pistol' | 'rifle'; classes: WeaponClass[]; prefer: string[] } | { kind: 'saber'; classes: WeaponClass[]; prefer: string[] };

/** A Jedi, a Sith, a Dark Jedi or an Inquisitor by its id: it carries a lightsaber and fights with it. */
export function wantsSaber(id: string): boolean {
  return /(^|[_/])(jedi|sith|inquisitor)(?=[_/]|$)/.test(id.toLowerCase());
}

/**
 * What an entry is armed with, or null for nothing off the rack. Only people (the `all_b`
 * skeleton, which has the hand's weapon joint) are armed; a hologram never is, nor a droid that
 * is not a combat droid (`droidArmed`). A Jedi gets a lightsaber; anyone else a gun only when the
 * catalogue gives it a ranged attack, its pack has a ranged clip held as a pistol or a rifle, and
 * it would ever fight.
 */
export function armsFor(entry: Pick<MobileEntry, 'id' | 'kind' | 'species' | 'appearance' | 'flags' | 'stats'>, hierarchy: string, roles: Pick<Roles, 'ranged'>, roleSources?: Record<string, string>): ArmsKind | null {
  if (hierarchy !== 'all_b') return null;
  if ((entry.flags ?? []).includes('hologram')) return null;
  if (entry.kind === 'droid' && !droidArmed(entry)) return null;
  if (wantsSaber(entry.id)) return { kind: 'saber', classes: ['lightsaber'], prefer: ['one_handed_gen', 'one_handed_s'] };
  if (entry.stats?.aggression === 'passive' || !entry.stats?.ranged || !(entry.stats.ranged.range > 0)) return null;
  const held = gunKindForRoles(roleSources, roles);
  if (held !== 'pistol' && held !== 'rifle') return null;
  const hint = hintForEntry(entry);
  if (hint) return { kind: 'gun', carry: hint.carry, classes: hint.classes, prefer: hint.prefer };
  return { kind: 'gun', carry: held, classes: held === 'pistol' ? ['pistol'] : ['rifle', 'carbine'], prefer: [] };
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

/**
 * The roles that change when a gun is held as a rifle: the pack's rifle stance, its walk and run
 * with the rifle held (at their own ground speeds), and the rifle's recoil as the ranged pulse.
 * A pistol keeps the pack's roles as they are (its stance and recoil are what `ranged` already
 * names). Only clips the pack holds are named; an empty object when it has none of them.
 */
export function armedRoles(clips: readonly Pick<PackClipInfo, 'name' | 'speed' | 'additive'>[], carry: 'pistol' | 'rifle'): Partial<Roles> {
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
