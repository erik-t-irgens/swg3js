// Plants under a lake of ours (Map-maker II's fifth wave, DESIGN.md §2.7): the static flora's affectors know nothing of
// water, so the planter is handed `underOurWater` (`ourWater.ts`'s `underLakes` over the world's lakes of ours), true where a
// lake of ours stands more than `LAKE_TUNE.floraUnder` over the ground at a candidate, and null with no lake at all. Held, on
// converted worlds on disk (SWG3JS_PACKS, else assets-private): with the predicate null, twelve chunks planted by today's
// `FloraPlanter` are 49e5960's (out of git: this wave's start, whose planter had no predicate) to every planting's model,
// place, height, scale and matrix by `Object.is`; with a lake of ours over half of each chunk, exactly the plantings the rule
// says stand under it are dropped, and every other one is the one before, in its order. And the world hands the planter its
// rule wherever it makes one (text).
//
// Run: node tools/swg/tests/underOurWater.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { FloraPlanter } from '../../../src/world/flora.ts';
import { LAKE_TUNE, lakeTable, underLakes, type LakeTable } from '../../../src/world/ourWater.ts';
import { groundWorlds, PACKS, sampleBlocks } from './terrainHarness.ts';
import { loadOldMany, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const W4 = '49e5960';
const mods = await loadOldMany(['src/world/flora.ts'], ['src/world/flora.ts'], W4);
if (!mods) note(`git cannot hand ${W4} over here: the day-one comparison is skipped`);
const OldPlanter = mods?.[0].FloraPlanter as typeof FloraPlanter | undefined;

class AnyModels extends Map<string, unknown> {
  override get(key: string): unknown {
    if (!super.has(key)) super.set(key, { primitives: [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial(), cell: 0 }], radius: 1 + (key.length % 5), height: 4, def: undefined, key });
    return super.get(key);
  }
}

type Data = { n: number; x: Float32Array | Float64Array; z: Float32Array | Float64Array; y: Float32Array | Float64Array; mats: Float32Array; models?: unknown[] };
/** A planting's every number, by `Object.is`. */
function sameAt(a: Data, i: number, b: Data, j: number): boolean {
  if (!Object.is(a.x[i], b.x[j]) || !Object.is(a.y[i], b.y[j]) || !Object.is(a.z[i], b.z[j])) return false;
  for (let k = 0; k < 16; k++) if (!Object.is(a.mats[i * 16 + k], b.mats[j * 16 + k])) return false;
  return true;
}

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

