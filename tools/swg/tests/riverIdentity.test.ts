// The proof that no river is the fifth wave's water (Map-maker II's sixth wave, DESIGN.md §9's day-one guard): the code
// this wave began from (7f32eb1: `swgTerrain.ts`, `terrain.ts` and `ourWater.ts`, and the bake's `navgrid.mjs` and
// `finalnames.mjs`) loaded out of git beside today's, and held to it by `Object.is` and to the byte:
//   - on every converted world on disk, with two lakes of ours set on both (by each one's own `lakeTable`), `waterAt` and
//     `waterTableAt` at 2,000 points, with no river set and with an empty list (`setRivers([])`);
//   - on a world with no converted terrain, the same two lakes: `waterHeightAt` and `waterTableAt`, with no river;
//   - the bake of a world whose terrain names no river (umbra, floratest), with no edit file and with a water file of lakes,
//     is 7f32eb1's to the byte; rivertest's, its terrain's rivers left out, is too;
//   - every grid on disk keys as 7f32eb1 keyed it (each one's own `gridEditsOf` with the pack folder), but for the two test
//     worlds whose terrain has wet rivers, which key anew and so are baked again;
//   - and `createWaterMaterial` handed no wind is 7f32eb1's to the character but for its options' one new field, so a lake
//     or a sea is the same material with the same shared wind.
//
// Run: node tools/swg/tests/riverIdentity.test.ts
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { Terrain } from '../../../src/world/terrain.ts';
import { lakeTable, type LakeTable } from '../../../src/world/ourWater.ts';
import { readWaterRow, waterFileText, type WaterLakeRow } from '../../../src/world/editFiles/waterFile.ts';
import type { PlanetDef } from '../../../src/data/planets.ts';
import { buildNavGrid, gridEditsOf, walkThroughTemplates } from '../navgrid.mjs';
import { layoutKeyOf } from '../finalnames.mjs';
import { groundWorlds, PACKS } from './terrainHarness.ts';
import { loadOldMany, oldTexts, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string): void => console.log(`note ${s}`);

/** This wave's start: the fifth wave's commit. */
const W5 = '7f32eb1';
const mods = await loadOldMany(['src/world/swgTerrain.ts', 'src/world/terrain.ts', 'src/world/ourWater.ts'], ['src/world/swgTerrain.ts', 'src/world/terrain.ts', 'src/world/ourWater.ts'], W5);
if (!mods) note(`git cannot hand ${W5} over here: the day-one comparison is skipped`);
const OldSwg = mods?.[0].SwgTerrain as typeof SwgTerrain | undefined;
const OldTerrain = mods?.[1].Terrain as typeof Terrain | undefined;
const oldLakeTable = mods?.[2].lakeTable as typeof lakeTable | undefined;

const points: { x: number; z: number }[] = [];
for (let i = 0; i < 2000; i++) points.push({ x: ((i * 7919) % 1200) - 600 + 0.37, z: ((i * 104729) % 1200) - 600 - 0.61 });

/** Two lakes of ours about a raw point: a deep one and a shallow one beside it. */
function lakesAbout(cx: number, cz: number): WaterLakeRow[] {
  const sq = (x0: number, z0: number, s: number): [number, number][] => [[x0, z0], [x0 + s, z0], [x0 + s, z0 + s], [x0, z0 + s]];
  const a = readWaterRow({ id: 'deep', kind: 'lake', h: 140, points: sq(cx - 150, cz - 150, 200), shader: null });
  const b = readWaterRow({ id: 'shallow', kind: 'lake', h: -3.5, points: sq(cx + 60, cz - 40, 180), shader: 'wter_spec' });
  assert.ok(typeof a !== 'string' && typeof b !== 'string');
  return [a as WaterLakeRow, b as WaterLakeRow];
}

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

