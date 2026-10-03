// What a body the world stands holds: its own creature's weapons first (the emulator's weapon groups,
// mapped onto this game's rack), and the guess from its name only where they name nothing the rack has.
//
// The rules are `src/world/mobiles/arms.ts` and are pure, so they are driven here with a rack and a
// fleet written by hand. Where the real packs are converted the same rules are then run over every
// creature the spawns pack names against the real rack, which is the only way to know how much of the
// emulator's arming this game can really show.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OWN_GUN_RANGE, UNARMED, armsKindOf, carryWeaponFor, decideArms, mayHoldWeapon, ownWeapon, rackTemplates, slotTemplates, type OwnArms } from '../../../src/world/mobiles/arms.ts';
import { overridesOf, weaponsOf, type PeopleCreature, type StandingRow } from '../../../src/world/standingPeople.ts';
import type { WeaponClass } from '../../../src/player/weapons.ts';
import type { MobileEntry } from '../../../src/world/mobiles/types.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

type W = { id: string; template: string; class: WeaponClass };
const w = (id: string, dir: string, cls: WeaponClass): W => ({ id, template: `object/weapon/${dir}/shared_${id}.iff`, class: cls });
const rack: W[] = [
  w('knife_stone', 'melee/knife', 'knife'),
  w('lance_staff_wood_s1', 'melee/polearm', 'polearm'),
  w('lance_staff_wood_s2', 'melee/polearm', 'polearm'),
  w('sword_01', 'melee/sword', 'sword1h'),
  w('axe_heavy_duty', 'melee/2h_sword', 'sword2h'),
  w('vibroknuckler', 'melee/special', 'fist'),
  w('carbine_laser', 'ranged/carbine', 'carbine'),
  w('pistol_dl44', 'ranged/pistol', 'pistol'),
  w('rifle_tusken', 'ranged/rifle', 'rifle'),
  w('sword_lightsaber_one_handed_gen4', 'melee/sword/crafted_saber', 'lightsaber'),
  w('guitar', 'music', 'instrument'),
];
const groups: Record<string, string[]> = {
  primitive_weapons: ['object/weapon/melee/knife/knife_stone.iff', 'object/weapon/melee/polearm/lance_staff_wood_s1.iff', 'object/weapon/melee/polearm/lance_staff_wood_s2.iff'],
  pirate_unarmed: ['object/weapon/melee/special/vibroknuckler.iff', 'unarmed'],
  tusken_ranged: ['object/weapon/ranged/rifle/rifle_tusken.iff'],
  force_sword_ranged: ['object/weapon/melee/sword/crafted_saber/sword_lightsaber_one_handed_gen4_ranged.iff'],
  creature_things: ['object/weapon/ranged/creature/creature_spit_small_green.iff'],
};
const at = (u: number) => () => u;

// ------------------------------------------------------------------ the server's spelling and the rack's
{
  ok(rackTemplates('object/weapon/melee/knife/knife_stone.iff')[0] === 'object/weapon/melee/knife/shared_knife_stone.iff', "a server template is looked for under the client's shared name");
  ok(rackTemplates('object/weapon/melee/knife/shared_knife_stone.iff').length === 1, 'and one already spelt that way is itself');
  const ranged = rackTemplates('object/weapon/melee/sword/sword_01_ranged.iff');
  ok(ranged.length === 2 && ranged[1] === 'object/weapon/melee/sword/shared_sword_01.iff', "the server's own ranged copy of a blade is the blade it copies, which the client never had a template for");
  ok(rackTemplates('not a template').length === 0, 'and something that is not a template is nothing');
  ok(slotTemplates('primitive_weapons', groups).length === 3 && slotTemplates(UNARMED, groups)[0] === UNARMED, "a group's name is its whole list, and `unarmed` is itself");
  ok(slotTemplates('object/weapon/ranged/pistol/pistol_dl44.iff', groups).length === 1 && slotTemplates('droid_probot_ranged', groups).length === 0 && slotTemplates('__proto__', groups).length === 0, 'a template is itself, and a name no group carries is nothing, even one named like the language\'s own');
}

