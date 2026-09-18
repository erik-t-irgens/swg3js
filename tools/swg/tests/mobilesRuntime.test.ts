// The run-time side of the creatures, droids and people: the keys that tell one living thing
// from another, whose side each is on, who picks a fight with whom, and picking one out of a
// crowd. Plain node over the pure modules, no browser API and no three.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { NOBODY, PLAYER_KEY, nextLivingKey } from '../../../src/combat/kit.ts';
import { hostileSides, nearestInCone, nearestTo, byKey, sideOf } from '../../../src/combat/targets.ts';
import { buildIndex, groupTree, resolveEntry, searchEntries } from '../../../src/world/mobiles/catalogueIndex.ts';
import { planBody, radiusToward, type BodyInput } from '../../../src/world/mobiles/shape.ts';
import { GAIT_LIMITS, blendWeight, chooseGait, clampFades, moveSpeeds, oneShotWeight, stepGait } from '../../../src/world/mobiles/gait.ts';
import { BRAIN_TUNE, decide, hostile, wanderPoint, type BrainSelf, type BrainTarget } from '../../../src/world/mobiles/brain.ts';
import { LOD_TUNE, lodTier, type LodInput } from '../../../src/world/mobiles/lod.ts';
import { makeAdditiveOnce, missingRoles, rigClipsFromPack, rolesFor, type PackClipSource } from '../../../src/world/mobiles/packClips.ts';
import type { AnimPack, MobileAppearance, MobileEntry, Roles } from '../../../src/world/mobiles/types.ts';
import { armedRoles, armsFor, chooseWeapon, gunKindForRoles, hintFor, hintForEntry, muzzleBone, SABER_SWINGS, wantsSaber } from '../../../src/world/mobiles/arms.ts';
import { ambientOverrides, groupPicks, HUMANOID_BOUNDS, lookBounds, permanentGap, spawnDistance, speciesOf } from '../../../src/world/mobiles/spawning.ts';
import type { WeaponClass } from '../../../src/player/weapons.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const body = (x: number, y: number, z: number, extra: { dead?: boolean; key?: number } = {}) => ({
  pos: { x, y, z },
  halfHeight: 0.9,
  dead: extra.dead ?? false,
  key: extra.key ?? 0,
});

// --- 26: the keys ----------------------------------------------------------------------------
// The player is the one key that is a named constant, and nothing else may ever be given it:
// a caller that stores "who I am after" as a number must not read 0 as the player.
ok(PLAYER_KEY === 1, 'the player key is 1');
ok(NOBODY === 0, 'nobody is 0');
ok(!NOBODY, 'nobody is falsy, so `if (key)` reads as "is there anybody"');
{
  const keys: number[] = [];
  for (let i = 0; i < 500; i++) keys.push(nextLivingKey());
  ok(keys.every((k) => k !== NOBODY && k !== PLAYER_KEY), 'nextLivingKey never gives 0 or the player key');
  ok(keys.every((k) => k >= 2), 'every fresh key is 2 or more');
  ok(new Set(keys).size === keys.length, 'no key is handed out twice');
  ok(keys.every((k, i) => i === 0 || k > keys[i - 1]), 'keys only go up, so one is never reused while the page lives');
}
// A target that was dropped is null, never 0 and never 1: `byKey` reads both the same way.
{
  const list = [body(0, 0, 0, { key: PLAYER_KEY }), body(1, 0, 0, { key: 7 })];
  ok(byKey(list, null) === null, 'a dropped target (null) finds nobody');
  ok(byKey(list, NOBODY) === null, 'a dropped target stored as NOBODY finds nobody, not the player');
  ok(byKey(list, PLAYER_KEY) === list[0], 'the player key finds the player');
  ok(byKey(list, 7) === list[1], 'a living key finds its body');
  ok(byKey(list, 99) === null, 'an unknown key finds nobody');
}

// --- 33: sideOf ------------------------------------------------------------------------------
ok(sideOf({ id: 'stormtrooper', kind: 'npc' }) === 'imperial', 'an imperial id is imperial');
ok(sideOf({ id: 'imperial/scout_trooper', kind: 'npc' }) === 'imperial', 'an imperial folder is imperial');
ok(sideOf({ id: 'rebel_trooper', kind: 'npc' }) === 'rebel', 'a rebel id is rebel');
ok(sideOf({ id: 'alliance_pilot', kind: 'dressed' }) === 'rebel', 'an alliance id is rebel');
ok(sideOf({ id: 'rancor', kind: 'creature' }) === 'wild', 'a creature is wild');
ok(sideOf({ id: 'som/lava_flea', kind: 'special' }) === 'wild', 'a special is wild too');
ok(sideOf({ id: 'pirate_captain', kind: 'npc' }) === 'hostile', 'a hostile keyword in the id is hostile');
ok(sideOf({ id: 'some_person', kind: 'npc', group: 'npcs/thug' }) === 'hostile', 'a hostile keyword in the group is hostile');
ok(sideOf({ id: 'town_villager', kind: 'npc' }) === 'civilian', 'a civilian keyword is civilian');
ok(sideOf({ id: 'moisture_technician', kind: 'npc' }) === 'neutral', 'anything unrecognised is neutral');
ok(sideOf({ id: 'plain_person', kind: 'npc', stats: { tags: ['hostile'] } }) === 'hostile', "the converter's own hostile tag is read");
ok(sideOf({ id: 'plain_person', kind: 'npc', tags: ['civilian'] }) === 'civilian', 'a top-level civilian tag is read too');
// The faction is read before the kind, and the kind before the keywords: a creature carrying a
// hostile tag is still wild, but one whose id names a faction is not.
ok(sideOf({ id: 'wild_bantha', kind: 'creature', stats: { tags: ['hostile'] } }) === 'wild', 'a creature with a hostile tag is still wild');
ok(sideOf({ id: 'imperial_probot', kind: 'droid' }) === 'imperial', 'a droid on a faction takes the faction');

// --- 24 (the matrix targets.ts owns): who picks a fight ----------------------------------------
const who = (side: Parameters<typeof hostileSides>[0]['side'], aggression: Parameters<typeof hostileSides>[0]['aggression'] = 'aggressive') => ({ side, aggression });
ok(!hostileSides(who('wild', 'defensive'), who('player')), 'nothing but an aggressive one picks a fight');
ok(!hostileSides(who('wild'), who('neutral', 'passive')), 'nothing picks on a passive one (a hologram, a vendor)');
ok(hostileSides(who('fighter'), who('civilian')) && hostileSides(who('fighter'), who('player')) && hostileSides(who('fighter'), who('fighter')), 'a fighter fights every person that is not passive, other fighters included');
ok(!hostileSides(who('fighter'), who('wild')) && !hostileSides(who('fighter'), who('wild', 'defensive')), 'a fighter leaves the wildlife alone rather than walking off after a bantha');
ok(!hostileSides(who('fighter'), who('civilian', 'passive')), 'a fighter still leaves a passive person alone');
ok(hostileSides(who('wild'), who('player')) && hostileSides(who('wild'), who('imperial')) && !hostileSides(who('wild'), who('wild')), 'a wild predator takes people, not the herd');
ok(!hostileSides(who('hostile'), who('hostile')) && hostileSides(who('hostile'), who('civilian')), 'a hostile humanoid takes everything but other hostiles');
ok(!hostileSides(who('hostile'), who('wild', 'skittish')) && hostileSides(who('hostile'), who('wild')), 'a hostile humanoid takes a wild thing only when that one is aggressive too');
ok(hostileSides(who('imperial'), who('rebel')) && hostileSides(who('imperial'), who('player')) && !hostileSides(who('imperial'), who('civilian')), 'imperials take the player and rebels, not civilians');
ok(hostileSides(who('rebel'), who('imperial')) && !hostileSides(who('rebel'), who('player')), 'rebels take imperials and leave the player alone');
ok(hostileSides(who('civilian'), who('player')) && !hostileSides(who('civilian'), who('civilian')), 'anything else aggressive takes the player and the fighters only');

