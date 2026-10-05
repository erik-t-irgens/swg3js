// The ground's families laid on the client's 8 m pattern, and each pole's own choice among a family's
// alternates (materials and ground pass, wave 2).
//
// The engine finishes every chunk by giving each pole the family of the 8 m pattern corner nearest it,
// a tie going to the corner above, and does the same before any layer that reads the family map
// through a shader filter, whenever a family has been painted since: so families come in 8 m cells
// centred on the chunk corners, and the flora that grows by family follows them. Every pole a shader
// affector paints also keeps a choice among its family's alternates, drawn from its own place and never
// moved by the pattern. Our port skipped all of it. Every check here is of what the generator makes:
//
//   1. a terrain built in memory: each pole's family is its nearest corner's, ties going up, in the
//      cases worked out by hand; a shader filter reads the families as laid on the pattern, but one over
//      sub-layers alone reads them as painted; every pole a constant, a road or a river paints keeps its
//      own place's choice, and a replace keeps the choice it found; a choice landing exactly on a child's
//      weight takes that child
//   2. the converted worlds (SWG3JS_PACKS, else assets-private), over 48 or more blocks each on Tatooine
//      and Naboo: every pole's family equals its nearest corner's, worked out here from the pole's own
//      world position, and the heights are bit for bit the same with the pattern and without it
//   3. the client's own baked maps at their tile points: on Tatooine at least 98.4% of the tiles both
//      plant name the same collidable flora family (PIMP) and on Talus 82.3%, the research's figures over
//      its own 200 blocks; on every converted world the share of tiles whose flora agrees with the
//      client's map, planted or bare, is never worse with the pattern than without it; and our ground
//      stands at the client's own baked height (PFPM) to within that map's rounding at every planted tile,
//      Talus held where it was measured
//
// Run: node tools/swg/tests/terrainSnap.test.ts
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { form, chunk, W, encode, ihdr } from './iffWriter.ts';
import { FastRandomGenerator, hashTuple } from '../../../src/swg/terrain/flora.ts';
import { childChoiceAt, childIndexOf, snapFamilies, TERRAIN_GROUND_TUNE } from '../../../src/swg/terrain/generator.ts';
import { parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { bakedFlora, groundWorlds, loadWorld, PACKS, sampleBlocks } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

/** The pattern corner nearest a world coordinate, a tie going to the one above: worked out here, not asked of the generator. */
const cornerOf = (w: number, lattice = 8) => Math.floor(w / lattice + 0.5) * lattice;

// ---------------------------------------------------------------- 1. a terrain built in memory

{
  // A retail-shaped header: 8 m chunks of two 4 m tiles, so poles 2 m apart and the pattern 8 m.
  const header = new W().str('snap').f32(2048).f32(8).i32(2).i32(0).f32(0).f32(2).str('').f32(60)
    .f32(0).f32(0).f32(16).f32(2).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(1).bytes();
  const sfam = (id: number, name: string, children: [string, number][]) => {
    const w = new W().i32(id).str(name).str('').u8(1).u8(2).u8(3).f32(4).f32(1).i32(children.length);
    for (const [c, weight] of children) w.str(c).f32(weight);
    return chunk('SFAM', w.bytes());
  };
  const sgrp = form('SGRP', form('0006', sfam(1, 'sand', [['shader/sand_a.sht', 1], ['shader/sand_b.sht', 1], ['shader/sand_c.sht', 2]]), sfam(2, 'rock', [['shader/rock.sht', 1]]), sfam(3, 'grass', [['shader/grass.sht', 1]]), sfam(4, 'gravel', [['shader/gravel_a.sht', 1], ['shader/gravel_b.sht', 4]]), sfam(5, 'mud', [['shader/mud.sht', 1]]), sfam(6, 'road', [['shader/road.sht', 1]]), sfam(7, 'bank', [['shader/bank.sht', 1]]), sfam(8, 'riverbed', [['shader/riverbed.sht', 1]])));
  const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
  const ascn = (family: number) => form('ASCN', form('0001', ihdr(`paint ${family}`), chunk('DATA', new W().i32(family).i32(0).f32(1).bytes())));
  const asrp = (from: number, to: number) => form('ASRP', form('0001', ihdr(`replace ${from}`), chunk('DATA', new W().i32(from).i32(to).i32(0).f32(1).bytes())));
  const circle = (x: number, z: number, r: number) => form('BCIR', form('0002', ihdr('circle'), chunk('DATA', new W().f32(x).f32(z).f32(r).i32(0).f32(0).bytes())));
  const rect = (x0: number, z0: number, x1: number, z1: number) => form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
  const fshd = (family: number) => form('FSHD', form('0000', ihdr('on rock'), chunk('DATA', new W().i32(family).bytes())));
  const aexc = form('AEXC', form('0000', ihdr('exclude')));
  // A road (version 3: its points, width, family, feather) and a river (version 3: points, width, bank and
  // bottom families, feather, trench, velocity, local water table, its shader size and name), neither with
  // height data, so both lay the ground flat at nought where they run.
  const aroa = (x0: number, z0: number, x1: number, z1: number, width: number, family: number) =>
    form('AROA', form('0003', ihdr('road'), form('DATA', chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).f32(width).i32(family).i32(0).f32(0).bytes()))));
  const ariv = (x0: number, z0: number, x1: number, z1: number, width: number, bank: number, bottom: number) =>
    form('ARIV', form('0003', ihdr('river'), form('DATA', chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).f32(width).i32(bank).i32(bottom).i32(0).f32(0.4).f32(1).f32(0).i32(0).f32(2).f32(2).str('').bytes()))));
  const layer = (name: string, ...items: ReturnType<typeof form>[]) => form('LAYR', form('0003', ihdr(name), adta(), ...items));
  const groups = [sgrp, form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), form('MGRP', form('0000'))];
  const tgen = form('TGEN', form('0000', ...groups, form('LYRS',
    layer('sand', rect(-100, -100, 100, 100), ascn(1)),
    layer('rock', circle(13, 13, 6), ascn(2)),
    // Reads the family map: the rock disc as laid on the pattern, so excluding exactly that.
    layer('on rock', fshd(2), aexc),
    layer('grass', circle(40, 40, 5), ascn(3)),
    // Nothing painted here before: the replace keeps the nought choice it finds.
    layer('mud', rect(150, 150, 170, 170), asrp(0, 5)),
    // Over ground nothing else paints, so a choice found there can only be the road's or the river's own.
    layer('road', aroa(120, 300, 220, 300, 10, 6)),
    layer('river', ariv(120, 340, 220, 340, 16, 7, 8)),
  )));
  const t = parseTerrainTemplate(encode(form('PTAT', form('0015', chunk('DATA', header), tgen, form('BAKE')))));
  ok(t.generator.familyLattice === 8, 'the pattern is two tiles, four poles: 8 m on a terrain of 4 m tiles');
  ok(TERRAIN_GROUND_TUNE.legacyChildren === 'hash', 'the choice of alternate is drawn from the place on every terrain, legacy or not (the one rule built)');
  const s = new TerrainSampler(t);
  const n = s.numberOfPoles;
  const at = (g: { shaders: Int32Array }, start: { x: number; z: number }, x: number, z: number) => g.shaders[((z - start.z) / 2) * n + (x - start.x) / 2];

  const st = s.blockStart(0, 0);
  const g = s.generate(st.x, st.z, n, s.poleStep);
  t.generator.snapFamilies = false;
  const raw = s.generate(st.x, st.z, n, s.poleStep);
  t.generator.snapFamilies = true;

  let wrong = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const wx = st.x + i * 2;
      const wz = st.z + j * 2;
      if (g.shaders[j * n + i] !== at(raw, st, cornerOf(wx), cornerOf(wz))) wrong++;
    }
  }
  ok(wrong === 0, `every pole of the block takes the family its nearest 8 m corner was painted with (${wrong} of ${n * n} do not)`);
  ok(at(raw, st, 4, 12) === 1 && at(g, st, 4, 12) === 2, 'a pole outside the disc whose corner (ties up in both axes: 8, 16) is inside it takes the disc');
  ok(at(raw, st, 12, 12) === 2 && at(g, st, 12, 12) === 2 && at(raw, st, 8, 8) === 1 && at(g, st, 10, 10) === 1, 'midway between corners 8 and 16 goes up to 16; a step past 8 stays with 8');
  ok(at(g, st, 0, 4) === at(raw, st, 0, 8) && at(g, st, 2, 2) === at(raw, st, 0, 0), 'ties go to the corner above along each axis on its own');
  let moved = 0;
  for (let k = 0; k < n * n; k++) if (g.shaders[k] !== raw.shaders[k]) moved++;
  ok(moved > 0, `the pattern really moves families here (${moved} poles)`);

  // The filter layer read the families as laid on the pattern before it, not as painted.
  let excludedRight = 0;
  let rawWould = 0;
  for (let k = 0; k < n * n; k++) {
    if (g.excluded[k] === (g.shaders[k] === 2 ? 1 : 0)) excludedRight++;
    if (raw.excluded[k] === (raw.shaders[k] === 2 ? 1 : 0)) rawWould++;
  }
  ok(excludedRight === n * n, `a shader filter reads the families laid on the pattern: the excluded poles are exactly the rock cells (${excludedRight} of ${n * n})`);
  ok(rawWould === n * n && raw.excluded.some((v, k) => v !== g.excluded[k]), 'without the pattern it reads the disc as painted, a different set');

  // Each painted pole's choice is the first float a generator seeded with its own place draws, times 255.
  let childWrong = 0;
  let painted = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (!g.shaders[k]) continue;
      painted++;
      const wx = st.x + i * 2;
      const wz = st.z + j * 2;
      const want = Math.trunc(Math.fround(new FastRandomGenerator(hashTuple(wx, wz)).randomFloat() * 255));
      if (g.children[k] !== want || raw.children[k] !== want) childWrong++;
    }
  }
  ok(painted > 1000 && childWrong === 0, `every painted pole keeps the choice its own place draws, moved or not by the pattern (${childWrong} of ${painted} wrong)`);
  let drawsWrong = 0;
  for (let k = 0; k < 2000; k++) {
    const x = (k * 37) % 4096 - 2048;
    const z = (k * 91) % 4096 - 2048;
    if (childChoiceAt(x, z) !== Math.trunc(Math.fround(new FastRandomGenerator(hashTuple(x, z)).randomFloat() * 255))) drawsWrong++;
  }
  ok(drawsWrong === 0, 'the one reseeded generator draws what a fresh generator seeded with the place draws first, at 2,000 places');
  const fam1 = t.generator.shaderGroup.families.get(1)!;
  ok(childIndexOf(fam1, 0) === 0 && childIndexOf(fam1, 63) === 0 && childIndexOf(fam1, 64) === 1 && childIndexOf(fam1, 127) === 1 && childIndexOf(fam1, 128) === 2 && childIndexOf(fam1, 254) === 2, 'a choice walks the children by weight (1, 1, 2: a quarter, a quarter, a half), the engine\'s less-or-equal');
  ok(childIndexOf(t.generator.shaderGroup.families.get(2), 200) === 0 && childIndexOf(undefined, 9) === 0, 'a family of one child, or none, always picks the first');
  // Weights 1 and 4: a choice of 51 is 51/255 = 0.2 of the sum of 5, exactly 1 in single precision, so it
  // lands on the first child's own weight: the engine's "less than or equal" keeps it, "less than" would not.
  const fam4 = t.generator.shaderGroup.families.get(4)!;
  ok(Math.fround(Math.fround(51 / 255) * 5) === 1 && childIndexOf(fam4, 51) === 0 && childIndexOf(fam4, 52) === 1 && childIndexOf(fam4, 50) === 0, 'a choice landing exactly on a child\'s weight takes that child (weights 1, 4: 51 is the first, 52 the second)');

  // The road and the river paint their own families and give every pole they paint its own place's choice.
  {
    const rs = { x: 116, z: 290 };
    const rn = 56;
    const roads = s.generate(rs.x, rs.z, rn, 2);
    t.generator.snapFamilies = false;
    const roadsRaw = s.generate(rs.x, rs.z, rn, 2);
    t.generator.snapFamilies = true;
    const counts = new Map<number, number>();
    let wrongChoice = 0;
    let strayChoice = 0;
    for (let j = 0; j < rn; j++) {
      for (let i = 0; i < rn; i++) {
        const k = j * rn + i;
        const fam = roadsRaw.shaders[k];
        const want = fam ? childChoiceAt(rs.x + i * 2, rs.z + j * 2) : 0;
        counts.set(fam, (counts.get(fam) ?? 0) + 1);
        if (roadsRaw.children[k] !== want || roads.children[k] !== want) {
          if (fam) wrongChoice++;
          else strayChoice++;
        }
      }
    }
    const road = counts.get(6) ?? 0;
    const bank = counts.get(7) ?? 0;
    const bed = counts.get(8) ?? 0;
    ok(road > 100 && bank > 20 && bed > 50, `the road and the river paint their own families over bare ground (${road} road poles, ${bank} bank, ${bed} riverbed)`);
    ok(wrongChoice === 0 && strayChoice === 0, `every pole a road or a river paints keeps its own place's choice, and every pole they leave bare keeps nought (${wrongChoice} painted and ${strayChoice} bare poles wrong)`);
  }

  const far = s.generate(140, 140, n, s.poleStep);
  const mudAt = ((160 - 140) / 2) * n + (160 - 140) / 2;
  ok(far.shaders[mudAt] === 5 && far.children[mudAt] === 0, 'a replace keeps the choice the pole had (nought, where nothing painted it before)');

  // A grid off the pole lattice cannot be laid on the pattern and is left as painted.
  const off = s.generate(1, 1, 12, 2);
  t.generator.snapFamilies = false;
  const offRaw = s.generate(1, 1, 12, 2);
  t.generator.snapFamilies = true;
  ok(off.shaders.every((v, k) => v === offRaw.shaders[k]), 'a grid whose poles are not on the lattice keeps its families as painted');
  ok(off.heights.every((v, k) => v === offRaw.heights[k]) && g.heights.every((v, k) => v === raw.heights[k]), 'the heights are the same either way');

  // The pass in place: corners first and copied from, never written.
  const d = { numberOfPoles: 6, startX: -4, startZ: -4, distanceBetweenPoles: 2, familyLattice: 8, snapX: null, snapZ: null, shaderMap: Int32Array.from({ length: 36 }, (_, k) => k + 1) };
  snapFamilies(d as unknown as Parameters<typeof snapFamilies>[0]);
  // Poles at -4, -2, 0, 2, 4, 6 along each axis: the corner of -4..2 is 0 (index 2), of 4 and 6 it is 8, which is off the grid.
  const row = (z: number) => Array.from(d.shaderMap.subarray(z * 6, z * 6 + 6));
  ok(JSON.stringify(row(0)) === JSON.stringify([15, 15, 15, 15, 5, 6]) && JSON.stringify(row(4)) === JSON.stringify([25, 26, 27, 28, 29, 30]), 'in place: each pole copies its corner, and a pole whose corner lies off the grid keeps its own');

  // A shader filter over sub-layers alone, with no affector of its own: the engine lays the families on
  // the pattern only before a layer that has affectors, so this one reads the rock disc as painted.
  {
    const tgen2 = form('TGEN', form('0000', ...groups, form('LYRS',
      layer('sand', rect(-100, -100, 100, 100), ascn(1)),
      layer('rock', circle(13, 13, 6), ascn(2)),
      layer('on rock, through a sub-layer', fshd(2), layer('exclude', aexc)),
    )));
    const t2 = parseTerrainTemplate(encode(form('PTAT', form('0015', chunk('DATA', header), tgen2, form('BAKE')))));
    const s2 = new TerrainSampler(t2);
    const st2 = s2.blockStart(0, 0);
    const g2 = s2.generate(st2.x, st2.z, n, s2.poleStep);
    t2.generator.snapFamilies = false;
    const raw2 = s2.generate(st2.x, st2.z, n, s2.poleStep);
    t2.generator.snapFamilies = true;
    let asPainted = 0;
    let asLaid = 0;
    for (let k = 0; k < n * n; k++) {
      if (g2.excluded[k] === (raw2.shaders[k] === 2 ? 1 : 0)) asPainted++;
      if (g2.excluded[k] === (g2.shaders[k] === 2 ? 1 : 0)) asLaid++;
    }
    ok(asPainted === n * n && asLaid < n * n, `a filter whose layer has only sub-layers reads the families as painted, not as laid on the pattern (${asPainted} of ${n * n} poles excluded as painted, ${asLaid} as laid)`);
  }
}

