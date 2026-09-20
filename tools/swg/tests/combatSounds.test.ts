// What a gun sounds like, without a browser: which of the game's tables each of a weapon's sounds
// comes from, how a surface answers to the weapon table's five hit columns, a volley counting as
// one shot, a bolt whining past the ear once, and the blows, grenades and blasts.
//
// Nothing here makes an AudioContext or fetches anything: the mixer is a few lines of bookkeeping
// that record what was asked of it, because the tab this was built in can hear nothing and every
// judgement has to be a number.
import assert from 'node:assert/strict';
import { CombatSounds, COMBAT_TUNE, GENERIC_GUN, SILENT_GUN, gunSoundFrom, hitColumn, rowFor, shipGunFrom, templateKey, type ColliderSurfaces, type CombatTables } from '../../../src/audio/combatSounds.ts';
import { EmitterGrid, type LoopHost } from '../../../src/audio/emitters.ts';
import type { SoundSpace } from '../../../src/audio/distance.ts';
import type { SurfaceSource } from '../../../src/audio/footsteps.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

/** The part of the mixer the guns use, written down: every call is recorded, nothing sounds. */
class FakeMixer implements LoopHost {
  readonly grid = new EmitterGrid();
  readonly bank = { available: true, sources: null, template: () => ({ dim: 3 }) };
  readonly started: { id: string; x: number; y: number; z: number; space: SoundSpace }[] = [];
  readonly stopped: number[] = [];
  readonly prepared: string[] = [];
  readonly loops = new Set<number>();
  /** A mixer with no voice left over (or one recording rather than playing) takes a loop and gives back nothing. */
  refuseLoops = false;
  private next = 1;

  play(id: string, options: { x?: number; y?: number; z?: number; space?: SoundSpace } = {}): number {
    this.started.push({ id, x: options.x ?? 0, y: options.y ?? 0, z: options.z ?? 0, space: { building: options.space?.building ?? -1, cell: options.space?.cell ?? -1 } });
    return this.next++;
  }

  loop(id: string, options: { x?: number; y?: number; z?: number; space?: SoundSpace } = {}): number {
    const key = this.play(id, options);
    if (this.refuseLoops) return 0;
    this.loops.add(key);
    return key;
  }

  stop(key: number): void {
    this.stopped.push(key);
    this.loops.delete(key);
  }

  move(): void {}
  setGain(): void {}
  setSpace(): void {}
  isPlaying(key: number): boolean {
    return this.loops.has(key);
  }
  prepare(ids: Iterable<string>): void {
    for (const id of ids) this.prepared.push(id);
  }

  /** What was started, most recent last; the ids alone, which is what the checks read. */
  ids(): string[] {
    return this.started.map((s) => s.id);
  }
  last(): string | null {
    return this.started.length ? this.started[this.started.length - 1].id : null;
  }
  clear(): void {
    this.started.length = 0;
    this.stopped.length = 0;
  }
}

/** The two rows of the game's own tables the checks below use, shaped as the converter writes them. */
const TABLES: CombatTables = {
  ranged: [
    { weapon: 'pistol', muzzle: 'sound/wep_pistol_fired.snd', hit: null, nothing: null, ricochet: null },
    { weapon: 'rifle', muzzle: 'sound/wep_rifle_fired.snd', hit: null, nothing: null, ricochet: null },
    { weapon: 'shared_carbine_dc15.iff', muzzle: 'sound/wep_carbine_dc15.snd', hit: 'sound/wep_carbine_dc15_hit.snd', nothing: null, ricochet: null },
  ],
  melee: [
    { weapon: 'unarmed', attack: 'sound/pl_swing_unarmed.snd', attackPitch: 0, hit: null, hitPitch: 0 },
    { weapon: '2handMelee', attack: 'sound/wep_lrg_sharp_miss.snd', attackPitch: 0, hit: null, hitPitch: 0 },
    { weapon: 'shared_sword_axe.iff', attack: 'sound/wep_axe.snd', attackPitch: 0, hit: 'sound/wep_axe_hit.snd', hitPitch: 0 },
  ],
  surfaces: { 'abstract/terrain_surface/sand.iff': { type: 'sand' } },
};