// --- every converted world, with lakes of ours and no river ---
{
  let worlds = 0;
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
    const rows = lakesAbout(c.x, c.z);
    old.setOurWater(rows.map((r) => oldLakeTable!(r, (x) => old.toGameX(x), (z) => old.toGameZ(z)) as never));
    let failed = '';
    for (const way of ['no river', 'an empty list'] as const) {
      const now = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes);
      now.setOurWater(rows.map((r) => lakeTable(r, (x) => now.toGameX(x), (z) => now.toGameZ(z)) as never));
      if (way === 'an empty list') now.setRivers([]);
      if (now.rivers !== null) failed ||= `${way}: a river list stands`;
      if (old.waterTables.length !== now.waterTables.length) failed ||= `${way}: ${now.waterTables.length} tables where ${old.waterTables.length}`;
      for (const p of points) {
        if (!Object.is(old.waterAt(p.x, p.z), now.waterAt(p.x, p.z))) failed ||= `${way}: waterAt ${p.x},${p.z}`;
        const ta = old.waterTableAt(p.x, p.z);
        const tb = now.waterTableAt(p.x, p.z);
        if ((ta ? old.waterTables.indexOf(ta) : -1) !== (tb ? now.waterTables.indexOf(tb) : -1) || (ta && tb && !Object.is(ta.height, tb.height))) failed ||= `${way}: waterTableAt ${p.x},${p.z}`;
      }
      now.dispose();
    }
    old.dispose();
    ok(!failed, `${world}: with two lakes of ours, waterAt and waterTableAt at ${points.length} points are ${W5}'s, with no river and an empty list${failed ? ` (${failed})` : ''}`);
    worlds++;
  }
  if (OldSwg && !worlds) note(`no converted worlds under ${PACKS}: the converted half is skipped`);
}

// --- a world with no converted terrain ---
if (OldTerrain && oldLakeTable) {
  const planet = { id: 'dem-test', seed: 3, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: { level: -1 } } as unknown as PlanetDef;
  const a = new OldTerrain(planet);
  const b = new Terrain(planet);
  const rows = lakesAbout(0, 0);
  for (const r of rows) {
    (a.lakes as LakeTable[]).push(oldLakeTable(r, (x) => -x, (z) => z) as LakeTable);
    b.lakes.push(lakeTable(r, (x) => -x, (z) => z));
  }
  let same = true;
  for (const p of points) {
    if (!Object.is(a.waterHeightAt(p.x, p.z), b.waterHeightAt(p.x, p.z))) same = false;
    const ta = a.waterTableAt(p.x, p.z);
    const tb = b.waterTableAt(p.x, p.z);
    if ((ta ? a.lakes.indexOf(ta as LakeTable) : -1) !== (tb ? b.lakes.indexOf(tb as LakeTable) : -1)) same = false;
  }
  ok(same && b.rivers.length === 0 && b.riverList().length === 0, `a world with no converted terrain, two lakes of ours and no river: waterHeightAt and waterTableAt at ${points.length} points are ${W5}'s`);
}

// --- the bake and its key ---
const wt = walkThroughTemplates();
const PLAIN = { world: 'none', texts: { heights: null, water: null, world: null, story: null } };
type Planes = { nibbles: Uint8Array; coarse: Uint8Array; edges: Uint8Array; clear: Uint8Array };
const planes = (g: Planes): Buffer => Buffer.concat([g.nibbles, g.coarse, g.edges, g.clear].map((a) => Buffer.from(a)));

/** 7f32eb1's navgrid.mjs and finalnames.mjs, their relative imports, their dynamic import and their own place at today's tree. */
async function oldBake(): Promise<{ buildNavGrid: typeof buildNavGrid; gridEditsOf: typeof gridEditsOf; layoutKeyOf: typeof layoutKeyOf; done: () => void } | null> {
  const files = ['tools/swg/navgrid.mjs', 'tools/swg/finalnames.mjs'];
  const texts = oldTexts(files, W5);
  if (!texts) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'mm2-w6-old-'));
  for (const f of files) {
    const from = resolve(REPO, f, '..');
    const point = (p: string): string => pathToFileURL(resolve(from, p)).href;
    const text = texts
      .get(f)!
      .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${point(p)}'`)
      .replace(/import\('(\.\.?\/[^']+)'\)/g, (_m, p: string) => `import('${point(p)}')`)
      .replace(/import\.meta\.url/g, `'${pathToFileURL(resolve(REPO, f)).href}'`);
    writeFileSync(join(tmp, f.split('/').pop()!), text);
  }
  const nav = await import(pathToFileURL(join(tmp, 'navgrid.mjs')).href);
  const fin = await import(pathToFileURL(join(tmp, 'finalnames.mjs')).href);
  return { buildNavGrid: nav.buildNavGrid, gridEditsOf: nav.gridEditsOf, layoutKeyOf: fin.layoutKeyOf, done: () => rmSync(tmp, { recursive: true, force: true }) };
}

