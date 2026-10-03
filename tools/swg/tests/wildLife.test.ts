// The wild world running: standing lairs, herds and camps as the player comes near, putting them away
// behind, and bringing a broken one back on its own clock.
//
// It is driven headless with a made-up game underneath it, which is what the narrow `WildDeps` is
// for. Where the real packs are converted it then lays a real world out and stands it, which is the
// only way to know the numbers tuned on a fixture do something sensible over a real planet.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { WildLife, WILD_TUNE, intoWorld, readsSpawns, type WildDeps, type WildManifest, type WildPack, type WildSpawn } from '../../../src/world/wildLife.ts';
import { SPAWNS_FORMAT } from '../spawnpack.mjs';
import { LAIR_TUNE, nestHealth, reinforcements, type LairDef, type LairSite } from '../../../src/world/mobiles/lairs.ts';
import { NEST_MODEL_TUNE, NestModels, WildCamp, WildNest, effectMatrix, pieceGround, type NestDeps } from '../../../src/world/wildNest.ts';
import { Physics } from '../../../src/core/physics.ts';
import { relativeRoot } from '../../../src/world/packPath.ts';
import { surfaces } from '../../../src/world/surfaces.ts';
import { setDifficulty } from '../../../src/world/difficulty.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

/** A stood body, as little of one as the wild world ever touches. */
interface Body {
  dead: boolean;
  removed: boolean;
  x: number;
  z: number;
  heading: number;
  entry: string;
  how: WildSpawn;
  /** Where it stands, for the console's report. */
  pos: { x: number; y: number; z: number };
}

/** A game that is entirely made up, so the rules are what is being measured. */
function game(over: Partial<WildDeps> = {}): { deps: WildDeps; bodies: Body[]; centre: { x: number; z: number } } {
  const bodies: Body[] = [];
  const centre = { x: 0, z: 0 };
  const deps: WildDeps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
    spawn: (entry, at, how) => {
      const b: Body = { dead: false, removed: false, x: at.x, z: at.z, heading: at.heading ?? 0, entry: (entry as { id: string }).id, how, pos: { x: at.x, y: 0, z: at.z } };
      bodies.push(b);
      return b as never;
    },
    remove: (m) => {
      (m as unknown as Body).removed = true;
    },
    centre: () => centre,
    held: () => false,
    ...over,
  };
  return { deps, bodies, centre };
}

const thingGame = { level: 40, hp: 900, damage: 30, aggression: 'defensive', ranged: null, attackable: true };
const manifest: WildManifest = {
  format: 1,
  creatures: {
    thing: { id: 'thing_model', level: 5, hp: 200, hpMax: 240, damage: [10, 14], diet: 'herbivore', kind: 'herbivore', aggressive: false, herd: true, pack: false, social: '' },
  },
  lairs: {
    L: { kind: 'creature_lair', mobiles: [{ who: 'thing', n: 1 }], boss: [], cap: 15, nest: 'nest.iff', building: '', people: false },
  },
  groups: { g: [{ lair: 'L', weight: 1, count: 15, size: 25, limit: -1, minDiff: 1, maxDiff: 8 }] },
};

const pack = (areas: WildPack['areas'], noSpawn: WildPack['noSpawn'] = []): WildPack => ({ format: 1, planet: 'w', areas, noSpawn, statics: [] });

/**
 * One area about the origin, laid on a fine grid for these checks, so there are plenty of sites within
 * reach of a player standing there. The real grid's 240 m cells hold a site within reach of three
 * quarters of a world, which is the point of them and the ruin of a test that needs a dozen near.
 */
const nearArea = { name: 'a', shape: 'circle' as const, x: 0, z: 0, r: 400, groups: ['g'], cap: 64 };
const bigArea = { name: 'a', shape: 'circle' as const, x: 0, z: 0, r: 3000, groups: ['g'], cap: 64 };
function fine<T>(run: () => T, cell = 50): T {
  const had = { cell: LAIR_TUNE.cell, gap: LAIR_TUNE.gap };
  Object.assign(LAIR_TUNE, { cell, gap: 0 });
  try {
    return run();
  } finally {
    Object.assign(LAIR_TUNE, had);
  }
}

/** A wild world laid on the fine grid (the layout is made in `adopt`, so only that needs the fine grid). */
function nearWorld(areas: WildPack['areas'] = [nearArea], man: WildManifest = manifest, cell = 50): WildLife {
  const w = new WildLife();
  fine(() => w.adopt(pack(areas), man), cell);
  return w;
}

// ------------------------------------------------------------------ laying the world out
{
  const w = new WildLife();
  ok(!w.ready, 'a wild world with no pack is not ready and does nothing at all');
  w.adopt(pack([bigArea]), manifest);
  ok(w.ready && w.last.sites > 50, `a pack lays ${w.last.sites} sites on the grid`);

  // A place the server said nothing may stand in is not a place.
  const blocked = new WildLife();
  blocked.adopt(pack([bigArea], [{ name: 'town', shape: 'circle', x: 0, z: 0, r: 9000, groups: [], cap: 0 }]), manifest);
  ok(blocked.last.sites === 0, 'and a site inside a no-spawn area is never laid, which is what keeps a lair out of a town');

  // A pack in a format nobody knows is refused rather than half-read.
  const old = new WildLife();
  old.adopt({ ...pack([bigArea]), format: 99 }, manifest);
  ok(!old.ready, 'a pack in a format this build does not know is refused outright');

  ok(readsSpawns(SPAWNS_FORMAT) && readsSpawns(1) && !readsSpawns(SPAWNS_FORMAT + 1) && !readsSpawns('2'), `the converter's format ${SPAWNS_FORMAT} is one this build reads, as is format 1, and nothing it has not seen`);
  const two = new WildLife();
  two.adopt({ ...pack([bigArea]), format: SPAWNS_FORMAT }, { ...manifest, format: SPAWNS_FORMAT, creatures: { thing: { ...manifest.creatures.thing, game: thingGame } } });
  ok(two.ready && two.last.sites === w.last.sites, `a format-${SPAWNS_FORMAT} pack lays the same world a format-1 pack of the same areas does (${two.last.sites} sites)`);
  ok(two.peopleCreatures()?.thing?.game?.aggression === 'defensive' && new WildLife().peopleCreatures() === null, "and hands each creature's own numbers on to the people standing about, where a world with no pack has none");

  // The console's coverage is the pure function's, over the whole world's square.
  const c = w.coverageReport();
  ok(c.sites === w.last.sites && c.points === 3600 && c.share > 0 && c.share < 0.3, `the console's coverage reads the laid sites over the whole square (${(c.share * 100).toFixed(1)}% for one area six kilometres across)`);
}

// ------------------------------------------------------------------ standing and putting away
{
  const w = nearWorld();
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);

  w.step(1, 1, at, deps);
  ok(w.last.up > 0 && bodies.length > 0, `standing at the middle of an area stands ${w.last.up} sites and ${bodies.length} bodies`);
  ok(w.last.up <= LAIR_TUNE.liveLairs, `never more than ${LAIR_TUNE.liveLairs} at once`);
  ok(w.last.up <= WILD_TUNE.sitesPerPass, `and never more than ${WILD_TUNE.sitesPerPass} sites in one pass, so an arrival spreads its model loads over a few seconds`);
  ok(WILD_TUNE.sitesPerPass < LAIR_TUNE.liveLairs, 'and that budget really binds, being smaller than the number allowed up at once');

  // Standing still costs nothing more.
  const before = bodies.length;
  w.step(WILD_TUNE.everySeconds + 0.1, 5, at, deps);
  w.step(WILD_TUNE.everySeconds + 0.1, 9, at, deps);
  const settled = w.last.up;
  w.step(WILD_TUNE.everySeconds + 0.1, 13, at, deps);
  ok(w.last.up === settled && w.last.stood === 0, 'once they are up, standing still stands nothing more');
  ok(bodies.length > before, 'though a second pass finishes what the first one had no room for');

  // Every body its own name in the world and its own creature's numbers.
  const ids = new Set(bodies.map((b) => b.how.id));
  ok(ids.size === bodies.length, `every body has a name no other shares (${ids.size} of ${bodies.length}), so the manager's map of them never loses one`);

  // Walking away puts them down.
  const away = new THREE.Vector3(20000, 0, 20000);
  w.step(WILD_TUNE.everySeconds + 0.1, 20, away, deps);
  ok(w.last.up === 0, 'walking off the edge of the world puts every one of them away');
  ok(bodies.every((b) => b.removed), 'and every body it stood is really taken down, not merely forgotten');
}

