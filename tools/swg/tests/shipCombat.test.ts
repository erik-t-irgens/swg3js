// The space combat model (src/space/*.ts): the grade read from a name, the hull classes, the invented stats
// and their time-to-kill bands, the tier loadout pick on a graded pool, the layers a blow goes through, the
// shields' return, a ship's fight on a stub hull (its spec, its guns, a part going down and coming back,
// nothing allocated per hit), who attacks whom, which ships may be picked (a ghosted or dead one never), the
// anchors a space pack gives, the pilot's stick senses and a kinematic run of it in flyShip's own
// integration, formations, taunts, the Edit page's line and the combat file's reader. Synthetic data only:
// no number from the client's files.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FACTION_LABEL, aggressionOfFaction, shipHostile, shipStanding, sideOfFaction, type ShipFaction } from '../../../src/space/factions.ts';
import { COLLISION_BOUT, COLLISION_CAP_SHARE, componentLine, familyOf, gradeOf, hullClassOf, speedScale, statsFor, type Handling, type StatInput } from '../../../src/space/shipStats.ts';
import { COMPONENT_CHANCE, applyCollision, applyHit, createCondition, isDown, newHitResult, partnerLoss, regenerate, rescaleCondition, weightOf } from '../../../src/space/shipDamage.ts';
import { NPC_NEVER, TIER_GRADE, accepts, pickLoadout, seeded } from '../../../src/space/loadout.ts';
import { anchorRecipes, anchorsOf, groupTypes, stationFaction, type SpacePackLike } from '../../../src/space/roster.ts';
import { TAUNT_ANY_GAP, TAUNT_SHIP_GAP, TauntGate, fillTaunt, pickLine } from '../../../src/space/taunts.ts';
import { aimPoint, formationPoint, offNose, slotCruise, steerToward, toLocal, toWorld, type Stick } from '../../../src/space/pilot.ts';
import { ShipCombat, blameKey, blamed, stockFor, targetable, type CombatHull } from '../../../src/space/shipCombat.ts';
import { NOBODY, PLAYER_KEY } from '../../../src/combat/kit.ts';
import { CombatData, type CombatFile, type NpcTypeDef } from '../../../src/space/combatData.ts';
import { componentIndex, resolveFit, type ComponentDef, type FitDef, type FitSlot } from '../../../src/vehicles/shipFit.ts';
import type { ShipContact } from '../../../src/space/contacts';
import type { Bolt } from '../../../src/combat/bolts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------------------------
// The grade and the hull classes.
{
  const cases: [string | null, number][] = [
    ['wpn_taim_kx9', 2],
    ['arm_corellian_cheap_durasteel', 1],
    ['bst_kuat_military_mk4', 4],
    ['wpn_experimental_blaster', 5],
    ['eng_incom_fusialthrust', 2],
    ['eng_incom_heavy_fusialthrust', 3],
    ['eng_incom_light_fusialthrust', 1],
    ['wpn_subpro_tripleblaster_mark2', 2],
    [null, 2],
  ];
  for (const [name, g] of cases) ok(gradeOf(name) === g, `gradeOf(${name}) is ${g}`);
  ok(hullClassOf('gunship', false, 'arc170') === 'fighter', 'hullClassOf: a small gunship (ARC-170) is a fighter');
  ok(hullClassOf('freighter', false, 'firespray') === 'fighter', 'hullClassOf: a small freighter (Firespray) is a fighter');
  ok(hullClassOf('bomber', true, 'blacksun_heavy') === 'big', 'hullClassOf: a big bomber is big');
  ok(hullClassOf('bomber', false, 'ywing') === 'bomber', 'hullClassOf: a small bomber (Y-wing) is a bomber');
  ok(hullClassOf('bomber', false, 'tieadvanced') === 'fighter', 'hullClassOf: the TIE Advanced flies as a fighter');
  ok(hullClassOf('other', false, 'vwing') === 'fighter', "hullClassOf: 'other', small, is a fighter");
  ok(hullClassOf('other', true, 'blacksun_medium') === 'big', "hullClassOf: 'other', big, is big");
  ok(familyOf('blacksun_light_s01') === 'blacksun_light' && familyOf('tiefighter') === 'tiefighter', 'familyOf drops a style suffix only');
}

// ---------------------------------------------------------------------------------------------
// A graded pool (about 60 components) and two tier fits: a TIE's (guns on the hull: no weapon looks) and an
// X-wing's (looks on the engine and weapon_0).
const pool: ComponentDef[] = [];
function add(name: string, type: string, compat: string, weapon?: ComponentDef['weapon']): number {
  pool.push({ name, type, compat, label: name, template: `object/tangible/ship/components/${type}/shared_${name}.iff`, ...(weapon ? { weapon } : {}) });
  return pool.length - 1;
}
const words: [string, number][] = [
  ['cheap', 1],
  ['basic', 1],
  ['standard', 2],
  ['plain', 2],
  ['improved', 3],
  ['enhanced', 3],
  ['elite', 4],
  ['advanced', 4],
  ['prototype', 5],
];
for (const [cls, type, pre] of [
  ['rct_0', 'reactor', 'rct'],
  ['shd_0', 'shield', 'shd'],
  ['arm_0', 'armor', 'arm'],
  ['cap_0', 'capacitor', 'cap'],
  ['bst_0', 'booster', 'bst'],
  ['ddi_0', 'droid_interface', 'ddi'],
] as const) {
  for (const [w] of words) {
    // Armour has no grade-5 piece in this pool (so tier 5 carries grade 4).
    if (cls === 'arm_0' && w === 'prototype') continue;
    add(`${pre}_kuat_${w}`, type, cls);
  }
  add(`${pre}_crafted_prototype`, type, cls);
}
// Engines: the tier-looked ones are grades 1 and 2 only (as the X-wing's are); better ones exist without a look.
const engLook = [add('eng_generic', 'engine', 'eng_0'), add('eng_incom_fusialthrust', 'engine', 'eng_0'), add('eng_novaldex_eventhorizon', 'engine', 'eng_0')];
add('eng_kuat_improved', 'engine', 'eng_0');
add('eng_kuat_elite', 'engine', 'eng_0');
add('eng_kuat_experimental', 'engine', 'eng_0');
add('eng_reward_best', 'engine', 'eng_0');
// Guns: projectile 4 (red) and 6 (green, whose lowest grade is 2), a missile and countermeasures.
const bolt = (projectile: number) => ({ projectile, speed: 600, range: 512 });
const red = [add('wpn_light_blaster', 'weapon', 'wpn_0', bolt(4)), add('wpn_incom_blaster', 'weapon', 'wpn_0', bolt(4)), add('wpn_incom_heavy_blaster', 'weapon', 'wpn_0', bolt(4))];
const green = [add('wpn_seinar_blaster', 'weapon', 'wpn_0', bolt(6)), add('wpn_seinar_heavy_blaster', 'weapon', 'wpn_0', bolt(6)), add('wpn_seinar_elite_blaster', 'weapon', 'wpn_0', bolt(6)), add('wpn_seinar_experimental_blaster', 'weapon', 'wpn_0', bolt(6))];
add('wpn_reward_blaster', 'weapon', 'wpn_0', bolt(6));
add('wpn_test_blaster', 'weapon', 'wpn_0', bolt(6));
add('wpn_tractor_beam', 'weapon', 'wpn_0', { ...bolt(9), tractor: 1 });
const missiles = [add('wpn_concussion_missile', 'weapon', 'wpn_1', { ...bolt(12), missile: 1 }), add('wpn_proton_torpedo', 'weapon', 'wpn_1', { ...bolt(13), missile: 1 })];
add('cms_chaff', 'weapon', 'cms_0', { ...bolt(20), countermeasure: 1 });
const strakes = add('mod_xwing_modification_s01', 'modification', 'mod_xwing');
ok(pool.length >= 55 && pool.length <= 90, `the fixture pool has several dozen graded components (${pool.length})`);
const index = componentIndex(pool);

