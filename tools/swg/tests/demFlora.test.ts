// A real-elevation world's plants from its paint alone (Map-maker II's fourth wave, DESIGN.md §2.6; the owner's answer to
// Q6: the world's own planter plants all four classes from the paint out of the lent pack, follows the sculpting, writes no
// rows). Monument's committed raster as the ground, Lok's table lent (else the first converted world's), a 500 m square
// painted with a recipe that adds a tree family, a plant family, a grass family and a far family:
//   - the planter (the very `FloraPlanter` a converted world plants with) plants trees and plants inside the square and
//     nothing outside it, the chunks it plants are exactly those `paintedIn` names, and each planting stands on the ground
//     handed in (moved up ten metres, every planting moves ten metres: the sculpting is followed);
//   - the keep-off circles keep it off, as on a converted world;
//   - the grass (`placeGrass` over the source) stands tufts inside and none outside, on the ground, and drops those under
//     a stand-in lake but the ones meant for water; the far cards' samples carry the far family inside and none outside,
//     and `placeFarCards` stands cards there;
//   - its tile keys run over the world's own width: a square painted further out than half the lent world's width plants
//     under the world's width, and would plant nothing under the lent one's (why the width is the world's);
//   - the world's hand-overs (the source's width, ground and frame) read as text.
//
// Run: node tools/swg/tests/demFlora.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { CHUNK_SIZE, Terrain } from '../../../src/world/terrain.ts';
import { makeDemPatch } from '../../../src/world/demTerrain.ts';
import { FloraPlanter } from '../../../src/world/flora.ts';
import { GroundPaint, PAINT_TILE, type FloraRecipe } from '../../../src/swg/terrain/groundPaint.ts';
import { PaintFloraSource, recipeClassesMoved, recipesLead } from '../../../src/world/paintFlora.ts';
import { readRadialFile } from '../../../src/swg/terrain/radialFile.ts';
import { shaderKey } from '../../../src/swg/terrain/shaderKey.ts';
import type { RadialChild } from '../../../src/swg/terrain/flora.ts';
import { FAR_CARD_DEFAULTS, GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, MEANT_FOR_WATER, candidateCapacity, placeFarCards, placeGrass, placeStats, tuftBuffers, type GrassWorld } from '../../../src/world/grassMath.ts';
import { SWAY_DEFAULTS } from '../../../src/world/swayMath.ts';
import { PLANETS } from '../../../src/data/planets.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const mon = PLANETS.find((p) => p.id === 'monument');
const rawDir = mon?.dem ? join(REPO, 'public', mon.dem.url.replace(/^\//, '')) : '';
const worlds = groundWorlds();
const lentPack = worlds.includes('lok') ? 'lok' : worlds.find((w) => w !== 'mustafar' && !w.startsWith('kashyyyk_'));
if (!mon?.dem || !existsSync(join(rawDir, 'base16.raw'))) note("Monument's raster is not here: the world half is skipped");
if (!lentPack) note(`no converted world under ${PACKS} to lend its flora: the world half is skipped`);

/** A model for any appearance asked, so every candidate plants and names its model. */
class AnyModels extends Map<string, unknown> {
  override get(key: string): unknown {
    if (!super.has(key)) super.set(key, { primitives: [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial(), cell: 0 }], radius: 1, height: 4, def: undefined, key });
    return super.get(key);
  }
}

if (mon?.dem && existsSync(join(rawDir, 'base16.raw')) && lentPack) {
  const d = mon.dem;
  const raw = readFileSync(join(rawDir, 'base16.raw'));
  const meta = JSON.parse(readFileSync(join(rawDir, 'base.json'), 'utf8'));
  const terrain = new Terrain(mon);
  const patch = makeDemPatch(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, meta, { size: d.size, lift: d.lift, feather: d.feather ?? 0 });
  terrain.demDetail = d.detail ?? 0;
  terrain.dem = patch;
  terrain.minH = patch.minHeight + patch.lift;
  terrain.maxH = patch.maxHeight + patch.lift;
  terrain.floor = terrain.minH - 30;
  const trn = readFileSync(join(PACKS, lentPack, 'terrain.trn'));
  const table = await SwgTerrain.create(trn.buffer.slice(trn.byteOffset, trn.byteOffset + trn.byteLength) as ArrayBuffer, [], 0, 0, async () => null, { tableOnly: true });
  const gen = table.template.generator;
  // The families: the static table's two with the most children (a tree and a plant), the radial table's two (grass, far).
  const byKids = <F extends { name: string; children: unknown[] }>(m: Map<number, F>) => [...m.values()].filter((f) => f.children.length).sort((a, b) => b.children.length - a.children.length);
  const statics = byKids(gen.floraGroup.families as never as Map<number, { name: string; children: unknown[] }>);
  const radials = byKids(gen.radialGroup.families as never as Map<number, { name: string; children: unknown[] }>);
  if (statics.length < 1 || radials.length < 1) note(`${lentPack}'s tables hold no flora: the world half is skipped`);
  else {
    const named = (name: string) => ({ pack: lentPack, name });
    const recipe: FloraRecipe = { trees: { add: named(statics[0].name), density: 1 }, plants: { add: named((statics[1] ?? statics[0]).name), density: 1 }, grass: { add: named(radials[0].name), density: 1 }, far: { add: named((radials[1] ?? radials[0]).name), density: 1 } };
    /** A paint of recipe 1 at full over a raw square (x and z from `a` to `b`), 4 m cells. */
    const paintSquare = (a: number, b: number, za = a, zb = b): GroundPaint => paintWith(recipe, a, b, za, zb);
    /** A paint of a recipe of one's own at full over a raw rectangle. */
    function paintWith(rec: FloraRecipe, a: number, b: number, za = a, zb = b): GroundPaint {
      const p = new GroundPaint();
      const missing = p.resolveRecipes([rec], gen.floraGroup, gen.radialGroup, lentPack!);
      assert.equal(missing.length, 0, missing.join('; '));
      for (let cz = Math.floor(za / p.cell); cz < Math.ceil(zb / p.cell); cz++) {
        for (let cx = Math.floor(a / p.cell); cx < Math.ceil(b / p.cell); cx++) {
          const tx = Math.floor(cx / p.n);
          const tz = Math.floor(cz / p.n);
          const t = p.floraTile(tx, tz, true)!;
          const o = ((cz - tz * p.n) * p.n + (cx - tx * p.n)) * 2;
          t[o] = 1;
          t[o + 1] = 255;
        }
      }
      p.boundsAgain();
      return p;
    }
    const paint = paintSquare(-250, 250);
    let lift = 0;
    let lake: { x: number; z: number; r: number } | null = null;
    const ground = {
      heightAt: (x: number, z: number) => terrain.heightAt(x, z) + lift,
      waterHeightAt: (x: number, z: number) => (lake && (x - lake.x) ** 2 + (z - lake.z) ** 2 < lake.r * lake.r ? terrain.heightAt(lake.x, lake.z) + 50 : -Infinity),
      colourAt: (_x: number, _z: number, out: Uint8Array) => out.fill(200),
    };
    const src = new PaintFloraSource(() => paint, { flora: table.template.flora, floraGroup: gen.floraGroup, radialGroup: gen.radialGroup }, ground, d.size);
    const models = new AnyModels();
    const planter = new FloraPlanter(src, models as never);
    // ---- the planter
    let inside = 0;
    let insideTrees = 0;
    let outsideSquare = 0;
    let wrongPainted = '';
    let offGround = 0;
    for (let cz = -6; cz < 6; cz++) {
      for (let cx = -6; cx < 6; cx++) {
        const built = planter.buildForChunk(cx, cz, (x, z) => ground.heightAt(x, z), []).data;
        const painted = src.paintedIn(cx * CHUNK_SIZE, cz * CHUNK_SIZE, CHUNK_SIZE);
        if ((built.n > 0) && !painted) wrongPainted ||= `chunk ${cx},${cz} planted ${built.n} where paintedIn says no paint`;
        for (let i = 0; i < built.n; i++) {
          if (Math.abs(built.x[i]) > 250 + 4 || Math.abs(built.z[i]) > 250 + 4) outsideSquare++;
          if (Math.abs(built.y[i] - Math.fround(ground.heightAt(built.x[i], built.z[i]))) > 0.05) offGround++;
          inside++;
          if (built.collidable[i]) insideTrees++;
        }
      }
    }
    ok(inside > 0 && insideTrees > 0 && inside > insideTrees, `Monument with ${lentPack}'s table lent, a 500 m square painted: the planter plants ${insideTrees} trees and ${inside - insideTrees} plants over the 768 m round it`);
    ok(outsideSquare === 0 && !wrongPainted, `none of them outside the painted square (a cell's feather aside), and no chunk planted that \`paintedIn\` does not name${wrongPainted ? ` (${wrongPainted})` : ''}`);
    ok(offGround === 0, 'every planting stands on the ground handed in (the raster under it)');
    const far = planter.buildForChunk(20, 20, (x, z) => ground.heightAt(x, z), []).data;
    ok(far.n === 0 && !src.paintedIn(20 * CHUNK_SIZE, 20 * CHUNK_SIZE, CHUNK_SIZE), 'a chunk far from the paint plants nothing, and is not the planter\'s (its procedural props stand)');
    // Sculpting followed: the ground raised ten metres, every planting with it.
    const base = planter.buildForChunk(0, 0, (x, z) => ground.heightAt(x, z), []).data;
    lift = 10;
    const raised = planter.buildForChunk(0, 0, (x, z) => ground.heightAt(x, z), []).data;
    lift = 0;
    let moved = base.n === raised.n && base.n > 0;
    for (let i = 0; i < base.n && moved; i++) if (base.x[i] !== raised.x[i] || base.z[i] !== raised.z[i] || Math.abs(raised.y[i] - base.y[i] - 10) > 1e-3) moved = false;
    ok(moved, `the ground sculpted up ten metres, the same ${base.n} plantings stand ten metres higher (the planter follows the sculpting, as it is handed the world's own height)`);
    // The keep-off circles.
    const circle = { x: 32, z: 32, r: 20 };
    const kept = planter.buildForChunk(0, 0, (x, z) => ground.heightAt(x, z), [circle]).data;
    let inCircle = 0;
    for (let i = 0; i < kept.n; i++) if (Math.hypot(kept.x[i] - circle.x, kept.z[i] - circle.z) <= circle.r) inCircle++;
    ok(kept.n > 0 && kept.n < base.n && inCircle === 0, `a keep-off circle of 20 m radius in a chunk keeps its plantings off (${base.n - kept.n} kept off, ${kept.n} stand)`);

    // ---- the grass and the far cards
    const radialJson = join(PACKS, lentPack, 'terrain', 'radial.json');
    const file = existsSync(radialJson) ? readRadialFile(JSON.parse(readFileSync(radialJson, 'utf8'))) : null;
    const keys = new Map<RadialChild, string>();
    for (const f of gen.radialGroup.families.values()) for (const ch of f.children) keys.set(ch, shaderKey(ch.shader));
    const shaders = file?.shaders ?? new Map([...keys.values()].map((k, i) => [k, { layer: i, near: true, far: true, alphaRef: 0, kind: 'plain' as const, width: 256, height: 256 }]));
    const gworld: GrassWorld = { group: gen.radialGroup, shaders, keyOf: (ch) => keys.get(ch)! };
    const near = table.template.flora.radial;
    const grassOf = (from: PaintFloraSource, x0: number, z0: number) => {
      const b = tuftBuffers(candidateCapacity(near, 64));
      const stats = placeStats();
      placeGrass(from, gworld, near, x0, z0, 64, [], GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, SWAY_DEFAULTS, b, stats);
      return { b, stats };
    };
    const grass = (x0: number, z0: number) => grassOf(src, x0, z0);
    const gIn = grass(0, 0);
    const gOut = grass(640, 640);
    let tuftOff = 0;
    for (let i = 0; i < gIn.b.count; i++) if (Math.abs(gIn.b.tuft[i * 4 + 1] - Math.fround(ground.heightAt(gIn.b.tuft[i * 4], gIn.b.tuft[i * 4 + 2]))) > 0.05) tuftOff++;
    ok(gIn.b.count > 0 && gOut.b.count === 0 && tuftOff === 0, `the grass stands ${gIn.b.count} tufts in a painted chunk, on the ground, and none in one 640 m off`);
    lake = { x: 32, z: 32, r: 24 };
    const gLake = grass(0, 0);
    lake = null;
    const anyWet = [...keys.values()].some((k) => MEANT_FOR_WATER.test(k));
    ok(gLake.stats.water > 0 && gLake.b.count < gIn.b.count, `under a stand-in lake its tufts are dropped (${gLake.stats.water} of them${anyWet ? ', the lent pack\'s water plants kept' : ''})`);
    const FAR_TILE = 512;
    const RES = 32;
    const sIn = src.farSamples(-256, -256, FAR_TILE, RES);
    const sOut = src.farSamples(2048, 2048, FAR_TILE, RES);
    const farIn = sIn.radialFar.some((v, i) => i % 2 === 0 && v !== 0);
    const farOut = sOut.radialFar.some((v) => v !== 0);
    const cards = tuftBuffers(candidateCapacity(table.template.flora.farRadial, FAR_TILE));
    placeFarCards(src, gworld, table.template.flora.farRadial, -256, -256, FAR_TILE, sIn, 2.5, () => [], FAR_CARD_DEFAULTS, cards, placeStats());
    ok(farIn && !farOut && cards.count > 0, `the far cards' samples carry the far family over the paint and none 2 km off, and ${cards.count} far cards stand over the painted tile`);
    let samplesOff = 0;
    for (let j = 0; j < sIn.n; j++) for (let i = 0; i < sIn.n; i++) if (sIn.heights[j * sIn.n + i] !== Math.fround(ground.heightAt(sIn.gx0 + i * sIn.step, sIn.gz0 + j * sIn.step))) samplesOff++;
    ok(samplesOff === 0, "and their heights are the ground's own at every sample");

    // ---- tile keys over the world's own width
    const lentWidth = table.template.mapWidthInMeters;
    const wide = 32768;
    const at = Math.min(wide / 2 - 512, lentWidth / 2 + 1024);
    if (at > lentWidth / 2 + 256) {
      const wPaint = paintSquare(at, at + 256, -128, 128);
      const plantOf = (width: number) => {
        const s = new PaintFloraSource(() => wPaint, { flora: table.template.flora, floraGroup: gen.floraGroup, radialGroup: gen.radialGroup }, ground, width);
        const p = new FloraPlanter(s, models as never);
        let n = 0;
        // Raw x from `at` to `at + 256` is game x from -(at + 256) to -at.
        for (let cz = -2; cz < 2; cz++) for (let cx = Math.floor(-(at + 256) / CHUNK_SIZE); cx < Math.ceil(-at / CHUNK_SIZE); cx++) {
          const b = p.buildForChunk(cx, cz, () => 0, []).data;
          for (let i = 0; i < b.n; i++) if (b.collidable[i]) n++;
        }
        return n;
      };
      const ownWidth = plantOf(wide);
      const lentOnly = plantOf(lentWidth);
      ok(ownWidth > 0 && lentOnly === 0, `on a ${wide / 1024} km world a square painted ${(at / 1000).toFixed(1)} km out plants ${ownWidth} trees under the world's own width, where under the lent world's ${lentWidth} m it would plant none (its tile keys run off the edge)`);
    } else note(`${lentPack}'s width (${lentWidth} m) is too wide for the wide-world check`);

    // ---- a patch off the axis: every reader mirrors x the same way
    {
      // Raw x 100..300 (game x -300..-100), z -100..100: a mirror slipped in any one reader puts its plants at +100..+300.
      const patch = paintWith(recipe, 100, 300, -100, 100);
      const s = new PaintFloraSource(() => patch, { flora: table.template.flora, floraGroup: gen.floraGroup, radialGroup: gen.radialGroup }, ground, d.size);
      const p = new FloraPlanter(s, models as never);
      let west = 0;
      let east = 0;
      const kinds = new Set<unknown>();
      for (let cz = -3; cz < 3; cz++) for (let cx = -6; cx < 6; cx++) {
        const b = p.buildForChunk(cx, cz, () => 0, []).data;
        for (let i = 0; i < b.n; i++) {
          if (b.x[i] >= -304 && b.x[i] <= -96) west++;
          else east++;
          if (b.collidable[i]) kinds.add(b.models[i]);
        }
      }
      ok(west > 0 && east === 0, `a patch painted at raw x 100..300 plants its ${west} trees and plants at game x -300..-100 and none anywhere else`);
      const gW = grassOf(s, -256, -32);
      const gE = grassOf(s, 192, -32);
      let gOff = 0;
      for (let i = 0; i < gW.b.count; i++) if (gW.b.tuft[i * 4] > -96 || gW.b.tuft[i * 4] < -304) gOff++;
      ok(gW.b.count > 0 && gE.b.count === 0 && gOff === 0, `its grass stands ${gW.b.count} tufts in the chunk at game x -256 and none in its mirror at +192`);
      const fW = s.farSamples(-512, -256, 512, 32);
      const fE = s.farSamples(0, -256, 512, 32);
      ok(fW.radialFar.some((v, i) => i % 2 === 0 && v !== 0) && !fE.radialFar.some((v) => v !== 0), 'its far family is in the far samples of the tile at game x -512..0 and none in the tile at 0..512');
      ok(s.paintedIn(-256, 0, 64) && !s.paintedIn(192, 0, 64) && s.farReaches(-512, -256, 512, 32) && !s.farReaches(512, -256, 512, 32), '`paintedIn` and `farReaches` name the chunk and the far tile over the patch, and not their mirrors');
      const kids = statics[0].children.length;
      if (kids > 1) ok(kinds.size > 1, `the trees take their children by their choice (${kinds.size} of the family's ${kids} children planted, never only the first)`);
      else note(`${statics[0].name} has one child: the choice's spread is not seen here`);
    }

    // ---- a family at its own density
    {
      // An add naming no density plants at the family's own: over a square of 3,600 collidable tiles (raw -480..480 each
      // way, one candidate a 16 m tile) the share of candidates planted is the family's density, within a tenth of it (or
      // three and a half standard errors where that is wider, for a thin family).
      // A family whose own density is under one decides the check (every one of some worlds' is one, Lok's among them), so
      // the lent table here is the first converted world's that has one, lent to Monument as Lok's is above.
      let dPack = '';
      let dTable: Awaited<ReturnType<typeof SwgTerrain.create>> | null = null;
      let fam: { id: number; name: string; density: number } | undefined;
      for (const w of ['naboo', 'corellia', 'tatooine', 'rori', 'talus', ...worlds]) {
        if (!worlds.includes(w)) continue;
        const bytes = readFileSync(join(PACKS, w, 'terrain.trn'));
        const t = await SwgTerrain.create(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, [], 0, 0, async () => null, { tableOnly: true });
        fam = [...t.template.generator.floraGroup.families.values()].find((f) => f.children.length && f.id > 0 && f.id < 256 && f.density >= 0.2 && f.density <= 0.95);
        if (fam) {
          dPack = w;
          dTable = t;
          break;
        }
        t.dispose();
      }
      if (!fam || !dTable) note('no converted world has a static family of a density between 0.2 and 0.95: the own-density check is skipped');
      else {
        const dg = dTable.template.generator;
        const own = new GroundPaint();
        const miss = own.resolveRecipes([{ trees: { add: { pack: dPack, name: fam.name } } }], dg.floraGroup, dg.radialGroup, dPack);
        assert.equal(miss.length, 0, miss.join('; '));
        for (let cz = -125; cz < 125; cz++) for (let cx = -125; cx < 125; cx++) {
          const tx = Math.floor(cx / own.n);
          const tz = Math.floor(cz / own.n);
          const t = own.floraTile(tx, tz, true)!;
          const o = ((cz - tz * own.n) * own.n + (cx - tx * own.n)) * 2;
          t[o] = 1;
          t[o + 1] = 255;
        }
        own.boundsAgain();
        const s = new PaintFloraSource(() => own, { flora: dTable.template.flora, floraGroup: dg.floraGroup, radialGroup: dg.radialGroup }, ground, d.size);
        const p = new FloraPlanter(s, models as never);
        let trees = 0;
        for (let cz = -8; cz < 8; cz++) for (let cx = -8; cx < 8; cx++) {
          const b = p.buildForChunk(cx, cz, () => 0, []).data;
          for (let i = 0; i < b.n; i++) if (b.collidable[i] && b.x[i] > -480 && b.x[i] <= 480 && b.z[i] >= -480 && b.z[i] < 480) trees++;
        }
        const n = 3600;
        const share = trees / n;
        const tol = Math.max(0.1 * fam.density, 3.5 * Math.sqrt((fam.density * (1 - fam.density)) / n));
        ok(Math.abs(share - fam.density) <= tol, `${dPack}'s ${fam.name} added at its own density (${fam.density.toFixed(3)}), lent to Monument, plants ${trees} of ${n} candidate tiles (${share.toFixed(3)}), within ${tol.toFixed(3)}`);
        dTable.dispose();
      }
    }

    // ---- the procedural props' ground
    {
      const grassOnly = paintWith({ grass: { add: named(radials[0].name) } }, -100, 100);
      const treesOnly = paintWith({ trees: { add: named(statics[0].name) } }, -100, 100);
      const sg = new PaintFloraSource(() => grassOnly, { flora: table.template.flora, floraGroup: gen.floraGroup, radialGroup: gen.radialGroup }, ground, d.size);
      const st = new PaintFloraSource(() => treesOnly, { flora: table.template.flora, floraGroup: gen.floraGroup, radialGroup: gen.radialGroup }, ground, d.size);
      ok(st.ownsAt(0, 0) && st.ownsAt(-90, 90) && !st.ownsAt(-200, 0) && !st.ownsAt(150, 0) && !sg.ownsAt(0, 0), "the paint's trees and plants own the ground a recipe of theirs reaches (a procedural rock there is left out of the planter's chunk) and nowhere else; a recipe of grass alone owns none (a dab of grass takes no rock away)");
    }
    table.dispose();
  }
}

{
  // What a landing makes of a recipes row (the fix round): a row that is the list in memory or its start keeps the recipes
  // appended ahead of the file, and a moved list names the classes it moved, so a real-elevation world plants again only
  // those, over the tiles that name them.
  const a: FloraRecipe = { trees: 'clear' };
  const b: FloraRecipe = { grass: { thin: 0.5 } };
  const c: FloraRecipe = { far: { add: { pack: 'p', name: 'x' } } };
  ok(recipesLead([], [a, b]) && recipesLead([a], [a, b]) && recipesLead([a, b], [a, b]) && !recipesLead([b], [a, b]) && !recipesLead([a, b, c], [a, b]), 'a recipes row that is the list in memory or its start (none included) leads it; another list, or a longer one, does not');
  const m1 = recipeClassesMoved([a, b], [a, b, c]);
  const m2 = recipeClassesMoved([a, b], [{ trees: 'keep' }, b]);
  const m3 = recipeClassesMoved([a], [a]);
  const m4 = recipeClassesMoved([a], [{ ...a, roads: true }]);
  ok(!m1.static && !m1.grass && m1.far && m2.static && !m2.grass && !m2.far && !m3.static && !m3.grass && !m3.far && m4.static && m4.grass && m4.far, 'a recipes list moved names the classes it moved: one appended adding far cards moves the far cards alone, a tree class taken back to keep the trees alone, the same list nothing, and the roads every class');
}

{
  // The world's hand-overs, as text.
  const world = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/const ground = \{ heightAt: \(x: number, z: number\) => this\.terrain\.heightAt\(x, z\), waterHeightAt: \(x: number, z: number\) => this\.terrain\.waterHeightAt\(x, z\), colourAt: \(x: number, z: number, out: Uint8Array\) => this\.terrain\.demColourAt\(x, z, out\) \};/.test(world), "the world hands the source its own height (sculpting and all), its water and the ground's drawn colour");
  ok(/new PaintFloraSource\(\(\) => this\.groundPaint, \{ flora: lent\.template\.flora, floraGroup: gen\.floraGroup, radialGroup: gen\.radialGroup \}, ground, this\.planet\.dem\.size\)/.test(world), "over the lent pack's tables and tilings, at the world's own width");
  const src = readFileSync(join(REPO, 'src/world/paintFlora.ts'), 'utf8');
  ok(/toSwgX\(gx: number\): number \{\n\s*return -gx;/.test(src.replace(/\r\n/g, '\n')) && /excludedAt: \(\) => false/.test(src) && /roadAt: \(\) => false/.test(src), "in the real-elevation world's raw frame (x mirrored about the origin), with nothing excluded and no road");
}

console.log(`\ndemFlora: ${checks} checks passed`);