// ------------------------------------------------------------------ what a creature's own list comes to
{
  // A Tusken child's primitive weapons: a stone knife or one of two wooden staves, drawn as the server
  // drew one of the group's templates for each body it stood.
  const drawn = new Set([0, 0.34, 0.67, 0.99].map((u) => ownWeapon(['primitive_weapons', 'unarmed'], groups, rack, at(u))?.def?.id));
  ok(drawn.has('knife_stone') && drawn.has('lance_staff_wood_s1') && drawn.has('lance_staff_wood_s2') && drawn.size === 3, `primitive_weapons gives a knife or a staff from the rack (${[...drawn].join(', ')})`);
  const knife = ownWeapon(['primitive_weapons'], groups, rack, at(0))!;
  ok(knife.template === 'object/weapon/melee/knife/knife_stone.iff' && !knife.unarmed, 'and says which of the server\'s templates it was');

  const bare = ownWeapon(['unarmed'], groups, rack, at(0.5));
  ok(!!bare && bare.unarmed && bare.def === null, '`unarmed` gives nothing, and says so');
  ok(ownWeapon(['unarmed', 'tusken_ranged'], groups, rack, at(0.5))!.unarmed, 'a first slot that says fists is never overruled by a gun in the second');
  const mixed = new Set([0, 0.99].map((u) => ownWeapon(['pirate_unarmed'], groups, rack, at(u))!.def?.id ?? 'fists'));
  ok(mixed.has('vibroknuckler') && mixed.has('fists'), 'a group that holds `unarmed` beside a weapon draws either');
  ok(ownWeapon(['creature_things', 'tusken_ranged'], groups, rack, at(0))!.def?.id === 'rifle_tusken', "a first slot the rack has nothing of (a creature's spit) is stepped over for the second");
  ok(ownWeapon(['creature_things'], groups, rack, at(0)) === null && ownWeapon([], groups, rack) === null && ownWeapon(undefined, groups, rack) === null, 'and a list that comes to nothing at all leaves the body to the guess from its name');
  ok(ownWeapon(['force_sword_ranged'], groups, rack, at(0))!.def?.class === 'lightsaber', "a Dark Jedi's ranged sword is the lightsaber it copies");
  let same = true;
  for (let i = 0; i < 20; i++) {
    let s = i * 7 + 1;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    let t = i * 7 + 1;
    const r2 = () => ((t = (t * 16807) % 2147483647) / 2147483647);
    if (ownWeapon(['primitive_weapons'], groups, rack, r)?.def !== ownWeapon(['primitive_weapons'], groups, rack, r2)?.def) same = false;
  }
  ok(same, 'the same draws give the same weapon, so a body seeded from its key is armed alike in every browser');
}

// ------------------------------------------------------------------ how each is held
{
  const carry = (cls: WeaponClass) => carryWeaponFor(armsKindOf(cls));
  ok(carry('pistol') === 'pistol' && carry('carbine') === 'rifle' && carry('rifle') === 'rifle' && carry('heavy') === 'rifle', 'a pistol in the pistol carry, every long gun in the rifle carry');
  ok(carry('knife') === 'sword' && carry('sword1h') === 'sword' && carry('sword2h') === 'sword2h' && carry('polearm') === 'polearm', 'a knife and a sword in the blade carry, an axe in the two-handed one, a staff in the polearm one');
  ok(carry('fist') === 'unarmed' && armsKindOf('fist')?.kind === 'melee', "a knuckler is held in the body's own guard, and swung");
  ok(armsKindOf('lightsaber')?.kind === 'saber' && carry('lightsaber') === 'sword' && armsKindOf('lightsaberStaff')?.kind === 'saber', 'every lightsaber is a lightsaber');
  ok(armsKindOf('instrument') === null && armsKindOf('thrown') === null && armsKindOf('entertainer') === null && carryWeaponFor(null) === 'unarmed', 'an instrument, a grenade or a prop is not held to fight');
}

// ------------------------------------------------------------------ who may hold anything
{
  const person = { id: 'tusken_raider', kind: 'npc' as const, appearance: 'tusken', flags: [] as string[] };
  ok(mayHoldWeapon(person, 'all_b', 'aggressive'), 'a person on the humanoid skeleton may');
  ok(!mayHoldWeapon(person, 'creature_base', 'aggressive'), 'a creature may not, whatever its list says');
  ok(!mayHoldWeapon({ ...person, flags: ['hologram'] }, 'all_b', 'aggressive'), 'nor a hologram');
  ok(!mayHoldWeapon({ ...person, kind: 'droid', appearance: 'protocol_droid', id: '3po' }, 'all_b', 'defensive') && mayHoldWeapon({ ...person, kind: 'droid', appearance: 'ig88', id: 'ig88' }, 'all_b', 'defensive'), 'nor a droid that is not a combat droid');
  ok(!mayHoldWeapon(person, 'all_b', 'passive') && mayHoldWeapon(person, 'all_b', undefined), 'and nobody who never fights: a trainer stands behind its counter empty-handed');
}

