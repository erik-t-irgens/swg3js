// The plants shown only as near the eye as the client drew them (src/world/floraReach.ts, step 5 of the
// frame-time wave): the reach as shipped and as the console moves it, the reach worked out from every
// converted world's own terrain file, the hysteresis on a distance walked back and forth across the line, the
// sweep itself driven over stand-in chunks (its clock, the eye it measures from, the trees left alone, the
// ground-plane reading, a sweep that hides nothing), each chunk's flora planted as trees and plants apart
// (src/world/flora.ts, over a stub terrain), and the world's wiring of it read as text.
//
// The terrain files are read from the owner's converted packs and nothing of them is written anywhere; a
// world whose pack is not converted is skipped, and the check that needs one says so.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { applyReachOption, clientPlantDistance, FLORA_DEFAULTS, FLORA_TUNE, instancesUnder, plantReachOf, PlantSweep, shownAt, type FloraChunk, type FloraGroupLike, type FloraReachTune } from '../../../src/world/floraReach.ts';
import { parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { FloraPlanter } from '../../../src/world/flora.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ROOT = new URL('../../../assets-private/', import.meta.url);

{
  // The reach as shipped, and what is put back.
  ok(FLORA_TUNE.on === true && FLORA_TUNE.plantReachFactor === 2 && FLORA_TUNE.plantReachMin === 64 && FLORA_TUNE.fixedReach === 0 && FLORA_TUNE.treeReach === Number.POSITIVE_INFINITY && FLORA_TUNE.hysteresis === 8 && FLORA_TUNE.sweepHz === 4 && FLORA_TUNE.planar === false, 'the reach ships on: twice the file\'s distance, 64 m at least, no reach in metres, trees untouched, 8 m of band, four sweeps a second, measured from the eye');
  ok(Object.keys(FLORA_DEFAULTS).every((k) => FLORA_TUNE[k as keyof FloraReachTune] === FLORA_DEFAULTS[k as keyof FloraReachTune]) && Object.isFrozen(FLORA_DEFAULTS), 'and the tune in force is the frozen defaults, field for field');
}

const tune: FloraReachTune = { ...FLORA_DEFAULTS };

{
  // The reach over every converted world's own terrain file.
  const dir = fileURLToPath(ROOT);
  const rows: { planet: string; client: number; reach: number }[] = [];
  if (existsSync(dir)) {
    for (const planet of readdirSync(dir)) {
      const f = join(dir, planet, 'terrain.trn');
      if (!existsSync(f)) continue;
      let t: ReturnType<typeof parseTerrainTemplate>;
      try {
        t = parseTerrainTemplate(new Uint8Array(readFileSync(f)));
      } catch {
        continue;
      }
      rows.push({ planet, client: clientPlantDistance(t), reach: plantReachOf(t, tune) });
    }
  }
  if (!rows.length) console.log('skip  no converted terrain files: the real-world reach checks need a pack');
  else {
    for (const r of rows) console.log(`      ${r.planet.padEnd(26)} client ${String(r.client).padStart(4)} m  reach ${r.reach} m`);
    ok(rows.every((r) => r.reach === Math.max(64, 2 * r.client)), `every converted world's reach is the larger of 64 m and twice its terrain file's own plant distance (${rows.length} worlds)`);
    ok(rows.every((r) => r.reach >= 64 && r.reach <= 2 * 256), "and none is under the floor or past twice the widest distance any retail file gives (256 m)");
    for (const name of ['tatooine', 'naboo', 'corellia']) {
      const r = rows.find((x) => x.planet === name);
      if (!r) continue;
      ok(r.client === 50 && r.reach === 100, `${name}: the client drew its plants to 50 m, so they stand to 100 m`);
    }
  }
  ok(plantReachOf(null, tune) === 64 && plantReachOf({ flora: { nonCollidable: { maximumDistance: 0 } } }, tune) === 64 && plantReachOf({ flora: { nonCollidable: { maximumDistance: Number.NaN } } }, tune) === 64, 'a template with no distance of its own takes the floor');
  ok(plantReachOf({ flora: { nonCollidable: { maximumDistance: 150 } } }, tune) === 300 && plantReachOf({ flora: { nonCollidable: { maximumDistance: 150 } } }, { ...tune, plantReachFactor: 0, plantReachMin: 80 }) === 80, 'the factor and the floor both move it');
  ok(plantReachOf({ flora: { nonCollidable: { maximumDistance: 150 } } }, { ...tune, fixedReach: 40 }) === 40 && plantReachOf(null, { ...tune, fixedReach: Number.NaN }) === 64, 'a reach typed in metres stands in place of the rule, and a broken one is no reach');
}

{
  // What the console may say (`__debug.flora({ reach })`).
  const t: FloraReachTune = { ...FLORA_DEFAULTS };
  ok(applyReachOption(t, 150) === true && t.fixedReach === 150 && t.plantReachFactor === 2 && t.plantReachMin === 64, 'a number is the reach in metres, and moves neither the factor nor the floor');
  ok(plantReachOf({ flora: { nonCollidable: { maximumDistance: 50 } } }, t) === 150, 'so the reach is that number');
  applyReachOption(t, { plantReachFactor: 3, hysteresis: 16, planar: true, treeReach: 400 });
  ok(t.plantReachFactor === 3 && t.hysteresis === 16 && t.planar === true && t.treeReach === 400 && t.fixedReach === 150, 'an object moves any of the fields it names and no other');
  ok(applyReachOption(t, false) === false && t.on === false && t.fixedReach === 150, '`false` shows every plant and keeps the numbers');
  ok(applyReachOption(t, true) === true && Object.keys(FLORA_DEFAULTS).every((k) => t[k as keyof FloraReachTune] === FLORA_DEFAULTS[k as keyof FloraReachTune]), '`true` puts the reach back exactly as shipped: a reach typed in metres and every number moved let go of');
  ok(plantReachOf({ flora: { nonCollidable: { maximumDistance: 50 } } }, t) === 100, 'so the reach is twice the client\'s own distance again, not the number typed before');
  applyReachOption(t, -5);
  applyReachOption(t, Number.NaN);
  applyReachOption(t, { hysteresis: -1, sweepHz: Number.NaN });
  ok(t.fixedReach === 0 && t.hysteresis === 8 && t.sweepHz === 4 && t.on === true, 'a value that is not a usable number is ignored');
}

{
  // Hysteresis: on inside the reach, off only past the reach and the band.
  const reach = 100;
  const band = 8;
  ok(shownAt(100, reach, band, false) && !shownAt(100.01, reach, band, false), 'hidden, a group comes on only once within the reach');
  ok(shownAt(108, reach, band, true) && !shownAt(108.01, reach, band, true), 'shown, it goes off only past the reach and the band');
  // Walk a distance back and forth across the line in small steps and count the flips.
  let shown = false;
  let flips = 0;
  const walk = (from: number, to: number, step: number) => {
    for (let d = from; step > 0 ? d <= to : d >= to; d += step) {
      const v = shownAt(d, reach, band, shown);
      if (v !== shown) flips++;
      shown = v;
    }
  };
  walk(140, 60, -0.5);
  ok(shown && flips === 1, 'walking in from 140 m to 60 m it comes on once');
  flips = 0;
  for (let i = 0; i < 20; i++) {
    walk(99, 107, 0.25);
    walk(107, 99, -0.25);
  }
  ok(shown && flips === 0, 'dithering back and forth across the line, inside the band, changes nothing (forty crossings)');
  walk(99, 120, 0.5);
  ok(!shown && flips === 1, 'out past the band it goes off once');
  flips = 0;
  for (let i = 0; i < 20; i++) {
    walk(101, 107, 0.25);
    walk(107, 101, -0.25);
  }
  ok(!shown && flips === 0, 'and dithering in the band from outside does not bring it back');
  ok(shownAt(1e9, Number.POSITIVE_INFINITY, band, false) && shownAt(5, Number.NaN, band, false), 'an infinite reach (the trees, untouched) or none at all always shows');
  ok(shownAt(100, reach, -5, false) && !shownAt(100.01, reach, -5, true), 'a negative band is no band');
}

{
  // The sweep itself, over stand-in chunks: each a middle on its ground, a trees group and a plants group of
  // instanced meshes. It is what the world runs, so every rule of it is driven here rather than read.
  const group = (copies: number): FloraGroupLike & { writes: number } => {
    const g = { visible: true, writes: 0, children: [{ isInstancedMesh: true, count: copies }, { isInstancedMesh: true, count: 1 }, { isInstancedMesh: false }] as unknown[] };
    let v = true;
    Object.defineProperty(g, 'visible', {
      get: () => v,
      set: (x: boolean) => {
        v = x;
        g.writes++;
      },
    });
    return g;
  };
  const chunk = (mx: number, my: number, mz: number): FloraChunk & { trees: ReturnType<typeof group>; plants: ReturnType<typeof group> } => ({ mx, my, mz, trees: group(10), plants: group(40) });
  ok(instancesUnder(group(40)) === 41, 'the plants a group holds are its instanced meshes\' copies');
  const t: FloraReachTune = { ...FLORA_DEFAULTS };
  const s = new PlantSweep();
  const far = chunk(300, 0, 0);
  s.show(far, t);
  ok(far.plants.visible && far.trees.visible && far.plants.writes === 0, 'before any sweep has measured, a chunk 300 m off is shown as it stands, and nothing is written');
  ok(s.due(0, t) === true, 'the first sweep is always due');
  s.begin(0, 0, 0, 100, true);
  s.show(far, t);
  ok(!far.plants.visible && far.trees.visible && far.plants.writes === 1 && far.trees.writes === 0, 'measured from the origin with a reach of 100 m, its plants go and its trees stay (trees at Infinity)');
  s.show(far, t);
  ok(far.plants.writes === 1, 'shown again with nothing changed, nothing is written');
  // The clock: four times a second, and only then.
  ok(s.due(0.1, t) === false && s.due(0.1, t) === false && s.due(0.06, t) === true, 'a sweep is due again only once a quarter second has gone (0.1 + 0.1 + 0.06 s)');
  s.begin(0, 0, 0, 100, true);
  ok(s.due(0.01, t, true) === true, 'and at once when forced');
  t.sweepHz = 1;
  ok(s.due(0.5, t) === false && s.due(0.51, t) === true, 'at a sweep a second it waits the second');
  t.sweepHz = 0;
  s.begin(0, 0, 0, 100, true);
  ok(s.due(0.2, t) === false && s.due(0.06, t) === true, 'a rate of nought or less falls back to four a second rather than never sweeping again');
  t.sweepHz = 4;
  // The eye walked toward the chunk and back: the plants come on at the reach and go only past the band.
  const c = chunk(0, 0, 0);
  const walkTo = (x: number) => {
    s.begin(x, 1.8, 0, 100, true);
    s.visit(c, t);
  };
  walkTo(150);
  ok(!c.plants.visible && s.stats.hidden === 1 && s.stats.hiddenInstances === 41, 'from 150 m its plants are hidden, and counted so');
  walkTo(99);
  ok(c.plants.visible && s.stats.shown === 1 && s.stats.shownInstances === 41, 'walked in to 99 m they come on, and are counted shown');
  walkTo(107);
  ok(c.plants.visible, 'backing off to 107 m, inside the band, they stay');
  walkTo(109);
  ok(!c.plants.visible, 'past the band, at 109 m, they go');
  // In three dimensions, or along the ground.
  const under = chunk(0, 0, 0);
  s.begin(0, 150, 0, 100, true);
  s.show(under, t);
  ok(!under.plants.visible, 'from 150 m straight up, measured from the eye, a chunk right below shows no plants');
  t.planar = true;
  s.show(under, t);
  ok(under.plants.visible, 'measured along the ground it does');
  t.planar = false;
  // Trees are the tune's alone.
  t.treeReach = 200;
  const woods = chunk(250, 0, 0);
  s.begin(0, 0, 0, 100, true);
  s.show(woods, t);
  ok(!woods.trees.visible && !woods.plants.visible, 'with a tree reach of 200 m, trees 250 m off go too');
  t.treeReach = Number.POSITIVE_INFINITY;
  s.show(woods, t);
  ok(woods.trees.visible, 'and back at Infinity they return');
  // A sweep that hides nothing: the reach off, no flora of the planet's own, a captured place on the screen.
  s.begin(0, 0, 0, 100, false);
  s.show(woods, t);
  ok(woods.plants.visible && s.reach === Number.POSITIVE_INFINITY && !s.active, 'a sweep begun inactive shows every plant, and says its reach is Infinity');
  s.begin(0, 0, 0, 100, true);
  s.show(woods, t);
  ok(!woods.plants.visible, 'active again, they go again');
  s.reset();
  s.show(woods, t);
  ok(woods.plants.visible && !s.measured && s.due(0, t), 'a world let go: nothing measured, every plant shown, and the first sweep of the next due at once');
  // A chunk with nothing of the planet's own (procedural props) is left alone.
  const bare: FloraChunk = { mx: 1000, my: 0, mz: 0, trees: null, plants: null };
  s.begin(0, 0, 0, 100, true);
  s.visit(bare, t);
  ok(s.stats.shown === 0 && s.stats.hidden === 0, 'a chunk of procedural props is neither shown nor hidden nor counted');
}

{
  // One chunk planted over a stub terrain: trees under `trees`, plants under `plants`, a model planted both
  // ways in one chunk as a mesh under each, and colliders for the trees alone.
  const kinds = new Map<number, string>([
    [1, 'appearance/tree.apt'],
    [2, 'appearance/bush.apt'],
    [3, 'appearance/rock.apt'],
  ]);
  const child = (family: number) => ({ familyId: family, appearance: kinds.get(family) as string, weight: 1, shouldSway: false, displacement: 0, period: 0, alignToTerrain: false, shouldScale: false, minScale: 1, maxScale: 1 });
  const swg = {
    template: {
      mapWidthInMeters: 16384,
      flora: { collidable: { tileBorder: 0 }, nonCollidable: { tileSize: 8, tileBorder: 0, maximumDistance: 50 }, legacyMap: true, collidableMap: null },
      generator: { floraGroup: { createFlora: (family: number) => (kinds.has(family) ? child(family) : null) } },
    },
    // The game's world is mirrored in X against the client's, as the real terrain's is.
    toSwgX: (x: number) => -x,
    toSwgZ: (z: number) => z,
    toGameX: (x: number) => -x,
    toGameZ: (z: number) => z,
    // Trees: family 1 on even tiles, the rock (family 3) on odd ones; plants: the bush, and the rock on every third tile.
    sampler: {
      excludedAt: () => false,
      floraAt: (x: number, z: number, collidable: boolean) => {
        const t = Math.floor(x / 8) + Math.floor(z / 8);
        if (collidable) return { family: t % 2 === 0 ? 1 : 3, choice: 0.5 };
        return { family: t % 3 === 0 ? 3 : 2, choice: 0.5 };
      },
    },
  };
  const model = (radius: number, height: number) => ({ primitives: [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial(), cell: 0 }], radius, height });
  const models = new Map<string, unknown>([
    ['appearance/tree.apt', model(2, 8)],
    ['appearance/bush.apt', model(0.4, 0.6)],
    ['appearance/rock.apt', model(1.5, 1.5)],
  ]);
  const planter = new FloraPlanter(swg as never, models as never);
  const built = planter.buildForChunk(0, 0, () => 0, []);
  ok(built.group.children.length === 2 && built.group.children[0] === built.trees && built.group.children[1] === built.plants, "a chunk's flora is two groups of its own, the trees and the plants");
  const meshesOf = (g: THREE.Group) => g.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh);
  const trees = meshesOf(built.trees);
  const plants = meshesOf(built.plants);
  const tree = (models.get('appearance/tree.apt') as { primitives: { geometry: THREE.BufferGeometry }[] }).primitives[0].geometry;
  const bush = (models.get('appearance/bush.apt') as { primitives: { geometry: THREE.BufferGeometry }[] }).primitives[0].geometry;
  const rock = (models.get('appearance/rock.apt') as { primitives: { geometry: THREE.BufferGeometry }[] }).primitives[0].geometry;
  ok(trees.some((m) => m.geometry === tree) && !plants.some((m) => m.geometry === tree), 'the tree is under the trees');
  ok(plants.some((m) => m.geometry === bush) && !trees.some((m) => m.geometry === bush), 'the bush is under the plants');
  ok(trees.some((m) => m.geometry === rock) && plants.some((m) => m.geometry === rock), 'a rock planted both ways in the chunk is a mesh under each');
  const treeCopies = trees.reduce((a, m) => a + m.count, 0);
  const plantCopies = plants.reduce((a, m) => a + m.count, 0);
  ok(treeCopies === 16 && plantCopies === 64 && planter.planted === treeCopies + plantCopies, `every placement is in one of the two, once: ${treeCopies} trees (one a 16 m tile) and ${plantCopies} plants (one an 8 m tile)`);
  ok(built.colliders.length === treeCopies, 'and only the trees are solid');
  ok(trees.every((m) => m.boundingSphere !== null) && plants.every((m) => m.boundingSphere !== null), "every mesh's sphere is worked out, for the frustum and the world pass from inside");
  // And the sweep takes a real chunk's groups as they come out of the planter.
  const s = new PlantSweep();
  const real = { mx: 32, my: 0, mz: 32, trees: built.trees, plants: built.plants };
  s.begin(500, 0, 32, 100, true);
  s.visit(real, FLORA_DEFAULTS);
  ok(!built.plants.visible && built.trees.visible && s.stats.hiddenInstances === plantCopies, "a planted chunk 468 m from the eye has its plants hidden and its trees standing, and its plants counted");
}