// ------------------------------------------------------------------ one of a site's people asked to follow the player
{
  // Given up to the people following the player (`WildLife.release`, src/world/followers.ts): off its
  // site's books without being taken away, and counted as the site's loss to the player, so a site whose
  // last body walks off with you waits its own clock rather than standing a fresh crowd in front of you --
  // the very thing a body the game merely took away does not do, which is the control below.
  const at = new THREE.Vector3(0, 0, 0);
  const settle = (w: WildLife, deps: WildDeps, from: number): number => {
    let t = from;
    for (let i = 0; i < 12; i++) {
      t += WILD_TUNE.everySeconds + 0.1;
      w.step(WILD_TUNE.everySeconds + 0.1, t, at, deps);
    }
    return t;
  };
  const w = nearWorld();
  const { deps, bodies } = game();
  let t = settle(w, deps, 0);
  const up = bodies.filter((b) => !b.removed && !b.dead);
  ok(up.length > 1, `${up.length} bodies stand`);
  const before = w.last.bodies;
  ok(w.release(up[0] as never) && !up[0].removed && w.last.bodies === before - 1, 'one asked to follow is off its site\'s books, and still in the world');
  ok(!w.release(up[0] as never), 'asked again, it is no site\'s to give');
  for (const b of up.slice(1)) w.release(b as never);
  const made = bodies.length;
  t = settle(w, deps, t);
  ok(w.last.bodies === 0 && bodies.length === made, `every one of them asked to follow, their sites wait their own clocks and nobody new is stood (${bodies.length - made} stood)`);
  // The control: the same world's bodies merely taken away by the game are stood again at once.
  const w2 = nearWorld();
  const g2 = game();
  const t2 = settle(w2, g2.deps, 0);
  for (const b of g2.bodies) {
    b.removed = true;
    b.dead = true;
  }
  const made2 = g2.bodies.length;
  settle(w2, g2.deps, t2);
  ok(g2.bodies.length > made2, `while the same bodies merely taken away are stood again at once (${g2.bodies.length - made2} stood)`);
}

// ------------------------------------------------------------------ its own numbers and weapons
{
  const man: WildManifest = {
    ...manifest,
    format: 2,
    creatures: { thing: { ...manifest.creatures.thing, game: thingGame, weapons: ['primitive_weapons'] } },
    weaponGroups: { primitive_weapons: ['object/weapon/melee/knife/knife_stone.iff'] },
  };
  const w = nearWorld([nearArea], man);
  const { deps, bodies } = game();
  w.step(1, 1, new THREE.Vector3(0, 0, 0), deps);
  const b = bodies[0];
  ok(!!b && b.how.overrides?.hp === 900 && b.how.overrides?.level === 40 && b.how.overrides?.aggression === 'defensive', "a lair's body stands with its own creature's level, health and temper, the standing people's own overrides");
  ok(!!b && b.how.weapons?.[0] === 'primitive_weapons' && b.how.weaponGroups?.primitive_weapons?.length === 1, 'and its own weapons with the groups they stand for, to be armed as a standing person is');
}

// ------------------------------------------------------------------ the mirror, which decides which side of the world they are on
{
  ok(intoWorld(100, 50, { x: 0, z: 0 }).x === -100, "a point in the pack's frame has its x negated, exactly as every placed object does");
  ok(intoWorld(100, 50, { x: 0, z: 0 }).z === 50, 'and its z carried through');
  ok(intoWorld(100, 50, { x: 40, z: 10 }).x === -60 && intoWorld(100, 50, { x: 40, z: 10 }).z === 40, "and the layout's own centre taken off both");

  // End to end: an area laid at a known spot stands its bodies about the mirrored place.
  const spot = { name: 'a', shape: 'circle' as const, x: 1000, z: 500, r: 150, groups: ['g'], cap: 64 };
  const w = nearWorld([spot]);
  const { deps, bodies } = game();
  const world = intoWorld(1000, 500, { x: 0, z: 0 });
  w.step(1, 1, new THREE.Vector3(world.x, 0, world.z), deps);
  ok(bodies.length > 0, 'an area off in the world stands its lairs when the player is at it');
  const off = Math.max(...bodies.map((b) => Math.hypot(b.x - world.x, b.z - world.z)));
  ok(off < 150 + LAIR_TUNE.herdSpread + 2, `and every body stands within ${off.toFixed(1)} m of the mirrored place, not the unmirrored one`);
  const unmirrored = Math.min(...bodies.map((b) => Math.hypot(b.x - 1000, b.z - 500)));
  ok(unmirrored > 100, 'which is nowhere near where the pack says, because the pack speaks the snapshot and the world does not');
}

// ------------------------------------------------------------------ onto walkable ground
{
  // A walk grid that calls everything within 30 m of the origin blocked, and a world whose every site
  // is within 20 m of it: each is moved out to the first open ground, and the same place every time.
  const one = { name: 'a', shape: 'circle' as const, x: 0, z: 0, r: 20, groups: ['g'], cap: 64 };
  const w = nearWorld([one], manifest, 10);
  const lake = (x: number, z: number) => Math.hypot(x, z) > 30;
  // The ground is level and counted: the search for level ground asks it, and nothing else here does.
  let groundAsked = 0;
  const { deps, bodies } = game({
    walkable: (x, z) => lake(x, z),
    groundAt: () => {
      groundAsked++;
      return 0;
    },
  });
  const origin = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 3; i++) w.step(WILD_TUNE.everySeconds + 0.1, 1 + i * 2, origin, deps);
  const rep = w.report(origin, { x: 0, z: 0 });
  ok(rep.length > 0 && rep.every((r) => r.nudged > 0), `a site laid in a lake is moved to its shore before anything stands (${rep.map((r) => r.nudged).join(', ')} m)`);
  ok(rep.every((r) => r.away > 30 - 1e-6), 'its middle is on the shore');
  const inLake = bodies.filter((b) => !lake(b.x, b.z)).length;
  ok(bodies.length > 0 && inLake === 0, `and its people stand on the shore too, each moved out of the water within its lair's spread (${bodies.length} bodies, ${inLake} in the lake)`);

  // The place found is kept: walked away from and come back to, a site stands where it stood, and is
  // not searched for again.
  const standingOf = (x: WildLife) => (x as unknown as { standing: Map<string, { at: { x: number; z: number } }> }).standing;
  const before = new Map([...standingOf(w)].map(([k, r]) => [k, { ...r.at }]));
  w.step(WILD_TUNE.everySeconds + 0.1, 20, new THREE.Vector3(20000, 0, 20000), deps);
  ok(standingOf(w).size === 0, 'walking away puts the moved sites down');
  const listed = w.nearest(origin, { x: 0, z: 0 }, 50).filter((s) => before.has(s.key));
  ok(listed.length === before.size && listed.every((s) => s.x === Math.round(before.get(s.key)!.x) && s.z === Math.round(before.get(s.key)!.z)), "and the console lists each where it was moved to, not where it was laid");
  groundAsked = 0;
  for (let i = 0; i < 3; i++) w.step(WILD_TUNE.everySeconds + 0.1, 30 + i * 2, origin, deps);
  const back = standingOf(w);
  const same = [...before].every(([k, at]) => back.get(k)?.at.x === at.x && back.get(k)?.at.z === at.z);
  ok(back.size === before.size && same, 'coming back stands every one of them at the very place it stood before');
  ok(groundAsked === 0, `and without searching for it again: the ground was asked ${groundAsked} times`);
  const dry = nearWorld([one], manifest, 10);
  const none = game({ walkable: (x, z) => Math.hypot(x, z) > 200 });
  dry.step(1, 1, new THREE.Vector3(0, 0, 0), none.deps);
  ok(none.bodies.length === 0 && dry.last.unwalkable > 0 && dry.last.up === 0, `one with no open ground within ${LAIR_TUNE.siteNudge} m is not stood at all (${dry.last.unwalkable} given up on)`);
  const shut = dry.nearest(new THREE.Vector3(0, 0, 0), { x: 0, z: 0 }, 200).filter((s) => !s.open);
  ok(shut.length === dry.last.unwalkable, `and the console marks each of those as never standing (${shut.length}), so going to the nearest site passes them by`);
  // And ground the server would not have used: a hillside rising forty metres over twenty everywhere.
  const cliff = nearWorld([one], manifest, 10);
  const steep = game({ walkable: () => true, groundAt: (x) => 2 * x });
  cliff.step(1, 1, new THREE.Vector3(0, 0, 0), steep.deps);
  ok(steep.bodies.length === 0 && cliff.last.unwalkable > 0, "a site on a hillside the server's flatness test refuses is not stood either, however walkable the grid calls it");
  const gentle = nearWorld([one], manifest, 10);
  const soft = game({ walkable: () => true, groundAt: (x) => 0.3 * x });
  gentle.step(1, 1, new THREE.Vector3(0, 0, 0), soft.deps);
  ok(soft.bodies.length > 0 && gentle.last.unwalkable === 0, 'while one on a gentle slope stands where it was laid');
  const noGrid = nearWorld([one], manifest, 10);
  const unknown = game({ walkable: () => null });
  noGrid.step(1, 1, new THREE.Vector3(0, 0, 0), unknown.deps);
  ok(unknown.bodies.length > 0 && noGrid.last.unwalkable === 0, 'and a world with no walk grid stands every site where it was laid, as it always did');
}