function slot(name: string, compat: string[], stock: string | null, looks: number[][] = []): FitSlot {
  return { slot: name, compat, stock, looks: looks.map((components, k) => ({ components, parts: [{ file: `${name}_${k}.glb`, hardpoint: `${name}1`, template: `t_${name}_${k}` }] })) };
}
const systems = (): FitSlot[] => [
  slot('reactor', ['rct_0'], 'rct_kuat_plain'),
  slot('shield_0', ['shd_0'], 'shd_kuat_plain'),
  slot('armor_0', ['arm_0'], 'arm_kuat_plain'),
  slot('armor_1', ['arm_0'], 'arm_kuat_plain'),
  slot('capacitor', ['cap_0'], 'cap_kuat_plain'),
  slot('booster', ['bst_0'], 'bst_kuat_plain'),
  slot('droid_interface', ['ddi_0'], 'ddi_kuat_plain'),
];
const tieFit: FitDef = { chassis: 'tiefighter_tier1', droid: 'computer', paint: null, slots: [...systems(), slot('engine', ['eng_0'], 'eng_incom_fusialthrust', [[engLook[0]], [engLook[1], engLook[2]]]), slot('weapon_0', ['wpn_0'], 'wpn_seinar_blaster'), slot('weapon_1', ['wpn_1'], 'wpn_concussion_missile')] };
const xwingFit: FitDef = { chassis: 'player_xwing', droid: 'astromech', paint: null, slots: [...systems(), slot('engine', ['eng_0'], 'eng_incom_fusialthrust', [[engLook[0]], [engLook[1], engLook[2]]]), slot('weapon_0', ['wpn_0'], 'wpn_light_blaster', [[red[0], red[1]], [green[0]]]), slot('weapon_1', ['wpn_1'], 'wpn_concussion_missile', [[missiles[0]]]), slot('modification_0', ['mod_xwing'], null, [[strakes]])] };

// ---------------------------------------------------------------------------------------------
// The loadout pick.
{
  ok(accepts(['arm_0'], 'arm_0') && accepts(['wpn_0', 'wpn_1'], 'x, wpn_1') && !accepts(['arm_0'], 'shd_0'), 'accepts: a class the slot takes, from a comma list');
  const gradeOfPick = (fit: FitDef, tier: number, slotName: string, seed: number) => {
    const picked = pickLoadout(fit, pool, tier, fit === tieFit ? 6 : 4, seeded(seed));
    const name = picked.components[slotName];
    return name ? gradeOf(name) : null;
  };
  let capOk = true;
  let floorOk = true;
  let neverOk = true;
  let lookOk = true;
  let projOk = true;
  let resolveOk = true;
  for (let seed = 1; seed <= 40; seed++) {
    for (const fit of [tieFit, xwingFit]) {
      for (let tier = 1; tier <= 5; tier++) {
        const picked = pickLoadout(fit, pool, tier, fit === tieFit ? 6 : 4, seeded(seed));
        for (const s of fit.slots) {
          const name = picked.components[s.slot];
          if (name === undefined) continue;
          const i = index.get(name)!;
          const c = pool[i];
          if (NPC_NEVER.test(name)) neverOk = false;
          if (!accepts(s.compat, c.compat)) neverOk = false;
          const shown = s.looks.flatMap((l) => l.components);
          if (shown.length && !shown.includes(i)) lookOk = false;
          if (s.compat.includes('wpn_0')) {
            const want = fit === tieFit ? 6 : 4;
            if (c.weapon?.projectile !== want) projOk = false;
          }
          // The candidates in this slot as the pick sees them (steps 1 to 3), for the cap and the floor.
          const gun = s.compat.includes('wpn_0');
          let cands = pool.map((x, k) => ({ x, k })).filter(({ x, k }) => !NPC_NEVER.test(x.name) && accepts(s.compat, x.compat) && (!gun || (!!x.weapon && !x.weapon.missile && !x.weapon.tractor && !x.weapon.countermeasure)) && (!shown.length || shown.includes(k)));
          if (gun) {
            const own = cands.filter(({ x }) => x.weapon?.projectile === (fit === tieFit ? 6 : 4));
            if (own.length) cands = own;
          }
          const grades = cands.map(({ x }) => gradeOf(x.name));
          const g = gradeOf(name);
          if (tier === 1 && g > Math.min(...grades)) capOk = false;
          if (tier === 5 && g < Math.max(...grades.filter((x) => x <= 5))) floorOk = false;
          if (g > Math.max(TIER_GRADE[tier], Math.min(...grades))) capOk = false;
        }
        const r = resolveFit(fit, pool, index, [], picked);
        if (r.notes.length) resolveOk = false;
      }
    }
  }
  ok(capOk, 'pickLoadout: never above the tier grade (tier 1: never above the lowest grade its candidates hold)');
  ok(floorOk, 'pickLoadout: at tier 5 never below the best grade present at or under 5');
  ok(neverOk, 'pickLoadout: never an NPC_NEVER component, never one the slot does not accept');
  ok(lookOk, 'pickLoadout: in a slot with looks, only components with a look');
  ok(projOk, "pickLoadout: a gun slot fires the hull's own projectile when the pool has it");
  ok(resolveOk, 'pickLoadout: every pick passes resolveFit without a note');
  ok(NPC_NEVER.test('wpn_kessel_imperial_sds_experimental_secret_ops') && NPC_NEVER.test('eng_kessel_reward') && !NPC_NEVER.test('wpn_experimental_blaster'), 'NPC_NEVER: the Kessel reward pieces too, not the plain experimental ones');
  ok(JSON.stringify(pickLoadout(tieFit, pool, 3, 6, seeded(7))) === JSON.stringify(pickLoadout(tieFit, pool, 3, 6, seeded(7))), 'pickLoadout: the same seed gives the same fit');
  ok(gradeOfPick(xwingFit, 5, 'engine', 3) === 2, 'pickLoadout: a looked slot with grades 1-2 gives grade 2 at tier 5');
  ok([1, 3, 5].every((t) => pickLoadout(xwingFit, pool, t, 4, seeded(t)).components.modification_0 === undefined), 'pickLoadout: a modification slot (a reward look) is left empty');
  ok(pickLoadout(tieFit, pool, 2, 6, seeded(1)).components.weapon_1 === 'wpn_concussion_missile' || pickLoadout(tieFit, pool, 2, 6, seeded(1)).components.weapon_1 === 'wpn_proton_torpedo', 'pickLoadout: a launcher slot takes a launcher');
}

