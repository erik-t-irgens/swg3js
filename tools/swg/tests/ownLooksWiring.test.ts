// Map-maker II's thirteenth wave: the library pass's pictures of the owner's own looks, and the hand-overs only the game makes,
// pinned as text (every behaviour test builds the rest for itself).
//
// The pass (`tools/swg/library.mjs`), over fixture packs labelled TEST: a look of a placements folder's looks file is drawn
// from its species pack's body parts and its outfit's own pieces, named for its content's hash; a second run keeps it; an
// edited look is drawn again under its new name and the old picture swept; a look whose pieces are not here is drawn from
// what is and named in the log; with no placements folder named, nothing of the looks is read; `status` names a look with no
// picture of it as it stands and never makes the library stale for it. The library's model picks a picture only of a look as
// it stands (`lookPictures`).
//
// Run: node tools/swg/tests/ownLooksWiring.test.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLibrary, libraryLooks, libraryStatus, lookFiles, lookPicturePath } from '../library.mjs';
import { buildGlb } from '../sceneglb.mjs';
import { lookHash, looksFileText, readLookRow, type OwnLookRow } from '../../../src/world/editFiles/looksFile.ts';
import { lookEntries, lookPictures, peopleEntries, isPersonEntry } from '../../../src/editor/libraryModel.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A GLB of one box, as the converter writes a model. */
function glb(w: number, h: number, d: number, y0: number): Buffer {
  const x0 = -w / 2;
  const x1 = w / 2;
  const z0 = -d / 2;
  const z1 = d / 2;
  const y1 = y0 + h;
  const pos = Buffer.from(new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]).buffer);
  const idx = Buffer.from(new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]).buffer);
  const bin = Buffer.concat([pos, idx]);
  return buildGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'test', mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: pos.length },
        { buffer: 0, byteOffset: pos.length, byteLength: idx.length },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [x0, y0, z0], max: [x1, y1, z1] },
        { bufferView: 1, componentType: 5125, count: 36, type: 'SCALAR' },
      ],
    },
    bin,
  );
}

