// The paint's hand-overs (Map-maker II, DESIGN.md §2.5, W2), read as text, since every behaviour test builds the rest for
// itself: the generator's two snap sites (the paint taken off before a snap and laid after it) and its end lay; the
// worker's `paint` message and every grid's revision; the drawing gates asking `terrain.tiled`; the arrival awaiting the
// paint file before the terrain is made and before a raster's ground; the table-only lent table and the console's family
// list; the world row applied at an arrival and put back at the unload, through `worldRowSwitches` both ways, and its
// weights handed to the tiler; a landing handed to `SwgTerrain.landPaint` whether the palette moved or not; a real-elevation
// world's lent pack kept with its table and its base taken at the arrival alone; the colours before the paint's carried from
// the worker into the block a preview lays over; the wash's waiting write dropped with its world; the game's hand-overs in `main.ts` (the file's
// source, the batch's answer landed, the dev server's word, the loading screen's wait for a raster); and the editor's
// tool on U with the middle button its own.
//
// Run: node tools/swg/tests/paintWiring.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const body = (src: string, sig: string, indent = '  '): string => {
  const at = src.indexOf(sig);
  if (at < 0) return '';
  const end = src.indexOf(`\n${indent}}\n`, at);
  return src.slice(at, end < 0 ? undefined : end);
};

const generator = read('src/swg/terrain/generator.ts');
const worker = read('src/swg/terrain/workerCore.ts');
const swg = read('src/world/swgTerrain.ts');
const trn = read('src/swg/terrain/trn.ts');
const terrain = read('src/world/terrain.ts');
const world = read('src/world/world.ts');
const main = read('src/main.ts');
const input = read('src/core/input.ts');
const keys = read('src/editor/editorKeys.ts');
const entry = read('src/editor/editorEntry.ts');
const edit = read('src/editor/editorEdit.ts');
const demShader = read('src/world/demShader.ts');
const pack = read('tools/launcher/pack.mjs');
const groundPaint = read('src/swg/terrain/groundPaint.ts');

// The generator.
ok(/const p = d\.paint \?\? null;\s*if \(p !== null && p\.follow\) p\.unlayFamilies\(d\);\s*snapFamilies\(d\);\s*d\.shaderDirty = false;\s*if \(p !== null && p\.follow\) p\.layFamilies\(d, true\);/.test(generator), "a layer's snap: the paint taken off first and laid again after it, with follow on");
const gen = body(generator, '  generateChunk(d: ChunkData): void {');
ok(/if \(p !== null && d\.paintUnder\) d\.paintUnder\.count = 0;\s*for \(const l of this\.layers\) if \(!l\.pruned\) l\.affect\(amountMap, d\);/.test(gen), "a chunk's record of what the paint wrote over starts empty");
ok(/if \(d\.familyLattice > 0 && d\.shaderDirty\) \{\s*if \(p !== null && p\.follow\) p\.unlayFamilies\(d\);\s*snapFamilies\(d\);\s*d\.shaderDirty = false;\s*\}/.test(gen), "the last snap: the paint taken off first");
ok(/if \(p !== null\) \{\s*p\.layFamilies\(d, false\);\s*p\.layColours\(d\);\s*\}$/.test(gen), 'and the end lay: the families once more whatever came before, then the colours, the last thing the generator does');
ok((generator.match(/snapFamilies\(d\);/g) ?? []).length === 2, 'the generator snaps at exactly those two sites');
ok(/^import type \{ GroundPaint, PaintUnder \} from '\.\/groundPaint\.ts';$/m.test(generator) && !/^import \{[^}]*\} from '\.\/groundPaint\.ts'/m.test(generator), 'the generator names the paint by a type alone (no cycle at run time)');
ok(/^import \{[^}]*\} from '\.\/generator\.ts';$/m.test(groundPaint) && (groundPaint.match(/^import /gm) ?? []).length === 1, 'and the paint imports the generator alone');
ok(/'src\/swg\/terrain\/groundPaint\.ts'/.test(pack), "the release's source list carries it");