// --- 34: nearestInCone ------------------------------------------------------------------------
{
  const from = { x: 0, y: 0, z: 0 };
  const forward = { x: 0, y: 0, z: 1 };
  const ahead = body(0, 0, 10);
  const behind = body(0, 0, -5);
  const far = body(0, 0, 40);
  const side = body(10, 0, 1);
  const list = [behind, far, side, ahead];
  ok(nearestInCone(list, { from, forward, range: 30, cone: 0.5 }) === ahead, 'the one in the cone and in range is taken');
  ok(nearestInCone([behind], { from, forward, range: 30, cone: 0.5 }) === null, 'one behind is outside the cone');
  ok(nearestInCone([far], { from, forward, range: 30, cone: 0.5 }) === null, 'one past the range is not taken');
  ok(nearestInCone([side], { from, forward, range: 30, cone: 0.5 }) === null, 'one off to the side is outside the cone');
  ok(nearestInCone([side], { from, forward, range: 30, cone: -1 }) === side, 'a cone of -1 takes everything in range');
  // The nearest wins, and a dead body is passed over however near it is.
  const near = body(0, 0, 3);
  ok(nearestInCone([ahead, near], { from, forward, range: 30, cone: 0.5 }) === near, 'the nearest in the cone wins');
  near.dead = true;
  ok(nearestInCone([ahead, near], { from, forward, range: 30, cone: 0.5 }) === ahead, 'a dead body is passed over');
  // `need` narrows it to what the power can actually do something with.
  ok(nearestInCone([near, ahead], { from, forward, range: 30, cone: 0.5, need: (t) => t !== ahead }) === null, 'need passes over what it says no to');
  // Something on top of you is ahead of you whichever way you face.
  const onTop = body(0.2, 0, -0.2);
  ok(nearestInCone([onTop], { from, forward, range: 30, cone: 0.9 }) === null, 'without `near`, something at your back is out of the cone');
  ok(nearestInCone([onTop], { from, forward, range: 30, cone: 0.9, near: 0.5 }) === onTop, 'inside `near` the cone is not tested');
  // Measured to the middle rather than to the feet: a body below is nearer by its half-height
  // (feet 6.32 m away, middle 5.48), and at a range between the two only the middle counts.
  const below = body(0, -6, 2);
  ok(nearestInCone([below], { from, forward, range: 5.5, cone: -1 }) === null, 'measured at the feet it is out of range');
  ok(nearestInCone([below], { from, forward, range: 5.5, cone: -1, middle: true }) === below, 'measured at the middle it is in range');
}

// --- nearestTo --------------------------------------------------------------------------------
{
  const a = body(0, 0, 0);
  const b = body(4, 0, 0);
  const dead = body(1, 0, 0, { dead: true });
  ok(nearestTo([a, b, dead], { x: 5, y: 0, z: 0 }, 10) === b, 'the nearest to a point wins');
  ok(nearestTo([a, dead], { x: 1, y: 0, z: 0 }, 10) === a, 'a dead body is passed over');
  ok(nearestTo([b], { x: 0, y: 0, z: 0 }, 3) === null, 'past the range, nobody');
  ok(nearestTo([a, b], { x: 5, y: 0, z: 0 }, 10, (t) => t !== b) === a, 'need passes over what it says no to');
}

// === The catalogue, the body, the gait, the brain, the tiers and the clips ====================

const near = (a: number, b: number, eps = 0.006) => Math.abs(a - b) <= eps;

/** A catalogue entry with only what a test cares about filled in. */
function entry(id: string, over: Partial<MobileEntry> = {}): MobileEntry {
  const folder = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
  return {
    id,
    kind: 'creature',
    folder,
    group: 'creatures/predator',
    name: id.slice(id.lastIndexOf('/') + 1).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    subtitle: null,
    flags: [],
    gender: null,
    appearance: id,
    species: null,
    pack: id,
    variant: null,
    custom: {},
    morphs: {},
    outfit: [],
    size: { collisionRadius: 0.5, collisionLength: 1.5, scale: [1, 1], cameraHeight: 0, stepHeight: 0.5, swimHeight: 1 },
    move: { run: 6, walk: 2, turnRun: 90, turnWalk: 180, accel: [9, 3] },
    stats: { source: 'heuristic', sizeClass: 'small', level: null, hp: 80, damage: 8, reach: 1.5, aggression: 'aggressive', ranged: null, attackCooldown: 1.6, tags: [] },
    ready: true,
    outfitReady: true,
    ...over,
  };
}

// --- 1, 2: searchEntries -----------------------------------------------------------------------
{
  const list = [
    entry('boar_wolf', { name: 'Boar wolf' }),
    entry('wolf_kima', { name: 'Kima wolf' }),
    entry('rancor', { name: 'Rancor' }),
    entry('hologram/rancor', { name: 'Rancor (hologram)', flags: ['hologram'] }),
    entry('mutated_rancor', { name: 'Mutated rancor' }),
    entry('rancor_youth', { name: 'Rancor youth', ready: false }),
    entry('rancor_hatchling', { name: 'Rancor hatchling' }),
    entry('bantha', { name: 'Bantha', group: 'creatures/herd' }),
  ];
  const index = buildIndex(list);
  const ids = (q: string, o = {}) => searchEntries(index, q, o).map((e) => e.id);
  ok(ids('boar wolf').includes('boar_wolf'), '"boar wolf" finds boar_wolf');
  ok(ids('wolf').includes('boar_wolf') && ids('wolf').includes('wolf_kima'), '"wolf" finds both wolves');
  ok(!ids('boar kima').length, 'a two-token query needs both tokens');
  ok(ids('rancor', { limit: 2 }).length === 2, 'the limit is honoured');
  ok(ids('').length === 0, 'an empty query finds nothing');
  const r = ids('rancor');
  ok(r[0] === 'rancor', 'an exact name comes first');
  ok(r.indexOf('rancor_hatchling') < r.indexOf('mutated_rancor'), 'a prefix comes before a word further in');
  ok(r.indexOf('rancor_hatchling') < r.indexOf('rancor_youth'), 'ready before not ready at the same score');
  ok(r.indexOf('mutated_rancor') >= 0 && ids('rancor')[r.length - 1] !== 'rancor', 'every match is kept, the exact one first');
  ok(ids('youth', { readyOnly: true }).length === 0, 'readyOnly leaves out what is not ready');
  ok(ids('bantha', { kind: 'droid' }).length === 0, 'the kind filter holds');
  ok(ids('herd').includes('bantha'), 'the group is searched too');

  // --- 3: resolveEntry
  const all = buildIndex([...list, entry('som/lava_flea', { name: 'Lava Flea' }), entry('beast_master/bm_lava_flea', { name: 'Lava Flea (pet)' }), entry('hologram/bantha', { name: 'Bantha (hologram)' })]);
  ok(resolveEntry(all, 'rancor')?.id === 'rancor', "'rancor' is the rancor, not its hologram");
  ok(resolveEntry(all, 'Lava Flea')?.id === 'som/lava_flea', "'Lava Flea' is the som one");
  ok(resolveEntry(all, 'no such beast') === undefined, 'an unknown name gives undefined');
  ok(resolveEntry(all, 'Boar wolf')?.id === 'boar_wolf', 'a display name resolves as an id');
  ok(resolveEntry(all, 'Kima wolf')?.id === 'wolf_kima', 'an exact display name resolves last');
}

// --- 4: groupTree ----------------------------------------------------------------------------
{
  const list = [
    entry('rancor', { name: 'Rancor' }),
    entry('acklay', { name: 'Acklay' }),
    entry('hologram/rancor', { name: 'Rancor (hologram)', flags: ['hologram'] }),
    entry('bantha', { name: 'Bantha', group: 'creatures/herd' }),
    entry('r2', { name: 'R2', kind: 'droid', group: 'droids' }),
    entry('pirate', { name: 'Pirate', kind: 'npc', group: 'npcs/hostile' }),
    entry('dressed_thug_m', { name: 'Thug', kind: 'dressed', group: 'dressed/human_male', species: 'human_male', stats: { ...entry('x').stats, tags: ['hostile'] } }),
    entry('dressed_farmer_m', { name: 'Farmer', kind: 'dressed', group: 'dressed/human_male', species: 'human_male', stats: { ...entry('x').stats, tags: ['civilian'] } }),
    entry('dressed_farmer_f', { name: 'Farmer', kind: 'dressed', group: 'dressed/human_female', species: 'human_female', stats: { ...entry('x').stats, tags: ['civilian'] } }),
    entry('bobble', { name: 'Bobble', kind: 'special', group: 'specials' }),
  ];
  const tree = groupTree(list);
  const groupOf = (id: string) => tree.flatMap((k) => k.groups).find((g) => g.entries.some((e) => e.id === id));
  ok(groupOf('hologram/rancor')?.key === 'extras/hologram', 'a hologram lands in the extras');
  ok(!tree.find((k) => k.key === 'creature')!.groups.some((g) => g.entries.some((e) => e.id === 'hologram/rancor')), '... and not among the creatures');
  ok(groupOf('dressed_thug_m')?.label === 'Dressed NPCs: Human male, hostile', 'a dressed entry groups by species and keyword');
  ok(groupOf('dressed_farmer_m') !== groupOf('dressed_farmer_f') && groupOf('dressed_farmer_m') !== groupOf('dressed_thug_m'), 'each species and keyword is its own group');
  const creatures = tree.find((k) => k.key === 'creature')!;
  ok(creatures.total === 3, 'a category carries its count');
  ok(creatures.groups.map((g) => g.label).join('|') === [...creatures.groups.map((g) => g.label)].sort((a, b) => a.localeCompare(b)).join('|'), 'groups are sorted by name');
  ok(groupOf('rancor')!.entries.map((e) => e.id).join(',') === 'acklay,rancor', 'entries are sorted by name');
  ok(tree.map((k) => k.key).join(',') === 'creature,droid,npc,dressed,special,extras', 'the categories come in their order');
}