// ---- the pass ----
{
  const root = mkdtempSync(join(tmpdir(), 'mm2-looks-lib-'));
  const pl = mkdtempSync(join(tmpdir(), 'mm2-looks-pl-'));
  try {
    mkdirSync(join(root, 'characters', 'human_male'), { recursive: true });
    writeFileSync(join(root, 'characters', 'human_male', 'body.glb'), glb(0.5, 1.8, 0.3, 0));
    writeFileSync(join(root, 'characters', 'human_male', 'shirt.glb'), glb(0.6, 0.7, 0.35, 0.9));
    writeFileSync(join(root, 'characters', 'human_male', 'parts.json'), JSON.stringify({ id: 'human_male', parts: [{ name: 'test_body', file: 'body.glb', body: true, occlusionLayer: 0 }, { name: 'test_shirt', file: 'shirt.glb', occlusionLayer: 1 }] }));
    mkdirSync(join(root, 'wardrobe', 'human_male'), { recursive: true });
    writeFileSync(join(root, 'wardrobe', 'human_male', 'coat.glb'), glb(0.8, 1.1, 0.5, 0.5));
    writeFileSync(join(root, 'wardrobe', 'human_male', 'wardrobe.json'), JSON.stringify({ items: [{ id: 'test_coat', kind: 'wearables', parts: [{ name: 'test_coat_m_l0', file: 'coat.glb' }] }] }));
    const look = (o: Partial<OwnLookRow> = {}) => readLookRow({ id: 'farmhand', from: 'dressed_test', species: 'human_male', outfit: [{ part: 'test_coat_m_l0', item: 'test_coat', wardrobe: 'wardrobe/human_male', values: { index_color_1: 3 } }], name: 'TEST farmhand', ...o }) as OwnLookRow;
    mkdirSync(join(pl, 'looks'), { recursive: true });
    const file = join(pl, 'looks', 'all.json');
    const missing = look({ id: 'short', outfit: [{ part: 'gone_m_l0', item: 'gone', wardrobe: 'wardrobe/human_male', values: {} }] });
    writeFileSync(file, looksFileText([look(), missing]));
    const files = lookFiles(root, look());
    ok(files.files.join() === 'characters/human_male/body.glb,wardrobe/human_male/coat.glb' && !files.missing.length, `a look is drawn from its species' bare body (the clothes' layers left out) and its own pieces (${files.files.join(', ')})`);
    ok(lookFiles(root, missing).missing.some((m) => /gone/.test(m)) && lookFiles(root, look({ species: 'nobody_male' })).missing.some((m) => /no species pack/.test(m)), 'what is not here is named, never guessed at');
    const none = buildLibrary({ root });
    ok(!none.index.entries.some((e: { s: string }) => e.s === 'looks') && !existsSync(join(root, 'library', 'icons', 'looks')), 'with no placements folder named, nothing of the looks is read');
    const logs: string[] = [];
    const r = buildLibrary({ root, placements: pl, log: (l: string) => logs.push(l) });
    const entries = r.index.entries.filter((e: { s: string }) => e.s === 'looks');
    const want = lookPicturePath(look());
    ok(want === `library/icons/looks/farmhand_${lookHash(look())}.png`, `a look's picture is named for its id and its content's hash (${want})`);
    const e = entries.find((x: { id: string }) => x.id === 'farmhand');
    ok(!!e && e.m === 'own:farmhand' && e.p === 'looks' && e.g === 'human_male' && e.n === 'TEST farmhand' && e.pic === want && existsSync(join(root, want)), 'each look is an entry worn as its body, grouped by its species, its picture drawn');
    const png = readFileSync(join(root, want));
    ok(png.subarray(1, 4).toString() === 'PNG' && png.length > 100, `and the picture is a PNG of what it is drawn from (${png.length} bytes)`);
    ok(entries.find((x: { id: string }) => x.id === 'short')?.pic != null && logs.some((l) => /short: gone/.test(l)), 'a look whose pieces are not all here is drawn from what is, and named in the log');
    const again = buildLibrary({ root, placements: pl });
    ok(again.kept >= 2 && readFileSync(join(root, want)).equals(png), 'a second run keeps a picture newer than everything it is drawn from');
    // A picture taken away from under the index: named by status as one with no picture, and drawn again by the next run.
    rmSync(join(root, want));
    ok(/1 of your looks with no picture of it as it stands \(farmhand\)/.test(libraryStatus(root, pl).line), 'status names a look whose picture is gone from the disk, though the index still names it');
    buildLibrary({ root, placements: pl });
    ok(existsSync(join(root, want)) && !libraryStatus(root, pl).line.includes('looks with no picture'), 'and the next run draws it again');
    // A piece converted again since (its GLB newer than the picture) is drawn again under the same name.
    const later = new Date(Date.now() + 120_000);
    utimesSync(join(root, 'wardrobe', 'human_male', 'coat.glb'), later, later);
    const redrawn = libraryLooks(root, pl);
    ok(redrawn.drawn === 1 && redrawn.kept === 1, `a look whose piece was converted again since its picture is drawn again (${redrawn.drawn} drawn)`);
    writeFileSync(file, looksFileText([look({ outfit: [{ part: 'test_coat_m_l0', item: 'test_coat', wardrobe: 'wardrobe/human_male', values: { index_color_1: 4 } }] }), missing]));
    const edited = lookPicturePath(look({ outfit: [{ part: 'test_coat_m_l0', item: 'test_coat', wardrobe: 'wardrobe/human_male', values: { index_color_1: 4 } }] }));
    const before = libraryStatus(root, pl);
    ok(!before.stale && /1 of your looks with no picture of it as it stands \(farmhand\)/.test(before.line) && before.line.includes('npm run swg -- library'), `status names a look edited since its picture, and never makes the library stale for it (“${before.line}”)`);
    ok(!libraryStatus(root).line.includes('looks with no picture'), 'and with no placements folder named, says nothing of them');
    buildLibrary({ root, placements: pl });
    ok(existsSync(join(root, edited)) && !existsSync(join(root, want)), 'an edited look is drawn under its new name and the old picture swept');
    ok(!libraryStatus(root, pl).line.includes('looks with no picture'), 'after which status names none');
    writeFileSync(file, looksFileText([]));
    buildLibrary({ root, placements: pl });
    ok(!existsSync(join(root, 'library', 'icons', 'looks')) || readdirSync(join(root, 'library', 'icons', 'looks')).length === 0, 'every look taken out, its pictures are swept');
    ok(libraryLooks(root, null).read === false, 'the looks half reads nothing with no folder');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(pl, { recursive: true, force: true });
  }
}

