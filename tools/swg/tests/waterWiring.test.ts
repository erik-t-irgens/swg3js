// The lakes of ours as the game wires them (Map-maker II's fifth wave, DESIGN.md §8's read sites), read as text, since
// `World` and the app load nothing in node and every behaviour test of the lakes builds the rest for itself: a line lost from
// the game alone would pass every one of them.
//
// Run: node tools/swg/tests/waterWiring.test.ts
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
/** A method's text, by its first line, through its closing brace. */
function method(text: string, head: string): string {
  const at = text.indexOf(head);
  assert.ok(at >= 0, `${head} is where it was`);
  let depth = 0;
  for (let i = text.indexOf('{', at + head.length - 1); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(at, i + 1);
  }
  return '';
}

const world = read('src/world/world.ts');
const main = read('src/main.ts');

{
  // The arrival.
  ok(/this\.askPaint\(this\.editKey\);\s*(\/\/[^\n]*\n\s*)*this\.askWater\(this\.editKey\);/.test(world), "the water file is asked for as a world's load begins, beside its heights and its paint");
  ok(/const lakes = await this\.waterReady\(\);\s*if \(token !== this\.loadToken\) return null;\s*if \(lakes\) this\.applyOurTables\(this\.ourLakeRows\);\s*(\/\/[^\n]*\n\s*)*this\.soeRiverRows = this\.readSoeRivers\(swg\);\s*this\.applyRivers\(null\);\s*this\.applySwgWater\(swg\);\s*this\.standRivers\(\);/.test(world), "on a converted world its lakes are appended after the client's tables before the water is drawn (and from the sixth wave its rivers put in force before it and stood after it)");
  ok(/const lakes = await this\.waterReady\(\);\s*if \(token !== this\.loadToken\) return null;\s*if \(lakes\) \{\s*this\.applyOurTables\(this\.ourLakeRows\);\s*for \(const t of this\.terrain\.lakes\) this\.addLakeBody\(t\);\s*(\/\/[^\n]*\n\s*)*if \(this\.ourRiverRows\.length\) \{\s*this\.applyRivers\(null\);\s*this\.standRivers\(\);\s*await this\.syncRiverEffects\(token\);\s*if \(token !== this\.loadToken\) return null;\s*\}\s*\}\s*\}\s*this\.packStatus = planet\.borrowSky \? 'sky only' : 'no pack';/.test(world), "on a world with no converted terrain (the packless branch) they go on the terrain's own list and are made bodies behind the screen");
  ok(/if \(!planet\.space && planet\.pack === false\) \{\s*const lakes = await this\.waterReady\(\);/.test(world), 'only on a world with no pack at all (`pack: false`), as the permanent rows: a converted world whose pack is missing writes its lakes about its own centre');
  ok(/if \(!swg && this\.planet\?\.pack !== false\) \{[\s\S]{0,300}?return \[\];\s*\}/.test(world), 'and a landing there stands none either (`ourTablesOf`)');
  ok(/const loaded = await Promise\.race\(\[ask\.done, new Promise<'late'>\(\(r\) => setTimeout\(\(\) => r\('late'\), DRESSING_TUNE\.floraWaitMs\)\)\]\);/.test(world), 'the wait for the file is bounded (the dressing\'s own wait), and a file later than it is stood as it lands');
  const unload = method(world, '  private unload(): void {');
  ok(/this\.ourLakeRows = \[\];\s*this\.ourTables = \[\];\s*this\.ourLakeBodies\.clear\(\);\s*this\.roofs\.clear\(\);/.test(unload), "the lakes, their tables, their bodies' records and the roofs go with the world");
}

