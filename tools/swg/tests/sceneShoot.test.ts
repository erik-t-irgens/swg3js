// The backdrop shoot's plan: what it will visit, in what order, and what it will write.
//
// The pass itself needs a browser, a GPU and minutes of travelling, so what is pinned here is
// everything that can be got wrong *before* any of that: that a world is visited once rather than
// once per shot, that every world a capture names is one the game can actually travel to, and that
// no two pictures are written to the same place.
import assert from 'node:assert/strict';
import { packPlanet, sceneManifest, shootCount, shootPlan } from '../../../src/world/sceneShoot.ts';
import { backdropRenderFor } from '../../../src/world/sceneBackdrop.ts';
import { sceneSpots, SCENE_SHOTS } from '../../../src/data/scenes.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const plan = shootPlan();
const counted = shootCount(plan);

{
  ok(counted.pictures === SCENE_SHOTS.length, `the plan makes one picture per capture (${counted.pictures})`);
  ok(counted.shots === sceneSpots().length, `over every composition (${counted.shots})`);
  ok(counted.worlds === 12, `visiting twelve worlds (${counted.worlds})`);
  ok(plan.length === new Set(plan.map((g) => g.pack)).size, 'and each world appears once in the plan, which is the whole reason it is grouped: the eleven captures on one world must cost one load, not eleven');
}

{
  // Travelling. A world a capture names but the game cannot reach would fail minutes into a pass,
  // after everything before it had already been rendered.
  const lost = plan.map((g) => g.pack).filter((p) => !packPlanet(p));
  ok(lost.length === 0, `every world a capture names is one the game can travel to (${lost.join(', ') || 'all twelve resolve'})`);
  const kash = packPlanet('kashyyyk_main');
  ok(kash !== null && kash.planet !== 'kashyyyk_main' && !!kash.zone, `a many-zoned world resolves to its planet and its zone rather than to its own pack name (${JSON.stringify(kash)})`);
  const plain = packPlanet('tatooine');
  ok(plain !== null && plain.planet === 'tatooine' && plain.zone === undefined, 'and a world with one zone is simply itself');
  ok(packPlanet('not_a_world') === null, 'a pack no world carries answers null rather than a half-filled trip');
}

{
  // Filtering, which is what the owner uses to re-take one shot they did not like.
  const one = shootPlan(['tyrena']);
  ok(one.length === 1 && one[0].pack === 'corellia' && one[0].spots.length === 1, 'asking for one shot by its key visits one world and renders that shot alone');
  const world = shootPlan(['corellia']);
  ok(world.length === 1 && world[0].spots.length === 2, 'and asking for a world renders both of its compositions');
  ok(shootCount(shootPlan(['tyrena'])).pictures === 6, "one shot's own hours and no others (6)");
  ok(shootPlan(['nothing-by-that-name']).length === 0, 'a name nothing answers to plans nothing rather than everything');
}

{
  // Where the pictures go. Two written to one path would silently lose one of them.
  const paths = new Set<string>();
  let n = 0;
  for (const g of plan) for (const s of g.spots) for (const step of s.steps) { paths.add(step.path); n++; }
  ok(paths.size === n, `every picture has a place of its own (${paths.size} of ${n})`);
  ok([...paths].every((p) => !p.includes('..') && !p.startsWith('/')), 'and none of them climbs out of the scenes folder, which is the only place the dev server will write');
}

{
  // The manifest the screens read.
  const render = backdropRenderFor(62, 3, 1440);
  const man = sceneManifest(plan, render);
  ok(man.version === 1 && man.render.width === 4320 && man.render.height === 1440, `the manifest records the size the pictures were really rendered at (${man.render.width} by ${man.render.height})`);
  ok(man.shots.length === counted.shots, 'with a row per composition');
  ok(man.shots.every((s) => s.hours.length > 0 && s.camera && s.stand), 'each carrying its camera, its standing spot and at least one hour');
  ok(man.shots.filter((s) => s.ship).length === 1, 'and exactly one of them a parked ship, which is all the owner captured');
  const labels = man.shots.flatMap((s) => s.hours.map((h) => h.label));
  ok(labels.every((l) => l.length > 0), 'every hour has a word on its button');
  const theed = man.shots.find((s) => s.key === 'theed-overlook');
  ok(!!theed && new Set(theed.hours.map((h) => h.label)).size === theed.hours.length, `and a shot's hours read differently from one another (${theed?.hours.map((h) => h.label).join(', ')})`);
}

console.log(`\n${passed} checks passed`);