// ------------------------------------------------------------------ the ground generated first
{
  // A site's standing asks the ground hundreds of times, and ground not generated yet is generated on
  // the main thread to answer. So the ground about it is asked for first and the site waits for it.
  const w = nearWorld();
  let ready = false;
  const reaches: number[] = [];
  let groundAsked = 0;
  const { deps, bodies } = game({
    walkable: () => true,
    groundAt: () => {
      groundAsked++;
      return 0;
    },
    groundReady: (_x, _z, reach) => {
      reaches.push(reach);
      return ready;
    },
  });
  const at = new THREE.Vector3(0, 0, 0);
  w.step(1, 1, at, deps);
  ok(bodies.length === 0 && w.last.up === 0 && w.last.waiting === 1 && groundAsked === 0, 'with the ground under it still coming, the nearest site waits, holding back the ones farther off, and nothing asks the ground at all');
  ok(reaches.every((r) => r >= LAIR_TUNE.siteNudge + LAIR_TUNE.flatReach), `and what is asked for covers everywhere the search for level ground can reach (${Math.min(...reaches)} m either way)`);
  ready = true;
  w.step(WILD_TUNE.everySeconds + 0.1, 3, at, deps);
  ok(bodies.length > 0 && w.last.waiting === 0, 'once it is there they stand on the next pass');
}

// ------------------------------------------------------------------ the world holding still
{
  const w = nearWorld();
  let holding = true;
  const { deps, bodies } = game({ held: () => holding });
  w.step(10, 10, new THREE.Vector3(0, 0, 0), deps);
  ok(bodies.length === 0 && w.last.up === 0, 'a world holding still stands nothing, so a ten-kilometre-a-second cruise does not lay three hundred lairs');
  holding = false;
  w.step(10, 20, new THREE.Vector3(0, 0, 0), deps);
  ok(bodies.length > 0, 'and it picks up again the moment the hold comes off');
}

// ------------------------------------------------------------------ a broken lair comes back
{
  const w = nearWorld();
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 4; i++) w.step(WILD_TUNE.everySeconds + 0.1, i * 2, at, deps);
  const up = w.last.up;
  ok(up > 0, `${up} sites standing before anything is killed`);

  // Kill everything at every site.
  for (const b of bodies) b.dead = true;
  w.step(WILD_TUNE.everySeconds + 0.1, 100, at, deps);
  ok(w.last.bodies === 0, 'with every one of them dead the sites hold no bodies');
  ok(w.last.up === up, 'but the sites themselves are still there, broken, rather than standing again at once');

  w.step(1, 100 + LAIR_TUNE.respawn[0] - 10, at, deps);
  ok(w.last.up === up, 'and still there a moment before its clock is out');

  const madeBefore = bodies.length;
  w.step(1, 100 + LAIR_TUNE.respawn[1] + 1, at, deps);
  w.step(WILD_TUNE.everySeconds + 0.1, 100 + LAIR_TUNE.respawn[1] + 5, at, deps);
  ok(bodies.length > madeBefore, 'once the clock is out the same seed stands the same animals in the same places again');
}

// ------------------------------------------------------------------ a server's word that a name is down
{
  // Every other browser has a lair's body down for its row's wait once it is seen to die (`downFor`, the
  // server's answer), and this browser must not stand it whole meanwhile.
  const w = nearWorld();
  let t = 0;
  const downs = new Map<string, number>();
  const { deps, bodies } = game({ downFor: (id) => Math.max(0, (downs.get(id) ?? -Infinity) - t) });
  const at = new THREE.Vector3(0, 0, 0);
  const allDown = game({ downFor: (id) => (id.startsWith('wild:') ? 30 : 0) });
  nearWorld().step(1, 1, at, allDown.deps);
  ok(allDown.bodies.length === 0, 'a site whose every body another browser has seen die stands none of them here');
  for (let i = 0; i < 4; i++) {
    t = i * 2;
    w.step(WILD_TUNE.everySeconds + 0.1, t, at, deps);
  }
  const up = w.last.up;
  const stood = bodies.length;
  ok(up > 0 && stood > 0, `${up} sites and ${stood} bodies stand where nothing is down`);
  // Everything killed at 100, and the server holding every name down well past every site's own clock --
  // as a body whose word came back late, or a nest broken after its last guard, is held.
  t = 100;
  const late = 100 + LAIR_TUNE.respawn[1] + 40;
  for (const b of bodies) {
    b.dead = true;
    downs.set(`wild:${b.how.id}`, late);
  }
  w.step(WILD_TUNE.everySeconds + 0.1, t, at, deps);
  for (const when of [100 + LAIR_TUNE.respawn[1] + 1, 100 + LAIR_TUNE.respawn[1] + 5, late - 2]) {
    t = when;
    w.step(WILD_TUNE.everySeconds + 0.1, t, at, deps);
  }
  ok(bodies.length === stood, 'a site whose own clock is out waits while the server still holds any of its names down, rather than standing some and skipping the rest');
  for (const when of [late + 1, late + 3, late + 5, late + 7]) {
    t = when;
    w.step(WILD_TUNE.everySeconds + 0.1, t, at, deps);
  }
  const back = bodies.slice(stood);
  const firsts = new Set(bodies.slice(0, stood).filter((b) => b.how.id.endsWith(':0')).map((b) => b.how.id));
  ok(back.length > 0 && [...firsts].every((id) => back.some((b) => b.how.id === id)), `once the last of them is out it comes back whole, its first body and all (${back.length} stood again)`);
}

// ------------------------------------------------------------------ killed is not the same as gone
{
  // The bug this pins: a site whose creatures the game took away for its own reasons -- it swept
  // them, they fell out of the world, a travel disposed them -- was marked broken and sat empty for
  // five to ten minutes. Only a lair somebody really cleared should do that.
  const w = nearWorld();
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 4; i++) w.step(WILD_TUNE.everySeconds + 0.1, i * 2, at, deps);
  ok(w.last.up > 0, `${w.last.up} sites standing`);

  // **Taken away sets `dead` as well as `removed`**, which is the trap: disposing a mobile marks it
  // dead (`mobile.ts:2077`), so a test that only sets `removed` would pass while the real thing
  // failed. What tells a kill from a disposal is the corpse.
  for (const b of bodies) {
    b.dead = true;
    b.removed = true;
  }
  w.step(WILD_TUNE.everySeconds + 0.1, 20, at, deps);
  ok(w.last.up === 0, 'a site with nothing in its middle whose creatures were taken away rather than killed is forgotten, not broken');
  const had = bodies.length;
  w.step(WILD_TUNE.everySeconds + 0.1, 22, at, deps);
  ok(bodies.length > had, 'so it stands again on the very next pass instead of waiting out a respawn it never earned');

  for (const b of bodies) if (!b.removed) b.dead = true;
  w.step(WILD_TUNE.everySeconds + 0.1, 30, at, deps);
  const after = bodies.length;
  w.step(WILD_TUNE.everySeconds + 0.1, 32, at, deps);
  ok(bodies.length === after, 'while a lair that was really cleared stays cleared until its own clock is out');
}

// ------------------------------------------------------------------ the most wild bodies at once
{
  const had = LAIR_TUNE.liveBodies;
  LAIR_TUNE.liveBodies = 6;
  try {
    const w = nearWorld();
    const { deps, bodies } = game();
    const at = new THREE.Vector3(0, 0, 0);
    let most = 0;
    for (let i = 0; i < 8; i++) {
      w.step(WILD_TUNE.everySeconds + 0.1, i * 2, at, deps);
      most = Math.max(most, bodies.filter((b) => !b.removed && !b.dead).length);
    }
    ok(most > 0 && most <= 6, `with the cap at 6 the lairs stand ${most} bodies between them, never more`);
    ok(w.last.bodies <= 6, 'and the count the console reads agrees');
  } finally {
    LAIR_TUNE.liveBodies = had;
  }
}