// ------------------------------------------------------------------ the whole decision: what it holds, how, and whether it fires
{
  // A body as the catalogue has it: its entry's own numbers are some other creature's (the first the
  // catalogue met of every one drawn as this body), which is why the row's own come in `own`.
  const body = (over: Partial<MobileEntry['stats']> = {}, id = 'dressed_somebody'): Pick<MobileEntry, 'id' | 'kind' | 'species' | 'appearance' | 'flags' | 'stats'> =>
    ({ id, kind: 'npc', species: null, appearance: null, flags: [], stats: { source: 'x', sizeClass: 'medium', level: 10, hp: 100, damage: 10, reach: 1, aggression: 'defensive', ranged: null, attackCooldown: 1.6, tags: [], ...over } }) as never;
  const rolesShoot = { ranged: 'add_rifle_fire_1', rangedAdditive: true };
  const sources = { ranged: 'add_rifle_fire_1' };
  const own = (weapons: string[], over: Partial<OwnArms> = {}): OwnArms => ({ weapons, groups, ...over });
  const decide = (o: OwnArms | null, b = body(), u = 0, hierarchy = 'all_b') => decideArms(b, hierarchy, rolesShoot, sources, o, rack, at(u));

  // A knife, a staff and an axe from its own list are swung and never shot from: no gun, no range.
  const knife = decide(own(['primitive_weapons'], { aggression: 'aggressive', ranged: null }), body(), 0)!;
  const staff = decide(own(['primitive_weapons'], { aggression: 'aggressive', ranged: null }), body(), 0.5)!;
  ok(knife.hold === 'melee' && knife.weapon?.id === 'knife_stone' && knife.choice.kind === 'melee' && knife.ranged === undefined, 'a stone knife from its own list is held to swing, as a blade, with no shot');
  ok(staff.hold === 'melee' && staff.weapon?.class === 'polearm' && carryWeaponFor(staff.choice) === 'polearm' && staff.ranged === undefined, 'and a wooden staff in the polearm carry, likewise');
  groups.axe_weapons = ['object/weapon/melee/2h_sword/axe_heavy_duty.iff'];
  const axe = decide(own(['axe_weapons'], { aggression: 'aggressive', ranged: { range: 20, additive: false } }))!;
  ok(axe.hold === 'melee' && axe.weapon?.id === 'axe_heavy_duty' && axe.ranged === undefined, "and an axe even for a creature whose numbers say it shoots: the hand decides, and a swung weapon is never shot from");

  // A gun from its own list fires, whatever its numbers said of its group's name.
  const gunNull = decide(own(['tusken_ranged'], { aggression: 'aggressive', ranged: null }))!;
  ok(gunNull.hold === 'gun' && gunNull.weapon?.id === 'rifle_tusken' && gunNull.ranged?.range === OWN_GUN_RANGE, `a rifle from its own list with numbers that say it does not shoot is given the ${OWN_GUN_RANGE} m every shooter has, so it fires the gun it holds`);
  const gunOwn = decide(own(['tusken_ranged'], { ranged: { range: 32, additive: false } }))!;
  ok(gunOwn.hold === 'gun' && gunOwn.ranged === undefined, 'while one whose own numbers already shoot keeps them');
  const gunBody = decide(own(['tusken_ranged']), body({ ranged: null }))!;
  ok(gunBody.ranged?.range === OWN_GUN_RANGE, "and a row that says nothing of shooting, on a body that does not, is given it too");
  ok(decide(own(['tusken_ranged']), body({ ranged: { range: 25, additive: true } }))!.ranged === undefined, "but not one whose body's own entry shoots");
  const bladeRanged = decide(own(['force_sword_ranged'], { aggression: 'aggressive', ranged: null }))!;
  ok(bladeRanged.hold === 'saber' && bladeRanged.ranged === undefined, "a Dark Jedi's ranged sword is a lightsaber, held as one and never shot from");

  // Empty hands.
  ok(decide(own(['unarmed', 'tusken_ranged'], { aggression: 'aggressive' })) === null, 'a first slot of fists is empty hands');
  ok(decide(own(['tusken_ranged'], { aggression: 'passive' })) === null, 'a row that never fights holds nothing, whatever its list');
  ok(decide(own(['tusken_ranged'], { aggression: 'aggressive' }), body(), 0, 'creature_base') === null, 'and a creature holds nothing off the rack');

  // Its list names nothing on the rack: the guess from its name, judged on its own numbers.
  const trooper = body({ aggression: 'aggressive', ranged: { range: 20, additive: false } }, 'stormtrooper');
  ok(decide(own(['creature_things'], { ranged: null }), trooper) === null, "the guess arms nobody whose own numbers say it does not shoot, whatever its body's entry says");
  ok(decide(own(['creature_things'], { aggression: 'passive' }), trooper) === null, 'nor anybody whose own temper never fights');
  const guessed = decide(own(['creature_things'], { aggression: 'aggressive', ranged: { range: 20, additive: false } }), body({ ranged: null }, 'stormtrooper'))!;
  ok(guessed.hold === 'gun' && guessed.weapon === null && guessed.choice.kind === 'gun' && guessed.ranged === undefined, "while one whose own numbers shoot is armed by its name, on a body whose entry never did; the rack picks the gun");
  ok(decide(null, trooper)!.hold === 'gun' && decide(null, body({ ranged: null }, 'stormtrooper')) === null, 'and a body stood with no row of its own is judged on its entry, as every body stood before this was');

  // The converter's range and ours are one number.
  const mobiles = readFileSync(new URL('../mobiles.mjs', import.meta.url), 'utf8');
  const map = /export const CORE3_MAP = \{[^}]*\brange: (\d+(?:\.\d+)?)/.exec(mobiles);
  ok(!!map && Number(map[1]) === OWN_GUN_RANGE, `the range a held gun is given is the converter's own for every shooter (${map?.[1]} m)`);
}

