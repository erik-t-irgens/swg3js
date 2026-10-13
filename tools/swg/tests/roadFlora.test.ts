// Roads and rivers clearing the flora (materials and ground pass, wave 5b).
//
// In the engine a road's flat part (within half its width times one less its height feather) and a river's bed
// (within its sub-width times one less its feather) set all four flora maps back to nothing: the trees, the
// plants, the grass and the far cards. Our port cleared none, so trees stood on every legacy world's roads. The
// rule is the engine's and sits behind `TERRAIN_GROUND_TUNE.roadsClearFlora` (on). The checks:
//
//   1. a terrain built in memory, every map painted everywhere first: a road and a river clear all four maps
//      over their flat part and bed and none over the feather or the bank; with the switch off, nothing clears
//   2. the converted worlds that carry live roads or rivers, on the blocks holding one of their points: the tiles
//      where our trees stand and the client's own baked map has none fall, the client's own trees are never lost,
//      and over the seven worlds the research measured the fall is about its own 42%
//
// Run: node tools/swg/tests/roadFlora.test.ts
import assert from 'node:assert/strict';
import { form, chunk, W, encode, ihdr } from './iffWriter.ts';
import { AffectorRiver, AffectorRoad, TERRAIN_GROUND_TUNE, type Layer } from '../../../src/swg/terrain/generator.ts';
import { parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { afd, header, rfam } from './radialFixture.ts';
import { bakedFlora, groundWorlds, loadWorld, PACKS } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- 1. a terrain built in memory

{
  const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
  const layer = (name: string, ...items: ReturnType<typeof form>[]) => form('LAYR', form('0003', ihdr(name), adta(), ...items));
  const rect = (x0: number, z0: number, x1: number, z1: number) => form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
  // A flora family of version 0008 (density 1, so every pole it reaches takes it), and the static affectors, version 0004.
  const ffam = new W().i32(1).str('trees').u8(0).u8(0).u8(0).f32(1).i32(0).i32(1).str('tree.apt').f32(1).i32(0).f32(0).f32(0).i32(0).i32(0).f32(1).f32(1).bytes();
  const afs = (tag: 'AFSC' | 'AFSN') => form(tag, form('0004', ihdr(tag), chunk('DATA', new W().i32(1).i32(1).i32(0).i32(0).f32(1).bytes())));
  const aroa = form('AROA', form('0003', ihdr('road'), form('DATA', chunk('DATA', new W().f32(-60).f32(20).f32(60).f32(20).f32(10).i32(0).i32(0).f32(0.5).bytes()))));
  const ariv = form('ARIV', form('0003', ihdr('river'), form('DATA', chunk('DATA', new W().f32(-60).f32(-20).f32(60).f32(-20).f32(16).i32(0).i32(0).i32(0).f32(0.4).f32(1).f32(0).i32(0).f32(2).f32(2).str('').bytes()))));
  const tgen = form('TGEN', form('0000', form('SGRP', form('0006')), form('FGRP', form('0008', chunk('FFAM', ffam))), form('RGRP', form('0004', rfam(1, 'grass', 1, ['radl_grass']))), form('EGRP', form('0002')), form('MGRP', form('0000')), form('MGRP', form('0000')), form('LYRS',
    layer('everything', rect(-100, -100, 100, 100), afs('AFSC'), afs('AFSN'), afd('AFDN', 1), afd('AFDF', 1)),
    layer('road', aroa),
    layer('river', ariv),
  )));
  const t = parseTerrainTemplate(encode(form('PTAT', form('0015', chunk('DATA', header()), tgen, form('BAKE')))));
  const road = t.generator.layers[1].affectors[0] as AffectorRoad;
  const river = t.generator.layers[2].affectors[0] as AffectorRiver;
  ok(road instanceof AffectorRoad && river instanceof AffectorRiver, 'the road and the river are read');
  const s = new TerrainSampler(t);
  const n = s.numberOfPoles;
  const scratch = { height: 0, distanceToCenter: 0, t: 0, length: 0 };
  const run = (clear: boolean) => {
    const keep = TERRAIN_GROUND_TUNE.roadsClearFlora;
    TERRAIN_GROUND_TUNE.roadsClearFlora = clear;
    const c = { flat: 0, flatCleared: 0, feather: 0, featherKept: 0, bed: 0, bedCleared: 0, bank: 0, bankKept: 0 };
    try {
      for (const [bx, bz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const st = s.blockStart(bx, bz);
        const g = s.generate(st.x, st.z, n, s.poleStep);
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) {
            const wx = st.x + i * 2;
            const wz = st.z + j * 2;
            const k = (j * n + i) * 2;
            const all = [g.floraCollidable[k], g.floraNonCollidable[k], g.radialNear[k], g.radialFar[k]];
            const none = all.every((v) => v === 0);
            const every = all.every((v) => v === 1);
            if (Math.abs(wx) > 55) continue;
            if (road.find(wx, wz, road.width * 0.5, scratch)) {
              const d = Math.abs(scratch.distanceToCenter);
              if (d <= road.width * 0.5 * (1 - road.featherDistance) - 0.01) {
                c.flat++;
                if (none) c.flatCleared++;
              } else if (d > road.width * 0.5 * (1 - road.featherDistance) + 0.01) {
                c.feather++;
                if (every) c.featherKept++;
              }
            }
            if (river.find(wx, wz, river.width * 0.5, scratch)) {
              const d = Math.abs(scratch.distanceToCenter);
              const sub = river.width * 0.5 * river.fractal.value1(scratch.t);
              if (d <= sub * (1 - river.featherDistance) - 0.01) {
                c.bed++;
                if (none) c.bedCleared++;
              } else if (d > sub * (1 - river.featherDistance) + 0.01 && d <= sub) {
                c.bank++;
                if (every) c.bankKept++;
              }
            }
          }
        }
      }
    } finally {
      TERRAIN_GROUND_TUNE.roadsClearFlora = keep;
    }
    return c;
  };
  const on = run(true);
  ok(on.flat > 20 && on.flatCleared === on.flat, `a road's flat part clears the trees, the plants, the grass and the far cards (${on.flatCleared} of ${on.flat} poles)`);
  ok(on.feather > 20 && on.featherKept === on.feather, `and its feather clears none of them (${on.featherKept} of ${on.feather} keep all four)`);
  ok(on.bed > 20 && on.bedCleared === on.bed, `a river's bed clears all four (${on.bedCleared} of ${on.bed})`);
  ok(on.bank > 5 && on.bankKept === on.bank, `and its bank none (${on.bankKept} of ${on.bank})`);
  const off = run(false);
  ok(off.flatCleared === 0 && off.bedCleared === 0, `with the switch off neither clears anything, the port of before (${off.flatCleared} and ${off.bedCleared})`);
}