// ------------------------------------------------------------------ respawning switched off
{
  const w = nearWorld();
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 4; i++) w.step(WILD_TUNE.everySeconds + 0.1, i * 2, at, deps);
  const up = w.last.up;
  w.setRespawns(false);
  try {
    for (const b of bodies) b.dead = true;
    w.step(WILD_TUNE.everySeconds + 0.1, 100, at, deps);
    const made = bodies.length;
    w.step(1, 100 + LAIR_TUNE.respawn[1] + 1, at, deps);
    w.step(WILD_TUNE.everySeconds + 0.1, 100 + LAIR_TUNE.respawn[1] + 5, at, deps);
    ok(bodies.length === made && w.last.up === up, 'with respawning off a broken lair stays broken when its clock is out');
    const broken = new Set(w.report(at, { x: 0, z: 0 }).map((r) => r.key));
    w.step(WILD_TUNE.everySeconds + 0.1, 800, new THREE.Vector3(20000, 0, 20000), deps);
    ok(w.last.cleared === up, `walking away remembers the ${up} it broke as cleared`);
    for (let i = 0; i < 4; i++) w.step(WILD_TUNE.everySeconds + 0.1, 810 + i * 2, at, deps);
    const back = w.report(at, { x: 0, z: 0 }).map((r) => r.key);
    ok(back.every((k) => !broken.has(k)), `and coming back stands none of them, which would be a respawn by another name (${back.length} other sites stand instead)`);
    w.setRespawns(true);
    w.step(WILD_TUNE.everySeconds + 0.1, 900, new THREE.Vector3(20000, 0, 20000), deps);
    for (let i = 0; i < 4; i++) w.step(WILD_TUNE.everySeconds + 0.1, 902 + i * 2, at, deps);
    const again = w.report(at, { x: 0, z: 0 }).map((r) => r.key);
    ok(w.last.cleared === 0 && again.some((k) => broken.has(k)), 'turned on again, they stand once more when next come near');
  } finally {
    w.setRespawns(true);
  }

  const standingNow = bodies.filter((b) => !b.removed && !b.dead);
  w.restand();
  ok(standingNow.length > 0 && standingNow.every((b) => b.removed) && w.last.up === 0, 'a restand takes the bodies down with their records');

  // The live knob moves a number only for one of its own kind, in either table.
  const was = { build: LAIR_TUNE.build, sitesPerPass: WILD_TUNE.sitesPerPass };
  const moved = w.retune({ build: 150, sitesPerPass: 1, guards: [3, 3], liveLairs: 'many' });
  ok(moved.join() === 'build,guards,sitesPerPass' && LAIR_TUNE.build === 150 && WILD_TUNE.sitesPerPass === 1 && LAIR_TUNE.guards[0] === 3, `the live knob moves what it is given of the right kind (${moved.join()})`);
  w.retune({ build: was.build, sitesPerPass: was.sitesPerPass, guards: [4, 5] });

  // Moving how sites are laid lays the world out again.
  const laid = new WildLife();
  laid.adopt(pack([bigArea]), manifest);
  const sites = laid.last.sites;
  const cell = LAIR_TUNE.cell;
  try {
    laid.retune({ cell: cell / 2 });
    ok(laid.last.sites > sites * 2, `and moving how sites are laid lays the world out again (${sites} to ${laid.last.sites} sites at half the cell)`);
  } finally {
    laid.retune({ cell });
  }
  ok(laid.last.sites === sites, 'and back again when it is put back');
}

// ------------------------------------------------------------------ a struck nest and the most wild bodies at once
{
  const w = nearWorld();
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 4; i++) w.step(WILD_TUNE.everySeconds + 0.1, i * 2, at, deps);
  const standing = (w as unknown as { standing: Map<string, { nest: WildNest | null; bodies: unknown[] }> }).standing;
  const site = [...standing.values()][0];
  ok(!!site && site.bodies.length > 0, `a site is standing with ${site?.bodies.length} of its own`);
  const had = LAIR_TUNE.liveBodies;
  const up = (): number => bodies.filter((b) => !b.removed && !b.dead).length;
  try {
    LAIR_TUNE.liveBodies = up();
    const nest = new WildNest('nest', 1000);
    site.nest = nest;
    nest.damage(10);
    const before = bodies.length;
    w.step(0.1, 10, at, deps);
    ok(!nest.wantsHelp && bodies.length === before && w.last.bodies <= LAIR_TUNE.liveBodies, `struck with the cap already reached (${LAIR_TUNE.liveBodies}), it sends nobody out`);
    LAIR_TUNE.liveBodies = up() + 50;
    nest.damage(10);
    w.step(0.1, 200, at, deps);
    ok(bodies.length > before, `and with room it sends ${bodies.length - before} out, which is what the cap held back`);
    const ids = new Set(bodies.map((b) => b.how.id));
    ok(ids.size === bodies.length, 'and a body sent out never takes the name of one already standing');
    site.nest = null;
  } finally {
    LAIR_TUNE.liveBodies = had;
  }
}

// ------------------------------------------------------------------ a nest broken and come back, in its place
{
  const n = new WildNest('nest', 500);
  n.damage(600);
  ok(n.dead && n.hp === 0, 'a nest takes a blow past its health and is broken');
  n.revive();
  ok(!n.dead && n.hp === n.maxHp && !n.wantsHelp, 'and comes back whole on its clock, the model where it stood rather than vanishing and building again');
  ok(nestHealth({ seed: 1, level: 3, lairLevel: 20 }) === nestHealth({ seed: 1, level: 3, lairLevel: 20 }), "its health is the server's condition for its site, the same in every browser");
}