const old = await oldBake();
try {
  if (!old) note(`git could not hand over ${W5}'s bake: the day-one bake is not compared here`);
  else {
    let compared = 0;
    for (const w of ['umbra', 'floratest']) {
      const dir = join(PACKS, w);
      const c = centreOf(w);
      if (!existsSync(join(dir, 'nav.json')) || !c) continue;
      const a = await old.buildNavGrid(dir, { walkThrough: wt, edits: PLAIN });
      const b = await buildNavGrid(dir, { walkThrough: wt, edits: PLAIN });
      ok(planes(a).equals(planes(b)), `${w} (its terrain names no river): today's bake with no edit file is ${W5}'s to the byte (${planes(b).length} bytes)`);
      const lakes = { world: w, texts: { ...PLAIN.texts, water: waterFileText(w, lakesAbout(c.x, c.z)) } };
      const la = await old.buildNavGrid(dir, { walkThrough: wt, edits: lakes });
      const lb = await buildNavGrid(dir, { walkThrough: wt, edits: lakes });
      ok(planes(la).equals(planes(lb)) && !planes(lb).equals(planes(b)), `${w}: and over a water file of two lakes and no river, ${W5}'s to the byte (and not the plain bake)`);
      compared++;
    }
    {
      const dir = join(PACKS, 'rivertest');
      if (existsSync(join(dir, 'nav.json'))) {
        const a = await old.buildNavGrid(dir, { walkThrough: wt, edits: PLAIN });
        const b = await buildNavGrid(dir, { walkThrough: wt, edits: PLAIN, soeRivers: false });
        ok(planes(a).equals(planes(b)), `rivertest: today's bake with its terrain's own rivers left out is ${W5}'s to the byte`);
        compared++;
      }
    }
    if (!compared) note('no small converted world: the day-one bake is not compared');
    let keys = 0;
    const moved: string[] = [];
    // With no edit files read (`null` for the folder, on both sides): what this compares is the rivers' stamp, and the
    // owner's own edit files in this checkout, made live and read by code that has grown since (the race drawer's first wave
    // met his new Tatooine map edits here), are no part of it.
    for (const name of existsSync(PACKS) ? readdirSync(PACKS) : []) {
      const dir = join(PACKS, name);
      if (!existsSync(join(dir, 'nav.json')) || !existsSync(join(dir, 'layout.json'))) continue;
      const k0 = old.layoutKeyOf(dir, wt, old.gridEditsOf(name, null, dir));
      const k1 = layoutKeyOf(dir, wt, gridEditsOf(name, null, dir));
      if (k0 !== k1) moved.push(name);
      keys++;
    }
    ok(keys > 0 && moved.sort().join() === ['rivertest', 'watertabletest'].filter((w) => existsSync(join(PACKS, w, 'nav.json'))).join(), `of ${keys} grids on disk only the worlds whose terrain has wet rivers key anew (${moved.join(', ') || 'none'}); every other keys as ${W5} keyed it`);
  }
} finally {
  old?.done();
}

// --- the water material handed no wind ---
{
  const before = oldTexts(['src/world/water.ts'], W5)?.get('src/world/water.ts');
  if (!before) note(`git cannot hand ${W5}'s water.ts over: createWaterMaterial is not compared`);
  else {
    const now = readFileSync(join(REPO, 'src/world/water.ts'), 'utf8').replace(/\r\n/g, '\n');
    const fn = (t: string): string => {
      const at = t.indexOf('export function createWaterMaterial(');
      let depth = 0;
      for (let i = t.indexOf('{', t.indexOf(')', at) + 1); i < t.length; i++) {
        if (t[i] === '{') depth++;
        else if (t[i] === '}' && --depth === 0) return t.slice(at, i + 1);
      }
      return '';
    };
    const a = fn(before);
    const b = fn(now)
      .replace('; wind?: { value: THREE.Vector2 } }', ' }')
      .replace('uWind: opts.wind ?? WATER_WIND,', 'uWind: WATER_WIND,');
    ok(a.length > 1000 && a === b, `createWaterMaterial, its wind option taken back out, is ${W5}'s to the character: handed none, a body holds the weather's shared wind as it did`);
  }
}

console.log(`riverIdentity: ${checks} checks passed`);
