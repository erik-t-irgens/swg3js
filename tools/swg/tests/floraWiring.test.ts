// The flora paint's hand-overs (Map-maker II's fourth wave), read as text: every behaviour test of the wave builds its own
// generator, terrain, paint and planter, so a line lost from the game alone would pass all of them. Each pin names the
// line it holds and why.
//
// Run: node tools/swg/tests/floraWiring.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
const gen = read('src/swg/terrain/generator.ts');
const swg = read('src/world/swgTerrain.ts');
const world = read('src/world/world.ts');
const flora = read('src/world/flora.ts');
const worker = read('src/swg/terrain/workerCore.ts');
const trn = read('src/swg/terrain/trn.ts');
const entry = read('src/editor/editorEntry.ts');
const paint = read('src/editor/editorPaint.ts');
const main = read('src/main.ts');
const gp = read('src/swg/terrain/groundPaint.ts');

// The generator: the recipes after the last layer, on both threads (the worker runs the very generator).
ok(/if \(p !== null\) \{\n\s*p\.layFamilies\(d, false\);\n\s*p\.layColours\(d\);\n\s*p\.floraInto\(d\);\n\s*\}\n\s*\}/.test(gen), "the generator lays the flora recipes once, after its last layer, its families and its colours (a road's clearing is seen and kept)");
ok(/if \(m\.recOp && m\.recOp\.length === this\.recOp\.length\) this\.recOp\.set\(m\.recOp\);/.test(gp) && /for \(const t of m\.flo \?\? \[\]\) \{/.test(gp) && /takePaint\(msg\.paint, msg\.rev\)/.test(worker), "the worker's paint takes the flora tiles and the resolved recipes from the main thread's message");
ok(/reply\.message\.roads = g\.roads;/.test(worker) && /g\.roads = d\.roadMap;/.test(trn) && /if \(msg\.roads\) block\.roads = msg\.roads;/.test(swg), "the worker's grid carries the road byte back, and the block keeps it (the brush's and Mustafar's road)");

// The terrain: a flora stroke's tiles posted, marked and asked again as a family stroke's are.
ok(/const paint = p \? p\.message\(famKeys, colKeys, reset, fl\) : null;/.test(swg) && /for \(const m of \[p\.fam, p\.col, p\.flo\]\) for \(const k of m\.keys\(\)\) this\.tileRev\.set\(k, rev\);/.test(swg), "the terrain posts a flora stroke's tiles to the worker and marks them at the new revision");
ok(/for \(const m of \[p\.fam, p\.col, p\.flo\]\) \{\n\s*for \(const key of m\.keys\(\)\) \{/.test(swg) && /\} else this\.postPaint\(famKeys, colKeys, false, floKeys\);/.test(swg), "and asks every grid a flora tile reaches again when the recipes move, or the flora rows alone when they land");
ok(/if \(paint && paintResolve\) paintResolve\(this\.template\.generator\.shaderGroup, this\.template\.generator\);/.test(swg) && /paintResolve: \(group, gen\) => this\.resolvePaint\(group, gen\)/.test(world), "the recipes are resolved against the world's own flora tables before the worker is handed the paint");

// The world: resolved, landed, replanted.
ok(/const fmissing = p\.resolveRecipes\(this\.paintRecipes, g\?\.floraGroup \?\? null, g\?\.radialGroup \?\? null, pack\);/.test(world), "the world resolves its recipes with its palette, against its own tables (the lent pack's on a real-elevation world)");
ok(/swg\.postPaint\(famKeys, colKeys, false, fl\);\n\s*const asked = swg\.repaint\(x0, z0, x1, z1\);\n[^\n]*\n\s*if \(fl\.length\) this\.floraReplantLeft \+= asked;/.test(world), "a flora stroke let go replants the chunks its grids reach as they land, whatever `follow` says");
ok(/const flora = this\.floraReplantLeft > 0;\n\s*if \(flora\) this\.floraReplantLeft--;\n\s*const settling = this\.paintReplantLeft > 0 \|\| flora;/.test(world), "each landing of a flora stroke's grid replants its chunks");
// Moved on purpose by the fix round: a real-elevation world's landing names the tiles that moved (and, for a recipe moved,
// the tiles the paint holds for the classes it moved), never every chunk and far tile in one task.
ok(/if \(flo\.size \|\| recipesMoved\) this\.floraReplantLeft \+= asked;/.test(world) && /const by = recipesMoved \? recipeClassesMoved\(recipesBefore, this\.paintRecipes\) : null;/.test(world) && /this\.demFloraLanded\(by && \(by\.static \|\| by\.grass\) \? own\.concat\(painted\) : own, \(farAny \? own : \[\]\)\.concat\(by\?\.far \? painted : \[\]\)\);/.test(world), "a file's flora rows or recipes landing (an undo, a write's answer, a file read again) replant too, on both kinds of world; on a real-elevation world only the tiles and classes that moved");
ok(/if \(!recipesLead\(entries, this\.paintRecipes\)\) \{\n\s*this\.paintRecipes = copyRecipes\(entries\);\n\s*recipesMoved = true;/.test(world), "a recipes row that is the list in memory or its start leaves the recipes appended ahead of the file standing (a landing never drops the one the brush paints with)");
ok(/this\.demFloraLanded\(\[r\], this\.groundPaint\?\.recipesTouch\(3\) \? \[r\] : \[\]\);/.test(world), "a real-elevation world's stroke plants its chunks again at once, and its far cards only where a recipe touches them");
ok(/if \(paint\.flo\.size\) \{\n\s*const painted = this\.paintedFloraRects\(\);\n\s*this\.demFloraLanded\(painted, painted\);/.test(world), "a real-elevation world's paint file landing after the arrival's bound stands its plants too");
ok(/const planted = this\.flora && \(!df \|\| df\.source\.paintedIn\(cx \* CHUNK_SIZE, cz \* CHUNK_SIZE, CHUNK_SIZE\)\);/.test(world) && /c\.flora = built\.data \? built\.group : null;/.test(world) && /const own = this\.props\.buildForChunk\(cx, cz, this\.terrain, exclude, \(x, z\) => src\.ownsAt\(x, z\)\);/.test(world), "a real-elevation world's chunk is the planter's where its paint reaches, keeps its procedural props elsewhere, and in a painted chunk keeps them where the paint's trees and plants do not own the ground");
ok(/this\.streamFar\(playerPos, 1\);\n[^\n]*\n\s*this\.stepFarCards\(camPos\);/.test(world) && /this\.farCardsAtOnce = true;\n\s*try \{\n\s*this\.remakeGround\(\);/.test(world), "a real-elevation world's far cards are made a few a frame in play, and at once behind its arrival's screen");
ok(/if \(!this\.grass\) \{\n\s*this\.grass = new GrassField\(mat, this\.grassHost, depth\);\n[^\n]*\n[^\n]*\n\s*for \(const c of this\.chunks\.values\(\)\) this\.grass\.chunkMade\(c\.cx, c\.cz, c\.group\);/.test(world), "a real-elevation world's grass made in play (the editor's curtain) is told of the chunks standing already (found by the smoke: it held none and built no tuft)");
ok(/if \(r\.x0 <= r\.x1 && this\.layer !== 'plants'\) this\.host\.preview\(r, x, z\);/.test(paint), 'a flora stamp lays no preview over the cached blocks (the plants show as the stroke lands)');
ok(/const samples = this\.farCardSamples\(o\.x, o\.z\);/.test(world) && /if \(!df\.source\.farReaches\(o\.x, o\.z, FAR_TILE, FAR_RES\)\) return;\n\s*fc\.tileMade\(tx, tz, o\.x, o\.z, df\.source\.farSamples\(o\.x, o\.z, FAR_TILE, FAR_RES\)\);/.test(world), "the far cards read the far grids on a converted world and the paint's samples on a real-elevation one, only where the paint reaches the tile");

// Mustafar's baked trees.
ok(/const p = paint\.floraPoint\(0, x, z, family, before, this\.swg\.sampler\.roadAt\?\.\(x, z\) === true, BAKED_PAINTED\);/.test(flora), "Mustafar's baked trees take the recipe over the baked value, roads kept, by the generator's own arithmetic");

// The editor: the plants layer's recipes held, written, made ready.
ok(/recipes: \(\) => w\.paintRecipes,/.test(entry) && /floraReady: \(\) => h\.floraReady\(\),/.test(entry) && /floraIsReady: \(\) => w\.demFloraReady\(\),/.test(entry) && /release: \(r, famKeys, colKeys, floKeys\) => w\.paintRelease\(r\.x0, r\.z0, r\.x1, r\.z1, famKeys, colKeys, floKeys\),/.test(entry), "the editor's paint host hands the world its recipes, its readiness and a flora stroke's tiles");
ok(/floraReady: \(\) => this\.editorFloraReady\(\),/.test(main) && /this\.editorCurtain\('the plants of the paint', [^\n]*\(\) => this\.world\.ensureDemFlora\(\)\)/.test(main), "a real-elevation world's plants are made ready behind the editor's curtain, never on a live frame");
ok(/if \(changes\.some\(\(c\) => c\.after && c\.id\.startsWith\('flo:'\)\)\) \{/.test(paint) && /changes\.unshift\(\{ file: 'paint', id: 'recipes', before: recipesWas, after: now \}\);/.test(paint), "a flora stroke writes the recipes row with its tiles, in the same batch, where it grew");
ok(/floraPaint: async \(opts\?: Record<string, unknown>\) => \{/.test(main) && /floraPaintDebug\(o\?: Record<string, unknown>\): Promise<unknown>;/.test(main), '`__debug.floraPaint` reaches the editor');

console.log(`\nfloraWiring: ${checks} checks passed`);