// ---- the tables' own keys ----
{
  ok(templateKey('object/weapon/ranged/carbine/ep3/shared_carbine_dc15.iff') === 'shared_carbine_dc15.iff', "a weapon is keyed by its template's own file name, which is how both combat tables key their rows");
  ok(templateKey(null) === '' && templateKey(undefined) === '', 'and a weapon with no template keys nothing rather than throwing');
  ok(rowFor(TABLES.ranged, 'object/weapon/ranged/carbine/ep3/shared_carbine_dc15.iff', 'rifle')?.weapon === 'shared_carbine_dc15.iff', "the gun's own row wins over the plain row for its kind");
  ok(rowFor(TABLES.ranged, 'object/weapon/ranged/pistol/shared_pistol_nothing.iff', 'pistol')?.weapon === 'pistol', 'a gun the table does not name falls to the plain row of the kind it fires as');
  ok(rowFor(TABLES.ranged, 'object/weapon/ranged/pistol/shared_pistol_nothing.iff', null) === null, 'and with no kind either, to nothing at all');
}

// ---- one gun's set, and where each sound came from ----
{
  const dc15 = { id: 'carbine_dc15', class: 'carbine', template: 'object/weapon/ranged/carbine/ep3/shared_carbine_dc15.iff', fx: { sounds: { fire: ['sound/wep_fire_blaster.snd'], hit: { creature: ['sound/hit_flesh.snd'], metal: ['sound/hit_metal.snd'], stone: null, wood: null, other: ['sound/hit_other.snd'] }, miss: { water: ['sound/miss_water.snd'], terrain: ['sound/miss_terrain.snd'], nothing: ['sound/miss_nothing.snd'] } } } };
  const s = gunSoundFrom(dc15, TABLES);
  ok(s.fire === 'sound/wep_carbine_dc15.snd', "the shot is the gun's own row of the ranged table, which is the game's answer for that weapon, not its effect family's");
  ok(s.hit.creature === 'sound/wep_carbine_dc15_hit.snd', "that row's hit is the blow on what was aimed at -- its column is `Hit Target Sound`, and its values are flesh -- so it takes the creature column");
  ok(s.hit.metal === 'sound/hit_metal.snd' && s.hit.other === 'sound/hit_other.snd', 'and the four surface columns stay the weapon effect table\'s, which is the only thing that tells stone from metal');
  ok(s.miss.water === 'sound/miss_water.snd' && s.miss.nothing === 'sound/miss_nothing.snd', 'the misses come from the weapon table alone: no other table has them');
  const noRow = gunSoundFrom({ ...dc15, template: 'object/weapon/ranged/rifle/shared_rifle_unknown.iff' }, TABLES);
  ok(noRow.fire === 'sound/wep_fire_blaster.snd', "a gun the ranged table does not name takes its weapon effect's own fire sound");
  ok(noRow.hit.creature === 'sound/hit_flesh.snd' && noRow.hit.stone === GENERIC_GUN.hit.stone, 'each of the five hit columns is its own, and a column the table leaves empty falls to the plain blaster rather than to silence');
  ok(gunSoundFrom(null, TABLES) === GENERIC_GUN, 'nothing in hand at all is the plain blaster');
  ok(gunSoundFrom({ id: 'bare' }, null).fire === GENERIC_GUN.fire, 'and so is a gun asked for before the tables have landed');
}

// ---- a pack converted before the miss set was written ----
{
  const old = { id: 'pistol_scout', class: 'pistol', template: 'object/weapon/ranged/pistol/shared_pistol_scout.iff', fx: { sounds: { fire: 'sound/wep_pistol_scout.snd', hit: 'sound/wep_pistol_scout_hit.snd' } } };
  const s = gunSoundFrom(old, { ranged: [] });
  ok(s.fire === 'sound/wep_pistol_scout.snd', 'the older pack wrote one string per sound, and it still plays');
  ok(s.hit.creature === 'sound/wep_pistol_scout_hit.snd' && s.hit.wood === 'sound/wep_pistol_scout_hit.snd', 'its one hit sound stands for every surface, which is the creature column it was taken from');
  ok(s.miss.nothing === null, 'and it has no misses, because that pack holds none: the weapons command writes them now');
}

