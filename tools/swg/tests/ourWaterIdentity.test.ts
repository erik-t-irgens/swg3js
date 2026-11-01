// The proof that no water file is today's water (Map-maker II's fifth wave, DESIGN.md §8's guards): `swgTerrain.ts` and
// `terrain.ts` as they stood at 49e5960 -- the code this wave began from, not the pass's start (e6c2578), since both files
// moved in the four waves and the map fixes between, and this wave is held to what it changed -- loaded out of git beside
// today's, and on every converted world on disk (SWG3JS_PACKS, else assets-private) the water tables (each name, height and
// point), `waterAt` at 2,000 points and `waterTableAt` at the same, by `Object.is` and by the table's place in the list, two
// ways: no water file (nothing set) and an empty one (`setOurWater([])`). On a world with no converted terrain
// `Terrain.waterHeightAt` at 2,000 points, no lake and an empty list. And `World.applySwgWater` read as text: with the lines
// that only a lake of ours reaches (`w.ours`) taken back out, it is 49e5960's to the character, so a client table is made the
// same body with the same look and the same program key.
//
// Run: node tools/swg/tests/ourWaterIdentity.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { Terrain } from '../../../src/world/terrain.ts';
import type { PlanetDef } from '../../../src/data/planets.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';
import { loadOldMany, oldTexts, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

/** This wave's start: the code the lakes of ours were added to. */
const W4 = '49e5960';
const mods = await loadOldMany(['src/world/swgTerrain.ts', 'src/world/terrain.ts'], ['src/world/swgTerrain.ts', 'src/world/terrain.ts'], W4);
if (!mods) note(`git cannot hand ${W4} over here: the day-one comparison is skipped`);
const OldSwg = mods?.[0].SwgTerrain as typeof SwgTerrain | undefined;
const OldTerrain = mods?.[1].Terrain as typeof Terrain | undefined;

const points: { x: number; z: number }[] = [];
for (let i = 0; i < 2000; i++) points.push({ x: ((i * 7919) % 8000) - 4000 + 0.37, z: ((i * 104729) % 8000) - 4000 - 0.61 });

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

let worlds = 0;
let tables = 0;
for (const world of OldSwg ? groundWorlds() : []) {
  const c = centreOf(world);
  const dir = join(PACKS, world);
  if (!c || !existsSync(join(dir, 'terrain.trn'))) continue;
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const trn = bytes('terrain.trn')!;
  const fetchBytes = async (f: string) => bytes(f);
  const old = await OldSwg!.create(trn, [], c.x, c.z, fetchBytes);
  let failed = '';
  for (const way of ['no file', 'an empty file'] as const) {
    const now = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes);
    if (way === 'an empty file') now.setOurWater([]);
    if (old.waterTables.length !== now.waterTables.length) failed ||= `${way}: ${now.waterTables.length} tables where ${old.waterTables.length}`;
    old.waterTables.forEach((a, i) => {
      const b = now.waterTables[i];
      if (!b || a.name !== b.name || !Object.is(a.height, b.height) || a.shader !== b.shader || a.waterType !== b.waterType || a.points.length !== b.points.length || a.points.some((p, k) => !Object.is(p.x, b.points[k].x) || !Object.is(p.z, b.points[k].z))) failed ||= `${way}: table ${i}`;
      if (b && (b as { cells?: unknown }).cells) failed ||= `${way}: a client table carries an index`;
    });
    for (const p of points) {
      if (!Object.is(old.waterAt(p.x, p.z), now.waterAt(p.x, p.z))) failed ||= `${way}: waterAt ${p.x},${p.z}`;
      const ta = old.waterTableAt(p.x, p.z);
      const tb = now.waterTableAt(p.x, p.z);
      if ((ta ? old.waterTables.indexOf(ta) : -1) !== (tb ? now.waterTables.indexOf(tb) : -1)) failed ||= `${way}: waterTableAt ${p.x},${p.z}`;
    }
  }
  ok(!failed, `${world}: ${old.waterTables.length} water tables, waterAt and waterTableAt at ${points.length} points are ${W4}'s, with no water file and an empty one${failed ? ` (${failed})` : ''}`);
  worlds++;
  tables += old.waterTables.length;
}
if (OldSwg && !worlds) note(`no converted worlds under ${PACKS}: the converted half is skipped`);
else if (worlds) ok(tables > 0, `${worlds} worlds and ${tables} client tables held`);

if (OldTerrain) {
  // A world with no converted terrain: the planet's own level, as it always was.
  for (const level of [null, -5, 12.25]) {
    const planet = { id: 'dem-test', seed: 3, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: level === null ? null : { level } } as unknown as PlanetDef;
    const a = new OldTerrain(planet);
    const b = new Terrain(planet);
    let same = true;
    for (const p of points) if (!Object.is(a.waterHeightAt(p.x, p.z), b.waterHeightAt(p.x, p.z)) || b.waterTableAt(p.x, p.z) !== null) same = false;
    ok(same, `a world with no converted terrain and no lake of ours (water ${level === null ? 'none' : `at ${level} m`}): waterHeightAt at ${points.length} points is ${W4}'s, and no table is named`);
  }
}

{
  // applySwgWater as text: with what only a lake of ours reaches taken back out, it is 49e5960's.
  const methodOf = (text: string): string => {
    const at = text.indexOf('  private applySwgWater(swg: SwgTerrain): void {');
    assert.ok(at >= 0, 'applySwgWater is where it was');
    let depth = 0;
    for (let i = text.indexOf('{', at); i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) return text.slice(at, i + 1);
    }
    return '';
  };
  const old = oldTexts(['src/world/world.ts'], W4)?.get('src/world/world.ts');
  const now = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8').replace(/\r\n/g, '\n');
  if (!old) note(`git cannot hand ${W4}'s world.ts over: applySwgWater is not compared`);
  else {
    const before = methodOf(old);
    const after = methodOf(now)
      .replace('    this.ourLakeBodies.clear();\n', '')
      .replace(
        "      // Lakes are triangulated outlines with no interior vertices, so they ripple but do not swell. A lake of ours\n      // (Map-maker II's fifth wave) wears its look of its own over its shader's; every client table's look is today's.\n      const look = w.ours ? lookOver(bodies.lookFor(w.shader || null, planet), w.ours.look) : bodies.lookFor(w.shader || null, planet);\n      const body = bodies.add(mesh, false, look, 'lake');\n",
        "      // Lakes are triangulated outlines with no interior vertices, so they ripple but do not swell.\n      const body = bodies.add(mesh, false, bodies.lookFor(w.shader || null, planet), 'lake');\n",
      )
      .replace('      if (w.ours) this.ourLakeBodies.set(w.ours.id, { mesh, body, table: w });\n', '');
    ok(before.length > 1000 && after === before, `World.applySwgWater, its lake-of-ours lines taken back out, is ${W4}'s to the character: a client table is the same body, look and program`);
  }
}

console.log(`ourWaterIdentity: ${checks} checks passed`);
