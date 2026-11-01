// The rivers' hand-overs only the game makes (Map-maker II's sixth wave), pinned as text, since every behaviour test makes
// them for itself (`rivers.test.ts`, `riverLiquid.test.ts`, `riverTool.test.ts` build their own tables, bodies and hosts):
// the arrival reads the terrain's own rivers and the file's, puts them in force before the water is drawn and stands them
// after it, and stands their fall effects once the particles exist; a world with no pack stands its rivers of ours; a
// reach is a body of the lake's material with a wind of its own, hidden and made ready through the queue in play, its
// current variant made where the volumetrics master is on; a landing of rivers lands them alone; the planter's rule and the
// air's ground sampler ask the rivers; the world's going takes them; the water's readers on both terrains ask them after
// the lakes; the console, the dials, the debug menu, the editor's host and the release carry them; and the README names
// the console helper.
//
// Run: node tools/swg/tests/riverWiring.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (f: string): string => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
/** Whether each line is in the text, in this order, every one after the last. */
const inOrder = (text: string, lines: readonly string[]): boolean => {
  let at = 0;
  for (const l of lines) {
    const k = text.indexOf(l, at);
    if (k < 0) return false;
    at = k + l.length;
  }
  return true;
};
/** A method's text, from its signature to its closing brace. */
const methodOf = (text: string, sig: string): string => {
  const at = text.indexOf(sig);
  if (at < 0) return '';
  let depth = 0;
  for (let i = text.indexOf('{', at + sig.length - 1); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(at, i + 1);
  }
  return '';
};