// ------------------------------------------------------------------ the camps and nests, standing in a real physics world
/** A few turns of the event loop: long enough for a nest or a camp to build behind its people. */
const settle = async (n = 30): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
/** What the wild world keeps of a standing site, as these checks read it. */
interface Rec {
  camp: WildCamp | null;
  nest: WildNest | null;
  at: { x: number; z: number };
  bodies: Body[];
  site: LairSite;
  wait: number;
  brokeAt: number;
}
const recsOf = (x: WildLife): Rec[] => [...(x as unknown as { standing: Map<string, Rec> }).standing.values()];
{
  const physics = await Physics.create();
  const scene = new THREE.Scene();
  const forgotten: THREE.Material[] = [];
  const placed: { file: string; at: THREE.Vector3 }[] = [];
  const removed: unknown[] = [];
  const prepared: string[] = [];
  // What the world's preparing was handed, and whether that was in the scene yet; and what was marked.
  const preparing: { root: THREE.Object3D; parent: THREE.Object3D | null }[] = [];
  const marked: THREE.Object3D[] = [];
  const loadedGeometries: THREE.BufferGeometry[] = [];
  const geometriesGone = new Set<THREE.BufferGeometry>();
  // Every model a box of its own size, named by file, so a piece is known in the scene by its model.
  const sizes: Record<string, [number, number, number]> = { 'nests/tent.glb': [4, 2, 2], 'nests/stool.glb': [0.6, 0.3, 0.6], 'nests/pebbles.glb': [1, 0.3, 1], 'nests/mound.glb': [3, 2, 3] };
  const slope = (x: number, z: number): number => 0.25 * x + 2;
  const nestDeps: NestDeps = {
    scene,
    physics,
    outdoorGroups: () => 0xffffffff,
    forget: (mats) => forgotten.push(...mats),
    // As the world's own preparing does (`prepareActor`): every mesh casting, and none culled on its own.
    prepare: (root) => {
      preparing.push({ root, parent: root.parent });
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
      });
    },
    markActor: (o) => void marked.push(o),
    baseUrl: '',
    models: new NestModels(),
    loadModel: async (file) => {
      const s = sizes[file];
      if (!s) return null;
      const root = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial();
      // A stool that casts no shadow and a tent that draws after the water, as the converter marks a
      // glow and a translucent surface.
      if (file === 'nests/stool.glb') mat.userData.noShadow = true;
      if (file === 'nests/tent.glb') {
        mat.transparent = true;
        mat.userData.swg = { blend: 'alpha' };
      }
      const geometry = new THREE.BoxGeometry(s[0], s[1], s[2]).translate(0, s[1] / 2, 0);
      loadedGeometries.push(geometry);
      geometry.addEventListener('dispose', () => geometriesGone.add(geometry));
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.name = file;
      root.add(mesh);
      return root;
    },
    effects: {
      prepare: async (file) => {
        prepared.push(file);
        return true;
      },
      place: (file, matrix) => {
        const h = { file, at: new THREE.Vector3().setFromMatrixPosition(matrix) };
        placed.push(h);
        return h;
      },
      remove: (h) => removed.push(h),
    },
  };
  const campLair: LairDef = { kind: 'npc_theater', mobiles: [{ who: 'raider', n: 1 }, { who: 'chief', n: 1 }], boss: [], cap: 15, nest: 'object/building/poi/c.iff', building: 'theater', people: true };
  const nestLair: LairDef = { kind: 'creature_lair', mobiles: [{ who: 'thing', n: 1 }], boss: [], cap: 15, nest: 'object/tangible/lair/m.iff', building: '', people: false };
  const man: WildManifest = {
    format: 2,
    creatures: {
      raider: { id: 'raider_model', level: 20, hp: 300, hpMax: 300, damage: [10, 20], diet: 'none', kind: 'npc', aggressive: true, herd: false, pack: true, social: '' },
      chief: { id: 'chief_model', level: 25, hp: 400, hpMax: 400, damage: [10, 20], diet: 'none', kind: 'npc', aggressive: true, herd: false, pack: true, social: '' },
      thing: manifest.creatures.thing,
    },
    lairs: { C: campLair, N: nestLair },
    groups: { c: [{ lair: 'C', weight: 1, count: 15, size: 25, limit: -1, minDiff: 20, maxDiff: 30 }], n: [{ lair: 'N', weight: 1, count: 15, size: 25, limit: -1, minDiff: 20, maxDiff: 30 }] },
    nests: {
      'object/building/poi/c.iff': {
        id: 'pebbles',
        file: 'nests/pebbles.glb',
        effects: [
          // The Tusken war camp's own fire, eighteen metres out from its middle and over no piece.
          { file: 'particles/fx_campfire.json', transform: [1, 0, 0, 18.58, 0, 1, 0, 0, 0, 0, 1, 1.14] },
          // Smoke half a metre over the tent.
          { file: 'particles/fx_smoke.json', transform: [1, 0, 0, 6, 0, 1, 0, 0.5, 0, 0, 1, 0] },
        ],
      },
      'object/tangible/lair/m.iff': {
        id: 'mound',
        file: 'nests/mound.glb',
        effects: [
          // Fog half a metre over the mound, and flies five metres off it, a metre over the ground there.
          { file: 'particles/fx_fog.json', transform: [1, 0, 0, 0, 0, 1, 0, 0.5, 0, 0, 1, 0] },
          { file: 'particles/fx_flies.json', transform: [1, 0, 0, 5, 0, 1, 0, 1, 0, 0, 1, 0] },
        ],
      },
    },
    camps: {
      'object/building/poi/c.iff': [
        { model: 'nests/tent.glb', place: [6, 0, 0], angles: [30, 0, 0] },
        { model: 'nests/stool.glb', place: [-4, 0, 3], angles: [0, 0, 0] },
        { model: 'nests/stool.glb', place: [-4, 0.3, -3], angles: [0, 0, 0] },
      ],
    },
    campModels: {
      'nests/tent.glb': { bounds: { min: [-2, 0, -1], max: [2, 2, 1] } },
      'nests/stool.glb': { bounds: { min: [-0.3, 0, -0.3], max: [0.3, 0.3, 0.3] } },
    },
  };
  const campArea = pack([{ name: 'a', shape: 'circle', x: 0, z: 0, r: 120, groups: ['c'], cap: 64 }]);
  const nestArea = pack([{ name: 'a', shape: 'circle', x: 0, z: 0, r: 120, groups: ['n'], cap: 64 }]);
  const w = new WildLife();
  fine(() => w.adopt(campArea, man));
  const { deps, bodies } = game({ nest: nestDeps, groundAt: slope });
  const at = new THREE.Vector3(0, 0, 0);
  w.step(1, 1, at, deps);
  // The camp builds behind its people, a few awaits later.
  await settle();
  const camps = recsOf(w).filter((r) => r.camp);
  ok(camps.length > 0 && camps.every((r) => r.camp!.up), `${camps.length} camp(s) stood, every one of them built`);
  const first = camps[0];
  const root = first.camp!.root!;
  ok(root.parent === scene && first.camp!.pieces === 4, `a camp is its three pieces and the marker at its middle, in the scene (${first.camp!.pieces})`);

  // Prepared before it is shown, and dressed by the placed objects' own rules once it is.
  const mine = preparing.filter((p) => p.root === root);
  ok(mine.length === 1 && mine[0].parent === null, 'a camp is prepared once, while it is out of the scene, so nothing it wears compiles in front of anybody');
  ok(marked.includes(root), "and marked for the portal renderer's passes");
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  ok(meshes.length === 4 && meshes.every((m) => m.frustumCulled), 'once shown, its pieces are culled one by one, since a camp is not one actor');
  const named = (file: string) => meshes.filter((m) => m.name === file);
  ok(named('nests/stool.glb').length === 2 && named('nests/stool.glb').every((m) => !m.castShadow), 'a piece whose material casts no shadow on a placed object casts none here, whatever the preparing set');
  ok(named('nests/tent.glb').every((m) => m.castShadow && m.renderOrder === 3) && named('nests/pebbles.glb').every((m) => m.castShadow && m.renderOrder === 0), 'a translucent one casts and is drawn after the water, as the streamer draws it, and a plain one simply casts');

  // Every piece on its own ground: the lowest of its footprint on the slope, plus its own lift, exactly.
  root.updateMatrixWorld(true);
  const lifts = [0, 0, 0, 0.3];
  const pieceBoxes = root.children.map((piece) => new THREE.Box3().setFromObject(piece));
  let onGround = 0;
  root.children.forEach((piece, i) => {
    const box = pieceBoxes[i];
    const origin = new THREE.Vector3().setFromMatrixPosition(piece.matrixWorld);
    // On a slope in x alone, the lowest of a turned footprint's corners is the lowest of its box's.
    const lowest = Math.min(slope(origin.x, origin.z), ...[box.min.x, box.max.x].flatMap((x) => [box.min.z, box.max.z].map((z) => slope(x, z))));
    if (Math.abs(box.min.y - (lowest + lifts[i])) < 1e-3) onGround++;
  });
  ok(onGround === root.children.length, `every piece stands on its own ground on a slope, at the low side of its footprint plus its own lift (${onGround} of ${root.children.length}), with no flattening`);
  const liftedY = root.children.map((p) => p.position.y);
  ok(liftedY.some((y, i) => i > 0 && Math.abs(y - (liftedY[i - 1] ?? y)) > 0.01), 'and pieces on different ground stand at different heights');

  // Colliders: one a piece, fixed, where the piece is drawn, and nothing a bolt could hurt.
  const handles = first.camp!.handles;
  ok(handles.length === 4 && handles.every((h) => physics.world.getCollider(h)?.parent()?.isFixed()), `a camp's pieces are ${handles.length} fixed boxes a body stops against`);
  const colliderBoxes = handles.map((h) => {
    const c = physics.world.getCollider(h)!;
    const t = c.translation();
    const r = c.rotation();
    const e = c.halfExtents();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const b = new THREE.Box3();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) b.expandByPoint(new THREE.Vector3(sx * e.x, sy * e.y, sz * e.z).applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z)));
    return b;
  });
  const worst = Math.max(...colliderBoxes.map((b, i) => Math.max(b.min.distanceTo(pieceBoxes[i].min), b.max.distanceTo(pieceBoxes[i].max))));
  ok(worst < 0.01, `and each box stands where its piece is drawn, turned with it (${worst.toFixed(4)} m apart at worst)`);
  ok(handles.every((h) => w.nestAt(h) === undefined), 'and none of them is anything a bolt or a blade can hurt: nobody may attack a camp');
  ok(first.bodies.length >= 5, `its people stand at it (${first.bodies.length}), the server's third of fifteen`);
  const kinds = new Set(bodies.map((b) => b.entry));
  ok(kinds.size === 2, 'drawn body by body from its list, so raiders and chiefs stand together');
  const layoutClear = first.bodies.every((b) => pieceBoxes.every((box) => !(b.x > box.min.x && b.x < box.max.x && b.z > box.min.z && b.z < box.max.z)));
  ok(layoutClear, "and none stands inside a piece, so nobody is stood on a tent's roof");

  // What its client data hangs on it: prepared, placed, each on its own ground.
  ok(['particles/fx_campfire.json', 'particles/fx_smoke.json'].every((f) => prepared.includes(f) && placed.some((p) => p.file === f)), "a camp's fire and smoke are prepared, then placed as the world's own standing effects");
  const fire = placed.find((p) => p.file === 'particles/fx_campfire.json')!;
  ok(Math.abs(fire.at.x - (first.at.x - 18.58)) < 1e-6 && Math.abs(fire.at.z - (first.at.z + 1.14)) < 1e-6, 'a fire eighteen metres out stands on the other side of the middle in x from where the client data puts it, mirrored as every piece is');
  ok(Math.abs(fire.at.y - slope(fire.at.x, fire.at.z)) < 1e-6, `and on the ground under its own place, not the ground at the middle, which on this slope is ${(slope(first.at.x, first.at.z) - fire.at.y).toFixed(2)} m off it`);
  const smoke = placed.find((p) => p.file === 'particles/fx_smoke.json')!;
  const tent = root.children[1];
  ok(Math.abs(smoke.at.x - (first.at.x - 6)) < 1e-6 && Math.abs(smoke.at.y - (tent.position.y + 0.5)) < 1e-6, "and the smoke over the tent half a metre over the tent's own ground, as the client placed it over that piece");
  ok(pieceGround({ model: 'x', x: 0, z: 0, lift: 0, yaw: 0, cx: 0, cz: 0, radius: 0 }, { x: 10, z: 0 }, null, slope) === slope(10, 0), 'a piece with no box stands on the ground at its origin');
  const turned = effectMatrix([1, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0], Math.PI / 2, { x: 0, z: 0 }, () => 0);
  const turnedAt = new THREE.Vector3().setFromMatrixPosition(turned);
  ok(Math.abs(turnedAt.x) < 1e-9 && Math.abs(turnedAt.z - 2) < 1e-9, "and an effect turns with its camp about the middle, as the pieces do (`campLayout`'s own turn)");

  // A camp whose people all go comes back as it stands: the same pieces, never built twice.
  const pieceRoot = root;
  for (const b of first.bodies) b.dead = true;
  w.step(WILD_TUNE.everySeconds + 0.1, 50, at, deps);
  w.step(1, 50 + LAIR_TUNE.respawn[1] + 1, at, deps);
  w.step(WILD_TUNE.everySeconds + 0.1, 50 + LAIR_TUNE.respawn[1] + 5, at, deps);
  ok(first.camp!.root === pieceRoot && first.bodies.length >= 5, 'a camp emptied comes back on its clock with its people, its pieces never taken down and built again in view');

  // Put away: the pieces, the colliders, the materials and the fire all go.
  const campMats = new Set<THREE.Material>();
  for (const m of meshes) campMats.add(m.material as THREE.Material);
  const matsGone = new Set<THREE.Material>();
  for (const m of campMats) m.addEventListener('dispose', () => matsGone.add(m));
  const campFx = placed.filter((p) => p.file === 'particles/fx_campfire.json' || p.file === 'particles/fx_smoke.json');
  const colliders = physics.world.colliders.len();
  w.step(WILD_TUNE.everySeconds + 0.1, 800, new THREE.Vector3(20000, 0, 20000), deps);
  ok(pieceRoot.parent === null && physics.world.colliders.len() < colliders, 'walking away takes the camp down: its pieces out of the scene and its boxes out of the physics');
  ok([...campMats].every((m) => forgotten.includes(m) && matsGone.has(m)), `its ${campMats.size} materials given back to the world's sets and disposed`);
  ok(campFx.every((p) => removed.includes(p)), `and its ${campFx.length} effects put out`);

  // A nest's fog and flies, the same way.
  const nw = new WildLife();
  fine(() => nw.adopt(nestArea, man));
  nw.step(1, 1, at, deps);
  await settle();
  const nests = recsOf(nw).filter((r) => r.nest);
  ok(nests.length > 0 && nests.every((r) => r.nest!.up && r.nest!.effects === 2), "a nest stands with the fog and flies its client data hangs on it, as standing effects of the world's");
  const over = nests.every((r) => {
    const p = r.nest!.pos;
    const fog = placed.find((f) => f.file === 'particles/fx_fog.json' && Math.abs(f.at.x - p.x) < 1e-6 && Math.abs(f.at.z - p.z) < 1e-6);
    const flies = placed.find((f) => f.file === 'particles/fx_flies.json' && Math.abs(f.at.x - (p.x - 5)) < 1e-6 && Math.abs(f.at.z - p.z) < 1e-6);
    return !!fog && Math.abs(fog.at.y - (p.y + 0.5)) < 1e-6 && !!flies && Math.abs(flies.at.y - (slope(p.x - 5, p.z) + 1)) < 1e-6;
  });
  ok(over, "each one's fog over its mound at the mound's height, and its flies off it over the ground there, mirrored in x");
  ok(nests.every((r) => r.nest!.maxHp === nestHealth(r.site)), `and with the server's own condition for its site as its health (${nests.map((r) => r.nest!.maxHp).join(', ')})`);
  const hit = nests[0].nest!.handle!;
  ok(nw.nestAt(hit) === nests[0].nest, 'and it is found by its collider, which is how a bolt reaches one');
  const nestFx = placed.filter((p) => p.file === 'particles/fx_fog.json' || p.file === 'particles/fx_flies.json');
  const nestMats: THREE.Material[] = [];
  for (const r of nests) r.nest!.root!.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) nestMats.push((o as THREE.Mesh).material as THREE.Material);
  });
  const nestColliders = physics.world.colliders.len();
  nw.unload();
  ok(nests.every((r) => !r.nest!.up), 'a world unloaded takes every nest down with it');
  ok(physics.world.colliders.len() === nestColliders - nests.length, `its bodies out of the physics (${nests.length})`);
  ok(nestFx.every((p) => removed.includes(p)) && nestMats.every((m) => forgotten.includes(m)), 'and its effects put out and its materials given back');
  const kept = nestDeps.models!.stats();
  ok(kept.models === 0 && loadedGeometries.length >= 4 && loadedGeometries.every((g) => geometriesGone.has(g)), `and the ${loadedGeometries.length} models every nest and camp was cloned from go with the world, geometry and all (${kept.models} held)`);

  // ---------------------------------------------------------------- a broken nest back on its clock
  {
    const bw = new WildLife();
    fine(() => bw.adopt(nestArea, man));
    const g = game({ nest: nestDeps, groundAt: slope });
    bw.step(1, 1, at, g.deps);
    await settle();
    const rec = recsOf(bw).find((r) => r.nest?.up)!;
    const nest = rec.nest!;
    for (const b of rec.bodies) b.dead = true;
    nest.damage(1e9);
    bw.step(0.1, 10, at, g.deps);
    ok(nest.dead && rec.brokeAt === 10 && rec.bodies.length === 0, 'a nest whose guard is killed and which is knocked down is broken, and its clock starts');
    const base = nestHealth(rec.site);
    setDifficulty(0.5);
    try {
      bw.step(WILD_TUNE.everySeconds + 0.1, 10 + rec.wait + 1, at, g.deps);
      bw.step(WILD_TUNE.everySeconds + 0.1, 10 + rec.wait + 3, at, g.deps);
      ok(rec.nest === nest && nest.up && !nest.dead && nest.hp === nest.maxHp && rec.bodies.length > 0, 'once its clock is out it comes back the same nest in its place, whole, with its guard stood round it');
      ok(Math.abs(nest.maxHp - base * 0.5) < 1e-9, `at the difficulty in force when it comes back (${nest.maxHp} of its ${base} at a half)`);
    } finally {
      setDifficulty(1);
    }
    bw.unload();
  }

  // ---------------------------------------------------------------- a nest another browser has broken
  {
    // Stood by a browser that walks up while every other has the nest broken: it stands broken here too.
    const sw = new WildLife();
    fine(() => sw.adopt(nestArea, man));
    const shared: string[] = [];
    const g = game({ nest: nestDeps, groundAt: slope, shareNest: (n) => void shared.push(n.npcId), downFor: (id) => (id.startsWith('camp:') ? 60 : 0) });
    sw.step(1, 1, at, g.deps);
    await settle();
    const recs = recsOf(sw).filter((r) => r.nest);
    ok(recs.length > 0 && recs.every((r) => r.nest!.dead) && shared.length === recs.length && shared.every((id) => id.startsWith('camp:')), 'a nest every other browser has broken stands broken here, under its site\'s own name on the wire');
    sw.unload();
  }

  // ---------------------------------------------------------------- the nest broken after its last guard: one clock
  {
    // The site's own clock runs from its last body's death and the server holds the nest down from the
    // nest's own; broken after the guard, the nest's runs later, and reviving on the site's clock stood it
    // broken again for a whole cycle. The site waits out the later of the two.
    const cw = new WildLife();
    fine(() => cw.adopt(nestArea, man));
    let t = 1;
    const downs = new Map<string, number>();
    const g = game({ nest: nestDeps, groundAt: slope, shareNest: () => undefined, downFor: (id) => Math.max(0, (downs.get(id) ?? -Infinity) - t) });
    cw.step(1, t, at, g.deps);
    await settle();
    const rec = recsOf(cw).find((r) => r.nest?.up)!;
    const nest = rec.nest!;
    t = 10;
    for (const b of rec.bodies) {
      b.dead = true;
      downs.set(`wild:${b.how.id}`, t + rec.wait);
    }
    cw.step(0.1, t, at, g.deps);
    t = 20;
    nest.damage(1e9);
    downs.set(`camp:${rec.site.key}`, t + rec.wait);
    cw.step(0.1, t, at, g.deps);
    ok(nest.dead && rec.brokeAt === 10, 'its guard killed at 10 starts its clock, and the nest is knocked down at 20');
    for (const when of [10 + rec.wait + 1, 10 + rec.wait + 3]) {
      t = when;
      cw.step(WILD_TUNE.everySeconds + 0.1, t, at, g.deps);
    }
    ok(nest.dead && rec.bodies.length === 0, "when the site's own clock is out the nest's is not, and the site waits rather than reviving it broken");
    for (const when of [20 + rec.wait + 1, 20 + rec.wait + 3]) {
      t = when;
      cw.step(WILD_TUNE.everySeconds + 0.1, t, at, g.deps);
    }
    ok(!nest.dead && nest.up && rec.bodies.length > 0, 'and once the nest\'s is out too it comes back whole, guard and all');
    cw.unload();
  }

  // ---------------------------------------------------------------- a guard killed, then the nest struck
  {
    const fw = new WildLife();
    fine(() => fw.adopt(nestArea, man));
    const g = game({ nest: nestDeps, groundAt: slope });
    fw.step(1, 1, at, g.deps);
    await settle();
    const rec = recsOf(fw).find((r) => r.nest?.up)!;
    const had = LAIR_TUNE.liveBodies;
    LAIR_TUNE.liveBodies = 200;
    try {
      for (const b of rec.bodies) b.dead = true;
      fw.step(0.1, 10, at, g.deps);
      ok(rec.brokeAt === 10, 'its guard all killed, a site starts its clock');
      rec.nest!.damage(10);
      fw.step(0.1, 20, at, g.deps);
      const out = rec.bodies.length;
      ok(out > 0 && rec.brokeAt === 0 && !rec.nest!.dead, `struck while it still stands, the nest sends ${out} of its own out, and a site with somebody at it again is not broken`);
      fw.step(WILD_TUNE.everySeconds + 0.1, 10 + rec.wait + 5, at, g.deps);
      fw.step(WILD_TUNE.everySeconds + 0.1, 10 + rec.wait + 7, at, g.deps);
      ok(rec.bodies.length === out, `so the old clock running out stands no whole guard on top of them (${rec.bodies.length})`);
      const live = g.bodies.filter((b) => !b.dead && !b.removed);
      ok(new Set(live.map((b) => b.how.id)).size === live.length, 'and no two bodies standing share a name');
    } finally {
      LAIR_TUNE.liveBodies = had;
    }
    fw.unload();
  }

  // ---------------------------------------------------------------- put away while being prepared
  {
    // The world's preparing puts every material into its sets at once and then compiles a while. A
    // camp or a nest put away in that while must give every one of them back when it is over, and
    // must not dispose anything the compiling is still working on.
    const adopted = new Set<THREE.Material>();
    const gone = new Set<THREE.Material>();
    let open: () => void = () => undefined;
    const gated = (): NestDeps => {
      const gate = new Promise<void>((r) => (open = r));
      return {
        ...nestDeps,
        models: new NestModels(),
        forget: (mats) => {
          for (const m of mats) adopted.delete(m);
        },
        prepare: async (root) => {
          root.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const m = mesh.material as THREE.Material;
            adopted.add(m);
            m.addEventListener('dispose', () => gone.add(m));
          });
          await gate;
        },
      };
    };
    const tentPiece = { model: 'nests/tent.glb', x: 0, z: 0, lift: 0, yaw: 0, cx: 0, cz: 0, radius: 2.3 };
    const stoolPiece = { model: 'nests/stool.glb', x: 4, z: 0, lift: 0, yaw: 0, cx: 4, cz: 0, radius: 0.5 };
    const campDeps = gated();
    const camp = new WildCamp('c');
    const building = camp.build([tentPiece, stoolPiece], { x: 0, z: 0 }, 0, slope, campDeps);
    await settle();
    const inSets = adopted.size;
    camp.dispose();
    ok(inSets === 2 && adopted.size === 2 && gone.size === 0, 'a camp put away while it is being prepared leaves what is being compiled alone');
    open();
    ok(!(await building) && adopted.size === 0 && gone.size === 2, "and once the preparing is over gives every material back to the world's sets and disposes it");
    ok(campDeps.models!.stats().used === 0 && !camp.up, 'and lets go of its models, and never stands');

    const nestDeps2 = gated();
    const nest = new WildNest('n', 500);
    const nestBuilding = nest.build('nests/mound.glb', { x: 0, y: 2, z: 0 }, nestDeps2);
    await settle();
    nest.dispose();
    const held = adopted.size;
    open();
    ok(held === 1 && !(await nestBuilding) && adopted.size === 0 && gone.size === 3 && nestDeps2.models!.stats().used === 0, 'a nest the same');
  }
}

