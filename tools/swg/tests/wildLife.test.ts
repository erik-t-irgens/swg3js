// The wild world running: standing lairs as the player comes near, putting them away behind, and
// bringing a broken one back on its own clock.
//
// It is driven headless with a made-up game underneath it, which is what the narrow `WildDeps` is
// for. Where the real packs are converted it then lays a real world out and stands it, which is the
// only way to know the numbers tuned on a fixture do something sensible over a real planet.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { WildLife, WILD_TUNE, intoWorld, type WildDeps, type WildManifest, type WildPack } from '../../../src/world/wildLife.ts';
import { LAIR_TUNE } from '../../../src/world/mobiles/lairs.ts';

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
}

/** A game that is entirely made up, so the rules are what is being measured. */
function game(over: Partial<WildDeps> = {}): { deps: WildDeps; bodies: Body[]; centre: { x: number; z: number } } {
  const bodies: Body[] = [];
  const centre = { x: 0, z: 0 };
  const deps: WildDeps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
    spawn: (entry, at) => {
      const b: Body = { dead: false, removed: false, x: at.x, z: at.z, heading: at.heading ?? 0, entry: (entry as { id: string }).id };
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
 * Eight small areas clustered about the origin, so every site they lay is within reach of a player
 * standing there.
 *
 * One big area will not do, and the reason is worth writing down: a site is drawn anywhere inside
 * its shape, so over a three-kilometre circle the odds of one landing within the two hundred metres
 * a site is stood at are about one in a thousand. A test that stands a player at the middle of such
 * an area and expects a lair is testing the weather.
 */
const nearAreas = Array.from({ length: 8 }, (_, i) => ({
  name: `a${i}`,
  shape: 'circle' as const,
  x: Math.cos((i / 8) * Math.PI * 2) * 70,
  z: Math.sin((i / 8) * Math.PI * 2) * 70,
  r: 60,
  groups: ['g'],
  cap: 64,
}));
const bigArea = { name: 'a', shape: 'circle' as const, x: 0, z: 0, r: 3000, groups: ['g'], cap: 64 };

// ------------------------------------------------------------------ laying the world out
{
  const w = new WildLife();
  ok(!w.ready, 'a wild world with no pack is not ready and does nothing at all');
  w.adopt(pack([bigArea]), manifest);
  ok(w.ready && w.last.sites > 5, `a pack lays ${w.last.sites} sites`);

  // A place the server said nothing may stand in is not a place.
  const blocked = new WildLife();
  blocked.adopt(pack([bigArea], [{ name: 'town', shape: 'circle', x: 0, z: 0, r: 9000, groups: [], cap: 0 }]), manifest);
  ok(blocked.last.sites === 0, 'and a site inside a no-spawn area is never laid, which is what keeps a lair out of a town');

  // A pack in a format nobody knows is refused rather than half-read.
  const old = new WildLife();
  old.adopt({ ...pack([bigArea]), format: 99 }, manifest);
  ok(!old.ready, 'a pack in a format this build does not know is refused outright');
}

// ------------------------------------------------------------------ standing and putting away
{
  const w = new WildLife();
  w.adopt(pack(nearAreas), manifest);
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

  // Walking away puts them down.
  const away = new THREE.Vector3(20000, 0, 20000);
  w.step(WILD_TUNE.everySeconds + 0.1, 20, away, deps);
  ok(w.last.up === 0, 'walking off the edge of the world puts every one of them away');
  ok(bodies.every((b) => b.removed), 'and every body it stood is really taken down, not merely forgotten');
}

// ------------------------------------------------------------------ the mirror, which decides which side of the world they are on
{
  ok(intoWorld(100, 50, { x: 0, z: 0 }).x === -100, "a point in the pack's frame has its x negated, exactly as every placed object does");
  ok(intoWorld(100, 50, { x: 0, z: 0 }).z === 50, 'and its z carried through');
  ok(intoWorld(100, 50, { x: 40, z: 10 }).x === -60 && intoWorld(100, 50, { x: 40, z: 10 }).z === 40, "and the layout's own centre taken off both");

  // End to end: a site laid at a known spot stands its bodies about the mirrored place.
  const w = new WildLife();
  w.adopt(pack([{ name: 'a', shape: 'circle', x: 1000, z: 500, r: 1, groups: ['g'], cap: 64 }]), manifest);
  const { deps, bodies } = game();
  // The player must be *at* that place in the world's frame for the site to be in range.
  const world = intoWorld(1000, 500, { x: 0, z: 0 });
  w.step(1, 1, new THREE.Vector3(world.x, 0, world.z), deps);
  ok(bodies.length > 0, 'a site one metre across still stands its lair');
  const off = Math.max(...bodies.map((b) => Math.hypot(b.x - world.x, b.z - world.z)));
  ok(off < LAIR_TUNE.guardSpread + 2, `and every body stands within ${off.toFixed(1)} m of the mirrored place, not the unmirrored one`);
  const unmirrored = Math.min(...bodies.map((b) => Math.hypot(b.x - 1000, b.z - 500)));
  ok(unmirrored > 100, 'which is nowhere near where the pack says, because the pack speaks the snapshot and the world does not');
}

// ------------------------------------------------------------------ the world holding still
{
  const w = new WildLife();
  w.adopt(pack(nearAreas), manifest);
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
  const w = new WildLife();
  w.adopt(pack(nearAreas), manifest);
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

  // Not yet.
  w.step(1, 100 + LAIR_TUNE.respawn[0] - 10, at, deps);
  ok(w.last.up === up, 'and still there a moment before its clock is out');

  // Now.
  const madeBefore = bodies.length;
  w.step(1, 100 + LAIR_TUNE.respawn[1] + 1, at, deps);
  w.step(WILD_TUNE.everySeconds + 0.1, 100 + LAIR_TUNE.respawn[1] + 5, at, deps);
  ok(bodies.length > madeBefore, 'once the clock is out the same seed stands the same animals in the same places again');
}

// ------------------------------------------------------------------ killed is not the same as gone
{
  // The bug this pins: a site whose creatures the game took away for its own reasons -- it swept
  // them, they fell out of the world, a travel disposed them -- was marked broken and sat empty for
  // five to ten minutes. Only a lair somebody really cleared should do that.
  const w = new WildLife();
  w.adopt(pack(nearAreas), manifest);
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 4; i++) w.step(WILD_TUNE.everySeconds + 0.1, i * 2, at, deps);
  ok(w.last.up > 0, `${w.last.up} sites standing`);

  // **Taken away sets `dead` as well as `removed`**, which is the trap: disposing a mobile marks it
  // dead (`mobile.ts:2077`), so a test that only sets `removed` would pass while the real thing
  // failed. What tells a kill from a disposal is the corpse -- a creature that really died is dead
  // and still in the world for its death clip; one taken away is dead and gone in the same instant.
  for (const b of bodies) {
    b.dead = true;
    b.removed = true;
  }
  w.step(WILD_TUNE.everySeconds + 0.1, 20, at, deps);
  ok(w.last.up === 0, 'a site whose creatures were taken away rather than killed is forgotten, not broken');
  const had = bodies.length;
  w.step(WILD_TUNE.everySeconds + 0.1, 22, at, deps);
  ok(bodies.length > had, 'so it stands again on the very next pass instead of waiting out a respawn it never earned');

  // Killed is the other thing, and that one does wait. A corpse is dead and still there.
  for (const b of bodies) if (!b.removed) b.dead = true;
  w.step(WILD_TUNE.everySeconds + 0.1, 30, at, deps);
  const after = bodies.length;
  w.step(WILD_TUNE.everySeconds + 0.1, 32, at, deps);
  ok(bodies.length === after, 'while a lair that was really cleared stays cleared until its own clock is out');
}

// ------------------------------------------------------------------ homed on the nest, not on the spot
{
  // What this pins: a mobile's home is where it was stood, and the brain wanders it eight to thirty
  // metres from home every few seconds. A body stood five to fourteen metres out to begin with
  // therefore drifts to forty from the thing it is meant to be guarding, and walking to the lair
  // finds bare ground. Every body's home is the site's own middle instead.
  const world = readFileSync(new URL('../../../src/world/wildLife.ts', import.meta.url), 'utf8');
  ok(/m\.homeX = middle\.x;/.test(world) && /m\.homeZ = middle\.z;/.test(world), "every body's home is the site's middle, so it wanders about its nest rather than away from it");
  ok(/const middle = intoWorld\(site\.x, site\.z, centre\)/.test(world), "and that middle is the site's own place carried into the world, not the body's");
  ok(!/m\.homeX = world\.x/.test(world), 'and never the spot it happened to be put down on, which is what sends a guard into the dunes');

  // The report has to be able to tell the three endings apart, which is what the count alone could not.
  ok(/fromNest:/.test(world) && /fromEye:/.test(world), 'and the console says how far each body is from its nest and from the eye, so "never stood", "taken away" and "right behind you" are three different readings');

  // **No height is passed to the manager**, which works one out itself that knows about whatever is
  // built on that spot. Handing it the raw terrain height puts a body under the floor of a camp's
  // own hut, where the physics ejects it out of the world and the manager takes it away as spent --
  // which from outside is a lair that stood and then vanished.
  ok(!/y: deps\.groundAt/.test(world), "no height is handed to the manager: its own answer knows about what is standing on that ground and the terrain's does not");
  ok(/deps\.spawn\(entry, \{ x: world\.x, z: world\.z, heading:/.test(world), 'so a body is placed by its two ground numbers and its facing alone');

  // And the kill test must not be `dead` alone, or a disposal reads as a fight.
  ok(/if \(m\.dead && !m\.removed\) rec\.killed\+\+/.test(world), 'a kill is only counted while the body is still there, since disposing one marks it dead too');
}

// ------------------------------------------------------------------ the origin the manager reads
{
  // `ambient` is the planet's own recyclable wildlife and the manager owns where those stand: past
  // its range it moves each one to a fresh spot near the player. A lair's creatures belong at their
  // lair, so they must be stood as `spawned`, and the `worldId` is what keeps the hand-spawn cap off
  // them. This is two files apart from the rule it serves, so it is read as text.
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  const line = /spawn: \(entry, at, seed\) =>[^\n]*/.exec(world)?.[0] ?? '';
  ok(/origin: 'spawned'/.test(line), "the wild world stands its creatures as spawned, so the manager leaves them where their lair is");
  ok(/worldId: `wild:/.test(line), 'and names them for the world, which is what keeps the hand-spawn cap and the NPC tab off them');
  ok(!/origin: 'ambient'/.test(line), "and never as ambient, which would have the manager teleport each one to a fresh spot near the player");
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
    ok(w.last.sites > 100, 'which is a planet with things living on it');

    // Walk a real line across the world and count what it costs.
    const { deps, bodies } = game();
    let mostUp = 0;
    let mostBodies = 0;
    const at = new THREE.Vector3(0, 0, 0);
    for (let step = 0; step < 240; step++) {
      at.set(-6000 + step * 50, 0, -2000 + step * 20);
      w.step(WILD_TUNE.everySeconds + 0.1, step * 2, at, deps);
      mostUp = Math.max(mostUp, w.last.up);
      mostBodies = Math.max(mostBodies, w.last.bodies);
    }
    const alive = bodies.filter((b) => !b.removed).length;
    note(`walking twelve kilometres stood ${bodies.length} bodies in all, ${alive} of them still up, at most ${mostBodies} at once over ${mostUp} sites`);
    ok(mostUp <= LAIR_TUNE.liveLairs, `never more than ${LAIR_TUNE.liveLairs} sites at once over the whole walk`);
    ok(mostBodies <= LAIR_TUNE.liveLairs * LAIR_TUNE.guards[1] + 2, `and never more than ${mostBodies} bodies, which is what a wild world costs`);
    ok(alive <= mostBodies, 'and nothing is left standing behind: every site walked away from is put down');
  }
}

console.log(`\n${passed} checks passed`);