const world = read('src/world/world.ts');
{
  ok(inOrder(world, ['if (lakes) this.applyOurTables(this.ourLakeRows);', 'this.soeRiverRows = this.readSoeRivers(swg);', 'this.applyRivers(null);', 'this.applySwgWater(swg);', 'this.standRivers();', 'await this.loadLava(pack, swg);']), "a converted world's arrival: its lakes, then its terrain's rivers read and every river put in force before the water is drawn, stood as bodies after it, before the lava");
  ok(inOrder(world, ['for (const t of this.terrain.lakes) this.addLakeBody(t);', 'if (this.ourRiverRows.length) {', 'this.applyRivers(null);', 'this.standRivers();', 'await this.syncRiverEffects(token);', 'if (token !== this.loadToken) return null;']), 'a world with no pack: its rivers of ours stood after its lakes, their effects behind the screen');
  ok(inOrder(world, ['await this.loadNebulae(pack);', 'if (this.riverTables.length) {', 'await this.syncRiverEffects(token);', 'if (token !== this.loadToken) return null;']), "a converted world's rivers' fall effects stood once the particles exist, behind the screen");
  ok(/fx = new ParticleEffects\([^)]*\);\s*\n?\s*this\.particlesRoot = (pack|stand)\.root;/.test(world) || (world.includes('this.particlesRoot = pack.root;') && world.includes('this.particlesRoot = stand.root;')), "the particles' root kept wherever the particles are made, which a guest pack's file is named from");
  const add = methodOf(world, 'private addRiverBodies(t: RiverTable): void {');
  ok(add.includes('reachWind(reach, s.velocity, unit, RIVER_TUNE.flow, wind.value);') && add.includes("const body = this.waterBodies.add(mesh, false, look, 'lake', wind);"), "a reach is a body of the lake's role with a wind object of its own, written from its run at the river's velocity");
  ok(add.includes('if (live) mesh.visible = false;') && add.includes('void this.compileReady(meshes, `water: the river ${t.name}`).then(') && add.includes('for (const m of meshes) m.visible = true;'), 'in play it is hidden and made ready through the queue, shown once ready');
  ok(add.includes('if (this.air && VOL_TUNE.on) this.makeLiquidVariants();'), 'its current variant made where the volumetrics master is on (worn only once a warm has built it)');
  ok(add.includes('this.localWater.push(mesh);') && add.includes('this.waterMaterials.push(body.lit);'), "its mesh among the world's local water (taken with the world) and its material among the water's");
  const drop = methodOf(world, 'private dropRiverBodies(name: string): void {');
  ok(drop.includes('this.forgetMaterials([p.body.lit]);') && drop.includes('this.waterBodies.remove(p.mesh);') && drop.includes('p.mesh.geometry.dispose();'), "a reach taken out: its material out of the world's sets before its body disposes it, its geometry disposed");
  const land = methodOf(world, 'landWater(put: readonly WaterRow[], deleted: readonly string[]): number {');
  ok(land.includes('this.setWaterRows(plan.rows, { lakes, rivers });') && land.includes('if (rivers) this.landRivers(moved);') && land.includes('if (!lakes) return moved.size;'), 'a landing of rivers lands the rivers alone (and a landing of lakes the lakes alone)');
  const landR = methodOf(world, 'private landRivers(moved: ReadonlySet<string>): void {');
  ok(inOrder(landR, ['const before = [...this.ourRiverTables];', 'const tables = this.applyRivers(moved);', 'const plan = riverLandingPlan(before, tables, moved);', 'for (const n of plan.drop) this.dropRiverBodies(n);', 'for (const t of plan.add) this.addRiverBodies(t);', 'this.riversChanged(plan.touched);', 'void this.syncRiverEffects(this.loadToken);']), "a landing of rivers by the very difference a test runs (`riverLandingPlan`: every river that moved taken down as it stood and stood again as it stands, so one taken out or undone loses its bodies), what stands under it made again, its effects stood again");
  const retune = methodOf(world, 'retuneRivers(what: RiverRetune): string {');
  ok(inOrder(retune, ["if (what === 'flow') {", 'for (const p of e.parts) reachWind(p.reach, e.table.river.velocity, unit, RIVER_TUNE.flow, p.wind.value);', "if (what === 'effects') {", 'void this.syncRiverEffects(this.loadToken);', 'const before = [...this.riverTables];', 'const after = this.applyRivers(null, true);', 'const plan = riverRetunePlan(before, after);', 'for (const n of plan.drop) this.dropRiverBodies(n);', 'for (const k of plan.keep) this.handRiverBodies(k.from, k.to);', 'for (const t of plan.add) this.addRiverBodies(t);', 'this.riversChanged(plan.touched);', 'void this.syncRiverEffects(this.loadToken);']), "a retune: the flow written into every reach's wind at the tune's own flow; an effects number stands the effects again alone; a shape makes the tables again and, by the very plan a test runs (`riverRetunePlan`), takes down and stands again only the rivers whose water moved, hands the rest their new tables, makes again only what stands under those, and stands the effects again");
  const hand = methodOf(world, 'private handRiverBodies(from: RiverTable, to: RiverTable): void {');
  ok(hand.includes('e.table = to;') && hand.includes('if (r) p.reach = r;'), 'a river kept by a retune takes its new table, and each body its new reach');
  const sync = methodOf(world, 'private async syncRiverEffects(token: number): Promise<void> {');
  ok(inOrder(sync, ['turn.setFromAxisAngle(up, e.yaw);', 'm.compose(at.set(e.x, e.y, e.z), turn, size.setScalar(e.scale));', 'return fx.place(root + file, m, false);', 'remove: (h) => fx.remove(h),', 'still: () => token === this.loadToken && this.particles === fx,', 'const stood = await this.riverFx.sync(this.riverTables, World.RIVER_FX, host);']), "each fall effect placed where `riverEffects` stands it, turned by its yaw and scaled by its drop, through the one keeper that never leaves two overlapping syncs' sets standing (`RiverEffectsKeeper`)");
  ok(world.includes('return (x, z, ground) => (tables.length > 0 && underLakes(tables, x, z, ground)) || underRivers(rivers, x, z, ground);') && world.includes('if (!tables.length && !rivers.length) return null;'), "the planter's rule asks the rivers after the lakes, and with neither there is none");
  const apply = methodOf(world, 'private applyRivers(moved: ReadonlySet<string> | null, all = false): RiverTable[] {');
  ok(apply.includes('if (swg) swg.setRivers(list);') && apply.includes('this.terrain.rivers.push(t)') && apply.includes('if (this.flora) this.flora.underOurWater = this.underOurWaterRule();') && apply.includes('this.forgetCameraWater();'), "the rivers in force put where the water's readers take them, the planter told, the camera's water asked again");
  ok(inOrder(world, ['this.localWater.length = 0;', 'this.riverBodies.clear();', 'this.riverFx.forget();', 'this.riverTables = [];', 'this.soeRiverRows = [];', 'this.soeRiverTables = [];', 'this.ourRiverTables = [];']), "the world's going takes its rivers (their bodies among its local water, their effects with its particles, a sync of them still waiting overtaken)");
  ok(world.includes("const root = relativeRoot(this.particlesRoot, `${import.meta.env.BASE_URL}assets-private/props/`);") && world.includes("spray: 'particles/fx_pt_waterfall_spray_small.json',"), "the fall effects are the props pack's own files, named from the world's own folder, never a copy");
}