// ---- the library's model: a picture only of a look as it stands ----
{
  const cat = { entries: [{ id: 'own:a', name: 'A', species: 'human_male', own: { look: 'a', hash: '11111111' } }, { id: 'own:b', name: 'B', species: 'twilek_female', own: { look: 'b', hash: '22222222' } }, { id: 'dressed_x', name: 'X', group: 'dressed/civilian' }] };
  const index = [
    { s: 'looks', m: 'own:a', pic: 'library/icons/looks/a_11111111.png' },
    { s: 'looks', m: 'own:b', pic: 'library/icons/looks/b_99999999.png' },
  ];
  const pics = lookPictures(index, cat);
  ok(pics.get('own:a') === 'library/icons/looks/a_11111111.png' && !pics.has('own:b'), 'a picture of a look since edited names another hash and is no picture of it');
  const looks = lookEntries(cat, pics);
  ok(looks.length === 2 && looks[0].s === 'looks' && looks[0].m === 'own:a' && looks[0].pic === pics.get('own:a') && looks[1].pic === null && looks[1].g === 'twilek_female', 'the Looks source lists every look of the catalogue, by species, its picture where it stands');
  const people = peopleEntries(cat, pics);
  ok(people.find((p) => p.id === 'own:a')?.pic === pics.get('own:a') && people.find((p) => p.id === 'dressed_x')?.pic === null, 'and the People source shows a look\'s picture where it has one');
  ok(isPersonEntry(looks[0]) && isPersonEntry(people[0]), 'both are people in hand, placed by the next click');
}