// ---- which column a surface answers to ----
{
  ok(hitColumn('metal') === 'metal' && hitColumn('wood') === 'wood', "the room table's and the object templates' own words are the weapon table's own columns");
  ok(hitColumn('rock') === 'stone' && hitColumn('obsidian') === 'stone', "the terrain's rock and the asteroids' obsidian are stone");
  ok(hitColumn('sand') === 'other' && hitColumn('carpet') === 'other' && hitColumn(null) === 'other', "everything the five columns do not name is `other`, which is what the client's own fallback column is for");
}

// ---- a ship's gun ----
{
  const row = { index: 3, effect: 'particles/fx_pt_bolt_red_space.json', sounds: { fire: 'sound/cbt_gun_xwing.snd', hitMetal: 'sound/shp_hit_armor.snd', hitOther: 'sound/cbt_gun_hit_asteroid.snd' } };
  const s = shipGunFrom(row)!;
  ok(s.fire === 'sound/cbt_gun_xwing.snd' && s.ship, "a ship gun's shot is the projectile table's own, and it is marked a ship's so its bolts whine rather than crack");
  ok(s.hit.metal === 'sound/shp_hit_armor.snd' && s.hit.other === 'sound/cbt_gun_hit_asteroid.snd', 'its two hits are the hull and everything else');
  ok(s.miss.terrain === 'sound/cbt_gun_hit_asteroid.snd' && s.miss.water === null, 'the ground it can reach is an asteroid, and there is no water in space');
  ok(shipGunFrom(null) === null, 'and a projectile index the table does not hold is nothing, not a wrong gun');
}

// ---- the shots themselves ----
{
  const mixer = new FakeMixer();
  const c = new CombatSounds();
  c.attach(mixer, '/');
  c.setTables(TABLES);
  const gun = c.gunOf({ id: 'carbine_dc15', class: 'carbine', template: 'object/weapon/ranged/carbine/ep3/shared_carbine_dc15.iff' })!;
  ok(gun.fire === 'sound/wep_carbine_dc15.snd', 'a gun asked for through the class is the same set the pure function builds');
  ok(c.gunOf({ id: 'carbine_dc15' }) !== null, 'and asking again for the same record hands back the set it built the first time');
  ok(mixer.prepared.includes('sound/wep_carbine_dc15.snd'), 'whose samples are asked of the bank as soon as the set exists, not when the trigger is pulled');
  ok(mixer.prepared.includes(GENERIC_GUN.hit.stone!) && mixer.prepared.includes(GENERIC_GUN.miss.water!), 'and the whole set with it, not the shot alone: a hit or a miss asked for before its sample is decoded is dropped, and the first of each kind would be the one lost');
  c.fire(gun, 1, 2, 3);
  ok(mixer.last() === 'sound/wep_carbine_dc15.snd', 'firing plays the gun`s own shot at the muzzle');
  ok(mixer.started[0].x === 1 && mixer.started[0].y === 2 && mixer.started[0].z === 3, 'where the muzzle is');
  mixer.clear();
  c.fire(gun, 1, 2, 3);
  c.fire(gun, 1, 2, 3);
  ok(mixer.started.length === 0 && c.counts.volleys === 2, "a volley is one shot: the same gun asking again within a few hundredths of a second is counted and dropped, or a scattergun's pellets would fire eight times at once");
  c.update(COMBAT_TUNE.volley * 2);
  c.fire(gun, 1, 2, 3);
  ok(mixer.started.length === 1, 'and the next shot after that window sounds as it should');
  mixer.clear();
  c.fire(gun, 1, 2, 3, 7);
  c.fire(gun, 1, 2, 3, 8);
  ok(mixer.started.length === 2, 'but the window is the shooter\'s, not the weapon\'s: a squad carrying one kind of rifle, and every turret of a field, share one record between them and must still each be heard');
}