// ---------------------------------------------------------------------------------------------
// The stats.
const fighterBase: Handling = { maxSpeed: 140, boostSpeed: 220, accel: 30, brake: 40, turnRate: 1.1, inertia: 0.55 };
const weaponOf = (name: string) => {
  const i = index.get(name);
  return i === undefined ? null : (pool[i].weapon ?? null);
};
function inputFor(fit: FitDef, family: string, tier: number, components: Record<string, string | null>, opts: Partial<StatInput> = {}): StatInput {
  const slots: StatInput['slots'] = {};
  for (const s of fit.slots) slots[s.slot] = { compat: s.compat, hitweight: 10, targetable: s.slot === 'reactor' || s.slot === 'engine' };
  const stock: Record<string, string | null> = {};
  if (tier === 0) for (const s of fit.slots) stock[s.slot] = s.stock;
  return { hullClass: 'fighter', family, tier, base: fighterBase, slots, components, stock, weaponOf, defaultWeapon: { name: 'hull_gun', projectile: 4, speed: 600, range: 512 }, ...opts };
}
const stockOf = (fit: FitDef) => Object.fromEntries(fit.slots.map((s) => [s.slot, s.stock]));
{
  const stock = statsFor(inputFor(xwingFit, 'jedi_starfighter', 0, stockOf(xwingFit)));
  ok(JSON.stringify(stock.handling) === JSON.stringify(fighterBase), 'statsFor: a stock player fighter with no family trait keeps its handling exactly');
  const big = statsFor(inputFor(xwingFit, 'jedi_starfighter', 0, stockOf(xwingFit), { hullClass: 'big' }));
  ok(JSON.stringify(big.handling) === JSON.stringify(fighterBase), 'statsFor: a stock big hull keeps its handling exactly');
  const bomber = statsFor(inputFor(xwingFit, 'jedi_starfighter', 0, stockOf(xwingFit), { hullClass: 'bomber' }));
  ok(near(bomber.handling.maxSpeed, 140 * 0.82) && near(bomber.handling.boostSpeed, 220 * 0.82) && near(bomber.handling.turnRate, 1.1 * 0.77), 'statsFor: a small bomber flies at 0.82 of the speeds and 0.77 of the turn');
  const faster = statsFor(inputFor(xwingFit, 'jedi_starfighter', 0, { ...stockOf(xwingFit), engine: 'eng_kuat_improved' }));
  ok(near(faster.handling.maxSpeed, 140 * (speedScale(3) / speedScale(2))), 'statsFor: an engine a grade over the stock raises the speeds by the speedScale ratio');
  const npc = statsFor(inputFor(tieFit, 'jedi_starfighter', 3, { ...stockOf(tieFit), engine: 'eng_incom_fusialthrust' }));
  ok(near(npc.handling.maxSpeed, 140) && near(npc.handling.boostSpeed, 220), 'statsFor: an NPC with a grade-2 engine keeps the base speeds');
  const t1 = statsFor(inputFor(tieFit, 'tiefighter', 1, stockOf(tieFit)));
  const t5 = statsFor(inputFor(tieFit, 'tiefighter', 5, stockOf(tieFit)));
  ok(near(t5.chassisMax / t1.chassisMax, 1.6 / 0.8), 'statsFor: a tier-5 chassis is twice a tier-1 (tierDurability 1.6 against 0.8)');
  const noShield = inputFor(tieFit, 'tiefighter', 1, stockOf(tieFit));
  delete noShield.slots.shield_0;
  ok(statsFor(noShield).shieldMax[0] === 0 && statsFor(noShield).shieldMax[1] === 0, 'statsFor: no shield_0 slot, no shields');
  ok(t1.guns.length === 1 && t1.guns[0].slot === 'weapon_0', 'statsFor: a wpn_1 slot with a missile makes no gun');
  const noGuns = inputFor(tieFit, 'tiefighter', 1, { ...stockOf(tieFit), weapon_0: null });
  const ng = statsFor(noGuns);
  ok(ng.guns.length === 1 && ng.guns[0].name === 'hull_gun' && ng.guns[0].slot === 'weapon_0', "statsFor: no gun at all gives one gun from the hull's own weapon");
  ok(near(stock.refire, 0.5) && near(stock.boostSeconds, 6), 'statsFor: refire and boost at grade 2');
}

// Time to kill (the balance, invented, as bands), with the tier pick on the pool.
function killHits(target: ReturnType<typeof statsFor>, damage: number): number {
  const c = createCondition(target);
  const r = newHitResult();
  let n = 0;
  while (!r.destroyed && n < 1000) {
    applyHit(c, target, damage, 0, 1, 0, r);
    n++;
  }
  return n;
}
{
  const tie = (tier: number) => {
    const picked = pickLoadout(tieFit, pool, tier, 6, seeded(1));
    const fit = resolveFit(tieFit, pool, index, [], picked);
    return statsFor(inputFor(tieFit, 'tiefighter', tier, fit.components));
  };
  const player = statsFor(inputFor(xwingFit, 'xwing', 0, stockOf(xwingFit)));
  const playerGun = player.guns[0].damage;
  ok(near(playerGun, 27), `the stock player gun (grade 1) does 27 (${playerGun})`);
  const k1 = killHits(tie(1), playerGun);
  const k5 = killHits(tie(5), playerGun);
  ok(k1 >= 10 && k1 <= 20, `the stock player gun kills a tier-1 TIE from the front in 10 to 20 hits (${k1})`);
  ok(k5 >= 20 && k5 <= 40, `and a tier-5 TIE in 20 to 40 (${k5})`);
  const tieGun = tie(1).guns[0];
  ok(tieGun.projectile === 6 && near(tieGun.damage, 25.5), `a tier-1 TIE fires its own green bolt at 25.5 (${tieGun.damage})`);
  const kx = killHits(player, tieGun.damage);
  ok(kx >= 18 && kx <= 35, `a tier-1 TIE's gun kills a stock X-wing in 18 to 35 hits (${kx})`);
}