// ---------------------------------------------------------------- 2. the converted worlds

const worlds = groundWorlds();
if (!worlds.length) note(`no converted world under ${PACKS}: the checks against the client's own data are skipped`);
/** A world a check names that is not converted here is said so, rather than its check quietly not running. */
const named = (list: string[], what: string) => {
  if (worlds.length) for (const w of list) if (!worlds.includes(w)) note(`${w} is not converted under ${PACKS}: ${what} is not checked for it`);
  return list.filter((w) => worlds.includes(w));
};

for (const name of named(['tatooine', 'naboo'], 'every pole on its nearest corner\'s family')) {
  const world = loadWorld(name)!;
  const s = world.sampler;
  const gen = world.template.generator;
  const blocks = sampleBlocks(world.template, 48);
  const n = s.numberOfPoles;
  let poles = 0;
  let wrong = 0;
  let heightsDiffer = 0;
  let moved = 0;
  let msOn = 0;
  let msOff = 0;
  for (const b of blocks) {
    const st = s.blockStart(b.bx, b.bz);
    let t0 = performance.now();
    const g = s.generate(st.x, st.z, n, s.poleStep);
    msOn += performance.now() - t0;
    gen.snapFamilies = false;
    t0 = performance.now();
    const raw = s.generate(st.x, st.z, n, s.poleStep);
    msOff += performance.now() - t0;
    gen.snapFamilies = true;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        poles++;
        const ci = (cornerOf(st.x + i * 2) - st.x) / 2;
        const cj = (cornerOf(st.z + j * 2) - st.z) / 2;
        if (ci < n && cj < n && g.shaders[k] !== g.shaders[cj * n + ci]) wrong++;
        if (g.heights[k] !== raw.heights[k]) heightsDiffer++;
        if (g.shaders[k] !== raw.shaders[k]) moved++;
      }
    }
  }
  ok(wrong === 0, `${name}: over ${blocks.length} blocks every pole's family is its nearest 8 m corner's, ties up (${wrong} of ${poles} are not)`);
  ok(heightsDiffer === 0, `${name}: the heights are bit for bit the same with the pattern and without it (${heightsDiffer} poles differ)`);
  ok(moved > poles * 0.02, `${name}: the pattern moves ${(100 * moved / poles).toFixed(1)}% of the families`);
  note(`${name}: ${(msOn / blocks.length).toFixed(2)} ms a block with the pattern, ${(msOff / blocks.length).toFixed(2)} ms without (node, this machine, no ramps)`);
}

