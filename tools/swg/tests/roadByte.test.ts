// The road byte (Map-maker II's fourth wave, DESIGN.md §2.6): the generator marks a pole wherever a road's flat part or a
// river's bed reaches it (`ChunkData.roadMap`), at `clearFlora`'s two sites and whatever `roadsClearFlora` says, so the
// flora paint and the scatter brush keep off roads and rivers. Over the roads and rivers of every converted world on disk:
//   - the byte is set exactly at the sites that clear the four flora maps: each `clearFlora(d, i)` call is followed at once
//     by `d.roadMap[i] = 1`, and nowhere else is the map written (read as text);
//   - every pole whose flora a road clears (the four maps with `roadsClearFlora` on against off) is a marked pole, and the
//     byte is the same with the switch on and off;
//   - blocks with roads are found on the worlds that have them, and the worker's grid carries the same byte as the main
//     thread's;
//   - a block made with no paint is the generator's to the bit beside it (paintIdentity, floraPaintIdentity hold that).
//
// Run: node tools/swg/tests/roadByte.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AffectorRiver, AffectorRoad, TERRAIN_GROUND_TUNE, type Layer } from '../../../src/swg/terrain/generator.ts';
import { TerrainWorkerCore } from '../../../src/swg/terrain/workerCore.ts';
import { groundWorlds, loadWorld, PACKS, sampleBlocks } from './terrainHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

// The two sites, as text: the byte follows the clearing at both, and nothing else writes the map.
{
  const gen = readFileSync(new URL('../../../src/swg/terrain/generator.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const sites = gen.match(/if \(TERRAIN_GROUND_TUNE\.roadsClearFlora\) clearFlora\(d, i\);\n\s*d\.roadMap\[i\] = 1;/g) ?? [];
  const writes = gen.match(/roadMap\[[^\]]+\] =/g) ?? [];
  const calls = gen.match(/clearFlora\(d, i\);/g) ?? [];
  ok(sites.length === 2 && calls.length === 2 && writes.length === 2, "the byte is set at exactly the two sites that clear the flora (the road's flat part, the river's bed), right after the clearing, whatever the switch says");
  ok(/d\.roadMap\.fill\(0\);/.test(gen), 'and emptied at the start of every run, as the four flora maps are');
}

const worlds = groundWorlds();
if (!worlds.length) note(`no converted worlds under ${PACKS}: the world half is skipped`);
let withRoads = 0;
let marked = 0;
for (const name of worlds) {
  const w = loadWorld(name);
  if (!w) continue;
  const s = w.sampler;
  // The blocks under the world's own roads and rivers (a few points of each affector, its layers walked), else sampled.
  const onRoads: { bx: number; bz: number }[] = [];
  const walk = (l: Layer): void => {
    for (const a of l.affectors) {
      if (!(a instanceof AffectorRoad || a instanceof AffectorRiver) || !a.active) continue;
      const pts = (a as unknown as { points: { x: number; y: number }[] }).points;
      for (let k = 0; k < pts.length; k += Math.max(1, Math.floor(pts.length / 3))) onRoads.push({ bx: Math.floor(pts[k].x / 64), bz: Math.floor(pts[k].y / 64) });
    }
    for (const sub of l.layers) walk(sub);
  };
  for (const l of w.template.generator.layers) if (w.template.generator.runs(l)) walk(l);
  const blocks = [...onRoads, ...sampleBlocks(w.template, 100, 31337)];
  let found = 0;
  let poles = 0;
  let subset = true;
  let steady = true;
  let cleared = 0;
  const was = TERRAIN_GROUND_TUNE.roadsClearFlora;
  const roadBlocks: { x: number; z: number }[] = [];
  try {
    for (const b of blocks) {
      const st = s.blockStart(b.bx, b.bz);
      TERRAIN_GROUND_TUNE.roadsClearFlora = true;
      const on = s.generate(st.x, st.z, s.numberOfPoles, s.poleStep);
      if (!on.roads!.some((v) => v !== 0)) continue;
      TERRAIN_GROUND_TUNE.roadsClearFlora = false;
      const off = s.generate(st.x, st.z, s.numberOfPoles, s.poleStep);
      found++;
      if (roadBlocks.length < 2) roadBlocks.push(st);
      for (let i = 0; i < on.roads!.length; i++) {
        if (on.roads![i] !== off.roads![i]) steady = false;
        if (on.roads![i]) poles++;
        const differs = (['floraCollidable', 'floraNonCollidable', 'radialNear', 'radialFar'] as const).some((k) => on[k][i * 2] !== off[k][i * 2] || on[k][i * 2 + 1] !== off[k][i * 2 + 1]);
        if (differs) {
          cleared++;
          if (!on.roads![i]) subset = false;
        }
      }
      if (found >= 16) break;
    }
  } finally {
    TERRAIN_GROUND_TUNE.roadsClearFlora = was;
  }
  if (!found) continue;
  withRoads++;
  marked += poles;
  ok(steady && subset, `${name}: ${found} sampled blocks hold a road or a river, ${poles} poles marked; the byte is the same with roadsClearFlora on and off, and every one of the ${cleared} poles a road clears is marked`);
  // The worker's grid carries the same byte as the main thread's.
  const trn = readFileSync(join(PACKS, name, 'terrain.trn'));
  const core = new TerrainWorkerCore();
  core.handle({ type: 'init', trn: trn.buffer.slice(trn.byteOffset, trn.byteOffset + trn.byteLength) as ArrayBuffer, layers: [], bitmaps: [], ramps: [] });
  let same = true;
  for (const st of roadBlocks) {
    const here = s.generate(st.x, st.z, s.numberOfPoles, s.poleStep).roads!;
    const there = core.handle({ type: 'generate', id: 1, startX: st.x, startZ: st.z, n: s.numberOfPoles, step: s.poleStep }).message.roads as Uint8Array;
    if (!there || there.length !== here.length || here.some((v, i) => v !== there[i])) same = false;
  }
  ok(same, `${name}: the worker's grid carries the very road byte the main thread's does`);
}
if (worlds.length) ok(withRoads > 0 && marked > 0, `roads or rivers found on ${withRoads} worlds, ${marked} poles marked`);

console.log(`\nroadByte: ${checks} checks passed`);