// ---------------------------------------------------------------------------------------------
// The layers.
{
  const stats = statsFor(inputFor(tieFit, 'tiefighter', 2, stockOf(tieFit)));
  const c = createCondition(stats);
  const r = newHitResult();
  const sh = stats.shieldMax[0];
  applyHit(c, stats, sh / 2, 0, 1, 0, r);
  ok(r.layer === 'shield' && near(c.shield[0], sh / 2) && c.armour[0] === stats.armourMax[0], 'applyHit: a blow under the shield is the shield\'s and leaves the armour');
  ok(c.shield[1] === stats.shieldMax[1] && c.armour[1] === stats.armourMax[1], 'applyHit: the other face is untouched');
  applyHit(c, stats, sh / 2 + 10, 0, 1, 0, r);
  ok(r.shieldDown && r.layer === 'armor' && near(c.armour[0], stats.armourMax[0] - 10), 'applyHit: with the shield gone the armour takes it (shieldDown once)');
  applyHit(c, stats, stats.armourMax[0], 0, 1, 0, r);
  ok(r.armourBreached && r.layer === 'chassis' && near(c.chassis, stats.chassisMax - 10), 'applyHit: with both gone the chassis takes the rest (armourBreached)');
  const before = c.chassis;
  applyHit(c, stats, 20, 0, COMPONENT_CHANCE - 0.01, 0, r);
  ok(r.layer === 'component' && r.part === 'reactor' && near(c.chassis, before - 20) && near(c.parts[0].hp, c.parts[0].max - 20), 'applyHit: under COMPONENT_CHANCE a part picked by weight takes it too (pick 0: the first)');
  applyHit(c, stats, 20, 0, COMPONENT_CHANCE + 0.01, 0.99, r);
  ok(r.part === null && r.layer === 'chassis', 'applyHit: over COMPONENT_CHANCE no part');
  const engine = c.parts.find((p) => p.slot === 'engine')!;
  const pickEngine = (c.parts.indexOf(engine) + 0.5) / c.parts.length;
  applyHit(c, stats, engine.max, 0, 0, pickEngine, r);
  ok(r.part === 'engine' && r.partDown && isDown(c, 'engine'), 'applyHit: a part at 0 is partDown');
  applyHit(c, stats, 1, 0, 0, pickEngine, r);
  ok(r.part !== 'engine' && !r.partDown, 'applyHit: a part that is down is not picked again (partDown only once)');
  applyHit(c, stats, 1e6, 0, 1, 0, r);
  ok(r.destroyed && c.chassis === 0, 'applyHit: the chassis at 0 is destroyed');
  applyHit(c, stats, 50, 0, 1, 0, r);
  ok(!r.destroyed && r.dealt === 0, 'applyHit: a destroyed ship takes nothing more');
  ok(weightOf(1, stats) === 0 && weightOf(0.05 * (stats.shieldMax[0] + stats.armourMax[0] + stats.chassisMax), stats) === 1 && weightOf(1e6, stats) === 2, 'weightOf: light, medium, heavy by share');

  // Collisions skip the shield.
  const c2 = createCondition(stats);
  applyCollision(c2, stats, 30, 0, r);
  ok(c2.shield[0] === stats.shieldMax[0] && near(c2.armour[0], stats.armourMax[0] - 30) && r.layer === 'armor', 'applyCollision: onto the armour, the shield untouched');

  // Shields come back after the delay, not with the generator or reactor down.
  const c3 = createCondition(stats);
  applyHit(c3, stats, 40, 0, 1, 0, r);
  const low = c3.shield[0];
  regenerate(c3, stats, true, true, stats.shieldDelay - 0.5);
  ok(c3.shield[0] === low, 'regenerate: nothing within shieldDelay of a hit');
  regenerate(c3, stats, true, true, 1);
  ok(c3.shield[0] > low, 'regenerate: after the delay the shield comes back');
  const c4 = createCondition(stats);
  applyHit(c4, stats, 40, 0, 1, 0, r);
  const low4 = c4.shield[0];
  regenerate(c4, stats, false, true, 60);
  regenerate(c4, stats, true, false, 60);
  ok(c4.shield[0] === low4, 'regenerate: nothing with the generator or the reactor down');

  // A refit keeps the shares.
  const c5 = createCondition(stats);
  applyHit(c5, stats, stats.shieldMax[0] / 2, 0, 1, 0, r);
  const better = statsFor(inputFor(tieFit, 'tiefighter', 4, stockOf(tieFit)));
  rescaleCondition(c5, stats, better);
  ok(near(c5.shield[0] / better.shieldMax[0], 0.5) && near(c5.chassis, better.chassisMax), 'rescaleCondition keeps the shares');
}

