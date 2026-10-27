// The heights' hand-overs (Map-maker II, DESIGN.md §2.4), read as text, since every behaviour test builds the rest for
// itself: the four sites the edits are laid at (a block generated on the main thread, a block the worker made, a far grid,
// a real-elevation world's height) and their absence from the generator and its worker (which stay the client's ground);
// the file awaited right before `SwgTerrain.create` (and before a raster's `remakeGround`); and the rebuild's hand-overs in
// `world.ts` -- the replant before `addChunkPhysics`, so the plantings' colliders and the heightfield are remade together;
// the grass marked stale; at a stroke's end the far tiles, the air raster's `forget`, the depth cells and `dirtyAll` -- and
// the frame's step.
//
// Run: node tools/swg/tests/heightsWiring.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
/** A method's body, from its signature to the first line that closes it at its own indent. */
const body = (src: string, sig: string, indent = '  '): string => {
  const at = src.indexOf(sig);
  if (at < 0) return '';
  const end = src.indexOf(`\n${indent}}\n`, at);
  return src.slice(at, end < 0 ? undefined : end);
};

const trn = read('src/swg/terrain/trn.ts');
const swg = read('src/world/swgTerrain.ts');
const terrain = read('src/world/terrain.ts');
const world = read('src/world/world.ts');
const generator = read('src/swg/terrain/generator.ts');
const worker = read('src/swg/terrain/workerCore.ts');
const workerFile = read('src/swg/terrain/worker.ts');

// The four application sites.
ok(/if \(this\.heights\) this\.layEntering\(blockX, blockZ, b\);\s*this\.blocks\.set/.test(body(trn, '  generateBlock(blockX: number, blockZ: number): PoleBlock {')), 'a block generated on the main thread takes the edits as it enters the cache');
// (Map-maker II's second wave lets a preview's kept ground go between the two, which touches no height.)
ok(/if \(this\.heights\) this\.layEntering\(blockX, blockZ, block\);\s*(\/\/[^\n]*\n\s*)*(if \(this\.previewBase\.size\) this\.previewBase\.delete\([^\n]+\);\s*)?this\.blocks\.set/.test(body(trn, '  putBlock(blockX: number, blockZ: number, block: PoleBlock): void {')), 'a block the worker made takes them as it lands');
ok(/this\.farMeta\.set\(out, [^\n]+\);\s*if \(this\.sampler\.heights\) this\.layFar\(out\);\s*this\.farGrids\.set\(key, out\);/.test(swg), 'a far grid takes them as it enters its cache');
const heightAt = body(terrain, '  heightAt(x: number, z: number): number {');
ok(/const h = this\.groundRawAt\(x, z\);\s*if \(this\.heights === null \|\| this\.swg\) return h;\s*return this\.edited\(h, x, z\);/.test(heightAt), "a world with no converted terrain takes them at the end of heightAt, a converted world's being in its blocks");
ok(!/heights/.test(body(terrain, '  private groundBeneathDem(x: number, z: number): number {')), "never in groundBeneathDem (the feather's far end would count it twice)");

// Nowhere else: not in the generator, its worker, `generate`, `generateChunk` or `baseHeightAt`.
ok(!/HeightEdits|heightEdits|layIn|\.heights\s*=/.test(generator), 'the generator knows nothing of the edits');
ok(!/HeightEdits|heightEdits|layIn|layEntering/.test(worker) && !/HeightEdits|heightEdits|layIn|layEntering/.test(workerFile), 'nor does the worker');
// (generateChunk is the generator's own, which the line above holds whole.)
for (const sig of ['  generate(', '  baseHeightAt(']) {
  const b = body(trn, sig);
  ok(b.length > 0 && !/this\.heights|layEntering|layOne/.test(b), `the sampler's ${sig.trim().replace('(', '')} reads raw ground`);
}