// The same rules on the converted catalogue, when this machine has it.
{
  const file = new URL('../../../assets-private/mobiles/catalogue.json', import.meta.url);
  if (existsSync(file)) {
    const cat = JSON.parse(readFileSync(file, 'utf8')) as { entries: MobileEntry[] };
    const index = buildIndex(cat.entries);
    ok(resolveEntry(index, 'rancor')?.id === 'rancor', 'on the real catalogue: rancor is the root one');
    ok(resolveEntry(index, 'Lava Flea')?.id === 'som/lava_flea', 'on the real catalogue: Lava Flea is the som one');
    const tree = groupTree(cat.entries);
    ok(tree.reduce((n, k) => n + k.total, 0) === cat.entries.length, 'on the real catalogue: the tree holds every entry once');
  } else console.log('skip the real-catalogue checks: assets-private/mobiles/catalogue.json is not on this machine');
}

// --- 5-12: shape -----------------------------------------------------------------------------
/** A body from the worked extents: W across, H above the origin, L along, centred. */
function body5(W: number, H: number, L: number, cr: number, stepHeight: number, hierarchy: BodyInput['hierarchy'], flags: string[] = [], sizeClass: BodyInput['sizeClass'] = 'small'): BodyInput {
  return { hierarchy, flags, bounds: { min: [-W / 2, 0, -L / 2], max: [W / 2, H, L / 2] }, collisionRadius: cr, collisionLength: L, stepHeight, swimHeight: 1, sizeClass, scale: 1 };
}
{
  const humanoid = planBody(body5(1.14, 1.8, 0.32, 0.5, 0.5, 'all_b'));
  const total = (p: ReturnType<typeof planBody>) => 2 * p.feet;
  ok(humanoid.kind === 'upright' && humanoid.colliders.length === 1 && humanoid.colliders[0].shape === 'capsule', 'humanoid: one capsule');
  ok(near(humanoid.colliders[0].radius, 0.38) && near(total(humanoid), 1.66) && near(humanoid.feet, 0.83) && near(humanoid.halfHeight, 0.9), 'humanoid: r 0.38, h 1.66, feet 0.83, halfHeight 0.90');
  ok(near(humanoid.along, 0.38) && near(humanoid.across, 0.38) && Math.round(humanoid.mass) === 197, 'humanoid: along = across 0.38, mass 197');

  const bantha = planBody(body5(2.5, 3.1, 6.9, 1.7, 0.6, 'creature_base', [], 'large'));
  ok(bantha.kind === 'long' && bantha.colliders.length === 4, 'bantha: long, a support and three hull balls');
  ok(near(bantha.colliders[0].radius, 1.24) && near(total(bantha), 2.48) && near(bantha.feet, 1.24) && near(bantha.halfHeight, 1.55), 'bantha: support r 1.24 h 2.48, feet 1.24, halfHeight 1.55');
  const bh = bantha.colliders.slice(1);
  ok(bh.every((c) => near(c.radius, 1.24) && near(c.at[1] + bantha.feet, 1.84)), 'bantha: hull balls r 1.24 at y 1.84');
  ok(near(bh[0].at[2], -2.21) && near(bh[1].at[2], 0) && near(bh[2].at[2], 2.21), 'bantha: hull at z -2.21, 0, +2.21');
  ok(near(bantha.along, 3.45) && near(bantha.across, 1.24) && Math.round(bantha.mass) === 16043, 'bantha: along 3.45, across 1.24, mass 16,043');

  const rancor = planBody(body5(8.2, 9.5, 9.7, 2.2, 1.6, 'creature_base', ['swims'], 'huge'));
  ok(rancor.kind === 'upright' && rancor.colliders.length === 1, 'rancor: upright (L 9.7 under the gate 15.20)');
  ok(near(rancor.colliders[0].radius, 1.92) && near(total(rancor), 8.74) && near(rancor.feet, 4.37) && near(rancor.halfHeight, 4.75) && rancor.mass === 60000, 'rancor: r 1.92, h 8.74, feet 4.37, halfHeight 4.75, mass capped');

  const krayt = planBody(body5(6.0, 8.1, 29.2, 9.0, 2.0, 'creature_base', [], 'huge'));
  ok(krayt.kind === 'long' && krayt.colliders.length === 6, 'krayt: long, five hull balls');
  ok(near(krayt.colliders[0].radius, 3.0) && near(total(krayt), 6.48) && near(krayt.feet, 3.24) && near(krayt.halfHeight, 4.05), 'krayt: support r 3.00 h 6.48, feet 3.24, halfHeight 4.05');
  ok(krayt.colliders.slice(1).every((c) => near(c.radius, 3.0) && near(c.at[1] + krayt.feet, 5.0)), 'krayt: hull r 3.00 at y 5.00');
  ok(krayt.colliders.slice(1).map((c) => c.at[2].toFixed(1)).join(',') === '-11.6,-5.8,0.0,5.8,11.6', 'krayt: hull at z -11.6 .. +11.6');
  ok(near(krayt.along, 14.6) && near(krayt.across, 3.0) && krayt.mass === 60000, 'krayt: along 14.60, across 3.00, mass capped');

  const womp = planBody(body5(0.9, 0.8, 2.0, 0.3, 0.3, 'creature_base'));
  ok(womp.kind === 'long' && womp.colliders.length === 4, 'womp rat: long, three hull balls');
  ok(near(womp.colliders[0].radius, 0.3) && near(total(womp), 0.64) && near(womp.feet, 0.32) && near(womp.halfHeight, 0.4), 'womp rat: support r 0.30 h 0.64, feet 0.32, halfHeight 0.40');
  ok(womp.colliders.slice(1).every((c) => near(c.radius, 0.32) && near(c.at[1] + womp.feet, 0.62)), 'womp rat: hull r 0.32 at y 0.62');
  ok(womp.colliders.slice(1).map((c) => c.at[2].toFixed(2)).join(',') === '-0.68,0.00,0.68', 'womp rat: hull at z -0.68, 0, +0.68');
  ok(near(womp.along, 1.0) && near(womp.across, 0.32) && Math.round(womp.mass) === 432, 'womp rat: along 1.00, across 0.32, mass 432');

  const flyer = planBody(body5(1.8, 0.2, 1.0, 1.25, 0.3, 'creature_base', ['flyer']));
  ok(flyer.kind === 'flyer' && flyer.colliders[0].shape === 'ball' && near(flyer.colliders[0].radius, 0.54) && near(flyer.feet, 0.54) && near(flyer.halfHeight, 0.54), 'flyer: one ball r 0.54, feet 0.54, halfHeight 0.54');
  ok(near(flyer.hover, 1.5) && near(flyer.along, 0.54) && Math.round(flyer.mass) === 108, 'flyer: hover 1.50, along 0.54, mass 108');

  const droid = planBody(body5(0.6, 2.5, 0.6, 0.5, 0.4, 'other'));
  ok(near(droid.colliders[0].radius, 0.3) && near(total(droid), 2.3) && near(droid.feet, 1.15) && near(droid.halfHeight, 1.25) && Math.round(droid.mass) === 270, 'tall thin droid: the footprint term bites, r 0.30, h 2.30');

  // 6: the long gate.
  ok(planBody(body5(1.14, 1.8, 9, 0.5, 0.5, 'all_b')).kind === 'upright', 'an all_b body is upright however long its box');
  ok(planBody(body5(2.5, 3.1, 6.9, 1.7, 0.6, 'creature_base', ['flyer'])).kind === 'flyer', 'a flyer flag beats the long gate');
  // 7: never narrower than the player's own capsule by more than a rounding.
  ok(humanoid.colliders[0].radius >= 0.35, 'the humanoid capsule takes the larger horizontal extent (0.38, not 0.16)');
  // 8: the hull leaves the terrain out.
  ok(bantha.colliders[0].terrain && bantha.colliders.slice(1).every((c) => !c.terrain), 'hull balls leave out the terrain; the support does not');
  // 9: radiusToward.
  ok(near(radiusToward(bantha, 0, 0, 10), 3.45) && near(radiusToward(bantha, 0, 10, 0), 1.24), 'a long body: the half-length ahead, the half-width at the flank');
  ok(near(radiusToward(bantha, Math.PI / 2, 10, 0), 3.45), 'the heading turns the ellipse');
  ok(near(radiusToward(humanoid, 1.3, 3, 4), 0.38) && near(radiusToward(flyer, 0.4, -2, 1), 0.54), 'upright and flyer: the support radius every way');
  // 10: swapped corners, a zero box, a capsule on exactly 2r.
  const swapped = planBody({ ...body5(2.5, 3.1, 6.9, 1.7, 0.6, 'creature_base', [], 'large'), bounds: { min: [1.25, 3.1, 3.45], max: [-1.25, 0, -3.45] } });
  ok(JSON.stringify(swapped.colliders) === JSON.stringify(bantha.colliders) && near(swapped.feet, bantha.feet), 'swapped box corners plan the same body');
  const zero = planBody(body5(0, 0, 0, 0.5, 0.5, 'other'));
  ok(zero.colliders[0].radius === 0.15 && zero.colliders[0].half > 0, 'a zero-sized box gets the minimum radius, not zero');
  const flat = planBody(body5(2, 0.1, 2, 5, 0.5, 'other'));
  ok(flat.colliders[0].half > 0 && near(flat.feet, flat.colliders[0].radius), 'a capsule whose height is exactly 2r still has a cylinder');
  // 11: knock resistance and holding by size.
  ok(planBody(body5(1, 1, 1, 0.5, 0.5, 'other', [], 'tiny')).knockResist === 1.2 && bantha.knockResist === 0.35 && rancor.knockResist === 0.08, 'knockResist by size class');
  ok(humanoid.canHold && !bantha.canHold && !rancor.canHold && planBody(body5(1, 1, 1, 0.5, 0.5, 'other', [], 'medium')).canHold, 'only below large can be held');
  // 12: the cull sphere.
  const c = planBody({ ...body5(2, 3, 4, 0.5, 0.5, 'other'), bounds: { min: [-1, -1, -2], max: [1, 3, 2] } });
  ok(near(c.cull.radius, 0.62 * Math.hypot(2, 4, 4)) && near(c.cull.y, 1), 'the cull sphere: 0.62 of the box diagonal, centred on the box');
}