// ------------------------------------------------------------------ the models the nests and camps are cloned from
{
  const had = NEST_MODEL_TUNE.idleMegabytes;
  const models = new NestModels();
  const disposed = new Set<string>();
  let loads = 0;
  // A model of about 5.6 MB: one 1024-pixel texture with its mips, and a box.
  const make = (name: string): THREE.Object3D => {
    loads++;
    const texture = new THREE.Texture();
    texture.image = { width: 1024, height: 1024 };
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const geometry = new THREE.BoxGeometry();
    texture.addEventListener('dispose', () => disposed.add(`${name}:texture`));
    material.addEventListener('dispose', () => disposed.add(`${name}:material`));
    geometry.addEventListener('dispose', () => disposed.add(`${name}:geometry`));
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material));
    return root;
  };
  const whole = (name: string) => ['texture', 'material', 'geometry'].every((k) => disposed.has(`${name}:${k}`));
  try {
    const a = await models.take('a', async () => make('a'));
    const again = await models.take('a', async () => make('a'));
    ok(a === again && loads === 1, 'a model is fetched once and held by everything that takes it');
    models.release('a');
    ok(!whole('a') && models.stats().used === 1, 'and stays while anything still holds it');
    models.release('a');
    ok(!whole('a') && models.stats().idle === 1, `and a while after, idle, for the next camp of its kind (${models.stats().idleMegabytes} MB)`);
    NEST_MODEL_TUNE.idleMegabytes = 8;
    await models.take('b', async () => make('b'));
    models.release('b');
    ok(whole('a') && !whole('b'), 'past the idle budget the one let go longest ago goes, its geometry, textures and materials with it');
    const c = models.take('c', async () => make('c'));
    await c;
    models.clear();
    ok(whole('b') && !whole('c') && models.stats().used === 1, 'the world going throws away every model nothing holds, and none that something does');
    models.release('c');
    models.clear();
    ok(whole('c') && models.stats().models === 0, 'and that one too once it is let go');
    let land: (m: THREE.Object3D) => void = () => undefined;
    const late = models.take('d', () => new Promise<THREE.Object3D>((r) => (land = r)));
    models.release('d');
    models.clear();
    land(make('d'));
    ok((await late) === null && whole('d'), 'a model still loading when the world goes is disposed the moment it lands, and handed to nobody');

    // A cached model's own materials hold its detail map for it: otherwise the last camp put away
    // frees it and every camp cloned afterwards comes out with none.
    const detail = new THREE.Texture();
    const id = surfaces.registerDetail('wall', detail);
    const material = new THREE.MeshStandardMaterial();
    material.userData.swgDetail = id;
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    await models.take('e', async () => root);
    const clone = material.clone();
    surfaces.adopt(clone);
    surfaces.forget(clone);
    ok(surfaces.detailTexture(id) === detail, 'a detail map outlives the last camp that wore it while its model is cached');
    models.release('e');
    models.clear();
    ok(surfaces.detailTexture(id) === null, 'and goes with the model');
  } finally {
    NEST_MODEL_TUNE.idleMegabytes = had;
  }
}