// ---------------------------------------------------------------------------------------------
// A ship's fight on a stub hull.
function stubHull(): CombatHull {
  return {
    spec: { maxSpeed: 140, boostSpeed: 220, accel: 30, brake: 40, turnRate: 1.1, inertia: 0.55, bounds: { min: [-3, -1, -5], max: [3, 1, 5] } },
    hp: 100,
    maxHp: 100,
    struck: 0,
    group: new THREE.Group(),
    guns: [
      { pos: new THREE.Vector3(1, 0, 3), dir: new THREE.Vector3(0, 0, 1), slot: 'weapon_0' },
      { pos: new THREE.Vector3(-1, 0, 3), dir: new THREE.Vector3(0, 0, 1), slot: null },
    ],
  };
}
const contactStub = {} as unknown as ShipContact;
const boltAt = (damage: number, dir = new THREE.Vector3(0, 0, -1)) => ({ damage, dir, source: null }) as unknown as Bolt;
{
  const hull = stubHull();
  const input = inputFor(tieFit, 'jedi_starfighter', 2, stockOf(tieFit));
  const sc = new ShipCombat(hull, contactStub, input, null, null, null);
  sc.rng = () => 0.99;
  const st = sc.stats;
  ok(hull.spec.maxSpeed === st.handling.maxSpeed && hull.spec.turnRate === st.handling.turnRate, 'ShipCombat: the constructor writes the spec from the stats');
  const p = new THREE.Vector3();
  const n = new THREE.Vector3(0, 0, 1);
  sc.takeBolt(boltAt(st.shieldMax[0] / 2), p, n);
  ok(sc.cond.shield[0] < st.shieldMax[0] && sc.cond.armour[0] === st.armourMax[0] && hull.hp === 100, 'ShipCombat.takeBolt: a bolt from ahead takes the front shield first');
  sc.takeBolt(boltAt(st.shieldMax[1] / 2, new THREE.Vector3(0, 0, 1)), p, n);
  ok(sc.cond.shield[1] < st.shieldMax[1], 'ShipCombat.takeBolt: a bolt from behind takes the back shield');
  sc.takeBolt(boltAt(st.shieldMax[0] / 2 + st.armourMax[0] + st.chassisMax / 2), p, n);
  ok(sc.cond.shield[0] === 0 && sc.cond.armour[0] === 0 && near(hull.hp, 50, 1e-6), 'ShipCombat.takeBolt walks shield, armour, then chassis, and hull.hp mirrors the chassis share');
  sc.forceHit('engine', 1);
  ok(near(hull.spec.maxSpeed, st.handling.maxSpeed * 0.35) && sc.down.includes('engine'), 'ShipCombat: an engine down writes the top speed to 0.35 of the undamaged');
  sc.repair();
  ok(hull.spec.maxSpeed === st.handling.maxSpeed && sc.down.length === 0 && hull.hp === 100, 'ShipCombat.repair puts it back');
  ok(sc.gunSlot(0) === 'weapon_0' && sc.gunSlot(1) === 'weapon_0', "ShipCombat.gunSlot: the gun's own slot, else the first gun slot");
  const first = sc.takeShot();
  const second = sc.takeShot();
  ok(first === 0 && second === -1 && sc.cooldown > 0, 'ShipCombat.takeShot: a gun, then the cooldown');
  sc.update(sc.cooldown + 0.01, 1);
  ok(sc.takeShot() === 1, 'ShipCombat.takeShot: the guns take turns');
  sc.forceHit('weapon_0', 1);
  sc.update(10, 2);
  ok(sc.takeShot() === -1, 'ShipCombat.takeShot: a weapon slot down silences its guns');
  sc.repair();
  sc.forceHit('chassis', 1);
  ok(hull.hp === 0 && sc.cond.chassis === 0, 'ShipCombat: destroyed at nothing (hull.hp 0)');
  // Boost energy.
  const sb = new ShipCombat(stubHull(), contactStub, input, null, null, null);
  const full = sb.boostLeft;
  sb.update(2, 0, true);
  ok(near(sb.boostLeft, full - 2), 'ShipCombat.update: boosting spends the boost');
  sb.update(1, 0, false);
  ok(sb.boostLeft > full - 2, 'ShipCombat.update: the boost recharges');
  // A refit from the undamaged handling, whatever the spec says now.
  const sr = new ShipCombat(stubHull(), contactStub, input, null, null, null);
  sr.forceHit('engine', 1);
  sr.restat({ ...input, base: { ...fighterBase, maxSpeed: 1 } });
  sr.repair();
  ok(near(sr.hull.spec.maxSpeed, 140), 'ShipCombat.restat starts from the handling the vehicle had before the combat');
  // The god mode.
  const sg = new ShipCombat(stubHull(), contactStub, input, null, null, null);
  sg.god = true;
  sg.takeBolt(boltAt(1e6), p, n);
  ok(sg.hull.hp === 100, 'ShipCombat: in god mode nothing is taken');

  // A collision costs the share of the chassis it cost of hp before, the armour taking the first of it.
  const sk = new ShipCombat(stubHull(), contactStub, input, null, null, null);
  const ks = sk.stats;
  sk.collide(ks.armourMax[0] / (ks.chassisMax / 100) + 25);
  ok(sk.cond.armour[0] === 0 && near(sk.cond.chassis, ks.chassisMax * 0.75, 1e-6) && near(sk.hull.hp, 75, 1e-6) && sk.cond.shield[0] === ks.shieldMax[0], 'ShipCombat.collide: in hp points, scaled to the chassis, armour first, the shield untouched');

  // One collision with another ship is capped below what destroys the ship at full health; contacts with the same
  // ship within COLLISION_BOUT seconds are that one collision; another ship, or later, is a new one. Anything that
  // is not a ship (null) is not capped.
  const cap = COLLISION_CAP_SHARE * (ks.armourMax[0] + ks.chassisMax);
  ok(COLLISION_CAP_SHARE > 0 && COLLISION_CAP_SHARE < 1, `COLLISION_CAP_SHARE is under 1 (${COLLISION_CAP_SHARE})`);
  const other = 7;
  const sx = new ShipCombat(stubHull(), contactStub, input, null, null, null);
  const took = sx.collide(1e6, other);
  ok(near(took, cap, 1e-6) && sx.cond.chassis > 0 && sx.hull.hp > 0 && sx.cond.shield[0] === ks.shieldMax[0], `ShipCombat.collide: a crash at any speed takes at most ${COLLISION_CAP_SHARE} of the front armour and chassis, and a whole ship lives (took ${took.toFixed(1)} of ${(ks.armourMax[0] + ks.chassisMax).toFixed(1)})`);
  sx.update(COLLISION_BOUT * 0.5, 0);
  ok(sx.collide(1e6, other) === 0 && near(sx.cond.chassis + sx.cond.armour[0], ks.armourMax[0] + ks.chassisMax - cap, 1e-6), 'ShipCombat.collide: the same hull met again within the bout adds nothing past the cap (two hulls wedged together)');
  sx.update(COLLISION_BOUT * 0.9, 0);
  ok(sx.collide(1e6, other) === 0, 'ShipCombat.collide: every contact keeps the bout going');
  sx.update(COLLISION_BOUT + 0.1, 0);
  const again = sx.collide(1e6, other);
  ok(again > 0 && sx.cond.chassis === 0 && sx.hull.hp === 0, 'ShipCombat.collide: past the bout it is a new collision, which a ship already down to 40% does not live through');
  const sy = new ShipCombat(stubHull(), contactStub, input, null, null, null);
  sy.collide(1e6, other);
  ok(sy.collide(1e6, null) > 0, 'ShipCombat.collide: something else met within the bout (a station after a hull) is a collision of its own');
  const sw = new ShipCombat(stubHull(), contactStub, input, null, null, null);
  sw.collide(1e6, null);
  ok(sw.cond.chassis === 0 && sw.hull.hp === 0, 'ShipCombat.collide: a station, an asteroid or the ground is not capped (a crash hard enough destroys a whole ship)');
  const sv = new ShipCombat(stubHull(), contactStub, input, null, null, null);
  const strike = (ks.armourMax[0] + ks.chassisMax) / 4 / (ks.chassisMax / 100);
  for (let i = 0; i < 5; i++) {
    sv.collide(strike, null);
    sv.update(0.5, 0);
  }
  ok(sv.cond.chassis === 0, 'ShipCombat.collide: a ship held into a station face, striking again every half second, is destroyed (no bout for what is not a ship)');
  const s0 = new ShipCombat(stubHull(), contactStub, input, null, null, null);
  s0.collide(1e6, 0);
  ok(s0.cond.chassis > 0 && near(s0.collide(1e6, 0), 0, 1e-9), 'ShipCombat.collide: a ship whose key is 0 is a ship (capped), not nothing');
  ok(near(partnerLoss(10, 9000, 9000), 10, 1e-9) && near(partnerLoss(10, 9000, 18000), 5, 1e-9) && near(partnerLoss(10, 18000, 9000), 20, 1e-9), 'partnerLoss: the other ship loses this loss times this mass over its own (the momentum moved is the same both ways)');
  ok(partnerLoss(0, 9000, 9000) === 0 && partnerLoss(10, 0, 9000) === 0 && Number.isFinite(partnerLoss(10, 9000, 0)), 'partnerLoss: nothing lost or no mass moves nothing, and a massless partner gives a finite number');
  const sz = new ShipCombat(stubHull(), contactStub, input, null, null, null);
  const small = sz.collide(10, other);
  ok(near(small, 10 * (ks.chassisMax / 100), 1e-6) && near(sz.collide(10, other), 10 * (ks.chassisMax / 100), 1e-6), 'ShipCombat.collide: under the cap each contact takes all it costs');
  sz.repair();
  ok(near(sz.collide(1e6, other), cap, 1e-6), 'ShipCombat.repair ends the bout');

  // The hit effects: placed in the hull's frame at the true point, reported 'shown'; with no effect for the layer, 'taken'.
  const placed: { file: string; at: THREE.Vector3; frame: THREE.Matrix4 | null }[] = [];
  const fxRec = {
    place: (file: string, m: THREE.Matrix4, _t: boolean, frame: THREE.Matrix4 | null) => {
      placed.push({ file, at: new THREE.Vector3().setFromMatrixPosition(m), frame });
      return placed.length;
    },
    remove: () => {},
    flash: () => {},
    hardpoint: () => null,
  };
  const hitFx = { shield: { hit: ['shield_hit_light.prt', 'shield_hit_medium.prt', 'shield_hit_heavy.prt'], event: [null, null, null] } } as unknown as CombatFile['hitEffects'];
  const hf = stubHull();
  hf.group.position.set(100, 20, -50);
  hf.group.rotation.y = 0.7;
  hf.group.updateMatrixWorld(true);
  const se = new ShipCombat(hf, contactStub, input, fxRec, null, hitFx);
  se.rng = () => 0.99;
  const at = new THREE.Vector3(101, 21, -49);
  const r1 = se.takeBolt(boltAt(1), at, n);
  const local = placed[0]?.at.clone().applyMatrix4(hf.group.matrixWorld);
  ok(r1 === 'shown' && placed.length === 1 && placed[0].frame === hf.group.matrixWorld && !!local && local.distanceTo(at) < 1e-6, "ShipCombat.takeBolt: the layer's hit effect in the hull's frame, at the point, 'shown'");
  const r2 = se.takeBolt(boltAt(ks.shieldMax[0] * 10), at, n);
  ok(r2 === 'taken', "ShipCombat.takeBolt: no effect for the layer struck (a deeper one here): 'taken', so the bolt's own plays");
  const sn = new ShipCombat(stubHull(), contactStub, input, fxRec, null, null);
  ok(sn.takeBolt(boltAt(1), at, n) === 'taken', "ShipCombat.takeBolt: no combat file: 'taken'");
  sn.setEffects(null, hitFx);
  sn.update(0.001, 0);
  ok(sn.takeBolt(boltAt(1), at, n) === 'shown', 'ShipCombat.setEffects: a combat file that arrives late gives an adopted ship its hit effects');

  // Nothing allocated per hit.
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    const sa = new ShipCombat(stubHull(), contactStub, input, null, null, null);
    sa.rng = seeded(3);
    const b = boltAt(0.01);
    for (let i = 0; i < 200; i++) sa.takeBolt(b, p, n);
    gc();
    const start = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1000; i++) {
      sa.takeBolt(b, p, n);
      sa.update(1 / 60, i / 60);
    }
    gc();
    const grew = process.memoryUsage().heapUsed - start;
    ok(grew < 64 * 1024, `1000 takeBolt calls leave the heap within 64 KB (${grew} bytes)`);
  } else console.log('skip 1000 takeBolt calls allocate nothing: run with node --expose-gc to measure');
}