// ------------------------------------------------------------------ the wiring, read as text
{
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const manager = src('world/mobiles/manager.ts');
  const mobile = src('world/mobiles/mobile.ts');
  // With the console's own choice beside them (`__debug.mobile(.., { weapon })`): on this browser's own
  // spawns, and on a body stood from one of the server's records that carries it, which every browser
  // stands alike. Never on a seeded body, which every browser arms from its own seed.
  ok(/const own: OwnArms = \{ weapons: opts\.weapons, groups: opts\.weaponGroups, aggression: opts\.overrides\?\.aggression, ranged: opts\.overrides\?\.ranged, forcedTemplate: forced \};/.test(manager) && /const forced = opts\.weaponTemplate && \(!opts\.worldId \|\| opts\.listed\) \? opts\.weaponTemplate : undefined;/.test(manager), "a body's own creature's weapons, temper and gun reach the decision");
  ok(/const decided = decideArms\(entry, packInfo\.hierarchy, roles, json\.roleSources, own, rack\?\.weapons \?\? null, rand\);\s*if \(!decided\) return null;/.test(manager), 'which the manager takes whole, drawn from its seed');
  ok(/const def = decided\.weapon \?\? \(rack \? chooseWeapon\(choice, rack\.weapons, rand\) : null\);/.test(manager), 'the weapon its list drew is the one it holds');
  ok(/kind: decided\.hold,\s*gun: decided\.hold === 'gun' \? \(GUNS\[gunTypeFor\(def, def\.class\)\] \?\? null\) : null,/.test(manager), 'handed over as it is held, and only a gun with a bolt');
  ok(/if \(decided\.ranged\) extras = \{ \.\.\.extras, ranged: decided\.ranged \};/.test(manager), 'and a gun its list drew brings its range with it');
  ok(/const ranged = this\.rangedStat && this\.rangedStat\.range > 0 \? this\.rangedStat : \(extras\?\.ranged \?\? null\);\s*this\.rangedRange = r\.ranged && !this\.hologram && ranged && ranged\.range > 0/.test(mobile), "which the body shoots with where its own numbers give it none");
  ok(/\} else if \(choice\.kind === 'saber'\) \{/.test(manager), 'and only a lightsaber is lent Jedi Academy\'s swings: a blade or a staff swings its own carry row');
  ok(/\} else if \(e\.kind === 'melee'\) \{\s*(?:\/\/[^\n]*\n\s*)*this\.rangedRange = 0;/.test(mobile), 'a blade, a club or a staff in the hand is never shot from');
}