// ------------------------------------------------------------------ homed on the middle, not on the spot
{
  // What this pins: a mobile's home is where it was stood, and the brain wanders it eight to thirty
  // metres from home every few seconds. A body stood five to fourteen metres out to begin with
  // therefore drifts to forty from the thing it is meant to be guarding, and walking to the lair
  // finds bare ground. Every body's home is the site's own middle instead.
  const world = readFileSync(new URL('../../../src/world/wildLife.ts', import.meta.url), 'utf8');
  ok(/m\.homeX = rec\.at\.x;/.test(world) && /m\.homeZ = rec\.at\.z;/.test(world), "every body's home is the site's middle, so it wanders about its nest rather than away from it");
  ok(/let middle = intoWorld\(site\.x, site\.z, centre\)/.test(world), "and that middle is the site's own place carried into the world (and onto walkable ground), not the body's");
  ok(!/m\.homeX = world\.x/.test(world), 'and never the spot it happened to be put down on, which is what sends a guard into the dunes');

  ok(/fromNest:/.test(world) && /fromEye:/.test(world), 'and the console says how far each body is from its nest and from the eye, so "never stood", "taken away" and "right behind you" are three different readings');

  // **No height is passed to the manager**, which works one out itself that knows about whatever is
  // built on that spot. The nest's and the camp's own ground lookup is a different thing and is
  // allowed: they are placed by this code, while a creature is placed by the manager.
  const spawns = world.match(/deps\.spawn\(entry, \{[^}]*\}/g) ?? [];
  ok(spawns.length >= 1, `the one place that stands a creature was found (${spawns.length})`);
  ok(spawns.every((s) => !/\by:/.test(s)), "no height is handed to the manager: its own answer knows what is standing on that ground and the terrain's does not");
  ok(spawns.every((s) => /x: world\.x, z: world\.z, heading:/.test(s)), 'so a body is placed by its two ground numbers and its facing alone');

  ok(/if \(m\.dead && !m\.removed\) rec\.killed\+\+/.test(world), 'a kill is only counted while the body is still there, since disposing one marks it dead too');
}