// --- 13-16: gait -----------------------------------------------------------------------------
function roles(over: Partial<Roles> = {}): Roles {
  return {
    idle: 'idle', walk: 'walk', run: 'run', gaits: [], idleCombat: null, walkCombat: null, runCombat: null, gaitsCombat: [],
    swimIdle: null, swim: null, gaitsSwim: [], hoverIdle: null, hover: null, gaitsHover: [], toCombat: null, fromCombat: null,
    turnLeft: null, turnRight: null, attacks: [], hoverAttacks: [], ranged: null, rangedAdditive: false, rangedStance: null,
    hitLight: null, hitMedium: null, hitHeavy: null, hitWhileDown: null, down: null, downLoop: null, getUp: null,
    knockdown: null, knockdownLoop: null, knockdownGetUp: null, swimDown: null, swimDownLoop: null, hoverDown: null, emotes: {}, bind: null,
    ...over,
  };
}
const gaitsOf = (walk: number, run: number) => [{ clip: 'walk', speed: walk }, { clip: 'run', speed: run }];
{
  const bantha = moveSpeeds(roles({ gaits: gaitsOf(0.86, 3.47) }), 1, { run: 6.98, walk: 4 });
  ok(near(bantha.walk, 1.2, 0.01) && near(bantha.run, 5.2, 0.01), 'bantha walks at 1.20 and runs at 5.20, not 6.9');
  const rancor = moveSpeeds(roles({ gaits: gaitsOf(1.259, 7.012) }), 1, { run: 7.01, walk: 4.5 });
  ok(near(rancor.walk, 1.76, 0.01) && near(rancor.run, 7.01, 0.01), 'rancor walks at 1.76 and runs at 7.01');
  const person = moveSpeeds(roles({ gaits: gaitsOf(1.549, 5.132) }), 1, { run: 6, walk: 2 });
  ok(near(person.walk, 2, 0.001) && near(person.run, 6, 0.001), 'a humanoid walks at 2.00 and runs at 6.00');
  // 14: an unbelievable clip.
  const tanray = moveSpeeds(roles({ gaits: gaitsOf(1.2, 55.6) }), 1, { run: 9, walk: 2 });
  ok(near(tanray.run, 9), 'a clip over 2.2 times the template is not believed: the template speed');
  ok(moveSpeeds(roles({ gaits: gaitsOf(1.2, 20) }), 1, { run: 30, walk: 2 }).run === GAIT_LIMITS.maxSpeed, 'and nothing moves faster than 16');
  ok(moveSpeeds(roles({ gaits: [] }), 1, { run: 6, walk: 2 }).run === 0, 'a pack with no gait stands (a static mobile)');
  ok(near(moveSpeeds(roles({ gaits: gaitsOf(0.86, 3.47) }), 2, { run: 6.98, walk: 4 }).walk, 2.408, 0.01), 'a clip speed scales with the model');
  // 15: chooseGait.
  const g = gaitsOf(1, 5);
  ok(chooseGait(g, 'idle', 0.01, 1).clip === 'idle' && chooseGait(g, 'idle', 0.01, 1).speed === 0, 'below still it idles');
  ok(chooseGait(g, 'idle', 1.3, 1).clip === 'walk' && chooseGait(g, 'idle', 4, 1).clip === 'run', 'the nearest gait in ratio');
  const slowRun = chooseGait(g, 'idle', 2.8, 1);
  ok(slowRun.clip === 'run' ? near(slowRun.timeScale, 0.56) : near(slowRun.timeScale, 1.8), 'the time scale is wanted over clip speed');
  const fast = chooseGait(g, 'idle', 30, 1);
  ok(fast.timeScale === GAIT_LIMITS.fast && near(fast.speed, 9), 'the time scale is clamped, and the body goes at what the feet show');
  ok(near(chooseGait(g, 'idle', 2, 2).timeScale, 1) && chooseGait(g, 'idle', 2, 2).clip === 'walk', 'the scale enters the ratio');
  // 15b: the speed loop a mobile runs every frame. The ramp and the speed shown are two numbers: a
  // two-gait pack whose walk clamp (1.8 times the walk) is under the walk-run midpoint must still
  // reach its run, at any frame rate, and a mobile told to stand must stop dead.
  const run = (gaits: { clip: string; speed: number }[], wanted: number, accel: number, fps: number, seconds: number, from = 0) => {
    let st = { clip: null as string | null, timeScale: 1, speed: 0, ramp: from };
    let reachedAt = Infinity;
    let slid = false;
    for (let f = 0; f < seconds * fps; f++) {
      st = stepGait(st.ramp, wanted, accel, 1 / fps, gaits, 'idle', 1);
      const clip = gaits.find((x) => x.clip === st.clip);
      // (Below half a clip's speed chooseGait moves at the ramp by design, the clip not believed; only the upper clamp is the fix's.)
      if (clip && st.speed > clip.speed * GAIT_LIMITS.fast + 1e-9) slid = true;
      if (reachedAt === Infinity && Math.abs(st.speed - wanted) < 1e-6) reachedAt = (f + 1) / fps;
    }
    return { ...st, reachedAt, slid };
  };
  const banthaGaits = gaitsOf(0.86, 3.47);
  for (const fps of [60, 144]) {
    const b = run(banthaGaits, 5.2, 9, fps, 3);
    ok(b.reachedAt <= 3 && b.clip === 'run' && near(b.speed, 5.2, 1e-6), `a bantha chasing at ${fps} fps reaches its 5.20 run within 3 s (the ramp is not held at 1.8 times its walk)`);
  }
  ok(run(banthaGaits, 5.2, 4, 60, 3).reachedAt <= 3, '... with the default acceleration too');
  ok(run(gaitsOf(1.259, 7.012), 7.01, 4, 60, 4).clip === 'run' && run(gaitsOf(3.28, 11.23), 11.22, 4, 60, 5).clip === 'run', 'a rancor and a krayt dragon break out of the walk');
  ok(!run(banthaGaits, 5.2, 9, 60, 3).slid && !run(gaitsOf(1.259, 7.012), 7.01, 4, 144, 4).slid, 'on the way up the feet never slide past the clamp of the clip they show');
  const stop = run(banthaGaits, 0, 9, 60, 2, 5.2);
  ok(stop.speed === 0 && stop.ramp === 0 && stop.clip === 'idle', 'told to stand from a run it stops dead, the ramp at exactly 0');
  const slowDown = run(banthaGaits, 1.2, 9, 60, 3, 5.2);
  ok(near(slowDown.speed, 1.2, 1e-6) && slowDown.clip === 'walk', 'from a run down to its walk it walks at 1.20');
  // 16: the one-shot weight.
  ok(oneShotWeight(0, 1, 0.1, 0.2, false) === 0 && oneShotWeight(0.5, 1, 0.1, 0.2, false) === 1 && oneShotWeight(1, 1, 0.1, 0.2, false) === 0, 'a one-shot: 0 at the start, 1 through the middle, 0 at the end');
  ok(oneShotWeight(1, 1, 0.1, 0.2, true) === 1 && oneShotWeight(5, 1, 0.1, 0.2, true) === 1, 'held, it is 1 at the end and after');
  let mono = true;
  for (let t = 0, last = -1; t <= 1.2; t += 0.05) {
    const w = blendWeight(t, 1);
    if (w < last) mono = false;
    last = w;
  }
  ok(mono && blendWeight(0, 0) === 1, 'blendWeight is monotonic, and a zero fade is a step');
  const short = clampFades(0.067, 0.12, 0.18);
  ok(oneShotWeight(1 / 60, 0.067, short.fadeIn, short.fadeOut, false) >= 0.999, 'a 0.067 s clip is at weight 1 on its first sample');
  let dipped = false;
  for (let t = 1 / 60; t < 0.067 - 1e-6; t += 0.005) if (oneShotWeight(t, 0.067, short.fadeIn, short.fadeOut, false) < 0.999) dipped = true;
  ok(!dipped, '... and never dips in the middle');
  const long = clampFades(2, 0.12, 0.9);
  ok(long.fadeIn === 0.12 && long.fadeOut === 0.5, 'a long clip keeps its fade in, its fade out clamped to a quarter');
}