// ------------------------------------------------------------------ the emulator's arming against the real rack, where converted
{
  const man = join('assets-private', 'spawns', 'manifest.json');
  const wep = join('assets-private', 'weapons', 'manifest.json');
  if (!existsSync(man) || !existsSync(wep)) note('no spawns manifest or weapons rack here, so the real arming is not measured');
  else {
    const m = JSON.parse(readFileSync(man, 'utf8')) as { format: number; creatures: Record<string, { weapons?: string[] }>; weaponGroups?: Record<string, string[]> };
    const realRack = (JSON.parse(readFileSync(wep, 'utf8')) as { weapons: W[] }).weapons;
    if (m.format < 2 || !m.weaponGroups) note('a spawns manifest older than format 2 carries no weapon groups');
    else {
      let listed = 0;
      let held = 0;
      let bare = 0;
      let none = 0;
      const byClass: Record<string, number> = {};
      for (const c of Object.values(m.creatures)) {
        if (!c.weapons?.length) continue;
        listed++;
        const got = ownWeapon(c.weapons, m.weaponGroups, realRack, at(0.5));
        if (!got) none++;
        else if (got.unarmed) bare++;
        else {
          held++;
          byClass[got.def!.class] = (byClass[got.def!.class] ?? 0) + 1;
        }
      }
      note(`${listed} creatures name weapons: ${held} come to a weapon on this rack, ${bare} to empty hands, ${none} to nothing the rack has (a spit, a probe's gun)`);
      note(`held by class: ${Object.entries(byClass).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      ok(held > 0 && none < listed * 0.05, 'nearly every creature that names a weapon comes to a weapon or to its fists on this rack');
      const tusken = m.creatures['tusken_child'];
      if (tusken?.weapons) {
        const kinds = new Set([0, 0.34, 0.67, 0.99].map((u) => ownWeapon(tusken.weapons!, m.weaponGroups!, realRack, at(u))?.def?.class));
        ok(kinds.has('knife') && kinds.has('polearm'), `a Tusken child holds a stone knife or a wooden staff (${[...kinds].join(', ')})`);
      }

      // **Whoever holds a gun can fire it.** The converter decided whether a creature shoots from its
      // weapon groups' names, and a group named for its owners (`jawa_weaker_weapons`) says nothing of
      // guns although every template in it is one; the decision gives such a body the range every
      // shooter has. Over the real fleet, every draw that comes to a gun must come with a range, from
      // the creature's own numbers or from the gun.
      const fleet = m.creatures as unknown as Record<string, PeopleCreature & { id?: string; kind?: string }>;
      const roles = { ranged: 'add_rifle_fire_1', rangedAdditive: false };
      const needed = new Set<string>();
      let guns = 0;
      const cannot: string[] = [];
      for (const [name, c] of Object.entries(fleet)) {
        const weapons = weaponsOf(c);
        if (!weapons) continue;
        const o = overridesOf(c);
        const entry = { id: String(c.id ?? name), kind: (c.kind as MobileEntry['kind']) ?? 'npc', species: null, appearance: null, flags: [], stats: { aggression: 'defensive', ranged: null } } as never as MobileEntry;
        for (const u of [0, 0.34, 0.67, 0.99]) {
          const d = decideArms(entry, 'all_b', roles, { ranged: 'add_rifle_fire_1' }, { weapons, groups: m.weaponGroups, aggression: o?.aggression, ranged: o?.ranged }, realRack, at(u));
          if (d?.hold !== 'gun') continue;
          guns++;
          const own = o?.ranged ?? null;
          if (!((own && own.range > 0) || (d.ranged && d.ranged.range > 0))) cannot.push(name);
          if (d.ranged) needed.add(name);
        }
      }
      let rows = 0;
      for (const w of ['tatooine', 'corellia', 'naboo', 'talus', 'rori', 'lok', 'dantooine', 'dathomir', 'endor', 'yavin4']) {
        const pf = join('assets-private', w, 'spawns.json');
        if (!existsSync(pf)) continue;
        for (const r of (JSON.parse(readFileSync(pf, 'utf8')) as { statics: StandingRow[] }).statics) if (needed.has(r.who)) rows++;
      }
      note(`${guns} draws over the fleet come to a gun; ${needed.size} creatures (${rows} standing rows over the converted worlds) hold one their own numbers say they cannot fire, and are given the ${OWN_GUN_RANGE} m every shooter has`);
      ok(cannot.length === 0, `no creature that draws a gun is left unable to fire it${cannot.length ? `: ${cannot.slice(0, 8).join(', ')}` : ''}`);
      const jawa = fleet['jawa'];
      if (jawa?.weapons) {
        const d = decideArms({ id: 'jawa_male', kind: 'npc', species: null, appearance: null, flags: [], stats: { aggression: 'defensive', ranged: null } } as never, 'all_b', roles, undefined, { weapons: weaponsOf(jawa), groups: m.weaponGroups, aggression: overridesOf(jawa)?.aggression, ranged: overridesOf(jawa)?.ranged }, realRack, at(0));
        ok(d?.hold === 'gun' && (d.ranged?.range ?? 0) > 0, `a Jawa holds ${d?.weapon?.id ?? 'nothing'} and fires it`);
      }
    }
  }
}

console.log(`\n${passed} checks passed`);