{
  const swg = read('src/world/swgTerrain.ts');
  ok(swg.includes('if (this.rivers !== null) h = riversSurface(this.rivers, gx, gz, h);') && swg.includes('if (this.rivers !== null) return riverTableAt(this.rivers, gx, gz, best) as SwgWaterTable | null;'), "a converted terrain's waterAt and waterTableAt ask its rivers after its lakes, and only where it has any");
  const terrain = read('src/world/terrain.ts');
  ok(terrain.includes('return this.rivers.length ? riversSurface(this.rivers, x, z, h) : h;') && terrain.includes('return this.rivers.length ? (riverTableAt(this.rivers, x, z, best) as SwgWaterTable | null) : best;'), 'and so does a world with no converted terrain');
}

{
  const main = read('src/main.ts');
  ok(main.includes('rivers: async (opts?: Record<string, unknown>) => {') && main.includes('if (ed) return ed.riversDebug(opts);') && main.includes('return { ...this.world.riversReport(), ...(at ? { at } : {}), ...(said.length ? { answered: said } : {}) };'), '`__debug.rivers` is the editor\'s on the dev server and the world\'s report, tune and point everywhere');
  const entry = read('src/editor/editorEntry.ts');
  ok(entry.includes('rivers: () => w.ourRiverRows,') && entry.includes('RIVER_DIALS.host = { tune: (partial) => this.tuneRivers(partial) };'), "the editor's water tool reads the world's rivers, and the dials make them again through it");
  // `tuneRiverTune` calls its retune before it answers, so what the retune says goes into a list made before the call: a
  // `const said = tuneRiverTune(tune, (s) => said.push(...))` throws on every shape change (the smoke's slope slider did).
  const tuneR = methodOf(entry, '  tuneRivers(tune: Record<string, unknown>): string[] {');
  ok(inOrder(tuneR, ['const said: string[] = [];', 'said.push(...tuneRiverTune(tune, (what) => said.push(this.host.world.retuneRivers(what))));']), "the editor's `rivers({ tune })` makes its list before the retune can write into it, handing on what the tune asks");
  ok(entry.includes("${this.host.world.retuneRivers('shape')}"), "and the Tools tab's Steep makes the rivers' tables again as a shape does");
  ok(read('src/main.ts').includes('said.push(...tuneRiverTune(o.tune as Record<string, unknown>, (what) => said.push(this.world.retuneRivers(what))));'), "the world's own `rivers({ tune })` hands on what the tune asks too");
  const mainTune = /const said: string\[\] = \[\];\n\s+if \(o\.tune && typeof o\.tune === 'object'\) said\.push\(\.\.\.tuneRiverTune\(/.test(read('src/main.ts'));
  ok(mainTune, "and so does the world's own `rivers({ tune })` off the dev server");
  const dials = read('src/editor/editorDials.ts');
  ok(dials.includes("helper === 'rivers' ? riversDialSet()") && /'slopeMax'/.test(dials), 'the debug menu has the rivers\' dials, the slope limit among them');
  ok(read('src/ui/debugModel.ts').includes("'lakes', 'rivers'"), "and `rivers` is in the World editor's group");
  ok(read('tools/launcher/pack.mjs').includes("'src/swg/terrain/ribbons.ts'"), 'the release carries the ribbons the converter now reads the terrain\'s rivers through');
  const readme = read('README.md');
  ok(/\| `rivers\(/.test(readme) && /\*\*Rivers\*\*/.test(readme), 'the README names the console helper and says what a river is');
}

console.log(`riverWiring: ${checks} checks passed`);