// The worker.
ok(/if \(msg\.type === 'paint'\) \{[\s\S]*?this\.takePaint\(msg\.paint, msg\.rev\);[\s\S]*?type: 'painted', rev: this\.rev/.test(worker), "the worker takes a `paint` message and answers with its revision");
ok(/if \(msg\.paint\) this\.takePaint\(msg\.paint, msg\.rev\);/.test(body(worker, '  handle(')), 'and the paint its init carries');
ok(/type: 'grid', id: msg\.id, rev: this\.rev,/.test(worker), 'every grid carries the revision it was made at');
ok(/paint: paint && !paint\.empty \? paint\.message\(null, null, true\) : null,\s*rev: this\.paintRev,/.test(swg), "the terrain hands its worker the paint with its init");
// (From Map-maker II's third wave every post carries the families other worlds lent the group, where any were.)
ok(/this\.worker\.postMessage\(group\.lent\.size \? \{ type: 'paint', rev, paint: p \? p\.message\(famKeys, colKeys, reset\) : null, lent: group\.lentList\(\) \} : \{ type: 'paint', rev, paint: p \? p\.message\(famKeys, colKeys, reset\) : null \}\);/.test(swg), 'and every change of it as a `paint` message');
ok(/if \(this\.staleGrid\(p, typeof msg\.rev === 'number' \? msg\.rev : 0\)\) \{/.test(swg), 'a grid older than its tiles is asked for again, never put');
ok(/this\.sampler\.paint = paint;/.test(swg) && /d\.paint = this\.paint;/.test(trn), 'the main thread\'s sampler holds the very paint and hands it every chunk it makes');

// The gates.
ok(/const tiler = this\.tiled \? this\.tiler : null;/.test(body(terrain, '  private buildGrid(')), 'a chunk asks `tiled` for its tiles (a converted terrain, or a real-elevation world whose ground names families)');
ok(/get tiled\(\): boolean \{\s*return this\.tiler !== null && \(this\.swg !== null \|\| this\.demShader !== null\);/.test(terrain), 'and `tiled` is a tiler over either');
ok(/if \(this\.groundTilesMat && this\.groundTextures\?\.tiles && this\.terrain\.tiled\) return this\.groundTilesMat;/.test(world), "the ground's material asks it too");
ok(/const painted = p\.familyAtRaw\(-x, z\);\s*if \(painted !== 0\) return painted;/.test(body(demShader, '  familyAt(')), "a real-elevation world's rules ask the paint first");

// The arrival.
const load = body(world, '  async loadPack(spawn: THREE.Vector3');
// (From Map-maker II's third wave the lending is planned between the two, and lent at the terrain's constructor: `foreignFamilies.test.ts`.)
ok(/await this\.paintReady\(\);\s*if \(token !== this\.loadToken\) return null;\s*(\/\/[^\n]*\n\s*)*await this\.prepareLending\(pack, this\.paintPack\(\)\);\s*if \(token !== this\.loadToken\) return null;\s*const paint = this\.groundPaint;[\s\S]{0,200}SwgTerrain\.create\([^\n]*\{ heights, paint, paintResolve: \(group\) => this\.resolvePaint\(group\), lend: /.test(load), 'the paint file is awaited before the converted terrain is made and handed to it, its palette resolved as it is made');
ok(/swg\.onRepainted = \(kind, x0, z0, x1, z1\) => this\.paintLanded\(kind, x0, z0, x1, z1\);/.test(load), 'grids made again for the paint are handed to the world as they land');
ok(/await this\.paintReady\(\);\s*if \(this\.terrain !== terrainAtLoad\) return;[\s\S]{0,400}?const base = this\.paintWorld\.base \? \{ \.\.\.this\.paintWorld\.base \} : null;\s*this\.terrain\.demBase = base;/.test(world), "a raster's paint file is read before its ground is borrowed and made, its base taken there and only there");
ok(/else if \(base\) await this\.loadBorrowedGround\(\{ pack: base\.pack, fallback: base\.name, rules: \[\] \}, patch\.lift\);/.test(world), "a world row's base borrows its pack as a ruled world's rules do");
ok(/this\.askPaint\(packId\);/.test(world), "the file is asked for as the arrival begins");

// The table-only lent table and the console's family list.
ok(/const table = await SwgTerrain\.create\(trn, \[\], 0, 0, \(file\) => pack\.bytes\(file\), \{ tableOnly: true \}\);\s*if \(token !== this\.loadToken\) return;\s*this\.terrain\.demLent = table;/.test(world), 'the lent table is read for its families alone and kept for the feet');
ok(/SwgTerrain\.create\(trn, \[\], 0, 0, \(file\) => pack\.bytes\(file\), \{ tableOnly: true \}\)/.test(main), "and so is the console's family list's");
ok(/if \(typeof Worker !== 'undefined' && !tableOnly\) \{/.test(swg), 'a table-only terrain starts no worker');

// The world row applied and put back.
ok(/this\.applyPaintWorld\(loaded\?\.world \?\? \{ id: 'world' \}, false\);/.test(world), 'the world row is applied as the paint is taken at an arrival');
ok(/this\.demGroundPending = null;\s*this\.restorePaintSwitches\(\);/.test(body(world, '  private unload(): void {')), 'and the switches it moved are put back at the unload');
ok(/const sw = worldRowSwitches\(GROUND_DRAW_TUNE, row, this\.paintSwitchesKept, live \? prev : null\);\s*const childrenMoved = sw\.children;\s*if \(sw\.moved\) writeGroundDraw\(groundTileUniforms\(\)\);/.test(body(world, '  applyPaintWorld(row: PaintWorldRow, live: boolean): void {')), "the row's switches go through `worldRowSwitches` (only what the row sets written, the row before it asked live), the uniforms written only when one moved");
ok(/const sw = worldRowSwitches\(GROUND_DRAW_TUNE, null, this\.paintSwitchesKept\);\s*if \(sw\.moved\) writeGroundDraw\(groundTileUniforms\(\)\);/.test(body(world, '  private restorePaintSwitches(): void {')), 'and the unload lets go of exactly what it moved through the same function');
ok(/tiler\.setWeights\(this\.paintWeighted\);/.test(body(world, '  applyPaintWeights(rebuild: boolean): void {')), "the world row's weights are handed to the tiler");

// The paint's landing.
const land = body(world, '  landPaint(put: readonly PaintRow[], deleted: readonly string[]): number {');
ok(/swg\.landPaint\(paletteMoved, fam, col, movedRaw\);/.test(land) && /if \(swg && this\.groundPaint && \(paletteMoved \|\| moved\)\) \{/.test(land), "a landing hands the terrain whether the palette moved, the tiles that moved and their rectangle (`SwgTerrain.landPaint`, which makes a tile taken out again even where the palette moved)");
ok(/return swg\.repaintTiles\(\);/.test(body(world, '  private repaintPainted(): number {')), "a change of `follow`, the weights or the palette makes again every tile the paint holds through the terrain's own walk");

// A real-elevation world's lent pack and its arrival's base.
ok(/this\.terrain\.demLent = table;\s*this\.terrain\.demLentPack = spec\.pack;/.test(world), 'the pack a real-elevation world borrows is kept with its table');
ok(/return this\.terrain\?\.demLentPack \?\? this\.planet\.ground\?\.pack \?\? this\.terrain\?\.demBase\?\.pack \?\? this\.packId;/.test(body(world, '  paintPack(): string {')), "the palette resolves against the pack really borrowed, never the world row's base as it stands now");
// Moved on purpose by the third wave: a base of another pack than the one borrowed is lent at the arrival and laid by the
// id it was lent under (`baseFamilyId`, which foreignFamilies.test.ts runs); the arrival's base, never the row as it stands.
ok(/shader\.baseId = baseFamilyId\(t\.demBase, t\.demLentPack, group, this\.lending\);/.test(body(world, '  private installDemPaint(): void {')), "and the arrival's base is the borrowed pack's own family, or another pack's lent at the arrival");

// The colours before the paint's, carried from the worker to the preview.
ok(/if \(g\.colorsUnpainted\) \{\s*reply\.message\.colorsUnpainted = g\.colorsUnpainted;\s*reply\.transfer\.push\(g\.colorsUnpainted\.buffer\);/.test(worker) && /if \(msg\.colorsUnpainted\) block\.colorsUnpainted = msg\.colorsUnpainted;/.test(swg), "a grid's colours before the paint's go from the worker into the block it lands as");
ok(/const colours = b\.colorsUnpainted \?\? b\.colors \?\?/.test(body(trn, '  previewPaint(')), "and a stroke's preview lays the paint over them");

// The editor's wash write is its world's alone.
ok(/this\.tools\.disarmAll\(\);\s*\/\/[^\n]*\n\s*if \(this\.washTimer\) clearTimeout\(this\.washTimer\);\s*this\.washTimer = null;/.test(body(entry, '  worldGone(): void {')) && /if \(w\.generation !== gen\) return;/.test(body(entry, '  washDial(')), "the wash's write waiting for its dials goes with its world, never into the next world's file");

// main.ts.
ok(/this\.world\.paintSource = \(pack, kind\) => this\.fetchPaint\(pack, kind\);/.test(main), "the world is handed the paint file's source");
ok(/if \(kind === 'paint'\) return \(pack, rev\) => void this\.reloadPaint\(pack, rev\);/.test(main), "the dev server's word about the paint file reads it again");
ok(/this\.world\.landPaint\(pf\.put as PaintRow\[\], pf\.deleted\)/.test(main), "a batch's answer lands the paint's rows by difference");
ok(/const dem = this\.world\.demGroundPending;/.test(main), "the loading screen waits for a textured raster's ground");

// The editor.
ok(/editorPaint: \['KeyU'\]/.test(input) && (/'editorPaint'/.test(body(input, 'export const DEV_ONLY_ACTIONS', '')) || /DEV_ONLY_ACTIONS[^\n]*'editorPaint'/.test(input)), 'the paint brush is on U, a dev-server action');
ok(/'editorPaint'/.test(keys), "and the editor holds U while it is on");
ok(/if \(this\.middlePressed && !\(this\.ed\.toolMiddle\?\.\(\) \?\? false\)\) void this\.eyedropper\(\);/.test(edit), 'the middle button is the armed tool\'s before it is the eyedropper');
ok(/w\.paintHeldTile = /.test(entry), "the world is told which tiles a stroke under way holds, so a word from the dev server never paints over it");

console.log(`\npaintWiring: ${checks} checks passed`);