{
  // The live path, by difference.
  const land = method(world, '  landWater(put: readonly WaterRow[], deleted: readonly string[]): number {');
  ok(/planLakeLanding\(this\.ourWaterRows, put, deleted\)/.test(land), "a landing is planned by the very rule a test runs (`planLakeLanding`, over the lakes and rivers in force from the sixth wave)");
  ok(/const tables = this\.applyOurTables\(this\.ourLakeRows, moved\);/.test(land) && /return keptTables\(this\.ourTables as SwgWaterTable\[\], rows, moved, \(row\) => \{/.test(world), "and every lake that did not move keeps its very table (`keptTables`, which ourWater.test runs), so the lava's set and the looks, which know a table by itself, keep knowing it");
  ok(/this\.lavaLanding = this\.loadLava\(this\.pack, swg\);/.test(land), "a lava lake moved makes the lava again, kept as `lavaLanding` for the curtain to wait on");
  const touches = method(world, '  waterLandingTouchesLava(put: readonly WaterRow[], deleted: readonly string[]): boolean {');
  ok(/if \(!this\.terrain\.swg\) return false;\s*return landingTouchesLava\(this\.ourTables, put, deleted, \(s\) => this\.lakeIsLava\(s\)\);/.test(touches), "whether a landing makes the lava again is `landingTouchesLava` (which ourWater.test runs) over the lakes in force, where the lava is made at all");
  ok(!/applySwgWater\(/.test(land), 'and never draws the water again (`applySwgWater` takes every lake body down and pushes fresh materials)');
  ok(/for \(const id of moved\) this\.dropLakeBody\(id\);\s*for \(const t of tables\) if \(t\.ours && moved\.has\(t\.ours\.id\)\) this\.addLakeBody\(t\);/.test(land), 'each lake that moved is taken out and stood again, and no other');
  ok(/if \(rect\.x0 <= rect\.x1\) this\.waterChanged\(rect\.x0, rect\.z0, rect\.x1, rect\.z1\);\s*this\.refreshRoofs\(\);/.test(land), 'and what stands under it, old place and new, is planted again, its grass, air and depth window asked again');
  const drop = method(world, '  private dropLakeBody(id: string): void {');
  ok(/this\.scene\.remove\(e\.mesh\);[\s\S]*this\.forgetMaterials\(\[e\.body\.lit\]\);\s*this\.waterBodies\.remove\(e\.mesh\);\s*e\.mesh\.geometry\.dispose\(\);/.test(drop), "a lake taken out leaves the scene, its material the world's sets, and its body the water system's");
  const add = method(world, '  private addLakeBody(table: SwgWaterTable): void {');
  ok(/const body = this\.waterBodies\.add\(mesh, false, this\.ourLakeLook\(table\), 'lake'\);/.test(add), "a lake put on in play wears its own look (its numbers over its shader's), as one stood at the arrival does");
  const look = method(world, '  private ourLakeLook(table: SwgWaterTable): WaterLook {');
  ok(/look = lookOver\(this\.waterBodies\.lookFor\(table\.shader \|\| null, this\.planet\), table\.ours\?\.look\);/.test(look), "and that look is the row's own numbers laid over its shader's or the planet's (`lookOver`, which ourWater.test runs)");
  ok(/const live = !this\.behindScreen;\s*if \(live\) mesh\.visible = false;\s*this\.scene\.add\(mesh\);/.test(add), 'a lake put on in play is hidden until it is ready');
  ok(/if \(this\.air && VOL_TUNE\.on\) this\.makeLiquidVariants\(\);/.test(add), "with the volumetrics on, its current variant is made (and worn only once a warm has built it: `liquidUnbuilt`)");
  ok(/void this\.compileReady\(\[mesh\], `water: the lake \$\{row\.id\}`\)\.then\(\(\) => \{\s*if \(this\.generation === gen && this\.ourLakeBodies\.get\(row\.id\)\?\.mesh === mesh\) mesh\.visible = true;/.test(add), 'then made ready through the queue and shown, only if it is still the lake that stands');
  ok(/lakeWantsCurtain\(lava: boolean\): boolean \{\s*return lava \|\| !World\.lakeProgramsBuilt;/.test(world), 'a lava lake, or any lake while the session has built no lake\'s programs, goes behind the editor\'s curtain');
  ok(/if \(opts\.target === undefined\) this\.noteLakePrograms\(\);/.test(world), "a sweep for the frames' own target notes a lake's programs built");
}

{
  // The readers that went to `swg` alone.
  ok(/const table = dry \? null : this\.terrain\.waterTableAt\(p\.x, p\.z\);/.test(world), "the camera's look asks the terrain's own covering table (a lake of ours on any world)");
  ok(/const table = terrain\.waterTableAt\(x, z\);\s*if \(table && table\.height > level\) return this\.lavaTables\.has\(table\)/.test(world), "and so does the lava's column");
  ok(/const own = table && table\.ours && !lava && table\.height === surface \? this\.ourLakeLook\(table\) : null;/.test(world), 'a lake of ours that is the surface wears its own look under it');
}

{
  // The app: the source, the landings, the reload, the frame's word.
  ok(main.includes('this.world.waterSource = (pack, kind) => this.fetchWater(pack, kind);'), "the world reads its water file through the app's fetch");
  ok(/const wf = files\.water;\s*if \(wf && this\.world\.generation === gen && this\.editWorld\(\) === pack\) \{\s*await this\.landWaterRows\(wf\.put as WaterRow\[\], wf\.deleted\);\s*this\.world\.noteWaterWritten\(wf\.rev, wf\.rows\);/.test(main), "an editor batch's water lands by difference (an undo's and a redo's too), its revision and count kept for the console");
  ok(/if \(kind === 'water'\) return \(pack, rev\) => \(this\.madeMapEdit\(\), void this\.reloadWater\(pack, rev\)\);/.test(main), "the dev server's word about the water file reads it again");
  ok(/const d = this\.world\.waterDiffOf\(loaded\);\s*await this\.landWaterRows\(d\.put, d\.deleted\);/.test(main), 'and lands it through the same door');
  const landRows = method(main, '  private async landWaterRows(put: WaterRow[], deleted: string[]): Promise<void> {');
  ok(/const lava = this\.world\.waterLandingTouchesLava\(put, deleted\);\s*if \(lava && !this\.traveling\) \{\s*const r = await this\.editorCurtain\('a lava lake of ours', 'the lava made again', async \(\) => \{\s*this\.world\.landWater\(put, deleted\);\s*await this\.world\.lavaLanding;\s*\}\);\s*if \(r\) return;\s*\}\s*this\.world\.landWater\(put, deleted\);\s*if \(lava\) await this\.world\.lavaLanding;/.test(landRows), "a landing that makes the lava again does it behind the editor's curtain where none is up, and under one already it waits for the lava before that curtain's sweep: never on a live frame");
  ok(/if \(view !== null && !water\.submerged && UNDERWATER_TUNE\.exits\) this\.world\.exitWaterOf\(view, ew\);\s*else ew\.under = false;\s*f\.exitWater = ew\.under;/.test(main), "the frame tells the underwater pass when the camera stands in a building with an exit under water");
  ok(/const r = await this\.editorCurtain\('a lake of ours', detail, async \(\) => \{\s*const said = await work\(\);\s*if \(this\.postfx\) await this\.postfx\.warmUp\(\);/.test(main), "a lake behind the editor's curtain is written, then the effects warm its mask twins, then the curtain sweeps");
}

{
  // The editor's water tool.
  const input = read('src/core/input.ts');
  ok(/editorWater: \['KeyZ'\]/.test(input), 'Z is the water tool');
  const ed = read('src/editor/editorEntry.ts');
  ok(/this\.water = new EditorWater\(this\.waterHost\(\)\);\s*this\.tools\.add\(waterTool\(this\.water\)\);/.test(ed), 'the editor makes the water tool an entry of its Tools list');
  ok(/curtain: \(detail, work\) => h\.lakeCurtain\(detail, work\),/.test(ed) && /wantsCurtain: \(lava\) => w\.lakeWantsCurtain\(lava\),/.test(ed), 'it asks the world whether a lake goes behind the curtain, and the game for the curtain');
  const tool = read('src/editor/editorWater.ts');
  ok(/const run = async \(\): Promise<string> => \(\(putsLake \|\| lava\) && host\.wantsCurtain\(lava\) \? host\.curtain\(label, write\) : write\(\)\);/.test(tool), 'a write that puts a lake on goes behind the curtain where the world says, and every change to a lava lake does');
  ok(/return this\.commit\(`the \$\{row\.kind\} \$\{id\} taken out`, \[\{ file: 'water', id, before: row, after: null \}\], row\.kind === 'lake' && this\.host\.isLava\(row\.shader\)\);/.test(tool), 'a lava lake taken out says it is lava (a river never is: the sixth wave)');
  ok(/const es = host\.edits\.beginStroke\(label\);\s*const no = await host\.edits\.strokeWrite\(es, changes\);\s*const said = host\.edits\.endStroke\(es\);/.test(tool), 'every change one write and one undo (the editing\'s own stroke)');
}

console.log(`waterWiring: ${checks} checks passed`);
