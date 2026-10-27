// The planter reads its world through `FloraSource` (Map-maker II's fourth wave, DESIGN.md §2.6), which `SwgTerrain`
// satisfies as it stands: on every converted world on disk (SWG3JS_PACKS, else assets-private), twelve chunks spread over
// the map planted by today's `FloraPlanter` over today's `SwgTerrain` and by 0a86da7's (the third wave, out of git, its
// `flora.ts` over its own terrain), every planting's model, place, height, scale, matrix and kind by `Object.is`, two ways:
// no paint, and a paint whose flora tiles name a recipe that keeps every class (the flora layer laid and moving nothing).
// Mustafar, the one world whose trees are a baked map, is among them; a paint there that keeps everything keeps its baked
// trees to the bit.
//
// Run: node tools/swg/tests/floraSource.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { FloraPlanter } from '../../../src/world/flora.ts';
import { GroundPaint, PAINT_TILE } from '../../../src/swg/terrain/groundPaint.ts';
import { groundWorlds, PACKS, sampleBlocks } from './terrainHarness.ts';
import { loadOldMany } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

/** The third wave's commit, which the fourth wave's planter is held to. */
const W3 = '0a86da7';
const mods = await loadOldMany(['src/swg/terrain/trn.ts', 'src/swg/terrain/generator.ts', 'src/swg/terrain/groundPaint.ts', 'src/world/swgTerrain.ts', 'src/world/flora.ts'], ['src/world/swgTerrain.ts', 'src/world/flora.ts'], W3);
if (!mods) note(`git cannot hand ${W3} over here: the comparison is skipped`);
const OldSwg = mods?.[0].SwgTerrain as typeof SwgTerrain | undefined;
const OldPlanter = mods?.[1].FloraPlanter as typeof FloraPlanter | undefined;

/** A model for any appearance asked (one per appearance, shared by both planters), so every candidate plants and names its model. */
class AnyModels extends Map<string, unknown> {
  override get(key: string): unknown {
    if (!super.has(key)) super.set(key, { primitives: [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial(), cell: 0 }], radius: 1 + (key.length % 5), height: 4, def: undefined, key });
    return super.get(key);
  }
}

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

const worlds = groundWorlds();
if (!worlds.length) note(`no converted worlds under ${PACKS}: nothing to plant`);
let planted = 0;
let worldsHeld = 0;
for (const world of OldSwg && OldPlanter ? worlds : []) {
  const c = centreOf(world);
  const trnFile = join(PACKS, world, 'terrain.trn');
  if (!c || !existsSync(trnFile)) continue;
  const dir = join(PACKS, world);
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const trn = bytes('terrain.trn')!;
  const fetchBytes = async (f: string) => bytes(f);
  const old = await OldSwg!.create(trn, [], c.x, c.z, fetchBytes);
  // Twelve chunks spread over the inner map (the research's own sampling), in the game's 64 m buckets.
  const chunks = sampleBlocks(old.template as never, 12, 5150).map((b) => ({ cx: Math.floor(old.toGameX(b.bx * 64 + 32) / 64), cz: Math.floor(old.toGameZ(b.bz * 64 + 32) / 64) }));
  const models = new AnyModels();
  const oldP = new OldPlanter!(old as never, models as never);
  const want = chunks.map((k) => oldP.buildForChunk(k.cx, k.cz, (x, z) => old.heightAt(x, z), []).data);
  for (const way of ['none', 'keeping recipe'] as const) {
    let paint: GroundPaint | null = null;
    if (way === 'keeping recipe') {
      paint = new GroundPaint();
      paint.resolveRecipes([{}], old.template.generator.floraGroup, old.template.generator.radialGroup, world);
      // Every chunk's raw square painted with recipe 1 (which keeps every class) at full amount.
      for (const k of chunks) {
        const x0 = old.toSwgX((k.cx + 1) * 64);
        const z0 = old.toSwgZ(k.cz * 64);
        for (let tz = Math.floor((z0 - 8) / PAINT_TILE); tz <= Math.floor((z0 + 72) / PAINT_TILE); tz++) for (let tx = Math.floor((x0 - 8) / PAINT_TILE); tx <= Math.floor((x0 + 72) / PAINT_TILE); tx++) paint.floraTile(tx, tz, true)!.fill(1);
      }
      paint.boundsAgain();
    }
    const now = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { paint });
    const p = new FloraPlanter(now, models as never);
    let failed = '';
    let n = 0;
    chunks.forEach((k, i) => {
      const got = p.buildForChunk(k.cx, k.cz, (x, z) => now.heightAt(x, z), []).data;
      const w = want[i];
      n += got.n;
      if (got.n !== w.n) {
        failed ||= `chunk ${k.cx},${k.cz}: ${got.n} plantings against ${w.n}`;
        return;
      }
      for (let j = 0; j < got.n; j++) {
        if (got.models[j] !== w.models[j] || !Object.is(got.x[j], w.x[j]) || !Object.is(got.y[j], w.y[j]) || !Object.is(got.z[j], w.z[j]) || !Object.is(got.scale[j], w.scale[j]) || got.collidable[j] !== w.collidable[j]) failed ||= `chunk ${k.cx},${k.cz} planting ${j}`;
      }
      for (let j = 0; j < got.mats.length; j++) if (!Object.is(got.mats[j], w.mats[j])) failed ||= `chunk ${k.cx},${k.cz} matrix`;
    });
    planted += n;
    ok(!failed, `${world}, ${way === 'none' ? 'no paint' : 'a flora paint whose recipe keeps every class'}: twelve chunks' ${n} plantings by today's planter over SwgTerrain as a FloraSource are ${W3}'s by Object.is${failed ? ` (first apart: ${failed})` : ''}`);
    now.dispose();
  }
  old.dispose();
  worldsHeld++;
}
if (worlds.length && OldSwg) ok(worldsHeld > 0 && planted > 0, `${worldsHeld} worlds held, ${planted} plantings compared`);

console.log(`\nfloraSource: ${checks} checks passed`);