// ---------------------------------------------------------------------------------------------
// Targetable, factions.
{
  ok(targetable({ dead: false, vehicle: { ghosted: false } }), 'targetable: alive and not in a jump');
  ok(!targetable({ dead: false, vehicle: { ghosted: true } }), 'targetable: a ghosted hull (in a jump) is not');
  ok(!targetable({ dead: true, vehicle: { ghosted: false } }), 'targetable: a dead ship is not');
  // Blame: the player in any form is PLAYER_KEY, and PLAYER_KEY finds the ship they fly now, else the player on foot.
  const onFoot = { key: PLAYER_KEY };
  const flown = { key: 41 };
  const npc = { key: 42 };
  ok(blameKey(onFoot, null) === PLAYER_KEY && blameKey(flown, flown) === PLAYER_KEY && blameKey(npc, flown) === 42 && blameKey(null, flown) === NOBODY, "blameKey: the player on foot or the ship they fly is PLAYER_KEY; anyone else their own key; nobody NOBODY");
  ok(blameKey(flown, null) === 41, 'blameKey: a ship the player no longer flies is itself');
  const listed = [flown, npc];
  ok(blamed(PLAYER_KEY, listed, flown, onFoot) === flown && blamed(PLAYER_KEY, listed, null, onFoot) === onFoot, 'blamed: PLAYER_KEY is the ship the player flies now, else the player on foot');
  ok(blamed(42, listed, flown, onFoot) === npc && blamed(99, listed, flown, onFoot) === null && blamed(NOBODY, listed, flown, onFoot) === null, 'blamed: another key its contact; an unknown key or NOBODY no one');
  const fitSlots = [{ slot: 'engine', stock: 'eng_a' }, { slot: 'modification_0', stock: null }];
  ok(stockFor(false, fitSlots).engine === 'eng_a' && 'modification_0' in stockFor(false, fitSlots) && Object.keys(stockFor(true, fitSlots)).length === 0 && Object.keys(stockFor(false, null)).length === 0, "stockFor: a player's or garage ship counts its fit's stock parts; an NPC type none");
  const all: ShipFaction[] = ['player', 'imperial', 'rebel', 'blacksun', 'pirate', 'neutral'];
  ok(['rebel', 'blacksun', 'pirate', 'player'].every((f) => shipHostile('imperial', f as ShipFaction)), 'shipHostile: the Empire attacks Rebels, Black Sun, pirates and the player');
  ok(!shipHostile('rebel', 'player') && shipHostile('rebel', 'imperial'), 'shipHostile: Rebels never start on the player, and fight the Empire');
  ok(!shipHostile('blacksun', 'pirate') && !shipHostile('pirate', 'blacksun'), 'shipHostile: Black Sun and pirates leave each other alone');
  ok(all.every((f) => !shipHostile(f, f)), 'shipHostile: nobody attacks its own faction');
  ok(all.every((f) => !shipHostile('neutral', f)), 'shipHostile: the neutral attack nobody');
  ok(shipStanding('imperial') === 'enemy' && shipStanding('rebel') === 'friend' && shipStanding('neutral') === 'neutral', 'shipStanding: enemy, friend, neutral');
  ok(sideOfFaction('pirate') === 'hostile' && sideOfFaction('imperial') === 'imperial' && aggressionOfFaction('rebel') === 'defensive' && FACTION_LABEL.blacksun === 'Black Sun', 'sides, aggression and labels');
}

// ---------------------------------------------------------------------------------------------
// The roster.
{
  const v1: SpacePackLike = { stations: [{ name: 'station_tatooine', model: 'spacestation_neutral', x: 2311, y: -5872, z: 1865 }] };
  const a1 = anchorsOf(v1);
  ok(a1.length === 2 && a1[0].faction === 'neutral' && a1[0].x === -2311 && a1[0].radius === 300, 'anchorsOf: a version-1 pack gives its station (X mirrored, default radius)');
  const lane = a1.find((a) => a.faction === 'lane')!;
  const toSt = Math.hypot(a1[0].x, a1[0].y, a1[0].z);
  ok(!!lane && near(Math.hypot(lane.x, lane.y, lane.z), 2000, 1e-6) && near((lane.x * a1[0].x + lane.y * a1[0].y + lane.z * a1[0].z) / (2000 * toSt), 1, 1e-9), 'anchorsOf: the lane lies 2 km from the arrival (the origin) toward the nearest station');
  const v2: SpacePackLike = {
    stations: [{ name: 'station_deep', model: 'spacestation_imperial', x: 9000, y: 0, z: 0, radius: 500 }],
    scenery: [{ near: 'space_heavy1_0' }],
    arrival: { x: 0, y: 0, z: 100 },
    hyperspace: { points: [{ id: 'space_heavy1_0', name: 'Point A', x: 100, y: 0, z: 3000 }, { id: 'space_heavy1_1', name: 'Point B', x: -4000, y: 0, z: -4000 }] },
  };
  const a2 = anchorsOf(v2);
  ok(a2.find((a) => a.name === 'Point A')?.faction === 'imperial' && a2.find((a) => a.name === 'Point B')?.faction === 'neutral' && a2.find((a) => a.name === 'Point A')?.x === -100, "anchorsOf: hyperspace points are neutral, imperial when a scenery's near names them, X mirrored");
  ok(a2[0].faction === 'imperial' && a2[0].radius === 500, 'anchorsOf: an imperial station by its model');
  const noStation = anchorsOf({ arrival: { x: 50, y: 0, z: 0 } });
  ok(noStation.length === 1 && noStation[0].faction === 'lane' && noStation[0].x === -50, 'anchorsOf: with no station the lane is at the arrival');
  const crowded = anchorsOf({ arrival: { x: 0, y: 0, z: 0 }, hyperspace: { points: [{ id: 'p', x: 0, y: 0, z: 1000 }] } });
  ok(!crowded.some((a) => a.faction === 'lane'), 'anchorsOf: the lane is dropped with another anchor within 1.5 km');
  ok(anchorsOf(null).length === 0, 'anchorsOf: null gives none');
  ok(stationFaction('station_rebel_x', '') === 'rebel' && stationFaction('x', 'spacestation_neutral') === 'neutral', 'stationFaction by name or model');
  ok(JSON.stringify(anchorRecipes('neutral', 1, 0)) === '["pirate"]' && JSON.stringify(anchorRecipes('neutral', 4, 1)) === '["blacksun"]' && JSON.stringify(anchorRecipes('imperial', 3, 0)) === '["imperial","imperial"]', 'anchorRecipes: raiders at a neutral anchor, two of its own at a military one');
  const types: NpcTypeDef[] = [];
  const addType = (family: string, base: string, style: string | null, tier: number, faction: NpcTypeDef['faction']) => types.push({ id: `${family}_tier${tier}`, name: family, family, base, style, tier, hull: family, chassis: `${base}_tier${tier}`, faction, taunts: 'generic' });
  for (let t = 1; t <= 5; t++) addType('z95', 'z95', null, t, 'pirate');
  for (let t = 1; t <= 3; t++) addType('hutt_light_s01', 'hutt_light', 's01', t, 'pirate');
  for (let t = 1; t <= 3; t++) addType('hutt_light_s02', 'hutt_light', 's02', t, 'pirate');
  const g1 = groupTypes(types, 'pirate', 1, seeded(1));
  ok(!!g1 && g1.length === 3 && g1[0] === 'z95_tier1' && /^hutt_light_s0[12]_tier1$/.test(g1[1]), 'groupTypes: a tier-1 pirate group is a Z-95 and two Scyks of a style');
  const g4 = groupTypes(types, 'pirate', 4, seeded(1));
  ok(g4 === null, 'groupTypes: null when a family of the recipe has no type');
  const g5 = groupTypes(types.concat([]), 'pirate', 1, seeded(2))!;
  ok(g5.every((id) => types.some((t) => t.id === id)), 'groupTypes: every id is a type');
}