// ---- what it struck ----
{
  const mixer = new FakeMixer();
  const c = new CombatSounds();
  c.attach(mixer, '/');
  c.setTables(TABLES);
  // A world with a metal crate standing over the sand, a lake to the west, and a wooden hut whose
  // walls a ray down from a bolt's mark can never name: collider 9 is one of them.
  const world: SurfaceSource & ColliderSurfaces = {
    waterTop: (x) => (x < -100 ? 5 : -Infinity),
    roomSurface: (x) => (x > 200 ? 'metal' : null),
    objectTemplate: (x) => (x > 50 && x < 200 ? 'object/tangible/crate.iff' : null),
    groundTemplate: () => 'abstract/terrain_surface/sand.iff',
    space: (x) => (x > 200 ? { building: 1, cell: 2 } : null),
    templateOfCollider: (h) => (h === 9 ? 'object/building/hut.iff' : null),
  };
  c.attachWorld(world);
  const gun = gunSoundFrom({ id: 'g', fx: { sounds: { hit: { creature: ['sound/flesh.snd'], metal: ['sound/metal.snd'], stone: null, wood: ['sound/wood.snd'], other: ['sound/other.snd'] }, miss: { water: ['sound/water.snd'], terrain: ['sound/terrain.snd'], nothing: ['sound/nothing.snd'] } } } }, null);
  // The planet's own surfaces, as its pack writes them.
  c.adoptSurfaces({ 'object/tangible/crate.iff': 'metal', 'object/building/hut.iff': 'wood' });
  c.hit(gun, 0, 0, 0, 'creature');
  ok(mixer.last() === 'sound/flesh.snd', 'a bolt in a body is the creature column');
  c.hit(gun, 0, 0, 0, 'ship');
  ok(mixer.last() === 'sound/metal.snd', 'a bolt in a hull is metal, whatever layer it went through');
  c.hit(gun, 60, 0, 0, null);
  ok(mixer.last() === 'sound/metal.snd', "a bolt in something standing there is what that thing's own template is made of");
  c.hit(gun, 0, 0, 0, null);
  ok(mixer.last() === 'sound/other.snd', 'and sand is none of the five columns, so it is the fallback the client itself falls to');
  c.hit(gun, 0, 4, 0, null, 9);
  ok(mixer.last() === 'sound/wood.snd', 'a bolt in a wall is what the collider that stopped it belongs to: a ray down from a mark four metres up a wall would name the ground painted under the building instead');
  ok(c.missKindAt(-200, 0, 0) === 'water' && c.missKindAt(0, 0, 0) === 'terrain' && c.missKindAt(60, 0, 0) === null, 'a shot that hurt nothing came to the water, to the bare ground, or to something standing there, which is a hit and not a miss');
  ok(c.missKindAt(0, 4, 0, 9) === null, 'and a wall the ray cannot reach is one of those, because the collider names it');
  c.hit(gun, 300, 0, 0, null);
  ok(mixer.last() === 'sound/metal.snd', "indoors the mark's own room answers, as it does for a foot, and it is the room the shot landed in rather than the one the ear stands in (the ear here is in the open)");
  mixer.clear();
  c.miss(gun, -200, 0, 0, 'water');
  ok(mixer.last() === 'sound/water.snd', 'and the misses play the weapon table`s own three');
  c.miss(GENERIC_GUN, 0, 0, 0, 'nothing');
  ok(mixer.ids().filter((id) => id === 'sound/nothing.snd').length === 0, 'a gun with no "hit nothing" sound plays nothing at the end of its flight rather than the wrong thing');
}

// ---- past the ear ----
{
  const mixer = new FakeMixer();
  const c = new CombatSounds();
  c.attach(mixer, '/');
  c.setListener(0, 0, 0, { building: -1, cell: -1 });
  ok(c.flyby(0, 0, COMBAT_TUNE.flyby + 1, false) === false, 'a bolt passing wide of the ear does not whine');
  ok(mixer.started.length === 0, 'and starts nothing');
  ok(c.flyby(0, 0, 1, false) === true, 'one passing close does');
  ok(mixer.last() === 'sound/wep_flyby_energy.snd', "with the game's own sound for a bolt going by");
  mixer.clear();
  ok(c.flyby(0, 1, 0, true) === true, 'a second bolt from the same burst counts as gone by');
  ok(mixer.started.length === 0, 'and does not whine again within the gap, or a burst would be five whines');
  c.update(COMBAT_TUNE.flybyGap * 2);
  c.flyby(0, 1, 0, true);
  ok(mixer.last() === 'sound/cbt_bolt_flyby.snd', "and a ship's bolt whines with the sound the game keeps for those");
  mixer.clear();
  c.update(COMBAT_TUNE.flybyGap * 2);
  // A bolt 20 m short of the ear and 40 m of flight this frame: it passes within a metre part way
  // through the step and is at no point of the frame within the radius when it is drawn.
  ok(c.flyPast(0, 1, -20, 0, 0, 40, false) === true, 'a bolt is measured over the whole stretch it covers in a frame, not at the one point it was drawn: at 20 to 40 metres a frame the point alone would miss five passes out of six');
  ok(mixer.last() === 'sound/wep_flyby_energy.snd', 'and whines with the ground bolt`s own sound');
  mixer.clear();
  c.update(COMBAT_TUNE.flybyGap * 2);
  ok(c.flyPast(0, 40, -20, 0, 0, 40, false) === false, 'while one that passes forty metres overhead is still no nearer for being measured that way');
}