// ------------------------------------------------------------------ the origin the manager reads
{
  // `ambient` is the planet's own recyclable wildlife and the manager owns where those stand: past
  // its range it moves each one to a fresh spot near the player. A lair's creatures belong at their
  // lair, so they must be stood as `spawned`, and the `worldId` is what keeps the hand-spawn cap off
  // them. This is two files apart from the rule it serves, so it is read as text.
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  const call = (world.match(/spawn: \(entry, at, how\) =>[\s\S]*?\?\? 'no world'/g) ?? []).find((s) => /wild:/.test(s)) ?? '';
  ok(/origin: 'spawned'/.test(call), 'the wild world stands its creatures as spawned, so the manager leaves them where their lair is');
  ok(/worldId: `wild:\$\{how\.id\}`/.test(call), 'and names them for the world by their own site and count, which is what keeps the hand-spawn cap and the NPC tab off them');
  ok(!/origin: 'ambient'/.test(call) && !/share:/.test(call), 'and never as ambient, and never shared with a server that has never heard of them');
  ok(/overrides: how\.overrides/.test(call) && /weapons: how\.weapons/.test(call), "and with their own creature's numbers and weapons");
  ok(/weaponGroups: how\.weaponGroups/.test(call), 'and the groups those weapons name, without which a group name arms nobody and every body falls back on a guess');

  // A nest's fog and a camp's fire are the spawns pack's files, and the world's effects resolve every
  // file against the world's own pack: each is re-rooted from one to the other, for loading and placing.
  const fx = world.match(/effects: \{[\s\S]*?prepare: async \(file\) => \{[\s\S]*?remove: \(h\) =>/)?.[0] ?? '';
  ok(/fx\.prepare\(this\.spawnsEffect\(file\)/.test(fx) && /place\(this\.spawnsEffect\(file\), matrix, false\)/.test(fx), "a nest's effects are prepared and placed under their re-rooted name, and placed standing");
  ok(/private spawnsEffect\(file: string\): string \{[\s\S]*?return relativeRoot\(root, `\$\{import\.meta\.env\.BASE_URL\}assets-private\/spawns\/`\) \+ file;/.test(world), "re-rooted from the world's own pack onto the spawns pack");
  ok(relativeRoot('/assets-private/tatooine/', '/assets-private/spawns/') + 'particles/fx_fog.json' === '../spawns/particles/fx_fog.json', "which for a world's pack is one folder up and into the spawns pack");
  ok(/groundReady: \(x, z, reach\) => this\.terrain\.prepareArea\(x - reach, z - reach, 2 \* reach\)/.test(world), 'and the ground a site stands on is asked of the terrain worker, never generated on the main thread to answer');
}

// ------------------------------------------------------------------ the nest, struck and broken
{
  const nest: LairDef = { kind: 'creature_lair', mobiles: [{ who: 'thing', n: 1 }], boss: [], cap: 8, nest: 'n.iff', building: '', people: false };
  ok(reinforcements(nest, 4, 0) === 0, 'struck twice in a moment it sends nobody the second time: it has a clock');
  ok(reinforcements(nest, 4, 99) > 0, 'once the clock is out it sends more');
  ok(reinforcements(nest, 8, 99) === 0, "and never past the ceiling the server's own data puts on that nest");

  const src = readFileSync(new URL('../../../src/world/wildLife.ts', import.meta.url), 'utf8');
  ok(/if \(nest\.dead\) continue;/.test(src), 'a broken nest never sends anything out again, which is what killing it is for');
  ok(/rec\.nest\?\.dispose\(\)/.test(src) && /rec\.camp\?\.dispose\(\)/.test(src), 'a site put away takes its nest or its camp down with it');
  ok(/for \(const rec of this\.standing\.values\(\)\) \{\s*rec\.nest\?\.dispose\(\);\s*rec\.camp\?\.dispose\(\);/.test(src), 'and clearing the whole world disposes every one of them, materials and body and all');
  const nestSrc = readFileSync(new URL('../../../src/world/wildNest.ts', import.meta.url), 'utf8');
  ok(/deps\.forget\(owned\);\s*for \(const m of owned\) m\.dispose\(\);/.test(nestSrc), "a nest's and a camp's materials are given back before they are thrown away, or the portal renderer's set grows with every one that ever stood");
  ok((nestSrc.match(/if \(this\.disposed\) giveBack\(this\.owned, this\.held, deps\);/g) ?? []).length === 2 && (nestSrc.match(/if \(!this\.busy && deps\) giveBack\(this\.owned, this\.held, deps\);/g) ?? []).length === 2, 'by both, whether they are put away standing or while they are still being built');
  ok(/model\.clone\(true\)/.test(nestSrc), 'and its models are clones, so nothing here ever disposes the geometry the cache holds');
  ok(/surfaces\.withPlugin\(new GLTFLoader\(\)\)/.test(nestSrc) && !/new GLTFLoader\(\)\.load/.test(nestSrc), 'and read through the surfaces plugin, as every converted static model is, so a detail map or an additive screen is what the converter wrote');

  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  ok(/wildLife\.nearest\(at, centre, 50\)\.find\(\(x\) => x\.open\)/.test(main), "the console's `go` passes by a site that can never stand");
}

// ------------------------------------------------------------------ a real world, where converted
{
  const manFile = join('assets-private', 'spawns', 'manifest.json');
  const packFile = join('assets-private', 'tatooine', 'spawns.json');
  if (!existsSync(manFile) || !existsSync(packFile)) {
    note('no converted packs here, so the rules above stand on their own');
  } else {
    const man = JSON.parse(readFileSync(manFile, 'utf8')) as WildManifest;
    const real = JSON.parse(readFileSync(packFile, 'utf8')) as WildPack;
    const w = new WildLife();
    w.adopt(real, man);
    note(`a real world lays ${w.last.sites} sites over ${real.areas.length} areas`);
    ok(w.last.sites > 1000, 'which is a planet with things living on it');
    const cover = w.coverageReport();
    note(`${(cover.share * 100).toFixed(1)}% of it within ${cover.reach} m of a site: ${cover.nests} nests, ${cover.camps} camps, ${cover.herds} herds`);

    const { deps, bodies } = game();
    let mostUp = 0;
    let mostBodies = 0;
    let camps = 0;
    const at = new THREE.Vector3(0, 0, 0);
    for (let step = 0; step < 240; step++) {
      at.set(-6000 + step * 50, 0, -2000 + step * 20);
      w.step(WILD_TUNE.everySeconds + 0.1, step * 2, at, deps);
      mostUp = Math.max(mostUp, w.last.up);
      mostBodies = Math.max(mostBodies, w.last.bodies);
      camps = Math.max(camps, w.report(at, real ? { x: 0, z: 0 } : null).filter((r) => r.camp !== false).length);
    }
    const alive = bodies.filter((b) => !b.removed).length;
    note(`walking twelve kilometres stood ${bodies.length} bodies in all, ${alive} of them still up, at most ${mostBodies} at once over ${mostUp} sites, ${camps} of them camps at once`);
    ok(mostUp <= LAIR_TUNE.liveLairs, `never more than ${LAIR_TUNE.liveLairs} sites at once over the whole walk`);
    ok(mostBodies <= LAIR_TUNE.liveBodies, `and never more than ${LAIR_TUNE.liveBodies} bodies (${mostBodies}), which is what a wild world costs`);
    ok(alive <= mostBodies, 'and nothing is left standing behind: every site walked away from is put down');
    ok(bodies.length > 200, `and a walk across the desert meets things most of the way (${bodies.length} stood)`);
  }
}

console.log(`\n${passed} checks passed`);