// ---------------------------------------------------------------------------------------------
// The pilot.
{
  const s: Stick = { x: 0, y: 0, roll: 0 };
  const BANK = THREE.MathUtils.degToRad(35);
  steerToward({ x: -1, y: 0, z: 0.2 }, BANK, null, s);
  ok(s.x > 0 && s.roll > 0, 'steerToward: a target to the right turns right and rolls right past the bank angle');
  steerToward({ x: 0, y: -0.2, z: 1 }, BANK, null, s);
  ok(s.y > 0, 'steerToward: a target below pushes the nose down');
  steerToward({ x: 0.001, y: 0.001, z: 1 }, BANK, null, s);
  ok(Math.abs(s.x) < 0.01 && Math.abs(s.y) < 0.01 && s.roll === 0, 'steerToward: dead ahead, the stick is near centre');
  steerToward({ x: 0, y: 0, z: -1 }, BANK, null, s);
  ok(Math.abs(s.y) === 1, 'steerToward: straight behind, a full pull');
  steerToward({ x: 0, y: 0, z: 1 }, BANK, { x: -0.3, y: 0.95, z: 0 }, s);
  ok(s.roll > 0, "steerToward: a planet's up to the right rolls right to level");
  ok(near(offNose({ x: 0, y: 1, z: 0 }), Math.PI / 2), 'offNose: a right angle');

  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.1, 0.7));
  const v = { x: 1, y: 2, z: 3 };
  const l = toLocal(q, v, { x: 0, y: 0, z: 0 });
  const back = toWorld(q, l, { x: 0, y: 0, z: 0 });
  const three = new THREE.Vector3(1, 2, 3).applyQuaternion(q.clone().invert());
  ok(near(l.x, three.x, 1e-9) && near(l.y, three.y, 1e-9) && near(l.z, three.z, 1e-9) && near(back.x, 1, 1e-9) && near(back.y, 2, 1e-9) && near(back.z, 3, 1e-9), "toLocal is three's inverse rotation, toWorld undoes it");

  // A kinematic run in flyShip's own integration (rate 1.1, inertia 0.55): the nose onto a target behind-left-above.
  const fly = (a: THREE.Quaternion, spin: THREE.Vector3, st: Stick, dt: number) => {
    const rate = 1.1;
    const inertia = 0.55;
    const ease = Math.min(1, dt / inertia);
    const easeRoll = Math.min(1, (2 * dt) / inertia);
    spin.y += (-st.x * rate * 1.5 - spin.y) * ease;
    spin.x += (st.y * rate * 1.5 - spin.x) * ease;
    spin.z += (st.roll * rate * 1.6 - spin.z) * easeRoll;
    a.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin.y * dt));
    a.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spin.x * dt));
    a.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin.z * dt));
    a.normalize();
  };
  {
    const a = new THREE.Quaternion();
    const spin = new THREE.Vector3();
    const target = new THREE.Vector3(1, 0.6, -1).normalize();
    const loc = { x: 0, y: 0, z: 0 };
    let t = 0;
    const dt = 1 / 60;
    let off = Math.PI;
    while (t < 4) {
      toLocal(a, target, loc);
      off = offNose(loc);
      if (off < THREE.MathUtils.degToRad(5)) break;
      steerToward(loc, BANK, null, s);
      fly(a, spin, s, dt);
      t += dt;
    }
    ok(off < THREE.MathUtils.degToRad(5), `the controller puts the nose within 5 degrees of a target behind-left-above in under 4 s (${t.toFixed(2)} s)`);
  }
  {
    const a = new THREE.Quaternion();
    const spin = new THREE.Vector3();
    const pos = new THREE.Vector3(0, 0, 0);
    const tgt = new THREE.Vector3(600, 200, 1350);
    const tv = new THREE.Vector3(-1, 0, 0.3).normalize().multiplyScalar(200);
    const dir = new THREE.Vector3();
    const loc = { x: 0, y: 0, z: 0 };
    const dt = 1 / 60;
    let t = 0;
    const start = pos.distanceTo(tgt);
    while (t < 15 && pos.distanceTo(tgt) >= 400) {
      dir.copy(tgt).sub(pos).normalize();
      toLocal(a, dir, loc);
      steerToward(loc, BANK, null, s);
      fly(a, spin, s, dt);
      pos.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(a), 280 * dt);
      tgt.addScaledVector(tv, dt);
      t += dt;
    }
    ok(start > 1450 && pos.distanceTo(tgt) < 400, `a pursuer at 280 m/s closes from ${start.toFixed(0)} m to under 400 m on a target at 200 m/s within 15 s (${t.toFixed(1)} s)`);
  }
  const leaderQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const fp = formationPoint({ x: 10, y: 0, z: 0 }, leaderQ, { x: -50, y: 50, z: 25 }, { x: 0, y: 0, z: 0 });
  const expect = new THREE.Vector3(-50, 50, 25).applyQuaternion(leaderQ).add(new THREE.Vector3(10, 0, 0));
  ok(near(fp.x, expect.x, 1e-9) && near(fp.y, expect.y, 1e-9) && near(fp.z, expect.z, 1e-9) && near(fp.x, 35, 1e-9) && near(fp.z, 50, 1e-9), 'formationPoint: a leader turned 90 degrees carries the slot with it');
  const aim = aimPoint({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 600 }, { x: 100, y: 0, z: 0 }, 600, 1, { x: 0, y: 0, z: 0 });
  ok(!!aim && aim.x > 0 && near(Math.hypot(aim.x, aim.z) / 600, Math.hypot(aim.x, aim.z - 0) / 600), 'aimPoint leads a crossing target');
  ok(aimPoint({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: 900 }, 600, 1, { x: 0, y: 0, z: 0 }) === null, 'aimPoint: null for a target the bolt cannot catch');
  ok(slotCruise(200, 50, 300) < 200 && slotCruise(200, -50, 300) > 200 && slotCruise(200, -1e4, 300) === 300 && slotCruise(0, 1e4, 300) === 8, 'slotCruise pulls toward the slot within its range');
}

