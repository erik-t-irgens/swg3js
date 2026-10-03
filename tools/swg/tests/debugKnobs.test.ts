// The fix round's debug knobs (group G4): the draw distance past the page, the detail levels' switch
// range, god mode, a weapon chosen for a body at its spawn, and the length of the day.
//
// Each is small because the plumbing under it was already there; what can go wrong is the seam, so
// every one is driven here through the very functions the game calls, and the wiring that only exists
// in files node cannot load (main.ts, the manager) is read out of the source:
//
//   - the reach: what the console holds against the page, the reach in force, the floors, the words a
//     long reach costs, and that every place the game used to set the reach from the settings alone now
//     asks the hold;
//   - the detail levels: the knob was already there (`lod({ tune: { bias } })`), and this pins that it
//     reaches the one multiplier the level pick reads;
//   - god mode: the one seam every blow ends in, the hull held and given back exactly as it was found
//     (a real Vehicle over Rapier for a speeder), the server's rule, and that a refused blow flashes
//     nothing;
//   - the weapon at spawn: finding one on a rack, refusing a body with no hand and a thing that is not
//     fought with, and a chosen weapon put in the hand over the body's own list and temper -- over the
//     converted rack as well when this machine has one;
//   - the day: a new length offline that bends the sun's pace without moving the hour, refused while a
//     server's clock is in use, and given back as this browser's own when the server goes.
//
// Run: node tools/swg/tests/debugKnobs.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { MENU_REACH_TOP, REACH_FLOOR, askReach, emptyHold, heldAxisNote, holding, reachInForce, reachWarnings } from '../../../src/world/reachHold.ts';
import { PLACED_TIERS } from '../../../src/world/placedTiers.ts';
import { GOD_REFUSED, GodHold, godRefusal, type GodHull } from '../../../src/player/godMode.ts';
import { GOD_NOTE, HeldNotes, REACH_NOTE } from '../../../src/ui/heldNotes.ts';
import { OWN_GUN_RANGE, decideArms, findRackWeapon, forcedArmsRefusal } from '../../../src/world/mobiles/arms.ts';
import { DayCycle } from '../../../src/world/daycycle.ts';
import { CLOCK_LIMITS, GAME_DAY_SECONDS, clockKnob, setOwnDayLength, sharedClock } from '../../../src/world/sharedClock.ts';
import { joinsTheFight } from '../../../src/space/shipCombat.ts';
import { Physics } from '../../../src/core/physics.ts';
import { Vehicle, specFor } from '../../../src/vehicles/vehicle.ts';
import { DEBUG_GROUPS } from '../../../src/ui/debugModel.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const src = (rel: string) => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const main = src('main.ts');
/** The text of a method or arrow from its signature to its own closing brace. */
function body(text: string, signature: string): string {
  const at = text.indexOf(signature);
  assert.ok(at >= 0, `no ${signature} in the source`);
  let i = text.indexOf('{', at + signature.length - 1);
  const start = i;
  let depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) break;
  }
  return text.slice(start, i + 1);
}

