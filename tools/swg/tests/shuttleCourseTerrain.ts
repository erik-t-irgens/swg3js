// The shuttle's pilot flown over the real ground, by hand: every directed pair of rigged pads on the
// converted worlds, from the take-off's cut to the landing's join, over the ground the game's own
// terrain rules generate out of each world's `terrain.trn` (without the buildings' own layers, so the
// ground right by a pad is the unflattened ground). It is not in `test:all`: it generates kilometres of
// terrain and takes minutes.
//
// It passes when at least 280 of the pairs meet their join within the pilot's own tolerance
// (`RIDE_PILOT.joinTol`) and no flight goes under the ground further than 600 m from either pad (the
// game's own clips pass under the raw ground nearer than that at several pads). It prints the worst
// flights so the ones that miss can be looked at.
//
// Run: node tools/swg/tests/shuttleCourseTerrain.ts [pack]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flyCourse, quantile, rigPairs } from './courseFixtures.ts';
import { RIDE_PILOT } from '../../../src/world/shuttleCourse.ts';
import { attachBitmap, bitmapFiles, parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';

const packs = join(process.cwd(), 'assets-private');
const only = process.argv[2];

/** A world's ground in the game's own frame: the terrain sampler over its `terrain.trn`, mirrored and centred as the world is. */
const grounds = new Map<string, { sampler: TerrainSampler; at: (x: number, z: number) => number } | null>();
function groundOf(pack: string): { sampler: TerrainSampler; at: (x: number, z: number) => number } | null {
  if (grounds.has(pack)) return grounds.get(pack) ?? null;
  const layoutFile = join(packs, pack, 'layout.json');
  let out: { sampler: TerrainSampler; at: (x: number, z: number) => number } | null = null;
  if (existsSync(layoutFile)) {
    const layout = JSON.parse(readFileSync(layoutFile, 'utf8')) as { terrain?: string; center?: { x: number; z: number } };
    const trn = layout.terrain ? join(packs, pack, layout.terrain) : '';
    if (trn && existsSync(trn) && layout.center) {
      const template = parseTerrainTemplate(new Uint8Array(readFileSync(trn)));
      for (const b of bitmapFiles(template)) {
        const f = join(packs, pack, b.file);
        if (existsSync(f)) attachBitmap(template, b.familyId, new Uint8Array(readFileSync(f)));
      }
      const sampler = new TerrainSampler(template);
      const c = layout.center;
      out = { sampler, at: (x, z) => sampler.heightAt(c.x - x, c.z + z) };
    }
  }
  grounds.set(pack, out);
  return out;
}

const pairs = rigPairs(packs).filter((p) => !only || p.pack === only);
if (!pairs.length) {
  console.log('no converted world carries rigged shuttle pads: npm run swg -- travel @SWG assets-private --retail-only');
  process.exit(0);
}
const tol = RIDE_PILOT.joinTol;
const started = Date.now();
const rows: { label: string; f: ReturnType<typeof flyCourse>; within: boolean }[] = [];
let lastPack = '';
for (const p of pairs) {
  const g = groundOf(p.pack);
  if (!g) continue;
  if (p.pack !== lastPack) {
    // One world's ground at a time: its blocks are dropped between worlds to keep the memory down.
    grounds.get(lastPack)?.sampler.invalidateAll();
    lastPack = p.pack;
    console.log(`${p.pack}...`);
  }
  const f = flyCourse(p, g.at);
  const within = f.joined && Math.abs(f.error.across) <= tol.across && Math.abs(f.error.up) <= tol.up && f.error.heading <= tol.heading;
  rows.push({ label: p.label, f, within });
}
const joined = rows.filter((r) => r.within);
const under = rows.filter((r) => r.f.under > 0);
const n1 = (n: number) => n.toFixed(1);
console.log(`\n${rows.length} pairs flown over the real ground in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`met the join within ${tol.across} m across, ${tol.up} m up and ${tol.heading} degrees: ${joined.length} of ${rows.length}; flown round again: ${rows.filter((r) => r.f.goArounds).length}`);
for (const k of ['across', 'up', 'heading'] as const) {
  const xs = rows.filter((r) => r.f.joined).map((r) => Math.abs(r.f.error[k]));
  console.log(`|${k}| at the join: median ${n1(quantile(xs, 0.5))}, p90 ${n1(quantile(xs, 0.9))}, max ${n1(quantile(xs, 1))}`);
}
const clears = rows.map((r) => r.f.minClear).filter(Number.isFinite);
console.log(`least height over the ground beyond 600 m of a pad: min ${n1(quantile(clears, 0))} m, p10 ${n1(quantile(clears, 0.1))}, median ${n1(quantile(clears, 0.5))}`);
console.log(`highest over the higher pad: median ${n1(quantile(rows.map((r) => r.f.highest), 0.5))} m, p90 ${n1(quantile(rows.map((r) => r.f.highest), 0.9))}, max ${n1(quantile(rows.map((r) => r.f.highest), 1))}`);
console.log(`flown seconds, cut to join: median ${n1(quantile(rows.map((r) => r.f.seconds), 0.5))}, max ${n1(quantile(rows.map((r) => r.f.seconds), 1))}`);
console.log(`under the ground beyond 600 m of a pad: ${under.length} flights`);
for (const r of under.slice(0, 12)) console.log(`   ${r.label}: ${n1(r.f.under)} s, ${n1(r.f.deepest)} m at the deepest`);
const missed = rows.filter((r) => !r.within);
console.log(`outside the tolerance: ${missed.length}`);
for (const r of missed.slice(0, 20)) console.log(`   ${r.label}: across ${n1(r.f.error.across)}, up ${n1(r.f.error.up)}, heading ${n1(r.f.error.heading)}, round again ${r.f.goArounds}, ${r.f.joined ? 'joined' : 'never joined'}`);
const pass = joined.length >= rows.length - 14 && under.length === 0;
console.log(pass ? '\nPASS' : '\nFAIL');
process.exit(pass ? 0 : 1);