// The file awaited right before the ground that takes it is made.
const load = body(world, '  async loadPack(spawn: THREE.Vector3');
// (From Map-maker II's second wave the paint file is awaited after it and handed in beside it, the same way; from its
// third wave the lending planned after the paint file, and lent at the terrain's constructor, `lend`.)
ok(/const heights = await this\.heightsReady\(\);\s*if \(token !== this\.loadToken\) return null;\s*(\/\/[^\n]*\n\s*)*await this\.paintReady\(\);\s*if \(token !== this\.loadToken\) return null;\s*(\/\/[^\n]*\n\s*)*await this\.prepareLending\(pack, this\.paintPack\(\)\);\s*if \(token !== this\.loadToken\) return null;\s*const paint = this\.groundPaint;\s*const coming = this\.terrain;\s*this\.swgComingFor = coming;\s*const swg = await SwgTerrain\.create\(trn, layers, layout\.center\.x, layout\.center\.z, \(file\) => pack\.bytes\(file\), \{ heights, paint, paintResolve: \(group, gen\) => this\.resolvePaint\(group, gen\), lend: \(group, tileWidth\) => this\.lendGround\(group, tileWidth\) \}\)\.finally\(\(\) => \{\s*if \(this\.swgComingFor === coming\) this\.swgComingFor = null;\s*\}\);/.test(load), "the heights file is awaited right before SwgTerrain.create and handed to it, so the sampler holds it before any block is cached");
// A file the bound gave up on that lands while the converted ground is made (inside `SwgTerrain.create`) is kept for it and
// handed to its sampler as it is attached: laid on the terrain the converted ground replaces, it reached nothing for the
// whole visit and every stroke wrote into a store the sampler never read (the fix round's finding).
ok(/this\.terrain\.attachSwg\(swg\);\s*(\/\/[^\n]*\n\s*)*(swg\.onRepainted = [^\n]+\n\s*)?(\/\/[^\n]*\n\s*)*if \(this\.heightEdits && swg\.heights !== this\.heightEdits\) this\.installHeights\(this\.heightEdits, true\);/.test(load), 'a heights file kept while the converted ground was made is handed to its sampler as it is attached');
const install = body(world, '  installHeights(store: HeightEdits | null, late = false): void {');
ok(/if \(swg\) \{\s*swg\.useHeights\(store\);\s*this\.terrain\.heights = null;\s*\} else if \(this\.swgComingFor === this\.terrain\) \{[\s\S]{0,400}?return;\s*\} else this\.terrain\.heights = store;/.test(install), "and installHeights keeps a store for a converted ground still being made, never laying it on the terrain that ground replaces");
const loadBody = body(world, '  load(planet: PlanetDef, packId = packIdOf(planet)): void {');
// Moved on purpose by Map-maker II's fourth wave's fix round: the remake sits in a `try` that makes the far cards at once behind the screen.
ok(/const store = await this\.heightsReady\(\);[\s\S]{0,200}terrain\.heights = store;[\s\S]{0,400}this\.remakeGround\(\);/.test(loadBody), "on a real-elevation world, before the raster's remakeGround");
// A raster that does not load: the file is still read and laid on the noise ground in its place (else its rows were never
// kept and every stroke over a tile the file holds was refused).
ok(/its elevation did not load[^\n]*\n[\s\S]{0,600}?this\.heightsByDem = false;\s*const store = await this\.heightsReady\(\);\s*if \(store && this\.terrain === terrainAtLoad\) this\.installHeights\(store\);/.test(loadBody), "a real-elevation world whose raster fails still reads its heights file and lays it on the noise ground");
// A file that lands before the ground is made waits for `heightsReady`, which hands it to the ground as it is made; only a
// file later than the bound is laid over the ground as a stroke is (the smoke found the race: laid into a terrain the
// converted ground then replaced, the edits reached nothing).
ok(/if \(this\.heightsAsk !== ask \|\| ask\.installed \|\| !ask\.late \|\| this\.generation !== ask\.gen\) return;/.test(world) && /if \(loaded === 'late'\) \{\s*\/\/[^\n]*\n\s*ask\.late = true;\s*return null;\s*\}/.test(world), 'a heights file is laid late only once the bound has given up on it');
ok(/this\.askHeights\(packId\);/.test(world) && /this\.world\.heightsSource = \(pack, kind\) => this\.fetchHeights\(pack, kind\);/.test(read('src/main.ts')), 'asked for as the load begins, through the page\'s own fetch');