// --- 17-26: brain ----------------------------------------------------------------------------
function self(over: Partial<BrainSelf> = {}): BrainSelf {
  return {
    key: 50, x: 0, y: 0, z: 0, heading: 0, homeX: 0, homeZ: 0, side: 'wild', aggression: 'aggressive', inside: false, big: false,
    reach: 1.5, ranged: 0, melee: true, halfHeight: 0.9, hpRatio: 1, state: 'idle', targetKey: null, stuck: 0, now: 100,
    wanderAt: 1000, goal: null, until: 0, blockedSince: null, forgetKey: null, forgetUntil: 0, ...over,
  };
}
function target(key: number, x: number, z: number, over: Partial<BrainTarget> = {}): BrainTarget {
  return { key, x, y: 0, z, halfHeight: 0.9, radius: 0.7, side: 'player', aggression: 'aggressive', dead: false, attackedMeAt: -Infinity, hasLine: true, ...over };
}
const fixed = (v: number) => () => v;
{
  // 17
  ok(decide(self(), [target(PLAYER_KEY, 0, 31)]).targetKey === PLAYER_KEY, 'an aggressive one takes the player inside 32 m');
  ok(decide(self(), [target(PLAYER_KEY, 0, 33)]).targetKey === null, '... not at 33');
  ok(decide(self(), [target(PLAYER_KEY, 0, 10, { y: 20 })]).targetKey === null, '... nor 20 m above');
  ok(decide(self({ big: true }), [target(PLAYER_KEY, 0, 45)]).targetKey === PLAYER_KEY, 'a big one sees to 48 m');
  // 18
  const def = self({ aggression: 'defensive', side: 'wild' });
  ok(decide(def, [target(PLAYER_KEY, 0, 5)]).targetKey === null, 'a defensive one takes nobody unhurt');
  ok(decide(def, [target(PLAYER_KEY, 0, 5), target(77, 0, 20, { side: 'fighter', attackedMeAt: 95 })]).targetKey === 77, '... then takes whoever hurt it');
  ok(decide({ ...def, now: 95 + BRAIN_TUNE.memory + 1 }, [target(77, 0, 20, { side: 'fighter', attackedMeAt: 95 })]).targetKey === null, '... and forgets it after the memory');
  // 19
  const skit = decide(self({ aggression: 'skittish' }), [target(PLAYER_KEY, 0, 3), target(77, 10, 0, { side: 'fighter', attackedMeAt: 99 })]);
  ok(skit.state === 'flee' && skit.moveTo!.x < 0 && Math.abs(skit.moveTo!.z) < 1e-6, 'a skittish one flees the attacker, not the nearest');
  ok(decide(self({ aggression: 'skittish' }), [target(PLAYER_KEY, 0, 3)]).state === 'flee', 'a skittish one bolts from the player inside fleeRange');
  // 20
  const pass = decide(self({ aggression: 'passive' }), [target(PLAYER_KEY, 0, 1, { attackedMeAt: 99 })]);
  ok(pass.state !== 'attack' && pass.state !== 'flee' && pass.targetKey === null, 'a passive one never attacks and never flees');
  // 21
  const far = decide(self({ x: 70, targetKey: PLAYER_KEY, state: 'chase' }), [target(PLAYER_KEY, 71, 0)]);
  ok(far.state === 'return' && far.targetKey === null && far.moveTo!.x === 0, 'past the leash it goes home and drops the target');
  ok(decide(self({ x: 30, inside: true }), [target(PLAYER_KEY, 31, 0)]).state === 'return', 'inside, the leash is the short one');
  ok(decide(self({ x: 30 }), [target(PLAYER_KEY, 31, 0)]).state !== 'return', '... outside it is not');
  // 22
  const gunner = self({ ranged: 20, melee: true, targetKey: PLAYER_KEY, state: 'chase' });
  ok(decide(gunner, [target(PLAYER_KEY, 0, 15)]).attack === 'ranged', 'in range with a clear line: it shoots');
  const noLine = decide(gunner, [target(PLAYER_KEY, 0, 15, { hasLine: false })]);
  ok(noLine.attack === null && noLine.state === 'chase', 'without the line it chases');
  ok(decide(self({ ranged: 20, targetKey: PLAYER_KEY, state: 'chase' }), [target(PLAYER_KEY, 0, 2, { hasLine: false })]).attack === 'melee', 'inside 3 m with a melee clip it strikes');
  ok(decide(self({ targetKey: null }), [target(PLAYER_KEY, 0, 20)]).state === 'alert', 'a fresh target far off is stared at first');
  ok(decide(self({ targetKey: PLAYER_KEY, state: 'alert', until: 90 }), [target(PLAYER_KEY, 0, 20)]).state === 'chase', '... then chased');
  // 23
  const high = target(PLAYER_KEY, 0, 1, { y: 6 });
  const first = decide(self({ targetKey: PLAYER_KEY, state: 'chase' }), [high]);
  ok(first.state === 'chase' && first.blockedSince === 100, 'a target on a roof is chased to under it, the clock started');
  const later = decide(self({ targetKey: PLAYER_KEY, state: 'chase', blockedSince: 100, now: 100 + BRAIN_TUNE.giveUp + 0.1 }), [high]);
  ok(later.state === 'return' && later.targetKey === null && later.forgetKey === PLAYER_KEY, 'out of reach in height past giveUp: dropped and forgotten');
  ok(decide(self({ targetKey: PLAYER_KEY, state: 'chase', stuck: 3 }), [target(PLAYER_KEY, 0, 10)]).state === 'return', 'stuck three times: it gives up');
  // 24: hostile, the matrix both ways round.
  const sides = ['player', 'fighter', 'wild', 'hostile', 'imperial', 'rebel', 'civilian', 'neutral'] as const;
  let agrees = true;
  for (const a of sides) for (const b of sides) {
    if (hostile({ side: a, aggression: 'aggressive' }, { side: b, aggression: 'aggressive' }) !== hostileSides({ side: a, aggression: 'aggressive' }, { side: b, aggression: 'aggressive' })) agrees = false;
  }
  ok(agrees, 'hostile is the one matrix of targets.ts');
  ok(hostile({ side: 'imperial', aggression: 'aggressive' }, { side: 'rebel', aggression: 'aggressive' }) && hostile({ side: 'rebel', aggression: 'aggressive' }, { side: 'imperial', aggression: 'aggressive' }), 'imperial and rebel, both ways round');
  ok(hostile({ side: 'wild', aggression: 'aggressive' }, { side: 'player', aggression: 'aggressive' }) && !hostile({ side: 'player', aggression: 'aggressive' }, { side: 'wild', aggression: 'passive' }), 'a predator takes the player; nothing takes a passive one');
  // 25
  let inside = true;
  const r = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  })();
  for (let i = 0; i < 400; i++) {
    const p = wanderPoint(self({ homeX: 10, homeZ: -5 }), BRAIN_TUNE, r);
    const d = Math.hypot(p.x - 10, p.z + 5);
    if (d > BRAIN_TUNE.wanderMax + 1e-9 || d < BRAIN_TUNE.wanderMin - 1e-9) inside = false;
  }
  ok(inside, 'a wander point stays between wanderMin and wanderMax of home');
  const wander = decide(self({ wanderAt: 50 }), [], BRAIN_TUNE, fixed(0.5));
  ok(wander.state === 'wander' && wander.pace === 'walk' && wander.wanderAt > 100, 'the wander clock up: it sets off at a walk, with a new clock');
  ok(decide(self({ wanderAt: 500 }), [], BRAIN_TUNE, fixed(0.5)).state === 'idle', 'otherwise it stands');
  // 26 (the brain's half): nobody is never the player.
  ok(far.targetKey === null && far.targetKey !== PLAYER_KEY, 'a decision that drops its target gives null, never a key');
}