// ---------------------------------------------------------------------------------------------
// Taunts.
{
  ok(fillTaunt('ATTENTION!  %TU, Lower your shields. %NU!', 'Kira') === 'ATTENTION!  Kira, Lower your shields. Kira!', 'fillTaunt fills %TU and %NU');
  ok(fillTaunt('%TU!', '') === 'pilot!', "fillTaunt: an empty name reads 'pilot'");
  const gate = new TauntGate(() => 0);
  ok(gate.want(5, 'gothit', 10), 'TauntGate: a first line is let through');
  ok(!gate.want(6, 'gothit', 10 + TAUNT_ANY_GAP - 0.1), 'TauntGate: nobody within TAUNT_ANY_GAP of the last line');
  ok(gate.want(6, 'gothit', 10 + TAUNT_ANY_GAP + 0.1), 'TauntGate: another ship after the gap');
  ok(!gate.want(5, 'gothit', 10 + TAUNT_SHIP_GAP - 0.1), 'TauntGate: one ship not twice within TAUNT_SHIP_GAP');
  ok(gate.want(5, 'gothit', 10 + TAUNT_SHIP_GAP + 0.1), 'TauntGate: the same ship after its gap');
  const never = new TauntGate(() => 0.99);
  ok(!never.want(1, 'gothit', 100), "TauntGate: an event's chance applies");
  const r = seeded(9);
  const seededGate = new TauntGate(r);
  let lastSaid = -Infinity;
  let bad = false;
  for (let t = 0; t < 200; t += 0.25) if (seededGate.want(1 + (Math.floor(t) % 3), 'entercombat', t)) {
    if (t - lastSaid < TAUNT_ANY_GAP) bad = true;
    lastSaid = t;
  }
  ok(!bad, 'TauntGate with a seeded rng: never two lines within TAUNT_ANY_GAP');
  ok(pickLine([], Math.random) === null && pickLine(['a', 'b'], () => 0.99) === 'b', 'pickLine');
}

// ---------------------------------------------------------------------------------------------
// The Edit page's line.
{
  ok(/^grade 3 · top speed ×1\.0[23]$/.test(componentLine('engine', { name: 'eng_kuat_improved', type: 'engine' })), `componentLine: an engine (${componentLine('engine', { name: 'eng_kuat_improved', type: 'engine' })})`);
  ok(componentLine('weapon_0', { name: 'wpn_incom_blaster', type: 'weapon', weapon: bolt(4) }) === 'grade 2 · 30 damage · 600 m/s · 512 m', 'componentLine: a gun');
  ok(componentLine('weapon_1', { name: 'wpn_concussion_missile', type: 'weapon', weapon: { ...bolt(12), missile: 1 } }) === 'grade 2 · not flown yet', 'componentLine: a missile is not flown yet');
  ok(componentLine('shield_0', { name: 'shd_kuat_elite', type: 'shield' }) === 'grade 4 · ×1.2 hit points', 'componentLine: a shield');
}

// ---------------------------------------------------------------------------------------------
// The combat file's reader.
{
  const file: CombatFile = {
    version: 1,
    formations: { arrow: { space: [[0, 0, 0], [-25, 25, 25]], flat: [[0, 0, 0], [-25, 0, 25]] } },
    taunts: { generic_low: { entercombat: ['Hey %TU'], gothit: [], hityou: [], death: [] } },
    hitEffects: { shield: { hit: ['particles/a.json', null, 'particles/b.json'], event: [null, null, 'particles/c.json'] } },
    hitSounds: {},
    target: { friendly: 'particles/f.json', enemy: 'particles/e.json', activate: 'particles/a.json', activateEnemy: null, deactivate: 'particles/d.json', scale: 1, sounds: { activate: '', deactivate: '', acquiring: '', acquired: '' }, overrides: {} },
    chassis: { z95_tier1: { slots: { reactor: { hitweight: 10, targetable: true } } } },
    types: [
      { id: 'z95_tier2', name: 'Z-95 (2)', family: 'z95', base: 'z95', style: null, tier: 2, hull: 'z95', chassis: 'z95_tier2', faction: 'pirate', taunts: 'generic' },
      { id: 'z95_tier1', name: 'Z-95', family: 'z95', base: 'z95', style: null, tier: 1, hull: 'z95', chassis: 'z95_tier1', faction: 'pirate', taunts: 'generic_low' },
      { id: 'tiefighter_tier1', name: 'TIE Fighter', family: 'tiefighter', base: 'tiefighter', style: null, tier: 1, hull: 'tiefighter', chassis: 'tiefighter_tier1', faction: 'imperial', taunts: 'imperial_low' },
    ],
    hulls: { z95: { destroyed: 'particles/boom.json', damage: [{ from: 0.3, to: 0.4, hardpoint: null, position: [0, 0, -2], particle: 'particles/smoke.json' }] } },
    skipped: [],
  };
  const d = new CombatData(file);
  const fam = d.families();
  ok(fam.length === 2 && fam[0].family === 'tiefighter' && fam[1].name === 'Z-95' && JSON.stringify(fam[1].tiers) === '[1,2]', 'CombatData.families: by faction, named at the lowest tier, with their tiers');
  ok(d.typeById('z95_tier1')?.name === 'Z-95' && d.typeById('nope') === null, 'CombatData.typeById');
  ok(d.typesOfFamily('z95').map((t) => t.tier).join() === '1,2', 'CombatData.typesOfFamily by tier');
  ok(d.formation('arrow', false)[1][2] === 25 && d.formation('claw', true).length === 0, 'CombatData.formation, and an empty list for one the pack lacks');
  const files = d.effectFiles();
  ok(files.includes('particles/boom.json') && files.includes('particles/smoke.json') && files.includes('particles/c.json') && !files.includes('particles/d.json') && new Set(files).size === files.length, 'CombatData.effectFiles: hits, events, target, bands, explosions once each (not the deactivate splash)');
  ok(d.chassis('z95_tier1') !== null && d.chassis('toString') === null && d.taunts('generic_low')?.entercombat[0] === 'Hey %TU', 'CombatData.chassis and taunts (no prototype keys)');
  // A missing file: Vite answers with index.html and a 200.
  const realFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
  const none = await CombatData.load('/');
  (globalThis as { fetch: typeof fetch }).fetch = (async () => new Response(JSON.stringify({ version: 2, types: [], chassis: {} }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const wrong = await CombatData.load('/');
  (globalThis as { fetch: typeof fetch }).fetch = (async () => new Response(JSON.stringify(file), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const good = await CombatData.load('/');
  (globalThis as { fetch: typeof fetch }).fetch = realFetch;
  ok(none === null && wrong === null && good?.file.types.length === 3, 'CombatData.load: null for a page that is not JSON or a file of another version');
}

console.log(`shipCombat.test: ${checks} checks passed`);