// The rebuild's hand-overs.
const replant = body(world, '  replantChunk(c: Chunk): void {');
ok(replant.indexOf('this.chunkProps(c.cx, c.cz)') > 0 && replant.indexOf('this.chunkProps(c.cx, c.cz)') < replant.indexOf('this.addChunkPhysics(c);') && replant.indexOf('this.removeChunkPhysics(c);') < replant.indexOf('this.addChunkPhysics(c);'), 'the replant plants again before the physics is remade, so the plantings\' colliders and the heightfield are made together');
ok(/this\.floraField\?\.remove\(c\.key\);/.test(replant) && /this\.floraField\.add\(c\.key, c\.cx, c\.cz, built\.data, c\);/.test(replant) && /this\.plantSweep\.show\(c, FLORA_TUNE\);/.test(replant), 'and hands its plantings to the region batches and the plant sweep');
// The new plantings handed to the chunk before its physics is remade: `addChunkPhysics` stands every planting's collider
// from `c.colliders`, so a replant that left the old list there rebuilt every trunk buried (a raise) or standing in the air
// (a lower) with every behaviour test passing (the fix round's mutation).
// Moved on purpose by Map-maker II's fourth wave: a chunk's flora is the planter's data (a real-elevation world's chunk the
// paint does not reach keeps its procedural props though a planter stands).
ok(/c\.props = built\.group;\s*c\.colliders = built\.colliders;\s*c\.trees = built\.trees;\s*c\.plants = built\.plants;\s*c\.flora = built\.data \? built\.group : null;\s*c\.floraData = built\.data;/.test(replant) && replant.indexOf('c.colliders = built.colliders;') < replant.indexOf('this.addChunkPhysics(c);'), "the replant hands the chunk its new plantings and their colliders, before its physics is remade");
const step = body(world, '  private stepGroundRewrite(eye: THREE.Vector3): void {');
ok(/this\.terrain\.rewriteChunk\(c\.cx, c\.cz, c\.ground\.geometry, c\.heights\)/.test(step) && /c\.physics\[0\] = chunkHeightfield\(this\.physics, c\);/.test(step) && /this\.grass\?\.circleChanged\(/.test(step) && /this\.replantChunk\(c\);/.test(step), "a frame's share rewrites the ground in place, makes the heightfield again, marks the grass stale and replants");
const end = body(world, '  private endGroundStroke(): void {');
// Moved on purpose by Map-maker II's fourth wave's fix round: a far tile's cards are made again through `farCardsAgain`
// (a converted world's at once from its far grid, `tileGone` then `tileMade` as before; a real-elevation world's queued).
const again = body(world, '  private farCardsAgain(tx: number, tz: number): void {');
ok(/this\.terrain\.rewriteFarTile\(tx, tz, FAR_TILE, FAR_RES, t\.geometry\)/.test(end) && /this\.farCardsAgain\(tx, tz\);/.test(end) && /fc\.tileGone\(tx, tz\);\n\s*if \(samples\) fc\.tileMade\(tx, tz, o\.x, o\.z, samples\);/.test(again) && /this\.air\?\.raster\.forget\(s\.x0, s\.z0, s\.x1, s\.z1\);/.test(end) && /refreshWaterDepth\(/.test(end) && /this\.shadowHold\.dirtyAll\(\);/.test(end), "a stroke's end redoes the far tiles and their cards, forgets the air raster's cells, refreshes the depth cells and draws every held cascade again");
// A far tile is rebuilt where the stroke meets its whole grid, a far step past each side (its edge normals read that ring,
// and `relayRect` laid it again), never its own square alone.
ok(/if \(!rectMeetsChunk\(o\.x, o\.z, FAR_TILE, s\.x0, s\.z0, s\.x1, s\.z1, FAR_TILE \/ FAR_RES\)\) continue;/.test(end), "a stroke's end rebuilds every far tile whose grid it reaches, a far step past the tile's own square");
ok(/this\.stream\(playerPos, STREAM_BUDGET\);\s*\/\/[^\n]*\n\s*this\.stepGroundRewrite\(camPos\);/.test(world), 'the rebuild is stepped every frame, after the stream');

// A write's answer and the file read again land through `heightsLand.ts`'s rules (which `heightsEdits.test.ts` runs), never
// over a tile a stroke under way holds: the world's hand-over from the editor, and the page's hand-over of the answer.
const land = body(world, '  async landHeights(put: readonly HeightTileRow[]');
ok(/this\.heightRows\.land\(put, deleted\);/.test(land) && /const decoded = await decodeLanded\(put, deleted, inflate, deltasOf, tileOfId, /.test(land) && /const n = layLanded\(store, decoded, this\.heightsHeld, /.test(land), "a write's answer keeps the rows at once, then lays its tiles by `layLanded`, holding off what a stroke under way holds");
ok(/const n = layWhole\(store, next, this\.heightsHeld, /.test(body(world, '  replaceHeights(loaded: HeightsLoaded | null): number {')), 'and the file read again by `layWhole`, the same');
ok(/w\.heightsHeld = \(tx, tz\) => sculpt\.holds\(tx, tz\);/.test(read('src/editor/editorEntry.ts')), 'the editor hands the world which tiles its stroke under way holds');
const main = read('src/main.ts');
const batch = body(main, '  private async editorBatch(');
ok(/if \(hf && this\.world\.generation === gen && this\.editWorld\(\) === pack\) heightsLanded = this\.world\.landHeights\(hf\.put as HeightTileRow\[\], hf\.deleted, inflateBase64, deltasOf, tileOfId\);/.test(batch) && /if \(hf\) built = Promise\.all\(\[built, heightsLanded\]\)\.then\(\(\) => undefined\);/.test(batch), "every write's heights answer (a stroke, an undo, a redo) is landed into the ground and is part of what the write built");
// A read again that failed leaves the ground as it stood: the file may still hold its tiles.
ok(/const loaded = await this\.readHeights\(pack, [^\n]+\);[\s\S]{0,700}?if \(loaded === 'unread'\) \{[\s\S]{0,300}?return;\s*\}[\s\S]{0,400}this\.world\.replaceHeights\(loaded\);/.test(body(main, '  private async reloadHeights(')), 'the file read again for the dev server\'s word leaves the ground as it stood where it could not be read');
ok(/if \(!res \|\| res\.status === 404\) return null;/.test(body(main, '  private async readHeights(')) && /return 'unread';/.test(body(main, '  private async readHeights(')), 'and no file (a 404, none in the build) is told apart from a read that failed');
ok(/const swg = this\.terrain\.swg;\s*if \(swg\) \{\s*const r = swg\.relayRect\(x0, z0, x1, z1\);/.test(body(world, '  heightsChanged(gx0: number')), 'a stroke lays the cached blocks and far grids again at once');

console.log(`\nheightsWiring: ${checks} checks passed`);