// --- 27-29: lod ------------------------------------------------------------------------------
function lod(over: Partial<LodInput> = {}): LodInput {
  return { dist: 10, onScreen: true, nearScreen: true, busy: false, sizeClass: 'medium', shadows: true, playerDist: 10, animRange: 160, ...over };
}
{
  ok(lodTier(lod()).name === 'near' && lodTier(lod()).animEvery === 1 && lodTier(lod()).think === 0.1, 'near: every frame, thinks every 0.1 s');
  ok(lodTier(lod({ dist: 60, playerDist: 70 })).name === 'mid' && lodTier(lod({ dist: 60, playerDist: 70 })).animEvery === 2 && lodTier(lod({ dist: 60, playerDist: 70 })).think === 0.4, 'mid: every second frame');
  ok(lodTier(lod({ dist: 60, playerDist: 20 })).think === 0.1, 'mid near the player still thinks quickly');
  ok(lodTier(lod({ dist: 120 })).name === 'far' && lodTier(lod({ dist: 120 })).animEvery === 4, 'far: every fourth frame');
  ok(lodTier(lod({ onScreen: false, nearScreen: false, dist: 200 })).name === 'frozen' && lodTier(lod({ onScreen: false, nearScreen: false, dist: 200 })).animEvery === 0, 'frozen: no mixer at all');
  ok(lodTier(lod({ onScreen: false, nearScreen: false, dist: 200, busy: true })).animEvery === 2, 'busy is never worse than every second frame');
  ok(lodTier(lod({ dist: 120, busy: true })).animEvery === 2, '... in any tier');
  ok(!lodTier(lod({ sizeClass: 'tiny', dist: 5 })).castShadow && lodTier(lod({ sizeClass: 'huge', dist: 900 })).castShadow, 'the shadow table: a tiny one never, a huge one always');
  ok(!lodTier(lod({ sizeClass: 'small', dist: 50 })).castShadow && lodTier(lod({ sizeClass: 'small', dist: 40 })).castShadow, 'a small one within 45 m');
  ok(!lodTier(lod({ shadows: false, sizeClass: 'huge' })).castShadow, 'shadows off: nothing casts');
  // 28
  const at150 = lod({ dist: 150 });
  ok(lodTier({ ...at150, animRange: 300 }, LOD_TUNE).name === 'far' && lodTier({ ...at150, animRange: 100 }, LOD_TUNE).name === 'hidden', 'animRange comes from the input: far at 300, hidden at 100');
  // 29
  const edge = lodTier(lod({ onScreen: false, nearScreen: true, dist: 50 }));
  ok(edge.visible && edge.castShadow && edge.name === 'hidden' && edge.animEvery === 4, 'near the screen but off it: still drawn, still casting');
  const gone = lodTier(lod({ onScreen: false, nearScreen: false, dist: 150 }));
  ok(!gone.visible && !gone.castShadow && gone.name === 'frozen', 'neither, past its shadow distance: frozen and not drawn');
  ok(lodTier(lod({ onScreen: false, nearScreen: false, dist: 20 })).visible, 'a body on the camera is never popped by the near plane');
  ok(!lodTier(lod({ onScreen: false, nearScreen: false, dist: 300, playerDist: 300 })).move && lodTier(lod({ onScreen: false, nearScreen: false, dist: 150 })).move, 'past sleep and frozen, it stops moving');
}

// --- 30-32: packClips ------------------------------------------------------------------------
{
  const track = (name: string, v: number[]) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], v);
  const q0 = [0, 0, 0, 1, 0, 0, 0, 1];
  const qTurn = [0, 0.3826834, 0, 0.9238795, 0, 0.3826834, 0, 0.9238795];
  // The bind pose is turned ten degrees, not the identity: against the identity a conversion leaves
  // the values as they were, and "a second call changes nothing" could not fail.
  const qBind = [0, 0.0871557, 0, 0.9961947, 0, 0.0871557, 0, 0.9961947];
  const clips = new Map<string, THREE.AnimationClip>([
    ['bind_pose', new THREE.AnimationClip('bind_pose', 1, [track('root', qBind)])],
    ['idle_a', new THREE.AnimationClip('idle_a', 1, [track('root', q0)])],
    ['idle_f', new THREE.AnimationClip('idle_f', 1, [track('root', q0)])],
    ['walk_a', new THREE.AnimationClip('walk_a', 1, [track('root', q0)])],
    ['run_a', new THREE.AnimationClip('run_a', 1, [track('root', q0)])],
    ['die_a', new THREE.AnimationClip('die_a', 1, [track('root', q0)])],
    ['shot_add', new THREE.AnimationClip('shot_add', 1, [track('root', qTurn)])],
  ]);
  const json: AnimPack = {
    id: 'test', file: '', hierarchy: 'all_b', set: 'curated', joints: 1, clips: [],
    logical: { loop_standing: ['idle_a', 'walk_a', 'run_a'], add_pistol_fire_1: ['shot_add'], trn_rea_get_hit_heavy_backward: ['die_a'] },
    roles: roles({ idle: 'idle_a', walk: 'walk_a', run: 'run_a', down: 'die_a', bind: 'bind_pose', gaits: [{ clip: 'walk_a', speed: 1.5 }, { clip: 'run_a', speed: 5 }] }),
    variants: { 'gender:f': { idle: 'idle_f' } },
  };
  const pack: PackClipSource = { json, clips, additive: new Set(['shot_add']), rigClips: new Map() };
  // 30
  ok(rolesFor(json, 'f').idle === 'idle_f' && rolesFor(json, 'm').idle === 'idle_a' && rolesFor(json, null).idle === 'idle_a', 'rolesFor lays the female variant over, leaves a male alone');
  ok(json.roles.idle === 'idle_a', '... without touching the pack');
  // 32 (before 31: the aliases are made after the conversion)
  const shot = clips.get('shot_add')!;
  ok(makeAdditiveOnce(pack) === 1 && shot.blendMode === THREE.AdditiveAnimationBlendMode, 'makeAdditiveOnce converts the additive clip, and marks it');
  const before = Array.from(shot.tracks[0].values);
  ok(before.some((v, i) => Math.abs(v - qTurn[i]) > 1e-3), 'the conversion against a turned bind pose moves the values');
  // What an unguarded second conversion would do, on a copy: it must move them again, or the next check proves nothing.
  const twice = shot.clone();
  twice.blendMode = THREE.NormalAnimationBlendMode;
  THREE.AnimationUtils.makeClipAdditive(twice, 0, clips.get('bind_pose')!);
  ok(Array.from(twice.tracks[0].values).some((v, i) => Math.abs(v - before[i]) > 1e-3), '... and converting twice would move them again');
  ok(makeAdditiveOnce(pack) === 0 && Array.from(shot.tracks[0].values).every((v, i) => v === before[i]), 'a second call changes nothing');
  ok(clips.get('idle_a')!.blendMode !== THREE.AdditiveAnimationBlendMode, 'a clip not marked additive is left alone');
  // 31
  const rig = rigClipsFromPack(pack, 'm');
  const named = new Map(rig.map((c) => [c.name, c]));
  ok(named.has('add_pistol_fire_1') && named.has('trn_rea_get_hit_heavy_backward'), 'a one-clip logical name is named plainly');
  ok(named.get('loop_standing:speed0')?.tracks === clips.get('idle_a')!.tracks && named.get('loop_standing:speed2')?.tracks === clips.get('run_a')!.tracks, 'a three-clip one is :speed0..2, slowest first');
  ok(['idle', 'walk', 'run', 'trn_stand_to_incapacitated'].every((n) => named.has(n)), 'the roles add idle, walk, run and the death clip');
  ok(named.get('add_pistol_fire_1')!.tracks === shot.tracks && named.get('add_pistol_fire_1')!.blendMode === THREE.AdditiveAnimationBlendMode, 'an alias shares the converted tracks and keeps the blend mode');
  ok(rigClipsFromPack(pack, 'm') === rig, 'the aliases are made once per gender');
  ok(rigClipsFromPack(pack, 'f').find((c) => c.name === 'idle')!.tracks === clips.get('idle_f')!.tracks, "the female rig's idle is her own");
  ok(missingRoles(rolesFor(json, null), clips).length === 0 && missingRoles(roles({ idle: 'nope', attacks: ['idle_a', 'gone'] }), clips).join(',') === 'idle,walk,run,attacks[1]', 'missingRoles names what the GLB has not got');
}

// === People: what they hold, the box they are planned from, the spawner's small decisions =======