let worlds = 0;
let planted = 0;
let dropped = 0;
// Four planted worlds where they are converted (a wood, a jungle, the towns' world, a desert), else the first four there are.
const preferred = ['naboo', 'yavin4', 'corellia', 'tatooine'];
const all = groundWorlds();
const chosen = preferred.filter((w) => all.includes(w));
for (const world of OldPlanter ? (chosen.length ? chosen : all) : []) {
  if (worlds >= 4) break;
  const c = centreOf(world);
  const dir = join(PACKS, world);
  if (!c || !existsSync(join(dir, 'terrain.trn'))) continue;
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const swg = await SwgTerrain.create(bytes('terrain.trn')!, [], c.x, c.z, async (f) => bytes(f));
  const chunks = sampleBlocks(swg.template as never, 12, 9091).map((b) => ({ cx: Math.floor(swg.toGameX(b.bx * 64 + 32) / 64), cz: Math.floor(swg.toGameZ(b.bz * 64 + 32) / 64) }));
  const models = new AnyModels();
  const oldP = new OldPlanter!(swg as never, models as never);
  const now = new FloraPlanter(swg, models as never);
  const heightAt = (x: number, z: number) => swg.heightAt(x, z);
  let n = 0;
  let failed = '';
  // A lake of ours over the west half of every chunk asked, its surface 2 m over the chunk's middle ground: deep where the
  // ground is low, shallow or dry where it rises.
  const lakes: LakeTable[] = chunks.map((k, i) => {
    const x0 = k.cx * 64;
    const z0 = k.cz * 64;
    const h = swg.heightAt(x0 + 32, z0 + 32) + 2;
    return lakeTable({ id: `l${i}`, kind: 'lake', h, points: [[swg.toSwgX(x0 - 1), swg.toSwgZ(z0 - 1)], [swg.toSwgX(x0 + 32), swg.toSwgZ(z0 - 1)], [swg.toSwgX(x0 + 32), swg.toSwgZ(z0 + 65)], [swg.toSwgX(x0 - 1), swg.toSwgZ(z0 + 65)]], shader: null }, (x) => swg.toGameX(x), (z) => swg.toGameZ(z));
  });
  for (const k of chunks) {
    const a = oldP.buildForChunk(k.cx, k.cz, heightAt, []).data as unknown as Data;
    now.underOurWater = null;
    const b = now.buildForChunk(k.cx, k.cz, heightAt, []).data as unknown as Data;
    if (a.n !== b.n) failed ||= `chunk ${k.cx},${k.cz}: ${b.n} plantings where ${a.n}`;
    for (let i = 0; i < Math.min(a.n, b.n); i++) if (!sameAt(a, i, b, i)) failed ||= `chunk ${k.cx},${k.cz} planting ${i}`;
    n += a.n;
    // Under the lakes: the rule's own drops, the rest as before and in order.
    now.underOurWater = (x, z, ground) => underLakes(lakes, x, z, ground);
    const u = now.buildForChunk(k.cx, k.cz, heightAt, []).data as unknown as Data;
    let j = 0;
    for (let i = 0; i < a.n; i++) {
      const under = underLakes(lakes, a.x[i], a.z[i], heightAt(a.x[i], a.z[i]));
      if (under) {
        dropped++;
        continue;
      }
      if (j >= u.n || !sameAt(a, i, u, j)) {
        failed ||= `chunk ${k.cx},${k.cz}: planting ${i} kept wrongly`;
        break;
      }
      j++;
    }
    if (j !== u.n) failed ||= `chunk ${k.cx},${k.cz}: ${u.n - j} plantings under the lake kept`;
  }
  ok(!failed, `${world}: with no lake of ours twelve chunks' ${n} plantings are ${W4}'s, and under a lake exactly the plantings the rule says are dropped${failed ? ` (${failed})` : ''}`);
  planted += n;
  worlds++;
}
if (OldPlanter && !worlds) note(`no converted worlds under ${PACKS}: the planter is not compared`);
else if (worlds) ok(planted > 0 && dropped > 0, `${planted} plantings over ${worlds} worlds held, ${dropped} of them under a lake of ours (deeper than ${LAKE_TUNE.floraUnder} m) dropped`);

{
  const world = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/this\.flora = new FloraPlanter\(swg, byAppearance\);\s*\/\/[^\n]*\n\s*this\.flora\.underOurWater = this\.underOurWaterRule\(\);/.test(world), 'the converted world\'s planter is handed the rule as it is made');
  ok(/this\.flora = new FloraPlanter\(df\.source, df\.models\);\s*this\.flora\.underOurWater = this\.underOurWaterRule\(\);/.test(world), "and a real-elevation world's");
  ok(/if \(this\.flora\) this\.flora\.underOurWater = this\.underOurWaterRule\(\);/.test(world), 'and every landing of lakes hands it again');
  ok(/if \(!tables\.length\) return null;\s*return \(x, z, ground\) => underLakes\(tables, x, z, ground\);/.test(world), 'which is null with no lake of ours at all');
  const flora = readFileSync(join(REPO, 'src/world/flora.ts'), 'utf8');
  ok(/!\(under && under\(p\.x, p\.z, heightAt\(p\.x, p\.z\)\)\)/.test(flora), 'the planter asks it of each candidate with the ground under it');
}

console.log(`underOurWater: ${checks} checks passed`);