// ---- blows, grenades, blasts ----
{
  const mixer = new FakeMixer();
  const c = new CombatSounds();
  c.attach(mixer, '/');
  c.setTables(TABLES);
  c.melee(null, false, 0, 0, 0);
  ok(mixer.last() === 'sound/pl_swing_unarmed.snd', "bare hands swing with the melee table's own unarmed row");
  c.melee(null, true, 0, 0, 0);
  ok(mixer.last() === 'sound/pl_hit_unarmed.snd', 'and land with the game\'s own sound for it, which that row does not name');
  c.melee({ id: 'axe', class: 'sword2h', template: 'object/weapon/melee/2h_sword/shared_sword_axe.iff' }, false, 0, 0, 0);
  ok(mixer.last() === 'sound/wep_axe.snd', "a weapon the table names swings as itself");
  c.melee({ id: 'other', class: 'sword2h', template: 'object/weapon/melee/2h_sword/shared_sword_other.iff' }, false, 0, 0, 0);
  ok(mixer.last() === 'sound/wep_lrg_sharp_miss.snd', 'and one it does not swings as the kind of thing it is');
  c.melee({ id: 'other', class: 'sword2h', template: 'object/weapon/melee/2h_sword/shared_sword_other.iff' }, true, 0, 0, 0);
  ok(mixer.last() === 'sound/wep_lg_blade_hit_flesh.snd', 'and lands as one: six of the table`s 133 rows name a hit, so without a sound for the kind of thing that swung every sword would land with the bare-hands thud');
  c.grenade('grenade_fragmentation', 'arm', 0, 0, 0);
  ok(mixer.last() === 'sound/wep_frag_gren_act.snd', 'a grenade with an arming sound of its own takes it');
  c.grenade('grenade_bug_bomb', 'arm', 0, 0, 0);
  ok(mixer.last() === 'sound/wep_grenade_on.snd', 'and one without takes the plain one');
  c.grenade('grenade_fragmentation', 'land', 0, 0, 0);
  ok(mixer.last() === 'sound/wep_grenade_hit_terrain.snd', 'landing on the ground is the game\'s own sound for a grenade meeting the ground');
  c.blast(2, 0, 0, 0);
  ok(mixer.last() === 'sound/exp_small_generic.snd', 'a small blast is the small explosion');
  c.blast(20, 0, 0, 0);
  ok(mixer.last() === 'sound/exp_large_generic.snd', 'and a big one the large');
  c.blast(5, 0, 0, 0);
  const smallest = mixer.last();
  c.blast(6, 0, 0, 0);
  const middling = mixer.last();
  c.blast(8, 0, 0, 0);
  ok(smallest !== middling && middling !== mixer.last(), "the two radii that split the three are set so the game's own grenades (five to eight metres) fall on both sides of both, rather than all sounding alike");
  c.blast(5, 0, 0, 0, 'grenade_cryoban');
  ok(mixer.last() === 'sound/exp_cryoban_test.snd', 'while the two grenades with a blast of their own take theirs whatever their radius');
}