// --- arms: the kind of gun a pack holds ------------------------------------------------------
{
  ok(gunKindForRoles({ ranged: 'add_pistol_fire_1' }, { ranged: 'all_b_cbt_pistol_fire_1_add' }) === 'pistol', 'add_pistol_fire_1 is a pistol');
  ok(gunKindForRoles({ ranged: 'rifle_fire_1' }, { ranged: 'x' }) === 'rifle' && gunKindForRoles({ ranged: 'add_rifle_fire_1' }, { ranged: 'x' }) === 'rifle', 'rifle_* and add_rifle_* are a rifle');
  ok(gunKindForRoles({ ranged: 'cbt_attack_ranged' }, { ranged: 'r2_cbt_attack_ranged' }) === 'own', "cbt_attack_ranged is the body's own (a droid's gun)");
  ok(gunKindForRoles(undefined, { ranged: 'thing_pistol_shot' }) === 'pistol' && gunKindForRoles(undefined, { ranged: 'spit' }) === 'own', 'without a source the clip name is read the same way');
  ok(gunKindForRoles({ ranged: 'add_pistol_fire_1' }, { ranged: null }) === null, 'no ranged clip, no gun');
}

// --- arms: who carries what ------------------------------------------------------------------
{
  const person = (id: string, over: Partial<MobileEntry> = {}) => entry(id, { kind: 'dressed', ...over, stats: { ...entry(id).stats, aggression: 'aggressive', ranged: { range: 20, additive: true }, ...(over.stats ?? {}) } });
  const pistolRoles = { ranged: 'all_b_cbt_pistol_fire_1_add' };
  const src = { ranged: 'add_pistol_fire_1' };
  const trooper = armsFor(person('dressed_stormtrooper_m'), 'all_b', pistolRoles, src);
  ok(trooper?.kind === 'gun' && trooper.carry === 'rifle' && trooper.prefer[0] === 'e11', 'a stormtrooper carries a rifle, an E-11 first');
  const officer = armsFor(person('dressed_rebel_officer_m'), 'all_b', pistolRoles, src);
  ok(officer?.kind === 'gun' && officer.carry === 'pistol', 'a rebel officer carries a sidearm, not the troops rifle');
  ok(armsFor(person('dressed_rebel_trooper_m'), 'all_b', pistolRoles, src)?.kind === 'gun' && hintFor('dressed_rebel_trooper_m')!.carry === 'rifle', 'a rebel trooper carries a rifle');
  const plain = armsFor(person('dressed_farmer_m'), 'all_b', pistolRoles, src);
  ok(plain?.kind === 'gun' && plain.carry === 'pistol' && plain.prefer.length === 0, 'anyone else takes what the pack holds, a pistol, any one');
  const jedi = armsFor(person('dressed_dark_jedi_elder_female_bothan_01'), 'all_b', pistolRoles, src);
  ok(jedi?.kind === 'saber' && jedi.classes[0] === 'lightsaber', 'a Dark Jedi carries a lightsaber');
  ok(wantsSaber('dressed_sith_shadow_male_01') && wantsSaber('jedi_trainer') && wantsSaber('npe/inquisitor') && !wantsSaber('sithspawn') && !wantsSaber('jedimaster_bust'), 'wantsSaber reads whole words only');
  ok(armsFor(person('rancor'), 'creature_base', pistolRoles, src) === null, 'a creature is armed with nothing off the rack');
  ok(armsFor(person('hologram/stormtrooper', { flags: ['hologram'] }), 'all_b', pistolRoles, src) === null, 'a hologram holds nothing');
  ok(armsFor(person('dressed_vendor_m', { stats: { ...entry('v').stats, aggression: 'passive', ranged: { range: 20, additive: true } } }), 'all_b', pistolRoles, src) === null, 'a passive one holds nothing');
  ok(armsFor(person('dressed_thug_m', { stats: { ...entry('v').stats, aggression: 'aggressive', ranged: null } }), 'all_b', pistolRoles, src) === null, 'no ranged attack in the catalogue, no gun');
  ok(armsFor(person('r2d2'), 'all_b', { ranged: 'r2_attack' }, { ranged: 'cbt_attack_ranged' }) === null, "a body's own gun takes no model");
  ok(armsFor(person('3po_protocol', { kind: 'droid', appearance: 'protocol_droid' }), 'all_b', pistolRoles, src) === null && armsFor(person('clone_droid', { kind: 'droid', appearance: 'droid_21b' }), 'all_b', pistolRoles, src) === null, 'a protocol or a surgical droid on the human skeleton holds nothing');
  ok(armsFor(person('ig_88', { kind: 'droid', appearance: 'ig88' }), 'all_b', pistolRoles, src)?.kind === 'gun' && armsFor(person('warren_agro_droid_s03', { kind: 'droid', appearance: 'ig88' }), 'all_b', pistolRoles, src)?.kind === 'gun' && armsFor(person('4lom', { kind: 'droid', appearance: '4lom' }), 'all_b', pistolRoles, src)?.kind === 'gun', 'a combat droid (IG-88, its body under another name, 4-LOM) holds a gun');
  const warrior = armsFor(person('dressed_ep3_forest_kerritamba_warrior', { species: 'wookiee_male' }), 'all_b', pistolRoles, src);
  ok(warrior?.kind === 'gun' && warrior.carry === 'rifle' && warrior.prefer[0] === 'bowcaster', 'a Wookiee named for its job still carries a bowcaster, by its species');
  const guard = armsFor(person('dressed_wookiee_guard', { species: 'wookiee_male' }), 'all_b', pistolRoles, src);
  ok(guard?.kind === 'gun' && guard.prefer[0] === 'bowcaster', "a Wookiee's species wins over its job (a guard's rifle)");
  ok(armsFor(person('dressed_rebel_officer_m', { species: 'human_male' }), 'all_b', pistolRoles, src)?.kind === 'gun' && hintForEntry({ id: 'dressed_rebel_officer_m', species: 'human_male', appearance: null })!.carry === 'pistol', 'a human species names no row: the id decides');
}

// --- arms: the weapon off the rack ------------------------------------------------------------
{
  const rack: { id: string; class: WeaponClass }[] = [
    { id: 'rifle_e11', class: 'rifle' },
    { id: 'rifle_e11_generic', class: 'rifle' },
    { id: 'rifle_flame_thrower', class: 'rifle' },
    { id: 'carbine_dh17', class: 'carbine' },
    { id: 'pistol_dl44', class: 'pistol' },
    { id: 'pistol_launcher', class: 'pistol' },
    { id: 'pistol_scatter', class: 'pistol' },
    { id: 'pistol_scatter_npe', class: 'pistol' },
    { id: 'sword_lightsaber_one_handed_gen4', class: 'lightsaber' },
    { id: 'quest_rifle_e11', class: 'rifle' },
  ];
  const first = () => 0;
  const last = () => 0.999;
  ok(chooseWeapon({ kind: 'gun', carry: 'rifle', classes: ['rifle', 'carbine'], prefer: ['e11'] }, rack, first)?.id === 'rifle_e11' && chooseWeapon({ kind: 'gun', carry: 'rifle', classes: ['rifle', 'carbine'], prefer: ['e11'] }, rack, last)?.id === 'rifle_e11_generic', 'a preferred fragment picks among the weapons that hold it, quest copies left out');
  ok(chooseWeapon({ kind: 'gun', carry: 'rifle', classes: ['rifle', 'carbine'], prefer: ['nothing_has_this', 'dh17'] }, rack, first)?.id === 'carbine_dh17', 'the fragments are tried in order');
  const anyPistol = new Set([0, 0.3, 0.6, 0.999].map((r) => chooseWeapon({ kind: 'gun', carry: 'pistol', classes: ['pistol'], prefer: [] }, rack, () => r)?.id));
  ok(anyPistol.has('pistol_dl44') && anyPistol.has('pistol_scatter') && !anyPistol.has('pistol_launcher') && !anyPistol.has('pistol_scatter_npe'), 'a random pistol leaves out the launchers and the new-player copies');
  ok(chooseWeapon({ kind: 'saber', classes: ['lightsaber'], prefer: ['one_handed_gen'] }, rack, first)?.id === 'sword_lightsaber_one_handed_gen4', 'a Jedi takes a lightsaber');
  ok(chooseWeapon({ kind: 'gun', carry: 'rifle', classes: ['heavy'], prefer: [] }, rack) === null, 'nothing of the kind on the rack: null');
}