// ---------------------------------------------------------------- 3. the client's baked flora and heights

{
  const FLOOR: Record<string, number> = { tatooine: 98.4, talus: 82.3 };
  named(Object.keys(FLOOR), 'the floor on agreement with the client\'s baked flora');
  // The client's baked heights are packed at 0.03125 m, so a ground made as the client made it is within
  // half that step of them, and float rounding: 0.02 m. Talus is the one world whose ground does not yet
  // come out as the client's everywhere (its flora agrees only about 80% too, a gap of the generator's own,
  // out of this pass's reach), so it is pinned where it was measured, at the generator before this pass as
  // well as after: no more tiles past the rounding, none more past half a metre, and none worse.
  const PFPM_ROUNDING = 0.02;
  const PFPM_KNOWN: Record<string, { past: number; farPast: number; worst: number }> = { talus: { past: 99, farPast: 31, worst: 2.64 } };
  const pct = (a: number, b: number) => (b ? (100 * a) / b : 0);
  const tenth = (v: number) => Math.round(v * 10) / 10;
  for (const name of worlds) {
    const world = loadWorld(name)!;
    if (!world.template.flora.collidableMap) {
      note(`${name}: the terrain file (version ${world.template.version}) carries no baked flora map`);
      continue;
    }
    const blocks = sampleBlocks(world.template, FLOOR[name] !== undefined ? 200 : 64);
    const gen = world.template.generator;
    const on = bakedFlora(world, blocks)!;
    gen.snapFamilies = false;
    const off = bakedFlora(world, blocks)!;
    gen.snapFamilies = true;
    if (!on.tiles) {
      note(`${name}: no baked tile in the sampled blocks`);
      continue;
    }
    const wholeOn = pct(on.same, on.tiles);
    const wholeOff = pct(off.same, off.tiles);
    const line = `${name}: tiles both plant agree ${pct(off.agree, off.ours).toFixed(2)}% (${off.agree}/${off.ours}) -> ${pct(on.agree, on.ours).toFixed(2)}% (${on.agree}/${on.ours}); every tile, planted or bare, ${wholeOff.toFixed(2)}% -> ${wholeOn.toFixed(2)}% of ${on.tiles}`;
    if (FLOOR[name] !== undefined) ok(tenth(pct(on.agree, on.ours)) >= FLOOR[name], `${line}; at least ${FLOOR[name]}% where both plant`);
    ok(on.same >= off.same, `${line}; never worse with the pattern`);
    const sameHeights = on.heightErrors.length === off.heightErrors.length && on.heightErrors.every((e, k) => e === off.heightErrors[k]);
    ok(sameHeights, `${name}: our heights at the ${on.heightErrors.length} planted tiles are bit for bit the same with the pattern and without it`);
    const e = on.heightErrors;
    if (!world.template.flora.collidableHeightMap) {
      note(`${name}: the terrain file carries no baked heights (PFPM)`);
      continue;
    }
    if (!e.length) {
      note(`${name}: no tile the client's map plants in the sampled blocks, so its baked heights are not compared`);
      continue;
    }
    const worst = e.reduce((a, v) => Math.max(a, v), 0);
    const past = e.filter((v) => v > PFPM_ROUNDING).length;
    const farPast = e.filter((v) => v >= 0.5).length;
    const known = PFPM_KNOWN[name];
    if (known) ok(past <= known.past && farPast <= known.farPast && worst <= known.worst, `${name}: against the client's own baked heights (PFPM) at ${e.length} planted tiles, ${past} are past its rounding (at most ${known.past}), ${farPast} by half a metre or more (at most ${known.farPast}), the worst ${worst.toFixed(3)} m (at most ${known.worst})`);
    else ok(past === 0, `${name}: our ground is the client's own baked height (PFPM) to within its rounding at every one of ${e.length} planted tiles (the worst ${worst.toFixed(4)} m, ${past} past ${PFPM_ROUNDING} m)`);
  }
}

console.log(`\n${passed} checks passed`);