{
  // The wiring, read as text: `world.ts` and `main.ts` are browser modules that drag the whole game in.
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const world = src('world/world.ts');
  const main = src('main.ts');
  ok(/const built = this\.flora\.buildForChunk\([\s\S]{0,200}trees = built\.trees;\s*plants = built\.plants;/.test(world), 'a chunk keeps its trees and its plants');
  ok(/this\.chunks\.set\(key, chunk\);[\s\S]{0,300}this\.plantSweep\.show\(chunk, FLORA_TUNE\);/.test(world), 'and a chunk made is shown or hidden at once, not at the next sweep');
  ok(/this\.sweepFlora\(camPos, dt\);\s*this\.stream\(playerPos, STREAM_BUDGET\);/.test(world), 'the sweep runs every update before the stream, from the camera');
  ok(/this\.sweepFlora\(center, 0, true\);\s*this\.stream\(center, Infinity\);/.test(world), 'and an arrival measures from where the player arrives before any chunk is made');
  ok(/if \(!sweep\.due\(dt, FLORA_TUNE, force\)\) return;\s*sweep\.begin\(eye\.x, eye\.y, eye\.z, this\.plantReach, this\.plantsReached\);\s*this\.chunks\.forEach\(this\.plantVisit\);/.test(world), 'a sweep begins from the eye it is handed, with the reach in force, on the sweep\'s own clock, and visits every chunk');
  ok(/private readonly plantVisit = \(c: Chunk\): void => this\.plantSweep\.visit\(c, FLORA_TUNE\);/.test(world), 'with one visit made with the world, so a sweep makes no closure');
  ok(/private get plantsReached\(\): boolean \{\s*return FLORA_TUNE\.on && !!this\.floraTemplate && !this\.sceneOnly;/.test(world), 'the reach hides nothing with the switch off, with no flora of the planet\'s own, or in a captured place on the creation and selection screens');
  ok(/this\.floraTemplate = null;\s*[\s\S]{0,200}this\.plantSweep\.reset\(\);/.test(world), 'a world let go leaves the next one nothing measured');
  ok(/registerPerfSwitch\('floraReach', \{ get: \(\) => FLORA_TUNE\.on, set: \(v\) => this\.world\.setFloraReach\(!!v\), values: \[false, true\]/.test(main), "the frame report's switch is `floraReach`, the old way first");
  ok(/applyReachOption\(FLORA_TUNE, opts\.reach\);\s*this\.world\.refreshFloraReach\(\);/.test(main), 'and the console\'s `flora({ reach })` goes through the one rule the test drives');
}

console.log(`\n${checks} checks passed`);