// --- arms: a rifle's carry and the muzzle bone ------------------------------------------------
{
  const packClips = [
    { name: 'all_b_idl_breathe_normally', speed: 0 },
    { name: 'all_b_cbt_rifle_a_standing_hold_idle', speed: 0 },
    { name: 'all_b_cbt_rifle_a_run_held', speed: 4.8 },
    { name: 'all_b_cbt_rifle_a_walk_hold', speed: 1.4 },
    { name: 'all_b_cbt_rifle_fire_1_add', speed: 0, additive: true },
  ];
  const r = armedRoles(packClips, 'rifle');
  ok(r.rangedStance === 'all_b_cbt_rifle_a_standing_hold_idle' && r.idleCombat === r.rangedStance, "a rifle stands in the pack's rifle stance");
  ok(r.ranged === 'all_b_cbt_rifle_fire_1_add' && r.rangedAdditive === true, "... recoils with the rifle's own shot");
  ok(r.gaitsCombat?.length === 2 && r.gaitsCombat[0].clip === 'all_b_cbt_rifle_a_walk_hold' && r.gaitsCombat[1].speed === 4.8, '... and walks and runs with it held, slowest first, at their own speeds');
  ok(Object.keys(armedRoles(packClips, 'pistol')).length === 0, "a pistol keeps the pack's roles as they are");
  ok(Object.keys(armedRoles([{ name: 'idle', speed: 0 }], 'rifle')).length === 0, 'a pack without rifle clips changes nothing');
  ok(muzzleBone(['root', 'spine1', 'jaw', 'hold_r']) === 'hold_r' && muzzleBone(['root', 'jaw']) === 'jaw' && muzzleBone(['root']) === null, "the muzzle bone: a gun's joint first, then the mouth");
  ok(SABER_SWINGS.length === 10 && SABER_SWINGS.every((s) => s.startsWith('BOTH_A')), "the swings are Jedi Academy's ten one-hand attacks");
}

// --- spawning: the box a person is planned from ------------------------------------------------
{
  const app = (id: string, pack: string, h: number, form: 'glb' | 'parts' = 'parts'): MobileAppearance => ({ id, form, file: `mobiles/models/${id}/parts.json`, pack, joints: 53, bounds: { min: [-0.5, 0, -0.15], max: [0.5, h, 0.15] }, sizeClass: 'small', riderPose: null, ready: true });
  const apps: Record<string, MobileAppearance> = {
    a: app('a', 'hum_m', 1.7),
    b: app('b', 'hum_m', 1.8),
    c: app('c', 'hum_m', 1.9),
    tiny: app('tiny', 'hum_m', 0.3),
    rancor: app('rancor', 'rancor', 6, 'glb'),
  };
  const own = lookBounds({ appearance: 'rancor', pack: 'rancor', species: null }, apps);
  ok(own === apps.rancor.bounds, 'an entry on its own model takes its appearance box');
  const human = lookBounds({ appearance: null, pack: 'hum_m', species: 'human_male' }, apps);
  ok(human.max[1] === 1.8, 'a dressed human takes the median parts model on its pack (1.8 m), the odd tiny one left out');
  const wookiee = lookBounds({ appearance: null, pack: 'wke_m', species: 'wookiee_male' }, apps);
  ok(near(Math.abs(wookiee.max[1] - wookiee.min[1]), 2.2) && wookiee.max[0] > HUMANOID_BOUNDS.max[0], 'a Wookiee with nothing on its pack stands at 2.2 m, a person box scaled up');
  const sullustan = lookBounds({ appearance: null, pack: 'hum_m', species: 'sullustan_female' }, apps);
  ok(near(sullustan.max[1], 1.5), "a Sullustan on the human pack keeps its species' height");
  const nothing = lookBounds({ appearance: null, pack: 'none', species: 'someone_male' }, apps);
  ok(near(nothing.max[1], HUMANOID_BOUNDS.max[1]), 'an unknown species on an unknown pack is a person box');
  ok(speciesOf('twilek_female') === 'twilek' && speciesOf(null) === '', 'speciesOf drops the gender');
}

// --- spawning: how far ahead, the planet's values, the permanent gap, one of each -------------
{
  ok(spawnDistance(HUMANOID_BOUNDS) === 8, 'a person stands eight metres off');
  const krayt = { min: [-4, 0, -14], max: [4, 9, 14] } as { min: [number, number, number]; max: [number, number, number] };
  ok(spawnDistance(krayt) === 33 && spawnDistance(krayt, 2) === 45, 'a krayt dragon far enough not to stand on you, never past 45 m');
  ok(spawnDistance({ min: [4, 0, 14], max: [-4, 9, -14] }) === spawnDistance(krayt), 'swapped box corners give the same distance');
  const o = ambientOverrides({ hp: 260, damage: 0, aggressive: false, speed: 2 });
  ok(o.hp === 260 && o.damage === 8 && o.aggression === 'defensive', "a bantha's planet values: its health, a blow of its own, defensive");
  ok(ambientOverrides({ hp: 90, damage: 0, aggressive: false, speed: 4.5 }).aggression === 'skittish' && ambientOverrides({ hp: 900, damage: 38, aggressive: true, speed: 3.5 }).aggression === 'aggressive', 'fast and peaceful is skittish; aggressive is aggressive');
  const failed = [{ what: 'model', id: 'gubbur', why: 'no mesh survived' }];
  const gap = permanentGap({ appearance: 'gubbur', name: 'Gubbur', id: 'gubbur' }, failed);
  ok(!!gap && gap.startsWith('unavailable') && gap.includes('no mesh survived'), 'the permanent gap is said as unavailable, with the reason');
  ok(permanentGap({ appearance: 'rancor', name: 'Rancor', id: 'rancor' }, failed) === null && permanentGap({ appearance: null, name: 'x', id: 'x' }, failed) === null, 'anything else is no gap');
  const picks = groupPicks(['a', 'bad', 'b', 'c', 'd'], 3, (e) => e !== 'bad');
  ok(picks.join(',') === 'a,b,c', 'one of each takes the first that can be stood, up to the count');
}

// --- The real catalogue: every person can be planned and armed, and the one gap is said as one ---
{
  const path = new URL('../../../assets-private/mobiles/catalogue.json', import.meta.url);
  if (!existsSync(path)) console.log('skip the people checks on the real catalogue: assets-private/mobiles/catalogue.json is not converted here');
  else {
    const file = JSON.parse(readFileSync(path, 'utf8')) as { entries: MobileEntry[]; appearances: Record<string, MobileAppearance>; packs: Record<string, { hierarchy: string }>; failed?: { what: string; id: string; why: string }[] };
    const dressed = file.entries.filter((e) => e.kind === 'dressed');
    const heights = dressed.map((e) => Math.abs(lookBounds(e, file.appearances).max[1] - lookBounds(e, file.appearances).min[1]));
    ok(dressed.length > 2000 && heights.every((h) => h > 1.3 && h < 2.5), `every one of the ${dressed.length} dressed entries is planned at a person's height`);
    ok(dressed.every((e) => !!e.species && !!e.pack && file.packs[e.pack]?.hierarchy === 'all_b'), "every dressed entry names its species and plays an all_b pack (the hand's weapon joint)");
    const gaps = file.entries.filter((e) => permanentGap(e, file.failed));
    ok(gaps.length >= 1 && gaps.every((e) => !e.ready), `the permanent gap (${gaps.map((e) => e.id).join(', ')}) is an entry the converter marked not ready, and is said as unavailable`);
    // Armed from its own pack's roles, as the manager arms it, not from roles made up here.
    const packJson = (e: MobileEntry): AnimPack | null => {
      const info = e.pack ? (file.packs[e.pack] as { hierarchy: string; json?: string } | undefined) : undefined;
      const at = info?.json ? new URL(`../../../assets-private/${info.json}`, import.meta.url) : null;
      return at && existsSync(at) ? (JSON.parse(readFileSync(at, 'utf8')) as AnimPack) : null;
    };
    const armed = (e: MobileEntry) => {
      const json = packJson(e);
      return json ? armsFor(e, file.packs[e.pack!].hierarchy, rolesFor(json, e.gender), json.roleSources) : null;
    };
    const trooper = file.entries.find((e) => e.id === 'dressed_stormtrooper_m');
    if (trooper && packJson(trooper)) {
      const a = armed(trooper);
      ok(a?.kind === 'gun' && a.carry === 'rifle', `the dressed stormtrooper is armed with a rifle from its own pack (${trooper.pack})`);
    }
    const jedi = dressed.filter((e) => wantsSaber(e.id));
    ok(jedi.length > 50, `${jedi.length} dressed Jedi, Sith and Inquisitors carry lightsabers`);
    const protocol = file.entries.find((e) => e.id === '3po_protocol');
    if (protocol && packJson(protocol)) ok(armed(protocol) === null, 'a protocol droid on the human skeleton holds nothing off the rack');
    const ig88 = file.entries.find((e) => e.id === 'ig_88');
    if (ig88 && packJson(ig88)) ok(armed(ig88)?.kind === 'gun', 'IG-88 carries a gun');
    const wookiees = dressed.filter((e) => /^wookiee/.test(e.species ?? '') && packJson(e) && armed(e)?.kind === 'gun');
    ok(wookiees.length > 20 && wookiees.every((e) => armed(e)!.prefer.includes('bowcaster')), `every one of the ${wookiees.length} armed dressed Wookiees reaches for a bowcaster, whatever its id says`);
  }
}

console.log(`${checks} checks passed`);