// ---------------------------------------------------------------- 2. the converted worlds

/** The research's own figures on the line blocks (synth/roadclear.mjs): our trees where the client's bake has none, before and after. */
const MEASURED: Record<string, [number, number]> = { tatooine: [13, 10], naboo: [9, 7], corellia: [5, 5], dantooine: [9, 8], endor: [20, 9], yavin4: [63, 36], dathomir: [16, 3] };
const worlds = groundWorlds().filter((w) => w in MEASURED);
if (!worlds.length) note(`no converted world the research measured under ${PACKS}: only the terrain built in memory was checked`);
let before = 0;
let after = 0;
for (const name of worlds) {
  const world = loadWorld(name)!;
  if (!world.template.flora.collidableMap) {
    note(`${name}: no baked flora map to measure against`);
    continue;
  }
  const lines: (AffectorRoad | AffectorRiver)[] = [];
  const walk = (layers: readonly Layer[], on: boolean) => {
    for (const l of layers) {
      const live = on && l.active;
      for (const a of l.affectors) if ((a instanceof AffectorRoad || a instanceof AffectorRiver) && a.active && live) lines.push(a);
      walk(l.layers, live);
    }
  };
  walk(world.template.generator.layers, true);
  const seen = new Set<string>();
  const blocks: { bx: number; bz: number }[] = [];
  for (const a of lines) {
    for (const p of a.points) {
      const k = `${Math.floor(p.x / 64)},${Math.floor(p.y / 64)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      blocks.push({ bx: Math.floor(p.x / 64), bz: Math.floor(p.y / 64) });
    }
  }
  const capped = blocks.slice(0, 300);
  const keep = TERRAIN_GROUND_TUNE.roadsClearFlora;
  TERRAIN_GROUND_TUNE.roadsClearFlora = false;
  const off = bakedFlora(world, capped)!;
  TERRAIN_GROUND_TUNE.roadsClearFlora = true;
  const on = bakedFlora(world, capped)!;
  TERRAIN_GROUND_TUNE.roadsClearFlora = keep;
  const oursOnly = (r: typeof on) => r.tiles - r.same - (r.baked - r.agree);
  ok(oursOnly(on) <= oursOnly(off), `${name}: on the ${capped.length} blocks holding one of its ${lines.length} roads' and rivers' points, our trees where the client's map has none fall from ${oursOnly(off)} to ${oursOnly(on)} (the research: ${MEASURED[name].join(' to ')})`);
  ok(on.baked - on.ours === off.baked - off.ours, `${name}: and the client's own trees we lack stay ${off.baked - off.ours}: none of them is lost`);
  before += oursOnly(off);
  after += oursOnly(on);
}
if (worlds.length === Object.keys(MEASURED).length) ok(after < before * 0.7, `over the seven worlds our trees where the client's map has none fall from ${before} to ${after} (${Math.round((100 * (after - before)) / Math.max(1, before))}%; the research 135 to 78, -42%)`);

console.log(`\n${passed} passed`);