// --- 12: the reach, held against the page ---------------------------------------------------------
{
  const settings = { objectReach: 1, terrainRadius: 5, farRadius: 6 };
  const h = emptyHold();
  ok(!holding(h), '12: nothing is held to begin with');
  const r0 = reachInForce(h, settings);
  ok(r0.objects === 1 && r0.terrain === 5 && r0.far === 6, '12: and the reach in force is the settings, exactly');

  const refused = askReach(h, { objects: 6, terrain: 14.4, far: 16 });
  ok(refused.length === 0 && h.objects === 6 && h.terrain === 14 && h.far === 16, `12: the console holds past the page's tops with no ceiling, the ground counted in whole chunks and tiles (${h.objects}, ${h.terrain}, ${h.far})`);
  ok(holding(h), '12: and says it is holding');
  settings.objectReach = 1.4;
  settings.terrainRadius = 3;
  const r1 = reachInForce(h, settings);
  ok(r1.objects === 6 && r1.terrain === 14 && r1.far === 16, '12: a slider moved afterwards leaves a held axis where the console put it');
  askReach(h, { terrain: null });
  const r2 = reachInForce(h, settings);
  ok(h.terrain === null && r2.terrain === 3 && r2.objects === 6, '12: null hands one axis back to its setting and leaves the others held');
  const words = askReach(h, { objects: 0, far: Number.NaN });
  ok(h.objects === REACH_FLOOR.objects && h.far === 16 && words.length === 2, `12: a reach under the floor is raised to it and a value that is not a number is refused, both in words (${words.join(' | ')})`);
  askReach(h, { release: true });
  ok(!holding(h) && reachInForce(h, settings).objects === 1.4, '12: release hands all three back');
  askReach(h, { release: true, objects: 3 });
  ok(h.objects === 3 && h.terrain === null, '12: a release with an axis in the same call clears first and then holds what was asked');

  ok(reachWarnings(MENU_REACH_TOP).length === 0, "12: at the page's own tops nothing is warned about");
  const warn = reachWarnings({ objects: 6, terrain: 16, far: 20 });
  ok(warn.length === 3, `12: past them every axis says what it costs (${warn.length})`);
  ok(warn[0].includes(`${PLACED_TIERS[0].range * 6} m`) && warn[1].includes(`${33 * 33} chunks`) && warn[2].includes('10.2 km') && warn[2].includes('9 km'), '12: in numbers: the biggest tier\'s range, the chunk count, and far tiles past the 9 km far plane');
  ok(heldAxisNote(h, 'objectReach').includes('held at 3') && heldAxisNote(h, 'terrainRadius') === '', '12: a slider moved on a held axis is told so, and one on a free axis is told nothing');

  // The page's own tops, read out of menu.ts, so the warnings start where the sliders stop.
  const menu = src('ui/menu.ts');
  const top = (key: string) => Number(new RegExp(`key: '${key}'[^\\n]*?max: ([\\d.]+)`).exec(menu)?.[1]);
  ok(top('objectReach') === MENU_REACH_TOP.objects && top('terrainRadius') === MENU_REACH_TOP.terrain && top('farRadius') === MENU_REACH_TOP.far, `12: the tops the warnings start at are the Graphics page's own (${top('objectReach')}, ${top('terrainRadius')}, ${top('farRadius')})`);

  // Wiring: every place that set the reach from the settings alone now asks the hold.
  ok(!/this\.world\.setReach\(S\.objectReach/.test(main), '12: nothing sets the reach from the settings alone any more');
  ok((main.match(/this\.applyReach\(\)/g) ?? []).length >= 4, '12: the start, the creator closing, a slider and the console all go through applyReach');
  const apply = body(main, 'private applyReach(): void');
  ok(apply.includes('if (this.world.sceneOnly) return;') && apply.includes('reachInForce(this.reachHold, this.settings)'), "12: a captured place keeps its own small reach, and everything else takes the hold over the settings");
  ok(/this\.world\.setReach\(SCENE_REACH\.objects, SCENE_REACH\.terrain, SCENE_REACH\.far\)/.test(main), "12: the captured place's own reach is untouched");
  const slider = body(main, "case 'farRadius': {");
  ok(slider.includes('this.applyReach();') && slider.includes('heldAxisNote(this.reachHold, key)'), '12: a slider on a held axis says so on the message line');
  const helper = body(main, 'reach: (o?: { objects?: ReachAsk');
  for (const part of ['askReach(this.reachHold, o)', 'reachWarnings(', 'placedTierReport()', 'farTileReport()', 'groundReport()', 'floraReachReport()']) ok(helper.includes(part), `12: the answer carries ${part.replace(/\(.*$/, '')}`);
  ok(src('world/world.ts').includes('groundReport(): { chunks: number; metres: number }'), '12: the world counts its standing chunks for it');
}

// --- 13: the detail levels' switch range ----------------------------------------------------------
{
  const lod = body(main, 'lod: (o?: { on?: boolean; flora?: boolean; tune?: Partial<LodLevelTune>; reset?: boolean })');
  ok(lod.includes('(LOD_LEVEL_TUNE as unknown as Record<string, unknown>)[k] = v') && lod.includes('this.world.refreshDetail()'), '13: lod({ tune: { bias } }) writes the tune and sweeps every level again, live');
  ok(/const scale = LOD_LEVEL_TUNE\.bias \/ this\.rideBias;/.test(src('world/world.ts')), '13: and the bias is the one multiplier the level pick is handed over every switch distance');
  ok(DEBUG_GROUPS.some((g) => g.helpers.includes('lod')), '13: it is in the debug menu');
}

// --- 14: god mode ---------------------------------------------------------------------------------
{
  ok(godRefusal('me', false) === '' && godRefusal('me', true) === '', '14: with no server god mode is always allowed');
  ok(godRefusal('server', true) === '' && godRefusal('server', false) === GOD_REFUSED && GOD_REFUSED.includes('admin'), "14: with one, the world's admin's alone, refused in words to anybody else");

  // The hold, on made-up hulls.
  const speeder: GodHull = { spec: { ship: false }, invulnerable: false, combat: null };
  const shuttle: GodHull = { spec: { ship: true }, invulnerable: true, combat: null };
  const fight = { god: false };
  const ship = { spec: { ship: true }, invulnerable: false, combat: fight as { god: boolean } | null, disposed: false };
  const g = new GodHold();
  g.hold(speeder);
  ok(speeder.invulnerable && g.holding === speeder, '14: a speeder ridden in god mode is held invulnerable');
  g.hold(ship);
  ok(!speeder.invulnerable, '14: and given back the moment another hull is taken up');
  ok(fight.god && !ship.invulnerable, "14: a ship is held through its own fight, never through `invulnerable`");
  ok(joinsTheFight(ship), '14: so it is still a ship that joins the fight (a jump re-adopts the hull it carries, and an invulnerable one would come out with no fight)');
  g.letGo();
  ok(!fight.god && g.holding === null, '14: let go, the fight is mortal again');
  fight.god = true;
  g.hold(ship);
  g.letGo();
  ok(fight.god, '14: a fight the console had already made unhurtable keeps that when god mode lets go');
  fight.god = false;
  g.hold(shuttle);
  g.letGo();
  ok(shuttle.invulnerable, '14: a shuttle that was invulnerable before stays so afterwards');
  ship.combat = null;
  g.hold(ship);
  const late = { god: false };
  ship.combat = late;
  g.hold(ship);
  ok(late.god, "14: a ship boarded before its fight was adopted is held through the fight the moment it has one");
  g.hold(null);
  ok(!late.god && g.holding === null, '14: leaving the seat gives it back');

  // A real speeder over Rapier: held, a blow takes nothing; let go, it takes.
  const physics = await Physics.create();
  physics.createHeightfield(-64, -64, 128, 8, new Float32Array(81));
  const spec = specFor('speederbike', 'test', 'speeder', { min: [-0.5, 0, -2], max: [0.5, 1.2, 2] });
  const v = new Vehicle(spec, new THREE.Group(), physics, new THREE.Scene(), 0, spec.hover + 0.2, 0, 0);
  physics.stepOnce();
  const before = v.hp;
  const hold = new GodHold();
  hold.hold(v);
  v.damage(40);
  ok(v.hp === before && v.invulnerable, `14: a real speeder held in god mode takes nothing from a blow (${v.hp} of ${before})`);
  hold.letGo();
  v.damage(40);
  ok(!v.invulnerable && v.hp === before - 40, `14: and let go, it takes the next one (${v.hp})`);

  // The note on the display.
  const notes = new HeldNotes();
  const a = notes.join('', true, false);
  ok(a === GOD_NOTE && notes.join('', true, false) === a, '14: the display says god mode is on, the same string every frame while nothing changes');
  ok(notes.join('Weather held: Clear', true, true) === `Weather held: Clear · ${GOD_NOTE} · ${REACH_NOTE}` && notes.join('', false, false) === '', "14: joined after the weather's and the day's, with a held reach's after it, and nothing when nothing is out of the ordinary");

  // The seam: every way the player is hurt ends in takeDamage, and it asks first.
  const player = src('player/player.ts');
  const take = body(player, 'takeDamage(amount: number, force = false): boolean');
  ok(take.trimStart().startsWith('{\n    if (this.god && !force) return false;'), '14: Player.takeDamage asks god mode before anything else, and says the blow was refused');
  ok(/^\s+god = false;$/m.test(player) && !/god:\s/.test(src('core/settings.ts')), '14: the flag lives on the player and is never saved');
  const all = main.split('\n');
  const sites = all.map((l, i) => ({ l, next: all[i + 1] ?? '' })).filter((s) => /\.takeDamage\(/.test(s.l));
  const unguarded = sites.filter(({ l, next }) => {
    if (/if \((player|p)\.takeDamage\(/.test(l) || /takeDamage\(1e9, true\)/.test(l) || /=> this\.player\.takeDamage\(dmg\)/.test(l)) return false;
    // A blow kept in a name first: the very next line must flash on that name and nothing else.
    const named = /const (took|jolted) = /.exec(l);
    return !(named && new RegExp(`^\\s*if \\(${named[1]}\\) this\\.hurtFrom\\(`).test(next));
  });
  ok(sites.length >= 10 && unguarded.length === 0, `14: every blow main.ts lands on the player shows a flash only when it was taken (${sites.length} sites${unguarded.length ? `; not: ${unguarded.map((s) => s.l.trim()).join(' | ')}` : ''})`);
  const toSelect = body(main, 'private switchToSelect(): void');
  ok(/this\.player\.god = false;\s*this\.godHold\.letGo\(\);/.test(toSelect), '14: leaving for the select screen puts god mode down and gives back the hull it held, so the next character starts mortal');
  ok(/this\.player\.takeDamage\(1e9, true\)/.test(main), "14: kill('player') forces its way through");
  const vehicles = body(main, 'private stepVehicles(dt: number, simulate: boolean): void');
  const stepAt = vehicles.indexOf('this.stepGod(pilot);');
  ok(stepAt > 0 && stepAt < vehicles.indexOf('for (const v of this.world.vehicles)'), '14: what is flown or ridden is held before any hull steps, in the frame and in advance alike');
  const step = body(main, 'private stepGod(flown: Vehicle | null): void');
  ok(step.includes('godRefusal(this.net.session.authority, this.net.session.isAdmin)') && step.includes('p.god = false;') && step.includes('this.godHold.hold(p.god ? flown : null);'), '14: a server that does not make this browser its admin puts god mode down by itself');
  ok(body(main, 'private setGod(on: boolean): string').includes('godRefusal('), '14: and turning it on asks the same rule');
  ok((main.match(/this\.hud\.setWeatherNote\(this\.heldNote\(\)\)/g) ?? []).length === 3 && !main.includes('setWeatherNote(this.world.weather.heldNote())'), "14: every place the quiet line is written carries god mode's and the reach's notes");
  ok(DEBUG_GROUPS.some((gr) => gr.helpers.includes('god')) && DEBUG_GROUPS.some((gr) => gr.helpers.includes('reach')), '14: god and reach are filed in the debug menu');
}

// --- 15: a weapon for a body at its spawn ---------------------------------------------------------
{
  type W = { id: string; template: string; class: 'pistol' | 'rifle' | 'lightsaber' | 'thrown' | 'instrument'; name?: string | null };
  const rack: W[] = [
    { id: 'pistol_quest_dl44', template: 'object/weapon/ranged/pistol/shared_pistol_quest_dl44.iff', class: 'pistol', name: 'Quest DL-44' },
    { id: 'pistol_dl44', template: 'object/weapon/ranged/pistol/shared_pistol_dl44.iff', class: 'pistol', name: 'DL-44 Pistol' },
    { id: 'rifle_e11', template: 'object/weapon/ranged/rifle/shared_rifle_e11.iff', class: 'rifle', name: 'E-11 Carbine' },
    { id: 'sword_lightsaber_one_handed_gen1', template: 'object/weapon/melee/sword/crafted_saber/shared_sword_lightsaber_one_handed_gen1.iff', class: 'lightsaber', name: 'First Generation Lightsaber' },
    { id: 'grenade_fragmentation', template: 'object/weapon/ranged/grenade/shared_grenade_fragmentation.iff', class: 'thrown', name: 'Fragmentation Grenade' },
    { id: 'instrument_kloo_horn', template: 'object/tangible/instrument/shared_kloo_horn.iff', class: 'instrument', name: 'Kloo Horn' },
  ];
  ok(findRackWeapon(rack, 'rifle_e11')?.id === 'rifle_e11', '15: a weapon is found by its id');
  ok(findRackWeapon(rack, 'object/weapon/ranged/rifle/shared_rifle_e11.iff')?.id === 'rifle_e11' && findRackWeapon(rack, 'object\\weapon\\ranged\\rifle\\rifle_e11.iff')?.id === 'rifle_e11', "15: by its template, whole or by its file's name with or without shared_");
  ok(findRackWeapon(rack, 'E-11 Carbine')?.id === 'rifle_e11', "15: by the game's own name");
  ok(findRackWeapon(rack, 'dl44')?.id === 'pistol_dl44', "15: and by part of an id, the quest copy last, as the rack's own draw leaves it out");
  ok(findRackWeapon(rack, 'lightsaber')?.class === 'lightsaber' && findRackWeapon(rack, 'generation')?.class === 'lightsaber', '15: or part of a name');
  ok(findRackWeapon(rack, 'quest_dl44')?.id === 'pistol_quest_dl44', '15: though a quest copy asked for by name is what is found');
  ok(findRackWeapon(rack, 'nothing like it') === null && findRackWeapon(rack, '  ') === null, '15: and nothing for a word nothing holds');

  ok(forcedArmsRefusal('rancor', 'creature_base', rack[1]).includes('no hand'), '15: a creature has no hand to hold anything, and says so');
  ok(forcedArmsRefusal('stormtrooper', 'all_b', rack[4]).includes('not something a body fights with') && forcedArmsRefusal('stormtrooper', 'all_b', rack[5]) !== '', '15: a grenade and an instrument are not fought with');
  ok(forcedArmsRefusal('stormtrooper', 'all_b', rack[3]) === '', '15: a lightsaber in a stormtrooper\'s hand is taken');

  // decideArms with the console's choice, against what the body would have held without it.
  const roles = { ranged: null, rangedAdditive: false };
  const vendor = { id: 'vendor_human', kind: 'npc', species: 'human', appearance: 'x', flags: [], stats: { aggression: 'passive', ranged: null } } as unknown as Parameters<typeof decideArms>[0];
  const trooper = { id: 'stormtrooper', kind: 'npc', species: 'human', appearance: 'x', flags: [], stats: { aggression: 'aggressive', ranged: { range: 64, additive: false } } } as unknown as Parameters<typeof decideArms>[0];
  ok(decideArms(vendor, 'all_b', roles as never, undefined, null, rack) === null, "15: a vendor's temper keeps a gun out of its hands on its own");
  let draws = 0;
  const counted = () => {
    draws++;
    return 0.5;
  };
  const forced = decideArms(vendor, 'all_b', roles as never, undefined, { forcedTemplate: rack[1].template }, rack, counted);
  ok(forced?.weapon?.id === 'pistol_dl44' && forced.hold === 'gun' && forced.ranged?.range === OWN_GUN_RANGE, '15: the console\'s choice is put in its hand all the same, with a ranged attack to fire it with');
  ok(draws === 0, '15: and draws nothing from the spawn\'s numbers, so a seeded colour or style comes out as it always did');
  const unarmedOwn = decideArms(trooper, 'all_b', roles as never, undefined, { weapons: ['unarmed'], forcedTemplate: rack[3].template }, rack);
  ok(unarmedOwn?.weapon?.id === 'sword_lightsaber_one_handed_gen1' && unarmedOwn.hold === 'saber' && unarmedOwn.ranged === undefined, "15: over a list that says it fights with its fists, a lightsaber is held as a lightsaber");
  const shooter = decideArms(trooper, 'all_b', roles as never, undefined, { forcedTemplate: rack[2].template }, rack);
  ok(shooter?.weapon?.id === 'rifle_e11' && shooter.ranged === undefined, '15: a body that shoots already keeps its own ranged attack');
  ok(decideArms(trooper, 'creature_base', roles as never, undefined, { forcedTemplate: rack[1].template }, rack) === null, '15: a body with no hand holds nothing however it is asked');
  ok(decideArms(trooper, 'all_b', roles as never, undefined, { forcedTemplate: 'object/weapon/shared_not_there.iff' }, rack) === null && decideArms(trooper, 'all_b', roles as never, undefined, { forcedTemplate: rack[4].template }, rack) === null, '15: a template not on the rack, or a grenade, holds nothing');

  // The converted rack, when this machine has one: every weapon is found again by its own id and template.
  const wep = join('assets-private', 'weapons', 'manifest.json');
  if (existsSync(wep)) {
    const real = (JSON.parse(readFileSync(wep, 'utf8')) as { weapons: W[] }).weapons;
    const byId = real.filter((w) => findRackWeapon(real, w.id)?.id !== w.id);
    const byTemplate = real.filter((w) => findRackWeapon(real, w.template)?.template !== w.template);
    ok(real.length > 100 && byId.length === 0 && byTemplate.length === 0, `15: on the converted rack every one of ${real.length} weapons is found by its id and by its template`);
    const saber = findRackWeapon(real, 'lightsaber');
    ok(!!saber && forcedArmsRefusal('stormtrooper', 'all_b', saber) === '' && !/donotuse|quest|pvp/.test(saber.id), `15: 'lightsaber' finds a plain one a body can hold, not one the game never used (${saber?.id})`);
    const dl44 = findRackWeapon(real, 'dl44');
    ok(!dl44 || dl44.id === 'pistol_dl44', `15: 'dl44' is the DL-44 itself rather than one of its variants (${dl44?.id})`);
  } else console.log('note no converted weapons pack here: the rack is checked on made-up weapons only');

  // Wiring: the console's choice rides the spawn's options and is never laid on a body the world holds.
  const manager = src('world/mobiles/manager.ts');
  ok(/weaponTemplate\?: string;/.test(manager) && /const forced = opts\.weaponTemplate && !opts\.worldId \? opts\.weaponTemplate : undefined;/.test(manager) && /forcedTemplate: forced/.test(manager), "15: the manager hands the choice to the arms, for this browser's own spawns only");
  const helper = body(main, 'mobile: async (idOrFind: string, metres = 10, n = 1, opts?: { level?: number; tier?: number; weapon?: string })');
  ok(helper.includes('findRackWeapon(rack.weapons, String(opts.weapon))') && helper.includes('forcedArmsRefusal(e.name, cat.packOf(e)?.hierarchy, weapon)') && helper.includes('weaponTemplate: weapon.template'), '15: __debug.mobile finds the weapon, refuses in words, and passes it through the spawn options');
  ok(helper.indexOf('forcedArmsRefusal(') < helper.indexOf('mobiles.spawnAhead('), '15: and refuses before anything is stood');
}

// --- 16: the day's length, offline only -----------------------------------------------------------
{
  const EPOCH = 1_700_000_000_000;
  let wall = EPOCH;
  sharedClock.wall = () => wall;
  sharedClock.none();
  const day = new DayCycle(0, 1);
  const dt = 1 / 60;
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      wall += dt * 1000;
      day.update(dt, false);
    }
  };
  day.time = 0.3;
  day.release();
  frames(1);
  ok(day.dayLengthSeconds === GAME_DAY_SECONDS && GAME_DAY_SECONDS === 720, "16: the day is the game's own twelve minutes to begin with");
  const t0 = day.time;
  const said = clockKnob({ length: 3600 }).said as string;
  ok(day.dayLengthSeconds === 3600 && said.includes('3600'), `16: with no server it is set from the console (${said})`);
  frames(1);
  ok(Math.abs(day.time - (t0 + dt / 3600)) < 1e-9, '16: and the hour does not move when it is: the next frame steps by the new length from where the day stood');
  const t1 = day.time;
  frames(60 * 60);
  ok(Math.abs(day.time - t1 - 60 / 3600) < 1e-6, `16: a minute of frames is a sixtieth of an hour-long day (${(day.time - t1).toFixed(5)})`);
  const report = clockKnob() as { day: { lengthSeconds: number; gameLengthSeconds: number } };
  ok(report.day.lengthSeconds === 3600 && report.day.gameLengthSeconds === 720, "16: the knob reports the length in force beside the game's own");
  for (const bad of [0, 0.5, CLOCK_LIMITS.maxDayMs / 1000 + 1, Number.NaN, Number.POSITIVE_INFINITY]) setOwnDayLength(bad);
  ok(day.dayLengthSeconds === 3600 && setOwnDayLength(0).includes('between'), '16: a length that cannot be a day is refused in words and changes nothing');

  // A server: its length is in force, and the knob refuses with the reason.
  sharedClock.hail(EPOCH + 5000, 1_800_000);
  ok(day.dayLengthSeconds === 1800, "16: a server's own day is believed");
  const refused = setOwnDayLength(60);
  ok(day.dayLengthSeconds === 1800 && refused.includes("server's") && refused.includes('--day='), `16: and the console's length is refused while it is in use, saying where a server's is set (${refused.slice(0, 60)}...)`);
  sharedClock.lost();
  ok(setOwnDayLength(60).includes("server's") && day.dayLengthSeconds === 1800, '16: still refused with the server gone and its offset kept, since the day is still its');
  sharedClock.none();
  ok(day.dayLengthSeconds === 3600, '16: told there is no server, the length set before it came is this browser\'s own again');
  ok(clockKnob({ length: null }).said === `a day is the game's own ${GAME_DAY_SECONDS} s again` && day.dayLengthSeconds === 720, "16: and null puts the game's own back");
  const sharedSrc = src('world/sharedClock.ts');
  ok(/if \(sharedClock\.shared\) \{/.test(body(sharedSrc, 'export function setOwnDayLength(seconds: number | null): string')), '16: the refusal is the shared clock in use, which covers a server gone adrift as well as one answering');
}

console.log(`\n${checks} checks passed`);