// ---- the hand-overs only the game makes ----
{
  const read = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
  const main = read('src/main.ts');
  const batch = main.slice(main.indexOf('  private async editorBatch('), main.indexOf('  private async landWaterRows('));
  ok(/const kf = files\.looks;\s*if \(kf\) \{\s*this\.placementRevs\.set\('looks\/all', kf\.rev\);\s*this\.noteOwnRev\('looks\/all', kf\.rev\);/.test(batch), "the editor's batch keeps the looks file's revision under `all`, as the shared walk-through file's");
  ok(/if \(kf\) await this\.landOwnLooks\(\(cat\) => landRows\(cat\.ownRows, kf\.put as unknown as OwnLookRow\[\], kf\.deleted\)\);/.test(batch), 'and lands what it wrote over the looks in force, whatever world this is');
  const land = main.slice(main.indexOf('  private async landOwnLooks('), main.indexOf('  private async reloadLooks('));
  const landLines = [
    '    await cat.knowSpecies();',
    '    const before = cat.ownBodies();',
    '    cat.setOwnLooks(rowsOf(cat));',
    '    const moved = looksMoved(before, cat.ownBodies());',
    '    if (moved.size && this.inWorld && !this.world.sceneOnly) {',
    '      this.world.landPeople(this.world.placedPeopleRows);',
    '      this.storyStands.takeDown(wearersIn(this.jobs.view()?.cast ?? NO_CAST, moved), (b) => this.world.unstandMobile(b as Mobile), this.world.generation);',
    '    }',
    '    this.editor?.looksLanded();',
  ];
  ok(land.includes(landLines.join('\n')), "a landing merges the looks again and, where a look's body moved (looksMoved), stands this world's placed people again and takes down the cast members wearing it for the next pass to stand, and tells the editor");
  const reload = main.slice(main.indexOf('  private async reloadLooks('), main.indexOf('  private async landWaterRows('));
  ok(
    reload.includes(
      [
        '    const read = await readOwnLooks(import.meta.env.BASE_URL);',
        "    if (read === 'unread') {",
        "      console.warn(`looks: public/${editFilePath('looks', 'all')} changed and could not be read again: the looks stand as they stood`);",
        '      return;',
        '    }',
        "    if (typeof rev === 'string') this.placementRevs.set('looks/all', rev);",
        '    await this.landOwnLooks(() => read?.rows ?? []);',
      ].join('\n'),
    ),
    "the dev server's word read again lands a file that could not be fetched nowhere (the looks stand as they stood), and no file as none",
  );
  const word = main.slice(main.indexOf('  private placementWord('), main.indexOf('  private editLayerOf('));
  const looksWord = [
    "    if (kind === 'looks') {",
    '      if (this.placementsInFlight > 0) {',
    '        this.heldWords.push(d);',
    '        return;',
    '      }',
    "      if (typeof d.rev === 'string' && this.placementRevs.get('looks/all') === d.rev) return;",
    "      if (typeof d.rev === 'string' && this.takeOwnRev('looks/all', d.rev)) return;",
    '      void this.reloadLooks(d.rev);',
    '      return;',
    '    }',
  ].join('\n');
  ok(word.includes(looksWord) && word.indexOf(looksWord) < word.indexOf('if (d?.world !== here) return;'), "the dev server's word about the looks file is heard whatever world it names, before the world's own words, held while a write of the page's own is out");
  ok(/castBodies: \(\) => \(this\.jobs\.view\(\)\?\.cast \?\? \[\]\)\.map\(\(c\) => \(\{ id: c\.id, body: c\.body \}\)\),/.test(main), "the editor is told which bodies the story's cast stand as");
  ok(/ownLooks: async \(opts\?: Record<string, unknown>\) => this\.ownLooksDebug\(opts \?\? \{\}\),/.test(main), '`__debug.ownLooks` is hung on the toolbox');
  const cat = read('src/world/mobiles/catalogue.ts');
  ok(/const looks = readOwnLooks\(baseUrl\);/.test(cat) && /if \(own && own !== 'unread' && own\.rows\.length\) \{\s*await cat\.knowSpecies\(\);\s*cat\.setOwnLooks\(own\.rows\);/.test(cat), 'the catalogue reads the looks file beside itself at boot and merges only a file with rows');
  const ed = read('src/editor/editorEntry.ts');
  ok(/putLook: \(label, before, after\) => \{[\s\S]{0,200}this\.edits\.putRows\(label, \[\{ file: 'looks', id, before:/.test(ed), "the dresser's save, delete and undo are one write of the looks file each");
  ok(/this\.removals\.takePerson\(e\.m, entryName\(e\)\);/.test(ed) && /lookEntries\(cat, pics\)/.test(ed), 'a Looks entry in hand is a person wearing it, and the library lists the looks from the catalogue as it stands');
  ok(/DRESSER_RETUNE\.moved = \(\) => this\.dresserMade\?\.retune\(\);/.test(ed), "the debug menu's dresser dials reach the doll");
  // The dresser's own pages take the keys: nothing of the editor's is read under them.
  const keys = ed.slice(ed.indexOf('  keys(dt: number, oldHand: boolean): void {'), ed.indexOf('  async toggleTool('));
  const pagesBlock = [
    '    if (!this.session.on) return;',
    '    const input = this.host.input;',
    '    const a = this.fly.ask;',
  ].join('\n');
  const pagesHead = keys.indexOf(pagesBlock);
  const pagesIf = keys.indexOf('    if (this.dresserMade?.pagesOpen()) {');
  const pagesEnd = keys.indexOf('      input.mute(ALL_ACTIONS);\n      return;\n    }', pagesIf);
  ok(pagesHead >= 0 && pagesIf > pagesHead && pagesIf < keys.indexOf('    const ctrl = input.isDown(') && pagesEnd > pagesIf && /a\.fwd = 0;\s*a\.side = 0;\s*a\.up = 0;[\s\S]*a\.look = false;\s*this\.edits\.idle\(\);/.test(keys.slice(pagesIf, pagesEnd)), "while the dresser's pages are up the editor reads no key (no flight, no Delete, no chord) and mutes every action, before anything else of its own");
  const dui = read('src/ui/dresserUi.ts');
  ok(/new CharacterPreview\(\)/.test(dui) && !/\bworld\b\.|prepareActor|adoptMaterials|scene\.add\(/.test(dui) && /Character\.load\(base, species, \[\], \{ dir: `characters\/\$\{species\}\/`, skipRig: true \}\)/.test(dui), "the dresser's figure is drawn only in a doll of its own context, never handed to the world");
  // The dresser's glue is dresser.ts's functions, which dresser.test.ts runs over stand-in figures; each hand-over pinned whole.
  const glue = [
    "    p.onWear = async (id) => (this.figure ? wearPick(this.figure, this.items, id, this.host.baseUrl, (why) => this.say(why, false)) : false);",
    '    const look = lookFromFigure(figureStateOf(c, this.rest, this.items));',
    '    for (const p of look?.outfit ?? []) items.notePiece(p);',
    "    const { rest, missing } = await dressFigure(c, look, (f) => dressLook(f, { id: `dresser:${species}`, morphs: look!.morphs, custom: look!.custom, outfit: look!.outfit }, base));",
    '    this.rest = rest;\n    this.items = items;',
    '        const why = pickRefusal(me.items, c.manifest.id, id, c.packPartOf(id) !== null);\n        if (why) {\n          me.say(why, false);\n          return false;\n        }\n        const on = await c.wearItem(id, b);\n        if (on) me.items.noteOwn(id);',
    '    const plan = saveLook({\n      asNew,\n      record: this.record,\n      look,\n      taken: new Set(cat.ownRows.map((r) => r.id)),\n      fromOf: (species) => fromFor(species, null, cat.entries),\n      rules: lookRules(look.species, (w, item) => this.items.inFolder(w, item), (item) => c.packPartOf(item) !== null),\n    });',
    "    if (typeof plan === 'string') return this.say(plan, false);",
    "    const items = new DresserItems(wardrobeRel(c.wardrobeDir, base) ?? '', w?.items ?? []);",
  ];
  const duiLf = dui;
  const missingGlue = glue.filter((l) => !duiLf.includes(l));
  ok(!missingGlue.length, `the dresser hands its figure to dresser.ts's own glue: the pick by the arrangement rule, the look read off the figure, the rest before the dressing, each piece's folder, the refusal and the save${missingGlue.length ? ` (missing: ${missingGlue.map((l) => l.trim().slice(0, 60)).join(' | ')})` : ''}`);
  ok(/import \{ dressLook \} from '\.\.\/world\/mobiles\/dressLook\.ts';/.test(dui) && /const missing = await dressLook\(character, entry, baseUrl\);/.test(read('src/world/mobiles/look.ts')), 'and the dresser and buildLook dress a body by the one function');
  const cli = read('tools/swg/cli.mjs');
  ok(/libraryStatus\(dir, placementsFolder\(\)\)/.test(cli) && /buildLibrary\(\{ root: pos\[1\], log: \(line\) => console\.log\(line\), placements: placementsFolder\(\) \}\)/.test(cli), "the command and status read this checkout's looks file");
  ok(/'src\/world\/editFiles\/looksFile\.ts'/.test(read('tools/launcher/pack.mjs')), "the release carries the looks file's reader, which the library pass imports");
}

console.log(`\nownLooksWiring: ${checks} checks passed`);