// ---- the held trigger ----
{
  const mixer = new FakeMixer();
  const c = new CombatSounds();
  c.attach(mixer, '/');
  c.hold('sound/wep_flamethrower_shoot_lp.snd', 1, 2, 3);
  ok(mixer.loops.size === 1, 'a held trigger holds one loop');
  c.hold('sound/wep_flamethrower_shoot_lp.snd', 1, 2, 4);
  ok(mixer.loops.size === 1 && mixer.started.length === 1, 'holding it again moves that one rather than starting another, which is what a held frame does sixty times a second');
  c.hold(null, 0, 0, 0);
  ok(mixer.loops.size === 0, 'letting go stops it');
  c.hold(null, 0, 0, 0);
  ok(mixer.stopped.length === 1, 'and letting go again, which every frame with no trigger down does, stops nothing');
  c.hold('sound/wep_rifle_lightning.snd', 0, 0, 0);
  c.leave();
  ok(mixer.loops.size === 0, 'and leaving the planet lets go of whatever was held');
  // A mixer with no voice to spare (or one recording rather than playing) refuses every loop.
  const full = new FakeMixer();
  full.refuseLoops = true;
  const d = new CombatSounds();
  d.attach(full, '/');
  for (let i = 0; i < 60; i++) d.hold('sound/wep_flamethrower_shoot_lp.snd', 0, 0, 0);
  ok(full.started.length === 1, 'a loop the mixer refuses is not asked for again on every frame the trigger is held, which would be sixty starts a second');
  d.update(COMBAT_TUNE.heldRetry * 2);
  d.hold('sound/wep_flamethrower_shoot_lp.snd', 0, 0, 0);
  ok(full.started.length === 2, 'and is tried again a few times a second, so a voice that comes free is taken');
}

// ---- the sabers' hook ----
{
  const c = new CombatSounds();
  c.attach(new FakeMixer(), '/');
  c.saberSwing('fast', 0, 0, 0, 'BOTH_A1_T__B_');
  ok(c.counts.saberNoHook === 1, 'a blade swung with no sabers installed is silent and counted, not a crash');
  const seen: string[] = [];
  c.useSaber({ swing: (style, _x, _y, _z, clip) => seen.push(`${style}:${clip}`), contact: (kind) => seen.push(kind) });
  c.saberSwing('strong', 0, 0, 0, 'BOTH_A3_T__B_');
  c.saberContact('body', 0, 0, 0);
  ok(seen.join(' ') === 'strong:BOTH_A3_T__B_ body', "and with them installed the style, the clip and the contact go straight through: the guns never decide what a blade sounds like");
}

// ---- nothing is heard without a mixer, and nothing throws ----
{
  const c = new CombatSounds();
  c.fire(GENERIC_GUN, 0, 0, 0);
  c.hit(GENERIC_GUN, 0, 0, 0, null);
  c.miss(GENERIC_GUN, 0, 0, 0, 'terrain');
  c.melee(null, true, 0, 0, 0);
  c.blast(3, 0, 0, 0);
  ok(c.counts.noHost >= 4, 'before the mixer exists every event is counted and nothing is played, which is what the select screen does');
  ok(c.status().tune !== undefined && (c.status().counts as { fires: number }).fires === 1, 'and the whole of it reads back as numbers, which is the only way a driven tab can check any of this');
}

// ---- the invented numbers are all in one place ----
{
  ok(COMBAT_TUNE.flyby === 3 && COMBAT_TUNE.flybyGap === 0.12, 'how near a bolt must pass to whine, and how often, are ours and sit together');
  ok(COMBAT_TUNE.volley === 0.04 && COMBAT_TUNE.blast[0] < COMBAT_TUNE.blast[1], "so are a volley's window and the two radii that make an explosion small, medium or large");
  ok(COMBAT_TUNE.heldRetry > 0 && COMBAT_TUNE.grenadeKnock > 0, 'and how often a refused loop is tried again, and the speed a thrown charge must lose in a step to have struck something');
  ok(GENERIC_GUN.miss.nothing === null, 'and the plain blaster ends its flight in silence, because the game gives it no sound for that');
  ok(SILENT_GUN.fire === null && SILENT_GUN.hit.metal === null && SILENT_GUN.miss.terrain === null, 'while the set that names nothing names nothing at all, for the two bolts fired under the world to compile their shaders');
}

console.log(`\n${passed} checks passed`);
