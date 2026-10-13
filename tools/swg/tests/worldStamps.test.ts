// A world's manifest holds what the snapshot makes, and every model it names is the material format it is
// stamped with (materials and ground pass; `worldManifest.mjs`).
//
// The snapshot read the manifest it found and kept every category in it, so the old `pack` command's
// `structures`, `rocks`, `debris` and `vaporators` rode along under a `materialFormat` the run never made true of
// them: five of Tatooine's models kept a look from before format 6 through the pass's one conversion and nothing
// asked for them. The checks:
//
//   1. the rule: only `layout` and `flora` survive a snapshot, in that order; any other category is stray
//   2. the converter: the snapshot cuts the manifest to them before it writes, and `status` asks for a snapshot
//      while a world's manifest carries a stray category
//   3. every converted world (SWG3JS_PACKS, else assets-private): every textured model the snapshot's own
//      categories name -- each entry's own file and its lower levels' -- carries the format's stamp in its GLB
//      (`glbSpecStamped`), and a world still carrying a stray category is said, with what is in it, rather than
//      failed: `status` asks for the snapshot that takes it out. A world with a stray category but no layout,
//      which the outposts would draw from it, is said too: there it is not stray.
//
// Run: node tools/swg/tests/worldStamps.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { glbSpecStamped } from '../glb.mjs';
import { glbsNamed, SNAPSHOT_CATEGORIES, snapshotCategories, strayCategories } from '../worldManifest.mjs';
import { glbJsonOf, PACKS } from './materialsHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- 1. the rule

ok(SNAPSHOT_CATEGORIES.join(',') === 'layout,flora', 'a snapshot makes the layout and the flora');
const old = { categories: { rocks: [{ id: 'r' }], debris: [], flora: [{ id: 'f' }], vaporators: [], structures: [{ id: 's' }], layout: [{ id: 'l' }] } };
ok(strayCategories(old).join(',') === 'debris,rocks,structures,vaporators', 'any other category is stray, sorted');
const cut = snapshotCategories(old.categories);
ok(Object.keys(cut).join(',') === 'layout,flora' && cut.layout === old.categories.layout && cut.flora === old.categories.flora, 'and a snapshot keeps its own two, as they stood, and nothing else');
ok(strayCategories({ categories: { layout: [], flora: [] } }).length === 0 && strayCategories({}).length === 0, 'a manifest of the snapshot\'s own carries nothing stray');
const entry = { id: 'x', file: 'x.glb', lods: [{ level: 1, file: 'lod/x_1.glb' }, { level: 2 }], source: 'appearance/x.apt' };
ok(glbsNamed(entry).join(',') === 'x.glb,lod/x_1.glb', 'every model an entry names, its own and its lower levels\'');

// ---------------------------------------------------------------- 2. the converter

const cli = readFileSync(new URL('../cli.mjs', import.meta.url), 'utf8');
const snap = cli.slice(cli.indexOf('async function snapshotPlanet'), cli.indexOf('function mobilesCodeStamp'));
ok(/manifest\.categories = snapshotCategories\(manifest\.categories\);/.test(snap) && snap.indexOf('snapshotCategories(') < snap.indexOf('manifest.materialFormat = MATERIAL_FORMAT'), 'the snapshot cuts the manifest to its own categories before it stamps the format over it');
ok(/else if \(objects && strayCategories\(manifest\)\.length\) need\(`snapshot <swg-dir> \$\{planet\}/.test(cli), 'status asks for the snapshot while a world\'s manifest carries a stray category');

// ---------------------------------------------------------------- 3. the packs

const worlds = existsSync(PACKS) ? readdirSync(PACKS).filter((w) => existsSync(join(PACKS, w, 'manifest.json')) && existsSync(join(PACKS, w, 'terrain.trn'))).sort() : [];
if (!worlds.length) note(`no converted world under ${PACKS}: only the rule and the converter were checked`);
let models = 0;
for (const name of worlds) {
  const dir = join(PACKS, name);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (!(Number(manifest.materialFormat ?? 1) >= 6)) {
    note(`${name}: stamped at material format ${manifest.materialFormat ?? 1}: status asks for its snapshot`);
    continue;
  }
  const own = new Set<string>();
  for (const k of SNAPSHOT_CATEGORIES) for (const e of manifest.categories?.[k] ?? []) for (const f of glbsNamed(e)) own.add(f);
  const stale: string[] = [];
  let textured = 0;
  for (const f of own) {
    const path = join(dir, f);
    if (!existsSync(path)) continue;
    const said = glbSpecStamped(glbJsonOf(path));
    if (said === null) continue;
    textured++;
    if (!said) stale.push(f);
  }
  models += textured;
  ok(stale.length === 0, `${name}: every one of the ${textured} textured models its layout and flora name carries the format's stamp${stale.length ? ` (not: ${stale.slice(0, 5).join(', ')})` : ''}`);
  const stray = strayCategories(manifest);
  if (stray.length) {
    const strayFiles: string[] = [];
    for (const k of stray) for (const e of manifest.categories[k] ?? []) for (const f of glbsNamed(e)) if (!own.has(f) && existsSync(join(dir, f)) && glbSpecStamped(glbJsonOf(join(dir, f))) === false) strayFiles.push(f);
    const layout = existsSync(join(dir, 'layout.json'));
    note(`${name}: its manifest still carries ${stray.join(', ')}${strayFiles.length ? `, naming ${strayFiles.length} models from before the format (${strayFiles.slice(0, 5).join(', ')})` : ''}; ${layout ? 'nothing with a layout draws them, and status asks for the snapshot that takes them out' : 'NO LAYOUT: the outposts draw these, so they are not stray here'}`);
  }
}
if (models) note(`${models} textured models held to their stamp`);

console.log(`\n${passed} passed`);
